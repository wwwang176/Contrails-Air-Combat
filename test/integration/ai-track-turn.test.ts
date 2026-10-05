import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { shouldFire } from '../../src/ai/fire'
import { P51D } from '../../src/specs/p51d'
import type { EngageBasis } from '../../src/ai/engageGeometry'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # AI 咬住急轉的目標：射擊解不再每秒開關一次
 *
 * 靶機情境，同 `ai-air-pass.test.ts` 的做法：靶機由測試逐步推進、血量拉滿，
 * 被追到 400 m 內就以 4 G 持續急轉、機鼻追著 AI。
 *
 * 射擊窗＝`shouldFire`（不含點放）連續成立的一段，相隔 ≤ 0.3 s 併成一段。
 * 現行改平每次誤差進 2.5° 就把坡度拉向 0，實測 39 段裡 37 段不到 1 秒。
 */

const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)
const ALT = 3000
const TAS = 180
const V = 150
const BREAK_G = 4
const GAP = 0.3

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(FWD)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

interface Trace {
  windows: number[]
  trackTurnSteps: number
}

function fly(seconds: number): Trace {
  const world = new World()
  const mine = new Aircraft(P51D, ALT, TAS)
  const drone = new Aircraft(P51D, ALT, V)
  const minePos = new Vector3(0, ALT, 0)
  const dPos = new Vector3(0, ALT, -1500)
  mine.state.position.copy(minePos)
  mine.state.velocity.copy(FWD).multiplyScalar(TAS)
  drone.state.position.copy(dPos)
  drone.state.velocity.copy(FWD).multiplyScalar(V)
  for (const a of [mine, drone]) {
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  const ai = new AiController()
  const mc = world.add(mine, ai, 'blue', minePos, ALT, TAS)
  const dc = world.add(drone, new Idle(), 'red', dPos.clone(), ALT, V)
  for (const c of [mc, dc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN
  const basis = (ai as unknown as { basis: EngageBasis }).basis

  const t: Trace = { windows: [], trackTurnSteps: 0 }
  const vel = new Vector3()
  const dir = new Vector3()
  const rate = 9.80665 * Math.sqrt(BREAK_G * BREAK_G - 1) / V
  let psi = 0
  let broke = false
  let open = false
  let start = 0
  let last = -1
  for (let s = 0; s < seconds * 240; s++) {
    world.step(DT)
    if (!broke && mine.state.position.distanceTo(dPos) < 400) broke = true
    if (broke) {
      const want = Math.atan2(mine.state.position.x - dPos.x, -(mine.state.position.z - dPos.z))
      let d = want - psi
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      psi += Math.max(-rate * DT, Math.min(rate * DT, d))
    }
    vel.set(Math.sin(psi) * V, 0, -Math.cos(psi) * V)
    dPos.addScaledVector(vel, DT)
    drone.state.position.copy(dPos)
    drone.state.velocity.copy(vel)
    drone.state.orientation.setFromUnitVectors(FWD, dir.copy(vel).normalize())
    drone.state.angularVelocity.set(0, 0, 0)
    drone.prevPosition.copy(dPos)
    drone.prevOrientation.copy(drone.state.orientation)
    dc.hp = P51D.hp
    dc.alive = true
    if (!mc.alive) break

    if (mc.command.trackTurn) t.trackTurnSteps++
    const now = s * DT
    if (shouldFire(ai.sit, basis, mine)) {
      if (!open) {
        if (last >= 0 && now - last <= GAP && t.windows.length > 0) start = now - t.windows.pop()! - (now - last)
        else start = now
        open = true
      }
      last = now
    } else if (open && now - last > GAP) {
      open = false
      t.windows.push(last - start)
    }
  }
  if (open) t.windows.push(last - start)
  return t
}

describe('AI 咬住 4 G 急轉的靶機（540 km/h）', () => {
  let t: Trace
  beforeAll(() => { t = fly(90) })

  it('跟瞄時真的開了 trackTurn', () => {
    expect(t.trackTurnSteps).toBeGreaterThan(240)
  })

  it('不到 1 秒的射擊窗 ≤ 5 段', () => {
    expect(t.windows.filter((w) => w < 1).length).toBeLessThanOrEqual(5)
  })

  /** 【短窗少了不能是因為根本打不到】窗是空的時候上一條也成立 */
  it('射擊窗合計至少 20 秒，而且有一段連續 5 秒以上', () => {
    expect(t.windows.reduce((a, w) => a + w, 0)).toBeGreaterThan(20)
    expect(Math.max(0, ...t.windows)).toBeGreaterThan(5)
  })
})
