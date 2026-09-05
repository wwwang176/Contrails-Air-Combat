import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'
import { BOMB_BAY } from '../../weapons/bomb'

/**
 * 整排格子的頂邊離畫面下緣多遠，px（未乘 `L.scale`）。
 *
 * `energy` 的 `THR … kW … 機名` 那一行 baseline 在 26，字級 13 —— 這一排的
 * 底邊落在 41，兩者不重疊。
 */
const BOTTOM = 52
/** 每一格彈的寬與高，px（未乘 `L.scale`） */
const PIP_W = 5
const PIP_H = 11
const PIP_GAP = 3
/**
 * 「裝填中」的 baseline 離格子頂邊多遠，px。
 *
 * 【在格子上方】下方是 `energy` 的 `THR … kW … 機名`，字會疊上去。
 */
const LABEL_RISE = 5

/**
 * 彈艙讀數：**恆是 `BOMB_BAY` 格**，有彈的實心、投掉的空心。
 *
 * 【格數固定，位置才固定】依剩餘彈數畫格子的話，整排的寬度會隨著投彈縮短，
 * 上面那一行字跟著跳。
 *
 * 【釘在畫面下方而不是跟著準星走】它是儀表，與鏡頭在哪裡無關 —— 一般飛行
 * 時本來就沒有準星可以跟。
 */
export function drawBombBay(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (!f.bombCapable) return

  const w = PIP_W * L.scale
  const h = PIP_H * L.scale
  const gap = PIP_GAP * L.scale
  const y = L.height - BOTTOM * L.scale
  const full = BOMB_BAY * w + (BOMB_BAY - 1) * gap
  const x0 = L.cx - full / 2

  ctx.lineWidth = 1 * L.scale
  for (let i = 0; i < BOMB_BAY; i++) {
    const x = x0 + i * (w + gap)
    if (i < f.bombLoad) {
      ctx.fillStyle = HUD_COLORS.primary
      ctx.fillRect(x, y, w, h)
    } else {
      ctx.strokeStyle = HUD_COLORS.dim
      // 【內縮半個線寬】canvas 的描邊跨在路徑上，不縮的話空心格會比實心格寬
      ctx.strokeRect(x + 0.5 * L.scale, y + 0.5 * L.scale, w - L.scale, h - L.scale)
    }
  }

  if (!f.bombReloading) return
  ctx.font = hudFont(Math.round(9 * L.scale))
  ctx.fillStyle = HUD_COLORS.warn
  ctx.textAlign = 'center'
  ctx.fillText(`裝填中 ${f.bombReloadLeft.toFixed(0)}s`, L.cx, y - LABEL_RISE * L.scale)
  ctx.textAlign = 'left'
}
