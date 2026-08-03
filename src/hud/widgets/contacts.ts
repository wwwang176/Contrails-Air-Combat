import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/** 目標框在螢幕上的最小／最大半徑，px（未乘 L.scale）。 */
const BOX_MIN = 9
const BOX_MAX = 46

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

/**
 * 一個接觸點該用什麼顏色。
 *
 * 敵紅、友藍、**自己分隊的同伴用第三個顏色**。抽成純函數是因為繪製函數
 * 進不了單元測試，而「哪一架該長得不一樣」是一條有實際行為的規則 —— 與
 * `edgeIndicatorPosition`、`minimapSymbol` 是同一個做法。
 */
export function contactColor(hostile: boolean, flightMate: boolean): string {
  if (hostile) return HUD_COLORS.danger
  return flightMate ? HUD_COLORS.warn : HUD_COLORS.friendly
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

    const color = contactColor(c.hostile, c.flightMate)
    const aspect = L.width / L.height
    const onScreen = !c.behind && Math.abs(c.x) <= aspect && Math.abs(c.y) <= 1

    if (onScreen) {
      const x = L.cx + c.x * L.unit
      const y = L.cy - c.y * L.unit
      // 【夾制的上下界要先乘 L.scale 再夾】`c.radius * L.unit` 已經是 CSS px，
      // 若把夾完的結果再乘一次 L.scale，動態尺寸會被二次縮放，而固定的
      // 上下界卻只縮放一次——兩者在不同視窗高度下對不起來。
      const r = Math.max(BOX_MIN * L.scale, Math.min(BOX_MAX * L.scale, c.radius * L.unit))

      ctx.strokeStyle = color
      ctx.lineWidth = 1.5 * L.scale
      ctx.strokeRect(x - r, y - r, r * 2, r * 2)

      // 距離讀數貼在框底下。沒有血量——那是刻意的（spec §8）。
      ctx.fillStyle = color
      ctx.font = hudFont(10 * L.scale)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(`${Math.round(c.range)}`, x, y + r + 3 * L.scale)
    } else {
      // 畫面外指示：**畫全部**，無距離門檻（spec §8）
      const e = edgeIndicatorPosition(c.x, c.y, c.behind, aspect)
      const ax = L.cx + e.x * L.unit
      const ay = L.cy - e.y * L.unit
      ctx.save()
      ctx.translate(ax, ay)
      ctx.rotate(-e.angle)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(9 * L.scale, 0)
      ctx.lineTo(-5 * L.scale, 5 * L.scale)
      ctx.lineTo(-5 * L.scale, -5 * L.scale)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    if (c.leadValid && !c.leadBehind) {
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
