import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'

/**
 * # 掛彈的 AI 戰鬥機會對地投彈
 *
 * 守的是「會不會投」：日 M2 的疾風僚機掛著彈、天上沒有敵機時，對著車隊一段
 * 時間之內要投出炸彈，而且自己沒被自己的彈炸下來。投得準不準由試玩判斷。
 */

const DT = 1 / 240

describe('AI 戰鬥機對地投彈', () => {
  it('日 M2：沒有敵機時，疾風僚機 90 秒內對車隊投出炸彈，投彈的那一架還活著', () => {
    const card = MISSIONS.japan.find((m) => m.id === 'japan-m2') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const w = b.world
    // 【照 main.ts 的 wireTerrain 接線】無頭建場不接彈艙與地面目標
    for (const c of w.combatants) {
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      ai.ships = w.ships
      ai.groundTargets = w.groundTargets
      ai.bombBay = c.bombBay
      ai.bombDrag = w.bombDrag
      ai.strikeProfile = BOMB_PROFILE
    }
    // 【拿掉敵機】要驗的是對地，不是空戰
    for (const c of w.combatants) {
      if (c.team === 'red') { c.alive = false; c.hp = 0 }
    }
    const wingmen = w.combatants.filter((c) => c.team === 'blue' && c.controller instanceof AiController)
    expect(wingmen.length).toBeGreaterThan(0)
    const full = wingmen.map((c) => c.bombBay.load)
    let dropped: number[] = []
    while (w.time < 90) {
      stepBattle(b, DT)
      dropped = wingmen.map((c, i) => full[i]! - c.bombBay.load)
      if (dropped.some((n) => n > 0)) break
    }
    const who = dropped.findIndex((n) => n > 0)
    expect(who, `第 ${w.time.toFixed(1)} 秒仍沒有人投彈`).toBeGreaterThanOrEqual(0)
    // 投出去之後再飛幾秒，讓炸彈落地
    const t0 = w.time
    while (w.time < t0 + 8) stepBattle(b, DT)
    expect(wingmen[who]!.alive).toBe(true)
  }, 300_000)

  it('AI 代飛：玩家那一架交給 AI 飛時也會對車隊投彈', () => {
    const card = MISSIONS.japan.find((m) => m.id === 'japan-m2') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const w = b.world
    const player = w.combatants[0]!
    expect(player.team).toBe('blue')
    // 【照 main.ts 接代飛】控制器換成 AI，板子、自身索引、優先目標、彈艙都接上
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = player.index
    ai.priorityGroundUnit = b.cfg.tuning.priorityGroundUnit ?? null
    ai.ships = w.ships
    ai.groundTargets = w.groundTargets
    ai.bombBay = player.bombBay
    ai.bombDrag = w.bombDrag
    ai.strikeProfile = BOMB_PROFILE
    player.controller = ai
    // 【只留玩家那一架】僚機與敵機都拿掉，要驗的是代飛自己
    for (const c of w.combatants) {
      if (c !== player) { c.alive = false; c.hp = 0 }
    }
    const full = player.bombBay.load
    expect(full).toBeGreaterThan(0)
    while (w.time < 90 && player.bombBay.load === full) stepBattle(b, DT)
    expect(player.bombBay.load, `第 ${w.time.toFixed(1)} 秒仍沒有投彈`).toBeLessThan(full)
  }, 300_000)
})
