import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  fieldGlsl, fieldGlslWithSite, fieldSurfaceColor, siteSurfaceColor, type SiteLayout,
} from '../../src/render/fields'
import { LEUNA_SITE } from '../../src/render/terrain'
import { PLANT_PAD, plantToWorld } from '../../src/world/leuna'

/**
 * 廠區局部座標 → 世界座標。**洛伊納的探針一律經過它** —— `LEUNA_SITE` 的
 * 墊面、鋪面、衛星設施都活在轉過 `PLANT_HEADING` 的座標系裡，直接拿
 * `PLANT_CENTER ± 幾百公尺` 當探針會取到墊面外的田。
 */
function W(dx: number, dz: number): { x: number; z: number } {
  const out = { x: 0, z: 0 }
  plantToWorld(dx, dz, out)
  return out
}

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
    // 【中心是鐵路骨幹】局部 x = 0 那條縱貫線；往旁邊 200 m 才是墊面
    const slab = W(200, -300)
    expect(isConcrete(siteSurfaceColor(
      slab.x, slab.z, c, 'lateAutumn', LEUNA_SITE))).toBe(true)
    // 廠內主幹道
    const main = W(-420, 0)
    expect(siteSurfaceColor(main.x, main.z, c, 'lateAutumn', LEUNA_SITE)
      .getHexString()).toBe('3f3d3a')
    // 南門的連外道路（世界座標，不跟著廠區轉）
    expect(siteSurfaceColor(-85, -4000, c, 'lateAutumn', LEUNA_SITE).getHexString()).toBe('3f3d3a')
  })

  /**
   * 【鐵路骨幹要畫得出來】它縱貫整片墊面，是廠區裡最長的一條線。
   * 少了它，兩塊調車場的股道在畫面上接不到任何地方。
   */
  it('鐵路骨幹是碴石色，而平交道上是柏油', () => {
    const c = new Color()
    const spine = W(0, -300)
    expect(siteSurfaceColor(spine.x, spine.z, c, 'lateAutumn', LEUNA_SITE)
      .getHexString(), '骨幹上不是碴石').toBe('5f5a52')
    // 【道路壓過鐵路】骨幹（局部 x = 0）與橫向道路（局部 z = −500）交會處是平交道
    const cross = W(0, -500)
    expect(siteSurfaceColor(cross.x, cross.z, c, 'lateAutumn', LEUNA_SITE)
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
        const p = W(-700 + i * 140, -1400 + j * 280)
        seen.add(siteSurfaceColor(p.x, p.z, c, 'lateAutumn', LEUNA_SITE).getHexString())
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
      // 【取靠廠區中心的那一角】鋪面可能貼著廠界，而廠界會咬進去三百多公尺
      // —— 取中點會取到過渡帶裡，那裡本來就混了田的顏色
      const px = Math.min(Math.max(0, p!.x0 + 20), p!.x1 - 20)
      const pz = Math.min(Math.max(0, p!.z0 + 20), p!.z1 - 20)
      const w = W(px, pz)
      const got = siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE)
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
          const w = W(p.x0 + ((p.x1 - p.x0) * (i + 0.5)) / 12,
            p.z0 + ((p.z1 - p.z0) * (j + 0.5)) / 12)
          seen.add(siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE).getHexString())
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
      // 【要落在墊面內而且避開路與鐵路】墊面是局部 x ±750，路在 −420、鐵路在 0。
      // 不能貼著西緣走 —— 廠界最深咬進 355 m，那一段常常已經是田
      const w = W(-300 + k * 6, -300)
      const hex = siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE).getHexString()
      if (prev !== '' && hex !== prev) changes++
      prev = hex
    }
    expect(changes, `只換色 ${changes} 次`).toBeGreaterThanOrEqual(6)
  })

  it('道路仍然壓過墊面與鋪面', () => {
    const c = new Color()
    const w = W(-420, 0)
    expect(siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE)
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
  /**
   * 由外往內找第一個不再是純田色的點，回傳離墊面北緣多深。
   * **沿廠區局部座標的 z 走** —— 墊面是斜的，垂直往下量會斜切過邊界。
   */
  function edgeDepth(dx: number): number {
    const c = new Color()
    const f = new Color()
    for (let dz = -PLANT_PAD.halfZ - 240; dz < 0; dz += 5) {
      const w = W(dx, dz)
      siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE)
      fieldSurfaceColor(w.x, w.z, f, 'lateAutumn')
      if (c.getHex() !== f.getHex()) return dz + PLANT_PAD.halfZ + 240
    }
    return PLANT_PAD.halfZ
  }

  /**
   * 【邊界是硬的，不是一條漸層帶】墊面外一圈把混凝土混回田色的過渡帶，從
   * 投彈高度看是「一半工廠一半田」的暈 —— 廠區與田之間是圍牆，不是霧。
   * 這一條掃過邊界，每一點要嘛是墊面色系（混凝土乘髒污），要嘛與純田色
   * 逐位元相同；混色會兩邊都不是。
   */
  it('跨過廠界沒有混色的過渡帶', () => {
    const c = new Color()
    const f = new Color()
    // 混凝土、碴石、裸土、衛星設施的鋪面、柏油。髒污是三個通道同一個倍率，
    // 所以純色系的取樣點對其中一個基色的三個比值會一致；混色不會
    const bases = [0x8d8a82, 0x5f5a52, 0x6b5f4e, 0x807d76, 0x3f3d3a].map((h) => new Color(h))
    let blended = 0
    for (let dx = -600; dx <= 600; dx += 37) {
      for (let dz = -PLANT_PAD.halfZ - 400; dz <= -PLANT_PAD.halfZ + 200; dz += 3) {
        const w = W(dx, dz)
        const got = siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE)
        if (got.getHex() === fieldSurfaceColor(w.x, w.z, f, 'lateAutumn').getHex()) continue
        const pure = bases.some((b) => {
          const k = got.r / b.r
          return Math.abs(got.g / b.g - k) < 2e-3 && Math.abs(got.b / b.b - k) < 2e-3
        })
        if (!pure) blended++
      }
    }
    expect(blended, `有 ${blended} 個取樣點既不是墊面也不是田`).toBe(0)
  })

  /**
   * 【鋸齒要細到看得出是鋸齒】粗的那一層讓整條邊蜿蜒，但週期 450 m 的起伏
   * 在投彈高度是一條平滑的曲線。細的那一層負責「這不是畫出來的線」——
   * 沿邊每 10 m 取一點，相鄰兩點的深度差要常常跳超過 15 m。
   */
  it('邊界的鋸齒是 20 到 50 m 的尺度', () => {
    const depths: number[] = []
    for (let dx = -600; dx <= 600; dx += 10) depths.push(edgeDepth(dx))
    let jumps = 0
    for (let i = 1; i < depths.length; i++) {
      if (Math.abs(depths[i]! - depths[i - 1]!) > 15) jumps++
    }
    const rate = jumps / (depths.length - 1)
    expect(rate, `只有 ${(rate * 100).toFixed(0)}% 的相鄰取樣跳超過 15 m`)
      .toBeGreaterThanOrEqual(0.2)
  })

  /**
   * 【四個角的斜切也要碎】角切是一條直線約束，過渡帶還在的時候被暈蓋住了；
   * 邊界變硬之後，四個角就是四條乾淨的斜直線 —— 在投彈高度那比矩形還好認。
   *
   * 從廠區中心射線掃，量邊界半徑；沿角落那一段的相鄰取樣要常常跳。
   */
  it('四個角的邊界不是斜直線', () => {
    const c = new Color()
    const f = new Color()
    /** 從中心往 `deg` 方向找邊界半徑，m */
    const edgeRadius = (deg: number): number => {
      const a = (deg * Math.PI) / 180
      for (let r = 400; r < 2600; r += 5) {
        const w = W(Math.sin(a) * r, -Math.cos(a) * r)
        siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE)
        fieldSurfaceColor(w.x, w.z, f, 'lateAutumn')
        if (c.getHex() === f.getHex()) return r
      }
      return 2600
    }
    // 【區間要涵蓋斜切主導的那一段】角在 atan2(750, 1500) ≈ 26.6°，但斜切
    // 一路管到 60° 附近 —— 只掃角尖那十幾度的話，旁邊四條邊的鋸齒會把它蓋過去
    for (const mid of [26.6, 180 - 26.6, 180 + 26.6, 360 - 26.6]) {
      const rs: number[] = []
      for (let d = mid - 30; d <= mid + 30; d += 0.5) rs.push(edgeRadius(d))
      let jumps = 0
      for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i]! - rs[i - 1]!) > 15) jumps++
      const rate = jumps / (rs.length - 1)
      expect(rate, `${mid.toFixed(0)}° 那個角只有 ${(rate * 100).toFixed(0)}% 的取樣在跳`)
        .toBeGreaterThanOrEqual(0.2)
    }
  })

  /**
   * 【角切要是切角，不是沿著長邊削一條】斜切的兩條直角邊如果差好幾倍，切掉的
   * 就是一個很扁的三角形 —— 斜邊幾乎平行長軸，畫面上是「工廠的長邊被斜著
   * 削掉一條」，比直角還顯眼。
   *
   * 【這是長寬比一改就會走樣的那種錯】直角邊寫成墊面尺寸的比例，墊面從
   * 3000 × 1500 轉成 1500 × 3000 之後，同一組比例就把等邊三角形變成 1 : 3.6。
   */
  it('四個角切掉的是接近等邊的三角形', () => {
    const c = new Color()
    const f = new Color()
    /**
     * 從 (dx, dz) 沿 `(sx, sz)` 方向掃到廠區的距離。
     *
     * 【道路與碴石帶要跳過】它們畫在世界座標、一路鋪到地圖邊緣，掃到就停的話
     * 量到的是「離最近一條路多遠」。兩者都是不吃髒污的定值，比對得出來。
     */
    const reach = (dx: number, dz: number, sx: number, sz: number): number => {
      for (let r = 0; r < 1600; r += 4) {
        const w = W(dx + sx * r, dz + sz * r)
        const hex = siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE).getHex()
        if (hex === 0x3f3d3a || hex === 0x5f5a52) continue
        if (hex !== fieldSurfaceColor(w.x, w.z, f, 'lateAutumn').getHex()) return r
      }
      return 1600
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    /** 西／東緣在這個 dz 的位置。咬痕振幅 285 m，所以每一個量都取三點平均 */
    const edgeX = (sx: -1 | 1, dz: number): number =>
      sx * (PLANT_PAD.halfX + 900 - mean([-40, 0, 40].map((o) => reach(
        sx * (PLANT_PAD.halfX + 900), dz + o, -sx, 0))))
    const edgeZ = (sz: -1 | 1, dx: number): number =>
      sz * (PLANT_PAD.halfZ + 900 - mean([-40, 0, 40].map((o) => reach(
        dx + o, sz * (PLANT_PAD.halfZ + 900), 0, -sz))))
    for (const [sx, sz, tag] of [
      [-1, -1, '西北'], [1, -1, '東北'], [-1, 1, '西南'], [1, 1, '東南'],
    ] as const) {
      // 角落被切掉多少 ＝ 那一頭的邊界相對同一條邊中段縮進來多少
      const a = Math.abs(edgeX(sx, sz * 1400) - edgeX(sx, 0))
      const e = Math.abs(edgeZ(sz, sx * 650) - edgeZ(sz, 0))
      const ratio = a / e
      const what = `${tag}角切掉 ${a.toFixed(0)} × ${e.toFixed(0)} m，比 ${ratio.toFixed(2)}`
      expect(ratio, what).toBeGreaterThan(0.45)
      expect(ratio, what).toBeLessThan(2.2)
    }
  })

  /**
   * 【只有細鋸齒不夠】110 m 的格咬 120 m，放在一條 3 km 的邊上是 4% 的相對
   * 振幅 —— 從投彈高度看仍然是一條直線加毛邊。這一條守的是粗的那一層：
   * 實測 230 m，把 `COARSE_BITE` 歸零之後只剩 120 m。
   */
  it('北緣的邊界在 200 m 以上的範圍內游走', () => {
    const depths: number[] = []
    for (let dx = -600; dx <= 600; dx += 20) depths.push(edgeDepth(dx))
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
      // 衛星設施與墊面都是廠區局部座標，直接比
      const dx = (q.x0 + q.x1) / 2
      const dz = (q.z0 + q.z1) / 2
      const outside = Math.abs(dx) > PLANT_PAD.halfX || Math.abs(dz) > PLANT_PAD.halfZ
      expect(outside, `(${dx.toFixed(0)}, ${dz.toFixed(0)}) 在墊面裡`).toBe(true)
      const base = new Color().setHex(q.hex)
      const w = W(dx, dz)
      const got = siteSurfaceColor(w.x, w.z, c, 'lateAutumn', LEUNA_SITE)
      const k = got.r / base.r
      expect(k, `亮度倍率 ${k.toFixed(3)}`).toBeGreaterThanOrEqual(0.61)
      expect(k, `亮度倍率 ${k.toFixed(3)}`).toBeLessThanOrEqual(1.11)
      expect(got.g / base.g).toBeCloseTo(k, 5)
      expect(got.b / base.b).toBeCloseTo(k, 5)
    }
  })
})
