import type { InputState, StickRecenter } from './InputState'

/**
 * # 滑鼠搖桿
 *
 * 滑鼠是一支虛擬搖桿：滑鼠位移推動搖桿位置（`stepStick`），位置過死區與曲線
 * （`shapeStick`）之後才是送進指令的桿量（`Command.stickRoll/stickPitch`）。
 *
 * 以下數字都是**起始值，由試玩裁定**。
 */

/**
 * 滑鼠位移（`aimDeltaX/Y` 的單位，已乘設定頁靈敏度與 `MOUSE_SENSITIVITY` 1.6）→ 搖桿位置。
 * 2.5：靈敏度 1 時滑鼠移動約四分之一個螢幕半高（1080p 約 135 px）是滿桿
 */
export const STICK_GAIN = 2.5

/**
 * 回中的時間常數，s。「關」不衰減，是純位置式：壓多少就一直保持多少。
 * 「快」的時候桿量約正比於滑鼠移動速度（穩態桿量 ≈ 滑鼠速度 × `STICK_GAIN` × 時間常數），
 * 手感接近速率式
 */
export const STICK_RECENTER_SECONDS: Readonly<Record<StickRecenter, number>> = {
  off: Infinity,
  slow: 0.8,
  fast: 0.12,
}

/** 徑向死區：滑鼠的微小抖動不讓飛機慢慢滾走 */
export const STICK_DEADZONE = 0.03

/**
 * 指數曲線的權重：`out = E·|s|³ + (1 − E)·|s|`。中段細、末段到滿 —— 瞄準時的
 * 微調不會一碰就甩
 */
export const STICK_EXPO = 0.25

/**
 * 推進一幀：累積這一幀的滑鼠位移、夾進單位圓、回中。
 *
 * 【夾的是圓不是方】方形的話斜推到底比直推到底多 41% 的桿量。
 *
 * @param dt 世界時間步長，s。暫停時是 0，不回中
 */
export function stepStick(
  s: Pick<InputState, 'stickX' | 'stickY' | 'stickRecenter'>, dx: number, dy: number, dt: number,
): void {
  let x = s.stickX + dx * STICK_GAIN
  let y = s.stickY + dy * STICK_GAIN
  const r = Math.hypot(x, y)
  if (r > 1) {
    x /= r
    y /= r
  }
  const tau = STICK_RECENTER_SECONDS[s.stickRecenter]
  if (dt > 0 && Number.isFinite(tau)) {
    const k = Math.exp(-dt / tau)
    x *= k
    y *= k
  }
  s.stickX = x
  s.stickY = y
}

/**
 * 搖桿放回中心、放掉方向舵。控制器重新接上座位、陣亡、有效模式換了、重生、開場導覽時呼叫 ——
 * 不歸零的話上一段壓著的桿量會接著飛
 */
export function centreStick(
  s: Pick<InputState, 'stickX' | 'stickY' | 'rudderLeft' | 'rudderRight'>,
): void {
  s.stickX = 0
  s.stickY = 0
  s.rudderLeft = false
  s.rudderRight = false
}

export interface ShapedStick {
  roll: number
  pitch: number
}

/**
 * 搖桿位置 → 桿量：徑向死區（死區之後把範圍拉回 0…1，滿桿仍是 1），再兩軸各自套
 * 指數曲線。寫進 `out` 並回傳它，不配置
 */
export function shapeStick(x: number, y: number, out: ShapedStick): ShapedStick {
  const r = Math.hypot(x, y)
  if (r <= STICK_DEADZONE) {
    out.roll = 0
    out.pitch = 0
    return out
  }
  const k = (r - STICK_DEADZONE) / (1 - STICK_DEADZONE) / r
  out.roll = expo(x * k)
  out.pitch = expo(y * k)
  return out
}

function expo(v: number): number {
  const a = Math.abs(v)
  return Math.sign(v) * (STICK_EXPO * a * a * a + (1 - STICK_EXPO) * a)
}
