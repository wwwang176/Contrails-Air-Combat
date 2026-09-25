import { describe, expect, it } from 'vitest'
import {
  BRIDGE_REACH, DECK_CLEARANCE, RAMP_SLOPE, ROAD_LIFT, ROAD_STEP,
  extendStraight, insideRing, insideSettlement, ringDistance, roadProfile, settlementRadius,
} from '../../src/world/landFeatures'

/** # 地物的幾何：聚落大小、多邊形、高速公路的縱剖面 */

describe('聚落的大小', () => {
  it('鎮照人口放大，夾在 160～900', () => {
    expect(settlementRadius({ name: 'M', kind: 'town', x: 0, z: 0, pop: 36000 })).toBeCloseTo(698, 0)
    expect(settlementRadius({ name: 'A', kind: 'town', x: 0, z: 0, pop: 500 })).toBe(160)
    expect(settlementRadius({ name: 'B', kind: 'town', x: 0, z: 0, pop: 900000 })).toBe(900)
  })

  it('村比鎮小，小聚落最小', () => {
    const v = settlementRadius({ name: 'V', kind: 'village', x: 0, z: 0 })
    expect(v).toBeGreaterThanOrEqual(120)
    expect(v).toBeLessThanOrEqual(170)
    expect(settlementRadius({ name: 'H', kind: 'hamlet', x: 0, z: 0 })).toBe(70)
  })

  /** 【不是正圓】輪廓有起伏，但中心一定在裡面、兩倍半徑一定在外面 */
  it('輪廓：中心在內、兩倍半徑外', () => {
    const p = { name: 'Kreypau', kind: 'village', x: 100, z: -50 } as const
    const r = settlementRadius(p)
    expect(insideSettlement(p, 100, -50)).toBe(true)
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      expect(insideSettlement(p, 100 + Math.cos(a) * r * 2, -50 + Math.sin(a) * r * 2)).toBe(false)
    }
  })
})

describe('多邊形', () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]] as const
  it('內外與到邊界的距離', () => {
    expect(insideRing(square, 50, 50)).toBe(true)
    expect(insideRing(square, 150, 50)).toBe(false)
    expect(ringDistance(square, 50, 50)).toBeCloseTo(50, 9)
    expect(ringDistance(square, 150, 50)).toBeCloseTo(50, 9)
  })
})

describe('高速公路的縱剖面', () => {
  // 一條往東的直路，地面平的；一條南北向的河在 x = 1000，水面 2 m
  const line = [[0, 0], [2000, 0]] as const
  const flat = (): number => 0
  const riverDistance = (x: number): number => Math.abs(x - 1000)
  const riverLevel = (): number => 2
  const p = roadProfile(line, flat, riverDistance, riverLevel)

  it('沒有河的地方貼著地面', () => {
    const q = roadProfile(line, flat, () => Infinity, () => -Infinity)
    for (const h of q.height) expect(h).toBeCloseTo(ROAD_LIFT, 9)
    expect(q.overWater.every((o) => !o)).toBe(true)
  })

  /** 【橋要墊高】路面貼著地面過河就是淹在水裡的路 */
  it('河上的橋面比水面高 DECK_CLEARANCE', () => {
    let n = 0
    for (let i = 0; i < p.points.length; i++) {
      if (!p.overWater[i]) continue
      n++
      expect(p.height[i]).toBeCloseTo(2 + DECK_CLEARANCE + ROAD_LIFT, 9)
      expect(Math.abs(p.points[i]![0] - 1000)).toBeLessThanOrEqual(BRIDGE_REACH)
    }
    expect(n).toBeGreaterThan(3)
  })

  /** 【引道不陡於 4%】一步跳上橋面就是一面牆 */
  it('引道的坡度不超過 RAMP_SLOPE，遠處回到地面', () => {
    for (let i = 0; i + 1 < p.points.length; i++) {
      const run = Math.hypot(p.points[i + 1]![0] - p.points[i]![0], p.points[i + 1]![1] - p.points[i]![1])
      expect(Math.abs(p.height[i + 1]! - p.height[i]!)).toBeLessThanOrEqual(RAMP_SLOPE * run + 1e-9)
    }
    expect(p.height[0]).toBeCloseTo(ROAD_LIFT, 9)
    expect(p.height.at(-1)).toBeCloseTo(ROAD_LIFT, 9)
  })

  it('取樣間距是 ROAD_STEP、頭尾保留', () => {
    expect(p.points[0]).toEqual([0, 0])
    expect(p.points.at(-1)).toEqual([2000, 0])
    expect(p.points[1]![0]).toBeCloseTo(ROAD_STEP, 9)
  })
})

describe('直直延伸', () => {
  it('兩端沿最後一段的方向各拉出去', () => {
    const e = extendStraight([[0, 0], [10, 0], [20, 10]], 1000)
    expect(e[0]![0]).toBeCloseTo(-1000, 9)
    expect(e[0]![1]).toBeCloseTo(0, 9)
    const last = e.at(-1)!
    expect(last[0] - 20).toBeCloseTo(1000 / Math.SQRT2, 6)
    expect(last[1] - 10).toBeCloseTo(1000 / Math.SQRT2, 6)
  })
})
