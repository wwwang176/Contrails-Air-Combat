import { describe, expect, it } from 'vitest'
import {
  createPoltava, DUMPS, FIELD_CENTER, FIELD_PAD, FLARE_DROPS, HEAVY_FLAK_SITES,
  LIGHT_FLAK_SITES, PARKED_ROWS, PAVED, POLTAVA_HILLS, RUNWAY, SEARCHLIGHT_SITES, STAND_LANES, STAND_PADS,
  TAXI_LINKS, TAXIWAY, worldToField, type FieldRect,
} from '../../src/world/poltava'
import { PAD_CLEARANCE } from '../../src/world/leuna'
import { FLARE_LANES } from '../../src/world/flares'
import { FARM_CELL, HILL_GAP, HILL_LIMIT } from '../../src/world/farmland'

/**
 * 波爾塔瓦機場的地形與佈局。守的是**空間關係**：墊面平、丘陵離得夠遠、
 * 停放的 B-17 在停機坪上、砲位不在跑道上 —— 這些錯了畫面上只是「怪怪的」。
 */
const L = { x: 0, z: 0 }
function inRect(x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }): boolean {
  worldToField(x, z, L)
  return L.x >= r.x0 && L.x <= r.x1 && L.z >= r.z0 && L.z <= r.z1
}
function padDistance(cx: number, cz: number): number {
  worldToField(cx, cz, L)
  const dx = Math.max(0, FIELD_PAD.x0 - L.x, L.x - FIELD_PAD.x1)
  const dz = Math.max(0, FIELD_PAD.z0 - L.z, L.z - FIELD_PAD.z1)
  return Math.hypot(dx, dz)
}
const PAD = FIELD_PAD

describe('poltava 地形', () => {
  const { field, hills } = createPoltava()

  it('每一顆丘陵的膨脹圓離墊面至少 PAD_CLEARANCE', () => {
    for (const h of hills) {
      expect(padDistance(h.cx, h.cz) - h.outerRadius, `${h.cx},${h.cz}`)
        .toBeGreaterThanOrEqual(PAD_CLEARANCE)
    }
  })

  it('墊面加一格圍裙內每一格都是 0', () => {
    const apron = FARM_CELL
    const x0 = FIELD_CENTER.x + FIELD_PAD.x0 - apron
    const x1 = FIELD_CENTER.x + FIELD_PAD.x1 + apron
    const z0 = FIELD_CENTER.z + FIELD_PAD.z0 - apron
    const z1 = FIELD_CENTER.z + FIELD_PAD.z1 + apron
    for (let x = x0; x <= x1; x += FARM_CELL / 2) {
      for (let z = z0; z <= z1; z += FARM_CELL / 2) {
        expect(field.sample(x, z), `${x},${z}`).toBe(0)
      }
    }
  })

  it('丘陵都在 HILL_LIMIT 之內、最近的一對至少 HILL_GAP、峰不超過 40', () => {
    expect(hills).toHaveLength(POLTAVA_HILLS.length)
    for (const h of hills) {
      expect(Math.hypot(h.cx, h.cz) + h.outerRadius).toBeLessThanOrEqual(HILL_LIMIT)
      expect(h.peak).toBeLessThanOrEqual(40)
    }
    for (let i = 0; i < hills.length; i++) {
      for (let j = i + 1; j < hills.length; j++) {
        const a = hills[i]!
        const b = hills[j]!
        expect(Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius)
          .toBeGreaterThanOrEqual(HILL_GAP)
      }
    }
  })
})

/** 這一點離任何鋪面（跑道、滑行道、停機位）至少 `margin` 公尺 */
function clearOfPaving(x: number, z: number, margin: number): boolean {
  worldToField(x, z, L)
  for (const r of PAVED) {
    if (L.x >= r.x0 - margin && L.x <= r.x1 + margin && L.z >= r.z0 - margin && L.z <= r.z1 + margin) return false
  }
  return true
}

describe('poltava 的佈局', () => {
  it('墊面只比鋪面外擴 150 到 500 m —— 機場不像工廠，草地不該遠遠大過設施', () => {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity
    for (const r of PAVED) {
      x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1); z1 = Math.max(z1, r.z1)
    }
    for (const [pad, paved, sign] of [
      [PAD.x0, x0, -1], [PAD.z0, z0, -1], [PAD.x1, x1, 1], [PAD.z1, z1, 1],
    ] as const) {
      const margin = (pad - paved) * sign
      expect(margin).toBeGreaterThanOrEqual(150)
      expect(margin).toBeLessThanOrEqual(500)
    }
  })

  it('鋪面都在墊面內；跑道與滑行道平行、不重疊；支線接得上', () => {
    for (const r of PAVED) {
      expect(r.x0).toBeGreaterThanOrEqual(PAD.x0)
      expect(r.x1).toBeLessThanOrEqual(PAD.x1)
      expect(r.z0).toBeGreaterThanOrEqual(PAD.z0)
      expect(r.z1).toBeLessThanOrEqual(PAD.z1)
      expect(r.x1).toBeGreaterThan(r.x0)
      expect(r.z1).toBeGreaterThan(r.z0)
    }
    expect(TAXIWAY.z0).toBeGreaterThan(RUNWAY.z1)
    expect(TAXIWAY.x0).toBe(RUNWAY.x0)
    expect(TAXIWAY.x1).toBe(RUNWAY.x1)
    // 每一條聯絡道／支線至少碰到跑道或滑行道
    for (const l of TAXI_LINKS) {
      const touchesRunway = l.z0 <= RUNWAY.z1 && l.z1 >= RUNWAY.z0
      const touchesTaxiway = l.z0 <= TAXIWAY.z1 && l.z1 >= TAXIWAY.z0
      expect(touchesRunway || touchesTaxiway, `${l.x0},${l.z0}`).toBe(true)
    }
    // 【沒有孤島，而且越外越窄】每一條窄巷與滑行道或支線共邊、比支線窄；
    // 每一塊停機坪與一條窄巷共邊
    const touches = (a: FieldRect, b: FieldRect): boolean =>
      a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0
    const roads = [TAXIWAY, ...TAXI_LINKS]
    const spurWidth = TAXI_LINKS[0]!.x1 - TAXI_LINKS[0]!.x0
    for (const l of STAND_LANES) {
      expect(roads.some((r) => touches(l, r)), `${l.x0},${l.z0}`).toBe(true)
      expect(Math.min(l.x1 - l.x0, l.z1 - l.z0)).toBeLessThan(spurWidth)
    }
    for (const p of STAND_PADS) {
      expect(STAND_LANES.some((l) => touches(p, l)), `${p.x0},${p.z0}`).toBe(true)
    }
  })

  it('24 架 B-17 各在自己的停機坪上、不在跑道與滑行道上、彼此不重疊', () => {
    expect(PARKED_ROWS).toHaveLength(24)
    expect(STAND_PADS).toHaveLength(24)
    for (const p of PARKED_ROWS) {
      expect(inRect(p.x, p.z, PAD), `${p.x},${p.z}`).toBe(true)
      expect(inRect(p.x, p.z, RUNWAY), `${p.x},${p.z}`).toBe(false)
      expect(inRect(p.x, p.z, TAXIWAY), `${p.x},${p.z}`).toBe(false)
    }
    // 每一架都在某一塊停機坪裡
    for (const p of PARKED_ROWS) {
      expect(STAND_PADS.some((h) => inRect(p.x, p.z, h)), `${p.x},${p.z}`).toBe(true)
    }
    for (let i = 0; i < PARKED_ROWS.length; i++) {
      for (let j = i + 1; j < PARKED_ROWS.length; j++) {
        const a = PARKED_ROWS[i]!
        const b = PARKED_ROWS[j]!
        // 命中盒 32 × 23：橫向拉開翼展、或縱向拉開全長
        expect(Math.abs(a.x - b.x) >= 34 || Math.abs(a.z - b.z) >= 26, `${i},${j}`).toBe(true)
      }
    }
  })

  it('三堆都在墊面內、離鋪面 20 m 以上', () => {
    expect(DUMPS.map((d) => d.kind).sort()).toEqual(['bombDump', 'fuelDump', 'fuelDump'])
    for (const d of DUMPS) {
      expect(inRect(d.x, d.z, PAD)).toBe(true)
      expect(clearOfPaving(d.x, d.z, 20), `${d.x},${d.z}`).toBe(true)
    }
  })

  it('砲位與探照燈都離鋪面 20 m 以上、離停放的 B-17 40 m 以上，重高砲在墊面外', () => {
    expect(LIGHT_FLAK_SITES).toHaveLength(16)
    expect(HEAVY_FLAK_SITES).toHaveLength(6)
    expect(SEARCHLIGHT_SITES).toHaveLength(6)
    for (const s of [...LIGHT_FLAK_SITES, ...HEAVY_FLAK_SITES, ...SEARCHLIGHT_SITES]) {
      expect(clearOfPaving(s.x, s.z, 20), `${s.x},${s.z}`).toBe(true)
      for (const p of PARKED_ROWS) {
        expect(Math.hypot(s.x - p.x, s.z - p.z), `${s.x},${s.z}`).toBeGreaterThanOrEqual(40)
      }
    }
    for (const s of HEAVY_FLAK_SITES) expect(padDistance(s.x, s.z)).toBeGreaterThan(500)
  })

  it('照明彈的清單：都在墊面內、相鄰三個彼此至少 800 m、前三個依序點、高度各不相同', () => {
    const n = FLARE_DROPS.length
    // 輪替：清單要比燈位多，換位置才有意義
    expect(n).toBeGreaterThan(FLARE_LANES)
    for (const p of FLARE_DROPS) expect(inRect(p.x, p.z, PAD)).toBe(true)
    // 同時亮著的是清單裡相鄰的三個（循環），那三個彼此要拉開
    for (let i = 0; i < n; i++) {
      for (let d = 1; d < FLARE_LANES; d++) {
        const a = FLARE_DROPS[i]!
        const b = FLARE_DROPS[(i + d) % n]!
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i},${(i + d) % n}`).toBeGreaterThanOrEqual(800)
      }
    }
    for (let i = 1; i < FLARE_LANES; i++) {
      expect(FLARE_DROPS[i]!.delay).toBeGreaterThan(FLARE_DROPS[i - 1]!.delay)
    }
    expect(new Set(FLARE_DROPS.map((p) => p.altitude)).size).toBe(n)
    expect(new Set(FLARE_DROPS.map((p) => p.z)).size).toBe(n)
  })
})
