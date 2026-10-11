import type { HudFrame, HudLayout } from '../types'
import { contactBoxRadius, contactColor, dimmedHostile, hudFont, NON_OBJECTIVE_ALPHA } from '../style'
import {
  contactRangeLabel, drawBrackets, edgeIndicatorPosition, OBJECTIVE_BRACKET_WIDTH,
} from './contacts'

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
 * 【畫面外指示只給最近的主要目標】目標框那一套每一架都有邊緣箭頭
 * （`edgeIndicatorPosition`），這裡不套：64 顆彈的箭頭擠在邊框上是雜訊。
 *
 * 【主要目標畫成目標框，其餘是三角形】主要目標用四角括號與底下的距離讀數，
 * 與飛機的主要目標同一個樣子；一顆正在落下的炸彈、一座高砲的距離不影響任何
 * 決定，只標位置。有主要目標的關，其餘敵方淡化。
 */
export function drawMarkers(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const aspect = L.width / L.height
  /** 最近的主要目標，−1 = 沒有。畫面外時畫邊緣箭頭 */
  let nearest = -1
  for (let i = 0; i < f.markerCount; i++) {
    const m = f.markers[i]!
    if (!m.active) continue
    if (m.objective && (nearest < 0 || m.range < f.markers[nearest]!.range)) nearest = i
    if (m.behind || Math.abs(m.x) > aspect || Math.abs(m.y) > 1) continue

    const color = contactColor(m.hostile, false, f.enemyUnaware)
    if (m.objective) {
      // 【主要目標照飛機的目標框畫】括號框住物體中心、大小與目標框同一把尺，
      // 距離讀數貼在下面；有框就不再疊三角形
      const bx = L.cx + m.centerX * L.unit
      const by = L.cy - m.centerY * L.unit
      const br = contactBoxRadius(m.radius, L.unit, L.scale)
      ctx.strokeStyle = color
      ctx.lineWidth = OBJECTIVE_BRACKET_WIDTH * L.scale
      drawBrackets(ctx, bx, by, br)
      ctx.fillStyle = color
      ctx.font = hudFont(10 * L.scale)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(contactRangeLabel(m.range), bx, by + br + 3 * L.scale)
      continue
    }

    markerPath(L.cx + m.x * L.unit, L.cy - m.y * L.unit, L.scale, P)
    ctx.globalAlpha = dimmedHostile(f.objectiveTargets, m.hostile, m.objective) ? NON_OBJECTIVE_ALPHA : 1
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(P[0]!, P[1]!)
    ctx.lineTo(P[2]!, P[3]!)
    ctx.lineTo(P[4]!, P[5]!)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.globalAlpha = 1
  if (nearest >= 0) drawObjectiveArrow(ctx, L, f, f.markers[nearest]!, aspect)
}

/**
 * 最近的主要目標在畫面外（或背後）時，邊緣上的箭頭，與目標框的畫面外指示
 * 同一個形狀與顏色。**只畫最近那一個** —— 每一座都畫的話整圈邊框都是箭頭。
 */
function drawObjectiveArrow(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame, m: HudFrame['markers'][number], aspect: number,
): void {
  if (!m.behind && Math.abs(m.x) <= aspect && Math.abs(m.y) <= 1) return
  const e = edgeIndicatorPosition(m.x, m.y, m.behind, aspect)
  ctx.save()
  ctx.translate(L.cx + e.x * L.unit, L.cy - e.y * L.unit)
  ctx.rotate(-e.angle)
  ctx.fillStyle = contactColor(m.hostile, false, f.enemyUnaware)
  ctx.beginPath()
  ctx.moveTo(9 * L.scale, 0)
  ctx.lineTo(-5 * L.scale, 5 * L.scale)
  ctx.lineTo(-5 * L.scale, -5 * L.scale)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}
