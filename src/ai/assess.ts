import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import {
  bestSustainedTurnRateCached, bestSustainedTurnSpeedCached, cornerSpeed,
  specificExcessPower, stallSpeed, sustainedTurnRate,
} from '../analysis/envelope'
import { G0 } from '../core/math'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'

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
  /**
   * 我的持續轉彎率 − 他的，**各自在當前速度下**，rad/s。
   *
   * 【它是瞬時事實，不是機體比較】慢的飛機轉得比較快，所以這個量被**速度差
   * 主導**。它回答的是「此刻誰轉得贏」，適合短期戰術判斷。
   *
   * **不要拿它做投入／退出的決定** —— 用 `airframeTurnAdvantage`。理由見該欄位。
   */
  turnAdvantage: number
  /**
   * 我的**最佳**持續轉彎率 − 他的，各自在自己的高度，rad/s。機體層級的比較。
   *
   * 【為什麼投入與退出的決定要用這一個】迴旋戰一旦開打，兩台都會在幾秒內
   * 各自收斂到自己的最佳持續轉彎速度 —— 當下的速度差會被抹平。所以決定這場
   * 仗誰贏的是機體，不是誰此刻比較慢。
   *
   * 人工驗收實測過反例：AI 咬在敵機後方 236 m、正在開火時，因為敵機拉桿掉到
   * 356 km/h（自己還有 452），`turnAdvantage` 讀出 −1.7°/s 而放棄射擊解逃走。
   * 但兩台的機體差距只有 −0.3°/s。敵機掉速正是它快撐不住的訊號，卻被讀成
   * 「他比我強」。
   */
  airframeTurnAdvantage: number
  /**
   * 我的比能量 − **還打得動的最低比能量**，m。負值 = 已經見底。
   *
   * 【為什麼需要一個絕對量】`energyAdvantage` 是相對的：兩台一起把能量磨光時
   * 它一直接近 0，所以沒有任何機制看得見「大家都快沒能量了」。實測共速共高
   * 開局，兩台由比能量 5,841 m 磨到 **679 m**、高度掉到 **309 m**，全程沒有
   * 一方決定抽身。
   *
   * 底線的定義見 `ENERGY_FLOOR_ALTITUDE`。
   */
  energyReserve: number
  /** 我的 TAS ÷ 我的角落速度。> 1 = 快到轉不動 */
  cornerRatio: number
  /**
   * 我的 TAS ÷ **當前過載下**的失速速度。趨近 1 = 當前升力係數已逼近 CLmax。
   *
   * 【它量的其實是攻角，不是速度】代數上它恆等於 `√(CLmax / CL)`。所以它
   * 回答的是「我拉得太猛了嗎」，**不是**「我快沒空速了嗎」。垂直爬升時
   * 飛機不需要升力，過載趨近 0，而 `Vs ∝ √n` 也跟著趨近 0 —— 這個比值於是
   * 被撐大。見 `speedMargin`。
   */
  stallMargin: number
  /**
   * 我的 TAS ÷ **1 G** 失速速度。與當前過載無關。
   *
   * 【為什麼需要與 `stallMargin` 分開的第二個判準】M4 出貨後抓到的缺陷。
   * P-51D 由 720 km/h 垂直爬升的實測：
   *
   * | TAS | 過載 | stallMargin | speedMargin |
   * |---|---|---|---|
   * | 279 km/h | −0.030 | 8.51 | 1.46 |
   * | 132 km/h | −0.022 | 4.63 | 0.68 |
   * |  51 km/h | −0.012 | 2.33 | 0.26 |
   *
   * 吊機首閘門的門檻是 1.25，所以 `stallMargin` 要掉到約 20 km/h 才觸發
   * —— 早就來不及了。它在**最該觸發的場景幾乎不觸發**。
   *
   * 兩者各管一種失效模式：`stallMargin` 管「拉太猛」，`speedMargin` 管
   * 「快沒空速」。飛行員兩個都看。
   */
  speedMargin: number

  /**
   * **我自己的**航跡角，rad。正為爬升。
   *
   * 【為什麼需要它】吊機首閘門原本只看目標的仰角，也就是只問「目標是不是
   * 吊在我上面」。人工驗收抓到的缺陷：`extend` 會讓 AI 把自己吊到 85° 而
   * 目標仍在同一空層 —— 目標仰角接近 0，閘門一次都不觸發。「我正在把自己
   * 吊上去」與「目標吊在上面」是兩件事，前者才是失速的直接前兆。
   */
  climbAngle: number

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
    turnAdvantage: 0, airframeTurnAdvantage: 0, energyReserve: 0,
    cornerRatio: 1, stallMargin: 1, speedMargin: 1,
    climbAngle: 0,
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

  // 自機航跡角。速度退化時取 0——靜止的飛機沒有航跡，讀成「平飛」是安全的
  // 預設（它不會誤觸發吊機首閘門）。
  const selfSpeed = self.state.velocity.length()
  out.climbAngle = selfSpeed > MIN_RANGE
    ? Math.asin(clampUnit(self.state.velocity.y / selfSpeed))
    : 0
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

  // 機體層級的比較：各自在自己最擅長的速度下。與當前速度無關，所以可以快取。
  out.airframeTurnAdvantage = bestSustainedTurnRateCached(self.spec, selfAlt)
    - bestSustainedTurnRateCached(target.spec, targetAlt)

  out.energyReserve = self.specificEnergy - energyFloor(self.spec)

  // 角落速度恆為正，不必防除以 0
  out.cornerRatio = selfTas / cornerSpeed(self.spec, selfAlt)

  // 【失速速度可能極小或為 0】極高空、極低過載時 stallSpeed 會趨近 0。
  // 除以 0 會得到 Infinity，而 Infinity 通過所有「stallMargin > X」的檢查
  // ——那是「安全」的方向，但它會讓吊機首閘門永遠不觸發。夾一個下限。
  const vs = Math.max(stallSpeed(self.spec, selfAlt, Math.abs(self.diag.loadFactor)), 1)
  out.stallMargin = selfTas / vs

  // 【1 G 失速速度，不是當前過載下的】上面那個除數正是問題所在：垂直爬升
  // 時過載趨近 0，Vs(|n|) ∝ √n 也跟著縮小，比值於是被撐大。
  // 這一項無視過載，所以它問的是純粹的「我還有多少空速」。
  out.speedMargin = selfTas / stallSpeed(self.spec, selfAlt, 1)
}

/**
 * 能量底線所參照的高度，m。**專案負責人裁決。**
 *
 * 【底線是什麼】「我還打得動嗎」的答案是「我的比能量夠不夠讓我在一個安全的
 * 高度上，維持我最擅長的轉彎速度」：
 *
 *   Es_floor = ENERGY_FLOOR_ALTITUDE + V_best² / (2 g)
 *
 * `V_best` 取該高度下最佳持續轉彎率所需的速度（`bestSustainedTurnSpeedCached`）
 * —— 那是「還能纏鬥」的最低速度需求，不是配出來的數字。
 *
 * 【1,000 m 怎麼來的】那大約是「還有本錢做一次完整的垂直機動」的高度，而且離
 * 安全層的接管線（`DEFAULT_SAFETY.clearance` 120 m × `factor` 1.5 = 180 m）有
 * 五倍餘裕 —— 兩層不會互相打架：能量底線讓 AI **提早**抽身，安全層是**最後**
 * 一道防線。
 */
export const ENERGY_FLOOR_ALTITUDE = 1000

/** 每個機種一個常數：底線只與機體有關，與當前狀態無關。 */
const energyFloors = new WeakMap<AircraftSpec, number>()

function energyFloor(spec: AircraftSpec): number {
  let floor = energyFloors.get(spec)
  if (floor !== undefined) return floor
  const vBest = bestSustainedTurnSpeedCached(spec, ENERGY_FLOOR_ALTITUDE)
  floor = ENERGY_FLOOR_ALTITUDE + (vBest * vBest) / (2 * G0)
  energyFloors.set(spec, floor)
  return floor
}

/**
 * 射擊錐的半角，rad。機首偏離預瞄方向超過這個角度就幾乎沒有威脅。
 *
 * **起始值，待 Task 14 由對戰矩陣量測後回填。** 15° 的依據是 M2 的匯聚
 * 幾何：六挺翼槍在 300 m 處收斂，超過這個角度時彈幕已經整片掃到目標外。
 */
export const THREAT_CONE = 15 * (Math.PI / 180)

/**
 * 威脅的距離上限，m。超過此距離視為無威脅。
 *
 * **起始值。** 900 m 的依據是 M2 的彈丸壽命：887 m/s × 1.2 s ≈ 1064 m 是
 * 絕對上限，而 1944 年的實戰有效射程在 400 m 以內。取中間偏保守。
 */
export const THREAT_RANGE = 900

/**
 * 持續跟蹤到「完全威脅」所需的秒數。
 *
 * **起始值。** 這個因子的用途是把「一瞬間掃過去」與「穩定咬住」分開——
 * 沒有它，正面對衝時雙方都會判定自己被威脅（spec §5.3）。
 */
export const TRACK_SATURATION = 1.0

/**
 * 持續跟蹤時間 → 威脅權重，0..1。線性上升到飽和後維持 1。
 *
 * 【為什麼是純函數而計時器在別處】計時器是跨格累積的狀態，而 spec §4.3
 * 要求 assess.ts 是純函數。計時器住在 AiController，乘積也在那裡完成。
 */
export function trackingFactor(seconds: number): number {
  if (!(seconds > 0)) return 0
  return seconds >= TRACK_SATURATION ? 1 : seconds / TRACK_SATURATION
}

const T = makeScratch(3)

/**
 * 一方對另一方的**瞬時**射擊威脅，0..1。三個因子相乘。
 *
 * 【為什麼不是「有沒有預瞄解」這個布林】`solveLead` 有解只代表幾何上
 * 攔截得到，不代表打得中。正面對衝時雙方都有解——只看它的話兩邊都會
 * 判定自己被威脅、兩邊都進 defend，然後永遠卡住（spec §5.3）。
 *
 * 【M6 起匯出】僚機要問「這架敵機正在威脅我的長機嗎」，而那與這裡問的
 * 是同一件事，只是主體換人。另外定義一個便宜的角度＋距離布林會產生
 * **兩個對「誰在威脅誰」的答案** —— 於是可能出現「僚機認為長機被威脅、
 * 長機自己不認為」，而那個矛盾在畫面上看起來就是僚機無故亂衝
 * （M6 spec §7.2）。
 */
export function threatFactor(shooter: Aircraft, victim: Aircraft): number {
  const p = T.v[0]!.copy(victim.state.position).sub(shooter.state.position)
  const range = p.length()
  if (range > THREAT_RANGE) return 0

  const v = T.v[1]!.copy(victim.state.velocity).sub(shooter.state.velocity)
  const lead = T.v[2]!
  const t = solveLead(p, v, shooter.spec.battery.sight.muzzleVelocity, lead)

  // 因子一：有解，且彈丸活得夠久飛到攔截點
  if (t === NO_INTERCEPT || t > PROJECTILE_LIFETIME) return 0

  // 因子二：他的機首離預瞄方向多遠。得先把機首轉過來才打得中
  const fwd = T.v[0]!.copy(FWD).applyQuaternion(shooter.state.orientation)
  const off = Math.acos(clampUnit(fwd.dot(lead)))
  if (off >= THREAT_CONE) return 0
  const noseFactor = 1 - off / THREAT_CONE

  // 因子三：距離。越近越危險，反映散佈與反應時間
  const rangeFactor = 1 - range / THREAT_RANGE

  return noseFactor * rangeFactor
}

/**
 * 威脅與射擊機會，兩者對稱。
 *
 * `threatInstant` 只是**瞬時**值；「持續跟蹤」那一個因子由 AiController
 * 用 `trackingFactor` 乘上去（見計畫的偏離 2）。
 */
export function evaluateThreat(self: Aircraft, target: Aircraft, out: Situation): void {
  out.threatInstant = threatFactor(target, self)
  out.shotInstant = threatFactor(self, target)
}
