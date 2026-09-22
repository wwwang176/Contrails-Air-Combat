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
/** 後一架比前一架晚幾秒開始滾行。**用在直接生在起飛線上的那一種** —— 那時每一架
 * 已經前後錯開 `TAKEOFF_TRAIL` */
export const TAKEOFF_STAGGER = 1
/**
 * 從同一個起飛點滾行時，前後兩架至少差幾秒。
 *
 * 【為什麼要比 `TAKEOFF_STAGGER` 大得多】滑行過來的那一種是四架滑到**同一點**
 * 才滾行，位置上沒有間隔。加速度是 `LIFTOFF_SPEED / ROLL_SECONDS`（約
 * 4.2 m/s²），5 秒後前一架已經跑出 52 m —— 比 `TAKEOFF_TRAIL` 還寬。
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
 * 折線拆成的直線段。**模組層的暫存，`walkTaxi` 每次重填** —— 熱路徑不配置。
 * 長度為零的段不進來。
 */
const MAX_SEGMENTS = 32
const SEG_AX = /* @__PURE__ */ new Float64Array(MAX_SEGMENTS)
const SEG_AZ = /* @__PURE__ */ new Float64Array(MAX_SEGMENTS)
const SEG_H = /* @__PURE__ */ new Float64Array(MAX_SEGMENTS)
const SEG_LEN = /* @__PURE__ */ new Float64Array(MAX_SEGMENTS)
/** 第 i 段尾端為了接下一段的圓弧，提前多少公尺離開直線 */
const SEG_TRIM = /* @__PURE__ */ new Float64Array(MAX_SEGMENTS)
let segCount = 0

/**
 * 轉角的切入距離，m：`半徑 × tan(|轉角| / 2)`，再夾到兩段長度的 45%。
 *
 * 【夾住的理由】短段上兩端的切入會互相吃掉；夾在 45% 保證直線段不會變成
 * 負的。夾到之後這個轉角的實際半徑比 `TAXI_TURN_RADIUS` 小，轉得更急。
 *
 * 【半角接近 90° 時 tan 會爆】折返那種角度夾在 1.4 rad（約 80°）。
 */
function cornerTrim(turn: number, prevLen: number, nextLen: number): number {
  const half = Math.min(Math.abs(turn) / 2, 1.4)
  return Math.min(TAXI_TURN_RADIUS * Math.tan(half), prevLen * 0.45, nextLen * 0.45)
}

/** 把折線填進暫存，回傳段數 */
function buildSegments(path: readonly TaxiPoint[]): number {
  let n = 0
  for (let i = 1; i < path.length && n < MAX_SEGMENTS; i++) {
    const ax = path[i - 1]!.x
    const az = path[i - 1]!.z
    const dx = path[i]!.x - ax
    const dz = path[i]!.z - az
    const len = Math.hypot(dx, dz)
    if (len === 0) continue
    SEG_AX[n] = ax
    SEG_AZ[n] = az
    SEG_H[n] = headingToward(dx, dz)
    SEG_LEN[n] = len
    n++
  }
  for (let i = 0; i < n; i++) {
    SEG_TRIM[i] = i + 1 < n
      ? cornerTrim(wrapAngle(SEG_H[i + 1]! - SEG_H[i]!), SEG_LEN[i]!, SEG_LEN[i + 1]!)
      : 0
  }
  return n
}

/**
 * 走完這條滑行路線要幾秒；`state` 不為 null 時同時寫下第 `budget` 秒的姿態。
 *
 * 順序是：停機墊上原地轉到第一段的方向 → 直線段與轉角圓弧交替 → 最後原地
 * 轉到 `endHeading`。
 *
 * 【頭尾為什麼仍然原地轉】那兩處飛機本來就是靜止的：一次是還停在格子裡、
 * 一次是已經排在起飛線上等。中途的轉角才是「停下來轉再走」看起來最怪的地方。
 *
 * 熱路徑：不配置。
 */
function walkTaxi(
  path: readonly TaxiPoint[], startHeading: number, endHeading: number,
  budget: number, groundY: number, state: PoseState | null,
): number {
  segCount = buildSegments(path)
  let t = 0
  let h = startHeading
  let x = path[0]!.x
  let z = path[0]!.z
  let speed = 0
  let left = budget

  const pivot = (to: number): boolean => {
    const turn = wrapAngle(to - h)
    const secs = Math.abs(turn) / TAXI_TURN_RATE
    t += secs
    if (state === null || left > secs) {
      left -= secs
      h = to
      return false
    }
    h += Math.sign(turn) * TAXI_TURN_RATE * left
    speed = 0
    return true
  }

  let stop = segCount > 0 && pivot(SEG_H[0]!)
  for (let i = 0; i < segCount && !stop; i++) {
    const hi = SEG_H[i]!
    const trimIn = i > 0 ? SEG_TRIM[i - 1]! : 0
    const straight = Math.max(0, SEG_LEN[i]! - trimIn - SEG_TRIM[i]!)
    const sx = SEG_AX[i]! - Math.sin(hi) * trimIn
    const sz = SEG_AZ[i]! - Math.cos(hi) * trimIn
    const secs = straight / TAXI_SPEED
    t += secs
    if (state !== null && left <= secs) {
      const d = left * TAXI_SPEED
      x = sx - Math.sin(hi) * d
      z = sz - Math.cos(hi) * d
      speed = TAXI_SPEED
      h = hi
      stop = true
      break
    }
    left -= secs
    x = sx - Math.sin(hi) * straight
    z = sz - Math.cos(hi) * straight
    h = hi

    // 轉角：以 r 為半徑邊走邊轉。`SEG_TRIM` 為 0（末段或兩段共線）時不進來
    const trim = SEG_TRIM[i]!
    if (trim <= 0) continue
    const turn = wrapAngle(SEG_H[i + 1]! - hi)
    const r = trim / Math.tan(Math.min(Math.abs(turn) / 2, 1.4))
    const arc = (Math.abs(turn) * r) / TAXI_SPEED
    t += arc
    const s = Math.sign(turn)
    const k = (s * TAXI_SPEED) / r
    const arcAt = (tau: number): void => {
      const nh = hi + k * tau
      x += s * r * (Math.cos(nh) - Math.cos(hi))
      z -= s * r * (Math.sin(nh) - Math.sin(hi))
      h = nh
      speed = TAXI_SPEED
    }
    if (state !== null && left <= arc) {
      arcAt(left)
      stop = true
      break
    }
    left -= arc
    arcAt(arc)
  }
  if (!stop) stop = pivot(endHeading)

  if (state !== null) {
    state.orientation.setFromAxisAngle(UP, h)
    state.velocity.set(-Math.sin(h) * speed, 0, -Math.cos(h) * speed)
    state.angularVelocity.set(0, 0, 0)
    state.position.set(x, groundY + GEAR_CLEARANCE, z)
  }
  return t
}

/** 沿折線滑完、最後轉到 `endHeading` 要幾秒。轉角是圓弧，見 `TAXI_TURN_RADIUS` */
export function taxiSeconds(path: readonly TaxiPoint[], startHeading: number, endHeading: number): number {
  return walkTaxi(path, startHeading, endHeading, Infinity, 0, null)
}

/** 滾行段的加速度，m/s²。整段等加速 */
const ACCEL = LIFTOFF_SPEED / ROLL_SECONDS

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const RIGHT = /* @__PURE__ */ new Vector3(1, 0, 0)
const QP = /* @__PURE__ */ new Quaternion()

type PoseState = { position: Vector3; velocity: Vector3; orientation: Quaternion; angularVelocity: Vector3 }

/**
 * 滑行開始後第 `time` 秒的姿態，就地寫 `state`。是 `time` 的純函數，不積分 ——
 * 位置因此永遠貼著折線（轉角處在內切的圓弧上）。
 */
function taxiPose(roll: TakeoffRoll, plan: TaxiPlan, time: number, state: PoseState): void {
  walkTaxi(plan.path, plan.startHeading, roll.heading, time, roll.groundY, state)
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
