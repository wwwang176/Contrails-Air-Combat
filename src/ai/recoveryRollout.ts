import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { applySafety } from './safety'
import type { TerrainSense } from './terrainSense'

export const RECOVERY_ROLLOUT_HZ = 60
export const RECOVERY_ROLLOUT_LIMIT = 20

export interface RecoveryRolloutResult {
  drop: number
  seconds: number
  recovered: boolean
}

/**
 * 在 Worker 的可重用 Aircraft 上執行完整物理改出。呼叫後 `aircraft` 會停在
 * 預演終點；下一筆工作會先由快照完整覆寫，不可把它當正式飛機使用。
 */
export function runRecoveryRollout(
  aircraft: Aircraft,
  command: Command,
  sense: TerrainSense,
  result: RecoveryRolloutResult,
  dt = 1 / RECOVERY_ROLLOUT_HZ,
  limit = RECOVERY_ROLLOUT_LIMIT,
): void {
  const startY = aircraft.state.position.y
  let minY = startY
  if (aircraft.state.velocity.y >= 0) {
    result.drop = 0
    result.seconds = 0
    result.recovered = true
    return
  }

  const steps = Math.ceil(limit / dt)
  for (let i = 0; i < steps; i++) {
    // 把地板放到無限高，強制走正式 ground／terrain 改出命令。
    applySafety(aircraft, Infinity, command, undefined, sense)
    aircraft.update(command.aimWorld, command.throttle, dt, command.brake, command.upright)
    if (aircraft.state.position.y < minY) minY = aircraft.state.position.y
    if (aircraft.state.velocity.y >= 0) {
      result.drop = startY - minY
      result.seconds = (i + 1) * dt
      result.recovered = true
      return
    }
  }
  result.drop = startY - minY
  result.seconds = limit
  result.recovered = false
}
