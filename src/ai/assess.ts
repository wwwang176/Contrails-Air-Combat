import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import {
  bestSustainedTurnRateCached, instantaneousTurnRate,
  specificExcessPower, stallSpeed, sustainedTurnRate,
} from '../analysis/envelope'
import {
  DEFAULT_DOCTRINE, energyPull, manoeuvreSpeed, sweetSpotPitch, turnPlanePitch,
} from './doctrine'
import { G0 } from '../core/math'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
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
  /**
   * 視線角速度 ÷ 我此刻的**瞬時**轉彎率上限。無因次，夾在 `TRACK_CAP` 以內。
   *
   * **> 1 = 即使拉到極限過載，機頭也追不上預瞄點。** 那是真人飛行員收手改為
   * 佈局下一次機會的訊號 —— 「準星跟不上預瞄點的移動」。
   *
   * 【為什麼分子分母都要】`losRate` 單獨是有因次的，換一台轉彎率不同的飛機
   * 就得重訂門檻。除以自己的能力之後它變成「相對於我做得到的」，換機種、
   * 換高度、換關卡都不必調。
   *
   * 【為什麼用瞬時而不是持續轉彎率】`sustainedTurnRate`（Ps = 0 的最大轉速）
   * 在空戰高度撐不住時回傳 0，拿它當分母整條線都是「追不上」。而「準星跟不
   * 跟得上」問的是**此刻拉得出多少角速度**。
   *
   * 【它是保守的】分母用的是最大過載，所以 `> 1` 的意思是「連極限都不夠」，
   * 不是「我現在懶得拉」。
   */
  trackRatio: number

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
   * 我的 TAS ÷ 我的角落速度。> 1 = 快到轉不動。
   *
   * 【它同時是「我還打得動嗎」的判準】角落速度是「這架飛機能拉出最大
   * 轉彎率的最低速度」；低於它，轉彎能力隨速度接近線性下滑。飛行員最
   * 在意的單一數字就是它。
   *
   * 【為什麼不用比能量】`Es = h + v²/2g` 出自 Boyd 的能量機動理論，發明
   * 目的是**比較兩架飛機誰佔優勢**，不是回答「我現在能做什麼」。實測
   * 反例：4379 m、67 m/s 的飛機比能量很漂亮，系統判它「還有 3299 m
   * 餘裕」，而它什麼機動都做不了 —— 能量全鎖在高度裡，提取要先俯衝，
   * 俯衝要時間、要高度、還要一開始就有速度把機頭壓下去（spec §4.1）。
   *
   * `energyAdvantage`（相對比較）仍然用比能量，那是對的用法。
   */
  cornerRatio: number
  /**
   * （我的 TAS − 他的 TAS）÷ **我的**角落速度。正 = 我比較快。
   *
   * 【它與 `cornerRatio` 的分工】那一個是**自我參照**的（TAS 除以自己的角落
   * 速度，看不到敵人），這一個看的是兩者的關係。兩者的答案可以相反：遠距離
   * 時沒有人在拉桿，TAS 自然貼近極速，於是每一架都判定「我速度過剩」——
   * 包括那架其實比對手慢 28 m/s 的護航機。
   *
   * 【分母為什麼是自己的】它要餵給替**我**產生俯仰命令的函數，以自己的
   * 操縱速度尺度正規化才有意義；敵人的角落速度不決定我需要多少控制量。
   * 而且與 `cornerRatio` 同分母，兩者才比得起來。
   *
   * 【它不含方向】迎面、橫越、同向逃跑可能得到相同的值。解讀成「追不上」
   * 只在大致同向時可靠。
   */
  speedAdvantage: number
  /**
   * `energyAdvantage` ÷ 我的角落速度**動能高度**（vc² / 2g）。正 = 我能量多。
   *
   * 【尺標為什麼是 vc² / 2g】它是「把角落速度的動能全部換成高度會有多高」，
   * 也就是這架飛機在這個高度的天然能量尺度。除以它之後同一個數字對任何機種
   * 都代表同一件事 —— 那是戰術層「一組參數對所有機型成立」的根據。
   *
   * `energyRatio = 0.5` 的意思是「我比他多半個角落速度動能高度」，**不是**
   * 「半個角落速度的能量」：動能與速度平方成正比。
   */
  energyRatio: number
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
   * 拉桿係數的上限，0..1。1 = 本層不介入。
   *
   * 【它與 `stallMargin` 那一層的關係】`steer.ts` 的 `unloadPull` 防的是
   * 失速（迎角太大），這一個防的是能量見底（速度太低）。消費端取兩者的
   * 較小值 —— 誰先擋住算誰的。
   */
  pullCeiling: number
  /**
   * 甜蜜區的航跡角偏置，rad。正 = 該抬頭、負 = 該低頭。0 = 沒有偏好
   * （同機種對打時恆為 0）。
   */
  sweetPitch: number
  /**
   * 迴轉平面的俯仰偏置，rad。正 = 抬頭（拉高迴旋）、負 = 低頭（俯衝迴旋）。
   *
   * 由 `turnPlanePitch` 對三個候選各跑一次前向積分挑出來的：三者的終點相同
   * （機鼻對上目標），差別只在路上付掉多少能量、轉完之後相對敵人站在哪。
   *
   * 【與 `sweetPitch` 的分工】那一個只看速度離最佳點多遠，**不看要轉幾度**；
   * 這一個把角度算進去。實測 t=38 s 敵人在機體仰角 +86°（座艙罩正上方）而
   * 只看角速度的舊判準說「追得上」—— 差別就在這裡。
   *
   * 【夾角用 `aspectAngle` 而不是到預瞄點的角】預瞄點要 `EngageBasis` 才有，
   * 而那是 `steer.ts` 的東西；態勢層不該反過來依賴它。兩者在射程內差幾度，
   * 對「要轉一個大彎還是小修正」這個問題不影響。
   */
  turnPitch: number

  /**
   * **我自己的**航跡角，rad。正為爬升。
   *
   * 【為什麼需要它】吊機首閘門原本只看目標的仰角，也就是只問「目標是不是
   * 吊在我上面」。人工驗收抓到的缺陷：`extend` 會讓 AI 把自己吊到 85° 而
   * 目標仍在同一空層 —— 目標仰角接近 0，閘門一次都不觸發。「我正在把自己
   * 吊上去」與「目標吊在上面」是兩件事，前者才是失速的直接前兆。
   */
  climbAngle: number

  /**
   * **最大威脅**打得到我的瞬時程度，0..1。持續跟蹤的加權在 AiController。
   *
   * 【它不再限於「當前目標」，2026-08-05】舊版是 `threatFactor(target, self)`
   * —— 只看得見自己正在打的那一架。人工驗收：「AI 好像不太會閃」。實測
   * 20v20，長機被鎖定的時間裡有 **97.8% 的鎖定來自不是它目標的敵機**，於是
   * `threatInstant` 恆為 0、`defend` 結構上不可能觸發：被鎖定的 48 段裡只有
   * 1 段閃過，**4843 點傷害 100% 是在沒有閃躲的狀態下吃的**。
   *
   * 僚機沒有這個問題，因為它的第一級「自衛」本來就掃全場（盲區只有 9.9%、
   * 閃躲率 25%）。這一項是把長機補到對稱。
   */
  threatInstant: number
  /**
   * 由我指向**最大威脅來源**的單位向量。`defend` 的破防方向繞著它算。
   *
   * 【為什麼要單獨存一個方向】威脅來源常常不是當前目標（實測 97.8%），
   * 而 `EngageBasis` 是對**當前目標**建的。拿目標的視線去破防，破的是錯的
   * 人。存成態勢資料而不是多傳一個參數，是因為它本來就是「此刻的態勢」。
   *
   * 沒有任何威脅時指向當前目標 —— 那是一個永遠有定義的方向。
   */
  threatLos: Vector3
  /** 我打得到他的瞬時程度，0..1 */
  shotInstant: number
}

export function createSituation(): Situation {
  return {
    range: 0, closureRate: 0, timeToMerge: Infinity,
    aspectAngle: 0, angleOffTail: 0, losRate: 0, trackRatio: 0,
    energyAdvantage: 0, psSelf: 0, psTarget: 0,
    turnAdvantage: 0, airframeTurnAdvantage: 0,
    cornerRatio: 1, speedAdvantage: 0, energyRatio: 0, stallMargin: 1, speedMargin: 1,
    pullCeiling: 1, sweetPitch: 0, turnPitch: 0,
    climbAngle: 0,
    threatInstant: 0, threatLos: new Vector3(0, 0, -1), shotInstant: 0,
  }
}

/** 視線退化的距離下限，m。低於此值方向沒有意義。 */
const MIN_RANGE = 1e-3

/**
 * `trackRatio` 的上限。極近距離時分母趨近 0，實測護送關全場出現過 20.15。
 *
 * 【為什麼是常數而不是設定】它是防爆用的夾子，不是可調的判準 —— 任何大於
 * 門檻兩倍的值在語意上都是同一件事（「完全追不上」）。
 */
const TRACK_CAP = 4

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

  // ── 追不追得上：視線角速度相對於我的機頭能力 ────────────────
  //
  // 【為什麼在這裡而不是 `evaluateEnergy`】訊號本身只有 1.7 秒（實測最長
  // 一段），10 Hz 取樣有可能整段錯過。`instantaneousTurnRate` 只是一次
  // `maxLoadFactorAero` 加一個開方，比這個函式裡既有的向量運算便宜。
  //
  // 【非有限的 `losRate` 要先擋掉】`Math.min(NaN, cap)` 仍然是 `NaN`，
  // 而它會乘進瞄準點汙染整條鏈。
  const itr = instantaneousTurnRate(self.spec, self.state.position.y, self.diag.aero.tas)
  out.trackRatio = Number.isFinite(out.losRate) && itr > 0
    ? Math.min(out.losRate / itr, TRACK_CAP)
    // 【拉不出任何過載時回 0，不是回上限】那個狀態該做的是換速度，而
    // `geometryGate` 的 `speedRecover` 已經在管它，而且 mode 壓過意圖。
    // 回上限會讓佈局在一個它幫不上忙的狀態下閂上。
    : 0

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

  // 【分母是 `manoeuvreSpeed` 不是 `cornerSpeed`】兩者在
  // `manoeuvreGFraction = 1` 時完全相同；那個參數存在的意義是讓所有吃
  // `cornerRatio` 的判準（脫離、拉桿上限、減速、換速、指揮層見底）**一起
  // 平移**。見 `doctrine.ts` 的欄位註解。恆為正，不必防除以 0
  const vc = manoeuvreSpeed(self.spec, selfAlt)
  out.cornerRatio = selfTas / vc
  out.speedAdvantage = (selfTas - targetTas) / vc
  // 【尺標是角落速度的動能高度】恆為正，不必防除以 0。分子的
  // `energyAdvantage` 是兩個 `specificEnergy` 的差，而那個 getter 用的
  // 也是 `G0` —— 兩邊必須是同一個常數，否則這個比值會有一個看不出來的
  // 固定偏差（不會讓任何測試變紅，只會讓門檻偏離它的推導）
  out.energyRatio = out.energyAdvantage / ((vc * vc) / (2 * G0))

  // 【失速速度可能極小或為 0】極高空、極低過載時 stallSpeed 會趨近 0。
  // 除以 0 會得到 Infinity，而 Infinity 通過所有「stallMargin > X」的檢查
  // ——那是「安全」的方向，但它會讓吊機首閘門永遠不觸發。夾一個下限。
  const vs = Math.max(stallSpeed(self.spec, selfAlt, Math.abs(self.diag.loadFactor)), 1)
  out.stallMargin = selfTas / vs

  // 【1 G 失速速度，不是當前過載下的】上面那個除數正是問題所在：垂直爬升
  // 時過載趨近 0，Vs(|n|) ∝ √n 也跟著縮小，比值於是被撐大。
  // 這一項無視過載，所以它問的是純粹的「我還有多少空速」。
  out.speedMargin = selfTas / stallSpeed(self.spec, selfAlt, 1)

  // ── 打法層：機體對這場仗的偏好（見 `doctrine.ts`）────────────────
  out.pullCeiling = energyPull(out.cornerRatio, DEFAULT_DOCTRINE)
  out.sweetPitch = sweetSpotPitch(
    self.spec, target.spec, selfAlt, selfTas, DEFAULT_DOCTRINE,
  )
  // 【為什麼在這條 10 Hz 的路徑上】三個候選各跑一次前向積分，實測一次
  // 73 µs；出貨規模（40 架 × 10 Hz）是 2.9% 的單核。放到 240 Hz 會變 24 倍。
  // 而「要往上轉還是往下轉」本來就是幾秒鐘一次的決定，不是逐格的。
  out.turnPitch = turnPlanePitch(
    self.spec, selfAlt, selfTas, out.aspectAngle, out.losRate,
    targetAlt, targetTas, DEFAULT_DOCTRINE,
  )
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
 * 警戒錐的半角，rad。**外緣**，不是實際會觸發閃躲的角度。
 *
 * 【15° 是外緣，10° 才是那條線】警戒值是線性斜坡 `1 − off/ALARM_CONE`，而
 * `defend` 的進入門檻是 `DEFAULT_RULES.threatEnter = 0.35`，所以實際觸發是
 * `off ≤ 9.75°`。留一段「注意到但還沒到要閃」的緩衝，也保住連續性 ——
 * 這個專案吃過硬截斷的虧（見 `steer.ts` 的「力道連續化」否決紀錄）。
 */
export const ALARM_CONE = 15 * (Math.PI / 180)

/**
 * 警戒到滿值所需的持續秒數。
 *
 * 【為什麼比 `TRACK_SATURATION`（1.0 s）短】警戒問的是「有人在瞄我」，
 * 那比「他已經穩穩咬住我」更早、也更該早反應。
 *
 * 【它同時是玩家的射擊窗口】0.5 秒才滿，加上 `VETERAN` 的 0.3 秒反應延遲
 * —— 快速的快照射擊仍然打得中，被閃掉的是「慢慢瞄、瞄很久」那種。這是
 * 刻意的取捨，也是這個旋鈕最該由人工試飛定案的理由。
 */
export const ALARM_SATURATION = 0.5

/** 警戒的持續時間 → 權重，0..1。線性上升到飽和後維持 1。 */
export function alarmRamp(seconds: number): number {
  if (!(seconds > 0)) return 0
  return seconds >= ALARM_SATURATION ? 1 : seconds / ALARM_SATURATION
}

const A = makeScratch(3)

/**
 * 「他的預瞄環套在我身上嗎」，0..1。**`defend` 的觸發判準。**
 *
 * ## 與 `threatFactor` 的分工
 *
 * `threatFactor` 回答「**他打得中我的機率有多高**」——給目標選擇用，那個
 * 用途完全正確：遠距離的敵人確實比較不致命。但 `defend` 若也用它當判準，
 * 就變成「只有快被打死才閃」：
 *
 * ```
 * threat = noseFactor × (1 − range/900) ≥ 0.35   →   range ≤ 585 m
 * ```
 *
 * **超過 585 m，威脅值在數學上不可能到達閃躲門檻**，不管打多久、瞄多準。
 * 實測（三機腳本射手場景、180 秒）：AI 在 700 與 900 m 被連續射擊，
 * `defend` 進入率 **0.0%**。那就是「AI 看起來很笨」的成因。
 *
 * 這裡的兩處差別**只有**：
 *
 *   1. **沒有距離衰減** —— 「該不該閃」與命中機率無關。
 *   2. **沒有 `THREAT_RANGE` 硬截斷** —— 射程改由**武器自己**決定。
 *
 * ## 射程為什麼不寫死
 *
 * `Projectiles` 的既有不變量：「看得到預瞄環」精確等於「打得到」
 * （`t ≤ PROJECTILE_LIFETIME`）。所以警戒的定義可以講得很乾淨：**他的預瞄
 * 環套得住我**——那是玩家看自己 HUD 時已經懂的概念。有效射程因此是湧現的：
 * P-51D 887 × 1.2 ≈ **1064 m**，Bf109G6 705~750 × 1.2 ≈ **846~900 m**。
 * 由 585 m 拉到約 1064 m，將近兩倍。
 *
 * 【1200 m 不會觸發，而那是對的】那個距離子彈物理上到不了，不反應是正確
 * 行為，不是缺陷。
 *
 * ## 為什麼刻意與 `threatFactor` 重複前八行
 *
 * 兩者的預瞄解與偏離角算式相同，看起來該抽共用函數。**不抽。**
 * `threatFactor` 是全部 AI 基準的來源（對戰矩陣、六場機動、防禦場景），
 * 而這個專案對浮點層級的漂移是敏感的——重構它換來的是「所有既有基準是否
 * 仍然逐值相同」這個無法便宜驗證的風險。八行的重複比那個風險便宜。
 *
 * 熱路徑（240 Hz），不配置。
 */
export function alarmFactor(shooter: Aircraft, victim: Aircraft): number {
  const p = A.v[0]!.copy(victim.state.position).sub(shooter.state.position)
  const v = A.v[1]!.copy(victim.state.velocity).sub(shooter.state.velocity)
  const lead = A.v[2]!
  const t = solveLead(p, v, shooter.spec.battery.sight.muzzleVelocity, lead)

  // 【射程就在這一行】無解、或彈丸活不到攔截點 = 他打不到我 = 沒事
  if (t === NO_INTERCEPT || t > PROJECTILE_LIFETIME) return 0

  const fwd = A.v[0]!.copy(FWD).applyQuaternion(shooter.state.orientation)
  const off = Math.acos(clampUnit(fwd.dot(lead)))
  if (off >= ALARM_CONE) return 0
  return 1 - off / ALARM_CONE
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
  aimAt(self, target, out.threatLos)
}

/**
 * 把 `threatInstant` 與 `threatLos` 換成另一架敵機 —— 當它的威脅**大於**
 * 現值時。`shotInstant` 不動（那永遠是對當前目標的）。
 *
 * 【為什麼掃描住在 AiController 而不是這裡】掃全場需要指派板，而板是 AI
 * 層的概念；`assess.ts` 只認兩架飛機（spec §4.3）。這個函數是那個掃描的
 * 逐項比較，呼叫端負責迭代。
 *
 * 不修改 self 與 other。
 */
export function considerThreatFrom(self: Aircraft, other: Aircraft, out: Situation): void {
  const t = threatFactor(other, self)
  if (t <= out.threatInstant) return
  out.threatInstant = t
  aimAt(self, other, out.threatLos)
}

/** 由 self 指向 other 的單位向量寫進 out。退化時取機首。 */
function aimAt(self: Aircraft, other: Aircraft, out: Vector3): void {
  out.copy(other.state.position).sub(self.state.position)
  const len = out.length()
  if (len > MIN_RANGE) out.divideScalar(len)
  else out.copy(FWD).applyQuaternion(self.state.orientation)
}

/** `turnTime` 的暫存。與 `S`、`T` 分開，避免與態勢評估搶用 */
const TT = makeScratch(2)

/**
 * 把**航跡**轉到目標身上所需的時間，s。轉不動時回傳 `Infinity`。
 *
 * 【為什麼用瞬時而不是持續轉彎率】問的是「我多久能轉過去」，那是短時間
 * 拉 G 的事，正是瞬時轉彎率的定義。而且 `instantaneousTurnRate` 沒有二分
 * 搜尋，比 `sustainedTurnRate` 便宜得多。
 *
 * 【它是選目標的「代價」項】舊的評分只問「這架敵機有多值得打」，完全
 * 不問「我要花多少代價才打得到」。實測 43% 的新目標在後半球，其中只有
 * 1.7% 咬得到 —— 那 560 秒總共只開了 0.6 秒的火（spec §3.3）。
 *
 * 【角度由速度向量量，不是機首，2026-08-05】
 *
 * 這個函數**只被選目標消費**（`target.ts` 與 `wingman.ts`），而選目標是
 * 慢決策 —— 10 Hz 評估、最少停留 1~2 秒。舊版拿瞬時機首當基準，等於把一個
 * **一秒能甩 75° 的快變量**餵進慢決策。
 *
 * 破防（`steer.ts` 的 `defendAim`）正是 75° 的機首甩動，而轉向折扣的權重
 * 是所有折扣裡最重的（`turnWeight = 2`）。實測加入閃躲之後，20v20 的
 * A→B→A 換回來由 88 次升到 194 次、長機持有時間貼回 `minDwell` 下限 ——
 * 前一批壓下去的猶豫大半吐了回去。而破防本身沒有錯，錯的是讓它污染一個
 * 不該理會瞬態的決策。
 *
 * 【速度向量不只是「比較慢」，它本來就是對的問題】選目標問的是「我要不要
 * 投入去打他」，那取決於**航跡能不能過去**，不是此刻機鼻朝哪。硬機動時
 * 機首是暫態的、指向一個並不打算久留的方向（滾轉會立刻甩開機首，而航跡
 * 要等升力積分才轉得過來）；平飛時兩者只差一個攻角，所以既有的量測結論
 * 不受影響。
 *
 * 這與 spec §4.2 的分頻原則同源：**慢的決策要用慢的輸入。**
 *
 * 熱路徑之外（10 Hz），但仍然不配置。不修改 self 與 target。
 */
export function turnTime(self: Aircraft, target: Aircraft): number {
  const rate = instantaneousTurnRate(self.spec, self.state.position.y, self.diag.aero.tas)
  return rate > 1e-6 ? trackAngle(self, target) / rate : Infinity
}

/**
 * 我的**航跡**與目標視線的夾角，rad。0 = 他正在我的航跡正前方，π = 正後方。
 *
 * 【它就是 `turnTime` 的分子】兩者共用同一個角，所以「由速度向量量而不是
 * 機首」這條裁決（見 `turnTime` 的註解）自動適用於兩邊 —— 不會出現「轉向
 * 折扣用航跡、視野折扣用機首」這種一個決策裡有兩個方位定義的情形。
 *
 * 【為什麼獨立匯出】`target.ts` 的視野折扣要的是**純角度**，不是除以迴旋率
 * 之後的秒數。在那邊自己再算一次會是第二份同義的幾何 —— 這個專案在
 * `contactColor`、`threatFactor` 上都記過那樣會漂開。
 *
 * 熱路徑之外（10 Hz），但仍然不配置。不修改 self 與 target。
 */
export function trackAngle(self: Aircraft, target: Aircraft): number {
  const los = TT.v[0]!.copy(target.state.position).sub(self.state.position)
  const range = los.length()
  // 重疊時「該轉多少」沒有意義，取 0 —— 與 evaluateGeometry 的退化處理一致
  if (range <= MIN_RANGE) return 0
  los.divideScalar(range)

  // 航跡方向。速度退化時回頭用機首 —— 靜止的飛機沒有航跡
  const dir = TT.v[1]!.copy(self.state.velocity)
  const speed = dir.length()
  if (speed > MIN_RANGE) dir.divideScalar(speed)
  else dir.copy(FWD).applyQuaternion(self.state.orientation)

  return Math.acos(clampUnit(dir.dot(los)))
}
