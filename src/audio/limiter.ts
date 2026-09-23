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
/**
 * 起音的時間常數，s。**不是 0** —— 一個取樣之間把增益拉掉一兩 dB，對爆炸
 * 那種低頻就是波形上的折角，聽起來是破音。
 *
 * 【為什麼可以慢】峰值進到預看窗時它還有 `LIMITER_LOOKAHEAD` 秒才輪到輸出。
 * 時間常數取預看的六分之一，走完六個常數（0.25% 誤差）仍在它抵達之前。
 */
export const LIMITER_ATTACK = LIMITER_LOOKAHEAD / 6

export const LIMITER_CEILING = 10 ** (LIMITER_CEILING_DB / 20)

/**
 * 這一刻該乘多少，才不讓 `peak` 超過天花板。`peak` 是預看窗裡的最大絕對值。
 *
 * 【預看的意義】峰值進到窗裡時它還沒送出去，增益有一整個預看窗的時間降到位。
 */
export function limiterTarget(peak: number, ceiling = LIMITER_CEILING): number {
  if (!(peak > ceiling)) return 1
  return ceiling / peak
}

/**
 * 增益往目標走一步。**降得快、升得慢**，不對稱是限幅器的定義。
 *
 * 兩個係數都是「一個樣本走多少」，由 `releaseCoeff` 算：降的用起音、升的用
 * 釋放。降那一邊也要平滑 —— 一步到位會在波形上留折角，低頻聽起來就是破音。
 */
export function limiterStep(
  gain: number, target: number, releaseCoeff: number, attackCoeff: number,
): number {
  const c = target < gain ? attackCoeff : releaseCoeff
  return target + (gain - target) * c
}

/** 釋放時間常數 → 每個樣本的係數。`sampleRate` 是 worklet 的取樣率 */
export function releaseCoeff(seconds: number, sampleRate: number): number {
  if (!(seconds > 0) || !(sampleRate > 0)) return 0
  return Math.exp(-1 / (seconds * sampleRate))
}

/**
 * 滑動窗最大值：最近 `size` 個樣本裡最大的那一個。單調佇列，每個樣本攤還 O(1)。
 *
 * 【不逐格掃】窗有 240 格，每個樣本掃一遍在離線渲染量得到 1.5～8% 的
 * 音訊執行緒 —— 那條執行緒算不完，瀏覽器就塞靜音補上，聽起來是劈啪聲。
 */
export class WindowPeak {
  private readonly vals: Float32Array
  private readonly ats: Float64Array
  private head = 0
  private count = 0
  private n = 0

  constructor(private readonly size: number) {
    this.vals = new Float32Array(size)
    this.ats = new Float64Array(size)
  }

  /** 推一個樣本的絕對值進去，回傳推完之後窗內的最大值 */
  push(mag: number): number {
    const size = this.size
    // 過期的從前面丟掉
    while (this.count > 0 && this.ats[this.head]! <= this.n - size) {
      this.head = this.head + 1 === size ? 0 : this.head + 1
      this.count--
    }
    // 後面不比它大的，窗內再也輪不到它們當最大值
    while (this.count > 0) {
      const back = (this.head + this.count - 1) % size
      if (this.vals[back]! > mag) break
      this.count--
    }
    const at = (this.head + this.count) % size
    this.vals[at] = mag
    this.ats[at] = this.n
    this.count++
    this.n++
    return this.vals[this.head]!
  }

  clear(): void {
    this.head = 0
    this.count = 0
    this.n = 0
  }
}

/** 預看緩衝要幾格 —— 至少 1，否則讀寫指標會重疊成同一格 */
export function lookaheadFrames(seconds: number, sampleRate: number): number {
  return Math.max(1, Math.round(seconds * sampleRate))
}
