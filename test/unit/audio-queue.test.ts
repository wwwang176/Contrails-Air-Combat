import { describe, it, expect } from 'vitest'
import { createCueQueue, pushCue, clearCues, CUE } from '../../src/audio/queue'

describe('音效事件佇列', () => {
  it('依序寫入，滿了丟新的、不覆蓋舊的', () => {
    const q = createCueQueue(2)
    pushCue(q, CUE.Explosion, 1, 2, 3)
    pushCue(q, CUE.Splash, 4, 5, 6)
    pushCue(q, CUE.FlakBurst, 7, 8, 9)
    expect(q.count).toBe(2)
    expect([...q.data.slice(0, 8)]).toEqual([CUE.Explosion, 1, 2, 3, CUE.Splash, 4, 5, 6])
    clearCues(q)
    expect(q.count).toBe(0)
  })
})
