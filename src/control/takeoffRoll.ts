import { Quaternion, Vector3 } from 'three'
import { DEG } from '../core/math'

/**
 * # 滾行起飛腳本
 *
 * 停在跑道上的飛機起飛加入戰鬥：貼地滾行 → 抬頭離地 → 初期爬升 → 交還物理。
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

/** 起飛線：世界座標、機首航向（rad，0 = 朝 −Z） */
export interface TakeoffLine {
  readonly x: number
  readonly z: number
  readonly heading: number
}

export interface TakeoffRoll {
  readonly x: number
  readonly z: number
  readonly heading: number
  /** 起飛線上的跑道面高度，m */
  readonly groundY: number
  /** 腳本開始後停在原地幾秒才起步 */
  readonly delay: number
  /** 腳本開始後經過的秒數，含 `delay` */
  elapsed: number
}

export function createTakeoffRoll(
  x: number, z: number, heading: number, groundY: number, delay = 0,
): TakeoffRoll {
  return { x, z, heading, groundY, delay, elapsed: 0 }
}

/** 滾行段的加速度，m/s²。整段等加速 */
const ACCEL = LIFTOFF_SPEED / ROLL_SECONDS

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const RIGHT = /* @__PURE__ */ new Vector3(1, 0, 0)
const QP = /* @__PURE__ */ new Quaternion()

/**
 * 推進一步，就地寫 `state`。回傳 **false = 這一步走完了**，呼叫端解開座標鎖。
 *
 * `delay` 之內停在起飛線上、速度為零。滾行段的位置取解析解（`½at²`），高度釘在
 * 跑道面上方 `GEAR_CLEARANCE`；離地之後沿速度積分。
 */
export function stepTakeoff(
  roll: TakeoffRoll,
  state: { position: Vector3; velocity: Vector3; orientation: Quaternion; angularVelocity: Vector3 },
  dt: number,
): boolean {
  roll.elapsed += dt
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
