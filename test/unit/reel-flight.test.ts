import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createFlight, flightPose, openSeaOrigin, type Path } from '../../src/app/reelFlight'

const G = 9.81

describe('flightPose：路徑 → 姿態', () => {
  it('朝 −Z 等速平飛：姿態是單位旋轉，速度就是路徑的斜率', () => {
    const path: Path = (t, out) => out.set(0, 300, -100 * t)
    const f = createFlight()
    flightPose(path, 5, f)
    expect(f.position.z).toBeCloseTo(-500, 6)
    expect(f.velocity.z).toBeCloseTo(-100, 3)
    expect(f.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-4)
  })

  it('朝 +X 爬升：機首沿速度，機首向上抬', () => {
    const path: Path = (t, out) => out.set(80 * t, 200 + 10 * t, 0)
    const f = createFlight()
    flightPose(path, 3, f)
    const nose = new Vector3(0, 0, -1).applyQuaternion(f.quaternion)
    expect(nose.x).toBeGreaterThan(0.99)
    expect(Math.asin(nose.y)).toBeCloseTo(Math.atan2(10, 80), 4)
  })

  it('等速圓周：滾轉角等於 atan(v²/(r·g))，機背朝圓心那一側倒', () => {
    const r = 1500
    const v = 120
    const w = v / r
    // 逆時針（俯視，+X 往 −Z）—— 往左轉
    const path: Path = (t, out) => out.set(r * Math.cos(w * t), 500, -r * Math.sin(w * t))
    const f = createFlight()
    const t = 7
    flightPose(path, t, f)
    const up = new Vector3(0, 1, 0).applyQuaternion(f.quaternion)
    const bank = Math.acos(up.y)
    expect(bank).toBeCloseTo(Math.atan((v * v) / (r * G)), 3)
    // 機體上方的水平分量指向圓心
    const toCentre = new Vector3(-f.position.x, 0, -f.position.z).normalize()
    expect(new Vector3(up.x, 0, up.z).normalize().dot(toCentre)).toBeGreaterThan(0.999)
    // 往左轉 = 左翼下沉：右翼尖比機身高
    const right = new Vector3(1, 0, 0).applyQuaternion(f.quaternion)
    expect(right.y).toBeGreaterThan(0)
  })
})

describe('openSeaOrigin：找一塊開闊的海', () => {
  const island = (cx: number, cz: number, outerRadius: number) =>
    ({ cx, cz, radius: outerRadius * 0.7, outerRadius, peak: 100, lobes: [] })

  it('原點附近有島時往外找，回傳的圓與每一座島都不重疊', () => {
    const islands = [island(0, 0, 3000), island(6000, 0, 2000), island(0, -7000, 2500)]
    const o = openSeaOrigin(islands, 4000)
    for (const s of islands) {
      expect(Math.hypot(o.x - s.cx, o.z - s.cz)).toBeGreaterThanOrEqual(s.outerRadius + 4000)
    }
  })

  it('沒有島就是原點', () => {
    const o = openSeaOrigin([], 4000)
    expect(o.x).toBe(0)
    expect(o.z).toBe(0)
  })
})
