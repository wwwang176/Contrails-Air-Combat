import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { BatchedMesh, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { prepareShipGuns, SHIP_GUN_PREFIX } from '../../src/render/geometry/shipGuns'
import { applyShipLivery } from '../../src/render/shipAssets'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import { createShipGunModels } from '../../src/render/shipGunModels'
import { ESSEX_GUN_MOUNTS } from '../../src/specs/essexGunMounts'
import { gunBarrelIndex, gunMountMuzzle } from '../../src/weapons/gunMount'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns, resetShipGuns, stepGunPlatform } from '../../src/world/shipGuns'
import { selectShipMount, stepShipMounts } from '../../src/world/shipGunMounts'
import { createFlak } from '../../src/world/flak'
import { Projectiles } from '../../src/world/Projectiles'
import type { TurretCombatant } from '../../src/world/turrets'

let original: Object3D
beforeAll(async () => {
  const bytes = readFileSync('models-src/essex.glb')
  original = (await createGltfLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  applyShipLivery(original, SHIP_LIVERIES.essex!, null)
})
function model(): Object3D {
  const root = original.clone(true)
  root.traverse(o => { if (o instanceof Mesh) o.geometry = o.geometry.clone() })
  prepareShipGuns(root, 'essex')
  return root
}
function ship() {
  const s = createShip(0, SHIP_CLASSES.essex, 'red', 50, 80, 0.7, 0)
  s.guns = createShipGuns(s.cls)
  return s
}
function dispose(root: Object3D) { root.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }) }
function vertices(root: Object3D): string[] {
  root.updateMatrixWorld(true)
  const result: string[] = [], v = new Vector3()
  root.traverse(o => {
    if (!(o instanceof Mesh) || !(o.name === 'ESSEX_Guns' || o.name.startsWith(SHIP_GUN_PREFIX) || o.name.startsWith('ESSEX_mount_'))) return
    const attr = o.geometry.getAttribute('position'), indices = o.geometry.index
    for (let i = 0; i < (indices?.count ?? attr.count); i++) {
      v.fromBufferAttribute(attr, indices?.getX(i) ?? i).applyMatrix4(o.matrixWorld)
      result.push(v.toArray().map(n => Math.round(n * 100)).join(','))
    }
  })
  return result.sort()
}

describe('Essex measured gun models', () => {
  it('batches all 92 gun pieces while preserving their vertex attributes and articulated transforms', () => {
    const root = model(), s = ship()
    const pieces = s.guns.flatMap(g => g.projectileMounts!.flatMap(mount => {
      const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
      return [body, body.children[0] as Mesh]
    }))
    const renderer = createShipGunModels([s], [root])
    try {
      root.position.copy(s.position); root.quaternion.copy(s.orientation)
      for (const g of s.guns) { g.aim.set(Math.sign(g.zone.position.x) * 0.8, 0.6, 0); stepShipMounts(g, true, 100) }
      renderer.update([s], 1 / 60); root.updateMatrixWorld(true)
      const batches = root.children.filter(o => o instanceof BatchedMesh) as BatchedMesh[]
      expect(batches).toHaveLength(1)
      const batch = batches[0]!
      expect(batch.instanceCount).toBe(92)
      for (const [id, piece] of pieces.entries()) {
        expect(piece.layers.mask).toBe(0)
        const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(id))!
        const local = batch.getMatrixAt(id, new Matrix4())
        const world = local.clone().premultiply(batch.matrixWorld)
        for (const [name, attribute] of Object.entries(piece.geometry.attributes)) {
          const copied = batch.geometry.getAttribute(name)
          for (let v = 0; v < attribute.count; v++) {
            for (let c = 0; c < attribute.itemSize; c++) expect(copied.getComponent(range.vertexStart + v, c)).toBe(attribute.getComponent(v, c))
            if (name === 'position') {
              const p = new Vector3().fromBufferAttribute(attribute, v)
              expect(batch.boundingSphere!.containsPoint(p.clone().applyMatrix4(local))).toBe(true)
              expect(p.clone().applyMatrix4(world).distanceTo(p.applyMatrix4(piece.matrixWorld))).toBeLessThan(1e-4)
            }
          }
        }
      }
    } finally { renderer.dispose(); dispose(root) }
  })

  it('keeps five-inch and 40 mm barrels outside the front face through full elevation', () => {
    const root = model(), point = new Vector3(), rotation = new Quaternion()
    try {
      for (const mount of Object.values(ESSEX_GUN_MOUNTS).filter(m => m.tier !== 'mg')) {
        const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
        const barrel = body.children[0] as Mesh
        body.geometry.computeBoundingBox()
        const front = body.geometry.boundingBox!.min.z
        expect(barrel.position.x).toBe(0)
        expect(barrel.position.z).toBeLessThan(front)
        const positions = barrel.geometry.getAttribute('position')
        for (const pitch of [0, 45, 85]) {
          rotation.setFromAxisAngle(new Vector3(1, 0, 0), pitch * Math.PI / 180)
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i)
            if (point.z > -0.5) continue // exclude the mantlet joining the front face
            point.applyQuaternion(rotation).add(barrel.position)
            expect(point.z, `${mount.id} at ${pitch} degrees`).toBeLessThan(front)
          }
        }
      }
    } finally { dispose(root) }
  })

  it('binds all 46 physical mounts once, preserves geometry and livery, and keeps eight batteries', () => {
    const root = model()
    try {
      expect(vertices(root)).toEqual(vertices(original))
      expect(Object.keys(ESSEX_GUN_MOUNTS)).toHaveLength(46)
      const guns = ship().guns
      expect(guns).toHaveLength(8)
      const ids = guns.flatMap(g => g.projectileMounts!.map(m => m.id))
      expect(new Set(ids).size).toBe(46)
      expect(ids).toHaveLength(46)
      for (const id of ['autocannon_p2', 'autocannon_p5', 'mg_p9', 'mg_s6', 'mg_s7', 'mg_s10', 'mg_s15']) {
        expect(ESSEX_GUN_MOUNTS[id]).toBeUndefined()
        expect(root.getObjectByName(SHIP_GUN_PREFIX + id)).toBeUndefined()
        expect(original.getObjectByName('ESSEX_mount_' + id)).toBeUndefined()
      }
      for (const mount of Object.values(ESSEX_GUN_MOUNTS)) {
        const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
        expect(body.position.distanceTo(mount.pivot)).toBeLessThan(1e-6)
        const barrel = body.children[0] as Mesh
        expect(barrel.position.distanceTo(mount.elevationPivot!)).toBeLessThan(1e-6)
        const normals = body.geometry.getAttribute('normal')
        expect(Array.from({ length: normals.count }, (_, i) => normals.getY(i)).filter(y => y > 0.99).length, mount.id).toBeGreaterThanOrEqual(6)
        if (mount.tier === 'mg') {
          body.geometry.computeBoundingBox()
          expect(barrel.position.y).toBeGreaterThan(body.geometry.boundingBox!.max.y)
          expect(barrel.position.x).toBe(0)
          expect(Array.from({ length: normals.count }, (_, i) => normals.getZ(i)).some(z => z < -0.99)).toBe(true)
        } else {
          body.geometry.computeBoundingBox()
          const size = body.geometry.boundingBox!.getSize(new Vector3())
          const width = mount.tier === 'autocannon' ? 1.8 : mount.muzzles.length === 2 ? 4.4 * 2 / 3 : 2.8 * 2 / 3
          const height = mount.tier === 'autocannon' ? 1.35 : mount.muzzles.length === 2 ? 3.3 : 2.6
          expect(size.x).toBeCloseTo(width, 4)
          expect(size.z).toBeCloseTo(width, 4)
          expect(size.y).toBeCloseTo(height, 4)
        }
        for (const mesh of [body, barrel]) {
          expect(mesh.geometry.getAttribute('color').count).toBe(mesh.geometry.getAttribute('position').count)
          expect(mesh.geometry.getAttribute('uv').count).toBe(mesh.geometry.getAttribute('position').count)
        }
      }
      const count = root.children.length
      prepareShipGuns(root, 'essex')
      expect(root.children.length).toBe(count)
    } finally { dispose(root) }
  })

  it('matches every physical muzzle cap and the rendered flash after ship and gun rotation', () => {
    const root = model(), s = ship(), renderer = createShipGunModels([s], [root])
    root.position.copy(s.position); root.quaternion.copy(s.orientation)
    const matrix = new Matrix4(), expected = new Vector3(), actual = new Vector3()
    try {
      for (let shot = 1; shot <= 2; shot++) {
        s.guns.forEach((g, i) => {
          g.aim.set(Math.sign(g.zone.position.x) * 0.8, 0.6, 0)
          stepShipMounts(g, true, 100)
          g.shots = shot; g.fired = shot; g.firedMountIndex = selectShipMount(g, shot, s.index, i)
        })
        renderer.update([s], 1 / 60)
        root.updateMatrixWorld(true)
        expect(renderer.object.count).toBe(8)
        s.guns.forEach((g, i) => {
          for (const [mountIndex, mount] of g.projectileMounts!.entries()) {
            const barrel = root.getObjectByName(SHIP_GUN_PREFIX + mount.id + '.barrels') as Mesh
            const attr = barrel.geometry.getAttribute('position')
            barrel.geometry.computeBoundingBox()
            for (let b = 0; b < mount.muzzles.length; b++) {
              const unique = new Map<string, Vector3>()
              for (let v = 0; v < attr.count; v++) {
                const p = new Vector3().fromBufferAttribute(attr, v)
                if (Math.abs(p.z - barrel.geometry.boundingBox!.min.z) > 1e-4 || (mount.muzzles.length === 2 && (p.x < 0 ? 0 : 1) !== b)) continue
                unique.set(p.toArray().map(n => Math.round(n * 1e4)).join(','), p)
              }
              expect(unique.size, mount.id).toBe(mount.tier === 'flak' ? 9 : mount.tier === 'autocannon' ? 7 : 3)
              actual.set(0, 0, 0)
              for (const p of unique.values()) actual.add(p)
              actual.divideScalar(unique.size).applyMatrix4(barrel.matrixWorld)
              const pose = g.mountPoses![mountIndex]!
              const direction = new Vector3(-Math.sin(pose.yaw) * Math.cos(pose.pitch), Math.sin(pose.pitch), -Math.cos(pose.yaw) * Math.cos(pose.pitch))
              gunMountMuzzle(mount, direction, pose.yaw, b + 1, expected)
              expected.applyQuaternion(s.orientation).add(s.position)
              expect(actual.distanceTo(expected), mount.id).toBeLessThan(1e-4)
            }
          }
          const mount = g.projectileMounts![g.firedMountIndex!]!
          gunMountMuzzle(mount, g.aim, g.muzzleYaw ?? 0, shot, expected)
          expected.applyQuaternion(s.orientation).add(s.position)
          renderer.object.getMatrixAt(i, matrix)
          expect(actual.setFromMatrixPosition(matrix).distanceTo(expected)).toBeLessThan(1e-4)
        })
      }
    } finally { renderer.dispose(); dispose(root) }
  })

  it.each(['p', 's'])('%s parks obstructed mounts and honors exact pitch and stern yaw boundaries', side => {
    const s = ship(), gun = s.guns.find(g => g.zone.id === `autocannon_${side}`)!
    const sign = side === 'p' ? 1 : -1
    function aim(yaw: number, pitch: number) {
      yaw *= Math.PI / 180; pitch *= Math.PI / 180
      gun.aim.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
      stepShipMounts(gun, true, 100)
    }
    const stern = gun.projectileMounts!.findIndex(m => m.id === (side === 'p' ? 'autocannon_p10' : 'autocannon_s8'))
    for (const yaw of [-180, 180]) {
      aim(yaw, 60)
      expect(gun.mountPoses![stern]!.ready).toBe(true)
      expect(selectShipMount(gun, 1, 0, 0)).toBe(stern)
    }
    aim(sign * 160, 60.01)
    expect(selectShipMount(gun, 1, 0, 0)).toBe(-1)
    aim(sign * 90, 85)
    expect(gun.mountPoses!.filter(p => p.ready).length).toBeGreaterThan(0)
    aim(sign * 90, 85.01)
    expect(selectShipMount(gun, 1, 0, 0)).toBe(-1)
    aim(-sign * 90, 30)
    gun.mountPoses!.forEach((pose, i) => {
      expect(pose.ready).toBe(false)
      expect(pose.yaw).toBeCloseTo(gun.projectileMounts![i]!.restYaw, 8)
    })
    resetShipGuns(s)
    expect(gun.firedMountIndex).toBe(-1)
  })

  it.each(['flak_p', 'flak_s', 'autocannon_p', 'autocannon_s', 'mg_pa', 'mg_sa'])('%s emits from the chosen physical muzzle without changing firing vectors or cadence', id => {
    const s = ship()
    s.guns = s.guns.filter(g => g.zone.id === id)
    const gun = s.guns[0]!
    const legacy = { ...s, guns: [{ ...gun, aim: gun.aim.clone(), projectileMounts: undefined, mountPoses: undefined }], gunCooldowns: new Float32Array(8) }
    gun.axis.set(Math.sign(gun.zone.position.x), 0, 0)
    gun.aim.copy(gun.axis)
    legacy.guns[0]!.aim.copy(gun.axis)
    stepShipMounts(gun, true, 100)
    gun.searchCooldown = 0; legacy.guns[0]!.searchCooldown = 0
    const enemy = { index: 0, team: 'blue', alive: true, aircraft: { state: {
      position: gun.axis.clone().multiplyScalar(700).add(gun.zone.position).applyQuaternion(s.orientation).add(s.position), velocity: new Vector3(), orientation: new Quaternion(),
    } } } as unknown as TurretCombatant
    const p = new Projectiles(512), oldP = new Projectiles(512), flak = createFlak(), oldFlak = createFlak()
    const calls = vi.spyOn(p, 'spawn'), oldCalls = vi.spyOn(oldP, 'spawn'), expected = new Vector3()
    const emitters = new Set<string>()
    try {
      for (let i = 0; i < 12 * 240; i++) {
        const before = gun.zone.tier === 'flak' ? flak.live : calls.mock.calls.length
        stepGunPlatform(s, [enemy], p, flak, i / 240, 1 / 240)
        stepGunPlatform(legacy, [enemy], oldP, oldFlak, i / 240, 1 / 240)
        expect(gun.shots).toBe(legacy.guns[0]!.shots)
        const after = gun.zone.tier === 'flak' ? flak.live : calls.mock.calls.length
        if (after === before) continue
        const shot = gun.zone.tier === 'flak' ? gun.fired : gun.shots, mount = gun.projectileMounts![gun.firedMountIndex!]!
        emitters.add(`${mount.id}.${gunBarrelIndex(shot, mount.muzzles.length)}`)
        expect(gun.mountPoses![gun.firedMountIndex!]!.ready).toBe(true)
        gunMountMuzzle(mount, gun.aim, gun.muzzleYaw ?? 0, shot, expected)
        expected.applyQuaternion(s.orientation).add(s.position)
        if (gun.zone.tier === 'flak') {
          const n = after - 1
          for (const key of ['vx', 'vy', 'vz', 'fuse', 'radius', 'damage'] as const) expect(flak[key][n]).toBe(oldFlak[key][n])
          expect(new Vector3(flak.x[n], flak.y[n], flak.z[n]).distanceTo(expected)).toBeLessThan(1e-4)
        } else {
          const call = calls.mock.calls[after - 1]!, old = oldCalls.mock.calls[after - 1]!
          expect(call.slice(3)).toEqual(old.slice(3))
          expect(new Vector3(call[0], call[1], call[2]).distanceTo(expected)).toBeLessThan(1e-6)
        }
      }
      expect(emitters.size).toBeGreaterThan(1)
    } finally { vi.restoreAllMocks() }
  })
})
