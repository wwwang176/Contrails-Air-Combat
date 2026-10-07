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
  /**
   * 聽者的位置。音訊引擎與各音效模組持有**同一個物件**，這裡每幀寫入：自己在飛時是
   * 自機的內插位置，上帝視角與陣亡後是鏡頭。朝向一律是鏡頭 —— 見 `createAudioEngine`
   */
  readonly ear: Vector3
  readonly renderPositions: readonly Vector3[]
}

/** 協調每幀音訊的開頭與收尾，本身不決定任何音效規則 */
export function createBattleAudioController(deps: BattleAudioControllerDeps) {
  const {
    audio, cannonAudio, listenerMotion, flightAudio, aircraftLoopAudio,
    battleAudioCues, cameraPosition, ear, renderPositions,
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
    // 【耳朵在機身上，不在鏡頭上】第三人稱鏡頭繞著機身轉，跟著它的話轉頭會改變
    // 距離、讓聽者有速度 —— 都卜勒把附近的引擎聲拉高拉低。要排在 `beginFrame`
    // 之前：方位與距離在那裡讀
    ear.copy(flying ? renderPositions[me.index]! : cameraPosition)
    audio.beginFrame()
    // 【上帝視角時聽者不參與都卜勒】鏡頭 300 m/s 掠過時音高被拉到近兩倍，Shift 的
    // 1,200 m/s 又超過瞬移門檻、一下歸零一下恢復。只留飛機自己的移動造成的變調。
    // 用 `reset` 而不是不更新：不更新的話切進來前的速度一直留著；回座艙那一幀耳朵
    // 瞬移回機身，從零重新量才不會跳
    if (godView) listenerMotion.reset()
    else listenerMotion.update(ear, worldSeconds)
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
