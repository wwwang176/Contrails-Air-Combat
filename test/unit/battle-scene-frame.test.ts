import { describe, expect, it, vi } from 'vitest'
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three'
import { updateBattleSceneFrame, type BattleSceneFrameDependencies } from '../../src/app/battleSceneFrame'
import { createGroundFires } from '../../src/render/groundFires'
import { createShipFires } from '../../src/render/shipFires'
import { createFireCrowd } from '../../src/render/fireCrowd'
import { createBattle } from '../../src/battle/createBattle'
import { createInputState } from '../../src/input/InputState'
import type { Terrain } from '../../src/render/terrain'

describe('戰鬥場景換場', () => {
  it('新戰鬥只掛上及更新目前圓環，不復用已移除的舊圓環', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera()
    const makeRing = () => ({ object: new Object3D(), update: vi.fn(), dispose: vi.fn() })
    const old = makeRing()
    let ring = old
    const groundFires = createGroundFires()
    const shipFires = createShipFires()
    const battle = createBattle({ update() {} })
    battle.mission.hasTarget = true
    battle.mission.target.copy(new Vector3(100, 200, 300))
    const input = createInputState()
    input.orderMarkers = false
    const deps = {
      ctx: { scene, camera }, groundFires, shipFires,
      fireCrowd: createFireCrowd(groundFires, shipFires),
      steamEmission: { emitPlantSteam() {}, emitFlareSmoke() {} },
      muzzles: { update() {} }, turretBarrels: { update() {} }, turretMuzzles: { update() {} },
      flareLights: { update() {} }, stepEffects() {}, battleScenery: {}, blastPresentation: {},
      wakes: { bindOcean() {}, step() {} }, vortex: { step() {} }, spray: { step() {} },
      orderMarkers: { setVisible() {} }, getObjectiveRing: () => ring,
      sceneWeather: { rain: null }, emitFirePuff() {}, burnBalloon() {}, rainGroundAt() { return 0 },
      renderPositions: [], renderQuaternions: [],
    } as unknown as BattleSceneFrameDependencies
    const terrain = { oceanHeight: null, heightAt: () => 0 } as unknown as Terrain
    const draw = () => updateBattleSceneFrame(deps, 0, 0, 0, input, battle, battle.world, terrain, 'sea')
    draw()
    expect(old.object.parent).toBe(scene)
    expect(old.update).toHaveBeenCalledOnce()
    scene.remove(old.object)
    old.dispose()
    ring = makeRing()
    draw()
    expect(old.object.parent).toBeNull()
    expect(old.update).toHaveBeenCalledOnce()
    expect(ring.object.parent).toBe(scene)
    expect(ring.update).toHaveBeenCalledWith(battle.mission.target, battle.mission.targetRadius, camera)
  })
})
