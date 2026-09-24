import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  fieldAt, fieldGlsl, FIELD_GLSL, FIELD_REACH, isOpenParcel, openWoodCover, regionAt, REGION_SPACING,
  VILLAGE_CHANCE, villageDistance, fieldSurfaceColor,
  type FieldSample, type RegionSample,
} from '../../src/render/fields'
import {
  createFloraBuffer, farmHedgeFlora, farmWoodFlora, FLORA_STRIDE, openHedgeFlora, openWoodFlora,
  villageSite, type FloraSource,
} from '../../src/render/flora'

/**
 * # 田圍著村（`fields.ts` 的 `FIELD_REACH`）
 *
 * 程序生成的內陸地圖：田只在村的周圍，其餘是空地（牧草地、荒地、休耕）與成團
 * 的樹林。
 */

const REG: RegionSample = { r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
const FLD: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }
const parcel = (x: number, z: number): FieldSample => {
  regionAt(x, z, REG)
  fieldAt(x, z, REG, FLD)
  return FLD
}

describe('哪些地是空地', () => {
  /** 【一半上下】田太少的話整張圖是荒地；太多的話又回到一路是田 */
  it('空地佔三成五到七成五', () => {
    let open = 0
    let n = 0
    for (let x = -20000; x < 20000; x += 173) {
      for (let z = -20000; z < 20000; z += 191) {
        if (isOpenParcel(parcel(x, z))) open++
        n++
      }
    }
    expect(open / n).toBeGreaterThan(0.35)
    expect(open / n).toBeLessThan(0.75)
  })

  /** 【村旁一定是田、離村很遠一定是空地】範圍最小是 0.7 × 0.8 倍、最大 1.3 × 1.2 倍 */
  it('村旁 800 m 內一定是田；離村 2.4 km 外一定是空地', () => {
    let near = 0
    let far = 0
    for (let x = -20000; x < 20000; x += 97) {
      for (let z = -20000; z < 20000; z += 103) {
        const f = parcel(x, z)
        const d = villageDistance(f.cx, f.cz)
        if (d < FIELD_REACH * 0.7 * 0.8 - 1) {
          expect(isOpenParcel(f), `(${x},${z})`).toBe(false)
          near++
        } else if (d > FIELD_REACH * 1.3 * 1.2 + 1) {
          expect(isOpenParcel(f), `(${x},${z})`).toBe(true)
          far++
        }
      }
    }
    expect(near).toBeGreaterThan(1000)
    expect(far).toBeGreaterThan(1000)
  })

  /**
   * 【交界落在田界上】用地塊的中心判斷，所以同一塊地裡的每一點答案相同 —— 用
   * 每一點自己的位置判斷的話，交界會切過一塊田
   */
  it('同一塊地裡的每一點答案相同', () => {
    const byParcel = new Map<string, boolean>()
    for (let x = -8000; x < 8000; x += 37) {
      for (let z = -8000; z < 8000; z += 41) {
        const f = parcel(x, z)
        const key = `${f.id}:${f.cx.toFixed(3)}:${f.cz.toFixed(3)}`
        const o = isOpenParcel(f)
        const seen = byParcel.get(key)
        if (seen !== undefined) expect(o, key).toBe(seen)
        byParcel.set(key, o)
      }
    }
    expect(byParcel.size).toBeGreaterThan(1000)
  })

  /** 【站址與植被的村同一套】`villageSite` 生的每一個村，`villageDistance` 都量得到 */
  it('植被的村都在 villageDistance 找得到的站址上', () => {
    const out = { x: 0, z: 0 }
    let checked = 0
    for (let i = -6; i < 6; i++) {
      for (let j = -6; j < 6; j++) {
        if (!villageSite(i, j, out)) continue
        expect(villageDistance(out.x, out.z)).toBeLessThan(1e-6)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(144 * VILLAGE_CHANCE * 0.5)
    expect(REGION_SPACING).toBe(3200)
  })
})

describe('地色', () => {
  it('open 的空地沒有樹籬色也沒有作物色；不開時與原本逐位元相同', () => {
    const a = new Color()
    const b = new Color()
    let differ = 0
    for (let x = -12000; x < 12000; x += 131) {
      for (let z = -12000; z < 12000; z += 137) {
        fieldSurfaceColor(x, z, a, 'summer', false)
        fieldSurfaceColor(x, z, b, 'summer')
        expect(a.equals(b)).toBe(true)
        fieldSurfaceColor(x, z, b, 'summer', true)
        if (!a.equals(b)) differ++
      }
    }
    expect(differ).toBeGreaterThan(1000)
  })

  it('GLSL：不開時與原本逐字相同；開的那一份有同一組常數與判準', () => {
    expect(fieldGlsl('summer')).toBe(FIELD_GLSL)
    const open = fieldGlsl('summer', false, true)
    expect(open).toContain(`const float FIELD_REACH = ${FIELD_REACH.toFixed(1)};`)
    expect(open).toContain(`const float VILLAGE_CHANCE = ${VILLAGE_CHANCE.toFixed(3)};`)
    expect(open).toContain('bool isOpenParcel(vec2 centre, uint fh)')
    expect(open).toContain('if (isOpenParcel(parcel, fh)) {')
    // 空地在條紋之後、樹籬之前
    expect(open.indexOf('if (isOpenParcel(parcel, fh))')).toBeGreaterThan(open.indexOf('col *= stripe('))
    expect(open.indexOf('if (isOpenParcel(parcel, fh))')).toBeLessThan(open.indexOf('col = mix(col, HEDGE_COLOR'))
  })
})

describe('樹籬與樹林', () => {
  const run = (src: FloraSource, x0: number, z0: number, size: number): { x: number; z: number }[] => {
    const buf = createFloraBuffer(200_000)
    src(x0, z0, x0 + size, z0 + size, () => 0, buf)
    expect(buf.dropped).toBe(0)
    const out: { x: number; z: number }[] = []
    for (let i = 0; i < buf.count; i++) out.push({ x: buf.data[i * FLORA_STRIDE]!, z: buf.data[i * FLORA_STRIDE + 2]! })
    return out
  }

  it('空地的邊不長樹籬；田那一側照長', () => {
    const all = run(farmHedgeFlora, -3000, -3000, 6000)
    const open = run(openHedgeFlora, -3000, -3000, 6000)
    expect(open.length).toBeLessThan(all.length * 0.8)
    expect(open.length).toBeGreaterThan(all.length * 0.15)
    for (const p of open) expect(isOpenParcel(parcel(p.x, p.z))).toBe(false)
  })

  /** 【放置與地色共用覆蓋率】空地上的樹只長在覆蓋率大於 0 的地方 */
  it('空地上的樹林跟著 openWoodCover，而且比原本的樹林多', () => {
    const before = run(farmWoodFlora, -6000, -6000, 12000)
    const after = run(openWoodFlora, -6000, -6000, 12000)
    expect(after.length).toBeGreaterThan(before.length * 1.5)
    let inOpen = 0
    for (const p of after) {
      if (!isOpenParcel(parcel(p.x, p.z))) continue
      inOpen++
      expect(openWoodCover(p.x, p.z)).toBeGreaterThan(0)
    }
    expect(inOpen).toBeGreaterThan(1000)
  })
})
