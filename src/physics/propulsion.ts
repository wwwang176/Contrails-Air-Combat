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

  // σ_eff 夾制在 1（海平面）是刻意的備援防護，不是「防止超過海平面功率」的
  // 主要機制——主要機制是下方內插分支自己的 t = clamp(...,0,1)：t 本就會在
  // σ_eff 超過 1 時飽和於 1，使 lerp(...,1) = powerSeaLevel，功率因此本來就
  // 不會超過海平面額定值（在 h∈[0,4000m]、M∈[0,0.9] 全面掃描下，含 / 不含
  // 此處夾制的最大絕對差為 0）。保留它是為了在 σ_crit ≈ 1（altCritical ≈ 0）
  // 等邊界情況提供第二層防護，並讓 σ_eff 維持「密度比不超過海平面」的物理意義。
  const sigmaEff = Math.min(air.sigma * ramFactor(mach, spec.engine.ramEfficiency), 1)

  let best = 0
  for (const gear of spec.engine.gears) {
    const sigmaCrit = atmosphere(gear.altCritical, scratchAir).sigma
    let p: number
    if (sigmaCrit >= 1) {
      // altCritical ≤ 0（臨界高度落在海平面或以下）：物理上不會發生於現有機種，
      // 但 1 − σ_crit = 0 會讓下方內插分支的分母歸零產生 NaN，NaN 在
      // `if (p > best)` 比較中恆為 false，導致該檔位被「靜默」忽略，
      // 單檔位機種會靜默回傳 0 W。這裡改為明確處理：臨界高度即海平面，
      // 該檔位任何時候都以 powerSeaLevel 為準。
      p = gear.powerSeaLevel
    } else if (sigmaEff >= sigmaCrit) {
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
 * T = η(V)·P/V 在 V → 0 時的下限速度。
 *
 * η(V) = etaMax·(1 − e^(−V/vRef)) 在 V → 0 時線性趨近 0（一階泰勒展開
 * η(V) ≈ etaMax·V/vRef），所以 η(V)/V 的極限是有限值 etaMax/vRef，
 * 但直接代入 V = 0 會得到 0/0 → 0（因為分母舊版被 Math.max(V,1) 夾到 1，
 * 而非同一個下限），使推力恆為 0、飛機永遠無法從靜止起動。
 * 對分子（η）與分母（V）使用同一個下限速度，極限才會正確浮現；
 * 0.1 m/s 遠小於 vRef（P-51D 55、Bf109 52），一階近似誤差 < 0.1%。
 */
const V_FLOOR = 0.1

/**
 * 螺旋槳推力，N。
 *
 * 以 T = η(V)·P/V 計算（V 夾制在 V_FLOOR 以上，見上方推導），
 * 並以動量理論的靜推力上限 staticMax 夾制。
 *
 * 對 P-51D／Bf109G6 這兩款機種，staticMax 目前從未真正夾住 dynamic
 * （已於 propulsion.test.ts 量測兩者在全速度範圍內的峰值 dynamic 均低於
 * staticMax）；真正防止 V → 0 發散的是 V_FLOOR，不是這個夾制。
 * 保留 staticMax 是為了保護未來 etaMax／vRef 差異更大、可能使 dynamic
 * 真正超過動量理論上限的機種——因此仍是活的防禦，只是對現有兩款機種不 binding。
 */
export function propThrust(
  spec: AircraftSpec,
  powerW: number,
  tas: number,
  air: AirData,
): number {
  if (powerW <= 0) return 0
  const V = Math.max(tas, V_FLOOR)
  const dynamic = (propEfficiency(spec, V) * powerW) / V
  const radius = spec.prop.diameter / 2
  const diskArea = Math.PI * radius * radius
  const ideal = Math.cbrt(2 * air.density * diskArea * powerW * powerW)
  const staticMax = spec.prop.figureOfMerit * ideal
  return Math.min(dynamic, staticMax)
}
