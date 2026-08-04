import { describe, it, expect } from 'vitest'
import {
  createImpacts, pushImpact, clearImpacts,
  IMPACT_CAPACITY, IMPACT_STRIDE,
} from '../../src/world/events'

describe('ImpactEvents（M7 spec §2.2）', () => {
  it('建立時是空的，容量預配', () => {
    const e = createImpacts()
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(0)
    expect(e.capacity).toBe(IMPACT_CAPACITY)
    expect(e.data.length).toBe(IMPACT_CAPACITY * IMPACT_STRIDE)
  })

  it('推入的六個分量照 stride 排好', () => {
    const e = createImpacts(4)
    pushImpact(e, 1, 2, 3, 0, 1, 0)
    pushImpact(e, 4, 5, 6, 1, 0, 0)
    expect(e.count).toBe(2)
    expect(Array.from(e.data.subarray(0, 12)))
      .toEqual([1, 2, 3, 0, 1, 0, 4, 5, 6, 1, 0, 0])
  })

  it('滿了就丟棄並計數，不會越界寫', () => {
    // 【為什麼是丟棄而不是擴容】這是熱路徑上的緩衝，擴容就是配置。
    // 而它裝的是純裝飾的東西 —— 掉幾顆火花沒有人看得出來，但一次
    // 意外的配置會出現在每一步。
    const e = createImpacts(2)
    pushImpact(e, 1, 0, 0, 0, 1, 0)
    pushImpact(e, 2, 0, 0, 0, 1, 0)
    pushImpact(e, 3, 0, 0, 0, 1, 0)
    expect(e.count).toBe(2)
    expect(e.dropped).toBe(1)
    expect(e.data[0]).toBe(1)
    expect(e.data[6]).toBe(2)
  })

  it('clearImpacts 只清 count，不清 dropped', () => {
    // 【為什麼 dropped 是累計的】它是給整合測試斷言「從未溢位」用的。
    // 每次排空都歸零的話，溢位會在下一次排空時被抹掉而永遠測不到。
    const e = createImpacts(1)
    pushImpact(e, 1, 0, 0, 0, 1, 0)
    pushImpact(e, 2, 0, 0, 0, 1, 0)
    clearImpacts(e)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(1)
  })

  it('清空後可以再用，不會殘留上一批', () => {
    const e = createImpacts(4)
    pushImpact(e, 9, 9, 9, 0, 1, 0)
    clearImpacts(e)
    pushImpact(e, 1, 2, 3, 1, 0, 0)
    expect(e.count).toBe(1)
    expect(Array.from(e.data.subarray(0, 6))).toEqual([1, 2, 3, 1, 0, 0])
  })

  it('預設容量 64 的推導 —— 一個子步綽綽有餘', () => {
    // 40 架全開火是 2,434 發/s；全部命中（不可能）在 60 fps 下是 41 次/幀，
    // 除以 8 個子步約 6 次/子步。64 是它的 10 倍。
    expect(IMPACT_CAPACITY).toBe(64)
    expect(IMPACT_STRIDE).toBe(6)
  })
})
