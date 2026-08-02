import { DEG, clamp } from '../../core/math'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'
import { drawAttitude } from './attitude'

/** 空速表滿刻度，km/h。P-51D 俯衝的指示空速摸得到 700 出頭。 */
const ASI_MAX = 800
/** 指針掃過的角度：從 −150°（左下）順時針到 +150°（右下）。 */
const ASI_SWEEP = 300 * DEG

/** 盤面：半透明底 + 外圈。 */
function face(ctx: CanvasRenderingContext2D, L: HudLayout, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = HUD_COLORS.panel
  ctx.fill()
  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.stroke()
}

/** 指針。角度 0 指向 12 點，順時針為正；尾端往回伸一小段當配重。 */
function needle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, angle: number,
  length: number, width: number, color: string,
): void {
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - dx * length * 0.18, cy - dy * length * 0.18)
  ctx.lineTo(cx + dx * length, cy + dy * length)
  ctx.stroke()
  ctx.lineCap = 'butt'
}

/** 盤面刻度。角度同 needle。 */
function tick(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, angle: number,
  rOuter: number, rInner: number,
): void {
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  ctx.beginPath()
  ctx.moveTo(cx + dx * rInner, cy + dy * rInner)
  ctx.lineTo(cx + dx * rOuter, cy + dy * rOuter)
  ctx.stroke()
}

function tickLabel(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, angle: number, radius: number, text: string,
): void {
  ctx.fillText(text, cx + Math.sin(angle) * radius, cy - Math.cos(angle) * radius)
}

/** 空速表：指示空速，km/h。 */
function drawAirspeed(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
  cx: number, cy: number, r: number,
): void {
  face(ctx, L, cx, cy, r)
  const toAngle = (v: number) => -ASI_SWEEP / 2 + ASI_SWEEP * clamp(v / ASI_MAX, 0, 1)

  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= ASI_MAX; v += 50) {
    const a = toAngle(v)
    const major = v % 100 === 0
    tick(ctx, cx, cy, a, r * 0.94, r * (major ? 0.78 : 0.86))
    // 標到百位：0 2 4 6 8，與高度表的 0..9 同一套讀法
    if (v % 200 === 0) tickLabel(ctx, cx, cy, a, r * 0.62, String(v / 100))
  }

  const kmh = f.ias * 3.6
  needle(ctx, cx, cy, toAngle(kmh), r * 0.80, 2 * L.scale, HUD_COLORS.primary)

  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = hudFont(12 * L.scale)
  ctx.fillText(kmh.toFixed(0), cx, cy + r * 0.42)
}

/** 高度表：長針一圈 1000 m、短針一圈 10000 m。 */
function drawAltimeter(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
  cx: number, cy: number, r: number,
): void {
  face(ctx, L, cx, cy, r)

  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * 360 * DEG
    const major = i % 5 === 0
    tick(ctx, cx, cy, a, r * 0.94, r * (major ? 0.78 : 0.88))
    if (major) tickLabel(ctx, cx, cy, a, r * 0.62, String(i / 5))
  }

  const alt = f.altitude
  // 短針先畫，長針壓在上面——重疊時要看得出哪一根是百米針
  needle(ctx, cx, cy, ((alt / 10000) % 1) * 360 * DEG, r * 0.52, 3.2 * L.scale, HUD_COLORS.dim)
  needle(ctx, cx, cy, ((alt / 1000) % 1) * 360 * DEG, r * 0.82, 2 * L.scale, HUD_COLORS.primary)

  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = hudFont(12 * L.scale)
  ctx.fillText(alt.toFixed(0), cx, cy + r * 0.42)
}

/**
 * 儀表組：空速表、姿態儀、高度表並排於右下角。
 *
 * 【為什麼不是垂直帶】速度帶／高度帶是現代噴射機 HUD 的語彙。這個年代的
 * 座艙是一盤圓形機械儀表，指針掃過刻度盤——換成圓表之後，讀「大概多快」
 * 靠的是指針指向哪個方位，跟真機一樣，而且省下畫面兩側一大片空間。
 */
export function drawDials(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const r = Math.min(L.width, L.height) * 0.085
  const gap = 18 * L.scale
  const cy = L.height - r - 46 * L.scale
  const altX = L.width - 30 * L.scale - r
  const attX = altX - 2 * r - gap
  const asiX = attX - 2 * r - gap

  drawAirspeed(ctx, L, f, asiX, cy, r)
  drawAttitude(ctx, L, f, attX, cy, r)
  drawAltimeter(ctx, L, f, altX, cy, r)

  // 表名與兩個沒有指針的附屬讀數
  const labelY = cy + r + 11 * L.scale
  const subY = labelY + 12 * L.scale
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = hudFont(10 * L.scale)

  ctx.fillStyle = HUD_COLORS.dim
  ctx.fillText('IAS km/h', asiX, labelY)
  ctx.fillText('ALT m', altX, labelY)
  ctx.fillText(`TAS ${(f.tas * 3.6).toFixed(0)}   M ${f.mach.toFixed(2)}`, asiX, subY)

  ctx.fillStyle = f.verticalSpeed >= 0 ? HUD_COLORS.primary : HUD_COLORS.warn
  ctx.fillText(
    `VS ${f.verticalSpeed >= 0 ? '+' : ''}${f.verticalSpeed.toFixed(1)} m/s`,
    altX, subY,
  )
}
