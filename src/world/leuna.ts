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
 * 【農地的參數一改廠區不會埋進山裡】農地生成器同時被德 M3 與遭遇戰用；
 * 這張圖不共用它的丘陵清單，只共用生成的機制。
 */

/** 廠區中心。藍隊開局在 z ≈ +5,000 朝 −Z（`headOn`），投彈航路 12 km */
export const PLANT_CENTER = /* @__PURE__ */ new Vector3(0, 0, -7000)
/**
 * 廠區的朝向，弧度。長軸相對正北往**西**偏 12.5°（NNW–SSE）。
 *
 * 【這個數字是量出來的】OSM 上 Chemiestandort Leuna 三塊廠區，各自量落在
 * 自己範圍內的鐵路方位加權分佈，峰值都落在 −15…−10°（佔 51% / 40% / 100%）。
 * 廠區外框的最小外接矩形給的是 +6.9°，但那被兩塊網格拼接的形狀帶偏 ——
 * 從投彈高度看到的紋理方向是鐵路與廠房的方向，不是外框。
 *
 * 【墊面／巷道／街廓／鋪面全部改讀廠區局部座標】它們仍然是軸對齊矩形，
 * 只是活在轉過的座標系裡 —— 見 `plantToWorld` / `worldToPlant`，以及
 * `render/fields.ts` 的 `SiteLayout.heading`。道路與鐵路的折線是例外：
 * 它們一路畫到地圖邊緣，直接寫世界座標。
 */
export const PLANT_HEADING = (-12.5 * Math.PI) / 180

const HEAD_COS = /* @__PURE__ */ Math.cos(PLANT_HEADING)
const HEAD_SIN = /* @__PURE__ */ Math.sin(PLANT_HEADING)

/**
 * 廠區局部座標 → 世界座標。局部的 +X 是廠區的「東」、+Z 是「南」，原點在
 * `PLANT_CENTER`。
 *
 * 【不配置記憶體】呼叫端給 `out`。這支在載入期跑，但 `worldToPlant` 的孿生
 * 版本在小地圖取樣的路徑上，兩支要對稱。
 */
export function plantToWorld(dx: number, dz: number, out: { x: number; z: number }): void {
  out.x = PLANT_CENTER.x + dx * HEAD_COS - dz * HEAD_SIN
  out.z = PLANT_CENTER.z + dx * HEAD_SIN + dz * HEAD_COS
}

/** 世界座標 → 廠區局部座標。`plantToWorld` 的反向 */
export function worldToPlant(x: number, z: number, out: { x: number; z: number }): void {
  const rx = x - PLANT_CENTER.x
  const rz = z - PLANT_CENTER.z
  out.x = rx * HEAD_COS + rz * HEAD_SIN
  out.z = -rx * HEAD_SIN + rz * HEAD_COS
}

/** `plantToWorld` 的一次性版本。表格常數用，不在熱路徑上 */
function at(dx: number, dz: number): { x: number; z: number } {
  const out = { x: 0, z: 0 }
  plantToWorld(dx, dz, out)
  return out
}

/**
 * 墊面矩形的半邊長，m。墊面內保證高度為 0。
 *
 * 【長軸是南北向】真實的洛伊納廠區沿薩勒河西岸南北延伸，長寬比約 1 : 2。
 * 轉成東西向的話它在航照上就是另一座工廠，而且投彈航路（朝 −Z）穿過廠區
 * 只剩一半的時間。
 *
 * 【1.5 × 3 km】洛伊納是一整片化工廠，不是一座建築。廠區裡大部分是佈景
 * （管架、鋼骨塔、棚屋），可炸的只有十二座構件。
 */
export const PLANT_PAD = { halfX: 750, halfZ: 1500 } as const

/** 墊面的外接圓半徑，m。轉過角度之後「離廠區多遠」只剩這一個軸對齊的量 */
export const PLANT_PAD_RADIUS = /* @__PURE__ */ Math.hypot(PLANT_PAD.halfX, PLANT_PAD.halfZ)

/**
 * 墊面之外還要這麼寬的一圈不長樹，m。
 *
 * 【為什麼不是零】廠界最深咬進 355 m，樹貼著墊面長的話，咬進來的缺口裡會
 * 站著一叢樹籬 —— 從投彈高度看是「工廠裡有樹」。而且真的廠區外圍是一圈
 * 空地與圍牆外的空曠帶，不是農田直接貼到牆上。
 */
export const PLANT_TREE_CLEAR = 400

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
 * 8.8 cm 重高砲位。**會還手**：`battle/setup.ts` 給每一座掛一門
 * `GROUND_FLAK_SPEC` 的砲，走艦砲那一套射控（`world/shipGuns.ts`）。
 * 打得掉，也算進炸毀的計數。
 *
 * 【四十八座，三圈】內圈 8 座 2.7 km、中圈 16 座 3.9 km、外圈 24 座 5.1 km，
 * 每一圈的相位錯開。史實的洛伊納周圍有數百門重高砲，恐怖的是滿天黑雲而不是
 * 單發致命 —— 所以砲位多、每發輕（見 `GROUND_FLAK_SPEC`）。
 *
 * 【越外圈越密】外圈的周長是內圈的兩倍，座數不跟著加的話彈幕會在接近航路上
 * 稀掉。而接近航路的前半段正是最需要壓力的地方 —— 射程 4.9 km，只有內圈的話
 * 玩家要飛到 2 km 內才挨打。
 *
 * 【`heading` 只影響模型朝向】射控自己轉砲，砲口朝廠區外側純粹是為了畫面。
 *
 * 【擺位是廠區局部座標】它們是廠區的防空陣地，跟著廠區一起轉 —— 不轉的話
 * 南北那幾座會被轉過來的廠區吃進墊面裡。
 */
export const FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    // 內圈 8 座，約 2.7 km
    { dx: 0, dz: -2700, heading: 0.0 },
    { dx: 1900, dz: -1900, heading: 0.79 },
    { dx: 2700, dz: 0, heading: 1.57 },
    { dx: 1900, dz: 1900, heading: 2.36 },
    { dx: 0, dz: 2700, heading: 3.14 },
    { dx: -1900, dz: 1900, heading: -2.36 },
    { dx: -2700, dz: 0, heading: -1.57 },
    { dx: -1900, dz: -1900, heading: -0.79 },
    // 中圈 16 座，約 3.9 km
    { dx: 750, dz: -3850, heading: 0.19 },
    { dx: 2150, dz: -3250, heading: 0.58 },
    { dx: 3250, dz: -2150, heading: 0.99 },
    { dx: 3850, dz: -750, heading: 1.38 },
    { dx: 3850, dz: 750, heading: 1.76 },
    { dx: 3250, dz: 2150, heading: 2.16 },
    { dx: 2150, dz: 3250, heading: 2.56 },
    { dx: 750, dz: 3850, heading: 2.95 },
    { dx: -750, dz: 3850, heading: -2.95 },
    { dx: -2150, dz: 3250, heading: -2.56 },
    { dx: -3250, dz: 2150, heading: -2.16 },
    { dx: -3850, dz: 750, heading: -1.76 },
    { dx: -3850, dz: -750, heading: -1.38 },
    { dx: -3250, dz: -2150, heading: -0.99 },
    { dx: -2150, dz: -3250, heading: -0.58 },
    { dx: -750, dz: -3850, heading: -0.19 },
    // 外圈 24 座，約 5.1 km
    { dx: 350, dz: -5100, heading: 0.07 },
    { dx: 1650, dz: -4850, heading: 0.33 },
    { dx: 2850, dz: -4250, heading: 0.59 },
    { dx: 3850, dz: -3350, heading: 0.85 },
    { dx: 4550, dz: -2250, heading: 1.11 },
    { dx: 5000, dz: -1000, heading: 1.37 },
    { dx: 5100, dz: 350, heading: 1.64 },
    { dx: 4850, dz: 1650, heading: 1.9 },
    { dx: 4250, dz: 2850, heading: 2.16 },
    { dx: 3350, dz: 3850, heading: 2.43 },
    { dx: 2250, dz: 4550, heading: 2.68 },
    { dx: 1000, dz: 5000, heading: 2.94 },
    { dx: -350, dz: 5100, heading: -3.07 },
    { dx: -1650, dz: 4850, heading: -2.81 },
    { dx: -2850, dz: 4250, heading: -2.55 },
    { dx: -3850, dz: 3350, heading: -2.29 },
    { dx: -4550, dz: 2250, heading: -2.03 },
    { dx: -5000, dz: 1000, heading: -1.77 },
    { dx: -5100, dz: -350, heading: -1.5 },
    { dx: -4850, dz: -1650, heading: -1.24 },
    { dx: -4250, dz: -2850, heading: -0.98 },
    { dx: -3350, dz: -3850, heading: -0.72 },
    { dx: -2250, dz: -4550, heading: -0.46 },
    { dx: -1000, dz: -5000, heading: -0.2 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: s.heading + PLANT_HEADING }))

/** 構件的種類。與 `groundTargets.ts` 的 `GroundKind` 相同的字面值 */
export type PlantKind =
  | 'hydroTower' | 'chimney' | 'boilerHouse' | 'oilTank' | 'gasHolder' | 'coolingTower'

/**
 * 十二座可炸的構件相對廠區中心的偏移與朝向。**四群各三座**，散在廠區的
 * 四個角落，群內的三座間距 80–120 m：一趟對準的投彈帶得走一群，四群要飛
 * 四趟，而過關只要六座 —— 兩群。
 *
 * 【每一群都在機能相符的街廓裡】氫化塔進製程區、鍋爐房與冷卻塔進公用區、
 * 儲油槽進儲槽區。街廓表在 `BLOCK_KINDS`，機能不合的話周圍的佈景會是另一
 * 種工廠 —— 反應塔站在一圈土堤圍起來的儲槽中間。
 *
 * 【挪動之前先確認】要在墊面內、不壓到廠內的三條道路（見 `ROADS`）、不與
 * `PLANT_STACKS` 的佈景煙囪重疊，而且不落在巷道上。
 */
export const PLANT_LAYOUT: readonly { kind: PlantKind; dx: number; dz: number; heading: number }[] = [
  // 北　氫化群（process，x −420…0 × z −1500…−1000）
  { kind: 'hydroTower', dx: -290, dz: -1250, heading: 0 },
  { kind: 'hydroTower', dx: -210, dz: -1250, heading: 0 },
  { kind: 'hydroTower', dx: -130, dz: -1250, heading: 0 },
  // 東北　儲槽群（tankFarm，x 380…750 × z −1500…−1000）
  { kind: 'oilTank', dx: 520, dz: -1300, heading: 0 },
  { kind: 'oilTank', dx: 600, dz: -1300, heading: 0 },
  { kind: 'oilTank', dx: 560, dz: -1220, heading: 0 },
  // 西中　汽電群（utility，x −750…−420 × z −500…−150）
  { kind: 'coolingTower', dx: -640, dz: -390, heading: 0 },
  { kind: 'gasHolder', dx: -640, dz: -270, heading: 0 },
  { kind: 'chimney', dx: -500, dz: -330, heading: 0 },
  // 東南　動力群（utility，x 380…750 × z 600…1100）
  { kind: 'boilerHouse', dx: 530, dz: 800, heading: 0 },
  { kind: 'boilerHouse', dx: 530, dz: 890, heading: 0 },
  { kind: 'chimney', dx: 650, dz: 845, heading: 0 },
]

/**
 * 十二座構件的**世界**座標與朝向。`PLANT_LAYOUT` 的局部表轉過來，朝向已經
 * 含 `PLANT_HEADING`。
 *
 * 【使用端拿這一份】任務卡（`battle/missions.ts`）與展示區都不自己做換算 ——
 * 少加一次旋轉，構件會整群站在墊面外，而墊面是著色器畫的、構件是模型，
 * 兩者對不齊在畫面上只是「這些塔怎麼蓋在田裡」。
 */
export const PLANT_TARGETS: readonly { kind: PlantKind; x: number; z: number; heading: number }[] =
  /* @__PURE__ */ PLANT_LAYOUT.map((p) => ({
    kind: p.kind, ...at(p.dx, p.dz), heading: PLANT_HEADING + p.heading,
  }))

/**
 * 道路的折線，**世界座標**。畫在地面著色器裡（`fields.ts` 的 `SiteLayout`），
 * 不是幾何。
 *
 * 【廠內段是算出來的、連外段是手擺的】廠內三條跟著廠區轉（`at()` 把巷道的
 * 局部座標轉成世界）；連外那兩條一路畫到地圖邊緣，直接寫世界座標。
 *
 * 連外的兩條都往西出圖 —— 薩勒河從東、北、南三面繞著廠區，往別的方向拉
 * 一定會跨河，而水面是一片蓋在地上的網格，跨過去的那一段是淹在水裡的路。
 */
export const ROAD_WIDTH = 12
export const ROADS: readonly (readonly { x: number; z: number }[])[] = [
  // 廠內主軸（縱貫，與鐵路骨幹平行）
  [at(-420, -1500), at(-420, 1500)],
  // 廠內橫向
  [at(-750, -500), at(750, -500)],
  [at(-750, 600), at(750, 600)],
  // 西門到地圖西緣（梅澤堡方向）
  [at(-750, -500), { x: -2000, z: -7500 }, { x: -14500, z: -7500 }],
  // 南門，沿開場的航路往南 2.4 km 之後折向西緣
  [
    at(-420, 1500), { x: -85, z: -3000 }, { x: -600, z: 1500 },
    { x: -2600, z: 3000 }, { x: -14500, z: 3000 },
  ],
]

/**
 * 鐵路骨幹的折線，世界座標。**貫穿廠區、南北都接出去** —— 合成油廠的煤、
 * 氫與成品油全部靠軌道進出，主線從廠區中間穿過去，股道在沿線鼓起來變成
 * 調車場（`BLOCK_KINDS` 裡貼著 x = 0 的那兩塊）。
 *
 * 【要落在巷道上】它與廠內道路同一條規則：不在巷道上的話會把街廓從中間
 * 切開，填充器鋪的東西一半壓在軌道上。
 *
 * 【出廠之後要留在河的西岸】東邊 3.2 km 就是薩勒河，而它在廠區北邊轉向西、
 * 一路沿 x ≈ 0 往北出圖 —— 北段要先斜到 x = −1500 才閃得開。南端也不能直接
 * 往南出圖（河在 z ≈ 2,000 橫過 x = 0），折向西緣。
 */
export const RAIL_WIDTH = 26
export const RAILS: readonly (readonly { x: number; z: number }[])[] = [
  [
    { x: -1500, z: -14500 }, { x: -1500, z: -10000 }, at(0, -1500),
    at(0, 1500), { x: -500, z: -4000 }, { x: -2500, z: -2000 },
    { x: -14500, z: -2000 },
  ],
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
 * 【與廠內道路、鐵路骨幹共線】縱向的 −420 是廠內主幹道、0 是 `RAILS`
 * 的鐵路骨幹；橫向的 −500 與 600 是另外兩條路。格線另開一套的話，街廓會被
 * 道路從中間切開，填充器鋪的東西一半壓在路上。
 */
export const PLANT_LANES = {
  x: [-420, 0, 380],
  z: [-1000, -500, -150, 180, 600, 1100],
} as const

/** 巷道寬，m。街廓從格線各退一半 */
export const LANE_WIDTH = 16

/** 街廓的機能。填充器照這個標籤決定鋪什麼 */
export type BlockKind = 'process' | 'tankFarm' | 'halls' | 'railyard' | 'utility' | 'open'

/**
 * 一個街廓。**廠區局部座標**（見 `plantToWorld`），已經退掉巷道。
 *
 * 【為什麼不是世界座標】廠區轉了 `PLANT_HEADING`，轉過的矩形不再軸對齊 ——
 * 而地面著色器的鋪面判斷是四個不等式。留在局部系裡它仍然是矩形，著色器
 * 只在入口轉一次座標。
 */
export interface PlantBlock {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
  readonly kind: BlockKind
  readonly seed: number
}

/**
 * 機能指派，4 欄 × 7 列，欄由西到東、列由北到南。
 * **與 `tools/blender/build_plant.py` 是同一份表**，那邊改了這邊要跟著改。
 *
 * 【同機能不相鄰】相鄰同機能會被 `mergePlan` 併成一塊，而併出來的大方塊
 * 從投彈高度看下去就是「那一整區都是油槽」。任兩格的鄰居都是別的機能，
 * 所以每一個街廓都是一格。
 *
 * 【兩塊調車場貼著鐵路骨幹】`RAILS` 走 x = 0，兩塊分別在它的東側北段
 * 與西側南段 —— 調車場是骨幹沿線鼓起來的股道群，不是廠區邊上的一塊地。
 *
 * `open` 是刻意的留白 —— 沒有空地就看不出密的地方有多密。
 */
const BLOCK_KINDS: readonly (readonly BlockKind[])[] = [
  // 一欄是一條由北到南的縱列（列的邊界是 −1000 / −500 / −150 / 180 / 600 / 1100）
  ['halls', 'process', 'utility', 'tankFarm', 'process', 'halls', 'utility'], // x −750…−420
  ['process', 'tankFarm', 'process', 'halls', 'utility', 'railyard', 'process'], // x −420…0
  ['utility', 'railyard', 'halls', 'process', 'tankFarm', 'process', 'open'], // x 0…380
  ['tankFarm', 'process', 'utility', 'open', 'process', 'utility', 'tankFarm'], // x 380…750
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
        x0: xs[i]! + half,
        x1: xs[i1 + 1]! - half,
        z0: zs[j]! + half,
        z1: zs[j1 + 1]! - half,
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
 * 佈景煙囪：打不掉，但會冒煙。**匯出的是世界座標**，表裡寫的是廠區局部
 * 偏移（跟著 `PLANT_HEADING` 轉）。
 *
 * 【為什麼匯出世界座標】`main.ts` 的發煙迴圈每幀跑，那裡不能有換算，也不能
 * 建物件（240 Hz 的熱路徑）。
 *
 * 【為什麼要有它】從進場方向看過去，煙柱是廠區唯一在遠處就標定得出自己的
 * 東西。只有十二座可炸構件在冒煙的話，炸完六座就幾乎不冒了。
 */
export const PLANT_STACKS: readonly { readonly x: number; readonly z: number; readonly y: number }[] =
  /* @__PURE__ */ ([
    { dx: -340, dz: 1440, y: 62 },
    { dx: -690, dz: 1050, y: 55 },
    { dx: -60, dz: 1050, y: 68 },
    { dx: -80, dz: 560, y: 58 },
    { dx: -700, dz: 60, y: 64 },
    { dx: 500, dz: 1440, y: 48 },
    { dx: -700, dz: 560, y: 52 },
    { dx: -60, dz: 60, y: 60 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), y: s.y }))

/**
 * 牆外的衛星設施。**相對廠區中心**：dx／dz 是中心，w／d 是寬與深。
 *
 * 【廠區不能只有一個盒子】主廠區是一塊被牆圍起來的方塊，牆外一片田 ——
 * 從投彈高度看下去那條界線是整幅畫面最刺眼的東西。真的合成油廠周邊本來
 * 就散著變電所、加壓站、倉庫與側線，它們讓「人造的地」不只有一塊。
 *
 * **與 `tools/blender/build_plant.py` 的 `SATELLITES` 同一份數字。**
 *
 * 【要避開砲位與連外道路】兩者都不在 `KEEPOUTS` 裡，位置是手挑的。挪動之前
 * 先對照 `FLAK_SITES` 與 `OUT_ROADS`。
 */
export const PLANT_SATELLITES: readonly {
  readonly dx: number; readonly dz: number
  readonly w: number; readonly d: number
  readonly kind: string
}[] = [
  { dx: -250, dz: 1900, w: 160, d: 220, kind: 'substation' },
  { dx: 1080, dz: -720, w: 150, d: 190, kind: 'pump' },
  { dx: 1090, dz: 1240, w: 150, d: 260, kind: 'warehouse' },
  // 【側線貼著鐵路骨幹】它在廠外接主線，不能跑到河那一邊去
  { dx: -400, dz: -1780, w: 130, d: 320, kind: 'siding' },
  { dx: -980, dz: -1700, w: 190, d: 210, kind: 'stockpile' },
  { dx: 360, dz: 2060, w: 150, d: 180, kind: 'motorpool' },
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

/**
 * 手擺丘陵的瓣：一顆種子抽一組。洛伊納與波爾塔瓦（`poltava.ts`）兩張手擺的
 * 圖都用它 —— 同一個種子在兩張圖上抽到同一個形狀。
 *
 * @param count 幾瓣。**省略 = 4**，那兩張圖都是省略的；雷伊泰的山要更多稜線
 *   才傳更大的數。前 4 瓣與省略時逐位元相同（同一條亂數序列往下抽）
 */
export function drawHillLobes(seed: number, count = HILL_LOBES): LobeDraw[] {
  const rand = makeRand(seed)
  const out: LobeDraw[] = []
  for (let k = 0; k < count; k++) {
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
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  // 基準面是 0：內陸沒有海
  bakeRelief(field, hills, 0)
  return { field, hills }
}
