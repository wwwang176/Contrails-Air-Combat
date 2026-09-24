import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import {
  CHANNEL_HALF, CLEARANCE, EXTEND_REACH, RiverIndex, extendRivers, riverLines,
  type RiverFile, type WaterLine,
} from '../../src/world/river'
import { buildRiverWater } from '../../src/render/river'
import { createLeuna } from '../../src/world/leuna'
import { FARM_EXTENT, outsideZero } from '../../src/world/farmland'

/**
 * # 河：遊戲裡的洛伊納（手擺丘陵的高度場）
 *
 * 實測高程那一份在 `leuna-dem.test.ts`。
 */

const FILE = JSON.parse(readFileSync('public/data/leuna-rivers.json', 'utf8')) as RiverFile
const solid = outsideZero(createLeuna().field)
const sample = (x: number, z: number): number => solid.sample(x, z)
const HALF = FARM_EXTENT / 2
const LINES = riverLines(sample, FILE)
const EXT = extendRivers(LINES, HALF, sample)
const ALL = [...LINES, ...EXT]

function brute(lines: readonly WaterLine[], x: number, z: number): number {
  let best = Infinity
  for (const l of lines) {
    for (let i = 0; i + 1 < l.points.length; i++) {
      const a = l.points[i]!
      const b = l.points[i + 1]!
      const vx = b[0] - a[0]
      const vz = b[1] - a[1]
      const l2 = vx * vx + vz * vz
      const t = l2 <= 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2))
      best = Math.min(best, Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)))
    }
  }
  return best
}

describe('地圖外的延伸', () => {
  /**
   * 五端流出地圖：Saale 的北端與西端、Luppe 兩端（它沿著北緣流）、Wethau 的
   * 南端。匯流口不延伸 —— 延伸了就是一條從地圖中間冒出來、往外流的假河。
   */
  it('只有流出地圖的河端才延伸', () => {
    expect(EXT).toHaveLength(5)
    for (const e of EXT) {
      const p = e.points[0]!
      expect(Math.max(Math.abs(p[0]), Math.abs(p[1])), e.name).toBeGreaterThan(HALF - 1000)
    }
  })

  /** 【起點就是河端】差一點點，兩段水面之間就是一道縫 */
  it('從河端接出去，一路往外、不繞回地圖', () => {
    for (const e of EXT) {
      const p0 = e.points[0]!
      expect(LINES.some((l) => [l.points[0]!, l.points.at(-1)!].some((q) => q[0] === p0[0] && q[1] === p0[1])),
        e.name).toBe(true)
      // 出圖方向：離哪一條邊近就朝哪一邊。每一步沿它的分量都要是正的
      const alongX = Math.abs(p0[0]) >= Math.abs(p0[1])
      const nx = alongX ? Math.sign(p0[0]) : 0
      const nz = alongX ? 0 : Math.sign(p0[1])
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i]!
        const b = e.points[i + 1]!
        expect((b[0] - a[0]) * nx + (b[1] - a[1]) * nz, `${e.name} 第 ${i} 步`).toBeGreaterThan(0)
      }
      const last = e.points.at(-1)!
      expect(last[0] * nx + last[1] * nz, `${e.name} 走不夠遠`).toBeGreaterThan(HALF + EXTEND_REACH / 2)
    }
  })

  /**
   * 【要像地圖內的真河那樣彎】真河每 3 km 的彎曲度是 1.25～1.45。太直的話
   * 一出地圖就變成一條運河，接縫一眼就看得出來。
   */
  it('有彎，不是一條直線', () => {
    for (const e of EXT) {
      const a = e.points[0]!
      const b = e.points.at(-1)!
      let len = 0
      for (let i = 0; i + 1 < e.points.length; i++) {
        len += Math.hypot(e.points[i + 1]![0] - e.points[i]![0], e.points[i + 1]![1] - e.points[i]![1])
      }
      expect(len / Math.hypot(b[0] - a[0], b[1] - a[1]), e.name).toBeGreaterThan(1.15)
    }
  })

  /** 【延伸段彼此不交叉】北緣有三端擠在 14 km 裡，交叉的話是兩條河在霧裡打結 */
  it('延伸段彼此不交叉', () => {
    const cross = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
      const rx = b[0]! - a[0]!, rz = b[1]! - a[1]!, sx = d[0]! - c[0]!, sz = d[1]! - c[1]!
      const den = rx * sz - rz * sx
      if (Math.abs(den) < 1e-9) return false
      const t = ((c[0]! - a[0]!) * sz - (c[1]! - a[1]!) * sx) / den
      const u = ((c[0]! - a[0]!) * rz - (c[1]! - a[1]!) * rx) / den
      return t > 0 && t < 1 && u > 0 && u < 1
    }
    for (let i = 0; i < EXT.length; i++) {
      for (let j = i + 1; j < EXT.length; j++) {
        const A = EXT[i]!.points
        const B = EXT[j]!.points
        for (let p = 0; p + 1 < A.length; p++) {
          for (let q = 0; q + 1 < B.length; q++) {
            expect(cross(A[p]!, A[p + 1]!, B[q]!, B[q + 1]!), `${i} × ${j}`).toBe(false)
          }
        }
      }
    }
  })

  it('每次進場一模一樣', () => {
    const again = extendRivers(riverLines(sample, FILE), HALF, sample)
    expect(again.map((e) => e.points)).toEqual(EXT.map((e) => e.points))
  })
})

describe('水面', () => {
  /**
   * 【水面不懸空】它是貼著地形鋪的帶子，爬上丘陵的側坡就是斜掛、一邊懸空。
   * 中心線上的水面離地面超過三公尺就看得出來。
   */
  it('每一條河（含延伸段）的水面高出中心線地面不超過 3 m、也不低於地面', () => {
    for (const l of ALL) {
      for (let i = 0; i < l.points.length; i++) {
        const [x, z] = l.points[i]!
        const above = l.level[i]! - sample(x, z)
        expect(above, `${l.name} (${Math.round(x)},${Math.round(z)})`).toBeLessThanOrEqual(3)
        expect(above, `${l.name} (${Math.round(x)},${Math.round(z)})`).toBeGreaterThanOrEqual(CLEARANCE - 1e-6)
      }
    }
  })

  /** 【捲繞方向】反了的話法線朝下、整條被背面剔除 —— 畫面上什麼都沒有 */
  it('每一個三角形的法線都朝上', () => {
    const mesh = buildRiverWater(ALL)
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute
    const idx = mesh.geometry.getIndex()!
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
    expect(down).toBe(0)
    expect(idx.count / 3).toBeGreaterThan(1000)
  })
})

describe('查詢索引', () => {
  const index = new RiverIndex(ALL, 200)

  /** 【與逐段掃描一樣】格網漏掉一段的話，那一段河上的炸彈會噴土 */
  it('查詢半徑內的距離與逐段掃描相同', () => {
    let seed = 99
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    let near = 0
    for (let k = 0; k < 3000; k++) {
      // 一半撒在河道附近，一半撒在整張圖
      const l = ALL[Math.floor(rand() * ALL.length)]!
      const p = l.points[Math.floor(rand() * l.points.length)]!
      const x = k % 2 === 0 ? p[0] + (rand() - 0.5) * 500 : (rand() - 0.5) * 2 * (HALF + 20_000)
      const z = k % 2 === 0 ? p[1] + (rand() - 0.5) * 500 : (rand() - 0.5) * 2 * (HALF + 20_000)
      const want = brute(ALL, x, z)
      const got = index.distance(x, z)
      if (want <= 200) {
        near++
        expect(got, `(${x},${z})`).toBeCloseTo(want, 6)
      } else {
        expect(got, `(${x},${z})`).toBe(Infinity)
      }
    }
    expect(near).toBeGreaterThan(500)
  })

  it('水面內回水面高度，出了水面半寬回 −Infinity', () => {
    const l = LINES[0]!
    const i = Math.floor(l.points.length / 2)
    const [x, z] = l.points[i]!
    const a = l.points[i - 1]!
    const b = l.points[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nx = -(b[1] - a[1]) / len
    const nz = (b[0] - a[0]) / len
    expect(index.waterAt(x, z)).toBeCloseTo(l.level[i]!, 6)
    expect(index.waterAt(x + nx * (CHANNEL_HALF - 5), z + nz * (CHANNEL_HALF - 5))).toBeGreaterThan(-Infinity)
    expect(index.waterAt(x + nx * (CHANNEL_HALF + 20), z + nz * (CHANNEL_HALF + 20))).toBe(-Infinity)
    expect(index.waterAt(0, -7000)).toBe(-Infinity)
    expect(index.waterAt(1e7, 1e7)).toBe(-Infinity)
  })

  it('延伸段上也是水', () => {
    const e = EXT[0]!
    const p = e.points[Math.floor(e.points.length / 2)]!
    expect(index.waterAt(p[0], p[1])).toBeCloseTo(CLEARANCE, 6)
  })
})
