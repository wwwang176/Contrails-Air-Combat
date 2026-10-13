import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three'
import type { Ship } from '../world/ships'
import { gunBarrelIndex } from '../weapons/gunMount'
import { FLASH_SECONDS } from '../weapons/muzzleFlash'
import { crossFlare, createMuzzleMaterial } from './muzzle'
import { SHIP_GUN_PREFIX } from './geometry/shipGuns'
import { batchShipGunMeshes } from './shipGunBatch'

export type ShipGunShot = (x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number) => void

/** Per-scene bindings borrow cached models and own their draw batches and muzzle flashes. */
export function createShipGunModels(ships: readonly Ship[], hulls: readonly Object3D[]) {
  const sources: { ship: number; gun: number; models: { body: Mesh; barrel: Mesh }[]; previous: number; left: number }[] = []
  const batches: ReturnType<typeof batchShipGunMeshes>[] = []
  for (let k = 0; k < ships.length; k++) {
    const parts: Mesh[] = []
    for (let i = 0; i < ships[k]!.guns.length; i++) {
      const gun = ships[k]!.guns[i]!
      if (!gun.projectileMounts) continue
      const models = gun.projectileMounts.map(mount => {
        const body = hulls[k]!.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh | undefined
        if (!body || !body.children[0]) throw new Error(`Missing ship gun model: ${mount.id}`)
        parts.push(body, body.children[0] as Mesh)
        return { body, barrel: body.children[0] as Mesh }
      })
      sources.push({ ship: k, gun: i, models,
        previous: gun.zone.tier === 'flak' ? gun.fired : gun.shots, left: 0 })
    }
    // Trial the most expensive ship first; the simulation and authored models are unchanged.
    if (ships[k]!.cls.id === 'essex') batches.push(batchShipGunMeshes(hulls[k]!, parts))
  }
  const geometry = crossFlare(), material = createMuzzleMaterial()
  const object = new InstancedMesh(geometry, material, Math.max(1, sources.length))
  object.name = 'shipModels.muzzles'
  object.count = 0
  object.frustumCulled = false
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  const position = new Vector3(), direction = new Vector3(), scale = new Vector3()
  const rotation = new Quaternion(), matrix = new Matrix4(), color = new Color()
  const forward = new Vector3(0, 0, 1)
  return {
    object,
    update(list: readonly Ship[], seconds: number, onShot?: ShipGunShot): void {
      let slot = 0
      for (const source of sources) {
        const ship = list[source.ship], gun = ship?.guns[source.gun]
        if (!ship || !gun?.projectileMounts) continue
        const mounts = gun.projectileMounts
        const count = gun.zone.tier === 'flak' ? gun.fired : gun.shots
        const emitted = Math.max(0, Math.min(8, count - source.previous))
        if (seconds > 0) {
          source.left = count < source.previous ? 0 : emitted > 0 ? FLASH_SECONDS : Math.max(0, source.left - seconds)
          source.previous = count
        }
        if (!ship.alive || !gun.alive) { source.left = 0; continue }
        for (let i = 0; i < source.models.length; i++) {
          const model = source.models[i]!, pose = gun.mountPoses?.[i]
          if (!pose) continue
          model.body.rotation.set(0, pose.yaw, 0)
          model.barrel.rotation.set(pose.pitch, 0, 0)
        }
        const index = gun.firedMountIndex ?? -1
        if (index < 0 || index >= mounts.length) continue
        if (gun.zone.tier === 'flak' && onShot) {
          if (seconds > 0 && emitted > 0) {
            // Coalesce missed render frames to the last physical shot, like the light-gun flash.
            const shot = count
            const mount = mounts[index]!, barrel = source.models[index]!.barrel
            barrel.updateWorldMatrix(true, false)
            direction.set(0, 0, -1).transformDirection(barrel.matrixWorld)
            position.copy(mount.muzzles[gunBarrelIndex(shot, mount.muzzles.length)]!).applyMatrix4(barrel.matrixWorld)
            // Visual scale only; shares the bounded ground-cannon fire/smoke/light pools.
            onShot(position.x, position.y, position.z, direction.x, direction.y, direction.z, 1.25)
          }
          continue
        }
        if (source.left <= 0) continue
        const mount = mounts[index]!, barrel = source.models[index]!.barrel
        barrel.updateWorldMatrix(true, false)
        direction.set(0, 0, -1).transformDirection(barrel.matrixWorld)
        position.copy(mount.muzzles[gunBarrelIndex(source.previous, mount.muzzles.length)]!).applyMatrix4(barrel.matrixWorld)
        const f = source.left / FLASH_SECONDS
        rotation.setFromUnitVectors(forward, direction)
        scale.setScalar(f * (gun.zone.tier === 'flak' ? 3.6 : gun.zone.tier === 'autocannon' ? 1.5 : 1))
        matrix.compose(position, rotation, scale)
        object.setMatrixAt(slot, matrix)
        object.setColorAt(slot, color.setRGB(f, f * 0.8, f * 0.45))
        slot++
      }
      object.count = slot
      for (const batch of batches) batch.update()
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },
    dispose(): void {
      for (const batch of batches) batch.dispose()
      geometry.dispose(); material.dispose(); object.dispose()
    },
  }
}
