import { describe, it, expect } from 'vitest'
import { createBursts, pushBurst } from '../../src/world/flak'
import { FLAK_PUFFS, emitFlakBursts, resetFlakBurstSeed } from '../../src/render/flakBursts'

/** 收下每一顆粒子的出生位置。`Particles` 本身不對外開放，所以用假的池。 */
function spy(): { emit: (x: number, y: number, z: number, vx: number, vy: number, vz: number) => void; pts: number[][] } {
  const pts: number[][] = []
  return { emit: (x, y, z, vx, vy, vz) => { pts.push([x, y, z, vx, vy, vz]) }, pts }
}

describe('emitFlakBursts', () => {
  /**
   * 【每一朵雲的形狀要不一樣】種子原本是「事件在這一幀的序號」，而大部分幀
   * 只有一次引爆 —— 序號恆為 0，於是每一朵孤立的雲都用同一組九個方向，
   * **長得一模一樣**。四秒的雲、每秒四朵，那種重複看得出來。
   */
  it('連續兩朵孤立的雲，粒子方向不同', () => {
    resetFlakBurstSeed()
    const a = spy()
    const b = spy()
    const e1 = createBursts()
    pushBurst(e1, 0, 1000, 0, 1)
    emitFlakBursts(a as never, e1)
    const e2 = createBursts()
    pushBurst(e2, 0, 1000, 0, 1)
    emitFlakBursts(b as never, e2)

    expect(a.pts.length).toBe(FLAK_PUFFS)
    expect(b.pts.length).toBe(FLAK_PUFFS)
    expect(JSON.stringify(a.pts)).not.toBe(JSON.stringify(b.pts))
  })

  /** 【但要可重現】重設種子之後，同一朵雲必須逐位元相同 —— 不能改用亂數。 */
  it('重設種子之後完全可重現', () => {
    resetFlakBurstSeed()
    const a = spy()
    const e1 = createBursts()
    pushBurst(e1, 0, 1000, 0, 1)
    emitFlakBursts(a as never, e1)

    resetFlakBurstSeed()
    const b = spy()
    const e2 = createBursts()
    pushBurst(e2, 0, 1000, 0, 1)
    emitFlakBursts(b as never, e2)

    expect(JSON.stringify(a.pts)).toBe(JSON.stringify(b.pts))
  })

  it('粒子撒在爆心附近，不是全部疊在同一點', () => {
    resetFlakBurstSeed()
    const a = spy()
    const e = createBursts()
    pushBurst(e, 100, 1000, -50, 1)
    emitFlakBursts(a as never, e)
    const xs = new Set(a.pts.map((p) => p[0]!.toFixed(3)))
    expect(xs.size).toBeGreaterThan(1)
    for (const p of a.pts) {
      expect(Math.hypot(p[0]! - 100, p[1]! - 1000, p[2]! + 50)).toBeLessThan(20)
    }
  })

})
