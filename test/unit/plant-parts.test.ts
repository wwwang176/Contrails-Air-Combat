import { describe, expect, it } from 'vitest'
import { Box3, type BufferGeometry } from 'three'
import {
  bundWall, fanStack, grime, horizTank, pipeBridge, PLANT_PALETTE, railCar, railTrack,
  sawtoothHall, sphereTank, trussTower, uprightTank,
} from '../../src/render/geometry/ground/plantParts'

/**
 * 廠區的中階零件。`parts.ts` 是載具用的低階原語（盒子與圓柱），這裡是由
 * 它們堆出來的廠房、槽、塔、軌道。
 *
 * 【三角形數是精確比對，不是上限】它是 40 萬預算的分母。零件悄悄變胖的話
 * 密度就得跟著砍，而砍下去沒有人會發現。
 */
function bounds(parts: BufferGeometry[]): Box3 {
  const b = new Box3()
  for (const p of parts) {
    p.computeBoundingBox()
    b.union(p.boundingBox!)
  }
  return b
}

function triangles(parts: BufferGeometry[]): number {
  let n = 0
  for (const p of parts) n += p.getAttribute('position').count / 3
  return n
}

describe('廠區零件', () => {
  it('每一種零件都貼地、有頂點色、三角形數在標稱值', () => {
    const cases: readonly { name: string; parts: BufferGeometry[]; tris: number }[] = [
      { name: 'trussTower', parts: trussTower(0, 0, 20, 4, 1), tris: 276 },
      { name: 'uprightTank', parts: uprightTank(0, 0, 12, 14, 2), tris: 64 },
      { name: 'horizTank', parts: horizTank(0, 0, 3, 20, 0, 3), tris: 56 },
      { name: 'sphereTank', parts: sphereTank(0, 0, 8, 4), tris: 64 },
      { name: 'fanStack', parts: fanStack(0, 0, 5, 8, 5), tris: 44 },
      { name: 'sawtoothHall', parts: sawtoothHall(0, 0, 60, 30, 10, 4, 0, 6), tris: 108 },
      { name: 'railCar', parts: railCar(0, 0, 0, true, 7), tris: 48 },
      { name: 'railTrack', parts: railTrack(0, 0, 0, 300), tris: 12 },
      { name: 'bundWall', parts: bundWall(-100, -60, 100, 60, 4), tris: 48 },
    ]
    for (const c of cases) {
      expect(c.parts.length, c.name).toBeGreaterThan(0)
      const b = bounds(c.parts)
      expect(b.min.y, `${c.name} 陷地`).toBeGreaterThanOrEqual(-0.001)
      for (const p of c.parts) expect(p.getAttribute('color'), c.name).toBeDefined()
      expect(triangles(c.parts), `${c.name} 的三角形數變了`).toBe(c.tris)
    }
  })

  it('立式槽的外廓等於給的半徑與高度', () => {
    const b = bounds(uprightTank(100, -50, 12, 14, 2))
    expect(b.min.x).toBeCloseTo(88, 3)
    expect(b.max.x).toBeCloseTo(112, 3)
    expect(b.max.y).toBeCloseTo(14, 3)
    expect(b.min.z).toBeCloseTo(-62, 3)
  })

  it('管線橋的管子橫跨兩端，架高等於給的高度', () => {
    const b = bounds(pipeBridge(0, 0, 200, 0, 8, 4, 11))
    expect(b.min.x).toBeLessThanOrEqual(1)
    expect(b.max.x).toBeGreaterThanOrEqual(199)
    expect(b.max.y).toBeGreaterThan(8)
    expect(b.min.y).toBeGreaterThanOrEqual(-0.001)
  })

  it('環形土堤圍住給的矩形，四邊都在', () => {
    const b = bounds(bundWall(-100, -60, 100, 60, 4))
    expect(b.min.x).toBeCloseTo(-102, 1)
    expect(b.max.x).toBeCloseTo(102, 1)
    expect(b.min.z).toBeCloseTo(-62, 1)
    expect(b.max.z).toBeCloseTo(62, 1)
    expect(b.max.y).toBeCloseTo(4, 3)
  })

  it('軌道貼在地面上，長度等於兩端的距離', () => {
    const b = bounds(railTrack(0, 0, 0, 300))
    expect(b.max.y).toBeLessThan(0.6)
    expect(b.max.z - b.min.z).toBeCloseTo(300, 0)
  })

  /**
   * 【轉了要留在腳印裡】斜屋頂板轉完會伸出去，而街廓的邊界護欄量的是
   * 包圍盒 —— 伸出去的那一版在填充器裡才會紅，離現場很遠。
   */
  it('鋸齒廠房轉了 90° 之後仍在自己的腳印內', () => {
    const b = bounds(sawtoothHall(0, 0, 60, 30, 10, 4, 90, 6))
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(30.5)
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(60.5)
  })

  /**
   * 【色盤要抖明度】同一排二十個槽全是同一個灰的話，俯視是一片死板的
   * 圓點陣。抖動由序號決定，所以是決定性的。
   */
  it('grime：同序號同色、相鄰序號不同色、色數夠多', () => {
    expect(grime(5)).toBe(grime(5))
    expect(grime(5)).not.toBe(grime(6))
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(grime(i))
    expect(seen.size).toBeGreaterThan(20)
    expect(PLANT_PALETTE.length).toBe(5)
  })
})
