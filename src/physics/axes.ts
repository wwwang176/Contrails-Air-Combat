import type { Vector3 } from 'three'
import { clamp } from '../core/math'

/**
 * 標準氣動軸分量：x 向前、y 向右、z 向下。
 * 所有 CL/CD/Cm 公式與穩定導數皆以此軸系定義。
 */
export interface StdVec {
  x: number
  y: number
  z: number
}

/**
 * 機體軸 → 標準氣動軸。
 *
 * 機體軸：X 右翼、Y 座艙上方、Z 機尾（機首 = −Z）
 * 標準軸：X 前、Y 右、Z 下
 *   Xs = −Zb    Ys = +Xb    Zs = −Yb
 *
 * 角速度為向量，適用同一轉換：p = −ω.z、q = ω.x、r = −ω.y
 */
export function bodyToStd(v: Vector3, out: StdVec): StdVec {
  out.x = -v.z
  out.y = v.x
  out.z = -v.y
  return out
}

/**
 * 標準氣動軸 → 機體軸。
 * 力 (X, Y, Z) 與力矩 (l, m, n) 共用此轉換，因為兩者都是向量。
 */
export function stdToBody(sx: number, sy: number, sz: number, out: Vector3): Vector3 {
  out.x = sy
  out.y = -sz
  out.z = -sx
  return out
}

/** 迎角，rad。正值代表相對氣流從下方來（機首上仰於飛行路徑）。 */
export function alphaFrom(std: StdVec): number {
  return Math.atan2(std.z, std.x)
}

/** 側滑角，rad。正值代表相對氣流從右方來。 */
export function betaFrom(std: StdVec, tas: number): number {
  if (tas <= 1e-6) return 0
  return Math.asin(clamp(std.y / tas, -1, 1))
}
