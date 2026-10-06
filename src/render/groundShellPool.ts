import type { TracerSource } from './tracers'
import type { Particles } from './particles'

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

/** 固定容量的視覺彈丸。選目標與畫出來都是呼叫端的事 */
export function createGroundShellPool(
  capacity: number, small: boolean,
  flash: Pick<Particles, 'emit'>, dust: Pick<Particles, 'emit'>,
  impact: (x: number, y: number, z: number) => void,
) {
  const pool = createShellPool(capacity)
  let shots = 0
  let hitShots = 0

  function fire(
    ox: number, oy: number, oz: number,
    tx: number, ty: number, tz: number, speed: number, hit: boolean,
  ): void {
    const dx = tx - ox
    const dy = ty - oy
    const dz = tz - oz
    const d = Math.hypot(dx, dy, dz)
    if (d < 1) return
    shots++
    if (hit) hitShots++
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

  function step(dt: number): void {
    for (let i = 0; i < pool.capacity; i++) {
      if (pool.owner[i] === -1) continue
      const age = pool.age[i]! + dt
      if (age >= pool.flight[i]!) {
        pool.owner[i] = -1
        const x = pool.hx[i]!
        const y = pool.hy[i]!
        const z = pool.hz[i]!
        // 【砲彈擊中是小爆炸】與迫擊砲落地同一份（`impact`）；步兵的槍彈只有一小團火花
        if (pool.hit[i] === 1) {
          if (small) flash.emit(x, y, z, 0, 0, 0, 0.4)
          else impact(x, y, z)
        } else dust.emit(x, y, z, 0, small ? 1 : 3, 0, small ? 0.3 : 0.7)
        continue
      }
      pool.age[i] = age
      pool.x[i] = pool.x[i]! + pool.vx[i]! * dt
      pool.y[i] = pool.y[i]! + pool.vy[i]! * dt
      pool.z[i] = pool.z[i]! + pool.vz[i]! * dt
    }
  }

  const source: TracerSource = pool
  return {
    source,
    fire,
    step,
    get shots() { return shots },
    get hitShots() { return hitShots },
    reset(): void {
      pool.owner.fill(-1)
      // 環狀游標不歸零；重置只清掉飛行中的彈丸與計數
      shots = 0
      hitShots = 0
    },
  }
}
