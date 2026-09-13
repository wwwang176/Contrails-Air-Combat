import type { Aircraft } from '../aircraft/Aircraft'
import { RECOVERY_SNAPSHOT_SIZE } from './recoveryProtocol'

export { RECOVERY_SNAPSHOT_SIZE } from './recoveryProtocol'

/**
 * 把預演所需狀態寫進預先配置的陣列。這支在 AI 更新路徑上，不得配置物件。
 */
export function writeRecoverySnapshot(a: Aircraft, out: Float64Array): void {
  if (out.length < RECOVERY_SNAPSHOT_SIZE) throw new Error('防墜快照長度不足')
  let i = 0
  const p = a.state.position
  out[i++] = p.x; out[i++] = p.y; out[i++] = p.z
  const v = a.state.velocity
  out[i++] = v.x; out[i++] = v.y; out[i++] = v.z
  const q = a.state.orientation
  out[i++] = q.x; out[i++] = q.y; out[i++] = q.z; out[i++] = q.w
  const w = a.state.angularVelocity
  out[i++] = w.x; out[i++] = w.y; out[i++] = w.z
  const c = a.controls
  out[i++] = c.aileron; out[i++] = c.elevator; out[i++] = c.rudder
  out[i++] = c.throttle; out[i++] = c.brake
  const s = a.surfaces
  out[i++] = s.aileron; out[i++] = s.elevator; out[i++] = s.rudder
  out[i++] = s.throttle; out[i++] = s.brake
  out[i++] = a.diag.loadFactor
  out[i++] = a.diag.slatsDeployed ? 1 : 0
  out[i++] = a.diag.controlAuthority
  i = a.director.writeState(out, i)
  if (i !== RECOVERY_SNAPSHOT_SIZE) throw new Error(`防墜快照欄位數錯誤：${i}`)
}

/** Worker 端把固定長度快照覆寫到可重用的 Aircraft。 */
export function readRecoverySnapshot(a: Aircraft, source: Float64Array): void {
  if (source.length < RECOVERY_SNAPSHOT_SIZE) throw new Error('防墜快照長度不足')
  let i = 0
  a.state.position.set(source[i++]!, source[i++]!, source[i++]!)
  a.state.velocity.set(source[i++]!, source[i++]!, source[i++]!)
  a.state.orientation.set(source[i++]!, source[i++]!, source[i++]!, source[i++]!)
  a.state.angularVelocity.set(source[i++]!, source[i++]!, source[i++]!)
  a.controls.aileron = source[i++]!
  a.controls.elevator = source[i++]!
  a.controls.rudder = source[i++]!
  a.controls.throttle = source[i++]!
  a.controls.brake = source[i++]!
  a.surfaces.aileron = source[i++]!
  a.surfaces.elevator = source[i++]!
  a.surfaces.rudder = source[i++]!
  a.surfaces.throttle = source[i++]!
  a.surfaces.brake = source[i++]!
  a.diag.loadFactor = source[i++]!
  a.diag.slatsDeployed = source[i++]! !== 0
  a.diag.controlAuthority = source[i++]!
  i = a.director.readState(source, i)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  if (i !== RECOVERY_SNAPSHOT_SIZE) throw new Error(`防墜快照欄位數錯誤：${i}`)
}
