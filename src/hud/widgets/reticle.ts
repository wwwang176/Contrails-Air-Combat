import { VIEWPORT_MARGIN } from '../../input/aim'
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/** 滑鼠準星（圓）與飛機準星（十字）。兩者的分離距離就是「飛機跟不上意圖」的視覺化。 */
export function drawReticle(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  // 準星可移動範圍。是**矩形**不是圓：夾制由 clampAimToViewport 做，準星拉得到
  // 四個角（見 input/aim.ts）。原本畫的是半徑 AIM_RADIUS 的圓，那是 Task 19
  // 改成世界固定瞄準點之前的邊界——實測準星會大搖大擺地跑到圈外。
  const mw = VIEWPORT_MARGIN * L.width / 2
  const mh = VIEWPORT_MARGIN * L.height / 2
  ctx.strokeStyle = 'rgba(125, 251, 168, 0.12)'
  ctx.lineWidth = 1
  ctx.strokeRect(L.cx - mw, L.cy - mh, mw * 2, mh * 2)

  // 滑鼠準星（圓形）。接近失速時轉為警示色
  const stallRatio = Math.abs(f.alpha) / f.alphaCrit
  const mx = L.cx + f.aimX * L.unit
  const my = L.cy - f.aimY * L.unit
  if (f.aimVisible) {
    ctx.strokeStyle =
      stallRatio > 0.95 ? HUD_COLORS.danger : stallRatio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.primary
    ctx.lineWidth = 2 * L.scale
    ctx.beginPath()
    ctx.arc(mx, my, 11 * L.scale, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 飛機準星（十字），位於機首方向的投影處
  if (f.noseVisible) {
    const nx = L.cx + (f.noseX * L.width) / 2
    const ny = L.cy - (f.noseY * L.height) / 2
    const a = 14 * L.scale
    const gap = 4 * L.scale
    ctx.strokeStyle = HUD_COLORS.primary
    ctx.lineWidth = 2 * L.scale
    ctx.beginPath()
    ctx.moveTo(nx - a, ny); ctx.lineTo(nx - gap, ny)
    ctx.moveTo(nx + gap, ny); ctx.lineTo(nx + a, ny)
    ctx.moveTo(nx, ny - a); ctx.lineTo(nx, ny - gap)
    ctx.moveTo(nx, ny + gap); ctx.lineTo(nx, ny + a)
    ctx.stroke()

    // 兩準星之間的連線，強化「跟不上」的感受
    if (f.aimVisible) {
      ctx.strokeStyle = HUD_COLORS.dim
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(nx, ny); ctx.lineTo(mx, my)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
}
