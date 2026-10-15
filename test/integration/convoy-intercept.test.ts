import { describe, expect, it } from 'vitest'
import { AiController } from '../../src/ai/AiController'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
describe('任務攔截接線', () => {
  it('美 M1 只啟用德軍戰鬥機，重開與兩批整隊重生也沿用設定', () => {
    const b = createBattle(new AiController(), missionConfigFrom(readyCard('allies-m1')), 20261015)
    for (let i = 0; i < 48; i++) stepBattle(b, DT)
    const lead = b.red.find(c => c.alive)!.controller as AiController
    expect(lead.convoyIntercept.phase).not.toBe('none')
    resetBattle(b)
    expect(lead.convoyIntercept.phase).toBe('none')
    for (let i = 0; i < 48; i++) stepBattle(b, DT)
    expect(b.red.filter(c => c.alive)).toHaveLength(3)
    for (const c of b.red.filter(c => c.alive)) {
      expect((c.controller as AiController).interceptConvoy).toBe(true)
      expect((c.controller as AiController).convoyIntercept.phase).not.toBe('none')
    }
    for (let batch = 1; batch <= 2; batch++) {
      for (const c of b.red) b.world.destroy(c)
      for (let i = 0; i < 6 * 240; i++) stepBattle(b, DT)
      expect(b.batches).toBe(batch)
      expect(b.red.filter(c => c.alive)).toHaveLength(3)
      for (const c of b.world.combatants) {
        if (!c.alive) continue
        expect((c.controller as AiController).interceptConvoy).toBe(c.team === 'red')
      }
    }
    for (const c of b.red) b.world.destroy(c)
    for (let i = 0; i < 6 * 240; i++) stepBattle(b, DT)
    expect(b.batches).toBe(2)
    expect(b.red.filter(c => c.alive)).toHaveLength(0)
  }, 30_000)

  it('美 M3 與遭遇戰不啟用攔截任務', () => {
    for (const cfg of [missionConfigFrom(readyCard('allies-m3')), DEFAULT_BATTLE]) {
      const b = createBattle(new AiController(), cfg, 20261015)
      for (let i = 0; i < 48; i++) stepBattle(b, DT)
      for (const c of b.world.combatants) {
        const ai = c.controller as AiController
        expect(ai.interceptConvoy).toBe(false)
        expect(ai.convoyIntercept.phase).toBe('none')
      }
    }
  })
})
