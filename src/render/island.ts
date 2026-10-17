import {
  BufferGeometry, Color, Group, MeshStandardMaterial,
  type Object3D,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import type { IslandDesc } from '../world/archipelago'
import { buildGroundRect } from './groundGeometry'
import { createTerrainBatch } from './terrainBatch'
import { VIEW_SHADE_GLSL, ViewShadeRow, type ViewShade } from './viewShade'
export { buildGroundRect, DRAW_FLOOR } from './groundGeometry'

/**
 * 把高度場切成 low-poly 的島。
 *
 * 【頂點高度直接讀 `field.data`，不重算】這是 `render/terrain.ts` 那條鐵律
 * 在渲染這一側的落實：畫出來的頂點與撞地判定查到的值必須是同一個數字。
 * 只要這裡改成「自己再算一次 smoothstep」，兩份就開始漂，而症狀是飛機撞到
 * 一片看不見的陸地。`terrain.test.ts` 有一條逐頂點比對的護欄守它。
 *
 * 【每座島各自裁切，共用一個批次】保留各島的包圍球，只提交視錐內的島；
 * 飛機在場地一角時不必畫另一角的島，也不必為每座可見的島各送一次繪製。
 *
 * 【切到 `outerRadius` 而不是 `radius`】島形的 wobble 讓地形延伸到標稱半徑
 * 的 1.29 倍。切在 `radius` 會讓外圈那一環有碰撞卻沒有畫面。
 */

/** 材質共用一份 —— 48 座島的差異全在頂點色裡 */
const ROUGHNESS = 0.95

/** 高度分層的顏色。硬分界，不漸層 —— low-poly 的面就是要看得出來 */
const SAND = new Color(0xc2b280)
const GRASS = new Color(0x4a5f42)
/**
 * 水線以上這個高度之內算沙灘，m。**草帶的下界就是它。**
 *
 * 【為什麼不叫 SHORE_BAND】`world/archipelago.ts` 有一個同名的常數，值是
 * **200** —— 那是烘岸用的距離，量綱都不一樣。同名不同義拿錯完全不報錯，
 * 而症狀是植被的下界變成 200，12～200 m 的大片綠帶光禿。
 */
export const GRASS_MIN_HEIGHT = 12
/**
 * 樹冠的平均色。針葉與灌木按樹冠面積加權 —— `CONE_CROWN_R²` 對
 * `ISLAND_BUSH_RATIO × BUSH_R²`，也就是 66% 對 34%。
 *
 * 【為什麼不 import `floraShapes` 的那三個顏色】`island.ts` 是被
 * `flora.ts` import 的那一端，反過來會成環。這是一個常數，由那兩個顏色
 * 算一次寫死；`island-shade.test.ts` 釘著它。
 */
export const CANOPY = new Color(0x30452e)

/**
 * 這個高度、被樹冠遮住這麼多時，地該是什麼顏色。
 *
 * 【只有兩段】水線上是沙、再上去全是草，一路到峰頂。島是綠的。
 *
 * 【草的那一段要先帶上林相】`FLORA_RADIUS` 外一棵樹都不畫，而地色比樹冠
 * 亮很多 —— 飛進圈的瞬間整座島同時變暗變花。先按實際被遮住的面積比往樹冠
 * 色混，樹進圈就只是加上質感。覆蓋率由 `flora.ts` 的 `islandCanopyCover`
 * 算，與植被的放置同源。
 *
 * 【沙灘不吃覆蓋率】樹長不到那裡去。
 */
export function shade(h: number, cover: number, out: Color): Color {
  if (h < GRASS_MIN_HEIGHT) return out.copy(SAND)
  return out.copy(GRASS).lerp(CANOPY, Math.min(1, Math.max(0, cover)))
}

/**
 * 這裡看起來是草嗎。**島上的樹只長在回真的地方。**
 *
 * 【為什麼是謂語而不是一個常數】判準與地的顏色必須是同一條式子，不然會出現
 * 樹長在沙灘上。給一支謂語，放置那一側根本不必看到常數，也就沒有拿錯
 * `SHORE_BAND` 的機會。`island-shade.test.ts` 逐高度比對它與 `shade`。
 *
 * 【不吃坡度】實測群島的島很陡：草帶 16.24 km² 裡坡度 20° 以內只有 3.7%。
 * 用坡度當判準會砍掉 95% 的地 —— 坡度只用來壓密度。
 */
export function isGrass(h: number): boolean {
  return h >= GRASS_MIN_HEIGHT
}

/**
 * 一座島的 geometry。範圍取不到任何格點時回 null（島小到落在格線之間）。
 */
function buildIsland(
  field: HeightFieldData, isl: IslandDesc, coverAt: (x: number, z: number) => number,
): BufferGeometry | null {
  const { size, cell } = field
  const half = (size - 1) / 2
  const last = size - 1

  const c0 = Math.max(0, Math.floor((isl.cx - isl.outerRadius) / cell + half))
  const c1 = Math.min(last, Math.ceil((isl.cx + isl.outerRadius) / cell + half))
  const r0 = Math.max(0, Math.floor((isl.cz - isl.outerRadius) / cell + half))
  const r1 = Math.min(last, Math.ceil((isl.cz + isl.outerRadius) / cell + half))
  return buildGroundRect(field, c0, c1, r0, r1, coverAt, shade, canopyShare)
}

/** 地色裡林相佔幾成，與 `shade` 同一條式子：沙灘是 0 */
function canopyShare(h: number, cover: number): number {
  return isGrass(h) ? Math.min(1, Math.max(0, cover)) : 0
}

/**
 * 地面材質。**林相那一份隨視角變亮暗**：頂點的 `canopyShare` 是地色裡 `CANOPY` 佔的
 * 份量，片段把那一份乘上視角係數（`viewShade.ts`）—— 島上的樹迎光暗、背光亮，圈外
 * 烘在地色裡的林子要跟著
 */
function islandMaterial(shade: ViewShade): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: ROUGHNESS })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shade.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float canopyShare;\nvarying float vCanopyShare;\nvarying vec3 vIslandWorld;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vCanopyShare = canopyShare;
vIslandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCanopyShare;\nvarying vec3 vIslandWorld;' + VIEW_SHADE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb += vCanopyShare * vec3(${CANOPY.r.toFixed(4)}, ${CANOPY.g.toFixed(4)}, ${CANOPY.b.toFixed(4)})
  * (viewShade(${ViewShadeRow.Ground.toFixed(1)}, normalize(cameraPosition - vIslandWorld)) - 1.0);`)
  }
  m.customProgramCacheKey = () => 'island-ground-view'
  return m
}

export function createIslands(
  field: HeightFieldData, islands: readonly IslandDesc[],
  /**
   * 這一點的地被樹冠遮住多少，0～1。**注入而不是 import** ——
   * `flora.ts` 已經 import 這個檔案的 `isGrass`，反過來會成環。組裝的人是
   * `terrain.ts`。不傳就是不上林相色。
   */
  coverAt: (x: number, z: number) => number,
  shade: ViewShade,
): { object: Object3D; dispose(): void } {
  const group = new Group()
  const material = islandMaterial(shade)
  const geometries: BufferGeometry[] = []

  for (const isl of islands) {
    const geo = buildIsland(field, isl, coverAt)
    if (geo === null) continue
    geometries.push(geo)
  }
  const view = createTerrainBatch(geometries, material)
  if (view.mesh !== null) group.add(view.mesh)

  return {
    object: group,
    dispose() {
      view.dispose()
      material.dispose()
    },
  }
}
