import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 小地圖。M1 只有自機，先建立框架與航向顯示；
 * M4 加入敵我單位時，依高度差以方形／三角形／倒三角形區分（spec 原始需求）。
 */
export function drawMinimap(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const size = Math.min(L.width, L.height) * 0.19
  const x = 30 * L.scale
  const y = L.height - size - 30 * L.scale
  const range = 8000 // 地圖半徑，公尺

  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x, y, size, size)
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, size, size)

  // 網格：每 2 km 一格
  const cells = Math.round((range * 2) / 2000)
  for (let i = 1; i < cells; i++) {
    const t = (i / cells) * size
    ctx.beginPath()
    ctx.moveTo(x + t, y); ctx.lineTo(x + t, y + size)
    ctx.moveTo(x, y + t); ctx.lineTo(x + size, y + t)
    ctx.stroke()
  }

  // 自機恆位於中心，朝向由航向決定
  const cx = x + size / 2
  const cy = y + size / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(f.heading)
  ctx.fillStyle = HUD_COLORS.friendly
  ctx.beginPath()
  ctx.moveTo(0, -7 * L.scale)
  ctx.lineTo(5 * L.scale, 6 * L.scale)
  ctx.lineTo(-5 * L.scale, 6 * L.scale)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`${(range / 1000).toFixed(0)} km`, x + 4 * L.scale, y + 4 * L.scale)
  ctx.fillText(
    `X ${(f.worldX / 1000).toFixed(1)}  Z ${(f.worldZ / 1000).toFixed(1)}`,
    x + 4 * L.scale, y + size - 14 * L.scale,
  )
}
