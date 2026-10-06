import { describe, expect, it } from 'vitest'
import { SegmentGaps } from '../tools/segment-gaps'

describe('探針各單位的機動間隔', () => {
  it('交錯結束、交錯再進場時仍寫回各自的紀錄', () => {
    const gaps = new SegmentGaps()
    const a = { gap: Infinity }
    const b = { gap: Infinity }
    gaps.close(0, 10, a)
    gaps.close(1, 12, b)
    gaps.enter(0, 15)
    expect(a.gap).toBe(5)
    expect(b.gap).toBe(Infinity)
    gaps.enter(1, 20)
    expect(a.gap).toBe(5)
    expect(b.gap).toBe(8)
  })

  it('沒有再次進場的單位保留缺值，不被其他單位的週期填入', () => {
    const gaps = new SegmentGaps()
    const retired = { gap: Infinity }
    const first = { gap: Infinity }
    const second = { gap: Infinity }
    gaps.enter(3, 0)
    gaps.close(3, 1, first)
    gaps.close(8, 2, retired)
    gaps.enter(3, 4)
    gaps.close(3, 5, second)
    gaps.enter(3, 10)
    expect(first.gap).toBe(3)
    expect(second.gap).toBe(5)
    expect(retired.gap).toBe(Infinity)
  })

  it('每一段僅由首次再次進場填入，且不同量測互不污染', () => {
    const a = new SegmentGaps()
    const b = new SegmentGaps()
    const segment = { gap: Infinity }
    a.close(0, 1, segment)
    b.enter(0, 2)
    expect(segment.gap).toBe(Infinity)
    a.enter(0, 3)
    a.enter(0, 9)
    expect(segment.gap).toBe(2)
  })
})
