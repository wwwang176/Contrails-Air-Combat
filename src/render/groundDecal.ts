import {
  BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial,
} from 'three'
import type { HeightSampler } from '../world/river'

/**
 * # 鋪在地表上的一塊：村鎮的地面、露天礦
 *
 * 顏色是頂點色；閃爍靠材質的 `polygonOffset`，不靠抬高（投彈高度的深度解析度
 * 只剩公尺級，抬到不閃就看得出它浮在田上）。
 *
 * 【每一個三角形都落在同一個地形三角形上】地形一格 80 m、切成兩個平面三角形，
 * 對角線是 `tx + tz = 1`（`world/heightfield.ts` 的 `sample`）。這裡用對齊地形
 * 格線的 `DECAL_GRID` 細格、同一個方向的對角線，所以每一個小三角形都完全落在
 * 某一個地形三角形裡 —— 三個頂點取地形高度，整片就與地面共平面。自己切一套
 * 不對齊的網格的話，三角形跨過地形的折線，中間會沉到地面下（實測最多 1.4 m），
 * 低空看得到底下的田。
 *
 * 【偏移比河弱】河岸草甸 −2／−4、水面 −4／−8。村鎮沿河的那一邊要讓河蓋過去。
 */

/**
 * 細格：邊長與格線的起點，m。**格線要落在地形的格點上** —— 地形格點在
 * `(i − (size−1)/2) × cell`，格數的奇偶決定落在 0 還是 40 (mod 80)。
 */
export interface DecalGrid {
  readonly size: number
  readonly origin: number
}

/** 預設的細格：20 m。40 的因數兩種奇偶都對得齊，起點不必管 */
export const DECAL_GRID = 20
const FINE: DecalGrid = { size: DECAL_GRID, origin: 0 }

/**
 * 與這張地形同格距的粗格：格線照格點的奇偶對齊。遠處用 —— 一格就是一個地形
 * 格，頂點數是細格的 1/16
 */
export function terrainGrid(field: { readonly size: number; readonly cell: number }): DecalGrid {
  const o = (-(field.size - 1) / 2) * field.cell
  return { size: field.cell, origin: ((o % field.cell) + field.cell) % field.cell }
}
/** 高出地面多少，m。整片平移，不影響共平面 */
export const DECAL_LIFT = 0.12

function material(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  })
}

/** 一塊要鋪的範圍：外接盒、哪些細格要鋪、每個頂點的顏色 */
export interface DecalRegion {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
  /** 細格中心在範圍內嗎 */
  readonly inside: (x: number, z: number) => boolean
  readonly colorAt: (x: number, z: number) => number
}

/**
 * 很多塊合成一顆網格。每一塊各自一張細格，只鋪中心在範圍內的格子。
 *
 * 【邊緣是格子的鋸齒】20 m 在投彈高度看不出來；低空貼著看是一格一格的。
 */
export function buildDecals(
  sample: HeightSampler, regions: readonly DecalRegion[], name: string, g: DecalGrid = FINE,
): Mesh {
  const grid = g.size
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const r of regions) {
    const gx0 = Math.floor((r.x0 - g.origin) / grid) * grid + g.origin
    const gz0 = Math.floor((r.z0 - g.origin) / grid) * grid + g.origin
    const nx = Math.ceil((r.x1 - gx0) / grid)
    const nz = Math.ceil((r.z1 - gz0) / grid)
    // 【頂點只建用得到的】一塊的外接盒裡大半是空的；先標格子，再照需要編號
    const used = new Uint8Array(nx * nz)
    let any = false
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (r.inside(gx0 + (i + 0.5) * grid, gz0 + (j + 0.5) * grid)) {
          used[j * nx + i] = 1
          any = true
        }
      }
    }
    if (!any) continue
    const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1)
    const vertex = (i: number, j: number): number => {
      const k = j * (nx + 1) + i
      if (vid[k]! >= 0) return vid[k]!
      const x = gx0 + i * grid
      const z = gz0 + j * grid
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      c.setHex(r.colorAt(x, z))
      col.push(c.r, c.g, c.b)
      vid[k] = pos.length / 3 - 1
      return vid[k]!
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (used[j * nx + i] === 0) continue
        const a = vertex(i, j)
        const b = vertex(i + 1, j)
        const cc = vertex(i, j + 1)
        const d = vertex(i + 1, j + 1)
        // 【對角線是 b–c，與地形相同】a 左上、b 右上、c 左下、d 右下。這個次序的
        // 法線也朝上（測試逐一驗）
        idx.push(a, cc, b, b, cc, d)
      }
    }
  }
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
