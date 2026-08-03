import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import {
  cornerSpeed, specificExcessPower, stallSpeed, sustainedTurnRate,
} from '../analysis/envelope'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 一個時刻的完整態勢。純資料，由呼叫端持有並重複使用（熱路徑禁止配置）。
 *
 * 【為什麼幾何與能量分成兩個函數填同一個結構】幾何量便宜（幾次點積），
 * 每個物理步都要重算；能量量貴（`sustainedTurnRate` 是 50 次二分搜尋），
 * 只需要 10 Hz。分成兩個函數，呼叫端才能各自用各自的頻率
 * （spec §4.2）。合成一個的話，要嘛全部跑 240 Hz（浪費），要嘛全部跑
 * 10 Hz（瞄準點落後 100 ms，300 m/s 下就是 30 m，打不中）。
 */
export interface Situation {
  /** 兩機重心距離，m */
  range: number
  /** 接近率，m/s。正 = 正在接近 */
  closureRate: number
  /**
   * 還有多久撞在一起，s。**拉開時為 `Infinity`**。
   *
   * 【為什麼不是負數】規則表拿它當門檻。拉開時答案是「永遠不會」，
   * 而 `range / 負的接近率` 會得到負數——負數小於任何正門檻，於是所有
   * 「timeToMerge < X」的規則會全部誤觸發。
   */
  timeToMerge: number
  /** 我的機首與視線的夾角，rad。0 = 他在我正前方 */
  aspectAngle: number
  /** 他的機尾與視線的夾角，rad。0 = 我咬在他正後方 */
  angleOffTail: number
  /** 視線角速度，rad/s。「跟不跟得上」的直接量度 */
  losRate: number

  /** 我的比能量 − 他的，m */
  energyAdvantage: number
  /** 我的比超量功率，m/s */
  psSelf: number
  /** 他的比超量功率，m/s */
  psTarget: number
  /** 我的持續轉彎率 − 他的，rad/s */
  turnAdvantage: number
  /** 我的 TAS ÷ 我的角落速度。> 1 = 快到轉不動 */
  cornerRatio: number
  /** 我的 TAS ÷ 當前過載下的失速速度。趨近 1 = 快失速 */
  stallMargin: number

  /** 他打得到我的瞬時程度，0..1。持續跟蹤的加權在 AiController（見 §偏離 2） */
  threatInstant: number
  /** 我打得到他的瞬時程度，0..1 */
  shotInstant: number
}

export function createSituation(): Situation {
  return {
    range: 0, closureRate: 0, timeToMerge: Infinity,
    aspectAngle: 0, angleOffTail: 0, losRate: 0,
    energyAdvantage: 0, psSelf: 0, psTarget: 0,
    turnAdvantage: 0, cornerRatio: 1, stallMargin: 1,
    threatInstant: 0, shotInstant: 0,
  }
}

/** 視線退化的距離下限，m。低於此值方向沒有意義。 */
const MIN_RANGE = 1e-3

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(5)

/**
 * 幾何量。便宜，每個物理步都該重算（spec §4.2）。
 *
 * 不修改 self 與 target。
 */
export function evaluateGeometry(self: Aircraft, target: Aircraft, out: Situation): void {
  const los = S.v[0]!.copy(target.state.position).sub(self.state.position)
  const range = los.length()
  out.range = range

  // 【重疊時的退化處理】重生的瞬間可能發生。方向取機首，避免 normalize
  // 除以 0 產生 NaN——NaN 一旦進入態勢，規則表的所有比較都變成 false，
  // AI 會靜靜退化成「永遠走預設意圖」而且完全不報錯。
  const losUnit = S.v[1]!
  if (range > MIN_RANGE) losUnit.copy(los).divideScalar(range)
  else losUnit.copy(FWD).applyQuaternion(self.state.orientation)

  // 相對速度：目標 − 我。接近率是它在視線上的投影取負
  const relVel = S.v[2]!.copy(target.state.velocity).sub(self.state.velocity)
  const radial = relVel.dot(losUnit)
  out.closureRate = -radial
  out.timeToMerge = out.closureRate > 0 ? range / out.closureRate : Infinity

  // 視線角速度 = 相對速度的橫向分量 / 距離
  const tangential = S.v[3]!.copy(relVel).addScaledVector(losUnit, -radial)
  out.losRate = range > MIN_RANGE ? tangential.length() / range : 0

  const selfFwd = S.v[4]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.aspectAngle = Math.acos(clampUnit(selfFwd.dot(losUnit)))

  // 【angleOffTail 為什麼是 acos(losUnit · targetFwd)】我在他正後方時，
  // 由我指向他的向量與他的機首同向，點積為 1、夾角為 0。這與「他的機尾
  // 與視線的夾角」是同一個角。
  const targetFwd = S.v[0]!.copy(FWD).applyQuaternion(target.state.orientation)
  out.angleOffTail = Math.acos(clampUnit(targetFwd.dot(losUnit)))
}

/** 夾到 [−1, 1]。浮點誤差會讓點積跑出範圍，acos 於是回傳 NaN。 */
function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x
}

/**
 * 能量量。貴，只需要 10 Hz（spec §4.2）。
 *
 * 【為什麼每一項都用當前高度與速度查，不用機種常數】109 在低速轉得贏
 * P-51、在高速轉不贏——M1 §13.3 量到交叉點落在 280–380 km/h。這正是這個
 * 專案要表達的東西。用機種常數會把它抹平，「能量戰」於是退化成「誰的
 * 參數表比較好」。
 *
 * 不修改 self 與 target。
 */
export function evaluateEnergy(self: Aircraft, target: Aircraft, out: Situation): void {
  out.energyAdvantage = self.specificEnergy - target.specificEnergy

  const selfAlt = self.state.position.y
  const targetAlt = target.state.position.y
  const selfTas = self.diag.aero.tas
  const targetTas = target.diag.aero.tas

  out.psSelf = specificExcessPower(
    self.spec, selfAlt, selfTas, self.diag.loadFactor, self.controls.throttle,
  )
  out.psTarget = specificExcessPower(
    target.spec, targetAlt, targetTas, target.diag.loadFactor, target.controls.throttle,
  )

  out.turnAdvantage = sustainedTurnRate(self.spec, selfAlt, selfTas)
    - sustainedTurnRate(target.spec, targetAlt, targetTas)

  // 角落速度恆為正，不必防除以 0
  out.cornerRatio = selfTas / cornerSpeed(self.spec, selfAlt)

  // 【失速速度可能極小或為 0】極高空、極低過載時 stallSpeed 會趨近 0。
  // 除以 0 會得到 Infinity，而 Infinity 通過所有「stallMargin > X」的檢查
  // ——那是「安全」的方向，但它會讓吊機首閘門永遠不觸發。夾一個下限。
  const vs = Math.max(stallSpeed(self.spec, selfAlt, Math.abs(self.diag.loadFactor)), 1)
  out.stallMargin = selfTas / vs
}
