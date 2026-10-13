import {
  BatchedMesh, Group, Matrix4, type BufferGeometry, type Material, type Object3D,
} from 'three'

/** 保留幾何資料與關節階層供瞄準、砲口與診斷使用，本身不提交繪製。 */
export type GroundModelPart = Object3D & {
  geometry: BufferGeometry
  material: Material | Material[]
}

export function createGroundVehicleBatch(root: Group) {
  const sources: { part: GroundModelPart; materials: readonly Material[] }[] = []
  type Pose = { node: Object3D; parent: Pose | undefined; matrix: Matrix4 }
  const poses = new Map<Object3D, Pose>()
  function poseOf(node: Object3D): Pose {
    let pose = poses.get(node)
    if (pose !== undefined) return pose
    if (node.parent === null) throw new Error('地面合批零件必須掛在模型根節點下')
    const parent = node.parent === root ? undefined : poseOf(node.parent)
    pose = { node, parent, matrix: new Matrix4() }
    poses.set(node, pose)
    return pose
  }
  const pools: {
    batch: BatchedMesh
    material: Material
    bindings: { part: GroundModelPart; id: number; pose: Pose; uploaded: Matrix4 }[]
  }[] = []
  return {
    part(geometry: BufferGeometry, material: Material, wreck: Material): GroundModelPart {
      const part = Object.assign(new Group(), { geometry, material })
      sources.push({ part, materials: [material, wreck] })
      return part
    },
    /** 所有關節掛好後呼叫一次；同材質、同頂點格式共用一池，幾何依參照去重。 */
    build(): void {
      const groups = new Map<Material, Map<string, GroundModelPart[]>>()
      for (const { part, materials } of sources) {
        const signature = JSON.stringify([
          !!part.geometry.index,
          Object.entries(part.geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
            .map(([name, a]) => [name, a.itemSize, a.normalized, a.array.constructor.name]),
        ])
        for (const material of materials) {
          let formats = groups.get(material)
          if (formats === undefined) groups.set(material, formats = new Map())
          let parts = formats.get(signature)
          if (parts === undefined) formats.set(signature, parts = [])
          parts.push(part)
        }
      }
      for (const [material, formats] of groups) for (const parts of formats.values()) {
        const geometries = [...new Set(parts.map(p => p.geometry))]
        const batch = new BatchedMesh(parts.length,
          geometries.reduce((n, g) => n + g.getAttribute('position').count, 0),
          geometries.reduce((n, g) => n + (g.index?.count ?? 0), 0), material)
        batch.name = 'groundModels.vehicleBatch'
        // 車輛可跨地圖移動，不能沿用建場時的整批包圍球；每個零件仍由 Three 逐一剔除。
        batch.frustumCulled = false
        batch.sortObjects = false
        const ids = new Map(geometries.map(g => [g, batch.addGeometry(g)]))
        const bindings = parts.map(part => ({
          part, id: batch.addInstance(ids.get(part.geometry)!), pose: poseOf(part), uploaded: new Matrix4(),
        }))
        const prepare = batch.onBeforeRender
        batch.onBeforeRender = function(renderer, scene, camera, geometry, mat, group) {
          // 診斷工具可在暫停時改圖層；繪製前才讀，避免重新顯示原網格或漏掉隱藏指令。
          for (const b of bindings) {
            let visible = b.part.material === material && b.part.layers.test(camera.layers)
            for (let p: Pose | undefined = b.pose; visible && p !== undefined; p = p.parent) {
              visible = p.node.visible
            }
            this.setVisibleAt(b.id, visible)
          }
          prepare.call(this, renderer, scene, camera, geometry, mat, group)
        }
        pools.push({ batch, material, bindings })
        root.add(batch)
      }
    },
    /** 只上傳改變且目前使用中的姿態；復活或切換材質時會補上另一池的矩陣。 */
    update(): void {
      for (const p of poses.values()) {
        if (p.node.matrixAutoUpdate) p.node.updateMatrix()
        if (p.parent === undefined) p.matrix.copy(p.node.matrix)
        else p.matrix.multiplyMatrices(p.parent.matrix, p.node.matrix)
      }
      for (const { batch, material, bindings } of pools) {
        let active = false
        for (const b of bindings) {
          const visible = b.part.material === material
          active ||= visible
          batch.setVisibleAt(b.id, visible)
          if (visible && !b.uploaded.equals(b.pose.matrix)) {
            batch.setMatrixAt(b.id, b.pose.matrix)
            b.uploaded.copy(b.pose.matrix)
          }
        }
        batch.visible = active
      }
    },
    dispose(): void {
      for (const { batch } of pools) {
        batch.removeFromParent()
        batch.dispose()
      }
      // 原幾何、塗裝與材質由 groundTargets 或 GLB 快取持有，這裡只釋放合批副本。
      pools.length = 0
      poses.clear()
      sources.length = 0
    },
  }
}
