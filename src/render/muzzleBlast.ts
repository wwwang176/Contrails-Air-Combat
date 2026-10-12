import { Group, Vector3 } from 'three'
import { hash01 } from '../core/hash'
import type { GroundUnitId } from '../specs/ground'
import { createChunks, FIRE_CHUNK_SIZE } from './chunks'
import { createFireGlow } from './blastParticles'
import { emitEmber } from './blast'
import { fireballColor } from './fireball'
import type { Particles } from './particles'
import { coneDirection } from './scatter'

/** 火舌整體倍率：寬度、長度與擴散速度一起縮放，保留前端收尖的比例。 */
const MUZZLE_FIRE_SCALE = 2
export const MUZZLE_FIRE_SIZE = 0.35 * MUZZLE_FIRE_SCALE
export const MUZZLE_FIRE_SECONDS = 0.12
const CAPACITY = 80
const PROFILE = [0.55, 0.85, 1, 0.65, 0.3] as const

/** 相對於 90 mm 的視覺尺度；不代表物理裝藥量。0 表示不使用直射砲火。 */
export function groundCannonScale(id: GroundUnitId): number {
  switch (id) {
    case 'atGun': case 'tank': case 'tankDug': case 'panzer4': case 'usTank': return 0.85
    case 'tiger': return 1
    default: return 0
  }
}

/** 砲口獨立的短命粒子池；不改變炸彈火球與光暈的壽命。 */
export function createMuzzleBlast(smoke: Pick<Particles, 'emit'>) {
  const fire = createChunks({
    capacity: CAPACITY, life: MUZZLE_FIRE_SECONDS, size: FIRE_CHUNK_SIZE,
    gravity: 0, drag: 6, color: fireballColor,
    onFade(x, y, z, vx, vy, vz, diameter, slot) {
      // 中央煙團覆蓋整塊火焰，外圍小團打散輪廓；在開始淡出的同一幀交接。
      smoke.emit(x, y, z, vx, vy, vz, diameter * 1.1)
      emitEmber(smoke, slot, x, y, z, vx, vy, vz, diameter * 0.7)
    },
  })
  const glow = createFireGlow(CAPACITY, 1, MUZZLE_FIRE_SECONDS, 0.3)
  const object = new Group()
  object.name = 'muzzleBlast'
  object.add(fire.object, glow.object)
  const direction = new Vector3()
  let seed = 0

  return {
    object,
    emit(x: number, y: number, z: number, dx: number, dy: number, dz: number, scale = 1): void {
      seed = (seed + 1) | 0
      for (let k = 0; k < PROFILE.length; k++) {
        const index = seed * 31 + k
        coneDirection(dx, dy, dz, 0.14, index, direction)
        const along = (0.4 + k * 0.72) * MUZZLE_FIRE_SCALE * scale
        const px = x + direction.x * along
        const py = y + direction.y * along
        const pz = z + direction.z * along
        const speed = (1.5 + hash01(index * 97) * 1.5) * MUZZLE_FIRE_SCALE * scale
        const vx = direction.x * speed
        const vy = direction.y * speed
        const vz = direction.z * speed
        const size = MUZZLE_FIRE_SIZE * PROFILE[k]! * (0.9 + 0.1 * hash01(index)) * scale
        fire.emit(px, py, pz, vx, vy, vz, size)
        glow.emit(px, py, pz, vx, vy, vz, size * 1.1)
      }
    },
    step(dt: number): void {
      fire.step(dt)
      glow.step(dt)
    },
    reset(): void {
      fire.reset()
      glow.reset()
      seed = 0
    },
    dispose(): void {
      fire.dispose()
      glow.dispose()
    },
  }
}
