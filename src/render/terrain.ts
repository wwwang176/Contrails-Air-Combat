import { createArchipelagoTerrain, createLeyteTerrain, createSeaTerrain } from './maritimeTerrain'
import type { Terrain, TerrainGfx } from './terrainTypes'
export type { Terrain, TerrainGfx } from './terrainTypes'
import {
  Group, Mesh, MeshStandardMaterial, type BufferGeometry,
} from 'three'
import { SCENERY_CHUNK, SCENERY_MIN_TRIS, splitByGrid } from './sceneryChunks'
import { CULL } from './cullRuns'
import { createFieldClipmap, type ClipLevelSpec } from './fieldClipmap'
import { floraSplats } from './buildingBake'
import { farmLaneVillages, farmSettlements } from './farmSettlements'
import { buildBlasts, buildGardens, buildStreets } from './steppeGeometry'
import { createFarmGround } from './farmGround'
import { createFarHorizon } from './farHorizon'
import {
  BUSH_RANGE, FLORA_RADIUS, LOD_NEAR, lodFor, OUTER_JITTER, outerFor, POINT_NEAR,
  TILE_SIZE,
} from './vegetationPolicy'
import { createVegetation } from './vegetation'
import {
  farmHedgeFlora, farmWoodFlora, openHedgeFloraFor, openWoodFloraFor, steppeBeltFloraFor,
} from './flora'
import { type FloraSource } from '../core/floraBuffer'
import type { IslandDesc } from '../world/archipelago'
import { createFarmland, outsideZero, HILL_PEAK_MAX } from '../world/farmland'
import {
  createLeuna, PLANT_BLOCKS, PLANT_CENTER, PLANT_HEADING, PLANT_PAD, PLANT_SATELLITES,
  PLANT_TREE_CLEAR, RAIL_WIDTH, RAILS, ROAD_WIDTH, ROADS,
} from '../world/leuna'
import {
  createPoltava, FIELD_CENTER, FIELD_LOBES, FIELD_PAD, FIELD_TREE_CLEAR, PAD_GRASS, PAVED,
  RAIL_WIDTH as POLTAVA_RAIL_WIDTH, RAILS as POLTAVA_RAILS,
  ROAD_WIDTH as POLTAVA_ROAD_WIDTH, ROADS as POLTAVA_ROADS, RUNWAY_CONCRETE,
} from '../world/poltava'
import {
  createAsch, FIELD_BUILDING_CLEAR as ASCH_BUILDING_CLEAR, FIELD_CENTER as ASCH_CENTER,
  FIELD_LOBES as ASCH_LOBES, FIELD_PAD as ASCH_PAD,
  FIELD_TREE_CLEAR as ASCH_TREE_CLEAR, PAD_GRASS as ASCH_GRASS, PAVED as ASCH_PAVED, PSP_STEEL,
  ROAD_WIDTH as ASCH_ROAD_WIDTH, ROADS as ASCH_ROADS,
} from '../world/asch'
import {
  BELT_FRAME, battleKeepOut, burnRateOf, CRATER_PATCHES, isLargeVillage, MINEFIELDS, OBSTACLES, SCAR_ZONE,
  SCORCH, shelterbeltFade,
  TRACKS, TRENCHES,
} from '../world/rzhev'
import { createRzhev, type HillAvoid } from '../world/rzhevHills'
import { buildObstacles } from './geometry/ground/obstacles'
import { preloadScarAtlas } from './battleScars'
import { aschClumpFlora, buildAschScenery } from './aschScenery'
import type { HeightFieldData } from '../world/heightfield'
import { canopyColor, FIELD_COLORS, FLORA_COLORS, type Season } from './season'
import type { SiteLayout } from './siteSurface'
import {
  buildRavineFords, buildRavineStripes, ravineKeepOutFor, steppeRavineFloraFor,
} from './steppeRavines'
import { RAVINES } from '../world/rzhevRavines'
import { excluding } from './floraExclude'
import { bakeKeepOut, corridorZone, excludingZones, type KeepOutZone } from './keepOutMask'
import {
  buildRiverMeshes, CLEAR_HALF, disposeRiverMeshes, riverBankFlora, type RiverSet,
} from './river'
import { buildLeunaRivers, preloadLeunaRivers } from './leunaRiver'
import { buildLeunaDressing, preloadLeunaFeatures, type LandDressing } from './leunaFeatures'
import { buildPlantScenery, preloadPlantScenery } from './geometry/ground/plantScenery'
import { buildAirfieldScenery, preloadAirfieldScenery } from './geometry/ground/airfieldScenery'
import type { TerrainKind } from '../world/terrainKind'

// 【聯集本身住在 world/】見 `world/terrainKind.ts`。這裡再匯出，
// 既有的 import 站點不用動
export type { TerrainKind }

/**
 * 田色 clipmap 的近圖與遠圖。近圖 2 m 一格蓋 4 km，遠圖 7.3 m 一格蓋 30 km。
 *
 * 【尺寸是量出來的】近圖 4096 每幀多花 1 ms 在取樣上而畫質看不出差；遠圖
 * 14.6 m 一格在 1 km 高度看 2.5 km 外明顯偏軟。**兩張 4096² 帶 mipmap 同時
 * 存在會讓 ANGLE D3D11 報記憶體不足並丟掉整個 WebGL context** —— 改尺寸前
 * 先讀 `docs/superpowers/specs/2026-09-17-field-clipmap-showcase-design.md`。
 */
export const FIELD_CLIP_NEAR: ClipLevelSpec = { size: 2048, metersPerTexel: 2 }
export const FIELD_CLIP_FAR: ClipLevelSpec = { size: 4096, metersPerTexel: 30000 / 4096 }
/**
 * 遠圖外那一層：田色與疊圖（鎮的地面、河漫灘、礦坑、屋頂與樹冠的色塊）都烘，29 m 一格
 * 蓋 60 km —— 場地 30 km 見方，鏡頭在場地裡的時候整張場地都在窗裡。15 km 外一棟房子、
 * 一條樹籬本來就不到一個像素，這一層只要畫得出田、鎮與林子的一團團顏色。它的窗外
 * 是它的平均色
 */
export const FIELD_CLIP_HORIZON: ClipLevelSpec = { size: 2048, metersPerTexel: 60000 / 2048 }
/**
 * 最外層外面那一層：117 m 一格蓋 240 km，田色與疊圖都烘。它外面才是平均色。
 *
 * 【為什麼要它】晴天的霧很淡（正午 30 km 只吃掉 4%），飛高之後 30 km 外的地面佔
 * 畫面一大片，一片平均色就是一塊平平的色帶。平均色退到 60～86 km 外，那裡的
 * 地面 117 m 一格已經小於一個像素
 */
export const FIELD_CLIP_BACKDROP: ClipLevelSpec = { size: 2048, metersPerTexel: 240000 / 2048 }

/**
 * 點 (x, z) 那一格的植被是哪一級，與 `vegetation.ts` 同一個算法：整格（250 m）一起
 * 換、用格心離中心 (cx, cz) 的水平距離量，外圈是那一格自己的半徑（`outerFor`，
 * 4.8～6 km 每格不同）。不算換級的遲滯（±40 m）
 */
function floraRings(x: number, z: number, cx: number, cz: number): string[] {
  const km = (m: number): string => `${(m / 1000).toFixed(1)} km`
  const i = Math.floor(x / TILE_SIZE)
  const j = Math.floor(z / TILE_SIZE)
  const d = Math.hypot((i + 0.5) * TILE_SIZE - cx, (j + 0.5) * TILE_SIZE - cz)
  const outer = outerFor(i, j)
  const lod = lodFor(d, -1, outer)
  const tree = lod >= 3 ? '不畫（烘在地面）'
    : lod === 2 ? `點（${km(POINT_NEAR)}～這一格的外圈）`
      : lod === 1 ? `簡化樹冠（${km(LOD_NEAR)}～${km(POINT_NEAR)}）`
        : `完整樹冠＋樹幹（${km(LOD_NEAR)} 內）`
  const bush = lod >= 3 ? '不畫（烘在地面）' : d > BUSH_RANGE ? `點（${km(BUSH_RANGE)} 外）` : `模型（${km(BUSH_RANGE)} 內）`
  const house = lod >= 3 ? '不畫（屋頂色塊烘在地面）' : '模型'
  return [
    `這一格：格心 ${km(d)}，外圈 ${km(outer)}（每格 ${km(FLORA_RADIUS * (1 - OUTER_JITTER))}～${km(FLORA_RADIUS)}）`,
    `樹：${tree}`, `灌木：${bush}`, `房子：${house}`,
  ]
}

/**
 * 【三條互不相干的頂層分支】重整之前是「先建好群島與海面，再判斷是不是
 * `'sea'`」—— 那樣加第三種地形會憑空多出兩個 child，而且洩漏 ocean 的資源。
 */
/**
 * 這種地形要的佈景 GLB。**`createTerrain` 之前 await**，重複呼叫是 no-op。
 *
 * 【不在開場預載】廠區的 GLB 1.5 MB，只有洛伊納的關卡用得到；開場一起載的話
 * 每個玩家都要先等它。進場時才載，等的只有要打那一關的人。
 *
 * 少了這一步的症狀是 `createTerrain` 當場丟「還沒載入」—— 那一關進不去。
 */
export async function preloadTerrainScenery(kind: TerrainKind): Promise<void> {
  if (kind === 'leuna') await Promise.all([preloadPlantScenery(), preloadLeunaRivers(), preloadLeunaFeatures()])
  else if (kind === 'poltava') await preloadAirfieldScenery()
  // 【戰場痕跡的圖集要先到】田色在建地形的那一刻就烘進貼圖，那時圖集是空的話取樣
  // 全是透明，彈坑、壕溝一個都烘不進去
  else if (kind === 'rzhev') await preloadScarAtlas()
}

/**
 * @param farmSite 只對 `'farmland'`／`'autumnFarmland'` 有效：拿到這張農地的山丘之後給一塊
 *   廠區（選單短片用 —— 原點要避開山丘，所以廠區要等高度場生成之後才定得下來）
 */
export function createTerrain(
  kind: TerrainKind, gfx?: TerrainGfx,
  farmSite?: (hills: readonly IslandDesc[]) => SiteLayout,
): Terrain {
  if (kind === 'farmland') return createFarmlandTerrain(gfx, farmSite)
  if (kind === 'autumnFarmland') return createAutumnFarmlandTerrain(gfx, farmSite)
  if (kind === 'leuna') return createLeunaTerrain(gfx)
  if (kind === 'poltava') return createPoltavaTerrain(gfx)
  if (kind === 'asch') return createAschTerrain(gfx)
  if (kind === 'rzhev') return createRzhevTerrain(gfx)
  if (kind === 'leyte') return createLeyteTerrain()
  if (kind === 'sea') return createSeaTerrain()
  return createArchipelagoTerrain()
}

function createFarmlandTerrain(
  gfx?: TerrainGfx, farmSite?: (hills: readonly IslandDesc[]) => SiteLayout,
): Terrain {
  const farm = createFarmland()
  return createInlandTerrain(farm, 'summer', farmSite?.(farm.hills), undefined, gfx)
}

/** 碴石：調車場的街廓 */
const BALLAST = 0x5f5a52
/** 裸土：留白的街廓 */
const BARE_EARTH = 0x6b5f4e
/** 牆外衛星設施的鋪面。比主廠區暗一階 —— 是附屬的、久沒整修的地 */
const OUTPOST_SLAB = 0x807d76

/**
 * 洛伊納廠區的墊面、道路與鋪面，世界座標。`fields.ts` 的著色器與植被的排除
 * 都讀它。
 *
 * 【鋪面照街廓的機能給】調車場是碴石、留白是裸土 —— 俯視時這兩塊的紋理與
 * 混凝土不同，整片廠區才不是一張均質的灰。
 */
export const LEUNA_SITE: SiteLayout = {
  pivot: { x: PLANT_CENTER.x, z: PLANT_CENTER.z },
  heading: PLANT_HEADING,
  pad: {
    x0: -PLANT_PAD.halfX, z0: -PLANT_PAD.halfZ,
    x1: PLANT_PAD.halfX, z1: PLANT_PAD.halfZ,
  },
  treeClear: PLANT_TREE_CLEAR,
  roads: ROADS,
  roadWidth: ROAD_WIDTH,
  rails: RAILS,
  railWidth: RAIL_WIDTH,
  patches: PLANT_BLOCKS
    .filter((b) => b.kind === 'railyard' || b.kind === 'open')
    .map((b) => ({
      x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1,
      hex: b.kind === 'railyard' ? BALLAST : BARE_EARTH,
    })),
  outposts: PLANT_SATELLITES.map((s) => ({
    x0: s.dx - s.w / 2, x1: s.dx + s.w / 2,
    z0: s.dz - s.d / 2, z1: s.dz + s.d / 2,
    hex: OUTPOST_SLAB,
  })),
}

/**
 * 洛伊納：農地的算繪路徑、手擺的丘陵、晚秋的色盤、廠區的墊面與佈景、薩勒河，
 * 以及真實的村鎮、A9 與蓋澤爾谷的露天礦
 */
function createLeunaTerrain(gfx?: TerrainGfx): Terrain {
  const leuna = createLeuna()
  const solid = outsideZero(leuna.field)
  const sample = (x: number, z: number): number => solid.sample(x, z)
  const rivers = buildLeunaRivers(sample)
  return createInlandTerrain(leuna, 'lateAutumn', LEUNA_SITE, buildPlantScenery, gfx, rivers,
    buildLeunaDressing(sample, rivers, leuna.field))
}

/**
 * 晚秋的內陸：農地的高度場，洛伊納的晚秋色盤。**沒有廠區的墊面與佈景** ——
 * 德 M1 在路途上攔截，地上不該有工廠。
 */
function createAutumnFarmlandTerrain(
  gfx?: TerrainGfx, farmSite?: (hills: readonly IslandDesc[]) => SiteLayout,
): Terrain {
  const farm = createFarmland()
  return createInlandTerrain(farm, 'lateAutumn', farmSite?.(farm.hills), undefined, gfx)
}

/** 波爾塔瓦機場的墊面（草）、跑道／滑行道／停機位（水泥）、連外道路與鐵路 */
export const POLTAVA_SITE: SiteLayout = {
  pivot: { x: FIELD_CENTER.x, z: FIELD_CENTER.z },
  pad: FIELD_PAD,
  padLobes: FIELD_LOBES,
  padHex: PAD_GRASS,
  treeClear: FIELD_TREE_CLEAR,
  roads: POLTAVA_ROADS,
  roadWidth: POLTAVA_ROAD_WIDTH,
  rails: POLTAVA_RAILS,
  railWidth: POLTAVA_RAIL_WIDTH,
  patches: PAVED.map((r) => ({ ...r, hex: RUNWAY_CONCRETE })),
}

/** 波爾塔瓦：農地的算繪路徑、極緩的丘、夏季、機場的墊面與佈景 */
function createPoltavaTerrain(gfx?: TerrainGfx): Terrain {
  return createInlandTerrain(createPoltava(), 'summer', POLTAVA_SITE, buildAirfieldScenery, gfx)
}

/** Y-29 的墊面（草，含作業區與營區）、跑道／滑行帶／停機墊（鋼板網）、連外道路 */
export const ASCH_SITE: SiteLayout = {
  pivot: { x: ASCH_CENTER.x, z: ASCH_CENTER.z },
  pad: ASCH_PAD,
  padLobes: ASCH_LOBES,
  padHex: ASCH_GRASS,
  treeClear: ASCH_TREE_CLEAR,
  buildingClear: ASCH_BUILDING_CLEAR,
  flora: aschClumpFlora,
  roads: ASCH_ROADS,
  roadWidth: ASCH_ROAD_WIDTH,
  patches: ASCH_PAVED.map((r) => ({ ...r, hex: PSP_STEEL })),
}

/**
 * 墊面外不長樹、不蓋村莊的兩圈，m。村莊省略時跟著樹；沒有墊面的地圖兩者都是 0
 */
export function siteClearances(site?: SiteLayout): { trees: number; buildings: number } {
  const trees = site?.treeClear ?? 0
  return { trees, buildings: site?.buildingClear ?? trees }
}

/** Y-29：農地的算繪路徑、極緩的丘、深秋的枯色、營房與車場的佈景 */
function createAschTerrain(gfx?: TerrainGfx): Terrain {
  const farm = createAsch()
  return createInlandTerrain(
    farm, 'lateAutumn', ASCH_SITE, () => buildAschScenery((x, z) => farm.field.sample(x, z)), gfx,
  )
}

/**
 * 草原街村的建築池。戰場那一個村是沿著凹路拉得很長、帶著不規則分支的大村（600 m 內約 260
 * 棟）；其餘的村只有幾十戶。戰場的南北軸與兩側實測同時最多約 460 棟房屋、40 棟棚子、120 棟
 * 燒毀的房子（農地預設 320／190／60，超出的部分由 `stats.overflow` 靜靜丟掉）。留約 2 倍的
 * 餘裕。一格實例 152 byte。
 */
export const STEPPE_CAPACITY = { house: 900, barn: 120, houseSlate: 250 } as const

const RAVINE_KEEP_OUT = ravineKeepOutFor(RAVINES)
/**
 * 勒熱夫的村的禁區：戰場（單位、壕溝、縱隊路線）與沖溝。村的房子、菜園與支路都讓開。
 * 地形與測試用同一支，測的才是遊戲實際蓋出來的村。
 */
export const rzhevVillageKeepOut = (x: number, z: number): boolean => battleKeepOut(x, z) || RAVINE_KEEP_OUT(x, z)

/**
 * 勒熱夫：沒有墊面、不畫路（路是區塊交界的凹路），交戰帶疊上彈坑、燒田、履帶痕與壕溝
 *
 * 【彈坑的密度】交戰帶裡一格（24 m）三成有坑，往外 700 m 內降到三分。**起始值，
 * 拿眼睛校**
 */
export const RZHEV_SITE: SiteLayout = {
  roads: [],
  roadWidth: 0,
  scars: {
    zone: SCAR_ZONE, fade: 700, dense: 0.3, sparse: 0.03,
    scorch: SCORCH, trenches: TRENCHES, tracks: TRACKS, minefields: MINEFIELDS,
    craterPatches: CRATER_PATCHES,
  },
  // 防風林帶在植被圈外（4.8～6 km 以遠）由著色器畫成田界上的帶；顏色是針葉樹冠色，與近處的林帶同一份
  belts: { frame: BELT_FRAME, halfWidth: 9, hex: canopyColor(FLORA_COLORS.winterSteppe.conifer).getHex() },
}

/**
 * 丘陵要躲開的村與小聚落：村的街沿凹路拉長一兩公里，圓心取站址、半徑 700 m；小聚落 300 m。
 * 地形與測試用同一份
 */
export function rzhevHillAvoid(): HillAvoid[] {
  return farmLaneVillages(14000).map((v) => ({
    x: v.place.x, z: v.place.z, r: v.place.kind === 'village' ? 700 : 300,
  }))
}

/**
 * 勒熱夫：農地的算繪路徑、手擺的緩丘、十一月的雪原、戰場的痕跡，加上立體的障礙物（反坦克樁、
 * 捷克刺蝟、鐵絲網）當佈景。高度場只建一次，障礙物貼著同一份地面
 */
function createRzhevTerrain(gfx?: TerrainGfx): Terrain {
  const rzhev = createRzhev(rzhevHillAvoid())
  const solid = outsideZero(rzhev.field)
  return createInlandTerrain(
    rzhev, 'winterSteppe', RZHEV_SITE, () => buildObstacles(OBSTACLES, (x, z) => solid.sample(x, z)), gfx,
  )
}

/**
 * 洛伊納，但高度場由外面給。**只有展示區在用**（`tools/leunaDem.ts` 的實測
 * 高程）—— 遊戲的 `createTerrain('leuna')` 走的仍然是手擺丘陵那一條。
 *
 * 【丘陵清單給空的】`createInlandTerrain` 只讀 `field`；`hills` 是給 AI 避障
 * 與世界層用的，而展示區沒有 AI。河照實測高程重算水面，所以也由這裡建。
 */
export function createLeunaTerrainWithField(field: HeightFieldData): Terrain {
  const solid = outsideZero(field)
  const sample = (x: number, z: number): number => solid.sample(x, z)
  const rivers = buildLeunaRivers(sample)
  return createInlandTerrain(
    { field, hills: [] }, 'lateAutumn', LEUNA_SITE, buildPlantScenery, undefined, rivers,
    buildLeunaDressing(sample, rivers, field),
  )
}

/**
 * 河岸林撒到細節地形外多遠，m。鏡頭在場內時植被最遠畫到邊緣外 `FLORA_RADIUS`，
 * 再多留一點給上帝視角。更外面的延伸段只有水面與草甸。
 */
const RIVER_FLORA_BEYOND = FLORA_RADIUS + 2000

/**
 * 內陸地形的共用算繪：田區、遠景環、三種散佈器。農地與洛伊納只差高度場、
 * 丘陵與季節；洛伊納另有廠區（墊面不長樹、地面是混凝土）、一顆佈景網格與河。
 */
function createInlandTerrain(
  farm: { field: HeightFieldData; hills: IslandDesc[] }, season: Season,
  site?: SiteLayout, scenery?: () => BufferGeometry,
  gfx?: TerrainGfx,
  /**
   * 這張地形的河。給了的話：樹籬、林地、村落擋在河廊外，沿岸加一排河岸林，
   * 水面與草甸掛在陸地底下，`waterAt` 讀它的索引。
   */
  rivers?: RiverSet,
  /**
   * 真實的地物（村鎮、高速公路、礦坑）。給了的話：**不撒隨機的村**（會落在
   * 不存在的地方），樹籬與樹林擋在它的範圍外，加上它的建築，網格掛在陸地底下。
   */
  dressing?: LandDressing,
): Terrain {
  // 【田圍著村】程序生成的地圖田只在村的周圍，其餘是空地與成團的樹林。有真實
  // 地物的（洛伊納）不開 —— 那一帶是開墾到幾乎不剩空地的黃土平原。草原田（集體農場的
  // 大田）整片都是田，也不開
  const steppe = FIELD_COLORS[season].layout === 'steppe'
  const open = dressing === undefined && !steppe
  const horizon = createFarHorizon(season, open)
  const ground = createFarmGround(farm.field, season, site, open)
  // 【田色烘成貼圖】地面 25 塊與遠景環一起換材質 —— 兩者本來共用同一支算式，
  // 只換地面的話 15 km 外那一圈會與地面接不上。沒有 GPU 就留著算式的材質
  const clipmap = gfx === undefined ? null : createFieldClipmap(gfx.renderer, {
    season, candidates: ground.candidates, ...(site === undefined ? {} : { site }), open,
    near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR, horizon: FIELD_CLIP_HORIZON, backdrop: FIELD_CLIP_BACKDROP,
    innerRadius: gfx.fieldInner,
  })
  if (clipmap !== null) {
    horizon.mesh.material = clipmap.material
    for (const o of ground.object.children) (o as Mesh).material = clipmap.material
  }
  const group = new Group()
  // 【場外回 0，不是 −Infinity】內陸沒有海可以退回去。遮蔽層與植被拿到的
  // 也是這一份 —— 見 `outsideZero`
  const solid = outsideZero(farm.field)
  // 【廠區的墊面不長樹】把三個散佈器包一層矩形排除，主墊面與每一塊附加的
  // 墊面各包一層；農地不包，行為不變。墊面是廠區局部座標，樞紐與朝向要一起傳
  //
  // 【戰場的交戰帶不清樹】只清植被的話，地色（`openColorAt`）與遠景的樹點照樣畫著
  // 林子，近處卻沒有樹 —— 兩邊對不上。勒熱夫的樹林門檻下交戰帶裡本來就幾乎沒有林子
  // （它沒有墊面、也沒有 `treeClear`，所以下面不排除任何東西）
  const { trees: treeClear, buildings: buildingClear } = siteClearances(site)
  const padClear = (s: FloraSource, clear = treeClear): FloraSource => (site === undefined
    ? s
    : [...(site.pad === undefined ? [] : [site.pad]), ...(site.padLobes ?? [])].reduce((src, r) => excluding(src, {
      x0: r.x0 - clear, x1: r.x1 + clear,
      z0: r.z0 - clear, z1: r.z1 + clear,
      ...(site.pivot === undefined ? {} : { pivot: site.pivot }),
      ...(site.heading === undefined ? {} : { heading: site.heading }),
    }), s))
  // 【空地的樹林門檻跟著季節】與地色（`openDeclGlsl`）讀同一份 `woodGate`
  const openWoods = openWoodFloraFor(FIELD_COLORS[season].woodGate)
  const openHedges = openHedgeFloraFor(FIELD_COLORS[season].hedgeChance)
  // 【草原田的田裡沒有樹】田界是田埂、牧草地是草；樹只長在村裡（`steppeVillage.ts`）、田界的
  // 防風林帶（`steppeBeltFloraFor`）與沖溝（`steppeRavineFloraFor`）。地色不畫林子，所以不必與地色對
  let fields = (steppe ? [steppeBeltFloraFor(shelterbeltFade), steppeRavineFloraFor(RAVINES)]
    : open ? [openHedges, openWoods] : [farmHedgeFlora, farmWoodFlora]).map((s) => padClear(s))
  // 【建築：植被與烘圖是同一個散佈器】兩邊各包一份的話，遠處的屋頂色塊與近處的
  // 房子對不上。真實地物的建築已經避開河道；程序村沒有，要包河廊
  // 程序生成的地圖的村用洛伊納那一套生成器（`farmSettlements.ts`），蓋到植被圈伸得到
  // 的地方
  const villageReach = farm.field.cell * (farm.field.size - 1) / 2 + FLORA_RADIUS + 1000
  const villages = dressing === undefined
    ? farmSettlements(villageReach, season, steppe
      ? { keepOut: rzhevVillageKeepOut, burnRate: burnRateOf, large: isLargeVillage } : undefined)
    : null
  let buildings = padClear(villages === null ? dressing!.buildings : villages.flora, buildingClear)
  // 【不長樹的範圍】地圖列出它有的範圍，載入時各合成一張遮罩（`keepOutMask.ts`）。
  // 野生的樹（河岸林、河漫灘的林子）避開村鎮、礦坑、高速公路；田裡的樹（樹籬、田裡
  // 的林地）另外避開河漫灘與河廊。遮罩蓋到植被圈伸得到的地方，外面逐點算
  const maskExtent = farm.field.cell * (farm.field.size - 1) / 2 + FLORA_RADIUS
  const wildZones: KeepOutZone[] = [...(dressing?.keepOut ?? [])]
  const fieldZones: KeepOutZone[] = [...wildZones, ...(dressing?.fieldsOut ?? [])]
  let bank: FloraSource | null = null
  if (rivers !== undefined) {
    // 【河廊不長樹籬】犁過的方格與樹籬壓到水邊，河會像畫在田上的一條線
    const corridor = corridorZone(rivers.lines, CLEAR_HALF)
    fieldZones.push(corridor)
    // 真實地物的建築已經避開河道；程序村沒有，要包河廊
    if (dressing === undefined) buildings = excludingZones(buildings, bakeKeepOut([corridor], maskExtent))
    bank = riverBankFlora(rivers.lines, farm.field.cell * (farm.field.size - 1) / 2 + RIVER_FLORA_BEYOND)
  }
  const fieldOut = bakeKeepOut(fieldZones, maskExtent)
  const wildOut = bakeKeepOut(wildZones, maskExtent)
  fields = fields.map((s) => excludingZones(s, fieldOut))
  if (bank !== null) bank = excludingZones(bank, wildOut)
  // 田色算式裡沒有、要另外烘進遠圖的散佈器：建築與村鎮裡的樹、河岸林、地物另外的
  // 樹（河漫灘的林子）。與植被畫的是同一個散佈器，遠處的色塊與近處的模型才對得上 ——
  // 一株一個點，林緣稀疏的地方遠看也是一點一點的
  const splatted: FloraSource[] = [buildings]
  if (bank !== null) {
    fields.push(bank)
    splatted.push(bank)
  }
  fields.push(buildings)
  if (site?.flora !== undefined) {
    fields.push(site.flora)
    splatted.push(site.flora)
  }
  for (const s of dressing?.flora ?? []) {
    const src = padClear(excludingZones(s, wildOut))
    fields.push(src)
    splatted.push(src)
  }
  // 【平貼在地上的都烘進地面】鎮的地面、礦坑、街每一張貼圖都烘，網格不畫；最外層
  // 外面另外畫粗網格。植被圈外建築與樹不畫，屋頂與樹冠的色塊不烘近圖（近窗裡有真的
  // 模型），最後烘、蓋在鎮的地面上。最外層的窗最遠碰得到場地外半個窗寬
  const reach = farm.field.cell * (farm.field.size - 1) / 2
    + FIELD_CLIP_HORIZON.size * FIELD_CLIP_HORIZON.metersPerTexel / 2
  const roofs = clipmap === null ? null : floraSplats(splatted, -reach, -reach, reach, reach, season)
  /** 菜園、支路與彈坑貼片的網格。烘圖的 overlay 不替呼叫端丟幾何，`dispose` 要自己丟 */
  const villageGeometry: BufferGeometry[] = []
  if (clipmap !== null && roofs !== null) {
    for (const m of dressing?.baked ?? []) {
      clipmap.addOverlay(m.geometry, true)
      clipmap.replaces(m)
    }
    // 草原的沖溝：不透明的溝帶蓋掉底下的田與路，再把凹路穿過溝的地方補回去（渡口）。先進
    // `villageGeometry`，下面那一圈照次序烘，所以在最底（村的菜園與支路壓過它）
    if (steppe && villages !== null) {
      villageGeometry.push(buildRavineStripes(RAVINES), buildRavineFords(RAVINES))
    }
    // 草原大村：屋後的長條菜園、支路的土路帶、燒毀房子底下的彈坑，平貼在地上烘進近圖。
    // 【次序】菜園在最底、支路壓過它、彈坑最上（被炸到的房子連路一起炸掉一角）
    if (villages !== null) {
      const sample = (x: number, z: number): number => solid.sample(x, z)
      if (villages.gardens.length > 0) villageGeometry.push(buildGardens(sample, villages.gardens))
      if (villages.streets.length > 0) villageGeometry.push(buildStreets(sample, villages.streets))
      for (const g of villageGeometry) clipmap.addOverlay(g, true)
      if (villages.blasts.length > 0) {
        const g = buildBlasts(sample, villages.blasts)
        villageGeometry.push(g)
        clipmap.addOverlay(g, true, true)
      }
    }
    for (const m of dressing?.beyond ?? []) clipmap.beyondFar(m)
    clipmap.addOverlay(roofs, false)
  }
  /** 上一次 `update` 的中心：植被量距離的那一點 */
  const centre = { x: 0, z: 0 }
  const vegetation = createVegetation(fields, (x, z) => solid.sample(x, z), {
    season,
    ...(dressing !== undefined ? { capacity: dressing.capacity } : steppe ? { capacity: STEPPE_CAPACITY } : {}),
  })
  // 【河掛在陸地底下】它是地表的一部分：`__gfx` 關陸地時一起關，群組的位置
  // 契約也不動。放在換材質那一圈之後 —— 那一圈把每一個孩子都當成田
  const river = rivers === undefined ? null : buildRiverMeshes(rivers)
  if (river !== null) ground.object.add(river)
  if (dressing !== undefined) ground.object.add(dressing.object)
  // 【河道上是水面不是河底】與海面同一個約定：陸地與水面取較高者。只給河底
  // 的話，炸彈、殘骸、碎片要穿過 1.2 m 的水才觸發，水柱從水面下冒出來
  const surface = rivers === undefined
    ? (x: number, z: number): number => solid.sample(x, z)
    : (x: number, z: number): number => {
      const g = solid.sample(x, z)
      const w = rivers.index.waterAt(x, z)
      return w > g ? w : g
    }
  // 【四個位置的次序與另外兩種相同】0 = 遠景環（遠海那一格）、
  // 1 = 空 Group（近海那一格）、2 = 陸地、3 = 植被；有佈景的話是第 5 個
  group.add(horizon.mesh)
  group.add(new Group())
  group.add(ground.object)
  group.add(vegetation.object)
  // 【佈景切塊】一整顆的包圍球恆與視錐相交，背對也照畫 —— 見 `SCENERY_CHUNK`
  let sceneryGroup: Group | null = null
  let sceneryMaterial: MeshStandardMaterial | null = null
  if (scenery !== undefined) {
    sceneryMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
    sceneryGroup = new Group()
    const whole = scenery()
    for (const g of splitByGrid(whole, SCENERY_CHUNK, SCENERY_MIN_TRIS)) {
      sceneryGroup.add(new Mesh(g, sceneryMaterial))
    }
    whole.dispose()
    group.add(sceneryGroup)
  }

  return {
    object: group,
    // 【不吃 time】內陸沒有波
    heightAt: surface,
    collisionHeightAt: surface,
    // 【河也是水】炸彈落河噴水柱、殘骸沉下去、墜機不揚土
    waterAt: rivers === undefined ? () => -Infinity : (x, z) => rivers.index.waterAt(x, z),
    // 【內陸沒有海】田地、遠景環與近中兩級的樹都走標準材質，換了燈自己就
    // 變暗；要補的只有吃不到光的點池
    setPalette(p) { vegetation.setPointLight(p.foliage) },
    islands: farm.hills,
    land: { field: solid, ceiling: HILL_PEAK_MAX, landAbove: -Infinity },
    fieldClip: clipmap,
    oceanHeight: null,
    // 【遠景環與地面是固定的】植被跟著鏡頭補格，田色貼圖跟著鏡頭挪窗
    update(_time, centerX, centerZ) {
      centre.x = centerX
      centre.z = centerZ
      vegetation.update(centerX, centerZ)
      clipmap?.update(centerX, centerZ)
    },
    describeAt(x, z) {
      const d = Math.hypot(x - centre.x, z - centre.z)
      return [
        `離植被中心（水平） ${Math.round(d).toLocaleString()} m`,
        ...floraRings(x, z, centre.x, centre.z),
        `地面：${clipmap === null ? '逐像素算（沒有貼圖）' : clipmap.layerAt(x, z)}`,
      ]
    },
    cull(camera) {
      vegetation.cull(camera)
      // 【佈景塊走 three 自己的剔除】`__cull` 關掉時整顆照畫，與切塊前相同
      if (sceneryGroup !== null) {
        for (const m of sceneryGroup.children) m.frustumCulled = CULL.enabled
      }
    },
    settle() { vegetation.settle() },
    dispose() {
      horizon.dispose()
      ground.dispose()
      vegetation.dispose()
      clipmap?.dispose()
      roofs?.dispose()
      for (const g of villageGeometry) g.dispose()
      if (river !== null) disposeRiverMeshes(river)
      dressing?.dispose()
      if (sceneryGroup !== null) {
        for (const m of sceneryGroup.children) (m as Mesh).geometry.dispose()
        sceneryMaterial?.dispose()
      }
    },
  }
}
