import { describe, expect, it, vi } from 'vitest'
import { createGroundShellPool } from '../../src/render/groundShellPool'

function fixture(small = false, capacity = 2) {
  const flash = { emit: vi.fn() }, dust = { emit: vi.fn() }, impact = vi.fn()
  const pool = createGroundShellPool(capacity, small, flash, dust, impact)
  return { pool, flash, dust, impact }
}

describe('地面戰的視覺彈丸池', () => {
  it('就地推進；長幀之後在目標點落地，而且只落一次', () => {
    const { pool, impact } = fixture()
    const source = pool.source, positions = source.x
    pool.fire(1, 2, 3, 101, 2, 3, 50, true)
    pool.step(0.5)
    expect([source.x[0], source.y[0], source.z[0], source.age[0]]).toEqual([26, 2, 3, 0.5])
    expect(impact).not.toHaveBeenCalled()
    pool.step(5)
    expect(impact.mock.calls).toEqual([[101, 2, 3]])
    expect(source.owner[0]).toBe(-1)
    pool.step(5)
    expect(impact).toHaveBeenCalledTimes(1)
    expect(pool.source).toBe(source)
    expect(pool.source.x).toBe(positions)
    expect([pool.shots, pool.hitShots]).toEqual([1, 1])
  })

  it.each([false, true])('命中與落空各放對應的效果；small=%s', small => {
    const { pool, flash, dust, impact } = fixture(small)
    pool.fire(0, 0, 0, 100, 20, 30, 1000, true)
    pool.fire(0, 0, 0, 200, 40, 60, 1000, false)
    pool.step(1)
    if (small) {
      expect(flash.emit.mock.calls).toEqual([[100, 20, 30, 0, 0, 0, 0.4]])
      expect(impact).not.toHaveBeenCalled()
    } else {
      expect(impact.mock.calls).toEqual([[100, 20, 30]])
      expect(flash.emit).not.toHaveBeenCalled()
    }
    expect(dust.emit.mock.calls).toEqual([[200, 40, 60, 0, small ? 1 : 3, 0, small ? 0.3 : 0.7]])
    expect([pool.shots, pool.hitShots]).toEqual([2, 1])
  })

  it('滿了就覆蓋最舊的一格，緩衝不長大', () => {
    const { pool, impact } = fixture()
    const positions = pool.source.x
    for (const x of [100, 200, 300]) pool.fire(0, 0, 0, x, 0, 0, 1000, true)
    pool.step(1)
    expect(impact.mock.calls).toEqual([[300, 0, 0], [200, 0, 0]])
    expect(pool.source.x).toBe(positions)
    expect(positions).toHaveLength(2)
    expect(pool.shots).toBe(3)
  })

  it('不到 1 m 的射擊忽略；重置清掉飛行中的彈丸與計數，不影響另一個池', () => {
    const a = fixture(), b = fixture()
    a.pool.fire(0, 0, 0, 0.5, 0, 0, 100, true)
    expect(a.pool.shots).toBe(0)
    a.pool.fire(0, 0, 0, 100, 0, 0, 100, true)
    b.pool.fire(0, 0, 0, 200, 0, 0, 100, true)
    const source = a.pool.source
    a.pool.reset()
    expect([a.pool.shots, a.pool.hitShots]).toEqual([0, 0])
    expect(Array.from(source.owner)).toEqual([-1, -1])
    expect(a.pool.source).toBe(source)
    a.pool.step(10)
    expect(a.impact).not.toHaveBeenCalled()
    b.pool.step(10)
    expect(b.impact.mock.calls).toEqual([[200, 0, 0]])
    a.pool.fire(0, 0, 0, 300, 0, 0, 100, true)
    a.pool.step(10)
    expect(a.impact.mock.calls).toEqual([[300, 0, 0]])
    expect(a.pool.shots).toBe(1)
  })
})
