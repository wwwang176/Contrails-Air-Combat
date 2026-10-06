import { Quaternion, Vector3 } from 'three'
import type { SceneContext } from '../render/scene'
import type { HudFrame } from '../hud/types'
import type { InputState } from '../input/InputState'
import type { Combatant } from '../world/combatant'
import type { Loadout } from '../weapons/stores'
import type { BombBay } from '../weapons/bomb'
import type { ReleaseEnvelope } from '../weapons/releaseEnvelope'
import type { createTerrain } from '../render/terrain'
import {
  TORPEDO_RUN_SAMPLES, runSampleDistance,
  torpedoEntersWater, torpedoHeading,
} from '../world/torpedo'
import { runFrontCount } from '../hud/widgets/torpedoLine'

export interface BombSightHudScratch {
  readonly probe: Vector3
  readonly bombNdc: Vector3
  readonly noseH: Vector3
  readonly torpedoDirection: Float64Array
  readonly runWorld: Vector3
  readonly runNdc: Vector3
  readonly runZ: Float64Array
  readonly bombPoint: Vector3
}

export interface BombSightHudDependencies {
  readonly ctx: Pick<SceneContext, 'camera'>
  readonly scratch: BombSightHudScratch
  readonly noseHorizontal: (quaternion: Quaternion, out: Vector3) => Vector3
  readonly projectDistance: number
}

type BombState = 'off' | 'solved' | 'none'
type Terrain = Pick<ReturnType<typeof createTerrain>, 'collisionHeightAt' | 'waterAt'>
interface BombSightPlayer {
  readonly aircraft: {
    readonly state: Pick<Combatant['aircraft']['state'], 'velocity'>
  }
}

/** 把投彈瞄準器與魚雷航跡投影進重複使用的 HUD 幀緩衝 */
export function updateBombSightHud(
  deps: BombSightHudDependencies,
  hudFrame: HudFrame,
  input: Pick<InputState, 'viewMode' | 'bombCapable' | 'bombRelease'>,
  renderPos: Vector3,
  renderQuat: Quaternion,
  player: BombSightPlayer,
  terrain: Terrain,
  playerLoadout: Pick<Loadout, 'kind'> | null,
  bombState: BombState,
  releaseOk: boolean,
  releaseEnv: ReleaseEnvelope | null,
  agl: number,
  bay: Pick<BombBay, 'capacity' | 'load' | 'reloading' | 'timer'>,
): void {
  const { ctx, scratch, noseHorizontal } = deps
  const { probe, bombNdc, noseH, torpedoDirection, runWorld, runNdc, runZ, bombPoint } = scratch

  probe.set(0, 0, -1).applyQuaternion(renderQuat)
    .multiplyScalar(deps.projectDistance).add(renderPos).project(ctx.camera)
  hudFrame.noseX = probe.x
  hudFrame.noseY = probe.y
  hudFrame.noseVisible = probe.z < 1

  hudFrame.bombState = bombState
  hudFrame.bombing = input.viewMode === 'bomb'
  hudFrame.bombCapable = input.bombCapable || input.bombRelease
  hudFrame.ordnance = playerLoadout?.kind ?? null
  hudFrame.releaseOk = releaseOk
  hudFrame.releaseEnv = releaseEnv
  hudFrame.releaseAgl = agl
  hudFrame.bombBayCapacity = bay.capacity
  hudFrame.bombLoad = bay.load
  hudFrame.bombReloading = bay.reloading
  hudFrame.bombReloadLeft = bay.reloading ? bay.timer : 0
  hudFrame.bombVisible = false
  hudFrame.runCount = 0
  if (bombState !== 'solved') return

  bombNdc.copy(bombPoint).project(ctx.camera)
  hudFrame.bombX = bombNdc.x
  hudFrame.bombY = bombNdc.y
  hudFrame.bombVisible = bombNdc.z < 1 &&
    Math.abs(bombNdc.x) <= 1 && Math.abs(bombNdc.y) <= 1

  const onWater = playerLoadout?.kind === 'torpedo' && torpedoEntersWater(
    terrain.collisionHeightAt(bombPoint.x, bombPoint.z),
    terrain.waterAt(bombPoint.x, bombPoint.z),
  )
  if (!onWater) return

  const velocity = player.aircraft.state.velocity
  noseHorizontal(renderQuat, noseH)
  torpedoHeading(velocity.x, velocity.z, noseH.x, noseH.z, torpedoDirection)
  for (let k = 0; k < TORPEDO_RUN_SAMPLES; k++) {
    const distance = runSampleDistance(k)
    runWorld.set(
      bombPoint.x + torpedoDirection[0]! * distance,
      bombPoint.y,
      bombPoint.z + torpedoDirection[1]! * distance,
    )
    runNdc.copy(runWorld).project(ctx.camera)
    hudFrame.runX[k] = runNdc.x
    hudFrame.runY[k] = runNdc.y
    runZ[k] = runNdc.z
  }
  hudFrame.runCount = runFrontCount(runZ, TORPEDO_RUN_SAMPLES)
}
