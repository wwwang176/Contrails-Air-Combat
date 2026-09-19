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

/**
 * 疊兩層時第二層的音量（相對第一層），dB。
 *
 * 【為什麼小 6 dB】兩個一樣大聲聽起來是「兩次爆炸」；小一截的第二層是陪襯，
 * 讓同一庫五個檔疊出十種組合。
 */
export const LAYER_DB = -6

/** 第二層晚多久開始，s：0–30 ms。對齊的話像同一個聲音變厚，差太多就變成兩下 */
export function layerDelay(rand: () => number): number {
  return rand() * 0.03
}

/** 每次播放的音高 ±8%：同一個檔案聽起來像好幾種 */
export function randomRate(rand: () => number): number {
  return 0.92 + rand() * 0.16
}
