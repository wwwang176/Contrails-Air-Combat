import { Quaternion, Vector3 } from 'three'
import { headingToward, walkRoute, type PoseState, type RouteMotion } from '../control/takeoffRoll'
import type { GroundTarget } from './groundTargets'

/**
 * # 地面車輛沿路線的移動
 *
 * 位置是**世界時間的純函數**，不積分：`walkRoute` 在第 τ 秒的姿態，
 * τ = 集結位置換算的秒數 + 出發之後經過的秒數。同一個時間永遠得到同一個
 * 位置 —— 重開一場、重播都一樣。
 *
 * 【集結】開場時每一輛已經在路線上的某一點（`offsetSeconds`），出發時刻到了
 * 才開始走。同一條路線上前車在前、後車在後，車速相同所以不會追撞。
 *
 * 【抵達】走完全程就退場：`arrived = true`、`alive = false`，**不走擊毀流程**
 * —— 不推擊毀事件、不算進摧毀數（`battle/setup.ts` 的 `destroyedInPool`）。
 *
 * 熱路徑：不配置。
 */

export interface GroundMotion {
  readonly path: readonly { readonly x: number; readonly z: number }[]
  readonly motion: RouteMotion
  /** 第一段的航向。集結位置都在第一段上，開場的車頭朝這裡 */
  readonly startHeading: number
  /** 最後一段的航向 */
  readonly endHeading: number
  /** 開場時已經在路線上走了幾秒 —— 集結位置 */
  readonly offsetSeconds: number
  /** 世界時間幾秒開始走 */
  readonly departAt: number
  /** 走完全程的秒數 */
  readonly totalSeconds: number
}

/**
 * @param startS 集結位置離路線起點多遠，m（沿路線量）
 */
export function createGroundMotion(
  path: readonly { readonly x: number; readonly z: number }[], motion: RouteMotion,
  startS: number, departAt: number,
): GroundMotion {
  const a = path[0]!
  const b = path[1]!
  const y = path[path.length - 2]!
  const z = path[path.length - 1]!
  const startHeading = headingToward(b.x - a.x, b.z - a.z)
  const endHeading = headingToward(z.x - y.x, z.z - y.z)
  return {
    path, motion, startHeading, endHeading,
    offsetSeconds: startS / motion.speed,
    departAt,
    totalSeconds: walkRoute(path, startHeading, endHeading, Infinity, 0, null, motion),
  }
}

/** 世界時間 `time` 的姿態，就地寫 `out`。回傳 false = 已經走完 */
export function motionPose(m: GroundMotion, time: number, out: PoseState): boolean {
  const moving = time > m.departAt ? time - m.departAt : 0
  const tau = m.offsetSeconds + moving
  if (tau >= m.totalSeconds) return false
  walkRoute(m.path, m.startHeading, m.endHeading, tau, 0, out, m.motion)
  return true
}

const POSE: PoseState = {
  position: /* @__PURE__ */ new Vector3(),
  velocity: /* @__PURE__ */ new Vector3(),
  orientation: /* @__PURE__ */ new Quaternion(),
  angularVelocity: /* @__PURE__ */ new Vector3(),
}

/**
 * 推進一台。沒有 `motion`、已經死了或已經抵達的都不動。
 *
 * @param groundAt 地面高度。與 `World.groundAt` 同一支 —— 車就貼在撞地判定的那個面上
 */
export function stepGroundMotion(
  t: GroundTarget, time: number, groundAt: (x: number, z: number) => number,
): void {
  const m = t.motion
  if (m === null) return
  if (!t.alive) {
    t.speed = 0
    return
  }
  if (!motionPose(m, time, POSE)) {
    t.arrived = true
    t.alive = false
    t.speed = 0
    return
  }
  t.position.set(POSE.position.x, groundAt(POSE.position.x, POSE.position.z), POSE.position.z)
  t.orientation.copy(POSE.orientation)
  t.speed = time > m.departAt ? m.motion.speed : 0
}
