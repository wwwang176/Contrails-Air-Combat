import { clamp } from '../core/math'
import { WEP_THROTTLE } from '../physics/propulsion'

/** 油門每秒變化量（W/S 持續按住時）。 */
export const THROTTLE_RATE = 0.6

/**
 * 套用油門的持續變化：W（up）以 THROTTLE_RATE/s 增加、S（down）以同速率
 * 減少，夾制在 [0, WEP_THROTTLE]。
 *
 * 上限直接取自推進模組既有的 WEP_THROTTLE（=1.1，見
 * src/physics/propulsion.ts），而不是在此重複寫死 1.1——避免「油門刻度
 * 上限」與「WEP 對應的節流值」這同一個量在兩處各自維護、日後漂移不一致。
 * 這也是輸入層對物理層唯一的依賴：物理層對輸入層沒有反向依賴，不構成循環。
 */
export function applyThrottleRate(
  throttle: number,
  up: boolean,
  down: boolean,
  dt: number,
): number {
  let t = throttle
  if (up) t += THROTTLE_RATE * dt
  if (down) t -= THROTTLE_RATE * dt
  return clamp(t, 0, WEP_THROTTLE)
}
