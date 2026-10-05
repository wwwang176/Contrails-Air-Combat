/** 32 位元整數雜湊 → [0, 1)。相同索引產生相同結果，不消耗亂數狀態。 */
export function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
