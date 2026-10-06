import { insideSettlement, outlineScale, settlementRadius, type Place } from '../world/landFeatures'
import { COVER_EDGE, COVER_IN, COVER_OUT, type CellCover, type KeepOutZone } from './keepOutMask'

/** 聚落輪廓的分桶查詢，供植被避讓與整格遮罩使用；不生成建築或網格。 */
const NO_PLACES: readonly Place[] = []

/** 植被 tile 與空間查詢共用的格索引編碼；兩軸索引都在 [-4096, 4096) 內。 */
export function bucketKey(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096)
}

/** 聚落與它的半徑（`settlementRadius` 要對名字做雜湊，預先算好） */
interface SizedPlace {
  readonly p: Place
  readonly R: number
}

const NO_SIZED: readonly SizedPlace[] = []

/** 輪廓倍率的範圍（`outlineScale` 是 1 ± 0.22） */
const OUTLINE_MIN = 0.78

const OUTLINE_MAX = 1.22

/**
 * 輪廓倍率對方位角的斜率上限（`outlineScale` 是 1 + 0.22 × (0.6 sin 3θ + 0.4 sin 5θ)，
 * 對 θ 微分最多 0.22 × (0.6 × 3 + 0.4 × 5)）。一段角度裡的輪廓不會偏離中間那一點超過
 * 這個乘上半角
 */
const OUTLINE_SLOPE = 0.22 * (0.6 * 3 + 0.4 * 5)

/**
 * 「在某個聚落的輪廓內」的查詢。**依 1 km 分桶** —— 四百多個聚落，植被每一株
 * 都要問一次。
 */
export function settlementTest(places: readonly Place[]): (x: number, z: number) => boolean {
  const CELL = 1000
  const buckets = new Map<number, SizedPlace[]>()
  for (const p of places) {
    const R = settlementRadius(p)
    const r = R * 1.25
    for (let j = Math.floor((p.z - r) / CELL); j <= Math.floor((p.z + r) / CELL); j++) {
      for (let i = Math.floor((p.x - r) / CELL); i <= Math.floor((p.x + r) / CELL); i++) {
        const k = bucketKey(i, j)
        const list = buckets.get(k)
        if (list === undefined) buckets.set(k, [{ p, R }])
        else list.push({ p, R })
      }
    }
  }
  // 【先比半徑】輪廓的起伏最多 ±22%（`outlineScale`）：0.78 倍以內一定在裡面、1.22 倍
  // 以外一定在外面，只有中間那一圈要算輪廓。植被補格時每一株樹籬都問它
  return (x, z) => {
    for (const { p, R } of buckets.get(bucketKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NO_SIZED) {
      // 手寫開根號：V8 的 Math.hypot 每次呼叫都會配置
      const dx = x - p.x
      const dz = z - p.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > R * OUTLINE_MAX) continue
      if (d <= R * OUTLINE_MIN || insideSettlement(p, x, z)) return true
    }
    return false
  }
}

/**
 * `settlementTest` 的整格版：這個方框**可能**碰到某個聚落的輪廓嗎（保守：外接圓
 * 取半徑的 1.25 倍，輪廓的起伏最多 +22%）
 */
export function settlementNear(places: readonly Place[]): (x0: number, z0: number, x1: number, z1: number) => boolean {
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
  return (x0, z0, x1, z1) => {
    for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (const p of buckets.get(bucketKey(i, j)) ?? NO_PLACES) {
          const r = settlementRadius(p) * 1.25
          const dx = Math.max(x0 - p.x, 0, p.x - x1)
          const dz = Math.max(z0 - p.z, 0, p.z - z1)
          if (dx * dx + dz * dz <= r * r) return true
        }
      }
    }
    return false
  }
}

/**
 * `settlementTest` 的遮罩分類（`keepOutMask.ts`）。格心離聚落中心 d、格的半對角線
 * hd：格裡每一點離中心在 [d − hd, d + hd]、方位角在格心的 ±asin(hd / d) 裡，那段
 * 角度的輪廓夾在中間那一點 ± `OUTLINE_SLOPE` × 半角之間
 */
function settlementCover(places: readonly Place[]): CellCover {
  const CELL = 1000
  const buckets = new Map<number, SizedPlace[]>()
  for (const p of places) {
    const R = settlementRadius(p)
    const r = R * OUTLINE_MAX
    for (let j = Math.floor((p.z - r) / CELL); j <= Math.floor((p.z + r) / CELL); j++) {
      for (let i = Math.floor((p.x - r) / CELL); i <= Math.floor((p.x + r) / CELL); i++) {
        const k = bucketKey(i, j)
        const list = buckets.get(k)
        if (list === undefined) buckets.set(k, [{ p, R }])
        else list.push({ p, R })
      }
    }
  }
  return (cx, cz, hd) => {
    let edge = false
    const seen = new Set<SizedPlace>()
    for (let j = Math.floor((cz - hd) / CELL); j <= Math.floor((cz + hd) / CELL); j++) {
      for (let i = Math.floor((cx - hd) / CELL); i <= Math.floor((cx + hd) / CELL); i++) {
        for (const s of buckets.get(bucketKey(i, j)) ?? NO_SIZED) {
          if (seen.has(s)) continue
          seen.add(s)
          const { p, R } = s
          const dx = cx - p.x
          const dz = cz - p.z
          const d = Math.sqrt(dx * dx + dz * dz)
          if (d - hd > R * OUTLINE_MAX) continue
          if (d <= hd) {
            if (d + hd <= R * OUTLINE_MIN) return COVER_IN
            edge = true
            continue
          }
          const o = outlineScale(p, Math.atan2(dz, dx))
          const spread = OUTLINE_SLOPE * Math.asin(Math.min(1, hd / d))
          if (d + hd <= R * Math.max(OUTLINE_MIN, o - spread)) return COVER_IN
          if (d - hd > R * Math.min(OUTLINE_MAX, o + spread)) continue
          edge = true
        }
      }
    }
    return edge ? COVER_EDGE : COVER_OUT
  }
}

/** 聚落的輪廓當成不長樹的範圍 */
export function settlementZone(places: readonly Place[]): KeepOutZone {
  return { test: settlementTest(places), near: settlementNear(places), cover: settlementCover(places) }
}
