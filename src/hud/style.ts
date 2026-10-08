export const HUD_COLORS = {
  primary: '#7dfba8',
  dim: 'rgba(125, 251, 168, 0.45)',
  warn: '#ffcc44',
  danger: '#ff5a4d',
  /** 還沒警戒的敵方（倫內爾島）。要與 `warn`（僚機、警告的琥珀色）分得開 */
  unaware: '#ffee33',
  friendly: '#5aa9ff',
  panel: 'rgba(0, 0, 0, 0.35)',
} as const

/**
 * 一個接觸點該用什麼顏色。敵紅、友藍、**自己分隊的同伴用第三個顏色**。
 *
 * 【為什麼集中在 style.ts 而不是某個 widget 裡】目標框（`contacts.ts`）與
 * 小地圖（`minimap.ts`）都要用它。留在其中一邊就會變成另一邊自己寫一份
 * `c.hostile ? danger : friendly` —— 而那正是 M6 改色時踩到的：目標框
 * 改了，小地圖沒改。
 *
 * 抽成純函數則是因為繪製函數進不了單元測試，而「哪一架該長得不一樣」是
 * 一條有實際行為的規則 —— 與 `minimapSymbol`、`edgeIndicatorPosition`
 * 是同一個做法。
 */
export function contactColor(hostile: boolean, flightMate: boolean, enemyUnaware = false): string {
  // 【敵方還沒警戒用黃色】倫內爾島警戒前的野貓與艦隊（`battle/alert.ts`）：看得出「還沒發現你」
  if (hostile) return enemyUnaware ? HUD_COLORS.unaware : HUD_COLORS.danger
  return flightMate ? HUD_COLORS.warn : HUD_COLORS.friendly
}

/** 目標框在螢幕上的最小／最大半徑，px（**未乘 scale**）。 */
const BOX_MIN = 9
const BOX_MAX = 46

/**
 * 一個接觸點的框半徑，CSS px。
 *
 * 【為什麼集中在 style.ts 而不是某個 widget 裡】座艙的目標框（`contacts.ts`）
 * 與上帝視角的分隊標示（`godMarkers.ts`）都要用同一把尺。留在其中一邊就會
 * 變成另一邊自己寫一份 —— 與 `contactColor` 搬來這裡是同一條理由，而那條
 * 註解記的正是 M6 改色時踩到的：目標框改了，小地圖沒改。
 *
 * 【夾制的上下界要先乘 scale 再夾】`radius * unit` 已經是 CSS px，若把夾完
 * 的結果再乘一次 scale，動態尺寸會被二次縮放，而固定的上下界卻只縮放一次
 * —— 兩者在不同視窗高度下對不起來。
 */
export function contactBoxRadius(radius: number, unit: number, scale: number): number {
  return Math.max(BOX_MIN * scale, Math.min(BOX_MAX * scale, radius * unit))
}

/** HUD 統一字型。字級由呼叫端乘上 L.scale。 */
export function hudFont(px: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${px}px ui-monospace, Consolas, monospace`
}
