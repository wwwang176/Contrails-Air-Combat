import { describe, expect, it } from 'vitest'
import { AiController } from '../../src/ai/AiController'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
describe('任務攔截接線', () => {
  it('德 M1 的我方 AI 攔截轟炸機，擊落第十三架尚未過關、第十四架獲勝', () => {
    const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m1')), 20261015)
    for (let i = 0; i < 48; i++) stepBattle(b, DT)
    for (const c of b.world.combatants.filter(c => c.alive)) {
      expect((c.controller as AiController).interceptConvoy).toBe(c.team === 'blue')
    }
    const bombers = b.convoy!.seats.map(s => b.world.combatants[s]!)
    for (const c of bombers) expect(c.spawnTas * 3.6).toBeCloseTo(250)
    for (const c of bombers.slice(0, 13)) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.outcome).toBe('fighting')
    b.world.destroy(bombers[13]!)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })

  it('德 M1 抵達的 B-17 不循環、不算擊落，第一架抵達就判敗', () => {
    const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m1')), 20261015)
    const cv = b.convoy!
    const c = b.world.combatants[cv.seats[0]!]!
    c.aircraft.state.position.copy(cv.goal)
    stepBattle(b, DT)
    expect(cv.arrived.filter(Boolean)).toHaveLength(1)
    expect(c.aircraft.state.position.distanceTo(c.spawnPosition)).toBeGreaterThan(15000)
    expect(b.redKilledBombers).toBe(0)
    expect(b.outcome).toBe('defeat')
  })

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
