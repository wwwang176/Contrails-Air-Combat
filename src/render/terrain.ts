import { Group, type Object3D } from 'three'
import { createOcean } from './ocean'
import type { DayPalette } from './timeOfDay'
import { createIslands } from './island'
import { createFarmGround } from './farmGround'
import { createFarHorizon } from './farHorizon'
import {
  createVegetation, ISLAND_CAPACITY, ISLAND_MAX_PER_TILE, ISLAND_RADIUS,
  ISLAND_TILES_PER_FRAME,
} from './vegetation'
import {
  createIslandFlora, farmHedgeFlora, farmVillageFlora, farmWoodFlora, islandCanopyCover,
} from './flora'
import { bakeShore, createArchipelago, PEAK_MAX, type IslandDesc } from '../world/archipelago'
import { createFarmland, outsideZero, HILL_PEAK_MAX } from '../world/farmland'
import { createLeuna } from '../world/leuna'
import type { HeightFieldData } from '../world/heightfield'
import type { Season } from './season'
import type { LandField } from '../world/occlusion'
import type { TerrainKind } from '../world/terrainKind'

// 【聯集本身住在 world/】見 `world/terrainKind.ts`。這裡再匯出，
// 既有的 import 站點不用動
export type { TerrainKind }

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
  dispose(): void
}

/**
 * 【三條互不相干的頂層分支】重整之前是「先建好群島與海面，再判斷是不是
 * `'sea'`」—— 那樣加第三種地形會憑空多出兩個 child，而且洩漏 ocean 的資源。
 */
export function createTerrain(kind: TerrainKind): Terrain {
  if (kind === 'farmland') return createFarmlandTerrain()
  if (kind === 'leuna') return createLeunaTerrain()
  if (kind === 'sea') return createSeaTerrain()
  return createArchipelagoTerrain()
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

function createFarmlandTerrain(): Terrain {
  return createInlandTerrain(createFarmland(), 'summer')
}

/** 洛伊納：農地的算繪路徑、手擺的丘陵、晚秋的色盤 */
function createLeunaTerrain(): Terrain {
  return createInlandTerrain(createLeuna(), 'lateAutumn')
}

/**
 * 內陸地形的共用算繪：田區、遠景環、三種散佈器。農地與洛伊納只差高度場、
 * 丘陵與季節。
 */
function createInlandTerrain(
  farm: { field: HeightFieldData; hills: IslandDesc[] }, season: Season,
): Terrain {
  const horizon = createFarHorizon(season)
  const ground = createFarmGround(farm.field, season)
  const group = new Group()
  // 【場外回 0，不是 −Infinity】內陸沒有海可以退回去。遮蔽層與植被拿到的
  // 也是這一份 —— 見 `outsideZero`
  const solid = outsideZero(farm.field)
  const flora = createVegetation(
    [farmHedgeFlora, farmWoodFlora, farmVillageFlora], (x, z) => solid.sample(x, z), { season },
  )
  // 【四個位置的次序與另外兩種相同】0 = 遠景環（遠海那一格）、
  // 1 = 空 Group（近海那一格）、2 = 陸地、3 = 植被
  group.add(horizon.mesh)
  group.add(new Group())
  group.add(ground.object)
  group.add(flora.object)

  return {
    object: group,
    // 【不吃 time】內陸沒有波
    heightAt: (x, z) => solid.sample(x, z),
    collisionHeightAt: (x, z) => solid.sample(x, z),
    waterAt: () => -Infinity,
    // 【內陸沒有海】田地、遠景環與近中兩級的樹都走標準材質，換了燈自己就
    // 變暗；要補的只有吃不到光的點池
    setPalette(p) { flora.setPointLight(p.foliage) },
    islands: farm.hills,
    land: { field: solid, ceiling: HILL_PEAK_MAX, landAbove: -Infinity },
    // 【遠景環與地面是固定的】只有植被要跟著鏡頭補格
    update(_time, centerX, centerZ) { flora.update(centerX, centerZ) },
    settle() { flora.settle() },
    dispose() {
      horizon.dispose()
      ground.dispose()
      flora.dispose()
    },
  }
}
