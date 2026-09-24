import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { BufferAttribute, Mesh } from 'three'
import { createLeuna, FLAK_SITES } from '../../src/world/leuna'
import { outsideZero } from '../../src/world/farmland'
import { CHANNEL_HALF, RiverIndex } from '../../src/world/river'
import {
  DECK_CLEARANCE, insideRing, insideSettlement, outlineScale, settlementRadius, type FeatureFile,
} from '../../src/world/landFeatures'
import { buildLeunaRivers, preloadLeunaRivers } from '../../src/render/leunaRiver'
import {
  buildLeunaDressing, preloadLeunaFeatures, rightOfSaale, type LandDressing,
} from '../../src/render/leunaFeatures'
import { motorwayProfiles } from '../../src/render/motorway'
import { settlementLayout, settlementTest } from '../../src/render/settlements'
import { BUILDING_DEPTH, BUILDING_WALL, BUILDING_WIDTH } from '../../src/render/floraShapes'
import { DECAL_LIFT } from '../../src/render/groundDecal'
import { excludingCorridor, riverBankFlora, type RiverSet } from '../../src/render/river'
import { excluding, excludingWhere } from '../../src/render/floraExclude'
import {
  createFloraBuffer, farmHedgeFlora, farmWoodFlora, FLORA_STRIDE, FloraKind, SHAPE_ONE, type FloraSource,
} from '../../src/render/flora'
import {
  createVegetation, FLORA_RADIUS, MAX_PER_TILE, TILE_SIZE,
} from '../../src/render/vegetation'
import { LEUNA_SITE } from '../../src/render/terrain'

/**
 * # 洛伊納的真實地物：村鎮、A9、蓋澤爾谷
 *
 * 資料是 OSM 抓下來的（`tools/dem/fetch-leuna-features.mjs`）。這裡守的是
 * 「放到遊戲裡之後不出事」：房子不蓋在河裡、路上、砲位上、礦坑裡；植被池
 * 裝得下；橋真的墊高了。
 */

const read = <T>(url: string): Promise<T> => Promise.resolve(JSON.parse(readFileSync('public' + url, 'utf8')) as T)
const F = JSON.parse(readFileSync('public/data/leuna-features.json', 'utf8')) as FeatureFile
const solid = outsideZero(createLeuna().field)
const sample = (x: number, z: number): number => solid.sample(x, z)

let rivers: RiverSet
let dressing: LandDressing
/** ±22 km 內全部的建築與樹 */
const B: { x: number; z: number; kind: number }[] = []
/** 同上，含旋轉、縮放（`FLORA_STRIDE` 的第 3、4 格）與面寬、樓高倍率 */
const Bfull: { x: number; z: number; rot: number; scale: number; kind: number; wide: number; tall: number }[] = []
/** 四種建築：同一個形狀，只差牆與屋頂的顏色 */
const BUILDINGS = new Set<number>([FloraKind.House, FloraKind.SlateHouse, FloraKind.Barn, FloraKind.TarBarn])

beforeAll(async () => {
  await preloadLeunaRivers(read)
  await preloadLeunaFeatures(read)
  rivers = buildLeunaRivers(sample)
  dressing = buildLeunaDressing(sample, rivers)
  const buf = createFloraBuffer(400_000)
  dressing.buildings(-22000, -22000, 22000, 22000, sample, buf)
  for (let i = 0; i < buf.count; i++) {
    const o = i * FLORA_STRIDE
    B.push({ x: buf.data[o]!, z: buf.data[o + 2]!, kind: buf.kind[i]! })
    Bfull.push({
      x: buf.data[o]!, z: buf.data[o + 2]!, rot: buf.data[o + 3]!, scale: buf.data[o + 4]!, kind: buf.kind[i]!,
      wide: buf.shape[i * 2]! / SHAPE_ONE, tall: buf.shape[i * 2 + 1]! / SHAPE_ONE,
    })
  }
})

describe('資料', () => {
  it('A9 上下行各一條，縱貫整張地圖', () => {
    expect(F.a9).toHaveLength(2)
    for (const l of F.a9) {
      const zs = l.map((p) => p[1])
      expect(Math.min(...zs)).toBeLessThan(-15000)
      expect(Math.max(...zs)).toBeGreaterThan(15000)
    }
  })

  /**
   * 【錨點與河道一致】兩支抓取工具的經緯度錨點不一樣的話，村子會相對河與
   * 廠區整片平移 —— 梅澤堡要在薩勒河邊、廠區北方五公里。
   */
  it('幾個鎮落在該在的地方', () => {
    const at = (name: string): { x: number; z: number } => F.places.find((p) => p.name === name)!
    const near = (p: { x: number; z: number }, x: number, z: number): number => Math.hypot(p.x - x, p.z - z)
    expect(near(at('Merseburg'), -600, -12300)).toBeLessThan(500)
    expect(near(at('Leuna'), 1350, -8650)).toBeLessThan(500)
    expect(near(at('Bad Dürrenberg'), 4300, -6050)).toBeLessThan(500)
    // 索引只答得出 190 m 以內，這裡直接掃中心線的點
    const m = at('Merseburg')
    const toSaale = Math.min(...rivers.lines.filter((l) => l.name === 'Saale')
      .flatMap((l) => l.points.map((p) => Math.hypot(p[0] - m.x, p[1] - m.z))))
    expect(toSaale).toBeLessThan(800)
  })

  it('蓋澤爾谷四個礦坑，沒有聚落落在坑裡', () => {
    expect(F.mines.map((m) => m.name).sort()).toEqual(
      ['Geiseltalsee', 'Großkaynaer See', 'Hassesee', 'Runstedter See'])
    for (const m of F.mines) {
      for (const p of F.places) expect(insideRing(m.ring, p.x, p.z), `${p.name} 在 ${m.name}`).toBe(false)
    }
  })
})

describe('建築', () => {
  it('真的有：梅澤堡一帶幾千棟，全圖十萬棟上下，鎮都有教堂', () => {
    expect(B.filter((b) => Math.hypot(b.x + 600, b.z + 12337) < 900).length).toBeGreaterThan(2000)
    expect(B.length).toBeGreaterThan(50_000)
    for (const p of F.places.filter((q) => q.kind === 'town' && Math.abs(q.x) < 15000 && Math.abs(q.z) < 15000)) {
      const church = B.some((b) => b.kind === FloraKind.Church && Math.hypot(b.x - p.x, b.z - p.z) < 1)
      // 【鎮心剛好在河上的例外】那座教堂被河道擋掉，這是對的
      if (rivers.index.distance(p.x, p.z) < CHANNEL_HALF + 15) continue
      expect(church, p.name).toBe(true)
    }
  })

  /** 【不蓋在河裡、路上、砲位上、坑裡】四樣都不報錯，只是畫面上一棟房子泡在水裡 */
  it('避開河道、A9、砲位與礦坑', () => {
    const road = new RiverIndex(F.a9.map((l) => ({ name: 'A9', points: l, level: l.map(() => 0), coarse: true })), 30)
    // 植被緩衝存的是單精度，座標存進去會捨入幾毫米
    const EPS = 0.01
    for (const b of B) {
      const tag = `(${Math.round(b.x)},${Math.round(b.z)})`
      expect(rivers.index.distance(b.x, b.z), `河 ${tag}`).toBeGreaterThanOrEqual(CHANNEL_HALF + 15 - EPS)
      expect(road.distance(b.x, b.z), `A9 ${tag}`).toBeGreaterThanOrEqual(20)
      for (const m of F.mines) expect(insideRing(m.ring, b.x, b.z), `${m.name} ${tag}`).toBe(false)
    }
    for (const s of FLAK_SITES) {
      expect(B.some((b) => Math.hypot(b.x - s.x, b.z - s.z) < 70), `砲位 (${Math.round(s.x)},${Math.round(s.z)})`)
        .toBe(false)
    }
  })

  /**
   * 【植被池裝得下】鏡頭每隔 1 km 掃過整張圖，植被圈內的建築數要在容量的
   * 三分之二以內。溢位時丟掉並記一次告警，症狀是半個鎮沒有房子。
   */
  it('植被圈內的建築數留著餘裕', () => {
    const cap = dressing.capacity
    const pools = [
      [FloraKind.House, 'house'], [FloraKind.SlateHouse, 'houseSlate'],
      [FloraKind.Barn, 'barn'], [FloraKind.TarBarn, 'barnTar'], [FloraKind.Church, 'church'],
    ] as const
    const peak = new Map<number, number>()
    for (let cx = -15000; cx <= 15000; cx += 1000) {
      for (let cz = -15000; cz <= 15000; cz += 1000) {
        const n = new Map<number, number>()
        for (const b of B) {
          if (Math.abs(b.x - cx) > FLORA_RADIUS || Math.abs(b.z - cz) > FLORA_RADIUS) continue
          if (Math.hypot(b.x - cx, b.z - cz) >= FLORA_RADIUS) continue
          n.set(b.kind, (n.get(b.kind) ?? 0) + 1)
        }
        for (const [k, v] of n) peak.set(k, Math.max(peak.get(k) ?? 0, v))
      }
    }
    for (const [kind, pool] of pools) {
      expect(peak.get(kind) ?? 0, pool).toBeGreaterThan(0)
      expect((peak.get(kind) ?? 0) * 1.5, pool).toBeLessThanOrEqual(cap[pool]!)
    }
  })

  /**
   * 【屋頂的比例】德國中部 1944 年七八成是黏土瓦，石板瓦一到兩成、集中在鎮中心。
   * 全是紅的話整個鎮是一片亮紅；石板太多的話像北德或英國。
   */
  it('石板瓦鎮中心比外圍多', () => {
    const houses = B.filter((b) => BUILDINGS.has(b.kind))
    const m = F.places.find((p) => p.name === 'Merseburg')!
    const share = (r0: number, r1: number): number => {
      const ring = houses.filter((b) => {
        const d = Math.hypot(b.x - m.x, b.z - m.z)
        return d >= r0 && d < r1
      })
      return ring.filter((b) => b.kind === FloraKind.SlateHouse).length / ring.length
    }
    expect(share(0, 250)).toBeGreaterThan(share(500, 800))
  })

  /**
   * 【一格裝得下】建築加上格子裡剩下的樹籬、樹林與河岸林，不得超過
   * `MAX_PER_TILE` —— 超過的株被丟掉，而且丟的是哪幾株取決於散佈器的次序。
   * 量的是每個鎮周圍 1 km 的格子，與整張圖量到最密的那一格。
   */
  it('鎮上與最密的那一格不超過單格上限', () => {
    const srcs = [farmHedgeFlora, farmWoodFlora]
      .map((f) => excludingWhere(excludingCorridor(f, rivers.index), dressing.keepOut))
    srcs.push(excludingWhere(riverBankFlora(rivers.lines, 23000), dressing.keepOut), dressing.buildings)
    const buf = createFloraBuffer(4096)
    const centers = [
      ...F.places.filter((p) => p.kind === 'town' && Math.abs(p.x) < 15000 && Math.abs(p.z) < 15000),
      { x: 8500, z: -1750 },
    ]
    let worst = 0
    for (const c of centers) {
      const i0 = Math.floor((c.x - 1000) / TILE_SIZE)
      const j0 = Math.floor((c.z - 1000) / TILE_SIZE)
      for (let i = i0; i <= i0 + 8; i++) {
        for (let j = j0; j <= j0 + 8; j++) {
          buf.count = 0
          buf.dropped = 0
          for (const s of srcs) s(i * TILE_SIZE, j * TILE_SIZE, (i + 1) * TILE_SIZE, (j + 1) * TILE_SIZE, sample, buf)
          worst = Math.max(worst, buf.count)
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(MAX_PER_TILE)
    expect(worst).toBeGreaterThan(150)
  })
})

describe('植被池不溢位', () => {
  /**
   * 【用正式的來源與容量實跑植被引擎】鏡頭放在最密的幾處：審查量到針葉近級
   * 溢位 37 棵的那一點，與逐 tile 估計的闊葉、針葉近級最多的兩點。溢位時丟掉
   * 並記一次告警，症狀是近處的樹整片消失。
   */
  it('最密的三處都不溢位', () => {
    const site = LEUNA_SITE
    const clear = site.treeClear ?? 0
    const padClear = (s: FloraSource): FloraSource => excluding(s, {
      x0: site.pad.x0 - clear, x1: site.pad.x1 + clear, z0: site.pad.z0 - clear, z1: site.pad.z1 + clear,
      pivot: site.pivot!, heading: site.heading!,
    })
    let fields: FloraSource[] = [farmHedgeFlora, farmWoodFlora].map(padClear)
      .map((f) => excludingCorridor(f, rivers.index))
    fields.push(riverBankFlora(rivers.lines, 23000))
    fields = fields.map((f) => excludingWhere(f, dressing.keepOut))
    fields.push(padClear(dressing.buildings))
    const v = createVegetation(fields, sample, { capacity: dressing.capacity })
    for (const [x, z] of [[-8750, -10000], [-10250, -12250], [-9000, -10250]] as const) {
      v.update(x, z)
      v.settle()
      expect(v.stats.overflow, `(${x},${z})`).toBe(0)
    }
    v.dispose()
  }, 120_000)
})

describe('樹籬擋在外面的地方', () => {
  it('鎮上、坑裡、A9 上擋；空曠的田不擋', () => {
    expect(dressing.keepOut(-600, -12337)).toBe(true)
    const geisel = F.mines.find((m) => m.name === 'Geiseltalsee')!
    let inside: [number, number] | null = null
    for (let x = -13000; x < -6000 && inside === null; x += 200) {
      for (let z = -10000; z < -5600 && inside === null; z += 200) {
        if (insideRing(geisel.ring, x, z)) inside = [x, z]
      }
    }
    expect(dressing.keepOut(inside![0], inside![1])).toBe(true)
    const a9 = F.a9[0]![10]!
    expect(dressing.keepOut(a9[0], a9[1])).toBe(true)
    expect(dressing.keepOut(0, -7000)).toBe(false)
  })
})

describe('A9 的橋', () => {
  /** 【過河要墊高】路面貼著地面過河就是淹在水裡的路 */
  it('跨 Luppe 的地方橋面比水面高 DECK_CLEARANCE', () => {
    const profiles = motorwayProfiles(F.a9, sample, rivers.index)
    for (const p of profiles) {
      let spans = 0
      for (let i = 0; i < p.points.length; i++) {
        if (!p.overWater[i]) continue
        spans++
        const [x, z] = p.points[i]!
        const level = rivers.index.levelNear(x, z)
        expect(p.height[i]! - level).toBeGreaterThanOrEqual(DECK_CLEARANCE)
      }
      expect(spans, '上下行都要跨過 Luppe').toBeGreaterThan(3)
    }
  })
})

describe('史實的村形', () => {
  /**
   * 【以薩勒河分岸】西岸是很早就有人定居的黃土地（團狀村），東岸是中世紀東向
   * 殖民的地區（綠地村、街村）。分錯岸的話整張圖的村形反過來，而且不報錯。
   */
  it('梅澤堡、洛伊納、布勞恩斯貝德拉在西岸；巴特迪倫貝格、克賴保、瓦倫多夫在東岸', () => {
    const east = rightOfSaale(rivers)
    const at = (n: string): { x: number; z: number } => F.places.find((p) => p.name === n)!
    for (const n of ['Merseburg', 'Leuna', 'Braunsbedra']) expect(east(at(n).x, at(n).z), n).toBe(false)
    for (const n of ['Bad Dürrenberg', 'Kreypau', 'Wallendorf (Luppe)']) expect(east(at(n).x, at(n).z), n).toBe(true)
  })

  /**
   * 【大小與樓高真的有變化】建築只有一種形狀，一模一樣大的話整個鎮是複製貼上。
   * 鎮上的牆要比村裡高（老城是兩三層半的街屋），村裡的面寬分布要寬（穀倉長、
   * 主屋短）。牆高 = `BUILDING_WALL × scale × tall`。
   */
  it('建築的面寬與樓高有變化，鎮比村高', () => {
    const inTown = settlementTest(F.places.filter((p) => p.kind === 'town'))
    const town: number[] = []
    const village: number[] = []
    const villageWide: number[] = []
    for (const b of Bfull) {
      if (!BUILDINGS.has(b.kind)) continue
      const wall = BUILDING_WALL * b.scale * b.tall
      if (inTown(b.x, b.z)) town.push(wall)
      else {
        village.push(wall)
        villageWide.push(b.wide * b.scale)
      }
    }
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
    expect(village.length).toBeGreaterThan(5000)
    expect(mean(town)).toBeGreaterThan(mean(village) + 1.5)
    expect(Math.max(...villageWide) / Math.min(...villageWide)).toBeGreaterThan(2)
  })

  /**
   * 【老城緊、外緣鬆】老城是深的連棟市民屋加後屋，外緣是別墅、花園與空地。
   * 中心只有沿街一排的話建蔽率三成出頭，從中心到外緣看起來一樣密。
   * 量的是梅澤堡：輪廓內 4 成對最外 3 成。
   */
  it('梅澤堡老城的建蔽率四成以上，是外緣的兩倍多', () => {
    const m = F.places.find((p) => p.name === 'Merseburg')!
    const R = settlementRadius(m)
    const rad = (x: number, z: number): number =>
      Math.hypot(x - m.x, z - m.z) / (R * outlineScale(m, Math.atan2(z - m.z, x - m.x)))
    const ring = (r0: number, r1: number): number => {
      let area = 0
      for (let x = m.x - R * 1.3; x < m.x + R * 1.3; x += 10) {
        for (let z = m.z - R * 1.3; z < m.z + R * 1.3; z += 10) {
          const r = rad(x, z)
          if (r >= r0 && r < r1 && insideSettlement(m, x, z)) area += 100
        }
      }
      let foot = 0
      for (const b of Bfull) {
        if (!BUILDINGS.has(b.kind)) continue
        const r = rad(b.x, b.z)
        if (r < r0 || r >= r1 || !insideSettlement(m, b.x, b.z)) continue
        foot += BUILDING_WIDTH * b.scale * b.wide * BUILDING_DEPTH * b.scale
      }
      return foot / area
    }
    const core = ring(0, 0.4)
    expect(core).toBeGreaterThan(0.4)
    expect(core).toBeGreaterThan(2 * ring(0.7, 1))
  })

  /**
   * 【鎮不是一整片屋頂】公園、墓園、小菜園、工廠大院把鎮切成一塊一塊。
   * 小菜園認棚子（牆高 3 m 以下）、大院認長條（面寬 30 m 以上）。
   */
  it('鎮上有公園、墓園、小菜園、工廠大院', () => {
    const inTown = settlementTest(F.places.filter((p) => p.kind === 'town'))
    const { greens } = settlementLayout(F.places, () => false, () => false)
    expect(greens.filter((g) => inTown(g.x, g.z)).length).toBeGreaterThan(20)
    let sheds = 0
    let halls = 0
    for (const b of Bfull) {
      if (!BUILDINGS.has(b.kind) || !inTown(b.x, b.z)) continue
      if (BUILDING_WALL * b.scale * b.tall < 3) sheds++
      if (BUILDING_WIDTH * b.scale * b.wide >= 30) halls++
    }
    expect(sheds).toBeGreaterThan(200)
    expect(halls).toBeGreaterThan(20)
  })

  /**
   * 【街上沒有房子】老城與外圍兩套格網夾一個角度，外圍的街會從老城的房子底下
   * 穿過去、老城的街上會站著外圍的房子。量的是每一個街心點落不落在某一棟的牆
   * 外框裡。
   */
  it('鎮上有街，街心上沒有房子', () => {
    const streets = dressing.farBaked.find((m) => m.name === 'streets')!
    const pos = streets.geometry.getAttribute('position') as BufferAttribute
    const CELL = 64
    const grid = new Map<string, typeof Bfull>()
    for (const b of Bfull) {
      if (!BUILDINGS.has(b.kind)) continue
      const k = `${Math.floor(b.x / CELL)},${Math.floor(b.z / CELL)}`
      grid.set(k, [...(grid.get(k) ?? []), b])
    }
    let hits = 0
    let at = ''
    // 頂點兩兩一對（左、右），中點是街心
    for (let i = 0; i < pos.count; i += 2) {
      const x = (pos.getX(i) + pos.getX(i + 1)) / 2
      const z = (pos.getZ(i) + pos.getZ(i + 1)) / 2
      const gi = Math.floor(x / CELL)
      const gj = Math.floor(z / CELL)
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          for (const b of grid.get(`${gi + di},${gj + dj}`) ?? []) {
            const ax = Math.cos(b.rot)
            const az = -Math.sin(b.rot)
            const u = (x - b.x) * ax + (z - b.z) * az
            const v = -(x - b.x) * az + (z - b.z) * ax
            if (Math.abs(u) < (BUILDING_WIDTH / 2) * b.scale * b.wide && Math.abs(v) < (BUILDING_DEPTH / 2) * b.scale) {
              hits++
              at = `(${Math.round(x)},${Math.round(z)})`
            }
          }
        }
      }
    }
    expect(pos.count / 2).toBeGreaterThan(10_000)
    expect(hits, at).toBe(0)
  })

  /**
   * 【鎮的大小跟著人口】一棟住不到五個人的話，小鎮大得不像話（半徑下限夾在
   * 300 m 時，1,368 人的 Osterfeld 有 540 棟）。
   */
  it('每個鎮一棟至少住五個人', () => {
    for (const p of F.places.filter((q) => q.kind === 'town' && q.pop !== undefined)) {
      let n = 0
      for (const b of B) if (BUILDINGS.has(b.kind) && insideSettlement(p, b.x, b.z)) n++
      if (n === 0) continue
      expect(p.pop! / n, p.name).toBeGreaterThan(5)
    }
  })

  /**
   * 【屋頂的料】新舊黏土瓦七成以上、石板一到兩成、油毛氈一成以內 —— 德國中部
   * 1944 年的比例。料與用途無關（主屋、穀倉都可能是任何一種）。小菜園的棚子
   * （牆高 3 m 以下）不算房子。
   */
  it('屋頂的料：瓦七成以上、石板一到兩成、油毛氈一成以內', () => {
    const n = { tile: 0, slate: 0, tar: 0 }
    for (const b of Bfull) {
      if (BUILDING_WALL * b.scale * b.tall < 3) continue
      if (b.kind === FloraKind.House || b.kind === FloraKind.Barn) n.tile++
      else if (b.kind === FloraKind.SlateHouse) n.slate++
      else if (b.kind === FloraKind.TarBarn) n.tar++
    }
    const all = n.tile + n.slate + n.tar
    expect(n.tile / all).toBeGreaterThan(0.7)
    expect(n.slate / all).toBeGreaterThan(0.08)
    expect(n.slate / all).toBeLessThan(0.2)
    expect(n.tar / all).toBeLessThan(0.1)
  })

  /**
   * 【建築不穿插】量的是牆的外框（有向矩形，分離軸），不是佔位圓 —— 圓在長條的
   * 穀倉上太寬鬆，同一座農莊的側屋與後面的穀倉穿插過 3.4 m。
   *
   * 村：任兩棟都不相交。鎮：連棟街屋一棟貼一棟、正面共用端點，彎街內側相鄰的
   * 兩棟背面會咬到一點（同向、0.3 m 以內）；正面照彎之前的面寬排的話咬到 1 m，
   * 兩棟的正面幾乎共平面，拉遠會閃。**斜交的一律不得相交** —— 老城與外圍兩套
   * 格線夾一個角度，交界那一圈會斜插進彼此。
   */
  it('任兩棟建築的牆不相交（鎮上同向的連棟街屋咬 0.3 m 以內）', () => {
    const inTown = settlementTest(F.places.filter((p) => p.kind === 'town'))
    const rects: { x: number; z: number; ax: number; az: number; hw: number; hd: number; town: boolean }[] = []
    for (const b of Bfull) {
      if (!BUILDINGS.has(b.kind)) continue
      // 模型的 x 軸轉到 (cos θ, −sin θ)（`vegetation.ts` 寫矩陣的方式）；
      // 面寬 = 基準 × 縮放 × 面寬倍率、進深 = 基準 × 縮放
      rects.push({
        x: b.x, z: b.z, ax: Math.cos(b.rot), az: -Math.sin(b.rot),
        hw: (BUILDING_WIDTH / 2) * b.scale * b.wide,
        hd: (BUILDING_DEPTH / 2) * b.scale,
        town: inTown(b.x, b.z),
      })
    }
    const project = (r: typeof rects[number], nx: number, nz: number): number =>
      r.hw * Math.abs(r.ax * nx + r.az * nz) + r.hd * Math.abs(-r.az * nx + r.ax * nz)
    // 【分桶要比兩棟的中心距上限大】只比相鄰桶，所以桶寬要蓋住「兩棟外接半徑
    // 相加」—— 大院的長條建築半長 25 m，桶太小會漏掉整對
    const CELL = 64
    const grid = new Map<string, number[]>()
    rects.forEach((r, i) => {
      const k = `${Math.floor(r.x / CELL)},${Math.floor(r.z / CELL)}`
      grid.set(k, [...(grid.get(k) ?? []), i])
    })
    // 村、鎮上斜交、鎮上同向，各自最深的一對
    const worst = { village: 0, skew: 0, aligned: 0 }
    const at = { village: '', skew: '', aligned: '' }
    rects.forEach((a, i) => {
      const gi = Math.floor(a.x / CELL)
      const gj = Math.floor(a.z / CELL)
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          for (const j of grid.get(`${gi + di},${gj + dj}`) ?? []) {
            if (j <= i) continue
            const b = rects[j]!
            let depth = Infinity
            for (const [nx, nz] of [[a.ax, a.az], [-a.az, a.ax], [b.ax, b.az], [-b.az, b.ax]] as const) {
              const d = Math.abs((b.x - a.x) * nx + (b.z - a.z) * nz)
              depth = Math.min(depth, project(a, nx, nz) + project(b, nx, nz) - d)
            }
            const k = !a.town && !b.town ? 'village'
              : Math.abs(a.ax * b.ax + a.az * b.az) > Math.cos(0.17) ? 'aligned' : 'skew'
            if (depth > worst[k]) { worst[k] = depth; at[k] = `(${Math.round(a.x)},${Math.round(a.z)})` }
          }
        }
      }
    })
    expect(rects.filter((r) => !r.town).length).toBeGreaterThan(10_000)
    expect(rects.filter((r) => r.town).length).toBeGreaterThan(10_000)
    expect(worst.village, at.village).toBeLessThan(0.05)
    expect(worst.skew, at.skew).toBeLessThan(0.05)
    expect(worst.aligned, at.aligned).toBeLessThan(0.3)
  })

  /** 【院子後面與村外有樹】果園、花園、教堂墓園 */
  it('村鎮有樹與灌木', () => {
    expect(B.filter((b) => b.kind === FloraKind.BroadTree).length).toBeGreaterThan(20_000)
    expect(B.filter((b) => b.kind === FloraKind.Bush).length).toBeGreaterThan(2_000)
  })

  /** 【村不鋪地面】農莊只沿巷排，鋪滿輪廓的話是一大片沒有田紋的平地 */
  it('只有鎮有地面', () => {
    const src = readFileSync('src/render/settlements.ts', 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain(".filter((p) => p.kind === 'town')")
  })
})

describe('教堂', () => {
  /** 【教堂周圍留空地】不留的話梅澤堡的大教堂與隔壁的房子穿插 7 m */
  it('教堂 23 m 內沒有別的建築（縮放 1 的教堂加一棟最大的房子）', () => {
    const churches = B.filter((b) => b.kind === FloraKind.Church)
    expect(churches.length).toBeGreaterThan(100)
    for (const c of churches) {
      for (const b of B) {
        if (b.kind === FloraKind.Church) continue
        if (Math.abs(b.x - c.x) > 23 || Math.abs(b.z - c.z) > 23) continue
        expect(Math.hypot(b.x - c.x, b.z - c.z), `(${Math.round(c.x)},${Math.round(c.z)})`).toBeGreaterThanOrEqual(23)
      }
    }
  })
})

describe('逐株查詢不配置', () => {
  /** 【空桶不得 `?? []`】keepOut 在植被補格時每一株都問，每問一次配一個陣列 */
  it('聚落的分桶查詢用共用的空陣列', () => {
    const src = readFileSync('src/render/settlements.ts', 'utf8')
    // 只抓程式碼（後面接右括號），不抓註解裡提到的寫法
    expect(src).not.toMatch(/\?\? \[\]\s*\)/)
  })
})

describe('地表網格', () => {
  /**
   * 【與地形共平面】每一個小三角形都要完全落在某一個地形三角形上 —— 三角形
   * 跨過地形的折線的話，中間沉到地面下（實測最多 1.4 m），低空看得到底下的田。
   * 量的是每一個三角形的重心與四分點：減掉抬高量之後要等於那裡的地形高度。
   */
  it('村鎮地面與礦坑的每一點都貼著地形', () => {
    let worst = 0
    let checked = 0
    dressing.object.traverse((o) => {
      const m = o as Mesh
      if (m.name !== 'settlementGround' && m.name !== 'mines') return
      const pos = m.geometry.getAttribute('position') as BufferAttribute
      const idx = m.geometry.getIndex()!
      for (let t = 0; t < idx.count; t += 3) {
        const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
        for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.25, 0.25], [0.25, 0.5, 0.25], [0.25, 0.25, 0.5]]) {
          let x = 0, y = 0, z = 0
          for (let k = 0; k < 3; k++) {
            x += pos.getX(v[k]!) * w[k]!
            y += pos.getY(v[k]!) * w[k]!
            z += pos.getZ(v[k]!) * w[k]!
          }
          worst = Math.max(worst, Math.abs(y - DECAL_LIFT - sample(x, z)))
          checked++
        }
      }
    })
    expect(checked).toBeGreaterThan(100_000)
    expect(worst).toBeLessThan(0.01)
  })

  /** 【捲繞方向】反了的話法線朝下、整塊被背面剔除 —— 畫面上什麼都沒有 */
  it('村鎮地面、街、礦坑、A9 路面的每一個三角形都朝上', () => {
    let checked = 0
    dressing.object.traverse((o) => {
      const m = o as Mesh
      if (m.geometry === undefined || m.name === 'motorwayStructure') return
      const pos = m.geometry.getAttribute('position') as BufferAttribute
      const idx = m.geometry.getIndex()!
      let down = 0
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t)
        const b = idx.getX(t + 1)
        const c = idx.getX(t + 2)
        const ux = pos.getX(b) - pos.getX(a)
        const uz = pos.getZ(b) - pos.getZ(a)
        const vx = pos.getX(c) - pos.getX(a)
        const vz = pos.getZ(c) - pos.getZ(a)
        if (uz * vx - ux * vz <= 0) down++
      }
      expect(down, m.name).toBe(0)
      checked++
    })
    // 村鎮地面、鎮上的街、礦坑、A9 路面各一顆
    expect(checked).toBe(4)
  })
})
