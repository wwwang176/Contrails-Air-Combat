import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  createFloraBuffer, createIslandFlora, FloraKind, FLORA_STRIDE, ISLAND_GRID,
} from '../../src/render/flora'
import { createArchipelago, type IslandDesc } from '../../src/world/archipelago'
import { isGrass, shade } from '../../src/render/island'

const arch = createArchipelago()
const source = createIslandFlora(arch.field, arch.islands)
const height = (x: number, z: number): number => arch.field.sample(x, z)
const BUF = createFloraBuffer(65536)
const col = new Color()

/** 標稱半徑最大的那一座 */
const big: IslandDesc = [...arch.islands].sort((a, b) => b.radius - a.radius)[0]!

interface Row { x: number; y: number; z: number; kind: number }

function collect(x0: number, z0: number, x1: number, z1: number): Row[] {
  BUF.count = 0
  BUF.dropped = 0
  source(x0, z0, x1, z1, height, BUF)
  expect(BUF.dropped).toBe(0)
  const out: Row[] = []
  for (let i = 0; i < BUF.count; i++) {
    const o = i * FLORA_STRIDE
    out.push({
      x: BUF.data[o]!, y: BUF.data[o + 1]!, z: BUF.data[o + 2]!, kind: BUF.kind[i]!,
    })
  }
  return out
}

const key = (r: Row): string => [r.x, r.y, r.z, r.kind].join(',')

/** 這個點最近的那座島 */
function nearest(x: number, z: number): IslandDesc {
  let best = arch.islands[0]!
  let bd = Infinity
  for (const isl of arch.islands) {
    const d = Math.hypot(isl.cx - x, isl.cz - z)
    if (d < bd) { bd = d; best = isl }
  }
  return best
}

function onBig(): Row[] {
  const r = big.outerRadius
  return collect(big.cx - r, big.cz - r, big.cx + r, big.cz + r)
}

describe('群島的樹', () => {
  /** 【不得是空操作】沒有這一條，一個永遠回零的來源可以通過下面每一條 */
  it('最大的那座島上樹夠多', () => {
    const rows = onBig()
    console.log(JSON.stringify({
      島半徑: big.radius.toFixed(0) + ' m',
      峰高: big.peak.toFixed(0) + ' m',
      棵數: rows.length,
    }))
    expect(rows.length).toBeGreaterThan(300)
  })

  it('每一棵都長在綠色的地方', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    const grassHex = shade(20, 1000, col).getHex()
    for (const r of rows) {
      const h = height(r.x, r.z)
      const isl = nearest(r.x, r.z)
      expect(isGrass(h, isl.peak)).toBe(true)
      // 判準與**畫面上那一支**對得起來，不只是與自己的常數對得起來
      expect(shade(h, isl.peak, col).getHex()).toBe(grassHex)
    }
  })

  /**
   * 【這一條擋的是拿錯 SHORE_BAND】`world/archipelago.ts` 也有一個同名常數，
   * 值是 200。錯用它當下界的話，生出來的樹只是 `isGrass` 真集合的子集 ——
   * 上面那一條照樣全綠，而 12～200 m 的大片綠帶會整片光禿。
   */
  it('12 到 200 m 的草帶確實有樹', () => {
    const rows = onBig()
    const band = rows.filter((r) => {
      const h = height(r.x, r.z)
      return h >= 12 && h < 200
    })
    console.log(JSON.stringify({ 全部: rows.length, 在12到200之間: band.length }))
    expect(band.length).toBeGreaterThan(150)
  })

  it('沒有一棵在海裡', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    for (const r of rows) expect(height(r.x, r.z)).toBeGreaterThan(0)
  })

  it('每一棵都站在地上', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    for (const r of rows) expect(r.y).toBeCloseTo(height(r.x, r.z), 3)
  })

  it('陡的地方比緩的地方稀疏', () => {
    const r = big.outerRadius
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    // 島上可以長樹的地方，按坡度分兩堆，各自量「有樹的比例」
    const cell = arch.field.cell
    const slopeAt = (x: number, z: number): number => {
      const dx = (height(x + cell, z) - height(x - cell, z)) / (2 * cell)
      const dz = (height(x, z + cell) - height(x, z - cell)) / (2 * cell)
      return Math.atan(Math.hypot(dx, dz))
    }
    let gentleArea = 0
    let steepArea = 0
    const STEP = 20
    for (let z = big.cz - r; z < big.cz + r; z += STEP) {
      for (let x = big.cx - r; x < big.cx + r; x += STEP) {
        if (!isGrass(height(x, z), nearest(x, z).peak)) continue
        if (slopeAt(x, z) < Math.PI / 6) gentleArea++
        else steepArea++
      }
    }
    let gentle = 0
    let steep = 0
    for (const row of rows) {
      if (slopeAt(row.x, row.z) < Math.PI / 6) gentle++
      else steep++
    }
    const gd = gentle / gentleArea
    const sd = steep / steepArea
    console.log(JSON.stringify({
      緩坡密度: gd.toFixed(4), 陡坡密度: sd.toFixed(4), 比: (sd / gd).toFixed(2),
    }))
    expect(gentleArea).toBeGreaterThan(100)
    expect(steepArea).toBeGreaterThan(100)
    expect(sd).toBeLessThan(gd * 0.92)
  })

  it('全是海的那一格回 0 筆', () => {
    // 場地一角，離任何一座島都很遠
    const rows = collect(19000, 19000, 19250, 19250)
    expect(rows.length).toBe(0)
  })

  it('分割等價：大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const r = big.outerRadius
    const whole = onBig().map(key).sort()
    const parts: string[] = []
    const w = (2 * r) / 4
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        parts.push(...collect(
          big.cx - r + w * i, big.cz - r + w * j,
          big.cx - r + w * (i + 1), big.cz - r + w * (j + 1),
        ).map(key))
      }
    }
    expect(whole.length).toBeGreaterThan(300)
    expect(parts.sort()).toEqual(whole)
  })

  it('每一棵都落在自己那一格裡', () => {
    let n = 0
    const r = big.outerRadius
    for (let tz = big.cz - r; tz < big.cz + r; tz += 250) {
      for (let tx = big.cx - r; tx < big.cx + r; tx += 250) {
        for (const row of collect(tx, tz, tx + 250, tz + 250)) {
          expect(row.x).toBeGreaterThanOrEqual(tx)
          expect(row.x).toBeLessThan(tx + 250)
          expect(row.z).toBeGreaterThanOrEqual(tz)
          expect(row.z).toBeLessThan(tz + 250)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(300)
  })

  it('島上一律針葉，不長灌木或房子', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    for (const r of rows) expect(r.kind).toBe(FloraKind.ConeTree)
  })

  it('密度不超過網格上限', () => {
    const rows = onBig()
    const area = (2 * big.outerRadius) ** 2
    const perKm2 = (rows.length / area) * 1e6
    const grid = 1e6 / (ISLAND_GRID * ISLAND_GRID)
    console.log(JSON.stringify({
      每平方公里: perKm2.toFixed(0), 網格上限: grid.toFixed(0),
    }))
    expect(perKm2).toBeLessThan(grid)
  })
})
