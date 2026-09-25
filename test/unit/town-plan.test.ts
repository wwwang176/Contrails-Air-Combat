import { describe, expect, it } from 'vitest'
import {
  cellAt, Footprints, planTown, rectGap, roadAngles, StreetIndex, type PlanSpec,
} from '../../src/render/townPlan'

/** # 鎮的街網（`townPlan.ts`） */

const SPEC: PlanSpec = {
  oldTown: 0.4,
  old: { band: [55, 75], cross: [45, 70], half: 2.5 },
  outer: { band: [70, 95], cross: [90, 130], half: 4 },
  mainHalf: 5, ringHalf: 6, marketHalf: 4,
  warp: { old: 10, outer: 7, wave: 130 },
}

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const gapsOf = (a: readonly number[]): number[] =>
  a.map((v, i) => (i + 1 < a.length ? a[i + 1]! : a[0]! + Math.PI * 2) - v)

describe('roadAngles', () => {
  /**
   * 【放射路之間不留大空檔】最近的八個聚落可能全在同一側（實測 Bad Lauchstädt
   * 空了 198°），那一側的鎮就沒有出城的路，外圍的扇區大到一條同心街橫跨半個鎮
   */
  it('至少三條、相鄰兩條不超過 120°', () => {
    const one = roadAngles(0, 0, [{ x: 1000, z: 0 }])
    expect(one.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...gapsOf(one))).toBeLessThanOrEqual((Math.PI * 2) / 3 + 1e-9)
    const side = roadAngles(0, 0, [{ x: 1000, z: 10 }, { x: 1000, z: 300 }, { x: 900, z: -200 }])
    expect(Math.max(...gapsOf(side))).toBeLessThanOrEqual((Math.PI * 2) / 3 + 1e-9)
  })

  /** 【±π 接縫】−173° 與 164° 只差 24°，要併成一條；直接相減會以為差 336° */
  it('跨 ±π 的兩個方向照實際夾角合併', () => {
    const a = (d: number): { x: number; z: number } =>
      ({ x: Math.cos((d * Math.PI) / 180) * 1000, z: Math.sin((d * Math.PI) / 180) * 1000 })
    const out = roadAngles(0, 0, [a(-172.7), { ...a(163.6), x: a(163.6).x * 1.5, z: a(163.6).z * 1.5 }, a(0)])
    const near180 = out.filter((t) => Math.abs(t - Math.PI) < 0.5)
    expect(near180).toHaveLength(1)
    for (const g of gapsOf(out)) expect(g).toBeGreaterThan(0)
  })
})

describe('planTown', () => {
  const plan = planTown({
    x: 0, z: 0, R: 700, outline: (t) => 1 + 0.15 * Math.sin(3 * t), roads: roadAngles(0, 0, [
      { x: 5000, z: 300 }, { x: -2000, z: 4000 }, { x: -3000, z: -3000 }, { x: 1000, z: -6000 },
    ]), market: 50, rand: seeded(7), avoid: () => false, spec: SPEC,
  })

  /**
   * 【不是方格】街段方向折成 0～90°、每 10° 一格。方格的街網幾乎全落在同一格
   * （兩個互相垂直的方向折起來是同一個）；放射加同心的街網分散在各格
   */
  it('街段的方向不集中在兩個互相垂直的方向', () => {
    const peak = (streets: readonly { points: readonly (readonly [number, number])[] }[]): number => {
      const bins = new Array<number>(9).fill(0)
      let total = 0
      for (const s of streets) {
        for (let i = 0; i + 1 < s.points.length; i++) {
          const [ax, az] = s.points[i]!
          const [bx, bz] = s.points[i + 1]!
          const len = Math.hypot(bx - ax, bz - az)
          const deg = ((Math.atan2(bz - az, bx - ax) * 180) / Math.PI + 360) % 90
          bins[Math.min(8, Math.floor(deg / 10))]! += len
          total += len
        }
      }
      return Math.max(...bins) / total
    }
    // 量尺本身：一張轉了 20° 的方格街網要被抓到
    const grid: { points: [number, number][] }[] = []
    const [c, s] = [Math.cos(0.35), Math.sin(0.35)]
    for (let k = -5; k <= 5; k++) {
      grid.push({ points: [[c * -320 - s * k * 64, s * -320 + c * k * 64], [c * 320 - s * k * 64, s * 320 + c * k * 64]] })
      grid.push({ points: [[c * k * 64 + s * 320, s * k * 64 - c * 320], [c * k * 64 - s * 320, s * k * 64 + c * 320]] })
    }
    expect(peak(grid)).toBeGreaterThan(0.9)
    expect(peak(plan.streets)).toBeLessThan(0.3)
  })

  it('有老城、外圍兩區；每個街廓的四角照 θ、r 排好（不翻面）', () => {
    expect(plan.cells.some((c) => c.zone === 'old')).toBe(true)
    expect(plan.cells.some((c) => c.zone === 'outer')).toBe(true)
    for (const c of plan.cells) {
      expect(c.t1a).toBeGreaterThan(c.t0a)
      expect(c.t1b).toBeGreaterThan(c.t0b)
      expect(c.r1).toBeGreaterThan(c.r0)
    }
  })

  /** 【最外一圈沒有外側的街】鎮的邊緣是參差的房子，不是一圈環城路 */
  it('只有最外一圈的外緣沒有街', () => {
    for (const c of plan.cells) {
      if (c.edges[1] === 0) expect(c.r1).toBe(1)
      else expect(c.r1).toBeLessThan(1)
    }
  })

  it('cellAt 的四個角落在街廓的四個參數角上', () => {
    const q: number[] = [0, 0]
    const p: number[] = [0, 0]
    const c = plan.cells[5]!
    cellAt(plan, c, 0, 0, q)
    plan.at(c.t0a, c.r0, p)
    expect(q).toEqual(p)
    cellAt(plan, c, 1, 1, q)
    plan.at(c.t1b, c.r1, p)
    expect(q).toEqual(p)
  })
})

describe('外框與街心點', () => {
  it('rectGap：相隔、相貼、相交', () => {
    const a = { x: 0, z: 0, ax: 1, az: 0, hw: 5, hd: 3 }
    expect(rectGap(a, { ...a, x: 12 })).toBeCloseTo(2, 6)
    expect(rectGap(a, { ...a, x: 10 })).toBeCloseTo(0, 6)
    expect(rectGap(a, { ...a, x: 9 })).toBeCloseTo(-1, 6)
    // 轉 45° 的一棟，角伸進來
    const s = Math.SQRT1_2
    expect(rectGap(a, { x: 7.5, z: 0, ax: s, az: s, hw: 2, hd: 2 })).toBeLessThan(0)
  })

  it('Footprints 擋相交、放行相隔', () => {
    const f = new Footprints()
    f.add({ x: 0, z: 0, ax: 1, az: 0, hw: 5, hd: 3 })
    expect(f.free({ x: 9, z: 0, ax: 1, az: 0, hw: 5, hd: 3 }, 0)).toBe(false)
    expect(f.free({ x: 11, z: 0, ax: 1, az: 0, hw: 5, hd: 3 }, 0)).toBe(true)
    // 跨好幾格的長條建築也比得到
    f.add({ x: 100, z: 0, ax: 1, az: 0, hw: 25, hd: 7 })
    expect(f.free({ x: 60, z: 0, ax: 1, az: 0, hw: 20, hd: 3 }, 0)).toBe(false)
  })

  /**
   * 【外框從兩個街心點之間穿過也要擋】街心線 10 m 取一點；只查那些點的話，
   * 一棟房子可以壓在兩點中間的街面上
   */
  it('StreetIndex 擋住壓到兩個取樣點中間的外框', () => {
    const idx = new StreetIndex([{ points: [[0, 0], [10, 0]], half: 2.5 }])
    expect(idx.clear({ x: 5, z: 8, ax: 1, az: 0, hw: 3, hd: 6 }, 0)).toBe(false)
    expect(idx.clear({ x: 5, z: 9, ax: 1, az: 0, hw: 3, hd: 6 }, 0)).toBe(true)
  })
})
