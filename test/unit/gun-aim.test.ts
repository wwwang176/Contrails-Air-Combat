import { describe, it, expect } from 'vitest'
import {
  GUN_PITCH_MAX, GUN_YAW_HOLD, TANK_PITCH_MAX, TANK_PITCH_MIN, TANK_TRAVERSE_RATE, aimAngles, slewYaw,
} from '../../src/render/gunAim'

/** 砲塔的角度（SPEC `2026-10-08-gun-traverse-design.md` §5）。模型 −Z 朝前，yaw 繞 +Y、pitch 正值往上 */
const DEG = Math.PI / 180
const out = { yaw: 0, pitch: 0 }
const angles = (x: number, y: number, z: number, prevYaw = 0, prevPitch = 0, lo = -5 * DEG, hi = GUN_PITCH_MAX) => {
  aimAngles(x, y, z, prevYaw, prevPitch, lo, hi, out)
  return { yaw: out.yaw / DEG, pitch: out.pitch / DEG }
}

describe('方向 → 角度', () => {
  it('常數', () => {
    expect(GUN_PITCH_MAX).toBeCloseTo(85 * DEG, 12)
    expect(GUN_YAW_HOLD).toBe(0.02)
    expect(TANK_TRAVERSE_RATE).toBeCloseTo(20 * DEG, 12)
    expect(TANK_PITCH_MIN).toBeCloseTo(-5 * DEG, 12)
    expect(TANK_PITCH_MAX).toBeCloseTo(25 * DEG, 12)
  })

  it('正前方 0°、左 +90°、右 −90°、正後 ±180°', () => {
    expect(angles(0, 0, -1).yaw).toBeCloseTo(0, 9)
    expect(angles(-1, 0, 0).yaw).toBeCloseTo(90, 9)
    expect(angles(1, 0, 0).yaw).toBeCloseTo(-90, 9)
    expect(Math.abs(angles(0, 0, 1).yaw)).toBeCloseTo(180, 9)
  })

  it('仰角吃帶距離的向量：前方 100 m、高 2 m 約 1.15°', () => {
    expect(angles(0, 2, -100).pitch).toBeCloseTo(Math.atan2(2, 100) / DEG, 9)
    expect(angles(0, 1, -1).pitch).toBeCloseTo(45, 9)
  })

  it('仰角夾在上下限', () => {
    expect(angles(0, 100, -1).pitch).toBeCloseTo(85, 9)
    expect(angles(0, -1, -1).pitch).toBeCloseTo(-5, 9)
    expect(angles(0, 1, -1, 0, 0, TANK_PITCH_MIN, TANK_PITCH_MAX).pitch).toBeCloseTo(25, 9)
  })

  /** 【沒目標時砲位的 aim 是正上方】atan2(0, 0) 會讓砲塔一幀跳回正前方 */
  it('幾乎朝正上方時 yaw 沿用上一幀；長度 0 兩個都沿用', () => {
    expect(angles(0, 1, 0, 40 * DEG).yaw).toBeCloseTo(40, 9)
    expect(angles(0.01, 1, 0, 40 * DEG).yaw).toBeCloseTo(40, 9)
    expect(angles(0.05, 1, 0, 40 * DEG).yaw).toBeCloseTo(-90, 9)
    const z = angles(0, 0, 0, 30 * DEG, 12 * DEG)
    expect(z.yaw).toBeCloseTo(30, 9)
    expect(z.pitch).toBeCloseTo(12, 9)
  })
})

describe('轉速', () => {
  it('一步不超過 rate·dt，到了就停在目標', () => {
    expect(slewYaw(0, 1, 0.5, 0.1)).toBeCloseTo(0.05, 12)
    expect(slewYaw(0, -1, 0.5, 0.1)).toBeCloseTo(-0.05, 12)
    expect(slewYaw(0.99, 1, 0.5, 0.1)).toBe(1)
  })

  it('跨 ±180° 走短的那一邊，結果收在 (−π, π]', () => {
    const y = slewYaw(170 * DEG, -170 * DEG, 30 * DEG, 0.5)
    expect(y / DEG).toBeCloseTo(-175, 6)
  })

  it('dt 0 不動', () => {
    expect(slewYaw(0.3, 1, 0.5, 0)).toBe(0.3)
  })
})
