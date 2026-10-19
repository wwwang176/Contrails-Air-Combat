import { assetUrl } from '../core/asset'
import { FARM_EXTENT } from '../world/farmland'
import { LEUNA_RIVER_ENDS } from '../world/leuna'
import { extendRivers, riverLines, type HeightSampler, type RiverFile } from '../world/river'
import type { WaterLine } from '../world/riverTypes'
import { createRiverSet, type RiverSet } from './river'

/**
 * # 洛伊納一帶的河道
 *
 * 資料：© OpenStreetMap contributors，ODbL，由 `tools/dem/fetch-leuna-rivers.mjs`
 * 抓成 `public/data/leuna-rivers.json`（Saale、Luppe、Wethau）。
 *
 * 【進場前預載】與廠區的 GLB 同一個理由：`createTerrain` 是同步的。少了
 * `preloadLeunaRivers` 的症狀是 `buildLeunaRivers` 當場丟錯，那一關進不去。
 */
export const LEUNA_RIVERS_URL = '/data/leuna-rivers.json'

let cache: RiverFile | null = null

export async function preloadLeunaRivers(
  fetcher: (url: string) => Promise<RiverFile> =
  async (u) => (await fetch(assetUrl(u))).json() as Promise<RiverFile>,
): Promise<void> {
  if (cache !== null) return
  cache = await fetcher(LEUNA_RIVERS_URL)
}

/**
 * 這一張地形的河：地圖內的中心線，加上流出地圖的那幾端往外編的延伸段
 * （河端各自怎麼走見 `LEUNA_RIVER_ENDS`）。
 * `sample` 要是**場外回 0** 的那一份 —— 延伸段整段都在場外。
 */
/**
 * 河的中心線，**只有位置**（水面高度照平地算，不能拿來畫）。內陸的緩坡要在取樣地形之前
 * 知道河在哪裡（`terrain.ts`）；河線與延伸段的位置不吃地形，只有水面高度吃
 */
export function leunaRiverPaths(): WaterLine[] {
  if (cache === null) throw new Error('洛伊納的河道還沒載入 —— 少了 preloadLeunaRivers()')
  const flat: HeightSampler = () => 0
  const lines = riverLines(flat, cache)
  return [...lines, ...extendRivers(lines, FARM_EXTENT / 2, flat, LEUNA_RIVER_ENDS)]
}

export function buildLeunaRivers(sample: HeightSampler): RiverSet {
  if (cache === null) throw new Error('洛伊納的河道還沒載入 —— 少了 preloadLeunaRivers()')
  const lines = riverLines(sample, cache)
  return createRiverSet([...lines, ...extendRivers(lines, FARM_EXTENT / 2, sample, LEUNA_RIVER_ENDS)])
}
