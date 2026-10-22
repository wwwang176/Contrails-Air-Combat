import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import type { FlareBeat } from '../../src/battle/beats'
import { FLARE_BURN, FLARE_LANES, FLARE_RELIGHT_DELAY } from '../../src/world/flares'
import { cardWith, KILL_CARD } from '../fixtures/mission'

const IDLE: Controller = { update() {} }
const DT = 1 / 240

const BEAT: FlareBeat = {
  kind: 'flare', when: { kind: 'clock', at: 2 },
  points: [
    { x: -100, z: -7000, altitude: 1200, delay: 0 },
    { x: 100, z: -7000, altitude: 1000, delay: 5 },
    { x: 300, z: -7000, altitude: 1100, delay: 6 },
    { x: 500, z: -7000, altitude: 1300, delay: 0 },
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
    // 每個燈位先點清單的前幾個，其餘留給輪替
    expect(b.world.flares.count).toBe(FLARE_LANES)
    expect(b.world.flares.y[0]).toBeCloseTo(1200, 0)
    // 生成點是卡片給的；`x` 從第一步起就含搖晃
    expect(b.world.flares.ox[1]).toBe(100)
    // 第二枚晚 5 秒：進池了但還沒點燃（年齡是負的）、掛在自己的高度
    expect(b.world.flares.age[1]).toBeLessThan(0)
    expect(b.world.flares.y[1]).toBe(1000)
    expect(b.message).toBeNull()
    expect(b.beatsLeft).toBe(0)
  })

  it('輪替：一枚熄了，隔 FLARE_RELIGHT_DELAY 秒在清單的下一個位置點新的', () => {
    const b = createBattle(IDLE, cfg(), 3)
    for (let i = 0; i < 2.2 * 240; i++) stepBattle(b, DT)
    const pool = b.world.flares
    expect(pool.count).toBe(FLARE_LANES)
    // 把第一枚推到燒完的前一刻
    pool.age[0] = FLARE_BURN - DT / 2
    stepBattle(b, DT)
    expect(pool.live[0]).toBe(0)
    expect(pool.count).toBe(FLARE_LANES - 1)
    const outAt = b.world.time
    // 等重點：時間到之前不點
    while (b.world.time < outAt + FLARE_RELIGHT_DELAY - DT) stepBattle(b, DT)
    expect(pool.count).toBe(FLARE_LANES - 1)
    for (let i = 0; i < 3; i++) stepBattle(b, DT)
    expect(pool.count).toBe(FLARE_LANES)
    // 新的那一枚在清單緊接著燈位的那個位置，從 0 秒起算、沒有延遲
    const next = BEAT.points[FLARE_LANES]!
    let fresh = -1
    for (let i = 0; i < pool.capacity; i++) if (pool.live[i] !== 0 && pool.ox[i] === next.x) fresh = i
    expect(fresh).toBeGreaterThanOrEqual(0)
    expect(pool.age[fresh]).toBeGreaterThanOrEqual(0)
    expect(pool.age[fresh]).toBeLessThan(0.1)
    expect(pool.oy[fresh]).toBe(next.altitude)
  })

  it('再打一場只清池、停輪替 —— 節拍不重播，有節拍的關 main.ts 整個 World 重建', () => {
    // 【與 battle-restart.test.ts 同一條規則】`resetBattle` 不把節拍拉回 waiting
    const b = createBattle(IDLE, cfg(), 3)
    for (let i = 0; i < 2.2 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(FLARE_LANES)
    resetBattle(b)
    expect(b.world.flares.count).toBe(0)
    for (let i = 0; i < 5 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(0)
  })

  /** 【明列透傳】`missionConfigFrom` 不透傳未知欄位，漏抄的症狀是夜襲關一枚照明彈都沒有，而且不報錯 */
  it('卡片帶 flares 就有一個照明彈節拍、點位是卡片上那一份；沒有的卡不產生', () => {
    const flareOf = (c: ReadyMissionCard) =>
      (missionConfigFrom(c).beats ?? []).filter((x): x is FlareBeat => x.kind === 'flare')
    const flares = { when: { kind: 'clock' as const, at: 2 }, points: BEAT.points }
    const synthetic = flareOf(cardWith(KILL_CARD, { flares }))
    expect(synthetic).toHaveLength(1)
    expect(synthetic[0]!.points).toBe(flares.points)
    expect(synthetic[0]!.when).toEqual({ kind: 'clock', at: 2 })
    for (const c of Object.values(MISSIONS).flat()) {
      if (c.battle === null) continue
      const card = c as ReadyMissionCard
      const beats = flareOf(card)
      if (card.battle.flares === undefined) {
        expect(beats, c.id).toEqual([])
      } else {
        expect(beats, c.id).toHaveLength(1)
        expect(beats[0]!.points, c.id).toBe(card.battle.flares.points)
      }
    }
  })
})
