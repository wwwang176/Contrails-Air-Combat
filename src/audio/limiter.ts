/**
 * # 限幅器的數學
 *
 * 真正的處理跑在 `public/audio/limiter.js`（`AudioWorkletProcessor`，另一個
 * 執行緒，不能 import 模組），所以**這一份是同一套公式的可測版本**：worklet
 * 裡那幾行與這裡逐行對應，改一邊要改兩邊。單元測試測這一份。
 *
 * 【為什麼不用 `DynamicsCompressorNode`】它沒有預看。起音設到最快仍然會讓
 * 瞬態的第一個波峰整個通過 —— 而爆炸全部是瞬態，那一下正是會削平的那一下。
 */

/** 預看，s。夠蓋住瞬態的上升緣，延遲小到聽不出 */
export const LIMITER_LOOKAHEAD = 0.005
/**
 * 天花板，dBFS（**樣本**峰值）。
 *
 * 【為什麼不是 −1】限幅器只看得到樣本，而樣本之間的波形可以更高（ITU-R
 * BS.1770 附錄 2），最壞約 1 dB。−1.5 的樣本峰值留下約 0.5 dB 的真峰值餘裕。
 */
export const LIMITER_CEILING_DB = -1.5
/** 釋放，s。短了會抖（失真），長了大聲之後整體悶一段 */
export const LIMITER_RELEASE = 0.12

export const LIMITER_CEILING = 10 ** (LIMITER_CEILING_DB / 20)

/**
 * 這一刻該乘多少，才不讓 `peak` 超過天花板。`peak` 是預看窗裡的最大絕對值。
 *
 * 【起音是 0】預看的意義就是不必犧牲起音：峰值進到窗裡時它還沒送出去，
 * 增益可以在它抵達之前就降到位。
 */
export function limiterTarget(peak: number, ceiling = LIMITER_CEILING): number {
  if (!(peak > ceiling)) return 1
  return ceiling / peak
}

/**
 * 增益往目標走一步。**降立刻到位、升照釋放時間常數**，不對稱是限幅器的定義：
 * 兩邊都平滑的話峰值會漏過去。
 *
 * `release` 是一次一格（一個樣本）走多少的係數，由 `releaseCoeff` 算。
 */
export function limiterStep(gain: number, target: number, releaseCoeff: number): number {
  if (target < gain) return target
  return target + (gain - target) * releaseCoeff
}

/** 釋放時間常數 → 每個樣本的係數。`sampleRate` 是 worklet 的取樣率 */
export function releaseCoeff(seconds: number, sampleRate: number): number {
  if (!(seconds > 0) || !(sampleRate > 0)) return 0
  return Math.exp(-1 / (seconds * sampleRate))
}

/** 預看緩衝要幾格 —— 至少 1，否則讀寫指標會重疊成同一格 */
export function lookaheadFrames(seconds: number, sampleRate: number): number {
  return Math.max(1, Math.round(seconds * sampleRate))
}
