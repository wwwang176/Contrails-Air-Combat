import { Vector3, Quaternion } from 'three'
import { makeScratch, type Scratch } from '../src/core/pool'

/**
 * 佔位物理步負載：向量與四元數運算，用於效能基準與守門測試共用同一份定義。
 *
 * ★ 單一替換點：Task 12 完成 src/core/dynamics.ts 的 stepDynamics 後，
 *   只需修改本檔案（改為呼叫真正的 stepDynamics），bench/physics.bench.ts 與
 *   test/unit/perf-gate.test.ts 會自動套用真實負載，無需個別修改兩處。
 */
export interface PlaceholderPhysicsState {
  readonly scratch: Scratch
  readonly position: Vector3
  readonly velocity: Vector3
  readonly orientation: Quaternion
  readonly omega: Vector3
  readonly dt: number
}

export function createPlaceholderPhysicsState(): PlaceholderPhysicsState {
  return {
    scratch: makeScratch(6, 2),
    position: new Vector3(0, 5000, 0),
    velocity: new Vector3(0, 0, -160),
    orientation: new Quaternion(),
    omega: new Vector3(0.1, 0.05, 0.2),
    dt: 1 / 240,
  }
}

/** 佔位負載本體：重力 + 阻力向量運算 + 四元數增量旋轉。熱路徑安全，無配置行為。 */
export function stepPlaceholderPhysics(state: PlaceholderPhysicsState): void {
  const { scratch: S, position, velocity, orientation, omega, dt } = state
  const accel = S.v[0]!.set(0, -9.80665, 0)
  const drag = S.v[1]!.copy(velocity).applyQuaternion(orientation).multiplyScalar(0.001)
  accel.add(drag)
  velocity.addScaledVector(accel, dt)
  position.addScaledVector(velocity, dt)
  const dq = S.q[0]!.set(omega.x * dt * 0.5, omega.y * dt * 0.5, omega.z * dt * 0.5, 1)
  orientation.multiply(dq).normalize()
}
