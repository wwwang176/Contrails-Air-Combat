import { BatchedMesh, Matrix4, Sphere, Vector3, type Material, type Mesh, type Object3D } from 'three'

/** 保留模型關節供瞄準與槍口定位使用，只合併繪製工作。 */
export function batchShipGunMeshes(hull: Object3D, parts: readonly Mesh[]) {
  const groups = new Map<Material, Map<string, Mesh[]>>()
  for (const part of parts) {
    // 多材質與透明幾何需要不同的排序方式，保留原本的繪製方式。
    if (Array.isArray(part.material) || part.material.transparent) continue
    const geometry = part.geometry
    const signature = JSON.stringify([
      !!geometry.index, part.layers.mask, part.castShadow, part.receiveShadow, part.renderOrder,
      Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, a]) => [name, a.itemSize, a.normalized, a.array.constructor.name]),
    ])
    let byFormat = groups.get(part.material)
    if (!byFormat) groups.set(part.material, byFormat = new Map())
    let meshes = byFormat.get(signature)
    if (!meshes) byFormat.set(signature, meshes = [])
    meshes.push(part)
  }

  type Transform = { node: Object3D; parent: Transform | undefined; matrix: Matrix4; visible: boolean }
  const transforms = new Map<Object3D, Transform>()
  function transform(node: Object3D): Transform {
    let entry = transforms.get(node)
    if (entry) return entry
    if (!node.parent) throw new Error('Ship gun must be a descendant of its hull')
    const parent = node.parent === hull ? undefined : transform(node.parent)
    entry = { node, parent, matrix: new Matrix4(), visible: true }
    transforms.set(node, entry) // 父節點先於子節點處理，包含 GLB 原有的變換。
    return entry
  }

  const batches: BatchedMesh[] = []
  const bindings: { batch: BatchedMesh; id: number; pose: Transform; layers: number; uploaded: Matrix4 }[] = []
  for (const [material, byFormat] of groups) for (const meshes of byFormat.values()) {
    if (meshes.length < 2) continue
    const geometries = [...new Set(meshes.map(mesh => mesh.geometry))]
    const batch = new BatchedMesh(meshes.length,
      geometries.reduce((n, g) => n + g.getAttribute('position').count, 0),
      geometries.reduce((n, g) => n + (g.index?.count ?? 0), 0), material)
    batch.name = 'shipModels.gunBatch'
    // 支點與縮放固定，只有水平轉向與俯仰會變動。以局部原點包住幾何，
    // 再累加各層支點距離，涵蓋所有可能的旋轉姿態。
    // 整批砲塔離開視野時，即可略過材質設定與矩陣紋理上傳。
    let radius = 0
    for (const mesh of meshes) {
      const geometry = mesh.geometry
      if (!geometry.boundingSphere) geometry.computeBoundingSphere()
      let reach = geometry.boundingSphere!.center.length() + geometry.boundingSphere!.radius
      for (let node: Object3D = mesh; node !== hull; node = node.parent!) {
        if (!node.parent) throw new Error('Ship gun must be a descendant of its hull')
        if (node.matrixAutoUpdate) node.updateMatrix()
        const e = node.matrix.elements
        reach = reach * node.matrix.getMaxScaleOnAxis() + Math.hypot(e[12]!, e[13]!, e[14]!)
      }
      radius = Math.max(radius, reach)
    }
    batch.boundingSphere = new Sphere(new Vector3(), radius)
    batch.perObjectFrustumCulled = true
    batch.sortObjects = false
    const first = meshes[0]!
    batch.layers.mask = first.layers.mask
    batch.castShadow = first.castShadow
    batch.receiveShadow = first.receiveShadow
    batch.renderOrder = first.renderOrder
    const ids = new Map(geometries.map(g => [g, batch.addGeometry(g)]))
    for (const mesh of meshes) {
      bindings.push({ batch, id: batch.addInstance(ids.get(mesh.geometry)!),
        pose: transform(mesh), layers: mesh.layers.mask, uploaded: new Matrix4() })
      // 保留可見性與變換階層，供砲管及槍口位置計算使用。
      mesh.layers.disableAll()
    }
    hull.add(batch)
    batches.push(batch)
  }

  function update(): void {
    for (const entry of transforms.values()) {
      const { node, parent, matrix } = entry
      if (node.matrixAutoUpdate) node.updateMatrix()
      if (parent) matrix.multiplyMatrices(parent.matrix, node.matrix)
      else matrix.copy(node.matrix)
      entry.visible = node.visible && (parent?.visible ?? true)
    }
    for (const { batch, id, pose, uploaded } of bindings) {
      // 即使船體移動，未轉動的砲座也不必重新上傳矩陣紋理。
      if (!uploaded.equals(pose.matrix)) {
        batch.setMatrixAt(id, pose.matrix)
        uploaded.copy(pose.matrix)
      }
      batch.setVisibleAt(id, pose.visible)
    }
  }
  update()
  return {
    update,
    dispose(): void {
      for (const { pose, layers } of bindings) pose.node.layers.mask = layers
      for (const batch of batches) {
        batch.removeFromParent()
        batch.dispose() // 只釋放批次持有的幾何副本與紋理，保留快取中的共用材質。
      }
    },
  }
}
