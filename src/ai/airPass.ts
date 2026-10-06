import { NO_INTERCEPT } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import type { Aircraft } from '../aircraft/Aircraft'
import type { BandState } from './bandState'
import { DEFAULT_STEER, type SteerConfig } from './steerConfig'

export type AirPassConfig = Pick<SteerConfig,
  'airPassMaxAot' | 'airPassLead' | 'airPassTrackRatio' | 'airPassSpeedRatio' | 'airPassZoom'
>

/**
 * 空戰那一趟通過的跨格狀態：從後方追上、進了射程（上膛）之後有沒有飛過去。
 * `target` 用物件身分防止換目標時沿用上一趟。
 */
export interface AirPassState {
  armed: boolean
  target: Aircraft | null
}

export function createAirPassState(): AirPassState {
  return { armed: false, target: null }
}

export function resetAirPass(state: AirPassState): void {
  state.armed = false
  state.target = null
}

/**
 * 即將飛過頭、或目標急轉到機鼻跟不上，就往上拉：從目標後半球追上、上膛之後，
 * 只要預估 `airPassLead` 秒內撞上（或已經飛過去）、或追蹤比到
 * `airPassTrackRatio`，就把回升的高度設成現在的高度加 `airPassZoom`，交給空層鎖
 * 的回升（`stepBand` 的 regain）拉起來，之後從上方再打。
 *
 * 【跟不上就別跟著平轉】目標急轉時比他快的一方跟著在水平面裡轉，只會把速度
 * 轉光：靶機以 25°/s 急轉的情境裡 AI 跟轉 17 秒，650 → 428 km/h，接著為了補
 * 速度俯衝掉 380 m。往上拉（高 yo-yo）跳出他的轉彎平面，速度換成高度留著。
 *
 * 【為什麼是往上而不是平飛拉開】比目標快的一方追上之後留在原地修正，一對準
 * 就過頭，只能在目標周圍幾百公尺內繞圈。平飛拉開又要比他快很多才拉得開 ——
 * 快三成、每秒也只拉開 36 m，十秒後掉頭仍然是近身纏鬥。往上拉把多出來的速度
 * 直接換成高度，同時離開他的射擊平面。
 *
 * @param range 到目標的距離，m
 * @param closing 接近速度，m/s，正 = 在接近
 * @param interceptTime 預瞄解的飛行時間，s
 * @param aot 我方在目標機尾的夾角，rad（`Situation.angleOffTail`）
 * @param trackRatio 視線角速度 ÷ 自己的瞬時轉彎率（`Situation.trackRatio`）
 * @param allowed 准不准拉起：不是轉彎比對方好很多的一方、沒有在閃避或服從
 *   命令、還沒有要回去的高度。速度夠不夠快（`airPassSpeedRatio`）在這裡面判。
 *   不准時上膛照樣記，只是飛過之後不拉起
 * @returns 這一步有沒有把回升的高度設下去
 *
 * 熱路徑：不配置。
 */
export function stepAirPass(
  state: AirPassState, band: Pick<BandState, 'perch' | 'regainTime' | 'forced'>, self: Aircraft, target: Aircraft,
  range: number, closing: number, interceptTime: number, aot: number, trackRatio: number,
  allowed: boolean, cfg: AirPassConfig = DEFAULT_STEER,
): boolean {
  if (state.target !== target) {
    state.armed = false
    state.target = target
  }
  const reach = interceptTime !== NO_INTERCEPT && interceptTime <= PROJECTILE_LIFETIME
  const wasArmed = state.armed
  // 【迎頭交會不算】迎頭交會之後要平飛迴轉找敵人（空層鎖），從上方俯衝的
  // 那一趟由鎖放開時記下的回升接手
  if (reach && closing > 0 && aot < cfg.airPassMaxAot) state.armed = true
  // 【即將撞上就拉，不等飛過去】還有幾秒撞上 = 距離 ÷ 接近速度。等到飛過去才
  // 拉，那一刻已經在他前面了
  const aboutToPass = closing <= 0 || range < cfg.airPassLead * closing
  if (!wasArmed || (!aboutToPass && !(trackRatio >= cfg.airPassTrackRatio))) return false
  state.armed = false
  if (!allowed) return false
  // 【快一點點不夠】速度差不多時，往哪裡拉都一直待在他前面 —— 實戰裡那就是
  // 送到他槍口下。不夠快就不拉起，照原本的修正
  const fast = self.state.velocity.lengthSq()
    >= cfg.airPassSpeedRatio * cfg.airPassSpeedRatio * target.state.velocity.lengthSq()
  if (!fast) return false
  band.perch = self.state.position.y + cfg.airPassZoom
  band.regainTime = 0
  band.forced = true
  return true
}
