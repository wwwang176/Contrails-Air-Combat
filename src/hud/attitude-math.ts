import type { Quaternion } from 'three'
import { makeScratch } from '../core/pool'
import { clamp } from '../core/math'

const S = makeScratch(4)

export interface Attitude {
  /** 滾轉角，rad，右滾為正 */
  roll: number
  /** 俯仰角，rad，上仰為正 */
  pitch: number
}

/** 由機體姿態四元數取出滾轉與俯仰角。 */
export function attitudeFromOrientation(orientation: Quaternion): Attitude {
  const forward = S.v[0]!.set(0, 0, -1).applyQuaternion(orientation)
  const up = S.v[1]!.set(0, 1, 0).applyQuaternion(orientation)
  const right = S.v[2]!.set(1, 0, 0).applyQuaternion(orientation)
  return {
    pitch: Math.asin(clamp(forward.y, -1, 1)),
    roll: Math.atan2(-right.y, up.y),
  }
}

/** 航向角，rad。0 為 −Z 方向，順時針（往 +X）為正。 */
export function headingFromOrientation(orientation: Quaternion): number {
  const forward = S.v[3]!.set(0, 0, -1).applyQuaternion(orientation)
  return Math.atan2(forward.x, -forward.z)
}
