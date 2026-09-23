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
const CEILING = Math.pow(10, CEILING_DB / 20)

class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    const n = Math.max(1, Math.round(LOOKAHEAD * sampleRate))
    this.size = n
    this.coeff = Math.exp(-1 / (RELEASE * sampleRate))
    /** 每個聲道一條環狀緩衝 */
    this.delay = []
    /** 窗內每一格的絕對值，用來重算峰值 */
    this.mags = new Float32Array(n)
    this.write = 0
    this.gain = 1
    this.port.onmessage = (e) => {
      // 【暫停與換場要清】緩衝裡那幾毫秒是乘過舊淡入增益的樣本，不清的話
      // 恢復的一瞬間會先漏出去，聽起來是一個爆點
      if (e.data === 'reset') this.clear()
    }
  }

  clear() {
    for (const ch of this.delay) ch.fill(0)
    this.mags.fill(0)
    this.write = 0
    this.gain = 1
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
      this.mags[w] = mag
      this.write = w + 1 === this.size ? 0 : w + 1

      // 窗內峰值。**逐格掃描** —— size 是 240 格（5 ms @ 48 kHz），
      // 每個樣本掃一遍在音訊執行緒上量不出來，換掉它要先證明確實太慢
      let peak = 0
      for (let k = 0; k < this.size; k++) {
        const m = this.mags[k]
        if (m > peak) peak = m
      }
      // 【NaN 不得鎖死整條匯流排】只要有一個樣本壞掉，增益會永遠是 NaN，
      // 而它在最後一道 —— 症狀是整場突然沒聲音，而且不報錯
      if (!(peak >= 0)) { this.clear(); continue }
      const target = peak > CEILING ? CEILING / peak : 1
      const gain = this.gain
      // 降立刻到位、升照釋放係數。兩邊都平滑的話峰值會漏過去
      this.gain = target < gain ? target : target + (gain - target) * this.coeff
      for (let c = 0; c < channels; c++) {
        const dst = output[c]
        if (dst === undefined) continue
        const y = dst[i] * this.gain
        dst[i] = y === y ? y : 0
      }
    }
    return true
  }
}

registerProcessor('limiter', LimiterProcessor)
