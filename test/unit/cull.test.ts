import { describe, it, expect } from 'vitest'
import { CullIndex } from '../../src/world/cull'

/** 填入一組 (x, index) 並排序，回傳排序後的 x 序列。 */
function sortedXs(xs: readonly number[]): number[] {
  const c = new CullIndex()
  c.ensure(xs.length)
  c.clear()
  for (let i = 0; i < xs.length; i++) c.add(xs[i]!, 0, 0, 1, i, 0)
  c.sort()
  return Array.from({ length: c.count }, (_, i) => c.x[i]!)
}

describe('CullIndex 的排序不變量', () => {
  it('sort 之後 x 遞增', () => {
    expect(sortedXs([5, -3, 12, 0, 7])).toEqual([-3, 0, 5, 7, 12])
  })

  it('已排好的輸入不被打亂', () => {
    expect(sortedXs([-3, 0, 5, 7, 12])).toEqual([-3, 0, 5, 7, 12])
  })

  it('六個並排陣列一起搬，不會錯位', () => {
    const c = new CullIndex()
    c.ensure(3)
    c.clear()
    // x 故意逆序，讓每一筆都要移動
    c.add(9, 90, 900, 2, 7, 1)
    c.add(5, 50, 500, 3, 8, 0)
    c.add(1, 10, 100, 4, 9, 1)
    c.sort()
    expect(Array.from(c.x.slice(0, 3))).toEqual([1, 5, 9])
    expect(Array.from(c.y.slice(0, 3))).toEqual([10, 50, 90])
    expect(Array.from(c.z.slice(0, 3))).toEqual([100, 500, 900])
    expect(Array.from(c.r2.slice(0, 3))).toEqual([16, 9, 4])
    expect(Array.from(c.index.slice(0, 3))).toEqual([9, 8, 7])
    expect(Array.from(c.team.slice(0, 3))).toEqual([1, 0, 1])
  })
})

describe('CullIndex.rMax', () => {
  it('是所有已加入半徑的最大值', () => {
    const c = new CullIndex()
    c.ensure(3)
    c.clear()
    c.add(0, 0, 0, 4, 0, 0)
    c.add(1, 0, 0, 9, 1, 0)
    c.add(2, 0, 0, 6, 2, 0)
    expect(c.rMax).toBe(9)
  })

  it('clear 之後歸零', () => {
    const c = new CullIndex()
    c.ensure(1)
    c.clear()
    c.add(0, 0, 0, 4, 0, 0)
    c.clear()
    expect(c.rMax).toBe(0)
    expect(c.count).toBe(0)
  })
})

describe('CullIndex.lowerBound', () => {
  const build = (): CullIndex => {
    const c = new CullIndex()
    c.ensure(5)
    c.clear()
    for (const x of [-10, -2, 0, 3, 8]) c.add(x, 0, 0, 1, 0, 0)
    c.sort()
    return c
  }

  it('回傳第一個 x >= value 的槽位', () => {
    const c = build()
    expect(c.lowerBound(-10)).toBe(0)
    expect(c.lowerBound(-9)).toBe(1)
    expect(c.lowerBound(0)).toBe(2)
    expect(c.lowerBound(3.5)).toBe(4)
  })

  it('全部都小於 value 時回傳 count', () => {
    expect(build().lowerBound(100)).toBe(5)
  })

  it('空的索引回傳 0', () => {
    const c = new CullIndex()
    c.clear()
    expect(c.lowerBound(0)).toBe(0)
  })
})

describe('CullIndex.ensure', () => {
  it('容量不足才重新配置；夠用時沿用同一份記憶體', () => {
    const c = new CullIndex(8)
    const before = c.x
    c.ensure(8)
    expect(c.x).toBe(before)
    c.ensure(64)
    expect(c.x).not.toBe(before)
    expect(c.x.length).toBeGreaterThanOrEqual(64)
  })
})
