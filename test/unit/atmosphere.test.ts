import { describe, it, expect } from 'vitest'
import { atmosphere, RHO0 } from '../../src/physics/atmosphere'
import type { AirData } from '../../src/physics/types'

const air = (): AirData => ({
  density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0,
})

describe('atmosphere', () => {
  it('海平面符合 ISA 標準值', () => {
    const a = atmosphere(0, air())
    expect(a.temperature).toBeCloseTo(288.15, 6)
    expect(a.pressure).toBeCloseTo(101325, 0)
    expect(a.density).toBeCloseTo(1.225, 3)
    expect(a.soundSpeed).toBeCloseTo(340.29, 1)
    expect(a.sigma).toBeCloseTo(1.0, 6)
  })

  it('5,000 m 密度符合 ISA 表', () => {
    const a = atmosphere(5000, air())
    expect(a.temperature).toBeCloseTo(255.65, 3)
    expect(a.density).toBeCloseTo(0.7361, 3)
  })

  it('7,600 m（P-51 臨界高度）密度符合 ISA 表', () => {
    const a = atmosphere(7600, air())
    expect(a.density).toBeCloseTo(0.5503, 3)
  })

  it('對流層頂 11,000 m 溫度為 216.65 K', () => {
    const a = atmosphere(11000, air())
    expect(a.temperature).toBeCloseTo(216.65, 3)
    expect(a.pressure).toBeCloseTo(22632, -1)
  })

  it('平流層 12,000 m 溫度恆定、壓力續降', () => {
    const a = atmosphere(12000, air())
    expect(a.temperature).toBeCloseTo(216.65, 6)
    expect(a.density).toBeCloseTo(0.3108, 3)
  })

  it('密度隨高度單調遞減', () => {
    let prev = Infinity
    for (let h = 0; h <= 15000; h += 250) {
      const d = atmosphere(h, air()).density
      expect(d).toBeLessThan(prev)
      prev = d
    }
  })

  it('負高度不會產生 NaN', () => {
    const a = atmosphere(-50, air())
    expect(Number.isFinite(a.density)).toBe(true)
    expect(a.density).toBeGreaterThan(1.225)
  })

  it('寫入傳入的 out 物件並回傳同一參考（零配置）', () => {
    const out = air()
    expect(atmosphere(3000, out)).toBe(out)
  })

  it('sigma 為密度比', () => {
    const a = atmosphere(6000, air())
    expect(a.sigma).toBeCloseTo(a.density / RHO0, 12)
  })

  it('推導出的 RHO0 與 ICAO ISA 標稱值 1.225 kg/m³ 相符（誤差 < 2e-5）', () => {
    expect(RHO0).toBeCloseTo(1.225, 4)
    expect(Math.abs(RHO0 - 1.225) / 1.225).toBeLessThan(2e-5)
  })
})
