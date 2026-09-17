import { describe, it, expect } from 'vitest'
import { battleLights } from '../../src/battle/battleLights'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions/types'

const configOf = (id: string) => {
  for (const list of Object.values(MISSIONS)) {
    const card = list.find((m) => m.id === id)
    if (card !== undefined && card.battle !== null) return missionConfigFrom(card as ReadyMissionCard)
  }
  throw new Error(`找不到可玩的卡 ${id}`)
}

/**
 * 照明彈的燈要不要掛。**開戰時決定、整場不變** —— 燈數一變每個受光材質就
 * 重編著色器；決定在開場，卡頓就留在載入的那一刻。
 *
 * 爆炸的閃光每一關都有（擊墜、高射砲），所以只有照明彈這一組看關卡。
 */
describe('battleLights：只有帶照明彈的關卡掛照明彈燈', () => {
  it('德 M2 夜襲掛', () => {
    expect(battleLights(configOf('germany-m2')).flares).toBe(true)
  })

  it('其他關卡不掛', () => {
    for (const id of ['allies-m1', 'allies-m2', 'allies-m4', 'germany-m1', 'germany-m4',
      'japan-m1', 'japan-m3', 'japan-m4']) {
      expect(battleLights(configOf(id)).flares, id).toBe(false)
    }
  })
})
