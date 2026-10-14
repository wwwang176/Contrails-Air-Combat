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
/** 第一塊到最遠一塊的出現時間差；各塊仍各自燃燒 0.12 秒。 */
export const MUZZLE_FIRE_SPREAD_SECONDS = 0.1
export const MUZZLE_SMOKE_LIFE_SCALE = 3
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
  // 沿用同一煙池的貼圖、受光與近鏡淡出，只延長這次砲口交接的煙。
  const lingeringSmoke: Pick<Particles, 'emit'> = {
    emit(x, y, z, vx, vy, vz, size = 1) {
      smoke.emit(x, y, z, vx, vy, vz, size, -1, MUZZLE_SMOKE_LIFE_SCALE)
    },
  }
  const fire = createChunks({
    capacity: CAPACITY, life: MUZZLE_FIRE_SECONDS, size: FIRE_CHUNK_SIZE,
    gravity: 0, drag: 6, color: fireballColor,
    onFade(x, y, z, vx, vy, vz, diameter, slot) {
      // 中央煙團覆蓋整塊火焰，外圍小團打散輪廓；在開始淡出的同一幀交接。
      lingeringSmoke.emit(x, y, z, vx, vy, vz, diameter * 1.1)
      emitEmber(lingeringSmoke, slot, x, y, z, vx, vy, vz, diameter * 0.7)
    },
  })
  const glow = createFireGlow(CAPACITY, 1, MUZZLE_FIRE_SECONDS, 0.3)
  const object = new Group()
  object.name = 'muzzleBlast'
  object.add(fire.object, glow.object)
  const direction = new Vector3()
  let seed = 0
  let time = 0, next = 0
  // 有上限的待發環形佇列：用遊戲時間排程，暫停／重開不留下計時器。
  const due = new Float64Array(CAPACITY).fill(Infinity)
  const pending = new Float64Array(CAPACITY * 7)

  function emitChunk(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    fire.emit(x, y, z, vx, vy, vz, size)
    glow.emit(x, y, z, vx, vy, vz, size * 1.1)
  }

  function advance(dt: number): void {
    fire.step(dt)
    glow.step(dt)
  }

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
        if (k === 0) {
          emitChunk(px, py, pz, vx, vy, vz, size)
        } else {
          due[next] = time + MUZZLE_FIRE_SPREAD_SECONDS * k / (PROFILE.length - 1)
          const at = next * 7
          pending[at] = px; pending[at + 1] = py; pending[at + 2] = pz
          pending[at + 3] = vx; pending[at + 4] = vy; pending[at + 5] = vz; pending[at + 6] = size
          next = (next + 1) % CAPACITY
        }
      }
    },
    step(dt: number): void {
      if (dt <= 0) return
      const end = time + dt
      // 跨過多個出現時刻也按順序推進，低幀率不會把五塊火焰重設成同齡。
      for (;;) {
        let slot = -1, when = Infinity
        for (let i = 0; i < CAPACITY; i++) {
          if (due[i]! <= end && due[i]! < when) { slot = i; when = due[i]! }
        }
        if (slot < 0) break
        advance(when - time)
        time = when
        const at = slot * 7
        emitChunk(pending[at]!, pending[at + 1]!, pending[at + 2]!, pending[at + 3]!,
          pending[at + 4]!, pending[at + 5]!, pending[at + 6]!)
        due[slot] = Infinity
      }
      advance(end - time)
      time = end
    },
    reset(): void {
      fire.reset()
      glow.reset()
      seed = 0
      time = 0; next = 0
      due.fill(Infinity)
    },
    dispose(): void {
      fire.dispose()
      glow.dispose()
    },
  }
}
