import { describe, it, expect } from 'vitest'
import { LAYER_DB, layerDelay, pickNoRepeat, randomRate } from '../../src/audio/pick'

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

  /** 【疊第二層】小 6 dB 當陪襯、晚 0–30 ms，兩個聲音才融成一團而不是兩次爆炸 */
  it('第二層小 6 dB、延遲 0–30 ms', () => {
    expect(LAYER_DB).toBe(-6)
    expect(layerDelay(() => 0)).toBe(0)
    expect(layerDelay(() => 0.999999)).toBeCloseTo(0.03, 5)
  })

  it('第二層與第一層不同', () => {
    for (let i = 0; i < 200; i++) {
      const first = pickNoRepeat(5, -1, Math.random)
      expect(pickNoRepeat(5, first, Math.random)).not.toBe(first)
    }
  })

  it('隨機音高在 ±8%', () => {
    expect(randomRate(() => 0)).toBeCloseTo(0.92)
    expect(randomRate(() => 0.999999)).toBeCloseTo(1.08, 4)
  })
})
