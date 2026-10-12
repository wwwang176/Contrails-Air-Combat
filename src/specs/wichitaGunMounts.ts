import { Vector3 } from 'three'
import { createShipGunMount as mount, type ShipGunMount } from './shipGunMounts'

/** Physical rig authored by scripts/rig-wichita-five-inch.mjs, validated against the GLB. */
function fiveInch(id: string, pivot: Vector3, sector: readonly [number, number]): ShipGunMount {
  return {
    id, tier: 'flak', pivot, modelNode: 'WICHITA_5in_' + id.slice(5),
    elevationPivot: new Vector3(0, 0, -1.75),
    muzzles: [new Vector3(0, 0, -Math.hypot(2.45, 0.7, 2.05))],
    restYaw: Math.atan2(2.45, 2.05) * (pivot.x < 0 ? 1 : -1),
    restPitch: Math.atan2(0.7, Math.hypot(2.45, 2.05)),
    yawSectors: [[sector[0] * Math.PI / 180, sector[1] * Math.PI / 180]],
  }
}

/**
 * Wichita GLB measurements in ship coordinates. Twenty AA mounts share eight batteries.
 * Conservative outward firing sectors avoid the bridge, funnels and opposite deck.
 * The forward 5-inch pair stops at 140 degrees to clear the structure astern.
 * The model has TWO barrels per 40 mm mount: use both visible muzzles, keeping battery cadence.
 * The three 8-inch main turrets remain static; they have no existing weapon simulation.
 */
export const WICHITA_GUN_MOUNTS: Readonly<Record<string, ShipGunMount>> = {
  flak_p1: fiveInch('flak_p1', new Vector3(-6.1, 7.3, -31.3), [10, 140]),
  flak_s1: fiveInch('flak_s1', new Vector3(6.1, 7.3, -31.3), [-140, -10]),
  flak_p2: fiveInch('flak_p2', new Vector3(-7, 9.73, -19.2), [10, 170]),
  flak_s2: fiveInch('flak_s2', new Vector3(7, 9.73, -19.2), [-170, -10]),
  flak_p3: fiveInch('flak_p3', new Vector3(-5.3, 9.72, 31.2), [10, 170]),
  flak_s3: fiveInch('flak_s3', new Vector3(5.3, 9.72, 31.2), [-170, -10]),
  flak_p4: fiveInch('flak_p4', new Vector3(-5.25, 7.9, 87.6), [10, 175]),
  flak_s4: fiveInch('flak_s4', new Vector3(5.25, 7.9, 87.6), [-175, -10]),
  autocannon_p1: mount('autocannon_p1', 'autocannon', new Vector3(-6.3, 11.68, -12.2), new Vector3(-6.3, 11.68, -11.9), new Vector3(-6.3, 12.2, -14.8),
    [-7.35, 9.97, -13.45, -5.25, 11.95, -10.95], [-6.7236, 11.5963, -14.815, -5.8764, 12.2418, -11.8925], 0.35, [[10, 170]]),
  autocannon_s1: mount('autocannon_s1', 'autocannon', new Vector3(6.3, 11.68, -12.2), new Vector3(6.3, 11.68, -11.9), new Vector3(6.3, 12.2, -14.8),
    [5.25, 9.97, -13.45, 7.35, 11.95, -10.95], [5.8764, 11.5963, -14.815, 6.7236, 12.2418, -11.8925], 0.35, [[-170, -10]]),
  mg_p1: mount('mg_p1', 'mg', new Vector3(-1.5, 8.22, -85.2), new Vector3(-1.6, 8.22, -85.25), new Vector3(-3.05, 8.67, -85.6),
    [-1.92, 6.8608, -85.62, -1.08, 8.35, -84.78], [-3.0682, 8.1578, -85.6525, -1.5777, 8.7011, -85.1931], 0, [[10, 170]]),
  mg_s1: mount('mg_s1', 'mg', new Vector3(1.5, 8.22, -85.2), new Vector3(1.6, 8.22, -85.25), new Vector3(3.05, 8.67, -85.6),
    [1.08, 6.8608, -85.62, 1.92, 8.35, -84.78], [1.5777, 8.1578, -85.6525, 3.0682, 8.7011, -85.1931], 0, [[-170, -10]]),
  mg_p2: mount('mg_p2', 'mg', new Vector3(-4.75, 8.79, -3.6), new Vector3(-4.85, 8.79, -3.65), new Vector3(-6.35, 9.24, -4),
    [-5.17, 7.43, -4.02, -4.33, 8.92, -3.18], [-6.3678, 8.7276, -4.0527, -4.8283, 9.2712, -3.5931], 0, [[10, 170]]),
  mg_s2: mount('mg_s2', 'mg', new Vector3(4.75, 8.79, -3.6), new Vector3(4.85, 8.79, -3.65), new Vector3(6.35, 9.24, -4),
    [4.33, 7.43, -4.02, 5.17, 8.92, -3.18], [4.8283, 8.7276, -4.0527, 6.3678, 9.2712, -3.5931], 0, [[-170, -10]]),
  mg_p3: mount('mg_p3', 'mg', new Vector3(-4.75, 8.71, -1.25), new Vector3(-4.85, 8.71, -1.3), new Vector3(-6.35, 9.16, -1.65),
    [-5.17, 7.43, -1.67, -4.33, 8.84, -0.83], [-6.3678, 8.6476, -1.7027, -4.8283, 9.1912, -1.2431], 0, [[10, 170]]),
  mg_s3: mount('mg_s3', 'mg', new Vector3(4.75, 8.71, -1.25), new Vector3(4.85, 8.71, -1.3), new Vector3(6.35, 9.16, -1.65),
    [4.33, 7.43, -1.67, 5.17, 8.84, -0.83], [4.8283, 8.6476, -1.7027, 6.3678, 9.1912, -1.2431], 0, [[-170, -10]]),
  mg_p4: mount('mg_p4', 'mg', new Vector3(-4.75, 8.71, 1.1), new Vector3(-4.85, 8.71, 1.05), new Vector3(-6.35, 9.16, 0.7),
    [-5.17, 7.43, 0.68, -4.33, 8.84, 1.52], [-6.3678, 8.6476, 0.6473, -4.8283, 9.1912, 1.1069], 0, [[10, 170]]),
  mg_s4: mount('mg_s4', 'mg', new Vector3(4.75, 8.71, 1.1), new Vector3(4.85, 8.71, 1.05), new Vector3(6.35, 9.16, 0.7),
    [4.33, 7.43, 0.68, 5.17, 8.84, 1.52], [4.8283, 8.6476, 0.6473, 6.3678, 9.1912, 1.1069], 0, [[-170, -10]]),
  mg_p5: mount('mg_p5', 'mg', new Vector3(-4.75, 8.66, 4), new Vector3(-4.85, 8.66, 3.95), new Vector3(-6.35, 9.11, 3.6),
    [-5.17, 7.43, 3.58, -4.33, 8.79, 4.42], [-6.3678, 8.5976, 3.5473, -4.8283, 9.1412, 4.0069], 0, [[10, 170]]),
  mg_s5: mount('mg_s5', 'mg', new Vector3(4.75, 8.66, 4), new Vector3(4.85, 8.66, 3.95), new Vector3(6.35, 9.11, 3.6),
    [4.33, 7.43, 3.58, 5.17, 8.79, 4.42], [4.8283, 8.5976, 3.5473, 6.3678, 9.1412, 4.0069], 0, [[-170, -10]]),
}

export const WICHITA_GUN_GROUPS: Readonly<Record<string, readonly ShipGunMount[]>> = {
  flak_p: [1, 2, 3, 4].map(n => WICHITA_GUN_MOUNTS[`flak_p${n}`]!),
  flak_s: [1, 2, 3, 4].map(n => WICHITA_GUN_MOUNTS[`flak_s${n}`]!),
  autocannon_p: [WICHITA_GUN_MOUNTS.autocannon_p1!],
  autocannon_s: [WICHITA_GUN_MOUNTS.autocannon_s1!],
  mg_pf: [WICHITA_GUN_MOUNTS.mg_p1!],
  mg_pa: [2, 3, 4, 5].map(n => WICHITA_GUN_MOUNTS[`mg_p${n}`]!),
  mg_sf: [WICHITA_GUN_MOUNTS.mg_s1!],
  mg_sa: [2, 3, 4, 5].map(n => WICHITA_GUN_MOUNTS[`mg_s${n}`]!),
}
