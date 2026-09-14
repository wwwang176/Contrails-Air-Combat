import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import { createGroundTarget } from '../../src/world/groundTargets'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'
import type { Team } from '../../src/world/World'
import type { TakeoffRoll } from '../../src/control/takeoffRoll'
import {
  createGroundStrafeState, groundAttackCommand, groundStrafeReattackRange,
} from '../../src/ai/shipAttack'

/**
 * # 戰鬥機掃射地面目標
 *
 * 沒有空中目標時，戰鬥機（長機與僚機都一樣）去打敵方的地面目標。守的是
 * 「會不會去」：瞄準線指向目標、同隊的不打、轟炸機不走這一條。打不打得準、
 * 會不會撞地交給安全層與探針（`test/tools/asch-strafe.probe.ts`）。
 */

const DT = 1 / 240

/** 擺在 (x, y, z)、朝 −Z 以 200 m/s 平飛 */
function craft(spec: AircraftSpec, x: number, y: number, z: number): Aircraft {
  const a = new Aircraft(spec, y, 200)
  a.state.position.set(x, y, z)
  a.state.velocity.set(0, 0, -200)
  a.state.orientation.identity()
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.identity()
  return a
}

/** 前方 1,500 m、偏右 300 m 的地上停著一架 P-51 */
function parked(team: Team) {
  return createGroundTarget(0, 'parkedP51', team, 300, -1500, 0)
}

function toward(self: Aircraft, x: number, z: number): Vector3 {
  return new Vector3(x, 0, z).sub(self.state.position).normalize()
}

describe('戰鬥機掃射地面目標', () => {
  it('回頭距離會隨當下持續轉彎半徑增加，不是所有飛機共用寫死常數', () => {
    const self = craft(BF109K4, 0, 100, 0)
    self.state.velocity.set(0, 0, -100)
    const slow = groundStrafeReattackRange(self)
    self.state.velocity.set(0, 0, -120)
    const fast = groundStrafeReattackRange(self)
    expect(slow).toBeGreaterThan(1200)
    expect(fast).toBeGreaterThan(slow)
  })

  it('飛越後鎖住離場航向，拉開動態距離才重新瞄回目標', () => {
    const self = craft(BF109K4, 0, 100, -500)
    self.state.velocity.set(0, 0, -100)
    const target = createGroundTarget(0, 'parkedP51', 'red', 0, -1500, 0)
    const state = createGroundStrafeState()
    const out = createCommand()

    // 先從前方把目標帶進武器射程，替這一趟進場上膛。
    groundAttackCommand(state, self, target, true, out)
    expect(state.phase).toBe('approach')
    expect(state.armed).toBe(true)

    // 飛過最近點後仍沿 −Z 離場，不會立即把機鼻轉回身後的 +Z。
    self.state.position.set(0, 100, -1650)
    groundAttackCommand(state, self, target, false, out)
    expect(state.phase).toBe('egress')
    expect(out.firing).toBe(false)
    expect(out.aimWorld.z).toBeLessThan(0)
    expect(state.reattackRange).toBeGreaterThan(1200)

    // 超過「武器準備距離＋迴轉直徑」後，才解鎖下一次進場。
    self.state.position.set(0, 100, -4000)
    groundAttackCommand(state, self, target, true, out)
    expect(state.phase).toBe('approach')
    expect(out.aimWorld.z).toBeGreaterThan(0)
  })

  it('速度高到沒有持續迴轉解時不會把零半徑誤當成可以立刻回頭', () => {
    const self = craft(BF109K4, 0, 60, -500)
    self.state.velocity.set(0, 0, -100)
    const target = createGroundTarget(0, 'parkedP51', 'red', 0, -1500, 0)
    const state = createGroundStrafeState()
    const out = createCommand()
    groundAttackCommand(state, self, target, true, out)
    self.state.position.set(0, 60, -1650)
    groundAttackCommand(state, self, target, false, out)

    self.state.velocity.set(0, 0, -200)
    self.state.position.set(0, 60, -10000)
    groundAttackCommand(state, self, target, true, out)
    expect(state.reattackRange).toBe(Infinity)
    expect(state.phase).toBe('egress')
    expect(out.aimWorld.z).toBeLessThan(0)
  })

  it('停放機開始滑行後，沿 departedAs 繼續優先追蹤到完成起飛', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const airborne = craft(P51D, 0, 500, -1000)
    const taxiing = craft(P51D, 300, 2, -1500)
    taxiing.state.velocity.set(0, 0, 0)
    const stand = parked('red')
    stand.alive = false
    stand.departed = true
    stand.departedAs = 2
    const ai = new AiController()
    ai.board = createTargetBoard([
      { index: 0, aircraft: self, team: 'blue', alive: true },
      { index: 1, aircraft: airborne, team: 'red', alive: true, takeoff: null },
      { index: 2, aircraft: taxiing, team: 'red', alive: true, takeoff: {} as TakeoffRoll },
    ])
    ai.selfIndex = 0
    ai.groundTargets = [stand]
    ai.priorityGroundUnit = 'parkedP51'
    const out = createCommand()
    ai.update(self, DT, out)
    const aim = taxiing.state.position.clone().sub(self.state.position).normalize()
    expect(ai.groundedAircraftTarget).toBe(taxiing)
    expect(out.aimWorld.dot(aim)).toBeGreaterThan(0.95)
  })

  it('同時有多架滑行目標時做完同一航次，不因最近者改變而每拍換機', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const first = craft(P51D, 0, 2, -1000)
    const second = craft(P51D, 300, 2, -1500)
    first.state.velocity.set(0, 0, 0)
    second.state.velocity.set(0, 0, 0)
    const firstStand = createGroundTarget(0, 'parkedP51', 'red', 0, -1000, 0)
    const secondStand = createGroundTarget(1, 'parkedP51', 'red', 300, -1500, 0)
    firstStand.alive = false
    firstStand.departedAs = 1
    secondStand.alive = false
    secondStand.departedAs = 2
    const ai = new AiController()
    ai.board = createTargetBoard([
      { index: 0, aircraft: self, team: 'blue', alive: true },
      { index: 1, aircraft: first, team: 'red', alive: true, takeoff: {} as TakeoffRoll },
      { index: 2, aircraft: second, team: 'red', alive: true, takeoff: {} as TakeoffRoll },
    ])
    ai.selfIndex = 0
    ai.groundTargets = [firstStand, secondStand]
    ai.priorityGroundUnit = 'parkedP51'
    const out = createCommand()
    ai.update(self, DT, out)
    expect(ai.groundedAircraftTarget).toBe(first)

    // 第二架現在明顯更近；第一架仍有效，所以不換。
    self.state.position.set(300, 500, -1400)
    ai.update(self, 0.11, out)
    expect(ai.groundedAircraftTarget).toBe(first)

    // 第一架失效後，下一個決策拍才交給第二架。
    ai.board.candidates[1]!.alive = false
    ai.update(self, 0.11, out)
    expect(ai.groundedAircraftTarget).toBe(second)
  })

  it('任務指定後，即使有空中敵機仍優先瞄準停放的 P-51', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const enemy = craft(P51D, 900, 500, -1200)
    const ai = new AiController()
    ai.board = createTargetBoard([
      { index: 0, aircraft: self, team: 'blue', alive: true },
      { index: 1, aircraft: enemy, team: 'red', alive: true },
    ])
    ai.selfIndex = 0
    ai.groundTargets = [parked('red')]
    ai.priorityGroundUnit = 'parkedP51'
    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.dot(toward(self, 300, -1500))).toBeGreaterThan(0.99)
  })

  it('沒有任務指定時維持原規則：有空中敵機就不先掃地', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const enemy = craft(P51D, 900, 500, -1200)
    const ai = new AiController()
    ai.board = createTargetBoard([
      { index: 0, aircraft: self, team: 'blue', alive: true },
      { index: 1, aircraft: enemy, team: 'red', alive: true },
    ])
    ai.selfIndex = 0
    ai.groundTargets = [parked('red')]
    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.dot(toward(self, 300, -1500))).toBeLessThan(0.99)
  })

  it('空中敵機已取得直接射擊解時，自衛仍可插隊', () => {
    const self = craft(BF109K4, 0, 500, 0)
    // 在我後方 500 m、機首朝著我；符合空戰與僚機共用的直接威脅定義。
    const attacker = craft(P51D, 0, 500, 500)
    const ai = new AiController()
    ai.board = createTargetBoard([
      { index: 0, aircraft: self, team: 'blue', alive: true },
      { index: 1, aircraft: attacker, team: 'red', alive: true },
    ])
    ai.selfIndex = 0
    ai.groundTargets = [parked('red')]
    ai.priorityGroundUnit = 'parkedP51'
    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.dot(toward(self, 300, -1500))).toBeLessThan(0.99)
  })

  it('沒有空中目標的長機把瞄準線指向敵方的停放機', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const ai = new AiController()
    ai.board = createTargetBoard([{ index: 0, aircraft: self, team: 'blue', alive: true }])
    ai.selfIndex = 0
    ai.groundTargets = [parked('red')]
    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.dot(toward(self, 300, -1500))).toBeGreaterThan(0.99)
  })

  it('僚機也打，不是飛回站位', () => {
    const lead = craft(BF109K4, 0, 500, 0)
    const wing = craft(BF109K4, -200, 500, 100)
    const ai = new AiController()
    ai.board = createTargetBoard([
      { index: 0, aircraft: lead, team: 'blue', alive: true },
      { index: 1, aircraft: wing, team: 'blue', alive: true },
    ])
    ai.selfIndex = 1
    ai.stationReference = lead
    ai.stationReferenceIndex = 0
    ai.stationOffset = STATION_OFFSETS[1]!
    ai.groundTargets = [parked('red')]
    const out = createCommand()
    ai.update(wing, DT, out)
    // 【比站位更靠近目標】偏角比長機大，拉桿紀律（`shrinkTowardNose`）會把瞄準線
    // 往機首收一點，所以不要求對得跟長機一樣準
    const station = new Vector3()
    stationPoint(lead, STATION_OFFSETS[1]!, 0, station)
    station.sub(wing.state.position).normalize()
    const target = toward(wing, 300, -1500)
    expect(out.aimWorld.dot(target)).toBeGreaterThan(0.95)
    expect(out.aimWorld.dot(target)).toBeGreaterThan(out.aimWorld.dot(station))
  })

  it('同隊的地面目標不打 —— 沒有目標就維持機首平飛', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const ai = new AiController()
    ai.board = createTargetBoard([{ index: 0, aircraft: self, team: 'blue', alive: true }])
    ai.selfIndex = 0
    ai.groundTargets = [parked('blue')]
    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.dot(new Vector3(0, 0, -1))).toBeCloseTo(1, 6)
  })

  it('轟炸機不走這一條', () => {
    const self = craft(B17G, 0, 500, 0)
    const ai = new AiController()
    ai.board = createTargetBoard([{ index: 0, aircraft: self, team: 'blue', alive: true }])
    ai.selfIndex = 0
    ai.groundTargets = [parked('red')]
    const out = createCommand()
    ai.update(self, DT, out)
    expect(out.aimWorld.dot(toward(self, 300, -1500))).toBeLessThan(0.99)
  })
})
