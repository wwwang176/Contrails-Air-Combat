import { describe, it, expect } from 'vitest'
import { extendPitchAngle, DEFAULT_STEER } from '../../src/ai/steer'

/**
 * `extend` 的俯仰**方向**。
 *
 * 【現行契約】`extendPitchAngle(cornerRatio, altitudeAdvantage, clearance)`：
 * 俯衝項只看自己的速度赤字（`1 − cornerRatio` 的下半邊）；爬升項只有兩個
 * 來源 —— 離地餘裕（安全）與「敵人在上方」（`altitudeAdvantage < 0`，公尺，
 * 見 `Situation.altitudeAdvantage`），而後者被「速度先於高度」的閘門
 * `smoothstep(1, unloadMargin, cornerRatio)` 押住：沒有機動速度就不准把
 * 僅剩的動能拿去換一個守不住的位置。
 *
 * 【速度過剩不再構成爬升的理由】前一版把速度盈餘直接存成高度，護送實測
 * 裡每一架遠離戰鬥的機都因此在爬（遠距離沒人拉桿，TAS 天然貼近極速）；
 * 之後的「相對敵人 TAS」版本又在敵人位於前上方時抵成平飛直飛 10 km
 * （見 `steer.ts` 該閘門的註解）。爬升的戰術理由現在只有一個：敵人在
 * 我上方，而且我有速度爬。
 *
 * 【檔名為什麼不叫 `extend-pitch`】`test/tools/extend-pitch.probe.ts` 已經
 * 存在，同名會讓「哪一個是護欄、哪一個是量測」變得要看目錄才分得出來。
 */
describe('extend 的俯仰方向', () => {
  /** 高空，讓離地餘裕那一項恆為 0，才量得到純粹的戰術項 */
  const HIGH = 4000
  /** 沒有目標：高度項不表示意見（實作以 Number.isFinite 判） */
  const NO_TARGET = Infinity

  it('速度赤字恆為低頭 —— 敵人在頭頂上也一樣（速度先於高度）', () => {
    for (const alt of [NO_TARGET, 0, -500, -2000]) {
      expect(extendPitchAngle(0.6, alt, HIGH)).toBeLessThan(0)
    }
  })

  it('速度過剩本身不爬升 —— 爬升的唯一戰術理由是敵人在上方', () => {
    expect(extendPitchAngle(1.4, NO_TARGET, HIGH)).toBeCloseTo(0, 9)
    expect(extendPitchAngle(1.4, 0, HIGH)).toBeCloseTo(0, 9)
    // 敵人在下方：更不需要爬
    expect(extendPitchAngle(1.4, 800, HIGH)).toBeCloseTo(0, 9)
    // 敵人在上方：爬
    expect(extendPitchAngle(1.4, -800, HIGH)).toBeGreaterThan(0)
  })

  it('速度閘門：cornerRatio 掉到 1，往敵人高度的爬升被完全押住', () => {
    expect(extendPitchAngle(1.0, -800, HIGH)).toBeCloseTo(0, 9)
    expect(extendPitchAngle(0.99, -800, HIGH)).toBeLessThan(0)
  })

  it('閘門是斜坡不是門檻：1 → unloadMargin 之間單調爬出來', () => {
    // 裸門檻在線上會翻號，而飛機有俯仰慣性 —— 與這個函式的其他項同一條理由
    let prev = -Infinity
    for (let r = 1.0; r <= DEFAULT_STEER.unloadMargin + 1e-9; r += 0.01) {
      const got = extendPitchAngle(r, -800, HIGH)
      expect(got).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = got
    }
  })

  it('對高度差單調：敵人越高越傾向爬升', () => {
    let prev = Infinity
    for (let alt = -1200; alt <= 1200.1; alt += 100) {
      const got = extendPitchAngle(1.3, alt, HIGH)
      expect(got).toBeLessThanOrEqual(prev + 1e-12)
      prev = got
    }
  })

  it('對 cornerRatio 單調不遞減', () => {
    // 越有速度越敢爬。反過來會是災難。
    let prev = -Infinity
    for (let r = 0.4; r <= 2.0001; r += 0.05) {
      const got = extendPitchAngle(r, -800, HIGH)
      expect(got).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = got
    }
  })

  it('離地餘裕那一項一個字都沒動', () => {
    // 【為什麼要釘住】那一項是安全關切（低空不能用高度換速度），與戰術判斷
    // 在不同的軸上。歷次改的都只有戰術項。
    const high = extendPitchAngle(0.6, NO_TARGET, HIGH)
    const low = extendPitchAngle(0.6, NO_TARGET, DEFAULT_STEER.clearanceScale * 0.4)
    expect(low).toBeGreaterThan(high)
    // 貼地時高度項主導，即使缺速度也要爬
    expect(extendPitchAngle(0.6, NO_TARGET, 0)).toBeGreaterThan(0)
  })

  it('兩端都夾在 extendPitch', () => {
    expect(extendPitchAngle(-5, NO_TARGET, HIGH)).toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
    // 爬升端要閘門全開（cornerRatio ≥ unloadMargin）加巨大的高度劣勢
    expect(extendPitchAngle(5, -1e6, HIGH)).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
  })

  it('沒有目標時只剩速度項與離地項', () => {
    expect(extendPitchAngle(0.6, NO_TARGET, HIGH)).toBeLessThan(0)
    expect(extendPitchAngle(1.0, NO_TARGET, HIGH)).toBeCloseTo(0, 9)
    expect(extendPitchAngle(1.3, NO_TARGET, HIGH)).toBeCloseTo(0, 9)
  })
})
