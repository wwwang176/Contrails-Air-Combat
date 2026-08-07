import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  planFlightOrder, planFlankOrder, planFocusTarget, createCommandState, stepCommand, rankFlights,
  DEFAULT_COMMAND,
  type CommandUnit, type CommandFlight, type FlightOrder,
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
    shotInstant: over.shotInstant ?? 0,
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
  /**
   * 兩架的小隊 + 一架敵機，小隊在原點朝 −Z、敵機在 +Z 1000（也就是我方
   * **後方**）。
   *
   * 【敵機刻意放在後方】Task 4 之後健康的小隊也會拿到戰術命令，而這個
   * `describe` 驗的是撤退那一條路徑。敵機在後方時：距離 1000 < FLANK_RANGE
   * 所以走集火那一支，而集火的錐形閘門（±60°）擋掉背後的目標 → 回 null。
   * 於是「健康的小隊永遠不發令」仍然成立，而且是**因為規則本身**成立的，
   * 不是因為場景少了一半。
   */
  function scene(cornerRatio: number) {
    const units: CommandUnit[] = [
      unit({ cornerRatio }), unit({ x: 200, cornerRatio: 1.2 }), unit({ z: 1000 }),
    ]
    const flights = [flight(0, 1), flight(2)]
    const s = createCommandState(flights.length)
    // `enemies` 與 `units[2]` 是**同一個物件**，測試改它的位置會生效
    return { units, enemies: [units[2]!], flights, s, own: [0], foe: [1] }
  }
  /** 推進 `seconds` 秒 */
  function run(sc: ReturnType<typeof scene>, seconds: number, skip = -1) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, skip, DT, cfg)
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
    // 【只搬我方】sc.units[2] 是敵機，一起搬過去會讓解除後的下一次規劃
    // 看到「敵機貼在臉上」而發出集火令
    for (const u of [sc.units[0]!, sc.units[1]!]) u.position.copy(order.point)
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
    // 【只搬我方】sc.units[2] 是敵機，一起搬過去會讓解除後的下一次規劃
    // 看到「敵機貼在臉上」而發出集火令
    for (const u of [sc.units[0]!, sc.units[1]!]) u.position.copy(order.point)
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

  /**
   * 【閒置計時】spec §4.3。`shotInstant` 是瞬時的，而分隊在一次大彎途中
   * 會短暫失去射擊解 —— 直接讀瞬時值會把「正在纏鬥」誤判成「閒」。所以
   * 累積一個計時器，與既有的 `spent` 逐字同一個形狀。
   */
  it('沒有人握著射擊解 → idle 累積', () => {
    const sc = scene(1.2)
    run(sc, 5)
    expect(sc.s.idle[0]).toBeGreaterThan(4.9)
  })

  it('有人握著射擊解 → idle 歸零', () => {
    const sc = scene(1.2)
    run(sc, 5)
    sc.units[1]!.shotInstant = 0.5
    run(sc, DT)
    expect(sc.s.idle[0]).toBe(0)
  })

  /**
   * 【只要有一架握著就算不閒】小隊是一個單位（spec §2.4 的同一條推理）。
   * 這一條的第一架是閒的，計時仍然要歸零。
   */
  it('隊裡只要一架握著射擊解就不算閒', () => {
    const sc = scene(1.2)
    run(sc, 5)
    sc.units[0]!.shotInstant = 0
    sc.units[1]!.shotInstant = 0.2
    run(sc, DT)
    expect(sc.s.idle[0]).toBe(0)
  })

  it('全滅的分隊 → idle 歸零', () => {
    const sc = scene(1.2)
    run(sc, 5)
    sc.flights[0] = { members: sc.flights[0]!.members, count: 0 }
    run(sc, DT * 2)
    expect(sc.s.idle[0]).toBe(0)
  })
})

/**
 * 側翼的標準場景：目標分隊在 +Z 3000 處、朝 −Z 飛（也就是朝我們飛過來），
 * 而且正在交戰（cornerRatio 低）。我方在原點。
 */
function foeFlight(over: { x?: number; engaged?: boolean } = {}): CommandUnit[] {
  const cr = over.engaged === false ? 1.2 : 0.8
  return [
    unit({ x: over.x ?? 0, z: 3000, cornerRatio: cr }),
    unit({ x: (over.x ?? 0) + 200, z: 3000, cornerRatio: cr }),
  ]
}

describe('planFlankOrder：該不該下令', () => {
  it('目標分隊在交戰 → 有命令，種類是 flank', () => {
    const o = planFlankOrder([unit(), unit({ x: 200 })], foeFlight(), [], 3, cfg)
    expect(o).not.toBeNull()
    expect(o!.kind).toBe('flank')
    expect(o!.targetFlight).toBe(3)
  })

  /**
   * 【spec §3.1】少了這道閘門，開場五個分隊對五個分隊全都健康又全都很遠，
   * 所有人同時側翼 —— 而側翼途中不交戰，開局會變成兩隊互相繞圈一槍不開，
   * 而且會自我維持（雙方都在繞，「已經接戰」永遠不成立）。
   */
  it('目標分隊沒在交戰 → null', () => {
    expect(planFlankOrder([unit()], foeFlight({ engaged: false }), [], 3, cfg)).toBeNull()
  })

  it('我方全滅 → null', () => {
    const dead = [unit({ alive: false })]
    expect(planFlankOrder(dead, foeFlight(), [], 3, cfg)).toBeNull()
  })

  it('目標分隊全滅 → null', () => {
    const dead = [unit({ z: 3000, alive: false })]
    expect(planFlankOrder([unit()], dead, [], 3, cfg)).toBeNull()
  })
})

describe('planFlankOrder：點放得對不對', () => {
  const members = [unit(), unit({ x: 200 })]

  /**
   * 目標朝 −Z 飛，所以「後方」是 +Z 方向。側翼點的 Z 要**大於**目標質心，
   * 距離約 flankTrail。
   */
  it('點在目標分隊的後方', () => {
    const o = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    expect(o.point.z).toBeGreaterThan(3000)
    expect(o.point.z - 3000).toBeCloseTo(cfg.flankTrail, 6)
  })

  it('橫向偏置約等於 flankOffset', () => {
    const o = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    // 目標航向是 −Z，右手側是 −X（驗算：u=(0,0,−1)，r=(−u.z,0,u.x)=(1,0,0)…
    // 見實作的註解）。這裡只驗大小，方向由下面的「就近」那兩條驗
    expect(Math.abs(o.point.x - 100)).toBeCloseTo(cfg.flankOffset, 6)
  })

  it('比目標分隊高 flankClimb', () => {
    const o = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    expect(o.point.y).toBeCloseTo(4000 + cfg.flankClimb, 6)
  })

  /** 【就近】沒有其他敵機時兩邊一樣安全，取轉場最短的那一邊 */
  it('我方在目標的左邊 → 點也在左邊', () => {
    const left = [unit({ x: -2000 }), unit({ x: -1800 })]
    const o = planFlankOrder(left, foeFlight(), [], 3, cfg)!
    expect(o.point.x).toBeLessThan(0)
  })

  it('我方在目標的右邊 → 點也在右邊', () => {
    const right = [unit({ x: 2000 }), unit({ x: 1800 })]
    const o = planFlankOrder(right, foeFlight(), [], 3, cfg)!
    expect(o.point.x).toBeGreaterThan(0)
  })

  /**
   * 【危險評估壓過就近】專案負責人 2026-08-07 追加的要求：側翼點有可能正好
   * 落在另一場交火中間。
   */
  it('就近的那一邊塞滿其他敵機 → 改走另一邊', () => {
    const left = [unit({ x: -2000 }), unit({ x: -1800 })]
    const safe = planFlankOrder(left, foeFlight(), [], 3, cfg)!
    // 把三架敵機堆在剛才選中的那個點上
    const others = [
      unit({ x: safe.point.x, y: safe.point.y, z: safe.point.z }),
      unit({ x: safe.point.x + 50, y: safe.point.y, z: safe.point.z }),
      unit({ x: safe.point.x - 50, y: safe.point.y, z: safe.point.z }),
    ]
    const moved = planFlankOrder(left, foeFlight(), others, 3, cfg)!
    expect(Math.sign(moved.point.x - 100)).toBe(-Math.sign(safe.point.x - 100))
  })

  it('兩邊都塞滿其他敵機 → null', () => {
    const a = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    const mirrorX = 200 - a.point.x   // 以目標質心 x=100 鏡射
    const others: CommandUnit[] = []
    for (const x of [a.point.x, mirrorX]) {
      for (const d of [-50, 0, 50]) {
        others.push(unit({ x: x + d, y: a.point.y, z: a.point.z }))
      }
    }
    expect(planFlankOrder(members, foeFlight(), others, 3, cfg)).toBeNull()
  })

  it('不會叫人撞海：高於 clearanceScale', () => {
    const low = [unit({ y: 50 })]
    const foe = [unit({ y: 50, z: 3000, cornerRatio: 0.8 })]
    const o = planFlankOrder(low, foe, [], 3, cfg)!
    expect(o.point.y).toBeGreaterThanOrEqual(DEFAULT_STEER.clearanceScale)
  })

  /** 高度上界取**我方**的最低升限：要飛上去的是我們，不是他們 */
  it('不超過我方的最低升限', () => {
    const high = [
      unit({ y: 11900, serviceCeiling: 12000 }),
      unit({ y: 11900, serviceCeiling: 9000 }),
    ]
    const foe = [unit({ y: 11900, z: 3000, cornerRatio: 0.8 })]
    const o = planFlankOrder(high, foe, [], 3, cfg)!
    expect(o.point.y).toBeLessThanOrEqual(9000)
  })
})

describe('planFlankOrder：退化與穩定性', () => {
  const members = [unit(), unit({ x: 200 })]

  /**
   * 【敵分隊速度退化】`CommandUnit` **沒有 orientation**，所以沒有「機首」
   * 可以退回去 —— 退化階梯改成「由我方指向他們」（把他們當成正在遠離我們）。
   * 那讓點落在我們與他們之間，可及而且安全。
   */
  it('敵分隊速度為零 → 不產生 NaN，仍給得出點', () => {
    const still = [unit({ z: 3000, cornerRatio: 0.8, velocity: new Vector3(0, 0, 0) })]
    const o = planFlankOrder(members, still, [], 3, cfg)!
    expect(Number.isNaN(o.point.x + o.point.y + o.point.z)).toBe(false)
  })

  it('敵分隊速度為零且與我方質心重合 → 仍不產生 NaN', () => {
    const still = [unit({ x: 100, cornerRatio: 0.8, velocity: new Vector3(0, 0, 0) })]
    const o = planFlankOrder(members, still, [], 3, cfg)!
    expect(Number.isNaN(o.point.x + o.point.y + o.point.z)).toBe(false)
  })

  /** 【決定性】spec §7.5 的否決條件 */
  it('同一個快照算兩次，逐位元相同', () => {
    const a = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    const b = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    expect(a.point.x).toBe(b.point.x)
    expect(a.point.y).toBe(b.point.y)
    expect(a.point.z).toBe(b.point.z)
    expect(a.side).toBe(b.side)
  })

  /**
   * 【連續性】spec §7.5 的否決條件。
   *
   * 【為什麼微擾的是目標分隊而不是「其他敵機」】選邊是一個**離散**決定，
   * 而其他敵機的微擾在兩邊危險分數相近時會翻邊，位移就是 2×flankOffset。
   * 那個不連續是**刻意的而且被封住了**：`side` 發令後凍結（spec §4.2），
   * 所以翻邊只可能發生在「還沒發令」的那一刻，不會傳到飛行中的飛機身上。
   * 這一條驗的是**給定一邊之後**，點對目標移動的連續性。
   *
   * 【為什麼我方擺在 x≈−1900 而不是與目標重合】沒有其他敵機時兩邊一樣安全，
   * 選邊退回「就近」；而 `members`（質心 x=100）與目標質心（x=100）重合時
   * 兩個候選點**恰好等距**，選邊落在 tie-break 的分界線上，目標往任一邊移
   * 20 m 就翻邊。那是在階梯函數的階梯上量連續性 —— 場景本身病態，不是實作
   * 不連續。把我方擺到明確的左邊，±20 m 就跨不過分界。
   */
  it('目標分隊位置微擾 ±20 m，側翼點的位移有界', () => {
    const members = [unit({ x: -2000 }), unit({ x: -1800 })]
    const base = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    for (const d of [-20, 20]) {
      const moved = planFlankOrder(members, foeFlight({ x: d }), [], 3, cfg)!
      expect(moved.side).toBe(base.side)
      expect(moved.point.distanceTo(base.point)).toBeLessThan(60)
    }
  })

  /**
   * 【危險分數連續】用平方反比核而不是「半徑內的計數」。計數需要一個半徑
   * 門檻，而門檻會讓分數在邊界上跳 —— 與 `targetScore` 的三個折扣項、
   * `floorPitchAngle` 的連續斜坡同一條紀律。
   *
   * 驗法：把一架敵機從很遠慢慢移近選中的點，選邊不得在中途翻轉超過一次。
   * 翻轉超過一次代表分數不是單調的，那只可能來自不連續。
   */
  it('單一敵機從遠處逼近時，選邊最多翻轉一次', () => {
    const base = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    let flips = 0
    let prev = base.side
    for (let z = 6000; z >= base.point.z; z -= 100) {
      const others = [unit({ x: base.point.x, y: base.point.y, z })]
      const o = planFlankOrder(members, foeFlight(), others, 3, cfg)!
      if (o.side !== prev) flips++
      prev = o.side
    }
    expect(flips).toBeLessThanOrEqual(1)
  })
})

describe('stepCommand：側翼與集火的生命週期', () => {
  /**
   * 我方分隊 0（兩架，在原點朝 −Z）、敵分隊 1（兩架）。
   * `units` 的索引：0/1 = 我方，2/3 = 敵方。
   */
  function scene(foeZ: number, foeEngaged = true) {
    const cr = foeEngaged ? 0.8 : 1.2
    const units: CommandUnit[] = [
      unit({ cornerRatio: 1.2 }),
      unit({ x: 200, cornerRatio: 1.2 }),
      unit({ z: foeZ, cornerRatio: cr }),
      unit({ x: 200, z: foeZ, cornerRatio: cr }),
    ]
    const flights = [flight(0, 1), flight(2, 3)]
    const s = createCommandState(flights.length)
    return { units, flights, s, own: [0], foe: [1] }
  }
  function run(sc: ReturnType<typeof scene>, seconds: number, skip = -1) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, skip, DT, cfg)
    }
  }

  /**
   * 【側翼已停用】spec §12：時間對齊的實測顯示它讓開火方位角變差，而且
   * 八組參數都救不回來。`FLANK_ENABLED` 為 false，所以遠距離不再發令。
   *
   * 這一條**刻意留著並反過來斷言**，而不是刪掉 —— 它是「觸發階梯現在
   * 長什麼樣」的紀錄。第三份重新打開時改回來。
   */
  it('健康的小隊、敵分隊在交戰且很遠 → 不發令（側翼已停用）', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 下面三條驗的是**側翼命令的維護**（點每步重算、幾何到位判定），與
   * 「觸發階梯會不會選它」是兩件事（spec §2 的紀律）。所以它們直接把
   * 命令注入進去，不依賴觸發 —— 停用觸發之後這三條照樣有意義。
   */
  function injectFlank(sc: ReturnType<typeof scene>): void {
    const members = [sc.units[0]!, sc.units[1]!]
    const target = [sc.units[2]!, sc.units[3]!]
    sc.s.orders[0] = planFlankOrder(members, target, [], 1, cfg)
    expect(sc.s.orders[0]).not.toBeNull()
  }

  it('健康的小隊、敵分隊很近 → 集火', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]!.kind).toBe('focus')
    // 兩架敵機血量相同，取近的 —— 索引 2 與 3 等距，取先掃到的 2
    expect(sc.s.orders[0]!.focusIndex).toBe(2)
  })

  /**
   * 【撤退優先於兩個新戰術】spec §3。打不動的小隊不該被派去執行任何進攻
   * 戰術。這一條若紅了，代表規劃的順序寫反了。
   */
  it('見底的小隊拿到的是 rally 而不是 flank', () => {
    const sc = scene(4000)
    for (const i of [0, 1]) sc.units[i]!.cornerRatio = 0.4
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[0]!.kind).toBe('rally')
  })

  /** 【凍結的是決定，不是座標】spec §4.2 */
  it('側翼的 point 跟著敵分隊移動，side 與 targetFlight 不變', () => {
    const sc = scene(4000)
    injectFlank(sc)
    const o = sc.s.orders[0]!
    const before = o.point.clone()
    const side = o.side
    for (const i of [2, 3]) sc.units[i]!.position.x += 1500
    run(sc, DT * 2)
    expect(sc.s.orders[0]!.point.x).not.toBe(before.x)
    expect(sc.s.orders[0]!.side).toBe(side)
    expect(sc.s.orders[0]!.targetFlight).toBe(1)
  })

  /**
   * 【側翼的到達是幾何判定】進入後側方扇區且距離進入 FLANK_RANGE。
   * 把我方瞬移到敵分隊的正後方 1000 m 處 —— 敵方朝 −Z 飛，正後方是 +Z。
   */
  it('進入後側方扇區且夠近 → 側翼命令解除', () => {
    const sc = scene(4000)
    injectFlank(sc)
    for (const i of [0, 1]) sc.units[i]!.position.set(100, 4000, 5000)
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  /** 【還在正面就不算到達】同樣的距離，但在他們前方 */
  it('距離夠近但在敵分隊正前方 → 側翼命令不解除', () => {
    const sc = scene(4000)
    injectFlank(sc)
    for (const i of [0, 1]) sc.units[i]!.position.set(100, 4000, 3000)
    run(sc, DT * 2)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  it('集火目標陣亡 → 命令解除', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    const idx = sc.s.orders[0]!.focusIndex
    sc.units[idx]!.alive = false
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【集火的遲滯】發令要求離小隊質心不到 `focusRange`（1500），解除要求
   * 超過 `FLANK_RANGE`（2500）—— 兩個不同的數字就是遲滯。用同一個門檻
   * 發令與解除會在邊界上抖。
   */
  it('集火目標跑遠 → 命令解除', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    for (const i of [2, 3]) sc.units[i]!.position.z = -4000
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('集火目標只跑到 focusRange 與 FLANK_RANGE 之間 → 命令不解除', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    for (const i of [2, 3]) sc.units[i]!.position.z = -2000
    run(sc, DT * 2)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  /** 【不替敵方分隊規劃】`own` 以外的格子必須恆為 null */
  it('own 以外的分隊完全不碰', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod * 3)
    expect(sc.s.orders[1]).toBeNull()
  })
})

describe('planFocusTarget', () => {
  /** 我方在原點朝 −Z 飛。候選敵機放在 −Z 方向（也就是航向上） */
  const members = [unit(), unit({ x: 200 })]
  /** 候選在 `units` 裡的全域索引，與 candidates 平行 */
  const IDX = [10, 11]

  it('兩架等距、一架受創 → 挑受創的', () => {
    const cands = [
      unit({ x: -300, z: -800, hpFraction: 1 }),
      unit({ x: 500, z: -800, hpFraction: 0.3 }),
    ]
    const o = planFocusTarget(members, cands, IDX, cfg)!
    expect(o.kind).toBe('focus')
    expect(o.focusIndex).toBe(11)
  })

  /** 【血量同值時的破平手】近的先打 —— 追得到的機會大 */
  it('兩架血量相同 → 挑近的', () => {
    const cands = [
      unit({ z: -1200, hpFraction: 0.5 }),
      unit({ z: -400, hpFraction: 0.5 }),
    ]
    expect(planFocusTarget(members, cands, IDX, cfg)!.focusIndex).toBe(11)
  })

  it('唯一的敵機在 focusRange 外 → null', () => {
    const far = [unit({ z: -(cfg.focusRange + 500) })]
    expect(planFocusTarget(members, far, [10], cfg)).toBeNull()
  })

  /**
   * 【可及性用夾角而不是 turnTime】`assess.ts` 的 `turnTime` 吃兩架
   * `Aircraft`，而規劃層只吃快照 —— 收 `Aircraft` 會毀掉「能直接餵字面
   * 物件出考題」這個性質（spec §5.2）。夾角不是它的近似，是另一個問題的
   * 精確答案：「這架敵機在不在我們正在去的方向上」。
   */
  it('在射程內但偏離航向超過 focusCone → null', () => {
    // 我方朝 −Z，這一架在正右方（夾角 90° > 60°）
    const side = [unit({ x: 800, z: 0 })]
    expect(planFocusTarget(members, side, [10], cfg)).toBeNull()
  })

  /**
   * 【可及性是閘門不是加權項】一個追不到的目標再好打也沒用。這一條若寫成
   * 「受創程度與可及性加權」就會挑錯 —— 而那正是最容易寫成的形狀。
   */
  it('受創但不可及、健康但可及 → 挑健康那架', () => {
    const cands = [
      unit({ x: 3000, z: 0, hpFraction: 0.1 }),   // 重傷但在正右方且很遠
      unit({ z: -600, hpFraction: 1 }),           // 毫髮無傷但在航向上
    ]
    expect(planFocusTarget(members, cands, IDX, cfg)!.focusIndex).toBe(11)
  })

  it('全部陣亡 → null', () => {
    const dead = [unit({ z: -600, alive: false })]
    expect(planFocusTarget(members, dead, [10], cfg)).toBeNull()
  })

  it('我方全滅 → null', () => {
    const gone = [unit({ alive: false })]
    expect(planFocusTarget(gone, [unit({ z: -600 })], [10], cfg)).toBeNull()
  })

  /** 【決定性】spec §7.5 的否決條件 */
  it('同一個快照算兩次，回同一個索引', () => {
    const cands = [unit({ z: -600, hpFraction: 0.4 }), unit({ z: -700, hpFraction: 0.4 })]
    const a = planFocusTarget(members, cands, IDX, cfg)!
    const b = planFocusTarget(members, cands, IDX, cfg)!
    expect(a.focusIndex).toBe(b.focusIndex)
  })

  /**
   * 【我方速度退化時錐形閘門要放行】沒有速度就沒有「我們正在去的方向」，
   * 這時把所有人都擋掉會讓集火在起飛瞬間與重生瞬間靜靜地失效。
   */
  it('我方速度為零 → 錐形閘門放行，仍挑得出目標', () => {
    const still = [unit({ velocity: new Vector3(0, 0, 0) })]
    const cands = [unit({ x: 800, z: 0, hpFraction: 0.3 })]
    expect(planFocusTarget(still, cands, [10], cfg)!.focusIndex).toBe(10)
  })
})

describe('rankFlights', () => {
  /** 四個分隊，每隊一架。`units` 的索引與分隊索引相同 */
  function scene() {
    const units: CommandUnit[] = [unit(), unit(), unit(), unit()]
    const flights = [flight(0), flight(1), flight(2), flight(3)]
    const orders: (FlightOrder | null)[] = [null, null, null, null]
    const idle = new Float32Array([10, 30, 20, 5])
    return { units, flights, orders, idle, own: [0, 1, 2, 3] }
  }
  const OUT: number[] = []

  it('閒最久的排第一', () => {
    const sc = scene()
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    // idle = [10, 30, 20, 5]，門檻 3 → 四個都合格，由大到小是 1, 2, 0, 3
    expect(OUT).toEqual([1, 2, 0, 3])
  })

  /**
   * 【決定性】spec §7.4 的否決條件。同值不能靠 sort 的實作細節決定順序 ——
   * 那會讓同一個態勢在不同引擎上給出不同的命令。
   */
  it('同 idle 值 → 以分隊索引由小到大破平手', () => {
    const sc = scene()
    sc.idle = new Float32Array([7, 7, 7, 7])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([0, 1, 2, 3])
  })

  it('idle 沒到門檻的不進榜', () => {
    const sc = scene()
    // 門檻是 cfg.idleSeconds = 3；只有索引 3 的 2.9 不到
    sc.idle = new Float32Array([10, 30, 20, 2.9])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([1, 2, 0])
  })

  /** 【已持有命令的不進榜】不論哪一種命令 —— 遲滯就是這樣免費來的 */
  it('已持有命令的不進榜', () => {
    const sc = scene()
    sc.orders[1] = {
      kind: 'rally', point: new Vector3(), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
    sc.orders[2] = {
      kind: 'focus', point: new Vector3(), radius: 0,
      targetFlight: -1, side: 0, focusIndex: 9,
    }
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([0, 3])
  })

  it('全滅的分隊不進榜', () => {
    const sc = scene()
    sc.flights[1] = { members: sc.flights[1]!.members, count: 0 }
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([2, 0, 3])
  })

  /** 【成員全部陣亡但 count 還沒壓縮】同一步裡 compactFlights 還沒跑過 */
  it('成員全部陣亡的分隊不進榜', () => {
    const sc = scene()
    sc.units[1] = unit({ alive: false })
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([2, 0, 3])
  })

  it('玩家那一隊不進榜', () => {
    const sc = scene()
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, 1, OUT, cfg)
    expect(OUT).toEqual([2, 0, 3])
  })

  it('全部不合格 → 回空', () => {
    const sc = scene()
    sc.idle = new Float32Array([0, 0, 0, 0])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([])
  })

  /**
   * 【連續性】spec §7.4 的否決條件。排名本身是離散的，所以問的不是「輸出
   * 連不連續」，而是**微擾只會讓相鄰兩名互換**。若一次微擾能讓整個順序
   * 翻轉，那代表分數不是單調的。
   */
  it('idle 微擾 ±0.1 s 只會讓相鄰兩名互換', () => {
    const sc = scene()
    // 把第 2 名（索引 2，idle 20）推過第 1 名（索引 1，idle 30）需要 10 秒，
    // 微擾 0.1 動不了任何一對；把索引 0（10）與索引 2（20）之間拉近到
    // 0.05 之後，0.1 的微擾剛好只換那一對
    sc.idle = new Float32Array([19.95, 30, 20, 5])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([1, 2, 0, 3])
    sc.idle = new Float32Array([20.05, 30, 20, 5])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([1, 0, 2, 3])
  })

  /** 【決定性】同一個輸入算兩次，逐位元相同 */
  it('同一個快照算兩次，順序相同', () => {
    const sc = scene()
    const a: number[] = []
    const b: number[] = []
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, a, cfg)
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, b, cfg)
    expect(a).toEqual(b)
  })
})
