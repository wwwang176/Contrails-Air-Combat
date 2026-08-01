import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, sustainedTurnRate, instantaneousTurnRate,
  maxRollRate, specificExcessPower, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const KMH = 1 / 3.6

describe('L3 平衡關係', () => {
  describe('速度與高空', () => {
    it('P-51 臨界高度極速高於 Bf 109', () => {
      expect(maxLevelSpeed(P51D, 7600)).toBeGreaterThan(maxLevelSpeed(BF109G6, 6300))
    })

    it('P-51 在 7,600 m 的速度優勢超過 60 km/h', () => {
      const diff = (maxLevelSpeed(P51D, 7600) - maxLevelSpeed(BF109G6, 7600)) / KMH
      expect(diff).toBeGreaterThan(60)
    })

    it('P-51 升限高於 Bf 109', () => {
      expect(serviceCeiling(P51D)).toBeGreaterThan(serviceCeiling(BF109G6))
    })

    it('高度愈高 P-51 的優勢愈大', () => {
      const low = maxLevelSpeed(P51D, 0) - maxLevelSpeed(BF109G6, 0)
      const high = maxLevelSpeed(P51D, 8000) - maxLevelSpeed(BF109G6, 8000)
      expect(high).toBeGreaterThan(low)
    })
  })

  describe('爬升與盤旋', () => {
    it('Bf 109 海平面爬升率優於 P-51', () => {
      expect(maxClimbRate(BF109G6, 0).rate).toBeGreaterThan(maxClimbRate(P51D, 0).rate)
    })

    it('Bf 109 在 300 km/h 的持續轉彎率優於 P-51', () => {
      expect(sustainedTurnRate(BF109G6, 0, 300 * KMH)).toBeGreaterThan(
        sustainedTurnRate(P51D, 0, 300 * KMH),
      )
    })

    it('Bf 109 低速瞬間轉彎率優於 P-51（縫翼效果）', () => {
      expect(instantaneousTurnRate(BF109G6, 0, 250 * KMH)).toBeGreaterThan(
        instantaneousTurnRate(P51D, 0, 250 * KMH),
      )
    })
  })

  describe('滾轉', () => {
    it('P-51 在 600 km/h 的滾轉率超過 Bf 109 的 1.5 倍', () => {
      const p = maxRollRate(P51D, 0, 600 * KMH)
      const b = maxRollRate(BF109G6, 0, 600 * KMH)
      expect(p).toBeGreaterThan(b * 1.5)
    })

    it('低速時兩者滾轉率差距不大（109 的弱點只在高速）', () => {
      const p = maxRollRate(P51D, 0, 350 * KMH)
      const b = maxRollRate(BF109G6, 0, 350 * KMH)
      expect(b).toBeGreaterThan(p * 0.6)
    })
  })

  describe('能量保持（Boom & Zoom 的物理基礎）', () => {
    it('P-51 高速平飛的 Ps 優於 Bf 109（層流翼低阻）', () => {
      const v = 550 * KMH
      expect(specificExcessPower(P51D, 5000, v, 1)).toBeGreaterThan(
        specificExcessPower(BF109G6, 5000, v, 1),
      )
    })

    it('P-51 在大 G 高速時的能量流失小於 Bf 109', () => {
      const v = 500 * KMH
      expect(specificExcessPower(P51D, 3000, v, 4)).toBeGreaterThan(
        specificExcessPower(BF109G6, 3000, v, 4),
      )
    })

    it('兩台飛機大 G 轉彎時 Ps 皆為顯著負值（能量戰成立）', () => {
      const v = 450 * KMH
      expect(specificExcessPower(P51D, 3000, v, 5)).toBeLessThan(-20)
      expect(specificExcessPower(BF109G6, 3000, v, 5)).toBeLessThan(-20)
    })
  })

  describe('交叉優勢區間存在（避免單方全面碾壓）', () => {
    it('存在 Bf 109 佔優的速度區間', () => {
      let found = false
      for (let kmh = 250; kmh <= 400; kmh += 10) {
        if (sustainedTurnRate(BF109G6, 0, kmh * KMH) > sustainedTurnRate(P51D, 0, kmh * KMH)) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    })

    it('存在 P-51 佔優的速度區間', () => {
      let found = false
      for (let kmh = 500; kmh <= 700; kmh += 20) {
        if (specificExcessPower(P51D, 3000, kmh * KMH, 1) >
            specificExcessPower(BF109G6, 3000, kmh * KMH, 1)) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    })
  })
})
