import { BufferAttribute, BufferGeometry, Color, Material, Mesh, Object3D } from 'three'
import { createGltfLoader } from '../gltfLoader'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLB_MATERIALS, PLANT_MATERIALS } from './palette'
export { GLB_MATERIALS, PLANT_MATERIALS } from './palette'
import { assetUrl } from '../../../core/asset'

const C = /* @__PURE__ */ new Color()

export async function parseGroundGlb(buf: ArrayBuffer): Promise<BufferGeometry> {
  const scene = await new Promise<Object3D>((res, rej) => {
    createGltfLoader().parse(buf, '', (gltf) => res(gltf.scene), rej)
  })
  scene.updateMatrixWorld(true)

  const parts: BufferGeometry[] = []
  const seen = new Set<string>()
  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const name = (mesh.material as Material).name
    const hex = GLB_MATERIALS[name] ?? PLANT_MATERIALS[name]
    if (hex === undefined) throw new Error(`GLB 材質 ${name} 沒有對應的遊戲顏色`)
    seen.add(name)

    // 烘進世界座標、展開索引（不共用頂點 → flat shading 的稜線是硬的），
    // 只留位置與顏色：法線由合併後統一算，UV 沒有人用。
    const g = mesh.geometry.toNonIndexed()
    g.applyMatrix4(mesh.matrixWorld)
    for (const attr of Object.keys(g.attributes)) {
      if (attr !== 'position') g.deleteAttribute(attr)
    }
    C.setHex(hex)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = C.r
      col[i * 3 + 1] = C.g
      col[i * 3 + 2] = C.b
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    parts.push(g)
  })
  if (parts.length === 0) throw new Error('GLB 裡沒有任何網格')

  const geo = mergeGeometries(parts)
  if (geo === null) throw new Error('地面單位的 GLB 合併失敗 —— 屬性不一致')
  for (const p of parts) p.dispose()
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  geo.userData['materials'] = [...seen]
  return geo
}

const cache = new Map<string, BufferGeometry>()

/** 預設的取檔方式。node 測試自己讀檔、傳自己的 fetcher。 */
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(url))
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

/**
 * 開場 await 一次。重複呼叫是 no-op。
 *
 * @param onLoaded 每一支好了呼叫一次（已經載過的也算），次數是 `urls` 去重後的數量
 */
export async function preloadGroundGlbs(
  urls: readonly string[],
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBuffer,
  onLoaded: () => void = () => {},
): Promise<void> {
  await Promise.all([...new Set(urls)].map(async (url) => {
    if (!cache.has(url)) cache.set(url, await parseGroundGlb(await fetcher(url)))
    onLoaded()
  }))
}

/**
 * 已載入的幾何。**同一份共用**，不 clone —— 幾何是唯讀的，幾台同款各自
 * 一顆 Mesh 指著同一份就好。
 */
export function groundGlb(url: string): BufferGeometry {
  const g = cache.get(url)
  if (g === undefined) throw new Error(`${url} 還沒載入 —— 少了 preloadGroundGlbs()`)
  return g
}
