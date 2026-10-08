import { describe, it, expect } from 'vitest'
import { createBattle, resetBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { PlayerController } from '../../src/control/PlayerController'
import { createCommand } from '../../src/control/Controller'
import { createInputState } from '../../src/input/InputState'

/**
 * 玩家前機槍的熱度跟著戰鬥的生命週期：接手僚機、重新開始都歸零。
 *
 * 【接手要當場歸零】`stepBattle` 先跑世界再完成接手；等下一次 `PlayerController.update`
 * 才歸零的話，接手那一幀的 HUD 與音效讀到的是上一架的熱度與空響
 */
function overheat(pc: PlayerController, b: ReturnType<typeof createBattle>): void {
  const input = (pc as unknown as { input: ReturnType<typeof createInputState> }).input
  input.firing = true
  const out = createCommand()
  for (let i = 0; i < 240 * 7; i++) pc.update(b.player.aircraft, 1 / 240, out)
  input.firing = false
}

describe('玩家前機槍熱度的重設', () => {
  it('重新開始時歸零', () => {
    const pc = new PlayerController(createInputState())
    const b = createBattle(pc, DEFAULT_BATTLE, 1)
    overheat(pc, b)
    expect(pc.gunHeat.locked).toBe(true)
    resetBattle(b, 1)
    expect(pc.gunHeat.heat).toBe(0)
    expect(pc.gunHeat.locked).toBe(false)
  })

  it('接手僚機完成的那一步就歸零，不等下一次控制器更新', () => {
    const pc = new PlayerController(createInputState())
    const b = createBattle(pc, DEFAULT_BATTLE, 1)
    overheat(pc, b)
    const mate = b.world.combatants.find((c) => c.team === 'blue' && c !== b.player)!
    b.takeoverSeat = mate.index
    b.takeoverTimer = 1e-9
    stepBattle(b, 1 / 240)
    expect(b.player).toBe(mate)
    expect(pc.gunHeat.heat).toBe(0)
    expect(pc.dryFiring).toBe(false)
  })
})
