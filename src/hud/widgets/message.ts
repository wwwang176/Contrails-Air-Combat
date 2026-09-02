import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 訊息帶在畫面上的高度，**螢幕高的比例**。
 *
 * 【為什麼在中心之上而不是正中心】正中心是準星。訊息蓋在準星上的那幾秒，
 * 玩家看不見自己往哪裡打 —— 而預警出現的時機正好就是他最需要開槍的時候。
 *
 * 【為什麼不再往上】0.30 之上是航向帶（`tape.ts`，0.07）與存活數
 * （`roster.ts`，0.04）那一疊；再往上就疊到它們了。
 */
const BAND_Y = 0.30

/** 底板相對文字的左右留白與上下留白，px（未乘 scale）。 */
const PAD_X = 18
const PAD_Y = 9

/**
 * 畫面中心的訊息。**節拍的預警與任務更新走這裡。**
 *
 * 【為什麼要有底板】文字會落在天空、海面或山上 —— 三種底色。純文字在其中
 * 至少一種上讀不出來，而讀不出來的預警等於沒有預警。
 *
 * 【為什麼不做淡入淡出】訊息在不在由 `main.ts` 依物理時間決定（見
 * `HudFrame.message`）。widget 自己持有動畫狀態的話，暫停與換場時它會繼續
 * 走，而那兩個時機正是訊息最可能還掛在畫面上的時候。
 */
export function drawMessage(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  if (f.message === '') return

  const y = L.height * BAND_Y
  ctx.font = hudFont(20 * L.scale, true)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const w = ctx.measureText(f.message).width
  const padX = PAD_X * L.scale
  const padY = PAD_Y * L.scale
  const h = 20 * L.scale + padY * 2
  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(L.cx - w / 2 - padX, y - h / 2, w + padX * 2, h)

  ctx.fillStyle = HUD_COLORS.warn
  ctx.fillText(f.message, L.cx, y)
}
