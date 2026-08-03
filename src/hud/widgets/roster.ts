import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 重置倒數要顯示的字串；戰鬥進行中回傳 null。
 *
 * 【為什麼抽成純函數】`main.ts` 與繪製函數都進不了單元測試，判斷留在裡面
 * 就等於沒有覆蓋。這與 `edgeIndicatorPosition` 從 `drawContacts` 抽出來、
 * `minimapSymbol` 從 `drawMinimap` 抽出來是同一個做法。
 *
 * 【為什麼是無條件進位】倒數走到 0 的那一格就重置了，所以畫面上永遠不該
 * 出現「重新開始 0」—— 那看起來像卡住。`Math.ceil` 讓最後一格顯示 1。
 */
export function countdownLabel(seconds: number): string | null {
  if (seconds <= 0) return null
  return `重新開始 ${Math.ceil(seconds)}`
}

/**
 * 雙方存活數與重置倒數。
 *
 * 【為什麼顯示數量而不顯示各機血量】與 M2 §8 的裁決一致：你看不出對方的
 * 結構完整度。但「還有幾架在天上」是看得出來的 —— 那是一個真實可觀察的量。
 *
 * 【為什麼倒數為 0 時什麼都不畫】戰鬥進行中那一行永遠是空的，畫一個「--」
 * 只是在版面上佔一塊會被學會忽略的地方。
 */
export function drawRoster(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const size = Math.round(15 * L.scale)
  ctx.font = hudFont(size, true)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const y = L.height * 0.04

  ctx.fillStyle = HUD_COLORS.friendly
  ctx.fillText(String(f.blueAlive), L.cx - size * 2, y)

  ctx.fillStyle = HUD_COLORS.dim
  ctx.fillText('vs', L.cx, y)

  ctx.fillStyle = HUD_COLORS.danger
  ctx.fillText(String(f.redAlive), L.cx + size * 2, y)

  const label = countdownLabel(f.resetCountdown)
  if (label !== null) {
    ctx.font = hudFont(Math.round(20 * L.scale), true)
    ctx.fillStyle = HUD_COLORS.warn
    ctx.fillText(label, L.cx, y + size * 1.6)
  }
}
