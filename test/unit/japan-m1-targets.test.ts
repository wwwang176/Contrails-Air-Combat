import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'

/**
 * # 日 M1 的目標優先
 *
 * F4F 先打陸攻、零戰先打 F4F。只驗接線與分支有沒有生效；打起來合不合理是試玩的事。
 */

const DT = 1 / 240
const card = MISSIONS.japan.find((m) => m.id === 'japan-m1') as ReadyMissionCard

describe('日 M1 的目標優先', () => {
  /** 【陸攻在 F4F 眼中比零戰值錢】少了它，F4F 只看威脅與幾何，會去纏會還手的零戰 */
  it('陸攻的座位吃卡片的轟炸機倍率，戰鬥機維持 1', () => {
    const want = card.battle.bomberPriority
    expect(want).toBeGreaterThan(1)
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    let bombers = 0
    for (const c of b.world.combatants) {
      if (c.aircraft.spec.role === 'bomber') {
        bombers++
        expect(b.board.priority[c.index]).toBe(want)
      } else {
        expect(b.board.priority[c.index]).toBe(1)
      }
    }
    expect(bombers).toBe(card.battle.convoyCount)
  })

  /**
   * 【沒掛彈的戰鬥機不插隊打船】對艦分支排在空戰之前，只給掛了彈的那幾架。
   * 戰鬥機進了那一支的話，整隊零戰會丟下 F4F 去掃射巡洋艦
   */
  it('有空中目標的零戰不進對艦分支', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const w = b.world
    // 【照 main.ts 的 wireTerrain 接線】無頭建場不接船與彈艙
    for (const c of w.combatants) {
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      ai.ships = w.ships
      ai.groundTargets = w.groundTargets
      ai.bombBay = c.bombBay
      ai.bombDrag = w.bombDrag
      ai.strikeProfile = TORPEDO_PROFILE
    }
    while (w.time < 20) stepBattle(b, DT)
    let engaged = 0
    for (const c of w.combatants) {
      const ai = c.controller
      if (!(ai instanceof AiController) || !c.alive) continue
      if (c.team !== 'blue' || c.aircraft.spec.role !== 'fighter') continue
      if (ai.target === null) continue
      engaged++
      expect(ai.shipAim.ship, `第 ${c.index} 架`).toBe(-1)
    }
    expect(engaged).toBeGreaterThan(0)
  }, 120_000)
})
