import { afterEach, describe, expect, it } from 'vitest'
import {
  ANTIALIAS_LEVELS, DEFAULT_ANTIALIAS, DEFAULT_QUALITY, QUALITY_LEVELS, fieldInnerFor, pixelRatioFor,
  qualityAvailable, readQuality,
} from '../../src/render/quality'
import { zh } from '../../src/i18n/zh'

/**
 * 繪圖解析度的檔位。檔位是**絕對的 pixel ratio**，再夾到螢幕畫得到的上限。
 * 這裡守的是換算與上限的邊界，不是標籤長什麼樣。
 */
describe('畫質檔位', () => {
  /** 【沒設定過的玩家看到平衡】平衡是 pixel ratio 1 */
  it('預設是平衡那一檔，pixel ratio 1', () => {
    expect(DEFAULT_QUALITY).toBe(1)
    expect(QUALITY_LEVELS.find((lv) => lv.pixelRatio === DEFAULT_QUALITY)?.labelKey)
      .toBe('settings.quality.balanced')
  })

  /** 【由高到低】順序即按鈕順序；亂序的話選單看起來像壞了 */
  it('五個檔位由高到低', () => {
    expect(QUALITY_LEVELS.map((lv) => lv.pixelRatio)).toEqual([2, 1.5, 1, 0.75, 0.5])
    for (const lv of QUALITY_LEVELS) expect(zh[lv.labelKey].length).toBeGreaterThan(0)
  })

  it('不超過螢幕的 dpr 就照檔位畫', () => {
    expect(pixelRatioFor(1, 2)).toBe(1)
    expect(pixelRatioFor(0.5, 1)).toBe(0.5)
    expect(pixelRatioFor(1.5, 2)).toBe(1.5)
  })

  /** 【不超取樣】畫得比螢幕細只會更慢；4K 筆電的 dpr 可以到 3，上限仍是 2 */
  it('超過螢幕的 dpr 夾到螢幕，螢幕再夾到 2', () => {
    expect(pixelRatioFor(2, 1)).toBe(1)
    expect(pixelRatioFor(1.5, 1.25)).toBe(1.25)
    expect(pixelRatioFor(2, 3)).toBe(2)
  })

  /**
   * 【壞掉的輸入回到預設】0 像素的畫布是黑畫面，而且不會報錯。
   */
  it('零、負數、NaN 與無限大回到預設', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pixelRatioFor(bad, 2)).toBe(DEFAULT_QUALITY)
    }
  })

  /**
   * 【比下一檔多不出東西的檔位按不下去】dpr 1 的螢幕上，極致與清晰都會被夾回 1，
   * 跟平衡一模一樣；按下去畫面沒變，看起來像壞了。
   */
  it('dpr 1：極致與清晰按不下去，其餘可以', () => {
    expect(QUALITY_LEVELS.map((lv) => qualityAvailable(lv.pixelRatio, 1)))
      .toEqual([false, false, true, true, true])
  })

  /** 【夾過之後仍比下一檔高就算數】dpr 1.25 的清晰畫 1.25，比平衡的 1 細 */
  it('dpr 1.25：只有極致按不下去', () => {
    expect(QUALITY_LEVELS.map((lv) => qualityAvailable(lv.pixelRatio, 1.25)))
      .toEqual([false, true, true, true, true])
  })

  it('dpr 2 以上：五檔都可以', () => {
    for (const dpr of [2, 3]) {
      expect(QUALITY_LEVELS.every((lv) => qualityAvailable(lv.pixelRatio, dpr))).toBe(true)
    }
  })

  /**
   * 田色的內圈：前兩檔留一圈算式，其餘純貼圖。**查不到的檔位回到第一檔** ——
   * 手改過的存檔不該讓貼地的畫面變軟而沒有人選過。
   */
  it('前兩檔留內圈算式、其餘純貼圖，查不到的檔位回到第一檔', () => {
    expect(QUALITY_LEVELS.map((lv) => fieldInnerFor(lv.pixelRatio))).toEqual([500, 500, 0, 0, 0])
    expect(fieldInnerFor(0.7)).toBe(QUALITY_LEVELS[0]!.fieldInner)
  })

  /**
   * 抗鋸齒只有開與關：WebGL 不讓呼叫端指定樣本數，所以這一列不該長出第三個
   * 選項；預設是開。
   */
  it('抗鋸齒是兩個選項，預設開啟且排在第一顆', () => {
    expect(ANTIALIAS_LEVELS.map((lv) => lv.value)).toEqual([true, false])
    expect(DEFAULT_ANTIALIAS).toBe(true)
    expect(ANTIALIAS_LEVELS[0]!.value).toBe(DEFAULT_ANTIALIAS)
    for (const lv of ANTIALIAS_LEVELS) expect(zh[lv.labelKey].length).toBeGreaterThan(0)
  })
})

describe('readQuality', () => {
  const store = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  const saved = g['localStorage']
  afterEach(() => {
    store.clear()
    g['localStorage'] = saved
  })
  const useStore = () => {
    g['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
  }

  it('沒存過是預設', () => {
    useStore()
    expect(readQuality()).toBe(DEFAULT_QUALITY)
  })

  it('存的是五檔之一就照用', () => {
    useStore()
    for (const lv of QUALITY_LEVELS) {
      store.set('gfx.pixelRatio', String(lv.pixelRatio))
      expect(readQuality()).toBe(lv.pixelRatio)
    }
  })

  /** 【只認五個值】手改或壞掉的存檔回到預設，不是被夾成某個不在選單上的值 */
  it('不是五檔之一就回到預設', () => {
    useStore()
    for (const bad of ['0.7', '3', '', 'abc']) {
      store.set('gfx.pixelRatio', bad)
      expect(readQuality()).toBe(DEFAULT_QUALITY)
    }
  })

  it('localStorage 會拋時回到預設', () => {
    g['localStorage'] = { getItem: () => { throw new Error('blocked') } }
    expect(readQuality()).toBe(DEFAULT_QUALITY)
  })
})
