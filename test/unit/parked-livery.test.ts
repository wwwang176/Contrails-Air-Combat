import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { GLB_MODELS } from '../../src/render/geometry/buildAircraft'
import { glbTemplate, parseGlbTemplate, registerGlbTemplate } from '../../src/render/geometry/glb'
import { bakeParkedAircraft } from '../../src/render/geometry/ground/parked'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'

const textures = { p51d: new Texture(), b17g: new Texture() }

beforeAll(async () => {
  for (const id of ['p51d', 'b17g', 'b17g_lod2'] as const) {
    const def = GLB_MODELS[id]!
    const buffer = readFileSync(`public${def.url}`)
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    registerGlbTemplate(id, await parseGlbTemplate(bytes, def, textures[id === 'p51d' ? 'p51d' : 'b17g']))
  }
})

describe('停放飛機的塗裝', () => {
  it.each(['p51d', 'b17g', 'b17g_lod2'] as const)('%s 保留飛行樣板的 UV，塗裝面不乘上灰色底色', id => {
    const sourceUv: number[] = []
    glbTemplate(id)!.group.traverse(o => {
      if (!(o instanceof Mesh) || (o.material as MeshStandardMaterial).map === null) return
      const g = o.geometry.index === null ? o.geometry : o.geometry.toNonIndexed()
      sourceUv.push(...g.getAttribute('uv').array)
      if (g !== o.geometry) g.dispose()
    })
    const geometry = bakeParkedAircraft(id, id === 'p51d')
    try {
      const painted = geometry.groups.find(g => g.materialIndex === 1)
      expect(painted).toBeDefined()
      const uv = geometry.getAttribute('uv')
      expect(Array.from(uv.array).slice(painted!.start * 2, (painted!.start + painted!.count) * 2)).toEqual(sourceUv)
      const color = geometry.getAttribute('color')
      for (let i = painted!.start; i < painted!.start + painted!.count; i++) {
        expect([color.getX(i), color.getY(i), color.getZ(i)]).toEqual([1, 1, 1])
      }
      expect(geometry.groups.length).toBeLessThanOrEqual(2)
      expect(geometry.groups.reduce((n, group) => n + group.count, 0)).toBe(geometry.getAttribute('position').count)
    } finally { geometry.dispose() }
  })

  it.each(['parkedP51', 'parkedB17'] as const)('%s 近遠景、擊毀、復活共用正確材質，釋放不傷到飛行貼圖', unit => {
    const target = createGroundTarget(0, unit, 'red', 0, 0, 0)
    const texture = textures[unit === 'parkedP51' ? 'p51d' : 'b17g']
    const disposed = vi.fn()
    texture.addEventListener('dispose', disposed)
    const neighbor = createGroundTarget(1, unit, 'red', 50, 0, 0)
    const plain = createGroundTarget(2, 'fuelDump', 'red', 100, 0, 0)
    const targets = [target, neighbor, plain]
    const models = createGroundModels(targets)
    const mesh = models.object.children[0] as Mesh
    const camera = new Vector3(0, 20, 20)
    const check = () => {
      expect(Array.isArray(mesh.material)).toBe(true)
      const materials = mesh.material as MeshStandardMaterial[]
      expect(materials[0]!.map).toBeNull()
      expect(materials[1]!.map).toBe(texture)
      expect(mesh.geometry.groups.some(g => g.materialIndex === 1)).toBe(true)
      return materials[1]!
    }
    const ownDisposed = vi.fn()
    try {
      models.update(targets, camera)
      check().addEventListener('dispose', ownDisposed)
      expect((models.object.children[1] as Mesh).material).toBe(mesh.material)
      expect(((models.object.children[2] as Mesh).material as MeshStandardMaterial).map).toBeNull()
      const high = mesh.geometry
      camera.set(0, 3000, 3000)
      models.update(targets, camera)
      check()
      if (unit === 'parkedB17') expect(mesh.geometry).not.toBe(high)
      target.alive = false
      models.update(targets, camera)
      expect(Array.isArray(mesh.material)).toBe(false)
      expect((mesh.material as MeshStandardMaterial).map).toBeNull()
      expect(Array.isArray((models.object.children[1] as Mesh).material)).toBe(true)
      target.alive = true
      camera.set(0, 20, 20)
      models.update(targets, camera)
      expect(mesh.geometry).toBe(high)
      check()
      target.departed = true
      models.update(targets, camera)
      expect(mesh.visible).toBe(false)
    } finally {
      models.dispose()
      texture.removeEventListener('dispose', disposed)
    }
    expect(disposed).not.toHaveBeenCalled()
    expect(ownDisposed).toHaveBeenCalledTimes(1)
  })
})
