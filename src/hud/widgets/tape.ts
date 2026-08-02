import { RAD } from '../../core/math'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 上方的航向帶。
 *
 * 【為什麼只剩這一條】速度與高度原本也是同款的垂直帶，但那是現代噴射機的
 * HUD 語彙，跟這個年代對不上。改成陀螺儀旁邊的圓形儀表（見 widgets/dials.ts）。
 * 航向帶保留——真機的羅盤刻度盤本來就是一條水平展開的帶子。
 */
export function drawHeadingTape(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const deg = ((f.heading * RAD) % 360 + 360) % 360
  const y = L.height * 0.07
  const pxPerDeg = 3.2 * L.scale
  const halfWidth = L.width * 0.18

  ctx.save()
  ctx.beginPath()
  ctx.rect(L.cx - halfWidth, y - 20 * L.scale, halfWidth * 2, 40 * L.scale)
  ctx.clip()
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = hudFont(12 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const span = halfWidth / pxPerDeg
  for (let d = Math.floor(deg - span); d <= deg + span; d++) {
    if (d % 5 !== 0) continue
    const x = L.cx + (d - deg) * pxPerDeg
    const major = d % 10 === 0
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + (major ? 10 : 5) * L.scale)
    ctx.stroke()
    if (major) ctx.fillText(String(((d % 360) + 360) % 360), x, y + 12 * L.scale)
  }
  ctx.restore()

  ctx.fillStyle = HUD_COLORS.primary
  ctx.beginPath()
  ctx.moveTo(L.cx, y - 2 * L.scale)
  ctx.lineTo(L.cx - 5 * L.scale, y - 10 * L.scale)
  ctx.lineTo(L.cx + 5 * L.scale, y - 10 * L.scale)
  ctx.closePath()
  ctx.fill()
}
