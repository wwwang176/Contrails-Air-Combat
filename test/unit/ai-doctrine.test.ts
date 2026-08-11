import { describe, it, expect } from 'vitest'
import { energyPull, DEFAULT_DOCTRINE } from '../../src/ai/doctrine'

describe('energyPull：能量見底時少拉一點', () => {
  it('速度充足時完全放行', () => {
    expect(energyPull(1.0, DEFAULT_DOCTRINE)).toBe(1)
    expect(energyPull(1.5, DEFAULT_DOCTRINE)).toBe(1)
  })

  it('速度見底時夾到下限，但不歸零', () => {
    // 【為什麼不歸零】完全鬆桿的 AI 是靶子。下限保留最低限度的機動
    expect(energyPull(0.5, DEFAULT_DOCTRINE)).toBe(DEFAULT_DOCTRINE.energyMinPull)
    expect(DEFAULT_DOCTRINE.energyMinPull).toBeGreaterThan(0)
  })

  it('中間段單調遞增且連續', () => {
    let prev = -1
    for (let r = 0.5; r <= 1.2; r += 0.01) {
      const p = energyPull(r, DEFAULT_DOCTRINE)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
  })

  it('兩端接得上：門檻處剛好等於邊界值', () => {
    const c = DEFAULT_DOCTRINE
    expect(energyPull(c.energyFreeRatio, c)).toBeCloseTo(1, 12)
    expect(energyPull(c.energyFloorRatio, c)).toBeCloseTo(c.energyMinPull, 12)
  })

  it('門檻退化時安全回傳 1（不得意外把 AI 鎖死）', () => {
    const degenerate = { ...DEFAULT_DOCTRINE, energyFreeRatio: 0.7, energyFloorRatio: 0.7 }
    expect(energyPull(0.5, degenerate)).toBe(1)
  })
})
