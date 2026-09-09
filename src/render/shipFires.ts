import { Quaternion, Vector3 } from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'
import type { Ship } from '../world/ships'

/**
 * # 船上的火災
 *
 * 炸彈或魚雷的命中點會起火。火災是**每 0.3 秒一朵迷你爆炸**，外加一道
 * 垂直向上的煙 —— 兩者都由呼叫端從既有的池子生出來，這一層只管
 * 「哪裡有火、還要燒多久、這一步該不該噴」。
 *
 * 【為什麼住在算繪層】它沒有任何模擬後果：不扣血、不影響 AI、不進判定。
 * 放進 `World` 就要進逐位元重播的討論，而它連一個位元的判定都不影響 ——
 * 與 `sparks`／`smoke`「純裝飾，不參與判定也不需要決定性」是同一條。
 */

/** 一個火點燒多久，秒。 */
export const FIRE_SECONDS = 60

/**
 * 迷你爆炸的間隔，秒。
 *
 * 【為什麼不是每幀一朵】60 fps 下一分鐘會是 3,600 朵 —— 那不是火災，
 * 是一台機關槍。
 */
export const FIRE_PUFF = 0.3

/**
 * 同時最多幾個火點。
 *
 * 八艘船挨滿彈也到不了；滿了覆寫最舊的（與 `Bombs` 的環狀池同一個做法）
 * —— 火是純裝飾，掉一個沒有人看得出來。
 */
export const SHIP_FIRE_CAPACITY = 64

/**
 * 一朵迷你爆炸要放在哪。世界座標。
 *
 * 【`v*` 是火源當下的速度，省略即靜止】火團在自己的壽命裡是自由飛的，不
 * 掛在任何父物件上。不給速度的話，一具每秒掉八十公尺的殘骸每 0.3 秒在原地
 * 留一團 —— 畫面上是一串間隔二十四公尺的獨立爆炸，不是一團跟著它的火。
 * 船與地面目標慢到不必給。
 */
export type FirePuffFn = (
  x: number, y: number, z: number,
  vx?: number, vy?: number, vz?: number,
) => void

export interface ShipFires {
  readonly capacity: number
  /** `Ship.index`；−1 = 這一格是空的 */
  readonly ship: Int32Array
  /** 起火點，**艦體座標** */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /**
   * 還要燒幾秒、距離下一朵迷你爆炸還有幾秒。
   *
   * 【為什麼這兩格是 float64 而座標是 float32】它們是**累加的計時器**，而
   * `puff` 的判斷是 `t > 0` —— float32 存 0.3 會變成 0.30000001，減掉 0.3
   * 之後餘 1.2e-8，於是剛好卡在門檻上的那一步整個跳過。座標沒有這個問題：
   * 那是一次性的量，不累加。
   */
  readonly left: Float64Array
  /** 距離下一朵迷你爆炸還有幾秒 */
  readonly puff: Float64Array
  readonly live: number
  /**
   * 全部熄掉。**名字是 `reset` 而不是 `clear`** —— `main.ts` 的 `POOLS`
   * 對每一個成員叫 `reset()`，換一場的兩個入口都走那一條。叫別的名字就
   * 進不了那份清單，而漏清的症狀是上一場的火跟著船索引附到新一場的船上，
   * 燒滿 60 秒。
   */
  reset(): void
}

interface Mutable extends ShipFires {
  live: number
  cursor: number
}

export function createShipFires(capacity: number = SHIP_FIRE_CAPACITY): ShipFires {
  const f: Mutable = {
    capacity,
    ship: new Int32Array(capacity).fill(-1),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity),
    left: new Float64Array(capacity),
    puff: new Float64Array(capacity),
    live: 0,
    cursor: 0,
    reset() {
      this.ship.fill(-1)
      this.live = 0
      this.cursor = 0
    },
  }
  return f
}

/** 熱路徑不配置 */
const P = /* @__PURE__ */ new Vector3()
const INV = /* @__PURE__ */ new Quaternion()

/**
 * 依命中事件起火。**只吃打中船的那幾筆**（`nz >= 0`）。
 *
 * 【世界座標要換算回艦體座標】船在動。存世界座標的話火會留在原地、船從
 * 火裡開出去 —— 而畫面上那看起來像「海面上有一團火」，不像缺陷。
 *
 * @param events `bombEvents` 或 `torpedoEvents`。**這一支不排空** ——
 *               排空是既有呼叫端的責任，兩者都要讀同一批事件
 */
export function lightShipFires(
  fires: ShipFires, events: ImpactEvents, ships: readonly Ship[],
): void {
  const f = fires as Mutable
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    const index = d[o + 5]!
    if (index < 0) continue
    // 【只認打中船的那一筆】第六格對建築帶的是建築的索引（`nx = 3`），
    // 拿去查船會讓火長到編號相同的那一艘船上。魚雷事件的 `nx` 是 0/1，
    // 帶索引的一律是船，所以只擋炸彈的 3
    if (d[o + 3] === 3) continue
    const s = ships[index]
    // 【找不到就不起火】索引對不上時寧可不畫，也不要讀到 undefined
    if (s === undefined || s.index !== index) continue

    const i = f.cursor
    f.cursor = (i + 1) % f.capacity
    if (f.ship[i] === -1) f.live++

    // 世界 → 艦體：先扣掉船的位置，再套艏向的反轉
    P.set(d[o]! - s.position.x, d[o + 1]! - s.position.y, d[o + 2]! - s.position.z)
    P.applyQuaternion(INV.copy(s.orientation).invert())
    // 【不沉到水線以下】艦體座標的原點就在水線上（`world/ships.ts`），所以
    // 夾在 0 等於夾在水面。魚雷的引爆事件帶的是**雷體自己的高度**
    // （定深 −1 m），不夾的話那根煙柱從水面底下長出來
    f.x[i] = P.x; f.y[i] = P.y > 0 ? P.y : 0; f.z[i] = P.z
    f.ship[i] = index
    f.left[i] = FIRE_SECONDS
    // 【第一朵立刻放】歸零的話玩家要等 0.3 秒才看得到命中處起火
    f.puff[i] = 0
  }
}

/**
 * 推進一步，並把這一步該放的迷你爆炸吐給呼叫端。
 *
 * 【沉了照樣燒完】一艘剛沉的船在海面上冒煙是對的。它已經 `alive === false`
 * 不會再挨彈，所以「不再開新的火點」是自動成立的。
 *
 * @param dt   **畫面時間**，不是物理子步 —— 火是純裝飾
 * @param puff 每一朵迷你爆炸呼叫一次，世界座標
 */
export function stepShipFires(
  fires: ShipFires, ships: readonly Ship[], dt: number, puff: FirePuffFn,
): void {
  const f = fires as Mutable
  for (let i = 0; i < f.capacity; i++) {
    const index = f.ship[i]!
    if (index === -1) continue

    const left = f.left[i]! - dt
    if (left <= 0) {
      f.ship[i] = -1
      f.live--
      continue
    }
    f.left[i] = left

    let t = f.puff[i]! - dt
    if (t > 0) { f.puff[i] = t; continue }

    const s = ships[index]
    // 【船不見了就熄掉】換一場而池沒清乾淨時走這一條
    if (s === undefined) { f.ship[i] = -1; f.live--; continue }

    // 艦體 → 世界
    P.set(f.x[i]!, f.y[i]!, f.z[i]!).applyQuaternion(s.orientation).add(s.position)
    // 【一步只放一朵】dt 大於 FIRE_PUFF 時（掉幀）補放沒有意義 —— 那一幀
    // 的畫面只會出現一次，多放的幾朵疊在同一個位置
    do { t += FIRE_PUFF } while (t <= 0)
    f.puff[i] = t
    puff(P.x, P.y, P.z)
  }
}
