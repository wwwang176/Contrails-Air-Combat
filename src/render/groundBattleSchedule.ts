import { hash01 } from '../core/hash'

/** 射擊時刻在格點附近的抖動幅度，週期的比例。 */
export const SHOT_JITTER = 0.15

/** 時間表是純函數：同一台單位在任何幀率下都得到同一組發射時刻。 */
export function shotTimesBetween(
  i: number, period: number, t0: number, t1: number, out: Float64Array, kMin = 0,
): number {
  const phase = hash01(i * 7919 + 13) * period
  const reach = SHOT_JITTER * period
  const k0 = Math.max(kMin, Math.floor((t0 - phase - reach) / period))
  const k1 = Math.floor((t1 - phase + reach) / period)
  let n = 0
  for (let k = k0; k <= k1 && n < out.length; k++) {
    const t = phase + k * period + (2 * hash01(i * 104729 + k) - 1) * reach
    if (t > t0 && t <= t1) out[n++] = t
  }
  return n
}

export function burstTimesBetween(
  i: number, period: number, burstSeconds: number, roundsPerSecond: number,
  t0: number, t1: number, out: Float64Array,
): number {
  const phase = hash01(i * 7919 + 13) * period
  const reach = SHOT_JITTER * period
  const rounds = Math.max(1, Math.round(burstSeconds * roundsPerSecond))
  const step = 1 / roundsPerSecond
  const k0 = Math.max(0, Math.floor((t0 - phase - reach - (rounds - 1) * step) / period))
  const k1 = Math.floor((t1 - phase + reach) / period)
  let n = 0
  for (let k = k0; k <= k1; k++) {
    const start = phase + k * period + (2 * hash01(i * 104729 + k) - 1) * reach
    for (let j = 0; j < rounds && n < out.length; j++) {
      const t = start + j * step
      if (t > t0 && t <= t1) out[n++] = t
    }
  }
  return n
}
