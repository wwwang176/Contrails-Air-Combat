import { describe, expect, it } from 'vitest'
import {
  bakeKeepOut, COVER_EDGE, COVER_IN, COVER_OUT, corridorZone, excludingZones, MASK_CELL, unionCover,
  type KeepOutZone,
} from '../../src/render/keepOutMask'
import type { FloraSource } from '../../src/render/flora'

/**
 * # 不長樹的範圍與遮罩（`keepOutMask.ts`）
 *
 * 地圖列出它的範圍，載入時合成遮罩。遮罩只能省時間，不能改結果：與逐點算的聯集
 * 逐點相同。洛伊納的實際範圍在 `leuna-features.test.ts` 驗
 */

/** 圓：中心、半徑。分類用格心到圓心的距離 */
function circle(cx: number, cz: number, r: number, withCover: boolean): KeepOutZone {
  const test = (x: number, z: number): boolean => Math.hypot(x - cx, z - cz) < r
  return {
    test,
    near: (x0, z0, x1, z1) => Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(z0 - cz, 0, cz - z1)) < r,
    ...(withCover ? {
      cover: (x: number, z: number, hd: number) => {
        const d = Math.hypot(x - cx, z - cz)
        return d + hd < r ? COVER_IN : d - hd >= r ? COVER_OUT : COVER_EDGE
      },
    } : {}),
  }
}

describe('遮罩', () => {
  it('沒有範圍：什麼都不擋，包了也是原樣', () => {
    const k = bakeKeepOut([], 1000)
    expect(k.empty).toBe(true)
    expect(k.test(0, 0)).toBe(false)
    const src: FloraSource = () => {}
    expect(excludingZones(src, k)).toBe(src)
  })

  it('有分類、沒分類（只由 near 推）的範圍混著：與逐點算的聯集逐點相同', () => {
    const zones = [circle(300, -200, 450, true), circle(-900, 700, 260, false), circle(1500, 1500, 90, true)]
    const k = bakeKeepOut(zones, 2000)
    let inside = 0
    // 格線上、格線旁與範圍外（2000 m 外逐點算）都掃
    for (let x = -2600; x <= 2600; x += MASK_CELL / 3) {
      for (let z = -2600; z <= 2600; z += MASK_CELL / 3 + 1) {
        const want = zones.some((zn) => zn.test(x, z))
        if (k.test(x, z) !== want) expect.fail(`(${x}, ${z})：應為 ${want}`)
        if (want) inside++
      }
    }
    expect(inside).toBeGreaterThan(1000)
    expect(k.near(-2000, -2000, -1900, -1900)).toBe(false)
    expect(k.near(250, -250, 350, -150)).toBe(true)
  })

  it('聯集：任一個整格在裡面就是裡面，全部在外面才是外面', () => {
    const c = (v: number) => () => v
    expect(unionCover([c(COVER_OUT), c(COVER_IN)])(0, 0, 1)).toBe(COVER_IN)
    expect(unionCover([c(COVER_OUT), c(COVER_EDGE)])(0, 0, 1)).toBe(COVER_EDGE)
    expect(unionCover([c(COVER_OUT), c(COVER_OUT)])(0, 0, 1)).toBe(COVER_OUT)
  })

  it('折線的範圍：分類與逐點算相同', () => {
    const lines = [{ name: 't', points: [[-800, -300], [0, 100], [900, -50]] as [number, number][], level: [0, 0, 0], coarse: false }]
    const zone = corridorZone(lines, 60)
    const k = bakeKeepOut([zone], 1500)
    let inside = 0
    for (let x = -1200; x <= 1200; x += 7) {
      for (let z = -700; z <= 500; z += 7) {
        const want = zone.test(x, z)
        if (k.test(x, z) !== want) expect.fail(`(${x}, ${z})：應為 ${want}`)
        if (want) inside++
      }
    }
    expect(inside).toBeGreaterThan(1000)
  })
})
