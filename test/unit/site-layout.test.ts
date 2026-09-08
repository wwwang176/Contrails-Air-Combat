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

  it('CPU 版：墊面中心是混凝土、道路上是柏油、遠處與田區相同', () => {
    const c = new Color()
    expect(siteSurfaceColor(0, 0, c, 'lateAutumn', site).getHexString()).toBe('8d8a82')
    expect(siteSurfaceColor(3, 900, c, 'lateAutumn', site).getHexString()).toBe('3f3d3a')
    const far = siteSurfaceColor(5000, 5000, c, 'lateAutumn', site).getHex()
    expect(far).toBe(fieldSurfaceColor(5000, 5000, new Color(), 'lateAutumn').getHex())
    // 道路壓過墊面：路穿進墊面邊的那一點是柏油
    expect(siteSurfaceColor(0, 99, c, 'lateAutumn', site).getHexString()).toBe('3f3d3a')
  })

  it('洛伊納的 site：廠區中心是混凝土，南門的路是柏油', () => {
    const c = new Color()
    // 廠區中心在主軸的路上，往旁邊 300 m 才是墊面
    expect(siteSurfaceColor(PLANT_CENTER.x + 300, PLANT_CENTER.z - 300, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('8d8a82')
    expect(siteSurfaceColor(PLANT_CENTER.x, PLANT_CENTER.z, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('3f3d3a')
    expect(siteSurfaceColor(500, -4000, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('3f3d3a')
  })
})
