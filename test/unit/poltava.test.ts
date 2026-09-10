import { describe, expect, it } from 'vitest'
import {
  APRON, createPoltava, DUMPS, FIELD_CENTER, FIELD_PAD, FLARE_DROPS, HEAVY_FLAK_SITES,
  LIGHT_FLAK_SITES, PARKED_ROWS, POLTAVA_HILLS, RUNWAY, SEARCHLIGHT_SITES, worldToField,
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
  const dx = Math.max(0, Math.abs(L.x) - FIELD_PAD.halfX)
  const dz = Math.max(0, Math.abs(L.z) - FIELD_PAD.halfZ)
  return Math.hypot(dx, dz)
}
const PAD = { x0: -FIELD_PAD.halfX, z0: -FIELD_PAD.halfZ, x1: FIELD_PAD.halfX, z1: FIELD_PAD.halfZ }

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
    const x0 = FIELD_CENTER.x - FIELD_PAD.halfX - apron
    const x1 = FIELD_CENTER.x + FIELD_PAD.halfX + apron
    const z0 = FIELD_CENTER.z - FIELD_PAD.halfZ - apron
    const z1 = FIELD_CENTER.z + FIELD_PAD.halfZ + apron
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

describe('poltava 的佈局', () => {
  it('跑道與停機坪都在墊面內，而且不重疊', () => {
    for (const r of [RUNWAY, APRON]) {
      expect(r.x0).toBeGreaterThanOrEqual(PAD.x0)
      expect(r.x1).toBeLessThanOrEqual(PAD.x1)
      expect(r.z0).toBeGreaterThanOrEqual(PAD.z0)
      expect(r.z1).toBeLessThanOrEqual(PAD.z1)
    }
    const apart = RUNWAY.x1 <= APRON.x0 || APRON.x1 <= RUNWAY.x0
      || RUNWAY.z1 <= APRON.z0 || APRON.z1 <= RUNWAY.z0
    expect(apart).toBe(true)
  })

  it('24 架 B-17 全在停機坪內、翼尖距至少 34 m、排距至少 50 m', () => {
    expect(PARKED_ROWS).toHaveLength(24)
    for (const p of PARKED_ROWS) expect(inRect(p.x, p.z, APRON), `${p.x},${p.z}`).toBe(true)
    for (let i = 0; i < PARKED_ROWS.length; i++) {
      for (let j = i + 1; j < PARKED_ROWS.length; j++) {
        const a = PARKED_ROWS[i]!
        const b = PARKED_ROWS[j]!
        const dx = Math.abs(a.x - b.x)
        const dz = Math.abs(a.z - b.z)
        // 同一排：橫向翼尖距；不同排：縱向排距
        expect(dz < 1 ? dx >= 34 : dz >= 50, `${i},${j}`).toBe(true)
      }
    }
  })

  it('三堆都在墊面內、不在跑道與停機坪上', () => {
    expect(DUMPS.map((d) => d.kind).sort()).toEqual(['bombDump', 'fuelDump', 'fuelDump'])
    for (const d of DUMPS) {
      expect(inRect(d.x, d.z, PAD)).toBe(true)
      expect(inRect(d.x, d.z, RUNWAY)).toBe(false)
      expect(inRect(d.x, d.z, APRON)).toBe(false)
    }
  })

  it('砲位與探照燈都不在跑道與停機坪上，重高砲在墊面外', () => {
    expect(LIGHT_FLAK_SITES).toHaveLength(16)
    expect(HEAVY_FLAK_SITES).toHaveLength(6)
    expect(SEARCHLIGHT_SITES).toHaveLength(6)
    for (const s of [...LIGHT_FLAK_SITES, ...HEAVY_FLAK_SITES, ...SEARCHLIGHT_SITES]) {
      expect(inRect(s.x, s.z, RUNWAY), `${s.x},${s.z}`).toBe(false)
      expect(inRect(s.x, s.z, APRON), `${s.x},${s.z}`).toBe(false)
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
