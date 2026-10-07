import { describe, it, expect } from 'vitest'
import { burstDamageTo, createBursts, flakDamage, pushBurst } from '../../src/world/flak'

describe('burstDamageTo：一朵空爆傷到某一架多少', () => {
  it('敵方的砲：照距離線性衰減，與 flakDamage 相同', () => {
    const e = createBursts()
    pushBurst(e, 0, 1000, 0, 1, 30, 400)
    expect(burstDamageTo(e, 0, 0, 10, 1000, 0)).toBe(flakDamage(10, 30, 400))
    expect(burstDamageTo(e, 0, 0, 10, 1000, 0)).toBeGreaterThan(0)
  })

  it('同隊的砲不傷自己人', () => {
    const e = createBursts()
    pushBurst(e, 0, 1000, 0, 0, 30, 400)
    expect(burstDamageTo(e, 0, 0, 10, 1000, 0)).toBe(0)
  })

  it('半徑外是 0', () => {
    const e = createBursts()
    pushBurst(e, 0, 1000, 0, 1, 30, 400)
    expect(burstDamageTo(e, 0, 0, 31, 1000, 0)).toBe(0)
  })
})
