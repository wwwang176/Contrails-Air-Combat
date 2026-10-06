import { describe, expect, it } from 'vitest'
import { createReelOrdnance } from '../../src/app/reel/reelOrdnance'

describe('短片的彈藥池', () => {
  it('開場配好固定數量的型別陣列與向量槽，一開始沒有飛行中的彈藥', () => {
    const pool = createReelOrdnance(8)
    expect(pool.active).toHaveLength(8)
    expect(pool.p0).toHaveLength(8)
    expect(pool.v0).toHaveLength(8)
    expect(pool.next).toBe(0)
    expect([...pool.active]).toEqual(new Array(8).fill(0))
    expect(pool.p0[0]).not.toBe(pool.p0[1])
    expect(pool.v0[0]).not.toBe(pool.v0[1])
  })

  it('每一槽的事件資料各自獨立', () => {
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
