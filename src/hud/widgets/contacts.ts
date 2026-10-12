import type { HudFrame, HudLayout } from '../types'
import {
  contactBoxRadius, contactColor, dimmedHostile, HUD_COLORS, hudFont, NON_OBJECTIVE_ALPHA,
} from '../style'

/**
 * 畫面外指示的箭頭離邊緣的內縮量，螢幕半高單位。
 *
 * 匯出是為了讓測試用它算期望值——寫死 `1` 或 `aspect` 的話測試必紅，
 * 而那不是浮點誤差，是規格與實作對不起來。
 */
export const EDGE_INSET = 0.06

/**
 * 把畫面外的接觸點壓到視窗邊緣上。座標單位是**螢幕半高**，所以水平方向
 * 的邊界是 aspect、垂直方向是 1。
 *
 * 【背後的目標要反向】NDC 在相機背後會翻號——正前方 30° 的目標與正後方
 * 150° 的目標會投影到同一側。不處理的話，被咬住時箭頭會叫你往前看。
 */
export function edgeIndicatorPosition(
  x: number, y: number, behind: boolean, aspect: number,
): { x: number; y: number; angle: number } {
  const dx = behind ? -x : x
  const dy = behind ? -y : y
  const ex = aspect - EDGE_INSET
  const ey = 1 - EDGE_INSET
  // 沿 (dx, dy) 推到剛好碰到邊框。除以 0 會得到 Infinity，min 自然挑另一軸
  // ——與小地圖的 N 標記是同一個做法。
  const s = Math.min(ex / Math.abs(dx), ey / Math.abs(dy))
  if (!Number.isFinite(s)) return { x: 0, y: 0, angle: 0 }
  return { x: dx * s, y: dy * s, angle: Math.atan2(dy, dx) }
}

/** 主要目標的四角括號：線寬與比目標框外擴多少，px（未乘 `L.scale`） */
export const OBJECTIVE_BRACKET_WIDTH = 2
export const OBJECTIVE_BRACKET_PAD = 3
/** 括號每一臂佔邊長的比例。四角之間留空，與完整的方框一眼分得開 */
const BRACKET_ARM = 0.4

/** 以 (x, y) 為中心、半邊長 r 的四角括號 */
export function drawBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const a = r * 2 * BRACKET_ARM
  ctx.beginPath()
  // 四個角依序是 (−,−) (+,−) (−,+) (+,+)；用位元取號，迴圈裡不造陣列
  for (let i = 0; i < 4; i++) {
    const sx = (i & 1) === 0 ? -1 : 1
    const sy = (i & 2) === 0 ? -1 : 1
    const cx = x + sx * r
    const cy = y + sy * r
    ctx.moveTo(cx - sx * a, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy - sy * a)
  }
  ctx.stroke()
}

/**
 * 邊緣箭頭：實心三角，尖端朝目標。任務目標外面再加一圈同色的空心三角框，
 * 與任務目標框同一個意思 —— 「這一個是任務要的」。
 */
export function drawEdgeArrow(
  ctx: CanvasRenderingContext2D, L: HudLayout, e: { x: number; y: number; angle: number },
  color: string, objective: boolean,
): void {
  const s = L.scale
  ctx.save()
  ctx.translate(L.cx + e.x * L.unit, L.cy - e.y * L.unit)
  ctx.rotate(-e.angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(9 * s, 0)
  ctx.lineTo(-5 * s, 5 * s)
  ctx.lineTo(-5 * s, -5 * s)
  ctx.closePath()
  ctx.fill()
  if (objective) {
    // 外框與實心三角同形、重心相同，三邊各留約 3 px 的空隙
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * s
    ctx.beginPath()
    ctx.moveTo(16 * s, 0)
    ctx.lineTo(-9 * s, 9.5 * s)
    ctx.lineTo(-9 * s, -9.5 * s)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.restore()
}

/** 目標框底下的距離讀數：一律 km、小數一位（`0.9 km`、`0.0 km`） */
export function contactRangeLabel(range: number): string {
  return `${(range / 1000).toFixed(1)} km`
}

/**
 * 目標框與預瞄環。
 *
 * 【目標框畫全部，沒有距離門檻】spec §8。看得到誰就框誰——「哪些該畫」
 * 一旦變成一條規則，就得回答「剛好在門檻上抖動怎麼辦」。
 *
 * 【預瞄環的顯示條件就是「打得到」】不是距離，是「§5.2 有解且 t ≤ 彈丸
 * 壽命」。回收條件與顯示條件用同一個數字，所以兩邊不可能互相矛盾
 * （spec §5.1.1）。
 */
export function drawContacts(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  for (let i = 0; i < f.contactCount; i++) {
    const c = f.contacts[i]!
    if (!c.active) continue

    const color = contactColor(c.hostile, c.flightMate, f.enemyUnaware)
    const aspect = L.width / L.height
    const onScreen = !c.behind && Math.abs(c.x) <= aspect && Math.abs(c.y) <= 1
    // 【開場導覽只畫畫面內的任務目標框】邊緣箭頭與預瞄環都是開打之後才用得到的
    if (f.intro && (!c.objective || !onScreen)) continue
    // 【預瞄環不淡化】護航機咬上來時還是要打得到它
    ctx.globalAlpha = dimmedHostile(f.objectiveTargets, c.hostile, c.objective) ? NON_OBJECTIVE_ALPHA : 1

    if (onScreen) {
      const x = L.cx + c.x * L.unit
      const y = L.cy - c.y * L.unit
      const r = contactBoxRadius(c.radius, L.unit, L.scale)

      ctx.strokeStyle = color
      if (c.objective) {
        ctx.lineWidth = OBJECTIVE_BRACKET_WIDTH * L.scale
        drawBrackets(ctx, x, y, r + OBJECTIVE_BRACKET_PAD * L.scale)
      } else {
        ctx.lineWidth = 1.5 * L.scale
        ctx.strokeRect(x - r, y - r, r * 2, r * 2)
      }

      // 距離讀數貼在框底下。沒有血量——那是刻意的（spec §8）。
      ctx.fillStyle = color
      ctx.font = hudFont(10 * L.scale)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      // 【導覽中不標距離】那時量的是鏡頭到目標，對玩家沒有意義
      if (!f.intro) ctx.fillText(contactRangeLabel(c.range), x, y + r + 3 * L.scale)
    } else {
      // 畫面外指示：**畫全部**，無距離門檻（spec §8）
      drawEdgeArrow(ctx, L, edgeIndicatorPosition(c.x, c.y, c.behind, aspect), color, c.objective)
    }
    ctx.globalAlpha = 1

    if (c.leadValid && !c.leadBehind && !f.intro) {
      const lx = L.cx + c.leadX * L.unit
      const ly = L.cy - c.leadY * L.unit
      ctx.strokeStyle = color
      ctx.lineWidth = 2 * L.scale
      ctx.beginPath()
      ctx.arc(lx, ly, 7 * L.scale, 0, Math.PI * 2)
      ctx.stroke()

      // 預瞄環與目標框之間的連線：讓「該往哪裡提前」一眼可讀。
      // 目標框沒畫（在畫面外）時就不連——連到畫面外會是一條穿出邊界的長線。
      if (onScreen) {
        ctx.strokeStyle = HUD_COLORS.dim
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(L.cx + c.x * L.unit, L.cy - c.y * L.unit)
        ctx.lineTo(lx, ly)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }
}
