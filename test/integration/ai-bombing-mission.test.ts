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
 * # AI 對艦攻擊在真正關卡裡的機制
 *
 * - `japan-m3`（掛魚雷）：同一個種子跑兩次逐位元相同
 * - `allies-m3`（零戰掛炸彈）：掛彈的零戰對艦攻擊時下 upright，沒掛彈的不下
 */

const card = MISSIONS.japan.find((c) => c.id === 'japan-m3') as ReadyMissionCard
const zeroCard = MISSIONS.allies.find((c) => c.id === 'allies-m3') as ReadyMissionCard

/** 玩家席位由它佔著不動 —— 這一支驗的是 AI，不是玩家。 */
const IDLE: Controller = { update() {} }

const DT = 1 / 240
const SEED = 1234

/**
 * 把船與投彈那幾格接給每一架 AI。
 *
 * **欄位與 `main.ts` 的 `wireTerrain` 相同** —— 漏掉 `bombDrag` 的話 AI 算的
 * 落點與飛出去的那一顆會分家，而症狀只是「投不準」。
 *
 * 【必須每一步都接，與 `wireTerrain` 一樣】增援進場時那個座位會換一個新的
 * 控制器，只接一次的話它的 `ships` 是空的 —— 那一架於是永遠選不到船，
 * `shipAim.ship` 停在 −1，安安靜靜地在空中繞。這一關的雷擊機正是波次來的。
 */
function wire(b: Battle): void {
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.groundTargets = b.world.groundTargets
    ctl.bombBay = c.bombBay
    ctl.bombDrag = b.world.bombDrag
    // 【剖面也要接】`main.ts` 依掛載選剖面。漏掉這一格的話掛雷的機種會用
    // 轟炸剖面去飛雷擊 —— 而症狀又是「AI 好像不太會投」，沒有錯誤訊息
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  }
}

function mission(which: ReadyMissionCard = card): Battle {
  const b = createBattle(IDLE, missionConfigFrom(which), SEED)
  wire(b)
  return b
}

/** 這一關投的是什麼。`japan-m3` 掛的是魚雷（`weapons/stores.ts`） */
function dropped(b: Battle): number {
  return b.world.bombs.dropped + b.world.torpedoes.dropped
}

function run(b: Battle, seconds: number): void {
  for (let i = 0; i < seconds * 240; i++) { wire(b); stepBattle(b, DT) }
}

describe('japan-m3 的 AI 一式陸攻', () => {
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

/** `allies-m3` 的零戰掛的是炸彈，走轟炸剖面 */
describe('allies-m3 的 AI 零戰', () => {
  /**
   * 【掛彈的零戰整段對艦攻擊都下 upright】進場段就翻轉的話，進落彈瞄準帶時
   * 已經倒飛，帶內來不及翻回來 —— 投放包絡擋掉，整條命一枚都不投。
   * 沒掛彈的 F6F 不下。
   */
  it('掛彈的零戰對艦攻擊時保持正飛，F6F 不受影響', () => {
    const b = mission(zeroCard)
    run(b, 20)
    let zeros = 0
    let upright = 0
    for (const c of b.world.combatants) {
      if (!c.alive) continue
      if (c.team === 'blue') { expect(c.command.upright).toBe(false); continue }
      if (c.bombBay.load === 0) continue
      zeros++
      if (c.command.upright) upright++
    }
    expect(zeros).toBeGreaterThan(0)
    expect(upright).toBe(zeros)
  })
})
