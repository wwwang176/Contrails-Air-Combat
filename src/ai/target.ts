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
   * ## 【已知缺口】免除在真正的開火距離上幾乎不生效
   *
   * 症狀：長機明明已經有射擊解、槍口就在預瞄點上，開火 1~2 秒後仍然切去
   * 找別台敵機。
   *
   * 【成因不是集火命令】`focusTarget` 非 null 時長機的目標被無條件覆寫，
   * 看起來是頭號嫌犯，但那些換走一次都不是它造成的
   * （`test/tools/target-churn.probe.ts`，20v20 / 12v12 / 8v8 三種架數，
   * 100% 由 `selectTarget` 造成）。集火指的目標通常就是 `selectTarget`
   * 本來也會選的那一架。
   *
   * 【成因是分攤，而免除沒擋住它】把長機那一群單獨拆開，四個因子只有分攤
   * 在推著換（新÷舊 3.0~4.1 倍，其餘三項都在 0.78~1.21），而**這條規則
   * 存在的唯一目的就是免除分攤**。免除吃 `threatFactor(self, enemy)`，
   * 而它含 `1 − range/THREAT_RANGE` 這個因子：
   *
   * ```
   * 距離     免除    分攤的新÷舊
   * ≤675 m   100%      1.00 ×
   *  800 m    44%      3.22 ×
   *  837 m    28%      3.88 ×   ← 目標被搶走的距離中位
   *  900 m     0%      5.00 ×
   * ```
   *
   * **免除只在 675 m 以內完全生效**（機首完美對準時），而 AI 真正被搶走
   * 目標的距離遠在那之外。
   *
   * 【改吃 `alarmFactor` 要連飽和點一起換】`shotRelief = 0.25` 這個飽和點
   * 是為 `threatFactor` 那個小得多的量調的。只換函數不換尺度的話，
   * 「機首落在預瞄點 11.25° 內就完全免除，在子彈打得到的任何距離」——
   * 等於對所有有射擊解的人關掉分散機制，實測 `ai-targeting` 的持有時間
   * 中位掉到 1.40（門檻 1.5）、`multi-battle` 的開局編隊誤差中位 403 m
   * （門檻 100 m），連症狀都沒改善。
   *
   * 修這一項是一次**分散機制的重新平衡**，會動到 `ai-targeting` 與
   * `multi-battle` 的既有門檻，值得一份 spec。
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
   * 「到了特徵尺度要折幾次半」。`w = 0` 等於關掉這一項，`w = 1` 是不加權
   * 的形狀 —— 把 `crowdPenalty` 設 0 來關掉分攤的測試完全不受影響。
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
   * 【它要治的病】不加這一項時（`test/tools/target-churn.probe.ts`，20v20、
   * 150 s）：**29.6% 的換目標換去後半球**（90–120° 13.5%、120–150° 10.6%、
   * 150–180° 5.5%），而且 52.7% 的換目標讓離軸角變差 —— 看起來就是 AI 在
   * 兩個敵人之間猶豫、掉頭去追背後的人。
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
   * 全域的 `((1+cos θ)/2)^k` 斜坡**必定打破 `ai-target.test.ts` 的「正前方
   * 但很遠的目標，輸給側面但很近的目標」** —— 那條守的是「切換成本只是
   * 折扣，不會讓飛機黏死」，也是擋住 `turnWeight = 3` 的同一條。實算
   * （`test/tools/vision-shape.probe.ts`）：
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
   * 那條的餘裕只有 1.203 倍，而全域斜坡會打側面的近目標、卻完全不打
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
   * ## 為什麼會反向
   *
   * `trackAngle` 是**我自己速度向量**的方向，硬機動時以約 22°/s 在變。
   * 視野項在後半球 90° 的跨度內橫跨十倍，等於**每秒 2.6 倍**的變化率，
   * 而換敵門檻只有 1.25 倍 —— 把**快變量**接到**慢決策**上。
   *
   * `assess.ts` 的 `turnTime` 也吃同一個角，但它的響應很緩（0 到 180° 全程
   * 只有 9 倍且平滑），所以不會這樣。**這一層扛不住任何幾何量的陡響應**：
   * 所有幾何量都在機動的時間尺度（約 1 秒）上變，而決策的停留是 2 秒。
   * 猶豫要修的地方不在評分的形狀，在決策層本身（節拍、遲滯、或把輸入時間
   * 平均掉）。
   *
   * ## 預設為什麼是 0
   *
   * 這是一個**方向相反的取捨**：它讓後方追逐變好、猶豫變差。哪一個比較
   * 重要是負責人的決定。預設 0 讓這一項乘以 1.0，要開只需把 0 改成 2。
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
 * 【`threatWeight` = 1，它本身也在分散】關掉它（0）會讓 **20 架全部撲同一
 * 個目標** —— 比 `crowdPenalty` = 0 還糟。原因是只剩機會項時，所有人對
 * 「誰最背對我」的評價幾乎一樣；而「誰正在打我」是每架各自不同的。往上加
 * 到 2、4 反而讓最大鎖定回升到 4、5 ——大家改成一起撲「最兇的那一架」。
 * 取 1，與機會項等重。
 *
 * 【`rangeScale` = 400 m】M2 的匯聚點在 300 m，1944 年的實戰有效射程也在
 * 400 m 以內 —— 「打得到的距離」就是這個量級。掃描顯示這一項不敏感
 * （200 到 1600 之間換目標次數只在 506–570 之間）。
 *
 * ---
 *
 * ## 20v20 跑滿 150 秒的掃描
 *
 * 【上面那組的射程前提】威脅項用 `assess.ts` 的嚴格定義，在 `THREAT_RANGE`
 * 之外恆為 0，而開局 25 秒的接近航程全部落在那之外 —— 那一段裡
 * `threatWeight` 一個字都不作用，分散全靠 `baseScore` 與分攤。詳見
 * `baseScore` 的註解。
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
  // 【預設關掉】它是一個**方向相反的取捨**：後方追逐變好、A→B→A 變差。
  // 哪一個比較重要是負責人的決定，不是實作者的。要開就把這個 0 改成 2
  // —— 見 `visionPower` 的 A/B 表。
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
 * 【為什麼三個因子全是折扣形式】分攤寫成減法的話分數會變負；而換目標
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
  // `trackAngle` 的 acos 仍然會跑。預設是關的，所以這裡短路掉 ——
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
  /**
   * `protectedMask[i] !== 0` = 第 i 架是這一關「要被護送／要被攔截」的那些
   * （編組表上 `duty === 'transit'`）。**預設全 0，不分隊。**
   *
   * 【為什麼不借用 `priority > 1`】那個欄位的正式語意是「目標評分倍率」，
   * 不是角色標籤。某次調整若把 `convoyPriority` 設回 1，任務壓力止損會
   * **無聲消失**，而且沒有任何測試會紅。
   */
  readonly protectedMask: Uint8Array
  /**
   * `pressure[teamSlot(team)] !== 0` = 那一隊的被保護單位正在被敵機貼上。
   * **由 `battle` 層每 10 Hz 算一次，全隊共用。**
   *
   * 【為什麼不讓每架自己掃】這個值對同隊的每一架**完全相同**，沒有理由
   * 算 20 次。20v20、4 架被保護單位時，自己掃是每秒 16,000 次距離平方；
   * 算一次是 1,600 次。而且每架自己掃還要各自處理隊別過濾，多一處會錯。
   */
  readonly pressure: Uint8Array
}

/**
 * 敵機多近算「被保護單位正在挨打」，m。
 *
 * 【為什麼住在這裡而不是 `TacticalConfig`】它的消費端是 `battle` 層算的那
 * 一次掃描，而那一層拿不到每架自己的戰術設定。放在資料的旁邊，兩邊讀的
 * 就是同一個值。**起始值，待掃描。**
 */
export const PRESSURE_RANGE = 2000

/**
 * 隊別對應到 `pressure` 的格子。**定義在 `world/World.ts`** —— 彈丸、
 * 炸彈、魚雷三個池用的是同一個編碼，而 `world/` 不能往上依賴這裡。
 */
export { teamSlot } from '../world/World'

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
 *
 * @param capacity **最終**架數，含還沒進場的增援。省略時等於候選數。
 *
 * 【為什麼是建構期給而不是之後長大】`candidates` 收的是 `world.combatants`
 * **那一個活陣列**，所以它自己會跟著長；另外三個 typed array 不會。
 * 讓它們中途重配的話 `readonly` 這道護欄就沒了，而且持有舊參考的呼叫端會
 * 靜靜地寫到一個沒有人在讀的陣列上。波次是有限的、寫在任務卡上，所以最終
 * 架數在建構期就算得出來 —— 一次配到位，參考永遠不換。
 *
 * 【預留出來的格子是中性值】指派 −1、倍率 1、不是被保護單位，與「沒有這
 * 幾架」完全相同。
 */
export function createTargetBoard(
  candidates: readonly TargetCandidate[], flightOf?: Int32Array, priority?: Float64Array,
  protectedMask?: Uint8Array, capacity = candidates.length,
): TargetBoard {
  if (capacity < candidates.length) {
    throw new Error(`capacity ${capacity} 小於候選數 ${candidates.length}`)
  }
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.index !== i) {
      throw new Error(
        `TargetCandidate.index 必須等於陣列位置：第 ${i} 個是 ${candidates[i]!.index}`,
      )
    }
  }
  if (flightOf !== undefined && flightOf.length !== capacity) {
    throw new Error(
      `flightOf 長度必須等於最終架數：${flightOf.length} vs ${capacity}`,
    )
  }
  if (protectedMask !== undefined && protectedMask.length !== capacity) {
    throw new Error(
      `protectedMask 長度必須等於最終架數：${protectedMask.length} vs ${capacity}`,
    )
  }
  if (priority !== undefined && priority.length !== capacity) {
    throw new Error(
      `priority 長度必須等於最終架數：${priority.length} vs ${capacity}`,
    )
  }
  return {
    candidates,
    assignments: new Int32Array(capacity).fill(-1),
    flightOf: flightOf ?? new Int32Array(capacity).fill(-1),
    // 【省略等於全 1】也就是「每一架都一樣值錢」—— 遭遇戰與殲滅任務逐字
    // 回到加這個欄位之前的行為
    priority: priority ?? new Float64Array(capacity).fill(1),
    // 【省略等於全 0】沒有任何一架是被保護單位，任務壓力恆為假
    protectedMask: protectedMask ?? new Uint8Array(capacity),
    // 【不收參數】它是每步重算的輸出，不是設定
    pressure: new Uint8Array(2),
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
 * 【為什麼同小隊不算】`wingman.ts` 的 LEVEL_FOCUS 讓僚機去打站位參考機正在
 * 打的那一架，並把結果寫回同一份 `assignments`。同小隊也數的話就成了一個
 * 回授迴路：
 *
 * ```
 * 長機選中 A → 僚機跟上也鎖 A → countLocks(A) 從 0 變 2~3
 *            → A 的分攤折扣塌成 1/5 → 長機換走 → 僚機跟著換 → …
 * ```
 *
 * **長機會被自己的僚機罰** —— 實測四分之三以上的分攤壓力來自自己的小隊，
 * 而那正是編隊該做的事。分攤要數的單位是**小隊**，不是飛機。排除之後長機
 * 持有時間中位由 2.00 s 變成 5.70 s、最大鎖定數 8 → 6（分散反而更好）、
 * 命中事件 402 → 534，而開局 20 s 的站位誤差中位不動（26.8 m）。
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
