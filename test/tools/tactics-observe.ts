/**
 * **強制注入側翼／集火，把一場 20v20 打完並收集量測。**
 *
 * 不是測試、也不是探針 —— 是兩者共用的量測台，**沒有任何頂層執行碼**。
 * 跑它的是這兩支：
 *
 * ```
 *   test/integration/ai-command-tactics.test.ts   命令有沒有被執行（三場）
 *   test/tools/tactics-effect.probe.ts            執行了有沒有比較好（十九場）
 * ```
 *
 * 【為什麼共用而不是各抄一份】這支 500 行裡有一半是量測本身的陷阱（時間
 * 對齊、場內對照、僚機基線）。抄兩份等於埋一個「兩邊會慢慢漂開」的洞，
 * 而漂開的那一天，護欄與探針講的是不同的事，沒有人看得出來。
 * 與 `test/tools/spawn-snapshot.ts` 同一個做法。
 */
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
export type ControlIndex = Map<number, { sum: Float64Array, cnt: Float64Array }>

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

export interface Observed {
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
   * 實測：沒對齊時側翼 0.061、對照 0.769，看起來是大勝；
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
export function observe(
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
export function allVictims(): number[] {
  return victimFlights(createBattle(new Idle()))
}

/** 把多場的計數加起來。**逐欄相加**，比值要自己除 */
export function merge(runs: readonly Observed[]): Observed {
  const out = { ...runs[0]! }
  for (const k of Object.keys(out) as (keyof Observed)[]) out[k] = 0
  for (const r of runs) {
    for (const k of Object.keys(out) as (keyof Observed)[]) out[k] += r[k]
  }
  return out
}

/** 僚機在命令期間持有目標的比例 */
export function wingmanRate(o: Observed): number {
  return o.wingmanArmed / Math.max(o.wingmanSamples, 1)
}

/**
 * 跑對照那一場，順便把逐步方位角索引建起來。
 *
 * 【為什麼包成一支而不是讓呼叫端自己來】`CONTROL_INDEX` 是模組層的旗標，
 * **設了不關的話下一場會繼續往索引裡寫**，而那一場是有注入命令的 ——
 * 對照組於是被汙染成「對照 + 側翼」的混合，不會有任何錯誤，只會讓時間
 * 對齊的比較悄悄失去意義。順序與收尾包在這裡，呼叫端就不可能寫錯。
 *
 * 【對照只要一場】它不注入任何東西，所以不管拿哪個分隊當受命者都逐位元
 * 相同 —— 索引仍然逐分隊建，因為查的時候要按分隊查。
 */
export function runControl(victims: readonly number[]): {
  ctrl: ControlIndex, run: Observed,
} {
  const ctrl: ControlIndex = new Map(victims.map((v) => [v, {
    sum: new Float64Array(SECONDS * 240), cnt: new Float64Array(SECONDS * 240),
  }]))
  CONTROL_INDEX = ctrl
  const run = observe(null, victims[0]!)
  CONTROL_INDEX = null
  return { ctrl, run }
}

