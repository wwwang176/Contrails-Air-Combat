import { describe, expect, it } from 'vitest'
import {
  GERMAN_AT_GUNS, at, BATTLE_HALF, battleKeepOut, CRATER_PATCHES, facing, FRONT_HEADING,
  MINEFIELDS, SCAR_ZONE, toLocal,
  VILLAGE, VILLAGE_BOX, VILLAGE_NAME, GERMAN_DUG_PANZERS, SOVIET_INFANTRY, SOVIET_MORTARS, RZHEV_HILLS,
  SOVIET_ROUTE_A, SOVIET_ROUTE_B, SOVIET_FLAK, GERMAN_INFANTRY, GERMAN_MORTARS, GERMAN_TRUCKS, STALLED_SOVIET_TANKS,
  GERMAN_RESERVE_EAST, GERMAN_RESERVE_WEST, WRECK_SOVIET_TANKS, WRECK_GERMAN_PANZERS, GERMAN_FLAK,
  SOVIET_SUPPORT_GUNS, UNIT_SPOTS, type Spot,
} from '../../src/world/rzhev'
import { FARM_EXTENT, HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX } from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'
import { columnGround, MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'
import { motionPose } from '../../src/world/groundMotion'
import { SCORCH, TRACKS, TRENCHES } from '../../src/world/rzhev'
import { RZHEV_SITE, rzhevHillAvoid } from '../../src/render/terrain'
import { createRzhev, rollingSpecs, rzhevHillSpecs } from '../../src/world/rzhevHills'
import { RAVINES, ravineGap } from '../../src/world/rzhevRavines'
import { fieldGlsl } from '../../src/render/fieldShaders'
import {
  fieldSurfaceColor, HEDGE_CHANCE, OPEN_WOOD_GATE, regionAt, STEPPE_LAYOUT,
  trackGap, trackWidthAt,
} from '../../src/render/fields'
import { Color, Quaternion, Vector3 } from 'three'
import { MORTAR_RANGE_MAX, MORTAR_RANGE_MIN } from '../../src/render/groundBattle'
import { farmLaneVillages } from '../../src/render/farmSettlements'
import { createFloraBuffer, FloraKind } from '../../src/core/floraBuffer'
import { steppeLayout } from '../../src/render/steppeVillage'
import { FIELD_COLORS } from '../../src/render/season'
import { openHedgeFlora, openHedgeFloraFor, openWoodFlora, openWoodFloraFor } from '../../src/render/flora'

describe('勒熱夫的雪原', () => {
  it('夏季與晚秋的門檻就是原本的常數，散佈器是原本那一支', () => {
    expect(FIELD_COLORS.summer.woodGate).toEqual([...OPEN_WOOD_GATE])
    expect(FIELD_COLORS.lateAutumn.woodGate).toEqual([...OPEN_WOOD_GATE])
    expect(openWoodFloraFor(FIELD_COLORS.summer.woodGate)).toBe(openWoodFlora)
    expect(openWoodFloraFor(FIELD_COLORS.winterSteppe.woodGate)).not.toBe(openWoodFlora)
  })
})

/**
 * 勒熱夫的地形與佈局。守的是**空間關係**：丘陵不重疊（AI 避障的硬約束）、
 * 所有擺位都在戰場框內、蘇軍支援砲離德軍單位夠遠（SC 500 炸目標不誤傷自己人）、
 * 車與車、車與固定單位不疊在一起。這些錯了不會報錯，只會在試飛時「怪怪的」。
 */

const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z)
/** 點到折線的最短距離 */
const distToRoute = (p: { x: number; z: number }, pts: readonly { x: number; z: number }[]): number => {
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1)))
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)))
  }
  return best
}

const avoid = rzhevHillAvoid()
const terrain = createRzhev(avoid)

describe('rzhev 地形', () => {
  it('丘陵的膨脹圓兩兩不重疊、峰高不超過上限、外緣在場地內', () => {
    const { hills } = terrain
    for (const h of hills) {
      expect(h.peak).toBeLessThanOrEqual(HILL_PEAK_MAX)
      expect(Math.hypot(h.cx, h.cz) + h.outerRadius).toBeLessThanOrEqual(HILL_LIMIT)
    }
    for (let i = 0; i < hills.length; i++) {
      for (let j = i + 1; j < hills.length; j++) {
        const a = hills[i]!
        const b = hills[j]!
        expect(Math.hypot(a.cx - b.cx, a.cz - b.cz), `${i}-${j}`)
          .toBeGreaterThanOrEqual(a.outerRadius + b.outerRadius + HILL_GAP)
      }
    }
    // 手擺的錨點在前，程序填的在後
    RZHEV_HILLS.forEach((a, i) => {
      expect(hills[i]!.cx).toBe(a.x)
      expect(hills[i]!.cz).toBe(a.z)
    })
  })

  /**
   * 村、沖溝與戰場那一塊要是平的（房子、溝帶、壕溝都是貼著地面畫的平面）。手擺的錨點不查 —— 它們
   * 本來就貼著戰場方框的邊；查的是程序填的丘陵與緩坡：膨脹圓離平地區、村與沖溝的中線有間隙。
   */
  it('填的丘陵與緩坡躲開戰場平地、村與沖溝', () => {
    const filled = [...rzhevHillSpecs(avoid).slice(RZHEV_HILLS.length), ...rollingSpecs(avoid)]
    expect(filled.length).toBeGreaterThan(300)
    const bad: string[] = []
    for (const h of filled) {
      const reach = h.radius * WOBBLE_MAX
      const l = toLocal(h.x, h.z)
      const at = `${h.x.toFixed(0)},${h.z.toFixed(0)}`
      for (const z of [
        { lx0: -1900, lx1: 1900, lz0: -2100, lz1: 1400 }, { lx0: -400, lx1: 800, lz0: 1400, lz1: 2100 },
      ]) {
        const gap = Math.hypot(Math.max(z.lx0 - l.lx, 0, l.lx - z.lx1), Math.max(z.lz0 - l.lz, 0, l.lz - z.lz1))
        if (!(gap >= reach)) bad.push(`平地區 ${at}`)
      }
      for (const a of avoid) {
        if (!(Math.hypot(h.x - a.x, h.z - a.z) >= reach + a.r)) bad.push(`村 ${a.x.toFixed(0)},${a.z.toFixed(0)} ← ${at}`)
      }
      if (!(ravineGap(h.x, h.z) >= reach + 32)) bad.push(`溝 ${at}`)
    }
    expect(bad).toEqual([])
  })

  /** 緩坡不登錄成 AI 看得到的丘陵，所以要低到貼地飛也撞不到：最高不超過 40 m */
  it('緩坡低矮、而且不在回傳的丘陵清單裡', () => {
    const rolling = rollingSpecs(avoid)
    expect(Math.max(...rolling.map((h) => h.peak))).toBeLessThanOrEqual(40)
    expect(terrain.hills.length).toBe(rzhevHillSpecs(avoid).length)
  })

  it('沖溝沿線的地面是平的：每一個溝點的高度低於 3 m', () => {
    const { field } = terrain
    const n = field.size
    const half = ((n - 1) * field.cell) / 2
    for (const r of RAVINES) {
      for (const p of r.points) {
        const col = Math.round((p.x + half) / field.cell)
        const row = Math.round((p.z + half) / field.cell)
        if (col < 0 || row < 0 || col >= n || row >= n) continue
        expect(field.data[row * n + col]!, `${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeLessThan(3)
      }
    }
  })

  it('外圈是平的：場地邊緣高度 0', () => {
    const { field } = terrain
    const n = field.size
    for (let i = 0; i < n; i += 25) {
      expect(field.data[i]).toBe(0)
      expect(field.data[(n - 1) * n + i]).toBe(0)
    }
  })

  it('縱隊的路線都在場地內，而且不畫成路', () => {
    for (const route of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
      for (const p of route) {
        expect(Math.abs(p.x)).toBeLessThan(FARM_EXTENT / 2)
        expect(Math.abs(p.z)).toBeLessThan(FARM_EXTENT / 2)
      }
    }
    expect(RZHEV_SITE.roads).toHaveLength(0)
  })
})

describe('rzhev 佈局', () => {
  const fixed: readonly Spot[] = [
    ...GERMAN_AT_GUNS, ...GERMAN_DUG_PANZERS, ...WRECK_SOVIET_TANKS, ...WRECK_GERMAN_PANZERS, ...STALLED_SOVIET_TANKS,
    ...GERMAN_INFANTRY, ...SOVIET_INFANTRY, ...GERMAN_FLAK, ...SOVIET_FLAK, ...SOVIET_SUPPORT_GUNS,
    ...GERMAN_MORTARS, ...SOVIET_MORTARS, ...GERMAN_TRUCKS,
  ]
  /** 德軍（藍）活著、會被炸彈誤傷的固定單位：反坦克砲、固定戰車、步兵、防空、迫擊砲、卡車 */
  const friendly: readonly Spot[] = [
    ...GERMAN_AT_GUNS, ...GERMAN_DUG_PANZERS, ...GERMAN_INFANTRY, ...GERMAN_FLAK, ...GERMAN_MORTARS, ...GERMAN_TRUCKS,
  ]
  const reserveEnds = [GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST].map((r) => r[r.length - 1]!)

  it('固定單位都在戰場框內', () => {
    for (const s of fixed) {
      const l = toLocal(s.x, s.z)
      expect(Math.abs(l.lx)).toBeLessThanOrEqual(BATTLE_HALF)
      expect(Math.abs(l.lz)).toBeLessThanOrEqual(BATTLE_HALF)
    }
  })

  it('禁區與佈局測試用的全部單位名單，就是上面這十三個陣列', () => {
    expect(UNIT_SPOTS).toHaveLength(fixed.length)
    for (const s of fixed) expect(UNIT_SPOTS).toContain(s)
  })

  /** 炸彈不分敵我，殺傷半徑約 33 m：玩家炸蘇軍支援砲時離任何一個德軍單位至少兩倍半徑 */
  it('蘇軍支援砲離每一個德軍單位與預備隊終點至少 66 m', () => {
    for (let i = 0; i < SOVIET_SUPPORT_GUNS.length; i++) {
      for (const f of [...friendly, ...reserveEnds]) {
        expect(dist(SOVIET_SUPPORT_GUNS[i]!, f), `砲 ${i}`).toBeGreaterThanOrEqual(66)
      }
    }
  })

  /** `mopUp` 補射的射程：剩下的砲要有德軍的射手在 1,500 m 內，打得到 */
  it('每一門蘇軍支援砲 1,500 m 內都有一個德軍射手（反坦克砲或固定戰車）', () => {
    for (const g of SOVIET_SUPPORT_GUNS) {
      const near = [...GERMAN_AT_GUNS, ...GERMAN_DUG_PANZERS].filter((s) => dist(s, g) <= 1500)
      expect(near.length, `砲 ${g.x.toFixed(0)},${g.z.toFixed(0)}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('德軍防空離縱隊路線至少 60 m', () => {
    for (let i = 0; i < GERMAN_FLAK.length; i++) {
      for (const r of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
        expect(distToRoute(GERMAN_FLAK[i]!, r), `防空 ${i}`).toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('蘇軍防空離縱隊路線至少 100 m、離每一個德軍單位至少 126 m', () => {
    for (let i = 0; i < SOVIET_FLAK.length; i++) {
      for (const r of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
        expect(distToRoute(SOVIET_FLAK[i]!, r), `防空 ${i}`).toBeGreaterThanOrEqual(100)
      }
      for (const f of [...friendly, ...reserveEnds]) expect(dist(SOVIET_FLAK[i]!, f), `防空 ${i}`).toBeGreaterThanOrEqual(126)
    }
  })

  it('蘇軍支援砲與防空離路中線至少 70 m、離雷區與障礙線至少 25 m', () => {
    const reg = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
    const onRoad = (x: number, z: number): boolean => {
      regionAt(x, z, reg)
      return trackGap(x, z, reg) < trackWidthAt(x, z)
    }
    const nearRoad = (s: Spot, r: number): boolean => {
      if (onRoad(s.x, s.z)) return true
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        if (onRoad(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r)) return true
      }
      return false
    }
    const inMine = (s: Spot, room: number): boolean => MINEFIELDS.some((m) => {
      const dx = s.x - m.x
      const dz = s.z - m.z
      return Math.abs(dx * m.ux + dz * m.uz) < m.hu + room && Math.abs(dx * m.vx + dz * m.vz) < m.hv + room
    })
    for (const s of [...SOVIET_SUPPORT_GUNS, ...SOVIET_FLAK]) {
      expect(nearRoad(s, 70), `路 ${s.x.toFixed(0)},${s.z.toFixed(0)}`).toBe(false)
      expect(inMine(s, 25), `雷區 ${s.x.toFixed(0)},${s.z.toFixed(0)}`).toBe(false)
      for (const t of TRENCHES) {
        expect(distToRoute(s, t.points), `壕溝 ${s.x.toFixed(0)},${s.z.toFixed(0)}`).toBeGreaterThanOrEqual(25 + t.width / 2)
      }
    }
  })

  /** 迫擊砲在射程裡才打得到人：德軍的離蘇軍步兵不超過最大射程、蘇軍的離德軍步兵不近於最小射程 */
  it('迫擊砲：兩邊的前沿都在射程之內', () => {
    for (const m of GERMAN_MORTARS) {
      const reach = SOVIET_INFANTRY.filter((g) => dist(m, g) >= MORTAR_RANGE_MIN && dist(m, g) <= MORTAR_RANGE_MAX)
      expect(reach.length, `德軍迫擊砲 ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(10)
    }
    for (const m of SOVIET_MORTARS) {
      const reach = GERMAN_INFANTRY.filter((g) => dist(m, g) >= MORTAR_RANGE_MIN && dist(m, g) <= MORTAR_RANGE_MAX)
      expect(reach.length, `蘇軍迫擊砲 ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(10)
    }
  })

  /** 兩支縱隊在 (334, +696) 匯合後走近乎平行的兩條線；停車位置的相位差太小，兩台 T-34（車長約 6.7 m）會疊在一起 */
  it('縱隊停妥後，所有車兩兩相距至少 12 m', () => {
    const pose = {
      position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion(), angularVelocity: new Vector3(),
    }
    const stops = card.battle.columns!.flatMap((c) => columnGround(c).map((e) => {
      motionPose(e.motion!, 0, 1e9, pose)
      return { x: pose.position.x, z: pose.position.z }
    }))
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) expect(dist(stops[i]!, stops[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(12)
    }
  })

  /**
   * 蘇軍戰車到雷帶外展開、縱隊行進時前後車左右交錯。行進與停妥的位置錯了不會報錯，
   * 只是試飛時看到車疊在一起、開進雷區或擠在步兵身上。
   */
  describe('縱隊的展開與交錯', () => {
    const p = { position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion(), angularVelocity: new Vector3() }
    const cols = card.battle.columns!
    const red = cols.filter((c) => c.team === 'red')
    const at_ = (cs: typeof cols, t: number): { x: number; z: number; heading: number }[] => cs.flatMap((c) => columnGround(c).map((e) => {
      motionPose(e.motion!, 0, t, p)
      const f = new Vector3(0, 0, -1).applyQuaternion(p.orientation)
      return { x: p.position.x, z: p.position.z, heading: Math.atan2(-f.x, -f.z) }
    }))
    const redFixed: readonly Spot[] = [
      ...SOVIET_INFANTRY, ...SOVIET_SUPPORT_GUNS, ...SOVIET_FLAK, ...SOVIET_MORTARS, ...WRECK_SOVIET_TANKS, ...STALLED_SOVIET_TANKS,
    ]
    const inMine = (x: number, z: number): boolean => MINEFIELDS.some((m) => {
      const dx = x - m.x
      const dz = z - m.z
      return Math.abs(dx * m.ux + dz * m.uz) < m.hu && Math.abs(dx * m.vx + dz * m.vz) < m.hv
    })
    const segDist = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number => {
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)))
      return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
    }

    it('蘇軍停妥：不在雷區、離壕溝與反坦克壕至少 25 m、離蘇軍的固定單位至少 18 m', () => {
      for (const e of at_(red, 1e9)) {
        const tag = `${toLocal(e.x, e.z).lx.toFixed(0)},${toLocal(e.x, e.z).lz.toFixed(0)}`
        expect(inMine(e.x, e.z), tag).toBe(false)
        for (const t of TRENCHES) for (let k = 0; k + 1 < t.points.length; k++) expect(segDist(e.x, e.z, t.points[k]!, t.points[k + 1]!), tag).toBeGreaterThanOrEqual(25)
        for (const f of redFixed) expect(dist(e, f), tag).toBeGreaterThanOrEqual(18)
      }
    })

    /** 【整個行進與展開的過程】各輛分頭開向楔位，路徑會交錯；抽樣整段看有沒有疊車、開進雷區、壓到步兵 */
    it('行進與展開的全程：所有車任何時刻兩兩相距超過 12 m；蘇軍不進雷區、不壓到蘇軍的固定單位（至少 8 m）', () => {
      // 每一台的行進是時間的純函數：路徑建一次，每個時刻各取一次姿態
      const motions = cols.flatMap((c) => columnGround(c).map((e) => e.motion!))
      const isRed = cols.flatMap((c) => c.units.map(() => c.team === 'red'))
      const n = motions.length
      const xs = new Float64Array(n)
      const zs = new Float64Array(n)
      const bad: string[] = []
      for (let t = 0; t <= 900; t += 2.5) {
        for (let i = 0; i < n; i++) {
          motionPose(motions[i]!, 0, t, p)
          xs[i] = p.position.x
          zs[i] = p.position.z
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          if (!(Math.hypot(xs[i]! - xs[j]!, zs[i]! - zs[j]!) > 12)) bad.push(`t=${t} ${i}-${j} 疊車`)
        }
        // 出發前（t < 200）蘇軍藏在戰場框外的南邊，只看進場之後
        if (t < 200) continue
        for (let i = 0; i < n; i++) {
          if (!isRed[i]) continue
          if (inMine(xs[i]!, zs[i]!)) bad.push(`t=${t} ${i} 雷區`)
          for (const f of redFixed) {
            if (!(Math.hypot(xs[i]! - f.x, zs[i]! - f.z) >= 8)) bad.push(`t=${t} ${i} 壓到 ${f.x.toFixed(0)},${f.z.toFixed(0)}`)
          }
        }
      }
      expect(bad).toEqual([])
    })
  })

  it('固定單位兩兩至少相距 45 m', () => {
    const bad: string[] = []
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) if (!(dist(fixed[i]!, fixed[j]!) >= 45)) bad.push(`${i}-${j}`)
    }
    expect(bad).toEqual([])
  })

  it('蘇軍縱隊的路線不穿過雷區、離壕溝與反坦克壕至少 25 m（缺口開在路上）', () => {
    const inMine = (x: number, z: number): boolean => MINEFIELDS.some((m) => {
      const dx = x - m.x
      const dz = z - m.z
      return Math.abs(dx * m.ux + dz * m.uz) < m.hu && Math.abs(dx * m.vx + dz * m.vz) < m.hv
    })
    const segDist = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number => {
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)))
      return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
    }
    const bad: string[] = []
    for (const route of [SOVIET_ROUTE_A, SOVIET_ROUTE_B]) {
      for (let k = 0; k + 1 < route.length; k++) {
        const a = route[k]!
        const b = route[k + 1]!
        const n = Math.ceil(dist(a, b) / 5)
        for (let i = 0; i <= n; i++) {
          const x = a.x + ((b.x - a.x) * i) / n
          const z = a.z + ((b.z - a.z) * i) / n
          if (inMine(x, z)) bad.push(`雷區 ${x.toFixed(0)},${z.toFixed(0)}`)
          for (const t of TRENCHES) {
            for (let s = 0; s + 1 < t.points.length; s++) {
              if (!(segDist(x, z, t.points[s]!, t.points[s + 1]!) >= 25)) bad.push(`壕溝 ${x.toFixed(0)},${z.toFixed(0)}`)
            }
          }
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('航向用局部羅盤度數：0 = 朝德軍後方、90 = 局部右手邊、180 = 朝蘇軍', () => {
    const right = at(1, 0)
    const origin = at(0, 0)
    const rx = right.x - origin.x
    const rz = right.z - origin.z
    const north = at(0, -1)
    const nx = north.x - origin.x
    const nz = north.z - origin.z
    for (const deg of [0, 33, 90, 117, 180, 230, 270, 350]) {
      const h = facing(deg)
      const t = (deg * Math.PI) / 180
      // 世界航向 h 的朝向向量是 (−sin h, −cos h)
      expect(-Math.sin(h)).toBeCloseTo(Math.cos(t) * nx + Math.sin(t) * rx, 9)
      expect(-Math.cos(h)).toBeCloseTo(Math.cos(t) * nz + Math.sin(t) * rz, 9)
    }
    expect(facing(0)).toBeCloseTo(FRONT_HEADING, 9)
    expect(Math.cos(facing(180) - FRONT_HEADING)).toBeCloseTo(-1, 9)
  })

  it('縱隊的集結全部落在路線的第一段上（開場車頭同向）', () => {
    for (const c of card.battle.columns!) {
      const a = c.route[0]!
      const b = c.route[1]!
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      expect(len, c.units.join()).toBeGreaterThan((c.units.length - 1) * c.gap)
    }
  })

  it('戰場痕跡（壕溝、履帶痕、燒田、雷區）都在戰場框內', () => {
    // 反坦克壕剛好接到 ±1,500：座標換來換去有浮點誤差
    const inBox = (p: { x: number; z: number }): void => {
      const l = toLocal(p.x, p.z)
      expect(Math.abs(l.lx)).toBeLessThanOrEqual(BATTLE_HALF + 1e-6)
      expect(Math.abs(l.lz)).toBeLessThanOrEqual(BATTLE_HALF + 1e-6)
    }
    for (const l of [...TRENCHES, ...TRACKS]) l.points.forEach(inBox)
    SCORCH.forEach(inBox)
    for (const m of MINEFIELDS) {
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        inBox({
          x: m.x + a * m.hu * m.ux + b * m.hv * m.vx,
          z: m.z + a * m.hu * m.uz + b * m.hv * m.vz,
        })
      }
    }
  })

  it('彈坑特別密的地方落在交戰帶加漸弱帶之內（外面的格子不會被問到）', () => {
    const fade = RZHEV_SITE.scars!.fade
    const z = SCAR_ZONE
    for (const p of CRATER_PATCHES) {
      expect(p.x - p.r).toBeGreaterThan(z.x0 - fade)
      expect(p.x + p.r).toBeLessThan(z.x1 + fade)
      expect(p.z - p.r).toBeGreaterThan(z.z0 - fade)
      expect(p.z + p.r).toBeLessThan(z.z1 + fade)
    }
    expect(RZHEV_SITE.scars?.craterPatches).toBe(CRATER_PATCHES)
  })

  it('沒有墊面、不畫路、戰場痕跡掛在場地上', () => {
    expect(RZHEV_SITE.pad).toBeUndefined()
    expect(RZHEV_SITE.scars?.trenches).toBe(TRENCHES)
    expect(RZHEV_SITE.scars?.minefields).toBe(MINEFIELDS)
  })

  it('丘陵的範圍與 WOBBLE_MAX 一致（生成器與常數表同一份）', () => {
    const specs = rzhevHillSpecs(avoid)
    terrain.hills.forEach((h, i) => expect(h.outerRadius).toBeCloseTo(specs[i]!.radius * WOBBLE_MAX, 6))
  })
})

describe('勒熱夫雪原的樹籬', () => {
  it('夏季與晚秋的樹籬機率就是原本的常數，散佈器是原本那一支', () => {
    expect(FIELD_COLORS.summer.hedgeChance).toBe(HEDGE_CHANCE)
    expect(FIELD_COLORS.lateAutumn.hedgeChance).toBe(HEDGE_CHANCE)
    expect(openHedgeFloraFor(HEDGE_CHANCE)).toBe(openHedgeFlora)
  })
})

describe('草原田的格局', () => {
  it('草原田的著色器：大格、不對切、每條田界都是田埂；中歐的字串不動', () => {
    const s = fieldGlsl('winterSteppe')
    expect(s).toContain(`const float FIELD_SPACING = ${STEPPE_LAYOUT.spacing.toFixed(1)};`)
    expect(s).toContain('const float SPLIT_CHANCE = 0.000;')
    expect(s).toContain('const float HEDGE_CHANCE = 1.000;')
    expect(s).toContain(`const float HEDGE_WIDTH = ${STEPPE_LAYOUT.ridge.toFixed(1)};`)
    expect(s).not.toContain('CONE_FAR_COLOR : BROAD_FAR_COLOR, fieldFar)')
    expect(fieldGlsl('summer')).toContain('const float SPLIT_CHANCE = 0.350;')
  })

  it('草原田沒有 CPU 版的取色，明講不支援', () => {
    expect(() => fieldSurfaceColor(0, 0, new Color(), 'winterSteppe')).toThrow()
  })
})

describe('勒熱夫的戰場對準村與路', () => {
  const inVillage = (x: number, z: number, margin = 0): boolean => {
    const l = toLocal(x, z)
    return Math.abs(l.lx) < VILLAGE_BOX.half + margin
      && l.lz < VILLAGE_BOX.south + margin && l.lz > VILLAGE_BOX.north - margin
  }

  it('村的站址與走向就是農地框架產生的那個村，街長出來的範圍與常數一致', () => {
    const v = farmLaneVillages(8000).find((x) => x.place.name === 'v-2,0')!
    expect(v.siteX).toBeCloseTo(VILLAGE.x, 3)
    expect(v.siteZ).toBeCloseTo(VILLAGE.z, 3)
    expect(v.lane).toBeCloseTo(VILLAGE.lane, 9)
    const { flora } = steppeLayout(farmLaneVillages(8000), () => false)
    const buf = createFloraBuffer(200000)
    flora(VILLAGE.x - 2500, VILLAGE.z - 2500, VILLAGE.x + 2500, VILLAGE.z + 2500, () => 0, buf)
    let lo = Infinity
    let hi = -Infinity
    const tx = Math.cos(VILLAGE.lane)
    const tz = Math.sin(VILLAGE.lane)
    for (let i = 0; i < buf.count; i++) {
      if (buf.kind[i] !== FloraKind.House) continue
      const dx = buf.data[i * 6]! - VILLAGE.x
      const dz = buf.data[i * 6 + 2]! - VILLAGE.z
      if (Math.abs(-dx * tz + dz * tx) > 24) continue
      const a = dx * tx + dz * tz
      lo = Math.min(lo, a)
      hi = Math.max(hi, a)
    }
    expect(lo).toBeGreaterThan(-VILLAGE.southReach - 40)
    expect(lo).toBeLessThan(-VILLAGE.southReach + 40)
    expect(hi).toBeGreaterThan(VILLAGE.northReach - 40)
    expect(hi).toBeLessThan(VILLAGE.northReach + 40)
  })

  it('單位不壓在路上（路中線 60 m 內）、不在主街兩端的 100 m 內；壕溝、雷區與燒田讓開主街帶', () => {
    const fixed = UNIT_SPOTS
    const reg ={ r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
    const onRoad = (x: number, z: number): boolean => {
      regionAt(x, z, reg)
      return trackGap(x, z, reg) < trackWidthAt(x, z)
    }
    const nearRoad = (x: number, z: number, r: number): boolean => {
      if (onRoad(x, z)) return true
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        if (onRoad(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true
      }
      return false
    }
    for (const s of fixed) {
      expect(nearRoad(s.x, s.z, 60), `路 ${s.x},${s.z}`).toBe(false)
      const l = toLocal(s.x, s.z)
      const south = l.lz <= VILLAGE_BOX.south && l.lz >= VILLAGE_BOX.south - 100
      const north = l.lz <= VILLAGE_BOX.north + 100 && l.lz >= VILLAGE_BOX.north
      expect(Math.abs(l.lx) < 150 && (south || north), `主街端點 ${l.lx},${l.lz}`).toBe(false)
    }
    for (const t of TRENCHES) for (const p of t.points) expect(inVillage(p.x, p.z), `${p.x},${p.z}`).toBe(false)
    for (const p of SCORCH) expect(inVillage(p.x, p.z), `${p.x},${p.z}`).toBe(false)
    for (const m of MINEFIELDS) {
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
        expect(inVillage(m.x + a * m.hu * m.ux + b * m.hv * m.vx, m.z + a * m.hu * m.uz + b * m.hv * m.vz)).toBe(false)
      }
    }
  })

  it('德軍預備隊的路線不穿過村', () => {
    for (const route of [GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
      for (let i = 0; i + 1 < route.length; i++) {
        const a = route[i]!
        const b = route[i + 1]!
        for (let t = 0; t <= 1; t += 0.05) {
          expect(inVillage(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)).toBe(false)
        }
      }
    }
  })

  it('禁區：單位、壕溝、縱隊路線上與村南緣以南是禁區，村心與遠處不是', () => {
    for (const s of UNIT_SPOTS) expect(battleKeepOut(s.x, s.z), `單位 ${s.x},${s.z}`).toBe(true)
    for (const t of TRENCHES) for (const p of t.points) expect(battleKeepOut(p.x, p.z), `壕溝 ${p.x},${p.z}`).toBe(true)
    for (const r of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
      for (const p of r) expect(battleKeepOut(p.x, p.z), `路線 ${p.x},${p.z}`).toBe(true)
    }
    expect(battleKeepOut(VILLAGE.x, VILLAGE.z)).toBe(false)
    const south = at(0, VILLAGE_BOX.south + 100)
    expect(battleKeepOut(south.x, south.z)).toBe(true)
    expect(battleKeepOut(VILLAGE.x + 9000, VILLAGE.z)).toBe(false)
    // 南邊集結段（lz +1,200 以南）只有縱隊路線兩側是禁區，路外不是
    const onRoute = at(334, 1600)
    const offRoute = at(1200, 1600)
    expect(battleKeepOut(onRoute.x, onRoute.z)).toBe(true)
    expect(battleKeepOut(offRoute.x, offRoute.z)).toBe(false)
  })

  it('戰場所在的村是農地框架裡的那個村', () => {
    expect(farmLaneVillages(8000).some((x) => x.place.name === VILLAGE_NAME)).toBe(true)
  })
})
