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
/**
 * 急轉靶機的過載，G。**轉彎率由它推出來**：ω = g·√(n² − 1) ÷ v。
 *
 * 【為什麼不直接給一個轉彎率】等速的靶機若給 25°/s，540 km/h 下等於一直拉著
 * 6.7 G 而速度不掉 —— 真的 P-51 持續轉彎只撐得住 4 G 上下。拿做不到的靶機量，
 * 量到的是它的超能力，不是 AI 的缺陷。
 */
const BREAK_G = 4

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
 * @param breakTurn 被追到 400 m 內就以 `BREAK_G` 的持續轉彎急轉、機鼻一路追著 AI
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
  const breakRate = 9.80665 * Math.sqrt(BREAK_G * BREAK_G - 1) / droneSpeed
  for (let s = 0; s < seconds * 240; s++) {
    world.step(DT)
    if (breakTurn) {
      if (!broke && mine.state.position.distanceTo(dPos) < 400) broke = true
      if (broke) {
        const want = Math.atan2(mine.state.position.x - dPos.x, -(mine.state.position.z - dPos.z))
        let d = want - psi
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        psi += Math.max(-breakRate * DT, Math.min(breakRate * DT, d))
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

describe('飛過頭就往上拉：失去目標再重新取得同一架', () => {
  /**
   * 【上膛要跟著目標消失一起清】換目標的重置認的是物件身分，重新取得**同一架**
   * 時不會觸發。沒清的話，他一重新出現在我後方（接近速度為負）就被當成剛飛過頭。
   */
  it('上膛 → 目標消失 → 同一架在我後方重新出現：不往上拉', () => {
    const world = new World()
    const mine = new Aircraft(P51D, ALT, TAS)
    const drone = new Aircraft(P51D, ALT, 140)
    const minePos = new Vector3(0, ALT, 0)
    const dPos = new Vector3(0, ALT, -600)
    const vel = new Vector3(0, 0, -140)
    mine.state.position.copy(minePos)
    mine.state.velocity.copy(FWD).multiplyScalar(TAS)
    drone.state.position.copy(dPos)
    drone.state.velocity.copy(vel)
    for (const a of [mine, drone]) {
      a.prevPosition.copy(a.state.position)
      a.prevOrientation.copy(a.state.orientation)
    }
    const ai = new AiController()
    const mc = world.add(mine, ai, 'blue', minePos, ALT, TAS)
    const dc = world.add(drone, new Idle(), 'red', dPos.clone(), ALT, 140)
    for (const c of [mc, dc]) c.respawnOnDestroy = false
    ai.board = createTargetBoard(world.combatants)
    ai.selfIndex = mc.index
    ai.profile = VETERAN
    const pin = () => {
      drone.state.position.copy(dPos)
      drone.state.velocity.copy(vel)
      drone.state.angularVelocity.set(0, 0, 0)
      drone.prevPosition.copy(dPos)
      drone.prevOrientation.copy(drone.state.orientation)
      dc.hp = P51D.hp
    }
    // 追到 250 m 內：射程內、接近中、在他機尾 —— 上膛
    for (let s = 0; s < 30 * 240 && mine.state.position.distanceTo(dPos) > 250; s++) {
      world.step(DT)
      dPos.addScaledVector(vel, DT)
      pin()
    }
    expect(mine.state.position.distanceTo(dPos)).toBeLessThan(260)
    // 目標消失 2 s
    dc.alive = false
    for (let s = 0; s < 2 * 240; s++) world.step(DT)
    // 同一架在我正後方 300 m 重新出現，比我慢 —— 距離在拉開
    const fwd = mine.state.velocity.clone().setY(0).normalize()
    dPos.copy(mine.state.position).addScaledVector(fwd, -300)
    vel.copy(fwd).multiplyScalar(140)
    drone.state.orientation.setFromUnitVectors(FWD, fwd)
    dc.alive = true
    let reacquired = false
    for (let s = 0; s < 2 * 240; s++) {
      world.step(DT)
      dPos.addScaledVector(vel, DT)
      pin()
      if (ai.targetIndex === dc.index) reacquired = true
    }
    expect(reacquired).toBe(true)
    expect(Number.isNaN(ai.band.perch)).toBe(true)
  })
})

describe('飛過頭就往上拉：靶機被追上就以 4 G 急轉、機鼻追著 AI（540 km/h）', () => {
  it('不會停在他的機鼻錐裡', () => {
    const t = fly(150, true, 90)
    expect(t.bitten).toBeLessThan(0.5)
  })
})
