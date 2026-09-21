import { describe, it, expect } from 'vitest'
import { BOMB_BLAST_DAMAGE as D } from '../../src/weapons/bomb'
import { G0 } from '../../src/core/math'
import {
  BOMB_MAX_SECONDS, BOMB_SPREAD_RAD, BOMB_TERMINAL_SPEED, TORPEDO_SPREAD_RAD,
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
    b.spawn(0, 4000, 0, 0, 0, -90, D)
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
    b.spawn(start.x, start.y, start.z, start.vx, start.vy, start.vz, D)
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
    b.spawn(0, 4000, 0, 0, 0, 0, D)
    let n = 0
    for (let i = 0; i < Math.ceil(BOMB_MAX_SECONDS / DT) + 10; i++) {
      b.step(DT, 0, () => -Infinity, () => { n++ })
    }
    expect(n).toBe(0)
    expect(b.live).toBe(0)
  })

  it('池滿了覆寫最舊的，不拒絕投彈', () => {
    const b = new Bombs()
    for (let i = 0; i < BOMBS_CAPACITY + 5; i++) b.spawn(0, 1000, 0, 0, 0, 0, D)
    expect(b.live).toBe(BOMBS_CAPACITY)
  })

  /**
   * 【環狀指標繞回來時 `team` 要被蓋掉】`clear` 只清 `active`，資料陣列留著
   * 上一顆的值。少了 `spawn` 裡那一行覆寫，第 65 顆會沿用第 1 顆的隊別 ——
   * 症狀是「打久了敵方的炸彈變成藍色」，而且**只在池繞滿一圈之後才出現**。
   */
  it('繞滿一圈之後，同一格的隊別跟著新的那一顆走', () => {
    const b = new Bombs()
    b.spawn(0, 1000, 0, 0, 0, 0, D, 1)
    expect(b.team[0]).toBe(1)
    for (let i = 0; i < BOMBS_CAPACITY; i++) b.spawn(0, 1000, 0, 0, 0, 0, D, 0)
    expect(b.team[0]).toBe(0)
  })

  it('clear 之後不留任何一顆', () => {
    const b = new Bombs()
    b.spawn(0, 1000, 0, 0, 0, 0, D)
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
    // 【上界由常數推出來，不寫死位數】小角度近似下 |v| 長 (θu² + θv²)/2 的
    // 相對量，兩軸同幅時就是 θ²。寫死位數的話，調大離散會讓這一條假紅
    expect(s1 / s0 - 1).toBeGreaterThan(0)
    expect(s1 / s0 - 1).toBeLessThan(BOMB_SPREAD_RAD * BOMB_SPREAD_RAD * 1.01)
  })

  it('偏角不超過單軸上限的合成量', () => {
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
  const runToImpact = (waterAt: (x: number, z: number) => number): World => {
    const w = new World()
    w.groundAt = () => 0
    w.waterAt = waterAt
    // 【最後那個 0 是投放者的隊別】這一支測的是彈道，顏色與它無關
    w.dropBomb(0, 500, 0, 0, 0, 0, D, 0)
    for (let i = 0; i < 240 * 30 && w.bombs.live > 0; i++) w.step(DT)
    return w
  }

  it('落地推一筆事件，不論水陸 —— 表現是 main.ts 的事', () => {
    expect(runToImpact(() => 0).bombEvents.count).toBe(1)
    expect(runToImpact(() => -Infinity).bombEvents.count).toBe(1)
  })

  it('落海的那一筆 nx 是 1，落陸是 0', () => {
    const sea = runToImpact(() => 0)
    expect(sea.bombEvents.data[3]).toBe(1)
    const land = runToImpact(() => -Infinity)
    expect(land.bombEvents.data[3]).toBe(0)
  })

  it('World 不再自己推水柱 —— 那條路會讓內陸地圖每一顆都噴水', () => {
    expect(runToImpact(() => 0).splashEvents.count).toBe(0)
  })
})

/**
 * 【炸彈與魚雷的離散幅度各自獨立】兩者共用同一組序號與同一支 `spreadDirection`，
 * 幅度卻是兩個常數。合成一個的話，調落彈散佈會靜靜地把雷擊的命中率一起改掉
 * —— 而雷擊看的是提前量，投出去那一刻的偏角直接變成整段航程的橫向誤差。
 */
describe('投彈與投雷的離散幅度分開', () => {
  /** 投放速度與輸入方向的夾角，rad */
  function deviation(vx: number, vy: number, vz: number): number {
    const c = (vz * -90) / (90 * Math.hypot(vx, vy, vz))
    return Math.acos(Math.min(1, c))
  }

  it('同一個序號下，炸彈的偏角是魚雷的 BOMB/TORPEDO 倍', () => {
    const w = new World()
    // 【兩邊都是第一枚】序號各自從 0 起跳，所以 `spreadPair` 給的是同一組
    // u、v —— 兩者的差別只剩幅度這一個常數
    w.dropBomb(0, 4000, 0, 0, 0, -90, 500, 0)
    w.dropTorpedo(0, 50, 0, 0, 0, -90, 500, 0, -1, 0)
    const b = deviation(w.bombs.vx[0]!, w.bombs.vy[0]!, w.bombs.vz[0]!)
    const t = deviation(w.torpedoes.vx[0]!, w.torpedoes.vy[0]!, w.torpedoes.vz[0]!)
    // 【這一組 u、v 不能恰好是 0】是的話兩邊都不偏，比值沒有意義
    expect(t).toBeGreaterThan(1e-9)
    // 【4 位】`spreadDirection` 走小角度近似，比值本身帶 1e-6 量級的誤差
    expect(b / t).toBeCloseTo(BOMB_SPREAD_RAD / TORPEDO_SPREAD_RAD, 4)
  })
})
