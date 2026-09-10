import { describe, expect, it } from 'vitest'
import {
  clearFlares, createFlares, FLARE_BURN, FLARE_CAPACITY, FLARE_DESCENT, FLARE_SWAY, spawnFlare, stepFlares,
} from '../../src/world/flares'

const DT = 1 / 240
const FLAT = () => 0

describe('照明彈池', () => {
  it('以 FLARE_DESCENT 下墜，橫向搖晃不超過 FLARE_SWAY', () => {
    const f = createFlares()
    spawnFlare(f, 100, 1200, -7000, 0.3)
    for (let i = 0; i < 60 * 240; i++) stepFlares(f, DT, FLAT)
    expect(f.y[0]).toBeCloseTo(1200 - FLARE_DESCENT * 60, 1)
    expect(Math.abs(f.x[0]! - 100)).toBeLessThanOrEqual(FLARE_SWAY + 1e-3)
    expect(Math.abs(f.z[0]! + 7000)).toBeLessThanOrEqual(FLARE_SWAY + 1e-3)
    expect(f.live[0]).toBe(1)
  })

  it('燒滿 FLARE_BURN 秒就熄', () => {
    const f = createFlares()
    spawnFlare(f, 0, 1200, 0, 0)
    for (let i = 0; i < FLARE_BURN * 240 - 1; i++) stepFlares(f, DT, FLAT)
    expect(f.live[0]).toBe(1)
    stepFlares(f, DT, FLAT)
    stepFlares(f, DT, FLAT)
    expect(f.live[0]).toBe(0)
    expect(f.count).toBe(0)
  })

  it('延遲點燃：時間到之前掛在原點、不亮、不下墜', () => {
    const f = createFlares()
    spawnFlare(f, 0, 1200, 0, 0, 10)
    for (let i = 0; i < 9 * 240; i++) stepFlares(f, DT, FLAT)
    expect(f.age[0]).toBeLessThan(0)
    expect(f.y[0]).toBe(1200)
    expect(f.x[0]).toBe(0)
    for (let i = 0; i < 2 * 240; i++) stepFlares(f, DT, FLAT)
    expect(f.age[0]).toBeCloseTo(1, 6)
    expect(f.y[0]).toBeCloseTo(1200 - FLARE_DESCENT, 3)
  })

  it('落到地面就熄', () => {
    const f = createFlares()
    spawnFlare(f, 0, 5, 0, 0)
    for (let i = 0; i < 3 * 240; i++) stepFlares(f, DT, () => 2)
    expect(f.live[0]).toBe(0)
  })

  it('滿了拒絕、清池之後又收', () => {
    const f = createFlares()
    for (let i = 0; i < FLARE_CAPACITY; i++) expect(spawnFlare(f, 0, 1000, 0, 0)).toBe(i)
    expect(spawnFlare(f, 0, 1000, 0, 0)).toBe(-1)
    clearFlares(f)
    expect(f.count).toBe(0)
    expect(spawnFlare(f, 0, 1000, 0, 0)).toBe(0)
  })

  it('同一個相位兩次逐位元相同、不同相位不同位置 —— 搖晃是確定性的而且吃相位', () => {
    const a = createFlares()
    const b = createFlares()
    spawnFlare(a, 0, 1000, 0, 1.7)
    spawnFlare(b, 0, 1000, 0, 1.7)
    spawnFlare(b, 0, 1000, 0, 2.9)
    for (let i = 0; i < 5 * 240; i++) {
      stepFlares(a, DT, FLAT)
      stepFlares(b, DT, FLAT)
    }
    expect(a.x[0]).toBe(b.x[0])
    expect(a.z[0]).toBe(b.z[0])
    // 【相位真的有用】忽略相位的實作會讓六枚同步搖
    expect(b.x[1]).not.toBe(b.x[0])
  })
})
