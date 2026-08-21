import { describe, it, expect } from 'vitest'
import { createBattle, resetBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'
import { P51D } from '../../src/specs/p51d'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

const cfg = (): ReturnType<typeof battleConfigFrom> => battleConfigFrom({
  ...DEFAULT_SKIRMISH, specId: 'b17g', blueCount: 2, redCount: 2,
})

describe('砲塔狀態的生命週期', () => {
  it('建立時每架都配好，長度等於該機種的砲塔數', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    for (const c of b.world.combatants) {
      expect(c.turretStates).toHaveLength(c.aircraft.spec.turrets.length)
      expect(c.turretCooldowns).toHaveLength(c.aircraft.spec.turrets.length)
    }
  })

  /**
   * 【要真的換機種】場景建的已經是 B-17G，再 `setSpec(c, B17G)` 等於沒換，
   * 抓不到「長度沒跟著重配」的缺陷。從有砲塔的換成沒砲塔的、再換回來，
   * 兩個方向都走過。
   */
  it('setSpec 換機種時長度跟著換（兩個方向）', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    expect(c.turretStates).toHaveLength(B17G.turrets.length)

    b.world.setSpec(c, P51D)
    expect(c.turretStates).toHaveLength(0)
    expect(c.turretCooldowns).toHaveLength(0)

    b.world.setSpec(c, HE111)
    expect(c.turretStates).toHaveLength(HE111.turrets.length)
    expect(c.turretCooldowns).toHaveLength(HE111.turrets.length)
  })

  /**
   * 【為什麼死機的槍焰也要遞減】既有的固定槍是在 `alive` 檢查**之前**遞減
   * （`World.step` 的註解：「被打爆那一瞬間亮著的槍焰，若遞減寫在 continue
   * 之後就會永遠停在那裡」）。砲塔的 flash 併進同一個迴圈，所以這一條測的
   * 是「真的併進去了」。
   */
  it('載機死了之後砲塔槍焰仍然遞減到零', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    for (const st of c.turretStates) st.flash = 0.03
    c.alive = false
    for (let k = 0; k < 240; k++) b.world.step(1 / 240)
    expect(c.turretStates.every((st) => st.flash === 0)).toBe(true)
  })

  /**
   * 【為什麼 respawn 也要清】不清的話，重生後的砲塔會從上一條命的指向、
   * 目標與點放相位接著跑。`World.respawn` 原本只清固定槍的 cooldowns。
   */
  it('respawn 之後砲塔回到初始狀態', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    c.turretStates[0]!.targetIndex = 3
    c.turretStates[0]!.aim.set(1, 0, 0)
    c.turretCooldowns[0] = 0.5
    b.world.respawn(c)
    expect(c.turretStates[0]!.targetIndex).toBe(-1)
    expect(c.turretStates[0]!.aim.equals(c.aircraft.spec.turrets[0]!.axis)).toBe(true)
    expect(c.turretCooldowns[0]).toBe(0)
  })

  /**
   * 【為什麼 world.time 一定要歸零】搖晃直接吃 `world.time`。不歸零的話
   * 第二場即使種子與設定完全相同，也會從**不同的搖晃相位**開始 ——
   * 逐位元重播因此破功，而症狀看起來像隨機的。
   */
  it('resetBattle 把 world.time 歸零', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    b.world.step(1 / 240)
    expect(b.world.time).toBeGreaterThan(0)
    resetBattle(b, 1)
    expect(b.world.time).toBe(0)
  })

  it('resetBattle 之後砲塔狀態也重設', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    c.turretStates[0]!.targetIndex = 3
    resetBattle(b, 1)
    expect(c.turretStates[0]!.targetIndex).toBe(-1)
  })
})
