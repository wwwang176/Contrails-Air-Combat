/**
 * 一個物理步之內產生的撞擊事件。
 *
 * 【為什麼是事件而不是狀態】火花一噴出就與飛機脫鉤、水柱錨在海面上的一個
 * 定點 —— 兩者都**沒有可以重算的錨點**（槍焰有，所以它走計時器，見
 * M7 spec §2.1）。
 *
 * 【為什麼在子步回呼裡排空而不是幀尾】`main.ts` 已經為 `hitsDealt` 寫過
 * 這個理由：`World.step` 在每個物理步開頭把它歸零，而一幀可能跑好幾步；
 * 在幀尾才讀的話，最後一步以外的全部漏掉。排空之後清空，所以容量只需要
 * 覆蓋**一個子步**。
 *
 * 【為什麼命中與入海共用一個型別】水柱就是「法線朝上的撞擊」。為了省三個
 * float 寫兩份長得很像的結構，就是只有一份會被修好的那種危險。
 */
export const IMPACT_STRIDE = 6

/**
 * 每個子步的事件容量。
 *
 * 【64 怎麼來】40 架全開火是 2,434 發/s（藍隊 20 × 6 挺 × 13.3/s，
 * 加紅隊 20 × (11.7 + 2 × 15)/s）。假設**全部命中**（物理上不可能），
 * 60 fps 下是 41 次/幀，除以 8 個子步約 6 次/子步。64 是它的 10 倍。
 */
export const IMPACT_CAPACITY = 64

export interface ImpactEvents {
  readonly capacity: number
  /** 每筆 `IMPACT_STRIDE` 個 float：x, y, z, nx, ny, nz */
  readonly data: Float32Array
  /** 這一個子步累積了幾筆。`clearImpacts` 歸零 */
  count: number
  /**
   * 因為緩衝滿了而被丟棄的累計筆數。**不會被 `clearImpacts` 歸零。**
   *
   * 【為什麼累計】它是給整合測試斷言「從未溢位」用的。每次排空都歸零的話，
   * 溢位會在下一次排空時被抹掉，於是永遠測不到。
   */
  dropped: number
  /**
   * 累計推進的筆數。**不會被 `clearImpacts` 歸零。**
   *
   * 緩衝裡第 e 筆的流水號是 `total − count + e`。消費者記自己處理到哪一個
   * 流水號，同一筆事件就不會在呼叫端沒排空時被處理第二次 —— 與
   * `KillEvents.total` 逐字同一個理由。**有兩個消費者的緩衝一定要靠它**：
   * `groundKillEvents` 由 `main.ts` 點火、由 `stepBattle` 生通報，而 headless
   * 的測試根本不排空。
   */
  total: number
}

export function createImpacts(capacity: number = IMPACT_CAPACITY): ImpactEvents {
  return {
    capacity,
    data: new Float32Array(capacity * IMPACT_STRIDE),
    count: 0,
    dropped: 0,
    total: 0,
  }
}

/**
 * 追加一筆。滿了就丟棄並計數。
 *
 * 【為什麼是丟棄而不是擴容】這是熱路徑上的緩衝，擴容就是配置。而它裝的是
 * 純裝飾的東西 —— 掉幾顆火花沒有人看得出來，但一次意外的配置會出現在
 * 每一個物理步。
 *
 * 熱路徑：不配置。
 */
export function pushImpact(
  e: ImpactEvents,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * IMPACT_STRIDE
  const d = e.data
  d[o] = x
  d[o + 1] = y
  d[o + 2] = z
  d[o + 3] = nx
  d[o + 4] = ny
  d[o + 5] = nz
  e.count++
  // 【丟掉的不算進流水號】算進去的話，「第 e 筆的流水號是 total − count + e」
  // 就不成立，消費者的游標會整批錯位。與 `pushKill` 同一條。
  e.total++
}

/** 排空。不動 `dropped` —— 見它的註解。 */
export function clearImpacts(e: ImpactEvents): void {
  e.count = 0
}
