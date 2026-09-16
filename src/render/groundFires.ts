import { FIRE_PUFF, FIRE_SECONDS, type FirePuffFn } from './shipFires'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/**
 * # 地面的火
 *
 * 落在陸地上的炸彈、炸毀的建築、燒起來的車，在原地掛一根煙柱。**與船火
 * 同一套計時器、同一個噴煙回呼（`FirePuffFn`），但座標是世界座標** ——
 * 船在動，火點要存艦體座標每幀轉回來；地面不動，直接存世界座標更簡單，
 * 也不必知道是哪一座。
 *
 * 純裝飾：不參與判定、不需要決定性。
 */

/**
 * 同時最多幾個火點。一個火期（`FIRE_SECONDS` = 60 s）內四架 B-17 落下的
 * 炸彈要一起燒得住：彈艙 10 顆、空了 20 秒補滿，60 秒內一架最多三艙 30 顆，
 * 四架 120 顆，再加廠區與砲位全炸掉的 20 座。比這小的話**建築的火會被後落
 * 的炸彈頂掉**，而那不報錯。滿了覆寫最舊的
 */
export const GROUND_FIRE_CAPACITY = 160

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
 * 讀一批炸彈落點事件，落在**陸地**的每一筆點一個火。
 *
 * 【只看 `nx = 0`】1 = 水，海上留不下火；2 = 船，那一朵由 `lightShipFires`
 * 管（存艦體座標，跟著船走）；3 = 建築，被炸毀時擊毀事件會在它身上點火，
 * 沒炸毀的那一顆只留爆炸。
 *
 * 【要排在排空之前】`bombEvents` 在同一個物理子步裡被清掉；接在清空之後
 * 讀到的永遠是 0 筆，火點永遠不點而且不報錯。
 */
export function lightGroundFires(fires: GroundFires, events: ImpactEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    if (d[o + 3] !== 0) continue
    lightGroundFire(fires, d[o]!, d[o + 1]!, d[o + 2]!)
  }
}

/**
 * 推進一步，把這一步該放的迷你爆炸吐給呼叫端。
 *
 * @param dt    **畫面時間**，不是物理子步
 * @param puff  每一朵呼叫一次，世界座標
 * @param crowd 逐格的出煙間隔倍率（`render/fireCrowd.ts`）。省略即照原速率
 */
export function stepGroundFires(
  fires: GroundFires, dt: number, puff: FirePuffFn, crowd?: Float32Array,
): void {
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
    // 【倍率必須 ≥ 1】0、負數或 NaN 會讓下面的補放迴圈永遠跳不出去 ——
    // 那是整個分頁卡死，不是畫面瑕疵。NaN 過不了這個比較，自動退回原間隔
    const m = crowd === undefined ? 1 : crowd[i]!
    const gap = m >= 1 ? FIRE_PUFF * m : FIRE_PUFF
    // 【一步只放一朵】理由同 `stepShipFires`
    do { t += gap } while (t <= 0)
    f.puff[i] = t
    puff(f.x[i]!, f.y[i]!, f.z[i]!)
  }
}

