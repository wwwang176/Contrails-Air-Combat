/** 設定頁的音量檔位。null 是關閉 —— 關閉時整個音訊暫停，不只是乘 0 */
export const VOLUME_LEVELS: readonly { label: string; db: number | null }[] = [
  { label: '關閉', db: null },
  { label: '低', db: -12 },
  { label: '中', db: -6 },
  { label: '高', db: 0 },
]

export const DEFAULT_VOLUME_DB = -6
const KEY = 'audio.volume'

/**
 * 讀寫都包 try —— 無痕視窗與封鎖站台資料會讓 localStorage 直接拋，
 * 那時只是不記得選擇，遊戲照樣能玩。不在檔位裡的值當成沒設定。
 */
export function readVolume(): number | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v === null) return DEFAULT_VOLUME_DB
    if (v === 'off') return null
    const n = Number(v)
    return VOLUME_LEVELS.some((l) => l.db === n) ? n : DEFAULT_VOLUME_DB
  } catch {
    return DEFAULT_VOLUME_DB
  }
}

export function saveVolume(db: number | null): void {
  try {
    localStorage.setItem(KEY, db === null ? 'off' : String(db))
  } catch { /* 存不了就算了，見上面 */ }
}
