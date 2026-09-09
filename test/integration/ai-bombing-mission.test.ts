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

/** 這一關投的是什麼。`japan-m4` 掛的是魚雷（`weapons/stores.ts`） */
function dropped(b: Battle): number {
  return b.world.bombs.dropped + b.world.torpedoes.dropped
}

function run(b: Battle, seconds: number): void {
  for (let i = 0; i < seconds * 240; i++) { wire(b); stepBattle(b, DT) }
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

    // 【120 秒】要涵蓋三批零戰（0／40／80 秒）。開場那八架會被四架 F6F
    // 攔在防空網前面，一枚都投不出來 —— 這一關的壓力靠的是分批到達
    run(b, 120)
    expect(dropped(b)).toBeGreaterThan(0)

    const hurt = b.world.ships.filter((s, i) => s.hp < hp0[i]!).length
    console.log(`零戰投放 ${dropped(b)} 枚、扣到血的船 ${hurt} 艘`)
    console.log(`船血：${b.world.ships.map((s) => Math.round(s.hp)).join(' ')}`)
    expect(hurt).toBeGreaterThan(0)
  })

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

  /**
   * 【重生的那一條命也要投得出彈】重生批次從右舷 45° 進場，角度變化大；
   * 沒有正飛的提示時指揮儀會翻轉後拉，倒著俯衝投不出彈，然後鑽到安全層
   * 接管。這一條守的是「側翼批次投得出」—— 只看開場那一輪抓不到它。
   */
  it('重生的零戰也投得出彈', () => {
    const b = mission(zeroCard)
    const n = b.world.combatants.length
    const lives = new Int32Array(n)
    const wasAlive = new Uint8Array(n).fill(1)
    const lastLoad = new Int32Array(n)
    for (let i = 0; i < n; i++) lastLoad[i] = b.world.combatants[i]!.bombBay.load
    let revivedDrops = 0
    let revivedLives = 0
    // 【240 秒】六批重生要到三分多鐘才走完，重生的那幾條命也要有時間進場
    for (let i = 0; i < 240 * 240; i++) {
      wire(b)
      stepBattle(b, DT)
      for (let k = 0; k < n; k++) {
        const c = b.world.combatants[k]!
        if (c.team !== 'red' || c.aircraft.spec.role !== 'fighter') continue
        const alive = c.alive ? 1 : 0
        if (alive && !wasAlive[k]) { lives[k] = lives[k]! + 1; revivedLives++; lastLoad[k] = c.bombBay.load }
        wasAlive[k] = alive
        if (alive && lives[k]! > 0 && c.bombBay.load < lastLoad[k]!) revivedDrops += lastLoad[k]! - c.bombBay.load
        lastLoad[k] = c.bombBay.load
      }
    }
    console.log(`重生 ${revivedLives} 席、重生後投放 ${revivedDrops} 枚`)
    expect(revivedLives).toBeGreaterThan(0)
    expect(revivedDrops).toBeGreaterThan(0)
  }, 300_000)
})
