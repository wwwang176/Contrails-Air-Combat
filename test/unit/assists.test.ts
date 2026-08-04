import { describe, it, expect } from 'vitest'
import { ASSIST_WINDOW, assistCredits } from '../../src/world/assists'

/** 造一張 n×n 的表，全部 −Infinity。 */
function table(n: number): Float32Array {
  return new Float32Array(n * n).fill(-Infinity)
}

const OUT: number[] = []

describe('assistCredits（M9 spec §5.2）', () => {
  it('窗口內打過的算助攻', () => {
    const n = 4
    const t = table(n)
    t[1 * n + 3] = 100
    expect(assistCredits(t, n, 3, 2, 105, OUT)).toEqual([1])
  })

  it('兇手不重複拿助攻', () => {
    const n = 4
    const t = table(n)
    t[2 * n + 3] = 100
    t[1 * n + 3] = 100
    expect(assistCredits(t, n, 3, 2, 105, OUT)).toEqual([1])
  })

  it('受害者自己不算', () => {
    // 【為什麼要擋】自傷目前不可能發生（彈丸判定排除自己），但一條
    // 「自己助攻自己」的縫隙不該留著等某天被打開。
    const n = 4
    const t = table(n)
    t[3 * n + 3] = 100
    expect(assistCredits(t, n, 3, 2, 105, OUT)).toEqual([])
  })

  it('從沒打過的不算', () => {
    const n = 4
    expect(assistCredits(table(n), n, 3, 2, 1e6, OUT)).toEqual([])
  })

  it('窗口的兩側：剛好之內算，剛好之外不算', () => {
    const n = 4
    const t = table(n)
    t[0 * n + 3] = 0
    expect(assistCredits(t, n, 3, 2, ASSIST_WINDOW - 0.1, OUT)).toEqual([0])
    expect(assistCredits(t, n, 3, 2, ASSIST_WINDOW + 0.1, OUT)).toEqual([])
  })

  it('多個人各記一次，依座位順序', () => {
    const n = 5
    const t = table(n)
    t[0 * n + 4] = 100
    t[2 * n + 4] = 101
    t[3 * n + 4] = 102
    expect(assistCredits(t, n, 4, 2, 105, OUT)).toEqual([0, 3])
  })

  it('重複呼叫不會累積 —— out 每次先清空', () => {
    const n = 4
    const t = table(n)
    t[1 * n + 3] = 100
    assistCredits(t, n, 3, 2, 105, OUT)
    assistCredits(t, n, 3, 2, 105, OUT)
    expect(OUT).toEqual([1])
  })

  it('窗口是 20 秒', () => {
    expect(ASSIST_WINDOW).toBe(20)
  })
})
