import { Quaternion, Vector3 } from 'three'
import { aimAngles, GUN_PITCH_MIN, GUN_PITCH_MAX } from './gunAim'
import { hash01 } from '../core/hash'

export interface GunMount {
  readonly tier: 'mg' | 'autocannon' | 'flak'
  readonly pivot: Readonly<Vector3>
  /** Omitted for freely aimed roof guns; otherwise relative to the yaw pivot. */
  readonly elevationPivot?: Readonly<Vector3>
  readonly muzzles: readonly Vector3[]
}

/** Shot counters are one based, shared with the rendered flash. */
export function gunBarrelIndex(shot: number, barrels: number): number {
  return Math.max(0, shot - 1) % barrels
}

/** Replay-stable emitter choice, shared by physics and visuals; no random state or allocations. */
export function gunMountIndex(shot: number, count: number, platform: number, battery: number): number {
  return count <= 1 ? 0 : Math.floor(hash01(shot ^ Math.imul(platform + 1, 73856093) ^ Math.imul(battery + 1, 19349663)) * count)
}

const angles = { yaw: 0, pitch: 0 }
const rotation = new Quaternion()
const forward = new Vector3(0, 0, -1)
const xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0)

/** Model-space muzzle, with the same mechanical pose as the displayed barrel. No allocations. */
export function gunMountMuzzle(mount: GunMount, aim: Vector3, yaw: number, shot: number, out: Vector3): void {
  out.copy(mount.muzzles[gunBarrelIndex(shot, mount.muzzles.length)]!)
  if (mount.elevationPivot) {
    aimAngles(aim.x, aim.y, aim.z, yaw, 0, GUN_PITCH_MIN, GUN_PITCH_MAX, angles)
    out.applyQuaternion(rotation.setFromAxisAngle(xAxis, angles.pitch))
      .add(mount.elevationPivot)
      .applyQuaternion(rotation.setFromAxisAngle(yAxis, angles.yaw))
  } else {
    out.applyQuaternion(rotation.setFromUnitVectors(forward, aim))
  }
  out.add(mount.pivot)
}
