import { describe, expect, it, vi } from 'vitest'
import {
  BatchedMesh, BoxGeometry, Frustum, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene,
  type WebGLRenderer, type WebGLProgramParametersWithUniforms,
} from 'three'
import { createTerrainBatch } from '../../src/render/terrainBatch'

describe('固定地形合批', () => {
  it.each([false, true])('索引格式 %s：保留幾何、逐塊剔除、父層變換與材質所有權', indexed => {
    const blocks = [-100, 0, 100].map(x => {
      const g = new BoxGeometry(20, 10, 20).translate(x, 0, -100)
      if (indexed) return g
      const flat = g.toNonIndexed(); g.dispose(); return flat
    })
    const bounds = blocks.map(g => { g.computeBoundingSphere(); return g.boundingSphere!.clone() })
    const positions = blocks.flatMap(g => Array.from(g.getAttribute('position').array))
    const material = new MeshStandardMaterial(), freed = vi.fn(), matFreed = vi.fn()
    blocks.forEach(g => g.addEventListener('dispose', freed))
    material.addEventListener('dispose', matFreed)
    const view = createTerrainBatch(blocks, material), batch = view.mesh as BatchedMesh
    expect(freed).toHaveBeenCalledTimes(3)
    expect(Array.from(batch.geometry.getAttribute('position').array)).toEqual(positions)
    const parent = new Group(); parent.position.set(30, 20, 10); parent.rotation.y = .3; parent.add(batch)
    const camera = new PerspectiveCamera(40, 1, 1, 1000), scene = new Scene()
    const frustum = new Frustum(), projection = new Matrix4()
    parent.updateMatrixWorld(true)
    const counts = new Set<number>()
    for (const x of [-100, 0, 100, 1000]) for (const enabled of [true, false]) {
      camera.lookAt(x, 0, -100); camera.updateMatrixWorld(true)
      batch.frustumCulled = enabled
      batch.onBeforeRender({} as WebGLRenderer, scene, camera, batch.geometry, batch.material, parent)
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const expected = bounds.map(s => !enabled || frustum.intersectsSphere(s.clone().applyMatrix4(batch.matrixWorld)))
      expect(bounds.map((_, id) => batch.getVisibleAt(id))).toEqual(expected)
      if (enabled) counts.add(expected.filter(Boolean).length)
    }
    expect(counts.size).toBeGreaterThan(1)
    const batchFreed = vi.fn(); batch.geometry.addEventListener('dispose', batchFreed)
    view.dispose()
    expect(batchFreed).toHaveBeenCalledOnce()
    expect(matFreed).not.toHaveBeenCalled()
    material.dispose()
  })

  it('換用 clipmap 材質保留原著色器、uniform 參照與快取鍵，不重複包裝', () => {
    const original = new MeshStandardMaterial(), clip = new MeshStandardMaterial()
    const u = { value: 500 }, compile = vi.fn((shader: WebGLProgramParametersWithUniforms) => { shader.uniforms['uInner'] = u })
    clip.onBeforeCompile = compile
    clip.customProgramCacheKey = () => 'field-clipmap:test'
    const view = createTerrainBatch([new BoxGeometry(), new BoxGeometry()], original)
    view.setMaterial(clip)
    const hook = clip.onBeforeCompile, key = clip.customProgramCacheKey()
    view.setMaterial(clip)
    expect(clip.onBeforeCompile).toBe(hook)
    expect(key).toBe('field-clipmap:test:static-terrain')
    const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '', uniforms: {} } as WebGLProgramParametersWithUniforms
    clip.onBeforeCompile(shader, {} as WebGLRenderer)
    expect(compile).toHaveBeenCalledOnce()
    expect(shader.vertexShader).toMatch(/^#undef USE_BATCHING/)
    expect(shader.uniforms['uInner']).toBe(u)
    u.value = 1500
    expect(shader.uniforms['uInner']!.value).toBe(1500)
    view.dispose(); original.dispose(); clip.dispose()
  })

  it('空集合不畫；單塊沿用 Mesh 並釋放原幾何', () => {
    const material = new MeshStandardMaterial(), g = new BoxGeometry(), freed = vi.fn()
    g.addEventListener('dispose', freed)
    const empty = createTerrainBatch([], material), single = createTerrainBatch([g], material)
    expect(empty.mesh).toBeNull()
    expect(single.mesh).toBeInstanceOf(Mesh)
    expect(single.mesh).not.toBeInstanceOf(BatchedMesh)
    expect(single.mesh!.geometry).toBe(g)
    empty.dispose(); single.dispose()
    expect(freed).toHaveBeenCalledOnce()
    material.dispose()
  })
})
