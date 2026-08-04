import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

const KEYS = 'W/S 油門   V 視角   右鍵 自由視角   I 自機AI   F3 效能   ESC 暫停'

/** 自機交給 AI 時的橫幅。 */
const AI_BANNER = 'AI 接管中 —— 左鍵失效，右鍵自由視角照常，再按 I 收回'

/**
 * 按鍵提示。原本長在 Task 20 的臨時鷹架上，鷹架隨 HUD 上線刪除，
 * 但這一行得留著——沒有它，除了滑鼠以外的操作全部是不可發現的。
 */
export function drawHints(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(11 * L.scale)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(KEYS, 30 * L.scale, L.height - 10 * L.scale)

  // 【為什麼一定要有指示燈】接管與否從畫面上看不出來——飛機自己在動，
  // 而滑鼠沒有反應。沒有這一行，第一個反應會是「操縱壞了」。
  if (!f.aiFlying) return
  ctx.fillStyle = HUD_COLORS.warn
  ctx.font = hudFont(13 * L.scale, true)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(AI_BANNER, L.cx, 18 * L.scale)
}
