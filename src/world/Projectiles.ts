/** spec §10：按 **M5 的 40 架**抓，不是 M2 的 2 架。 */
export const PROJECTILE_CAPACITY = 4000

/**
 * 彈丸壽命，秒（spec §5.1）。
 *
 * 【為什麼上限是壽命而不是射程】彈丸繼承射手速度之後，能不能打到取決於
 * **攔截點**而不是目標當下的距離：尾追時攔截點比現在遠（700 m 卻打不到）、
 * 迎頭時比現在近（900 m 反而打得到）。用距離上限在兩端都會判錯。
 *
 * 換成飛行時間之後，預瞄解出來的 t 直接就是判準（`t ≤ lifetime`），
 * 而且回收條件與預瞄環的顯示條件是**同一個數字**——「看得到預瞄環」
 * 就精確等於「打得到」，兩邊不可能互相矛盾。
 */
export const PROJECTILE_LIFETIME = 1.2

/**
 * 彈丸池 —— 結構化陣列（SoA），純資料，不碰場景圖。
 *
 * 【為什麼是 SoA 而不是物件陣列】4,000 個物件的陣列在每步推進時會踩遍
 * 四千個堆積物件；型別化陣列則是連續記憶體，而且**永遠不配置**——這是
 * spec §10「熱路徑零配置」在這一層的具體做法。
 */
export class Projectiles {
  readonly capacity: number

  /** 本步線段的起點（＝上一步的位置）。命中判定用的就是 s → 目前位置這一段。 */
  readonly sx: Float32Array
  readonly sy: Float32Array
  readonly sz: Float32Array

  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array

  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly vz: Float32Array

  readonly age: Float32Array
  readonly damage: Float32Array
  /**
   * 射手的 combatant 索引；−1 代表空槽。判定時用它排除自傷。
   *
   * 【船的編碼在負數區】艦上的砲用 `shipGuns.ts` 的
   * `shipOwner(i) = −1000 − i`：−1 已經是空槽標記，而 0..3 會被
   * `resolveHits` 當成同索引的**飛機** —— 錯誤排除那一架，還把命中數與
   * 助攻記到它頭上。
   */
  readonly owner: Int32Array
  /**
   * 射手的陣營：0 = blue、1 = red。**與 `resolveHits` 現有的 0/1 同一套。**
   *
   * 【為什麼不繼續從 owner 反查】船不是 combatant，反查不到 —— 同隊過濾會
   * 靜靜失效，船於是打自己人。而且射手可能在彈丸落地之前就死了。
   */
  readonly team: Int8Array
  /**
   * 這一發的壽命，秒。
   *
   * 【為什麼不是全域常數】艦上的 40 mm 要飛 2.4 秒才到得了 2,110 m，而飛機
   * 的固定槍仍然是 1.2 秒。`PROJECTILE_LIFETIME` **留著**：它同時是砲塔搜尋
   * 與 HUD 預瞄環的射程判準，那條「看得到預瞄環＝打得到」的等式不能動。
   */
  readonly life: Float32Array

  /** 環狀寫入指標。池滿時它自然會走到最舊的那一發身上。 */
  private cursor = 0

  /**
   * 下一發會寫進哪一格。**唯讀，只給重播快照用**
   * （`test/tools/spawn-snapshot.ts`）。
   *
   * 【為什麼要開這個口】兩場的彈丸陣列完全相同、但游標差一格時，下一發就
   * 會覆寫不同的格子而分岔 —— 而分岔要好幾秒才顯現在畫面上，那時已經查不
   * 出源頭。快照少了它就抓不到這件事。
   *
   * **`cursor` 維持 private**：可寫的入口仍然只有 `spawn` 與 `clear`。
   */
  get writeCursor(): number { return this.cursor }
  private liveCount = 0

  /**
   * 存活數的歷史高水位。
   *
   * 【為什麼在 `spawn()` 裡更新而不是在外面讀 `live`】在 `World.step()`
   * 回來之後才讀會**低估**：一步之內的順序是生成 → 推進／過期 → 命中／
   * 回收，讀到的是回收後的殘量，抓不到生成瞬間逼近容量的情況。
   *
   * 【它是誰要用的】「彈丸池夠不夠大」這個問題只有它答得出來。轟炸機把
   * 每步的生成量提高了一個量級（160 座砲塔），而池滿時是**覆寫最舊的
   * 那一發**（不是拒絕發射）—— 也就是說溢位不會有任何錯誤，只會讓遠處
   * 的曳光彈憑空消失。
   */
  peakLive = 0

  constructor(capacity: number = PROJECTILE_CAPACITY) {
    this.capacity = capacity
    const f = (): Float32Array => new Float32Array(capacity)
    this.sx = f(); this.sy = f(); this.sz = f()
    this.x = f(); this.y = f(); this.z = f()
    this.vx = f(); this.vy = f(); this.vz = f()
    this.age = f()
    this.damage = f()
    this.life = f()
    this.owner = new Int32Array(capacity).fill(-1)
    this.team = new Int8Array(capacity)
  }

  get live(): number {
    return this.liveCount
  }

  /**
   * 發射一發，回傳槽位索引。
   *
   * 【池滿時覆寫最舊的，不是拒絕發射】射擊永遠有反應，比「扣了扳機沒動靜」
   * 好——後者玩家會當成 bug（spec §10）。環狀指標天然就走到最舊的那一發。
   */
  spawn(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    damage: number, owner: number, team: number, life: number,
  ): number {
    const i = this.cursor
    this.cursor = (i + 1) % this.capacity
    if (this.owner[i] === -1) this.liveCount++

    this.sx[i] = px; this.sy[i] = py; this.sz[i] = pz
    this.x[i] = px; this.y[i] = py; this.z[i] = pz
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
    this.age[i] = 0
    this.damage[i] = damage
    this.owner[i] = owner
    this.team[i] = team
    this.life[i] = life
    if (this.liveCount > this.peakLive) this.peakLive = this.liveCount
    return i
  }

  /** 立刻釋放槽位（命中之後彈丸不該繼續飛）。 */
  kill(i: number): void {
    if (this.owner[i] === -1) return
    this.owner[i] = -1
    this.liveCount--
  }

  clear(): void {
    this.owner.fill(-1)
    this.liveCount = 0
    this.cursor = 0
    this.peakLive = 0
  }

  /**
   * 推進一步。等速直線，無阻力、無重力（spec §2 裁決）。
   *
   * 【先記起點再推進】命中判定吃的是 [起點, 終點] 這一段線段。240 Hz 下
   * .50 一步走 3.7 m，若只用點判定，機身厚度 0.9 m 的目標會被穿過去而
   * 完全不觸發。
   */
  step(dt: number): void {
    const { owner, capacity } = this
    for (let i = 0; i < capacity; i++) {
      if (owner[i] === -1) continue

      const age = this.age[i]! + dt
      if (age > this.life[i]!) {
        owner[i] = -1
        this.liveCount--
        continue
      }
      this.age[i] = age

      this.sx[i] = this.x[i]!
      this.sy[i] = this.y[i]!
      this.sz[i] = this.z[i]!
      this.x[i] = this.x[i]! + this.vx[i]! * dt
      this.y[i] = this.y[i]! + this.vy[i]! * dt
      this.z[i] = this.z[i]! + this.vz[i]! * dt
    }
  }
}
