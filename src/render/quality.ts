/**
 * 繪圖解析度的檔位。**純資料與純函式，不碰 three** —— `render/scene.ts` 與
 * `ui/menu.ts` 都要用它，UI 那一側不該為了三個常數把整個算繪堆疊拉進來。
 *
 * 【為什麼是原生的比例而不是絕對倍率】同一個絕對值在不同螢幕上意義不同：
 * dpr 1 的機器設 1.5 會變成超取樣（更慢），dpr 2 的機器設 1.5 反而是降畫質。
 * 以「原生的幾成」表達，三個檔位在任何螢幕上都是同一件事。
 *
 * 【HUD 不受影響】儀表板是另一張 2D 畫布，尺寸吃 `window.devicePixelRatio`
 * （`hud/Hud.ts`），與這裡設的 pixel ratio 無關 —— 降檔位時文字與刻度仍是原生清晰度。
 *
 * 【抗鋸齒不在這裡】它是建立 WebGL context 時的參數，換它必須重建 context，
 * 執行中切不了。要做成選項的話是另一條路（選完重載頁面）。
 */
export interface QualityLevel {
  readonly label: string
  readonly hint: string
  /** 原生解析度的幾成 */
  readonly scale: number
}

/** 順序即按鈕順序。**由清晰到流暢** */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { label: '清晰', hint: '原生', scale: 1 },
  { label: '平衡', hint: '八成', scale: 0.8 },
  { label: '流暢', hint: '六成五', scale: 0.65 },
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
