import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { createGroundTarget } from '../../src/world/groundTargets'
import { P51D as RAW } from '../../src/specs/p51d'
import { applyFeel, feelFor } from '../../src/specs/feel'
import { DEFAULT_STEER } from '../../src/ai/steerConfig'
import { bestSustainedTurnRadiusCached } from '../../src/analysis/envelope'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # 低空對地進場時敵機從後方追上：迴轉不俯衝
 *
 * AI 離地 180 m 對一架停放的飛機進場，敵機從後方 1 km、同高度以 160 m/s 追上
 * （靶機：固定高度、3 G 的轉彎率追著 AI）。
 *
 * 瞄準直接指著敵人的話，AI 防禦急轉拉到 370 m 之後轉進交戰，迴轉途中敵人在
 * 下方就一路壓到 −57°，離地 200 m 時防墜才硬拉起，最低到 25 m、速度燒掉三成，
 * 敵人被甩到 1.7 km 外。
 *
 * 【只驗迴轉那一段】敵人轉進前方 75° 之後照舊可以壓機鼻攻擊，那一段在低空
 * 撞上防墜是交給安全層的，不是這一條要管的。
 *
 * 【遊戲規格】開戰時每一架都套手感（`battle/setup.ts` 的 `applyFeel`）；
 * 原始規格的角落速度與迴旋半徑都不一樣，量到的不是遊戲裡的行為。
 */

const P51D = applyFeel(RAW, feelFor(RAW))
const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)
const ALT = 180
const DV = 160
const DRATE = 9.80665 * Math.sqrt(3 * 3 - 1) / DV

class Idle implements Controller {
  update(_s: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(FWD); out.throttle = 0.8; out.brake = 0; out.firing = false
  }
}

interface Trace {
  /** 迴轉中（朝敵人轉的意圖、敵人在機頭 75° 以外、沒有低我很多）的步數 */
  turning: number
  /** 其中送出的瞄準方向往下的步數 */
  divingWhileTurning: number
  crashed: boolean
}

function fly(seconds: number): Trace {
  const world = new World()
  world.crashPolicy = (c) => c.aircraft.state.position.y < 0
  const t0 = createGroundTarget(0, 'parkedP51', 'red', 0, -6000, 0)
  t0.hp = 1e12
  world.groundTargets.push(t0)
  const mine = new Aircraft(P51D, ALT, 150)
  mine.state.position.set(0, ALT, 0)
  mine.state.velocity.copy(FWD).multiplyScalar(150)
  const ai = new AiController()
  const mc = world.add(mine, ai, 'blue', new Vector3(0, ALT, 0), ALT, 150)
  mc.respawnOnDestroy = false
  const dPos = new Vector3(0, ALT, 1000)
  const drone = new Aircraft(P51D, ALT, DV)
  drone.state.position.copy(dPos)
  drone.state.velocity.copy(FWD).multiplyScalar(DV)
  const dc = world.add(drone, new Idle(), 'red', dPos.clone(), ALT, DV)
  dc.respawnOnDestroy = false
  for (const a of [mine, drone]) {
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN
  ai.groundTargets = world.groundTargets
  // 【讀延遲之前的那一份】`command` 是過了反應延遲的，會落後意圖與態勢幾拍
  const raw = (ai as unknown as { raw: Command }).raw

  const t: Trace = { turning: 0, divingWhileTurning: 0, crashed: false }
  const vel = new Vector3()
  const dir = new Vector3()
  let psi = 0
  for (let s = 0; s < seconds * 240; s++) {
    world.step(DT)
    const want = Math.atan2(mine.state.position.x - dPos.x, -(mine.state.position.z - dPos.z))
    let e = want - psi
    while (e > Math.PI) e -= 2 * Math.PI
    while (e < -Math.PI) e += 2 * Math.PI
    psi += Math.max(-DRATE * DT, Math.min(DRATE * DT, e))
    vel.set(Math.sin(psi) * DV, 0, -Math.cos(psi) * DV)
    dPos.addScaledVector(vel, DT)
    drone.state.position.copy(dPos)
    drone.state.velocity.copy(vel)
    drone.state.orientation.setFromUnitVectors(FWD, dir.copy(vel).normalize())
    drone.state.angularVelocity.set(0, 0, 0)
    drone.prevPosition.copy(dPos)
    drone.prevOrientation.copy(drone.state.orientation)
    dc.hp = P51D.hp
    dc.alive = true
    if (!mc.alive) { t.crashed = true; break }
    const attacking = ai.intent === 'engage' || ai.intent === 'approach' || ai.intent === 'merge'
    const radius = bestSustainedTurnRadiusCached(P51D, mine.state.position.y)
    if (attacking && ai.sit.aspectAngle > DEFAULT_STEER.turnFrontCone
      && ai.sit.altitudeAdvantage <= DEFAULT_STEER.turnDiveRadii * radius) {
      t.turning++
      if (raw.aimWorld.y < 0) t.divingWhileTurning++
    }
  }
  return t
}

describe('低空對地進場、敵機從後方追上', () => {
  let t: Trace
  beforeAll(() => { t = fly(20) })

  it('沒有墜毀', () => {
    expect(t.crashed).toBe(false)
  })

  it('對照：情境裡真的有朝敵人迴轉的那一段', () => {
    expect(t.turning).toBeGreaterThan(240)
  })

  it('迴轉途中送出的瞄準方向從不往下', () => {
    expect(t.divingWhileTurning).toBe(0)
  })
})
