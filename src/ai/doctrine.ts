/**
 * 機體對這場仗的偏好。兩個彼此獨立的量：
 *
 *   energyPull      絕對，不需要對手 —— 不要把自己拉到掉出可用包絡
 *   sweetSpotPitch  相對，需要對手   —— 把航跡角偏向自己佔優的高度／速度
 *
 * 【為什麼分開】鏡像對戰（同機種）時甜蜜區處處為 0。若把紀律綁在甜蜜區上，
 * 同機種對打會完全失去紀律 —— 而 `ai-duel-matrix` 留紅的那一場正是
 * P-51 對 P-51。見 spec §3.3。
 *
 * 本模組**不 import 任何 AI 狀態**，只吃 spec 與純量，所以整支可以在單元
 * 測試裡直接算。
 */
import {
  instantaneousTurnRate, specificExcessPower, stallSpeed, sustainedTurnRate,
} from '../analysis/envelope'
import { G0 } from '../core/math'
import type { AircraftSpec } from '../specs/types'

export interface DoctrineConfig {
  /**
   * **AI 的能量比值用哪個過載當參考。** `spec.limits.gPositive` 的倍率，
   * 1.0 = 結構極限本身。
   *
   * ---
   *
   * 【為什麼這個數字存在】`cornerRatio` 是幾乎所有 AI 能量判準的分母：
   *
   * ```
   *   rules.ts    cornerEnter / cornerExit      要不要放棄追擊
   *   doctrine.ts energyFloorRatio              拉桿上限
   *   steer.ts    brakeCornerRatio              要不要減速
   *   steer.ts    extendPitchAngle 的速度增益   低頭換速的量
   *   command.ts  spentRatio / ENGAGED_RATIO    指揮層的「見底」與「已交戰」
   * ```
   *
   * 沒有這個倍率時分母是 `cornerSpeed = stallSpeed(spec, alt, gPositive)` ——
   * 「拉得出**結構極限 8 G** 的最低速度」。空戰實際用的是 3~5 G，所以那個
   * 分母系統性偏高：5000 m 是 473 km/h，而實測交戰速度帶是 250~470。
   * **AI 因此幾乎永遠覺得自己沒能量。**
   *
   * 【為什麼是倍率而不是絕對 G 值】機種的結構極限不同（P-51 是 8）。寫成
   * 倍率，兩台飛機之間的相對關係不變，而 1.0 是一個**精確的恆等基準** ——
   * 重構有沒有改到行為，用它一跑就知道。
   *
   * 【為什麼不改 `cornerSpeed` 本身】那是教科書定義（CLmax ∩ 結構極限），
   * `historical.test.ts` 與 EM 圖工具都靠它。政策參數放在 doctrine，物理
   * 留在 `analysis/envelope.ts` —— 這與 `specs/feel.ts` 把「史實的飛機」與
   * 「玩起來的飛機」分兩層是同一條界線。
   *
   * 【`safety.ts` 刻意不跟】那裡的 `cornerSpeed` 判的是「速度快到拉不起來」
   * —— 拉起半徑 ∝ V²，那是**物理**，不是戰術偏好。
   *
   * ---
   *
   * # 掃描：**出貨值維持 1.0**
   *
   * 20v20、300 秒、VETERAN、兩個開局（`manoeuvre-g.probe.ts`）：
   *
   * ```
   * 倍率(=幾G)   extend  engage  安全層   TAS   傷害   額外紅燈
   *  1.000(8.0)  34.8%   11.4%   0.20%   444   3662    —（基準）
   *  0.850(6.8)  36.4%   11.2%   0.45%   428   4190    1
   *  0.750(6.0)  35.0%   11.3%   0.74%   423   5457    2
   *  0.625(5.0)  32.7%   12.1%   0.61%   412   6203    7
   *  0.500(4.0)  32.9%   12.0%   0.81%   405   6640    —（未跑全套）
   * ```
   *
   * ## 一起平移確實避開了上一次的失敗模式
   *
   * 只搬 `cornerEnter`（`rules.ts` 的註解）時安全層佔時衝到 65.6%。這一次
   * 一起平移，安全層最高只到 0.81% —— **「兩邊打架」的診斷是對的**。
   *
   * ## 但 0.625 的「傷害 +69%」是假的
   *
   * 全套回歸在 0.625 下由 4 紅變 11 紅，其中三條是
   * `expected 0 to be greater than 0` —— **指揮層一張命令都沒發出來**。
   * 成因是 `command.ts` 的 `spentRatio`（0.6，「見底」門檻）也吃這個比值：
   * 平均 `cornerRatio` 由 0.94 升到 1.07 之後，**再也沒有分隊會被判見底**。
   *
   * 沒有撤退令，大家就不脫離、一路打到底 —— 傷害當然翻倍。那是**撤退機制
   * 被關掉**的副作用，不是空戰變好。同一組設定下另有一條硬失敗：
   * `低空纏鬥不會把自己飛進海裡` 由 0 變成 5566。
   *
   * ## 這次學到的東西
   *
   * 「換分母讓判準保持一致」這句話是**錯的**。換分母等於同時把**每一個**讀
   * 這個比值的門檻重新定值，包括那些本來就調對、不該動的：
   *
   * ```
   *   該動的   cornerEnter / cornerExit      「我還追不追得動」
   *   不該動的 spentRatio                    「指揮官認為誰該撤」
   *   不該動的 brakeCornerRatio              「我快到轉不動了」
   *   不該動的 energyFloorRatio              「我不能再拉了」
   * ```
   *
   * 真要做，得在換分母的同時把「不該動的」那幾個按 `1 / fraction` 反向
   * 補回去，只讓想動的那幾個真的動 —— 而那在數學上就等於直接調那幾個門檻。
   * **這條路要通，需要的是一份新設計，不是一個倍率。**
   *
   * ## 為什麼這個參數留著
   *
   * 值是 1.0，是恆等，不花任何代價。它把「AI 用哪個過載當參考」這個
   * **否則會隱含在 `cornerSpeed` 裡的政策決定**變成一個有名字、有掃描表的
   * 旋鈕。
   */
  manoeuvreGFraction: number
  /**
   * `cornerRatio` 高於此值時拉桿完全放行。1.0 = 角落速度。
   *
   * 【為什麼放行點就是角落速度】高於它時拉滿是**對的** —— 那正是這台飛機
   * 能拉出最大轉彎率的區域，而且是它贏的地方。拉桿紀律要擋的不是「用力
   * 轉彎」，是「在已經沒有速度的地方繼續用力」。
   */
  energyFreeRatio: number
  /** `cornerRatio` 低於此值時夾到 `energyMinPull` */
  energyFloorRatio: number
  /**
   * 見底時仍然允許的拉桿係數。**不得為 0** —— 完全鬆桿的 AI 是靶子。
   *
   * 【0.35 也已經在靶子區】起手值取 0.35，實測讓 `ai-defence` 後下方 400 m
   * 的藍方掉血由 0 惡化到 605。這個下限直接決定「能量見底時還轉不轉得動
   * 機首」，太低時 AI 拉不出足夠的角速度，破不了對方的追蹤解。
   */
  energyMinPull: number
  /**
   * 甜蜜區俯仰偏置的上界，rad。**目前是 0 —— 這一層關著。**
   *
   * 【為什麼關掉】它與「迴轉候選的選擇」在講同一件事（速度離最佳點多遠、
   * 該用高度換速度還是反過來），而後者算得更完整：它連「轉完之後相對敵人
   * 的能量位置」都算進去。兩層同時作用會讓量測分不清是誰的功勞。
   *
   * 實測 109 對 P-51 在 3400 m：120~188 m/s 全段給 +8.7°~+10°（抬頭），
   * 也就是幾乎一直在作用 —— 那正是「遠距離會往敵人頭上補仰角」的來源。
   *
   * 【為什麼一定要有上界】偏置與意圖是疊加的。無上界時 AI 會為了顧自己的
   * 框而把機首帶離敵人 —— 症狀會先出現在 `ai-targeting` 的 `onNose`。
   */
  sweetSpotMaxPitch: number
  /**
   * 優勢達到多少（rad/s）就給滿上界的偏置。
   *
   * 【0.05 的來歷】`rules.ts` 的 `turnEnter` 是 0.02 rad/s，那是「這台飛機
   * 真的轉不贏他」的界線。取它的 2.5 倍當作「差距大到值得整個航跡去遷就」。
   */
  sweetSpotFullAt: number
  /**
   * 迴轉平面偏置的上界，rad。**`0` 關掉整個機制。**
   *
   * 【它在回答什麼】敵人在機鼻夾角很大的地方時，「轉過去」有三種走法 ——
   * 俯衝迴旋、水平迴旋、拉高迴旋。三者的終點相同（機鼻對上預瞄點），差別
   * 只在**路上付掉多少能量、轉完之後我相對他站在哪**。這個偏置就是把選出
   * 來的那一個表達成瞄準點的俯仰偏移。
   *
   * 【為什麼與 `sweetSpotMaxPitch` 是兩件事】那一個只看速度離最佳點多遠，
   * 不看敵人在哪、不看要轉多少度。這一個把**角度**算進去 —— 實測 t=38 s
   * 敵人在機體仰角 +86°（座艙罩正上方）而舊判準說「追得上」，差別就在這裡。
   */
  turnPlaneMaxPitch: number
  /**
   * 最好與次好的候選差多少公尺的能量高度，就給滿上界。
   *
   * 【為什麼用「差距」當強度】三個候選差不多的時候本來就不該動作 —— 實測
   * 機鼻夾角 15° 以內三者的差距中位數是 **0 公尺**，45~60° 才到 46~160 m。
   * 用差距當強度，這一層在小角度時自動安靜，**不需要任何角度門檻**。
   */
  turnPlaneFullAt: number
  /**
   * 三個候選各自的航跡角，rad。俯衝取負、水平 0、拉高取正。
   *
   * 【為什麼是固定角而不是掃描】它定義的是「哪三個走法」，不是可調的力道；
   * 力道由 `turnPlaneMaxPitch` 管。真正的高 yo-yo 是「拉起、轉、再下來」，
   * 固定航跡角是為了讓三者有可比的封閉形式 —— 它算得出「轉過去要多久、付
   * 多少能量」，算不出「轉完機頭正好指著哪」。
   */
  turnPlaneGamma: number
  /**
   * 想要比敵人多出多少能量高度，m。分數是「離這個位置多遠」，不是「越高越好」。
   *
   * 【為什麼不是越高越好】那樣敵人的能量會變成三個候選的共同常數，比大小時
   * 直接消掉 —— 實測敵人在下方 0 m 與 3000 m 時偏置都是 3.4°，完全一樣。
   * 「除非敵人真的非常低才俯衝」這條就生不出來。
   *
   * 改成「離目標位置多遠」之後：敵人在下方很多時三個候選都**超過**目標，
   * 於是挑最低的那個（俯衝）；敵人同高時三個都不夠，挑最高的（拉高）。
   * 同一個算式，兩種行為，不需要另外寫例外。
   */
  turnPlaneMargin: number
  /**
   * 能量比較裡**動能**的權重，0..1。高度永遠全額。**1 = 物理帳（舊行為）。**
   *
   * 【為什麼高度為主是對的】比能量 Es = h + v²/2g 是無損交換下的守恆量，
   * 但這場模擬的交換**有損而且不對稱**：速度超過可持續極速的部分被阻力
   * 持續蒸發（實測 109 在 200 m/s 每秒漏 46 m 的能量高度），高度放著不會
   * 壞。「高度是存款，速度是零用錢」—— 拿面額計價的動能去比，會把對手
   * 俯衝逃跑的瞬時速度當成實力。
   *
   * 【純物理帳會出的荒謬案例】護送關交會後：109 在 P-51 **上方 1,052 m**，
   * 物理帳卻讀出 −95（對方帶著俯衝速度）→ 能量閂鎖把意圖鎖在 extend，
   * 109 對著正下方 600 m 的獵物平飛不理，畫面上是「進入射程也沒有低頭
   * 攻擊」。權重 0.1 時同一格帳面約 +950 —— 不觸發。
   *
   * **能量中高度占九成、速度占一成。**
   */
  kineticWeight: number
}

/**
 * 出貨值。
 *
 * `energyFreeRatio` 取 1.0（角落速度本身）；`energyFloorRatio` 取 0.70，比
 * `DEFAULT_STEER.cornerEnter`（0.75，`extend` 的觸發點）再低一點 —— 意思是
 * 「已經低到該脫離了，還要再低一截才動用強制卸載」，兩層不搶戲。
 *
 * ## `energyMinPull` 的掃描
 *
 * `ai-defence`，四種幾何，同一顆種子：
 *
 * | 值 | 正後方 400 掉血 | 後下方 400 掉血 | 後下方 目標穩定 |
 * |---|---|---|---|
 * | 0.35（起手） | 772 | **605** | 78.3% |
 * | 0.50 | 765 | **605** | 77.7% |
 * | **0.65（出貨）** | 763 | **0** | **100.0%** |
 * | 0.80 | 745 | 0 | 100.0% |
 * | 0.90 | 749 | 0 | 82.0% |
 * | 關閉本層 | 745 | 0 | 80.3% |
 *
 * 【0.35 與 0.50 的 605 逐位元相同，是本次診斷的關鍵線索】那代表該場景的
 * 藍機一直在 `energyFloorRatio` 以下 —— 拉桿係數恆等於下限本身，斜坡怎麼
 * 調都不影響。同一段掃描裡 `energyFloorRatio` 由 0.70 降到 0.50，605 一格
 * 不動，證實了同一件事。真正的旋鈕只有這一個。
 *
 * ## 為什麼不拿 `ai-targeting` 的 20v20 指標定值
 *
 * 那一組**解析不出這個尺度的改動**。用一個與打法無關的等量擾動（無條件把
 * 拉桿係數乘 0.99）跑同一場 20v20：
 *
 * | | rearShare（門檻 ≤0.35） | fireShare | holdMedian |
 * |---|---|---|---|
 * | 基準 | 0.3260 | 0.0417 | 1.400 |
 * | 無意義的 ×0.99 擾動 | **0.3640** | 0.0326 | 1.500 |
 * | 本層（minPull 0.65） | 0.3615 | 0.0295 | 1.400 |
 *
 * 無意義的擾動造成的偏移**比本功能還大**，而且一樣破門檻。掃描值對它也
 * 非單調（0.65 → 0.3615、0.75 → 0.3248、0.85 → 0.3089）。拿它定值等於
 * 擬合單一顆種子的軌跡發散。
 *
 * 同一支探針在 `ai-defence` 上是**解析得出來**的：×0.99 擾動下後下方 400 m
 * 的掉血是 0（與基準相同），而本層未修正時是 605。所以定值用它。
 */
export const DEFAULT_DOCTRINE: DoctrineConfig = {
  // 【1.0 = 恆等】0.85 / 0.75 / 0.625 都掃過，一個都不能用 —— 0.625 會讓
  // 指揮層一張命令都發不出來。掃描表見欄位註解
  manoeuvreGFraction: 1.0,
  energyFreeRatio: 1.0,
  energyFloorRatio: 0.70,
  energyMinPull: 0.65,
  sweetSpotMaxPitch: 0,
  sweetSpotFullAt: 0.05,
  turnPlaneMaxPitch: 10 * (Math.PI / 180),
  turnPlaneFullAt: 300,
  turnPlaneGamma: 30 * (Math.PI / 180),
  turnPlaneMargin: 500,
  kineticWeight: 0.1,
}

/**
 * **AI 的能量比值用的參考速度**，m/s。`cornerRatio` 的分母就是它。
 *
 * `manoeuvreGFraction = 1` 時它等於 `cornerSpeed`（`stallSpeed` 取
 * `gPositive`），所以那個值是一個精確的恆等基準。
 *
 * 【為什麼不是 `cornerSpeed` 的包裝】兩者的**語意不同**：`cornerSpeed` 回答
 * 「我從哪個速度開始拉得出結構極限」，這一個回答「我從哪個速度開始拉得出
 * **我實際會用的**過載」。前者是飛機的性質，後者是打法的選擇。名字分開，
 * 下一個人才不會把政策改到物理層去。
 *
 * 熱路徑：`stallSpeed` 每次呼叫都會算一次 `atmosphere`，與改動前相同 ——
 * 這個函數沒有讓既有的呼叫變貴。
 */
export function manoeuvreSpeed(
  spec: AircraftSpec, altitude: number, cfg: DoctrineConfig = DEFAULT_DOCTRINE,
): number {
  return stallSpeed(spec, altitude, spec.limits.gPositive * cfg.manoeuvreGFraction)
}

/**
 * 能量見底時的拉桿係數，0..1。1 = 照原樣拉、0 = 完全鬆桿。
 *
 * 【與 `steer.ts` 的 `unloadPull` 是同一族】兩者都回傳拉桿係數、都由
 * `shrinkTowardNose` 消費（方位不動）。差別只在觸發的物理：
 *
 *   unloadPull   看 stallMargin —— 防的是**失速**（迎角太大）
 *   energyPull   看 cornerRatio —— 防的是**能量見底**（速度太低）
 *
 * 消費端取兩者的較小值，所以兩層自然是「誰先擋住算誰的」。
 *
 * 【為什麼門檻退化時回傳 1 而不是 0】回傳 0 = 完全鬆桿。設定寫錯時讓 AI
 * 完全不能拉桿是災難性的失敗模式，而回傳 1 只是讓本層失效、退回既有行為。
 * 安全的方向是「這一層不生效」，不是「這一層把飛機鎖死」。
 *
 * @param cornerRatio `Situation.cornerRatio` = TAS ÷ 角落速度
 */
export function energyPull(cornerRatio: number, cfg: DoctrineConfig): number {
  const span = cfg.energyFreeRatio - cfg.energyFloorRatio
  if (!(span > 0)) return 1
  const t = (cornerRatio - cfg.energyFloorRatio) / span
  if (t >= 1) return 1
  if (t <= 0) return cfg.energyMinPull
  return cfg.energyMinPull + (1 - cfg.energyMinPull) * t
}

/**
 * 「在這個 (高度, 速度) 我贏得過他多少」，rad/s。正 = 我佔優。
 *
 * 【為什麼是持續迴旋率之差，而不是一個無因次分數】用既有單位才能直接與
 * `rules.ts` 的 `turnEnter`（0.02 rad/s）比較 —— 同一把尺，不必再發明一個
 * 標度。
 *
 * 【為什麼不含滾轉率】實測（`test/tools/advantage-map.probe.ts`）迴旋、能量、
 * 滾轉三個量的正負號只有 31/48（65%）一致，而 **P-51 的滾轉在任何速度、
 * 任何高度都贏**（連 300 km/h 都 +2.3°/s）。合進一個分數會把 109 的低速
 * 優勢洗掉，兩台又變成一樣。滾轉是「我能贏哪一種動作」，不是「我在哪裡
 * 打得好」—— 它屬於未來的機動層。
 *
 * 【兩台都撐不住時回傳 0】`sustainedTurnRate` 撐不住時回傳 0，兩個 0 相減
 * 得到 0 —— 那不是「打平」是「都不行」。回傳 0 剛好讓偏置歸零，等於這一層
 * 在該處不表態，那是正確的行為（誰也沒有優勢可言）。
 */
export function sweetSpotAdvantage(
  self: AircraftSpec,
  target: AircraftSpec,
  altitude: number,
  tas: number,
): number {
  return sustainedTurnRate(self, altitude, tas) - sustainedTurnRate(target, altitude, tas)
}

/**
 * 每個機種一張持續迴旋率表，`[高度格][速度格]`。**一次填滿，不惰性逐格填**
 * —— `envelope.ts` 的 `bestTurnTable` 註解記載逐格填會讓 AI 步的 p999 由
 * 217 µs 惡化到 3.8 ms。
 *
 * 【為什麼是「每機種一張」而不是「每機種對一張」】機種對的優勢是兩張表
 * 相減，逐格減比再存一份便宜，而且 N 個機種只要 N 張表而不是 N² 張。
 *
 * WeakMap 讓臨時的 spec 複本（消融測試、`applyFeel` 的產物）不會洩漏。
 */
const rateTables = new WeakMap<AircraftSpec, Float64Array>()

const RATE_ALT_STEP = 500
const RATE_ALT_CEIL = 14000
const RATE_ALT_SLOTS = RATE_ALT_CEIL / RATE_ALT_STEP + 1
/** 速度掃描下界，m/s（≈ 180 km/h）。低於此值兩台都已經在失速邊緣 */
const RATE_V_MIN = 50
const RATE_V_STEP = 5
/** 50 → 300 m/s ＝ 180 → 1080 km/h，覆蓋兩台的整個可用速度帶 */
const RATE_V_SLOTS = 51

function rateTable(spec: AircraftSpec): Float64Array {
  let table = rateTables.get(spec)
  if (table !== undefined) return table
  table = new Float64Array(RATE_ALT_SLOTS * RATE_V_SLOTS)
  for (let a = 0; a < RATE_ALT_SLOTS; a++) {
    for (let v = 0; v < RATE_V_SLOTS; v++) {
      table[a * RATE_V_SLOTS + v] =
        sustainedTurnRate(spec, a * RATE_ALT_STEP, RATE_V_MIN + v * RATE_V_STEP)
    }
  }
  rateTables.set(spec, table)
  return table
}

/**
 * 這個高度上，我的優勢最大的速度是多少（m/s）。
 *
 * 兩張表在**內插後的高度**上逐格相減再取極大 —— 先內插再比較，而不是在
 * 兩個高度格各取極大再內插那兩個速度：後者會在斷崖處把兩個相距很遠的
 * 最佳點平均成一個兩邊都不對的值。
 */
function bestAdvantageSpeed(self: AircraftSpec, target: AircraftSpec, altitude: number): number {
  const ts = rateTable(self)
  const tt = rateTable(target)
  const alt = altitude < 0 ? 0 : altitude > RATE_ALT_CEIL ? RATE_ALT_CEIL : altitude
  const x = alt / RATE_ALT_STEP
  const i = Math.floor(x)
  const j = i + 1 < RATE_ALT_SLOTS ? i + 1 : i
  const f = x - i
  let bestV = RATE_V_MIN
  let bestA = -Infinity
  for (let v = 0; v < RATE_V_SLOTS; v++) {
    const lo = i * RATE_V_SLOTS + v
    const hi = j * RATE_V_SLOTS + v
    const s = ts[lo]! + (ts[hi]! - ts[lo]!) * f
    const t = tt[lo]! + (tt[hi]! - tt[lo]!) * f
    const a = s - t
    if (a > bestA) { bestA = a; bestV = RATE_V_MIN + v * RATE_V_STEP }
  }
  return bestV
}

/**
 * 甜蜜區的航跡角偏置，rad。正 = 該抬頭（換高度、減速）、負 = 該低頭
 * （換速度、加速）。
 *
 * 【為什麼只用速度軸】俯仰的物理作用就是在高度與速度之間**交換**，不能
 * 同時增加兩者 —— 同時增加是油門的事，而 AI 平常就在 WEP。**只有一個俯仰
 * 偏置**：`dTas` 與 `dAlt` 兩個方向量會在「又低又慢」時互相打架而無解。
 *
 * 【方向怎麼定：全域最佳點，不是局部梯度】「看優勢對速度的偏導 `dA/dV`」
 * 這條路走不通。4000 m、P-51 對 109 的優勢曲線：
 *
 *   300 km/h −0.01801   350 −0.02063（局部最低）  360 −0.01534
 *   370 +0.00939（109 越過自己的角落速度，斷崖）  480 +0.05673
 *
 * 在 300 km/h 處局部斜率是**負的** —— 局部梯度會叫 P-51 減速，正好是它該做
 * 的相反。梯度不會被鼓包騙，但**會被斷崖騙**，因為真正的報酬在 60 km/h 之外。
 * 改成掃過整條速度軸取極大：「我這個高度上最好的速度在哪，比現在快還是慢」。
 *
 *   最佳速度 > 現在 → 低頭換速度 → 負的俯仰
 *   最佳速度 < 現在 → 抬頭換高度 → 正的俯仰
 *
 * 實測最佳速度（套 `GAME_FEEL`）：P-51 在 0／4000／8000 m 是 530／600／660
 * km/h，109 是 310／350／200 km/h —— 與史實打法一致（能量機保速、迴旋機減速）。
 *
 * 【大小怎麼定】用**優勢本身**的大小，不是「離最佳點多遠」。理由是距離的
 * 單位是速度、沒有既有的參照物，而優勢有（`turnEnter` = 0.02 rad/s）。
 * 差距越大越值得整個航跡去遷就。
 *
 * 【已經佔優時不偏】用「還差多少」而不是「現在多好」：佔優時不需要再遷就
 * 航跡，劣勢越深越該去找自己的地方。同機種對打時優勢恆為 0，這條讓偏置
 * 恆為 0 而且**完全不查表**。
 */
export function sweetSpotPitch(
  self: AircraftSpec,
  target: AircraftSpec,
  altitude: number,
  tas: number,
  cfg: DoctrineConfig,
): number {
  const here = sweetSpotAdvantage(self, target, altitude, tas)
  if (here >= 0) return 0
  const best = bestAdvantageSpeed(self, target, altitude)
  const dir = best > tas ? -1 : best < tas ? 1 : 0
  if (dir === 0) return 0
  const strength = Math.min(-here / cfg.sweetSpotFullAt, 1)
  return dir * strength * cfg.sweetSpotMaxPitch
}

/** 前向積分的步長與上限，s。10 Hz 的決策拍不需要更細 */
const PLAN_DT = 0.1
const PLAN_MAX = 20

/**
 * 一個迴轉候選的結果。`seconds` 非有限 = 這個走法做不到。
 */
export interface TurnPlaneCost {
  /** 把機鼻轉到預瞄點要幾秒。積分上限內轉不完 = `Infinity` */
  seconds: number
  /** 積分結束時我的能量高度，m（= 高度 + 空速²/2g） */
  endEnergyAlt: number
  /**
   * 積分結束時機鼻還差幾度到預瞄點，rad。轉完 = 0。
   *
   * 【為什麼要留這個】「轉不完」不等於「不能轉」。三個走法都轉不完的時候
   * 還是要挑一個 —— 挑轉得最多的那個。見 `turnPlanePitch`。
   */
  remaining: number
  /**
   * 這個走法**飛不出來**（過程中會失速）。
   *
   * 【與「轉不完」是兩件事】轉不完只是慢，失速是這條路根本不存在。前者仍然
   * 要納入比較，後者要排除。兩者都回 `Infinity` 的話「轉不完」也會被排除
   * —— 三個都轉不完時整層回 0、什麼都不做，而那等於**這個彎永遠不會
   * 開始**。
   */
  stalled: boolean
}

/**
 * 對一個候選前向積分到「機鼻對上預瞄點」為止。
 *
 * 兩個狀態量：
 * ```
 *   比能量  Es = h + v²/2g       dEs/dt = specificExcessPower(spec, h, v, n, 1)
 *   高度                          dh/dt = v·sin(γ)
 *   剩餘角                        d/dt  = −(ω − losRate)
 * ```
 * 過載 `n` 由該速度的瞬時轉彎率反推（`ω = g√(n²−1)/v`），所以 `Ps` 吃到的
 * 是這個轉彎率真正的誘導阻力代價。**候選之間唯一的差別是 `gamma`。**
 *
 * 【為什麼要積分而不是一步估算】一步估算只快 38 倍，但跟完整積分只有 62.6%
 * 挑到同一個 —— 它抓不到「速度掉向迴旋速度 → 轉彎率變好」那個回饋，而那
 * 正是拉高迴旋會贏的原因。完整積分在出貨規模（40 架 × 10 Hz）是 2.9% 的
 * 單核，付得起。
 *
 * @param swing   機鼻到預瞄點的夾角，rad
 * @param losRate 視線角速度，rad/s —— 轉的期間目標還在飄
 */
export function turnPlaneCost(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  swing: number,
  losRate: number,
  gamma: number,
): TurnPlaneCost {
  if (!(altitude > 0) || !(tas > 1) || !Number.isFinite(swing) || !Number.isFinite(losRate)) {
    return { seconds: Infinity, endEnergyAlt: -Infinity, remaining: Infinity, stalled: true }
  }
  let h = altitude
  let v = tas
  let remaining = Math.max(0, swing)
  let t = 0
  const sinG = Math.sin(gamma)

  while (t < PLAN_MAX) {
    const omega = instantaneousTurnRate(spec, h, v)
    const n = Math.sqrt(1 + (omega * v / G0) ** 2)
    // 【失速 = 這條路飛不出來】與「轉不完」不同，這一個要排除
    if (v <= stallSpeed(spec, h, n) || !(h > 0)) {
      return {
        seconds: Infinity, endEnergyAlt: h + (v * v) / (2 * G0), remaining, stalled: true,
      }
    }

    const es = h + (v * v) / (2 * G0) + specificExcessPower(spec, h, v, n, 1) * PLAN_DT
    h += v * sinG * PLAN_DT
    const vv = 2 * G0 * (es - h)
    v = vv > 1 ? Math.sqrt(vv) : 1

    // 【轉不贏視線時剩餘角會變大】不提早結束 —— 那也是一個比得出來的結果
    // （誰被拉開得最慢），提早回傳等於把它排除掉
    remaining -= (omega - losRate) * PLAN_DT
    t += PLAN_DT
    if (remaining <= 0) {
      return { seconds: t, endEnergyAlt: h + (v * v) / (2 * G0), remaining: 0, stalled: false }
    }
  }
  // 上限內沒轉完 —— 仍然是一個可以比較的結果
  return { seconds: Infinity, endEnergyAlt: h + (v * v) / (2 * G0), remaining, stalled: false }
}

/**
 * 三個迴轉候選挑一個，回傳瞄準點的俯仰偏置，rad。正 = 抬頭。
 *
 * ```
 *   想要的 = 敵人的能量高度 + turnPlaneMargin
 *   分數   = −|轉完之後我的能量高度 − 想要的|
 *   挑分數最高的；偏置 = 該候選的航跡角方向 × 強度 × 上界
 *   強度   = min((最好 − 次好) / turnPlaneFullAt, 1)
 * ```
 *
 * 【為什麼是「離目標多遠」而不是「越高越好」】迴旋後高度還比別人低就是把
 * 自己丟進 extend 地獄；俯衝迴旋只有在敵人真的非常低、付出代價也值得時才
 * 用。**「越高越好」生不出後半句** —— 敵人的能量對三個候選是同一個常數，
 * 比大小時會消掉。見 `turnPlaneMargin`。
 *
 * 【敵人的能量取現在的值】我們不模擬他的機動。他在我轉的那幾秒也會動，但那
 * 對三個候選是同一個偏移，不影響排序。
 *
 * 【為什麼沒有角度門檻】強度由「最好與次好的差距」決定，而實測夾角 15° 以內
 * 三者差距中位數是 0 公尺 —— 這一層在小角度時自己就不出手。門檻是前三輪
 * 翻車的東西（每一次都訂錯），這裡結構上不需要。
 *
 * @param swing   機鼻到預瞄點的夾角，rad
 * @param losRate 視線角速度，rad/s
 */
export function turnPlanePitch(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  swing: number,
  losRate: number,
  targetAltitude: number,
  targetTas: number,
  cfg: DoctrineConfig,
): number {
  // 【消融開關】見 `DoctrineConfig.turnPlaneMaxPitch`
  if (!(cfg.turnPlaneMaxPitch > 0) || !(cfg.turnPlaneFullAt > 0)) return 0

  const wanted = targetAltitude + (targetTas * targetTas) / (2 * G0) + cfg.turnPlaneMargin
  if (!Number.isFinite(wanted)) return 0

  const g = cfg.turnPlaneGamma
  const flyable: { gamma: number, cost: TurnPlaneCost }[] = []
  for (const gamma of [-g, 0, g]) {
    const cost = turnPlaneCost(spec, altitude, tas, swing, losRate, gamma)
    // 失速的排除 —— 那條路飛不出來
    if (!cost.stalled) flyable.push({ gamma, cost })
  }
  if (flyable.length === 0) return 0

  /**
   * 【就算轉不完也要挑一個】就算做不完也要做，而不是進入能量重整 ——
   * **不做迴轉就不會再迴轉了**。三個都轉不完時回 0、把方向盤交還給下面的
   * 層，等於這個彎永遠不會開始。所以是兩段比較：
   *
   *   有人轉得完 → 在轉得完的裡面比「轉完之後離想要的位置多遠」
   *   都轉不完   → 比「誰轉得最多」（剩餘角最小）
   *
   * 【為什麼分兩段而不是加權】把角度與公尺加成一個分數需要一個換算係數，
   * 而那個係數沒有依據 —— 這個專案已經栽在「隨手訂的常數」上三次了。
   * 兩段比較不需要任何係數。
   */
  const done = flyable.filter((x) => Number.isFinite(x.cost.seconds))
  const pool = done.length > 0 ? done : flyable
  const score = done.length > 0
    // 【離想要的位置多遠，不是越高越好】見 `turnPlaneMargin`
    ? (x: { cost: TurnPlaneCost }) => -Math.abs(x.cost.endEnergyAlt - wanted)
    : (x: { cost: TurnPlaneCost }) => -x.cost.remaining

  let bestScore = -Infinity
  let secondScore = -Infinity
  let bestGamma = 0
  for (const x of pool) {
    const sc = score(x)
    if (sc > bestScore) {
      secondScore = bestScore
      bestScore = sc
      bestGamma = x.gamma
    } else if (sc > secondScore) {
      secondScore = sc
    }
  }
  // 贏的是水平迴旋 —— 它的俯仰偏置本來就是 0
  if (bestGamma === 0) return 0

  /**
   * 【什麼時候給滿】
   * ```
   *   只剩一條路飛得出來 → 1（沒得選正是最該出手的時候）
   *   三個都轉不完       → 1（被迫的選擇，猶豫沒有意義）
   *   有得選             → 由「最好與次好差幾公尺」決定
   * ```
   * **「沒得選就不出手」是反的。** 那種寫法在只有水平轉可行時看不出問題
   * （水平轉的偏置本來就是 0），但只有拉高可行的那一格會直接回 0。
   */
  const strength = (done.length > 0 && Number.isFinite(secondScore))
    ? Math.min((bestScore - secondScore) / cfg.turnPlaneFullAt, 1)
    : 1
  return Math.sign(bestGamma) * strength * cfg.turnPlaneMaxPitch
}
