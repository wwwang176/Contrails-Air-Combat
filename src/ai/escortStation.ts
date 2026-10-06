import type { Aircraft } from '../aircraft/Aircraft'
import type { StationOffset } from './station'
import type { TargetBoard } from './target'

/** Stable offsets keep the two escort positions from overlapping. */
export const ESCORT_OFFSETS: readonly StationOffset[] = [
  { along: -150, across: 350, up: 450 },
  { along: -150, across: -350, up: 450 },
]

/** Selects the nearest living friendly bomber without allocating on the AI path. */
export function selectEscortIndex(
  self: Aircraft,
  candidates: TargetBoard['candidates'],
  selfIndex: number,
  current: number,
  decide: boolean,
): number {
  const me = candidates[selfIndex]
  if (!decide && current >= 0 && candidates[current]!.alive) return current

  let best = -1
  let bestDistance = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    if (!candidate.alive || candidate.team !== me!.team || candidate.aircraft.spec.role !== 'bomber') continue
    const distance = self.state.position.distanceToSquared(candidate.aircraft.state.position)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}
