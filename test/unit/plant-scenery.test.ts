import { describe, expect, it } from 'vitest'
import { buildPlantScenery } from '../../src/render/geometry/ground/plantScenery'
import { PLANT_CENTER, PLANT_LAYOUT, PLANT_PAD } from '../../src/world/leuna'
import { PLANT_SIZE } from '../../src/render/geometry/ground/plant'

/**
 * 廠區佈景的護欄：一顆幾何、三角形在預算內、底面不陷地、有頂點色。
 * 它是純佈景（沒有命中盒），所以守的只有「畫得出來、畫得起」。
 */
describe('廠區的佈景網格', () => {
  const g = buildPlantScenery()
  const pos = g.getAttribute('position')

  /**
   * 【下限與上限都要】只有上限的話，密度縮水沒有人會發現 —— 而縮水的樣子
   * 就是這一輪要治的那塊空水泥板。
   */
  it('三角形在 15 萬到 40 萬之間', () => {
    expect(g.index).toBeNull()
    const tris = pos.count / 3
    expect(tris).toBeGreaterThanOrEqual(150_000)
    expect(tris).toBeLessThanOrEqual(400_000)
  })

  /**
   * 【俯視覆蓋率】這一關的視距重心是投彈高度的俯視，而「填滿」是可以量的：
   * 把每個三角形的 XZ 包圍盒塗進 10 m 格。**包圍盒是高估** —— 高估法都
   * 過不了門檻的話，實際只會更空。
   *
   * 十二座可炸構件的腳印也算進來：玩家看到的是整片廠區，不分佈景與目標。
   */
  it('墊面的俯視覆蓋率至少 35%', () => {
    const CELL = 10
    const x0 = PLANT_CENTER.x - PLANT_PAD.halfX
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ
    const nx = Math.round((PLANT_PAD.halfX * 2) / CELL)
    const nz = Math.round((PLANT_PAD.halfZ * 2) / CELL)
    const grid = new Uint8Array(nx * nz)
    for (const t of PLANT_LAYOUT) {
      const s = PLANT_SIZE[t.kind]
      const cx = PLANT_CENTER.x + t.dx
      const cz = PLANT_CENTER.z + t.dz
      const i0 = Math.max(0, Math.floor((cx - s.x / 2 - x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((cx + s.x / 2 - x0) / CELL))
      const j0 = Math.max(0, Math.floor((cz - s.z / 2 - z0) / CELL))
      const j1 = Math.min(nz - 1, Math.floor((cz + s.z / 2 - z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
    }
    for (let t = 0; t < pos.count; t += 3) {
      let ax = Infinity
      let az = Infinity
      let bx = -Infinity
      let bz = -Infinity
      for (let k = 0; k < 3; k++) {
        const X = pos.getX(t + k)
        const Z = pos.getZ(t + k)
        ax = Math.min(ax, X); bx = Math.max(bx, X)
        az = Math.min(az, Z); bz = Math.max(bz, Z)
      }
      const i0 = Math.max(0, Math.floor((ax - x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((bx - x0) / CELL))
      const j0 = Math.max(0, Math.floor((az - z0) / CELL))
      const j1 = Math.min(nz - 1, Math.floor((bz - z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
    }
    let on = 0
    for (const v of grid) on += v
    const ratio = on / grid.length
    expect(ratio, `覆蓋率只有 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.35)
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

  /**
   * 【要比整份，不能只比開頭】三十幾萬個三角形裡，前三千個浮點數只蓋到
   * 最前面一兩個街廓 —— 後面任何一個填充器用了 `Math.random`，開頭那一段
   * 仍然一模一樣。
   */
  it('決定性：建兩次逐位元相同', () => {
    const digest = (a: Float32Array): string => {
      let h = 0x811c9dc5
      for (let i = 0; i < a.length; i++) {
        h = (h ^ ((a[i]! * 1e4) | 0)) >>> 0
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h.toString(16)
    }
    const again = buildPlantScenery().getAttribute('position')
    expect(again.count).toBe(pos.count)
    expect(digest(again.array as Float32Array)).toBe(digest(pos.array as Float32Array))
  })
})
