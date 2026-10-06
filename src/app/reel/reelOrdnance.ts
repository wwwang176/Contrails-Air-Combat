import { Vector3 } from 'three'
import type { OrdnancePool } from '../../render/bombs'

/**
 * 放映機的投射物狀態。位置與速度沿用外觀池的 typed arrays；額外欄位只保存
 * 投下時間、魚雷瞄點與事件序號，讓短片更新不需要配置暫存物件。
 */
export interface ReelOrdnance extends OrdnancePool {
  readonly t0: Float64Array
  readonly p0: Vector3[]
  readonly v0: Vector3[]
  readonly entry: Float64Array
  readonly aimX: Float64Array
  readonly aimZ: Float64Array
  readonly hit: Uint8Array
  readonly phase: Int8Array
  readonly serial: Int32Array
  next: number
}

export function createReelOrdnance(capacity: number): ReelOrdnance {
  const f = (): Float64Array => new Float64Array(capacity)
  return {
    active: new Uint8Array(capacity), x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(),
    t0: f(), p0: Array.from({ length: capacity }, () => new Vector3()),
    v0: Array.from({ length: capacity }, () => new Vector3()),
    entry: f(), aimX: f(), aimZ: f(), hit: new Uint8Array(capacity),
    phase: new Int8Array(capacity), serial: new Int32Array(capacity), next: 0,
  }
}
