import { describe, expect, it } from 'vitest'
import { Box3, type BufferGeometry } from 'three'
import { fillBlock, keepouts, type Keepout } from '../../src/render/geometry/ground/plantFill'
import { PLANT_BLOCKS, PLANT_CENTER, PLANT_LAYOUT, ROADS, TRUCKS } from '../../src/world/leuna'
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

  /**
   * 【留白也有下限】只寫上限的話，`fillOpen` 整支改成 `return []` 仍然是
   * 綠的 —— 而那是「還沒做完」，不是「刻意的空地」。
   */
  it('open 街廓是留白：覆蓋率在 0.3% 到 8% 之間，而且真的有東西', () => {
    for (const { block: b, parts } of filled) {
      if (b.kind !== 'open') continue
      const c = coverage(parts, b)
      expect(c, `open (${b.x0},${b.z0}) 是空的`).toBeGreaterThan(0.003)
      expect(c, `open (${b.x0},${b.z0}) 太滿`).toBeLessThan(0.08)
      expect(parts.length, `open (${b.x0},${b.z0})`).toBeGreaterThanOrEqual(2)
    }
  })

  /**
   * 【佈景不能壓在禁區上】佈景沒有命中盒。疊上去會看到炸彈穿過管架在構件
   * 上爆，畫面上像是命中判定壞了。
   *
   * 【量三角形的包圍盒，不是頂點】一根橫貫的管子可以整段穿過命中盒而
   * 兩端的頂點都在盒外 —— 只驗頂點的話它是綠的。
   */
  it('避讓：沒有任何三角形與構件、卡車或道路的禁區相交', () => {
    const named: readonly { readonly what: string; readonly k: Keepout }[] = [
      ...PLANT_LAYOUT.map((t) => {
        const s = PLANT_SIZE[t.kind]
        return {
          what: `構件 ${t.kind}`,
          k: {
            x0: PLANT_CENTER.x + t.dx - s.x / 2 - 6, x1: PLANT_CENTER.x + t.dx + s.x / 2 + 6,
            z0: PLANT_CENTER.z + t.dz - s.z / 2 - 6, z1: PLANT_CENTER.z + t.dz + s.z / 2 + 6,
          },
        }
      }),
      ...TRUCKS.map((t) => ({
        what: `卡車 (${t.x},${t.z})`,
        k: { x0: t.x - 7, x1: t.x + 7, z0: t.z - 7, z1: t.z + 7 },
      })),
      ...ROADS.flatMap((road, ri) => road.slice(0, -1).map((a, si) => {
        const b = road[si + 1]!
        return {
          what: `道路 ${ri} 段 ${si}`,
          k: {
            x0: Math.min(a.x, b.x) - 8, x1: Math.max(a.x, b.x) + 8,
            z0: Math.min(a.z, b.z) - 8, z1: Math.max(a.z, b.z) + 8,
          },
        }
      })),
    ]
    let bad = ''
    for (const { parts } of filled) {
      for (const p of parts) {
        const pos = p.getAttribute('position')
        for (let t = 0; t < pos.count && bad === ''; t += 3) {
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
          for (const { what, k } of named) {
            if (bx > k.x0 + 0.01 && ax < k.x1 - 0.01 && bz > k.z0 + 0.01 && az < k.z1 - 0.01) {
              bad = `佈景壓在${what}上：三角形 (${ax.toFixed(1)}…${bx.toFixed(1)}, `
                + `${az.toFixed(1)}…${bz.toFixed(1)})`
              break
            }
          }
        }
      }
    }
    expect(bad).toBe('')
  })

  it('避讓表的每一個禁區都對得上一個構件、卡車或道路段', () => {
    const roadSegments = ROADS.reduce((n, r) => n + r.length - 1, 0)
    expect(keepouts().length).toBe(PLANT_LAYOUT.length + TRUCKS.length + roadSegments)
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

})
