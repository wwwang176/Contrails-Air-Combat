import type { Mesh } from 'three'
import { buildDecals, type DecalGrid, type DecalRegion } from './groundDecal'
import { insideRing, ringDistance, type FeatureFile } from '../world/landFeatures'
import type { HeightSampler } from '../world/river'

/**
 * # 蓋澤爾谷的露天褐煤礦
 *
 * 1944 年正在開採 —— 今天的 Geiseltalsee、Runstedter See 等湖是礦坑在 2000 年
 * 後灌水而成。範圍取湖的輪廓；當年開採中的範圍與最後的坑不完全一樣。
 *
 * 【只有顏色，不挖深】高度場最低是 0（`leuna.test.ts` 守著），坑是鋪在地表
 * 上的一塊：坑緣是淺色的裸土，往內一圈一圈的開採階梯，坑底是黑褐色的褐煤層。
 * 從投彈高度看，階梯的色帶就是坑的深度感。
 */

/** 坑緣那一圈裸土的寬度，m。細格 20 m（`DECAL_GRID`），階梯一階 70 m 畫得出色帶 */
const RIM = 45
/** 一階階梯的寬度，m */
const STEP = 70
/** 離坑緣超過這個距離就是坑底，m */
const FLOOR = 420

const RIM_EARTH = 0x7d6e58
const TERRACE_LIGHT = 0x76654d
const TERRACE_DARK = 0x645541
const LIGNITE = 0x37302a
/** 坑底有積水與濕土的斑塊 */
const LIGNITE_WET = 0x2c2a27

/** 坑裡這一點的顏色；`edge` 是離坑緣的距離 */
export function mineColor(x: number, z: number, edge: number): number {
  if (edge < RIM) return RIM_EARTH
  if (edge < FLOOR) return Math.floor((edge - RIM) / STEP) % 2 === 0 ? TERRACE_LIGHT : TERRACE_DARK
  // 坑底：用座標做一點低頻的斑塊，不是一整片死黑
  const n = Math.sin(x * 0.004) * Math.sin(z * 0.0033) + Math.sin((x + z) * 0.0021)
  return n > 0.6 ? LIGNITE_WET : LIGNITE
}

/** 礦坑的地面網格。`grid` 見 `buildDecals` */
export function buildMines(
  sample: HeightSampler, mines: FeatureFile['mines'], grid?: DecalGrid, name = 'mines',
): Mesh {
  return buildDecals(sample, mines.map((m): DecalRegion => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const [x, z] of m.ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    return {
      x0, z0, x1, z1,
      inside: (x, z) => insideRing(m.ring, x, z),
      colorAt: (x, z) => mineColor(x, z, insideRing(m.ring, x, z) ? ringDistance(m.ring, x, z) : 0),
    }
  }), name, grid)
}

/** 「在礦坑裡（含坑緣外 `margin` 公尺）」的查詢，植被與建築用 */
/** `mineTest` 的整格版：這個方框**可能**碰到某個礦坑（含坑緣外 `margin`）嗎 */
export function mineNear(mines: FeatureFile['mines'], margin: number): (x0: number, z0: number, x1: number, z1: number) => boolean {
  const boxes = mines.map((m) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const [x, z] of m.ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    return { x0: x0 - margin, z0: z0 - margin, x1: x1 + margin, z1: z1 + margin }
  })
  return (x0, z0, x1, z1) => boxes.some((b) => x1 >= b.x0 && x0 <= b.x1 && z1 >= b.z0 && z0 <= b.z1)
}

export function mineTest(mines: FeatureFile['mines'], margin: number): (x: number, z: number) => boolean {
  const boxes = mines.map((m) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const [x, z] of m.ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    return { ring: m.ring, x0: x0 - margin, z0: z0 - margin, x1: x1 + margin, z1: z1 + margin }
  })
  return (x, z) => {
    for (const b of boxes) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue
      if (insideRing(b.ring, x, z) || ringDistance(b.ring, x, z) < margin) return true
    }
    return false
  }
}
