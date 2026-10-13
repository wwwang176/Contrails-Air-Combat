import { Quaternion, Vector3 } from 'three'
import type { GunMount } from '../weapons/gunMount'

type Bounds = readonly [number, number, number, number, number, number]
export interface ShipGunMount extends GunMount {
  readonly id: string
  /** Authored yaw node with its barrel/mantlet elevation child, already split in the GLB. */
  readonly modelNode?: string
  readonly restYaw: number
  readonly restPitch: number
  /** Extraction bounds are only needed for legacy merged meshes. */
  readonly bodyBounds?: Bounds
  readonly barrelBounds?: Bounds
  /** Ship-relative yaw firing sectors. Parking at restYaw remains possible outside them. */
  readonly yawSectors?: readonly (readonly [number, number])[]
  /** Elevation clearance in radians; targets outside it park the mount instead of clamping fire. */
  readonly pitchRange?: readonly [number, number]
}

/** Convert measured GLB pivots and barrel endpoints once, never in the frame loop. */
export function createShipGunMount(
  id: string, tier: GunMount['tier'], pivot: Vector3, root: Vector3, tip: Vector3,
  bodyBounds: Bounds, barrelBounds: Bounds, spacing = 0, sectors?: readonly (readonly [number, number])[],
): ShipGunMount {
  const direction = tip.clone().sub(root)
  const length = direction.length()
  const restYaw = Math.atan2(-direction.x, -direction.z)
  const restPitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z))
  const inverseYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -restYaw)
  return {
    id, tier, pivot, elevationPivot: root.clone().sub(pivot).applyQuaternion(inverseYaw),
    muzzles: spacing > 0 ? [new Vector3(-spacing, 0, -length), new Vector3(spacing, 0, -length)]
      : [new Vector3(0, 0, -length)],
    restYaw, restPitch, bodyBounds, barrelBounds,
    ...(sectors ? { yawSectors: sectors.map(([lo, hi]) => [lo * Math.PI / 180, hi * Math.PI / 180] as const) } : {}),
  }
}

/** Fletcher 主砲的遊戲仰角範圍；射控與機庫射界共用，左右死角仍各自保留。 */
function mount(...args: Parameters<typeof createShipGunMount>): ShipGunMount {
  const result = createShipGunMount(...args)
  return result.tier === 'flak'
    ? { ...result, pitchRange: [0, 85 * Math.PI / 180] }
    : result
}

/**
 * All ten physical mounts share six batteries. Main-gun sectors are conservative horizontal
 * model clearances with a margin: bridge/funnels forward, raised 40 mm platform behind No. 3.
 * They are firing limits, not historical traverse data; the original rest pose is for parking.
 */
export const FLETCHER_GUN_MOUNTS: Readonly<Record<string, ShipGunMount>> = {
  flak_c1: mount('flak_c1', 'flak', new Vector3(0, 7.53, -38), new Vector3(0, 7.53, -39.8), new Vector3(0, 7.53, -43.4),
    [-1.53, 4.45, -39.8, 1.53, 8.3, -36.2], [-0.13, 7.3048, -43.4, 0.26, 7.7552, -39.8], 0, [[-150, 150]]),
  flak_c2: mount('flak_c2', 'flak', new Vector3(0, 9.26, -30.55), new Vector3(0, 9.26, -32.8), new Vector3(0, 9.26, -35.9),
    [-1.53, 6.52, -32.8, 1.53, 10.26, -28.3], [-0.13, 9.0348, -35.9, 0.26, 9.4852, -32.8], 0, [[-135, 135]]),
  flak_c3: mount('flak_c3', 'flak', new Vector3(0, 7.65, 20.05), new Vector3(0, 7.65, 17.7), new Vector3(0, 7.65, 14.5),
    [-1.53, 4.7, 17.7, 1.53, 8.37, 22.4], [-0.13, 7.4248, 14.5, 0.26, 7.8752, 17.7], 0, [[-150, -15], [15, 150]]),
  flak_c4: mount('flak_c4', 'flak', new Vector3(0, 7.41, 31), new Vector3(0, 7.41, 33.1), new Vector3(0, 7.41, 36.4),
    [-1.53, 5.35, 28.9, 1.53, 8.41, 33.1], [-0.13, 7.1848, 33.1, 0.26, 7.6352, 36.4], 0, [[-180, -40], [40, 180]]),
  flak_c5: mount('flak_c5', 'flak', new Vector3(0, 5.05, 39.1), new Vector3(0, 5.05, 41.1), new Vector3(0, 5.05, 44.1),
    [-1.53, 2.1172, 37.1, 1.53, 6.04, 41.1], [-0.13, 4.8248, 41.1, 0.26, 5.2752, 44.1], 0, [[-180, -35], [35, 180]]),
  autocannon_c: mount('autocannon_c', 'autocannon', new Vector3(0, 10.66, 26), new Vector3(0, 10.66, 25.6), new Vector3(0, 11.08, 22.5),
    [-0.85, 9.02, 25.1, 0.85, 10.83, 26.9], [-0.3736, 10.5758, 22.4886, 0.3736, 11.1221, 25.6057], 0.3),
  mg_pf: mount('mg_pf', 'mg', new Vector3(-3.52, 8.03, -25.4), new Vector3(-3.62, 8.03, -25.45), new Vector3(-5.67, 8.5, -25.85),
    [-3.98, 6.53, -25.86, -3.06, 8.16, -24.94], [-5.684, 7.9666, -25.9039, -3.6022, 8.5317, -25.3934]),
  mg_pa: mount('mg_pa', 'mg', new Vector3(-3.95, 10.76, -18.6), new Vector3(-4.05, 10.76, -18.65), new Vector3(-5.4, 11.23, -19.05),
    [-4.41, 9.27, -19.06, -3.49, 10.89, -18.14], [-5.4197, 10.6983, -19.101, -4.0241, 11.2608, -18.5931]),
  mg_sf: mount('mg_sf', 'mg', new Vector3(3.52, 8.03, -25.4), new Vector3(3.62, 8.03, -25.45), new Vector3(5.67, 8.5, -25.85),
    [3.06, 6.53, -25.86, 3.98, 8.16, -24.94], [3.6022, 7.9666, -25.9039, 5.684, 8.5317, -25.3934]),
  mg_sa: mount('mg_sa', 'mg', new Vector3(3.95, 10.76, -18.6), new Vector3(4.05, 10.76, -18.65), new Vector3(5.4, 11.23, -19.05),
    [3.49, 9.27, -19.06, 4.41, 10.89, -18.14], [4.0241, 10.6983, -19.101, 5.4197, 11.2608, -18.5931]),
}

export const FLETCHER_GUN_GROUPS: Readonly<Record<string, readonly ShipGunMount[]>> = {
  flak_c: ['flak_c1', 'flak_c2', 'flak_c3', 'flak_c4', 'flak_c5'].map(id => FLETCHER_GUN_MOUNTS[id]!),
  autocannon_c: [FLETCHER_GUN_MOUNTS.autocannon_c!],
  mg_pf: [FLETCHER_GUN_MOUNTS.mg_pf!], mg_pa: [FLETCHER_GUN_MOUNTS.mg_pa!],
  mg_sf: [FLETCHER_GUN_MOUNTS.mg_sf!], mg_sa: [FLETCHER_GUN_MOUNTS.mg_sa!],
}
