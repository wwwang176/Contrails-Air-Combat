import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { aimDirectionBody } from '../../src/input/aim'
import { AIM_RADIUS, createInputState } from '../../src/input/InputState'
import { DEG } from '../../src/core/math'

const FOV = 65 * DEG

describe('aimDirectionBody', () => {
  it('準星在中心時方向為機首（機體 −Z）', () => {
    const d = aimDirectionBody(0, 0, FOV, new Vector3())
    expect(d.x).toBeCloseTo(0, 12)
    expect(d.y).toBeCloseTo(0, 12)
    expect(d.z).toBeCloseTo(-1, 12)
  })

  it('準星向右產生 +X 分量', () => {
    expect(aimDirectionBody(0.3, 0, FOV, new Vector3()).x).toBeGreaterThan(0)
  })

  it('準星向上產生 +Y 分量', () => {
    expect(aimDirectionBody(0, 0.3, FOV, new Vector3()).y).toBeGreaterThan(0)
  })

  it('回傳單位向量', () => {
    expect(aimDirectionBody(0.35, -0.2, FOV, new Vector3()).length()).toBeCloseTo(1, 12)
  })

  it('偏移角隨 FOV 增大而增大', () => {
    const narrow = aimDirectionBody(0.3, 0, 40 * DEG, new Vector3())
    const wide = aimDirectionBody(0.3, 0, 90 * DEG, new Vector3())
    expect(Math.abs(wide.x)).toBeGreaterThan(Math.abs(narrow.x))
  })

  it('夾制圓邊緣的偏移角小於半個 FOV', () => {
    const d = aimDirectionBody(AIM_RADIUS, 0, FOV, new Vector3())
    const angle = Math.acos(-d.z)
    expect(angle).toBeLessThan(FOV / 2)
  })

  it('寫入傳入的 out 並回傳同一參考', () => {
    const out = new Vector3()
    expect(aimDirectionBody(0.1, 0.1, FOV, out)).toBe(out)
  })
})

describe('createInputState', () => {
  it('初始值合理', () => {
    const s = createInputState()
    expect(s.aimX).toBe(0)
    expect(s.aimY).toBe(0)
    expect(s.throttle).toBeGreaterThan(0)
    expect(s.throttle).toBeLessThanOrEqual(1.1)
    expect(s.lookActive).toBe(false)
    expect(s.viewMode).toBe('third')
  })
})
