import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { prepareShipGuns, SHIP_GUN_PREFIX } from '../../src/render/geometry/shipGuns'
import { applyShipLivery } from '../../src/render/shipAssets'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import { createShipGunModels } from '../../src/render/shipGunModels'
import { FLETCHER_GUN_GROUPS } from '../../src/specs/shipGunMounts'
import { gunMountIndex, gunMountMuzzle } from '../../src/weapons/gunMount'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns, resetShipGuns, stepGunPlatform } from '../../src/world/shipGuns'
import { stepShipMounts, selectShipMount, shipMountCanAim } from '../../src/world/shipGunMounts'
import { createFlak } from '../../src/world/flak'
import { Projectiles } from '../../src/world/Projectiles'
import type { TurretCombatant } from '../../src/world/turrets'

let original: Object3D
beforeAll(async () => {
  const bytes = readFileSync('models-src/fletcher.glb')
  original = (await createGltfLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  applyShipLivery(original, SHIP_LIVERIES.fletcher!, null)
})
function model(): Object3D {
  const root = original.clone(true)
  root.traverse(o => { if (o instanceof Mesh) o.geometry = o.geometry.clone() })
  prepareShipGuns(root, 'fletcher')
  return root
}
function ship() {
  const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 50, 80, 0.7, 0)
  s.guns = createShipGuns(s.cls)
  return s
}
function vertices(root: Object3D): Vector3[] {
  root.updateMatrixWorld(true)
  const result: Vector3[] = []
  root.traverse(o => {
    if (!(o instanceof Mesh) || !(o.name === 'FLETCHER_Guns' || o.name.startsWith(SHIP_GUN_PREFIX))) return
    const attr = o.geometry.getAttribute('position'), indices = o.geometry.index
    for (let i = 0; i < (indices?.count ?? attr.count); i++) result.push(new Vector3().fromBufferAttribute(attr, indices?.getX(i) ?? i).applyMatrix4(o.matrixWorld))
  })
  return result
}
function dispose(root: Object3D) { root.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }) }

describe('Fletcher animated gun geometry', () => {
  it('preserves all original triangles, material, UVs and vertex tones when split', () => {
    const root = model(), before = vertices(original), after = vertices(root)
    expect(after.length).toBe(before.length)
    // Rounded cells avoid relying on original triangle order after extraction.
    const key = (v: Vector3) => v.toArray().map(n => Math.round(n * 100)).join(',')
    expect(after.map(key).sort()).toEqual(before.map(key).sort())
    const source = original.getObjectByName('FLETCHER_Guns') as Mesh
    root.traverse(o => {
      if (!(o instanceof Mesh) || !o.name.startsWith(SHIP_GUN_PREFIX)) return
      expect(o.material).toBe(source.material)
      expect(Object.keys(o.geometry.attributes).sort()).toEqual(Object.keys(source.geometry.attributes).sort())
      expect(o.geometry.getAttribute('color').count).toBe(o.geometry.getAttribute('position').count)
    })
    expect(root.getObjectByName('FLETCHER_Hull')).toBeDefined()
    const count = root.children.length
    prepareShipGuns(root, 'fletcher')
    expect(root.children.length).toBe(count)
    dispose(root)
  })

  it('aligns actual barrel tips, flash and physics muzzle under aim/chassis rotation, including near vertical', () => {
    const root = model(), s = ship(), renderer = createShipGunModels([s], [root])
    const position = new Vector3(), actual = new Vector3(), matrix = new Matrix4()
    root.position.copy(s.position); root.quaternion.copy(s.orientation)
    try {
      for (const aim of [new Vector3(-1, 0, 0), new Vector3(-0.6, 0.8, 0),
        new Vector3(-Math.cos(85 * Math.PI / 180), Math.sin(85 * Math.PI / 180), 0),
        new Vector3(0.001, 1, 0).normalize()]) {
        for (const gun of s.guns) { gun.aim.copy(aim); gun.muzzleYaw = 1.2; gun.shots++; gun.fired++; stepShipMounts(gun, true, 100); gun.firedMountIndex = selectShipMount(gun, gun.shots, s.index, s.guns.indexOf(gun)) }
        renderer.update([s], 1 / 60)
        root.updateMatrixWorld(true)
        let flashSlot = 0
        for (let k = 0; k < s.guns.length; k++) {
          const gun = s.guns[k]!
          // 主砲超過 85° 必須停回中立位；小砲仍驗證接近垂直時的砲口。
          if (gun.zone.tier === 'flak' && Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) > 85 * Math.PI / 180 + 1e-10) {
            expect(gun.mountPoses!.every(p => !p.ready)).toBe(true)
            continue
          }
          for (const mount of gun.projectileMounts!) {
          const barrel = root.getObjectByName(SHIP_GUN_PREFIX + mount.id + '.barrels') as Mesh
          // Average the three unique vertices of each triangular GLB muzzle cap, independently of specs.
          const attr = barrel.geometry.getAttribute('position')
          barrel.geometry.computeBoundingBox()
          const z = barrel.geometry.boundingBox!.min.z
          for (let b = 0; b < mount.muzzles.length; b++) {
            const unique = new Map<string, Vector3>()
            for (let i = 0; i < attr.count; i++) {
              const p = new Vector3().fromBufferAttribute(attr, i)
              if (Math.abs(p.z - z) > 1e-4 || (mount.muzzles.length === 2 && (p.x < 0 ? 0 : 1) !== b)) continue
              unique.set(p.toArray().map(n => n.toFixed(4)).join(','), p)
            }
            expect(unique.size).toBe(3)
            position.set(0, 0, 0)
            for (const v of unique.values()) position.add(v)
            position.divideScalar(unique.size).applyMatrix4(barrel.matrixWorld)
            gunMountMuzzle(mount, gun.aim, gun.muzzleYaw!, b + 1, actual)
            actual.applyQuaternion(s.orientation).add(s.position)
            expect(actual.distanceTo(position)).toBeLessThan(1e-4)
          }
          }
          renderer.object.getMatrixAt(flashSlot++, matrix)
          const mounts = gun.projectileMounts!
          const mount = mounts[gun.firedMountIndex!]!
          gunMountMuzzle(mount, gun.aim, gun.muzzleYaw!, gun.shots, actual)
          actual.applyQuaternion(s.orientation).add(s.position)
          expect(new Vector3().setFromMatrixPosition(matrix).distanceTo(actual)).toBeLessThan(1e-4)
        }
      }
    } finally { renderer.dispose(); dispose(root) }
  })

  it('emits cannon fire once per actual shell and handles pause/reset/death', () => {
    const root = model(), s = ship(), renderer = createShipGunModels([s], [root]), fire = vi.fn()
    const gun = s.guns[0]!
    try {
      gun.shots++ // An attempted shot without an actual spawned shell must not emit cannon fire.
      renderer.update([s], 1 / 60, fire)
      expect(fire).not.toHaveBeenCalled()
      gun.fired++; gun.firedMountIndex = 0
      renderer.update([s], 0, fire)
      expect(fire).not.toHaveBeenCalled()
      renderer.update([s], 1 / 60, fire)
      renderer.update([s], 1 / 60, fire)
      expect(fire).toHaveBeenCalledTimes(1)
      expect((root.getObjectByName('FLETCHER_Guns') as Mesh).geometry.getAttribute('position').count).toBeGreaterThan(0)
      resetShipGuns(s)
      renderer.update([s], 1 / 60, fire)
      gun.fired++; gun.firedMountIndex = 0
      renderer.update([s], 1 / 60, fire)
      expect(fire).toHaveBeenCalledTimes(2)
      gun.alive = false; gun.fired++
      renderer.update([s], 1 / 60, fire)
      expect(fire).toHaveBeenCalledTimes(2)
    } finally { renderer.dispose(); dispose(root) }
  })

  it('turns all five main turrets together and emits each shot from exactly one reproducibly selected turret', () => {
    const root = model(), s = ship(), renderer = createShipGunModels([s], [root]), fire = vi.fn()
    const gun = s.guns[0]!, expected = new Vector3()
    root.position.copy(s.position); root.quaternion.copy(s.orientation)
    gun.aim.set(-0.6, 0.8, 0)
    const selected = new Set<number>(), firstRun: number[][] = []
    try {
      for (let pass = 0; pass < 2; pass++) {
        resetShipGuns(s)
        renderer.update([s], 1 / 60, fire)
        gun.aim.set(-0.6, 0.8, 0)
        fire.mockClear()
        for (let shot = 1; shot <= 20; shot++) {
          gun.shots++; gun.fired++
          stepShipMounts(gun, true, 100)
          gun.firedMountIndex = selectShipMount(gun, shot, s.index, 0)
          renderer.update([s], 1 / 60, fire)
          expect(fire).toHaveBeenCalledTimes(shot)
          const chosen = gunMountIndex(shot, 5, s.index, 0)
          selected.add(chosen)
          const mount = gun.projectileMounts![chosen]!
          gunMountMuzzle(mount, gun.aim, gun.muzzleYaw!, shot, expected)
          expected.applyQuaternion(s.orientation).add(s.position)
          const call = fire.mock.calls[shot - 1]!
          expect(new Vector3(call[0], call[1], call[2]).distanceTo(expected)).toBeLessThan(1e-5)
          if (pass === 0) firstRun.push(call)
          else expect(call).toEqual(firstRun[shot - 1])
          const bodies = gun.projectileMounts!.map(m => root.getObjectByName(SHIP_GUN_PREFIX + m.id)!)
          for (const body of bodies) {
            expect(Math.cos(body.rotation.y - bodies[0]!.rotation.y)).toBeCloseTo(1, 8)
            expect(body.children[0]!.rotation.x).toBeCloseTo(bodies[0]!.children[0]!.rotation.x, 8)
          }
        }
      }
      expect(selected.size).toBe(5)
      expect(s.guns.length).toBe(6)
    } finally { renderer.dispose(); dispose(root) }
  })
})

describe('Fletcher physical emission', () => {
  it.each(['flak_c', 'autocannon_c', 'mg_pf'])('%s changes only origin, preserving lead, cadence, velocity and fuse', id => {
    const s = ship()
    s.guns = s.guns.filter(g => g.zone.id === id)
    const legacy = { ...s, guns: s.guns.map(g => ({ ...g, aim: g.aim.clone(), projectileMounts: undefined })), gunCooldowns: new Float32Array(6) }
    const gun = s.guns[0]!, mounts = FLETCHER_GUN_GROUPS[id]!
    // 使用兩條路徑都能射擊的方向，單獨比較砲口偏移，避免把仰角限制混入比較。
    const direction = gun.zone.tier === 'flak' ? new Vector3(-0.6, 0.8, 0) : gun.axis.clone()
    gun.aim.copy(direction)
    legacy.guns[0]!.aim.copy(direction)
    stepShipMounts(gun, true, 100)
    gun.searchCooldown = 0
    legacy.guns[0]!.searchCooldown = 0
    const enemy = {
      index: 0, team: 'blue', alive: true, hp: 100,
      aircraft: { spec: { turrets: [] }, state: {
        position: direction.clone().multiplyScalar(700).add(gun.zone.position).applyQuaternion(s.orientation).add(s.position),
        velocity: new Vector3(), orientation: new Quaternion(),
      } }, turretStates: [], turretCooldowns: new Float32Array(0),
    } as unknown as TurretCombatant
    const p = new Projectiles(512), oldP = new Projectiles(512), flak = createFlak(), oldFlak = createFlak()
    const calls = vi.spyOn(p, 'spawn'), oldCalls = vi.spyOn(oldP, 'spawn'), expected = new Vector3()
    let checked = 0
    try {
      for (let i = 0; i < 8 * 240; i++) {
        const count = gun.zone.tier === 'flak' ? flak.live : calls.mock.calls.length
        stepGunPlatform(s, [enemy], p, flak, i / 240, 1 / 240)
        stepGunPlatform(legacy, [enemy], oldP, oldFlak, i / 240, 1 / 240)
        expect(gun.aim.toArray()).toEqual(legacy.guns[0]!.aim.toArray())
        expect(gun.shots).toBe(legacy.guns[0]!.shots)
        const after = gun.zone.tier === 'flak' ? flak.live : calls.mock.calls.length
        if (after === count) continue
        const shot = gun.zone.tier === 'flak' ? gun.fired : gun.shots
        const mount = mounts[gun.firedMountIndex!]!
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
        checked++
      }
      expect(checked).toBeGreaterThan(0)
    } finally { vi.restoreAllMocks() }
  })
})

describe('Fletcher individual main-gun sectors', () => {
  it('lets unrestricted light mounts cross the stern by the short path', () => {
    const gun = ship().guns.find(g => g.zone.id === 'autocannon_c')!
    const aim = (degrees: number) => {
      const yaw = degrees * Math.PI / 180
      gun.aim.set(-Math.sin(yaw) * 0.8, 0.6, -Math.cos(yaw) * 0.8)
    }
    aim(179)
    stepShipMounts(gun, true, 100)
    const before = gun.mountPoses![0]!.yaw
    aim(-179)
    stepShipMounts(gun, true, 1 / 240)
    expect(gun.mountPoses![0]!.yaw).toBeGreaterThan(before)
    stepShipMounts(gun, true, 0.03)
    expect(gun.mountPoses![0]!.ready).toBe(true)
  })

  it.each([
    [0, [0, 1]], [90, [0, 1, 2, 3, 4]], [-90, [0, 1, 2, 3, 4]], [180, [3, 4]],
  ])('at yaw %s only unobstructed turrets become emitters', (degrees, expected) => {
    const gun = ship().guns[0]!, yaw = (degrees as number) * Math.PI / 180
    gun.aim.set(-Math.sin(yaw) * 0.8, 0.6, -Math.cos(yaw) * 0.8)
    stepShipMounts(gun, true, 100)
    expect(gun.mountPoses!.flatMap((p, i) => p.ready ? [i] : [])).toEqual(expected)
    const selected = new Set<number>()
    for (let shot = 1; shot <= 100; shot++) selected.add(selectShipMount(gun, shot, 0, 0))
    expect([...selected].sort()).toEqual(expected)
    gun.mountPoses!.forEach((p, i) => {
      if (!p.ready) {
        expect(p.yaw).toBeCloseTo(gun.projectileMounts![i]!.restYaw, 8)
        expect(p.pitch).toBe(gun.projectileMounts![i]!.restPitch)
      }
    })
  })

  it('parks smoothly in a dead sector, waits to realign, and resets mount state', () => {
    const s = ship(), gun = s.guns[0]!, mount = gun.projectileMounts![3]!, pose = gun.mountPoses![3]!
    gun.aim.set(-0.8, 0.6, 0)
    stepShipMounts(gun, true, 100)
    const before = pose.yaw
    gun.aim.set(0, 0.6, -0.8)
    stepShipMounts(gun, true, 1 / 240)
    expect(pose.ready).toBe(false)
    expect(Math.abs(pose.yaw - before)).toBeLessThan(0.02)
    stepShipMounts(gun, true, 100)
    expect(pose.yaw).toBe(mount.restYaw)
    gun.aim.set(-0.8, 0.6, 0)
    stepShipMounts(gun, true, 1 / 240)
    expect(pose.ready).toBe(false)
    stepShipMounts(gun, true, 100)
    expect(pose.ready).toBe(true)
    gun.firedMountIndex = 3
    resetShipGuns(s)
    expect(gun.firedMountIndex).toBe(-1)
    expect(pose.ready).toBe(false)
    expect(pose.yaw).toBe(mount.restYaw)
  })

  it('renders the recorded emitter even if the shared aim enters its dead sector before the next frame', () => {
    const s = ship(), root = model(), gun = s.guns[0]!
    const renderer = createShipGunModels([s], [root]), fire = vi.fn()
    try {
      gun.aim.set(-0.8, 0.6, 0)
      stepShipMounts(gun, true, 100)
      gun.fired = 1; gun.firedMountIndex = 3
      gun.aim.set(0, 0.6, -0.8)
      stepShipMounts(gun, true, 1 / 240)
      expect(gun.mountPoses![3]!.ready).toBe(false)
      renderer.update([s], 1 / 60, fire)
      const barrel = root.getObjectByName(SHIP_GUN_PREFIX + gun.projectileMounts![3]!.id + '.barrels')!
      const expected = gun.projectileMounts![3]!.muzzles[0]!.clone().applyMatrix4(barrel.matrixWorld)
      expect(fire).toHaveBeenCalledTimes(1)
      const call = fire.mock.calls[0]!
      expect(new Vector3(call[0], call[1], call[2]).distanceTo(expected)).toBeLessThan(1e-6)
    } finally { renderer.dispose(); dispose(root) }
  })

  it('never fires when every mount is blocked, while the battery still tracks', () => {
    const s = ship(), original = s.guns[0]!
    s.guns = [{ ...original, projectileMounts: original.projectileMounts!.map(m => ({ ...m, yawSectors: [] })) }]
    const gun = s.guns[0]!
    const enemy = { index: 0, team: 'blue', alive: true, aircraft: { state: {
      position: new Vector3(-600, 500, 0).add(gun.zone.position).applyQuaternion(s.orientation).add(s.position), velocity: new Vector3(),
    } } } as unknown as TurretCombatant
    const p = new Projectiles(64), flak = createFlak()
    for (let i = 0; i < 2400; i++) stepGunPlatform(s, [enemy], p, flak, i / 240, 1 / 240)
    expect(gun.targetIndex).toBe(0)
    expect(gun.aim.x).toBeLessThan(-0.5)
    expect(gun.fired).toBe(0)
    expect(flak.live).toBe(0)
    expect(selectShipMount(gun, 1, 0, 0)).toBe(-1)
    expect(shipMountCanAim(gun.projectileMounts![0]!, 0)).toBe(false)
  })
})
