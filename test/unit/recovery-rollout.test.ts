import { describe, expect, it } from 'vitest'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import {
  RECOVERY_V2_COEFFS, predictRecoveryRollout, setupAircraft, simulateTrial,
  type ModelParams, type Scenario,
} from '../../src/tools/recoveryModel'

const params: ModelParams = { ...RECOVERY_V2_COEFFS, latch: true, margin: 100 }

describe('物理預演改出', () => {
  it('預演不修改來源飛機', () => {
    const source = setupAircraft({
      spec: P51D, ground: 0, agl: 600, tas: 120, gammaDeg: -60,
      bankDeg: 90, rollRateDeg: 0, load: 1, intent: 'strafe',
    })
    const before = {
      position: source.state.position.clone(),
      velocity: source.state.velocity.clone(),
      orientation: source.state.orientation.clone(),
      angularVelocity: source.state.angularVelocity.clone(),
    }

    const result = predictRecoveryRollout(source, 'velocity', 20, 1 / 60)

    expect(result.recovered).toBe(true)
    expect(result.seconds).toBeGreaterThan(0)
    expect(source.state.position.equals(before.position)).toBe(true)
    expect(source.state.velocity.equals(before.velocity)).toBe(true)
    expect(source.state.orientation.equals(before.orientation)).toBe(true)
    expect(source.state.angularVelocity.equals(before.angularVelocity)).toBe(true)
  })

  it('展示用慢路徑會讓倒飛俯衝的 B-17 提前接管並止跌', () => {
    const scenario: Scenario = {
      spec: B17G, ground: 0, agl: 1200, tas: 115, gammaDeg: -75,
      bankDeg: 180, rollRateDeg: 0, load: 1, intent: 'strafe',
    }
    const result = simulateTrial(scenario, 'rollout', params, 20, true)

    expect(Number.isFinite(result.triggerT)).toBe(true)
    expect(result.crashed).toBe(false)
    expect(result.minAgl).toBeGreaterThan(0)
  })
})
