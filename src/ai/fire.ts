import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { NO_INTERCEPT } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Situation } from './assess'
import type { EngageBasis } from './steer'

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(2)

export interface FireConfig {
  /** 機首與預瞄方向的最大夾角，rad */
  trackingCone: number
  /** 最近開火距離，m。更近就不開火，避免撞上去 */
  minRange: number
  /** 視線角速度上限，rad/s */
  maxLosRate: number
}

/**
 * **全部都是起始值，待 Task 14 由對戰矩陣量測後回填。**
 *
 * `trackingCone` 起始值 3° 的依據是 M2 的匯聚幾何：六挺翼槍在 300 m 處
 * 收斂到 1 cm 以內，而機身命中盒的半寬是 0.45 m —— 300 m 外 0.45 m 對應
 * 的張角約 0.086°，取 3° 是留給提前量誤差與目標機動的餘裕。
 */
export const DEFAULT_FIRE: FireConfig = {
  trackingCone: 3 * (Math.PI / 180),
  minRange: 60,
  maxLosRate: 0.35,
}

/**
 * 開火紀律。四個條件**全部**成立才扣扳機。
 *
 * 【`canShoot` 不等於 `firing`】前者是「幾何上打得到」，後者是「現在該不該
 * 扣扳機」。無限彈藥所以不必省彈，但濫射有兩個實際壞處：AI 看起來很笨，
 * 而且曳光彈會蓋滿畫面讓玩家看不到自己在打哪（spec §8）。
 */
export function shouldFire(
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  cfg: FireConfig = DEFAULT_FIRE,
): boolean {
  // 一：有攔截解，且彈丸活得夠久飛到攔截點。
  // 【與玩家的預瞄環是同一個條件】M2 spec §5.1.1：回收條件與顯示條件用
  // 同一個數字。AI 用同一條規則，才不會出現「AI 打得到但玩家看不到環」。
  if (basis.interceptTime === NO_INTERCEPT) return false
  if (basis.interceptTime > PROJECTILE_LIFETIME) return false

  // 二：不要太近。撞上去比打不到嚴重。
  if (sit.range < cfg.minRange) return false

  // 三：視線角速度。劇烈掃過時命中機率極低，開了也是浪費畫面。
  if (sit.losRate > cfg.maxLosRate) return false

  // 四：機首真的對著預瞄方向。這是最後一關，也是最貴的一個（normalize）。
  const lead = S.v[0]!.copy(basis.leadPoint)
  const len = lead.length()
  if (len < 1e-6) return false
  lead.divideScalar(len)

  // 用第二格 scratch 而不是 FWD.clone()——這是每個物理步都跑的路徑
  const nose = S.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
  return nose.angleTo(lead) <= cfg.trackingCone
}
