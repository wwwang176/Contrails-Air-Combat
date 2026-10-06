# 指揮 AI 第三份：決策層 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓指揮官每個規劃週期只把進攻命令發給**最閒的那 K 支分隊**，而不是
發給每一支剛好符合條件的分隊。

**Architecture:** `stepCommand` 的規劃段拆成兩階段 —— 階段一每支分隊各自算
撤退（**不佔配額**），階段二把沒有命令的分隊依「連續多久沒有人握著射擊解」
排名，取前 K 支發集火令。排名是一個新的純函數 `rankFlights`，只吃快照與
既有的兩個陣列。`AiController` 與 `wingman.ts` 一個字都不動。

**Tech Stack:** TypeScript（無 `@types/node`）、three.js 的 `Vector3`、vitest。

## Global Constraints

以下每一條都直接抄自 spec 或專案的既有規矩，**每個任務都隱含適用**：

- **`src/ai/` 不得 import `src/battle/`。** 現行相依方向是 `battle → ai`。
- **`src/ai/` 的熱路徑（240 Hz）不得配置記憶體。** 排名每 `planPeriod` 秒
  跑一次，寫進呼叫端重用的模組層級陣列，不回傳新陣列。
- **規劃層不得 import `Aircraft`、`assess.ts`、`target.ts`。** 收最小介面
  才能用字面物件出考題，那是 §7.1 那一層存在的前提。
- **閃躲永遠優先**；**安全層不豁免**（`applySafety` 仍是最後一道）。
- 專案**沒有** `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態：陣列索引後必須 `!` 或做 undefined
  檢查。**`Float32Array` 與一般陣列一樣受影響**。
- **絕不為了讓測試變綠而放寬門檻。** 紅了先查根因；若斷言本身錯了，改斷言
  並在註解裡寫清楚為什麼。
- 每一條新測試**必須先驗證它是紅的**才寫實作。
- 型別檢查指令是 `npx tsc --noEmit`（**沒有** `npm run typecheck` 這個 script）。
- 效能閘門（`test/unit/perf-gate.test.ts`）與 `test/integration/rematch.test.ts`
  在全套並行下會假紅，**必須單獨複測**。
- 跑效能測試前先確認沒有殘留的 vite dev server、也沒有開著遊戲的瀏覽器分頁。
- **不寫飛機外形的測試。**
- commit 一律用明確路徑，**絕對不要 `git add -A`**（`bash.exe.stackdump` 是
  已追蹤且已被修改的檔案）。
- commit 訊息含中文時，先用 Write 工具寫到 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再
  `git commit -F`。**絕不用 PowerShell 讀寫含中文的檔案。**
- 護欄重新定值是**專案負責人的決定**，不是實作者的。紅了要先量、先報告、先問。
- **`margin` = 0.10 已經在跑之前定死**（spec §7.3），不得因為實測不過而調整。
- **`FLANK_ENABLED` 維持 `false`**（spec §9）。這一份不重開側翼。

## File Structure

| 檔案 | 責任 | 本計畫的改動 |
|------|------|------|
| `src/ai/command.ts` | 指揮層：純規劃 + 命令生命週期 | `CommandUnit` 加 `shotInstant`；`CommandState` 加 `idle`；`CommandConfig` 加 `maxOrders` / `idleSeconds`；新增 `rankFlights`；`stepCommand` 的規劃段拆成兩階段 |
| `src/battle/setup.ts` | 戰鬥組裝與每步推進 | `commandUnits` 的物件字面加 `shotInstant: 0`；`stepCommandLayer` 每步抄一次（兩行） |
| `test/unit/ai-command.test.ts` | spec §7.1、§7.2 的考題 | 加十九條 |
| `test/integration/ai-command-decision.test.ts` | spec §7.3 的三場 A/B | **新增** |
| `test/integration/ai-command-channel.test.ts` | 第一份的通道驗收 | **一個字都不改**，只確認沒有新紅 |

**不動的**：`src/ai/AiController.ts`、`src/ai/wingman.ts`、`src/ai/rally.ts`、
`src/ai/steer.ts`、`src/ai/target.ts`。

**為什麼排名寫進 `out` 而不是回傳陣列**：它每 `planPeriod` 秒跑一次，呼叫端
重用一個模組層級的陣列，與 `MEMBERS` / `TARGET` / `FOES` 那一組同一個做法。

---

### Task 1: 快照加射擊解、狀態加閒置計時、設定加兩個參數

**Files:**
- Modify: `src/ai/command.ts`
- Modify: `src/battle/setup.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Produces:
  - `CommandUnit` 增加 `shotInstant: number`
  - `CommandState` 增加 `idle: Float32Array`
  - `CommandConfig` 增加 `maxOrders: number` 與 `idleSeconds: number`
  - `DEFAULT_COMMAND.maxOrders = 2`、`DEFAULT_COMMAND.idleSeconds = 3`

- [x] **Step 1: 先讀懂三個會被牽動的地方**

不要改，只讀：

- `src/ai/command.ts` 的 `CommandUnit`（約第 17 行）、`CommandConfig`
  （約第 69 行）、`CommandState`（約第 684 行）與 `createCommandState`。
- `src/ai/command.ts` 的 `stepCommand` 裡「見底計時」那一段（約第 751 行）
  —— 閒置計時要放在它的正下方，形狀逐字一樣。
- `test/unit/ai-command.test.ts` 的 `unit()` 工廠（約第 11 行）—— 加欄位後
  它要跟著加，否則既有的考題全部編譯失敗。

- [x] **Step 2: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 的 `describe('stepCommand：命令的生命週期'`
那個 describe 的**最後**（在它的收尾 `})` 之前）追加：

```ts
  /**
   * 【閒置計時】spec §4.3。`shotInstant` 是瞬時的，而分隊在一次大彎途中
   * 會短暫失去射擊解 —— 直接讀瞬時值會把「正在纏鬥」誤判成「閒」。所以
   * 累積一個計時器，與既有的 `spent` 逐字同一個形狀。
   */
  it('沒有人握著射擊解 → idle 累積', () => {
    const sc = scene(1.2)
    run(sc, 5)
    expect(sc.s.idle[0]).toBeGreaterThan(4.9)
  })

  it('有人握著射擊解 → idle 歸零', () => {
    const sc = scene(1.2)
    run(sc, 5)
    sc.units[1]!.shotInstant = 0.5
    run(sc, DT)
    expect(sc.s.idle[0]).toBe(0)
  })

  /**
   * 【只要有一架握著就算不閒】小隊是一個單位（spec §2.4 的同一條推理）。
   * 這一條的第一架是閒的，計時仍然要歸零。
   */
  it('隊裡只要一架握著射擊解就不算閒', () => {
    const sc = scene(1.2)
    run(sc, 5)
    sc.units[0]!.shotInstant = 0
    sc.units[1]!.shotInstant = 0.2
    run(sc, DT)
    expect(sc.s.idle[0]).toBe(0)
  })

  it('全滅的分隊 → idle 歸零', () => {
    const sc = scene(1.2)
    run(sc, 5)
    sc.flights[0] = { members: sc.flights[0]!.members, count: 0 }
    run(sc, DT * 2)
    expect(sc.s.idle[0]).toBe(0)
  })
```

- [x] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "idle"
```

預期：編譯失敗，`CommandState` 沒有 `idle`、`CommandUnit` 沒有 `shotInstant`。

- [x] **Step 4: `CommandUnit` 加 `shotInstant`**

在 `hpFraction` 的正下方加：

```ts
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
```

並把 `CommandUnit` 的類別註解最後一行改成：

```
 * `cornerRatio` / `hpFraction` / `shotInstant` / `alive` 每步會被呼叫端改寫。
```

- [x] **Step 5: `CommandConfig` 加兩個參數**

在 `focusCone` 的下方加：

```ts
  /** 同時最多幾支分隊持有**進攻**命令。撤退不算（spec §3.2） */
  maxOrders: number
  /** 連續多久沒有人握著射擊解才算「閒」，s */
  idleSeconds: number
```

在 `DEFAULT_COMMAND` 的 `focusCone` 那一行下方加：

```ts
  // ── 決策層。**起始值，待 Task 5 由實測掃描回填** ──
  maxOrders: 2,
  idleSeconds: 3,
```

並在 `DEFAULT_COMMAND` 的長註解最後加一節：

```
 * ## 決策層的兩個起始值（2026-08-08 加，待 Task 5 掃描）
 *
 * - `maxOrders` 2 —— 每隊五個分隊，K = 2 表示同時最多四成的分隊在執行戰術。
 *   **兩個端點都已經量過**：K = 0 是關掉指揮（第一份的對照組），K = 全部是
 *   第二份的狀態（接敵瞬間八個分隊同時集火，兩隊質心 150 秒不再合流）。
 * - `idleSeconds` 3 —— 與 `spentSeconds` 同值：一次完整的水平大彎的量級，
 *   用來濾掉單次失去射擊解。
 *
 * 【`idleSeconds` 不是主角】實測射擊解很稀有（開火取樣只佔存活取樣的
 * 1.7%），所以這個門檻幾乎所有分隊都會滿足 —— **真正在限制數量的是
 * `maxOrders`**，門檻的作用只是防止「一支剛剛還在得手的分隊立刻被調走」。
 * 看到「幾乎所有分隊都合格」不是 bug（spec §4.4）。
```

- [x] **Step 6: `CommandState` 加 `idle`**

把 `spent` 的下方加：

```ts
  /**
   * 每個分隊「連續多久沒有任何成員握著射擊解」累積的秒數。
   *
   * 【與 `spent` 分開】兩個計時器問的是不同的事：`spent` 問「還打得動嗎」
   * （能量），`idle` 問「正在得手嗎」（戰果）。一支能量充足但完全沒有射擊
   * 機會的分隊，兩個量會給出相反的答案 —— 而那正是最該被調去集火的分隊。
   */
  idle: Float32Array
```

`createCommandState` 加一行：

```ts
    idle: new Float32Array(flightCount),
```

- [x] **Step 7: `stepCommand` 累積閒置計時**

在「見底計時」那一段的正下方加：

```ts
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
```

並在「玩家那一隊自治」那個提早結束的分支裡，`s.spent[f] = 0` 的下方加：

```ts
      s.idle[f] = 0
```

- [x] **Step 8: 補上所有既有的建構點**

```
npx tsc --noEmit
```

`tsc` 會列出每一處。逐一修：

1. `test/unit/ai-command.test.ts` 的 `unit()` —— 在 `hpFraction` 那一行下方加

```ts
    shotInstant: over.shotInstant ?? 0,
```

2. `src/battle/setup.ts` 的 `commandUnits` 物件字面 —— 在 `hpFraction: 1,`
   下方加 `shotInstant: 0,`

- [x] **Step 9: `setup.ts` 每步抄一次**

在 `stepCommandLayer` 裡寫 `u.hpFraction` 那一段的下方加：

```ts
    // 【只為排名】射擊解強度的鏡像，見 command.ts 的 `idle`。玩家座位沒有
    // AiController，寫 0（視為閒置）—— 無害，玩家那一隊本來就被 skipFlight
    // 跳過
    const ctl = c.controller
    u.shotInstant = ctl instanceof AiController ? ctl.shotInstant : 0
```

（`AiController` 在 `setup.ts` 已經 import 過，不必加。）

- [x] **Step 10: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts test/unit/ai-controller.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [x] **Step 11: 跑通道驗收，確認行為一個字都沒變**

```
npx vitest run test/integration/ai-command-channel.test.ts
```

預期：**與 Task 1 之前完全相同的紅綠分佈**（六綠、兩紅：離場佔時 33.51%、
撞地接管 134）。Task 1 只加了一個沒有人讀的計時器，行為必須逐字不變。

若數字變了，**停下來查根因** —— 那表示 `shotInstant` 的抄寫改到了別的東西。

- [x] **Step 12: Commit**

```bash
git add src/ai/command.ts src/battle/setup.ts test/unit/ai-command.test.ts
```

訊息（含中文，走檔案）：

```
feat: 快照加射擊解、狀態加閒置計時、設定加配額與門檻

排名分數是機會成本 ——「這支分隊現在有沒有人握著射擊解」。它是唯一
編碼了第二份 §12 那個教訓的特徵：側翼失敗的機制是一支已經咬住人的
分隊放棄了現有位置，而純幾何量不到那件事（「離最近的敵分隊多近」對
正在得手的和正在挨打的分隊是同一個數字）。

資料是現成的：AiController.shotInstant 已經存在，註解寫的就是「只為
量測存在」。setup.ts 每步抄過來，與 cornerRatio、hpFraction 同一手。

用計時器而不是瞬時值：shotInstant 是瞬時的，分隊在一次大彎途中會短暫
失去射擊解，直接讀會把「正在纏鬥」誤判成「閒」。累積的形狀與既有的
spent 逐字一樣。

閒置取隊裡的最大值而不是最低那一架 —— 見底問「最弱的拖不拖得動」所以
取最低，閒置問「有沒有在得手」，只要有一架在得手就不該被調走。

這一步沒有人讀 idle，所以行為逐字不變：通道驗收的紅綠分佈與改之前
完全相同。
```

---

### Task 2: `rankFlights` —— 排名的純函數

**Files:**
- Modify: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CommandUnit.shotInstant`、`CommandConfig.idleSeconds`
- Produces:
  - `export function rankFlights(flights, own, units, orders, idle, skipFlight, out, cfg?): void`

- [x] **Step 1: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 檔案最後追加。把 `rankFlights` 加進
`from '../../src/ai/command'` 那一組 import：

```ts
describe('rankFlights', () => {
  /** 四個分隊，每隊一架。`units` 的索引與分隊索引相同 */
  function scene() {
    const units: CommandUnit[] = [unit(), unit(), unit(), unit()]
    const flights = [flight(0), flight(1), flight(2), flight(3)]
    const orders: (FlightOrder | null)[] = [null, null, null, null]
    const idle = new Float32Array([10, 30, 20, 5])
    return { units, flights, orders, idle, own: [0, 1, 2, 3] }
  }
  const OUT: number[] = []

  it('閒最久的排第一', () => {
    const sc = scene()
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    // idle = [10, 30, 20, 5]，門檻 3 → 四個都合格，由大到小是 1, 2, 0, 3
    expect(OUT).toEqual([1, 2, 0, 3])
  })

  /**
   * 【決定性】spec §7.4 的否決條件。同值不能靠 sort 的實作細節決定順序 ——
   * 那會讓同一個態勢在不同引擎上給出不同的命令。
   */
  it('同 idle 值 → 以分隊索引由小到大破平手', () => {
    const sc = scene()
    sc.idle = new Float32Array([7, 7, 7, 7])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([0, 1, 2, 3])
  })

  it('idle 沒到門檻的不進榜', () => {
    const sc = scene()
    // 門檻是 cfg.idleSeconds = 3；只有索引 3 的 2.9 不到
    sc.idle = new Float32Array([10, 30, 20, 2.9])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([1, 2, 0])
  })

  /** 【已持有命令的不進榜】不論哪一種命令 —— 遲滯就是這樣免費來的 */
  it('已持有命令的不進榜', () => {
    const sc = scene()
    sc.orders[1] = {
      kind: 'rally', point: new Vector3(), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
    sc.orders[2] = {
      kind: 'focus', point: new Vector3(), radius: 0,
      targetFlight: -1, side: 0, focusIndex: 9,
    }
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([0, 3])
  })

  it('全滅的分隊不進榜', () => {
    const sc = scene()
    sc.flights[1] = { members: sc.flights[1]!.members, count: 0 }
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([2, 0, 3])
  })

  /** 【成員全部陣亡但 count 還沒壓縮】同一步裡 compactFlights 還沒跑過 */
  it('成員全部陣亡的分隊不進榜', () => {
    const sc = scene()
    sc.units[1] = unit({ alive: false })
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([2, 0, 3])
  })

  it('玩家那一隊不進榜', () => {
    const sc = scene()
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, 1, OUT, cfg)
    expect(OUT).toEqual([2, 0, 3])
  })

  it('全部不合格 → 回空', () => {
    const sc = scene()
    sc.idle = new Float32Array([0, 0, 0, 0])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([])
  })

  /**
   * 【連續性】spec §7.4 的否決條件。排名本身是離散的，所以問的不是「輸出
   * 連不連續」，而是**微擾只會讓相鄰兩名互換**。若一次微擾能讓整個順序
   * 翻轉，那代表分數不是單調的。
   */
  it('idle 微擾 ±0.1 s 只會讓相鄰兩名互換', () => {
    const sc = scene()
    // 把第 2 名（索引 2，idle 20）推過第 1 名（索引 1，idle 30）需要 10 秒，
    // 微擾 0.1 動不了任何一對；把索引 0（10）與索引 2（20）之間拉近到
    // 0.05 之後，0.1 的微擾剛好只換那一對
    sc.idle = new Float32Array([19.95, 30, 20, 5])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([1, 2, 0, 3])
    sc.idle = new Float32Array([20.05, 30, 20, 5])
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, OUT, cfg)
    expect(OUT).toEqual([1, 0, 2, 3])
  })

  /** 【決定性】同一個輸入算兩次，逐位元相同 */
  it('同一個快照算兩次，順序相同', () => {
    const sc = scene()
    const a: number[] = []
    const b: number[] = []
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, a, cfg)
    rankFlights(sc.flights, sc.own, sc.units, sc.orders, sc.idle, -1, b, cfg)
    expect(a).toEqual(b)
  })
})
```

`FlightOrder` 要加進 import 的 type 那一組：

```ts
  type CommandUnit, type CommandFlight, type FlightOrder,
```

- [x] **Step 2: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "rankFlights"
```

預期：編譯失敗，`rankFlights` 不存在。

- [x] **Step 3: 寫 `rankFlights`**

接在 `planFocusTarget` 之後：

```ts
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
```

- [x] **Step 4: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

**若「微擾只會讓相鄰兩名互換」紅了**：先印出兩次的 `OUT`。那一條的場景是
刻意把索引 0 與索引 2 的 `idle` 拉到相差 0.05，所以 0.1 的微擾剛好跨過那
一對而跨不過別的。若實作把排序寫成不穩定的，這一條會以**別的方式**紅
（同值那一條會先紅），**不要改場景，去看排序**。

- [x] **Step 5: Commit**

```bash
git add src/ai/command.ts test/unit/ai-command.test.ts
```

訊息：

```
feat: rankFlights —— 依「多久沒有人握著射擊解」排名

分數只問機會成本，不問「誰最有機會」。打誰 planFocusTarget 已經在算、
誰離得近幾何在算，「叫誰去損失最小」沒有人在算 —— 把目標價值也放進
分數會讓同一個問題有兩個答案，第二份 §5.3 花了整節說明為什麼不重用
targetScore，同一條紀律。

已持有命令的不進榜，遲滯就是這樣免費來的：命令照既有的解除條件走，
不會出現「這一輪排第 3 拿到命令、下一輪排第 6 又被收回」的抖動。這個
專案為了遲滯付過三次代價（latch、switchMargin、spent 歸零）。

用插入排序不是因為快，是因為它穩定：own 是遞增的，同 idle 值自然保持
索引由小到大，破平手不需要額外的比較。決定性是否決條件，靠
Array.prototype.sort 的實作細節破平手不能接受。

排名刻意不看敵方，所以它的考題完全不必造敵機。
```

---

### Task 3: `stepCommand` 拆成兩階段，接上配額

**Files:**
- Modify: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `rankFlights`
- Produces: `stepCommand` 的**行為**改變（簽名不變）

- [x] **Step 1: 讀懂現行規劃段的形狀**

不要改，只讀 `src/ai/command.ts` 的 `stepCommand`（約第 725 行起）。注意
現在**同一個迴圈**裡做了三件事：計時、命令維護、規劃（撤退 → 側翼／集火）。
Task 3 把第三件事的**進攻**那一半搬到迴圈之後。

- [x] **Step 2: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 的 `describe('stepCommand：側翼與集火的生命週期'`
那個 describe 的**最後**追加。這個 describe 的 `scene()` 只有兩個分隊，
配額測試需要更多，所以自己造一個場景：

```ts
describe('stepCommand：配額', () => {
  /**
   * 我方四個分隊（索引 0~3，各一架，在原點朝 −Z），敵方一個分隊
   * （索引 4，兩架，在 −Z 800 也就是我方**航向上**，所以集火的錐形閘門
   * 會放行）。`units` 的索引與成員一一對應。
   */
  function scene() {
    const units: CommandUnit[] = [
      unit({ x: 0 }), unit({ x: 400 }), unit({ x: 800 }), unit({ x: 1200 }),
      unit({ z: -800 }), unit({ x: 200, z: -800 }),
    ]
    const flights = [
      flight(0), flight(1), flight(2), flight(3), flight(4, 5),
    ]
    const s = createCommandState(flights.length)
    return { units, flights, s, own: [0, 1, 2, 3], foe: [4] }
  }
  function run(sc: ReturnType<typeof scene>, seconds: number, skip = -1) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, skip, DT, cfg)
    }
  }
  /** 目前持有進攻命令的分隊數 */
  function attacking(sc: ReturnType<typeof scene>): number {
    let n = 0
    for (const f of sc.own) {
      const o = sc.s.orders[f]
      if (o !== undefined && o !== null && o.kind !== 'rally') n++
    }
    return n
  }

  it('同時持有進攻命令的分隊數不超過 maxOrders', () => {
    const sc = scene()
    run(sc, cfg.idleSeconds + cfg.planPeriod * 3)
    expect(attacking(sc)).toBe(cfg.maxOrders)
  })

  /** 【全程都不超過】只看終點會漏掉「中途爆量、後來才收斂」 */
  it('全程都不超過 maxOrders', () => {
    const sc = scene()
    const steps = Math.round((cfg.idleSeconds + cfg.planPeriod * 5) / DT)
    let worst = 0
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, -1, DT, cfg)
      const n = attacking(sc)
      if (n > worst) worst = n
    }
    expect(worst).toBe(cfg.maxOrders)
  })

  /** 【閒最久的先拿到】四支的 idle 一起長，所以由索引小的先拿 */
  it('拿到命令的是排名最前面的那幾支', () => {
    const sc = scene()
    run(sc, cfg.idleSeconds + cfg.planPeriod + DT)
    expect(sc.s.orders[0]).not.toBeNull()
    expect(sc.s.orders[1]).not.toBeNull()
    expect(sc.s.orders[2]).toBeNull()
    expect(sc.s.orders[3]).toBeNull()
  })

  /** 【名額釋出後補上】命令解除 → 下一個規劃週期換別人 */
  it('一張命令解除後，名額由下一支補上', () => {
    const sc = scene()
    run(sc, cfg.idleSeconds + cfg.planPeriod + DT)
    // 讓分隊 0 的集火目標陣亡 → 它的命令解除
    const idx = sc.s.orders[0]!.focusIndex
    sc.units[idx]!.alive = false
    run(sc, cfg.planPeriod * 2)
    expect(attacking(sc)).toBe(cfg.maxOrders)
    // 分隊 0 的 idle 在解除時歸零，所以補上的不是它
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【解除時 idle 歸零就是遲滯】spec §5.1。少了這一行，剛解除的分隊在
   * 下一個週期就會回到榜首（它確實是閒的），於是被永久釘在命令狀態 ——
   * 那正是第一份記載過的病。
   */
  it('進攻命令解除時 idle 歸零', () => {
    const sc = scene()
    run(sc, cfg.idleSeconds + cfg.planPeriod + DT)
    const idx = sc.s.orders[0]!.focusIndex
    sc.units[idx]!.alive = false
    run(sc, DT * 2)
    expect(sc.s.idle[0]).toBeLessThan(cfg.idleSeconds)
  })

  /**
   * 【撤退不佔配額】spec §3.2。K 已經滿了，但一支見底的分隊仍然要拿得到
   * 撤退令 —— 「打不動了」是一個事實，不是指揮官在分配資源。
   */
  it('配額滿了，見底的分隊仍然拿得到撤退令', () => {
    const sc = scene()
    run(sc, cfg.idleSeconds + cfg.planPeriod + DT)
    expect(attacking(sc)).toBe(cfg.maxOrders)
    // 讓一支還沒拿到命令的分隊（索引 2）見底
    sc.units[2]!.cornerRatio = 0.4
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[2]!.kind).toBe('rally')
  })

  /** 【K = 0】指揮官只做撤退。合法設定，也是掃描的一個端點 */
  it('maxOrders = 0 → 完全不發進攻命令，但撤退照發', () => {
    const zero = { ...cfg, maxOrders: 0 }
    const sc = scene()
    const steps = Math.round((cfg.idleSeconds + cfg.planPeriod * 3) / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, -1, DT, zero)
    }
    expect(attacking(sc)).toBe(0)

    sc.units[2]!.cornerRatio = 0.4
    const more = Math.round((cfg.spentSeconds + cfg.planPeriod + 1) / DT)
    for (let i = 0; i < more; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, -1, DT, zero)
    }
    expect(sc.s.orders[2]!.kind).toBe('rally')
  })
})
```

- [x] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "配額"
```

預期：多條紅 —— 現在沒有配額，四支分隊會全部拿到集火令。

- [x] **Step 4: 把進攻規劃從迴圈裡拿掉**

把 `// ── 規劃：撤退 > 側翼 > 集火 ─` 那一段（從那個註解到迴圈結尾的
`}` 之前，也就是含「二：挑最近的敵分隊」與「三：遠 → 側翼；近 → 集火」
整段）**整段換成**：

```ts
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
```

- [x] **Step 5: 在迴圈之後加階段二**

緊接在上一步那個 `}`（迴圈的收尾）之後、`stepCommand` 的收尾 `}` 之前：

```ts
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
```

- [x] **Step 6: 加 `RANKED` 暫存陣列**

在 `TARGET_IDX` 那一行下方加：

```ts
/** 排名的輸出。重用，理由同上 */
const RANKED: number[] = []
```

- [x] **Step 7: 進攻命令解除時把 `idle` 歸零**

在命令維護那一段，**每一處把非 rally 的命令設成 null 的地方**都補上
`s.idle[f] = 0`。共四處：

```ts
      if (order.kind !== 'rally' && s.spent[f]! >= cfg.spentSeconds) {
        s.orders[f] = null
        s.idle[f] = 0
        continue
      }
      if (order.kind === 'focus') {
        const t = units[order.focusIndex]
        if (t === undefined || !t.alive
          || centroidDistance(flight, units, t.position) > FLANK_RANGE) {
          s.orders[f] = null
          s.idle[f] = 0
        }
      } else if (order.kind === 'flank') {
        const tf = flights[order.targetFlight]
        if (tf === undefined || tf.count === 0) {
          s.orders[f] = null
          s.idle[f] = 0
        } else {
          gather(TARGET, tf, units)
          gather(MEMBERS, flight, units)
          flankPoint(TARGET, MEMBERS, order.side, cfg, order.point)
          if (flankArrived(MEMBERS, TARGET, cfg)) {
            s.orders[f] = null
            s.idle[f] = 0
          }
        }
      } else {
```

**rally 那一支不加** —— 它歸零的是 `spent`（第一份既有的行為）。兩個計時器
各管各的：一支剛撤退回來的分隊本來就是閒的，沒有理由再罰它一次（spec §5.1）。

- [x] **Step 8: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts test/unit/ai-controller.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [x] **Step 9: 跑通道驗收與強制注入驗收**

```
npx vitest run test/integration/ai-command-channel.test.ts
npx vitest run test/integration/ai-command-tactics.test.ts
```

**預期不是「一定綠」。** 逐條處理：

- **通道驗收的「離場佔時」與「撞地接管」**：兩條在 Task 3 之前就是紅的
  （33.51%、134）。配額應該讓集火變少、連帶讓撤退變少，所以它們**可能**
  轉綠。轉綠要記下來；沒轉綠也要記下來（spec §7.5：它們是觀測值不是閘門）。
- **「多數命令會因為到達而解除」紅** → 先依 `kind` 分開數 `issued` /
  `arrived`，找出是哪一種到不了，**停下來報告**。
- **強制注入驗收**：它直接寫 `orders[vf]`，繞過排名與配額，所以**應該完全
  不受影響**。若它紅了，代表階段二動到了不該動的東西，**查根因**。

- [x] **Step 10: Commit**

```bash
git add src/ai/command.ts test/unit/ai-command.test.ts
```

訊息：

```
feat: stepCommand 拆成兩階段，進攻命令接上配額

階段一每支分隊各自算撤退（不佔配額），階段二把沒有命令的分隊排名、
取前 K 支發進攻命令。

局部條件治不了同時性：接敵是一個所有分隊同時經歷的事件，任何只看單一
分隊的條件都會在那一瞬對所有人同時成立，把條件收緊只是把「八個同時」
變成「三個同時」。實測第二份接敵瞬間八個分隊同時集火，兩隊質心 150 秒
不再合流。

名額在維護之後才數，所以這一步解除的命令會立刻把名額釋出 —— 晚一個
規劃週期才回來的話，配額會系統性地低於 K。

planFocusTarget 回 null 時不消耗名額：排名只決定考慮順序，能不能發由
規劃函式自己說。我方這邊看閒置度、敵方那邊看有沒有打得到的目標，各管
一半。

進攻命令解除時 idle 歸零（四處），rally 那一支不加 —— 它歸零的是
spent。一支剛撤退回來的分隊本來就是閒的，沒有理由再罰它一次。
```

---

### Task 4: 三場 A/B 的主判準

**Files:**
- Create: `test/integration/ai-command-decision.test.ts`

**Interfaces:**
- Consumes: Task 1~3 的全部

- [x] **Step 1: 寫測試檔**

建立 `test/integration/ai-command-decision.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120

/**
 * 【margin 在跑之前定死】專案負責人 2026-08-08 裁定 0.10。看到結果再定
 * 門檻等於量到綠為止 —— 這個專案在第二份 §11.7 剛踩過（門檻訂完之後量測
 * 工具又改了，比值從 26 倍掉到 8.9 倍）。
 */
const MARGIN = 0.10

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

/**
 * 把一隊的命令清乾淨。
 *
 * 【為什麼是清而不是不接線】兩邊跑的是**完全同一份程式**，差別只有命令有
 * 沒有真的傳到戰機端 —— 這比改生產程式碼誠實（第一份的做法，沿用）。
 */
function suppress(b: Battle, team: 'blue' | 'red'): void {
  const st = team === 'blue' ? b.blueCommand : b.redCommand
  st.orders.fill(null)
  for (const c of b.world.combatants) {
    if (c.team !== team) continue
    const ai = c.controller
    if (ai instanceof AiController) {
      ai.order = null
      ai.focusTarget = null
    }
  }
}

interface Damage {
  blue: number
  red: number
}

/**
 * 跑一場 20v20，指定哪一隊有指揮官。
 *
 * @param commanded `'none'` = 兩隊都沒有；`'blue'` / `'red'` = 只有那一隊有
 */
function observe(commanded: 'none' | 'blue' | 'red'): Damage {
  const b: Battle = createBattle(new Idle())
  const hp0 = b.world.combatants.map((c) => c.hp)

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)
    if (commanded !== 'blue') suppress(b, 'blue')
    if (commanded !== 'red') suppress(b, 'red')
  }

  const out: Damage = { blue: 0, red: 0 }
  for (const c of b.world.combatants) {
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') out.blue += lost
    else out.red += lost
  }
  return out
}

describe('決策層的主判準（20v20、120 秒、三場）', () => {
  const base = observe('none')
  const blue = observe('blue')
  const red = observe('red')

  /** 藍方的傷害交換比：紅方掉的血 ÷ 藍方掉的血。越大越好 */
  const R0 = base.red / Math.max(base.blue, 1)
  const R1 = blue.red / Math.max(blue.blue, 1)
  const S1 = red.blue / Math.max(red.red, 1)

  /** 【場景要成立】任何一場打不起來的話，下面兩條都會空洞地通過 */
  it('三場都真的打起來了', () => {
    console.log(JSON.stringify({
      base: `B${base.blue.toFixed(0)}:R${base.red.toFixed(0)}`,
      blueCommanded: `B${blue.blue.toFixed(0)}:R${blue.red.toFixed(0)}`,
      redCommanded: `B${red.blue.toFixed(0)}:R${red.red.toFixed(0)}`,
      R0: R0.toFixed(3), R1: R1.toFixed(3), S1: S1.toFixed(3),
      need: `${(R0 * (1 + MARGIN)).toFixed(3)} / ${((1 / R0) * (1 + MARGIN)).toFixed(3)}`,
    }))
    expect(base.blue + base.red).toBeGreaterThan(0)
    expect(blue.blue + blue.red).toBeGreaterThan(0)
    expect(red.blue + red.red).toBeGreaterThan(0)
  }, 10 * 60 * 1000)

  /**
   * 【主判準，極性一】spec §7.3。有指揮的一方要贏過沒指揮的基準。
   */
  it('藍方指揮 → 藍方的交換比高於基準', () => {
    expect(R1).toBeGreaterThan(R0 * (1 + MARGIN))
  }, 10 * 60 * 1000)

  /**
   * 【主判準，極性二】`DEFAULT_BATTLE` 是 P-51D 對 Bf 109 G-6，兩個機種的
   * 性能不同。只跑一個極性的話量到的是機種差異加上指揮效果，分不開 ——
   * 機種差異在兩個極性裡方向相反，基準場把它量掉。
   */
  it('紅方指揮 → 紅方的交換比高於基準', () => {
    expect(S1).toBeGreaterThan((1 / R0) * (1 + MARGIN))
  }, 10 * 60 * 1000)
}, 30 * 60 * 1000)
```

- [x] **Step 2: 跑測試**

```
npx vitest run test/integration/ai-command-decision.test.ts
```

**這一步的預期不是「一定綠」。** 三種紅法分開處理：

- **「三場都真的打起來了」紅** → `suppress` 或 `createBattle` 有問題，
  先印出 `aliveCount` 再查。
- **只有一個極性過** → 那是**機種差異沒有被抵消乾淨**的訊號，或者指揮層
  對其中一個機種有效、對另一個無效。**停下來報告**，把三場的傷害數字一起
  附上。不得只改一條斷言。
- **兩個極性都不過** → 決策層沒有買到東西。**不得調 `MARGIN`**（它是護欄，
  而且是跑之前定死的）。先把 Task 5 的掃描跑完再判斷 —— 起始值
  `maxOrders = 2` 是推理出來的，不是實測出來的。

- [x] **Step 3: Commit**

```bash
git add test/integration/ai-command-decision.test.ts
```

訊息：

```
test: 決策層的主判準 —— 三場 A/B 的傷害交換比

基準場兩隊都不指揮、第二場只有藍方指揮、第三場只有紅方指揮。指揮的
那一方兩場都要贏過基準的 1.10 倍。

兩個極性是為了把機種差異量掉：DEFAULT_BATTLE 是 P-51D 對 Bf 109 G-6，
只跑一個極性會把機種差異算成指揮效果。機種差異在兩個極性裡方向相反。

margin 0.10 是專案負責人在跑之前定死的。看到結果再定門檻等於量到綠為
止 —— 第二份 §11.7 剛踩過。

關掉指揮的做法沿用第一份：每步把該隊的 orders 清乾淨並把每架的
ai.order 與 focusTarget 設為 null。兩邊跑的是完全同一份程式。
```

---

### Task 5: 掃描、回歸、回填

**Files:**
- Modify: `src/ai/command.ts`（只改 `DEFAULT_COMMAND` 的值與註解）
- Modify: `docs/superpowers/specs/2026-08-08-command-ai-decision-design.md`

**Interfaces:**
- Consumes: Task 1~4 的全部

- [x] **Step 1: 加掃描用的暫存測試檔**

建立 `test/integration/zz-decision-sweep.test.ts`（**掃完就刪**）：

```ts
import { it } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND } from '../../src/ai/command'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/**
 * 【臨時檔，掃完就刪】獨立成一個檔的理由：
 * `ai-command-decision.test.ts` 的三場觀測是模組層級的，光是 import 那個檔
 * 就會跑三場 120 秒的仗。
 */
const DT = 1 / 240
const SECONDS = 120

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}
function suppress(b: Battle, team: 'blue' | 'red'): void {
  const st = team === 'blue' ? b.blueCommand : b.redCommand
  st.orders.fill(null)
  for (const c of b.world.combatants) {
    if (c.team !== team) continue
    const ai = c.controller
    if (ai instanceof AiController) { ai.order = null; ai.focusTarget = null }
  }
}
function observe(commanded: 'none' | 'blue' | 'red'): { blue: number, red: number } {
  const b = createBattle(new Idle())
  const hp0 = b.world.combatants.map((c) => c.hp)
  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)
    if (commanded !== 'blue') suppress(b, 'blue')
    if (commanded !== 'red') suppress(b, 'red')
  }
  const out = { blue: 0, red: 0 }
  for (const c of b.world.combatants) {
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') out.blue += lost
    else out.red += lost
  }
  return out
}

it('掃描 maxOrders 與 idleSeconds', () => {
  const base = observe('none')
  const R0 = base.red / Math.max(base.blue, 1)
  console.log('CONTROL ' + JSON.stringify({
    dmg: `B${base.blue.toFixed(0)}:R${base.red.toFixed(0)}`, R0: R0.toFixed(3),
  }))

  const saved = { ...DEFAULT_COMMAND }
  const restore = () => Object.assign(DEFAULT_COMMAND, saved)
  const report = (knob: string, v: number) => {
    const blue = observe('blue')
    const red = observe('red')
    const R1 = blue.red / Math.max(blue.blue, 1)
    const S1 = red.blue / Math.max(red.red, 1)
    console.log('ROW ' + JSON.stringify({
      knob, v,
      R1: R1.toFixed(3), need1: (R0 * 1.1).toFixed(3), pass1: R1 > R0 * 1.1,
      S1: S1.toFixed(3), need2: ((1 / R0) * 1.1).toFixed(3), pass2: S1 > (1 / R0) * 1.1,
    }))
  }

  for (const v of [0, 1, 2, 3, 5]) {
    restore(); DEFAULT_COMMAND.maxOrders = v; report('maxOrders', v)
  }
  for (const v of [1, 3, 8]) {
    restore(); DEFAULT_COMMAND.idleSeconds = v; report('idleSeconds', v)
  }
  restore()
}, 90 * 60 * 1000)
```

- [x] **Step 2: 跑掃描**

```
npx vitest run test/integration/zz-decision-sweep.test.ts
```

共 8 組、每組兩場（加一場基準），約 17 場 120 秒的 20v20。

- [x] **Step 3: 選值**

判準是 §7.3 的兩條斷言（`pass1` 與 `pass2` 都要 true）。

**與前兩份同一條紀律**：有結構的是**邊界**，不是中心點的小數第二位。
`maxOrders` 的兩個端點是已知的（0 = 沒有指揮、5 = 第二份的狀態），
要找的是「哪些值會讓兩條斷言同時成立」，而不是「哪個值多 3%」。

**若沒有任何一組讓兩條同時成立**：那是決策層沒有買到東西。**停下來報告**，
把整張表附上。不得調 `MARGIN`。

- [x] **Step 4: 回填**

把 `DEFAULT_COMMAND` 的 `maxOrders` 與 `idleSeconds` 改成選出來的值，
並把 Task 1 Step 5 寫的那段「**起始值，待 Task 5 由實測掃描回填**」換成
掃描表與選值理由。格式照第一份 `DEFAULT_COMMAND` 的註解：**實測表格 +
為什麼選這個 + 重掃的前提**。

「重掃的前提」要寫明：這組值依賴目前的飛行包絡（`specs/feel.ts` 的五個
倍率）與 `DEFAULT_BATTLE` 的 20v20 編成，兩者大幅改動後要重掃。

- [x] **Step 5: 刪掉掃描用的暫存檔**

```bash
rm test/integration/zz-decision-sweep.test.ts
```

它會改動全域設定，留著會污染同檔以外的測試。

- [x] **Step 6: 跑全套（排除兩個並行假紅的檔案）**

```
npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"
```

- [x] **Step 7: 單獨複測那兩個檔案**

```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

跑之前確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁。

**`perf-gate` 特別要看**：排名每 `planPeriod` 秒跑一次，不在 240 Hz 的熱
路徑上，所以理論上量不到。若它紅了，先確認 `rankFlights` 沒有在配置
（`out.length = 0` 而不是 `out = []`）。

- [x] **Step 8: 逐條處理紅掉的測試**

`multi-battle.test.ts`、`ai-duel-matrix.test.ts`、`ai-command-channel.test.ts`
都會受配額影響。

進 Task 5 之前已知的紅有三條：

```
ai-command-channel   離場佔時 33.51%（要 < 25%）
ai-command-channel   命令期間撞地接管 134（要 = 0）
multi-battle         開局巡航編隊 353 m（要 < 100 m）
ai-command-tactics   側翼方位角（第二份刻意留紅的紀錄，不動它）
```

前三條是 spec §7.5 明列的**觀測值不是閘門**。配額可能讓它們轉綠（集火變少
→ 撤退變少 → 質心比較可能合流）。**轉綠要記下來，沒轉綠也要記下來。**

其他檔案若有新的紅，**先查根因再報告，不得逕自調門檻**。

- [x] **Step 9: 回填 spec**

在 `docs/superpowers/specs/2026-08-08-command-ai-decision-design.md` 加一節
「## 10. 實作後的實測回填」，內容：

- 兩個參數的掃描表與選值理由
- 三場 A/B 的實測值（三場的傷害、`R0` / `R1` / `S1`、兩條斷言過沒過）
- §7.5 那四個觀測值改了沒有（離場佔時、撞地接管、巡航相位、撤退到達率）
- 若有任何一節的設計在實作中被推翻，明寫「實作後修正」並保留原文供追溯
  （這個專案的既有慣例，見第一份的 §9、第二份的 §10~§12）

- [x] **Step 10: Commit**

```bash
git add src/ai/command.ts docs/superpowers/specs/2026-08-08-command-ai-decision-design.md
```

訊息（依實測結果改寫，這裡給的是骨架）：

```
feat: 決策層的兩個參數依實測回填，並記下三場 A/B 的結果

maxOrders 與 idleSeconds 由 8 組 20v20、120 秒的掃描定案。判準是三場
A/B 的兩條斷言（兩個極性都要贏過基準的 1.10 倍）。

有結構的是邊界不是中心點：maxOrders 的兩個端點已知（0 = 沒有指揮、
5 = 第二份的狀態），掃描找的是「哪些值會讓兩條斷言同時成立」。
```

---

## Self-Review

**1. Spec coverage**

| spec 章節 | 對應的任務 |
|---|---|
| §3 兩階段架構 | Task 3 Step 4、Step 5 |
| §3.1 全域配額 | Task 3 Step 5 的 `slots` |
| §3.2 撤退不佔配額 | Task 3 Step 4（撤退留在階段一）、Step 2 的「配額滿了仍拿得到撤退令」 |
| §3.3 動到哪些檔案 | 本計畫的 File Structure |
| §4 排名分數 | Task 2 |
| §4.2 資料來源 | Task 1 Step 9 |
| §4.3 計時器不是瞬時值 | Task 1 Step 7 |
| §4.4 門檻不是主角 | Task 1 Step 5 的註解 |
| §5 每個週期做什麼 | Task 3 Step 5 |
| §5.1 遲滯 | Task 3 Step 7 |
| §5.2 配額算非 rally | Task 3 Step 5 的 `o.kind !== 'rally'` |
| §5.3 簽名 | Task 2 Step 3 |
| §6 退化與邊界 | Task 2 Step 1 的六條考題、Task 3 Step 2 的 `maxOrders = 0` |
| §7.1 考題（九條） | Task 2 Step 1（十條，多一條決定性） |
| §7.2 生命週期（七條） | Task 3 Step 2（七條） |
| §7.3 三場 A/B | Task 4 |
| §7.4 否決條件 | Task 2 的決定性與微擾兩條；Task 5 Step 7 的 perf-gate |
| §7.5 量但不當閘門 | Task 3 Step 9、Task 5 Step 8 |
| §8 待掃描 | Task 5 |
| §9 不做的事 | Global Constraints 的最後一條（`FLANK_ENABLED` 維持 false） |

**2. Placeholder scan**：無 TBD／TODO。每一個 code step 都有完整程式碼。
Task 5 Step 4 與 Step 10 的內容依實測而定，但那是**實測回填**不是佔位符 ——
步驟本身寫明了格式、要寫哪幾項、以及參照哪一份既有註解。

**3. Type consistency**

- `rankFlights` 的簽名在 Task 2 Step 3 定義，Task 3 Step 5 呼叫，八個參數
  逐字一致。
- `CommandUnit.shotInstant`（Task 1 Step 4）被 Task 1 Step 7 的閒置計時與
  Task 1 Step 9 的 `setup.ts` 讀寫，名稱一致。
- `CommandState.idle`（Task 1 Step 6）被 Task 1 Step 7、Task 2 Step 3、
  Task 3 Step 5、Task 3 Step 7 使用，型別 `Float32Array` 一致
  （`rankFlights` 收 `Readonly<Float32Array>`，已驗證 `noUncheckedIndexedAccess`
  下索引後 `?? 0` 編譯得過）。
- `cfg.maxOrders` / `cfg.idleSeconds`（Task 1 Step 5）被 Task 2 Step 3 與
  Task 3 Step 5 讀取。
- `RANKED`（Task 3 Step 6）只被 Task 3 Step 5 使用。
- Task 3 Step 2 的測試用 `createCommandState`、`stepCommand`、`flight`、
  `unit`、`DT`、`cfg`，全部是 `test/unit/ai-command.test.ts` 既有的。
- Task 4 的 `suppress` 用 `b.blueCommand` / `b.redCommand` / `c.team` /
  `AiController.order` / `AiController.focusTarget`，全部既有。
