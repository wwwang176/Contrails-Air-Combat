/**
 * 一個物理步之內產生的擊墜事件。
 *
 * 【為什麼是事件而不是每幀比對 `alive`】玩家會在**同一幀之內**死而復生 ——
 * `main.ts` 的 `if (!player.alive) respawnPlayer()` 跑在所有子步之後，一個
 * 排在它後面的邊緣偵測器看到的 `alive` 從頭到尾都是 true，玩家自己的死會
 * 被整個漏掉。把偵測器排到重生前面能修好它，但那是一個沒有任何東西保護
 * 的順序相依（M8 spec §2.1）。
 *
 * 【為什麼與 `ImpactEvents` 分開】那個型別是 `x,y,z,nx,ny,nz`；擊墜要帶
 * **速度**與**是誰**（火球要繼承母機速度、零件要取機種的機身色）。硬塞進
 * 六個 float 會逼消費者去猜哪三個是法線哪三個是速度。
 *
 * 【M9 加到 8】第 8 欄是兇手的座位索引。擊墜歸屬需要「誰打死的」，而
 * 「誰死了」這件事已經有一個緩衝在傳 —— 再開一個平行的緩衝就是兩份要
 * 同步的真相（M9 spec §4.2）。
 */
export const KILL_STRIDE = 8

export interface KillEvents {
  readonly capacity: number
  /** 每筆 `KILL_STRIDE` 個 float：x, y, z, vx, vy, vz, combatant 索引, 兇手索引（−1 = 無） */
  readonly data: Float32Array
  /** 這一個子步累積了幾筆。`clearKills` 歸零 */
  count: number
  /**
   * 因為緩衝滿了而被丟棄的累計筆數。**不會被 `clearKills` 歸零。**
   *
   * 【為什麼在「結構上不可能溢位」的情況下還留這個計數器】容量由
   * `World.add()` 維持在參戰架數，而一個子步之內每架最多死一次 —— 溢位
   * 應該是不可能的。但「應該不可能」與「測過了不可能」差一個整合測試，
   * 而掉一次擊墜等於少一次爆炸，是絕不能默默發生的事。這個數字存在的
   * 唯一目的就是讓那條斷言寫得出來（M8 spec §14.1.1）。
   */
  dropped: number
}

export function createKills(capacity: number): KillEvents {
  return {
    capacity,
    data: new Float32Array(capacity * KILL_STRIDE),
    count: 0,
    dropped: 0,
  }
}

/**
 * 追加一筆。滿了就丟棄並計數。熱路徑：不配置。
 *
 * 【為什麼 `killer` 是預設參數而不是必填】渲染層的測試（零件、火球、煙）
 * 裡有數十處只傳七個引數，那些測試關心的不是兇手。預設值讓它們原封不動
 * 繼續成立。
 */
export function pushKill(
  e: KillEvents,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  index: number,
  killer = -1,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * KILL_STRIDE
  const d = e.data
  d[o] = x
  d[o + 1] = y
  d[o + 2] = z
  d[o + 3] = vx
  d[o + 4] = vy
  d[o + 5] = vz
  d[o + 6] = index
  d[o + 7] = killer
  e.count++
}

/** 排空。不動 `dropped` —— 見它的註解。 */
export function clearKills(e: KillEvents): void {
  e.count = 0
}
