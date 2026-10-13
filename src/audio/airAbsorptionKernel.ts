import { atmosphericAbsorption } from './atmosphere'

/** 就地 radix-2 FFT；只在建立共用濾波核時使用，不在音訊執行緒上跑 JS。 */
function fft(real: Float64Array, imag: Float64Array, inverse: boolean): void {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const r = real[i]!, im = imag[i]!
      real[i] = real[j]!; imag[i] = imag[j]!; real[j] = r; imag[j] = im
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size
    const wr = Math.cos(angle), wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let ur = 1, ui = 0
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2
        const vr = real[b]! * ur - imag[b]! * ui, vi = real[b]! * ui + imag[b]! * ur
        real[b] = real[a]! - vr; imag[b] = imag[a]! - vi
        real[a] = real[a]! + vr; imag[a] = imag[a]! + vi
        const next = ur * wr - ui * wi
        ui = ur * wi + ui * wr; ur = next
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] = real[i]! / n; imag[i] = imag[i]! / n }
}

/**
 * 由 ISO 振幅響應建立最小相位 FIR。避免線性相位的前振鈴與固定半核延遲。
 * 48 kHz 使用 256–1,024 點；遠距離與更高取樣率同步延長，保持低頻解析度。
 * 160 dB 以下視為數值底限；不將耳朵聽不見的極小係數推到 log(0)。
 */
export function airAbsorptionKernel(distance: number, sampleRate: number): Float32Array {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(sampleRate) || sampleRate < 8000) {
    throw new Error('大氣濾波的距離或取樣率無效')
  }
  const baseLength = distance <= 1000 ? 256 : distance <= 8000 ? 512 : 1024
  const length = 2 ** Math.ceil(Math.log2(baseLength * Math.max(1, sampleRate / 48000)))
  const n = length * 4
  const real = new Float64Array(n), imag = new Float64Array(n)
  for (let i = 0; i <= n / 2; i++) {
    const value = -Math.min(160, atmosphericAbsorption(i * sampleRate / n) * distance) * Math.LN10 / 20
    real[i] = value
    if (i > 0 && i < n / 2) real[n - i] = value
  }
  fft(real, imag, true)
  for (let i = 1; i < n / 2; i++) real[i] = real[i]! * 2
  real.fill(0, n / 2 + 1); imag.fill(0)
  fft(real, imag, false)
  for (let i = 0; i < n; i++) {
    const magnitude = Math.exp(real[i]!), phase = imag[i]!
    real[i] = magnitude * Math.cos(phase); imag[i] = magnitude * Math.sin(phase)
  }
  fft(real, imag, true)
  const result = new Float32Array(length)
  let sum = 0
  for (let i = 0; i < length; i++) sum += real[i]!
  // 直流的物理吸收為零；消除有限長度截斷造成的極小增益誤差。
  for (let i = 0; i < length; i++) result[i] = real[i]! / sum
  return result
}
