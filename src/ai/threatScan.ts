import type { Aircraft } from '../aircraft/Aircraft'
import { alarmFactor, type Situation } from './assess'
import type { TargetBoard } from './target'

/** Finds the strongest incoming threat and updates the caller's nearest range. */
export function scanThreat(
  board: Pick<TargetBoard, 'candidates'> | null,
  selfIndex: number,
  self: Aircraft,
  sit: Pick<Situation, 'range' | 'nearestRange'>,
): Aircraft | null {
  sit.nearestRange = sit.range
  if (board === null) return null
  const me = board.candidates[selfIndex]
  if (me === undefined) return null

  let best: Aircraft | null = null
  let bestValue = 0
  let nearest = Infinity
  const candidates = board.candidates
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    if (!candidate.alive || candidate.team === me.team) continue
    const distance = candidate.aircraft.state.position.distanceTo(self.state.position)
    if (distance < nearest) nearest = distance
    const value = alarmFactor(candidate.aircraft, self)
    if (value > bestValue) {
      bestValue = value
      best = candidate.aircraft
    }
  }
  if (nearest !== Infinity) sit.nearestRange = nearest
  return best
}
