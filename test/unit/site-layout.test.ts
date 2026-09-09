import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  fieldGlsl, fieldGlslWithSite, fieldSurfaceColor, siteSurfaceColor, type SiteLayout,
} from '../../src/render/fields'
import { LEUNA_SITE } from '../../src/render/terrain'
import { PLANT_CENTER, PLANT_PAD } from '../../src/world/leuna'

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

  it('洛伊納的 site：墊面是混凝土，廠內外的路都是柏油', () => {
    const c = new Color()
    // 【中心是鐵路骨幹】x = 0 那條縱貫線；往旁邊 200 m 才是墊面
    expect(isConcrete(siteSurfaceColor(
      PLANT_CENTER.x + 200, PLANT_CENTER.z - 300, c, 'lateAutumn', LEUNA_SITE))).toBe(true)
    // 廠內主幹道
    expect(siteSurfaceColor(PLANT_CENTER.x - 420, PLANT_CENTER.z, c, 'lateAutumn', LEUNA_SITE)
      .getHexString()).toBe('3f3d3a')
    // 南門的連外道路
    expect(siteSurfaceColor(-420, -4000, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('3f3d3a')
  })

  /**
   * 【鐵路骨幹要畫得出來】它縱貫整片墊面，是廠區裡最長的一條線。
   * 少了它，兩塊調車場的股道在畫面上接不到任何地方。
   */
  it('鐵路骨幹是碴石色，而平交道上是柏油', () => {
    const c = new Color()
    expect(siteSurfaceColor(PLANT_CENTER.x, PLANT_CENTER.z - 300, c, 'lateAutumn', LEUNA_SITE)
      .getHexString(), '骨幹上不是碴石').toBe('5f5a52')
    // 【道路壓過鐵路】x = 0 與 z = −7500 的那條橫向道路交會的地方是平交道
    expect(siteSurfaceColor(PLANT_CENTER.x, -7500, c, 'lateAutumn', LEUNA_SITE)
      .getHexString(), '平交道上不是柏油').toBe('3f3d3a')
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

  /**
   * 【碎花是亮暗倍率，不是換色】鋪面乘上與墊面同一個 `grimeFactor`，所以
   * 碴石仍然是碴石色、裸土仍然是裸土色，只是一格一格深淺不同。改成加色或
   * 混色的話，調車場會慢慢變成混凝土色 —— 而那在畫面上只是「這一區怎麼
   * 看不出來是碴石」。
   */
  it('調車場是碴石色、留白是裸土色 —— 只有深淺變，色相不變', () => {
    const c = new Color()
    const patches = LEUNA_SITE.patches
    expect(patches, '洛伊納沒有鋪面').toBeDefined()
    for (const hex of [0x5f5a52, 0x6b5f4e]) {
      const p = patches!.find((q) => q.hex === hex)
      expect(p, `沒有 ${hex.toString(16)} 的鋪面`).toBeDefined()
      const base = new Color().setHex(hex)
      // 【取靠廠區中心的那一角】調車場貼著南緣，而廠界會咬進去三百多公尺 ——
      // 取中點會取到過渡帶裡，那裡本來就混了田的顏色
      const px = Math.min(Math.max(PLANT_CENTER.x, p!.x0 + 20), p!.x1 - 20)
      const pz = Math.min(Math.max(PLANT_CENTER.z, p!.z0 + 20), p!.z1 - 20)
      const got = siteSurfaceColor(px, pz, c, 'lateAutumn', LEUNA_SITE)
      // 倍率的上下界：0.86 × 0.74 × 0.96 = 0.611、1.06 × 1 × 1.04 = 1.102
      const k = got.r / base.r
      expect(k, `亮度倍率 ${k.toFixed(3)} 不在髒污的範圍內`).toBeGreaterThanOrEqual(0.61)
      expect(k, `亮度倍率 ${k.toFixed(3)} 不在髒污的範圍內`).toBeLessThanOrEqual(1.11)
      // 三個通道要同一個倍率，否則就是換了色相
      expect(got.g / base.g).toBeCloseTo(k, 5)
      expect(got.b / base.b).toBeCloseTo(k, 5)
    }
  })

  /**
   * 【鋪面也要有碎花】少了這一條，調車場與留白街廓是一整塊平色 —— 廠區裡
   * 最大的兩片地反而是最像白板的地方。
   */
  it('調車場與留白街廓的地也是一格一格的', () => {
    const c = new Color()
    for (const hex of [0x5f5a52, 0x6b5f4e]) {
      const p = LEUNA_SITE.patches!.find((q) => q.hex === hex)!
      const seen = new Set<string>()
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) {
          const x = p.x0 + ((p.x1 - p.x0) * (i + 0.5)) / 12
          const z = p.z0 + ((p.z1 - p.z0) * (j + 0.5)) / 12
          seen.add(siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE).getHexString())
        }
      }
      expect(seen.size, `${hex.toString(16)} 的鋪面只有 ${seen.size} 種顏色`)
        .toBeGreaterThanOrEqual(8)
    }
  })

  /**
   * 【碎花的格要夠細】格子悄悄放大回去，畫面上只是「地變得比較平」——
   * 沒有人會發現。沿一條 120 m 的線每 6 m 取一點：13 m 的格會換色八九次，
   * 40 m 的格只有三次。
   */
  it('碎花的格細到 120 m 的一條線上換色至少六次', () => {
    const c = new Color()
    let changes = 0
    let prev = ''
    for (let k = 0; k <= 20; k++) {
      // 【要落在墊面內而且避開路與鐵路】墊面是 x ±750，路在 −420、鐵路在 0
      const hex = siteSurfaceColor(PLANT_CENTER.x - 700 + k * 6, PLANT_CENTER.z - 300,
        c, 'lateAutumn', LEUNA_SITE).getHexString()
      if (prev !== '' && hex !== prev) changes++
      prev = hex
    }
    expect(changes, `只換色 ${changes} 次`).toBeGreaterThanOrEqual(6)
  })

  it('道路仍然壓過墊面與鋪面', () => {
    const c = new Color()
    expect(siteSurfaceColor(PLANT_CENTER.x - 420, PLANT_CENTER.z, c, 'lateAutumn', LEUNA_SITE)
      .getHexString()).toBe('3f3d3a')
  })

  /**
   * 【鋪面要進 GLSL】CPU 版對了而著色器沒改的話，畫面上還是一片灰，而
   * 兩份不一致這件事只有在小地圖與畫面並排看時才發現得了。
   */
  it('有 site 的 GLSL 帶著鋪面矩形', () => {
    const glsl = fieldGlslWithSite('lateAutumn', LEUNA_SITE)
    expect(glsl).toContain('PATCHES[')
    expect(glsl).toContain('OUTPOSTS[')
    expect(glsl.length).toBeGreaterThan(fieldGlslWithSite('lateAutumn', site).length)
  })
})

/**
 * 廠區的邊界。**這一關的視距重心是投彈高度的俯視**，而一塊 3 × 1.5 km 的
 * 淺灰矩形壓在深褐色的田上，是整幅畫面第一眼就抓到的東西。
 */
describe('廠界不是一個矩形', () => {
  /** 由外往內找第一個不再是純田色的 z，回傳離墊面外緣多深 */
  function edgeDepth(x: number): number {
    const c = new Color()
    const f = new Color()
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ
    for (let z = z0 - 240; z < PLANT_CENTER.z; z += 5) {
      siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE)
      fieldSurfaceColor(x, z, f, 'lateAutumn')
      if (c.getHex() !== f.getHex()) return z - z0
    }
    return PLANT_PAD.halfZ
  }

  /**
   * 【只有細鋸齒不夠】110 m 的格咬 120 m，放在一條 3 km 的邊上是 4% 的相對
   * 振幅 —— 從投彈高度看仍然是一條直線加毛邊。這一條守的是粗的那一層：
   * 實測 230 m，把 `COARSE_BITE` 歸零之後只剩 120 m。
   */
  it('北緣的邊界在 200 m 以上的範圍內游走', () => {
    const depths: number[] = []
    for (let dx = -1200; dx <= 1200; dx += 40) depths.push(edgeDepth(PLANT_CENTER.x + dx))
    const span = Math.max(...depths) - Math.min(...depths)
    expect(span, `只游走 ${span.toFixed(0)} m`).toBeGreaterThanOrEqual(200)
  })

  /**
   * 【衛星設施不能被過渡帶洗掉】它們整塊都在墊面外，跟著墊面那一層上色的話
   * 會被混成一片田 —— 而畫面上只是「牆外什麼都沒有」，看不出是上色的次序
   * 錯了。所以 `outposts` 畫在過渡帶之後。
   */
  it('牆外的衛星設施在墊面外，而且保住自己的鋪面色', () => {
    const c = new Color()
    const outposts = LEUNA_SITE.outposts
    expect(outposts, '洛伊納沒有衛星設施').toBeDefined()
    expect(outposts!.length).toBeGreaterThanOrEqual(4)
    for (const q of outposts!) {
      const x = (q.x0 + q.x1) / 2
      const z = (q.z0 + q.z1) / 2
      const outside = Math.abs(x - PLANT_CENTER.x) > PLANT_PAD.halfX
        || Math.abs(z - PLANT_CENTER.z) > PLANT_PAD.halfZ
      expect(outside, `(${x.toFixed(0)}, ${z.toFixed(0)}) 在墊面裡`).toBe(true)
      const base = new Color().setHex(q.hex)
      const got = siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE)
      const k = got.r / base.r
      expect(k, `亮度倍率 ${k.toFixed(3)}`).toBeGreaterThanOrEqual(0.61)
      expect(k, `亮度倍率 ${k.toFixed(3)}`).toBeLessThanOrEqual(1.11)
      expect(got.g / base.g).toBeCloseTo(k, 5)
      expect(got.b / base.b).toBeCloseTo(k, 5)
    }
  })
})
