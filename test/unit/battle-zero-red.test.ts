import { describe, expect, it } from 'vitest'
import {
  createBattle, stepBattle, resetBattle, DEFAULT_BATTLE, type BattleConfig,
} from '../../src/battle/setup'
import { assertOrderOfBattle, lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { Controller } from '../../src/control/Controller'

/**
 * # 零敵機 —— 一場只有藍隊的仗
 *
 * 德 M2 的對手是地面：史實上沒有空中攔截。編組表因此可以沒有紅隊；
 * 「沒有紅隊」是資料寫錯的那一條規則不再成立。
 */
const IDLE: Controller = { update() {} }
const DT = 1 / 240

function blueOnly(): BattleConfig {
  const units = lineAbreast(HEAD_ON, B17G, 4, P51D, 0)
  return {
    ...DEFAULT_BATTLE, units,
    rules: { kind: 'destroy', count: 1 },
    ground: [{ unit: 'truck', team: 'red', x: 0, z: -6000, heading: 0 }],
  }
}

describe('零敵機', () => {
  it('編組表可以只有藍隊', () => {
    expect(() => assertOrderOfBattle(lineAbreast(HEAD_ON, B17G, 4, P51D, 0))).not.toThrow()
  })

  it('建得起來、跑兩秒仍在打、紅方存活恆 0 而不判勝', () => {
    const b = createBattle(IDLE, blueOnly(), 7)
    expect(b.world.combatants.filter((c) => c.team === 'red')).toHaveLength(0)
    for (let i = 0; i < 2 * 240; i++) stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.mission.metric).toBe(1)
  })

  it('再打一場也不炸', () => {
    const b = createBattle(IDLE, blueOnly(), 7)
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(() => resetBattle(b)).not.toThrow()
  })
})
