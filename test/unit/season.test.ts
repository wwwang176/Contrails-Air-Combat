import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { FIELD_COLORS, FLORA_COLORS, PALETTE_STEPS, SEASONS } from '../../src/render/season'
import { FIELD_GLSL, fieldGlsl, fieldSurfaceColor } from '../../src/render/fields'
import {
  createFloraGeometries, disposeFloraGeometries, pointColorOf,
} from '../../src/render/floraShapes'

describe('季節', () => {
  it('兩個季節都有完整的查表，色盤恰好 PALETTE_STEPS 階', () => {
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
