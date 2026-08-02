import { describe, it, expect, beforeEach } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createHudFrame, indicatedAirspeed } from '../../src/hud/types'
import { attitudeFromOrientation, headingFromOrientation } from '../../src/hud/attitude-math'
import { advanceGEffect, resetGEffect } from '../../src/hud/widgets/gEffect'
import { PILOT_G_NEGATIVE, PILOT_G_POSITIVE } from '../../src/control/limiters'
import { DEG, RAD } from '../../src/core/math'

describe('indicatedAirspeed', () => {
  it('海平面 IAS 等於 TAS', () => {
    expect(indicatedAirspeed(150, 1)).toBeCloseTo(150, 10)
  })

  it('高空 IAS 低於 TAS', () => {
    expect(indicatedAirspeed(200, 0.45)).toBeLessThan(200)
    expect(indicatedAirspeed(200, 0.45)).toBeCloseTo(200 * Math.sqrt(0.45), 10)
  })
})

describe('attitudeFromOrientation', () => {
  it('水平姿態的滾轉與俯仰皆為 0', () => {
    const a = attitudeFromOrientation(new Quaternion())
    expect(a.roll).toBeCloseTo(0, 10)
    expect(a.pitch).toBeCloseTo(0, 10)
  })

  it('機首上仰產生正俯仰角', () => {
    // 繞機體 +X（右翼軸）旋轉正角度 = 機首上仰
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 20 * DEG)
    expect(attitudeFromOrientation(q).pitch * RAD).toBeCloseTo(20, 4)
  })

  it('向右滾轉產生正滾轉角', () => {
    // 繞機體 −Z（機首軸）旋轉正角度 = 右滾
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 30 * DEG)
    expect(attitudeFromOrientation(q).roll * RAD).toBeCloseTo(30, 4)
  })

  it('大角度姿態不產生 NaN', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 2.7)
    const a = attitudeFromOrientation(q)
    expect(Number.isFinite(a.roll + a.pitch)).toBe(true)
  })
})

describe('headingFromOrientation', () => {
  it('機首朝 −Z 時航向為 0', () => {
    expect(headingFromOrientation(new Quaternion())).toBeCloseTo(0, 10)
  })

  it('機首朝 +X 時航向為 90 度', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -90 * DEG)
    expect(headingFromOrientation(q) * RAD).toBeCloseTo(90, 4)
  })
})

describe('createHudFrame', () => {
  it('初始值不含 NaN', () => {
    const f = createHudFrame()
    for (const v of Object.values(f)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('advanceGEffect', () => {
  const DT = 1 / 60
  beforeEach(resetGEffect)

  it('正常過載不產生任何效果', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(4, DT)
    const g = advanceGEffect(4, DT)
    expect(g.blackout).toBeLessThan(0.01)
    expect(g.redout).toBeLessThan(0.01)
  })

  it('限制器夾住的 6.5 G 持續轉彎看得到黑視（否則整套是死碼）', () => {
    // PILOT_G_POSITIVE 就是指揮儀的過載上限，玩家實際飛得到的最大值。
    // 黑視起點若設在同一個數字，overG 恆為 0，畫面永遠不會暗。
    for (let i = 0; i < 300; i++) advanceGEffect(PILOT_G_POSITIVE, DT)
    expect(advanceGEffect(PILOT_G_POSITIVE, DT).blackout).toBeGreaterThan(0.15)
  })

  it('瞬間拉一下大 G 不會立刻全黑（時間常數必須生效）', () => {
    expect(advanceGEffect(9, DT).blackout).toBeLessThan(0.05)
    // 半秒還遠不到全黑
    for (let i = 0; i < 30; i++) advanceGEffect(9, DT)
    expect(advanceGEffect(9, DT).blackout).toBeLessThan(0.5)
  })

  it('持續大 G 約兩秒後明顯變暗，放鬆後恢復', () => {
    for (let i = 0; i < 120; i++) advanceGEffect(9, DT)
    const peak = advanceGEffect(9, DT).blackout
    expect(peak).toBeGreaterThan(0.6)

    for (let i = 0; i < 360; i++) advanceGEffect(1, DT)
    expect(advanceGEffect(1, DT).blackout).toBeLessThan(0.15)
  })

  it('−3 G 是紅視的起點，不是一下子全紅', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(PILOT_G_NEGATIVE, DT)
    expect(advanceGEffect(PILOT_G_NEGATIVE, DT).redout).toBeLessThan(0.05)
  })

  it('更深的負 G 產生紅視而非黑視', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(-5, DT)
    const g = advanceGEffect(-5, DT)
    expect(g.redout).toBeGreaterThan(0.7)
    expect(g.blackout).toBeLessThan(0.01)
  })

  it('resetGEffect 清除殘留（重生後不該還是黑的）', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(9, DT)
    resetGEffect()
    expect(advanceGEffect(1, 0).blackout).toBe(0)
  })
})
