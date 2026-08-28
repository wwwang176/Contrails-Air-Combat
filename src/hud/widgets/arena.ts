import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 「返回戰場」的警告與倒數。
 *
 * 【為什麼秒數用 ceil】剩 0.2 秒時顯示 0 會讓玩家以為已經沒救了。
 * 進位之後「畫面上的 1」與「還有時間」是同一件事。
 *
 * 【為什麼要 `arenaShow`】界只掛在遭遇戰上 —— 任務卡的撤離點在 −20 km、
 * 護航的集合點 12 km，兩者都在界外。沒有這一格的話，任務裡飛去撤離點會
 * 一路閃警告。
 *
 * 【上帝視角也要畫】界不看視角（`main.ts` 的 `crashPolicy` 不分），所以
 * 少了它上帝視角裡飛機會無預警爆炸。這一條由 `Hud.ts` 的 `GOD` 清單落實。
 */
export function drawArena(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  if (!f.arenaShow || !f.arenaOutside) return

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = HUD_COLORS.warn
  ctx.font = hudFont(28 * L.scale, true)
  ctx.fillText('返回戰場', L.width / 2, L.height * 0.24)

  ctx.font = hudFont(46 * L.scale, true)
  ctx.fillText(
    String(Math.ceil(f.arenaRemaining)), L.width / 2, L.height * 0.24 + 46 * L.scale)
}
