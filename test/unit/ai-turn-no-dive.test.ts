import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { DEFAULT_STEER } from '../../src/ai/steerConfig'
import { holdTurnLevel } from '../../src/ai/steer'
import { DEG } from '../../src/core/math'

/**
 * # 迴轉時不壓機鼻
 *
 * 敵人在機頭 `turnFrontCone`（75°）以外 —— 還在迴轉 —— 而且沒有低我
 * `turnDiveRadii`（1.5）個迴旋半徑以上，瞄準俯仰最低只到水平：水平轉或拉高轉。
 * 敵人已經在前方時照舊可以壓機鼻攻擊；敵人低我很多時照舊可以俯衝迴轉。
 */

const R = 300
const heading = new Vector3(0, 0, -1)

/** 方位 45°、俯仰 `pitch` 的瞄準方向 */
function aim(pitchDeg: number): Vector3 {
  const p = pitchDeg * DEG
  return new Vector3(Math.sin(45 * DEG) * Math.cos(p), Math.sin(p), -Math.cos(45 * DEG) * Math.cos(p))
}

describe('holdTurnLevel', () => {
  it('還在迴轉、敵人差不多高：往下的瞄準抬到水平，方位不變', () => {
    const a = aim(-30)
    holdTurnLevel(a, 100 * DEG, 0, R, heading, DEFAULT_STEER)
    expect(a.y).toBe(0)
    expect(a.length()).toBeCloseTo(1, 12)
    expect(Math.atan2(a.x, -a.z) / DEG).toBeCloseTo(45, 9)
  })

  it('敵人已經在前方（75° 以內）：照舊可以壓機鼻', () => {
    const a = aim(-30)
    holdTurnLevel(a, 60 * DEG, 0, R, heading, DEFAULT_STEER)
    expect(Math.asin(a.y) / DEG).toBeCloseTo(-30, 9)
  })

  it('敵人低我超過 1.5 個迴旋半徑：照舊可以俯衝迴轉', () => {
    const a = aim(-30)
    holdTurnLevel(a, 100 * DEG, 1.5 * R + 1, R, heading, DEFAULT_STEER)
    expect(Math.asin(a.y) / DEG).toBeCloseTo(-30, 9)
  })

  it('敵人低我不到 1.5 個迴旋半徑：抬到水平', () => {
    const a = aim(-30)
    holdTurnLevel(a, 100 * DEG, 1.5 * R - 1, R, heading, DEFAULT_STEER)
    expect(a.y).toBe(0)
  })

  it('瞄準本來就往上：不動', () => {
    const a = aim(20)
    holdTurnLevel(a, 100 * DEG, 0, R, heading, DEFAULT_STEER)
    expect(Math.asin(a.y) / DEG).toBeCloseTo(20, 9)
  })

  /** 【幾乎垂直往下時水平分量是零】方位沒有定義，拿自己的水平航向 */
  it('瞄準幾乎垂直往下：改成自己的水平航向', () => {
    const a = new Vector3(0, -1, 0)
    holdTurnLevel(a, 100 * DEG, 0, R, heading, DEFAULT_STEER)
    expect(a.x).toBeCloseTo(0, 12)
    expect(a.y).toBe(0)
    expect(a.z).toBeCloseTo(-1, 12)
  })
})
