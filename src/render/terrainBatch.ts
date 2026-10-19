import {
  BatchedMesh, Frustum, Matrix4, Mesh, type BufferGeometry, type MeshStandardMaterial,
} from 'three'

const prepared = new WeakSet<MeshStandardMaterial>()

/** 固定地形的頂點已在共同座標中；保留原著色器，只略過恆為單位矩陣的批次變換。 */
function prepareMaterial(material: MeshStandardMaterial): void {
  if (prepared.has(material)) return
  prepared.add(material)
  const compile = material.onBeforeCompile
  // 【每次重問原本的鍵】材質自己的鍵可能跟著設定變（`fieldClipmap.ts` 的 `canopyLookup`）
  const key = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer)
    shader.vertexShader = '#undef USE_BATCHING\n' + shader.vertexShader
  }
  material.customProgramCacheKey = () => key() + ':static-terrain'
  material.needsUpdate = true
}

/** 接管區塊幾何，但不持有材質生命週期；空集合與單一區塊不另建合批資源。 */
export function createTerrainBatch(geometries: readonly BufferGeometry[], material: MeshStandardMaterial) {
  let mesh: Mesh | null = null
  let batch: BatchedMesh | null = null
  if (geometries.length === 1) mesh = new Mesh(geometries[0]!, material)
  else if (geometries.length > 1) {
    prepareMaterial(material)
    batch = new BatchedMesh(geometries.length,
      geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0),
      geometries.reduce((sum, g) => sum + (g.index?.count ?? 0), 0), material)
    batch.name = 'terrain.batch'
    batch.sortObjects = false
    batch.perObjectFrustumCulled = false
    const bounds = geometries.map(g => {
      if (g.boundingSphere === null) g.computeBoundingSphere()
      const sphere = g.boundingSphere!.clone()
      batch!.addInstance(batch!.addGeometry(g))
      g.dispose()
      return sphere
    })
    batch.computeBoundingSphere()
    const frustum = new Frustum(), projection = new Matrix4()
    const prepare = batch.onBeforeRender
    batch.onBeforeRender = function(renderer, scene, camera, geometry, mat, group) {
      // 每次繪製使用當下鏡頭；區塊不移動，可直接測試原包圍球而不讀取實例矩陣。
      if (this.frustumCulled) {
        projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld)
        frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      }
      for (let i = 0; i < bounds.length; i++) {
        this.setVisibleAt(i, !this.frustumCulled || frustum.intersectsSphere(bounds[i]!))
      }
      prepare.call(this, renderer, scene, camera, geometry, mat, group)
    }
    mesh = batch
  }
  return {
    mesh,
    /** 農地建立後換用 clipmap 材質時，保留其貼圖、uniform 與所有距離漸變。 */
    setMaterial(next: MeshStandardMaterial): void {
      if (batch !== null) prepareMaterial(next)
      if (mesh !== null) mesh.material = next
    },
    dispose(): void {
      if (batch !== null) batch.dispose()
      else mesh?.geometry.dispose()
    },
  }
}
