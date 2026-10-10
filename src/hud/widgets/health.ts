import type { HudFrame, HudLayout } from '../types'
import { drawHudBorder, HUD_COLORS, hudFont } from '../style'
import { shortName } from '../../i18n/names'

/** 自機識別與血量。整組固定與小地圖等寬，血條只表達比例。 */
export function drawHealth(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const w = Math.min(L.width, L.height) * 0.19
  const h = 8 * L.scale
  const x = 30 * L.scale
  const y = L.height - w - 42 * L.scale - 16 * L.scale - h
  const ratio = f.hpMax > 0 ? Math.max(0, Math.min(1, f.hp / f.hpMax)) : 0
  const color = ratio <= .25 ? HUD_COLORS.danger : ratio <= .5 ? HUD_COLORS.warn : HUD_COLORS.primary
  const current = `${Math.max(0, Math.round(f.hp))}`
  const name = shortName({ id: f.aircraftId, name: f.aircraftName })
  const valueSize = Math.max(11, 13 * L.scale)
  const nameSize = Math.max(10, 12 * L.scale)
  const textY = y - 5 * L.scale

  ctx.save()
  ctx.font = hudFont(valueSize, true)
  const valueWidth = ctx.measureText(current).width
  ctx.font = hudFont(nameSize, true)
  // 手機放不下短名就隱藏，只保留血量；桌機才允許完整型號換行。
  const fits = ctx.measureText(name).width + valueWidth + 8 * L.scale <= w
  const showName = !f.touch || fits
  const stacked = !f.touch && !fits
  const nameY = stacked ? textY - valueSize - 3 * L.scale : textY
  ctx.shadowBlur = 0

  ctx.textBaseline = 'bottom'
  ctx.strokeStyle = 'rgba(20, 29, 31, .65)'
  ctx.lineWidth = 1.25
  ctx.lineJoin = 'round'
  ctx.textAlign = 'left'
  ctx.fillStyle = HUD_COLORS.primary
  if (showName) {
    ctx.strokeText(name, x, nameY)
    ctx.fillText(name, x, nameY)
  }
  ctx.font = hudFont(valueSize, true)
  ctx.textAlign = 'right'
  ctx.fillStyle = ratio <= .5 ? color : HUD_COLORS.primary
  ctx.strokeText(current, x + w, textY)
  ctx.fillText(current, x + w, textY)

  ctx.shadowBlur = 0
  // 深色槽與窄金屬邊收在原有血條範圍內，不增加背景面板。
  ctx.fillStyle = 'rgba(16, 20, 18, .8)'
  ctx.fillRect(x, y, w, h)
  const inset = Math.max(1, L.scale)
  const innerW = w - inset * 2
  ctx.fillStyle = color
  ctx.fillRect(x + inset, y + inset, innerW * ratio, h - inset * 2)
  // 四等分刻痕只落在槽內，填量改變時仍能辨認比例。
  ctx.fillStyle = 'rgba(9, 16, 13, .38)'
  for (let i = 1; i < 4; i++) {
    ctx.fillRect(x + inset + innerW * i / 4, y + inset, 1, h - inset * 2)
  }
  drawHudBorder(ctx, x, y, w, h)
  ctx.restore()
}
