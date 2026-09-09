import { describe, expect, it } from 'vitest'
import { PLANT_SIZE, type PlantKind } from '../../src/render/geometry/ground/plant'
import { GROUND_UNITS } from '../../src/render/geometry/ground'

/**
 * 油廠構件的尺寸，**獨立寫死**。`ground-units.test.ts` 拿登記表的
 * `real*` 對幾何比，而登記表的 `real*` 與命中盒都是從 `PLANT_SIZE` 撐起來的
 * —— 三者一起漂的話那一支照樣全綠。這裡是那條鏈的外部錨點：改尺寸要
 * 同時改這一張表，而那正是「改尺寸」該有的樣子。
 */
const EXPECTED: Record<PlantKind, { x: number; y: number; z: number }> = {
  hydroTower: { x: 8, y: 40, z: 8 },
  chimney: { x: 8, y: 100, z: 8 },
  boilerHouse: { x: 60, y: 18, z: 30 },
  oilTank: { x: 25, y: 12, z: 25 },
  gasHolder: { x: 40, y: 35, z: 40 },
  coolingTower: { x: 30, y: 40, z: 30 },
}

describe('油廠構件的尺寸錨點', () => {
  for (const [kind, want] of Object.entries(EXPECTED) as [PlantKind, { x: number; y: number; z: number }][]) {
    it(`${kind}：PLANT_SIZE、登記表的 real*、命中盒三者都等於寫死的尺寸`, () => {
      expect(PLANT_SIZE[kind]).toEqual(want)
      const unit = GROUND_UNITS.find((u) => u.id === kind)!
      expect(unit.realWidth).toBe(want.x)
      expect(unit.realHeight).toBe(want.y)
      expect(unit.realLength).toBe(want.z)
      const b = unit.hull[0]!
      expect(b.half.x * 2).toBeCloseTo(want.x, 6)
      expect(b.center.y + b.half.y).toBeCloseTo(want.y, 6)
      expect(b.half.z * 2).toBeCloseTo(want.z, 6)
    })
  }
})
