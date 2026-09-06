import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { NO_INTERCEPT } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Situation } from './assess'
import type { EngageBasis } from './steer'
import { losBlocked, type LandField } from '../world/occlusion'

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
 * AI 戰鬥機扳機的點放節奏。
 *
 * 【為什麼是可注入的設定物件而不是兩個模組常數】與 `FireConfig`、
 * `TargetConfig`、`WingmanConfig` 同一個理由：**掃描與消融**。`off: 0`
 * 就是「完全沒有這一層」，探針因此量得出這一層的代價（見
 * `test/tools/targeting-burst.probe.ts`），而不必改原始碼重跑。
 */
export interface BurstConfig {
  /** 開火段秒數 */
  on: number
  /** 停火段秒數。**0 = 關掉點放**（一路按著扳機，也就是這一層上線前的行為） */
  off: number
}

/**
 * AI 戰鬥機點放的起始值。**由試飛裁定。**
 *
 * ── 為什麼有這一層 ────────────────────────────────────
 *
 * AI 的戰鬥機要跟轟炸機的機槍一樣有冷卻時間，只是頻率高一點。沒有它時
 * AI 只受 `shouldFire` 的四條幾何條件節制 —— 只要解成立就**一路按著
 * 扳機**，而砲塔本來就有點放（`weapons/burst.ts`）。畫面上的差別是一條
 * 不斷的曳光線 vs 一串。
 *
 * ── 「頻率高一點」高多少 ────────────────────────────────
 *
 * ```
 *          開火   停火   週期     工作週期
 *   砲塔    1.2   0.80  2.00 s     60%
 *   戰鬥機  0.9   0.15  1.05 s     86%
 * ```
 *
 * 週期是砲塔的一半出頭（頻率 1.9 倍），符合「頻率可以高一點」。
 *
 * ── 工作週期為什麼是 86% 而不是 75% ──────────────────────
 *
 * **這個值是量出來的，不是挑的。** 20v20、150 秒、種子 20260805，
 * `test/tools/targeting-burst.probe.ts`：
 *
 * ```
 *   工作週期   持有中位   後半球    扣扳機    機首在錐內   存活(藍/紅)
 *   100%(關)    1.70 s    33.5%    3.51%      18.6%       15/19
 *    86%        1.50 s    34.0%    2.70%      16.3%       17/20
 *    75%        1.50 s    36.6%    2.38%      16.6%       19/19
 *    60%        1.80 s    35.1%    2.36%      18.4%       17/20
 *   門檻       ≥ 1.5 s   ≤ 35%    ≥ 2.5%     ≥ 12%
 * ```
 *
 * 【`fireShare` 是機械後果，不是行為退步】它的定義是「扣扳機時間 ÷ 存活
 * 時間」，而點放**直接**把分子乘上工作週期。75% 那一列的 2.38% 已經破了
 * `ai-targeting` 的 2.5%，而那條門檻的前提正是「只要幾何成立就一路按著
 * 扳機」—— 86% 是唯一還留在門檻內的檔位。
 *
 * 【`rearShare` 在 33.5 … 36.6 之間亂跳，不是這個參數的單調函數】那是混沌
 * 雜訊。它在點放**關掉**時就已經是 33.5%（門檻 35%），餘裕只有 1.5 個
 * 百分點。
 *
 * 【要更慢的節奏就要重新定值兩條門檻】0.3 s 的停頓在畫面上更明顯，但
 * `rearShare` 與 `fireShare` 都會紅 —— 那是負責人的決定，不是這裡可以
 * 自己放寬的東西。
 *
 * 【玩家不受影響】玩家扣扳機走 `World.fire`，完全不經過 `AiController`。
 * 代飛（AI 接手玩家那一架）時會受影響 —— 那時開火的就是 AI，而代飛結束
 * 就自動不再冷卻：`main.ts` 換的是 `player.controller` 這個參考，所以那是
 * 換控制器的結果，不是一段要維護的程式碼。
 */
export const DEFAULT_AI_BURST: BurstConfig = { on: 0.9, off: 0.15 }

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
  land: LandField | null = null,
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
  if (nose.angleTo(lead) > cfg.trackingCone) return false

  // 五：中間沒有山。
  //
  // 【排在最後】前四個是幾個乘法與一次 acos，這一個要沿線段查高度場。
  //
  // 【查的是預瞄射線，不是目標現在的位置】子彈飛的是那條線。橫向相對
  // 速度 200 m/s、攔截時間 1 秒就是 200 m 的差 —— 足以讓「目標看得見但
  // 預瞄射線撞山」與「目標被擋但預瞄射線繞過去」兩種都發生。
  if (land === null) return true
  const p = self.state.position
  const q = basis.leadPoint
  return !losBlocked(p.x, p.y, p.z, p.x + q.x, p.y + q.y, p.z + q.z, land)
}
