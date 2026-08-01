import { describe, it, expect } from 'vitest'
import { Pid } from '../../src/control/pid'

const gains = { kp: 1, ki: 0, kd: 0, integralLimit: 1, outputLimit: 1 }

describe('Pid', () => {
  it('純比例項輸出等於 kp × 誤差', () => {
    const p = new Pid({ ...gains, kp: 0.5 })
    expect(p.update(0.4, 0.01)).toBeCloseTo(0.2, 10)
  })

  it('輸出受 outputLimit 夾制', () => {
    const p = new Pid({ ...gains, kp: 10, outputLimit: 1 })
    expect(p.update(5, 0.01)).toBe(1)
    expect(p.update(-5, 0.01)).toBe(-1)
  })

  it('積分項隨時間累積', () => {
    const p = new Pid({ ...gains, kp: 0, ki: 1, integralLimit: 10, outputLimit: 10 })
    p.update(1, 0.5)
    expect(p.update(1, 0.5)).toBeCloseTo(1, 6)
  })

  it('積分項受 integralLimit 夾制（防積分飽和）', () => {
    const p = new Pid({ ...gains, kp: 0, ki: 1, integralLimit: 0.3, outputLimit: 10 })
    for (let i = 0; i < 100; i++) p.update(1, 0.1)
    expect(p.update(1, 0.1)).toBeCloseTo(0.3, 6)
  })

  it('微分項響應誤差變化率', () => {
    const p = new Pid({ ...gains, kp: 0, kd: 0.1, outputLimit: 10 })
    p.update(0, 0.1)
    expect(p.update(1, 0.1)).toBeCloseTo(1, 6) // Δe/Δt = 1/0.1 = 10，×0.1 = 1
  })

  it('首次呼叫時微分項不產生突波', () => {
    const p = new Pid({ ...gains, kp: 0, kd: 1, outputLimit: 100 })
    expect(p.update(5, 0.01)).toBe(0)
  })

  it('reset 清除積分與微分狀態', () => {
    const p = new Pid({ ...gains, kp: 0, ki: 1, integralLimit: 10, outputLimit: 10 })
    for (let i = 0; i < 10; i++) p.update(1, 0.1)
    p.reset()
    expect(p.update(0, 0.1)).toBeCloseTo(0, 10)
  })

  it('dt 為 0 時不產生 NaN', () => {
    const p = new Pid({ ...gains, kp: 1, ki: 1, kd: 1, outputLimit: 10 })
    p.update(1, 0.01)
    expect(Number.isFinite(p.update(1, 0))).toBe(true)
  })

  it('gains 可即時變更（供調參面板使用）', () => {
    const p = new Pid({ ...gains, kp: 1 })
    expect(p.update(0.5, 0.01)).toBeCloseTo(0.5, 10)
    p.gains.kp = 2
    expect(p.update(0.5, 0.01)).toBeCloseTo(1, 10)
  })
})
