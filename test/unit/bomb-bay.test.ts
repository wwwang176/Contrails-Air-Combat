import { describe, it, expect } from 'vitest'
import {
  BOMB_SALVO_INTERVAL, createBombBay, resetBombBay, stepBombBay,
} from '../../src/weapons/bomb'
import { LOADOUT_BY_AIRCRAFT, loadoutOf } from '../../src/weapons/stores'

const DT = 1 / 60

/** 這一支的基準彈艙 —— 十枚、20 秒回補 */
const B17 = loadoutOf('b17g')!
const B17_COUNT = B17.count
const B17_RELOAD = B17.reloadSeconds

/** 跑 `seconds` 秒，回傳這段期間投了幾枚 */
function run(
  b: ReturnType<typeof createBombBay>, seconds: number, trigger = false, releaseOk = true,
): number {
  let n = 0
  let first = trigger
  for (let t = 0; t < seconds; t += DT) {
    stepBombBay(b, DT, first, releaseOk, () => { n++ })
    first = false
  }
  return n
}

describe('誰掛得了東西', () => {
  /** 【零戰預設也不掛】爆戦的兩顆 60 kg 由任務卡指定（盟 M3） */
  it('三台轟炸機可以，戰鬥機預設都不行', () => {
    for (const id of ['b17g', 'he111', 'g4m']) {
      expect(loadoutOf(id), id).not.toBeNull()
    }
    for (const id of ['a6m5', 'p51d', 'bf109k4', 'f6f5', 'ki84']) {
      expect(loadoutOf(id), id).toBeNull()
    }
  })
})

describe('彈艙：一次扳機投完整艙', () => {
  it('按一次投滿 B17_COUNT 枚，不多不少', () => {
    const b = createBombBay(B17)
    const n = run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 1, true)
    expect(n).toBe(B17_COUNT)
    expect(b.load).toBe(0)
  })

  it('第一枚在按下的那一幀就出去 —— 扳機不得有延遲', () => {
    const b = createBombBay(B17)
    let n = 0
    stepBombBay(b, DT, true, true, () => { n++ })
    expect(n).toBe(1)
    expect(b.load).toBe(B17_COUNT - 1)
  })

  it('相鄰兩枚的間隔就是 BOMB_SALVO_INTERVAL', () => {
    const b = createBombBay(B17)
    const at: number[] = []
    let t = 0
    let first = true
    // 【量時刻而不是數幀】用「再走 N 幀應該剛好投出」寫的話，斷言會壓在
    // 浮點邊界上 —— 那種測試紅了也分不出是實作壞了還是自己算錯
    while (at.length < 4) {
      stepBombBay(b, DT, first, true, () => { at.push(t) })
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
    const b = createBombBay(B17)
    let n = 0
    stepBombBay(b, DT, true, true, () => { n++ })
    // 【每一幀都送一次邊緣】現實裡不會這樣，但這正是要擋的：多按幾次不該
    // 讓整艙一次噴出去
    for (let t = 0; t < BOMB_SALVO_INTERVAL * 3; t += DT) {
      stepBombBay(b, DT, true, true, () => { n++ })
    }
    expect(n).toBeLessThanOrEqual(4)
  })
})

describe('彈艙：回補', () => {
  it('投完之後進入回補，期間投不出東西', () => {
    const b = createBombBay(B17)
    run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 0.5, true)
    expect(b.reloading).toBe(true)
    expect(run(b, B17_RELOAD - 1, true)).toBe(0)
    expect(b.load).toBe(0)
  })

  it('回補完成後補滿，而且要再按一次才投', () => {
    const b = createBombBay(B17)
    run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 0.5, true)
    run(b, B17_RELOAD + 0.5)
    expect(b.reloading).toBe(false)
    expect(b.load).toBe(B17_COUNT)
    // 【沒有自動接續】回補完不會自己再投一輪
    expect(run(b, 1)).toBe(0)
    expect(run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 1, true)).toBe(B17_COUNT)
  })

  it('回補期間按下的那一次被吃掉，不會在補完的瞬間追認', () => {
    const b = createBombBay(B17)
    run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 0.5, true)
    expect(b.reloading).toBe(true)
    // 【trigger 是邊緣不是按著】所以這裡只在補彈進行中送一次
    const n = run(b, B17_RELOAD + 1, true)
    expect(n).toBe(0)
    expect(b.load).toBe(B17_COUNT)
    expect(b.queue).toBe(0)
  })
})

describe('彈艙：重設', () => {
  it('resetBombBay 立刻滿艙並取消回補', () => {
    const b = createBombBay(B17)
    run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 0.5, true)
    expect(b.reloading).toBe(true)
    resetBombBay(b)
    expect(b).toEqual({
      capacity: B17_COUNT, reloadSeconds: B17_RELOAD,
      load: B17_COUNT, queue: 0, timer: 0, reloading: false,
    })
    expect(run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 1, true)).toBe(B17_COUNT)
  })
})

describe('彈艙：每一台的掛載不同', () => {
  it('三台轟炸機各有各的滿艙，戰鬥機建出來是空艙', () => {
    expect(createBombBay(loadoutOf('b17g')).capacity).toBe(10)
    expect(createBombBay(loadoutOf('he111')).capacity).toBe(8)
    expect(createBombBay(loadoutOf('g4m')).capacity).toBe(1)
    expect(createBombBay(loadoutOf('bf109k4')).capacity).toBe(0)
    expect(createBombBay().capacity).toBe(0)
  })

  it('小彈艙的一趟就只有那麼多枚', () => {
    const g4m = createBombBay(loadoutOf('g4m'))
    expect(run(g4m, BOMB_SALVO_INTERVAL * 10 + 1, true)).toBe(1)
  })

  it('回補補回自己的容量與自己的秒數，不是別人的', () => {
    const g4m = loadoutOf('g4m')!
    const b = createBombBay(g4m)
    run(b, BOMB_SALVO_INTERVAL * 4 + 0.5, true)
    expect(b.reloading).toBe(true)
    // 【魚雷的裝填比炸彈久】用 B-17G 的 20 秒來等，這時候還沒補完
    run(b, B17_RELOAD + 0.5, false)
    expect(b.load).toBe(0)
    run(b, g4m.reloadSeconds - B17_RELOAD + 0.5, false)
    expect(b.load).toBe(1)
  })

  it('resetBombBay 換得了掛載 —— 換機種走這一條', () => {
    const b = createBombBay(loadoutOf('b17g'))
    expect(b.load).toBe(10)
    expect(b.reloadSeconds).toBe(20)
    resetBombBay(b, loadoutOf('g4m'))
    expect(b.capacity).toBe(1)
    expect(b.load).toBe(1)
    expect(b.reloadSeconds).toBe(45)
  })

  /**
   * 【空艙不得進回補迴圈】容量 0 的彈艙滿足「投完了」的每一個條件，少了
   * 那道 `capacity > 0` 就會每一步重新開始一次 0 秒的回補。
   */
  it('掛不了東西的飛機不會無限回補', () => {
    const b = createBombBay(null)
    run(b, 5, true)
    expect(b.reloading).toBe(false)
    expect(b.load).toBe(0)
  })

  it('表上的每一台都建得出一個滿艙', () => {
    for (const [id, l] of Object.entries(LOADOUT_BY_AIRCRAFT)) {
      const b = createBombBay(loadoutOf(id))
      expect(b.load).toBe(l.count)
      expect(b.reloadSeconds).toBe(l.reloadSeconds)
    }
  })
})

/**
 * 投放包絡的閘。
 *
 * 【為什麼閘在狀態機裡而不是呼叫端】這支有兩段各自獨立的分支：一段排入
 * `queue`、另一段真的投。在呼叫端寫 `press && releaseOk` 只擋得住第一段。
 */
describe('彈艙：投放包絡的閘', () => {
  it('包絡不成立時按扳機沒有作用，而且不排入 queue', () => {
    const b = createBombBay(B17)
    expect(run(b, 2, true, false)).toBe(0)
    expect(b.load).toBe(B17_COUNT)
    expect(b.queue).toBe(0)
  })

  /**
   * 【彈藥不得被無聲吃掉】只把 `drop` 換成空函數的話 `load` 與 `queue`
   * 仍然遞減 —— 玩家會看到格子一格一格消失卻沒有東西掉下去。
   */
  it('連投中途包絡失效：暫停，而且一枚都不消耗', () => {
    const b = createBombBay(B17)
    const dropped = run(b, BOMB_SALVO_INTERVAL * 2.5, true)
    expect(dropped).toBeGreaterThan(0)
    expect(dropped).toBeLessThan(B17_COUNT)

    const loadBefore = b.load
    const queueBefore = b.queue
    expect(queueBefore).toBeGreaterThan(0)

    // 包絡失效，跑一段足夠投完整艙的時間
    expect(run(b, BOMB_SALVO_INTERVAL * B17_COUNT, false, false)).toBe(0)
    expect(b.load).toBe(loadBefore)
    expect(b.queue).toBe(queueBefore)
  })

  it('包絡恢復之後接著投完剩下的', () => {
    const b = createBombBay(B17)
    const first = run(b, BOMB_SALVO_INTERVAL * 2.5, true)
    run(b, 3, false, false)
    const rest = run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 1, false, true)
    expect(first + rest).toBe(B17_COUNT)
    expect(b.load).toBe(0)
  })

  /**
   * 【補彈不該因為玩家在翻滾而停住】`timer` 與回補是計時，不是投放。
   */
  it('包絡不成立時回補照常推進', () => {
    const b = createBombBay(B17)
    run(b, BOMB_SALVO_INTERVAL * B17_COUNT + 0.5, true)
    expect(b.reloading).toBe(true)
    run(b, B17_RELOAD + 0.5, false, false)
    expect(b.reloading).toBe(false)
    expect(b.load).toBe(B17_COUNT)
  })
})
