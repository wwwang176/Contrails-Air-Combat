import { describe, expect, it } from 'vitest'
import { Color, Vector3 } from 'three'
import { createFloraGeometries } from '../../src/render/floraShapes'
import { DAY_PALETTES, type DayPalette } from '../../src/render/timeOfDay'
import {
  buildViewShadeTable, FLORA_ROUGHNESS, pointBaseOf, radianceOf, shadeFaces, shadeLightsOf, STAND_BLOCKING,
  sunSpecular, viewShadeAt, ViewShadeRow, VIEW_SHADE_CLASSES, VIEW_SHADE_COLS, VIEW_SHADE_ROWS,
} from '../../src/render/viewShade'

const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!

/** 把太陽繞 Y 轉 `a` 弧度 */
function turnSun(p: DayPalette, a: number): DayPalette {
  const [x, y, z] = p.sunDir
  return { ...p, sunDir: [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)] }
}

/** 水平視線與太陽水平方向夾 `phi`、仰角正弦 `s` 時，物件指向鏡頭的方向 */
function toCamera(p: DayPalette, phi: number, s: number): Vector3 {
  const L = new Vector3(...p.sunDir)
  const h = Math.hypot(L.x, L.z)
  const sx = L.x / h
  const sz = L.z / h
  const vx = sx * Math.cos(phi) - sz * Math.sin(phi)
  const vz = sx * Math.sin(phi) + sz * Math.cos(phi)
  const ce = Math.sqrt(1 - s * s)
  return new Vector3(-vx * ce, s, -vz * ce)
}

describe('視角係數的查表', () => {
  const noon = DAY_PALETTES.noon
  const table = buildViewShadeTable(noon, 'summer')

  it('表的大小：一個樹種一列（三列）、每列 COLS × ROWS 格 RGBA', () => {
    expect(VIEW_SHADE_CLASSES).toBe(3)
    expect(table.length).toBe(VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS * VIEW_SHADE_COLS * 4)
  })

  it('點畫出來是中級樹冠的輻射：表 × 點的底色 = 中級樹冠從那個方向看的平均輻射', () => {
    const geos = createFloraGeometries('summer')
    const faces = shadeFaces(geos.broadMid)
    const L = shadeLightsOf(noon)
    const sunH = new Vector3(noon.sunDir[0], 0, noon.sunDir[2]).normalize()
    const base = pointBaseOf('broadPoint', 'summer', noon)
    for (const [phi, j] of [[0, 3], [Math.PI / 2, 8], [Math.PI, VIEW_SHADE_ROWS - 1]] as const) {
      const V = toCamera(noon, phi, j / (VIEW_SHADE_ROWS - 1))
      const rad = [0, 0, 0]
      radianceOf(faces, V, L, STAND_BLOCKING, rad)
      const k = viewShadeAt(table, ViewShadeRow.Broad, V, sunH.x, sunH.z)
      expect(k[0] * base.r).toBeCloseTo(rad[0]!, 3)
      expect(k[1] * base.g).toBeCloseTo(rad[1]!, 3)
      expect(k[2] * base.b).toBeCloseTo(rad[2]!, 3)
    }
  })

  it('點的材質色（時段倍率與染色）在表裡除掉：倍率減半，表加倍', () => {
    const half = buildViewShadeTable({ ...noon, foliage: noon.foliage / 2 }, 'summer')
    for (let i = 0; i < table.length; i += 4) expect(half[i]).toBeCloseTo(table[i]! * 2, 4)
    const tinted = buildViewShadeTable({ ...noon, foliageTint: 0xff8040 }, 'summer')
    const tint = new Color().setHex(0xff8040)
    for (let i = 0; i < table.length; i += 4) {
      expect(tinted[i]! * tint.r).toBeCloseTo(table[i]!, 4)
      expect(tinted[i + 2]! * tint.b).toBeCloseTo(table[i + 2]!, 4)
    }
  })

  it('林子的遮擋：背光低角度看到的多半是被照亮的上半部，比孤樹亮', () => {
    const lone = buildViewShadeTable(noon, 'summer', 0)
    const sunH = new Vector3(noon.sunDir[0], 0, noon.sunDir[2]).normalize()
    const V = toCamera(noon, Math.PI, 0.15)
    const a = viewShadeAt(table, ViewShadeRow.Broad, V, sunH.x, sunH.z)
    const b = viewShadeAt(lone, ViewShadeRow.Broad, V, sunH.x, sunH.z)
    expect(lum(a)).toBeGreaterThan(lum(b) * 1.03)
  })

  it('正午低角度：迎著太陽比背著太陽暗', () => {
    const sunH = new Vector3(noon.sunDir[0], 0, noon.sunDir[2]).normalize()
    for (const row of [ViewShadeRow.Broad, ViewShadeRow.Cone]) {
      const into = viewShadeAt(table, row, toCamera(noon, 0, 0.17), sunH.x, sunH.z)
      const away = viewShadeAt(table, row, toCamera(noon, Math.PI, 0.17), sunH.x, sunH.z)
      expect(lum(into)).toBeLessThan(lum(away) * 0.7)
    }
  })

  it('表只跟「相對太陽的方位」有關：太陽繞 Y 轉，表不變', () => {
    // 轉整數個轉向間隔（16 個）時逐格相同；任意角度只差在轉向取樣的離散化
    const step = buildViewShadeTable(turnSun(noon, (3 / 16) * Math.PI * 2), 'summer')
    for (let i = 0; i < table.length; i++) expect(step[i]).toBeCloseTo(table[i]!, 5)
    const any = buildViewShadeTable(turnSun(noon, 1.1), 'summer')
    // 鏡面那一項隨轉向變得比漫射快，16 個轉向的離散化誤差到 2.5%
    for (let i = 0; i < table.length; i++) expect(Math.abs(any[i]! - table[i]!)).toBeLessThan(0.03 * table[i]!)
  })

  it('查表與表格點上的值一致：迎光、背光兩端', () => {
    const sunH = new Vector3(noon.sunDir[0], 0, noon.sunDir[2]).normalize()
    const s = 4 / (VIEW_SHADE_ROWS - 1)
    const into = viewShadeAt(table, ViewShadeRow.Broad, toCamera(noon, 0, s), sunH.x, sunH.z)
    const away = viewShadeAt(table, ViewShadeRow.Broad, toCamera(noon, Math.PI, s), sunH.x, sunH.z)
    const at = (i: number): number[] => {
      const o = ((ViewShadeRow.Broad * VIEW_SHADE_ROWS + 4) * VIEW_SHADE_COLS + i) * 4
      return [table[o]!, table[o + 1]!, table[o + 2]!]
    }
    for (let k = 0; k < 3; k++) {
      expect(into[k]).toBeCloseTo(at(VIEW_SHADE_COLS - 1)[k]!, 5)
      expect(away[k]).toBeCloseTo(at(0)[k]!, 5)
    }
  })
})

describe('太陽的鏡面反射', () => {
  it('與 three 標準材質的 BRDF_GGX 同一條式子：正向入射、正向觀看時的值', () => {
    // n = L = V = 上：n·L = n·V = n·H = v·H = 1。F = 0.04 + 0.96·2^(−12.54)，
    // Vis = 0.5 / (1 + 1) = 1/4，D = 1/(π·α²)，α = 粗糙度² = 0.81
    const up = new Vector3(0, 1, 0)
    const a = FLORA_ROUGHNESS * FLORA_ROUGHNESS
    const f = 0.04 + 0.96 * 2 ** (-5.55473 - 6.98316)
    expect(sunSpecular(0, 1, 0, up, up)).toBeCloseTo(f * 0.25 * (1 / (Math.PI * a * a)), 6)
  })

  it('背對太陽的面沒有鏡面反射', () => {
    expect(sunSpecular(0, -1, 0, new Vector3(0, 1, 0), new Vector3(0, 1, 0))).toBe(0)
  })

  it('平均輻射含鏡面那一項：只有一面朝上的「樹」，比單純的漫射亮', () => {
    const face = { nx: 0, ny: 1, nz: 0, area: 1, r: 0.1, g: 0.1, b: 0.1, depth: [0] }
    const L = shadeLightsOf(DAY_PALETTES.noon)
    const V = new Vector3(0, 1, 0)
    const rad = [0, 0, 0]
    radianceOf([face], V, L, 0, rad)
    const nl = L.sun.y
    const diffuse = (0.1 * (L.sunColor.r * nl + L.sky.r + L.ambient.r)) / Math.PI
    expect(rad[0]).toBeGreaterThan(diffuse * 1.05)
  })
})

describe('拿來算係數的面', () => {
  it('房子的箱體頂面藏在屋頂底下，不算', () => {
    const geos = createFloraGeometries('summer')
    const faces = shadeFaces(geos.house)
    // 朝正上方的面只有箱體頂面（屋頂是兩片斜面）
    expect(faces.some((f) => f.ny > 0.99)).toBe(false)
    // 四面牆、兩片屋頂、兩個山牆都還在
    expect(faces.filter((f) => Math.abs(f.ny) < 0.01).length).toBeGreaterThanOrEqual(10)
    expect(faces.filter((f) => f.ny > 0.5 && f.ny < 0.99).length).toBe(4)
  })

  it('凸的樹冠一面都不剔', () => {
    const geos = createFloraGeometries('summer')
    expect(shadeFaces(geos.broadMid).length).toBe(8)
    expect(shadeFaces(geos.coneMid).length).toBe(6)
  })
})
