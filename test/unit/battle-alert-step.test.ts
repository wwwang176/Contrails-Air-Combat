import { describe, it, expect } from 'vitest'
import { AiController } from '../../src/ai/AiController'
import { createBattle, resetBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { alertTriggered, stepAlert, stepPatrol } from '../../src/battle/alert'
import { stepBeats } from '../../src/battle/missionBeats'
import { MESSAGE_SECONDS } from '../../src/battle/beats'
import { readyCard, KILL_CARD } from '../fixtures/mission'

/**
 * 警戒的狀態機（倫內爾島，SPEC §4–5）：開場、掃描、觸發、訊息、重新開始、巡邏。
 * 用真的 `japan-m3` 建一場，但不跑整關 —— 只推幾步或直接擺位置。
 */
const idle = { update() {} }
const card = (): ReadyMissionCard => MISSIONS.japan.find((c) => c.id === 'japan-m3') as ReadyMissionCard
const rennell = (): Battle => createBattle(idle, missionConfigFrom(card()), 1)
const reds = (b: Battle) => b.world.combatants.filter((c) => c.team === 'red')
const redAi = (b: Battle) => reds(b).map((c) => c.controller).filter((c): c is AiController => c instanceof AiController)
const firstBlueAi = (b: Battle) => b.world.combatants.find((c) => c.team === 'blue' && c.controller instanceof AiController)!

/** 推到下一次掃描（10 Hz）為止 */
const scan = (b: Battle): void => {
  b.alert!.timer = 0
  stepAlert(b, 1 / 240)
}

describe('警戒：開場', () => {
  it('未警戒、紅方艦砲與藍方砲塔停火、開場位置不滿足任何警戒條件', () => {
    const b = rennell()
    expect(b.alert).not.toBeNull()
    expect(b.alert!.alerted).toBe(false)
    expect(Array.from(b.world.holdFire)).toEqual([1, 1])
    expect(alertTriggered(b.world)).toBe(false)
  })

  it('第一個世界步之前，紅方每一架 AI 已經拿著巡邏命令、transit、沒有目標', () => {
    const b = rennell()
    const ais = redAi(b)
    expect(ais.length).toBe(6)
    for (const ai of ais) {
      expect(ai.order?.kind).toBe('rally')
      expect(ai.transit).toBe(true)
      expect(ai.target).toBeNull()
    }
  })

  it('沒有警戒設定的關卡：沒有警戒狀態、不停火', () => {
    const b = createBattle(idle, missionConfigFrom(readyCard(KILL_CARD)), 1)
    expect(b.alert).toBeNull()
    expect(Array.from(b.world.holdFire)).toEqual([0, 0])
  })
})

describe('警戒：觸發', () => {
  it('推幾步不會自己觸發；一架藍機抬到 600 m，下一次掃描就觸發', () => {
    const b = rennell()
    for (let i = 0; i < 48; i++) stepBattle(b, 1 / 240)
    expect(b.alert!.alerted).toBe(false)
    // 命令層每步重寫：跑過幾步紅方仍是巡邏
    for (const ai of redAi(b)) {
      expect(ai.transit).toBe(true)
      expect(b.alert!.orders.includes(ai.order)).toBe(true)
    }
    firstBlueAi(b).aircraft.state.position.y = 600
    scan(b)
    expect(b.alert!.alerted).toBe(true)
    expect(Array.from(b.world.holdFire)).toEqual([0, 0])
    expect(b.message).toBe('mission.japan-m3.alert')
    expect(b.messageUntil).toBeCloseTo(b.world.time + MESSAGE_SECONDS, 9)
  })

  it('觸發之後條件不成立也維持警戒', () => {
    const b = rennell()
    const p = firstBlueAi(b).aircraft.state.position
    p.y = 600
    scan(b)
    p.y = 200
    scan(b)
    expect(b.alert!.alerted).toBe(true)
  })

  it('警戒之後紅方回到指揮官的命令：不再是巡邏、不再 transit', () => {
    const b = rennell()
    firstBlueAi(b).aircraft.state.position.y = 600
    stepBattle(b, 1 / 240)
    scan(b)
    stepBattle(b, 1 / 240)
    for (const ai of redAi(b)) {
      expect(ai.transit).toBe(false)
      expect(ai.order === null || !b.alert!.orders.includes(ai.order)).toBe(true)
    }
  })

  /** 【沒有節拍的關卡】倫內爾島沒有節拍，訊息的過期不能依賴節拍 */
  it('訊息 4 秒後清掉', () => {
    const b = rennell()
    expect(b.cfg.beats).toBeUndefined()
    firstBlueAi(b).aircraft.state.position.y = 600
    scan(b)
    b.world.time = b.messageUntil - 0.01
    stepBeats(b)
    expect(b.message).toBe('mission.japan-m3.alert')
    b.world.time = b.messageUntil
    stepBeats(b)
    expect(b.message).toBeNull()
  })
})

describe('警戒：重新開始', () => {
  it('回到未警戒、停火、訊息清掉；第一個世界步之前紅方已經是巡邏命令、沒有目標', () => {
    const b = rennell()
    firstBlueAi(b).aircraft.state.position.y = 600
    scan(b)
    // 上一場紅方在作戰：拿著別的命令、鎖著一架藍機
    for (const ai of redAi(b)) {
      ai.order = null
      ai.transit = false
      ai.target = firstBlueAi(b).aircraft
      ai.targetIndex = 0
    }
    resetBattle(b, 1)
    expect(b.alert!.alerted).toBe(false)
    expect(Array.from(b.world.holdFire)).toEqual([1, 1])
    expect(b.message).toBeNull()
    for (const ai of redAi(b)) {
      expect(ai.order?.kind).toBe('rally')
      expect(ai.transit).toBe(true)
      expect(ai.target).toBeNull()
      expect(ai.targetIndex).toBe(-1)
    }
  })

  /** 【反應延遲的佇列也要清】不清的話上一場排著的扣扳機在新的一場吐出來，未警戒的野貓就開了火 */
  it('重新開始時清掉紅方 AI 排隊中的指令', () => {
    const b = rennell()
    const dropped: AiController[] = []
    for (const ai of redAi(b)) {
      const orig = ai.dropPendingCommands.bind(ai)
      ai.dropPendingCommands = () => { dropped.push(ai); orig() }
    }
    resetBattle(b, 1)
    expect(new Set(dropped)).toEqual(new Set(redAi(b)))
  })

  it('新的一場再觸發，訊息從 null 變回那個鍵', () => {
    const b = rennell()
    const lift = (): void => {
      firstBlueAi(b).aircraft.state.position.y = 600
      scan(b)
    }
    lift()
    resetBattle(b, 1)
    expect(b.message).toBeNull()
    lift()
    expect(b.message).toBe('mission.japan-m3.alert')
  })
})

describe('警戒：巡邏', () => {
  /** 【中心是船的形心】驅逐艦在前方，形心比卡片上的艦隊中心偏前；巡邏線要經過船在的地方 */
  it('巡邏點在艦隊形心左右 patrolHalfWidth、高度 patrolAltitude；兩支紅方小隊反方向', () => {
    const b = rennell()
    const spec = card().battle.alert!
    const ships = b.world.ships.filter((s) => s.team === 'red')
    const center = ships.reduce((acc, s) => acc.add(s.position), b.cfg.fleet!.center.clone().set(0, 0, 0))
      .multiplyScalar(1 / ships.length)
    const points = b.alert!.orders.filter((o) => o !== null).map((o) => o!.point)
    expect(points.length).toBe(2)
    for (const p of points) {
      expect(Math.abs(Math.abs(p.x - center.x) - spec.patrolHalfWidth)).toBeLessThan(1)
      expect(p.y).toBe(spec.patrolAltitude)
      expect(Math.abs(p.z - center.z)).toBeLessThan(1)
    }
    expect(Math.sign(points[0]!.x - center.x)).toBe(-Math.sign(points[1]!.x - center.x))
  })

  it('長機進到端點的半徑內就換飛另一端', () => {
    const b = rennell()
    const f = b.alert!.orders.findIndex((o) => o !== null)
    const order = b.alert!.orders[f]!
    const before = order.point.x
    const lead = b.world.combatants[b.flights.flights[f]!.members[0]!]!
    lead.aircraft.state.position.set(order.point.x + 100, 800, order.point.z)
    stepPatrol(b)
    expect(Math.sign(order.point.x)).toBe(-Math.sign(before))
  })
})
