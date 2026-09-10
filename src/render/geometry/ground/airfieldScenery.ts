import type { BufferGeometry } from 'three'
import { FIELD_CENTER } from '../../../world/poltava'
import { parseGroundGlb } from './glb'

/**
 * # 波爾塔瓦機場的佈景
 *
 * 營舍、塔台、散桶、圍籬、電線桿 —— **一顆合併網格、一個 draw call、沒有
 * 命中盒**。子彈與炸彈穿過去落到地面；目標（停放的 B-17、油桶堆、彈藥堆、
 * 砲位、探照燈）不在這裡，它們是地面目標、各自一顆 Mesh。
 *
 * 【幾何來自 Blender】`tools/blender/build_airfield.py` 建、
 * `public/models/poltava_airfield.glb` 存。佈局改那支腳本，改完重新匯出。
 *
 * 【GLB 的原點是機場中心】載入之後平移到 `FIELD_CENTER`。
 *
 * 【回的是複本】`terrain.dispose()` 會 dispose 佈景的幾何；共用快取被釋放
 * 之後第二次進場會拿到一顆空的 GPU 緩衝 —— 與廠區的佈景同一條規則。
 *
 * 【為什麼載入是非同步、取用是同步】開場 `await preloadAirfieldScenery()`
 * 一次，之後 `buildAirfieldScenery()` 同步從快取拿。地形的組裝是同步的。
 */

export const AIRFIELD_GLB_URL = '/models/poltava_airfield.glb'

let cache: BufferGeometry | null = null

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** 開場 await 一次。重複呼叫是 no-op。node 測試傳自己的 fetcher */
export async function preloadAirfieldScenery(
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBuffer,
): Promise<void> {
  if (cache !== null) return
  const g = await parseGroundGlb(await fetcher(AIRFIELD_GLB_URL))
  g.translate(FIELD_CENTER.x, 0, FIELD_CENTER.z)
  g.computeBoundingSphere()
  cache = g
}

/** 這一場的佈景幾何。**每次進場一份複本** —— 見檔頭 */
export function buildAirfieldScenery(): BufferGeometry {
  if (cache === null) {
    throw new Error('機場的 GLB 還沒載入 —— 少了 preloadAirfieldScenery()')
  }
  return cache.clone()
}
