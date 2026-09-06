import { clamp } from '../../core/math'
import { PILOT_G_NEGATIVE } from '../../control/limiters'
import type { HudFrame, HudLayout } from '../types'

/**
 * 黑視的起點與全黑點。
 *
 * 【原始設計意圖】spec §6.6 寫 6 與 8。當時 `pitchRateLimit` 把過載硬夾在
 * `PILOT_G_POSITIVE` = 6.5，極限持續轉彎會落在 (6.5−6)/(8−6) = **25%**
 * 強度 —— 看得到但還能打。
 *
 * 【門檻不可以留在 6/8】過載上限是結構極限 8 G（Bf109 7.5），沒有生理
 * 硬夾（見 `control/limiters.ts`）。門檻 6/8 之下 P-51D 每一次極限轉彎
 * 都是 **100% 全黑** —— 等於用「看不見」換「轉得緊」。
 *
 * 【搬多少】兩個門檻同時 +1.5，也就是上限從 6.5 移到 8.0 的同一個位移。
 * 於是極限持續轉彎重新落在 (8−7.5)/(9.5−7.5) = **25%** —— 與原始設計
 * 意圖逐字相同，只是錨點跟著新的上限走。Bf109 的 7.5 G 落在 0%。
 *
 * 生理上 7.5 G 起漸暗、9.5 G 全黑，對受過訓練、穿抗 G 衣的飛行員仍在
 * 合理範圍（無抗 G 衣的放鬆耐受約 4~5 G，繃緊動作 +1~2 G，抗 G 衣再 +1~1.5 G）。
 *
 * 【這一組是待人工試飛定案的起手值，不是實測回填】它保住的是「極限轉彎
 * 看得到」這個**意圖**；黑視該不該變得更兇是負責人的決定。另一個
 * 尚未處理的問題是**不對稱**：黑視只作用在玩家（本檔是 HUD widget），
 * AI 拉 8 G 沒有任何生理代價。
 */
const BLACKOUT_ONSET_G = 7.5
const BLACKOUT_FULL_G = 9.5
/**
 * 紅視的起點與飽和點。起點 −3 G 是 spec §6.6 明寫的（＝PILOT_G_NEGATIVE）；
 * spec 沒規定飽和點，取 −5 G，讓「剛過門檻」不會一下子整個畫面全紅。
 */
const REDOUT_ONSET_G = PILOT_G_NEGATIVE
const REDOUT_FULL_G = -5
/** 生理效應的累積與恢復時間常數，秒 */
const ONSET_TIME = 1.6
const RECOVERY_TIME = 2.4

let blackout = 0
let redout = 0

export function resetGEffect(): void {
  blackout = 0
  redout = 0
}

export interface GEffect {
  /** 黑視強度，0..1 */
  blackout: number
  /** 紅視強度，0..1 */
  redout: number
}

/**
 * 推進生理效應的累積量，回傳目前強度。
 *
 * 【為什麼與繪圖分開】時間常數是 spec §6.6 的實質要求（「瞬間拉一下不該立刻
 * 全黑」），而 Canvas 繪圖在 node 環境測不了。拆成純函數之後，會不會在一幀之內
 * 全黑就是一條普通的單元測試。
 */
export function advanceGEffect(loadFactor: number, dt: number): GEffect {
  const overG = clamp(
    (loadFactor - BLACKOUT_ONSET_G) / (BLACKOUT_FULL_G - BLACKOUT_ONSET_G), 0, 1,
  )
  const underG = clamp(
    (loadFactor - REDOUT_ONSET_G) / (REDOUT_FULL_G - REDOUT_ONSET_G), 0, 1,
  )

  const approach = (current: number, target: number, tau: number) =>
    current + (target - current) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 1)

  blackout = approach(blackout, overG, overG > blackout ? ONSET_TIME : RECOVERY_TIME)
  redout = approach(redout, underG, underG > redout ? ONSET_TIME : RECOVERY_TIME)
  return { blackout, redout }
}

/**
 * 黑視與紅視。以時間常數累積，避免瞬間大 G 造成畫面突然全黑。
 * 這也是「持續大 G 有代價」的視覺傳達——與能量流失互相呼應。
 */
export function drawGEffect(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
  dt: number,
): void {
  advanceGEffect(f.loadFactor, dt)

  if (blackout > 0.01) {
    // 周邊漸暗：由邊緣向中心收攏的徑向遮罩
    const inner = Math.max(L.width, L.height) * (0.55 - 0.5 * blackout)
    const outer = Math.max(L.width, L.height) * 0.78
    const grad = ctx.createRadialGradient(L.cx, L.cy, Math.max(inner, 0), L.cx, L.cy, outer)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${(0.55 + 0.45 * blackout).toFixed(3)})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, L.width, L.height)
    if (blackout > 0.97) {
      ctx.fillStyle = 'rgba(0,0,0,0.96)'
      ctx.fillRect(0, 0, L.width, L.height)
    }
  }

  if (redout > 0.01) {
    ctx.fillStyle = `rgba(150, 18, 12, ${(0.45 * redout).toFixed(3)})`
    ctx.fillRect(0, 0, L.width, L.height)
  }
}
