import { describe, expect, it } from 'vitest'
import {
  ANTIALIAS_LEVELS, DEFAULT_ANTIALIAS, DEFAULT_QUALITY, QUALITY_LEVELS, fieldInnerFor, pixelRatioFor,
} from '../../src/render/quality'

/**
 * 繪圖解析度的檔位。**只有換算那一支是邏輯**，其餘是資料 —— 所以這裡守的是
 * 換算的邊界，不是三個標籤長什麼樣。
 */
describe('畫質檔位', () => {
  /** 【沒設定過的玩家看到平衡】預設是清單裡標為平衡的那一檔 */
  it('預設是平衡那一檔', () => {
    expect(QUALITY_LEVELS.find((lv) => lv.scale === DEFAULT_QUALITY)?.label).toBe('平衡')
  })

  it('原生那一檔照 dpr，上限沿用既有的 2', () => {
    expect(pixelRatioFor(1, 1.5)).toBe(1.5)
    expect(pixelRatioFor(1, 1)).toBe(1)
    // 4K 筆電的 dpr 可以到 3；全開會讓像素數多出一倍以上
    expect(pixelRatioFor(1, 3)).toBe(2)
  })

  /** 檔位是「原生的幾成」，所以同一檔在不同螢幕上是同一件事 */
  it('檔位按原生比例縮放', () => {
    expect(pixelRatioFor(0.8, 1.5)).toBeCloseTo(1.2, 10)
    expect(pixelRatioFor(0.65, 2)).toBeCloseTo(1.3, 10)
    expect(pixelRatioFor(0.65, 3)).toBeCloseTo(1.3, 10)
  })

  /**
   * 【壞掉的輸入要回到預設】存進瀏覽器的值可能被手改、也可能是舊版留下的。
   * 回到預設比畫出一張 0 像素的畫布好 —— 後者是黑畫面，而且不會報錯。
   */
  it('超過 1 夾到原生；零、負數、NaN 與無限大回到預設', () => {
    for (const over of [1.5, 2]) expect(pixelRatioFor(over, 1.5)).toBe(1.5)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pixelRatioFor(bad, 1.5)).toBe(pixelRatioFor(DEFAULT_QUALITY, 1.5))
    }
  })

  /**
   * 田色的內圈：清晰留一圈算式，其餘純貼圖。**查不到的檔位回到清晰** ——
   * 手改過的存檔不該讓貼地的畫面變軟而沒有人選過。
   */
  it('清晰留內圈算式、平衡與流暢純貼圖，查不到的檔位回到清晰', () => {
    expect(fieldInnerFor(1)).toBe(500)
    expect(fieldInnerFor(0.8)).toBe(0)
    expect(fieldInnerFor(0.65)).toBe(0)
    expect(fieldInnerFor(0.7)).toBe(QUALITY_LEVELS[0]!.fieldInner)
    for (const lv of QUALITY_LEVELS) expect(lv.fieldInner).toBeGreaterThanOrEqual(0)
  })

  /** 【由清晰到流暢】順序即按鈕順序；亂序的話選單看起來像壞了 */
  it('三個檔位遞減，且都落在 (0, 1]', () => {
    expect(QUALITY_LEVELS.length).toBeGreaterThanOrEqual(2)
    for (const lv of QUALITY_LEVELS) {
      expect(lv.scale).toBeGreaterThan(0)
      expect(lv.scale).toBeLessThanOrEqual(1)
      expect(lv.label.length).toBeGreaterThan(0)
    }
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      expect(QUALITY_LEVELS[i]!.scale).toBeLessThan(QUALITY_LEVELS[i - 1]!.scale)
    }
  })

  /**
   * 【抗鋸齒只有開與關】WebGL 不讓呼叫端指定樣本數，所以這一列不該長出第三個
   * 選項；預設是開。
   */
  it('抗鋸齒是兩個選項，預設開啟且排在第一顆', () => {
    expect(ANTIALIAS_LEVELS.map((lv) => lv.value)).toEqual([true, false])
    expect(DEFAULT_ANTIALIAS).toBe(true)
    expect(ANTIALIAS_LEVELS[0]!.value).toBe(DEFAULT_ANTIALIAS)
    for (const lv of ANTIALIAS_LEVELS) expect(lv.label.length).toBeGreaterThan(0)
  })
})
