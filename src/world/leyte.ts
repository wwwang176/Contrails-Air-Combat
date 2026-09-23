import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, SEA_FLOOR, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { drawHillLobes } from './leuna'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 一座很大的平坦島嶼：世界 −Z 是海（雷伊泰灣），+Z 是陸。陸上是平地、一條
 * 蜿蜒的公路與幾座小山丘。
 *
 * 【高度場的組成】先把丘陵烘進去（底面是 `SEA_FLOOR`），再逐格與「海岸線
 * 加平地」的基準面取 max。丘陵的瓣緣因此併入平地，不會在平地上挖出環溝。
 *
 * 【避障清單只有丘陵】平地只有 `PLAIN_HEIGHT` 高，那是地面不是障礙；AI 的
 * 圓盤法只需要知道丘陵（`ai/terrainSense.ts`）。
 *
 * 【平地的高度】高過海浪的波峰（三道波合計振幅 4.5 m，見 `render/island.ts`
 * 的 `DRAW_FLOOR`），浪才不會從陸地上冒出來；又要低到 AI 以海平面當地板時
 * 的誤差可以忽略 —— AI 的安全層讀 `seaHeight` 加丘陵的圓盤，不讀平地。
 *
 * 全部座標與數值是**起始值，由試飛裁定**。
 */

/** 高度場邊長頂點數。375 × 80 m = 30 km 見方，與農地同一個尺寸 */
export const LEYTE_SIZE = 376
/** 格距，m。平地與緩丘用 80 m 就夠；公路畫在 shader 裡，不吃格距 */
export const LEYTE_CELL = 80
const HALF_EXTENT = ((LEYTE_SIZE - 1) * LEYTE_CELL) / 2

/** 平地的高度，m */
export const PLAIN_HEIGHT = 8
/** 這個高度以下是沙灘色、不長植被，m。`render/leyteGround.ts` 與植被共用 */
export const SAND_TOP = 3
/** 丘陵峰高的上限，m。`LandField.ceiling` 用它 */
export const LEYTE_PEAK_MAX = 150

/** 岸線平均位置，m（世界 z） */
const COAST_Z = -4000
/** 岸線的三道起伏：振幅 m、波長 m、相位 rad。振幅合計 770 m */
const COAST_WAVES = [
  { amp: 400, len: 9000, phase: 0.7 },
  { amp: 250, len: 3700, phase: 2.1 },
  { amp: 120, len: 1700, phase: 4.4 },
] as const
/** 由水線升到平地的斜坡寬，m */
const SHORE_RAMP = 240
/** 海床由水線降到 `SEA_FLOOR` 的距離，m */
const SEABED_RAMP = 200
/**
 * 場地另外三邊由平地降回海裡的帶寬，m。**它是這座島另外幾面的海岸** ——
 * 少了它，高度場的邊界是一道 8 m 的直崖，外面接著遠海。
 */
const EDGE_RAMP = 1200

/** 岸線在這個 x 上的世界 z。陸地在 `z > coastZ(x)` */
export function coastZ(x: number): number {
  let z = COAST_Z
  for (const w of COAST_WAVES) z += w.amp * Math.sin((2 * Math.PI * x) / w.len + w.phase)
  return z
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 沒有丘陵時這一點的高度，m：海床、海岸斜坡、平地，再被場地邊緣的帶壓回海裡。
 *
 * 【距離取 z 向】`z − coastZ(x)` 不是到岸線的真正距離，但岸線的最大斜率
 * （Σ 2π·amp/len ≈ 1.13）之下斜坡只會被拉寬到約 1.5 倍，看不出來。
 */
export function baseHeight(x: number, z: number): number {
  const d = z - coastZ(x)
  const h = d <= 0
    ? Math.max(SEA_FLOOR, (d / SEABED_RAMP) * -SEA_FLOOR)
    : PLAIN_HEIGHT * smoothstep(0, SHORE_RAMP, d)
  const edge = Math.min(HALF_EXTENT - Math.abs(x), HALF_EXTENT - z)
  const cap = SEA_FLOOR + (PLAIN_HEIGHT - SEA_FLOOR) * smoothstep(0, EDGE_RAMP, edge)
  return Math.min(h, cap)
}

/**
 * 公路：灘頭 → 前線的折線，世界座標。**車隊的路線、地上畫的路、植被的清空帶
 * 全部讀這一份** —— 各寫一份的話車會開在路旁的樹林裡，而且不報錯。
 *
 * 【轉角不超過 45°】車在轉角走 25 m 半徑的圓弧（`world/groundMotion.ts`），
 * 離折線最遠 `25 × (1/cos 22.5° − 1)` ≈ 2.1 m，落在路的半寬 4 m 之內。
 *
 * 【第一段要夠長】整條車隊的集結都排在這一段上（日 M2 是 18 輛 × 30 m）。
 * 排得下與否由 `campaigns.test.ts` 對著卡片上的車隊檢查。
 */
export const LEYTE_ROAD: readonly { readonly x: number; readonly z: number }[] = [
  { x: 2800, z: -3250 },
  { x: 2200, z: -2500 },
  { x: 2000, z: -1700 },
  { x: 1300, z: -1000 },
  { x: 1100, z: -200 },
  { x: 300, z: 300 },
  { x: -600, z: 500 },
  { x: -1400, z: 1200 },
]
/** 路面寬，m */
export const ROAD_WIDTH = 8
/** 公路中線兩側不長樹的半寬，m */
export const ROAD_TREE_CLEAR = 15
/** 美軍灘頭的集結區：公路起點 */
export const BEACHHEAD = LEYTE_ROAD[0]!
/** 前線：公路終點。卡車走到這裡就算抵達 */
export const FRONT_LINE = LEYTE_ROAD[LEYTE_ROAD.length - 1]!
/**
 * 撤離點的世界 z（x = 0）。Ki-84 從這一側進場，也從這一側撤離。
 * 離車隊區約九到十公里。**起始值，由試飛裁定。**
 */
export const EVACUATE_Z = 9000

/**
 * 灘頭與前線的固定防空砲位，世界座標。**不動、會開火**，照陸上砲位的規格
 * （`world/shipGuns.ts`）。全部在平地上、離公路中線至少 40 m（`leyte.test.ts`）。
 *
 * 【灘頭重、前線輕】灘頭是卸貨點，三座重高砲（美軍的 90 mm，雷達射控）加兩座
 * 輕砲；前線兩座輕砲。重高砲的射控在任務卡上複寫（`MissionBattle.flakSpec`）。
 * **座數與位置是起始值，由試飛裁定。**
 */
export const LEYTE_FLAK_SITES: readonly {
  readonly unit: 'flakLight' | 'flakHeavy'; readonly x: number; readonly z: number
}[] = [
  { unit: 'flakLight', x: 2753, z: -3031 },
  { unit: 'flakLight', x: 2597, z: -3156 },
  { unit: 'flakHeavy', x: 2519, z: -2706 },
  { unit: 'flakHeavy', x: 2900, z: -2900 },
  { unit: 'flakHeavy', x: 2300, z: -2900 },
  { unit: 'flakLight', x: -1228, z: 1169 },
  { unit: 'flakLight', x: -1346, z: 1033 },
]

/** 這一點到公路中線的最短距離，m */
export function distanceToRoad(x: number, z: number): number {
  let best = Infinity
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
    if (d < best) best = d
  }
  return best
}

/**
 * 手擺的小山丘。全部在陸上、膨脹圓離公路至少 400 m（`leyte.test.ts` 守著）。
 * 瓣的形狀用 `drawHillLobes` 依種子抽，與洛伊納、阿什同一套。
 */
export const LEYTE_HILLS = [
  { cx: -5000, cz: -1500, radius: 700, peak: 110, pa: 0.9, pb: 3.4, seed: 401 },
  { cx: -3500, cz: 3500, radius: 800, peak: 140, pa: 2.1, pb: 4.6, seed: 402 },
  { cx: 3000, cz: 2500, radius: 700, peak: 120, pa: 3.0, pb: 1.2, seed: 403 },
  { cx: 5500, cz: -1000, radius: 600, peak: 90, pa: 1.4, pb: 5.3, seed: 404 },
  { cx: -6500, cz: 6500, radius: 900, peak: 150, pa: 4.2, pb: 0.6, seed: 405 },
  { cx: 4000, cz: 7500, radius: 800, peak: 130, pa: 5.1, pb: 2.8, seed: 406 },
  { cx: -2500, cz: 9500, radius: 700, peak: 120, pa: 0.3, pb: 4.0, seed: 407 },
] as const

export function createLeyte(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(LEYTE_SIZE, LEYTE_CELL)
  const hills: IslandDesc[] = []
  for (const h of LEYTE_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(LEYTE_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  bakeRelief(field, hills, SEA_FLOOR)
  const { size, cell, data } = field
  const half = (size - 1) / 2
  for (let row = 0; row < size; row++) {
    const z = (row - half) * cell
    for (let col = 0; col < size; col++) {
      const x = (col - half) * cell
      const i = row * size + col
      const b = baseHeight(x, z)
      if (b > data[i]!) data[i] = b
    }
  }
  return { field, hills }
}
