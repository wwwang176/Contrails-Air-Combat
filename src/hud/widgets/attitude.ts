import { RAD } from '../../core/math'
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/**
 * 圓形姿態儀（人工地平線）的**盤面內容**。外框與版位由 widgets/dials.ts 負責，
 * 三個表要對齊成一排，位置就不能各自為政。
 */
export function drawAttitude(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
  cx: number,
  cy: number,
  r: number,
): void {
  const pxPerDeg = r / 45

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = HUD_COLORS.panel
  ctx.fill()
  ctx.clip()

  ctx.translate(cx, cy)
  ctx.rotate(-f.roll)
  const horizonY = f.pitch * RAD * pxPerDeg

  // 天地
  ctx.fillStyle = 'rgba(60, 120, 180, 0.5)'
  ctx.fillRect(-r * 2, horizonY - r * 2, r * 4, r * 2)
  ctx.fillStyle = 'rgba(120, 90, 50, 0.5)'
  ctx.fillRect(-r * 2, horizonY, r * 4, r * 2)

  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.beginPath()
  ctx.moveTo(-r * 1.2, horizonY)
  ctx.lineTo(r * 1.2, horizonY)
  ctx.stroke()

  // 俯仰刻度
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  for (let p = -60; p <= 60; p += 10) {
    if (p === 0) continue
    const y = horizonY - p * pxPerDeg
    const w = (p % 30 === 0 ? 0.34 : 0.18) * r
    ctx.beginPath()
    ctx.moveTo(-w, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.restore()

  // 外圈與固定的飛機符號。外圈必須畫在天地色塊**之後**，否則被蓋掉
  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.32, cy)
  ctx.lineTo(cx - r * 0.1, cy)
  ctx.moveTo(cx + r * 0.1, cy)
  ctx.lineTo(cx + r * 0.32, cy)
  ctx.moveTo(cx, cy - r * 0.06)
  ctx.lineTo(cx, cy + r * 0.06)
  ctx.stroke()
}
