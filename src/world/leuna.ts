import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import {
  bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc, type LobeDraw,
} from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'

/**
 * # 洛伊納：盟 M2 專用的地形
 *
 * 薩勒河平原：大片平地、零星的緩丘，西邊幾顆較高的是蓋澤爾谷的露天礦區
 * 土堆。用農地那一套多瓣起伏與高度場（`makeLobes` / `bakeRelief`），但
 * **丘陵全部手擺，不撒隨機** —— 出生線、廠區、砲位、脫離方向的空間關係
 * 是關卡設計的一部分，程序化撒的丘陵沒有人在乎廠區落在哪。
 *
 * 【整張圖的佈局都在這個檔案】卡片（`battle/missions.ts`）、佈景
 * （`render/geometry/ground/plantScenery.ts`）與地面著色器的墊面與道路
 * （`render/fields.ts`）都引用這裡的常數，不自己寫座標。
 *
 * 【農地的參數一改廠區不會埋進山裡】農地生成器同時被德 M4 與遭遇戰用；
 * 這張圖不共用它的丘陵清單，只共用生成的機制。
 */

/** 廠區中心。藍隊開局在 z ≈ +5,000 朝 −Z（`headOn`），投彈航路 12 km */
export const PLANT_CENTER = /* @__PURE__ */ new Vector3(0, 0, -7000)
export const PLANT_HEADING = 0

/**
 * 墊面矩形的半邊長，m。墊面內保證高度為 0。
 *
 * 【3 × 1.5 km 是史實的佔地】洛伊納是一整片化工廠，不是一座建築。廠區
 * 裡大部分是佈景（管架、鋼骨塔、棚屋），可炸的只有十二座構件。
 */
export const PLANT_PAD = { halfX: 1500, halfZ: 750 } as const

/**
 * 丘陵的膨脹圓離墊面矩形至少這麼遠，m。
 *
 * 【為什麼是距離不是壓平】`bakeRelief` 只掃膨脹圓內，圓外回到 `floor = 0`；
 * 圓離墊面有距離，墊面就在**結構上**是 0。壓平運算是多的，而且會遮掉
 * 「丘陵擺錯」這個錯 —— 護欄量的是這個距離，不是只量墊面內的高度。
 */
export const PAD_CLEARANCE = 400

/** 脫離方向：投完繼續往 −Z 飛，不回頭 —— 那是史實的脫離 */
export const EGRESS = /* @__PURE__ */ new Vector3(0, 0, -1)

/**
 * 手擺的丘陵。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`，清單不寫 ——
 * `makeLobes` 信任呼叫端給的值，寫錯的話墊面保證就沒了而且不報錯。
 *
 * 【瓣由各自的種子抽】與群島的錨島同一個做法：改一顆不會動到別顆的形狀。
 */
export const LEUNA_HILLS = [
  // 西側：礦區土堆，較高
  { cx: -9000, cz: -8500, radius: 1200, peak: 110, pa: 0.4, pb: 2.9, seed: 101 },
  { cx: -11500, cz: -4500, radius: 1100, peak: 95, pa: 1.7, pb: 4.1, seed: 102 },
  { cx: -8500, cz: -1500, radius: 900, peak: 70, pa: 3.3, pb: 0.8, seed: 103 },
  // 平原上的緩丘
  { cx: 6000, cz: -10500, radius: 1000, peak: 60, pa: 2.2, pb: 5.0, seed: 104 },
  { cx: 9500, cz: -6000, radius: 1300, peak: 80, pa: 0.9, pb: 3.6, seed: 105 },
  { cx: 4500, cz: -2500, radius: 800, peak: 45, pa: 4.4, pb: 1.3, seed: 106 },
  { cx: -3500, cz: 3500, radius: 900, peak: 55, pa: 5.1, pb: 2.4, seed: 107 },
  { cx: 3000, cz: 8500, radius: 1100, peak: 65, pa: 1.1, pb: 4.8, seed: 108 },
  { cx: -7500, cz: 9000, radius: 1000, peak: 75, pa: 2.8, pb: 0.3, seed: 109 },
  { cx: 8500, cz: 3000, radius: 900, peak: 50, pa: 3.9, pb: 1.9, seed: 110 },
] as const

/**
 * 預定砲位。**是不還手的靶**：打得掉、算進炸毀的計數，但不瞄不射。
 * 環繞廠區 2.4 到 3.2 km，全部在墊面外。
 */
export const FLAK_SITES: readonly { x: number; z: number; heading: number }[] = [
  { x: -2600, z: -8200, heading: 0.6 },
  { x: 2600, z: -8200, heading: -0.6 },
  { x: -3000, z: -7000, heading: 1.5 },
  { x: 3000, z: -7000, heading: -1.5 },
  { x: -2600, z: -5800, heading: 2.5 },
  { x: 2600, z: -5800, heading: -2.5 },
  { x: 0, z: -9700, heading: 0 },
  { x: 0, z: -4300, heading: Math.PI },
]

/** 構件的種類。與 `groundTargets.ts` 的 `GroundKind` 相同的字面值 */
export type PlantKind =
  | 'hydroTower' | 'chimney' | 'boilerHouse' | 'oilTank' | 'gasHolder' | 'coolingTower'

/**
 * 十二座可炸的構件相對廠區中心的偏移與朝向。分成三個叢：西側氫化區
 * （反應塔成排、煙囪、鍋爐房）、中央動力區（鍋爐房、煙囪、冷卻塔、氣櫃）、
 * 東側油槽區（儲油槽成群）。全部在墊面內，離墊面邊至少 40 m。
 */
export const PLANT_LAYOUT: readonly { kind: PlantKind; dx: number; dz: number; heading: number }[] = [
  // 西側氫化區
  { kind: 'hydroTower', dx: -1000, dz: -250, heading: 0 },
  { kind: 'hydroTower', dx: -920, dz: -250, heading: 0 },
  { kind: 'hydroTower', dx: -840, dz: -250, heading: 0 },
  { kind: 'chimney', dx: -650, dz: -380, heading: 0 },
  { kind: 'boilerHouse', dx: -700, dz: -120, heading: 0 },
  // 中央動力區
  { kind: 'boilerHouse', dx: 0, dz: -320, heading: 0 },
  { kind: 'chimney', dx: 160, dz: -470, heading: 0 },
  { kind: 'coolingTower', dx: 260, dz: 220, heading: 0 },
  { kind: 'gasHolder', dx: -360, dz: 320, heading: 0 },
  // 東側油槽區
  { kind: 'oilTank', dx: 800, dz: 120, heading: 0 },
  { kind: 'oilTank', dx: 900, dz: 120, heading: 0 },
  { kind: 'oilTank', dx: 850, dz: 220, heading: 0 },
]

/** 停在廠區與道路上的卡車。是地面目標，打得掉 */
export const TRUCKS: readonly { x: number; z: number; heading: number }[] = [
  { x: -560, z: -7040, heading: 1.57 },
  { x: -540, z: -7060, heading: 1.57 },
  { x: 120, z: -6980, heading: -1.57 },
  { x: 540, z: -6700, heading: 0.1 },
  { x: 560, z: -6540, heading: 0 },
  { x: 1180, z: -7020, heading: 1.5 },
  { x: 520, z: -5200, heading: 0.05 },
  { x: -2400, z: -6980, heading: 1.6 },
]

/**
 * 道路的折線，世界座標。畫在地面著色器裡（`fields.ts` 的 `SiteLayout`），
 * 不是幾何。
 *
 * 廠內一條東西向的主軸（`dz = 0`）與兩條南北向的橫向；連外的兩條：南門到
 * 地圖南緣（開場的航路正上方）、西門到西緣。
 */
export const ROAD_WIDTH = 12
export const ROADS: readonly (readonly { x: number; z: number }[])[] = [
  // 廠內主軸
  [{ x: -1500, z: -7000 }, { x: 1500, z: -7000 }],
  // 廠內橫向
  [{ x: -600, z: -7750 }, { x: -600, z: -6250 }],
  [{ x: 500, z: -7750 }, { x: 500, z: -6250 }],
  // 南門到地圖南緣
  [{ x: 500, z: -6250 }, { x: 500, z: -3000 }, { x: 900, z: 2000 }, { x: 900, z: 14500 }],
  // 西門到地圖西緣
  [{ x: -1500, z: -7000 }, { x: -6000, z: -7000 }, { x: -7200, z: -6200 }, { x: -14500, z: -6200 }],
]

/**
 * 佈景的擺法，相對廠區中心。**純佈景**：一顆合併網格，沒有命中盒、不算分。
 * 圓管是三角柱，其餘是盒子與柱體 —— 見 `render/geometry/ground/plantScenery.ts`。
 */
export const PLANT_SCENERY = {
  /** 管架的折線與架高。管子並排在樑上，走廠區的主軸與橫向 */
  pipeRacks: [
    { height: 8, pipes: 5, points: [{ dx: -1350, dz: -150 }, { dx: 1350, dz: -150 }] },
    { height: 6, pipes: 4, points: [{ dx: -1350, dz: 250 }, { dx: 700, dz: 250 }] },
    { height: 7, pipes: 3, points: [{ dx: -800, dz: -650 }, { dx: -800, dz: 650 }] },
    { height: 7, pipes: 3, points: [{ dx: -300, dz: -650 }, { dx: -300, dz: 650 }] },
    { height: 9, pipes: 4, points: [{ dx: 100, dz: -650 }, { dx: 100, dz: 650 }] },
    { height: 6, pipes: 3, points: [{ dx: 650, dz: -650 }, { dx: 650, dz: 650 }] },
    { height: 6, pipes: 2, points: [{ dx: 700, dz: 250 }, { dx: 1100, dz: 250 }, { dx: 1100, dz: 600 }] },
    { height: 8, pipes: 3, points: [{ dx: -1100, dz: -450 }, { dx: -450, dz: -450 }, { dx: -450, dz: -600 }] },
  ],
  /** 開放式鋼骨塔：底邊長、層數 */
  steelTowers: [
    { dx: -1150, dz: -450, size: 18, floors: 4 },
    { dx: -480, dz: -560, size: 22, floors: 5 },
    { dx: 40, dz: -600, size: 20, floors: 4 },
    { dx: 400, dz: -520, size: 16, floors: 3 },
    { dx: 1100, dz: -420, size: 18, floors: 4 },
    { dx: -1200, dz: 420, size: 16, floors: 3 },
    { dx: 420, dz: 480, size: 20, floors: 4 },
  ],
  /** 棚屋：小盒子加平頂 */
  sheds: [
    { dx: -1300, dz: 50 }, { dx: -1250, dz: 600 }, { dx: -950, dz: 500 }, { dx: -600, dz: 620 },
    { dx: -150, dz: 80 }, { dx: 250, dz: -60 }, { dx: 620, dz: -60 }, { dx: 950, dz: -300 },
    { dx: 1250, dz: 60 }, { dx: 1300, dz: 550 }, { dx: 1000, dz: 600 }, { dx: -100, dz: 620 },
  ],
  /** 圍牆：沿墊面四周，門口留空。每一段 60 m */
  wall: { height: 2.5, segment: 60, gate: 24 },
  /** 沙包：砲位周圍一圈 */
  sandbags: { radius: 6, count: 12 },
  /** 電線桿：沿連外道路 */
  poles: { spacing: 40, height: 8 },
} as const

/** 瓣的抽法與農地相同：固定 4 瓣，半徑比在 [0.30, 0.48] */
const HILL_LOBES = 4
const HILL_LOBE_RADIUS = [0.30, 0.48] as const

/** 種子進、序列出。**不得 `Math.random`** —— 與農地同一個理由 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function drawLobes(rand: () => number): LobeDraw[] {
  const out: LobeDraw[] = []
  for (let k = 0; k < HILL_LOBES; k++) {
    out.push({
      dir: rand() * Math.PI * 2,
      rf: HILL_LOBE_RADIUS[0] + rand() * (HILL_LOBE_RADIUS[1] - HILL_LOBE_RADIUS[0]),
      uOff: rand(),
      uPeak: rand(),
      pa: rand() * Math.PI * 2,
      pb: rand() * Math.PI * 2,
    })
  }
  return out
}

export function createLeuna(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of LEUNA_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawLobes(makeRand(h.seed))),
    })
  }
  // 基準面是 0：內陸沒有海
  bakeRelief(field, hills, 0)
  return { field, hills }
}
