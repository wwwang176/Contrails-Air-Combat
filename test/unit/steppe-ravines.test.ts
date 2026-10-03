import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { createFloraBuffer, FLORA_STRIDE, FloraKind, type FloraBuffer } from '../../src/render/flora'
import { regionAt, trackGap, trackWidthAt, type RegionSample } from '../../src/render/fields'
import { FIELD_COLORS } from '../../src/render/season'
import { columnGround, MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'
import { farmSettlements } from '../../src/render/farmSettlements'
import {
  buildRavineFords, buildRavineStripes, FORD_CELL, RAVINE_BOTTOM, RAVINE_HOUSE_CLEAR, RAVINE_RIM_FADE, RAVINE_RIM_SOLID,
  RAVINE_ROAD_CLEAR, RAVINE_SLOPE, steppeRavineFloraFor, STRIPE_SECTION,
} from '../../src/render/steppeRavines'
import { rzhevVillageKeepOut } from '../../src/render/terrain'
import {
  at, battleKeepOut, BELT_BOX, burnRateOf, isLargeVillage, PANZER_ROUTE_A, PANZER_ROUTE_B, shelterbeltFade,
  T34_RESERVE_EAST, T34_RESERVE_WEST, toLocal,
} from '../../src/world/rzhev'
import {
  RAVINE_MIN_FADE, RAVINE_MIN_SCALE, RAVINE_STEP, RAVINES, ravineGap,
} from '../../src/world/rzhevRavines'

const FLAT = (): number => 0
const reg: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

const ORIGIN = at(0, 0)
const X0 = Math.round(ORIGIN.x / 1000) * 1000
const Z0 = Math.round(ORIGIN.z / 1000) * 1000

interface Tree { x: number; z: number; kind: number; key: string }

function run(x0: number, z0: number, x1: number, z1: number): Tree[] {
  const buf: FloraBuffer = createFloraBuffer(400000)
  steppeRavineFloraFor(RAVINES)(x0, z0, x1, z1, FLAT, buf)
  expect(buf.dropped).toBe(0)
  const out: Tree[] = []
  for (let i = 0; i < buf.count; i++) {
    const o = i * FLORA_STRIDE
    out.push({
      x: buf.data[o]!, z: buf.data[o + 2]!, kind: buf.kind[i]!,
      key: Array.from(buf.data.subarray(o, o + FLORA_STRIDE)).join(',') + ',' + buf.kind[i],
    })
  }
  return out
}

const HALF = 8000
const all = run(X0 - HALF, Z0 - HALF, X0 + HALF, Z0 + HALF)

describe('沖溝的走向', () => {
  it('有幾十截，每截夠長、相鄰兩點約 60 m、都是有限的數', () => {
    expect(RAVINES.length).toBeGreaterThan(20)
    for (const r of RAVINES) {
      expect(r.points.length).toBeGreaterThanOrEqual(6)
      for (let i = 0; i < r.points.length; i++) {
        const p = r.points[i]!
        expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true)
        if (i > 0) expect(Math.hypot(p.x - r.points[i - 1]!.x, p.z - r.points[i - 1]!.z)).toBeCloseTo(RAVINE_STEP, 6)
      }
    }
  })

  it('每一個點都在戰場方框之外：濃度不低於門檻', () => {
    for (const r of RAVINES) {
      for (const p of r.points) {
        expect(shelterbeltFade(p.x, p.z)).toBeGreaterThanOrEqual(RAVINE_MIN_FADE)
        const l = toLocal(p.x, p.z)
        const inside = Math.abs(l.lx) < BELT_BOX.half && l.lz > BELT_BOX.north && l.lz < BELT_BOX.south
        expect(inside).toBe(false)
      }
    }
  })

  it('寬度倍率與點等長、落在最窄與 1 之間，相鄰兩點相差不大（漸變，不是斷崖）', () => {
    for (const r of RAVINES) {
      expect(r.scale).toHaveLength(r.points.length)
      for (let i = 0; i < r.scale.length; i++) {
        expect(r.scale[i]!).toBeGreaterThanOrEqual(RAVINE_MIN_SCALE - 1e-9)
        expect(r.scale[i]!).toBeLessThanOrEqual(1)
        if (i > 0) expect(Math.abs(r.scale[i]! - r.scale[i - 1]!)).toBeLessThan(0.35)
      }
    }
  })

  /**
   * 【頭尾收尖】溝頭、溝尾與靠近戰場方框的地方都收窄，不是在全寬的地方突然斷掉。
   * 每一截至少有一端是尖的：主溝的溝頭與溝尾、支溝的溝頭、任何被方框截斷的那一端。
   */
  it('每一截至少有一端收得很窄', () => {
    for (const r of RAVINES) {
      expect(Math.min(r.scale[0]!, r.scale[r.scale.length - 1]!)).toBeLessThanOrEqual(0.2)
    }
  })

  it('是蜿蜒的：一截的弧長比首尾直線距離長，平均長 1.5% 以上', () => {
    let ratio = 0
    let n = 0
    for (const r of RAVINES) {
      if (r.points.length < 20) continue
      const a = r.points[0]!
      const b = r.points[r.points.length - 1]!
      ratio += ((r.points.length - 1) * RAVINE_STEP) / Math.hypot(b.x - a.x, b.z - a.z)
      n++
    }
    expect(n).toBeGreaterThan(10)
    expect(ratio / n).toBeGreaterThan(1.015)
  })
})

describe('沖溝的樹與灌木', () => {
  it('16 × 16 km 裡有幾千株，有灌木、闊葉與針葉', () => {
    expect(all.length).toBeGreaterThan(3000)
    expect(all.length).toBeLessThan(60000)
    for (const k of [FloraKind.Bush, FloraKind.BroadTree, FloraKind.ConeTree]) {
      expect(all.some((t) => t.kind === k)).toBe(true)
    }
  })

  it('分割等價：一整塊與切成 3 × 3 的聯集逐株相同', () => {
    // 取一條長溝的中點為中心，窗裡才有溝
    const long = RAVINES.find((r) => r.points.length >= 30)!
    const mid = long.points[Math.floor(long.points.length / 2)]!
    const size = 3000
    const x0 = mid.x - size / 2
    const z0 = mid.z - size / 2
    const whole = run(x0, z0, x0 + size, z0 + size)
    expect(whole.length).toBeGreaterThan(100)
    const parts: Tree[] = []
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        parts.push(...run(x0 + (i * size) / 3, z0 + (j * size) / 3, x0 + ((i + 1) * size) / 3, z0 + ((j + 1) * size) / 3))
      }
    }
    expect(parts.map((t) => t.key).sort()).toEqual(whole.map((t) => t.key).sort())
  })

  it('每一株都在溝的樹帶裡：離中線不超過最寬的半寬', () => {
    const maxBand = Math.max(...RAVINES.map((r) => r.band))
    for (const t of all) expect(ravineGap(t.x, t.z)).toBeLessThanOrEqual(maxBand + 0.5)
  })

  it('不蓋在凹路上', () => {
    for (const t of all) {
      regionAt(t.x, t.z, reg)
      expect(trackGap(t.x, t.z, reg)).toBeGreaterThanOrEqual(trackWidthAt(t.x, t.z) + RAVINE_ROAD_CLEAR)
    }
  })

  it('溝頭與溝尾的樹比較稀：收窄的地方一棵一棵少，不是整排一起消失在全寬處', () => {
    // 每條溝頭 8 點（約 480 m）內的株數，比同樣長度的中段少
    let head = 0
    let mid = 0
    let n = 0
    for (const r of RAVINES) {
      if (r.points.length < 40 || r.scale[0]! > 0.2) continue
      const near = (p: { x: number; z: number }, a: number, b: number): boolean => {
        for (let i = a; i < b; i++) if (Math.hypot(p.x - r.points[i]!.x, p.z - r.points[i]!.z) < 30) return true
        return false
      }
      for (const t of all) {
        if (near(t, 0, 8)) head++
        else if (near(t, 16, 24)) mid++
      }
      n++
    }
    expect(n).toBeGreaterThan(2)
    expect(head).toBeLessThan(mid * 0.8)
  })
})

describe('沖溝不壓在任務的單位與路線上', () => {
  /**
   * 戰場方框（`BELT_BOX`）擋住了溝，但縱隊的路線與出發點、預備隊的路線也得在溝帶之外：
   * 溝帶蓋掉路與田，而渡口只補凹路；樹冠與灌木不該長在車隊走的地方。
   */
  it('縱隊與預備隊的路線頂點、縱隊的出發位置，離任何溝的中線都在 80 m 以上', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const pts: { x: number; z: number }[] = [
      ...PANZER_ROUTE_A, ...PANZER_ROUTE_B, ...T34_RESERVE_WEST, ...T34_RESERVE_EAST,
    ]
    for (const col of card.battle.columns ?? []) for (const g of columnGround(col)) pts.push(g)
    expect(pts.length).toBeGreaterThan(20)
    for (const p of pts) expect(ravineGap(p.x, p.z)).toBeGreaterThan(80)
  })
})

describe('村讓開沖溝', () => {
  const HALF_V = 12000
  /** 房子與棚子 */
  const houseKinds = new Set<number>([FloraKind.House, FloraKind.SlateHouse, FloraKind.Barn, FloraKind.TarBarn])
  const build = (keepOut: (x: number, z: number) => boolean): { x: number; z: number }[] => {
    const v = farmSettlements(HALF_V, 'winterSteppe', { keepOut, burnRate: burnRateOf, large: isLargeVillage })
    const buf = createFloraBuffer(400000)
    v.flora(ORIGIN.x - HALF_V, ORIGIN.z - HALF_V, ORIGIN.x + HALF_V, ORIGIN.z + HALF_V, FLAT, buf)
    const out: { x: number; z: number }[] = []
    for (let i = 0; i < buf.count; i++) {
      if (houseKinds.has(buf.kind[i]!)) out.push({ x: buf.data[i * FLORA_STRIDE]!, z: buf.data[i * FLORA_STRIDE + 2]! })
    }
    return out
  }
  /** 溝帶（全寬）加田埂色的邊 */
  const inBand = (p: { x: number; z: number }): boolean => ravineGap(p.x, p.z) < 32 + RAVINE_RIM_SOLID

  it('用遊戲實際的禁區蓋出來的村：沒有一間房子在溝帶裡，離溝帶外緣至少 RAVINE_HOUSE_CLEAR', () => {
    const houses = build(rzhevVillageKeepOut)
    expect(houses.length).toBeGreaterThan(1000)
    for (const h of houses) {
      expect(inBand(h)).toBe(false)
      // 離中線至少 半寬(收窄的點更小) + 邊 + 余裕；最窄處 0.12 × 32 ≈ 4 m，所以下限取邊加余裕
      expect(ravineGap(h.x, h.z)).toBeGreaterThanOrEqual(RAVINE_RIM_SOLID * 0.5 + RAVINE_HOUSE_CLEAR - 1e-6)
    }
  })

  it('對照：只讓開戰場（不讓溝）的話，確實有房子落在溝帶裡 —— 上面那條不是空過', () => {
    const houses = build(battleKeepOut)
    expect(houses.filter(inBand).length).toBeGreaterThan(0)
  })
})

describe('沖溝的溝帶', () => {
  const stripes = buildRavineStripes(RAVINES)
  const total = RAVINES.reduce((s, r) => s + r.points.length, 0)
  const pos = stripes.getAttribute('position')
  const col = stripes.getAttribute('color')

  it('一個點 STRIPE_SECTION 個頂點；頂點色四個分量：只有最外緣是透明，其餘不透明', () => {
    expect(pos.count).toBe(total * STRIPE_SECTION)
    expect(col.itemSize).toBe(4)
    for (let i = 0; i < total; i++) {
      for (let k = 0; k < STRIPE_SECTION; k++) {
        expect(col.getW(i * STRIPE_SECTION + k)).toBe(k === 0 || k === STRIPE_SECTION - 1 ? 0 : 1)
      }
    }
  })

  it('斷面的顏色：田埂色的邊在外、溝坡的草、溝底的灌木在中線', () => {
    const same = (v: number, c: Color): void => {
      expect(col.getX(v)).toBeCloseTo(c.r, 5)
      expect(col.getY(v)).toBeCloseTo(c.g, 5)
      expect(col.getZ(v)).toBeCloseTo(c.b, 5)
    }
    same(1, new Color(FIELD_COLORS.winterSteppe.hedge))
    same(3, new Color(RAVINE_SLOPE))
    same(5, new Color(RAVINE_BOTTOM))
    same(7, new Color(RAVINE_SLOPE))
    same(9, new Color(FIELD_COLORS.winterSteppe.hedge))
  })

  it('田埂與溝坡在同一個位置：硬邊，田在那裡停住', () => {
    for (const [a, b] of [[2, 3], [7, 8]] as const) {
      expect(pos.getX(a)).toBe(pos.getX(b))
      expect(pos.getZ(a)).toBe(pos.getZ(b))
    }
  })

  /** 第 `ri` 截第 `j` 點的第一個頂點索引（每一截的點依序排，沒有被 keep 切斷） */
  const vertexOf = (ri: number, j: number): number => {
    let n = 0
    for (let k = 0; k < ri; k++) n += RAVINES[k]!.points.length
    return (n + j) * STRIPE_SECTION
  }

  it('全寬的點：最外緣離中線 半寬 + 田埂的寬，溝帶的邊離中線一個半寬', () => {
    const ri = RAVINES.findIndex((r) => r.scale.some((s) => s === 1))
    const r = RAVINES[ri]!
    const j = r.scale.findIndex((s) => s === 1)
    const v0 = vertexOf(ri, j)
    const dist = (k: number): number => Math.hypot(pos.getX(v0 + k) - pos.getX(v0 + 5), pos.getZ(v0 + k) - pos.getZ(v0 + 5))
    // 頂點存成 float32，世界座標上萬時精度約 1 mm
    expect(dist(0)).toBeCloseTo(r.half + RAVINE_RIM_SOLID + RAVINE_RIM_FADE, 1)
    expect(dist(3)).toBeCloseTo(r.half, 1)
    expect(dist(4)).toBeCloseTo(0.4 * r.half, 1)
  })

  it('溝頭的點：溝帶窄得多，田埂色的邊也跟著縮', () => {
    const ri = RAVINES.findIndex((r) => r.scale[0]! <= 0.2)
    const r = RAVINES[ri]!
    const v0 = vertexOf(ri, 0)
    const dist = (k: number): number => Math.hypot(pos.getX(v0 + k) - pos.getX(v0 + 5), pos.getZ(v0 + k) - pos.getZ(v0 + 5))
    expect(dist(3)).toBeCloseTo(r.half * r.scale[0]!, 1)
    expect(dist(3)).toBeLessThan(r.half * 0.25)
    expect(dist(0)).toBeLessThan(r.half + RAVINE_RIM_SOLID + RAVINE_RIM_FADE)
  })

  it('索引都落在頂點範圍內，每一段 8 個四邊形（跳過兩個硬邊）', () => {
    const idx = stripes.getIndex()!
    let max = 0
    for (let i = 0; i < idx.count; i++) max = Math.max(max, idx.getX(i))
    expect(max).toBeLessThan(total * STRIPE_SECTION)
    expect(idx.count).toBe(RAVINES.reduce((s, r) => s + (r.points.length - 1) * 8 * 6, 0))
  })

  it('keep 全回 false 就沒有網格；擋掉中間一個點就切成兩截', () => {
    const none = buildRavineStripes(RAVINES, () => false)
    expect(none.getAttribute('position').count).toBe(0)
    const r = RAVINES.find((q) => q.points.length >= 20)!
    const mid = r.points[10]!
    const cut = buildRavineStripes([r], (x, z) => Math.hypot(x - mid.x, z - mid.z) > 1)
    expect(cut.getAttribute('position').count).toBe((r.points.length - 1) * STRIPE_SECTION)
    expect(cut.getIndex()!.count).toBe((r.points.length - 3) * 8 * 6)
  })
})

describe('沖溝的渡口', () => {
  const fords = buildRavineFords(RAVINES)
  const pos = fords.getAttribute('position')

  it('有渡口：全圖有凹路穿過溝的地方', () => {
    expect(pos.count).toBeGreaterThan(400)
    expect(pos.count % 4).toBe(0)
    expect(fords.getAttribute('color').itemSize).toBe(4)
  })

  it('每一格都在凹路上、也在溝帶的範圍裡；顏色是路色', () => {
    const maxReach = Math.max(...RAVINES.map((r) => r.half)) + RAVINE_RIM_SOLID + FORD_CELL
    const track = new Color(FIELD_COLORS.winterSteppe.track)
    const col = fords.getAttribute('color')
    for (let q = 0; q < pos.count; q += 4) {
      const x = pos.getX(q) + FORD_CELL / 2
      const z = pos.getZ(q) + FORD_CELL / 2
      regionAt(x, z, reg)
      expect(trackGap(x, z, reg)).toBeLessThan(trackWidthAt(x, z))
      expect(ravineGap(x, z)).toBeLessThanOrEqual(maxReach)
      expect(col.getX(q)).toBeCloseTo(track.r, 5)
    }
  })

  it('同一格只畫一次；keep 全回 false 就沒有', () => {
    const seen = new Set<string>()
    for (let q = 0; q < pos.count; q += 4) {
      const k = `${Math.round(pos.getX(q))},${Math.round(pos.getZ(q))}`
      expect(seen.has(k)).toBe(false)
      seen.add(k)
    }
    expect(buildRavineFords(RAVINES, () => false).getAttribute('position').count).toBe(0)
  })
})
