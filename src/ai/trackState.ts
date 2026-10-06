import { DEFAULT_STEER, type SteerConfig } from './steerConfig'

export type TrackConfig = Pick<SteerConfig, 'trackEnter' | 'trackExit' | 'trackHold' | 'trackLosFloor'>

/**
 * 「追不上預瞄點」的跨格狀態。由 `stepTrack` 每步維護。
 *
 * 【為什麼與 `DefendState` 分開】那一個是破防的狀態（反轉倒數、破防軸、
 * 脫離側別），這一個是追擊幾何的狀態。兩者的生命週期無關。
 */
export interface TrackState {
  /** 閂上 = 正在佈局下一次機會，而不是追瞄 */
  latched: boolean
  /** 已經連續低於 `trackExit` 幾秒。只在閂上時有意義 */
  quiet: number
}

export function createTrackState(): TrackState {
  return { latched: false, quiet: 0 }
}

/**
 * 維護「追不上」的閂鎖。就地修改 `state`。
 *
 * 生命週期（spec §5.2）：
 * ```
 *   未閂 → 閂上：  trackRatio > trackEnter
 *   閂上 → 釋放：  trackRatio < trackExit 連續維持 trackHold 秒
 * ```
 *
 * @param ratio   `Situation.trackRatio`
 * @param losRate `Situation.losRate`，rad/s。低於 `trackLosFloor` 不閂（扳機優先）
 * @param active  有沒有攻擊目標。沒有目標時立刻釋放
 */
export function stepTrack(
  state: TrackState,
  ratio: number,
  losRate: number,
  active: boolean,
  dt: number,
  cfg: TrackConfig = DEFAULT_STEER,
): void {
  // 【消融開關】見 `SteerConfig.trackEnter`
  if (!active || !(cfg.trackEnter > 0) || !Number.isFinite(ratio)) {
    state.latched = false
    state.quiet = 0
    return
  }
  if (!state.latched) {
    // 【扳機優先】見 `SteerConfig.trackLosFloor`
    if (ratio > cfg.trackEnter && losRate > cfg.trackLosFloor) {
      state.latched = true
      state.quiet = 0
    }
    return
  }
  // 【遲滯帶裡不算安靜】要掉到 `trackExit` 以下才開始計時
  if (ratio < cfg.trackExit) {
    state.quiet += dt
    if (state.quiet >= cfg.trackHold) {
      state.latched = false
      state.quiet = 0
    }
  } else {
    state.quiet = 0
  }
}
