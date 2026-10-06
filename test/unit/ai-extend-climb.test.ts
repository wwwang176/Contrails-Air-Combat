import { describe, it, expect } from 'vitest'
import { DEFAULT_STEER } from '../../src/ai/steerConfig'
import { extendPitchAngle } from '../../src/ai/steer'

/**
 * `extend` 的高度項從 `extendClimbFrom` 起放行。
 */

const HIGH = 3000

describe('extend：比敵人低時，速度接近角落速度就開始往上', () => {
  it('角落速度的九成五、比敵人低 400 m → 爬升，不是繼續往下掉', () => {
    expect(extendPitchAngle(0.95, -400, HIGH)).toBeGreaterThan(0)
  })

  it('速度只剩六成四 → 仍然先低頭補速度', () => {
    expect(extendPitchAngle(0.64, -1000, HIGH)).toBeLessThan(0)
  })

  it('低於 extendClimbFrom → 高度項不作用', () => {
    const cr = DEFAULT_STEER.extendClimbFrom - 0.01
    expect(extendPitchAngle(cr, -400, HIGH)).toBeCloseTo(extendPitchAngle(cr, 0, HIGH), 9)
  })
})
