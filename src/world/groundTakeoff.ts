import { Quaternion, Vector3 } from 'three'
import { GEAR_CLEARANCE, ROLL_SECONDS, stepTakeoff, type PoseState, type TakeoffRoll } from '../control/takeoffRoll'
import type { GroundTarget } from './groundTargets'

/** 起飛交接只修改飛行狀態，不依賴世界的武器、碰撞或計分系統。 */
export interface TakeoffSeat {
  readonly index: number
  readonly aircraft: {
    readonly state: PoseState
    readonly prevPosition: Vector3
    readonly prevOrientation: Quaternion
  }
  takeoff: TakeoffRoll | null
  hp: number
  alive: boolean
  retired: boolean
}

/** 地上飛機共用的腳本暫存；每次推進前先種回該機的姿態。 */
const TAXI_POSE: PoseState = {
  position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion(), angularVelocity: new Vector3(),
}

/**
 * 有 taxi 腳本的地面飛機推進一步，離地時交給 departedAs 指定的席位。
 * 地面目標位置是地面高度，飛行狀態位置則含起落架間隙。
 * 交接時同步上一幀姿態、速度與血量，並將席位記入 liftoffs，供戰鬥層同步名冊。
 */
export function stepGroundTaxi(
  t: GroundTarget, dt: number, combatants: readonly TakeoffSeat[], liftoffs: number[],
): void {
  const roll = t.taxi!
  if (!t.alive) {
    t.taxi = null
    t.rolling = false
    return
  }
  TAXI_POSE.position.set(t.position.x, t.position.y + GEAR_CLEARANCE, t.position.z)
  TAXI_POSE.orientation.copy(t.orientation)
  stepTakeoff(roll, TAXI_POSE, dt)
  const taxiDone = roll.taxi === null || roll.elapsed >= roll.taxiTime
  const tRoll = roll.elapsed - roll.delay
  t.position.set(TAXI_POSE.position.x, TAXI_POSE.position.y - GEAR_CLEARANCE, TAXI_POSE.position.z)
  t.orientation.copy(TAXI_POSE.orientation)
  t.speed = TAXI_POSE.velocity.length()
  t.rolling = taxiDone && tRoll > 0
  if (!(taxiDone && tRoll >= ROLL_SECONDS)) return

  t.taxi = null
  t.rolling = false
  t.speed = 0
  t.alive = false
  t.departed = true
  const c = combatants[t.departedAs]
  if (c === undefined) return
  const a = c.aircraft
  a.state.position.copy(TAXI_POSE.position)
  a.state.orientation.copy(TAXI_POSE.orientation)
  a.state.velocity.copy(TAXI_POSE.velocity)
  a.state.angularVelocity.set(0, 0, 0)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  c.takeoff = roll
  c.hp = t.hp
  c.alive = true
  c.retired = false
  liftoffs.push(c.index)
}
