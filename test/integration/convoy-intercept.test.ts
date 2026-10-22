import { describe, expect, it } from 'vitest'
import { AiController } from '../../src/ai/AiController'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { stepCommandLayer } from '../../src/battle/commandLayer'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard, KILL_CARD } from '../fixtures/mission'

const DT = 1 / 240
describe('任務攔截接線', () => {
  it('德 M1 的我方 AI 攔截轟炸機，擊落到只剩一架尚未過關、全部擊落獲勝', () => {
    const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m1')), 20261015)
    for (let i = 0; i < 48; i++) stepBattle(b, DT)
    for (const c of b.world.combatants.filter(c => c.alive)) {
      expect((c.controller as AiController).interceptConvoy).toBe(c.team === 'blue')
    }
    const bombers = b.convoy!.seats.map(s => b.world.combatants[s]!)
    const last = bombers.length - 1
    for (const c of bombers.slice(0, last)) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.outcome).toBe('fighting')
    b.world.destroy(bombers[last]!)
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

  /**
   * 【每步同步，不是生成時設一次】增援、重生與玩家換座位都會換上一顆新的控制器；
   * 只在建場時設的話，新的那一顆永遠不攔截。
   *
   * 【重開要清攔截狀態】沿用的控制器不清的話，第二場開場就帶著上一場的攔截目標。
   */
  it('美 M1 只有德軍戰鬥機攔截：換上的新控制器下一步就接到，重開清掉攔截狀態', () => {
    const b = createBattle(new AiController(), missionConfigFrom(readyCard('allies-m1')), 20261015)
    for (let i = 0; i < 48; i++) stepBattle(b, DT)
    const lead = b.red.find(c => c.alive)!.controller as AiController
    expect(lead.convoyIntercept.phase).not.toBe('none')
    resetBattle(b)
    expect(lead.convoyIntercept.phase).toBe('none')

    const red = b.red.find(c => c.alive)!
    const blue = b.blue.find(c => c.alive && c !== b.player)!
    const fresh = { red: new AiController(), blue: new AiController() }
    red.controller = fresh.red
    blue.controller = fresh.blue
    expect(fresh.red.interceptConvoy).toBe(false)
    stepCommandLayer(b, DT)
    expect(fresh.red.interceptConvoy).toBe(true)
    expect(fresh.blue.interceptConvoy).toBe(false)
    for (const c of b.world.combatants) {
      if (!c.alive || !(c.controller instanceof AiController)) continue
      expect(c.controller.interceptConvoy).toBe(c.team === 'red')
    }
  })

  it('殲滅卡與遭遇戰不啟用攔截任務', () => {
    for (const cfg of [missionConfigFrom(readyCard(KILL_CARD)), DEFAULT_BATTLE]) {
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
