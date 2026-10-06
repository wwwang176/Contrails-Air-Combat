import { describe, expect, it } from 'vitest'
import { createTurretSearchLoad, createTurretTrackLoad, resetTurretLoad, stepTurretLoad } from '../../bench/turret-load'
import { turretCoverage } from '../../bench/turret-measure'

describe('turret performance fixture coverage', () => {
  it.each([
    ['search', createTurretSearchLoad, 0],
    ['track', createTurretTrackLoad, 160],
  ] as const)('%s preserves the claimed load across every measured step and reset', (_name, make, expected) => {
    const state = make()
    for (let round = 0; round < 2; round++) {
      if (round > 0) resetTurretLoad(state)
      for (let i = 0; i < 300; i++) stepTurretLoad(state)
      for (let i = 0; i < 1000; i++) {
        stepTurretLoad(state)
        expect(turretCoverage(state)).toEqual({ total: 160, targeted: expected })
      }
    }
  }, 30_000)

  it('does not count dead shooters as active tracking work', () => {
    const state = createTurretTrackLoad()
    for (let i = 0; i < 300; i++) stepTurretLoad(state)
    expect(turretCoverage(state)).toEqual({ total: 160, targeted: 160 })
    const bomber = state.battle.world.combatants.find(c => c.aircraft.spec.turrets.length > 0)!
    bomber.hp = 0
    expect(turretCoverage(state)).toEqual({ total: 160, targeted: 152 })
  })
})
