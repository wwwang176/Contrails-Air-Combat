import { Vector3, type Quaternion } from 'three'

/** 平面路徑的移動參數；由飛機或車輛自行決定。 */
export interface RouteMotion {
  readonly speed: number
  readonly turnRadius: number
  readonly turnRate: number
}

export interface RoutePoint {
  readonly x: number
  readonly z: number
}

export type PoseState = { position: Vector3; velocity: Vector3; orientation: Quaternion; angularVelocity: Vector3 }

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

/** 往 (dx, dz) 走時的機首航向。與 `FWD` 同一套：機首是 (−sin h, 0, −cos h) */
export function headingToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/** 角度差收進 [−π, π] */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI))
}

/**
 * 折線拆成的直線段。**模組層的暫存，`walkRoute` 每次重填** —— 熱路徑不配置。
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
 * 負的。夾到之後這個轉角的實際半徑比 `radius` 小，轉得更急。
 *
 * 【半角接近 90° 時 tan 會爆】折返那種角度夾在 1.4 rad（約 80°）。
 */
function cornerTrim(turn: number, prevLen: number, nextLen: number, radius: number): number {
  const half = Math.min(Math.abs(turn) / 2, 1.4)
  return Math.min(radius * Math.tan(half), prevLen * 0.45, nextLen * 0.45)
}

/** 把折線填進暫存，回傳段數 */
function buildSegments(path: readonly RoutePoint[], radius: number): number {
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
      ? cornerTrim(wrapAngle(SEG_H[i + 1]! - SEG_H[i]!), SEG_LEN[i]!, SEG_LEN[i + 1]!, radius)
      : 0
  }
  return n
}

/**
 * `walkRoute` 走訪中的狀態。**模組層的暫存，每次呼叫開頭重設** —— 原地轉與
 * 弧段寫成模組層函式而不是閉包，熱路徑因此不配置（車隊每一步每一輛都呼叫）。
 */
let wT = 0
let wH = 0
let wX = 0
let wZ = 0
let wSpeed = 0
let wLeft = 0

/** 原地轉到 `to`。回傳 true = 預算在轉的途中用完 */
function pivotTo(to: number, rate: number, hasState: boolean): boolean {
  const turn = wrapAngle(to - wH)
  const secs = Math.abs(turn) / rate
  wT += secs
  if (!hasState || wLeft > secs) {
    wLeft -= secs
    wH = to
    return false
  }
  wH += Math.sign(turn) * rate * wLeft
  wSpeed = 0
  return true
}

/** 沿以 `r` 為半徑、起始航向 `hi` 的圓弧走 `tau` 秒 */
function arcAt(hi: number, k: number, s: number, r: number, tau: number, speed: number): void {
  const nh = hi + k * tau
  wX += s * r * (Math.cos(nh) - Math.cos(hi))
  wZ -= s * r * (Math.sin(nh) - Math.sin(hi))
  wH = nh
  wSpeed = speed
}

/**
 * 沿折線走完要幾秒；`state` 不為 null 時同時寫下第 `budget` 秒的姿態，機體原點
 * 的高度是 `y`。
 *
 * 順序是：原地轉到第一段的方向 → 直線段與轉角圓弧交替 → 最後原地轉到
 * `endHeading`。起點與終點的航向就是第一段與最後一段的方向時，頭尾不花時間。
 *
 * 【頭尾為什麼仍然原地轉】滑行的飛機在那兩處本來就是靜止的：一次是還停在
 * 格子裡、一次是已經排在起飛線上等。中途的轉角才是「停下來轉再走」看起來
 * 最怪的地方。
 *
 * 熱路徑：不配置。
 */
export function walkRoute(
  path: readonly RoutePoint[], startHeading: number, endHeading: number,
  budget: number, y: number, state: PoseState | null, motion: RouteMotion,
): number {
  const hasState = state !== null
  const speed = motion.speed
  segCount = buildSegments(path, motion.turnRadius)
  wT = 0
  wH = startHeading
  wX = path[0]!.x
  wZ = path[0]!.z
  wSpeed = 0
  wLeft = budget

  let stop = segCount > 0 && pivotTo(SEG_H[0]!, motion.turnRate, hasState)
  for (let i = 0; i < segCount && !stop; i++) {
    const hi = SEG_H[i]!
    const trimIn = i > 0 ? SEG_TRIM[i - 1]! : 0
    const straight = Math.max(0, SEG_LEN[i]! - trimIn - SEG_TRIM[i]!)
    const sx = SEG_AX[i]! - Math.sin(hi) * trimIn
    const sz = SEG_AZ[i]! - Math.cos(hi) * trimIn
    const secs = straight / speed
    wT += secs
    if (hasState && wLeft <= secs) {
      const d = wLeft * speed
      wX = sx - Math.sin(hi) * d
      wZ = sz - Math.cos(hi) * d
      wSpeed = speed
      wH = hi
      stop = true
      break
    }
    wLeft -= secs
    wX = sx - Math.sin(hi) * straight
    wZ = sz - Math.cos(hi) * straight
    wH = hi

    // 轉角：以 r 為半徑邊走邊轉。`SEG_TRIM` 為 0（末段或兩段共線）時不進來
    const trim = SEG_TRIM[i]!
    if (trim <= 0) continue
    const turn = wrapAngle(SEG_H[i + 1]! - hi)
    const r = trim / Math.tan(Math.min(Math.abs(turn) / 2, 1.4))
    const arc = (Math.abs(turn) * r) / speed
    wT += arc
    const s = Math.sign(turn)
    const k = (s * speed) / r
    if (hasState && wLeft <= arc) {
      arcAt(hi, k, s, r, wLeft, speed)
      stop = true
      break
    }
    wLeft -= arc
    arcAt(hi, k, s, r, arc, speed)
  }
  if (!stop) stop = pivotTo(endHeading, motion.turnRate, hasState)

  if (state !== null) {
    state.orientation.setFromAxisAngle(UP, wH)
    state.velocity.set(-Math.sin(wH) * wSpeed, 0, -Math.cos(wH) * wSpeed)
    state.angularVelocity.set(0, 0, 0)
    state.position.set(wX, y, wZ)
  }
  return wT
}
