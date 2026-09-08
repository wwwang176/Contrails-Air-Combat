import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  fieldGlsl, fieldGlslWithSite, fieldSurfaceColor, siteSurfaceColor, type SiteLayout,
} from '../../src/render/fields'
import { LEUNA_SITE } from '../../src/render/terrain'
import { PLANT_CENTER } from '../../src/world/leuna'

/**
 * 廠區那一層地面：墊面是混凝土、道路是柏油、其餘照田區。**沒有 site 時
 * 與原本逐字相同** —— 農地與夏季基準靠這一條。
 */
const site: SiteLayout = {
  pad: { x0: -100, z0: -100, x1: 100, z1: 100 },
  roads: [[{ x: 0, z: 100 }, { x: 0, z: 2000 }]],
  roadWidth: 12,
}

describe('SiteLayout', () => {
  it('沒有 site 的 GLSL 與 fieldGlsl 逐字相同；有 site 的多了墊面與道路', () => {
    expect(fieldGlslWithSite('summer')).toBe(fieldGlsl('summer'))
    expect(fieldGlslWithSite('lateAutumn')).toBe(fieldGlsl('lateAutumn'))
    const withSite = fieldGlslWithSite('lateAutumn', site)
    expect(withSite).toContain('ROADS[1]')
    expect(withSite).toContain('return col;')
    expect(withSite.length).toBeGreaterThan(fieldGlsl('lateAutumn').length)
  })

  /** 混凝土帶髒污之後不再是單一色，但仍在同一個色相的明暗帶裡 */
  const isConcrete = (c: Color): boolean => {
    const base = new Color(0x8d8a82)
    const f = c.r / base.r
    return f > 0.55 && f < 1.1
      && Math.abs(c.g / base.g - f) < 0.02 && Math.abs(c.b / base.b - f) < 0.02
  }

  it('CPU 版：墊面中心是混凝土、道路上是柏油、遠處與田區相同', () => {
    const c = new Color()
    expect(isConcrete(siteSurfaceColor(0, 0, c, 'lateAutumn', site))).toBe(true)
    expect(siteSurfaceColor(3, 900, c, 'lateAutumn', site).getHexString()).toBe('3f3d3a')
    const far = siteSurfaceColor(5000, 5000, c, 'lateAutumn', site).getHex()
    expect(far).toBe(fieldSurfaceColor(5000, 5000, new Color(), 'lateAutumn').getHex())
    // 道路壓過墊面：路穿進墊面邊的那一點是柏油
    expect(siteSurfaceColor(0, 99, c, 'lateAutumn', site).getHexString()).toBe('3f3d3a')
  })

  it('洛伊納的 site：廠區中心是混凝土，南門的路是柏油', () => {
    const c = new Color()
    // 廠區中心在主軸的路上，往旁邊 300 m 才是墊面
    expect(isConcrete(siteSurfaceColor(
      PLANT_CENTER.x + 300, PLANT_CENTER.z - 300, c, 'lateAutumn', LEUNA_SITE))).toBe(true)
    expect(siteSurfaceColor(PLANT_CENTER.x, PLANT_CENTER.z, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('3f3d3a')
    expect(siteSurfaceColor(500, -4000, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('3f3d3a')
  })
})

/**
 * 墊面的髒污。俯視為主的關卡，畫面一大半是地 —— 均一的一片灰在投彈高度
 * 看起來就是一塊白板。
 */
describe('墊面的髒污', () => {
  it('墊面不再是單一色：一百個取樣點裡至少八種顏色', () => {
    const c = new Color()
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const x = PLANT_CENTER.x - 1400 + i * 280
        const z = PLANT_CENTER.z - 700 + j * 140
        seen.add(siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE).getHexString())
      }
    }
    expect(seen.size, `只有 ${seen.size} 種顏色`).toBeGreaterThanOrEqual(8)
  })

  it('調車場的街廓是碴石色，留白的街廓是裸土色', () => {
    const c = new Color()
    const patches = LEUNA_SITE.patches
    expect(patches, '洛伊納沒有鋪面').toBeDefined()
    for (const hex of [0x5f5a52, 0x6b5f4e]) {
      const p = patches!.find((q) => q.hex === hex)
      expect(p, `沒有 ${hex.toString(16)} 的鋪面`).toBeDefined()
      const x = (p!.x0 + p!.x1) / 2
      const z = (p!.z0 + p!.z1) / 2
      expect(siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE).getHex()).toBe(hex)
    }
  })

  it('道路仍然壓過墊面與鋪面', () => {
    const c = new Color()
    expect(siteSurfaceColor(PLANT_CENTER.x, PLANT_CENTER.z, c, 'lateAutumn', LEUNA_SITE)
      .getHexString()).toBe('3f3d3a')
  })

  /**
   * 【鋪面要進 GLSL】CPU 版對了而著色器沒改的話，畫面上還是一片灰，而
   * 兩份不一致這件事只有在小地圖與畫面並排看時才發現得了。
   */
  it('有 site 的 GLSL 帶著鋪面矩形', () => {
    const glsl = fieldGlslWithSite('lateAutumn', LEUNA_SITE)
    expect(glsl).toContain('PATCHES[')
    expect(glsl.length).toBeGreaterThan(fieldGlslWithSite('lateAutumn', site).length)
  })
})
