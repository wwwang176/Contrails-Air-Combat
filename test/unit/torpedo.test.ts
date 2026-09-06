import { describe, it, expect } from 'vitest'
import {
  BOMB_MAX_SECONDS, BOMB_TERMINAL_SPEED, bombDragK, solveImpact,
  type BombState, type Impact,
} from '../../src/world/bomb'
import {
  TORPEDO_DEPTH, TORPEDO_RANGE, TORPEDO_SPEED, Torpedoes, WAKE_INTERVAL,
} from '../../src/world/torpedo'

const DT = 1 / 240
const K = bombDragK(BOMB_TERMINAL_SPEED)
const DAMAGE = 15_000

/** 平海：碰撞面恆為 0，浪面也恆為 0 */
const SEA = (): number => 0

/**
 * 內陸：碰撞面也是 0（平原就是 0），但**沒有水**。
 *
 * 見 `render/terrain.ts` 的 `createFarmlandTerrain` —— `waterAt` 恆 `-Infinity`。
 */
const DRY = (): number => -Infinity

interface Ended { x: number; y: number; z: number; kind: number; damage: number }

/**
 * 投一枚並跑到它結束（或跑滿 `seconds`）。回傳觀察得到的一切。
 */
function fly(opts: {
  start?: Partial<BombState>
  groundAt?: (x: number, z: number) => number
  waterAt?: (x: number, z: number) => number
  blockedBy?: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => number
  seconds?: number
}): {
  pool: Torpedoes
  slot: number
  ends: Ended[]
  entries: { x: number; y: number; z: number }[]
  wakes: { x: number; y: number; z: number }[]
} {
  const s: BombState = {
    x: 0, y: 60, z: 0, vx: 0, vy: 0, vz: -80, ...opts.start,
  }
  const pool = new Torpedoes()
  const slot = pool.spawn(s.x, s.y, s.z, s.vx, s.vy, s.vz, DAMAGE, 0, -1)
  const ends: Ended[] = []
  const entries: { x: number; y: number; z: number }[] = []
  const wakes: { x: number; y: number; z: number }[] = []
  const ground = opts.groundAt ?? SEA
  const water = opts.waterAt ?? SEA
  const seconds = opts.seconds ?? 150
  for (let t = 0; t < seconds; t += DT) {
    if (pool.active[slot] === 0 && ends.length + entries.length > 0) break
    pool.step(
      DT, K, ground, water,
      (x, y, z, kind, damage) => { ends.push({ x, y, z, kind, damage }) },
      (x, y, z) => { entries.push({ x, y, z }) },
      (x, y, z) => { wakes.push({ x, y, z }) },
      opts.blockedBy,
    )
  }
  return { pool, slot, ends, entries, wakes }
}

describe('沒有水的地方不入水', () => {
  /**
   * 【碰撞高度 0 不等於有水】內陸地圖的 `collisionHeightAt` 在平原上就是 0，
   * 和海面一模一樣 —— 高度值兼任水陸分類時，魚雷會把整片農田當成海。
   * 實測：`farmland` ±10 km 的取樣點有 **73.5%** 是「碰撞高度 0 且無水」。
   *
   * 症狀有兩層：雷體鑽進地裡跑到射程用盡（不引爆、無事件），而航跡事件
   * 帶著 `y = -Infinity` 出去 —— 那會餵進水花粒子池。
   */
  it('內陸平原上投雷 —— 撞地引爆，不鑽進地裡', () => {
    const { ends, entries } = fly({ waterAt: DRY })
    expect(entries.length).toBe(0)
    expect(ends.length).toBe(1)
    expect(ends[0]!.kind).toBe(0)
    expect(ends[0]!.damage).toBe(DAMAGE)
  })

  it('沒有入水就沒有航跡 —— 不會把 -Infinity 餵給水花', () => {
    const { wakes } = fly({ waterAt: DRY })
    expect(wakes.length).toBe(0)
  })

  it('水面高度是 NaN 也算陸地 —— 判準是肯定式，壞值向安全側倒', () => {
    const { ends, entries } = fly({ waterAt: () => NaN })
    expect(entries.length).toBe(0)
    expect(ends.length).toBe(1)
    expect(ends[0]!.kind).toBe(0)
  })

  it('海面照舊入水', () => {
    const { ends, entries } = fly({ waterAt: SEA, seconds: 5 })
    expect(entries.length).toBe(1)
    expect(ends.length).toBe(0)
  })
})

describe('空中段與炸彈是同一支積分', () => {
  /**
   * 【這一條是整個檔案的重點】瞄具畫的落點圈與入水點走同一條彈道。兩邊分家
   * 的症狀是「圈說一個地方、水柱噴在另一個地方」，而且**隨畫面更新率變動**。
   * 所以比的是 `toBe` 不是 `toBeCloseTo`。
   *
   * 【比的是彈道，不是那一枚的落點】正式投放走 `World.dropTorpedo`，它會
   * 再套一層與炸彈相同的散佈（`spreadPair`，由累計序號決定、不是亂數）。
   * 圈畫的是散佈**之前**的中心 —— 見 `torpedo-vs-ship.test.ts` 的那一條。
   */
  it('入水點與 solveImpact 的落點逐位元相同', () => {
    const start: BombState = { x: 12, y: 3000, z: -7, vx: 30, vy: -4, vz: -95 }
    const out: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
    expect(solveImpact(start, K, SEA, DT, out)).toBe(true)

    const { entries } = fly({ start })
    expect(entries.length).toBe(1)
    expect(entries[0]!.x).toBe(out.x)
    expect(entries[0]!.y).toBe(out.y)
    expect(entries[0]!.z).toBe(out.z)
  })

  it('落在陸地就直接引爆，不入水', () => {
    const { ends, entries } = fly({ groundAt: () => 5 })
    expect(entries.length).toBe(0)
    expect(ends.length).toBe(1)
    expect(ends[0]!.kind).toBe(0)
    expect(ends[0]!.damage).toBe(DAMAGE)
  })

  it('空中飛太久就回收 —— 沿用炸彈的上限', () => {
    // 往上丟，而且腳下永遠碰不到地
    const { pool, slot, ends, entries } = fly({
      start: { y: 100, vy: 5, vz: 0 },
      groundAt: () => -Infinity,
      seconds: BOMB_MAX_SECONDS + 5,
    })
    expect(ends.length).toBe(0)
    expect(entries.length).toBe(0)
    expect(pool.active[slot]).toBe(0)
  })
})

describe('水中段：定深、等速、直線', () => {
  it('入水的第一步就在定深上', () => {
    const { pool, slot } = fly({ seconds: 5 })
    expect(pool.phase[slot]).toBe(1)
    expect(pool.y[slot]).toBe(-TORPEDO_DEPTH)
  })

  /**
   * 【深度不吃浪】海面的碰撞體是平面（負責人 2026-08-28），浪只是視覺高低。
   * 跟著浪走的話雷體會在 240 Hz 下上下抖，而且每步要付 12 次 sin。
   */
  it('浪再大，定深也不變', () => {
    const { pool, slot } = fly({ waterAt: (x) => 3 * Math.sin(x), seconds: 5 })
    expect(pool.y[slot]).toBe(-TORPEDO_DEPTH)
  })

  it('等速直線 —— 十秒剛好跑 TORPEDO_SPEED × 10', () => {
    const { pool, slot } = fly({ seconds: 14 })
    // 入水之後再跑 10 秒。入水點的 z 由空中段決定，所以量的是航程
    const run = pool.run[slot]!
    expect(run).toBeGreaterThan(0)
    // 水中段開始的時刻不精確，改量「航程與時間的比值」
    expect(pool.vy[slot]).toBe(0)
    const speed = Math.hypot(pool.vx[slot]!, pool.vz[slot]!)
    expect(speed).toBeCloseTo(TORPEDO_SPEED, 9)
  })

  it('航程累加的就是水中跑的距離', () => {
    const { pool, slot, entries } = fly({ seconds: 30 })
    const e = entries[0]!
    const travelled = Math.hypot(pool.x[slot]! - e.x, pool.z[slot]! - e.z)
    expect(pool.run[slot]).toBeCloseTo(travelled, 6)
  })

  it('水平航向沿用入水時的方向', () => {
    const { pool, slot } = fly({ start: { vx: 60, vz: -60 }, seconds: 5 })
    // 入水速度的水平分量是 (+, −) 的等比，歸一化之後兩軸大小相同
    expect(Math.abs(pool.vx[slot]!)).toBeCloseTo(Math.abs(pool.vz[slot]!), 6)
    expect(pool.vx[slot]!).toBeGreaterThan(0)
    expect(pool.vz[slot]!).toBeLessThan(0)
  })

  /**
   * 【退化只有測試碰得到】包絡的 pitch 上限是 ±6°，垂直入水在遊戲裡不會
   * 發生；但函式仍要有定義，而且**不能從退化的速度反推**。
   */
  it('垂直落下時沿用投放時的機首方向', () => {
    const pool = new Torpedoes()
    const slot = pool.spawn(0, 50, 0, 0, -40, 0, DAMAGE, 1, 0)
    for (let t = 0; t < 5; t += DT) {
      pool.step(DT, K, SEA, SEA, () => {}, () => {}, () => {})
    }
    expect(pool.phase[slot]).toBe(1)
    expect(pool.vx[slot]).toBeCloseTo(TORPEDO_SPEED, 9)
    expect(pool.vz[slot]).toBeCloseTo(0, 9)
  })
})

describe('水中段的三種結束', () => {
  /**
   * 【這一條守的是那個判錯的判準】海面的碰撞高度是 0、雷體在 −1，寫成
   * `collisionHeightAt > 雷體高度` 的話 `0 > −1` 恆真 —— 魚雷一出膛就會
   * 在海中央自爆。
   */
  it('平海上不會自爆，一路跑到射程用盡', () => {
    const { pool, slot, ends } = fly({ seconds: 130 })
    expect(ends.length).toBe(0)
    expect(pool.active[slot]).toBe(0)
  })

  it('射程用盡是無聲消失，不引爆', () => {
    const { pool, slot, ends } = fly({ seconds: 130 })
    expect(ends.length).toBe(0)
    expect(pool.active[slot]).toBe(0)
    expect(pool.run[slot]).toBeGreaterThan(TORPEDO_RANGE)
  })

  /**
   * 【射程不被秒數截斷】2,000 ÷ 22 = 90.9 s，比炸彈的 90 s 上限還久。
   * 給整支魚雷加一個 90 s 的上限的話，射程會變成一個講不通的 1,980 m。
   */
  it('跑滿全程要 90 秒以上，而且真的跑得完', () => {
    expect(TORPEDO_RANGE / TORPEDO_SPEED).toBeGreaterThan(BOMB_MAX_SECONDS)
    const { pool, slot } = fly({ seconds: 130 })
    expect(pool.run[slot]).toBeGreaterThanOrEqual(TORPEDO_RANGE)
  })

  it('撞岸引爆', () => {
    // 往 −Z 飛，z < −400 之後是陸地
    const { ends } = fly({ groundAt: (_x, z) => (z < -400 ? 5 : 0) })
    expect(ends.length).toBe(1)
    expect(ends[0]!.kind).toBe(0)
    expect(ends[0]!.z).toBeLessThanOrEqual(-400)
  })

  it('撞船引爆，位置是線段上的命中點', () => {
    const seen: { x0: number; z0: number; x1: number; z1: number }[] = []
    const { ends } = fly({
      // 【只在水中段回報】水中的線段恆在定深上，空中的不是 —— 用這個
      // 分辨，測試就不必自己追蹤相位
      blockedBy: (x0, y0, z0, x1, y1, z1) => {
        if (y0 !== -TORPEDO_DEPTH || y1 !== -TORPEDO_DEPTH) return -1
        if (z0 > -600) return -1
        seen.push({ x0, z0, x1, z1 })
        return 0.5
      },
      seconds: 60,
    })
    expect(seen.length).toBe(1)
    expect(ends.length).toBe(1)
    expect(ends[0]!.kind).toBe(1)
    expect(ends[0]!.damage).toBe(DAMAGE)
    // 命中點是那一步線段的中點
    const s = seen[0]!
    expect(ends[0]!.x).toBeCloseTo((s.x0 + s.x1) / 2, 9)
    expect(ends[0]!.z).toBeCloseTo((s.z0 + s.z1) / 2, 9)
    expect(ends[0]!.y).toBe(-TORPEDO_DEPTH)
  })

  it('撞船比射程用盡優先 —— 最後一公尺打中的還是算', () => {
    const { ends } = fly({
      blockedBy: (_x0, y0, _z0, _x1, y1) => (
        y0 === -TORPEDO_DEPTH && y1 === -TORPEDO_DEPTH ? 1 : -1
      ),
      seconds: 40,
    })
    expect(ends.length).toBe(1)
    expect(ends[0]!.kind).toBe(1)
  })
})

describe('航跡', () => {
  it('每 WAKE_INTERVAL 公尺一叢', () => {
    const { pool, slot, wakes } = fly({ seconds: 40 })
    const run = pool.run[slot]!
    expect(wakes.length).toBe(Math.floor(run / WAKE_INTERVAL))
    expect(wakes.length).toBeGreaterThan(5)
  })

  /**
   * 【航跡的高度是含浪的水面】雷體在 −1，水花要浮在看得見的水面上。
   * 這是整條路上唯一問 `waterAt` 的地方。
   */
  it('高度取的是水面，不是雷體', () => {
    const { wakes } = fly({ waterAt: () => 2.5, seconds: 40 })
    expect(wakes.length).toBeGreaterThan(0)
    for (const w of wakes) expect(w.y).toBe(2.5)
  })

  it('空中段不留航跡', () => {
    const { wakes } = fly({ groundAt: () => 5 })
    expect(wakes.length).toBe(0)
  })
})

describe('池子', () => {
  it('clear 之後投彈序號也歸零 —— 重播的散佈才會相同', () => {
    const pool = new Torpedoes()
    pool.spawn(0, 0, 0, 0, 0, -1, DAMAGE, 0, -1)
    pool.spawn(0, 0, 0, 0, 0, -1, DAMAGE, 0, -1)
    expect(pool.dropped).toBe(2)
    expect(pool.live).toBe(2)
    pool.clear()
    expect(pool.dropped).toBe(0)
    expect(pool.live).toBe(0)
    expect(pool.active[0]).toBe(0)
  })

  it('每一枚各自帶著傷害', () => {
    const pool = new Torpedoes()
    const a = pool.spawn(0, 0, 0, 0, 0, -1, 1000, 0, -1)
    const b = pool.spawn(0, 0, 0, 0, 0, -1, 2000, 0, -1)
    expect(pool.damage[a]).toBe(1000)
    expect(pool.damage[b]).toBe(2000)
  })
})
