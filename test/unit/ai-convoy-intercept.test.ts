import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard, type TargetCandidate } from '../../src/ai/target'
import { createCommand } from '../../src/control/Controller'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
function craft(spec: AircraftSpec, x: number, z: number): Aircraft {
  const a = new Aircraft(spec, 4000, 150)
  a.update(new Vector3(0, 0, -1), 0.7, DT)
  a.state.position.set(x, 4000, z)
  a.state.orientation.identity()
  a.state.velocity.set(0, 0, -150)
  return a
}

function scene() {
  const self = craft(BF109K4, 0, 0)
  const fighter = craft(P51D, 0, -300)
  const bomber = craft(B17G, 0, -2000)
  const wing = craft(BF109K4, 200, 100)
  const candidates: TargetCandidate[] = [
    { index: 0, aircraft: self, team: 'red', alive: true },
    { index: 1, aircraft: fighter, team: 'blue', alive: true },
    { index: 2, aircraft: bomber, team: 'blue', alive: true },
    { index: 3, aircraft: wing, team: 'red', alive: true },
  ]
  // 故意讓權重全是 1，證明行為不靠放大分數。
  const board = createTargetBoard(candidates, new Int32Array([0, 1, 2, 0]), undefined,
    new Uint8Array([0, 0, 1, 0]))
  const ai = new AiController()
  ai.board = board
  ai.selfIndex = 0
  ai.interceptConvoy = true
  const out = createCommand()
  const tick = () => { ai.setDecisionPhase(0); ai.update(self, DT, out) }
  return { self, fighter, bomber, wing, candidates, board, ai, out, tick }
}

describe('任務優先攔截護送編隊', () => {
  it('B-17 在 2 km、P-51 在 300 m，仍追 B-17，且一般集火不能改派', () => {
    const s = scene()
    s.ai.order = { kind: 'focus', point: new Vector3(), radius: 0, targetFlight: -1,
      side: 0, focusIndex: 1 }
    s.ai.focusTarget = s.fighter
    s.tick()
    expect(s.ai.target).toBe(s.bomber)
    expect(s.board.assignments[0]).toBe(2)
    expect(s.ai.convoyIntercept.phase).toBe('intercept')
    expect(s.ai.intent).not.toBe('rally')
  })

  it('一般集合命令不能把攔截長機帶離轟炸機', () => {
    const s = scene()
    s.ai.order = { kind: 'rally', point: new Vector3(8000, 4000, 8000), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1 }
    s.tick()
    expect(s.ai.target).toBe(s.bomber)
    expect(s.ai.intent).not.toBe('rally')
  })

  it('僚機遠處維持編隊，長機接近至 1.8 km 後進場，不必等到 900 m', () => {
    const s = scene()
    s.tick()
    const ai = new AiController()
    ai.interceptConvoy = true
    ai.board = s.board
    ai.selfIndex = 3
    ai.stationReference = s.self
    ai.stationReferenceIndex = 0
    ai.update(s.wing, DT, s.out)
    expect(ai.convoyIntercept.phase).toBe('formation')
    expect(ai.target).toBeNull()
    s.bomber.state.position.z = -1700
    ai.setDecisionPhase(0)
    ai.update(s.wing, DT, s.out)
    expect(ai.convoyIntercept.phase).toBe('intercept')
    expect(ai.target).toBe(s.bomber)
    expect(s.board.assignments[3]).toBe(2)
  })

  it('真正的近距離射擊威脅能插隊，解除後立即回到轟炸機', () => {
    const s = scene()
    s.tick()
    // P-51 在正後方同向飛行，對 109 有直接射擊解。
    s.fighter.state.position.set(0, 4000, 300)
    s.tick()
    expect(s.ai.convoyIntercept.phase).toBe('defend')
    expect(s.ai.target).toBe(s.fighter)
    expect(s.board.assignments[0]).toBe(1)
    s.fighter.state.position.set(2000, 4000, 300)
    s.tick()
    expect(s.ai.convoyIntercept.phase).toBe('intercept')
    expect(s.ai.target).toBe(s.bomber)
    expect(s.board.assignments[0]).toBe(2)
  })

  it('沒有存活護送目標就回到一般空戰', () => {
    const s = scene()
    s.tick()
    s.candidates[2]!.alive = false
    s.tick()
    expect(s.ai.convoyIntercept.phase).toBe('none')
    expect(s.ai.target).toBe(s.fighter)
  })

  it('沒有啟用任務設定時，仍接受一般集火命令', () => {
    const s = scene()
    s.ai.interceptConvoy = false
    s.ai.order = { kind: 'focus', point: new Vector3(), radius: 0, targetFlight: -1,
      side: 0, focusIndex: 1 }
    s.ai.focusTarget = s.fighter
    s.tick()
    expect(s.ai.target).toBe(s.fighter)
    expect(s.ai.convoyIntercept.phase).toBe('none')
  })

  it('撤離命令仍然優先於攔截', () => {
    const s = scene()
    s.ai.evacuating = true
    s.ai.order = { kind: 'rally', point: new Vector3(8000, 4000, 8000), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1 }
    s.tick()
    expect(s.ai.convoyIntercept.phase).toBe('none')
    expect(s.ai.intent).toBe('rally')
  })
})
