# 第二批防禦機動設計

**日期**：2026-08-05
**前一批**：`2026-08-05-ai-combat-fixes-design.md`（威脅盲區、破防對準真正的攻擊者）

## 1. 背景

第一批修好的是「AI 看不見在打它的人」——長機的 `evaluateThreat` 只算當前目標
對我的威脅，實測 20v20 有 **97.8% 的鎖定來自非目標敵機**，於是 `threatInstant`
恆為 0、`defend` 結構上不可能觸發，4843 點傷害 100% 是在沒有閃躲的狀態下吃的。
補上全場威脅掃描（`AiController.scanThreat` + `Situation.threatLos`）之後，
AI 會閃了。

這一批處理的是**閃得好不好**。目前的破防是單一動作：由威脅視線繞開固定的
75°（`steer.ts` 的 `defendAim`），繞轉軸取自我自己的升力向量，進出由
`rules.ts` 的 `defendLatch` 遲滯決定。受控場景（`test/integration/ai-defence.test.ts`，
1 藍 2 紅、四種被咬幾何）量到修補後仍有：

```
被掛著射擊解的時間佔比   81.0 / 55.8 / 56.0 / 38.0 %
```

也就是說**正後方 400 m 那一組有八成的時間對方還掛著射擊解**。門檻
`huntedShare < 0.85` 是當時刻意留寬的下限，註解裡已經寫明「異平面破防是下一批
的主項，屆時這個門檻要收緊」。

## 2. 三個缺陷

### 甲、破防軸取自「我」，不是「他」

`defendAim` 的軸是我的升力向量投影到視線垂面。我正在右轉時升力本來就指向
右上——破防等於「照著我原本的平面繼續拉」。對攻擊者而言那是**他已經在跟的
平面**，他只要拉緊一點就跟得住，一次滾轉都不必做。

真實 BFM 的異平面破防要求對方**換轉彎平面**，那個滾轉時間就是我脫離他預瞄解
的時間。目前這個動作完全沒有向對方的姿態索取任何資訊。

### 乙、破防是 bang-bang，沒有力道

`defendLatch` 一亮就是滿幅破防，一滅就完全歸零。「他還在 800 m 外剛對正」與
「他在我六點鐘 200 m 快扣扳機」得到一模一樣的動作。硬破防要付出能量與
「放棄自己的攻擊」兩份代價，付在不需要的地方就是白付。

**這一點我在口頭規劃時說錯過，記在這裡以免重蹈**：原本的想法是「讓
`defendOffset` 隨威脅連續變化」。那**沒有用**——`FlightDirector` 是 bank-to-turn，
拉桿力道由機首到瞄準點的**誤差角**決定，而攻擊者在我後方時那個角接近 180°，
偏轉角是 75° 還是 5° 都一樣滿舵。偏轉角控制的是破防的**方向**，不是力道。

### 丙、他衝過頭之後沒有反轉

破防成功把攻擊者甩出去之後，`defendLatch` 還亮著（他的角度變差要一段時間才
反映到威脅值，再加上 `minDwell` 0.8 s 的下限），AI 就繼續往外轉——把剛剛用
高度和速度換來的機會丟掉。

真實 BFM 這一格是整段防禦最值錢的：他衝過頭 → 我反向滾轉拉進去 → 攻守易位。
剪刀（scissors）不是寫死的動作，是這一格重複發生長出來的。目前的程式碼裡
**反轉次數恆為 0**。

## 3. 設計

### 3.1 `DefendState`：破防這一層自己的狀態

三件事都需要跨格記憶（力道要讀持續跟蹤加權後的威脅、破防的左右要閂住、反轉
要計時），而 `steer.ts` 目前是純函數。沿用專案既有的形狀——`createRuleState`、
`createTargetState`、`createWingmanState` 都是「狀態物件由呼叫端持有、以參數
傳入」——新增：

```ts
export interface DefendState {
  /** 這一格的破防力道，0..1。0 = 與不閃躲時完全相同 */
  hardness: number
  /** 破防繞轉軸的正負號，+1 或 −1。進入 defend 時決定一次，整段不變 */
  sign: number
  /** 上一格是不是 defend。用來偵測進入 defend 的上升緣 */
  active: boolean
  /** 反轉剩餘秒數。> 0 時破防讓位給追擊 */
  reversal: number
  /** 這一格是不是反轉的上升緣。供 AiController 觸發目標請求，讀後即失效 */
  reversalStarted: boolean
}

export function createDefendState(): DefendState
```

由 `AiController` 持有，每個物理步（240 Hz）在算完威脅之後呼叫：

```ts
export function stepDefend(
  state: DefendState,
  self: Aircraft,
  /** 威脅來源。null = 沒有威脅來源（退化成不破防） */
  attacker: Aircraft | null,
  /** 持續跟蹤加權後的威脅值 —— 必須與 rules.ts 的閂鎖吃的是同一個量 */
  threat: number,
  defending: boolean,
  sit: Situation,
  seaHeight: number,
  dt: number,
  cfg: SteerConfig,
): void
```

熱路徑，不配置（模組層 `makeScratch`）。

**為什麼威脅值用參數傳而不是塞進 `Situation`**：`Situation` 是 `assess.ts`
產生的純態勢資料，而持續跟蹤是跨格累積的狀態，住在 `AiController`。把一個
控制器算出來的量寫進態勢資料，會讓「誰是這個欄位的真相來源」變得不清楚。

**攻擊者是誰**：`considerThreatFrom` 改為回傳 `boolean`（有沒有取代現值），
`AiController` 據此決定 `attacker = replaced ? threatSource : target`。這比重算
一次 `threatFactor` 便宜，也比在 `Situation` 裡放 `Aircraft` 參考乾淨。

### 3.2 乙：力道連續化——與「不閃躲的瞄準點」混合

> **實作後否決（2026-08-06）。** 這一節設計的東西做出來了，量測不支持它，
> 已經整段撤回。掃描表與根因寫在 `src/ai/steer.ts` 的 `DEFAULT_STEER` 註解
> 「已經試過並否決的：破防力道連續化」。兩個關鍵發現：
>
> 1. **連續性的前提不成立。** `threatFactor` 自己就在 `THREAT_RANGE` 與
>    `THREAT_CONE` 的邊界上階躍歸零。在一個不連續的輸入上鋪連續斜坡得不到
>    連續的輸出——跳變只是由「意圖切換的那一格」提前到「威脅崩掉的那一格」，
>    逐格跳變 >5° 的次數沒有下降（537 → 613 / 593 / 415，非單調）。
> 2. **起始值 0.85 高於訊號的上限。** 實測威脅中位 0.53、最大 0.79，滿力道
>    破防結構上不可能發生。換成可達的值之後「被掛著射擊解」由 45.2% 升到
>    50.6–52.7%——與使用者「AI 好像不太會閃」的訴求相反。
>
> `DefendState` 這個狀態容器仍然需要（甲的號誌閂鎖、丙的反轉倒數），改由
> §3.3 引入。以下保留原設計供追溯。

力道的正確載體是**混合比例**，不是偏轉角：

```
aim = slerp(不閃躲時的瞄準點, 破防瞄準點, hardness)
```

`hardness = 0` 時瞄準點與不閃躲時**逐位元相同**，defend 因此是真正的 no-op。

```ts
export function defendHardness(threat: number, cfg: SteerConfig): number {
  const span = cfg.defendHardThreat - THREAT_EXIT_ANCHOR
  if (!(span > 0)) return 1
  const t = (threat - THREAT_EXIT_ANCHOR) / span
  return t < 0 ? 0 : t > 1 ? 1 : t
}
```

**斜坡錨在 `threatExit`（0.15）而不是 `threatEnter`（0.35）**。理由是震盪發生在
出口：`defendLatch` 的解除條件是威脅低於 `threatExit`，錨在那裡就讓**離開
defend 的那一格力道恰好是 0**，前後兩格的瞄準點連續。這正是上一批
`unloadPull` 治好 0.1 秒抖動的同一個手法——「一個在模式邊界上恰好等於 1
（此處為 0）的係數，使進出該模式成為 no-op」。

進入時（威脅 0.35）力道是 `(0.35−0.15)/(0.85−0.15) = 0.29`，所以入口仍有一個
跳變，但幅度由「整段 75° 的破防」降到「29% 的混合」。

**錨點是常數不是設定值**：`THREAT_EXIT_ANCHOR` 必須等於 `DEFAULT_RULES.threatExit`，
否則連續性的保證就破了。兩者分屬不同模組（`rules.ts` 的設定 vs `steer.ts` 的
幾何），所以要有一條單元測試**斷言兩者相等**，把這個耦合寫死在測試裡而不是
註解裡。

**「不閃躲時的瞄準點」是什麼**：就是 `intent` 不為 `defend` 時同一個態勢會產生
的瞄準點，也就是 `aimFromKnobs(basis, sit, k, …)`（追擊當前目標）。實作上在
`steerCommand` 的 `defend` 分支裡先算它，再與破防瞄準點混合。

**`slerpUnit` 抽成共用函數**：`shrinkTowardNose` 已經在做同一件事（沿測地線
把單位向量拉向另一個單位向量），把那段數學抽成

```ts
/** 沿測地線由 a 走向 b，t ∈ [0,1]，結果寫進 out。a、b 必須是單位向量 */
function slerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3): void
```

由兩處共用。這是同一段容易寫錯的數學出現第二次，值得抽——不是預先一般化。

**力道 0 不代表不動**：若威脅在 `minDwell` 未滿時就掉到 `threatExit` 以下，
AI 會在剩下的時間裡完全照追擊飛。那是正確的，不是退化。

### 3.3 甲：異平面破防

> **實作後否決（2026-08-06）。** 做出來、量完、整段撤回。掃描表與根因寫在
> `src/ai/steer.ts` 的 `DEFAULT_STEER` 註解「已經試過並否決的：異平面破防」。
> 三組互相獨立的量測同向指出它更差：被掛著射擊解 45.2% → 78.8%、破防佔比
> 2.7% → 33.0%、安全層介入 1.8% → 31.6%，飛機最低高度到 −0 m（海面）。
>
> **理論為什麼不成立**：真實世界裡「逼對方換轉彎平面」有價值，是因為滾轉要
> 時間、飛行員要重新建立視線。本模型的指揮儀每一格重新解算、滾轉率也夠高，
> 換平面幾乎不花他任何東西。
>
> **順帶推翻了 §6.1 的驗收指標**：`huntedShare` 不是破防品質的指標。
>
> **順帶發現一個真缺陷**：`defend` 這條路徑**沒有任何能量或高度管理**
> （不像 `extend` 有 `extendPitchAngle`）。只要 `defendShare` 一高，AI 就會
> 沉到地面。目前是靠「破防很少觸發」掩蓋著 —— 而使用者的訴求正是「要多閃
> 一點」。這件事應該排在任何「讓 AI 更常閃」的工作之前。
>
> 以下保留原設計供追溯。

攻擊者的機動平面由他的速度向量與升力向量張成；**該平面的法線就是他的機體
橫軸**（`FWD × UP = +X`）。我沿著那條法線破防，他就必須先把機翼滾過去換平面
才跟得住。

破防軸的取法（依序退化）：

1. `attackerRight`（他的機體 +X）投影到我的視線垂面
2. 退化時用**我的**升力向量（現行行為）
3. 再退化用我的機體橫軸

第 2、3 步之間的非退化證明維持現行註解裡那一條：升力與橫軸恆正交，
`a² + b² ≤ 1`，一者趨近平行時另一者的垂直分量趨近滿額，永遠有一側可選。
新增的第 1 步只是把「首選」換掉，不影響那個保證。

**左右的號誌**：法線有 ±兩側，都同樣「異平面」。取捨是能量與高度：

```
離地高度 > defendFloor  → 取朝下的那一側（重力幫忙保速度）
離地高度 ≤ defendFloor  → 取朝上的那一側
```

**號誌在進入 defend 時決定一次，整段不變**（`DefendState.sign`）。理由有二：
一是離散選擇每格重算必然有切換面，跨過去就是瞄準點瞬間跳 2×75°——那是上一批
剛治好的抖動的同一個病；二是真實的飛行員會**咬定一個破防方向**，不會每 4 ms
重新推導。攻擊者換人（`attacker` 參考改變）視同新的一段，重新決定。

**已知取捨**：攻擊者平飛時他的平面法線是水平的，於是破防也是水平的，能量上
比機頭朝下的破防差。這是刻意接受的——理論說「逼他滾轉」，而水平破防對平飛的
他確實需要 60–90° 滾轉。若實測 `huntedShare` 沒有改善，下一個候選規則是
「在他的法線與垂直面之間取加權」，不在這一批做。

### 3.4 丙：他衝過頭之後反轉

**判定**（三個條件同時成立才算）：

1. 到攻擊者的距離 < `reversalRange`
2. 我的速度向量與「指向他的視線」的夾角 < `reversalAspect`——**他已經跑到我的
   前半球**
3. `defending` 為真（只有正在破防的人才談得上反轉）

條件 2 是「衝過頭」的真正定義：我硬破防而他跟得住時，視線一直留在後半球；
他過頭了，視線才會掃到前面來。

**動作**：`state.reversal = cfg.reversalHold`，倒數期間破防讓位——瞄準點改成
對**攻擊者**的追擊解（`aimFromKnobs` 換成以他為目標建的 basis）。倒數期間
`hardness` 不再套用（反轉是全力進攻，不是半套閃躲）。

**目標選擇**：反轉之後我想打的是他，而 `threatSource` 刻意不改變 `target`
（那條註解就是修 A→B→A 猶豫的成果）。這裡採「**放行一次，但不放水**」：

- `TargetState` 新增 `urgent: number`（候選索引，−1 = 無）。
- `AiController` 在 `reversalStarted` 的上升緣把攻擊者的索引寫進去，**一次性**。
- `selectTarget` 照常對全部候選評分；決策時若 `urgent >= 0` 且
  **`score[urgent] > score[current]`**，就略過 `minDwell` 與 `switchMargin`
  直接換過去，並把 `dwell` 重設為 `minDwell`（換完之後照樣不准馬上換回來）。
  分數若沒有比較高就不換。無論如何 `urgent` 讀後歸 −1。

也就是說**反轉只解除遲滯，不竄改分數**。他又近、又在我前半球、離軸角又差，
正常評分本來就會給高分；給不了高分就代表這不是一個真的機會。

**僚機不走這條路**：`selectWingmanTarget` 的第一級「自衛」本來就掃全場挑正在
打我的那一架，那是它的職責分工。反轉的**瞄準**對長機僚機一視同仁，反轉的
**目標請求**只作用在自由獵手（`selectTarget`）那條路徑上。

## 4. 介面總表

**`src/ai/steer.ts`**

```ts
export interface DefendState { hardness, sign, active, reversal, reversalStarted }
export function createDefendState(): DefendState
export function stepDefend(state, self, attacker, threat, defending, sit, seaHeight, dt, cfg): void
export function defendHardness(threat: number, cfg: SteerConfig): number
export const THREAT_EXIT_ANCHOR: number      // 必須等於 DEFAULT_RULES.threatExit
```

`steerCommand` 多吃兩個參數：`defend: DefendState`、`attackerBasis: EngageBasis | null`
（反轉時對攻擊者建的基準；`null` 表示沒有攻擊者）。`SteerConfig` 新增
`defendHardThreat`、`defendFloor`、`reversalRange`、`reversalAspect`、`reversalHold`。

**`src/ai/assess.ts`**

`considerThreatFrom` 的回傳型別由 `void` 改為 `boolean`（有沒有取代現值）。

**`src/ai/target.ts`**

`TargetState` 新增 `urgent: number`；`createTargetState` 初始化為 −1。

**`src/ai/AiController.ts`**

持有 `defendState` 與（反轉用的）第二組 `EngageBasis`；每步呼叫 `stepDefend`；
在 `reversalStarted` 上升緣寫 `targetState.urgent`。

## 5. 參數起始值

全部標為**待實測回填**。專案的規矩是先跑再定，不接受「配一個看起來合理的數字」。

| 參數 | 起始值 | 掃描範圍 | 守住它的量測 |
|---|---|---|---|
| `defendHardThreat` | 0.85 | 0.5 / 0.7 / 0.85 / 1.0 | `blueDamage`、`dealtToA` |
| `defendFloor` | 600 m | 300 / 600 / 1200 | 安全層介入率（`AiController.safetyActive` 的取樣比例） |
| `reversalRange` | 300 m | 200 / 300 / 500 | 反轉次數、反轉後取得射擊解的比例 |
| `reversalAspect` | 90° | 60° / 90° / 120° | 同上 |
| `reversalHold` | 2 s | 1 / 2 / 4 | 同上 + 換目標次數 |

`defendOffset` 維持 75°（滿力道時的破防角），`THREAT_EXIT_ANCHOR` 綁死 0.15。

## 6. 量測與驗收

全部在 `test/integration/ai-defence.test.ts`（無亂數、逐場可重現）。**每一條新
斷言都必須先在未修改的程式上跑一次確認是紅的**——上一批有一條斷言在壞掉的
程式上是綠的、修好之後變紅，那條斷言量的就不是它宣稱的東西。

### 6.1 現有場景（四種被咬幾何）

- `huntedShare` 的門檻由 0.85 收緊，值由甲完成後的實測回填。**收緊的幅度由
  數據決定，不得為了讓測試綠而放寬任何門檻。**
- `blueDamage <= 150`、`dealtToA > 0`、`defendShare > 0`、`reactionSeconds <= 4`
  全部維持不變，是防退化的護欄。

### 6.2 新場景：高接近率（給丙用）

現有四組的攻擊者與我同速，衝不過頭。新增一組 `OVERTAKE_CASES`：紅 B 起始
TAS 280（藍方 200）、距離 600–800 m 正後方與後上方。斷言：

- `reversals > 0` —— 目前恆為 0，天然的紅燈
- 反轉觸發後的 `reversalHold` 秒內，藍方對紅 B 取得射擊解的取樣比例 > 0
- `blueDamage` 不得高於同一場景在修改前的實測值

### 6.3 單元測試

- `defendHardness`：`threat = THREAT_EXIT_ANCHOR` 時**恰好** 0；≥ `defendHardThreat`
  時恰好 1；中間單調。
- **錨點一致性**：`THREAT_EXIT_ANCHOR === DEFAULT_RULES.threatExit`。
- `slerpUnit`：`t=0` 得 a、`t=1` 得 b、反平行輸入不產生 NaN。
- 破防軸：給定一架處於已知滾轉角的攻擊者，破防方向與**他的**機動平面接近正交
  （而現行程式碼與**我的**平面正交）。
- 號誌閂鎖：整段 defend 內 `sign` 不變；攻擊者換人後才重新決定。
- 高度：`clearance < defendFloor` 時破防軸朝上。
- 反轉判定：三個條件的每一個單獨不成立時都不觸發。
- `selectTarget` 的 `urgent`：分數較高時略過 `minDwell` 換過去；分數較低時**不**換；
  用過即歸 −1。

### 6.4 猶豫的護欄（丙的風險控制）

丙碰到目標選擇，而目標選擇正是上一批花最多力氣穩定下來的東西（20v20 長機
A→B→A「換走又換回來」由 214 降到 88，加入閃躲後回到 188）。

因此丙**必須**同時量 20v20 公平對照組的換目標次數與換回來次數，作為觀測值
印出（不寫成斷言——那是混沌量）。**事前約定的決策規則**：若換回來次數比丙修改
前上升超過 25%，反轉退回「只改瞄準、不請求目標」的版本，並把數據記在
`target.ts` 的註解裡。

## 7. 風險

1. **甲對平飛攻擊者給出水平破防**（見 3.3 的取捨）。以 `huntedShare` 判定。
2. **丙可能把猶豫吐回來**。以 6.4 的事前規則控制。
3. **混沌敏感**。這個模擬完全決定性，但參數的微小改變會造成軌跡分岔——上一批
   量到 150 m 的 `saddleRange` 差距造成 7800 點傷害的擺盪。所以：**單場勝負、
   擊落時間、傷害比一律不作為判準**，只採聚合的比率量（`huntedShare`、
   `defendShare`、反轉次數）與受控場景的逐場可重現值。
4. **`steerCommand` 的簽名再長一截**。已經有九個參數。若第十、十一個參數讓
   呼叫端難讀，可在實作時把 `self / seaHeight / defend / attackerBasis` 收成一個
   `SteerContext`——但那是實作階段的判斷，不預先決定。

## 8. 明確不做

- **不寫死剪刀（scissors）**。它應該由「破防 → 他過頭 → 反轉 → 換他破防 →
  我過頭 → …」重複發生自然長出來。寫死一個剪刀狀態機會把一個湧現行為凍成
  一段腳本，而且無法對應到任何可量測的判準。
- **不碰 `DifficultyProfile`**。
- **不碰 `defendLatch` 的門檻**（0.35 / 0.15）。乙的斜坡錨在 `threatExit` 上，
  改動門檻會同時改變閂鎖與力道兩件事，量測就分不清是哪一個造成的。
- **不處理 defend 的出口在「威脅來源 ≠ 當前目標」時的瞄準點跳變**。乙讓力道
  在出口連續，但瞄準點仍會由「破防／追擊混合」跳到「追擊當前目標」——那兩者
  在 `hardness → 0` 時其實已經相同，所以這個跳變只在 `minDwell` 強制留在
  defend 而威脅又還沒降到出口時存在。頻率上限是每 0.8 秒一次，與 240 Hz 的抖動
  不是同一個量級。

## 9. 全域限制（沿用專案既有規矩）

- 不得引入 `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態，索引存取一律 `!` 或先判 `undefined`。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`。
- `src/ai/` 的熱路徑（240 Hz）不得配置記憶體，一律用 `makeScratch`。
- 每一條新測試都要先驗證是紅的。
- **不得為了讓測試通過而放寬門檻**；若斷言本身是錯的，改斷言並寫清楚理由。
- commit 一律指定明確路徑，不得 `git add -A`（`bash.exe.stackdump` 是被追蹤且
  已被修改的檔案）。
