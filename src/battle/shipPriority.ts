import type { MissionTuning } from './mission'
import type { ShipClassId } from '../world/ships'
import type { Team } from '../world/team'

/** 小隊覆寫優先於陣營預設；明確指定 null 可讓該隊自由選船。 */
export function shipPriorityFor(
  tuning: Pick<MissionTuning, 'shipPriority'>,
  unit: { readonly team: Team; readonly priorityShipClass?: ShipClassId | null },
): ShipClassId | null {
  return unit.priorityShipClass !== undefined
    ? unit.priorityShipClass : tuning.shipPriority?.[unit.team] ?? null
}
