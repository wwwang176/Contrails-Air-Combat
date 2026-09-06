import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Battle } from '../../src/battle/setup'
import type { ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'

/**
 * # AI 投彈的端到端驗收
 *
 * 單元測試守的是「解算對不對」。這一支守的是**它在真正的關卡裡跑得到** ——
 * 而那正是 Codex 審查 C2 抓到的那件事：對艦分支本來包在「沒有空中目標」
 * 裡、站位又排在它前面，所以五架 AI 一式陸攻的 `shipAim.ship` 全是 −1。
 * 解算再正確也沒有人呼叫它。
 *
 * **這種缺陷不會有任何錯誤訊息**，只會表現成「AI 好像不太會炸船」。
 */

const card = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard

/** 玩家席位由它佔著不動 —— 這一支驗的是 AI，不是玩家。 */
const IDLE: Controller = { update() {} }

const DT = 1 / 240
const SEED = 1234

/**
 * 開一場 `japan-m4` 並接好線。
 *
 * **接線與 `main.ts` 的 `wireTerrain` 逐字相同** —— 漏掉 `bombDrag` 的話
 * AI 算的落點與飛出去的那一顆會分家，而症狀只是「投不準」。
 */
function mission(): Battle {
  const b = createBattle(IDLE, missionConfigFrom(card), SEED)
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.bombBay = c.bombBay.capacity
    ctl.bombDrag = b.world.bombDrag
  }
  return b
}

function run(b: Battle, seconds: number): void {
  for (let i = 0; i < seconds * 240; i++) stepBattle(b, DT)
}

describe('japan-m4 的 AI 一式陸攻', () => {
  it('鎖定艦隊、投得出彈、打得到船', () => {
    const b = mission()
    const hp0 = b.world.ships.map((s) => s.hp)

    // 一秒後看有幾架已經鎖上艦隊。**修好 C2 之前這裡是 0**
    run(b, 1)
    let acquired = 0
    for (const c of b.world.combatants) {
      const ctl = c.controller
      if (ctl instanceof AiController && ctl.bombBay > 0 && ctl.shipAim.ship >= 0) acquired++
    }
    expect(acquired).toBeGreaterThan(0)

    run(b, 89)
    expect(b.world.bombs.dropped).toBeGreaterThan(0)

    const hurt = b.world.ships.filter((s, i) => s.hp < hp0[i]!).length
    console.log(
      `鎖定 ${acquired} 架、投彈 ${b.world.bombs.dropped} 枚、扣到血的船 ${hurt} 艘`,
    )
    console.log(`船血：${b.world.ships.map((s) => Math.round(s.hp)).join(' ')}`)
    expect(hurt).toBeGreaterThan(0)
  })

  /**
   * 【決定性】spec §7.1。投彈的散佈走 `spreadPair(bombs.dropped)`，是累計
   * 序號的雜湊而不是 `Math.random()`；釋放的判準是純函數。所以同一個種子
   * 跑兩次必須逐位元相同。
   *
   * 【比船的血量而不是只比枚數】枚數相同但落點不同的話，枚數那一條看不
   * 出來 —— 而落點才是這件事的內容。
   */
  it('同一個種子跑兩次逐位元相同', () => {
    const a = mission()
    const b = mission()
    run(a, 60)
    run(b, 60)
    expect(a.world.bombs.dropped).toBe(b.world.bombs.dropped)
    expect(a.world.ships.map((s) => s.hp)).toEqual(b.world.ships.map((s) => s.hp))
    expect(a.world.ships.map((s) => s.alive)).toEqual(b.world.ships.map((s) => s.alive))
  })
})
