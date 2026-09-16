import { DEG, clamp } from '../../core/math'
import type { ReleaseEnvelope } from '../../weapons/releaseEnvelope'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'
import { drawAttitude } from './attitude'
import { drawCachedLayer, LAYER_ORIGIN, LOW_RATE, LOW_RATE_PHASE, newLayerCache } from './layerCache'

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

/** 刻度與刻度數字的畫筆狀態。之後的指針與讀數沿用其中的對齊方式 */
function tickState(ctx: CanvasRenderingContext2D, L: HudLayout): void {
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
}

type DialFace = (ctx: CanvasRenderingContext2D, L: HudLayout, cx: number, cy: number, r: number) => void

interface FaceCache {
  canvas: HTMLCanvasElement | null
  cx: number
  cy: number
  r: number
  dpr: number
  scale: number
  /** 貼回主畫布的裝置像素位置 */
  x: number
  y: number
}

const newFaceCache = (): FaceCache => ({ canvas: null, cx: NaN, cy: NaN, r: NaN, dpr: NaN, scale: NaN, x: 0, y: 0 })
const ASI_FACE = newFaceCache()
const ALT_FACE = newFaceCache()

/** 三個表加上底下的讀數，整塊低頻重畫 */
const DIAL_LAYER = newLayerCache()

/**
 * 盤面、刻度、刻度數字畫進一張離屏點陣，每幀以裝置像素 1:1 貼回。
 *
 * 【為什麼】它們只由版面決定，而 HUD 的繪圖指令每幀在 GPU 行程點陣化 ——
 * 兩個錶的一百條刻度與二十個數字，實測佔錶盤那 1 ms 的大半。
 *
 * 【像素對齊】離屏的原點落在向下取整的裝置像素上、變換保留小數位移，抗鋸齒
 * 因此落在與直接畫同一格。半透明的底色先在離屏合成再疊上來，數學上與直接
 * 依序畫相同，8-bit 預乘 alpha 的捨入可能差 1/255。
 *
 * 【dpr 必須與 `Hud.resize` 相同】那裡把變換設成 `min(devicePixelRatio, 2)`。
 *
 * 【沒有 document 時直接畫】node 裡的測試用假 ctx 攔繪圖呼叫。
 */
function drawFace(
  ctx: CanvasRenderingContext2D, L: HudLayout, cx: number, cy: number, r: number,
  draw: DialFace, cache: FaceCache,
): void {
  if (typeof document === 'undefined') {
    draw(ctx, L, cx, cy, r)
    return
  }
  const dpr = Math.min(window.devicePixelRatio, 2)
  if (cache.canvas === null || cache.cx !== cx || cache.cy !== cy || cache.r !== r
    || cache.dpr !== dpr || cache.scale !== L.scale) {
    const pad = r + 1.5 * L.scale + 2
    const x = Math.floor((cx - pad) * dpr)
    const y = Math.floor((cy - pad) * dpr)
    const canvas = cache.canvas ?? document.createElement('canvas')
    canvas.width = Math.ceil((cx + pad) * dpr) - x
    canvas.height = Math.ceil((cy + pad) * dpr) - y
    const c = canvas.getContext('2d')!
    c.setTransform(dpr, 0, 0, dpr, -x, -y)
    draw(c, L, cx, cy, r)
    cache.canvas = canvas
    cache.cx = cx; cache.cy = cy; cache.r = r; cache.dpr = dpr; cache.scale = L.scale
    cache.x = x; cache.y = y
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  // 【要扣掉離屏層的原點】identity 變換下的座標是**主畫布**的裝置像素，
  // 而這裡的 ctx 可能是某個離屏層（`LAYER_ORIGIN`），它的左上角不在主畫布的
  // 左上角。不扣的話盤面會整個偏移出去。兩者都是整數，相減沒有精度損失
  ctx.drawImage(cache.canvas, cache.x - LAYER_ORIGIN.x, cache.y - LAYER_ORIGIN.y)
  ctx.restore()
  tickState(ctx, L)
}

/** 空速表：指示空速，km/h。 */
const asiAngle = (v: number): number => -ASI_SWEEP / 2 + ASI_SWEEP * clamp(v / ASI_MAX, 0, 1)

/** 空速表不隨讀數變的部分：盤面、刻度、刻度數字 */
function airspeedFace(
  ctx: CanvasRenderingContext2D, L: HudLayout, cx: number, cy: number, r: number,
): void {
  face(ctx, L, cx, cy, r)
  tickState(ctx, L)
  for (let v = 0; v <= ASI_MAX; v += 50) {
    const a = asiAngle(v)
    const major = v % 100 === 0
    tick(ctx, cx, cy, a, r * 0.94, r * (major ? 0.78 : 0.86))
    // 標到百位：0 2 4 6 8，與高度表的 0..9 同一套讀法
    if (v % 200 === 0) tickLabel(ctx, cx, cy, a, r * 0.62, String(v / 100))
  }
}

function drawAirspeed(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
  cx: number, cy: number, r: number,
): void {
  drawFace(ctx, L, cx, cy, r, airspeedFace, ASI_FACE)

  const kmh = f.ias * 3.6
  needle(ctx, cx, cy, asiAngle(kmh), r * 0.80, 2 * L.scale, HUD_COLORS.primary)

  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = hudFont(12 * L.scale)
  ctx.fillText(kmh.toFixed(0), cx, cy + r * 0.42)
}

/** 長針一圈幾公尺。可投高度弧畫在這一圈上 */
const ALT_NEEDLE_SPAN = 1000

/**
 * 可投高度帶在**長針那一圈**上的起訖角，`needle` 的慣例（0 指 12 點、
 * 順時針為正）。畫不出來時回 `null`。
 *
 * 【範圍是算的，不是寫死的】`env` 由 `main.ts` 從它餵給 `canRelease` 的那一
 * 個物件填進來，所以包絡日後怎麼改、變不變成逐機的，這裡都不用動。
 *
 * 【要補地面高】錶讀的是**海拔**，包絡管的是**離地**。海上兩者相同，飛在
 * 島上空時不補就會把弧畫在錯的刻度上 —— 而畫面上看不出來。
 *
 * 【兩個退化情形都回 `null`】
 *
 * ```
 *   高度不在弧所屬的那一圈   長針每 1,000 m 繞一圈，1,020 m 時它也會落在
 *                            弧裡 —— 玩家高了十倍而錶面在說可以投
 *   弧跨過 1,000 m 的邊界     一段繞回盤面另一頭的弧比不畫更難讀
 * ```
 */
export function releaseBandArc(
  altitude: number, releaseAgl: number, env: ReleaseEnvelope,
): { from: number; to: number } | null {
  const ground = altitude - releaseAgl
  const lo = ground + env.minAgl
  const hi = ground + env.maxAgl
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null
  const turn = Math.floor(lo / ALT_NEEDLE_SPAN)
  if (Math.floor(hi / ALT_NEEDLE_SPAN) !== turn) return null
  if (Math.floor(altitude / ALT_NEEDLE_SPAN) !== turn) return null
  const TAU = Math.PI * 2
  return {
    from: ((lo / ALT_NEEDLE_SPAN) % 1) * TAU,
    to: ((hi / ALT_NEEDLE_SPAN) % 1) * TAU,
  }
}

/**
 * `needle` 的角度（0 指 12 點）換成 canvas `arc()` 的角度（0 指 3 點）。
 *
 * 【這一行掉了不會有東西紅，但弧會整段跑到盤面另一側】所以護欄看的是
 * `ctx.arc()` **實際收到的引數**，不是 `releaseBandArc` 的回傳值。
 */
const toCanvasAngle = (a: number): number => a - Math.PI / 2

/**
 * 可投高度弧的半徑與粗細。
 *
 * 【避開既有的東西】刻度佔 `r*0.78`…`r*0.94`，刻度數字在 `r*0.62`，
 * 長針到 `r*0.82`。弧落在數字與刻度之間那一圈。
 *
 * **起始值，由試飛裁定。**
 */
const BAND_R = 0.71
const BAND_W = 3

/** 高度表不隨讀數變的部分：盤面、刻度、刻度數字 */
function altimeterFace(
  ctx: CanvasRenderingContext2D, L: HudLayout, cx: number, cy: number, r: number,
): void {
  face(ctx, L, cx, cy, r)
  tickState(ctx, L)
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * 360 * DEG
    const major = i % 5 === 0
    tick(ctx, cx, cy, a, r * 0.94, r * (major ? 0.78 : 0.88))
    if (major) tickLabel(ctx, cx, cy, a, r * 0.62, String(i / 5))
  }
}

/** 高度表：長針一圈 1000 m、短針一圈 10000 m。 */
function drawAltimeter(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
  cx: number, cy: number, r: number,
): void {
  drawFace(ctx, L, cx, cy, r, altimeterFace, ALT_FACE)

  // 【可投高度弧排在指針之前】指針必須壓在它上面 —— 讀的是指針落在弧裡沒有
  const band = f.ordnance === 'torpedo' && f.releaseEnv !== null
    ? releaseBandArc(f.altitude, f.releaseAgl, f.releaseEnv)
    : null
  if (band !== null) {
    ctx.strokeStyle = HUD_COLORS.primary
    ctx.lineWidth = BAND_W * L.scale
    ctx.beginPath()
    ctx.arc(cx, cy, r * BAND_R, toCanvasAngle(band.from), toCanvasAngle(band.to))
    ctx.stroke()
    ctx.lineWidth = 1
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

  // 表名與兩個沒有指針的附屬讀數
  const labelY = cy + r + 11 * L.scale
  const subY = labelY + 12 * L.scale

  // 【範圍含外圈的線寬】與 `drawFace` 的 pad 同一式。
  // 【左右多留一點】視窗很扁時底下那行 `TAS … M …` 會比表身寬，切掉的話
  // 那一行字會少一截，而且只在某些視窗比例下才看得出來
  const pad = r + 1.5 * L.scale + 2
  const padX = pad + 8 * L.scale
  drawCachedLayer(ctx, L, DIAL_LAYER, {
    x: asiX - padX,
    y: cy - pad,
    w: altX - asiX + 2 * padX,
    h: subY + 9 * L.scale - (cy - pad),
  }, LOW_RATE, LOW_RATE_PHASE.dials, (c) => {
    drawAirspeed(c, L, f, asiX, cy, r)
    drawAttitude(c, L, f, attX, cy, r)
    drawAltimeter(c, L, f, altX, cy, r)

    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = hudFont(10 * L.scale)

    c.fillStyle = HUD_COLORS.dim
    c.fillText('IAS km/h', asiX, labelY)
    c.fillText('ALT m', altX, labelY)
    // 【紅線警告與失速警告同一組門檻】0.85 是操縱面開始變重的點，0.95 剩 22%
    c.fillStyle = f.vneRatio > 0.95 ? HUD_COLORS.danger
      : f.vneRatio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.dim
    c.fillText(`TAS ${(f.tas * 3.6).toFixed(0)}   M ${f.mach.toFixed(2)}`, asiX, subY)

    c.fillStyle = f.verticalSpeed >= 0 ? HUD_COLORS.primary : HUD_COLORS.warn
    c.fillText(
      `VS ${f.verticalSpeed >= 0 ? '+' : ''}${f.verticalSpeed.toFixed(1)} m/s`,
      altX, subY,
    )
  })
}
