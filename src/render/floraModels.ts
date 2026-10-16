import { BufferAttribute, BufferGeometry, Color, type Mesh, type Object3D } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createGltfLoader } from './geometry/gltfLoader'
import { assetUrl } from '../core/asset'

/**
 * 植被近距離兩級的模型：`models-src/flora_*.glb`。
 *
 * 【模型約定】每支 GLB 的網格節點以 `extras.part` 分成 `trunk` 與 `crown`
 * （灌木只有 `crown`）。原點在底面中心、底面 y = 0，尺寸是縮放 1.0 的那一株
 * （喬木頂端 `TREE_HEIGHT`、樹冠水平外接半徑等於 `specs/flora.ts` 的樹冠常數）。
 * GLB 的材質不用 —— 顏色由 `floraModelGeometry` 依季節逐頂點寫入。
 *
 * 【為什麼載入是非同步、取用是同步】植被池在地形組裝時同步建立。開場
 * `preloadStartupAssets` await 一次，之後 `floraModel` 同步從快取拿；還沒載入時
 * 回 null，由 `floraShapes.ts` 退回程序幾何。
 */

export type FloraSpecies = 'broad' | 'cone' | 'bush'
export type FloraLevel = 'high' | 'mid'

export const FLORA_MODEL_URLS: Readonly<Record<FloraSpecies, Readonly<Record<FloraLevel, string>>>> = {
  broad: { high: '/models/flora_broad.glb', mid: '/models/flora_broad_mid.glb' },
  cone: { high: '/models/flora_cone.glb', mid: '/models/flora_cone_mid.glb' },
  bush: { high: '/models/flora_bush.glb', mid: '/models/flora_bush_mid.glb' },
}

/** 開場要載的 GLB 支數（載入進度用） */
export const FLORA_MODEL_COUNT = 6

/**
 * 解析好的一支模型：展開索引、套過節點變換的三角形。**樹幹的頂點在前、樹冠在後**，
 * 與程序幾何同一個順序 —— 測試與點池的參照都拿最後一個頂點當樹冠色。池幾何由
 * `floraModelGeometry` 再併回有索引的形式。
 */
export interface FloraModel {
  readonly position: Float32Array
  /** 第幾個頂點起是樹冠 */
  readonly crownFrom: number
}

let cache: Record<FloraSpecies, Record<FloraLevel, FloraModel>> | null = null

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(url))
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

async function parseScene(buf: ArrayBuffer): Promise<Object3D> {
  return new Promise<Object3D>((res, rej) => {
    createGltfLoader().parse(buf, '', (gltf) => res(gltf.scene), rej)
  })
}

/** 把一支 GLB 的網格依 `part` 收成兩段三角形 */
export function bakeFloraScene(scene: Object3D, url: string): FloraModel {
  scene.updateMatrixWorld(true)
  const parts: Record<'trunk' | 'crown', Float32Array[]> = { trunk: [], crown: [] }
  scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const part: unknown = mesh.userData['part']
    if (part !== 'trunk' && part !== 'crown') {
      throw new Error(`${url} 的網格 ${mesh.name} 沒有 part（trunk／crown）`)
    }
    // 【一定要是複本】`toNonIndexed` 遇到本來就沒有索引的幾何會回傳原物件；兩個節點
    // 共用同一份幾何時，套第二個節點的變換會連第一份一起改
    const src = mesh.geometry
    const g = src.index === null ? src.clone() : src.toNonIndexed()
    g.applyMatrix4(mesh.matrixWorld)
    parts[part].push(g.getAttribute('position').array as Float32Array)
    g.dispose()
  })
  if (parts.crown.length === 0) throw new Error(`${url} 沒有樹冠（part = crown）`)
  const all = [...parts.trunk, ...parts.crown]
  const position = new Float32Array(all.reduce((n, a) => n + a.length, 0))
  let at = 0
  for (const a of all) {
    position.set(a, at)
    at += a.length
  }
  const crownFrom = parts.trunk.reduce((n, a) => n + a.length, 0) / 3
  return { position, crownFrom }
}

/** 用到之前 await 一次。重複呼叫是 no-op。node 測試傳自己的 fetcher */
export async function preloadFloraModels(
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBuffer,
  onLoaded: () => void = () => {},
): Promise<void> {
  if (cache !== null) {
    for (let i = 0; i < FLORA_MODEL_COUNT; i++) onLoaded()
    return
  }
  const out = {} as Record<FloraSpecies, Record<FloraLevel, FloraModel>>
  await Promise.all((Object.keys(FLORA_MODEL_URLS) as FloraSpecies[]).flatMap((sp) => {
    out[sp] = {} as Record<FloraLevel, FloraModel>
    return (['high', 'mid'] as const).map(async (lv) => {
      const url = FLORA_MODEL_URLS[sp][lv]
      out[sp][lv] = bakeFloraScene(await parseScene(await fetcher(url)), url)
      onLoaded()
    })
  }))
  cache = out
}

/** 已載入的模型；還沒載入回 null */
export function floraModel(species: FloraSpecies, level: FloraLevel): FloraModel | null {
  return cache === null ? null : cache[species][level]
}

const C = new Color()

/**
 * 一支模型的池幾何：**有索引**，position／color／normal。顏色每次呼叫重寫 ——
 * 同一份快取要給不同季節用。
 *
 * 【共用頂點】位置與顏色都相同的頂點併成一個，三角形的次序與繞向不變。一株要畫
 * 上千份，頂點運算是這幾池的主要成本：80 面的葉團不共用是 240 個頂點、共用是 42 個，
 * 實測雷伊泰低空這幾池由 2.7 ms 降到 0.4 ms。外觀不變 —— 材質開了 `flatShading`，
 * 面法線在片段著色器由螢幕導數算，`normal` 屬性不參與光照（留著只是給需要它的
 * 消費者）。樹幹與樹冠交界的頂點顏色不同，不會被併掉。
 */
export function floraModelGeometry(m: FloraModel, trunkHex: number, crownHex: number): BufferGeometry {
  const n = m.position.length / 3
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    C.setHex(i < m.crownFrom ? trunkHex : crownHex)
    col[i * 3] = C.r
    col[i * 3 + 1] = C.g
    col[i * 3 + 2] = C.b
  }
  const soup = new BufferGeometry()
  soup.setAttribute('position', new BufferAttribute(m.position, 3))
  soup.setAttribute('color', new BufferAttribute(col, 3))
  const geo = mergeVertices(soup)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
