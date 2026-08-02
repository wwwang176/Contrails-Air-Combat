import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/** 目標框在螢幕上的最小／最大半徑，px（未乘 L.scale）。 */
const BOX_MIN = 9
const BOX_MAX = 46

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

    const color = c.hostile ? HUD_COLORS.danger : HUD_COLORS.friendly

    if (!c.behind) {
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
    }

    if (c.leadValid && !c.leadBehind) {
      const lx = L.cx + c.leadX * L.unit
      const ly = L.cy - c.leadY * L.unit
      ctx.strokeStyle = color
      ctx.lineWidth = 2 * L.scale
      ctx.beginPath()
      ctx.arc(lx, ly, 7 * L.scale, 0, Math.PI * 2)
      ctx.stroke()

      // 預瞄環與目標框之間的連線：讓「該往哪裡提前」一眼可讀
      if (!c.behind) {
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
