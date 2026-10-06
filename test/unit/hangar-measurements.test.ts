import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three'
import { countModelTriangles } from '../../src/tools/hangarMeasurements'

function fixture(indexed: boolean) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 1, 0], 3))
  if (indexed) geometry.setIndex([0, 1, 2, 0, 2, 1])
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  const root = new Group()
  root.add(mesh, new Group())
  return { root, mesh, dispose() { geometry.dispose(); material.dispose() } }
}

describe('機庫幾何量測', () => {
  it.each([[false, 1], [true, 2]] as const)('索引模式 %s 正確計數，隱藏節點仍納入量測', (indexed, tris) => {
    const f = fixture(indexed)
    try {
      f.mesh.visible = false
      expect(countModelTriangles(f.root)).toEqual({ tris, meshes: 1 })
    } finally { f.dispose() }
  })
})
