import { describe, expect, it } from 'vitest'
import {
  createLeuna, EGRESS, FLAK_SITES, LANE_WIDTH, LEUNA_HILLS, PAD_CLEARANCE, PLANT_BLOCKS,
  PLANT_CENTER, PLANT_LAYOUT, PLANT_PAD, ROADS, TRUCKS,
} from '../../src/world/leuna'
import { FARM_CELL, HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX } from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'

/** 圓心到墊面矩形（軸對齊、中心在 PLANT_CENTER）的最近距離 */
function padDistance(cx: number, cz: number): number {
  const dx = Math.max(0, Math.abs(cx - PLANT_CENTER.x) - PLANT_PAD.halfX)
  const dz = Math.max(0, Math.abs(cz - PLANT_CENTER.z) - PLANT_PAD.halfZ)
  return Math.hypot(dx, dz)
}

describe('leuna 地形', () => {
  const { field, hills } = createLeuna()

  /**
   * 【量的是幾何距離，不是墊面內的高度】只量高度的話，丘陵挪到離墊面
   * 100 m 還是綠的 —— 它還沒碰到墊面，但 clearance 已經沒了。
   */
  it('每一顆丘陵的膨脹圓離墊面至少 PAD_CLEARANCE', () => {
    for (const h of hills) {
      expect(padDistance(h.cx, h.cz) - h.outerRadius, `${h.cx},${h.cz}`)
        .toBeGreaterThanOrEqual(PAD_CLEARANCE)
    }
  })

  it('墊面加一格圍裙內每一格都是 0', () => {
    const apron = FARM_CELL
    const x0 = PLANT_CENTER.x - PLANT_PAD.halfX - apron
    const x1 = PLANT_CENTER.x + PLANT_PAD.halfX + apron
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ - apron
    const z1 = PLANT_CENTER.z + PLANT_PAD.halfZ + apron
    for (let x = x0; x <= x1; x += FARM_CELL / 2) {
      for (let z = z0; z <= z1; z += FARM_CELL / 2) {
        expect(field.sample(x, z), `${x},${z}`).toBe(0)
      }
    }
  })

  it('outerRadius 由 radius × WOBBLE_MAX 推出', () => {
    for (const h of hills) expect(h.outerRadius).toBeCloseTo(h.radius * WOBBLE_MAX, 9)
  })

  it('丘陵都在 HILL_LIMIT 之內，最近的一對至少 HILL_GAP', () => {
    let closest = Infinity
    for (let i = 0; i < hills.length; i++) {
      const a = hills[i]!
      expect(Math.hypot(a.cx, a.cz) + a.outerRadius, `${a.cx},${a.cz}`).toBeLessThanOrEqual(HILL_LIMIT)
      for (let j = i + 1; j < hills.length; j++) {
        const b = hills[j]!
        const gap = Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius
        if (gap < closest) closest = gap
      }
    }
    expect(closest).toBeGreaterThanOrEqual(HILL_GAP)
  })

  it('峰不超過 HILL_PEAK_MAX、沒有一格是負的、真的有起伏', () => {
    let top = 0
    for (const v of field.data) {
      expect(v).toBeGreaterThanOrEqual(0)
      if (v > top) top = v
    }
    expect(top).toBeLessThanOrEqual(HILL_PEAK_MAX)
    expect(top).toBeGreaterThan(30)
  })

  it('手擺的清單就是場上的丘陵，而且決定性', () => {
    expect(hills.length).toBe(LEUNA_HILLS.length)
    const again = createLeuna()
    expect(Array.from(again.field.data)).toEqual(Array.from(field.data))
  })

  it('12 座構件在墊面內、8 座砲位在墊面外', () => {
    expect(PLANT_LAYOUT).toHaveLength(12)
    for (const p of PLANT_LAYOUT) {
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(PLANT_PAD.halfX - 40)
      expect(Math.abs(p.dz)).toBeLessThanOrEqual(PLANT_PAD.halfZ - 40)
    }
    expect(FLAK_SITES).toHaveLength(8)
    for (const s of FLAK_SITES) expect(padDistance(s.x, s.z)).toBeGreaterThan(800)
  })
})

describe('leuna 的佈局常數', () => {
  it('預定砲位環繞廠區 2.4 到 3.3 km', () => {
    for (const s of FLAK_SITES) {
      const d = Math.hypot(s.x - PLANT_CENTER.x, s.z - PLANT_CENTER.z)
      expect(d, `${s.x},${s.z}`).toBeGreaterThanOrEqual(2400)
      expect(d, `${s.x},${s.z}`).toBeLessThanOrEqual(3300)
    }
  })

  it('脫離方向是 −Z：投完繼續往前，不回頭', () => {
    expect(EGRESS.z).toBeLessThan(0)
    expect(EGRESS.x).toBe(0)
  })
})

describe('leuna 的廠區', () => {
  it('墊面是史實的 3 × 1.5 km', () => {
    expect(PLANT_PAD.halfX * 2).toBe(3000)
    expect(PLANT_PAD.halfZ * 2).toBe(1500)
  })

  it('卡車停在墊面內或道路旁', () => {
    for (const t of TRUCKS) {
      const inPad = padDistance(t.x, t.z) === 0
      let nearRoad = false
      for (const road of ROADS) {
        for (let i = 0; i + 1 < road.length; i++) {
          const a = road[i]!
          const b = road[i + 1]!
          const dx = b.x - a.x
          const dz = b.z - a.z
          const l2 = dx * dx + dz * dz
          const u = Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.z - a.z) * dz) / l2))
          if (Math.hypot(t.x - (a.x + dx * u), t.z - (a.z + dz * u)) < 40) nearRoad = true
        }
      }
      expect(inPad || nearRoad, `${t.x},${t.z}`).toBe(true)
    }
  })

  it('道路從墊面邊接到地圖邊緣', () => {
    const reachesEdge = ROADS.some((r) => r.some((p) => Math.abs(p.x) >= 14000 || Math.abs(p.z) >= 14000))
    const touchesPad = ROADS.some((r) => r.some((p) => padDistance(p.x, p.z) === 0))
    expect(reachesEdge).toBe(true)
    expect(touchesPad).toBe(true)
  })
})

/**
 * 街廓是佈景填充的單位：巷道格線切出來，每一格掛一個機能標籤。填充器
 * （`render/geometry/ground/plantFill.ts`）只認這張表。
 */
describe('廠區的街廓', () => {
  it('24 個街廓，全部在墊面內，互不重疊', () => {
    expect(PLANT_BLOCKS).toHaveLength(24)
    const x0 = PLANT_CENTER.x - PLANT_PAD.halfX
    const x1 = PLANT_CENTER.x + PLANT_PAD.halfX
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ
    const z1 = PLANT_CENTER.z + PLANT_PAD.halfZ
    for (const b of PLANT_BLOCKS) {
      expect(b.x0).toBeGreaterThanOrEqual(x0)
      expect(b.x1).toBeLessThanOrEqual(x1)
      expect(b.z0).toBeGreaterThanOrEqual(z0)
      expect(b.z1).toBeLessThanOrEqual(z1)
      expect(b.x1 - b.x0).toBeGreaterThan(100)
      expect(b.z1 - b.z0).toBeGreaterThan(100)
    }
    for (let i = 0; i < PLANT_BLOCKS.length; i++) {
      for (let j = i + 1; j < PLANT_BLOCKS.length; j++) {
        const a = PLANT_BLOCKS[i]!
        const b = PLANT_BLOCKS[j]!
        const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0
        expect(apart, `街廓 ${i} 與 ${j} 重疊`).toBe(true)
      }
    }
  })

  /**
   * 【為什麼要驗這一條】巷道是格線退出來的。退錯邊（減成加）街廓會壓在
   * 巷道上，而畫面上只是「東西擺得比較滿」，看不出錯。
   */
  it('相鄰街廓之間恰好留一條 LANE_WIDTH 的巷', () => {
    const cols = [...new Set(PLANT_BLOCKS.map((b) => b.x0))].sort((a, b) => a - b)
    expect(cols.length).toBe(6)
    for (let i = 0; i + 1 < cols.length; i++) {
      const left = PLANT_BLOCKS.find((b) => b.x0 === cols[i])!
      const right = PLANT_BLOCKS.find((b) => b.x0 === cols[i + 1])!
      expect(right.x0 - left.x1).toBeCloseTo(LANE_WIDTH, 6)
    }
    const rows = [...new Set(PLANT_BLOCKS.map((b) => b.z0))].sort((a, b) => a - b)
    expect(rows.length).toBe(4)
    for (let j = 0; j + 1 < rows.length; j++) {
      const north = PLANT_BLOCKS.find((b) => b.z0 === rows[j])!
      const south = PLANT_BLOCKS.find((b) => b.z0 === rows[j + 1])!
      expect(south.z0 - north.z1).toBeCloseTo(LANE_WIDTH, 6)
    }
  })

  it('每一座可炸構件都落在某個街廓內，而且那個街廓不是 open', () => {
    for (const p of PLANT_LAYOUT) {
      const x = PLANT_CENTER.x + p.dx
      const z = PLANT_CENTER.z + p.dz
      const b = PLANT_BLOCKS.find((k) => x >= k.x0 && x < k.x1 && z >= k.z0 && z < k.z1)
      expect(b, `構件 ${p.kind} (${p.dx},${p.dz}) 掉在巷道或街廓外`).toBeDefined()
      expect(b!.kind, `構件 ${p.kind} 落在 open 街廓`).not.toBe('open')
    }
  })

  it('機能配比：open 不超過 4 個，六種機能都有人用，種子互不相同', () => {
    expect(PLANT_BLOCKS.filter((b) => b.kind === 'open').length).toBeLessThanOrEqual(4)
    expect(new Set(PLANT_BLOCKS.map((b) => b.kind)).size).toBe(6)
    expect(new Set(PLANT_BLOCKS.map((b) => b.seed)).size).toBe(24)
  })
})
