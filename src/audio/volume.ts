/** 設定頁的音量檔位。null 是關閉 —— 關閉時整個音訊暫停，不只是乘 0 */
/**
 * 混音留的餘裕，dB。**「高」是這個值，不是 0 dBFS。**
 *
 * 【為什麼不是 0】0 等於「滿檔沒有餘裕」：大場面的總和一頂到上限就只能靠
 * 限幅器硬壓，而長時間貼著滿刻度本身就吵、也容易在喇叭端失真。混音該有餘裕，
 * 讓限幅器只在意外的疊加時介入。
 *
 * 【選了多少】−9 dB。齊投與編隊掠過那種最吵的場面實測峰值約 −1.5 dBFS，
 * 減 9 之後落在 −10 附近，留得下一次爆炸的瞬間。**起始值，由試聽裁定。**
 */
export const MIX_HEADROOM_DB = -9

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
