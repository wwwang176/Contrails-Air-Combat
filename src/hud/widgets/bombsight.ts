import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'
import { BOMB_BAY } from '../../weapons/bomb'

/**
 * 圓的半徑，px（未乘 `L.scale`）。
 *
 * 滑鼠準星的三倍。那一個圈標的是「你指的方向」，只要標得出一個點；這一個
 * 圈罩的是**落點周圍那一塊地**，要拿去對地面上的東西。
 */
const RADIUS = 33

/** 解不出落點時的中心點半徑，px（未乘 `L.scale`） */
const DEAD_DOT = 1.5

/** 彈艙讀數離準星中心多遠，px（未乘 `L.scale`）。壓在亮圓下緣之外 */
const BAY_DROP = 58
/** 每一格彈的寬與高，px */
const PIP_W = 5
const PIP_H = 11
const PIP_GAP = 3

/**
 * 彈艙讀數：**恆是 `BOMB_BAY` 格**，有彈的實心、投掉的空心。
 *
 * 【格數固定，位置才固定】依剩餘彈數畫格子的話，整排的寬度會隨著投彈縮短，
 * 下面那一行字跟著跳。
 *
 * 【跟著準星走而不是釘在畫面角落】投彈時眼睛在圓圈上，讀數放角落等於要離開
 * 瞄準點才看得到。
 */
function drawBay(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const cx = L.cx
  const y = L.cy + BAY_DROP * L.scale
  const w = PIP_W * L.scale
  const h = PIP_H * L.scale
  const gap = PIP_GAP * L.scale
  const full = BOMB_BAY * w + (BOMB_BAY - 1) * gap
  const x0 = cx - full / 2

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
  ctx.font = `${Math.round(9 * L.scale)}px monospace`
  ctx.fillStyle = HUD_COLORS.warn
  ctx.textAlign = 'center'
  ctx.fillText(`裝填中 ${f.bombReloadLeft.toFixed(0)}s`, cx, y + h + 11 * L.scale)
  ctx.textAlign = 'left'
}

/**
 * 投彈落點的圓準星。**圓形，不是十字。**
 *
 * 【不恆在畫面中央，所以要真的投影】相機自動盯落點，解穩定時圈回到中心；
 * 機動、變速、圓錐夾制時視線的 LERP 讓圈漂開，那個分離量就是「投彈解還沒
 * 收斂」。
 *
 * 【不畫離屏箭頭】圈滑出畫面時已經退成中央的灰點，那本身就是訊號。
 *
 * 【只有兩種樣式】
 *
 * ```
 *   綠實線   有落點，而且它在畫面上 —— 圈就是落點
 *   灰圓點   90 秒內解不出落點，或落點已經滑出畫面
 * ```
 *
 * 【為什麼沒有「被圓錐夾住」的第三種】見 `HudFrame.bombState`。
 */
export function drawBombsight(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (f.bombState === 'off') return
  drawBay(ctx, L, f)

  // 【解不出來時留一個中心點】什麼都不畫的話，「90 秒內落不到地面」與
  // 「HUD 壞了」在畫面上長得一模一樣
  if (f.bombState === 'none' || !f.bombVisible) {
    ctx.fillStyle = HUD_COLORS.dim
    ctx.beginPath()
    ctx.arc(L.cx, L.cy, DEAD_DOT * L.scale, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  const x = L.cx + (f.bombX * L.width) / 2
  const y = L.cy - (f.bombY * L.height) / 2

  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1 * L.scale
  ctx.beginPath()
  ctx.arc(x, y, RADIUS * L.scale, 0, Math.PI * 2)
  ctx.stroke()
}
