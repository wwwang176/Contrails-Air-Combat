import { describe, it, expect } from 'vitest'
import { createCueQueue, pushCue, clearCues, CUE, CUE_STRIDE } from '../../src/audio/queue'

describe('音效事件佇列', () => {
  it('依序寫入，滿了丟新的、不覆蓋舊的', () => {
    const q = createCueQueue(2)
    pushCue(q, CUE.Explosion, 1, 2, 3, 1.5)
    pushCue(q, CUE.Splash, 4, 5, 6)
    pushCue(q, CUE.FlakBurst, 7, 8, 9)
    expect(q.count).toBe(2)
    expect([...q.data.slice(0, 2 * CUE_STRIDE)])
      .toEqual([CUE.Explosion, 1, 2, 3, 1.5, CUE.Splash, 4, 5, 6, 1])
    clearCues(q)
    expect(q.count).toBe(0)
  })

  /** 【沒有當量可言的事件用 1】擊墜、空爆不該因為忘了帶參數就變安靜 */
  it('當量預設是 1', () => {
    const q = createCueQueue(1)
    pushCue(q, CUE.FlakBurst, 0, 0, 0)
    expect(q.data[4]).toBe(1)
  })
})
