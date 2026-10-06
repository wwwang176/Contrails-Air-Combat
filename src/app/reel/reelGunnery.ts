import { Vector3, type Quaternion } from 'three'
import { hash01 } from '../../core/hash'
import { FLASH_SECONDS } from '../../weapons/muzzleFlash'
import { mountDirection } from '../../weapons/types'
import { PROJECTILE_LIFETIME, type Projectiles } from '../../world/Projectiles'
import { SHIP_CLASSES, type Ship } from '../../world/ships'
import type { GroundTarget } from '../../world/groundTargets'
import { createHitResult, hitAircraft, segmentPointDistanceSq } from '../../world/hit'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../../world/events'
import type { AircraftSpec } from '../../specs/types'
import type { ReelEvent } from '../reelShots'

/** 射擊與命中只需要姿態、槍械狀態及模型是否仍在場。 */
export interface ReelGunActor {
  readonly spec: AircraftSpec
  readonly model: object | null
  /** 世界座標的姿態（局部姿態轉過去之後）。 */
  readonly position: Vector3
  readonly quaternion: Quaternion
  readonly velocity: Vector3
  /** 這一架還在連射幾秒。 */
  burstLeft: number
  readonly cooldowns: Float32Array
  readonly muzzleFlash: Float32Array
}

/** 防空曳光的射速（每艘），發/秒；初速 m/s */
const AA_RATE = 14
const AA_SPEED = 850
/**
 * 一道持續的曳光：從一艘船（`ship`）、一架飛機的機槍手（`shooter`）或一台地面物件
 * （`prop`）打向 `actor`。三個來源只有一個不是 −1
 */
interface AaStream {
  ship: number
  shooter: number
  prop: number
  actor: number
  until: number
  miss: number
  timer: number
  seed: number
}

/** 防空與機槍手曳光的射手編號：負數不做命中判定（−1 是彈丸池的空槽，不能用） */
const STREAM_OWNER = -2
const S0 = new Vector3()
const S1 = new Vector3()
const HIT = createHitResult()

const V1 = new Vector3()
const V2 = new Vector3()
const V3 = new Vector3()

/** 放映器提供彈丸池與當前演員；此處持有曳光序列、命中暫存及統計。 */
export function createReelGunnery(
  projectiles: Projectiles,
  stage: { readonly light: boolean; readonly fx: { hits(events: ImpactEvents): void } },
) {
  const { fx } = stage
  const impacts = createImpacts()
  let streams: AaStream[] = []
  let hitCount = 0

  function startStream(e: Extract<ReelEvent, { kind: 'aa' | 'gunner' | 'groundFire' }>): void {
    switch (e.kind) {
      case 'aa':
        streams.push({
          ship: e.ship, shooter: -1, prop: -1, actor: e.actor, until: e.at + e.seconds, miss: e.miss,
          timer: 0, seed: e.ship * 1000 + e.actor * 97,
        })
        break
      case 'gunner':
        streams.push({
          ship: -1, shooter: e.actor, prop: -1, actor: e.target, until: e.at + e.seconds, miss: e.miss,
          timer: 0, seed: 50000 + e.actor * 1000 + e.target * 97,
        })
        break
      case 'groundFire':
        streams.push({
          ship: -1, shooter: -1, prop: e.prop, actor: e.actor, until: e.at + e.seconds, miss: e.miss,
          timer: 0, seed: 90000 + e.prop * 1000 + e.actor * 97,
        })
        break
    }
  }

  /** 連射：與機庫展示場同一個做法，各掛架照自己的射速輪流吐 */
  function stepGuns(a: ReelGunActor, owner: number, dt: number): void {
    const mounts = a.spec.battery.mounts
    const firing = a.burstLeft > 0
    if (firing) a.burstLeft -= dt
    for (let i = 0; i < mounts.length; i++) {
      const flash = a.muzzleFlash[i]! - dt
      a.muzzleFlash[i] = flash > 0 ? flash : 0
      const left = a.cooldowns[i]! - dt
      if (!firing || left > 0) {
        a.cooldowns[i] = left > 0 ? left : 0
        continue
      }
      const weapon = mounts[i]!.weapon
      a.cooldowns[i] = 60 / weapon.roundsPerMinute
      a.muzzleFlash[i] = FLASH_SECONDS
      V1.copy(mounts[i]!.position).applyQuaternion(a.quaternion).add(a.position)
      // 【曳光沿機槍的實際方向，不修正】要打中是導演的事：把飛機飛到機首對著目標的位置
      mountDirection(a.spec.battery, i, V2).applyQuaternion(a.quaternion)
      V2.multiplyScalar(weapon.muzzleVelocity).add(a.velocity)
      projectiles.spawn(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, 0, owner, 0, PROJECTILE_LIFETIME, weapon.caliber)
    }
  }

  /**
   * 固定機槍的彈打中飛機：用遊戲的命中盒判定，噴遊戲那一套火花、彈丸停在機身上。
   * 射手自己不算。船的防空與機槍手的曳光（`STREAM_OWNER`）不判定 —— 它們照設計是擦身而過
   */
  function stepHits(actors: readonly ReelGunActor[]): void {
    const p = projectiles
    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner < 0) continue
      S0.set(p.sx[i]!, p.sy[i]!, p.sz[i]!)
      S1.set(p.x[i]!, p.y[i]!, p.z[i]!)
      for (let j = 0; j < actors.length; j++) {
        const a = actors[j]!
        if (j === owner || a.model === null) continue
        const r = a.spec.wing.span
        if (segmentPointDistanceSq(S0.x, S0.y, S0.z, S1.x, S1.y, S1.z,
          a.position.x, a.position.y, a.position.z) > r * r) continue
        if (!hitAircraft(a.spec.hitBoxes, a.position, a.quaternion, S0, S1, HIT)) continue
        V3.lerpVectors(S0, S1, HIT.t)
        // 法線是機體座標；彈從盒內出發（沒有入射面）就朝來向噴
        if (HIT.nx === 0 && HIT.ny === 0 && HIT.nz === 0) V2.subVectors(S0, S1).normalize()
        else V2.set(HIT.nx, HIT.ny, HIT.nz).applyQuaternion(a.quaternion)
        pushImpact(impacts, V3.x, V3.y, V3.z, V2.x, V2.y, V2.z)
        hitCount++
        p.kill(i)
        break
      }
    }
    if (impacts.count > 0) {
      fx.hits(impacts)
      clearImpacts(impacts)
    }
  }

  /**
   * 持續的曳光：船上的防空從甲板上隨機一點、機槍手從機身上隨機一點、地面物件從車頂
   * 上方隨機一點，朝目標的前置點打，瞄點偏開 `miss` 公尺
   */
  function stepStreams(
    actors: readonly ReelGunActor[], ships: readonly Ship[], props: readonly GroundTarget[],
    t: number, dt: number,
  ): void {
    const rate = stage.light ? AA_RATE / 2 : AA_RATE
    for (const s of streams) {
      if (t > s.until) continue
      const ship = s.ship >= 0 ? ships[s.ship] : undefined
      const shooter = s.shooter >= 0 ? actors[s.shooter] : undefined
      const prop = s.prop >= 0 ? props[s.prop] : undefined
      const a = actors[s.actor]
      if (a === undefined || a.model === null) continue
      if (prop !== undefined) {
        if (!prop.alive) continue
      } else if (ship === undefined && (shooter === undefined || shooter.model === null)) continue
      s.timer -= dt
      while (s.timer <= 0) {
        s.timer += 1 / rate
        const k = s.seed++
        if (prop !== undefined) {
          // 車頂上方隨機一點
          V1.set(
            prop.position.x + (hash01(k * 3) * 2 - 1) * 1.5,
            prop.impactY + 0.5,
            prop.position.z + (hash01(k * 3 + 1) * 2 - 1) * 1.5,
          )
        } else if (ship !== undefined) {
          // 甲板上隨機一點
          const half = SHIP_CLASSES[ship.cls.id].hull[0]!.half.z
          V1.set((hash01(k * 3) * 2 - 1) * 6, ship.impactY + 4, (hash01(k * 3 + 1) * 2 - 1) * half * 0.7)
            .applyQuaternion(ship.orientation).add(ship.position)
        } else {
          // 機身上隨機一個砲塔位置：沿機身前後、略高略低
          const len = shooter!.spec.wing.span * 0.3
          V1.set((hash01(k * 3) * 2 - 1) * 1.2, (hash01(k * 3 + 1) * 2 - 1) * 1.2, (hash01(k * 11 + 5) * 2 - 1) * len)
            .applyQuaternion(shooter!.quaternion).add(shooter!.position)
        }
        const range = V1.distanceTo(a.position)
        V2.copy(a.position).addScaledVector(a.velocity, range / AA_SPEED)
        V3.set(hash01(k * 3 + 2) * 2 - 1, hash01(k * 5 + 7) * 2 - 1, hash01(k * 7 + 3) * 2 - 1)
        V2.addScaledVector(V3, s.miss)
        V2.sub(V1).normalize().multiplyScalar(AA_SPEED)
        // 機槍手的彈要加上自己的機速
        if (shooter !== undefined) V2.add(shooter.velocity)
        projectiles.spawn(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, 0, STREAM_OWNER, 0, PROJECTILE_LIFETIME, ship !== undefined ? 40 : 13)
      }
    }
  }

  return {
    startStream, stepGuns, stepHits, stepStreams,
    get hitCount() { return hitCount },
    clearStreams() { streams = [] },
    resetHits() { hitCount = 0 },
  }
}
