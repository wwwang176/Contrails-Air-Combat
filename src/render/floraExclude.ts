import { createFloraBuffer, FLORA_STRIDE, type FloraBuffer, type FloraSource } from './flora'

/**
 * 把一個散佈器包成「矩形內不長」。
 *
 * 先讓原本的散佈器跑進暫存緩衝，再只把落在矩形外的株搬進輸出 —— 散佈器
 * 本身一行不動，農地的樹籬、樹林、村落三支照舊。廠區的墊面用它：一塊
 * 化工廠的地上不會有樹籬與農舍。
 *
 * 【暫存與輸出同容量】搬運不會比原本多出任何一株，所以暫存滿了輸出也
 * 一定滿；`dropped` 照原樣傳回去，不靜默截斷。
 */
export interface ExcludeRect {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
  /**
   * 矩形所在座標系的原點與旋轉（世界座標／弧度）。省略時矩形就是世界矩形。
   *
   * 【廠區的墊面一定要給】墊面轉了 `PLANT_HEADING`，`x0…x1` 是**廠區局部**
   * 座標 —— 不給的話排除的是地圖原點旁邊的一塊空地，樹照長在廠房上。
   */
  readonly pivot?: { readonly x: number; readonly z: number }
  readonly heading?: number
}

/**
 * 把 `from` 的第 `i` 筆搬到 `to` 的尾巴。**每一欄都要搬**（位置、種類、形狀）——
 * 漏一欄的話那一株過一次排除就變了樣，而且不報錯
 */
function copyOne(from: FloraBuffer, i: number, to: FloraBuffer): void {
  if (to.count >= to.capacity) { to.dropped++; return }
  const o = i * FLORA_STRIDE
  const d = to.count * FLORA_STRIDE
  for (let k = 0; k < FLORA_STRIDE; k++) to.data[d + k] = from.data[o + k]!
  to.kind[to.count] = from.kind[i]!
  to.shape[to.count * 2] = from.shape[i * 2]!
  to.shape[to.count * 2 + 1] = from.shape[i * 2 + 1]!
  to.count++
}

export function excluding(source: FloraSource, rect: ExcludeRect): FloraSource {
  let scratch: FloraBuffer | null = null
  const c = Math.cos(rect.heading ?? 0)
  const s = Math.sin(rect.heading ?? 0)
  const px = rect.pivot?.x ?? 0
  const pz = rect.pivot?.z ?? 0
  // 早退用的世界外接盒：局部矩形四角轉到世界之後的 AABB
  let ax = Infinity
  let az = Infinity
  let bx = -Infinity
  let bz = -Infinity
  for (const [lx, lz] of [
    [rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1],
  ] as const) {
    const wx = px + lx * c - lz * s
    const wz = pz + lx * s + lz * c
    ax = Math.min(ax, wx); bx = Math.max(bx, wx)
    az = Math.min(az, wz); bz = Math.max(bz, wz)
  }
  return (x0, z0, x1, z1, heightAt, out) => {
    // 格子整個在外接盒外就不必過濾 —— 絕大多數的格子走這一條
    if (x1 <= ax || x0 >= bx || z1 <= az || z0 >= bz) {
      source(x0, z0, x1, z1, heightAt, out)
      return
    }
    if (scratch === null || scratch.capacity < out.capacity) scratch = createFloraBuffer(out.capacity)
    scratch.count = 0
    scratch.dropped = 0
    source(x0, z0, x1, z1, heightAt, scratch)
    for (let i = 0; i < scratch.count; i++) {
      const o = i * FLORA_STRIDE
      const rx = scratch.data[o]! - px
      const rz = scratch.data[o + 2]! - pz
      const x = rx * c + rz * s
      const z = -rx * s + rz * c
      if (x >= rect.x0 && x < rect.x1 && z >= rect.z0 && z < rect.z1) continue
      copyOne(scratch, i, out)
    }
    out.dropped += scratch.dropped
  }
}

/** 這個方框裡**可能**有要擋的地方嗎（保守：回 false 時一定沒有） */
export type BoxTest = (x0: number, z0: number, x1: number, z1: number) => boolean

/**
 * 把一個散佈器包成「`keepOut(x, z)` 為真的地方不長」。判準不是矩形的時候用：
 * 河廊、村鎮、礦坑、高速公路。
 *
 * `near`：整格先問一次，回 false 的格原樣透傳、不逐株查。**逐株查是補格的大宗**
 * （洛伊納一格上百株樹籬，每一株問一次村鎮、礦坑、高速公路），而絕大多數的格
 * 離它們很遠
 */
export function excludingWhere(
  source: FloraSource, keepOut: (x: number, z: number) => boolean, near?: BoxTest,
): FloraSource {
  let scratch: FloraBuffer | null = null
  return (x0, z0, x1, z1, heightAt, out) => {
    if (near !== undefined && !near(x0, z0, x1, z1)) {
      source(x0, z0, x1, z1, heightAt, out)
      return
    }
    if (scratch === null || scratch.capacity < out.capacity) scratch = createFloraBuffer(out.capacity)
    scratch.count = 0
    scratch.dropped = 0
    source(x0, z0, x1, z1, heightAt, scratch)
    for (let i = 0; i < scratch.count; i++) {
      const o = i * FLORA_STRIDE
      if (keepOut(scratch.data[o]!, scratch.data[o + 2]!)) continue
      copyOne(scratch, i, out)
    }
    out.dropped += scratch.dropped
  }
}
