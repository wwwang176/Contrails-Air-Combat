import { AiController } from '../ai/AiController'
import { BOMB_PROFILE } from '../ai/bombRun'
import { TORPEDO_PROFILE } from '../ai/torpedoRun'
import type { TerrainSource } from '../ai/terrainSense'
import type { MissionTuning } from '../battle/mission'
import type { Combatant } from '../world/combatant'
import type { World } from '../world/World'

/**
 * 把地形接給每一架 AI，並清掉上一場的鎖存。
 *
 * 【為什麼是每幀掃一次，而不是在建立控制器的地方各接一次】接的地方不只
 * enterBattle：playerAi 跨場重用、resetBattle 在玩家接手過座位之後會建新的
 * AiController、重生也會。一一去接的話，漏掉哪一條路徑的症狀是「有一架
 * AI 看不見地形」—— 那要等到它撞山才會發現，而且看起來像 AI 有 bug。
 *
 * 【成本】每個座位一次參考比較。地形相同時仍同步掛載與任務限制，
 * 只有地形不同或強制重開時才清鎖存；不建立每幀暫存物件。
 */
export function wireBattleAi(
  world: Pick<World, 'combatants' | 'ships' | 'groundTargets' | 'bombDrag'>,
  tuning: Pick<MissionTuning, 'priorityGroundUnit' | 'airOnly'>,
  player: Pick<Combatant, 'bombBay' | 'loadout'>,
  playerAi: AiController,
  aiTerrain: TerrainSource,
  force = false,
): void {
  for (const c of world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    // 【船跟著地形一起接】兩者的生命週期一模一樣：每一場重建、跨場重用的
    // 控制器要換掉、重生也會建新的。分開兩個迴圈只會多一個會漏掉的地方。
    ctl.ships = world.ships
    ctl.groundTargets = world.groundTargets
    // 重生可能換一顆控制器；任務優先權與地形一樣必須在這個唯一接線點補上。
    ctl.priorityGroundUnit = c.team === 'blue'
      ? tuning.priorityGroundUnit ?? null
      : null
    ctl.airOnly = c.team === 'blue' && tuning.airOnly === true
    // 【投彈那兩格跟著一起接】理由與船完全相同，而且它們也是每一場、每一次
    // 重生都要重接：`bombBay` 隨機種變（換裝、接手僚機），`bombDrag` 必須
    // 與 `World` 是同一個值，否則 AI 算的落點與飛出去的那一顆分家。
    ctl.bombBay = c.bombBay
    ctl.bombDrag = world.bombDrag
    // 【剖面跟著掛載走，不跟著機種】任務卡可以把 G4M 的魚雷複寫成炸彈
    // （`MissionBattle.blueLoadout`），查機種的話那一關會飛雷擊航路去投彈
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
    if (!force && ctl.terrain === aiTerrain) continue
    ctl.terrain = aiTerrain
    ctl.clearTerrainState()
  }
  playerAi.ships = world.ships
  playerAi.groundTargets = world.groundTargets
  // 【代飛與友軍 AI 投彈的方式相同】接的是玩家那一架的彈艙（`playerBay` 就是
  // 它），發動走 `World.releaseBombs` 讀 `command.bombing` —— 與友軍 AI 同一條
  // 路。給 null 的話代飛看不到彈艙，只會掃射。在迴圈之外寫：代飛不在座位上
  // 時迴圈走不到它，而接手僚機會換掉 `player`
  playerAi.bombBay = player.bombBay
  playerAi.strikeProfile = player.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  playerAi.bombDrag = world.bombDrag
  if (force || playerAi.terrain !== aiTerrain) {
    playerAi.terrain = aiTerrain
    playerAi.clearTerrainState()
  }
}
