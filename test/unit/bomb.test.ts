import { describe, it, expect } from 'vitest'
import { G0 } from '../../src/core/math'
import {
  BOMB_MAX_SECONDS, BOMB_SPLASH_JETS, BOMB_SPREAD_RAD, BOMB_TERMINAL_SPEED,
  BOMBS_CAPACITY, Bombs, bombDragK, stepBomb, solveImpact, spreadDirection, spreadPair,
  type BombState, type Impact,
} from '../../src/world/bomb'
import { World } from '../../src/world/World'

const DT = 1 / 240
const SEA = (): number => 0
const state = (o: Partial<BombState>): BombState =>
  ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ...o })
const impact = (): Impact => ({ x: 0, y: 0, z: 0, seconds: 0, speed: 0 })

describe('stepBomb', () => {
  it('無阻力時就是等加速度自由落體', () => {
    const s = state({ y: 1000 })
    for (let i = 0; i < 240; i++) stepBomb(s, 0, DT)
    expect(s.vy).toBeCloseTo(-G0, 6)
    expect(s.y).toBeCloseTo(1000 - G0 / 2, 1)
  })

  it('阻力讓垂直速度收斂到終端速度', () => {
    const s = state({ y: 100000 })
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 120; i++) stepBomb(s, k, DT)
    expect(Math.abs(s.vy)).toBeCloseTo(BOMB_TERMINAL_SPEED, 0)
  })

  it('阻力同時減速水平分量 —— 那就是 trail', () => {
    const s = state({ y: 4000, vz: -90 })
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 10; i++) stepBomb(s, k, DT)
    expect(Math.abs(s.vz)).toBeLessThan(90)
  })
})

describe('solveImpact', () => {
  it('無阻力時對得上解析解 t = √(2h/g)、x = v·t', () => {
    const out = impact()
    const ok = solveImpact(state({ y: 4000, vz: -90 }), 0, SEA, DT, out)
    expect(ok).toBe(true)
    const t = Math.sqrt((2 * 4000) / G0)
    expect(out.seconds).toBeCloseTo(t, 1)
    expect(out.z).toBeCloseTo(-90 * t, 0)
    expect(out.y).toBeCloseTo(0, 6)
  })

  it('有阻力時前拋比真空短 —— 4,000 m 落在 2,100~2,350 m', () => {
    const out = impact()
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    expect(solveImpact(state({ y: 4000, vz: -90 }), k, SEA, DT, out)).toBe(true)
    expect(-out.z).toBeGreaterThan(2100)
    expect(-out.z).toBeLessThan(2350)
    expect(out.seconds).toBeGreaterThan(30)
    expect(out.speed).toBeGreaterThan(200)
  })

  it('爬升中投彈：先上升再落下，不在第一步就終止', () => {
    const out = impact()
    // 起點恰在地面高度上、速度朝上 —— 沒有「先走一步」就會立刻判落地
    const ok = solveImpact(state({ y: 0.5, vy: 60 }), 0, SEA, DT, out)
    expect(ok).toBe(true)
    expect(out.seconds).toBeGreaterThan(10)
  })

  it('落點取的是地形高度，不是海平面', () => {
    const out = impact()
    const hill = (_x: number, z: number): number => (z < -1000 ? 600 : 0)
    expect(solveImpact(state({ y: 4000, vz: -90 }), 0, hill, DT, out)).toBe(true)
    expect(out.y).toBeCloseTo(600, 0)
  })

  it('永遠落不下來就回 false', () => {
    const out = impact()
    // groundAt 恆為 −Infinity —— 這條軌跡碰不到地面
    expect(solveImpact(state({ y: 4000, vz: -90 }), 0, () => -Infinity, DT, out)).toBe(false)
  })

  it('不修改傳進去的起始狀態', () => {
    const s = state({ y: 4000, vz: -90 })
    solveImpact(s, 0, SEA, DT, impact())
    expect(s.y).toBe(4000)
    expect(s.vz).toBe(-90)
    expect(s.vy).toBe(0)
  })

  it('BOMB_MAX_SECONDS 蓋得住 8,000 m —— 量測是 47.9 秒', () => {
    const out = impact()
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    expect(solveImpact(state({ y: 8000, vz: -90 }), k, SEA, DT, out)).toBe(true)
    expect(out.seconds).toBeLessThan(BOMB_MAX_SECONDS)
  })
})

describe('Bombs 池', () => {
  it('投下去、飛、落地時回報一次', () => {
    const b = new Bombs()
    b.spawn(0, 4000, 0, 0, 0, -90)
    expect(b.live).toBe(1)
    const hits: number[][] = []
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 60 && b.live > 0; i++) {
      b.step(DT, k, SEA, (x, y, z) => { hits.push([x, y, z]) })
    }
    expect(hits).toHaveLength(1)
    expect(b.live).toBe(0)
  })

  it('護欄：預測與實跑逐位元落在同一點', () => {
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    const start = state({ y: 4000, vz: -90 })
    const out = impact()
    expect(solveImpact(start, k, SEA, DT, out)).toBe(true)

    const b = new Bombs()
    b.spawn(start.x, start.y, start.z, start.vx, start.vy, start.vz)
    let hitX = NaN
    let hitZ = NaN
    for (let i = 0; i < 240 * 60 && b.live > 0; i++) {
      b.step(DT, k, SEA, (x, _y, z) => { hitX = x; hitZ = z })
    }
    // 【逐位元，不是「很接近」】兩邊跑同一支 stepBomb、同一個 dt、同一種
    // 精度（池子是 Float64Array），連落地的內插都是同一段算式。用 toBe：
    // 只要有人把池子改回 float32，或替其中一邊順手優化一個分支，這裡就紅
    expect(hitX).toBe(out.x)
    expect(hitZ).toBe(out.z)
  })

  it('超過壽命就回收，不會永遠佔著槽位', () => {
    const b = new Bombs()
    b.spawn(0, 4000, 0, 0, 0, 0)
    let n = 0
    for (let i = 0; i < Math.ceil(BOMB_MAX_SECONDS / DT) + 10; i++) {
      b.step(DT, 0, () => -Infinity, () => { n++ })
    }
    expect(n).toBe(0)
    expect(b.live).toBe(0)
  })

  it('池滿了覆寫最舊的，不拒絕投彈', () => {
    const b = new Bombs()
    for (let i = 0; i < BOMBS_CAPACITY + 5; i++) b.spawn(0, 1000, 0, 0, 0, 0)
    expect(b.live).toBe(BOMBS_CAPACITY)
  })

  it('clear 之後不留任何一顆', () => {
    const b = new Bombs()
    b.spawn(0, 1000, 0, 0, 0, 0)
    b.clear()
    expect(b.live).toBe(0)
    let n = 0
    b.step(DT, 0, SEA, () => { n++ })
    expect(n).toBe(0)
  })
})

describe('spreadDirection：投彈的離散', () => {
  const vec = (): BombState => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })

  it('角度為 0 時逐位元恆等 —— 落點的數學驗證不得被它污染', () => {
    const o = vec()
    for (const v of [[0, 0, -90], [30, -5, -80], [0, -200, 0], [-12, 3, 45]]) {
      spreadDirection(v[0]!, v[1]!, v[2]!, 0, 0, o)
      expect(o.vx).toBe(v[0]!)
      expect(o.vy).toBe(v[1]!)
      expect(o.vz).toBe(v[2]!)
    }
  })

  it('速率幾乎不變 —— 它偏的是方向不是能量', () => {
    const o = vec()
    const s0 = Math.hypot(30, -5, -80)
    spreadDirection(30, -5, -80, BOMB_SPREAD_RAD, -BOMB_SPREAD_RAD, o)
    const s1 = Math.hypot(o.vx, o.vy, o.vz)
    // 小角度近似之下 |v| 只長 θ²/2 ≈ 1.5e-6 的相對量
    expect(s1 / s0).toBeCloseTo(1, 5)
  })

  it('偏角不超過 ±0.1 度的合成量', () => {
    const o = vec()
    const max = BOMB_SPREAD_RAD * Math.SQRT2 * 1.01
    for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [0, 1]] as const) {
      spreadDirection(0, 0, -90, ax * BOMB_SPREAD_RAD, ay * BOMB_SPREAD_RAD, o)
      const c = (o.vz * -90) / (90 * Math.hypot(o.vx, o.vy, o.vz))
      expect(Math.acos(Math.min(1, c))).toBeLessThan(max)
    }
  })

  it('兩個軸各自獨立，方向與符號對得上', () => {
    const o = vec()
    // 機首朝 −Z 飛：+ax 往 +X（右）、+ay 往 +Y（上）
    spreadDirection(0, 0, -90, BOMB_SPREAD_RAD, 0, o)
    expect(o.vx).toBeGreaterThan(0)
    expect(Math.abs(o.vy)).toBeLessThan(1e-9)
    spreadDirection(0, 0, -90, 0, BOMB_SPREAD_RAD, o)
    expect(o.vy).toBeGreaterThan(0)
    expect(Math.abs(o.vx)).toBeLessThan(1e-9)
  })

  it('垂直投彈（水平分量為 0）不產生 NaN', () => {
    const o = vec()
    spreadDirection(0, -200, 0, BOMB_SPREAD_RAD, BOMB_SPREAD_RAD, o)
    expect(Number.isFinite(o.vx)).toBe(true)
    expect(Number.isFinite(o.vy)).toBe(true)
    expect(Number.isFinite(o.vz)).toBe(true)
  })
})

describe('spreadPair：確定性的偏移量', () => {
  it('同一個序號永遠給同一組值 —— Math.random 做不到重播', () => {
    const a = { u: 0, v: 0 }
    const b = { u: 0, v: 0 }
    for (const n of [0, 1, 7, 1234, 99999]) {
      spreadPair(n, a)
      spreadPair(n, b)
      expect(a.u).toBe(b.u)
      expect(a.v).toBe(b.v)
    }
  })

  it('落在 [−1, 1) 之內，而且相鄰序號不相同', () => {
    const o = { u: 0, v: 0 }
    const seen = new Set<string>()
    for (let n = 0; n < 200; n++) {
      spreadPair(n, o)
      expect(o.u).toBeGreaterThanOrEqual(-1)
      expect(o.u).toBeLessThan(1)
      expect(o.v).toBeGreaterThanOrEqual(-1)
      expect(o.v).toBeLessThan(1)
      seen.add(`${o.u},${o.v}`)
    }
    // 200 個序號不該撞出重複
    expect(seen.size).toBe(200)
  })

  it('平均接近 0 —— 不是系統性地偏向一邊', () => {
    const o = { u: 0, v: 0 }
    let su = 0
    let sv = 0
    const N = 4000
    for (let n = 0; n < N; n++) {
      spreadPair(n, o)
      su += o.u
      sv += o.v
    }
    expect(Math.abs(su / N)).toBeLessThan(0.05)
    expect(Math.abs(sv / N)).toBeLessThan(0.05)
  })
})

describe('落地事件的水陸之分', () => {
  const runToImpact = (waterAt: (x: number, z: number) => number): number => {
    const w = new World()
    w.groundAt = () => 0
    w.waterAt = waterAt
    w.dropBomb(0, 500, 0, 0, 0, 0)
    for (let i = 0; i < 240 * 30 && w.bombs.live > 0; i++) w.step(DT)
    return w.splashEvents.count
  }

  it('落海推 BOMB_SPLASH_JETS 根柱子 —— 用數量換規模', () => {
    expect(runToImpact(() => 0)).toBe(BOMB_SPLASH_JETS)
  })

  it('落在陸地上什麼都不推 —— 純內陸地圖每一顆都會噴才是缺陷', () => {
    expect(runToImpact(() => -Infinity)).toBe(0)
  })
})
