/**
 * 地形的高度場。**渲染與碰撞共用的那一份資料就是它。**
 *
 * 【為什麼這個檔案不 import three】它同時被三種呼叫端讀：`render/island.ts`
 * 切 mesh、`render/terrain.ts` 的 `heightAt` 做撞地判定、以及 headless 的
 * 單元測試。把渲染相依拖進來的話，第三種就得在 node 裡載入整個 three。
 *
 * 【它為什麼是一份資料而不是一個函數】`render/terrain.ts` 的鐵律：
 *
 * > 【必須與畫面上那一份是同一份】…兩者分家的話，飛機會撞到一片看不見的海。
 *
 * 海面現在能維持 CPU 一份、GLSL 一份，是因為波是五道解析的正弦、兩邊逐位元
 * 對得上。地形做不到那件事 —— 所以改成只有一份資料，兩邊都讀它。
 */

export interface HeightFieldData {
  /**
   * 邊長的**頂點數**，不是格子數。格子數是 `size − 1`。
   *
   * 【差一格的後果】整張圖會偏移半格到一格，而那在遊戲裡看起來像「撞到
   * 看不見的東西」—— 畫面上的島在這裡，碰撞用的島在隔壁。
   */
  readonly size: number
  /** 相鄰兩個頂點的世界距離，m */
  readonly cell: number
  /** `size²` 個高度，列優先（`row * size + col`）。就地寫入 */
  readonly data: Float32Array
  /**
   * 世界座標 (x, z) 的高度，m。
   *
   * **內插方式必須與 `render/island.ts` 切三角形的方式相同。** 見下面實作
   * 裡的說明 —— 這是那條鐵律唯一真正的落點。
   *
   * 出界回 `-Infinity` —— 呼叫端一律與海面取 max，所以出界會自然退回
   * 純海面，不必在每個呼叫點寫邊界判斷。
   *
   * 熱路徑（撞地判定 40 架 × 240 Hz），不配置。
   */
  sample(x: number, z: number): number
}

/**
 * 建一張全零的高度場。座標原點在**場地中心**：第 `i` 個頂點的世界座標是
 * `(i − (size−1)/2) × cell`。
 */
export function createHeightField(size: number, cell: number): HeightFieldData {
  const data = new Float32Array(size * size)
  // 頂點索引與世界座標的位移量。(size−1)/2 而不是 size/2 —— 見 `size` 的說明
  const half = (size - 1) / 2
  const last = size - 1

  return {
    size,
    cell,
    data,
    sample(x, z) {
      // 浮點的頂點索引
      const fx = x / cell + half
      const fz = z / cell + half
      if (!(fx >= 0) || fx > last || !(fz >= 0) || fz > last) return -Infinity

      const c0 = Math.floor(fx)
      const r0 = Math.floor(fz)
      // 落在最後一個頂點上時 c0 已經是 last，夾住避免越界。此時 tx = 0，
      // 那一項的權重是 0，所以夾住不影響結果。
      const c1 = c0 < last ? c0 + 1 : last
      const r1 = r0 < last ? r0 + 1 : last
      const tx = fx - c0
      const tz = fz - r0

      const i0 = r0 * size
      const i1 = r1 * size
      const h00 = data[i0 + c0]!
      const h10 = data[i0 + c1]!
      const h01 = data[i1 + c0]!
      const h11 = data[i1 + c1]!

      /**
       * 【為什麼不是雙線性】畫面上那一格是**兩個平面三角形**，不是雙線性
       * 曲面。四個角不共平面時兩者在格子內部不相等 —— 用單元測試那組
       * 0/100/200/400 來說，中心的雙線性是 175，而三角形上是 150。
       *
       * 差 25 m 的「看不見的地形」正是 `render/terrain.ts` 那條鐵律要防的
       * 東西，而只比對頂點的護欄抓不到它（頂點上兩種內插本來就相同）。
       *
       * 【對角線的方向必須跟著 island.ts】那邊的索引是
       * `a,c,b` 與 `b,c,d`，其中 a 左上、b 右上、c 左下、d 右下 ——
       * 對角線是 b–c，也就是 `tx + tz = 1` 這條線。**動了那邊就要動這裡。**
       */
      if (tx + tz <= 1) {
        // 三角形 a–c–b
        return h00 + (h10 - h00) * tx + (h01 - h00) * tz
      }
      // 三角形 b–c–d，以 d 為基準
      return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz)
    },
  }
}

/** `normalAt` 的輸出。就地填寫 —— 熱路徑不得配置 */
export interface SurfaceNormal {
  nx: number
  ny: number
  nz: number
}

/**
 * 世界座標 (x, z) 那個面的單位法線。就地寫進 `out`。
 *
 * 【為什麼不是中央差分】差分算的是跨好幾格的平滑近似 —— 那是憑空多出來的
 * 第三份幾何。畫面上那一格是**兩個平面三角形**（見 `sample`），而平面的
 * 法線是閉式的。這裡與 `sample` 共用同一段對角線判斷，所以不會有第二個
 * 真相。動了 `sample` 的對角線方向就要動這裡。
 *
 * ```
 *   三角形 a–c–b   dh/dx = (h10 − h00)/cell   dh/dz = (h01 − h00)/cell
 *   三角形 b–c–d   dh/dx = (h11 − h01)/cell   dh/dz = (h11 − h10)/cell
 *   n = normalize(−dh/dx, 1, −dh/dz)
 * ```
 *
 * 【場外回正上方】與 `sample` 回 −Infinity 是同一個分工：那裡回一個
 * 「比什麼都低」的哨兵，這裡回一個不會製造 NaN 的方向。
 */
export function normalAt(
  f: HeightFieldData, x: number, z: number, out: SurfaceNormal,
): void {
  const { size, cell, data } = f
  const half = (size - 1) / 2
  const last = size - 1
  const fx = x / cell + half
  const fz = z / cell + half
  if (!(fx >= 0) || fx > last || !(fz >= 0) || fz > last) {
    out.nx = 0
    out.ny = 1
    out.nz = 0
    return
  }

  const c0 = Math.floor(fx)
  const r0 = Math.floor(fz)
  const c1 = c0 < last ? c0 + 1 : last
  const r1 = r0 < last ? r0 + 1 : last
  const tx = fx - c0
  const tz = fz - r0

  const i0 = r0 * size
  const i1 = r1 * size
  const h00 = data[i0 + c0]!
  const h10 = data[i0 + c1]!
  const h01 = data[i1 + c0]!
  const h11 = data[i1 + c1]!

  let dhdx: number
  let dhdz: number
  if (tx + tz <= 1) {
    dhdx = (h10 - h00) / cell
    dhdz = (h01 - h00) / cell
  } else {
    dhdx = (h11 - h01) / cell
    dhdz = (h11 - h10) / cell
  }
  const len = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz)
  out.nx = -dhdx / len
  out.ny = 1 / len
  out.nz = -dhdz / len
}
