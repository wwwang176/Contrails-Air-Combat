import { t } from '../../i18n'
import type { HudFrame, HudLayout } from '../types'
import { HUD_COLORS, hudFont } from '../style'

/**
 * 玩家分隊的存活字串；沒有分隊或只剩自己時回傳 null。
 *
 * 【為什麼剩一架就不顯示】那時候沒有「隊」這回事 —— 顯示「隊 1/4」只是
 * 在提醒玩家一件他已經知道的事，而且會佔一塊很快就被學會忽略的版面。
 * 與 `edgeIndicatorPosition` 在目標在畫面內時不回傳邊緣位置是同一條紀律。
 */
export function flightLabel(alive: number, size: number): string | null {
  if (size < 2 || alive < 2) return null
  return t('hud.flight', { alive, size })
}

/**
 * 雙方存活數。
 *
 * 【為什麼顯示數量而不顯示各機血量】與 M2 §8 一致：你看不出對方的
 * 結構完整度。但「還有幾架在天上」是看得出來的 —— 那是一個真實可觀察的量。
 *
 * 【沒有重置倒數】勝負由結算畫面呈現（M9 spec §8），HUD 不畫它。
 */
export function drawRoster(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const size = Math.round(15 * L.scale)
  const y = L.height * 0.04
  const leftCount = L.cx - size * 2
  const rightCount = L.cx + size * 2
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = hudFont(size, true)
  ctx.fillStyle = HUD_COLORS.friendly
  ctx.fillText(String(f.blueAlive), leftCount, y)
  ctx.fillStyle = HUD_COLORS.danger
  ctx.fillText(String(f.redAlive), rightCount, y)

  // 標籤放在外側，數字仍留在原位；中央留給既有航向指標。
  ctx.font = hudFont(Math.max(9, Math.round(size * .82)))
  ctx.globalAlpha = .78
  ctx.fillStyle = HUD_COLORS.friendly
  ctx.textAlign = 'right'
  ctx.fillText(t('hud.allies'), leftCount - size * 1.2, y + 1)
  ctx.fillStyle = HUD_COLORS.danger
  ctx.textAlign = 'left'
  ctx.fillText(t('hud.enemies'), rightCount + size * 1.2, y + 1)

  // 固定長度的分組線，不代表血量或勝負進度；避開航向刻度。
  const lineY = Math.min(y + size + 2 * L.scale, L.height * .07 - 2 * L.scale)
  const lineWidth = 80 * L.scale
  const innerGap = size
  ctx.globalAlpha = .7
  ctx.lineWidth = 1
  ctx.strokeStyle = HUD_COLORS.friendly
  ctx.beginPath()
  ctx.moveTo(L.cx - innerGap - lineWidth, lineY)
  ctx.lineTo(L.cx - innerGap, lineY)
  ctx.stroke()
  ctx.strokeStyle = HUD_COLORS.danger
  ctx.beginPath()
  ctx.moveTo(L.cx + innerGap, lineY)
  ctx.lineTo(L.cx + innerGap + lineWidth, lineY)
  ctx.stroke()
  ctx.restore()
}
