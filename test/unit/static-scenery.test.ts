import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BatchedMesh, Frustum, Group, Matrix4, Mesh, PerspectiveCamera, Scene, Sphere,
  type BufferGeometry, type WebGLRenderer,
} from 'three'
import { createStaticScenery } from '../../src/render/staticScenery'
import { buildPlantScenery, preloadPlantScenery } from '../../src/render/geometry/ground/plantScenery'
import { buildAirfieldScenery, preloadAirfieldScenery } from '../../src/render/geometry/ground/airfieldScenery'

beforeAll(async () => {
  const fetcher = async (url: string): Promise<ArrayBuffer> => {
    const b = readFileSync('public' + url)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  await Promise.all([preloadPlantScenery(fetcher), preloadAirfieldScenery(fetcher)])
})

describe('固定佈景', () => {
  const build = buildPlantScenery
  it('合批保留所有頂點屬性、各塊包圍球與整體包圍球', () => {
    const old = createStaticScenery(build(), false)
    const next = createStaticScenery(build(), true)
    const batch = next.object.children[0] as BatchedMesh
    expect(batch.isBatchedMesh).toBe(true)
    expect(batch.instanceCount).toBe(old.object.children.length)
    let offset = 0
    old.object.children.forEach((child, id) => {
      const g = (child as Mesh).geometry
      for (const name of Object.keys(g.attributes)) {
        const a = g.getAttribute(name), b = batch.geometry.getAttribute(name)
        const copied = b.array.slice(offset * a.itemSize, (offset + a.count) * a.itemSize)
        expect(Buffer.compare(Buffer.from(copied.buffer), Buffer.from(a.array.buffer))).toBe(0)
      }
      const sphere = batch.getBoundingSphereAt(id, new Sphere())!
      expect(sphere).toEqual(g.boundingSphere)
      expect(batch.boundingSphere!.center.distanceTo(sphere.center) + sphere.radius)
        .toBeLessThanOrEqual(batch.boundingSphere!.radius + 1e-6)
      offset += g.getAttribute('position').count
    })
    expect(offset).toBe(batch.geometry.getAttribute('position').count)
    old.dispose(); next.dispose()
  })

  it('不同朝向及開關剔除時，送出的區塊與原 Mesh 路徑一致', () => {
    const old = createStaticScenery(build(), false)
    const next = createStaticScenery(build(), true)
    const batch = next.object.children[0] as BatchedMesh
    const camera = new PerspectiveCamera(55, 16 / 9, 1, 30000)
    camera.position.set(0, 400, -6200)
    const frustum = new Frustum(), projection = new Matrix4(), scene = new Scene()
    // 讀取 Three 準備交給 WebGL 的範圍，驗證真正的提交清單，而不只驗開關值。
    const draws = batch as unknown as { _multiDrawCount: number; _multiDrawStarts: Int32Array }
    const seen = new Set<number>()
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 6) {
      camera.rotation.set(-0.12, yaw, 0, 'YXZ')
      camera.updateMatrixWorld()
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      for (const enabled of [true, false, false, true]) {
        old.cull(camera, enabled); next.cull(camera, enabled)
        batch.onBeforeRender({} as WebGLRenderer, scene, camera, batch.geometry, batch.material, new Group())
        let start = 0
        const expected: number[] = []
        for (const child of old.object.children) {
          if (!enabled || frustum.intersectsObject(child)) expected.push(start)
          start += (child as Mesh).geometry.getAttribute('position').count
        }
        expect(Array.from(draws._multiDrawStarts.slice(0, draws._multiDrawCount))).toEqual(expected)
        if (enabled) seen.add(expected.length)
      }
    }
    expect(seen.size).toBeGreaterThan(1)
    old.dispose(); next.dispose()
  })

  it('機場只有一個區塊，不為單次繪製增加合批成本', () => {
    const view = createStaticScenery(buildAirfieldScenery(), true)
    expect(view.object.children).toHaveLength(1)
    expect(view.object.children[0]).toBeInstanceOf(Mesh)
    expect(view.object.children[0]).not.toBeInstanceOf(BatchedMesh)
    view.dispose()
  })

  it.each([false, true])('釋放來源、幾何與材質（合批：%s）', (multiDraw) => {
    const whole = build(), sourceDisposed = vi.fn()
    whole.addEventListener('dispose', sourceDisposed)
    const view = createStaticScenery(whole, multiDraw)
    expect(sourceDisposed).toHaveBeenCalledOnce()
    const pending = new Set<object>(), disposed = new Set<object>()
    for (const child of view.object.children) {
      const m = child as Mesh<BufferGeometry>
      for (const resource of [m.geometry, ...[m.material].flat()]) {
        if (pending.has(resource)) continue
        pending.add(resource)
        resource.addEventListener('dispose', () => disposed.add(resource))
      }
    }
    view.dispose()
    expect(disposed).toEqual(pending)
  })
})
