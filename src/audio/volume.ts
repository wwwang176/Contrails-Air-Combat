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
 * 那時只是不記得選擇，遊戲照樣能玩。
 *
 * 【只認存進去的那幾個字串】`Number('')` 是 0 —— 用數字比對的話，被清空的值
 * 會變成「高」，以最大聲開場。
 */
export function readVolume(): number | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'off') return null
    const hit = VOLUME_LEVELS.find((l) => l.db !== null && String(l.db) === v)
    return hit === undefined ? DEFAULT_VOLUME_DB : hit.db
  } catch {
    return DEFAULT_VOLUME_DB
  }
}

export function saveVolume(db: number | null): void {
  try {
    localStorage.setItem(KEY, db === null ? 'off' : String(db))
  } catch { /* 存不了就算了，見上面 */ }
}
