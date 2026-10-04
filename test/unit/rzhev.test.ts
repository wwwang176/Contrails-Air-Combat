import { describe, expect, it } from 'vitest'
import {
  GERMAN_AT_GUNS, at, BATTLE_HALF, battleKeepOut, burnRateOf, CRATER_PATCHES, facing, FRONT_HEADING,
  MINEFIELDS, SCAR_ZONE, toLocal,
  VILLAGE, VILLAGE_BOX, VILLAGE_NAME, GERMAN_DUG_PANZERS, SOVIET_INFANTRY, SOVIET_MORTARS, RZHEV_HILLS,
  SOVIET_ROUTE_A, SOVIET_ROUTE_B, SOVIET_FLAK, GERMAN_INFANTRY, GERMAN_MORTARS, GERMAN_TRUCKS, STALLED_SOVIET_TANKS,
  GERMAN_RESERVE_EAST, GERMAN_RESERVE_WEST, WRECK_SOVIET_TANKS, WRECK_GERMAN_PANZERS, GERMAN_FLAK,
  SOVIET_SUPPORT_GUNS, UNIT_SPOTS, COLUMN_STAGGER, SOVIET_DEPLOY, type Spot,
} from '../../src/world/rzhev'
import { FARM_EXTENT, HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX } from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'
import { columnGround, MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'
import { motionPose } from '../../src/world/groundMotion'
import { SCORCH, TRACKS, TRENCHES } from '../../src/world/rzhev'
import { RZHEV_SITE, rzhevHillAvoid } from '../../src/render/terrain'
import { createRzhev, rollingSpecs, rzhevHillSpecs } from '../../src/world/rzhevHills'
import { RAVINES, ravineGap } from '../../src/world/rzhevRavines'
import {
  fieldGlsl, fieldSurfaceColor, HEDGE_CHANCE, openWoodCover, OPEN_WOOD_GATE, regionAt, STEPPE_LAYOUT, trackGap,
  trackWidthAt,
} from '../../src/render/fields'
import { Color, Quaternion, Vector3 } from 'three'
import { MORTAR_RANGE_MAX, MORTAR_RANGE_MIN } from '../../src/render/groundBattle'
import { farmLaneVillages } from '../../src/render/farmSettlements'
import { createFloraBuffer, FloraKind } from '../../src/render/flora'
import { steppeLayout } from '../../src/render/steppeVillage'
import { FIELD_COLORS } from '../../src/render/season'
import { openHedgeFlora, openHedgeFloraFor, openWoodFlora, openWoodFloraFor } from '../../src/render/flora'

describe('勒熱夫的雪原', () => {
  it('樹林比夏季少很多：同一片地的平均覆蓋率不到夏季的三分之一', () => {
    let summer = 0
    let winter = 0
    for (let z = -6000; z <= 6000; z += 150) {
      for (let x = -6000; x <= 6000; x += 150) {
        summer += openWoodCover(x, z, FIELD_COLORS.summer.woodGate)
        winter += openWoodCover(x, z, FIELD_COLORS.winterSteppe.woodGate)
      }
    }
    expect(summer).toBeGreaterThan(0)
    expect(winter).toBeLessThan(summer / 3)
  })

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
 * 縱隊停下來時兩邊還隔著一段距離。這些錯了不會報錯，只會在試飛時「怪怪的」。
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
    expect(hills.length).toBeGreaterThan(RZHEV_HILLS.length + 30)
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
    for (const h of filled) {
      const reach = h.radius * WOBBLE_MAX
      const l = toLocal(h.x, h.z)
      for (const z of [
        { lx0: -1900, lx1: 1900, lz0: -2100, lz1: 1400 }, { lx0: -400, lx1: 800, lz0: 1400, lz1: 2100 },
      ]) {
        const gap = Math.hypot(Math.max(z.lx0 - l.lx, 0, l.lx - z.lx1), Math.max(z.lz0 - l.lz, 0, l.lz - z.lz1))
        expect(gap, `平地區 ${h.x.toFixed(0)},${h.z.toFixed(0)}`).toBeGreaterThanOrEqual(reach)
      }
      for (const a of avoid) expect(Math.hypot(h.x - a.x, h.z - a.z), `村 ${a.x.toFixed(0)},${a.z.toFixed(0)}`).toBeGreaterThanOrEqual(reach + a.r)
      expect(ravineGap(h.x, h.z), `溝 ${h.x.toFixed(0)},${h.z.toFixed(0)}`).toBeGreaterThanOrEqual(reach + 32)
    }
  })

  /** 緩坡不登錄成 AI 看得到的丘陵，所以要低到貼地飛也撞不到：最高不超過 40 m */
  it('緩坡低矮、而且不在回傳的丘陵清單裡', () => {
    const rolling = rollingSpecs(avoid)
    expect(Math.max(...rolling.map((h) => h.peak))).toBeLessThanOrEqual(40)
    expect(terrain.hills.length).toBe(rzhevHillSpecs(avoid).length)
  })

  /** 負責人要的：地面一眼看得出起伏，丘陵加緩坡蓋到一半以上的地 */
  it('戰場周圍 6 km 見方裡有一半以上的地高於 2 m', () => {
    const { field } = terrain
    const n = field.size
    const half = ((n - 1) * field.cell) / 2
    const center = at(0, 0)
    let high = 0
    let total = 0
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = i * field.cell - half
        const z = j * field.cell - half
        if (Math.abs(x - center.x) > 6000 || Math.abs(z - center.z) > 6000) continue
        total++
        if (field.data[j * n + i]! > 2) high++
      }
    }
    expect(high / total).toBeGreaterThan(0.5)
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

  it('德軍與蘇軍分在南北兩側：德軍單位在局部縱深較北（lz 較小）、蘇軍在較南', () => {
    const meanLz = (a: readonly Spot[]): number => a.reduce((n, s) => n + toLocal(s.x, s.z).lz, 0) / a.length
    expect(meanLz(GERMAN_AT_GUNS)).toBeLessThan(0)
    expect(meanLz(GERMAN_INFANTRY)).toBeLessThan(meanLz(SOVIET_INFANTRY) - 300)
    expect(meanLz(GERMAN_FLAK)).toBeLessThan(0)
    expect(meanLz(SOVIET_FLAK)).toBeGreaterThan(500)
    expect(meanLz(SOVIET_SUPPORT_GUNS)).toBeGreaterThan(400)
  })

  /** 炸彈不分敵我，殺傷半徑約 33 m：玩家炸蘇軍支援砲時離任何一個德軍單位至少兩倍半徑 */
  it('蘇軍支援砲：10 門、彼此至少 150 m、離每一個德軍單位與預備隊終點至少 66 m', () => {
    expect(SOVIET_SUPPORT_GUNS).toHaveLength(10)
    for (let i = 0; i < SOVIET_SUPPORT_GUNS.length; i++) {
      for (let j = i + 1; j < SOVIET_SUPPORT_GUNS.length; j++) {
        expect(dist(SOVIET_SUPPORT_GUNS[i]!, SOVIET_SUPPORT_GUNS[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(150)
      }
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

  it('德軍防空：8 門、彼此至少 150 m、離每一門反坦克砲至少 150 m、離縱隊路線至少 60 m', () => {
    expect(GERMAN_FLAK).toHaveLength(8)
    for (let i = 0; i < GERMAN_FLAK.length; i++) {
      for (let j = i + 1; j < GERMAN_FLAK.length; j++) expect(dist(GERMAN_FLAK[i]!, GERMAN_FLAK[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(150)
      for (const a of GERMAN_AT_GUNS) expect(dist(GERMAN_FLAK[i]!, a), `防空 ${i}`).toBeGreaterThanOrEqual(150)
      for (const r of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
        expect(distToRoute(GERMAN_FLAK[i]!, r), `防空 ${i}`).toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('蘇軍防空：12 門、彼此至少 150 m、離支援砲至少 150 m、離縱隊路線至少 100 m、離每一個德軍單位至少 126 m', () => {
    expect(SOVIET_FLAK).toHaveLength(12)
    for (let i = 0; i < SOVIET_FLAK.length; i++) {
      for (let j = i + 1; j < SOVIET_FLAK.length; j++) expect(dist(SOVIET_FLAK[i]!, SOVIET_FLAK[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(150)
      for (const g of SOVIET_SUPPORT_GUNS) expect(dist(SOVIET_FLAK[i]!, g), `防空 ${i}`).toBeGreaterThanOrEqual(150)
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
  it('迫擊砲：德軍 6 門、蘇軍 4 門；兩邊的前沿都在射程之內', () => {
    expect(GERMAN_MORTARS).toHaveLength(6)
    expect(SOVIET_MORTARS).toHaveLength(4)
    for (const m of GERMAN_MORTARS) {
      const reach = SOVIET_INFANTRY.filter((g) => dist(m, g) >= MORTAR_RANGE_MIN && dist(m, g) <= MORTAR_RANGE_MAX)
      expect(reach.length, `德軍迫擊砲 ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(10)
    }
    for (const m of SOVIET_MORTARS) {
      const reach = GERMAN_INFANTRY.filter((g) => dist(m, g) >= MORTAR_RANGE_MIN && dist(m, g) <= MORTAR_RANGE_MAX)
      expect(reach.length, `蘇軍迫擊砲 ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(10)
    }
  })

  it('縱隊停住時，蘇軍的 T-34 與德軍反擊的預備隊至少隔 250 m；蘇軍縱隊離每一個德軍單位至少 300 m', () => {
    for (const g of [SOVIET_ROUTE_A, SOVIET_ROUTE_B]) {
      for (const t of [GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
        expect(dist(g[g.length - 1]!, t[t.length - 1]!)).toBeGreaterThanOrEqual(250)
      }
    }
    for (const route of [SOVIET_ROUTE_A, SOVIET_ROUTE_B]) {
      const head = route[route.length - 1]!
      for (const f of friendly) expect(dist(head, f), `${f.x.toFixed(0)},${f.z.toFixed(0)}`).toBeGreaterThanOrEqual(300)
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
    expect(stops).toHaveLength(40)
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) expect(dist(stops[i]!, stops[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(12)
    }
  })

  /**
   * 蘇軍戰車到雷帶外展開成兩個寬楔形、四支縱隊行進時前後車左右交錯。這些都是空間關係，
   * 錯了不會報錯，只是試飛時看到車疊在一起、開進雷區或擠在步兵身上。
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

    it('四支縱隊都交錯；蘇軍兩支展開成朝德軍的楔形，德軍預備隊不展開', () => {
      expect(cols).toHaveLength(4)
      // 交錯幅度要大過車寬（T-34 約 3 m）的兩倍，前後車才看得出不在同一條線上
      expect(COLUMN_STAGGER).toBeGreaterThanOrEqual(6)
      for (const c of cols) expect(c.stagger, c.team).toBe(COLUMN_STAGGER)
      expect(red).toHaveLength(2)
      for (const c of red) expect(c.deploy).toEqual(SOVIET_DEPLOY)
      for (const c of cols.filter((c) => c.team === 'blue')) expect(c.deploy).toBeUndefined()
      expect(SOVIET_DEPLOY.facing).toBe(FRONT_HEADING)
    })

    /** 【停妥的是楔形，不是一列】兩個楔形左右分開：A 的楔尖在左、B 的在右 */
    it('蘇軍停妥：車頭朝德軍、20 輛兩兩相距至少 30 m、兩個楔形左右分開', () => {
      const s = at_(red, 1e9)
      expect(s).toHaveLength(20)
      for (const e of s) expect(Math.abs(Math.atan2(Math.sin(e.heading - FRONT_HEADING), Math.cos(e.heading - FRONT_HEADING)))).toBeLessThan(1e-6)
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(dist(s[i]!, s[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(30)
      const tipA = toLocal(s[0]!.x, s[0]!.z)
      const tipB = toLocal(s[10]!.x, s[10]!.z)
      expect(tipA.lx).toBeLessThan(tipB.lx - 300)
    })

    it('蘇軍停妥：離每一個德軍單位至少 300 m、不在雷區、離壕溝與反坦克壕至少 25 m、離蘇軍的固定單位至少 18 m', () => {
      for (const e of at_(red, 1e9)) {
        const tag = `${toLocal(e.x, e.z).lx.toFixed(0)},${toLocal(e.x, e.z).lz.toFixed(0)}`
        for (const f of friendly) expect(dist(e, f), tag).toBeGreaterThanOrEqual(300)
        expect(inMine(e.x, e.z), tag).toBe(false)
        for (const t of TRENCHES) for (let k = 0; k + 1 < t.points.length; k++) expect(segDist(e.x, e.z, t.points[k]!, t.points[k + 1]!), tag).toBeGreaterThanOrEqual(25)
        for (const f of redFixed) expect(dist(e, f), tag).toBeGreaterThanOrEqual(18)
      }
    })

    /** 【整個行進與展開的過程】各輛分頭開向楔位，路徑會交錯；抽樣整段看有沒有疊車、開進雷區、壓到步兵 */
    it('行進與展開的全程：40 輛任何時刻兩兩相距超過 12 m；蘇軍不進雷區、不壓到蘇軍的固定單位（至少 8 m）', () => {
      for (let t = 0; t <= 900; t += 2.5) {
        const all = at_(cols, t)
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
          expect(dist(all[i]!, all[j]!), `t=${t} ${i}-${j}`).toBeGreaterThan(12)
        }
        // 出發前（t < 200）蘇軍藏在戰場框外的南邊，只看進場之後
        if (t < 200) continue
        for (const e of at_(red, t)) {
          expect(inMine(e.x, e.z), `t=${t}`).toBe(false)
          for (const f of redFixed) expect(dist(e, f), `t=${t}`).toBeGreaterThanOrEqual(8)
        }
      }
    })
  })

  it('反坦克砲與其他單位：德軍反坦克砲兩兩相距至少 150 m，所有單位至少 45 m', () => {
    for (let i = 0; i < GERMAN_AT_GUNS.length; i++) {
      for (let j = i + 1; j < GERMAN_AT_GUNS.length; j++) expect(dist(GERMAN_AT_GUNS[i]!, GERMAN_AT_GUNS[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(150)
    }
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) expect(dist(fixed[i]!, fixed[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(45)
    }
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
    for (const route of [SOVIET_ROUTE_A, SOVIET_ROUTE_B]) {
      for (let k = 0; k + 1 < route.length; k++) {
        const a = route[k]!
        const b = route[k + 1]!
        const n = Math.ceil(dist(a, b) / 5)
        for (let i = 0; i <= n; i++) {
          const x = a.x + ((b.x - a.x) * i) / n
          const z = a.z + ((b.z - a.z) * i) / n
          expect(inMine(x, z), `${x.toFixed(0)},${z.toFixed(0)}`).toBe(false)
          for (const t of TRENCHES) {
            for (let s = 0; s + 1 < t.points.length; s++) {
              expect(segDist(x, z, t.points[s]!, t.points[s + 1]!)).toBeGreaterThanOrEqual(25)
            }
          }
        }
      }
    }
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

  it('兩翼反坦克壕邊各有兩輛殘骸在蘇軍那一側（南緣），彈坑特別密的地方蓋著它們', () => {
    const ditches = TRENCHES.filter((t) => t.width === 60)
    expect(ditches).toHaveLength(2)
    for (const d of ditches) {
      const a = toLocal(d.points[0]!.x, d.points[0]!.z)
      const side = Math.sign(a.lx)
      const wrecks = WRECK_SOVIET_TANKS.map((w) => toLocal(w.x, w.z))
        .filter((l) => Math.sign(l.lx) === side && Math.abs(l.lx) > 750)
      expect(wrecks.length, `側 ${side}`).toBeGreaterThanOrEqual(2)
      // 壕在 lz +200、寬 60；殘骸在壕的蘇軍那一側（lz 較大）或壓在壕的南緣
      for (const l of wrecks) {
        expect(l.lz).toBeGreaterThan(200)
        expect(l.lz).toBeLessThan(260)
      }
    }
    for (const p of CRATER_PATCHES) {
      const c = toLocal(p.x, p.z)
      expect(Math.abs(c.lx)).toBeGreaterThan(900)
      // 兩翼的殘骸都在某一片彈坑特別密的範圍之內
    }
    for (const w of WRECK_SOVIET_TANKS.filter((w) => Math.abs(toLocal(w.x, w.z).lx) > 750)) {
      expect(CRATER_PATCHES.some((p) => Math.hypot(w.x - p.x, w.z - p.z) < p.r), `${w.x},${w.z}`).toBe(true)
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
  it('田界長樹籬的機率遠低於夏季，夏季與晚秋仍是原本的常數', () => {
    expect(FIELD_COLORS.winterSteppe.hedgeChance).toBeLessThan(0.1)
    expect(FIELD_COLORS.summer.hedgeChance).toBe(HEDGE_CHANCE)
    expect(FIELD_COLORS.lateAutumn.hedgeChance).toBe(HEDGE_CHANCE)
    expect(openHedgeFloraFor(HEDGE_CHANCE)).toBe(openHedgeFlora)
  })
})

describe('草原田的格局', () => {
  it('勒熱夫的冬季是 steppe，夏季與晚秋是 european', () => {
    expect(FIELD_COLORS.winterSteppe.layout).toBe('steppe')
    expect(FIELD_COLORS.summer.layout).toBe('european')
    expect(FIELD_COLORS.lateAutumn.layout).toBe('european')
  })

  it('草原田的著色器：大格、不對切、每條田界都是田埂；中歐的字串不動', () => {
    const s = fieldGlsl('winterSteppe')
    expect(s).toContain(`const float FIELD_SPACING = ${STEPPE_LAYOUT.spacing.toFixed(1)};`)
    expect(s).toContain('const float SPLIT_CHANCE = 0.000;')
    expect(s).toContain('const float HEDGE_CHANCE = 1.000;')
    expect(s).toContain(`const float HEDGE_WIDTH = ${STEPPE_LAYOUT.ridge.toFixed(1)};`)
    expect(s).not.toContain('CONE_FAR_COLOR : BROAD_FAR_COLOR, fieldFar)')
    expect(fieldGlsl('summer')).toContain('const float SPLIT_CHANCE = 0.350;')
  })

  it('草原田的格寬在 500～900 m、格長在 650～1,100 m（常數推出的範圍，規格 §3.2）', () => {
    const w = STEPPE_LAYOUT.spacing
    expect(w * STEPPE_LAYOUT.spacingVar[0]).toBeGreaterThanOrEqual(500)
    expect(w * STEPPE_LAYOUT.spacingVar[1]).toBeLessThanOrEqual(900)
    expect(w * STEPPE_LAYOUT.spacingVar[0] * STEPPE_LAYOUT.aniso).toBeGreaterThanOrEqual(650)
    expect(w * STEPPE_LAYOUT.spacingVar[1] * STEPPE_LAYOUT.aniso).toBeLessThanOrEqual(1100)
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

  it('戰場所在的村是農地框架裡的那個村，而且燒得比別的村多', () => {
    expect(farmLaneVillages(8000).some((x) => x.place.name === VILLAGE_NAME)).toBe(true)
    expect(burnRateOf(VILLAGE_NAME)).toBeGreaterThan(burnRateOf('v0,0') * 3)
  })

  it('蘇軍縱隊沿路從南邊推來：集結位置在村南邊（局部縱深為正）', () => {
    for (const route of [SOVIET_ROUTE_A, SOVIET_ROUTE_B]) {
      expect(toLocal(route[0]!.x, route[0]!.z).lz).toBeGreaterThan(300)
    }
  })
})
