import { describe, it, expect } from 'vitest'
import { G0 } from '../../src/core/math'
import {
  BOMB_MAX_SECONDS, BOMB_TERMINAL_SPEED, bombDragK, stepBomb, solveImpact,
  type BombState, type Impact,
} from '../../src/world/bomb'

const DT = 1 / 240
const SEA = (): number => 0
const state = (o: Partial<BombState>): BombState =>
  ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ...o })
const impact = (): Impact => ({ x: 0, y: 0, z: 0, seconds: 0, speed: 0 })

describe('stepBomb', () => {
  it('無阻力時就是等加速度自由落體', () => {
    const s = state({ y: 1000 })
    for (let i = 0; i < 240; i++) stepBomb(s, 0, DT)
    expect(s.vy).toBeCloseTo(-G0, 6)
    expect(s.y).toBeCloseTo(1000 - G0 / 2, 1)
  })

  it('阻力讓垂直速度收斂到終端速度', () => {
    const s = state({ y: 100000 })
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 120; i++) stepBomb(s, k, DT)
    expect(Math.abs(s.vy)).toBeCloseTo(BOMB_TERMINAL_SPEED, 0)
  })

  it('阻力同時減速水平分量 —— 那就是 trail', () => {
    const s = state({ y: 4000, vz: -90 })
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 10; i++) stepBomb(s, k, DT)
    expect(Math.abs(s.vz)).toBeLessThan(90)
  })
})

describe('solveImpact', () => {
  it('無阻力時對得上解析解 t = √(2h/g)、x = v·t', () => {
    const out = impact()
    const ok = solveImpact(state({ y: 4000, vz: -90 }), 0, SEA, DT, out)
    expect(ok).toBe(true)
    const t = Math.sqrt((2 * 4000) / G0)
    expect(out.seconds).toBeCloseTo(t, 1)
    expect(out.z).toBeCloseTo(-90 * t, 0)
    expect(out.y).toBeCloseTo(0, 6)
  })

  it('有阻力時前拋比真空短 —— 4,000 m 落在 2,100~2,350 m', () => {
    const out = impact()
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    expect(solveImpact(state({ y: 4000, vz: -90 }), k, SEA, DT, out)).toBe(true)
    expect(-out.z).toBeGreaterThan(2100)
    expect(-out.z).toBeLessThan(2350)
    expect(out.seconds).toBeGreaterThan(30)
    expect(out.speed).toBeGreaterThan(200)
  })

  it('爬升中投彈：先上升再落下，不在第一步就終止', () => {
    const out = impact()
    // 起點恰在地面高度上、速度朝上 —— 沒有「先走一步」就會立刻判落地
    const ok = solveImpact(state({ y: 0.5, vy: 60 }), 0, SEA, DT, out)
    expect(ok).toBe(true)
    expect(out.seconds).toBeGreaterThan(10)
  })

  it('落點取的是地形高度，不是海平面', () => {
    const out = impact()
    const hill = (_x: number, z: number): number => (z < -1000 ? 600 : 0)
    expect(solveImpact(state({ y: 4000, vz: -90 }), 0, hill, DT, out)).toBe(true)
    expect(out.y).toBeCloseTo(600, 0)
  })

  it('永遠落不下來就回 false', () => {
    const out = impact()
    // groundAt 恆為 −Infinity —— 這條軌跡碰不到地面
    expect(solveImpact(state({ y: 4000, vz: -90 }), 0, () => -Infinity, DT, out)).toBe(false)
  })

  it('不修改傳進去的起始狀態', () => {
    const s = state({ y: 4000, vz: -90 })
    solveImpact(s, 0, SEA, DT, impact())
    expect(s.y).toBe(4000)
    expect(s.vz).toBe(-90)
    expect(s.vy).toBe(0)
  })

  it('BOMB_MAX_SECONDS 蓋得住 8,000 m —— 量測是 47.9 秒', () => {
    const out = impact()
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    expect(solveImpact(state({ y: 8000, vz: -90 }), k, SEA, DT, out)).toBe(true)
    expect(out.seconds).toBeLessThan(BOMB_MAX_SECONDS)
  })
})
