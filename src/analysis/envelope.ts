import { G0 } from '../core/math'
import { atmosphere } from '../physics/atmosphere'
import {
  controlEffectiveness, dragCoefficient, inducedDragFactor,
} from '../physics/aero'
import { WEP_THROTTLE, enginePower, propThrust } from '../physics/propulsion'
import { derivedClMax, type AircraftSpec } from '../specs/types'
import type { AirData } from '../physics/types'

const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 高迎角時縫翼必然展開，故包絡計算一律採用展開後的 CL_max。 */
function clMaxFor(spec: AircraftSpec): number {
  return derivedClMax(spec, spec.lift.slatAlphaBonus > 0)
}

function weight(spec: AircraftSpec): number {
  return spec.mass * G0
}

/** 當前速度與高度下，氣動能提供的最大過載。 */
export function maxLoadFactorAero(spec: AircraftSpec, altitude: number, tas: number): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  return (qbar * spec.wing.area * clMaxFor(spec)) / weight(spec)
}

/** 指定過載下的失速速度，m/s TAS。 */
export function stallSpeed(spec: AircraftSpec, altitude: number, loadFactor: number): number {
  atmosphere(altitude, air)
  return Math.sqrt(
    (2 * loadFactor * weight(spec)) / (air.density * spec.wing.area * clMaxFor(spec)),
  )
}

/** 指定速度與過載下的總阻力，N。過載超出氣動極限時回傳 Infinity。 */
export function dragAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  loadFactor: number,
): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  if (qbar <= 0) return 0
  const qS = qbar * spec.wing.area
  const cl = (loadFactor * weight(spec)) / qS
  if (cl > clMaxFor(spec)) return Infinity
  const mach = tas / air.soundSpeed
  return qS * dragCoefficient(spec, cl, 0, mach)
}

/** 指定速度與高度下的可用推力，N。 */
export function thrustAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  throttle = WEP_THROTTLE,
): number {
  atmosphere(altitude, air)
  const mach = tas / air.soundSpeed
  const power = enginePower(spec, air, mach, throttle)
  return propThrust(spec, power, tas, air)
}

/** 比超量功率 Ps = V(T − D)/W，m/s。正值代表能量累積。 */
export function specificExcessPower(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  loadFactor: number,
  throttle = WEP_THROTTLE,
): number {
  const d = dragAt(spec, altitude, tas, loadFactor)
  if (!Number.isFinite(d)) return -Infinity
  return (tas * (thrustAt(spec, altitude, tas, throttle) - d)) / weight(spec)
}

const V_SEARCH_MAX = 400

/**
 * 平飛極速，m/s TAS。以二分搜尋求 T − D = 0 的上根。
 *
 * 【修正】原始寫法只檢查失速速度 × 1.05 這一點的 T−D 正負，若為負即判定
 * 「該高度已無法平飛」。但在接近實用升限處，失速附近的誘導阻力可能大到
 * 讓 T−D 在那裡為負，而在更高速度（誘導阻力下降後）T−D 轉正、直到接近
 * 極速才再度轉負——即「動力曲線背面」現象。只檢查下界會把這種可平飛的
 * 高度誤判為不可平飛，回傳 0（已於 10,470 m 附近實測到 maxLevelSpeed
 * 從 178 m/s 驟降為 0 的懸崖，見 task-13-report.md）。
 * 改為粗掃描找出「最高的」一段正轉負區間再二分，可正確處理非單調的
 * T−D(v) 曲線，且仍是二分法而非導數法，滿足 finding #1 對增壓器接縫的要求。
 */
export function maxLevelSpeed(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): number {
  const excess = (v: number) => thrustAt(spec, altitude, v, throttle) - dragAt(spec, altitude, v, 1)

  const vMin = stallSpeed(spec, altitude, 1) * 1.05
  const vMax = V_SEARCH_MAX
  if (excess(vMax) > 0) return vMax

  const SCAN = 200
  let braLo = -1
  let braHi = -1
  let prevV = vMin
  let prevExcess = excess(vMin)
  for (let i = 1; i <= SCAN; i++) {
    const v = vMin + ((vMax - vMin) * i) / SCAN
    const e = excess(v)
    if (prevExcess > 0 && e <= 0) {
      braLo = prevV
      braHi = v
    }
    prevV = v
    prevExcess = e
  }
  if (braLo < 0) return 0 // 全速度範圍皆無法平飛

  let lo = braLo
  let hi = braHi
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (excess(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 最佳爬升率與對應速度。掃描後以黃金分割細化。 */
export function maxClimbRate(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): { rate: number; speed: number } {
  const vMin = stallSpeed(spec, altitude, 1) * 1.02
  const vMax = Math.max(maxLevelSpeed(spec, altitude, throttle), vMin + 1)

  let bestRate = -Infinity
  let bestSpeed = vMin
  const COARSE = 120
  for (let i = 0; i <= COARSE; i++) {
    const v = vMin + ((vMax - vMin) * i) / COARSE
    const ps = specificExcessPower(spec, altitude, v, 1, throttle)
    if (ps > bestRate) {
      bestRate = ps
      bestSpeed = v
    }
  }

  // 在最佳點鄰域細化
  const span = (vMax - vMin) / COARSE
  let lo = Math.max(vMin, bestSpeed - span)
  let hi = Math.min(vMax, bestSpeed + span)
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (specificExcessPower(spec, altitude, a, 1, throttle) <
        specificExcessPower(spec, altitude, b, 1, throttle)) lo = a
    else hi = b
  }
  const v = (lo + hi) / 2
  return { rate: specificExcessPower(spec, altitude, v, 1, throttle), speed: v }
}

const CEILING_RATE = 0.5

/** 實用升限，m。定義為最佳爬升率降至 0.5 m/s 的高度。 */
export function serviceCeiling(spec: AircraftSpec, throttle = WEP_THROTTLE): number {
  let lo = 0
  let hi = 20000
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (maxClimbRate(spec, mid, throttle).rate > CEILING_RATE) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 瞬間轉彎率，rad/s。取氣動與結構過載的較小者。 */
export function instantaneousTurnRate(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
): number {
  const n = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (n <= 1 || tas <= 0) return 0
  return (G0 * Math.sqrt(n * n - 1)) / tas
}

/** 持續轉彎率，rad/s。以二分搜尋求 Ps = 0 的過載。 */
export function sustainedTurnRate(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  throttle = WEP_THROTTLE,
): number {
  const nMax = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (nMax <= 1) return 0
  if (specificExcessPower(spec, altitude, tas, nMax, throttle) >= 0) {
    return (G0 * Math.sqrt(nMax * nMax - 1)) / tas
  }
  if (specificExcessPower(spec, altitude, tas, 1, throttle) < 0) return 0

  let lo = 1
  let hi = nMax
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    // 【修正】原始寫法把 mid（正在二分的過載）誤代入 specificExcessPower 的
    // tas 參數槽位，導致 loadFactor 恆為 1、tas 被夾在 [1, nMax]（僅 1~數 m/s）。
    // 在此極低速下 qbar≈0 使 cl 遠超 CL_max，dragAt 恆回傳 Infinity，
    // Ps 恆為 −Infinity，於是 hi=mid 永遠成立、lo 永遠停在 1，
    // sustainedTurnRate 因此恆回傳 0（已於 BF109G6 300 km/h 實測到）。
    // 正確作法：tas 固定為外層傳入值，二分的是 loadFactor（第四參數）。
    if (specificExcessPower(spec, altitude, tas, mid, throttle) >= 0) lo = mid
    else hi = mid
  }
  const n = lo
  return n <= 1 ? 0 : (G0 * Math.sqrt(n * n - 1)) / tas
}

/** 角落速度：氣動過載首次達到結構極限的速度，m/s。 */
export function cornerSpeed(spec: AircraftSpec, altitude: number): number {
  return stallSpeed(spec, altitude, spec.limits.gPositive)
}

/** 穩態最大滾轉率，rad/s。解 clDa·δa_eff + clP·(p·b/2V) = 0。 */
export function maxRollRate(spec: AircraftSpec, altitude: number, tas: number): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  const CS = spec.controlStiffening
  const da = controlEffectiveness(CS.aileronK, CS.qRef, qbar)
  return (spec.moments.clDa * da * 2 * tas) / (Math.abs(spec.moments.clP) * spec.wing.span)
}

// 供 EM 圖標註使用
export { inducedDragFactor }
