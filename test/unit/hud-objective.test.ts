import { describe, it, expect } from 'vitest'
import {
  BANNER_HOLD_SECONDS, BANNER_SLIDE_SECONDS, bannerLayout, formatCountdown, formatObjectiveMetric,
} from '../../src/hud/widgets/objective'

describe('formatObjectiveMetric', () => {
  it('count 就是整數', () => {
    expect(formatObjectiveMetric(12, 'count')).toBe('12')
    expect(formatObjectiveMetric(0, 'count')).toBe('0')
  })

  /**
   * 【分子是已達成數】`metric` 是「還差幾艘」，玩家要看的是「打掉幾艘」。
   * 印錯邊的話開局就顯示 (4/4) —— 那是達標的樣子。
   */
  it('有分母就印進度，分子是已達成數', () => {
    expect(formatObjectiveMetric(4, 'count', 4)).toBe('(0/4)')
    expect(formatObjectiveMetric(2, 'count', 4)).toBe('(2/4)')
    expect(formatObjectiveMetric(0, 'count', 4)).toBe('(4/4)')
  })

  it('沒有分母（−1）維持裸數字', () => {
    expect(formatObjectiveMetric(7, 'count', -1)).toBe('7')
  })

  it('distance 在 1 km 以上用公里、一位小數', () => {
    expect(formatObjectiveMetric(18400, 'distance')).toBe('18.4 km')
    expect(formatObjectiveMetric(1000, 'distance')).toBe('1.0 km')
  })

  /**
   * 【為什麼最後 1 km 換單位】那是最緊張的一段，而「0.9 km」這個數字每兩秒
   * 才動一次小數點。換成公尺之後它每一幀都在跳 —— 那正是玩家要的回饋。
   */
  it('distance 在 1 km 以下用公尺、整數', () => {
    expect(formatObjectiveMetric(940, 'distance')).toBe('940 m')
    expect(formatObjectiveMetric(12.4, 'distance')).toBe('12 m')
  })

  /**
   * 【為什麼非有限值印破折號而不是 0】0 在殲滅那一側的意思是「贏了」。
   * 讓一個壞掉的數字長得像勝利，是最糟的失敗模式。
   */
  it('負數夾到 0，NaN 與 Infinity 印破折號', () => {
    expect(formatObjectiveMetric(-5, 'count')).toBe('0')
    expect(formatObjectiveMetric(-5, 'distance')).toBe('0 m')
    expect(formatObjectiveMetric(NaN, 'distance')).toBe('—')
    expect(formatObjectiveMetric(Infinity, 'count')).toBe('—')
  })
})

describe('formatCountdown', () => {
  it('分:秒，秒補零', () => {
    expect(formatCountdown(125)).toBe('2:05')
    expect(formatCountdown(240)).toBe('4:00')
    expect(formatCountdown(59)).toBe('0:59')
  })

  /**
   * 【為什麼用 ceil】倒數顯示 0 的那一刻應該是真的到了。`floor` 會讓玩家
   * 看著 0 又飛了將近一秒。
   */
  it('小數往上取 —— 顯示 0 就是真的到了', () => {
    expect(formatCountdown(0.1)).toBe('0:01')
    expect(formatCountdown(59.9)).toBe('1:00')
  })

  it('歸零之後不顯示負數', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-3)).toBe('0:00')
  })

  it('Infinity 與 NaN 回空字串 —— 無時限時不畫倒數', () => {
    expect(formatCountdown(Infinity)).toBe('')
    expect(formatCountdown(NaN)).toBe('')
  })
})

describe('formatObjectiveMetric：percent', () => {
  /** 守住艦隊印的是要害艦的血量比例，玩家要看的是「還剩幾成」 */
  it('0～1 的比例印成整數百分比', () => {
    expect(formatObjectiveMetric(0.734, 'percent')).toBe('73%')
    expect(formatObjectiveMetric(1, 'percent')).toBe('100%')
    expect(formatObjectiveMetric(0, 'percent')).toBe('0%')
    expect(formatObjectiveMetric(-0.2, 'percent')).toBe('0%')
  })
})

describe('目標橫幅的時序', () => {
  /**
   * 【進場先在畫面中央停 3 秒，再半秒滑進右上角】玩家一進地圖要先看懂
   * 這一關要做什麼；停完滑進目標列，之後目標列照常畫。年齡 −1 = 沒有橫幅
   */
  it('前 3 秒停在中央、接著半秒滑動、然後結束', () => {
    expect(bannerLayout(-1).phase).toBe('done')
    expect(bannerLayout(0)).toEqual({ phase: 'hold', k: 0 })
    expect(bannerLayout(BANNER_HOLD_SECONDS - 0.01).phase).toBe('hold')
    const mid = bannerLayout(BANNER_HOLD_SECONDS + BANNER_SLIDE_SECONDS / 2)
    expect(mid.phase).toBe('slide')
    expect(mid.k).toBeGreaterThan(0)
    expect(mid.k).toBeLessThan(1)
    expect(bannerLayout(BANNER_HOLD_SECONDS + BANNER_SLIDE_SECONDS).phase).toBe('done')
  })

  it('滑動的進度單調遞增', () => {
    let last = -1
    for (let i = 0; i <= 10; i++) {
      const k = bannerLayout(BANNER_HOLD_SECONDS + (BANNER_SLIDE_SECONDS * i) / 10).k
      expect(k).toBeGreaterThanOrEqual(last)
      last = k
    }
  })
})
