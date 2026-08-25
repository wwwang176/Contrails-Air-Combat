import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { AiController, AI_DECISION_HZ } from '../../src/ai/AiController'
import { createTargetBoard, type TargetCandidate } from '../../src/ai/target'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import { ACE, VETERAN } from '../../src/ai/profile'
import { MAX_REACTION_DELAY } from '../../src/ai/delay'
import { INTENTS } from '../../src/ai/rules'
import { rallyAim } from '../../src/ai/rally'
import type { FlightOrder } from '../../src/ai/command'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const DT = 1 / 240

describe('DifficultyProfile', () => {
  it('M4 交付的是天花板：零延遲、零瞄準誤差', () => {
    // 【為什麼先做最強再往下調】不可能從一個沒量過的天花板往下調難度。
    // M5 起以此為基準把 AI 調鈍（spec §10）。
    expect(ACE.reactionDelay).toBe(0)
    expect(ACE.aimError).toBe(0)
  })

  it('遊戲預設的敵人有反應延遲，而且在緩衝區的容量之內', () => {
    // 【為什麼把「有延遲」釘住】ACE 是 `DEFAULT_BATTLE` 的設定，也是全部
    // AI 測試的基準；VETERAN 只在 `battleConfigFrom` 走的那條路上生效。
    // 沒有這一條的話，有人把它改回 0 不會有任何測試變紅（見 profile.ts
    // 的掃描表）。
    expect(VETERAN.reactionDelay).toBeGreaterThan(0)
    expect(VETERAN.reactionDelay).toBeLessThanOrEqual(MAX_REACTION_DELAY)
  })
})

describe('AiController', () => {
  const cmd = createCommand()

  /**
   * 【兩架都要先跑一步】`Aircraft` 的建構子**不填 `diag`** —— 它只在
   * `update` 裡由 `stepDynamics` 填。沒跑過的飛機 `diag.aero.tas` 是 0，
   * 於是 `speedMargin` 讀成 0，`geometryGate` 永遠回 `speedRecover`，
   * 瞄準點就不再跟著目標動。那是 fixture 不物理，不是被測行為出錯。
   */
  const pair = () => {
    const self = new Aircraft(BF109K4, 4000, 180)
    const target = new Aircraft(P51D, 4000, 180)
    self.update(new Vector3(0, 0, -1), 0.7, DT)
    target.update(new Vector3(0, 0, -1), 0.7, DT)
    self.state.position.set(0, 4000, 0)
    target.state.position.set(0, 4000, -600)
    target.prevPosition.copy(target.state.position)
    const ai = new AiController()
    ai.target = target
    return { self, target, ai }
  }

  it('沒有目標時輸出安全的預設值（維持機首方向平飛）', () => {
    const self = new Aircraft(BF109K4, 4000, 180)
    const ai = new AiController()
    ai.update(self, DT, cmd)
    expect(cmd.aimWorld.length()).toBeCloseTo(1, 9)
    expect(cmd.firing).toBe(false)
  })

  it('有目標時 aimWorld 恆為單位向量', () => {
    const { self, ai } = pair()
    for (let i = 0; i < 240; i++) {
      ai.update(self, DT, cmd)
      expect(cmd.aimWorld.length()).toBeCloseTo(1, 9)
    }
  })

  it('意圖恆為五種之一', () => {
    const { self, ai } = pair()
    for (let i = 0; i < 240; i++) {
      ai.update(self, DT, cmd)
      expect(INTENTS).toContain(ai.intent)
    }
  })

  /**
   * 【為什麼意圖是 10 Hz 而轉向是 240 Hz】包絡查詢是唯一貴的東西
   * （sustainedTurnRate 是 50 次二分搜尋），而戰術意圖不需要每 4 ms 重想。
   * 但瞄準點必須每步更新——只有 10 Hz 的話瞄準點落後 100 ms，300 m/s 下
   * 就是 30 m，那是打不中的量級。
   */
  it('瞄準點每個物理步都更新，不是每 10 Hz 才動一次', () => {
    const { self, target, ai } = pair()
    ai.update(self, DT, cmd)
    const first = cmd.aimWorld.clone()

    // 只推進目標一步（遠小於 10 Hz 的週期）
    target.state.position.x += 5
    ai.update(self, DT, cmd)
    expect(cmd.aimWorld.equals(first)).toBe(false)
  })

  it('意圖在 10 Hz 的週期內不變', () => {
    const { self, ai } = pair()
    ai.update(self, DT, cmd)
    const intent = ai.intent
    const stepsPerDecision = Math.floor(240 / AI_DECISION_HZ)
    for (let i = 0; i < stepsPerDecision - 2; i++) {
      ai.update(self, DT, cmd)
      expect(ai.intent).toBe(intent)
    }
  })

  it('低空俯衝時安全層介入並標記', () => {
    const { self, ai } = pair()
    self.state.position.set(0, 150, 0)
    self.state.velocity.set(0, -200, -100)
    ai.update(self, DT, cmd)
    expect(ai.safetyActive).toBe(true)
    expect(cmd.aimWorld.y).toBeGreaterThan(0)
    expect(cmd.firing).toBe(false)
  })

  it('巡航高度不觸發安全層', () => {
    const { self, ai } = pair()
    for (let i = 0; i < 240; i++) ai.update(self, DT, cmd)
    expect(ai.safetyActive).toBe(false)
  })

  it('跟蹤計時器：離開射擊錐後歸零', () => {
    const { self, target, ai } = pair()
    // 【目標必須放在自機「後方」】計時器累積的是 `threatInstant`，也就是
    // **他打得到我**的程度。把目標放在前方（我咬他）時他的機首背對我，
    // threatInstant 恆為 0，計時器一步都不會走。
    target.state.position.set(0, 4000, 300)
    target.state.velocity.set(0, 0, -180)
    self.state.velocity.set(0, 0, -180)
    for (let i = 0; i < 240; i++) ai.update(self, DT, cmd)
    const tracked = ai.trackingSeconds
    expect(tracked).toBeGreaterThan(0)

    // 目標瞬移到遠處
    target.state.position.set(0, 4000, 5000)
    ai.update(self, DT, cmd)
    expect(ai.trackingSeconds).toBe(0)
  })

  it('連續三十秒不產生 NaN', () => {
    const { self, target, ai } = pair()
    for (let i = 0; i < 240 * 30; i++) {
      ai.update(self, DT, cmd)
      self.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake)
      target.update(new Vector3(0, 0, -1), 0.7, DT)
      if (self.state.position.y < 100) self.state.position.y = 4000
    }
    expect(Number.isFinite(self.state.position.length())).toBe(true)
    expect(Number.isFinite(cmd.aimWorld.length())).toBe(true)
  })
})

const UP = new Vector3(0, 1, 0)

/** 把飛機擺在 (x, y, z)，機首繞 Y 軸轉 yaw 弧度（0 = 朝 −Z）。 */
function at(x: number, y: number, z: number, yaw = 0): Aircraft {
  const a = new Aircraft(P51D, y, 200)
  a.state.position.set(x, y, z)
  a.prevPosition.copy(a.state.position)
  a.state.orientation.copy(new Quaternion().setFromAxisAngle(UP, yaw))
  return a
}

/** 藍 0、紅 1（近）、紅 2（遠）。 */
function trio(): { cs: TargetCandidate[]; board: ReturnType<typeof createTargetBoard> } {
  const cs: TargetCandidate[] = [
    { index: 0, team: 'blue', alive: true, aircraft: at(0, 4000, 0) },
    { index: 1, team: 'red', alive: true, aircraft: at(0, 4000, -300) },
    { index: 2, team: 'red', alive: true, aircraft: at(0, 4000, -3000) },
  ]
  return { cs, board: createTargetBoard(cs) }
}

describe('AiController 的目標選擇', () => {
  it('board 為 null 時完全不碰 target（M4 行為）', () => {
    const c = new AiController()
    const self = at(0, 4000, 0)
    const enemy = at(0, 4000, -400)
    c.target = enemy
    c.update(self, DT, createCommand())
    expect(c.target).toBe(enemy)
  })

  it('board 設定之後會自己挑目標', () => {
    const { cs, board } = trio()
    const c = new AiController()
    c.board = board
    c.selfIndex = 0
    c.update(cs[0]!.aircraft, DT, createCommand())
    expect(c.target).toBe(cs[1]!.aircraft)
  })

  it('目標退場後下一個決策節拍就換人', () => {
    const { cs, board } = trio()
    const c = new AiController()
    c.board = board
    c.selfIndex = 0
    const out = createCommand()
    c.update(cs[0]!.aircraft, DT, out)
    expect(c.target).toBe(cs[1]!.aircraft)
    cs[1]!.alive = false
    // 推進超過一個決策週期
    for (let i = 0; i < Math.ceil(240 / AI_DECISION_HZ) + 1; i++) {
      c.update(cs[0]!.aircraft, DT, out)
    }
    expect(c.target).toBe(cs[2]!.aircraft)
  })
})

describe('AiController 的決策相位', () => {
  it('相位 0 與相位 0.5 的實例不在同一步做決策', () => {
    const self = at(0, 4000, 0)
    const enemy = at(0, 4000, -400)
    const a = new AiController()
    const b = new AiController()
    a.target = enemy
    b.target = enemy
    a.setDecisionPhase(0)
    b.setDecisionPhase(0.5)

    const stepsPerPeriod = 240 / AI_DECISION_HZ
    const outA = createCommand()
    const outB = createCommand()
    let aStep = -1
    let bStep = -1
    for (let i = 0; i < stepsPerPeriod; i++) {
      const beforeA = a.decisionsMade
      const beforeB = b.decisionsMade
      a.update(self, DT, outA)
      b.update(self, DT, outB)
      if (a.decisionsMade > beforeA && aStep < 0) aStep = i
      if (b.decisionsMade > beforeB && bStep < 0) bStep = i
    }
    expect(aStep).toBeGreaterThanOrEqual(0)
    expect(bStep).toBeGreaterThanOrEqual(0)
    expect(aStep).not.toBe(bStep)
  })

  it('相位不改變頻率——一秒仍然是 AI_DECISION_HZ 次', () => {
    const self = at(0, 4000, 0)
    const c = new AiController()
    c.target = at(0, 4000, -400)
    c.setDecisionPhase(0.37)
    const out = createCommand()
    for (let i = 0; i < 240; i++) c.update(self, DT, out)
    expect(c.decisionsMade).toBe(AI_DECISION_HZ)
  })
})

describe('站位角色（M6 spec §3.2）', () => {
  /** 造一架擺在指定位置、平飛朝 −Z 的 P-51D。 */
  function craft(x: number, y: number, z: number): Aircraft {
    const a = new Aircraft(P51D, y, 200)
    a.state.position.set(x, y, z)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.identity()
    return a
  }

  it('沒有 stationReference 時完全是 M5 的行為 —— 沒有目標就維持機首平飛', () => {
    const ai = new AiController()
    const self = craft(0, 4000, 0)
    const out = createCommand()
    ai.update(self, 1 / 240, out)
    const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
    expect(out.aimWorld.dot(nose)).toBeCloseTo(1, 6)
    expect(out.throttle).toBeCloseTo(0.7, 6)
    expect(ai.stationError).toBe(0)
  })

  it('有 stationReference 且沒有目標時，飛向站位', () => {
    const lead = craft(0, 4000, 0)
    // 自己擺在長機正上方，站位在長機右後方 —— 瞄準方向必須偏向 +X 且向下
    const self = craft(0, 4000, 0)
    const ai = new AiController()
    ai.stationReference = lead
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(self, 1 / 240, out)
    expect(out.aimWorld.x).toBeGreaterThan(0.8)
    expect(out.firing).toBe(false)
  })

  it('站位誤差在決策節拍更新', () => {
    const lead = craft(0, 4000, 0)
    const self = craft(0, 4000, 0)
    const ai = new AiController()
    ai.stationReference = lead
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(self, 1 / 240, out)

    const station = new Vector3()
    stationPoint(lead, STATION_OFFSETS[1]!, 0, station)
    expect(ai.stationError).toBeCloseTo(station.distanceTo(self.state.position), 6)
  })

  it('安全層仍然覆寫站位指令 —— 站位控制器不是它的例外', () => {
    // 【為什麼一定要測】站位控制器是新的一條寫滿整個 Command 的路徑。
    // 忘了在它後面套 applySafety 的話，歸隊中的僚機會直直飛進海裡，而
    // 那個症狀（幾架飛機無聲消失）離成因很遠。
    const lead = craft(0, 30, 0)
    const self = craft(0, 30, 0)
    self.state.velocity.set(0, -150, -120)
    const ai = new AiController()
    ai.stationReference = lead
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(self, 1 / 240, out)
    expect(ai.safetyActive).toBe(true)
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  it('有 stationReference 時走僚機的目標選擇，不是 selectTarget', () => {
    // 僚機準則下，10 km 外的敵機不會被選中（三級都被 THREAT_RANGE 界住）；
    // 自由獵手的 selectTarget 則會選它。用這個差異分辨走了哪一條路。
    const lead = craft(0, 4000, 0)
    const wing = craft(200, 4000, 60)
    const enemy = craft(0, 4000, -10000)
    const board = createTargetBoard([
      { index: 0, aircraft: lead, team: 'blue', alive: true },
      { index: 1, aircraft: wing, team: 'blue', alive: true },
      { index: 2, aircraft: enemy, team: 'red', alive: true },
    ])
    board.assignments[0] = 2      // 長機已經鎖定 10 km 外的敵機

    const ai = new AiController()
    ai.board = board
    ai.selfIndex = 1
    ai.stationReference = lead
    ai.stationReferenceIndex = 0
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(wing, 1 / 240, out)
    expect(ai.target).toBeNull()
    expect(board.assignments[1]).toBe(-1)
  })
})

describe('指揮層的命令', () => {
  /** 在 4000 m 平飛的飛機 */
  function flyer(): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    return a
  }

  /**
   * 【沒有命令時完全不變】這是整個指揮層能安全上線的前提 —— `order` 為
   * null 的每一架，行為必須與加這一層之前逐位元相同。
   */
  it('order 為 null 時意圖照舊由 arbitrate 決定', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).not.toBe('rally')
  })

  it('有命令且沒有威脅時，意圖是 rally', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    ai.order = {
      kind: 'rally', point: new Vector3(5000, 4000, 0), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).toBe('rally')
  })

  /**
   * 【閃躲永遠優先】spec §2.2 與專案負責人 2026-08-07 的裁定。實測支持見
   * task #136：把「速度見底就脫離」提到破防之前，AI 在被連續射擊時飛出
   * 完美直線（同向性 0.99 → 1.00），被打中的時間變成 2.3 倍。
   */
  it('有命令但破防閂鎖閂上時，意圖是 defend', () => {
    const ai = new AiController()
    const self = flyer()
    // 攻擊者咬在正後方 300 m，機首指向自機
    const attacker = flyer()
    attacker.state.position.set(0, 4000, 300)
    ai.target = attacker
    ai.order = {
      kind: 'rally', point: new Vector3(5000, 4000, 0), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
    const cmd = createCommand()
    for (let i = 0; i < 480; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.rules.defendLatch).toBe(true)
    expect(ai.intent).toBe('defend')
  })

  /** 造一張命令，只覆寫要關心的欄位 */
  function order(over: Partial<FlightOrder>): FlightOrder {
    return {
      kind: 'rally', point: new Vector3(5000, 4000, 0), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1, ...over,
    }
  }

  /**
   * 【集火不碰意圖】它與另外兩種命令最大的差別，也是 `OrderKind` 必須存在
   * 的理由：`rally` 與 `flank` 是「不要打，去那裡」，`focus` 是「打那一架」。
   */
  it('集火命令不把意圖壓成 rally', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    ai.order = order({ kind: 'focus', focusIndex: 3 })
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).not.toBe('rally')
  })

  it('側翼命令把意圖壓成 rally（轉向需求與集合點相同）', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    ai.order = order({ kind: 'flank', targetFlight: 1, side: 1 })
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).toBe('rally')
  })

  /**
   * 【長機被覆寫】`focusTarget` 只作用在沒有站位參考機的那一架。僚機走
   * 既有的 `LEVEL_FOCUS`（「打參考機正在打的那一架」），那一級本來就有
   * 自衛與掩護插隊 —— 「有人正在打我」不會被集火命令擋住。
   */
  it('集火時長機的目標被覆寫成指定的那一架', () => {
    const ai = new AiController()
    const self = flyer()
    const chosen = flyer()
    chosen.state.position.set(1200, 4000, -400)
    const other = flyer()
    other.state.position.set(0, 4000, -800)
    ai.target = other
    ai.order = order({ kind: 'focus', focusIndex: 3 })
    ai.focusTarget = chosen
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.target).toBe(chosen)
  })

  /** 【僚機不被覆寫】它靠 LEVEL_FOCUS 跟上，那條路徑有自衛插隊 */
  it('集火時僚機的目標不被覆寫', () => {
    const ai = new AiController()
    const self = flyer()
    const leader = flyer()
    leader.state.position.set(-200, 4000, 100)
    const chosen = flyer()
    chosen.state.position.set(1200, 4000, -400)
    const other = flyer()
    other.state.position.set(0, 4000, -800)
    ai.stationReference = leader
    ai.target = other
    ai.order = order({ kind: 'focus', focusIndex: 3 })
    ai.focusTarget = chosen
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.target).not.toBe(chosen)
  })
})

/**
 * 早退路徑的拉桿紀律（spec §4.4）。
 *
 * 【為什麼要獨立一條】`rallyCommand` 與 `stationCommand` **直接寫 `aimWorld`
 * 然後 return，根本不經過 `steerCommand`** —— 所以 `steerCommand` 裡的紀律
 * 對它們無效，「飛去集合點」的途中仍然可以把自己拉爆。
 *
 * 【方向性】甜蜜區**不**補到這裡（指揮位階較高），拉桿紀律**要**補：
 * 沒有任何命令的內容是「把自己拉爆」。
 */
describe('AiController：早退路徑的拉桿紀律', () => {
  const POINT = new Vector3(6000, 4000, -6000)   // 側前方 45°，製造大誤差角

  /** 沒有目標、只有集合命令的長機。`tas` 決定 cornerRatio。 */
  const rallying = (tas: number) => {
    const self = new Aircraft(P51D, 4000, tas)
    self.update(new Vector3(0, 0, -1), 0.7, DT)
    self.state.position.set(0, 4000, 0)
    const ai = new AiController()
    ai.order = {
      kind: 'rally', point: POINT, radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
    return { self, ai }
  }

  /** 機首與瞄準點的夾角，rad。 */
  const errAngle = (a: Aircraft, aim: Vector3) => {
    const nose = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation)
    return Math.acos(Math.min(1, Math.max(-1, nose.dot(aim))))
  }

  /**
   * 【為什麼是 110 m/s 而不是更慢】更慢會踩到 `applySafety` 的**失速硬接管**
   * ——它整個換掉 `aimWorld`（改成壓頭改出），本層就量不到了。實測 60 m/s
   * 時誤差角由 45° 變成 25°，那全部是安全層做的。110 m/s 的
   * `cornerRatio` 是 0.693（角落速度 158.7 m/s），低於 `energyFloorRatio`
   * 而遠高於失速接管的門檻。
   */
  it('速度見底時集合途中的誤差角被收小', () => {
    const { self, ai } = rallying(110)
    const raw = new Vector3()
    rallyAim(self, POINT, raw)
    const before = errAngle(self, raw)
    expect(before).toBeGreaterThan(30 * Math.PI / 180)

    const out = createCommand()
    ai.update(self, DT, out)
    expect(errAngle(self, out.aimWorld)).toBeLessThan(before * 0.9)
  })

  it('速度充足時集合路徑逐位元不動', () => {
    const { self, ai } = rallying(200)
    const raw = new Vector3()
    rallyAim(self, POINT, raw)

    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.x).toBe(raw.x)
    expect(out.aimWorld.y).toBe(raw.y)
    expect(out.aimWorld.z).toBe(raw.z)
  })
})
