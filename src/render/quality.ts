/**
 * 畫面品質的設定：繪圖解析度的檔位與抗鋸齒。**純資料、純函式，加上兩支存取器**
 * —— `render/scene.ts` 與 `ui/menu.ts` 都要用它，UI 那一側不該為了幾個常數把
 * 整個算繪堆疊拉進來。
 *
 * 【檔位是絕對的 pixel ratio】同一檔在任何螢幕上的負擔相同：平衡在桌機與手機都是
 * 每個 CSS 像素畫一個像素。代價是比螢幕 dpr 高的檔位沒有作用 —— 那幾檔夾回螢幕
 * 的 dpr，選單上灰掉（`qualityAvailable`）。
 *
 * 【HUD 不受影響】儀表板是另一張 2D 畫布，尺寸吃 `window.devicePixelRatio`
 * （`hud/Hud.ts`），與這裡設的 pixel ratio 無關 —— 降檔位時文字與刻度仍是原生清晰度。
 */
import type { MessageKey } from '../i18n'

export interface QualityLevel {
  /** 按鈕上的字的鍵（`src/i18n`） */
  readonly labelKey: MessageKey
  /** 給 renderer 的 pixel ratio，再夾到 `pixelRatioFor` 的上限 */
  readonly pixelRatio: number
  /**
   * 鏡頭周圍多少公尺內的田色仍逐像素算，m；0 = 全部查貼圖。
   *
   * 【為什麼前兩檔要留一圈】貼圖是 2 m 一格，貼地 100 m 以下田埂的邊緣會軟；
   * 算式在那一圈裡與貼圖上線前的畫面逐位元相同。代價只在貼地飛時付 ——
   * 平飛與投彈時那一圈是畫面很小的一塊。見 `render/fieldClipmap.ts`。
   */
  readonly fieldInner: number
}

/**
 * 順序即按鈕順序。**由高到低**。
 *
 * 【標籤只寫感受，不寫數字】pixel ratio 是這裡的實作細節，玩家要選的是畫面清楚
 * 還是順，不是解析度乘數。
 */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { labelKey: 'settings.quality.ultra', pixelRatio: 2, fieldInner: 500 },
  { labelKey: 'settings.quality.sharp', pixelRatio: 1.5, fieldInner: 500 },
  { labelKey: 'settings.quality.balanced', pixelRatio: 1, fieldInner: 0 },
  { labelKey: 'settings.quality.smooth', pixelRatio: 0.75, fieldInner: 0 },
  { labelKey: 'settings.quality.fast', pixelRatio: 0.5, fieldInner: 0 },
]

/** 沒有設定過時用的檔位：平衡 */
export const DEFAULT_QUALITY = 1

/**
 * pixel ratio 的上限。4K 筆電的 dpr 可以到 3，照畫的話像素數比 2 多出一倍以上。
 */
const MAX_PIXEL_RATIO = 2

/** 這台螢幕畫得到的最高 pixel ratio：螢幕的 dpr，不超過 `MAX_PIXEL_RATIO` */
function deviceCap(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return Math.min(dpr, MAX_PIXEL_RATIO)
}

/**
 * 檔位的田色內圈半徑。**存的是 `pixelRatio`，查表拿另一個欄位** —— 設定只記一個
 * 數字，其餘都由它查出來。對不上任何檔位（手改過的存檔）回到第一檔：
 * 寧可多算一圈，也不要讓貼地的畫面變軟而沒有人選過。
 */
export function fieldInnerFor(pixelRatio: number): number {
  const lv = QUALITY_LEVELS.find((q) => q.pixelRatio === pixelRatio)
  return (lv ?? QUALITY_LEVELS[0]!).fieldInner
}

/**
 * 檔位換算成要給 renderer 的 pixel ratio：檔位本身，夾到這台螢幕的上限。
 *
 * 【不超取樣】畫得比螢幕 dpr 細只會更慢。壞掉的輸入（NaN、無限大、0、負數）
 * 一律回到預設 —— 0 像素的畫布是黑畫面，而且不會報錯。
 */
export function pixelRatioFor(pixelRatio: number, devicePixelRatio: number): number {
  const q = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : DEFAULT_QUALITY
  return Math.min(q, deviceCap(devicePixelRatio))
}

/**
 * 這一檔在這台螢幕上有沒有作用：夾過上限之後，是否仍比下一檔畫得細。
 * 沒作用的那幾檔與下一檔畫出來一模一樣，選單把它們灰掉。最低一檔恆有作用。
 */
export function qualityAvailable(pixelRatio: number, devicePixelRatio: number): boolean {
  const i = QUALITY_LEVELS.findIndex((q) => q.pixelRatio === pixelRatio)
  const lower = QUALITY_LEVELS[i + 1]
  return i < 0 || lower === undefined || lower.pixelRatio < deviceCap(devicePixelRatio)
}

/**
 * 抗鋸齒的兩個選項。
 *
 * 【為什麼只有開與關】`antialias` 是建立 WebGL context 時的參數，WebGL 不讓
 * 呼叫端指定樣本數（這台瀏覽器給 4×）。要 2× 得自己畫到多重取樣的離屏緩衝
 * 再解析，那是另一條路。
 *
 * 【為什麼換它要重新載入】同一個理由：context 建好就換不了，換它等於重建
 * 整個 renderer，而場景、材質、貼圖全掛在舊的 context 上。
 */
export const ANTIALIAS_LEVELS: readonly { labelKey: MessageKey; value: boolean }[] = [
  { labelKey: 'common.on', value: true },
  { labelKey: 'common.off', value: false },
]

/** 沒有設定過時的抗鋸齒：開啟 */
export const DEFAULT_ANTIALIAS = true

/**
 * 光暈（`render/bloom.ts`）的檔位。換它不必重新載入。
 *
 * - 低：光源圖半解析度，遠處的曳光彈放粗（不然會閃）
 * - 高：光源圖全解析度，不放粗
 */
export type BloomLevel = 'off' | 'low' | 'high'

export const BLOOM_LEVELS: readonly { labelKey: MessageKey; value: BloomLevel }[] = [
  { labelKey: 'common.off', value: 'off' },
  { labelKey: 'settings.bloom.low', value: 'low' },
  { labelKey: 'settings.bloom.high', value: 'high' },
]

/** 沒有設定過時的光暈：低 */
export const DEFAULT_BLOOM: BloomLevel = 'low'

const BLOOM_KEY = 'gfx.bloom'

/** 【舊版的開關】`1` 是開（半解析度，就是現在的低）、`0` 是關 */
export function readBloom(): BloomLevel {
  try {
    const v = localStorage.getItem(BLOOM_KEY)
    if (v === '1') return 'low'
    if (v === '0') return 'off'
    return BLOOM_LEVELS.find((lv) => lv.value === v)?.value ?? DEFAULT_BLOOM
  } catch {
    return DEFAULT_BLOOM
  }
}

export function saveBloom(level: BloomLevel): void {
  try {
    localStorage.setItem(BLOOM_KEY, level)
  } catch { /* 存不了就算了，見 `readQuality` */ }
}

/** 存的是檔位的 pixel ratio。舊版的 `gfx.quality` 存相對比例，意義不同，不讀 */
const QUALITY_KEY = 'gfx.pixelRatio'
const ANTIALIAS_KEY = 'gfx.antialias'

/**
 * 存取設定。**讀寫都包 try** —— 無痕視窗與封鎖站台資料的設定會讓
 * `localStorage` 直接拋，那時只是不記得選擇，不該讓遊戲開不起來。
 *
 * 【為什麼集中在這裡】`scene.ts` 建 renderer 時要讀抗鋸齒、`main.ts` 開場要
 * 讀檔位、選單改了要寫 —— 三個地方各寫一份 try/catch 就會有人漏掉。
 */
export function readQuality(): number {
  try {
    const v = localStorage.getItem(QUALITY_KEY)
    // 【只認五個檔位】`Number('')` 是 0，用數字比對的話被清空的值會被當成某個數
    const hit = QUALITY_LEVELS.find((q) => String(q.pixelRatio) === v)
    return hit === undefined ? DEFAULT_QUALITY : hit.pixelRatio
  } catch {
    return DEFAULT_QUALITY
  }
}

export function saveQuality(pixelRatio: number): void {
  try {
    localStorage.setItem(QUALITY_KEY, String(pixelRatio))
  } catch { /* 存不了就算了，見上面 */ }
}

export function readAntialias(): boolean {
  try {
    const v = localStorage.getItem(ANTIALIAS_KEY)
    return v === null ? DEFAULT_ANTIALIAS : v === '1'
  } catch {
    return DEFAULT_ANTIALIAS
  }
}

export function saveAntialias(on: boolean): void {
  try {
    localStorage.setItem(ANTIALIAS_KEY, on ? '1' : '0')
  } catch { /* 同上 */ }
}
