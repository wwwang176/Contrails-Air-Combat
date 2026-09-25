import { describe, it, expect, beforeAll } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { recoveryClearance } from '../../src/ai/safety'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/**
 * 指揮層的命令通道：命令發得出去、到得了、途中不把飛機送進安全層的硬限制，
 * 而且關掉那一路時真的沒有命令流到戰機端。
 *
 * 這裡只驗機制，不問命令讓仗打得好不好。
 */

const DT = 1 / 240
/**
 * 接敵約在開場 60 秒，命令幾乎都發在接敵之後。窗口太短的話量到的大半是
 * 開場巡航，發令與到達的張數都會太少。
 */
const SECONDS = 300

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

interface Observed {
  /** 新發出的命令張數 */
  issued: number
  /** 命令解除、而且分隊還有人活著的張數（因到達而解除，不是全滅） */
  arrived: number
  /** 命令期間，安全層的撞地接管取樣數 */
  groundUnderOrder: number
  /** 任何飛機掉到安全層 clearance 以下的取樣數 */
  belowClearance: number
  /** 有命令的（飛機 × 取樣）數 */
  orderedSamples: number
}

/**
 * 跑一場 20v20 並收集觀測值。
 *
 * @param commanders `false` = 關掉指揮層：每步把命令清乾淨。**不改生產程式碼**，
 *   兩邊跑的是同一份程式，差別只有命令有沒有傳到戰機端。
 */
function observe(commanders = true): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    issued: 0, arrived: 0, groundUnderOrder: 0, belowClearance: 0, orderedSamples: 0,
  }
  // 上一格每個分隊有沒有命令，用來數「新發出」與「解除」
  const had = new Array<boolean>(b.flights.flights.length).fill(false)

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)

    if (!commanders) {
      b.blueCommand.orders.fill(null)
      b.redCommand.orders.fill(null)
      for (const c of b.world.combatants) {
        const ai = c.controller
        if (ai instanceof AiController) ai.order = null
      }
    }

    for (let f = 0; f < b.flights.flights.length; f++) {
      const flight = b.flights.flights[f]!
      const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
      const now = (state.orders[f] ?? null) !== null
      if (now && !had[f]) o.issued++
      if (!now && had[f] && flight.count > 0) o.arrived++
      had[f] = now
    }

    for (const c of b.world.combatants) {
      if (!c.alive) continue
      if (c.aircraft.state.position.y < recoveryClearance(c.aircraft.spec)) o.belowClearance++
      const ai = c.controller
      if (!(ai instanceof AiController) || ai.order === null) continue
      o.orderedSamples++
      if (ai.safetyAction === 'ground') o.groundUnderOrder++
    }
  }
  return o
}

describe('指令通道（20v20、300 秒）', () => {
  // 【模擬放 beforeAll，不放 describe 本體】放本體會在收集階段就跑，
  // reporter 記不到它的時間，而且 `.skip` 與 `-t` 過濾都擋不住它
  let o: Observed
  beforeAll(() => { o = observe() }, 10 * 60 * 1000)

  /**
   * 【場景要成立】指揮層若一次都沒發過命令，下面每一條都會空洞地通過。
   */
  it('指揮層真的發過命令', () => {
    expect(o.issued).toBeGreaterThan(0)
  })

  /**
   * 【命令要到得了】發出去卻永遠到不了的命令，等於把小隊永久移出戰場。
   *
   * 取多數而不是 `> 0`：把僚機的「停止出擊」限制關掉（`AiController` 裡那
   * 一行）時，僚機繼續纏鬥、小隊質心走不到集合點，只有少數命令到得了，
   * 而 `> 0` 對那個壞掉的版本照樣是綠的。
   */
  it('多數命令會因為到達而解除，不是只會累積', () => {
    expect(o.arrived).toBeGreaterThan(o.issued / 2)
  })

  /**
   * 【安全層不豁免】命令期間撞地接管必須是 0 —— 政策層把飛機送進硬限制的
   * 作用區就是設計失敗。
   */
  it('命令期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })
}, 10 * 60 * 1000)

describe('關掉指揮層（20v20、300 秒）', () => {
  let off: Observed
  beforeAll(() => { off = observe(false) }, 10 * 60 * 1000)

  /**
   * 【關掉之後真的沒有命令流到戰機端】`issued` 數的是 `CommandState.orders`，
   * 關掉的那一路每步清空，所以它與受命取樣數都應該恆為 0。
   */
  it('關掉的那一路真的沒有命令', () => {
    expect(off.issued).toBe(0)
    expect(off.orderedSamples).toBe(0)
  }, 10 * 60 * 1000)
})
