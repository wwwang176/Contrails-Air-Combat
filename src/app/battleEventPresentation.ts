import { Quaternion, Vector3, type Camera } from 'three'
import type { World, Combatant } from '../world/World'
import { clearImpacts } from '../world/events'
import { clearKills } from '../world/kills'
import { clearDamage, DAMAGE_STRIDE } from '../world/damage'
import { clearBursts } from '../world/flak'
import { pushDamageMark, type DamageMark } from '../hud/damageMarks'
import type { createBattleAudioCues } from '../audio/battleAudioCues'
import type { createBlastPresentation } from '../render/blastPresentation'
import type { createSparks } from '../render/sparks'
import type { createSplashes } from '../render/splash'
import type { createDebris } from '../render/debris'
import type { createTerrain } from '../render/terrain'
import type { Particles } from '../render/particles'
import { lightShipFires, type ShipFires } from '../render/shipFires'
import { lightGroundFires, type GroundFires } from '../render/groundFires'
import { emitSpray, WAKE_SPRAY_COUNT } from '../render/spray'
import { emitFlakBursts } from '../render/flakBursts'
import { emitFlakBlasts, type BlastPools } from '../render/blast'

type EventWorld = Pick<World,
  'time' | 'killEvents' | 'groundKillEvents' | 'balloonKillEvents' | 'bombEvents'
  | 'torpedoEvents' | 'torpedoWakeEvents' | 'burstEvents' | 'hitEvents' | 'splashEvents'
  | 'damageEvents' | 'materialHits' | 'groundTargets' | 'ships'>
type EventTerrain = Pick<ReturnType<typeof createTerrain>, 'heightAt' | 'collisionHeightAt' | 'waterAt'>

export interface BattleEventSinks {
  readonly camera: Pick<Camera, 'position' | 'quaternion'>
  readonly damageMarks: DamageMark[]
  readonly battleAudioCues: Pick<ReturnType<typeof createBattleAudioCues>, 'queueAudioCues'>
  readonly sparks: Pick<ReturnType<typeof createSparks>, 'emit'>
  readonly splashes: Pick<ReturnType<typeof createSplashes>, 'emit'>
  readonly blastPresentation: Pick<ReturnType<typeof createBlastPresentation>,
    'emitKillBlasts' | 'emitGroundKills' | 'emitBalloonPops' | 'emitBombBlasts'
    | 'emitTorpedoBlasts' | 'shakeFlakBursts'>
  readonly debris: Pick<ReturnType<typeof createDebris>, 'emit'>
  readonly debrisColorOf: (index: number) => number
  readonly shipFires: ShipFires
  readonly groundFires: GroundFires
  readonly spray: Pick<Particles, 'emit'>
  readonly flakBursts: Pick<Particles, 'emit'>
  readonly BLAST_POOLS: BlastPools
}

/** 每個物理子步把事件交給音效、HUD 與特效，再依原順序排空來源。接收端與暫存只建一次。 */
export function createBattleEventPresentation({
  camera, damageMarks, battleAudioCues, sparks, splashes, blastPresentation,
  debris, debrisColorOf, shipFires, groundFires, spray, flakBursts, BLAST_POOLS,
}: BattleEventSinks) {
  const DAMAGE_DIR = new Vector3()
  const DAMAGE_VIEW = new Quaternion()

  // 每次傳入當前戰局與地形，重新開戰時不會持有上一場的事件池。
  return function presentBattleEvents(
    world: EventWorld, player: Combatant, terrain: EventTerrain, elapsed: number, godView: boolean,
  ): void {
    // 【排在所有事件清除之前】見 `queueAudioCues`
    battleAudioCues.queueAudioCues(world, player, terrain, godView)
    // 【事件必須在物理子步裡排空】World 在每個
    // 物理步產生事件，而一幀可能跑好幾步。在幀尾才讀的話，最後一步以外
    // 的火花與水柱全部漏掉（M7 spec §2.2）。
    //
    // 相機位置用的是上一幀的 —— 火花的剔除半徑是 800 m，而相機一幀移動
    // 不到 4 m，差異在剔除判斷上看不出來。
    sparks.emit(
      world.hitEvents, camera.position.x, camera.position.y, camera.position.z,
    )
    splashes.emit(world.splashEvents, terrain.heightAt, elapsed)
    clearImpacts(world.hitEvents)
    clearImpacts(world.splashEvents)
    // 【只取玩家自己的】World 不知道誰是玩家，所以它對每一架都推
    // （受擊方向指示器 spec §3.1）。過濾在這裡做。
    //
    // 【相機用的是上一幀的姿態】`rig.update` 排在物理迴圈之後 —— 硬轉
    // 90°/s、一幀 16 ms 下的誤差是 1.4°，對一個 70° 寬的光團看不出來。
    // 為了少一幀而多開一個暫存緩衝，複雜度換不到任何看得見的東西（spec §6.1）。
    const dmg = world.damageEvents
    if (dmg.count > 0) {
      DAMAGE_VIEW.copy(camera.quaternion).invert()
      for (let i = 0; i < dmg.count; i++) {
        const o = i * DAMAGE_STRIDE
        if (dmg.data[o]! !== player.index) continue
        DAMAGE_DIR.set(dmg.data[o + 1]!, dmg.data[o + 2]!, dmg.data[o + 3]!)
          .applyQuaternion(DAMAGE_VIEW)
        pushDamageMark(damageMarks, DAMAGE_DIR.x, DAMAGE_DIR.y, DAMAGE_DIR.z)
      }
    }
    clearDamage(dmg)
    // 【火球與零件走事件】它們是世界錨定的一次性效果，用事件裡的子步位置
    // ——與火花同一個理由（M7 spec §2.2）。**玩家自己被擊墜時也要有**，
    // 而那正是「每幀比對 alive」做不到的事（M8 spec §2.1）
    blastPresentation.emitKillBlasts(world.killEvents, world.time, terrain)
    blastPresentation.emitGroundKills(world.groundKillEvents, world.time, world.groundTargets)
    blastPresentation.emitBalloonPops(world.balloonKillEvents, world.time)
    debris.emit(world.killEvents, debrisColorOf)
    clearKills(world.killEvents)
    // 【炸彈的落點也走事件】`World` 只判水陸並推一筆，配方由這裡選
    blastPresentation.emitBombBlasts(world.bombEvents, world.time, terrain, elapsed)
    // 【起火要排在排空之前】兩份事件都在這個物理子步裡就被清掉了；等到
    // 幀率區段才讀的話它們已經是空的，火點永遠是 0 而且不報錯
    lightShipFires(shipFires, world.bombEvents, world.ships)
    // 【落在陸地的炸彈也留火】水上的、打中船的、打中建築的各有各的去處
    lightGroundFires(groundFires, world.bombEvents)
    clearImpacts(world.bombEvents)
    // 【魚雷的兩條管道】引爆走水冠、入水與航跡走水花。兩者都在物理子步裡
    // 消費 —— 一枚魚雷跑 91 秒會推出 250 筆航跡，累到幀尾會滿
    blastPresentation.emitTorpedoBlasts(world.torpedoEvents, world.time, terrain, elapsed)
    lightShipFires(shipFires, world.torpedoEvents, world.ships)
    clearImpacts(world.torpedoEvents)
    emitSpray(spray, world.torpedoWakeEvents, WAKE_SPRAY_COUNT)
    clearImpacts(world.torpedoWakeEvents)
    // 【黑雲與火花同一個約定】`World` 只推事件，排空是呼叫端的責任。
    // 傷害那一半 `World` 自己在物理步裡就吃掉了（見 `stepBursts`）。
    emitFlakBursts(flakBursts, world.burstEvents)
    // 爆點的閃光與小火球走爆炸那一組池；黑雲留在上面那個池
    emitFlakBlasts(BLAST_POOLS, world.burstEvents)
    blastPresentation.shakeFlakBursts(world.burstEvents)
    clearBursts(world.burstEvents)
  }
}
