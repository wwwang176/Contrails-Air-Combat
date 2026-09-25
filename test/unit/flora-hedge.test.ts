import { describe, it, expect } from 'vitest'
import {
  createFloraBuffer, farmHedgeFlora, pushFlora, FloraKind,
  FLORA_STRIDE, HEDGE_TREE_SPACING, HEDGE_BUSH_SPACING,
  type FloraBuffer,
} from '../../src/render/flora'
import {
  edgeAt, fieldAt, onTrack, regionAt, HEDGE_WIDTH,
  type FieldSample, type RegionSample,
} from '../../src/render/fields'

const reg: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const s: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }

/** 平地 —— 高度不是這一組測試的變因 */
const FLAT = (): number => 0

interface Row {
  x: number
  y: number
  z: number
  rot: number
  scale: number
  tint: number
  kind: number
}

const BUF = createFloraBuffer(65536)

function collect(x0: number, z0: number, x1: number, z1: number): Row[] {
  BUF.count = 0
  BUF.dropped = 0
  farmHedgeFlora(x0, z0, x1, z1, FLAT, BUF)
  expect(BUF.dropped).toBe(0)
  const out: Row[] = []
  for (let i = 0; i < BUF.count; i++) {
    const o = i * FLORA_STRIDE
    out.push({
      x: BUF.data[o]!, y: BUF.data[o + 1]!, z: BUF.data[o + 2]!,
      rot: BUF.data[o + 3]!, scale: BUF.data[o + 4]!, tint: BUF.data[o + 5]!,
      kind: BUF.kind[i]!,
    })
  }
  return out
}

const key = (r: Row): string =>
  [r.x, r.y, r.z, r.rot, r.scale, r.tint, r.kind].join(',')

const sorted = (rows: Row[]): string[] => rows.map(key).sort()

/**
 * 【鐵律：座標只由全域索引決定】tile 的邊界只能用來**過濾**，不得進入座標的
 * 計算。違反的話相鄰兩格的接縫上會重複或缺漏，而且鏡頭一動植被就換位置。
 *
 * 「不重複」加「密度差不多」證明不了這件事 —— 每格各自生一套不同但仍落在
 * 格內、密度也相近的點，那兩條照樣綠。這一支才是承重的：一個大矩形的結果，
 * 必須與把它切成 n × n 之後的聯集**逐位元相同**。
 */
function assertPartitionEquivalent(
  x0: number, z0: number, x1: number, z1: number, n: number,
): number {
  const whole = collect(x0, z0, x1, z1)
  const parts: Row[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      parts.push(...collect(
        x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * j) / n,
        x0 + ((x1 - x0) * (i + 1)) / n, z0 + ((z1 - z0) * (j + 1)) / n,
      ))
    }
  }
  expect(parts.length).toBe(whole.length)
  expect(sorted(parts)).toEqual(sorted(whole))
  return whole.length
}

/** 這個點離最近的一條**格線**有多遠（不含對切線） */
function distToLattice(x: number, z: number): number {
  regionAt(x, z, reg)
  const cs = Math.cos(-reg.angle)
  const sn = Math.sin(-reg.angle)
  const qx = x * cs - z * sn
  const qz = x * sn + z * cs
  let r = Math.floor(qz / reg.cellH)
  if (qz < edgeAt(r, reg.cellH, 1)) r--
  else if (qz >= edgeAt(r + 1, reg.cellH, 1)) r++
  const salt = (r * 2 + 1) | 0
  let c = Math.floor(qx / reg.cellW)
  if (qx < edgeAt(c, reg.cellW, salt)) c--
  else if (qx >= edgeAt(c + 1, reg.cellW, salt)) c++
  return Math.min(
    qx - edgeAt(c, reg.cellW, salt),
    edgeAt(c + 1, reg.cellW, salt) - qx,
    qz - edgeAt(r, reg.cellH, 1),
    edgeAt(r + 1, reg.cellH, 1) - qz,
  )
}

const TREES = new Set([FloraKind.BroadTree, FloraKind.ConeTree])

describe('樹籬的走線', () => {
  it('分割等價：一個大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const n = assertPartitionEquivalent(-600, -600, 600, 600, 4)
    expect(n).toBeGreaterThan(600)
  })

  it('分割等價：刻意跨區塊界、負座標、格線正上方', () => {
    // 【三個刻意挑的窗】區塊間距 3,200，所以 3,200 附近一定跨界
    expect(assertPartitionEquivalent(2900, 2900, 3500, 3500, 3)).toBeGreaterThan(100)
    expect(assertPartitionEquivalent(-9200, -4100, -8600, -3500, 3)).toBeGreaterThan(100)
    expect(assertPartitionEquivalent(0, 0, 460, 713, 5)).toBeGreaterThan(50)
  })

  it('決定性：同一格生兩次逐位元相同', () => {
    const a = collect(1250, -3500, 1500, -3250)
    const b = collect(1250, -3500, 1500, -3250)
    expect(a.length).toBeGreaterThan(20)
    expect(sorted(a)).toEqual(sorted(b))
  })

  it('每一株都落在自己那一格裡', () => {
    let n = 0
    for (let tz = -1000; tz < 1000; tz += 250) {
      for (let tx = -1000; tx < 1000; tx += 250) {
        for (const r of collect(tx, tz, tx + 250, tz + 250)) {
          expect(r.x).toBeGreaterThanOrEqual(tx)
          expect(r.x).toBeLessThan(tx + 250)
          expect(r.z).toBeGreaterThanOrEqual(tz)
          expect(r.z).toBeLessThan(tz + 250)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(2000)
  })

  it('每一株都在樹籬帶上', () => {
    let n = 0
    for (let tz = -1000; tz < 1000; tz += 250) {
      for (let tx = -1000; tx < 1000; tx += 250) {
        for (const r of collect(tx, tz, tx + 250, tz + 250)) {
          regionAt(r.x, r.z, reg)
          fieldAt(r.x, r.z, reg, s)
          expect(s.hedged).toBe(true)
          expect(s.edge).toBeLessThan(HEDGE_WIDTH / 2)
          n++
        }
      }
    }
    // 【不得是空操作】一株都沒生的話上面整段沒有意義
    expect(n).toBeGreaterThan(2000)
  })

  it('每一株都站在地上', () => {
    const ramp = (x: number, z: number): number => x * 0.01 + z * 0.02
    BUF.count = 0
    BUF.dropped = 0
    farmHedgeFlora(500, 500, 750, 750, ramp, BUF)
    expect(BUF.count).toBeGreaterThan(20)
    for (let i = 0; i < BUF.count; i++) {
      const o = i * FLORA_STRIDE
      expect(BUF.data[o + 1]!).toBeCloseTo(ramp(BUF.data[o]!, BUF.data[o + 2]!), 4)
    }
  })

  /**
   * 【這一條守的是 11.8% 的缺口】對切線也是樹籬，但它不在任何一條格線上。
   * 只走格線的實作會讓「不在格線上的樹」變成 0，而地上仍然畫著那條暗帶。
   */
  it('對切線上也長樹', () => {
    let off = 0
    let all = 0
    for (let tz = -1500; tz < 1500; tz += 250) {
      for (let tx = -1500; tx < 1500; tx += 250) {
        for (const r of collect(tx, tz, tx + 250, tz + 250)) {
          all++
          if (distToLattice(r.x, r.z) >= HEDGE_WIDTH / 2) off++
        }
      }
    }
    expect(all).toBeGreaterThan(4000)
    expect(off / all).toBeGreaterThan(0.05)
  })

  /**
   * 【覆蓋率】沒有一段樹籬是「畫了暗帶卻沒有樹」。漏走一種線、或驗證條件
   * 寫反，都會在這裡露出來 —— 那些點離最近的一株會遠到幾十公尺。
   */
  it('樹籬帶上沒有一段是空的', () => {
    const rows = collect(-400, -400, 400, 400)
    expect(rows.length).toBeGreaterThan(300)
    const dists: number[] = []
    for (let z = -300; z <= 300; z += 5) {
      for (let x = -300; x <= 300; x += 5) {
        regionAt(x, z, reg)
        if (onTrack(x, z, reg)) continue
        fieldAt(x, z, reg, s)
        if (!s.hedged || s.edge >= HEDGE_WIDTH / 2) continue
        let best = Infinity
        for (const r of rows) {
          const d = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z)
          if (d < best) best = d
        }
        dists.push(Math.sqrt(best))
      }
    }
    dists.sort((a, b) => a - b)
    const p95 = dists[Math.floor(dists.length * 0.95)]!
    const worst = dists[dists.length - 1]!
    console.log(JSON.stringify({
      樹籬取樣: dists.length,
      到最近一株的p95: p95.toFixed(1) + ' m',
      最遠: worst.toFixed(1) + ' m',
    }))
    expect(p95).toBeLessThan(10)
    expect(worst).toBeLessThan(16)
  })

  it('跨區塊的那一格，兩個區塊都有樹', () => {
    // 掃一批 tile，找出真的跨兩區的那些，斷言兩側都非空
    let found = 0
    for (let tz = 1000; tz < 6000; tz += 250) {
      for (let tx = 1000; tx < 6000; tx += 250) {
        const rows = collect(tx, tz, tx + 250, tz + 250)
        if (rows.length < 10) continue
        const ids = new Set<number>()
        for (const r of rows) { regionAt(r.x, r.z, reg); ids.add(reg.id) }
        if (ids.size < 2) continue
        // 兩個區塊各自至少要有三株 —— 只贏一株可能是驗證的邊界效應
        const per = new Map<number, number>()
        for (const r of rows) {
          regionAt(r.x, r.z, reg)
          per.set(reg.id, (per.get(reg.id) ?? 0) + 1)
        }
        let small = Infinity
        for (const v of per.values()) small = Math.min(small, v)
        if (small < 3) continue
        found++
      }
    }
    // 【承重】只用 tile 中心那一區走線的實作，跨界的另一側是 0 株，
    // 上面的 ids.size < 2 會一路 continue，found 停在 0
    expect(found).toBeGreaterThan(20)
  })

  it('同一條樹籬是同一種樹', () => {
    const rows = collect(-500, -500, 500, 500).filter((r) => TREES.has(r.kind))
    expect(rows.length).toBeGreaterThan(200)
    let same = 0
    let pairs = 0
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!
        const b = rows[j]!
        const d = Math.hypot(a.x - b.x, a.z - b.z)
        if (d > 20) continue
        pairs++
        if (a.kind === b.kind) same++
      }
    }
    expect(pairs).toBeGreaterThan(100)
    // 【逐棵挑樹種的話這裡是 0.5】整排同種才讀得出防風林
    expect(same / pairs).toBeGreaterThan(0.85)
  })

  /**
   * 【為什麼比面積法推的高】由「樹籬帶佔地 12.8% ÷ 寬 18 m ÷ 間距」推出來的
   * 數字系統性偏低：兩條樹籬交會的角落，兩條帶重疊，面積只算一次而線長算
   * 兩次。實際走出來的線長比面積法推的多兩成半。
   *
   * 【區間為什麼收到 ±10%】±25% 的話少走一種線（對切線佔 11.8%）照樣綠。
   */
  it('喬木的密度是 743 棵/km² 上下', () => {
    const rows = collect(-1000, -1000, 1000, 1000)
    const trees = rows.filter((r) => TREES.has(r.kind)).length
    const perKm2 = trees / 4
    console.log(JSON.stringify({ 喬木: trees, 每平方公里: perKm2.toFixed(0) }))
    expect(trees).toBeGreaterThan(1200)
    expect(perKm2).toBeGreaterThan(743 * 0.9)
    expect(perKm2).toBeLessThan(743 * 1.1)
  })

  it('灌木的密度是 1,779 叢/km² 上下', () => {
    const rows = collect(-1000, -1000, 1000, 1000)
    const bushes = rows.filter((r) => r.kind === FloraKind.Bush).length
    const perKm2 = bushes / 4
    console.log(JSON.stringify({ 灌木: bushes, 每平方公里: perKm2.toFixed(0) }))
    expect(bushes).toBeGreaterThan(3000)
    expect(perKm2).toBeGreaterThan(1779 * 0.9)
    expect(perKm2).toBeLessThan(1779 * 1.1)
  })

  it('喬木與灌木的間距常數就是走線用的那兩個', () => {
    expect(HEDGE_TREE_SPACING).toBe(12)
    expect(HEDGE_BUSH_SPACING).toBe(5)
  })
})

describe('FloraBuffer', () => {
  it('滿了就丟並累加 dropped，不覆寫既有資料', () => {
    const buf: FloraBuffer = createFloraBuffer(4)
    for (let i = 0; i < 10; i++) {
      pushFlora(buf, i, i * 2, i * 3, 0.5, 1, 0.25, FloraKind.Bush)
    }
    expect(buf.count).toBe(4)
    expect(buf.dropped).toBe(6)
    for (let i = 0; i < 4; i++) {
      expect(buf.data[i * FLORA_STRIDE]!).toBe(i)
      expect(buf.data[i * FLORA_STRIDE + 1]!).toBe(i * 2)
      expect(buf.kind[i]!).toBe(FloraKind.Bush)
    }
  })

  it('剛好裝滿不算丟', () => {
    const buf = createFloraBuffer(3)
    for (let i = 0; i < 3; i++) pushFlora(buf, i, 0, 0, 0, 1, 0, FloraKind.House)
    expect(buf.count).toBe(3)
    expect(buf.dropped).toBe(0)
  })
})
