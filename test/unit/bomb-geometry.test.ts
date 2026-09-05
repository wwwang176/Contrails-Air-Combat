import { describe, it, expect } from 'vitest'
import {
  BOMB_BODY_RADIUS, BOMB_LENGTH, createBombGeometry,
} from '../../src/render/bombs'

const geo = createBombGeometry()
const pos = geo.getAttribute('position')

/** 所有頂點，[半徑, 軸向] */
const V: [number, number][] = []
for (let i = 0; i < pos.count; i++) {
  V.push([Math.hypot(pos.getX(i), pos.getZ(i)), pos.getY(i)])
}

const NOSE = -BOMB_LENGTH / 2
const TAIL = BOMB_LENGTH / 2

describe('炸彈的幾何', () => {
  it('軸向長度就是 BOMB_LENGTH，而且以原點為中心', () => {
    const ys = V.map(([, y]) => y)
    expect(Math.min(...ys)).toBeCloseTo(NOSE, 6)
    expect(Math.max(...ys)).toBeCloseTo(TAIL, 6)
  })

  it('尖端在 −Y、尾在 +Y —— `setFromUnitVectors(TAIL, DIR)` 靠這條', () => {
    // 【壞了不會有錯誤】反過來的話炸彈倒著飛，而尾翼在前看起來一樣「有姿態」
    const noseR = Math.max(...V.filter(([, y]) => y < NOSE + 0.02).map(([r]) => r))
    const tailR = Math.max(...V.filter(([, y]) => y > TAIL - 0.02).map(([r]) => r))
    expect(noseR).toBeLessThan(0.05)
    expect(tailR).toBeGreaterThan(0.1)
  })

  it('最粗的一圈是彈體，而且在前半段', () => {
    let widest = 0
    let widestY = 0
    for (const [r, y] of V) {
      if (r > widest) { widest = r; widestY = y }
    }
    expect(widest).toBeCloseTo(BOMB_BODY_RADIUS, 6)
    expect(widestY).toBeLessThan(0)
  })

  it('尾翼不比彈體寬 —— 掛在彈艙裡的東西不會比自己的腰粗', () => {
    const fins = V.filter(([, y]) => y > 0.3)
    expect(Math.max(...fins.map(([r]) => r))).toBeLessThanOrEqual(BOMB_BODY_RADIUS + 1e-6)
  })

  it('是 lowpoly —— 三角形不超過 130 個', () => {
    const index = geo.getIndex()
    const tris = (index === null ? pos.count : index.count) / 3
    expect(tris).toBeLessThanOrEqual(130)
    // 【下界也要守】掉到剩幾個面就代表輪廓被寫壞了，而遠看仍是一個深灰的點
    expect(tris).toBeGreaterThan(60)
  })

  it('有法線 —— MeshLambertMaterial 少了它整批全黑', () => {
    expect(geo.getAttribute('normal')).toBeDefined()
  })
})
