import { describe, expect, it } from 'vitest'
import { atmosphericAbsorption, createAtmosphericAbsorption } from '../../src/audio/atmosphere'
import { airAbsorptionKernel } from '../../src/audio/airAbsorptionKernel'
import { airDistanceMix, AIR_DISTANCES, createAirAbsorption } from '../../src/audio/airAbsorption'

/** 直接對 FIR 做複數響應，不借用產生濾波核的 FFT。 */
function response(kernel: Float32Array, frequency: number, sampleRate: number): [number, number] {
  let real = 0, imag = 0
  for (let i = 0; i < kernel.length; i++) {
    const angle = 2 * Math.PI * frequency * i / sampleRate
    real += kernel[i]! * Math.cos(angle); imag -= kernel[i]! * Math.sin(angle)
  }
  return [real, imag]
}

describe('ISO 大氣吸收', () => {
  it('符合 20°C、70% 濕度的純音參考值（dB/km）', () => {
    for (const [frequency, expected] of [[125, 0.34], [500, 2.79], [1000, 4.98], [2000, 9.04], [4000, 23.09], [8000, 77.63]]) {
      expect(atmosphericAbsorption(frequency!) * 1000).toBeCloseTo(expected!, 1)
    }
    expect(atmosphericAbsorption(0)).toBe(0)
  })
  it('拒絕無效的大氣條件', () => {
    expect(() => createAtmosphericAbsorption({ temperatureC: 20, humidityPercent: 700, pressureKPa: 101.325 })).toThrow()
  })
  it.each([44100, 48000, 96000])('濾波核與相鄰距離混合在可用頻帶符合模型：%i Hz', (sampleRate) => {
    for (const distance of [0, 10, 100, 500, 1000, 3000, 8000, 16000]) {
      const mix = airDistanceMix(distance)
      const lower = airAbsorptionKernel(AIR_DISTANCES[mix.lower]!, sampleRate)
      const upper = airAbsorptionKernel(AIR_DISTANCES[mix.upper]!, sampleRate)
      for (const frequency of [30, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000]) {
        const expected = -atmosphericAbsorption(frequency) * distance
        if (expected < -60) continue
        const a = response(lower, frequency, sampleRate), b = response(upper, frequency, sampleRate)
        const magnitude = Math.hypot(a[0] * (1 - mix.weight) + b[0] * mix.weight,
          a[1] * (1 - mix.weight) + b[1] * mix.weight)
        const db = 20 * Math.log10(magnitude)
        expect(db, `${distance}m / ${frequency}Hz 不應放大`).toBeLessThan(0.02)
        expect(Math.abs(db - expected), `${distance}m / ${frequency}Hz：${db} vs ${expected}`).toBeLessThan(0.8)
      }
    }
  })
  it('零距離為透明直通，沒有固定的半核延遲', () => {
    const kernel = airAbsorptionKernel(0, 48000)
    expect(kernel[0]).toBeCloseTo(1, 6)
    expect(kernel.slice(1).every(value => Math.abs(value) < 1e-6)).toBe(true)
  })
  it('距離桶涵蓋邊界且權重有限', () => {
    for (const distance of [-1, 0, 1, 16000, 30000, NaN, Infinity]) {
      const mix = airDistanceMix(distance)
      expect(mix.lower).toBeGreaterThanOrEqual(0)
      expect(mix.upper).toBeLessThan(AIR_DISTANCES.length)
      expect(mix.weight).toBeGreaterThanOrEqual(0)
      expect(mix.weight).toBeLessThanOrEqual(1)
    }
  })
})

describe('共用大氣濾波的生命週期', () => {
  function context() {
    const node = () => ({ connect() {}, disconnect() {} })
    const ctx = {
      currentTime: 0, sampleRate: 48000,
      createGain: () => ({ ...node(), gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {} } }),
      createConvolver: () => ({ ...node(), normalize: true, buffer: null }),
      createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    }
    return ctx as unknown as BaseAudioContext
  }
  it('同距離的多個聲源共用濾波，最後一個停止後釋放', () => {
    const ctx = context(), bank = createAirAbsorption(ctx, ctx.createGain())
    const a = bank.createRoute(), b = bank.createRoute()
    a.setDistance(500, 0); b.setDistance(500, 0)
    expect(bank.activeFilters).toBe(0)
    a.wake(); b.wake()
    expect(bank.activeFilters).toBe(2)
    a.sleep(); expect(bank.activeFilters).toBe(2)
    b.sleep(); expect(bank.activeFilters).toBe(0)
    a.setDistance(0, 1); a.wake()
    expect(bank.activeFilters).toBe(1)
    a.sleep(); expect(bank.activeFilters).toBe(0)
  })
  it('離開距離桶時回收極小權重的舊路徑，避免移動後累積負載', () => {
    const ctx = context(), bank = createAirAbsorption(ctx, ctx.createGain()), route = bank.createRoute()
    const lower = AIR_DISTANCES[30]!, upper = AIR_DISTANCES[31]!
    route.setDistance(lower + (upper - lower) * 0.0005, 0); route.wake()
    expect(bank.activeFilters).toBe(2)
    route.setDistance(3000, 0.1)
    expect(bank.activeFilters).toBe(4)
    bank.update(0.3)
    expect(bank.activeFilters).toBe(2)
    route.sleep(); expect(bank.activeFilters).toBe(0)
  })
})
