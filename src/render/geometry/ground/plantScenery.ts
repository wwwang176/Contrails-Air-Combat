import type { BufferGeometry } from 'three'
import { PLANT_CENTER } from '../../../world/leuna'
import { parseGroundGlb } from './glb'

/**
 * # 洛伊納廠區的佈景
 *
 * 街廓、管廊、廠房、儲槽、調車場、圍牆、煙囪 —— **一顆合併網格、一個
 * draw call、沒有命中盒**。子彈與炸彈穿過去落到地面；可炸的只有
 * `PLANT_LAYOUT` 那十二座構件（它們是地面目標，各自一顆 Mesh，仍由
 * `plant.ts` 程序化生）。
 *
 * 【幾何來自 Blender】`tools/blender/build_plant.py` 建、
 * `public/models/leuna_plant.glb` 存。廠區的佈局、密度、每一座設備的位置
 * 都在那支腳本與那份 .blend 裡改，改完重新匯出就好。
 *
 * 【GLB 的原點是廠區中心】Blender 裡以中心為原點才好操作；載入之後平移到
 * `PLANT_CENTER`。
 *
 * 【回的是複本】`terrain.dispose()` 會 dispose 佈景的幾何。共用快取被釋放
 * 之後，第二次進洛伊納會拿到一顆空的 GPU 緩衝 —— 畫面上是整片廠區消失，
 * 而且不報錯。
 *
 * 【為什麼載入是非同步、取用是同步】與飛機、船、地面單位相同：開場
 * `await preloadPlantScenery()` 一次，之後 `buildPlantScenery()` 同步從
 * 快取拿。地形的組裝是同步的。
 */

export const PLANT_GLB_URL = '/models/leuna_plant.glb'

let cache: BufferGeometry | null = null

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** 開場 await 一次。重複呼叫是 no-op。node 測試傳自己的 fetcher */
export async function preloadPlantScenery(
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBuffer,
): Promise<void> {
  if (cache !== null) return
  const g = await parseGroundGlb(await fetcher(PLANT_GLB_URL))
  g.translate(PLANT_CENTER.x, 0, PLANT_CENTER.z)
  g.computeBoundingSphere()
  cache = g
}

/** 這一場的佈景幾何。**每次進場一份複本** —— 見檔頭 */
export function buildPlantScenery(): BufferGeometry {
  if (cache === null) {
    throw new Error('廠區的 GLB 還沒載入 —— 少了 preloadPlantScenery()')
  }
  return cache.clone()
}
