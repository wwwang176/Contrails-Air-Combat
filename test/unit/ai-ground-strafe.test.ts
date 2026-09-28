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
import { NO_INTERCEPT, solveLead } from '../../src/world/lead'
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

  it('回頭進場不壓機鼻：目標在機頭 75° 以外時瞄準最低到水平，轉到前方才往下', () => {
    const aimFor = (tx: number, tz: number, altitude = 300): Vector3 => {
      const self = craft(BF109K4, 0, altitude, 0)
      // 130 m/s 有持續迴轉解，回頭門檻約 2.2 km；6 km 外的目標不會先離場
      self.state.velocity.set(0, 0, -130)
      const target = createGroundTarget(0, 'fuelDump', 'red', tx, tz, 0)
      const out = createCommand()
      groundAttackCommand(createGroundStrafeState(), self, target, true, out)
      return out.aimWorld.clone()
    }
    // 身後、側方 6 km（回頭門檻外）：水平轉，方位照舊朝目標
    const behind = aimFor(0, 6000)
    expect(behind.y).toBeGreaterThanOrEqual(0)
    expect(behind.z).toBeGreaterThan(0.99)
    const side = aimFor(6000, 0)
    expect(side.y).toBeGreaterThanOrEqual(0)
    expect(side.x).toBeGreaterThan(0.99)
    // 【對地沒有空戰的高度例外】高過目標好幾個迴旋半徑也照樣水平轉
    expect(aimFor(0, 6000, 1500).y).toBeGreaterThanOrEqual(0)
    // 對照：目標在前方照樣往下瞄
    expect(aimFor(0, -2000).y).toBeLessThan(-0.1)
  })

  it('新的一趟從太近的地方開始：目標不在機頭前方又在回頭門檻內，先離場拉開', () => {
    const self = craft(BF109K4, 0, 300, 0)
    self.state.velocity.set(0, 0, -130)
    const reattack = groundStrafeReattackRange(self)
    expect(Number.isFinite(reattack)).toBe(true)
    const run = (x: number, z: number) => {
      const state = createGroundStrafeState()
      const out = createCommand()
      groundAttackCommand(state, self, createGroundTarget(0, 'fuelDump', 'red', x, z, 0), true, out)
      return { phase: state.phase, aim: out.aimWorld.clone() }
    }
    // 身後、側方都在門檻內：先沿機首方向拉開
    for (const [x, z] of [[0, 500], [500, 0]] as const) {
      const r = run(x, z)
      expect(r.phase).toBe('egress')
      expect(r.aim.z).toBeLessThan(-0.9)
    }
    // 對照：同樣近、但在前方，照常進場
    expect(run(0, -500).phase).toBe('approach')
    // 對照：在身後、但已經在門檻外，直接水平轉回去
    expect(run(0, reattack + 200).phase).toBe('approach')
  })

  it('離場中換成下一台目標不打斷離場：新目標還在回頭門檻內就繼續拉開', () => {
    const self = craft(BF109K4, 0, 100, -500)
    self.state.velocity.set(0, 0, -100)
    const first = createGroundTarget(0, 'parkedP51', 'red', 0, -1500, 0)
    const state = createGroundStrafeState()
    const out = createCommand()
    groundAttackCommand(state, self, first, true, out)
    self.state.position.set(0, 100, -1650)
    groundAttackCommand(state, self, first, false, out)
    expect(state.phase).toBe('egress')

    // 飛到離第一台夠遠、但下一台就在身後 500 m
    self.state.position.set(0, 100, -1500 - state.reattackRange - 100)
    const next = createGroundTarget(1, 'parkedP51', 'red', 0, self.state.position.z + 500, 0)
    groundAttackCommand(state, self, next, true, out)
    expect(state.phase).toBe('egress')
    expect(out.aimWorld.z).toBeLessThan(0)

    // 拉開到下一台的回頭門檻之外才轉回來
    self.state.position.z = next.position.z - state.reattackRange - 100
    groundAttackCommand(state, self, next, true, out)
    expect(state.phase).toBe('approach')
    expect(out.aimWorld.z).toBeGreaterThan(0)
  })

  it('進了射程就瞄預瞄點（含自己的速度與目標的速度），不是瞄目標本身', () => {
    // 下滑 6° 進場、目標橫越 30 m/s：預瞄點與目標本身差得出來
    const self = craft(BF109K4, 0, 100, 0)
    self.state.velocity.set(0, -15, -140)
    const truck = createGroundTarget(0, 'truck', 'red', 0, -800, Math.PI / 2)
    truck.speed = 30
    const out = createCommand()
    groundAttackCommand(createGroundStrafeState(), self, truck, true, out)
    const p = truck.position
    const aimPoint = new Vector3(p.x, (p.y + truck.impactY) / 2, p.z)
    const los = aimPoint.clone().sub(self.state.position)
    const tv = new Vector3(0, 0, -1).applyQuaternion(truck.orientation).multiplyScalar(30)
    const lead = new Vector3()
    const t = solveLead(los, tv.sub(self.state.velocity), BF109K4.battery.sight.muzzleVelocity, lead)
    expect(t).not.toBe(NO_INTERCEPT)
    expect(out.aimWorld.dot(lead)).toBeGreaterThan(0.99999)
    // 對照：預瞄點與目標本身至少差 1°，上面那一條才有鑑別力
    expect(lead.angleTo(los)).toBeGreaterThan(1 * Math.PI / 180)
  })

  it('掃射移動中的車，提前量的解吃得到車速（迎面開來的車攔截得更早）', () => {
    // 掃射核心朝目標當下的位置飛，開火與否看提前量的解 —— 與船同一個做法。
    // 車頭朝 +Z（航向 π），迎著飛機開過來：閉合速度變大，攔截時間變短
    const interceptAt = (speed: number): number => {
      const self = craft(BF109K4, 0, 300, 0)
      const truck = createGroundTarget(0, 'truck', 'red', 0, -1200, Math.PI)
      truck.speed = speed
      const state = createGroundStrafeState()
      groundAttackCommand(state, self, truck, true, createCommand())
      return state.interceptTime
    }
    expect(interceptAt(15)).toBeLessThan(interceptAt(0) - 1e-3)
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

  it('滑行中的停放機仍是地面目標，任務指定時照地面目標打', () => {
    const self = craft(BF109K4, 0, 500, 0)
    const stand = parked('red')
    stand.taxi = {} as TakeoffRoll
    stand.speed = 8
    const ai = new AiController()
    ai.board = createTargetBoard([{ index: 0, aircraft: self, team: 'blue', alive: true }])
    ai.selfIndex = 0
    ai.groundTargets = [stand]
    ai.priorityGroundUnit = 'parkedP51'
    const out = createCommand()
    ai.update(self, DT, out)
    expect(ai.groundTarget).toBe(stand)
    expect(out.aimWorld.dot(toward(self, 300, -1500))).toBeGreaterThan(0.95)
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
