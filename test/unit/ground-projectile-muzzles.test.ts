import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Mesh, Quaternion, Vector3 } from 'three'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createGroundModels, GROUND_TURRET_NAME } from '../../src/render/groundTargets'
import { groundGunMuzzleOf, groundQuadGunMuzzlesOf, readGroundGunMuzzle } from '../../src/render/groundGunShots'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery, GROUND_LIGHT_FLAK_SPEC, GROUND_M16_SPEC, GROUND_MG_SPEC, resetGroundBattery, stepGunPlatform } from '../../src/world/shipGuns'
import { Projectiles } from '../../src/world/Projectiles'
import { createFlak } from '../../src/world/flak'
import type { TurretCombatant } from '../../src/world/turrets'
import { gunMountMuzzle } from '../../src/weapons/gunMount'

beforeAll(async () => {
  await preloadGroundModels(async url => {
    const b = readFileSync(`public${url}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
})

const camera = new Vector3()
function target(position: Vector3): TurretCombatant {
  return {
    index: 0, team: 'blue', alive: true, hp: 100,
    aircraft: { spec: { turrets: [] }, state: { position, velocity: new Vector3(), orientation: new Quaternion() } },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

describe('ground projectile origins', () => {
  it.each(['flakLight', 'usFlakTrack', 'usTank'] as const)('%s fires from each actual model muzzle without changing velocity or cadence', id => {
    const mounted = createGroundTarget(0, id, 'red', 123, 245, 0.7)
    mounted.position.y = 17
    const spec = id === 'usTank' ? GROUND_MG_SPEC : id === 'usFlakTrack' ? GROUND_M16_SPEC : GROUND_LIGHT_FLAK_SPEC
    const tier = id === 'usTank' ? 'mg' : 'autocannon'
    mounted.guns = createGroundBattery(spec, tier, spec.caliber)
    // Identical reference platform with the legacy emission point.
    const baseline = { ...mounted, projectileMount: undefined, guns: createGroundBattery(spec, tier, spec.caliber), gunCooldowns: new Float32Array(1) }
    const models = createGroundModels([mounted])
    const trav = models.object.getObjectByName(GROUND_TURRET_NAME) as Mesh
    const barrel = id === 'usTank' ? models.object.getObjectByName('groundModels.roofGun') as Mesh : trav.children[0] as Mesh
    // Measure geometry independently of the shared physics/flash constants.
    const tips = id === 'usTank' ? [groundGunMuzzleOf(barrel)] : groundQuadGunMuzzlesOf(barrel)
    const p = new Projectiles(512), legacy = new Projectiles(512), flak = createFlak()
    const emitted = vi.spyOn(p, 'spawn'), oldEmitted = vi.spyOn(legacy, 'spawn')
    const enemy = target(new Vector3(-300, 550, -700).applyQuaternion(mounted.orientation).add(mounted.position))
    const position = new Vector3(), direction = new Vector3()
    let checked = 0
    try {
      for (let i = 0; i < 720; i++) {
        // Moving chassis: origin must follow its current physical position.
        mounted.position.x += 0.01
        const was = emitted.mock.calls.length
        stepGunPlatform(mounted, [enemy], p, flak, i / 240, 1 / 240)
        stepGunPlatform(baseline, [enemy], legacy, flak, i / 240, 1 / 240)
        expect(mounted.guns[0]!.aim.toArray()).toEqual(baseline.guns[0]!.aim.toArray())
        expect(emitted.mock.calls.length).toBe(oldEmitted.mock.calls.length)
        if (emitted.mock.calls.length === was) continue
        models.update([mounted], camera, 1 / 240)
        for (let n = was; n < emitted.mock.calls.length; n++) {
          const call = emitted.mock.calls[n]!, old = oldEmitted.mock.calls[n]!
          expect(call.slice(3)).toEqual(old.slice(3))
          readGroundGunMuzzle(barrel, tips[n % tips.length]!, position, direction)
          expect(new Vector3(call[0], call[1], call[2]).distanceTo(position)).toBeLessThan(1e-5)
          expect(new Vector3(call[0], call[1], call[2]).distanceTo(new Vector3(old[0], old[1], old[2]))).toBeGreaterThan(0.1)
          checked++
        }
      }
      expect(checked).toBeGreaterThanOrEqual(8)
      resetGroundBattery(mounted)
      expect(mounted.guns[0]!.shots).toBe(0)
      expect(mounted.guns[0]!.muzzleYaw).toBe(0)
    } finally { models.dispose(); vi.restoreAllMocks() }
  })

  it('Sherman roof muzzle stays aligned while the main turret traverses and the chassis turns', () => {
    const t = createGroundTarget(0, 'usTank', 'red', 20, 30, 0.8)
    t.guns = createGroundBattery(GROUND_MG_SPEC, 'mg', 12.7)
    t.guns[0]!.aim.set(0.6, 0.8, 0)
    const other = createGroundTarget(1, 'tank', 'blue', -200, -100, 0)
    const targets = [t, other], models = createGroundModels(targets)
    const barrel = models.object.getObjectByName('groundModels.roofGun') as Mesh
    const tip = groundGunMuzzleOf(barrel)
    const actual = new Vector3(), expected = new Vector3(), direction = new Vector3()
    try {
      models.update(targets, camera, 10, { aimTarget: () => 1 })
      expect(Math.abs(models.object.getObjectByName(GROUND_TURRET_NAME)!.rotation.y)).toBeGreaterThan(0.1)
      gunMountMuzzle(t.projectileMount!, t.guns[0]!.aim, 0, 1, actual)
      actual.applyQuaternion(t.orientation).add(t.position)
      readGroundGunMuzzle(barrel, tip, expected, direction)
      expect(actual.distanceTo(expected)).toBeLessThan(1e-5)
      expect(direction.distanceTo(t.guns[0]!.aim.clone().applyQuaternion(t.orientation))).toBeLessThan(1e-5)
    } finally { models.dispose() }
  })

  it.each(['flakLight', 'usFlakTrack'] as const)('%s keeps muzzle and model aligned at near-vertical mechanical limit', id => {
    const t = createGroundTarget(0, id, 'red', 50, 90, 1.1)
    t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', 20)
    const g = t.guns[0]!
    g.muzzleYaw = 1.2
    g.aim.set(0.001, 1, 0).normalize()
    const models = createGroundModels([t])
    const barrel = models.object.getObjectByName(GROUND_TURRET_NAME)!.children[0] as Mesh
    const tips = groundQuadGunMuzzlesOf(barrel)
    const actual = new Vector3(), expected = new Vector3(), direction = new Vector3()
    try {
      models.update([t], camera, 1 / 60)
      for (let shot = 1; shot <= 8; shot++) {
        gunMountMuzzle(t.projectileMount!, g.aim, g.muzzleYaw, shot, actual)
        actual.applyQuaternion(t.orientation).add(t.position)
        readGroundGunMuzzle(barrel, tips[(shot - 1) % 4]!, expected, direction)
        expect(actual.distanceTo(expected)).toBeLessThan(1e-5)
      }
    } finally { models.dispose() }
  })
})
