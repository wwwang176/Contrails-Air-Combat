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

### 4.6 變更 E：`build` 撞期限時去 `perch`，並免除本輪的能量門檻

**只寫「去 `perch`」會卡死。** `perch` 的退場條件是

```js
case 'perch':
  if (s.commit >= cfg.commitSeconds) enter(s, 'dive')
  else if (!s.perchLatch) { enter(s, 'build'); openCycle(…) }
```

撞期限進來的飛機**定義上就是 `perchLatch` 為 false**，於是一進 `perch` 立刻
被彈回 `build`，再撞一次期限，再彈回來。實測（4v4）：`dive` **0 次**，
`build` 佔掉存活時間的絕大部分。**build ↔ perch 乒乓，永遠到不了 `dive`。**

所以要配一格「本輪已盡力」的記憶：

```js
export interface TacticalState {
+ /** 本輪蓄能已達期限：能量門檻對這一輪免除。`openCycle` 清除。 */
+ settled: boolean
}

  if (s.phase === 'build' && s.dwell >= cfg.buildMax) {
-   goCooldown(s, inp.energyRatio, cfg.cooldownSeconds)
+   s.settled = true
+   enter(s, 'perch')
    return
  }

  case 'perch':
    if (s.commit >= cfg.commitSeconds) enter(s, 'dive')
-   else if (!s.perchLatch) {
+   else if (!s.perchLatch && !s.settled) {
```

**不能用「把 `perchLatch` 設成 true」代替。** 那個閂鎖每一拍由
`latch(perchLatch, energyRatio, perchEnter, perchExit)` 重算，`energyRatio`
低於 `perchExit`（0.35）的下一拍就被打回 false。`settled` 必須是獨立的一格，
生命週期綁在「一輪」上而不是綁在能量上。

`settled` 要進 `createTacticalState`、`resetTacticalState` 與 `openCycle`
（清除）三處 —— 少任何一處會跨輪或跨場殘留。

語意：**撞期限 = 蓄能已盡力，這一輪不再要求能量達標。** 這是本設計對
「爬不上去怎麼辦」的答案（§5）。

### 4.7 定值：`buildMax = 20`

`DEFAULT_TACTICS.buildMax` 由 13 改為 **20**。

掃描（變更 A+C+D+E 全套、`quota` 維持 0、f4f4 vs a6m5、20v20、300 s）：

```
設定           │ 藍/紅存活 │ extend engage 射擊解 │ build  perch   dive   zoom │ dive次 俯衝高度差
出貨（未改）   │     0/20 │  54.6%   0.0%   4.1% │  0.0%   0.0%   0.0%   0.0% │     0     — m
buildMax 13    │     0/20 │  31.1%   2.3%   4.5% │ 13.5%   6.5%   3.0%   2.3% │    11   233 m
buildMax 20    │     0/20 │  35.1%   1.9%   4.3% │ 17.7%   4.8%   3.0%   2.4% │    15   396 m
buildMax 30    │     0/20 │  26.5%   2.5%   1.6% │ 17.9%   4.0%   4.3%   3.2% │    17   409 m
buildMax 45    │     0/18 │  22.8%   2.2%   3.7% │ 20.9%   2.9%   2.9%   2.2% │    16   462 m
對照 f4f4 出貨 │    19/15 │  34.2%  13.0%   8.5% │  0.0%   0.0%   0.0%   0.0% │     0     — m
對照 f4f4 改後 │    19/15 │  34.2%  13.0%   8.5% │  0.0%   0.0%   0.0%   0.0% │     0     — m
```

**對照組兩列逐字相同** —— 變更 A/C/D/E 對轉得贏的一方沒有任何影響。這是
G5 的實證。

選 20 的理由：13 的俯衝高度差 233 m 低於負責人指定的 300～600 m 區間；
30 的射擊解掉到四檔最差（1.6%）；45 有 20.9% 的時間在爬升不參戰，與
「打起來像那麼回事」的判準相衝。20 的俯衝高度差 396 m 在區間中段，射擊解
是四檔最高。

**45 那一檔的 2 架戰果不列入考量** —— 單一情境的兩架不是證據（§3 的種子
限制）。

### 4.8 `perchEnter` 維持 0.5

`energyRatio` 已經是**逐機、逐高度即時換算**的量（分母是自機當下高度的角落
速度動能高度）。0.5 換算成高度優勢：

```
機種      高度 │ 能量尺標 │ ratio 0.5 =
f4f4         0 │   597 m │  298 m
f4f4      4000 │   892 m │  446 m
f4f4      6000 │  1108 m │  554 m
a6m5         0 │   452 m │  226 m
p51d      6000 │  1779 m │  890 m
```

F4F 全高度範圍是 298～554 m，落在負責人指定的 300～600 m 內。**門檻不是
問題** —— 問題是 13 秒的時間預算（實測累積速率 0.0057 /s，由 0.16 爬到 0.50
需要約 60 s）。所以動的是 `buildMax`（§4.7），不是 `perchEnter`。

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

`dryRounds` 的長冷卻救不了它 —— 那個計數只在 `zoom` 結束時累加，而這條
路徑根本走不到 `zoom`。

### 5.2 為什麼答案是改語意，不是改門檻

門檻不是問題。`perchEnter = 0.5` 換算成 F4F 的高度優勢是 298～554 m
（§4.8），落在負責人指定的 300～600 m 內。

問題是時間預算：實測 `energyRatio` 的累積速率是 **0.0057 /s**，由進場的
0.16 爬到 0.50 需要**約 60 秒**。原本只給 13 秒 —— 需要量的五分之一。

而 60 秒不可行：一分鐘不參戰，隊友已經打完，中途還一定會被 `defend`、
命令、丟失目標打斷。**所以「一定要蓄滿才准打」這條規則本身不成立。**

期限的原意是止損（原註解：「這道期限是止損，不是節奏；訂到 60 s 不會弄壞
什麼，只是擋不住任何東西」）。當時 `build` 的停留中位是 0.4 s —— 那批量測
的飛機進場時就已經有能量優勢，期限根本碰不到。放到勢均力敵的遭遇戰，
`build` 從過場變成主要路徑，那條「擋不住任何東西」的線就變成唯一擋住它的
東西。

**答案是改語意：蓄能是盡力而為，不是通過制**（變更 E，§4.6）。這對所有
機種對都成立；把 `perchEnter` 調到「現況剛好過得去」則是一個隨配對浮動的
數字，對別的配對沒有保證。

`buildMax` 由 13 放寬到 20（§4.7）是配套 —— 讓「盡力」有合理的份量，而
不是讓 `perch` 拿著幾乎為零的能量就俯衝。實測俯衝時的高度優勢中位由
233 m（13 s）提高到 396 m（20 s）。

### 5.3 已裁決

| 項目 | 裁決 | 落在哪 |
|---|---|---|
| `build` 撞期限的去向 | **`perch`**（拿手上的能量去打） | §4.6 |
| `buildMax` | **20 s** | §4.7 |
| `perchEnter` | **維持 0.5** | §4.8 |
| 本次目標 | **「打起來像那麼回事」**，不是交換比 | §7 |

「打起來像那麼回事」的含意：本設計**不承諾**把 20v20 的交換比從 0:20 拉起
來。史實上 F4F 對零戰打成平手靠的是編隊互相掩護與雷達預警（§6 明列不做），
這一層只負責讓 F4F **做出正確的動作**。

### 5.4 已知這一版解不掉的事

掃描結果（§4.7）誠實記錄：套上全套變更之後，`extend` 由 54.6% 降到
35.1%、`engage` 由 0.0% 升到 1.9%、俯衝時有 396 m 的高度優勢 —— **機制通
了**；但射擊解仍是 4.3%（原 4.1%，未改善），20v20 仍是 0:20。

原因是 `dive` 只佔 3.0% 的時間：300 秒的戰鬥裡真正在俯衝攻擊的只有約十秒。
**通道通了但太窄。**

「為什麼只有 3%」不在本設計的範圍內。負責人的指示是先讓行為正確、由試飛
判斷下一個瓶頸在哪 —— 在有試飛回報之前調它等於瞎猜。

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

場景一律 `f4f4 vs a6m5` 20v20、300 s、`SEED = 20260907`。掃描量到的
改前／改後值一併列出 —— 護欄訂在兩者之間，留出餘裕。

| # | 護欄 | 改前 | 改後 | 建議門檻 |
|---|---|---|---|---|
| G1 | `engage` 佔時 > 0 | 0.0% | 1.9% | > 0 |
| G2 | `dive` 相位進入次數 > 0 | 0 | 15 | ≥ 5 |
| G3 | `extend` 佔時下降 | 54.6% | 35.1% | < 45% |
| G4 | 進入 `dive` 時的高度優勢中位 | 無 dive | 396 m | > 300 m |
| G5 | `f4f4 vs f4f4` 的意圖分布**逐字不變** | 34.2/13.0/8.5% | 同左 | 完全相等 |
| G6 | `build` 佔時上限（防「無腦爬升」） | 0.0% | 17.7% | < 30% |

**G4 直接用公尺，不用 `energyRatio`。** 那是負責人給的判準單位（300～600 m），
也是唯一不需要換算就能讀懂的一欄。

**G5 是變異測試的錨，而且已經抓過一次真錯**：掃描第一版把變更 C 寫成
「`quota = 1` 徵召所有人」，對照組的 `engage` 由 12.1% 掉到 0.0% 立刻報警。
主題那一組當時看起來是變好的（全隊存活），只有對照組看得出改法漏了出去。

**不列「射擊解提升」當護欄。** 掃描量到它沒有改善（4.1% → 4.3%），把一個
本設計解不掉的東西寫成護欄會讓它永遠是紅的。理由見 §5.4。

### 7.2 人工試飛

判準是玩起來合不合理，不是攻擊效率。要看的：

- F4F 會不會主動切進去、打一輪、拉開、再回來 —— 而不是繞圈或直線逃跑
- 會不會變成「衝進去被零戰纏住」的另一種死法
- 會不會出現 §5.1 的「爬完逃、逃完爬」節奏
- **空層鎖與戰術層有沒有互相拉扯**（見 §9.5）—— 症狀是俯衝進場時機頭
  忽上忽下，或明明敵人在下方卻維持平飛

### 7.3 既存錯誤基準

`npx tsc --noEmit` 動工前 **24 行**。改完比對行數不得增加。

---

## 8. 量測工具

診斷期間用的四支探針目前是未追蹤的暫存檔（`test/tools/tmp-*.probe.ts`）。
實作階段要保留的整理成正式探針：

| 檔名 | 回答什麼 |
|---|---|
| `turn-doctrine.probe.ts` | 意圖與相位的佔時、射擊解、存活、俯衝高度差（含對照組） |
| `build-gap.probe.ts` | `build` 期間 `energyRatio` 的進場／峰值／停留分布 |
| `band-by-intent.probe.ts` | 空層鎖的走法佔時與**逐意圖生效率**（§9.5 的基準） |

`tmp-turn-gap`（機體轉彎率差值表）與 `tmp-ratio-metres`（`energyRatio` ↔
公尺換算）併進 `test/unit/envelope.test.ts` 既有的 `turnEnter` 那一段，
不另開檔案。

`tmp-buildmax-scan`（§4.7 的掃描器）**不保留** —— 定值已定，留著會誘使
日後重掃而不是重新設計。掃描表本身留在 §4.7。

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
   digest 必然改變。基準重新定值是負責人的決定，且應該只做一次 —— §5.3
   的定值已經定完，所以重跑一次即可。

5. **空層鎖（`stepBand`）與戰術層可能互相拉扯。這一條是推論，沒有量過。**

   兩者的分工目前是乾淨的：`band` 只餵給 `steerCommand`，而
   `build` / `perch` / `zoom` 三個相位走的是 `tacticalCommand`，拿不到它；
   `dive` 相位把意圖覆寫成 `engage`，走回 `steerCommand`，`band` 照常生效。

   風險在 `BandState.kind` 是**進場時挑一次就不重挑**的。若它在 `build`
   期間（意圖多半是 `approach`，`stepBand` 的 `active` 成立）鎖成 `zoom`
   （目標高度 = 當下 + `bandZoomGain` 400 m），而戰術層接著轉 `dive`，
   兩層的高度意圖就相反。

   減輕的因素：`state.altitude = min(anchor, sit.chaseAlt)`，敵人在下方時
   貼合機制會把空層往下拉。所以多數情況兩層方向一致。

   量測基準（出貨版、f4f4 vs a6m5 20v20）：

   ```
   band 走法佔時   off 95.0%   level 1.1%   zoom 3.9%   dive 0.0%
   意圖底下的生效率  extend 0.0%   defend 0.0%   approach 23.3%
   ```

   **`band` 的 `dive` 走法從未觸發**（要求 `altitudeAdvantage >
   `bandDiveGap` = 1200 m，F4F 對 A6M 達不到）。人工回報記得的「距離內
   壓低機鼻」實際跑的是 `level` 走法加上 `chaseAlt` 貼合，不是那個走法。

   變更 A 把 `extend`（`band` 生效率 0.0%）的時間讓給 `approach`
   （23.3%），所以這一層作用的時間**會變多而不是變少**。
