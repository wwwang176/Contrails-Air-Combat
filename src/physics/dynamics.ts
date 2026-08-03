import { Quaternion, Vector3 } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import { atmosphere } from './atmosphere'
import {
  aeroForceMoment, computeAeroState, lowSpeedEffectiveness, updateSlatState,
} from './aero'
import { enginePower, propThrust } from './propulsion'
import type { AircraftSpec } from '../specs/types'
import type { AeroState, AirData, Controls, FlightState, ForceMoment } from './types'

const S = makeScratch(6, 2)

export interface StepDiagnostics {
  air: AirData
  aero: AeroState
  /** N */
  thrustN: number
  /** W */
  powerW: number
  /** 機體 Y 方向比力 / g */
  loadFactor: number
  /**
   * 前緣縫翼是否展開。同時是輸入與輸出——承載遲滯狀態，
   * 呼叫端必須沿用同一個物件，不可每步重建。
   */
  slatsDeployed: boolean
  /**
   * 低速舵面效力，0..1。1 = 完全有效。
   *
   * 【為什麼放在 diag 而不是各自重算】HUD 要顯示的正是這個乘數。走
   * diag 讓物理與畫面共用同一份數字，不會出現第二套會漂掉的判斷邏輯
   * （低速操控權 spec §6）。
   */
  controlAuthority: number
}

export function createDiagnostics(): StepDiagnostics {
  return {
    air: { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 },
    aero: { tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 },
    thrustN: 0,
    powerW: 0,
    loadFactor: 0,
    slatsDeployed: false,
    controlAuthority: 1,
  }
}

/** 建立平飛初始狀態：機首朝 −Z，速度沿機首方向。 */
export function createFlightState(altitude: number, tas: number): FlightState {
  return {
    position: new Vector3(0, altitude, 0),
    velocity: new Vector3(0, 0, -tas),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
  }
}

const fm: ForceMoment = { force: new Vector3(), moment: new Vector3() }

/** 單一物理步。熱路徑，禁止任何配置行為。 */
export function stepDynamics(
  spec: AircraftSpec,
  state: FlightState,
  controls: Controls,
  dt: number,
  diag: StepDiagnostics,
): void {
  const invQ = S.q[0]!.copy(state.orientation).invert()
  const velBody = S.v[0]!.copy(state.velocity).applyQuaternion(invQ)

  atmosphere(state.position.y, diag.air)
  computeAeroState(velBody, diag.air, diag.aero)
  // 【放在 aeroForceMoment 之前是刻意的】後者在 qbar <= 0 時提早回傳；
  // 若擺在它後面，靜止狀態下 controlAuthority 會停在上一步的舊值。
  diag.controlAuthority = lowSpeedEffectiveness(spec, diag.aero.qbar)
  diag.slatsDeployed = updateSlatState(spec, diag.aero.alpha, diag.slatsDeployed)

  aeroForceMoment(spec, diag.aero, state.angularVelocity, controls, diag.slatsDeployed, fm)

  diag.powerW = enginePower(spec, diag.air, diag.aero.mach, controls.throttle)
  diag.thrustN = propThrust(spec, diag.powerW, diag.aero.tas, diag.air)

  // 推力沿機首方向（機體 −Z）
  const totalBody = S.v[1]!.copy(fm.force)
  totalBody.z -= diag.thrustN

  diag.loadFactor = totalBody.y / (spec.mass * G0)

  // 比力轉世界座標，再加重力
  const accel = S.v[2]!.copy(totalBody).divideScalar(spec.mass).applyQuaternion(state.orientation)
  accel.y -= G0

  // 半隱式 Euler：先速度後位置
  state.velocity.addScaledVector(accel, dt)
  state.position.addScaledVector(state.velocity, dt)

  // 角加速度 = I⁻¹(M − ω × Iω)
  const I = spec.inertia
  const w = state.angularVelocity
  const Iw = S.v[3]!.set(w.x * I.pitch, w.y * I.yaw, w.z * I.roll)
  const gyro = S.v[4]!.copy(w).cross(Iw)
  const alpha = S.v[5]!.set(
    (fm.moment.x - gyro.x) / I.pitch,
    (fm.moment.y - gyro.y) / I.yaw,
    (fm.moment.z - gyro.z) / I.roll,
  )
  w.addScaledVector(alpha, dt)

  // 四元數積分：q ← q ⊗ (1, ½ω·dt)，一階近似，240Hz 下誤差可忽略
  const dq = S.q[1]!.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1)
  state.orientation.multiply(dq).normalize()
}
