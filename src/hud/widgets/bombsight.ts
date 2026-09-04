import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/**
 * 圓的半徑，px（未乘 `L.scale`）。與滑鼠準星同尺寸 —— 它們是同一種東西：
 * 「你指的地方」。
 */
const RADIUS = 11

/** 解不出落點時的中心點半徑，px（未乘 `L.scale`） */
const DEAD_DOT = 1.5

/**
 * 投彈落點的圓準星。**圓形，不是十字**（專案負責人指定）。
 *
 * 【為什麼它不會恆在畫面中央】相機自動盯落點，所以解穩定時圓圈確實回到中心；
 * 但飛機一機動、速度一變、圓錐一夾制，視線的 LERP 就讓圓圈漂開。那個分離量
 * 與滑鼠準星／機首十字的分離量是同一個語言 —— 只是這次它代表「投彈解還沒
 * 收斂」。所以圓圈要真的投影，不能寫死在中心。
 *
 * 【為什麼不畫離屏箭頭】落點跑出畫面只會發生在 `clamped` 之下，而那個狀態
 * 本身已經在警告了。再加一個指標是同一件事講兩次。
 */
export function drawBombsight(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (f.bombState === 'off') return

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
  const clamped = f.bombState === 'clamped'

  ctx.strokeStyle = clamped ? HUD_COLORS.warn : HUD_COLORS.primary
  ctx.lineWidth = 1 * L.scale
  // 【夾制中畫虛線】圓圈這時停在圓錐面上，不在真正的落點上 —— 那件事必須
  // 看得出來，否則玩家會照著一個假的落點投彈
  if (clamped) ctx.setLineDash([4 * L.scale, 4 * L.scale])
  ctx.beginPath()
  ctx.arc(x, y, RADIUS * L.scale, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
}
