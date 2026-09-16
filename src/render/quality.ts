/**
 * 畫面品質的設定：繪圖解析度的檔位與抗鋸齒。**純資料、純函式，加上兩支存取器**
 * —— `render/scene.ts` 與 `ui/menu.ts` 都要用它，UI 那一側不該為了幾個常數把
 * 整個算繪堆疊拉進來。
 *
 * 【為什麼是原生的比例而不是絕對倍率】同一個絕對值在不同螢幕上意義不同：
 * dpr 1 的機器設 1.5 會變成超取樣（更慢），dpr 2 的機器設 1.5 反而是降畫質。
 * 以「原生的幾成」表達，三個檔位在任何螢幕上都是同一件事。
 *
 * 【HUD 不受影響】儀表板是另一張 2D 畫布，尺寸吃 `window.devicePixelRatio`
 * （`hud/Hud.ts`），與這裡設的 pixel ratio 無關 —— 降檔位時文字與刻度仍是原生清晰度。
 */
export interface QualityLevel {
  readonly label: string
  /** 原生解析度的幾成 */
  readonly scale: number
}

/**
 * 順序即按鈕順序。**由清晰到流暢**。
 *
 * 【標籤只寫感受，不寫比例】「八成」「六成五」是這裡的實作細節，玩家要選的是
 * 畫面清楚還是順，不是解析度乘數 —— 而且那個數字在不同螢幕上的意義並不相同。
 */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { label: '清晰', scale: 1 },
  { label: '平衡', scale: 0.8 },
  { label: '流暢', scale: 0.65 },
]

/** 沒有設定過時用的檔位 —— 與這個選項上線前的行為逐字相同 */
export const DEFAULT_QUALITY = 1

/**
 * 檔位換算成要給 renderer 的 pixel ratio。
 *
 * 【上限 2 是既有行為】`createScene` 原本就是 `min(devicePixelRatio, 2)`，
 * 這裡保留它：4K 筆電的 dpr 可以到 3，全開會讓像素數多出一倍以上。
 *
 * 【不接受超過 1 的檔位】那是超取樣，比原生更慢，不在這個選單提供的範圍內；
 * 壞掉的輸入（NaN、0、負數）一律回到預設，寧可清晰也不要黑畫面。
 */
export function pixelRatioFor(scale: number, devicePixelRatio: number): number {
  const base = Math.min(devicePixelRatio, 2)
  const s = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 1) : DEFAULT_QUALITY
  return base * s
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
export const ANTIALIAS_LEVELS: readonly { label: string; value: boolean }[] = [
  { label: '開啟', value: true },
  { label: '關閉', value: false },
]

/** 沒有設定過時的抗鋸齒 —— 與這個選項上線前逐字相同 */
export const DEFAULT_ANTIALIAS = true

const QUALITY_KEY = 'gfx.quality'
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
    const v = Number(localStorage.getItem(QUALITY_KEY))
    return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : DEFAULT_QUALITY
  } catch {
    return DEFAULT_QUALITY
  }
}

export function saveQuality(scale: number): void {
  try {
    localStorage.setItem(QUALITY_KEY, String(scale))
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
