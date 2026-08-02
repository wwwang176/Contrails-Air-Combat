import { clamp } from '../../core/math'
import { PILOT_G_NEGATIVE } from '../../control/limiters'
import type { HudFrame, HudLayout } from '../types'

/**
 * 黑視的起點與全黑點，spec §6.6。
 *
 * 【為什麼不沿用 PILOT_G_POSITIVE】那個常數是 6.5，而它同時是指揮儀俯仰
 * 限制器的過載上限（control/limiters.ts）——拿它當起點，overG 就永遠算出
 * 0，整個黑視系統是死的。spec 寫的是 6 與 8，照 spec 走：限制器夾住的
 * 6.5 G 持續轉彎會落在 25% 強度，看得到但還能打，正是要的效果。
 */
const BLACKOUT_ONSET_G = 6
const BLACKOUT_FULL_G = 8
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
