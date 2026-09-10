import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import type { FlareBeat } from '../../src/battle/beats'

const IDLE: Controller = { update() {} }
const DT = 1 / 240

const BEAT: FlareBeat = {
  kind: 'flare', when: { kind: 'clock', at: 2 },
  points: [
    { x: -100, z: -7000, altitude: 1200, delay: 0 },
    { x: 100, z: -7000, altitude: 1000, delay: 5 },
  ],
}

function cfg(): BattleConfig {
  return {
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, B17G, 1, P51D, 1), beats: [BEAT],
  }
}

describe('照明彈節拍', () => {
  it('時鐘到了在每一個點上生一枚、不預警、不顯示訊息', () => {
    const b = createBattle(IDLE, cfg(), 3)
    for (let i = 0; i < 1.9 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(0)
    for (let i = 0; i < 0.2 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(2)
    expect(b.world.flares.y[0]).toBeCloseTo(1200, 0)
    // 生成點是卡片給的；`x` 從第一步起就含搖晃
    expect(b.world.flares.ox[1]).toBe(100)
    // 第二枚晚 5 秒：進池了但還沒點燃（年齡是負的）、掛在自己的高度
    expect(b.world.flares.age[1]).toBeLessThan(0)
    expect(b.world.flares.y[1]).toBe(1000)
    expect(b.message).toBe('')
    expect(b.beatsLeft).toBe(0)
  })

  it('再打一場只清池 —— 節拍不重播，有節拍的關 main.ts 整個 World 重建', () => {
    // 【與 battle-restart.test.ts 同一條規則】`resetBattle` 不把節拍拉回 waiting
    const b = createBattle(IDLE, cfg(), 3)
    for (let i = 0; i < 2.2 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(2)
    resetBattle(b)
    expect(b.world.flares.count).toBe(0)
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(0)
  })

  it('德 M2 的卡帶三枚照明彈，沒有 flares 的卡不產生節拍', () => {
    const m2 = MISSIONS.germany.find((m) => m.id === 'germany-m2') as ReadyMissionCard
    const beats = missionConfigFrom(m2).beats ?? []
    const flare = beats.filter((x) => x.kind === 'flare')
    expect(flare).toHaveLength(1)
    expect((flare[0] as FlareBeat).points).toHaveLength(3)
    const m1 = MISSIONS.germany.find((m) => m.id === 'germany-m1') as ReadyMissionCard
    expect((missionConfigFrom(m1).beats ?? []).some((x) => x.kind === 'flare')).toBe(false)
  })
})
