import { describe, it, expect } from 'vitest'
import {
  createFloraBuffer, farmVillageFlora, villageSite, FloraKind, FLORA_STRIDE,
  LANE_BAND, VILLAGE_SPAN,
} from '../../src/render/flora'
import {
  regionAt, REGION_SPACING, TRACK_WIDTH, type RegionSample,
} from '../../src/render/fields'

const reg: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const P = { x: 0, z: 0 }
const FLAT = (): number => 0
const BUF = createFloraBuffer(65536)

interface Row { x: number; y: number; z: number; kind: number }

function collect(x0: number, z0: number, x1: number, z1: number): Row[] {
  BUF.count = 0
  BUF.dropped = 0
  farmVillageFlora(x0, z0, x1, z1, FLAT, BUF)
  expect(BUF.dropped).toBe(0)
  const out: Row[] = []
  for (let i = 0; i < BUF.count; i++) {
    const o = i * FLORA_STRIDE
    out.push({
      x: BUF.data[o]!, y: BUF.data[o + 1]!, z: BUF.data[o + 2]!, kind: BUF.kind[i]!,
    })
  }
  return out
}

const key = (r: Row): string => [r.x, r.y, r.z, r.kind].join(',')

/** 掃一片區塊格，回所有成立的站址 */
function sites(half: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      if (villageSite(i, j, P)) out.push({ x: P.x, z: P.z })
    }
  }
  return out
}

/** 把建築按最近的站址分群 */
function byVillage(rows: Row[], list: { x: number; z: number }[]): Map<number, Row[]> {
  const m = new Map<number, Row[]>()
  for (const r of rows) {
    let best = -1
    let bd = Infinity
    for (let i = 0; i < list.length; i++) {
      const d = Math.hypot(list[i]!.x - r.x, list[i]!.z - r.z)
      if (d < bd) { bd = d; best = i }
    }
    const arr = m.get(best) ?? []
    arr.push(r)
    m.set(best, arr)
  }
  return m
}

describe('村落', () => {
  /**
   * 【站址在路上是由定義保證的，不是事後檢查】站址取兩顆種子的中點 ——
   * 中點到兩顆等距，所以落在它們的 Voronoi 邊界上，也就是凹路上。
   * 第三顆種子更近的情形由 `villageSite` 自己驗掉。
   */
  it('站址一定在路上', () => {
    const list = sites(4)
    for (const p of list) {
      regionAt(p.x, p.z, reg)
      expect(reg.r2 - reg.r1).toBeLessThan(TRACK_WIDTH)
    }
    // 【不得是空操作】81 格裡至少兩成有村
    expect(list.length).toBeGreaterThan(20)
  })

  it('有村的格子佔三到八成', () => {
    const list = sites(6)
    const share = list.length / (13 * 13)
    console.log(JSON.stringify({
      站址: list.length, 格數: 169, 成立率: (share * 100).toFixed(0) + '%',
    }))
    expect(share).toBeGreaterThan(0.3)
    expect(share).toBeLessThan(0.8)
  })

  it('村與村的間距是幾公里，不是幾百公尺', () => {
    const list = sites(4)
    let worst = Infinity
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        worst = Math.min(worst, Math.hypot(list[i]!.x - list[j]!.x, list[i]!.z - list[j]!.z))
      }
    }
    console.log(JSON.stringify({ 最近的兩村: (worst / 1000).toFixed(2) + ' km' }))
    expect(worst).toBeGreaterThan(REGION_SPACING * 0.3)
  })

  /** 【房子沿路排，不蓋在路上】`r2 − r1` 約等於離凹路中心距離的兩倍 */
  it('房子不在路上，但也不遠離路', () => {
    const rows = collect(-4000, -4000, 4000, 4000)
    expect(rows.length).toBeGreaterThan(20)
    for (const r of rows) {
      regionAt(r.x, r.z, reg)
      expect(reg.r2 - reg.r1).toBeGreaterThanOrEqual(TRACK_WIDTH)
      expect(reg.r2 - reg.r1).toBeLessThanOrEqual(LANE_BAND)
    }
  })

  it('每個村 6 到 14 棟，沒有一個村是 0 棟', () => {
    const list = sites(6)
    const rows = collect(-9000, -9000, 9000, 9000)
    const groups = byVillage(rows, list)
    expect(groups.size).toBeGreaterThan(5)
    for (const [, arr] of groups) {
      // 建築含教堂，所以上界多一
      expect(arr.length).toBeGreaterThanOrEqual(3)
      expect(arr.length).toBeLessThanOrEqual(15)
    }
  })

  /**
   * 【沒有這一條，穀倉永遠是 0 也會綠】
   *
   * 【窗要大】9 km 見方只有 96 棟，二項分佈的標準差就佔了五個百分點 ——
   * 那個樣本量下 0.21 與 0.33 分不開。30 km 見方是一千八百棟。
   */
  it('穀倉佔兩成半到四成半', () => {
    const rows = collect(-30000, -30000, 30000, 30000)
    const barns = rows.filter((r) => r.kind === FloraKind.Barn).length
    const houses = rows.filter((r) => r.kind === FloraKind.House).length
    console.log(JSON.stringify({ 房子: houses, 穀倉: barns }))
    expect(barns).toBeGreaterThan(30)
    const share = barns / (barns + houses)
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.45)
  })

  /** 【「最多一座」對零筆是空操作】所以先要下界 */
  it('教堂：夠多的村裡總數落在合理區間', () => {
    const rows = collect(-16000, -16000, 16000, 16000)
    const churches = rows.filter((r) => r.kind === FloraKind.Church).length
    const list = sites(5)
    console.log(JSON.stringify({ 站址: list.length, 教堂: churches }))
    expect(list.length).toBeGreaterThan(30)
    expect(churches).toBeGreaterThan(10)
    expect(churches).toBeLessThan(list.length)
  })

  it('每個村最多一座教堂，而且在站址 40 m 內', () => {
    const list = sites(6)
    const rows = collect(-9000, -9000, 9000, 9000)
    const groups = byVillage(rows.filter((r) => r.kind === FloraKind.Church), list)
    let total = 0
    for (const [idx, arr] of groups) {
      expect(arr.length).toBe(1)
      expect(Math.hypot(list[idx]!.x - arr[0]!.x, list[idx]!.z - arr[0]!.z))
        .toBeLessThan(40)
      total++
    }
    expect(total).toBeGreaterThan(0)
  })

  it('分割等價：大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const whole = collect(-4000, -4000, 4000, 4000).map(key).sort()
    const parts: string[] = []
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        parts.push(...collect(
          -4000 + 2000 * i, -4000 + 2000 * j,
          -4000 + 2000 * (i + 1), -4000 + 2000 * (j + 1),
        ).map(key))
      }
    }
    expect(whole.length).toBeGreaterThan(20)
    expect(parts.sort()).toEqual(whole)
  })

  it('每一棟都落在自己那一格裡，而且站在地上', () => {
    const ramp = (x: number, z: number): number => x * 0.02 + z * 0.005
    let n = 0
    // 【切成長條特別會抓到問題】站址是兩顆種子的中點，可能落在隔壁格裡 ——
    // 格範圍少放一格的話，窄長條的窗會把整個村漏掉，而全窗完全正常
    for (let tz = -4000; tz < 4000; tz += 250) {
      BUF.count = 0
      BUF.dropped = 0
      farmVillageFlora(-4000, tz, 4000, tz + 250, ramp, BUF)
      for (let i = 0; i < BUF.count; i++) {
        const o = i * FLORA_STRIDE
        const z = BUF.data[o + 2]!
        expect(z).toBeGreaterThanOrEqual(tz)
        expect(z).toBeLessThan(tz + 250)
        expect(BUF.data[o + 1]!).toBeCloseTo(ramp(BUF.data[o]!, z), 4)
        n++
      }
    }
    expect(n).toBeGreaterThan(20)
  })

  it('建築的半徑上限就是 VILLAGE_SPAN', () => {
    const list = sites(6)
    const rows = collect(-9000, -9000, 9000, 9000)
    expect(rows.length).toBeGreaterThan(40)
    for (const r of rows) {
      let bd = Infinity
      for (const p of list) bd = Math.min(bd, Math.hypot(p.x - r.x, p.z - r.z))
      expect(bd).toBeLessThanOrEqual(VILLAGE_SPAN)
    }
  })
})
