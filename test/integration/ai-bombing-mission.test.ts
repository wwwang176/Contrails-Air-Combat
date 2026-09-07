import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Battle } from '../../src/battle/setup'
import type { ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'

/**
 * # AI 投彈的端到端驗收
 *
 * 單元測試守的是「解算對不對」。這一支守的是**它在真正的關卡裡跑得到** ——
 * 而那件事是：對艦分支本來包在「沒有空中目標」
 * 裡、站位又排在它前面，所以五架 AI 一式陸攻的 `shipAim.ship` 全是 −1。
 * 解算再正確也沒有人呼叫它。
 *
 * **這種缺陷不會有任何錯誤訊息**，只會表現成「AI 好像不太會炸船」。
 */

const card = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard
const zeroCard = MISSIONS.allies.find((c) => c.id === 'allies-m4') as ReadyMissionCard

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
function mission(which: ReadyMissionCard = card): Battle {
  const b = createBattle(IDLE, missionConfigFrom(which), SEED)
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.bombBay = c.bombBay
    ctl.bombDrag = b.world.bombDrag
    // 【剖面也要接】`main.ts` 依掛載選剖面。漏掉這一格的話掛雷的機種會用
    // 轟炸剖面去飛雷擊 —— 而症狀又是「AI 好像不太會投」，沒有錯誤訊息
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  }
  return b
}

/** 這一關投的是什麼。`japan-m4` 掛的是魚雷（`weapons/stores.ts`） */
function dropped(b: Battle): number {
  return b.world.bombs.dropped + b.world.torpedoes.dropped
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
      if (ctl instanceof AiController && ctl.bombBay !== null && ctl.shipAim.ship >= 0) acquired++
    }
    expect(acquired).toBeGreaterThan(0)

    // 【90 秒】雷擊的循環比轟炸長：進場要先降到航路高度、裝填 45 秒。
    // 十一架裡總有人投得出去 —— 一架都沒有就是這條路又斷了
    run(b, 89)
    expect(dropped(b)).toBeGreaterThan(0)

    const hurt = b.world.ships.filter((s, i) => s.hp < hp0[i]!).length
    console.log(
      `鎖定 ${acquired} 架、投放 ${dropped(b)} 枚、扣到血的船 ${hurt} 艘`,
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
    expect(dropped(a)).toBe(dropped(b))
    expect(a.world.ships.map((s) => s.hp)).toEqual(b.world.ships.map((s) => s.hp))
    expect(a.world.ships.map((s) => s.alive)).toEqual(b.world.ships.map((s) => s.alive))
  })
})

/**
 * 【為什麼要第二關】`japan-m4` 掛的是魚雷，走的是另一份剖面 —— 轟炸那一份
 * 在真正的關卡裡從來沒有被端到端驗過。
 *
 * 這一關的艦隊**迎著**進場方向開（TF58 航向 −Z，零戰從 −Z 來），而炸彈的
 * 落彈時間長達二十秒 —— 投彈窗因此被推到鎖定距離之外，八架零戰四分鐘一枚
 * 都投不出來，而畫面上只會看到「零戰飛過艦隊上空就走了」。
 *
 * 【它擋的是整條路通不通，不是單一參數】投彈窗的位置由兩個量決定（船沿
 * 視線靠近的量、`RUN_SETTLE` 的餘裕），而這一關兩者的量級相近：只錯一個
 * 的話零戰照樣投得出來（實測 30 枚）。單一參數由單元測試的「鎖定距離涵蓋
 * 投彈窗」守，那一條三種變異全紅。
 */
describe('allies-m4 的 AI 零戰', () => {
  it('投得出彈、打得到船', () => {
    const b = mission(zeroCard)
    const hp0 = b.world.ships.map((s) => s.hp)

    // 【60 秒】零戰從 5 km 外以 143 m/s 進場約 18 秒到投彈點，一趟循環
    // 約 60 秒。八架裡一枚都沒投就是這條路斷了
    run(b, 60)
    expect(dropped(b)).toBeGreaterThan(0)

    const hurt = b.world.ships.filter((s, i) => s.hp < hp0[i]!).length
    console.log(`零戰投放 ${dropped(b)} 枚、扣到血的船 ${hurt} 艘`)
    console.log(`船血：${b.world.ships.map((s) => Math.round(s.hp)).join(' ')}`)
    expect(hurt).toBeGreaterThan(0)
  })
})
