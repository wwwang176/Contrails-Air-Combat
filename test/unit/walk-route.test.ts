import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { walkRoute, headingToward, type PoseState, type RouteMotion } from '../../src/control/takeoffRoll'

/**
 * # 沿折線走（車輛用的參數）
 *
 * 滑行那一側的行為由 `takeoff-roll.test.ts` 與 `asch.test.ts` 守；這裡守的是
 * 換一組速度與轉彎半徑之後，走法本身仍然對：全程秒數、連續、停在終點、
 * 弧不會偏離折線太遠。
 */

const pose = (): PoseState => ({
  position: new Vector3(), velocity: new Vector3(),
  orientation: new Quaternion(), angularVelocity: new Vector3(),
})
const CAR: RouteMotion = { speed: 10, turnRadius: 25, turnRate: 10 / 25 }
const PATH = [{ x: 0, z: 0 }, { x: 0, z: -500 }, { x: -400, z: -800 }] as const
const H0 = headingToward(0, -500)
const H1 = headingToward(-400, -300)

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax
  const abz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)))
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t))
}

describe('walkRoute：車輛用的參數', () => {
  it('全程秒數等於弧切之後的路長除以車速（頭尾不必原地轉）', () => {
    const total = walkRoute(PATH, H0, H1, Infinity, 0, null, CAR)
    // 直線段 500 + 500，轉角 53.13° 以 25 m 圓弧切入
    const turn = Math.abs(H1 - H0)
    const trim = 25 * Math.tan(turn / 2)
    const len = 500 - trim + 500 - trim + turn * 25
    expect(total).toBeCloseTo(len / 10, 6)
  })

  it('位置與航向沿時間連續，沒有跳動', () => {
    const total = walkRoute(PATH, H0, H1, Infinity, 0, null, CAR)
    const a = pose()
    const b = pose()
    for (let t = 0; t + 0.05 < total; t += 0.05) {
      walkRoute(PATH, H0, H1, t, 0, a, CAR)
      walkRoute(PATH, H0, H1, t + 0.05, 0, b, CAR)
      expect(a.position.distanceTo(b.position)).toBeLessThan(10 * 0.05 + 1e-6)
      expect(a.orientation.angleTo(b.orientation)).toBeLessThan(CAR.turnRate * 0.05 + 1e-6)
    }
  })

  it('走完之後停在最後一點', () => {
    const s = pose()
    walkRoute(PATH, H0, H1, 1e6, 3, s, CAR)
    expect(s.position.x).toBeCloseTo(-400, 6)
    expect(s.position.z).toBeCloseTo(-800, 6)
    expect(s.position.y).toBe(3)
  })

  it('弧上的點離兩段折線的距離不超過 r·(1/cos(θ/2) − 1)', () => {
    const turn = Math.abs(H1 - H0)
    const bound = 25 * (1 / Math.cos(turn / 2) - 1) + 1e-6
    const total = walkRoute(PATH, H0, H1, Infinity, 0, null, CAR)
    const s = pose()
    for (let t = 0; t < total; t += 0.1) {
      walkRoute(PATH, H0, H1, t, 0, s, CAR)
      const d = Math.min(
        distToSeg(s.position.x, s.position.z, 0, 0, 0, -500),
        distToSeg(s.position.x, s.position.z, 0, -500, -400, -800),
      )
      expect(d).toBeLessThan(bound)
    }
  })

  it('速度寫在 velocity 上：直線段上大小等於車速、方向朝機首', () => {
    const s = pose()
    walkRoute(PATH, H0, H1, 10, 0, s, CAR)
    expect(s.velocity.length()).toBeCloseTo(10, 9)
    expect(s.velocity.z).toBeCloseTo(-10, 9)
  })
})
