import { contactColor, type HudFrame, type HudLayout } from '../types'

/**
 * 倒三角形標記的尺寸，CSS px。**未乘 `L.scale`。**
 *
 * 【為什麼是固定尺寸而不是像目標框那樣隨距離縮放】標記要解決的就是
 * 「太小看不到」—— 跟著距離縮小等於把問題原封不動搬回來。目標框畫的是
 * 目標的**張角**（那是可讀的情報），標記畫的只是「這裡有東西」。
 */
export const MARKER_HALF = 5
export const MARKER_HEIGHT = 8
/** 尖端與物體之間的空隙。貼死的話符號會把只有幾個像素的炸彈整個蓋掉 */
export const MARKER_GAP = 3

/**
 * 倒三角形的三個頂點，寫進 `out`：x0,y0（尖端）、x1,y1（左上）、
 * x2,y2（右上）。`x`／`y` 是物體投影後的 CSS px。
 *
 * ```
 *   ┌───────┐   ← 上緣
 *    \     /
 *     \   /
 *      V        ← 尖端，物體正上方 MARKER_GAP
 *      ·        ← 物體
 * ```
 *
 * 【為什麼尖端在物體上方而不是中心對齊】倒三角形是一個「指下去」的符號。
 * 中心對齊的話它指的是物體**下方**一個空點。
 *
 * 【為什麼只有尺寸吃 scale】`x`／`y` 進來時已經是 CSS px（呼叫端乘過
 * `L.unit`）。位置再乘一次的話，高解析度視窗上標記會飄離它標的東西。
 */
export function markerPath(x: number, y: number, scale: number, out: Float64Array): void {
  const tipY = y - MARKER_GAP * scale
  const topY = tipY - MARKER_HEIGHT * scale
  const half = MARKER_HALF * scale
  out[0] = x; out[1] = tipY
  out[2] = x - half; out[3] = topY
  out[4] = x + half; out[5] = topY
}

/** 熱路徑不配置。HUD 走畫面頻率，但一幀最多 96 個標記，省得下來就省 */
const P = new Float64Array(6)

/**
 * 彈藥與艦船的標記。
 *
 * 【為什麼不畫畫面外指示】目標框那一套有邊緣箭頭（`edgeIndicatorPosition`），
 * 這裡刻意不套：64 顆彈的箭頭擠在邊框上是雜訊。標記要回答的是「它在畫面上
 * 的哪裡」，不是「它在畫面外」。
 *
 * 【為什麼沒有距離讀數】同上 —— 一顆正在落下的炸彈的距離不影響任何決定。
 */
export function drawMarkers(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const aspect = L.width / L.height
  for (let i = 0; i < f.markerCount; i++) {
    const m = f.markers[i]!
    if (!m.active || m.behind) continue
    if (Math.abs(m.x) > aspect || Math.abs(m.y) > 1) continue

    markerPath(L.cx + m.x * L.unit, L.cy - m.y * L.unit, L.scale, P)
    ctx.fillStyle = contactColor(m.hostile, false)
    ctx.beginPath()
    ctx.moveTo(P[0]!, P[1]!)
    ctx.lineTo(P[2]!, P[3]!)
    ctx.lineTo(P[4]!, P[5]!)
    ctx.closePath()
    ctx.fill()
  }
}
