import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import type { Aircraft } from '../aircraft/Aircraft'

export interface TargetConfig {
  /** 「我在他尾後」的權重 */
  opportunityWeight: number
  /** 「他機首指著我」的權重 */
  threatWeight: number
  /** 距離折扣的特徵長度，m。分數在此距離減半 */
  rangeScale: number
  /** 分攤折扣係數。1/crowdPenalty 是「分數折半所需的隊友鎖定數」 */
  crowdPenalty: number
  /** 新目標要好過現任的比例才換 */
  switchMargin: number
  /** 換過之後不再換的秒數 */
  minDwell: number
}

/**
 * **全部都是起始值，待門檻回填任務由 20v20 的實測定案**（M5 spec §13）。
 *
 * 與 M2 的命中盒座標、M4 的規則門檻同一個做法：先跑再定，不接受
 * 「配一個看起來合理的數字」。
 *
 * `rangeScale` 的起始值 400 m 有依據：M2 的匯聚點在 300 m，1944 年的實戰
 * 有效射程也在 400 m 以內 —— 「打得到的距離」就是這個量級。
 */
export const DEFAULT_TARGET: TargetConfig = {
  opportunityWeight: 1,
  threatWeight: 1,
  rangeScale: 400,
  crowdPenalty: 1,
  switchMargin: 0.25,
  minDwell: 2,
}

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(3)
/** 視線退化的距離下限，m。與 assess.ts 用同一個量級 */
const MIN_RANGE = 1e-3

/**
 * 一個候選目標的分數。**恆非負**（M5 spec §6.2）。
 *
 * 令 `b = 敵機首 · 由我指向他的單位向量`：
 *
 *   機會 = max(0, b)    —— 1 = 我正咬著他
 *   威脅 = max(0, −b)   —— 1 = 他機首正對著我
 *
 * 【為什麼取正部而不是 0.5(1 ± b)】後者相加恆等於 1，代進評分只剩
 * `0.5(ow+tw) + 0.5(ow−tw)·b` —— 兩個權重退化成一個自由度，而且是 b 的
 * 線性函數。但要的是「我咬住他」與「他咬住我」**兩端都加分**、側面不加分，
 * 那是 V 形不是直線。
 *
 * 【為什麼三個因子全是折扣形式】分攤原本設計成減法，分數會變負；而換目標
 * 門檻是乘法的（`> 現任 × (1 + margin)`），現任為負時乘 1.25 會**更負**，
 * 門檻反而變低 —— 遲滯在最需要它的時候失效。統一成 `1/(1 + k·x)` 之後
 * score 恆 ≥ 0，乘法門檻在整個定義域上單調。
 *
 * 熱路徑：不配置。不修改 self 與 enemy。
 */
export function targetScore(
  self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig,
): number {
  const los = S.v[0]!.copy(enemy.state.position).sub(self.state.position)
  const range = los.length()

  // 【重疊時的退化處理】重生的瞬間可能發生。方向取機首，避免 normalize
  // 除以 0 產生 NaN —— NaN 一旦進入分數，所有比較都變成 false，選擇會靜靜
  // 退化成「永遠選第一架」而且完全不報錯（與 assess.ts 同一個防護）。
  const losUnit = S.v[1]!
  if (range > MIN_RANGE) losUnit.copy(los).divideScalar(range)
  else losUnit.copy(FWD).applyQuaternion(self.state.orientation)

  const enemyFwd = S.v[2]!.copy(FWD).applyQuaternion(enemy.state.orientation)
  let b = enemyFwd.dot(losUnit)
  // 浮點誤差會讓點積跑出 [−1, 1]
  if (b < -1) b = -1
  else if (b > 1) b = 1

  const opportunity = b > 0 ? b : 0
  const threat = b < 0 ? -b : 0

  const geometry = cfg.opportunityWeight * opportunity + cfg.threatWeight * threat
  const rangeDiscount = 1 / (1 + range / cfg.rangeScale)
  const crowdDiscount = 1 / (1 + cfg.crowdPenalty * locks)
  return geometry * rangeDiscount * crowdDiscount
}
