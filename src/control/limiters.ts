import { G0 } from '../core/math'
import { liftCoefficient } from '../physics/aero'
import type { AircraftSpec } from '../specs/types'
import type { AeroState } from '../physics/types'

/** 飛行員持續耐 G 上限。超過此值畫面開始漸暗（黑視）。 */
export const PILOT_G_POSITIVE = 6.5
export const PILOT_G_NEGATIVE = -3
/** 迎角指令相對於失速迎角的餘裕比例。 */
export const ALPHA_MARGIN = 0.95

export type LimiterSource = 'alpha' | 'structure' | 'pilot' | 'none'

export interface PitchLimit {
  /** 期望俯仰率上限，rad/s */
  qMax: number
  /** 實際採用的過載上限 */
  nLimit: number
  /** 純氣動可達的過載（未計結構與飛行員限制） */
  nAero: number
  source: LimiterSource
}

export function createPitchLimit(): PitchLimit {
  return { qMax: 0, nLimit: 1, nAero: 1, source: 'none' }
}

/**
 * 計算期望俯仰率上限。
 *
 * 限制作用在「期望角速度」而非舵面上——指揮儀只負責
 * 不要求飛機做做不到的事，物理層永遠是唯一的真相。
 *
 * 注意本函數只擋失速，不擋能量流失：高速大 G 時
 * 限制器完全不介入，玩家可盡情拉 G 並承受速度暴跌。
 *
 * 【簽名修正】brief 原稿在 spec 與 aero 之間多帶一個 air: AirData 參數，
 * 但函式本體從未讀取它——tsc 的 noUnusedParameters 抓到了這點。
 * 追查後確認這不是「忘記用」，而是參數本身多餘：nAero 只需要
 * qbar·S·CL/(m·g)，而 qbar 早已由呼叫端的 computeAeroState 用 air.density
 * 算進 aero.qbar 裡；本模組目前也沒有任何馬赫相依的 CL 模型會用到
 * air.soundSpeed（liftCoefficient 完全不吃 mach，只有 dragCoefficient
 * 才用，且那是阻力不是升力）。這與 aeroForceMoment 的既有模式一致——
 * 它同樣只吃 aero 不吃 air（Task 10 曾在該函式發現一模一樣的多餘
 * AirData 參數，當時的結論是整個移除，不是改名忽略）。因此這裡採同一
 * 結論：直接從簽名移除 air，而非用底線遮蓋編譯錯誤。若未來任務需要
 * 隨高度／密度變化的失速模型（例如壓縮性對 CL_max 的影響），屆時
 * 應該加回 aero.mach（AeroState 已有）而非重新引入整個 AirData。
 */
export function pitchRateLimit(
  spec: AircraftSpec,
  aero: AeroState,
  slatsDeployed: boolean,
  out: PitchLimit,
): PitchLimit {
  const clAtMargin = liftCoefficient(
    spec,
    spec.lift.alphaCrit * ALPHA_MARGIN + (slatsDeployed ? spec.lift.slatAlphaBonus : 0),
    slatsDeployed,
  )
  const nAero = (aero.qbar * spec.wing.area * clAtMargin) / (spec.mass * G0)
  out.nAero = nAero

  let nLimit = nAero
  let source: LimiterSource = 'alpha'
  if (spec.limits.gPositive < nLimit) {
    nLimit = spec.limits.gPositive
    source = 'structure'
  }
  if (PILOT_G_POSITIVE < nLimit) {
    nLimit = PILOT_G_POSITIVE
    source = 'pilot'
  }

  out.nLimit = Math.max(nLimit, 0)
  out.source = source
  // 拉升過載 n 對應的俯仰率近似 q = n·g/V
  out.qMax = aero.tas > 1 ? (out.nLimit * G0) / aero.tas : 0
  return out
}
