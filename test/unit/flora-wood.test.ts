import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  createFloraBuffer, farmWoodFlora, FloraKind, FLORA_STRIDE, WOOD_GRID,
} from '../../src/render/flora'
import {
  fieldAt, fieldSurfaceColor, isWoodField, regionAt, HEDGE_WIDTH, TRACK_WIDTH,
  type FieldSample, type RegionSample,
} from '../../src/render/fields'

const reg: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const s: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }
const col = new Color()
const FLAT = (): number => 0
const BUF = createFloraBuffer(65536)

interface Row { x: number; y: number; z: number; kind: number }

function collect(x0: number, z0: number, x1: number, z1: number): Row[] {
  BUF.count = 0
  BUF.dropped = 0
  farmWoodFlora(x0, z0, x1, z1, FLAT, BUF)
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

/** 這一片的樹林田佔多少面積，m² */
function woodArea(x0: number, z0: number, x1: number, z1: number, step: number): number {
  let n = 0
  for (let z = z0; z < z1; z += step) {
    for (let x = x0; x < x1; x += step) {
      regionAt(x, z, reg)
      if (reg.r2 - reg.r1 < TRACK_WIDTH) continue
      fieldAt(x, z, reg, s)
      if (isWoodField(s.id)) n++
    }
  }
  return n * step * step
}

describe('樹林', () => {
  it('分割等價：大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const whole = collect(-600, -600, 600, 600).map(key).sort()
    const parts: string[] = []
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        parts.push(...collect(
          -600 + 300 * i, -600 + 300 * j, -600 + 300 * (i + 1), -600 + 300 * (j + 1),
        ).map(key))
      }
    }
    expect(whole.length).toBeGreaterThan(150)
    expect(parts.sort()).toEqual(whole)
  })

  it('每一棵都在樹林田裡，而且筆數夠多', () => {
    const rows = collect(-600, -600, 600, 600)
    for (const r of rows) {
      regionAt(r.x, r.z, reg)
      fieldAt(r.x, r.z, reg, s)
      expect(isWoodField(s.id)).toBe(true)
    }
    // 【不得是空操作】1.44 km² × 5% × 3,906/km² ≈ 281 棵
    expect(rows.length).toBeGreaterThan(150)
  })

  /**
   * 【這一條把放置與地色釘在同一個判準上】兩邊分家的話，會出現「深綠的地上
   * 沒有樹」或「樹長在麥田裡」—— 而兩者在空中都一眼看得出來。
   */
  it('每一棵腳下的地色就是樹林色', () => {
    const rows = collect(-600, -600, 600, 600)
    expect(rows.length).toBeGreaterThan(150)
    const wood = new Set<string>()
    for (const r of rows) wood.add(fieldSurfaceColor(r.x, r.z, col).getHexString())
    // 樹林田是單一顏色 —— 不吃色盤，也不吃明度抖動
    expect(wood.size).toBe(1)
    expect([...wood][0]).toBe('2f3a28')
  })

  it('樹林的樹不長在樹籬帶上', () => {
    const rows = collect(-600, -600, 600, 600)
    expect(rows.length).toBeGreaterThan(150)
    for (const r of rows) {
      regionAt(r.x, r.z, reg)
      fieldAt(r.x, r.z, reg, s)
      // 樹林田的邊界仍然是樹籬，那一條由 farmHedgeFlora 種 —— 不疊兩層
      expect(s.edge).toBeGreaterThanOrEqual(HEDGE_WIDTH / 2)
    }
  })

  /**
   * 密度要對著**實際的樹林面積**比，不是對著整個窗 —— 樹林佔多少是隨窗變的。
   */
  it('樹林裡的密度就是 WOOD_GRID 的網格密度', () => {
    const x0 = -600
    const z0 = -600
    const x1 = 600
    const z1 = 600
    const rows = collect(x0, z0, x1, z1)
    const area = woodArea(x0, z0, x1, z1, 4)
    const perKm2 = (rows.length / area) * 1e6
    const want = 1e6 / (WOOD_GRID * WOOD_GRID)
    console.log(JSON.stringify({
      樹林棵數: rows.length,
      樹林面積: (area / 1e6).toFixed(3) + ' km²',
      每平方公里: perKm2.toFixed(0),
      網格密度: want.toFixed(0),
    }))
    // 【比網格密度低一點是對的】樹籬帶那一圈被扣掉了
    expect(perKm2).toBeGreaterThan(want * 0.6)
    expect(perKm2).toBeLessThan(want * 1.05)
  })

  it('每一株都落在自己那一格裡，而且站在地上', () => {
    const ramp = (x: number, z: number): number => x * 0.03 - z * 0.01
    let n = 0
    for (let tz = -750; tz < 750; tz += 250) {
      for (let tx = -750; tx < 750; tx += 250) {
        BUF.count = 0
        BUF.dropped = 0
        farmWoodFlora(tx, tz, tx + 250, tz + 250, ramp, BUF)
        for (let i = 0; i < BUF.count; i++) {
          const o = i * FLORA_STRIDE
          const x = BUF.data[o]!
          const z = BUF.data[o + 2]!
          expect(x).toBeGreaterThanOrEqual(tx)
          expect(x).toBeLessThan(tx + 250)
          expect(z).toBeGreaterThanOrEqual(tz)
          expect(z).toBeLessThan(tz + 250)
          expect(BUF.data[o + 1]!).toBeCloseTo(ramp(x, z), 4)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(100)
  })

  it('一整片樹林是同一種樹', () => {
    // 【窗要夠大】1.44 km² 只裝得下三塊樹林田，分不出「逐田」與「逐塊地」
    const rows = collect(-1500, -1500, 1500, 1500)
    expect(rows.length).toBeGreaterThan(900)
    // 同一塊田的樹全部同種 —— 混種的樹林從空中看是雜訊
    const byField = new Map<number, Set<number>>()
    for (const r of rows) {
      regionAt(r.x, r.z, reg)
      fieldAt(r.x, r.z, reg, s)
      const set = byField.get(s.id) ?? new Set<number>()
      set.add(r.kind)
      byField.set(s.id, set)
    }
    expect(byField.size).toBeGreaterThan(5)
    for (const set of byField.values()) expect(set.size).toBe(1)
  })

  it('只長喬木，不長灌木或房子', () => {
    const rows = collect(-600, -600, 600, 600)
    expect(rows.length).toBeGreaterThan(150)
    for (const r of rows) {
      expect(r.kind === FloraKind.BroadTree || r.kind === FloraKind.ConeTree).toBe(true)
    }
  })
})
