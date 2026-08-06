import { Vector3 } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import { cornerSpeed, maxLoadFactorAero, stallSpeed } from '../analysis/envelope'
import { PILOT_G_POSITIVE } from '../control/limiters'
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)
const S = makeScratch(4)

/**
 * 航跡角的變化率 γ̇，rad/s。正值 = 航跡正在上揚。
 *
 * ```
 * γ̇ = g·(n·(L̂·ĉ) − cos γ) / V
 * ```
 *
 * `L̂` 是機體升力方向、`ĉ` 是**垂直平面內、垂直於速度、朝上**的單位向量。
 * 無側滑的座標轉彎裡 `L̂·ĉ` 就是坡度餘弦 `cos φ`，但寫成內積之後倒飛與
 * 大側滑也正確。`−cos γ` 是重力在同一個方向上的分量。
 *
 * 【為什麼是無狀態的】它由**當下**的升力方向、過載與速度算得出來，不需要
 * 上一步的 γ。`applySafety` 因此維持純函數（spec §4.3 的分層前提）。
 *
 * 【退化情形回 0】速度為零、或垂直俯衝／爬升（`ĉ` 沒有唯一解）時回 0 ——
 * 這兩種情形下「航跡角還會不會變陡」本來就沒有定義，回 0 等於「不預測」，
 * 讓 `applySafety` 退回原本的瞬時判斷。
 *
 * 熱路徑（240 Hz × 40 架），不配置。
 */
export function flightPathRate(self: Aircraft): number {
  const vel = self.state.velocity
  const tas = vel.length()
  if (tas < 1e-3) return 0
  const vhat = S.v[2]!.copy(vel).divideScalar(tas)

  // ĉ：把世界正上方扣掉沿速度的分量。模長恰好是 cos γ
  const c = S.v[3]!.copy(UP).addScaledVector(vhat, -UP.dot(vhat))
  const cosGamma = c.length()
  if (cosGamma < 1e-3) return 0
  c.divideScalar(cosGamma)

  const lift = S.v[1]!.copy(UP).applyQuaternion(self.state.orientation)
  return (G0 * (self.diag.loadFactor * lift.dot(c) - cosGamma)) / tas
}

/**
 * 由俯衝角 γ 拉回水平所需的高度，m。
 *
 * 拉起半徑 `R = V² / (g·√(n²−1))`，弧線由 γ 回到 0 掉的高度是
 * `R·(1 − cos|γ|)`。
 *
 * 【為什麼用閉式解而不是迭代預測】spec §9.2 原本寫「預測 1–3 秒航跡 →
 * 不夠就提高脫離偏置 → 重新預測」。但迭代版每次都在找的正是這個閉式量。
 * 閉式解**更精確**（不受預測步長影響）、**更便宜**（240 Hz 跑得起）、
 * 而且**可單獨測試**：給定速度與俯衝角，所需高度是一個確定的數字。
 *
 * 【nMax ≤ 1 回傳 Infinity 而不是大數】它會流進「離海高度夠不夠」的比較。
 * 用大數的話，在極高空仍可能通過比較而不介入；Infinity 保證任何有限高度
 * 都會觸發。
 */
export function recoveryAltitude(tas: number, gamma: number, nMax: number): number {
  if (gamma >= 0) return 0
  if (!(nMax > 1)) return Infinity
  const radius = (tas * tas) / (G0 * Math.sqrt(nMax * nMax - 1))
  return radius * (1 - Math.cos(Math.abs(gamma)))
}

export interface SafetyConfig {
  /** 所需脫離高度的安全倍率 */
  factor: number
  /** 額外的固定餘裕，m。水平飛行時它就是最低容許高度 */
  clearance: number
  /** 硬接管時的爬升角，rad */
  recoveryPitch: number
  /**
   * 失速硬介入的速度裕度門檻（TAS ÷ 1G 失速速度）。
   *
   * **必須低於 `DEFAULT_STEER.speedRecoverMargin`** —— 瞄準點層是技巧、
   * 這一層是硬限制，硬限制只在技巧失效時才動（spec §4.4）。
   */
  stallMargin: number
  /** 失速介入時的壓頭角度，rad。正值，實際命令的是它的負值 */
  stallRecoveryPitch: number
  /**
   * 航跡角的前瞻時間，s。用 `flightPathRate` 把 γ 往前推這麼久再算所需高度。
   *
   * 【為什麼需要它 —— `factor` 蓋不住這件事】閉式解假設 γ 不再變陡，而 AI
   * 在檢查通過之後還在繼續加深俯衝。實測軌跡：
   *
   * ```
   *   t     高度  TAS    γ    介入   needed
   * 113.00   367  128  −40°    否     279 m   ← 367 > 279，通過
   * 113.50   320  130  −54°    否     392 m   ← 這一刻已經追不上
   * 113.75   292  131  −60°    是     459 m   ← 觸發時缺 167 m
   * 117.22     0                              觸海
   * ```
   *
   * `factor` 補的是「建立過載要時間」，是一個固定比例；這裡補的是「俯衝角
   * 還會變陡」，隨 γ̇ 變化。用 factor 去蓋 γ̇ 的話，平飛時過度保守、急劇
   * 加深時仍然不夠。
   *
   * ## 0.25 s 是被兩組掃描從上下夾出來的
   *
   * **下界 —— 低空受控場景（五場、120 秒、子彈無傷害，全場最低高度／觸海）**
   *
   * ```
   * lookahead   延遲0      0.3       0.5       0.8      觸海合計
   * 0（修補前）   115        63     −0 觸海     275       644 步
   * 0.25          54        74        46       275         0
   * 0.50          16        91        99       275         0
   * 0.75         121       118        88       275         0
   * 1.00         106       115       120       275         0
   * 1.50         114       118       114       275         0
   * ```
   *
   * **只要有前瞻，觸海就消失了** —— 這就是這一項要修的東西。最低高度那幾欄
   * 是混沌的（同一場在六個 lookahead 下是 115/54/16/121/106/114，沒有趨勢），
   * 不作為判準。
   *
   * **上界 —— 六場機動測試（`ai-manoeuvre.test.ts` 的五個門檻）**
   *
   * 只有側舷@1000 有反應，其餘五場逐值不變：
   *
   * ```
   * lookahead   longestExtend（門檻 55 s）   offNose（門檻 85%）
   * 0                    23.8                     47.7%
   * 0.25                 34.3                     54.9%
   * 0.50                 42.0                     60.0%
   * 0.75                285.1  ✗                  96.3%  ✗
   * 1.00                118.2  ✗                  81.3%
   * 1.50                285.2  ✗                  96.3%  ✗
   * ```
   *
   * 0.75 以上會**炸開**：300 秒的仗裡有 285 秒是一段連續的 extend，機首 96%
   * 的時間偏離目標超過 90° —— AI 跑掉之後再也沒回來。安全層在 1000 m 提前
   * 介入，把飛機推進一個 `extendFloorLatch` 解不開的狀態。
   *
   * 可用區間是 0.25~0.50，兩者都通過全部門檻。取小的：離那道懸崖遠一點，
   * 而且低空最低高度也比較好（46 對 16 m）。
   */
  lookahead: number
}

/**
 * `factor`、`clearance`、`recoveryPitch` 仍是 M4 的起始值。
 * `stallMargin`、`stallRecoveryPitch` 是 2026-08-05 加的失速硬介入，
 * 見各欄位註解。
 *
 * `factor` 取 1.5 是因為閉式解假設立刻拉到 nMax，而實際上指揮儀要花時間
 * 滾平與建立過載。`clearance` 取 120 m 是「就算完全水平也不准比這更低」。
 */
export const DEFAULT_SAFETY: SafetyConfig = {
  factor: 1.5,
  clearance: 120,
  recoveryPitch: 20 * (Math.PI / 180),
  // 【必須低於瞄準點層的 speedRecoverMargin（1.25）】瞄準點層是技巧、這一層
  // 是硬限制，硬限制只在技巧失效時才動。有一條單元測試把這個關係釘住。
  // 實測六場開局的 safetyShare 最差 1.83%（修補前 6.74%）—— 這一層很少動，
  // 正是它該有的樣子
  stallMargin: 1.1,
  // 【硬限制比上層積極】25° 對 20°。**這一個沒有單獨掃過** —— 它只在瞄準點層
  // 已經失職之後才生效，而實測那佔不到 2% 的時間，掃它得不到訊號
  stallRecoveryPitch: 25 * (Math.PI / 180),
  // 【0.25 s 是兩組掃描夾出來的，見 `lookahead` 欄位的註解】上界由六場機動
  // 測試給（≥ 0.75 時側舷@1000 會炸開），下界由「不觸海」給（0 會觸海）。
  lookahead: 0.25,
}

/**
 * 速度向量的水平方向（單位向量）。垂直俯衝／爬升時水平分量退化，改用
 * 機首的水平投影；兩者都退化就回傳 −Z。
 *
 * 【為什麼要保持航向】指揮儀是 bank-to-turn：大坡度時命令「世界正上方」
 * 會要求飛機先滾平再拉，而滾平的過程中高度還在掉。保持當前航向、只改
 * 仰角，指揮儀就能同時滾平與拉起。
 */
function horizontalHeading(self: Aircraft, out: Vector3): void {
  const vel = self.state.velocity
  out.set(vel.x, 0, vel.z)
  const len = out.length()
  if (len > 1e-3) {
    out.divideScalar(len)
    return
  }
  const nose = S.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.set(nose.x, 0, nose.z)
  const noseLen = out.length()
  if (noseLen > 1e-3) out.divideScalar(noseLen)
  else out.set(0, 0, -1)
}

/**
 * 安全層。**可覆寫整個 `Command`**，回傳是否介入。
 *
 * 【為什麼是濾網而不是規則表的第一條】它要能改寫 `aimWorld` **本身**
 * （而不只是換一個意圖），而且新增規則的人不可能繞過它。它同時覆寫
 * `throttle`、`brake` 與 `firing` —— 快撞海時不該還在開火。這也是本計畫
 * 不另外加 `recover` 意圖的理由：覆寫整個 Command 已經涵蓋它的效果，
 * 少一組要維護的優先序關係。
 *
 * @param seaHeight 該點的海面（未來為地表）高度，m
 */
export function applySafety(
  self: Aircraft,
  seaHeight: number,
  out: Command,
  cfg: SafetyConfig = DEFAULT_SAFETY,
): boolean {
  const vel = self.state.velocity
  const tas = vel.length()
  const gamma = tas > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / tas))) : 0

  const nMax = Math.min(
    maxLoadFactorAero(self.spec, self.state.position.y, tas),
    PILOT_G_POSITIVE,
  )
  // 【前瞻只在已經下降時生效】它要補的是「**我正在俯衝，而且還在加深**」。
  // 平飛或爬升時套用會製造出一個不存在的俯衝 —— 而且低速時 `nMax ≤ 1`，
  // `recoveryAltitude` 回 Infinity，撞地分支會在任何高度永久接管。實測 4000 m、
  // TAS 30 的平飛就是這樣被吃掉的（那本來該由下面的失速硬接管處理）。
  //
  // 【取較悲觀的那個】只在航跡**變陡**時提前介入；變緩時不會反而延後。
  // 夾在 −90° 是因為閉式解只在 |γ| ≤ 90° 有意義。
  const predicted = gamma < 0
    ? Math.max(-Math.PI / 2, gamma + flightPathRate(self) * cfg.lookahead)
    : gamma
  const worst = Math.min(gamma, predicted)
  const needed = recoveryAltitude(tas, worst, nMax) * cfg.factor + cfg.clearance
  const margin = self.state.position.y - seaHeight

  // ── 撞地硬接管 ──────────────────────────────────────────
  if (margin <= needed) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)
    out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.recoveryPitch))
    out.aimWorld.y = Math.sin(cfg.recoveryPitch)
    out.aimWorld.normalize()

    // 【油門不是固定滿檔】拉起半徑 ∝ V²，高速時減速才拉得起來；但低速時
    // 收油門會失速。判準用角落速度：高於它代表速度多到轉不動。
    if (tas > cornerSpeed(self.spec, self.state.position.y)) {
      out.throttle = THROTTLE_FLOOR
      out.brake = 1
    } else {
      out.throttle = WEP_THROTTLE
      out.brake = 0
    }

    out.firing = false
    return true
  }

  // ── 失速硬接管（撞地之後才判，spec §4.5）─────────────────
  // 【為什麼排在撞地之後】兩者的補救相反：失速要壓頭、撞地要拉起。撞地
  // 優先，因為失速還有機會改出，撞地沒有。
  const vs = Math.max(stallSpeed(self.spec, self.state.position.y, 1), 1)
  if (tas / vs < cfg.stallMargin) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)
    out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.stallRecoveryPitch))
    out.aimWorld.y = -Math.sin(cfg.stallRecoveryPitch)
    out.aimWorld.normalize()
    // 換速度要推力，而且低速時沒有減速的道理
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    return true
  }

  return false
}
