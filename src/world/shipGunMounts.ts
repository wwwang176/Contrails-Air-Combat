import type { ShipGunMount } from '../specs/shipGunMounts'
import { aimAngles, GUN_PITCH_MAX, GUN_PITCH_MIN, slewYaw } from '../weapons/gunAim'
import { gunMountIndex } from '../weapons/gunMount'
import type { ShipGun } from './ships'

export interface ShipMountPose { yaw: number; pitch: number; ready: boolean }
const angles = { yaw: 0, pitch: 0 }
const TAU = Math.PI * 2
function relative(yaw: number, rest: number): number {
  const d = yaw - rest
  return d - Math.round(d / TAU) * TAU
}
function approach(value: number, want: number, step: number): number {
  return value + Math.max(-step, Math.min(step, want - value))
}

/** Conservative horizontal sectors measured from the model, not historical mount limits. */
export function shipMountCanAim(mount: ShipGunMount, yaw: number): boolean {
  const wrapped = relative(yaw, 0)
  if (!mount.yawSectors) return true
  for (const [lo, hi] of mount.yawSectors) if (wrapped >= lo && wrapped <= hi) return true
  return false
}

/** One shared battery aim; mounts only park/track it, with no additional target searches. */
export function stepShipMounts(gun: ShipGun, tracking: boolean, dt: number): boolean {
  const mounts = gun.projectileMounts, poses = gun.mountPoses
  if (!mounts || !poses) return true
  aimAngles(gun.aim.x, gun.aim.y, gun.aim.z, gun.muzzleYaw ?? 0, 0, GUN_PITCH_MIN, GUN_PITCH_MAX, angles)
  let ready = false
  const step = gun.spec.rotationRate * 2 * dt
  for (let i = 0; i < mounts.length; i++) {
    const mount = mounts[i]!, pose = poses[i]!
    const allowed = tracking && shipMountCanAim(mount, angles.yaw)
    const yaw = allowed ? relative(angles.yaw, mount.restYaw) : 0
    const pitch = allowed ? angles.pitch : mount.restPitch
    // Traverse relative to parking: bow mounts never take the shortcut through the stern.
    pose.yaw = mount.yawSectors
      ? mount.restYaw + approach(relative(pose.yaw, mount.restYaw), yaw, step)
      : slewYaw(pose.yaw, mount.restYaw + yaw, gun.spec.rotationRate * 2, dt)
    pose.pitch = approach(pose.pitch, pitch, step)
    pose.ready = allowed && Math.abs(relative(pose.yaw, angles.yaw)) < 1e-6 && Math.abs(pose.pitch - pitch) < 1e-6
    ready ||= pose.ready
  }
  return ready
}

/** Select among ready mounts only; return -1 when the battery has no physical emitter. */
export function selectShipMount(gun: ShipGun, shot: number, platform: number, battery: number): number {
  const poses = gun.mountPoses
  if (!poses) return -1
  let count = 0
  for (const pose of poses) if (pose.ready) count++
  if (count === 0) return -1
  let chosen = gunMountIndex(shot, count, platform, battery)
  for (let i = 0; i < poses.length; i++) if (poses[i]!.ready && chosen-- === 0) return i
  return -1
}
