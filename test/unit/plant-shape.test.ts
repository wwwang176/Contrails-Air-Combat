import { describe, expect, it } from 'vitest'
import { PLANT_BUILDERS, PLANT_SIZE } from '../../src/render/geometry/ground/plant'
import { GROUND_UNITS } from '../../src/render/geometry/ground'

/**
 * 十二座可炸構件的外型。
 *
 * 【外型可以膨脹，盒子不行】命中盒與投彈難度已經凍結。這裡把兩件事分開驗：
 * 幾何要在 `PLANT_SIZE` 的腳印與高度之內，而 `PLANT_SIZE` 的值**獨立寫死
 * 在這個檔案裡** —— 由幾何反推的話，「幾何在盒內」就是恆真的。
 */
const EXPECTED = {
  hydroTower: { x: 8, y: 40, z: 8 },
  chimney: { x: 8, y: 100, z: 8 },
  boilerHouse: { x: 60, y: 18, z: 30 },
  oilTank: { x: 25, y: 12, z: 25 },
  gasHolder: { x: 40, y: 35, z: 40 },
  coolingTower: { x: 30, y: 40, z: 30 },
} as const

type Kind = keyof typeof EXPECTED

describe('廠區構件的外型', () => {
  it('PLANT_SIZE 沒有被動過', () => {
    expect(PLANT_SIZE).toEqual(EXPECTED)
  })

  it('每一種的幾何都在自己的腳印與高度之內，而且比一根光禿的柱子細緻', () => {
    for (const [kind, size] of Object.entries(EXPECTED)) {
      const g = PLANT_BUILDERS[kind as Kind]()
      g.computeBoundingBox()
      const b = g.boundingBox!
      expect(b.min.y, `${kind} 陷地`).toBeGreaterThanOrEqual(-0.01)
      expect(b.max.y, `${kind} 超高`).toBeLessThanOrEqual(size.y + 0.01)
      expect(b.max.x - b.min.x, `${kind} 超出腳印`).toBeLessThanOrEqual(size.x + 0.01)
      expect(b.max.z - b.min.z, `${kind} 超出腳印`).toBeLessThanOrEqual(size.z + 0.01)
      const tris = g.getAttribute('position').count / 3
      expect(tris, `${kind} 只有 ${tris} 個三角形`).toBeGreaterThanOrEqual(400)
      expect(tris, `${kind} 有 ${tris} 個三角形`).toBeLessThanOrEqual(900)
    }
  })

  /**
   * 【命中盒也要對著獨立的數字比】只驗 `PLANT_SIZE` 沒被動過還不夠 ——
   * `GROUND_UNITS` 的 `hull` 是另外一份資料，那裡的邊界改幾公分，投彈的
   * 難度就變了，而畫面上看不出來。
   */
  it('GROUND_UNITS 的命中盒就是這份腳印撐起來的', () => {
    for (const [kind, size] of Object.entries(EXPECTED)) {
      const u = GROUND_UNITS.find((g) => g.id === kind)
      expect(u, `${kind} 不在 GROUND_UNITS 裡`).toBeDefined()
      expect(u!.hull.length, kind).toBe(1)
      const { center, half } = u!.hull[0]!
      expect(center.x, `${kind} 盒心 X`).toBeCloseTo(0, 6)
      expect(center.y, `${kind} 盒心 Y`).toBeCloseTo(size.y / 2, 6)
      expect(center.z, `${kind} 盒心 Z`).toBeCloseTo(0, 6)
      expect(half.x, `${kind} 盒寬`).toBeCloseTo(size.x / 2, 6)
      expect(half.y, `${kind} 盒高`).toBeCloseTo(size.y / 2, 6)
      expect(half.z, `${kind} 盒深`).toBeCloseTo(size.z / 2, 6)
      expect(u!.realWidth, kind).toBeCloseTo(size.x, 6)
      expect(u!.realHeight, kind).toBeCloseTo(size.y, 6)
      expect(u!.realLength, kind).toBeCloseTo(size.z, 6)
    }
  })

  it('決定性：建兩次逐位元相同', () => {
    for (const kind of Object.keys(EXPECTED) as Kind[]) {
      const a = PLANT_BUILDERS[kind]().getAttribute('position').array as Float32Array
      const b = PLANT_BUILDERS[kind]().getAttribute('position').array as Float32Array
      expect(Array.from(b), kind).toEqual(Array.from(a))
    }
  })
})
