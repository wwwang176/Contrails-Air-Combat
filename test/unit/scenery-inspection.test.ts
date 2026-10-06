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

describe('場景探針', () => {
  it('裝探針時、或場景不存在時，不去讀還沒初始化的世界', () => {
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

  it('依單位種類隱藏整棵子物件；模型與目標清單換掉後跟著換', () => {
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

  it('回報當下的 LOD 狀態與鏡頭距離，沒有 LOD 的飛機不算', () => {
    const f = fixture()
    f.visuals.set(0, { lod: null, far: false, position: new Vector3() })
    f.visuals.set(1, { lod: {}, far: true, position: new Vector3(0, 0, 100) })
    f.cameraPosition.z = 10
    expect(f.probes.__lod()).toEqual({ seats: 2, withLod: 1, far: 1, nearest: 90, ground: null })
    f.visuals.clear()
    expect(f.probes.__lod().nearest).toBe(Infinity)
  })

  it('切換霧與塵團的顯示；迫擊砲落點回傳脫鉤的快照', () => {
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

  it('只擊毀當下世界裡指定數量的活著的紅隊單位', () => {
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
