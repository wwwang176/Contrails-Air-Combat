import { describe, expect, it } from 'vitest'
import { farmPlaces, farmSettlementFlora } from '../../src/render/farmSettlements'
import { createFloraBuffer, FLORA_STRIDE, FloraKind, villageSite } from '../../src/render/flora'
import {
  fieldAt, isOpenParcel, regionAt, TRACK_WIDTH, villageDistance, type FieldSample, type RegionSample,
} from '../../src/render/fields'

/** # 程序生成的內陸地圖的村與小聚落（`farmSettlements.ts`） */

const HALF = 20000
const places = farmPlaces(HALF)
const REG: RegionSample = { r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
const FLD: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }

describe('村與小聚落的位置', () => {
  it('每一個村站址都有一個村，村心在站址旁 45 m', () => {
    const site = { x: 0, z: 0 }
    const villages = places.filter((p) => p.kind === 'village')
    let sites = 0
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        if (!villageSite(i, j, site) || Math.abs(site.x) > HALF || Math.abs(site.z) > HALF) continue
        sites++
        const near = villages.filter((p) => Math.hypot(p.x - site.x, p.z - site.z) < 46)
        expect(near).toHaveLength(1)
      }
    }
    expect(villages.length).toBe(sites)
    expect(sites).toBeGreaterThan(30)
  })

  /** 【小聚落在田裡】田最窄也伸到站址外 840 m；落到空地上的話是荒野中間一座孤零零的農莊 */
  it('小聚落落在田裡', () => {
    const hamlets = places.filter((p) => p.kind === 'hamlet')
    expect(hamlets.length).toBeGreaterThan(20)
    for (const h of hamlets) {
      expect(villageDistance(h.x, h.z)).toBeLessThan(840)
      regionAt(h.x, h.z, REG)
      fieldAt(h.x, h.z, REG, FLD)
      expect(isOpenParcel(FLD), h.name).toBe(false)
    }
  })
})

describe('建築', () => {
  const src = farmSettlementFlora(HALF)
  const run = (x0: number, z0: number, x1: number, z1: number): string[] => {
    const buf = createFloraBuffer(200_000)
    src(x0, z0, x1, z1, () => 0, buf)
    const out: string[] = []
    for (let i = 0; i < buf.count; i++) {
      const o = i * FLORA_STRIDE
      out.push(`${buf.data[o]!.toFixed(2)},${buf.data[o + 2]!.toFixed(2)},${buf.kind[i]}`)
    }
    return out.sort()
  }

  it('分割等價：大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const whole = run(-8000, -8000, 8000, 8000)
    const parts: string[] = []
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) parts.push(...run(-8000 + i * 4000, -8000 + j * 4000, -4000 + i * 4000, -4000 + j * 4000))
    }
    expect(parts.sort()).toEqual(whole)
    expect(whole.length).toBeGreaterThan(1000)
  })

  it('房子不蓋在凹路上；教堂只在村裡，小村多半沒有', () => {
    const buf = createFloraBuffer(200_000)
    src(-HALF, -HALF, HALF, HALF, () => 0, buf)
    let churches = 0
    const houses = new Set<number>([FloraKind.House, FloraKind.Barn, FloraKind.SlateHouse, FloraKind.TarBarn])
    for (let i = 0; i < buf.count; i++) {
      const o = i * FLORA_STRIDE
      const x = buf.data[o]!
      const z = buf.data[o + 2]!
      if (houses.has(buf.kind[i]!)) {
        regionAt(x, z, REG)
        expect(REG.r2 - REG.r1).toBeGreaterThanOrEqual(TRACK_WIDTH)
      }
      if (buf.kind[i] === FloraKind.Church) {
        churches++
        const p = places.find((q) => Math.hypot(q.x - x, q.z - z) < 1)!
        expect(p.kind).toBe('village')
      }
    }
    const villages = places.filter((p) => p.kind === 'village').length
    expect(churches).toBeGreaterThan(villages * 0.2)
    expect(churches).toBeLessThan(villages * 0.75)
  })
})
