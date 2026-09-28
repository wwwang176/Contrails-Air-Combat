import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { DEFAULT_STEER } from '../../src/ai/steer'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # 打完一擊拉回原本的高度（空層鎖的 `regain`）
 *
 * 靶機情境，同 `test/tools/band-drill.probe.ts` 的做法：靶機每步釘回等速直線、
 * 血量拉滿 —— 它是尺，不是對手。量到的高度全部是 AI 自己的決定。
 *
 * 【同機種】P-51 對 P-51，機體轉彎率相同，規則 3（轉不贏就脫離）不會觸發。
 *
 * AI 在 3,000 m，靶機在前方 5 km、2,000 m、迎面直飛。
 */

const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)
const ALT = 3000
const DRONE_ALT = 2000
const TAS = 180
/** P-51 自己的射程：開火紀律的那把尺（`fire.ts`） */
const REACH = P51D.battery.sight.muzzleVelocity * PROJECTILE_LIFETIME

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(FWD)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

interface Trace {
  /** 交會（距離第一個極小值）的時刻，s */
  mergeAt: number
  /** 交會前的最低高度，m */
  lowBeforeMerge: number
  /** 交會之後出現過 `regain` 嗎 */
  regained: boolean
  /** 第一次進入 `regain` 時記住的高度，m */
  perch: number
  /**
   * 處在 `regain` 那些步累計爬了多少，m。只算這些步，別的層（`extend`、
   * `overshoot`、安全層）造成的爬升不算進來。
   */
  regainClimb: number
  /** 回升結束（到了、逾時或目標跑掉，記憶被清掉）的時刻，s */
  regainEndedAt: number
  /** 回升結束之後離靶機最近多少，m */
  closestAfterRegain: number
}

function fly(droneSpeed: number, seconds: number): Trace {
  const world = new World()
  const mine = new Aircraft(P51D, ALT, TAS)
  const drone = new Aircraft(P51D, DRONE_ALT, droneSpeed)
  const minePos = new Vector3(0, ALT, 0)
  const dronePos = new Vector3(0, DRONE_ALT, -5000)
  const droneVel = new Vector3(0, 0, droneSpeed)
  mine.state.position.copy(minePos)
  mine.state.velocity.copy(FWD).multiplyScalar(TAS)
  drone.state.position.copy(dronePos)
  drone.state.velocity.copy(droneVel)
  drone.state.orientation.setFromUnitVectors(FWD, new Vector3(0, 0, 1))
  for (const a of [mine, drone]) {
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  const ai = new AiController()
  const mc = world.add(mine, ai, 'blue', minePos, ALT, TAS)
  const dc = world.add(drone, new Idle(), 'red', dronePos, DRONE_ALT, droneSpeed)
  for (const c of [mc, dc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN

  const t: Trace = {
    mergeAt: NaN, lowBeforeMerge: Infinity, regained: false, perch: NaN,
    regainClimb: 0, regainEndedAt: NaN, closestAfterRegain: Infinity,
  }
  let lastRange = Infinity
  let lastY = ALT
  for (let s = 0; s < seconds * 240; s++) {
    world.step(DT)
    drone.state.position.copy(dronePos).addScaledVector(droneVel, (s + 1) * DT)
    drone.state.velocity.copy(droneVel)
    drone.state.angularVelocity.set(0, 0, 0)
    drone.prevPosition.copy(drone.state.position)
    drone.prevOrientation.copy(drone.state.orientation)
    dc.hp = P51D.hp
    dc.alive = true
    if (!mc.alive) break

    const y = mine.state.position.y
    const dy = y - lastY
    lastY = y
    const range = mine.state.position.distanceTo(drone.state.position)
    if (Number.isNaN(t.mergeAt)) {
      if (y < t.lowBeforeMerge) t.lowBeforeMerge = y
      if (range > lastRange) t.mergeAt = s * DT
      lastRange = range
      continue
    }
    if (ai.band.kind === 'regain') {
      if (!t.regained) {
        t.regained = true
        t.perch = ai.band.anchor
      }
      if (dy > 0) t.regainClimb += dy
    } else if (t.regained && Number.isNaN(t.regainEndedAt) && Number.isNaN(ai.band.perch)) {
      t.regainEndedAt = s * DT
    }
    if (Number.isFinite(t.regainEndedAt) && range < t.closestAfterRegain) t.closestAfterRegain = range
  }
  return t
}

describe('空層鎖的回升：靶機比 AI 慢（504 km/h），比它高 1,000 m 迎面接敵', () => {
  let t: Trace
  beforeAll(() => { t = fly(140, 120) })

  it('情境成立：有交會', () => {
    expect(Number.isFinite(t.mergeAt)).toBe(true)
  })

  it('交會前俯衝接敵，高度優勢真的用上了', () => {
    expect(t.lowBeforeMerge).toBeLessThan(DRONE_ALT + 400)
  })

  it('交會之後進入回升，記住的是開局那一層', () => {
    expect(t.regained).toBe(true)
    expect(t.perch).toBeGreaterThan(ALT - DEFAULT_STEER.bandTolerance)
  })

  /**
   * 【量的是回升自己爬的】交會後的最高點不能當證據 —— `extend`、`overshoot`
   * 的高 yo-yo、安全層都會拉升。只累計處在 `regain` 那些步的爬升。
   */
  it('回升真的在爬', () => {
    expect(t.regainClimb).toBeGreaterThan(2 * DEFAULT_STEER.bandTolerance)
  })

  it('回升會結束，不會一直掛著', () => {
    expect(Number.isFinite(t.regainEndedAt)).toBe(true)
  })

  it('打完拉起來之後，還追得回射程', () => {
    expect(t.closestAfterRegain).toBeLessThan(REACH)
  })
})

describe('空層鎖的回升：靶機比 AI 快（648 km/h）', () => {
  let t: Trace
  beforeAll(() => { t = fly(TAS, 75) })

  it('他跑掉了：回升在時間上限之前就放棄，改去追', () => {
    expect(t.regained).toBe(true)
    expect(t.regainEndedAt - t.mergeAt).toBeLessThan(DEFAULT_STEER.bandRegainMax)
  })
})
