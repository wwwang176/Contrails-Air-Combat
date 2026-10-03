import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { FIELD_COLORS, FLORA_COLORS, PALETTE_STEPS, SEASONS } from '../../src/render/season'
import { FIELD_GLSL, fieldGlsl, fieldSurfaceColor } from '../../src/render/fields'
import {
  createFloraGeometries, disposeFloraGeometries, pointColorOf,
} from '../../src/render/floraShapes'

describe('冬季草原', () => {
  it('勒熱夫的冬季是草原格局的季節；夏季麥田已經刪除', () => {
    expect(SEASONS).toContain('winterSteppe')
    expect(SEASONS as readonly string[]).not.toContain('julyWheat')
    expect(FIELD_COLORS.winterSteppe.layout).toBe('steppe')
    expect(FIELD_COLORS.winterSteppe.hedgeChance).toBe(0)
  })

  it('田是雪：作物色盤每一階都夠亮、低彩度，越往後只暗不亮，而且頭尾差得開', () => {
    const c = new Color()
    let prev = Infinity
    let first = 0
    let last = 0
    for (const hex of FIELD_COLORS.winterSteppe.palette) {
      c.setHex(hex)
      const hsl = { h: 0, s: 0, l: 0 }
      c.getHSL(hsl)
      if (prev === Infinity) first = hsl.l
      last = hsl.l
      // 亮度是 three 的線性工作空間值，sRGB 的淡灰藍（0xb2bdc8）約 0.51
      expect(hsl.l, hex.toString(16)).toBeGreaterThan(0.45)
      expect(hsl.s, hex.toString(16)).toBeLessThan(0.3)
      expect(hsl.l).toBeLessThanOrEqual(prev + 1e-9)
      prev = hsl.l
    }
    // 頭尾差一大截，從高空看每塊田才分得開
    expect(first - last).toBeGreaterThan(0.3)
  })

  it('樹覆著雪：闊葉、灌木、針葉的亮度都高於夏季', () => {
    const lum = (hex: number): number => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l
    for (const k of ['broadLeaf', 'bushLeaf', 'conifer'] as const) {
      expect(lum(FLORA_COLORS.winterSteppe[k]), k).toBeGreaterThan(lum(FLORA_COLORS.summer[k]) + 0.3)
    }
  })
})

describe('季節', () => {
  it('每個季節都有完整的查表，色盤恰好 PALETTE_STEPS 階', () => {
    for (const s of SEASONS) {
      expect(FIELD_COLORS[s].palette, s).toHaveLength(PALETTE_STEPS)
      expect(FLORA_COLORS[s].broadLeaf, s).toBeGreaterThan(0)
    }
  })

  it('夏季的 GLSL 就是 FIELD_GLSL；晚秋的不同，而且含晚秋的犁田色', () => {
    expect(fieldGlsl('summer')).toBe(FIELD_GLSL)
    const autumn = fieldGlsl('lateAutumn')
    expect(autumn).not.toBe(FIELD_GLSL)
    const c = new Color().setHex(FIELD_COLORS.lateAutumn.ploughed)
    expect(autumn).toContain(`vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`)
    expect(autumn).toContain(`PLOUGH_CHANCE = ${FIELD_COLORS.lateAutumn.ploughChance.toFixed(3)}`)
  })

  it('晚秋的地色與夏季不同、犁田比例更高，圖案（凹路的位置）相同', () => {
    const a = new Color()
    const b = new Color()
    let differ = 0
    let tracksAgree = 0
    for (let i = 0; i < 40; i++) {
      const x = i * 137.3 - 2700
      const z = i * 91.7 - 1800
      fieldSurfaceColor(x, z, a)
      fieldSurfaceColor(x, z, b, 'lateAutumn')
      if (a.getHex() !== b.getHex()) differ++
      const aTrack = a.getHex() === FIELD_COLORS.summer.track
      const bTrack = b.getHex() === FIELD_COLORS.lateAutumn.track
      if (aTrack === bTrack) tracksAgree++
    }
    expect(differ).toBe(40)
    expect(tracksAgree).toBe(40)
    expect(FIELD_COLORS.lateAutumn.ploughChance).toBeGreaterThan(FIELD_COLORS.summer.ploughChance)
  })

  it('晚秋的每一個色值都與夏季不同，而且都進了 GLSL', () => {
    const s = FIELD_COLORS.summer
    const w = FIELD_COLORS.lateAutumn
    const autumn = fieldGlsl('lateAutumn')
    const vec = (hex: number): string => {
      const c = new Color().setHex(hex)
      return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
    }
    for (const k of ['ploughed', 'hedge', 'track', 'wood'] as const) {
      expect(w[k], k).not.toBe(s[k])
      expect(autumn, k).toContain(vec(w[k]))
    }
    for (let i = 0; i < PALETTE_STEPS; i++) {
      expect(w.palette[i], `palette ${i}`).not.toBe(s.palette[i])
      expect(autumn).toContain(vec(w.palette[i]!))
    }
    for (const k of ['broadLeaf', 'conifer', 'bushLeaf'] as const) {
      expect(FLORA_COLORS.lateAutumn[k], k).not.toBe(FLORA_COLORS.summer[k])
    }
  })

  it('晚秋的闊葉樹冠換色、房子不變；點池的色跟著換', () => {
    const s = createFloraGeometries('summer')
    const w = createFloraGeometries('lateAutumn')
    const col = (g: typeof s, k: keyof typeof s): number[] =>
      Array.from(g[k].getAttribute('color').array as Float32Array)
    expect(col(w, 'broadMid')).not.toEqual(col(s, 'broadMid'))
    expect(col(w, 'house')).toEqual(col(s, 'house'))
    expect(col(w, 'church')).toEqual(col(s, 'church'))
    expect(pointColorOf('broadPoint', 'lateAutumn')).toBe(FLORA_COLORS.lateAutumn.broadLeaf)
    expect(pointColorOf('broadPoint', 'summer')).toBe(FLORA_COLORS.summer.broadLeaf)
    disposeFloraGeometries(s)
    disposeFloraGeometries(w)
  })
})
