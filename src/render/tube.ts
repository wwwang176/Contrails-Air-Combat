/**
 * 掃掠管的幾何原語。**不知道凝結尾的存在** —— 它只管「一串點怎麼變成管」。
 *
 * 【為什麼獨立成檔】索引緩衝與環的基底是整件事唯一「算錯了會整個爛掉」的
 * 部分，而它們都是純函數。抽出來才測得到 —— `vortex.ts` 的其餘部分要嘛是
 * 狀態機（已經有測試），要嘛是把數字搬進 `BufferAttribute`。
 */

/** 環的基底：兩個彼此正交、且都與管軸垂直的單位向量。 */
export interface RingBasis {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
}

/**
 * 由管軸方向算出環的基底。**熱路徑：寫進 `out`，不配置。**
 *
 * 環上第 `s` 個頂點是 `p + r·(cos θ·a + sin θ·b)`，`θ = 2π s / sides`。
 *
 * 【不做平行搬運】管身會沿著扭轉，但它是無光照的單色半透明管，扭轉看不
 * 出來（spec §13.5）。平行搬運要多存上一環的基底、還要處理第一環的初始化，
 * 換不到任何看得見的差別。
 *
 * 【參考向量必須挑「與管軸最不平行」的那一軸】固定用 (0,1,0) 的話，管軸
 * 剛好垂直向上時 `u × r` 是零向量，正規化得到 NaN —— 而**爬升與俯衝正好是
 * 那個方向**。挑最不平行的那一軸，叉積的長度至少是 1/√2。
 *
 * 【零向量要有定義】兩個節點在同一個位置時（斷開處的退化環）方向是零向量。
 * 回傳 NaN 的話整條管子會消失，而那正是最難察覺的情形 —— 只有在 G 掉下去
 * 又拉起來的那一瞬間才會發生。
 */
export function ringBasis(dx: number, dy: number, dz: number, out: RingBasis): void {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  // 零向量：任選一個方向。環會塌成一點，管軸指哪裡沒有意義
  const ux = len > 1e-9 ? dx / len : 1
  const uy = len > 1e-9 ? dy / len : 0
  const uz = len > 1e-9 ? dz / len : 0

  const mx = Math.abs(ux)
  const my = Math.abs(uy)
  const mz = Math.abs(uz)
  let rx = 0
  let ry = 0
  let rz = 0
  if (mx <= my && mx <= mz) rx = 1
  else if (my <= mz) ry = 1
  else rz = 1

  // a = normalize(u × r)
  let ax = uy * rz - uz * ry
  let ay = uz * rx - ux * rz
  let az = ux * ry - uy * rx
  const al = Math.sqrt(ax * ax + ay * ay + az * az)
  ax /= al
  ay /= al
  az /= al
  out.ax = ax
  out.ay = ay
  out.az = az

  // b = u × a。u 與 a 都是單位長且正交，叉積自然也是單位長，不必再正規化
  out.bx = uy * az - uz * ay
  out.by = uz * ax - ux * az
  out.bz = ux * ay - uy * ax
}

/** 一組掃掠管要幾個頂點。 */
export function tubeVertexCount(trails: number, nodes: number, sides: number): number {
  return trails * nodes * sides
}

/**
 * 索引緩衝。**建一次就不動** —— 管子畫好之後不會移動。
 *
 * 每一條尾跡擁有 `nodes × sides` 個**連續**頂點；環 `i` 與 `i+1` 之間一圈
 * 四邊形，側面 `sides−1` 接回側面 0（管子是閉合的）。
 *
 * 【三角形一律落在同一條尾跡之內】跨過去的話會出現一條橫跨兩架飛機的管子，
 * 而它只在兩條尾跡同時活著時才看得到。
 */
export function tubeIndices(trails: number, nodes: number, sides: number): Uint32Array {
  const quads = trails * (nodes - 1) * sides
  const idx = new Uint32Array(quads * 6)
  let k = 0
  for (let t = 0; t < trails; t++) {
    const base = t * nodes * sides
    for (let i = 0; i < nodes - 1; i++) {
      const r0 = base + i * sides
      const r1 = r0 + sides
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides
        idx[k++] = r0 + s
        idx[k++] = r1 + s
        idx[k++] = r1 + s1
        idx[k++] = r0 + s
        idx[k++] = r1 + s1
        idx[k++] = r0 + s1
      }
    }
  }
  return idx
}
