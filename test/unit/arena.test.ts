import { describe, it, expect } from 'vitest'
import {
  arenaKills, createArenaState, stepArena,
  ARENA_CEILING, ARENA_COUNTDOWN, ARENA_MIN_RADIUS, SKIRMISH_ARENA, type ArenaBounds,
} from '../../src/world/arena'

const R = SKIRMISH_ARENA.radius

describe('戰場邊界', () => {
  it('界內什麼都不發生', () => {
    const s = createArenaState()
    stepArena(s, SKIRMISH_ARENA, 0, 4000, 0, 1)
    expect(s.outside).toBe(false)
    expect(s.remaining).toBe(ARENA_COUNTDOWN)
    expect(s.expired).toBe(false)
  })

  /** 【圓柱不是正方體】正方體的角落比面心遠 41%，玩家看到的距離會隨方位跳 */
  it('圓柱 —— 水平距離看的是半徑，不是方框', () => {
    const s = createArenaState()
    // 對角線方向 (0.9R, 0.9R)：方框內，圓外
    stepArena(s, SKIRMISH_ARENA, R * 0.9, 4000, R * 0.9, 0)
    expect(s.outside).toBe(true)
  })

  it('高度也是界的一部分', () => {
    const s = createArenaState()
    stepArena(s, SKIRMISH_ARENA, 0, ARENA_CEILING + 1, 0, 0)
    expect(s.outside).toBe(true)
  })

  it('界外開始倒數', () => {
    const s = createArenaState()
    for (let i = 0; i < 5; i++) stepArena(s, SKIRMISH_ARENA, R + 100, 4000, 0, 1)
    expect(s.remaining).toBeCloseTo(ARENA_COUNTDOWN - 5, 6)
    expect(s.expired).toBe(false)
  })

  it('回到界內就歸零重置', () => {
    const s = createArenaState()
    for (let i = 0; i < 5; i++) stepArena(s, SKIRMISH_ARENA, R + 100, 4000, 0, 1)
    stepArena(s, SKIRMISH_ARENA, 0, 4000, 0, 1)
    expect(s.outside).toBe(false)
    expect(s.remaining).toBe(ARENA_COUNTDOWN)
  })

  it('倒數歸零就 expired，而且之後一直是', () => {
    const s = createArenaState()
    for (let i = 0; i < ARENA_COUNTDOWN + 1; i++) {
      stepArena(s, SKIRMISH_ARENA, R + 100, 4000, 0, 1)
    }
    expect(s.expired).toBe(true)
    expect(s.remaining).toBe(0)
    // 【expired 之後回到界內也不會復活】飛機已經爆了
    stepArena(s, SKIRMISH_ARENA, 0, 4000, 0, 1)
    expect(s.expired).toBe(true)
  })

  it('遭遇戰 12 km 對開場最遠的 5,945 m 有一倍餘裕', () => {
    expect(SKIRMISH_ARENA).toEqual({ x: 0, z: 0, radius: 12000 })
    expect(R).toBeGreaterThan(5945 * 2)
    expect(R).toBeGreaterThanOrEqual(ARENA_MIN_RADIUS)
  })

  /** 任務的界圓心不在原點：距離要量到圓心，不是量到世界原點 */
  it('圓心不在原點：距離量到圓心', () => {
    const b: ArenaBounds = { x: 5000, z: -3000, radius: 10000 }
    const s = createArenaState()
    stepArena(s, b, 5000, 1000, -3000 + 9999, 0)
    expect(s.outside).toBe(false)
    stepArena(s, b, 5000, 1000, -3000 + 10001, 0)
    expect(s.outside).toBe(true)
    // 世界原點離圓心 5.83 km，在界內
    stepArena(s, b, 0, 1000, 0, 0)
    expect(s.outside).toBe(false)
    // 離世界原點只有 6 km，但離圓心 11 km：界外
    stepArena(s, b, -6000, 1000, -3000, 0)
    expect(s.outside).toBe(true)
  })
})

describe('界殺誰', () => {
  const expired = createArenaState()
  for (let i = 0; i < ARENA_COUNTDOWN + 1; i++) {
    stepArena(expired, SKIRMISH_ARENA, R + 100, 4000, 0, 1)
  }

  it('倒數歸零就殺玩家', () => {
    expect(arenaKills(expired, true)).toBe(true)
  })

  /**
   * 【為什麼要有這一條】AI 這一輪沒有絕對的牽引，實測會漂到幾十公里外
   * （`docs/backlog.md` §10.2）。界若對 AI 生效，整隊會在開打前先自爆。
   */
  it('不殺 AI', () => {
    expect(arenaKills(expired, false)).toBe(false)
  })

  it('還沒歸零不殺任何人', () => {
    const s = createArenaState()
    stepArena(s, SKIRMISH_ARENA, R + 100, 4000, 0, 1)
    expect(arenaKills(s, true)).toBe(false)
  })
})
