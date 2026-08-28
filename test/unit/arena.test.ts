import { describe, it, expect } from 'vitest'
import {
  arenaKills, createArenaState, stepArena,
  ARENA_CEILING, ARENA_COUNTDOWN, ARENA_RADIUS,
} from '../../src/world/arena'

describe('戰場邊界', () => {
  it('界內什麼都不發生', () => {
    const s = createArenaState()
    stepArena(s, 0, 4000, 0, 1)
    expect(s.outside).toBe(false)
    expect(s.remaining).toBe(ARENA_COUNTDOWN)
    expect(s.expired).toBe(false)
  })

  /** 【圓柱不是正方體】正方體的角落比面心遠 41%，玩家看到的距離會隨方位跳 */
  it('圓柱 —— 水平距離看的是半徑，不是方框', () => {
    const s = createArenaState()
    // 對角線方向 (0.9R, 0.9R)：方框內，圓外
    stepArena(s, ARENA_RADIUS * 0.9, 4000, ARENA_RADIUS * 0.9, 0)
    expect(s.outside).toBe(true)
  })

  it('高度也是界的一部分', () => {
    const s = createArenaState()
    stepArena(s, 0, ARENA_CEILING + 1, 0, 0)
    expect(s.outside).toBe(true)
  })

  it('界外開始倒數', () => {
    const s = createArenaState()
    for (let i = 0; i < 5; i++) stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    expect(s.remaining).toBeCloseTo(ARENA_COUNTDOWN - 5, 6)
    expect(s.expired).toBe(false)
  })

  it('回到界內就歸零重置', () => {
    const s = createArenaState()
    for (let i = 0; i < 5; i++) stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    stepArena(s, 0, 4000, 0, 1)
    expect(s.outside).toBe(false)
    expect(s.remaining).toBe(ARENA_COUNTDOWN)
  })

  it('倒數歸零就 expired，而且之後一直是', () => {
    const s = createArenaState()
    for (let i = 0; i < ARENA_COUNTDOWN + 1; i++) {
      stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    }
    expect(s.expired).toBe(true)
    expect(s.remaining).toBe(0)
    // 【expired 之後回到界內也不會復活】飛機已經爆了
    stepArena(s, 0, 4000, 0, 1)
    expect(s.expired).toBe(true)
  })

  it('12 km 對開場最遠的 5,945 m 有一倍餘裕', () => {
    expect(ARENA_RADIUS).toBeGreaterThan(5945 * 2)
  })
})

describe('界殺誰', () => {
  const expired = createArenaState()
  for (let i = 0; i < ARENA_COUNTDOWN + 1; i++) {
    stepArena(expired, ARENA_RADIUS + 100, 4000, 0, 1)
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
    stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    expect(arenaKills(s, true)).toBe(false)
  })
})
