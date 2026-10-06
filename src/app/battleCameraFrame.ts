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
  readonly godInput: GodCameraInput
}

export interface BattleCameraFrameDependencies {
  readonly ctx: Pick<SceneContext, 'camera'>
  readonly rig: Pick<CameraRig, 'update'>
  readonly godCam: GodCameraState
  readonly godTarget: Vector3
  readonly godBlend: CameraBlend
  readonly cameraShake: CameraShake
  readonly scratch: BattleCameraFrameScratch
}

type Terrain = Pick<ReturnType<typeof createTerrain>, 'collisionHeightAt'>

/**
 * 推進一個戰鬥渲染幀的鏡頭與投彈瞄準器。
 *
 * 暫存值由呼叫端提供、跨幀重用。鏡頭這一段因此能獨立出來，又不會每幀
 * 配置記憶體。
 */
export function updateBattleCameraFrame(
  deps: BattleCameraFrameDependencies,
  frameSeconds: number,
  worldSeconds: number,
  input: InputState,
  world: Pick<World, 'bombDrag' | 'groundAt'>,
  terrain: Terrain,
  loopStepSeconds: number,
  player: Pick<Combatant, 'aircraft'>,
  playerLoadout: Loadout | null,
  renderPos: Vector3,
  renderQuat: Quaternion,
  bombPoint: Vector3 | null,
  output: BattleCameraFrameOutput,
): void {
  const {
    ctx, rig, godCam, godTarget, godBlend, cameraShake,
    scratch: { bombImpact, bombStart, bombEye, bombPoint: impactPoint, godInput },
  } = deps
  const aircraft = player.aircraft

  // 【彈艙不在這裡推進】玩家的彈艙與 AI 一樣只由 `World.releaseBombs` 在物理步
  // 推進與投放；扣扳機是 `PlayerController` 寫進 `command.bombing`。這裡再推進
  // 一次的話，玩家的回補與連投間隔會快一倍。
  //
  // 【包絡每幀都算】它是準星的顏色，而準星在一般飛行時也畫
  const att = output.attitude
  attitudeFromOrientation(renderQuat, att)

  // 【包絡與 agl 只解一次】HUD 的投放閘門與高度弧讀的必須是**這兩個值**，
  // 不是各自再查一次 —— 分家的症狀是「錶上綠燈而扳機沒有反應」，不拋例外
  // 也沒有訊息
  const agl = renderPos.y - terrain.collisionHeightAt(renderPos.x, renderPos.z)
  const releaseEnv = playerLoadout !== null ? envelopeFor(playerLoadout.kind) : null
  const releaseOk = releaseEnv !== null && canRelease(
    releaseEnv, att.roll, att.pitch, agl, aircraft.diag.aero.tas,
  )
  output.agl = agl
  output.releaseEnv = releaseEnv
  output.releaseOk = releaseOk

  if (bombPoint !== null) bombEye.copy(bombPoint).applyQuaternion(renderQuat).add(renderPos)
  // 【掛彈的戰鬥機從質心投】沒有瞄具眼點；`World.releaseBombs` 本來就從質心放
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
    // 【FOV 固定】隨速度變化的那一份吃的是飛機的 TAS，在這裡沒有意義
    if (Math.abs(ctx.camera.fov - DEFAULT_CAMERA_OPTIONS.fovBase) > 0.01) {
      ctx.camera.fov = DEFAULT_CAMERA_OPTIONS.fovBase
      ctx.camera.updateProjectionMatrix()
    }
  } else {
    // 【落點要在 rig.update 之前解】投彈模式下相機的視線就是指向它
    //
    // 【不看視角】落點是飛行狀態的函數，算得出來一般飛行也標得出來（HUD 的
    // `bombsight` 在兩種模式都畫，只差顏色）。上帝視角則整段跳過 —— 那裡連
    // 落點圈都不畫。
    if (bombPoint !== null || input.bombRelease) {
      bombState = 'none'
      bombStart.x = bombEye.x; bombStart.y = bombEye.y; bombStart.z = bombEye.z
      const v = aircraft.state.velocity
      bombStart.vx = v.x; bombStart.vy = v.y; bombStart.vz = v.z
      // 【dt 用物理步長 `loopStepSeconds` 而不是 `frameSeconds`】預測必須與
      // 空中的炸彈同一個步長，那條護欄的整個重點就在這裡
      if (solveImpact(bombStart, world.bombDrag, world.groundAt, loopStepSeconds, bombImpact)) {
        impactPoint.set(bombImpact.x, bombImpact.y, bombImpact.z)
        bombState = 'solved'
        // 【只有投彈模式把落點交給相機】一般飛行時鏡頭跟的是瞄準點
        if (input.viewMode === 'bomb') bombTarget = impactPoint
      }
    }
    // 相機看的是**瞄準方向**而不是機首方向：準星釘在畫面中央，跟不上的是飛機
    rig.update(
      ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
      input.viewMode, input.lookYaw, input.lookPitch, worldSeconds, bombTarget,
    )
  }
  // 【排在兩個分支之後】上面算出來的是這一幀的目的姿態，過渡把它往按 G
  // 那一刻的姿態拉回一部分；過渡結束後這一行什麼都不做
  applyBlend(godBlend, ctx.camera, worldSeconds)

  // 【震動疊在最後】上面每一條分支都是從頭寫相機姿態的，排在它們之前會被
  // 整個蓋掉 —— 而畫面上只是「沒有震動」。也因為它們每幀重寫，這個偏移
  // 不會累積回相機
  // 【超速的持續搖晃】每幀由速度直接算、不衰減，與爆炸取最大值。上帝視角時
  // 鏡頭不在飛機上，不搖
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
}

export function createBattleCameraFrameScratch(): BattleCameraFrameScratch {
  return {
    bombImpact: { x: 0, y: 0, z: 0, seconds: 0, speed: 0 },
    bombStart: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    bombEye: new Vector3(),
    bombPoint: new Vector3(),
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
