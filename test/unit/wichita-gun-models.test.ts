import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { prepareShipGuns, SHIP_GUN_PREFIX } from '../../src/render/geometry/shipGuns'
import { applyShipLivery } from '../../src/render/shipAssets'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import { createShipGunModels } from '../../src/render/shipGunModels'
import { WICHITA_GUN_MOUNTS } from '../../src/specs/wichitaGunMounts'
import { gunBarrelIndex, gunMountMuzzle } from '../../src/weapons/gunMount'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns, resetShipGuns, stepGunPlatform } from '../../src/world/shipGuns'
import { selectShipMount, stepShipMounts } from '../../src/world/shipGunMounts'
import { createFlak } from '../../src/world/flak'
import { Projectiles } from '../../src/world/Projectiles'
import type { TurretCombatant } from '../../src/world/turrets'

let original: Object3D
beforeAll(async () => {
  const bytes = readFileSync('models-src/wichita.glb')
  original = (await createGltfLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  applyShipLivery(original, SHIP_LIVERIES.wichita!, null)
})
function model(): Object3D {
  const root = original.clone(true)
  root.traverse(o => { if (o instanceof Mesh) o.geometry = o.geometry.clone() })
  prepareShipGuns(root, 'wichita')
  return root
}
function ship() {
  const s = createShip(0, SHIP_CLASSES.wichita, 'red', 50, 80, 0.7, 0)
  s.guns = createShipGuns(s.cls)
  return s
}
function dispose(root: Object3D) { root.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }) }
function vertices(root: Object3D): string[] {
  root.updateMatrixWorld(true)
  const result: string[] = [], v = new Vector3()
  root.traverse(o => {
    if (!(o instanceof Mesh) || !(o.name === 'WICHITA_Guns' || o.name.startsWith(SHIP_GUN_PREFIX) || o.name.startsWith('WICHITA_5in_'))) return
    const attr = o.geometry.getAttribute('position'), indices = o.geometry.index
    for (let i = 0; i < (indices?.count ?? attr.count); i++) {
      v.fromBufferAttribute(attr, indices?.getX(i) ?? i).applyMatrix4(o.matrixWorld)
      result.push(v.toArray().map(n => Math.round(n * 100)).join(','))
    }
  })
  return result.sort()
}

describe('Wichita measured gun models', () => {
  it('keeps all eight barrels centered on the front face and outside the housing through full elevation', () => {
    const root = model(), rotation = new Quaternion(), point = new Vector3()
    try {
      for (const mount of Object.values(WICHITA_GUN_MOUNTS).filter(m => m.modelNode)) {
        const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
        const barrel = body.children[0] as Mesh
        expect(body.position.distanceTo(mount.pivot)).toBeLessThan(1e-6)
        expect(body.rotation.y).toBeCloseTo(mount.restYaw, 6)
        expect(barrel.rotation.x).toBeCloseTo(mount.restPitch, 6)
        expect(barrel.position.distanceTo(mount.elevationPivot!)).toBeLessThan(1e-6)
        body.geometry.computeBoundingBox()
        const front = body.geometry.boundingBox!.min.z
        expect(barrel.position.x).toBe(0)
        expect(barrel.position.z).toBeLessThan(front)
        const normals = body.geometry.getAttribute('normal')
        expect(Array.from({ length: normals.count }, (_, i) => normals.getZ(i)).some(z => z < -0.999)).toBe(true)
        const vertices = barrel.geometry.getAttribute('position')
        // Mantlet extends behind the front plane to hide the joint; the barrel itself stays outside.
        for (const degrees of [-5, 0, 45, 85]) {
          rotation.setFromAxisAngle(new Vector3(1, 0, 0), degrees * Math.PI / 180)
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i)
            if (Math.abs(point.x) > 0.15) continue // mantlet ends sit at x = +/- 0.55
            point.applyQuaternion(rotation).add(barrel.position)
            expect(point.z, `${mount.id} at ${degrees} degrees`).toBeLessThan(front)
          }
        }
      }
    } finally { dispose(root) }
  })

  it('splits all twenty AA mounts without losing triangles, livery attributes or static main guns', () => {
    const root = model()
    try {
      expect(vertices(root)).toEqual(vertices(original))
      const source = original.getObjectByName('WICHITA_Guns') as Mesh
      for (const mount of Object.values(WICHITA_GUN_MOUNTS)) {
        const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
        expect(body).toBeDefined()
        for (const mesh of [body, body.children[0] as Mesh]) {
          expect(mesh.material).toBe(source.material)
          expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(Object.keys(source.geometry.attributes).sort())
          expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
        }
      }
      const rest = root.getObjectByName('WICHITA_Guns') as Mesh
      const attr = rest.geometry.getAttribute('position')
      // All nine main-gun barrel tips stay in the static remainder.
      for (const z of [-61.2, -49.2, 60.8]) for (const x of [-1.5, 0, 1.5]) {
        let found = false
        for (let i = 0; i < attr.count; i++) if (Math.abs(attr.getZ(i) - z) < 1e-4 && Math.abs(attr.getX(i) - x) < 0.31) found = true
        expect(found).toBe(true)
      }
      const count = root.children.length
      prepareShipGuns(root, 'wichita')
      expect(root.children.length).toBe(count)
      expect(Object.keys(WICHITA_GUN_MOUNTS)).toHaveLength(20)
      expect(ship().guns).toHaveLength(8)
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
          for (const mount of g.projectileMounts!) {
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
              expect(unique.size, mount.id).toBe(mount.modelNode ? 9 : 3)
              actual.set(0, 0, 0)
              for (const p of unique.values()) actual.add(p)
              actual.divideScalar(unique.size).applyMatrix4(barrel.matrixWorld)
              gunMountMuzzle(mount, g.aim, g.muzzleYaw ?? 0, b + 1, expected)
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

  it.each(['p', 's'])('%s batteries park inward-facing mounts and exclude obstructed forward 5-inch mounts', side => {
    const s = ship(), gun = s.guns.find(g => g.zone.id === `flak_${side}`)!
    const sign = side === 'p' ? 1 : -1, yaw = sign * 155 * Math.PI / 180
    gun.aim.set(-Math.sin(yaw) * 0.8, 0.6, -Math.cos(yaw) * 0.8)
    stepShipMounts(gun, true, 100)
    expect(gun.mountPoses!.map(p => p.ready)).toEqual([false, true, true, true])
    const selected = new Set<number>()
    for (let shot = 1; shot <= 100; shot++) selected.add(selectShipMount(gun, shot, 0, 0))
    expect([...selected].sort()).toEqual([1, 2, 3])
    gun.aim.x *= -1
    stepShipMounts(gun, true, 100)
    expect(selectShipMount(gun, 101, 0, 0)).toBe(-1)
    gun.mountPoses!.forEach((pose, i) => expect(pose.yaw).toBeCloseTo(gun.projectileMounts![i]!.restYaw, 8))
    resetShipGuns(s)
    expect(gun.firedMountIndex).toBe(-1)
  })

  it.each(['flak_p', 'flak_s', 'autocannon_p', 'autocannon_s', 'mg_pa', 'mg_sa'])('%s emits from the chosen physical muzzle without changing firing vectors or cadence', id => {
    const s = ship()
    s.guns = s.guns.filter(g => g.zone.id === id)
    const gun = s.guns[0]!
    const legacy = { ...s, guns: [{ ...gun, aim: gun.aim.clone(), projectileMounts: undefined, mountPoses: undefined }], gunCooldowns: new Float32Array(8) }
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
