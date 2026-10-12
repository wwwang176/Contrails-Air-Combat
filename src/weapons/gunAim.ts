import { DEG } from '../core/math'

/**
 * # 砲塔的角度
 *
 * 地面砲位與 T-34 的砲塔轉向（SPEC `2026-10-08-gun-traverse-design.md`）。純畫面。
 *
 * 模型的砲口朝 −Z。yaw 繞 +Y（正值往左轉）、pitch 繞 +X（正值往上抬）。純函式、不配置。
 */

/** 砲位的仰角上限。90° 時砲管直直朝天，從上方看只剩一個點 */
export const GUN_PITCH_MAX = 85 * DEG
/** 砲位的仰角下限 */
export const GUN_PITCH_MIN = -5 * DEG
/**
 * 水平分量對長度的比例小於它時，yaw 沿用上一幀。砲位沒目標時瞄準方向回到正上方
 * （`shipGuns.ts` 的 `axisOf`），atan2(0, 0) 會讓砲塔一幀跳回正前方
 */
export const GUN_YAW_HOLD = 0.02
/** T-34 與反坦克砲的水平轉速，rad/s。**起始值，由試玩裁定** */
export const TANK_TRAVERSE_RATE = 20 * DEG
export const TANK_PITCH_MIN = -5 * DEG
export const TANK_PITCH_MAX = 25 * DEG

/**
 * 本體座標的方向 → yaw／pitch，寫進 `out`。**不必是單位向量**：坦克那一支傳的是到目標的位移。
 *
 * @param prevYaw 上一幀的 yaw；幾乎朝正上方或長度 0 時沿用
 * @param prevPitch 上一幀的 pitch；長度 0 時沿用
 */
export function aimAngles(
  x: number, y: number, z: number, prevYaw: number, prevPitch: number,
  pitchMin: number, pitchMax: number, out: { yaw: number; pitch: number },
): void {
  const flat = Math.hypot(x, z)
  const len = Math.hypot(flat, y)
  if (!(len > 0)) {
    out.yaw = prevYaw
    out.pitch = prevPitch
    return
  }
  out.yaw = flat / len < GUN_YAW_HOLD ? prevYaw : Math.atan2(-x, -z)
  out.pitch = Math.min(pitchMax, Math.max(pitchMin, Math.atan2(y, flat)))
}

/** 從 `yaw` 往 `want` 以 `rate·dt` 轉，走短的那一邊；結果收在 (−π, π] */
export function slewYaw(yaw: number, want: number, rate: number, dt: number): number {
  let d = want - yaw
  d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI
  const step = rate * dt
  if (Math.abs(d) <= step) return want
  let y = yaw + Math.sign(d) * step
  if (y > Math.PI) y -= 2 * Math.PI
  else if (y <= -Math.PI) y += 2 * Math.PI
  return y
}
