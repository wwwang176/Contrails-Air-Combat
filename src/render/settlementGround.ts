import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from 'three'
import { insideSettlement, settlementRadius, type Place } from '../world/landFeatures'
import type { HeightSampler } from '../world/river'
import { buildDecals, DECAL_LIFT, type DecalGrid, type DecalRegion } from './groundDecal'
import { MEADOW } from './river'
import type { GreenPatch } from './settlements'
import type { Street } from './townPlan'

/** 將聚落輪廓與配置好的綠地、街道建成地面網格；配置與避讓查詢各自獨立。 */

/**
 * 鎮的地面顏色。**取晚秋田色盤裡的色**（`season.ts` 的犁田）—— 自己調一個灰的
 * 話，從空中看是田裡貼了一塊淺色補丁。鎮要靠房子認出來。
 */
const TOWN_GROUND = 0x585046

/** 街面：石板路與柏油，比鎮的地面暗一截 */
const STREET_COLOR = 0x34322e

/** 公園、墓園、小菜園的地面：河灘草甸的枯草色（`river.ts` 的 `MEADOW`） */
const PARK_GROUND = MEADOW

/**
 * 鎮的地面。**村不鋪** —— 農莊只沿著巷子與綠地排，輪廓裡大半是院子後面的田與
 * 花園；鋪滿的話是一大片沒有田紋的平地。
 */
export function buildSettlementGround(
  sample: HeightSampler, places: readonly Place[], grid?: DecalGrid, name = 'settlementGround',
): Mesh {
  const regions: DecalRegion[] = places
    .filter((p) => p.kind === 'town')
    .map((p) => {
      // 輪廓的起伏最多 +22%（`outlineScale`），外接盒放 1.25 倍
      const r = settlementRadius(p) * 1.25
      return {
        x0: p.x - r, z0: p.z - r, x1: p.x + r, z1: p.z + r,
        inside: (x, z) => insideSettlement(p, x, z),
        colorAt: () => TOWN_GROUND,
      }
    })
  return buildDecals(sample, regions, name, grid)
}

/**
 * 公園、墓園、小菜園的草地：每一塊一個多邊形（從中心扇形切三角形），頂點取
 * 地形高度再抬 `DECAL_LIFT`。
 *
 * 【不用鎮地面的頂點色】那是 20 m 一格、三角形裡內插的 —— 草色會漸變到框外一格，
 * 跨過窄街染到隔壁的街廓。多邊形跟著街廓的邊走，烘進貼圖時邊是準的。
 *
 * 【不與地形共平面】多邊形的邊不在地形的格線上，坡地上中間會沉一點。平常整顆
 * 烘進田色貼圖（`terrain.ts`），只在旁路時畫
 */
export function buildGreens(sample: HeightSampler, greens: readonly GreenPatch[]): Mesh {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color(PARK_GROUND)
  for (const g of greens) {
    const base = pos.length / 3
    pos.push(g.x, sample(g.x, g.z) + DECAL_LIFT, g.z)
    col.push(c.r, c.g, c.b)
    for (const [x, z] of g.ring) {
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      col.push(c.r, c.g, c.b)
    }
    const n = g.ring.length
    for (let i = 0; i < n; i++) {
      const a = base + 1 + i
      const b = base + 1 + ((i + 1) % n)
      // 【捲繞朝上】多邊形繞的方向隨街廓而定，逐片對
      const ux = pos[a * 3]! - g.x
      const uz = pos[a * 3 + 2]! - g.z
      const vx = pos[b * 3]! - g.x
      const vz = pos[b * 3 + 2]! - g.z
      if (uz * vx - ux * vz > 0) idx.push(base, a, b)
      else idx.push(base, b, a)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }))
  mesh.name = 'greens'
  return mesh
}

/**
 * 鎮上的街：每一段一條貼著地面的帶子，頂點取地形高度再抬 `DECAL_LIFT`。
 *
 * 【偏移與高速公路同級】要蓋過鎮的地面（−1／−2）與河灘草甸（−2／−4）—— 沿河的
 * 鎮一半在草甸上。水面（−4／−8）仍蓋過它；高速公路上的那一段已經斷開
 * （`streetEdge`）。
 */
export function buildStreets(sample: HeightSampler, streets: readonly Street[]): Mesh {
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
    // 【捲繞方向】與高速公路同一個排法：左在 2i、右在 2i+1，「左、下一個左、右」朝上
    for (let i = 0; i + 1 < n; i++) {
      const k = base + i * 2
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }))
  mesh.name = 'streets'
  return mesh
}
