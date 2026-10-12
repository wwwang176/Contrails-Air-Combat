import { Vector3 } from 'three'
import type { GunMount } from '../weapons/gunMount'
import type { GroundUnitId } from './ground'

/** Model-space pivots/tips measured from the GLBs; geometry agreement is regression tested. */
// Over the traverse axis: turret yaw cannot translate the independently aimed MG.
// The GLB roof here is y=2.46; the pintle adds 0.24 m.
export const SHERMAN_ROOF_GUN = { x: 0, y: 2.7, z: 0 } as const
export const GROUND_GUN_MOUNTS: Readonly<Partial<Record<GroundUnitId, GunMount>>> = {
  flakLight: {
    tier: 'autocannon', pivot: new Vector3(0, 0.62, 0.01), elevationPivot: new Vector3(0, 0.5, -0.06),
    muzzles: [new Vector3(-0.155, -0.15, -1.46), new Vector3(0.155, -0.15, -1.46),
      new Vector3(-0.155, 0.15, -1.46), new Vector3(0.155, 0.15, -1.46)],
  },
  usFlakTrack: {
    tier: 'autocannon', pivot: new Vector3(0, 1.62, 1.88), elevationPivot: new Vector3(0, 0.46, 0),
    muzzles: [new Vector3(-0.66, -0.06, -1.6), new Vector3(0.66, -0.06, -1.6),
      new Vector3(-0.52, 0.18, -1.6), new Vector3(0.52, 0.18, -1.6)],
  },
  usTank: {
    tier: 'mg', pivot: new Vector3(SHERMAN_ROOF_GUN.x, SHERMAN_ROOF_GUN.y, SHERMAN_ROOF_GUN.z),
    muzzles: [new Vector3(0, 0, -0.85)],
  },
}
