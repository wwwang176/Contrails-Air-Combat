import { Quaternion, Vector3 } from 'three'
import type { SceneContext } from '../render/scene'
import type { HudFrame } from '../hud/types'
import type { InputState } from '../input/InputState'
import type { Combatant } from '../world/combatant'
import type { Battle } from '../battle/battleState'
import type { AiController } from '../ai/AiController'
import type { CameraShake } from '../camera/cameraShake'
import type { GodCameraState } from '../camera/godCamera'
import type { TouchControls } from '../input/touch'
import type { ArenaState } from '../world/arena'
import { indicatedAirspeed } from '../core/airspeed'
import { headingFromOrientation } from '../core/attitude'
import { hudShakeAngle, hudShakeShiftX, hudShakeShiftY } from '../camera/cameraShake'
import { aircraftName } from '../i18n/names'
import { extendReason } from '../ai/rules'
import { aliveCount } from '../battle/objectiveQueries'
import { playerFlight } from '../battle/battleRuntime'

export interface BattleFlightHudDependencies {
  readonly ctx: Pick<SceneContext, 'camera'>
  readonly probe: Vector3
  readonly cameraShake: CameraShake
  readonly godCam: Pick<GodCameraState, 'yaw' | 'position'>
  readonly playerAi: Pick<AiController, 'intent' | 'mode' | 'hudPhase' | 'hudOverride' | 'rules'>
  readonly touch: Pick<TouchControls, 'visible'>
  readonly arena: Pick<ArenaState, 'outside' | 'remaining'>
  readonly projectDistance: number
}

type Aircraft = Combatant['aircraft']

/** Writes flight telemetry and control state into the already allocated HUD frame. */
export function updateBattleFlightHud(
  deps: BattleFlightHudDependencies,
  hudFrame: HudFrame,
  input: Pick<InputState, 'aimWorld' | 'godView' | 'playerAi'>,
  battle: Battle,
  player: Combatant,
  aircraft: Aircraft,
  renderPos: Vector3,
  renderQuat: Quaternion,
  dying: boolean,
  attitude: { pitch: number; roll: number },
  alphaCrit: number,
): void {
  const { ctx, probe, cameraShake, godCam, playerAi, touch, arena, projectDistance } = deps

  probe.copy(input.aimWorld)
    .multiplyScalar(projectDistance).add(renderPos).project(ctx.camera)
  hudFrame.aimX = probe.x * ctx.camera.aspect
  hudFrame.aimY = probe.y
  hudFrame.aimVisible = probe.z < 1

  hudFrame.tas = aircraft.diag.aero.tas
  hudFrame.ias = indicatedAirspeed(aircraft.diag.aero.tas, aircraft.diag.air.sigma)
  hudFrame.vneRatio = hudFrame.ias / aircraft.spec.limits.vne
  hudFrame.mach = aircraft.diag.aero.mach
  hudFrame.altitude = renderPos.y
  hudFrame.verticalSpeed = aircraft.state.velocity.y
  hudFrame.heading = input.godView ? godCam.yaw : headingFromOrientation(renderQuat)
  hudFrame.roll = attitude.roll
  hudFrame.pitch = attitude.pitch
  hudFrame.loadFactor = dying ? 1 : aircraft.diag.loadFactor
  hudFrame.alpha = aircraft.diag.aero.alpha
  hudFrame.alphaCrit = alphaCrit
  hudFrame.ps = aircraft.specificExcessPowerActual
  hudFrame.es = aircraft.specificEnergy
  hudFrame.throttle = aircraft.controls.throttle
  hudFrame.powerW = aircraft.diag.powerW
  hudFrame.arenaOutside = arena.outside
  hudFrame.arenaRemaining = arena.remaining
  hudFrame.worldX = input.godView ? godCam.position.x : renderPos.x
  hudFrame.worldZ = input.godView ? godCam.position.z : renderPos.z
  hudFrame.aircraftName = aircraftName(aircraft.spec)
  hudFrame.hp = player.hp
  hudFrame.hpMax = player.aircraft.spec.hp
  hudFrame.aiFlying = input.playerAi
  if (input.playerAi) {
    hudFrame.aiIntent = playerAi.intent
    hudFrame.aiMode = playerAi.mode
    hudFrame.aiPhase = playerAi.hudPhase
    hudFrame.aiOverride = playerAi.hudOverride
    hudFrame.aiExtendWhy = playerAi.intent === 'extend'
      ? extendReason(playerAi.rules) : ''
  }
  hudFrame.godView = input.godView
  hudFrame.touch = touch.visible
  hudFrame.shakeAngle = hudShakeAngle(cameraShake)
  hudFrame.shakeX = hudShakeShiftX(cameraShake)
  hudFrame.shakeY = hudShakeShiftY(cameraShake)
  hudFrame.controlAuthority = aircraft.diag.controlAuthority
  hudFrame.blueAlive = aliveCount(battle.blue)
  hudFrame.redAlive = aliveCount(battle.red)
  const flight = playerFlight(battle)
  hudFrame.flightAlive = flight?.count ?? 0
  hudFrame.flightSize = flight?.roster.length ?? 0
}
