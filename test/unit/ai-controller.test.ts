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
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

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
    const self = new Aircraft(BF109G6, 4000, 180)
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
    const self = new Aircraft(BF109G6, 4000, 180)
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
