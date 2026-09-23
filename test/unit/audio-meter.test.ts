import { describe, it, expect } from 'vitest'
import {
  METER_FLOOR_DB, METER_SLOTS, MeterHistory, audioLag, meterFraction, toDb,
} from '../../src/audio/meter'

/**
 * 音訊錶的資料。畫圖沒有測試（那要真的畫布），這裡守的是刻度與環狀緩衝 ——
 * 錶讀錯的話會把「限幅器在狂壓」畫成「一切正常」。
 */

describe('刻度', () => {
  it('線性增益轉 dB，0 與負數夾在下緣', () => {
    expect(toDb(1)).toBeCloseTo(0, 9)
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2)
    expect(toDb(0)).toBe(METER_FLOOR_DB)
    expect(toDb(-1)).toBe(METER_FLOOR_DB)
  })

  it('比下緣還小的夾在下緣', () => {
    expect(toDb(1e-9)).toBe(METER_FLOOR_DB)
  })

  it('dB 轉比例：0 dB 是滿的、下緣是空的，超出範圍夾住', () => {
    expect(meterFraction(0)).toBe(1)
    expect(meterFraction(METER_FLOOR_DB)).toBe(0)
    expect(meterFraction(METER_FLOOR_DB / 2)).toBeCloseTo(0.5, 9)
    expect(meterFraction(6)).toBe(1)
    expect(meterFraction(-120)).toBe(0)
  })
})

describe('歷史', () => {
  it('沒推過時沒有格子', () => {
    const h = new MeterHistory()
    expect(h.count).toBe(0)
    expect(h.indexOf(0)).toBe(-1)
  })

  it('推進去的順序是最舊到最新', () => {
    const h = new MeterHistory()
    for (const v of [-10, -20, -30]) h.push(v, 0)
    expect(h.count).toBe(3)
    expect(h.peak[h.indexOf(0)]).toBe(-10)
    expect(h.peak[h.indexOf(2)]).toBe(-30)
  })

  /** 【滿了就蓋最舊的】不然曲線會停在六秒前不動 */
  it('滿了之後只留最近的 METER_SLOTS 格', () => {
    const h = new MeterHistory()
    for (let i = 0; i < METER_SLOTS + 10; i++) h.push(-i, 0)
    expect(h.count).toBe(METER_SLOTS)
    expect(h.peak[h.indexOf(0)]).toBe(-10)
    expect(h.peak[h.indexOf(METER_SLOTS - 1)]).toBe(-(METER_SLOTS + 9))
    expect(h.indexOf(METER_SLOTS)).toBe(-1)
  })

  it('清掉之後回到沒有格子', () => {
    const h = new MeterHistory()
    h.push(-5, -3)
    h.clear()
    expect(h.count).toBe(0)
  })
})

/**
 * 【落後量】音訊執行緒算不完時音訊時鐘走得比牆上時鐘慢。算錯方向的話，
 * 劈啪聲最嚴重的時候錶上反而是 0。
 */
describe('音訊時鐘落後量', () => {
  it('兩個時鐘同速時是 0', () => {
    expect(audioLag(12, 7, 2, -3)).toBe(0)
  })

  it('音訊時鐘少走的就是落後量', () => {
    expect(audioLag(12, 6.5, 2, -3)).toBeCloseTo(0.5, 9)
  })

  /** 音訊時鐘一次跳一整塊緩衝，剛跳完會比牆上時鐘快一點 —— 那不是落後 */
  it('音訊時鐘跑在前面時夾成 0', () => {
    expect(audioLag(12, 7.01, 2, -3)).toBe(0)
  })
})
