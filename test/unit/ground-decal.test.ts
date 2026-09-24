import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import { createHeightField } from '../../src/world/heightfield'
import { buildDecals, DECAL_LIFT } from '../../src/render/groundDecal'

/**
 * # 貼在地上的網格與地形共平面
 *
 * 洛伊納的鎮與礦坑幾乎都在平地上，那裡怎麼切都貼得上 —— 格線沒對齊地形格點
 * 在那張圖上量不出來。這裡用起伏的地形、兩種格數奇偶各量一次。
 */

/** 每一個三角形的重心與四分點減掉抬高量，與地形的最大差 */
function worstOff(size: number, grid: number): number {
  const f = createHeightField(size, 80)
  for (let i = 0; i < f.data.length; i++) f.data[i] = ((i * 7919) % 97) / 3
  const sample = (x: number, z: number): number => f.sample(x, z)
  const mesh = buildDecals(sample, [{
    x0: -700, z0: -600, x1: 650, z1: 720, inside: () => true, colorAt: () => 0x808080,
  }], 't', grid)
  const pos = mesh.geometry.getAttribute('position') as BufferAttribute
  const idx = mesh.geometry.getIndex()!
  let worst = 0
  for (let t = 0; t < idx.count; t += 3) {
    const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
    for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.25, 0.25], [0.25, 0.5, 0.25], [0.25, 0.25, 0.5]]) {
      let x = 0, y = 0, z = 0
      for (let k = 0; k < 3; k++) {
        x += pos.getX(v[k]!) * w[k]!
        y += pos.getY(v[k]!) * w[k]!
        z += pos.getZ(v[k]!) * w[k]!
      }
      worst = Math.max(worst, Math.abs(y - DECAL_LIFT - sample(x, z)))
    }
  }
  mesh.geometry.dispose()
  return worst
}

describe('buildDecals', () => {
  it.each([
    [40, 20], [41, 20], [40, 40], [41, 40],
  ])('地形 %i 格、細格 %i m：每一點都貼著地形', (size, grid) => {
    expect(worstOff(size, grid)).toBeLessThan(0.01)
  })

  /** 量尺本身：80 m 的格只對得齊其中一種奇偶，另一種會量到折線 */
  it('80 m 的格在其中一種奇偶上量得到下沉', () => {
    expect(Math.max(worstOff(40, 80), worstOff(41, 80))).toBeGreaterThan(0.5)
  })
})
