import { describe, it, expect } from 'vitest'
import {
  engineRate, windParams, shakeInterval, shakeGainDb, dbToGain, soundArrived, distanceCutoffHz,
  hitFeedback, damageGainDb, absorptionDb, voiceLoudnessDb, blastGainDb, blastRate, dopplerRate, hitRate,
  fadeInCurve,
} from '../../src/audio/curves'

describe('淡入曲線', () => {
  it('從 0 開始、到 1 結束，一路不降', () => {
    const c = fadeInCurve(32)
    expect(c.length).toBe(32)
    expect(c[0]).toBe(0)
    expect(c[31]).toBe(1)
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!)
  })

  /**
   * 【前段要壓低】線性的增益在一半時已經是 −6 dB，耳朵聽起來是一開頭就衝上來；
   * 平方曲線一半時是 −12 dB，大聲的部分留到後段
   */
  it('走到一半只有四分之一的增益', () => {
    const c = fadeInCurve(33)
    expect(c[16]).toBeCloseTo(0.25, 6)
  })
})

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

  /**
   * 【衰減率小於 1 就傳得更遠】軍火的爆炸用 0.45 —— 3 km 外比 1 大 6.4 dB。
   * 搶聲道的估計也要吃它，不然遠處的大爆炸會被當成小聲音丟掉。
   */
  it('衰減率越小，遠處越響', () => {
    expect(voiceLoudnessDb(6, 150, 3000, 0.45)).toBeGreaterThan(voiceLoudnessDb(6, 150, 3000))
    expect(voiceLoudnessDb(6, 150, 3000, 0.45) - voiceLoudnessDb(6, 150, 3000)).toBeCloseTo(6.42, 1)
    // 參考距離之內不受影響
    expect(voiceLoudnessDb(0, 150, 100, 0.45)).toBeCloseTo(voiceLoudnessDb(0, 150, 100))
  })

  /** 遠處的大爆炸仍可能比近處的小聲音重要 */
  it('1 km 外的爆炸比 20 m 外的擦過響', () => {
    expect(voiceLoudnessDb(6, 150, 1000)).toBeGreaterThan(voiceLoudnessDb(-16, 20, 20))
  })
})

describe('多普勒', () => {
  const at = (x: number, y = 0, z = 0): { x: number; y: number; z: number } => ({ x, y, z })
  const ZERO = at(0)
  /** 音源在原點、聽者在 +x 1 km 外 */
  const SP = at(0), LP = at(1000)

  it('都不動就是 1', () => {
    expect(dopplerRate(SP, ZERO, LP, ZERO)).toBeCloseTo(1)
  })

  /** 【夾制之內就是物理值】不縮放、不誇張 */
  it('音源接近 50 m/s → 1.17；遠離 50 m/s → 0.87', () => {
    expect(dopplerRate(SP, at(50), LP, ZERO)).toBeCloseTo(343 / 293, 4)
    expect(dopplerRate(SP, at(-50), LP, ZERO)).toBeCloseTo(343 / 393, 4)
    expect(dopplerRate(SP, ZERO, LP, at(-50))).toBeCloseTo(393 / 343, 4)
  })

  /**
   * 【接近側比遠離側強得多，這是真的】一次 150 m/s 的掠過落差 16 個半音，
   * 三分之二在接近時。
   */
  it('150 m/s 掠過：接近 +9.9 個半音、遠離 −6.3 個半音，都沒被夾', () => {
    const near = dopplerRate(SP, at(150), LP, ZERO)
    const far = dopplerRate(SP, at(-150), LP, ZERO)
    expect(near).toBeCloseTo(343 / 193, 4)
    expect(far).toBeCloseTo(343 / 493, 4)
    expect(12 * Math.log2(near)).toBeCloseTo(9.95, 1)
    expect(12 * Math.log2(far)).toBeCloseTo(-6.28, 1)
  })

  /** 【同速同向沒有多普勒】僚機編隊飛行時不該一直升調 */
  it('音源與聽者同速同向 → 1', () => {
    expect(dopplerRate(SP, at(100), LP, at(100))).toBeCloseTo(1)
  })

  /** 【只看連線方向的分量】側向掠過的那一瞬間沒有升降調 */
  it('速度垂直連線 → 1', () => {
    expect(dopplerRate(SP, at(0, 0, 200), LP, ZERO)).toBeCloseTo(1)
  })

  /**
   * 【二戰的飛機咬不到夾制】正面對進時聽者那一項加在分子上，不會讓分母趨近
   * 零 —— 兩架 150 m/s 對頭是 2.55，兩架反向飛開是 0.39，都在範圍內。
   */
  it('兩架對頭與兩架飛開都不被夾', () => {
    expect(dopplerRate(SP, at(150), LP, at(-150))).toBeCloseTo(493 / 193, 4)
    expect(dopplerRate(SP, at(-150), LP, at(150))).toBeCloseTo(193 / 493, 4)
  })

  /** 【夾制是最後一道防線】鏡頭瞬移、換場、音源超過音速算出來的怪值由它接住 */
  it('夾在 0.35–2.7', () => {
    // 一架自己以 300 m/s 衝過來：照實算 7.98
    expect(dopplerRate(SP, at(300), LP, ZERO)).toBe(2.7)
    // 音源比音速還快（不會發生，但分母會變號）
    expect(dopplerRate(SP, at(400), LP, ZERO)).toBe(0.35)
  })

  it('距離為零時不算（避免除以零）', () => {
    expect(dopplerRate(SP, at(100), SP, ZERO)).toBe(1)
  })
})

describe('爆炸的當量', () => {
  // 遊戲裡的四種：零戰 60 kg 彈 0.11、B-17 的 1.00、He 111 的 1.03、魚雷 1.67
  /** 【大的比較大聲】固定距離下爆震的壓力正比於當量的立方根，也就是正比於尺度 */
  it('音量 20·log10(尺度)，夾在 −12…+6 dB', () => {
    expect(blastGainDb(1)).toBeCloseTo(0)
    expect(blastGainDb(1.667)).toBeCloseTo(4.44, 2)
    expect(blastGainDb(1.9)).toBeCloseTo(5.58, 2)
    expect(blastGainDb(4)).toBe(6)
    expect(blastGainDb(0.11)).toBe(-12)
    expect(blastGainDb(0)).toBe(-12)
  })

  /**
   * 【大的比較低沉、拖得比較長】爆震的持續時間也正比於當量的立方根。
   * 完全照實的話 60 kg 彈會快兩倍多（高八度），取 0.35 次方再夾住。
   */
  it('播放速度：大的變慢變低，小的變快變脆', () => {
    expect(blastRate(1)).toBeCloseTo(1)
    expect(blastRate(1.667)).toBeCloseTo(0.836, 3)
    expect(blastRate(0.11)).toBe(1.4)
    expect(blastRate(5)).toBe(0.8)
  })

  it('越大越慢，越大越大聲', () => {
    expect(blastRate(1.5)).toBeLessThan(blastRate(0.5))
    expect(blastGainDb(1.5)).toBeGreaterThan(blastGainDb(0.5))
  })
})

describe('被打中的低沉度', () => {
  const P51 = 4427, B17 = 22000, A6M5 = 2733

  it('基準質量、基準護甲就是 1', () => {
    expect(hitRate(4500, 1)).toBeCloseTo(1, 3)
  })

  /** 【大台的比較低沉】B-17 比 P-51 低 5 個半音左右 */
  it('越大台越低沉：B-17 < P-51 < 零戰', () => {
    const b = hitRate(B17, 1), p = hitRate(P51, 1), a = hitRate(A6M5, 1)
    expect(b).toBeLessThan(p)
    expect(p).toBeLessThan(a)
    expect(12 * Math.log2(b / p)).toBeCloseTo(-5.0, 0)
  })

  /** 【護甲厚的比較低沉】同一台飛機，打中引擎比打中機翼悶 */
  it('護甲越高越低沉', () => {
    expect(hitRate(P51, 1.3)).toBeLessThan(hitRate(P51, 0.7))
  })

  /**
   * 【差距不能過大】夾在 0.7–1.2，也就是 −6.2 到 +3.2 個半音。
   * 不夾的話大飛機會整台變成低音。
   */
  it('夾在 0.7–1.2', () => {
    expect(hitRate(1e6, 2)).toBe(0.7)
    expect(hitRate(100, 0.1)).toBe(1.2)
  })

  it('質量或護甲為零時不炸', () => {
    expect(hitRate(0, 0)).toBe(1.2)
    expect(Number.isFinite(hitRate(-5, -1))).toBe(true)
  })
})

describe('機身受創的輕重', () => {
  it('擦到一點是 −7.7 dB，正中一發是 +8.3 dB，超過就夾住', () => {
    expect(damageGainDb(0)).toBeCloseTo(-7.7)
    expect(damageGainDb(0.5)).toBeCloseTo(0.3)
    expect(damageGainDb(1)).toBeCloseTo(8.3)
    expect(damageGainDb(3)).toBeCloseTo(8.3)
    expect(damageGainDb(-1)).toBeCloseTo(-7.7)
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
