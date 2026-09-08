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
 * 預定砲位。**這一版是不還手的靶**：打得掉、算進炸毀的計數，但不瞄不射。
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
  /** 圍牆：沿墊面四周，門口留空。每一段 60 m */
  wall: { height: 2.5, segment: 60, gate: 24 },
  /** 沙包：砲位周圍一圈 */
  sandbags: { radius: 6, count: 12 },
  /** 電線桿：沿連外道路 */
  poles: { spacing: 40, height: 8 },
} as const

/**
 * 巷道的中心線，相對廠區中心。`x` 是縱向（沿 Z 走）的巷、`z` 是橫向的。
 *
 * 【與廠內道路共線】−600、500（縱向）與 0（橫向）就是 `ROADS` 那三條廠內
 * 道路。格線另開一套的話，街廓會被道路從中間切開，填充器鋪的東西一半壓在
 * 路上。
 */
export const PLANT_LANES = {
  x: [-1100, -600, -180, 150, 500, 1000],
  z: [-420, 0, 380],
} as const

/** 巷道寬，m。街廓從格線各退一半 */
export const LANE_WIDTH = 16

/** 街廓的機能。填充器照這個標籤決定鋪什麼 */
export type BlockKind = 'process' | 'tankFarm' | 'halls' | 'railyard' | 'utility' | 'open'

/** 一個街廓。**世界座標**，已經退掉巷道 */
export interface PlantBlock {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
  readonly kind: BlockKind
  readonly seed: number
}

/**
 * 機能指派，7 欄 × 4 列，欄由西到東、列由北到南。
 * **與 `tools/blender/build_plant.py` 是同一份表**，那邊改了這邊要跟著改。
 *
 * 【同機能不相鄰】相鄰同機能會被 `mergePlan` 併成一塊，而併出來的大方塊
 * 從投彈高度看下去就是「那一整區都是油槽」。除了調車場那一對，任兩格的
 * 鄰居都是別的機能，所以最大的街廓就是一格。
 *
 * 【調車場例外，而且靠南緣】它得接得到外面的鐵路，擺在廠區中間不合理。
 * `open` 是刻意的留白 —— 沒有空地就看不出密的地方有多密。
 */
const BLOCK_KINDS: readonly (readonly BlockKind[])[] = [
  ['halls', 'process', 'utility', 'railyard'], //   x −1500…−1100
  ['process', 'tankFarm', 'process', 'railyard'], // x −1100…−600
  ['utility', 'process', 'halls', 'process'], //    x −600…−180
  ['tankFarm', 'utility', 'process', 'halls'], //   x −180…150
  ['process', 'tankFarm', 'utility', 'open'], //    x 150…500
  ['halls', 'process', 'tankFarm', 'railyard'], //  x 500…1000
  ['tankFarm', 'utility', 'process', 'open'], //    x 1000…1500
]

/**
 * 相鄰而且**機能相同**的兩格合併成一個大街廓。
 *
 * 【為什麼要合】六欄四列的格子等大又等距，從投彈高度看下去像二十四塊拼圖
 * —— 而真正的廠區是一整片儲槽區、一整條廠房排。只合同機能的兩格，機能的
 * 種類與配比因此不變。
 *
 * 【只合一次】連著合三格會出現橫跨整張圖的長條，那又是另一種一眼看得出來
 * 的規則。
 */
function mergePlan(cols: number, rows: number): number[] {
  // 每一格記自己屬於哪一個街廓；−1 表示還沒被別人吃掉
  const owner = new Array<number>(cols * rows).fill(-1)
  const at = (i: number, j: number): number => i * rows + j
  let h = 0x9e3779b9
  const roll = (): number => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0
    return h / 4294967296
  }
  for (let i = 0; i + 1 < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (owner[at(i, j)] !== -1 || owner[at(i + 1, j)] !== -1) continue
      if (BLOCK_KINDS[i]![j] !== BLOCK_KINDS[i + 1]![j]) continue
      if (roll() > 0.85) continue
      owner[at(i, j)] = at(i, j)
      owner[at(i + 1, j)] = at(i, j)
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j + 1 < rows; j++) {
      if (owner[at(i, j)] !== -1 || owner[at(i, j + 1)] !== -1) continue
      if (BLOCK_KINDS[i]![j] !== BLOCK_KINDS[i]![j + 1]) continue
      if (roll() > 0.8) continue
      owner[at(i, j)] = at(i, j)
      owner[at(i, j + 1)] = at(i, j)
    }
  }
  for (let k = 0; k < owner.length; k++) if (owner[k] === -1) owner[k] = k
  return owner
}

function buildBlocks(): PlantBlock[] {
  const xs = [-PLANT_PAD.halfX, ...PLANT_LANES.x, PLANT_PAD.halfX]
  const zs = [-PLANT_PAD.halfZ, ...PLANT_LANES.z, PLANT_PAD.halfZ]
  const cols = xs.length - 1
  const rows = zs.length - 1
  const owner = mergePlan(cols, rows)
  const out: PlantBlock[] = []
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // 只有「自己就是頭」的那一格生街廓；被吃掉的那一格跳過
      if (owner[i * rows + j] !== i * rows + j) continue
      let i1 = i
      let j1 = j
      for (let k = 0; k < cols * rows; k++) {
        const ci = Math.floor(k / rows)
        const cj = k % rows
        if (owner[k] !== i * rows + j) continue
        i1 = Math.max(i1, ci)
        j1 = Math.max(j1, cj)
      }
      // 【巷寬因街廓而異】每一格都留同寬的白邊，白邊本身就會排成格線
      const seed = 2000 + i * 10 + j
      const half = (LANE_WIDTH * (0.7 + ((seed * 37) % 7) / 10)) / 2
      out.push({
        x0: PLANT_CENTER.x + xs[i]! + half,
        x1: PLANT_CENTER.x + xs[i1 + 1]! - half,
        z0: PLANT_CENTER.z + zs[j]! + half,
        z1: PLANT_CENTER.z + zs[j1 + 1]! - half,
        kind: BLOCK_KINDS[i]![j]!,
        seed,
      })
    }
  }
  return out
}

/**
 * 街廓。六欄四列的格子合併同機能的相鄰對之後剩下的那些，大小不一。
 * `render/geometry/ground/plantFill.ts` 逐個鋪。
 */
export const PLANT_BLOCKS: readonly PlantBlock[] = /* @__PURE__ */ buildBlocks()

/**
 * 佈景煙囪：打不掉，但會冒煙。**世界座標**。
 *
 * 【為什麼不是相對偏移】`main.ts` 的發煙迴圈每幀跑，那裡不能有換算，也不能
 * 建物件（240 Hz 的熱路徑）。
 *
 * 【為什麼要有它】從進場方向看過去，煙柱是廠區唯一在遠處就標定得出自己的
 * 東西。只有十二座可炸構件在冒煙的話，炸完六座就幾乎不冒了。
 */
export const PLANT_STACKS: readonly { readonly x: number; readonly z: number; readonly y: number }[] = [
  { x: -1440, z: -7340, y: 62 },
  { x: -1050, z: -7690, y: 55 },
  { x: -1050, z: -7060, y: 68 },
  { x: -560, z: -7080, y: 58 },
  { x: -60, z: -7700, y: 64 },
  { x: -1440, z: -6940, y: 48 },
  { x: -560, z: -7700, y: 52 },
  { x: -60, z: -7060, y: 60 },
]

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
