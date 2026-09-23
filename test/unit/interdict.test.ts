import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createMissionState, stepMission, type MissionInputs, type MissionRules,
} from '../../src/battle/mission'
import { conditionMet, type BeatCondition } from '../../src/battle/beats'
import { countArrived, countDestroyed, destroyedInPool } from '../../src/battle/setup'
import { createGroundTarget } from '../../src/world/groundTargets'

/**
 * # 截斷車隊
 *
 * 規則只判敗（卡車抵達、藍隊全滅），摧毀數達標不判勝 —— 勝利由返航節拍轉成的
 * 撤離給。抵達退場的車不算摧毀；節拍條件與抵達數都只數指定的單位。
 */

const RULES: MissionRules = { kind: 'interdict', count: 6, leak: 4, unit: 'truck' }
const DT = 1 / 240

function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
  return {
    aliveBlue: 8, aliveBlueFighters: 8, aliveRed: 0, playerPos: new Vector3(), playerAlive: true,
    convoyAlive: 0, convoyLead: Infinity, convoyArrived: 0, redKilled: 0, redKilledBombers: 0,
    shipsSunk: 0, shipsTotal: 0, targetsDestroyed: 0, targetsTotal: 9, targetsArrived: 0,
    vitalSunk: 0, vitalHp: 1, redInbound: false, ...over,
  }
}

describe('interdict 規則', () => {
  it('抵達數到 leak 判敗', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ targetsArrived: 3 }), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(RULES, inputs({ targetsArrived: 4 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('藍隊全滅判敗', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('摧毀數到 count 不判勝（勝利只來自撤離）', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ targetsDestroyed: 9 }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('計量：還差幾輛、分母是 count、抵達數給目標列', () => {
    const s = createMissionState(RULES)
    expect(s.metric).toBe(6)
    stepMission(RULES, inputs({ targetsDestroyed: 2, targetsArrived: 1 }), DT, s)
    expect(s.metric).toBe(4)
    expect(s.metricTotal).toBe(6)
    expect(s.metricKind).toBe('count')
    expect(s.arrived).toBe(1)
  })
})

describe('destroyed 條件', () => {
  const none = (): number => 0
  it('到 N 才成立', () => {
    const c: BeatCondition = { kind: 'destroyed', atLeast: 6, unit: 'truck' }
    expect(conditionMet(c, 100, none, 0, 5)).toBe(false)
    expect(conditionMet(c, 100, none, 0, 6)).toBe(true)
  })

  it('byLatest 兜底：到了那一秒無條件成立', () => {
    const d: BeatCondition = { kind: 'destroyed', atLeast: 1, byLatest: 90 }
    expect(conditionMet(d, 89, none, 0, 0)).toBe(false)
    expect(conditionMet(d, 90, none, 0, 0)).toBe(true)
  })

  it('沒有 byLatest 就只看摧毀數', () => {
    const d: BeatCondition = { kind: 'destroyed', atLeast: 1 }
    expect(conditionMet(d, 1e6, none, 0, 0)).toBe(false)
  })
})

describe('摧毀與抵達的計數', () => {
  it('抵達退場的車不算摧毀', () => {
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    t.alive = false
    t.arrived = true
    expect(destroyedInPool(t, [])).toBe(false)
  })

  it('摧毀數只數指定單位、只數紅方', () => {
    const a = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 0, 0, 0)
    const c = createGroundTarget(2, 'truck', 'blue', 0, 0, 0)
    for (const t of [a, b, c]) t.alive = false
    expect(countDestroyed([a, b, c], [], 'truck')).toBe(1)
    expect(countDestroyed([a, b, c], [], undefined)).toBe(2)
  })

  it('抵達數只數規則指定的單位', () => {
    const a = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 0, 0, 0)
    for (const t of [a, b]) {
      t.alive = false
      t.arrived = true
    }
    expect(countArrived([a, b], RULES)).toBe(1)
  })
})
