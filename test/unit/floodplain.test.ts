import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import { createFloodplain } from '../../src/render/floodplain'
import { createFloraBuffer, FLORA_STRIDE, FloraKind } from '../../src/render/flora'
import type { WaterLine } from '../../src/world/river'

/** # 河漫灘（`floodplain.ts`） */

/** 一條東西向、10 km 長的 Luppe，與一條不在表上的小河 */
const line = (name: string, z: number): WaterLine => {
  const points: [number, number][] = []
  for (let x = -5000; x <= 5000; x += 250) points.push([x, z + 80 * Math.sin(x / 700)])
  return { name, points, level: points.map(() => 0), coarse: false }
}
const fp = createFloodplain([line('Luppe', 0), line('Wethau', 4000)])

describe('範圍與覆蓋率', () => {
  it('河漫灘在河的兩側、寬度不超過基準的 1.15 倍；不在表上的河沒有', () => {
    expect(fp.inside(0, 300)).toBe(true)
    expect(fp.inside(0, -300)).toBe(true)
    expect(fp.inside(0, 1200)).toBe(false)
    expect(fp.inside(0, 4000)).toBe(false)
  })

  /** 【河道上不長樹】水面半寬再加一點岸；覆蓋率在範圍外是 0 */
  it('覆蓋率在 0～1、河道上與範圍外是 0、有森林也有草地', () => {
    let forest = 0
    let meadow = 0
    for (let x = -4800; x <= 4800; x += 40) {
      for (let z = -900; z <= 900; z += 40) {
        const c = fp.cover(x, z)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
        if (!fp.inside(x, z)) expect(c).toBe(0)
        else if (c > 0.8) forest++
        else if (c < 0.05) meadow++
      }
    }
    expect(fp.cover(0, 80 * Math.sin(0))).toBe(0)
    expect(forest).toBeGreaterThan(200)
    expect(meadow).toBeGreaterThan(200)
  })
})

describe('河岸林的樹', () => {
  const run = (x0: number, z0: number, x1: number, z1: number): string[] => {
    const buf = createFloraBuffer(20000)
    fp.flora(x0, z0, x1, z1, () => 0, buf)
    expect(buf.dropped).toBe(0)
    const out: string[] = []
    for (let i = 0; i < buf.count; i++) {
      const o = i * FLORA_STRIDE
      out.push(`${buf.data[o]!.toFixed(3)},${buf.data[o + 2]!.toFixed(3)},${buf.kind[i]}`)
    }
    return out.sort()
  }

  /** 【位置只由全域座標決定】位置跟著「現在畫到哪一格」變的話，同一棵樹在相鄰兩格長在兩個地方 */
  it('分割等價：大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const whole = run(-1000, -1000, 1000, 1000)
    const parts: string[] = []
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) parts.push(...run(-1000 + i * 500, -1000 + j * 500, -500 + i * 500, -500 + j * 500))
    }
    expect(parts.sort()).toEqual(whole)
    expect(whole.length).toBeGreaterThan(500)
  })

  it('只長在河漫灘裡，多半是闊葉樹', () => {
    const buf = createFloraBuffer(40000)
    fp.flora(-5000, -2000, 5000, 2000, () => 0, buf)
    let broad = 0
    for (let i = 0; i < buf.count; i++) {
      const o = i * FLORA_STRIDE
      expect(fp.inside(buf.data[o]!, buf.data[o + 2]!)).toBe(true)
      if (buf.kind[i] === FloraKind.BroadTree) broad++
    }
    expect(broad / buf.count).toBeGreaterThan(0.7)
  })
})

describe('地面網格', () => {
  /**
   * 【一格只鋪一次】河沿著好幾段外接盒走，相鄰兩段的盒子重疊；重疊的細格鋪兩次
   * 是兩片共面的三角形
   */
  it('沒有兩個三角形落在同一個位置', () => {
    const mesh = fp.buildGround(() => 0, 22000)
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute
    const idx = mesh.geometry.getIndex()!
    const seen = new Set<string>()
    for (let t = 0; t < idx.count; t += 3) {
      let x = 0
      let z = 0
      for (let k = 0; k < 3; k++) {
        x += pos.getX(idx.getX(t + k)) / 3
        z += pos.getZ(idx.getX(t + k)) / 3
      }
      const key = `${x.toFixed(2)},${z.toFixed(2)}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBeGreaterThan(10_000)
    mesh.geometry.dispose()
  })
})
