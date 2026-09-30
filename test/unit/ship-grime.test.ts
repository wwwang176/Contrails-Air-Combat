import { describe, expect, it } from 'vitest'
import { grimeStamps } from '../../src/render/shipGrime'
import { shipLiveryRects } from '../../src/render/shipLivery'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'

/**
 * # 船的髒污印子
 *
 * 守的是「蓋在哪」：只在左右舷條、密度照面積、每次載入不同。畫出來的樣子由截圖裁定。
 */

/** 固定的偽亂數 */
function seq(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const L = SHIP_LIVERIES.fletcher!.layout

describe('髒污印子', () => {
  it('每個印子的起點都在左舷條或右舷條內，不落在甲板條與單色區', () => {
    const R = shipLiveryRects(L)
    const stamps = grimeStamps(L, seq(7))
    expect(stamps.length).toBeGreaterThan(0)
    for (const st of stamps) {
      expect([R.port, R.starboard]).toContainEqual(st.strip)
      expect(st.x).toBeGreaterThanOrEqual(st.strip.x)
      expect(st.x).toBeLessThanOrEqual(st.strip.x + st.strip.w)
      expect(st.y).toBeGreaterThanOrEqual(st.strip.y)
      expect(st.y).toBeLessThanOrEqual(st.strip.y + st.strip.h)
      expect(st.alpha).toBeGreaterThan(0)
      expect(st.alpha).toBeLessThan(0.5)
    }
  })

  /** 【密度照面積】Essex 的舷側比 Fletcher 大好幾倍，印子數要跟著多 */
  it('兩舷各一半，數量照舷側面積', () => {
    const R = shipLiveryRects(L)
    const stamps = grimeStamps(L, seq(3))
    const port = stamps.filter((s) => s.strip.y === R.port.y).length
    const stbd = stamps.filter((s) => s.strip.y === R.starboard.y).length
    expect(port).toBe(stbd)
    const big = grimeStamps(SHIP_LIVERIES.essex!.layout, seq(3))
    expect(big.length).toBeGreaterThan(stamps.length * 2)
    for (const k of ['blotch', 'streak', 'speck'] as const) {
      expect(stamps.some((s) => s.kind === k), k).toBe(true)
    }
  })

  /** 【每次載入不同】遊戲傳 Math.random；同一個亂數序列則結果相同 */
  it('亂數不同位置不同，亂數相同結果相同', () => {
    const a = grimeStamps(L, seq(11))
    const b = grimeStamps(L, seq(12))
    const c = grimeStamps(L, seq(11))
    expect(a.map((s) => s.x)).not.toEqual(b.map((s) => s.x))
    expect(a).toEqual(c)
  })
})
