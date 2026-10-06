import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { RecoveryTrialStatus } from './recoveryWorkerClient'

type CaptureAircraft = { readonly state: Pick<Aircraft['state'], 'velocity' | 'orientation'> }
type CaptureCommand = Pick<Command, 'aimWorld' | 'firing' | 'bombing'>

const FWD = new Vector3(0, 0, -1)

export interface GroundCaptureState {
  active: boolean
  armed: boolean
}

export interface GroundReleaseGate {
  safeSince: number
  sequence: number
}

export const GROUND_RELEASE_TRIAL_SECONDS = 0.5

export const GROUND_RELEASE_SAFE_SECONDS = 0.5

/**
 * 保留戰鬥 AI 要去的水平方位，只把俯仰收回水平。這是硬改出後的
 * 「止跌」，不是固定爬升角；因此不會把一次小拉起擴大成高幅豚跳。
 */
export function captureLevel(self: CaptureAircraft, out: CaptureCommand): void {
  let x = out.aimWorld.x
  let z = out.aimWorld.z
  let h = Math.hypot(x, z)
  if (h <= 1e-6) {
    x = self.state.velocity.x
    z = self.state.velocity.z
    h = Math.hypot(x, z)
  }
  if (h <= 1e-6) {
    out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
    x = out.aimWorld.x
    z = out.aimWorld.z
    h = Math.hypot(x, z)
  }
  if (h > 1e-6) out.aimWorld.set(x / h, 0, z / h)
  else out.aimWorld.set(0, 0, -1)
  out.firing = false
  out.bombing = false
}

/**
 * Worker 尚未證明低頭命令安全時，先用很淺的爬升累積下一次進場的改出空間。
 * 這只延續已觸發的硬改出，不是平時對地瞄準的最低高度偏好。
 */
export function captureGroundBuffer(self: CaptureAircraft, out: CaptureCommand): void {
  captureLevel(self, out)
  const climb = Math.PI / 30
  const horizontal = Math.cos(climb)
  out.aimWorld.x *= horizontal
  out.aimWorld.y = Math.sin(climb)
  out.aimWorld.z *= horizontal
}

/**
 * 對地低頭命令解除水平捕獲的閘門。Worker 必須連續證明「先照候選命令飛
 * 0.5 秒仍能改出」達 0.5 秒，而且實際下降已收住，才准交還。
 */
export function stepGroundReleaseCapture(
  capture: GroundCaptureState,
  gate: GroundReleaseGate,
  hardGround: boolean,
  downwardAim: boolean,
  velocityY: number,
  trialSequence: number,
  trialSentAt: number,
  trialStatus: RecoveryTrialStatus,
): boolean {
  if (hardGround) {
    capture.active = true
    capture.armed = false
    gate.safeSince = -1
    gate.sequence = trialSequence
    return false
  }
  if (!capture.active) return false
  if (!downwardAim) {
    capture.active = false
    capture.armed = false
    gate.safeSince = -1
    gate.sequence = trialSequence
    return false
  }
  if (trialSequence >= 0 && trialSequence !== gate.sequence) {
    gate.sequence = trialSequence
    if (trialStatus === 'safe') {
      if (gate.safeSince < 0) gate.safeSince = trialSentAt
    } else if (trialStatus === 'unsafe') {
      gate.safeSince = -1
    }
  }
  if (
    trialStatus === 'safe'
    && gate.safeSince >= 0
    && trialSentAt - gate.safeSince >= GROUND_RELEASE_SAFE_SECONDS
    && velocityY >= -2
  ) {
    capture.active = false
    capture.armed = false
    gate.safeSince = -1
    return false
  }
  return true
}
