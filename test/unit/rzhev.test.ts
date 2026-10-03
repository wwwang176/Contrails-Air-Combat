import { describe, expect, it } from 'vitest'
import {
  AT_GUNS, at, BATTLE_HALF, battleKeepOut, burnRateOf, CRATER_PATCHES, createRzhev, facing, FRONT_HEADING,
  MINEFIELDS, SCAR_ZONE, toLocal,
  VILLAGE, VILLAGE_BOX, VILLAGE_NAME, FRONT_T34, GERMAN_INFANTRY, GERMAN_MORTARS, RZHEV_HILLS,
  PANZER_ROUTE_A, PANZER_ROUTE_B, SOVIET_FLAK, SOVIET_INFANTRY, SOVIET_MORTARS, SOVIET_TRUCKS, STALLED_PANZERS,
  T34_RESERVE_EAST, T34_RESERVE_WEST, WRECK_PANZERS, WRECK_T34, type Spot,
} from '../../src/world/rzhev'
import { FARM_EXTENT, HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX } from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'
import { columnGround, MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'
import { SCORCH, TRACKS, TRENCHES } from '../../src/world/rzhev'
import { RZHEV_SITE } from '../../src/render/terrain'
import {
  fieldGlsl, fieldSurfaceColor, HEDGE_CHANCE, openWoodCover, OPEN_WOOD_GATE, regionAt, STEPPE_LAYOUT, trackGap,
  trackWidthAt,
} from '../../src/render/fields'
import { Color } from 'three'
import { MORTAR_RANGE_MAX, MORTAR_RANGE_MIN } from '../../src/render/groundBattle'
import { farmLaneVillages } from '../../src/render/farmSettlements'
import { createFloraBuffer, FloraKind } from '../../src/render/flora'
import { steppeLayout } from '../../src/render/steppeVillage'
import { FIELD_COLORS } from '../../src/render/season'
import { openHedgeFlora, openHedgeFloraFor, openWoodFlora, openWoodFloraFor } from '../../src/render/flora'

describe('七月的麥田', () => {
  it('樹林比夏季少很多：同一片地的平均覆蓋率不到夏季的三分之一', () => {
    let summer = 0
    let july = 0
    for (let z = -6000; z <= 6000; z += 150) {
      for (let x = -6000; x <= 6000; x += 150) {
        summer += openWoodCover(x, z, FIELD_COLORS.summer.woodGate)
        july += openWoodCover(x, z, FIELD_COLORS.julyWheat.woodGate)
      }
    }
    expect(summer).toBeGreaterThan(0)
    expect(july).toBeLessThan(summer / 3)
  })

  it('夏季與晚秋的門檻就是原本的常數，散佈器是原本那一支', () => {
    expect(FIELD_COLORS.summer.woodGate).toEqual([...OPEN_WOOD_GATE])
    expect(FIELD_COLORS.lateAutumn.woodGate).toEqual([...OPEN_WOOD_GATE])
    expect(openWoodFloraFor(FIELD_COLORS.summer.woodGate)).toBe(openWoodFlora)
    expect(openWoodFloraFor(FIELD_COLORS.julyWheat.woodGate)).not.toBe(openWoodFlora)
  })
})

/**
 * 庫斯克的地形與佈局。守的是**空間關係**：丘陵不重疊（AI 避障的硬約束）、
 * 所有擺位都在戰場框內、德軍坦克離反坦克砲夠遠（SC 500 炸目標不誤傷自己人）、
 * 縱隊停下來時兩邊還隔著一段距離。這些錯了不會報錯，只會在試飛時「怪怪的」。
 */

const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z)

describe('rzhev 地形', () => {
  it('丘陵的膨脹圓兩兩不重疊、峰高不超過上限、外緣在場地內', () => {
    const { hills } = createRzhev()
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
    expect(hills.length).toBe(RZHEV_HILLS.length)
  })

  it('外圈是平的：場地邊緣高度 0', () => {
    const { field } = createRzhev()
    const n = field.size
    for (let i = 0; i < n; i += 25) {
      expect(field.data[i]).toBe(0)
      expect(field.data[(n - 1) * n + i]).toBe(0)
    }
  })

  it('縱隊的路線都在場地內，而且不畫成路', () => {
    for (const route of [PANZER_ROUTE_A, PANZER_ROUTE_B, T34_RESERVE_WEST, T34_RESERVE_EAST]) {
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
    ...AT_GUNS, ...FRONT_T34, ...WRECK_PANZERS, ...WRECK_T34, ...STALLED_PANZERS,
    ...SOVIET_INFANTRY, ...GERMAN_INFANTRY, ...SOVIET_FLAK, ...SOVIET_MORTARS, ...GERMAN_MORTARS, ...SOVIET_TRUCKS,
  ]

  it('固定單位都在戰場框內', () => {
    for (const s of fixed) {
      const l = toLocal(s.x, s.z)
      expect(Math.abs(l.lx)).toBeLessThanOrEqual(BATTLE_HALF)
      expect(Math.abs(l.lz)).toBeLessThanOrEqual(BATTLE_HALF)
    }
  })

  it('開場活著的德軍單位離每一門反坦克砲至少 500 m', () => {
    const german = [
      ...STALLED_PANZERS, ...GERMAN_INFANTRY, ...GERMAN_MORTARS,
      ...columnGround(card.battle.columns![0]!), ...columnGround(card.battle.columns![1]!),
    ]
    for (const g of german) {
      for (const a of AT_GUNS) expect(dist(g, a)).toBeGreaterThanOrEqual(500)
    }
  })

  /** 迫擊砲在射程裡才打得到人：蘇軍的離德軍步兵不超過最大射程、德軍的離蘇軍壕溝不近於最小射程 */
  it('迫擊砲：蘇軍 6 門、德軍 4 門；兩邊的前沿都在射程之內', () => {
    expect(SOVIET_MORTARS).toHaveLength(6)
    expect(GERMAN_MORTARS).toHaveLength(4)
    for (const m of SOVIET_MORTARS) {
      const reach = GERMAN_INFANTRY.filter((g) => dist(m, g) >= MORTAR_RANGE_MIN && dist(m, g) <= MORTAR_RANGE_MAX)
      expect(reach.length, `蘇軍迫擊砲 ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(10)
    }
    for (const m of GERMAN_MORTARS) {
      const reach = SOVIET_INFANTRY.filter((g) => dist(m, g) >= MORTAR_RANGE_MIN && dist(m, g) <= MORTAR_RANGE_MAX)
      expect(reach.length, `德軍迫擊砲 ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(10)
    }
  })

  it('縱隊停住時，德軍與反擊的 T-34 至少隔 250 m', () => {
    for (const g of [PANZER_ROUTE_A, PANZER_ROUTE_B]) {
      for (const t of [T34_RESERVE_WEST, T34_RESERVE_EAST]) {
        expect(dist(g[g.length - 1]!, t[t.length - 1]!)).toBeGreaterThanOrEqual(250)
      }
    }
  })

  it('反坦克砲兩兩相距至少 150 m（一顆炸彈只打掉一門），所有單位至少 45 m', () => {
    for (let i = 0; i < AT_GUNS.length; i++) {
      for (let j = i + 1; j < AT_GUNS.length; j++) expect(dist(AT_GUNS[i]!, AT_GUNS[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(150)
    }
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) expect(dist(fixed[i]!, fixed[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(45)
    }
  })

  it('德軍縱隊的路線不穿過雷區、離壕溝與反坦克壕至少 25 m（缺口開在路上）', () => {
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
    for (const route of [PANZER_ROUTE_A, PANZER_ROUTE_B]) {
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

  it('航向用局部羅盤度數：0 = 朝蘇軍後方、90 = 局部右手邊、180 = 朝德軍', () => {
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

  it('兩翼反坦克壕邊各有兩輛殘骸在德軍那一側（南緣），彈坑特別密的地方蓋著它們', () => {
    const ditches = TRENCHES.filter((t) => t.width === 60)
    expect(ditches).toHaveLength(2)
    for (const d of ditches) {
      const a = toLocal(d.points[0]!.x, d.points[0]!.z)
      const side = Math.sign(a.lx)
      const wrecks = WRECK_PANZERS.map((w) => toLocal(w.x, w.z))
        .filter((l) => Math.sign(l.lx) === side && Math.abs(l.lx) > 750)
      expect(wrecks.length, `側 ${side}`).toBeGreaterThanOrEqual(2)
      // 壕在 lz +200、寬 60；殘骸在壕的德軍那一側（lz 較大）或壓在壕的南緣
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
    for (const w of WRECK_PANZERS.filter((w) => Math.abs(toLocal(w.x, w.z).lx) > 750)) {
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
    const { hills } = createRzhev()
    hills.forEach((h, i) => expect(h.outerRadius).toBeCloseTo(RZHEV_HILLS[i]!.radius * WOBBLE_MAX, 6))
  })
})

describe('七月麥田的樹籬', () => {
  it('田界長樹籬的機率遠低於夏季，夏季與晚秋仍是原本的常數', () => {
    expect(FIELD_COLORS.julyWheat.hedgeChance).toBeLessThan(0.1)
    expect(FIELD_COLORS.summer.hedgeChance).toBe(HEDGE_CHANCE)
    expect(FIELD_COLORS.lateAutumn.hedgeChance).toBe(HEDGE_CHANCE)
    expect(openHedgeFloraFor(HEDGE_CHANCE)).toBe(openHedgeFlora)
  })
})

describe('草原田的格局', () => {
  it('七月麥田是 steppe，夏季與晚秋是 european', () => {
    expect(FIELD_COLORS.julyWheat.layout).toBe('steppe')
    expect(FIELD_COLORS.summer.layout).toBe('european')
    expect(FIELD_COLORS.lateAutumn.layout).toBe('european')
  })

  it('草原田的著色器：大格、不對切、每條田界都是田埂；中歐的字串不動', () => {
    const s = fieldGlsl('julyWheat')
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
    expect(() => fieldSurfaceColor(0, 0, new Color(), 'julyWheat')).toThrow()
  })
})

describe('庫斯克的戰場對準村與路', () => {
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
    const fixed = [
      ...AT_GUNS, ...FRONT_T34, ...WRECK_PANZERS, ...WRECK_T34, ...STALLED_PANZERS,
      ...SOVIET_INFANTRY, ...GERMAN_INFANTRY, ...SOVIET_FLAK, ...SOVIET_MORTARS, ...GERMAN_MORTARS, ...SOVIET_TRUCKS,
    ]
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

  it('蘇軍預備隊的路線不穿過村', () => {
    for (const route of [T34_RESERVE_WEST, T34_RESERVE_EAST]) {
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
    const fixed = [
      ...AT_GUNS, ...FRONT_T34, ...WRECK_PANZERS, ...WRECK_T34, ...STALLED_PANZERS,
      ...SOVIET_INFANTRY, ...GERMAN_INFANTRY, ...SOVIET_FLAK, ...SOVIET_MORTARS, ...GERMAN_MORTARS, ...SOVIET_TRUCKS,
    ]
    for (const s of fixed) expect(battleKeepOut(s.x, s.z), `單位 ${s.x},${s.z}`).toBe(true)
    for (const t of TRENCHES) for (const p of t.points) expect(battleKeepOut(p.x, p.z), `壕溝 ${p.x},${p.z}`).toBe(true)
    for (const r of [PANZER_ROUTE_A, PANZER_ROUTE_B, T34_RESERVE_WEST, T34_RESERVE_EAST]) {
      for (const p of r) expect(battleKeepOut(p.x, p.z), `路線 ${p.x},${p.z}`).toBe(true)
    }
    expect(battleKeepOut(VILLAGE.x, VILLAGE.z)).toBe(false)
    const south = at(0, VILLAGE_BOX.south + 100)
    expect(battleKeepOut(south.x, south.z)).toBe(true)
    expect(battleKeepOut(VILLAGE.x + 9000, VILLAGE.z)).toBe(false)
  })

  it('戰場所在的村是農地框架裡的那個村，而且燒得比別的村多', () => {
    expect(farmLaneVillages(8000).some((x) => x.place.name === VILLAGE_NAME)).toBe(true)
    expect(burnRateOf(VILLAGE_NAME)).toBeGreaterThan(burnRateOf('v0,0') * 3)
  })

  it('德軍縱隊沿路從南邊推來：集結位置在村南邊（局部縱深為正）', () => {
    for (const route of [PANZER_ROUTE_A, PANZER_ROUTE_B]) {
      expect(toLocal(route[0]!.x, route[0]!.z).lz).toBeGreaterThan(300)
    }
  })
})
