import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'
import type { TakeoffLine, TaxiPoint } from '../control/takeoffRoll'
import type { CrateField, ParkedVehicle } from './depot'

/**
 * # Y-29（比利時 Asch）：德 M3 專用的地形
 *
 * Kempen 高原的荒地：平、遠處幾顆極緩的丘。Y-29 是前進降落場（ALG），不是
 * 水泥機場 —— 一條鋼板網（PSP）跑道鋪在草地上，跑道一側一圈環狀滑行帶，
 * 滑行帶外側是一架一格的分散停機墊。跑道東側是作業區（營房、補給堆、車場），
 * 南端是營區。**整張圖的佈局都在這個檔案**，卡片與佈景引用這裡的常數。
 *
 * 【跑道南北向、不轉】藍隊從東邊朝西進場（`battle/entry.ts` 的 `ASCH_EAST`），
 * 橫切跑道與停機線：一趟只掃得到一兩架，要轉回來再打。機場局部座標是世界
 * 座標減去 `FIELD_CENTER`，沒有旋轉。
 */

/**
 * 機場中心。`ASCH_EAST` 把藍隊放在它正東 7.5 km、同一個 z；7.5 km 的進場在
 * 200 m/s 下約 37 秒。**搬動它要一起改 `ASCH_EAST`**，否則玩家會從機場旁邊飛過
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
/**
 * 附加的墊面：跑道東側的作業區、南端的營區。**都與主墊面相接**。營房與車
 * 要落在墊面裡 —— 墊面外底下是田，而且會長樹
 */
export const FIELD_LOBES: readonly FieldRect[] = [
  { x0: 70, z0: -760, x1: 400, z1: 760 },
  { x0: -340, z0: 760, x1: 70, z1: 1020 },
]
/** 主墊面與附加墊面的外接矩形。護欄、佈景用 */
export const FIELD_BOUNDS: FieldRect = /* @__PURE__ */ [FIELD_PAD, ...FIELD_LOBES].reduce((b, r) => ({
  x0: Math.min(b.x0, r.x0), z0: Math.min(b.z0, r.z0), x1: Math.max(b.x1, r.x1), z1: Math.max(b.z1, r.z1),
}))

/** 這一點在墊面（主體或任何一塊附加）的矩形裡；不含裙邊 */
export function inField(dx: number, dz: number): boolean {
  for (const r of [FIELD_PAD, ...FIELD_LOBES]) {
    if (dx >= r.x0 && dx <= r.x1 && dz >= r.z0 && dz <= r.z1) return true
  }
  return false
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
 * 起飛點在跑道中線上的局部 z：滑行帶南段接口（647.5）北邊一點點。
 *
 * 【滑上跑道就起飛】**四架共用這一點**，不各自再往北排隊 —— 排隊要多滑一百
 * 多公尺，畫面上是「滑到前面的停等區才起飛」。前後間隔由抵達時間拉開
 * （`TAKEOFF_ROLL_GAP`）。往北還有 1,347 m，滾行只要約 300 m。
 */
const LINE_Z = 640

/**
 * 起飛線：跑道南段的中線，機首朝北（−Z）。停機墊上的 P-51 沿 `taxiRoute` 滑上
 * 跑道就開始滾行；滾行加上初期爬升約 500 m，交還時還在跑道上空。
 */
export const TAKEOFF_LINE: TakeoffLine = /* @__PURE__ */ { ...at(0, LINE_Z), heading: 0, route: taxiRoute }

/**
 * 從停在 (x, z) 的那一格滑到跑道上的起飛點，世界座標的折線：
 *
 * ```
 *   停機墊中心 → 沿窄巷往東到滑行帶西段中線 → 沿西段往南到南段中線
 *   → 沿南段往東到跑道中線 → 轉北，走到起飛點
 * ```
 *
 * 【`slot` 不影響終點】四架滑到同一個起飛點，先到先滾行。
 *
 * 【停機墊一定在西段外側、窄巷與它同一個 z】`STANDS` 就是這樣排的。每一段都
 * 走在鋪面的中線上，護欄在 `asch.test.ts` 逐公尺檢查。
 */
export function taxiRoute(x: number, z: number, _slot: number): readonly TaxiPoint[] {
  const lz = z - FIELD_CENTER.z
  const leg = TAXI_LOOP[1]!
  const south = TAXI_LOOP[2]!
  const legX = (leg.x0 + leg.x1) / 2
  const southZ = (south.z0 + south.z1) / 2
  const runX = (RUNWAY.x0 + RUNWAY.x1) / 2
  return [
    { x, z },
    at(legX, lz),
    at(legX, southZ),
    at(runX, southZ),
    at(runX, LINE_Z),
  ]
}

/** 油桶堆兩塊，在滑行帶環內、離跑道與滑行帶各約 90 m */
export const DUMPS: readonly { kind: 'fuelDump'; x: number; z: number; heading: number }[] = [
  { kind: 'fuelDump', ...at(-110, -300), heading: 0 },
  { kind: 'fuelDump', ...at(-110, 300), heading: 0 },
]

/**
 * 防空砲 12 座，美軍的 M16 半履帶車（四聯 .50）：滑行帶環內三座、停機線外側
 * 三座、東側作業區三座、跑道兩端外各一座、營區外一座。**座數由試玩裁定**
 */
export const FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: -110, dz: -500 }, { dx: -110, dz: 0 }, { dx: -110, dz: 500 },
    { dx: -450, dz: -600 }, { dx: -450, dz: 0 }, { dx: -450, dz: 600 },
    { dx: 200, dz: 0 }, { dx: 380, dz: -650 }, { dx: 380, dz: 650 },
    { dx: 0, dz: -1000 }, { dx: 100, dz: 1080 }, { dx: -460, dz: 900 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

// ── 營區與作業區的佈景：營房、補給堆、停著的車 ──────────────────

/**
 * 一棟木造營房，世界座標。形狀是村裡那一種建築（`render/floraShapes.ts`），
 * `length` 是屋脊方向的長度、`width` 是山牆那一邊，m。`heading` 0 = 屋脊沿 z、
 * π/2 = 屋脊沿 x
 */
export interface Hut {
  readonly x: number; readonly z: number; readonly heading: number
  readonly length: number; readonly width: number
}

/**
 * 營房：南端營區 5 排 × 8 棟，屋脊東西向；跑道東側作業區兩排各 8 棟，屋脊
 * 順著跑道。
 */
export const HUTS: readonly Hut[] = /* @__PURE__ */ (() => {
  const out: Hut[] = []
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 8; i++) {
      out.push({ ...at(-300 + 30 * i, 820 + 30 * row), heading: Math.PI / 2, length: 20, width: 7 })
    }
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      out.push({ ...at(140, side * (340 + 40 * i)), heading: 0, length: 24, width: 8 })
    }
  }
  return out
})()

/**
 * 補給堆（`world/depot.ts`）：東側作業區四堆、營區一堆。**不是目標**，油桶堆
 * （`DUMPS`）才是
 */
export const CRATE_FIELDS: readonly CrateField[] = /* @__PURE__ */ ([
  { dx: 290, dz: -450, width: 36, depth: 30 },
  { dx: 290, dz: -200, width: 40, depth: 28 },
  { dx: 290, dz: 200, width: 40, depth: 28 },
  { dx: 290, dz: 450, width: 36, depth: 30 },
  { dx: 10, dz: 900, width: 30, depth: 40 },
] as const).map((d, i) => ({ ...at(d.dx, d.dz), heading: 0, width: d.width, depth: d.depth, lane: 0, seed: 2901 + i }))

/**
 * 停著的車，**佈景、打不掉**：
 *
 * - 東側車場：三排、每排九台，車頭朝西，第一排夾著 M16
 * - 東側每一堆補給兩旁各一台卡車
 * - 營區南緣一排卡車
 * - 停機線外側每隔一格一台油罐車，車頭朝北
 */
export const VEHICLES: readonly ParkedVehicle[] = /* @__PURE__ */ (() => {
  const out: ParkedVehicle[] = []
  const west = Math.PI / 2
  for (const [x, row] of [
    [270, ['usFlakTrack', 'usTruck', 'usTruck', 'usFlakTrack', 'usTruck', 'usFlakTrack', 'usTruck', 'usTruck', 'usFlakTrack']],
    [290, Array<'usTruck'>(9).fill('usTruck')],
    [310, Array<'usTruck'>(9).fill('usTruck')],
  ] as const) {
    row.forEach((unit, i) => out.push({ unit, ...at(x, -36 + 9 * i), heading: west }))
  }
  for (const d of CRATE_FIELDS.slice(0, 4)) {
    for (const side of [-1, 1]) out.push({ unit: 'usTruck', x: d.x + side * 30, z: d.z, heading: 0 })
  }
  for (let i = 0; i < 10; i++) out.push({ unit: 'usTruck', ...at(-290 + 20 * i, 985), heading: west })
  for (let i = 0; i < STAND_ZS.length; i += 2) out.push({ unit: 'usTruck', ...at(-318, STAND_ZS[i]!), heading: 0 })
  return out
})()

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
