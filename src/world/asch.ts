import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'

/**
 * # Y-29（比利時 Asch）：德 M3 專用的地形
 *
 * Kempen 高原的荒地：平、遠處幾顆極緩的丘。Y-29 是前進降落場（ALG），不是
 * 水泥機場 —— 一條鋼板網（PSP）跑道鋪在草地上，跑道一側一圈環狀滑行帶，
 * 滑行帶外側是一架一格的分散停機墊。**整張圖的佈局都在這個檔案**，卡片與
 * 佈景引用這裡的常數。
 *
 * 【跑道南北向、不轉】藍隊開局 z ≈ +5,000 朝 −Z 飛，沿著跑道進場就是一趟
 * 掃射航線。機場局部座標是世界座標減去 `FIELD_CENTER`，沒有旋轉。
 */

/**
 * 機場中心。藍隊的橫向槽位在 x ≈ −750 附近，跑道中線放在那一條線上；
 * 7.5 km 的進場在 200 m/s 下約 37 秒。
 */
export const FIELD_CENTER = /* @__PURE__ */ new Vector3(-750, 0, -2500)

/** 機場局部 → 世界 */
function at(dx: number, dz: number): { x: number; z: number } {
  return { x: FIELD_CENTER.x + dx, z: FIELD_CENTER.z + dz }
}

/** 世界 → 機場局部。護欄與佈景讀它 */
export function worldToField(x: number, z: number, out: { x: number; z: number }): void {
  out.x = x - FIELD_CENTER.x
  out.z = z - FIELD_CENTER.z
}

/** 軸對齊的矩形，機場局部座標 */
export interface FieldRect { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }

/** 墊面：草地，內部高度保證 0。一塊就包得住跑道、滑行帶與停機墊 */
export const FIELD_PAD: FieldRect = { x0: -340, z0: -760, x1: 70, z1: 760 }
/** 附加的墊面。這座機場沒有 */
export const FIELD_LOBES: readonly FieldRect[] = []
/** 墊面的外接矩形。護欄、佈景用 */
export const FIELD_BOUNDS: FieldRect = FIELD_PAD

/** 這一點在墊面的矩形裡；不含裙邊 */
export function inField(dx: number, dz: number): boolean {
  return dx >= FIELD_PAD.x0 && dx <= FIELD_PAD.x1 && dz >= FIELD_PAD.z0 && dz <= FIELD_PAD.z1
}
/** 墊面外一圈不長樹 */
export const FIELD_TREE_CLEAR = 300

/** 冬天的荒地草色 */
export const PAD_GRASS = 0x5a5c42
/** 鋼板網：生鏽的灰褐色，與波爾塔瓦的水泥（`RUNWAY_CONCRETE`）分得開 */
export const PSP_STEEL = 0x6b6556

/** 跑道：南北向 1,400 × 36 m */
export const RUNWAY: FieldRect = { x0: -18, z0: -700, x1: 18, z1: 700 }

/**
 * 環狀滑行帶，只在跑道西側：北、南兩段橫向接上跑道兩端，西段把兩頭接起來。
 * 寬 15 m。**三段的次序是北、西、南**。
 */
export const TAXI_LOOP: readonly FieldRect[] = [
  { x0: -215, z0: -655, x1: -18, z1: -640 },
  { x0: -215, z0: -640, x1: -200, z1: 640 },
  { x0: -215, z0: 640, x1: -18, z1: 655 },
]

/** 停機墊的半邊，m：30 m 見方，翼展 11.3 m 的 P-51 停得下 */
const PAD_HALF = 15
/** 窄巷的半寬，m */
const LANE_HALF = 5
/** 停機墊中心的 x：滑行帶西段外側 55 m */
const STAND_X = -270
/** 12 格，南北間距 90 m */
const STAND_ZS: readonly number[] = /* @__PURE__ */ Array.from({ length: 12 }, (_, i) => -495 + 90 * i)

/** 停機墊：飛機腳下那一塊 */
export const STAND_PADS: readonly FieldRect[] = /* @__PURE__ */ STAND_ZS.map((dz) => ({
  x0: STAND_X - PAD_HALF, x1: STAND_X + PAD_HALF, z0: dz - PAD_HALF, z1: dz + PAD_HALF,
}))

/** 窄巷：從停機墊中心接到滑行帶西段的外緣 */
export const STAND_LANES: readonly FieldRect[] = /* @__PURE__ */ STAND_ZS.map((dz) => ({
  x0: STAND_X, x1: TAXI_LOOP[1]!.x0, z0: dz - LANE_HALF, z1: dz + LANE_HALF,
}))

/** 全部的鋪面。著色器鋪鋼板色、佈景與砲位避開它們 */
export const PAVED: readonly FieldRect[] = /* @__PURE__ */ [RUNWAY, ...TAXI_LOOP, ...STAND_LANES, ...STAND_PADS]

/** 停放的 P-51：12 架，機首朝滑行帶（+X，`heading` −π/2） */
export const PARKED_ROWS: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ STAND_ZS.map((dz) => ({ ...at(STAND_X, dz), heading: -Math.PI / 2 }))

/**
 * 起飛線：跑道南端的中線，機首朝北（−Z）。滾行腳本從這裡出發 —— 跑到離地
 * 加上初期爬升約 500 m，交還時還在跑道上空。
 */
export const TAKEOFF_LINE: { readonly x: number; readonly z: number; readonly heading: number } =
  /* @__PURE__ */ { ...at(0, 650), heading: 0 }

/** 油桶堆兩塊，在滑行帶環內、離跑道與滑行帶各約 90 m */
export const DUMPS: readonly { kind: 'fuelDump'; x: number; z: number; heading: number }[] = [
  { kind: 'fuelDump', ...at(-110, -300), heading: 0 },
  { kind: 'fuelDump', ...at(-110, 300), heading: 0 },
]

/** 輕型防空砲 6 座：環內一座，其餘散在墊面外。**座數由試玩裁定** */
export const LIGHT_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: -110, dz: 0 },
    { dx: -450, dz: -600 }, { dx: -450, dz: 600 },
    { dx: 220, dz: -400 }, { dx: 220, dz: 400 },
    { dx: 0, dz: -1000 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/**
 * 手擺的丘陵：極緩，全在 4 km 外。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`
 * —— 外緣加上中心距離要在 `HILL_LIMIT`（14,000）內。
 */
export const ASCH_HILLS = [
  { cx: -7000, cz: -7500, radius: 900, peak: 30, pa: 0.9, pb: 3.4, seed: 301 },
  { cx: 6000, cz: -8000, radius: 1000, peak: 35, pa: 2.1, pb: 4.6, seed: 302 },
  { cx: -8000, cz: 3500, radius: 800, peak: 25, pa: 3.0, pb: 1.2, seed: 303 },
  { cx: 6000, cz: 4000, radius: 900, peak: 30, pa: 1.4, pb: 5.3, seed: 304 },
] as const

/** 連外道路往西出圖 */
export const ROAD_WIDTH = 8
export const ROADS: readonly (readonly { x: number; z: number }[])[] = [
  [at(FIELD_PAD.x0, 0), { x: -14500, z: FIELD_CENTER.z }],
]

export function createAsch(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of ASCH_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  // 基準面是 0：內陸沒有海
  bakeRelief(field, hills, 0)
  return { field, hills }
}
