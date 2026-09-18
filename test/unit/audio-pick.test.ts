import { describe, it, expect } from 'vitest'
import { pickNoRepeat, randomRate } from '../../src/audio/pick'

function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('音效庫挑選', () => {
  it('抽到上一次的就換一個', () => {
    // 第一次 0.0 抽到第 0 個（與上一次相同），第二次 0.5 決定往後跳幾個：(0 + 1 + floor(0.5 × 3)) % 4 = 2
    expect(pickNoRepeat(4, 0, seq([0.0, 0.5]))).toBe(2)
  })

  it('只有一個成員時照樣回 0，不會卡住', () => {
    expect(pickNoRepeat(1, 0, seq([0.0]))).toBe(0)
  })

  it('一千次裡沒有連續重複，每個成員都被挑過', () => {
    let last = -1
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const k = pickNoRepeat(5, last, Math.random)
      expect(k).not.toBe(last)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(5)
      seen.add(k)
      last = k
    }
    expect(seen.size).toBe(5)
  })

  it('隨機音高在 ±8%', () => {
    expect(randomRate(() => 0)).toBeCloseTo(0.92)
    expect(randomRate(() => 0.999999)).toBeCloseTo(1.08, 4)
  })
})
