import { describe, it, expect } from 'vitest'
import { createBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { BattleConfig } from '../../src/battle/setup'

/**
 * # `BattleConfig.reserve` —— 建構期就把增援的容量配好
 *
 * 依架數的 typed array **中途重配不安全**：`World.killEvents` 會被換成空的、
 * `damageTime` 會被整張抹掉，而 `TargetBoard` 的三個陣列一換參考，
 * `readonly` 這道護欄就沒了。
 *
 * 波次是有限的、寫在任務卡上，所以最終架數在 `createBattle` 就算得出來。
 *
 * 【一個順帶的好處】預留的分隊在建構期就存在，所以四份依**分隊**的東西
 * 全部自動含到它：兩隊的指揮官狀態、兩隊的分隊索引清單、下令清單、
 * `convoyOrders`。它們讀的都是 `flights.flights`。
 */

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

/** 4 藍 4 紅的小場，可選預留 */
function battle(reserve?: BattleConfig['reserve']) {
  const cfg: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    ...(reserve === undefined ? {} : { reserve }),
  }
  return createBattle(new Idle(), cfg, 20260901)
}

describe('BattleConfig.reserve', () => {
  it('沒有預留時，容量等於開局架數', () => {
    const b = battle()
    expect(b.world.combatants).toHaveLength(8)
    expect(b.world.damageStride).toBe(8)
    expect(b.board.assignments.length).toBe(8)
    expect(b.flights.flights).toHaveLength(2)
  })

  it('預留之後，依架數的容器照最終架數配', () => {
    const b = battle([{ team: 'red', count: 4 }])
    expect(b.world.combatants).toHaveLength(8)
    expect(b.world.damageStride).toBe(12)
    expect(b.world.damageTime.length).toBe(144)
    expect(b.board.assignments.length).toBe(12)
    expect(b.board.priority.length).toBe(12)
    expect(b.board.protectedMask.length).toBe(12)
    expect(b.flights.flightOf.length).toBe(12)
  })

  it('預留的分隊建好了、是空的、而且在對的隊伍', () => {
    const b = battle([{ team: 'red', count: 4 }])
    expect(b.flights.flights).toHaveLength(3)
    const reserved = b.flights.flights[2]!
    expect(reserved.team).toBe('red')
    expect(reserved.count).toBe(0)
    expect(reserved.roster).toEqual([8, 9, 10, 11])
  })

  it('四份依分隊的東西自動含到預留的那一隊', () => {
    // 【這一條擋的是「指揮層對新分隊靜默無效」】漏掉任何一份都不會報錯
    const b = battle([{ team: 'red', count: 4 }])
    expect(b.blueCommand.spent.length).toBe(3)
    expect(b.redCommand.spent.length).toBe(3)
    expect(b.redFlightIndices).toContain(2)
    expect(b.blueFlightIndices).not.toContain(2)
    expect(b.redOrderFlights).toContain(2)
  })

  it('預留的座位在指派板上是中性的', () => {
    const b = battle([{ team: 'red', count: 4 }])
    for (let i = 8; i < 12; i++) {
      expect(b.board.assignments[i]).toBe(-1)
      expect(b.board.priority[i]).toBe(1)
      expect(b.board.protectedMask[i]).toBe(0)
    }
  })

  it('架數為 0 或負數的預留是錯的', () => {
    expect(() => battle([{ team: 'red', count: 0 }])).toThrow()
    expect(() => battle([{ team: 'red', count: -1 }])).toThrow()
  })

  it('空陣列與省略等價', () => {
    const a = battle([])
    const b = battle()
    expect(a.world.damageStride).toBe(b.world.damageStride)
    expect(a.flights.flights.length).toBe(b.flights.flights.length)
  })
})
