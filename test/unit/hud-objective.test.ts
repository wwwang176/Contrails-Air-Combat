import { describe, it, expect } from 'vitest'
import { formatCountdown, formatObjectiveMetric } from '../../src/hud/widgets/objective'

describe('formatObjectiveMetric', () => {
  it('count 就是整數', () => {
    expect(formatObjectiveMetric(12, 'count')).toBe('12')
    expect(formatObjectiveMetric(0, 'count')).toBe('0')
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
