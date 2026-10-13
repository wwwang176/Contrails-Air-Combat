import {
  BatchedMesh, Frustum, Group, Matrix4, MeshStandardMaterial,
  type BufferGeometry, type Camera, type Sphere,
} from 'three'
import { SCENERY_CHUNK, SCENERY_MIN_TRIS, splitByGrid } from './sceneryChunks'

/** 固定佈景的分塊繪製；接管 whole 的生命週期，所有區塊維持單位矩陣。 */
export function createStaticScenery(whole: BufferGeometry): {
  object: Group
  /** 在場景與相機的世界矩陣更新後呼叫（由 scene.onBeforeRender 接線）。 */
  cull(camera: Camera, enabled: boolean): void
  dispose(): void
} {
  const chunks = splitByGrid(whole, SCENERY_CHUNK, SCENERY_MIN_TRIS)
  whole.dispose()
  const object = new Group()
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
  const bounds: Sphere[] = []
  const frustum = new Frustum(), projection = new Matrix4()
  // 頂點已經在佈景座標中，沒有逐實例的變換或顏色。只借用 BatchedMesh 的
  // 區塊管理，避免每個頂點額外讀取矩陣貼圖。不能用來放動態物件。
  // 沒有 multi-draw 擴充時，Three 會逐筆提交相同的可見區塊。
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = '#undef USE_BATCHING\n' + shader.vertexShader
  }
  material.customProgramCacheKey = () => 'static-scenery'
  const vertices = chunks.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const batch = new BatchedMesh(chunks.length, vertices, 0, material)
  batch.sortObjects = false
  batch.perObjectFrustumCulled = false
  for (const chunk of chunks) {
    batch.addInstance(batch.addGeometry(chunk))
    bounds.push(chunk.boundingSphere!)
    // BatchedMesh 已複製屬性，來源區塊不必跟著保留。
    chunk.dispose()
  }
  chunks.length = 0
  batch.computeBoundingSphere()
  object.add(batch)
  return {
    object,
    cull(camera, enabled) {
      batch.frustumCulled = enabled
      // 區塊不移動，直接用原包圍球剔除，省去逐塊讀取／套用實例矩陣。
      // 可見集合沒變時 setVisibleAt 不會標髒，BatchedMesh 可沿用繪製清單。
      if (enabled) {
        projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          .multiply(batch.matrixWorld)
        frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      }
      for (let i = 0; i < bounds.length; i++) {
        batch.setVisibleAt(i, !enabled || frustum.intersectsSphere(bounds[i]!))
      }
    },
    dispose() {
      batch.dispose()
      material.dispose()
    },
  }
}
