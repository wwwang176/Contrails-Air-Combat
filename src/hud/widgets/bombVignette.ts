import type { HudFrame, HudLayout } from '../types'

/**
 * 亮圓佔畫面**短邊**半長的比例。1.0 = 亮圓剛好內切短邊。
 *
 * 必須小於 1：等於 1 時只有四角暗，讀起來像鏡頭髒了。0.82 讓上下緣就開始
 * 收，形狀才是圓的。
 *
 * **起始值，由試飛裁定。**
 */
const INNER = 0.82

/** 全黑處相對亮圓的半徑倍數。這一段是漸層 */
const OUTER = 1.55

/** 最外圈的不透明度。1 = 全黑 */
const DARKNESS = 0.92

/**
 * 投彈模式的圓形暗角 —— 像從望遠鏡看出去。
 *
 * 【排在整個清單的最前面】它壓的是**世界**，不是 HUD。排在後面的話儀表、
 * 小地圖、隊列會被一起壓暗，而那幾個是面板不是視野。
 *
 * 【畫在不震的那一張畫布上】同一個理由 —— 它是鏡頭前的遮罩，不跟著 HUD
 * 震。跟著震的話畫布一移開，邊上就露出一道沒壓暗的世界（見 `Hud.MASK`）。
 *
 * 【徑向漸層而不是黑框】望遠鏡的視野邊緣是連續變暗的；硬邊在這個尺度上會
 * 讀成「畫面被裁掉了」。
 */
export function drawBombVignette(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (!f.bombing) return

  const r0 = (Math.min(L.width, L.height) / 2) * INNER
  const g = ctx.createRadialGradient(L.cx, L.cy, r0, L.cx, L.cy, r0 * OUTER)
  g.addColorStop(0, 'rgba(0, 0, 0, 0)')
  g.addColorStop(0.45, `rgba(0, 0, 0, ${DARKNESS * 0.55})`)
  g.addColorStop(1, `rgba(0, 0, 0, ${DARKNESS})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, L.width, L.height)
}
