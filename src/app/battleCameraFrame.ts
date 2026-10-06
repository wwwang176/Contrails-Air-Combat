import { Quaternion, Vector3 } from 'three'
import type { SceneContext } from '../render/scene'
import { indicatedAirspeed } from '../core/airspeed'
import { overspeedShake } from '../core/overspeedFeedback'
import { attitudeFromOrientation } from '../core/attitude'
import { CameraRig, DEFAULT_CAMERA_OPTIONS } from '../camera/CameraRig'
import { applyBlend, type CameraBlend } from '../camera/cameraBlend'
import { applyCameraShake, stepCameraShake, type CameraShake } from '../camera/cameraShake'
import {
  godCameraTarget, stepGodCamera,
  type GodCameraInput, type GodCameraState,
} from '../camera/godCamera'
import type { InputState } from '../input/InputState'
import type { Combatant } from '../world/combatant'
import type { World } from '../world/World'
import { solveImpact, type BombState, type Impact } from '../world/bomb'
import type { Loadout } from '../weapons/stores'
import { canRelease, envelopeFor } from '../weapons/releaseEnvelope'
import type { createTerrain } from '../render/terrain'

export interface BattleCameraFrameOutput {
  readonly attitude: { pitch: number; roll: number }
  agl: number
  alphaCrit: number
  bombState: 'off' | 'solved' | 'none'
  bombTarget: Vector3 | null
  releaseOk: boolean
  releaseEnv: ReturnType<typeof envelopeFor> | null
}

export interface BattleCameraFrameScratch {
  readonly bombImpact: Impact
  readonly bombStart: BombState
  readonly bombEye: Vector3
  readonly bombPoint: Vector3
  readonly attitude: { pitch: number; roll: number }
  readonly godInput: GodCameraInput
}

export interface BattleCameraFrameDependencies {
  readonly ctx: SceneContext
  readonly rig: CameraRig
  readonly godCam: GodCameraState
  readonly godTarget: Vector3
  readonly godBlend: CameraBlend
  readonly cameraShake: CameraShake
  readonly scratch: BattleCameraFrameScratch
}

type Terrain = ReturnType<typeof createTerrain>

/**
 * Advances the camera and bomb sight for one rendered battle frame.
 *
 * The scratch values are supplied by the caller and reused across frames. This
 * keeps the camera boundary independent without adding per-frame allocations.
 */
export function updateBattleCameraFrame(
  deps: BattleCameraFrameDependencies,
  frameSeconds: number,
  worldSeconds: number,
  input: InputState,
  world: World,
  terrain: Terrain,
  loopStepSeconds: number,
  player: Combatant,
  playerLoadout: Loadout | null,
  renderPos: Vector3,
  renderQuat: Quaternion,
  bombPoint: Vector3 | null,
  output: BattleCameraFrameOutput,
): void {
  const {
    ctx, rig, godCam, godTarget, godBlend, cameraShake,
    scratch: { bombImpact, bombStart, bombEye, bombPoint: impactPoint, attitude: att, godInput },
  } = deps
  const aircraft = player.aircraft

  attitudeFromOrientation(renderQuat, att)
  const attitude = output.attitude
  attitude.pitch = att.pitch
  attitude.roll = att.roll

  // The HUD and the release gate share these values so they cannot drift apart.
  const agl = renderPos.y - terrain.collisionHeightAt(renderPos.x, renderPos.z)
  const releaseEnv = playerLoadout !== null ? envelopeFor(playerLoadout.kind) : null
  const releaseOk = releaseEnv !== null && canRelease(
    releaseEnv, att.roll, att.pitch, agl, aircraft.diag.aero.tas,
  )
  output.agl = agl
  output.releaseEnv = releaseEnv
  output.releaseOk = releaseOk

  if (bombPoint !== null) bombEye.copy(bombPoint).applyQuaternion(renderQuat).add(renderPos)
  else if (input.bombRelease) bombEye.copy(renderPos)

  let bombTarget: Vector3 | null = null
  let bombState: 'off' | 'solved' | 'none' = 'off'
  if (input.godView) {
    godInput.forward = input.godMove.forward
    godInput.back = input.godMove.back
    godInput.left = input.godMove.left
    godInput.right = input.godMove.right
    godInput.up = input.godMove.up
    godInput.down = input.godMove.down
    godInput.boost = input.godMove.boost
    stepGodCamera(godCam, godInput, frameSeconds)
    ctx.camera.position.copy(godCam.position)
    ctx.camera.up.set(0, 1, 0)
    ctx.camera.lookAt(godCameraTarget(godCam, godTarget))
    if (Math.abs(ctx.camera.fov - DEFAULT_CAMERA_OPTIONS.fovBase) > 0.01) {
      ctx.camera.fov = DEFAULT_CAMERA_OPTIONS.fovBase
      ctx.camera.updateProjectionMatrix()
    }
  } else {
    if (bombPoint !== null || input.bombRelease) {
      bombState = 'none'
      bombStart.x = bombEye.x; bombStart.y = bombEye.y; bombStart.z = bombEye.z
      const v = aircraft.state.velocity
      bombStart.vx = v.x; bombStart.vy = v.y; bombStart.vz = v.z
      if (solveImpact(bombStart, world.bombDrag, world.groundAt, loopStepSeconds, bombImpact)) {
        impactPoint.set(bombImpact.x, bombImpact.y, bombImpact.z)
        bombState = 'solved'
        if (input.viewMode === 'bomb') bombTarget = impactPoint
      }
    }
    rig.update(
      ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
      input.viewMode, input.lookYaw, input.lookPitch, worldSeconds, bombTarget,
    )
  }
  applyBlend(godBlend, ctx.camera, worldSeconds)

  cameraShake.sustained = input.godView ? 0 : overspeedShake(
    indicatedAirspeed(aircraft.diag.aero.tas, aircraft.diag.air.sigma)
      / aircraft.spec.limits.vne,
  )
  stepCameraShake(cameraShake, worldSeconds)
  applyCameraShake(cameraShake, ctx.camera)

  output.bombState = bombState
  output.bombTarget = bombTarget
  output.alphaCrit = aircraft.spec.lift.alphaCrit +
    (aircraft.diag.slatsDeployed ? aircraft.spec.lift.slatAlphaBonus : 0)
  output.attitude.pitch = att.pitch
  output.attitude.roll = att.roll
}

export function createBattleCameraFrameScratch(): BattleCameraFrameScratch {
  return {
    bombImpact: { x: 0, y: 0, z: 0, seconds: 0, speed: 0 },
    bombStart: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    bombEye: new Vector3(),
    bombPoint: new Vector3(),
    attitude: { pitch: 0, roll: 0 },
    godInput: {
      forward: false, back: false, left: false, right: false,
      up: false, down: false, boost: false, lookX: 0, lookY: 0,
    },
  }
}

export function createBattleCameraFrameOutput(): BattleCameraFrameOutput {
  return {
    attitude: { pitch: 0, roll: 0 },
    agl: 0,
    alphaCrit: 0,
    bombState: 'off',
    bombTarget: null,
    releaseOk: false,
    releaseEnv: null,
  }
}
