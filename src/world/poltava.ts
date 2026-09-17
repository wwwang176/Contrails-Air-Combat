import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'

/**
 * # 波爾塔瓦：德 M2 專用的地形
 *
 * 烏克蘭中部的草原：幾乎全平，遠處幾顆極緩的丘。機場是一片草地墊面，
 * 跑道、滑行道、分散停機位鋪淺色水泥（著色器的鋪面矩形），停放的 B-17
 * 分三群在停機位與滑行道旁。**整張圖的佈局都在這個檔案**，卡片與佈景引用
 * 這裡的常數。
 *
 * 【跑道東西向、不轉】藍隊從南邊（+Z）來、橫切跑道。機場局部座標就是世界
 * 座標減去 `FIELD_CENTER` —— 沒有旋轉，`SiteLayout` 也不給 `heading`。
 */

/** 機場中心。藍隊開局 z ≈ +5,000 朝 −Z，進場 12 km */
export const FIELD_CENTER = /* @__PURE__ */ new Vector3(0, 0, -7000)

/** 機場局部 → 世界。表格常數用 */
function at(dx: number, dz: number): { x: number; z: number } {
  return { x: FIELD_CENTER.x + dx, z: FIELD_CENTER.z + dz }
}

/** 世界 → 機場局部。護欄與佈景的測試讀它 */
export function worldToField(x: number, z: number, out: { x: number; z: number }): void {
  out.x = x - FIELD_CENTER.x
  out.z = z - FIELD_CENTER.z
}

/** 軸對齊的矩形，機場局部座標 */
export interface FieldRect { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }

/**
 * 墊面：草地，內部高度保證 0。**貼著鋪面走，不是一個大矩形** —— 主體是
 * 跑道加滑行道那一條帶子，每一組魚骨各自一塊（`FIELD_LOBES`），著色器取
 * 聯集；每一塊再外推 180 m 的裙邊（`fields.ts` 的 `PAD_SKIRT`）。機場局部
 * 座標。
 */
export const FIELD_PAD: FieldRect = { x0: -1270, z0: -50, x1: 1270, z1: 312 }
/** 附加的墊面：西北魚骨一塊、東南兩組魚骨一塊。**都與主墊面相接**，支線才不會跨過一條草縫 */
export const FIELD_LOBES: readonly FieldRect[] = [
  { x0: -1010, z0: -420, x1: -766, z1: -30 },
  { x0: 590, z0: 300, x1: 1200, z1: 650 },
]
/** 主墊面與附加墊面的外接矩形。護欄、佈景、圍籬用 */
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
/** 墊面外一圈不長樹；機場周邊本來就是空曠的草原 */
export const FIELD_TREE_CLEAR = 300

/** 草地墊面的顏色。鋪面另外鋪水泥色 */
export const PAD_GRASS = 0x55663f
/** 跑道、滑行道、停機位的淺色水泥 */
export const RUNWAY_CONCRETE = 0x9a9890

/**
 * 鋪面照今天的波爾塔瓦空軍基地排：一條東西向的主跑道，南側一條平行滑行道，
 * 兩端與中段各一條聯絡道，西北與東南各一條枝狀的分散停機位支線。
 */
/** 主跑道：東西向 2,500 × 60 m */
export const RUNWAY: FieldRect = { x0: -1250, z0: -30, x1: 1250, z1: 30 }
/** 平行滑行道：跑道南側 270 m，25 m 寬 */
export const TAXIWAY: FieldRect = { x0: -1250, z0: 268, x1: 1250, z1: 292 }
/** 聯絡道與兩條分散支線 */
export const TAXI_LINKS: readonly FieldRect[] = [
  { x0: -1250, z0: 30, x1: -1226, z1: 268 },
  { x0: -12, z0: 30, x1: 12, z1: 268 },
  { x0: 1226, z0: 30, x1: 1250, z1: 268 },
  // 西北支線：從跑道西段往北
  { x0: -900, z0: -400, x1: -876, z1: -30 },
  // 東南兩條支線：從滑行道東段往南
  { x0: 700, z0: 292, x1: 724, z1: 640 },
  { x0: 1000, z0: 292, x1: 1024, z1: 640 },
]

/**
 * 停機位：**每一個都從路邊伸出一條窄巷，末端才是停機坪** —— 魚骨狀，
 * 越往外越窄，沒有孤島。三組魚骨：西北一條支線、東南兩條支線，每一條
 * 兩側各四個，機首朝支線。
 *
 * `dx`／`dz` 是飛機的位置；巷從 `from`（路的邊緣）伸到停機坪，停機坪以
 * 飛機為中心。
 */
/** 停機坪的半邊，m：40 m 見方，翼展 31.6 的 B-17 剛好停得下 */
const PAD_HALF = 20
/** 窄巷的半寬，m */
const LANE_HALF = 6
interface Stand {
  readonly dx: number
  readonly dz: number
  /** 巷沿哪一軸伸出去、從路邊的哪一個座標開始 */
  readonly axis: 'x' | 'z'
  readonly from: number
  readonly heading: number
}
const STANDS: readonly Stand[] = /* @__PURE__ */ (() => {
  const out: Stand[] = []
  // 西北支線 x −900…−876：西側的飛機機首朝東（−π/2）、東側朝西（+π/2）。骨距 70 m
  for (const dz of [-100, -170, -240, -310]) {
    out.push({ dx: -970, dz, axis: 'x', from: -900, heading: -Math.PI / 2 })
    out.push({ dx: -806, dz, axis: 'x', from: -876, heading: Math.PI / 2 })
  }
  // 東南兩條支線 x 700…724、1000…1024
  for (const dz of [360, 430, 500, 570]) {
    out.push({ dx: 630, dz, axis: 'x', from: 700, heading: -Math.PI / 2 })
    out.push({ dx: 794, dz, axis: 'x', from: 724, heading: Math.PI / 2 })
    out.push({ dx: 930, dz, axis: 'x', from: 1000, heading: -Math.PI / 2 })
    out.push({ dx: 1094, dz, axis: 'x', from: 1024, heading: Math.PI / 2 })
  }
  return out
})()

/** 停機坪：飛機腳下那一塊 */
export const STAND_PADS: readonly FieldRect[] = /* @__PURE__ */ STANDS.map((s) => ({
  x0: s.dx - PAD_HALF, x1: s.dx + PAD_HALF, z0: s.dz - PAD_HALF, z1: s.dz + PAD_HALF,
}))

/** 窄巷：從路邊到停機坪 */
export const STAND_LANES: readonly FieldRect[] = /* @__PURE__ */ STANDS.map((s) => (s.axis === 'x'
  ? {
    x0: Math.min(s.from, s.dx), x1: Math.max(s.from, s.dx),
    z0: s.dz - LANE_HALF, z1: s.dz + LANE_HALF,
  }
  : {
    x0: s.dx - LANE_HALF, x1: s.dx + LANE_HALF,
    z0: Math.min(s.from, s.dz), z1: Math.max(s.from, s.dz),
  }))

/** 停機位的全部鋪面：巷與坪 */
export const HARDSTANDS: readonly FieldRect[] = /* @__PURE__ */ [...STAND_LANES, ...STAND_PADS]

/** 全部的鋪面。著色器鋪水泥色、佈景與砲位避開它們 */
export const PAVED: readonly FieldRect[] = /* @__PURE__ */ [RUNWAY, TAXIWAY, ...TAXI_LINKS, ...HARDSTANDS]

/** 停放的 B-17：24 架，各在自己的停機位末端 */
export const PARKED_ROWS: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ STANDS.map((s) => ({ ...at(s.dx, s.dz), heading: s.heading }))

/** 油桶堆兩塊在跑道與滑行道之間的西端、彈藥堆在東南魚骨的東邊。全部在墊面內、避開鋪面 */
export const DUMPS: readonly { kind: 'fuelDump' | 'bombDump'; x: number; z: number; heading: number }[] = [
  { kind: 'fuelDump', ...at(-1150, 150), heading: 0 },
  { kind: 'fuelDump', ...at(-1090, 150), heading: 0 },
  { kind: 'bombDump', ...at(1160, 500), heading: 0 },
]

/**
 * 輕型防空砲 16 座：內圈 8 座手擺在墊面內（避開鋪面與停機位），外圈 8 座
 * 1,300 m 一圈。史實的蘇軍防空是多而輕。**座數由試玩裁定**
 */
export const LIGHT_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: -500, dz: -450 }, { dx: 0, dz: -480 }, { dx: 500, dz: -450 },
    { dx: -700, dz: -150 }, { dx: -800, dz: 200 }, { dx: 800, dz: -200 },
    { dx: -450, dz: 450 }, { dx: 150, dz: 480 },
    { dx: 1300, dz: 0 }, { dx: 919, dz: 919 }, { dx: 0, dz: 1300 }, { dx: -919, dz: 919 },
    { dx: -1300, dz: 0 }, { dx: -919, dz: -919 }, { dx: 0, dz: -1300 }, { dx: 919, dz: -919 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 重高砲 6 座，2.3 km 一圈 —— 投彈高度也不安全 */
export const HEAVY_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: 2300, dz: 0 }, { dx: 1150, dz: 1992 }, { dx: -1150, dz: 1992 },
    { dx: -2300, dz: 0 }, { dx: -1150, dz: -1992 }, { dx: 1150, dz: -1992 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 探照燈 6 座，環繞機場約 1 km，避開跑道與支線 */
export const SEARCHLIGHT_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: 950, dz: -150 }, { dx: 475, dz: 823 }, { dx: -475, dz: 823 },
    { dx: -1100, dz: 150 }, { dx: -475, dz: -823 }, { dx: 475, dz: -823 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: 0 }))

/**
 * 照明彈的位置清單，**散在機場四周而不是排成一線**。
 *
 * 同時亮 `FLARE_LANES`（2）枚、一枚一盞燈：前兩個先點（照明機斜切機場，
 * 7 秒一枚），之後哪一枚熄了就在清單的下一個位置點新的，走完從頭。所以
 * **同時亮著的永遠是清單裡相鄰的兩個** —— 清單照西、中、東輪流排，任兩個
 * 相鄰的就各在不同區、彼此至少 800 m；南北與高度各不相同，地上每一處的光照
 * 角度才不一樣。第三個之後的 `delay` 用不到。
 */
export const FLARE_DROPS: readonly { x: number; z: number; altitude: number; delay: number }[] =
  /* @__PURE__ */ ([
    { dx: -800, dz: -350, altitude: 1400, delay: 0 },
    { dx: 0, dz: 300, altitude: 1050, delay: 7 },
    { dx: 800, dz: -300, altitude: 1250, delay: 0 },
    { dx: -800, dz: 250, altitude: 1150, delay: 0 },
    { dx: 0, dz: -380, altitude: 1350, delay: 0 },
    { dx: 800, dz: 450, altitude: 1100, delay: 0 },
    { dx: -800, dz: -100, altitude: 1300, delay: 0 },
    { dx: 0, dz: 50, altitude: 1200, delay: 0 },
    { dx: 800, dz: 100, altitude: 1000, delay: 0 },
  ] as const).map((p) => ({ ...at(p.dx, p.dz), altitude: p.altitude, delay: p.delay }))

/**
 * 手擺的丘陵：極緩，全在 3 km 外。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`
 * —— 外緣加上中心距離要在 `HILL_LIMIT`（14,000）內。
 */
export const POLTAVA_HILLS = [
  { cx: -6000, cz: -9000, radius: 900, peak: 35, pa: 0.4, pb: 2.9, seed: 201 },
  { cx: 7000, cz: -10500, radius: 1000, peak: 40, pa: 1.7, pb: 4.1, seed: 202 },
  { cx: -8000, cz: -3000, radius: 800, peak: 30, pa: 3.3, pb: 0.8, seed: 203 },
  { cx: 6500, cz: -2500, radius: 900, peak: 35, pa: 2.2, pb: 5.0, seed: 204 },
] as const

/** 連外道路往北出圖；鐵路東西向橫過機場南邊 —— 波爾塔瓦是鐵路樞紐 */
export const ROAD_WIDTH = 10
export const ROADS: readonly (readonly { x: number; z: number }[])[] = [
  [at(-200, FIELD_PAD.z0), { x: -200, z: -9000 }, { x: -200, z: -14500 }],
]
export const RAIL_WIDTH = 26
export const RAILS: readonly (readonly { x: number; z: number }[])[] = [
  [{ x: -14500, z: -5400 }, { x: 14500, z: -5400 }],
]

export function createPoltava(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of POLTAVA_HILLS) {
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
