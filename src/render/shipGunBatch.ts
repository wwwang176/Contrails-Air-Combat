import { BatchedMesh, Matrix4, type Material, type Mesh, type Object3D } from 'three'

/** Keep the model's articulation nodes for aiming/muzzles; batch only their drawing. */
export function batchShipGunMeshes(hull: Object3D, parts: readonly Mesh[]) {
  const groups = new Map<Material, Map<string, Mesh[]>>()
  for (const part of parts) {
    // Multi-material/transparent geometry needs different ordering; retain its original draw path.
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
    transforms.set(node, entry) // Parents precede children, including authored GLB transforms.
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
    // The whole-batch sphere would become stale as guns turn. Individual instances still cull.
    batch.frustumCulled = false
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
      // Keep visibility and the transform hierarchy intact for barrel/muzzle calculations.
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
      // Stationary mounts need no matrix-texture upload, even while the hull itself moves.
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
        batch.dispose() // Owns copied geometry/textures; cached source material stays alive.
      }
    },
  }
}
