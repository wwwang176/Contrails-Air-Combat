import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { farmLaneVillages, farmSettlements } from '../../src/render/farmSettlements'
import { createFloraBuffer, FloraKind, steppeBeltFloraFor } from '../../src/render/flora'
import { buildingColors } from '../../src/render/floraShapes'
import { buildBlasts, RIDGE_CLEAR, steppeLayout } from '../../src/render/steppeVillage'
import { churchRoom } from '../../src/render/settlements'
import { steppeRavineFloraFor } from '../../src/render/steppeRavines'
import { RAVINES } from '../../src/world/rzhevRavines'
import { regionAt, steppeRidgeGap, trackGap, trackWidthAt } from '../../src/render/fields'
import { rzhevVillageKeepOut, STEPPE_CAPACITY } from '../../src/render/terrain'
import { createVegetation } from '../../src/render/vegetation'
import {
  at, battleKeepOut, burnRateOf, isLargeVillage, shelterbeltFade, VILLAGE, VILLAGE_NAME,
} from '../../src/world/rzhev'

/**
 * 草原街村：房子沿凹路兩列、屋後垂直於街的菜園、只有七月麥田這個季節才用。
 */

const HALF = 8000
const villages = farmLaneVillages(HALF).filter((v) => v.place.kind === 'village')

function placements(): { x: number; z: number; kind: number }[] {
  const { flora } = steppeLayout(farmLaneVillages(HALF), () => false)
  const buf = createFloraBuffer(200000)
  flora(-HALF, -HALF, HALF, HALF, () => 0, buf)
  expect(buf.dropped).toBe(0)
  const out = []
  for (let i = 0; i < buf.count; i++) {
    out.push({ x: buf.data[i * 6]!, z: buf.data[i * 6 + 2]!, kind: buf.kind[i]! })
  }
  return out
}

describe('草原街村', () => {
  it('每個村有站址與凹路的走向，走向是單位圓上的角度', () => {
    expect(villages.length).toBeGreaterThan(5)
    for (const v of villages) {
      expect(Number.isFinite(v.lane)).toBe(true)
      expect(Math.abs(v.lane)).toBeLessThanOrEqual(Math.PI)
    }
  })

  it('房子沿街排，長出來不少', () => {
    const houses = placements().filter((p) => p.kind === FloraKind.House)
    // 40 個村、每村兩列幾十戶
    expect(houses.length).toBeGreaterThan(300)
  })

  it('菜園都是垂直於街的長條，四個角繞成矩形', () => {
    const { gardens } = farmSettlements(HALF, 'winterSteppe')
    expect(gardens.length).toBeGreaterThan(100)
    for (const g of gardens.slice(0, 200)) {
      const [a, b, , d] = g.ring
      const w = Math.hypot(b![0] - a![0], b![1] - a![1])
      const l = Math.hypot(d![0] - a![0], d![1] - a![1])
      expect(l).toBeGreaterThan(w)
      // 相鄰兩邊垂直
      const dot = (b![0] - a![0]) * (d![0] - a![0]) + (b![1] - a![1]) * (d![1] - a![1])
      expect(Math.abs(dot) / (w * l)).toBeLessThan(1e-6)
    }
  })

  it('菜園不是一排整齊的條紋：長短、顏色、兩種作物都有變化，不是每一戶都有', () => {
    const { gardens } = farmSettlements(HALF, 'winterSteppe')
    const lens = gardens.map((g) => Math.hypot(g.ring[3]![0] - g.ring[0]![0], g.ring[3]![1] - g.ring[0]![1]))
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
    expect(sd).toBeGreaterThan(30)
    // 長的常被房子、支路與別的菜園截短，所以比例低於抽籤的 15%
    expect(lens.filter((l) => l < 85).length / lens.length).toBeGreaterThan(0.05)
    expect(lens.filter((l) => l > 170).length / lens.length).toBeGreaterThan(0.03)
    expect(new Set(gardens.map((g) => g.color)).size).toBeGreaterThan(40)
    // 兩種作物：一條的終點邊正好是另一條的起點邊
    const key = (p: readonly [number, number], q: readonly [number, number]): string =>
      `${Math.round((p[0] + q[0]) * 50)},${Math.round((p[1] + q[1]) * 50)}`
    const starts = new Set(gardens.map((g) => key(g.ring[0]!, g.ring[1]!)))
    const joined = gardens.filter((g) => starts.has(key(g.ring[2]!, g.ring[3]!))).length
    expect(joined / gardens.length).toBeGreaterThan(0.1)
    // 有的戶沒有菜園：菜園數遠少於房子數
    const houses = placements().filter((p) => p.kind === FloraKind.House || p.kind === FloraKind.SlateHouse).length
    expect(gardens.length).toBeLessThan(houses * 0.95)
  })

  it('房子不是一個模子：屋脊長、面寬、樓高各自有變化，三檔都有', () => {
    const buf = createFloraBuffer(200000)
    steppeLayout(farmLaneVillages(HALF), () => false).flora(-HALF, -HALF, HALF, HALF, () => 0, buf)
    const scales: number[] = []
    const wides = new Set<number>()
    const talls = new Set<number>()
    for (let i = 0; i < buf.count; i++) {
      if (buf.kind[i] !== FloraKind.House && buf.kind[i] !== FloraKind.SlateHouse) continue
      scales.push(buf.data[i * 6 + 4]!)
      wides.add(buf.shape[i * 2]!)
      talls.add(buf.shape[i * 2 + 1]!)
    }
    expect(scales.length).toBeGreaterThan(1000)
    const mean = scales.reduce((a, b) => a + b, 0) / scales.length
    const sd = Math.sqrt(scales.reduce((a, b) => a + (b - mean) ** 2, 0) / scales.length)
    expect(sd).toBeGreaterThan(0.1)
    expect(scales.filter((s) => s < 1.15).length / scales.length).toBeGreaterThan(0.1)
    expect(scales.filter((s) => s > 1.4).length / scales.length).toBeGreaterThan(0.05)
    expect(wides.size).toBeGreaterThan(8)
    expect(talls.size).toBeGreaterThan(8)
  })

  it('其他季節沒有菜園、建築色是德國中部那一套', () => {
    expect(farmSettlements(HALF, 'summer').gardens).toHaveLength(0)
    expect(farmSettlements(HALF, 'lateAutumn').gardens).toHaveLength(0)
    expect(buildingColors('summer')).toBe(buildingColors('lateAutumn'))
    expect(buildingColors('winterSteppe').house.wall).not.toBe(buildingColors('summer').house.wall)
    // 冬季的屋頂覆雪：比夏季的屋頂亮得多；燒毀的房子仍然是焦黑
    const lum = (hex: number): number => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l
    expect(lum(buildingColors('winterSteppe').house.roof)).toBeGreaterThan(lum(buildingColors('summer').house.roof) + 0.3)
    expect(lum(buildingColors('winterSteppe').houseSlate.roof)).toBeLessThan(0.15)
  })

  it('同一個種子兩次跑得到同一批房子', () => {
    expect(placements()).toEqual(placements())
  })
})

describe('戰場上的村', () => {
  const war = { keepOut: battleKeepOut, burnRate: burnRateOf }
  const layout = steppeLayout(farmLaneVillages(HALF), () => false, battleKeepOut, burnRateOf)
  const buf = createFloraBuffer(200000)
  // 邊緣的村，街與房子會伸到 `HALF` 之外
  layout.flora(-HALF - 3000, -HALF - 3000, HALF + 3000, HALF + 3000, () => 0, buf)
  const all: { x: number; z: number; kind: number }[] = []
  for (let i = 0; i < buf.count; i++) all.push({ x: buf.data[i * 6]!, z: buf.data[i * 6 + 2]!, kind: buf.kind[i]! })
  const near = (x: number, z: number, r: number): boolean => Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < r

  it('建築與樹的中心都不在禁區（單位周圍、壕溝、縱隊路線、村南緣以南）', () => {
    expect(buf.dropped).toBe(0)
    expect(all.filter((p) => battleKeepOut(p.x, p.z))).toHaveLength(0)
  })

  it('菜園的四個角、中心與長邊中點都不在禁區', () => {
    expect(layout.gardens.length).toBeGreaterThan(100)
    let bad = 0
    for (const g of layout.gardens) {
      const [a, b, c, d] = g.ring
      const mids: [number, number][] = [
        [(a![0] + d![0]) / 2, (a![1] + d![1]) / 2], [(b![0] + c![0]) / 2, (b![1] + c![1]) / 2],
      ]
      for (const [x, z] of [...g.ring, [g.x, g.z], ...mids] as [number, number][]) {
        if (battleKeepOut(x, z)) { bad++; break }
      }
    }
    expect(bad).toBe(0)
  })

  it('支路的每個折點都不在禁區', () => {
    let bad = 0
    for (const s of layout.streets) for (const [x, z] of s.points) if (battleKeepOut(x, z)) bad++
    expect(bad).toBe(0)
  })

  it('戰場所在的村：支路長在主街兩側，各自都有好幾條', () => {
    const tx = Math.cos(VILLAGE.lane)
    const tz = Math.sin(VILLAGE.lane)
    const sides = { left: new Set<number>(), right: new Set<number>() }
    layout.streets.forEach((s, i) => {
      if (!s.points.some(([x, z]) => near(x, z, 1500))) return
      const [x, z] = s.points[s.points.length - 1]!
      const lat = -(x - VILLAGE.x) * tz + (z - VILLAGE.z) * tx
      if (lat > 60) sides.left.add(i)
      else if (lat < -60) sides.right.add(i)
    })
    expect(sides.left.size).toBeGreaterThanOrEqual(4)
    expect(sides.right.size).toBeGreaterThanOrEqual(4)
  })

  it('燒毀的房子是焦黑的殼，每一棟底下有一片彈坑貼片', () => {
    const burned = all.filter((p) => p.kind === FloraKind.SlateHouse)
    expect(burned.length).toBeGreaterThan(50)
    expect(layout.blasts).toHaveLength(burned.length)
    // 貼片取圖集的彈坑那八格，而且比房子（約 11 m）大，坑緣才露在屋外
    for (const b of layout.blasts) {
      expect(b.cell).toBeGreaterThanOrEqual(0)
      expect(b.cell).toBeLessThan(8)
      expect(b.half).toBeGreaterThan(11)
    }
    // 每一片貼片都落在某一棟燒毀的房子旁邊
    for (const b of layout.blasts) {
      expect(burned.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 4)).toBe(true)
    }
  })

  it('戰場所在的村燒得多，其他村只有零星幾間', () => {
    const ratio = (inside: boolean): number => {
      const houses = all.filter((p) => (p.kind === FloraKind.House || p.kind === FloraKind.SlateHouse)
        && near(p.x, p.z, 1500) === inside)
      return houses.filter((p) => p.kind === FloraKind.SlateHouse).length / houses.length
    }
    expect(ratio(true)).toBeGreaterThan(0.15)
    expect(ratio(false)).toBeLessThan(0.08)
  })

  /**
   * 【用正式的來源與容量實跑植被引擎】池子溢位時超出的部分被靜靜丟掉，症狀是近處的房子
   * 整片消失。鏡頭放在戰場的南北軸與兩側：村的上空、南邊出生點一帶、北邊蘇軍後方；
   * 兩側拉到 ±4 km，防風林帶在方框之外才長滿
   */
  it('戰場的南北軸與兩側各處都不溢位', () => {
    // 地形實際用的設定：只有戰場的村是大村，田界有防風林帶
    const v = createVegetation([
      farmSettlements(20000, 'winterSteppe', { ...war, keepOut: rzhevVillageKeepOut, large: isLargeVillage }).flora,
      steppeBeltFloraFor(shelterbeltFade),
      steppeRavineFloraFor(RAVINES),
    ], () => 0, {
      season: 'winterSteppe', capacity: STEPPE_CAPACITY,
    })
    for (const lx of [-4000, -2000, 0, 2000, 4000]) {
      for (const lz of [-2500, -1000, 0, 1000, 2500, 4000, 5500]) {
        const c = at(lx, lz)
        v.update(c.x, c.z)
        v.settle()
        expect(v.stats.overflow, `(${lx},${lz})`).toBe(0)
      }
    }
    v.dispose()
  }, 120_000)

  it('彈坑貼片的網格：每片四個頂點，uv 縮在圖集那一格裡面', () => {
    const geo = buildBlasts(() => 0, layout.blasts)
    expect(geo.getAttribute('position').count).toBe(layout.blasts.length * 4)
    const uv = geo.getAttribute('uv')
    layout.blasts.forEach((b, i) => {
      const u0 = (b.cell % 4) / 4
      const v0 = 1 - (Math.floor(b.cell / 4) + 1) / 4
      for (let k = 0; k < 4; k++) {
        const u = uv.getX(i * 4 + k)
        const v = uv.getY(i * 4 + k)
        expect(u).toBeGreaterThan(u0)
        expect(u).toBeLessThan(u0 + 0.25)
        expect(v).toBeGreaterThan(v0)
        expect(v).toBeLessThan(v0 + 0.25)
      }
    })
    geo.dispose()
  })

  it('任何禁區函式都被每一種東西遵守：村正中間挖一個圓，房子、樹、棚子、菜園、支路都不進去', () => {
    const cx = VILLAGE.x + Math.cos(VILLAGE.lane) * 100
    const cz = VILLAGE.z + Math.sin(VILLAGE.lane) * 100
    const hole = (x: number, z: number): boolean => Math.hypot(x - cx, z - cz) < 260
    const holed = steppeLayout(farmLaneVillages(HALF), () => false, hole, burnRateOf)
    const b = createFloraBuffer(200000)
    holed.flora(-HALF - 3000, -HALF - 3000, HALF + 3000, HALF + 3000, () => 0, b)
    // 對照：沒有圓的時候圓裡確實有東西，否則下面的斷言空過
    let before = 0
    for (const p of all) if (hole(p.x, p.z)) before++
    expect(before).toBeGreaterThan(20)
    const inside: number[] = []
    for (let i = 0; i < b.count; i++) if (hole(b.data[i * 6]!, b.data[i * 6 + 2]!)) inside.push(b.kind[i]!)
    expect(inside).toEqual([])
    for (const g of holed.gardens) for (const [x, z] of [...g.ring, [g.x, g.z]] as [number, number][]) expect(hole(x, z)).toBe(false)
    for (const s of holed.streets) for (const [x, z] of s.points) expect(hole(x, z)).toBe(false)
  })

  it('禁區是一格一格的小圓：菜園的每個查點與最後的尾段都不進去', () => {
    const near20 = (x: number, z: number): boolean => {
      const gx = Math.round(x / 70) * 70
      const gz = Math.round(z / 70) * 70
      return Math.hypot(x - gx, z - gz) < 20
    }
    const deep16 = (x: number, z: number): boolean => {
      const gx = Math.round(x / 70) * 70
      const gz = Math.round(z / 70) * 70
      return Math.hypot(x - gx, z - gz) < 16
    }
    const dotted = steppeLayout(farmLaneVillages(HALF), () => false, near20, burnRateOf)
    expect(dotted.gardens.length).toBeGreaterThan(20)
    let bad = 0
    for (const g of dotted.gardens) {
      const [a, b, c, d] = g.ring
      // 沿兩條長邊與中線每 4 m 查一次，比生成器的 8 m 密
      const len = Math.hypot(d![0] - a![0], d![1] - a![1])
      for (let t = 0; t <= len; t += 4) {
        const f = t / len
        const pts: [number, number][] = [
          [a![0] + (d![0] - a![0]) * f, a![1] + (d![1] - a![1]) * f],
          [b![0] + (c![0] - b![0]) * f, b![1] + (c![1] - b![1]) * f],
        ]
        if (pts.some(([x, z]) => deep16(x, z))) { bad++; break }
      }
    }
    // 【只算進得夠深的】邊線剛好擦過圓緣時弦不到 8 m，會落在生成器兩次查點之間。進圓緣 4 m
    // 以上（離圓心不到 16 m）的弦至少 24 m，生成器 8 m 一查的漏不掉
    expect(bad).toBe(0)
  })

  /** 兩種作物的菜園是接在一起的兩條：只留每一戶最後的那一條（終點才是被查過的那一點） */
  const terminalStrips = <T extends { ring: readonly (readonly [number, number])[] }>(gardens: readonly T[]): T[] => {
    const key = (p: readonly [number, number], q: readonly [number, number]): string =>
      `${Math.round((p[0] + q[0]) * 50)},${Math.round((p[1] + q[1]) * 50)}`
    const starts = new Set(gardens.map((g) => key(g.ring[0]!, g.ring[1]!)))
    return gardens.filter((g) => !starts.has(key(g.ring[2]!, g.ring[3]!)))
  }

  it('菜園的終點也要查：在每個菜園原本的終點放一個小禁區，重新生成後終點不在禁區內', () => {
    const base = steppeLayout(farmLaneVillages(HALF), () => false, battleKeepOut, burnRateOf)
    const ends = terminalStrips(base.gardens).slice(0, 80)
      .map((g) => [(g.ring[2]![0] + g.ring[3]![0]) / 2, (g.ring[2]![1] + g.ring[3]![1]) / 2])
    const inEnd = (x: number, z: number): boolean => ends.some(([ex, ez]) => Math.hypot(x - ex!, z - ez!) < 3)
    const again = steppeLayout(farmLaneVillages(HALF), () => false, (x, z) => battleKeepOut(x, z) || inEnd(x, z), burnRateOf)
    const terminal = terminalStrips(again.gardens)
    expect(terminal.length).toBeGreaterThan(80)
    let bad = 0
    for (const g of terminal) {
      if (inEnd((g.ring[2]![0] + g.ring[3]![0]) / 2, (g.ring[2]![1] + g.ring[3]![1]) / 2)) bad++
    }
    expect(bad).toBe(0)
  })

  it('支路不穿過教堂、菜園不蓋在教堂與場部上（範圍放大到 22 km，教堂才多得夠撞上）', () => {
    const BIG = 22000
    const big = steppeLayout(farmLaneVillages(BIG), () => false, battleKeepOut, burnRateOf)
    const bigBuf = createFloraBuffer(600000)
    big.flora(-BIG - 3000, -BIG - 3000, BIG + 3000, BIG + 3000, () => 0, bigBuf)
    expect(bigBuf.dropped).toBe(0)
    const all: { x: number; z: number; kind: number }[] = []
    for (let i = 0; i < bigBuf.count; i++) all.push({ x: bigBuf.data[i * 6]!, z: bigBuf.data[i * 6 + 2]!, kind: bigBuf.kind[i]! })
    const layout = big
    const churches = all.filter((p) => p.kind === FloraKind.Church)
    expect(churches.length).toBeGreaterThanOrEqual(20)
    const segDist = (px: number, pz: number, a: readonly [number, number], b: readonly [number, number]): number => {
      const abx = b[0] - a[0]
      const abz = b[1] - a[1]
      const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (pz - a[1]) * abz) / (abx * abx + abz * abz || 1)))
      return Math.hypot(px - (a[0] + abx * t), pz - (a[1] + abz * t))
    }
    for (const ch of churches) {
      for (const s of layout.streets) {
        if (Math.abs(s.points[0]![0] - ch.x) > 400 || Math.abs(s.points[0]![1] - ch.z) > 400) continue
        for (let i = 0; i + 1 < s.points.length; i++) {
          expect(segDist(ch.x, ch.z, s.points[i]!, s.points[i + 1]!)).toBeGreaterThan(churchRoom(1) - 2)
        }
      }
    }
    // 沒有任何建築的中心落在菜園的四邊形裡（教堂、棚子、場部、房子）
    const inside = (g: { ring: readonly (readonly [number, number])[] }, x: number, z: number): boolean => {
      let sign = 0
      for (let i = 0; i < 4; i++) {
        const a = g.ring[i]!
        const b = g.ring[(i + 1) % 4]!
        const cross = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])
        if (cross === 0) continue
        if (sign === 0) sign = Math.sign(cross)
        else if (Math.sign(cross) !== sign) return false
      }
      return true
    }
    // 院子裡的棚子與果樹本來就在屋後，菜園跟它們疊在一起是對的；其餘的建築不行
    const buildings = all.filter((p) => p.kind === FloraKind.House || p.kind === FloraKind.SlateHouse
      || p.kind === FloraKind.Church || p.kind === FloraKind.TarBarn)
    // 依 120 m 的格分桶，不然 12,000 個菜園各掃一遍兩三萬棟要二十秒
    const CELL = 120
    const grid = new Map<string, typeof buildings>()
    for (const p of buildings) {
      const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
      const list = grid.get(k)
      if (list === undefined) grid.set(k, [p])
      else list.push(p)
    }
    let bad = 0
    for (const g of layout.gardens) {
      const ci = Math.floor(g.x / CELL)
      const cj = Math.floor(g.z / CELL)
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let i = ci - 1; i <= ci + 1; i++) {
          for (const p of grid.get(`${i},${j}`) ?? []) {
            if (Math.abs(p.x - g.x) < CELL && Math.abs(p.z - g.z) < CELL && inside(g, p.x, p.z)) bad++
          }
        }
      }
    }
    expect(bad).toBe(0)
  })

  it('燒毀率只動燒毀的房子與彈坑：支路、房子的位置與菜園不跟著重排', () => {
    const rate = (r: number) => (name: string): number => (name === VILLAGE_NAME ? r : 0.04)
    const a = steppeLayout(farmLaneVillages(HALF), () => false, battleKeepOut, rate(0.3))
    const b = steppeLayout(farmLaneVillages(HALF), () => false, battleKeepOut, rate(0.31))
    expect(b.gardens).toEqual(a.gardens)
    expect(b.streets).toEqual(a.streets)
    expect(b.blasts).not.toEqual(a.blasts)
    const fa = createFloraBuffer(200000)
    const fb = createFloraBuffer(200000)
    a.flora(-HALF - 3000, -HALF - 3000, HALF + 3000, HALF + 3000, () => 0, fa)
    b.flora(-HALF - 3000, -HALF - 3000, HALF + 3000, HALF + 3000, () => 0, fb)
    expect(fb.count).toBe(fa.count)
    for (let i = 0; i < fa.count * 6; i++) expect(fb.data[i]).toBe(fa.data[i])
  })

  it('支路不沿著田埂走：每一步的五個取樣點至多三個貼著田埂線', () => {
    let along = 0
    let steps = 0
    for (const s of layout.streets) {
      for (let i = 0; i + 1 < s.points.length; i++) {
        const a = s.points[i]!
        const b = s.points[i + 1]!
        let n = 0
        for (let k = 0; k < 5; k++) {
          const t = 0.1 + k * 0.2
          if (steppeRidgeGap(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < RIDGE_CLEAR) n++
        }
        steps++
        if (n >= 4) along++
      }
    }
    expect(steps).toBeGreaterThan(1000)
    expect(along).toBe(0)
  })

  it('不給戰場時每個村只零星燒毀；給了戰場就與直接呼叫生成器的結果相同', () => {
    const plain = farmSettlements(HALF, 'winterSteppe')
    const plainBuf = createFloraBuffer(200000)
    plain.flora(-HALF - 3000, -HALF - 3000, HALF + 3000, HALF + 3000, () => 0, plainBuf)
    let houses = 0
    for (let i = 0; i < plainBuf.count; i++) {
      if (plainBuf.kind[i] === FloraKind.House || plainBuf.kind[i] === FloraKind.SlateHouse) houses++
    }
    expect(plain.blasts.length).toBeGreaterThan(0)
    expect(plain.blasts.length / houses).toBeLessThan(0.08)
    expect(farmSettlements(HALF, 'winterSteppe', war).blasts).toEqual(layout.blasts)
  })
})

describe('草原田的田埂距離（CPU 版）', () => {
  it('非負、不超過半個格長；沿任一方向挪 1 m 變不到 1 m（區塊交界的除外）', () => {
    let seed = 12345
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const REG = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
    let jumps = 0
    let n = 0
    for (let i = 0; i < 4000; i++) {
      const x = (rnd() - 0.5) * 20000
      const z = (rnd() - 0.5) * 20000
      const g = steppeRidgeGap(x, z)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThan(700)
      regionAt(x, z, REG)
      const id = REG.id
      regionAt(x + 1, z, REG)
      if (REG.id !== id) continue
      n++
      if (Math.abs(steppeRidgeGap(x + 1, z) - g) > 1.0001) jumps++
    }
    expect(n).toBeGreaterThan(3000)
    expect(jumps).toBe(0)
  })

  it('田埂線上的點距離為 0：在格線上取點驗證', () => {
    // 找一條實際的田埂：沿 x 掃，距離在某處降到 0.5 m 以下，再往兩側各 6 m 回到 3 m 以上
    let hit = 0
    for (let x = -3000; x < 3000 && hit < 5; x += 0.5) {
      if (steppeRidgeGap(x, 100) < 0.5 && steppeRidgeGap(x - 6, 100) > 3 && steppeRidgeGap(x + 6, 100) > 3) {
        hit++
        x += 50
      }
    }
    expect(hit).toBeGreaterThanOrEqual(3)
  })
})

describe('戰場以外的村很小', () => {
  const all8 = farmLaneVillages(HALF)
  const bigName = VILLAGE_NAME
  const mix = steppeLayout(all8, () => false, battleKeepOut, burnRateOf, (n) => n === bigName)
  const allLarge = steppeLayout(all8, () => false, battleKeepOut, burnRateOf)
  const read = (l: ReturnType<typeof steppeLayout>): { x: number; z: number; kind: number }[] => {
    const b = createFloraBuffer(300000)
    l.flora(-HALF - 3000, -HALF - 3000, HALF + 3000, HALF + 3000, () => 0, b)
    const out: { x: number; z: number; kind: number }[] = []
    for (let i = 0; i < b.count; i++) out.push({ x: b.data[i * 6]!, z: b.data[i * 6 + 2]!, kind: b.kind[i]! })
    return out
  }
  const houseKinds = (k: number): boolean => k === FloraKind.House || k === FloraKind.SlateHouse
  const mixAll = read(mix)
  const largeAll = read(allLarge)
  const near = (list: typeof mixAll, x: number, z: number, r: number): typeof mixAll =>
    list.filter((p) => houseKinds(p.kind) && Math.hypot(p.x - x, p.z - z) < r)

  it('戰場的村維持原來的大小：同一個位置、同一批房子', () => {
    const a = near(mixAll, VILLAGE.x, VILLAGE.z, 1700)
    const b = near(largeAll, VILLAGE.x, VILLAGE.z, 1700)
    expect(a.length).toBeGreaterThan(300)
    expect(a).toEqual(b)
  })

  it('其他的村每個只有幾十戶，主街與支路都很短', () => {
    const others = all8.filter((v) => v.place.kind === 'village' && v.place.name !== bigName)
    expect(others.length).toBeGreaterThanOrEqual(5)
    for (const v of others) {
      const n = near(mixAll, v.siteX, v.siteZ, 600).length
      expect(n, v.place.name).toBeLessThan(110)
    }
    // 街的折點離站址不超過主路半長（420 / 2）加一條支路（130）再加一點
    for (const s of mix.streets) {
      for (const [x, z] of s.points) {
        const owner = others.find((v) => Math.hypot(x - v.siteX, z - v.siteZ) < 500)
        if (owner === undefined) continue
        expect(Math.hypot(x - owner.siteX, z - owner.siteZ)).toBeLessThan(420)
      }
    }
  })

  it('整張圖的房子少很多', () => {
    const total = (l: typeof mixAll): number => l.filter((p) => houseKinds(p.kind)).length
    expect(total(mixAll)).toBeLessThan(total(largeAll) * 0.5)
  })
})

describe('草原街村避開凹路', () => {
  const REG = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
  const onRoad = (x: number, z: number): boolean => {
    regionAt(x, z, REG)
    return trackGap(x, z, REG) < trackWidthAt(x, z)
  }

  it('房子與棚子的中心都不在凹路上', () => {
    const bad = placements().filter((p) => p.kind !== FloraKind.BroadTree && onRoad(p.x, p.z))
    expect(bad).toHaveLength(0)
  })

  it('菜園的中心與四個角都不在凹路上', () => {
    const { gardens } = farmSettlements(HALF, 'winterSteppe')
    let bad = 0
    for (const g of gardens) {
      if (onRoad(g.x, g.z) || g.ring.some(([x, z]) => onRoad(x, z))) bad++
    }
    expect(bad).toBe(0)
  })
})
