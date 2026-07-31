import type { Vector3 } from 'three'
import { smoothstep } from '../core/math'
import { alphaFrom, betaFrom, bodyToStd, stdToBody, type StdVec } from './axes'
import { derivedClMax, type AircraftSpec } from '../specs/types'
import type { AeroState, AirData, Controls, ForceMoment } from './types'

// 模組私有暫存，避免熱路徑配置。禁止跨模組共用。
const stdVel: StdVec = { x: 0, y: 0, z: 0 }
const stdOmega: StdVec = { x: 0, y: 0, z: 0 }

/** 誘導阻力因子 1/(π·e·AR)。 */
export function inducedDragFactor(spec: AircraftSpec): number {
  const ar = (spec.wing.span * spec.wing.span) / spec.wing.area
  return 1 / (Math.PI * spec.wing.oswald * ar)
}

/**
 * 升力係數。
 *
 * 線性段：CL = clAlpha × (α − α₀)
 * 失速後：以 smoothstep 由 CL_max 平滑崩塌至 postStallFactor × CL_max
 * 深失速：以平板模型 |sin 2α| 的「形狀」延伸，但縮放使其在交接點
 * blendEnd 與失速後段的終值恰好相等（見下方縮放推導），確保連續且大迎角不發散。
 */
export function liftCoefficient(
  spec: AircraftSpec,
  alpha: number,
  slatsDeployed: boolean,
): number {
  const L = spec.lift
  const alphaCrit = L.alphaCrit + (slatsDeployed ? L.slatAlphaBonus : 0)
  const clMax = derivedClMax(spec, slatsDeployed)

  // 以零升迎角為對稱中心
  const rel = alpha - L.alphaZero
  const sign = rel < 0 ? -1 : 1
  const mag = Math.abs(rel)
  const critMag = alphaCrit - L.alphaZero

  if (mag <= critMag) return L.clAlpha * rel

  const blendEnd = critMag + L.stallBlend
  if (mag < blendEnd) {
    const t = smoothstep(0, 1, (mag - critMag) / L.stallBlend)
    return sign * (clMax + (L.postStallFactor * clMax - clMax) * t)
  }

  // 深失速：平板模型 CL ∝ |sin 2α|，但必須在交接點 blendEnd 與失速後段接續。
  // 未縮放的平板值與 postStallFactor × CL_max 並不相等（P-51 差 0.098，
  // Bf 109 展開縫翼時差 0.181），且因為縫翼會改變 CL_max，
  // 無法用單一 stallBlend 讓兩個縫翼狀態同時連續——所以在此縮放而非調參。
  const alphaAtBlendEnd = L.alphaZero + sign * blendEnd
  const flatEnd = Math.max(Math.abs(Math.sin(2 * alphaAtBlendEnd)), 1e-6)
  const flat = Math.abs(Math.sin(2 * alpha))
  return sign * L.postStallFactor * clMax * (flat / flatEnd)
}

/**
 * 前緣自動縫翼狀態，含遲滯避免在閾值附近抖動。
 * 這是 Bf 109 低速盤旋優勢的物理來源，非憑空加成。
 */
export function updateSlatState(
  spec: AircraftSpec,
  alpha: number,
  wasDeployed: boolean,
): boolean {
  if (spec.lift.slatAlphaBonus <= 0) return false
  const mag = Math.abs(alpha)
  if (wasDeployed) return mag > spec.lift.slatRetractAlpha
  return mag > spec.lift.slatDeployAlpha
}

/** 阻力係數：零升阻力 + 誘導阻力 + 側滑阻力，超音速臨界後加壓縮性修正。 */
export function dragCoefficient(
  spec: AircraftSpec,
  cl: number,
  beta: number,
  mach: number,
): number {
  let cd0 = spec.drag.cd0
  if (mach > spec.drag.machCrit) {
    const excess = mach - spec.drag.machCrit
    cd0 *= 1 + spec.drag.machDragFactor * excess * excess
  }
  return cd0 + inducedDragFactor(spec) * cl * cl + spec.drag.cdBeta * beta * beta
}

/** 高速舵面變重：δ_eff = δ × min(1, (qRef/q)^k)。 */
export function controlEffectiveness(k: number, qRef: number, qbar: number): number {
  if (qbar <= qRef) return 1
  return Math.pow(qRef / qbar, k)
}

/** 由機體座標的空速向量計算迎角、側滑、動壓、馬赫數。 */
export function computeAeroState(
  velocityBody: Vector3,
  air: AirData,
  out: AeroState,
): AeroState {
  bodyToStd(velocityBody, stdVel)
  const tas = velocityBody.length()
  out.tas = tas
  out.alpha = tas > 1e-6 ? alphaFrom(stdVel) : 0
  out.beta = betaFrom(stdVel, tas)
  out.qbar = 0.5 * air.density * tas * tas
  out.mach = air.soundSpeed > 0 ? tas / air.soundSpeed : 0
  return out
}

/**
 * 氣動力與力矩，輸出於機體座標。
 *
 * 力在風軸計算後轉入標準氣動軸，再由 stdToBody 轉回機體軸。
 * 力矩的阻尼項以無因次角速度 (p·b/2V) 等形式計入。
 */
export function aeroForceMoment(
  spec: AircraftSpec,
  aero: AeroState,
  omegaBody: Vector3,
  controls: Controls,
  slatsDeployed: boolean,
  out: ForceMoment,
): ForceMoment {
  const { area, span, chord } = spec.wing

  if (aero.qbar <= 0 || aero.tas <= 1e-6) {
    out.force.set(0, 0, 0)
    out.moment.set(0, 0, 0)
    return out
  }

  const cl = liftCoefficient(spec, aero.alpha, slatsDeployed)
  const cd = dragCoefficient(spec, cl, aero.beta, aero.mach)
  const cy = spec.side.cyBeta * aero.beta

  const qS = aero.qbar * area
  const lift = qS * cl
  const drag = qS * cd
  const side = qS * cy

  const ca = Math.cos(aero.alpha)
  const sa = Math.sin(aero.alpha)
  const cb = Math.cos(aero.beta)
  const sb = Math.sin(aero.beta)

  // 風軸 → 標準氣動軸（x 前、y 右、z 下）
  const fx = -drag * ca * cb - side * ca * sb + lift * sa
  const fy = -drag * sb + side * cb
  const fz = -drag * sa * cb - side * sa * sb - lift * ca
  stdToBody(fx, fy, fz, out.force)

  // 角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
  bodyToStd(omegaBody, stdOmega)
  const v2 = 2 * aero.tas
  const pHat = (stdOmega.x * span) / v2
  const qHat = (stdOmega.y * chord) / v2
  const rHat = (stdOmega.z * span) / v2

  const CS = spec.controlStiffening
  const da = controls.aileron * controlEffectiveness(CS.aileronK, CS.qRef, aero.qbar)
  const de = controls.elevator * controlEffectiveness(CS.elevatorK, CS.qRef, aero.qbar)
  const dr = controls.rudder * controlEffectiveness(CS.rudderK, CS.qRef, aero.qbar)

  const M = spec.moments
  const cRoll = M.clBeta * aero.beta + M.clP * pHat + M.clDa * da
  const cPitch = M.cm0 + M.cmAlpha * aero.alpha + M.cmQ * qHat + M.cmDe * de
  const cYaw = M.cnBeta * aero.beta + M.cnR * rHat + M.cnDr * dr

  stdToBody(qS * span * cRoll, qS * chord * cPitch, qS * span * cYaw, out.moment)
  return out
}
