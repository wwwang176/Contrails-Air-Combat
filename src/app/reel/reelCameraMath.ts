import { Vector3 } from 'three'
import type { ReelCamera } from './reelTypes'

const AIM_A = new Vector3()
const AIM_B = new Vector3()
const DUTCH_F = new Vector3()
const DUTCH_R = new Vector3()

/** 從同一個鏡頭位置混合兩個注視方向，不配置記憶體 */
export function aimBetween(from: Vector3, a: Vector3, b: Vector3, weight: number, out: Vector3): Vector3 {
  AIM_A.subVectors(a, from).normalize().multiplyScalar(100 * (1 - weight))
  AIM_B.subVectors(b, from).normalize().multiplyScalar(100 * weight)
  return out.copy(from).add(AIM_A).add(AIM_B)
}

/** 疊上共用的短促衝擊震動包絡 */
export function jolt(t: number, t0: number, amp: number, out: Vector3): Vector3 {
  const u = t - t0
  if (u < 0 || u > 0.6) return out
  const k = amp * Math.exp(-u / 0.18)
  out.x += k * Math.sin(2 * Math.PI * 5.3 * u)
  out.y += k * Math.sin(2 * Math.PI * 4.1 * u + 1)
  return out
}

/** 讓短片鏡頭繞目前的視線方向滾轉 */
export function dutch(out: ReelCamera, degrees: number): void {
  DUTCH_F.subVectors(out.target, out.position).normalize()
  DUTCH_R.crossVectors(DUTCH_F, out.up).normalize()
  out.up.copy(DUTCH_R).cross(DUTCH_F)
  const angle = (degrees * Math.PI) / 180
  out.up.multiplyScalar(Math.cos(angle)).addScaledVector(DUTCH_R, Math.sin(angle))
}
