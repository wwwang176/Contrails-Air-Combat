import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'
import { typedPrefix } from '../typewriter'
import { smoothstep } from '../../core/math'

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
export function formatObjectiveMetric(
  v: number,
  kind: 'count' | 'distance' | 'percent',
  total = -1,
): string {
  if (!Number.isFinite(v)) return '—'
  const x = v > 0 ? v : 0
  // 【比例印成整數百分比】守住艦隊印的是要害艦還剩幾成
  if (kind === 'percent') return `${Math.round(x * 100)}%`
  if (kind === 'count') {
    // 【有分母就印進度】擊沉是「還差 4 艘」，而單獨一個 4 讀不出打掉幾艘。
    // 分子是**已達成數**，所以它從 0 往上走 —— 與目標列的其他數字（都在
    // 往下掉）方向相反，但那正是玩家在追的那個數。
    if (total >= 0) return `(${total - Math.round(x)}/${total})`
    return String(Math.round(x))
  }
  if (x < METRE_BELOW) return `${Math.round(x)} m`
  return `${(x / 1000).toFixed(1)} km`
}

/**
 * 護送的架數。**進度與本錢分開印，各自帶標籤。**
 *
 * ```
 *   有門檻（arrived ≥ 0）   已抵達 3/8　在途 11 架
 *   沒有門檻（arrived −1）  16 架
 *   沒有架數（兩者 −1）      空字串
 * ```
 *
 * 分母是門檻不是總架數：玩家在追的是「還差幾架過關」。在途只算還沒抵達、
 * 還活著的（`MissionState.remaining`），所以兩個數字加起來會隨損失變小。
 *
 * @param arrived   已抵達幾架，−1 = 這一關沒有門檻
 * @param need      門檻；只在 `arrived ≥ 0` 時讀
 * @param remaining 還在路上幾架，−1 = 這一關沒有這個數字
 */
export function formatConvoyCounts(arrived: number, need: number, remaining: number): string {
  const left = remaining >= 0 ? Math.round(remaining) : -1
  if (arrived < 0) return left >= 0 ? `${left} 架` : ''
  const progress = `已抵達 ${Math.round(arrived)}/${Math.round(need)}`
  return left >= 0 ? `${progress}　在途 ${left} 架` : progress
}

/**
 * 目標列的整行文字：目標、架數、計量、倒數，空的段落不留分隔。
 */
export function formatObjectiveLine(f: HudFrame): string {
  const metric = formatObjectiveMetric(
    f.objectiveMetric, f.objectiveMetricKind, f.objectiveMetricTotal)
  const clock = formatCountdown(f.objectiveSeconds)
  // 【架數排在距離之前】它是勝負的直接量，距離只說還要多久
  const counts = formatConvoyCounts(f.objectiveArrived, f.objectiveNeed, f.objectiveRemaining)
  return [f.objectiveText, counts, metric, clock].filter((s) => s !== '').join('　')
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
 * DOM overlay，所以只看 `hud/widgets/` 是看不到這個衝突的 —— 要靠
 * Playwright 的截圖。
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

  // 【橫幅還在的時候不畫目標列】橫幅滑進來之後才由這一列接手
  const banner = bannerLayout(f.objectiveBannerAge)
  if (banner.phase !== 'done') {
    drawBanner(ctx, L, f, banner)
    return
  }

  const text = formatObjectiveLine(f)

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

// ── 進場橫幅 ─────────────────────────────────────────────────────────

/** 橫幅停在畫面中央的秒數。打字機在這段裡印完 */
export const BANNER_HOLD_SECONDS = 3
/** 從中央滑進右上角目標列的秒數 */
export const BANNER_SLIDE_SECONDS = 0.5
/** 橫幅的字級，px（未乘 scale）。目標列是 14 */
const BANNER_SIZE = 34
/** 橫幅的縱向位置，畫面高度的比例。中央訊息在 0.30，橫幅在它上面 */
const BANNER_Y = 0.20

export interface BannerLayout {
  /** hold＝停在中央、slide＝往右上角滑、done＝沒有橫幅（目標列照常畫） */
  readonly phase: 'hold' | 'slide' | 'done'
  /** 滑動的進度 0～1，hold 是 0、done 是 1 */
  readonly k: number
}

/**
 * 橫幅出現了幾秒 → 現在該畫在哪一段。純函數，時鐘由 `main.ts` 給。
 *
 * 【滑動用 smoothstep】等速的話起步與到位都是一頓，看起來像掉幀
 */
export function bannerLayout(age: number): BannerLayout {
  if (age < 0) return { phase: 'done', k: 1 }
  if (age < BANNER_HOLD_SECONDS) return { phase: 'hold', k: 0 }
  const t = (age - BANNER_HOLD_SECONDS) / BANNER_SLIDE_SECONDS
  if (t >= 1) return { phase: 'done', k: 1 }
  return { phase: 'slide', k: smoothstep(0, 1, t) }
}

/**
 * 橫幅：停在中央時打字機印出，滑動時字級、位置一起由中央內插到目標列的
 * 右上角。底板量的是整句，字打到一半底板不會跟著長。
 */
function drawBanner(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame, lay: BannerLayout,
): void {
  const text = f.objectiveBanner
  if (text === '') return
  const pad = 8 * L.scale
  const size0 = BANNER_SIZE * L.scale
  const size1 = 14 * L.scale
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // 兩個端點各量一次整句的寬，左緣與字級一起內插
  ctx.font = hudFont(size0, true)
  const w0 = ctx.measureText(text).width
  ctx.font = hudFont(size1, true)
  const w1 = ctx.measureText(text).width
  const left0 = L.cx - w0 / 2
  const top0 = L.height * BANNER_Y - size0 / 2
  const left1 = L.width - 30 * L.scale - w1
  const top1 = 18 * L.scale

  const k = lay.k
  const size = size0 + (size1 - size0) * k
  const left = left0 + (left1 - left0) * k
  const top = top0 + (top1 - top0) * k
  const w = w0 + (w1 - w0) * k

  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(left - pad, top - pad * 0.5, w + pad * 2, size + pad)
  ctx.font = hudFont(size, true)
  ctx.fillStyle = HUD_COLORS.primary
  const shown = lay.phase === 'hold' ? typedPrefix(text, f.objectiveBannerAge) : text
  ctx.fillText(shown, left, top)
}
