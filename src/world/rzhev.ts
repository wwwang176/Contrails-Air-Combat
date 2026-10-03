import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'

/**
 * # 勒熱夫：德 M4 專用的地形與佈局
 *
 * 1942 年 11 月下旬，勒熱夫突出部西側的一個營級切片。**整張圖的佈局都在這個檔案**，卡片引用這裡的
 * 常數。
 *
 * 【為什麼在這裡打】平原上的戰鬥打在地物上：路、路口、村、高地。這一仗的地物是**一條南北向
 * 的田間路與沿著它排開的一個長村**，路在村南 +236 m 有一個丁字路口。德軍守村：全寬的障礙線
 * 在村南 160～400 m（中央雷帶、兩翼反坦克壕直到 ±1,500），10 門反坦克砲分三個支撐點在村南
 * 兩翼與村南口，射界交叉在路口與雷帶上；蘇軍步兵與 T-34 沿路從南邊推來，被雷帶與反坦克砲擋住，
 * 蘇軍的支援砲與防空在無人地帶以南跟著擺開。
 * 村與路都是地形生成的（`render/farmSettlements.ts` 的村 `v-2,0`、區塊交界的凹路），這個檔案
 * 只負責把戰場對準它們。
 *
 * 【局部座標】`lx` 橫向（朝德軍後方看，右為正）、`lz` 縱深（**負 = 德軍後方**）。原點在村南緣
 * 往南 200 m 的路上；`at(lx, lz)` 換成世界座標，`FRONT_HEADING` 是局部航向 0 在世界裡
 * 的方向。路是 13° 左右的斜線，不是正北，所以整場佈局跟著它轉。擺位的航向寫成**局部羅盤度數**
 * （0 = 朝德軍後方、順時針、180 = 朝蘇軍），由 `facing` 換成世界航向。
 *
 * ```
 *   lz  −1,623  村的北端（Y 形路口）
 *    −1,300 …−200  村（主街長約 1.4 km，兩側各一列房子，支路向兩側伸出數百公尺）
 *    −1,500 …    東北的高地（德軍預備隊從它的西側繞下來）
 *   −550 …−50  三個反坦克支撐點：W（四門）、S（兩門）、E（四門），德軍固定的 IV 號分在兩翼與村南口
 *    −320 …−110  第二線壕溝（連接三個支撐點，在路上斷開）
 *     +80 … +105  第一線壕溝
 *    +160 … +400  中央雷帶（沿路留一條通道），兩翼 lz +200 的反坦克壕接到 ±1,500
 *      +236  丁字路口：西路與斜路匯合
 *   +300 … +520  無人地帶：殘骸、砲兵彈著、被打掉的 T-34、蘇軍步兵
 *   +425 … +900  蘇軍支援砲（第一段的目標）、迫擊砲與防空
 *   +1,900 …+1,911  蘇軍兩路縱隊沿斜路與南路的集結位置（戰場框外，開場藏著）
 * ```
 *
 * 【村與單位互相讓開】單位不壓在路上（路中線 ±60 m），也不放在主街兩端的 100 m 內；村的兩翼
 * 與房子之間可以放，**房子會讓開單位**。壕溝與雷區不穿過主街帶（`VILLAGE_BOX`）。反過來，
 * 村的支路、房子、樹、菜園讓開單位、壕溝與縱隊路線（`battleKeepOut`），所以支路伸到單位旁
 * 會停下來。`rzhev.test.ts` 守著。
 *
 * **全部是起始值，由試飛裁定。**
 */

/**
 * 村 `v-2,0` 的站址（凹路上）與路的走向，世界座標。`render/farmSettlements.ts` 的
 * `farmLaneVillages` 產生它；`rzhev.test.ts` 對照兩邊，改了農地框架這裡就紅。
 *
 * `southReach`／`northReach` 是草原街村（`render/steppeVillage.ts`）沿路實際長出房子的
 * 範圍：站址往南 1,070 m、往北 353 m（凹路在北邊被第三顆區塊種子截斷）。
 */
export const VILLAGE = {
  x: -3045.7919921875, z: 1422.0419921875, lane: -1.3443351787589748,
  southReach: 1070, northReach: 353,
} as const

/** 村的南緣在局部座標的縱深 */
const VILLAGE_SOUTH_LZ = -200

/** 路的方向（朝德軍後方）與它的右手邊，世界座標單位向量 */
const FWD = { x: Math.cos(VILLAGE.lane), z: Math.sin(VILLAGE.lane) }
const RIGHT = { x: -FWD.z, z: FWD.x }

/** 局部原點的世界座標：站址往南退到「村南緣再往南 200 m」 */
const ORIGIN = {
  x: VILLAGE.x - (-VILLAGE_SOUTH_LZ + VILLAGE.southReach) * FWD.x,
  z: VILLAGE.z - (-VILLAGE_SOUTH_LZ + VILLAGE.southReach) * FWD.z,
}

/** 局部航向 0（朝德軍後方）在世界裡的航向，rad（0 = 朝 −Z） */
export const FRONT_HEADING = Math.atan2(-FWD.x, -FWD.z)

/** 戰場框的半寬，m。所有固定單位在局部座標的 |lx|、|lz| 都在這個值以內 */
export const BATTLE_HALF = 1500

/** 戰場局部 → 世界 */
export function at(lx: number, lz: number): { x: number; z: number } {
  return { x: ORIGIN.x + lx * RIGHT.x - lz * FWD.x, z: ORIGIN.z + lx * RIGHT.z - lz * FWD.z }
}

/** 世界 → 戰場局部 */
export function toLocal(x: number, z: number): { lx: number; lz: number } {
  const dx = x - ORIGIN.x
  const dz = z - ORIGIN.z
  return { lx: dx * RIGHT.x + dz * RIGHT.z, lz: -(dx * FWD.x + dz * FWD.z) }
}

/** 村的範圍在局部座標：橫向半寬與縱深的兩端。單位與壕溝要讓開它 */
export const VILLAGE_BOX = {
  half: 190, south: VILLAGE_SOUTH_LZ, north: VILLAGE_SOUTH_LZ - VILLAGE.southReach - VILLAGE.northReach,
} as const

/** 一個擺位：世界座標、航向（rad，0 = 車頭朝 −Z，也就是朝北） */
export interface Spot {
  readonly x: number
  readonly z: number
  readonly heading: number
}

/**
 * 局部羅盤度數（0 = 朝德軍後方、順時針、90 = 局部右手邊、180 = 朝蘇軍）換成世界航向，rad。
 * 世界航向 h 的朝向向量是 (−sin h, −cos h)（`world/groundTargets.ts` 以 `setFromAxisAngle`
 * 繞 +Y 轉 h）；這裡先在世界裡組出朝向向量再反推 h，方向不靠記符號。
 */
export function facing(deg: number): number {
  const t = (deg * Math.PI) / 180
  const vx = Math.cos(t) * FWD.x + Math.sin(t) * RIGHT.x
  const vz = Math.cos(t) * FWD.z + Math.sin(t) * RIGHT.z
  return Math.atan2(-vx, -vz)
}

function spot(lx: number, lz: number, deg: number): Spot {
  const p = at(lx, lz)
  return { x: p.x, z: p.z, heading: facing(deg) }
}

/**
 * 德軍反坦克砲：10 門，守村南的三個支撐點：W（四門，村西南）、S（兩門，村南口兩側）、E（四門，
 * 村東南）。射界約航向 ±27°，各支撐點的砲斜向交叉在丁字路口、中央雷帶與路上；彼此至少相距
 * 150 m。丁字路口到村南口的走廊任一點至少 3 門在射界內。**是友軍：不是任務的目標**
 */
export const GERMAN_AT_GUNS: readonly Spot[] = [
  spot(-575, -50, 117),
  spot(-500, -225, 116),
  spot(-725, -125, 168),
  spot(-400, -400, 180),
  spot(75, -150, 212),
  spot(250, -175, 153),
  spot(350, -300, 175),
  spot(600, -100, 206),
  spot(500, -375, 230),
  spot(425, -550, 216),
]

/**
 * 德軍固定的戰車（IV 號）：8 輛，不動，360° 的固定火力點，與蘇軍互射。村南口 2 輛、兩翼壕後各
 * 2 輛、縱深 2 輛（村西、東北高地坡）。`index` 2（村南口西側）那一輛由劇本打掉
 */
export const GERMAN_DUG_PANZERS: readonly Spot[] = [
  spot(-1000, -80, 180),
  spot(-1350, -80, 180),
  spot(-200, -120, 165),
  spot(450, 0, 170),
  spot(1000, -80, 180),
  spot(1350, -80, 180),
  spot(-450, -1050, 230),
  spot(700, -1300, 180),
]

/** 劇本在第幾秒打掉固定 IV 號的哪一輛 */
export const GERMAN_DUG_PANZER_SCRIPTED = { index: 2, at: 95 } as const

/**
 * 開場就燒著的殘骸：蘇軍 T-34 六輛（兩輛衝進中央雷帶時被打掉、四輛在兩翼：想繞過去、被反坦克壕
 * 卡在南緣時被打掉），德軍 IV 號一輛（反衝鋒時被打掉）。兩翼的殘骸與履帶痕、彈坑、燒田說明蘇軍
 * 已經試過繞，沒有過得去
 */
export const WRECK_SOVIET_TANKS: readonly Spot[] = [
  spot(-420, 350, 20),
  spot(380, 300, 340),
  spot(-960, 226, 350),
  spot(-1230, 235, 15),
  spot(1010, 232, 10),
  spot(1270, 238, 345),
]
export const WRECK_GERMAN_PANZERS: readonly Spot[] = [
  spot(-130, 168, 150),
]

/** 雷帶南緣外停著、會被劇本打掉的蘇軍 T-34，與各自的秒數 */
export const STALLED_SOVIET_TANKS: readonly (Spot & { readonly killAt: number })[] = [
  { ...spot(-650, 470, 10), killAt: 40 },
  { ...spot(700, 470, 350), killAt: 150 },
]

/**
 * 德軍步兵：31 個班，朝蘇軍。前七個在前沿與支撐點近接，其餘 17 個沿壕溝每 75 m 左右一個
 * （第一線、第二線、兩翼壕與反坦克壕邊）：守軍的步兵是跟著壕溝擺的，一個營的防禦地域有幾百人。
 * 位置由佈局限制（離單位 ≥ 55 m、離路 ≥ 70 m、離雷區與障礙物、不進村）篩出來
 */
export const GERMAN_INFANTRY: readonly Spot[] = [
  spot(-500, 90, 180),
  spot(-200, 105, 180),
  spot(200, 105, 180),
  spot(500, 90, 180),
  spot(-650, -300, 200),
  spot(-350, -250, 180),
  spot(175, -290, 180),
  spot(600, -250, 160),
  spot(600, -500, 160),
  spot(-1200, 40, 180),
  spot(-900, 15, 180),
  spot(1200, 40, 180),
  spot(900, 15, 180),
  spot(-200, -560, 180),
  ...([
    [-391, 86], [95, 91], [395, 86], [-569, -314], [-435, -247], [-81, -135], [301, -239], [525, -257],
    [747, -223], [-1310, 31], [-1086, 26], [-872, -45], [1310, 31], [1086, 26], [872, -45], [-1310, 191],
    [1310, 191],
  ] as const).map(([lx, lz]) => spot(lx, lz, 180)),
]

/**
 * 蘇軍步兵：雷帶南緣外的 22 個班，朝德軍。讓開路上的通道。前八個是第一排，其餘 14 個在
 * 後面幾排（突擊的步兵跟在戰車後面，一個步兵營幾百人）
 */
export const SOVIET_INFANTRY: readonly Spot[] = [
  ...[-760, -560, -360, -170, 260, 460, 580, 800].map((lx, i) => spot(lx, 470 + (i % 2) * 30, 0)),
  ...([
    [-1266, 470], [-981, 470], [-506, 470], [-221, 470], [349, 470], [1014, 470], [1299, 470], [-411, 500],
    [64, 500], [634, 500], [-1015, 540], [-635, 540], [505, 540], [1075, 540],
  ] as const).map(([lx, lz]) => spot(lx, lz, 0)),
]

/**
 * 德軍輕型防空（Flak 38）：8 門，沿德軍陣地擺在反坦克砲的北側或旁邊，**打蘇軍戰鬥機**（Yak 從
 * 北邊進場，要先飛過這一帶）。離任何反坦克砲與彼此至少 150 m，離縱隊路線至少 60 m。
 * **數量是起始值**：太多會把 Yak 全打光
 */
export const GERMAN_FLAK: readonly Spot[] = [
  spot(-800, -400, 180),
  spot(-375, -100, 180),
  spot(-90, -420, 180),
  spot(230, -420, 180),
  spot(700, -420, 180),
  spot(-1000, -150, 180),
  spot(780, -150, 180),
  spot(-250, -500, 180),
]

/**
 * 蘇軍輕型防空（暫代：同一個 2 cm 四聯裝的模型）：12 門，隨突擊隊擺在無人地帶以南、支援砲與步兵的
 * 後面（lz +550 … +900），**打 Ju 87**（Ju 87 由南往北進，先飛過這一帶）。彼此至少 150 m，
 * 離支援砲至少 150 m，離縱隊路線至少 100 m，離任何德軍單位至少 126 m（炸彈的殺傷半徑約 33 m，
 * 兩倍再加 60 m）
 */
export const SOVIET_FLAK: readonly Spot[] = ([
  [-1000, 650], [-725, 725], [-450, 775], [-200, 825], [100, 825], [450, 850],
  [600, 825], [800, 825], [1025, 650], [-1250, 550], [1250, 550], [-50, 900],
] as const).map(([lx, lz]) => spot(lx, lz, 0))

/**
 * 蘇軍支援砲：10 門反坦克砲，**第一段的目標**。擺在無人地帶與蘇軍集結區（lz +425 … +675），
 * 朝北，兩翼與路的兩側各有幾門，壓制德軍的陣地。彼此至少 150 m（一顆炸彈只打掉一門）；離路中線
 * 至少 70 m、離雷區與障礙線至少 25 m、離縱隊路線至少 100 m；**離每一個德軍單位至少 66 m**
 * （殺傷半徑約 33 m 的兩倍，炸彈不分敵我）；1,500 m 內至少有一個德軍射手（`mopUp` 補射的
 * 射程）
 */
export const SOVIET_SUPPORT_GUNS: readonly Spot[] = ([
  [-1100, 425], [-850, 525], [-600, 600], [-325, 550], [-125, 625],
  [150, 675], [425, 550], [650, 600], [900, 525], [1150, 425],
] as const).map(([lx, lz]) => spot(lx, lz, 0))

/**
 * 德軍迫擊砲（暫代：立方體）：6 門，兩個排各三門，在第二線壕溝後方、反坦克砲北側（村的兩翼）。
 * 打高拋物線，射程裡的蘇軍步兵與縱隊都挨得到。位置由佈局限制篩出來（離單位 ≥ 60 m、離路 ≥ 70 m、
 * 不在雷區、壕溝與障礙物上、離縱隊路線 ≥ 100 m、不進村）
 */
export const GERMAN_MORTARS: readonly Spot[] = ([
  [-700, -430], [-650, -480], [-700, -530], [350, -480], [350, -530], [300, -430],
] as const).map(([lx, lz]) => spot(lx, lz, 180))

/**
 * 蘇軍迫擊砲（暫代：立方體）：4 門，兩個排各兩門，在步兵與縱隊集結位置的後面（lz +640 …
 * +680）
 */
export const SOVIET_MORTARS: readonly Spot[] = ([
  [-650, 640], [-550, 680], [700, 640], [850, 640],
] as const).map(([lx, lz]) => spot(lx, lz, 0))

/** 德軍後勤的卡車，停在村的北端兩側（德軍的後方在北邊），友軍，不是目標 */
export const GERMAN_TRUCKS: readonly Spot[] = [
  spot(-260, -1420, 0),
  spot(-260, -1340, 0),
  spot(260, -1420, 0),
  spot(260, -1340, 0),
]

/**
 * 縱隊的路線，世界座標。第一點是集結的尾端：第一輛停在路線上往前 `(n − 1) × gap`
 * 的位置，最後一輛停在第一點（`missions/index.ts` 的 `columnGround`）。
 *
 * 【蘇軍兩支縱隊】開場藏著，集結在戰場框外的南邊（`lz +1,900`），出發後沿斜路與南路進來，**停在
 * 雷帶的南緣外**：A 的車頭 (40,+450)、B 的車頭 (122,+509)，第 i 輛停在車頭後 `i × gap`，
 * 車隊沿路排開。不進雷帶、離任何德軍單位至少 300 m（炸彈不分敵我）。藏著是為了摧毀數：
 * 戰車開場就在場上的話，第一段先炸的會把第二段的數量湊滿。
 *
 * 【兩支在 (334,+696) 匯合】匯合後走近乎平行的兩條線，同一條線上的車等於交錯排隊。B 的集結點
 * （+1,911）與車頭的位置讓兩支的車距相位差約半個車距（20 m），行進中與停妥後都不疊車；
 * 改任何一端的長度都要重驗（`rzhev.test.ts`）。
 *
 * 【德軍預備隊分東西兩路】集結在村北、窗口之外（開場藏著），沿村的東西外側南下，終點在
 * 反坦克砲支撐點的北側（離蘇軍終點至少 250 m）。路線不穿村：主街上的房子不讓出一條空帶。
 */
export const SOVIET_ROUTE_A: readonly { x: number; z: number }[] = [
  at(334, 1900), at(334, 1100), at(334, 696), at(150, 540), at(40, 450),
]
export const SOVIET_ROUTE_B: readonly { x: number; z: number }[] = [
  at(250, 1911), at(250, 1100), at(334, 696), at(190, 560), at(122, 509),
]
export const GERMAN_RESERVE_WEST: readonly { x: number; z: number }[] = [
  at(-250, -1900), at(-560, -1650), at(-640, -1000), at(-520, -480),
]
export const GERMAN_RESERVE_EAST: readonly { x: number; z: number }[] = [
  at(250, -1900), at(560, -1650), at(640, -1000), at(520, -480),
]

/** 縱隊的車速，m/s（越野約 15 km/h）與轉角半徑 */
export const COLUMN_SPEED = 4
export const COLUMN_TURN_RADIUS = 30
export const COLUMN_GAP = 40

/**
 * 【縱隊的路線不畫成路】坦克是開在田裡的，不是沿著一條公路；畫一條路穿過去只會把大田
 * 切開。路線上的痕跡由 `TRACKS` 的履帶痕表現，路網只有區塊交界的凹路（`fields.ts`）。
 */

/**
 * 手擺的丘陵。村東北的高地（德軍預備隊的東路從它的西側繞下來）；村西南一座緩丘；遠處兩座
 * 讓地平線有起伏。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`。
 */
export const RZHEV_HILLS = [
  { ...at(1100, -2000), radius: 800, peak: 60, pa: 0.9, pb: 3.6, seed: 401 },
  { ...at(-1900, -700), radius: 600, peak: 30, pa: 2.4, pb: 0.5, seed: 402 },
  { ...at(-6500, -4000), radius: 1100, peak: 45, pa: 1.3, pb: 4.4, seed: 403 },
  { ...at(6000, -2500), radius: 1000, peak: 40, pa: 3.1, pb: 1.8, seed: 404 },
] as const

/** 局部座標的矩形 → 世界座標的外接矩形 */
function worldBox(l: { x0: number; z0: number; x1: number; z1: number }): { x0: number; z0: number; x1: number; z1: number } {
  const c = [at(l.x0, l.z0), at(l.x1, l.z0), at(l.x1, l.z1), at(l.x0, l.z1)]
  return {
    x0: Math.min(...c.map((p) => p.x)), z0: Math.min(...c.map((p) => p.z)),
    x1: Math.max(...c.map((p) => p.x)), z1: Math.max(...c.map((p) => p.z)),
  }
}

/**
 * 交戰帶，世界座標的外接矩形：第二線壕溝以南到蘇軍步兵前，橫向包含兩翼的反坦克壕。彈坑在
 * 這裡最密，往外漸稀（`render/battleScars.ts`）。地面照樣是雪田，痕跡疊在上面。
 */
export const SCAR_ZONE = worldBox({ x0: -1400, z0: -350, x1: 1400, z1: 480 })

/**
 * 彈坑特別密的地方：兩翼反坦克壕邊蘇軍想繞過去的那一帶，被砲火與炸彈犁過一遍。中心、半徑
 * 與中心的彈坑密度（`render/battleScars.ts` 的 `craterPatches`）。**要落在交戰帶外加漸弱帶以內**
 */
export const CRATER_PATCHES: readonly { readonly x: number; readonly z: number; readonly r: number; readonly dense: number }[] = [
  { ...at(-1130, 250), r: 430, dense: 0.8 },
  { ...at(1140, 245), r: 430, dense: 0.8 },
]

/** 壕溝的折線：局部座標的點 → 世界座標 */
function line(...pts: readonly (readonly [number, number])[]): { x: number; z: number }[] {
  return pts.map(([lx, lz]) => at(lx, lz))
}

/**
 * 壕溝與反坦克壕，世界座標。寬是圖集那一格蓋多寬 —— 溝本身約一成，兩側是白堊色的挖出土。
 *
 * 【比實寬】照實的兩公尺在 1.5 km 外不到一個像素；放到圖集一格四十多公尺，溝加兩側的土
 * 約十幾公尺寬，從投彈高度讀得出是一條線。
 *
 * 【在路上斷開】路從壕溝中間穿過。貼圖在線段端點外各多蓋半個寬（22 m），所以缺口開 110 m，
 * 路兩側各留 33 m 才不蓋到路；村裡不挖溝。第一線在雷帶後面、第二線連接三個
 * 反坦克支撐點、兩翼壕後各一段塹壕；反坦克壕（寬 60）在 lz +200 從雷帶角落一路接到 ±1,500，
 * 和相鄰營的障礙銜接。平行的工事至少相隔 80 m，雷帶與壕端的角落是刻意接在一起的。
 */
export const TRENCHES: readonly { readonly points: readonly { x: number; z: number }[]; readonly width: number }[] = [
  // 第一線
  { points: line([-580, 80], [-400, 95], [-200, 105], [-55, 98]), width: 44 },
  { points: line([55, 98], [200, 105], [400, 95], [580, 80]), width: 44 },
  // 第二線
  { points: line([-820, -250], [-600, -320], [-300, -170], [-55, -121]), width: 44 },
  { points: line([55, -132], [300, -230], [550, -250], [820, -200]), width: 44 },
  // 兩翼壕後的塹壕
  { points: line([-1500, 40], [-1100, 40], [-860, -40]), width: 44 },
  { points: line([1500, 40], [1100, 40], [860, -40]), width: 44 },
  // 反坦克壕
  { points: line([-1500, 200], [-750, 200], [-680, 140]), width: 60 },
  { points: line([1500, 200], [750, 200], [680, 140]), width: 60 },
]

/**
 * 雷區，世界座標的有向矩形：中心、橫向軸與縱深軸（單位向量）、半寬與半長，m。中央雷帶
 * lz +160 … +400，沿路（斜路與主路，lx −30 … +120）留一條通道 —— 路面沒布雷。
 * 雷帶在第一線壕溝之前 55 m 以上、反坦克砲之前 200 m 以上。
 */
export interface Minefield {
  readonly x: number
  readonly z: number
  readonly ux: number
  readonly uz: number
  readonly vx: number
  readonly vz: number
  readonly hu: number
  readonly hv: number
}

function mineRect(lx0: number, lx1: number, lz0: number, lz1: number): Minefield {
  const c = at((lx0 + lx1) / 2, (lz0 + lz1) / 2)
  return {
    x: c.x, z: c.z, ux: RIGHT.x, uz: RIGHT.z, vx: -FWD.x, vz: -FWD.z,
    hu: (lx1 - lx0) / 2, hv: (lz1 - lz0) / 2,
  }
}

export const MINEFIELDS: readonly Minefield[] = [
  mineRect(-700, -300, 160, 400),
  mineRect(-300, -30, 180, 350),
  mineRect(120, 300, 180, 350),
  mineRect(300, 700, 180, 380),
]

/**
 * 障礙物的種類：反坦克樁（上窄的截頭錐，兩排錯開）、捷克刺蝟（三根仰起的長條立在三個下端上）、
 * 鐵絲網（一圈圈的蛇腹）。立體的，造型與尺寸在 `render/geometry/ground/obstacles.ts`
 */
export type ObstacleKind = 'teeth' | 'hedgehog' | 'wire'

/** 一條障礙物的折線，世界座標。零件沿線等距擺 */
export interface ObstacleLine {
  readonly kind: ObstacleKind
  readonly points: readonly { x: number; z: number }[]
}

/**
 * 障礙物，世界座標的折線，擺位由防守者規劃。蘇軍縱隊走的路（斜路與主路）留一條約 100 m 寬的
 * 通道，兩側各 30 m 內不放。從蘇軍那一側往德軍看，中央的層次是：雷帶 → 第二排網（lz +155）→
 * 前沿網（+135）→ 第一線壕溝 → 反坦克樁（+30）→ 砲與 IV 號；翼側是：反坦克壕（+200）→ 反坦克樁
 * （+145）→ 網（+100）→ 翼側塹壕 → IV 號。村南口的捷克刺蝟堵住通道以外的村口寬度；兩支砲陣地的
 * 外翼各有一道網，防步兵從側後摸進來。草原沒有可砍的樹，不做鹿砦
 */
export const OBSTACLES: readonly ObstacleLine[] = [
  // 前沿與翼側的鐵絲網：翼側塹壕與第一線前方 30～55 m，連到通道兩緣
  { kind: 'wire', points: line([-1490, 100], [-1100, 100], [-830, 30], [-700, 95], [-600, 118], [-400, 132], [-45, 135]) },
  { kind: 'wire', points: line([1490, 100], [1100, 100], [830, 30], [700, 95], [600, 118], [400, 132], [55, 135]) },
  // 中央的第二排網：蘇軍步兵會沿通道兩側跟著戰車進來
  { kind: 'wire', points: line([-290, 155], [-45, 155]) },
  { kind: 'wire', points: line([55, 155], [290, 155]) },
  // 兩支砲陣地的外翼網
  { kind: 'wire', points: line([-900, -90], [-900, -330], [-760, -480]) },
  { kind: 'wire', points: line([900, -90], [900, -330], [760, -480]) },
  // 中央的第二道反坦克線：突破雷帶的戰車只能擠進通道
  { kind: 'teeth', points: line([-45, 30], [-520, 30]) },
  { kind: 'teeth', points: line([55, 30], [520, 30]) },
  // 翼側反坦克壕後的備援：壕被工兵填過的話，戰車在翼側塹壕前被擋住
  { kind: 'teeth', points: line([-1200, 145], [-780, 145]) },
  { kind: 'teeth', points: line([1200, 145], [780, 145]) },
  // 村南口：堵住通道以外的村口寬度
  { kind: 'hedgehog', points: line([-50, -80], [-300, -80]) },
  { kind: 'hedgehog', points: line([70, -80], [280, -80]) },
]

/**
 * 履帶痕，世界座標：蘇軍坦克從南邊開向雷帶、開到被打掉的地方；德軍 IV 號反衝鋒出來的那一輛
 */
export const TRACKS: readonly { readonly points: readonly { x: number; z: number }[]; readonly width: number }[] = [
  { points: line([-430, 720], [-425, 540], [-420, 360]), width: 14 },
  { points: line([420, 740], [395, 520], [380, 310]), width: 14 },
  { points: line([-660, 760], [-655, 600], [-650, 480]), width: 14 },
  { points: line([710, 780], [705, 620], [700, 480]), width: 14 },
  { points: line([-200, 700], [-150, 520], [-120, 420]), width: 14 },
  { points: line([200, 720], [160, 540], [140, 430]), width: 14 },
  { points: line([-200, 100], [-160, 135], [-130, 168]), width: 14 },
  { points: line([-900, 700], [-880, 520], [-900, 400]), width: 14 },
  { points: line([900, 720], [880, 540], [900, 400]), width: 14 },
  // 兩翼：開向反坦克壕、在壕邊打轉的履帶
  { points: line([-990, 760], [-975, 520], [-960, 240]), width: 14 },
  { points: line([-1260, 780], [-1245, 540], [-1230, 250]), width: 14 },
  { points: line([1030, 780], [1020, 520], [1010, 245]), width: 14 },
  { points: line([1290, 790], [1280, 540], [1270, 250]), width: 14 },
  { points: line([-1450, 330], [-1330, 275], [-1230, 245]), width: 14 },
  { points: line([1450, 330], [1360, 280], [1270, 250]), width: 14 },
]

/** 燒黑的地，世界座標與半徑：殘骸周圍、被砲火燒掉積雪的田。讓開村 */
export const SCORCH: readonly { readonly x: number; readonly z: number; readonly r: number }[] = [
  { ...at(-420, 350), r: 45 },
  { ...at(380, 300), r: 50 },
  { ...at(-130, 168), r: 40 },
  { ...at(-560, 260), r: 90 },
  { ...at(210, 300), r: 70 },
  { ...at(560, 330), r: 80 },
  { ...at(-860, 120), r: 60 },
  { ...at(-250, 40), r: 75 },
  { ...at(330, 60), r: 65 },
  { ...at(-980, -20), r: 65 },
  { ...at(1050, -20), r: 75 },
  { ...at(0, 420), r: 60 },
  { ...at(900, 280), r: 50 },
  { ...at(-240, 330), r: 55 },
  { ...at(620, 420), r: 60 },
  { ...at(-700, 330), r: 70 },
  { ...at(700, 200), r: 60 },
  { ...at(-1150, 240), r: 60 },
  { ...at(1180, 260), r: 55 },
  { ...at(-650, -420), r: 70 },
  // 兩翼壕邊的殘骸周圍
  { ...at(-960, 226), r: 55 },
  { ...at(-1230, 235), r: 50 },
  { ...at(1010, 232), r: 55 },
  { ...at(1270, 238), r: 50 },
  { ...at(-1100, 300), r: 90 },
  { ...at(1150, 290), r: 85 },
]

/** 地面戰的戲：砲兵彈著落在無人地帶（局部橫向 ±900 m、縱深 +125 … +475 的有向矩形） */
export const ARTILLERY_ZONE = (() => {
  const c = at(0, 300)
  return {
    x: c.x, z: c.z,
    across: { x: RIGHT.x, z: RIGHT.z },
    along: { x: -FWD.x, z: -FWD.z },
    halfAcross: 900, halfAlong: 175,
  }
})()

/**
 * 戰場的高度霧（`render/heightFog.ts`）：圓心在雷帶與壕溝之間，半徑蓋得住整個戰場框
 * （對角線半長約 2,120 m）；內圈 30% 以內整片濃，往外淡出
 */
export const BATTLE_HAZE = (() => {
  const c = at(0, 100)
  return { x: c.x, z: c.z, radius: 2300 }
})()

/**
 * 塵團的出處（`render/groundBattle.ts`）：十門反坦克砲，加上沿村的主街等距的五個點。
 * 高度霧只染得到有幾何的像素，側看沒有一團看得見的霧；塵團補這個，只放在有人活動的地方
 */
export const RZHEV_DUSTS: readonly { x: number; z: number }[] = [
  ...GERMAN_AT_GUNS.map((g) => ({ x: g.x, z: g.z })),
  at(0, -300), at(0, -550), at(0, -800), at(0, -1050), at(0, -1300),
]

/** 整場不熄的煙柱：殘骸與被砲火點著的草垛 */
export const RZHEV_SMOKES: readonly { x: number; z: number }[] = [
  at(-420, 350),
  at(380, 300),
  at(-130, 168),
  at(-560, 260),
  at(560, 330),
  at(-250, 40),
  at(900, 280),
  at(-1150, 240),
]

export function createRzhev(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of RZHEV_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.x, cz: h.z, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.x, h.z, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  // 基準面是 0：內陸沒有海
  bakeRelief(field, hills, 0)
  return { field, hills }
}

/** 戰場所在的村（`render/farmSettlements.ts` 的名字） */
export const VILLAGE_NAME = 'v-2,0'

/** 這個村是不是大村：只有戰場所在的村，其餘的村畫成小村（`render/steppeVillage.ts`） */
export function isLargeVillage(name: string): boolean {
  return name === VILLAGE_NAME
}

/**
 * 房子被燒毀（畫成焦黑）的比例：戰場所在的村受到砲擊與火攻，其他村只有零星幾間
 */
export function burnRateOf(name: string): number {
  return name === VILLAGE_NAME ? 0.3 : 0.04
}

/** 單位周圍留給單位的半徑，m */
const UNIT_ROOM = 45
/** 壕溝、縱隊路線兩側留的寬，m */
const TRENCH_ROOM = 40
const ROUTE_ROOM = 60
/** 縱隊路線最遠的集結點在 lz +1,911（B），再加上兩側的寬；比這更遠的點不必問 */
const ROUTE_FAR_LZ = 1911 + ROUTE_ROOM + 40

function nearPolyline(
  x: number, z: number, pts: readonly { x: number; z: number }[], room: number,
): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const len2 = abx * abx + abz * abz
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2))
    const dx = x - (a.x + abx * t)
    const dz = z - (a.z + abz * t)
    if (dx * dx + dz * dz < room * room) return true
  }
  return false
}

/** 戰場上所有固定的單位擺位（含殘骸）。村的房子、樹與菜園讓開它們；佈局測試也用這一份 */
export const UNIT_SPOTS: readonly Spot[] = [
  ...GERMAN_AT_GUNS, ...GERMAN_DUG_PANZERS, ...WRECK_SOVIET_TANKS, ...WRECK_GERMAN_PANZERS, ...STALLED_SOVIET_TANKS,
  ...GERMAN_INFANTRY, ...SOVIET_INFANTRY, ...GERMAN_FLAK, ...SOVIET_FLAK, ...SOVIET_SUPPORT_GUNS,
  ...GERMAN_MORTARS, ...SOVIET_MORTARS, ...GERMAN_TRUCKS,
]

/**
 * 這一點不准蓋房子、種樹與菜園：村的南緣以南（蘇軍那一側與無人地帶）、單位周圍、壕溝
 * 兩側、縱隊的路線兩側。**村的支路與房子在這些地方停下來**（`render/steppeVillage.ts`）。
 *
 * 熱路徑之外：載入時每個候選位置問一次，離戰場遠的點一次比較就回。
 */
export function battleKeepOut(x: number, z: number): boolean {
  const l = toLocal(x, z)
  if (Math.abs(l.lx) > 2000 || l.lz > ROUTE_FAR_LZ || l.lz < -2800) return false
  if (l.lz <= 1200) {
    if (l.lz > VILLAGE_SOUTH_LZ + 10) return true
    for (const s of UNIT_SPOTS) {
      const dx = x - s.x
      const dz = z - s.z
      if (dx * dx + dz * dz < UNIT_ROOM * UNIT_ROOM) return true
    }
    for (const t of TRENCHES) if (nearPolyline(x, z, t.points, TRENCH_ROOM)) return true
  }
  for (const r of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
    if (nearPolyline(x, z, r, ROUTE_ROOM)) return true
  }
  return false
}

/**
 * 防風林帶不進的戰場方框（局部座標）：橫向半寬、北緣與南緣的 lz。方框裡的地面物件都有佈局，
 * 樹不能擋住射界、路線與單位。
 */
export const BELT_BOX = { half: 1800, north: -2000, south: 1300 } as const
/** 出了方框多遠，林帶才長滿，m */
export const BELT_RAMP = 900

/**
 * 林帶的方框與漸增距離，換成地面著色器吃的形狀（世界座標的原點與兩個單位向量）：遠處的帶子
 * （`render/fields.ts` 的 `SiteBelts`）與近處種出來的樹用同一組數。
 */
export const BELT_FRAME = {
  ox: ORIGIN.x, oz: ORIGIN.z, rx: RIGHT.x, rz: RIGHT.z, fx: FWD.x, fz: FWD.z,
  half: BELT_BOX.half, north: BELT_BOX.north, south: BELT_BOX.south, ramp: BELT_RAMP,
} as const

/**
 * 防風林帶的濃度，0～1：戰場方框裡是 0，往外 `BELT_RAMP` m 內漸增到 1。
 *
 * 熱路徑之外（植被 tile 的生成），不配置 —— 所以不呼叫 `toLocal`。
 */
export function shelterbeltFade(x: number, z: number): number {
  const dx = x - ORIGIN.x
  const dz = z - ORIGIN.z
  const lx = dx * RIGHT.x + dz * RIGHT.z
  const lz = -(dx * FWD.x + dz * FWD.z)
  const ox = Math.max(0, Math.abs(lx) - BELT_BOX.half)
  const oz = Math.max(0, lz - BELT_BOX.south, BELT_BOX.north - lz)
  const t = Math.min(1, Math.sqrt(ox * ox + oz * oz) / BELT_RAMP)
  return t * t * (3 - 2 * t)
}
