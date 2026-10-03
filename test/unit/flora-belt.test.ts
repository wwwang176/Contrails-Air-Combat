import { describe, expect, it } from 'vitest'
import {
  BELT_CHANCE, BELT_GROVE_HALF, BELT_ROAD_CLEAR, BELT_ROW_GAP, BELT_VILLAGE_CLEAR, createFloraBuffer, FLORA_STRIDE, FloraKind,
  hash1, steppeBeltFloraFor, type FloraBuffer,
} from '../../src/render/flora'
import {
  regionAt, steppeNearestEdge, steppeRidgeGap, trackGap, trackWidthAt, villageDistance, type RegionSample, type SteppeEdge,
} from '../../src/render/fields'
import { at, BELT_BOX, shelterbeltFade, toLocal } from '../../src/world/rzhev'

const FLAT = (): number => 0
const reg: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

interface Tree { x: number; z: number; key: string; kind: number }

/** 戰場方框中心附近、以 1 km 取整的原點，掃 `n × n` 個 1 km 方塊 */
const ORIGIN = at(0, 0)
const X0 = Math.round(ORIGIN.x / 1000) * 1000
const Z0 = Math.round(ORIGIN.z / 1000) * 1000

function run(
  fade: (x: number, z: number) => number, x0: number, z0: number, x1: number, z1: number,
): Tree[] {
  const buf: FloraBuffer = createFloraBuffer(400000)
  steppeBeltFloraFor(fade)(x0, z0, x1, z1, FLAT, buf)
  expect(buf.dropped).toBe(0)
  const out: Tree[] = []
  for (let i = 0; i < buf.count; i++) {
    const o = i * FLORA_STRIDE
    out.push({
      x: buf.data[o]!, z: buf.data[o + 2]!, kind: buf.kind[i]!,
      key: Array.from(buf.data.subarray(o, o + FLORA_STRIDE)).join(',') + ',' + buf.kind[i],
    })
  }
  return out
}

const HALF = 6000
const all = run(shelterbeltFade, X0 - HALF, Z0 - HALF, X0 + HALF, Z0 + HALF)

describe('草原的防風林帶', () => {
  it('12 × 12 km 裡有成千上萬棵，只有喬木（沒有灌木）、闊葉與針葉都有', () => {
    expect(all.length).toBeGreaterThan(5000)
    expect(all.length).toBeLessThan(40000)
    expect(all.some((t) => t.kind === FloraKind.BroadTree)).toBe(true)
    expect(all.some((t) => t.kind === FloraKind.ConeTree)).toBe(true)
    expect(all.every((t) => t.kind === FloraKind.BroadTree || t.kind === FloraKind.ConeTree)).toBe(true)
  })

  /**
   * 【鐵律：座標只由全域索引決定】把一個大矩形切成 3 × 3 之後的聯集必須與整塊逐位元相同。
   * 不重複、密度差不多證明不了這件事。
   */
  it('分割等價：一整塊與切成 3 × 3 的聯集逐株相同', () => {
    const x0 = X0 + 1500
    const z0 = Z0 - 4000
    const size = 3000
    const whole = run(shelterbeltFade, x0, z0, x0 + size, z0 + size)
    expect(whole.length).toBeGreaterThan(300)
    const parts: Tree[] = []
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        parts.push(...run(shelterbeltFade, x0 + (i * size) / 3, z0 + (j * size) / 3,
          x0 + ((i + 1) * size) / 3, z0 + ((j + 1) * size) / 3))
      }
    }
    expect(parts.map((t) => t.key).sort()).toEqual(whole.map((t) => t.key).sort())
  })

  it('每一棵都在田埂上：離最近的田界不超過小樹林的半寬；絕大多數在三排林帶的寬度裡', () => {
    const beltLimit = BELT_ROW_GAP + 1.2 + 0.05
    let inBelt = 0
    for (const t of all) {
      const gap = steppeRidgeGap(t.x, t.z)
      expect(gap).toBeLessThanOrEqual(BELT_GROVE_HALF + 0.05)
      if (gap <= beltLimit) inBelt++
    }
    expect(inBelt / all.length).toBeGreaterThan(0.7)
  })

  it('有小樹林：有些地方 20 m 內擠著二十棵以上，那是林帶（三排、間距三公尺多，頂多十來棵）做不到的密度', () => {
    const CELL = 20
    const grid = new Map<string, Tree[]>()
    const cellOf = (v: number): number => Math.floor(v / CELL)
    for (const t of all) {
      const k = `${cellOf(t.x)},${cellOf(t.z)}`
      const list = grid.get(k)
      if (list === undefined) grid.set(k, [t])
      else list.push(t)
    }
    let dense = 0
    for (const a of all) {
      let n = 0
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          for (const b of grid.get(`${cellOf(a.x) + i},${cellOf(a.z) + j}`) ?? []) {
            if (Math.hypot(a.x - b.x, a.z - b.z) <= 20) n++
          }
        }
      }
      if (n >= 20) { dense++; break }
    }
    expect(dense).toBe(1)
  })

  /**
   * 【遠近兩邊的判準要是同一個】植被只畫到 4.8～6 km，再遠由地面著色器把有林帶的田界畫成一條帶子
   * （`SiteLayout.belts`，歐陸的樹籬也是這個做法）。著色器的判準是「最近那條田界的 `edgeKey` 再
   * 雜湊一次小於 `BELT_CHANCE`」；這裡用 CPU 版的最近田界（`steppeNearestEdge`）驗每一棵樹都落在
   * 過了這個判準的田界上 —— 種樹的線身分一改，這條就紅，而畫面上只是「遠處的帶子與近處的樹對不上」。
   */
  it('每一棵都在著色器也認定有林帶的田界上（最近田界的身分過了同一個判準）', () => {
    const e: SteppeEdge = { gap: 0, key: 0 }
    let ok = 0
    for (const t of all) {
      steppeNearestEdge(t.x, t.z, e)
      if (hash1(e.key ^ 0x2be1) / 4294967296 < BELT_CHANCE) ok++
    }
    // 兩條田界的角落最近的可能是另一條，所以不是 100%
    expect(ok / all.length).toBeGreaterThan(0.95)
  })

  it('戰場方框裡一棵都沒有，濃度也不是零的地方才有', () => {
    for (const t of all) {
      const l = toLocal(t.x, t.z)
      const inside = Math.abs(l.lx) < BELT_BOX.half && l.lz > BELT_BOX.north && l.lz < BELT_BOX.south
      expect(inside).toBe(false)
      expect(shelterbeltFade(t.x, t.z)).toBeGreaterThan(0)
    }
  })

  it('不蓋在村上也不蓋在凹路上', () => {
    for (const t of all) {
      expect(villageDistance(t.x, t.z)).toBeGreaterThanOrEqual(BELT_VILLAGE_CLEAR)
      regionAt(t.x, t.z, reg)
      expect(trackGap(t.x, t.z, reg)).toBeGreaterThanOrEqual(trackWidthAt(t.x, t.z) + BELT_ROAD_CLEAR)
    }
  })

  it('濃度 0 就一棵也沒有；濃度 1 比 0.5 多', () => {
    const x0 = X0 + 4000
    const z0 = Z0
    const none = run(() => 0, x0, z0, x0 + 3000, z0 + 3000)
    const half = run(() => 0.5, x0, z0, x0 + 3000, z0 + 3000)
    const full = run(() => 1, x0, z0, x0 + 3000, z0 + 3000)
    expect(none.length).toBe(0)
    expect(half.length).toBeGreaterThan(0)
    expect(full.length).toBeGreaterThan(half.length)
  })

  it('同一條線同一個樹種：沿一條田界連續的兩棵不會一闊一針', () => {
    // 距離 7 m 以內的兩棵視為同一條線上相鄰的樹（沿線間距 3.5 m、排距 5 m）
    const CELL = 8
    const grid = new Map<string, Tree[]>()
    const cellOf = (v: number): number => Math.floor(v / CELL)
    for (const t of all) {
      const k = `${cellOf(t.x)},${cellOf(t.z)}`
      const list = grid.get(k)
      if (list === undefined) grid.set(k, [t])
      else list.push(t)
    }
    let pairs = 0
    let mixed = 0
    for (const a of all) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          for (const b of grid.get(`${cellOf(a.x) + i},${cellOf(a.z) + j}`) ?? []) {
            if (b === a || Math.hypot(a.x - b.x, a.z - b.z) > 7) continue
            pairs++
            if (a.kind !== b.kind) mixed++
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(10000)
    // 兩條線交叉的角落會有少數混種，不是零
    expect(mixed / pairs).toBeLessThan(0.05)
  })
})

describe('shelterbeltFade', () => {
  it('方框裡是 0、遠處是 1、中間單調上升', () => {
    expect(shelterbeltFade(at(0, 0).x, at(0, 0).z)).toBe(0)
    const e = at(BELT_BOX.half, 0)
    expect(shelterbeltFade(e.x, e.z)).toBeCloseTo(0, 9)
    const far = at(BELT_BOX.half + 5000, 0)
    expect(shelterbeltFade(far.x, far.z)).toBe(1)
    let prev = -1
    for (let d = 0; d <= 1000; d += 100) {
      const p = at(BELT_BOX.half + d, 0)
      const f = shelterbeltFade(p.x, p.z)
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
    // 北緣與南緣也算
    const n = at(0, BELT_BOX.north - 5000)
    expect(shelterbeltFade(n.x, n.z)).toBe(1)
    const s = at(0, BELT_BOX.south + 5000)
    expect(shelterbeltFade(s.x, s.z)).toBe(1)
  })
})
