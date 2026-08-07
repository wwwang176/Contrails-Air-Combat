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

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

/** 藍隊第一個**不含玩家**的分隊索引。強制注入就注給它 */
function victimFlight(b: Battle): number {
  const playerFlight = b.flights.pinned >= 0 ? b.flights.flightOf[b.flights.pinned]! : -1
  for (const f of b.blueFlightIndices) if (f !== playerFlight) return f
  return -1
}

/**
 * 離 `f` 最近的紅方分隊索引；−1 = 沒有。
 *
 * @param minDist 只考慮超過這個距離的分隊。**側翼要傳 `FLANK_RANGE`** ——
 *   真實觸發器的條件就是「最近的敵分隊超過 FLANK_RANGE」，拿一個已經貼在
 *   臉上的分隊當側翼目標，命令會在發出的同一步就被 `flankArrived` 判定
 *   到位（實測 17701 張注入、17700 張立刻解除，飛機一張都沒真的收到）。
 */
function nearestRedFlight(b: Battle, f: number, minDist = 0): number {
  const mine = flightCentroid(b, f)
  if (mine === null) return -1
  let best = -1
  let bestD = Infinity
  for (const g of b.redFlightIndices) {
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
  /** 紅方掉的 hp */
  redDamage: number
  /** 藍方掉的 hp */
  blueDamage: number
}

/**
 * 跑一場 20v20，對第一個非玩家的藍方分隊強制注入戰術。
 *
 * @param kind `'flank'` / `'focus'` / `null`（不注入，當對照）
 */
function observe(kind: 'flank' | 'focus' | null): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    injected: 0, cleared: 0, firingUnderOrder: 0,
    firingWhileDefend: 0, firingWhileRally: 0, samplesUnderOrder: 0,
    groundUnderOrder: 0, belowClearance: 0,
    focusLockSum: 0, focusLockDen: 0, wingmanArmed: 0, wingmanSamples: 0,
    wingmanArmedAll: 0, wingmanSamplesAll: 0,
    aspectSum: 0, aspectCount: 0, aspectSumOwn: 0, aspectCountOwn: 0,
    kills: 0, firingSamples: 0,
    redDamage: 0, blueDamage: 0,
  }
  /** 開場的 hp，用來算全程掉了多少。與 `ai-command-channel.test.ts` 同一個算法 */
  const hp0 = b.world.combatants.map((c) => c.hp)
  const vf = victimFlight(b)
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

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)

    const flight = b.flights.flights[vf]!
    // 【消失了就是被解除了】指揮官不會替一張還在的命令換一張（規劃只在
    // `orders[f] === null` 時跑），所以不同一性只可能來自 stepCommand 的解除
    if (b.blueCommand.orders[vf] !== mine) {
      if (mine !== null && flight.count > 0) { o.cleared++; cooldown = COOLDOWN }
      mine = null
    }
    if (cooldown > 0) cooldown -= DT

    // ── 強制注入 ────────────────────────────────────────
    if (mine === null && cooldown <= 0 && kind !== null && flight.count > 0) {
      const tf = nearestRedFlight(b, vf, kind === 'flank' ? FLANK_RANGE : 0)
      if (tf >= 0) {
        const injected = makeOrder(b, kind, tf)
        if (injected !== null) {
          b.blueCommand.orders[vf] = injected
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
            if (own && b.flights.flightOf[c.index] === vf) {
              o.aspectSumOwn += a
              o.aspectCountOwn++
            }
          }
        }
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

    // 【只量注入的那一張】對照組（kind === null）沒有注入，量指揮官自己的
    const order = kind === null ? (b.blueCommand.orders[vf] ?? null) : mine
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
 * 三場各跑一次，模組層級共用。
 *
 * 【為什麼側翼那一場要給集火的 describe 用】「集火時僚機不能被清掉目標」
 * 唯一有鑑別力的對照就是**同一條路徑上限制有生效的那一種**（側翼）。
 * 兩場都是 20v20、同一個編成、同一個受命分隊，抵銷選擇效應。
 */
const flankRun = observe('flank')
const focusRun = observe('focus')
const controlRun = observe(null)

/** 僚機在命令期間持有目標的比例 */
function wingmanRate(o: Observed): number {
  return o.wingmanArmed / Math.max(o.wingmanSamples, 1)
}

describe('強制注入側翼（20v20、120 秒）', () => {
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

  /** 【途中不交戰】spec §4.4 */
  it('側翼期間受命飛機一槍都不開', () => {
    expect(o.firingUnderOrder).toBe(0)
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
   */
  it('集火期間僚機仍然有目標', () => {
    const onRate = wingmanRate(on)
    const flankRate = wingmanRate(flankRun)
    console.log(JSON.stringify({
      focusRate: onRate.toFixed(3),
      flankRate: flankRate.toFixed(3),
      freeRate: (off.wingmanArmedAll / Math.max(off.wingmanSamplesAll, 1)).toFixed(3),
    }))
    expect(onRate).toBeGreaterThan(flankRate * 10)
  })

  it('集火期間不動用安全層的撞地接管', () => {
    expect(on.groundUnderOrder).toBe(0)
  })
}, 10 * 60 * 1000)

/**
 * 量的地板：側翼那一場的總傷害至少要有對照組的幾成。
 *
 * 【還沒定值 —— 刻意的】2026-08-07 實測：側翼那一場 1736、對照 2764，
 * 比值 **0.628**。這個地板是**護欄不是參數**，要由專案負責人依實測裁定；
 * 在裁定之前不要猜一個數字填進去 —— 那會讓一條護欄看起來有來歷，其實沒有。
 *
 * 第一份 §9.4 已經記過：一條撤退規則就讓總傷害掉 48%，遠高於命令佔時
 * 比例，因為撤離的小隊同時停止挨打與停止輸出。側翼再加一段。
 */
const FLOOR = 0

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
   */
  it('側翼讓開火時的方位角往後側方移動', () => {
    const on = flank.aspectSum / Math.max(flank.aspectCount, 1)
    const base = off.aspectSum / Math.max(off.aspectCount, 1)
    console.log(JSON.stringify({
      flankAspect: on.toFixed(3), offAspect: base.toFixed(3),
      flankOwn: (flank.aspectSumOwn / Math.max(flank.aspectCountOwn, 1)).toFixed(3),
      offOwn: (off.aspectSumOwn / Math.max(off.aspectCountOwn, 1)).toFixed(3),
      nOwn: `${flank.aspectCountOwn} vs ${off.aspectCountOwn}`,
      dmg: `flank R${flank.redDamage.toFixed(0)}:B${flank.blueDamage.toFixed(0)}`
        + ` focus R${focus.redDamage.toFixed(0)}:B${focus.blueDamage.toFixed(0)}`
        + ` off R${off.redDamage.toFixed(0)}:B${off.blueDamage.toFixed(0)}`,
      fire: `${flank.firingSamples}/${focus.firingSamples}/${off.firingSamples}`,
    }))
    expect(on).toBeLessThan(base)
  }, 10 * 60 * 1000)

  /**
   * 【集火的品質】spec §7.3 的第 30 條。集火的整個賣點就是「同一架被多人
   * 咬 → 更快掉下來」；若它沒有變快，這個戰術沒有意義（spec §7.5 的否決
   * 條件之一）。
   */
  it('集火讓每單位開火時間的擊墜上升', () => {
    const on = focus.kills / Math.max(focus.firingSamples, 1)
    const base = off.kills / Math.max(off.firingSamples, 1)
    console.log(JSON.stringify({
      focusKPF: (on * 1e4).toFixed(3), offKPF: (base * 1e4).toFixed(3),
      focusKills: focus.kills, offKills: off.kills,
    }))
    expect(on).toBeGreaterThan(base)
  }, 10 * 60 * 1000)

  /**
   * 【地板未定，所以這一條現在只擋「歸零」】`FLOOR` 是 0 的期間，
   * `on > base * 0` 等於「總傷害不是零」—— 那不是空洞的斷言（歸零代表兩隊
   * 完全停止交戰，是一種真的失敗模式），但它**不是** spec §7.3 要的那條
   * 護欄。定值之後把 `FLOOR` 換掉，這一段註解也要一起改。
   */
  it('總傷害不得崩掉（地板待專案負責人裁定）', () => {
    const on = flank.redDamage + flank.blueDamage
    const base = off.redDamage + off.blueDamage
    console.log(JSON.stringify({
      onTotal: on.toFixed(0), offTotal: base.toFixed(0),
      ratio: (on / Math.max(base, 1)).toFixed(3),
    }))
    expect(on).toBeGreaterThan(base * FLOOR)
  }, 10 * 60 * 1000)
})
