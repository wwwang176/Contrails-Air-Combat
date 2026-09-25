import { describe, it, expect } from 'vitest'
import { createBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { createArchipelago } from '../../src/world/archipelago'
import { createFarmland, outsideZero } from '../../src/world/farmland'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { recoveryClearance } from '../../src/ai/safety'
import { ALTITUDES } from '../../src/battle/skirmish'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/**
 * 開場高度（`ALTITUDES`）× 地圖上的山：**沒有人生在山裡**。
 *
 * 【為什麼要驗】甲板開場高度與群島的錨島同一個量級，出生在山裡就是**開局
 * 直接墜機**，而畫面上看起來像是隨機的白畫面。只看出生那一刻，不跑戰鬥。
 */

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.firing = false
  }
}

const SEED = 20260805
/** 每隊架數。預設編制 —— 玩家最常打的那一種 */
const SIDE = 20
const DECK = ALTITUDES[0]!.value

/** 甲板高度開場時，每一架離地的最小值，m */
function spawnClear(ground: (x: number, z: number) => number): number {
  const b = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, altitude: DECK, units: lineAbreast(HEAD_ON, P51D, SIDE, BF109K4, SIDE),
  }, SEED)
  let min = Infinity
  for (const c of b.world.combatants) {
    const p = c.aircraft.state.position
    min = Math.min(min, p.y - ground(p.x, p.z))
  }
  return min
}

describe('沒有人生在山裡', () => {
  it('群島：離地餘裕撐得住一次拉起', () => {
    const arch = createArchipelago()
    const clear = spawnClear((x, z) => {
      const h = arch.field.sample(x, z)
      return Number.isFinite(h) && h > 0 ? h : 0
    })
    expect(clear).toBeGreaterThan(recoveryClearance(P51D))
  })

  /** 內陸農地的丘陵峰高上限 120 m，只要求不在地面以下 */
  it('內陸農地', () => {
    const farm = outsideZero(createFarmland().field)
    expect(spawnClear((x, z) => farm.sample(x, z))).toBeGreaterThan(0)
  })
})
