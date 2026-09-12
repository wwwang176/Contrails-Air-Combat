import {
  REPORT_SECONDS_PER_CHAR, reportAlpha, reportSlide, reportText,
} from '../battleReport'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'
import { typedPrefix } from '../typewriter'

/**
 * 最新那一行的高度，**螢幕高的比例**。往下長。
 *
 * 【為什麼錨在頂而不是錨在底】錨在底的話每來一則，整疊字都往上跳一格 ——
 * 正在讀的那一行會在眼睛底下移動。錨在頂則是新的永遠出現在同一個位置。
 *
 * 【為什麼是 0.62】上面 0.30 是節拍預警、0.32 是能量條；四行往下長到
 * 0.72，而儀表、小地圖與血條在 0.8 之下。兩頭都不疊。
 */
const TOP_Y = 0.62

/** 行距，px（未乘 scale）。 */
const LINE_HEIGHT = 24

/** 字級，px（未乘 scale）。比節拍預警小一階 —— 它是回饋，不是預警。 */
const FONT_SIZE = 17

/** 底板相對文字的左右留白與上下留白，px（未乘 scale）。 */
const PAD_X = 12
const PAD_Y = 5

/**
 * 玩家自己的戰果通報。新的在最上面，舊的往下推、淡出。
 *
 * 【為什麼要有底板】與 `message.ts` 逐字同一條：文字會落在天空、海面或
 * 山上，純文字在其中至少一種上讀不出來。
 *
 * 【為什麼不置中對齊而是靠左】一疊長短不一的字置中的話，左緣會逐行參差，
 * 眼睛沿著左緣往下掃就掃不動了。整疊共用一條左緣 —— 那條左緣本身置中。
 */
export function drawBattleReport(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const r = f.report
  if (r.count === 0) return

  const size = FONT_SIZE * L.scale
  ctx.font = hudFont(size, true)
  ctx.textBaseline = 'middle'

  // 【左緣量整疊裡最寬的那一行】逐行各自置中的話左緣會參差；而底板逐行
  // 貼著自己的字寬，右緣才不會拖出一條沒有字的黑帶
  let widest = 0
  for (let i = 0; i < r.count; i++) {
    const w = ctx.measureText(reportText(r.lines[i]!)).width
    if (w > widest) widest = w
  }
  const left = L.cx - widest / 2

  const padX = PAD_X * L.scale
  const padY = PAD_Y * L.scale
  const h = size + padY * 2
  for (let i = 0; i < r.count; i++) {
    const line = r.lines[i]!
    const alpha = reportAlpha(line, f.reportTime)
    if (alpha <= 0) continue
    const text = reportText(line)
    // 【減掉還沒滑完的那一段】被擠下來的行從上一格的位置滑到自己的位置
    const row = i - reportSlide(line, f.reportTime)
    const y = L.height * TOP_Y + row * LINE_HEIGHT * L.scale

    // 【底板與字共用同一個 alpha】分開淡的話，字先透出底板再一起消失，
    // 那一段看起來像底板自己閃了一下
    ctx.globalAlpha = alpha
    const w = ctx.measureText(text).width
    ctx.fillStyle = HUD_COLORS.panel
    ctx.fillRect(left - padX, y - h / 2, w + padX * 2, h)

    // 【底板量整句、字打字機印】底板跟著字長的話會一格一格抖 ——
    // 與 `message.ts` 同一條
    ctx.fillStyle = HUD_COLORS.primary
    ctx.textAlign = 'left'
    ctx.fillText(
      typedPrefix(text, f.reportTime - line.bornAt, REPORT_SECONDS_PER_CHAR),
      left, y,
    )
  }
  ctx.globalAlpha = 1
}
