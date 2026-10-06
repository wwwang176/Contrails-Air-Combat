import { BufferAttribute, BufferGeometry, Color } from 'three'
import { DECAL_LIFT } from './groundDecal'
import type { HeightSampler } from '../world/riverTypes'
import type { Blast, GardenStrip, StreetRibbon } from './steppeVillage'

/** 支路的顏色：被踩實的雪，與凹路同色（`season.ts` 的 `track`） */
const STREET_COLOR = 0x8a8d90

/**
 * 菜園的網格：每一條一個四邊形，頂點取地形高度再抬 `DECAL_LIFT`，帶自己的顏色。
 * 平常整顆烘進田色貼圖（`terrain.ts` 的 `addOverlay`）。
 */
export function buildGardens(sample: HeightSampler, gardens: readonly GardenStrip[]): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const g of gardens) {
    const base = pos.length / 3
    c.setHex(g.color)
    for (const [x, z] of g.ring) {
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      col.push(c.r, c.g, c.b)
    }
    // 【捲繞朝上】四個角的繞行方向隨菜園的朝向而定，逐片對
    const a = g.ring[0]!
    const b = g.ring[1]!
    const d = g.ring[2]!
    const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])
    if (cross > 0) idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return finish(pos, col, idx)
}

/**
 * 支路的網格：每一條折線一條帶子（左右各取地形高度再抬 `DECAL_LIFT`）。畫在菜園之後。
 */
export function buildStreets(sample: HeightSampler, streets: readonly StreetRibbon[]): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color(STREET_COLOR)
  for (const s of streets) {
    const pts = s.points
    const n = pts.length
    const base = pos.length / 3
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)]!
      const b = pts[Math.min(n - 1, i + 1)]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      // 往左的單位法線
      const nx = -(b[1] - a[1]) / len
      const nz = (b[0] - a[0]) / len
      const [x, z] = pts[i]!
      for (const side of [1, -1]) {
        const vx = x + nx * s.half * side
        const vz = z + nz * s.half * side
        pos.push(vx, sample(vx, vz) + DECAL_LIFT, vz)
        col.push(c.r, c.g, c.b)
      }
    }
    // 【捲繞方向】左在 2i、右在 2i+1，「左、下一個左、右」朝上
    for (let i = 0; i + 1 < n; i++) {
      const k = base + i * 2
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  return finish(pos, col, idx)
}

/**
 * 燒毀房子底下的彈坑貼片：每一個一個四邊形，帶 `uv`，取圖集的一格（4 × 4，列優先、左上為
 * 0）。四邊形的 uv 往格子裡縮一點，避免雙線性取樣混進隔壁格。烘圖時走貼圖版的 overlay
 * （`fieldClipmap.ts` 的 `addOverlay(…, true, true)`）。
 */
export function buildBlasts(sample: HeightSampler, blasts: readonly Blast[]): BufferGeometry {
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  const IN = 0.004
  for (const b of blasts) {
    const base = pos.length / 3
    const c = Math.cos(b.rot)
    const s = Math.sin(b.rot)
    const u0 = (b.cell % 4) / 4
    const v0 = Math.floor(b.cell / 4) / 4
    // 四個角：(−,−) (+,−) (+,+) (−,+)；圖集的 y 朝上（`uv` 的 v 與列相反）
    const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    for (const [a, d] of corners) {
      const x = b.x + (a * c - d * s) * b.half
      const z = b.z + (a * s + d * c) * b.half
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      uvs.push(u0 + (a < 0 ? IN : 0.25 - IN), 1 - (v0 + (d < 0 ? IN : 0.25 - IN)))
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  return geo
}

function finish(pos: number[], col: number[], idx: number[]): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
