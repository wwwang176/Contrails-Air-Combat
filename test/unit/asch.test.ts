import { describe, expect, it } from 'vitest'
import {
  ASCH_HILLS, createAsch, DUMPS, FIELD_BOUNDS, FIELD_CENTER, FIELD_PAD, inField, LIGHT_FLAK_SITES,
  PARKED_ROWS, PAVED, PSP_STEEL, RUNWAY, STAND_LANES, STAND_PADS, TAKEOFF_LINE, TAXI_LOOP,
  worldToField, type FieldRect,
} from '../../src/world/asch'
import { RUNWAY_CONCRETE } from '../../src/world/poltava'
import { PAD_CLEARANCE } from '../../src/world/leuna'
import { FARM_CELL, HILL_GAP, HILL_LIMIT } from '../../src/world/farmland'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { TAKEOFF_TRAIL } from '../../src/control/takeoffRoll'

/**
 * Y-29（比利時 Asch）前進降落場的地形與佈局。守的是**空間關係**：墊面平、
 * 丘陵離得夠遠、滑行帶只在跑道一側繞一圈、停放的 P-51 一架一格、砲位與
 * 油桶不在鋪面上 —— 這些錯了畫面上只是「怪怪的」。
 */
const L = { x: 0, z: 0 }
function local(x: number, z: number): { x: number; z: number } {
  worldToField(x, z, L)
  return { x: L.x, z: L.z }
}
function inRect(x: number, z: number, r: FieldRect): boolean {
  const p = local(x, z)
  return p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1
}
const touches = (a: FieldRect, b: FieldRect): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0
function clearOfPaving(x: number, z: number, margin: number): boolean {
  const p = local(x, z)
  for (const r of PAVED) {
    if (p.x >= r.x0 - margin && p.x <= r.x1 + margin && p.z >= r.z0 - margin && p.z <= r.z1 + margin) return false
  }
  return true
}

describe('asch 地形', () => {
  const { field, hills } = createAsch()

  it('每一顆丘陵的膨脹圓離墊面至少 PAD_CLEARANCE', () => {
    for (const h of hills) {
      const p = local(h.cx, h.cz)
      const dx = Math.max(0, FIELD_BOUNDS.x0 - p.x, p.x - FIELD_BOUNDS.x1)
      const dz = Math.max(0, FIELD_BOUNDS.z0 - p.z, p.z - FIELD_BOUNDS.z1)
      expect(Math.hypot(dx, dz) - h.outerRadius, `${h.cx},${h.cz}`).toBeGreaterThanOrEqual(PAD_CLEARANCE)
    }
  })

  it('墊面的外接矩形加一格圍裙內每一格都是 0', () => {
    const x0 = FIELD_CENTER.x + FIELD_BOUNDS.x0 - FARM_CELL
    const x1 = FIELD_CENTER.x + FIELD_BOUNDS.x1 + FARM_CELL
    const z0 = FIELD_CENTER.z + FIELD_BOUNDS.z0 - FARM_CELL
    const z1 = FIELD_CENTER.z + FIELD_BOUNDS.z1 + FARM_CELL
    for (let x = x0; x <= x1; x += FARM_CELL / 2) {
      for (let z = z0; z <= z1; z += FARM_CELL / 2) {
        expect(field.sample(x, z), `${x},${z}`).toBe(0)
      }
    }
  })

  it('丘陵都在 HILL_LIMIT 之內、兩兩至少 HILL_GAP', () => {
    expect(hills).toHaveLength(ASCH_HILLS.length)
    for (const h of hills) expect(Math.hypot(h.cx, h.cz) + h.outerRadius).toBeLessThanOrEqual(HILL_LIMIT)
    for (let i = 0; i < hills.length; i++) {
      for (let j = i + 1; j < hills.length; j++) {
        const a = hills[i]!
        const b = hills[j]!
        expect(Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius).toBeGreaterThanOrEqual(HILL_GAP)
      }
    }
  })
})

describe('asch 的佈局', () => {
  it('跑道是 1,400 × 36 m 的鋼板網，顏色與水泥不同', () => {
    expect(RUNWAY.x1 - RUNWAY.x0).toBe(36)
    expect(RUNWAY.z1 - RUNWAY.z0).toBe(1400)
    expect(PSP_STEEL).not.toBe(RUNWAY_CONCRETE)
  })

  it('每一塊鋪面都是正的矩形、四個角都在墊面裡，墊面只比鋪面多不到 100 m', () => {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity
    for (const r of PAVED) {
      expect(r.x1).toBeGreaterThan(r.x0)
      expect(r.z1).toBeGreaterThan(r.z0)
      for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]] as const) {
        expect(inField(x, z), `${x},${z}`).toBe(true)
      }
      x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1); z1 = Math.max(z1, r.z1)
    }
    for (const margin of [x0 - FIELD_PAD.x0, z0 - FIELD_PAD.z0, FIELD_PAD.x1 - x1, FIELD_PAD.z1 - z1]) {
      expect(margin).toBeGreaterThanOrEqual(0)
      expect(margin).toBeLessThanOrEqual(100)
    }
  })

  it('滑行帶只在跑道一側，頭尾兩段都接上跑道、中間一段接起兩頭 —— 一個環', () => {
    for (const t of TAXI_LOOP) expect(t.x1, `${t.x0},${t.z0}`).toBeLessThanOrEqual(RUNWAY.x0)
    const onRunway = TAXI_LOOP.filter((t) => touches(t, RUNWAY))
    expect(onRunway).toHaveLength(2)
    const far = TAXI_LOOP.filter((t) => !touches(t, RUNWAY))
    expect(far).toHaveLength(1)
    for (const t of onRunway) expect(touches(t, far[0]!)).toBe(true)
  })

  it('12 個停機墊在滑行帶外側，每一個由一條窄巷接到滑行帶', () => {
    expect(STAND_PADS).toHaveLength(12)
    expect(STAND_LANES).toHaveLength(12)
    const outer = Math.min(...TAXI_LOOP.map((t) => t.x0))
    const taxiWidth = Math.min(...TAXI_LOOP.map((t) => Math.min(t.x1 - t.x0, t.z1 - t.z0)))
    for (const p of STAND_PADS) {
      expect(p.x1, `${p.x0},${p.z0}`).toBeLessThan(outer)
      expect(STAND_LANES.some((l) => touches(p, l))).toBe(true)
    }
    for (const l of STAND_LANES) {
      expect(TAXI_LOOP.some((t) => touches(l, t))).toBe(true)
      expect(Math.min(l.x1 - l.x0, l.z1 - l.z0)).toBeLessThan(taxiWidth)
    }
    for (let i = 0; i < STAND_PADS.length; i++) {
      for (let j = i + 1; j < STAND_PADS.length; j++) expect(touches(STAND_PADS[i]!, STAND_PADS[j]!)).toBe(false)
    }
  })

  it('12 架 P-51 一架一格，不在跑道與滑行帶上、彼此不重疊', () => {
    expect(PARKED_ROWS).toHaveLength(12)
    for (const p of PARKED_ROWS) {
      expect(STAND_PADS.filter((h) => inRect(p.x, p.z, h)), `${p.x},${p.z}`).toHaveLength(1)
      expect(inRect(p.x, p.z, RUNWAY)).toBe(false)
      for (const t of TAXI_LOOP) expect(inRect(p.x, p.z, t)).toBe(false)
    }
    for (let i = 0; i < PARKED_ROWS.length; i++) {
      for (let j = i + 1; j < PARKED_ROWS.length; j++) {
        const a = PARKED_ROWS[i]!
        const b = PARKED_ROWS[j]!
        // 命中盒約 12 × 10：縱向拉開全長以上
        expect(Math.abs(a.x - b.x) >= 14 || Math.abs(a.z - b.z) >= 14, `${i},${j}`).toBe(true)
      }
    }
  })

  it('油桶堆與輕高砲在墊面附近、離鋪面 20 m 以上、離停放的 P-51 40 m 以上', () => {
    expect(DUMPS.length).toBeGreaterThan(0)
    expect(LIGHT_FLAK_SITES.length).toBeGreaterThan(0)
    for (const d of DUMPS) {
      expect(inRect(d.x, d.z, FIELD_PAD), `${d.x},${d.z}`).toBe(true)
    }
    for (const s of [...DUMPS, ...LIGHT_FLAK_SITES]) {
      expect(clearOfPaving(s.x, s.z, 20), `${s.x},${s.z}`).toBe(true)
      for (const p of PARKED_ROWS) {
        expect(Math.hypot(s.x - p.x, s.z - p.z), `${s.x},${s.z}`).toBeGreaterThanOrEqual(40)
      }
    }
  })

  it('一個小隊四架單列排在起飛線後方，最後一架還在跑道上', () => {
    expect(inRect(TAKEOFF_LINE.x, TAKEOFF_LINE.z + (SCHWARM_SIZE - 1) * TAKEOFF_TRAIL, RUNWAY)).toBe(true)
  })

  it('起飛線在跑道一端的中線上，機首朝跑道的另一端', () => {
    expect(inRect(TAKEOFF_LINE.x, TAKEOFF_LINE.z, RUNWAY)).toBe(true)
    const p = local(TAKEOFF_LINE.x, TAKEOFF_LINE.z)
    expect(p.x).toBe((RUNWAY.x0 + RUNWAY.x1) / 2)
    // heading 0 = 機首朝 −Z：起點要在 +Z 那一端
    expect(TAKEOFF_LINE.heading).toBe(0)
    expect(p.z).toBeGreaterThan((RUNWAY.z0 + RUNWAY.z1) / 2)
  })
})
