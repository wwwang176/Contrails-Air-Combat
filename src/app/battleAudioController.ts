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
   * 自機的內插位置；導覽（含滑回）、上帝視角與陣亡後是鏡頭。朝向一律是鏡頭。
   */
  readonly ear: Vector3
  readonly renderPositions: readonly Vector3[]
}

/** 協調每幀音訊的聽音模式、混音與開頭收尾。 */
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
    cameraView: boolean,
    arenaWarning: boolean,
    introGain = 1,
  ): void {
    const me = player
    const flying = me.alive && !cameraView
    // 【操作時耳朵在機身上】第三人稱鏡頭繞著機身轉，跟著它的話轉頭會改變
    // 距離、讓聽者有速度 —— 都卜勒把附近的引擎聲拉高拉低。要排在 `beginFrame`
    // 之前：方位與距離在那裡讀
    ear.copy(flying ? renderPositions[me.index]! : cameraPosition)
    audio.beginFrame(introGain)
    // 【導覽與上帝視角的鏡頭不參與都卜勒】切鏡與滑回不應拉動音高。
    // 鏡頭 300 m/s 掠過時音高被拉到近兩倍，Shift 的
    // 1,200 m/s 又超過瞬移門檻、一下歸零一下恢復。只留飛機自己的移動造成的變調。
    // 用 `reset` 而不是不更新：不更新的話切進來前的速度一直留著；回座艙那一幀耳朵
    // 瞬移回機身，從零重新量才不會跳
    if (cameraView) listenerMotion.reset()
    else listenerMotion.update(ear, worldSeconds)
    battleAudioCues.playFrame(world, player, elapsed, flying)
    cannonAudio.playCannons(world, elapsed)
    aircraftLoopAudio.update(
      world.combatants, renderPositions, me, elapsed, flying,
      battleAudioCues.ownTurretVolley,
    )
    audio.endFrame()
    flightAudio.update(world, me, elapsed, worldSeconds, arenaWarning, cameraView, introGain)
  }

  return { reset, setPlayer, update }
}
