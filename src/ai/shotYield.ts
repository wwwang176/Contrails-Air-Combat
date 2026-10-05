import { NO_INTERCEPT } from '../world/lead'
import { DEFAULT_STEER, type SteerConfig } from './steerConfig'

export type ShotYieldConfig = Pick<SteerConfig, 'sweetYieldTime'>

/**
 * 甜蜜區偏置的讓位係數，0..1。1 = 照原樣偏、0 = 完全不偏。
 *
 * 【與 `unloadPull` / `energyPull` 同一族】三者都回傳係數、都由呼叫端乘上去、
 * 都不動方位。差別只在防的物理：
 *
 *   unloadPull   看 stallMargin    —— 防**失速**（迎角太大）
 *   energyPull   看 cornerRatio    —— 防**能量見底**（速度太低）
 *   sweetYield   看 interceptTime  —— 防**打法偏好擋住扳機**
 *
 * 【`NO_INTERCEPT` 回傳 1 而不是 0】沒有攔截解 = 沒有射擊機會 = 沒有東西要讓。
 * 回傳 0 會把「彈道無解」變成「連打法都不准表態」，方向剛好相反。
 *
 * 【`sweetYieldTime <= 0` 回傳 1】與 `energyPull` 的退化處理同一個理由：設定
 * 寫壞時讓本層失效、退回既有行為，比讓它把 AI 鎖死安全。這也是消融的開關。
 *
 * @param interceptTime `EngageBasis.interceptTime`，s。`NO_INTERCEPT` 表示無解
 */
export function sweetYield(interceptTime: number, cfg: ShotYieldConfig = DEFAULT_STEER): number {
  // 【非有限值一律不讓位】`NaN` 會穿過下面每一個比較（與任何數比都是 false）
  // 然後從最後一行帶著 `NaN / span` 出去，乘進偏置、汙染整個 `aimWorld`。
  // 回傳 1 = 本層失效、退回既有行為，與 `sweetYieldTime <= 0` 同一個方向。
  if (!Number.isFinite(interceptTime)) return 1
  if (interceptTime === NO_INTERCEPT) return 1
  const span = cfg.sweetYieldTime
  // `span` 同樣要求有限：`Infinity` 會讓 `t / span` 恆為 0，變成「永遠完全
  // 讓位」—— 那是設定寫壞時最不該發生的方向。
  if (!Number.isFinite(span) || span <= 0) return 1
  // 【斜坡整段在開火範圍之外】`interceptTime <= span` 就是「打得到」——
  // 那一段必須完全讓位，見 `SteerConfig.sweetYieldTime`。淡出發生在
  // `span`..`2 × span`，玩家在畫面上看不到那一段（預瞄環還沒出現）。
  if (interceptTime >= 2 * span) return 1
  if (interceptTime <= span) return 0
  return interceptTime / span - 1
}
