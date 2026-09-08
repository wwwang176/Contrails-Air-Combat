import { describe, expect, it } from 'vitest'
import { Box3, type BufferGeometry } from 'three'
import { fillBlock, keepouts } from '../../src/render/geometry/ground/plantFill'
import { PLANT_BLOCKS, PLANT_CENTER, PLANT_LAYOUT } from '../../src/world/leuna'
import { PLANT_SIZE } from '../../src/render/geometry/ground/plant'

function bounds(parts: BufferGeometry[]): Box3 {
  const b = new Box3()
  for (const p of parts) {
    p.computeBoundingBox()
    b.union(p.boundingBox!)
  }
  return b
}

/**
 * 10 m 格塗格，回覆蓋率。三角形的 XZ 包圍盒塗格 —— **高估法**：斜的長條
 * 會塗滿它的整個包圍盒。高估法都過不了門檻的話，實際只會更空。
 */
function coverage(
  parts: BufferGeometry[], b: { x0: number; z0: number; x1: number; z1: number },
): number {
  const CELL = 10
  const nx = Math.max(1, Math.round((b.x1 - b.x0) / CELL))
  const nz = Math.max(1, Math.round((b.z1 - b.z0) / CELL))
  const grid = new Uint8Array(nx * nz)
  for (const p of parts) {
    const pos = p.getAttribute('position')
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
      const i0 = Math.max(0, Math.floor((ax - b.x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((bx - b.x0) / CELL))
      const j0 = Math.max(0, Math.floor((az - b.z0) / CELL))
      const j1 = Math.min(nz - 1, Math.floor((bz - b.z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
    }
  }
  let on = 0
  for (const v of grid) on += v
  return on / grid.length
}

describe('街廓填充器', () => {
  const blocked = keepouts()
  const filled = PLANT_BLOCKS.map((b) => ({ block: b, parts: fillBlock(b, blocked) }))

  it('鋪出來的東西不出街廓、不陷地', () => {
    for (const { block: b, parts } of filled) {
      if (parts.length === 0) continue
      const bb = bounds(parts)
      expect(bb.min.x, `${b.kind} 越西界`).toBeGreaterThanOrEqual(b.x0 - 0.01)
      expect(bb.max.x, `${b.kind} 越東界`).toBeLessThanOrEqual(b.x1 + 0.01)
      expect(bb.min.z, `${b.kind} 越北界`).toBeGreaterThanOrEqual(b.z0 - 0.01)
      expect(bb.max.z, `${b.kind} 越南界`).toBeLessThanOrEqual(b.z1 + 0.01)
      expect(bb.min.y, `${b.kind} 陷地`).toBeGreaterThanOrEqual(-0.01)
    }
  })

  /**
   * 【要逐街廓量，不能只量整片】只量整片的話，把一個填充器整支停掉，
   * 其他五個補得回來，護欄仍是綠的。
   */
  it('每一個非 open 街廓的覆蓋率至少 25%', () => {
    for (const { block: b, parts } of filled) {
      if (b.kind === 'open') continue
      const c = coverage(parts, b)
      expect(c, `${b.kind} (${b.x0},${b.z0}) 只有 ${(c * 100).toFixed(1)}%`)
        .toBeGreaterThanOrEqual(0.25)
    }
  })

  it('open 街廓是留白：覆蓋率低於 8%', () => {
    for (const { block: b, parts } of filled) {
      if (b.kind !== 'open') continue
      expect(coverage(parts, b), `open (${b.x0},${b.z0})`).toBeLessThan(0.08)
    }
  })

  /**
   * 【佈景不能壓在可炸構件上】佈景沒有命中盒。疊上去會看到炸彈穿過管架
   * 在構件上爆，畫面上像是命中判定壞了。
   */
  it('避讓：沒有任何頂點落在可炸構件的腳印加 6 m 之內', () => {
    let bad = ''
    for (const { parts } of filled) {
      for (const p of parts) {
        const pos = p.getAttribute('position')
        for (let i = 0; i < pos.count && bad === ''; i++) {
          const x = pos.getX(i)
          const z = pos.getZ(i)
          for (const t of PLANT_LAYOUT) {
            const s = PLANT_SIZE[t.kind]
            const cx = PLANT_CENTER.x + t.dx
            const cz = PLANT_CENTER.z + t.dz
            if (Math.abs(x - cx) < s.x / 2 + 6 && Math.abs(z - cz) < s.z / 2 + 6) {
              bad = `佈景壓在 ${t.kind} 上：(${x.toFixed(1)}, ${z.toFixed(1)})`
              break
            }
          }
        }
      }
    }
    expect(bad).toBe('')
  })

  it('決定性：同一個街廓鋪兩次逐位元相同', () => {
    const b = PLANT_BLOCKS.find((k) => k.kind === 'tankFarm')!
    const a1 = fillBlock(b, blocked)
    const a2 = fillBlock(b, blocked)
    expect(a2.length).toBe(a1.length)
    for (let i = 0; i < a1.length; i++) {
      expect(Array.from(a2[i]!.getAttribute('position').array as Float32Array))
        .toEqual(Array.from(a1[i]!.getAttribute('position').array as Float32Array))
    }
  })

  it('避讓表涵蓋十二座構件、八台卡車與每一條道路', () => {
    expect(keepouts().length).toBeGreaterThanOrEqual(12 + 8 + 5)
  })
})
