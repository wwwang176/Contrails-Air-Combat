import { describe, it, expect } from 'vitest'
import { DEFAULT_DOCTRINE, turnPlaneCost, turnPlanePitch } from '../../src/ai/doctrine'
import { P51D } from '../../src/specs/p51d'

/**
 * 迴旋平面：水平與拉高優先，俯衝不是首選。
 *
 * 情境是回頭攻擊正後方的敵人：3,000 m、645 km/h、機鼻離預瞄點 165°、視線幾乎
 * 不動；敵人同高 504 km/h。
 */

const RAD = Math.PI / 180
const ALT = 3000
const TAS = 645 / 3.6
const SWING = 165 * RAD
const LOS = 0.005

describe('迴旋平面：回頭攻擊正後方的敵人', () => {
  it('水平大迴旋飛得出來 —— 速度掉到角落速度以下不等於失速', () => {
    const c = turnPlaneCost(P51D, ALT, TAS, SWING, LOS, 0)
    expect(c.stalled).toBe(false)
    expect(Number.isFinite(c.seconds)).toBe(true)
  })

  it('能量比敵人多一點時不選俯衝迴旋', () => {
    expect(turnPlanePitch(P51D, ALT, TAS, SWING, LOS, ALT, 140, DEFAULT_DOCTRINE)).toBeGreaterThanOrEqual(0)
  })

  it('敵人真的低很多時，俯衝迴旋仍然選得到', () => {
    expect(turnPlanePitch(P51D, ALT, TAS, SWING, LOS, ALT - 2500, 140, DEFAULT_DOCTRINE)).toBeLessThan(0)
  })
})
