/**
 * 音效庫挑一個。**不與上一次相同** —— 連續兩下一模一樣的爆炸，聽得出是同一段錄音。
 * 只有一個成員時照樣回 0。
 */
export function pickNoRepeat(size: number, last: number, rand: () => number): number {
  if (size <= 1) return 0
  let k = Math.floor(rand() * size)
  if (k === last) k = (k + 1 + Math.floor(rand() * (size - 1))) % size
  return k
}

/** 每次播放的音高 ±8%：同一個檔案聽起來像好幾種 */
export function randomRate(rand: () => number): number {
  return 0.92 + rand() * 0.16
}
