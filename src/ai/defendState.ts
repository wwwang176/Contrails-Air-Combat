import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import type { Aircraft } from '../aircraft/Aircraft'
import { DEFAULT_STEER, EXTEND_SIDE_HOLD, type SteerConfig } from './steerConfig'
import { headingErrorTo } from './engageGeometry'

export type DefendConfig = Pick<SteerConfig, 'reversalRange' | 'reversalAspect' | 'reversalHold'>

const UP = new Vector3(0, 1, 0)
const D = makeScratch(3)

/**
 * 每個物理步更新 `extend` 的轉向側。與 `stepDefend` 同一個位階、同一個
 * 理由 —— 跨格狀態必須由持有它的那一層決定。
 *
 * 【為什麼不是純閂鎖】純閂鎖（進入時決定一次、整段不變）在換目標之後會
 * 讓 AI 往錯的一側繞遠路，而實測 23~33% 的脫離段落中途換過目標
 * （`energy-window.probe.ts`）。改成**只在錨點接近正後方時**沿用上一格 ——
 * 翻轉點被死區蓋住，其餘角度照實跟隨。這與 `FlightDirector` 的
 * `reverseHysteresis` 是同一個手法。
 *
 * @param extending 這一格的意圖是不是 `extend`
 */
export function stepExtendSide(
  state: DefendState,
  self: Aircraft,
  target: Aircraft | null,
  extending: boolean,
): void {
  if (!extending || target === null) {
    state.extendSide = 0
    return
  }
  const dir = D.v[0]!.copy(target.state.position).sub(self.state.position)
  const err = headingErrorTo(self, dir)
  if (state.extendSide !== 0 && Math.abs(err) > Math.PI - EXTEND_SIDE_HOLD) return
  state.extendSide = err >= 0 ? 1 : -1
}

/**
 * 破防這一層自己的跨格狀態。
 *
 * 【為什麼需要狀態】反轉不是一個「此刻
 * 的幾何」而是一個**展開中的動作** —— 它必須跨格記得「我正在做這件事」。
 * 由呼叫端持有、以參數傳入，模組本身仍然沒有可變的全域狀態（spec §4.3）。
 */
export interface DefendState {
  /** 反轉倒數的剩餘秒數。> 0 = 正在反轉 */
  reversal: number
  /**
   * 觸發那一刻的攻擊者。換人時取消 —— 對著別人做到一半的反轉沒有意義，
   * 而且瞄準點會指向一架已經不相干的飛機。
   */
  attacker: Aircraft | null
  /**
   * 破防軸的左右號誌，+1 / −1。**0 = 尚未決定**。
   *
   * 【為什麼要跨格記住】`UP × threatLos` 有 ±兩側，兩側同樣「橫向破防」。
   * 每一格重算必然存在一個切換面，跨過去就是瞄準點瞬間跳 2×75°，飛機每格
   * 抖一下。進入破防時決定一次、整段不變。攻擊者換人或離開破防時歸零，
   * 下次重新決定。
   */
  axisSign: number
  /**
   * `extend` 的轉向側，+1 / −1。**0 = 尚未決定**。
   *
   * 【與 `axisSign` 是同一個病、同一個治法】脫離時錨點（當前目標）**幾乎
   * 總是在正後方** —— 而 `atan2` 的誤差角在正後方由 +179° 跳到 −179°，
   * 每格重算的側別會跟著翻，瞄準點瞬間跳 2 × `extendTurnCap`。進入脫離時
   * 決定一次、整段不變；離開或換目標時歸零。
   *
   * 【為什麼放在 `DefendState` 裡】這個型別實際上是**操縱層的跨拍記憶**，
   * 破防只是第一個用戶。拆成兩個型別要動 `steerCommand` 的簽名，而它有
   * 57 個呼叫點、`createDefendState()` 有 68 個 —— 那個風險換不到等值的
   * 清晰度。名字保留，語意以這段註解為準。
   */
  extendSide: number
}

export function createDefendState(): DefendState {
  return { reversal: 0, attacker: null, axisSign: 0, extendSide: 0 }
}

/**
 * 每個物理步更新破防狀態。目前只有反轉用得到。
 *
 * **判定（三個條件同時成立）**
 *
 *   1. 到攻擊者的距離 < `reversalRange`
 *   2. 我的**速度向量**與「指向他的視線」的夾角 < `reversalAspect`
 *      —— 他已經跑到我的前半球
 *   3. `defending` 為真 —— 只有正在破防的人才談得上反轉
 *
 * 條件 2 是「衝過頭」的真正定義：我硬破防而他跟得住時，視線一直留在後半球；
 * 他過頭了，視線才會掃到前面來。
 *
 * 【已知窗口很小】AI 對 AI 的實測：「衝過頭」只佔 1.6% 的取樣，其中 27%
 * 藍方已經有射擊解，真正「錯過機會」的約佔全場 0.7%。這一項仍然留著 ——
 * 真人玩家衝過頭的頻率遠高於 AI，而它的價值在「難得發生時很精彩」，
 * 不在佔比。不要拿佔比去砍它。
 *
 * @param defending 這一格的意圖是不是 `defend`
 *
 * 熱路徑（240 Hz），不配置。
 */
export function stepDefend(
  state: DefendState,
  self: Aircraft,
  attacker: Aircraft | null,
  defending: boolean,
  dt: number,
  cfg: DefendConfig = DEFAULT_STEER,
): void {
  if (state.reversal > 0) {
    // 換人就取消；否則倒數
    if (attacker !== state.attacker) {
      state.reversal = 0
      state.attacker = attacker
      // 號誌是對**舊**攻擊者的幾何算的，跟著一起丟掉
      state.axisSign = 0
      return
    }
    state.reversal = Math.max(0, state.reversal - dt)
    if (state.reversal === 0) state.attacker = null
    return
  }

  // ── 破防軸的左右號誌（進入時決定一次）──────────────
  // 【為什麼寫在這裡而不是 defendAim 裡】defendAim 是純函數、每格被呼叫，
  // 它沒有「這是不是第一格」的資訊。號誌是跨格狀態，必須由持有狀態的這一層
  // 決定（與 reversal 同一個理由）。
  if (!defending || attacker === null) {
    state.attacker = attacker
    state.axisSign = 0
    return
  }
  if (attacker !== state.attacker) state.axisSign = 0
  state.attacker = attacker
  if (state.axisSign === 0) {
    // 取與當下升力同側 —— 進入破防時轉場最小
    const dir = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
    const dist = dir.length()
    if (dist > 1e-3) {
      dir.divideScalar(dist)
      const h = D.v[2]!.copy(UP).cross(dir)
      if (h.lengthSq() > 1e-12) {
        h.normalize()
        const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)
        state.axisSign = h.dot(lift) >= 0 ? 1 : -1
      } else state.axisSign = 1
    } else state.axisSign = 1
  }

  // 【暫存向量的重複使用】號誌那段用了 D.v[0]/[1]/[2]，算完就不再需要，
  // 下面的反轉偵測會重新 copy。不要把號誌那段挪到反轉偵測中間。
  const los = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
  const range = los.length()
  if (range >= cfg.reversalRange || range < 1e-3) return
  los.divideScalar(range)

  const vel = D.v[1]!.copy(self.state.velocity)
  const speed = vel.length()
  if (speed < 1e-3) return
  vel.divideScalar(speed)
  if (vel.dot(los) < Math.cos(cfg.reversalAspect)) return

  state.reversal = cfg.reversalHold
}
