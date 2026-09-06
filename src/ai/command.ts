import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEFAULT_STEER } from './steer'

/**
 * 規劃需要知道的每架資訊。
 *
 * 【為什麼另外定義而不是收 `Combatant` 或 `Aircraft`】規劃不需要知道世界是
 * 怎麼組裝的（射速時鐘、包圍球、出生點都與「這個小隊該不該撤」無關），而且
 * 收最小介面才能在單元測試裡用字面物件出考題 —— 那是 spec §7.1 那一層
 * 存在的前提。與 `flights.ts` 的 `FlightMember`、`target.ts` 的
 * `TargetCandidate` 是同一個手法。
 *
 * `position` / `velocity` 是 `readonly` 的**參考**（內容仍可 `copy` 進去），
 * `cornerRatio` / `hpFraction` / `shotInstant` / `alive` 每步會被呼叫端改寫。
 */
export interface CommandUnit {
  readonly position: Vector3
  readonly velocity: Vector3
  /** TAS ÷ 角落速度。與 `Situation.cornerRatio` 同義 */
  cornerRatio: number
  /** 升限，m。集合點的高度上界 */
  readonly serviceCeiling: number
  /**
   * 剩餘血量佔滿血的比例，0..1（1 = 毫髮無傷）。集火挑目標用。
   *
   * 【為什麼是比例而不是絕對值】兩個機種的滿血不同，絕對值跨機種比不了。
   */
  hpFraction: number
  /**
   * 上一格的射擊解強度，0 = 沒有解。**排名用**（spec §4）。
   *
   * 【為什麼是這個量而不是「誰最有機會」】排名問的是「叫誰去，損失最小」。
   * 純幾何量不到那件事 —— 「離最近的敵分隊多近」對正在得手的和正在挨打的
   * 分隊是同一個數字。第二份 §12 量到側翼失敗的機制正是「一支已經咬住人的
   * 分隊放棄了現有位置」。
   *
   * 【資料是現成的】`AiController.shotInstant` 已經存在，它的註解寫的就是
   * 「只為量測存在」。`setup.ts` 每步抄過來，與 `cornerRatio`、`hpFraction`
   * 同一手。
   */
  shotInstant: number
  alive: boolean
}

/**
 * 命令的種類。**互斥的聯集，不是一組旗標**：`flank` 與 `focus` 由距離分開
 * （spec §3.2），永遠不會同時成立，所以命令不需要組合。
 */
export type OrderKind = 'rally' | 'flank' | 'focus'

/**
 * 一張下給小隊的命令。
 *
 * 【`rally` 的集合點凍結，`flank` 的每步重算】兩者的差別來自實測：敵**隊**
 * 質心 30 秒只飄 720 m（20 架纏鬥互相抵銷），但敵**分隊**質心飄 2040~4663 m
 * —— 抵銷效應只在架數多時成立，四架的分隊就是一團一起動的東西。
 *
 * 撤退的點是**遠離**敵人的，過期不太傷（第一份 spec §4.1 明寫接受這個代價）；
 * 側翼的點貼著敵分隊定義，凍結會在飛到一半就失效。所以側翼**凍結的是決定**
 * （`side` 與 `targetFlight`）**而不是座標**，到達改用幾何判定（spec §4.2）。
 */
export interface FlightOrder {
  readonly kind: OrderKind
  /**
   * 飛行點。`rally` 發令後不再變；`flank` **由 `stepCommand` 每步重寫**；
   * `focus` 不使用（恆為原點）。
   *
   * 【只有這一個欄位不是 readonly，而且只有 `flank` 會動它】
   */
  point: Vector3
  /** 到達判定半徑，m。只有 `rally` 使用 */
  readonly radius: number
  /** `flank`：切哪一個敵分隊。**全域**分隊索引。其餘為 −1 */
  readonly targetFlight: number
  /** `flank`：從哪一邊切。+1 = 敵航向的右舷，−1 = 左舷。其餘為 0 */
  readonly side: number
  /** `focus`：打哪一架。`units` 的**全域**索引。其餘為 −1 */
  readonly focusIndex: number
}

export interface CommandConfig {
  /** 規劃週期，s */
  planPeriod: number
  /** 見底門檻：`cornerRatio` 低於此值才開始累積 */
  spentRatio: number
  /** 持續多久才算見底，s */
  spentSeconds: number
  /**
   * 見底取分隊 `cornerRatio` 由低到高第幾個。0 = 最低，1 = 次低。
   * **存活**人數不足時夾到最後一個。
   *
   * 【為什麼需要它】四機小隊的最小值遠低於中位數。20v20 × 300 s 實測
   * `< 0.6` 的時間佔比：最低 30.6%、次低 10.5%、中位數 2.1% —— 一架落單
   * 掉速的僚機就足以把整支分隊拖出戰場三成的時間。
   *
   * 【它限縮了 spec §2.4】「編隊的能力等於最弱的那一架」只適用於**進攻**
   * 能力；「整支分隊該不該離場」由第 `spentRank` 弱的那一架決定。
   * `spentRank = 0` 時兩者一致。
   *
   * 【戰損中會自然退化】對存活人數夾限，所以剩 1~2 架時退回「取最低」——
   * 兩架的分隊裡「最弱的那一架」確實就是它的能力。
   *
   * 【為什麼是名次不是分位數】分隊固定 4 人，名次是整數、可窮舉、寫得進
   * 測試；4 個樣本的分位數插值只會製造一個沒有人看得懂的數字。
   */
  spentRank: number
  /**
   * 集合點離**敵群質心**多遠，m。分隊已經在殼外（含 `MIN_TRIP_RATIO` 的
   * 閘門寬度）時**不發令**。
   *
   * 【錨一定要在敵群，不可以是小隊自己】錨在小隊自己時撤退變成一個沒有
   * 不動點的純積分器 —— 每撤一次就再往外 3 km，實測 300 秒漂到平均 12 km、
   * 最大 18 km，TAS 從 200 掉到 110 之後四分鐘沒回來過。錨在敵群 + 殼外
   * 不發令，映射才是「殼內 → 殼上、殼外 → 不動」，單調且非擴張。
   *
   * 【與 `arriveRadius` 不獨立】閘門寬度由它導出，兩者要一起掃。
   */
  withdrawRange: number
  /** 到達判定半徑，m */
  arriveRadius: number
  /** 側翼點離敵航向的橫向偏置，m */
  flankOffset: number
  /** 側翼點放在敵分隊後方多遠，m */
  flankTrail: number
  /** 側翼點比敵分隊高多少，m */
  flankClimb: number
  /** 後側方扇區的半角，rad。到位判定用 */
  flankSector: number
  /** 危險核的特徵長度，m */
  dangerScale: number
  /** 危險分數的上限，超過就不發側翼令 */
  dangerLimit: number
  /** 集火目標的最遠距離，m */
  focusRange: number
  /** 集火目標偏離小隊航向的最大夾角，rad */
  focusCone: number
  /** 同時最多幾支分隊持有**進攻**命令。撤退不算（spec §3.2） */
  maxOrders: number
  /** 連續多久沒有人握著射擊解才算「閒」，s */
  idleSeconds: number
}

/**
 * 五個參數（`arriveRadius` 之外）由 22 組 20v20、120 秒掃描定案，
 * **五個都留在起始值** —— 留下來的理由是實測，不是沒量。
 *
 * ## 判準
 *
 * 核心是**下令頻率的合理區間**：太低代表門檻等於沒用（等於沒有指揮），太高
 * 代表小隊一直在離場（等於沒有人在打仗）。單看任一端都會選錯，所以與另外
 * 兩條一起看：
 *
 * 1. **多數發出的命令要到得了**（`arrived > issued / 2`）。到不了的命令等於
 *    把小隊永久移出戰場。
 * 2. **命令期間不動用安全層的撞地接管**（`ground === 0`）。政策層把飛機送進
 *    硬限制的作用區就是設計失敗，與 task #136 的六場護欄同一條線。
 * 3. `share`（命令佔時比例）落在 **5%~25%**。低於 5% 時指揮層對整場的影響
 *    小到量不出來，高於 25% 時場上有四分之一的飛機在離場 —— 那不是空戰。
 *    **這個區間是判準不是實測值。**
 *
 * ## 掃描表（粗體 = 選定，也就是原值）
 *
 * ```
 * 參數            值      發令  到達   佔時    撞地接管
 * spentRatio     0.40      1     0    2.39%     39     門檻等於沒用
 *                0.50      3     2    9.27%      0
 *              **0.60**    5     5   17.79%      0
 *                0.70     10     4   23.87%      0     多數到不了
 *                0.75     12     6   28.90%    143     一直在離場
 * spentSeconds      1      6     4   19.79%      0
 *                   2      8     4   20.29%      0
 *                 **3**    5     5   17.79%      0
 *                   5      4     3   12.34%      0
 *                   8      3     1    6.01%      0     濾得太狠
 * withdrawRange  1500      7     2   22.28%    153     太近
 *             **3000**     5     5   17.79%      0
 *                5000      5     2   20.61%      0
 *                8000      5     0   22.56%      0     一張都到不了
 * withdrawClimb   400      5     1   19.38%      0
 *              **800**     5     5   17.79%      0
 *                1500      8     3   20.36%      0
 *                2500      6     0   17.44%     95     爬不上去
 * planPeriod        1      7     4   15.95%      0
 *                 **2**    5     5   17.79%      0
 *                   5      6     2   20.01%      0
 *                  10      6     3   19.57%      0
 * ```
 *
 * ## 怎麼讀這張表
 *
 * **有結構的是四個邊界，不是中心點的小數第二位。** 這個專案量過太多次
 * 「平台是結構、單點是抽樣」（見 `steer.ts` 的 `brakeCornerRatio`），而
 * `arrived` 的絕對數只有 0~6，比例本身是很吵的統計量。真正撐得住的是：
 *
 * - `withdrawRange` 8000 → **一張都到不了**。8 km 在被重新咬上之前跑不完。
 * - `withdrawClimb` 2500 → **一張都到不了**，而且開始出現撞地接管。能量
 *   見底的小隊爬不動 2.5 km；命令於是變成永久狀態。
 * - `spentRatio` 0.40 → 整場只發一張。門檻低到幾乎碰不到。
 * - `spentRatio` 0.75 → 佔時 28.9%、撞地接管 143 次。那個值正好是個體層的
 *   `DEFAULT_RULES.cornerEnter`，而戰鬥機每次硬拉都會掉到它以下 —— 掃描
 *   實測證實了「指揮層的門檻必須低於個體層」。
 *
 * 中心與相鄰值的差（0.5 vs 0.6、`planPeriod` 1 vs 2）在雜訊之內，**不要**
 * 拿這張表去論證 0.6 比 0.5 好。它論證的是原值全部落在可用帶的中央，四個
 * 邊界則是真的邊界。
 *
 * ## 每一個值的理由
 *
 * - `planPeriod` 2 s —— 比 `AI_DECISION_HZ`（10 Hz）慢兩個數量級，指揮是
 *   戰役尺度的決定，不該與戰機的機動同頻。
 * - `spentRatio` 0.6 —— **刻意低於**個體層的 `DEFAULT_RULES.cornerEnter`
 *   （0.75）。那個門檻回答的是「我現在該不該停止拉桿」，是瞬間判斷；指揮層
 *   問的是「已經打不動了嗎」（spec §2.4）。
 * - `spentSeconds` 3 s —— 一次完整的水平大彎的量級，用來濾掉單次拉桿。
 * - `withdrawRange` 3000 m —— `DEFAULT_RULES.extendRange`（1500）的兩倍，
 *   個體脫離跑一半就回頭，小隊撤離要更徹底。
 * - `withdrawClimb` 800 m —— 一次淺俯衝換得回來的高度量級。
 * - `arriveRadius` 300 m —— `withdrawRange` 的十分之一。**沒有掃描過**：它
 *   與 `withdrawRange` 不獨立（放大它等於放寬到達判定），單獨掃會量到兩件
 *   事混在一起。
 *
 * ## 重掃的前提
 *
 * 這組值依賴**目前的飛行包絡**（`specs/feel.ts` 的五個倍率 —— `cornerRatio`
 * 是 TAS ÷ 角落速度，倍率一動兩邊都動）與 `DEFAULT_BATTLE` 的 20v20 編成
 * （小隊大小決定「最低那一架」的取樣數）。兩者大幅改動後要重掃。
 *
 * ## 側翼與集火的八個起始值（待 Task 8 掃描）
 *
 * - `flankOffset` 1200 m —— `DEFAULT_WINGMAN.breakExit` 同值：一個分隊散得開、
 *   又還讀得出是編隊的量級。
 * - `flankTrail` 800 m —— 略小於 `THREAT_RANGE`（900），到位時剛好進入可以
 *   開始追蹤的距離。
 * - `flankClimb` 300 m —— `DEFAULT_BATTLE.altitudeSpread` 同值，一個分隊層。
 * - `flankSector` 60° —— 「我在他們的後 120°」。
 * - `dangerScale` 900 m —— `THREAT_RANGE`：「這個距離內的敵機才算危險」。
 * - `dangerLimit` 2.0 —— 約當「兩架敵機貼在候選點上」。
 * - `focusRange` 1500 m —— `DEFAULT_RULES.extendRange` 同值。
 * - `focusCone` 60° —— 與 `flankSector` 同值：「在我們正在去的方向上」。
 *
 * ## 決策層的兩個參數（9 組 20v20、120 秒掃描）
 *
 * **兩個都留在起始值。**
 *
 * ### 主判準在這裡不成立
 *
 * 主判準是三場 A/B 的傷害交換比（第三份 spec §7.3）：基準場兩隊都不
 * 指揮，另外兩場各只有一隊指揮，指揮的那一方兩場都要贏過基準的 1.10 倍。
 *
 * ```
 * 參數           值    藍方指揮        紅方指揮       R1     S1     過?
 * （空對照）      —    B1169:R3658  B1169:R3658  3.129  0.320  —／—
 * maxOrders      0    B2322:R2429  B1343:R2199  1.046  0.611  ✗／✓
 *                1    B2467:R1350  B1614:R2178  0.547  0.741  ✗／✓
 *              **2**  B1913:R1830  B2275:R2788  0.957  0.816  ✗／✓
 *                3    B5111:R1307  B2571:R2351  0.256  1.094  ✗／✓
 *                5    B5111:R1307  B1389:R812   0.256  1.711  ✗／✓
 * idleSeconds    1    B1913:R1830  B2275:R2788  0.957  0.816  ✗／✓
 *              **3**  B1913:R1830  B2275:R2788  0.957  0.816  ✗／✓
 *                8    B1913:R1830  B2275:R2788  0.957  0.816  ✗／✓
 * ```
 *
 * **極性一在每一列都沒過，包含 `maxOrders = 0`** —— 那一列決策層一張進攻
 * 令都不發，只剩撤退，`R1` 仍然是 1.046。與空對照（指揮官連撤退都發不
 * 出來時逐位元回到 3.129）一比，結論是：**撤退令自己就把藍方從 3.13 打到
 * 1.05**。那是第一份的機制，不是這一份的。
 *
 * 判準本身有一個沒被看見的前提：基準要接近對稱。實際基準是 3.129（P-51D
 * 對 Bf 109 G-6 在目前包絡下一面倒），於是「贏過自己的基準 10%」對兩邊
 * 的難度天差地遠，而指揮做的事恰恰是把戰局推向均勢。詳見 spec §10.4。
 *
 * ### 怎麼選的值
 *
 * - `idleSeconds` 3 —— 掃描證明它**完全沒有作用**：1、3、8 三個值給出逐
 *   位元相同的戰局。接敵發生在開場約一分鐘後，那時每一支分隊的 `idle`
 *   早就遠超過 8 秒，門檻從來沒有咬到任何人。留 3 是因為無害且語意清楚
 *   （與 `spentSeconds` 同值），不是因為它比 1 或 8 好。
 * - `maxOrders` 2 —— 主判準給不出答案，所以選值靠 spec §7.5 那四個觀測
 *   值：2 是唯一同時讓三條既有的紅轉綠（離場佔時 33.51% → 18.53%、命令
 *   期間撞地接管 134 → 0、`multi-battle` 開局巡航編隊 353 m → < 100 m）、
 *   又不會像 3/5 那樣把藍方推到 0.256 的值。**這是一個依觀測值而非依主
 *   判準選的參數，要記著。**
 *
 * ### 為什麼 3 與 5 對藍方相同
 *
 * 藍方五個分隊裡玩家佔掉一個（`skipFlight`），只有四支發得出去，而實測
 * 連三支同時持有都很少達到。紅方沒有玩家，5 與 3 就分得開。
 *
 * ### 重掃的前提
 *
 * 依賴目前的飛行包絡（`specs/feel.ts` 的五個倍率）與 `DEFAULT_BATTLE` 的
 * 20v20 編成（**含玩家佔掉藍方一個分隊**）。另外，若接敵時間大幅提前
 * （開場距離縮短、或巡航速度提高到分隊十幾秒內就接觸），`idleSeconds`
 * 會第一次真的咬到人，那時要重掃它。

 * ## 撤退令錨在敵群的掃描（6 組 20v20 × 300 秒）
 *
 * **這張表與上面那張不可比** —— 兩張的 `withdrawRange` 語意不同（「離敵群
 * 多遠」對「再往外多遠」），量的是另一個東西。上面那張表的 `withdrawRange`
 * 四列與已刪除的 `withdrawClimb` 四列都只有歷史價值。
 *
 * 判準（`test/integration/ai-withdraw-anchor.test.ts`）：接敵後的半徑成長
 * ≤ 2000 m、全場最大半徑 ≤ 6500 m、撤退令佔時 5%~25%、撤退令「解除時比
 * 發令時快」的張數過半、300 秒總掉血 ≥ 7345。
 *
 * ```
 * range  rank   成長   最大   佔時   補到能量   掉血   傷害比  過?
 *  1200   0     319   5888   2.3%   33%(n=3)  13183   1.29   ✗ 佔時／補能量
 *  1200   1    1103   5888   0.0%   —  (n=0)  13457   1.43   ✗ 一張都不發
 *  2000   0     891   5888  11.3%   82%(n=11) 10164   1.73   ✓
 * **2000   1    −205   5888   7.2%   83%(n=6)  10535   1.28   ✓ ← 選定**
 *  3000   0    3248   9189  12.5%   90%(n=10)  8780   1.87   ✗ 半徑
 *  3000   1    1856   6456  10.2%  100%(n=6)  12207   1.35   ✗ 最大半徑
 * ```
 *
 * ## 怎麼讀這張表
 *
 * **有結構的是兩個邊界。** 1200 太小：殼落在混戰半徑之內，閘門幾乎恆成立，
 * 撤退令等於被關掉（佔時 2.3% → 0%）。3000 太大：殼本身就把隊形攤開到 3 km
 * 外，半徑守不住。2000 是唯一同時滿足「機制還活著」與「戰鬥不漂走」的值。
 *
 * **`spentRank = 1` 在每一項上都不輸 rank 0**，而且 2000 那一組的成長由
 * +891 變成 −205（接敵之後半徑不再成長，反而收斂）。它把 spec §2.4
 * 「編隊的能力等於最弱的那一架」限縮成「**進攻**能力等於最弱的那一架」——
 * 見 `spentRank` 的註解。
 *
 * **對照組（完全不發撤退令，`spentRatio = 0`）**：成長 −341、最大 5888、
 * 存活 B18R13。它證明殘餘外擴確實來自撤退令而不是混戰本身的漂移 ——
 * 但它也殺得更兇，而撤退令的存在理由（把藍方從 3.13 打到 1.05）是另一份
 * spec 的結論，不在這一份的範圍內。
 *
 * ## 重掃的前提
 *
 * `withdrawRange` 的新語意依賴閘門寬度（`arriveRadius × MIN_TRIP_RATIO`），
 * 兩者不獨立。`spentRank` 依賴分隊是 4 人（`STATION_OFFSETS` 的長度）。
 *
 */
export const DEFAULT_COMMAND: CommandConfig = {
  planPeriod: 2,
  spentRatio: 0.6,
  spentSeconds: 3,
  spentRank: 1,
  withdrawRange: 2000,
  arriveRadius: 300,
  // ── 側翼與集火。**全部是起始值，待 Task 8 由實測掃描回填** ──
  flankOffset: 1200,
  flankTrail: 800,
  flankClimb: 300,
  flankSector: 60 * (Math.PI / 180),
  dangerScale: 900,
  dangerLimit: 2,
  focusRange: 1500,
  focusCone: 60 * (Math.PI / 180),
  // ── 決策層。掃描過，兩個都留在起始值（理由見上）──
  maxOrders: 2,
  idleSeconds: 3,
}

/** 水平方向退化的下限。與 `station.ts` 的 `MIN_GROUND_SPEED` 同一個量級 */
const MIN_HORIZONTAL = 1e-3

/**
 * 撤退令的最短行程，是 `arriveRadius` 的幾倍。分隊離殼比這個近就不發令。
 *
 * 【為什麼是 3】判準是「這張命令活得比一個決策週期久嗎」。短於
 * `spentSeconds`(3 s) + `planPeriod`(2 s) 的命令唯一的作用是把見底計時歸零，
 * 飛機幾乎沒動。實測巡弋約 110 m/s，5 秒是 550 m；3 × 300 = 900 m 約 8 秒。
 *
 * 【為什麼不是新參數】它由 `arriveRadius` 導出，兩者本來就不獨立 ——
 * `arriveRadius` 是到達判定的解析度，行程至少要是它的數倍才有意義。
 */
const MIN_TRIP_RATIO = 3

/**
 * 「這個敵分隊已經在交戰」的 `cornerRatio` 門檻。
 *
 * 0.9 高於指揮層的 `spentRatio`（0.6，「已經打不動」）而低於自由巡航 ——
 * 語意是「有人正在讓它拉桿」。與見底判定用同一個量，不新增概念。
 *
 * 【它是**觸發**，第三份會整條換掉。不要掃描它】刻意不放進 `CommandConfig`：
 * 放進去會讓人以為它與那八個**執行**參數同一個地位，於是被一起掃描 ——
 * 那就是在調第三份的東西（spec §2、§3.3）。
 */
const ENGAGED_RATIO = 0.9

/**
 * 側翼／集火的距離分界，m。遠 → 側翼切入；近 → 集火。
 *
 * 2500 介於 `THREAT_RANGE`（900）與 `withdrawRange`（3000）之間。
 *
 * 它同時是**集火命令的解除距離**（spec §6.2 的遲滯）：發令要求離小隊質心
 * 不到 `focusRange`（1500），解除要求超過 2500 —— 兩個不同的數字就是遲滯，
 * 不需要第三個參數。用同一個門檻發令與解除會在邊界上抖。
 *
 * 【它是**觸發**，第三份會整條換掉。不要掃描它】理由同 `ENGAGED_RATIO`。
 *
 * 【為什麼 export】強制注入的驗收要重現觸發器**自己的前提**：側翼只在
 * 「最近的敵分隊超過這個距離」時發出。拿一個已經貼在臉上的分隊當側翼目標，
 * 命令會在發出的同一步就被判定到位 —— 那是真實觸發器永遠不會產生的狀態，
 * 驗收就變成在量一個不存在的東西（實測 17701 張注入、17700 張立刻解除）。
 * export 一個常數與「不進 `CommandConfig`、不掃描」不衝突。
 */
export const FLANK_RANGE = 2500

/**
 * 觸發階梯要不要選側翼。**目前是關的。**
 *
 * 【為什麼關】spec §12：時間對齊的實測顯示側翼讓開火的方位角**變差**
 * （delta +0.728，n = 3425 對 7566），總傷害也少 18%。同一批時刻，沒有
 * 繞路的那一支已經咬在人家尾後（−0.558），繞完 2.5 km 的那一支落在正
 * 側面附近（+0.170）—— 它把已經到手的位置丟掉了。到位判定與點位置各掃
 * 了八組，delta 隨參數完全非單調，**不是參數問題**。
 *
 * 【為什麼只關觸發，不刪程式碼】`planFlankOrder`、`flankPoint`、
 * `flankArrived` 與它們的十八條考題全部留著，強制注入的驗收也照跑 ——
 * 那條路徑本身是對的，錯的是「什麼時候選它」。而實測樣本全部來自強制
 * 注入：真實觸發器 120 秒只發 4 張，而注入挑的是「最近但超過 2500 m 的
 * 敵分隊」，混戰中那通常表示要放棄現有咬尾去追一支正忙著的分隊 ——
 * 那本來就是壞決定，不管側翼寫得多好。所以量到的是「在錯的時機執行側翼
 * 有多糟」，不是「側翼有沒有價值」。後者要等第三份的決策層才問得出來。
 *
 * 【重新打開的條件】spec §12.5：命令解除時交接目標（現在解除的那一瞬，
 * 小隊回頭走既有的自由選目標，而 `targetScore` 不知道我們剛繞到人家
 * 後面），並用同一條時間對齊的判準重測。
 */
const FLANK_ENABLED: boolean = false


const P = makeScratch(4)

/**
 * 這個小隊此刻該收到什麼命令。`null` = 自由交戰。
 *
 * **純函數**：只讀 `members` 與 `enemies`，不改它們，不碰世界。這是
 * spec §7.1 那一層驗收的前提 —— 混戰的結果太吵，從結果反推判斷品質驗不出
 * 東西，必須能直接餵快照出考題。
 *
 * 【它不判斷「見底了沒」】那是 `stepCommand` 的事（它才有跨步的計時器）。
 * 這裡收到的 `spentSeconds` 是已經累積好的秒數 —— 與 `defendAim` 收
 * `axisSign` 而不自己決定號誌是同一個分工：純函數沒有「這是不是第一格」
 * 的資訊。
 *
 * 【配置】發令時配置一個 `Vector3`。它每 `planPeriod` 秒才可能發生一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param spentSeconds 這個小隊「最低那一架連續低於門檻」已經累積的秒數
 */
export function planFlightOrder(
  members: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  spentSeconds: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  if (spentSeconds < cfg.spentSeconds) return null

  // ── 小隊質心、平均速度、最低升限 ──────────────────────
  const own = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < members.length; i++) {
    const m = members[i]!
    if (!m.alive) continue
    own.add(m.position)
    vel.add(m.velocity)
    if (m.serviceCeiling < ceiling) ceiling = m.serviceCeiling
    n++
  }
  if (n === 0) return null
  own.divideScalar(n)
  vel.divideScalar(n)

  // ── 敵群質心 ──────────────────────────────────────────
  const foe = P.v[2]!.set(0, 0, 0)
  let e = 0
  for (let i = 0; i < enemies.length; i++) {
    const t = enemies[i]!
    if (!t.alive) continue
    foe.add(t.position)
    e++
  }
  // 【沒有敵人就沒有命令】撤離是相對某個威脅而言的。沒有威脅時把小隊送去
  // 遠方只是把它移出戰場。
  if (e === 0) return null
  foe.divideScalar(e)

  // ── 方向：由敵群指向小隊，取水平分量 ────────────────────
  // 退化階梯與 `stationPoint`、`unloadAim`、`applyFloor` 一致：
  // 首選 → 次選 → 固定方向。**不 return、不留 NaN。**
  const dir = P.v[3]!.set(own.x - foe.x, 0, own.z - foe.z)
  let len = dir.length()
  // 【距離要在退化階梯之前另存】`len` 下面會被改成速度長度、甚至 1
  const gap = len
  if (len < MIN_HORIZONTAL) {
    // 敵我質心水平重合：「遠離」沒有定義，改用小隊自己的前進方向
    dir.set(vel.x, 0, vel.z)
    len = dir.length()
    if (len < MIN_HORIZONTAL) {
      // 連速度也退化：任何固定方向都一樣好，重點是不要產生 NaN
      dir.set(0, 0, -1)
      len = 1
    }
  }
  dir.divideScalar(len)

  // ── 閘門：行程不夠長就不發令 ──────────────────────────
  // 【為什麼需要它】行程長度是 |withdrawRange − gap|。少了閘門有兩個失敗：
  //
  //   gap ≈ 殼 → 行程短於到達半徑，命令在**下一格**就被判到達
  //     （`stepCommand` 的 rally 分支）、`spent` 被歸零，飛機一步都沒動 ——
  //     撤退在那一帶等於失效，而既有的「多數命令要到得了」會變成假綠。
  //   gap > 殼 → 「撤退令」會把一支 `intent` 被壓成 `rally`、不開火、僚機
  //     被清目標的四機編隊沿徑向直線送回敵群。那正是要救的分隊。
  //
  // 【為什麼用 gap 不用 len】`len` 在上面的退化階梯裡會被重新賦值成**速度
  // 的長度**（敵我水平重合時），最後一階直接設成 1。用 `len` 的話行為會
  // 取決於速度大小而不是敵我距離。
  if (gap >= cfg.withdrawRange - cfg.arriveRadius * MIN_TRIP_RATIO) return null

  // ── 高度：撤退不改變高度，只夾在安全下界與最低升限之間 ────
  // 【為什麼不加碼】`own.y + withdrawClimb` 那種寫法賭的是「爬起來的高度
  // 之後換得回速度」，而實測沒有發生：20v20 四分鐘裡高度 +2000 m 而 TAS
  // 一直停在 110。而且高度不能像水平那樣錨在敵群 —— 那會變成互相加價
  // （紅爬到藍 +800，藍下一張就是紅 +800），一路頂到升限；垂直方向沒有
  // 「背對」這種把兩隊分開的自由度。撤退要補的是**速度**，而爬升是消耗
  // 速度的動作。
  //
  // 【下界取 clearanceScale（500）而不是安全層的 clearance（120）】政策層
  // 不該把飛機送進硬限制的作用區。與 task #136 的六場護欄取同一條線。
  //
  // 【這道下界是活碼】任何 500 m 以下的分隊都會被抬上來 —— 也就是「撤退
  // 不改變高度」在低空是假的。加碼版（own.y + 800）要 own.y < −300 才咬
  // 得到，等於永遠不觸發。
  //
  // 【目前海面恆為 0】未來加入地形時這裡要與 `stationPoint` 一樣收
  // `seaHeight`，下界改成 `seaHeight + clearanceScale`。
  let y = own.y
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  return {
    kind: 'rally',
    // 【錨在敵群，不是自己】錨在自己的話位移量與「已經跑多遠」無關 ——
    // 那是一個沒有不動點的純積分器。錨在敵群之後這是一個固定的球殼，
    // 而且撤退本身不移動錨點（敵群質心不因我方撤退而動）。
    point: new Vector3(
      foe.x + dir.x * cfg.withdrawRange,
      y,
      foe.z + dir.z * cfg.withdrawRange,
    ),
    radius: cfg.arriveRadius,
    targetFlight: -1,
    side: 0,
    focusIndex: -1,
  }
}

/**
 * 側翼點的幾何。寫進 `out`，回傳 `false` 代表輸入退化到連質心都算不出來
 * （呼叫端保留舊點）。
 *
 * ```
 * u    = 目標分隊平均速度的水平單位向量
 * r    = u 的右手側水平法向量
 * out  = 目標質心 − u × flankTrail + side × r × flankOffset
 * out.y = clamp(目標質心.y + flankClimb, clearanceScale, 我方最低升限)
 * ```
 *
 * `−u × flankTrail` 把點放到他們**後方**而不是正側方：正側方是一個過渡
 * 位置，後側方才是能開始追蹤射擊的位置。
 *
 * 【退化階梯】`CommandUnit` **沒有 orientation**，所以沒有「機首」可以像
 * `stationPoint` 那樣退回去。改成：目標速度退化 → 由我方質心指向目標質心
 * （把他們當成正在遠離我們，點因此落在我們與他們之間，可及而且安全）→
 * 兩個質心也重合 → 取世界 −Z。**不 return NaN**：NaN 一旦進入距離比較，
 * 所有比較都變成 false，小隊會靜靜地永遠飛不到而且完全不報錯。
 *
 * 熱路徑：不配置（`stepCommand` 每步呼叫它）。
 */
function flankPoint(
  target: readonly CommandUnit[],
  own: readonly CommandUnit[],
  side: number,
  cfg: CommandConfig,
  out: Vector3,
): boolean {
  // ── 目標分隊的質心與平均速度 ──────────────────────────
  const foe = F.v[0]!.set(0, 0, 0)
  const vel = F.v[1]!.set(0, 0, 0)
  let m = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    if (!t.alive) continue
    foe.add(t.position)
    vel.add(t.velocity)
    m++
  }
  if (m === 0) return false
  foe.divideScalar(m)
  vel.divideScalar(m)

  // ── 我方質心與最低升限 ───────────────────────────────
  // 【上界取**我方**的升限】要飛上去的是我們，不是他們
  const us = F.v[2]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < own.length; i++) {
    const u = own[i]!
    if (!u.alive) continue
    us.add(u.position)
    if (u.serviceCeiling < ceiling) ceiling = u.serviceCeiling
    n++
  }
  if (n === 0) return false
  us.divideScalar(n)

  // ── 航向 u，退化階梯 ─────────────────────────────────
  let ux = vel.x
  let uz = vel.z
  let len = Math.hypot(ux, uz)
  if (len < MIN_HORIZONTAL) {
    ux = foe.x - us.x
    uz = foe.z - us.z
    len = Math.hypot(ux, uz)
    if (len < MIN_HORIZONTAL) {
      ux = 0
      uz = -1
      len = 1
    }
  }
  ux /= len
  uz /= len

  // 右手側：three 是 +X 右、+Y 上、−Z 前，所以航向 (ux, uz) 的右邊是
  // (−uz, ux)。驗算：朝 −Z（ux=0, uz=−1）時右邊是 (1, 0) = +X。
  // 與 `stationPoint` 的同一段驗算一致。
  const rx = -uz
  const rz = ux

  let y = foe.y + cfg.flankClimb
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  out.set(
    foe.x - ux * cfg.flankTrail + side * rx * cfg.flankOffset,
    y,
    foe.z - uz * cfg.flankTrail + side * rz * cfg.flankOffset,
  )
  return true
}

/** `flankPoint` 專用的暫存池。與其他函式分開，避免巢狀呼叫時別名衝突 */
const F = makeScratch(5)

/**
 * 一個候選點的危險分數：其他敵機離它多近。
 *
 * ```
 * danger(p) = Σ 1 / (1 + (|p − e| / dangerScale)²)
 * ```
 *
 * 【為什麼是平方反比核而不是「半徑內的計數」】計數需要一個半徑門檻，而門檻
 * 會讓分數在邊界上跳。連續核在相鄰輸入上連續 —— 與 `targetScore` 的三個
 * 折扣項、`floorPitchAngle` 的連續斜坡同一條紀律（spec §7.5 的否決條件）。
 *
 * 【為什麼不算目標分隊自己】側翼點本來就該靠近它。把它算進去等於懲罰
 * 「靠近要打的人」—— 呼叫端傳進來的 `others` 已經排除了目標分隊。
 *
 * 【為什麼不算友機】友機不危險。這裡問的是「這個點會不會被打」。
 *
 * 熱路徑之外（每 `planPeriod` 秒），不配置。
 */
function dangerAt(p: Vector3, others: readonly CommandUnit[], cfg: CommandConfig): number {
  let sum = 0
  for (let i = 0; i < others.length; i++) {
    const e = others[i]!
    if (!e.alive) continue
    const d = p.distanceTo(e.position) / cfg.dangerScale
    sum += 1 / (1 + d * d)
  }
  return sum
}

/** 選邊時「兩邊一樣安全」的判定寬容度。低於它就改用就近 */
const DANGER_TIE = 1e-9

/**
 * 從敵分隊的後側方切進去。`null` = 不該下這張命令。
 *
 * **純函數**：只讀三個快照陣列，不改它們，不碰世界（spec §6.3）。
 *
 * 【三種 `null`】目標分隊沒在交戰（spec §3.1 的開場死鎖防護）、任一邊全滅、
 * 兩個候選點都太危險。最後一條與 `planFocusTarget` 的「沒有一架可及」是同一
 * 條紀律：**規劃層寧可不發，也不發一張執行不了的命令。**
 *
 * 【配置】發令時配置一個 `Vector3`，每 `planPeriod` 秒最多一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param others 其餘敵機（**不含**目標分隊），算危險分數用
 * @param targetFlight 目標分隊的全域索引，原封不動寫進命令
 */
export function planFlankOrder(
  members: readonly CommandUnit[],
  target: readonly CommandUnit[],
  others: readonly CommandUnit[],
  targetFlight: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  // ── 開場死鎖防護（spec §3.1）────────────────────────────
  // 目標分隊要**已經被別人纏住**。少了這道閘門，開場所有人同時側翼、
  // 途中又不交戰，兩隊會互相繞圈一槍不開 —— 而且會自我維持
  let engaged = false
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    if (t.alive && t.cornerRatio < ENGAGED_RATIO) { engaged = true; break }
  }
  if (!engaged) return null

  const right = P.v[0]!
  const left = P.v[1]!
  if (!flankPoint(target, members, 1, cfg, right)) return null
  if (!flankPoint(target, members, -1, cfg, left)) return null

  const dr = dangerAt(right, others, cfg)
  const dl = dangerAt(left, others, cfg)

  let side: number
  if (dr < dl - DANGER_TIE) side = 1
  else if (dl < dr - DANGER_TIE) side = -1
  else {
    // 【一樣安全就取近的】轉場最短，也就是輸出為零的時間最短。
    // 用我方質心到兩個候選點的距離比
    const us = P.v[2]!.set(0, 0, 0)
    let n = 0
    for (let i = 0; i < members.length; i++) {
      const u = members[i]!
      if (!u.alive) continue
      us.add(u.position)
      n++
    }
    // n === 0 不可能走到這裡（flankPoint 已經回 false 了），但索引後的
    // 除法還是要防：NaN 會讓下面的比較靜靜地變成 false
    if (n > 0) us.divideScalar(n)
    side = us.distanceTo(right) <= us.distanceTo(left) ? 1 : -1
  }

  const chosen = side === 1 ? right : left
  if ((side === 1 ? dr : dl) > cfg.dangerLimit) return null

  return {
    kind: 'flank',
    point: chosen.clone(),
    radius: cfg.arriveRadius,
    targetFlight,
    side,
    focusIndex: -1,
  }
}

/**
 * 叫整隊集火同一架。`null` = 沒有任何一架可及。
 *
 * **純函數**，理由同 `planFlankOrder`。
 *
 * 【挑血最少的，不是 `targetScore` 最高的】`targetScore` 吃 `Aircraft`
 * （要 orientation 算機首、要 `threatFactor`），收它會毀掉這一層能出考題的
 * 性質；用速度方向代替機首是一個近似，而近似會製造第二個「誰好打」的答案。
 *
 * 而且「血最少」本來就是更對的判準：集火的整個賣點是**讓目標更快掉下來**，
 * 已經受創的那一架離掉下來最近 —— 這是史實的「打落單、打受傷」。
 * `targetScore` 回答的是另一個問題（「誰對**我**最有價值」，含威脅項與機會
 * 項），那是**單機**選目標的問題，不是**小隊集火**的問題。
 *
 * 【可及性是閘門不是加權項】一個追不到的目標再好打也沒用。寫成加權會在
 * 「重傷但追不到」與「健康但就在眼前」之間挑錯，有測試守著。
 *
 * @param candidateIndices 與 `candidates` **平行**，內容是 `units` 的全域索引
 */
export function planFocusTarget(
  members: readonly CommandUnit[],
  candidates: readonly CommandUnit[],
  candidateIndices: readonly number[],
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  // ── 我方質心與平均航向 ───────────────────────────────
  const us = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  for (let i = 0; i < members.length; i++) {
    const u = members[i]!
    if (!u.alive) continue
    us.add(u.position)
    vel.add(u.velocity)
    n++
  }
  if (n === 0) return null
  us.divideScalar(n)
  vel.divideScalar(n)

  // 【速度退化時錐形閘門放行】沒有速度就沒有「我們正在去的方向」。把所有人
  // 都擋掉會讓集火在重生瞬間靜靜地失效 —— 而那不是一個看得出來的失效
  let hx = vel.x
  let hz = vel.z
  const hlen = Math.hypot(hx, hz)
  const hasHeading = hlen >= MIN_HORIZONTAL
  if (hasHeading) { hx /= hlen; hz /= hlen }

  const cosCone = Math.cos(cfg.focusCone)

  let best = -1
  let bestHp = Infinity
  let bestDist = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive) continue

    const dist = us.distanceTo(c.position)
    if (dist > cfg.focusRange) continue

    if (hasHeading) {
      const dx = c.position.x - us.x
      const dz = c.position.z - us.z
      const dlen = Math.hypot(dx, dz)
      // 【水平重合時放行】方位沒有定義，而「就在我們頭上」不該被當成
      // 「偏離航向」擋掉
      if (dlen >= MIN_HORIZONTAL && (dx * hx + dz * hz) / dlen < cosCone) continue
    }

    // 血少的優先；同值取近的
    if (c.hpFraction < bestHp || (c.hpFraction === bestHp && dist < bestDist)) {
      best = i
      bestHp = c.hpFraction
      bestDist = dist
    }
  }
  if (best < 0) return null

  return {
    kind: 'focus',
    // 【集火不用點】給一個新的零向量而不是共用一個模組層級的常數 ——
    // 共用的可變向量被誰改到都查不出來。每 `planPeriod` 秒最多一次，不在
    // 熱路徑上
    point: new Vector3(),
    radius: 0,
    targetFlight: -1,
    side: 0,
    focusIndex: candidateIndices[best]!,
  }
}

/**
 * 把「該優先考慮」的分隊排出來，寫進 `out`（先清空）。
 *
 * **純函數**：只讀五個陣列，不改它們，不碰世界。與三個規劃函式同一個地位。
 *
 * 分數只問一件事：**這支分隊連續多久沒有人握著射擊解**（`idle`）。閒最久的
 * 排最前面 —— 問的是「叫誰去，損失最小」，不是「誰最有機會」（spec §4.1）。
 *
 * 【排名刻意不看敵方】要不要發、發給誰打由 `planFocusTarget` 決定；排名只
 * 回答「先考慮誰」。我方這邊看閒置度，敵方那邊看有沒有打得到的目標，各管
 * 一半，不重疊 —— 同一個問題不要有兩個答案。
 *
 * 【為什麼已持有命令的不進榜】遲滯就是這樣免費來的：命令照既有的解除條件
 * 走，不會出現「這一輪排第 3 拿到命令、下一輪排第 6 又被收回」的抖動。
 *
 * 【為什麼是插入排序】`own` 最多五個元素，而插入排序是**穩定**的 —— 由於
 * `own` 是遞增的，同 `idle` 值自然保持索引由小到大，破平手不需要額外的
 * 比較。決定性是 spec §7.4 的否決條件，靠 `Array.prototype.sort` 的實作
 * 細節來破平手是不能接受的。
 *
 * 熱路徑之外（每 `planPeriod` 秒），不配置。
 *
 * @param own        這個指揮官管的分隊索引，**必須是遞增的**
 * @param orders     每個分隊當下的命令，`null` = 沒有
 * @param idle       每個分隊的閒置秒數
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 * @param out        輸出。呼叫前不必清空，這裡會清
 */
export function rankFlights(
  flights: readonly CommandFlight[],
  own: readonly number[],
  units: readonly CommandUnit[],
  orders: readonly (FlightOrder | null)[],
  idle: Readonly<Float32Array>,
  skipFlight: number,
  out: number[],
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
  out.length = 0

  for (let oi = 0; oi < own.length; oi++) {
    const f = own[oi]!
    if (f === skipFlight) continue

    const flight = flights[f]
    if (flight === undefined || flight.count === 0) continue

    const o = orders[f]
    if (o !== undefined && o !== null) continue

    if ((idle[f] ?? 0) < cfg.idleSeconds) continue

    // 【成員全滅但 count 還沒壓縮】同一步裡 compactFlights 可能還沒跑過
    let alive = false
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u !== undefined && u.alive) { alive = true; break }
    }
    if (!alive) continue

    out.push(f)
  }

  // 插入排序，idle 大的在前。穩定，所以同值保持 `own` 的遞增順序
  for (let i = 1; i < out.length; i++) {
    const v = out[i]!
    const iv = idle[v] ?? 0
    let j = i - 1
    while (j >= 0 && (idle[out[j]!] ?? 0) < iv) {
      out[j + 1] = out[j]!
      j--
    }
    out[j + 1] = v
  }
}

/**
 * 規劃需要知道的分隊結構。
 *
 * 【為什麼不直接收 `FlightIndex`】現行的相依方向是 `battle → ai`：
 * `setup.ts` import `AiController`、`target.ts`、`station.ts`，而 `src/ai/`
 * **從來不 import `src/battle/`**。收 `FlightIndex` 會把箭頭反過來。
 *
 * `battle/flights.ts` 的 `Flight` 在結構上滿足這個介面，呼叫端直接傳過來
 * 就成立，不需要轉接層。與 `flights.ts` 自己定義 `FlightMember`（而不是收
 * `World.Combatant`）是同一個手法。
 */
export interface CommandFlight {
  /** 存活成員在 `units` 裡的索引。只有前 `count` 格有效 */
  readonly members: Int32Array
  readonly count: number
}

/** 指揮官對一支隊伍的狀態。每個分隊一格 */
export interface CommandState {
  /** `orders[f]` = 第 f 個分隊的命令；`null` = 自由交戰 */
  orders: (FlightOrder | null)[]
  /** 每個分隊「最低那一架連續低於門檻」累積的秒數 */
  spent: Float32Array
  /**
   * 每個分隊「連續多久沒有任何成員握著射擊解」累積的秒數。
   *
   * 【與 `spent` 分開】兩個計時器問的是不同的事：`spent` 問「還打得動嗎」
   * （能量），`idle` 問「正在得手嗎」（戰果）。一支能量充足但完全沒有射擊
   * 機會的分隊，兩個量會給出相反的答案 —— 而那正是最該被調去集火的分隊。
   */
  idle: Float32Array
  /** 距離下次規劃還有多久，s */
  timer: number
}

export function createCommandState(flightCount: number): CommandState {
  return {
    orders: new Array<FlightOrder | null>(flightCount).fill(null),
    spent: new Float32Array(flightCount),
    idle: new Float32Array(flightCount),
    // 【起始為 0，第一步就規劃一次】起始為 planPeriod 的話開場前兩秒的
    // 指揮官是啞的，而開局正是編隊最完整、最該被指揮的時候
    timer: 0,
  }
}

/**
 * 推進指揮官一步：累積見底計時、維護命令、到期時規劃。
 *
 * 【為什麼計時每步跑而規劃每 N 秒跑】見底是一個**持續**條件（第一份
 * spec §2.4），漏數任何一步都會低估；而規劃是昂貴的而且是戰役尺度的決定，
 * 不該與戰機的機動同頻。這與 `AiController` 把幾何放 240 Hz、意圖仲裁放
 * 10 Hz 是同一個分頻原則。
 *
 * 【為什麼收 `own` / `foe` 兩組分隊索引】收攤平的敵機名單並掃**全部**分隊
 * 的話，藍方指揮官會替紅方分隊也規劃一遍、結果從來不被讀 —— 浪費一半的
 * 規劃工作，而且讀起來會讓人以為藍方在指揮紅方。側翼要挑「某一個敵分隊」
 * 也本來就需要敵方的分隊結構。
 *
 * 熱路徑：每步的部分不配置（側翼點的重算走 `flankPoint`，寫進既有的
 * `order.point`）。發令的那一格會配置一個 `Vector3`。
 *
 * @param flights  **全部**分隊，全域索引
 * @param own      這個指揮官管的分隊索引
 * @param foe      敵方的分隊索引
 * @param units    每架快照，全域索引，與 `CommandFlight.members` 對應
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 */
export function stepCommand(
  s: CommandState,
  flights: readonly CommandFlight[],
  own: readonly number[],
  foe: readonly number[],
  units: readonly CommandUnit[],
  skipFlight: number,
  dt: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
  s.timer -= dt
  const plan = s.timer <= 0
  if (plan) s.timer += cfg.planPeriod

  for (let oi = 0; oi < own.length; oi++) {
    const f = own[oi]!
    const flight = flights[f]!

    // 【玩家那一隊自治】spec §2.1。也涵蓋全滅的分隊 —— 兩者都要把殘留的
    // 命令清掉，否則分隊復活（重置戰鬥）時會拿到一張過期的命令
    if (f === skipFlight || flight.count === 0) {
      s.orders[f] = null
      s.spent[f] = 0
      s.idle[f] = 0
      continue
    }

    // ── 見底計時：小隊裡第 `spentRank` 低的那一架 ──────────
    // 【為什麼不是恆取最低】見 `CommandConfig.spentRank`：四機小隊的最小值
    // 遠低於中位數，一架落單掉速的僚機就能把整支分隊拖出戰場三成的時間。
    //
    // 【為什麼是插入排序不是 Array.sort】分隊最多 4 人，而這一段每 dt 都跑
    // 一次（40 架 × 240 Hz）。`sort` 會配置 —— 熱路徑不得配置。
    RATIOS.length = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      let i = RATIOS.length
      RATIOS.push(u.cornerRatio)
      while (i > 0 && RATIOS[i - 1]! > RATIOS[i]!) {
        const t = RATIOS[i - 1]!
        RATIOS[i - 1] = RATIOS[i]!
        RATIOS[i] = t
        i--
      }
    }
    // 【空的時候是 Infinity】成員全部陣亡時不該累積見底，所以初值是
    // `Infinity` 不是 0。
    //
    // 【三面都要夾】上界是存活人數，下界是 0，而且要取整。`RATIOS[-1]`、
    // `RATIOS[0.5]`、`RATIOS[9]` 都是 `undefined`，而 `undefined < spentRatio`
    // 是 `false` —— 見底計時會被**靜靜地關掉**，撤退令從此不再發出，不丟
    // 任何例外也沒有錯誤訊息。
    const k = Math.min(Math.max(Math.floor(cfg.spentRank), 0), RATIOS.length - 1)
    const worst = RATIOS.length === 0 ? Infinity : RATIOS[k]!
    if (worst < cfg.spentRatio) s.spent[f] = s.spent[f]! + dt
    else s.spent[f] = 0

    // ── 閒置計時：隊裡**任何一架**握著射擊解就歸零 ──────────
    // 【為什麼是最大值而不是最低那一架】見底問的是「最弱的那一架拖不拖得
    // 動」，所以取最低；閒置問的是「這支分隊有沒有在得手」，只要有一架在
    // 得手就不該被調走，所以取最大
    let best = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      if (u.shotInstant > best) best = u.shotInstant
    }
    if (best <= 0) s.idle[f] = s.idle[f]! + dt
    else s.idle[f] = 0

    // ── 命令的維護：三種各自的解除條件 ────────────────────
    const order = s.orders[f]
    if (order !== undefined && order !== null) {
      // 【撤退優先於兩個進攻戰術，而且是一條解除條件】spec §3。優先序若
      // 只寫在規劃的那一格，一張已經發出的進攻命令會把小隊釘在那裡直到
      // 它到位 —— 期間就算打不動了也換不到撤退令，而「打不動的小隊被派
      // 出去切側翼」正是這條優先序要防的事。解除之後下一次規劃走撤退那
      // 一支（`spent` 不歸零，所以那一支立刻成立）
      // 【解除進攻命令時 idle 一律歸零，四處都是】spec §5.1。少了它，剛
      // 解除的分隊在下一個週期就會回到榜首（它確實是閒的），於是被永久釘
      // 在命令狀態。rally 那一支**不加** —— 它歸零的是 spent，一支剛撤退
      // 回來的分隊本來就是閒的，沒有理由再罰它一次
      if (order.kind !== 'rally' && s.spent[f]! >= cfg.spentSeconds) {
        s.orders[f] = null
        s.idle[f] = 0
        continue
      }
      if (order.kind === 'focus') {
        const t = units[order.focusIndex]
        // 【兩個解除條件】目標陣亡，或跑到遲滯帶之外。
        // 發令要求 < focusRange（1500）、解除要求 > FLANK_RANGE（2500），
        // 兩個不同的數字就是遲滯 —— 同一個門檻發令與解除會在邊界上抖
        if (t === undefined || !t.alive
          || centroidDistance(flight, units, t.position) > FLANK_RANGE) {
          s.orders[f] = null
          s.idle[f] = 0
        }
      } else if (order.kind === 'flank') {
        const tf = flights[order.targetFlight]
        if (tf === undefined || tf.count === 0) {
          // 目標分隊全滅：這張命令沒有對象了
          s.orders[f] = null
          s.idle[f] = 0
        } else {
          gather(TARGET, tf, units)
          gather(MEMBERS, flight, units)
          // 【點每步重算】凍結的是 side 與 targetFlight，不是座標。
          // 算不出來（兩邊都全滅）時保留舊點，下一步再試
          flankPoint(TARGET, MEMBERS, order.side, cfg, order.point)
          if (flankArrived(MEMBERS, TARGET, cfg)) {
            s.orders[f] = null
            s.idle[f] = 0
          }
        }
      } else {
        // rally：到達判**長機**，不是小隊質心。
        //
        // 【為什麼不是質心】兩層各自都對，合起來卻永遠不成立：`AiController`
        // 只把集合點給長機（「只操縱長機，編隊靠既有機制跟上」），僚機拿到
        // 的是「別打了」+ 站位保持；而質心被落在站位偏置上的僚機拖著，長機
        // 飛過點的那一瞬質心離點還有一整個編隊尺度。
        //
        // 而 `rallyAim` 是對固定點的**純追擊、沒有抵達行為** —— 命令不解除
        // 就等於長機繞著那個點無限盤旋。實測回報（seed 297534859、座位 #8）：
        // `命令 rally` 連握 200 秒以上，高度鎖在 5258~5306 m、速度
        // 319~333 km/h、mode 恆為 `unload`（吃滿迎角在轉彎）。
        //
        // 判長機就沒有這個縫：被送去的那一架自己說了算。
        if (leaderDistance(flight, units, order.point) <= order.radius) {
          s.orders[f] = null
          // 【歸零就是遲滯】要再累積滿 spentSeconds 才會重發（第一份
          // spec §4.2）。少了這一行，抵達的下一格就會立刻重發
          s.spent[f] = 0
        }
      }
      continue
    }

    // ── 階段一：撤退。**不佔配額**（spec §3.2）────────────
    // 「打不動了」是一個事實，不是指揮官在分配資源。而且撤退本來就有自己
    // 的門檻與遲滯（spentSeconds、到達歸零）
    if (!plan) continue
    gather(MEMBERS, flight, units)

    FOES.length = 0
    for (let fi = 0; fi < foe.length; fi++) {
      const ef = flights[foe[fi]!]
      if (ef === undefined) continue
      for (let p = 0; p < ef.count; p++) {
        const u = units[ef.members[p]!]
        if (u !== undefined && u.alive) FOES.push(u)
      }
    }
    const retreat = planFlightOrder(MEMBERS, FOES, s.spent[f]!, cfg)
    if (retreat !== null) s.orders[f] = retreat
  }

  // ── 階段二：排名與配額（spec §5）──────────────────────
  if (!plan) return

  // 【在維護之後數】這一步解除的命令要立刻把名額釋出，否則名額會晚一個
  // 規劃週期才回來
  let held = 0
  for (let oi = 0; oi < own.length; oi++) {
    const o = s.orders[own[oi]!]
    if (o !== undefined && o !== null && o.kind !== 'rally') held++
  }
  let slots = cfg.maxOrders - held
  if (slots <= 0) return

  rankFlights(flights, own, units, s.orders, s.idle, skipFlight, RANKED, cfg)

  for (let ri = 0; ri < RANKED.length && slots > 0; ri++) {
    const f = RANKED[ri]!
    const flight = flights[f]!
    gather(MEMBERS, flight, units)
    if (MEMBERS.length === 0) continue

    // 挑最近的敵分隊
    let nearest = -1
    let nearestDist = Infinity
    for (let fi = 0; fi < foe.length; fi++) {
      const gi = foe[fi]!
      const ef = flights[gi]
      if (ef === undefined || ef.count === 0) continue
      gather(TARGET, ef, units)
      if (TARGET.length === 0) continue
      let cx = 0, cy = 0, cz = 0
      for (let i = 0; i < TARGET.length; i++) {
        cx += TARGET[i]!.position.x; cy += TARGET[i]!.position.y; cz += TARGET[i]!.position.z
      }
      const k = TARGET.length
      const d = centroidDistanceTo(MEMBERS, cx / k, cy / k, cz / k)
      if (d < nearestDist) { nearestDist = d; nearest = gi }
    }
    if (nearest < 0) continue

    // 遠 → 側翼（目前停用）；近 → 集火（spec §3.2）
    const tf = flights[nearest]!
    gather(TARGET, tf, units)
    let issued: FlightOrder | null = null
    if (nearestDist > FLANK_RANGE) {
      // 【側翼已停用】見 `FLANK_ENABLED`
      if (FLANK_ENABLED) {
        OTHERS.length = 0
        for (let fi = 0; fi < foe.length; fi++) {
          const gi = foe[fi]!
          if (gi === nearest) continue
          const ef = flights[gi]
          if (ef === undefined) continue
          for (let p = 0; p < ef.count; p++) {
            const u = units[ef.members[p]!]
            if (u !== undefined && u.alive) OTHERS.push(u)
          }
        }
        issued = planFlankOrder(MEMBERS, TARGET, OTHERS, nearest, cfg)
      }
    } else {
      TARGET_IDX.length = 0
      for (let p = 0; p < tf.count; p++) {
        const gi = tf.members[p]!
        const u = units[gi]
        if (u !== undefined && u.alive) TARGET_IDX.push(gi)
      }
      issued = planFocusTarget(MEMBERS, TARGET, TARGET_IDX, cfg)
    }

    // 【回 null 不消耗名額】排名只決定考慮順序，能不能發由規劃函式自己說
    if (issued === null) continue
    s.orders[f] = issued
    slots--
  }
}

/**
 * 規劃時把分隊成員收集起來的暫存陣列。
 *
 * 【為什麼是模組層級的可變陣列】三個規劃函式都收 `readonly CommandUnit[]`
 * 是為了單元測試好寫字面陣列；而這裡每次規劃都 `new Array` 會在 20v20 下
 * 每兩秒配置幾十次。重用並在每次使用前 `length = 0`，與 `setup.ts` 的
 * `ASSISTS` 同一個做法。
 *
 * **`MEMBERS` 與 `TARGET` 不得在同一次 `gather` 之間交錯使用** —— 它們是
 * 不同的陣列，但同一個陣列被 gather 兩次就會失去第一次的內容。
 */
const MEMBERS: CommandUnit[] = []
const TARGET: CommandUnit[] = []
const OTHERS: CommandUnit[] = []
const FOES: CommandUnit[] = []
/** 見底排序用的模組層暫存。熱路徑：不配置。 */
const RATIOS: number[] = []
const TARGET_IDX: number[] = []
/** 排名的輸出。重用，理由同上 */
const RANKED: number[] = []

/** 把一個分隊的存活成員收進 `out`（先清空）。不配置 */
function gather(
  out: CommandUnit[], flight: CommandFlight, units: readonly CommandUnit[],
): void {
  out.length = 0
  for (let p = 0; p < flight.count; p++) {
    const u = units[flight.members[p]!]
    if (u !== undefined && u.alive) out.push(u)
  }
}

/** 一個分隊的存活質心離 `p` 多遠。全滅時回 `Infinity`（比不上任何門檻） */
function centroidDistance(
  flight: CommandFlight, units: readonly CommandUnit[], p: Vector3,
): number {
  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return Infinity
  return Math.hypot(cx / n - p.x, cy / n - p.y, cz / n - p.z)
}

/**
 * 分隊長機離 `p` 多遠。全滅時回 `Infinity`（比不上任何門檻）。
 *
 * 【為什麼掃第一個**存活**的成員而不是 `members[0]`】`compactFlights` 每個
 * 物理步保序重壓，正常情況下 `members[0]` 就是活著的長機。但這一層吃的是
 * 快照，壓縮與 `stepCommand` 的先後順序是呼叫端的事 —— 寫死索引 0 會在
 * 「長機剛陣亡、還沒重壓」的那一格算到一具屍體的座標，命令從此解除不了。
 * 保序壓縮下「第一個存活者」與「繼位後的長機」是同一架，所以這不是近似。
 */
function leaderDistance(
  flight: CommandFlight, units: readonly CommandUnit[], p: Vector3,
): number {
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    return Math.hypot(u.position.x - p.x, u.position.y - p.y, u.position.z - p.z)
  }
  return Infinity
}

/** 已經收集好的一群的質心離 (x,y,z) 多遠。全滅時回 `Infinity` */
function centroidDistanceTo(
  group: readonly CommandUnit[], x: number, y: number, z: number,
): number {
  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < group.length; i++) {
    const u = group[i]!
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return Infinity
  return Math.hypot(cx / n - x, cy / n - y, cz / n - z)
}

/**
 * 側翼到位了嗎 —— **幾何判定，不是距離**。
 *
 * ```
 * u = 敵分隊平均速度的水平單位向量
 * d = 由敵分隊質心指向我方質心的水平單位向量
 * 到位 ⇔ d · u < cos(flankSector)  且  兩個質心的距離 < FLANK_RANGE
 * ```
 *
 * 【為什麼不用「離側翼點小於 arriveRadius」】那個判準在追一個移動目標時
 * 可能永遠不成立，正是第一份 spec §4.1 記載的病 —— 而敵**分隊**質心 30 秒
 * 飄 2040~4663 m（實測）。幾何判準不會過期。
 *
 * 【為什麼距離門用 `FLANK_RANGE` 而不是新的一個數字】側翼命令的**發出**
 * 條件就是距離 > `FLANK_RANGE`，所以解除用同一條線不會抖：解除的那一格
 * 距離必然 < `FLANK_RANGE`，下一次規劃走的是集火那一支。
 *
 * 熱路徑：不配置（每步呼叫）。
 */
function flankArrived(
  members: readonly CommandUnit[],
  target: readonly CommandUnit[],
  cfg: CommandConfig,
): boolean {
  let fx = 0, fy = 0, fz = 0, vx = 0, vz = 0, m = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    fx += t.position.x; fy += t.position.y; fz += t.position.z
    vx += t.velocity.x; vz += t.velocity.z
    m++
  }
  if (m === 0) return false
  fx /= m; fy /= m; fz /= m; vx /= m; vz /= m

  let ux = vx
  let uz = vz
  const ulen = Math.hypot(ux, uz)
  // 【速度退化時不算到位】方向沒有定義就沒有「後側方」可言。回 false 讓
  // 命令繼續 —— 比誤判到位安全，下一步速度多半就回來了
  if (ulen < MIN_HORIZONTAL) return false
  ux /= ulen; uz /= ulen

  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < members.length; i++) {
    const u = members[i]!
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return false
  cx /= n; cy /= n; cz /= n

  if (Math.hypot(cx - fx, cy - fy, cz - fz) >= FLANK_RANGE) return false

  let dx = cx - fx
  let dz = cz - fz
  const dlen = Math.hypot(dx, dz)
  // 【水平重合】方位沒有定義。當成到位 —— 已經貼在他們身上了
  if (dlen < MIN_HORIZONTAL) return true
  dx /= dlen; dz /= dlen

  return dx * ux + dz * uz < Math.cos(cfg.flankSector)
}
