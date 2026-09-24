import { FloraKind, pushFlora, type FloraSource } from './flora'
import { TILE_SIZE } from './vegetation'
import { buildDecals, type DecalRegion } from './groundDecal'
import {
  insideSettlement, nameHash, settlementRadius, type Place,
} from '../world/landFeatures'
import type { HeightSampler } from '../world/river'
import type { Mesh } from 'three'

/**
 * # 真實的村鎮：房子、教堂、鎮區的地面
 *
 * 位置與大小照 OSM 的聚落（`world/landFeatures.ts` 的 `settlementRadius`）。
 * 房子沿一張轉過角度的街道格線排：每一個街廓四邊各排幾棟、山牆對著街。
 * 越往外圍越疏，外圈的輪廓不是正圓（`outlineScale`）。
 *
 * 【位置只由聚落與格線索引決定】與農地的散佈器同一條鐵律 —— 跟著「現在畫
 * 到哪一格」變的話，同一棟房子在相鄰兩格會長在兩個地方。
 */

type Kind = Place['kind']

/** 街廓邊長，m */
const BLOCK: Record<Kind, number> = { town: 58, village: 48, hamlet: 40 }
/** 一邊排幾棟 */
const PER_SIDE: Record<Kind, number> = { town: 3, village: 2, hamlet: 2 }
/** 房子離街心，m */
const SETBACK = 9
/** 街廓的填滿率：聚落中心 → 外緣 */
const FILL: Record<Kind, readonly [number, number]> = {
  town: [0.95, 0.55], village: [0.85, 0.45], hamlet: [0.7, 0.5],
}
/** 穀倉的比例。鎮上幾乎沒有 */
const BARN: Record<Kind, number> = { town: 0.05, village: 0.3, hamlet: 0.45 }
/**
 * 石板瓦屋頂的比例：聚落中心 → 外緣。鎮中心是公家建築與大戶人家，石板多；
 * 村裡少。整張圖平均約一成五，其餘是黏土瓦（`floraShapes.ts` 的 `ROOF`）
 */
const SLATE: Record<Kind, readonly [number, number]> = {
  town: [0.35, 0.14], village: [0.1, 0.06], hamlet: [0.05, 0.05],
}
/** 穀倉裡油毛氈屋頂的比例 */
const TAR_BARN = 0.2
/** 房子的縮放範圍。鎮上的是兩三層的街屋，比村裡的大 */
const SCALE: Record<Kind, readonly [number, number]> = {
  town: [1.0, 1.35], village: [0.85, 1.15], hamlet: [0.85, 1.1],
}
/** 村有教堂的機率。鎮一定有 */
const VILLAGE_CHURCH = 0.75
/** 人口超過這個數的鎮，教堂是大教堂（梅澤堡、魏森費爾斯、瑙姆堡） */
const CATHEDRAL_POP = 30000
/**
 * 教堂與房子在縮放 1 時的外接半徑，m。教堂本堂 10 × 19 加塔、房子 12 × 9
 * （`floraShapes.ts`），房子最大放大 1.35 倍
 */
const CHURCH_REACH = 13
const HOUSE_REACH = 10

/**
 * 地面的顏色。**取晚秋田色盤裡的色**（`season.ts`：犁田 `0x585046`、作物
 * `0x615848`…）—— 自己調一個灰的話，從空中看是田裡貼了一塊淺色補丁。聚落要
 * 靠房子認出來，地面只負責不讓房子之間露出犁溝與樹籬。
 */
const TOWN_GROUND = 0x585046
const VILLAGE_GROUND = 0x5d5547

export interface Building {
  readonly x: number
  readonly z: number
  readonly rot: number
  readonly scale: number
  /** 顏色的變化量，0～1 */
  readonly tint: number
  readonly kind: FloraKind
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * 一個聚落的全部建築。`avoid(x, z)` 為真的位置不蓋（河道、高速公路、砲位……）。
 */
export function settlementBuildings(p: Place, avoid: (x: number, z: number) => boolean): Building[] {
  const out: Building[] = []
  const R = settlementRadius(p)
  const h0 = nameHash(p.name)
  const S = BLOCK[p.kind]
  const per = PER_SIDE[p.kind]
  const [fill0, fill1] = FILL[p.kind]
  const [s0, s1] = SCALE[p.kind]
  // 格線的方向：0～90°，每個聚落自己的
  const ang = (((h0 >>> 3) & 0xffff) / 65536) * (Math.PI / 2)
  const ux = Math.cos(ang)
  const uz = Math.sin(ang)
  const vx = -uz
  const vz = ux
  // ── 教堂：聚落中心，周圍留空地 ─────────────────────
  const church = (p.kind === 'town' || (p.kind === 'village' && ((h0 >>> 20) & 0xff) / 256 < VILLAGE_CHURCH))
    && !avoid(p.x, p.z)
  const churchScale = p.kind === 'town' ? ((p.pop ?? 0) >= CATHEDRAL_POP ? 2 : 1.5) : 1
  // 【不留空地的話房子會插進教堂】梅澤堡的大教堂放大兩倍，實測與隔壁一棟重疊 7 m
  const clear = church ? CHURCH_REACH * churchScale + HOUSE_REACH : 0
  if (church) {
    out.push({ x: p.x, z: p.z, rot: ang, scale: churchScale, tint: 0.5, kind: FloraKind.Church })
  }
  const n = Math.ceil((1.3 * R) / S)
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const cx = p.x + ux * i * S + vx * j * S
      const cz = p.z + uz * i * S + vz * j * S
      if (!insideSettlement(p, cx, cz)) continue
      const r = Math.hypot(cx - p.x, cz - p.z) / R
      const fill = fill0 + (fill1 - fill0) * Math.min(1, r * r)
      const slate = SLATE[p.kind][0] + (SLATE[p.kind][1] - SLATE[p.kind][0]) * Math.min(1, r)
      // 四條街：±u 那兩邊的房子沿 v 排，±v 那兩邊沿 u 排
      for (let side = 0; side < 4; side++) {
        const nu = side === 0 ? 1 : side === 1 ? -1 : 0
        const nv = side === 2 ? 1 : side === 3 ? -1 : 0
        const tx = nu !== 0 ? vx : ux
        const tz = nu !== 0 ? vz : uz
        const inset = S / 2 - SETBACK
        for (let k = 0; k < per; k++) {
          const g = hash(h0, (((i + 512) * 1024 + (j + 512)) * 4 + side) * 8 + k)
          if ((g & 0xffff) / 65536 >= fill) continue
          const along = ((k + 0.5) / per - 0.5) * (S - 2 * SETBACK)
          const x = cx + (ux * nu + vx * nv) * inset + tx * along
          const z = cz + (uz * nu + vz * nv) * inset + tz * along
          if (!insideSettlement(p, x, z) || avoid(x, z)) continue
          if (Math.hypot(x - p.x, z - p.z) < clear) continue
          const g2 = hash(g, 0x5eed)
          const barn = ((g2 >>> 8) & 0xff) / 256 < BARN[p.kind]
          const roof = (g2 >>> 24) / 256
          out.push({
            x, z,
            // 【山牆對著街】長軸順著街，與農地的村同一個約定
            rot: Math.atan2(tx, tz),
            scale: s0 + ((g2 & 0xff) / 255) * (s1 - s0),
            tint: ((g2 >>> 16) & 0xff) / 255,
            kind: barn
              ? (roof < TAR_BARN ? FloraKind.TarBarn : FloraKind.Barn)
              : (roof < slate ? FloraKind.SlateHouse : FloraKind.House),
          })
        }
      }
    }
  }
  return out
}

/**
 * 空桶。**查詢不得每次 `?? []`** —— 那會在植被補格時每一株配一個陣列（keepOut
 * 每一株都問）
 */
const NO_BUILDINGS: readonly Building[] = []
const NO_PLACES: readonly Place[] = []

/** 建築依 tile 分桶的鍵。tile 的索引夾在 ±4096 內（±1,000 km） */
function bucketKey(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096)
}

/**
 * 全部聚落的建築，當成一個散佈器。**預先算好、依 tile 分桶** —— 幾萬棟房子
 * 每一格都全掃的話，補格時一幀要比對幾十萬次。
 */
export function settlementFlora(places: readonly Place[], avoid: (x: number, z: number) => boolean): FloraSource {
  const buckets = new Map<number, Building[]>()
  for (const p of places) {
    for (const b of settlementBuildings(p, avoid)) {
      const k = bucketKey(Math.floor(b.x / TILE_SIZE), Math.floor(b.z / TILE_SIZE))
      const list = buckets.get(k)
      if (list === undefined) buckets.set(k, [b])
      else list.push(b)
    }
  }
  return (x0, z0, x1, z1, heightAt, out) => {
    const i0 = Math.floor(x0 / TILE_SIZE)
    const i1 = Math.floor((x1 - 1e-6) / TILE_SIZE)
    const j0 = Math.floor(z0 / TILE_SIZE)
    const j1 = Math.floor((z1 - 1e-6) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const b of buckets.get(bucketKey(i, j)) ?? NO_BUILDINGS) {
          if (b.x < x0 || b.x >= x1 || b.z < z0 || b.z >= z1) continue
          pushFlora(out, b.x, heightAt(b.x, b.z), b.z, b.rot, b.scale, b.tint, b.kind)
        }
      }
    }
  }
}

/**
 * 「在某個聚落的輪廓內」的查詢。**依 1 km 分桶** —— 四百多個聚落，植被每一株
 * 都要問一次。
 */
export function settlementTest(places: readonly Place[]): (x: number, z: number) => boolean {
  const CELL = 1000
  const buckets = new Map<number, Place[]>()
  for (const p of places) {
    const r = settlementRadius(p) * 1.25
    for (let j = Math.floor((p.z - r) / CELL); j <= Math.floor((p.z + r) / CELL); j++) {
      for (let i = Math.floor((p.x - r) / CELL); i <= Math.floor((p.x + r) / CELL); i++) {
        const k = bucketKey(i, j)
        const list = buckets.get(k)
        if (list === undefined) buckets.set(k, [p])
        else list.push(p)
      }
    }
  }
  return (x, z) => {
    for (const p of buckets.get(bucketKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NO_PLACES) {
      if (insideSettlement(p, x, z)) return true
    }
    return false
  }
}

/** 鎮與村的地面（小聚落不鋪 —— 幾棟房子而已） */
export function buildSettlementGround(sample: HeightSampler, places: readonly Place[]): Mesh {
  const regions: DecalRegion[] = places
    .filter((p) => p.kind !== 'hamlet')
    .map((p) => {
      // 輪廓的起伏最多 +22%（`outlineScale`），外接盒放 1.25 倍
      const r = settlementRadius(p) * 1.25
      const color = p.kind === 'town' ? TOWN_GROUND : VILLAGE_GROUND
      return {
        x0: p.x - r, z0: p.z - r, x1: p.x + r, z1: p.z + r,
        inside: (x, z) => insideSettlement(p, x, z),
        colorAt: () => color,
      }
    })
  return buildDecals(sample, regions, 'settlementGround')
}
