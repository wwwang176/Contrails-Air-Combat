import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'

/**
 * # 波爾塔瓦：德 M2 專用的地形
 *
 * 烏克蘭中部的草原：幾乎全平，遠處幾顆極緩的丘。機場是一片草地墊面，
 * 跑道與停機坪鋪穿孔鋼板（著色器的鋪面矩形），停放的 B-17 排在東端的
 * 停機坪上。**整張圖的佈局都在這個檔案**，卡片與佈景引用這裡的常數。
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

/** 墊面：1.8 × 1.2 km 的草地，內部高度保證 0 */
export const FIELD_PAD = { halfX: 900, halfZ: 600 } as const
/** 墊面外一圈不長樹；機場周邊本來就是空曠的草原 */
export const FIELD_TREE_CLEAR = 300

/** 草地墊面的顏色。跑道與停機坪另外鋪鋼板色 */
export const PAD_GRASS = 0x55663f
/** 穿孔鋼板的顏色：深灰帶一點鏽 */
export const PSP_STEEL = 0x4a4a46

/** 跑道：東西向 1,500 × 60 m，機場局部座標 */
export const RUNWAY = { x0: -750, z0: -30, x1: 750, z1: 30 } as const
/** 停機坪：機場東端、跑道南側，500 × 300 m */
export const APRON = { x0: 350, z0: 60, x1: 850, z1: 360 } as const

/**
 * 停放的 B-17：3 排 × 8 架，翼尖距 36 m（翼展 31.6）、排距 100 m，機首朝南
 * （+Z，朝來襲方向）。全部在停機坪內 —— 史實就是翼尖對翼尖排整齊。
 */
export const PARKED_ROWS: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ (() => {
    const out: { x: number; z: number; heading: number }[] = []
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 8; k++) {
        out.push({ ...at(396 + k * 36, 110 + r * 100), heading: Math.PI })
      }
    }
    return out
  })()

/** 油桶堆兩塊在西北角、彈藥堆一塊在東南角。全部在墊面內、避開跑道與停機坪 */
export const DUMPS: readonly { kind: 'fuelDump' | 'bombDump'; x: number; z: number; heading: number }[] = [
  { kind: 'fuelDump', ...at(-700, -450), heading: 0 },
  { kind: 'fuelDump', ...at(-640, -450), heading: 0 },
  { kind: 'bombDump', ...at(700, 500), heading: 0 },
]

/**
 * 輕型防空砲 16 座：內圈 8 座手擺在墊面內（避開跑道與停機坪），外圈 8 座
 * 1,300 m 一圈。史實的蘇軍防空是多而輕。**座數由試玩裁定**
 */
export const LIGHT_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: -500, dz: -450 }, { dx: 0, dz: -480 }, { dx: 500, dz: -450 },
    { dx: -800, dz: -150 }, { dx: -800, dz: 200 }, { dx: 800, dz: -200 },
    { dx: -450, dz: 450 }, { dx: 150, dz: 480 },
    { dx: 1300, dz: 0 }, { dx: 919, dz: 919 }, { dx: 0, dz: 1300 }, { dx: -919, dz: 919 },
    { dx: -1300, dz: 0 }, { dx: -919, dz: -919 }, { dx: 0, dz: -1300 }, { dx: 919, dz: -919 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 重高砲 6 座，2 km 一圈 —— 投彈高度也不安全 */
export const HEAVY_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: 2000, dz: 0 }, { dx: 1000, dz: 1732 }, { dx: -1000, dz: 1732 },
    { dx: -2000, dz: 0 }, { dx: -1000, dz: -1732 }, { dx: 1000, dz: -1732 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 探照燈 6 座，950 m 一圈，與內圈砲位錯開 */
export const SEARCHLIGHT_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: 950, dz: 0 }, { dx: 475, dz: 823 }, { dx: -475, dz: 823 },
    { dx: -950, dz: 0 }, { dx: -475, dz: -823 }, { dx: 475, dz: -823 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: 0 }))

/**
 * 照明彈的位置清單，**散在機場四周而不是排成一線**。
 *
 * 同時亮 `FLARE_LANES`（3）枚、一枚一盞燈：前三個先點（照明機斜切機場，
 * 7 秒一枚），之後哪一枚熄了就在清單的下一個位置點新的，走完從頭。所以
 * **同時亮著的永遠是清單裡相鄰的三個** —— 清單照西、中、東輪流排，任三個
 * 相鄰的就各佔一區、彼此至少 800 m；南北與高度各不相同，地上每一處的光照
 * 角度才不一樣。後面幾個的 `delay` 用不到，填 0。
 */
export const FLARE_DROPS: readonly { x: number; z: number; altitude: number; delay: number }[] =
  /* @__PURE__ */ ([
    { dx: -800, dz: -350, altitude: 1400, delay: 0 },
    { dx: 0, dz: 300, altitude: 1050, delay: 7 },
    { dx: 800, dz: -300, altitude: 1250, delay: 14 },
    { dx: -800, dz: 250, altitude: 1150, delay: 0 },
    { dx: 0, dz: -500, altitude: 1350, delay: 0 },
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
  [at(-200, -600), { x: -200, z: -9000 }, { x: -200, z: -14500 }],
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
