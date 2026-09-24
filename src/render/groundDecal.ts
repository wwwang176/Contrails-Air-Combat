import {
  BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial,
} from 'three'
import type { HeightSampler } from '../world/river'
import { insideRing, ringDistance } from '../world/landFeatures'

/**
 * # 鋪在地表上的一塊：村鎮的地面、露天礦
 *
 * 頂點各自取當地地形的高度加一點，顏色是頂點色。與河岸草甸同一個做法 ——
 * 閃爍靠材質的 `polygonOffset`，不靠抬高（投彈高度的深度解析度只剩公尺級，
 * 抬到不閃就看得出它浮在田上）。
 *
 * 【偏移比河弱】河岸草甸 −2／−4、水面 −4／−8。村鎮沿河的那一邊要讓河蓋過去。
 */

/** 高出地面多少，m */
const LIFT = 0.12

function material(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  })
}

function finish(pos: number[], col: number[], idx: number[], name: string): Mesh {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, material())
  mesh.name = name
  return mesh
}

export interface Disc {
  readonly x: number
  readonly z: number
  /** 方位 `theta`（atan2(dz, dx)）的半徑，m */
  readonly radiusAt: (theta: number) => number
  readonly color: number
}

/** 圓盤切幾圈、幾瓣。輪廓要夠圓，但幾百個村加起來不能太多頂點 */
const DISC_RINGS = 4
const DISC_SEGMENTS = 28

/**
 * 很多塊不規則的圓盤合成一顆網格。**切成同心圈**而不是只有一圈扇形 ——
 * 一塊 700 m 的鎮只有外圈頂點的話，中間那一大片不會跟著地形起伏。
 */
export function buildDiscs(sample: HeightSampler, discs: readonly Disc[], name: string): Mesh {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const d of discs) {
    c.setHex(d.color)
    const base = pos.length / 3
    pos.push(d.x, sample(d.x, d.z) + LIFT, d.z)
    col.push(c.r, c.g, c.b)
    for (let k = 1; k <= DISC_RINGS; k++) {
      for (let s = 0; s < DISC_SEGMENTS; s++) {
        const theta = (s / DISC_SEGMENTS) * Math.PI * 2
        const r = (d.radiusAt(theta) * k) / DISC_RINGS
        const x = d.x + Math.cos(theta) * r
        const z = d.z + Math.sin(theta) * r
        pos.push(x, sample(x, z) + LIFT, z)
        col.push(c.r, c.g, c.b)
      }
    }
    const ring = (k: number, s: number): number => base + 1 + (k - 1) * DISC_SEGMENTS + (s % DISC_SEGMENTS)
    // 【捲繞方向】「中心、下一瓣、這一瓣」的法線才朝上（測試逐一驗）。反了的話
    // 整塊被背面剔除，畫面上什麼都沒有
    for (let s = 0; s < DISC_SEGMENTS; s++) idx.push(base, ring(1, s + 1), ring(1, s))
    for (let k = 2; k <= DISC_RINGS; k++) {
      for (let s = 0; s < DISC_SEGMENTS; s++) {
        const a = ring(k - 1, s)
        const b = ring(k - 1, s + 1)
        const e = ring(k, s)
        const f = ring(k, s + 1)
        idx.push(a, b, e, b, f, e)
      }
    }
  }
  return finish(pos, col, idx, name)
}

/**
 * 一塊多邊形，照格子切：格心在多邊形內的格子才鋪。顏色由 `colorAt` 決定，
 * 它拿得到那一點離邊界多遠（露天礦的階梯就靠它）。
 *
 * 【邊緣是鋸齒】格子 `cell` 公尺，投彈高度看不出來；低空貼著看是一格一格的。
 */
export function buildPolygon(
  sample: HeightSampler, ring: readonly (readonly [number, number])[], cell: number,
  colorAt: (x: number, z: number, edge: number) => number, name: string,
): Mesh {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const [x, z] of ring) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  const nx = Math.ceil((x1 - x0) / cell)
  const nz = Math.ceil((z1 - z0) / cell)
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * cell
      const z = z0 + j * cell
      pos.push(x, sample(x, z) + LIFT, z)
      c.setHex(colorAt(x, z, insideRing(ring, x, z) ? ringDistance(ring, x, z) : 0))
      col.push(c.r, c.g, c.b)
    }
  }
  const v = (i: number, j: number): number => j * (nx + 1) + i
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!insideRing(ring, x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) continue
      // 【捲繞方向】(i,j)→(i,j+1)→(i+1,j) 的法線朝上（測試逐一驗）
      idx.push(v(i, j), v(i, j + 1), v(i + 1, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1))
    }
  }
  return finish(pos, col, idx, name)
}
