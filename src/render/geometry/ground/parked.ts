import {
  BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Vector3,
  type Mesh, type MeshStandardMaterial, type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEG } from '../../../core/math'
import { glbTemplate } from '../glb'

/**
 * 停在地上的飛機：把機種的 GLB 樣板烘成**一顆**地面單位的幾何 —— 每一顆
 * mesh 套上自己的世界矩陣、材質色塗成頂點色、合併。產物與 `parseGroundGlb`
 * 同一種（不共用頂點、頂點色、一個 draw call），`render/groundTargets.ts`
 * 不必分辨。
 *
 * 【停放姿態】尾輪機停著時機尾下沉，然後整台抬到最低點貼 0、前後置中 ——
 * 地面單位的約定是底面在 y = 0、原點在腳印中心。GLB 沒有起落架，從投彈
 * 高度的夜空看下去是剪影。
 *
 * 【槳盤不烘】它是螺旋槳轉動時的殘影（`CircleGeometry`），停著的飛機只有
 * 槳葉。
 *
 * 【烘一次、每次回複本】`groundGeometry` 對每一台都叫一次 `build`，而
 * `createGroundModels` 會 dispose 程序化那幾台的幾何 —— 回共用的那一份的話
 * 第一台被 dispose 之後其餘 23 台就空了。快取烘好的、回 `clone()`。
 */
export const PARKED_TAIL_DOWN = 10 * DEG

/**
 * 烘好的幾何在 `userData` 的這一格記著烘焙的平移（`{ x, y, z }`，套在下沉之後）。
 * 幾何頂點 = 平移 ＋ 下沉 × 機體座標。
 */
export const PARKED_OFFSET_KEY = 'parkedOffset'

/**
 * `spinProp` 烘出來的幾何在 `userData` 的這一格記著拆出來的槳葉（`ParkedProp`）。
 * 所有複本共用同一份槳葉幾何。
 */
export const PARKED_PROP_KEY = 'parkedProp'

/**
 * 拆出來的一具螺旋槳。`geometry` 以轉軸為原點、轉軸是 Z（與飛行中的槳轂同一個
 * 座標）；`hub` 是轉軸在烘好的幾何裡的位置。擺上去時先套機尾下沉，再繞 Z 轉。
 */
export interface ParkedProp {
  readonly geometry: BufferGeometry
  readonly hub: { readonly x: number; readonly y: number; readonly z: number }
}

const C = /* @__PURE__ */ new Color()
const M = /* @__PURE__ */ new Matrix4()
const IDENTITY = /* @__PURE__ */ new Quaternion()
const baked = new Map<string, BufferGeometry>()

/** 一顆網格烘成位置＋頂點色、不帶其他屬性。`matrix` 套在頂點上 */
function bakePart(mesh: Mesh, matrix: Matrix4): BufferGeometry {
  // 【不動樣板】`toNonIndexed` 對沒有索引的幾何原樣回傳自己 —— 之後的
  // 套矩陣、刪屬性、dispose 就會打在共用的樣板上
  const g = mesh.geometry.index !== null ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
  g.applyMatrix4(matrix)
  for (const attr of Object.keys(g.attributes)) {
    if (attr !== 'position') g.deleteAttribute(attr)
  }
  // 吃塗裝的材質本身是白色，顏色在貼圖上；頂點色取它留下的單色
  const mat = mesh.material as MeshStandardMaterial
  C.set((mat.userData['bakeColor'] as number | undefined) ?? mat.color)
  const n = g.getAttribute('position').count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = C.r
    col[i * 3 + 1] = C.g
    col[i * 3 + 2] = C.b
  }
  g.setAttribute('color', new BufferAttribute(col, 3))
  return g
}

/**
 * @param spinProp 槳葉不烘進機身，拆成 `PARKED_PROP_KEY` 那一份讓渲染層轉。
 *   包圍盒照舊把槳葉算進去 —— 停放的位置與不拆的那一種完全相同。只支援單發機。
 */
export function bakeParkedAircraft(id: string, spinProp = false): BufferGeometry {
  const key = spinProp ? `${id}/spin` : id
  const hit = baked.get(key)
  if (hit !== undefined) return hit.clone()
  const t = glbTemplate(id)
  if (t === undefined) throw new Error(`機種 ${id} 的 GLB 還沒載入 —— 少了 preloadAircraftModels()`)
  t.group.updateMatrixWorld(true)
  const parts: BufferGeometry[] = []
  const blades: BufferGeometry[] = []
  let hub: Object3D | null = null
  t.group.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    if ((mesh.geometry as { type?: string }).type === 'CircleGeometry') return
    const parent = mesh.parent
    if (spinProp && parent !== null && parent.userData['propHub'] === true) {
      if (hub !== null && hub !== parent) throw new Error(`機種 ${id} 不只一具螺旋槳，拆槳只支援單發機`)
      hub = parent
      // 槳葉在轉軸底下本來就是轉軸座標（`glb.ts` 搬過去的），直接用自己的矩陣
      blades.push(bakePart(mesh, mesh.matrix))
      return
    }
    parts.push(bakePart(mesh, mesh.matrixWorld))
  })
  if (parts.length === 0) throw new Error(`機種 ${id} 的樣板裡沒有任何網格`)
  const geo = mergeGeometries(parts)
  if (geo === null) throw new Error('停放飛機的幾何合併失敗 —— 屬性不一致')
  for (const p of parts) p.dispose()
  // 繞 X 正轉：+Z（機尾）往下
  const tilt = new Matrix4().makeRotationX(PARKED_TAIL_DOWN)
  geo.applyMatrix4(tilt)
  // 樣板的原點在重心（機尾比機首長），地面單位要的是腳印中心
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  let prop: BufferGeometry | null = null
  const hubAt = { x: 0, y: 0, z: 0 }
  if (spinProp) {
    const h = hub as Object3D | null
    if (h === null) throw new Error(`機種 ${id} 的樣板裡找不到螺旋槳轉軸`)
    prop = mergeGeometries(blades)
    if (prop === null) throw new Error('槳葉的幾何合併失敗 —— 屬性不一致')
    for (const p of blades) p.dispose()
    // 槳葉在停放姿態下的位置也要進包圍盒（槳尖可能是最低點）
    const inPlace = prop.clone().applyMatrix4(M.multiplyMatrices(tilt, h.matrixWorld))
    inPlace.computeBoundingBox()
    bb.union(inPlace.boundingBox!)
    inPlace.dispose()
    const p = h.getWorldPosition(new Vector3()).applyMatrix4(tilt)
    hubAt.x = p.x
    hubAt.y = p.y
    hubAt.z = p.z
    // 【轉軸只有平移】擺上去時只套機尾下沉再繞 Z 轉；轉軸帶旋轉的話槳會繞錯的軸
    if (h.getWorldQuaternion(new Quaternion()).angleTo(IDENTITY) > 1e-6) {
      throw new Error(`機種 ${id} 的螺旋槳轉軸帶旋轉，拆槳不支援`)
    }
    prop.computeVertexNormals()
    prop.computeBoundingSphere()
  }
  const offset = { x: 0, y: -bb.min.y, z: -(bb.min.z + bb.max.z) / 2 }
  geo.translate(offset.x, offset.y, offset.z)
  // 【滾行要把烘進去的姿態扣回來】機身改平時由 `render/groundTargets.ts` 讀它；
  // `clone()` 帶得過去
  geo.userData[PARKED_OFFSET_KEY] = offset
  if (prop !== null) {
    const out: ParkedProp = {
      geometry: prop,
      hub: { x: hubAt.x + offset.x, y: hubAt.y + offset.y, z: hubAt.z + offset.z },
    }
    geo.userData[PARKED_PROP_KEY] = out
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  baked.set(key, geo)
  return geo.clone()
}
