import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { BufferAttribute, Mesh } from 'three'
import { createLeuna, FLAK_SITES } from '../../src/world/leuna'
import { outsideZero } from '../../src/world/farmland'
import { CHANNEL_HALF, RiverIndex } from '../../src/world/river'
import { DECK_CLEARANCE, insideRing, type FeatureFile } from '../../src/world/landFeatures'
import { buildLeunaRivers, preloadLeunaRivers } from '../../src/render/leunaRiver'
import { buildLeunaDressing, preloadLeunaFeatures, type LandDressing } from '../../src/render/leunaFeatures'
import { motorwayProfiles } from '../../src/render/motorway'
import { DECAL_LIFT } from '../../src/render/groundDecal'
import { excludingCorridor, riverBankFlora, type RiverSet } from '../../src/render/river'
import { excludingWhere } from '../../src/render/floraExclude'
import {
  createFloraBuffer, farmHedgeFlora, farmWoodFlora, FLORA_STRIDE, FloraKind,
} from '../../src/render/flora'
import { FLORA_RADIUS, MAX_PER_TILE, TILE_SIZE } from '../../src/render/vegetation'

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
/** ±22 km 內全部的建築 */
const B: { x: number; z: number; kind: number }[] = []

beforeAll(async () => {
  await preloadLeunaRivers(read)
  await preloadLeunaFeatures(read)
  rivers = buildLeunaRivers(sample)
  dressing = buildLeunaDressing(sample, rivers)
  const buf = createFloraBuffer(400_000)
  dressing.buildings(-22000, -22000, 22000, 22000, sample, buf)
  for (let i = 0; i < buf.count; i++) {
    B.push({ x: buf.data[i * FLORA_STRIDE]!, z: buf.data[i * FLORA_STRIDE + 2]!, kind: buf.kind[i]! })
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
    for (const b of B) {
      const tag = `(${Math.round(b.x)},${Math.round(b.z)})`
      expect(rivers.index.distance(b.x, b.z), `河 ${tag}`).toBeGreaterThanOrEqual(CHANNEL_HALF + 15)
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
  it('石板瓦約一成、鎮中心比外圍多', () => {
    const houses = B.filter((b) => b.kind === FloraKind.House || b.kind === FloraKind.SlateHouse)
    const slate = houses.filter((b) => b.kind === FloraKind.SlateHouse).length / houses.length
    expect(slate).toBeGreaterThan(0.08)
    expect(slate).toBeLessThan(0.2)
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
  it('村鎮地面、礦坑、A9 路面的每一個三角形都朝上', () => {
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
    // 村鎮地面、礦坑、A9 路面各一顆
    expect(checked).toBe(3)
  })
})
