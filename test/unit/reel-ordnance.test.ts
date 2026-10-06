import { describe, expect, it } from 'vitest'
import { createReelOrdnance } from '../../src/app/reel/reelOrdnance'

describe('reel ordnance pool', () => {
  it('allocates fixed typed-array and vector slots without active projectiles', () => {
    const pool = createReelOrdnance(8)
    expect(pool.active).toHaveLength(8)
    expect(pool.p0).toHaveLength(8)
    expect(pool.v0).toHaveLength(8)
    expect(pool.next).toBe(0)
    expect([...pool.active]).toEqual(new Array(8).fill(0))
    expect(pool.p0[0]).not.toBe(pool.p0[1])
    expect(pool.v0[0]).not.toBe(pool.v0[1])
  })

  it('keeps event metadata isolated per slot', () => {
    const pool = createReelOrdnance(2)
    pool.active[1] = 1
    pool.entry[1] = 0.4
    pool.serial[1] = 9
    expect(pool.active[0]).toBe(0)
    expect(pool.entry[0]).toBe(0)
    expect(pool.serial[0]).toBe(0)
    expect(pool.entry[1]).toBe(0.4)
    expect(pool.serial[1]).toBe(9)
  })
})
