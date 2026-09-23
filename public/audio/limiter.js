/**
 * 主匯流排的限幅器。**跑在音訊執行緒，不能 import 模組** —— 公式與
 * `src/audio/limiter.ts` 逐行對應，改一邊要改兩邊（`audio-limiter.test.ts`
 * 比對原始碼守這一條）。
 *
 * 預看：輸出比輸入晚 LOOKAHEAD 秒。峰值進到窗裡時它還沒送出去，所以增益
 * 可以在它抵達之前就降到位 —— 這是 DynamicsCompressorNode 做不到的事。
 */
const LOOKAHEAD = 0.005
const CEILING_DB = -1.5
const RELEASE = 0.12
// 起音的時間常數：預看的六分之一。一步到位會在波形上留折角 —— 低頻聽起來就是破音
const ATTACK = LOOKAHEAD / 6
/** 每幾個區塊回報一次狀態。16 個約 43 ms */
const REPORT_BLOCKS = 16
const CEILING = Math.pow(10, CEILING_DB / 20)

/**
 * 滑動窗最大值（單調佇列，每個樣本攤還 O(1)），與 `src/audio/limiter.ts` 的
 * `WindowPeak` 逐行對應。**不逐格掃** —— 240 格的窗每個樣本掃一遍，在離線渲染
 * 量得到 1.5～8% 的音訊執行緒，而那條執行緒算不完就是劈啪聲。
 */
class WindowPeak {
  constructor(size) {
    this.size = size
    this.vals = new Float32Array(size)
    this.ats = new Float64Array(size)
    this.head = 0
    this.count = 0
    this.n = 0
  }

  push(mag) {
    const size = this.size
    // 過期的從前面丟掉
    while (this.count > 0 && this.ats[this.head] <= this.n - size) {
      this.head = this.head + 1 === size ? 0 : this.head + 1
      this.count--
    }
    // 後面不比它大的，窗內再也輪不到它們當最大值
    while (this.count > 0) {
      const back = (this.head + this.count - 1) % size
      if (this.vals[back] > mag) break
      this.count--
    }
    const at = (this.head + this.count) % size
    this.vals[at] = mag
    this.ats[at] = this.n
    this.count++
    this.n++
    return this.vals[this.head]
  }

  clear() {
    this.head = 0
    this.count = 0
    this.n = 0
  }
}

class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    const n = Math.max(1, Math.round(LOOKAHEAD * sampleRate))
    this.size = n
    this.coeff = Math.exp(-1 / (RELEASE * sampleRate))
    this.attack = Math.exp(-1 / (ATTACK * sampleRate))
    /** 每個聲道一條環狀緩衝 */
    this.delay = []
    /** 預看窗內的輸入峰值 */
    this.peaks = new WindowPeak(n)
    this.write = 0
    this.gain = 1
    /** 回報用：這一批裡最低的增益與最高的輸入峰值。每 REPORT_BLOCKS 個區塊送一次 */
    this.minGain = 1
    this.maxPeak = 0
    this.blocks = 0
    this.port.onmessage = (e) => {
      // 【暫停與換場要清】緩衝裡那幾毫秒是乘過舊淡入增益的樣本，不清的話
      // 恢復的一瞬間會先漏出去，聽起來是一個爆點
      if (e.data === 'reset') this.clear()
    }
  }

  clear() {
    for (const ch of this.delay) ch.fill(0)
    this.peaks.clear()
    this.write = 0
    this.gain = 1
    this.minGain = 1
    this.maxPeak = 0
    this.blocks = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (input === undefined || output === undefined) return true
    const channels = Math.max(input.length, output.length)
    while (this.delay.length < channels) this.delay.push(new Float32Array(this.size))

    const frames = output[0] === undefined ? 0 : output[0].length
    for (let i = 0; i < frames; i++) {
      const w = this.write
      let mag = 0
      for (let c = 0; c < channels; c++) {
        const src = input[c]
        const x = src === undefined ? 0 : src[i]
        const buf = this.delay[c]
        const delayed = buf[w]
        buf[w] = x
        const dst = output[c]
        if (dst !== undefined) dst[i] = delayed
        const a = x < 0 ? -x : x
        if (a > mag) mag = a
      }
      this.write = w + 1 === this.size ? 0 : w + 1
      const peak = this.peaks.push(mag)
      // 【NaN 不得鎖死整條匯流排】只要有一個樣本壞掉，增益會永遠是 NaN，
      // 而它在最後一道 —— 症狀是整場突然沒聲音，而且不報錯
      if (!(peak >= 0)) { this.clear(); continue }
      const target = peak > CEILING ? CEILING / peak : 1
      const gain = this.gain
      // 降照起音係數、升照釋放係數。起音走完六個常數仍在峰值抵達之前
      this.gain = target + (gain - target) * (target < gain ? this.attack : this.coeff)
      if (this.gain < this.minGain) this.minGain = this.gain
      if (peak > this.maxPeak) this.maxPeak = peak
      for (let c = 0; c < channels; c++) {
        const dst = output[c]
        if (dst === undefined) continue
        const y = dst[i] * this.gain
        dst[i] = y === y ? y : 0
      }
    }
    // 【回報給錶】每 16 個區塊約 43 ms（48 kHz、128 frame 一區塊）。
    // 每一個區塊都送的話，主執行緒每秒要處理三百多則訊息
    this.blocks++
    if (this.blocks >= REPORT_BLOCKS) {
      this.port.postMessage({ gain: this.minGain, peak: this.maxPeak })
      this.blocks = 0
      this.minGain = 1
      this.maxPeak = 0
    }
    return true
  }
}

registerProcessor('limiter', LimiterProcessor)
