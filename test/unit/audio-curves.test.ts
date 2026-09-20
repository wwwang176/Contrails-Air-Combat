import { describe, it, expect } from 'vitest'
import {
  engineRate, windParams, shakeStrength, shakeInterval, shakeGainDb, dbToGain, soundArrived, distanceCutoffHz,
  hitFeedback, damageGainDb, absorptionDb, voiceLoudnessDb,
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
  it('音速：1 km 要 2.9 s 才傳到，0 m 立刻到', () => {
    expect(soundArrived(2.9, 1000)).toBe(false)
    expect(soundArrived(2.92, 1000)).toBe(true)
    expect(soundArrived(0, 0)).toBe(true)
  })

  /**
   * 【迎上去會提前聽到】音波是從爆炸點往外擴的球面，衝過去就早一點穿過它。
   * 起播時算好一個固定延遲的話，玩家俯衝進爆炸點也要等滿原本的秒數。
   */
  it('距離縮短時提前傳到', () => {
    expect(soundArrived(1.5, 1000)).toBe(false)
    expect(soundArrived(1.5, 500)).toBe(true)
  })
  /**
   * 【對照 ISO 9613-1】真實的大氣吸收與距離成正比、與頻率平方成正比。
   * 這條曲線加上 `absorptionDb` 與兩級低通之後，250 Hz–8 kHz、0.2–8 km 的
   * 平均誤差約 4 dB。
   */
  it('遠處只剩低頻：100 m、1 km、3 km、8 km', () => {
    expect(distanceCutoffHz(100)).toBeCloseTo(4899, 0)
    expect(distanceCutoffHz(1000)).toBeCloseTo(1903, 0)
    expect(distanceCutoffHz(3000)).toBeCloseTo(1120, 0)
    expect(distanceCutoffHz(8000)).toBeCloseTo(690, 0)
  })
  it('距離越遠截止越低', () => {
    expect(distanceCutoffHz(3000)).toBeLessThan(distanceCutoffHz(2000))
  })
  it('空氣吸收：每公里 2.8 dB，近處幾乎沒有', () => {
    expect(absorptionDb(0)).toBeCloseTo(0, 10)
    expect(absorptionDb(1000)).toBeCloseTo(-2.8, 5)
    expect(absorptionDb(3000)).toBeCloseTo(-8.4, 5)
  })
})

describe('聲道搶佔用的估計響度', () => {
  /** 【搶聲道要看響度，不是只看距離】不然近處的爆炸會被遠處的小聲音卡住 */
  it('同距離時音量大的比較響', () => {
    expect(voiceLoudnessDb(6, 150, 500)).toBeGreaterThan(voiceLoudnessDb(-16, 150, 500))
  })

  it('同音量時近的比較響', () => {
    expect(voiceLoudnessDb(0, 150, 100)).toBeGreaterThan(voiceLoudnessDb(0, 150, 2000))
  })

  /** 參考距離內沒有距離衰減，只剩空氣吸收那一點 */
  it('參考距離內只剩空氣吸收', () => {
    expect(voiceLoudnessDb(0, 150, 0)).toBeCloseTo(0)
    expect(voiceLoudnessDb(0, 150, 150)).toBeCloseTo(absorptionDb(150), 5)
  })

  /** 遠處的大爆炸仍可能比近處的小聲音重要 */
  it('1 km 外的爆炸比 20 m 外的擦過響', () => {
    expect(voiceLoudnessDb(6, 150, 1000)).toBeGreaterThan(voiceLoudnessDb(-16, 20, 20))
  })
})

describe('機身受創的輕重', () => {
  it('擦到一點是 −10 dB，正中一發是 +6 dB，超過就夾住', () => {
    expect(damageGainDb(0)).toBe(-10)
    expect(damageGainDb(0.5)).toBe(-2)
    expect(damageGainDb(1)).toBe(6)
    expect(damageGainDb(3)).toBe(6)
    expect(damageGainDb(-1)).toBe(-10)
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
