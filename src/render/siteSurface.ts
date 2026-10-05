import { Color } from 'three'
import { type Season } from './season'
import { type BattleScars } from './battleScars'
import type { FloraSource } from './flora'
import { hash2, hash1, fieldSurfaceColor } from './fields'

/**
 * 廠區的地面：墊面是混凝土、道路是柏油。**只有洛伊納有**；農地不給，
 * 字串與夏季基準逐位元相同。
 *
 * 【為什麼畫在著色器裡而不是幾何】道路是 20 km 的帶子，幾何要跟著地形的
 * 起伏切；著色器吃世界座標，圖案本來就釘在地上。
 */
export interface SiteBelts {
  /**
   * 林帶不進的戰場方框：世界座標的原點、橫向單位向量 `(rx, rz)` 與縱向（朝蘇軍後方）單位向量
   * `(fx, fz)`、橫向半寬、北緣與南緣的 lz，以及往外漸增到滿的距離，m。**與 `world/rzhev.ts` 的
   * `shelterbeltFade` 同一組數、同一條式子**，遠處的帶子才與近處種出來的樹對得上
   */
  readonly frame: {
    readonly ox: number; readonly oz: number; readonly rx: number; readonly rz: number
    readonly fx: number; readonly fz: number
    readonly half: number; readonly north: number; readonly south: number; readonly ramp: number
  }
  /** 遠處帶子的半寬，m（樹帶三排加樹冠約 ±10 m） */
  readonly halfWidth: number
  /** 帶子的顏色（遠處的林冠） */
  readonly hex: number
}

export interface SiteLayout {
  /**
   * 廠區局部座標系的原點，世界座標。省略時是 (0, 0)。
   *
   * 【`pad`／`patches`／`outposts` 全部活在局部系裡】它們仍然是軸對齊矩形，
   * 只是先繞 `pivot` 轉了 `heading`。`roads`／`rails` 是例外 —— 那兩組一路
   * 畫到地圖邊緣，寫的是世界座標。
   */
  readonly pivot?: { readonly x: number; readonly z: number }
  /** 局部系相對世界的旋轉，弧度。省略或 0 時局部＝世界 */
  readonly heading?: number
  /**
   * 墊面矩形，廠區局部座標。**省略 = 沒有墊面**：勒熱夫只有道路與戰場的痕跡，
   * 地面照樣是田
   */
  readonly pad?: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
  /**
   * 墊面的顏色。**省略 = 混凝土**（廠區）。機場的墊面是草地，只有跑道與
   * 停機坪是鋼板 —— 那兩塊走 `patches`。
   */
  readonly padHex?: number
  /**
   * 附加的墊面矩形，與 `pad` 取**聯集**。機場的草地要貼著跑道與魚骨走，
   * 一個大矩形會多出一大片草 —— 主體是跑道那一條帶子，每一組魚骨各一塊。
   * 每一塊都有自己的咬痕與斜切角，接縫處是兩塊的聯集。
   */
  readonly padLobes?: readonly { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }[]
  /**
   * 墊面之外還要這麼寬的一圈不長樹，m。省略時樹貼著墊面長。
   *
   * 【著色器不看它】只有散佈器用 —— 這一圈仍然是田色，只是沒有樹籬與樹林。
   */
  readonly treeClear?: number
  /** 墊面之外不蓋村莊的那一圈，m。**省略 = 同 `treeClear`** */
  readonly buildingClear?: number
  /**
   * 墊面裡自己的植被（機場裡的樹叢）。**不被墊面與淨空帶排除**，與野地的植被
   * 一起畫、一起烘進遠圖
   */
  readonly flora?: FloraSource
  /** 道路的折線，世界座標 */
  readonly roads: readonly (readonly { readonly x: number; readonly z: number }[])[]
  /** 路寬，m */
  readonly roadWidth: number
  /**
   * 換掉鋪面的矩形：調車場的碴石、留白街廓的裸土。廠區局部座標。
   *
   * 【壓在墊面之上、道路之下】次序在 `siteGlsl` 與 `siteSurfaceColor` 兩邊
   * 要一致，否則畫面上的路被碴石蓋掉，而小地圖取樣說它是柏油。
   */
  readonly patches?: readonly {
    readonly x0: number; readonly z0: number
    readonly x1: number; readonly z1: number
    readonly hex: number
  }[]
  /**
   * 牆外衛星設施的鋪面。廠區局部座標，形狀與 `patches` 相同。
   *
   * 【為什麼不能併進 `patches`】`patches` 在過渡帶之前上色，越靠外越被混回
   * 田色 —— 而衛星設施整塊都在墊面外，併進去會被洗成一片田。這一層畫在
   * 過渡帶之後、道路之前。
   */
  readonly outposts?: readonly {
    readonly x0: number; readonly z0: number
    readonly x1: number; readonly z1: number
    readonly hex: number
  }[]
  /**
   * 鐵路的折線，世界座標。畫成碴石帶，壓在道路之下 —— 平交道上看得到的是
   * 柏油。
   */
  readonly rails?: readonly (readonly { readonly x: number; readonly z: number }[])[]
  /** 碴石帶的寬，m */
  readonly railWidth?: number
  /** 路面的顏色。**省略 = 柏油**（廠區、機場）；土路給土色 */
  readonly roadHex?: number
  /**
   * 疊在田上的戰場痕跡：彈坑、燒田、履帶痕、壕溝（`battleScars.ts`）。畫在道路之後（先有路、後來才被炸）。
   * 只有畫面 —— `siteSurfaceColor` 不算它
   */
  readonly scars?: BattleScars
  /**
   * 草原的防風林帶在遠處的樣子。植被只畫到 4.8～6 km，再遠的樹要靠地面；與歐陸的樹籬同一個做法：
   * 著色器依田界的身分把有林帶的田界畫成一條深色的帶子，不逐棵烘。只有畫面 ——
   * `siteSurfaceColor` 不算它
   */
  readonly belts?: SiteBelts
}

export const CONCRETE = 0x8d8a82

export const ASPHALT = 0x3f3d3a

/** 鐵路的碴石。與 `terrain.ts` 調車場街廓那一份同色 */
export const BALLAST = 0x5f5a52

/**
 * 髒污碎花的格，m。小格是逐格的亮暗與油漬，大格是整片鋪面的深淺。
 *
 * 【不要再放大】投彈高度一個像素蓋到地面約 4 m，小格已經只有三個像素寬 ——
 * 再細下去會在飛行中閃爍，而那是看得出來的雜訊不是髒。
 */
export const GRIME_CELL = 13

export const SLAB_CELL = 40

/**
 * 一點的髒污倍率。**墊面與鋪面共用** —— 調車場的碴石與留白的裸土乘上它就
 * 是同色系的碎花，而不是一整塊平色。
 *
 * 【與 `siteGlsl` 逐項對應】兩份不一致的話，小地圖與畫面上的地是兩種顏色。
 */
function grimeFactor(x: number, z: number): number {
  const ph = hash2(Math.floor(x / GRIME_CELL), Math.floor(z / GRIME_CELL))
  const sh = hash2(Math.floor(x / SLAB_CELL) + 7919, Math.floor(z / SLAB_CELL) - 104729)
  const oh = hash1(ph)
  const slab = 0.86 + (0.2 * ((sh >>> 8) & 0x7)) / 7
  const stain = (oh & 0xff) < 46 ? 0.74 : 1
  return slab * stain * (0.96 + (0.08 * (ph & 0xff)) / 255)
}

/**
 * 廠界的三層起伏。**邊界本身是硬的**，不規則靠的是這三個尺度疊起來。
 *
 * - 細（22 m 的格咬 45 m）：鋸齒。這一層決定「這不是畫出來的線」
 * - 中（110 m 咬 90 m）：一段一段的凹凸
 * - 粗（450 m 咬 150 m）：整條邊蜿蜒，把矩形變成不規則的形狀
 *
 * 【三層都要】只有粗的話從投彈高度看是一條平滑的曲線；只有細的話，放在
 * 一條 3 km 的邊上是 1.5% 的相對振幅 —— 仍然是一條直線加毛邊。
 */
export const FINE_CELL = 22

const FINE_BITE = 45

export const EDGE_CELL = 110

const EDGE_BITE = 90

export const COARSE_CELL = 450

const COARSE_BITE = 150

/**
 * 咬痕的基線比墊面往外推這麼多，m。
 *
 * 【沒有它，邊緣的街廓會裸露在田上】三層咬痕加起來最深 285 m，而最外圈的
 * 街廓離墊面邊只有 100 m —— 從墊面邊往內咬的話，整排廠房會站在田色的地上。
 * 往外推之後咬痕在墊面外那一圈裡起伏，平均落在墊面外 40 m 左右。
 */
export const PAD_SKIRT = 180

/**
 * 四個角斜切掉的兩條直角邊，m。次序是西北、東北、西南、東南。
 *
 * 【是長度不是比例】寫成墊面尺寸的比例會隨長寬比走樣：3000 × 1500 的墊面
 * 轉成 1500 × 3000 之後，同一組比例把等邊三角形變成 1 : 4.4 的扁三角形 ——
 * 斜邊幾乎平行長軸，畫面上是「工廠的長邊被斜著削掉一條」，比直角還顯眼。
 *
 * 【四個角要不一樣】一樣的話切完仍然是一個對稱的八邊形，那和矩形一樣好認。
 */
export const CORNER_CUTS: readonly (readonly [number, number])[] = [
  [300, 300], [180, 195], [255, 260], [135, 300],
]

/** 四個角斜切各自的鹽。共用一個的話四條斜邊會咬出一樣的鋸齒 */
export const CORNER_SALT: readonly number[] = [1913, 5273, 8171, 3527]

/**
 * 斜切的早退餘裕，m。**要大於三層咬痕的總和**（285 m）—— 小了的話角落外側
 * 那一段會被跳過，而那正是咬痕該把切線往內拉的地方。
 */
export const CORNER_SLACK = 400

/**
 * 早退的外接盒要往外留這麼寬，m。**至少要蓋過 `PAD_SKIRT`** —— 邊界最外
 * 就在墊面外 `PAD_SKIRT` 處，盒子縮進來的話那一圈會露出田色。
 *
 * 【不要放大】盒內每個像素都跑墊面那一整段算式。放到 400 量到 4 km 俯視的
 * frame 由 0.9 ms 變 1.8 ms。
 */
const BAND = 220

/**
 * 起伏的深度。**兩側加起來不得吃掉整塊墊面** —— 咬得比半邊長還深的話，
 * 小一點的墊面會整片消失，而它在畫面上只是「這一關的廠區不見了」。
 */
/** 一塊墊面矩形，廠區局部座標 */
export type PadRect = NonNullable<SiteLayout['pad']>

export function edgeBite(pad: PadRect): number {
  return Math.min(EDGE_BITE, (pad.x1 - pad.x0) * 0.08, (pad.z1 - pad.z0) * 0.08)
}

export function coarseBite(pad: PadRect): number {
  return Math.min(COARSE_BITE, (pad.x1 - pad.x0) * 0.11, (pad.z1 - pad.z0) * 0.11)
}

export function fineBite(pad: PadRect): number {
  return Math.min(FINE_BITE, (pad.x1 - pad.x0) * 0.05, (pad.z1 - pad.z0) * 0.05)
}

/** 一個 0…1 的格值。四條邊各用自己的鹽，否則對邊會鏡射 */
function edgeNoise(t: number, cell: number, salt: number): number {
  return (hash2(Math.floor(t / cell), salt) & 0xff) / 255
}

/**
 * 一點到墊面邊界的有號距離，m —— 負的在裡面、正的在外面。
 *
 * 【為什麼要距離而不是布林】邊緣壓暗與抗鋸齒都要知道「離邊多遠」。取各條
 * 約束的最大違反量：軸對齊矩形的外側距離就是這樣算的，角落會略為低估，
 * 而那正好讓斜切角的邊柔一點。
 *
 * **GLSL 與 CPU 兩份要算出同一個答案** —— 分家的話畫面上的廠界與取樣到的
 * 顏色差一整條邊，而那只有在小地圖與畫面並排時才看得出來。
 */
function padDistance(x: number, z: number, pad: PadRect): number {
  const b = edgeBite(pad)
  const c = coarseBite(pad)
  const f = fineBite(pad)
  const inset = (t: number, s1: number, s2: number): number =>
    edgeNoise(t, FINE_CELL, s1 ^ 0x5bd1) * f
    + edgeNoise(t, EDGE_CELL, s1) * b
    + edgeNoise(t, COARSE_CELL, s2) * c
  const sx0 = pad.x0 - PAD_SKIRT
  const sx1 = pad.x1 + PAD_SKIRT
  const sz0 = pad.z0 - PAD_SKIRT
  const sz1 = pad.z1 + PAD_SKIRT
  const w = sx1 - sx0
  const d = sz1 - sz0
  let out = Math.max(
    sx0 + inset(z, 4517, 3313) - x,
    x - (sx1 - inset(z, 2287, 6151)),
    sz0 + inset(x, 9911, 8543) - z,
    z - (sz1 - inset(x, 7331, 1697)),
  )
  for (let k = 0; k < 4; k++) {
    // 【夾住】兩個角的切在小墊面上會重疊，重疊之後整條邊都不見了
    const a = Math.min(CORNER_CUTS[k]![0], w * 0.3)
    const e = Math.min(CORNER_CUTS[k]![1], d * 0.3)
    // 【四個角量的是外推後的矩形】拿沒外推的邊當基準的話，外推那一圈整個
    // 落在斜切的外側 —— 角落會被削掉四百公尺，而且削出來的是一條直線
    const u = (k & 1) === 0 ? x - sx0 : sx1 - x
    const v = k < 2 ? z - sz0 : sz1 - z
    // 【離角落夠遠就不必算】斜切的違反量在那裡已經比最深的一咬更負，加不加
    // 咬痕都不會勝出。GLSL 那邊靠這一條省掉三次 hash —— 見 `CORNER_SLACK`
    if (u * e + v * a >= a * e + CORNER_SLACK * e) continue
    // 違反量換算成垂直距離：法向量 (1/a, 1/e) 的長度倒數
    // 斜邊也吃同一組三層咬痕，參數是沿斜邊的座標 —— 少了它，四個角是四條
    // 乾淨的斜直線，在投彈高度比矩形還好認
    const t = (u * e - v * a) / Math.hypot(a, e)
    out = Math.max(
      out,
      (1 - u / a - v / e) / Math.hypot(1 / a, 1 / e) + inset(t, CORNER_SALT[k]!, 6473 + k),
    )
  }
  return out
}

/**
 * 廠區這一層的作用範圍：墊面加過渡帶，再併進所有衛星設施。**道路不算** ——
 * 連外那兩條一路畫到地圖邊緣。
 *
 * 【為什麼要這個】墊面那一段的算式每個像素都跑，而投彈高度整片畫面有七成
 * 是田。少了這個外接矩形，4 km 俯視的幀時間從 0.8 ms 變成 2.2 ms。
 */
export function siteBounds(
  site: SiteLayout & { readonly pad: PadRect },
): { x0: number; z0: number; x1: number; z1: number } {
  const local = {
    x0: site.pad.x0 - BAND, x1: site.pad.x1 + BAND,
    z0: site.pad.z0 - BAND, z1: site.pad.z1 + BAND,
  }
  for (const l of site.padLobes ?? []) {
    local.x0 = Math.min(local.x0, l.x0 - BAND); local.x1 = Math.max(local.x1, l.x1 + BAND)
    local.z0 = Math.min(local.z0, l.z0 - BAND); local.z1 = Math.max(local.z1, l.z1 + BAND)
  }
  for (const q of site.outposts ?? []) {
    local.x0 = Math.min(local.x0, q.x0); local.x1 = Math.max(local.x1, q.x1)
    local.z0 = Math.min(local.z0, q.z0); local.z1 = Math.max(local.z1, q.z1)
  }
  // 【轉過角度就要取四角的外接盒】早退的測試在世界座標做，直接把局部的邊界
  // 當世界用的話，斜角那兩塊墊面會被擋在外面 —— 畫面上是廠區缺了兩個角
  const c = Math.cos(site.heading ?? 0)
  const s = Math.sin(site.heading ?? 0)
  const px = site.pivot?.x ?? 0
  const pz = site.pivot?.z ?? 0
  const out = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
  for (const [dx, dz] of [
    [local.x0, local.z0], [local.x1, local.z0], [local.x1, local.z1], [local.x0, local.z1],
  ] as const) {
    const x = px + dx * c - dz * s
    const z = pz + dx * s + dz * c
    out.x0 = Math.min(out.x0, x); out.x1 = Math.max(out.x1, x)
    out.z0 = Math.min(out.z0, z); out.z1 = Math.max(out.z1, z)
  }
  return out
}

/**
 * 道路與鐵路的外接矩形往外再留多少，m。
 *
 * 【為什麼不能剛好貼著半寬】`bandCoverage(d, halfW, px)` 的抗鋸齒帶一路延到
 * `d = halfW + px`，而 `px` 是那一像素在地面上的足跡 —— 掠角看過去可以到
 * 好幾十公尺。留得不夠的話，路的外緣會沿著矩形邊被削掉一條直線，而且只在
 * 特定視角出現。矩形本身有十幾公里寬，多留這幾百公尺不花錢。
 */
const ROAD_BOUNDS_SLACK = 400

/**
 * 道路與鐵路的世界座標外接矩形。
 *
 * 【為什麼要獨立於 `siteBounds`】連外道路與鐵路一路畫到圖邊，遠在墊面那個
 * 矩形之外 —— 拿墊面的矩形擋它們會把連外那幾條整段砍掉。但完全不擋的話，
 * 那十五段點線距離是**每個像素**都跑，包含畫面上七成的田。
 */
export function roadBounds(site: SiteLayout): {
  x0: number; z0: number; x1: number; z1: number
} {
  const out = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
  for (const lines of [site.roads, site.rails ?? []]) {
    for (const line of lines) {
      for (const p of line) {
        out.x0 = Math.min(out.x0, p.x); out.x1 = Math.max(out.x1, p.x)
        out.z0 = Math.min(out.z0, p.z); out.z1 = Math.max(out.z1, p.z)
      }
    }
  }
  const margin = Math.max(site.roadWidth, site.railWidth ?? 0) / 2 + ROAD_BOUNDS_SLACK
  out.x0 -= margin; out.x1 += margin
  out.z0 -= margin; out.z1 += margin
  return out
}

/** 一條折線攤成線段清單，GLSL 與 CPU 共用 */
export function segmentsOf(
  lines: readonly (readonly { readonly x: number; readonly z: number }[])[],
): { ax: number; az: number; bx: number; bz: number }[] {
  const out: { ax: number; az: number; bx: number; bz: number }[] = []
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      out.push({ ax: line[i]!.x, az: line[i]!.z, bx: line[i + 1]!.x, bz: line[i + 1]!.z })
    }
  }
  return out
}

/** 點到線段的距離 */
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

/**
 * `fieldSurfaceColor` 的廠區版：道路壓過墊面，墊面壓過田。`site` 省略時與
 * `fieldSurfaceColor` 相同。
 */
export function siteSurfaceColor(
  x: number, z: number, out: Color, season: Season, site?: SiteLayout, open = false,
): Color {
  if (site !== undefined) {
    for (const s of segmentsOf(site.roads)) {
      if (segmentDistance(x, z, s.ax, s.az, s.bx, s.bz) < site.roadWidth / 2) {
        return out.setHex(site.roadHex ?? ASPHALT)
      }
    }
    for (const s of segmentsOf(site.rails ?? [])) {
      if (segmentDistance(x, z, s.ax, s.az, s.bx, s.bz) < (site.railWidth ?? 24) / 2) {
        return out.setHex(BALLAST)
      }
    }
    // 【沒有墊面就是田】與 `siteGlsl` 一樣整段不算
    const pad = site.pad
    if (pad === undefined) return fieldSurfaceColor(x, z, out, season, open)
    // 【與 `siteGlsl` 一樣先擋外接矩形】次序與早退的條件都要一致
    const near = siteBounds({ ...site, pad })
    if (x <= near.x0 || x >= near.x1 || z <= near.z0 || z >= near.z1) {
      return fieldSurfaceColor(x, z, out, season, open)
    }
    // 【與 `siteGlsl` 一樣，底下全部在廠區局部座標】髒污也是
    const c = Math.cos(site.heading ?? 0)
    const sn = Math.sin(site.heading ?? 0)
    const rx = x - (site.pivot?.x ?? 0)
    const rz = z - (site.pivot?.z ?? 0)
    const lx = rx * c + rz * sn
    const lz = -rx * sn + rz * c
    for (const q of site.outposts ?? []) {
      if (lx >= q.x0 && lx < q.x1 && lz >= q.z0 && lz < q.z1) {
        return out.setHex(q.hex).multiplyScalar(grimeFactor(lx, lz))
      }
    }
    // 【邊界是硬的】著色器那邊只有一像素的柔化，而它是為了抗鋸齒；取樣沒有
    // 像素，直接切
    let d = padDistance(lx, lz, pad)
    for (const l of site.padLobes ?? []) d = Math.min(d, padDistance(lx, lz, l))
    if (d < 0) {
      // 【與 `siteGlsl` 逐項對應】墊面 → 鋪面 → 壓暗，次序一致
      let hex = site.padHex ?? CONCRETE
      for (const q of site.patches ?? []) {
        if (lx >= q.x0 && lx < q.x1 && lz >= q.z0 && lz < q.z1) hex = q.hex
      }
      const dark = 0.9 + 0.1 * Math.min(1, Math.max(0, -d / (PAD_SKIRT * 2)))
      return out.setHex(hex).multiplyScalar(grimeFactor(lx, lz) * dark)
    }
  }
  return fieldSurfaceColor(x, z, out, season, open)
}
