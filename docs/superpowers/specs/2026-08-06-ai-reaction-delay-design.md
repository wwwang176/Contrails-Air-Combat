# AI 反應延遲 設計

**日期**：2026-08-06
**前一份**：`2026-08-06-ai-energy-aware-pull-design.md`（實測否決）
**相關**：`2026-08-05-ai-defence-batch2-design.md`（異平面破防、力道連續化，皆實測否決）

## 1. 這份 spec 從哪來

連續四個防禦提案被實測否決（射程內控速、力道連續化、異平面破防、依能量狀態
限制拉桿）。使用者提出的質疑是對的：

> 這樣等於是三個真實防禦手段都取消了，為什麼？理論上在這個真實物理引擎的
> 遊戲中應該是可以做到的不是嗎？

查證之後找到的答案不在防禦端，而在**攻擊端**：

> 之所以你測試可能無效，有可能是因為我們的 AI 咬人能力太強，真實玩家
> 反應不會這麼快吧？

**所有以欺敵為原理的 BFM 動作，前提都是對手要花時間才看得懂。** 異平面破防、
反轉、剪刀，全部靠的是「他判讀錯一拍」。`DifficultyProfile.reactionDelay` 早就
宣告在 `src/ai/profile.ts`，但**整個 codebase 沒有任何一處讀它**——唯一提到它的
地方是 `test/unit/ai-controller.test.ts` 斷言它等於 0。

於是攻擊者是一個零延遲的完美追蹤器，任何欺敵動作在它面前都只是白白掉能量。

## 2. 量測（否決的動作在延遲下復活）

受控場景：兩架 P-51D，4000 m、TAS 160、攻擊者在正後方 300 m，30 秒，
防禦者用固定的 75° 破防（不跑 AI，避免意圖切換污染），攻擊者跑完整 AI 並把
輸出指令延後 n 毫秒。

**被鎖定的時間佔比（軸 = 攻擊者的橫軸，即異平面破防）**

| 力道 | 0 ms | 150 | 300 | 500 |
|---|---|---|---|---|
| 0.50 | 100.0% | 86.3% | 16.2% | **7.8%** |
| 0.75 | 100.0% | 89.5% | 52.2% | **7.8%** |
| 1.00 | 100.0% | 89.7% | 50.8% | **7.8%** |

零延遲下它是**最差**的防禦（100% 被咬），500 ms 下變成**最好**的（7.8%）。
病因判斷正確：先前三次否決量到的不是「這個動作沒用」，是「這個對手不會被騙」。

**對照組：現行的 `defendAim`（軸 = 我的升力）**

| 力道 | 0 ms | 150 | 300 | 500 |
|---|---|---|---|---|
| 0.00（不閃） | 100.0% | 100.0% | 100.0% | 100.0% |
| 0.25 | 25.2% | 25.3% | 25.8% | 23.0% |
| 0.50 | 25.2% | 25.3% | 25.8% | 23.0% |
| 0.75 | 25.2% | 25.3% | 25.8% | 23.0% |
| 1.00 | 24.5% | 24.8% | 24.7% | 21.7% |

兩個附帶結論，都寫進 `DEFAULT_STEER` 的註解：

1. **力道 0.25 / 0.50 / 0.75 三行到小數點後一位完全相同**，能量代價也一樣
   （−461 / −461 / −480 m）。原因是**控制迴路飽和**——瞄準點離機首夠遠時
   指揮儀已經滿拉，再遠不會更拉。「力道」在這個介面下不是連續量，只有
   0（不閃）與非 0（滿拉）兩個狀態。力道連續化因此**確定不做**，而且與
   延遲無關（四欄一致）。
2. 現行 `defendAim` 對延遲不敏感（24.5% → 21.7%）。它是基準線，本案不動它。

**最低高度（m）——破防有沒有把自己開進地面**

| 軸 | 0 ms | 150 | 300 | 500 |
|---|---|---|---|---|
| 我的升力（現行） | 4217 | 4052 | 4186 | 4125 |
| 攻擊者的橫軸（異平面） | 928 | 656 | 778 | 1826 |

**異平面即使在閃躲效果最好的 500 ms，30 秒仍由 4000 m 掉到 1826 m。** 高度成本
與對手反應快慢無關，是幾何造成的：攻擊者硬轉時大坡度，他的平面法線接近鉛直，
沿它破防就是往下。**這件事延遲修不好**，所以本案只做延遲，不順手把異平面
還原上線。

## 3. 範圍

**本案只做一件事：讓 `reactionDelay` 真的生效。**

明確不做：

- 不還原異平面破防（高度成本未解，見 §2）。
- 不做力道連續化（§2 已判定介面上不是連續量）。
- 不做反轉、不做能量限制拉桿——它們要在延遲上線**之後**重新量測，是下一份。
- 不實作 `aimError`。它是另一個旋鈕，與本案正交，沒有量測需求驅動。
- 不做難度選單。本案只定義一個新的 profile，選單等有需求再說。

## 4. 設計

### 4.1 延遲的是「輸出指令」，不是「態勢」

一個 `Command` 是 **一個 Vector3 + 三個純量**（`aimWorld`、`throttle`、`brake`、
`firing`）。把它整個延後 n 步，等價於「這個飛行員現在做的，是他 n 毫秒前
看到的畫面所導出的決定」。

【為什麼不是延遲態勢】延遲 `Situation` 要複製十幾個欄位、還要處理 10 Hz 與
240 Hz 兩種節拍，而且 `basis`、`knobs`、`rules` 的閂鎖都會跟著錯拍，行為難以
推理。延遲輸出只有四個數字，語義乾淨，而且**對 `assess` / `rules` / `steer`
一個字都不用改**。

【為什麼不是降低決策頻率】把 10 Hz 調成 3 Hz 會讓意圖切換變遲鈍，但 240 Hz 的
轉向仍然是即時追蹤——追瞄能力一點都沒降，而那正是要降的東西。

### 4.2 安全層排在延遲**之後**

```
steerCommand → [延遲 n 步] → applySafety → out
```

【為什麼】延遲模擬的是**判讀與決策**的耗時；「快撞地了」是反射，不是判讀。
把安全層一起延遲會讓 AI 撞地率上升，而那是一個與難度無關的退步——玩家不會
覺得「敵人比較弱」，只會覺得「敵人會自殺」。安全層讀的是飛機**當下**的狀態，
所以它必須在延遲之後、拿當下的狀態算。

這需要把 `applySafety` 由目前的兩個呼叫點（無目標分支、主分支）收斂成
`update()` 結尾的**一個**呼叫點。

### 4.3 零延遲必須是位元等價的無作用

`reactionDelay <= 0` 時直接把內部指令複製到 `out`，**完全不碰緩衝區**。

【為什麼要求到位元】`ACE` 是全部 AI 測試與 `bench/ai-load.ts` 的設定，也是
M4 交付的天花板。任何一點數值漂移都會讓既有的對戰矩陣與六場機動測試變成
「不知道是誰改的」。這條性質同時保證 240 Hz 熱路徑在預設設定下**一步額外的
運算都不多**（perf 門檻 900 µs 不受影響）。

### 4.4 環形緩衝區

`src/ai/delay.ts`，一個類別：

```ts
export class CommandDelay {
  push(input: Command, delaySeconds: number, dt: number, out: Command): void
}
```

- 槽數固定 `SLOTS = 256`，對應 240 Hz 下約 1.07 秒；`MAX_REACTION_DELAY = 1`。
  超過的延遲被夾住。
- 步數 `steps = clamp(round(delaySeconds / dt), 0, SLOTS - 1)`。用 `dt` 換算
  而不是存時戳，是因為物理步長固定（`FixedStepAccumulator`，240 Hz）；
  `setStep` 改步長時下一步就會換算出新的步數，不需要額外狀態。
- `aimWorld` 存成 `Float32Array(3 * SLOTS)`，其餘三個純量各一條
  `Float32Array` / `Uint8Array`。**不存 Vector3 陣列**——256 個 Vector3 物件
  × 40 架 AI 是 40 萬個堆積物件，而三條 typed array 每架只要約 4 KB。
- **首次啟用時把全部槽位填成當前指令**（`primed` 旗標）。否則開場前 n 步會
  讀到零向量，飛機會抽一下。
- `steps <= 0` 走 §4.3 的捷徑並把 `primed` 清掉，所以中途開關延遲也正確。
- `push` 不配置記憶體。

### 4.5 profile

`src/ai/profile.ts` 新增一個常數：

```ts
/** 遊戲預設的敵人。0.30 s 是量測選出來的，見 §6.2 */
export const VETERAN: DifficultyProfile = { reactionDelay: 0.3, aimError: 0 }
```

`ACE` **一個字都不動**（使用者明確指示）。

### 4.6 遊戲怎麼吃到它

`BattleConfig` 新增 `aiProfile: DifficultyProfile`，`DEFAULT_BATTLE` 給 `ACE`，
`battleConfigFrom`（`src/battle/skirmish.ts`）給 `VETERAN`。

【為什麼是 config 而不是在 `createBattle` 裡寫死 `VETERAN`】寫死的話
`test/integration/multi-battle.test.ts` 與 `ai-targeting.test.ts` 的全部基準
會一起移動，而那一層測的是 AI 的天花板。走 config 之後：**測試維持 ACE、
遊戲吃 VETERAN**，兩邊各自量各自的。

【為什麼兩隊一起套】與 `specs/feel.ts` 的手感係數同一個理由——玩家的僚機與
敵人是同一套 AI，只給敵人加延遲等於偷偷給玩家開外掛。對稱是預設；哪天真要
做難度選單，那時再開不對稱的口。

`resetBattle` 與「玩家離座後把座位還給 AI」（`setup.ts` 約 520 行）兩處新建
`AiController` 的地方都要套上同一個 profile，否則重開一局或換座之後敵人
會悄悄變回 ACE。

## 5. 介面

**`src/ai/profile.ts`**

```ts
export const VETERAN: DifficultyProfile   // { reactionDelay: 0.3, aimError: 0 }
```

**`src/ai/delay.ts`（新檔）**

```ts
export const MAX_REACTION_DELAY: number   // 1
export class CommandDelay {
  push(input: Command, delaySeconds: number, dt: number, out: Command): void
}
```

**`src/ai/AiController.ts`**

- 新增 private `raw: Command`、private `delay: CommandDelay`
- 三條輸出路徑全部改寫進 `raw`
- `update()` 結尾：`this.delay.push(this.raw, this.profile.reactionDelay, dt, out)`
  → `this.safetyActive = applySafety(self, this.seaHeight, out)`
- 公開欄位 `intent` / `trackingSeconds` / `stationError` **維持即時**。它們是
  診斷量，不是指令；讓它們也延遲會讓 HUD 與 telemetry 對不上飛機在做什麼。

**`src/battle/setup.ts`**

- `BattleConfig` 新增 `aiProfile: DifficultyProfile`
- `DEFAULT_BATTLE.aiProfile = ACE`
- `createBattle` / `resetBattle` / 還座位那三處新建 `AiController` 時設定它

**`src/battle/skirmish.ts`**

- `battleConfigFrom` 回傳的 config 帶 `aiProfile: VETERAN`

## 6. 量測與驗收

### 6.1 單元（`test/unit/ai-delay.test.ts`）

1. `delaySeconds = 0` → `out` 與 `input` 每個欄位完全相等（位元等價）。
2. 延遲 n 步後，第 k 步的輸出等於第 `k − n` 步的輸入（用可辨識的假指令序列）。
3. 首次啟用時輸出等於當前輸入（priming），不是零向量。
4. 延遲超過 `MAX_REACTION_DELAY` 被夾在 `SLOTS − 1` 步，不越界。
5. 由非零延遲切回 0 再切回非零，重新 prime，不吐出陳舊指令。

`test/unit/ai-controller.test.ts` 既有的 `ACE.reactionDelay === 0` 斷言維持；
新增 `VETERAN.reactionDelay > 0`。

### 6.2 延遲值的選定（掃描，結果寫進 `profile.ts` 註解）

1v1 對決，**延遲方 vs 零延遲方**，同機種、至少 12 種開局、300 秒。掃
`reactionDelay ∈ {0.15, 0.20, 0.30, 0.40, 0.50}`，記錄零延遲方的勝率。

判準：**選最小的、能讓零延遲方勝率明顯過半的值**。延遲不是越大越好——
0.5 s 的敵人會呆到玩家看得出來。0.3 是起始猜測，最終值以掃描為準，掃描表
寫進 `profile.ts` 的註解。

### 6.3 護欄（不得退步）

全部既有測試在 `ACE` 下**逐場逐值不變**（§4.3 的位元等價保證這一點）。特別是：

- `test/integration/ai-manoeuvre.test.ts` 六場五門檻
- `test/integration/ai-duel-matrix.test.ts`
- `test/integration/ai-defence.test.ts`
- `test/performance/ai-load.test.ts` 的 900 µs

若任何一項有數值變動，代表 §4.3 沒做到，**回頭修實作，不改門檻**。

### 6.4 新增的整合測試（`test/integration/ai-reaction-delay.test.ts`）

覆蓋出貨設定——沒有這一條就沒有任何自動化測試碰得到 `VETERAN`：

1. **延遲讓 AI 變弱**：同機種 1v1、多開局，`VETERAN` 對 `ACE` 的勝率顯著低於
   五成。門檻在 §6.2 掃完之後依實測填，並把實測數字寫進測試註解。
2. **延遲不讓 AI 變笨到撞地**：`VETERAN` 的 20v20，觸地損失不得高於 `ACE`
   同場的觸地損失。這一條守的是 §4.2（安全層不延遲）。

### 6.5 混沌紀律（沿用前四次的教訓）

- 單場勝負、擊落時間、單一軌跡的傷害**不作為判準**。
- 只採聚合比率量與受控場景的逐場可重現值。
- 受控場景的觀察窗至少 120 秒。
- 評估防禦動作時**必須同時看最低高度**——2026-08-06 的教訓：只看被鎖定
  佔比會讓一個把自己開進地面的動作看起來很成功。

## 7. 風險

1. **延遲讓 AI 在近距離纏鬥時抖動。** 240 Hz 的轉向指令延後 72 步，若態勢
   變化快於延遲，指令可能與當下需求相反。這正是「反應不及」該有的樣子，但
   若表現為高頻抖動而不是「慢半拍」，就要改成延遲加低通而不是純延遲。
   由 §6.4 的撞地條與人工試飛觀察。
2. **僚機隊形變差。** `stationCommand` 也走同一條延遲。站位是慢變量，
   0.3 s 應該無感，但 `test/integration/ai-rejoin.test.ts` 若在 `VETERAN` 下
   跑不過，代表這個假設錯了。
3. **記憶體。** 40 架 × 4 KB = 160 KB，可忽略。
4. **`firing` 也被延遲**是刻意的：扣扳機比看到解慢半拍，與瞄準慢半拍一致。
   若量到火力下降過頭（`ai-defence` 的 `dealtToA` 歸零），再考慮讓 `firing`
   不延遲。

## 8. 全域限制

- 不得引入 `@types/node`。
- `noUncheckedIndexedAccess` 開啟。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`。
- 每一條新測試先驗紅。
- **不得為了讓測試通過而放寬門檻。**
- commit 指定明確路徑，不得 `git add -A`（`bash.exe.stackdump` 是被追蹤且
  已修改的檔案）。
- 型別檢查是 `npx tsc --noEmit`（專案沒有 `typecheck` script）。
