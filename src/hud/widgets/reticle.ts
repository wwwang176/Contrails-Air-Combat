import { HIT_FLASH_SECONDS, HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/**
 * 命中 `X` 的四道短線與十字中心的距離，px（未乘 L.scale）。
 *
 * 命中的瞬間在 FAR，接著在 0.15 s 內收到 NEAR——「往內縮」讀起來就是
 * 彈著往目標收斂。連續命中時計時器一直被重置，X 會停在 FAR 不動，
 * 那正好是「還在打中」最清楚的狀態。
 */
const HIT_X_FAR = 17
const HIT_X_NEAR = 11

/**
 * 收縮動畫的長度，秒。
 *
 * **比 HIT_FLASH_SECONDS 短**：收縮在前 0.05 s 走完，剩下的時間停在 NEAR。
 * 攤在整個 0.15 s 上的話，動作慢到看起來像在飄而不是被打中。
 */
const HIT_X_SHRINK_SECONDS = 0.05

/**
 * 四個元件的線寬，px（未乘 `L.scale`）。
 *
 * 【命中 X 最粗】它是這一組裡唯一「剛剛發生了一件事」的東西，其餘三個
 * 是常駐的瞄準參考。一樣粗的話它在連射時讀不出來。
 *
 * 【連線最細】它只是把兩個準星連起來，讀的是**方向**不是位置。與準星
 * 同粗的話，畫面中央會變成一個三件東西打結的圖案。
 */
const CIRCLE_WIDTH = 1.6
const CROSS_WIDTH = 1.6
const HIT_X_WIDTH = 2.2
const LINK_WIDTH = 1

/**
 * 滑鼠準星（圓）與飛機準星（十字）。兩者的分離距離就是「飛機跟不上意圖」的視覺化。
 *
 * 相機跟著瞄準點走，所以圓圈恆在畫面正中央，會漂的是十字。沒有可動範圍的
 * 邊界可畫——瞄準點不受任何夾制（見 input/aim.ts）。
 */
export function drawReticle(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  // 滑鼠準星（圓形）。接近失速時轉為警示色
  const stallRatio = Math.abs(f.alpha) / f.alphaCrit
  const mx = L.cx + f.aimX * L.unit
  const my = L.cy - f.aimY * L.unit
  if (f.aimVisible) {
    ctx.strokeStyle =
      stallRatio > 0.95 ? HUD_COLORS.danger : stallRatio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.primary
    ctx.lineWidth = CIRCLE_WIDTH * L.scale
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
    ctx.lineWidth = CROSS_WIDTH * L.scale
    ctx.beginPath()
    ctx.moveTo(nx - a, ny); ctx.lineTo(nx - gap, ny)
    ctx.moveTo(nx + gap, ny); ctx.lineTo(nx + a, ny)
    ctx.moveTo(nx, ny - a); ctx.lineTo(nx, ny - gap)
    ctx.moveTo(nx, ny + gap); ctx.lineTo(nx, ny + a)
    ctx.stroke()

    // 命中回饋：`X` 標記。血量在二戰題材上說不通——你看不出對方的結構
    // 完整度——所以回饋就是這個標記，那是這個世界裡真的存在的東西
    // （彈著的閃光）。0.15 s，期間再命中則重新計時（spec §8）。
    if (f.hitFlash > 0) {
      // 0（剛命中）→ 1（收縮走完）。之後停在 NEAR 直到標記消失。
      const elapsed = HIT_FLASH_SECONDS - f.hitFlash
      const t = Math.min(1, elapsed / HIT_X_SHRINK_SECONDS)
      const d = (HIT_X_FAR + (HIT_X_NEAR - HIT_X_FAR) * t) * L.scale
      const w = 3.5 * L.scale
      // 【黃而不是紅】紅是 HUD 上「你有麻煩」的顏色（失速的圓、受擊的邊框、
      // 敵機的框）。打中人是好事，用同一個紅會讓一個正面回饋長得像警告
      ctx.strokeStyle = HUD_COLORS.warn
      ctx.lineWidth = HIT_X_WIDTH * L.scale
      ctx.beginPath()
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        ctx.moveTo(nx + sx * d, ny + sy * d)
        ctx.lineTo(nx + sx * (d + w), ny + sy * (d + w))
      }
      ctx.stroke()
    }

    // 兩準星之間的連線，強化「跟不上」的感受
    if (f.aimVisible) {
      ctx.strokeStyle = HUD_COLORS.dim
      // 【虛線的格也要乘 scale】線寬乘了而格沒乘的話，高解析度下虛線會
      // 變成一條幾乎連續的線
      ctx.lineWidth = LINK_WIDTH * L.scale
      ctx.setLineDash([4 * L.scale, 4 * L.scale])
      ctx.beginPath()
      ctx.moveTo(nx, ny); ctx.lineTo(mx, my)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
}
