import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { wireBattleAi } from '../../src/app/wireBattleAi'
import { createGroundTarget } from '../../src/world/groundTargets'
import { KI84 } from '../../src/specs/ki84'
import { KI84_BOMB_LOADOUT } from '../../src/weapons/stores'

/**
 * # 掛彈的 AI 戰鬥機會對地投彈
 *
 * 守的是「會不會投」：一架掛彈的疾風、天上沒有敵機、地上一輛卡車，接線走
 * `wireBattleAi`（與 `main.ts` 同一個接線點）。一段時間之內要投出炸彈，而且
 * 自己沒被自己的彈炸下來。投得準不準由試玩判斷。
 */

const DT = 1 / 240
/** 第一枚投出之前最多等幾秒 */
const DROP_LIMIT = 90
/** 投出之後再飛幾秒，讓炸彈落地 */
const FALL_SECONDS = 8

describe('AI 戰鬥機對地投彈', () => {
  it('沒有敵機時，掛彈的疾風對卡車投出炸彈，投彈的那一架還活著', () => {
    const w = new World()
    // 【掛載走 World 的複寫】`c.loadout` 與 `c.bombBay` 由 `add` 一起配好
    w.loadoutOverrides = { ki84: KI84_BOMB_LOADOUT }
    const ai = new AiController()
    const spawn = new Vector3(0, 800, 3000)
    const c = w.add(new Aircraft(KI84), ai, 'blue', spawn)
    c.aircraft.state.position.copy(spawn)
    c.aircraft.prevPosition.copy(spawn)
    w.groundTargets.push(createGroundTarget(0, 'usTruck', 'red', 0, 0, 0))
    ai.board = createTargetBoard(w.combatants)
    ai.selfIndex = c.index
    wireBattleAi(w, { priorityGroundUnit: 'usTruck' }, c, new AiController(), { islands: [] })
    const full = c.bombBay.load
    expect(full).toBeGreaterThan(0)

    while (c.bombBay.load === full && w.time < DROP_LIMIT) w.step(DT)
    expect(c.bombBay.load, `第 ${w.time.toFixed(1)} 秒仍沒有投彈`).toBeLessThan(full)
    const t0 = w.time
    while (w.time < t0 + FALL_SECONDS) w.step(DT)
    expect(c.alive).toBe(true)
  })
})
