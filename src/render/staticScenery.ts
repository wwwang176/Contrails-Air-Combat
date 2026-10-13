import {
  BatchedMesh, Frustum, Group, Matrix4, Mesh, MeshStandardMaterial,
  type BufferGeometry, type Camera, type Sphere,
} from 'three'
import { SCENERY_CHUNK, SCENERY_MIN_TRIS, splitByGrid } from './sceneryChunks'

/** 固定佈景的分塊繪製；接管 whole 的生命週期，所有區塊維持單位矩陣。 */
export function createStaticScenery(whole: BufferGeometry, multiDraw: boolean): {
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
  let batch: BatchedMesh | null = null
  if (multiDraw && chunks.length > 1) {
    // 頂點已經在佈景座標中，沒有逐實例的變換或顏色。只借用 BatchedMesh 的
    // 區塊管理與 multi-draw，避免每個頂點額外讀取矩陣貼圖。不能用來放動態物件。
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = '#undef USE_BATCHING\n' + shader.vertexShader
    }
    material.customProgramCacheKey = () => 'static-scenery'
    const vertices = chunks.reduce((n, g) => n + g.getAttribute('position').count, 0)
    batch = new BatchedMesh(chunks.length, vertices, 0, material)
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
  } else {
    // 無擴充功能或只有一塊時，保留原本的 Mesh 路徑。
    for (const chunk of chunks) object.add(new Mesh(chunk, material))
  }
  return {
    object,
    cull(camera, enabled) {
      for (const child of object.children) child.frustumCulled = enabled
      if (batch !== null) {
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
      }
    },
    dispose() {
      if (batch !== null) batch.dispose()
      else for (const chunk of chunks) chunk.dispose()
      material.dispose()
    },
  }
}
