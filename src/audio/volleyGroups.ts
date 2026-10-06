import type { Combatant } from '../world/combatant'
import { ownTurretVolleyPools, volleyPool, type Pool } from './catalog'

export interface VolleyGroup {
  readonly mount: number
  readonly turret: number
  readonly pool: Pool
  readonly db: number
}

/** 依武器種類建立自機齊射群組；只在換機或重建武裝時呼叫。 */
export function buildVolleyGroups(
  player: Combatant, maxGroups = 8, turretDb = -0.5,
): { readonly groups: VolleyGroup[]; readonly ownTurretVolley: boolean } {
  const groups: VolleyGroup[] = []
  const mounts = player.aircraft.spec.battery.mounts
  const seen = new Map<string, number>()
  for (let i = 0; i < mounts.length; i++) {
    const id = mounts[i]!.weapon.id
    if (seen.has(id)) continue
    seen.set(id, i)
    let guns = 0
    for (const m of mounts) if (m.weapon.id === id) guns++
    const pool = volleyPool(id, guns)
    if (pool !== null && groups.length < maxGroups) groups.push({ mount: i, turret: -1, pool, db: 0 })
  }
  const rear = ownTurretVolleyPools(player.aircraft.spec.turrets)
  if (rear === null) return { groups, ownTurretVolley: false }
  for (let i = 0; i < rear.length && groups.length < maxGroups; i++) {
    groups.push({ mount: -1, turret: i, pool: rear[i]!, db: turretDb })
  }
  return { groups, ownTurretVolley: true }
}
