import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 距離改用公尺顯示的門檻，m。
 *
 * 【為什麼要換單位】撤離的最後 1 km 是最緊張的一段，而「0.9 km」這個數字
 * 每兩秒才動一次小數點。換成公尺之後它每一幀都在跳 —— 那正是玩家要的回饋。
 *
 * 【為什麼取 1000】它等於抵達半徑的起始值，所以「換成公尺」與「進入判定
 * 範圍」在畫面上是同一件事。半徑若掃描後改了，這個數字**不必**跟著改 ——
 * 兩者的理由不同：一個是可讀性，一個是規則。
 */
const METRE_BELOW = 1000

/**
 * 倒數轉紅的門檻，秒。【起始值，待掃描】
 *
 * 【`Infinity < URGENT` 是 false】所以無時限的任務恆是綠的，不必特例。
 */
const URGENT = 30

/**
 * 計量的文字。
 *
 * 【為什麼非有限值印破折號而不是 0】0 在殲滅那一側的意思是「贏了」。
 * 讓一個壞掉的數字長得像勝利，是最糟的失敗模式。
 */
export function formatObjectiveMetric(v: number, kind: 'count' | 'distance'): string {
  if (!Number.isFinite(v)) return '—'
  const x = v > 0 ? v : 0
  if (kind === 'count') return String(Math.round(x))
  if (x < METRE_BELOW) return `${Math.round(x)} m`
  return `${(x / 1000).toFixed(1)} km`
}

/**
 * 倒數。`Infinity` 回空字串 —— 無時限時整段不畫。
 *
 * 【為什麼用 `ceil` 而不是 `floor`】倒數顯示 0 的那一刻應該是真的到了，
 * 而不是「還有 0.9 秒」。`floor` 會讓玩家看著 0 又飛了將近一秒。
 */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  const s = seconds > 0 ? Math.ceil(seconds) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * 目標列。**畫面右上角**，一行、靠右對齊。
 *
 * 【為什麼不放上緣正中】那裡已經有三層：AI／上帝視角橫幅（`hints.ts`，
 * y=18）、存活數（`roster.ts`，y=0.04·height）、航向帶（`tape.ts`，
 * y=0.07·height）。900 px 高時它們分別落在 18–31、36–51、63 —— 塞第四個
 * 一定壓到某一個。
 *
 * 【為什麼也不放左上角】那裡有**效能面板**（`core/perf.ts`），而它
 * `visible = true`、預設就是開的（F3 才關）。它不是 HUD 的 widget 是一個
 * DOM overlay，所以只看 `hud/widgets/` 是看不到這個衝突的 —— Playwright
 * 的截圖才照出來（2026-08-16）。
 *
 * 【右上角】整片是空的：航向帶與存活數置中、儀表血條能量在下半、
 * 小地圖與提示在左下。
 *
 * 【組字串在這裡是可以的】HUD 走的是**畫面**頻率（~60 Hz）而不是物理步
 * （240 Hz），而且 `dials.ts` 等既有 widget 本來就在組。不配置的紀律守的是
 * 物理熱路徑，那一側是 `stepMission`（它刻意不碰任何字串）。
 */
export function drawObjective(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  if (!f.objectiveActive) return

  const metric = formatObjectiveMetric(f.objectiveMetric, f.objectiveMetricKind)
  const clock = formatCountdown(f.objectiveSeconds)
  const text = clock === ''
    ? `${f.objectiveText}　${metric}`
    : `${f.objectiveText}　${metric}　${clock}`

  const size = Math.round(14 * L.scale)
  const pad = 8 * L.scale
  // 【與左欄同一個邊距，鏡射到右邊】`energy.ts`／`health.ts`／`minimap.ts`
  // 用的都是 30·scale
  const x = L.width - 30 * L.scale
  const y = 18 * L.scale
  ctx.font = hudFont(size, true)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'

  const w = ctx.measureText(text).width
  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x - w - pad, y - pad * 0.5, w + pad * 2, size + pad)

  // 【倒數快到時整列轉紅，不只轉那三個字元】纏鬥中的餘光掃不到三個字元的
  // 顏色變化，掃得到一整列。
  ctx.fillStyle = f.objectiveSeconds < URGENT ? HUD_COLORS.danger : HUD_COLORS.primary
  ctx.fillText(text, x, y)
}
