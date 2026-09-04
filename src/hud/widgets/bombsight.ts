import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'
import { BOMB_BAY, BOMB_RELOAD_SECONDS } from '../../weapons/bomb'

/**
 * 圓的半徑，px（未乘 `L.scale`）。
 *
 * 【為什麼是滑鼠準星的三倍】負責人指定。那一個圈是「你指的方向」，尺寸只要
 * 標得出一個點；這一個圈罩的是**落點周圍那一塊地**，玩家要拿它去對地面上的
 * 東西，太小就對不準。
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
 * 彈艙讀數：一枚彈一格，補彈時整排變成一條進度條。
 *
 * 【為什麼跟著準星走而不是釘在畫面角落】投彈時眼睛在圓圈上，讀數放在角落
 * 等於要離開瞄準點才看得到。跟著圓圈的話餘光就讀得到。
 */
function drawBay(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const total = f.bombLoad
  const cx = L.cx
  const y = L.cy + BAY_DROP * L.scale
  const w = PIP_W * L.scale
  const h = PIP_H * L.scale
  const gap = PIP_GAP * L.scale

  if (f.bombReloading) {
    // 補彈中：一條走完就滿的進度條，寬度與滿艙那一排相同
    const full = BOMB_BAY * w + (BOMB_BAY - 1) * gap
    const done = Math.max(0, Math.min(1, 1 - f.bombReloadLeft / BOMB_RELOAD_SECONDS))
    ctx.strokeStyle = HUD_COLORS.dim
    ctx.lineWidth = 1 * L.scale
    ctx.strokeRect(cx - full / 2, y, full, h)
    ctx.fillStyle = HUD_COLORS.dim
    ctx.fillRect(cx - full / 2, y, full * done, h)
    ctx.font = `${Math.round(9 * L.scale)}px monospace`
    ctx.fillStyle = HUD_COLORS.warn
    ctx.textAlign = 'center'
    ctx.fillText(`補彈 ${f.bombReloadLeft.toFixed(0)}s`, cx, y + h + 11 * L.scale)
    ctx.textAlign = 'left'
    return
  }

  if (total <= 0) return
  const full = total * w + (total - 1) * gap
  ctx.fillStyle = HUD_COLORS.primary
  for (let i = 0; i < total; i++) ctx.fillRect(cx - full / 2 + i * (w + gap), y, w, h)
}

/**
 * 投彈落點的圓準星。**圓形，不是十字**（專案負責人指定）。
 *
 * 【為什麼它不會恆在畫面中央】相機自動盯落點，所以解穩定時圓圈確實回到中心；
 * 但飛機一機動、速度一變、圓錐一夾制，視線的 LERP 就讓圓圈漂開。那個分離量
 * 與滑鼠準星／機首十字的分離量是同一個語言 —— 只是這次它代表「投彈解還沒
 * 收斂」。所以圓圈要真的投影，不能寫死在中心。
 *
 * 【為什麼不畫離屏箭頭】圈滑出畫面時已經退成中央的灰點了，那本身就是訊號。
 * 再加一個指標是同一件事講兩次。
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
