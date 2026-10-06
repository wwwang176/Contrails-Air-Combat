import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three'
import { countModelTriangles, measureProbeParts, measureReferenceNodes } from '../../src/tools/hangarMeasurements'

function fixture(indexed: boolean) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 1, 0], 3))
  if (indexed) geometry.setIndex([0, 1, 2, 0, 2, 1])
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  const root = new Group()
  root.position.set(5, 8, -2)
  mesh.rotation.z = Math.PI / 4
  mesh.userData['refMat'] = 'glass'
  root.add(mesh, new Group())
  return { root, mesh, dispose() { geometry.dispose(); material.dispose() } }
}

describe('機庫幾何量測', () => {
  it.each([[false, 1], [true, 2]] as const)('索引模式 %s 正確計數，隱藏節點仍納入量測', (indexed, tris) => {
    const f = fixture(indexed)
    try {
      f.mesh.visible = false
      expect(countModelTriangles(f.root)).toEqual({ tris, meshes: 1 })
      expect(measureReferenceNodes(f.root)[0]!.tris).toBe(tris)
      expect(measureProbeParts(f.root)[0]!.tris).toBe(tris)
    } finally { f.dispose() }
  })

  it('逐頂點量測與旋轉局部包圍盒保留不同的外框定義', () => {
    const f = fixture(false)
    try {
      const exact = measureReferenceNodes(f.root)[0]!
      const probe = measureProbeParts(f.root)[0]!
      expect(exact.box[0]).toBeCloseTo(5 - Math.SQRT1_2)
      expect(exact.box[3]).toBeCloseTo(5 + Math.SQRT2)
      expect(exact.box[4]).toBeCloseTo(8 + Math.SQRT2)
      expect(probe.max[1]).toBeCloseTo(8 + 3 * Math.SQRT1_2)
      expect(probe.max[1]!).toBeGreaterThan(exact.box[4]!)
      expect(exact.name).toBe('')
      expect(probe.name).toBe('(無名)')
      expect(probe.mat).toBe('glass')
      expect(exact.box[2]).toBe(-2)
      expect(probe.min[2]).toBe(-2)
    } finally { f.dispose() }
  })
})
