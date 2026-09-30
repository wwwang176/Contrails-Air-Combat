import { describe, expect, it } from 'vitest'
import {
  ASCH_HILLS, CRATE_FIELDS, createAsch, DUMPS, FIELD_BOUNDS, FIELD_CENTER, FIELD_LOBES, FIELD_PAD,
  FIELD_TREE_CLEAR, FLAK_SITES, HUTS, inField, PARKED_ROWS, PAVED, PSP_STEEL, ROAD_WIDTH, RUNWAY, STAND_LANES, STAND_PADS,
  TAKEOFF_LINE, TAXI_LOOP, taxiRoute, TREE_CLUMPS, VEHICLES, worldToField, type FieldRect,
} from '../../src/world/asch'
import { BROAD_CROWN_R, BUSH_R, CONE_CROWN_R } from '../../src/render/floraShapes'
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

  it('油桶堆與防空砲在墊面附近、離鋪面 20 m 以上、離停放的 P-51 40 m 以上', () => {
    expect(DUMPS.length).toBeGreaterThan(0)
    expect(FLAK_SITES.length).toBeGreaterThan(0)
    for (const d of DUMPS) {
      expect(inRect(d.x, d.z, FIELD_PAD), `${d.x},${d.z}`).toBe(true)
    }
    for (const s of [...DUMPS, ...FLAK_SITES]) {
      expect(clearOfPaving(s.x, s.z, 20), `${s.x},${s.z}`).toBe(true)
      for (const p of PARKED_ROWS) {
        expect(Math.hypot(s.x - p.x, s.z - p.z), `${s.x},${s.z}`).toBeGreaterThanOrEqual(40)
      }
    }
  })

  /** 【防空車不站在林子裡】墊面外只清 `FIELD_TREE_CLEAR`；也不擋在連外道路上 */
  it('防空砲都在不長樹的那一圈裡、不壓連外道路', () => {
    for (const s of FLAK_SITES) {
      const p = local(s.x, s.z)
      const d = Math.min(...[FIELD_PAD, ...FIELD_LOBES].map((r) => Math.hypot(
        Math.max(0, r.x0 - p.x, p.x - r.x1), Math.max(0, r.z0 - p.z, p.z - r.z1),
      )))
      expect(d, `${p.x},${p.z}`).toBeLessThanOrEqual(FIELD_TREE_CLEAR - 10)
      if (p.x < FIELD_PAD.x0) expect(Math.abs(p.z), `${p.x},${p.z}`).toBeGreaterThanOrEqual(ROAD_WIDTH / 2 + 10)
    }
  })

  it('起飛點在跑道上', () => {
    expect(inRect(TAKEOFF_LINE.x, TAKEOFF_LINE.z, RUNWAY)).toBe(true)
  })

  /**
   * 【滑上跑道就是起飛點】在接口南邊的話，飛機要先往南倒車；往北太多就變成
   * 「滑到前面的停等區才起飛」。滾行加初期爬升約 500 m，北邊要留得下。
   */
  it('起飛點緊接在滑行帶南段接口的北邊，北邊留得下滾行距離', () => {
    const south = TAXI_LOOP[2]!
    const junction = (south.z0 + south.z1) / 2
    const line = local(TAKEOFF_LINE.x, TAKEOFF_LINE.z)
    expect(line.z).toBeLessThanOrEqual(junction)
    expect(junction - line.z).toBeLessThan(TAKEOFF_TRAIL)
    expect(line.z - RUNWAY.z0).toBeGreaterThan(600)
  })

  it('起飛線的滑行路徑就是 taxiRoute', () => {
    expect(TAKEOFF_LINE.route).toBe(taxiRoute)
  })

  /** 【終點與 `slot` 無關】四架滑到同一個起飛點，先到先滾行 */
  it('每一格停機墊的滑行路徑：起點是那一格、終點是跑道中線上的起飛點、途中每一點都在鋪面上', () => {
    const onPaving = (x: number, z: number): boolean =>
      PAVED.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)
    const line = local(TAKEOFF_LINE.x, TAKEOFF_LINE.z)
    for (const p of PARKED_ROWS) {
      for (let slot = 0; slot < SCHWARM_SIZE; slot++) {
        const path = taxiRoute(p.x, p.z, slot)
        const tag = `${p.x},${p.z} 第 ${slot} 位`
        expect(path[0], tag).toEqual({ x: p.x, z: p.z })
        const end = local(path.at(-1)!.x, path.at(-1)!.z)
        expect(end.x, tag).toBe((RUNWAY.x0 + RUNWAY.x1) / 2)
        expect(end.z, tag).toBe(line.z)
        for (let i = 1; i < path.length; i++) {
          const a = local(path[i - 1]!.x, path[i - 1]!.z)
          const b = local(path[i]!.x, path[i]!.z)
          // 【沿著滑行道走】每一段都是南北或東西向
          expect(a.x === b.x || a.z === b.z, `${tag} 第 ${i} 段`).toBe(true)
          const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z))
          for (let k = 0; k <= n; k++) {
            const f = n === 0 ? 0 : k / n
            const x = a.x + (b.x - a.x) * f
            const z = a.z + (b.z - a.z) * f
            expect(onPaving(x, z), `${tag} 第 ${i} 段 (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(true)
          }
        }
      }
    }
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

/**
 * 營房、補給堆、停著的車是佈景：沒有命中盒，但壓在鋪面上的話 P-51 會從車裡
 * 滑出去；落在墊面外的話底下是田、旁邊會長樹。
 */
describe('asch 的營區', () => {
  interface Item { tag: string; x: number; z: number; r: number }
  const items: Item[] = [
    ...HUTS.map((h) => ({ tag: `營房 ${h.x.toFixed(0)},${h.z.toFixed(0)}`, x: h.x, z: h.z, r: Math.hypot(h.length, h.width) / 2 })),
    ...CRATE_FIELDS.map((d) => ({ tag: `補給堆 ${d.x.toFixed(0)},${d.z.toFixed(0)}`, x: d.x, z: d.z, r: Math.hypot(d.width, d.depth) / 2 })),
    ...VEHICLES.map((v) => ({ tag: `${v.unit} ${v.x.toFixed(0)},${v.z.toFixed(0)}`, x: v.x, z: v.z, r: 4 })),
  ]

  it('附加的墊面都與主墊面相接', () => {
    for (const r of FIELD_LOBES) expect(touches(r, FIELD_PAD), `${r.x0},${r.z0}`).toBe(true)
  })

  it('每一件連同外接圓都在墊面裡', () => {
    for (const e of items) {
      const p = local(e.x, e.z)
      for (const [dx, dz] of [[-e.r, 0], [e.r, 0], [0, -e.r], [0, e.r]] as const) {
        expect(inField(p.x + dx, p.z + dz), e.tag).toBe(true)
      }
    }
  })

  /** 【3 m】整備區貼著停機墊擺；滑行的 P-51 只走鋪面，留一點縫就不會穿過車子 */
  it('離鋪面 3 m 以上', () => {
    for (const e of items) expect(clearOfPaving(e.x, e.z, e.r + 3), e.tag).toBe(true)
  })

  it('不壓防空砲、油桶堆與停放的 P-51', () => {
    const solid = [
      ...FLAK_SITES.map((s) => ({ x: s.x, z: s.z, r: 5 })),
      ...DUMPS.map((d) => ({ x: d.x, z: d.z, r: 15 })),
      ...PARKED_ROWS.map((p) => ({ x: p.x, z: p.z, r: 8 })),
    ]
    for (const e of items) {
      for (const s of solid) {
        expect(Math.hypot(e.x - s.x, e.z - s.z), `${e.tag} 對 ${s.x.toFixed(0)},${s.z.toFixed(0)}`)
          .toBeGreaterThanOrEqual(e.r + s.r + 5)
      }
    }
  })

  it('箱子堆是停機位的整備區：每一格至少一堆，都在 P-51 旁 50 m 內，大小不一', () => {
    const nearest = (x: number, z: number): number =>
      Math.min(...PARKED_ROWS.map((p) => Math.hypot(x - p.x, z - p.z)))
    for (const d of CRATE_FIELDS) expect(nearest(d.x, d.z), `${d.x.toFixed(0)},${d.z.toFixed(0)}`).toBeLessThanOrEqual(50)
    for (const p of PARKED_ROWS) {
      expect(CRATE_FIELDS.some((d) => Math.hypot(d.x - p.x, d.z - p.z) <= 50), `${p.x},${p.z}`).toBe(true)
    }
    const widths = CRATE_FIELDS.map((d) => d.width)
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(4)
  })

  it('卡車停在停機位、營房或箱子堆旁邊；佈景裡沒有 M16（會開火的才是 M16）', () => {
    expect(VEHICLES.length).toBeGreaterThanOrEqual(20)
    const anchors = [
      ...HUTS.map((h) => ({ x: h.x, z: h.z, r: Math.hypot(h.length, h.width) / 2 })),
      ...CRATE_FIELDS.map((d) => ({ x: d.x, z: d.z, r: Math.hypot(d.width, d.depth) / 2 })),
      ...PARKED_ROWS.map((p) => ({ x: p.x, z: p.z, r: 25 })),
    ]
    for (const v of VEHICLES) {
      expect(v.unit, `${v.x.toFixed(0)},${v.z.toFixed(0)}`).toBe('usTruck')
      const gap = Math.min(...anchors.map((a) => Math.hypot(v.x - a.x, v.z - a.z) - a.r))
      expect(gap, `${v.x.toFixed(0)},${v.z.toFixed(0)}`).toBeLessThanOrEqual(25)
    }
  })

  it('不壓連外道路', () => {
    const half = ROAD_WIDTH / 2
    for (const e of items) {
      const p = local(e.x, e.z)
      if (p.x - e.r > FIELD_PAD.x0) continue
      expect(Math.abs(p.z), e.tag).toBeGreaterThanOrEqual(e.r + half)
    }
  })

  /**
   * 【一叢一叢的樹】跑道周圍不長樹：樹冠外緣離跑道 80 m，灌木 15 m。其餘鋪面
   * （滑行帶、窄巷、停機墊）只留 3 m —— 滑行的翼尖都在鋪面上。營房、箱子、車、
   * 防空砲、油桶堆與停放的 P-51 旁邊可以長，只是樹冠不能蓋到
   */
  const crown = { broad: BROAD_CROWN_R, cone: CONE_CROWN_R, bush: BUSH_R } as const
  const plants = TREE_CLUMPS.flatMap((c) => c.plants)
  const rectGap = (p: { x: number; z: number }, r: FieldRect): number =>
    Math.hypot(Math.max(0, r.x0 - p.x, p.x - r.x1), Math.max(0, r.z0 - p.z, p.z - r.z1))

  it('樹叢在墊面的草地上，跑道周圍沒有樹，樹冠不蓋到鋪面與任何一件東西', () => {
    expect(TREE_CLUMPS.length).toBeGreaterThanOrEqual(10)
    const solid = [
      ...items,
      ...FLAK_SITES.map((s) => ({ tag: 'flak', x: s.x, z: s.z, r: 5 })),
      ...DUMPS.map((d) => ({ tag: 'dump', x: d.x, z: d.z, r: 15 })),
      ...PARKED_ROWS.map((p) => ({ tag: 'P-51', x: p.x, z: p.z, r: 8 })),
    ]
    for (const t of plants) {
      const r = crown[t.kind] * t.scale
      const tag = `${t.kind} ${t.x.toFixed(0)},${t.z.toFixed(0)}`
      const p = local(t.x, t.z)
      expect(inField(p.x, p.z), tag).toBe(true)
      expect(rectGap(p, RUNWAY) - r, `${tag} 對跑道`).toBeGreaterThanOrEqual(t.kind === 'bush' ? 15 : 80)
      expect(clearOfPaving(t.x, t.z, r + 3), tag).toBe(true)
      for (const s of solid) {
        expect(Math.hypot(t.x - s.x, t.z - s.z), `${tag} 對 ${s.tag}`).toBeGreaterThanOrEqual(r + s.r)
      }
    }
    expect(plants.length).toBeGreaterThanOrEqual(3 * TREE_CLUMPS.length)
  })

  it('營房與停機位旁邊長得出樹', () => {
    const trees = plants.filter((t) => t.kind !== 'bush')
    const nearHut = trees.filter((t) => HUTS.some((h) =>
      Math.hypot(t.x - h.x, t.z - h.z) - Math.hypot(h.length, h.width) / 2 - crown[t.kind] * t.scale < 10))
    const nearStand = trees.filter((t) => PARKED_ROWS.some((p) => Math.hypot(t.x - p.x, t.z - p.z) < 50))
    expect(nearHut.length).toBeGreaterThan(0)
    expect(nearStand.length).toBeGreaterThan(0)
  })

  it('彼此不重疊', () => {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!
        const b = items[j]!
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.tag} 對 ${b.tag}`).toBeGreaterThanOrEqual(a.r + b.r)
      }
    }
  })
})
