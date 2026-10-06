# 指揮 AI 第一份：指令通道與集合點 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓每隊的指揮官每 N 秒評估各小隊狀態，把「能量見底」的小隊用一張
凍結的集合點命令拉出戰鬥、補完能量再放回去。

**Architecture:** 指揮邏輯是**純函數**（`planFlightOrder`），只吃快照、吐命令，
不碰世界 —— 這是為了能在不跑模擬的情況下直接對它出考題。命令透過
`AiController.order` 下達，在戰機端**以兩行覆寫**表達（`defend` 或 `rally`），
**不動 `arbitrate` 一個字**。長機飛集合點，僚機靠既有的站位邏輯自動跟上。

**Tech Stack:** TypeScript（無 `@types/node`）、three.js 的 `Vector3`、vitest。

## Global Constraints

以下每一條都直接抄自 spec 或專案的既有規矩，**每個任務都隱含適用**：

- **`src/ai/` 不得 import `src/battle/`。** 現行相依方向是 `battle → ai`
  （`setup.ts` import `AiController`、`target.ts`、`station.ts`）。需要分隊結構
  時定義最小介面（`CommandFlight`），與 `flights.ts` 定義 `FlightMember`、
  `target.ts` 定義 `TargetCandidate` 同一個手法。
- **`src/ai/` 的熱路徑（240 Hz）不得配置記憶體。** 新向量走既有的
  `makeScratch` 暫存池。`planFlightOrder` 每 `planPeriod` 秒才跑，發令時配置
  一個 `Vector3` 是可以的，**但必須在註解裡寫明它不在熱路徑上**。
- **閃躲永遠優先，撤退也一樣**（spec §2.2）。命令不得壓過 `defend`。
- **命令絕對**（spec §2.3）：收到命令的飛機不再交戰，即使當下有射擊解。
- **安全層不豁免**（spec §5.2）：`applySafety` 仍是最後一道，離地底限
  （`applyFloor`）仍然套在所有意圖上。
- 專案**沒有** `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態：陣列索引後必須 `!` 或做 undefined 檢查。
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
  `git commit -F`。**不要**用 PowerShell here-string 語法混進 Bash。
- **絕不用 PowerShell 讀寫含中文的檔案。**
- 護欄重新定值是**專案負責人的決定**，不是實作者的。紅了要先量、先報告、先問。

## File Structure

| 檔案 | 責任 | 本計畫的改動 |
|------|------|------|
| `src/ai/command.ts` | 指揮層：純規劃 + 命令生命週期 | **新增** |
| `src/ai/rally.ts` | 飛向一個世界座標點 | **新增** |
| `src/ai/rules.ts` | 態勢 → 意圖 | `Intent` 加 `'rally'`，`INTENTS` 同步 |
| `src/ai/steer.ts` | 意圖 → 轉向指令 | `steerCommand` 加 `rallyPoint` 參數與 `rally` 分支 |
| `src/ai/AiController.ts` | 每架的 AI 狀態機 | `order` 欄位、意圖覆寫、僚機的自衛限制、無目標分支的 rally |
| `src/battle/setup.ts` | 戰鬥組裝與每步推進 | 兩隊各一個 `CommandState`；`CommandUnit` 快照；每步推進；跳過玩家的小隊 |
| `test/unit/ai-command.test.ts` | spec §7.1 的十二條考題 | **新增** |
| `test/unit/ai-rally.test.ts` | `rallyAim` / `rallyCommand` 的幾何 | **新增** |
| `test/integration/ai-command-channel.test.ts` | spec §7.2 通道 + §7.3 對照 + 掃描 | **新增** |

**為什麼 `rallyCommand` 自成一個檔案而不是塞進 `station.ts`**：站位是「相對
另一架**飛機**」，集合點是「相對一個**固定的世界點**」—— 前者要跟著參考機的
航跡框轉，後者不會動。兩者的退化路徑與油門政策也不同。這個專案的小檔案很多
（`fire.ts` 68 行、`profile.ts` 61 行、`delay.ts` 110 行），單一職責優先。

**為什麼 `rallyAim` 與 `rallyCommand` 都要有**：`steerCommand` 的 `rally` 分支
只需要瞄準方向（油門由它自己的油門段決定），而 `AiController` 的「沒有目標」
分支需要一整個 `Command`（與 `stationCommand` 同一個位置）。兩處共用同一段
幾何，不寫兩份。

---

### Task 1: `planFlightOrder` —— 純函數的規劃

**Files:**
- Create: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: `src/core/pool.ts` 的 `makeScratch`；`src/ai/steer.ts` 的
  `DEFAULT_STEER`（取 `clearanceScale`）
- Produces:
  - `interface CommandUnit { readonly position: Vector3; readonly velocity: Vector3; cornerRatio: number; readonly serviceCeiling: number; alive: boolean }`
  - `interface FlightOrder { readonly point: Vector3; readonly radius: number }`
  - `interface CommandConfig`（六個欄位，見 Step 3）
  - `const DEFAULT_COMMAND: CommandConfig`
  - `function planFlightOrder(members: readonly CommandUnit[], enemies: readonly CommandUnit[], spentSeconds: number, cfg?: CommandConfig): FlightOrder | null`

- [ ] **Step 1: 先讀懂三個要照抄的既有寫法**

不要改，只讀：

- `src/ai/station.ts` 的 `stationPoint` —— 它的**退化階梯**（水平分量退化 →
  機首投影 → 固定方向）是這個專案的標準寫法，`planFlightOrder` 的方向計算要
  照同一個形狀。注意它的註解解釋了為什麼不能讓 NaN 流出去：「NaN 一旦進入
  站位誤差，所有比較都變成 false，僚機會靜靜地永遠不歸隊而且完全不報錯」。
- `src/ai/steer.ts` 的 `DEFAULT_STEER.clearanceScale`（值 500）。
- `src/core/pool.ts` 的 `makeScratch` —— 使用約定是「各模組載入時呼叫一次並
  私有持有，禁止跨模組共用」。

- [ ] **Step 2: 寫失敗的測試**

建立 `test/unit/ai-command.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  planFlightOrder, DEFAULT_COMMAND, type CommandUnit,
} from '../../src/ai/command'
import { DEFAULT_STEER } from '../../src/ai/steer'
import { THREAT_RANGE } from '../../src/ai/assess'

/** 造一架快照。預設健康、在原點、朝 −Z、升限 12000 */
function unit(over: Partial<CommandUnit> & { x?: number; y?: number; z?: number } = {}): CommandUnit {
  return {
    position: new Vector3(over.x ?? 0, over.y ?? 4000, over.z ?? 0),
    velocity: over.velocity ?? new Vector3(0, 0, -200),
    cornerRatio: over.cornerRatio ?? 1.2,
    serviceCeiling: over.serviceCeiling ?? 12000,
    alive: over.alive ?? true,
  }
}

const cfg = DEFAULT_COMMAND
/** 剛好滿足「已見底」的秒數 */
const SPENT = cfg.spentSeconds

describe('planFlightOrder：該不該下令', () => {
  it('見底且敵人在附近 → 必有命令', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT, cfg)).not.toBeNull()
  })

  it('還沒累積滿 → null', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT * 0.99, cfg)).toBeNull()
  })

  /**
   * 【小隊不可分割】見底的判定在 `stepCommand`（Task 2），這裡收到的是
   * 已經判好的秒數 —— 所以這一條驗的是「規劃不會因為隊裡有健康的人就
   * 拒絕發令」。史實依據見 spec §2.4：編隊的能力等於最弱的那一架。
   */
  it('一架慘三架好，仍然發令', () => {
    const members = [
      unit({ cornerRatio: 0.4 }), unit({ x: 200 }), unit({ x: -250 }), unit({ x: -450 }),
    ]
    const enemies = [unit({ z: 1000 })]
    expect(planFlightOrder(members, enemies, SPENT, cfg)).not.toBeNull()
  })

  it('沒有敵人 → null（沒有要脫離的對象）', () => {
    expect(planFlightOrder([unit()], [], SPENT, cfg)).toBeNull()
  })

  it('全隊陣亡 → null', () => {
    const members = [unit({ alive: false }), unit({ alive: false })]
    expect(planFlightOrder(members, [unit({ z: 1000 })], SPENT, cfg)).toBeNull()
  })

  it('敵人全陣亡 → null', () => {
    expect(planFlightOrder([unit()], [unit({ z: 1000, alive: false })], SPENT, cfg)).toBeNull()
  })
})

describe('planFlightOrder：集合點給得對不對', () => {
  /** 小隊在原點、敵群在 +Z 1000 m 處 */
  const members = [unit(), unit({ x: 200 })]
  const enemies = [unit({ z: 1000 }), unit({ z: 1000, x: 100 })]

  it('真的脫離得了：離最近的敵機超過威脅射程', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    let nearest = Infinity
    for (const e of enemies) nearest = Math.min(nearest, o.point.distanceTo(e.position))
    expect(nearest).toBeGreaterThan(THREAT_RANGE)
  })

  it('往遠離敵群的方向走', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    // 敵群在 +Z，所以集合點該在 −Z
    expect(o.point.z).toBeLessThan(0)
  })

  it('不會叫人穿過敵群：集合點離敵群比現在更遠', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    const foe = new Vector3(0, 4000, 1000)   // 敵群質心
    const own = new Vector3(100, 4000, 0)    // 小隊質心
    expect(o.point.distanceTo(foe)).toBeGreaterThan(own.distanceTo(foe))
  })

  it('真的補得到能量：高於小隊質心', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.y).toBeGreaterThan(4000)
  })

  it('不超過最低的升限', () => {
    const low = [unit({ y: 11900, serviceCeiling: 12000 }), unit({ y: 11900, serviceCeiling: 9000 })]
    const o = planFlightOrder(low, [unit({ y: 11900, z: 1000 })], SPENT, cfg)!
    expect(o.point.y).toBeLessThanOrEqual(9000)
  })

  it('不會叫人撞海：高於 clearanceScale', () => {
    const low = [unit({ y: 50 }), unit({ y: 50, x: 200 })]
    const o = planFlightOrder(low, [unit({ y: 50, z: 1000 })], SPENT, cfg)!
    expect(o.point.y).toBeGreaterThanOrEqual(DEFAULT_STEER.clearanceScale)
  })

  it('半徑是正數', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.radius).toBeGreaterThan(0)
  })
})

describe('planFlightOrder：退化與穩定性', () => {
  /**
   * 【這一條是 spec §7.5 的否決條件之一】敵我質心重合時「遠離敵人」的方向
   * 沒有定義。直接回傳含 NaN 的點會讓所有距離比較都變成 false —— 小隊會
   * 靜靜地永遠飛不到，而且完全不報錯（`stationPoint` 的註解記過同一件事）。
   */
  it('敵我質心重合、速度也為零 → 不產生 NaN，仍給得出點', () => {
    const still = new Vector3(0, 0, 0)
    const members = [unit({ velocity: still })]
    const enemies = [unit({ velocity: still })]
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o).not.toBeNull()
    expect(Number.isNaN(o.point.x + o.point.y + o.point.z)).toBe(false)
  })

  it('敵我質心重合但有速度 → 沿速度方向走', () => {
    const members = [unit({ velocity: new Vector3(0, 0, -200) })]
    const enemies = [unit()]
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.z).toBeLessThan(0)
  })

  /**
   * 【決定性】spec §7.5 的否決條件。模擬是完全決定性的，規劃也必須是 ——
   * 否則同一個態勢會給出不同的命令，任何回歸測試都失去意義。
   */
  it('同一個快照算兩次，逐位元相同', () => {
    const members = [unit(), unit({ x: 200 })]
    const enemies = [unit({ z: 1000 })]
    const a = planFlightOrder(members, enemies, SPENT, cfg)!
    const b = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(a.point.x).toBe(b.point.x)
    expect(a.point.y).toBe(b.point.y)
    expect(a.point.z).toBe(b.point.z)
  })

  /**
   * 【連續性】spec §7.5 的否決條件。這個專案治過三次「相鄰輸入給出跳躍的
   * 輸出」（`latch` 的遲滯、`extendPitchAngle` 的連續化、破防軸的號誌閂鎖），
   * 每一次的症狀都一樣。集合點若對敵機的微小移動敏感，小隊會被指向來回
   * 擺動的目標。
   *
   * 界限的來源：敵群移動 20 m、而小隊離敵群 1000 m，方向角變化約
   * `atan(20/1000)` = 1.15°，集合點在 `withdrawRange` 上掃過的弧長約
   * `withdrawRange × 0.02`。取兩倍當界限。
   */
  it('敵機位置微擾 ±20 m，集合點的位移有界', () => {
    const members = [unit(), unit({ x: 200 })]
    const base = planFlightOrder(members, [unit({ z: 1000 })], SPENT, cfg)!
    const limit = cfg.withdrawRange * 0.04
    for (const d of [-20, 20]) {
      const moved = planFlightOrder(members, [unit({ z: 1000, x: d })], SPENT, cfg)!
      expect(moved.point.distanceTo(base.point)).toBeLessThan(limit)
    }
  })
})
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts
```

預期：編譯失敗，`src/ai/command.ts` 不存在。

- [ ] **Step 4: 寫 `src/ai/command.ts` 的型別與設定**

```ts
import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEFAULT_STEER } from './steer'

/**
 * 規劃需要知道的每架資訊。
 *
 * 【為什麼另外定義而不是收 `Combatant` 或 `Aircraft`】規劃不需要知道世界是
 * 怎麼組裝的（射速時鐘、包圍球、出生點都與「這個小隊該不該撤」無關），而且
 * 收最小介面才能在單元測試裡用字面物件出考題 —— 那是 spec §7.1 那一層
 * 存在的前提。與 `flights.ts` 的 `FlightMember`、`target.ts` 的
 * `TargetCandidate` 是同一個手法。
 *
 * `position` / `velocity` 是 `readonly` 的**參考**（內容仍可 `copy` 進去），
 * `cornerRatio` / `alive` 每步會被呼叫端改寫。
 */
export interface CommandUnit {
  readonly position: Vector3
  readonly velocity: Vector3
  /** TAS ÷ 角落速度。與 `Situation.cornerRatio` 同義 */
  cornerRatio: number
  /** 升限，m。集合點的高度上界 */
  readonly serviceCeiling: number
  alive: boolean
}

/**
 * 一張下給小隊的命令。
 *
 * 【集合點凍結，不隨敵人移動重算】每 N 秒重算會讓點跟著敵人飄，小隊追著
 * 一個移動的目標跑，而且「到達」永遠判定不了 —— 命令會變成永久狀態。
 * 代價是敵人追過來時點會過時；可接受的理由是命令期間 `defend` 照常運作，
 * 而且到達後立刻恢復自由交戰（spec §4.1）。
 */
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

/**
 * **五個數字全部是起始值，待 Task 6 由實測掃描回填。**
 *
 * 起始值的來歷（都是為了讓第一次能跑起來，不是定值）：
 *
 * - `planPeriod` 2 s —— 比 `AI_DECISION_HZ`（10 Hz）慢兩個數量級，指揮是
 *   戰役尺度的決定，不該與戰機的機動同頻。
 * - `spentRatio` 0.6 —— **刻意低於**個體層的 `DEFAULT_RULES.cornerEnter`
 *   （0.75）。那個門檻回答的是「我現在該不該停止拉桿」，是瞬間判斷，而
 *   戰鬥機每次硬拉都會掉到 0.75 以下。指揮層問的是「已經打不動了嗎」
 *   （spec §2.4）。
 * - `spentSeconds` 3 s —— 一次完整的水平大彎的量級，用來濾掉單次拉桿。
 * - `withdrawRange` 3000 m —— `DEFAULT_RULES.extendRange`（1500）的兩倍，
 *   個體脫離跑一半就回頭，小隊撤離要更徹底。
 * - `withdrawClimb` 800 m —— 一次淺俯衝換得回來的高度量級。
 * - `arriveRadius` 300 m —— `withdrawRange` 的十分之一。
 */
export const DEFAULT_COMMAND: CommandConfig = {
  planPeriod: 2,
  spentRatio: 0.6,
  spentSeconds: 3,
  withdrawRange: 3000,
  withdrawClimb: 800,
  arriveRadius: 300,
}

/** 水平方向退化的下限。與 `station.ts` 的 `MIN_GROUND_SPEED` 同一個量級 */
const MIN_HORIZONTAL = 1e-3

const P = makeScratch(4)
```

- [ ] **Step 5: 寫 `planFlightOrder`**

接在 Step 4 的內容後面：

```ts
/**
 * 這個小隊此刻該收到什麼命令。`null` = 自由交戰。
 *
 * **純函數**：只讀 `members` 與 `enemies`，不改它們，不碰世界。這是
 * spec §7.1 那一層驗收的前提 —— 混戰的結果太吵，從結果反推判斷品質驗不出
 * 東西，必須能直接餵快照出考題。
 *
 * 【它不判斷「見底了沒」】那是 `stepCommand` 的事（它才有跨步的計時器）。
 * 這裡收到的 `spentSeconds` 是已經累積好的秒數 —— 與 `defendAim` 收
 * `axisSign` 而不自己決定號誌是同一個分工：純函數沒有「這是不是第一格」
 * 的資訊。
 *
 * 【配置】發令時配置一個 `Vector3`。它每 `planPeriod` 秒才可能發生一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param spentSeconds 這個小隊「最低那一架連續低於門檻」已經累積的秒數
 */
export function planFlightOrder(
  members: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  spentSeconds: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  if (spentSeconds < cfg.spentSeconds) return null

  // ── 小隊質心、平均速度、最低升限 ──────────────────────
  const own = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < members.length; i++) {
    const m = members[i]!
    if (!m.alive) continue
    own.add(m.position)
    vel.add(m.velocity)
    if (m.serviceCeiling < ceiling) ceiling = m.serviceCeiling
    n++
  }
  if (n === 0) return null
  own.divideScalar(n)
  vel.divideScalar(n)

  // ── 敵群質心 ──────────────────────────────────────────
  const foe = P.v[2]!.set(0, 0, 0)
  let e = 0
  for (let i = 0; i < enemies.length; i++) {
    const t = enemies[i]!
    if (!t.alive) continue
    foe.add(t.position)
    e++
  }
  // 【沒有敵人就沒有命令】撤離是相對某個威脅而言的。沒有威脅時把小隊送去
  // 遠方只是把它移出戰場。
  if (e === 0) return null
  foe.divideScalar(e)

  // ── 方向：由敵群指向小隊，取水平分量 ────────────────────
  // 退化階梯與 `stationPoint`、`unloadAim`、`applyFloor` 一致：
  // 首選 → 次選 → 固定方向。**不 return、不留 NaN。**
  const dir = P.v[3]!.set(own.x - foe.x, 0, own.z - foe.z)
  let len = dir.length()
  if (len < MIN_HORIZONTAL) {
    // 敵我質心水平重合：「遠離」沒有定義，改用小隊自己的前進方向
    dir.set(vel.x, 0, vel.z)
    len = dir.length()
    if (len < MIN_HORIZONTAL) {
      // 連速度也退化：任何固定方向都一樣好，重點是不要產生 NaN
      dir.set(0, 0, -1)
      len = 1
    }
  }
  dir.divideScalar(len)

  // ── 高度：爬升換能量，夾在安全下界與最低升限之間 ────────
  // 【下界取 clearanceScale（500）而不是安全層的 clearance（120）】政策層
  // 不該把飛機送進硬限制的作用區。與 task #136 的六場護欄取同一條線。
  //
  // 【目前海面恆為 0】未來加入地形時這裡要與 `stationPoint` 一樣收
  // `seaHeight`，下界改成 `seaHeight + clearanceScale`。
  let y = own.y + cfg.withdrawClimb
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  return {
    point: new Vector3(
      own.x + dir.x * cfg.withdrawRange,
      y,
      own.z + dir.z * cfg.withdrawRange,
    ),
    radius: cfg.arriveRadius,
  }
}
```

- [ ] **Step 6: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

預期：十七條全綠、`tsc` 無輸出。

- [ ] **Step 7: Commit**

```bash
git add src/ai/command.ts test/unit/ai-command.test.ts
```

commit 訊息（含中文，走檔案）：

```
feat: 指揮層的規劃純函數 planFlightOrder

只吃快照、吐命令，不碰世界 —— 這是 spec §7.1 那一層驗收的前提：
混戰的結果太吵，從結果反推判斷品質驗不出東西，必須能直接餵快照
出考題。

集合點 = 小隊質心 + 遠離敵群的水平方向 × withdrawRange，高度加一個
爬升量後夾在 clearanceScale（500 m）與最低升限之間。下界取 500 而
不是安全層的 120：政策層不該把飛機送進硬限制的作用區，與 task #136
的六場護欄同一條線。

退化階梯與 stationPoint / unloadAim / applyFloor 一致：敵我質心重合
→ 用小隊速度方向 → 再退化就取固定方向。不 return、不留 NaN ——
stationPoint 的註解記過 NaN 流出去的後果：所有比較都變成 false，
飛機會靜靜地永遠到不了而且完全不報錯。

十七條考題含決定性與連續性兩條，那是 spec §7.5 的否決條件。
```

---

### Task 2: `stepCommand` —— 命令的生命週期

**Files:**
- Modify: `src/ai/command.ts`
- Test: `test/unit/ai-command.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `planFlightOrder`、`CommandUnit`、`FlightOrder`、
  `DEFAULT_COMMAND`
- Produces:
  - `interface CommandFlight { readonly members: Int32Array; readonly count: number }`
  - `interface CommandState { orders: (FlightOrder | null)[]; spent: Float32Array; timer: number }`
  - `function createCommandState(flightCount: number): CommandState`
  - `function stepCommand(s: CommandState, flights: readonly CommandFlight[], units: readonly CommandUnit[], enemies: readonly CommandUnit[], skipFlight: number, dt: number, cfg?: CommandConfig): void`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-command.test.ts` 檔案最後追加。把
`createCommandState`、`stepCommand`、`type CommandFlight` 加進
`from '../../src/ai/command'` 那一組 import：

```ts
/** 造一個分隊：成員是 `units` 裡的索引 */
function flight(...idx: number[]): CommandFlight {
  const members = new Int32Array(4).fill(-1)
  idx.forEach((v, i) => { members[i] = v })
  return { members, count: idx.length }
}

const DT = 1 / 240

describe('stepCommand：命令的生命週期', () => {
  /** 兩架的小隊 + 一架敵機，小隊在原點、敵機在 +Z 1000 */
  function scene(cornerRatio: number) {
    const units: CommandUnit[] = [unit({ cornerRatio }), unit({ x: 200, cornerRatio: 1.2 })]
    const enemies: CommandUnit[] = [unit({ z: 1000 })]
    const flights = [flight(0, 1)]
    const s = createCommandState(flights.length)
    return { units, enemies, flights, s }
  }
  /** 推進 `seconds` 秒 */
  function run(sc: ReturnType<typeof scene>, seconds: number, skip = -1) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.units, sc.enemies, skip, DT, cfg)
    }
  }

  it('健康的小隊永遠不發令', () => {
    const sc = scene(1.2)
    run(sc, 30)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【最低的那一架】spec §2.4：編隊的能力等於最弱的那一架。這一條的第二架
   * 是健康的（1.2），命令仍然要發。
   */
  it('最低那一架持續超時 → 發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  it('還沒累積滿就不發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds * 0.5)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('中途回復健康 → 計時歸零，不發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds * 0.9)
    sc.units[0]!.cornerRatio = 1.2
    run(sc, cfg.spentSeconds * 0.9 + cfg.planPeriod + 1)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('被跳過的小隊（玩家那一隊）不發令', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1, 0)
    expect(sc.s.orders[0]).toBeNull()
  })

  it('全隊陣亡 → 命令清掉、計時歸零', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    expect(sc.s.orders[0]).not.toBeNull()
    sc.flights[0] = { members: sc.flights[0]!.members, count: 0 }
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
    expect(sc.s.spent[0]).toBe(0)
  })

  it('到達集合點 → 命令解除', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    const order = sc.s.orders[0]!
    // 把整隊瞬移到集合點上
    for (const u of sc.units) u.position.copy(order.point)
    run(sc, DT * 2)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【這一條守著 spec §4.2 的遲滯】解除時把見底計時器歸零，就是遲滯 ——
   * 不需要另外加一個 `latch`。若忘了歸零，抵達的下一格就會立刻重發，小隊
   * 會被永久釘在命令狀態。
   */
  it('到達後不會立刻重發：見底計時歸零', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    const order = sc.s.orders[0]!
    for (const u of sc.units) u.position.copy(order.point)
    run(sc, DT * 2)
    expect(sc.s.spent[0]).toBe(0)
    // 再跑一個規劃週期，仍然不該有命令（要重新累積滿 spentSeconds）
    run(sc, cfg.planPeriod + DT)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【集合點凍結】spec §4.1。敵人移動不得讓已發出的命令改點 —— 否則小隊
   * 追著一個移動的目標跑，「到達」永遠判定不了。
   */
  it('命令發出後，敵人移動不會改變集合點', () => {
    const sc = scene(0.4)
    run(sc, cfg.spentSeconds + cfg.planPeriod + 1)
    const before = sc.s.orders[0]!.point.clone()
    sc.enemies[0]!.position.set(5000, 4000, -5000)
    run(sc, cfg.planPeriod * 2)
    expect(sc.s.orders[0]!.point.x).toBe(before.x)
    expect(sc.s.orders[0]!.point.z).toBe(before.z)
  })
})
```

- [ ] **Step 2: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-command.test.ts -t "生命週期"
```

預期：編譯失敗，`createCommandState` / `stepCommand` 不存在。

- [ ] **Step 3: 寫 `CommandFlight`、`CommandState` 與 `createCommandState`**

接在 `planFlightOrder` 之後：

```ts
/**
 * 規劃需要知道的分隊結構。
 *
 * 【為什麼不直接收 `FlightIndex`】現行的相依方向是 `battle → ai`：
 * `setup.ts` import `AiController`、`target.ts`、`station.ts`，而 `src/ai/`
 * **從來不 import `src/battle/`**。收 `FlightIndex` 會把箭頭反過來。
 *
 * `battle/flights.ts` 的 `Flight` 在結構上滿足這個介面，呼叫端直接傳過來
 * 就成立，不需要轉接層。與 `flights.ts` 自己定義 `FlightMember`（而不是收
 * `World.Combatant`）是同一個手法。
 */
export interface CommandFlight {
  /** 存活成員在 `units` 裡的索引。只有前 `count` 格有效 */
  readonly members: Int32Array
  readonly count: number
}

/** 指揮官對一支隊伍的狀態。每個分隊一格 */
export interface CommandState {
  /** `orders[f]` = 第 f 個分隊的命令；`null` = 自由交戰 */
  orders: (FlightOrder | null)[]
  /** 每個分隊「最低那一架連續低於門檻」累積的秒數 */
  spent: Float32Array
  /** 距離下次規劃還有多久，s */
  timer: number
}

export function createCommandState(flightCount: number): CommandState {
  return {
    orders: new Array<FlightOrder | null>(flightCount).fill(null),
    spent: new Float32Array(flightCount),
    // 【起始為 0，第一步就規劃一次】起始為 planPeriod 的話開場前兩秒的
    // 指揮官是啞的，而開局正是編隊最完整、最該被指揮的時候
    timer: 0,
  }
}
```

- [ ] **Step 4: 寫 `stepCommand`**

```ts
/**
 * 推進指揮官一步：累積見底計時、判定到達、到期時規劃。
 *
 * 【為什麼計時每步跑而規劃每 N 秒跑】見底是一個**持續**條件（spec §2.4），
 * 漏數任何一步都會低估；而規劃是昂貴的（要掃全隊與全部敵機）而且是戰役
 * 尺度的決定，不該與戰機的機動同頻。這與 `AiController` 把幾何放 240 Hz、
 * 意圖仲裁放 10 Hz 是同一個分頻原則。
 *
 * 熱路徑：每步的部分不配置。發令的那一格會配置一個 `Vector3`
 * （見 `planFlightOrder`），每 `planPeriod` 秒最多一次。
 *
 * @param units    這一隊的每架快照，索引與 `CommandFlight.members` 對應
 * @param enemies  敵隊的每架快照
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 */
export function stepCommand(
  s: CommandState,
  flights: readonly CommandFlight[],
  units: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  skipFlight: number,
  dt: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
  s.timer -= dt
  const plan = s.timer <= 0
  if (plan) s.timer += cfg.planPeriod

  for (let f = 0; f < flights.length; f++) {
    const flight = flights[f]!

    // 【玩家那一隊自治】spec §2.1。也涵蓋全滅的分隊 —— 兩者都要把殘留的
    // 命令清掉，否則分隊復活（重置戰鬥）時會拿到一張過期的命令
    if (f === skipFlight || flight.count === 0) {
      s.orders[f] = null
      s.spent[f] = 0
      continue
    }

    // ── 見底計時：小隊裡**最低**的那一架 ──────────────────
    let worst = Infinity
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      if (u.cornerRatio < worst) worst = u.cornerRatio
    }
    if (worst < cfg.spentRatio) s.spent[f] += dt
    else s.spent[f] = 0

    // ── 到達判定 ────────────────────────────────────────
    const order = s.orders[f]
    if (order !== null) {
      // 用小隊質心判到達：個別成員可能正在閃躲而落後，整隊到了就算到了
      let cx = 0, cy = 0, cz = 0, n = 0
      for (let p = 0; p < flight.count; p++) {
        const u = units[flight.members[p]!]
        if (u === undefined || !u.alive) continue
        cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
      }
      if (n > 0) {
        cx /= n; cy /= n; cz /= n
        const dx = cx - order.point.x, dy = cy - order.point.y, dz = cz - order.point.z
        if (Math.hypot(dx, dy, dz) <= order.radius) {
          s.orders[f] = null
          // 【歸零就是遲滯】要再累積滿 spentSeconds 才會重發（spec §4.2）。
          // 少了這一行，抵達的下一格就會立刻重發，小隊被永久釘在命令狀態
          s.spent[f] = 0
        }
      }
      continue
    }

    // ── 規劃 ────────────────────────────────────────────
    if (!plan) continue
    MEMBERS.length = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u !== undefined) MEMBERS.push(u)
    }
    s.orders[f] = planFlightOrder(MEMBERS, enemies, s.spent[f]!, cfg)
  }
}

/**
 * 規劃時把分隊成員收集起來的暫存陣列。
 *
 * 【為什麼是模組層級的可變陣列】`planFlightOrder` 收 `readonly CommandUnit[]`
 * 是為了單元測試好寫字面陣列；而這裡每次規劃都 `new Array` 會在 20v20 下
 * 每兩秒配置十次。重用一個並在每次使用前 `length = 0`，與
 * `setup.ts` 的 `ASSISTS` 同一個做法。
 */
const MEMBERS: CommandUnit[] = []
```

- [ ] **Step 5: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 6: Commit**

```bash
git add src/ai/command.ts test/unit/ai-command.test.ts
```

訊息：

```
feat: 指揮官的命令生命週期 stepCommand

見底計時每步累積（漏數任何一步都會低估一個持續條件），規劃每
planPeriod 秒跑一次（昂貴、而且是戰役尺度的決定）—— 與 AiController
把幾何放 240 Hz、意圖仲裁放 10 Hz 是同一個分頻原則。

到達用小隊質心判，個別成員可能正在閃躲而落後。解除時把見底計時器
歸零，那本身就是遲滯，不需要另外加一個 latch —— 少了那一行，抵達的
下一格就會立刻重發，小隊被永久釘在命令狀態。有測試守著。

CommandFlight 是最小介面而不是 FlightIndex：現行相依方向是
battle → ai，src/ai/ 從來不 import src/battle/。Flight 在結構上剛好
滿足它，呼叫端不需要轉接層。
```

---

### Task 3: `rally.ts` —— 飛向一個世界座標點

**Files:**
- Create: `src/ai/rally.ts`
- Test: `test/unit/ai-rally.test.ts`

**Interfaces:**
- Consumes: `src/core/pool.ts` 的 `makeScratch`；
  `src/physics/propulsion.ts` 的 `WEP_THROTTLE`；
  `src/input/throttle.ts` 的 `THROTTLE_FLOOR`
- Produces:
  - `function rallyAim(self: Aircraft, point: Vector3, out: Vector3): void`
  - `function rallyCommand(self: Aircraft, point: Vector3, out: Command): void`

- [ ] **Step 1: 先讀懂要照抄的形狀**

讀 `src/ai/station.ts` 的 `stationCommand`，不要改。三件事要照搬：

1. **近距離不能瞄目標點** —— 誤差趨近 0 時方向由浮點雜訊主導，瞄準向量會
   劇烈擺動而指揮儀會忠實地追上去。`stationCommand` 用連續混合解決。
   **但 rally 不需要**：集合點的用途是「到了就解除」，`arriveRadius`
   （300 m）遠大於雜訊尺度，飛機根本不會逼近到誤差為 0。這是**刻意的簡化**，
   要寫進註解，免得後人以為漏了。
2. 退化寫法：`aimLen < 1e-6` 時退回機首方向。
3. `out.firing = false` —— 開火紀律是獨立的一層（`fire.ts`），撤離途中不開槍。

- [ ] **Step 2: 寫失敗的測試**

建立 `test/unit/ai-rally.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { rallyAim, rallyCommand } from '../../src/ai/rally'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { P51D } from '../../src/specs/p51d'

/** 在 4000 m、機首朝 −Z、以 200 m/s 平飛的飛機 */
function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  a.state.position.set(0, 4000, 0)
  a.state.velocity.set(0, 0, -200)
  a.state.orientation.identity()
  a.prevPosition.copy(a.state.position)
  return a
}

describe('rallyAim', () => {
  it('瞄準點指向集合點，且是單位向量', () => {
    const self = flyer()
    const out = new Vector3()
    rallyAim(self, new Vector3(3000, 4000, 0), out)
    expect(out.length()).toBeCloseTo(1, 9)
    expect(out.x).toBeCloseTo(1, 9)
    expect(out.y).toBeCloseTo(0, 9)
    expect(out.z).toBeCloseTo(0, 9)
  })

  it('集合點在上方時瞄準點朝上', () => {
    const self = flyer()
    const out = new Vector3()
    rallyAim(self, new Vector3(0, 6000, -3000), out)
    expect(out.y).toBeGreaterThan(0)
  })

  /**
   * 【退化】飛機剛好在集合點上時方向沒有定義。回機首而不是 NaN ——
   * NaN 會流進指揮儀，所有比較都變成 false（`stationPoint` 的註解記過
   * 同一件事）。
   */
  it('已經在集合點上 → 回機首方向，不產生 NaN', () => {
    const self = flyer()
    const out = new Vector3()
    rallyAim(self, self.state.position.clone(), out)
    expect(Number.isNaN(out.x + out.y + out.z)).toBe(false)
    expect(out.length()).toBeCloseTo(1, 9)
    expect(out.z).toBeCloseTo(-1, 6)
  })
})

describe('rallyCommand', () => {
  it('遠離集合點時全推力，不減速', () => {
    const self = flyer()
    const cmd = createCommand()
    rallyCommand(self, new Vector3(0, 4000, -5000), cmd)
    expect(cmd.throttle).toBe(WEP_THROTTLE)
    expect(cmd.brake).toBe(0)
  })

  /** 開火紀律是獨立的一層，撤離途中不開槍 */
  it('不開火', () => {
    const self = flyer()
    const cmd = createCommand()
    cmd.firing = true
    rallyCommand(self, new Vector3(0, 4000, -5000), cmd)
    expect(cmd.firing).toBe(false)
  })

  it('瞄準點與 rallyAim 一致', () => {
    const self = flyer()
    const cmd = createCommand()
    const point = new Vector3(1000, 5000, -2000)
    const expected = new Vector3()
    rallyAim(self, point, expected)
    rallyCommand(self, point, cmd)
    expect(cmd.aimWorld.x).toBeCloseTo(expected.x, 12)
    expect(cmd.aimWorld.y).toBeCloseTo(expected.y, 12)
    expect(cmd.aimWorld.z).toBeCloseTo(expected.z, 12)
  })
})
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-rally.test.ts
```

預期：編譯失敗，`src/ai/rally.ts` 不存在。

- [ ] **Step 4: 寫 `src/ai/rally.ts`**

```ts
import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { WEP_THROTTLE } from '../physics/propulsion'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'

const FWD = new Vector3(0, 0, -1)
const R = makeScratch(1)
/** 位置誤差退化的下限，m */
const MIN_ERROR = 1e-6

/**
 * 瞄準集合點的方向，寫進 `out`（單位向量）。就地修改，不碰 `self`。
 *
 * 【為什麼不像 `stationCommand` 那樣近距離改平行飛】站位是一個要**維持**
 * 的狀態，飛機會長期停在誤差趨近 0 的地方，那時方向由浮點雜訊主導。集合點
 * 不是 —— 它的用途是「到了就解除」，而 `arriveRadius`（300 m）遠大於雜訊
 * 尺度，飛機根本不會逼近到誤差為 0。**這是刻意的簡化，不是漏掉。**
 *
 * 熱路徑：不配置。
 */
export function rallyAim(self: Aircraft, point: Vector3, out: Vector3): void {
  const err = R.v[0]!.copy(point).sub(self.state.position)
  const len = err.length()
  if (len < MIN_ERROR) {
    // 【已經在點上】方向沒有定義。回機首而不是留 NaN —— NaN 流進指揮儀之後
    // 所有比較都變成 false，飛機會靜靜地亂飛而且完全不報錯
    out.copy(FWD).applyQuaternion(self.state.orientation)
    return
  }
  out.copy(err).divideScalar(len)
}

/**
 * 飛向集合點。寫滿整個 `Command`（含 `firing = false`）。
 *
 * 【為什麼油門是常數 WEP 而不是像 `stationCommand` 那樣連續調節】站位要
 * **維持相對速度**，所以需要一個比例控制器；撤離只要「盡快到」。而且撤離的
 * 目的正是把能量補回來 —— 全推力本身就是手段的一部分。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`。
 */
export function rallyCommand(self: Aircraft, point: Vector3, out: Command): void {
  rallyAim(self, point, out.aimWorld)
  out.throttle = WEP_THROTTLE
  out.brake = 0
  // 開火紀律是獨立的一層（fire.ts）。撤離途中不開槍
  out.firing = false
}
```

- [ ] **Step 5: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-rally.test.ts
npx tsc --noEmit
```

預期：七條全綠、`tsc` 無輸出。

- [ ] **Step 6: Commit**

```bash
git add src/ai/rally.ts test/unit/ai-rally.test.ts
```

訊息：

```
feat: rallyAim / rallyCommand —— 飛向一個世界座標點

與 station.ts 的差別是「相對一個固定的點」而不是「相對另一架飛機」：
不需要跟著參考機的航跡框轉，也不需要近距離改平行飛。後者是刻意的
簡化並寫進註解 —— 站位要長期停在誤差趨近 0 的地方，集合點的用途是
「到了就解除」，arriveRadius（300 m）遠大於浮點雜訊的尺度。

油門是常數 WEP 而不是比例控制：撤離只要盡快到，而且全推力本身就是
補能量這個目的的一部分。

已經在點上時回機首而不是留 NaN —— stationPoint 的註解記過 NaN 流進
指揮儀的後果：所有比較都變成 false，飛機靜靜地亂飛而且完全不報錯。
```

---

### Task 4: 戰機 AI 這一端 —— 意圖、覆寫、僚機限制

**Files:**
- Modify: `src/ai/rules.ts`
- Modify: `src/ai/steer.ts`
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-steer.test.ts`、`test/unit/ai-controller.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `FlightOrder`；Task 3 的 `rallyAim` / `rallyCommand`
- Produces:
  - `Intent` 增加 `'rally'`
  - `steerCommand` 多一個參數 `rallyPoint: Vector3 | null`（**排在 `defend`
    之後、`out` 之前**）
  - `AiController.order: FlightOrder | null`

- [ ] **Step 1: 讀懂三個插入點**

不要改，只讀：

- `src/ai/rules.ts` 第 3 行的 `export type Intent` 與第 5 行的 `INTENTS`。
- `src/ai/steer.ts` 的 `steerCommand`：`switch (intent)` 有五個 case
  （`engage` / `extend` / `defend` / `merge` / `approach`），**沒有 `default`**。
  加 `'rally'` 到 `Intent` 而不加 case 的話 `aimWorld` 會留著上一格的值 ——
  那是一個不會報錯的沉默 bug。
- `src/ai/AiController.ts`：
  - 第 251 行 `this.intent = stepRules(this.rules, this.sit, danger, period)`
  - 第 260 行 `stepDefend(this.defend, self, attacker, this.intent === 'defend', dt)`
  - 「沒有目標」的分支（`if (!target) { … }`）：有站位參考機時走
    `stationCommand`，否則平飛
  - `this.rules` 是 `readonly` 的公開欄位（第 136 行），可以直接讀
    `this.rules.defendLatch`

- [ ] **Step 2: 寫失敗的測試（`steerCommand` 的 rally 分支）**

在 `test/unit/ai-steer.test.ts` 檔案最後追加。把 `rallyAim` 加進
`from '../../src/ai/rally'`（新增一行 import）：

```ts
describe('rally 意圖', () => {
  it('瞄準點指向集合點', () => {
    const basis = createEngageBasis()
    const sit = createSituation()
    const cmd = createCommand()
    const knobs: Knobs = { leadLag: 0, vertical: 0 }
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)

    const point = new Vector3(5000, 4000, 0)
    steerCommand(
      'rally', 'normal', sit, basis, self, 0, knobs, createDefendState(), point, cmd,
    )
    const expected = new Vector3()
    rallyAim(self, point, expected)
    expect(cmd.aimWorld.x).toBeCloseTo(expected.x, 9)
    expect(cmd.aimWorld.y).toBeCloseTo(expected.y, 9)
    expect(cmd.aimWorld.z).toBeCloseTo(expected.z, 9)
  })

  /**
   * 【集合點為 null 時不得留下前一格的值】意圖與集合點由兩條路徑送進來
   * （`AiController.intent` 與 `AiController.order`），理論上不會不同步，
   * 但一個沉默地沿用舊瞄準點的分支是查不出來的 bug。退化成機首方向。
   */
  it('集合點為 null → 退化成機首方向，不沿用前一格', () => {
    const basis = createEngageBasis()
    const sit = createSituation()
    const cmd = createCommand()
    const knobs: Knobs = { leadLag: 0, vertical: 0 }
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    cmd.aimWorld.set(1, 0, 0)

    steerCommand(
      'rally', 'normal', sit, basis, self, 0, knobs, createDefendState(), null, cmd,
    )
    const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
    expect(cmd.aimWorld.x).toBeCloseTo(nose.x, 9)
    expect(cmd.aimWorld.z).toBeCloseTo(nose.z, 9)
  })

  /**
   * 【離地底限照樣套】spec §5.2。task #136 的那一層在意圖分支之後，對所有
   * 意圖生效 —— 命令不是例外。
   */
  it('低空時離地底限仍然把航跡角抬起來', () => {
    const basis = createEngageBasis()
    const sit = createSituation()
    const cmd = createCommand()
    const knobs: Knobs = { leadLag: 0, vertical: 0 }
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)

    // 地表抬到 3900 → 離地只剩 100 m；集合點在正下方
    const point = new Vector3(0, 3000, -1000)
    steerCommand(
      'rally', 'normal', sit, basis, self, 3900, knobs, createDefendState(), point, cmd,
    )
    expect(Math.asin(cmd.aimWorld.y)).toBeCloseTo(floorPitchAngle(100), 9)
  })
})
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-steer.test.ts -t "rally 意圖"
```

預期：編譯失敗 —— `'rally'` 不是合法的 `Intent`，且 `steerCommand` 只收
九個參數。

- [ ] **Step 4: 加 `'rally'` 到 `Intent`**

在 `src/ai/rules.ts`，把

```ts
export type Intent = 'defend' | 'merge' | 'extend' | 'engage' | 'approach'

export const INTENTS: readonly Intent[] = ['defend', 'merge', 'extend', 'engage', 'approach']
```

換成

```ts
/**
 * 【`rally` 不由 `arbitrate` 產生】它是指揮層的**外部覆寫**
 * （見 `AiController` 裡那兩行）。放進這個聯集是因為 HUD、telemetry 與
 * 測試都以 `Intent` 當意圖的全集 —— 少了它，「AI 現在在幹嘛」就有一格是
 * 顯示不出來的。
 */
export type Intent = 'defend' | 'merge' | 'extend' | 'engage' | 'approach' | 'rally'

export const INTENTS: readonly Intent[] = [
  'defend', 'merge', 'extend', 'engage', 'approach', 'rally',
]
```

- [ ] **Step 5: 加 `rallyPoint` 參數與 `rally` 分支到 `steerCommand`**

在 `src/ai/steer.ts` 檔案頂端的 import 區加一行：

```ts
import { rallyAim } from './rally'
```

把 `steerCommand` 的簽名裡

```ts
  /** 破防狀態。由 `stepDefend` 每步維護 */
  defend: DefendState,
  out: Command,
```

換成

```ts
  /** 破防狀態。由 `stepDefend` 每步維護 */
  defend: DefendState,
  /**
   * 指揮層的集合點；`null` = 沒有命令。
   *
   * 【為什麼是參數而不是從 `sit` 拿】`Situation` 是**態勢**（我與目標的
   * 幾何與能量），集合點是**命令**。混進去會讓 `assess.ts` 得知道有指揮層
   * 這回事，而它現在完全不需要知道。與 `defend: DefendState` 同一個理由：
   * 額外的狀態走參數，不塞進態勢。
   */
  rallyPoint: Vector3 | null,
  out: Command,
```

在 `switch (intent)` 的 `case 'merge': case 'approach':` **之前**插入：

```ts
      case 'rally':
        // 【指揮層的集合點】它不由 arbitrate 產生（見 rules.ts 的 Intent
        // 註解），所以這一格必然來自 AiController 的覆寫。
        //
        // 【null 時退化成機首】兩條路徑理論上不會不同步，但一個沉默地沿用
        // 前一格 aimWorld 的分支是查不出來的 bug。
        if (rallyPoint !== null) rallyAim(self, rallyPoint, out.aimWorld)
        else out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        break
```

- [ ] **Step 6: 補上所有既有呼叫端的新參數**

`steerCommand` 目前有兩類呼叫端：`src/ai/AiController.ts` 一處、
`test/unit/ai-steer.test.ts` 多處。用搜尋找出全部：

```
npx tsc --noEmit
```

`tsc` 會把每一個少傳參數的地方列出來。**既有的呼叫一律傳 `null`** ——
它們都不是 rally 意圖。

- [ ] **Step 7: 跑測試**

```
npx vitest run test/unit/ai-steer.test.ts
npx tsc --noEmit
```

預期：整檔綠、`tsc` 無輸出。

- [ ] **Step 8: 寫失敗的測試（`AiController` 的覆寫與僚機限制）**

在 `test/unit/ai-controller.test.ts` 檔案最後追加。需要的 import 依該檔
既有的寫法補齊（`AiController`、`Aircraft`、`P51D`、`createCommand`、
`Vector3`）：

```ts
describe('指揮層的命令', () => {
  /** 在 4000 m 平飛的飛機 */
  function flyer(): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    return a
  }

  /**
   * 【沒有命令時完全不變】這是整個指揮層能安全上線的前提 —— `order` 為
   * null 的每一架，行為必須與加這一層之前逐位元相同。
   */
  it('order 為 null 時意圖照舊由 arbitrate 決定', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).not.toBe('rally')
  })

  it('有命令且沒有威脅時，意圖是 rally', () => {
    const ai = new AiController()
    const self = flyer()
    const target = flyer()
    target.state.position.set(0, 4000, -800)
    ai.target = target
    ai.order = { point: new Vector3(5000, 4000, 0), radius: 300 }
    const cmd = createCommand()
    for (let i = 0; i < 240; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.intent).toBe('rally')
  })

  /**
   * 【閃躲永遠優先】spec §2.2 與專案負責人 2026-08-07 的裁定。實測支持見
   * task #136：把「速度見底就脫離」提到破防之前，AI 在被連續射擊時飛出
   * 完美直線（同向性 0.99 → 1.00），被打中的時間變成 2.3 倍。
   */
  it('有命令但破防閂鎖閂上時，意圖是 defend', () => {
    const ai = new AiController()
    const self = flyer()
    // 攻擊者咬在正後方 300 m，機首指向自機
    const attacker = flyer()
    attacker.state.position.set(0, 4000, 300)
    ai.target = attacker
    ai.order = { point: new Vector3(5000, 4000, 0), radius: 300 }
    const cmd = createCommand()
    for (let i = 0; i < 480; i++) ai.update(self, 1 / 240, cmd)
    expect(ai.rules.defendLatch).toBe(true)
    expect(ai.intent).toBe('defend')
  })
})
```

- [ ] **Step 9: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-controller.test.ts -t "指揮層的命令"
```

預期：`order` 這個欄位不存在（編譯失敗）。

- [ ] **Step 10: 加 `order` 欄位與兩行覆寫**

在 `src/ai/AiController.ts` 的 import 區加：

```ts
import { rallyCommand } from './rally'
import type { FlightOrder } from './command'
```

在 `threatSource` 欄位附近（公開欄位那一段）加：

```ts
  /**
   * 指揮層下來的命令；`null` = 自由交戰。由 `setup.ts` 每步寫入。
   *
   * 【它是外部覆寫，不是仲裁表裡的一列】見 `update` 裡那兩行的註解。
   */
  order: FlightOrder | null = null
```

在 `this.intent = stepRules(this.rules, this.sit, danger, period)` 的
**正下方**（仍在 `if (decide) { … }` 區塊內）插入：

```ts
      // 【命令是外部覆寫，不是 arbitrate 的一列】那個函式的優先序關係是
      // 實測逐條談定的（相對理由 vs 絕對理由、defend 的絕對優先權，見
      // rules.ts 的長註解與 2026-08-07 的 #136）。把命令插進去會動到那
      // 整組關係；覆寫在外面則一條都不受影響。
      //
      // 【stepRules 照常呼叫】閂鎖要繼續維護，否則命令解除的那一格會拿到
      // 一組停在幾秒前的閂鎖。
      //
      // 【閃躲永遠優先】專案負責人 2026-08-07 裁定，撤退也一樣。「強制
      // 脫離」的意思是「不抵抗、不回頭打」，不是「不閃彈」。
      if (this.order !== null) {
        this.intent = this.rules.defendLatch ? 'defend' : 'rally'
      }
```

**位置是有序的**：必須在
`stepDefend(this.defend, self, attacker, this.intent === 'defend', dt)`
**之前** —— 破防的狀態機讀 `this.intent`，晚一步就吃到舊值。

- [ ] **Step 11: 把集合點傳給 `steerCommand`**

把

```ts
    steerCommand(
      this.intent, mode, this.sit, this.basis, self, this.seaHeight,
      this.knobs, this.defend, raw,
    )
```

換成

```ts
    steerCommand(
      this.intent, mode, this.sit, this.basis, self, this.seaHeight,
      this.knobs, this.defend, this.order === null ? null : this.order.point, raw,
    )
```

- [ ] **Step 12: 「沒有目標」的分支加 rally**

把該分支裡的

```ts
      } else {
        // 沒有目標也沒有站位時維持機首方向平飛。這比「保持上一格的指令」
        // 安全——上一格可能是一個俯衝中的脫離向量。
        raw.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        raw.throttle = 0.7
        raw.brake = 0
        raw.firing = false
      }
```

換成

```ts
      } else if (this.order !== null) {
        // 【長機收到命令且場上沒有值得打的敵人】飛集合點。這一格與下面的
        // 平飛是同一個位置的兩種答案 —— 有命令就有地方去。
        rallyCommand(self, this.order.point, raw)
      } else {
        // 沒有目標也沒有站位時維持機首方向平飛。這比「保持上一格的指令」
        // 安全——上一格可能是一個俯衝中的脫離向量。
        raw.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        raw.throttle = 0.7
        raw.brake = 0
        raw.firing = false
      }
```

- [ ] **Step 13: 僚機的自衛限制**

在 `if (this.board) { … }` 那一段選完目標之後、`const target = this.target`
之前插入：

```ts
      // 【命令對僚機的意思】不是「你也飛去集合點」—— 那會讓編隊在路上散成
      // 一排。是「停止出擊」，於是它掉進下面「沒有目標 → 飛站位」那一格，
      // 自動貼著長機一起走。不需要任何新的協調機制（spec §5.3、§5.4）。
      //
      // 【LEVEL_SELF_DEFENCE 照樣插隊】「有人正在打我」不能被命令擋住，
      // 那與 rules.ts 讓 defend 豁免 minDwell、wingman.ts 讓跨級插隊豁免
      // switchMargin 是同一條原則。
      if (this.order !== null && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE) {
        this.target = null
      }
```

`LEVEL_SELF_DEFENCE` 已經由 `from './wingman'` 匯入（檔案頂端第 22 行
附近那一組）；若沒有就加進去。`wingmanState` 是私有欄位，同一個檔案內
可以直接讀。

- [ ] **Step 14: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-controller.test.ts test/unit/ai-steer.test.ts test/unit/ai-rules.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 15: Commit**

```bash
git add src/ai/rules.ts src/ai/steer.ts src/ai/AiController.ts test/unit/ai-steer.test.ts test/unit/ai-controller.test.ts
```

訊息：

```
feat: 戰機端執行命令 —— rally 意圖與兩行覆寫

命令是外部覆寫，不是 arbitrate 的一列。那個函式的優先序關係是實測
逐條談定的（相對理由 vs 絕對理由、defend 的絕對優先權），把命令插
進去會動到那整組關係；覆寫在外面則一條都不受影響。

覆寫的位置是有序的：必須在 stepDefend 之前，破防的狀態機讀 intent，
晚一步就吃到舊值。

閃躲永遠優先（專案負責人 2026-08-07 裁定，撤退也一樣）。實測支持見
task #136：把「速度見底就脫離」提到破防之前，AI 在被連續射擊時飛出
完美直線，被打中的時間變成 2.3 倍。

命令對僚機的意思是「停止出擊」而不是「你也飛去集合點」—— 後者會讓
編隊在路上散成一排。停止出擊之後它掉進既有的「沒有目標 → 飛站位」
那一格，自動貼著長機一起走。LEVEL_SELF_DEFENCE 照樣插隊。

steerCommand 多收一個 rallyPoint 而不是塞進 Situation：態勢是我與
目標的幾何與能量，集合點是命令。混進去會讓 assess.ts 得知道有指揮層
這回事。
```

---

### Task 5: 接線與通道驗收

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/integration/ai-command-channel.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `createCommandState` / `stepCommand` / `CommandUnit` /
  `CommandState`；Task 4 的 `AiController.order`
- Produces: `Battle` 新增 `blueCommand` / `redCommand` / `commandUnits` 三個欄位

- [ ] **Step 1: 讀懂接線點**

不要改，只讀 `src/battle/setup.ts`：

- `interface Battle`（第 135 行起）與 `createBattle` 裡 `flights` 的建立
  （`createFlights(world.combatants, player.index)`，約第 304 行）
- `wireStations(b)`（約第 363 行）—— 每步由 `stepBattle` 呼叫，示範了
  「每步重算而不是維護增減」的作法
- `stepBattle`（約第 464 行）：`world.step` → `drainKills` → 清指派 →
  接手倒數 → `compactFlights` → `wireStations` → 勝負判定
- 模組層級的 `ASSISTS: number[]`（約第 385 行）—— 重用陣列的既有作法

`cornerSpeed(spec, altitude)` 由 `src/analysis/envelope.ts` 匯出，
`src/ai/safety.ts` 已經在用。

- [ ] **Step 2: 寫失敗的測試**

建立 `test/integration/ai-command-channel.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND } from '../../src/ai/command'
import { DEFAULT_WINGMAN } from '../../src/ai/wingman'
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

interface Observed {
  /** 有沒有任何小隊收過命令 */
  issued: number
  /** 命令解除時是不是因為到達（而不是全滅） */
  arrived: number
  /** 命令期間，受命飛機進入 defend 的取樣數 */
  defendUnderOrder: number
  /** 命令期間，安全層的撞地接管取樣數 */
  groundUnderOrder: number
  /** 命令期間，僚機的站位誤差超過 breakExit 的取樣數 */
  strayUnderOrder: number
  /** 任何飛機掉到安全層 clearance 以下的取樣數 */
  belowClearance: number
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    issued: 0, arrived: 0, defendUnderOrder: 0,
    groundUnderOrder: 0, strayUnderOrder: 0, belowClearance: 0,
  }
  // 上一格每個分隊有沒有命令，用來數「新發出」與「解除」
  const had = new Array<boolean>(b.flights.flights.length).fill(false)

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)

    for (let f = 0; f < b.flights.flights.length; f++) {
      const flight = b.flights.flights[f]!
      const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
      const now = state.orders[f] !== null
      if (now && !had[f]) o.issued++
      if (!now && had[f] && flight.count > 0) o.arrived++
      had[f] = now
    }

    for (const c of b.world.combatants) {
      if (!c.alive) continue
      if (c.aircraft.state.position.y < DEFAULT_SAFETY.clearance) o.belowClearance++
      const ai = c.controller
      if (!(ai instanceof AiController) || ai.order === null) continue
      if (ai.intent === 'defend') o.defendUnderOrder++
      if (ai.safetyAction === 'ground') o.groundUnderOrder++
      if (ai.stationReference !== null && ai.stationError > DEFAULT_WINGMAN.breakExit) {
        o.strayUnderOrder++
      }
    }
  }
  return o
}

describe('指令通道（20v20、120 秒）', () => {
  const o = observe()

  /**
   * 【場景要成立】指揮層若一次都沒發過命令，下面每一條都會空洞地通過。
   * 起始參數（見 `DEFAULT_COMMAND` 的註解）在 20v20 混戰下應該會發不少張。
   */
  it('指揮層真的發過命令', () => {
    expect(o.issued).toBeGreaterThan(0)
  })

  /**
   * 【命令要到得了】發出去卻永遠到不了的命令，等於把小隊永久移出戰場。
   * 這一條是通道存在的意義。
   */
  it('命令會因為到達而解除，不是只會累積', () => {
    expect(o.arrived).toBeGreaterThan(0)
  })

  /**
   * 【安全層不豁免】spec §5.2、§7.2。命令期間撞地接管必須是 0 —— 政策層
   * 把飛機送進硬限制的作用區就是設計失敗。判準與 task #136 的六場護欄
   * 同一條線。
   */
  it('命令期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })

  /**
   * 【僚機不散開】spec §7.2。命令對僚機的意思是「停止出擊」，它應該貼著
   * 長機一起走。站位誤差超過 `breakExit`（1200 m）代表編隊在路上散了。
   */
  it('命令期間僚機不脫隊', () => {
    expect(o.strayUnderOrder).toBe(0)
  })
}, 10 * 60 * 1000)
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/integration/ai-command-channel.test.ts
```

預期：編譯失敗 —— `Battle` 沒有 `blueCommand` / `redCommand`。

- [ ] **Step 4: `Battle` 加三個欄位**

在 `src/battle/setup.ts` 的 import 區加：

```ts
import {
  createCommandState, stepCommand, DEFAULT_COMMAND,
  type CommandState, type CommandUnit,
} from '../ai/command'
import { cornerSpeed } from '../analysis/envelope'
```

在 `interface Battle` 的 `flights` 欄位下方加：

```ts
  /**
   * 兩隊的指揮官。**索引是全域的分隊索引**（`flights.flights` 的下標），
   * 兩個 state 都開滿長度，各自只填自己隊伍的那些格。
   *
   * 【為什麼不各開各的長度】`flightOf[i]` 給的是全域索引，分隊要對應回
   * 指揮官時就得再做一次轉換。開滿比較浪費幾個 null，但少一張對照表。
   */
  readonly blueCommand: CommandState
  readonly redCommand: CommandState
  /**
   * 指揮層讀的每架快照，索引與 `world.combatants` 一致。
   *
   * 【為什麼要一份快照而不是直接傳 `Combatant`】`src/ai/command.ts` 收的是
   * 最小介面 `CommandUnit`（見該檔的註解），而 `cornerRatio` 需要每步重算
   * —— 它不是 `Aircraft` 上現成的欄位。物件重用，每步只改內容。
   */
  readonly commandUnits: CommandUnit[]
```

- [ ] **Step 5: 在 `createBattle` 裡建立它們**

找到 `const flights = createFlights(world.combatants, player.index)` 那一行，
在它**下方**加：

```ts
  const commandUnits: CommandUnit[] = world.combatants.map((c) => ({
    position: c.aircraft.state.position,
    velocity: c.aircraft.state.velocity,
    cornerRatio: 1,
    serviceCeiling: c.aircraft.spec.serviceCeiling,
    alive: c.alive,
  }))
  const blueCommand = createCommandState(flights.flights.length)
  const redCommand = createCommandState(flights.flights.length)
```

**`position` 與 `velocity` 直接持有 `Aircraft` 的向量參考** —— 它們每步被
物理層就地更新，所以快照自動跟著新。只有 `cornerRatio` 與 `alive` 要每步
寫入（Step 6）。

在 `return { … }` 的物件字面裡加上這三個欄位（與 `flights` 相鄰）。

- [ ] **Step 6: 每步推進指揮官**

在 `stepBattle` 裡、`wireStations(b)` 的**下方**（編制壓縮完才有正確的
`members`／`count`），`if (b.outcome !== 'fighting') return` 的**上方**加：

```ts
  stepCommandLayer(b, dt)
```

並在 `wireStations` 函式的下方新增：

```ts
/** 指揮層每步收集的兩隊快照。重用陣列，與 `ASSISTS` 同一個做法 */
const BLUE_UNITS: CommandUnit[] = []
const RED_UNITS: CommandUnit[] = []

/**
 * 推進兩隊的指揮官，並把命令寫進每一架的 `AiController.order`。
 *
 * 【為什麼排在 `wireStations` 之後】`stepCommand` 讀 `flight.count` 與
 * `flight.members`，那兩者由同一步的 `compactFlights` 重算。排在前面會用到
 * 上一步的編制 —— 剛陣亡的成員仍在名單裡。
 *
 * 【玩家那一隊自治】spec §2.1：專案負責人裁定「指揮 AI 不用跟玩家這個小隊
 * 給指令」。`flights.pinned` 已經標了玩家。
 */
function stepCommandLayer(b: Battle, dt: number): void {
  const cs = b.world.combatants

  // ── 快照：位置與速度是參考、每步自動新；這兩個要寫 ──────
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const u = b.commandUnits[i]!
    u.alive = c.alive
    const a = c.aircraft
    // 【為什麼不從 AiController 的 sit 拿】那個欄位是私有的，而且玩家座位
    // 根本沒有 AiController。直接算比較誠實，也不依賴 AI 這一步跑過沒有
    const vc = cornerSpeed(a.spec, a.state.position.y)
    u.cornerRatio = vc > 1e-3 ? a.state.velocity.length() / vc : 0
  }

  BLUE_UNITS.length = 0
  RED_UNITS.length = 0
  for (let i = 0; i < cs.length; i++) {
    ;(cs[i]!.team === 'blue' ? BLUE_UNITS : RED_UNITS).push(b.commandUnits[i]!)
  }

  const playerFlight = b.flights.pinned >= 0 ? b.flights.flightOf[b.flights.pinned]! : -1
  stepCommand(
    b.blueCommand, b.flights.flights, b.commandUnits, RED_UNITS, playerFlight, dt,
  )
  stepCommand(
    b.redCommand, b.flights.flights, b.commandUnits, BLUE_UNITS, playerFlight, dt,
  )

  // ── 發下去 ────────────────────────────────────────────
  for (let f = 0; f < b.flights.flights.length; f++) {
    const flight = b.flights.flights[f]!
    const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
    const order = state.orders[f]!
    for (let p = 0; p < flight.count; p++) {
      const ai = cs[flight.members[p]!]!.controller
      if (ai instanceof AiController) ai.order = order
    }
  }
}
```

**`stepCommand` 收全體 `commandUnits` 而不是分隊過濾過的陣列**：它用
`flight.members[p]` 索引，而那些是**全域**索引。敵方陣列則是過濾過的，
因為規劃只需要「敵人在哪」不需要索引對應。

**兩個 `stepCommand` 都傳同一個 `playerFlight`**：那個索引在紅方的迴圈裡
不會命中任何紅方分隊（玩家恆在藍隊），所以傳它是無害的，而且比寫兩套分支
少一個會忘記同步的地方。

- [ ] **Step 7: 跑測試與型別檢查**

```
npx vitest run test/integration/ai-command-channel.test.ts
npx tsc --noEmit
```

**這一步的預期不是「一定綠」。** 起始參數（`DEFAULT_COMMAND`）是估的，
可能發太多或太少命令。三種結果都要照實記下來：

- 「指揮層真的發過命令」紅 → 門檻太嚴，Task 6 的掃描會處理
- 「命令會因為到達而解除」紅 → `withdrawRange` 太遠或 `arriveRadius` 太小
- 撞地／脫隊那三條紅 → **那是設計問題不是參數問題**，停下來報告

- [ ] **Step 8: Commit**

```bash
git add src/battle/setup.ts test/integration/ai-command-channel.test.ts
```

訊息：

```
feat: 指揮層接線 —— 兩隊各一個指揮官，玩家那一隊自治

排在 wireStations 之後：stepCommand 讀 flight.count 與 members，
那兩者由同一步的 compactFlights 重算，排在前面會用到上一步的編制。

CommandUnit 的 position / velocity 直接持有 Aircraft 的向量參考，
每步被物理層就地更新所以自動跟著新；只有 cornerRatio 與 alive 要
每步寫入。cornerRatio 直接由 cornerSpeed 算而不是從 AiController 的
sit 拿 —— 那個欄位是私有的，而且玩家座位根本沒有 AiController。

通道驗收五條：發得出命令、到得了、命令期間不動用安全層的撞地接管、
沒有飛機掉到 clearance 以下、僚機不脫隊。
```

---

### Task 6: 五個參數的實測掃描與回填

**Files:**
- Modify: `src/ai/command.ts`（只改 `DEFAULT_COMMAND` 的值與註解）
- Modify: `test/integration/ai-command-channel.test.ts`（暫時加掃描用的 `it`，量完刪掉）

**Interfaces:**
- Consumes: Task 5 的 `observe()` 與 `Battle` 的指揮欄位
- Produces: 回填實測值的 `DEFAULT_COMMAND`

- [ ] **Step 1: 在觀測裡加掃描要用的量**

`Observed` 加兩個欄位並在 `observe()` 裡累積：

```ts
  /** 有命令的（飛機 × 取樣）數，除以總取樣數 = 命令佔時比例 */
  orderedSamples: number
  /** 存活飛機的總取樣數，當分母 */
  aliveSamples: number
```

在 `for (const c of b.world.combatants)` 迴圈裡：

```ts
      o.aliveSamples++
      if (ai.order !== null) o.orderedSamples++
```

**注意**：`aliveSamples` 要數所有存活的 `AiController`，所以那一行要放在
`if (!(ai instanceof AiController)) continue` 之後、`ai.order === null` 的
早退之前 —— 現行的早退寫成 `if (!(ai instanceof AiController) || ai.order === null) continue`，
掃描前要把它拆成兩個判斷。

- [ ] **Step 2: 加掃描用的 `it`**

```ts
  it.skip('掃描指揮參數（量測用，不是判準）', () => {
    const base = { ...DEFAULT_COMMAND }
    const restore = () => Object.assign(DEFAULT_COMMAND, base)
    const report = (knob: string, v: number) => {
      const r = observe()
      console.log(JSON.stringify({
        knob, v,
        issued: r.issued, arrived: r.arrived,
        share: (r.orderedSamples / Math.max(r.aliveSamples, 1) * 100).toFixed(2) + '%',
        ground: r.groundUnderOrder, stray: r.strayUnderOrder,
      }))
    }
    for (const v of [0.4, 0.5, 0.6, 0.7, 0.75]) {
      restore(); DEFAULT_COMMAND.spentRatio = v; report('spentRatio', v)
    }
    for (const v of [1, 2, 3, 5, 8]) {
      restore(); DEFAULT_COMMAND.spentSeconds = v; report('spentSeconds', v)
    }
    for (const v of [1500, 3000, 5000, 8000]) {
      restore(); DEFAULT_COMMAND.withdrawRange = v; report('withdrawRange', v)
    }
    for (const v of [400, 800, 1500, 2500]) {
      restore(); DEFAULT_COMMAND.withdrawClimb = v; report('withdrawClimb', v)
    }
    for (const v of [1, 2, 5, 10]) {
      restore(); DEFAULT_COMMAND.planPeriod = v; report('planPeriod', v)
    }
    restore()
  }, 60 * 60 * 1000)
```

`DEFAULT_COMMAND` 是 `const` 物件但屬性可寫，直接指派即可（`defendTilt`
與 `floorPitch` 的掃描用的是同一手）。

- [ ] **Step 3: 跑掃描**

把 `it.skip` 改成 `it`：

```
npx vitest run test/integration/ai-command-channel.test.ts -t "掃描指揮參數"
```

`observe()` 每次跑一場 120 秒的 20v20，掃描共 22 組。若單場超過三分鐘，
先把 `SECONDS` 暫時降到 60 再掃，選完值用 120 秒複測。

- [ ] **Step 4: 選值**

判準（spec §6）：

**核心是「下令頻率的合理區間」。** 太低代表門檻等於沒用（等於沒有指揮），
太高代表小隊一直在離場（等於沒有人在打仗）。單看任何一端都會選錯，所以
與下面兩條一起看：

1. `issued > 0` 且 `arrived > 0` —— 通道會動
2. `ground === 0` 且 `stray === 0` —— 不得因為換參數而破掉 Task 5 的護欄
3. `share`（命令佔時比例）**取讓它落在 5%~25% 的那一組**。理由：低於 5%
   時指揮層對整場的影響小到量不出來，高於 25% 時場上有四分之一的飛機在
   離場 —— 那不是空戰。

**這個 5%~25% 是判準不是實測值**，選完要在 `DEFAULT_COMMAND` 的註解裡
寫明它是怎麼定的，以及實測落在哪。

- [ ] **Step 5: 回填**

把 `DEFAULT_COMMAND` 改成選出來的值，並把 Task 1 Step 4 寫的那段
「**五個數字全部是起始值，待 Task 6 由實測掃描回填**」的註解換成掃描表與
選值理由。格式照這個檔案既有的參數註解（例如 `steer.ts` 的 `defendTilt`
或 `floorPitch`）：**實測表格 + 為什麼選這個 + 重試的前提**。

「重試的前提」要寫明：這組值依賴目前的飛行包絡（`specs/feel.ts` 的五個
倍率）與 `DEFAULT_BATTLE` 的 20v20 編成，兩者大幅改動後要重掃。

- [ ] **Step 6: 刪掉掃描用的 `it`**

它會改動全域設定，留在檔案裡會污染同檔的其他測試。
`Observed` 的兩個新欄位**留著** —— Task 7 的對照要用。

- [ ] **Step 7: 跑整檔並 commit**

```
npx vitest run test/integration/ai-command-channel.test.ts
npx tsc --noEmit
```

```bash
git add src/ai/command.ts test/integration/ai-command-channel.test.ts
```

訊息：

```
test: 指揮參數的實測掃描與回填

五個參數（spentRatio / spentSeconds / withdrawRange / withdrawClimb /
planPeriod）由 22 組 20v20 掃描定值。

核心判準是「下令頻率的合理區間」：太低代表門檻等於沒用（等於沒有
指揮），太高代表小隊一直在離場（等於沒有人在打仗）。單看任何一端
都會選錯，所以與「通道會動」和「不破 Task 5 的護欄」一起看。
```

---

### Task 7: 20v20 對照、全套回歸、回填 spec

**Files:**
- Modify: `test/integration/ai-command-channel.test.ts`
- Modify: `docs/superpowers/specs/2026-08-07-command-ai-orders-design.md`

**Interfaces:**
- Consumes: Task 1–6 的完整改動
- Produces: §7.3 的開／關對照；回填實測值的 spec

- [ ] **Step 1: 加開／關指揮的對照**

`observe()` 加一個參數並在 `Observed` 補三個欄位：

```ts
interface Observed {
  // …既有欄位…
  /** 紅方全程掉的 hp */
  redDamage: number
  /** 藍方全程掉的 hp */
  blueDamage: number
  /**
   * 【spec §2.3 的觀測值，刻意不設門檻】命令發出的那一格，受命飛機正握有
   * 射擊解（`shotInstant > 0`）的次數。
   *
   * 「命令絕對」明知會重踩 `rules.ts` 記載的坑（AI 咬在敵機後方 236 m、
   * 正在開火時被切走，直飛 21 秒）而選擇踩它。這個數字把坑照亮：它高
   * **而且**傷害交換變差，才是同一個病復發；單看它高不算失敗，那是裁定
   * 接受的代價。
   */
  pulledWhileShooting: number
}

function observe(commanders = true): Observed
```

`commanders = false` 時，在 `stepBattle` 之後把兩個 state 的 `orders`
全部清成 null（等於關掉指揮層而不必改生產程式碼）：

```ts
    if (!commanders) {
      b.blueCommand.orders.fill(null)
      b.redCommand.orders.fill(null)
      for (const c of b.world.combatants) {
        const ai = c.controller
        if (ai instanceof AiController) ai.order = null
      }
    }
```

`pulledWhileShooting` 的累積：在偵測「新發出」的那一格，掃該分隊成員，
數有幾架的 `ai.sit.shotInstant > 0`。**`sit` 是私有的** —— 改用
`AiController` 已公開的 `intent`：發令那一格意圖是 `engage` 的架數，
是「正在交戰時被拉走」的可讀代理。若要精確值，另外在 `AiController` 開一個
公開的唯讀 `shotInstant` 鏡像欄位，並在註解寫明它只為量測存在。

**選後者**：代理量會把「approach 中被拉走」誤算成無害，而那正是要看的東西。
在 `AiController` 加：

```ts
  /**
   * 上一格的射擊解強度鏡像。**只為量測存在**（spec §7.3 的觀測值）。
   *
   * 【為什麼不直接公開 `sit`】那會讓外部依賴整個 `Situation` 的形狀，
   * 而它是內部資料結構。鏡像一個純量的相依面積最小。
   */
  shotInstant = 0
```

並在 `update` 的 `evaluateGeometry` 之後寫入 `this.shotInstant = this.sit.shotInstant`。

- [ ] **Step 2: 寫對照測試**

```ts
describe('指揮層的效果（20v20 開／關對照）', () => {
  const on = observe(true)
  const off = observe(false)

  /**
   * 【為什麼是開／關對照而不是「有指揮的一方打贏」】spec §2.1：兩隊都有
   * 指揮官（只有玩家那一隊自治），所以沒有「有指揮 vs 沒指揮」的兩方可比。
   */
  it('傷害交換不得變差', () => {
    console.log(JSON.stringify({
      on: `R${on.redDamage.toFixed(0)}:B${on.blueDamage.toFixed(0)}`,
      off: `R${off.redDamage.toFixed(0)}:B${off.blueDamage.toFixed(0)}`,
      share: (on.orderedSamples / Math.max(on.aliveSamples, 1) * 100).toFixed(2) + '%',
      pulledWhileShooting: on.pulledWhileShooting,
    }))
    // 兩隊對稱，所以總傷害是「這場仗打得多激烈」的量。指揮層讓小隊定期
    // 離場，總傷害本來就會降 —— 判準是**不得崩掉**，取關指揮的一半
    expect(on.redDamage + on.blueDamage).toBeGreaterThan((off.redDamage + off.blueDamage) * 0.5)
  }, 10 * 60 * 1000)

  it('命令佔時比例落在掃描定出的區間', () => {
    const share = on.orderedSamples / Math.max(on.aliveSamples, 1)
    expect(share).toBeGreaterThan(0.05)
    expect(share).toBeLessThan(0.25)
  }, 10 * 60 * 1000)
})
```

**「取關指揮的一半」這個判準要在註解裡寫明它的邏輯**：兩隊對稱，總傷害
量的是「這場仗打得多激烈」；指揮層讓小隊定期離場，總傷害本來就該降一些。
判準是**不得崩掉**。實測值回填後若餘裕很小，報告給專案負責人重新定值。

- [ ] **Step 3: 跑全套（排除兩個並行假紅的檔案）**

```
npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"
```

- [ ] **Step 4: 單獨複測那兩個檔案**

```
npx vitest run test/unit/perf-gate.test.ts test/integration/rematch.test.ts
```

跑之前確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁。

**`perf-gate` 特別要看**（spec §7.4）：指揮層是每步都跑的新工作。規劃本身
是 N 秒一次，但見底計時與快照更新是每步的。若它紅了，先確認
`stepCommandLayer` 沒有在每步配置。

- [ ] **Step 5: 逐條處理紅掉的測試**

`multi-battle.test.ts` 與 `ai-duel-matrix.test.ts` 都會受指揮層影響
（20v20 與 1v1 都經過 `createBattle`）。

**注意 1v1**：`SCHWARM_SIZE` 是 4，1v1 時每隊只有一個一架的分隊 —— 指揮層
照樣會對它發令。若 `ai-duel-matrix` 因此變化，那是真的行為改變，先量再報告。

紅的一律先查根因再報告，**不得逕自調門檻**。spec §7.5 的三條否決條件優先
於一切：規劃的決定性或連續性不成立、命令期間動用了安全層、傷害交換變差
而掃描找不到任何一組參數救得回來 —— 任何一條成立就整份撤回。

- [ ] **Step 6: 回填 spec**

在 `docs/superpowers/specs/2026-08-07-command-ai-orders-design.md` 加一節
「## 9. 實作後的實測回填」，內容：

- 五個參數的掃描表（Task 6）與選值理由
- 通道驗收的實測值（發令次數、到達次數、命令佔時比例）
- 開／關對照的傷害交換
- `pulledWhileShooting` 的實測值，以及對 §2.3 那個坑的判讀
- 若有任何一節的設計在實作中被推翻，明寫「實作後修正」並保留原文供追溯
  （這個專案的既有慣例，見 `2026-08-06-visible-evasion-design.md`）

**同時更正 spec §3.1 的兩處簽名**：

1. `stepCommand` 實際多收一個 `enemies: readonly CommandUnit[]` ——
   `CommandState` 是每隊一個，敵方名單由呼叫端提供，規劃才不必知道
   `Team` 這回事。
2. `CommandUnit` 的 `cornerRatio` 與 `alive` **不是** `readonly` ——
   它們是每步被呼叫端改寫的快照欄位。

**以及 §8 影響範圍表的兩處**：實際新增了 `src/ai/rally.ts`（spec 原本把
rally 的轉向算在 `steer.ts` 裡），而 §7.3 的對照放在新的
`test/integration/ai-command-channel.test.ts` 而不是 `multi-battle.test.ts`
（後者沒有觀測指揮狀態的鉤子，擴充它會把兩件事混在一個檔案裡）。

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-command-ai-orders-design.md test/integration/ai-command-channel.test.ts src/ai/AiController.ts
```

（若 Step 5 有經專案負責人裁定的測試改動，一併 `git add` 那些明確路徑。）

訊息：

```
docs: 指揮 AI 第一份 —— 實作後結果回填

五個參數的掃描表與選值、通道驗收的實測值、開／關對照的傷害交換、
以及 pulledWhileShooting 對「命令絕對」那個坑的判讀。

一併更正設計文件三處：stepCommand 實際多收一個 enemies（CommandState
是每隊一個，敵方名單由呼叫端提供，規劃才不必知道 Team 這回事）；
CommandUnit 的 cornerRatio 與 alive 不是 readonly（每步被改寫的快照
欄位）；rally 的轉向獨立成 src/ai/rally.ts 而不是塞進 steer.ts。
```

---

## Self-Review

**1. Spec 覆蓋**

| Spec 節 | 對應任務 |
|---|---|
| §2.1 玩家那一隊不收命令 | Task 5 Step 6（`playerFlight`）+ Task 2 Step 1 的測試 |
| §2.2 閃躲永遠優先 | Task 4 Step 10 的覆寫 + Step 8 的第三條測試 |
| §2.3 命令絕對 | Task 4 Step 10（覆寫掉一切非 defend）+ Step 13（僚機停止出擊） |
| §2.3 把坑照亮 | Task 7 Step 1 的 `pulledWhileShooting` |
| §2.4 最低那一架 + 持續 T 秒 | Task 2 Step 4 的 `worst` 迴圈 + Step 1 的兩條測試 |
| §3.1 `command.ts` 的介面 | Task 1 Step 4、Task 2 Step 3 |
| §3.2 集合點的算法與退化 | Task 1 Step 5 + Step 2 的退化測試 |
| §4.1 集合點凍結 | Task 2 Step 4（有命令就 `continue`，不重算）+ Step 1 的凍結測試 |
| §4.2 遲滯 | Task 2 Step 4 的 `s.spent[f] = 0` + Step 1 的兩條測試 |
| §5.1 兩行覆寫、不動 `arbitrate` | Task 4 Step 10 |
| §5.2 長機飛集合點 | Task 3 + Task 4 Step 5、Step 12 |
| §5.3 僚機只准自衛 | Task 4 Step 13 |
| §6 五個參數待掃描 | Task 6 |
| §7.1 十二條考題 | Task 1 Step 2（十七條，含 spec 沒列的「半徑是正數」等） |
| §7.2 通道驗收 | Task 5 Step 2（五條） |
| §7.3 開／關對照 | Task 7 Step 2 |
| §7.4 回歸 | Task 7 Step 3–5 |
| §7.5 否決條件 | Task 1 Step 2（決定性／連續性）、Task 5 Step 2（撞地）、Task 7 Step 5 |
| §8 影響範圍 | Task 7 Step 6 更正它 |

**發現的缺口與修補**：

- spec §3.1 的 `stepCommand` 沒有 `enemies` 參數，但規劃需要敵群質心，而
  `CommandUnit` 沒有 `team` 欄位。加 `team` 會讓 `src/ai/command.ts` 依賴
  `World` 的 `Team` 型別，而由呼叫端傳敵方名單零成本 —— 已在 Task 2 的
  Interfaces 定案並排入 Task 7 Step 6 更正 spec。
- spec 把 rally 的轉向算在 `steer.ts` 裡，但 `AiController` 的「沒有目標」
  分支也需要它（那條分支不經過 `steerCommand`）。獨立成 `rally.ts` 讓兩處
  共用同一段幾何 —— 已排入 Task 7 Step 6 更正 spec。
- spec §7.3 要求量「正在有射擊解時被拉走」，但 `AiController.sit` 是私有的。
  Task 7 Step 1 明寫要加一個公開的 `shotInstant` 鏡像欄位，並說明為什麼不
  直接公開 `sit`。

**2. 佔位符掃描**

Task 5 Step 7 與 Task 6 Step 3 刻意不預設紅或綠 —— 那不是佔位符，是因為
起始參數夠不夠用要靠實測，而**三種結果的後續動作都寫明了**（Task 5 Step 7
甚至區分了「參數問題」與「設計問題」兩種紅法）。

Task 6 Step 2 的掃描 `it` 是**暫時**的，Step 6 明寫要刪掉，並指明
`Observed` 的兩個新欄位要留給 Task 7。

**3. 型別一致性**

- `CommandUnit`：Task 1 Step 4 定義，Task 2 Step 4、Task 5 Step 5 消費 ✓
  （`cornerRatio` / `alive` 可寫，`position` / `velocity` / `serviceCeiling`
  唯讀 —— Task 5 Step 5 只寫前兩者 ✓）
- `FlightOrder`：Task 1 Step 4 定義，Task 4 Step 10（`AiController.order`）、
  Step 11（`.point`）、Task 5 Step 6 消費 ✓
- `CommandFlight`：Task 2 Step 3 定義，Task 5 Step 6 傳
  `b.flights.flights`（`Flight` 結構上滿足）✓
- `CommandState`：Task 2 Step 3 定義，Task 5 Step 4/5/6、Task 7 Step 1 消費 ✓
- `planFlightOrder(members, enemies, spentSeconds, cfg?)`：Task 1 Step 5
  定義，Task 2 Step 4 呼叫 ✓
- `stepCommand(s, flights, units, enemies, skipFlight, dt, cfg?)`：Task 2
  Step 4 定義，Task 5 Step 6 呼叫（六個位置參數 + 預設 cfg）✓
- `rallyAim(self, point, out)` / `rallyCommand(self, point, out)`：Task 3
  Step 4 定義，Task 4 Step 5（`rallyAim`）、Step 12（`rallyCommand`）、
  Task 3 Step 2 的測試消費 ✓
- `steerCommand(…, defend, rallyPoint, out, cfg?)`：Task 4 Step 5 改簽名，
  Step 6 修既有呼叫端（一律傳 `null`），Task 4 Step 2 的測試傳十個位置參數 ✓
- `AiController.order` / `.shotInstant`：Task 4 Step 10 / Task 7 Step 1
  定義，Task 5 Step 6、Task 5 Step 2 的測試、Task 7 Step 1 消費 ✓
- `Battle.blueCommand` / `.redCommand` / `.commandUnits`：Task 5 Step 4
  定義，Step 5 建立、Step 6 消費、Task 5 Step 2 與 Task 7 Step 1 的測試
  消費 ✓

**4. 既有檔案的前置確認（已驗）**

- `src/ai/rules.ts:3` 是 `export type Intent = 'defend' | 'merge' | 'extend' | 'engage' | 'approach'`，
  `:5` 是 `INTENTS`
- `src/ai/steer.ts` 的 `steerCommand` 的 `switch (intent)` 在 1291 行，
  五個 case、**沒有 `default`**
- `src/ai/AiController.ts:136` 是 `readonly rules = createRuleState()`（公開）；
  `:125` 是 `private readonly sit = createSituation()`（**私有**，所以要鏡像）；
  `:251` 是意圖賦值；`:260` 是 `stepDefend`
- `src/ai/wingman.ts:87` 的 `WingmanState.level` 存在
- `src/analysis/envelope.ts:428` 是 `export function cornerSpeed(spec, altitude)`，
  `src/ai/safety.ts:4` 已經在 import 它
- `src/battle/setup.ts:304` 是 `createFlights(world.combatants, player.index)`；
  `:363` 是 `wireStations`；`:385` 附近是模組層級的 `ASSISTS`
- `src/specs/types.ts:142` 是 `serviceCeiling: number`
- `src/ai/` 目前**沒有任何**檔案 import `src/battle/`（已 grep 確認）
