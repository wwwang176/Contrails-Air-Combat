import { Group, Mesh, MeshStandardMaterial } from 'three'
import { createOcean } from './ocean'
import { createIslands } from './island'
import { createVegetation } from './vegetation'
import { createIslandFlora, islandCanopyCover } from './islandFlora'
import { createLeyteFlora, leyteCanopyCoarse, leyteFarCover } from './leyteFlora'
import { requestLeyteCanopy } from './canopyBake'
import { createLeyteGround } from './leyteGround'
import { buildLeyteBeach } from './leyteBeach'
import { createLeyte, LEYTE_PEAK_MAX } from '../world/leyte'
import { bakeShore, createArchipelago, PEAK_MAX } from '../world/archipelago'
import {
  ISLAND_CAPACITY, ISLAND_MAX_PER_TILE, ISLAND_RADIUS, ISLAND_TILES_PER_FRAME, LEYTE_CAPACITY,
} from './vegetationPolicy'
import type { Terrain } from './terrainTypes'

/**
 * 雷伊泰：半邊是海、半邊是平坦的大島。**海面、浪花、地面網格與植被的機制
 * 照群島**，差別在生成器（`world/leyte.ts`）、切成方塊的地面與路（`leyteGround.ts`）、
 * 闊葉樹（`createLeyteFlora`）。
 *
 * 【children 的順序照群島】0 遠海、1 海、2 陸地、3 植被 —— 前三個是 `main.ts`
 * 的 `__gfx` 與工具共用的索引契約。
 */
export function createLeyteTerrain(): Terrain {
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
    oceanHeight: ocean.heightUniforms,
    setPalette(p) {
      ocean.setPalette(p)
      flora.setPointLight(p.foliage)
    },
    update(time, centerX, centerZ) {
      ocean.update(time, centerX, centerZ)
      flora.update(centerX, centerZ)
    },
    cull(camera) {
      ocean.cull(camera)
      flora.cull(camera)
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

export function createSeaTerrain(): Terrain {
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
    oceanHeight: ocean.heightUniforms,
    setPalette(p) { ocean.setPalette(p) },
    update(time, centerX, centerZ) { ocean.update(time, centerX, centerZ) },
    cull(camera) { ocean.cull(camera) },
    dispose() { ocean.dispose() },
  }
}

export function createArchipelagoTerrain(): Terrain {
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
    oceanHeight: ocean.heightUniforms,
    setPalette(p) {
      ocean.setPalette(p)
      flora.setPointLight(p.foliage)
    },
    update(time, centerX, centerZ) {
      ocean.update(time, centerX, centerZ)
      flora.update(centerX, centerZ)
    },
    cull(camera) {
      ocean.cull(camera)
      flora.cull(camera)
    },
    settle() { flora.settle() },
    dispose() {
      ocean.dispose()
      meshes.dispose()
      flora.dispose()
    },
  }
}
