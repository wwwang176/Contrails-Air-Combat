/** 播過的段落由舊到新（`localStorage` 的鍵，JSON 字串陣列）。見 `markShotSeen` */
const SEEN_SHOTS_KEY = 'reel.seenShots'

/** 讀寫都包 try —— 無痕視窗與封鎖站台資料會讓 localStorage 直接拋，那時只是不記得 */
export function readSeenShots(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SEEN_SHOTS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function saveSeenShots(seen: readonly string[]): void {
  try {
    localStorage.setItem(SEEN_SHOTS_KEY, JSON.stringify(seen))
  } catch { /* 存不了就算了 */ }
}
