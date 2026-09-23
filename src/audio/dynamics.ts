/**
 * # HDR 混音的數學
 *
 * 每個聲音跟「當下最響的那一個」比，差太多就讓位。安靜時窗口下移、細節浮出來；
 * 爆炸時窗口上移，機槍自動退到背景。**這一份全是純函數**，引擎只負責接線。
 *
 * 【為什麼不是側鏈閃避】閃避是「爆炸響 → 整條武器匯流排壓 8 dB」，一刀切；
 * 這裡是逐音源比較，離爆炸遠的機槍不會被壓，近的才會。
 */

/** 每一格包絡多久，s。與素材處理腳本寫進 `manifest.json` 的格距一致 */
export const ENVELOPE_STEP = 0.25

/**
 * 離最響者這麼多 dB 以內不衰減。
 *
 * 【安靜場景靠它維持既有的相對音量】場上只有幾個聲音時它們通常都落在這一段，
 * 於是整場等於沒有 HDR —— 每一類仍然照 `CATEGORY` 調好的數字發聲。
 */
export const HDR_KNEE_DB = 20
/** 不衰減區之外再幾 dB 到最大衰減。太窄會變成硬切 */
export const HDR_WINDOW_DB = 25
/** 最多壓多少 dB。太深被壓的類別整個消失，太淺等於沒讓位 */
export const HDR_MAX_DUCK_DB = -18
/**
 * 窗口的絕對地板，dB。
 *
 * 【為什麼需要】只有一隻蒼蠅在叫時，窗口若跟著掉到蒼蠅的高度，別的東西會被
 * 算成「相對很響」。夾住之後安靜場景不會被動到。
 */
export const HDR_ABS_FLOOR_DB = -40
/** 最響值的釋放速率，dB/s。起音是立即的 —— 爆炸要馬上壓下其他人 */
export const HDR_RELEASE_DB_PER_SEC = 12

/**
 * 不吃 HDR 的類別：玩家必須聽到的東西不能因為場面吵就消失。
 * Valve 的 HDR 也是這樣特例處理。
 */
export const HDR_EXEMPT = new Set<string>(
  ['warn', 'radio', 'engineSelf', 'fireSelf', 'ui', 'damage', 'rattle', 'wind'],
)

/**
 * 最響值走一步：立即跟上新的峰值，否則照釋放速率往下掉，不低於絕對地板。
 */
export function stepLoudest(loudest: number, peak: number, dt: number): number {
  const decayed = Math.max(HDR_ABS_FLOOR_DB, loudest - HDR_RELEASE_DB_PER_SEC * Math.max(0, dt))
  return Math.max(decayed, peak)
}

/**
 * 這個聲音要被壓幾 dB（0 或負數）。`loudness` 是它的即時響度（已含素材包絡）。
 *
 * 不衰減區之內回 0；之外照窗口寬度線性下降到 `HDR_MAX_DUCK_DB` 為止。
 */
export function hdrDuckDb(loudness: number, loudest: number): number {
  const top = Math.max(loudest, HDR_ABS_FLOOR_DB) - HDR_KNEE_DB
  if (loudness >= top) return 0
  const frac = Math.min(1, (top - loudness) / HDR_WINDOW_DB)
  return HDR_MAX_DUCK_DB * frac
}

/**
 * 低於這個就完全不發聲：一次性音效不播、循環音靜音（不停，避免反覆重播）。
 */
export function hdrFloorDb(loudest: number): number {
  return Math.max(loudest, HDR_ABS_FLOOR_DB) - HDR_KNEE_DB - HDR_WINDOW_DB
}

/**
 * 素材播到第 `age` 秒時還剩多響，dB（0 = 最響的那一格）。
 * 表是每 `ENVELOPE_STEP` 秒一格、相對自己最響那一格，**不插值**。
 *
 * 【沒有表就回 0】等於「整段一樣響」，也就是加這一層之前的行為。
 */
export function envelopeAt(table: readonly number[] | undefined, age: number): number {
  if (table === undefined || table.length === 0) return 0
  const i = Math.floor(Math.max(0, age) / ENVELOPE_STEP)
  return table[Math.min(i, table.length - 1)] ?? 0
}
