import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { smoothstep } from '../core/math'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { WEP_THROTTLE } from '../physics/propulsion'
import { rallyAim } from './rally'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Situation } from './assess'
import type { Intent } from './rules'
import { AXIS_EPSILON, headingErrorTo, perpendicular, type EngageBasis } from './engageGeometry'
import { DEFAULT_STEER, EXTEND_SIDE_HOLD, type SteerConfig } from './steerConfig'
import type { DefendState } from './defendState'
import { bandError, type BandState } from './bandState'
import { sweetYield } from './shotYield'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)

export type SteerMode = 'normal' | 'overshoot' | 'speedRecover' | 'unload' | 'planeDegenerate'

/**
 * 幾何有效性閘門（spec §7.1）。在算 yo-yo 平面之前先過。
 *
 * 【優先序：超前 > 沒空速 > 拉太猛 > 平面退化】撞上去比失速嚴重；沒空速
 * 比拉太猛嚴重（前者要壓機頭換速度，後者只要停止拉桿）；失速比瞄不準嚴重。
 */
export function geometryGate(
  sit: Situation,
  basis: EngageBasis,
  cfg: SteerConfig = DEFAULT_STEER,
): SteerMode {
  // 極近距離時預瞄點會產生指揮儀兌現不了的角速度需求：100 m 外、橫向
  // 200 m/s 的目標，視線角速度是 2 rad/s = 115°/s，而 P-51 的最大滾轉率
  // 只有約 100°/s——瞄準點每格劇烈跳動而飛機跟不上。
  if (sit.range < cfg.overshootRange && sit.closureRate > 0) return 'overshoot'

  // 【兩個判準各管一種失效模式，補救動作相反】
  //   speedMargin 低 = 快沒空速  → 壓機頭換速度
  //   stallMargin  低 = 拉太猛   → 卸載，機頭跟著速度向量
  // **兩者不可以合併成同一個 mode**：共用 `unloadAim(self, 0)` 對「拉太猛」
  // 正確、對「快沒空速」是無操作（spec §5.1 的缺陷 3）。
  //
  // 【不准加仰角前提】「目標仰角 > 45° 或自己航跡角 > 45°」那種前提會讓
  // 同一空層平飛追擊時速度掉到一半也不動。速度不足在任何姿態都是問題；
  // 俯衝時速度自然高，不會誤觸發。
  if (sit.speedMargin < cfg.speedRecoverMargin) return 'speedRecover'
  if (sit.stallMargin < cfg.unloadMargin) return 'unload'

  // 真正的幾何奇異：升力方向 ∥ 視線，「上方」沒有唯一解
  if (basis.verticalDegenerate) return 'planeDegenerate'

  return 'normal'
}

export interface Knobs {
  /** −1 = 後置追擊、0 = 純追擊、+1 = 前置追擊（彈道預瞄點） */
  leadLag: number
  /** −1 = 壓到交戰平面下方、0 = 同平面、+1 = 拉到上方 */
  vertical: number
  /**
   * 規則 3 的俯衝目標 IAS，m/s。**0 = 關閉。**
   *
   * 由 `AiController` 每步寫入 —— `steerCommand` 讀不到 `RuleState`，「這一段
   * 是不是規則 3 的脫離」只有它知道。見 `redlineDiveIas`。
   */
  diveIas: number
}

/**
 * 規則 3 的俯衝目標 IAS，m/s。**0 = 沒有實質餘裕，不俯衝。**
 *
 * 【餘裕條件】對手紅線 × `diveTargetRatio` 要低於自己的 × `diveSelfRatio`
 * 才算：P-51 對 Bf109（787 對 729 km/h）不成立，行為一個字不變；F4F 對 A6M
 * （549 對 630）成立。俯衝到對手放手的速度就夠，不是俯衝到自己的極限。
 */
export function redlineDiveIas(
  vneSelf: number, vneTarget: number, cfg: SteerConfig = DEFAULT_STEER,
): number {
  const target = cfg.diveTargetRatio * vneTarget
  const ceiling = cfg.diveSelfRatio * vneSelf
  return target < ceiling ? target : 0
}

/** 接近率的舒適區間，m/s。超過上界要殺、低於下界要補。 */
const CLOSURE_HIGH = 150
const CLOSURE_LOW = 0

function clamp1(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x
}

/**
 * 由態勢算出兩個旋鈕。**具名機動是這個平面上的點，不是寫死的分支。**
 *
 * 【為什麼連續而不是三個具名分支】具名機動之間需要遲滯，否則在邊界上
 * 會反覆切換；連續量不需要——它會自己從一邊滑到另一邊。而且「高 yo-yo」
 * 與「低 yo-yo」本來就是同一個動作的兩個方向，拆成兩個名字反而要處理
 * 它們之間的過渡。
 */
export function engageKnobs(sit: Situation, out: Knobs, _cfg: SteerConfig = DEFAULT_STEER): void {
  /**
   * 「接近率太高」只有在**尾追**時才代表超前。
   *
   * 1 = 純尾追（我在他機尾後方）、0 = 純對頭。`angleOffTail` 是視線與他機首
   * 的夾角，0 為我咬在他正後方、π 為他正朝我來。
   *
   * 【為什麼需要這個門】人工驗收抓到的缺陷：對頭時接近率是**雙方速度相加**。
   * 兩台各 150 m/s 就是 282 m/s，`excess` 算出 0.88，兩個旋鈕直接推到底
   * ——全後置追擊 + 滿舵高 yo-yo。實測機首因此離預瞄點 24–40°，而威脅錐是
   * 15°、開火錐是 3°，於是：兩邊都不開火、兩邊的 `threatInstant` 都恆為 0，
   * 連 `defend` 在對頭時都結構上不可能觸發。看起來就是「AI 撇頭拒絕交戰」。
   *
   * 而那個反應本來就沒有意義：對頭的接近率是幾何給定的，任何機動都減不掉，
   * 高 yo-yo 只是把機首甩開。真正該做的是乾淨的預瞄追擊，拿一次正面快照
   * ——那正是 `merge` 意圖在做的事，只是它的時間窗（2.5 s）只涵蓋最後 750 m。
   */
  // 【為什麼是 `max(0, cos)` 而不是 `(1+cos)/2`】後者在正側面（90°）還留
  // 一半權重，於是敵機在前方 600 m 由左舷橫越到右舷時，瞄準點停在「飛機與
  // 預瞄點中間」—— 那是後置量。橫越的接近率與對頭一樣是幾何給定的，後置
  // 減不掉它，只會讓 3° 開火錐永遠對不上偏射的預瞄點。現在的門讓尾追
  // （< 90°）才漸進觸發，側面與前半球完全不後置。
  const pursuit = Math.max(0, Math.cos(sit.angleOffTail))

  // 接近率相對舒適區間的偏離，正 = 太快、負 = 追不上
  const excess = pursuit * (sit.closureRate - CLOSURE_HIGH) / CLOSURE_HIGH
  // 【追不上不用門】「他跑掉了要切內線」與幾何無關，任何方位都成立。
  const deficit = (CLOSURE_LOW - sit.closureRate) / CLOSURE_HIGH

  // 太快 → 後置；正常 → 前置（進入射擊解）
  out.leadLag = clamp1(1 - 2 * Math.max(0, excess))

  // 【太快就拉高、追不上就壓低】高 yo-yo 用高度吃掉多餘速度並增加航跡
  // 長度；低 yo-yo 用高度換速度切內線。兩者是同一個旋鈕的兩端。
  //
  // 卸載**不在這裡**：卸載＝最小誘導阻力＝保住速度，會讓超前更嚴重。
  // 它屬於 extend（§7.3），那裡要的正是加速脫離。
  out.vertical = clamp1(Math.max(0, excess) - Math.max(0, deficit))
}

/**
 * 佈局下一次射擊機會的旋鈕：**後置追擊 + 依能量往上**。就地寫入 `out`。
 *
 * 【它不是脫離】轉向的目的是**創造下一次瞄準敵人的機會**。後置追擊把需要
 * 的角速度降下來、保住能量，高 yo-yo 用高度換取下一次進場的位置 —— 兩者
 * 都是為了繼續打，不是為了離開。
 *
 * 【與 `engageKnobs` 的分工】那一個由**接近率**決定（太快就後置、追不上就
 * 切內線），問的是速度；這一個在**機頭追不上預瞄點**時取代它，問的是角速度。
 * 兩者不會同時生效 —— 呼叫端二選一。
 */
export function repositionKnobs(
  sit: Situation,
  out: Knobs,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  out.leadLag = -1
  // 【非有限值退化成不往上】水平轉向在任何狀態下都是安全的
  out.vertical = Number.isFinite(sit.cornerRatio)
    ? smoothstep(cfg.zoomEnter, cfg.zoomFull, sit.cornerRatio)
    : 0
}

/**
 * 瞄準方向離預瞄方向多近才算在跟瞄（`Command.trackTurn`），rad。空戰與對地
 * 掃射共用。
 *
 * 【為什麼看瞄準貼不貼著預瞄點，而不是看走哪一條路徑】有目標時的集合、脫離、
 * 找回速度、卸載都走同一個 `steerCommand`，而它們的瞄準方向由**自己的速度**
 * 導出：自己正在轉，瞄準方向跟著轉，新的改平會把它讀成「要維持這個轉彎」，
 * 抵銷卸載要的改平。那些分支的瞄準方向都不貼著預瞄點。
 *
 * 【10° 而不是開火錐的 3°】病發生在誤差進改平的淡入角（2.5°）之後；錐開大
 * 一點，濾波在誤差變小之前就收斂。**起始值，由試飛裁定。**
 */
export const TRACK_TURN_CONE = 10 * (Math.PI / 180)

/**
 * 迴轉時不壓機鼻：敵人還在機頭 `turnFrontCone` 以外，而且沒有低我
 * `turnDiveRadii` 個迴旋半徑以上，瞄準俯仰最低只到水平 —— 水平轉或拉高轉。
 * 方位不動。就地改 `aim`。
 *
 * 【為什麼要有】空戰的瞄準方向直接指著敵人（的預瞄點）。迴轉途中敵人在下方，
 * 迴轉就變成俯衝迴轉：低空對地進場時被從後方追上，AI 防禦急轉拉到 370 m 之後
 * 轉進交戰，一路壓到 −57°，離地 200 m 時防墜才硬拉起，最低 25 m、速度燒掉
 * 三成，敵人被甩到 1.7 km 外。高度是存起來的能量，迴轉時換掉它，轉完就比
 * 敵人低。
 *
 * 【兩個例外】敵人已經在前方時照舊壓機鼻攻擊（從上方撲擊）；敵人低我很多時
 * 照舊准俯衝迴轉（有多的高度可以換轉彎率，轉完仍在他上方）。
 *
 * @param aspect            機頭到敵人的夾角，rad（`Situation.aspectAngle`）
 * @param altitudeAdvantage 我的高度 − 敵人的高度，m
 * @param turnRadius        最佳持續迴旋半徑，m
 * @param heading           瞄準幾乎垂直往下（水平分量為零）時改用的水平航向
 *
 * 熱路徑，不配置。
 */
export function holdTurnLevel(
  aim: Vector3, aspect: number, altitudeAdvantage: number, turnRadius: number,
  heading: Vector3, cfg: SteerConfig,
): void {
  if (!(aim.y < 0)) return
  if (!(aspect > cfg.turnFrontCone)) return
  if (altitudeAdvantage > cfg.turnDiveRadii * turnRadius) return
  const h = Math.hypot(aim.x, aim.z)
  if (h > 1e-6) {
    aim.set(aim.x / h, 0, aim.z / h)
    return
  }
  const hh = Math.hypot(heading.x, heading.z)
  if (hh > 1e-6) aim.set(heading.x / hh, 0, heading.z / hh)
  else aim.set(0, 0, -1)
}

const A = makeScratch(2)

/** `repositionKnobs` 的輸出暫存。與 `makeScratch` 同一個理由：不在熱路徑配置 */
const RK: Knobs = { leadLag: 0, vertical: 0, diveIas: 0 }

/**
 * 由旋鈕算出世界座標的瞄準方向（單位向量）。
 *
 * 【位移的長度尺度用角度而非公尺】`range × tan(maxOffsetAngle)` 讓瞄準點
 * 的偏移是一個**角度**，那才是指揮儀真正在追的量。用固定公尺數的話，
 * 遠距離時 yo-yo 小到沒有效果，近距離時大到把瞄準點甩出視野。
 */
export function aimFromKnobs(
  basis: EngageBasis,
  sit: Situation,
  k: Knobs,
  out: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  const scale = Math.max(sit.range, 1) * Math.tan(cfg.maxOffsetAngle)

  const aim = A.v[0]!.copy(basis.leadPoint)

  // 後置量：由 +1（全前置，不後退）到 −1（全後置，退一個 scale）
  if (!basis.leadDegenerate) {
    const lag = (1 - clamp1(k.leadLag)) / 2
    aim.addScaledVector(basis.leadAxis, -lag * scale)
  }
  if (!basis.verticalDegenerate) {
    aim.addScaledVector(basis.verticalAxis, clamp1(k.vertical) * scale)
  }

  const len = aim.length()
  if (len > 1e-6) out.copy(aim).divideScalar(len)
  else out.copy(basis.losAxis)
}

const C = makeScratch(2)

/**
 * `extend` 的俯仰角，rad。正 = 爬升。
 *
 * 【`extend` 只能搬能量，補不了能量】總能量由推力決定，而推力就那麼多。
 * 這一層唯一能決定的是**能量放在高度還是速度裡**。所以問題不是「我能量夠
 * 不夠」（那是 `rules.ts` 的閂鎖在管），而是「這些能量該擺哪」。
 *
 * 【三個分量，每一個都單向】疊加而不是 if-else：裸門檻跨線時指令瞬間翻號，
 * 而飛機有俯仰慣性，跨線後要幾秒才轉得過來 —— 衝過頭、翻號、再衝過頭。
 * 實測在 1000 m 線上持續震盪 40 秒（spec §3.5）。連續函數沒有翻轉點。
 *
 * ```
 *   速度不足 → 低頭     只在 cornerRatio < 1 時作用
 *   比敵人低 → 抬頭     altitudeGapScale 是尺標，**而且要先有機動速度**
 *   離地太近 → 抬頭     clearanceScale 是尺標，安全項
 * ```
 *
 * 【第二項的前提是第一項已經滿足】爬升花能量，而這個意圖存在的理由是補能量。
 * 沒速度就往上爬會走進一個死角，見下面 `gapDeficit` 那一段的實測。第三項
 * **沒有**這個前提 —— 它是安全項，撞地比沒速度嚴重。
 *
 * 兩個抬頭的理由**取較急的那個**而不是相加 —— 它們是同一件事的兩個來源
 * （「該往上」），相加只會讓兩者同時成立時多爬一倍。
 *
 * 【為什麼速度項只剩下半邊】「速度過剩就爬升」是把動能換成位能，而實測
 * 那筆交易在高空幾乎沒有收益：全場高度 +2,346 m、空速只 +2 m/s，總能量
 * 原地打轉，`extend` 因此佔掉 56% 的時間、能量閂鎖最長一段 197 秒。
 * 該不該往上由**敵人在哪**回答，不由「我此刻速度多少」回答。
 *
 * 【為什麼不是比總能量】`energyAdvantage` 已經把位能與動能加在一起，而
 * 搬運不會改變它 —— 拿它當這裡的判準，等於問一個對三個選項都相同的數字。
 * 見 `Situation.altitudeAdvantage`。
 *
 * @param cornerRatio TAS ÷ 自己的角落速度
 * @param altitudeAdvantage 我比目標高幾公尺。負 = 我在下面
 * @param groundClearance 離地（海面）高度，m
 */
export function extendPitchAngle(
  cornerRatio: number,
  altitudeAdvantage: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  // 【只有下半邊】速度過剩不構成爬升的理由，見上面
  let speedDeficit = 1 - cornerRatio
  if (speedDeficit < 0) speedDeficit = 0

  let floorDeficit = 1 - groundClearance / cfg.clearanceScale
  if (floorDeficit < 0) floorDeficit = 0
  else if (floorDeficit > 1) floorDeficit = 1

  // 【沒有目標時不表示意見】altitudeAdvantage 非有限值 = 沒得比
  let gapDeficit = 0
  if (cfg.altitudeGapScale > 0 && Number.isFinite(altitudeAdvantage)) {
    gapDeficit = -altitudeAdvantage / cfg.altitudeGapScale
    if (gapDeficit < 0) gapDeficit = 0
    else if (gapDeficit > 1) gapDeficit = 1
    // 【速度先於高度】爬升是**花**能量，而 `extend` 存在的理由是**補**能量。
    // 沒有機動速度就往敵人的高度爬，等於用僅剩的動能去換一個自己守不住的位置。
    //
    // 實測（`band-drill.probe.ts`，敵人在前上方 1000 m）：少了這道閘，109 在
    // 5750 m／137 m/s 進入一個死角 —— 高度項要它維持 +4°，速度項只給 −9° 的
    // 一小截，兩者抵成幾乎平飛。它於是既不俯衝換速度也追不上，一路直飛到
    // **10 km 外**，`extendEnergyLatch` 因為能量差 −945 m 永遠不解除。
    //
    // 【為什麼是斜坡不是 `if`】與這個函式的其他每一項同一條理由：裸門檻在
    // 線上會翻號，而飛機有俯仰慣性。
    //
    // 【斜坡從 `extendClimbFrom` 起，不是從角落速度起】從 1 起的話，速度卡在
    // 角落速度九成五的飛機高度項是 0、速度項還要它低頭 5° —— 已經比敵人低
    // 400 m 還一路往下掉。靶機急轉的情境裡 AI 就這樣掛在 2,550 m 幾十秒。
    // 上面那個死角在 0.64，斜坡的起點仍在它上面
    gapDeficit *= smoothstep(cfg.extendClimbFrom, cfg.unloadMargin, cornerRatio)
  }

  const climb = floorDeficit > gapDeficit ? floorDeficit : gapDeficit
  const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * climb
  if (raw < -cfg.extendPitch) return -cfg.extendPitch
  if (raw > cfg.extendPitch) return cfg.extendPitch
  return raw
}

/**
 * `extend` 期間瞄準點要偏離當前航向多少，rad。正 = 左，與 `unloadAim` 的
 * `yaw` 同一個約定。
 *
 * 【為什麼是 `min` 而不是比例】要的是「一直朝錨點轉，但每一格只准偏這麼
 * 多」。錨點已經在 `cap` 之內時就直接對準它 —— 用比例的話永遠差一截，
 * 航向會漸近而不抵達。
 *
 * 【側別由呼叫端給】與 `defendAim` 收 `axisSign` 是同一個分工：純函數沒有
 * 「這是不是第一格」的資訊，而正後方的翻轉只有跨格記憶治得了。
 *
 * @param side         `DefendState.extendSide`，+1 / −1。**0 = 不偏**
 * @param headingError `headingErrorTo` 的值
 * @param cornerRatio  速度餘裕。非有限值退化成滿偏（沒有角落速度就沒有
 *                     這本帳；收緊的退化會讓 extend 永遠直飛不回頭）
 */
export function extendHeadingBias(
  side: number,
  headingError: number,
  range: number,
  cornerRatio = Infinity,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const cap = cfg.extendTurnCap
  // 【`!(cap > 0)`】同時擋掉 0、負值與 NaN —— 後者會讓下面的 min 回傳 NaN
  // 然後汙染整個 aimWorld。0 = 這一層關閉，是消融的開關。
  if (side === 0 || !(cap > 0)) return 0
  if (!Number.isFinite(headingError) || !Number.isFinite(range)) return 0
  // 【近距離不偏】見 `SteerConfig.extendTurnFade` —— 沒有這一層 AI 會繞著
  // 目標盤旋。壞掉的淡入距離退化成「全程套用」，與 0 同義。
  const fade = cfg.extendTurnFade > 0
    ? smoothstep(0, cfg.extendTurnFade, range)
    : 1
  if (fade === 0) return 0
  // 【速度先於轉向】上限限的是「瞄準點偏
  // 多遠」，不是「拉多少 G」：對著**持續旋轉**的方位（敵人在下方繞圈打
  // 轟炸機），20° 的誤差永遠追不完，飛控就一直壓 60~75° 坡度拉 4 G ——
  // 阻力吃掉俯衝的全部速度收益，空速釘死、「速度先於高度」閘門把爬升
  // 掐死、跌破地板繼續跌（belowOrbit 實測：50 秒漏 1300 m 出不了場）。
  //
  // 乘上速度餘裕把正回饋剪成負回饋：缺速度 → 翼平直飛 → 阻力小 → 速度
  // 真的回來 → 偏置線性開回來 → 轉太多掉速又自己收。斜坡是
  // `extendVigorEnter`..`Full`（0.85 → 1.05）：底在角落速度**下方** ——
  // cr = 1 是最會轉的速度，不是懸崖；定值依據見兩個欄位的註解。
  const vigor = Number.isFinite(cornerRatio)
    ? smoothstep(cfg.extendVigorEnter, cfg.extendVigorFull, cornerRatio)
    : 1
  if (vigor === 0) return 0
  const want = headingError < 0 ? -headingError : headingError
  return side * (want < cap ? want : cap) * fade * vigor
}

/**
 * 繞 +Y 把向量轉 `yaw`，就地修改。**航跡角與長度天然不變** —— 這正是它
 * 適合當 `unloadAim` 的後處理的理由：俯仰那一層的決定完全不受影響。
 */
function rotateHeading(v: Vector3, yaw: number): void {
  if (yaw === 0) return
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const x = v.x * c + v.z * s
  const z = -v.x * s + v.z * c
  v.x = x
  v.z = z
}

/** 超前修正的固定旋鈕：全後置 + 全高 yo-yo。 */
const OVERSHOOT_KNOBS: Knobs = { leadLag: -1, vertical: 1, diveIas: 0 }

/**
 * 卸載的拉桿係數，0..1。1 = 照常拉、0 = 完全鬆桿（瞄準機首）。
 *
 * 【為什麼是 `(stallMargin − 1) / (unloadMargin − 1)`】兩端各自有物理意義：
 *
 *   `stallMargin` = 1          貼著 CLmax，再拉就失速 → 係數 0，完全鬆桿
 *   `stallMargin` = unloadMargin  剛好在門檻上         → 係數 1，與 normal 相同
 *
 * 後者是**消除抽動的關鍵**：進入與離開 `unload` 的瞬間指令完全不跳，所以
 * `geometryGate` 在門檻上翻來翻去不再有可見的後果。這與 `extendPitchAngle`
 * 改成連續量是同一手 —— 連續函數沒有翻轉點（spec §7.1）。
 *
 * @param stallMargin `Situation.stallMargin`，代數上恆等於 √(CLmax / CL)
 */
export function unloadPull(stallMargin: number, cfg: SteerConfig = DEFAULT_STEER): number {
  const span = cfg.unloadMargin - 1
  if (!(span > 0)) return 1
  const t = (stallMargin - 1) / span
  return t < 0 ? 0 : t > 1 ? 1 : t
}

const U = makeScratch(2)

/**
 * 沿著大圓把瞄準方向往機首收，**方位不變**。就地修改 `aim`。
 *
 * 【為什麼方位必須不動】指揮儀把瞄準誤差拆成兩件事：方位決定往哪邊滾
 * （`rollCommand = atan2(aimBody.x, aimBody.y)`），大小決定拉多少 G。而
 * 「卸載」在物理上只有一個意思 —— 少拉一點，與滾轉無關。
 *
 * 【不可以改成瞄準自身速度向量】`unloadAim(self, 0)` 那種寫法在**橫向**
 * 產生約 14° 的偏移，指揮儀讀成轉向需求：滾轉指令由 2–3° 暴增到 27–29°、
 * 副翼打到滿舵、滾轉率由 −46°/s 翻成 +12°/s。純量縮放不會。
 *
 * 【誰在呼叫它】`steerCommand` 的後處理，**以及 `AiController` 的早退路徑**
 * （rally／station／平飛）—— 那三格直接寫 `aimWorld` 然後 return，不經過
 * `steerCommand`，所以拉桿紀律要自己補一次（spec §4.4）。改動這個函式時
 * 兩個呼叫點都要顧到。
 *
 * @param factor 0..1。0 = 瞄準機首（完全鬆桿）、1 = 原樣不動
 */
export function shrinkTowardNose(self: Aircraft, factor: number, aim: Vector3): void {
  if (factor >= 1) return
  const nose = U.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
  if (factor <= 0) {
    aim.copy(nose)
    return
  }
  const dot = clampUnit(nose.dot(aim))
  const angle = Math.acos(dot)
  // 已經對準：沒有可縮的誤差角
  if (angle < 1e-4) return

  // 【正後方是奇異點】誤差趨近 π 時「誤差在哪一邊」數學上不定，垂直分量由
  // 浮點雜訊主導。此時取機首 —— 完全鬆桿在任何情況下都是安全的卸載動作，
  // 而挑一個由雜訊決定的方位會讓飛機亂滾。
  const perp = U.v[1]!.copy(aim).addScaledVector(nose, -dot)
  const len = perp.length()
  if (len < 1e-6) {
    aim.copy(nose)
    return
  }
  perp.divideScalar(len)

  const target = angle * factor
  aim.copy(nose).multiplyScalar(Math.cos(target)).addScaledVector(perp, Math.sin(target))
}

/** applyPitchBias 與 applyPitchToward 的俯仰角上界，rad。 */
const PITCH_BIAS_LIMIT = 80 * (Math.PI / 180)

/**
 * 把 `aim` 的**航跡角**加上 `deltaPitch`，水平方位不變。就地修改。
 *
 * 它服務甜蜜區與迴轉平面的俯仰偏置；兩者都只改航跡角、不改水平方位，避免
 * 被指揮儀誤讀成額外的滾轉需求。
 *
 * 【夾在 ±80°】超過就變成垂直，而俯仰偏置的用途是「偏一點」不是「翻過去」。
 *
 * 【為什麼不吃 `self`】這只是偏好；鉛直退化、沒有可保留的水平方位時直接
 * 放棄即可，所以簽名不需要飛機。
 *
 * `deltaPitch === 0` 時逐位元不動。假設 `aim` 是單位向量。
 */
export function applyPitchBias(deltaPitch: number, aim: Vector3): void {
  if (deltaPitch === 0) return
  const horiz = Math.hypot(aim.x, aim.z)
  // 已經鉛直時方位沒有定義；這一層只是偏好，放棄是安全的。
  if (horiz < 1e-9) return
  const pitch = Math.atan2(aim.y, horiz)
  let next = pitch + deltaPitch
  if (next > PITCH_BIAS_LIMIT) next = PITCH_BIAS_LIMIT
  else if (next < -PITCH_BIAS_LIMIT) next = -PITCH_BIAS_LIMIT
  const scale = Math.cos(next) / horiz
  aim.set(aim.x * scale, Math.sin(next), aim.z * scale)
}

/**
 * 把 `aim` 的**航跡角**往 `pitch` 拉 `weight` 那麼多，水平方位不變。就地修改。
 *
 * 【它與 `applyPitchBias` 的差別是「偏置」對「約束」】那一支是相對量（加幾
 * 度），所以追擊要往下拽它攝不住；這一支是絕對量，`weight = 1` 時航跡角
 * **完全由 `pitch` 決定**。空層鎖需要的正是後者 —— 「保持 5000 m」不是「比
 * 追擊想飛的高一點」。
 *
 * 【為什麼方位不能動】與 `applyPitchBias`、`shrinkTowardNose` 同一個理由：
 * 動了會被指揮儀讀成滾轉需求，副翼打到滿舵。
 *
 * `weight <= 0` 時逐位元不動。假設 `aim` 是單位向量。
 */
export function applyPitchToward(pitch: number, weight: number, aim: Vector3): void {
  if (!(weight > 0)) return
  const horiz = Math.hypot(aim.x, aim.z)
  // 【已經鉛直：方位沒有定義】與 `applyPitchBias` 走同一條退化路徑
  if (horiz < 1e-9) return
  const w = weight > 1 ? 1 : weight
  let next = Math.atan2(aim.y, horiz)
  next += w * (pitch - next)
  if (next > PITCH_BIAS_LIMIT) next = PITCH_BIAS_LIMIT
  else if (next < -PITCH_BIAS_LIMIT) next = -PITCH_BIAS_LIMIT
  const scale = Math.cos(next) / horiz
  aim.set(aim.x * scale, Math.sin(next), aim.z * scale)
}

/** 夾到 [−1, 1]。浮點誤差會讓點積跑出範圍，acos 於是回傳 NaN。 */
function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x
}

/**
 * 由意圖與幾何模式產生完整的轉向指令：`aimWorld`、`throttle`、`brake`。
 *
 * **不動 `firing`** —— 開火紀律是獨立的一層（`fire.ts`），因為「瞄得對」
 * 與「該不該扣扳機」是兩個不同的判斷：進場途中瞄準點是對的，但距離還
 * 遠到不該浪費彈幕。
 */
export function steerCommand(
  intent: Intent,
  mode: SteerMode,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  /** 該點的海面（未來為地表）高度，m。`extend` 的俯仰用它算離地餘裕 */
  seaHeight: number,
  k: Knobs,
  /** 破防狀態。由 `stepDefend` 每步維護 */
  defend: DefendState,
  /**
   * 指揮層的集合點；`null` = 沒有命令。
   *
   * 【為什麼是參數而不是從 `sit` 拿】`Situation` 是**態勢**（我與目標的
   * 幾何與能量），集合點是**命令**。混進去會讓 `assess.ts` 得知道有指揮層
   * 這回事，而它現在完全不需要知道。與 `defend: DefendState` 同一個理由：
   * 額外的狀態走參數，不塞進態勢。
   */
  rallyPoint: Vector3 | null,
  out: Command,
  cfg: SteerConfig = DEFAULT_STEER,
  /**
   * 「機頭追不上預瞄點，改為佈局下一次機會」。由 `stepTrack` 維護的閂鎖，
   * 呼叫端傳 `track.latched`。
   *
   * 【為什麼傳布林而不是 `TrackState`】這一層需要的是**決定**不是狀態；
   * 狀態的持有者是 `AiController`，與 `DefendState` 由 `stepDefend` 維護
   * 同一個道理。
   *
   * 【為什麼在最尾端】`steerCommand` 有 59 個呼叫點。插在中間會動到每一個，
   * 而那些呼叫點與本機制無關。預設 `false` = 既有行為逐位元不變。
   */
  repositioning = false,
  /**
   * 空層鎖。`null` = 沒有這一層（既有行為逐位元不變）。
   *
   * 【為什麼傳狀態物件而不是兩個數字】`kind` 只為量測與 HUD 存在，但它
   * 與 `altitude`、`hold` 是同一次決定的三個面向；拆開傳等於讓呼叫端有機會
   * 把三者配成不一致的組合。
   */
  band: BandState | null = null,
): void {
  // ── 瞄準點 ──────────────────────────────────────────────
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
    out.aimWorld.copy(basis.losAxis)
  } else if (mode === 'speedRecover') {
    // 【主動壓機頭】不是「沿著現在的速度向量飛」—— 在自己已經吊上去時，
    // 那個向量正指著天空，命令沿著它飛等於命令繼續爬（spec §5.1）。
    unloadAim(self, -cfg.speedRecoverPitch, out.aimWorld)
  } else if (mode === 'overshoot') {
    // 後置 + 高 yo-yo。engageKnobs 在這個態勢下本來就會給負的 leadLag 與
    // 正的 vertical，這裡強制到底，因為超前是要立刻解決的。
    aimFromKnobs(basis, sit, OVERSHOOT_KNOBS, out.aimWorld, cfg)
  } else {
    switch (intent) {
      case 'engage':
        // 【追不上就改為佈局】見 `repositionKnobs`。幾何閘門（上面的 mode
        // 分支）壓過這裡 —— 撞上去、失速、沒空速都比佈局急。
        if (repositioning) {
          repositionKnobs(sit, RK, cfg)
          aimFromKnobs(basis, sit, RK, out.aimWorld, cfg)
        } else {
          aimFromKnobs(basis, sit, k, out.aimWorld, cfg)
        }
        break
      case 'extend': {
        // 【卸載】把瞄準點放到自身速度向量上，指揮儀就沒有轉向需求，
        // 過載趨近 1 G、誘導阻力最小 —— 這是能量重整的核心手段
        // （spec §4.4：這是 aimWorld 介面唯一能表達的卸載近似）。
        // 俯仰由速度赤字與離地餘裕連續決定（見 extendPitchAngle）。
        const clearance = self.state.position.y - seaHeight
        let pitch = extendPitchAngle(sit.cornerRatio, sit.altitudeAdvantage, clearance, cfg)
        // 【規則 3 的俯衝】目標速度還沒到就以 `divePitch` 俯衝。離地餘裕仍然
        // 蓋在上面：cornerRatio = 1 讓速度項歸零、高度差傳 −Infinity 被
        // isFinite 擋掉，剩下的就是離地項 —— 它為正時貼海不俯衝。
        let diving = false
        if (k.diveIas > 0) {
          const ias = self.diag.aero.tas * Math.sqrt(self.diag.air.sigma)
          if (ias < k.diveIas) {
            const floor = extendPitchAngle(1, -Infinity, clearance, cfg)
            if (floor > 0) pitch = floor
            else { pitch = -cfg.divePitch; diving = true }
          }
        }
        unloadAim(self, pitch, out.aimWorld)
        // 【回場方向】卸載保住了「不轉向」，代價是脫離時機頭朝哪就一路朝哪
        // 飛到出場 —— 剛 merge 完就正對著敵人直直飛（人工回報）。往錨點偏
        // 一個**有上限**的角度：誤差角的大小決定拉多少 G，上限因此直接是
        // 能量損失的上限（見 `SteerConfig.extendTurnCap`）。
        //
        // 【俯衝中不偏】俯衝要的是最短時間換到速度，往錨點偏是在對追擊者
        // 畫弧、把速度花在轉彎上。俯衝有 `trackDiveMax` 兜底，不會直飛到天邊。
        //
        // 【錨點是當前目標】`losAxis` 由 `buildEngageBasis` 對攻擊目標建立。
        // 【錨點取敵人不取被保護單位】要的是「朝向敵人」，而且敵人每一格都
        // 有 —— 編隊形心會在一架陣亡時跳半個間距（spec §9.5）。
        if (!diving) {
          rotateHeading(
            out.aimWorld,
            extendHeadingBias(
              defend.extendSide, headingErrorTo(self, basis.losAxis), sit.range,
              sit.cornerRatio, cfg,
            ),
          )
        }
        break
      }
      case 'defend':
        // 【反轉讓位給破防的相反動作】他衝過頭之後，「轉開」把剛用高度與
        // 速度換來的機會丟掉。倒數期間改成對他的追擊解 —— 轉進去。
        if (defend.reversal > 0 && defend.attacker !== null) {
          reversalAim(self, defend.attacker, out.aimWorld)
        } else {
          defendAim(self, sit.threatLos, defend.axisSign, out.aimWorld, cfg)
        }
        break
      case 'rally':
        // 【指揮層的集合點】它不由 arbitrate 產生（見 rules.ts 的 Intent
        // 註解），所以這一格必然來自 AiController 的覆寫。
        //
        // 【null 時退化成機首】兩條路徑理論上不會不同步，但一個沉默地沿用
        // 前一格 aimWorld 的分支是查不出來的 bug。
        if (rallyPoint !== null) rallyAim(self, rallyPoint, out.aimWorld)
        else out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        break
      case 'approach':
        // 【這一格不可以退回純預瞄追擊】問題窗裡它佔 53.2% —— 交會之後一路
        // 追著預瞄點往下繞的就是這一格。
        if (repositioning) {
          repositionKnobs(sit, RK, cfg)
          aimFromKnobs(basis, sit, RK, out.aimWorld, cfg)
        } else {
          normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        }
        break
      case 'merge':
        // 【merge 不套佈局】它管交會的那 2.5 秒，要的是乾淨的預瞄追擊、
        // 拿一次正面快照。見 `engageKnobs` 的註解。
        normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        break
    }
  }

  // ── 空層鎖（上半）：方位的夾持 ──────────────────────────
  //
  // 【為什麼只有攻擊意圖】`extend` 的俰仰已經由 `extendPitchAngle` 完整回答
  // （速度不足就低頭、比敵人低就抬頭），`defend` 的由破防軋決定，
  // `rally` 是指揮層的命令。鎖上去只會跟這三層打架。
  //
  // 【為什麼 `speedRecover` 要例外】那個模式正在**主動壓機頭 20° 換速度**，
  // 而一個鎖在平飛的航跡角正好把它抵消到一格不剩 —— 沒空速比掉高度嚴重。
  // 這與它在 `geometryGate` 裡壓過 `unload` 是同一條優先序。
  if (
    band !== null && band.kind !== 'off' && mode !== 'speedRecover'
    && (intent === 'engage' || intent === 'approach' || intent === 'merge')
  ) {
    // 【上限隨 `hold` 從 π 收下來】`hold = 0` 時上限是 π，也就是完全沒有這一層。
    // 中間連續 —— 與這個檔案裡其他每一層同一條原則：不要有翻轉點。
    //
    // 【保持不了高度就收坡度】只壓瞄準點的俯仰擋不住下沉：指揮儀是
    // bank-to-turn，75° 的轉向誤差會讓它掛在 85° 坡度硬轉，升力全在水平面
    // 上，實測整段以 −18° 航跡角下沉、掉 270 m 才穩住。飛行員的做法是**收
    // 坡度換升力** —— 掉出帶越多，轉向上限收得越小（滿偏時砍半），指揮儀
    // 自然放平一點、把高度接回來；回到帶內上限自動放回去。
    const e = bandError(band.altitude - self.state.position.y, cfg)
    const capBase = cfg.bandTurnCap * (1 - 0.5 * Math.abs(e))
    const cap = capBase + (Math.PI - capBase) * (1 - band.hold)
    const err = headingErrorTo(self, out.aimWorld)
    // 【正後方走記住的側】死區裡 `err` 的符號是浮點雜訊，見 `BandState.side`
    if (Math.abs(err) > Math.PI - EXTEND_SIDE_HOLD) {
      rotateHeading(out.aimWorld, band.side * cap - err)
    } else if (err > cap) rotateHeading(out.aimWorld, cap - err)
    else if (err < -cap) rotateHeading(out.aimWorld, -cap - err)
  }

  // 【它必須排在卸載之前】這一層在**塑形瞄準點**（方位夾到上限、俯仰鎖到
  // 帶上），卸載與拉桿紀律在決定**對這個瞄準點拉多少**。反過來的話，紀律層
  // 先把 176° 的誤差縮到機首旁邊，這一層就看不到任何水平誤差可夾 —— 實測
  // 正是那個順序讓面對面交會後直飛了 18 秒。
  // ── 卸載：拉太猛時把誤差角收小，方位不動 ────────────────
  // 【為什麼是後處理而不是 if-else 的一支】卸載不是「改去指別的地方」，
  // 是「照原來的方位，但少拉一點」。寫成獨立的一支就得自己決定要指哪裡，
  // 而瞄準速度向量的寫法會製造橫向誤差、害飛機每 0.1 秒抖一下。當成係數
  // 套在既有指令上，方位天然保持不變。
  //
  // 【`unload` 的拉桿上限有兩個來源，取較小值】
  //   unloadPull(stallMargin)  防**失速**（迎角太大）—— 只在 `unload` 這個
  //                            幾何下有意義，那是 `geometryGate` 判出來的
  //   sit.pullCeiling          防**能量見底**（速度太低）—— 任何幾何下都要
  //                            生效，因為 AI 把自己拉爆不限於 `unload`
  //
  // 【為什麼能量那一層不能只掛在 `unload` 上】迴轉半徑一動，被敵機咬在正
  // 後方 400 m 時挨打的時間變成六倍，而那時的 mode 大多不是 `unload` ——
  // 只掛在 `unload` 上的紀律看不到它。見 `ai/doctrine.ts` 的 `energyPull`。
  //
  // 【`overshoot` 與 `speedRecover` 仍然不套失速那一層】它們的優先序高於
  // `unload`（見 `geometryGate`），拿到那兩個 mode 時 `mode !== 'unload'`。
  // 但**能量那一層照套** —— 它們同樣會把速度拉光。
  // 【不要在這裡加「先滾轉再拉」層】那種層在「升力與修正方向相反」時把
  // 拉桿收到 0.25，但 `shrinkTowardNose` 縮的是誤差角，而滾轉率上限正比於
  // 誤差角（`rollRateErrorSlope`）—— 換邊的滾轉會被一起掐慢，看起來就是
  // 「敵機飛到右舷很久才開始右轉」。它要防的倒飛拉升由空層鎖的俯仰段
  // （排在偏置之後、滿權威）接住，倒飛開局的最低點 −239 m、重新對上 12 s。
  const stallPull = mode === 'unload' ? unloadPull(sit.stallMargin, cfg) : 1
  const pull = stallPull < sit.pullCeiling ? stallPull : sit.pullCeiling
  shrinkTowardNose(self, pull, out.aimWorld)

  // ── 甜蜜區：把航跡角偏向自己佔優的高度／速度，方位不動 ──
  // 【為什麼 rally 排除】指揮層的位階比戰術偏好高。「我想飛高一點」不該
  // 蓋過「去那個點集合」。拉桿紀律則相反，連早退路徑都涵蓋 —— 沒有任何
  // 命令的內容是「把自己拉爆」。見 spec §4.4。
  //
  // 【讓位給射擊解】「我想把仗帶到我的甜蜜區」不該蓋過「射擊解已經到手
  // 了」。109 在 500 km/h 的偏置是 +10°，機首因此穩定停在目標線上方 10°，
  // 而開火錐只有 3° —— 結構上開不了火。見 `sweetYield` 與
  // `SteerConfig.sweetYieldTime`。
  //
  // 【為什麼 defend 不讓位】`basis` 永遠對**攻擊目標**建立
  // （`AiController.ts:332`），而 `defend` 是對**威脅來源**做的（`defendAim`
  // 讀 `sit.threatLos`），兩者可以是不同的飛機。對 defend 套讓位會變成
  // 「我正在閃 A，但要不要讓位由我能不能射中 B 決定」—— 無意義的耦合。
  // 排除之後 defend 的行為逐位元不變。要正確地讓位需要對威脅來源另建一組
  // `EngageBasis`，那要動 `AiController`，列為未解（spec §7.3）。
  if (intent !== 'rally') {
    const yieldFactor = intent === 'defend' ? 1 : sweetYield(basis.interceptTime, cfg)
    // 【兩個偏置共用同一個讓位係數】它們是同一個位階的東西（都在改瞄準點的
    // 俯仰、都不看有沒有射擊解），所以有射擊解時要一起收手 —— 否則機首會
    // 穩定停在目標線上方，結構上開不了火。
    //
    // 【為什麼相加而不是二選一】`sweetPitch` 問「我的速度離最佳點多遠」、
    // `turnPitch` 問「這個彎往哪邊轉划算」。兩者可以同時成立，也可以互相
    // 抵銷。出貨值目前 `sweetSpotMaxPitch = 0`，所以實際上只有後者在作用。
    applyPitchBias((sit.sweetPitch + sit.turnPitch) * yieldFactor, out.aimWorld)
  }

  // ── 空層鎖（下半）：俯仰的定案 ──────────────────────────
  //
  // 【為什麼與方位夾持分開、而且排在甜蜜區之後】「鎖上時航跡角它說了算」
  // 必須落在字面上。俯仰鎖若跟方位一起放在卸載之前，倒飛開局 t=2 的指令
  // 會是 −19°：band 命令平飛之後，`shrinkTowardNose` 把瞄準點往（正在下沉
  // 的）機首拖、`turnPitch` 再疊 −10° —— 鎖形同虛設。放在這裡，甜蜜區與
  // 迴轉平面的偏置在鎖定期間自然被蓋掉，順帶補足甜蜜點偏移；`hold` 淡出
  // 時它們平滑回來。
  //
  // 真正的撞地判斷由 `AiController.emit` 最後執行的同步護欄與物理 Worker
  // 負責；這裡只處理戰術空層，不按離地高度改寫目標方向。
  //
  // 【回升的權威乘上卸載的拉桿係數】回升要的是陡拉（`bandRegainPitch`），而它
  // 排在卸載之後、滿權威覆寫 —— 不乘的話 `unload` 剛把拉桿收掉（失速餘裕見底），
  // 這裡又把 +35° 加回去，安全層也不會補救（空速還在 1 G 失速速度之上）。
  // 只乘失速那一項，不乘能量紀律（`pullCeiling`）：回升本來就是把速度換成高度，
  // 速度掉到角落速度以下是預期中的事，乘了會在爬到那一層之前就停住
  if (
    band !== null && band.kind !== 'off' && mode !== 'speedRecover'
    && (intent === 'engage' || intent === 'approach' || intent === 'merge')
  ) {
    const regain = band.kind === 'regain'
    applyPitchToward(
      bandError(band.altitude - self.state.position.y, cfg)
        * (regain ? cfg.bandRegainPitch : cfg.bandMaxPitch),
      regain ? band.hold * stallPull : band.hold, out.aimWorld,
    )
  }

  // ── 油門與減速（spec §7.4）────────────────────────────
  //
  // 【`overshoot` 不可以有自己的一支油門／減速板】`throttle = THROTTLE_FLOOR`
  // + `brake = 1` 會讓後置、高 yo-yo、減速三者同時消耗能量。它的觸發條件
  // **純幾何**：`geometryGate` 只看
  // `range < overshootRange && closureRate > 0`，一個字都沒問「我還有速度
  // 嗎」，而它的優先序又是最高的，所以「我沒速度了該壓機頭」的
  // `speedRecover` 在同一個態勢下永遠輪不到。
  //
  // 實測（`stall-loop-trace.probe.ts`）：525 km/h 掉到 149 km/h 同時爬升
  // 700 m，安全層在壓機頭而瞄準點層還在拉 —— 兩層互相打架。進入
  // `overshoot` 的取樣有 73~88% 本來就已經低於角落速度，也就是它專挑
  // 最不該減速的時候減速。
  //
  // 現在只留**幾何**手段（瞄準點的後置與高 yo-yo，見上面的分支），能量
  // 交給下面這條既有的角落速度判準：真的超速才減速，低於角落速度時一點
  // 都不減。「衝過頭」在低速時本來就不成立 —— 低速的飛機追不上任何人。
  if (sit.cornerRatio > cfg.brakeCornerRatio) {
    // 【判準是角落速度不是 VNE】limits.vne 在整個 src/ 裡沒有任何程式碼
    // 消費它——超速在本模型沒有後果，拿它當判準是死碼。速度遠高於角落
    // 速度則是模型真的模擬的代價：轉彎半徑 ∝ V²，而且高速舵面變重。
    out.throttle = WEP_THROTTLE
    out.brake = Math.min(1, sit.cornerRatio - cfg.brakeCornerRatio)
  } else {
    out.throttle = WEP_THROTTLE
    out.brake = 0
  }
}

/**
 * 瞄準自身速度向量，可加上一個俯仰偏置。`pitch > 0` 為爬升。
 *
 * `pitch` 是**相對地平線的航跡角**，不是相對當前速度向量的增量：維持航向，
 * 把航跡角設成 `pitch`。
 *
 * 【為什麼不能寫成 `v.y += tan(pitch)`】那個寫法把偏置加在**當前**速度向量
 * 上，而飛機會追上去 —— 下一格再從轉過的新方向加一次，指令角度於是每格
 * 滾雪球。人工驗收實測：`extend` 一啟動，瞄準仰角 4 秒內由 −27° 跑到 −56°
 * （垂直俯衝）；能量差翻負後改成爬升偏置，7 秒內由 +16° 跑到 +85°，TAS 由
 * 688 掉到 498 km/h —— 那正是「AI 自己吊到失速」的來源。
 *
 * 航跡角必須相對地平線定義，才會是一個**穩定的**目標而不是會跑掉的增量。
 */
function unloadAim(self: Aircraft, pitch: number, out: Vector3): void {
  const v = C.v[0]!.copy(self.state.velocity)
  const speed = v.length()
  if (speed > 1e-3) v.divideScalar(speed)
  else v.copy(FWD).applyQuaternion(self.state.orientation)

  if (pitch === 0) {
    out.copy(v)
    return
  }

  // 維持航向、把航跡角設成 pitch。水平分量退化（已經垂直）時航向沒有定義，
  // 改用機首的水平投影；兩者都退化就直接沿用速度向量。
  let hx = v.x
  let hz = v.z
  let h = Math.hypot(hx, hz)
  if (h < 1e-6) {
    const nose = C.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
    hx = nose.x
    hz = nose.z
    h = Math.hypot(hx, hz)
    if (h < 1e-6) {
      out.copy(v)
      return
    }
  }
  const c = Math.cos(pitch) / h
  out.set(hx * c, Math.sin(pitch), hz * c)
}

const D = makeScratch(4)

/**
 * 破防：由**威脅來源**的視線轉開一個大角度。
 *
 * 目的是**破壞他的預瞄解**，不是逃跑——逃跑會把尾巴一直送給他。
 *
 * 【對準的是威脅來源，不是當前目標】它吃 `Situation.threatLos`（由
 * AiController 掃全場填），**不可以改吃 `EngageBasis`** —— 那是對**當前
 * 目標**建的，而 20v20 實測長機被鎖定時 **97.8% 的鎖定來自不是它目標的
 * 敵機**，拿目標的視線去破防，破的是錯的人。
 *
 * 【轉開的角度相對視線量，不是相對機首的增量】所以它是一個固定的幾何目標，
 * 轉彎中不會每格滾雪球。
 *
 * ## 破防軸：世界水平面抬 `defendTilt`
 *
 * 軸取 `UP × threatLos` 正規化後往上抬 `defendTilt`。世界水平面不跟著飛機
 * 滾，所以破防維持在同一個平面上：位移 11.5°、玩家打得中 2.4%、最低高度
 * 零損失、收尾 TAS 123。
 *
 * 【軸不可以取自升力向量】升力向量跟著滾轉走，飛機一開始破防就會滾，滾了
 * 之後軸轉到別的地方 —— 破防於是不是一個持續的硬彎，是一個**方向一直飄的
 * 螺旋**，坡度常駐 ±150~180°（倒飛）。三個後果同時發生：視覺上跟「不閃」
 * 幾乎沒差別（1.8° 對 0.9°）、破壞不掉射擊解（玩家 77.1% 的時間仍打得
 * 中）、能量被榨乾（收尾 TAS 84）。
 *
 * 【退化】`threatLos` 平行於世界鉛直時 `UP × threatLos` 趨近 0，此時退到
 * 升力軸；升力與視線平行時再退到機體橫軸。兩者恆正交，所以不可能同時
 * 退化。
 *
 * `|升力⊥|² = 1 − a²`、`|橫軸⊥|² = 1 − b²`，而 `a² + b² ≤ 1`（a、b 是兩者
 * 與視線的餘弦）。`a` 趨近 ±1 時 `b` 必然趨近 0，橫軸的垂直分量反而趨近
 * 滿額。永遠有一側可選。
 *
 * @param sign 左右號誌 +1 / −1，由 `stepDefend` 在進入破防時決定一次。
 *             0 視同 +1（呼叫端不該傳 0，但傳了也要有定義的行為）。
 */
export function defendAim(
  self: Aircraft,
  threatLos: Vector3,
  sign: number,
  out: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // 【視線鉛直時沒有抬角】下面兩條退化路徑（視線鉛直、以及視線鉛直且升力
  // 平行視線）**一個字都沒用到 `cfg.defendTilt`**。而那個抬角是閃躲動作
  // 本身的一部分（見 spec §7），所以「鉛直威脅下閃躲會變弱」是一個已知的
  // 缺口 —— 目前沒有實測支持要補它。
  const axis = D.v[0]!
  const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)

  // ── 首選：世界水平面內、垂直於視線 ──────────────────
  const horiz = D.v[3]!.copy(UP).cross(threatLos)
  if (horiz.length() >= AXIS_EPSILON) {
    horiz.normalize()
    if (sign < 0) horiz.multiplyScalar(-1)
    // 視線垂面內指天的方向。抬角在定號**之後**才套，所以永遠朝天
    const up = D.v[2]!.copy(UP).addScaledVector(threatLos, -UP.dot(threatLos))
    const upLen = up.length()
    if (upLen > 1e-6) {
      up.divideScalar(upLen)
      axis.copy(horiz).multiplyScalar(Math.cos(cfg.defendTilt))
        .addScaledVector(up, Math.sin(cfg.defendTilt))
    } else {
      axis.copy(horiz)
    }
  } else if (perpendicular(lift, threatLos, axis) < AXIS_EPSILON) {
    // 視線鉛直 **且** 升力平行視線 —— 此時機體橫軸必然垂直於視線
    const right = D.v[2]!.set(1, 0, 0).applyQuaternion(self.state.orientation)
    if (perpendicular(right, threatLos, axis) < AXIS_EPSILON) {
      // 數學上到不了，但浮點世界留一條退路：任何非平行的方向都比「指著他」好
      out.copy(threatLos)
      return
    }
  }

  out.copy(threatLos).multiplyScalar(Math.cos(cfg.defendOffset))
    .addScaledVector(axis, Math.sin(cfg.defendOffset))
    .normalize()
}

/**
 * 反轉的瞄準點：對攻擊者的**追擊解**。
 *
 * 【為什麼是預瞄解而不是直接指著他】反轉的目的是攻守易位，而攻擊的瞄準點
 * 一向是預瞄點（見 `buildEngageBasis`）。指著他本人在有相對速度時打不中，
 * 而反轉發生的時候相對速度正是最大的。
 *
 * 退化（無解、重合）時指向他的位置 —— 那至少是一個有定義的方向。
 */
function reversalAim(self: Aircraft, attacker: Aircraft, out: Vector3): void {
  const p = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
  const v = D.v[1]!.copy(attacker.state.velocity).sub(self.state.velocity)
  const lead = D.v[2]!
  const t = solveLead(p, v, self.spec.battery.sight.muzzleVelocity, lead)
  if (t === NO_INTERCEPT) {
    normalizeInto(p, FWD, out)
    return
  }
  out.copy(lead)
}

/** 正規化 v 寫入 out；退化時用 fallback。 */
function normalizeInto(v: Vector3, fallback: Vector3, out: Vector3): void {
  const len = v.length()
  if (len > 1e-6) out.copy(v).divideScalar(len)
  else out.copy(fallback)
}
