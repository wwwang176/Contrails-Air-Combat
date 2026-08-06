# 看得見的閃躲 設計

**日期**：2026-08-06
**前幾份**：`2026-08-05-ai-defence-batch2-design.md`（異平面、力道、反轉）、
`2026-08-06-ai-reaction-delay-design.md`、`2026-08-06-safety-lookahead-design.md`

## 1. 判準換了，這是整份 spec 的前提

先前四份 spec 的判準是**結果**——被鎖定佔比、掉血、比能量、最低高度。專案
負責人指出那是錯的目標：

> 我增加 AI 閃躲，不是為了寫實與打得更好，我要的是遊戲性。原本的 AI 遇到我
> 從遠方連續射擊，AI 不會閃躲（或看不出來有閃躲），導致 AI 看起來就很笨。

並給了一個可自動化的驗收方法：

> 後方敵人準星放在敵機預瞄位置時，看到前方 900 m 的敵機預瞄位置有大幅度
> 變化，就算 OK。幅度 5 度左右就算及格。

**新的主判準**：由射手位置指向目標**預瞄點**的單位向量，在 **1 秒滑動窗**內的
角位移。它量的不是 AI 做了什麼，而是**玩家的瞄準工作被打亂多少**——一架滾得
很誇張但預瞄點沒動的飛機其實沒在閃；預瞄點跳 5° 的飛機，玩家非重新瞄不可。

原本那些結果指標**全部降級為護欄**：不再要求變好，只要求不崩。

## 2. 基準線：問題 100% 在觸發，不在動作

三機受控場景：藍方（受測 AI）追一架腳本慵懶盤旋的紅 A，紅 B 是**腳本射手**
（準星永遠壓在預瞄點上、連續開火、用油門維持距離），180 秒。

```
射手距離  延遲  挨打取樣 進defend ┃ defend中：中位 p90  ≥5° ┃ 平常：中位 p90  ≥5°
700 m    0.00     3580    0.0%   ┃    0.0   0.0   0%  ┃   2.9  3.1   0%
         0.30     2993    0.0%   ┃    0.0   0.0   0%  ┃   3.0  3.3   0%
         0.50     2170    7.9%   ┃   12.2  13.3 100%  ┃   2.9  4.6   8%
900 m    0.00     1967    0.0%   ┃    0.0   0.0   0%  ┃   2.9  3.0   0%
         0.30     1681    0.0%   ┃    0.0   0.0   0%  ┃   2.9  3.3   0%
         0.50     1070    0.0%   ┃    0.0   0.0   0%  ┃   2.9  6.1  15%
1200 m   任何       0/0    0.0%   ┃      —             ┃     —
```

1. AI 被連續射擊 100~180 秒，**`defend` 進入率 0.0%**（九列裡八列一次都沒閃）。
2. 平常的預瞄位移中位 2.9°、p90 3.0~3.3°——**低於 5° 的及格線**。玩家坐在
   後面打，準星幾乎不用動。這就是「看起來很笨」的量化版本。
3. 它真的閃的那一次：中位 **12.2°**、p90 13.3°、100% 超過 5°。**是及格線的
   2.4 倍。動作本身早就夠看得見了。**

### 2.1 不觸發是算術，不是調參

`threatFactor` 的距離因子是 `1 − range/900`，`defend` 的進入門檻
`DEFAULT_RULES.threatEnter = 0.35`。就算射手瞄得完美（機首因子 = 1）、追蹤
已飽和（`trackingFactor` = 1）：

```
threat = 1 − range/900 ≥ 0.35   →   range ≤ 585 m
```

**超過 585 m，威脅值在數學上不可能到達閃躲門檻**，不管打多久、瞄多準。真人
玩家瞄準偏 5°（機首因子 0.67）的話，門檻要到 **430 m**。而 `THREAT_RANGE = 900`
是**硬截斷**——1200 m 開火時 AI 收到的訊號是「沒有人在打我」（上表 0/0）。

### 2.2 病因：一個函數被拿去回答兩個問題

`threatFactor` 回答的是「**他打得中我的機率有多高**」。給**目標選擇**用完全
正確——遠距離的敵人確實比較不致命。但 `defend` 拿同一個函數當「**我該不該
閃**」的判準，就變成「只有快被打死才閃」。

遊戲性要的是相反的：**有人朝我開槍，我就該有反應**，不管他打不打得中。

## 3. 設計

三件事，依重要性排序。

### 3.1 「我正在挨槍」——讀真實的子彈

**成本結論先講：幾乎免費，因為那個距離已經在算了。**

`World.resolveHits`（全專案最熱的迴圈，4,000 發 × 40 架）現在的粗篩是：

```ts
if (segmentPointDistanceSq(ax,ay,az, bx,by,bz, cx,cy,cz) > cull.r2[j]!) continue
```

`segmentPointDistanceSq` 就是「子彈這一步掃過的線段離機體重心多遠」。近失
偵測是**同一個數字跟一個大一點的半徑比**，多一個 `if`。真正貴的
`hitAircraft`（六次 slab 測試 + 兩次四元數旋轉）仍然只在窄判定通過時才跑。

唯一的成本是粗篩的 x 視窗要由 ±`rMax` 放寬到 ±`nearMissRadius`。40 架散在
10 km 上，30 m 的視窗內平均不到 0.3 架。**預期量不出來**，由 900 µs 的效能
門檻證明。

**資料放哪**

`Combatant`（`src/world/World.ts`）新增兩個欄位，與既有的 `hitsDealt` 同一個
性質——`resolveHits` 寫、別人讀：

```ts
/** 自上次被**敵方**子彈近距離擦過以來的秒數。Infinity = 從未 */
nearMissAge: number
/** 那一發的射手索引；−1 = 無 */
nearMissFrom: number
```

`TargetCandidate`（`src/ai/target.ts`）加上同樣兩個欄位。`Combatant` 因此在
結構上仍然滿足 `TargetCandidate`（現在就是靠結構相容才能
`createTargetBoard(world.combatants)`），**AI 不必 import `world/World`**，
分層不變。

【為什麼不是讓 `World` 直接寫進 `AiController`】那要 `world/` import `ai/`，
方向相反。指派板本來就是「AI 對世界的視野」，這個訊號屬於那裡。

【同隊子彈不算】`resolveHits` 已經有陣營過濾，近失沿用同一條。被隊友的流彈
嚇到而閃躲，在畫面上是無法解釋的行為。

**訊號的形狀**

```
underFire = clamp(1 − nearMissAge / nearMissHold, 0, 1)
```

一發近失把它推到 1，再花 `nearMissHold` 秒線性衰減到 0。連續射擊會不斷
重置，停火後自己熄掉。

**怎麼併進 `defend`**

`rules.ts` 現在是 `latch(defendLatch, threat, threatEnter, threatExit)`。改成：

```
danger = max(threat, underFire)
latch(defendLatch, danger, threatEnter, threatExit)
```

【為什麼是 `max` 而不是相加或取代】沒有子彈時 `underFire = 0`，`danger`
**逐位元等於 `threat`** —— 全部既有測試因此一個數字都不會動。這與
`CommandDelay` 在零延遲時走捷徑是同一個手法：新機制只能是**額外的一條路**，
不能改動舊路。

`nearMissHold = 2 s` 的話，一發近失買到約 1.7 秒的 `defend`（1.3 s 在
`threatEnter` 之上，之後靠 `threatExit = 0.15` 的遲滯撐到 1.7 s）。

### 3.2 異平面破防

`stash@{0}` 有完整實作（`DefendState`、`stepDefend`、`breakAxis`、
`defendFloor` 的低空強制選朝上）。設計理由見
`2026-08-05-ai-defence-batch2-design.md` §3.3，不重複。

**已知的代價**（12 幾何 × 300 秒，撞地前瞻已生效，同平面對照）：

```
破防軸           延遲   被鎖定  破防佔比  平均最低高度  觸地場次
我的升力（現行）   0.30   23.3%   11.6%        879       0/12
攻擊者橫軸+朝上   0.30   28.9%   19.0%        207       3/12
```

在**舊判準**下這三欄都比較差，那正是它先前被否決的原因。在**新判準**下，
被鎖定佔比不再是判準，**最低高度與觸地變成護欄**——3/12 觸地不可接受，
要壓下來，但那是「要修的問題」不是「否決的理由」。

**選邊要重掃**：`defendFloor` ∈ {600, 2000, 永遠朝上}，因為 3.1 上線之後
`defend` 佔比會大幅上升，先前那組掃描的前提（破防很少發生）不再成立。

### 3.3 反轉——**只做瞄準那一半**

判定沿用 batch-2 spec §3.4：距離 < `reversalRange`、攻擊者跑到我的前半球
（`reversalAspect`）、且我正在 `defend`。倒數 `reversalHold` 秒期間瞄準點改成
對**攻擊者**的追擊解。

**越權換目標那一半不做。** 2026-08-06 量到：紅 B 真的衝過頭時，藍方的目標
**100% 已經是紅 B**（兩個延遲、六個場景全部）。`TargetState.urgent` 解決的是
一個不存在的問題，而且它會鬆動 20v20 好不容易穩定下來的 A→B→A 猶豫。
記錄在 `src/ai/target.ts` 的註解。

**窗口很小是已知的**：AI 對 AI 的量測顯示「衝過頭」只佔 1.6% 的取樣。專案
負責人的裁決是照做——真人玩家衝過頭的頻率遠高於 AI，而且這一項的價值在
「難得發生時很精彩」，不在佔比。

## 4. 介面

**`src/world/World.ts`**

```ts
interface Combatant { …; nearMissAge: number; nearMissFrom: number }
```
`resolveHits` 寫入，`step` 每步老化（`nearMissAge += dt`）。

**`src/ai/target.ts`**

```ts
interface TargetCandidate { …; nearMissAge: number; nearMissFrom: number }
```

**`src/ai/assess.ts`**

```ts
export function underFireSignal(nearMissAge: number, cfg?: ThreatConfig): number
```

**`src/ai/rules.ts`**

`stepRules` 的 `threat` 參數旁邊多一個 `underFire`，內部取 `max`。

**`src/ai/steer.ts`**（由 `stash@{0}` 還原）

```ts
export interface DefendState { sign, active, attacker, low, reversal }
export function createDefendState(): DefendState
export function stepDefend(state, self, attacker, defending, sit, seaHeight, cfg): void
```
`steerCommand` 多一個 `defend: DefendState` 參數。

**新參數**

| 參數 | 起始值 | 掃描範圍 | 守它的量測 |
|---|---|---|---|
| `nearMissRadius` | 30 m | 15 / 30 / 60 / 120 | 觸發涵蓋率、`defend` 佔比 |
| `nearMissHold` | 2.0 s | 1 / 2 / 4 | `defend` 佔比、抖動 |
| `defendFloor` | 600 m | 600 / 2000 / ∞ | 觸地場次、最低高度 |
| `reversalRange` | 500 m | 300 / 500 / 800 | 反轉次數 |
| `reversalAspect` | 90° | 60 / 90 / 120 | 反轉次數、誤觸發 |
| `reversalHold` | 2 s | 1 / 2 / 4 | 反轉後取得射擊解的比例 |

全部標為**待實測回填**，掃描表寫進各欄位註解。

## 5. 量測與驗收

### 5.1 主判準（新增 `test/integration/ai-visible-evasion.test.ts`）

場景就是 §2 的三機腳本射手場景，射手距離 700 / 900 / 1200 m。

| 指標 | 現況 | 驗收 |
|---|---|---|
| 挨打取樣裡 `defend` 的佔比（**觸發涵蓋率**） | 0.0% | **> 50%** |
| `defend` 期間的 1 秒預瞄位移中位數 | 12.2°（罕見） | **≥ 5°** |
| 平常（非 defend）的位移中位數 | 2.9° | 不設門檻，作為對照印出 |
| 1200 m 的挨打取樣數 | 0 | **> 0**（證明硬截斷被繞過） |

【為什麼觸發涵蓋率取 50%】現況是 0，任何正數都是進步，但門檻要抓的是
「玩家開槍時 AI **通常**會有反應」。低於一半的話玩家仍然會覺得它時靈時不靈。
**這個值在掃完 `nearMissRadius` / `nearMissHold` 之後可能上修，不得下修。**

### 5.2 護欄——重新定值，由專案負責人裁定

3.1 上線之後 `defend` 佔比必然大幅上升，被鎖定佔比、能量、高度**都會變差**。
那是**預期的代價，不是退步**。所以：

1. 先跑一次量出新的實際值；
2. 把「比現在差多少還可以接受」交給專案負責人裁定；
3. 才把數字寫成門檻。

**不得**拿舊基準卡新行為，也**不得**為了讓舊門檻綠而縮小改動。

唯二不可讓的兩條：

- **不觸地。** `test/integration/ai-reaction-delay.test.ts` 的四延遲低空條維持。
  AI 自殺比呆滯更難看。
- **仍然會攻擊。** `ai-defence.test.ts` 的 `dealtToA > 0` 維持。閃躲不能變成
  「只會逃」。

以及效能：`test/unit/perf-gate.test.ts` 三個 900 µs，單獨跑（並行負載下會誤判）。

### 5.3 抖動護欄

預瞄點位移這個指標有一個漏洞：**每 0.1 秒左右擺一次的 AI 分數會很高，但玩
起來是抽搐不是閃躲**（這個專案 2026-08-05 才治好一次同樣的病）。

所以除了「位移 ≥ 5°」，再加一條：**那 1 秒內的位移必須同向**。實作為
「1 秒窗的**淨**角位移 ÷ 逐格角位移總和 ≥ 0.5」——直線的閃躲接近 1，來回
擺動接近 0。這一條寫成斷言。

### 5.4 混沌紀律（沿用）

- 單場勝負、擊落時間、單一軌跡的傷害不作為判準。
- 只採聚合比率量與受控場景的逐場可重現值。
- 動到 `defend` 的改動一律看 **120 秒以上**的窗，而且**必須同時看最低高度**。

### 5.5 覆蓋邊界（明講，以免以為測到了）

新訊號經由**指派板**傳遞，所以 `board = null` 的測試
（`ai-manoeuvre`、`ai-duel-matrix`、`ai-reaction-delay` 的 1v1）**完全吃不到
它**，基準因此不動。那是刻意的——那一層量的是 AI 的天花板。代價是**出貨行為
只由 §5.1 那個新檔案守著**，與 `ACE` / `VETERAN` 的分工同一個模式。

## 6. 風險

1. **閃太頻繁 → 另一種難看。** 觸發涵蓋率由 0% 拉到 >50% 是很大的變化。
   `nearMissRadius` 太大會讓 AI 對遠處的流彈也閃。由 §5.3 的抖動條與人工
   試飛守。
2. **AI 變得打不到人。** 一直在閃就一直不在瞄。由 `dealtToA > 0` 守，但那
   是很鬆的護欄；真正的判準是專案負責人試飛時覺不覺得敵人變成沙包。
3. **異平面把飛機往地上帶。** 現況 3/12 觸地，而 `defend` 佔比還要再上升。
   這是本案最可能失敗的一項。若 `defendFloor` 三個值都壓不下來，**異平面
   退回同平面**（動作本身已經拿 12.2°，不需要為了可見度賭上撞地）。
4. **效能。** 預期免費，但 x 視窗放寬是實打實的。若 900 µs 守不住，改用
   「只在有人開火的那幾步做近失掃描」。
5. **混沌。** 比照前五次，只採聚合量。

## 7. 明確不做

- 不改 `threatFactor`（它給目標選擇用，那個用途是對的）。
- 不改 `THREAT_RANGE` / `THREAT_CONE` / `threatEnter` / `threatExit`
  ——調門檻只是把 585 m 推成別的任意數字，治不好 900 m 的硬截斷。
- 不做力道連續化（已量到在這個介面上表達不出來）。
- 不做能量限制拉桿（延遲下重測仍然否決）。
- 不做 `TargetState.urgent`（已量到不需要）。
- 不改 `DifficultyProfile`、不改 `specs/feel.ts`。

## 8. 全域限制

- 不得引入 `@types/node`。
- `noUncheckedIndexedAccess` 開啟。
- `src/world/` 不得 import `src/render/`、`src/hud/`、`src/ai/`。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體。
- 每一條新測試先驗紅。
- **不得為了讓測試通過而放寬門檻**；門檻要改必須由專案負責人裁定並說明理由。
- commit 指定明確路徑，不得 `git add -A`。
- 型別檢查是 `npx tsc --noEmit`。
