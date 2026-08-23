import { describe, it, expect } from 'vitest'
import {
  energyPull, sweetSpotAdvantage, sweetSpotPitch, DEFAULT_DOCTRINE,
} from '../../src/ai/doctrine'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const P = applyFeel(P51D, GAME_FEEL)
const B = applyFeel(BF109G6, GAME_FEEL)
const KMH = 1 / 3.6

describe('energyPull：能量見底時少拉一點', () => {
  it('速度充足時完全放行', () => {
    expect(energyPull(1.0, DEFAULT_DOCTRINE)).toBe(1)
    expect(energyPull(1.5, DEFAULT_DOCTRINE)).toBe(1)
  })

  it('速度見底時夾到下限，但不歸零', () => {
    // 【為什麼不歸零】完全鬆桿的 AI 是靶子。下限保留最低限度的機動
    expect(energyPull(0.5, DEFAULT_DOCTRINE)).toBe(DEFAULT_DOCTRINE.energyMinPull)
    expect(DEFAULT_DOCTRINE.energyMinPull).toBeGreaterThan(0)
  })

  it('中間段單調遞增且連續', () => {
    let prev = -1
    for (let r = 0.5; r <= 1.2; r += 0.01) {
      const p = energyPull(r, DEFAULT_DOCTRINE)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
  })

  it('兩端接得上：門檻處剛好等於邊界值', () => {
    const c = DEFAULT_DOCTRINE
    expect(energyPull(c.energyFreeRatio, c)).toBeCloseTo(1, 12)
    expect(energyPull(c.energyFloorRatio, c)).toBeCloseTo(c.energyMinPull, 12)
  })

  it('門檻退化時安全回傳 1（不得意外把 AI 鎖死）', () => {
    const degenerate = { ...DEFAULT_DOCTRINE, energyFreeRatio: 0.7, energyFloorRatio: 0.7 }
    expect(energyPull(0.5, degenerate)).toBe(1)
  })
})

describe('sweetSpotAdvantage：在哪裡我贏得過他', () => {
  it('鏡像對戰處處為零', () => {
    for (const alt of [0, 4000, 8000]) {
      for (const kmh of [300, 450, 600]) {
        expect(sweetSpotAdvantage(P, P, alt, kmh * KMH)).toBeCloseTo(0, 12)
      }
    }
  })

  it('低速時 109 佔優、高速時 P-51 佔優（4000 m）', () => {
    // 實測分水嶺 366 km/h（advantage-map.probe.ts）
    expect(sweetSpotAdvantage(P, B, 4000, 300 * KMH)).toBeLessThan(0)
    expect(sweetSpotAdvantage(P, B, 4000, 500 * KMH)).toBeGreaterThan(0)
  })

  it('反對稱：交換雙方等於變號', () => {
    const a = sweetSpotAdvantage(P, B, 4000, 500 * KMH)
    const b = sweetSpotAdvantage(B, P, 4000, 500 * KMH)
    expect(a).toBeCloseTo(-b, 12)
  })
})

describe('sweetSpotPitch：往優勢上升的方向偏俯仰', () => {
  /**
   * 【為什麼不用 `DEFAULT_DOCTRINE`】出貨值的 `sweetSpotMaxPitch` 目前是 **0**
   * ——這一層在出貨路徑上是關著的（見該欄位的註解）。函式本身沒有變，
   * 也還有呼叫端，所以它的行為要繼續被釘住；用出貨值測會讓每一條都回 0，
   * 那不是「函式對了」，是「函式沒被叫到」。
   */
  const ON = { ...DEFAULT_DOCTRINE, sweetSpotMaxPitch: 10 * (Math.PI / 180) }

  it('鏡像對戰不偏', () => {
    expect(sweetSpotPitch(P, P, 4000, 450 * KMH, ON)).toBeCloseTo(0, 12)
  })

  it('P-51 太慢時低頭換速度', () => {
    // 300 km/h 在分水嶺以下，P-51 該加速 → 低頭 → 負
    expect(sweetSpotPitch(P, B, 4000, 300 * KMH, ON)).toBeLessThan(0)
  })

  it('109 太快時抬頭換高度（減速）', () => {
    // 109 在 500 km/h 是劣勢，它的優勢在更慢處 → 該減速 → 抬頭 → 正
    expect(sweetSpotPitch(B, P, 4000, 500 * KMH, ON)).toBeGreaterThan(0)
  })

  it('偏置不得超過上界', () => {
    for (const alt of [0, 4000, 8000]) {
      for (let kmh = 250; kmh <= 700; kmh += 10) {
        const p = Math.abs(sweetSpotPitch(P, B, alt, kmh * KMH, DEFAULT_DOCTRINE))
        expect(p).toBeLessThanOrEqual(ON.sweetSpotMaxPitch + 1e-12)
      }
    }
  })
})
