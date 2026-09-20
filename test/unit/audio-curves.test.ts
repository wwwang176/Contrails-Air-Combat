import { describe, it, expect } from 'vitest'
import {
  engineRate, windParams, shakeStrength, shakeInterval, shakeGainDb, dbToGain, soundDelay, distanceCutoffHz,
  hitFeedback,
} from '../../src/audio/curves'

describe('引擎播放速度', () => {
  it('油門 0 → 0.85；1 → 1.10；超過 1.1 夾住；負的當 0', () => {
    expect(engineRate(0)).toBeCloseTo(0.85)
    expect(engineRate(1)).toBeCloseTo(1.10)
    expect(engineRate(2)).toBeCloseTo(0.85 + 0.25 * 1.1)
    expect(engineRate(-1)).toBeCloseTo(0.85)
  })
})

describe('風切', () => {
  const o = { cutoffHz: 0, gainDb: 0 }
  it('靜止 250 Hz、−24 dB；極速 7000 Hz、0 dB', () => {
    windParams(0, o)
    expect(o.cutoffHz).toBeCloseTo(250)
    expect(o.gainDb).toBeCloseTo(-24)
    windParams(1, o)
    expect(o.cutoffHz).toBeCloseTo(7000)
    expect(o.gainDb).toBeCloseTo(0)
  })
  it('超過極速夾在 1', () => {
    windParams(1.3, o)
    expect(o.cutoffHz).toBeCloseTo(7000)
  })
})

describe('機身晃動', () => {
  it('強度取超速與受損較大者；HP 一半以上不算受損', () => {
    expect(shakeStrength(0, 1)).toBe(0)
    expect(shakeStrength(0, 0.5)).toBe(0)
    expect(shakeStrength(0, 0.25)).toBeCloseTo(0.5)
    expect(shakeStrength(0.8, 0.25)).toBeCloseTo(0.8)
  })
  it('越強越密：k=1 約 0.4 s，k=0 約 1.6 s，±25% 隨機', () => {
    expect(shakeInterval(1, () => 0.5)).toBeCloseTo(0.4)
    expect(shakeInterval(0, () => 0.5)).toBeCloseTo(1.6)
    expect(shakeInterval(1, () => 0)).toBeCloseTo(0.3)
  })
  /** 【晃動是背景】它一直在響，蓋過引擎與開火就太吵 */
  it('音量 −24 → −12 dB', () => {
    expect(shakeGainDb(0)).toBe(-24)
    expect(shakeGainDb(1)).toBe(-12)
  })
  it('dB 換倍率', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
  })
})

describe('距離', () => {
  it('音速延遲：1 km 約 2.9 s', () => {
    expect(soundDelay(1000)).toBeCloseTo(2.915, 2)
    expect(soundDelay(0)).toBe(0)
  })
  it('遠處只剩低頻：100 m、1 km、8 km', () => {
    expect(distanceCutoffHz(100)).toBeCloseTo(14667, -1)
    expect(distanceCutoffHz(1000)).toBeCloseTo(3667, -1)
    expect(distanceCutoffHz(8000)).toBeCloseTo(537, 0)
  })
  it('距離越遠截止越低', () => {
    expect(distanceCutoffHz(3000)).toBeLessThan(distanceCutoffHz(2000))
  })
})

describe('打中敵機的回饋', () => {
  const o = { gainDb: 0, cutoffHz: 0 }

  /** 【近距離不衰減】它是「打中了」的回饋，200 m 內要保持乾脆 */
  it('200 m 內不衰減', () => {
    hitFeedback(0, o)
    expect(o.gainDb).toBeCloseTo(0)
    hitFeedback(200, o)
    expect(o.gainDb).toBeCloseTo(0)
  })

  /** 【衰減只做真實的一半】完全照距離衰減的話，遠距離命中幾乎聽不到，回饋就沒了 */
  it('600 m 衰減約 5 dB（真實的一半），1500 m 約 9 dB', () => {
    hitFeedback(600, o)
    expect(o.gainDb).toBeCloseTo(-4.77, 2)
    hitFeedback(1500, o)
    expect(o.gainDb).toBeCloseTo(-8.75, 2)
  })

  it('越遠越悶', () => {
    hitFeedback(100, o)
    const near = o.cutoffHz
    hitFeedback(1500, o)
    expect(o.cutoffHz).toBeLessThan(near / 2)
  })
})
