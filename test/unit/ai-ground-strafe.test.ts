import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import { createGroundTarget } from '../../src/world/groundTargets'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'
import type { Team } from '../../src/world/World'

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
