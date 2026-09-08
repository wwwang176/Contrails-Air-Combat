import { describe, expect, it } from 'vitest'
import { buildPlantScenery } from '../../src/render/geometry/ground/plantScenery'

/**
 * 廠區佈景的護欄：一顆幾何、三角形在預算內、底面不陷地、有頂點色。
 * 它是純佈景（沒有命中盒），所以守的只有「畫得出來、畫得起」。
 */
describe('廠區的佈景網格', () => {
  const g = buildPlantScenery()
  const pos = g.getAttribute('position')

  it('三角形在 15 萬以內、不是空的', () => {
    expect(g.index).toBeNull()
    const tris = pos.count / 3
    expect(tris).toBeGreaterThan(5_000)
    expect(tris).toBeLessThan(150_000)
  })

  it('沒有任何頂點在地面以下', () => {
    let minY = Infinity
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i))
    expect(minY).toBeGreaterThanOrEqual(-0.01)
  })

  it('有頂點色與法線', () => {
    expect(g.getAttribute('color')).toBeDefined()
    expect(g.getAttribute('normal')).toBeDefined()
  })

  it('決定性：建兩次逐位元相同', () => {
    const again = buildPlantScenery().getAttribute('position')
    expect(again.count).toBe(pos.count)
    expect(Array.from(again.array as Float32Array).slice(0, 3000))
      .toEqual(Array.from(pos.array as Float32Array).slice(0, 3000))
  })
})
