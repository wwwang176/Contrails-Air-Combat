import type { Combatant } from '../../src/world/World'

/** 初速微擾 ±0.5%；salt=0 保留對照組，同一 (salt, index) 永遠產生相同擾動。 */
export function jitterInitialVelocity(combatants: readonly Combatant[], salt: number): void {
  if (salt === 0) return
  for (const c of combatants) {
    let h = (salt ^ (c.index * 0x9e3779b1)) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    c.aircraft.state.velocity.multiplyScalar(1 + ((h >>> 8) / 0xffffff - 0.5) * 0.01)
  }
}
