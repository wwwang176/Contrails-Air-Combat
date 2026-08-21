import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { threatFactor, trackAngle, turnTime } from './assess'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Team } from '../world/World'

export interface TargetConfig {
  /**
   * **底價**：一架既不是機會也不是威脅的敵機，仍然是一架敵機。
   *
   * 【沒有它會發生什麼】開局雙方相距 10 km、要飛 25 秒才碰得到。那 25 秒
   * 裡敵機都在 `THREAT_RANGE` 之外（威脅 = 0）而且迎頭朝我飛（機會 = 0），
   * 於是**每一架的分數都恰好是 0**。三個折扣都是乘法，乘上 0 還是 0 ——
   * 選擇因此退化成「取掃描時第一個碰到的」，五個分隊的長機全部選中編號
   * 最小的那一架。實測把 `crowdPenalty` 從 1 推到 1000 一格都沒動，因為
   * 它乘的是 0。
   *
   * 【為什麼是固定值而不是再加一個權重】它是「值不值得打」的下限，不是
   * 一個要跟別人比重的項。交戰階段機會與威脅（各 0..1）主導，它只是墊底。
   */
  baseScore: number
  /** 「我在他尾後」的權重 */
  opportunityWeight: number
  /** 「他機首指著我」的權重 */
  threatWeight: number
  /** 距離折扣的特徵長度，m。分數在此距離折 `rangeWeight` 次半 */
  rangeScale: number
  /** 分攤折扣係數。1/crowdPenalty 是「分數折半所需的隊友鎖定數」 */
  crowdPenalty: number
  /**
   * **有射擊解時免除分攤折扣**的飽和點：`shotInstant` 達到此值即完全免除，
   * 之間線性內插。`0` = 關掉這條規則，完全回到舊行為。
   *
   * 【要解決什麼】人工驗收看到 AI 把一架**已經在槍口上、又近又正**的敵機
   * 丟掉，去追一架更遠、角度更差的，然後又切回來，週期 1~2 秒。
   *
   * 【量到的機制】20v20 實測，長機 271 次換目標裡有 **52 次（19.2%）**發生
   * 在「對舊目標仍有射擊解」的當下。把那 52 次的分數比拆成四個乘法因子：
   *
   * ```
   * 因子        新÷舊中位   >1.5 倍的比例
   * 幾何          1.00          10%
   * 距離折扣      0.86           8%
   * 分攤折扣      5.00          87%   ← 只有這一項
   * 轉向折扣      0.58           0%
   * ```
   *
   * 其他三項全部說「不該換」（新目標更遠 678→812 m、角度更差），全被這一項
   * 壓過去。5.00 不是巧合：舊目標鎖定數中位 2 → `1/(1+2×2) = 1/5`，新目標
   * 0 → `1`。**88% 的案例裡，被丟掉的那架身上有隊友。**
   *
   * 【它同時是「猶豫」的來源】`locks` 是整數，每多一個隊友鎖定就是一次
   * **不連續的** 3 倍跳變，而且是**別人的決定**造成的（`countLocks` 排除
   * 自己）。40 架互相推擠 → 長機 40.2% 的換目標是「換走又換回來」，持有
   * 時間中位剛好卡在 `minDwell` 下限 2.00 s。
   *
   * 【為什麼不是調參數】`crowdPenalty` 要降到 0.3 以下才壓得住跳變，但那樣
   * 分散就垮了（實測 0 時最大鎖定 17–20 架）；`switchMargin` 要拉到 2.0
   * 以上才擋得住，那 AI 對所有事情都變死心眼。兩個旋鈕方向相反、沒有中間
   * 值 —— 那是「機制缺一塊」的徵狀。
   *
   * 【分野照抄意圖層】`rules.ts` 的 `arbitrate` 已經學過同一課：「相對理由
   * （比他弱）→ 有槍在手就先開槍；絕對理由（我飛不動了）→ 開著槍也得走」。
   * **分攤是相對理由** —— 它談的是分工，不是這架敵機好不好打。分工該決定
   * 「一開始去哪」，不該把到手的機會讓出去。
   *
   * 【為什麼免除得跟著 `shotInstant` 連續變】門檻式的開關會在射擊解邊界
   * 製造新的跳變，那正是要修掉的病。與 `steer.ts` 的 `unloadPull` 同一手。
   *
   * ---
   *
   * ## 【已定位、未修】免除在真正的開火距離上幾乎不生效（2026-08-09）
   *
   * 專案負責人的原話：「明明已經有射擊解、我的槍口放在預瞄點上，結果開火
   * 1~2 秒後還是切去找別台敵機。」（他看的是自己按 `I` 代飛那一架，而玩家
   * 釘死在 `members[0]`，所以那是**長機**，走 `selectTarget`。）
   *
   * ### 它不是集火命令造成的 —— 這條假設被實測推翻
   *
   * `AiController:236` 對長機**無條件覆寫**目標（`focusTarget` 非 null 時
   * 繞過 `minDwell` / `switchMargin` / 本規則），看起來是頭號嫌犯。實測
   * （`test/tools/target-churn.probe.ts`，三種架數）：
   *
   * ```
   * 架數     長機「有槍解卻換走」  集火造成      selectTarget 造成
   * 20v20          25              0（0.0%）      25（100%）
   * 12v12          10              0（0.0%）      10（100%）
   *   8v8           4              0（0.0%）       4（100%）
   * ```
   *
   * **一次都不是。** 集火命令確實常在（長機 32.5% 的時間在它之下），但它
   * 指的目標通常就是 `selectTarget` 本來也會選的那一架。
   *
   * ### 真正的成因：分攤，而免除沒擋住它
   *
   * 把長機那一群單獨拆開，三個獨立實現一致：
   *
   * ```
   * 因子        20v20 新÷舊(>1.5倍)   12v12          8v8
   * geometry     1.05 (28%)          1.01 (30%)    1.21 (0%)
   * range        0.90 ( 0%)          0.94 (10%)    0.78 (0%)
   * crowd        4.00 (88%)          2.98 (100%)   4.11 (100%)   ← 只有這一項
   * turn         0.78 ( 0%)          0.85 ( 0%)    0.99 (0%)
   * 鎖定數中位    2 → 0               1 → 0         3 → 0
   * ```
   *
   * 其他每一項都在說「不該換」（新目標更遠、角度更差），全被分攤壓過去。
   * 而**這條規則存在的唯一目的就是免除分攤**。
   *
   * 【為什麼沒生效】免除吃 `threatFactor(self, enemy)`，而它含
   * `1 − range/THREAT_RANGE` 這個因子。同一群的舊目標**距離中位是 837 m**：
   *
   * ```
   * 距離     免除    分攤的新÷舊
   * ≤675 m   100%      1.00 ×
   *  800 m    44%      3.22 ×
   *  837 m    28%      3.88 ×   ← 實測中位 4.00 ×
   *  900 m     0%      5.00 ×
   * ```
   *
   * **免除只在 675 m 以內完全生效**（機首完美對準時），而 AI 真正被搶走
   * 目標的距離遠在那之外。預測的 3.88 與實測的 4.00 對得上
   * （`test/tools/shot-relief.probe.ts`）。
   *
   * ### 修法試過一版，代價太大，退回去了
   *
   * `assess.ts` 的 `alarmFactor` 正是「拿掉距離衰減、射程改由武器決定」的
   * 那一版 —— 它當初就是為了同一個病被造出來的（`threatFactor` 拿去當
   * `defend` 判準會變成「只有快被打死才閃」）。把免除改吃它，實測：
   *
   * ```
   * ai-targeting  持有時間中位   1.60 → 1.40   ✗ 門檻 1.5
   * multi-battle  開局巡航編隊誤差中位  403 m   ✗ 門檻 100 m（四倍）
   * ```
   *
   * **連症狀都沒改善**（持有時間反而更短）。成因是 `shotRelief = 0.25` 這個
   * 飽和點是為 `threatFactor` 那個小得多的量調的；換成 `alarmFactor` 之後
   * 「機首落在預瞄點 11.25° 內就完全免除，在子彈打得到的任何距離」——
   * 等於對所有有射擊解的人關掉分散機制。
   *
   * ### 下一步（需要專案負責人裁定）
   *
   * 方向大概是對的，缺的是**同時重掃 `shotRelief` 的飽和點**：換函數就得
   * 換尺度。但那是一次**分散機制的重新平衡**，會動到 `ai-targeting` 與
   * `multi-battle` 的既有門檻 —— 那不是實作者能自己定的，而且值得一份 spec。
   */
  shotRelief: number
  /**
   * 切換成本的特徵時間，s。轉向需時等於此值時折 `turnWeight` 次半。
   *
   * 【量級怎麼來的】4000 m、200 m/s、6 G 下瞬時轉彎率約 16.6°/s，轉 180°
   * 需 10.9 秒。取 4 s 約等於「轉 66° 就折半」。
   *
   * 【4 是**上界**，不是甜蜜點】20v20 掃描顯示代價愈重產出愈好：
   *
   * ```
   * scale / weight   後半球   開火    咬住    最大鎖定   其他測試
   *   8 / 2           31.7%  2.84%  14.6%      8       maxLocks 破
   *   4 / 1           27.9%  2.88%  14.6%      6
   *   4 / 2（選定）   25.6%  3.70%  17.4%      6       全綠
   *   3 / 2           27.5%  4.95%  20.4%      6       ✗ 見下
   *   4 / 3           23.9%  4.44%  19.9%      5       ✗ 見下
   *   2 / 2           24.2%  4.82%  21.4%      6       ✗ 20v20 一面倒
   *   1.5 / 2         26.7%  8.17%  23.3%      6       ✗ 見下
   * ```
   *
   * 【為什麼不取更重的】`ai-target.test.ts` 有一條「正前方但很遠的目標，
   * 輸給側面但很近的目標」—— 它守的是「切換成本**只是折扣**，不會讓飛機
   * 黏死」。代價再重一級（3/2）那條就紅：AI 會為了不轉 90° 而放掉近十倍
   * 的目標，那正是 M4 修掉的「撇頭拒絕交戰」。**4/2 是守得住那條不變式的
   * 最強設定。**
   */
  turnTimeScale: number
  /**
   * 三個折扣的**相對重要性**，作為指數：`1/(1 + x)^w`。
   *
   * 【為什麼是指數而不是係數】三個折扣是相乘的，取對數之後
   * `log 分數 = log 幾何 + Σ wᵢ·log 折扣ᵢ` —— 指數就是加權和裡的那個權重。
   * 語意也很直接：在特徵尺度上（x = 1）折扣恰好是 `2⁻ʷ`，所以 `w` 就是
   * 「到了特徵尺度要折幾次半」。`w = 0` 等於關掉這一項，`w = 1` 是原本的
   * 形狀 —— 既有把 `crowdPenalty` 設 0 來關掉分攤的測試完全不受影響。
   *
   * **`turnWeight` = 2：角度比距離重要。** 轉不轉得過去決定打不打得到，而
   * 距離只決定命中率。實測支持這個方向 —— 由 1 加到 2，開火時間 2.88% →
   * 3.70%、咬得住 14.6% → 17.4%。**再加到 3 就破了「切換成本只是折扣」
   * 那條不變式**（見 `turnTimeScale` 的掃描表）。
   *
   * `rangeWeight` 與 `crowdWeight` 維持 1：它們的特徵尺度（`rangeScale`、
   * `crowdPenalty`）是實測定案的，改指數等於連帶改掉那次量測的結論。
   * `crowdWeight` 掃過 2，開火時間反而掉近四成（5.28% → 3.62%）—— 折得
   * 太狠，AI 開始為了避開隊友而挑不該打的目標。
   */
  rangeWeight: number
  crowdWeight: number
  turnWeight: number
  /**
   * 視野折扣的指數。**只咬後半球**；`0` = 關掉這一項。
   *
   * ```
   * vis(θ) = visionFloor + (1 − visionFloor) · min(1, 1 + cos θ)^visionPower
   * ```
   *
   * θ 是**航跡**與視線的夾角（`assess.ts` 的 `trackAngle`，與 `turnTime`
   * 同一個角）。θ ≤ 90° 時 `1 + cos θ ≥ 1`，夾成 1 —— **前半球一個字都不動**。
   *
   * ## 為什麼需要它：`turnDiscount` 對後半球太寬容
   *
   * 專案負責人 2026-08-09 回報「AI 還是會在兩個敵人之間猶豫」，並提議
   * 「在我背後的扣分」。量測（`test/tools/target-churn.probe.ts`，20v20、
   * 150 s）：**29.6% 的換目標換去後半球**（90–120° 13.5%、120–150° 10.6%、
   * 150–180° 5.5%），而且 52.7% 的換目標讓離軸角變差。
   *
   * 成因是 `turnDiscount` 在後半球太平。P-51D 於 4000 m、TAS 200（瞬時
   * 迴旋率 22.3°/s）：
   *
   * ```
   * 離軸角    0°     57°(中位)   90°     120°    180°
   * 折扣    1.000     0.372     0.248   0.182   0.110
   * ```
   *
   * 由 57° 到正後方只損失 **3.4 倍**，而分攤折扣每多一個隊友鎖定就是
   * **3.0 倍** —— **「正後方、沒人鎖」與「57°、有一個隊友鎖著」幾乎等價**。
   * 掉頭去追後方因此是划算的。
   *
   * ## 為什麼只咬後半球，而不是全域的斜坡
   *
   * 初版設計的是全域 `((1+cos θ)/2)^k` 斜坡。**算過才發現它必定打破
   * `ai-target.test.ts` 的「正前方但很遠的目標，輸給側面但很近的目標」**
   * —— 那條守的是「切換成本只是折扣，不會讓飛機黏死」，也正是當年殺掉
   * `turnWeight = 3` 的同一條。實算（`test/tools/vision-shape.probe.ts`）：
   *
   * ```
   * 形狀                      餘裕（必須 > 1）
   * 現行                          1.203
   * 全域 k=1 下限 0.15            0.692   ✗
   * 全域 k=2 下限 0.10            0.391   ✗
   * 全域 k=3 下限 0.05            0.203   ✗
   * 後半球 k=2 下限 0.10          1.203   ✓ 一絲未動
   * ```
   *
   * 那條的餘裕本來只有 1.203 倍，而全域斜坡會打側面的近目標、卻完全不打
   * 正前方的遠目標。**只咬後半球的形狀在 90° 恰好等於 1，所以它結構上
   * 不可能動到那條不變式**，而後半球的壓制力反而更強（180° 33.9 倍
   * 對全域 k=2 的 21.6 倍）。
   *
   * ## 為什麼下限不能是 0
   *
   * 三個折扣都是乘法。若視野項在 180° 歸零，全部候選都會被乘成 0，選擇
   * 退化成「取掃描時第一個碰到的」—— 那正是 `baseScore` 的註解記下的那個
   * 缺陷。下限讓「背後」是**很差**而不是**不存在**。
   *
   * ## 實測 A/B（150 s、種子 20260805，`visionPower` 0 → 2）
   *
   * ```
   * 架數     換去後半球        A→B→A            rearShare        總換（活著）
   * 20v20   29.6% → 25.0%   19.0% → 25.9%   28.3% → 23.3%    733 → 704
   * 12v12   41.9% → 34.0%   23.5% → 26.4%   40.6% → 31.7%    439 → 535
   *   8v8   41.2% → 40.6%   23.5% → 27.6%   39.8% → 36.5%    277 → 340
   * ```
   *
   * **它做到了它被設計來做的事**：後方追逐三場全降，深後方的桶也縮了
   * （20v20 的 120–150° 由 10.6% 到 8.1%、150–180° 由 5.5% 到 4.1%）。
   *
   * **但它讓「猶豫」變差，六場六場**（長機 18.0→25.4、29.3→35.1、
   * 10.0→28.6），而且小場次的總換目標次數還上升。
   *
   * ## 為什麼會反向 —— 與 `engagedMargin` 同一個成因
   *
   * `trackAngle` 是**我自己速度向量**的方向，硬機動時以約 22°/s 在變。
   * 視野項在後半球 90° 的跨度內橫跨十倍，等於**每秒 2.6 倍**的變化率，
   * 而換敵門檻只有 1.25 倍。又一次把**快變量**接到**慢決策**上 ——
   * 前一次是 `threatFactor`（15° 錐，閃爍），這次是 `trackAngle` 配陡響應。
   *
   * `assess.ts` 的 `turnTime` 也吃同一個角，但它的響應很緩（0 到 180° 全程
   * 只有 9 倍且平滑），所以不會這樣。**這一層扛不住任何幾何量的陡響應**：
   * 所有幾何量都在機動的時間尺度（約 1 秒）上變，而決策的停留是 2 秒。
   *
   * 兩次改動、兩次同樣的失敗模式 —— 那不是參數問題，是**修猶豫的地方不在
   * 評分的形狀，在決策層本身**（節拍、遲滯、或把輸入時間平均掉）。
   *
   * ## 預設為什麼是 0
   *
   * 這是一個**方向相反的取捨** —— 專案負責人同時抱怨過後方追逐與猶豫，
   * 而這一項讓前者變好、後者變差。哪一個比較重要是他的裁定。預設 0 讓行為
   * 與加入這一項之前**逐位元相同**（乘以 1.0），要開只需把 0 改成 2。
   */
  visionPower: number
  /** 視野折扣在正後方的下限。**必須 > 0**，理由見 `visionPower` */
  visionFloor: number
  /** 新目標要好過現任的比例才換 */
  switchMargin: number
  /** 換過之後不再換的秒數 */
  minDwell: number
}

/**
 * ## 沒有實作就先否決的：反轉的越權換目標（2026-08-06）
 *
 * `2026-08-05-ai-defence-batch2-design.md` §3.4 設計過一個 `TargetState.urgent`：
 * 攻擊者衝過頭時把他的索引寫進去，讓 `selectTarget` **略過 `minDwell` 與
 * `switchMargin`** 直接換過去（「放行一次，但不放水」——分數沒有比較高就不換）。
 *
 * **量了才發現它解決的是一個不存在的問題。** 受控場景（三架前後咬、紅 B 起始
 * TAS 280、六種被咬幾何、120 秒）：紅 B 真的衝到藍方前半球 500 m 內的那些
 * 取樣裡，**藍方的目標 100% 已經是紅 B** —— 零延遲與 0.3 s 延遲、六個場景
 * 全部。他又近、離軸角又差，正常評分本來就把他排到第一，遲滯根本沒有擋住。
 *
 * 所以不加 `urgent`。**這也免掉了 spec §6.4 那條風險**：越權換目標會鬆動
 * 20v20 好不容易穩定下來的 A→B→A 猶豫（214 → 88 → 加入閃躲後 188）。
 *
 * 反轉提案的另一半（瞄準）的量測與否決理由記在 `steer.ts` 的 `DEFAULT_STEER`。
 *
 * ---
 *
 * ## 實作了、量了、退回去的：開火中的換敵門檻（2026-08-09）
 *
 * 專案負責人回報「AI 還是會在兩個敵人之間猶豫」，提三件事：提高換敵成本、
 * 敵人在瞄準點角度內越近分數越高、在背後的扣分。量測工具是
 * `test/tools/target-churn.probe.ts`（它會自我檢查算的是不是真正在跑的公式）。
 *
 * ### 一、後兩項是同一個量，而且**已經在跑** —— 它只是太平
 *
 * 「瞄準點角度內加分」與「背後扣分」是離軸角的兩端，那就是 `turnDiscount`
 * （`turnTime` 量的正是「速度向量要轉幾度才指到他」），而且權重最重。
 * P-51 在 ~32°/s 下：
 *
 * ```
 * 離軸角    0°     57°(中位)   90°     180°
 * 折扣    1.00      0.48      0.35     0.17
 * ```
 *
 * 由 57° 惡化到 90° 只損失 **1.38 倍**，而 `switchMargin` 是 1.25 倍 ——
 * 兩者幾乎抵銷。實測 **52.7% 的換目標讓離軸角變差**（三種架數：52.7 / 52.8
 * / 50.9%），那不是巧合。而正後方仍留著 17% 的分數，同時分攤折扣每多一個
 * 隊友鎖定就是 3 倍跳變 —— **一個隊友的鎖定就足以讓正後方的敵機有競爭力**。
 *
 * `turnWeight` = 3 已經試過並否決（見 `turnTimeScale` 的掃描表）。**能動的
 * 是形狀，不是權重。**
 *
 * ### 二、第一項照 Dicta Boelcke 第二條做了，量完退回去
 *
 * 平的 `switchMargin` / `minDwell` 已無空間（79.4% 的持有時間貼在下限、長機
 * 中位剛好 2.00 s）。史實的教條不是「少換目標」而是「**開火中**不換」——
 * Boelcke 第二條「一旦開始攻擊就要打完」。實作是 `engagedMargin`：換敵門檻
 * 隨對**現任**目標的射擊解連續加碼，與 `shotRelief` 共用飽和點。
 *
 * 20v20 掃描（0 / 0.5 / 1 / 2 / 4）在 2 的時候把「有槍解卻換走」由 74 壓到
 * 42。**但換架數重驗就垮了**：
 *
 * ```
 * 架數     有槍解卻換走 0→2      A→B→A 0→2        rearShare(0→2)
 * 20v20     74 → 42（−43%）    19.0% → 21.6%     28.3% → 35.5%  ← 破 0.35
 * 12v12     37 → 36（ −3%）    23.5% → 26.4%
 *   8v8     45 → 31（−31%）    23.5% → 32.8%
 * ```
 *
 * 目標指標 −43 / −3 / −31%：**重現不了**。而專案負責人抱怨的那件事
 * （A→B→A）在**掃描的五列與獨立實現的三組、八列裡八列變差**。20v20 的
 * `rearShare` 還打破了 `ai-targeting.test.ts` 的 0.35。整組退回。
 *
 * ### 三、為什麼會反向 —— 這一課這個專案已經學過一次
 *
 * `threatFactor` 是一個**瞬時**量：它要求機首落在 15° 錐內，所以會閃爍。
 * 把它接到**遲滯門檻**上，等於讓門檻自己閃爍，而閃爍的門檻**製造**來回切換。
 *
 * `assess.ts` 的 `turnTime` 在 2026-08-05 正是為了同一件事由「瞬時機首」
 * 改成「速度向量」，那段註解寫著：**慢的決策要用慢的輸入**。這次是同一個
 * 錯誤換一個位置犯。
 *
 * 【下一個假設，還沒做】要表達「我正在打他」，該用**慢**的量 —— AiController
 * 已經維護的持續跟蹤計時器（`trackingFactor`）而不是瞬時的 `threatFactor`。
 * 那要改 `selectTarget` 的簽名，不再是小修改。
 *
 * ### 四、第二次嘗試：視野折扣（實作了、量了、預設關掉）
 *
 * 第一項的另一半 ——「背後扣分」—— 做成 `visionPower` / `visionFloor`，只咬
 * 後半球。**它做到了它被設計來做的事**（後方追逐三場全降），**但 A→B→A
 * 六場六場變差**。完整的 A/B 表與成因寫在 `TargetConfig.visionPower`。
 *
 * 成因與 `engagedMargin` **完全相同**：`trackAngle` 在硬機動時以 22°/s 在變，
 * 而視野項在後半球的 90° 跨度內橫跨十倍 —— 每秒 2.6 倍，遠大於 1.25 倍的
 * 換敵門檻。又是快變量餵慢決策。
 *
 * **兩次改動、兩次同一個失敗模式，這已經不是參數問題。** 這一層扛不住任何
 * 幾何量的陡響應：所有幾何量都在機動的時間尺度（約 1 秒）上變，而決策的
 * 停留是 2 秒。修猶豫的地方不在評分的形狀，在**決策層本身** —— 節拍、遲滯、
 * 或把輸入時間平均掉。下一次動手應該從那裡開始，不要再改分數的形狀。
 *
 * 視野折扣**預設 0（關掉）**，行為與加它之前逐位元相同。它是一個方向相反的
 * 取捨，開不開是專案負責人的裁定。
 *
 * ### 五、順帶量到的結構事實
 *
 * **`selectTarget` 只碰得到三分之一的換目標。** 僚機的目標是跟著長機或吃
 * 集火命令的（`AiController` 直接寫 `this.target`），完全繞過遲滯 ——
 * 733 次「舊目標還活著」的換目標裡長機只佔 228 次（31%）。而長機換一次，
 * 底下最多跟著換三次：非長機 505 ÷ 長機 228 ≈ 2.2。**畫面上看到的猶豫
 * 大約是長機猶豫的三倍**，改評分只動得到源頭那一份。
 */

/**
 * 全部由 20v20 跑滿 60 秒的實測定案（M5 spec §14）。掃描資料：
 *
 * ```
 * crowdPenalty   最大鎖定  換目標  損失藍/紅        threatWeight  最大鎖定
 *   0              17       202     18 / 1            0             20
 *   0.5             4       564      5 / 1            0.5            3
 *   1               3       506      4 / 2            1              3
 *   2               3       547      3 / 1            2              4
 *   4               2       470      1 / 0            4              5
 *
 * switchMargin  換目標  損失      minDwell  換目標    rangeScale  換目標
 *   0            718     0 / 0      0.5      593        200        570
 *   0.1          600     2 / 2      1        649        400        506
 *   0.25         506     4 / 2      2        506        800        539
 *   0.5          375     1 / 3      4        392       1600        526
 *   1            387     1 / 3
 * ```
 *
 * 【`threatWeight` = 1，而且它本身**曾經**是分散機制】關掉它（0）會讓
 * **20 架全部撲同一個目標** —— 比 `crowdPenalty` = 0 還糟。原因是只剩機會
 * 項時，所有人對「誰最背對我」的評價幾乎一樣；而「誰正在打我」是每架各自
 * 不同的。這一點 spec §6.2 沒有預見到。往上加到 2、4 反而讓最大鎖定回升到
 * 4、5 ——大家改成一起撲「最兇的那一架」。取 1，與機會項等重。
 *
 * 【`rangeScale` = 400 m】M2 的匯聚點在 300 m，1944 年的實戰有效射程也在
 * 400 m 以內 —— 「打得到的距離」就是這個量級。掃描顯示這一項不敏感
 * （200 到 1600 之間換目標次數只在 506–570 之間）。
 *
 * ---
 *
 * ## 2026-08-05 重測（20v20 跑滿 150 秒）
 *
 * 威脅項改用 `assess.ts` 的嚴格定義之後，上面那個「`threatWeight` 就是分散
 * 機制」的結論**不再成立** —— 嚴格定義在 `THREAT_RANGE` 之外恆為 0，而開局
 * 25 秒的接近航程全部落在那之外。詳見 `baseScore` 的註解。以下重掃：
 *
 * ```
 * baseScore（cp = 1）  最大鎖定  持有  後半球  開火    咬住
 *   0.2                   8      1.90  29.5%   5.28%  20.2%
 *   0.3                   8      1.90  29.7%   4.81%  18.1%
 *   0.4                   8      1.90  27.1%   5.20%  19.6%
 *   0.5                   6      2.00  27.1%   7.90%  24.2%
 *   0.6                   6      1.70  28.4%   4.49%  19.2%
 *   0.8                   7      1.80  28.4%   4.10%  17.9%
 *   1.0                   6      2.00  28.1%   6.63%  21.7%
 *
 * crowdPenalty / crowdWeight（base = 0.2）      最大鎖定  開火    咬住
 *   1 / 1                                          8      5.28%  20.2%
 *   1 / 2                                          6      3.62%  15.3%
 *   2 / 1                                          6      5.00%  18.8%
 *   2 / 2                                          7      3.05%  15.9%
 *   4 / 1                                          6      3.38%  17.9%
 *   4 / 2                                          6      3.19%  16.9%
 *
 * 選定（cp = 2、cw = 1、base = 0.5）             最大鎖定  開火    咬住
 *                                                  6      6.15%  21.1%
 * ```
 *
 * 【`crowdPenalty` 由 1 改成 2】M5 的掃描裡 1 與 2 同樣把最大鎖定壓到 3，
 * 當時取 1 只因為語意較乾淨。現在需要它多出力：**最大鎖定對 `baseScore`
 * 的反應是非單調的**（0.4 → 8、0.5 → 6、0.6 → 6、0.8 → 7），對
 * `crowdPenalty` 則穩定 —— 所以分散的功勞歸分攤，`baseScore` 不該被當成
 * 分散旋鈕來調。
 *
 * 【`crowdWeight` = 1】2 反而讓開火時間掉將近四成（5.28% → 3.62%）：折得
 * 太狠，AI 開始為了避開隊友而挑不該打的目標。
 *
 * 【`baseScore` = 0.5 的 7.90% 是孤峰，不要當成證據】鄰居 0.4 與 0.6 分別
 * 只有 5.20% 與 4.49%。這個模擬是**全決定性的**（種子只決定飛行員名字，
 * 三個種子跑出來逐字相同），所以那是對參數的混沌敏感，不是「0.5 比較好」。
 * 選 0.5 的理由是它在 cp = 2 之下，於每一個被守的指標上都優於 0.2。
 *
 * 【`switchMargin` = 0.25】0 的時候換目標 718 次，而且**雙方 60 秒都掛零**
 * —— 一直在改主意的 AI 誰也殺不掉。0.5 以上換得少但變得死心眼。0.25 是
 * 兩邊都還打得死人的位置。
 *
 * 【`minDwell` = 2 s】掃描顯示 0.5–4 s 之間沒有明確趨勢（換目標次數
 * 392–649，不單調）—— 這一項的量測**沒有給出強訊號**，值得記下來。取 2 s
 * 的理由是它約等於 20 個決策節拍，長到一次目標變更撐得過一個機動。
 */
export const DEFAULT_TARGET: TargetConfig = {
  baseScore: 0.5,
  opportunityWeight: 1,
  threatWeight: 1,
  rangeScale: 400,
  crowdPenalty: 2,
  shotRelief: 0.25,
  turnTimeScale: 4,
  rangeWeight: 1,
  crowdWeight: 1,
  turnWeight: 2,
  // 【預設關掉，2026-08-09】做完也量完了，但它是一個**方向相反的取捨**：
  // 後方追逐變好、A→B→A 變差。哪一個比較重要是專案負責人的裁定，不是
  // 實作者的。要開就把這個 0 改成 2 —— 見 `visionPower` 的 A/B 表。
  visionPower: 0,
  visionFloor: 0.1,
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
 *   機會 = max(0, b)             —— 1 = 我正咬著他
 *   威脅 = threatFactor(他, 我)  —— 1 = 他真的打得到我
 *
 * 【機會項為什麼取正部而不是 0.5(1 ± b)】後者相加恆等於 1，代進評分只剩
 * `0.5(ow+tw) + 0.5(ow−tw)·b` —— 兩個權重退化成一個自由度，而且是 b 的
 * 線性函數。但要的是「我咬住他」與「他咬住我」**兩端都加分**、側面不加分，
 * 那是 V 形不是直線。
 *
 * 【威脅項為什麼不是 max(0, −b) 的對稱形】那個形狀只問「敵機首朝不朝我」，
 * 不管距離、不管有沒有預瞄解、不管機首在不在射擊錐內 —— 三公里外一架剛好
 * 朝我飛的敵機，在它眼裡跟貼著我開火的一樣危險。「誰在威脅誰」在
 * `assess.ts` 已經有一個真正的答案，這裡再造一個近似就是**兩個答案**
 * （spec §6.1）。
 *
 * 【為什麼三個因子全是折扣形式】分攤原本設計成減法，分數會變負；而換目標
 * 門檻是乘法的（`> 現任 × (1 + margin)`），現任為負時乘 1.25 會**更負**，
 * 門檻反而變低 —— 遲滯在最需要它的時候失效。統一成 `1/(1 + k·x)` 之後
 * score 恆 ≥ 0，乘法門檻在整個定義域上單調。
 *
 * 熱路徑：不配置。不修改 self 與 enemy。
 */
export function targetScore(
  self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig, priority = 1,
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
  // 【威脅用 assess.ts 那個真正的定義】要有預瞄解、機首在 15° 錐內、
  // 900 m 內。M6 spec §7.2 明確要求「不要有兩個對『誰在威脅誰』的答案」
  // —— 那條紀律漏了這裡（spec §6.1）。
  //
  // 【雙重折扣是刻意的】threatFactor 內含距離因子，而下面還有一層
  // rangeDiscount，威脅項因此被折扣兩次。方向正確 —— 現在的病正是遠處
  // 的「威脅」被高估。
  const threat = threatFactor(enemy, self)

  // 【底價在這裡】少了它，接近階段三項幾何全是 0，下面三個折扣就沒有
  // 東西可折 —— 見 `TargetConfig.baseScore`
  const geometry = cfg.baseScore
    + cfg.opportunityWeight * opportunity
    + cfg.threatWeight * threat

  const rangeDiscount = discount(range / cfg.rangeScale, cfg.rangeWeight)

  // 【有射擊解就不讓位】分攤是「相對理由」—— 它談的是分工，不是這架敵機
  // 好不好打。已經咬住了還為了避開隊友而放掉，就是意圖層在 `arbitrate`
  // 修掉的那個錯誤（見 `TargetConfig.shotRelief`）。
  //
  // 【免除是連續的】`shotInstant` 由 0 升到 `shotRelief` 之間線性內插，
  // 邊界上不跳 —— 門檻式的開關只會把跳變搬個位置。
  const relief = cfg.shotRelief > 0
    ? Math.min(1, threatFactor(self, enemy) / cfg.shotRelief)
    : 0
  const crowdDiscount = discount(cfg.crowdPenalty * locks * (1 - relief), cfg.crowdWeight)
  // 【切換成本】turnTime 為 Infinity 時折扣為 0 —— 轉不動的目標不該被選
  const turnDiscount = discount(turnTime(self, enemy) / cfg.turnTimeScale, cfg.turnWeight)
  // 【視野】只咬後半球。轉向折扣在那裡太平 —— 見 `TargetConfig.visionPower`
  //
  // 【關掉時連角度都不算】`visionFactor` 自己也擋 0，但那擋的是回傳值；
  // `trackAngle` 的 acos 仍然會跑。預設是關的（待裁定），所以這裡短路掉 ——
  // 10 Hz × 每架 × 每個候選，關著的規則不該收費。
  const visionDiscount = cfg.visionPower === 0
    ? 1
    : visionFactor(trackAngle(self, enemy), cfg)
  // 【任務加權是最後一道乘法】理由見 `TargetBoard.priority`：它與幾何無關，
  // 是關卡說「這一架比較值錢」。乘在最後才不會被任何一個折扣稀釋掉。
  return geometry * rangeDiscount * crowdDiscount * turnDiscount * visionDiscount * priority
}

/**
 * 視野折扣，`(visionFloor, 1]`。**θ ≤ 90° 時恆為 1。**
 *
 * @param angle 航跡與視線的夾角，rad（`assess.ts` 的 `trackAngle`）
 *
 * 【為什麼抽成純函數】它的三條性質決定這條規則成不成立，而 `targetScore`
 * 要建兩架飛機才跑得動，在那裡驗不乾淨：
 *
 *   一、前半球恆為 1 —— 這是它不會打破「切換成本只是折扣」那條不變式的**結構
 *       保證**，不是碰巧（見 `TargetConfig.visionPower` 的實算表）。
 *   二、單調遞減，而且在 90° 沒有轉折以外的跳變 —— 硬截斷這個專案吃過虧。
 *   三、下限恆 > 0 —— 歸零會讓乘法把全部候選壓成 0，選擇退化。
 *
 * 與 `discount`、`trackingFactor` 是同一個做法。
 */
export function visionFactor(angle: number, cfg: TargetConfig): number {
  if (cfg.visionPower === 0) return 1
  // 【夾在 1】θ ≤ 90° 時 1 + cos θ ≥ 1，前半球因此一個字都不動
  const u = Math.min(1, 1 + Math.cos(angle))
  const rear = u > 0 ? Math.pow(u, cfg.visionPower) : 0
  return cfg.visionFloor + (1 - cfg.visionFloor) * rear
}

/**
 * 折扣因子 `1/(1 + x)^w`，恆在 [0, 1]。
 *
 * `w` 是這一項的相對重要性：在特徵尺度上（x = 1）折扣恰好是 `2⁻ʷ`。
 * `w = 0` 關掉這一項、`w = 1` 是最原始的形狀。
 *
 * 【x 為 Infinity 時回 0】`turnTime` 轉不動時回 `Infinity`，那樣的目標不該
 * 被選 —— `1/(1+∞) = 0`，再取任何正指數仍是 0。
 */
function discount(x: number, w: number): number {
  if (w === 0) return 1
  if (!(x > 0)) return 1
  const d = 1 / (1 + x)
  return w === 1 ? d : Math.pow(d, w)
}

/**
 * 一個候選目標。
 *
 * 【為什麼另外定義而不是直接用 Combatant】`World.Combatant` 在結構上滿足
 * 這個介面，但 `target.ts` 不需要知道世界是怎麼組裝的（射速時鐘、包圍球
 * 半徑、出生點都與選目標無關）。`Team` 以 `import type` 取得 —— 型別匯入
 * 會被完全抹除，不產生執行期相依。
 */
export interface TargetCandidate {
  /** **必須等於它在 candidates 陣列裡的位置**。`createTargetBoard` 會檢查 */
  readonly index: number
  readonly aircraft: Aircraft
  readonly team: Team
  alive: boolean
}

/** 全場共享的目標指派板（M5 spec §6.3）。 */
export interface TargetBoard {
  readonly candidates: readonly TargetCandidate[]
  /** `assignments[i]` = 第 i 架正在鎖定的候選索引；−1 = 無 */
  readonly assignments: Int32Array
  /**
   * `flightOf[i]` = 第 i 架屬於哪個編隊；**−1 = 不屬於任何編隊**（不是
   * 「同屬第 −1 隊」—— 兩架獨行俠彼此仍是外人，見 `countLocks`）。
   *
   * 【為什麼是一條資料而不是一個相依】`src/ai/` 不准 import `src/battle/`。
   * 這裡收的是 `FlightIndex.flightOf` **那一個實體**，`compactFlights` 每個
   * 物理步就地重填，所以永遠是當步的編制，不需要同步。
   */
  readonly flightOf: Int32Array
  /**
   * `priority[i]` = 打第 i 架**值幾倍**。1 = 與一般敵機同分，**預設全 1**。
   *
   * 【它解決的是什麼】護航機把攔截方的目標全部吸走：實測 4 架 P-51 對上
   * 「2 或 4 架 Bf109 + 4 架 He 111」，轟炸機**一發都不會挨到**
   * （`docs/backlog.md` §2.26）。原因是 `targetScore` 只看威脅與幾何，而
   * 護航機兩者都更強 —— 它會還手、而且擺在更高更近的位置。「這一關的目標
   * 是轟炸機」這件事在評分裡完全不存在。
   *
   * 【為什麼是一條資料而不是一個相依】與 `flightOf` 一模一樣的理由：
   * `src/ai/` 不准 import `src/battle/`，而「誰是這一關的目標」是編組表
   * （`duty === 'transit'`）說了算。這裡收的是一個由 `battle` 層填好的
   * 陣列，AI 只管乘。
   *
   * 【為什麼是乘法而不是加法】`targetScore` 恆非負，而換目標門檻是乘法的
   * （`bestScore > curScore × (1 + margin)`）。乘一個正數不動零點、不動
   * 單調性，遲滯照舊；加法會把「分數為 0 的候選」也抬起來，那些正是幾何
   * 上完全打不到的目標。
   *
   * 【它是每一關自己的旋鈕】值由 `BattleConfig.tuning` 給，見那裡。
   */
  readonly priority: Float64Array
}

/**
 * 建立指派板。
 *
 * 【為什麼要檢查 index 與位置一致】`assignments` 用陣列位置索引、
 * `TargetState.current` 存的也是位置，而 `Combatant.index` 是 `World.add`
 * 給的遞增序號。兩者恆等（`add` 就是用 `combatants.length` 當 index），但
 * 「恆等」若沒有被檢查，某天有人插入一架就會變成無聲的錯位 —— 所有 AI 都
 * 會鎖到隔壁那一架。設定期檢查一次，成本為零。
 *
 * @param flightOf 每一架的編隊索引（見 `TargetBoard.flightOf`）。**省略等於
 * 全部 −1**，也就是「沒有編制」—— `countLocks` 逐字回到分編隊之前的行為。
 * 單元測試多半不需要編制，所以預設就是那一個。
 */
export function createTargetBoard(
  candidates: readonly TargetCandidate[], flightOf?: Int32Array, priority?: Float64Array,
): TargetBoard {
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.index !== i) {
      throw new Error(
        `TargetCandidate.index 必須等於陣列位置：第 ${i} 個是 ${candidates[i]!.index}`,
      )
    }
  }
  if (flightOf !== undefined && flightOf.length !== candidates.length) {
    throw new Error(
      `flightOf 長度必須等於候選數：${flightOf.length} vs ${candidates.length}`,
    )
  }
  if (priority !== undefined && priority.length !== candidates.length) {
    throw new Error(
      `priority 長度必須等於候選數：${priority.length} vs ${candidates.length}`,
    )
  }
  return {
    candidates,
    assignments: new Int32Array(candidates.length).fill(-1),
    flightOf: flightOf ?? new Int32Array(candidates.length).fill(-1),
    // 【省略等於全 1】也就是「每一架都一樣值錢」—— 遭遇戰與殲滅任務逐字
    // 回到加這個欄位之前的行為
    priority: priority ?? new Float64Array(candidates.length).fill(1),
  }
}

/**
 * 有幾架**同隊且存活**的飛機正鎖定 `candidateIndex`，不含 `selfIndex` 自己，
 * 也**不含與 `selfIndex` 同一個編隊的**（`board.flightOf`；全 −1 時等於沒有
 * 編制，逐字回到分編隊之前的行為 —— 那就是 `setup.ts` 目前的接法）。
 *
 * 【為什麼每次重掃而不是維護一個增減計數器】計數器要求每一次「放棄目標」
 * 都配一次遞減 —— 陣亡、撞地、重置、換目標各是一條路徑，漏掉任何一條就
 * 留下一個永遠不會消失的幽靈鎖定，而症狀（大家都不打那一架）離成因很遠。
 * 重掃是 O(N)，40 架 × 10 Hz = 每秒 16,000 次整數比較，而且**自我修復**：
 * 任何錯誤的指派都會在下一拍被沖掉。
 *
 * 【為什麼要限定同隊】`assignments` 是全場共用一份。不限定的話，紅隊鎖定
 * 某架紅機（不該發生，但這是一條資料而不是一條保證）會污染藍隊的統計。
 *
 * ---
 *
 * ## 【已做好、預設關】計數單位是「架」，於是長機被自己的僚機罰（2026-08-10）
 *
 * 這個函數的計數單位是**每一架同隊飛機**，全隊一起數，看不見小隊。而
 * `wingman.ts` 的 LEVEL_FOCUS 是「打站位參考機正在打的那一架」，並把結果
 * 寫回同一份 `assignments`（`wingman.ts:234`）。兩者接起來就是一個回授迴路：
 *
 * ```
 * 長機選中 A → 僚機跟上也鎖 A → countLocks(A) 從 0 變 2~3
 *            → A 的分攤折扣塌成 1/5 → 長機換走 → 僚機跟著換 → …
 * ```
 *
 * **長機是被自己的僚機罰的。** 實測（`test/tools/target-churn.probe.ts`，
 * 150 s）：
 *
 * ```
 * 架數    全場鎖定裡同小隊佔比   長機「有槍解卻換走」時舊目標身上的鎖定
 *                                中位  其中同小隊  全部來自同小隊的比例
 * 20v20        76.7%              2       2            87.5%
 * 12v12        75.2%              1       1            80.0%
 *   8v8        79.7%              3       3            75.0%
 * ```
 *
 * 也就是**四分之三以上的分攤壓力來自自己的小隊** —— 而那正是編隊該做的事。
 * Dicta Boelcke 第八條「避免兩人打同一個對手」談的是兩次**攻擊**，不是長機
 * 與他的僚機（那是一次攻擊）。分攤要數的單位應該是**小隊**，不是飛機。
 *
 * ### 專案負責人 2026-08-10 裁定打開（`setup.ts` 傳 `flights.flightOf`）
 *
 * `src/ai/` 不准 import `src/battle/`，所以這裡不能認識 `FlightIndex`；
 * `TargetBoard.flightOf` 收的是一條 `Int32Array`，是資料不是相依。
 *
 * 【打開之後量到什麼】20v20、150 s、與 `multi-battle` 逐字相同的假駕駛：
 *
 * ```
 * 判準                        每一架都數   不數同小隊
 * 長機「有槍解卻換走」（20/12/8v8）  25/10/4      3/2/0    ← 專案負責人看到的那一幕
 * 換目標總數（20v20）              742          454
 * 長機持有時間中位                2.00 s       5.70 s
 * 貼在 minDwell 下限              79.4%        55.7%
 * 最大鎖定數                        8            6        ← 分散反而更好
 * 鎖定堆疊次數                      2            0
 * 命中事件                        402          534        ← 咬得住，打得中
 * 開局 20 s 的站位誤差中位        26.8 m       26.8 m      ← 編隊完全沒受影響
 * ```
 *
 * ### 它同時改掉整場戰鬥的樣貌 —— 三件已知的連帶
 *
 * **一、兩隊不再塌成一團。** 重心在 150 s 內再也沒有靠到 900 m 以內（原本
 * 38.1 s 就合流）：各分隊咬住自己的目標各打各的。`multi-battle`「開局巡航時
 * 編隊維持得住」因此紅了 —— 它是用「重心靠攏」判定巡航結束的，視窗把整場
 * 混戰吞了進去（取樣 22,860 → 72,554、中位 69.7 → 383.9 m）。**編隊本身沒
 * 散**：依時間切窗量，開局 20 s 兩者同為 26.8 m。判準已改成「第一對敵我靠
 * 到 `THREAT_RANGE` 以內」（`nearestEnemyGap`），改後兩組**逐位元相同**
 * （14,400 樣本、中位 36.27278367275964 m），而且比舊判準更嚴。
 *
 * **二、傷害對比由 藍 9,223 / 紅 3,852（2.39 倍）變成 7,395 / 7,534
 * （1.02 倍）。** 損失 8:2 變成 6:5。P-51 不再一面倒地挨打。
 *
 * **三、撤退令不再發出（2 張 → 0 張／300 s）。** 量過兩道閘
 * （`test/tools/command-trigger.probe.ts`）：閒置那道**沒有變**（達
 * `idleSeconds` 的取樣比例 23.8% → 24.3%），變的是能量那道 —— 見底計時的
 * 最大值 10.3 s → 5.2 s。少了瞎換目標，飛機就少了把能量甩掉的機會。
 * `ai-command-channel` 與 `ai-withdraw-anchor` 那兩條**本來就紅**（0.0220、
 * 0.0431，門檻 0.05），現在由「樣本太小」變成「沒有樣本」。
 * `ai-command-tactics` 的集火與側翼同樣本來就紅，兩者的成因尚未查明。
 */
export function countLocks(
  board: TargetBoard, team: Team, selfIndex: number, candidateIndex: number,
): number {
  const { candidates, assignments, flightOf } = board
  // 【−1 不合併】「不屬於任何編隊」不是一個編隊。兩架獨行俠彼此仍是外人，
  // 所以自己沒有編制時這個條件恆假，逐字回到分編隊之前的行為
  const selfFlight = selfIndex >= 0 && selfIndex < flightOf.length
    ? flightOf[selfIndex]!
    : -1
  let n = 0
  for (let i = 0; i < assignments.length; i++) {
    if (i === selfIndex) continue
    if (assignments[i]! !== candidateIndex) continue
    if (selfFlight >= 0 && flightOf[i] === selfFlight) continue
    const c = candidates[i]
    if (c === undefined || !c.alive || c.team !== team) continue
    n++
  }
  return n
}

/**
 * 一架 AI 的目標選擇狀態。**這是遲滯的記憶**。
 *
 * 【只能由 selectTarget 自己寫】M4 在遲滯上踩過一個坑：`latch` 的 OR 結果
 * 被寫回它自己的記憶，遲滯因此被毒化，0.29°/s 的雜訊就能讓閂鎖永遠關不掉。
 * 教訓是遲滯的記憶不能有第二條寫入路徑。`current` 同理。
 */
export interface TargetState {
  /** 現任目標在 `board.candidates` 裡的索引；−1 = 無 */
  current: number
  /** 距離可以再換目標還有多久，s */
  dwell: number
}

export function createTargetState(): TargetState {
  return { current: -1, dwell: 0 }
}

/**
 * 挑一個目標，回傳它的 `Aircraft`；沒有可打的敵機時回傳 null。
 *
 * @param dt 距離上次呼叫的秒數。呼叫端是 10 Hz 的決策節拍，所以這裡通常是
 *           0.1 —— 最小停留因此以「秒」而不是「拍數」計。
 *
 * 熱路徑之外（10 Hz），但仍然不配置。
 */
export function selectTarget(
  state: TargetState, board: TargetBoard, selfIndex: number,
  dt: number, cfg: TargetConfig,
): Aircraft | null {
  const { candidates, assignments, priority } = board
  const self = candidates[selfIndex]
  if (self === undefined || !self.alive) {
    state.current = -1
    state.dwell = 0
    if (selfIndex >= 0 && selfIndex < assignments.length) assignments[selfIndex] = -1
    return null
  }

  state.dwell = state.dwell > dt ? state.dwell - dt : 0

  // 【立即重選就是靠這裡】現任失效時把記憶清成「沒有現任」，下面的
  // `current < 0` 分支就會直接接受最佳解，完全繞過最小停留。
  const held = state.current >= 0 ? candidates[state.current] : undefined
  if (held === undefined || !held.alive || held.team === self.team) {
    state.current = -1
    state.dwell = 0
  }

  let bestIndex = -1
  let bestScore = -1
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive || c.team === self.team) continue
    const locks = countLocks(board, self.team, selfIndex, i)
    const s = targetScore(self.aircraft, c.aircraft, locks, cfg, priority[i]!)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i
    }
  }

  if (bestIndex < 0) {
    state.current = -1
    assignments[selfIndex] = -1
    return null
  }

  if (state.current < 0) {
    state.current = bestIndex
    state.dwell = cfg.minDwell
  } else if (state.dwell <= 0 && bestIndex !== state.current) {
    const cur = candidates[state.current]!
    const curLocks = countLocks(board, self.team, selfIndex, state.current)
    const curScore = targetScore(
      self.aircraft, cur.aircraft, curLocks, cfg, priority[state.current]!)
    // 【乘法門檻在這裡才安全】targetScore 恆非負（見該函數註解）
    if (bestScore > curScore * (1 + cfg.switchMargin)) {
      state.current = bestIndex
      state.dwell = cfg.minDwell
    }
  }

  assignments[selfIndex] = state.current
  return candidates[state.current]!.aircraft
}
