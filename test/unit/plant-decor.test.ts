import { describe, expect, it } from 'vitest'
import { buildDecor, DECOR_DEFAULT, type DecorKind } from '../../src/render/geometry/ground/plantDecor'

describe('佈景建築的幾何', () => {
  const kinds = Object.keys(DECOR_DEFAULT) as DecorKind[]

  it('底面在 y = 0、腳印不超出給的寬與長（擺上地形時才不浮空、不壓到隔壁）', () => {
    for (const k of kinds) {
      const g = buildDecor(k, 20, 40, 10)
      g.computeBoundingBox()
      const b = g.boundingBox!
      expect(b.min.y, k).toBeGreaterThanOrEqual(-0.01)
      expect(b.min.y, k).toBeLessThan(0.5)
      // 屋簷、窗帶、管子可以凸出一點
      expect(b.max.x - b.min.x, k).toBeLessThan(20 + 2)
      expect(b.max.z - b.min.z, k).toBeLessThan(40 + 2)
      g.dispose()
    }
  })

  it('帶頂點色 —— 合併之後靠它上色，少了整批會變成材質的單一顏色', () => {
    for (const k of kinds) {
      const g = buildDecor(k)
      expect(g.getAttribute('color'), k).toBeDefined()
      g.dispose()
    }
  })
})
