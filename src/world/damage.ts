import { IMPACT_CAPACITY } from './events'

/**
 * 一個物理步之內的受擊事件：誰被打中、子彈**從哪個方向來**。
 *
 * 【為什麼另開一個緩衝而不是塞進 `hitEvents`】那個型別是 `x,y,z,nx,ny,nz`，
 * 消費者是火花與水柱。加兩個欄位會逼它們去猜哪幾個 float 是自己的 ——
 * `kills.ts` 的檔頭已經寫過這個理由（spec §3.1）。
 *
 * 【為什麼對每一架都推，而不是只推玩家的】`World` 不知道誰是玩家，這一版
 * 也不該讓它知道。一次 push 是四個 float，`main.ts` 自己過濾。
 *
 * 與 `hitEvents` 一樣由**呼叫端**排空。
 */
export const DAMAGE_STRIDE = 5

export interface DamageEvents {
  readonly capacity: number
  /**
   * 每筆 `DAMAGE_STRIDE` 個 float：受害者索引, dx, dy, dz（來彈方向，世界座標
   * 單位向量）, 部位序號（`HIT_PARTS` 的索引）。
   *
   * 【部位是給音效用的】打在大台的飛機、護甲厚的部位要比較低沉，見
   * `audio/curves.ts` 的 `hitRate`。受擊方向指示器只讀方向那三個。
   */
  readonly data: Float32Array
  /** 這一個子步累積了幾筆。`clearDamage` 歸零 */
  count: number
  /**
   * 因為緩衝滿了而被丟棄的累計筆數。**不會被 `clearDamage` 歸零。**
   *
   * 【為什麼累計】它是給整合測試斷言「從未溢位」用的。每次排空都歸零的話，
   * 溢位會在下一次排空時被抹掉，於是永遠測不到。
   */
  dropped: number
}

/**
 * 【容量為什麼沿用 `IMPACT_CAPACITY`】每一次命中推一筆撞擊、也推一筆受擊 ——
 * 兩者在同一個子步裡數量完全相同，所以那個 64 的推導原封不動成立。
 */
export function createDamageEvents(capacity: number = IMPACT_CAPACITY): DamageEvents {
  return {
    capacity,
    data: new Float32Array(capacity * DAMAGE_STRIDE),
    count: 0,
    dropped: 0,
  }
}

/** 追加一筆。滿了就丟棄並計數。熱路徑：不配置。 */
export function pushDamage(
  e: DamageEvents, victim: number, dx: number, dy: number, dz: number, part: number,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * DAMAGE_STRIDE
  const d = e.data
  d[o] = victim
  d[o + 1] = dx
  d[o + 2] = dy
  d[o + 3] = dz
  d[o + 4] = part
  e.count++
}

/** 排空。不動 `dropped` —— 見它的註解。 */
export function clearDamage(e: DamageEvents): void {
  e.count = 0
}
