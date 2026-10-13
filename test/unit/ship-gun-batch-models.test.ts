import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { BatchedMesh, Matrix4, Mesh, Vector3 } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { prepareShipGuns, SHIP_GUN_PREFIX } from '../../src/render/geometry/shipGuns'
import { applyShipLivery } from '../../src/render/shipAssets'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import { createShipGunModels } from '../../src/render/shipGunModels'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns, resetShipGuns } from '../../src/world/shipGuns'
import { stepShipMounts } from '../../src/world/shipGunMounts'

it.each(['fletcher', 'wichita', 'lst'] as const)('%s batches its physical guns without changing geometry, livery or articulation', async id => {
  const bytes = readFileSync(`models-src/${id}.glb`)
  const template = (await createGltfLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  applyShipLivery(template, SHIP_LIVERIES[id]!, null)
  prepareShipGuns(template, id)
  const root = template.clone(true)
  const ship = createShip(0, SHIP_CLASSES[id], 'red', 120, -65, 1.3, 0)
  ship.guns = createShipGuns(ship.cls)
  const parts = ship.guns.flatMap(gun => gun.projectileMounts!.flatMap(mount => {
    const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
    return [body, body.children[0] as Mesh]
  }))
  const models = createShipGunModels([ship], [root])
  try {
    const batches = root.children.filter(o => o instanceof BatchedMesh) as BatchedMesh[]
    expect(batches).toHaveLength(1)
    const batch = batches[0]!
    expect(batch.instanceCount).toBe({ fletcher: 20, wichita: 40, lst: 16 }[id])
    expect(batch.instanceCount).toBe(parts.length)
    root.position.copy(ship.position); root.quaternion.copy(ship.orientation)
    for (const target of [new Vector3(0.8, 0.6, 0), new Vector3(-0.3, 0.8, -0.5), null]) {
      if (target) for (const gun of ship.guns) { gun.aim.copy(target).normalize(); stepShipMounts(gun, true, 100) }
      else resetShipGuns(ship)
      models.update([ship], 1 / 60); root.updateMatrixWorld(true)
      for (const [slot, mesh] of parts.entries()) {
        expect(mesh.layers.mask).toBe(0)
        expect(template.getObjectByName(mesh.name)!.layers.mask).toBe(1)
        expect(batch.material).toBe(mesh.material)
        const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(slot))!
        const local = batch.getMatrixAt(slot, new Matrix4())
        const world = local.clone().premultiply(batch.matrixWorld)
        for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
          const copied = batch.geometry.getAttribute(name)
          for (let v = 0; v < attribute.count; v++) {
            for (let c = 0; c < attribute.itemSize; c++) expect(copied.getComponent(range.vertexStart + v, c)).toBe(attribute.getComponent(v, c))
            if (name === 'position') {
              const p = new Vector3().fromBufferAttribute(attribute, v)
              expect(batch.boundingSphere!.containsPoint(p.clone().applyMatrix4(local))).toBe(true)
              expect(p.clone().applyMatrix4(world).distanceTo(p.applyMatrix4(mesh.matrixWorld))).toBeLessThan(1e-4)
            }
          }
        }
      }
    }
  } finally {
    models.dispose()
    template.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() })
  }
})
