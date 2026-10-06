# 指揮 AI 第二份：側翼與集火 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓指揮官除了「把打不動的小隊拉出去」之外，還會把健康的小隊從敵分隊
的後側方切進去（側翼）、或叫整隊集火同一架受創的敵機。

**Architecture:** 兩個新戰術都走第一份既有的指令通道 —— 命令長出一個
`kind`，規劃拆成三個純函數（撤退／側翼／集火）。**側翼凍結的是「決定」而不是
「座標」**：`side` 與 `targetFlight` 發令後不變，飛行點每步由當下的敵分隊質心
重算，到達改用幾何判定。**集火只覆寫長機的目標**，僚機靠既有的 `LEVEL_FOCUS`
自動收斂 —— 與集合點同一個手法：只操縱長機，編隊靠既有機制跟上。

**Tech Stack:** TypeScript（無 `@types/node`）、three.js 的 `Vector3`、vitest。

## Global Constraints

以下每一條都直接抄自 spec 或專案的既有規矩，**每個任務都隱含適用**：

- **`src/ai/` 不得 import `src/battle/`。** 現行相依方向是 `battle → ai`。
  分隊結構繼續走 `CommandFlight` 這個最小介面。
- **規劃層（`command.ts`）不得 import `Aircraft`，也不得 import
  `assess.ts` 或 `target.ts` 的任何東西。** spec §5.2、§5.3：`turnTime` 與
  `targetScore` 都吃 `Aircraft`，收它會毀掉「純函數能直接餵字面物件出考題」
  這個性質；在 `command.ts` 裡重寫近似更糟 —— 那是對同一個問題有兩個答案。
- **`src/ai/` 的熱路徑（240 Hz）不得配置記憶體。** 側翼點每步重算，必須走既有
  的 `makeScratch` 暫存池。發令時配置一個 `Vector3` 可以，但要在註解裡寫明
  它每 `planPeriod` 秒才發生一次。
- **閃躲永遠優先**（第一份 spec §2.2）。命令不得壓過 `defend`。
- **安全層不豁免**（第一份 spec §5.2）：`applySafety` 仍是最後一道。
- **驗收與觸發分開**（spec §2）：§7.2 的執行驗收全部用「把戰術直接塞給分隊」
  跑。觸發的兩個數字（`ENGAGED_RATIO`、`FLANK_RANGE`）**不進 `CommandConfig`
  也不掃描**。
- 專案**沒有** `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態：陣列索引後必須 `!` 或做 undefined 檢查。
  **`Float32Array` 與一般陣列一樣受影響**（`s.spent[f] += dt` 會編譯失敗，
  要寫 `s.spent[f] = s.spent[f]! + dt`）。
- **絕不為了讓測試變綠而放寬門檻。** 紅了先查根因；若斷言本身錯了，改斷言
  並在註解裡寫清楚為什麼。
- 每一條新測試**必須先驗證它是紅的**才寫實作。
- 型別檢查指令是 `npx tsc --noEmit`（**沒有** `npm run typecheck` 這個 script）。
- 效能閘門（`test/unit/perf-gate.test.ts`）與 `test/integration/rematch.test.ts`
  在全套並行下會假紅，**必須單獨複測**。
- 跑效能測試前先確認沒有殘留的 vite dev server、也沒有開著遊戲的瀏覽器分頁。
- **不寫飛機外形的測試。**
- commit 一律用明確路徑，**絕對不要 `git add -A`**（`bash.exe.stackdump` 是已追蹤
  且已被修改的檔案）。
- commit 訊息含中文時，先用 Write 工具寫到 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再
  `git commit -F`。**絕不用 PowerShell 讀寫含中文的檔案。**
- 護欄重新定值是**專案負責人的決定**，不是實作者的。紅了要先量、先報告、先問。

## File Structure

| 檔案 | 責任 | 本計畫的改動 |
|------|------|------|
| `src/ai/command.ts` | 指揮層：純規劃 + 命令生命週期 | `OrderKind`、`FlightOrder` 加四欄、`CommandUnit` 加 `hpFraction`、兩個新規劃函式、`stepCommand` 換簽名與加分支、兩個觸發常數 |
| `src/ai/AiController.ts` | 每架的 AI 狀態機 | 兩處既有覆寫加 `kind !== 'focus'` 條件；新增 `focusTarget` 與長機的目標覆寫 |
| `src/battle/setup.ts` | 戰鬥組裝與每步推進 | `Battle` 加兩個分隊索引陣列；每步寫 `hpFraction`；`stepCommand` 新簽名；`focusIndex` 解析成 `focusTarget` |
| `test/unit/ai-command.test.ts` | spec §7.1 的考題 | 加二十三條 |
| `test/integration/ai-command-tactics.test.ts` | spec §7.2 執行驗收 + §7.3 對照 + §8 掃描 | **新增** |
| `test/integration/ai-command-channel.test.ts` | 第一份的通道驗收 | 只改被換掉的簽名，**判準一條都不動** |

**不動的**：`src/ai/wingman.ts`、`src/ai/rules.ts`、`src/ai/rally.ts`、
`src/ai/steer.ts`、`src/ai/target.ts`。

**為什麼側翼不新增意圖**：`flank` 與 `rally` 的轉向需求完全相同（飛向一個世界
座標點、途中不交戰），`steerCommand` 的 `rally` 分支原封不動就能用。多一個意圖
等於多一個 `switch` 分支要維護，而它會與既有的那一個逐字相同。

---

### Task 1: 命令長出種類，快照加血量

**Files:**
- Modify: `src/ai/command.ts`
- Modify: `src/battle/setup.ts`
- Test: `test/unit/ai-command.test.ts`、`test/unit/ai-controller.test.ts`

**Interfaces:**
- Produces:
  - `export type OrderKind = 'rally' | 'flank' | 'focus'`
  - `FlightOrder` 變成 `{ kind, point, radius, targetFlight, side, focusIndex }`
  - `CommandUnit` 增加 `hpFraction: number`
  - `CommandConfig` 增加八個欄位（見 Step 4）
  - `ENGAGED_RATIO` / `FLANK_RANGE` 兩個模組層級常數

- [ ] **Step 1: 先讀懂三個會被牽動的地方**

不要改，只讀：

- `src/ai/command.ts` 的 `FlightOrder`（約第 35 行）與 `CommandUnit`
  （約第 17 行）。
- `test/unit/ai-command.test.ts` 的 `unit()` 工廠（約第 11 行）—— 加欄位後
  它要跟著加，否則二十六條既有考題全部編譯失敗。
- `test/unit/ai-controller.test.ts` 約第 376 與 394 行的
  `ai.order = { point: new Vector3(5000, 4000, 0), radius: 300 }` —— 兩處都要
  補新欄位。

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 的「該不該下令」那個 `describe` 最後追加：

```ts
  it('撤退命令的種類是 rally', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT, cfg)!.kind).toBe('rally')
  })

  /**
   * 【撤退命令不帶戰術欄位】四個欄位是一個聯集的四種投影，`rally` 只用
   * `point` 與 `radius`。留著髒值會讓「這張命令是哪一種」有兩個答案。
   */
  it('撤退命令的戰術欄位是空的', () => {
    const o = planFlightOrder([unit()], [unit({ z: 1000 })], SPENT, cfg)!
    expect(o.targetFlight).toBe(-1)
    expect(o.side).toBe(0)
    expect(o.focusIndex).toBe(-1)
  })
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "種類"
```

預期：編譯失敗，`FlightOrder` 沒有 `kind`。

- [ ] **Step 4: 改 `command.ts` 的型別**

把 `FlightOrder` 整段換成：

```ts
/**
 * 命令的種類。**互斥的聯集，不是一組旗標**：`flank` 與 `focus` 由距離分開
 * （spec §3.2），永遠不會同時成立，所以命令不需要組合。
 */
export type OrderKind = 'rally' | 'flank' | 'focus'

/**
 * 一張下給小隊的命令。
 *
 * 【`rally` 的集合點凍結，`flank` 的每步重算】兩者的差別來自實測：敵**隊**
 * 質心 30 秒只飄 720 m（20 架纏鬥互相抵銷），但敵**分隊**質心飄 2040~4663 m
 * —— 抵銷效應只在架數多時成立，四架的分隊就是一團一起動的東西。
 *
 * 撤退的點是**遠離**敵人的，過期不太傷（第一份 spec §4.1 明寫接受這個代價）；
 * 側翼的點貼著敵分隊定義，凍結會在飛到一半就失效。所以側翼**凍結的是決定**
 * （`side` 與 `targetFlight`）**而不是座標**，到達改用幾何判定（spec §4.2）。
 */
export interface FlightOrder {
  readonly kind: OrderKind
  /**
   * 飛行點。`rally` 發令後不再變；`flank` **由 `stepCommand` 每步重寫**；
   * `focus` 不使用（恆為原點）。
   *
   * 【只有這一個欄位不是 readonly，而且只有 `flank` 會動它】
   */
  point: Vector3
  /** 到達判定半徑，m。只有 `rally` 使用 */
  readonly radius: number
  /** `flank`：切哪一個敵分隊。**全域**分隊索引。其餘為 −1 */
  readonly targetFlight: number
  /** `flank`：從哪一邊切。+1 = 敵航向的右舷，−1 = 左舷。其餘為 0 */
  readonly side: number
  /** `focus`：打哪一架。`units` 的**全域**索引。其餘為 −1 */
  readonly focusIndex: number
}
```

在 `CommandUnit` 的 `alive` 上方加：

```ts
  /**
   * 剩餘血量佔滿血的比例，0..1（1 = 毫髮無傷）。集火挑目標用。
   *
   * 【為什麼是比例而不是絕對值】兩個機種的滿血不同，絕對值跨機種比不了。
   */
  hpFraction: number
```

並把 `CommandUnit` 的類別註解最後一行改成：

```
 * `cornerRatio` / `hpFraction` / `alive` 每步會被呼叫端改寫。
```

- [ ] **Step 5: 加八個執行參數與兩個觸發常數**

在 `CommandConfig` 的 `arriveRadius` 下方加：

```ts
  /** 側翼點離敵航向的橫向偏置，m */
  flankOffset: number
  /** 側翼點放在敵分隊後方多遠，m */
  flankTrail: number
  /** 側翼點比敵分隊高多少，m */
  flankClimb: number
  /** 後側方扇區的半角，rad。到位判定用 */
  flankSector: number
  /** 危險核的特徵長度，m */
  dangerScale: number
  /** 危險分數的上限，超過就不發側翼令 */
  dangerLimit: number
  /** 集火目標的最遠距離，m */
  focusRange: number
  /** 集火目標偏離小隊航向的最大夾角，rad */
  focusCone: number
```

在 `DEFAULT_COMMAND` 的 `arriveRadius: 300,` 下方加：

```ts
  // ── 側翼與集火。**全部是起始值，待 Task 8 由實測掃描回填** ──
  flankOffset: 1200,
  flankTrail: 800,
  flankClimb: 300,
  flankSector: 60 * (Math.PI / 180),
  dangerScale: 900,
  dangerLimit: 2,
  focusRange: 1500,
  focusCone: 60 * (Math.PI / 180),
```

並在 `DEFAULT_COMMAND` 的長註解最後加一節：

```
 * ## 側翼與集火的八個起始值（2026-08-07 加，待 Task 8 掃描）
 *
 * - `flankOffset` 1200 m —— `DEFAULT_WINGMAN.breakExit` 同值：一個分隊散得開、
 *   又還讀得出是編隊的量級。
 * - `flankTrail` 800 m —— 略小於 `THREAT_RANGE`（900），到位時剛好進入可以
 *   開始追蹤的距離。
 * - `flankClimb` 300 m —— `DEFAULT_BATTLE.altitudeSpread` 同值，一個分隊層。
 * - `flankSector` 60° —— 「我在他們的後 120°」。
 * - `dangerScale` 900 m —— `THREAT_RANGE`：「這個距離內的敵機才算危險」。
 * - `dangerLimit` 2.0 —— 約當「兩架敵機貼在候選點上」。
 * - `focusRange` 1500 m —— `DEFAULT_RULES.extendRange` 同值。
 * - `focusCone` 60° —— 與 `flankSector` 同值：「在我們正在去的方向上」。
```

在 `MIN_HORIZONTAL` 那一行下方加兩個觸發常數：

```ts
/**
 * 「這個敵分隊已經在交戰」的 `cornerRatio` 門檻。
 *
 * 0.9 高於指揮層的 `spentRatio`（0.6，「已經打不動」）而低於自由巡航 ——
 * 語意是「有人正在讓它拉桿」。與見底判定用同一個量，不新增概念。
 *
 * 【它是**觸發**，第三份會整條換掉。不要掃描它】刻意不放進 `CommandConfig`：
 * 放進去會讓人以為它與那八個**執行**參數同一個地位，於是被一起掃描 ——
 * 那就是在調第三份的東西（spec §2、§3.3）。
 */
const ENGAGED_RATIO = 0.9

/**
 * 側翼／集火的距離分界，m。遠 → 側翼切入；近 → 集火。
 *
 * 2500 介於 `THREAT_RANGE`（900）與 `withdrawRange`（3000）之間。
 *
 * 它同時是**集火命令的解除距離**（spec §6.2 的遲滯）：發令要求離小隊質心
 * 不到 `focusRange`（1500），解除要求超過 2500 —— 兩個不同的數字就是遲滯，
 * 不需要第三個參數。用同一個門檻發令與解除會在邊界上抖。
 *
 * 【它是**觸發**，第三份會整條換掉。不要掃描它】理由同 `ENGAGED_RATIO`。
 */
const FLANK_RANGE = 2500
```

- [ ] **Step 6: 讓 `planFlightOrder` 回傳新形狀**

把它的 `return { point: …, radius: cfg.arriveRadius }` 換成：

```ts
  return {
    kind: 'rally',
    point: new Vector3(
      own.x + dir.x * cfg.withdrawRange,
      y,
      own.z + dir.z * cfg.withdrawRange,
    ),
    radius: cfg.arriveRadius,
    targetFlight: -1,
    side: 0,
    focusIndex: -1,
  }
```

- [ ] **Step 7: 補上所有既有的建構點**

```
npx tsc --noEmit
```

`tsc` 會列出每一處。逐一修：

1. `test/unit/ai-command.test.ts` 的 `unit()` —— 在 `cornerRatio` 下方加
   `hpFraction: over.hpFraction ?? 1,`
2. `test/unit/ai-controller.test.ts` 兩處 `ai.order = { … }` —— 換成

```ts
    ai.order = {
      kind: 'rally', point: new Vector3(5000, 4000, 0), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
```

3. `src/battle/setup.ts` 的 `commandUnits` 物件字面 —— 在 `cornerRatio: 1,`
   下方加 `hpFraction: 1,`
4. `src/battle/setup.ts` 的 `stepCommandLayer` —— 在寫 `u.cornerRatio` 那一段
   加：

```ts
    // 【滿血由 spec 給】`c.hp` 的上界是 `c.aircraft.spec.hp`（`World` 的
    // respawn 就是抄它）。夾在 0 以上：受創超過滿血時 hp 會是負的
    const full = a.spec.hp
    const frac = full > 0 ? c.hp / full : 0
    u.hpFraction = frac > 0 ? frac : 0
```

- [ ] **Step 8: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts test/unit/ai-controller.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 9: 跑第一份的通道驗收，確認撤退的行為沒變**

```
npx vitest run test/integration/ai-command-channel.test.ts
```

預期：八條全綠（一條 skip）。**這一步不能省** —— Task 1 動的是所有命令共用的
型別，撤退的行為必須逐條保持。

- [ ] **Step 10: Commit**

```bash
git add src/ai/command.ts src/battle/setup.ts test/unit/ai-command.test.ts test/unit/ai-controller.test.ts
```

訊息（含中文，走檔案）：

```
feat: 命令長出種類，快照加血量比例

OrderKind 是互斥的聯集而不是一組旗標：flank 與 focus 由距離分開，
永遠不會同時成立，所以命令不需要組合。

FlightOrder.point 是唯一不是 readonly 的欄位，而且只有 flank 會動它。
理由是實測：敵隊質心 30 秒只飄 720 m（20 架纏鬥互相抵銷），但敵分隊
質心飄 2040~4663 m —— 抵銷效應只在架數多時成立。撤退的點是遠離敵人
的、過期不太傷；側翼的點貼著敵分隊定義，凍結會在飛到一半就失效。

hpFraction 用比例而不是絕對值：兩個機種的滿血不同，絕對值跨機種比
不了。

ENGAGED_RATIO 與 FLANK_RANGE 刻意不放進 CommandConfig —— 它們是觸發
參數，第三份會整條換掉。放進去會讓人以為它們與那八個執行參數同一個
地位，於是被一起掃描，那就是在調第三份的東西。
```

---

### Task 2: `planFlankOrder` —— 側翼的規劃

**Files:**
- Modify: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `FlightOrder`、`CommandUnit`、`CommandConfig`、
  `ENGAGED_RATIO`
- Produces:
  - `function flankPoint(target, own, side, cfg, out): boolean`（模組私有）
  - `function planFlankOrder(members, target, others, targetFlight, cfg?): FlightOrder | null`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 檔案最後追加。把 `planFlankOrder` 加進
`from '../../src/ai/command'` 那一組 import：

```ts
/**
 * 側翼的標準場景：目標分隊在 +Z 3000 處、朝 −Z 飛（也就是朝我們飛過來），
 * 而且正在交戰（cornerRatio 低）。我方在原點。
 */
function foeFlight(over: { x?: number; engaged?: boolean } = {}): CommandUnit[] {
  const cr = over.engaged === false ? 1.2 : 0.8
  return [
    unit({ x: over.x ?? 0, z: 3000, cornerRatio: cr }),
    unit({ x: (over.x ?? 0) + 200, z: 3000, cornerRatio: cr }),
  ]
}

describe('planFlankOrder：該不該下令', () => {
  it('目標分隊在交戰 → 有命令，種類是 flank', () => {
    const o = planFlankOrder([unit(), unit({ x: 200 })], foeFlight(), [], 3, cfg)
    expect(o).not.toBeNull()
    expect(o!.kind).toBe('flank')
    expect(o!.targetFlight).toBe(3)
  })

  /**
   * 【spec §3.1】少了這道閘門，開場五個分隊對五個分隊全都健康又全都很遠，
   * 所有人同時側翼 —— 而側翼途中不交戰，開局會變成兩隊互相繞圈一槍不開，
   * 而且會自我維持（雙方都在繞，「已經接戰」永遠不成立）。
   */
  it('目標分隊沒在交戰 → null', () => {
    expect(planFlankOrder([unit()], foeFlight({ engaged: false }), [], 3, cfg)).toBeNull()
  })

  it('我方全滅 → null', () => {
    const dead = [unit({ alive: false })]
    expect(planFlankOrder(dead, foeFlight(), [], 3, cfg)).toBeNull()
  })

  it('目標分隊全滅 → null', () => {
    const dead = [unit({ z: 3000, alive: false })]
    expect(planFlankOrder([unit()], dead, [], 3, cfg)).toBeNull()
  })
})

describe('planFlankOrder：點放得對不對', () => {
  const members = [unit(), unit({ x: 200 })]

  /**
   * 目標朝 −Z 飛，所以「後方」是 +Z 方向。側翼點的 Z 要**大於**目標質心，
   * 距離約 flankTrail。
   */
  it('點在目標分隊的後方', () => {
    const o = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    expect(o.point.z).toBeGreaterThan(3000)
    expect(o.point.z - 3000).toBeCloseTo(cfg.flankTrail, 6)
  })

  it('橫向偏置約等於 flankOffset', () => {
    const o = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    // 目標航向是 −Z，右手側是 −X（驗算：u=(0,0,−1)，r=(−u.z,0,u.x)=(1,0,0)…
    // 見實作的註解）。這裡只驗大小，方向由下面的「就近」那兩條驗
    expect(Math.abs(o.point.x - 100)).toBeCloseTo(cfg.flankOffset, 6)
  })

  it('比目標分隊高 flankClimb', () => {
    const o = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    expect(o.point.y).toBeCloseTo(4000 + cfg.flankClimb, 6)
  })

  /** 【就近】沒有其他敵機時兩邊一樣安全，取轉場最短的那一邊 */
  it('我方在目標的左邊 → 點也在左邊', () => {
    const left = [unit({ x: -2000 }), unit({ x: -1800 })]
    const o = planFlankOrder(left, foeFlight(), [], 3, cfg)!
    expect(o.point.x).toBeLessThan(0)
  })

  it('我方在目標的右邊 → 點也在右邊', () => {
    const right = [unit({ x: 2000 }), unit({ x: 1800 })]
    const o = planFlankOrder(right, foeFlight(), [], 3, cfg)!
    expect(o.point.x).toBeGreaterThan(0)
  })

  /**
   * 【危險評估壓過就近】專案負責人 2026-08-07 追加的要求：側翼點有可能正好
   * 落在另一場交火中間。
   */
  it('就近的那一邊塞滿其他敵機 → 改走另一邊', () => {
    const left = [unit({ x: -2000 }), unit({ x: -1800 })]
    const safe = planFlankOrder(left, foeFlight(), [], 3, cfg)!
    // 把三架敵機堆在剛才選中的那個點上
    const others = [
      unit({ x: safe.point.x, y: safe.point.y, z: safe.point.z }),
      unit({ x: safe.point.x + 50, y: safe.point.y, z: safe.point.z }),
      unit({ x: safe.point.x - 50, y: safe.point.y, z: safe.point.z }),
    ]
    const moved = planFlankOrder(left, foeFlight(), others, 3, cfg)!
    expect(Math.sign(moved.point.x - 100)).toBe(-Math.sign(safe.point.x - 100))
  })

  it('兩邊都塞滿其他敵機 → null', () => {
    const a = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    const mirrorX = 200 - a.point.x   // 以目標質心 x=100 鏡射
    const others: CommandUnit[] = []
    for (const x of [a.point.x, mirrorX]) {
      for (const d of [-50, 0, 50]) {
        others.push(unit({ x: x + d, y: a.point.y, z: a.point.z }))
      }
    }
    expect(planFlankOrder(members, foeFlight(), others, 3, cfg)).toBeNull()
  })

  it('不會叫人撞海：高於 clearanceScale', () => {
    const low = [unit({ y: 50 })]
    const foe = [unit({ y: 50, z: 3000, cornerRatio: 0.8 })]
    const o = planFlankOrder(low, foe, [], 3, cfg)!
    expect(o.point.y).toBeGreaterThanOrEqual(DEFAULT_STEER.clearanceScale)
  })

  /** 高度上界取**我方**的最低升限：要飛上去的是我們，不是他們 */
  it('不超過我方的最低升限', () => {
    const high = [
      unit({ y: 11900, serviceCeiling: 12000 }),
      unit({ y: 11900, serviceCeiling: 9000 }),
    ]
    const foe = [unit({ y: 11900, z: 3000, cornerRatio: 0.8 })]
    const o = planFlankOrder(high, foe, [], 3, cfg)!
    expect(o.point.y).toBeLessThanOrEqual(9000)
  })
})

describe('planFlankOrder：退化與穩定性', () => {
  const members = [unit(), unit({ x: 200 })]

  /**
   * 【敵分隊速度退化】`CommandUnit` **沒有 orientation**，所以沒有「機首」
   * 可以退回去 —— 退化階梯改成「由我方指向他們」（把他們當成正在遠離我們）。
   * 那讓點落在我們與他們之間，可及而且安全。
   */
  it('敵分隊速度為零 → 不產生 NaN，仍給得出點', () => {
    const still = [unit({ z: 3000, cornerRatio: 0.8, velocity: new Vector3(0, 0, 0) })]
    const o = planFlankOrder(members, still, [], 3, cfg)!
    expect(Number.isNaN(o.point.x + o.point.y + o.point.z)).toBe(false)
  })

  it('敵分隊速度為零且與我方質心重合 → 仍不產生 NaN', () => {
    const still = [unit({ x: 100, cornerRatio: 0.8, velocity: new Vector3(0, 0, 0) })]
    const o = planFlankOrder(members, still, [], 3, cfg)!
    expect(Number.isNaN(o.point.x + o.point.y + o.point.z)).toBe(false)
  })

  /** 【決定性】spec §7.5 的否決條件 */
  it('同一個快照算兩次，逐位元相同', () => {
    const a = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    const b = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    expect(a.point.x).toBe(b.point.x)
    expect(a.point.y).toBe(b.point.y)
    expect(a.point.z).toBe(b.point.z)
    expect(a.side).toBe(b.side)
  })

  /**
   * 【連續性】spec §7.5 的否決條件。
   *
   * 【為什麼微擾的是目標分隊而不是「其他敵機」】選邊是一個**離散**決定，
   * 而其他敵機的微擾在兩邊危險分數相近時會翻邊，位移就是 2×flankOffset。
   * 那個不連續是**刻意的而且被封住了**：`side` 發令後凍結（spec §4.2），
   * 所以翻邊只可能發生在「還沒發令」的那一刻，不會傳到飛行中的飛機身上。
   * 這一條驗的是**給定一邊之後**，點對目標移動的連續性。
   */
  it('目標分隊位置微擾 ±20 m，側翼點的位移有界', () => {
    const base = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    for (const d of [-20, 20]) {
      const moved = planFlankOrder(members, foeFlight({ x: d }), [], 3, cfg)!
      expect(moved.side).toBe(base.side)
      expect(moved.point.distanceTo(base.point)).toBeLessThan(60)
    }
  })

  /**
   * 【危險分數連續】用平方反比核而不是「半徑內的計數」。計數需要一個半徑
   * 門檻，而門檻會讓分數在邊界上跳 —— 與 `targetScore` 的三個折扣項、
   * `floorPitchAngle` 的連續斜坡同一條紀律。
   *
   * 驗法：把一架敵機從很遠慢慢移近選中的點，選邊不得在中途翻轉超過一次。
   * 翻轉超過一次代表分數不是單調的，那只可能來自不連續。
   */
  it('單一敵機從遠處逼近時，選邊最多翻轉一次', () => {
    const base = planFlankOrder(members, foeFlight(), [], 3, cfg)!
    let flips = 0
    let prev = base.side
    for (let z = 6000; z >= base.point.z; z -= 100) {
      const others = [unit({ x: base.point.x, y: base.point.y, z })]
      const o = planFlankOrder(members, foeFlight(), others, 3, cfg)!
      if (o.side !== prev) flips++
      prev = o.side
    }
    expect(flips).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "planFlankOrder"
```

預期：編譯失敗，`planFlankOrder` 不存在。

- [ ] **Step 3: 寫 `flankPoint` 這個共用的幾何**

接在 `planFlightOrder` 之後。**它同時被 `planFlankOrder`（算兩邊比危險）
與 `stepCommand` 的每步重算用** —— 兩處共用同一段幾何，不寫兩份。

```ts
/**
 * 側翼點的幾何。寫進 `out`，回傳 `false` 代表輸入退化到連質心都算不出來
 * （呼叫端保留舊點）。
 *
 * ```
 * u    = 目標分隊平均速度的水平單位向量
 * r    = u 的右手側水平法向量
 * out  = 目標質心 − u × flankTrail + side × r × flankOffset
 * out.y = clamp(目標質心.y + flankClimb, clearanceScale, 我方最低升限)
 * ```
 *
 * `−u × flankTrail` 把點放到他們**後方**而不是正側方：正側方是一個過渡
 * 位置，後側方才是能開始追蹤射擊的位置。
 *
 * 【退化階梯】`CommandUnit` **沒有 orientation**，所以沒有「機首」可以像
 * `stationPoint` 那樣退回去。改成：目標速度退化 → 由我方質心指向目標質心
 * （把他們當成正在遠離我們，點因此落在我們與他們之間，可及而且安全）→
 * 兩個質心也重合 → 取世界 −Z。**不 return NaN**：NaN 一旦進入距離比較，
 * 所有比較都變成 false，小隊會靜靜地永遠飛不到而且完全不報錯。
 *
 * 熱路徑：不配置（`stepCommand` 每步呼叫它）。
 */
function flankPoint(
  target: readonly CommandUnit[],
  own: readonly CommandUnit[],
  side: number,
  cfg: CommandConfig,
  out: Vector3,
): boolean {
  // ── 目標分隊的質心與平均速度 ──────────────────────────
  const foe = F.v[0]!.set(0, 0, 0)
  const vel = F.v[1]!.set(0, 0, 0)
  let m = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    if (!t.alive) continue
    foe.add(t.position)
    vel.add(t.velocity)
    m++
  }
  if (m === 0) return false
  foe.divideScalar(m)
  vel.divideScalar(m)

  // ── 我方質心與最低升限 ───────────────────────────────
  // 【上界取**我方**的升限】要飛上去的是我們，不是他們
  const us = F.v[2]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < own.length; i++) {
    const u = own[i]!
    if (!u.alive) continue
    us.add(u.position)
    if (u.serviceCeiling < ceiling) ceiling = u.serviceCeiling
    n++
  }
  if (n === 0) return false
  us.divideScalar(n)

  // ── 航向 u，退化階梯 ─────────────────────────────────
  let ux = vel.x
  let uz = vel.z
  let len = Math.hypot(ux, uz)
  if (len < MIN_HORIZONTAL) {
    ux = foe.x - us.x
    uz = foe.z - us.z
    len = Math.hypot(ux, uz)
    if (len < MIN_HORIZONTAL) {
      ux = 0
      uz = -1
      len = 1
    }
  }
  ux /= len
  uz /= len

  // 右手側：three 是 +X 右、+Y 上、−Z 前，所以航向 (ux, uz) 的右邊是
  // (−uz, ux)。驗算：朝 −Z（ux=0, uz=−1）時右邊是 (1, 0) = +X。
  // 與 `stationPoint` 的同一段驗算一致。
  const rx = -uz
  const rz = ux

  let y = foe.y + cfg.flankClimb
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  out.set(
    foe.x - ux * cfg.flankTrail + side * rx * cfg.flankOffset,
    y,
    foe.z - uz * cfg.flankTrail + side * rz * cfg.flankOffset,
  )
  return true
}

/** `flankPoint` 專用的暫存池。與其他函式分開，避免巢狀呼叫時別名衝突 */
const F = makeScratch(5)
```

- [ ] **Step 4: 寫危險分數**

```ts
/**
 * 一個候選點的危險分數：其他敵機離它多近。
 *
 * ```
 * danger(p) = Σ 1 / (1 + (|p − e| / dangerScale)²)
 * ```
 *
 * 【為什麼是平方反比核而不是「半徑內的計數」】計數需要一個半徑門檻，而門檻
 * 會讓分數在邊界上跳。連續核在相鄰輸入上連續 —— 與 `targetScore` 的三個
 * 折扣項、`floorPitchAngle` 的連續斜坡同一條紀律（spec §7.5 的否決條件）。
 *
 * 【為什麼不算目標分隊自己】側翼點本來就該靠近它。把它算進去等於懲罰
 * 「靠近要打的人」—— 呼叫端傳進來的 `others` 已經排除了目標分隊。
 *
 * 【為什麼不算友機】友機不危險。這裡問的是「這個點會不會被打」。
 *
 * 熱路徑之外（每 `planPeriod` 秒），不配置。
 */
function dangerAt(p: Vector3, others: readonly CommandUnit[], cfg: CommandConfig): number {
  let sum = 0
  for (let i = 0; i < others.length; i++) {
    const e = others[i]!
    if (!e.alive) continue
    const d = p.distanceTo(e.position) / cfg.dangerScale
    sum += 1 / (1 + d * d)
  }
  return sum
}
```

- [ ] **Step 5: 寫 `planFlankOrder`**

```ts
/** 選邊時「兩邊一樣安全」的判定寬容度。低於它就改用就近 */
const DANGER_TIE = 1e-9

/**
 * 從敵分隊的後側方切進去。`null` = 不該下這張命令。
 *
 * **純函數**：只讀三個快照陣列，不改它們，不碰世界（spec §6.3）。
 *
 * 【三種 `null`】目標分隊沒在交戰（spec §3.1 的開場死鎖防護）、任一邊全滅、
 * 兩個候選點都太危險。最後一條與 `planFocusTarget` 的「沒有一架可及」是同一
 * 條紀律：**規劃層寧可不發，也不發一張執行不了的命令。**
 *
 * 【配置】發令時配置一個 `Vector3`，每 `planPeriod` 秒最多一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param others 其餘敵機（**不含**目標分隊），算危險分數用
 * @param targetFlight 目標分隊的全域索引，原封不動寫進命令
 */
export function planFlankOrder(
  members: readonly CommandUnit[],
  target: readonly CommandUnit[],
  others: readonly CommandUnit[],
  targetFlight: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  // ── 開場死鎖防護（spec §3.1）────────────────────────────
  // 目標分隊要**已經被別人纏住**。少了這道閘門，開場所有人同時側翼、
  // 途中又不交戰，兩隊會互相繞圈一槍不開 —— 而且會自我維持
  let engaged = false
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    if (t.alive && t.cornerRatio < ENGAGED_RATIO) { engaged = true; break }
  }
  if (!engaged) return null

  const right = P.v[0]!
  const left = P.v[1]!
  if (!flankPoint(target, members, 1, cfg, right)) return null
  if (!flankPoint(target, members, -1, cfg, left)) return null

  const dr = dangerAt(right, others, cfg)
  const dl = dangerAt(left, others, cfg)

  let side: number
  if (dr < dl - DANGER_TIE) side = 1
  else if (dl < dr - DANGER_TIE) side = -1
  else {
    // 【一樣安全就取近的】轉場最短，也就是輸出為零的時間最短。
    // 用我方質心到兩個候選點的距離比
    const us = P.v[2]!.set(0, 0, 0)
    let n = 0
    for (let i = 0; i < members.length; i++) {
      const u = members[i]!
      if (!u.alive) continue
      us.add(u.position)
      n++
    }
    // n === 0 不可能走到這裡（flankPoint 已經回 false 了），但索引後的
    // 除法還是要防：NaN 會讓下面的比較靜靜地變成 false
    if (n > 0) us.divideScalar(n)
    side = us.distanceTo(right) <= us.distanceTo(left) ? 1 : -1
  }

  const chosen = side === 1 ? right : left
  if ((side === 1 ? dr : dl) > cfg.dangerLimit) return null

  return {
    kind: 'flank',
    point: chosen.clone(),
    radius: cfg.arriveRadius,
    targetFlight,
    side,
    focusIndex: -1,
  }
}
```

- [ ] **Step 6: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

**若「兩邊都塞滿其他敵機 → null」紅了**：先印出兩邊的 `dangerAt` 值再判斷。
`dangerLimit` 是 2.0，而三架貼在點上的分數約 3.0 —— 若實測不到 2.0，那是
測試場景的敵機擺得不夠近，**改測試的場景，不要改 `dangerLimit`**（它是待
掃描的參數，Task 8 才動）。

- [ ] **Step 7: Commit**

```bash
git add src/ai/command.ts test/unit/ai-command.test.ts
```

訊息：

```
feat: planFlankOrder —— 從敵分隊的後側方切進去

點放在敵航向的後方而不是正側方：正側方是一個過渡位置，後側方才是能
開始追蹤射擊的位置。

危險評估用平方反比核而不是「半徑內的計數」—— 計數需要一個半徑門檻，
而門檻會讓分數在邊界上跳。連續核在相鄰輸入上連續，與 targetScore 的
三個折扣項、floorPitchAngle 的連續斜坡同一條紀律。有一條測試守著：
單一敵機從遠處逼近時，選邊最多翻轉一次。

選邊是離散決定，兩邊一樣安全時取近的（轉場最短 = 輸出為零的時間最
短）。那個不連續是刻意的而且被封住了：side 發令後凍結，翻邊只可能
發生在還沒發令的那一刻。

退化階梯與 stationPoint 形狀一致，但少一階 —— CommandUnit 沒有
orientation，沒有機首可以退回去。改成「由我方指向目標」，那讓點落在
我們與他們之間，可及而且安全。

「目標分隊已經在交戰」是開場死鎖的防護：少了它，開場五對五全都健康
又全都很遠，所有人同時側翼、途中又不交戰，兩隊會互相繞圈一槍不開，
而且會自我維持（雙方都在繞，「已經接戰」永遠不成立）。

高度上界取我方的最低升限而不是敵方的：要飛上去的是我們。
```

---

### Task 3: `planFocusTarget` —— 集火的規劃

**Files:**
- Modify: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `FlightOrder`、`CommandUnit`、`CommandConfig`
- Produces:
  - `function planFocusTarget(members, candidates, candidateIndices, cfg?): FlightOrder | null`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 檔案最後追加。把 `planFocusTarget` 加進
import：

```ts
describe('planFocusTarget', () => {
  /** 我方在原點朝 −Z 飛。候選敵機放在 −Z 方向（也就是航向上） */
  const members = [unit(), unit({ x: 200 })]
  /** 候選在 `units` 裡的全域索引，與 candidates 平行 */
  const IDX = [10, 11]

  it('兩架等距、一架受創 → 挑受創的', () => {
    const cands = [
      unit({ x: -300, z: -800, hpFraction: 1 }),
      unit({ x: 500, z: -800, hpFraction: 0.3 }),
    ]
    const o = planFocusTarget(members, cands, IDX, cfg)!
    expect(o.kind).toBe('focus')
    expect(o.focusIndex).toBe(11)
  })

  /** 【血量同值時的破平手】近的先打 —— 追得到的機會大 */
  it('兩架血量相同 → 挑近的', () => {
    const cands = [
      unit({ z: -1200, hpFraction: 0.5 }),
      unit({ z: -400, hpFraction: 0.5 }),
    ]
    expect(planFocusTarget(members, cands, IDX, cfg)!.focusIndex).toBe(11)
  })

  it('唯一的敵機在 focusRange 外 → null', () => {
    const far = [unit({ z: -(cfg.focusRange + 500) })]
    expect(planFocusTarget(members, far, [10], cfg)).toBeNull()
  })

  /**
   * 【可及性用夾角而不是 turnTime】`assess.ts` 的 `turnTime` 吃兩架
   * `Aircraft`，而規劃層只吃快照 —— 收 `Aircraft` 會毀掉「能直接餵字面
   * 物件出考題」這個性質（spec §5.2）。夾角不是它的近似，是另一個問題的
   * 精確答案：「這架敵機在不在我們正在去的方向上」。
   */
  it('在射程內但偏離航向超過 focusCone → null', () => {
    // 我方朝 −Z，這一架在正右方（夾角 90° > 60°）
    const side = [unit({ x: 800, z: 0 })]
    expect(planFocusTarget(members, side, [10], cfg)).toBeNull()
  })

  /**
   * 【可及性是閘門不是加權項】一個追不到的目標再好打也沒用。這一條若寫成
   * 「受創程度與可及性加權」就會挑錯 —— 而那正是最容易寫成的形狀。
   */
  it('受創但不可及、健康但可及 → 挑健康那架', () => {
    const cands = [
      unit({ x: 3000, z: 0, hpFraction: 0.1 }),   // 重傷但在正右方且很遠
      unit({ z: -600, hpFraction: 1 }),           // 毫髮無傷但在航向上
    ]
    expect(planFocusTarget(members, cands, IDX, cfg)!.focusIndex).toBe(11)
  })

  it('全部陣亡 → null', () => {
    const dead = [unit({ z: -600, alive: false })]
    expect(planFocusTarget(members, dead, [10], cfg)).toBeNull()
  })

  it('我方全滅 → null', () => {
    const gone = [unit({ alive: false })]
    expect(planFocusTarget(gone, [unit({ z: -600 })], [10], cfg)).toBeNull()
  })

  /** 【決定性】spec §7.5 的否決條件 */
  it('同一個快照算兩次，回同一個索引', () => {
    const cands = [unit({ z: -600, hpFraction: 0.4 }), unit({ z: -700, hpFraction: 0.4 })]
    const a = planFocusTarget(members, cands, IDX, cfg)!
    const b = planFocusTarget(members, cands, IDX, cfg)!
    expect(a.focusIndex).toBe(b.focusIndex)
  })

  /**
   * 【我方速度退化時錐形閘門要放行】沒有速度就沒有「我們正在去的方向」，
   * 這時把所有人都擋掉會讓集火在起飛瞬間與重生瞬間靜靜地失效。
   */
  it('我方速度為零 → 錐形閘門放行，仍挑得出目標', () => {
    const still = [unit({ velocity: new Vector3(0, 0, 0) })]
    const cands = [unit({ x: 800, z: 0, hpFraction: 0.3 })]
    expect(planFocusTarget(still, cands, [10], cfg)!.focusIndex).toBe(10)
  })
})
```

- [ ] **Step 2: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "planFocusTarget"
```

預期：編譯失敗，`planFocusTarget` 不存在。

- [ ] **Step 3: 寫 `planFocusTarget`**

接在 `planFlankOrder` 之後：

```ts
/**
 * 叫整隊集火同一架。`null` = 沒有任何一架可及。
 *
 * **純函數**，理由同 `planFlankOrder`。
 *
 * 【挑血最少的，不是 `targetScore` 最高的】`targetScore` 吃 `Aircraft`
 * （要 orientation 算機首、要 `threatFactor`），收它會毀掉這一層能出考題的
 * 性質；用速度方向代替機首是一個近似，而近似會製造第二個「誰好打」的答案。
 *
 * 而且「血最少」本來就是更對的判準：集火的整個賣點是**讓目標更快掉下來**，
 * 已經受創的那一架離掉下來最近 —— 這是史實的「打落單、打受傷」。
 * `targetScore` 回答的是另一個問題（「誰對**我**最有價值」，含威脅項與機會
 * 項），那是**單機**選目標的問題，不是**小隊集火**的問題。
 *
 * 【可及性是閘門不是加權項】一個追不到的目標再好打也沒用。寫成加權會在
 * 「重傷但追不到」與「健康但就在眼前」之間挑錯，有測試守著。
 *
 * @param candidateIndices 與 `candidates` **平行**，內容是 `units` 的全域索引
 */
export function planFocusTarget(
  members: readonly CommandUnit[],
  candidates: readonly CommandUnit[],
  candidateIndices: readonly number[],
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  // ── 我方質心與平均航向 ───────────────────────────────
  const us = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  for (let i = 0; i < members.length; i++) {
    const u = members[i]!
    if (!u.alive) continue
    us.add(u.position)
    vel.add(u.velocity)
    n++
  }
  if (n === 0) return null
  us.divideScalar(n)
  vel.divideScalar(n)

  // 【速度退化時錐形閘門放行】沒有速度就沒有「我們正在去的方向」。把所有人
  // 都擋掉會讓集火在重生瞬間靜靜地失效 —— 而那不是一個看得出來的失效
  let hx = vel.x
  let hz = vel.z
  const hlen = Math.hypot(hx, hz)
  const hasHeading = hlen >= MIN_HORIZONTAL
  if (hasHeading) { hx /= hlen; hz /= hlen }

  const cosCone = Math.cos(cfg.focusCone)

  let best = -1
  let bestHp = Infinity
  let bestDist = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive) continue

    const dist = us.distanceTo(c.position)
    if (dist > cfg.focusRange) continue

    if (hasHeading) {
      const dx = c.position.x - us.x
      const dz = c.position.z - us.z
      const dlen = Math.hypot(dx, dz)
      // 【水平重合時放行】方位沒有定義，而「就在我們頭上」不該被當成
      // 「偏離航向」擋掉
      if (dlen >= MIN_HORIZONTAL && (dx * hx + dz * hz) / dlen < cosCone) continue
    }

    // 血少的優先；同值取近的
    if (c.hpFraction < bestHp || (c.hpFraction === bestHp && dist < bestDist)) {
      best = i
      bestHp = c.hpFraction
      bestDist = dist
    }
  }
  if (best < 0) return null

  return {
    kind: 'focus',
    // 【集火不用點】給一個新的零向量而不是共用一個模組層級的常數 ——
    // 共用的可變向量被誰改到都查不出來。每 `planPeriod` 秒最多一次，不在
    // 熱路徑上
    point: new Vector3(),
    radius: 0,
    targetFlight: -1,
    side: 0,
    focusIndex: candidateIndices[best]!,
  }
}
```

- [ ] **Step 4: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 5: Commit**

```bash
git add src/ai/command.ts test/unit/ai-command.test.ts
```

訊息：

```
feat: planFocusTarget —— 集火挑血最少的那一架

不重用 targetScore：它吃 Aircraft（要 orientation 算機首、要
threatFactor），收它會毀掉「純函數能直接餵字面物件出考題」這個性質，
而用速度方向代替機首是一個近似 —— 近似會製造第二個「誰好打」的答案。

而且「血最少」本來就是更對的判準：集火的整個賣點是讓目標更快掉下來，
已經受創的那一架離掉下來最近。targetScore 回答的是另一個問題（誰對
我最有價值，含威脅項與機會項），那是單機選目標的問題，不是小隊集火
的問題。

可及性用夾角而不是 turnTime，理由同上。夾角不是 turnTime 的近似，是
另一個問題的精確答案：「這架敵機在不在我們正在去的方向上」。

可及性是閘門不是加權項 —— 一個追不到的目標再好打也沒用。有一條測試
專門守這個（重傷但不可及 vs 健康但可及），那是最容易寫錯的形狀。

我方速度退化時錐形閘門放行：沒有速度就沒有「我們正在去的方向」，把
所有人都擋掉會讓集火在重生瞬間靜靜地失效。
```

---

### Task 4: `stepCommand` —— 換簽名，加兩個生命週期

**Files:**
- Modify: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `planFlankOrder` / `flankPoint`；Task 3 的
  `planFocusTarget`
- Produces:
  - `stepCommand(s, flights, own, foe, units, skipFlight, dt, cfg?)`
    —— **簽名改了**，攤平的 `enemies` 參數消失

- [ ] **Step 1: 讀懂現行的 `stepCommand` 與它的一個浪費**

不要改，只讀 `src/ai/command.ts` 約第 300 行起的 `stepCommand`。注意它
`for (let f = 0; f < flights.length; f++)` 掃**全部**分隊 —— 包含敵方的。
呼叫端（`setup.ts`）之後才依 `flight.team` 挑出要用的那些，所以**藍方指揮官
替紅方分隊也規劃了一遍，結果從來不被讀**。正確但浪費一半的規劃工作，而且
讀起來會讓人以為藍方在指揮紅方。

側翼要挑「某一個敵分隊」，本來就需要敵方的**分隊結構**而不是攤平的名單，
所以一併修掉。

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 的「stepCommand：命令的生命週期」那個
`describe` **之後**追加一個新的 `describe`：

```ts
describe('stepCommand：側翼與集火的生命週期', () => {
  /**
   * 我方分隊 0（兩架，在原點朝 −Z）、敵分隊 1（兩架）。
   * `units` 的索引：0/1 = 我方，2/3 = 敵方。
   */
  function scene(foeZ: number, foeEngaged = true) {
    const cr = foeEngaged ? 0.8 : 1.2
    const units: CommandUnit[] = [
      unit({ cornerRatio: 1.2 }),
      unit({ x: 200, cornerRatio: 1.2 }),
      unit({ z: foeZ, cornerRatio: cr }),
      unit({ x: 200, z: foeZ, cornerRatio: cr }),
    ]
    const flights = [flight(0, 1), flight(2, 3)]
    const s = createCommandState(flights.length)
    return { units, flights, s, own: [0], foe: [1] }
  }
  function run(sc: ReturnType<typeof scene>, seconds: number, skip = -1) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, skip, DT, cfg)
    }
  }

  it('健康的小隊、敵分隊在交戰且很遠 → 側翼', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]!.kind).toBe('flank')
    expect(sc.s.orders[0]!.targetFlight).toBe(1)
  })

  it('健康的小隊、敵分隊很近 → 集火', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]!.kind).toBe('focus')
    // 兩架敵機血量相同，取近的 —— 索引 2 與 3 等距，取先掃到的 2
    expect(sc.s.orders[0]!.focusIndex).toBe(2)
  })

  /**
   * 【撤退優先於兩個新戰術】spec §3。打不動的小隊不該被派去執行任何進攻
   * 戰術。這一條若紅了，代表規劃的順序寫反了。
   */
  it('見底的小隊拿到的是 rally 而不是 flank', () => {
    const sc = scene(4000)
    for (const i of [0, 1]) sc.units[i]!.cornerRatio = 0.4
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[0]!.kind).toBe('rally')
  })

  /** 【凍結的是決定，不是座標】spec §4.2 */
  it('側翼的 point 跟著敵分隊移動，side 與 targetFlight 不變', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod + DT)
    const o = sc.s.orders[0]!
    const before = o.point.clone()
    const side = o.side
    for (const i of [2, 3]) sc.units[i]!.position.x += 1500
    run(sc, DT * 2)
    expect(sc.s.orders[0]!.point.x).not.toBe(before.x)
    expect(sc.s.orders[0]!.side).toBe(side)
    expect(sc.s.orders[0]!.targetFlight).toBe(1)
  })

  /**
   * 【側翼的到達是幾何判定】進入後側方扇區且距離進入 FLANK_RANGE。
   * 把我方瞬移到敵分隊的正後方 1000 m 處 —— 敵方朝 −Z 飛，正後方是 +Z。
   */
  it('進入後側方扇區且夠近 → 側翼命令解除', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]).not.toBeNull()
    for (const i of [0, 1]) sc.units[i]!.position.set(100, 4000, 5000)
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  /** 【還在正面就不算到達】同樣的距離，但在他們前方 */
  it('距離夠近但在敵分隊正前方 → 側翼命令不解除', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod + DT)
    for (const i of [0, 1]) sc.units[i]!.position.set(100, 4000, 3000)
    run(sc, DT * 2)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  it('集火目標陣亡 → 命令解除', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    const idx = sc.s.orders[0]!.focusIndex
    sc.units[idx]!.alive = false
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【集火的遲滯】發令要求離小隊質心不到 `focusRange`（1500），解除要求
   * 超過 `FLANK_RANGE`（2500）—— 兩個不同的數字就是遲滯。用同一個門檻
   * 發令與解除會在邊界上抖。
   */
  it('集火目標跑遠 → 命令解除', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    for (const i of [2, 3]) sc.units[i]!.position.z = -4000
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('集火目標只跑到 focusRange 與 FLANK_RANGE 之間 → 命令不解除', () => {
    const sc = scene(-800)
    run(sc, cfg.planPeriod + DT)
    for (const i of [2, 3]) sc.units[i]!.position.z = -2000
    run(sc, DT * 2)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  /** 【不替敵方分隊規劃】`own` 以外的格子必須恆為 null */
  it('own 以外的分隊完全不碰', () => {
    const sc = scene(4000)
    run(sc, cfg.planPeriod * 3)
    expect(sc.s.orders[1]).toBeNull()
  })
})
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "側翼與集火的生命週期"
```

預期：編譯失敗 —— `stepCommand` 的第三個參數收的是 `units` 不是 `own`。

- [ ] **Step 4: 換 `stepCommand` 的簽名與迴圈**

把 `stepCommand` 的簽名與 JSDoc 的 `@param` 換成：

```ts
/**
 * 推進指揮官一步：累積見底計時、維護命令、到期時規劃。
 *
 * 【為什麼計時每步跑而規劃每 N 秒跑】見底是一個**持續**條件（第一份
 * spec §2.4），漏數任何一步都會低估；而規劃是昂貴的而且是戰役尺度的決定，
 * 不該與戰機的機動同頻。這與 `AiController` 把幾何放 240 Hz、意圖仲裁放
 * 10 Hz 是同一個分頻原則。
 *
 * 【為什麼收 `own` / `foe` 兩組分隊索引】舊版收攤平的敵機名單並掃**全部**
 * 分隊，於是藍方指揮官替紅方分隊也規劃了一遍、結果從來不被讀 —— 浪費一半
 * 的規劃工作，而且讀起來會讓人以為藍方在指揮紅方。側翼要挑「某一個敵分隊」
 * 本來就需要敵方的分隊結構，一併修掉。
 *
 * 熱路徑：每步的部分不配置（側翼點的重算走 `flankPoint`，寫進既有的
 * `order.point`）。發令的那一格會配置一個 `Vector3`。
 *
 * @param flights  **全部**分隊，全域索引
 * @param own      這個指揮官管的分隊索引
 * @param foe      敵方的分隊索引
 * @param units    每架快照，全域索引，與 `CommandFlight.members` 對應
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 */
export function stepCommand(
  s: CommandState,
  flights: readonly CommandFlight[],
  own: readonly number[],
  foe: readonly number[],
  units: readonly CommandUnit[],
  skipFlight: number,
  dt: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
```

把外層迴圈 `for (let f = 0; f < flights.length; f++) { const flight = flights[f]! ` 換成：

```ts
  for (let oi = 0; oi < own.length; oi++) {
    const f = own[oi]!
    const flight = flights[f]!
```

（迴圈裡其餘的 `f` 一個字都不用改。）

- [ ] **Step 5: 換「到達判定」那一段成三種命令各自的維護**

把現行的「到達判定」整段（`const order = s.orders[f]` 到那個 `continue`）
換成：

```ts
    // ── 命令的維護：三種各自的解除條件 ────────────────────
    const order = s.orders[f]
    if (order !== undefined && order !== null) {
      if (order.kind === 'focus') {
        const t = units[order.focusIndex]
        // 【兩個解除條件】目標陣亡，或跑到遲滯帶之外。
        // 發令要求 < focusRange（1500）、解除要求 > FLANK_RANGE（2500），
        // 兩個不同的數字就是遲滯 —— 同一個門檻發令與解除會在邊界上抖
        if (t === undefined || !t.alive
          || centroidDistance(flight, units, t.position) > FLANK_RANGE) {
          s.orders[f] = null
        }
      } else if (order.kind === 'flank') {
        const tf = flights[order.targetFlight]
        if (tf === undefined || tf.count === 0) {
          // 目標分隊全滅：這張命令沒有對象了
          s.orders[f] = null
        } else {
          gather(TARGET, tf, units)
          gather(MEMBERS, flight, units)
          // 【點每步重算】凍結的是 side 與 targetFlight，不是座標。
          // 算不出來（兩邊都全滅）時保留舊點，下一步再試
          flankPoint(TARGET, MEMBERS, order.side, cfg, order.point)
          if (flankArrived(MEMBERS, TARGET, cfg)) s.orders[f] = null
        }
      } else {
        // rally：到達用小隊質心與半徑判。個別成員可能正在閃躲而落後，
        // 整隊到了就算到了
        if (centroidDistance(flight, units, order.point) <= order.radius) {
          s.orders[f] = null
          // 【歸零就是遲滯】要再累積滿 spentSeconds 才會重發（第一份
          // spec §4.2）。少了這一行，抵達的下一格就會立刻重發
          s.spent[f] = 0
        }
      }
      continue
    }
```

- [ ] **Step 6: 換「規劃」那一段成三層優先序**

把現行的規劃段（`if (!plan) continue` 到 `s.orders[f] = planFlightOrder(...)`）
換成：

```ts
    // ── 規劃：撤退 > 側翼 > 集火 ─────────────────────────
    if (!plan) continue
    gather(MEMBERS, flight, units)

    // 一：撤退。它自己會在還沒累積滿 spentSeconds 時回 null，所以無條件
    // 呼叫是便宜的。**優先於兩個進攻戰術** —— 打不動的小隊不該被派出去
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
    if (retreat !== null) { s.orders[f] = retreat; continue }

    // 二：挑最近的敵分隊
    let nearest = -1
    let nearestDist = Infinity
    for (let fi = 0; fi < foe.length; fi++) {
      const gi = foe[fi]!
      const ef = flights[gi]
      if (ef === undefined || ef.count === 0) continue
      gather(TARGET, ef, units)
      if (TARGET.length === 0) continue
      let cx = 0, cz = 0, cy = 0
      for (let i = 0; i < TARGET.length; i++) {
        cx += TARGET[i]!.position.x; cy += TARGET[i]!.position.y; cz += TARGET[i]!.position.z
      }
      const k = TARGET.length
      const d = centroidDistanceTo(MEMBERS, cx / k, cy / k, cz / k)
      if (d < nearestDist) { nearestDist = d; nearest = gi }
    }
    if (nearest < 0) continue

    // 三：遠 → 側翼；近 → 集火（spec §3.2）
    const tf = flights[nearest]!
    gather(TARGET, tf, units)
    if (nearestDist > FLANK_RANGE) {
      OTHERS.length = 0
      TARGET_IDX.length = 0
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
      s.orders[f] = planFlankOrder(MEMBERS, TARGET, OTHERS, nearest, cfg)
    } else {
      TARGET_IDX.length = 0
      for (let p = 0; p < tf.count; p++) {
        const gi = tf.members[p]!
        const u = units[gi]
        if (u !== undefined && u.alive) TARGET_IDX.push(gi)
      }
      s.orders[f] = planFocusTarget(MEMBERS, TARGET, TARGET_IDX, cfg)
    }
```

- [ ] **Step 7: 寫四個小工具與暫存陣列**

放在 `stepCommand` 之後（把現行那個只有 `MEMBERS` 的區塊整個換掉）：

```ts
/**
 * 規劃時把分隊成員收集起來的暫存陣列。
 *
 * 【為什麼是模組層級的可變陣列】三個規劃函式都收 `readonly CommandUnit[]`
 * 是為了單元測試好寫字面陣列；而這裡每次規劃都 `new Array` 會在 20v20 下
 * 每兩秒配置幾十次。重用並在每次使用前 `length = 0`，與 `setup.ts` 的
 * `ASSISTS` 同一個做法。
 *
 * **`MEMBERS` 與 `TARGET` 不得在同一次 `gather` 之間交錯使用** —— 它們是
 * 不同的陣列，但同一個陣列被 gather 兩次就會失去第一次的內容。
 */
const MEMBERS: CommandUnit[] = []
const TARGET: CommandUnit[] = []
const OTHERS: CommandUnit[] = []
const FOES: CommandUnit[] = []
const TARGET_IDX: number[] = []

/** 把一個分隊的存活成員收進 `out`（先清空）。不配置 */
function gather(
  out: CommandUnit[], flight: CommandFlight, units: readonly CommandUnit[],
): void {
  out.length = 0
  for (let p = 0; p < flight.count; p++) {
    const u = units[flight.members[p]!]
    if (u !== undefined && u.alive) out.push(u)
  }
}

/** 一個分隊的存活質心離 `p` 多遠。全滅時回 `Infinity`（比不上任何門檻） */
function centroidDistance(
  flight: CommandFlight, units: readonly CommandUnit[], p: Vector3,
): number {
  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return Infinity
  return Math.hypot(cx / n - p.x, cy / n - p.y, cz / n - p.z)
}

/** 已經收集好的一群的質心離 (x,y,z) 多遠。全滅時回 `Infinity` */
function centroidDistanceTo(
  group: readonly CommandUnit[], x: number, y: number, z: number,
): number {
  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < group.length; i++) {
    const u = group[i]!
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return Infinity
  return Math.hypot(cx / n - x, cy / n - y, cz / n - z)
}

/**
 * 側翼到位了嗎 —— **幾何判定，不是距離**。
 *
 * ```
 * u = 敵分隊平均速度的水平單位向量
 * d = 由敵分隊質心指向我方質心的水平單位向量
 * 到位 ⇔ d · u < cos(flankSector)  且  兩個質心的距離 < FLANK_RANGE
 * ```
 *
 * 【為什麼不用「離側翼點小於 arriveRadius」】那個判準在追一個移動目標時
 * 可能永遠不成立，正是第一份 spec §4.1 記載的病 —— 而敵**分隊**質心 30 秒
 * 飄 2040~4663 m（實測）。幾何判準不會過期。
 *
 * 【為什麼距離門用 `FLANK_RANGE` 而不是新的一個數字】側翼命令的**發出**
 * 條件就是距離 > `FLANK_RANGE`，所以解除用同一條線不會抖：解除的那一格
 * 距離必然 < `FLANK_RANGE`，下一次規劃走的是集火那一支。
 *
 * 熱路徑：不配置（每步呼叫）。
 */
function flankArrived(
  members: readonly CommandUnit[],
  target: readonly CommandUnit[],
  cfg: CommandConfig,
): boolean {
  let fx = 0, fy = 0, fz = 0, vx = 0, vz = 0, m = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    fx += t.position.x; fy += t.position.y; fz += t.position.z
    vx += t.velocity.x; vz += t.velocity.z
    m++
  }
  if (m === 0) return false
  fx /= m; fy /= m; fz /= m; vx /= m; vz /= m

  let ux = vx
  let uz = vz
  let ulen = Math.hypot(ux, uz)
  // 【速度退化時不算到位】方向沒有定義就沒有「後側方」可言。回 false 讓
  // 命令繼續 —— 比誤判到位安全，下一步速度多半就回來了
  if (ulen < MIN_HORIZONTAL) return false
  ux /= ulen; uz /= ulen

  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < members.length; i++) {
    const u = members[i]!
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return false
  cx /= n; cy /= n; cz /= n

  if (Math.hypot(cx - fx, cy - fy, cz - fz) >= FLANK_RANGE) return false

  let dx = cx - fx
  let dz = cz - fz
  const dlen = Math.hypot(dx, dz)
  // 【水平重合】方位沒有定義。當成到位 —— 已經貼在他們身上了
  if (dlen < MIN_HORIZONTAL) return true
  dx /= dlen; dz /= dlen

  return dx * ux + dz * uz < Math.cos(cfg.flankSector)
}
```

- [ ] **Step 8: 修唯一的生產呼叫端**

`src/battle/setup.ts` 的 `stepCommandLayer` 會編譯失敗。**這一步只做讓它
編譯過的最小改動**，完整的接線在 Task 6。把兩個 `stepCommand(...)` 呼叫
換成：

```ts
  // 分隊的隊伍歸屬不會變，但 Task 6 才把它移到 createBattle 算一次。
  // 這裡先每步算，功能正確、成本可接受
  BLUE_FLIGHTS.length = 0
  RED_FLIGHTS.length = 0
  for (let f = 0; f < b.flights.flights.length; f++) {
    ;(b.flights.flights[f]!.team === 'blue' ? BLUE_FLIGHTS : RED_FLIGHTS).push(f)
  }

  const playerFlight = b.flights.pinned >= 0 ? b.flights.flightOf[b.flights.pinned]! : -1
  stepCommand(
    b.blueCommand, b.flights.flights, BLUE_FLIGHTS, RED_FLIGHTS,
    b.commandUnits, playerFlight, dt,
  )
  stepCommand(
    b.redCommand, b.flights.flights, RED_FLIGHTS, BLUE_FLIGHTS,
    b.commandUnits, playerFlight, dt,
  )
```

刪掉 `BLUE_UNITS` / `RED_UNITS` 兩個模組陣列與填充它們的那個迴圈，換成：

```ts
/** 指揮層每步收集的兩隊**分隊索引**。重用陣列，與 `ASSISTS` 同一個做法 */
const BLUE_FLIGHTS: number[] = []
const RED_FLIGHTS: number[] = []
```

- [ ] **Step 9: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
npx vitest run test/integration/ai-command-channel.test.ts
```

預期：全綠、`tsc` 無輸出。

**通道驗收（第一份的五條）現在會跑到新的戰術。** 若有紅的：

- 「多數命令會因為到達而解除」紅 → 先印出 `issued` 與 `arrived`，**分辨是
  哪一種命令到不了**（在 `observe()` 裡依 `kind` 分開數）。這是設計問題不是
  參數問題，**停下來報告**。
- 「命令期間不動用安全層的撞地接管」紅 → 側翼點可能被放到低空。先印出
  觸發時的高度再判斷，**不得逕自調 `flankClimb`**（它是 Task 8 才動的參數）。

- [ ] **Step 10: Commit**

```bash
git add src/ai/command.ts src/battle/setup.ts test/unit/ai-command.test.ts
```

訊息：

```
feat: stepCommand 收兩組分隊索引，加側翼與集火的生命週期

舊版收攤平的敵機名單並掃全部分隊，於是藍方指揮官替紅方分隊也規劃了
一遍、結果從來不被讀 —— 浪費一半的規劃工作，而且讀起來會讓人以為
藍方在指揮紅方。側翼要挑「某一個敵分隊」本來就需要敵方的分隊結構，
一併修掉。

規劃的優先序是撤退 > 側翼 > 集火。撤退優先於兩個進攻戰術：打不動的
小隊不該被派出去。有測試守著。

側翼的點每步重算而 side 與 targetFlight 凍結 —— 凍結的是決定不是
座標。到達改用幾何判定（進入後側方扇區且距離進入 FLANK_RANGE），
因為「離某個點夠近」在追一個移動目標時可能永遠不成立，而敵分隊質心
30 秒飄 2040~4663 m。

集火的遲滯用兩個既有的數字：發令要求 < focusRange（1500）、解除要求
> FLANK_RANGE（2500）。同一個門檻發令與解除會在邊界上抖，而多開一個
參數不如用兩個本來就有的。
```

---

### Task 5: 戰機端 —— 集火不碰意圖，只換目標

**Files:**
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-controller.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `OrderKind`
- Produces: `AiController.focusTarget: Aircraft | null`

- [ ] **Step 1: 讀懂三個插入點**

不要改，只讀 `src/ai/AiController.ts`：

- `if (this.order !== null) { this.intent = … }` —— 在 `stepRules` 那一行
  的正下方，`if (decide)` 區塊內。
- `if (this.order !== null && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE)`
  —— 在 `if (this.board) { … }` 之後、`const target = this.target` 之前。
- `steerCommand(...)` 那一段的 `this.order === null ? null : this.order.point`。

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/ai-controller.test.ts` 的「指揮層的命令」那個 `describe` 最後
追加。需要 `type FlightOrder` 從 `'../../src/ai/command'` 匯入：

```ts
  /** 造一張命令，只覆寫要關心的欄位 */
  function order(over: Partial<FlightOrder>): FlightOrder {
    return {
      kind: 'rally', point: new Vector3(5000, 4000, 0), radius: 300,
      targetFlight: -1, side: 0, focusIndex: -1, ...over,
    }
  }

  /**
   * 【集火不碰意圖】它與另外兩種命令最大的差別，也是 `OrderKind` 必須存在
   * 的理由：`rally` 與 `flank` 是「不要打，去那裡」，`focus` 是「打那一架」。
   */
  it('集火命令不把意圖壓成 rally', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    ai.order = order({ kind: 'focus', focusIndex: 3 })
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).not.toBe('rally')
  })

  it('側翼命令把意圖壓成 rally（轉向需求與集合點相同）', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    ai.order = order({ kind: 'flank', targetFlight: 1, side: 1 })
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).toBe('rally')
  })

  /**
   * 【長機被覆寫】`focusTarget` 只作用在沒有站位參考機的那一架。僚機走
   * 既有的 `LEVEL_FOCUS`（「打參考機正在打的那一架」），那一級本來就有
   * 自衛與掩護插隊 —— 「有人正在打我」不會被集火命令擋住。
   */
  it('集火時長機的目標被覆寫成指定的那一架', () => {
    const ai = new AiController()
    const self = flyer()
    const chosen = flyer()
    chosen.state.position.set(1200, 4000, -400)
    const other = flyer()
    other.state.position.set(0, 4000, -800)
    ai.target = other
    ai.order = order({ kind: 'focus', focusIndex: 3 })
    ai.focusTarget = chosen
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.target).toBe(chosen)
  })

  /** 【僚機不被覆寫】它靠 LEVEL_FOCUS 跟上，那條路徑有自衛插隊 */
  it('集火時僚機的目標不被覆寫', () => {
    const ai = new AiController()
    const self = flyer()
    const leader = flyer()
    leader.state.position.set(-200, 4000, 100)
    const chosen = flyer()
    chosen.state.position.set(1200, 4000, -400)
    const other = flyer()
    other.state.position.set(0, 4000, -800)
    ai.stationReference = leader
    ai.target = other
    ai.order = order({ kind: 'focus', focusIndex: 3 })
    ai.focusTarget = chosen
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.target).not.toBe(chosen)
  })
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-controller.test.ts -t "指揮層的命令"
```

預期：編譯失敗，`focusTarget` 不存在。

- [ ] **Step 4: 加 `focusTarget` 欄位**

在 `order` 欄位的正下方：

```ts
  /**
   * 集火命令指定的那一架。`null` = 沒有指定。由 `setup.ts` 每步寫入。
   *
   * 【為什麼不直接放在 `FlightOrder` 裡】命令住在 `src/ai/command.ts`，而
   * 那一層只吃索引不吃 `Aircraft`（規劃是純函數，見該檔的註解）。索引解析
   * 成 `Aircraft` 是 `battle` 層的事 —— 與 `stationReference` 同一個手法。
   *
   * 【陣亡由 `setup.ts` 擋】它解析索引時若那一架已經退場就寫 `null`。
   * `AiController` 不必知道「命令裡的索引可能過期」這回事。
   */
  focusTarget: Aircraft | null = null
```

- [ ] **Step 5: 兩處既有覆寫加 `kind !== 'focus'` 條件**

意圖覆寫那一段：

```ts
      // 【集火不碰意圖】它是三種命令裡唯一「要交戰」的一種（spec §5.4）。
      // rally 與 flank 是「不要打，去那裡」，focus 是「打那一架」——
      // 壓成 rally 會讓集火命令反而停止交戰，那是完全相反的效果
      if (this.order !== null && this.order.kind !== 'focus') {
        this.intent = this.rules.defendLatch ? 'defend' : 'rally'
      }
```

僚機限制那一段：

```ts
      // 【集火時僚機不能被清掉目標】它要靠既有的 LEVEL_FOCUS（「打參考機
      // 正在打的那一架」）跟上長機。清掉會讓它掉進「沒有目標 → 飛站位」，
      // 集火就只剩長機一架在打 —— 那個戰術的整個意義就沒了
      if (this.order !== null && this.order.kind !== 'focus'
        && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE) {
        this.target = null
      }
```

- [ ] **Step 6: 加長機的目標覆寫**

緊接在 Step 5 的僚機限制**下方**（仍在 `if (decide)` 區塊內）：

```ts
      // 【只覆寫長機】僚機走 LEVEL_FOCUS，那一級本來就有自衛與掩護插隊，
      // 「有人正在打我」不會被集火命令擋住。與集合點同一個手法：只操縱
      // 長機，編隊靠既有機制跟上，wingman.ts 一個字不動
      if (this.focusTarget !== null && !reference) this.target = this.focusTarget
```

- [ ] **Step 7: 集火時不傳集合點給 `steerCommand`**

```ts
    steerCommand(
      this.intent, mode, this.sit, this.basis, self, this.seaHeight,
      this.knobs, this.defend,
      // 【集火沒有點】它的 `point` 是一個沒有意義的零向量。意圖不會是
      // 'rally' 所以那個分支不會跑，但傳一個假的點進去是在賭別人不會改
      // 那個分支
      this.order === null || this.order.kind === 'focus' ? null : this.order.point,
      raw,
    )
```

- [ ] **Step 8: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-controller.test.ts test/unit/ai-steer.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 9: 負控制 —— 確認新測試有鑑別力**

暫時把 Step 5 意圖覆寫的 `&& this.order.kind !== 'focus'` 拿掉，跑

```
npx vitest run test/unit/ai-controller.test.ts -t "集火命令不把意圖壓成 rally"
```

預期：**紅**。確認後把條件加回去。

再暫時把 Step 6 的 `&& !reference` 拿掉，跑

```
npx vitest run test/unit/ai-controller.test.ts -t "集火時僚機的目標不被覆寫"
```

預期：**紅**。確認後加回去。

- [ ] **Step 10: Commit**

```bash
git add src/ai/AiController.ts test/unit/ai-controller.test.ts
```

訊息：

```
feat: 集火不碰意圖，只覆寫長機的目標

集火是三種命令裡唯一「要交戰」的一種。rally 與 flank 是「不要打，去
那裡」，focus 是「打那一架」—— 壓成 rally 會讓集火命令反而停止交戰，
那是完全相反的效果。同理僚機的「停止出擊」限制對 focus 也要關掉，
否則集火只剩長機一架在打。

只覆寫長機：僚機走既有的 LEVEL_FOCUS（「打參考機正在打的那一架」），
那一級本來就有自衛與掩護插隊，「有人正在打我」不會被集火命令擋住。
與集合點同一個手法：只操縱長機，編隊靠既有機制跟上，wingman.ts 一個
字不動。

focusTarget 是 Aircraft 而 FlightOrder 裡只放索引：規劃層是純函數、
只吃快照，索引解析成 Aircraft 是 battle 層的事 —— 與 stationReference
同一個手法。陣亡也由那一層擋。

四條新測試各做過負控制。
```

---

### Task 6: 接線 —— 分隊索引、血量、集火目標的解析

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/integration/ai-command-channel.test.ts`（只確認沒紅，不改判準）

**Interfaces:**
- Consumes: Task 4 的 `stepCommand` 新簽名；Task 5 的 `AiController.focusTarget`
- Produces: `Battle` 增加 `blueFlightIndices` / `redFlightIndices`

- [ ] **Step 1: `Battle` 加兩個分隊索引陣列**

在 `interface Battle` 的 `commandUnits` 下方：

```ts
  /**
   * 兩隊各自的分隊索引（`flights.flights` 的下標）。
   *
   * 【為什麼算一次就好】分隊的隊伍歸屬**永遠不變** —— `compactFlights` 只
   * 壓縮成員，不會把一個分隊換隊。每步重算是白花的。
   */
  readonly blueFlightIndices: number[]
  readonly redFlightIndices: number[]
```

- [ ] **Step 2: 在 `createBattle` 裡建立它們**

在 `const blueCommand = createCommandState(...)` 那兩行下方：

```ts
  const blueFlightIndices: number[] = []
  const redFlightIndices: number[] = []
  for (let f = 0; f < flights.flights.length; f++) {
    ;(flights.flights[f]!.team === 'blue' ? blueFlightIndices : redFlightIndices).push(f)
  }
```

並把這兩個名字加進 `return { … }` 的物件字面（與 `commandUnits` 相鄰）。

- [ ] **Step 3: `stepCommandLayer` 改用它們**

把 Task 4 Step 8 加的那段「每步重算 BLUE_FLIGHTS / RED_FLIGHTS」整段刪掉，
連同 `const BLUE_FLIGHTS` / `RED_FLIGHTS` 兩個模組陣列。兩個 `stepCommand`
呼叫改成：

```ts
  const playerFlight = b.flights.pinned >= 0 ? b.flights.flightOf[b.flights.pinned]! : -1
  stepCommand(
    b.blueCommand, b.flights.flights, b.blueFlightIndices, b.redFlightIndices,
    b.commandUnits, playerFlight, dt,
  )
  stepCommand(
    b.redCommand, b.flights.flights, b.redFlightIndices, b.blueFlightIndices,
    b.commandUnits, playerFlight, dt,
  )
```

- [ ] **Step 4: 發令時一併解析集火目標**

把「發下去」那個迴圈換成：

```ts
  // ── 發下去 ────────────────────────────────────────────
  for (let f = 0; f < b.flights.flights.length; f++) {
    const flight = b.flights.flights[f]!
    const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
    const order = state.orders[f] ?? null
    // 【索引解析成 Aircraft 在這一層】規劃層是純函數、只吃快照，不認識
    // Aircraft。與 wireStations 把 stationReferenceOf 的索引解析成飛機是
    // 同一個手法。
    //
    // 【陣亡在這裡擋】stepCommand 同一步也會把命令解除，所以這是同一件事
    // 的兩道保險 —— 但兩道的節奏不同：命令層的解除是每步的，而這一格擋的
    // 是「解除與發令之間」那一瞬。留一個指向退場飛機的 target 會讓 AI
    // 對著一個不存在的東西解預瞄
    let focus: Aircraft | null = null
    if (order !== null && order.kind === 'focus') {
      const c = cs[order.focusIndex]
      if (c !== undefined && c.alive) focus = c.aircraft
    }
    for (let p = 0; p < flight.count; p++) {
      const ai = cs[flight.members[p]!]!.controller
      if (ai instanceof AiController) {
        ai.order = order
        ai.focusTarget = focus
      }
    }
  }
```

- [ ] **Step 5: 跑型別檢查與通道驗收**

```
npx tsc --noEmit
npx vitest run test/integration/ai-command-channel.test.ts
```

**這一步的預期不是「一定綠」。** 第一份的五條判準現在會跑到兩個新戰術。
三種紅法要分開處理：

- 「多數命令會因為到達而解除」紅 → 在 `observe()` 裡依 `kind` 分開數
  `issued` / `arrived`，找出是哪一種到不了，**停下來報告**
- 「命令期間不動用安全層的撞地接管」或「沒有飛機掉到 clearance 以下」紅 →
  **設計問題，停下來報告**
- 「命令期間編隊收攏」紅 → 側翼期間僚機也停止出擊（`flank` 走與 `rally`
  同一條路徑），理論上應該照樣收攏。紅了先印出 `tightened` / `loosened`
  **依 `kind` 分開**再判斷

**不得逕自調任何門檻。**

- [ ] **Step 6: Commit**

```bash
git add src/battle/setup.ts
```

訊息：

```
feat: 指揮層接線 —— 分隊索引、血量比例、集火目標的解析

分隊的隊伍歸屬永遠不變（compactFlights 只壓縮成員，不會把一個分隊
換隊），所以兩組索引在 createBattle 算一次就好。

集火的索引在發令時解析成 Aircraft：規劃層是純函數、只吃快照，不認識
Aircraft —— 與 wireStations 把 stationReferenceOf 的索引解析成飛機是
同一個手法。陣亡也在這一層擋，那與 stepCommand 的解除是同一件事的兩
道保險，但節奏不同：這一格擋的是「解除與發令之間」那一瞬，留一個指向
退場飛機的 target 會讓 AI 對著一個不存在的東西解預瞄。
```

---

### Task 7: 強制注入的執行驗收

**Files:**
- Create: `test/integration/ai-command-tactics.test.ts`

**Interfaces:**
- Consumes: Task 1–6 的全部

- [ ] **Step 1: 讀懂為什麼是「強制注入」**

spec §2：驗收全部用「把戰術直接塞給分隊」跑，量的是**這個戰術執行得對不對**，
與「該不該選它」完全分開。觸發階梯是暫時的（第三份會整條換掉），把驗收綁在
它上面等於驗收也要跟著換。

強制注入很便宜：`FlightOrder` 是一個普通物件，直接寫進
`b.blueCommand.orders[f]` 就成立，`stepCommand` 會照常維護它（側翼的點每步
重算、到位就解除）。

- [ ] **Step 2: 寫測試檔**

建立 `test/integration/ai-command-tactics.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND, type FlightOrder } from '../../src/ai/command'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

/** 藍隊第一個**不含玩家**的分隊索引。強制注入就注給它 */
function victimFlight(b: Battle): number {
  const playerFlight = b.flights.pinned >= 0 ? b.flights.flightOf[b.flights.pinned]! : -1
  for (const f of b.blueFlightIndices) if (f !== playerFlight) return f
  return -1
}

/** 離 `f` 最近的紅方分隊索引；−1 = 沒有 */
function nearestRedFlight(b: Battle, f: number): number {
  const mine = flightCentroid(b, f)
  if (mine === null) return -1
  let best = -1
  let bestD = Infinity
  for (const g of b.redFlightIndices) {
    const c = flightCentroid(b, g)
    if (c === null) continue
    const d = c.distanceTo(mine)
    if (d < bestD) { bestD = d; best = g }
  }
  return best
}

function flightCentroid(b: Battle, f: number): Vector3 | null {
  const flight = b.flights.flights[f]!
  const out = new Vector3()
  let n = 0
  for (let p = 0; p < flight.count; p++) {
    const c = b.world.combatants[flight.members[p]!]!
    if (!c.alive) continue
    out.add(c.aircraft.state.position)
    n++
  }
  return n > 0 ? out.divideScalar(n) : null
}

interface Observed {
  /** 強制注入了幾張 */
  injected: number
  /** 其中幾張因為到位而解除 */
  cleared: number
  /** 命令期間受命飛機開火的取樣數 */
  firingUnderOrder: number
  /** 命令期間的總取樣數，當分母 */
  samplesUnderOrder: number
  /** 命令期間安全層的撞地接管取樣數 */
  groundUnderOrder: number
  /** 任何飛機掉到安全層 clearance 以下的取樣數 */
  belowClearance: number
  /** 受命分隊裡「鎖著同一架」的最大架數，逐取樣累加 */
  focusLockSum: number
  /** 受命分隊的存活架數，逐取樣累加。當 focusLockSum 的分母 */
  focusLockDen: number
  /** 命令期間僚機 target 不為 null 的取樣數 */
  wingmanArmed: number
  /** 命令期間僚機的總取樣數 */
  wingmanSamples: number
}

/**
 * 跑一場 20v20，對第一個非玩家的藍方分隊強制注入戰術。
 *
 * @param kind `'flank'` / `'focus'` / `null`（不注入，當對照）
 */
function observe(kind: 'flank' | 'focus' | null): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    injected: 0, cleared: 0, firingUnderOrder: 0, samplesUnderOrder: 0,
    groundUnderOrder: 0, belowClearance: 0,
    focusLockSum: 0, focusLockDen: 0, wingmanArmed: 0, wingmanSamples: 0,
  }
  const vf = victimFlight(b)
  if (vf < 0) return o
  let had = false

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)

    const flight = b.flights.flights[vf]!
    const now = b.blueCommand.orders[vf] != null
    if (had && !now && flight.count > 0) o.cleared++
    had = now

    // ── 強制注入：只在這個分隊沒有命令、而且還活著時補一張 ──
    if (!now && kind !== null && flight.count > 0) {
      const tf = nearestRedFlight(b, vf)
      if (tf >= 0) {
        const injected = makeOrder(b, kind, tf)
        if (injected !== null) {
          b.blueCommand.orders[vf] = injected
          o.injected++
          had = true
        }
      }
    }

    // ── 觀測 ──────────────────────────────────────────
    for (const c of b.world.combatants) {
      if (!c.alive) continue
      if (c.aircraft.state.position.y < DEFAULT_SAFETY.clearance) o.belowClearance++
    }

    const order = b.blueCommand.orders[vf] ?? null
    if (order === null) continue

    let locked = -1
    let lockCount = 0
    let alive = 0
    for (let p = 0; p < flight.count; p++) {
      const c = b.world.combatants[flight.members[p]!]!
      if (!c.alive) continue
      alive++
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      o.samplesUnderOrder++
      if (ai.safetyAction === 'ground') o.groundUnderOrder++
      if (ai.stationReference !== null) {
        o.wingmanSamples++
        if (ai.target !== null) o.wingmanArmed++
      }
      if (order.kind === 'focus' && ai.target !== null) {
        // 用指派板的索引數「幾架鎖著同一架」
        const t = b.board.assignments[c.index]!
        if (t >= 0) {
          if (t === locked) lockCount++
          else if (locked < 0) { locked = t; lockCount = 1 }
        }
      }
    }
    if (order.kind === 'focus' && alive > 0) {
      o.focusLockSum += lockCount
      o.focusLockDen += alive
    }
    // 開火要在延遲之後的指令上看 —— `Combatant.command` 是世界實際吃到的
    for (let p = 0; p < flight.count; p++) {
      const c = b.world.combatants[flight.members[p]!]!
      if (c.alive && c.command.firing) o.firingUnderOrder++
    }
  }
  return o
}

/** 造一張要強制注入的命令。`null` = 這一格造不出來（目標分隊全滅） */
function makeOrder(b: Battle, kind: 'flank' | 'focus', tf: number): FlightOrder | null {
  const flight = b.flights.flights[tf]!
  if (flight.count === 0) return null
  if (kind === 'flank') {
    return {
      kind: 'flank',
      // point 由 stepCommand 每步重寫，這裡給什麼都會被蓋掉
      point: new Vector3(),
      radius: DEFAULT_COMMAND.arriveRadius,
      targetFlight: tf,
      side: 1,
      focusIndex: -1,
    }
  }
  // focus：挑那個分隊裡第一個活著的
  for (let p = 0; p < flight.count; p++) {
    const gi = flight.members[p]!
    if (b.world.combatants[gi]!.alive) {
      return {
        kind: 'focus', point: new Vector3(), radius: 0,
        targetFlight: -1, side: 0, focusIndex: gi,
      }
    }
  }
  return null
}

describe('強制注入側翼（20v20、120 秒）', () => {
  const o = observe('flank')

  /** 【場景要成立】一張都沒注入的話，下面每一條都會空洞地通過 */
  it('真的注入過側翼命令', () => {
    expect(o.injected).toBeGreaterThan(0)
  })

  /**
   * 【側翼要到得了】spec §7.2 的第 24 條。判準取多數而不是全部：混戰是
   * 混沌的，個別一張在途中被新的攻擊者打斷是正常的 —— 與第一份 §9.3 的
   * 「編隊收攏」同一個形狀，理由也相同。
   */
  it('多數側翼命令因為到位而解除', () => {
    console.log(JSON.stringify({
      injected: o.injected, cleared: o.cleared,
      firing: `${o.firingUnderOrder}/${o.samplesUnderOrder}`,
      ground: o.groundUnderOrder,
    }))
    expect(o.cleared).toBeGreaterThan(o.injected / 2)
  })

  /** 【途中不交戰】spec §4.4 */
  it('側翼期間受命飛機一槍都不開', () => {
    expect(o.firingUnderOrder).toBe(0)
  })

  /** 【安全層不豁免】判準與第一份的六場護欄同一條線 */
  it('側翼期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })
}, 10 * 60 * 1000)

describe('強制注入集火（20v20、120 秒）', () => {
  const on = observe('focus')
  const off = observe(null)

  it('真的注入過集火命令', () => {
    expect(on.injected).toBeGreaterThan(0)
  })

  /**
   * 【集火要真的集中】spec §7.2 的第 27 條。量的是「受命分隊裡鎖著同一架
   * 的平均架數佔存活架數的比例」，與不下令的對照比。
   */
  it('受命分隊鎖同一架的比例高於對照', () => {
    const share = on.focusLockSum / Math.max(on.focusLockDen, 1)
    console.log(JSON.stringify({
      injected: on.injected,
      focusShare: share.toFixed(3),
      wingmanArmed: `${on.wingmanArmed}/${on.wingmanSamples}`,
    }))
    expect(share).toBeGreaterThan(0)
  })

  /**
   * 【僚機不能被清掉目標】spec §7.2 的第 28 條，也是 §6.4 第 2 點最容易
   * 寫錯的地方。集火時僚機要靠 `LEVEL_FOCUS` 跟上，清掉目標會讓它掉進
   * 「沒有目標 → 飛站位」，集火就只剩長機一架在打。
   */
  it('集火期間僚機仍然有目標', () => {
    expect(on.wingmanArmed).toBeGreaterThan(on.wingmanSamples * 0.5)
  })

  it('集火期間不動用安全層的撞地接管', () => {
    expect(on.groundUnderOrder).toBe(0)
  })
}, 10 * 60 * 1000)
```

- [ ] **Step 3: 跑測試**

```
npx vitest run test/integration/ai-command-tactics.test.ts
```

**這一步的預期不是「一定綠」。** 逐條處理：

- **「真的注入過」紅** → `victimFlight` 或 `nearestRedFlight` 回了 −1。
  先印出 `b.blueFlightIndices` 與 `b.flights.pinned` 再查。
- **「多數側翼命令因為到位而解除」紅** → 先在 `observe` 裡加一個計數，
  分辨解除是因為「到位」還是因為「目標分隊全滅」。若是到不了，那是
  **設計問題，停下來報告**（spec §7.5 的否決條件之一）。
- **「一槍都不開」紅** → 檢查 `Combatant.command.firing` 是不是真的在讀
  延遲之後的指令。若是真的在開火，那是 §6.4 的意圖覆寫沒生效，**查根因**。
- **「鎖同一架的比例高於對照」的門檻** 先寫 `> 0` 是刻意的：第一次跑要
  **量出實際值再定門檻**，而定門檻要與專案負責人確認（護欄不是參數）。
  跑完把 `console.log` 的 `focusShare` 記下來。

- [ ] **Step 4: 依實測把集火的門檻定下來，並報告**

拿 Step 3 印出的 `focusShare` 與對照組的同一個量，**報告給專案負責人**再定
門檻。在測試的註解裡寫明實測值與門檻的來歷。

- [ ] **Step 5: Commit**

```bash
git add test/integration/ai-command-tactics.test.ts
```

訊息：

```
test: 側翼與集火的強制注入驗收

驗收全部用「把戰術直接塞給分隊」跑，量的是這個戰術執行得對不對，與
「該不該選它」完全分開。觸發階梯是暫時的（第三份會整條換掉），把驗收
綁在它上面等於驗收也要跟著換。

強制注入很便宜：FlightOrder 是一個普通物件，直接寫進 CommandState
就成立，stepCommand 會照常維護它（側翼的點每步重算、到位就解除）。

側翼五條：真的注入過、多數到得了、途中一槍不開、不動用安全層的撞地
接管、沒有飛機掉到 clearance 以下。集火四條：真的注入過、鎖同一架的
比例高於對照、僚機仍然有目標（那是最容易寫錯的地方）、不動用撞地
接管。
```

---

### Task 8: 掃描、品質驗收、回歸、回填

**Files:**
- Modify: `src/ai/command.ts`（只改 `DEFAULT_COMMAND` 的值與註解）
- Modify: `test/integration/ai-command-tactics.test.ts`
- Modify: `docs/superpowers/specs/2026-08-07-command-ai-tactics-design.md`

**Interfaces:**
- Consumes: Task 1–7 的全部
- Produces: 回填實測值的 `DEFAULT_COMMAND`；spec 的 §10

- [ ] **Step 1: 加品質指標到 `Observed`**

```ts
  /**
   * 開火那一刻的**方位角**累加：`敵機首 · 由敵指向我`。
   * 越接近 −1 代表越是從他背後打。除以 `aspectCount` 得平均。
   */
  aspectSum: number
  aspectCount: number
  /** 全場的擊墜數 */
  kills: number
  /** 全場的開火取樣數（所有飛機），當「每單位開火時間的擊墜」的分母 */
  firingSamples: number
  /** 紅方掉的 hp */
  redDamage: number
  /** 藍方掉的 hp */
  blueDamage: number
```

在 `observe` 的每步迴圈裡，對**所有**存活飛機累積：

```ts
      if (c.command.firing) {
        o.firingSamples++
        const ai = c.controller
        const t = ai instanceof AiController ? ai.target : null
        if (t !== null) {
          // 敵機首 · 由敵指向我。−1 = 我在他正後方
          const fwd = new Vector3(0, 0, -1).applyQuaternion(t.state.orientation)
          const los = new Vector3().copy(c.aircraft.state.position).sub(t.state.position)
          const len = los.length()
          if (len > 1e-6) {
            o.aspectSum += fwd.dot(los) / len
            o.aspectCount++
          }
        }
      }
```

**這個迴圈只在量測時跑，配置 `Vector3` 是可以的** —— 它在測試檔裡，不在
`src/` 的熱路徑上。要在註解裡寫明。

擊墜數與傷害在迴圈結束後統計（與 `ai-command-channel.test.ts` 的
`hp0` 同一個算法；擊墜數數 `!c.alive` 的架數）。

- [ ] **Step 2: 加掃描用的 `it`**

```ts
  it.skip('掃描側翼與集火的八個參數（量測用，不是判準）', () => {
    const base = { ...DEFAULT_COMMAND }
    const restore = () => Object.assign(DEFAULT_COMMAND, base)
    const report = (knob: string, v: number, kind: 'flank' | 'focus') => {
      const r = observe(kind)
      console.log(JSON.stringify({
        knob, v, kind,
        injected: r.injected, cleared: r.cleared,
        firing: r.firingUnderOrder, ground: r.groundUnderOrder,
        aspect: (r.aspectSum / Math.max(r.aspectCount, 1)).toFixed(3),
        killsPerFiring: (r.kills / Math.max(r.firingSamples, 1) * 1e4).toFixed(3),
        focusShare: (r.focusLockSum / Math.max(r.focusLockDen, 1)).toFixed(3),
      }))
    }
    for (const v of [600, 1200, 2000, 3000]) {
      restore(); DEFAULT_COMMAND.flankOffset = v; report('flankOffset', v, 'flank')
    }
    for (const v of [400, 800, 1500, 2500]) {
      restore(); DEFAULT_COMMAND.flankTrail = v; report('flankTrail', v, 'flank')
    }
    for (const v of [0, 300, 800, 1500]) {
      restore(); DEFAULT_COMMAND.flankClimb = v; report('flankClimb', v, 'flank')
    }
    for (const v of [30, 45, 60, 90]) {
      restore(); DEFAULT_COMMAND.flankSector = v * (Math.PI / 180)
      report('flankSector', v, 'flank')
    }
    for (const v of [450, 900, 1800]) {
      restore(); DEFAULT_COMMAND.dangerScale = v; report('dangerScale', v, 'flank')
    }
    for (const v of [0.5, 1, 2, 4]) {
      restore(); DEFAULT_COMMAND.dangerLimit = v; report('dangerLimit', v, 'flank')
    }
    for (const v of [800, 1500, 2500]) {
      restore(); DEFAULT_COMMAND.focusRange = v; report('focusRange', v, 'focus')
    }
    for (const v of [30, 60, 90, 120]) {
      restore(); DEFAULT_COMMAND.focusCone = v * (Math.PI / 180)
      report('focusCone', v, 'focus')
    }
    restore()
  }, 60 * 60 * 1000)
```

`DEFAULT_COMMAND` 是 `const` 物件但屬性可寫，直接指派即可（`defendTilt`、
`floorPitch`、第一份的五個參數用的都是這一手）。

- [ ] **Step 3: 跑掃描**

把 `it.skip` 改成 `it`（或複製成一個暫存檔跑，跑完刪掉）：

```
npx vitest run test/integration/ai-command-tactics.test.ts -t "掃描側翼與集火"
```

共 30 組，每組一場 120 秒的 20v20。若單場超過三分鐘，先把 `SECONDS` 暫時
降到 60 再掃，選完值用 120 秒複測。

- [ ] **Step 4: 選值**

判準（spec §8）：

1. **執行驗收先全綠**：`cleared > injected / 2`、`firing === 0`、
   `ground === 0`
2. 再用兩個品質指標選：`aspect`（側翼，**越小越好**）與
   `killsPerFiring`（集火，**越大越好**）

**與第一份同一條紀律**：有結構的是**邊界**，不是中心點的小數第二位。
`arrived` 這一類的絕對數很小，比例是很吵的統計量。找的是「哪些值會讓某條
執行驗收整個垮掉」，而不是「哪個值多 3%」。

- [ ] **Step 5: 回填**

把 `DEFAULT_COMMAND` 的八個值改成選出來的，並把 Task 1 Step 5 寫的那段
「**全部是起始值，待 Task 8 由實測掃描回填**」換成掃描表與選值理由。格式照
第一份 `DEFAULT_COMMAND` 的註解：**實測表格 + 為什麼選這個 + 重試的前提**。

「重試的前提」要寫明：這組值依賴目前的飛行包絡（`specs/feel.ts` 的五個
倍率）與 `DEFAULT_BATTLE` 的 20v20 編成，兩者大幅改動後要重掃。

- [ ] **Step 6: 刪掉掃描用的 `it`**

它會改動全域設定，留在檔案裡會污染同檔的其他測試。品質指標的欄位
**留著** —— Step 7 的對照要用。

- [ ] **Step 7: 加品質對照與量的地板**

```ts
describe('戰術的效果（20v20、開／關對照）', () => {
  const flank = observe('flank')
  const focus = observe('focus')
  const off = observe(null)

  /**
   * 【側翼的品質】spec §7.3 的第 29 條。開火那一刻的方位角往後側方移動 ——
   * 值越接近 −1 代表越是從他背後打。
   *
   * 【為什麼是品質而不是總傷害】專案負責人 2026-08-07 裁定：側翼與集火要
   * 買的是「從更好的角度發起攻擊」與「同一個目標被更多架咬」。用總傷害量
   * 去驗品質的改動方向本來就不對 —— 而且側翼必然減少交戰時間，量的判準會
   * 把一個成功的側翼判成失敗。
   */
  it('側翼讓開火時的方位角往後側方移動', () => {
    const on = flank.aspectSum / Math.max(flank.aspectCount, 1)
    const base = off.aspectSum / Math.max(off.aspectCount, 1)
    console.log(JSON.stringify({ flankAspect: on.toFixed(3), offAspect: base.toFixed(3) }))
    expect(on).toBeLessThan(base)
  }, 10 * 60 * 1000)

  /**
   * 【集火的品質】spec §7.3 的第 30 條。集火的整個賣點就是「同一架被多人
   * 咬 → 更快掉下來」；若它沒有變快，這個戰術沒有意義（spec §7.5 的否決
   * 條件之一）。
   */
  it('集火讓每單位開火時間的擊墜上升', () => {
    const on = focus.kills / Math.max(focus.firingSamples, 1)
    const base = off.kills / Math.max(off.firingSamples, 1)
    console.log(JSON.stringify({
      focusKPF: (on * 1e4).toFixed(3), offKPF: (base * 1e4).toFixed(3),
    }))
    expect(on).toBeGreaterThan(base)
  }, 10 * 60 * 1000)

  /**
   * 【量的地板】spec §7.3 的第 31 條。**這個比例等實測完再定，而且要與
   * 專案負責人確認 —— 它是護欄不是參數。**
   *
   * 第一份 §9.4 已經記過：一條撤退規則就讓總傷害掉 48%，遠高於命令佔時
   * 比例，因為撤離的小隊同時停止挨打與停止輸出。側翼會再加一段。
   */
  it('總傷害不得崩掉', () => {
    const on = flank.redDamage + flank.blueDamage
    const base = off.redDamage + off.blueDamage
    console.log(JSON.stringify({ onTotal: on.toFixed(0), offTotal: base.toFixed(0) }))
    expect(on).toBeGreaterThan(base * FLOOR)
  }, 10 * 60 * 1000)
})
```

**`FLOOR` 這個常數要在 Step 4 的掃描之後、依實測值與專案負責人確認才填**，
並在它的註解裡寫明實測落在哪、為什麼取這個。**在確認之前不要猜一個數字
填進去** —— 那會讓一條護欄看起來有來歷，其實沒有。

- [ ] **Step 8: 跑全套（排除兩個並行假紅的檔案）**

```
npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"
```

- [ ] **Step 9: 單獨複測那兩個檔案**

```
npx vitest run test/unit/perf-gate.test.ts test/integration/rematch.test.ts
```

跑之前確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁。

**`perf-gate` 特別要看**（spec §7.4）：側翼的點每步重算，那是新的每步工作。
若它紅了，先確認 `flankPoint` 與 `flankArrived` 沒有在每步配置。

- [ ] **Step 10: 逐條處理紅掉的測試**

`multi-battle.test.ts`、`ai-duel-matrix.test.ts`、`ai-command-channel.test.ts`
都會受兩個新戰術影響。

**注意 1v1**：`SCHWARM_SIZE` 是 4，1v1 時每隊只有一個一架的分隊 ——
集火會對它發令（分隊裡就那一架，`LEVEL_FOCUS` 沒有僚機可帶），而側翼要求
「目標分隊已經在交戰」。若 `ai-duel-matrix` 因此變化，那是真的行為改變，
**先量再報告**。

紅的一律先查根因再報告，**不得逕自調門檻**。spec §7.5 的否決條件優先於
一切。

- [ ] **Step 11: 回填 spec**

在 `docs/superpowers/specs/2026-08-07-command-ai-tactics-design.md` 加一節
「## 10. 實作後的實測回填」，內容：

- 八個參數的掃描表（Step 3）與選值理由
- 強制注入的執行驗收實測值（注入張數、到位張數、開火取樣、撞地接管）
- 兩個品質指標的開／關對照
- 量的地板實際定在哪、與專案負責人確認的過程
- 若有任何一節的設計在實作中被推翻，明寫「實作後修正」並保留原文供追溯
  （這個專案的既有慣例，見第一份 spec 的 §9 與
  `2026-08-06-visible-evasion-design.md`）

**同時更正 spec 已知的兩處**：

1. §4.3 寫「退化 → 敵分隊機首平均」—— **`CommandUnit` 沒有 orientation**，
   實作的退化階梯是「目標速度退化 → 由我方質心指向目標質心 → 世界 −Z」。
2. §7.1 的考題編號與實際寫出來的條數（Task 2 十七條、Task 3 九條、
   Task 4 十條）對不上，以實作為準並更新 spec 的清單。

- [ ] **Step 12: Commit**

```bash
git add src/ai/command.ts test/integration/ai-command-tactics.test.ts docs/superpowers/specs/2026-08-07-command-ai-tactics-design.md
```

（若 Step 10 有經專案負責人裁定的測試改動，一併 `git add` 那些明確路徑。）

訊息：

```
test: 側翼與集火的參數掃描、品質驗收與回填

八個參數由 30 組 20v20 掃描定值。判準是執行驗收先全綠，再用兩個品質
指標選：側翼看開火時的方位角（越接近 −1 代表越是從背後打），集火看
每單位開火時間的擊墜。

與第一份同一條紀律：有結構的是邊界，不是中心點的小數第二位。找的是
「哪些值會讓某條執行驗收整個垮掉」，不是「哪個值多 3%」。

量的地板依實測與專案負責人確認後定值，理由寫在測試的註解裡。

一併更正設計文件兩處：§4.3 的退化階梯（CommandUnit 沒有 orientation，
沒有機首可以退回去）、§7.1 的考題清單以實作為準。
```

---

## Self-Review

**1. Spec 覆蓋**

| Spec 節 | 對應任務 |
|---|---|
| §1.1 只做兩個戰術 | 全篇（慢速脫離與火力壓制一個字都沒寫） |
| §2 驗收與觸發分開 | Task 7（強制注入）+ Task 1 Step 5（觸發常數不進 config） |
| §3 觸發階梯 | Task 4 Step 6（撤退 > 側翼 > 集火）+ Step 2 的三條測試 |
| §3.1 開場死鎖防護 | Task 2 Step 5 的 `engaged` 閘門 + Step 1 的測試 |
| §3.2 距離分開 | Task 4 Step 6 的 `nearestDist > FLANK_RANGE` |
| §3.3 兩個常數不掃描 | Task 1 Step 5 的註解 + Task 8 的掃描表不含它們 |
| §4.1 對象是敵分隊 | Task 4 Step 6 的「挑最近的敵分隊」 |
| §4.2 點每步重算、幾何到達 | Task 4 Step 5（`flankPoint` 重寫 `order.point`）+ `flankArrived` |
| §4.3 側翼點算法與危險評估 | Task 2 Step 3（`flankPoint`）、Step 4（`dangerAt`） |
| §4.4 途中不交戰 | Task 5 Step 5（`flank` 走 `rally` 意圖）+ Task 7 的「一槍都不開」 |
| §5.1 只覆寫長機 | Task 5 Step 6 的 `!reference` |
| §5.2 可及性閘門 | Task 3 Step 3 的 `focusRange` + `focusCone` |
| §5.3 挑血最少的 | Task 3 Step 3 的 `bestHp` |
| §5.4 集火要交戰 | Task 5 Step 5 的 `kind !== 'focus'` |
| §6.1 命令長出種類 | Task 1 |
| §6.2 `stepCommand` 換簽名 | Task 4 |
| §6.3 三個純函數 | Task 2、Task 3 |
| §6.4 戰機端三處改動 | Task 5 |
| §7.1 純函數考題 | Task 2 Step 1（十七條）、Task 3 Step 1（九條）、Task 4 Step 2（十條） |
| §7.2 強制注入驗收 | Task 7 |
| §7.3 品質驗收 | Task 8 Step 7 |
| §7.4 回歸 | Task 8 Step 8–10 |
| §7.5 否決條件 | Task 2 Step 1（決定性／連續性）、Task 3 Step 1（決定性）、Task 7（撞地、到不了）、Task 8 Step 7（集火沒變快） |
| §8 掃描 | Task 8 Step 2–5 |
| §9 影響範圍 | Task 1、4、5、6 的 Files 區塊 |

**發現的缺口與修補：**

- **spec §4.3 的退化階梯寫「敵分隊機首平均」，但 `CommandUnit` 沒有
  `orientation`。** 這是 spec 從 `stationPoint` 抄形狀時漏掉的 —— 那個函式
  收 `Aircraft`，有機首可以退。實作的階梯改成「目標速度退化 → 由我方質心
  指向目標質心 → 世界 −Z」，理由寫進 `flankPoint` 的註解，並排入 Task 8
  Step 11 更正 spec。
- **spec 沒有說集火命令什麼時候解除**（只說了「目標陣亡」）。不加第二個
  條件的話，目標活著就永遠不解除，集火會變成永久狀態 —— 那正是第一份 §4.1
  記載的病。Task 4 加了「跑到 `FLANK_RANGE` 之外」，並用 `focusRange`
  （1500）與 `FLANK_RANGE`（2500）兩個**既有**的數字構成遲滯，不新增參數。
- **spec §7.3 的量的地板沒有數字。** 那是刻意的（專案負責人裁定「等實測完
  再定」），Task 8 Step 7 明寫「在確認之前不要猜一個數字填進去」。

**2. 佔位符掃描**

Task 4 Step 9、Task 6 Step 5、Task 7 Step 3、Task 8 Step 3 刻意不預設紅或
綠 —— 那不是佔位符，是因為結果要靠實測，而**每一種結果的後續動作都寫明了**
（分別區分了「參數問題」與「設計問題」兩種紅法）。

Task 7 Step 3 的集火門檻先寫 `> 0` 並在 Step 4 依實測定值、Task 8 Step 7 的
`FLOOR` 待確認 —— 兩者都明寫了「護欄不是參數，要與專案負責人確認」，而不是
留一個「TBD」。

Task 8 Step 2 的掃描 `it` 是**暫時**的，Step 6 明寫要刪掉，並指明品質指標的
欄位要留給 Step 7。

**3. 型別一致性**

- `OrderKind`：Task 1 Step 4 定義，Task 4 Step 5/6、Task 5 Step 5、
  Task 7 Step 2 消費 ✓
- `FlightOrder`（六個欄位）：Task 1 Step 4 定義；`planFlightOrder`
  （Task 1 Step 6）、`planFlankOrder`（Task 2 Step 5）、`planFocusTarget`
  （Task 3 Step 3）三處建構，欄位齊全 ✓
- `CommandUnit.hpFraction`：Task 1 Step 4 定義，Task 1 Step 7（`setup.ts` 與
  測試工廠）寫入，Task 3 Step 3 讀 ✓
- `flankPoint(target, own, side, cfg, out): boolean`：Task 2 Step 3 定義，
  Task 2 Step 5 與 Task 4 Step 5 消費（**參數順序一致**）✓
- `dangerAt(p, others, cfg): number`：Task 2 Step 4 定義，Step 5 消費 ✓
- `flankArrived(members, target, cfg): boolean`：Task 4 Step 7 定義，
  Step 5 消費 ✓
- `gather(out, flight, units)` / `centroidDistance(flight, units, p)` /
  `centroidDistanceTo(group, x, y, z)`：Task 4 Step 7 定義，Step 5/6 消費 ✓
- `planFlankOrder(members, target, others, targetFlight, cfg?)`：Task 2
  Step 5 定義，Task 2 Step 1 的測試與 Task 4 Step 6 呼叫（**四個位置參數 +
  預設 cfg**）✓
- `planFocusTarget(members, candidates, candidateIndices, cfg?)`：Task 3
  Step 3 定義，Task 3 Step 1 的測試與 Task 4 Step 6 呼叫 ✓
- `stepCommand(s, flights, own, foe, units, skipFlight, dt, cfg?)`：Task 4
  Step 4 定義，Task 4 Step 2 的測試、Task 4 Step 8 與 Task 6 Step 3 呼叫
  （**七個位置參數 + 預設 cfg**）✓
- `AiController.focusTarget: Aircraft | null`：Task 5 Step 4 定義，
  Task 5 Step 6、Task 6 Step 4 消費 ✓
- `Battle.blueFlightIndices` / `.redFlightIndices`：Task 6 Step 1 定義，
  Step 2 建立、Step 3 消費，Task 7 Step 2 的測試消費 ✓
- 暫存池：`P`（第一份既有，`planFlightOrder` 與 `planFocusTarget` 用）與
  `F`（Task 2 Step 3 新增，`flankPoint` 專用）**分開** —— `planFlankOrder`
  用 `P` 而它呼叫的 `flankPoint` 用 `F`，不會別名衝突 ✓

**4. 既有檔案的前置確認（已驗）**

- `src/ai/command.ts` 的 `FlightOrder` 在第 35 行、`CommandUnit` 在第 17 行、
  `MIN_HORIZONTAL` 與 `P = makeScratch(4)` 在第 80 行附近
- `src/ai/command.ts:300` 是 `export function stepCommand`，外層迴圈掃
  `flights.length`（**含敵方分隊**，那個浪費 Task 4 修掉）
- `src/battle/setup.ts` 的 `stepCommandLayer` 在第 442 行，`BLUE_UNITS` /
  `RED_UNITS` 在第 429–430 行
- `src/battle/flights.ts:43` 與 `:48` 都有 `readonly team: Team`，所以
  `Flight` 有 `team` 而 `CommandFlight` 沒有（後者刻意保持最小）
- `src/world/World.ts:45` 是 `hp: number`（在 `Combatant` 上，**不在
  `Aircraft` 上**），`:244` 是 `hp: aircraft.spec.hp`（滿血的來源）
- `test/unit/ai-command.test.ts:15` 是 `cornerRatio: over.cornerRatio ?? 1.2`
  （`unit()` 工廠要加 `hpFraction`）
- `test/unit/ai-controller.test.ts:376` 與 `:394` 是兩處 `ai.order = { … }`
- `src/ai/wingman.ts:15` 是 `export const LEVEL_FOCUS = 3`，`:13` 是
  `LEVEL_SELF_DEFENCE = 1`
- `src/ai/` 目前**沒有任何**檔案 import `src/battle/`（已 grep 確認）
