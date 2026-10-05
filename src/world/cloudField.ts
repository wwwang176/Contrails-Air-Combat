import type { TerrainKind } from './terrainKind'
import type { TimeOfDay } from './timeOfDay'

/**
 * # 一場的雲場
 *
 * 一朵朵分開的小雲，鋪滿「戰場半徑 + `CLOUD_FIELD_MARGIN`」的圓。只是畫面：不擋 AI 視線、
 * 不擋彈道、不進任何判定。
 *
 * 【為什麼住在 `world/`】任務卡（battle 層）要帶它，而 battle 層不相依渲染層。擺法
 * （`cloudFieldSpecs`）在 `render/clouds.ts`。
 */

export type CloudAmount = 'few' | 'some' | 'many'

/** 雲底高度範圍（m）與雲量 */
export interface CloudField {
  readonly yMin: number
  readonly yMax: number
  readonly amount: CloudAmount
}

/** 每平方公里幾朵。視野 8 km 內大約看得到 20／40／70 朵 */
export const CLOUD_DENSITY: Record<CloudAmount, number> = { few: 0.1, some: 0.2, many: 0.35 }

/**
 * 雲鋪到戰場半徑再往外多遠，m。雲最遠畫到 8 km（`CLOUD_DRAW_FAR`）：站在界上往外看，
 * 少了這一圈的話界外是一片空天
 */
export const CLOUD_FIELD_MARGIN = 8000

/** 一場的雲有幾朵 */
export function cloudFieldCount(f: CloudField, arenaRadius: number): number {
  const r = arenaRadius + CLOUD_FIELD_MARGIN
  return Math.round(CLOUD_DENSITY[f.amount] * Math.PI * r * r / 1e6)
}

/** 遭遇戰的雲底高度照地形，m：熱帶海上的積雲低、內陸夏天高、秋冬的層積雲在中間 */
export const SKIRMISH_CLOUD_BASE: Record<TerrainKind, readonly [number, number]> = {
  sea: [600, 900],
  archipelago: [600, 900],
  leyte: [500, 900],
  farmland: [1200, 1800],
  autumnFarmland: [800, 1500],
  leuna: [800, 1500],
  asch: [800, 1500],
  rzhev: [800, 1500],
  poltava: [1000, 1600],
}

/** 遭遇戰的雲場：雲底照地形，雲量照時段（暴雨多、夜間少，其餘中等） */
export function skirmishCloudField(terrain: TerrainKind, timeOfDay: TimeOfDay): CloudField {
  const [yMin, yMax] = SKIRMISH_CLOUD_BASE[terrain]
  const amount: CloudAmount = timeOfDay === 'storm' ? 'many' : timeOfDay === 'night' ? 'few' : 'some'
  return { yMin, yMax, amount }
}
