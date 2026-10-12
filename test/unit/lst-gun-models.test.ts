import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { prepareShipGuns, SHIP_GUN_PREFIX } from '../../src/render/geometry/shipGuns'
import { applyShipLivery } from '../../src/render/shipAssets'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import { createShipGunModels } from '../../src/render/shipGunModels'
import { LST_GUN_MOUNTS } from '../../src/specs/lstGunMounts'
import { gunMountMuzzle } from '../../src/weapons/gunMount'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns, resetShipGuns, stepGunPlatform } from '../../src/world/shipGuns'
import { selectShipMount, stepShipMounts } from '../../src/world/shipGunMounts'
import { createFlak } from '../../src/world/flak'
import { Projectiles } from '../../src/world/Projectiles'
import type { TurretCombatant } from '../../src/world/turrets'

let original: Object3D
beforeAll(async () => {
  const bytes = readFileSync('models-src/lst.glb')
  original = (await createGltfLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  applyShipLivery(original, SHIP_LIVERIES.lst!, null)
})
function model(): Object3D {
  const root = original.clone(true)
  root.traverse(o => { if (o instanceof Mesh) o.geometry = o.geometry.clone() })
  prepareShipGuns(root, 'lst')
  return root
}
function ship() {
  const s = createShip(0, SHIP_CLASSES.lst, 'red', 50, 80, 0.7, 0)
  s.guns = createShipGuns(s.cls)
  return s
}
function dispose(root: Object3D) { root.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }) }
function direction(yaw: number, pitch: number): Vector3 {
  yaw *= Math.PI / 180; pitch *= Math.PI / 180
  return new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
}

describe('LST original gun models', () => {
  it('binds four twin 40 mm and four single 20 mm mounts once to the five existing batteries', () => {
    const root = model()
    try {
      const mounts = Object.values(LST_GUN_MOUNTS), guns = ship().guns
      expect(mounts.filter(m => m.tier === 'autocannon')).toHaveLength(4)
      expect(mounts.filter(m => m.tier === 'mg')).toHaveLength(4)
      expect(guns).toHaveLength(5)
      const ids = guns.flatMap(g => g.projectileMounts!.map(m => m.id))
      expect(new Set(ids).size).toBe(8)
      expect(ids).toHaveLength(8)
      for (const mount of mounts) {
        const body = root.getObjectByName(SHIP_GUN_PREFIX + mount.id) as Mesh
        const barrel = body.children[0] as Mesh
        expect(body.position.distanceTo(mount.pivot)).toBeLessThan(1e-6)
        expect(barrel.position.distanceTo(mount.elevationPivot!)).toBeLessThan(1e-5)
        expect(mount.muzzles.length).toBe(mount.tier === 'mg' ? 1 : 2)
        for (const mesh of [body, barrel]) {
          const n = mesh.geometry.getAttribute('position').count
          expect(mesh.geometry.getAttribute('color').count).toBe(n)
          expect(mesh.geometry.getAttribute('uv').count).toBe(n)
          expect((mesh.material as MeshStandardMaterial).flatShading).toBe(true)
        }
      }
      const count = root.children.length
      prepareShipGuns(root, 'lst')
      expect(root.children.length).toBe(count)
    } finally { dispose(root) }
  })

  it('matches the original pentagonal muzzle caps and every rendered flash after ship and gun rotation', () => {
    const root = model(), s = ship(), renderer = createShipGunModels([s], [root])
    root.position.copy(s.position); root.quaternion.copy(s.orientation)
    const matrix = new Matrix4(), expected = new Vector3(), actual = new Vector3()
    try {
      for (let shot = 1; shot <= 2; shot++) {
        s.guns.forEach((g, i) => {
          g.aim.copy(direction(g.zone.position.x > 0 ? -90 : 90, 40))
          stepShipMounts(g, true, 100)
          g.shots = shot; g.fired = shot; g.firedMountIndex = selectShipMount(g, shot, s.index, i)
        })
        renderer.update([s], 1 / 60)
        root.updateMatrixWorld(true)
        expect(renderer.object.count).toBe(5)
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
              expect(unique.size, mount.id).toBe(5)
              actual.set(0, 0, 0)
              for (const p of unique.values()) actual.add(p)
              actual.divideScalar(unique.size).applyMatrix4(barrel.matrixWorld)
              const pose = g.mountPoses![mountIndex]!
              gunMountMuzzle(mount, direction(pose.yaw * 180 / Math.PI, pose.pitch * 180 / Math.PI), pose.yaw, b + 1, expected)
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

  it('parks blocked mounts, selects only clear barrels, and honors stern and elevation boundaries', () => {
    const s = ship(), gun = s.guns.find(g => g.zone.id === 'autocannon_c')!
    const ready = (yaw: number, pitch: number) => {
      gun.aim.copy(direction(yaw, pitch)); stepShipMounts(gun, true, 100)
      return gun.projectileMounts!.filter((_, i) => gun.mountPoses![i]!.ready).map(m => m.id)
    }
    expect(ready(0, 40)).toEqual(['autocannon_c1'])
    for (const yaw of [-180, 180]) expect(ready(yaw, 40)).toEqual(['autocannon_c2'])
    expect(ready(90, 15)).toEqual(['autocannon_c1', 'autocannon_p1'])
    expect(ready(-90, 85)).toEqual(['autocannon_c1', 'autocannon_s1'])
    for (const pitch of [14.99, 85.01]) {
      expect(ready(90, pitch)).toEqual([])
      expect(selectShipMount(gun, 1, 0, 0)).toBe(-1)
      gun.mountPoses!.forEach((pose, i) => {
        expect(pose.yaw).toBeCloseTo(gun.projectileMounts![i]!.restYaw, 8)
        expect(pose.pitch).toBeCloseTo(gun.projectileMounts![i]!.restPitch, 8)
      })
    }
    for (const g of s.guns.filter(g => g.zone.tier === 'mg')) {
      g.aim.copy(direction(g.zone.position.x > 0 ? 90 : -90, 40))
      expect(stepShipMounts(g, true, 100)).toBe(false)
    }
    resetShipGuns(s)
    expect(gun.firedMountIndex).toBe(-1)
  })

  it.each(['autocannon_c', 'mg_pa', 'mg_pf', 'mg_sa', 'mg_sf'])('%s fires from its chosen muzzle with unchanged vectors and battery cadence', id => {
    const s = ship()
    s.guns = s.guns.filter(g => g.zone.id === id)
    const gun = s.guns[0]!
    const legacy = { ...s, guns: [{ ...gun, aim: gun.aim.clone(), projectileMounts: undefined, mountPoses: undefined }], gunCooldowns: new Float32Array(5) }
    gun.axis.copy(direction(gun.zone.position.x > 0 ? -90 : 90, 40))
    gun.aim.copy(gun.axis); legacy.guns[0]!.aim.copy(gun.axis)
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
        const before = calls.mock.calls.length
        stepGunPlatform(s, [enemy], p, flak, i / 240, 1 / 240)
        stepGunPlatform(legacy, [enemy], oldP, oldFlak, i / 240, 1 / 240)
        expect(gun.shots).toBe(legacy.guns[0]!.shots)
        if (calls.mock.calls.length === before) continue
        const mount = gun.projectileMounts![gun.firedMountIndex!]!
        emitters.add(mount.id)
        expect(gun.mountPoses![gun.firedMountIndex!]!.ready).toBe(true)
        gunMountMuzzle(mount, gun.aim, gun.muzzleYaw ?? 0, gun.shots, expected)
        expected.applyQuaternion(s.orientation).add(s.position)
        const call = calls.mock.calls.at(-1)!, old = oldCalls.mock.calls.at(-1)!
        expect(call.slice(3)).toEqual(old.slice(3))
        expect(new Vector3(call[0], call[1], call[2]).distanceTo(expected)).toBeLessThan(1e-6)
      }
      expect(calls.mock.calls.length).toBeGreaterThan(0)
      expect(emitters.size).toBe(id === 'autocannon_c' ? 2 : 1)
    } finally { vi.restoreAllMocks() }
  })
})
