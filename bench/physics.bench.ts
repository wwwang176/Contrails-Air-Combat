import { bench, describe } from 'vitest'
import { Vector3, Quaternion } from 'three'
import { makeScratch } from '../src/core/pool'

/**
 * 物理步微基準。
 *
 * 驗收門檻（spec §3.10）：單步耗時必須 < 20 µs。
 * 超標代表熱路徑存在配置行為造成 GC 壓力，必須先修正。
 *
 * Task 12 完成 dynamics.step 後，此基準會替換為真實負載。
 */
describe('physics step', () => {
  const S = makeScratch(6, 2)
  const position = new Vector3(0, 5000, 0)
  const velocity = new Vector3(0, 0, -160)
  const orientation = new Quaternion()
  const omega = new Vector3(0.1, 0.05, 0.2)
  const dt = 1 / 240

  bench('佔位負載：向量與四元數運算', () => {
    const accel = S.v[0]!.set(0, -9.80665, 0)
    const drag = S.v[1]!.copy(velocity).applyQuaternion(orientation).multiplyScalar(0.001)
    accel.add(drag)
    velocity.addScaledVector(accel, dt)
    position.addScaledVector(velocity, dt)
    const dq = S.q[0]!.set(omega.x * dt * 0.5, omega.y * dt * 0.5, omega.z * dt * 0.5, 1)
    orientation.multiply(dq).normalize()
  })
})
