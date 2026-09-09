import { describe, it, expect } from 'vitest'
import { TYPE_SECONDS_PER_CHAR, typedPrefix } from '../../src/hud/typewriter'

describe('typedPrefix', () => {
  /** 第 0 秒就有第一個字：開頭空白一格會閃一下 */
  it('第 0 秒印第一個字，之後每隔一個間隔多一個字', () => {
    const t = '敵機來襲，守住航母'
    expect(typedPrefix(t, 0)).toBe('敵')
    expect(typedPrefix(t, TYPE_SECONDS_PER_CHAR * 3)).toBe('敵機來襲')
    expect(typedPrefix(t, TYPE_SECONDS_PER_CHAR * (t.length - 1))).toBe(t)
    expect(typedPrefix(t, 100)).toBe(t)
  })

  /** 【−1 = 不打字】沒有時鐘的呼叫端整句直接印 */
  it('年齡 −1 印整句', () => {
    expect(typedPrefix('守住艦隊', -1)).toBe('守住艦隊')
  })

  it('空字串恆為空', () => {
    expect(typedPrefix('', 0)).toBe('')
    expect(typedPrefix('', 5)).toBe('')
  })
})
