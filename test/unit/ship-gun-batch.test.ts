import { describe, expect, it, vi } from 'vitest'
import { BatchedMesh, BoxGeometry, Frustum, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three'
import { batchShipGunMeshes } from '../../src/render/shipGunBatch'

function fixture() {
  const hull = new Group(), parent = new Group(), material = new MeshBasicMaterial()
  const body = new Mesh(new BoxGeometry(), material)
  const barrel = new Mesh(new BoxGeometry(0.2, 0.2, 3), material)
  hull.position.set(42, 7, -50); hull.rotation.y = 0.9
  parent.position.set(3, 2, 1); parent.rotation.z = 0.1
  body.position.set(2, 1, 4); barrel.position.set(0, 1, -1)
  hull.add(parent); parent.add(body); body.add(barrel)
  const renderer = batchShipGunMeshes(hull, [body, barrel])
  const batch = hull.children.find(o => o instanceof BatchedMesh) as BatchedMesh
  return { hull, parent, body, barrel, material, batch, renderer }
}

describe('ship gun draw batches', () => {
  it('culls an off-screen hull as a whole while keeping a visible hull', () => {
    const { hull, batch, renderer } = fixture()
    const camera = new PerspectiveCamera(50, 1, 1, 1000), frustum = new Frustum()
    try {
      hull.updateMatrixWorld(true)
      camera.position.copy(hull.position).add(new Vector3(0, 30, 80))
      camera.lookAt(hull.position); camera.updateMatrixWorld(true)
      frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      expect(batch.frustumCulled).toBe(true)
      expect(frustum.intersectsObject(batch)).toBe(true)
      camera.lookAt(camera.position.clone().add(new Vector3(0, 0, 100)))
      camera.updateMatrixWorld(true)
      frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      expect(frustum.intersectsObject(batch)).toBe(false)
    } finally { renderer.dispose() }
  })

  it('does not re-upload unchanged mounts when only the ship moves', () => {
    const { hull, body, batch, renderer } = fixture()
    const upload = vi.spyOn(batch, 'setMatrixAt')
    try {
      renderer.update(); hull.position.x += 500; hull.rotation.y += 1; renderer.update()
      expect(upload).not.toHaveBeenCalled()
      body.rotation.y += 0.5; renderer.update()
      expect(upload).toHaveBeenCalledTimes(2) // 砲管繼承砲塔本體的轉向。
    } finally { renderer.dispose() }
  })

  it('keeps independently animated body/barrel vertices and muzzle transforms in the same world space', () => {
    const { hull, body, barrel, batch, renderer } = fixture()
    try {
      for (const yaw of [-2.5, 0, 1.7]) for (const pitch of [0, 0.7, 1.4]) {
        body.rotation.y = yaw; barrel.rotation.x = pitch
        renderer.update(); hull.updateMatrixWorld(true)
        for (const [id, source] of [body, barrel].entries()) {
          const part = batch.getMatrixAt(id, new Matrix4())
          const vertices = source.geometry.getAttribute('position')
          for (let i = 0; i < vertices.count; i++) {
            const p = new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(part)
            expect(batch.boundingSphere!.containsPoint(p)).toBe(true)
          }
          const world = part.premultiply(batch.matrixWorld)
          const local = new Vector3(0.1, 0.2, -1.5)
          expect(local.clone().applyMatrix4(world).distanceTo(local.applyMatrix4(source.matrixWorld))).toBeLessThan(1e-5)
        }
      }
    } finally { renderer.dispose() }
  })

  it('preserves inherited visibility and restores source draw layers without disposing shared resources', () => {
    const { parent, body, barrel, batch, material, renderer } = fixture()
    const materialDispose = vi.spyOn(material, 'dispose'), sourceDispose = vi.spyOn(body.geometry, 'dispose')
    const batchDispose = vi.spyOn(batch.geometry, 'dispose')
    expect(body.layers.mask).toBe(0); expect(barrel.layers.mask).toBe(0)
    parent.visible = false; renderer.update()
    expect(batch.getVisibleAt(0)).toBe(false); expect(batch.getVisibleAt(1)).toBe(false)
    parent.visible = true; barrel.visible = false; renderer.update()
    expect(batch.getVisibleAt(0)).toBe(true); expect(batch.getVisibleAt(1)).toBe(false)
    renderer.dispose()
    expect(body.layers.mask).toBe(1); expect(barrel.layers.mask).toBe(1)
    expect(batch.parent).toBeNull()
    expect(batchDispose).toHaveBeenCalledOnce()
    expect(materialDispose).not.toHaveBeenCalled(); expect(sourceDispose).not.toHaveBeenCalled()
  })

  it('keeps incompatible geometry and transparent materials on separate/original draw paths', () => {
    const hull = new Group(), material = new MeshBasicMaterial()
    const parts = Array.from({ length: 4 }, () => new Mesh(new BoxGeometry(), material))
    parts[2]!.geometry.deleteAttribute('uv'); parts[3]!.geometry.deleteAttribute('uv')
    const glass = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ transparent: true }))
    hull.add(...parts, glass)
    const renderer = batchShipGunMeshes(hull, [...parts, glass])
    try {
      expect(hull.children.filter(o => o instanceof BatchedMesh)).toHaveLength(2)
      expect(glass.layers.mask).toBe(1)
    } finally { renderer.dispose() }
  })
})
