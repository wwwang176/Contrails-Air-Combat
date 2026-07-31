import { clamp, lerp } from '../core/math'
import { atmosphere } from './atmosphere'
import type { AircraftSpec } from '../specs/types'
import type { AirData } from './types'

/** 對應各機種登錄之 WEP 功率的油門值。 */
export const WEP_THROTTLE = 1.1

const scratchAir: AirData = {
  density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0,
}

/**
 * 進氣衝壓恢復因子（Spec 修訂 2）。
 *
 * 高速飛行時進氣道的動壓恢復提高增壓器有效進氣壓，
 * 等效於降低飛行高度。沒有這一項，史實極速無法達成。
 */
export function ramFactor(mach: number, efficiency: number): number {
  const totalRatio = Math.pow(1 + 0.2 * mach * mach, 3.5)
  return 1 + efficiency * (totalRatio - 1)
}

/**
 * 引擎軸功率，W。
 *
 * 在密度比 σ 空間求解——ram 的效果正是「等效於降低高度」，
 * 以 σ 表達最自然。多檔位取上包絡（自動換檔）。
 */
export function enginePower(
  spec: AircraftSpec,
  air: AirData,
  mach: number,
  throttle: number,
): number {
  const frac = clamp(throttle / WEP_THROTTLE, 0, 1)
  if (frac <= 0) return 0

  const sigmaEff = Math.min(air.sigma * ramFactor(mach, spec.engine.ramEfficiency), 1)

  let best = 0
  for (const gear of spec.engine.gears) {
    const sigmaCrit = atmosphere(gear.altCritical, scratchAir).sigma
    let p: number
    if (sigmaEff >= sigmaCrit) {
      const t = clamp((sigmaEff - sigmaCrit) / (1 - sigmaCrit), 0, 1)
      p = lerp(gear.powerCritical, gear.powerSeaLevel, t)
    } else {
      // Gagg-Farrar
      p = gear.powerCritical * ((sigmaEff / sigmaCrit - 0.117) / 0.883)
    }
    if (p > best) best = p
  }

  return Math.max(best, 0) * frac
}

/** 螺旋槳效率：低速效率低，高速趨近 etaMax。 */
export function propEfficiency(spec: AircraftSpec, tas: number): number {
  return spec.prop.etaMax * (1 - Math.exp(-tas / spec.prop.vRef))
}

/**
 * 螺旋槳推力，N。
 *
 * 以 T = η·P/V 計算，並以動量理論的靜推力上限夾制，
 * 避免 V → 0 時推力發散。
 */
export function propThrust(
  spec: AircraftSpec,
  powerW: number,
  tas: number,
  air: AirData,
): number {
  if (powerW <= 0) return 0
  const dynamic = (propEfficiency(spec, tas) * powerW) / Math.max(tas, 1)
  const radius = spec.prop.diameter / 2
  const diskArea = Math.PI * radius * radius
  const ideal = Math.cbrt(2 * air.density * diskArea * powerW * powerW)
  const staticMax = spec.prop.figureOfMerit * ideal
  return Math.min(dynamic, staticMax)
}
