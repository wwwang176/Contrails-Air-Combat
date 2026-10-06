import { resetTurretLoad, stepTurretLoad, type TurretLoadState } from './turret-load'

/** Count only live shooters with live airborne targets. Called outside timing. */
export function turretCoverage(state: TurretLoadState): { total: number; targeted: number } {
  const cs = state.battle.world.combatants
  let total = 0, targeted = 0
  for (const c of cs) {
    total += c.aircraft.spec.turrets.length
    if (!c.alive || c.hp <= 0) continue
    for (const turret of c.turretStates) {
      const target = cs[turret.targetIndex]
      if (target !== undefined && target.alive && target.hp > 0) targeted++
    }
  }
  return { total, targeted }
}

/** Both the regression gate and standalone probe measure this same workload. */
export function measureTurretLoad(make: () => TurretLoadState) {
  const state = make()
  for (let i = 0; i < 300; i++) stepTurretLoad(state)
  resetTurretLoad(state)
  // Reset clears acquisition. Warm the reset fixture before starting the clock.
  for (let i = 0; i < 300; i++) stepTurretLoad(state)
  const expected = state.surrounded ? 160 : 0
  const checkCoverage = () => {
    const coverage = turretCoverage(state)
    if (coverage.total !== 160 || coverage.targeted !== expected) {
      throw new Error(`Invalid turret load: ${coverage.targeted}/${coverage.total} targets; expected ${expected}/160`)
    }
    return coverage
  }
  const coverage = checkCoverage()
  let best = Infinity
  for (let batch = 0; batch < 40; batch++) {
    const start = performance.now()
    for (let i = 0; i < 25; i++) stepTurretLoad(state)
    best = Math.min(best, ((performance.now() - start) * 1000) / 25)
    checkCoverage()
  }
  return { microseconds: best, ...coverage }
}
