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

**判準一律寫成無因次的相對量**，用**自己的角落速度**當分母。這樣同一個數字
對 109 對 P-51、P-51 對 109、109 對 B-17 全部成立，不必分機型。

`cornerRatio` 的病根不是「它是絕對值」——它已經是無因次的——而是**它自我
參照**（TAS ÷ 自己的角落速度，看不到敵人）。替代量同樣無因次，但看的是兩者
的**關係**。

情境同理：判準是幾何與能量的函數，不是任務類型的函數，所以七張卡自動生效。

`Situation.cornerRatio` 的欄位註解自己就寫著這個區分：

> `energyAdvantage`（相對比較）仍然用比能量，**那是對的用法**。

程式碼早就知道要分開，`extendPitchAngle` 只是拿錯了那一個。

**退路**：§10 的驗收要逐機型、逐卡片列出同一組參數的表現。若真的找不到共用
值，才退到分開定義，而且那時候它是負責人的裁定。

## 4. 方向修正

### 4.1 `Situation` 加兩個無因次欄位

兩者都在 `evaluateEnergy` 裡算，那裡已經有雙方的 TAS 與各自的角落速度，
成本接近零。**分母與 `cornerRatio` 是同一個**——那是既有紀律。

```ts
/**
 * （我的 TAS − 他的 TAS）÷ **我的**角落速度。正 = 我比較快。
 */
speedAdvantage: number

/**
 * `energyAdvantage` ÷ 我的角落速度動能高度（vc² / 2g）。正 = 我能量多。
 */
energyRatio: number
```

`vc² / 2g` 是「把角落速度的動能全部換成高度會有多高」，是這架飛機在這個
高度的天然能量尺標。用它正規化之後，`energyRatio = 0.5` 對任何機種都是
「我比他多半個角落速度的能量」。

### 4.2 `extendPitchAngle` 換算式

```ts
const selfDeficit = 1 - cornerRatio        // 相對自己（現行）
const foeDeficit = -speedAdvantage         // 相對敵人（新增）
const speedDeficit = selfDeficit > foeDeficit ? selfDeficit : foeDeficit
const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * altitudeDeficit
```

**沒有新參數，沒有距離門檻。** `max` 有折點但沒有翻號，所以不會產生
`extendPitchAngle` 註解裡記的那個極限環（舊版用兩個裸門檻決定爬或衝，跨線
瞬間翻號，在 1000 m 線上震盪 40 秒）。

代進 §1.3 的實測值：

```
局面          selfDeficit   foeDeficit   max 取誰   結果
遭遇戰 585m      +0.11        +0.03      self      低頭（與現行相同）
撤離   193m      +0.15        +0.02      self      低頭（與現行相同）
掃蕩  1595m      -0.04        +0.04      foe       小幅低頭（現行是小幅爬升）
攔截  3642m      -0.59        +0.19      foe       低頭（現行是滿舵爬升 25°）
```

**近距離自動維持現行行為**（纏鬥中自我赤字主導），**遠距離自動翻正**（那裡
相對赤字主導）。這個性質不是設計出來的，是兩個量各自的物理意義帶來的。

### 4.3 簽名

```ts
export function extendPitchAngle(
  cornerRatio: number,
  speedAdvantage: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number
```

呼叫端只有 `steer.ts` 內部一處。`test/tools/extend-pitch.probe.ts` 與
`test/tools/climb-blame.probe.ts` 要跟著改（它們是探針不是測試）。**沒有任何
單元測試直接呼叫它**，已查證。

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

循環是 `build → perch → dive → zoom → build`；`cooldown` 是止損出口，
結束後回 `off`（下一個決策節拍重新判斷能不能進 `build`）。

### 5.1 轉移一律走閂鎖，不得有裸門檻

`rules.ts` 已經有 `latch(active, value, enter, exit)`，`Intent` 那六個狀態
就是靠它加 `minDwell` 才沒有震盪。戰術層照抄，理由與 §4.2 引的那次極限環
完全相同：**FSM 本質上就是「用門檻決定爬或衝」**。

每個狀態有最短停留 `minDwell`，`cooldown` 除外（它自己就是計時的）。

### 5.2 逐條轉移

| 從 | 到 | 條件 |
|---|---|---|
| `off` | `build` | 有名額 && `order === null` && `!transit` && 有目標 && `range` 閂鎖在「遠」 |
| `build` | `perch` | `latch(energyRatio, perchEnter, perchExit)` 為真 |
| `build` | `cooldown` | 建能期限或建能率止損（§7.1） |
| `perch` | `dive` | 目標承諾姿態閂鎖為真，**或**待機期限到，**或**任務壓力（§7.2、§7.3） |
| `perch` | `build` | 閂鎖掉回 `perchExit` 之下——能量花掉了就回去再存，不是止損 |
| `dive` | `zoom` | 射擊窗結束：`closureRate` 由正轉負持續 `passSeconds` |
| `dive` | `zoom` | `diveMax` 到期。**進場沒打到也要拉起**，否則它會退化成一路追擊 |
| `zoom` | `build` | `zoomMin` 已過，且（`energyRatio` 回到 `perchExit` 或 `zoomMax` 到期） |
| 任何 | `off` | 收到命令、`transit`、目標消失、名額被取消 |
| `cooldown` | `off` | 計時歸零 |

**距離閘門只在 `off → build`。** 進了循環之後不再受距離限制——否則 `dive`
一貼近就掉出戰術層，`zoom` 永遠做不出來。

進入用 `FLANK_RANGE`（2500）、離開用 `focusRange`（1500）。**直接用指揮層
已經在用的那一對**，免費得到遲滯，也不發明第二套幾何。

### 5.3 「承諾姿態」怎麼判

boom and zoom 的 `dive` 不能只看「目標很慢」——慢也可能是在閃躲。要看**持續**
的承諾：

- `psTarget < 0`：他在耗能量（拉桿或爬升）
- 這個條件連續成立 `commitSeconds`

`Situation.psTarget` 已經存在。**刻意不加第三個訊號**（例如「他的機首指向被
保護單位」）：那需要目標的姿態與被保護單位的位置，兩者都拿得到，但每加一個
訊號就多一組要掃描的參數。先用最少的訊號量，不夠再加——這是專案的既有紀律。

## 6. 每個狀態怎麼飛

**一半復用既有的意圖，不重寫。**

| 狀態 | 飛法 |
|---|---|
| `build` / `perch` / `zoom` | `tacticalCommand`（新的瞄準解，§6.1） |
| `dive` | **強制 `intent = 'engage'`**。俯衝進場之後就是普通交戰，只是帶著能量。不需要新的轉向邏輯 |
| `cooldown` | **強制 `intent = 'extend'`**。「劣勢止損」正是它的語意；§4 修完方向之後這個復用是對的 |
| `off` | 一個字都不改，現行行為 |

`defend` 永遠可以插隊——與命令層「閃躲永遠優先」是同一條紀律（專案負責人
2026-08-07 裁定）。實作上：戰術層的覆寫排在 `defend` 判定**之後**。

### 6.1 `tacticalCommand`

```ts
export function tacticalCommand(
  state: TacticalPhase,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  seaHeight: number,
  cfg: TacticalConfig,
  out: RawCommand,
): void
```

三個狀態的瞄準：

- `build`：航跡角取正，大小由 `energyRatio` 的赤字連續決定（與
  `extendPitchAngle` 同構），水平分量取**遠離目標**的方向。
- `perch`：航跡角取 0（保持能量），水平分量繞著目標保持 `perchRange` 的
  距離——不遠離（否則跟丟）也不接近（否則被拖進纏鬥）。
- `zoom`：航跡角取正且大，水平分量維持當前航向（拉起，不轉彎——轉彎會把
  剛換到的速度花掉）。

**必須自己補拉桿紀律**：`tacticalCommand` 繞過 `steerCommand`，那一層的
`shrinkTowardNose(self, pullCeiling, aim)` 對它無效。這是早退路徑踩過的坑
（見 `AiController` 那段長註解），修法現成。

安全層（`applySafety`）排在最後，撞地與失速的硬接管照舊有最終決定權。

## 7. 四道止損

「AI 一直爬高不打仗」是這種機制最經典的死法，而且會讓 20v20 變成一場沒有人
接戰的爬升比賽。四道止損全部是**量化的**，而且**零跨層改動**。

### 7.0 目標切換會讓兩個計量跳掉

`energyRatio` 與 `speedAdvantage` 都是**相對當前目標**的。目標一換，兩者
不連續地跳到另一個值——而 §7.1 的建能率與 §7.4 的能量帳都是**差分**，
跳變會被讀成「這一秒暴漲 0.4」或「這一輪淨損 0.6」。

**做法**：`stepTactics` 收目標的識別（`selectTarget` 回傳的那一架），與上一
節拍不同時**重置建能率視窗與該輪的能量帳基準**，狀態本身不重置。

【為什麼不重置狀態】換目標是常態（實測持有中位只有幾秒），跟著重置等於這個
戰術層永遠跑不完一輪。跳掉的是**計量**，不是決定。

【為什麼不改用絕對的比能量】那就回到 `cornerRatio` 的老問題——絕對量看不到
「我比敵人如何」，而那正是這份 spec 要修的東西。

### 7.1 建能期限

`build` 停留超過 `buildMax`，**或**近 `buildRateWindow` 秒內 `energyRatio`
的累積速率低於 `buildRateMin` → `cooldown`。

第二個條件治的是「爬不動了還在爬」：升限附近、被拖住、或機體本來就沒有那個
爬升率。

### 7.2 待機期限

`perch` 停留超過 `perchMax` → **強制 `dive`**，不是 `cooldown`。

已經有能量了就該用掉。這一道保證「不會無限等待」，也是 §5.3 只用一個承諾
訊號的安全網——承諾判準再怎麼保守，也有一個時限強制出手。

### 7.3 任務壓力

被保護單位正在挨打時，立刻 `dive`，不等承諾姿態。

**零跨層改動**：`TargetBoard.candidates` 含**全隊**（消費端用 `team` 欄位
過濾），而 `priority[i] > 1` 已經標出被保護的那幾架
（`setup.ts`：`priority[seat] = cfg.tuning.convoyPriority`，不分隊）。
所以「我方的被保護單位」= `candidates` 裡 `team === self.team && priority > 1`
的那些。

判準：最近的敵機到最近的我方被保護單位的距離 < `pressureRange`。

非護送關卡的 `convoyPriority` 是 1，所以這道止損在遭遇戰／掃蕩自動不作用
——正確而且免費。

成本：10 Hz × 40 架 × 40 個候選的掃描，與 `selectTarget` 同一個數量級。

### 7.4 能量帳

一輪 = `build` 進入到下一次 `build` 進入。記兩件事：

- 該輪的 `energyRatio` 淨變化。低於 `−cycleLossMax` → `cooldown`
- 該輪有沒有形成過射擊窗（`shotInstant > 0` 出現過）。連續 `dryRounds` 輪
  沒有 → **長 `cooldown`**（`longCooldownSeconds`）

第二條治的是「循環跑得順但打不到人」——那時候問題不在戰術層，硬跑只是浪費。

## 8. 配額

```
(selfIndex × 黃金比) mod 1 < quota
```

固定分配、零協調、**逐位元重播友善**、熱路徑零配置。與砲塔點放的相位錯開
（`ROOT3` / `SILVER`）同一個手法，乘子取黃金比與那兩個互為無理數比，三件事
才不會縮成一件。

- `quota = 0` → **完全關掉戰術層**，消融表的對照組免費得到。與
  `burstConfig.off = 0` 同一個手法。
- `quota = 1` → 全員參與。

固定分配的副作用是史實的：一場裡有些人打 boom and zoom、有些人纏鬥。

### 8.1 隊間偏差已經算過

`selfIndex` 由 `world.add` 的順序給，而編組表是**一隊一個連續區塊**
（`order.ts` 先推藍隊的全部小隊、再推紅隊）。所以「某一隊系統性拿到比較多
名額」是一個真實的風險——它會直接變成平衡偏差，而且沒有任何測試會紅。

實際算過（黃金比 = 0.6180339887…）：

```
quota   遭遇 20v20 藍   紅      攔截 10 藍   紅 8    撤離 4 藍   紅 16
0.25       0.300      0.300      0.300    0.250     0.500     0.250
0.50       0.500      0.550      0.500    0.500     0.500     0.500
0.75       0.800      0.750      0.800    0.750     0.750     0.812
```

**起始值 0.5 在每一種編制上的偏差都是 0 或 0.05**，可以接受。

**但 `quota = 0.25` 在四架的小隊上會給到 0.5**（顆粒度 = 1/4，任何非四分之
一的 quota 都會落在格子之間）。所以 §10.4 的消融表**只能比 0 / 0.5 / 1
三列**；要掃更細的 quota 時必須逐隊列出實際比例，不能假設它等於設定值。

**為什麼不做動態名額**（例如「同時最多 N 架在 build」）：那需要跨機協調，
而協調要嘛走指揮層（§2 明確不做），要嘛在戰機端維護全域計數（會產生一個
必須每步同步的幽靈狀態，`stepCommandLayer` 的 `playerFlight` 註解記著為什麼
推導比鏡射安全）。

## 9. 檔案與分頻

```
src/ai/tactics.ts        新檔。TacticalPhase / TacticalState / TacticalConfig
                         DEFAULT_TACTICS / createTacticalState / stepTactics
                         tacticalCommand。全部純函數，狀態集中在 AiController
src/ai/assess.ts         Situation 加 speedAdvantage、energyRatio
                         （evaluateEnergy 內算）
src/ai/steer.ts          extendPitchAngle 換簽名（§4.3）
src/ai/AiController.ts   戰術狀態欄位、10 Hz 推進、覆寫（與命令層同型）
                         tacticalConfig 可注入（掃描與消融用）
```

- **狀態轉移 10 Hz**（`decide` 節拍，與意圖仲裁同頻）
- **執行 240 Hz**（`tacticalCommand` 與轉向同頻）
- 熱路徑零配置，不使用 `Math.random`
- **不動** `rules.ts` 的 `arbitrate`、**不動** `command.ts`、**不動**
  `src/battle/`

覆寫的位置與命令層完全同型（`AiController` 裡的外部覆寫，不插進仲裁表）：

```
1. safety        撞地／失速硬接管        最後執行
2. transit       無條件飛完航程          戰術層讓位
3. rally/flank   intent 強制 'rally'     戰術層讓位
4. focus         持有時戰術層退到 off    §9.1
5. defend        破防閂                  戰術層讓位
6. 戰術層        build/perch/dive/zoom/cooldown
7. arbitrate     engage/merge/extend/approach
```

### 9.1 集火期間關掉戰術層

專案負責人 2026-08-22 裁定。理由是量出來的（§1.5）：集火期間質心距離中位
只有 233–1032 m，而戰術層的建能佔位在 2 km 以外；兩個分布的重疊
（1500–2500 遲滯帶）只佔 5–12% 的取樣。代價幾乎是零，而做法只是一行條件。

被否決的替代方案是「戰術層照跑但目標鎖死成 `focusTarget`」——它要引進「集火
決定打誰、戰術決定怎麼打」這條新語意，而那條語意需要自己的測試與邊界情況
（`focusTarget` 陣亡的那一格戰術層在哪個狀態？）。**關掉錯了可以無痛升級成
鎖目標，鎖目標錯了要拆語意。**

### 9.2 AI 代飛照開

專案負責人 2026-08-22 裁定：代飛（`I` 鍵）與上帝視角時座位上是
`AiController`，戰術層跟一般 AI 一樣開。

人接手時掛的是 `PlayerController`，結構上就沒有戰術層——與 AI 點放
「代飛結束要改回來」是同一個機制（換的是控制器參考，不是一段要維護的程式碼）。

## 10. 驗收

### 10.1 通用性表（負責人指定）

七張卡 × 每個機型，同一組參數，逐格列出：`engage` 佔時、`extend` 佔時、
比能量差、與最近敵機距離、單輪能量帳、射擊窗形成率。

**判準**：沒有任何一格因為戰術層而變差超過雜訊。找不到共用值時才退到分機型
定值，而且那是負責人的裁定。

### 10.2 主判準

| 量 | 現況（攔截卡的 109） | 期望方向 |
|---|---|---|
| `engage` 佔時 | 2.2%（掃蕩卡同批 AI 是 28.3%） | 上升 |
| 與最近敵機距離 | 3,642 m | 下降 |
| `extend` 期間航跡角 | +6.5° | 下降或翻負 |
| 單輪能量帳 | 不存在 | 淨值不為負 |

### 10.3 `extend-payoff` 探針的三個數字

`test/tools/extend-payoff.probe.ts` 已經存在，2026-08-22 的基準：

```
開局        段數   越撤越糟   補到門檻才走   收益中位
4000/200    662     38.7%       48.9%        +0.012
5500/150    481     33.9%       47.8%        +0.036
```

**只有「越撤越糟」是這份 spec 的判準。** 「補到門檻才走」低是因為被 `defend`
插隊（離開後 53–58% 接 `defend`），那是 §2 明確不做的那一項。

### 10.4 消融

`quota` = 0 / 0.5 / 1 三列，跨七張卡。`quota = 0` 必須與上線前**逐位元
相同**——這一條要有單元測試釘住，否則整張消融表的對照組是錯的
（`test/unit/ai-burst.test.ts` 的 `off = 0` 那一條是先例）。

### 10.5 不量勝率

先證明循環跑得起來（存高度 → 換進場速度 → 一輪後拉離 → 期限內回到下一輪），
才值得放進 20v20 與人工試飛。這是 Codex 的建議，理由是勝率把十幾個機制的
效果混在一個數字裡。

### 10.6 護欄

既有的三條紅測試（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）是既有
的，不動。

`test/integration/ai-targeting.test.ts` 的 `rearShare` / `fireShare` / `onNose`
可能被動到。**紅了先量、先報告、先問**——護欄重新定值是專案負責人的決定。

`test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts` 必須單獨
跑。後者是逐位元重播，戰術層的任何非決定性都會被它抓到。

## 11. 起始值

**全部是起始值，待掃描。** 掃描的優先序見 §11.1。

| 參數 | 起始值 | 來源 |
|---|---|---|
| `quota` | 0.5 | 一半的人打 boom and zoom |
| `enterRange` | 2500 | `FLANK_RANGE`，既有常數 |
| `exitRange` | 1500 | `focusRange`，既有常數 |
| `perchEnter` | 0.50 | 見下方推導 |
| `perchExit` | 0.35 | 遲滯，`perchEnter` 的七成 |
| `minDwell` | 0.5 s | `rules.ts` 同名參數的數量級 |
| `commitSeconds` | 1.5 s | 比 `VETERAN` 的反應延遲 0.3 s 大一個數量級 |
| `buildMax` | 45 s | 見下方推導 |
| `buildRateWindow` | 10 s | `buildMax` 的四分之一 |
| `buildRateMin` | 0.01 /s | 10 秒內至少要漲 0.1 個 `energyRatio` |
| `perchMax` | 20 s | `buildMax` 的一半以下——等待不該比建能久 |
| `passSeconds` | 1.0 s | 通過目標的判定，比 `commitSeconds` 短 |
| `diveMax` | 12 s | 進場沒打到也要拉起。比 `cooldownSeconds` 略短 |
| `zoomMin` | 4 s | 拉起至少要這麼久才算一次 zoom |
| `zoomMax` | 15 s | 拉不上去就別拉了 |
| `cooldownSeconds` | 12 s | 約一個 `extend` 段的 p90（實測 25 s）的一半 |
| `longCooldownSeconds` | 30 s | `cooldownSeconds` 的 2.5 倍 |
| `cycleLossMax` | 0.30 | `perchEnter` 的六成 |
| `dryRounds` | 2 | 兩輪沒打到就是這個戰術對這個對手無效 |
| `perchRange` | 2000 m | 在 `enterRange` 與 `exitRange` 之間 |
| `pressureRange` | 2000 m | 同上 |

**`perchEnter` 的推導**：要俯衝到比 P-51 快一成，109 需要約 630 m 的高度
盈餘。109 在 6000 m 的角落速度取 160 m/s，能量尺標
`vc² / 2g = 160² / 19.61 ≈ 1305 m`，於是 `630 / 1305 ≈ 0.48`。取 0.50。

**`buildMax` 的推導**：109 的海平面爬升率 1150 m/min ≈ 19 m/s，高空打對折
取 10 m/s。爬 630 m 需要 63 秒，但建能同時也在加速（`energyRatio` 兩項一起
漲），所以取 45 秒。**這是三個假設疊起來的數字，掃描時優先掃它。**

### 11.1 掃描優先序

1. `quota`（0 / 0.25 / 0.5 / 1）——它同時是消融
2. `perchEnter` 與 `buildMax`——兩者一起決定「循環跑不跑得完一輪」，
   而且它們的起始值各自疊了兩三個假設
3. `commitSeconds` 與 `perchMax`——決定「等太久」與「出手太早」的平衡
4. 其餘的只在實測顯示它們卡住某件事時才掃

**不掃**：`enterRange` / `exitRange`（沿用既有常數，動它等於發明第二套幾何）。

## 12. 測試

### 12.1 純函數（`test/unit/ai-tactics.test.ts`）

- 六個狀態的轉移逐條
- **閂鎖不震盪**：把 `energyRatio` 停在 `perchEnter` 與 `perchExit` 之間
  來回 100 次，狀態不得翻超過一次
- **`minDwell` 生效**：任何狀態的停留不得短於 `minDwell`
- 四道止損各一條
- **`quota = 0` 時 `stepTactics` 恆回 `off`**（§10.4 的對照組）

### 12.2 方向修正（`test/unit/extend-direction.test.ts`，新建）

【檔名刻意不叫 `extend-pitch`】`test/tools/extend-pitch.probe.ts` 已經存在，
同名會讓「哪一個是護欄、哪一個是量測」變得要看目錄才分得出來。

- `speedAdvantage` 極負（我比敵人慢很多）時**恆為低頭**，不管 `cornerRatio`
  多高
- `cornerRatio < 1` 且 `speedAdvantage` 接近 0 時，與改動前**逐位元相同**
- 兩者都是盈餘時才爬升
- 離地餘裕那一項不受影響（`altitudeDeficit` 的行為一個字不動）

### 12.3 整合（`test/integration/ai-tactics.test.ts`，新建）

- 攔截卡跑 150 秒，戰術層開／關，`engage` 佔時與距離的方向
- **一輪能跑完**：至少有一架完成過 `build → perch → dive → zoom → build`

### 12.4 探針

- `test/tools/energy-cycle.probe.ts`（新建）：單輪能量帳與攻擊生命週期
- `test/tools/tactics-ablation.probe.ts`（新建）：`quota` 三列 × 七張卡
- `test/tools/extend-payoff.probe.ts`（既有）：改動前後對照

### 12.5 不寫的測試

- **不寫勝率的測試**。見 §10.5。
- **不為起始值寫測試**。它們是待掃描的旋鈕，寫測試等於把旋鈕焊死。

## 13. 已知後果

- **`quota = 0.5` 時半數 AI 的行為會明顯不同**。這是設計，不是缺陷。
- **戰術層會讓部分 AI 在開局的前 45 秒不接戰**（`build`）。20v20 的前
  一分鐘會比現在安靜。這是 boom and zoom 的定義性代價，也是 §7 四道止損
  存在的理由。
- **`rematch` 的逐位元重播是最嚴格的護欄**。戰術層的任何非決定性（例如用
  `Math.random` 錯開、或依賴 `Map` 的迭代順序）都會被它抓到。
- **`order-of-battle-replay` 那兩條既有的紅測試**與這份改動無關，但改完要
  確認它們的紅法沒有變化。
