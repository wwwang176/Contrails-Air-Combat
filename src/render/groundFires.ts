import { FIRE_PUFF, FIRE_SECONDS, type FirePuffFn } from './shipFires'

/**
 * # 地面目標的火
 *
 * 炸毀的建築、燒起來的車，在原地掛一根煙柱。**與船火同一套計時器、同一個
 * 噴煙回呼（`FirePuffFn`），但座標是世界座標** —— 船在動，火點要存艦體
 * 座標每幀轉回來；建築不動，直接存世界座標更簡單，也不必知道是哪一座。
 *
 * 純裝飾：不參與判定、不需要決定性。
 */

/** 同時最多幾個火點。廠區 12 座加砲位 8 座全炸掉也到不了；滿了覆寫最舊的 */
export const GROUND_FIRE_CAPACITY = 32

export interface GroundFires {
  readonly capacity: number
  /** 世界座標。`live[i] === 0` 的格子是空的 */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly live: Uint8Array
  /** 還要燒幾秒 —— float64，理由同 `shipFires.ts` */
  readonly left: Float64Array
  /** 距離下一朵迷你爆炸還有幾秒 */
  readonly puff: Float64Array
  /** 換一場全部熄掉。名字是 `reset` —— `main.ts` 的 `POOLS` 對每一個成員叫它 */
  reset(): void
}

interface Mutable extends GroundFires {
  cursor: number
}

export function createGroundFires(capacity: number = GROUND_FIRE_CAPACITY): GroundFires {
  const f: Mutable = {
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity),
    live: new Uint8Array(capacity),
    left: new Float64Array(capacity),
    puff: new Float64Array(capacity),
    cursor: 0,
    reset() {
      this.live.fill(0)
      this.cursor = 0
    },
  }
  return f
}

/** 在這個世界座標點一個火，燒 `FIRE_SECONDS`。第一朵立刻放 */
export function lightGroundFire(fires: GroundFires, x: number, y: number, z: number): void {
  const f = fires as Mutable
  const i = f.cursor
  f.cursor = (i + 1) % f.capacity
  f.x[i] = x
  f.y[i] = y
  f.z[i] = z
  f.live[i] = 1
  f.left[i] = FIRE_SECONDS
  f.puff[i] = 0
}

/**
 * 推進一步，把這一步該放的迷你爆炸吐給呼叫端。
 *
 * @param dt   **畫面時間**，不是物理子步
 * @param puff 每一朵呼叫一次，世界座標
 */
export function stepGroundFires(fires: GroundFires, dt: number, puff: FirePuffFn): void {
  const f = fires as Mutable
  for (let i = 0; i < f.capacity; i++) {
    if (f.live[i] === 0) continue
    const left = f.left[i]! - dt
    if (left <= 0) {
      f.live[i] = 0
      continue
    }
    f.left[i] = left
    let t = f.puff[i]! - dt
    if (t > 0) { f.puff[i] = t; continue }
    // 【一步只放一朵】理由同 `stepShipFires`
    do { t += FIRE_PUFF } while (t <= 0)
    f.puff[i] = t
    puff(f.x[i]!, f.y[i]!, f.z[i]!)
  }
}

/** 還在燒的火點數。給測試與除錯列 */
export function groundFiresLive(fires: GroundFires): number {
  let n = 0
  for (let i = 0; i < fires.capacity; i++) if (fires.live[i] !== 0) n++
  return n
}
