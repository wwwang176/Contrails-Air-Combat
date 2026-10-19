import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Battle } from '../../src/battle/setup'
import type { ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import { BOMB_AIM_RANGE, BOMB_PROFILE, withinBombUprightRange } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'

/**
 * # AI 對艦攻擊在真正關卡裡的機制
 *
 * - `japan-m3`（掛魚雷）：同一個種子跑兩次逐位元相同
 * - `allies-m3`（零戰掛炸彈）：掛彈的零戰接近投彈瞄準帶時下 upright、遠處不下；
 *   沒掛彈的不下
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
   * 【接近投彈瞄準帶就下 upright】倒飛進帶的話帶內來不及翻回來，投放包絡擋掉，
   * 整條命一枚都不投。遠處不下：轉向要留著翻轉後拉。沒掛彈的 F6F 都不下。
   *
   * 【只看正在攻艦的那幾拍】被直接威脅打斷、改打飛機的那一架不攻艦，也不下 upright。
   * 離場段同理。距離取在邊界兩側各留一段：讀的是這一步之後的位置。
   *
   * 【讀攻艦的意圖，不讀送出去的指令】避地與改出接管時會把 upright 清掉，那是對的 ——
   * 要撞水了先拉起來。這一條守的是攻艦航路自己下不下。
   *
   * 【補彈那一拍不算】彈艙在這一步的後段才補滿，AI 決策時還是空的
   */
  it('掛彈的零戰近瞄準帶保持正飛、遠處不強制，F6F 不受影響；投得出去', () => {
    const b = mission(zeroCard)
    let near = 0
    let nearUpright = 0
    let far = 0
    let farUpright = 0
    let dropped = 0
    const load = new Map<number, number>()
    for (let i = 0; i < 60 * 240; i++) {
      wire(b)
      stepBattle(b, DT)
      for (const c of b.world.combatants) {
        if (c.team === 'blue') {
          if (c.alive) expect(c.command.upright).toBe(false)
          continue
        }
        const before = load.get(c.index) ?? c.bombBay.load
        if (c.bombBay.load < before) dropped += before - c.bombBay.load
        load.set(c.index, c.bombBay.load)
        const ctl = c.controller
        if (!c.alive || before === 0 || c.bombBay.load === 0 || !(ctl instanceof AiController)) continue
        // 攻艦航路與它的意圖都是私有狀態，只有這裡讀
        const own = ctl as unknown as { surface: { groundStrafeActive: boolean }; raw: { upright: boolean } }
        const ship = b.world.ships[ctl.shipAim.ship]
        if (!own.surface.groundStrafeActive || ctl.groundStrafePhase === 'egress' || ship === undefined) continue
        const point = ship.cls.aimPoints[ctl.shipAim.point] ?? null
        if (withinBombUprightRange(c.aircraft, ship, BOMB_AIM_RANGE * 0.9, point)) {
          near++
          if (own.raw.upright) nearUpright++
        } else if (!withinBombUprightRange(c.aircraft, ship, BOMB_AIM_RANGE * 1.2, point)) {
          far++
          if (own.raw.upright) farUpright++
        }
      }
    }
    expect(near).toBeGreaterThan(0)
    expect(nearUpright).toBe(near)
    expect(far).toBeGreaterThan(0)
    expect(farUpright).toBe(0)
    expect(dropped).toBeGreaterThan(0)
  })
})
