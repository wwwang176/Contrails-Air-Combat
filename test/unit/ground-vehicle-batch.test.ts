import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BatchedMesh, Group, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery, GROUND_MG_SPEC } from '../../src/world/shipGuns'
import type { GroundUnitId } from '../../src/specs/ground'
import type { GroundModelPart } from '../../src/render/groundVehicleBatch'

beforeAll(async () => {
  await preloadGroundModels(async url => {
    const b = readFileSync('public' + url)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
})

const ids: GroundUnitId[] = ['tank', 'tankDug', 'panzer4', 'tiger', 'truck', 'usTruck',
  'usTank', 'usFlakTrack', 'flakLight', 'atGun', 'flakHeavy', 'usFlakHeavy']
function targets() {
  return ids.map((id, i) => {
    const t = createGroundTarget(i, id, 'red', i * 12, -i * 15, i * 0.13)
    if (id === 'usTank' || id === 'usFlakTrack' || id === 'flakLight') {
      t.guns = createGroundBattery(GROUND_MG_SPEC, 'mg', 12.7, 'roof50')
    } else if (id === 'flakHeavy' || id === 'usFlakHeavy') t.guns = createGroundBattery()
    return t
  })
}
const camera = new PerspectiveCamera(100, 16 / 9, 1, 50000)
camera.position.set(0, 300, 300)
camera.lookAt(60, 0, -100)
camera.updateMatrixWorld()

function prepare(object: Group): BatchedMesh[] {
  object.updateMatrixWorld(true)
  const batches = object.children.filter((o): o is BatchedMesh => o instanceof BatchedMesh)
  for (const batch of batches) if (batch.visible) {
    batch.onBeforeRender({} as WebGLRenderer, new Scene(), camera, batch.geometry, batch.material, new Group())
  }
  return batches
}

describe('地面車輛合批', () => {
  it.each([undefined, 'winter'] as const)('各部位姿態、砲口與開火位置維持一致（塗裝 %s）', livery => {
    const list = targets(), oldShot = vi.fn(), nextShot = vi.fn()
    const old = createGroundModels(list, livery, oldShot)
    const next = createGroundModels(list, livery, nextShot, true)
    for (let frame = 0; frame < 4; frame++) {
      for (const [i, t] of list.entries()) {
        t.position.x += 7
        t.orientation.setFromAxisAngle(new Vector3(0, 1, 0), frame * 0.4 + i * 0.1)
        if (t.guns[0]) { t.guns[0].aim.set(1, 0.7, -1).normalize(); t.guns[0].shots++ }
        t.alive = frame !== 1 || i % 2 === 0
      }
      const aim = { aimTarget: (i: number) => (i + 1) % list.length }
      old.update(list, camera.position, 0.1, aim)
      next.update(list, camera.position, 0.1, aim)
      old.object.updateMatrixWorld(true)
      const batches = prepare(next.object)
      expect(batches.length).toBeGreaterThan(0)
      // 每一個 GPU 實例，都必須對應到原階層的一個部位、相同材質與世界姿態。
      const expected: GroundModelPart[] = []
      for (const root of next.object.children.slice(0, list.length)) root.traverse(o => {
        if ('geometry' in o && !(o instanceof Mesh)) expected.push(o as GroundModelPart)
      })
      let visible = 0
      for (const batch of batches) if (batch.visible) for (let id = 0; id < batch.instanceCount; id++) {
        if (!batch.getVisibleAt(id)) continue
        visible++
        const matrix = batch.getMatrixAt(id, new Matrix4())!
        const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(id))!
        const at = expected.findIndex(p => p.material === batch.material
          && p.geometry.getAttribute('position').count === range.vertexCount
          && p.matrixWorld.elements.every((x, i) => Math.abs(x - matrix.elements[i]!) < 1e-4))
        expect(at).toBeGreaterThanOrEqual(0)
        expected.splice(at, 1)
      }
      expect(expected).toHaveLength(0)
      expect(visible).toBeGreaterThan(list.length * 2)
      for (let k = 0; k < list.length; k++) {
        const a = new Vector3(), b = new Vector3(), ad = new Vector3(), bd = new Vector3()
        expect(next.muzzle(k, b, bd)).toBe(old.muzzle(k, a, ad))
        expect(a.distanceTo(b)).toBeLessThan(1e-8)
        expect(ad.distanceTo(bd)).toBeLessThan(1e-8)
      }
      expect(nextShot.mock.calls).toEqual(oldShot.mock.calls)
      const oldFlash = old.object.getObjectByName('groundModels.muzzles') as InstancedMesh
      const nextFlash = next.object.getObjectByName('groundModels.muzzles') as InstancedMesh
      expect(nextFlash.count).toBe(oldFlash.count)
      expect(nextFlash.instanceMatrix.array).toEqual(oldFlash.instanceMatrix.array)
    }
    old.resetTurrets(); next.resetTurrets()
    old.object.updateMatrixWorld(true); prepare(next.object)
    const a = new Vector3(), b = new Vector3(), d = new Vector3()
    old.muzzle(0, a, d); next.muzzle(0, b, d)
    expect(a.distanceTo(b)).toBeLessThan(1e-8)
    old.dispose(); next.dispose()
  })

  it('未出場、離場與抵達的車不畫；暫停時切換圖層不會重複繪製', () => {
    const list = targets(), models = createGroundModels(list, undefined, undefined, true)
    models.update(list, camera.position)
    const count = () => prepare(models.object).reduce((n, b) => n + (b.visible
      ? Array.from({ length: b.instanceCount }, (_, i) => Number(b.getVisibleAt(i))).reduce((a, c) => a + c, 0) : 0), 0)
    const all = count()
    list[0]!.dormant = true; list[1]!.arrived = true; list[2]!.departed = true
    models.update(list, camera.position)
    expect(count()).toBe(all - 9)
    const truck = models.object.children[4]!
    truck.traverse(o => o.layers.set(31))
    expect(count()).toBe(all - 10)
    truck.traverse(o => o.layers.set(0))
    expect(count()).toBe(all - 9)
    list[0]!.dormant = false; list[1]!.arrived = false; list[2]!.departed = false
    models.update(list, camera.position)
    expect(count()).toBe(all)
    models.dispose()
  })

  it('釋放合批資源不會釋放共用 GLB；未啟用維持 Mesh，單台車也可合批', () => {
    const list = targets(), models = createGroundModels(list, undefined, undefined, true)
    const base = (models.object.children[0] as GroundModelPart).geometry
    const shared = vi.fn(); base.addEventListener('dispose', shared)
    const batches = prepare(models.object), freed = vi.fn()
    for (const b of batches) b.geometry.addEventListener('dispose', freed)
    models.dispose()
    expect(freed).toHaveBeenCalledTimes(batches.length)
    expect(shared).not.toHaveBeenCalled()
    base.removeEventListener('dispose', shared)
    const fallback = createGroundModels(list)
    expect(prepare(fallback.object)).toHaveLength(0)
    expect(fallback.object.children[0]).toBeInstanceOf(Mesh)
    fallback.dispose()
    const single = createGroundModels(list.slice(0, 1), undefined, undefined, true)
    expect(prepare(single.object).length).toBeGreaterThan(0)
    expect(single.object.children[0]).toBeInstanceOf(Group)
    single.dispose()
  })
})
