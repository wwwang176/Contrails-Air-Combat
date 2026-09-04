import { describe, it, expect } from 'vitest'
import {
  FLAK_DAMAGE, FLAK_RADIUS, clearBursts, clearFlak, createBursts, createFlak,
  flakDamage, spawnFlak, stepFlak,
} from '../../src/world/flak'

describe('flakDamage', () => {
  it('爆心最痛、邊界為零、線性衰減', () => {
    expect(flakDamage(0)).toBe(FLAK_DAMAGE)
    expect(flakDamage(FLAK_RADIUS)).toBe(0)
    expect(flakDamage(FLAK_RADIUS / 2)).toBeCloseTo(FLAK_DAMAGE / 2, 6)
  })

  /** 【半徑外是 0 不是負數】不擋的話遠方的飛機會被「治療」。 */
  it('半徑外是 0，不是負的', () => {
    expect(flakDamage(FLAK_RADIUS * 3)).toBe(0)
    expect(flakDamage(FLAK_RADIUS + 0.001)).toBe(0)
  })
})

/**
 * 【dt 用 1/256 而不是 1/100】0.01 在二進位裡不精確，連減 100 次之後引信會
 * 停在 1.4e-17 而不是 0 —— 引爆晚一步。1/256 是二進位精確值，每一次相減都
 * 沒有誤差，所以「第幾步引爆」問得出精確答案。
 */
const DT = 1 / 256

describe('stepFlak', () => {
  it('引信到期才引爆，引爆點就是那一刻的位置', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 100, 0, 0, 1, 1)
    for (let i = 0; i < 255; i++) stepFlak(f, DT, out)
    expect(out.count).toBe(0)
    expect(f.live).toBe(1)
    stepFlak(f, DT, out)
    expect(out.count).toBe(1)
    expect(out.x[0]).toBeCloseTo(100, 3)
    expect(out.team[0]).toBe(1)
    expect(f.live).toBe(0)
  })

  it('引爆之後槽位釋放，同一發不會爆第二次', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 0, 0, 0, 0.5, 0)
    for (let i = 0; i < 512; i++) stepFlak(f, DT, out)
    expect(out.count).toBe(1)
  })

  it('多發各自照自己的引信引爆', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 0, 0, 0, 0.5, 0)
    spawnFlak(f, 0, 0, 0, 0, 0, 0, 1.5, 1)
    for (let i = 0; i < 128; i++) stepFlak(f, DT, out)
    expect(out.count).toBe(1)
    for (let i = 0; i < 256; i++) stepFlak(f, DT, out)
    expect(out.count).toBe(2)
    expect(out.team[0]).toBe(0)
    expect(out.team[1]).toBe(1)
  })

  it('clearFlak 之後池是空的', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 0, 0, 0, 5, 0)
    clearFlak(f)
    expect(f.live).toBe(0)
    for (let i = 0; i < 1000; i++) stepFlak(f, DT, out)
    expect(out.count).toBe(0)
  })

  /**
   * 【事件滿了就丟，不擴容】與 `world/events.ts` 的 `ImpactEvents` 同一個
   * 約定：呼叫端負責排空。headless 測試不排空，於是它會填滿 —— 那沒有問題，
   * 但**必須有 `dropped` 讓有排空的測試斷言得到**。
   */
  it('事件緩衝滿了就丟棄並記數，不會覆寫已有的', () => {
    const f = createFlak()
    const out = createBursts(2)
    for (let i = 0; i < 5; i++) spawnFlak(f, i, 0, 0, 0, 0, 0, 0.5, 0)
    for (let i = 0; i < 128; i++) stepFlak(f, DT, out)
    expect(out.count).toBe(2)
    expect(out.dropped).toBe(3)
    clearBursts(out)
    expect(out.count).toBe(0)
    expect(out.dropped).toBe(0)
  })
})
