import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createFloraGeometries } from '../../src/render/floraShapes'
import { DAY_PALETTES, type DayPalette } from '../../src/render/timeOfDay'
import {
  buildViewShadeTable, shadeFaces, shadeLightsOf, viewShadeAt, ViewShadeRow,
  VIEW_SHADE_CLASSES, VIEW_SHADE_COLS, VIEW_SHADE_ROWS,
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
  const table = buildViewShadeTable(shadeLightsOf(noon), 'summer')

  it('表的大小：一個樹種一列（三列）、每列 COLS × ROWS 格 RGBA', () => {
    expect(VIEW_SHADE_CLASSES).toBe(3)
    expect(table.length).toBe(VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS * VIEW_SHADE_COLS * 4)
  })

  it('正上方往下看，每一類、每一個方位都是 1', () => {
    for (let row = 0; row < VIEW_SHADE_CLASSES; row++) {
      for (let i = 0; i < VIEW_SHADE_COLS; i++) {
        const o = ((row * VIEW_SHADE_ROWS + VIEW_SHADE_ROWS - 1) * VIEW_SHADE_COLS + i) * 4
        for (let k = 0; k < 3; k++) expect(table[o + k]).toBeCloseTo(1, 6)
      }
    }
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
    const step = buildViewShadeTable(shadeLightsOf(turnSun(noon, (3 / 16) * Math.PI * 2)), 'summer')
    for (let i = 0; i < table.length; i++) expect(step[i]).toBeCloseTo(table[i]!, 5)
    const any = buildViewShadeTable(shadeLightsOf(turnSun(noon, 1.1)), 'summer')
    for (let i = 0; i < table.length; i++) expect(Math.abs(any[i]! - table[i]!)).toBeLessThan(0.02 * table[i]!)
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
