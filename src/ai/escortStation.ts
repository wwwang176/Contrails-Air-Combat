import type { Aircraft } from '../aircraft/Aircraft'
import type { StationOffset } from './station'
import type { TargetBoard } from './target'

/** 固定的偏移，兩個護航站位才不會重疊 */
export const ESCORT_OFFSETS: readonly StationOffset[] = [
  { along: -150, across: 350, up: 450 },
  { along: -150, across: -350, up: 450 },
]

/** 選最近的一架活著的友軍轟炸機。AI 路徑上，不配置記憶體 */
export function selectEscortIndex(
  self: { readonly state: Pick<Aircraft['state'], 'position'> },
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
