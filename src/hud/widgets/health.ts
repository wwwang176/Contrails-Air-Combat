import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/** 血條低於此比例轉為警示色。 */
const WARN_FRACTION = 0.5
/** 血條低於此比例轉為危險色。 */
const DANGER_FRACTION = 0.25

/**
 * 自機血量橫條。放在小地圖上方。
 *
 * 【為什麼有數字也有橫條】橫條讀「還剩多少」比數字快，數字讀「差多少會死」
 * 比橫條準。兩個都便宜。
 */
export function drawHealth(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const w = Math.min(L.width, L.height) * 0.19
  const h = 6 * L.scale
  const x = 30 * L.scale
  const y = L.height - w - 42 * L.scale - 16 * L.scale - h

  const ratio = f.hpMax > 0 ? Math.max(0, Math.min(1, f.hp / f.hpMax)) : 0
  const color = ratio <= DANGER_FRACTION ? HUD_COLORS.danger
    : ratio <= WARN_FRACTION ? HUD_COLORS.warn
      : HUD_COLORS.primary

  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x, y, w * ratio, h)
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)

  ctx.fillStyle = color
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${Math.max(0, Math.round(f.hp))}`, x + w, y - 2 * L.scale)
}
