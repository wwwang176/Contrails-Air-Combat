# 脫離之後回得來 —— `extend` 的出場條件

**狀態**：待專案負責人審。實作尚未開始。

**前置**：本文與 `2026-08-22-energy-tactics-design.md`（AI 的主動能量經營）
是**兩件事**。那一份加的是戰術層（`quota` 預設 0，尚未上線）；這一份修的是
**意圖層既有的 `extend`**，與戰術層開不開無關。

**範圍**：這一版只做**一件事** —— 給 `extend` 一條絕對的出場路徑（§4）。
原本規劃的「回場方向偏置」與「威脅抑制」降為**條件式後續**（§9），只有在
§4 上線後主判準仍未達標時才做，而且要先解掉四個已知缺陷。

**修訂**：2026-08-23 兩次 Codex 審查 + 三支探針之後的第三版。前兩版的變動
記錄在 §10。

---

## 1. 人工回報

> 「當我觸發 extend 能量時，飛機會以目前方位向前飛，通常你向前飛，等於是
> 遠離戰場了，結果等到能量補完要回頭根本追不上（轟炸機已被打或是戰場已
> 轉移）。」

同一次驗收另外回報：`extend` 的理由**九成是「能量」**，偶爾是「能量＋見底」。

專案負責人接著指出方向：把出場條件「從『比敵人強』改成『我自己回到能打的
狀態』」，並且「飛行的方位朝向敵人，但不可以大幅度轉彎以免又減少速度」。
**這一版只做第一句話**；第二句話的設計還不成熟，見 §9。

---

## 2. 程式現況

以下每一條都逐行查證過。

### 2.1 `extend` 沒有「往哪裡退」這個概念

`steer.ts` 的 `extend` 分支只呼叫 `unloadAim(self, extendPitchAngle(…), out)`。
`unloadAim` 維持的是**速度向量的水平航向**（機首只在水平投影退化時才用）。

水平方向完全不參與決策 —— 這條路徑回答的是「要不要退」與「退得多陡」，
從來沒有回答「退到哪裡去」。

### 2.2 出場條件對劣勢方不可達

```
extendEnergyLatch   energyAdvantage < energyEnter (−300 m) 觸發
                    energyAdvantage > energyExit  (+100 m) 才解除
```

**進場與出場都是相對的。** 而會觸發脫離的定義上就是劣勢的一方 —— 要「比對手
多 100 公尺比能量」才准回頭，這個條件在整場戰鬥中都達不到（對手也在休息）。
實測玩家座位代飛時，能量閂鎖曾連續開著 46 秒、166 秒不曾關過。

閂鎖開著**不等於**意圖是 `extend`。`arbitrate` 的相對路徑還要求
`range < extendRange`（1,500 m）且沒有射擊解：

```ts
if (s.extendFloorLatch && sit.energyAdvantage < cfg.floorExempt) return 'extend'
if (!shooting && (s.extendEnergyLatch || s.extendTurnLatch)
    && sit.range < cfg.extendRange) return 'extend'
```

所以「閂鎖開 166 秒」是閂鎖的持續時間，不是 `extend` 的持續時間。真正的
段落長度要另外量（§5）。這不改變結論 —— 閂鎖開著就隨時可能再掉回 `extend`
—— 但本文不得拿那兩個數字當「AI 直飛了 166 秒」的證據。

### 2.3 §2.1 與 §2.2 的關係，以及為什麼這一版只修 §2.2

方向缺失（2.1）本身不致命，**是「退很久」把它放大成致命**。退三秒沒有方向
不要緊，退四十秒沒有方向就飛出戰場了。

§4 直接砍掉「退很久」。**如果退只剩數秒，方向缺失可能就不再是缺陷** ——
那正是 §5.3 的門檻要回答的問題，也是 §9 條件式的理由。

### 2.4 `ai-withdraw-anchor` 是紅的，但它量的不是這件事

`test/integration/ai-withdraw-anchor.test.ts`「撤退令不得把戰鬥推出戰場」，
在本分支的起點（`af8f976`）就已經是紅的。實跑 HEAD：

```
maxRadius       11110.26   >  6500      ← 先炸在這裡
leavingShare       2.39%   <  5%        ← 第二條，也是紅的
```

**它不能當本文的主判準**，三個理由：

1. **它的根因註解逐字指向指揮層的 `planFlightOrder` rally 撤退令**（集合點
   相對當前位置反覆外移，一個沒有不動點的積分器）。受 rally 命令的飛機
   intent 被 `AiController` 覆寫成 `rally`，**根本不走 `extend` 分支**。
2. 它綁死 `DEFAULT_BATTLE` —— 20v20 對頭遭遇戰，沒有 `transit` 單位。
3. `leavingShare` 那條數的是 rally 命令的佔時，修 `extend` 不會動到它。

它降為**全域護欄**（不得比現況更糟），見 §5.4。

### 2.5 這個量對設定極度敏感，不要拿它比大小

玩家座位代飛、只把初速擾動 ±0.5%，`extend` 佔時：

```
axis-escort   bf109g6    6.2%   29.1%   11.8%   36.4%   27.6%
allies-escort p51d      43.6%   27.0%   72.8%   17.0%   16.9%
```

兩張卡的範圍完全重疊。**任何逐卡的結論都要五次以上的微擾才算數。**

### 2.6 指揮儀的介面限制

控制鏈只有一個世界方向：`steerCommand → aimWorld → FlightDirector → 舵面`。
`FlightDirector` 把方向誤差解成 `rollCommand = atan2(aimBody.x, aimBody.y)`
—— 那是**機動平面**，不是傾斜角。傾斜角是它解出來的結果，**下不了指令**。

兩個會咬人的特例：

```
errorAngle < deadZoneAngle (1.5°)                完全不下滾轉指令
errorAngle > π − reverseHysteresis (175°)        沿用上一格滾轉指令
```

**這一節與這一版無關**（§4 不碰瞄準解），但它是 §9 的主要障礙，留著。

---

## 3. 實測

三支探針，都在 `test/tools/`。

### 3.1 補速度只要 3~5 秒 —— 這一版唯一的定量依據

`extend-return.probe.ts` 的第一版量到：`cornerRatio` 由 0.75 補到 0.95 只要
**3~5 秒**，而且只跑了 400 m。

**這就是 §4 的全部理由。** 速度早就補完了，`extend` 還在繼續，因為它的解除
條件不是速度。

【這個數字為什麼可信】它只依賴 `extendPitchAngle` + WEP 的加速，不依賴任何
與 production 有出入的細節。§3.2 的其餘結論就沒有這個性質。

### 3.2 §3.2 的甜蜜點表 —— **降級為探索資料**

`extend-return.probe.ts` 掃了「每個決策拍把航向往錨點拉多少」的比例（`bias`），
量到 0.25 附近有一個甜蜜點。**這張表不能當定值依據**，Codex 複審找到五個
系統性偏差：

| 偏差 | 影響 |
|---|---|
| 探針 10 Hz 重算瞄準，production 每步（240 Hz）都呼叫 `steerCommand` | 掃的不是預定實作 |
| 漏了 `applyPitchBias(sweetPitch)` | 少一層 |
| shrink 係數只用 `energyPull`，production 是 `min(stallPull, pullCeiling)` | 少一層 |
| `speedAdvantage` 固定 0 | 把俯衝與爬升兩側的尾巴都壓回接近水平 |
| **`bias = 0` 那一列不是現況** | 探針在 `cornerRatio ≥ cornerExit` 時自行切成整架轉向固定原點，而現行程式解除後走的是 `engage`/`approach` 的 `aimFromKnobs` |

所以那一列的 **−3,435 m 是探針自己造出來的**，不是現況的回場代價。

還有一個更根本的：§4 預期讓能量型 `extend` 在 3~5 秒結束，而那張表是用一個
**強制持續 60 秒、錨點固定不動**的軌跡挑甜蜜點 —— 那個穩態盤旋不是 §4 上線
後會出現的狀態。

**留下來的窄結論**（Codex 複跑確認可重現）：

- `aimWorld` 不能直接控制實際坡度。
- 固定方向指令會產生很大的實際坡度（15° 的航向變化就給 16~37° 坡度）。
- 比能量會掩蓋「速度換成高度」的代價 —— 判準要用 `cornerRatio` 與高度，
  不能用 `h + V²/2g`。

### 3.3 `alarm` 的分布 —— 量錯了母體

`alarm-dist.probe.ts` 量全體戰鬥機的 `alarm`。**它不能拿來訂 §9 的參數**，
因為 `DEFAULT_RULES.threatEnter = 0.35`，而 `danger = max(threat, alarm)`：

```
alarm > 0.35  →  下一個決策拍 defendLatch 成立  →  意圖是 defend，不走 extend
```

所以要量的是 `alarm | intent === 'extend'`，不是全體。留下的窄結論：
**全體 p95 在兩張卡上都是 0.000**，「有人瞄我」只佔 0.3~4.5% 的取樣。

### 3.4 `turn-cost.probe.ts`

第一版想用「誘導阻力 ∝ n²」反推一個傾斜角上限（15°）。這支否決了那個做法
（見 §3.2 的窄結論），但它自己的判準也錯了 —— 它量比能量，而比能量守住不
代表速度守住（實測有一列比能量只掉 179 m 而 `cornerRatio` 由 1.00 掉到 0.826）。

**這支的價值是否定的那一半，不是它給的任何數字。**

---

## 4. 改動：把「能量劣勢」與「我回到能打的狀態」拆成兩個閂鎖

### 4.1 做什麼

**不動 `extendEnergyLatch`。** 它現在的語意就是「我比他弱」，一個純相對量，
一直都是對的。

**新增 `extendRecoveredLatch`** —— 一個只吃 `cornerRatio` 的絕對閂鎖：

```
進場（回到能打的狀態）   cornerRatio > recoverEnter (= cornerExit = 0.95)
出場（又飛不動了）       cornerRatio < recoverExit  (0.85)
```

仲裁時把「因能量而脫離」改成兩者的合取：

```
   舊    !shooting && (extendEnergyLatch || extendTurnLatch) && range < extendRange
   新    !shooting && ((extendEnergyLatch && !extendRecoveredLatch)
                       || extendTurnLatch) && range < extendRange
```

### 4.2 為什麼是兩個閂鎖，不是給同一個閂鎖第二條解除路徑

前一版寫的是「`extendEnergyLatch` 的解除多一條 `cornerRatio > recoverRatio`」。
那會產生：

```
energyAdvantage   = −800     明確仍在能量劣勢
cornerRatio       = 1.05     速度足夠
extendEnergyLatch = false    ← 欄位在說謊
```

HUD 的 `extendReason` 與 `extend-trigger.probe.ts` 都直接把這個布林讀成
「能量」。**專案的既有規矩是「一個閂鎖只維護一種事實」。** 拆成兩個之後每個
欄位都誠實，HUD 與探針一個字都不用改。

【更新順序】`stepRules` 先更新所有閂鎖再仲裁。同一拍若 `energyAdvantage
< −300` 且 `cornerRatio > 0.95`，兩個閂鎖都成立，合取為 false —— **不進
`extend`**，不會產生一拍脈衝。這是刻意的：「我比他弱但我飛得動」本來就該去打。

**但「不進 `extend`」只對新進場成立。** 若當下已經在 `extend` 且 `minDwell`
（0.8 s）尚未滿，既有規則仍會保留舊意圖最多 0.8 秒。那是既有行為，不動它。

### 4.3 為什麼不需要再進入冷卻

前一版配了一個 8 秒的 `extendRecoverHold`。**兩個閂鎖的寫法讓它變成多餘**：
`extendRecoveredLatch` 自己就帶遲滯（0.95 進 / 0.85 出），速度要真的掉回
0.85 才會讓「因能量脫離」重新成立。

而那個冷卻本身有害：期間 `energyEnter` 被硬忽略，態勢真的惡化（還沒到
`defend`、turn/floor 兩個閂鎖也還沒成立）時，AI 是聾的。

### 4.4 兩個門檻的定法

**`recoverEnter` 直接引用 `cornerExit`（0.95），不是獨立參數。**
「我飛得動了」只該有一個定義，與 `extendFloorLatch` 共用同一把尺。

**`recoverExit = 0.85`，待掃描。** 它訂的是「回復狀態要掉多少才算失效」，
範圍被兩端夾住：

```
必須 > cornerEnter (0.75)   否則「已回復」要撐到見底才失效，等於沒有這個閂鎖
必須 < recoverEnter (0.95)  否則沒有遲滯
```

取中間的 0.85。**速度下降時 0.85 會先於 0.75 被跨過**，所以 0.75~0.85 之間
存在第三種狀態：「還沒見底，但已不再算 recovered」—— 此時若能量閂鎖仍開著
就會回到能量型 `extend`。這是刻意的、明確定義的，不是漏洞。

### 4.5 不動的東西

`extendTurnLatch`（機體轉不贏）與 `extendFloorLatch`（我飛不動了）**一個字
不動**。前者談的是機體，補能量改變不了它；後者本來就是絕對的，`floorExempt`
那條豁免也不動。

**HUD 不動。** 前一版想加一列「能量（已回復）」，但 `main.ts:1019` 只在
`intent === 'extend'` 時呼叫 `extendReason` —— recovered 一成立意圖就離開
`extend`，那一列最多在 `minDwell` 的 0.8 秒內閃一下。**沒有觀測價值，不做。**

人工驗收要看的是「`extend` 變短了」，而意圖本身已經印在 HUD 上。

---

## 5. 驗收

### 5.1 主判準：消融對照，只斷言方向

**這一版的目標只有一個：「退得短」。** 「回得來」是 §9 的目標，§4 不負責。

**新寫一支整合測試**，跑 `axis-escort` 與 `allies-escort` 兩張卡各 300 秒，
**同一支測試跑開與關兩檔**：

```
關    recoverEnter = Infinity    latch 永不成立，合取退化成原式
開    recoverEnter = cornerExit  出貨組態
```

【為什麼 `Infinity` 是精確的關閉開關】`latch(active, value, enter, exit)` 在
`enter > exit` 時是 `active ? value > exit : value > enter`。`enter = Infinity`
時未啟動狀態下 `value > Infinity` 恆為 false，永遠不會啟動，出場那一支永遠
不會被評估。**逐位元等價，可證。**

斷言（每卡，五次 ±0.5% 初速微擾）：

```
能量型 extend 段落的持續時間 p90       開 < 關
能量型 extend 段落的最大離場距離 p90   開 < 關
兩者各要求 5 次微擾中至少 4 次方向一致
```

**沒有一個可調的數字。** 「開 < 關」是方向，4/5 是符號檢定的慣例不是調出來的
門檻。這與「先量現況當基準」的差別在於：對照組由同一個 binary、同一組種子、
同一組微擾產生，不是一個寫死的歷史數字。

【為什麼不用絕對距離門檻】`ai-withdraw-anchor.test.ts:236` 的註解逐字警告過
「單次量測當門檻是變更偵測器不是設計判準」。

### 5.2 存活性：擋掉 survivor bias

上一條的兩個量都只在「有 extend 段落」時才有值。**把 protected 弄死得更快
的版本會拿到比較漂亮的分布**，所以必須同時斷言：

```
protected 單位的存活數        開 ≥ 關（五次微擾的中位數）
段落數 > 0                    兩檔都要
```

【`protected` 全滅之後】停止採樣，並把「全滅發生的時刻」列入輸出。若某一檔
系統性地更早全滅，前面那兩條的比較無效。

### 5.3 §9 的門檻 —— 這一版順手量出來，不斷言

同一支測試印出（**只印不斷言**）：

```
出場時離「存活 protected 形心」不比進場時更遠的段落 / 總段落數
```

**這個比例是 §9 要不要做的裁定依據**（見 §8.2）。這一版不斷言它，因為 §4
根本沒有加任何方向 —— 它會落在 50% 附近才是正常的。

同時印出的診斷（都不斷言）：

- 每段 `extend` 的持續秒數、最大離場距離、高度變化（p50 / p90）
- 到 protected 形心的距離 p50 / p90
- **每一條出場路徑各觸發幾次**（見 §5.5）

### 5.4 副判準：不得把 AI 變弱

開／關兩檔都要跑，全部含五次微擾：

- `test/integration/ai-targeting.test.ts` 的 `fireShare`
- `test/integration/ai-duel-matrix.test.ts`
- `test/integration/ai-manoeuvre.test.ts`、`ai-visible-evasion`、`ai-defence`
  —— 縮短脫離最容易先傷到失速、安全層介入與破防
- `test/unit/perf-gate.test.ts`（單獨跑）
- `test/integration/rematch.test.ts`（單獨跑）
- 直接受改動的單元測試：`ai-rules.test.ts`

**全域護欄**（不得比現況更糟，不要求變綠）：

```
ai-withdraw-anchor 的 maxRadius   ≤ 11,111（現況 11,110.26，取上取整）
```

【為什麼是 11,111 不是 11,110】現況是 11,110.26，寫 11,110 的話護欄在任何
改動之前就已經失敗。

### 5.5 出場路徑的計量 —— §7 但書的觀測窗

§7 承認幾個護欄值「值不動但作用會變」。**那句話要看得見。** 測試要逐段記下
`extend` 是**被哪一條路徑結束的**：

```
energyAdvantage > energyExit          相對出場（既有）
extendRecoveredLatch 成立             絕對出場（本文新增）
range >= extendRange                  距離出場（既有）
shotInstant > 0                       射擊解插隊（既有）
defend / rally 覆寫                   外部插隊
```

開／關兩檔比較這個分布。它直接回答：`energyExit` 是不是變成幾乎不觸發。

**死碼要說出來**，不留一個已經不作用的護欄假裝它還在守著什麼。若某一條掉到
零，那是要回報給專案負責人的事實（§8.3）。

---

## 6. 起始值

| 參數 | 起始值 | 依據 | 掃描檔位 |
|---|---|---|---|
| `recoverEnter` | `cornerExit` (0.95) | **直接引用，不是獨立參數**（§4.4） | 不掃 |
| `recoverExit` | 0.85 | `cornerEnter` 與 `recoverEnter` 的中間（§4.4） | 0.80 / 0.85 / 0.90 |

**選值規則**（§8.1 裁定）：三檔各跑五次微擾，取 §5.1 兩條方向判準通過次數
最多者；並列時取**較大**的值（較早承認自己又飛不動了，較保守）。

作廢的參數：`extendBankMax`、`extendRecoverHold`、`recoverRatio`、
`extendHomeBias`、`extendAlarmFull`（後兩者移到 §9，尚未定值）。

---

## 7. 明確不做的事，以及誠實的但書

- **不動 `energyEnter` / `energyExit` / `cornerEnter` / `cornerExit` /
  `floorExempt` / `extendRange` 六個掃描定案的護欄值。**

  **但書**：值不動，**作用會變**。

  | 參數 | 值 | 作用怎麼變 |
  |---|---|---|
  | `cornerExit` | 0.95 | **新增一個直接角色** —— 它同時成為 `extendRecoveredLatch` 的進場門檻。這是六項裡影響最大的一項 |
  | `energyExit` | +100 | 相對出場路徑會**大幅減少被用到**（recovered 通常 3~5 秒就先成立）。它仍是唯一能讓 `extendEnergyLatch` 本身關掉的路徑 |
  | `energyEnter` | −300 | 閂鎖的進場條件不動，但「因能量進入 `extend`」多了 `!extendRecoveredLatch` 這個條件 —— **對欄位不動，對意圖有動** |
  | `cornerEnter` | 0.75 | 值不動；它與新的 `recoverExit` 一起界定了 §4.4 的第三種狀態 |
  | `extendRange` | 1,500 | 值不動、作用方向不明。脫離變短後距離較不容易拉到 1,500，但那也表示它本來就很少決定結局。**由 §5.5 量出來** |
  | `floorExempt` | 2,000 | 比較式不動，但脫離變短會改變高度與速度的軌跡，命中這個豁免的頻率仍可能變。**只有程式文字不動** |

  **第七類外溢**：`defendLatch` 與幾何 mode（`speedRecover` / `overshoot` /
  `planeDegenerate`）的佔時。脫離變短會改變交戰幾何，那幾個門檻一個字沒改
  但觸發頻率會變 —— 這是 §5.4 把 `ai-manoeuvre` / `ai-defence` 列進副判準
  的理由。

- **不動 `extendTurnLatch` 與 `extendFloorLatch` 的判準。**
- **不碰瞄準解。** `steer.ts` 一個字不改。
- **不碰戰術層。** `quota` 的預設值、`order-of-battle-replay` 的基準重跑，
  都是另一份 spec 的待裁定事項。
- **不擴充 `FlightDirector` 的介面。**
- **不做回場方向偏置與威脅抑制。** 見 §9。

---

## 8. 裁定

專案負責人 2026-08-23 指示「先照你的意思評估決定」。以下是裁定與理由，
**每一條都可以被推翻**。

### 8.1 參數選值 —— 不預先訂數值，訂**選值規則**

見 §6。現在訂數值等於再犯一次「拿沒量過的數字當定值」。只有掃描結果與規則
衝突時（例如通過次數最多的那一檔同時把 §5.4 的某一項打壞）才回頭問。

### 8.2 §9 要不要做 —— 由 §5.3 的量決定

**門檻**：§5.3 印出的「出場時不比進場時更遠」的比例，在 §4 上線後：

```
> 0.5      §9 不做。方向缺失已經被「退得短」吃掉了
≤ 0.5      §9 要做，但要先解掉 §9.2 的四個缺陷
```

【為什麼這樣切】§2.3 已經說明兩個缺口的關係 —— 方向缺失是被「退很久」放大
才致命的。過半就代表放大效應消失了。0.5 是「過半」，不是調出來的數字。

### 8.3 副判準退步超過雜訊 —— **退回**

不接受退步。先例：「破防力道連續化」與「異平面破防」兩個 Task 都是實測否決
後整個退回。本文修的是體驗缺陷不是正確性缺陷，沒有掙到讓 AI 變弱的額度。

**兩個例外分開講：**

- `ai-manoeuvre` / `ai-visible-evasion` / `ai-defence` 退步是**硬否決** ——
  那三條守的是失速、安全層介入與破防，不是戰果。
- `fireShare` 或 `ai-duel-matrix` 退步、而 §5.1 的主判準**同時大幅改善**時，
  那是真正的取捨，**回來問**。

### 8.4 §7 的但書 —— **接受，但加了觀測窗**

`energyExit` 作用變弱是這份 spec 生效的結果，不是副作用。但已加 §5.5：
逐段記下 `extend` 被哪一條路徑結束，開／關兩檔比分布。若某一條掉到零，
回報事實；要不要順手清掉那個護欄值，是專案負責人的決定。

---

## 9. 條件式後續：回場方向（**這一版不做**）

§8.2 的門檻沒過才做。設計已經走過兩輪並被推翻兩次，把結論留在這裡，
**不要從頭再想一次**。

### 9.1 方向本身是對的

專案負責人的原話：「飛行的方位朝向敵人？這樣至少回到戰場的速度更快，
但不可以大幅度轉彎以免又減少速度」。這個目標沒有被否定，被否定的是兩種
**表達方式**。

### 9.2 四個必須先解掉的缺陷

任何後續設計都要先回答這四個，否則會第三次被推翻。

**一、`wrap` 在正後方有翻轉點。** 第二版提的
`ψ = here + wrap(home − here) × bias` 看起來連續，其實不是：

| 錨點方位 | `err` | 指令偏離當前航向 |
|---|---|---|
| `here + 179°` | +179° | +44.75° |
| `here + 181°` | −179° | −44.75° |

錨點方位動 2°，指令航向跳 89.5°。**而「戰場在正後方」正是 `extend` 回場的
常態。** 專案的既有答案是給它記憶（`stationKeeping` 的 `orbitSide` 閂鎖）。

**二、傾斜角下不了指令。** 見 §2.6。任何「不要大幅度轉彎」的表達都不能寫成
傾斜角上限；第一版的 `extendBankMax = 15°` 實測坡度中位是 50~80°，那個值
從來不曾成立。

**三、錨點的連續性。** 第二版提「存活 protected 的形心」，但：

- 一架陣亡時形心跳半個編隊間距（**形心不是連續的**，第二版寫錯了）
- 全滅後退回目標位置是第二個跳點
- 兩支編隊分很開時形心落在沒有戰術意義的空地
- 飛機在錨點上或極近時水平方位沒有定義 —— 需要距離死區，
  `rally.ts:22` 的 `MIN_ERROR` 是既有的成例

**四、威脅抑制的上限被 `defend` 卡住。** `DEFAULT_RULES.threatEnter = 0.35`
而 `danger = max(threat, alarm)`，所以 `alarm > 0.35` 的下一拍意圖就是
`defend`，不走 `extend`。抑制係數的飽和點**必須 ≤ 0.35**，否則永遠達不到
飽和。第二版訂的 0.5 會讓 `homeAuthority` 最低只到 0.70 —— 幾乎是空操作。

而且那個 0.5 的幾何說法也錯：`alarm = alarmFactor × alarmRamp`，正中心瞄準
持續 0.25 秒也會得到 0.5，與角度無關。

### 9.3 量測工具要先修

`extend-return.probe.ts` 有 §3.2 那五個系統性偏差。做 §9 之前要先：

- 節拍對齊 production（240 Hz steering / 10 Hz state）
- 補上 `applyPitchBias(sweetPitch)` 與 `min(stallPull, pullCeiling)`
- `speedAdvantage` 用真實值，不要固定 0
- 刪掉「`bias = 0` 是現況」那個對照組，或改成真的走 `aimFromKnobs`
- 加上 `geometryGate` —— 第二版宣稱「只放在 `case 'extend'` 裡是對的」，
  但沒有量過 `extend` 期間三種 mode 的佔時。若佔時很高，那個位階決定就是
  「在真正出問題的取樣中根本沒生效」

`alarm-dist.probe.ts` 要改成量 `alarm | intent === 'extend'`，不是全體。

### 9.4 分理由套用

第二版把偏置套在所有 `extend` 上，包含 `extendFloorLatch` 的極低速情境與
`extendTurnLatch`。**後續設計應該只對「能量原因」的脫離套用** —— 見底時
最該做的是低頭換速度，不是轉彎。

---

## 10. 三個版本的變動（給下一個讀的人）

| | 第一版 | 第二版 | 這一版 |
|---|---|---|---|
| 出場條件 | 同一閂鎖兩條解除路徑 + 8 秒冷卻 | 兩個正交閂鎖 | **不變**（兩次審查都通過） |
| 回場方向 | `extendBankMax` 15° 坡度上限 | `extendHomeBias` 0.25 方位差比例 | **移到 §9，條件式** |
| 威脅抑制 | `threatInstant` | `alarm`，飽和點 0.5 | **移到 §9，飽和點必須 ≤ 0.35** |
| 主判準 | `ai-withdraw-anchor`（紅、量錯東西） | 護送情境絕對距離（變更偵測器） | **消融對照，只斷言方向** |
| 範圍 | 三步 | 兩步 | **一步** |

第二版被推翻的地方（都由 Codex 複審指出、逐條查證過）：

- §5.2 宣稱「連續、沒有翻轉點」—— `wrap` 在正後方就是翻轉點
- §5.3 宣稱「形心是連續的」—— 一架陣亡就跳
- §6 的 0.5 —— 被 `threatEnter = 0.35` 卡住，抑制永遠不飽和；
  幾何說法也忽略了 `alarmRamp`
- §3.2 的甜蜜點 —— 五個系統性偏差，`bias = 0` 那一列是探針造出來的
- §4.4 文字與數值相反（「不該比見底更早失效」寫反了）
- §4.6 的 HUD 讀數 —— recovered 一成立就離開 `extend`，看不到
- §8.1 的主判準有 survivor bias
- §8.3 的 `maxRadius ≤ 11,110` —— 現況是 11,110.26，護欄改動前就紅
- §10 漏了 `cornerExit` 的作用擴張（最主要的那一項）
