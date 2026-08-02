import { HUD_COLORS, hudFont, type HudLayout } from '../types'

const KEYS = 'W/S 油門   V 視角   右鍵 自由視角   C 換機   R 重置   F3 效能'

/**
 * 按鍵提示。原本長在 Task 20 的臨時鷹架上，鷹架隨 HUD 上線刪除，
 * 但這一行得留著——沒有它，除了滑鼠以外的操作全部是不可發現的。
 */
export function drawHints(ctx: CanvasRenderingContext2D, L: HudLayout): void {
  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(11 * L.scale)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(KEYS, 30 * L.scale, L.height - 10 * L.scale)
}
