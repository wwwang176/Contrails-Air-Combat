import type { Situation } from './assess'

/**
 * 【`rally` 不由 `arbitrate` 產生】它是指揮層的**外部覆寫**
 * （見 `AiController` 裡那兩行）。放進這個聯集是因為 HUD、telemetry 與
 * 測試都以 `Intent` 當意圖的全集 —— 少了它，「AI 現在在幹嘛」就有一格是
 * 顯示不出來的。
 */
export type Intent = 'defend' | 'merge' | 'extend' | 'engage' | 'approach' | 'rally'

export const INTENTS: readonly Intent[] = [
  'defend', 'merge', 'extend', 'engage', 'approach', 'rally',
]

/**
 * 遲滯閂鎖。**方向由 enter 與 exit 的大小關係推得**：
 *
 *   enter > exit  →「高於 enter 才觸發、低於 exit 才解除」
 *   enter < exit  →「低於 enter 才觸發、高於 exit 才解除」
 *
 * 【為什麼要遲滯】沒有它，述詞在門檻附近抖動時 AI 會一秒切換數十次，
 * 飛機看起來像在抽搐。M1 的前緣縫翼用的是同一招（展開與收回兩個不同的
 * 迎角 + 一個布林閂鎖）。
 *
 * 【為什麼不寫成兩個函數】兩個函數就有兩個要記住的名字，而呼叫端每次都
 * 要想「這個述詞是高於觸發還是低於觸發」。從門檻的大小關係推導，等於讓
 * 資料自己說明方向；寫錯的話兩個門檻會長得很怪，一眼看得出來。
 */
export function latch(active: boolean, value: number, enter: number, exit: number): boolean {
  if (enter > exit) return active ? value > exit : value > enter
  return active ? value < exit : value < enter
}

export interface RuleConfig {
  /** defend：威脅評分的進入／離開門檻 */
  threatEnter: number
  threatExit: number
  /** merge：對頭匯合的 timeToMerge 上限，s */
  mergeTime: number
  /** merge：雙方機首互指的角度上限，rad */
  mergeAspect: number
  /** extend：能量差的進入／離開門檻，m */
  energyEnter: number
  /**
   * extend：能量劣勢**解除**的門檻，m 比能量。**負值** —— 出場條件是
   * 「我沒有低對方超過 100 m」，不是「我比對方強」。
   *
   * 【為什麼是負的】`extendEnergyLatch` 會開著的定義上就是比較弱的那一方。
   * 要它「先贏過對手才准回去打」，那個條件在整場戰鬥中幾乎不成立 ——
   * 實測 `energyAdvantage` 超過 +100 的時間只佔純能量脫離總時的
   * **0.6~0.9%**（`energy-window.probe.ts`，兩張護送卡各 300 s × 5 次微擾）。
   * 正值門檻等於沒有出場條件，閂鎖曾連續開著 166 秒。
   *
   * 【−100 的作用空間】同一支探針量的時間分布：
   *
   * ```
   *              <−1000  −1000..−600  −600..−300  −300..−100  −100..+100  >+100
   *   axis-escort   0.6%        6.5%       26.9%       30.2%       34.8%    0.9%
   *   allies-escort 11.8%      23.3%       37.5%       16.2%       10.6%    0.6%
   * ```
   *
   * 「已回升到 −100 以上但還沒贏」那一段佔 10.6%／34.8%，純能量脫離的
   * 總時間因此少 13.3%／37.6%。allies 那張卡改善較少是對的 —— 它有 35%
   * 的時間能量差在 −600 以下，那是真的被壓著，判準救不了。
   *
   * 【為什麼不合取 `cornerRatio`】「速度也要回來」在純能量段落裡幾乎恆真
   * （首次達標時刻的 p50 = **0.0 s**）—— 速度真的不夠的段落走的是
   * `extendFloorLatch` 那條路，不在這批樣本裡。加上它只換到 2~6 個百分點，
   * 卻要多一個沒有遲滯的門檻。`recoverExit`／`recoveredExit` 那一組的
   * 20v20 平衡實測證據見該欄位。
   *
   * 【已知風險，人工試飛要看】兩件事：
   * 一、遲滯帶由 400 m 收成 200 m，churn 的餘裕變小。
   * 二、`energyAdvantage` 是對**當前目標**算的，而 `target` 每一拍重選。
   *     23~33% 的脫離段落中途換過目標，其中 20~34% 的切換讓這個量憑空
   *     跳過門檻 —— 換到一台更弱的僚機，而真正壓著它的那台還在高處。
   *     這是既有的脆弱性，門檻放寬之後才會暴露出來。
   */
  energyExit: number
  /**
   * extend：**機體**轉彎劣勢的進入／離開門檻，rad/s。**負值。**
   * 判的是 `airframeTurnAdvantage`，不是 `turnAdvantage`。
   *
   * 【數值怎麼來的】4,000 m 的最佳持續轉彎率約 0.23 rad/s（13°/s）。取它的
   * 一成當作「這台飛機真的轉不贏他」的界線 —— 0.023，向下取整到 0.02
   * （1.15°/s），離開門檻取一半。
   *
   * 【這條規則對 P-51 vs Bf 109 K-4 是活的】七格高度裡有六格 P-51 落後
   * 超過門檻（海平面 −0.0379、4,000 m −0.0294，只有 2,000 m 的 −0.0117
   * 在死區內，因為 P-51 的二段增壓剛好在 1,900 m 換檔）。**P-51D 真的會
   * 因為轉不贏而判定 extend。** 完整數據見 test/unit/envelope.test.ts。
   *
   * 機種對之間差距在 ±2% 以內時（例如 G-6）它一律低於門檻、等於休眠 ——
   * 那也是對的，門檻量的是「真的轉不贏」。
   */
  turnEnter: number
  turnExit: number
  /**
   * extend：**速度**見底的進入／離開門檻，判的是 `cornerRatio`
   * （TAS ÷ 角落速度）。低於 `cornerEnter` 觸發、高於 `cornerExit` 解除。
   *
   * 【0.75 / 0.95 的意思】0.75 就是「我的速度只剩角落速度的四分之三」，
   * 轉彎能力已經明顯打折。遲滯帶 0.2 寬 —— 大約是一次淺俯衝換得到的速度。
   *
   * 【為什麼不用比能量】`Es = h + v²/2g` 是用來**比較兩架飛機**的，不是
   * 回答「我現在能做什麼」。反例：4379 m、67 m/s 的飛機比能量很漂亮，
   * 讀出「還有 3299 m 餘裕」，而它什麼機動都做不了（spec §4.1）。
   *
   * 【這裡的遲滯不會震盪】震盪的來源是**俯仰指令在翻號**（裸門檻），
   * 不是意圖在切換。俯仰是連續量，意圖的遲滯是必要且正常的（spec §7.1）。
   *
   * 【定值由實測掃出】對戰矩陣的「能量優勢方不得超支」與 1v1
   * 機動測試的 `longestExtend` 一起掃：
   *
   * ```
   * enter / exit   花掉的比能量（上限 3213）   longestExtend 最差
   *   0.75 / 0.95        4010  ✗                    42.5 s
   *   0.65 / 0.85        通過  ✓                    38.8 s
   *   0.55 / 0.75        3390  ✗                   113.8 s
   *   0.45 / 0.65        3390  ✗                    12.3 s
   *   0.20 / 0.30        3390  ✗                    19.8 s
   * ```
   *
   * 【0.55 以下閂鎖幾乎不觸發】對頭 @4000 的單次 `extend` 衝到 113.8 秒
   * —— 沒有人叫它回來。
   *
   * 【這張表沒有 `floorExempt`，讀的時候要記得】0.75 那一列之所以 ✗，是
   * 因為 boom-and-zoom 的上升段速度會掉到角落速度以下，於是每一次拉起來
   * 都被判「我飛不動了，撤」—— 攻擊做到一半放棄，能量因此超支。
   * `floorExempt`（見下一個欄位）就是修那件事的：佔著能量優勢時「我飛不
   * 動了」不強制脫離。超支的成因消失之後 0.75 不再犯規，而它比 0.65 更早
   * 察覺「速度真的見底了」。
   *
   * ---
   *
   * # 放寬的掃描：**值不動**
   *
   * 症狀是「明明在追擊敵人，卻很常放棄追擊改平累積能量，頻率滿高的」。
   * 換算成 km/h 之後這個抱怨是有結構的：
   *
   * ```
   *              角落速度(8G)   放棄追擊(0.75×)   才准回來(0.95×)
   *   3000 m        426              319              404
   *   5000 m        473              355              449
   * ```
   *
   * 而實機 log 的交戰速度帶是 250~470 km/h —— **遲滯帶整段夾在交戰速度的
   * 正中央**，所以每一次轉彎掉速都會踩到它。
   *
   * 【為什麼角落速度這麼高】它的定義是 `stallSpeed(spec, alt, gPositive)`，
   * 也就是拉得出**結構極限 8 G** 的最低速度，而空戰實際用的是 3~5 G。
   * 若改用 4 G 當實用上限，5000 m 的角落速度是 334 而不是 473。
   *
   * 【20v20、420 秒、VETERAN、兩個開局的掃描】`extend-threshold.probe.ts`：
   *
   * ```
   * enter/exit   開局       extend  engage  進入數  TAS  存活 B:R
   *  0.75/0.95   4000/200    37.1%   10.4%    730   439   18:20
   *  0.75/0.95   5500/150    37.2%   10.8%    636   438   19:20
   *  0.65/0.85   4000/200    37.3%   11.1%    761   439   18:20
   *  0.65/0.85   5500/150    33.0%   12.5%    535   432   19:20
   *  0.55/0.75   4000/200    35.8%   11.9%    699   437   17:20
   *  0.55/0.75   5500/150    26.9%   12.3%    530   424   18:20
   *  0.45/0.65   4000/200    32.5%   11.0%    672   426   19:20
   *  0.45/0.65   5500/150    28.5%   11.5%    536   420   20:19
   *  0.55/0.65   4000/200    37.4%   11.8%    687   439   18:20
   *  0.55/0.65   5500/150    25.4%   12.5%    516   428   18:20
   * ```
   *
   * 20v20 的帳面上 0.55/0.75 最好：`engage` 10.6% → 12.1%、`extend` 37.2%
   * → 31.4%、TAS 只掉 8 km/h。**但它把飛行品質賣掉了。**
   *
   * ## 放寬的代價：安全層開始替 AI 飛
   *
   * ```
   * enter/exit    ai-manoeuvre safetyShare（上限 0.05）   ai-visible-evasion
   *  0.75/0.95    全綠                                    5/5 綠
   *  0.65/0.85    全綠                                    **3 紅**（含「不必
   *                                                       動用安全層」那一條）
   *  0.55/0.75    側舷 @4000 **0.656**、對頭 @4000 0.162  3 紅
   * ```
   *
   * 0.55/0.75 下**安全層佔了 65.6% 的時間**。這正是 `ai-manoeuvre.test.ts`
   * 的 `LIMITS.safetyShare` 註解記載的陷阱：「失速數字好看是因為安全層
   * 一直在替它飛，那不是健康」。0.65/0.85 是較輕的版本，`ai-manoeuvre`
   * 過得了，但 `ai-visible-evasion` 的三條掛掉，其中一條也是安全層。
   *
   * **兩個候選值都不能用，`cornerEnter`/`cornerExit` 維持 0.75 / 0.95。**
   *
   * ## 這件事在說什麼
   *
   * `extend` 頻繁**不是門檻設錯**，而是這台飛機在纏鬥中真的守不住速度 ——
   * 而 `extend` 正是讓它保持可飛的那個機制。把它關小，AI 就滑進安全層。
   *
   * 【只搬 `cornerEnter` 是單邊動作】`energyPull`、`brakeCornerRatio`、
   * `unloadMargin`、`extendPitchAngle` 全都用 8 G 的角落速度當分母。只動
   * 這一個的話 AI「不撤了」卻仍然被其他層當成低能量對待，兩邊打架。要動
   * 就要動 `cornerSpeed` 的參考過載本身（8 G → 一個實用值），讓五個判準
   * 一起平移 —— 那是一次動五個地方，需要負責人決定，且必須重掃全部五個。
   *
   * ## 與門檻無關的兩件事
   *
   * **一、單次 `extend` 的長尾不是門檻造成的。** 20v20 量到 102~151 秒，
   * 而**出貨值 0.75/0.95 自己也有 106~151 秒**。長尾在任何門檻下都在。
   *
   * **二、真正的大問題不在這裡。** 420 秒的 20v20，存活數 18~20 : 19~20
   * —— 打了七分鐘雙方加起來死不到三架，而 `engage` 佔時無論怎麼調都只有
   * 10~12%。門檻只能在 `extend` ↔ `approach` 之間搬運時間，搬不出「打得
   * 到人」。那是另一份的事。
   */
  cornerEnter: number
  cornerExit: number
  /**
   * 「我回到能打的狀態」失效的門檻 —— `extendRecoveredLatch` 的出場。
   * 進場門檻**直接用 `cornerExit`**：「我飛得動了」只該有一個定義，
   * 與 `extendFloorLatch` 共用同一把尺。
   *
   * 值域被夾在 `cornerEnter`（0.75）與 `cornerExit`（0.95）之間 ——
   * 低於前者等於沒有這個閂鎖（要撐到見底才失效），高於後者等於沒有遲滯。
   *
   * **起始值，待掃描後回填。**
   */
  recoverExit: number
  /**
   * 關掉時 `extendRecoveredLatch` 不更新、仲裁退化成「只看能量劣勢」。
   *
   * **預設關閉 —— 實測不利，要開是負責人的決定。** 關閉時這一層是恆等
   * （已驗證：`ai-withdraw-anchor` 的九項讀數全部重現）。
   *
   * ## 為什麼預設關
   *
   * 20v20 遭遇戰、五次 ±0.5% 初速微擾（`encounter-balance.probe.ts`）：
   *
   * ```
   *            戰損比中位   最大半徑中位
   *   關閉        1.42        5,888 m
   *   開啟        5.00        7,820 m
   * ```
   *
   * 五次裡四次偏向同一隊，是系統性偏斜不是極值統計。最大半徑也一起惡化。
   *
   * 【機制】`extendEnergyLatch` 存在的理由就是**讓能量戰鬥機脫離**。把它
   * 閘在 `cornerRatio > cornerExit` 上等於說「我速度夠就別跑」—— 而 P-51
   * 可以速度完全正常、同時比 109 低 800 m。它於是留下來纏鬥，那是它最不該
   * 做的事。**`cornerRatio`（我此刻的速度）不能替代 `energyAdvantage`
   * （我相對他的總能量）來回答「該不該留下來跟他纏鬥」。**
   *
   * ## 開啟時量到的好處
   *
   * ```
   *   ai-targeting fireShare   0.0160 → 0.0256   長期紅的那一條，轉綠
   *   ai-targeting onNose      0.171  → 0.192
   *   護送關 extend 離場長尾    1,874  → 573 m
   *   護送關 extend 進場次數    90     → 58
   *   ai-targeting holdMedian  2.00   → 1.40     破線
   *   ai-targeting rearShare   0.312  → 0.354    破線
   * ```
   *
   * 【為什麼是布林而不是把進場門檻設成 `Infinity`】那個做法只在「全新、
   * 未啟動」的狀態下等價 —— `latch()` 在 `active === true` 時走的是
   * `value > exit`，仍然會被評估。而且 `JSON.stringify` 會把 `Infinity`
   * 輸出成 `null`，設定一旦被印出或傳遞就失真。
   */
  recoveredExit: boolean
  /**
   * 絕對理由的**豁免門檻**：能量優勢高於此值時，「我飛不動了」不強制脫離。
   *
   * 【為什麼絕對理由需要一個與對手有關的豁免】`extend` 的意思是「撤下來把
   * 能量補回來」。我正高出對手 1500 m、快 80 m/s 時，撤下來補什麼？我缺的
   * 只是**此刻的速度**，而那由 `steer.ts` 的 `extendPitchAngle` 在不脫離的
   * 情況下處理（低頭換速度）。
   *
   * 【沒有它會怎樣】實測高能量開局：P-51 對 109 轉不贏，唯一贏法是俯衝
   * 掠襲，而掠襲的拉升段速度本來就會掉 —— 每一次拉起來都被判「我飛不動
   * 了，撤」，於是每一次攻擊都做到一半放棄。90 秒打不完，花掉 4010 m 比
   * 能量而開局優勢只有 3213 m：本錢磨光還沒換到東西。
   *
   * 【它不牴觸 M11 spec §4.1 的「與對手無關」】那一條要說的是「不要用相對
   * 量去回答『我現在能做什麼』」，而判準本身（`cornerRatio`）仍然只問自己。
   * 這裡加的是**要不要因此脫離**，那是戰術決定 ——「我有本錢就不必撤」與
   * 「我還轉不轉得動」是兩個問題。
   *
   * 【2000 m 由實測掃出】豁免值必須**高到在混戰中罕見、低到在真正的能量
   * 優勢開局會生效**：
   *
   * ```
   * floorExempt   1v1 高能量開局      20v20 傷害比（上限 3 倍）
   *   500          blue 43.9 s         8.4  ✗ 一面倒
   *  1000          blue 43.9 s         2.66 ✓
   *  2000          blue 43.9 s         2.70 ✓   ← 選定
   *  3000          blue 43.9 s         2.70 ✓
   * ```
   *
   * 【500 為什麼會一面倒】20v20 開局雙方同高同速，任何一架先累積到 500 m
   * 優勢就不再脫離、繼續攻擊、優勢再擴大 —— 強者愈強滾成雪球，傷害比衝到
   * 8.4 倍。1v1 那一場藍方的開局優勢是 3213 m，所以 500 到 3000 之間對它
   * 完全沒有差別；取 2000 是為了在混戰裡罕見。
   */
  floorExempt: number
  /**
   * 規則 3 的觸發：`timeToBear` 超過這麼多秒就算「轉不到他身上」，s。
   *
   * 【單位是秒，所以看得懂】它不是無因次的比值 —— 「要 8 秒才轉得到」
   * 這句話直接對應人在座艙裡的判斷。轟炸機的「錐角」因此自動變窄、
   * 戰鬥機自動變寬，不必為機種各訂一個角度。
   */
  bearMax: number
  /**
   * 規則 3 的最小承諾，s。**一旦因為「跟不上」而脫離，至少飛這麼久。**
   *
   * 【它擋的是抖動】沒有承諾時：跟不上 → 脫離 → 飛開 → 敵人變遠、視線角
   * 速度變小 → 跟得上了 → 回頭 → 一接近又跟不上 → 脫離 …… 每隔幾秒抖一次。
   * 那是「永不解除」的鏡像缺陷。
   */
  trackCommit: number
  /**
   * 規則 3 的上限，s。**拉不到 `extendRange` 時的保底。**
   *
   * 【為什麼距離出場還不夠】脫離真正要的是「拉開到足以重置幾何」，時間只是
   * 它的代理 —— 所以距離優先。但他比我快時永遠拉不到那個距離，於是變成
   * 永久脫離。兩個一起才有界。
   */
  trackMax: number
  /**
   * 規則 3 **俯衝中**的上限，s。自己紅線比對手高、目標速度還沒到時用它取代
   * `trackMax`。
   *
   * 【為什麼要另一個上限】從纏鬥出來時速度只有 90 m/s 上下，25° 俯衝到對手
   * 放手的速度要 12 秒左右；7 秒的上限會在半路把俯衝切掉，實測 IAS 最高只到
   * 對手紅線的 0.9 以下，等於白俯衝一段。
   *
   * 【仍然有界】它是絕對值，不是「到達目標為止」—— 貼海、對手比預期快、
   * 或推力不夠時目標可能永遠到不了，那種條件式會變成永久脫離。
   */
  trackDiveMax: number
  /**
   * 規則 3 撞上限之後的冷卻，s。**這段時間不再脫離，硬著頭皮打。**
   *
   * 【為什麼要有】撞上限代表「脫離沒有解決問題」。沒有冷卻的話下一拍立刻
   * 又脫離，上限只是把一段長脫離切成小段。
   */
  trackCooldown: number
  /** extend：拉開超過這個距離就結束脫離，m */
  extendRange: number
  /**
   * 高度鎖的**出場**遲滯，m：跌破鎖（`floorGap < 0`）閂上，爬回到鎖上方
   * 這麼多公尺才解。**0 = 關掉整個機制**（連進入判定一起）。
   *
   * 【為什麼進場線寫死在 0】鎖本身已經帶著 −100 的緩衝（見
   * `Situation.floorGap`），進場線就是「真的跌破了」，沒有第二個旋鈕的
   * 空間；要調鬆緊調的是緩衝與這條出場線。
   *
   * 【出場不認距離】其他脫離理由跑滿 `extendRange` 就算完成，這一個不行
   * —— 太低這件事換個地方解決不了，與見底（`cornerExit`）同型。
   */
  floorAltExit: number
  /** engage：timeToMerge 的進入／離開門檻，s */
  engageTimeEnter: number
  engageTimeExit: number
  /** 意圖切換後的最小停留時間，s。defend 不受此限 */
  minDwell: number
}

/**
 * 由實測回填的：`cornerEnter`／`cornerExit` 與 `floorExempt`，掃描表在
 * 各欄位的註解裡。其餘仍是起始值。
 *
 * 這與 M2 的做法一致：命中盒座標與 L4 曲率界都是先跑再定，不接受
 * 「配一個看起來合理的數字」。
 */
export const DEFAULT_RULES: RuleConfig = {
  threatEnter: 0.35,
  threatExit: 0.15,
  mergeTime: 2.5,
  mergeAspect: 30 * (Math.PI / 180),
  energyEnter: -300,
  energyExit: -100,
  turnEnter: -0.02,
  turnExit: -0.01,
  // 【不要放寬】0.65/0.85 與 0.55/0.75 都讓安全層開始替 AI 飛。掃描表與
  // 證據見型別註解
  cornerEnter: 0.75,
  cornerExit: 0.95,
  recoverExit: 0.85,
  recoveredExit: false,
  floorExempt: 2000,
  floorAltExit: 150,
  // 【三個值由負責人指定，人工試飛通過】掃描沒有鑑別力 —— 20v20 的結果
  // 非單調、雜訊主導，這三個值不是量出來的。支持它們的證據是人工試飛，
  // 而那正是本專案的主判準（「玩起來合不合理，不是攻擊效率」）。
  //
  // 【它們一起定義脫離的一生】
  //
  //   bearMax      轉到他身上要超過這麼久 → 判定轉不過去，開始脫離
  //   trackCommit  一旦脫離，至少飛這麼久不准反悔（擋抖動）
  //   trackMax     最多脫離這麼久（拉不開距離時的保底，擋永久脫離）
  //
  // 中間還有一個出口：拉開到 `extendRange` 就結束，但要先過承諾。
  //
  // 【往下調的訊號】人工回報「明明追不到還在追」。往上調的訊號是「太容易
  // 放棄」。
  bearMax: 6,
  trackCommit: 4,
  trackMax: 7,
  trackDiveMax: 20,
  trackCooldown: 10,
  extendRange: 1500,
  engageTimeEnter: 8,
  engageTimeExit: 12,
  minDwell: 0.8,
}

export interface RuleState {
  intent: Intent
  /** 目前意圖已維持的秒數 */
  dwell: number
  defendLatch: boolean
  /** 能量劣勢的閂鎖。與轉彎劣勢分開，見 `stepRules` 的註解 */
  extendEnergyLatch: boolean
  /** 轉彎率劣勢的閂鎖 */
  extendTurnLatch: boolean
  /** 絕對能量見底的閂鎖 */
  extendFloorLatch: boolean
  /**
   * 「我回到能打的狀態」的閂鎖，**絕對量，與對手無關**。
   *
   * 與 `extendEnergyLatch` 正交：那一個說「我比他弱」（相對），這一個說
   * 「我飛得動」（絕對）。仲裁時取合取 —— 兩件事都成立才是「該脫離」。
   * **一個閂鎖只維護一種事實**，不要把兩者併成一個。
   */
  extendRecoveredLatch: boolean
  /** 上面兩者的或。**由 `stepRules` 寫入，不要回寫** */
  extendLatch: boolean
  /**
   * 規則 3 的脫離已經持續多久，s。**0 = 沒有在這條規則下脫離。**
   *
   * 【為什麼是計時器不是布林】這一條有兩個出場條件（拉開夠遠、到上限），
   * 前者要先跑完最小承諾。少了計時器就寫不出「承諾」。
   */
  trackExtend: number
  /**
   * 規則 3 撞過上限之後的冷卻剩餘，s。**這段時間硬著頭皮打。**
   *
   * 【它擋的是「上限沒有界限作用」】只把計時器歸零的話下一拍立刻重新觸發，
   * 於是變成每 `trackMax` 秒一段的無限接續。
   *
   * 【為什麼是計時器】用「等幾何改變」當清帳條件的話，對手就是比我快時
   * 那個條件永遠不成立，飛機整場再也不脫離 —— 與本輪要修的原始缺陷同一個
   * 形狀。計時器一定會走完。
   */
  trackCooldown: number
  engageLatch: boolean
  /** 高度鎖：跌破地板，爬回來之前用 extend 補高度。見 `floorAltExit` */
  altFloorLatch: boolean
}

export function createRuleState(): RuleState {
  return {
    intent: 'approach',
    // 【為什麼是 Infinity 而不是 0】`dwell` 量的是「現在這個意圖已經穩定
    // 多久」，最小停留時間拿它決定能不能換。剛出生的 AI 並沒有「剛剛才
    // 切到 approach」——approach 只是還沒做出任何決定時的預設值。設成 0
    // 會讓它在重生後的第一個 minDwell 秒內無法離開 approach，也就是無論
    // 態勢多危急都得先直直飛 0.8 秒。
    dwell: Infinity,
    defendLatch: false,
    extendEnergyLatch: false, extendTurnLatch: false, extendFloorLatch: false,
    extendRecoveredLatch: false,
    extendLatch: false,
    trackExtend: 0,
    trackCooldown: 0,
    engageLatch: false,
    altFloorLatch: false,
  }
}

/**
 * 優先序仲裁：由上而下，**第一個成立的就採用**。
 *
 * @param threat 已乘上持續跟蹤權重的威脅值（見計畫的偏離 2）。
 *               `sit.threatInstant` 只是瞬時值，不要直接傳它。
 *
 * 【為什麼是優先序而不是狀態機】五個狀態的狀態機最多有 20 條轉換要維護，
 * 而且很容易漏掉某個組合（例如忘了寫「求生怎麼回到纏鬥」，AI 就會永遠
 * 卡在拉升）。優先序只有五條規則，而且「安全永遠第一」是**排在最上面**
 * 這件事本身保證的，不是另外一條規則。
 */
export function stepRules(
  s: RuleState,
  sit: Situation,
  threat: number,
  dt: number,
  cfg: RuleConfig = DEFAULT_RULES,
  fighter = true,
  diving = false,
): Intent {
  s.dwell += dt

  // 【三個閂鎖每一步都要更新，即使最後沒選到它】否則閂鎖會停在切換前的
  // 舊值，下次輪到它時反應會慢一整個週期——而且那個延遲只在特定的意圖
  // 順序下出現，極難重現。
  s.defendLatch = latch(s.defendLatch, threat, cfg.threatEnter, cfg.threatExit)

  // 【能量與轉彎是兩個獨立的閂鎖，不能 OR 進同一個】寫成
  //
  //   s.extendLatch = latch(s.extendLatch, energyAdvantage, −300, 100) || turnAdvantage < 0
  //
  // `||` 的結果被寫回閂鎖**自己的記憶**，於是遲滯被毒化：只要有任何一格
  // `turnAdvantage < 0`，下一格 `latch(active = true, …)` 走的就是維持條件
  // `energyAdvantage < 100` —— 勢均力敵時那幾乎恆真，閂鎖再也關不掉。
  //
  // 人工驗收實測：正面對頭時 `turnAdvantage` 曾短暫落到 −0.005 rad/s
  // （0.29°/s，戰術上毫無意義），就足以讓 AI 在距離跌破 `extendRange` 時
  // 轉為脫離 —— 而當下 `turnAdvantage` 早已回到 +0.007。
  //
  // 分成兩個閂鎖之後，各自維護各自的遲滯，OR 只發生在讀取端。
  s.extendEnergyLatch = latch(
    s.extendEnergyLatch, sit.energyAdvantage, cfg.energyEnter, cfg.energyExit,
  )
  // 【判機體不判當下】`turnAdvantage` 被速度差主導：對手拉桿掉速——那正是
  // 他快撐不住的訊號——會讓它讀出「他轉得比我好」。投入／退出的決定要問
  // 「這場迴旋戰打到最後誰贏」，那由機體決定（見 Situation 的欄位註解）。
  s.extendTurnLatch = latch(
    s.extendTurnLatch, sit.airframeTurnAdvantage, cfg.turnEnter, cfg.turnExit,
  )
  // 【第三個理由是絕對的】上面兩個都是「跟他比」，兩台一起磨下去時都看不見。
  // 這一個問「我還飛得動嗎」，與對手無關。
  s.extendFloorLatch = latch(
    s.extendFloorLatch, sit.cornerRatio, cfg.cornerEnter, cfg.cornerExit,
  )
  // 【第四個閂鎖：絕對的「我回到能打的狀態」】進場用 `cornerExit`、出場用
  // `recoverExit`。進場門檻與 `extendFloorLatch` 的出場共用同一個值，因為
  // 那是同一件事的同一把尺；出場另設一個較低的值製造遲滯，否則速度在
  // 0.95 附近抖動就會讓意圖跟著抖。
  //
  // 【關掉時不更新】消融的兩檔不得有不同的狀態演進，否則差異會在日後打開
  // 時以「殘留的舊值」的形式冒出來。
  if (cfg.recoveredExit) {
    s.extendRecoveredLatch = latch(
      s.extendRecoveredLatch, sit.cornerRatio, cfg.cornerExit, cfg.recoverExit,
    )
  }
  s.extendLatch = s.extendEnergyLatch || s.extendTurnLatch || s.extendFloorLatch
  s.engageLatch = latch(
    s.engageLatch, sit.timeToMerge, cfg.engageTimeEnter, cfg.engageTimeExit,
  )
  // 【高度鎖】跌破鎖（floorGap < 0）進、爬回鎖上方 floorAltExit 才出。
  // latch() 的低側分支（enter < exit）就是這個形狀，直接餵 floorGap。
  s.altFloorLatch = cfg.floorAltExit > 0 && latch(
    s.altFloorLatch, sit.floorGap, 0, cfg.floorAltExit,
  )

  // 【規則 3：轉不到他身上就脫離，但一旦決定就要飛完承諾】
  //
  // 【為什麼判準是 `timeToBear` 而不是機體比較】`airframeTurnAdvantage` 是
  // 兩台的規格之差，對一組機種對幾乎是常數 —— 拿它當脫離條件會永久成立
  // （F4F 對 A6M 實測佔時 100.0%，`extend` 因此佔到 54.6%）。`timeToBear`
  // 問的是「**此刻**把機首轉到他身上要幾秒」，敵人變遠、橫越變慢時它自己
  // 就縮回來。
  //
  // 【為什麼還要 `extendTurnLatch` 當前提】轉得贏的飛機轉不到時該做的是
  // 繼續轉，不是脫離。這一條是給沒有那個選項的一方的。
  //
  // 【為什麼只給戰鬥機】轟炸機轉不贏攔截機是常態，`extendTurnLatch` 對它
  // 永遠成立；而它的答案是編隊與防禦火網，不是脫離。少了這個閘門，整隊
  // 轟炸機會離開航線 —— 實測過一次：P-51 對 B-17 的擊墜數歸零，因為轟炸機
  // 不在攔截機預期的位置上，而那條紅掉的測試講的是砲塔平衡，成因完全看
  // 不出來。
  //
  // 【兩個出場，距離優先】拉開夠遠是真正要的東西；上限是「他比我快、永遠
  // 拉不開」時的保底。距離出場要先跑完承諾。
  //
  // 【「轉得到了」不是出場條件】脫離一卸載拉開，視線角速度就掉、`timeToBear`
  // 就縮回門檻以下 —— 那是脫離本身造成的，不代表態勢重置。拿它當出口的話，
  // 每一段脫離都在承諾一到期的那一格結束（實測 244 段裡 83% 如此，中位
  // 持續 4.0 s 恰等於 `trackCommit`，一段只換到 60 m），脫離等於沒做。
  const cannotBear = sit.timeToBear > cfg.bearMax
  if (s.trackCooldown > 0) s.trackCooldown -= dt
  if (s.trackExtend > 0) {
    // 【被咬時計時器暫停】`defend` 在仲裁裡壓過這一條，被咬的那幾秒飛機
    // 在破防、不在脫離。計時器照走的話，承諾與上限量的就是「牆鐘」而不是
    // 「真的在脫離的時間」——實測 39% 的計時器時間意圖不是 extend，段落
    // 燒完上限、進了冷卻，而那趟脫離從頭到尾沒飛過。
    //
    // 【它不會變成新的鎖】暫停只發生在 `defendLatch` 開著時，那個閂鎖有自己
    // 的出場遲滯（`threatExit`）；閂鎖一放，計時器就繼續走向上限。
    if (!s.defendLatch) s.trackExtend += dt
    const committed = s.trackExtend >= cfg.trackCommit
    // 【俯衝中上限換成 trackDiveMax】呼叫端只在「有紅線餘裕、目標速度還沒到」
    // 時傳 true，見 `RuleConfig.trackDiveMax`
    const cap = diving ? cfg.trackDiveMax : cfg.trackMax
    if (s.trackExtend >= cap) {
      // 【撞上限要罰冷卻】只把計時器歸零的話，下一拍條件仍然成立、立刻
      // 重新觸發 —— 每 `trackMax` 秒一段無限接續，上限等於沒有界限作用。
      //
      // 【為什麼是計時器不是「等幾何改變」】那個條件可能永遠不成立（他就是
      // 比我快），於是記號永遠清不掉、這架飛機整場再也不脫離。那是本輪要修
      // 的原始缺陷的鏡像 —— 一個閂鎖因為出場條件不可達而永久卡住。
      // **計時器一定會走完，條件式不一定。**
      s.trackExtend = 0
      s.trackCooldown = cfg.trackCooldown
    } else if (committed && sit.nearestRange > cfg.extendRange) {
      // 【正常出場不罰】拉開了代表這一趟有用，沒有理由罰它
      //
      // 【量的是最近敵機，不是當前目標】「出球了沒」問的是離最近的敵人多遠。
      // `range` 會跟著換目標歸零，見 `Situation.nearestRange`
      s.trackExtend = 0
    }
  } else if (fighter && cannotBear && s.trackCooldown <= 0
    && s.extendTurnLatch && sit.range < cfg.extendRange) {
    s.trackExtend = dt
  }

  const next = arbitrate(s, sit, cfg)

  // 【最小停留：defend 是例外】停留時間是為了行為穩定，但「有人正在打我」
  // 不能等 0.8 秒才反應。安全層對此也有同樣的豁免（spec §9）。
  if (next !== s.intent && (next === 'defend' || s.dwell >= cfg.minDwell)) {
    s.intent = next
    s.dwell = 0
  }
  return s.intent
}

function arbitrate(s: RuleState, sit: Situation, cfg: RuleConfig): Intent {
  if (s.defendLatch) return 'defend'

  // 對頭匯合：雙方機首互指且即將交錯。angleOffTail 接近 π 代表他正朝我來
  if (
    sit.timeToMerge < cfg.mergeTime
    && sit.aspectAngle < cfg.mergeAspect
    && sit.angleOffTail > Math.PI - cfg.mergeAspect
  ) return 'merge'

  // 【有射擊解時，「比他弱」不是離開的理由；「我飛不動了」仍然是】
  //
  // 人工驗收抓到的缺陷：AI 咬在敵機後方 236 m、瞄準偏離 4°、正在開火時切到
  // extend，瞄準點瞬間甩到 87°，然後直飛 21 秒到 1,484 m。45 秒的交戰只開火
  // 7.1 秒。真實 BFM 是「打不贏才脫離」，不是「打得正順的時候脫離」。
  //
  // 但這條護欄不能無差別地擋掉所有 extend：早期版本這樣做，結果把最後的
  // 觸發機會也堵死，共速共高開局螺旋下沉到離海 309 m。分野在於**理由的性質**：
  //
  //   相對理由（比他弱、轉不贏他）→ 談的是接下來的交換，有槍在手就先開槍
  //   絕對理由（我飛不動了）      → 談的是我還能不能飛，開著槍也得走
  //
  // `shotInstant > 0` 已經包含「距離 900 m 內、有預瞄解、機首在 15° 錐內」，
  // 正是「我正咬著他」的定義。
  //
  // 【`extendRange` 也只約束相對理由】同一條分野再用一次。`extend` 有兩個
  // 出口：跑滿 `extendRange`，或閂鎖釋放。絕對理由觸發時**永遠是距離先到**
  // —— 速度要爬回 `cornerExit` 需要幾十秒，而拉開到 1,500 m 只要 1.2 秒。
  // 少了這條豁免，AI 每次都在還沒補到速度時就回頭，等於沒補，很快又見底，
  // 形成來回震盪。
  //
  // 相對理由（比他弱、轉不贏他）談的是戰術態勢，「拉開夠遠就安全了」成立；
  // 絕對理由（我飛不動了）與距離無關 —— 跑到天邊也不會讓你變得飛得動。
  const shooting = sit.shotInstant > 0
  // 【絕對理由的豁免】見 `RuleConfig.floorExempt`：佔著明顯能量優勢時，
  // 「我飛不動了」不強制脫離 —— 缺的是此刻的速度，低頭換就有，不必跑掉。
  if (s.extendFloorLatch && sit.energyAdvantage < cfg.floorExempt) return 'extend'
  // 【高度鎖：跌破地板就去補高度】它是**位置紀律**：護送 = 不鑽到轟炸機
  // 編隊下面，追擊 = 不鑽到目標下面（把高度優勢倒貼給對方）。出場不認
  // 距離（見 `floorAltExit`）。
  //
  // 【開火豁免比照相對理由】正咬著人開火時摸到地板，先把這一輪打完 ——
  // 鎖的 −100 m 緩衝就是留給攻擊窗收尾的。
  if (!shooting && s.altFloorLatch) return 'extend'
  // 【能量理由是合取】「我比他弱」（相對）與「我還飛不動」（絕對）是兩件
  // 事，兩件都成立才該脫離。速度補回來了就回去打 ——「比對手強」那個出場
  // 條件對劣勢方在整場戰鬥中都達不到，實測能量閂鎖曾連續開著 166 秒。
  //
  // 【迴旋劣勢不在這裡】`extendTurnLatch` 是**打法的選擇**，不是脫離的
  // 理由：轉不贏他的飛機照樣要靠近他打，只是不能跟他繞圈。它由戰術層
  // 消費（`AiController` 的 `ti.mandatory`），走 boom and zoom 那條路。
  //
  // 【壞掉會怎樣】把它加回這個分支，`airframeTurnAdvantage` 對一組機種對
  // 幾乎是常數 —— 差距超過遲滯帶的配對（F4F vs A6M 是門檻的 3～5 倍）
  // 閂鎖永不解除，距離一進 `extendRange` 就恆為 `extend`，而 `extend` 的
  // 卸載操舵讓射擊解起不來、`shooting` 的豁免因此永遠不成立。自鎖。
  const weakAndSlow = s.extendEnergyLatch && !s.extendRecoveredLatch
  if (
    !shooting
    && weakAndSlow
    && sit.range < cfg.extendRange
  ) return 'extend'

  // 【規則 3】準星跟不上預瞄點就佈局下一次機會。計時器由 `stepRules` 維護，
  // 開火時仍然豁免 —— 與其他相對理由同一條分野。
  if (!shooting && s.trackExtend > 0) return 'extend'

  // 【門檻與 extend 對齊，不是 `>= 0`】機體差距可能只有 ±2% 且隨高度換號，
  // 用 `>= 0` 等於擲銅板。要拒絕交戰得是**明顯**轉不贏，那與脫離同一個標準。
  if (sit.airframeTurnAdvantage > cfg.turnEnter && s.engageLatch) return 'engage'
  return 'approach'
}

/**
 * `extend` 是被哪一個閂鎖推過去的，供 HUD 顯示。**成立的全列。**
 *
 * 【為什麼是純函數而不是在 HUD 那邊拆】那些欄位的語意（相對／絕對）住在
 * 這個檔案裡，判讀也該住在這裡。HUD 只負責畫字。
 *
 * 【為什麼沒有「迴旋」】`extendTurnLatch` 自己不推 `extend`，它只是規則 3
 * 的前提。列它會讓 HUD 指著錯的原因，而那是人工驗收唯一看得到的東西。
 * 規則 3 真的成立時列的是「轉不到」。
 *
 * 【為什麼不回傳空字串當「沒有理由」】意圖是 `extend` 而閂鎖都沒開是可能
 * 的 —— `arbitrate` 還有別的路徑（例如命令）。那時候誠實寫「無」，不要讓
 * 畫面看起來像是漏了一格。
 */
export function extendReason(s: RuleState): string {
  const parts: string[] = []
  if (s.extendEnergyLatch) parts.push('能量')
  if (s.extendFloorLatch) parts.push('見底')
  if (s.altFloorLatch) parts.push('高度')
  // 【規則 3 要列】它是人工試飛唯一看得到的診斷。少了這一格，規則 3 造成
  // 的脫離會顯示「無」——畫面看起來像是漏了一格，而實際上是最常見的理由。
  if (s.trackExtend > 0) parts.push('轉不到')
  return parts.length > 0 ? parts.join('+') : '無'
}
