import { describe, expect, it } from 'vitest'
import { ALL_SPECS } from '../../src/battle/skirmish'

/**
 * `AircraftSpec.diveBomber` 只在 Ju 87 上：AI 的俯衝投彈（`ai/diveBomb.ts`）由它啟動，
 * 其他機種的投彈行為不動。
 */
describe('diveBomber 旗標', () => {
  it('全部機種裡只有 Ju 87 設了它', () => {
    expect(ALL_SPECS.length).toBeGreaterThanOrEqual(10)
    for (const s of ALL_SPECS) {
      if (s.id === 'ju87') expect(s.diveBomber, s.id).toBe(true)
      else expect(s.diveBomber, s.id).toBeUndefined()
    }
  })
})
