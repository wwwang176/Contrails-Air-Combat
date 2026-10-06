import { describe, expect, it } from 'vitest'
import { createPerfSamples } from '../../src/core/perfSamples'

describe('效能取樣', () => {
  it('幀率使用 rAF 間隔，與 CPU 時間分開', () => {
    const s = createPerfSamples()
    expect(s.fps()).toBe(0)
    expect(s.recordInterval(0)).toBe(false)
    expect(s.recordInterval(20)).toBe(true)
    s.recordFrame(2, 0.5)
    expect(s.fps()).toBe(50)
    expect(s.frameMs()).toBe(2)
    expect(s.physicsMs()).toBe(0.5)
  })

  it('跳過背景長間隔、重複及倒退的時間戳，仍接續下一個有效間隔', () => {
    const s = createPerfSamples()
    s.recordInterval(0)
    s.recordInterval(20)
    expect(s.recordInterval(2020)).toBe(false)
    expect(s.recordInterval(2020)).toBe(false)
    expect(s.recordInterval(2010)).toBe(false)
    expect(s.recordInterval(2030)).toBe(true)
    expect(s.fps()).toBe(50)
    s.recordFrame(4, 1)
    expect(s.frameMs()).toBe(4)
  })

  it('兩組環形緩衝分別保留最近 60 筆有效資料', () => {
    const s = createPerfSamples()
    s.recordInterval(0)
    s.recordInterval(100)
    s.recordFrame(100, 50)
    for (let i = 1; i <= 60; i++) {
      s.recordInterval(100 + i * 10)
      s.recordFrame(2, 0.5)
    }
    expect(s.fps()).toBe(100)
    expect(s.frameMs()).toBe(2)
    expect(s.physicsMs()).toBe(0.5)
    expect(createPerfSamples().fps()).toBe(0)
  })
})
