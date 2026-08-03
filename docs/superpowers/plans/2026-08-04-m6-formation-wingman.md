# M6 編隊與僚機 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M5 的 40 架各自為戰，組織成每隊 5 個 4 機 Schwarm —— 有編制、有隊形、有長僚協同。

**Architecture:** 三個新的純函數模組（`battle/flights.ts` 編制、`ai/station.ts` 站位、`ai/wingman.ts` 僚機目標），由 `AiController` 依角色分派。隊形保持落在既有的「沒有目標」分支裡，所以 `rules.ts` 的意圖仲裁一個字都不用改。開局距離由 3,000 m 拉到 10,000 m，橫向錯開等比放大到 1,050 m。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals` + `noUnusedParameters`）、three.js、vitest、Vite。

**Spec:** `docs/superpowers/specs/2026-08-04-m6-formation-wingman-design.md`

## Global Constraints

- **全部輸出使用繁體中文** —— 程式註解、commit 訊息、測試名稱一律繁中。
- **熱路徑零配置**：`Controller.update` 與其呼叫的一切不得配置物件。用 `makeScratch(n)` 取模組私有暫存，索引迴圈而非 `for...of`（後者每次配置迭代器）。
- **不得修改 `DifficultyProfile`** —— 專案負責人明確延後難度調整，`ACE` 的兩個欄位維持 0。
- **不寫飛機外形的測試。**
- **不得放寬既有的效能門檻**來讓改動通過。若門檻紅了，修的是量測方法或程式，不是斷言。唯一的例外是 Task 10，而那是一次有推導、有新舊數字紀錄的重新校準。
- **每一個門檻都要附推導或量測。** 不接受「配一個看起來合理的數字」。
- **回歸測試要先驗證舊行為會紅**再套新值。沒被驗證會失敗的回歸測試不算回歸測試。
- `npm run build`（`tsc --noEmit`）是型別的唯一守門員 —— vitest 走 esbuild，**不做型別檢查**，所以測試全綠不代表編得過。每個任務的最後一步都要跑它。
- 提交時**列出明確路徑**，不要 `git add -A`（工作區有一個既存的 `bash.exe.stackdump`）。

## 既有介面速查（實作時會用到，不要憑記憶）

```ts
// src/control/Controller.ts
interface Command { aimWorld: Vector3; throttle: number; brake: number; firing: boolean }
interface Controller { update(self: Aircraft, dt: number, out: Command): void }

// src/ai/rules.ts —— enter > exit 時「高於 enter 才觸發、低於 exit 才解除」
//                    enter < exit 時「低於 enter 才觸發、高於 exit 才解除」
function latch(active: boolean, value: number, enter: number, exit: number): boolean

// src/ai/assess.ts
const THREAT_CONE = 15 * (Math.PI / 180)
const THREAT_RANGE = 900

// src/ai/safety.ts
const DEFAULT_SAFETY = { factor: 1.5, clearance: 120, recoveryPitch: 20 * (Math.PI / 180) }
function applySafety(self: Aircraft, seaHeight: number, out: Command, cfg?): boolean

// src/input/throttle.ts → THROTTLE_FLOOR
// src/physics/propulsion.ts → WEP_THROTTLE（1.1）

// src/world/World.ts
interface Combatant { readonly index: number; readonly aircraft: Aircraft; controller: Controller
                      hp: number; team: Team; alive: boolean; /* ... */ }
type Team = 'blue' | 'red'

// src/ai/target.ts
interface TargetCandidate { readonly index: number; readonly aircraft: Aircraft
                            readonly team: Team; alive: boolean }
interface TargetBoard { readonly candidates: readonly TargetCandidate[]
                        readonly assignments: Int32Array }
function selectTarget(state, board, selfIndex, dt, cfg): Aircraft | null

// src/aircraft/Aircraft.ts
new Aircraft(spec, altitude, tas)
a.state.position / a.state.velocity / a.state.orientation  （皆為 three 物件）
a.prevPosition / a.prevOrientation
```

## 檔案結構

| 檔案 | 責任 | 任務 |
|---|---|---|
| `src/ai/assess.ts`（改） | 把私有的 `shotFactor` 匯出為 `threatFactor` | 1 |
| `src/battle/flights.ts`（新） | 編制結構、保序壓縮、反向查表、站位參考機查詢 | 2 |
| `src/ai/station.ts`（新） | 站位點幾何（航跡水平框、高度夾制）+ 站位控制器（遠近混合、油門） | 3、4 |
| `src/ai/wingman.ts`（新） | 四級目標優先序、`breakRange` 遲滯、最小停留 | 5 |
| `src/ai/AiController.ts`（改） | 角色欄位、目標選擇分派、「沒有目標」分支改為歸隊 | 6 |
| `src/battle/setup.ts`（改） | Schwarm 生成幾何、拉長開局、每步壓縮與站位接線 | 7、8 |
| `test/integration/multi-battle.test.ts`（改） | 編隊觀測量與新門檻 | 9 |
| `test/unit/perf-gate.test.ts`（改） | 20v20 閘門重新校準 | 10 |
| `src/hud/types.ts`、`widgets/contacts.ts`、`widgets/roster.ts`（改） | 僚機標記、分隊存活 | 11 |
| `src/main.ts`（改） | 接線 | 12 |
| `README.md`、spec §14（改） | 實測值回填 | 13 |

**為什麼 `flights.ts` 在 `battle/` 而不在 `ai/`**：它是**戰場的編制**，與 `setup.ts` 的生成佈局是同一件事的兩面（出生位置就是站位）。`ai/` 消費它但不擁有它 —— 與 `target.ts` 不知道 `World` 怎麼組裝是同一條界線。

---

## Task 1: 把 `shotFactor` 匯出為 `threatFactor`

**Files:**
- Modify: `src/ai/assess.ts:318-351`
- Test: `test/unit/ai-assess.test.ts`（既有檔案，在檔尾追加一個 describe）

**Interfaces:**
- Consumes: 無
- Produces: `export function threatFactor(shooter: Aircraft, victim: Aircraft): number` —— 0..1 的瞬時射擊威脅。Task 5 的 `wingman.ts` 用它問「這架敵機正在威脅誰」。

**背景**：`assess.ts` 已經有一個模組私有的 `shotFactor(shooter, victim)`，三個因子相乘（有攔截解且彈丸活得到、機首離預瞄方向多近、距離多近）。僚機要問的「正在威脅 X」就是它。另外定義一個便宜的角度＋距離布林會產生**兩個對「誰在威脅誰」的答案**，而那個矛盾在畫面上看起來就是僚機無故亂衝（spec §7.2）。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-assess.test.ts` 檔尾追加。注意這個檔案已有自己的 import 區塊 —— 把新的 import 併進既有的那一行，不要重複 import 同一個模組。

```ts
describe('threatFactor —— 供僚機掩護判斷使用（M6 spec §7.2）', () => {
  /** 造一架擺在指定位置、朝指定方向平飛的 P-51D。 */
  function at(x: number, y: number, z: number, yaw = 0): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(x, y, z)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    a.state.orientation.copy(q)
    a.prevOrientation.copy(q)
    a.state.velocity.set(0, 0, -200).applyQuaternion(q)
    a.prevPosition.copy(a.state.position)
    return a
  }

  it('咬在正後方 300 m 時為正', () => {
    const victim = at(0, 4000, 0)
    const shooter = at(0, 4000, 300)   // 受害者朝 −Z，射手在他後方 300 m
    expect(threatFactor(shooter, victim)).toBeGreaterThan(0)
  })

  it('背對時為 0', () => {
    const victim = at(0, 4000, 0)
    const shooter = at(0, 4000, 300, Math.PI)  // 射手朝 +Z，背對受害者
    expect(threatFactor(shooter, victim)).toBe(0)
  })

  it('超過 THREAT_RANGE 為 0', () => {
    const victim = at(0, 4000, 0)
    const shooter = at(0, 4000, THREAT_RANGE + 100)
    expect(threatFactor(shooter, victim)).toBe(0)
  })

  it('越近越大', () => {
    const victim = at(0, 4000, 0)
    const near = threatFactor(at(0, 4000, 200), victim)
    const far = threatFactor(at(0, 4000, 600), victim)
    expect(near).toBeGreaterThan(far)
  })

  it('與 evaluateThreat 填進 Situation 的是同一個數字', () => {
    // 【為什麼要測這一條】匯出這件事的全部價值就是「只有一個答案」。
    // 若 evaluateThreat 沒有改成呼叫它，兩者會各自演化而沒有任何測試會紅。
    const self = at(0, 4000, 0)
    const enemy = at(0, 4000, 300)
    const sit = createSituation()
    evaluateThreat(self, enemy, sit)
    expect(sit.threatInstant).toBe(threatFactor(enemy, self))
    expect(sit.shotInstant).toBe(threatFactor(self, enemy))
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-assess.test.ts`
Expected: FAIL，`threatFactor` 不存在（esbuild 會讓 import 變成 undefined，呼叫時 TypeError）

- [ ] **Step 3: 改 `assess.ts`**

把 `shotFactor` 改名為 `threatFactor` 並匯出，`evaluateThreat` 改為呼叫它。**函數本體一個字都不要動** —— 這是純粹的可見性變更。

```ts
/**
 * 一方對另一方的**瞬時**射擊威脅，0..1。三個因子相乘。
 *
 * 【為什麼不是「有沒有預瞄解」這個布林】`solveLead` 有解只代表幾何上
 * 攔截得到，不代表打得中。正面對衝時雙方都有解——只看它的話兩邊都會
 * 判定自己被威脅、兩邊都進 defend，然後永遠卡住（M4 spec §5.3）。
 *
 * 【M6 起匯出】僚機要問「這架敵機正在威脅我的長機嗎」，而那與這裡問的
 * 是同一件事，只是主體換人。另外定義一個便宜的角度＋距離布林會產生
 * **兩個對「誰在威脅誰」的答案** —— 於是可能出現「僚機認為長機被威脅、
 * 長機自己不認為」，而那個矛盾在畫面上看起來就是僚機無故亂衝
 * （M6 spec §7.2）。
 */
export function threatFactor(shooter: Aircraft, victim: Aircraft): number {
  // ...（原 shotFactor 的本體，逐字不動）
}

export function evaluateThreat(self: Aircraft, target: Aircraft, out: Situation): void {
  out.threatInstant = threatFactor(target, self)
  out.shotInstant = threatFactor(self, target)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-assess.test.ts test/unit/ai-controller.test.ts test/integration/ai-duel-matrix.test.ts`
Expected: PASS。**對戰矩陣特別重要** —— 它是「行為完全沒變」的證據。

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無輸出（成功）

- [ ] **Step 6: 提交**

```bash
git add src/ai/assess.ts test/unit/ai-assess.test.ts
git commit -m "refactor: 把 shotFactor 匯出為 threatFactor（M6 spec §7.2）

僚機的掩護判斷要問「這架敵機正在威脅我的長機嗎」，與 assess.ts 已經
在算的是同一件事，只是主體換人。純粹的可見性變更，函數本體不動；
evaluateThreat 改為呼叫它，對戰矩陣是行為不變的證據。

另外定義一個便宜的角度＋距離布林會產生兩個對「誰在威脅誰」的答案。"
```

---

## Task 2: `battle/flights.ts` —— 編制與保序壓縮

**Files:**
- Create: `src/battle/flights.ts`
- Test: `test/unit/battle-flights.test.ts`

**Interfaces:**
- Consumes: 無（只吃一個結構化的最小介面，`Combatant` 在結構上滿足它）
- Produces:
  ```ts
  const SCHWARM_SIZE = 4
  const STATION_REFERENCE: readonly number[]           // [-1, 0, 0, 2]
  interface FlightMember { readonly index: number; readonly team: Team; alive: boolean }
  interface Flight { readonly team: Team; readonly roster: readonly number[]
                     readonly members: Int32Array; count: number }
  interface FlightIndex { readonly flights: readonly Flight[]
                          readonly flightOf: Int32Array; readonly positionOf: Int32Array
                          pinned: number }
  function createFlights(all: readonly FlightMember[], pinned?: number): FlightIndex
  function compactFlights(fi: FlightIndex, all: readonly FlightMember[]): void
  function stationReferenceOf(fi: FlightIndex, index: number): number
  ```

**背景**：階層完全由成員陣列的**順序**推得（spec §5.1）。陣亡就保序壓縮，這一條規則同時做完繼位與 Schwarm 內互補（§5.2）。玩家釘在 `members[0]`（§5.3）。壓縮是存活旗標的純函數，每步重算 —— 與 `countLocks` 每次重掃同一招，自我修復（§5.4）。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import {
  SCHWARM_SIZE, STATION_REFERENCE, createFlights, compactFlights, stationReferenceOf,
  type FlightMember, type FlightIndex,
} from '../../src/battle/flights'

/** 造 n 架藍 + n 架紅，index 依序 0..2n−1。 */
function roster(perSide: number): FlightMember[] {
  const all: FlightMember[] = []
  for (let i = 0; i < perSide; i++) all.push({ index: all.length, team: 'blue', alive: true })
  for (let i = 0; i < perSide; i++) all.push({ index: all.length, team: 'red', alive: true })
  return all
}

/** 讀出某個分隊目前的成員索引。 */
function membersOf(fi: FlightIndex, flight: number): number[] {
  const f = fi.flights[flight]!
  return Array.from(f.members.subarray(0, f.count))
}

describe('createFlights', () => {
  it('20 架切成 5 個 4 機 Schwarm，每隊各自切', () => {
    const all = roster(20)
    const fi = createFlights(all)
    expect(fi.flights.length).toBe(10)
    expect(fi.flights.every((f) => f.roster.length === SCHWARM_SIZE)).toBe(true)
    expect(membersOf(fi, 0)).toEqual([0, 1, 2, 3])
    expect(membersOf(fi, 4)).toEqual([16, 17, 18, 19])
    // 第 5 個分隊是紅隊的第一個
    expect(fi.flights[5]!.team).toBe('red')
    expect(membersOf(fi, 5)).toEqual([20, 21, 22, 23])
  })

  it('架數不是 4 的倍數時，最後一個分隊比較小', () => {
    const fi = createFlights(roster(6))
    // 藍隊 6 架 → [0,1,2,3] 與 [4,5]
    expect(membersOf(fi, 0)).toEqual([0, 1, 2, 3])
    expect(membersOf(fi, 1)).toEqual([4, 5])
  })

  it('index 與陣列位置不一致時丟例外', () => {
    // 【為什麼要檢查】flightOf/positionOf 用陣列位置索引，而 index 是
    // World.add 給的遞增序號。兩者恆等，但「恆等」若沒有被檢查，某天有人
    // 插入一架就會變成無聲的錯位 —— 所有站位都會參照到隔壁那一架。
    // 與 createTargetBoard 是同一道檢查。
    const bad: FlightMember[] = [
      { index: 0, team: 'blue', alive: true },
      { index: 7, team: 'blue', alive: true },
    ]
    expect(() => createFlights(bad)).toThrow(/index/)
  })
})

describe('保序壓縮 —— 一條規則做完繼位與 Schwarm 內互補（M6 spec §5.2）', () => {
  it('members[1] 陣亡 → 原 members[2] 遞補成新的 members[1]', () => {
    // 這就是「另一個 Rotte 滑過來補位」，不需要第二套邏輯
    const all = roster(20)
    const fi = createFlights(all)
    all[1]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([0, 2, 3])
    expect(fi.positionOf[2]).toBe(1)
  })

  it('members[0] 陣亡 → members[1] 升為長機', () => {
    const all = roster(20)
    const fi = createFlights(all)
    all[0]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([1, 2, 3])
    expect(stationReferenceOf(fi, 1)).toBe(-1)   // 新長機沒有站位
  })

  it('只剩一架時它沒有站位 —— 自動退化成獨行俠', () => {
    const all = roster(20)
    const fi = createFlights(all)
    all[0]!.alive = false
    all[1]!.alive = false
    all[3]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([2])
    expect(stationReferenceOf(fi, 2)).toBe(-1)
  })

  it('全滅時是空陣列，不需要特例', () => {
    const all = roster(20)
    const fi = createFlights(all)
    for (let i = 0; i < 4; i++) all[i]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([])
    expect(fi.flightOf[0]).toBe(-1)
    expect(fi.positionOf[0]).toBe(-1)
  })

  it('是存活旗標的純函數 —— 連算兩次結果相同', () => {
    const all = roster(20)
    const fi = createFlights(all)
    all[2]!.alive = false
    compactFlights(fi, all)
    const once = membersOf(fi, 0)
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual(once)
  })

  it('陣亡者復活後回到它在 roster 裡的原位', () => {
    // 【為什麼這一條成立】壓縮讀的是 roster（出生編制，不隨陣亡改變），
    // 不是上一次壓縮的結果。所以它沒有累積誤差，任何錯誤狀態下一拍沖掉。
    const all = roster(20)
    const fi = createFlights(all)
    all[1]!.alive = false
    compactFlights(fi, all)
    all[1]!.alive = true
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([0, 1, 2, 3])
  })
})

describe('玩家釘在 members[0]（M6 spec §5.3）', () => {
  it('玩家陣亡重生後仍然是長機，不會被接到尾端', () => {
    // 【不釘的話會怎樣】玩家會變成別人的僚機，而玩家不照站位飛 ——
    // 那個 Schwarm 從此有一個永遠對不齊的槽位。
    const all = roster(20)
    const fi = createFlights(all, 8)     // 玩家 index 8，在第 2 個分隊
    expect(membersOf(fi, 2)).toEqual([8, 9, 10, 11])
    all[8]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 2)).toEqual([9, 10, 11])
    all[8]!.alive = true
    compactFlights(fi, all)
    expect(membersOf(fi, 2)).toEqual([8, 9, 10, 11])
  })

  it('玩家的隊友死光時，玩家還是 members[0]', () => {
    const all = roster(20)
    const fi = createFlights(all, 8)
    all[9]!.alive = false
    all[10]!.alive = false
    all[11]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 2)).toEqual([8])
  })
})

describe('stationReferenceOf', () => {
  it('滿編時的四個角色（M6 spec §5.1）', () => {
    const fi = createFlights(roster(20))
    expect(STATION_REFERENCE).toEqual([-1, 0, 0, 2])
    expect(stationReferenceOf(fi, 0)).toBe(-1)   // Schwarm 長機，自由
    expect(stationReferenceOf(fi, 1)).toBe(0)    // 他的僚機
    expect(stationReferenceOf(fi, 2)).toBe(0)    // 第二 Rotte 長機
    expect(stationReferenceOf(fi, 3)).toBe(2)    // 第二 Rotte 僚機
  })

  it('剩三架時，落單那一架貼到現有的 Rotte 上', () => {
    // 這正是史實裡 Schwarm 掉一架之後會發生的事
    const all = roster(20)
    const fi = createFlights(all)
    all[1]!.alive = false
    compactFlights(fi, all)
    expect(stationReferenceOf(fi, 2)).toBe(0)
    expect(stationReferenceOf(fi, 3)).toBe(0)
  })

  it('不在編制內或越界的索引回傳 −1', () => {
    const fi = createFlights(roster(20))
    expect(stationReferenceOf(fi, -1)).toBe(-1)
    expect(stationReferenceOf(fi, 999)).toBe(-1)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/battle-flights.test.ts`
Expected: FAIL，`src/battle/flights.ts` 不存在

- [ ] **Step 3: 實作 `src/battle/flights.ts`**

```ts
import type { Team } from '../world/World'

/**
 * 一個 Schwarm 的大小。
 *
 * 【4 機、兩個 Rotte】M0/M1 spec §17 已裁決的編制單位。Rotte（雙機）是
 * 不可分割的戰術單位，Schwarm 是兩個 Rotte 一起飛。
 */
export const SCHWARM_SIZE = 4

/**
 * 站位參考機在**成員陣列裡**的位置，索引即 position。−1 = 沒有站位。
 *
 * ```
 *   members[0]  Schwarm 長機       無站位，自由交戰
 *   members[1]  他的僚機           站位參考 members[0]
 *   members[2]  第二 Rotte 長機    站位參考 members[0]
 *   members[3]  他的僚機           站位參考 members[2]
 * ```
 *
 * 【站位參考機與掩護對象是同一架】除了 members[0]，每個成員都掩護它的
 * 站位參考機 —— 一個概念，沒有特例。members[2] 同時是 members[0] 的
 * 掩護者與 members[3] 的長機，那正是 Rotte 長機這個角色。
 *
 * 【它作用在**壓縮後**的位置上】所以減員時的行為是自動的：只剩三架時
 * 位置只有 0/1/2，落單那一架讀到的參考仍是 0 —— 它貼到現有的 Rotte 上，
 * 正是史實裡 Schwarm 掉一架之後會發生的事。
 */
export const STATION_REFERENCE: readonly number[] = [-1, 0, 0, 2]

/**
 * 建立編制所需的最小資訊。
 *
 * 【為什麼另外定義而不是直接用 Combatant】`World.Combatant` 在結構上滿足
 * 這個介面，但編制不需要知道世界是怎麼組裝的（射速時鐘、包圍球半徑、
 * 出生點都與誰跟誰一隊無關）。`Team` 以 `import type` 取得 —— 型別匯入
 * 會被完全抹除，不產生執行期相依。與 `target.ts` 的 `TargetCandidate`
 * 是同一個做法。
 */
export interface FlightMember {
  /** **必須等於它在陣列裡的位置**。`createFlights` 會檢查 */
  readonly index: number
  readonly team: Team
  alive: boolean
}

export interface Flight {
  readonly team: Team
  /** 出生編制。順序即階層，**不隨陣亡改變** */
  readonly roster: readonly number[]
  /** 存活成員，由 roster 保序壓縮而得。只有前 `count` 格有效 */
  readonly members: Int32Array
  count: number
}

export interface FlightIndex {
  readonly flights: readonly Flight[]
  /** `flightOf[i]` = 第 i 架屬於哪個分隊；−1 = 已退場或不在編制內 */
  readonly flightOf: Int32Array
  /** `positionOf[i]` = 第 i 架在自己分隊 `members` 裡的位置；−1 = 同上 */
  readonly positionOf: Int32Array
  /**
   * 恆佔自己分隊 `members[0]` 的那一架（玩家）；−1 = 沒有。
   *
   * 【唯一的例外，必須釘死】玩家陣亡後會被重生。照一般規則壓縮的話他會
   * 被接到陣列尾端變成別人的僚機 —— 而玩家不照站位飛，那個 Schwarm 從此
   * 有一個永遠對不齊的槽位（M6 spec §5.3）。
   */
  pinned: number
}

/**
 * 依隊伍把成員切成 Schwarm。架數不是 `SCHWARM_SIZE` 的倍數時，最後一個
 * 分隊比較小 —— 那不需要特例，壓縮與站位查詢都只看 `count`。
 */
export function createFlights(all: readonly FlightMember[], pinned = -1): FlightIndex {
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.index !== i) {
      throw new Error(`FlightMember.index 必須等於陣列位置：第 ${i} 個是 ${all[i]!.index}`)
    }
  }

  const flights: Flight[] = []
  for (const team of ['blue', 'red'] as const) {
    const ids: number[] = []
    for (let i = 0; i < all.length; i++) if (all[i]!.team === team) ids.push(i)
    for (let s = 0; s < ids.length; s += SCHWARM_SIZE) {
      const roster = ids.slice(s, s + SCHWARM_SIZE)
      flights.push({
        team,
        roster,
        members: new Int32Array(roster.length).fill(-1),
        count: 0,
      })
    }
  }

  const fi: FlightIndex = {
    flights,
    flightOf: new Int32Array(all.length).fill(-1),
    positionOf: new Int32Array(all.length).fill(-1),
    pinned,
  }
  compactFlights(fi, all)
  return fi
}

/**
 * 保序壓縮：把退場者從成員陣列移除，後面往前遞補。
 *
 * **這一條規則同時實作繼位與 Schwarm 內互補**（M6 spec §5.2）：
 *
 * | 事件 | 結果 |
 * |---|---|
 * | `members[1]` 陣亡 | `members[2]` 遞補 —— 另一個 Rotte 滑過來補位 |
 * | `members[0]` 陣亡 | `members[1]` 升為長機 |
 * | 剩一架 | 沒有站位參考機 = 獨行俠，自動成立 |
 *
 * 【為什麼每步重算而不是維護增減】與 `countLocks` 每次重掃同一個理由：
 * 維護要求每一條退場路徑都配一次更新，漏掉任何一條就留下一個永遠不消失
 * 的幽靈狀態，而症狀離成因很遠。重算是 O(架數)，而且**自我修復**。
 *
 * 【它讀 `roster` 而不是上一次的結果】所以沒有累積誤差 —— 復活的飛機會
 * 回到原位，而不是被接到尾端。
 *
 * 【結構上不可能震盪】一場戰鬥之內陣亡是單向的（AI 的 `respawnOnDestroy`
 * 為 false），成員陣列只會變短。這是本專案少數不需要遲滯的狀態。
 *
 * 熱路徑：不配置。
 */
export function compactFlights(fi: FlightIndex, all: readonly FlightMember[]): void {
  fi.flightOf.fill(-1)
  fi.positionOf.fill(-1)

  const pinned = fi.pinned
  for (let f = 0; f < fi.flights.length; f++) {
    const flight = fi.flights[f]!
    const roster = flight.roster
    let n = 0

    // 【釘住的那一架先放】它恆佔 members[0]
    if (pinned >= 0) {
      for (let r = 0; r < roster.length; r++) {
        if (roster[r]! !== pinned) continue
        if (all[pinned]!.alive) flight.members[n++] = pinned
        break
      }
    }
    for (let r = 0; r < roster.length; r++) {
      const i = roster[r]!
      if (i === pinned) continue
      if (!all[i]!.alive) continue
      flight.members[n++] = i
    }

    flight.count = n
    for (let p = 0; p < n; p++) {
      fi.flightOf[flight.members[p]!] = f
      fi.positionOf[flight.members[p]!] = p
    }
  }
}

/**
 * 第 `index` 架的站位參考機（`World.combatants` 的索引）；−1 = 沒有站位。
 *
 * 沒有站位的三種情形：Schwarm 長機、已退場、分隊只剩它一架。三者都退化成
 * M5 的獨行俠行為，呼叫端不必分辨。
 */
export function stationReferenceOf(fi: FlightIndex, index: number): number {
  if (index < 0 || index >= fi.flightOf.length) return -1
  const f = fi.flightOf[index]!
  const pos = fi.positionOf[index]!
  if (f < 0 || pos < 0) return -1
  const ref = STATION_REFERENCE[pos] ?? -1
  if (ref < 0) return -1
  const flight = fi.flights[f]!
  // ref 恆小於 count：pos = 3 需要 count ≥ 4 而 ref = 2；pos = 1 或 2 的
  // ref = 0。這個界限由 STATION_REFERENCE 的內容保證，不是碰巧成立。
  return flight.members[ref]!
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/battle-flights.test.ts`
Expected: PASS（14 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無輸出

- [ ] **Step 6: 提交**

```bash
git add src/battle/flights.ts test/unit/battle-flights.test.ts
git commit -m "feat: 編制與保序壓縮（M6 spec §5）

每個 Schwarm 存一個有序的成員索引陣列，階層完全由順序推得。陣亡就
保序壓縮 —— 這一條規則同時做完繼位與 Schwarm 內互補：members[1] 掛了
members[2] 遞補，那就是「另一個 Rotte 滑過來補位」，不需要第二套邏輯。

壓縮讀的是 roster（出生編制）而不是上一次的結果，所以沒有累積誤差，
復活的飛機會回到原位。而且它結構上不可能震盪 —— 一場戰鬥內陣亡是單向
的，成員陣列只會變短。本專案少數不需要遲滯的狀態。

玩家釘在 members[0]：不釘的話他重生後會變成別人的僚機，而玩家不照
站位飛，那個 Schwarm 從此有一個永遠對不齊的槽位。"
```

---

## Task 3: `ai/station.ts` —— 站位點幾何

**Files:**
- Create: `src/ai/station.ts`
- Test: `test/unit/ai-station.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SAFETY`（`src/ai/safety.ts`）
- Produces:
  ```ts
  interface StationOffset { along: number; across: number; up: number }
  const STATION_OFFSETS: readonly StationOffset[]
  function stationPoint(reference: Aircraft, offset: StationOffset,
                        seaHeight: number, out: Vector3): void
  ```

**背景**（spec §6.1，這一題有唯一答案）：站位不能定義在長機的**機體**座標系裡。`steer.ts` 記著 P-51D 的最大滾轉率約 100°/s = 1.75 rad/s；站位在側方 200 m 時，長機一個滾轉就讓站位點以 `1.75 × 200 = 349 m/s` 掃過去 —— 比飛機的整個 TAS（巡航 200 m/s）還快，**物理上追不到**。改用航跡的水平框，站位點只跟著轉彎移動：`rules.ts` 記著最佳持續轉彎率約 0.23 rad/s，`0.23 × 200 = 46 m/s`，在速度餘裕之內。代價是長機倒飛時僚機不跟著倒 —— 那是正確的代價。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'

/** 造一架擺在指定位置、以指定速度飛行的 P-51D。 */
function craft(pos: Vector3, vel: Vector3, orientation = new Quaternion()): Aircraft {
  const a = new Aircraft(P51D, Math.max(pos.y, 1), vel.length() || 1)
  a.state.position.copy(pos)
  a.state.velocity.copy(vel)
  a.state.orientation.copy(orientation)
  a.prevPosition.copy(pos)
  a.prevOrientation.copy(orientation)
  return a
}

const OUT = new Vector3()

describe('stationPoint —— 航跡的水平框（M6 spec §6.1）', () => {
  it('平飛朝 −Z 時，across 是 +X、along 的負值是 +Z（後方）', () => {
    // three 的座標系：+X 右、+Y 上、−Z 前。朝 −Z 飛時右手邊就是 +X。
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    stationPoint(lead, { along: -60, across: 200, up: 0 }, 0, OUT)
    expect(OUT.x).toBeCloseTo(200, 6)
    expect(OUT.y).toBeCloseTo(4000, 6)
    expect(OUT.z).toBeCloseTo(60, 6)     // along 為負 = 後方 = +Z
  })

  it('朝 +X 平飛時，右手邊是 +Z', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(200, 0, 0))
    stationPoint(lead, { along: 0, across: 200, up: 0 }, 0, OUT)
    expect(OUT.x).toBeCloseTo(0, 6)
    expect(OUT.z).toBeCloseTo(200, 6)
  })

  it('up 是**世界**垂直，不隨姿態', () => {
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 3)
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200), rolled)
    stationPoint(lead, { along: 0, across: 0, up: 50 }, 0, OUT)
    expect(OUT.y).toBeCloseTo(4050, 6)
  })
})

describe('滾轉不會移動站位點 —— 這是採用水平框的全部理由', () => {
  it('同一組位置與速度、只換滾轉姿態，站位點完全相同', () => {
    // 【這條測試有一個陷阱】水平航跡退化時的備援用的是**機首**的水平
    // 投影，而機首會隨滾轉改變。所以這條必須在**非退化**的態勢下寫
    // （長機有明確的水平速度），否則它會在備援路徑上失敗 —— 而那個
    // 失敗是對的（M6 spec §13.1）。
    const pos = new Vector3(100, 4000, -50)
    const vel = new Vector3(30, 0, -198)
    const offset = STATION_OFFSETS[1]!
    const level = craft(pos, vel, new Quaternion())
    const a = new Vector3()
    stationPoint(level, offset, 0, a)

    for (const angle of [0.5, 1.5, Math.PI, -2.2]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), angle)
      const rolled = craft(pos, vel, q)
      const b = new Vector3()
      stationPoint(rolled, offset, 0, b)
      expect(b.x).toBe(a.x)
      expect(b.y).toBe(a.y)
      expect(b.z).toBe(a.z)
    }
  })

  it('轉彎時站位點才會移動', () => {
    const pos = new Vector3(0, 4000, 0)
    const a = new Vector3()
    const b = new Vector3()
    stationPoint(craft(pos, new Vector3(0, 0, -200)), STATION_OFFSETS[1]!, 0, a)
    stationPoint(craft(pos, new Vector3(200, 0, 0)), STATION_OFFSETS[1]!, 0, b)
    expect(a.distanceTo(b)).toBeGreaterThan(100)
  })
})

describe('退化與夾制', () => {
  it('垂直俯衝時改用機首的水平投影，不產生 NaN', () => {
    // 水平速度分量趨近 0 → 航跡方向沒有定義
    const nose = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, -200, 0), nose)
    stationPoint(lead, STATION_OFFSETS[1]!, 0, OUT)
    expect(Number.isFinite(OUT.x)).toBe(true)
    expect(Number.isFinite(OUT.y)).toBe(true)
    expect(Number.isFinite(OUT.z)).toBe(true)
  })

  it('速度與機首都垂直時仍然不產生 NaN', () => {
    const up = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 200, 0), up)
    stationPoint(lead, STATION_OFFSETS[1]!, 0, OUT)
    expect(Number.isFinite(OUT.x + OUT.y + OUT.z)).toBe(true)
  })

  it('站位點的高度夾在海面 + 安全層 clearance 之上（M6 spec §6.3）', () => {
    // 【為什麼要夾】不夾的話僚機會與自己的安全層打架：站位控制器命令
    // 下降、安全層命令拉起，每一格互相抵銷。
    const lead = craft(new Vector3(0, 30, 0), new Vector3(0, 0, -200))
    stationPoint(lead, { along: 0, across: 0, up: -100 }, 0, OUT)
    expect(OUT.y).toBeCloseTo(DEFAULT_SAFETY.clearance, 6)
  })

  it('海面不是 0 時夾制跟著抬高', () => {
    const lead = craft(new Vector3(0, 100, 0), new Vector3(0, 0, -200))
    stationPoint(lead, { along: 0, across: 0, up: 0 }, 50, OUT)
    expect(OUT.y).toBeCloseTo(50 + DEFAULT_SAFETY.clearance, 6)
  })
})

describe('STATION_OFFSETS —— 四指隊形（M6 spec §6.2）', () => {
  it('長度等於 Schwarm 大小，position 0 是佔位（它永遠不會被讀）', () => {
    expect(STATION_OFFSETS.length).toBe(4)
    expect(STATION_OFFSETS[0]).toEqual({ along: 0, across: 0, up: 0 })
  })

  it('相對 members[0] 的橫向分布是 0 / +200 / −250 / −450，跨度 650 m', () => {
    // position 3 的參考機是 members[2]，所以要疊加
    const p1 = STATION_OFFSETS[1]!.across
    const p2 = STATION_OFFSETS[2]!.across
    const p3 = p2 + STATION_OFFSETS[3]!.across
    expect(p1).toBe(200)
    expect(p2).toBe(-250)
    expect(p3).toBe(-450)
    expect(Math.max(0, p1, p2, p3) - Math.min(0, p1, p2, p3)).toBe(650)
  })

  it('每一架都在參考機後方 —— 僚機在前面看不到長機', () => {
    for (let i = 1; i < STATION_OFFSETS.length; i++) {
      expect(STATION_OFFSETS[i]!.along).toBeLessThan(0)
    }
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-station.test.ts`
Expected: FAIL，`src/ai/station.ts` 不存在

- [ ] **Step 3: 實作 `src/ai/station.ts`（本任務只做站位點，控制器在 Task 4）**

```ts
import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEFAULT_SAFETY } from './safety'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 一個站位相對參考機的三個偏置量，m。全部定義在**參考機航跡的水平框**裡。
 *
 * 【為什麼不是機體框】站位在側方 200 m、長機以最大滾轉率 100°/s
 * （1.75 rad/s）滾轉時，機體框的站位點會以 `1.75 × 200 = 349 m/s` 掃過去
 * —— 比飛機的整個 TAS（巡航 200 m/s）還快。僚機不是跟不好，是**物理上
 * 追不到**。水平框的站位點只跟著**轉彎**移動：最佳持續轉彎率 0.23 rad/s
 * 給 `0.23 × 200 = 46 m/s`，在速度餘裕之內（M6 spec §6.1）。
 *
 * 代價：長機倒飛時僚機不跟著倒。一個追不到的站位點，比一個不夠帥的站位點
 * 糟得多。
 */
export interface StationOffset {
  /** 沿參考機的水平航跡方向。**負 = 後方** */
  along: number
  /** 垂直於水平航跡、在水平面內。正 = 右 */
  across: number
  /** **世界**垂直 */
  up: number
}

/**
 * 依成員位置給站位偏置（M6 spec §6.2）。索引即壓縮後的 position。
 *
 * ```
 *   position 1  參考 members[0]   across +200  along  −60  up   0
 *   position 2  參考 members[0]   across −250  along −120  up +50
 *   position 3  參考 members[2]   across −200  along  −60  up   0
 * ```
 *
 * 相對 `members[0]` 的橫向分布是 `0 / +200 / −250 / −450`，全隊跨度 650 m。
 *
 * 【200 m 從哪來】史實 Rotte 的間距就是這個量級，而寬間距**正是** Rotte
 * 勝過 RAF 密集 vic 的原因 —— 兩架都能四處張望，而不是盯著長機翼尖。它
 * 同時通過兩個下界：遠大於翼展 11 m（不會讀起來像要相撞），也遠大於
 * `fire.ts` 的 `trackingCone`（3°）在近距離的寬度。
 *
 * 【第二個 Rotte 抬高 50 m】同高的話從正後方看會疊成一條線。
 *
 * **起始值，待 Task 13 由人工驗收與實測回填。**
 *
 * position 0 沒有站位，那一格永遠不會被讀到；填 0 只是讓陣列長度與
 * `SCHWARM_SIZE` 一致，索引才能直接用 position。
 */
export const STATION_OFFSETS: readonly StationOffset[] = [
  { along: 0, across: 0, up: 0 },
  { along: -60, across: 200, up: 0 },
  { along: -120, across: -250, up: 50 },
  { along: -60, across: -200, up: 0 },
]

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(1)
/** 水平分量退化的下限，m/s。低於此值方向由浮點雜訊主導 */
const MIN_GROUND_SPEED = 1e-3

/**
 * 算出站位點的世界座標，寫進 `out`。不修改 `reference`。
 *
 * 高度夾在 `seaHeight + DEFAULT_SAFETY.clearance` 之上 —— 不夾的話僚機會
 * 與自己的安全層打架：站位控制器命令下降、安全層命令拉起，每一格互相
 * 抵銷（M6 spec §6.3）。
 *
 * 熱路徑：不配置。
 */
export function stationPoint(
  reference: Aircraft, offset: StationOffset, seaHeight: number, out: Vector3,
): void {
  const v = reference.state.velocity
  let fx = v.x
  let fz = v.z
  let len = Math.hypot(fx, fz)

  if (len < MIN_GROUND_SPEED) {
    // 垂直俯衝／爬升：水平航跡沒有定義，改用機首的水平投影。
    // 與 `unloadAim`、`applySafety` 用同一套退化階梯。
    const nose = S.v[0]!.copy(FWD).applyQuaternion(reference.state.orientation)
    fx = nose.x
    fz = nose.z
    len = Math.hypot(fx, fz)
    if (len < MIN_GROUND_SPEED) {
      // 機首也垂直：任何固定方向都可以，重點是不要產生 NaN —— NaN 一旦
      // 進入站位誤差，所有比較都變成 false，僚機會靜靜地永遠不歸隊而且
      // 完全不報錯（與 assess.ts 的防護同一個理由）。
      fx = 0
      fz = -1
      len = 1
    }
  }
  fx /= len
  fz /= len

  // 右手側：three 是 +X 右、+Y 上、−Z 前，所以航跡 (fx, fz) 的右邊是
  // (−fz, fx)。驗算：朝 −Z（fx=0, fz=−1）時右邊是 (1, 0) = +X。
  const rx = -fz
  const rz = fx

  const p = reference.state.position
  out.set(
    p.x + fx * offset.along + rx * offset.across,
    p.y + offset.up,
    p.z + fz * offset.along + rz * offset.across,
  )

  const floor = seaHeight + DEFAULT_SAFETY.clearance
  if (out.y < floor) out.y = floor
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-station.test.ts`
Expected: PASS（12 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無輸出

- [ ] **Step 6: 提交**

```bash
git add src/ai/station.ts test/unit/ai-station.test.ts
git commit -m "feat: 站位點幾何 —— 航跡的水平框（M6 spec §6.1）

站位不能定義在長機的機體座標系裡。站位在側方 200 m、長機以最大滾轉率
100°/s 滾轉時，機體框的站位點會以 349 m/s 掃過去 —— 比飛機的整個 TAS
還快，物理上追不到。

水平框的站位點只跟著轉彎移動：最佳持續轉彎率 0.23 rad/s 給 46 m/s，
在速度餘裕之內。代價是長機倒飛時僚機不跟著倒 —— 一個追不到的站位點，
比一個不夠帥的站位點糟得多。

高度夾在海面 + 安全層 clearance 之上：不夾的話僚機會與自己的安全層
打架，站位控制器命令下降、安全層命令拉起，每一格互相抵銷。"
```

---

## Task 4: `ai/station.ts` —— 站位控制器

**Files:**
- Modify: `src/ai/station.ts`（在 Task 3 的檔案末尾追加）
- Test: `test/unit/ai-station.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `stationPoint`、`STATION_OFFSETS`（Task 3）、`THROTTLE_FLOOR`、`WEP_THROTTLE`
- Produces:
  ```ts
  interface StationConfig { blendRange: number; leadTime: number
                            speedGain: number; speedBand: number }
  const DEFAULT_STATION: StationConfig
  function stationCommand(self: Aircraft, reference: Aircraft, offset: StationOffset,
                          seaHeight: number, out: Command, cfg?: StationConfig): void
  ```

**背景**（spec §6.4）：指令介面只有 `aimWorld` + `throttle` + `brake`，所以要把「位置誤差」翻譯成這三個量。兩個非顯而易見的設計點：

1. **近距離不能瞄站位點。** 誤差趨近 0 時方向由浮點雜訊主導 —— 瞄準向量會劇烈擺動，而指揮儀會忠實地追上去。近距離改成瞄參考機的航跡方向（平行飛）。用**連續混合**而不是門檻，因為它不需要遲滯（與 `engageKnobs` 同一個理由）。它同時解決視覺重疊：瞄著站位點飛會直直朝長機收斂，平行飛不會。
2. **前置補償用相對速度，不是參考機的絕對速度。** 純追蹤一個移動點永遠落後；但若用絕對速度外推，共速且已在站位上時外推點仍在前方約 200 m，「近距離平行飛」那一段就**永遠不會生效**。相對速度在共速時歸零，正是要的。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-station.test.ts` 追加（沿用該檔已有的 `craft` 輔助函數）。檔頭的 import 併進既有區塊：

```ts
import { DEFAULT_STATION, stationCommand } from '../../src/ai/station'
import { createCommand } from '../../src/control/Controller'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
```

```ts
describe('stationCommand（M6 spec §6.4）', () => {
  const OFFSET = { along: -60, across: 200, up: 0 }

  /** 把 self 擺到剛好在站位上、且與參考機共速。 */
  function onStation(lead: Aircraft): Aircraft {
    const p = new Vector3()
    stationPoint(lead, OFFSET, 0, p)
    return craft(p, lead.state.velocity.clone())
  }

  it('在站位上且共速時，瞄準方向等於參考機的航跡方向（不是站位點方向）', () => {
    // 【這是近距離平行飛的核心斷言】若前置補償用的是參考機的絕對速度
    // 而不是相對速度，這一條會紅 —— 外推點會在前方 200 m，混合權重
    // 永遠是 1，「平行飛」那一段從來不會生效。
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = onStation(lead)
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
    expect(out.aimWorld.y).toBeCloseTo(0, 6)
    expect(out.aimWorld.z).toBeCloseTo(-1, 6)
  })

  it('瞄準方向恆為單位向量', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const out = createCommand()
    for (const d of [0, 5, 50, 300, 5000]) {
      const wing = craft(new Vector3(d, 4000, 900), new Vector3(0, 0, -200))
      stationCommand(wing, lead, OFFSET, 0, out)
      expect(out.aimWorld.length()).toBeCloseTo(1, 9)
    }
  })

  it('離站位很遠時瞄向站位點', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const station = new Vector3()
    stationPoint(lead, OFFSET, 0, station)
    // 擺在站位正下方 2 km、與參考機共速（相對速度為 0，前置項消失）
    const wing = craft(
      station.clone().add(new Vector3(0, -2000, 0)), lead.state.velocity.clone(),
    )
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.aimWorld.y).toBeGreaterThan(0.9)
  })

  it('落後時加油門，追過頭時踩減速板', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const station = new Vector3()
    stationPoint(lead, OFFSET, 0, station)
    const out = createCommand()

    // 落在站位後方 500 m（航跡是 −Z，所以後方是 +Z）且同速
    const behind = craft(station.clone().add(new Vector3(0, 0, 500)), new Vector3(0, 0, -200))
    stationCommand(behind, lead, OFFSET, 0, out)
    expect(out.throttle).toBe(WEP_THROTTLE)
    expect(out.brake).toBe(0)

    // 衝到站位前方 500 m 且比長機快 60 m/s
    const ahead = craft(station.clone().add(new Vector3(0, 0, -500)), new Vector3(0, 0, -260))
    stationCommand(ahead, lead, OFFSET, 0, out)
    expect(out.brake).toBeGreaterThan(0)
  })

  it('在站位上且共速時油門落在巡航附近，不是滿檔也不是關車', () => {
    // 【為什麼要測這一條】bang-bang 的油門會在目標速度附近來回，畫面上
    // 就是僚機一頓一頓。連續的油門才維持得住一個狀態。
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = onStation(lead)
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.throttle).toBeGreaterThan(THROTTLE_FLOOR)
    expect(out.throttle).toBeLessThan(WEP_THROTTLE)
    expect(out.brake).toBe(0)
  })

  it('永遠不開火 —— 開火紀律是獨立的一層', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = craft(new Vector3(500, 4000, 500), new Vector3(0, 0, -200))
    const out = createCommand()
    out.firing = true
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.firing).toBe(false)
  })

  it('參考機靜止時不產生 NaN', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, 0))
    const wing = craft(new Vector3(100, 4000, 100), new Vector3(0, 0, -200))
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(Number.isFinite(out.aimWorld.length())).toBe(true)
    expect(Number.isFinite(out.throttle)).toBe(true)
    expect(Number.isFinite(out.brake)).toBe(true)
  })

  it('與參考機完全重疊時不產生 NaN', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const out = createCommand()
    stationCommand(wing, lead, { along: 0, across: 0, up: 0 }, 0, out)
    expect(Number.isFinite(out.aimWorld.length())).toBe(true)
  })

  it('DEFAULT_STATION 的四個值都是正數', () => {
    expect(DEFAULT_STATION.blendRange).toBeGreaterThan(0)
    expect(DEFAULT_STATION.leadTime).toBeGreaterThan(0)
    expect(DEFAULT_STATION.speedGain).toBeGreaterThan(0)
    expect(DEFAULT_STATION.speedBand).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-station.test.ts`
Expected: FAIL，`stationCommand` 不存在

- [ ] **Step 3: 在 `src/ai/station.ts` 末尾追加**

檔頭的 import 補上：

```ts
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { Command } from '../control/Controller'
```

本體：

```ts
export interface StationConfig {
  /** 遠近混合的特徵長度，m。誤差小於它就開始轉為平行飛 */
  blendRange: number
  /** 前置補償的時間，s */
  leadTime: number
  /** 縱向位置誤差 → 速度指令的增益，1/s */
  speedGain: number
  /** 速度差多少算「差滿了」，m/s。油門與減速板都用它當標度 */
  speedBand: number
}

/**
 * **全部都是起始值，待 Task 13 由人工驗收與實測回填。**
 *
 * 【`blendRange` = 100 m】半個站位間距 ——「誤差小於半格就算在隊上」，
 * 該平行飛了。
 *
 * 【`leadTime` = 1.0 s】指揮儀把大角度瞄準誤差收斂的時間量級。
 *
 * 【`speedGain` = 0.2 s⁻¹】100 m 的縱向誤差命令 +20 m/s，約 5 秒補完；
 * 而 20 m/s 大約是巡航油門到 WEP 的速度餘裕。
 *
 * 【`speedBand` = 20 m/s】同上那個餘裕。速度差滿一個 band 就開到 WEP、
 * 反向滿一個 band 才開始踩減速板。
 */
export const DEFAULT_STATION: StationConfig = {
  blendRange: 100,
  leadTime: 1.0,
  speedGain: 0.2,
  speedBand: 20,
}

/**
 * 站位保持的基準油門。
 *
 * 【0.7 從哪來】`AiController` 的「沒有目標」分支與測試用的 Idle 控制器
 * 都用 0.7 當平飛油門。維持一致，站位控制器在誤差為 0 時給的就是同一個
 * 巡航狀態。
 */
const CRUISE_THROTTLE = 0.7

const C = makeScratch(4)

/**
 * 飛向站位。寫滿整個 `Command`（含 `firing = false`）。
 *
 * 【近距離不能瞄站位點】誤差趨近 0 時方向由浮點雜訊主導，瞄準向量會劇烈
 * 擺動而指揮儀會忠實地追上去。近距離改成瞄參考機的航跡方向（平行飛）。
 * 用**連續混合**而不是門檻，因為它不需要遲滯 —— 權重本身是連續的，不會
 * 在邊界上切換（與 `engageKnobs` 同一個理由）。
 *
 * 它同時解決視覺重疊：瞄著站位點飛會**直直朝長機收斂**，平行飛不會。
 * M6 沒有飛機互撞，所以那純粹是顯示問題 —— 但兩架機模穿模是看得見的。
 *
 * 【前置補償用相對速度，不是參考機的絕對速度】純追蹤一個移動點永遠落後；
 * 但若用絕對速度外推，共速且已在站位上時外推點仍在前方 `leadTime × 速度`
 * ≈ 200 m，混合權重永遠是 1，「近距離平行飛」那一段**永遠不會生效**。
 * 相對速度在共速時歸零，正是要的。
 *
 * 【油門是連續的，不是開關】站位保持是一個要**維持**的狀態而不是一次
 * 機動。bang-bang 會在目標速度附近來回，畫面上就是僚機一頓一頓。
 *
 * **呼叫端仍然要在之後套 `applySafety`** —— 站位控制器不是它的例外。
 *
 * 熱路徑：不配置。不修改 `self` 與 `reference`。
 */
export function stationCommand(
  self: Aircraft,
  reference: Aircraft,
  offset: StationOffset,
  seaHeight: number,
  out: Command,
  cfg: StationConfig = DEFAULT_STATION,
): void {
  const station = C.v[0]!
  stationPoint(reference, offset, seaHeight, station)

  const err = C.v[1]!.copy(station).sub(self.state.position)
  const dist = err.length()

  // 參考機的航跡方向。退化時用機首 —— 與 stationPoint 同一套階梯
  const track = C.v[2]!.copy(reference.state.velocity)
  const refSpeed = track.length()
  if (refSpeed > MIN_GROUND_SPEED) track.divideScalar(refSpeed)
  else track.copy(FWD).applyQuaternion(reference.state.orientation)

  // 追蹤方向 = 位置誤差 + 相對速度 × leadTime
  const aim = C.v[3]!.copy(err)
    .addScaledVector(reference.state.velocity, cfg.leadTime)
    .addScaledVector(self.state.velocity, -cfg.leadTime)
  const aimLen = aim.length()
  if (aimLen > 1e-6) aim.divideScalar(aimLen)
  else aim.copy(track)

  // 遠 → 追站位點；近 → 平行飛。連續混合，不需要遲滯
  const w = dist < cfg.blendRange ? dist / cfg.blendRange : 1
  aim.multiplyScalar(w).addScaledVector(track, 1 - w)
  const len = aim.length()
  if (len > 1e-6) out.aimWorld.copy(aim).divideScalar(len)
  else out.aimWorld.copy(track)

  // 目標速度 = 參考機速度 + 縱向誤差 × 增益
  const along = err.dot(track)
  const wanted = refSpeed + along * cfg.speedGain
  const deficit = wanted - self.state.velocity.length()

  let throttle = CRUISE_THROTTLE + (deficit / cfg.speedBand) * (WEP_THROTTLE - CRUISE_THROTTLE)
  if (throttle < THROTTLE_FLOOR) throttle = THROTTLE_FLOOR
  else if (throttle > WEP_THROTTLE) throttle = WEP_THROTTLE
  out.throttle = throttle

  // 【減速板要等油門先收到底】兩者同時作用會過度減速，然後又要加回來。
  // 超速滿一個 band 之後才開始踩，滿兩個 band 踩到底。
  out.brake = deficit < -cfg.speedBand
    ? Math.min(1, -deficit / cfg.speedBand - 1)
    : 0

  // 開火紀律是獨立的一層（fire.ts）。歸隊途中不開槍
  out.firing = false
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-station.test.ts`
Expected: PASS（21 條 —— Task 3 的 12 條加本任務的 9 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無輸出

- [ ] **Step 6: 提交**

```bash
git add src/ai/station.ts test/unit/ai-station.test.ts
git commit -m "feat: 站位控制器 -- 遠近連續混合（M6 spec 6.4）"
```

commit 訊息的內文（用編輯器或多個 `-m` 補上）：

```
兩個非顯而易見的設計點：

近距離不能瞄站位點。誤差趨近 0 時方向由浮點雜訊主導，瞄準向量會劇烈
擺動而指揮儀會忠實地追上去；改成瞄參考機的航跡方向（平行飛）。用連續
混合而不是門檻，因為它不需要遲滯。它同時解決視覺重疊 -- 瞄著站位點飛
會直直朝長機收斂。

前置補償用相對速度而不是參考機的絕對速度。用絕對速度的話，共速且已在
站位上時外推點仍在前方 200 m，混合權重永遠是 1，「近距離平行飛」那一段
永遠不會生效。相對速度在共速時歸零，正是要的。有一條測試專門守它。

油門連續而不是 bang-bang：站位保持是一個要維持的狀態，開關式的油門會在
目標速度附近來回，畫面上就是僚機一頓一頓。
```

---

## Task 5: `ai/wingman.ts` —— 四級目標優先序

**Files:**
- Create: `src/ai/wingman.ts`
- Test: `test/unit/ai-wingman.test.ts`

**Interfaces:**
- Consumes: `threatFactor`、`THREAT_RANGE`（Task 1 / `assess.ts`）、`latch`（`rules.ts`）、`TargetBoard`（`target.ts`）
- Produces:
  ```ts
  const LEVEL_NONE = 0, LEVEL_SELF_DEFENCE = 1, LEVEL_COVER = 2, LEVEL_FOCUS = 3
  interface WingmanConfig { breakEnter: number; breakExit: number; minDwell: number }
  const DEFAULT_WINGMAN: WingmanConfig
  interface WingmanState { engaging: boolean; current: number; level: number; dwell: number }
  function createWingmanState(): WingmanState
  function selectWingmanTarget(state: WingmanState, board: TargetBoard, selfIndex: number,
                               referenceIndex: number, stationError: number, dt: number,
                               cfg?: WingmanConfig): Aircraft | null
  ```

**背景**（spec §7）：四級優先序 —— 自衛 > 掩護參考機 > 跟參考機集火 > 無（歸隊）。三個容易寫錯的地方：

1. **自衛不受 `breakRange` 限制**（§7.1）。有人在打你，跟你離站位多遠無關。而且沒有這一級，`defend` 意圖在歸隊途中**結構上不可能觸發** —— `AiController` 的「沒有目標」分支會整個跳過態勢評估（§3.2）。
2. **集火要加距離門**（§7.1）。M5 的 AI 全知，開局 10 km 外長機就選好目標了；沒有這道門，僚機在 10 km 外就跟著撲出去，開局那 21 秒的編隊會融成一條線。門檻直接用 `THREAT_RANGE`，不新增參數。
3. **目標需要最小停留，但更緊急的一級可以插隊**（§7.4）。`threatFactor` 是瞬時量，沒有停留的話僚機每個節拍都在改主意 —— M5 量過，那種 AI 誰也殺不掉。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  DEFAULT_WINGMAN, LEVEL_COVER, LEVEL_FOCUS, LEVEL_SELF_DEFENCE,
  createWingmanState, selectWingmanTarget,
} from '../../src/ai/wingman'
import { createTargetBoard, type TargetBoard, type TargetCandidate } from '../../src/ai/target'
import { THREAT_RANGE } from '../../src/ai/assess'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'

const DT = 1 / 10

interface Scene { board: TargetBoard; craft: Aircraft[] }

/**
 * 6 架：0..2 藍（0 = 長機、1 = 僚機、2 = 另一架友機）、3..5 紅。
 * 全部平飛朝 −Z，彼此相隔 10 km —— 遠超 THREAT_RANGE，所以初始狀態下
 * 沒有任何人威脅任何人。呼叫端再把要用的那幾架搬過來。
 */
function scene(): Scene {
  const candidates: TargetCandidate[] = []
  const craft: Aircraft[] = []
  for (let i = 0; i < 6; i++) {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(i * 10000, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.identity()
    craft.push(a)
    candidates.push({ index: i, aircraft: a, team: i < 3 ? 'blue' : 'red', alive: true })
  }
  return { board: createTargetBoard(candidates), craft }
}

/** 把 hunter 擺到 prey 正後方 range m 並瞄著他。prey 朝 −Z，正後方是 +Z。 */
function tail(hunter: Aircraft, prey: Aircraft, range: number): void {
  hunter.state.position.copy(prey.state.position).add(new Vector3(0, 0, range))
  hunter.state.velocity.set(0, 0, -200)
  hunter.state.orientation.identity()
  hunter.prevOrientation.identity()
}

describe('四級優先序（M6 spec §7.1）', () => {
  it('第一級：有人咬我 → 打他', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)
    const st = createWingmanState()
    const t = selectWingmanTarget(st, s.board, 1, 0, 0, DT)
    expect(t).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
    expect(s.board.assignments[1]).toBe(3)
  })

  it('自衛優先於掩護 —— 一架咬我、一架咬長機時選咬我的', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)   // 咬僚機自己
    tail(s.craft[4]!, s.craft[0]!, 300)   // 咬長機
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
  })

  it('第二級：沒人咬我、有人咬長機 → 掩護', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
    expect(st.level).toBe(LEVEL_COVER)
  })

  it('同級取威脅值最大的（近的比遠的大）', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[0]!, 700)
    tail(s.craft[4]!, s.craft[0]!, 200)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
  })

  it('第三級：都沒有威脅時跟長機集火', () => {
    const s = scene()
    // 長機的現任目標是紅 5，離長機夠近，但沒瞄著任何人所以不構成威脅
    s.craft[5]!.state.position.copy(s.craft[0]!.state.position).add(new Vector3(400, 0, 0))
    s.board.assignments[0] = 5
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[5])
    expect(st.level).toBe(LEVEL_FOCUS)
  })

  it('第四級：什麼都沒有 → null，而且槽位歸 −1', () => {
    const s = scene()
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
    expect(s.board.assignments[1]).toBe(-1)
  })
})

describe('集火的距離門（M6 spec §7.1）—— 開局編隊的守門員', () => {
  it('長機的目標離長機超過 THREAT_RANGE 時不跟', () => {
    // 【拿掉這一道會怎樣】M5 的 AI 全知，開局 10 km 外長機就已經選定
    // 目標並朝它飛。僚機會跟著撲出去，而 breakRange 擋不住它 —— 目標
    // 大致就在航向上，僚機偏離站位大約 450 m，永遠碰不到 1,200 m 的
    // 放棄門檻。開局那 21 秒的編隊會一路融成一條線。
    const s = scene()
    s.craft[5]!.state.position.copy(s.craft[0]!.state.position)
      .add(new Vector3(THREAT_RANGE + 500, 0, 0))
    s.board.assignments[0] = 5
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
  })

  it('剛好在門檻之內就跟', () => {
    const s = scene()
    s.craft[5]!.state.position.copy(s.craft[0]!.state.position)
      .add(new Vector3(THREAT_RANGE - 50, 0, 0))
    s.board.assignments[0] = 5
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[5])
  })
})

describe('breakRange 遲滯（M6 spec §7.3）', () => {
  it('離站位太遠時放棄掩護，回到門檻內才重新交戰', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()

    // 在站位上 → 交戰
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
    expect(st.engaging).toBe(true)

    // 走到 1,000 m：低於離開門檻 1,200，仍然交戰
    selectWingmanTarget(st, s.board, 1, 0, 1000, DT)
    expect(st.engaging).toBe(true)

    // 超過 1,200 → 放棄
    selectWingmanTarget(st, s.board, 1, 0, 1300, DT)
    expect(st.engaging).toBe(false)

    // 回到 1,000：仍在遲滯帶裡，**不**重新交戰
    selectWingmanTarget(st, s.board, 1, 0, 1000, DT)
    expect(st.engaging).toBe(false)

    // 回到 700（低於進入門檻 800）→ 重新交戰
    selectWingmanTarget(st, s.board, 1, 0, 700, DT)
    expect(st.engaging).toBe(true)
  })

  it('自衛完全不受 breakRange 限制', () => {
    // 有人在打你，這件事跟你離站位多遠無關
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)
    const st = createWingmanState()
    const t = selectWingmanTarget(st, s.board, 1, 0, 5000, DT)
    expect(st.engaging).toBe(false)
    expect(t).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
  })
})

describe('最小停留（M6 spec §7.4）', () => {
  it('同一級之內，停留時間走完之前不換目標', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[0]!, 400)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])

    // 換一架更近的（威脅值更大）湊過來 —— 但停留還沒走完
    tail(s.craft[4]!, s.craft[0]!, 150)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])

    // 走滿停留時間之後才換
    const ticks = Math.ceil(DEFAULT_WINGMAN.minDwell / DT) + 1
    let last: unknown = null
    for (let i = 0; i < ticks; i++) last = selectWingmanTarget(st, s.board, 1, 0, 0, DT)
    expect(last).toBe(s.craft[4])
  })

  it('更緊急的一級可以立刻插隊 —— 掩護中被咬就馬上轉自衛', () => {
    // 【為什麼必須立刻】defend 意圖靠自衛級提供目標，而「有人在打我」
    // 不能等停留走完。與 rules.ts 讓 defend 豁免 minDwell 同一條原則。
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
    expect(st.level).toBe(LEVEL_COVER)

    tail(s.craft[3]!, s.craft[1]!, 300)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
  })

  it('現任目標退場時立刻重選，繞過停留', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])

    s.board.candidates[3]!.alive = false
    tail(s.craft[4]!, s.craft[0]!, 400)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
  })
})

describe('降級與退場', () => {
  it('參考機陣亡時只剩自衛級', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    s.board.candidates[0]!.alive = false
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()

    tail(s.craft[3]!, s.craft[1]!, 300)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])
  })

  it('referenceIndex 為 −1（沒有站位）時也只剩自衛級', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, -1, 0, DT)).toBeNull()
  })

  it('自己退場時回 null 並把自己的槽位歸 −1', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)
    const st = createWingmanState()
    selectWingmanTarget(st, s.board, 1, 0, 0, DT)
    expect(s.board.assignments[1]).toBe(3)

    s.board.candidates[1]!.alive = false
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
    expect(s.board.assignments[1]).toBe(-1)
  })

  it('不會選到友機', () => {
    const s = scene()
    // 把友機 2 擺到會構成「威脅」的位置 —— 同隊過濾必須擋掉它
    tail(s.craft[2]!, s.craft[1]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-wingman.test.ts`
Expected: FAIL，`src/ai/wingman.ts` 不存在

- [ ] **Step 3: 實作 `src/ai/wingman.ts`**

```ts
import { THREAT_RANGE, threatFactor } from './assess'
import { latch } from './rules'
import type { TargetBoard } from './target'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 目標的來源等級。**數字越小越緊急，可以插隊**（M6 spec §7.4）。
 *
 * 【為什麼是數字而不是字串聯集】它唯一的用途就是比大小 ——「更緊急的
 * 一級可以立刻換目標」。字串要另外配一張優先序表，等於把同一件事寫兩次。
 */
export const LEVEL_NONE = 0
export const LEVEL_SELF_DEFENCE = 1
export const LEVEL_COVER = 2
export const LEVEL_FOCUS = 3

export interface WingmanConfig {
  /** 離站位多近才**開始**交戰，m */
  breakEnter: number
  /** 離站位多遠就**放棄**交戰回站，m */
  breakExit: number
  /** 換過目標之後不再換的秒數 */
  minDwell: number
}

/**
 * **全部都是起始值，待 Task 13 由 20v20 實測回填。**
 *
 * 【`breakEnter` / `breakExit` = 800 / 1,200 m】800 m 約是站位橫向間距
 * （200 m）的四倍 —— 散到這個程度還讀得出是編隊。1,200 m 落在 M5 的
 * `extendRange`（1,500 m）之下，所以長機脫離時僚機跟得上，而不是各自
 * 脫離。**這是本里程碑最可能需要調的一個數字**：太小則僚機永遠打不到人，
 * 太大則編隊在混戰中永久散開、歸隊看不到。
 *
 * 【`minDwell` = 1.0 s】M5 的自由獵手用 2 s（「約 20 個決策節拍，長到一次
 * 目標變更撐得過一個機動」）。僚機反應的是長機身上的威脅、本來就該更快，
 * 取一半。
 */
export const DEFAULT_WINGMAN: WingmanConfig = {
  breakEnter: 800,
  breakExit: 1200,
  minDwell: 1.0,
}

/**
 * 一架僚機的目標選擇狀態。**這是兩個遲滯的記憶。**
 *
 * 【只能由 `selectWingmanTarget` 自己寫】M4 在遲滯上踩過一個坑：`latch`
 * 的 OR 結果被寫回它自己的記憶，遲滯因此被毒化，0.29°/s 的雜訊就能讓
 * 閂鎖永遠關不掉。教訓是遲滯的記憶不能有第二條寫入路徑。
 */
export interface WingmanState {
  /** 目前允許離開站位交戰。`breakRange` 閂鎖的記憶 */
  engaging: boolean
  /** 現任目標在 `board.candidates` 裡的索引；−1 = 無 */
  current: number
  /** 現任目標是由第幾級選出來的。插隊判斷用 */
  level: number
  /** 距離可以再換目標還有多久，s */
  dwell: number
}

export function createWingmanState(): WingmanState {
  // 【engaging 起始為 false】出生時就在站位上，第一次呼叫的 latch 會立刻
  // 把它翻成 true（0 < breakEnter）。起始值因此不重要，取保守的那一個。
  return { engaging: false, current: -1, level: LEVEL_NONE, dwell: 0 }
}

/**
 * 僚機的目標選擇。回傳它的 `Aircraft`；沒有值得打的敵機時回傳 null
 * —— 呼叫端據此飛回站位。
 *
 * 四級優先序（M6 spec §7.1）：
 *
 * | 級 | 條件 | 受 `breakRange` 限制？ |
 * |---|---|---|
 * | 1 | 正在威脅**我自己**的敵機 | **否** |
 * | 2 | 正在威脅**站位參考機**的敵機 | 是 |
 * | 3 | 參考機的現任目標，且它離參考機不到 `THREAT_RANGE` | 是 |
 * | 4 | 無 → 歸隊 | — |
 *
 * 【自衛為什麼不受限制】有人在打你，這件事跟你離站位多遠無關。而且沒有
 * 這一級，`defend` 意圖在歸隊途中**結構上不可能觸發** —— `AiController`
 * 的「沒有目標」分支會整個跳過態勢評估（M6 spec §3.2）。一條資料上的
 * 優先序，換掉一條控制流上的特例。
 *
 * 【第 3 級的距離門】M5 的 AI 全知，開局 10 km 外長機就選定目標了。沒有
 * 這道門，僚機會在 10 km 外跟著撲出去，而 `breakRange` 擋不住它（目標
 * 大致就在航向上，偏離站位只有幾百公尺），開局的編隊會融成一條線。
 * 語意是：**集火是加入長機正在進行的交戰，不是陪他走完一段接近航程。**
 *
 * @param stationError 自己離站位點多遠，m。沒有站位時傳 0
 * @param dt 距離上次呼叫的秒數。呼叫端是 10 Hz 的決策節拍
 *
 * 熱路徑之外（10 Hz），但仍然不配置。
 */
export function selectWingmanTarget(
  state: WingmanState,
  board: TargetBoard,
  selfIndex: number,
  referenceIndex: number,
  stationError: number,
  dt: number,
  cfg: WingmanConfig = DEFAULT_WINGMAN,
): Aircraft | null {
  const { candidates, assignments } = board
  const self = candidates[selfIndex]
  if (self === undefined || !self.alive) {
    state.current = -1
    state.level = LEVEL_NONE
    state.dwell = 0
    state.engaging = false
    if (selfIndex >= 0 && selfIndex < assignments.length) assignments[selfIndex] = -1
    return null
  }

  state.dwell = state.dwell > dt ? state.dwell - dt : 0
  // enter < exit：低於 enter 才開始交戰、高於 exit 才放棄
  state.engaging = latch(state.engaging, stationError, cfg.breakEnter, cfg.breakExit)

  const refCandidate = referenceIndex >= 0 && referenceIndex < candidates.length
    ? candidates[referenceIndex]
    : undefined
  const lead = refCandidate !== undefined && refCandidate.alive ? refCandidate : undefined

  let bestIndex = -1
  let bestScore = 0
  let bestLevel = LEVEL_NONE

  // ── 第一級：自衛 ──────────────────────────────────────
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive || c.team === self.team) continue
    const t = threatFactor(c.aircraft, self.aircraft)
    if (t > bestScore) {
      bestScore = t
      bestIndex = i
    }
  }
  if (bestIndex >= 0) bestLevel = LEVEL_SELF_DEFENCE

  // ── 第二級：掩護站位參考機 ────────────────────────────
  if (bestLevel === LEVEL_NONE && state.engaging && lead !== undefined) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!
      if (!c.alive || c.team === self.team) continue
      const t = threatFactor(c.aircraft, lead.aircraft)
      if (t > bestScore) {
        bestScore = t
        bestIndex = i
      }
    }
    if (bestIndex >= 0) bestLevel = LEVEL_COVER
  }

  // ── 第三級：跟參考機集火 ──────────────────────────────
  if (bestLevel === LEVEL_NONE && state.engaging && lead !== undefined) {
    const a = assignments[lead.index]!
    const c = a >= 0 && a < candidates.length ? candidates[a] : undefined
    if (
      c !== undefined && c.alive && c.team !== self.team
      && c.aircraft.state.position.distanceTo(lead.aircraft.state.position) < THREAT_RANGE
    ) {
      bestIndex = a
      bestLevel = LEVEL_FOCUS
    }
  }

  // ── 最小停留（M6 spec §7.4）───────────────────────────
  // 【有效性只看「還活著且仍是敵方」】不要把「仍然構成威脅」寫進去 ——
  // 那會讓目標一脫離威脅錐就立刻失效，停留時間等於沒有。
  const held = state.current >= 0 && state.current < candidates.length
    ? candidates[state.current]
    : undefined
  const heldValid = held !== undefined && held.alive && held.team !== self.team

  if (!heldValid) {
    // 現任失效 → 立刻重選，繞過停留
    commit(state, bestIndex, bestLevel, cfg)
  } else if (bestLevel !== LEVEL_NONE && bestLevel < state.level) {
    // 更緊急的一級插隊
    commit(state, bestIndex, bestLevel, cfg)
  } else if (state.dwell <= 0 && bestIndex !== state.current) {
    commit(state, bestIndex, bestLevel, cfg)
  }

  assignments[selfIndex] = state.current
  return state.current >= 0 ? candidates[state.current]!.aircraft : null
}

function commit(state: WingmanState, index: number, level: number, cfg: WingmanConfig): void {
  state.current = index
  state.level = level
  state.dwell = index >= 0 ? cfg.minDwell : 0
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-wingman.test.ts`
Expected: PASS（18 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無輸出

- [ ] **Step 6: 提交**

```bash
git add src/ai/wingman.ts test/unit/ai-wingman.test.ts
git commit -m "feat: 僚機的四級目標優先序（M6 spec 7）"
```

commit 訊息的內文：

```
自衛 > 掩護參考機 > 跟參考機集火 > 無（歸隊）。三個容易寫錯的地方，
每一個都有專屬的測試守著：

自衛不受 breakRange 限制。有人在打你跟你離站位多遠無關；而且沒有這一
級，defend 意圖在歸隊途中結構上不可能觸發 -- AiController 的「沒有
目標」分支會整個跳過態勢評估。一條資料上的優先序，換掉一條控制流上的
特例，rules.ts 因此一個字都不用改。

集火要加距離門。M5 的 AI 全知，開局 10 km 外長機就選定目標了；沒有這道
門，僚機會跟著撲出去而 breakRange 擋不住（目標大致就在航向上）。用既有
的 THREAT_RANGE，不新增參數。

目標需要最小停留，但更緊急的一級可以立刻插隊。threatFactor 是瞬時量，
沒有停留的話僚機每個節拍都在改主意 -- M5 量過 switchMargin = 0 的後果：
換目標 718 次而雙方 60 秒都掛零。
```

---

## Task 6: `AiController` —— 角色分派與歸隊分支

**Files:**
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-controller.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `stationPoint`、`stationCommand`、`STATION_OFFSETS`、`DEFAULT_STATION`、`StationConfig`、`StationOffset`（Task 3/4）、`createWingmanState`、`selectWingmanTarget`、`DEFAULT_WINGMAN`、`WingmanConfig`（Task 5）
- Produces（給 Task 8 接線、Task 9 觀測用）：
  ```ts
  class AiController {
    stationReference: Aircraft | null      // null = 沒有站位，行為與 M5 相同
    stationReferenceIndex: number          // −1 = 無
    stationOffset: StationOffset
    stationConfig: StationConfig
    wingmanConfig: WingmanConfig
    readonly stationError: number          // 上一個決策節拍算出的站位誤差，m
  }
  ```

**背景**（spec §3.2）：`update` 目前的形狀是「沒有目標 → 平飛；有目標 → 態勢評估 → 意圖仲裁 → 轉向 → 開火 → 安全層」。隊形保持天然落在**第一條分支**裡 —— `engage` / `merge` / `approach` 都要求有目標，所以「沒有目標」那一格本來就是它的位置。**`rules.ts` 因此一個字都不用改。**

**相容性保證**：三個新欄位的預設值（`null` / `-1` / `STATION_OFFSETS[0]`）讓沒接線的 `AiController` 行為與 M5 **完全相同**。M4 的全部測試、`bench/ai-load.ts`、`test/integration/ai-duel-matrix.test.ts` 都不必改。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-controller.test.ts` 追加。檔頭 import 併進既有區塊：

```ts
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
```

```ts
describe('站位角色（M6 spec §3.2）', () => {
  /** 造一架擺在指定位置、平飛朝 −Z 的 P-51D。 */
  function craft(x: number, y: number, z: number): Aircraft {
    const a = new Aircraft(P51D, y, 200)
    a.state.position.set(x, y, z)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.identity()
    return a
  }

  it('沒有 stationReference 時完全是 M5 的行為 —— 沒有目標就維持機首平飛', () => {
    const ai = new AiController()
    const self = craft(0, 4000, 0)
    const out = createCommand()
    ai.update(self, 1 / 240, out)
    const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
    expect(out.aimWorld.dot(nose)).toBeCloseTo(1, 6)
    expect(out.throttle).toBeCloseTo(0.7, 6)
    expect(ai.stationError).toBe(0)
  })

  it('有 stationReference 且沒有目標時，飛向站位', () => {
    const lead = craft(0, 4000, 0)
    // 自己擺在長機正上方，站位在長機右後方 —— 瞄準方向必須偏向 +X 且向下
    const self = craft(0, 4000, 0)
    const ai = new AiController()
    ai.stationReference = lead
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(self, 1 / 240, out)
    expect(out.aimWorld.x).toBeGreaterThan(0.8)
    expect(out.firing).toBe(false)
  })

  it('站位誤差在決策節拍更新', () => {
    const lead = craft(0, 4000, 0)
    const self = craft(0, 4000, 0)
    const ai = new AiController()
    ai.stationReference = lead
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(self, 1 / 240, out)

    const station = new Vector3()
    stationPoint(lead, STATION_OFFSETS[1]!, 0, station)
    expect(ai.stationError).toBeCloseTo(station.distanceTo(self.state.position), 6)
  })

  it('安全層仍然覆寫站位指令 —— 站位控制器不是它的例外', () => {
    // 【為什麼一定要測】站位控制器是新的一條寫滿整個 Command 的路徑。
    // 忘了在它後面套 applySafety 的話，歸隊中的僚機會直直飛進海裡，而
    // 那個症狀（幾架飛機無聲消失）離成因很遠。
    const lead = craft(0, 30, 0)
    const self = craft(0, 30, 0)
    self.state.velocity.set(0, -150, -120)
    const ai = new AiController()
    ai.stationReference = lead
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(self, 1 / 240, out)
    expect(ai.safetyActive).toBe(true)
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  it('有 stationReference 時走僚機的目標選擇，不是 selectTarget', () => {
    // 僚機準則下，10 km 外的敵機不會被選中（三級都被 THREAT_RANGE 界住）；
    // 自由獵手的 selectTarget 則會選它。用這個差異分辨走了哪一條路。
    const lead = craft(0, 4000, 0)
    const wing = craft(200, 4000, 60)
    const enemy = craft(0, 4000, -10000)
    const board = createTargetBoard([
      { index: 0, aircraft: lead, team: 'blue', alive: true },
      { index: 1, aircraft: wing, team: 'blue', alive: true },
      { index: 2, aircraft: enemy, team: 'red', alive: true },
    ])
    board.assignments[0] = 2      // 長機已經鎖定 10 km 外的敵機

    const ai = new AiController()
    ai.board = board
    ai.selfIndex = 1
    ai.stationReference = lead
    ai.stationReferenceIndex = 0
    ai.stationOffset = STATION_OFFSETS[1]!
    const out = createCommand()
    ai.update(wing, 1 / 240, out)
    expect(ai.target).toBeNull()
    expect(board.assignments[1]).toBe(-1)
  })
})
```

檔頭若尚未 import，補上 `createTargetBoard`（來自 `../../src/ai/target`）、`Vector3`、`createCommand`、`Aircraft`、`P51D`。

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-controller.test.ts`
Expected: FAIL，`stationReference` 等欄位不存在

- [ ] **Step 3: 改 `src/ai/AiController.ts`**

新增 import：

```ts
import {
  DEFAULT_STATION, STATION_OFFSETS, stationCommand, stationPoint,
  type StationConfig, type StationOffset,
} from './station'
import {
  DEFAULT_WINGMAN, createWingmanState, selectWingmanTarget, type WingmanConfig,
} from './wingman'
```

新增欄位（放在 `targetConfig` 之後）：

```ts
  /**
   * 站位參考機，同時也是**掩護對象**（M6 spec §5.1）。
   *
   * 【null 時完全是 M5 的行為】自由選目標、沒有目標就平飛。Schwarm 長機、
   * 落單者、以及還沒接線的實例都走這一條，所以 M4 的全部測試與
   * `bench/ai-load.ts` 一個字都不用改。
   */
  stationReference: Aircraft | null = null
  /** 站位參考機在 `board.candidates` 裡的索引；−1 = 無 */
  stationReferenceIndex = -1
  /** 這一架的站位偏置。`stationReference` 為 null 時不使用 */
  stationOffset: StationOffset = STATION_OFFSETS[0]!
  stationConfig: StationConfig = DEFAULT_STATION
  wingmanConfig: WingmanConfig = DEFAULT_WINGMAN
  /**
   * 上一個決策節拍算出的站位誤差，m。供 HUD、telemetry 與測試讀取。
   *
   * 【為什麼是 10 Hz 而不是每步】只有僚機的目標選擇讀它，而那本來就是
   * 決策節拍。整合測試的抽樣頻率遠低於 10 Hz，讀得到的精度綽綽有餘。
   */
  stationError = 0

  private readonly wingmanState = createWingmanState()
  private readonly station = new Vector3()
```

改 `update` 的前半段：

```ts
  update(self: Aircraft, dt: number, out: Command): void {
    const period = 1 / AI_DECISION_HZ
    const reference = this.stationReference

    // 【節拍先算，分支後用】決策這一步要不要跑，必須在「有沒有目標」之前
    // 決定 —— 否則沒有目標時計時器不會前進，board 一設上去就會變成每個
    // 物理步都在選目標。
    this.decisionTimer -= dt
    const decide = this.decisionTimer <= 0
    if (decide) {
      this.decisionTimer += period
      this.decisionsMade++
      if (reference) {
        stationPoint(reference, this.stationOffset, this.seaHeight, this.station)
        this.stationError = this.station.distanceTo(self.state.position)
      } else {
        this.stationError = 0
      }
      if (this.board) {
        // 【角色分派】有站位參考機 = 僚機，走四級準則；否則是自由獵手
        this.target = reference
          ? selectWingmanTarget(
            this.wingmanState, this.board, this.selfIndex,
            this.stationReferenceIndex, this.stationError, period, this.wingmanConfig,
          )
          : selectTarget(
            this.targetState, this.board, this.selfIndex, period, this.targetConfig,
          )
      }
    }

    const target = this.target
    if (!target) {
      if (reference) {
        // 【隊形保持就在這一格】沒有值得打的敵人時飛回站位。
        //
        // 它**不進** `arbitrate` 的優先序：engage / merge / approach 全都
        // 要求有目標，所以「沒有目標」這一格本來就是它的位置。代價是這條
        // 分支跳過整條態勢評估，`defend` 因此結構上不可能觸發 —— 補法是
        // 僚機目標優先序最上面的那一級「自衛」，而不是在 rules.ts 開特例
        // （M6 spec §3.2）。
        stationCommand(
          self, reference, this.stationOffset, this.seaHeight, out, this.stationConfig,
        )
      } else {
        // 沒有目標也沒有站位時維持機首方向平飛。這比「保持上一格的指令」
        // 安全——上一格可能是一個俯衝中的脫離向量。
        out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        out.throttle = 0.7
        out.brake = 0
        out.firing = false
      }
      this.safetyActive = applySafety(self, this.seaHeight, out)
      return
    }

    // ── 以下完全不動 ──
```

`update` 的其餘部分（態勢評估、意圖仲裁、轉向、開火、安全層）**一個字都不要改**。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-controller.test.ts test/unit/battle-setup.test.ts test/integration/ai-duel-matrix.test.ts test/integration/ai-safety-matrix.test.ts`
Expected: PASS。**兩個矩陣測試是相容性保證的證據** —— 它們用的是沒接線的 `AiController`，行為必須逐位元不變。

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無輸出

- [ ] **Step 6: 提交**

```bash
git add src/ai/AiController.ts test/unit/ai-controller.test.ts
git commit -m "feat: AiController 依角色分派目標選擇與歸隊（M6 spec 3.2）"
```

commit 訊息的內文：

```
隊形保持天然落在「沒有目標」那一條分支裡 -- engage / merge / approach
全都要求有目標，所以那一格本來就是它的位置。rules.ts 的意圖仲裁因此
一個字都不用改。

代價是那條分支跳過整條態勢評估，defend 結構上不可能觸發。補法是僚機
目標優先序最上面的「自衛」級（Task 5），而不是在 rules.ts 開特例。

三個新欄位的預設值讓沒接線的 AiController 行為與 M5 完全相同：對戰矩陣
與安全矩陣都是逐位元不變的證據。
```

---

## Task 7: `battle/setup.ts` —— Schwarm 生成幾何

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/unit/battle-setup.test.ts`

**Interfaces:**
- Consumes: `SCHWARM_SIZE`、`STATION_REFERENCE`（Task 2）、`STATION_OFFSETS`、`stationPoint`（Task 3）
- Produces: `BattleConfig` 的欄位變動 ——「移除 `lateralSpacing`、新增 `schwarmSpacing`」，`entryRange` 3,000 → 10,000，`lateralOffset` 300 → 1,500

**背景**（spec §8）：M5 的開局是一排 20 架、間距 120 m。M6 改成 5 個 Schwarm 並排，**分隊內部直接由 `stationPoint` 生成 —— 出生位置就是站位**。兩份長得很像的幾何就是只有一份會被修好的那種危險。

三個數字的推導：

| 參數 | 值 | 推導 |
|---|---|---|
| `entryRange` | 10,000 m | M5 實測「開局到第一次扣扳機」：3,000 m → 3.7 s、6,000 m → 11.4 s。第一次扣扳機約在 1,500 m，接近率 400 m/s，`(10000 − 1500) / 400 ≈ 21 s` 的編隊巡航 |
| `lateralOffset` | 1,500 m | 站位的 `across` 在紅隊會鏡射（`stationPoint` 讀速度方向，紅隊朝 +Z），所以藍第 k 位在 `X_藍 + a_k`、紅第 k 位在 `X_紅 − a_k`，橫向差 `−offset + 2a_k`。以 `a = {0, +200, −250, −450}` 代入，最接近 0 的是 `−offset + 400` —— **最小的一對只隔 `offset − 400`**。要它仍滿足兩倍射擊錐：`offset − 400 ≥ 2 × 10000 × tan(3°) = 1,048` → `offset ≥ 1,448`，取 1,500 |
| `schwarmSpacing` | 800 m | 每隊總寬 `4 × 800 + 650 = 3,850 m`，加上 ±750 的錯開，最外側落在 ±2,675 m。在 10 km 下偏軸 15° —— 仍然大致對頭 |

**這一項不放大的話，M5 那個「藍隊每 9 秒被零損失全滅、60 秒七次」會原封不動回來。**

- [ ] **Step 1: 先驗證舊值真的會紅**

在動任何程式之前，先確認回歸守門員有效。暫時把 `DEFAULT_BATTLE.lateralOffset` 改成 `300`（M5 的值）並把 `entryRange` 改成 `10000`，跑：

Run: `npx vitest run test/integration/multi-battle.test.ts -t "沒有一方被全滅"`
Expected: **FAIL**（`wipes` > 0）

看到紅燈之後把兩個值都改回去。**沒被驗證會失敗的回歸測試不算回歸測試** —— M5 在這裡踩過坑，三個門檻是在退化區間量的，修好之後全部失效。

- [ ] **Step 2: 改測試（`test/unit/battle-setup.test.ts`）**

檔頭 import 補上：

```ts
import { SCHWARM_SIZE, STATION_REFERENCE } from '../../src/battle/flights'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
```

**刪掉**這一條（`lateralSpacing` 已經不存在）：

```ts
  it('同隊相鄰兩架的橫向間距等於 lateralSpacing', () => { /* ... */ })
```

**改寫**這一條（原本比的是兩隊重心，而重心會被站位偏置拉走 125 m；`lateralOffset` 真正控制的是分隊原點）：

```ts
  it('兩隊橫向錯開 lateralOffset，且對稱於原點', () => {
    // 【為什麼比長機而不是比重心】站位偏置的累積橫向量平均是 −125 m，
    // 會把重心拉走 —— 但那對兩隊是對稱的，所以「以原點為中心」仍然成立
    // （相機與小地圖吃的是這一條）。lateralOffset 控制的是分隊原點。
    const bx = b.blue[0]!.aircraft.state.position.x
    const rx = b.red[0]!.aircraft.state.position.x
    expect(rx - bx).toBeCloseTo(DEFAULT_BATTLE.lateralOffset, 3)
    expect(centre(b.blue).x + centre(b.red).x).toBeCloseTo(0, 6)
  })
```

**改寫**射擊錐那一條（改成直接量真實位置，而不是比設定值）：

```ts
  it('最接近的一對藍紅橫向隔開兩倍射擊錐——不然開局就是一場對頭槍戰', () => {
    // 【這一條抓過一次全滅】M5 的 lateralOffset 為 0 時，藍 slot k 與紅
    // slot k 在 Z 軸上完全共線，20 場精準對頭槍戰讓藍隊每 9 秒被零損失
    // 全滅一次。
    //
    // 【M6 為什麼要量真實位置而不是比設定值】站位的 across 在紅隊會鏡射
    // （stationPoint 讀的是速度方向），所以同編號的兩架不是差一個
    // lateralOffset，而是差 `offset − 2·a_k`。直接量位置就不必把那條
    // 代數複製到測試裡。
    const cone = DEFAULT_BATTLE.entryRange * Math.tan(DEFAULT_FIRE.trackingCone)
    for (let i = 0; i < b.blue.length; i++) {
      const dx = Math.abs(
        b.blue[i]!.aircraft.state.position.x - b.red[i]!.aircraft.state.position.x,
      )
      expect(dx).toBeGreaterThan(2 * cone)
    }
  })
```

**改寫**高度散布那一條（站位的 `up` 會疊在分隊高度之上）：

```ts
  it('高度散布在 ±altitudeSpread 之內，而且真的有散開', () => {
    // 【M6 起要加上站位的 up】分隊之間用鋸齒散開，分隊之內由站位偏置
    // 給高度差 —— 兩者相加才是一架飛機的實際高度。
    const maxUp = Math.max(...STATION_OFFSETS.map((o) => o.up))
    const ys = b.world.combatants.map((c) => c.aircraft.state.position.y)
    for (const y of ys) {
      expect(Math.abs(y - DEFAULT_BATTLE.altitude)).toBeLessThanOrEqual(
        DEFAULT_BATTLE.altitudeSpread + maxUp + 1e-6,
      )
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(DEFAULT_BATTLE.altitudeSpread)
  })
```

**新增**一個 describe：

```ts
describe('Schwarm 的出生佈局（M6 spec §8.3）', () => {
  const b = createBattle(new Idle())

  it('每隊切成 perSide / SCHWARM_SIZE 個分隊', () => {
    expect(b.blue.length % SCHWARM_SIZE).toBe(0)
    expect(b.blue.length / SCHWARM_SIZE).toBe(5)
  })

  it('出生位置就是站位 —— 不是另一份長得很像的幾何', () => {
    // 【這是本任務最重要的一條】生成與站位若各寫一份，兩者遲早會漂開，
    // 而症狀是「開局全隊先橫移一次才成隊」。生成直接呼叫 stationPoint，
    // 這一條就是它的證明。
    const p = new Vector3()
    for (const team of [b.blue, b.red]) {
      for (let base = 0; base < team.length; base += SCHWARM_SIZE) {
        for (let k = 1; k < SCHWARM_SIZE && base + k < team.length; k++) {
          const ref = team[base + STATION_REFERENCE[k]!]!
          stationPoint(ref.aircraft, STATION_OFFSETS[k]!, 0, p)
          expect(team[base + k]!.aircraft.state.position.distanceTo(p)).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('紅隊的僚機在世界座標的另一側 —— 站位是相對機首定義的', () => {
    // 不鏡射的話紅隊的出生位置就不等於它自己的站位，一開局全隊會先橫移一次
    const dxBlue = b.blue[1]!.aircraft.state.position.x - b.blue[0]!.aircraft.state.position.x
    const dxRed = b.red[1]!.aircraft.state.position.x - b.red[0]!.aircraft.state.position.x
    expect(dxBlue).toBeCloseTo(STATION_OFFSETS[1]!.across, 3)
    expect(dxRed).toBeCloseTo(-STATION_OFFSETS[1]!.across, 3)
  })

  it('相鄰兩個分隊的長機相距 schwarmSpacing', () => {
    for (let f = 1; f * SCHWARM_SIZE < b.blue.length; f++) {
      const dx = b.blue[f * SCHWARM_SIZE]!.aircraft.state.position.x
        - b.blue[(f - 1) * SCHWARM_SIZE]!.aircraft.state.position.x
      expect(dx).toBeCloseTo(DEFAULT_BATTLE.schwarmSpacing, 3)
    }
  })

  it('玩家是自己分隊的長機', () => {
    expect(b.blue.indexOf(b.player) % SCHWARM_SIZE).toBe(0)
  })

  it('開局有足夠的編隊巡航時間 —— entryRange 撐得起 15 秒以上', () => {
    // 第一次扣扳機約在 1,500 m，對頭接近率是兩機速度相加
    const closure = DEFAULT_BATTLE.tas * 2
    const cruise = (DEFAULT_BATTLE.entryRange - 1500) / closure
    expect(cruise).toBeGreaterThan(15)
  })
})
```

- [ ] **Step 3: 跑測試確認它失敗**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL（`schwarmSpacing` 不存在、佈局不是 Schwarm）

- [ ] **Step 4: 改 `src/battle/setup.ts`**

新增 import：

```ts
import { SCHWARM_SIZE, STATION_REFERENCE } from './flights'
import { STATION_OFFSETS, stationPoint } from '../ai/station'
```

`BattleConfig`：把 `lateralSpacing` 換成 `schwarmSpacing`，並改寫 `lateralOffset` 的註解：

```ts
  /**
   * 相鄰兩個 Schwarm 的長機橫向間距，m。
   *
   * 【取代 M5 的 `lateralSpacing`】分隊**內部**的間距現在由站位偏置給
   * （`STATION_OFFSETS`），這裡只管分隊**之間**。
   *
   * 【800 m 怎麼來】每隊總寬 `4 × 800 + 650 = 3,850 m`（650 是分隊內部
   * 的橫向跨度），加上 ±750 的兩隊錯開，最外側的一架落在 ±2,675 m。在
   * 10 km 的對頭距離下偏軸 `atan(2675/10000) = 15°` —— 仍然大致對頭，
   * 不會變成側翼包抄。上界與 M5 同一條：總寬不能大到讓外側分隊看不到敵人。
   */
  schwarmSpacing: number
```

```ts
  /**
   * 兩隊**分隊原點**的橫向錯開量，m。藍隊 −offset/2、紅隊 +offset/2。
   *
   * 【為什麼一定要有】M5 實測：0 的時候藍隊每 9 秒被零損失全滅一次，
   * 60 秒內七次，有效命中率藍 34% 對紅 97%。成因是 P-51 的六挺翼槍匯聚點
   * 在 300 m，而那種仗打在 660–1,000 m。
   *
   * 【M6 的推導多一項】站位的 `across` 對紅隊會鏡射（`stationPoint` 讀的
   * 是速度方向，而紅隊朝 +Z），所以藍隊第 k 位在 `X_藍 + a_k`、紅隊第 k 位
   * 在 `X_紅 − a_k`，兩者橫向差是 `−offset + 2·a_k`。以累積橫向量
   * `a = {0, +200, −250, −450}` 代入得 `−offset, −offset+400, −offset−500,
   * −offset−900` —— 最接近 0 的是第二個，也就是**最小的一對只隔
   * `offset − 400`**。
   *
   * 要它仍然滿足兩倍射擊錐（`entryRange × tan(3°) = 524 m`）：
   *
   *     offset − 400 ≥ 2 × 524  →  offset ≥ 1,448  →  取 1,500
   */
  lateralOffset: number
```

`entryRange` 的註解改寫：

```ts
  /**
   * 兩隊重心的初始距離，m。
   *
   * 【M6 由 3,000 拉到 10,000】M5 實測開局到第一次有人扣扳機／中彈：
   *
   * ```
   *   1,500 m → 0.6 s / 1.7 s      4,000 m →  6.3 s /  7.5 s
   *   2,000 m → 1.2 s / 2.4 s      6,000 m → 11.4 s / 13.1 s
   *   3,000 m → 3.7 s / 5.0 s
   * ```
   *
   * 3,000 m 只給 3.7 秒 —— 隊形保持在那個開局下等於隱形功能。第一次扣
   * 扳機約在 1,500 m、對頭接近率 400 m/s，10,000 m 給
   * `(10000 − 1500) / 400 ≈ 21 秒`的編隊巡航。
   *
   * **代價**：每次重置玩家都要等這 21 秒。人工驗收要看它是「壯觀」還是
   * 「無聊」（M6 spec §4.2 條件 19）。
   */
  entryRange: number
```

`DEFAULT_BATTLE`：

```ts
export const DEFAULT_BATTLE: BattleConfig = {
  perSide: 20,
  altitude: 4000,
  tas: 200,
  entryRange: 10000,
  schwarmSpacing: 800,
  lateralOffset: 1500,
  altitudeSpread: 300,
  resetCountdown: 3,
}
```

`altitudeOffset` 的註解補一句（單位由「架」變成「隊」）：

```ts
/**
 * 高度散布：把**分隊**序號映到 [−1, 1] 的鋸齒。
 *
 * 【M6 起單位是分隊而不是單架】分隊**內部**的高度差由站位偏置給
 * （`STATION_OFFSETS` 的 `up`）。兩者都作用在單架上的話，會互相打架 ——
 * 生成把它推上去、站位控制器又把它拉回來。
 *
 * 【為什麼不是亂數】M5 spec §3.1 條件 7 要求決定性。
 *
 * 【週期取 5】剛好是每隊的分隊數，五個分隊落在五個不同的高度層。
 */
function altitudeOffset(flight: number, spread: number): number {
  const cycle = flight % 5
  return ((cycle / 4) * 2 - 1) * spread
}
```

生成迴圈：

```ts
/** 生成用的暫存。`createBattle` 不是熱路徑，但沒有理由每架配一個 */
const SPAWN = new Vector3()

export function createBattle(
  playerController: Controller, cfg: BattleConfig = DEFAULT_BATTLE,
): Battle {
  const world = new World()
  const blue: Combatant[] = []
  const red: Combatant[] = []
  const flightCount = Math.ceil(cfg.perSide / SCHWARM_SIZE)
  /**
   * 玩家是**正中央分隊的長機**（M6 spec §9）。
   *
   * 【為什麼是長機而不是某個僚機】玩家不會照站位飛。把他擺在有站位的
   * 位置上，那個 Schwarm 從此有一個永遠對不齊的槽位。
   */
  const playerSlot = Math.floor(flightCount / 2) * SCHWARM_SIZE
  let player: Combatant | null = null

  // 藍隊在 +Z、機首朝 −Z；紅隊在 −Z、機首朝 +Z（繞 Y 轉 π）
  for (const side of ['blue', 'red'] as const) {
    const blueSide = side === 'blue'
    const z = blueSide ? cfg.entryRange / 2 : -cfg.entryRange / 2
    const yaw = blueSide ? 0 : Math.PI
    const orientation = new Quaternion().setFromAxisAngle(UP, yaw)
    const velocity = FWD.clone().applyQuaternion(orientation).multiplyScalar(cfg.tas)

    // 對稱錯開，戰場才會維持以原點為中心（相機與小地圖都吃這個）
    const lateral = (blueSide ? -1 : 1) * cfg.lateralOffset / 2

    let slot = 0
    for (let f = 0; f < flightCount; f++) {
      const leadX = (f - (flightCount - 1) / 2) * cfg.schwarmSpacing + lateral
      const leadY = cfg.altitude + altitudeOffset(f, cfg.altitudeSpread)
      /** 這個分隊已經造好的飛機，供 stationPoint 當參考機 */
      const made: Aircraft[] = []

      for (let k = 0; k < SCHWARM_SIZE && slot < cfg.perSide; k++, slot++) {
        // 【分隊內部直接由 stationPoint 生成】出生位置就是站位。兩份長得
        // 很像的幾何就是只有一份會被修好的那種危險 —— 與 `resetBattle`
        // 走 `World.respawn` 是同一個理由。
        //
        // 鏡射是自動的：`stationPoint` 由**參考機的速度方向**建座標框，
        // 而紅隊朝 +Z，所以 `across = +200` 在世界座標是 −X。
        const ref = STATION_REFERENCE[k]!
        if (ref < 0) SPAWN.set(leadX, leadY, z)
        else stationPoint(made[ref]!, STATION_OFFSETS[k]!, 0, SPAWN)

        const spec = blueSide ? P51D : BF109G6
        const aircraft = new Aircraft(spec, SPAWN.y, cfg.tas)
        aircraft.state.position.copy(SPAWN)
        aircraft.state.orientation.copy(orientation)
        aircraft.state.velocity.copy(velocity)
        aircraft.prevPosition.copy(aircraft.state.position)
        aircraft.prevOrientation.copy(orientation)
        made.push(aircraft)

        const isPlayer = blueSide && slot === playerSlot
        const controller = isPlayer ? playerController : new AiController()
        const c = world.add(
          aircraft, controller, side, aircraft.state.position.clone(), SPAWN.y, cfg.tas,
        )
        // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
        c.respawnOnDestroy = false
        if (isPlayer) player = c
        ;(blueSide ? blue : red).push(c)
      }
    }
  }

  if (player === null) throw new Error('玩家沒有被建立——perSide 必須 >= 1')

  // ── 以下（指派板、AI 接線、return）在 Task 8 再改 ──
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: PASS

- [ ] **Step 6: 跑整套與型別檢查**

Run: `npm run build && npx vitest run`
Expected: 全綠。**若 `multi-battle.test.ts` 的門檻紅了，先不要動門檻** —— Task 9 會重新推導。這一步只確認沒有東西壞掉；門檻類的失敗記下來帶到 Task 9。

- [ ] **Step 7: 提交**

```bash
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat: Schwarm 的出生佈局與拉長的開局（M6 spec 8）"
```

commit 訊息的內文：

```
5 個 Schwarm 並排取代 M5 的一排 20 架。分隊內部直接呼叫 stationPoint
生成 -- 出生位置就是站位，不是另一份長得很像的幾何。有一條測試專門
證明這件事。

entryRange 3,000 -> 10,000 m。M5 實測 3,000 m 到第一次扣扳機只有 3.7 秒，
隊形保持在那個開局下等於隱形功能。10 km 給約 21 秒的編隊巡航；代價是
每次重置都要等這 21 秒，列入人工驗收。

lateralOffset 300 -> 1,500 m，而且推導比 M5 多一項：站位的 across 對
紅隊會鏡射（stationPoint 讀的是速度方向），所以同編號的兩架差的是
offset − 2·a_k，最小的一對只隔 offset − 400。要它仍滿足兩倍射擊錐就得
offset >= 1,448。

動手之前先把 lateralOffset 設回 300 驗證 wipes 守門員會紅 -- 沒被驗證
會失敗的回歸測試不算回歸測試。
```

---

## Task 8: `battle/setup.ts` —— 編制接線與每步壓縮

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/unit/battle-setup.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `createFlights`、`compactFlights`、`stationReferenceOf`、`FlightIndex`（Task 2）、`AiController` 的站位欄位（Task 6）
- Produces: `Battle.flights: FlightIndex`；`playerFlight(b)`、`playerWingman(b)` 供 Task 11/12 的 HUD 使用

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/battle-setup.test.ts` 追加。檔頭 import 補上 `playerFlight`、`playerWingman`（來自 `../../src/battle/setup`）與 `stationReferenceOf`（來自 `../../src/battle/flights`）。

```ts
describe('編制接線（M6 spec §5）', () => {
  /** 取出第 i 架的 AiController；不是 AI 就丟例外（測試裡這代表寫錯了）。 */
  function ai(b: ReturnType<typeof createBattle>, index: number): AiController {
    const c = b.world.combatants[index]!.controller
    if (!(c instanceof AiController)) throw new Error(`第 ${index} 架不是 AI`)
    return c
  }

  it('分隊長機沒有站位，其餘三架有', () => {
    const b = createBattle(new Idle())
    expect(stationReferenceOf(b.flights, 0)).toBe(-1)
    expect(stationReferenceOf(b.flights, 1)).toBe(0)
    expect(stationReferenceOf(b.flights, 2)).toBe(0)
    expect(stationReferenceOf(b.flights, 3)).toBe(2)
    expect(ai(b, 0).stationReference).toBeNull()
    expect(ai(b, 1).stationReference).toBe(b.world.combatants[0]!.aircraft)
    expect(ai(b, 3).stationReference).toBe(b.world.combatants[2]!.aircraft)
  })

  it('玩家沒有站位 —— 他是自己分隊的長機', () => {
    const b = createBattle(new Idle())
    expect(stationReferenceOf(b.flights, b.player.index)).toBe(-1)
  })

  it('members[1] 陣亡後，下一步 members[2] 就遞補成新的僚機', () => {
    // 【這是玩家看得到的行為】你的僚機被打掉，同分隊另一個 Rotte 有人
    // 滑過來補位。
    const b = createBattle(new Idle())
    const before = ai(b, 2).stationOffset
    b.world.destroy(b.world.combatants[1]!)
    stepBattle(b, DT)
    expect(ai(b, 2).stationOffset).toBe(STATION_OFFSETS[1]!)
    expect(ai(b, 2).stationOffset).not.toBe(before)
    expect(ai(b, 3).stationReference).toBe(b.world.combatants[0]!.aircraft)
  })

  it('長機陣亡後，僚機升為長機並失去站位', () => {
    const b = createBattle(new Idle())
    b.world.destroy(b.world.combatants[0]!)
    stepBattle(b, DT)
    expect(ai(b, 1).stationReference).toBeNull()
    expect(ai(b, 1).stationReferenceIndex).toBe(-1)
  })

  it('分隊只剩一架時它沒有站位 —— 退化成 M5 的獨行俠', () => {
    const b = createBattle(new Idle())
    b.world.destroy(b.world.combatants[0]!)
    b.world.destroy(b.world.combatants[1]!)
    b.world.destroy(b.world.combatants[3]!)
    stepBattle(b, DT)
    expect(ai(b, 2).stationReference).toBeNull()
  })

  it('玩家重生後回到自己分隊的長機位', () => {
    const b = createBattle(new Idle())
    b.player.alive = false
    stepBattle(b, DT)
    b.player.alive = true
    stepBattle(b, DT)
    expect(b.flights.positionOf[b.player.index]).toBe(0)
    expect(stationReferenceOf(b.flights, b.player.index)).toBe(-1)
  })

  it('重置之後編制回到滿編', () => {
    const b = createBattle(new Idle())
    b.world.destroy(b.world.combatants[1]!)
    stepBattle(b, DT)
    resetBattle(b)
    expect(b.flights.flights[0]!.count).toBe(SCHWARM_SIZE)
    expect(ai(b, 1).stationReference).toBe(b.world.combatants[0]!.aircraft)
  })
})

describe('playerFlight / playerWingman', () => {
  it('回傳玩家的分隊與僚機', () => {
    const b = createBattle(new Idle())
    const f = playerFlight(b)
    expect(f).not.toBeNull()
    expect(f!.count).toBe(SCHWARM_SIZE)
    expect(f!.members[0]).toBe(b.player.index)
    expect(playerWingman(b)).toBe(b.player.index + 1)
  })

  it('僚機陣亡後 playerWingman 指向遞補上來的那一架', () => {
    const b = createBattle(new Idle())
    const first = playerWingman(b)
    b.world.destroy(b.world.combatants[first]!)
    stepBattle(b, DT)
    expect(playerWingman(b)).toBe(first + 1)
  })

  it('分隊只剩玩家時 playerWingman 回 −1', () => {
    const b = createBattle(new Idle())
    const f = playerFlight(b)!
    for (let i = 1; i < f.count; i++) b.world.destroy(b.world.combatants[f.members[i]!]!)
    stepBattle(b, DT)
    expect(playerWingman(b)).toBe(-1)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL，`b.flights` / `playerFlight` / `playerWingman` 不存在

- [ ] **Step 3: 改 `src/battle/setup.ts`**

新增 import：

```ts
import {
  compactFlights, createFlights, stationReferenceOf, type Flight, type FlightIndex,
} from './flights'
```

`Battle` 介面新增欄位：

```ts
  /**
   * 編制。**每個物理步由 `stepBattle` 重新壓縮**（M6 spec §5.4）。
   */
  readonly flights: FlightIndex
```

`createBattle` 的尾段（接在 `createTargetBoard` 之後）：

```ts
  // 【指派板必須在全部 add 完之後才建】它會檢查 index 與陣列位置一致，
  // 而 index 是 add 依序給的
  const board = createTargetBoard(world.combatants)
  // 【編制同理】而且玩家要釘在自己分隊的 members[0]（M6 spec §5.3）
  const flights = createFlights(world.combatants, player.index)

  // AI 接線：指派板、自身索引、決策相位
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  const battle: Battle = {
    world,
    board,
    blue,
    red,
    player,
    cfg,
    flights,
    spawnOrientations: world.combatants.map((c) => c.aircraft.state.orientation.clone()),
    countdown: 0,
  }
  wireStations(battle)
  return battle
}

/**
 * 把每一架 AI 的站位參考機與站位偏置接上。
 *
 * 【為什麼每個物理步都要重跑】保序壓縮會改變成員位置，而站位偏置是
 * **位置**的函數。不重跑的話，`members[2]` 遞補成 `members[1]` 之後仍然
 * 守著第二 Rotte 的站位 —— 遞補等於沒發生。
 *
 * 【為什麼用 instanceof 而不是一個旗標】玩家的控制器會在
 * `PlayerController` 與 `AiController` 之間切換（`I` 鍵）。`instanceof`
 * 自動跟著走，而一個旗標會忘記更新。玩家釘在 `members[0]`，所以他接手
 * 的那一顆 AI 拿到的恆是「沒有站位」—— 自由交戰，正是要的。
 */
function wireStations(b: Battle): void {
  const cs = b.world.combatants
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    const ref = stationReferenceOf(b.flights, c.index)
    ai.stationReferenceIndex = ref
    ai.stationReference = ref >= 0 ? cs[ref]!.aircraft : null
    const pos = b.flights.positionOf[c.index]!
    ai.stationOffset = STATION_OFFSETS[pos >= 0 ? pos : 0]!
  }
}
```

`stepBattle` 加兩行：

```ts
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)

  const cs = b.world.combatants
  const assignments = b.board.assignments
  for (let i = 0; i < cs.length; i++) {
    if (!cs[i]!.alive) assignments[i] = -1
  }

  // 【編制與站位每步重算】保序壓縮是存活旗標的純函數（M6 spec §5.4）：
  // 重算比維護增減安全 —— 維護要求每一條退場路徑都配一次更新，漏掉任何
  // 一條就留下一個永遠不消失的幽靈狀態。成本是 O(架數)。
  compactFlights(b.flights, cs)
  wireStations(b)

  if (b.countdown > 0) {
    // ...（以下不動）
```

`resetBattle` 尾段加兩行：

```ts
  b.board.assignments.fill(-1)
  compactFlights(b.flights, combatants)
  wireStations(b)
  b.countdown = 0
}
```

檔尾新增兩個查詢函數：

```ts
/**
 * 玩家的分隊；玩家已退場時回傳 null。
 *
 * 【為什麼不直接讓呼叫端讀 flights】HUD 那一層不該知道編制的內部表示。
 * 這兩個函數是它需要的全部。
 */
export function playerFlight(b: Battle): Flight | null {
  const f = b.flights.flightOf[b.player.index]!
  return f >= 0 ? b.flights.flights[f]! : null
}

/**
 * 玩家的僚機（`members[1]`）的 `Combatant` 索引；沒有時回傳 −1。
 *
 * 遞補之後它會自動指向新的那一架 —— 因為 `members` 每步都重新壓縮。
 */
export function playerWingman(b: Battle): number {
  const f = playerFlight(b)
  if (f === null || f.count < 2) return -1
  return f.members[1]!
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/battle-setup.test.ts test/unit/battle-flights.test.ts`
Expected: PASS

- [ ] **Step 5: 跑整套與型別檢查**

Run: `npm run build && npx vitest run`
Expected: 除了 `multi-battle.test.ts` 的門檻（Task 9 處理）之外全綠。**把紅掉的門檻與實際數值記下來帶到 Task 9。**

- [ ] **Step 6: 提交**

```bash
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat: 編制接線與每步壓縮（M6 spec 5.4）"
```

commit 訊息的內文：

```
compactFlights + wireStations 每個物理步跑一次。重算比維護增減安全 --
維護要求每一條退場路徑都配一次更新，漏掉任何一條就留下一個永遠不消失
的幽靈狀態，而症狀離成因很遠（M5 的 lockedAfterExit 就是這樣來的）。

wireStations 必須每步跑，不能只在建立時跑一次：站位偏置是「位置」的
函數，members[2] 遞補成 members[1] 之後若不重接，它仍然守著第二 Rotte
的站位 -- 遞補等於沒發生。

用 instanceof 判斷是不是 AI，因為玩家的控制器會在 PlayerController 與
AiController 之間切換（I 鍵）；旗標會忘記更新。玩家釘在 members[0]，
所以他接手的那一顆 AI 拿到的恆是「沒有站位」。
```

---

## Task 9: 整合測試 —— 編隊的觀測量與門檻

**Files:**
- Modify: `test/integration/multi-battle.test.ts`

**Interfaces:**
- Consumes: `AiController.stationReference` / `.stationError`（Task 6）、`Battle.flights`（Task 8）、`DEFAULT_WINGMAN`（Task 5）、`THREAT_RANGE`（`assess.ts`）
- Produces: 無（純測試）

**背景**：M5 在這裡踩過坑 —— 三個門檻是在「開局幾何退化」的區間量的，修好之後全部失效，得重新推導。所以本任務的順序是**先量、再定**，而且每個門檻都要附推導。

新增三個觀測量（spec §4.1 條件 12、13）與兩個門檻調整。

- [ ] **Step 1: 加觀測量與 console.log（先不加斷言）**

檔頭 import 補上：

```ts
import { Vector3 } from 'three'   // 若尚未 import
import { DEFAULT_WINGMAN } from '../../src/ai/wingman'
import { THREAT_RANGE } from '../../src/ai/assess'
import { SCHWARM_SIZE } from '../../src/battle/flights'
```

輔助函數（放在 `observe` 之前）：

```ts
/** 一組數字的中位數；空陣列回傳 NaN。 */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN
  const s = Array.from(xs).sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const CENTRE_A = new Vector3()
const CENTRE_B = new Vector3()

/** 兩隊**存活者**重心的距離，m。任一方全滅時回傳 Infinity。 */
function centroidGap(b: Battle): number {
  CENTRE_A.set(0, 0, 0)
  CENTRE_B.set(0, 0, 0)
  let na = 0
  let nb = 0
  for (const c of b.blue) if (c.alive) { CENTRE_A.add(c.aircraft.state.position); na++ }
  for (const c of b.red) if (c.alive) { CENTRE_B.add(c.aircraft.state.position); nb++ }
  if (na === 0 || nb === 0) return Infinity
  return CENTRE_A.divideScalar(na).distanceTo(CENTRE_B.divideScalar(nb))
}
```

`Observed` 新增三個欄位：

```ts
  /** 巡航階段（兩隊重心仍相距 > THREAT_RANGE）各僚機的站位誤差樣本，m */
  cruiseStationErrors: number[]
  /** 完整歸隊的次數：離站超過 breakExit 之後回到門檻內 */
  rejoins: number
  /** Schwarm 內遞補的次數：members[0] 不變而 members[1] 換人 */
  replacements: number
```

`observe()` 內新增狀態與取樣（放進既有的主迴圈）：

```ts
  /** 每架是否曾經離站超過 breakExit（歸隊偵測用） */
  const wasBeyond = new Uint8Array(cs.length)
  /** 各分隊上一步的 members[0] 與 members[1] */
  const prevLead = new Int32Array(b.flights.flights.length).fill(-1)
  const prevWing = new Int32Array(b.flights.flights.length).fill(-1)
```

主迴圈內（`stepBattle` 之後）：

```ts
    // ── 編制遞補（每步，10 個分隊，很便宜）──
    for (let f = 0; f < b.flights.flights.length; f++) {
      const fl = b.flights.flights[f]!
      const lead = fl.count > 0 ? fl.members[0]! : -1
      const wing = fl.count > 1 ? fl.members[1]! : -1
      if (prevLead[f]! >= 0 && lead === prevLead[f]! && wing >= 0
          && prevWing[f]! >= 0 && wing !== prevWing[f]!) {
        o.replacements++
      }
      prevLead[f] = lead
      prevWing[f] = wing
    }

    // ── 站位誤差：每 12 步（20 Hz）取樣一次 ──
    // 【為什麼不是每步】stationError 本來就只在 10 Hz 的決策節拍更新，
    // 每步取樣只是把同一個值抄 24 遍，還會讓中位數被「停在站上不動」的
    // 那幾架灌爆。
    if (i % 12 === 0) {
      const cruising = centroidGap(b) > THREAT_RANGE
      for (let k = 0; k < ais.length; k++) {
        const a = ais[k]
        if (a === null || a.stationReference === null || !cs[k]!.alive) continue
        if (cruising) o.cruiseStationErrors.push(a.stationError)
        if (a.stationError > DEFAULT_WINGMAN.breakExit) {
          wasBeyond[k] = 1
        } else if (wasBeyond[k] === 1 && a.stationError < 100) {
          o.rejoins++
          wasBeyond[k] = 0
        }
      }
    }
```

觀測輸出那一條測試改成也印出中位數：

```ts
  it('觀測值（不是門檻，供回填與日後比對）', () => {
    console.log(JSON.stringify({
      ...o,
      cruiseStationErrors: undefined,
      cruiseSamples: o.cruiseStationErrors.length,
      cruiseMedian: median(o.cruiseStationErrors),
      cruiseP90: median(o.cruiseStationErrors.filter(
        (x) => x >= median(o.cruiseStationErrors),
      )),
    }))
    expect(Number.isFinite(o.switches)).toBe(true)
  })
```

- [ ] **Step 2: 跑一次，把數字記下來**

Run: `npx vitest run test/integration/multi-battle.test.ts`

把 console 印出的 JSON **完整貼進實作報告**。特別記下：`maxLocks`、`switches`、`cruiseSamples`、`cruiseMedian`、`cruiseP90`、`rejoins`、`replacements`、`wipes`、`blueLost`、`redLost`。

此時 `MAX_LOCKS`（4）與 `MAX_SWITCHES`（760）大機率是紅的 —— 那是預期的，下一步重新推導。

- [ ] **Step 3: 依推導規則設定門檻**

三個門檻，每一個都照下面的規則從實測值推出來，**並把實測值寫進註解**：

```ts
/**
 * 最大同時鎖定數的上限。
 *
 * 【M5 是 4，M6 提高到 6】M5 量到 3（20 個獵人分 20 個目標）。M6 的僚機
 * 不用評分，它們照準則走 —— **一個未受威脅的 Schwarm 會整隊集火同一架**，
 * 那是 4。加上 M5 量到的自由獵手分攤上限 3，取 6 為界。
 *
 * **Schwarm 集火到 4 是設計，不是缺陷。** 這一條要抓的是它有沒有退化成
 * 「跨分隊也在撲同一架」—— M5 §14 記著那個狀態的後果：17 架撲同一個目標，
 * 藍隊 60 秒掉 18 架。
 *
 * 實測：<填入>
 */
const MAX_LOCKS = 6

/**
 * 60 秒內全隊換目標的次數上限。
 *
 * 【M6 重新量測】M5 量到 506（40 架都用 selectTarget）。M6 只有 10 架
 * 自由獵手走 selectTarget，其餘 30 架走僚機準則 —— 兩者的換手率不同，
 * M5 的數字不可沿用。
 *
 * 規則：實測 × 1.5，向上取整到百位。上界的意義不變：遲滯完全失效時
 * 40 架每個決策節拍都可能換一次 = 40 × 60 × 10 Hz = 24,000 次。
 *
 * 實測：<填入>
 */
const MAX_SWITCHES = /* 實測 × 1.5 */

/**
 * 巡航階段站位誤差的中位數上限，m。
 *
 * 【100 m 怎麼來】等於 `DEFAULT_STATION.blendRange` —— 站位控制器已經
 * 進入「平行飛」區間就算在隊上（M6 spec §14）。這不是一個從實測回填的
 * 數字，是一個**設計要求**：巡航階段沒有任何人在交戰半徑內，站位誤差
 * 本來就該貼近 0。
 *
 * **實測若明顯超過它，那是控制器或距離門的缺陷，不是門檻該放寬。**
 *
 * 實測中位數：<填入>
 */
const MAX_CRUISE_STATION_ERROR = 100
```

- [ ] **Step 4: 加斷言**

```ts
  it('開局巡航時編隊維持得住（M6 spec §4.1 條件 12）', () => {
    // 【這一條同時是集火距離門的迴歸守門】拿掉 wingman.ts 第 3 級的
    // THREAT_RANGE 判斷，僚機會在 10 km 外就跟著長機撲出去，巡航階段的
    // 編隊會融成一條線 —— 中位數會遠遠衝破 100 m。
    expect(o.cruiseStationErrors.length).toBeGreaterThan(100)
    expect(median(o.cruiseStationErrors)).toBeLessThan(MAX_CRUISE_STATION_ERROR)
  })

  it('混戰散開之後真的有人歸隊（M6 spec §4.1 條件 13）', () => {
    expect(o.rejoins).toBeGreaterThan(0)
  })

  it('Schwarm 內遞補真的發生過（觀測，不是門檻）', () => {
    // 【為什麼只是觀測】遞補的次數取決於誰先死，是隨機的。確定性的驗證
    // 在 test/unit/battle-flights.test.ts 與 battle-setup.test.ts。
    console.log(`Schwarm 內遞補 ${o.replacements} 次`)
    expect(o.replacements).toBeGreaterThanOrEqual(0)
  })
```

- [ ] **Step 5: 跑測試確認全綠**

Run: `npx vitest run test/integration/multi-battle.test.ts`
Expected: PASS

- [ ] **Step 6: 驗證兩個回歸守門員真的會紅**

**這一步不可以跳過。** 一個沒被驗證會失敗的回歸測試不算回歸測試。

(a) 暫時拿掉 `src/ai/wingman.ts` 第 3 級的距離判斷（把
`&& c.aircraft.state.position.distanceTo(lead.aircraft.state.position) < THREAT_RANGE`
刪掉），跑：

Run: `npx vitest run test/integration/multi-battle.test.ts -t "開局巡航時編隊維持得住"`
Expected: **FAIL**，中位數遠大於 100

改回去。

(b) 暫時把 `DEFAULT_BATTLE.lateralOffset` 改成 `300`，跑：

Run: `npx vitest run test/integration/multi-battle.test.ts -t "沒有一方被全滅"`
Expected: **FAIL**，`wipes` > 0

改回去，再跑一次確認全綠。

- [ ] **Step 7: 型別檢查與提交**

Run: `npm run build`

```bash
git add test/integration/multi-battle.test.ts
git commit -m "test: 編隊的整合觀測量與重新推導的門檻（M6 spec 4.1）"
```

commit 訊息的內文（把實測數字填進去）：

```
新增三個觀測量：巡航階段的站位誤差、完整歸隊次數、Schwarm 內遞補次數。

兩個門檻重新推導 -- M5 在這裡踩過坑，三個門檻是在開局幾何退化的區間量
的，修好之後全部失效：

maxLocks 4 -> 6。M6 的僚機不用評分，一個未受威脅的 Schwarm 會整隊集火
同一架（4），加上自由獵手的分攤上限 3。Schwarm 集火到 4 是設計不是缺陷；
這一條抓的是有沒有退化成跨分隊也在撲同一架。

switches 重新量測：M5 的 506 是 40 架都走 selectTarget 的數字，M6 只有
10 架自由獵手，不可沿用。

站位誤差中位數 100 m 不是回填值，是設計要求 -- 巡航階段沒有任何人在
交戰半徑內，誤差本來就該貼近 0。實測若超過它是缺陷不是門檻該放寬。

兩個回歸守門員都驗證過會紅：拿掉集火距離門，巡航中位數衝破 100；把
lateralOffset 設回 300，wipes 大於 0。
```

---

## Task 10: 效能閘門重新校準

**Files:**
- Modify: `test/unit/perf-gate.test.ts`（只動 20v20 那一段的常數與註解）

**Interfaces:**
- Consumes: 無
- Produces: 無

**背景**（spec §11）：`bench/multi-load.ts` 每步把彈丸池補滿到 `PROJECTILE_CAPACITY`，所以彈丸負載是**合成的**、不隨戰況起伏 —— 巡航階段不會讓它變空。真正會變的是**幾何**：

| | M5 | M6 |
|---|---|---|
| 每隊的 X 向跨度 | 2,280 m | 3,850 m |
| 兩隊的 Z 向間隔 | 3,000 m | 10,000 m |

`CullIndex` 是**沿 X 排序**的滑動視窗，視窗內的架數直接由 X 向密度決定。X 攤得更開，每發彈丸掃到的架數就更少，整步會**變快** —— 而那與被測的程式毫無關係。

所以 20v20 閘門的數字在 M6 之後**不可與 M5 的直接比較**。

- [ ] **Step 1: 獨立量三次**

Run（跑三次，每次都記下 mean）：

```
npx vitest bench --run bench/multi.bench.ts
```

**單一次量測會騙人** —— M5 量到 313 / 388 / 402 µs，第一次是機器最閒的時候。三次都要記。

- [ ] **Step 2: 推導新的預算與門檻**

規則（與 M5 相同，只是數字換了）：

- **預算** = 三次量測的**上界之上**取整到百位。它由 `npm run bench` 獨立驗證，不在測試裡斷言。
- **門檻** = 預算 × 3。理由不變：這一條要抓的是**數量級的迴歸**，具體而言就是「有人把排序掃描改回全掃描」—— 實測那會讓粗篩從 202 µs 變成 7,408 µs。並行雜訊最壞約三倍，兩者之間有六倍以上的間隙。

**若新的預算明顯低於 M5 的 500 µs**（X 向攤開讓它變快），**一定要跟著調低**，否則門檻會鬆到再也抓不到迴歸。這正是本任務存在的理由。

- [ ] **Step 3: 改常數與註解**

改 `test/unit/perf-gate.test.ts` 的 `MULTI_BUDGET_US` / `MULTI_GATE_US`，並在該段註解裡**同時保留新舊兩組數字**：

```ts
/**
 * 20v20 的效能守門（M5 spec §10、M6 spec §11）。
 *
 * （……上面關於「兩個數字各有用途」的段落原樣保留……）
 *
 * 【M6 重新校準】M5 的預算 500 µs 是在「每隊 X 向跨度 2,280 m、兩隊
 * Z 向相距 3,000 m」的佈局下量的（實測 313 / 388 / 402 µs）。M6 把佈局
 * 改成 5 個 Schwarm 並排、開局拉到 10 km：
 *
 *   每隊 X 向跨度  2,280 m → 3,850 m
 *   兩隊 Z 向間隔  3,000 m → 10,000 m
 *
 * 而 `CullIndex` 是沿 X 排序的滑動視窗，視窗內的架數直接由 X 向密度
 * 決定 —— X 攤得更開，每發彈丸掃到的架數就更少。**這個數字因此不可與
 * M5 的直接比較。**
 *
 * M6 實測（`npx vitest bench --run bench/multi.bench.ts` 三次）：
 * <填入> / <填入> / <填入> µs。
 *
 * 【彈丸負載沒有變】`bench/multi-load.ts` 每步把池補滿到
 * `PROJECTILE_CAPACITY`，所以「開局在巡航、沒人開火」不會讓負載變空
 * —— 那是設計時擔心過但實際不成立的一件事。
 */
const MULTI_BUDGET_US = /* 填入 */
const MULTI_GATE_US = /* 預算 × 3 */
```

- [ ] **Step 4: 跑閘門確認全綠**

Run: `npx vitest run test/unit/perf-gate.test.ts`
Expected: PASS，且**不印出超支警告**（若印了，代表預算取得太低，回 Step 2 重看三次量測）

- [ ] **Step 5: 連跑整套三次，確認不會間歇性紅燈**

Run（連續三次）: `npx vitest run`
Expected: 三次全綠。**會飄的效能門檻比沒有門檻更糟** —— 它訓練所有人重跑一次當作沒看到。若有任何一次紅，修的是量測方法（批次數／批次長度），**不是**放寬斷言。

- [ ] **Step 6: 提交**

```bash
git add test/unit/perf-gate.test.ts
git commit -m "test: 20v20 效能閘門依 M6 的佈局重新校準（M6 spec 11）"
```

commit 訊息的內文（填入數字）：

```
M5 的 500 µs 預算是在「每隊 X 向跨度 2,280 m、兩隊相距 3,000 m」的佈局
下量的。M6 改成 5 個 Schwarm 並排、開局拉到 10 km，X 向跨度變 3,850 m。

CullIndex 是沿 X 排序的滑動視窗，視窗內的架數直接由 X 向密度決定 --
X 攤得更開，每發彈丸掃到的架數就更少，整步會變快，而那與被測的程式
毫無關係。不跟著調低的話，門檻會鬆到再也抓不到迴歸。

M6 實測三次：<填入>。預算取上界之上的整百，門檻取預算的三倍。新舊兩組
數字都留在註解裡。

順帶更正一件寫在 spec 初稿裡的錯誤：擔心過「巡航階段量到空無一物」，
但 bench/multi-load.ts 每步把彈丸池補滿，負載是合成的，那件事不成立。
```

---

## Task 11: HUD —— 僚機標記與分隊存活

**Files:**
- Modify: `src/hud/types.ts`、`src/hud/widgets/contacts.ts`、`src/hud/widgets/roster.ts`
- Test: `test/unit/hud.test.ts`（追加 describe）

**Interfaces:**
- Consumes: 無
- Produces（給 Task 12 填值）：
  ```ts
  interface HudContact { /* ... */ wingman: boolean }
  interface HudFrame { /* ... */ flightAlive: number; flightSize: number }
  function contactColor(hostile: boolean, wingman: boolean): string
  function flightLabel(alive: number, size: number): string | null
  ```

**背景**（spec §10）：只加**讓這個功能可讀**的兩件事。不加僚機狀態面板、指令提示、隊形示意圖 —— 那些屬於指令介面，已切到指揮 AI 那份 spec。

判斷一律抽成純函數再測 —— 繪製函數進不了單元測試，這是 `countdownLabel`、`minimapSymbol`、`edgeIndicatorPosition` 都用過的做法。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/hud.test.ts` 追加。檔頭 import 補上 `contactColor`（`../../src/hud/widgets/contacts`）、`flightLabel`（`../../src/hud/widgets/roster`）、`HUD_COLORS`（`../../src/hud/types`）。

```ts
describe('contactColor —— 僚機要認得出來（M6 spec §10）', () => {
  it('敵機是危險色', () => {
    expect(contactColor(true, false)).toBe(HUD_COLORS.danger)
  })

  it('一般友機是友方色', () => {
    expect(contactColor(false, false)).toBe(HUD_COLORS.friendly)
  })

  it('自己的僚機用第三個顏色', () => {
    // 【為什麼一定要與一般友機分開】驗收條件 20 要求「你看得出來那是你的
    // 僚機」。不分的話，僚機回頭掩護你這件事在畫面上與「剛好有架友機飛
    // 過」完全無法區分。
    expect(contactColor(false, true)).toBe(HUD_COLORS.warn)
    expect(contactColor(false, true)).not.toBe(HUD_COLORS.friendly)
  })

  it('敵機不會因為 wingman 旗標而變色 —— 那是不可能的狀態，但顏色要可預測', () => {
    expect(contactColor(true, true)).toBe(HUD_COLORS.danger)
  })
})

describe('flightLabel —— 分隊存活（M6 spec §10）', () => {
  it('滿編顯示 4/4', () => {
    expect(flightLabel(4, 4)).toBe('隊 4/4')
  })

  it('遞補之後顯示剩幾架', () => {
    expect(flightLabel(2, 4)).toBe('隊 2/4')
  })

  it('分隊只剩自己時不顯示 —— 那時候沒有「隊」這回事', () => {
    expect(flightLabel(1, 4)).toBeNull()
  })

  it('沒有分隊時不顯示', () => {
    expect(flightLabel(0, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: FAIL，`contactColor` / `flightLabel` 不存在

- [ ] **Step 3: 改 `src/hud/types.ts`**

`HudContact` 加一個欄位（放在 `hostile` 之後）：

```ts
  /**
   * 這是**玩家自己的僚機**（自己分隊的 `members[1]`）。
   *
   * 【為什麼只標這一架】它是唯一一架行為與玩家直接耦合的飛機 —— 你被咬
   * 時它會回頭。不標的話，那件事在畫面上與「剛好有架友機飛過」無法區分
   * （M6 spec §10）。
   */
  wingman: boolean
```

`createHudContact()` 加 `wingman: false`。

`HudFrame` 加兩個欄位（放在 `redAlive` 之後）：

```ts
  /** 玩家分隊還活著幾架（含玩家自己）。0 = 玩家已退場 */
  flightAlive: number
  /** 玩家分隊的編制員額。`flightAlive` 的分母 */
  flightSize: number
```

`createHudFrame()` 加 `flightAlive: 0, flightSize: 0`。

- [ ] **Step 4: 改 `src/hud/widgets/contacts.ts`**

新增純函數（放在 `edgeIndicatorPosition` 之後）：

```ts
/**
 * 一個接觸點該用什麼顏色。
 *
 * 敵紅、友藍、**自己的僚機用第三個顏色**。抽成純函數是因為繪製函數進不了
 * 單元測試，而「哪一架該長得不一樣」是一條有實際行為的規則 —— 與
 * `edgeIndicatorPosition`、`minimapSymbol` 是同一個做法。
 */
export function contactColor(hostile: boolean, wingman: boolean): string {
  if (hostile) return HUD_COLORS.danger
  return wingman ? HUD_COLORS.warn : HUD_COLORS.friendly
}
```

`drawContacts` 裡把

```ts
    const color = c.hostile ? HUD_COLORS.danger : HUD_COLORS.friendly
```

換成

```ts
    const color = contactColor(c.hostile, c.wingman)
```

- [ ] **Step 5: 改 `src/hud/widgets/roster.ts`**

新增純函數：

```ts
/**
 * 玩家分隊的存活字串；沒有分隊或只剩自己時回傳 null。
 *
 * 【為什麼剩一架就不顯示】那時候沒有「隊」這回事 —— 顯示「隊 1/4」只是
 * 在提醒玩家一件他已經知道的事，而且會佔一塊很快就被學會忽略的版面。
 * 與 `countdownLabel` 在戰鬥進行中回傳 null 是同一條紀律。
 */
export function flightLabel(alive: number, size: number): string | null {
  if (size < 2 || alive < 2) return null
  return `隊 ${alive}/${size}`
}
```

`drawRoster` 在存活數那一行之後、倒數之前插入：

```ts
  const flight = flightLabel(f.flightAlive, f.flightSize)
  if (flight !== null) {
    ctx.font = hudFont(Math.round(11 * L.scale))
    ctx.fillStyle = HUD_COLORS.dim
    ctx.fillText(flight, L.cx, y + size * 1.15)
  }
```

倒數那一行的 y 位移由 `y + size * 1.6` 改成 `y + size * 2.0`，讓兩行不重疊。

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: PASS（8 條）

- [ ] **Step 7: 型別檢查**

Run: `npm run build`
Expected: **會失敗** —— `createHudContact` / `createHudFrame` 已補齊，但 `main.ts` 還沒填新欄位。若錯誤只出現在 `main.ts`，那是預期的，Task 12 會補。若出現在別處，先修好。

- [ ] **Step 8: 提交**

```bash
git add src/hud/types.ts src/hud/widgets/contacts.ts src/hud/widgets/roster.ts test/unit/hud.test.ts
git commit -m "feat: HUD 標出玩家的僚機與分隊存活（M6 spec 10）"
```

commit 訊息的內文：

```
只加讓這個功能可讀的兩件事：僚機用第三個顏色、花名冊多一行「隊 n/4」。

僚機一定要與一般友機分開 -- 驗收條件 20 要求「你看得出來那是你的僚機」，
不分的話「僚機回頭掩護你」在畫面上與「剛好有架友機飛過」完全無法區分。

分隊只剩自己時不顯示那一行：那時候沒有「隊」這回事，顯示「隊 1/4」只是
在提醒玩家一件他已經知道的事。與 countdownLabel 在戰鬥進行中回傳 null
是同一條紀律。

兩個判斷都抽成純函數 -- 繪製函數進不了單元測試。
```

---

## Task 12: `main.ts` 接線

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `playerFlight`、`playerWingman`（Task 8）、`HudContact.wingman` / `HudFrame.flightAlive` / `.flightSize`（Task 11）
- Produces: 無

- [ ] **Step 1: 改 import**

```ts
import {
  aliveCount, createBattle, playerFlight, playerWingman, resetBattle, stepBattle,
} from './battle/setup'
```

- [ ] **Step 2: 填 HudFrame 的兩個新欄位**

在 `hudFrame.resetCountdown = battle.countdown` 之後插入：

```ts
  // 【分隊存活】遞補之後 count 會自動變 —— members 每個物理步重新壓縮
  const flight = playerFlight(battle)
  hudFrame.flightAlive = flight?.count ?? 0
  hudFrame.flightSize = flight?.roster.length ?? 0
```

- [ ] **Step 3: 填 HudContact 的 `wingman`**

在接觸點迴圈**之前**取一次索引（迴圈裡取會重算 40 次）：

```ts
  // 【每幀取一次】遞補之後它會指向新的那一架
  const wingmanIndex = playerWingman(battle)
```

迴圈內，在 `contact.hostile = c.team !== player.team` 之後插入：

```ts
    contact.wingman = c.index === wingmanIndex
```

- [ ] **Step 4: 型別檢查**

Run: `npm run build`
Expected: 無輸出

- [ ] **Step 5: 跑整套**

Run: `npx vitest run`
Expected: 全綠

- [ ] **Step 6: 瀏覽器人工檢查（快速版，完整驗收在 Task 13）**

Run: `npm run dev`

開瀏覽器確認三件**立刻看得出來**的事：

1. 開局是五個分隊的隊形，不是一排飛機
2. 花名冊那一行下方有「隊 4/4」
3. 右前方那一架友機的框是琥珀色（那是你的僚機）

不對的話先修，再進 Task 13 的完整驗收。

- [ ] **Step 7: 提交**

```bash
git add src/main.ts
git commit -m "feat: main.ts 接上編制與僚機標記"
```

---

## Task 13: 實測回填、文件與人工驗收

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-m6-formation-wingman-design.md`（§14 門檻總表）
- Modify: `README.md`
- Test: 無新增

**背景**：M2、M4、M5 都是這樣收尾的 —— 起始值全部標著「待實測回填」，交付時要把真正量到的數字寫回去，並記下哪些沒有給出強訊號。

- [ ] **Step 1: 人工驗收（專案負責人執行）**

Run: `npm run dev`

逐條走 spec §4.2 的六條，把結果記進報告：

| # | 條件 | 通過？ |
|---|---|---|
| 18 | 開局看得到五個分隊各自成隊推進，不是一排飛機 | |
| 19 | 開局的等待時間是「壯觀」而不是「無聊」 | |
| 20 | 有人咬你尾巴時僚機會回頭把他推開，而且你看得出來那是你的僚機 | |
| 21 | 僚機被打掉後有人飛來補位（看花名冊的「隊 n/4」與琥珀色框換人） | |
| 22 | 混戰散開之後，還活著的僚機會飛回長機旁邊 | |
| 23 | 僚機不會在長機旁邊抖動或與機模重疊 | |

**條件 19 不通過的話**：`DEFAULT_BATTLE.entryRange` 往下調（6,000 m 給約 11 秒），並把 §8.1 的推導與新值一起更新。

**條件 23 不通過的話**：先看是抖動還是穿模。抖動 → `DEFAULT_STATION.blendRange` 或 `speedGain` 太大；穿模 → `STATION_OFFSETS` 的間距太小。兩者都要**先解釋**再改值。

- [ ] **Step 2: 回填 spec §14 的門檻總表**

把每一列的「起始值」換成實際交付的值，並在推導欄加上實測依據。特別要誠實記下的兩類：

- **量測沒有給出強訊號的**（M5 的 `minDwell` 就是這樣，掃描 0.5–4 s 之間不單調）—— 寫明「這一項的量測沒有給出強訊號」，不要假裝它是量出來的。
- **人工驗收改過的**（例如 `entryRange` 因為條件 19 而下調）—— 寫明原因。

同時在 §14 之後新增一節：

```markdown
## 14.1 交付紀錄

| 項目 | 交付值 | 與起始值的差異 |
|---|---|---|
| ... | ... | ... |

### 實作階段發現、spec 沒有預見的事

（逐條記下，每一條要說明「症狀是什麼」與「為什麼 spec 沒看到」）
```

- [ ] **Step 3: 更新 `README.md`**

先讀一次 `README.md`，然後做三處修改：

1. **「架構」那一節**：加入三個新模組的一行說明 ——
   - `src/battle/flights.ts`：編制與保序壓縮
   - `src/ai/station.ts`：站位幾何與站位控制器
   - `src/ai/wingman.ts`：僚機的四級目標優先序
2. **「尚未實作」那一節**：把「編隊／僚機」移出去；新增兩項 ——
   - 指揮 AI（分隊級戰術指令與集合點）
   - 玩家對僚機下令（歸隊／攻擊我的目標／自由交戰）
3. 若 README 有列里程碑或效能數字，把 20v20 的每步耗時換成 Task 10 量到的新值，並註明佈局已改（M5 的數字不可直接比較）。

- [ ] **Step 4: 跑完整回歸三次**

Run（連續三次）: `npm run build && npx vitest run`
Expected: 三次全綠。效能閘門若有任何一次紅，回 Task 10 修**量測方法**，不是放寬斷言。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-08-04-m6-formation-wingman-design.md README.md
git commit -m "docs: M6 實測回填與交付紀錄"
```

---

## 自我檢查（寫完計畫後執行，結果記在下方）

### 1. Spec 覆蓋

| Spec 章節 | 由哪個任務實作 |
|---|---|
| §3.1 架構方案 A | Task 2–6（三個純函數模組 + AiController 分派） |
| §3.2 `rules.ts` 不用改 | Task 5（自衛級）+ Task 6（歸隊落在「沒有目標」分支） |
| §4.1 條件 1–5（編制） | Task 2 |
| §4.1 條件 6–8（站位） | Task 3、4 |
| §4.1 條件 9–11a（僚機目標） | Task 5 |
| §4.1 條件 12–15（整合） | Task 9 |
| §4.1 條件 16（效能） | Task 10 |
| §4.1 條件 17（決定性） | 既有測試，Task 7/8 不得破壞 |
| §4.2 條件 18–23（人工） | Task 13 |
| §5 編制 | Task 2、8 |
| §6 站位 | Task 3、4 |
| §7 僚機目標 | Task 1、5 |
| §8 開局幾何 | Task 7 |
| §9 玩家 | Task 7（`playerSlot`）、Task 8（釘位） |
| §10 HUD | Task 11、12 |
| §11 效能 | Task 10 |
| §12 檔案結構 | 全部 |
| §13 測試策略 | 各任務的測試步驟 |
| §14 門檻總表 | Task 13 回填 |

**沒有缺口。**

### 2. 佔位符掃描

計畫中刻意保留的 `<填入>` 只出現在 Task 9、10、13 —— 那三處是**必須由實測產生**的數字，計畫已明確寫出「怎麼量」與「用什麼規則從量測值推出門檻」。這與「TBD」不同：規則是完整的，只有數字要跑一次才知道。

### 3. 型別一致性

| 名稱 | 定義於 | 使用於 |
|---|---|---|
| `threatFactor` | Task 1 | Task 5 |
| `SCHWARM_SIZE` / `STATION_REFERENCE` | Task 2 | Task 7、9、測試 |
| `createFlights` / `compactFlights` / `stationReferenceOf` | Task 2 | Task 8 |
| `FlightIndex` / `Flight` | Task 2 | Task 8（`Battle.flights`、`playerFlight`） |
| `STATION_OFFSETS` / `stationPoint` | Task 3 | Task 4、6、7、8 |
| `StationOffset` / `StationConfig` / `stationCommand` / `DEFAULT_STATION` | Task 3、4 | Task 6 |
| `WingmanConfig` / `DEFAULT_WINGMAN` / `createWingmanState` / `selectWingmanTarget` | Task 5 | Task 6、9 |
| `AiController.stationReference` / `.stationOffset` / `.stationError` | Task 6 | Task 8、9 |
| `Battle.flights` / `playerFlight` / `playerWingman` | Task 8 | Task 12 |
| `HudContact.wingman` / `HudFrame.flightAlive` / `.flightSize` | Task 11 | Task 12 |
| `contactColor` / `flightLabel` | Task 11 | Task 11（`drawContacts` / `drawRoster`） |

**名稱在定義處與使用處一致。**

### 4. 破壞性變更清單（實作者要預期會紅的既有測試）

| 任務 | 會紅的既有測試 | 處置 |
|---|---|---|
| 7 | `battle-setup.test.ts` 的「同隊相鄰兩架的橫向間距等於 lateralSpacing」 | 刪除（`lateralSpacing` 不存在了） |
| 7 | 同檔的「兩隊橫向錯開 lateralOffset」 | 改比分隊長機 |
| 7 | 同檔的「錯開量大於進入距離上的射擊錐」 | 改成量真實位置 |
| 7 | 同檔的「高度散布在 ±altitudeSpread 之內」 | 加上站位的 `up` |
| 7、8 | `multi-battle.test.ts` 的 `MAX_LOCKS`、`MAX_SWITCHES` | Task 9 重新推導 |
| 10 | `perf-gate.test.ts` 的 20v20 預算警告 | Task 10 重新校準 |
| 11 | `npm run build` 在 `main.ts` 報缺欄位 | Task 12 補齊 |

**M4 的兩個矩陣測試（`ai-duel-matrix`、`ai-safety-matrix`）與 `bench/ai-load.ts` 全程不得改動** —— 它們是「沒接線的 `AiController` 行為逐位元不變」的證據。任何一條紅了，代表 Task 6 動到了不該動的地方。
