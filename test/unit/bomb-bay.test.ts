import { describe, it, expect } from 'vitest'
import {
  BOMB_BAY_BY_AIRCRAFT, BOMB_BAY_MAX, BOMB_RELOAD_SECONDS, BOMB_SALVO_INTERVAL,
  bombBayOf, canBomb, createBombBay, resetBombBay, stepBombBay,
} from '../../src/weapons/bomb'

const DT = 1 / 60

/** 跑 `seconds` 秒，回傳這段期間投了幾枚 */
function run(b: ReturnType<typeof createBombBay>, seconds: number, trigger = false): number {
  let n = 0
  let first = trigger
  for (let t = 0; t < seconds; t += DT) {
    stepBombBay(b, DT, first, () => { n++ })
    first = false
  }
  return n
}

describe('canBomb', () => {
  it('三台轟炸機可以，戰鬥機不行', () => {
    for (const id of ['b17g', 'he111', 'g4m']) expect(canBomb(id)).toBe(true)
    for (const id of ['p51d', 'bf109k4', 'f6f5', 'ki84', 'a6m5']) expect(canBomb(id)).toBe(false)
  })
})

describe('彈艙：一次扳機投完整艙', () => {
  it('按一次投滿 BOMB_BAY_MAX 枚，不多不少', () => {
    const b = createBombBay()
    const n = run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 1, true)
    expect(n).toBe(BOMB_BAY_MAX)
    expect(b.load).toBe(0)
  })

  it('第一枚在按下的那一幀就出去 —— 扳機不得有延遲', () => {
    const b = createBombBay()
    let n = 0
    stepBombBay(b, DT, true, () => { n++ })
    expect(n).toBe(1)
    expect(b.load).toBe(BOMB_BAY_MAX - 1)
  })

  it('相鄰兩枚的間隔就是 BOMB_SALVO_INTERVAL', () => {
    const b = createBombBay()
    const at: number[] = []
    let t = 0
    let first = true
    // 【量時刻而不是數幀】用「再走 N 幀應該剛好投出」寫的話，斷言會壓在
    // 浮點邊界上 —— 那種測試紅了也分不出是實作壞了還是自己算錯
    while (at.length < 4) {
      stepBombBay(b, DT, first, () => { at.push(t) })
      first = false
      t += DT
    }
    expect(at[0]).toBeCloseTo(0, 9)
    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThan(BOMB_SALVO_INTERVAL - DT * 1.5)
      expect(at[i]! - at[i - 1]!).toBeLessThan(BOMB_SALVO_INTERVAL + DT * 1.5)
    }
  })

  it('連投中再按一次扳機不會加速 —— 一次按下就是一整艙', () => {
    const b = createBombBay()
    let n = 0
    stepBombBay(b, DT, true, () => { n++ })
    // 【每一幀都送一次邊緣】現實裡不會這樣，但這正是要擋的：多按幾次不該
    // 讓整艙一次噴出去
    for (let t = 0; t < BOMB_SALVO_INTERVAL * 3; t += DT) {
      stepBombBay(b, DT, true, () => { n++ })
    }
    expect(n).toBeLessThanOrEqual(4)
  })
})

describe('彈艙：回補', () => {
  it('投完之後進入回補，期間投不出東西', () => {
    const b = createBombBay()
    run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 0.5, true)
    expect(b.reloading).toBe(true)
    expect(run(b, BOMB_RELOAD_SECONDS - 1, true)).toBe(0)
    expect(b.load).toBe(0)
  })

  it('回補完成後補滿，而且要再按一次才投', () => {
    const b = createBombBay()
    run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 0.5, true)
    run(b, BOMB_RELOAD_SECONDS + 0.5)
    expect(b.reloading).toBe(false)
    expect(b.load).toBe(BOMB_BAY_MAX)
    // 【沒有自動接續】回補完不會自己再投一輪
    expect(run(b, 1)).toBe(0)
    expect(run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 1, true)).toBe(BOMB_BAY_MAX)
  })

  it('回補期間按下的那一次被吃掉，不會在補完的瞬間追認', () => {
    const b = createBombBay()
    run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 0.5, true)
    expect(b.reloading).toBe(true)
    // 【trigger 是邊緣不是按著】所以這裡只在補彈進行中送一次
    const n = run(b, BOMB_RELOAD_SECONDS + 1, true)
    expect(n).toBe(0)
    expect(b.load).toBe(BOMB_BAY_MAX)
    expect(b.queue).toBe(0)
  })
})

describe('彈艙：重設', () => {
  it('resetBombBay 立刻滿艙並取消回補', () => {
    const b = createBombBay()
    run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 0.5, true)
    expect(b.reloading).toBe(true)
    resetBombBay(b)
    expect(b).toEqual({
      capacity: BOMB_BAY_MAX, load: BOMB_BAY_MAX, queue: 0, timer: 0, reloading: false,
    })
    expect(run(b, BOMB_SALVO_INTERVAL * BOMB_BAY_MAX + 1, true)).toBe(BOMB_BAY_MAX)
  })
})

describe('彈艙：每一台的容量不同', () => {
  it('三台轟炸機各有各的滿艙，戰鬥機是 0', () => {
    expect(bombBayOf('b17g')).toBe(10)
    expect(bombBayOf('he111')).toBe(8)
    expect(bombBayOf('g4m')).toBe(2)
    expect(bombBayOf('bf109k4')).toBe(0)
    expect(bombBayOf('p51d')).toBe(0)
  })

  it('canBomb 與容量表是同一份清單 —— 兩份會不同步', () => {
    for (const id of ['b17g', 'he111', 'g4m', 'bf109k4', 'p51d', 'a6m5', 'f6f5', 'ki84']) {
      expect(canBomb(id)).toBe(bombBayOf(id) > 0)
    }
  })

  it('BOMB_BAY_MAX 是那張表的上界 —— HUD 的格數與池的餘裕看它', () => {
    for (const v of Object.values(BOMB_BAY_BY_AIRCRAFT)) {
      expect(v).toBeLessThanOrEqual(BOMB_BAY_MAX)
    }
    expect(Object.values(BOMB_BAY_BY_AIRCRAFT)).toContain(BOMB_BAY_MAX)
  })

  it('小彈艙的一趟就只有那麼多枚', () => {
    const g4m = createBombBay(bombBayOf('g4m'))
    expect(run(g4m, BOMB_SALVO_INTERVAL * 10 + 1, true)).toBe(2)
  })

  it('回補補回自己的容量，不是別人的', () => {
    const g4m = createBombBay(bombBayOf('g4m'))
    run(g4m, BOMB_SALVO_INTERVAL * 4 + 0.5, true)
    expect(g4m.reloading).toBe(true)
    run(g4m, BOMB_RELOAD_SECONDS + 0.5, false)
    expect(g4m.load).toBe(2)
  })

  it('resetBombBay 換得了容量 —— 換機種走這一條', () => {
    const b = createBombBay(bombBayOf('b17g'))
    expect(b.load).toBe(10)
    resetBombBay(b, bombBayOf('g4m'))
    expect(b.capacity).toBe(2)
    expect(b.load).toBe(2)
  })
})
