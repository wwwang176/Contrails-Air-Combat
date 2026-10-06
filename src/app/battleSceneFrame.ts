import type { Quaternion, Vector3 } from 'three'
import type { SceneContext } from '../render/scene'
import type { Battle } from '../battle/battleState'
import type { World } from '../world/World'
import type { InputState } from '../input/InputState'
import { fillOrderView } from '../battle/orderView'
import { updateFireCrowd, type FireCrowd } from '../render/fireCrowd'
import { stepShipFires, type ShipFires } from '../render/shipFires'
import { stepGroundFires, type GroundFires } from '../render/groundFires'
import type { createSteamEmission } from '../render/steamEmission'
import type { Muzzles } from '../render/muzzle'
import type { TurretBarrels } from '../render/turretBarrels'
import type { FlareLights } from '../render/flares'
import type { BattleScenery } from '../render/battleScenery'
import type { Wakes } from '../render/wake'
import type { Vortex } from '../render/vortex'
import type { Particles } from '../render/particles'
import type { OrderMarkers } from '../render/orderMarkers'
import type { ObjectiveRing } from '../render/objectiveRing'
import type { SceneWeather } from '../render/sceneWeather'
import type { createEffectStepper } from '../render/effectStepper'
import type { createBlastPresentation } from '../render/blastPresentation'
import type { createTerrain, TerrainKind } from '../render/terrain'
import { stepBattleFog } from '../render/heightFog'

type Terrain = ReturnType<typeof createTerrain>
type SteamEmission = ReturnType<typeof createSteamEmission>
type EffectStepper = ReturnType<typeof createEffectStepper>
type BlastPresentation = ReturnType<typeof createBlastPresentation>

export interface BattleSceneFrameDependencies {
  readonly ctx: SceneContext
  readonly fireCrowd: FireCrowd
  readonly groundFires: GroundFires
  readonly shipFires: ShipFires
  readonly steamEmission: SteamEmission
  readonly muzzles: Muzzles
  readonly turretBarrels: TurretBarrels
  readonly turretMuzzles: Muzzles
  readonly flareLights: FlareLights
  readonly stepEffects: EffectStepper
  readonly battleScenery: BattleScenery
  readonly blastPresentation: BlastPresentation
  readonly wakes: Wakes
  readonly vortex: Vortex
  readonly spray: Particles
  readonly orderMarkers: OrderMarkers
  readonly objectiveRing: ObjectiveRing
  readonly sceneWeather: SceneWeather
  readonly emitFirePuff: (x: number, y: number, z: number) => void
  readonly burnBalloon: (x: number, y: number, z: number) => void
  readonly rainGroundAt: (x: number, z: number) => number
  readonly renderPositions: readonly Vector3[]
  readonly renderQuaternions: readonly Quaternion[]
}

/** Advances non-HUD scene visuals for one rendered battle frame. */
export function updateBattleSceneFrame(
  deps: BattleSceneFrameDependencies,
  frameSeconds: number,
  worldSeconds: number,
  elapsed: number,
  input: InputState,
  battle: Battle,
  world: World,
  terrain: Terrain,
  terrainKind: TerrainKind,
): void {
  const {
    ctx, fireCrowd, groundFires, shipFires, steamEmission,
    muzzles, turretBarrels, turretMuzzles, flareLights, stepEffects,
    battleScenery, blastPresentation, wakes, vortex, spray,
    orderMarkers, objectiveRing, sceneWeather, emitFirePuff,
    burnBalloon, rainGroundAt,
  } = deps

  updateFireCrowd(fireCrowd, groundFires, shipFires, world.ships, worldSeconds)
  stepShipFires(shipFires, world.ships, worldSeconds, emitFirePuff, fireCrowd.ship)
  stepGroundFires(groundFires, worldSeconds, emitFirePuff, fireCrowd.ground)
  steamEmission.emitPlantSteam(worldSeconds, world.groundTargets, terrainKind)
  steamEmission.emitFlareSmoke(worldSeconds, world.flares)
  muzzles.update(world.combatants, deps.renderPositions, deps.renderQuaternions)
  turretBarrels.update(world.combatants, deps.renderPositions, deps.renderQuaternions)
  turretMuzzles.update(world.combatants, deps.renderPositions, deps.renderQuaternions)
  flareLights.update(world.flares, elapsed)
  stepEffects(worldSeconds, world.time, terrain, elapsed)

  battleScenery.groundModels?.update(world.groundTargets, ctx.camera.position, worldSeconds)
  battleScenery.groundBattle?.update(world.groundTargets, world.time, worldSeconds, world.groundAt)
  if (battleScenery.battleFogOn) stepBattleFog(worldSeconds)
  battleScenery.balloonModels?.update(world.balloons, worldSeconds, terrain.collisionHeightAt, burnBalloon)
  battleScenery.searchlights?.update(elapsed, world.combatants, ctx.camera.position)
  battleScenery.shipModels?.update(world.ships, blastPresentation.emitGunLostBlast)

  const torpedoes = world.torpedoes
  for (let i = 0; i < torpedoes.capacity; i++) {
    if (torpedoes.active[i] === 0 || torpedoes.phase[i] !== 1) continue
    wakes.emit(i, torpedoes.x[i]!, torpedoes.z[i]!, torpedoes.serial[i]!)
  }
  wakes.bindOcean(terrain.oceanHeight)
  wakes.step(worldSeconds, elapsed, terrain.heightAt)
  battleScenery.shipWakes?.bindOcean(terrain.oceanHeight)
  battleScenery.shipWakes?.step(world.ships, worldSeconds, elapsed, terrain.heightAt)
  vortex.step(worldSeconds)
  spray.step(worldSeconds)

  orderMarkers.setVisible(input.orderMarkers)
  if (input.orderMarkers) fillOrderView(battle, orderMarkers)

  if (battle.mission.hasTarget) {
    if (objectiveRing.object.parent === null) ctx.scene.add(objectiveRing.object)
    objectiveRing.update(battle.mission.target, battle.mission.targetRadius, ctx.camera)
  }
  if (sceneWeather.rain !== null) {
    sceneWeather.rain.update(ctx.camera.position, worldSeconds, frameSeconds, input.godView, rainGroundAt)
  }
}
