import { describe, it, expect } from 'vitest'
import { redlineDiveIas, DEFAULT_STEER } from '../../src/ai/steer'
import { F4F4 } from '../../src/specs/f4f4'
import { A6M5 } from '../../src/specs/a6m5'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

/**
 * 規則 3 的俯衝目標：自己紅線比對手高一截才俯衝，俯衝到對手放手的速度就停。
 *
 * 【餘裕條件擋的是連坐】P-51 對 Bf109 兩邊紅線只差 8%，沒有這個條件 P-51 也
 * 會開始往紅線壓 —— 那一對的行為不該因為 F4F 的問題而變。
 */
describe('redlineDiveIas', () => {
  it('F4F 對 A6M 有餘裕：目標是對手紅線 × 1.05', () => {
    expect(redlineDiveIas(F4F4.limits.vne, A6M5.limits.vne))
      .toBeCloseTo(DEFAULT_STEER.diveTargetRatio * A6M5.limits.vne, 6)
  })

  it('P-51 對 Bf109 沒有餘裕 → 0', () => {
    expect(redlineDiveIas(P51D.limits.vne, BF109K4.limits.vne)).toBe(0)
  })

  it('同機種 → 0', () => {
    expect(redlineDiveIas(A6M5.limits.vne, A6M5.limits.vne)).toBe(0)
  })

  it('反過來（零戰對 F4F）→ 0：比對手低的一方不俯衝', () => {
    expect(redlineDiveIas(A6M5.limits.vne, F4F4.limits.vne)).toBe(0)
  })

  it('目標永遠低於自己的 diveSelfRatio', () => {
    const v = redlineDiveIas(1000, 100)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(DEFAULT_STEER.diveSelfRatio * 1000)
  })
})
