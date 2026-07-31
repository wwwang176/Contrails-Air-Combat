import type { Quaternion, Vector3 } from 'three'

/** 飛機的完整運動狀態。position/velocity 為世界座標，angularVelocity 為機體座標。 */
export interface FlightState {
  position: Vector3
  velocity: Vector3
  /** 機體 → 世界 */
  orientation: Quaternion
  /** 機體座標，rad/s */
  angularVelocity: Vector3
}

/** 舵面與油門指令。舵面 −1..1，油門 0..1.1（>1 為 WEP）。 */
export interface Controls {
  aileron: number
  elevator: number
  rudder: number
  throttle: number
}

export interface AirData {
  /** kg/m³ */
  density: number
  /** Pa */
  pressure: number
  /** K */
  temperature: number
  /** m/s */
  soundSpeed: number
  /** 密度比 ρ/ρ₀ */
  sigma: number
}

export interface AeroState {
  /** 真空速，m/s */
  tas: number
  /** 迎角，rad */
  alpha: number
  /** 側滑角，rad */
  beta: number
  /** 動壓，Pa */
  qbar: number
  mach: number
}

/** 機體座標下的力與力矩。 */
export interface ForceMoment {
  force: Vector3
  moment: Vector3
}
