import { AdditiveBlending, NormalBlending, type Color, type Object3D, type Texture } from 'three'
import type { GroundUnitId } from './geometry/ground'
import type { GroundTarget } from '../world/groundTargets'
import type { MissionTheater } from '../battle/missions/types'
import { createParticles } from './particles'
import { createDust } from './blast'
import { createTracers, type TracerSource } from './tracers'
import { hash01 } from './scatter'
import { FIRE_SECONDS, type FirePuffFn } from './shipFires'

/**
 * # 地面戰的戲
 *
 * 德 M4 的下面一直在打：坦克與反坦克砲互射、步兵開槍、砲兵的彈著揚起塵土、
 * 殘骸與農舍燒著不熄、移動的坦克拖著塵土。**純畫面，不進模擬** —— 誰打中誰
 * 不改任何單位的血量（照劇本被打掉的那幾台由模擬自己處理，`GroundEntry.killAt`）。
 *
 * ```
 *   坦克／反坦克砲一發   砲口槍焰＋一小團煙 → 機槍的曳光彈代表砲彈 → 彈著：火花或塵土
 *   步兵一發             沒有槍焰 → 細一半的曳光彈 → 彈著：一小團塵土
 * ```
 *
 * 【射擊時刻是時間的純函數】`shotTimesBetween`：第 i 台的第 k 發落在
 * `phase(i) + k × period` 附近、抖動 ±`SHOT_JITTER` 個週期。每一幀算 (上一幀, 這一幀]
 * 之間的發數 —— 不吃幀率，切成幾幀算都一樣。
 *
 * 【挑目標在開火那一刻做】範圍內最近的存活敵方。不是每幀掃，所以開銷跟著發數走。
 *
 * 渲染幀率呼叫，不在物理步裡。熱路徑不配置。
 */

/**
 * 射擊時刻在格點附近的抖動幅度，週期的比例。相鄰兩發的間隔落在
 * (1 ± 2 × 這個值) 倍的週期，0.15 → 0.7～1.3 倍。< 0.5 才保證遞增
 */
export const SHOT_JITTER = 0.15

/** 步兵的射程上限，m。步槍與機槍打不到一公里半外的坦克 */
const INFANTRY_RANGE = 600

/** 曳光彈的飛行速度，m/s。比真的砲彈慢，從空中才看得到它在飛 */
const SHELL_SPEED = 450
const BULLET_SPEED = 600

/** 打中的機率。打偏的落在目標旁 `MISS_NEAR`～`MISS_FAR` 公尺 */
const HIT_CHANCE = 0.3
const MISS_NEAR = 8
const MISS_FAR = 25

/** 移動中的坦克每隔幾秒在車尾補一團塵土 */
const TRACK_DUST_EVERY = 0.35
/** 長燒的煙每隔幾秒補一朵火 */
const BURN_EVERY = 0.3

/**
 * 殘骸整場冒煙的單位：只有坦克。砲位、步兵、卡車也冒的話火點多到幾十處，
 * 而地面火的池子是照一次轟炸的量訂的
 */
const BURNS: ReadonlySet<GroundUnitId> = new Set<GroundUnitId>(['panzer4', 'tiger', 'tank', 'tankDug'])

/** 戲裡同時在飛的曳光彈上限 */
const SHELL_CAPACITY = 256
const BULLET_CAPACITY = 256

/** 一幀最多處理幾發（一台）。長幀之後補發的上限 */
const MAX_SHOTS_PER_FRAME = 8

const TWO_PI = Math.PI * 2

/**
 * (t0, t1] 之間第 `i` 台的射擊時刻，依序寫進 `out`，回傳幾發。
 *
 * 第 k 發 = `phase + k × period + (2h − 1) × SHOT_JITTER × period`，h 是 (i, k) 的雜湊。
 * 抖動小於半個週期，所以序列遞增，區間的左開右閉保證跨幀不重複也不漏。
 */
export function shotTimesBetween(
  i: number, period: number, t0: number, t1: number, out: Float64Array,
): number {
  const phase = hash01(i * 7919 + 13) * period
  const reach = SHOT_JITTER * period
  const k0 = Math.max(0, Math.floor((t0 - phase - reach) / period))
  const k1 = Math.floor((t1 - phase + reach) / period)
  let n = 0
  for (let k = k0; k <= k1 && n < out.length; k++) {
    const t = phase + k * period + (2 * hash01(i * 104729 + k) - 1) * reach
    if (t > t0 && t <= t1) out[n++] = t
  }
  return n
}

/** 能開火、能被瞄的：存活、已經出現 */
function inPlay(t: GroundTarget): boolean {
  return t.alive && !t.dormant
}

/**
 * 第 `s` 台的射程內最近的存活敵方，回傳索引；沒有就 −1。
 *
 * @param isTarget 只挑這些單位（省略 = 全部）。戲只在戰鬥單位之間打，不打卡車
 */
export function nearestEnemy(
  targets: readonly GroundTarget[], s: number, range: number,
  isTarget?: (id: GroundUnitId) => boolean,
): number {
  const me = targets[s]!
  let best = -1
  let bestD2 = range * range
  for (let j = 0; j < targets.length; j++) {
    const t = targets[j]!
    if (t.team === me.team || !inPlay(t)) continue
    if (isTarget !== undefined && !isTarget(t.unit.id)) continue
    const dx = t.position.x - me.position.x
    const dz = t.position.z - me.position.z
    const d2 = dx * dx + dz * dz
    if (d2 < bestD2) {
      bestD2 = d2
      best = j
    }
  }
  return best
}

/** 一小池曳光彈：滿足 `TracerSource`，另外記著飛多久到、到了要放什麼 */
interface ShellPool extends TracerSource {
  readonly flight: Float32Array
  /** 到達時的彈著點 */
  readonly hx: Float32Array
  readonly hy: Float32Array
  readonly hz: Float32Array
  /** 1 = 打中（火花），0 = 打偏（塵土） */
  readonly hit: Uint8Array
  cursor: number
}

function createShellPool(capacity: number): ShellPool {
  const f = (): Float32Array => new Float32Array(capacity)
  return {
    capacity,
    x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), age: f(),
    owner: new Int32Array(capacity).fill(-1),
    flight: f(), hx: f(), hy: f(), hz: f(),
    hit: new Uint8Array(capacity),
    cursor: 0,
  }
}

export interface GroundBattle {
  /** 加進場景的物件 */
  readonly objects: readonly Object3D[]
  /** 開場到現在打了幾發（坦克與步兵合計）。量測用 */
  readonly shots: number
  /**
   * @param time 世界秒數（`world.time`），排程吃它
   * @param frameDt 這一幀世界前進了多少秒，粒子與曳光吃它
   */
  update(
    targets: readonly GroundTarget[], time: number, frameDt: number,
    groundAt: (x: number, z: number) => number,
  ): void
  /** 重開一場：清掉在飛的與在飄的 */
  reset(): void
  dispose(): void
}

function flashColor(t: number, out: Color): void {
  out.setRGB(1, 0.75 - 0.35 * t, 0.35 - 0.3 * t)
}
function gunSmokeColor(_t: number, out: Color): void {
  out.setRGB(0.55, 0.54, 0.5)
}

/**
 * @param burn 長燒的煙。與地面火同一份配方（`main.ts` 的 `emitFirePuff`）
 * @param smokeTexture 塵土的不透明度貼圖，與爆炸的塵土同一張
 */
export function createGroundBattle(
  theater: MissionTheater, burn: FirePuffFn, smokeTexture?: Texture,
): GroundBattle {
  const shooters = new Set<GroundUnitId>(theater.shooters)
  const isTarget = (id: GroundUnitId): boolean => shooters.has(id)

  // 【比真的大一號】玩家在 1.5～2 km 外往下看，照實的 3 m 槍焰只有兩三個像素
  const flash = createParticles({
    capacity: 256, blending: AdditiveBlending, life: 0.18, sizeFrom: 7, sizeTo: 2,
    gravity: 0, drag: 0, alphaFrom: 1, color: flashColor,
  })
  const gunSmoke = createParticles({
    capacity: 512, blending: NormalBlending, life: 3, lifeJitter: 0.3, sizeFrom: 5, sizeTo: 14,
    gravity: 0.6, drag: 1.2, alphaFrom: 0.55, shadeJitter: 0.3, color: gunSmokeColor,
  })
  const dust = createDust(1024, 1, smokeTexture)
  const shells = createShellPool(SHELL_CAPACITY)
  const bullets = createShellPool(BULLET_CAPACITY)
  const shellTracers = createTracers(SHELL_CAPACITY)
  const bulletTracers = createTracers(BULLET_CAPACITY, 0.5)
  // 【命名】量測出口（`__sceneList`）靠名字認出這幾池
  flash.object.name = 'groundBattle.flash'
  gunSmoke.object.name = 'groundBattle.gunSmoke'
  dust.object.name = 'groundBattle.dust'
  shellTracers.object.name = 'groundBattle.shells'
  bulletTracers.object.name = 'groundBattle.bullets'

  const shotBuf = new Float64Array(MAX_SHOTS_PER_FRAME)
  /** 每一台的車尾塵土計時，第一次 `update` 時依單位數配置 */
  let trackClock = new Float32Array(0)
  /** 每一台第一次被看到死掉的世界秒數；−1 = 還活著。長燒的煙從它起算 */
  let diedAt = new Float32Array(0)
  let burnClock = 0
  let artilleryClock = 0
  let lastTime = -1
  let shots = 0

  function fire(
    pool: ShellPool, ox: number, oy: number, oz: number,
    tx: number, ty: number, tz: number, speed: number, hit: boolean,
  ): void {
    const dx = tx - ox
    const dy = ty - oy
    const dz = tz - oz
    const d = Math.hypot(dx, dy, dz)
    if (d < 1) return
    shots++
    const i = pool.cursor
    pool.cursor = (i + 1) % pool.capacity
    pool.x[i] = ox
    pool.y[i] = oy
    pool.z[i] = oz
    pool.vx[i] = (dx / d) * speed
    pool.vy[i] = (dy / d) * speed
    pool.vz[i] = (dz / d) * speed
    pool.age[i] = 0
    pool.owner[i] = 0
    pool.flight[i] = d / speed
    pool.hx[i] = tx
    pool.hy[i] = ty
    pool.hz[i] = tz
    pool.hit[i] = hit ? 1 : 0
  }

  function stepPool(pool: ShellPool, dt: number, small: boolean): void {
    for (let i = 0; i < pool.capacity; i++) {
      if (pool.owner[i] === -1) continue
      const age = pool.age[i]! + dt
      if (age >= pool.flight[i]!) {
        pool.owner[i] = -1
        const x = pool.hx[i]!
        const y = pool.hy[i]!
        const z = pool.hz[i]!
        if (pool.hit[i] === 1) flash.emit(x, y, z, 0, 0, 0, small ? 0.4 : 0.8)
        else dust.emit(x, y, z, 0, small ? 1 : 3, 0, small ? 0.3 : 0.7)
        continue
      }
      pool.age[i] = age
      pool.x[i] = pool.x[i]! + pool.vx[i]! * dt
      pool.y[i] = pool.y[i]! + pool.vy[i]! * dt
      pool.z[i] = pool.z[i]! + pool.vz[i]! * dt
    }
  }

  function shoot(
    targets: readonly GroundTarget[], s: number, k: number,
    groundAt: (x: number, z: number) => number,
  ): void {
    const me = targets[s]!
    const infantry = me.unit.id === 'infantry'
    const j = nearestEnemy(targets, s, infantry ? Math.min(INFANTRY_RANGE, theater.range) : theater.range, isTarget)
    if (j < 0) return
    const them = targets[j]!
    const dx = them.position.x - me.position.x
    const dz = them.position.z - me.position.z
    const d = Math.hypot(dx, dz)
    if (d < 1) return
    const ux = dx / d
    const uz = dz / d
    // 【砲口朝目標】不讀砲塔的轉向（模型的砲塔不轉）：車頭前方半個車長、車高八成
    const reach = infantry ? 0 : me.unit.realLength / 2
    const ox = me.position.x + ux * reach
    const oz = me.position.z + uz * reach
    const oy = me.position.y + (infantry ? 1.4 : me.unit.realHeight * 0.8)
    const seed = s * 7919 + k
    const hit = hash01(seed) < HIT_CHANCE
    let tx = them.position.x
    let tz = them.position.z
    let ty = them.position.y + them.unit.realHeight * 0.5
    if (!hit) {
      const a = hash01(seed + 1) * TWO_PI
      const r = MISS_NEAR + hash01(seed + 2) * (MISS_FAR - MISS_NEAR)
      tx += Math.cos(a) * r
      tz += Math.sin(a) * r
      ty = groundAt(tx, tz)
    }
    if (infantry) {
      fire(bullets, ox, oy, oz, tx, ty, tz, BULLET_SPEED, hit)
      return
    }
    flash.emit(ox, oy, oz, 0, 0, 0, 1)
    gunSmoke.emit(ox, oy, oz, ux * 2, 0.5, uz * 2, 1)
    fire(shells, ox, oy, oz, tx, ty, tz, SHELL_SPEED, hit)
  }

  return {
    objects: [flash.object, gunSmoke.object, dust.object, shellTracers.object, bulletTracers.object],
    get shots() { return shots },

    update(targets, time, frameDt, groundAt) {
      if (trackClock.length !== targets.length) {
        trackClock = new Float32Array(targets.length)
        diedAt = new Float32Array(targets.length).fill(-1)
      }
      // 【第一幀不補發】開場那一刻沒有「上一幀」，從 0 算的話會一口氣補上開場前的發數
      const t0 = lastTime < 0 || time < lastTime ? time : lastTime
      lastTime = time

      for (let s = 0; s < targets.length; s++) {
        const me = targets[s]!
        if (!inPlay(me)) continue
        if (shooters.has(me.unit.id)) {
          const n = shotTimesBetween(s, theater.period, t0, time, shotBuf)
          for (let k = 0; k < n; k++) shoot(targets, s, Math.round(shotBuf[k]! * 10), groundAt)
        }
        // 【行進揚塵】車尾、貼地
        if (me.speed > 0) {
          const c = trackClock[s]! - frameDt
          if (c <= 0) {
            trackClock[s] = TRACK_DUST_EVERY
            const yaw = 2 * Math.atan2(me.orientation.y, me.orientation.w)
            const back = me.unit.realLength / 2
            const x = me.position.x + Math.sin(yaw) * back
            const z = me.position.z + Math.cos(yaw) * back
            dust.emit(x, me.position.y + 0.5, z, 0, 0.8, 0, 0.6)
          } else {
            trackClock[s] = c
          }
        }
      }

      // 【砲兵】無人地帶的雜湊位置揚起一柱塵土
      const art = theater.artillery
      if (art !== undefined) {
        artilleryClock -= frameDt
        if (artilleryClock <= 0) {
          artilleryClock += art.period
          const seed = Math.floor(time * 10)
          const a = (hash01(seed * 3 + 1) * 2 - 1) * art.halfAcross
          const b = (hash01(seed * 3 + 2) * 2 - 1) * art.halfAlong
          const x = art.x + a * art.across.x + b * art.along.x
          const z = art.z + a * art.across.z + b * art.along.z
          const y = groundAt(x, z)
          // 【比照實比例大】從 1.5～2 km 往下看要讀得出是一柱土
          flash.emit(x, y + 1, z, 0, 0, 0, 3)
          for (let k = 0; k < 6; k++) {
            dust.emit(x, y + 1, z, (hash01(seed + k) - 0.5) * 8, 8 + k * 3, (hash01(seed + k + 9) - 0.5) * 8, 2.2)
          }
        }
      }

      // 【長燒的煙】卡片上的點，加上坦克的殘骸。地面火（`groundFires`）燒頭 60 秒，
      // 之後由這裡接手；劇本打掉的從 `killAt` 起算，其餘的從第一次看到它死起算
      burnClock -= frameDt
      if (burnClock <= 0) {
        burnClock += BURN_EVERY
        for (const p of theater.smokes ?? []) burn(p.x, groundAt(p.x, p.z), p.z)
        for (let s = 0; s < targets.length; s++) {
          const t = targets[s]!
          if (t.alive || t.dormant || t.arrived || !BURNS.has(t.unit.id)) continue
          if (diedAt[s]! < 0) diedAt[s] = t.scripted ? t.killAt : time
          if (time - diedAt[s]! < FIRE_SECONDS) continue
          burn(t.position.x, t.position.y, t.position.z)
        }
      }

      stepPool(shells, frameDt, false)
      stepPool(bullets, frameDt, true)
      shellTracers.update(shells)
      bulletTracers.update(bullets)
      flash.step(frameDt)
      gunSmoke.step(frameDt)
      dust.step(frameDt)
    },

    reset() {
      shells.owner.fill(-1)
      bullets.owner.fill(-1)
      flash.reset()
      gunSmoke.reset()
      dust.reset()
      lastTime = -1
      shots = 0
      burnClock = 0
      artilleryClock = 0
      trackClock.fill(0)
      diedAt.fill(-1)
    },

    dispose() {
      flash.dispose()
      gunSmoke.dispose()
      dust.dispose()
      shellTracers.dispose()
      bulletTracers.dispose()
    },
  }
}
