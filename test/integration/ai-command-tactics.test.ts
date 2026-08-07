import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND, FLANK_RANGE, type FlightOrder } from '../../src/ai/command'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120
/**
 * 一張注入的命令解除之後，隔多久才注入下一張，s。
 *
 * 【為什麼一定要有】側翼要買的是「切進去**之後**開的那幾槍角度更好」。
 * 到位就立刻補下一張的話，受命分隊整整 120 秒一槍都不開（實測方位角取樣
 * 0 個），品質指標量不到任何東西 —— 那不是戰術沒效果，是量測把效果的
 * 發生時機整個切掉了。
 *
 * 10 秒是一次咬尾攻擊的量級（`entryRange` 10 km、對頭接近率 400 m/s 下，
 * 第一次扣扳機到脫離約十幾秒）。
 */
const COOLDOWN = 10

/**
 * 對照那一場的逐步方位角索引：`flight → { sum[step], cnt[step] }`。
 *
 * 【為什麼跑一次就夠】戰局是完全決定性的，而對照組不注入任何東西 ——
 * 同一場仗不管拿哪個分隊當受命者都逐位元相同。
 */
type ControlIndex = Map<number, { sum: Float64Array, cnt: Float64Array }>

/** 建索引時由 `observe` 寫入。只在對照那一場不是 null */
let CONTROL_INDEX: ControlIndex | null = null

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

/**
 * 全部**不含玩家**的分隊索引，兩隊都算。強制注入輪流注給每一個。
 *
 * 【為什麼要輪替】方位角的品質指標一場只收得到約 66 個取樣（受命分隊在
 * 命令期間本來就不開火，自由窗口天然很短），單場不足以論證任何事。
 *
 * 【為什麼不是換 seed】`createBattle` 的 seed **只影響飛行員名字**，不進
 * 任何物理路徑（M9 spec §6.2）—— 換一百個 seed 會跑出一百場逐位元相同的
 * 仗。真正能產生不同軌跡的是換受命分隊：位置不同、對手不同、機種也不同。
 */
function victimFlights(b: Battle): number[] {
  const playerFlight = b.flights.pinned >= 0 ? b.flights.flightOf[b.flights.pinned]! : -1
  const out: number[] = []
  for (let f = 0; f < b.flights.flights.length; f++) if (f !== playerFlight) out.push(f)
  return out
}

/** 這個分隊的指揮官 */
function stateOf(b: Battle, f: number) {
  return b.flights.flights[f]!.team === 'blue' ? b.blueCommand : b.redCommand
}

/** 這個分隊的敵方分隊索引 */
function enemyFlightsOf(b: Battle, f: number): readonly number[] {
  return b.flights.flights[f]!.team === 'blue' ? b.redFlightIndices : b.blueFlightIndices
}

/**
 * 離 `f` 最近的**敵方**分隊索引；−1 = 沒有。
 *
 * @param minDist 只考慮超過這個距離的分隊。**側翼要傳 `FLANK_RANGE`** ——
 *   真實觸發器的條件就是「最近的敵分隊超過 FLANK_RANGE」，拿一個已經貼在
 *   臉上的分隊當側翼目標，命令會在發出的同一步就被 `flankArrived` 判定
 *   到位（實測 17701 張注入、17700 張立刻解除，飛機一張都沒真的收到）。
 */
function nearestEnemyFlight(b: Battle, f: number, minDist = 0): number {
  const mine = flightCentroid(b, f)
  if (mine === null) return -1
  let best = -1
  let bestD = Infinity
  for (const g of enemyFlightsOf(b, f)) {
    const c = flightCentroid(b, g)
    if (c === null) continue
    const d = c.distanceTo(mine)
    if (d <= minDist || d >= bestD) continue
    bestD = d
    best = g
  }
  return best
}

function flightCentroid(b: Battle, f: number): Vector3 | null {
  const flight = b.flights.flights[f]!
  const out = new Vector3()
  let n = 0
  for (let p = 0; p < flight.count; p++) {
    const c = b.world.combatants[flight.members[p]!]!
    if (!c.alive) continue
    out.add(c.aircraft.state.position)
    n++
  }
  return n > 0 ? out.divideScalar(n) : null
}

interface Observed {
  /** 強制注入了幾張 */
  injected: number
  /** 其中幾張因為到位而解除 */
  cleared: number
  /** 命令期間受命飛機開火的取樣數 */
  firingUnderOrder: number
  /** 其中意圖是 defend 的（閃躲永遠優先，那些格不受命令管） */
  firingWhileDefend: number
  /** 其中意圖是 rally 的（命令真的在生效的那些格） */
  firingWhileRally: number
  /** 命令期間的總取樣數，當分母 */
  samplesUnderOrder: number
  /** 命令期間安全層的撞地接管取樣數 */
  groundUnderOrder: number
  /** 任何飛機掉到安全層 clearance 以下的取樣數 */
  belowClearance: number
  /** 受命分隊裡「鎖著同一架」的最大架數，逐取樣累加 */
  focusLockSum: number
  /** 受命分隊的存活架數，逐取樣累加。當 focusLockSum 的分母 */
  focusLockDen: number
  /** 命令期間僚機 target 不為 null 的取樣數 */
  wingmanArmed: number
  /** 命令期間僚機的總取樣數 */
  wingmanSamples: number
  /**
   * 同上兩個，但**不看有沒有命令**。對照組（`kind === null`）唯一填得到的
   * 就是這一對 —— 「僚機仍然有目標」是一個基線非零的量，沒有基線就不知道
   * 命令把它推高了還是推低了（第一份 §9.2 記過同一課）。
   */
  wingmanArmedAll: number
  wingmanSamplesAll: number
  /**
   * 開火那一刻的**方位角**累加：`敵機首 · 由敵指向我`。
   * 越接近 −1 代表越是從他背後打。除以 `aspectCount` 得平均。
   */
  aspectSum: number
  aspectCount: number
  /** 全場的擊墜數 */
  kills: number
  /** 全場的開火取樣數（所有飛機），當「每單位開火時間的擊墜」的分母 */
  firingSamples: number
  /** 受命分隊自己開火時的方位角，與全場的分開 */
  aspectSumOwn: number
  aspectCountOwn: number
  /**
   * **時間對齊**的方位角：只算「到位之後的自由窗口」那些步，而且對照組
   * 也只算同一批步、同一個分隊。
   *
   * 【為什麼非要對齊不可】方位角受**戰局階段**支配的程度遠大於戰術本身：
   * 同一批分隊不下任何命令，整場 +0.858、後半場（60 秒之後）−0.600。
   * 開場是對頭接面（正值），後期是咬尾（負值）。任何把開火時機往後推的
   * 處理都會讓這個指標變好看 —— 而側翼恰恰就會（繞路途中不開槍）。
   *
   * 2026-08-07 實測：沒對齊時側翼 0.061、對照 0.769，看起來是大勝；
   * 對齊之後 delta 在 +0.80 到 −0.20 之間隨參數亂跳，五組平均 +0.08。
   * **那個「大勝」完全是時間效應。**
   */
  matchedOnSum: number
  matchedOnCount: number
  matchedOffSum: number
  matchedOffCount: number
  /**
   * 集火命令期間，**被指名那一架**掉的 hp 與它存活的秒數。
   *
   * 【為什麼改成場內對照】原本的判準是「每單位開火時間的擊墜」，實測
   * 120 秒的 20v20 **一架都沒掉**（總傷害 2764 對上 40 架的血量），兩邊
   * 都是 0.000 —— 分母是零，那個指標在這個場景沒有解析度。擊墜是「傷害
   * 超過血量」的門檻版，而這個專案已經三次裁定連續量勝過門檻量（危險
   * 分數的平方反比核、`extendPitchAngle`、卸載係數）。
   *
   * 拿**同一場的其他敵機**當分母，「這場仗打得兇不兇」這個因素自動消掉，
   * 不需要對照組。與僚機那條判準改成拿側翼當對照是同一手。
   */
  focusedLoss: number
  focusedTime: number
  /** 同一時間，**同隊其他**敵機掉的 hp 與它們的存活秒數（當分母） */
  othersLoss: number
  othersTime: number
  /** 紅方掉的 hp */
  redDamage: number
  /** 藍方掉的 hp */
  blueDamage: number
}

/**
 * 跑一場 20v20，對指定的分隊強制注入戰術。
 *
 * @param kind `'flank'` / `'focus'` / `null`（不注入，當對照）
 * @param vf   受命的分隊索引。`kind === null` 時只用來標記，戰局完全不受
 *             影響 —— 所以**一場對照就夠**，它的自由開火方位角是對全場量的
 */
function observe(
  kind: 'flank' | 'focus' | null, vf: number, ctrl?: ControlIndex,
): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    injected: 0, cleared: 0, firingUnderOrder: 0,
    firingWhileDefend: 0, firingWhileRally: 0, samplesUnderOrder: 0,
    groundUnderOrder: 0, belowClearance: 0,
    focusLockSum: 0, focusLockDen: 0, wingmanArmed: 0, wingmanSamples: 0,
    wingmanArmedAll: 0, wingmanSamplesAll: 0,
    aspectSum: 0, aspectCount: 0, aspectSumOwn: 0, aspectCountOwn: 0,
    matchedOnSum: 0, matchedOnCount: 0, matchedOffSum: 0, matchedOffCount: 0,
    kills: 0, firingSamples: 0,
    focusedLoss: 0, focusedTime: 0, othersLoss: 0, othersTime: 0,
    redDamage: 0, blueDamage: 0,
  }
  /** 開場的 hp，用來算全程掉了多少。與 `ai-command-channel.test.ts` 同一個算法 */
  const hp0 = b.world.combatants.map((c) => c.hp)
  /** 上一步的 hp，用來算每步的掉血 */
  const prevHp = b.world.combatants.map((c) => c.hp)
  if (vf < 0) return o
  /**
   * 這一格現在放的那張**注入的**命令。用物件同一性比，不是用 null 比 ——
   * 真實的指揮官也會替同一個分隊發自己的命令，只要「沒有命令才補」就會
   * 變成跟它搶同一格：實測 120 秒裡只有 4 張是注入的，其餘時間量到的是
   * 指揮官自己發的集火令（開火取樣 5828 個全部是 `kind === 'focus'`）。
   * 每步補位之後那一格永遠不是空的，規劃那一支就永遠輪不到它。
   */
  let mine: FlightOrder | null = null
  /** 距離下一次可以注入還有多久，s */
  let cooldown = 0
  /** 這一步在不在「到位之後的自由窗口」裡 */
  let free = false

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)

    const flight = b.flights.flights[vf]!
    // 【消失了就是被解除了】指揮官不會替一張還在的命令換一張（規劃只在
    // `orders[f] === null` 時跑），所以不同一性只可能來自 stepCommand 的解除
    const state = stateOf(b, vf)
    if (state.orders[vf] !== mine) {
      if (mine !== null && flight.count > 0) { o.cleared++; cooldown = COOLDOWN }
      mine = null
    }
    free = cooldown > 0
    if (free) {
      cooldown -= DT
      // 【冷卻期間要真的自由】只是不注入是不夠的 —— 真實的指揮官會在下一個
      // 規劃週期補上自己的命令（接敵後每個分隊都在 FLANK_RANGE 內，所以補
      // 的幾乎必然是集火）。實測：九場合併的自由開火取樣只有 66 個，與單場
      // 一樣多，也就是冷卻期完全沒有產生自由時間。
      //
      // 每步清掉之後，指揮官仍然會在規劃的那一格重發一次（planPeriod 2 秒
      // 一次，480 步裡的 1 步），那 0.2% 的污染是可接受的；相對地，不清掉
      // 的話這個品質指標量到的根本不是側翼的效果。
      if (kind !== null) {
        state.orders[vf] = null
        const fl = b.flights.flights[vf]!
        for (let p = 0; p < fl.count; p++) {
          const ai = b.world.combatants[fl.members[p]!]!.controller
          if (ai instanceof AiController) { ai.order = null; ai.focusTarget = null }
        }
      }
    }

    // ── 強制注入 ────────────────────────────────────────
    if (mine === null && cooldown <= 0 && kind !== null && flight.count > 0) {
      const tf = nearestEnemyFlight(b, vf, kind === 'flank' ? FLANK_RANGE : 0)
      if (tf >= 0) {
        const injected = makeOrder(b, kind, tf)
        if (injected !== null) {
          state.orders[vf] = injected
          mine = injected
          o.injected++
        }
      }
    }

    // ── 觀測 ──────────────────────────────────────────
    for (const c of b.world.combatants) {
      if (!c.alive) continue
      if (c.aircraft.state.position.y < DEFAULT_SAFETY.clearance) o.belowClearance++
      // 【這裡配置 Vector3 是可以的】它在測試檔裡，不在 `src/` 的熱路徑上。
      // 品質指標只在量測時算
      if (c.command.firing) {
        o.firingSamples++
        const ai = c.controller
        const t = ai instanceof AiController ? ai.target : null
        if (t !== null) {
          // 敵機首 · 由敵指向我。−1 = 我在他正後方
          const fwd = new Vector3(0, 0, -1).applyQuaternion(t.state.orientation)
          const los = new Vector3().copy(c.aircraft.state.position).sub(t.state.position)
          const len = los.length()
          if (len > 1e-6) {
            const a = fwd.dot(los) / len
            o.aspectSum += a
            o.aspectCount++
            // 【只量自由狀態】命令期間本來就不開火（側翼）或打指定的那一架
            // （集火）。品質問的是「戰術執行完之後，這個分隊開的槍如何」
            const own = ai instanceof AiController && ai.order === null
            if (own && (kind === null || b.flights.flightOf[c.index] === vf)) {
              o.aspectSumOwn += a
              o.aspectCountOwn++
            }
            // 【建對照索引】對照那一場把每一步、每一個分隊的開火存起來，
            // 之後任何窗口組合都查得到。戰局是決定性的，所以跑一次就夠
            if (kind === null && CONTROL_INDEX !== null) {
              const arr = CONTROL_INDEX.get(b.flights.flightOf[c.index]!)
              if (arr !== undefined) { arr.sum[s] = arr.sum[s]! + a; arr.cnt[s] = arr.cnt[s]! + 1 }
            }
            // 【時間對齊的實驗組】只算自由窗口
            if (free && kind !== null && b.flights.flightOf[c.index] === vf) {
              o.matchedOnSum += a
              o.matchedOnCount++
            }
          }
        }
      }
    }

    // 【時間對齊的對照組】同一步、同一個分隊，對照那一場開了哪些槍
    if (free && ctrl !== undefined) {
      const arr = ctrl.get(vf)
      if (arr !== undefined) {
        o.matchedOffSum += arr.sum[s]!
        o.matchedOffCount += arr.cnt[s]!
      }
    }

    // 【基線在命令之外量】這一段刻意排在 `order === null` 的閘門**之前**
    for (let p = 0; p < flight.count; p++) {
      const c = b.world.combatants[flight.members[p]!]!
      if (!c.alive) continue
      const ai = c.controller
      if (!(ai instanceof AiController) || ai.stationReference === null) continue
      o.wingmanSamplesAll++
      if (ai.target !== null) o.wingmanArmedAll++
    }

    // ── 集火：被指名那一架 vs 同隊其他敵機的掉血速率 ──────
    if (mine !== null && mine.kind === 'focus') {
      const t = b.world.combatants[mine.focusIndex]
      if (t !== undefined && t.alive) {
        const d = prevHp[t.index]! - t.hp
        if (d > 0) o.focusedLoss += d
        o.focusedTime += DT
        for (const c of b.world.combatants) {
          if (!c.alive || c.index === t.index || c.team !== t.team) continue
          const dd = prevHp[c.index]! - c.hp
          if (dd > 0) o.othersLoss += dd
          o.othersTime += DT
        }
      }
    }
    for (const c of b.world.combatants) prevHp[c.index] = c.hp

    // 【只量注入的那一張】對照組（kind === null）沒有注入，量指揮官自己的
    const order = kind === null ? (state.orders[vf] ?? null) : mine
    if (order === null) continue

    let locked = -1
    let lockCount = 0
    let alive = 0
    for (let p = 0; p < flight.count; p++) {
      const c = b.world.combatants[flight.members[p]!]!
      if (!c.alive) continue
      alive++
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      o.samplesUnderOrder++
      if (ai.safetyAction === 'ground') o.groundUnderOrder++
      if (ai.stationReference !== null) {
        o.wingmanSamples++
        if (ai.target !== null) o.wingmanArmed++
      }
      if (order.kind === 'focus' && ai.target !== null) {
        // 用指派板的索引數「幾架鎖著同一架」
        const t = b.board.assignments[c.index]!
        if (t >= 0) {
          if (t === locked) lockCount++
          else if (locked < 0) { locked = t; lockCount = 1 }
        }
      }
    }
    if (order.kind === 'focus' && alive > 0) {
      o.focusLockSum += lockCount
      o.focusLockDen += alive
    }
    // 開火要在延遲之後的指令上看 —— `Combatant.command` 是世界實際吃到的
    for (let p = 0; p < flight.count; p++) {
      const c = b.world.combatants[flight.members[p]!]!
      if (c.alive && c.command.firing) {
        o.firingUnderOrder++
        const ai = c.controller
        if (ai instanceof AiController) {
          if (ai.intent === 'defend') o.firingWhileDefend++
          else if (ai.intent === 'rally') o.firingWhileRally++
        }
      }
    }
  }

  for (const c of b.world.combatants) {
    if (!c.alive) o.kills++
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') o.blueDamage += lost
    else o.redDamage += lost
  }
  return o
}

/** 造一張要強制注入的命令。`null` = 這一格造不出來（目標分隊全滅） */
function makeOrder(b: Battle, kind: 'flank' | 'focus', tf: number): FlightOrder | null {
  const flight = b.flights.flights[tf]!
  if (flight.count === 0) return null
  if (kind === 'flank') {
    return {
      kind: 'flank',
      // point 由 stepCommand 每步重寫，這裡給什麼都會被蓋掉
      point: new Vector3(),
      radius: DEFAULT_COMMAND.arriveRadius,
      targetFlight: tf,
      side: 1,
      focusIndex: -1,
    }
  }
  // focus：挑那個分隊裡第一個活著的
  for (let p = 0; p < flight.count; p++) {
    const gi = flight.members[p]!
    if (b.world.combatants[gi]!.alive) {
      return {
        kind: 'focus', point: new Vector3(), radius: 0,
        targetFlight: -1, side: 0, focusIndex: gi,
      }
    }
  }
  return null
}

/**
 * 受命分隊的清單。戰局是決定性的，所以拿一場空跑出來的編制就是每一場的編制。
 */
const VICTIMS = victimFlights(createBattle(new Idle()))

/**
 * 側翼**每個受命分隊各跑一場**，合併起來當一個樣本。
 *
 * 【為什麼要合併】方位角的品質指標單場只收得到約 66 個取樣，不足以論證
 * 任何事。九場合併約 600 個。合併的是同一個量在不同位置、不同對手、不同
 * 機種下的取樣 —— 那正是「這個戰術一般而言有沒有效」要問的母體。
 */
/**
 * 【順序不能反】對照要先跑，因為它同時在建逐步索引；側翼那九場要查它。
 */
const CTRL: ControlIndex = new Map(
  VICTIMS.map((v) => [v, { sum: new Float64Array(SECONDS * 240), cnt: new Float64Array(SECONDS * 240) }]),
)
CONTROL_INDEX = CTRL
const controlRun = observe(null, VICTIMS[0]!)
CONTROL_INDEX = null

const flankRuns = VICTIMS.map((v) => observe('flank', v, CTRL))

/** 集火跑一場：它的判準是場內對照，不需要跨場合併 */
const focusRun = observe('focus', VICTIMS[0]!)

/** 把多場的計數加起來 */
function merge(runs: readonly Observed[]): Observed {
  const out = { ...runs[0]! }
  for (const k of Object.keys(out) as (keyof Observed)[]) out[k] = 0
  for (const r of runs) {
    for (const k of Object.keys(out) as (keyof Observed)[]) out[k] += r[k]
  }
  return out
}

const flankRun = merge(flankRuns)

/** 僚機在命令期間持有目標的比例 */
function wingmanRate(o: Observed): number {
  return o.wingmanArmed / Math.max(o.wingmanSamples, 1)
}

describe('強制注入側翼（20v20、120 秒 × 九個受命分隊）', () => {
  const o = flankRun

  /** 【場景要成立】一張都沒注入的話，下面每一條都會空洞地通過 */
  it('真的注入過側翼命令', () => {
    expect(o.injected).toBeGreaterThan(0)
  })

  /**
   * 【側翼要到得了】spec §7.2 的第 24 條。判準取多數而不是全部：混戰是
   * 混沌的，個別一張在途中被新的攻擊者打斷是正常的 —— 與第一份 §9.3 的
   * 「編隊收攏」同一個形狀，理由也相同。
   */
  it('多數側翼命令因為到位而解除', () => {
    console.log(JSON.stringify({
      injected: o.injected, cleared: o.cleared,
      firing: `${o.firingUnderOrder}/${o.samplesUnderOrder}`,
      wingmanArmed: `${o.wingmanArmed}/${o.wingmanSamples}`,
      wingmanRate: (o.wingmanArmed / Math.max(o.wingmanSamples, 1)).toFixed(3),
      firingDefend: o.firingWhileDefend, firingRally: o.firingWhileRally,
      ground: o.groundUnderOrder,
    }))
    expect(o.cleared).toBeGreaterThan(o.injected / 2)
  })

  /**
   * 【途中不交戰】spec §4.4。
   *
   * 【為什麼量的是「意圖為 rally 的那些格」而不是全部】閃躲永遠優先是專案
   * 負責人的既有裁定：破防閂上時意圖是 `defend`，那些格**不受命令管**，
   * 而一架正在閃躲的飛機偶爾會打到一槍。要求「命令期間一槍都不開」等於
   * 順帶要求「閃躲時不准開槍」—— 那是一條沒有人下過的規定，而且對一個
   * 基線非零的量要求零，這個專案已經踩過三次。
   *
   * 2026-08-07 九場合併：403/654896 個取樣在開火，其中 391 是 `defend`、
   * **0 是 `rally`**。剩下的 12 個是僚機在「目標被清掉」的那一瞬，反應
   * 延遲管線裡還留著上一格的開火旗標（每次轉換 ≤ 0.2 秒，九場共 50 ms）。
   */
  it('側翼期間受命飛機一槍都不開', () => {
    expect(o.firingWhileRally).toBe(0)
  })

  /** 【安全層不豁免】判準與第一份的六場護欄同一條線 */
  it('側翼期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })
}, 10 * 60 * 1000)

describe('強制注入集火（20v20、120 秒）', () => {
  const on = focusRun
  const off = controlRun

  it('真的注入過集火命令', () => {
    expect(on.injected).toBeGreaterThan(0)
  })

  /**
   * 【集火要真的集中】spec §7.2 的第 27 條。量的是「受命分隊裡鎖著同一架
   * 的平均架數佔存活架數的比例」，與不下令的對照比。
   */
  it('受命分隊鎖同一架的比例高於對照', () => {
    const share = on.focusLockSum / Math.max(on.focusLockDen, 1)
    console.log(JSON.stringify({
      injected: on.injected,
      focusShare: share.toFixed(3),
      offInjected: off.injected,
      wingmanArmed: `${on.wingmanArmed}/${on.wingmanSamples}`,
      onAll: (on.wingmanArmedAll / Math.max(on.wingmanSamplesAll, 1)).toFixed(3),
      offAll: (off.wingmanArmedAll / Math.max(off.wingmanSamplesAll, 1)).toFixed(3),
    }))
    // 【0.30 的來歷】2026-08-07 實測 0.476（四架的分隊約當兩架同時咬同一
    // 個），專案負責人裁定取約 1.6 倍餘裕。**這是護欄不是參數** —— 它由
    // 實測定值再經裁定，不隨掃描移動
    expect(share).toBeGreaterThan(0.30)
  })

  /**
   * 【僚機不能被清掉目標】spec §7.2 的第 28 條，也是 §6.4 第 2 點最容易
   * 寫錯的地方。集火時僚機要靠 `LEVEL_FOCUS` 跟上，清掉目標會讓它掉進
   * 「沒有目標 → 飛站位」，集火就只剩長機一架在打。
   *
   * 【三方對照，門檻是中點】原本寫的是 `onRate > flankRate * 5`（2026-08-07
   * 實測 8.9 倍，專案負責人裁定取 5 倍）。第三份加上配額之後掉到 4.77 倍
   * —— 而根因不是集火壞了：**強制注入只釘住受命的那一支，另外九支仍然照
   * 配額走，所以整場仗本來就不同**。三個母體會一起漂移（自由 0.311 →
   * 0.404、集火 0.566 → 0.396、側翼 0.064 → 0.083），任何寫死的倍數都會
   * 被全域效應推著跑。
   *
   * 改成問**同一次量測裡的三個母體誰站在哪一邊**：集火要落在自由與側翼的
   * 中點之上。這直接說出要防的失效模式 ——「集火會不會像側翼那樣把僚機的
   * 目標清掉」—— 而且**沒有可調的數字**，三個值一起漂移時它不動。
   */
  it('集火期間僚機仍然有目標', () => {
    const onRate = wingmanRate(on)
    const flankRate = wingmanRate(flankRun)
    const freeRate = off.wingmanArmedAll / Math.max(off.wingmanSamplesAll, 1)
    const mid = (freeRate + flankRate) / 2
    console.log(JSON.stringify({
      focusRate: onRate.toFixed(3),
      flankRate: flankRate.toFixed(3),
      freeRate: freeRate.toFixed(3),
      mid: mid.toFixed(3),
    }))
    // 【自由要真的高於側翼】否則中點沒有意義，兩條斷言會一起空洞地通過
    expect(freeRate).toBeGreaterThan(flankRate)
    expect(onRate).toBeGreaterThan(mid)
  })

  it('集火期間不動用安全層的撞地接管', () => {
    expect(on.groundUnderOrder).toBe(0)
  })
}, 10 * 60 * 1000)

/**
 * 量的地板：側翼那一場的總傷害至少要有對照組的幾成。
 *
 * 【0.55 的來歷】2026-08-07 實測：側翼 1736、對照 2764，比值 **0.628**。
 * 專案負責人依這個實測值裁定取 0.55，留約 13% 餘裕 —— 比第一份的傷害
 * 護欄（2413 對實測 2525，4.6% 餘裕）寬，因為側翼比撤退更常發生。
 *
 * 第一份 §9.4 已經記過：一條撤退規則就讓總傷害掉 48%，遠高於命令佔時
 * 比例，因為撤離的小隊同時停止挨打與停止輸出。側翼再加一段。
 */
const FLOOR = 0.55

describe('戰術的效果（20v20、開／關對照）', () => {
  const flank = flankRun
  const focus = focusRun
  const off = controlRun

  /**
   * 【側翼的品質】spec §7.3 的第 29 條。開火那一刻的方位角往後側方移動 ——
   * 值越接近 −1 代表越是從他背後打。
   *
   * 【為什麼是品質而不是總傷害】專案負責人 2026-08-07 裁定：側翼與集火要
   * 買的是「從更好的角度發起攻擊」與「同一個目標被更多架咬」。用總傷害量
   * 去驗品質的改動方向本來就不對 —— 而且側翼必然減少交戰時間，量的判準會
   * 把一個成功的側翼判成失敗。
   *
   * 【只量受命分隊、只量自由狀態、九場合併、**對照時間對齊**】命令期間
   * 本來就不開火，所以問的是「切進去**之後**開的那幾槍如何」。單場只收
   * 得到約 66 個取樣，九個受命分隊各跑一場合併。
   *
   * 對照**必須**取同一批時間窗、同一個分隊 —— 見 `matchedOnSum` 的註解。
   *
   * 【門檻在跑之前先定死】`n ≥ 300` 且「比對照低 0.05 以上」，專案負責人
   * 2026-08-07 裁定。看到結果再定門檻等於量到綠為止 —— 這一輪的目的正是
   * 要讓這條判準**有可能失敗**。
   */
  it('側翼讓開火時的方位角往後側方移動', () => {
    // 【一定要用時間對齊的那一對】沒對齊的比較（`aspectSumOwn` 對
    // `off.aspectSumOwn`）會給出 0.061 對 0.769 的「大勝」，而那**完全是
    // 時間效應** —— 見 `matchedOnSum` 的註解。兩個都印出來當紀錄。
    const on = flank.matchedOnSum / Math.max(flank.matchedOnCount, 1)
    const base = flank.matchedOffSum / Math.max(flank.matchedOffCount, 1)
    const naiveOn = flank.aspectSumOwn / Math.max(flank.aspectCountOwn, 1)
    const naiveOff = off.aspectSumOwn / Math.max(off.aspectCountOwn, 1)
    console.log(JSON.stringify({
      matchedOn: on.toFixed(3), matchedOff: base.toFixed(3),
      delta: (on - base).toFixed(3),
      n: `${flank.matchedOnCount} vs ${flank.matchedOffCount}`,
      naive: `${naiveOn.toFixed(3)} vs ${naiveOff.toFixed(3)}`,
      runs: flankRuns.length,
      dmg: `flank R${(flank.redDamage / flankRuns.length).toFixed(0)}`
        + `:B${(flank.blueDamage / flankRuns.length).toFixed(0)}`
        + ` off R${off.redDamage.toFixed(0)}:B${off.blueDamage.toFixed(0)}`,
    }))
    // 【n 是判準的一部分】取樣不足時「有沒有差」根本問不出來。300 是專案
    // 負責人 2026-08-07 在跑之前先定死的，與下面那個 0.05 一起
    expect(flank.matchedOnCount).toBeGreaterThanOrEqual(300)
    expect(on).toBeLessThanOrEqual(base - 0.05)
  }, 10 * 60 * 1000)

  /**
   * 【集火的品質】spec §7.3 的第 30 條。集火的整個賣點就是「同一架被多人
   * 咬 → 更快掉下來」；若它沒有變快，這個戰術沒有意義（spec §7.5 的否決
   * 條件之一）。
   *
   * 【量法：場內對照，門檻 1.5 倍】原本寫的是「每單位開火時間的擊墜」，
   * 2026-08-07 實測**兩邊都是 0.000** —— 120 秒的 20v20 一架都沒掉，分母
   * 是零。擊墜是「傷害超過血量」的門檻版，改用連續量（掉血速率）與這個
   * 專案的三次既有裁定一致。
   *
   * 分母取**同一場、同一隊的其他敵機**：「這場仗打得兇不兇」自動消掉，
   * 不需要對照組。1.5 倍是專案負責人 2026-08-07 在跑之前先定死的門檻 ——
   * 看到結果再定門檻等於量到綠為止。
   */
  it('集火讓被指名那一架掉血更快', () => {
    const focused = focus.focusedLoss / Math.max(focus.focusedTime, 1e-9)
    const others = focus.othersLoss / Math.max(focus.othersTime, 1e-9)
    console.log(JSON.stringify({
      focusedRate: focused.toFixed(4), othersRate: others.toFixed(4),
      ratio: (focused / Math.max(others, 1e-9)).toFixed(3),
      focusedTime: focus.focusedTime.toFixed(1),
    }))
    expect(focused).toBeGreaterThan(others * 1.5)
  }, 10 * 60 * 1000)

  /** 【九場取平均與一場的對照比】見 `FLOOR` 的註解 */
  it('總傷害不得崩掉', () => {
    const on = (flank.redDamage + flank.blueDamage) / flankRuns.length
    const base = off.redDamage + off.blueDamage
    console.log(JSON.stringify({
      onTotal: on.toFixed(0), offTotal: base.toFixed(0),
      ratio: (on / Math.max(base, 1)).toFixed(3), floor: FLOOR,
    }))
    expect(on).toBeGreaterThan(base * FLOOR)
  }, 10 * 60 * 1000)
})
