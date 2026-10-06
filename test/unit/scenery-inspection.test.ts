import { describe, expect, it, vi } from 'vitest'
import { Group, Object3D, Vector3 } from 'three'
import { createSceneryInspection } from '../../src/app/sceneryInspection'
import { GFX_HIDDEN_LAYER } from '../../src/app/graphicsDiagnostics'

type Dependencies = Parameters<typeof createSceneryInspection>[0]
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Target = ReturnType<Dependencies['groundTargets']>[number]

function fixture() {
  let targets: Target[] = []
  const groundTargets = vi.fn(() => targets)
  const battleScenery: Mutable<Dependencies['battleScenery']> = {
    groundModels: null, groundBattle: null, battleFogOn: false,
  }
  const visuals = new Map<number, { lod: object | null; far: boolean; position: Vector3 }>()
  const cameraPosition = new Vector3(), fog = { a: { w: 0 } }
  const probes = createSceneryInspection({ groundTargets, battleScenery, visuals, cameraPosition, fog })
  return { probes, groundTargets, battleScenery, visuals, cameraPosition, fog,
    setTargets(next: Target[]) { targets = next } }
}

const target = (id: Target['unit']['id'], team: Target['team'] = 'red'): Target => ({
  unit: { id }, team, hp: 100, alive: true,
})

describe('scenery inspection', () => {
  it('does not read an uninitialised world when installing probes or when scenery is absent', () => {
    const f = fixture()
    expect(f.groundTargets).not.toHaveBeenCalled()
    expect(f.probes.__hideGround()).toEqual({ hidden: 0, kinds: [] })
    expect(f.groundTargets).not.toHaveBeenCalled()
    expect(f.probes.__theater()).toBeNull()
    expect(f.probes.__mortars()).toBeNull()
    expect(f.probes.__haze(true)).toBeNull()
    expect(f.probes.__dustClouds(false)).toBeNull()
    expect(f.fog.a.w).toBe(0)
  })

  it('hides descendants by unit kind and follows replacement models and target lists', () => {
    const f = fixture(), object = new Group(), tank = new Group(), child = new Object3D(), gun = new Group()
    tank.add(child); object.add(tank, gun)
    f.battleScenery.groundModels = { object, lodState: () => ({ withLod: 0, far: 0 }) }
    f.setTargets([target('tank'), target('atGun')])
    expect(f.probes.__hideGround('tank')).toEqual({ hidden: 1, kinds: ['tank', 'atGun'] })
    expect(tank.layers.mask).toBe(2 ** GFX_HIDDEN_LAYER)
    expect(child.layers.mask).toBe(tank.layers.mask)
    expect(gun.layers.mask).toBe(1)
    f.probes.__hideGround()
    expect(child.layers.mask).toBe(1)
    const next = new Group(), nextTank = new Object3D()
    next.add(nextTank)
    f.battleScenery.groundModels = { object: next, lodState: () => ({ withLod: 0, far: 0 }) }
    f.setTargets([target('tank'), target('tank')])
    expect(f.probes.__hideGround('tank').hidden).toBe(1)
    expect(nextTank.layers.mask).toBe(2 ** GFX_HIDDEN_LAYER)
    expect(tank.layers.mask).toBe(1)
  })

  it('reports live LOD state and camera distance, excluding aircraft without LOD', () => {
    const f = fixture()
    f.visuals.set(0, { lod: null, far: false, position: new Vector3() })
    f.visuals.set(1, { lod: {}, far: true, position: new Vector3(0, 0, 100) })
    f.cameraPosition.z = 10
    expect(f.probes.__lod()).toEqual({ seats: 2, withLod: 1, far: 1, nearest: 90, ground: null })
    f.visuals.clear()
    expect(f.probes.__lod().nearest).toBe(Infinity)
  })

  it('switches fog and dust visibility and returns detached mortar landing snapshots', () => {
    const f = fixture(), dust = new Object3D()
    dust.name = 'groundBattle.dustClouds'
    const landing = { x: 1, y: 2, z: 3 }
    f.battleScenery.groundBattle = { objects: [dust], shots: 4, arcShots: 5, arcLanded: 2, arcLastLanding: landing }
    f.battleScenery.battleFogOn = true
    expect(f.probes.__haze(true)).toBe(true)
    expect(f.fog.a.w).toBe(1)
    expect(f.probes.__haze(false)).toBe(false)
    expect(f.probes.__dustClouds(false)).toBe(false)
    expect(dust.visible).toBe(false)
    expect(f.probes.__theater()).toBe(4)
    const snapshot = f.probes.__mortars()!
    landing.x = 99
    expect(snapshot).toEqual({ shots: 5, landed: 2, last: { x: 1, y: 2, z: 3 } })
    f.battleScenery.groundBattle = null
    expect(f.probes.__mortars()).toBeNull()
    expect(f.probes.__dustClouds()).toBeNull()
  })

  it('wrecks only the requested number of living red units in the current world', () => {
    const f = fixture(), red = [target('tank'), target('tank')], blue = target('tank', 'blue')
    f.setTargets([...red, blue, target('atGun')])
    expect(f.probes.__wreckGround('tank', 1)).toBe(1)
    expect(red[0]).toMatchObject({ hp: 0, alive: false })
    expect(red[1]!.alive).toBe(true)
    expect(f.probes.__wreckGround('tank')).toBe(1)
    expect(blue.alive).toBe(true)
    const next = target('tank')
    f.setTargets([next])
    expect(f.probes.__wreckGround('tank')).toBe(1)
    expect(next.alive).toBe(false)
  })
})
