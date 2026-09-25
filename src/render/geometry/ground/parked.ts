import {
  BufferAttribute, BufferGeometry, Color, Matrix4, type Mesh, type MeshStandardMaterial, type Object3D,
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

const C = /* @__PURE__ */ new Color()
const M = /* @__PURE__ */ new Matrix4()
const baked = new Map<string, BufferGeometry>()

export function bakeParkedAircraft(id: string): BufferGeometry {
  const hit = baked.get(id)
  if (hit !== undefined) return hit.clone()
  const t = glbTemplate(id)
  if (t === undefined) throw new Error(`機種 ${id} 的 GLB 還沒載入 —— 少了 preloadAircraftModels()`)
  t.group.updateMatrixWorld(true)
  const parts: BufferGeometry[] = []
  t.group.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    if ((mesh.geometry as { type?: string }).type === 'CircleGeometry') return
    // 【不動樣板】`toNonIndexed` 對沒有索引的幾何原樣回傳自己 —— 之後的
    // 套矩陣、刪屬性、dispose 就會打在共用的樣板上
    const g = mesh.geometry.index !== null ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
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
    parts.push(g)
  })
  if (parts.length === 0) throw new Error(`機種 ${id} 的樣板裡沒有任何網格`)
  const geo = mergeGeometries(parts)
  if (geo === null) throw new Error('停放飛機的幾何合併失敗 —— 屬性不一致')
  for (const p of parts) p.dispose()
  // 繞 X 正轉：+Z（機尾）往下
  geo.applyMatrix4(M.makeRotationX(PARKED_TAIL_DOWN))
  // 樣板的原點在重心（機尾比機首長），地面單位要的是腳印中心
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(0, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  baked.set(id, geo)
  return geo.clone()
}
