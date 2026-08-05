import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { threatFactor, turnTime } from './assess'
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
  return geometry * rangeDiscount * crowdDiscount * turnDiscount
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
}

/**
 * 建立指派板。
 *
 * 【為什麼要檢查 index 與位置一致】`assignments` 用陣列位置索引、
 * `TargetState.current` 存的也是位置，而 `Combatant.index` 是 `World.add`
 * 給的遞增序號。兩者恆等（`add` 就是用 `combatants.length` 當 index），但
 * 「恆等」若沒有被檢查，某天有人插入一架就會變成無聲的錯位 —— 所有 AI 都
 * 會鎖到隔壁那一架。設定期檢查一次，成本為零。
 */
export function createTargetBoard(candidates: readonly TargetCandidate[]): TargetBoard {
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.index !== i) {
      throw new Error(
        `TargetCandidate.index 必須等於陣列位置：第 ${i} 個是 ${candidates[i]!.index}`,
      )
    }
  }
  return { candidates, assignments: new Int32Array(candidates.length).fill(-1) }
}

/**
 * 有幾架**同隊且存活**的飛機正鎖定 `candidateIndex`，不含 `selfIndex` 自己。
 *
 * 【為什麼每次重掃而不是維護一個增減計數器】計數器要求每一次「放棄目標」
 * 都配一次遞減 —— 陣亡、撞地、重置、換目標各是一條路徑，漏掉任何一條就
 * 留下一個永遠不會消失的幽靈鎖定，而症狀（大家都不打那一架）離成因很遠。
 * 重掃是 O(N)，40 架 × 10 Hz = 每秒 16,000 次整數比較，而且**自我修復**：
 * 任何錯誤的指派都會在下一拍被沖掉。
 *
 * 【為什麼要限定同隊】`assignments` 是全場共用一份。不限定的話，紅隊鎖定
 * 某架紅機（不該發生，但這是一條資料而不是一條保證）會污染藍隊的統計。
 */
export function countLocks(
  board: TargetBoard, team: Team, selfIndex: number, candidateIndex: number,
): number {
  const { candidates, assignments } = board
  let n = 0
  for (let i = 0; i < assignments.length; i++) {
    if (i === selfIndex) continue
    if (assignments[i]! !== candidateIndex) continue
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
  const { candidates, assignments } = board
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
    const s = targetScore(self.aircraft, c.aircraft, locks, cfg)
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
    const curScore = targetScore(self.aircraft, cur.aircraft, curLocks, cfg)
    // 【乘法門檻在這裡才安全】targetScore 恆非負（見該函數註解）
    if (bestScore > curScore * (1 + cfg.switchMargin)) {
      state.current = bestIndex
      state.dwell = cfg.minDwell
    }
  }

  assignments[selfIndex] = state.current
  return candidates[state.current]!.aircraft
}
