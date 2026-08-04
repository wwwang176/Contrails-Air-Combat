import {
  angleDelta, damageWindow, markAngle, markOffAxis, DAMAGE_HALF_WIDTH,
} from '../damageMarks'
import type { HudFrame, HudLayout } from '../types'

/** 沿邊界取樣的段數。64 段 = 每段 5.6°，配上升餘弦窗看不出接縫 */
export const DAMAGE_SEGMENTS = 64

/**
 * 紅帶往內衰減的深度，**短邊的比例**。
 *
 * 【為什麼不是半徑的百分比】用百分比的話角落的半徑比中間長四成，紅帶會在
 * 四個角腫起來（spec §5）。
 */
export const DAMAGE_DEPTH = 0.22

/** 最亮處的 alpha。原型上調出來的（spec §7） */
export const DAMAGE_PEAK_ALPHA = 0.55

/**
 * 紅色的 rgb 三元組，供內插進 `rgba(...)`。
 *
 * 【為什麼不用 `HUD_COLORS.danger`】那個（#ff5a4d）是目標框那種細線的
 * 強調色；攤成一大片半透明會發粉。這裡刻意更飽和（spec §7）。
 */
const DAMAGE_COLOR = '255, 42, 32'

export interface BorderPoint {
  /** 邊界上的螢幕座標 */
  x: number
  y: number
  /** 由畫面中心指向它的單位向量 */
  dx: number
  dy: number
}

/**
 * 由畫面中心朝角度 `theta` 射出去，打在畫面邊界的哪一點。
 *
 * 【為什麼是 `min` 而不是 `max`】最小的那個 t 才會打在真正的矩形邊上。
 * 用圓（固定半徑）的話四個角會空掉 —— 而角落正是「右上方來彈」最需要
 * 亮起來的地方（spec §5）。
 *
 * 【為什麼一併回傳方向】繪製要用它把邊界點往內推一個固定距離。分開各算
 * 一次就是兩份會漂掉的真相。
 */
export function borderPoint(
  theta: number, cx: number, cy: number, out: BorderPoint,
): void {
  // 【螢幕 y 向下】所以 sin 要取負，θ 才是「數學正向、上為正」
  const dx = Math.cos(theta)
  const dy = -Math.sin(theta)
  const tx = Math.abs(dx) > 1e-9 ? cx / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-9 ? cy / Math.abs(dy) : Infinity
  const t = tx < ty ? tx : ty
  out.dx = dx
  out.dy = dy
  out.x = cx + dx * t
  out.y = cy + dy * t
}

// 【模組層的暫存】HUD 每幀跑 64 段 × 2 個點，每段 new 兩個物件就是每幀
// 128 次配置 —— 沿用 M1 §15 的紀律
const A: BorderPoint = { x: 0, y: 0, dx: 0, dy: 0 }
const B: BorderPoint = { x: 0, y: 0, dx: 0, dy: 0 }

/**
 * 受擊方向指示器：螢幕邊緣依來彈方向的紅色漸層。
 *
 * 【為什麼先把所有痕跡加總成一個 alpha(θ) 再畫】重疊的痕跡自然疊亮（夾在
 * 1 以內），而且每幀的填充次數固定 `DAMAGE_SEGMENTS` 次 —— 與同時有幾個
 * 痕跡無關（spec §5）。
 *
 * 【為什麼漸層是「邊界 → 內」而不是徑向】方向永遠垂直於邊界，所以長邊、
 * 短邊、角落看起來是同一條帶子；而往內的深度是一個**固定的螢幕距離**，
 * 光於是只在邊緣、不會跑到畫面中央。
 */
export function drawDamageEdge(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const marks = f.damageMarks
  let live = false
  for (let i = 0; i < marks.length; i++) {
    if (marks[i]!.intensity > 0) {
      live = true
      break
    }
  }
  if (!live) return

  const depth = Math.min(L.width, L.height) * DAMAGE_DEPTH

  for (let s = 0; s < DAMAGE_SEGMENTS; s++) {
    const t0 = (s / DAMAGE_SEGMENTS) * Math.PI * 2
    const t1 = ((s + 1) / DAMAGE_SEGMENTS) * Math.PI * 2
    // 【取中點的值】段夠密（5.6°）而角度窗是平滑的，看不出階梯
    const mid = (t0 + t1) / 2

    let a = 0
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]!
      if (m.intensity <= 0) continue
      a += m.intensity
        * damageWindow(angleDelta(mid, markAngle(m)), DAMAGE_HALF_WIDTH, markOffAxis(m))
    }
    a = Math.min(1, a) * DAMAGE_PEAK_ALPHA
    // 低於 1/255 的 alpha 在畫面上是看不見的，省下一次漸層與一次填充
    if (a <= 0.002) continue

    borderPoint(t0, L.cx, L.cy, A)
    borderPoint(t1, L.cx, L.cy, B)
    const ix0 = A.x - A.dx * depth
    const iy0 = A.y - A.dy * depth
    const ix1 = B.x - B.dx * depth
    const iy1 = B.y - B.dy * depth

    const grad = ctx.createLinearGradient(
      (A.x + B.x) / 2, (A.y + B.y) / 2, (ix0 + ix1) / 2, (iy0 + iy1) / 2,
    )
    grad.addColorStop(0, `rgba(${DAMAGE_COLOR}, ${a.toFixed(3)})`)
    grad.addColorStop(1, `rgba(${DAMAGE_COLOR}, 0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(A.x, A.y)
    ctx.lineTo(B.x, B.y)
    ctx.lineTo(ix1, iy1)
    ctx.lineTo(ix0, iy0)
    ctx.closePath()
    ctx.fill()
  }
}
