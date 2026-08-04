import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 玩家分隊的存活字串；沒有分隊或只剩自己時回傳 null。
 *
 * 【為什麼剩一架就不顯示】那時候沒有「隊」這回事 —— 顯示「隊 1/4」只是
 * 在提醒玩家一件他已經知道的事，而且會佔一塊很快就被學會忽略的版面。
 * 與 `edgeIndicatorPosition` 在目標在畫面內時不回傳邊緣位置是同一條紀律。
 */
export function flightLabel(alive: number, size: number): string | null {
  if (size < 2 || alive < 2) return null
  return `隊 ${alive}/${size}`
}

/**
 * 雙方存活數與分隊存活。
 *
 * 【為什麼顯示數量而不顯示各機血量】與 M2 §8 的裁決一致：你看不出對方的
 * 結構完整度。但「還有幾架在天上」是看得出來的 —— 那是一個真實可觀察的量。
 *
 * 【M9 起沒有重置倒數】勝負由結算畫面呈現（M9 spec §8），HUD 不再畫它。
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

  // 【為什麼擺在同一行的右側而不是下一行】下一行是航向帶的位置 —— 實測
  // 「隊 4/4」會被航向指標壓在底下，讀不出來。存活數這一行右邊是空的。
  const flight = flightLabel(f.flightAlive, f.flightSize)
  if (flight !== null) {
    ctx.font = hudFont(Math.round(11 * L.scale))
    ctx.fillStyle = HUD_COLORS.dim
    ctx.fillText(flight, L.cx + size * 4.5, y + size * 0.25)
  }
}
