import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120

/**
 * 【margin 在跑之前定死】專案負責人 2026-08-08 裁定 0.10。看到結果再定
 * 門檻等於量到綠為止 —— 這個專案在第二份 §11.7 剛踩過（門檻訂完之後量測
 * 工具又改了，比值從 26 倍掉到 8.9 倍）。
 */
const MARGIN = 0.10

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

/**
 * 把一隊的命令清乾淨。
 *
 * 【為什麼是清而不是不接線】兩邊跑的是**完全同一份程式**，差別只有命令有
 * 沒有真的傳到戰機端 —— 這比改生產程式碼誠實（第一份的做法，沿用）。
 */
function suppress(b: Battle, team: 'blue' | 'red'): void {
  const st = team === 'blue' ? b.blueCommand : b.redCommand
  st.orders.fill(null)
  for (const c of b.world.combatants) {
    if (c.team !== team) continue
    const ai = c.controller
    if (ai instanceof AiController) {
      ai.order = null
      ai.focusTarget = null
    }
  }
}

interface Damage {
  blue: number
  red: number
}

/**
 * 跑一場 20v20，指定哪一隊有指揮官。
 *
 * @param commanded `'none'` = 兩隊都沒有；`'blue'` / `'red'` = 只有那一隊有
 */
function observe(commanded: 'none' | 'blue' | 'red'): Damage {
  const b: Battle = createBattle(new Idle())
  const hp0 = b.world.combatants.map((c) => c.hp)

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)
    if (commanded !== 'blue') suppress(b, 'blue')
    if (commanded !== 'red') suppress(b, 'red')
  }

  const out: Damage = { blue: 0, red: 0 }
  for (const c of b.world.combatants) {
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') out.blue += lost
    else out.red += lost
  }
  return out
}

describe('決策層的主判準（20v20、120 秒、三場）', () => {
  const base = observe('none')
  const blue = observe('blue')
  const red = observe('red')

  /** 藍方的傷害交換比：紅方掉的血 ÷ 藍方掉的血。越大越好 */
  const R0 = base.red / Math.max(base.blue, 1)
  const R1 = blue.red / Math.max(blue.blue, 1)
  const S1 = red.blue / Math.max(red.red, 1)

  /** 【場景要成立】任何一場打不起來的話，下面兩條都會空洞地通過 */
  it('三場都真的打起來了', () => {
    console.log(JSON.stringify({
      base: `B${base.blue.toFixed(0)}:R${base.red.toFixed(0)}`,
      blueCommanded: `B${blue.blue.toFixed(0)}:R${blue.red.toFixed(0)}`,
      redCommanded: `B${red.blue.toFixed(0)}:R${red.red.toFixed(0)}`,
      R0: R0.toFixed(3), R1: R1.toFixed(3), S1: S1.toFixed(3),
      need: `${(R0 * (1 + MARGIN)).toFixed(3)} / ${((1 / R0) * (1 + MARGIN)).toFixed(3)}`,
    }))
    expect(base.blue + base.red).toBeGreaterThan(0)
    expect(blue.blue + blue.red).toBeGreaterThan(0)
    expect(red.blue + red.red).toBeGreaterThan(0)
  }, 10 * 60 * 1000)

  /**
   * 【主判準，極性一】spec §7.3。有指揮的一方要贏過沒指揮的基準。
   */
  it('藍方指揮 → 藍方的交換比高於基準', () => {
    expect(R1).toBeGreaterThan(R0 * (1 + MARGIN))
  }, 10 * 60 * 1000)

  /**
   * 【主判準，極性二】`DEFAULT_BATTLE` 是 P-51D 對 Bf 109 G-6，兩個機種的
   * 性能不同。只跑一個極性的話量到的是機種差異加上指揮效果，分不開 ——
   * 機種差異在兩個極性裡方向相反，基準場把它量掉。
   */
  it('紅方指揮 → 紅方的交換比高於基準', () => {
    expect(S1).toBeGreaterThan((1 / R0) * (1 + MARGIN))
  }, 10 * 60 * 1000)
}, 30 * 60 * 1000)
