import { RAD } from '../../core/math'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

interface TapeConfig {
  x: number
  value: number
  /** 每格代表的數值 */
  step: number
  /** 每格的像素高度 */
  pixelsPerStep: number
  align: 'left' | 'right'
  label: string
  format(v: number): string
}

function drawVerticalTape(ctx: CanvasRenderingContext2D, L: HudLayout, c: TapeConfig): void {
  const halfHeight = L.height * 0.26
  const bw = 64 * L.scale
  const bh = 20 * L.scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(c.x - 60 * L.scale, L.cy - halfHeight, 120 * L.scale, halfHeight * 2)
  ctx.clip()

  ctx.strokeStyle = HUD_COLORS.dim
  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = hudFont(12 * L.scale)
  ctx.textBaseline = 'middle'
  ctx.textAlign = c.align === 'left' ? 'right' : 'left'

  const first = Math.floor((c.value - (halfHeight / c.pixelsPerStep) * c.step) / c.step) * c.step
  const last = c.value + (halfHeight / c.pixelsPerStep) * c.step
  const dir = c.align === 'left' ? -1 : 1

  for (let v = first; v <= last; v += c.step) {
    const y = L.cy - ((v - c.value) / c.step) * c.pixelsPerStep
    // 當前值方框橫跨刻度所在的 x 範圍，而它只有 0.35 alpha 蓋不住底下的字。
    // 落在方框帶內的刻度直接不畫，讀起來就是「方框把帶子遮住了」。
    if (Math.abs(y - L.cy) < bh) continue
    const major = Math.round(v / c.step) % 5 === 0
    const len = (major ? 12 : 6) * L.scale
    ctx.beginPath()
    ctx.moveTo(c.x, y)
    ctx.lineTo(c.x + dir * len, y)
    ctx.stroke()
    if (major) ctx.fillText(c.format(v), c.x + dir * (len + 4 * L.scale), y)
  }
  ctx.restore()

  // restore() 會把字型一併還原成 canvas 的預設 10px sans-serif，
  // 所以方框與標籤要自己重設，不能沿用 clip 區段裡設過的那一份
  ctx.font = hudFont(12 * L.scale)
  ctx.textBaseline = 'middle'

  // 當前值方框
  ctx.fillStyle = HUD_COLORS.panel
  const bx = c.align === 'left' ? c.x - bw : c.x
  ctx.fillRect(bx, L.cy - bh / 2, bw, bh)
  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.strokeRect(bx, L.cy - bh / 2, bw, bh)
  ctx.fillStyle = HUD_COLORS.primary
  ctx.textAlign = 'center'
  ctx.fillText(c.format(c.value), bx + bw / 2, L.cy)

  ctx.textAlign = c.align === 'left' ? 'left' : 'right'
  ctx.fillStyle = HUD_COLORS.dim
  ctx.fillText(c.label, bx + (c.align === 'left' ? 0 : bw), L.cy - bh)
}

export function drawSpeedTape(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  drawVerticalTape(ctx, L, {
    x: L.width * 0.14,
    value: f.ias * 3.6,
    step: 20,
    pixelsPerStep: 22 * L.scale,
    align: 'left',
    label: 'IAS km/h',
    format: (v) => v.toFixed(0),
  })
  // 刻度與標籤往**左**長（align 'left' 的 dir = −1），所以附屬讀數放右邊。
  // 放同一側會壓在刻度數字上——高度帶實測 VS 與 4000 這一格完全重疊。
  ctx.fillStyle = HUD_COLORS.dim
  ctx.textAlign = 'left'
  const sx = L.width * 0.14 + 8 * L.scale
  ctx.fillText(`M ${f.mach.toFixed(2)}`, sx, L.cy + 26 * L.scale)
  ctx.fillText(`TAS ${(f.tas * 3.6).toFixed(0)}`, sx, L.cy + 42 * L.scale)
}

export function drawAltitudeTape(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  drawVerticalTape(ctx, L, {
    x: L.width * 0.86,
    value: f.altitude,
    step: 100,
    pixelsPerStep: 20 * L.scale,
    align: 'right',
    label: 'ALT m',
    format: (v) => v.toFixed(0),
  })
  // 高度帶的刻度往右長，讀數因此靠左（見 drawSpeedTape 的說明）
  ctx.fillStyle = f.verticalSpeed >= 0 ? HUD_COLORS.primary : HUD_COLORS.warn
  ctx.textAlign = 'right'
  ctx.fillText(
    `VS ${f.verticalSpeed >= 0 ? '+' : ''}${f.verticalSpeed.toFixed(1)} m/s`,
    L.width * 0.86 - 8 * L.scale,
    L.cy + 26 * L.scale,
  )
}

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
