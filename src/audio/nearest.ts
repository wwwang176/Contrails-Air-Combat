import type { Vector3 } from 'three'

const DIST = new Float64Array(64)

/**
 * 從前 count 個位置挑離 (px,py,pz) 最近、`valid` 為真的幾個，索引依距離寫進 out，
 * 回傳實際數量。**上限就是 out 的長度**（最多 64）。
 *
 * 【插入排序、不配置】out 只有十來格、候選最多 40 —— 每幀跑一次。
 */
export function nearestN(
  positions: readonly Vector3[], valid: Uint8Array, count: number,
  px: number, py: number, pz: number, out: Int32Array,
): number {
  const n = Math.min(out.length, DIST.length)
  let m = 0
  for (let i = 0; i < count; i++) {
    if (!valid[i]) continue
    const p = positions[i]!
    const dx = p.x - px, dy = p.y - py, dz = p.z - pz
    const d = dx * dx + dy * dy + dz * dz
    let j: number
    if (m < n) {
      j = m++
    } else {
      if (d >= DIST[n - 1]!) continue
      j = n - 1
    }
    while (j > 0 && DIST[j - 1]! > d) {
      DIST[j] = DIST[j - 1]!
      out[j] = out[j - 1]!
      j--
    }
    DIST[j] = d
    out[j] = i
  }
  return m
}
