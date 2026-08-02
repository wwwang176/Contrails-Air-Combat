import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { bodyToStd, stdToBody, alphaFrom, betaFrom, type StdVec } from '../../src/physics/axes'

const std = (): StdVec => ({ x: 0, y: 0, z: 0 })

describe('axes', () => {
  it('機首方向（機體 −Z）對應標準軸前方 +X', () => {
    const s = bodyToStd(new Vector3(0, 0, -1), std())
    expect(s.x).toBeCloseTo(1, 12)
    expect(s.y).toBeCloseTo(0, 12)
    expect(s.z).toBeCloseTo(0, 12)
  })

  it('右翼方向（機體 +X）對應標準軸右方 +Y', () => {
    const s = bodyToStd(new Vector3(1, 0, 0), std())
    expect(s.x).toBeCloseTo(0, 12)
    expect(s.y).toBeCloseTo(1, 12)
    expect(s.z).toBeCloseTo(0, 12)
  })

  it('上方（機體 +Y）對應標準軸下方 −Z', () => {
    const s = bodyToStd(new Vector3(0, 1, 0), std())
    expect(s.z).toBeCloseTo(-1, 12)
  })

  it('往返轉換還原原向量', () => {
    const original = new Vector3(3, -7, 11)
    const s = bodyToStd(original, std())
    const back = stdToBody(s.x, s.y, s.z, new Vector3())
    expect(back.x).toBeCloseTo(3, 12)
    expect(back.y).toBeCloseTo(-7, 12)
    expect(back.z).toBeCloseTo(11, 12)
  })

  it('角速度轉換：機體 −Z 方向的角速度為正滾轉率 p', () => {
    const s = bodyToStd(new Vector3(0, 0, -2), std())
    expect(s.x).toBeCloseTo(2, 12) // p = −ω.z
  })

  it('正迎角：相對氣流從下方來（機體速度含 −Y 分量）', () => {
    const s = bodyToStd(new Vector3(0, -10, -100), std())
    expect(alphaFrom(s)).toBeCloseTo(Math.atan2(10, 100), 12)
    expect(alphaFrom(s)).toBeGreaterThan(0)
  })

  it('零迎角：速度純沿機首方向', () => {
    const s = bodyToStd(new Vector3(0, 0, -150), std())
    expect(alphaFrom(s)).toBeCloseTo(0, 12)
  })

  it('正側滑：相對氣流從右方來（機體速度含 +X 分量）', () => {
    const v = new Vector3(10, 0, -100)
    const s = bodyToStd(v, std())
    expect(betaFrom(s, v.length())).toBeCloseTo(Math.asin(10 / v.length()), 12)
    expect(betaFrom(s, v.length())).toBeGreaterThan(0)
  })

  it('tas 為 0 時 betaFrom 回傳 0 而非 NaN', () => {
    expect(betaFrom({ x: 0, y: 0, z: 0 }, 0)).toBe(0)
  })

  it('betaFrom 對超出 asin 定義域的輸入夾制', () => {
    expect(Number.isFinite(betaFrom({ x: 0, y: 200, z: 0 }, 100))).toBe(true)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const out = std()
    expect(bodyToStd(new Vector3(1, 2, 3), out)).toBe(out)
    const bv = new Vector3()
    expect(stdToBody(1, 2, 3, bv)).toBe(bv)
  })
})
