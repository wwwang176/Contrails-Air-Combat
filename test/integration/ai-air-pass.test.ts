import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { DEFAULT_STEER } from '../../src/ai/steer'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # 飛過頭就往上拉
 *
 * 靶機情境，同 `ai-band-regain.test.ts` 的做法：靶機由測試逐步推進、血量拉滿，
 * 它是尺不是對手。同高度開局，沒有高度優勢，鎖放開時不會記下回升 —— 拉起
 * 只能來自飛過頭。
 */

const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)
const ALT = 3000
const TAS = 180
const RAD = Math.PI / 180

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(FWD)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

interface Trace {
  /** 第一次進入回升的時刻，s */
  zoomAt: number
  /** 第一次回升期間爬了多少，m（只算處在 regain 的步） */
  zoomClimb: number
  /** 第一次回升結束的時刻，s */
  zoomEndedAt: number
  /** 第一次回升結束之後開火的秒數 */
  fireAfterZoom: number
  /** AI 在靶機機鼻 15° 錐內、1 km 內的秒數 —— 實戰裡會被咬的時間 */
  bitten: number
}

/**
 * @param droneSpeed 靶機空速，m/s
 * @param breakTurn 被追到 400 m 內就以 25°/s 急轉、機鼻一路追著 AI
 */
function fly(droneSpeed: number, breakTurn: boolean, seconds: number): Trace {
  const world = new World()
  const mine = new Aircraft(P51D, ALT, TAS)
  const drone = new Aircraft(P51D, ALT, droneSpeed)
  const minePos = new Vector3(0, ALT, 0)
  const dPos = new Vector3(0, ALT, breakTurn ? -1500 : -2000)
  mine.state.position.copy(minePos)
  mine.state.velocity.copy(FWD).multiplyScalar(TAS)
  drone.state.position.copy(dPos)
  drone.state.velocity.copy(FWD).multiplyScalar(droneSpeed)
  for (const a of [mine, drone]) {
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  const ai = new AiController()
  const mc = world.add(mine, ai, 'blue', minePos, ALT, TAS)
  const dc = world.add(drone, new Idle(), 'red', dPos.clone(), ALT, droneSpeed)
  for (const c of [mc, dc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN

  const t: Trace = { zoomAt: NaN, zoomClimb: 0, zoomEndedAt: NaN, fireAfterZoom: 0, bitten: 0 }
  const vel = new Vector3()
  const los = new Vector3()
  let psi = 0
  let broke = false
  let lastY = ALT
  for (let s = 0; s < seconds * 240; s++) {
    world.step(DT)
    if (breakTurn) {
      if (!broke && mine.state.position.distanceTo(dPos) < 400) broke = true
      if (broke) {
        const want = Math.atan2(mine.state.position.x - dPos.x, -(mine.state.position.z - dPos.z))
        let d = want - psi
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        psi += Math.max(-25 * RAD * DT, Math.min(25 * RAD * DT, d))
      }
    }
    vel.set(Math.sin(psi) * droneSpeed, 0, -Math.cos(psi) * droneSpeed)
    dPos.addScaledVector(vel, DT)
    drone.state.position.copy(dPos)
    drone.state.velocity.copy(vel)
    drone.state.orientation.setFromUnitVectors(FWD, los.copy(vel).normalize())
    drone.state.angularVelocity.set(0, 0, 0)
    drone.prevPosition.copy(drone.state.position)
    drone.prevOrientation.copy(drone.state.orientation)
    dc.hp = P51D.hp
    dc.alive = true
    if (!mc.alive) break

    const y = mine.state.position.y
    const dy = y - lastY
    lastY = y
    if (ai.band.kind === 'regain') {
      if (Number.isNaN(t.zoomAt)) t.zoomAt = s * DT
      if (Number.isNaN(t.zoomEndedAt) && dy > 0) t.zoomClimb += dy
    } else if (Number.isFinite(t.zoomAt) && Number.isNaN(t.zoomEndedAt) && Number.isNaN(ai.band.perch)) {
      t.zoomEndedAt = s * DT
    }
    if (Number.isFinite(t.zoomEndedAt) && mc.command.firing) t.fireAfterZoom += DT
    los.copy(mine.state.position).sub(dPos)
    if (los.length() < 1000 && los.normalize().dot(vel) / droneSpeed > Math.cos(15 * RAD)) t.bitten += DT
  }
  return t
}

describe('飛過頭就往上拉：同高度從後方追上較慢的靶機（504 km/h）', () => {
  let t: Trace
  beforeAll(() => { t = fly(140, false, 150) })

  it('飛過頭就進入回升', () => {
    expect(Number.isFinite(t.zoomAt)).toBe(true)
  })

  it('回升真的往上拉', () => {
    expect(t.zoomClimb).toBeGreaterThan(DEFAULT_STEER.airPassZoom / 2)
  })

  it('回升會結束，之後再打下一趟', () => {
    expect(Number.isFinite(t.zoomEndedAt)).toBe(true)
    expect(t.fireAfterZoom).toBeGreaterThan(1)
  })
})

describe('飛過頭就往上拉：靶機被追上就急轉、機鼻追著 AI（540 km/h）', () => {
  it('不會停在他的機鼻錐裡', () => {
    const t = fly(150, true, 90)
    expect(t.bitten).toBeLessThan(0.5)
  })
})
