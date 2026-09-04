import { describe, it, expect } from 'vitest'
import { BOMB_CONE_HALF_ANGLE, coneClamp, type Vec3Like } from '../../src/camera/bombsight'

const COS = Math.cos(BOMB_CONE_HALF_ANGLE)
const SIN = Math.sin(BOMB_CONE_HALF_ANGLE)
const out = (): Vec3Like => ({ x: 0, y: 0, z: 0 })
const angleTo = (v: Vec3Like, ax: number, ay: number, az: number): number =>
  Math.acos(Math.max(-1, Math.min(1, v.x * ax + v.y * ay + v.z * az)))

describe('coneClamp', () => {
  it('圓錐半角是 70 度', () => {
    expect(BOMB_CONE_HALF_ANGLE).toBeCloseTo((70 * Math.PI) / 180, 12)
  })

  it('錐內不動', () => {
    const o = out()
    // 天底軸 (0,−1,0)，方向偏 30°
    const a = (30 * Math.PI) / 180
    const clamped = coneClamp(Math.sin(a), -Math.cos(a), 0, 0, -1, 0, COS, SIN, o)
    expect(clamped).toBe(false)
    expect(o.x).toBeCloseTo(Math.sin(a), 9)
    expect(o.y).toBeCloseTo(-Math.cos(a), 9)
  })

  it('錐外落在錐面上，與軸恰好夾 70 度', () => {
    const o = out()
    // 水平方向 —— 離天底 90°
    const clamped = coneClamp(1, 0, 0, 0, -1, 0, COS, SIN, o)
    expect(clamped).toBe(true)
    expect(angleTo(o, 0, -1, 0)).toBeCloseTo(BOMB_CONE_HALF_ANGLE, 9)
    // 夾制只把方向拉回錐面，方位角不變 —— 仍在 +X 那一側
    expect(o.x).toBeGreaterThan(0)
    expect(o.z).toBeCloseTo(0, 9)
  })

  it('恆不在軸的 70 度之外 —— 抬頭是不可能的', () => {
    const o = out()
    const cases: readonly (readonly [number, number, number])[] = [
      [0, 1, 0], [0, 0.9, 0.44], [-0.7, 0.7, 0], [0, 0.999, 0.045], [0.3, 0.95, -0.1],
    ]
    for (const [dx, dy, dz] of cases) {
      const n = Math.hypot(dx, dy, dz)
      coneClamp(dx / n, dy / n, dz / n, 0, -1, 0, COS, SIN, o)
      expect(angleTo(o, 0, -1, 0)).toBeLessThanOrEqual(BOMB_CONE_HALF_ANGLE + 1e-9)
    }
  })

  it('與軸恰好反向時不產生 NaN', () => {
    const o = out()
    expect(coneClamp(0, 1, 0, 0, -1, 0, COS, SIN, o)).toBe(true)
    expect(Number.isFinite(o.x)).toBe(true)
    expect(Number.isFinite(o.y)).toBe(true)
    expect(Number.isFinite(o.z)).toBe(true)
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 9)
    expect(angleTo(o, 0, -1, 0)).toBeCloseTo(BOMB_CONE_HALF_ANGLE, 9)
  })

  it('反向的退化情況在任何軸上都不產生 NaN', () => {
    const o = out()
    // 軸沿 +X 時，退化分支挑的備用向量不能與它平行
    expect(coneClamp(-1, 0, 0, 1, 0, 0, COS, SIN, o)).toBe(true)
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 9)
    expect(angleTo(o, 1, 0, 0)).toBeCloseTo(BOMB_CONE_HALF_ANGLE, 9)
  })

  it('輸出恆是單位向量', () => {
    const o = out()
    for (const a of [0, 20, 45, 69, 70, 71, 90, 140, 179]) {
      const r = (a * Math.PI) / 180
      coneClamp(Math.sin(r), -Math.cos(r), 0, 0, -1, 0, COS, SIN, o)
      expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 9)
    }
  })

  it('圓錐軸是機體固定的 —— 側滾 60 度時錐跟著轉', () => {
    const o = out()
    // 右滾 60°：機腹軸由 (0,−1,0) 轉到 (−sin60, −cos60, 0)
    const ax = -Math.sin(Math.PI / 3)
    const ay = -Math.cos(Math.PI / 3)
    // 正下方離這根軸 60°，仍在錐內 → 不夾制。**陀螺穩定的話這裡會是 0°**
    expect(coneClamp(0, -1, 0, ax, ay, 0, COS, SIN, o)).toBe(false)
    // 離軸 80° 的方向會被夾
    const a = (80 * Math.PI) / 180
    const dx = ax * Math.cos(a) - ay * Math.sin(a)
    const dy = ay * Math.cos(a) + ax * Math.sin(a)
    expect(coneClamp(dx, dy, 0, ax, ay, 0, COS, SIN, o)).toBe(true)
    expect(angleTo(o, ax, ay, 0)).toBeCloseTo(BOMB_CONE_HALF_ANGLE, 9)
  })
})
