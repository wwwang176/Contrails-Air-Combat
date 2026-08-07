import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  planFlightOrder, createCommandState, stepCommand, DEFAULT_COMMAND,
  type CommandUnit, type CommandFlight,
} from '../../src/ai/command'
import { DEFAULT_STEER } from '../../src/ai/steer'
import { THREAT_RANGE } from '../../src/ai/assess'

/** 造一架快照。預設健康、在原點、朝 −Z、升限 12000 */
function unit(over: Partial<CommandUnit> & { x?: number; y?: number; z?: number } = {}): CommandUnit {
  return {
    position: new Vector3(over.x ?? 0, over.y ?? 4000, over.z ?? 0),
    velocity: over.velocity ?? new Vector3(0, 0, -200),
    cornerRatio: over.cornerRatio ?? 1.2,
    hpFraction: over.hpFraction ?? 1,
    serviceCeiling: over.serviceCeiling ?? 12000,
    alive: over.alive ?? true,
  }
}

const cfg = DEFAULT_COMMAND
/** 剛好滿足「已見底」的秒數 */
const SPENT = cfg.spentSeconds

describe('planFlightOrder：該不該下令', () => {
  it('見底且敵人在附近 → 必有命令', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT, cfg)).not.toBeNull()
  })

  it('還沒累積滿 → null', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT * 0.99, cfg)).toBeNull()
  })

  /**
   * 【小隊不可分割】見底的判定在 `stepCommand`（Task 2），這裡收到的是
   * 已經判好的秒數 —— 所以這一條驗的是「規劃不會因為隊裡有健康的人就
   * 拒絕發令」。史實依據見 spec §2.4：編隊的能力等於最弱的那一架。
   */
  it('一架慘三架好，仍然發令', () => {
    const members = [
      unit({ cornerRatio: 0.4 }), unit({ x: 200 }), unit({ x: -250 }), unit({ x: -450 }),
    ]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT, cfg)).not.toBeNull()
  })

  it('沒有敵人 → null（沒有要脫離的對象）', () => {
    expect(planFlightOrder([unit()], [], SPENT, cfg)).toBeNull()
  })

  it('全隊陣亡 → null', () => {
    const members = [unit({ alive: false }), unit({ alive: false })]
    expect(planFlightOrder(members, [unit({ z: 1000 })], SPENT, cfg)).toBeNull()
  })

  it('敵人全陣亡 → null', () => {
    expect(planFlightOrder([unit()], [unit({ z: 1000, alive: false })], SPENT, cfg)).toBeNull()
  })

  it('撤退命令的種類是 rally', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT, cfg)!.kind).toBe('rally')
  })

  /**
   * 【撤退命令不帶戰術欄位】四個欄位是一個聯集的四種投影，`rally` 只用
   * `point` 與 `radius`。留著髒值會讓「這張命令是哪一種」有兩個答案。
   */
  it('撤退命令的戰術欄位是空的', () => {
    const o = planFlightOrder([unit()], [unit({ z: 1000 })], SPENT, cfg)!
    expect(o.targetFlight).toBe(-1)
    expect(o.side).toBe(0)
    expect(o.focusIndex).toBe(-1)
  })
})

describe('planFlightOrder：集合點給得對不對', () => {
  /** 小隊在原點、敵群在 +Z 1000 m 處 */
  const members = [unit(), unit({ x: 200 })]
  const enemies = [unit({ z: 1000 }), unit({ z: 1000, x: 100 })]

  it('真的脫離得了：離最近的敵機超過威脅射程', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    let nearest = Infinity
    for (const e of enemies) nearest = Math.min(nearest, o.point.distanceTo(e.position))
    expect(nearest).toBeGreaterThan(THREAT_RANGE)
  })

  it('往遠離敵群的方向走', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    // 敵群在 +Z，所以集合點該在 −Z
    expect(o.point.z).toBeLessThan(0)
  })

  it('不會叫人穿過敵群：集合點離敵群比現在更遠', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    const foe = new Vector3(0, 4000, 1000)   // 敵群質心
    const own = new Vector3(100, 4000, 0)    // 小隊質心
    expect(o.point.distanceTo(foe)).toBeGreaterThan(own.distanceTo(foe))
  })

  it('真的補得到能量：高於小隊質心', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.y).toBeGreaterThan(4000)
  })

  it('不超過最低的升限', () => {
    const low = [unit({ y: 11900, serviceCeiling: 12000 }), unit({ y: 11900, serviceCeiling: 9000 })]
    const o = planFlightOrder(low, [unit({ y: 11900, z: 1000 })], SPENT, cfg)!
    expect(o.point.y).toBeLessThanOrEqual(9000)
  })

  it('不會叫人撞海：高於 clearanceScale', () => {
    const low = [unit({ y: 50 }), unit({ y: 50, x: 200 })]
    const o = planFlightOrder(low, [unit({ y: 50, z: 1000 })], SPENT, cfg)!
    expect(o.point.y).toBeGreaterThanOrEqual(DEFAULT_STEER.clearanceScale)
  })

  it('半徑是正數', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.radius).toBeGreaterThan(0)
  })
})

describe('planFlightOrder：退化與穩定性', () => {
  /**
   * 【這一條是 spec §7.5 的否決條件之一】敵我質心重合時「遠離敵人」的方向
   * 沒有定義。直接回傳含 NaN 的點會讓所有距離比較都變成 false —— 小隊會
   * 靜靜地永遠飛不到，而且完全不報錯（`stationPoint` 的註解記過同一件事）。
   */
  it('敵我質心重合、速度也為零 → 不產生 NaN，仍給得出點', () => {
    const still = new Vector3(0, 0, 0)
    const members = [unit({ velocity: still })]
    const enemies = [unit({ velocity: still })]
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o).not.toBeNull()
    expect(Number.isNaN(o.point.x + o.point.y + o.point.z)).toBe(false)
  })

  it('敵我質心重合但有速度 → 沿速度方向走', () => {
    const members = [unit({ velocity: new Vector3(0, 0, -200) })]
    const enemies = [unit()]
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.z).toBeLessThan(0)
  })

  /**
   * 【決定性】spec §7.5 的否決條件。模擬是完全決定性的，規劃也必須是 ——
   * 否則同一個態勢會給出不同的命令，任何回歸測試都失去意義。
   */
  it('同一個快照算兩次，逐位元相同', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    const a = planFlightOrder(members, enemies, SPENT, cfg)!
    const b = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(a.point.x).toBe(b.point.x)
    expect(a.point.y).toBe(b.point.y)
    expect(a.point.z).toBe(b.point.z)
  })

  /**
   * 【連續性】spec §7.5 的否決條件。這個專案治過三次「相鄰輸入給出跳躍的
   * 輸出」（`latch` 的遲滯、`extendPitchAngle` 的連續化、破防軸的號誌閂鎖），
   * 每一次的症狀都一樣。集合點若對敵機的微小移動敏感，小隊會被指向來回
   * 擺動的目標。
   *
   * 界限的來源：敵群移動 20 m、而小隊離敵群 1000 m，方向角變化約
   * `atan(20/1000)` = 1.15°，集合點在 `withdrawRange` 上掃過的弧長約
   * `withdrawRange × 0.02`。取兩倍當界限。
   */
  it('敵機位置微擾 ±20 m，集合點的位移有界', () => {
    const members = [unit(), unit({ x: 200 })]
    const base = planFlightOrder(members, [unit({ z: 1000 })], SPENT, cfg)!
    const limit = cfg.withdrawRange * 0.04
    for (const d of [-20, 20]) {
      const moved = planFlightOrder(members, [unit({ z: 1000, x: d })], SPENT, cfg)!
      expect(moved.point.distanceTo(base.point)).toBeLessThan(limit)
    }
  })
})

/** 造一個分隊：成員是 `units` 裡的索引 */
function flight(...idx: number[]): CommandFlight {
  const members = new Int32Array(4).fill(-1)
  idx.forEach((v, i) => { members[i] = v })
  return { members, count: idx.length }
}

const DT = 1 / 240

describe('stepCommand：命令的生命週期', () => {
  /** 兩架的小隊 + 一架敵機，小隊在原點、敵機在 +Z 1000 */
  function scene(cornerRatio: number) {
    const units: CommandUnit[] = [unit({ cornerRatio }), unit({ x: 200, cornerRatio: 1.2 })]
    const enemies: CommandUnit[] = [unit({ z: 1000 })]
    const flights = [flight(0, 1)]
    const s = createCommandState(flights.length)
    return { units, enemies, flights, s }
  }
  /** 推進 `seconds` 秒 */
  function run(sc: ReturnType<typeof scene>, seconds: number, skip = -1) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.units, sc.enemies, skip, DT, cfg)
    }
  }

  it('健康的小隊永遠不發令', () => {
    const sc = scene(1.2)
    run(sc, 30)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【最低的那一架】spec §2.4：編隊的能力等於最弱的那一架。這一條的第二架
   * 是健康的（1.2），命令仍然要發。
   */
  it('最低那一架持續超時 → 發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  it('還沒累積滿就不發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds * 0.5)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('中途回復健康 → 計時歸零，不發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds * 0.9)
    sc.units[0]!.cornerRatio = 1.2
    run(sc, cfg.spentSeconds * 0.9 + cfg.planPeriod + 1)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('被跳過的小隊（玩家那一隊）不發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1, 0)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('全隊陣亡 → 命令清掉、計時歸零', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[0]).not.toBeNull()
    sc.flights[0] = { members: sc.flights[0]!.members, count: 0 }
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
    expect(sc.s.spent[0]).toBe(0)
  })

  it('到達集合點 → 命令解除', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    const order = sc.s.orders[0]!
    // 把整隊瞬移到集合點上
    for (const u of sc.units) u.position.copy(order.point)
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【這一條守著 spec §4.2 的遲滯】解除時把見底計時器歸零，就是遲滯 ——
   * 不需要另外加一個 `latch`。若忘了歸零，抵達的下一格就會立刻重發，小隊
   * 會被永久釘在命令狀態。
   */
  it('到達後不會立刻重發：見底計時歸零', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    const order = sc.s.orders[0]!
    for (const u of sc.units) u.position.copy(order.point)
    // 【剛好一步】見底計時在每一步都先累積、再判到達，所以「歸零」只在
    // 抵達的那一格上成立 —— 下一格這隊仍然是見底的（cornerRatio 0.4），
    // 計時本來就該重新開始累積。多推一步再斷言 `toBe(0)` 量到的是
    // 0.00417（一格的 dt），那是測試的步數錯了，不是實作漏了歸零。
    run(sc, DT)
    expect(sc.s.spent[0]).toBe(0)
    // 再跑一個規劃週期，仍然不該有命令（要重新累積滿 spentSeconds）
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【集合點凍結】spec §4.1。敵人移動不得讓已發出的命令改點 —— 否則小隊
   * 追著一個移動的目標跑，「到達」永遠判定不了。
   */
  it('命令發出後，敵人移動不會改變集合點', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    const before = sc.s.orders[0]!.point.clone()
    sc.enemies[0]!.position.set(5000, 4000, -5000)
    run(sc, cfg.planPeriod * 2)
    expect(sc.s.orders[0]!.point.x).toBe(before.x)
    expect(sc.s.orders[0]!.point.z).toBe(before.z)
  })
})
