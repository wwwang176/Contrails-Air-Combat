import { Quaternion, Vector3 } from 'three'
import { DEG } from '../core/math'

/**
 * # 滑行與滾行起飛腳本
 *
 * 停在地上的飛機起飛加入戰鬥：沿滑行道滑到跑道上排隊 → 等小隊到齊 → 貼地滾行
 * → 抬頭離地 → 初期爬升 → 交還物理。
 * **位置由這一支驅動，物理積分跳過**（`World.step` 讀 `Combatant.takeoff`）——
 * 飛行模型沒有地面與起落架，讓它自己在跑道上加速會陷進地面或直接被撞地判定
 * 殺掉。
 *
 * 【交還時速度要接得上】速度一直沿著機首方向、大小照剖面走，交還那一步
 * 物理拿到的就是當下的速度向量。歸零或換成開局速度的話，飛機會在跑道頭
 * 失速掉下來或瞬間彈出去。
 *
 * 熱路徑：不配置。
 */

/** 滾行到離地的秒數。**起始值，由試飛裁定** */
export const ROLL_SECONDS = 12
/** 離地速度，m/s（約 180 km/h） */
export const LIFTOFF_SPEED = 50
/** 抬頭的目標俯仰角 */
export const ROTATE_PITCH = 9 * DEG
/** 由水平拉到 `ROTATE_PITCH` 的秒數 */
export const ROTATE_SECONDS = 1.5
/** 離地之後到交還的秒數 */
export const CLIMB_SECONDS = 3.5
/**
 * 滾行段機體原點離跑道面多高，m。**沒有起落架**，模型整體抬高這麼多才不會
 * 陷進跑道面。
 */
export const GEAR_CLEARANCE = 1.5
/**
 * 同一小隊單列排在跑道上，後一架在前一架後方多遠，m。P-51 全長 9.8 m；
 * 後一架晚 `TAKEOFF_STAGGER` 秒起步時前一架只走了 ½at²（約 2 m），不會追撞。
 */
export const TAKEOFF_TRAIL = 40
/** 後一架比前一架晚幾秒開始滾行 */
export const TAKEOFF_STAGGER = 1
/** 滑行速度，m/s（約 29 km/h）。**起始值，由試飛裁定** */
export const TAXI_SPEED = 8
/** 滑行途中原地轉向的角速度。**起始值，由試飛裁定** */
export const TAXI_TURN_RATE = 90 * DEG

/** 折線上的一點，世界座標 */
export interface TaxiPoint {
  readonly x: number
  readonly z: number
}

/**
 * 起飛線：世界座標、機首航向（rad，0 = 朝 −Z）。第 `slot` 架排在它後方
 * `slot × TAKEOFF_TRAIL`。
 */
export interface TakeoffLine {
  readonly x: number
  readonly z: number
  readonly heading: number
  /**
   * 從停在 (x, z) 的那一格滑到第 `slot` 個排隊位置的折線，世界座標。**第一點
   * 是那一格、最後一點是排隊位置。** 省略 = 直接擺在排隊位置上，不滑行。
   */
  readonly route?: (x: number, z: number, slot: number) => readonly TaxiPoint[]
}

/** 一段滑行：沿 `path` 走，出發時機首朝 `startHeading` */
export interface TaxiPlan {
  readonly path: readonly TaxiPoint[]
  readonly startHeading: number
}

export interface TakeoffRoll {
  /** 排隊位置，也就是滾行的起點 */
  readonly x: number
  readonly z: number
  readonly heading: number
  /** 跑道面高度，m */
  readonly groundY: number
  /** 滑行；`null` = 一開始就在排隊位置上 */
  readonly taxi: TaxiPlan | null
  /** 滑到排隊位置、轉正機首要幾秒。沒有滑行時是 0 */
  readonly taxiTime: number
  /**
   * 腳本開始後第幾秒開始滾行。**不小於 `taxiTime`** —— 小於的話滾行從排隊位置
   * 瞬移出發。建立之後由呼叫端依小隊到齊的時刻填（`battle/setup.ts`）。
   */
  delay: number
  /** 腳本開始後經過的秒數 */
  elapsed: number
}

export function createTakeoffRoll(
  x: number, z: number, heading: number, groundY: number, delay = 0, taxi: TaxiPlan | null = null,
): TakeoffRoll {
  const taxiTime = taxi === null ? 0 : taxiSeconds(taxi.path, taxi.startHeading, heading)
  return { x, z, heading, groundY, taxi, taxiTime, delay, elapsed: 0 }
}

/** 往 (dx, dz) 走時的機首航向。與 `FWD` 同一套：機首是 (−sin h, 0, −cos h) */
function headingToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/** 角度差收進 [−π, π] */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI))
}

/**
 * 沿折線滑完、最後轉到 `endHeading` 要幾秒：每一段先原地轉到那一段的方向
 * （`TAXI_TURN_RATE`），再以 `TAXI_SPEED` 走完。長度為零的段跳過。
 */
export function taxiSeconds(path: readonly TaxiPoint[], startHeading: number, endHeading: number): number {
  let t = 0
  let h = startHeading
  for (let i = 1; i < path.length; i++) {
    const dx = path[i]!.x - path[i - 1]!.x
    const dz = path[i]!.z - path[i - 1]!.z
    const len = Math.hypot(dx, dz)
    if (len === 0) continue
    const nh = headingToward(dx, dz)
    t += Math.abs(wrapAngle(nh - h)) / TAXI_TURN_RATE + len / TAXI_SPEED
    h = nh
  }
  return t + Math.abs(wrapAngle(endHeading - h)) / TAXI_TURN_RATE
}

/** 滾行段的加速度，m/s²。整段等加速 */
const ACCEL = LIFTOFF_SPEED / ROLL_SECONDS

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const RIGHT = /* @__PURE__ */ new Vector3(1, 0, 0)
const QP = /* @__PURE__ */ new Quaternion()

type PoseState = { position: Vector3; velocity: Vector3; orientation: Quaternion; angularVelocity: Vector3 }

/**
 * 滑行開始後第 `time` 秒的姿態，就地寫 `state`。與 `taxiSeconds` 同一套分段：
 * 轉向時停在折點上、速度為零；直行時在那一段上、速度 `TAXI_SPEED`。
 * 是 `time` 的純函數，不積分 —— 位置因此永遠在折線上。
 */
function taxiPose(roll: TakeoffRoll, plan: TaxiPlan, time: number, state: PoseState): void {
  const path = plan.path
  let h = plan.startHeading
  let left = time
  let x = path[0]!.x
  let z = path[0]!.z
  let speed = 0
  let done = false
  for (let i = 1; i < path.length && !done; i++) {
    const a = path[i - 1]!
    const dx = path[i]!.x - a.x
    const dz = path[i]!.z - a.z
    const len = Math.hypot(dx, dz)
    if (len === 0) continue
    const nh = headingToward(dx, dz)
    const turn = wrapAngle(nh - h)
    const pivot = Math.abs(turn) / TAXI_TURN_RATE
    x = a.x
    z = a.z
    if (left < pivot) {
      h += Math.sign(turn) * TAXI_TURN_RATE * left
      done = true
      break
    }
    left -= pivot
    h = nh
    const move = len / TAXI_SPEED
    if (left < move) {
      const f = (left * TAXI_SPEED) / len
      x = a.x + dx * f
      z = a.z + dz * f
      speed = TAXI_SPEED
      done = true
      break
    }
    left -= move
    x = path[i]!.x
    z = path[i]!.z
  }
  if (!done) {
    const turn = wrapAngle(roll.heading - h)
    h += Math.sign(turn) * Math.min(Math.abs(turn), TAXI_TURN_RATE * left)
  }
  state.orientation.setFromAxisAngle(UP, h)
  state.velocity.set(-Math.sin(h) * speed, 0, -Math.cos(h) * speed)
  state.angularVelocity.set(0, 0, 0)
  state.position.set(x, roll.groundY + GEAR_CLEARANCE, z)
}

/**
 * 推進一步，就地寫 `state`。回傳 **false = 這一步走完了**，呼叫端解開座標鎖。
 *
 * `taxiTime` 之內沿折線滑行；之後到 `delay` 之前停在排隊位置、速度為零。滾行段
 * 的位置取解析解（`½at²`），高度釘在跑道面上方 `GEAR_CLEARANCE`；離地之後沿速度
 * 積分。
 */
export function stepTakeoff(roll: TakeoffRoll, state: PoseState, dt: number): boolean {
  roll.elapsed += dt
  if (roll.taxi !== null && roll.elapsed < roll.taxiTime) {
    taxiPose(roll, roll.taxi, roll.elapsed, state)
    return true
  }
  const t = roll.elapsed - roll.delay
  if (t <= 0) {
    state.orientation.setFromAxisAngle(UP, roll.heading)
    state.velocity.set(0, 0, 0)
    state.angularVelocity.set(0, 0, 0)
    state.position.set(roll.x, roll.groundY + GEAR_CLEARANCE, roll.z)
    return true
  }
  const lift = t - ROLL_SECONDS
  const pitch = lift <= 0 ? 0 : ROTATE_PITCH * Math.min(1, lift / ROTATE_SECONDS)
  state.orientation.setFromAxisAngle(UP, roll.heading).multiply(QP.setFromAxisAngle(RIGHT, pitch))
  state.velocity.set(0, 0, -1).applyQuaternion(state.orientation).multiplyScalar(ACCEL * t)
  state.angularVelocity.set(0, 0, 0)
  if (lift <= 0) {
    const s = 0.5 * ACCEL * t * t
    state.position.set(
      roll.x - Math.sin(roll.heading) * s,
      roll.groundY + GEAR_CLEARANCE,
      roll.z - Math.cos(roll.heading) * s,
    )
  } else {
    state.position.addScaledVector(state.velocity, dt)
  }
  return t < ROLL_SECONDS + CLIMB_SECONDS
}
