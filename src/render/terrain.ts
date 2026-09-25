import {
  Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D, type WebGLRenderer,
} from 'three'
import { createOcean } from './ocean'
import { createFieldClipmap, type ClipLevelSpec, type FieldClipmap } from './fieldClipmap'
import { floraSplats } from './buildingBake'
import { farmSettlementFlora } from './farmSettlements'
import type { DayPalette } from './timeOfDay'
import { createIslands } from './island'
import { createFarmGround } from './farmGround'
import { createFarHorizon } from './farHorizon'
import {
  BUSH_RANGE, createVegetation, FLORA_RADIUS, ISLAND_CAPACITY, ISLAND_MAX_PER_TILE, ISLAND_RADIUS,
  ISLAND_TILES_PER_FRAME, LEYTE_CAPACITY, LOD_NEAR, OUTER_JITTER, POINT_NEAR,
} from './vegetation'
import {
  createIslandFlora, createLeyteFlora, farmHedgeFlora, farmWoodFlora,
  islandCanopyCover, leyteCanopyCoarse, leyteFarCover, openHedgeFlora, openWoodFlora, type FloraSource,
} from './flora'
import { requestLeyteCanopy } from './canopyBake'
import { createLeyteGround } from './leyteGround'
import { buildLeyteBeach } from './leyteBeach'
import { createLeyte, LEYTE_PEAK_MAX } from '../world/leyte'
import { bakeShore, createArchipelago, PEAK_MAX, type IslandDesc } from '../world/archipelago'
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
  createAsch, FIELD_CENTER as ASCH_CENTER, FIELD_PAD as ASCH_PAD, FIELD_TREE_CLEAR as ASCH_TREE_CLEAR,
  PAD_GRASS as ASCH_GRASS, PAVED as ASCH_PAVED, PSP_STEEL,
  ROAD_WIDTH as ASCH_ROAD_WIDTH, ROADS as ASCH_ROADS,
} from '../world/asch'
import type { HeightFieldData } from '../world/heightfield'
import type { Season } from './season'
import type { SiteLayout } from './fields'
import { excluding } from './floraExclude'
import { bakeKeepOut, corridorZone, excludingZones, type KeepOutZone } from './keepOutMask'
import {
  buildRiverMeshes, CLEAR_HALF, disposeRiverMeshes, riverBankFlora, type RiverSet,
} from './river'
import { buildLeunaRivers, preloadLeunaRivers } from './leunaRiver'
import { buildLeunaDressing, preloadLeunaFeatures, type LandDressing } from './leunaFeatures'
import { buildPlantScenery, preloadPlantScenery } from './geometry/ground/plantScenery'
import { buildAirfieldScenery, preloadAirfieldScenery } from './geometry/ground/airfieldScenery'
import type { LandField } from '../world/occlusion'
import type { TerrainKind } from '../world/terrainKind'

// 【聯集本身住在 world/】見 `world/terrainKind.ts`。這裡再匯出，
// 既有的 import 站點不用動
export type { TerrainKind }

/**
 * 有 GPU 可用時給 `createTerrain` 的東西。**省略就是純算式的地面**，headless
 * 的測試與不畫圖的工具走那一條。
 */
export interface TerrainGfx {
  readonly renderer: WebGLRenderer
  /** 鏡頭周圍多少公尺內的田色仍逐像素算，m。見 `render/quality.ts` 的 `fieldInner` */
  readonly fieldInner: number
}

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
 * 遠圖外那一層：只烘疊圖（鎮的地面、河漫灘、礦坑、屋頂與樹冠的色塊），29 m 一格蓋
 * 60 km —— 場地 30 km 見方，鏡頭在場地裡的時候整張場地都在窗裡。15 km 外一棟房子
 * 本來就不到一個像素，這一層只要畫得出鎮與林子的一團顏色
 */
export const FIELD_CLIP_HORIZON: ClipLevelSpec = { size: 2048, metersPerTexel: 60000 / 2048 }

export interface Terrain {
  /** 加進場景的那個節點。換地形時整個移除 */
  readonly object: Object3D
  /**
   * 地形高度場，m。撞地判定、水柱、殘骸與零件入水都讀它。
   *
   * 【必須與畫面上那一份是同一份】海面的頂點位移在 shader 裡算，這裡是
   * CPU 的那一份。陸地則是**同一個 `Float32Array`** 同時餵給 mesh 與這裡。
   * 兩者分家的話，飛機會撞到一片看不見的海。
   */
  heightAt(x: number, z: number, time: number): number
  /**
   * **判定用**的高度，m。海面是平的（回 0），陸地讀高度場。**不吃時間。**
   *
   * 【為什麼與 `heightAt` 分家】海面碰撞體是平面，浪只是視覺高低。但水柱、
   * 殘骸、碎片入水仍然要貼著看得見的水面 —— 那一條走 `heightAt`。
   * 兩個問題，兩支函式。
   *
   * 【誰讀它】`main.ts` 的 `world.crashPolicy`（經 `flatSeaCrashPolicy`）。
   */
  collisionHeightAt(x: number, z: number): number
  /**
   * **水面**的高度，m。**沒有水的地方回 `-Infinity`。**
   *
   * 【為什麼與 `heightAt` 分家】`heightAt` 回的是「陸地與海面取 max」，
   * 而水柱、殘骸與碎片問的是另一件事：**這裡碰到的是水嗎**。用 `heightAt`
   * 的話，摔在島上會噴水柱 —— 群島早就有這個缺陷，純內陸則是每一次墜毀
   * 都會發生。
   *
   * 【誰讀它】`main.ts` 交給 `render/wrecks.ts`、`render/debris.ts` 與
   * 水柱那一支。撞地判定不讀它（那一條走 `collisionHeightAt`）。
   *
   * 【不吃 `time`】呼叫端拿到的是這一格的平均水位。波的相位由
   * `ocean.heightAt` 內部的時間決定，這裡傳 0 —— 水柱因此貼在平均水位上。
   * 試飛看得出來的話再把 `time` 一路帶下去。
   */
  waterAt(x: number, z: number): number
  /**
   * AI 的地形來源。**圓盤法只需要這個，不需要高度場。**
   *
   * 【為什麼不給 AI 高度場】沿航跡取樣高度會漏 —— 步長比格距大的話，
   * 射線跨得過一整座窄峰。島本來就是圓，用圓去判斷是解析的、沒有取樣、
   * 而且知道自己在繞哪一座。`'sea'` 時是空陣列。
   */
  readonly islands: readonly IslandDesc[]
  /**
   * 這一場的陸地。**`null` = 沒有陸地**（`'sea'`）。
   *
   * 【誰讀它】`World.land`（彈丸撞到山就爆火花並回收）與 AI 的遮蔽判斷
   * （不對山後面的敵人開火、不對山後面的瞄準閃躲）。
   *
   * 【它與 `islands` 是兩件事】避障讀 `islands` 的解析圓盤，遮蔽讀這一份
   * 高度場 —— 因為遮蔽要的正是「畫面上那個面」。見 `world/occlusion.ts`。
   *
   * 【為什麼 `'sea'` 不給一個假的平原】造一個 `ceiling = SEA_FLOOR` 的物件
   * 會讓每一發入海的彈丸都去查高度場，而且「陸地要高於海平面」會變成唯一
   * 擋住海面回歸的東西。`null` 加上那道判準是兩道保險。
   */
  readonly land: LandField | null
  /**
   * 田色 clipmap。**只有內陸而且建地形時給了 `TerrainGfx` 才有**，否則 `null`。
   * 畫質換檔位時經它調內圈半徑；量測出口經它讀挪窗統計。
   */
  readonly fieldClip: FieldClipmap | null
  /**
   * 換時段。**海的那一半**（陸地與植被的顏色這一期不跟著換，見
   * `timeOfDay.ts`）。
   */
  setPalette(p: DayPalette): void
  /** 每幀更新。海浪要動；陸地是靜態的；植被跟著鏡頭補格 */
  update(time: number, centerX: number, centerZ: number): void
  /**
   * 把植被的生成佇列一次排乾。**沒有植被的地形不提供這一支。**
   *
   * 【誰要它】`main.ts` 的 `__still`：定格截圖與逐像素比對前必須讓植被長齊，
   * 否則拍到的是一片還沒補完的地。引擎每幀只生四格，光靠 `update` 要五十幀。
   */
  settle?(): void
  /**
   * 這一點落在哪一圈：樹、灌木、房子的級數與地面由哪一層畫。測距工具
   * （`hud/rangeProbe.ts`）用，距離從上一次 `update` 的中心量。**只有內陸有**
   */
  describeAt?(x: number, z: number): readonly string[]
  dispose(): void
}

/**
 * 植被在水平距離 `d` 的級數，與 `vegetation.ts` 的門檻相同。換級是整格（250 m）
 * 一起換、用格心量，所以門檻附近差得到半格
 */
function floraRings(d: number): string[] {
  const km = (m: number): string => `${m / 1000} km`
  const outerLo = FLORA_RADIUS * (1 - OUTER_JITTER)
  const gone = d > FLORA_RADIUS
  const edge = d > outerLo && !gone
  const tree = gone ? '不畫（烘在地面）'
    : edge ? `點／消失的邊界帶（${km(outerLo)}～${km(FLORA_RADIUS)}，每格不同）`
      : d > POINT_NEAR ? `點（${km(POINT_NEAR)}～${km(outerLo)}）`
        : d > LOD_NEAR ? `簡化樹冠（${km(LOD_NEAR)}～${km(POINT_NEAR)}）`
          : `完整樹冠＋樹幹（${km(LOD_NEAR)} 內）`
  const bush = gone ? '不畫' : edge ? '點／消失的邊界帶' : d > BUSH_RANGE ? `點（${km(BUSH_RANGE)} 外）` : `模型（${km(BUSH_RANGE)} 內）`
  const house = gone ? '不畫（屋頂色塊烘在地面）' : edge ? '模型／消失的邊界帶' : `模型（${km(outerLo)} 內）`
  return [`樹：${tree}`, `灌木：${bush}`, `房子：${house}`]
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
}

export function createTerrain(kind: TerrainKind, gfx?: TerrainGfx): Terrain {
  if (kind === 'farmland') return createFarmlandTerrain(gfx)
  if (kind === 'autumnFarmland') return createAutumnFarmlandTerrain(gfx)
  if (kind === 'leuna') return createLeunaTerrain(gfx)
  if (kind === 'poltava') return createPoltavaTerrain(gfx)
  if (kind === 'asch') return createAschTerrain(gfx)
  if (kind === 'leyte') return createLeyteTerrain()
  if (kind === 'sea') return createSeaTerrain()
  return createArchipelagoTerrain()
}

/**
 * 雷伊泰：半邊是海、半邊是平坦的大島。**海面、浪花、地面網格與植被的機制
 * 照群島**，差別在生成器（`world/leyte.ts`）、切成方塊的地面與路（`leyteGround.ts`）、
 * 闊葉樹（`createLeyteFlora`）。
 *
 * 【children 的順序照群島】0 遠海、1 海、2 陸地、3 植被 —— 前三個是 `main.ts`
 * 的 `__gfx` 與工具共用的索引契約。
 */
function createLeyteTerrain(): Terrain {
  const { field, hills } = createLeyte()
  const ocean = createOcean(bakeShore(field))
  // 【樹冠圖先粗後細】精細的那一張要烘兩秒多，放在背景執行緒；烘好之前是粗的
  // 平均暗綠。場已經收掉的話不換
  const ground = createLeyteGround(field, leyteCanopyCoarse(field), leyteFarCover)
  let disposed = false
  void requestLeyteCanopy()?.then((map) => {
    if (map !== null && !disposed) ground.setCanopy(map)
  })
  // 【容量是雷伊泰自己的】樹是闊葉樹，而群島的闊葉池只留了 16 格防呆 ——
  // 超出的由 `stats.overflow` 靜靜丟掉。半徑用預設的 6 km：群島的 12 km 是建立
  // 在「七千格裡只有三百格有東西」上，雷伊泰的陸地是整片，照搬的話非空的格子
  // 多一個量級。單格上限用群島的（丘陵上的林子單格可到五百多株）
  const flora = createVegetation(
    [createLeyteFlora(field)], (x, z) => field.sample(x, z),
    { capacity: LEYTE_CAPACITY, maxPerTile: ISLAND_MAX_PER_TILE },
  )
  const group = new Group()
  group.add(ocean.farMesh)
  group.add(ocean.mesh)
  group.add(ground.object)
  group.add(flora.object)
  // 【灘頭的佈景排第五個】前四個是索引契約（見上）。木箱堆與停著的車合併成
  // 一顆網格，材質與洛伊納的佈景相同
  const beach = new Mesh(
    buildLeyteBeach((x, z) => field.sample(x, z)),
    new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  )
  group.add(beach)

  return {
    object: group,
    heightAt(x, z, time) {
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, time)
      return h > sea ? h : sea
    },
    collisionHeightAt(x, z) {
      const h = field.sample(x, z)
      return h > 0 ? h : 0
    },
    waterAt(x, z) {
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, 0)
      return h > sea ? -Infinity : sea
    },
    islands: hills,
    land: { field, ceiling: LEYTE_PEAK_MAX, landAbove: 0 },
    fieldClip: null,
    setPalette(p) {
      ocean.setPalette(p)
      flora.setPointLight(p.foliage)
    },
    update(time, centerX, centerZ) {
      ocean.update(time, centerX, centerZ)
      flora.update(centerX, centerZ)
    },
    settle() { flora.settle() },
    dispose() {
      disposed = true
      ocean.dispose()
      ground.dispose()
      flora.dispose()
      beach.geometry.dispose()
      ;(beach.material as MeshStandardMaterial).dispose()
    },
  }
}

function createSeaTerrain(): Terrain {
  const ocean = createOcean(null)
  const group = new Group()
  // 【順序：遠海先進去】繪製順序其實由 `farMesh.renderOrder` 決定（見
  // `ocean.ts`），這裡的次序只影響 `children` 的索引 —— 但讀起來由遠到近，
  // 而測試也靠這個次序（並自我驗證抓對了人）。
  group.add(ocean.farMesh)
  group.add(ocean.mesh)
  // 【第三個位置仍然佔著】索引契約由 `main.ts` 的 `__gfx` 消融表與
  // `src/tools/` 的兩支工具共用。沒有陸地就掛一個空 Group，
  // 那兩邊才不必為了「這一場有沒有島」寫分支。
  group.add(new Group())

  return {
    object: group,
    heightAt: ocean.heightAt,
    collisionHeightAt: () => 0,
    waterAt: (x, z) => ocean.heightAt(x, z, 0),
    islands: [],
    land: null,
    fieldClip: null,
    setPalette(p) { ocean.setPalette(p) },
    update(time, centerX, centerZ) { ocean.update(time, centerX, centerZ) },
    dispose() { ocean.dispose() },
  }
}

function createArchipelagoTerrain(): Terrain {
  // 【陸地要先生出來，海面才接得上】浪花吃的是由高度場推出來的膨脹圖 ——
  // 見 `world/archipelago.ts` 的 `bakeShore`。
  //
  // 【只烘一次】`createArchipelago` 不回傳膨脹圖：headless 的測試與 AI 那一
  // 側都用不到它，讓生成器一律烘等於每個呼叫端都付一次 1024² 的距離傳播。
  const { field, islands } = createArchipelago()
  const ocean = createOcean(bakeShore(field))
  // 【地色先帶上林相】見 `island.ts` 的 `shade`：植被的圈外一棵樹都不畫，
  // 地色若不先按覆蓋率調暗，飛進圈時整座島會同時變暗變花
  const meshes = createIslands(field, islands, islandCanopyCover(field, islands))
  // 【植被 append 在索引 3】前三個是明文契約，見 `main.ts` 的 `__gfx`
  // 【容量與單格上限都是群島專用的】島上只有針葉樹，但密度比農地高一個
  // 量級 —— 見 `ISLAND_CAPACITY` 與 `ISLAND_MAX_PER_TILE`
  const flora = createVegetation(
    [createIslandFlora(field, islands)], (x, z) => field.sample(x, z),
    {
      capacity: ISLAND_CAPACITY, maxPerTile: ISLAND_MAX_PER_TILE,
      radius: ISLAND_RADIUS, tilesPerFrame: ISLAND_TILES_PER_FRAME,
    },
  )
  const group = new Group()
  group.add(ocean.farMesh)
  group.add(ocean.mesh)
  group.add(meshes.object)
  group.add(flora.object)

  return {
    object: group,
    heightAt(x, z, time) {
      // 【取 max，而且陸地那一份不吃 time】陸地是靜態的；海面才有波。
      // 高度場出界回 −Infinity，所以場地之外自然退回純海面。
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, time)
      return h > sea ? h : sea
    },
    // 【海面那一項是 0，不是 ocean.heightAt】見介面上的說明。出界回
    // −Infinity，所以場地之外自然退回平海面
    collisionHeightAt(x, z) {
      const h = field.sample(x, z)
      return h > 0 ? h : 0
    },
    // 【陸地高過海面的地方沒有水】那正是「摔在島上不該噴水柱」
    waterAt(x, z) {
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, 0)
      return h > sea ? -Infinity : sea
    },
    islands,
    // 【`ceiling` 用 PEAK_MAX 而不是實測的最高點】它是一個上界就夠了 ——
    // 高於它的彈丸一定碰不到陸地。用實測值要多掃一次全圖，而且會讓
    // 「動了地形就要重算」多一條沒有人記得的規則
    land: { field, ceiling: PEAK_MAX, landAbove: 0 },
    // 【群島的地色是頂點色】沒有田色算式可以烘
    fieldClip: null,
    setPalette(p) {
      ocean.setPalette(p)
      flora.setPointLight(p.foliage)
    },
    update(time, centerX, centerZ) {
      ocean.update(time, centerX, centerZ)
      flora.update(centerX, centerZ)
    },
    settle() { flora.settle() },
    dispose() {
      ocean.dispose()
      meshes.dispose()
      flora.dispose()
    },
  }
}

function createFarmlandTerrain(gfx?: TerrainGfx): Terrain {
  return createInlandTerrain(createFarmland(), 'summer', undefined, undefined, gfx)
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
function createAutumnFarmlandTerrain(gfx?: TerrainGfx): Terrain {
  return createInlandTerrain(createFarmland(), 'lateAutumn', undefined, undefined, gfx)
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

/** Y-29 的墊面（草）、跑道／滑行帶／停機墊（鋼板網）、連外道路 */
export const ASCH_SITE: SiteLayout = {
  pivot: { x: ASCH_CENTER.x, z: ASCH_CENTER.z },
  pad: ASCH_PAD,
  padHex: ASCH_GRASS,
  treeClear: ASCH_TREE_CLEAR,
  roads: ASCH_ROADS,
  roadWidth: ASCH_ROAD_WIDTH,
  patches: ASCH_PAVED.map((r) => ({ ...r, hex: PSP_STEEL })),
}

/** Y-29：農地的算繪路徑、極緩的丘、深秋的枯色、沒有佈景 */
function createAschTerrain(gfx?: TerrainGfx): Terrain {
  return createInlandTerrain(createAsch(), 'lateAutumn', ASCH_SITE, undefined, gfx)
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
  // 地物的（洛伊納）不開 —— 那一帶是開墾到幾乎不剩空地的黃土平原
  const open = dressing === undefined
  const horizon = createFarHorizon(season, open)
  const ground = createFarmGround(farm.field, season, site, open)
  // 【田色烘成貼圖】地面 25 塊與遠景環一起換材質 —— 兩者本來共用同一支算式，
  // 只換地面的話 15 km 外那一圈會與地面接不上。沒有 GPU 就留著算式的材質
  const clipmap = gfx === undefined ? null : createFieldClipmap(gfx.renderer, {
    season, candidates: ground.candidates, ...(site === undefined ? {} : { site }), open,
    near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR, horizon: FIELD_CLIP_HORIZON, innerRadius: gfx.fieldInner,
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
  const clear = site?.treeClear ?? 0
  const padClear = (s: FloraSource): FloraSource => (site === undefined
    ? s
    : [site.pad, ...(site.padLobes ?? [])].reduce((src, r) => excluding(src, {
      x0: r.x0 - clear, x1: r.x1 + clear,
      z0: r.z0 - clear, z1: r.z1 + clear,
      ...(site.pivot === undefined ? {} : { pivot: site.pivot }),
      ...(site.heading === undefined ? {} : { heading: site.heading }),
    }), s))
  let fields = (open ? [openHedgeFlora, openWoodFlora] : [farmHedgeFlora, farmWoodFlora]).map(padClear)
  // 【建築：植被與烘圖是同一個散佈器】兩邊各包一份的話，遠處的屋頂色塊與近處的
  // 房子對不上。真實地物的建築已經避開河道；程序村沒有，要包河廊
  // 程序生成的地圖的村用洛伊納那一套生成器（`farmSettlements.ts`），蓋到植被圈伸得到
  // 的地方
  const villageReach = farm.field.cell * (farm.field.size - 1) / 2 + FLORA_RADIUS + 1000
  let buildings = padClear(dressing === undefined ? farmSettlementFlora(villageReach) : dressing.buildings)
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
  // 田色算式裡沒有、要另外烘進遠圖的散佈器：建築與村鎮裡的樹、河岸林。與植被
  // 畫的是同一個散佈器，遠處的色塊與近處的模型才對得上
  const splatted: FloraSource[] = [buildings]
  if (bank !== null) {
    fields.push(bank)
    splatted.push(bank)
  }
  fields.push(buildings)
  for (const s of dressing?.flora ?? []) fields.push(padClear(excludingZones(s, wildOut)))
  // 【平貼在地上的都烘進地面】鎮的地面、礦坑、街每一張貼圖都烘，網格不畫；最外層
  // 外面另外畫粗網格。植被圈外建築與樹不畫，屋頂與樹冠的色塊不烘近圖（近窗裡有真的
  // 模型），最後烘、蓋在鎮的地面上。最外層的窗最遠碰得到場地外半個窗寬
  const reach = farm.field.cell * (farm.field.size - 1) / 2
    + FIELD_CLIP_HORIZON.size * FIELD_CLIP_HORIZON.metersPerTexel / 2
  const roofs = clipmap === null ? null : floraSplats(splatted, -reach, -reach, reach, reach, season)
  if (clipmap !== null && roofs !== null) {
    for (const m of dressing?.baked ?? []) {
      clipmap.addOverlay(m.geometry, true)
      clipmap.replaces(m)
    }
    for (const m of dressing?.beyond ?? []) clipmap.beyondFar(m)
    clipmap.addOverlay(roofs, false)
  }
  /** 上一次 `update` 的中心：植被量距離的那一點 */
  const centre = { x: 0, z: 0 }
  const vegetation = createVegetation(fields, (x, z) => solid.sample(x, z), {
    season, ...(dressing === undefined ? {} : { capacity: dressing.capacity }),
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
  let sceneryMesh: Mesh | null = null
  if (scenery !== undefined) {
    const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
    sceneryMesh = new Mesh(scenery(), material)
    group.add(sceneryMesh)
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
        ...floraRings(d),
        `地面：${clipmap === null ? '逐像素算（沒有貼圖）' : clipmap.layerAt(x, z)}`,
      ]
    },
    settle() { vegetation.settle() },
    dispose() {
      horizon.dispose()
      ground.dispose()
      vegetation.dispose()
      clipmap?.dispose()
      roofs?.dispose()
      if (river !== null) disposeRiverMeshes(river)
      dressing?.dispose()
      if (sceneryMesh !== null) {
        sceneryMesh.geometry.dispose()
        ;(sceneryMesh.material as MeshStandardMaterial).dispose()
      }
    },
  }
}
