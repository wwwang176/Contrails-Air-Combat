import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'
import { RZHEV_HILLS, toLocal } from './rzhev'
import { ravineGap } from './rzhevRavines'

/**
 * # 勒熱夫的丘陵：手擺的錨點加上程序填滿的緩丘
 *
 * 地面要一眼看得出起伏，所以丘陵鋪滿大半張圖；但村、沖溝與戰場那一塊要是平的 ——
 * 村的房子與菜園、沖溝的溝帶是貼著地面畫的平面，戰場的壕溝、雷區、單位擺位也都照平地排。
 *
 * 【兩層】
 * - **丘陵**（`rzhevHillSpecs`）：AI 避障看得到的那一層，是 `IslandDesc`。由大到小分幾輪，每輪在全圖隨機撒點，
 *   放得下的就放：膨脹圓（`radius × WOBBLE_MAX`）與已經放好的任何一座至少相隔 `HILL_GAP`（硬約束，見
 *   `farmland.ts`）、不碰平地區、離村與沖溝夠遠。膨脹圓不准重疊，光靠這一層最多只能蓋到約四成的地。
 * - **緩坡**（`rollingSpecs`）：低矮、互相可以重疊的起伏，只烘進高度場、**不登錄成 `IslandDesc`**，
 *   填滿丘陵之間的地。最高約 20 m，低於 AI 貼地飛的最低高度；烘焙取 max，重疊不會挖洞也不會疊高。
 *
 * 種子固定，每次載入一樣。
 */

/** 不放丘陵的圓：世界座標的圓心與半徑，m。村與小聚落的位置由地形那邊算好傳進來 */
export interface HillAvoid {
  readonly x: number
  readonly z: number
  readonly r: number
}

/** 局部座標的矩形：戰場方框加外圈，與南邊蘇軍縱隊集結的那一段 */
const FLAT_ZONES = [
  { lx0: -1900, lx1: 1900, lz0: -2100, lz1: 1400 },
  { lx0: -400, lx1: 800, lz0: 1400, lz1: 2100 },
] as const

/** 丘陵的膨脹圓離平地區、村、沖溝的最小間隙，m */
const CLEAR = 80

/** 沖溝主溝的半寬，m（`rzhevRavines.ts` 的主溝；支溝更窄） */
const RAVINE_HALF = 32

/**
 * 填丘陵的幾輪：半徑範圍與嘗試次數。後面的輪半徑小、次數多，填前面幾輪留下的縫
 */
const PASSES = [
  { radius: [850, 1000], tries: 400 },
  { radius: [680, 850], tries: 1500 },
  { radius: [540, 680], tries: 3500 },
  { radius: [420, 540], tries: 6000 },
] as const

/** 峰高佔半徑的比例。比農地的 0.06～0.10 高一點：小丘也要看得出起伏 */
const SLOPE = [0.07, 0.11] as const

const SEED = 0x51c0de

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 圓心到局部矩形的距離（在矩形裡是 0） */
function gapToRect(
  lx: number, lz: number, z: { readonly lx0: number; readonly lx1: number; readonly lz0: number; readonly lz1: number },
): number {
  const dx = Math.max(z.lx0 - lx, 0, lx - z.lx1)
  const dz = Math.max(z.lz0 - lz, 0, lz - z.lz1)
  return Math.hypot(dx, dz)
}

export interface HillSpec {
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly peak: number
  readonly pa: number
  readonly pb: number
  readonly seed: number
}

/**
 * 全部的丘陵：`RZHEV_HILLS` 的錨點在前，程序填的在後。
 *
 * @param avoid 村與小聚落，填的丘陵離它們至少 `r` 加膨脹圓半徑
 */
export function rzhevHillSpecs(avoid: readonly HillAvoid[] = []): readonly HillSpec[] {
  const rand = rng(SEED)
  const out: HillSpec[] = [...RZHEV_HILLS]
  const outer = (h: { radius: number }): number => h.radius * WOBBLE_MAX
  for (const pass of PASSES) {
    for (let t = 0; t < pass.tries; t++) {
      // 【每一輪每次嘗試的亂數都無條件抽完，篩選在之後】條件式的抽樣會讓序列漂
      const cx = (rand() * 2 - 1) * HILL_LIMIT
      const cz = (rand() * 2 - 1) * HILL_LIMIT
      const radius = pass.radius[0] + rand() * (pass.radius[1] - pass.radius[0])
      const peak = Math.min(HILL_PEAK_MAX, radius * (SLOPE[0] + rand() * (SLOPE[1] - SLOPE[0])))
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2
      const reach = outer({ radius })
      if (Math.hypot(cx, cz) + reach > HILL_LIMIT) continue
      let clash = false
      for (const o of out) {
        if (Math.hypot(cx - o.x, cz - o.z) < reach + outer(o) + HILL_GAP) { clash = true; break }
      }
      if (clash) continue
      const l = toLocal(cx, cz)
      if (FLAT_ZONES.some((z) => gapToRect(l.lx, l.lz, z) < reach + CLEAR)) continue
      if (avoid.some((a) => Math.hypot(cx - a.x, cz - a.z) < reach + a.r + CLEAR)) continue
      if (ravineGap(cx, cz) < reach + RAVINE_HALF + CLEAR) continue
      out.push({ x: cx, z: cz, radius, peak, pa, pb, seed: 1000 + out.length })
    }
  }
  return out
}

/** 緩坡的半徑範圍、峰高佔半徑的比例、候選格的間距（候選點在格內隨機偏移），m */
const ROLLING_RADIUS = [520, 900] as const
const ROLLING_SLOPE = [0.024, 0.04] as const
const ROLLING_STEP = 520
const ROLLING_SEED = 0x7011
/** 緩坡縮小到這個半徑以下就不放了：太小的包在 80 m 的格距上只是幾個尖點 */
const ROLLING_MIN_RADIUS = 260

/**
 * 緩坡：候選點鋪滿全圖，彼此可以重疊，所以不查間距。靠近平地區、村或沖溝的候選點不丟掉，而是把
 * 半徑縮到膨脹圓剛好留得出 `CLEAR` 的大小（不小於 `ROLLING_MIN_RADIUS`），貼著禁區的地方才填得滿。
 * 最高 `ROLLING_RADIUS[1] × ROLLING_SLOPE[1]` ≈ 36 m，多數在 10～25 m
 */
export function rollingSpecs(avoid: readonly HillAvoid[] = []): readonly HillSpec[] {
  const rand = rng(ROLLING_SEED)
  const out: HillSpec[] = []
  const n = Math.floor((2 * HILL_LIMIT) / ROLLING_STEP)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = -HILL_LIMIT + (i + rand()) * ROLLING_STEP
      const cz = -HILL_LIMIT + (j + rand()) * ROLLING_STEP
      let radius = ROLLING_RADIUS[0] + rand() * (ROLLING_RADIUS[1] - ROLLING_RADIUS[0])
      const slope = ROLLING_SLOPE[0] + rand() * (ROLLING_SLOPE[1] - ROLLING_SLOPE[0])
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2
      // 膨脹圓能有多大：到場地邊緣、平地區、村、沖溝各留 CLEAR 之後，剩下的最小一個空間
      const l = toLocal(cx, cz)
      let room = HILL_LIMIT - Math.hypot(cx, cz)
      for (const z of FLAT_ZONES) room = Math.min(room, gapToRect(l.lx, l.lz, z) - CLEAR)
      for (const a of avoid) room = Math.min(room, Math.hypot(cx - a.x, cz - a.z) - a.r - CLEAR)
      if (room < ROLLING_MIN_RADIUS * WOBBLE_MAX) continue
      room = Math.min(room, ravineGap(cx, cz) - RAVINE_HALF - CLEAR)
      radius = Math.min(radius, room / WOBBLE_MAX)
      if (radius < ROLLING_MIN_RADIUS) continue
      out.push({ x: cx, z: cz, radius, peak: radius * slope, pa, pb, seed: 5000 + out.length })
    }
  }
  return out
}

function describe(h: HillSpec): IslandDesc {
  const outerRadius = h.radius * WOBBLE_MAX
  const peak = Math.min(HILL_PEAK_MAX, h.peak)
  return {
    cx: h.x, cz: h.z, radius: h.radius, outerRadius, peak,
    lobes: makeLobes(h.x, h.z, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
  }
}

/**
 * 高度場與丘陵（AI 避障用的 `IslandDesc`）。基準面是 0：內陸沒有海。
 * 緩坡烘進高度場，但不在回傳的 `hills` 裡
 */
export function createRzhev(avoid: readonly HillAvoid[] = []): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills = rzhevHillSpecs(avoid).map(describe)
  bakeRelief(field, [...hills, ...rollingSpecs(avoid).map(describe)], 0)
  return { field, hills }
}
