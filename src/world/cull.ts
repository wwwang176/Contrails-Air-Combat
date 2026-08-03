/**
 * 命中判定的粗篩索引 —— 沿 X 軸排序的並排陣列（spec §5.2）。
 *
 * 【為什麼是排序掃描而不是網格】實測（spec §5.1）：40 架 × 滿載 4,000 發，
 * 全掃描的粗篩要 7,408 µs，排序掃描只要 202 µs。中間試過「把位置攤平成
 * Float32Array」，只省 7% —— 成本不在指標穿越，在那 160,000 次距離計算
 * 本身。要贏只能**不做那些計算**。
 *
 * 【為什麼不知道 World 的存在】等價測試（test/unit/cull-equivalence）要能
 * 單獨呼叫掃描並與暴力法比對。與 World 綁在一起就只能透過整個 step 間接
 * 觀察，而那時候已經分不出「粗篩漏了」與「命中盒算錯」。
 */
export class CullIndex {
  /** 重心座標，**依 x 遞增排序**。只有前 count 格有效 */
  x: Float32Array
  y: Float32Array
  z: Float32Array
  /** 包圍球半徑的平方 */
  r2: Float32Array
  /** 對應的 `World.combatants` 索引 */
  index: Int32Array
  /** 陣營，0 或 1。同隊的彈丸直接穿過（spec §5.4） */
  team: Uint8Array

  count = 0
  /**
   * 本次填入的最大包圍球半徑，m。滑動視窗的半寬（spec §5.3）。
   *
   * 【每次重算，不是常數】換機種會變（P-51D 與 Bf 109 的包圍球不同）。
   * 寫死一個值會在換裝時算出太窄的視窗，靜靜地漏掉命中 —— 玩家看到曳光彈
   * 穿過機翼卻不扣血，而且只在特定機種組合下發生。
   */
  rMax = 0

  private cap = 0

  constructor(capacity = 8) {
    // 先讓欄位有值（strict 的明確賦值檢查），ensure 立刻換成足夠大的
    this.x = new Float32Array(0)
    this.y = new Float32Array(0)
    this.z = new Float32Array(0)
    this.r2 = new Float32Array(0)
    this.index = new Int32Array(0)
    this.team = new Uint8Array(0)
    this.ensure(capacity < 8 ? 8 : capacity)
  }

  /**
   * 確保容量至少 n。
   *
   * 【為什麼容量不是一個寫死的數字】飛機數在 `World.add` 時才知道，而 `add`
   * 不是熱路徑。穩態下 `ensure` 一次都不會重新配置，所以「熱路徑零配置」
   * 仍然成立，同時也沒有一個「最多幾架」的魔術上限等著某天被撞破。
   */
  ensure(n: number): void {
    if (n <= this.cap) return
    this.x = new Float32Array(n)
    this.y = new Float32Array(n)
    this.z = new Float32Array(n)
    this.r2 = new Float32Array(n)
    this.index = new Int32Array(n)
    this.team = new Uint8Array(n)
    this.cap = n
  }

  clear(): void {
    this.count = 0
    this.rMax = 0
  }

  add(x: number, y: number, z: number, radius: number, index: number, team: number): void {
    const i = this.count++
    this.x[i] = x
    this.y[i] = y
    this.z[i] = z
    this.r2[i] = radius * radius
    this.index[i] = index
    this.team[i] = team
    if (radius > this.rMax) this.rMax = radius
  }

  /**
   * 依 x 遞增排序。
   *
   * 【為什麼是插入排序】飛機數是數十的量級，而且幀間的排列幾乎已經排好
   * （240 Hz 下一步只移動幾公尺），實際比較次數接近 O(N)。不配置、不遞迴，
   * 也不需要一個間接的順序陣列 —— 六個並排陣列一起搬。
   */
  sort(): void {
    const { x, y, z, r2, index, team, count } = this
    for (let i = 1; i < count; i++) {
      const kx = x[i]!, ky = y[i]!, kz = z[i]!
      const kr = r2[i]!, ki = index[i]!, kt = team[i]!
      let j = i - 1
      while (j >= 0 && x[j]! > kx) {
        x[j + 1] = x[j]!
        y[j + 1] = y[j]!
        z[j + 1] = z[j]!
        r2[j + 1] = r2[j]!
        index[j + 1] = index[j]!
        team[j + 1] = team[j]!
        j--
      }
      x[j + 1] = kx
      y[j + 1] = ky
      z[j + 1] = kz
      r2[j + 1] = kr
      index[j + 1] = ki
      team[j + 1] = kt
    }
  }

  /** 第一個 `x >= value` 的槽位；全部都小於時回傳 `count`。 */
  lowerBound(value: number): number {
    const x = this.x
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (x[mid]! < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
