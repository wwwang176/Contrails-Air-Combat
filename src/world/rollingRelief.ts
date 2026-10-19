import { createHeightField, type HeightFieldData } from './heightfield'
import { makeLobes, raiseRelief, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { HILL_LIMIT } from './farmland'
import { drawHillLobes } from './leuna'

/**
 * # 內陸地圖的緩坡
 *
 * 丘陵之間的平地加一層低矮、互相可以重疊的起伏（與勒熱夫的 `rollingSpecs` 同一種形狀），
 * 但**避開要平的地方**：河、城鎮、機場、廠區。
 *
 * 【只烘進高度場，不登錄給 AI】AI 的地板只來自登錄的丘陵（`ai/terrainSense.ts`），戰鬥機
 * 平飛的最低餘裕是 30 m（`ai/safety.ts`）。所以峰高壓在 `ROLLING_PEAK_MAX` 以下
 *
 * 【避開的做法：遮罩、距離、淡入】要平的範圍各地圖給（判斷式與佈景頂點，見 `addRolling`），
 * 在高度場的格上劃成遮罩，算每一格到遮罩的距離。緩坡乘
 * `smoothstep(ROLLING_CLEAR, ROLLING_CLEAR + ROLLING_RAMP, 距離)`：範圍裡與外面一圈完全不動，
 * 再往外慢慢長起來。不管範圍是什麼形狀（河線、村、墊面、礦坑）都同一套
 *
 * 【與原本的地形取 max】丘陵那裡照舊；只有比原本高的地方被抬起來
 */

/** 緩坡的峰高上限，m。低於戰鬥機平飛的最低餘裕（30 m） */
export const ROLLING_PEAK_MAX = 20

/** 要平的範圍外面再留多少完全不動，m。大於一格的對角線（113 m）：遮罩是逐格判斷的 */
export const ROLLING_CLEAR = 120

/** 由不動長到完整高度的寬度，m。20 m 在 400 m 裡長起來，坡度 5% */
export const ROLLING_RAMP = 400

/** 緩坡的半徑範圍、峰高佔半徑的比例、候選格的間距（候選點在格內隨機偏移），m。與勒熱夫相同 */
const ROLLING_RADIUS = [520, 900] as const
const ROLLING_SLOPE = [0.024, 0.04] as const
const ROLLING_STEP = 520

/** 一點在不在要平的範圍裡 */
export type FlatTest = (x: number, z: number) => boolean

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

/**
 * 全圖的緩坡：候選點鋪滿 `HILL_LIMIT` 以內，彼此可以重疊（烘焙取 max，不會疊高）。
 * 種子固定，同一張圖每次一樣
 */
export function rollingBumps(seed: number): IslandDesc[] {
  const rand = rng(seed)
  const out: IslandDesc[] = []
  const n = Math.floor((2 * HILL_LIMIT) / ROLLING_STEP)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // 【每一格的亂數都無條件抽完，篩選在之後】條件式的抽樣會讓序列漂
      const cx = -HILL_LIMIT + (i + rand()) * ROLLING_STEP
      const cz = -HILL_LIMIT + (j + rand()) * ROLLING_STEP
      const radius = ROLLING_RADIUS[0] + rand() * (ROLLING_RADIUS[1] - ROLLING_RADIUS[0])
      const slope = ROLLING_SLOPE[0] + rand() * (ROLLING_SLOPE[1] - ROLLING_SLOPE[0])
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2
      const outerRadius = radius * WOBBLE_MAX
      // 【留一圈平地接遠景環】見 `HILL_LIMIT`
      if (Math.hypot(cx, cz) + outerRadius > HILL_LIMIT) continue
      const peak = Math.min(ROLLING_PEAK_MAX, radius * slope)
      out.push({
        cx, cz, radius, outerRadius, peak,
        lobes: makeLobes(cx, cz, radius, outerRadius, peak, pa, pb, drawHillLobes(seed + 7919 * (out.length + 1))),
      })
    }
  }
  return out
}

/**
 * 高度場的格上「要平」的遮罩（1 = 要平）。`tests` 逐格心判斷；`points` 是佈景的頂點
 * （世界座標 x, z 交錯），落在哪一格那一格就要平 —— 整顆擺在 y = 0 的模型（廠區、機場的
 * 電線桿與沙包）不管散到哪裡都避得開
 */
export function flatMask(
  field: HeightFieldData, tests: readonly FlatTest[], points?: ArrayLike<number>,
): Uint8Array {
  const { size, cell } = field
  const half = (size - 1) / 2
  const mask = new Uint8Array(size * size)
  for (let row = 0; row < size; row++) {
    const z = (row - half) * cell
    for (let col = 0; col < size; col++) {
      const x = (col - half) * cell
      for (const t of tests) {
        if (t(x, z)) {
          mask[row * size + col] = 1
          break
        }
      }
    }
  }
  if (points !== undefined) {
    for (let k = 0; k + 1 < points.length; k += 2) {
      const col = Math.round(points[k]! / cell + half)
      const row = Math.round(points[k + 1]! / cell + half)
      if (col < 0 || row < 0 || col >= size || row >= size) continue
      mask[row * size + col] = 1
    }
  }
  return mask
}

/**
 * 每一格到最近的「要平」格的距離，m（八鄰的倒角距離，斜向乘 √2；誤差不到 8%）。
 * 遮罩全空時是無限大
 */
export function clearanceOf(field: HeightFieldData, mask: Uint8Array): Float32Array {
  const { size, cell } = field
  const d = new Float32Array(size * size)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === 1 ? 0 : Infinity
  const diag = cell * Math.SQRT2
  const relax = (i: number, j: number, w: number): void => {
    const v = d[j]! + w
    if (v < d[i]!) d[i] = v
  }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = row * size + col
      if (col > 0) relax(i, i - 1, cell)
      if (row > 0) {
        relax(i, i - size, cell)
        if (col > 0) relax(i, i - size - 1, diag)
        if (col + 1 < size) relax(i, i - size + 1, diag)
      }
    }
  }
  for (let row = size - 1; row >= 0; row--) {
    for (let col = size - 1; col >= 0; col--) {
      const i = row * size + col
      if (col + 1 < size) relax(i, i + 1, cell)
      if (row + 1 < size) {
        relax(i, i + size, cell)
        if (col + 1 < size) relax(i, i + size + 1, diag)
        if (col > 0) relax(i, i + size - 1, diag)
      }
    }
  }
  return d
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 在已經烘好的高度場上加緩坡。`tests`、`points` 是要平的範圍（見 `flatMask`）；`seed` 每張
 * 圖各給一個，起伏才不會每張圖一樣。**要在任何取樣地形的東西（河的水面、村鎮、佈景）之前呼叫**
 */
export function addRolling(
  field: HeightFieldData, seed: number, tests: readonly FlatTest[], points?: ArrayLike<number>,
): void {
  const roll = createHeightField(field.size, field.cell)
  raiseRelief(roll, rollingBumps(seed), 0)
  const clearance = clearanceOf(field, flatMask(field, tests, points))
  const { data } = field
  for (let i = 0; i < data.length; i++) {
    const h = roll.data[i]! * smoothstep(ROLLING_CLEAR, ROLLING_CLEAR + ROLLING_RAMP, clearance[i]!)
    if (h > data[i]!) data[i] = h
  }
}
