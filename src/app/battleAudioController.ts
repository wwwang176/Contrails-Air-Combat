import type { Vector3 } from 'three'
import type { Combatant } from '../world/combatant'
import type { World } from '../world/World'
import type { AudioEngine } from '../audio/engine'
import { createAircraftLoopAudio } from '../audio/aircraftLoopAudio'
import { createBattleAudioCues } from '../audio/battleAudioCues'
import { createCannonAudio } from '../audio/cannonAudio'
import { createFlightAudio } from '../audio/flightAudio'
import { createListenerMotion } from '../audio/listenerMotion'

type AircraftLoopAudio = ReturnType<typeof createAircraftLoopAudio>
type BattleAudioCues = ReturnType<typeof createBattleAudioCues>
type CannonAudio = ReturnType<typeof createCannonAudio>
type FlightAudio = ReturnType<typeof createFlightAudio>
type ListenerMotion = ReturnType<typeof createListenerMotion>

/** 音效協調只讀聲源與彈藥，不需要世界的模擬或生命週期方法。 */
type BattleAudioWorld = Pick<World, 'combatants' | 'ships' | 'groundTargets' | 'projectiles' | 'bombs'>

export interface BattleAudioControllerDeps {
  readonly audio: Pick<AudioEngine, 'beginFrame' | 'endFrame' | 'setTimeScale'>
  readonly cannonAudio: CannonAudio
  readonly listenerMotion: ListenerMotion
  readonly flightAudio: FlightAudio
  readonly aircraftLoopAudio: AircraftLoopAudio
  readonly battleAudioCues: BattleAudioCues
  readonly cameraPosition: Vector3
  readonly renderPositions: readonly Vector3[]
}

/** 協調每幀音訊的開頭與收尾，本身不決定任何音效規則 */
export function createBattleAudioController(deps: BattleAudioControllerDeps) {
  const {
    audio, cannonAudio, listenerMotion, flightAudio, aircraftLoopAudio,
    battleAudioCues, cameraPosition, renderPositions,
  } = deps

  function reset(): void {
    audio.setTimeScale(1)
    cannonAudio.reset()
    listenerMotion.reset()
    flightAudio.reset()
    aircraftLoopAudio.reset()
    battleAudioCues.reset()
  }

  function setPlayer(player: Combatant): void {
    const me = player
    battleAudioCues.rebuildVolleyGroups(me)
  }

  function update(
    world: BattleAudioWorld,
    player: Combatant,
    elapsed: number,
    worldSeconds: number,
    godView: boolean,
    arenaWarning: boolean,
  ): void {
    const me = player
    const flying = me.alive && !godView
    audio.beginFrame()
    listenerMotion.update(cameraPosition, worldSeconds)
    battleAudioCues.playFrame(world, player, elapsed, flying)
    cannonAudio.playCannons(world, elapsed)
    aircraftLoopAudio.update(
      world.combatants, renderPositions, me, elapsed, flying,
      battleAudioCues.ownTurretVolley,
    )
    audio.endFrame()
    flightAudio.update(world, me, elapsed, worldSeconds, arenaWarning)
  }

  return { reset, setPlayer, update }
}
