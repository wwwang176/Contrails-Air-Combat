import { describe, expect, it } from 'vitest'
import { Vector3, type Mesh } from 'three'
import {
  SHIP_BOW_WAKE, SHIP_STERN_WAKE, createShipWakes, shipHalfSize, shipWakePoint,
} from '../../src/render/shipWakes'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'

/**
 * # 船的航跡
 *
 * 守的是「從哪裡落、停著的船沒有、寬度照艦寬」。好不好看由截圖裁定。
 */

const flat = () => 0

/** 讓船沿艏向走 `seconds` 秒，每 0.1 秒餵一次航跡 */
function sail(speed: number, seconds: number) {
  const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, speed)
  const w = createShipWakes([ship])
  const fwd = new Vector3(0, 0, -1).applyQuaternion(ship.orientation)
  for (let t = 0; t < seconds; t += 0.1) {
    ship.position.addScaledVector(fwd, speed * 0.1)
    w.step([ship], 0.1, t, flat)
  }
  return { ship, w }
}

/** 一條帶子（第 0 格）的頂點：有不透明度的那些 */
function visible(obj: Mesh) {
  const p = obj.geometry.getAttribute('position')
  const a = obj.geometry.getAttribute('aAlpha')
  const out: Vector3[] = []
  for (let i = 0; i < p.count; i++) if (a.getX(i) > 0) out.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)))
  return out
}

describe('船的航跡', () => {
  it('艦首與艦尾的點在船體兩端，跟著艏向轉', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 100, 200, Math.PI / 2, 8)
    const { halfLength } = shipHalfSize(ship)
    expect(halfLength).toBeCloseTo(57.4, 3)
    const bow = shipWakePoint(ship, -1, new Vector3())
    const stern = shipWakePoint(ship, 1, new Vector3())
    // 繞 +Y 轉 90°：艦首 −Z 轉到 −X
    expect(bow.x).toBeCloseTo(100 - halfLength, 3)
    expect(stern.x).toBeCloseTo(100 + halfLength, 3)
    expect(bow.z).toBeCloseTo(200, 3)
  })

  /** 【停著的船沒有航跡】灘頭擱淺的 LST 航速是 0 */
  it('停著的船不落節點，兩條帶子都看不到', () => {
    const { w } = sail(0, 10)
    const [stern, bow] = w.object.children as [Mesh, Mesh]
    expect(visible(stern)).toEqual([])
    expect(visible(bow)).toEqual([])
  })

  it('開動的船艦尾拖出一長條、艦首的白浪比船寬', () => {
    const { ship, w } = sail(8, 20)
    const [stern, bow] = w.object.children as [Mesh, Mesh]
    const { halfBeam } = shipHalfSize(ship)
    const sv = visible(stern)
    const bv = visible(bow)
    expect(sv.length).toBeGreaterThan(10)
    expect(bv.length).toBeGreaterThan(4)
    // 寬度照艦寬：艦首最寬處超出船舷，艦尾最寬處是半艦寬的數倍
    const maxX = (vs: Vector3[]) => Math.max(...vs.map((v) => Math.abs(v.x)))
    expect(maxX(bv)).toBeGreaterThan(halfBeam * 1.3)
    expect(maxX(bv)).toBeLessThanOrEqual(halfBeam * SHIP_BOW_WAKE.halfTo + 1e-3)
    expect(maxX(sv)).toBeGreaterThan(halfBeam * SHIP_STERN_WAKE.halfFrom)
    // 艦尾那一條在船後面（+Z），艦首那一條從艦首往後
    const { halfLength } = shipHalfSize(ship)
    const shipZ = ship.position.z
    for (const v of sv) expect(v.z).toBeGreaterThanOrEqual(shipZ + halfLength - 1e-3)
    for (const v of bv) expect(v.z).toBeGreaterThanOrEqual(shipZ - halfLength - 1e-3)
  })

  /** 【沉了就不再落】已經落的照常淡掉 */
  it('沉了的船不再落新節點', () => {
    const { ship, w } = sail(8, 5)
    ship.alive = false
    const [stern] = w.object.children as [Mesh, Mesh]
    const before = visible(stern).length
    const fwd = new Vector3(0, 0, -1)
    for (let t = 0; t < 5; t += 0.1) {
      ship.position.addScaledVector(fwd, 0.8)
      w.step([ship], 0.1, t, flat)
    }
    expect(visible(stern).length).toBeLessThanOrEqual(before)
  })
})
