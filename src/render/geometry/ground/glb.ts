import { BufferAttribute, BufferGeometry, Color, Material, Mesh, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { HUE } from './parts'

/**
 * 由 GLB 載入的地面單位。來源是 `tools/blender/build_ground.py`。
 *
 * 【GLB 只帶幾何，顏色是遊戲的】Blender 裡的材質只有名字算數：載入時照名字查
 * `GLB_MATERIALS` 貼成頂點色，然後**整台併成一顆幾何** —— 與 `parts.ts` 的
 * `assemble` 同一個產物（不共用頂點、頂點色、一個 draw call），所以展示區與
 * 護欄測試不必分辨一台是 GLB 來的還是盒子疊的。
 *
 * 【名字對不上就丟】GLB 裡多了一個材質、或表裡多了一個沒人用的名字，都是
 * manifest 過期 —— 靜靜地塗成預設色比丟例外難抓得多。與 `geometry/glb.ts`
 * 的機種同一條紀律。
 *
 * 【為什麼載入是非同步、取用是同步】`GLTFLoader.parse` 走 Promise；而展示區與
 * 測試要的是「給我這台的幾何」。做法與飛機、船相同：開場 `await` 一次
 * `preloadGroundGlbs`，之後 `groundGlb` 同步從快取拿。
 */

/** GLB 材質名 → 遊戲顏色。**名字是與 build_ground.py 的合約。** */
export const GLB_MATERIALS: Readonly<Record<string, number>> = {
  LP_ArmorGreen: HUE.armyGreen,
  LP_Track: HUE.rubber,
  LP_Steel: HUE.steel,
  LP_TruckGreen: HUE.armyGreen,
  LP_Canvas: HUE.canvas,
  LP_Tire: HUE.rubber,
  LP_Glass: HUE.glass,
  LP_GunGrey: HUE.sandYellow,
}

const C = /* @__PURE__ */ new Color()

export async function parseGroundGlb(buf: ArrayBuffer): Promise<BufferGeometry> {
  const scene = await new Promise<Object3D>((res, rej) => {
    new GLTFLoader().parse(buf, '', (gltf) => res(gltf.scene), rej)
  })
  scene.updateMatrixWorld(true)

  const parts: BufferGeometry[] = []
  const seen = new Set<string>()
  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const name = (mesh.material as Material).name
    const hex = GLB_MATERIALS[name]
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
  const res = await fetch(url)
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** 開場 await 一次。重複呼叫是 no-op。 */
export async function preloadGroundGlbs(
  urls: readonly string[],
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBuffer,
): Promise<void> {
  await Promise.all([...new Set(urls)].map(async (url) => {
    if (cache.has(url)) return
    cache.set(url, await parseGroundGlb(await fetcher(url)))
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
