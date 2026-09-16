import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import type { Box } from '../../src/world/hit'
import { HULL_AIM_SPACING, SHIP_CLASSES, hullAimPoints } from '../../src/world/ships'

const boxOf = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Box => ({
  center: new Vector3(cx, cy, cz), half: new Vector3(hx, hy, hz),
})

const inFootprint = (p: Vector3, b: Box): boolean =>
  Math.abs(p.x - b.center.x) <= b.half.x + 1e-6 && Math.abs(p.z - b.center.z) <= b.half.z + 1e-6

/**
 * 砲位打光之後戰鬥機掃射的瞄點，由艦級的命中盒自動產生。
 *
 * 【它在防什麼】只瞄船心的話，266 m 長的航母每一趟都打同一點；點鋪到水下
 * 或船殼裡面，飛機會對著海面或看不到的地方打。
 */
describe('hullAimPoints：由命中盒產生的掃射瞄點', () => {
  it('點數跟著艦體長度：驅逐艦 3、重巡 4、航母 8', () => {
    expect(SHIP_CLASSES.fletcher.aimPoints.length).toBe(3)
    expect(SHIP_CLASSES.wichita.aimPoints.length).toBe(4)
    expect(SHIP_CLASSES.essex.aimPoints.length).toBe(8)
  })

  it('每一個點都在某個盒的頂面上，而且在水面之上', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      for (const p of cls.aimPoints) {
        expect(p.y, cls.id).toBeGreaterThan(0)
        const onTop = cls.hull.some((b) =>
          inFootprint(p, b) && Math.abs(p.y - (b.center.y + b.half.y)) < 1e-6)
        expect(onTop, `${cls.id} ${p.toArray()}`).toBe(true)
      }
    }
  })

  /** 【被蓋住的點不要】Essex 船體盒的頂面整條在飛行甲板底下，艦島下層在上層底下 */
  it('沒有點被上方的另一個盒蓋住', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      for (const p of cls.aimPoints) {
        const covered = cls.hull.some((b) =>
          inFootprint(p, b) && b.center.y - b.half.y >= p.y - 1e-6
          && Math.abs(p.y - (b.center.y + b.half.y)) > 1e-6)
        expect(covered, `${cls.id} ${p.toArray()}`).toBe(false)
      }
    }
  })

  it('沿艦長相鄰兩點的間距不超過間距上限', () => {
    for (const id of ['fletcher', 'wichita'] as const) {
      const zs = SHIP_CLASSES[id].aimPoints.map((p) => p.z).sort((a, b) => a - b)
      for (let i = 1; i < zs.length; i++) {
        expect(zs[i]! - zs[i - 1]!, id).toBeLessThanOrEqual(HULL_AIM_SPACING + 1e-6)
      }
    }
  })

  it('寬度超過間距的盒，寬度方向也會多點', () => {
    const pts = hullAimPoints([boxOf(0, 0, 0, 60, 5, 10)])
    expect(pts.length).toBe(3)
    for (const p of pts) expect(p.y).toBeCloseTo(5, 6)
  })

  it('比間距小的盒至少一個點，放在頂面中心', () => {
    const pts = hullAimPoints([boxOf(3, 2, -4, 5, 2, 5)])
    expect(pts.length).toBe(1)
    expect(pts[0]!.toArray()).toEqual([3, 4, -4])
  })
})
