import { clamp } from '../core/math'
import { WEP_THROTTLE } from '../physics/propulsion'

/** 油門每秒變化量。推、收、以及放手回中都用同一個速率。 */
export const THROTTLE_RATE = 0.6

/**
 * 放開按鍵時油門回歸的巡航設定。
 *
 * 【與 InputState.CRUISE_THROTTLE 是同一個數字，為何不 import】輸入層的
 * 常數檔 InputState.ts 反過來會用到本檔的函式，互 import 會構成循環。
 * 兩處都是 0.7，由 test/unit/throttle.test.ts 的一條斷言守著不漂移。
 */
export const CRUISE_THROTTLE = 0.7

/** 按住 S 時油門的下限。 */
export const THROTTLE_FLOOR = 0.2

/**
 * 套用油門的持續變化。**彈簧回中**（M4 spec §2.1）：
 *
 *   按住 W      以 THROTTLE_RATE/s 升向 WEP_THROTTLE
 *   按住 S      以 THROTTLE_RATE/s 降向 THROTTLE_FLOOR
 *   兩者皆放開  以 THROTTLE_RATE/s 回到 CRUISE_THROTTLE
 *
 * 【為什麼下限是 0.2 而不是 0】活塞引擎不可能零功率仍運轉；而且本模型沒有
 * 螺旋槳風車阻力，throttle = 0 等於「零推力又零阻力」，滑翔性能會優於真機。
 *
 * 【為什麼回中速率與推收同速】行為可預測 —— 玩家放手後回到巡航所需的
 * 時間，等於他剛才推上去所花的時間。
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
  const step = THROTTLE_RATE * dt

  // 同時按住 W 與 S 視同都沒按：兩個相反的意圖，回中是唯一不偏袒的解讀
  if (up !== down) {
    const target = up ? WEP_THROTTLE : THROTTLE_FLOOR
    const t = up ? throttle + step : throttle - step
    return up ? Math.min(t, target) : Math.max(t, target)
  }

  // 放手回中。用 min/max 夾住目標，避免在高更新率下於巡航值附近來回跳動
  if (throttle > CRUISE_THROTTLE) return Math.max(CRUISE_THROTTLE, throttle - step)
  if (throttle < CRUISE_THROTTLE) return Math.min(CRUISE_THROTTLE, throttle + step)
  return clamp(throttle, THROTTLE_FLOOR, WEP_THROTTLE)
}
