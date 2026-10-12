import type { ShipClassId } from '../world/ships'
import { FLETCHER_GUN_GROUPS, FLETCHER_GUN_MOUNTS, type ShipGunMount } from './shipGunMounts'
import { WICHITA_GUN_GROUPS, WICHITA_GUN_MOUNTS } from './wichitaGunMounts'
import { ESSEX_GUN_GROUPS, ESSEX_GUN_MOUNTS } from './essexGunMounts'

interface ShipGunLayout {
  readonly mesh: string
  readonly mounts: Readonly<Record<string, ShipGunMount>>
  readonly groups: Readonly<Record<string, readonly ShipGunMount[]>>
}

/** Only layouts with measured physical emitters replace the legacy battery flash. */
export const SHIP_GUN_LAYOUTS: Readonly<Partial<Record<ShipClassId, ShipGunLayout>>> = {
  fletcher: { mesh: 'FLETCHER_Guns', mounts: FLETCHER_GUN_MOUNTS, groups: FLETCHER_GUN_GROUPS },
  wichita: { mesh: 'WICHITA_Guns', mounts: WICHITA_GUN_MOUNTS, groups: WICHITA_GUN_GROUPS },
  essex: { mesh: 'ESSEX_Guns', mounts: ESSEX_GUN_MOUNTS, groups: ESSEX_GUN_GROUPS },
}
