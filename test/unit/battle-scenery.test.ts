import { afterEach, describe, expect, it, vi } from 'vitest'
import { FogExp2, Group, Scene, Texture } from 'three'
import type { World } from '../../src/world/World'
import type { MissionTheater } from '../../src/battle/missions/types'
import { createBattleScenery, type BattleSceneryBuilders } from '../../src/render/battleScenery'
import { BATTLE_FOG, battleFogTint, clearBattleFog } from '../../src/render/heightFog'

const theater: MissionTheater = {
  shooters: [], period: 10, range: 1000,
  haze: { x: 100, z: -200, radius: 1500 }, fogColor: 0x345678,
}
const empty = (): Pick<World, 'ships' | 'groundTargets' | 'balloons'> =>
  ({ ships: [], groundTargets: [], balloons: [] })

function fixture() {
  const scene = new Scene()
  scene.fog = new FogExp2(0xabcdef, 0.001)
  const built: { kind: string, object: Group, dispose: ReturnType<typeof vi.fn> }[] = []
  function model(kind: string) {
    const object = new Group()
    const dispose = vi.fn(() => { expect(object.parent).toBeNull() })
    built.push({ kind, object, dispose })
    return { object, dispose, update: vi.fn() }
  }
  const assets = {
    glareTexture: new Texture(), smokeTexture: new Texture(),
    burn: vi.fn(), impact: vi.fn(), fired: vi.fn(),
  }
  const foam = new Texture()
  const builders = {
    createShipModels: vi.fn(() => model('ships')),
    createShipWakes: vi.fn(() => ({ ...model('wakes'), bindOcean: vi.fn(), step: vi.fn() })),
    shipFoamTexture: vi.fn(() => foam),
    createGroundModels: vi.fn(() => ({ ...model('ground'), lodState: () => ({ withLod: 0, far: 0 }), resetTurrets: vi.fn() })),
    createSearchlights: vi.fn(() => model('searchlights')),
    createGroundBattle: vi.fn<BattleSceneryBuilders['createGroundBattle']>(() => {
      const m = model('theater')
      return {
        objects: [m.object], dispose: m.dispose, update: m.update, reset: vi.fn(), aimTarget: () => -1,
        shots: 0, hitShots: 0, arcShots: 0, arcLanded: 0, arcLastLanding: { x: 0, y: 0, z: 0 },
      }
    }),
    createBalloonModels: vi.fn(() => model('balloons')),
  } satisfies BattleSceneryBuilders
  const world = {
    ships: [{}] as World['ships'], groundTargets: [{}] as World['groundTargets'], balloons: [{}] as World['balloons'],
  }
  const scenery = createBattleScenery(scene, assets, builders)
  return { scene, scenery, world, built, assets, builders, foam }
}

afterEach(clearBattleFog)

describe('戰場佈景的所有權', () => {
  it('空場不建立模型；有單位時保持順序，直接傳遞同一批單位、貼圖與回呼', () => {
    const { scene, scenery, world, built, assets, builders, foam } = fixture()
    scenery.rebuild(empty(), theater)
    expect(built).toHaveLength(0)
    expect(scenery.battleFogOn).toBe(false)
    expect(builders.shipFoamTexture).not.toHaveBeenCalled()

    // 地面塗裝原樣交給地面模型（漏傳的症狀是雪地上一台沙黃的戰車，不報錯）
    scenery.rebuild(world, theater, 'winter')
    expect(built.map(x => x.kind)).toEqual(['ships', 'wakes', 'ground', 'searchlights', 'theater', 'balloons'])
    expect(scene.children).toEqual(built.map(x => x.object))
    expect(builders.createShipModels).toHaveBeenCalledWith(world.ships)
    expect(builders.createShipWakes).toHaveBeenCalledWith(world.ships, foam)
    expect(builders.createGroundModels).toHaveBeenCalledWith(world.groundTargets, 'winter')
    expect(builders.createSearchlights).toHaveBeenCalledWith(world.groundTargets, assets.glareTexture)
    expect(builders.createBalloonModels).toHaveBeenCalledWith(world.balloons)
    expect(builders.createGroundBattle).toHaveBeenCalledWith(theater, assets.burn, assets.smokeTexture, assets.impact, assets.fired)
    expect(scenery.battleFogOn).toBe(true)
    expect(BATTLE_FOG.a.w).toBeGreaterThan(0)
    const tint = battleFogTint(scene.fog!.color, theater.fogColor)
    expect(BATTLE_FOG.b).toEqual({ x: tint.r, y: tint.g, z: tint.b, w: 0 })
    scenery.releaseGroundBattle()
    scenery.clearModels()
  })

  it('換場先移出舊物件再各釋放一次，清成空場後沒有殘留；共用貼圖仍存活', () => {
    const { scene, scenery, world, built, assets, foam } = fixture()
    const sharedDisposed = vi.fn()
    for (const t of [assets.glareTexture, assets.smokeTexture, foam]) t.addEventListener('dispose', sharedDisposed)
    scenery.rebuild(world, theater)
    const old = [...built]
    scenery.rebuild(world, undefined)
    for (const r of old) expect(r.dispose).toHaveBeenCalledTimes(1)
    expect(scenery.groundBattle).toBeNull()
    expect(scenery.battleFogOn).toBe(false)
    expect(BATTLE_FOG.a.w).toBe(0)
    expect(scene.children.every(o => !old.some(r => r.object === o))).toBe(true)

    scenery.rebuild(empty(), undefined)
    scenery.releaseGroundBattle()
    scenery.clearModels()
    expect(scene.children).toHaveLength(0)
    for (const r of built) expect(r.dispose).toHaveBeenCalledTimes(1)
    for (const key of ['shipModels', 'shipWakes', 'groundModels', 'searchlights', 'balloonModels', 'groundBattle'] as const) {
      expect(scenery[key]).toBeNull()
    }
    expect(sharedDisposed).not.toHaveBeenCalled()
  })

  it('地面戰效果和模型可依離場流程分開清理，重複清理不重複釋放', () => {
    const { scene, scenery, world, built } = fixture()
    scenery.rebuild(world, theater)
    scenery.releaseGroundBattle()
    scenery.releaseGroundBattle()
    expect(scene.children).toHaveLength(5)
    expect(scenery.battleFogOn).toBe(false)
    expect(built.find(r => r.kind === 'theater')!.dispose).toHaveBeenCalledTimes(1)
    scenery.clearModels()
    scenery.clearModels()
    expect(scene.children).toHaveLength(0)
    for (const r of built) expect(r.dispose).toHaveBeenCalledTimes(1)
  })
})
