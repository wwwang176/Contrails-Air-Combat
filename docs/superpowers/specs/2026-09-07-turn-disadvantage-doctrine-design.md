# 轉不贏的一方該打能量戰 —— `extendTurnLatch` 的職責重分配

**狀態**：待專案負責人審。實作尚未開始。

**範圍**：意圖層 `arbitrate` 的一處分支、戰術層的名額與入場條件。
**不動**：`steer.ts` 的操舵、空層鎖、指揮層、編隊、機種 spec。

**與既有設計的關係**：`2026-08-22-extend-recovery-design.md` 修的是 `extend`
的**能量**理由；這一份修的是**迴旋**理由。兩者正交，那一份已上線且不受影響。
`2026-08-22-energy-tactics-design.md` 加的戰術層（`quota` 預設 0，未上線）
是這一份的載體 —— 這一份要決定它由誰啟動。

---

## 1. 人工回報

> 「我剛剛設定遭遇戰 20vs20，A6M 壓倒性勝出。觀察了一下 F4F 的飛行模式，
> 我發現回到一個 P51vsBF109 的老問題，F4F 會持續觸發 extend（迴轉），
> 所以對於瞄準敵人不積極。」

專案負責人接著指出方向：

> 「如果對手的特徵是『迴轉能力比我好』，則我機會改用 boom and zoom 戰術。」

---

## 2. 程式現況

以下每一條都逐行查證並實測過。量測工具見 §8。

### 2.1 `extendTurnLatch` 對這些機種對是常數，不是閂鎖

`assess.ts` 的 `airframeTurnAdvantage` 是兩台在**中點高度**的最佳持續轉彎率
之差。它不讀速度、姿態、位置優劣，所以對一組機種對它只隨高度變化。

`bestSustainedTurnRateCached` 的實測差值，對照 `turnEnter = −0.02`（進場）
與 `turnExit = −0.01`（出場）：

```
  alt     F4F-4     A6M5      diff     °/s   進場   出得掉
    0    0.2914   0.4037   −0.1123   −6.43   觸發   解不掉
 4000    0.2177   0.2909   −0.0732   −4.20   觸發   解不掉
 8000    0.1142   0.1789   −0.0648   −3.71   觸發   解不掉

 P-51D vs Bf 109 K-4
    0    0.3150   0.3532   −0.0382   −2.19   觸發   解不掉
 8000    0.1432   0.1693   −0.0261   −1.50   觸發   解不掉
```

差值是進場門檻的 3.2～5.6 倍（P-51 是 1.3～2.2 倍），**七格高度沒有一格
接近出場門檻**。閂鎖的遲滯對這些配對不起作用 —— 它一旦點亮就是永久的。

實測佐證：F4F vs A6M5 全場 300 s，`extendTurnLatch` 佔時 **100.0%**。

### 2.2 `extend` 因此變成自鎖

`arbitrate` 的相對理由分支：

```js
if (!shooting && (weakAndSlow || s.extendTurnLatch) && sit.range < cfg.extendRange)
  return 'extend'
```

`extendTurnLatch` 永真，所以距離一進到 `extendRange`（1500 m）而當下沒有
射擊解，就是 `extend`。唯一的豁免是 `shooting`（`shotInstant > 0`）。

而 `steer.ts` 的 `extend` 分支是 `unloadAim` —— 瞄準點放在**自身速度向量**
上，只加一個有上限的回場偏角。機頭不追目標，`shotInstant` 起不來。

**要開火才能離開 `extend`，但 `extend` 的操舵讓開火不可能。**

### 2.3 `engage` 在結構上不可達

```js
if (sit.airframeTurnAdvantage > cfg.turnEnter && s.engageLatch) return 'engage'
```

左側對這些配對恆為 false。實測 `engage` 佔時 **0.0%**。

F4F 的意圖集合實際只剩 `defend` / `merge` / `extend` / `approach`。

### 2.4 戰術層存在，但與「轉不贏」無關

`tactics.ts` 的相位機 `build → perch → dive → zoom → build`（`cooldown` 是
止損出口）正是 boom and zoom。它的啟動條件是 `hasSlot(teamIndex, quota)`
—— 一個**與機種、與態勢都無關的黃金比例抽籤**。

`DEFAULT_TACTICS.quota = 0`，且遊戲路徑沒有覆寫，所以這一層在出貨版本裡
從未執行。

### 2.5 只把 `quota` 翻開不能解決

20v20、300 s、`quota` 0 對 1：

```
對局             quota │ 藍存活 紅存活 │ extend  engage  射擊解   dive │ 紅方射擊解
f4f4 vs a6m5       0   │      0     20 │  54.6%    0.0%    4.1%   0.0% │     17.0%
f4f4 vs a6m5       1   │      0     20 │  55.0%    1.2%    3.6%   1.6% │     17.4%
f4f4 vs f4f4       0   │     19     15 │  34.2%   13.0%    8.5%   0.0% │      8.3%
f4f4 vs f4f4       1   │     20     17 │  33.0%   11.9%    8.1%   0.1% │      8.9%
```

循環在 20v20 轉得起來（全隊 `dive` 進入 21 次、`zoom` 18 次），但只佔
**1.6% 的時間**，戰果一格未動，瞄準佔時反而略降。

原因是它**疊在**舊規則上而不是取代它：`dive` 之外的每一拍，2.2 的自鎖照常
把飛機推去逃跑。

小規模（1v1 / 4v4）連轉都轉不起來：每一段 `build` 的停留都是 **13.1 s**
（`buildMax = 13`），也就是全部撞期限進 `cooldown`，沒有一段是靠蓄滿能量
離開的。`build` 期間 `energyRatio` 的峰值中位是 0.05～0.16，門檻
`perchEnter` 是 0.50。

### 2.6 入場的距離門檻只讀一次

`farLatch = latch(range, enterRange = 2500, exitRange = 1500)` 在 `tactics.ts`
裡只被讀取一處：`off → build`。含意是「要開始這套打法，得先離敵人 2500 m
以外」，而相位一旦回到 `off`，重啟就要再退到 2500 m 外。

`enterRange` 的 2500 借自指揮層的 `FLANK_RANGE`（側翼命令的發令距離）。
借用的理由是「不發明第二套幾何」，不是語意相符。

---

## 3. 診斷基準

修改前的實測，`SEED = 20260907`：

```
                            存活  extend  engage  射擊解  <900m  迴旋閂鎖
f4f4 vs a6m5   1v1          111s   46.1%    0.0%    5.9%  72.4%    100.0%
f4f4 vs a6m5   4v4           84s   35.0%    0.0%    2.2%  58.8%    100.0%
f4f4 vs a6m5  20v20     0 存活/20  54.6%    0.0%    4.1%      —    100.0%
f4f4 vs f4f4   1v1          300s   11.0%   14.1%    7.1%  90.2%      0.0%
f4f4 vs f4f4  20v20    19 存活/15  34.2%   13.0%    8.5%      —      0.0%
```

**最有力的一組**是 900 m 內佔時 72.4% 對上射擊解佔時 5.9%：飛機有四分之三
的時間待在槍砲距離內，卻只有 6% 的時間機頭指著人。

**對照組 `f4f4 vs f4f4`** 分得出「機制壞了」與「機體不如人」：同一台飛機、
同一套規則，對手換成自己就活滿全場、`engage` 14.1%。

**種子的限制**：`createBattle` 的 `seed` 只餵飛行員名字，換種子逐位元相同。
上表是**一個情境**不是統計分布。穩健性要靠初速微擾（做法見
`extend-trigger.probe.ts` 的 `jitter`），驗收時補。

---

## 4. 設計

### 4.1 一句話

「轉不贏」現在的意思是**不要靠近他**，要改成**不要跟他繞圈**。

前者是拒戰，後者是選打法。同一個量、同一個門檻，換一個消費端。

### 4.2 變更 A：`extendTurnLatch` 不再推 `extend`

`rules.ts` 的 `arbitrate`：

```js
- if (!shooting && (weakAndSlow || s.extendTurnLatch) && sit.range < cfg.extendRange)
+ if (!shooting && weakAndSlow && sit.range < cfg.extendRange)
    return 'extend'
```

`extend` 保留三個理由中的兩個：能量弱且未回復（相對）、速度見底（絕對）、
以及高度鎖。**迴旋不再是脫離的理由。**

`s.extendTurnLatch` 本身照常更新 —— 它變成戰術層的輸入（變更 C），不是
死欄位。

**但 `extendReason` 要跟著改。** 那個函數把三個閂鎖翻成 HUD 上的字串
（`src/main.ts:1770` 是唯一的消費端）。變更 A 之後「迴旋」不再是 `extend`
的理由，繼續列它會讓 HUD 指著一個不成立的因果 —— 而那正是人工驗收唯一
看得到的東西。

```js
export function extendReason(s: RuleState): string {
  const parts: string[] = []
  if (s.extendEnergyLatch) parts.push('能量')
- if (s.extendTurnLatch) parts.push('迴旋')
  if (s.extendFloorLatch) parts.push('見底')
  if (s.altFloorLatch) parts.push('高度')
  return parts.length > 0 ? parts.join('+') : '無'
}
```

`extendLatch`（三者的聯集）沒有消費端讀取後會改變行為的地方，維持原樣。
「這架飛機被徵召去打能量戰」是**戰術相位**的事，HUD 若要顯示應該顯示
`tactics.phase`，不是掛在 `extend` 底下。那一格是否要加不在本設計範圍內。

### 4.3 變更 B：`engage` 的門票不動

```js
if (sit.airframeTurnAdvantage > cfg.turnEnter && s.engageLatch) return 'engage'
```

**這一行維持原狀。** 轉不贏的飛機**不應該**經由意圖層進入盤旋追擊 —— 那
正是它打不贏的那件事。它的攻擊授權改由戰術層的 `dive` 相位給（`AiController`
既有的 `if (ph === 'dive') this.intent = 'engage'`）。

於是兩條路各自成立：

```
轉得贏  →  意圖層的 engage（盤旋追擊）
轉不贏  →  戰術層的 dive（帶著能量進場，一輪就走）
```

### 4.4 變更 C：戰術層由「轉不贏」徵召，不是抽籤

`AiController` 餵給 `stepTactics` 的名額：

```js
- ti.slot = this.slotHas
+ ti.slot = this.rules.extendTurnLatch || this.slotHas
```

`quota` 保留原義：**額外**讓幾架轉得贏的飛機也打能量戰。轉不贏的一律進，
不受 `quota` 影響 —— 對它而言這不是加值，是唯一可行的打法。

### 4.5 變更 D：徵召者的入場不看距離、不看再進入條件

`TacticalInput` 新增一個布林：

```js
/** 徵召：這架飛機沒有別的打法可選（`extendTurnLatch`）。 */
mandatory: boolean
```

`stepTactics` 的 `off → build`：

```js
  if (s.phase === 'off') {
-   if (!s.farLatch) return
+   if (!inp.mandatory && !s.farLatch) return
    const fresh = Number.isNaN(s.lastCooldownRatio)
      || inp.energyRatio > s.lastCooldownRatio
-   if (!fresh) return
+   if (!inp.mandatory && !fresh) return
```

兩道門的存在理由都是「這架飛機還有別的事可做，不必硬來」。徵召者沒有別的
事可做，兩道門對它是永久失效而不是節流。節流由 `cooldownSeconds`（12 s）
與 `longCooldownSeconds`（30 s）承擔，那兩個是時間，不會永久關門。

### 4.6 變更 E：`build` 撞期限時去 `perch`，不進 `cooldown`

**這一項是護欄重新定值，需要負責人裁決。** 見 §5。

```js
  if (s.phase === 'build' && s.dwell >= cfg.buildMax) {
-   goCooldown(s, inp.energyRatio, cfg.cooldownSeconds)
+   enter(s, 'perch')
    return
  }
```

---

## 5. 「爬不上去怎麼辦」

這是本設計最脆弱的一格，單獨列出來。

### 5.1 問題

變更 C + D 之後，轉不贏的飛機**永遠在戰術層裡**。而 §2.5 量到 `build` 在
小規模對局中從未蓄滿 `perchEnter`：每一段都跑滿 13 s 撞期限。

照現行程式，撞期限 → `cooldown` → 意圖被覆寫成 `extend`。於是循環變成

```
build 13 s（爬升）→ cooldown 12 s（逃跑）→ build 13 s → …
```

**48% 的時間在逃跑，另外 52% 在爬升，一次都不攻擊。** 那是把「無腦逃跑」
換成「無腦爬升 + 無腦逃跑」，比現況更糟。

`dryRounds` 的長冷卻救不了它 —— 那個計數只在 `zoom` 結束時累加，而這條路徑
根本走不到 `zoom`。

### 5.2 兩個可能的定值方向

**方向一：降 `perchEnter`（改門檻）。**
0.50 的來源是「109 要俯衝到比 P-51 快一成，需要 630 m 高度盈餘」。那是一個
**很大**的優勢；一次可用的 boom and zoom 不需要快一成，只要進場時比他高、
出場時拉得走。實測 `build` 13 s 的峰值中位是 0.05～0.16（1v1／4v4）、
0.28～0.37（10v10）。

**方向二：改 `build` 撞期限的去向（變更 E）。**
期限的原意是止損（註解原話：「這道期限是止損，不是節奏；訂到 60 s 不會
弄壞什麼」）。當時 `build` 的停留中位是 0.4 s，因為那批量測的飛機進場時
就已經有能量優勢。在勢均力敵的遭遇戰裡，「13 秒還沒蓄滿」不代表這一輪
不能打，只代表**蓄不到理想值** —— 那就用手上的能量去 `perch` 等機會，而
不是放棄整輪。

**建議兩個一起做，並以方向二為主。** 理由：方向一是把門檻調到「現況剛好
過得去」，那個值會隨機種對浮動，掃出來的數字對別的配對沒有保證；方向二
改的是**語意**（蓄能是盡力而為，不是通過制），對所有配對都成立。方向一
仍需要做，但目的降為「別讓 `perch` 拿著幾乎為零的能量就俯衝」。

### 5.3 需要負責人裁決的三件事

1. `perchEnter` / `perchExit` 的新定值（我提供掃描結果，不自行定值）
2. `build` 撞期限的去向：`cooldown`（現況）還是 `perch`（變更 E）
3. 若兩者都做仍達不到 §7 的判準，是否接受「F4F 對 A6M 本來就打不過」
   作為結論 —— 那時要改的是機體或別的層，不是這一層

---

## 6. 不做的事

- **不動 `turnEnter` / `turnExit` 的數值。** 調鬆只是換一批機種掉進同一個
  洞；差距是門檻的 3～5 倍，調不出來。
- **不讓 `airframeTurnAdvantage` 隨態勢變動**（例如用高度優勢折抵）。它是
  機體比較，這個性質正是變更 C 成立的根據。上一輪的 `midAlt` 修正就是為了
  把它拉回純機體比較。
- **不做編隊互相掩護（Thach Weave）。** 史實上 F4F 打成平手靠的是它與雷達
  預警，但那是編隊層與指揮層，與本設計正交。
- **不改 `extendRange`、`FLANK_RANGE`、`enterRange` 的數值。** 變更 D 是讓
  徵召者繞過那道門，不是搬動它 —— 轉得贏的飛機行為一個字不變。
- **不改 `steer.ts`。** `tacticalCommand` 已經有 `build` / `perch` / `zoom`
  的操舵，`dive` 走既有的 `engage` 路徑。

---

## 7. 驗收

### 7.1 護欄（先驗紅）

新增 `test/integration/turn-disadvantage.test.ts`。每一條都必須在改動前是
紅的 —— 先跑一次確認，再動實作。

| # | 護欄 | 修改前實測 |
|---|---|---|
| G1 | F4F vs A6M5 1v1，`engage` 佔時 > 0 | 0.0% |
| G2 | 同上，`dive` 相位進入次數 > 0 | 0（`quota = 0`） |
| G3 | 同上，射擊解佔時相對基準提升 | 5.9% |
| G4 | 同上，`extend` 佔時相對基準下降 | 46.1% |
| G5 | `f4f4 vs f4f4`（轉得贏）的意圖分布不變 | 對照組，變更 A～D 都不該碰到它 |
| G6 | `build` 相位佔時 < 一個上限（防「無腦爬升」） | 見 §5，上限待定值 |

**G5 是變異測試的錨。** 變更 C 的 `|| this.rules.extendTurnLatch` 若寫成
`&&` 或恆真，G5 會紅。

G3 / G4 / G6 的**具體數字是護欄定值，由負責人拍板**。這一份只記錄修改前的
量測值與方向。

### 7.2 人工試飛

判準是玩起來合不合理，不是攻擊效率。要看的：

- F4F 會不會主動切進去、打一輪、拉開、再回來 —— 而不是繞圈或直線逃跑
- 會不會變成「衝進去被零戰纏住」的另一種死法
- 會不會出現 §5.1 的「爬 13 秒、逃 12 秒」節奏

### 7.3 既存錯誤基準

`npx tsc --noEmit` 動工前 **24 行**。改完比對行數不得增加。

---

## 8. 量測工具

診斷期間用的四支探針目前是未追蹤的暫存檔（`test/tools/tmp-*.probe.ts`）。
實作階段要保留的整理成正式探針：

| 檔名 | 回答什麼 |
|---|---|
| `turn-doctrine.probe.ts` | 意圖與相位的佔時、射擊解、存活（含對照組） |
| `build-gap.probe.ts` | `build` 期間 `energyRatio` 的進場／峰值／停留分布 |

`tmp-turn-gap`（機體轉彎率差值表）併進 `test/unit/envelope.test.ts` 既有的
`turnEnter` 那一段，不另開檔案。

---

## 9. 已知風險

1. **變更 A 之後，轉不贏的飛機在戰術層 `off` / `cooldown` 的空檔會落到
   `approach`。** `approach` 是預瞄追擊，仍可能把它拖進盤旋戰。變更 C + D
   讓那個空檔盡量小，但 `defend`、命令、`extendFloorLatch` 都會把它踢出
   戰術層，那些空檔擋不掉。7.2 的第二項就是在看這個。

2. **`energyRatio` 是對當前目標算的，而目標每一拍重選。** 換到一台更弱的
   僚機會讓這個量憑空跳過門檻。這是既有的脆弱性（`energyExit` 的欄位註解
   已記錄），變更 D 拿掉再進入條件之後會更常暴露。

3. **20v20 的效能。** 變更 C 讓整隊都進戰術層，`stepTactics` 的呼叫次數從
   0 變成 40。它是 O(1) 且不配置，但決策拍的預算沒有量過。

4. **`order-of-battle-replay` 的 digest 會變。** `quota = 0` 的出貨值原本
   保證那條測試全綠；變更 C 讓 `extendTurnLatch` 為真的機種對繞過 `quota`，
   digest 必然改變。基準重新定值是負責人的決定，且應該只做一次 —— 所以
   §5.3 的三項定值要在同一輪定完再重跑。
