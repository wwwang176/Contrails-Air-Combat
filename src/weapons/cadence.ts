/**
 * 推進一個掛架的射擊時鐘一個物理步，回傳本步應擊發的發數。
 *
 * 【為什麼放開扳機不歸零，而是讓時鐘繼續倒數到 0 為止】
 * 歸零的話「連點扳機」可以無限突破標稱射速——每次按下都立刻擊發一發，
 * 240 Hz 下等於 14,400 rpm。繼續倒數則保證兩發之間至少隔一個射擊間隔，
 * 同時因為停在 0 而不是負數，久未射擊後第一發仍然是即時的。
 *
 * 【為什麼用 while 而不是 if】低更新率（例如工具程式用 0.3 s 的步長）下
 * 一步可能該擊發好幾發。用 if 會靜靜地遺失彈量，而且只在低幀率時發生。
 */
export function stepCadence(
  cooldowns: Float32Array,
  index: number,
  roundsPerMinute: number,
  trigger: boolean,
  dt: number,
): number {
  const interval = 60 / roundsPerMinute
  let t = cooldowns[index]! - dt
  let shots = 0
  if (t <= 0) {
    if (trigger) {
      while (t <= 0) {
        shots++
        t += interval
      }
    } else {
      t = 0
    }
  }
  cooldowns[index] = t
  return shots
}
