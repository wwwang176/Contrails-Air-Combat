/** 以相同光柵解析度比較三角網格與命中盒的投影聯集面積。 */
import type { Vector3 } from 'three'
import type { HitBox } from '../../src/world/hit'

const CELL = 0.04

function raster(items: readonly number[][], ex: Vector3, ey: Vector3, cells: Set<number>): void {
  const K = 8192
  for (const t of items) {
    const px: number[] = [], py: number[] = []
    for (let i = 0; i < 3; i++) {
      const x = t[i * 3]!, y = t[i * 3 + 1]!, z = t[i * 3 + 2]!
      px.push(x * ex.x + y * ex.y + z * ex.z)
      py.push(x * ey.x + y * ey.y + z * ey.z)
    }
    const i0 = Math.floor(Math.min(...px) / CELL), i1 = Math.ceil(Math.max(...px) / CELL)
    const j0 = Math.floor(Math.min(...py) / CELL), j1 = Math.ceil(Math.max(...py) / CELL)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL
        const d1 = (cx - px[1]!) * (py[0]! - py[1]!) - (px[0]! - px[1]!) * (cy - py[1]!)
        const d2 = (cx - px[2]!) * (py[1]! - py[2]!) - (px[1]! - px[2]!) * (cy - py[2]!)
        const d3 = (cx - px[0]!) * (py[2]! - py[0]!) - (px[2]! - px[0]!) * (cy - py[0]!)
        if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue
        cells.add((i + K) * (2 * K) + (j + K))
      }
    }
  }
}

export function boxTris(b: HitBox): number[][] {
  const c = b.center, h = b.half
  const P = (s: readonly [number, number, number]): number[] =>
    [c.x + s[0] * h.x, c.y + s[1] * h.y, c.z + s[2] * h.z]
  const out: number[][] = []
  for (const ax of [0, 1, 2]) {
    for (const sg of [-1, 1]) {
      const q = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, v]) => {
        const s: [number, number, number] = [0, 0, 0]
        s[ax] = sg
        s[(ax + 1) % 3] = u
        s[(ax + 2) % 3] = v
        return s
      })
      out.push([...P(q[0]!), ...P(q[1]!), ...P(q[2]!)])
      out.push([...P(q[0]!), ...P(q[2]!), ...P(q[3]!)])
    }
  }
  return out
}

export function areaOf(items: readonly number[][], ex: Vector3, ey: Vector3): number {
  const cells = new Set<number>()
  raster(items, ex, ey, cells)
  return cells.size * CELL * CELL
}

