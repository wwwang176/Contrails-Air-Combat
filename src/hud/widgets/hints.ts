import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

const KEYS = 'W/S 油門   V 視角   右鍵 自由視角   I 自機AI   G 上帝視角   F3 效能   ESC 暫停'
const GOD_KEYS = '滑鼠 轉鏡頭   WASD 平移   Q/E 升降   Shift 加速   Tab 記分板   G 離開   ESC 暫停'

/** 自機交給 AI 時的橫幅。 */
const AI_BANNER = 'AI 代飛中，按 I 收回操控'
const GOD_BANNER = '上帝視角，AI 代飛中，按 G 回座艙'

/**
 * 這一幀要顯示哪一行按鍵提示。
 *
 * 【為什麼要分兩行】上帝視角下 W/S 不是油門。寫著油門就是騙人，而按鍵
 * 提示存在的全部理由就是「除了滑鼠以外的操作全部是不可發現的」。
 */
export function hintKeys(godView: boolean): string {
  return godView ? GOD_KEYS : KEYS
}

/**
 * 按鍵提示。原本長在 Task 20 的臨時鷹架上，鷹架隨 HUD 上線刪除，
 * 但這一行得留著——沒有它，除了滑鼠以外的操作全部是不可發現的。
 */
export function drawHints(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  if (!f.touch) {
    ctx.fillStyle = HUD_COLORS.dim
    ctx.font = hudFont(11 * L.scale)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(hintKeys(f.godView), 30 * L.scale, L.height - 10 * L.scale)
  }

  // 【為什麼一定要有指示燈】接管與否從畫面上看不出來——飛機自己在動，
  // 而滑鼠沒有反應。沒有這一行，第一個反應會是「操縱壞了」。
  //
  // 【上帝視角的橫幅不一樣】那個模式下「飛機在動而滑鼠沒反應」根本不是
  // 症狀（鏡頭本來就不在飛機上），要講的是另外兩件事：自機交給誰了、
  // 以及指揮官現在管得到你。
  if (f.godView) {
    ctx.fillStyle = HUD_COLORS.warn
    ctx.font = hudFont(13 * L.scale, true)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(GOD_BANNER, L.cx, 18 * L.scale)
    return
  }
  if (!f.aiFlying) return
  ctx.fillStyle = HUD_COLORS.warn
  ctx.font = hudFont(13 * L.scale, true)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(AI_BANNER, L.cx, 18 * L.scale)

  // 【AI 現在以為自己在做什麼】飛機在做什麼看得見，AI 的判讀看不見。少了
  // 這一行，「它抬頭又低頭」這種回報對不回任何一條規則。
  //
  // 【為什麼跟橫幅放在一起而不是另開一個 widget】它與橫幅是同一件事的兩半
  // ——「誰在飛」與「它在想什麼」，而且生死條件完全相同（`aiFlying`）。
  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = hudFont(12 * L.scale)
  ctx.fillText(aiStateLine(f), L.cx, 36 * L.scale)
}

/**
 * 代飛讀數的那一行。**抽出來是為了驗得到** —— canvas 在 node 環境驗不到，
 * 但「相位是 off 時不該印出一個空格子」這種事會壞。
 */
export function aiStateLine(f: HudFrame): string {
  // 理由與戰術階段都修飾原意圖，合併在同一組括號內；安全層接管則是另一件事。
  const details: string[] = []
  if (f.aiExtendWhy) details.push(f.aiExtendWhy)
  if (f.aiPhase && f.aiPhase !== 'off') details.push(f.aiPhase)
  const detail = details.length > 0 ? `（${details.join('／')}）` : ''
  const parts = [`意圖 ${f.aiIntent || '—'}${detail}`, `模式 ${f.aiMode || '—'}`]
  if (f.aiOverride && f.aiOverride !== 'off') parts.push(`介入 ${f.aiOverride}`)
  return parts.join('   ')
}
