import { Quaternion, Vector3 } from 'three'
import { DEG } from '../core/math'
import { PARKED_TAIL_DOWN } from '../specs/ground'
import { walkRoute, type PoseState, type RouteMotion, type RoutePoint as TaxiPoint } from '../core/routeMotion'

export type { PoseState, RoutePoint as TaxiPoint } from '../core/routeMotion'

/**
 * # 滑行與滾行起飛腳本
 *
 * 停在地上的飛機起飛加入戰鬥：沿滑行道進入跑道 → 保持抬頭加速
 * → 離地後逐漸放平 → 交還物理。
 * **位置由這一支驅動，物理積分跳過**（`World.step` 讀 `Combatant.takeoff`）——
 * 飛行模型沒有地面與起落架，讓它自己在跑道上加速會陷進地面或直接被撞地判定
 * 殺掉。
 *
 * 【交還時速度要接得上】地面速度沿跑道，離地後沿機首方向，交還那一步
 * 物理拿到的就是當下的速度向量。歸零或換成開局速度的話，飛機會在跑道頭
 * 失速掉下來或瞬間彈出去。
 *
 * 熱路徑：不配置。
 */

/** 滾行到離地的秒數。**起始值，由試飛裁定** */
export const ROLL_SECONDS = 12
/** 離地速度，m/s（約 180 km/h） */
export const LIFTOFF_SPEED = 50
/** 地面維持尾輪機的抬頭姿態；離地後由這個角度逐漸放平。 */
export const ROTATE_PITCH = PARKED_TAIL_DOWN
/** 離地後由抬頭漸變成水平的秒數 */
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
/** 後一架比前一架晚幾秒開始滾行。**用在直接生在起飛線上的那一種** —— 那時每一架
 * 已經前後錯開 `TAKEOFF_TRAIL` */
export const TAKEOFF_STAGGER = 1
/**
 * 從同一個起飛點滾行時，前後兩架至少差幾秒。
 *
 * 【為什麼要比 `TAKEOFF_STAGGER` 大得多】滑行過來的那一種是四架滑到**同一點**
 * 才滾行，位置上沒有間隔。加速度是 `LIFTOFF_SPEED / ROLL_SECONDS`（約
 * 4.2 m/s²）；從靜止起步 5 秒後已經跑出 52 m，承接滑行速度時更遠。
 */
export const TAKEOFF_ROLL_GAP = 5
/** 滑行速度，m/s（約 29 km/h）。**起始值，由試飛裁定** */
export const TAXI_SPEED = 8
/** 滑行的轉向角速度。**起始值，由試飛裁定** */
export const TAXI_TURN_RATE = 90 * DEG
/**
 * 轉彎半徑，m：邊走邊轉，半徑就是速度除以角速度。
 *
 * 【為什麼不是原地轉】停下來轉再走是履帶車，不是飛機。折線的轉角因此改成
 * 內切的圓弧：提前 `半徑 × tan(轉角/2)` 離開直線段，轉完再接上下一段。
 * 兩段都夠長時弧上的時間與原地轉一樣（`|轉角| ÷ 角速度`），差別在直線段
 * 各短了那個切入距離。
 */
export const TAXI_TURN_RADIUS = TAXI_SPEED / TAXI_TURN_RATE

export const TAXI_MOTION: RouteMotion = {
  speed: TAXI_SPEED, turnRadius: TAXI_TURN_RADIUS, turnRate: TAXI_TURN_RATE,
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

/** 沿折線滑完、最後轉到 `endHeading` 要幾秒。轉角是圓弧，見 `TAXI_TURN_RADIUS` */
export function taxiSeconds(path: readonly TaxiPoint[], startHeading: number, endHeading: number): number {
  return walkRoute(path, startHeading, endHeading, Infinity, 0, null, TAXI_MOTION)
}

/** 地面模型的原點在滾行期間平順移到飛行原點；兩端斜率為零。 */
export function takeoffOriginBlend(roll: TakeoffRoll | null): number {
  if (roll === null) return 0
  const k = Math.min(1, Math.max(0, (roll.elapsed - roll.delay) / ROLL_SECONDS))
  return k * k * (3 - 2 * k)
}

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const RIGHT = /* @__PURE__ */ new Vector3(1, 0, 0)
const QP = /* @__PURE__ */ new Quaternion()

/**
 * 滑行開始後第 `time` 秒的姿態，就地寫 `state`。是 `time` 的純函數，不積分 ——
 * 位置因此永遠貼著折線（轉角處在內切的圓弧上）。
 */
function taxiPose(roll: TakeoffRoll, plan: TaxiPlan, time: number, state: PoseState): void {
  walkRoute(plan.path, plan.startHeading, roll.heading, time, roll.groundY + GEAR_CLEARANCE, state, TAXI_MOTION)
  state.orientation.multiply(QP.setFromAxisAngle(RIGHT, ROTATE_PITCH))
}

/**
 * 推進一步，就地寫 `state`。回傳 **false = 這一步走完了**，呼叫端解開座標鎖。
 *
 * `taxiTime` 之內沿折線滑行；之後到 `delay` 之前停在排隊位置、速度為零。滾行段
 * 的位置取解析解（`v₀t + ½at²`），高度釘在跑道面上方 `GEAR_CLEARANCE`；離地之後沿速度
 * 積分。
 */
export function stepTakeoff(roll: TakeoffRoll, state: PoseState, dt: number): boolean {
  roll.elapsed += dt
  if (roll.taxi !== null && roll.elapsed < roll.taxiTime) {
    taxiPose(roll, roll.taxi, roll.elapsed, state)
    return true
  }
  const t = roll.elapsed - roll.delay
  if (t < 0) {
    state.orientation.setFromAxisAngle(UP, roll.heading).multiply(QP.setFromAxisAngle(RIGHT, ROTATE_PITCH))
    state.velocity.set(0, 0, 0)
    state.angularVelocity.set(0, 0, 0)
    state.position.set(roll.x, roll.groundY + GEAR_CLEARANCE, roll.z)
    return true
  }
  // 滑到就走承接滑行速度；實際停等過或直接生在跑道的飛機從靜止起步。
  const initialSpeed = roll.taxi !== null && roll.delay <= roll.taxiTime + 1e-9 ? TAXI_SPEED : 0
  const accel = (LIFTOFF_SPEED - initialSpeed) / ROLL_SECONDS
  const lift = t - ROLL_SECONDS
  const k = Math.min(1, Math.max(0, lift / ROTATE_SECONDS))
  const pitch = ROTATE_PITCH * (1 - k * k * (3 - 2 * k))
  state.orientation.setFromAxisAngle(UP, roll.heading).multiply(QP.setFromAxisAngle(RIGHT, pitch))
  const flightPitch = lift > 0 ? pitch : 0
  state.velocity.set(-Math.sin(roll.heading) * Math.cos(flightPitch), Math.sin(flightPitch), -Math.cos(roll.heading) * Math.cos(flightPitch))
    .multiplyScalar(initialSpeed + accel * t)
  state.angularVelocity.set(0, 0, 0)
  if (lift <= 0) {
    const s = initialSpeed * t + 0.5 * accel * t * t
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
