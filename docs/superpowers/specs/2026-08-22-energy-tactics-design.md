# AI 的主動能量經營 —— 戰術層

**日期**：2026-08-22
**分支**：`feat/energy-tactics`

## 1. 為什麼

人工回報：「P-51 攔截 He 111 時，護航的 Bf 109 追不上 P-51，感覺 Bf 109
性能弱很多。」

追不上是史實（P-51D 極速 703 km/h、Bf 109 G-6 640 km/h），`GAME_FEEL` 全
戰鬥機共用一組倍率所以極速比 ≈ 史實比。109 的優勢在垂直面（海平面爬升
1150 對 1060 m/min、功重比 0.47 對 0.35），而**現行的 AI 沒有任何一種意圖
在經營那個優勢**。六種意圖裡 `extend` 是被動止損，觸發條件全是劣勢。

### 1.1 根因：觸發是相對的，執行是絕對的

`extend` 由 `energyEnter`（跟敵人比能量）觸發，但它的執行
（`extendPitchAngle`）看的是 `cornerRatio` = TAS ÷ **自己的**角落速度。
兩者不一致時它會補錯方向。

`allies-intercept`、150 秒、種子 20260805，護航的 Bf 109：

```
extend 佔時          30.2%
extend 期間 ratio    1.59      相對自己速度過剩 → 命令爬升
高度差              +445 m     它在 P-51 上面
速度差              −28.6 m/s  它比 P-51 慢
比能量差             +4 m      總帳持平
extend 期間航跡角   +6.5°      還在爬
engage 佔時          2.2%      同一批 AI 在掃蕩卡是 28.3%
與最近敵機距離      3642 m
```

109 不是能量不夠，是**能量全部存在錯誤的形式裡**：總帳持平，445 m 掛在
高度上，而系統還在命令它繼續爬。

`pitchSpeedGain = 4 × EXTEND_PITCH`，所以 `cornerRatio` 超過 **1.25 就飽和
在最大爬升 25°**。109 的 1.59 不是「有點想爬」，是滿舵。

### 1.2 這解釋了一次「無效」的掃描

2026-08-13 掃描 `extendPitchAngle` 的爬升增益，結論是「完全無效而且不單調，
全在雜訊裡」（見 `steer.ts` 該欄位註解）。那次掃的是**增益大小**——命令的
**方向**對這個局面本來就是錯的，增益調到多大都不會有效果。

### 1.3 缺陷是通用的，通用的維度是距離不是任務

七種局面、同一組量測（150 秒、種子 20260805）：

```
局面                    extend%  航跡角  ratio   高度差  速度差  比能量差  距離
遭遇戰 red/bf109          16.6    +1.4°   0.89     +9m    -4.8    -79m    585m
遭遇戰 blue/p51           15.0    -2.6°   0.87    -32m   +10.3   +115m    626m
撤離   blue/p51           29.3    -1.6°   0.87     +2m    -2.5    -25m    193m
撤離   red/bf109           5.2    +5.7°   1.05     +6m    +2.7    +33m    232m
軸心護送 blue/bf109        5.4    +2.7°   1.02   +335m   -19.5     -8m    822m
掃蕩   red/bf109          11.3    +0.6°   1.04   +157m    -6.5    +11m   1595m
掃蕩   blue/p51            1.6     0.0°   1.05   -139m    +3.5    -54m   1344m
攔截   red/bf109          30.2    +6.5°   1.59   +445m   -28.6     +4m   3642m
護送   兩邊都是            0.0     ——      ——      ——      ——      ——      ——
```

按距離排序，`cornerRatio` 單調上升：193 m → 0.87、585 m → 0.89、822 m →
1.02、1595 m → 1.04、**3642 m → 1.59**。

機制：**遠距離時沒有人在拉桿，TAS 自然貼近極速，`cornerRatio` 必然 > 1。**
那個量在遠距離不是在說「我速度過剩」，只是在說「我沒在轉彎」。

一句話：**`cornerRatio` 是一個纏鬥中的量，被拿去當遠距離的決策依據。**

兩個推論：

- **掃蕩卡的 P-51 也踩到**（`ratio` 1.05、比能量差 −54、航跡角 0.0°），只是
  它夠快所以 `extend` 只佔 1.6%。**這不是「幫 109」的平衡調整，是一個對雙方
  對稱的方向錯誤。**
- **護送卡兩邊的 `extend` 都是 0.0%**，這份 spec 對那張卡無效。它的問題
  （`docs/backlog.md` §1.3）是另一條線。

### 1.4 專案自己的探針已經指到同一個地方

`test/tools/extend-payoff.probe.ts` 的判讀規則寫著：

> 「越撤越糟」比例高 → extend 這個動作本身無效，撤了反而更慢。
> 那時該修的是 **extend 做什麼（`extendPitchAngle`）**，不是何時進出。

2026-08-22 跑出來的基準（20v20、420 秒、VETERAN）：

```
開局        段數   越撤越糟   補到門檻才走   收益中位   高度變化中位
4000/200    662     38.7%       48.9%        +0.012      +5 m
5500/150    481     33.9%       47.8%        +0.036     -21 m
```

兩個失效模式**同時**存在：三分之一以上越撤越糟（動作無效），而且只有不到
一半跑完（被 `defend` 插隊，離開後 53–58% 接 `defend`）。這份 spec 治前者。

### 1.5 現行控制權的分佈

同一組量測，只算戰鬥機：

```
                     攔截(109護航)   掃蕩    撤離
 rally/flank 壓過意圖      7.0%      0%      0%
 focus 命令（不碰意圖）    16.5%    38.5%   48.0%
 approach                 51.5%    42.2%   73.6%
 extend                   38.3%    22.4%   13.3%
 engage                    2.2%    28.3%   12.7%
 defend                    1.0%     6.6%    0.4%
```

集火令的實際樣態（同上三張卡）：

```
                    攔截    掃蕩    撤離
 結束的集火令        3       3       0（持有到收場）
 壽命中位          23.6s   27.2s     —
 期間質心距離中位   1032m   619m    233m
 落在 1500..2500   11.7%   9.1%    5.1%
```

集火**極少發生但一發生就持續 20–30 秒**，而且全部在 233–1032 m 的近距離。
戰術層的建能佔位在 2 km 以外，兩個分布幾乎不重疊。

## 2. 範圍

**做**：

- `extendPitchAngle` 的方向修正（§4）。它是 FSM 的前置，因為 `cooldown`
  復用 `extend`。
- 六狀態的單機戰術層（§5），住在 `AiController`，純函數在
  `src/ai/tactics.ts`。
- 四道量化止損（§7）。
- 配額（§8），兼作消融旋鈕。
- `TargetBoard` 加一條 `protectedMask`（§7.3）。這是 `src/battle/` 唯一的
  改動，與 `priority`、`flightOf` 完全同型。
- 逐機型、逐卡片的通用性驗收表（§10）。

**不做**（各有理由，不是遺漏）：

- **難度分層**。`DifficultyProfile` 現在只有 `reactionDelay` 與 `aimError`，
  兩顆 profile 差別只在延遲。現在加第三個旗標沒有量測需求驅動。
- **分隊級的能量命令**（指揮層發「這一隊去佔高度」）。`FLANK_ENABLED` 現在
  關著，是「對的路徑、錯的時機」的前車之鑑。等單機層量得出效果再談。
- **護送卡的 `convoyPriority` 偏置問題**（backlog §1.3）。護送卡的
  `extend` 佔時是 0.0%，這份 spec 碰不到它。
- **`extend` 被 `defend` 插隊**（§1.4 的第二個失效模式）。那要動仲裁的優先
  序，而那組關係是逐條實測談定的。
- **按機型分開定值**。§3 說明為什麼一組就夠；真的分不出來時才退到分開，
  而且那是專案負責人的裁定。

## 3. 為什麼一組參數就夠

專案負責人 2026-08-22：「要注意每種機型、情境都要適用，如果真的沒辦法適用，
可以考慮按機型、情境分開定義。」

**判準一律寫成無因次的相對量**，用**自己的角落速度**當分母。

`cornerRatio` 的病根不是「它是絕對值」——它已經是無因次的——而是**它自我
參照**（TAS ÷ 自己的角落速度，看不到敵人）。替代量同樣無因次，但看的是兩者
的**關係**。

`Situation.cornerRatio` 的欄位註解自己就寫著這個區分：

> `energyAdvantage`（相對比較）仍然用比能量，**那是對的用法**。

程式碼早就知道要分開，`extendPitchAngle` 只是拿錯了那一個。

### 3.1 無因次化能宣稱什麼、不能宣稱什麼

**能宣稱**：同一個數字在不同機種、不同高度上代表**同一件事**——「敵我的差
佔我自己操縱尺度的多少」。所以參數不必按機型分。

**不能宣稱**：不同機種配對有**相同的戰術意義**。分母只有自己的角落速度，
沒有敵方的包絡、沒有航向、沒有雙方的最大平飛速度。戰鬥機對轟炸機時
（角落速度差很大）這個量仍然有定義，但它不是對稱的優勢度量。

**因此 §10.1 的驗收必須把「戰鬥機對轟炸機」列成獨立的一格**，不能靠無因次化
直接宣告成立。

情境同理：判準是幾何與能量的函數，不是任務類型的函數，所以七張卡自動生效。

**退路**：§10.1 的驗收要逐機型、逐卡片列出同一組參數的表現。若真的找不到共用
值，才退到分開定義，而且那時候它是負責人的裁定。

## 4. 方向修正

### 4.1 `Situation` 加兩個無因次欄位

兩者都在 `evaluateEnergy` 裡算。**分母與 `cornerRatio` 是同一個**——那是既有
紀律，而且 `evaluateEnergy` 現在就已經算了自己的 `manoeuvreSpeed`
（`assess.ts:269`），新公式也只需要自己的那一個。

```ts
/**
 * （我的 TAS − 他的 TAS）÷ **我的**角落速度。正 = 我比較快。
 */
speedAdvantage: number

/**
 * `energyAdvantage` ÷ 我的角落速度**動能高度**（vc² / 2g）。正 = 我能量多。
 */
energyRatio: number
```

`vc² / 2g` 是「把角落速度的動能全部換成高度會有多高」。`energyRatio = 0.5`
的意思是「我比他多半個**角落速度動能高度**」——**不是**「半個角落速度的
能量」，動能與速度平方成正比。

**分頻**：兩者與 `cornerRatio` 一樣是 `evaluateEnergy` 算的，也就是 10 Hz
取樣、240 Hz 保持。這不是新引入的性質——現行的 `cornerRatio` 就是這樣供
`steerCommand` 用的（`AiController.ts:393`、`steer.ts:1454`）。TAS 在 100 ms
內比近距離幾何慢變，合理。

### 4.2 `extendPitchAngle` 換算式

```ts
const selfDeficit = 1 - cornerRatio        // 相對自己（現行）
const foeDeficit = -speedAdvantage         // 相對敵人（新增）
const speedDeficit = selfDeficit > foeDeficit ? selfDeficit : foeDeficit
const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * altitudeDeficit
```

**沒有新參數，沒有距離門檻。**

### 4.3 這條規則實際上在說什麼

化簡（`Vs` = 我的 TAS、`Vc` = 我的角落速度、`Vt` = 他的 TAS）：

```
selfDeficit = (Vc − Vs) / Vc
foeDeficit  = (Vt − Vs) / Vc
max(...)    = (max(Vc, Vt) − Vs) / Vc
```

所以新規則是：**只有當我的 TAS 同時高過「我自己的角落速度」與「敵人的
TAS」才爬升，否則低頭。**

這比原本的說法準確。**先前寫的「近距離自動維持現行行為」不成立**——哪一項
主導只取決於 `Vt > Vc`，與距離無關。§1.3 的量測表看起來像是保持了現行行為，
那是因為近距離纏鬥中雙方都低於角落速度（`Vt < Vc`），所以 `selfDeficit`
主導。**那是那些局面的統計規律，不是結構保證。**

代進 §1.3 的實測值：

```
局面          selfDeficit   foeDeficit   max 取誰   結果
遭遇戰 585m      +0.11        +0.03      self      低頭（與現行相同）
撤離   193m      +0.15        +0.02      self      低頭（與現行相同）
掃蕩  1595m      -0.04        +0.04      foe       小幅低頭（現行是小幅爬升）
攔截  3642m      -0.59        +0.19      foe       低頭（現行是滿舵爬升 25°）
```

### 4.4 三類已知的反例，全部要有測試

**（一）近距離但敵機很快。** `Vc = 160`、`Vs = 176`、`Vt = 208`：舊值
`selfDeficit = −0.10` 爬升，新值 `foeDeficit = +0.20` 低頭。低頭會增加接近率
與轉彎半徑，**可能讓超前更糟**。現行的超前攔截只在 `range < 120 m &&
closureRate > 0` 才觸發（`steer.ts:1035`），所以 120 m 之外仍有反例。

**（二）TAS 差沒有方向資訊。** 敵機迎面飛來、橫越、同向逃跑都可能得到相同的
`speedAdvantage`。把它解讀成「追不上」只在**大致同向**時可靠。

**（三）戰鬥機對轟炸機。** 角落速度差很大時這個量的戰術意義不同（見 §3.1）。

**這三類是 §12.2 的測試，不是延後事項。** 若量測顯示（一）真的讓超前變糟，
下一步是把 `foeDeficit` 乘上一個由 `angleOffTail` 導出的連續權重（追擊 → 1、
橫越 → 0、迎面 → 0），而不是加距離門檻——那會引入新的翻號點。**這一步刻意
不先做**：多一層權重就多一組要掃描的東西，而現在還不知道它需不需要。

### 4.5 連續性的宣稱要收窄

`max` 的兩個分支在交界處**數值相等**，所以不會像裸門檻那樣瞬間跳變——那個
機制（`steer.ts:1157` 記的、在 1000 m 線上震盪 40 秒的那次）確實被消除了。

**但推不出「所以不會有極限環」。** `max` 的輸出仍會在 `Vs = max(Vc, Vt)` 穿過
零，加上高度項還有第二條零線，而整個迴路含 10 Hz 取樣、240 Hz 執行、飽和、
俯仰慣性與反應延遲。連續的非線性閉迴路照樣可能振盪。

**正確的宣稱**：不會在兩個 `max` 分支的交界處產生不連續的指令。**震盪要靠
§12.2 的測試與 §10 的量測排除，不能靠這個論證。**

### 4.6 簽名

```ts
export function extendPitchAngle(
  cornerRatio: number,
  speedAdvantage: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number
```

**`test/unit/ai-steer.test.ts` 有 17 處直接呼叫它，全部要更新。**（先前的
spec 寫「沒有任何單元測試直接呼叫」是錯的，那次 grep 被 `head` 截斷。）

`test/tools/extend-pitch.probe.ts` 要跟著改。`test/tools/climb-blame.probe.ts`
**只有註解提到**，不必改。

## 5. 六個狀態

一架飛機一個狀態。狀態值存在 `AiController`，轉移由 `src/ai/tactics.ts` 的
純函數 `stepTactics` 算。

```
off       不參與（沒名額／有命令／transit／太近／沒目標）
build     能量赤字 → 爬升加速，累積盈餘
perch     盈餘達標但目標未承諾 → 保持高度與距離
dive      目標進入承諾姿態 → 帶著能量進場
zoom      一輪射擊結束 → 拉起爬回
cooldown  止損 → 強制脫離一段時間
```

循環是 `build → perch → dive → zoom → build`；`cooldown` 是止損出口。

### 5.1 轉移一律走閂鎖，不得有裸門檻

`rules.ts:29` 的 `latch(active, value, enter, exit)` 依賴**獨立的 `active`
記憶**，而 `stepRules` 每個決策節拍更新**所有**閂鎖，即使那一拍沒有選到那個
意圖（`rules.ts:297`）。戰術層要真的照抄這個語意：

- **`perchLatch` 是獨立的欄位**，不得用 `phase === 'perch'` 代替
- 它在 `build` / `perch` / `dive` / `zoom` **全程**更新，不只在 `perch` 時
- 由 `zoomMax` 強制回 `build` 而 `perchLatch` 仍為真時，**允許**在 `minDwell`
  之後直接回 `perch`（能量本來就還在，不該再存一次）

理由與 §4.5 引的那次極限環相同：**FSM 本質上就是「用門檻決定爬或衝」。**

每個狀態有最短停留 `minDwell`，`cooldown` 除外（它自己就是計時的）。

### 5.2 轉移的優先序

**同一拍可能有多條轉移成立，順序不同會產生不同的戰術。** 由高到低：

```
1. 強制離場   命令／transit／目標消失／名額取消／selfIndex < 0  → off
2. 絕對止損   §7.1 的建能期限、§7.4 的能量帳                    → cooldown
3. 任務壓力   §7.3                                              → dive
4. 期限出口   perchMax → dive、diveMax → zoom、zoomMax → build
5. 條件轉移   perchLatch、承諾姿態、通過判定
```

於是先前含糊的三處有了答案：

- `build` 同時達到 `perchEnter` 與建能期限 → **`cooldown` 贏**（第 2 級高於
  第 5 級）。理由：期限到了表示這一輪的建能不健康，帶著它進 `perch` 只是把
  問題延後。
- `perch` 同時要 `dive`（承諾）與要 `build`（能量掉破 `perchExit`）→
  **`dive` 贏**（第 3、4 級高於第 5 級）。理由：承諾姿態是稍縱即逝的，能量
  掉一點還打得到。
- `cooldown` 倒數歸零 → **一律先回 `off` 停一拍**，下一個決策節拍才重新判斷
  能不能進 `build`。理由見 §5.4。

### 5.3 距離閘門與再進入

距離閘門只在 `off → build`：進入用 `FLANK_RANGE`（2500）、離開用 `focusRange`
（1500）。**直接用指揮層已經在用的那一對**，免費得到遲滯，也不發明第二套幾何。

進了循環之後不再受距離限制——否則 `dive` 一貼近就掉出戰術層，`zoom` 永遠做
不出來。

### 5.4 永久循環的出口

只靠距離閘門會產生一個永久迴圈：

```
build 45s → cooldown 12s → off → 因為仍然很遠，立刻 build → …
```

**這正好會把原問題換成另一種永久循環**，所以必須有出口：

- `cooldown` 結束後回 `off`，而 `off → build` 額外要求**下列任一**成立：
  **目標換過**，或 `energyRatio` 比進入上一輪 `cooldown` 時**高**。
- 也就是：同一個目標、同樣打不動的能量狀態，不會一直重試。

這個條件用一個 `lastCooldownRatio` 欄位就夠，不需要新參數。

### 5.5 逐條轉移

| 從 | 到 | 條件 |
|---|---|---|
| `off` | `build` | 有名額 && `selfIndex >= 0` && `order === null` && `!transit` && 有目標 && 距離閂鎖在「遠」 && §5.4 的再進入條件 |
| `build` | `cooldown` | 建能期限（§7.1） |
| `build` | `perch` | `perchLatch` 為真 |
| `perch` | `dive` | 承諾姿態閂鎖為真、待機期限到、或任務壓力（§7.2、§7.3） |
| `perch` | `build` | `perchLatch` 掉回假——能量花掉了就回去再存，不是止損 |
| `dive` | `zoom` | 射擊窗結束（`closureRate` 由正轉負持續 `passSeconds`）或 `diveMax` 到期 |
| `zoom` | `build` | `zoomMin` 已過，且（`perchLatch` 為真或 `zoomMax` 到期） |
| `zoom` | `perch` | `zoomMax` 強制回 `build` 但 `perchLatch` 仍為真時，`minDwell` 後可直接回 |
| 任何 | `cooldown` | 能量帳止損（§7.4） |
| 任何 | `off` | §5.2 的第 1 級 |
| `cooldown` | `off` | 計時歸零 |

### 5.6 「承諾姿態」怎麼判

boom and zoom 的 `dive` 不能只看「目標很慢」——慢也可能是在閃躲。要看**持續**
的承諾：`psTarget < 0`（他在耗能量）連續成立 `commitSeconds`。

`Situation.psTarget` 已經存在（`assess.ts:41`）。**刻意不加第三個訊號**：每加
一個就多一組要掃描的參數。先用最少的訊號量，不夠再加。

## 6. 每個狀態怎麼飛

**一半復用既有的意圖，不重寫。**

| 狀態 | 飛法 |
|---|---|
| `build` / `perch` / `zoom` | `tacticalCommand`（新的瞄準解，§6.2） |
| `dive` | 覆寫 `intent = 'engage'` |
| `cooldown` | 覆寫 `intent = 'extend'`。「劣勢止損」正是它的語意 |
| `off` | 一個字都不改，現行行為 |

### 6.1 完整的優先序

**先前的 spec 只寫「defend 讓位」，那不夠。** 現行 `arbitrate` 的順序是
defend、merge、**絕對能量見底的 extend**、相對 extend、engage、approach
（`rules.ts:354`）。戰術層排在 `arbitrate` 前面等於**繞過**中間那幾條，
即使一行都沒有改 `rules.ts`。

其中一條是安全問題：**`extendFloorLatch`（「我自己已經飛不動了」）被蓋掉，
而 `build` 要求正航跡角——那會讓一架低於角落速度的飛機繼續爬升，直到失速。**

完整的優先序，由高到低：

```
1. safety          撞地／失速硬接管（applySafety，在最後執行）
2. transit         無條件飛完航程                      → 戰術層 off
3. rally / flank   命令                                → 戰術層 off
4. focus           集火（§9.1）                        → 戰術層 off
5. defend          破防閂                              → 戰術層讓位
6. extendFloorLatch 絕對能量見底                       → 戰術層讓位
7. geometryGate    overshoot / speedRecover / planeDegenerate → 見 §6.3
8. 戰術層          build / perch / dive / zoom / cooldown
9. arbitrate       merge / 相對 extend / engage / approach
```

第 6 級是這一輪新加的，理由如上。第 5、6 級的做法相同：**`stepRules` 照常
呼叫**（閂鎖要繼續維護），戰術層只在那兩個閂鎖都不成立時才覆寫
`AiController.intent`，**不改寫 `RuleState.intent`**——與命令層現行的做法
逐字相同（`AiController.ts:430`、`AiController.ts:439`）。

副作用要被定義：`cooldown` 結束後，既有的 `extend` 閂鎖可能讓自然意圖仍是
`extend`，也就是「狀態已離開 `cooldown`，但飛法繼續 `extend`」。**這是對的**
——那表示能量真的還沒回來——但要有一條測試釘住它，否則它看起來像 bug。

### 6.2 `tacticalCommand`

```ts
export function tacticalCommand(
  phase: TacticalPhase,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  seaHeight: number,
  cfg: TacticalConfig,
  out: Command,
): void
```

**型別是 `Command`（`src/control/Controller.ts:11`），不是 `RawCommand`**
（那個型別不存在，先前的 spec 寫錯了）。它有四個欄位：`aimWorld`、
`throttle`、`brake`、`firing`。

**四個欄位每一步都要完整寫入。** `AiController` 的 `raw` 是重用的物件
（`AiController.ts:225`），不寫的欄位會保留上一格的值——上一格可能是一個
俯衝中的脫離向量或一個扣著的扳機。

三個狀態的瞄準：

- `build`：航跡角取正，大小由 `energyRatio` 的赤字連續決定；水平分量取**遠離
  目標**的方向。`firing = false`。
- `perch`：航跡角取 0（保持能量）；水平分量繞著目標保持 `perchRange` 的距離
  ——不遠離（跟丟）也不接近（被拖進纏鬥）。`firing = false`。
- `zoom`：航跡角取正且大；水平分量**維持當前航向**（轉彎會把剛換到的速度
  花掉）。`firing = false`。

**拉桿紀律要取兩者的較小值**：`min(unloadPull(stallMargin), pullCeiling)`，
與 `steer.ts:1488` 相同。只套 `pullCeiling` 會失去「拉太猛」那一半的軟限制。
這是早退路徑踩過的坑（見 `AiController` 那段長註解），但修法要比那裡完整。

安全層（`applySafety`）排在最後，撞地與失速的硬接管照舊有最終決定權。

### 6.3 `geometryGate` 仍然優先

`steerCommand` 的第一個分支是幾何模式，它**壓過意圖**（`steer.ts:1437`）：
`overshoot`、`speedRecover`、`planeDegenerate` 會直接忽略 `engage` 或
`extend`。

**裁定：這三個仍然優先。** 所以：

- `dive` 覆寫 `intent = 'engage'` **不保證**走普通交戰瞄準——超前時仍然走
  超前的解，那是對的（超前是「我衝過頭了」的事實，不因為戰術意圖而改變）。
- `cooldown` 覆寫 `intent = 'extend'` 同樣可能在近距離被超前的解蓋掉。

`build` / `perch` / `zoom` 走 `tacticalCommand`，**完全繞過 `geometryGate`**。
這是刻意的：那三個狀態的前提就是「離得夠遠」，超前與速度回復在那個距離帶
不會觸發。**但 `speedRecover` 是一個例外要檢查**——它防的是速度見底，而
`build` 正在爬升。§6.1 的第 6 級（`extendFloorLatch`）已經涵蓋這件事：能量
見底時戰術層根本不會拿到方向盤。

## 7. 四道止損

「AI 一直爬高不打仗」是這種機制最經典的死法。四道止損全部是**量化的**。

### 7.0 目標切換的完整重置表

`energyRatio`、`speedAdvantage`、`psTarget` 全部是**相對當前目標**的。目標一
換，它們不連續地跳到另一個值——而下面每一個計量都是差分或計時，跳變會被讀成
假訊號。

**具體的誤判**：換目標前已累積 1.4 秒的 `psTarget < 0`，新目標第一拍也是負
值，於是 0.1 秒後就誤判「新目標已持續承諾 1.5 秒」而俯衝。`dive` 中換目標
也可能繼承舊目標的通過計時，立刻跳 `zoom`。

**做法**：`stepTactics` 收目標的識別（`selectTarget` 回傳的那一架），與上一
節拍不同時逐欄重置：

| 欄位 | 換目標時 |
|---|---|
| `phase` | **不重置** |
| `perchLatch` | 重置為假 |
| `commitSeconds` 的累積 | 歸零 |
| 通過判定的計時與「曾經為正」記憶 | 歸零 |
| 本輪能量帳的基準 | 重設為當下，且**該輪標記為無效** |
| 本輪是否形成過射擊窗 | 歸零 |
| `buildMax` / `perchMax` / `diveMax` / `zoomMax` 的計時 | **不重置**（它們是「這個狀態待多久」，與目標無關） |
| `dryRounds` 的連續計數 | **不重置**（它問的是「這個戰術對我有沒有用」，不是對某一個目標） |
| `lastCooldownRatio`（§5.4） | 清掉，讓再進入條件成立 |

【為什麼 `phase` 不重置】換目標是常態（實測持有中位只有幾秒），跟著重置等於
這個戰術層永遠跑不完一輪。跳掉的是**計量**，不是決定。

【為什麼該輪能量帳要標記無效而不是重算】§7.4 的定義是「從進入 `build` 到下
一次進入 `build` 的淨變化」。中途換目標之後那個差已經不是同一個量的差，
硬算會得到一個沒有意義的數字。標記無效 = 這一輪不參與能量帳止損。

【為什麼不改用絕對的比能量】那就回到 `cornerRatio` 的老問題——絕對量看不到
「我比敵人如何」，而那正是這份 spec 要修的東西。

### 7.1 建能期限

`build` 停留超過 `buildMax` → `cooldown`。

**先前的 spec 還有第二個條件（10 秒滾動視窗的建能率下限），這一版拿掉。**
理由：未滿視窗的 grace period、目標切換後清空視窗的行為、以及零配置的資料
結構全都要另外定義，而 `buildMax` 已經給了硬上界。等量到「爬不動但仍在
build」確實是主要失效模式，再把它加回來。

### 7.2 待機期限

`perch` 停留超過 `perchMax` → **強制 `dive`**，不是 `cooldown`。

已經有能量了就該用掉。這一道也是 §5.6 只用一個承諾訊號的安全網。

### 7.3 任務壓力

被保護單位正在挨打時，立刻 `dive`，不等承諾姿態。

**`TargetBoard` 加一條專用的 `protectedMask: Uint8Array`**，由 `battle` 層
在填 `priority` 的同一個迴圈填（`setup.ts:494`），與 `flightOf`、`priority`
完全同型。`src/ai/` 仍然不 import `src/battle/`。

【為什麼不借用 `priority > 1`】那個欄位的正式語意是「目標評分倍率」
（`target.ts:665`），不是角色標籤。某次調整若把 `convoyPriority` 設回 1，
任務壓力會**無聲消失**，而且沒有任何測試會紅。一條 `Uint8Array` 比一個脆弱
的語意借用便宜得多。

判準：任一敵機到任一我方被保護單位的最短距離 < `pressureRange`。

【成本】這是**敵機 × 被保護單位**的配對掃描，不是單純掃 40 個候選。護送卡
只有 4 架被保護單位，所以是 40 × 4 = 160 次距離平方，10 Hz，可接受。
非護送關卡 `protectedMask` 全零，第一層迴圈就跳掉。

【取得自己的隊別】`Aircraft` 沒有 `team`。用
`board.candidates[selfIndex].team` 推導——`scanThreat` 已經是這樣做的
（`AiController.ts:544`）。**不得寫成 `self.team`。**

### 7.4 能量帳

一輪 = 進入 `build` 到下一次進入 `build`。記兩件事：

- 該輪 `energyRatio` 的淨變化。低於 `−cycleLossMax` → `cooldown`。
  **該輪被 §7.0 標記為無效時跳過這一條。**
- 該輪有沒有形成過射擊窗（`shotInstant > 0` 出現過）。連續 `dryRounds` 輪
  沒有 → 長 `cooldown`（`longCooldownSeconds`）。

第二條治的是「循環跑得順但打不到人」。

## 8. 配額

```
(teamIndex × 黃金比) mod 1 < quota
```

`teamIndex` = **我是我方第幾架**，不是全域的 `selfIndex`。

### 8.1 為什麼不能用 selfIndex

編組表是一隊一個連續區塊（`order.ts:93` 保證藍隊全部排在紅隊之前），
`world.add` 照那個順序給索引（`setup.ts:401`）。用全域索引的話低差異序列會
在兩個區塊上取到不同的比例：

```
quota = 0.5 的實算
   3v3    藍 2 / 紅 2     0
   6v6    藍 4 / 紅 2    +2   ← 33% 的偏差
   7v7    藍 4 / 紅 4     0
  10v10   藍 5 / 紅 5     0
  14v14   藍 8 / 紅 6    +2
  20v20   藍 10 / 紅 11  −1
```

**偏差的方向與大小都隨編制變，而且沒有任何測試會紅**——它會直接變成平衡
偏差。改用隊內序號之後兩隊拿到**完全相同的序列**，對稱編制的偏差恆為 0。

### 8.2 怎麼取得隊內序號

掃一次 `board.candidates`，數出「在我之前有幾架同隊的」。

`selfIndex` 在一場之內不變（`resetBattle` 是就地 respawn，`setup.ts:967`；
接手重建控制器時也把同一個 `c.index` 寫回，`setup.ts:995`），所以**開場算
一次就夠**。用哨兵欄位快取，與 `AiController.burstSeed` 完全同一個手法。

### 8.3 `selfIndex < 0`

**必須明確擋掉。** JavaScript 的負數取模仍是負數：`(-1 × 0.618) % 1 =
−0.618`，而 `−0.618 < 0.5` 為**真**——沒有接 `board` 的單元測試會意外啟用
戰術層。

`selfIndex < 0` 或 `board === null` 時一律 `off`（§5.2 的第 1 級）。

### 8.4 消融

- `quota = 0` → **完全關掉戰術層**。與 `burstConfig.off = 0` 同一個手法。
- `quota = 1` → 全員參與。

**消融表只用 0 / 0.5 / 1 三檔。** 中間值在小編制上的顆粒度太粗（四架的小隊
顆粒度是 1/4），要掃更細時必須逐隊列出實際比例，不能假設它等於設定值。

固定分配的副作用是史實的：一場裡有些人打 boom and zoom、有些人纏鬥。

**為什麼不做動態名額**（「同時最多 N 架在 build」）：那需要跨機協調，而協調
要嘛走指揮層（§2 明確不做），要嘛在戰機端維護全域計數（會產生一個必須每步
同步的幽靈狀態，`stepCommandLayer` 的 `playerFlight` 註解記著為什麼推導比
鏡射安全）。

## 9. 檔案與分頻

```
src/ai/tactics.ts        新檔。TacticalPhase / TacticalState / TacticalConfig
                         DEFAULT_TACTICS / createTacticalState / stepTactics
                         tacticalCommand。全部純函數，狀態集中在 AiController
src/ai/assess.ts         Situation 加 speedAdvantage、energyRatio
src/ai/steer.ts          extendPitchAngle 換簽名（§4.6）
src/ai/target.ts         TargetBoard 加 protectedMask
src/ai/AiController.ts   戰術狀態欄位、10 Hz 推進、覆寫、resetTactics
                         tacticalConfig 可注入（掃描與消融用）
src/battle/setup.ts      填 protectedMask（與 priority 同一個迴圈）
                         resetBattle 呼叫 resetTactics
test/unit/ai-steer.test.ts   17 處呼叫要更新簽名
```

- **狀態轉移 10 Hz**（`decide` 節拍，與意圖仲裁同頻）
- **執行 240 Hz**
- 熱路徑零配置，不使用 `Math.random`
- **不動** `rules.ts` 的 `arbitrate`、**不動** `command.ts`

### 9.1 早退路徑也要推進戰術層

`AiController.update` 在**沒有目標時早退**，而且早退發生在態勢與規則更新之前
（`AiController.ts:338`）。若 `stepTactics` 只插在 `evaluateEnergy` 附近，
「目標消失 → `off`」永遠不會執行，下一個目標會繼承上一個目標留下的狀態。

**做法**：`stepTactics` 的「強制離場」判定（§5.2 第 1 級）放在 `update`
**最前面**，與 AI 點放的時鐘推進同一個位置、同一個理由。

### 9.2 rematch 的狀態重置契約

`resetBattle` **保留絕大多數既有的 `AiController` 實體**，只重建曾被玩家接手
過的那幾顆（`setup.ts:975`、`setup.ts:995`）。所以 FSM 的相位、計時、輪次、
`cooldown` 與上一個目標**會跨場殘留**。

**做法**：`AiController` 提供 `resetTactics()`，`resetBattle` 對每一顆
`AiController` 呼叫一次。這是 `src/battle/` 的第二個改動（第一個是
`protectedMask`），兩者都不違反「`src/ai/` 不 import `src/battle/`」。

### 9.3 集火期間關掉戰術層

專案負責人 2026-08-22 裁定。理由是量出來的（§1.5）：集火期間質心距離中位只有
233–1032 m，而戰術層的建能佔位在 2 km 以外；重疊只佔 5–12% 的取樣。

被否決的替代方案是「戰術層照跑但目標鎖死成 `focusTarget`」——它要引進新語意
與新的邊界情況。**關掉錯了可以無痛升級成鎖目標，鎖目標錯了要拆語意。**

### 9.4 AI 代飛照開

專案負責人 2026-08-22 裁定。人接手時掛的是 `PlayerController`，結構上就沒有
戰術層——與 AI 點放「代飛結束要改回來」是同一個機制。

## 10. 驗收

### 10.1 通用性表（負責人指定）

七張卡 × 每個機型，同一組參數，逐格列出：`engage` 佔時、`extend` 佔時、
比能量差、與最近敵機距離、射擊窗形成率。

**「戰鬥機對轟炸機」是獨立的一格**，不能靠無因次化直接宣告成立（§3.1）。

**通過門檻**：五個種子、每格取中位數；任何一格的退步不得超過該格在五個種子
上的全距。**先跑一次 `quota = 0` 的五種子表當雜訊帶**——那是「什麼都沒改」的
分散度，比任何憑空訂的百分比誠實。

### 10.2 主判準

| 量 | 現況（攔截卡的 109） | 期望方向 |
|---|---|---|
| `engage` 佔時 | 2.2%（掃蕩卡同批 AI 是 28.3%） | 上升 |
| 與最近敵機距離 | 3,642 m | 下降 |
| `extend` 期間航跡角 | +6.5° | 下降或翻負 |
| 單輪能量帳 | 不存在 | 淨值不為負 |

### 10.3 `extend-payoff` 探針

2026-08-22 的基準（20v20、420 秒、VETERAN）：

```
開局        段數   越撤越糟   補到門檻才走   收益中位
4000/200    662     38.7%       48.9%        +0.012
5500/150    481     33.9%       47.8%        +0.036
```

**只有「越撤越糟」是這份 spec 的判準。**「補到門檻才走」低是因為被 `defend`
插隊（離開後 53–58% 接 `defend`），那是 §2 明確不做的那一項。

### 10.4 兩支重播護欄要分開處理

**`test/integration/rematch.test.ts` 不是逐位元重播**（先前的 spec 寫錯了）。
它測的是換設定、戰績隔離與十場效能（`rematch.test.ts:19`）。**所以專案目前
沒有「同設定跑兩次、結果相同」的直接護欄**——這份改動要補一支。

**`test/integration/order-of-battle-replay.test.ts` 是 SHA-256 digest 比對**
（`order-of-battle-replay.test.ts:47`），拿 30 秒的結果對固定基準。
**`quota = 0.5` 在 2500 m 外立刻改變部分 AI 的行為，那個 digest 必然改變。**

這**不是**「無關的既有紅燈」，而是一次**基準重跑**——**要專案負責人裁定**。
順序是：先做完 §12.3 的 `quota = 0` 等價測試（證明關掉時逐位元不變），再帶
著「改動確實只在 `quota > 0` 時生效」的證據去要求重跑基準。

### 10.5 不量勝率

先證明循環跑得起來，才值得放進 20v20 與人工試飛。勝率把十幾個機制的效果混在
一個數字裡。

### 10.6 既有護欄

三條既有的紅測試（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）不動。

`test/integration/ai-targeting.test.ts` 的 `rearShare` / `fireShare` /
`onNose` 可能被動到。**紅了先量、先報告、先問**——護欄重新定值是專案負責人
的決定。

`test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts` 必須單獨跑。

## 11. 起始值

**全部是起始值，待掃描。**

| 參數 | 起始值 | 來源 |
|---|---|---|
| `quota` | 0.5 | 一半的人打 boom and zoom |
| `enterRange` | 2500 | `FLANK_RANGE`，既有常數 |
| `exitRange` | 1500 | `focusRange`，既有常數 |
| `perchEnter` | 0.50 | 見 §11.1 |
| `perchExit` | 0.35 | 遲滯，`perchEnter` 的七成 |
| `minDwell` | 0.5 s | `rules.ts` 同名參數的數量級 |
| `commitSeconds` | 1.5 s | 比 `VETERAN` 的反應延遲 0.3 s 大一個數量級 |
| `buildMax` | 60 s | 見 §11.2 |
| `perchMax` | 20 s | `buildMax` 的三分之一——等待不該比建能久 |
| `passSeconds` | 1.0 s | 通過目標的判定，比 `commitSeconds` 短 |
| `diveMax` | 12 s | 進場沒打到也要拉起 |
| `zoomMin` | 4 s | 拉起至少要這麼久才算一次 zoom |
| `zoomMax` | 15 s | 拉不上去就別拉了 |
| `cooldownSeconds` | 12 s | 一個 `extend` 段的 p90（實測 25 s）的一半 |
| `longCooldownSeconds` | 30 s | `cooldownSeconds` 的 2.5 倍 |
| `cycleLossMax` | 0.30 | `perchEnter` 的六成 |
| `dryRounds` | 2 | 兩輪沒打到就是這個戰術對這個對手無效 |
| `perchRange` | 2000 m | 在 `enterRange` 與 `exitRange` 之間 |
| `pressureRange` | 2000 m | 同上 |

### 11.1 `perchEnter` 的推導與它的極限

要俯衝到比 P-51 快一成，109 需要約 630 m 的高度盈餘。109 在 6000 m 的角落
速度取 160 m/s，能量尺標 `vc² / 2g = 160² / 19.61 ≈ 1305 m`，於是
`630 / 1305 ≈ 0.48`。取 0.50。

**這個推導的三個限制要寫明**：

- 只用了 Bf 109 對 P-51、6000 m、單一角落速度。**不能自動外推**到 P-51 對
  109 或戰鬥機對轟炸機。
- 假設高度可以無損換成速度，沒有計入俯衝阻力。
- 沒有計入目標同時在加速／爬升，也沒有計入進場轉向本身要耗掉的能量。

所以它是**量級合理的起點**，不是通用值。§11.3 把它列為第二優先掃描。

### 11.2 `buildMax` 的推導改用比超量功率

**先前的推導（用 109 的海平面爬升率反推 630 m 要爬多久）是錯的。** 它把
「爬升 630 m」與「同時加速」當成兩份可以相加的收益，但高度與速度是**同一份
比能量**的分配——最大爬升率已經是動力剩餘的結果，邊爬邊加速不會憑空多出
第二份能量。

正確的量是雙方比超量功率之差，而 `Situation` 本來就同時提供兩者
（`assess.ts:41`、`assess.ts:251`）：

```
d(energyAdvantage)/dt = psSelf − psTarget
```

用自己的爬升率推相對建能時間會**系統性低估**——敵人同時也在累積能量。

**做法**：起始值先取 60 s（比先前的 45 s 寬），並在第一支探針裡**直接量**
`psSelf − psTarget` 的實際分布，用量到的值回填。這是「先量再訂」而不是
「先訂再掃」，因為這個量本來就在態勢裡，不必猜。

**先前版本的內部矛盾也一併修掉**：舊的 `buildRateMin = 0.01/s` 建到
`perchEnter = 0.50` 要 50 秒，超過舊的 `buildMax = 45 s`——一架「剛好合格」的
飛機必然超時。§7.1 已經拿掉建能率那一條，矛盾隨之消失。

### 11.3 掃描優先序

1. `quota`（0 / 0.5 / 1）——它同時是消融
2. `buildMax` 與 `perchEnter`——兩者一起決定「循環跑不跑得完一輪」。
   `buildMax` 用 §11.2 的量測回填而不是掃描
3. `commitSeconds` 與 `perchMax`——決定「等太久」與「出手太早」的平衡
4. 其餘的只在實測顯示它們卡住某件事時才掃

**不掃**：`enterRange` / `exitRange`（沿用既有常數）。

## 12. 測試

### 12.1 純函數（`test/unit/ai-tactics.test.ts`）

- 六個狀態的轉移逐條
- **§5.2 的優先序逐條**：同時成立時誰贏
- **閂鎖不震盪**：`energyRatio` 在 `perchEnter` 與 `perchExit` 之間來回 100
  次，狀態不得翻超過一次
- **`perchLatch` 是獨立記憶**：在 `dive` / `zoom` 期間也持續更新
- **`minDwell` 生效**
- **§7.0 的重置表逐欄**，特別是「換目標後承諾計時歸零」那條誤判
- **§5.4 的再進入條件**：同一個目標、同樣的能量，`cooldown` 之後不會立刻
  重進 `build`
- **`quota = 0` 時 `stepTactics` 恆回 `off`**
- **`selfIndex < 0` 時恆回 `off`**（負數取模的陷阱）
- **隊內序號的配額對稱**：6v6 與 14v14 兩隊拿到相同的名額數

### 12.2 方向修正（`test/unit/extend-direction.test.ts`，新建）

【檔名刻意不叫 `extend-pitch`】`test/tools/extend-pitch.probe.ts` 已經存在，
同名會讓「哪一個是護欄、哪一個是量測」變得要看目錄才分得出來。

- 化簡等價：`max(...)` 恆等於 `(max(Vc, Vt) − Vs) / Vc`
- `speedAdvantage` 極負時**恆為低頭**，不管 `cornerRatio` 多高
- `speedAdvantage = 0` 時與改動前**逐位元相同**（那是 `foeDeficit = 0`，
  只有 `selfDeficit < 0` 時才有差；這一條要把兩種情形都列）
- 兩者都是盈餘時才爬升
- 離地餘裕那一項不受影響
- **§4.4 的三類反例各一條**：近距離高速交叉、同向追逐、戰鬥機對轟炸機。
  這三條**記錄行為**而不是斷言好壞——它們的作用是讓下一個人看到取捨。

### 12.3 `quota = 0` 的整合級等價（`test/integration/tactics-off.test.ts`）

**單元測試不夠。** `stepTactics` 恆回 `off` 只證明純函數，證不了
`AiController` 整體逐位元不變——新增的 `Situation` 欄位、覆寫的順序、早退
路徑的推進都在函數之外。

**而且不能拿改動前的基準比。** §4 的方向修正對**所有** AI 生效、不受
`quota` 控制（它是一個錯誤的修正，不是戰術層的一部分），所以 `quota = 0`
必然與改動前不同。

**要兩個基準，分兩次裁定**：

```
BASE    改動前                          既有
BASE'   只做 §4 方向修正                ← 第一次重跑，要裁定
        戰術層上線、quota = 0           必須逐位元等於 BASE'
        戰術層 quota = 0.5              預期不同，不比 digest
```

這個順序讓兩件事的影響分得開：第一次重跑的 diff 全部歸因於方向修正，
第二次「沒有 diff」證明戰術層關掉時真的關乾淨了。

### 12.4 同設定雙跑（`test/integration/replay-determinism.test.ts`，新建）

專案目前沒有這條護欄（§10.4）。同一組設定、同一個種子跑兩次，digest 必須
相同。`quota = 0.5` 也要跑——那才驗得到戰術層本身的決定性。

### 12.5 整合（`test/integration/ai-tactics.test.ts`，新建）

- 攔截卡跑 150 秒，戰術層開／關，`engage` 佔時與距離的方向
- **一輪能跑完**：至少有一架完成過 `build → perch → dive → zoom → build`
- **rematch 之後狀態乾淨**（§9.2）

### 12.6 探針

- `test/tools/energy-cycle.probe.ts`（新建）：單輪能量帳、攻擊生命週期、
  以及 §11.2 要回填的 `psSelf − psTarget` 分布
- `test/tools/tactics-ablation.probe.ts`（新建）：`quota` 三檔 × 七張卡 ×
  五種子
- `test/tools/extend-payoff.probe.ts`（既有）：改動前後對照

### 12.7 不寫的測試

- **不寫勝率的測試。**
- **不為起始值寫測試**——它們是待掃描的旋鈕，寫測試等於把旋鈕焊死。

## 13. 已知後果

- **`quota = 0.5` 時半數 AI 的行為會明顯不同。** 這是設計。
- **戰術層會讓部分 AI 在開局的前一分鐘不接戰**（`build`）。這是 boom and
  zoom 的定義性代價，也是 §7 四道止損存在的理由。
- **`order-of-battle-replay` 的 digest 必然改變**（§10.4）。這是一次要負責人
  裁定的基準重跑，不是一條可以忽略的紅燈。
- **`§4` 的方向修正對所有 AI 生效，不受 `quota` 控制。** 它不是戰術層的一
  部分，是一個錯誤的修正。所以 `quota = 0` 的等價測試要**在方向修正之前**
  先跑一次基準，兩件事的影響才分得開。
