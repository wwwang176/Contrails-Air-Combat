import { describe, it, expect } from 'vitest'
import { battleLights } from '../../src/battle/battleLights'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions/types'
import { cardWith, readyCard, KILL_CARD } from '../fixtures/mission'

/**
 * 照明彈的燈要不要掛。**開戰時決定、整場不變** —— 燈數一變每個受光材質就
 * 重編著色器；決定在開場，卡頓就留在載入的那一刻。
 *
 * 爆炸的閃光每一關都有（擊墜、高射砲），所以只有照明彈這一組看關卡。
 */
describe('battleLights：只有帶照明彈的關卡掛照明彈燈', () => {
  it('卡片帶 flares 才掛', () => {
    const flares = {
      when: { kind: 'clock' as const, at: 1 }, points: [{ x: 0, z: -5000, altitude: 1200, delay: 0 }],
    }
    expect(battleLights(missionConfigFrom(cardWith(KILL_CARD, { flares }))).flares).toBe(true)
    expect(battleLights(missionConfigFrom(readyCard(KILL_CARD))).flares).toBe(false)
    for (const c of Object.values(MISSIONS).flat()) {
      if (c.battle === null) continue
      const cfg = missionConfigFrom(c as ReadyMissionCard)
      expect(battleLights(cfg).flares, c.id).toBe(c.battle.flares !== undefined)
    }
  })
})
