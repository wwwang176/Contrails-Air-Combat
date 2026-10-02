import { describe, expect, it } from 'vitest'
import { ARC_GRAVITY, arcAt, solveArc, type ArcPoint, type ArcShot } from '../../src/render/arc'

const DEG = Math.PI / 180

const solve = (dx: number, dy: number, dz: number, elev = 60 * DEG): ArcShot => {
  const out: ArcShot = { x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 }
  expect(solveArc(0, 0, 0, dx, dy, dz, elev, out)).toBe(true)
  return out
}
const at = (s: ArcShot, t: number): ArcPoint => {
  const p: ArcPoint = { x: 0, y: 0, z: 0 }
  arcAt(s, t, p)
  return p
}

describe('迫擊砲的拋物線', () => {
  /** 落地的那一刻剛好在目標上：往上、往下、斜向都一樣 */
  it.each([
    [1000, 0, 0], [0, 0, -1500], [600, 0, 800], [900, 25, 300], [900, -40, 300],
  ])('飛行時間一到就落在目標點 (%d, %d, %d)', (dx, dy, dz) => {
    const s = solve(dx, dy, dz)
    const p = at(s, s.flight)
    expect(p.x).toBeCloseTo(dx, 6)
    expect(p.y).toBeCloseTo(dy, 6)
    expect(p.z).toBeCloseTo(dz, 6)
  })

  it('平地上 60° 打 1 km：頂點高度與初速的公式一致，而且在飛行時間的一半', () => {
    const s = solve(1000, 0, 0)
    const apex = (s.vy * s.vy) / (2 * ARC_GRAVITY)
    expect(at(s, s.flight / 2).y).toBeCloseTo(apex, 6)
    // 取樣的最高點不會比公式的頂點更高
    let max = -Infinity
    for (let k = 0; k <= 200; k++) max = Math.max(max, at(s, (s.flight * k) / 200).y)
    expect(max).toBeLessThanOrEqual(apex + 1e-9)
    // 60° 的仰角：垂直分量 ÷ 水平分量 = tan 60°
    expect(s.vy / Math.hypot(s.vx, s.vz)).toBeCloseTo(Math.tan(60 * DEG), 9)
  })

  it('水平速度恆定，沿著發射點到目標的方向', () => {
    const s = solve(600, 0, 800)
    const a = at(s, 3)
    const b = at(s, 7)
    expect((b.x - a.x) / 4).toBeCloseTo(s.vx, 9)
    expect((b.z - a.z) / 4).toBeCloseTo(s.vz, 9)
    expect(s.vx / s.vz).toBeCloseTo(600 / 800, 9)
  })

  it('發射點不在原點也一樣：位置是發射點加上位移', () => {
    const s: ArcShot = { x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 }
    expect(solveArc(-300, 12, 500, 100, 20, -200, 60 * DEG, s)).toBe(true)
    const p = at(s, s.flight)
    expect(p.x).toBeCloseTo(-200, 6)
    expect(p.y).toBeCloseTo(32, 6)
    expect(p.z).toBeCloseTo(300, 6)
    expect(at(s, 0)).toEqual({ x: -300, y: 12, z: 500 })
  })

  it('打不到的不給解：太近、目標比仰角線還高', () => {
    const s: ArcShot = { x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 }
    expect(solveArc(0, 0, 0, 0.2, 0, 0.2, 60 * DEG, s)).toBe(false)
    // 水平 100 m、仰角 60°：直線最高到 173 m，目標在 300 m 高就不可能
    expect(solveArc(0, 0, 0, 100, 300, 0, 60 * DEG, s)).toBe(false)
  })

  /** 回傳成功卻帶著 NaN／Infinity 的彈道，尾流的頂點會壞、而且永遠不落地也不到期 */
  it('輸入不是有限的數、或算出來的飛行時間不是有限的，都不給解', () => {
    const s: ArcShot = { x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 }
    expect(solveArc(NaN, 0, 0, 1000, 0, 0, 60 * DEG, s)).toBe(false)
    expect(solveArc(0, 0, 0, Infinity, 0, 0, 60 * DEG, s)).toBe(false)
    expect(solveArc(0, 0, 0, 1000, NaN, 0, 60 * DEG, s)).toBe(false)
    expect(solveArc(0, 0, 0, 1000, 0, 0, NaN, s)).toBe(false)
    // 全部有限，但高度差或距離大到速度與時間溢位
    expect(solveArc(0, 0, 0, 1000, -1e308, 0, 60 * DEG, s)).toBe(false)
    expect(solveArc(0, 0, 0, 1e154, 0, 0, 60 * DEG, s)).toBe(false)
  })

  /** 仰角越陡飛得越久、拋得越高：高拋物線的來源 */
  it('仰角越陡，飛行時間越長', () => {
    const lo = solve(1000, 0, 0, 45 * DEG)
    const hi = solve(1000, 0, 0, 70 * DEG)
    expect(hi.flight).toBeGreaterThan(lo.flight)
    expect(hi.vy).toBeGreaterThan(lo.vy)
  })
})
