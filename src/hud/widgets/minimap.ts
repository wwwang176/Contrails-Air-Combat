import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/** 地圖半徑，公尺。 */
const RANGE = 8000
/** 網格間距，公尺。 */
const CELL = 2000

/**
 * 小地圖。M1 只有自機，先建立框架與航向顯示；
 * M4 加入敵我單位時，依高度差以方形／三角形／倒三角形區分（spec 原始需求）。
 *
 * 【機首朝上】自機符號固定指向畫面上方，轉的是地圖。空戰時腦子裡的方位
 * 是相對自己的（「他在我兩點鐘」），北方朝上的地圖每次都要先在心裡轉一次。
 * 代價是失去絕對方位，所以補一個會繞著轉的 N 標記，並讓網格跟著世界座標
 * 捲動——網格因此不只是裝飾，它就是地面。
 */
export function drawMinimap(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const size = Math.min(L.width, L.height) * 0.19
  const x = 30 * L.scale
  const y = L.height - size - 42 * L.scale
  const cx = x + size / 2
  const cy = y + size / 2
  /** 每公尺的像素數 */
  const px = size / (2 * RANGE)

  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x, y, size, size)

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, size, size)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-f.heading)

  // 網格。地圖旋轉後方框的四個角最遠是半對角線，線要畫得比方框寬才蓋得滿。
  const cellPx = CELL * px
  const reach = size * 0.71 + cellPx
  const n = Math.ceil(reach / cellPx)
  const ox = -(((f.worldX % CELL) + CELL) % CELL) * px
  const oz = -(((f.worldZ % CELL) + CELL) % CELL) * px
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = -n; i <= n; i++) {
    const gx = ox + i * cellPx
    const gz = oz + i * cellPx
    ctx.moveTo(gx, -reach); ctx.lineTo(gx, reach)
    ctx.moveTo(-reach, gz); ctx.lineTo(reach, gz)
  }
  ctx.stroke()
  ctx.restore()

  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, size, size)

  // 北方標記：世界 −Z。地圖轉了 −heading，所以它落在這個方向上，字本身不轉。
  // 沿方向推到**剛好碰到方框**——貼著邊比浮在圓周上好讀，而且方框本身就是
  // 現成的刻度盤。除以 0 會得到 Infinity，min 自然會挑另一軸。
  const dx = -Math.sin(f.heading)
  const dy = -Math.cos(f.heading)
  const edge = size / 2 - 7 * L.scale
  const reachEdge = Math.min(edge / Math.abs(dx), edge / Math.abs(dy))
  ctx.fillStyle = HUD_COLORS.warn
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', cx + dx * reachEdge, cy + dy * reachEdge)

  // 自機恆位於中心且恆朝上
  ctx.fillStyle = HUD_COLORS.friendly
  ctx.beginPath()
  ctx.moveTo(cx, cy - 7 * L.scale)
  ctx.lineTo(cx + 5 * L.scale, cy + 6 * L.scale)
  ctx.lineTo(cx - 5 * L.scale, cy + 6 * L.scale)
  ctx.closePath()
  ctx.fill()

  // 比例尺與座標放在框**外**：N 標記貼著框邊跑，某些航向會正好落在角落上
  ctx.fillStyle = HUD_COLORS.dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${(RANGE / 1000).toFixed(0)} km`, x, y - 4 * L.scale)
  ctx.textBaseline = 'top'
  ctx.fillText(
    `X ${(f.worldX / 1000).toFixed(1)}  Z ${(f.worldZ / 1000).toFixed(1)}`,
    x, y + size + 5 * L.scale,
  )
}
