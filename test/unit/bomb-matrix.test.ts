import { describe, it, expect } from 'vitest'
import { G0 } from '../../src/core/math'
import { BOMB_CONE_HALF_ANGLE } from '../../src/camera/bombsight'
import {
  BOMB_MAX_SECONDS, BOMB_TERMINAL_SPEED, bombDragK, solveImpact,
  type BombState, type Impact,
} from '../../src/world/bomb'

/**
 * 速度 × 高度的落點矩陣。
 *
 * 【它在測什麼】`bomb.test.ts` 釘的是單點與不變式；這一支釘的是**整張表的
 * 形狀**——落點對高度與速度都要單調、真空極限要對得上解析解、含阻力永遠比
 * 真空短、而且「落點離天底的角度」決定了圓錐在哪一段開始作用。相機的
 * 行為完全由那個角度決定，所以它是一條有實際後果的量。
 *
 * 【為什麼不寫死每一格的公尺數】那會變成把實作抄一份進測試。這裡斷言的是
 * 性質與界，只有兩個錨點用量測值釘住（4,000 m 的前拋、圓錐開始作用的高度）。
 */

const DT = 1 / 240
const SEA = (): number => 0
const K = bombDragK(BOMB_TERMINAL_SPEED)

/** 高度，m。涵蓋貼地到戰場天花板（`ARENA_CEILING = 10000`） */
const ALTS = [200, 300, 500, 1000, 2000, 3000, 4000, 6000, 8000] as const
/** 真空速，m/s。60 = 轟炸機失速邊緣、130 = B-17G 全速 */
const SPEEDS = [60, 90, 130] as const

interface Cell {
  alt: number
  speed: number
  /** 前拋距離，m（水平） */
  throw_: number
  /** 真空解的前拋，m */
  vacuum: number
  seconds: number
  /** 落地速度，m/s */
  impact: number
  /** 落點離天底的角度，度 */
  nadirDeg: number
}

function solve(alt: number, speed: number, k: number): Impact {
  const s: BombState = { x: 0, y: alt, z: 0, vx: 0, vy: 0, vz: -speed }
  const out: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
  const ok = solveImpact(s, k, SEA, DT, out)
  if (!ok) throw new Error(`解不出落點：alt=${alt} v=${speed}`)
  return out
}

const TABLE: Cell[] = []
for (const speed of SPEEDS) {
  for (const alt of ALTS) {
    const r = solve(alt, speed, K)
    TABLE.push({
      alt,
      speed,
      throw_: -r.z,
      vacuum: speed * Math.sqrt((2 * alt) / G0),
      seconds: r.seconds,
      impact: r.speed,
      nadirDeg: (Math.atan2(-r.z, alt) * 180) / Math.PI,
    })
  }
}

const at = (alt: number, speed: number): Cell =>
  TABLE.find((c) => c.alt === alt && c.speed === speed)!

describe('落點矩陣：真空極限', () => {
  it('阻力為 0 時對得上解析解 t = √(2h/g)、x = v·t', () => {
    for (const alt of ALTS) {
      for (const speed of SPEEDS) {
        const r = solve(alt, speed, 0)
        const t = Math.sqrt((2 * alt) / G0)
        // 半隱式歐拉一步的誤差是 O(dt)，1/240 之下相對誤差 < 0.1%
        expect(r.seconds / t).toBeCloseTo(1, 2)
        expect(-r.z / (speed * t)).toBeCloseTo(1, 2)
      }
    }
  })

  it('落地速度在真空下是 √(2gh)', () => {
    for (const alt of ALTS) {
      const r = solve(alt, 0, 0)
      expect(r.speed).toBeCloseTo(Math.sqrt(2 * G0 * alt), 0)
    }
  })
})

describe('落點矩陣：阻力的方向性', () => {
  it('含阻力的前拋恆比真空短 —— 那就是 trail', () => {
    for (const c of TABLE) expect(c.throw_).toBeLessThan(c.vacuum)
  })

  it('高度越高、trail 佔比越大 —— 阻力有更久的時間作用', () => {
    for (const speed of SPEEDS) {
      const lo = at(500, speed)
      const hi = at(8000, speed)
      expect(1 - hi.throw_ / hi.vacuum).toBeGreaterThan(1 - lo.throw_ / lo.vacuum)
    }
  })

  it('落地速度恆低於終端速度，且隨高度單調上升', () => {
    for (const speed of SPEEDS) {
      let prev = 0
      for (const alt of ALTS) {
        const c = at(alt, speed)
        expect(c.impact).toBeLessThan(BOMB_TERMINAL_SPEED)
        expect(c.impact).toBeGreaterThan(prev)
        prev = c.impact
      }
    }
  })
})

describe('落點矩陣：單調', () => {
  it('同速度下，高度越高前拋越遠、落地越久', () => {
    for (const speed of SPEEDS) {
      let d = 0
      let t = 0
      for (const alt of ALTS) {
        const c = at(alt, speed)
        expect(c.throw_).toBeGreaterThan(d)
        expect(c.seconds).toBeGreaterThan(t)
        d = c.throw_
        t = c.seconds
      }
    }
  })

  it('同高度下，速度越快前拋越遠，但落地時間幾乎不變', () => {
    for (const alt of ALTS) {
      const a = at(alt, 60)
      const b = at(alt, 90)
      const c = at(alt, 130)
      expect(b.throw_).toBeGreaterThan(a.throw_)
      expect(c.throw_).toBeGreaterThan(b.throw_)
      // 【為什麼只是「幾乎」】阻力是二次的，水平分量越大、總速率越大，
      // 垂直方向分到的減速也越多 —— 所以快的那一顆落得**稍微久**一點
      expect(c.seconds / a.seconds).toBeGreaterThan(1)
      expect(c.seconds / a.seconds).toBeLessThan(1.25)
    }
  })
})

describe('落點矩陣：圓錐在哪一段開始作用', () => {
  it('落點離天底的角度隨高度單調下降 —— 越高越接近正下方', () => {
    for (const speed of SPEEDS) {
      let prev = 90
      for (const alt of ALTS) {
        const c = at(alt, speed)
        expect(c.nadirDeg).toBeLessThan(prev)
        prev = c.nadirDeg
      }
    }
  })

  it('B-17G 巡航（90 m/s）的落點在 4,000 m 是 29 度、2,000 m 是 40 度', () => {
    expect(at(4000, 90).nadirDeg).toBeGreaterThan(28)
    expect(at(4000, 90).nadirDeg).toBeLessThan(31)
    expect(at(2000, 90).nadirDeg).toBeGreaterThan(38)
    expect(at(2000, 90).nadirDeg).toBeLessThan(42)
  })

  it('戰場預設高度（4,000 m）之下，全速度域都不會被夾', () => {
    const half = (BOMB_CONE_HALF_ANGLE * 180) / Math.PI
    for (const speed of SPEEDS) expect(at(4000, speed).nadirDeg).toBeLessThan(half)
  })

  it('低空會被夾 —— 圓錐真的有作用', () => {
    const half = (BOMB_CONE_HALF_ANGLE * 180) / Math.PI
    expect(at(1000, 90).nadirDeg).toBeGreaterThan(half)
    expect(at(2000, 130).nadirDeg).toBeGreaterThan(half)
  })
})

describe('落點矩陣：界', () => {
  it('整張表都在 BOMB_MAX_SECONDS 之內', () => {
    for (const c of TABLE) expect(c.seconds).toBeLessThan(BOMB_MAX_SECONDS)
  })

  it('最遠的一格仍在戰場半徑（ARENA_RADIUS = 12,000 m）之內', () => {
    for (const c of TABLE) expect(c.throw_).toBeLessThan(12000)
  })

  it('4,000 m × 90 m/s 的前拋是量測過的 2,232 m', () => {
    expect(at(4000, 90).throw_).toBeGreaterThan(2200)
    expect(at(4000, 90).throw_).toBeLessThan(2270)
  })
})
