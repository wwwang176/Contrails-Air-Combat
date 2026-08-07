# 指揮 AI 第一份：指令通道與集合點

**日期**：2026-08-07
**前置**：`docs/prompt.md` 把敵機 AI 分成指揮／戰機兩層，戰機層已完成
（M4~M11）。`2026-08-04-m6-formation-wingman-design.md` §「不做的」明確把
「指揮 AI（集合點、分隊級戰術指令）」切到下一份 spec —— 就是這一份。

---

## 1. 範圍

### 1.1 指揮 AI 切成三份

需求書列的是「集合點規劃 + 五個戰術指令（火力壓制、側翼、集火、慢速脫離、
撤退）」。實際看下來，**集合點是骨幹**，五個戰術裡有三個本質上只是
「集合點放哪裡」：

| 戰術 | 其實是什麼 |
|---|---|
| 側翼 | 集合點放在敵群的左右舷 |
| 慢速脫離 | 集合點放在戰鬥範圍外 |
| 撤退 | 集合點放得更遠，而且不回頭 |
| 集火 | **不是位置，是目標** —— `wingman.ts` 已有 `LEVEL_FOCUS`，只是範圍限於 Rotte 內 |
| 火力壓制 | 也不是位置，是「維持接觸、不求擊落」的交戰方式 |

需求書自己也是這個講法：「指揮 AI 要看飛機狀態評估是否將**集合點設定在
戰鬥範圍外**來脫離戰鬥」。

因此切成：

1. **本份：指令通道與集合點。** 造出指揮物件、命令的生命週期、戰機 AI
   學會執行命令、優先序談清楚。指揮邏輯**刻意只有一條規則**。
2. **第二份：戰術庫。** 側翼、慢速脫離、火力壓制、集火。
3. **第三份：指揮決策。** 什麼時候該下哪一個 —— 能量、人數比、任務目標。

**分開的理由是每一份都能獨立驗收。** 混在一起的話，「第三份挑錯戰術」與
「第二份戰術寫壞」在數據上分不出來，而兩者的修法完全不同。

### 1.2 本份不做的

側翼、集火、火力壓制、慢速脫離（第二份）；指揮決策的多樣化（第三份）；
玩家收命令與 HUD 呈現；命令的重規劃；跨小隊協同；非戰鬥機單位。

---

## 2. 已經裁定的四件事

以下四條由專案負責人 2026-08-07 裁定，是本份設計的前提。

### 2.1 玩家所在的小隊不收命令

> 「指揮 AI 應該是針對小隊給指令？玩家＋僚機等於一個小隊，指揮 AI 不用跟
> 玩家這個小隊給指令，但是指揮 AI 會跟其他 AI 小隊給指令。」

兩隊**都有**指揮官，只有玩家所在的那一個小隊自治。程式上乾淨：
`flights.pinned` 已經標了玩家，`flightOf[pinned]` 就是要跳過的那一隊。

**這條對驗收有後果**：不能用「有指揮的紅方打贏沒指揮的藍方」當判準，
因為兩邊都有。效果的驗收改成同一場景**開指揮 vs 關指揮**的對照（§7.3）。

### 2.2 閃躲永遠優先，撤退也一樣

執行命令途中被咬，一律先閃。「強制脫離」的意思是「不抵抗、不回頭打」，
不是「不閃彈」。

**實測支持**：2026-08-07 的 task #136 曾把「速度見底就脫離」提到破防之前，
結果 AI 在被連續射擊時飛出**完美直線**（同向性 0.99 → 1.00），被打中的
時間變成 2.3 倍。命令若壓過破防會是同一個病。

### 2.3 命令絕對，立刻脫離

> 「命令絕對，立刻脫離。」

收到命令的飛機**不再交戰**，即使當下有射擊解。

**這一條明知有坑而選擇踩它。** `rules.ts` 用一長段註解記著一個實測逼出來
的分野：「有射擊解時，『比他弱』不是離開的理由」—— 早期版本無差別擋掉
`extend`，害 AI 咬在敵機後方 236 m、瞄準偏離 4°、正在開火時切走，直飛
21 秒到 1,484 m，45 秒的交戰只開火 7.1 秒。

裁定是在知道這件事的情況下做的。因此本份**必須把那個坑照亮**：§7.3 有一條
專門量「正在有射擊解時被命令拉走」的護欄。若該數字很高**而且**傷害交換
變差，那就是同一個病復發，屆時拿數據請專案負責人決定是否退成
「有射擊解就先打完」。

### 2.4 見底 = 小隊裡**最低**的那一架，持續 T 秒

> 「我在想，用小隊最低飛機的當判斷呢？」

**史實正確**：Rotte / Schwarm 的整套準則建立在「編隊的能力等於最弱的那一
架」上，而 `flights.ts` 的設計已經站在這個前提（「Rotte 是不可分割的戰術
單位」）。「全隊都見底才走」在戰術上是反的 —— 那是打到全隊耗盡才想撤。

**但直接套個體層的 `cornerEnter`（0.75）會壞掉，而且可預測**：那個門檻
回答的是「我現在該不該停止拉桿、低頭換速度」，是**瞬間**判斷，而戰鬥機
每一次硬拉都會短暫掉到 0.75 以下。20v20 裡任何時刻幾乎都有人剛拉完一個
彎 —— 直接拿它判「最低的那一架」，指揮官會一直在把小隊拉出來。

指揮層問的是不同的問題：「這個小隊是不是**已經**打不動了」，那是**持續**
的狀態。所以判準是：

```
小隊裡最低的那一架，持續 T 秒低於門檻 → 見底
```

「最低」給史實正確性，「持續」把瞬間的拉桿濾掉。門檻與 T **都待實測掃描
回填**（§6）。

---

## 3. 架構

```
                  每隊一個指揮官（CommandState）
                            │ 每 N 秒
                            ▼
              planFlightOrder(小隊快照, 敵群快照, 已見底秒數)
                            │  純函數，不碰世界
                            ▼
                   FlightOrder | null
                            │ 發給小隊的每一個成員
                            ▼
                  AiController.order
```

**規劃是純函數**，這是為了 §7.1 的驗收 —— 唯一能在不跑模擬的情況下抓到
「指揮 AI 想錯了」的一層。混戰的結果太吵，從結果反推判斷品質驗不出東西。

### 3.1 新檔案：`src/ai/command.ts`

```ts
/**
 * 規劃需要知道的最小資訊。與 `flights.ts` 的 `FlightMember`、`target.ts`
 * 的 `TargetCandidate` 同一個做法 —— 規劃不需要知道世界是怎麼組裝的。
 */
export interface CommandUnit {
  readonly position: Vector3
  readonly velocity: Vector3
  /** TAS ÷ 角落速度。與 `Situation.cornerRatio` 同義 */
  readonly cornerRatio: number
  /** 升限，m。集合點的高度上界 */
  readonly serviceCeiling: number
  readonly alive: boolean
}

/** 一張下給小隊的命令。集合點**凍結**，不隨敵人移動重算 */
export interface FlightOrder {
  readonly point: Vector3
  /** 到達判定半徑，m */
  readonly radius: number
}

export interface CommandConfig {
  /** 規劃週期，s */
  planPeriod: number
  /** 見底門檻：`cornerRatio` 低於此值才開始累積 */
  spentRatio: number
  /** 持續多久才算見底，s */
  spentSeconds: number
  /** 集合點離小隊質心多遠，m */
  withdrawRange: number
  /** 集合點比小隊質心高多少，m */
  withdrawClimb: number
  /** 到達判定半徑，m */
  arriveRadius: number
}

/** 這個小隊此刻該收到什麼命令。`null` = 自由交戰 */
export function planFlightOrder(
  members: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  spentSeconds: number,
  cfg?: CommandConfig,
): FlightOrder | null

/**
 * 規劃需要知道的分隊結構。
 *
 * 【為什麼不直接收 `FlightIndex`】現行的相依方向是 `battle → ai`：
 * `setup.ts` import `AiController`、`target.ts`、`station.ts`，而 `src/ai/`
 * **從來不 import `src/battle/`**。收 `FlightIndex` 會把箭頭反過來。
 *
 * `battle/flights.ts` 的 `Flight` 在結構上滿足這個介面，所以呼叫端直接
 * 傳 `b.flights.flights` 就成立，不需要轉接。這與 `flights.ts` 自己定義
 * `FlightMember`（而不是收 `World.Combatant`）、`target.ts` 定義
 * `TargetCandidate` 是同一個手法。
 */
export interface CommandFlight {
  /** 存活成員在 `units` 裡的索引。只有前 `count` 格有效 */
  readonly members: Int32Array
  readonly count: number
}

/** 指揮官對一支隊伍的狀態。每個分隊一格 */
export interface CommandState {
  orders: (FlightOrder | null)[]
  /** 每個分隊「最低那一架連續低於門檻」的秒數 */
  spent: Float32Array
  /** 距離下次規劃還有多久，s */
  timer: number
}

export function createCommandState(flightCount: number): CommandState

/** 推進一步：累積見底計時、到期規劃、到達解除 */
export function stepCommand(
  s: CommandState, flights: readonly CommandFlight[], units: readonly CommandUnit[],
  skipFlight: number, dt: number, cfg?: CommandConfig,
): void
```

### 3.2 集合點的算法

```
方向 = 由敵群質心指向小隊質心，取水平分量後正規化
點   = 小隊質心 + 方向 × withdrawRange
點.y = clamp(小隊質心.y + withdrawClimb, 安全下界, 最低的升限)
```

**退化**：敵群質心與小隊質心重合（水平分量長度趨近 0）時方向無定義，改用
小隊平均速度的水平方向；兩者都退化時取世界 −Z。這與 `unloadAim`、
`applyFloor`、`shrinkTowardNose` 走同一條退化階梯 —— **不 `return`、不留
NaN，永遠給得出一個可飛的答案**。

**沒有敵人時回傳 `null`**：沒有要脫離的對象，命令沒有意義。

**高度的下界**取 `DEFAULT_STEER.clearanceScale`（500 m）而不是安全層的
`clearance`（120 m）：政策層不該把飛機送進硬限制的作用區。這與 task #136
的六場護欄取同一條線。

---

## 4. 命令的生命週期

```
最低那一架持續 T 秒低於門檻  →  發令，集合點凍結
                                    │
                          進到 radius 內  →  解除，見底計時歸零
```

### 4.1 為什麼集合點凍結，不重算

每 N 秒重算會讓點跟著敵人飄，小隊追著一個移動的目標跑 —— 而且**「到達」
就永遠判定不了**，命令變成永久狀態。

凍結的代價是敵人追過來時點會過時。可接受的理由：命令期間 `defend` 照常
運作（§2.2），而且到達後立刻恢復自由交戰。重規劃留給第三份，那時有數據
支撐要不要加。

### 4.2 遲滯不需要另一個閂鎖

解除時把見底計時器歸零，下一次要再累積滿 T 秒才會重新發令 —— 那本身就是
遲滯。這比另外加一個 `latch` 少一個要維護的狀態。

**這一條有測試守著**（§7.1「門檻附近不抖」）。

---

## 5. 戰機 AI 這一端

### 5.1 兩行覆寫，不動 `arbitrate`

`AiController` 新增 `order: FlightOrder | null`。決策節拍裡，在
`this.intent = stepRules(...)` 的**正下方**：

```ts
// 【命令是外部覆寫，不是仲裁表裡的一列】arbitrate 的優先序關係是實測
// 逐條談定的（相對理由 vs 絕對理由、defend 的絕對優先權），把命令插進去
// 會動到那整組關係。覆寫在外面則一條都不受影響。
if (this.order) this.intent = this.rules.defendLatch ? 'defend' : 'rally'
```

**位置很重要**：必須在 `stepDefend(this.defend, …, this.intent === 'defend', dt)`
**之前** —— 破防的狀態機讀 `this.intent`，晚一步就吃到舊值。

`stepRules` 照常呼叫，閂鎖照常維護 —— 命令解除的那一格才不會拿到一組
停在幾秒前的閂鎖。

`Intent` 增加 `'rally'`，`INTENTS` 陣列同步。

### 5.2 長機：飛去集合點

`steer.ts` 增加 `rally` 分支：瞄準點指向 `order.point`。

它與 `station.ts` 的差別是「相對一個**點**」而不是「相對另一架**飛機**」。
`stationCommand` 的油門政策（追得上就巡航、落後就加力）可以照抄形狀。

**離地底限（`applyFloor`）照樣套** —— 它在意圖分支之後，對所有意圖生效
（task #136）。安全層也照樣是最後一道，命令不豁免。

### 5.3 僚機：只准自衛，不准出擊

```ts
// 【命令對僚機的意思】不是「你也飛去集合點」—— 那會讓編隊散開。是「停止
// 出擊」，於是它掉進既有的「沒有目標 → 飛站位」那一格，自動貼著長機一起
// 走。不需要任何新的協調機制。
if (this.order && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE) {
  this.target = null
}
```

**`LEVEL_SELF_DEFENCE` 照樣插隊** —— 「有人正在打我」不能被命令擋住，
那與 `rules.ts` 讓 `defend` 豁免 `minDwell`、`wingman.ts` 讓跨級插隊豁免
`switchMargin` 是同一條原則。

### 5.4 為什麼不是「每架都飛去集合點」

那會讓小隊在路上散成一排 —— 站位的存在意義就是編隊要一起動。由長機帶隊、
僚機守站位，是 `station.ts` 與 `flights.ts` 已經建好的機制，直接用。

**副作用是好的**：長機陣亡時 `compactFlights` 讓下一位遞補，新長機自動
接手 `rally`，不需要移交邏輯。

---

## 6. 待實測掃描回填的數字

**五個全部不配預設值就出貨** —— 這個專案不接受「配一個看起來合理的數字」
（`p51d.ts` 的命中盒、`steer.ts` 的每一個門檻都是先跑再定）。

| 參數 | 掃描的判準 |
|---|---|
| `spentRatio` | 與 `spentSeconds` 一起掃：下令頻率落在合理區間 |
| `spentSeconds` | 同上 |
| `withdrawRange` | 夠遠才脫離得掉，太遠則小隊離場太久 |
| `withdrawClimb` | 換到的能量 vs 爬升途中的脆弱 |
| `planPeriod` | 反應速度 vs 每步成本 |

**「下令頻率的合理區間」是這組掃描的核心判準**：太低代表門檻等於沒用
（等於沒有指揮），太高代表小隊一直在離場（等於沒有人在打仗）。單看任何
一端都會選錯，所以與傷害交換一起量 —— 那組合能分辨這兩種失敗。

`arriveRadius` 由 `withdrawRange` 推得（一個比例），不單獨掃。

---

## 7. 驗收

### 7.1 第一層：指揮 AI 的判斷（純函數，不跑模擬）

**這一層是專案負責人指定要加的**：

> 「我覺得驗收也要驗收指揮 AI 的能力，例如交火中我方的飛機能量太低，
> 指揮 AI 是否有正確的派出補充能量的指令？或是集合點是否給的正確？」

`planFlightOrder` 是純函數，直接餵快照出考題：

| 考題 | 斷言 |
|---|---|
| 該下的時候有下 | 最低那架持續超時 + 敵人在附近 → 必有命令 |
| 不該下的時候沒亂下 | 全隊健康 → `null` |
| 一架慘三架好 | 仍然發令（小隊不可分割，§2.4） |
| 沒有敵人 | `null` —— 沒有要脫離的對象 |
| 門檻附近不抖 | 能量在門檻上下微幅來回 → 命令不得開開關關 |
| 真的脫離得了 | 集合點離最近敵機 > `THREAT_RANGE`（900 m） |
| 真的補得到能量 | 高於小隊質心，且不超過最低的 `serviceCeiling` |
| 不會叫人穿過敵群 | 集合點離敵群質心 > 小隊質心離敵群質心 |
| 不會叫人撞海 | 高於 `clearanceScale`（500 m） |
| 退化不炸 | 敵我質心重合、速度為零 → 不產生 NaN，仍給得出點 |
| 決定性 | 同一快照算兩次逐位元相同 |
| 連續性 | 敵機位置微擾 ±20 m → 集合點位移有界 |

**最後兩條是這一層真正的價值**：前面那些保證「這一次給得對」，這兩條保證
「給得**穩**」。這個專案治過三次同一個病（`latch` 的遲滯、
`extendPitchAngle` 的連續化、破防軸的號誌閂鎖），每一次的症狀都是
「相鄰輸入給出跳躍的輸出」。

### 7.2 第二層：命令有沒有被執行（通道）

三機或小規模場景，可控可重現：

- 被命令的小隊**到得了**集合點（進到 `arriveRadius` 內，且命令因此解除）
- 途中被咬時**會閃**（`defend` 觸發，同向性不得逼近 1.0 —— 那是 §2.2
  記的那個病的量測形式）
- **不撞海**：安全層的撞地接管佔比為 0（沿用 task #136 定的判準）
- 僚機**不散開**：命令期間站位誤差不得超過 `breakExit`（1200 m）

### 7.3 第三層：整體效果（20v20 開／關指揮對照）

因為兩隊都有指揮官（§2.1），判準是**同一場景開指揮 vs 關指揮**：

| 量 | 判準 |
|---|---|
| 被命令的小隊，命令期間的比能量 | 必須**上升** —— 這是命令的目的 |
| 傷害交換 | **不得變差** |
| 命令佔全場時間的比例 | 落在 §6 掃出來的合理區間 |
| **正在有射擊解時被命令拉走**的次數與佔比 | **照亮 §2.3 那個坑** |

最後一條不設門檻，它是**觀測值**。若它很高**而且**傷害交換變差，那是
`rules.ts` 記載的那個病復發 —— 屆時拿數據請專案負責人決定是否退成
「有射擊解就先打完」。單看它高不算失敗：命令絕對本來就會拉走一些正在
得手的飛機，那是裁定接受的代價。

### 7.4 回歸

- 全套 `npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"`
- `perf-gate` 與 `rematch` 單獨複測（並行下會假紅）
- **`perf-gate` 特別要看**：指揮層是每步都跑的新工作。規劃本身是 N 秒
  一次，但見底計時是每步累積 —— 熱路徑不得配置記憶體

### 7.5 事先講好的否決條件

以下任何一條成立，**整份撤回**，不是調數字：

- §7.1 的「決定性」或「連續性」不成立 —— 那表示規劃本身不穩，調參數
  救不了
- §7.2 的「不撞海」不成立 —— 命令把飛機送進了安全層的作用區
- §7.3 的傷害交換變差，而且 §6 的掃描找不到任何一組讓它不變差的參數

**護欄重新定值是專案負責人的決定，不是實作者的。** 紅了先量、先報告、先問。

---

## 8. 影響範圍

| 檔案 | 改動 |
|---|---|
| `src/ai/command.ts` | **新增**：`planFlightOrder`、`CommandState`、`stepCommand`。**不得 import `src/battle/`** —— 相依方向是 `battle → ai`（見 `CommandFlight` 的註解） |
| `src/ai/rules.ts` | `Intent` 增加 `'rally'`，`INTENTS` 同步 |
| `src/ai/steer.ts` | `steerCommand` 增加 `rally` 分支（瞄準 `order.point`） |
| `src/ai/AiController.ts` | 新增 `order` 欄位；兩行覆寫（§5.1）；僚機的自衛限制（§5.3） |
| `src/battle/setup.ts` | 每隊一個 `CommandState`；每步推進；跳過玩家的小隊 |
| `test/unit/ai-command.test.ts` | **新增**：§7.1 的十二條考題 |
| `test/integration/ai-command-channel.test.ts` | **新增**：§7.2 的通道驗收 |
| `test/integration/multi-battle.test.ts` | §7.3 的開／關對照與觀測值 |

**`src/ai/` 的熱路徑不得配置記憶體** —— 新向量走既有的 `makeScratch`
暫存池。`stepCommand` 每步跑，`planFlightOrder` 每 N 秒跑。
