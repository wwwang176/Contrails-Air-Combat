# 第二批防禦機動 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 AI 的破防由「固定 75° 的單一動作」變成「看對方平面、有力道、會反轉」。

**Architecture:** 破防這一層取得自己的狀態物件 `DefendState`（沿用專案既有的
`RuleState` / `TargetState` / `WingmanState` 形狀：狀態由呼叫端持有、以參數傳入），
每個物理步由 `stepDefend` 維護。三件事依序疊上去：力道（與追擊瞄準點混合）→
破防軸（改吃攻擊者的機動平面）→ 反轉（他衝過頭時破防讓位給追擊）。

**Tech Stack:** TypeScript（嚴格模式）、three.js 的 `Vector3` / `Quaternion`、vitest。

**Spec:** `docs/superpowers/specs/2026-08-05-ai-defence-batch2-design.md`

## Global Constraints

- 不得引入 `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態：陣列索引存取一律 `!` 或先判 `undefined`。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`。
- `src/ai/` 的 240 Hz 熱路徑**不得配置記憶體**：新的暫存向量一律用
  `makeScratch`（`src/core/pool`），且每一組暫存不得與同一格內另一個函數共用。
- **每一條新測試都要先跑一次確認是紅的**，再寫實作。步驟裡有明確的「Run …
  Expected: FAIL」那一格，不得跳過。
- **不得為了讓測試通過而放寬任何門檻。** 若量測顯示斷言本身是錯的，改斷言並在
  檔案裡寫清楚理由與數據。
- 不碰 `src/ai/profile.ts` 的 `DifficultyProfile`。
- 不碰 `DEFAULT_RULES.threatEnter` / `threatExit`（0.35 / 0.15）。
- commit 一律指定明確路徑，**不得 `git add -A`**（`bash.exe.stackdump` 是被追蹤
  且已被修改的檔案，會被誤帶進去）。
- 測試指令：`npm test`（vitest run）。單檔：`npx vitest run <path>`。
  型別檢查：`npm run typecheck`。
- 效能閘門在整套並行跑時會因機器競爭而紅；判定以單獨跑該檔為準。

## 檔案結構

| 檔案 | 這一批的責任 |
|---|---|
| `src/ai/steer.ts`（改） | `DefendState`、`stepDefend`、`defendHardness`、`slerpUnit`、`defendAim` 改寫、`steerCommand` 混合與反轉分支 |
| `src/ai/assess.ts`（改） | `considerThreatFrom` 回傳 `boolean`，讓呼叫端知道威脅來源是誰 |
| `src/ai/target.ts`（改） | `TargetState.urgent`：反轉時放行一次目標切換（不放水） |
| `src/ai/AiController.ts`（改） | 持有 `DefendState` 與攻擊者的 `EngageBasis`；接線 |
| `test/unit/ai-steer.test.ts`（改） | 力道、破防軸、號誌閂鎖、反轉判定 |
| `test/unit/ai-assess.test.ts`（改） | `considerThreatFrom` 的回傳值 |
| `test/unit/ai-target.test.ts`（改） | `urgent` 的三條規則 |
| `test/integration/ai-defence.test.ts`（改） | 收緊 `huntedShare`；新增高接近率場景與反轉量測 |

---

### Task 1: 力道連續化（乙）

把破防由「取代瞄準點」改成「與追擊瞄準點混合」，混合比例是連續的力道。

**Files:**
- Modify: `src/ai/steer.ts`
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: 既有的 `Situation`、`EngageBasis`、`Knobs`、`SteerConfig`、`DEFAULT_RULES.threatExit`
- Produces:
  - `export interface DefendState { hardness: number }`（後續任務會加欄位）
  - `export function createDefendState(): DefendState`
  - `export function stepDefend(state: DefendState, threat: number, cfg?: SteerConfig): void`
  - `export function defendHardness(threat: number, cfg?: SteerConfig): number`
  - `export const THREAT_EXIT_ANCHOR: number`
  - `steerCommand` 簽名新增第 8 個參數 `defend: DefendState`（在 `k` 之後、`out` 之前）
  - `SteerConfig` 新增 `defendHardThreat: number`

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-steer.test.ts`。第一條釘住錨點耦合，第二條是這個任務真正的
產出——力道為 0 時 defend 與 engage 必須產生**完全相同**的瞄準點。

```ts
import { DEFAULT_RULES } from '../../src/ai/rules'
import {
  THREAT_EXIT_ANCHOR, defendHardness, createDefendState, stepDefend,
} from '../../src/ai/steer'

describe('破防的力道', () => {
  it('斜坡的錨點必須等於 defendLatch 的解除門檻', () => {
    // 力道要在 defend 解除的那一格恰好歸零，離開這個意圖才是 no-op。
    // 兩個常數分屬 steer 與 rules，這條斷言把耦合釘住。
    expect(THREAT_EXIT_ANCHOR).toBe(DEFAULT_RULES.threatExit)
  })

  it('錨點上恰好是 0、飽和點上恰好是 1、中間單調', () => {
    expect(defendHardness(THREAT_EXIT_ANCHOR)).toBe(0)
    expect(defendHardness(THREAT_EXIT_ANCHOR - 0.1)).toBe(0)
    expect(defendHardness(DEFAULT_STEER.defendHardThreat)).toBe(1)
    expect(defendHardness(1)).toBe(1)
    const a = defendHardness(0.3)
    const b = defendHardness(0.5)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(1)
  })

  it('力道 0 時 defend 的瞄準點與 engage 逐位元相同', () => {
    // 【這是這個任務的核心保證】離開 defend 不該讓瞄準點跳一下。
    // 舊版 defend 完全取代瞄準點，這條必然是紅的。
    const self = makeAircraft()          // 檔案裡既有的輔助函數
    const target = makeAircraftAt(new Vector3(0, 4000, -600))
    const sit = createSituation()
    evaluateGeometry(self, target, sit)
    evaluateThreat(self, target, sit)
    const basis = createEngageBasis()
    buildEngageBasis(self, target, basis)
    const k: Knobs = { leadLag: 1, vertical: 0 }

    const defend = createDefendState()
    stepDefend(defend, THREAT_EXIT_ANCHOR)      // 力道 = 0

    const a: Command = makeCommand()
    const b: Command = makeCommand()
    steerCommand('engage', 'none', sit, basis, self, 0, k, defend, a)
    steerCommand('defend', 'none', sit, basis, self, 0, k, defend, b)

    expect(b.aimWorld.x).toBeCloseTo(a.aimWorld.x, 12)
    expect(b.aimWorld.y).toBeCloseTo(a.aimWorld.y, 12)
    expect(b.aimWorld.z).toBeCloseTo(a.aimWorld.z, 12)
  })

  it('力道 1 時瞄準點與追擊完全無關', () => {
    // 混合的另一端：t = 1 必須落在純破防上，不留一絲追擊成分。
    // 與上一條合起來把 slerpUnit 的兩個端點都釘住。
    const self = makeAircraft()
    const target = makeAircraftAt(new Vector3(0, 4000, -600))
    const sit = createSituation()
    evaluateGeometry(self, target, sit)
    evaluateThreat(self, target, sit)
    const basis = createEngageBasis()
    buildEngageBasis(self, target, basis)
    const k: Knobs = { leadLag: 1, vertical: 0 }

    const defend = createDefendState()
    stepDefend(defend, 1)                      // 力道 = 1
    expect(defend.hardness).toBe(1)

    const out = makeCommand()
    steerCommand('defend', 'none', sit, basis, self, 0, k, defend, out)

    // 破防角是 75°，所以瞄準點與視線的夾角必須接近 75°（追擊會接近 0°）
    const off = Math.acos(out.aimWorld.dot(sit.threatLos))
    expect(off).toBeCloseTo(DEFAULT_STEER.defendOffset, 3)
  })
})
```

> 註：`makeAircraft` / `makeAircraftAt` / `makeCommand` 若檔案裡沒有同名輔助，
> 照該檔案既有的建構方式寫（`new Aircraft(P51D, 4000, 200)` + 設定
> `state.position` / `orientation`，並呼叫一次 `aircraft.update()`——建構子
> 不會填 `diag`，不呼叫的話 `tas` 是 0）。

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL —— `THREAT_EXIT_ANCHOR`、`defendHardness`、`createDefendState`、
`stepDefend` 都不存在（TS2305 / ReferenceError）。

- [ ] **Step 3: 加設定欄位與錨點常數**

在 `src/ai/steer.ts` 的 `SteerConfig` 裡，`defendOffset` 後面加：

```ts
  /**
   * 破防力道飽和的威脅值：到此值破防為滿幅，`THREAT_EXIT_ANCHOR` 以下為 0。
   *
   * **起始值，待實測回填。** 掃描範圍 0.5 / 0.7 / 0.85 / 1.0，
   * 守著它的是受控場景的 `blueDamage` 與 `dealtToA`。
   */
  defendHardThreat: number
```

`DEFAULT_STEER` 裡加 `defendHardThreat: 0.85,`。

在 `DEFAULT_STEER` 之後加常數：

```ts
/**
 * `defendHardness` 斜坡的起點。**必須等於 `DEFAULT_RULES.threatExit`。**
 *
 * 【為什麼錨在出口而不是入口】`defendLatch` 的解除條件是威脅低於
 * `threatExit`。錨在那裡，離開 defend 的那一格力道恰好是 0，前後兩格的
 * 瞄準點連續 —— 與 `unloadPull` 治好 0.1 秒抖動的是同一個手法：一個在模式
 * 邊界上使該模式成為 no-op 的係數。
 *
 * 【為什麼不 import DEFAULT_RULES】`steer.ts` 不依賴 `rules.ts` 的設定，
 * 那會讓幾何層反過來吃規則層。耦合改由 `test/unit/ai-steer.test.ts` 的一條
 * 斷言釘住 —— 有人改動門檻時測試會立刻紅。
 */
export const THREAT_EXIT_ANCHOR = 0.15
```

- [ ] **Step 4: 加 `defendHardness` 與 `DefendState`**

```ts
/**
 * 破防力道，0..1。`THREAT_EXIT_ANCHOR` 以下為 0，`defendHardThreat` 以上為 1。
 *
 * 【力道不是偏轉角】`FlightDirector` 是 bank-to-turn，拉桿力道由「機首到
 * 瞄準點的誤差角」決定，而攻擊者在我後方時那個角接近 180° —— 破防角是 75°
 * 還是 5° 都一樣滿舵。偏轉角控制的是破防的**方向**。力道唯一的載體是
 * 「與不閃躲時的瞄準點混合多少」。
 */
export function defendHardness(threat: number, cfg: SteerConfig = DEFAULT_STEER): number {
  const span = cfg.defendHardThreat - THREAT_EXIT_ANCHOR
  if (!(span > 0)) return 1
  const t = (threat - THREAT_EXIT_ANCHOR) / span
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * 破防這一層的跨格狀態。由 `AiController` 持有、每個物理步餵給 `stepDefend`。
 *
 * 【為什麼 steer 也要有狀態了】力道要讀持續跟蹤加權後的威脅（那個計時器住在
 * `AiController`），而後續的破防號誌與反轉倒數本來就是跨格量。形狀比照
 * `createRuleState` / `createTargetState` / `createWingmanState`：狀態由呼叫端
 * 持有、以參數傳入，模組本身仍然沒有可變的全域狀態。
 */
export interface DefendState {
  /** 這一格的破防力道，0..1。0 = 與不閃躲時的瞄準點完全相同 */
  hardness: number
}

export function createDefendState(): DefendState {
  return { hardness: 0 }
}

/** 每個物理步更新破防狀態。熱路徑，不配置。 */
export function stepDefend(
  state: DefendState, threat: number, cfg: SteerConfig = DEFAULT_STEER,
): void {
  state.hardness = defendHardness(threat, cfg)
}
```

- [ ] **Step 5: 抽出 `slerpUnit`，讓 `shrinkTowardNose` 共用**

在 `shrinkTowardNose` 上方加：

```ts
const SL = makeScratch(1)

/**
 * 沿測地線由 a 走向 b，`t ∈ [0,1]`，結果寫進 out。a、b 必須是單位向量。
 *
 * 【為什麼不是線性內插再正規化】那條路徑在夾角大時速度不均勻，t 的中點會
 * 偏向較近的一端。破防要的是「力道 0.5 = 一半的角度」。
 *
 * out 與 b 別名安全（b 只在寫入 out 之前被讀）。反平行時大圓沒有唯一解，
 * 取起點 a —— 與 `shrinkTowardNose` 舊版「退化時收到機首」的行為一致。
 */
function slerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3): void {
  if (t <= 0) { out.copy(a); return }
  if (t >= 1) { out.copy(b); return }
  const dot = clampUnit(a.dot(b))
  const angle = Math.acos(dot)
  if (angle < 1e-4) { out.copy(b); return }
  const perp = SL.v[0]!.copy(b).addScaledVector(a, -dot)
  const len = perp.length()
  if (len < 1e-6) { out.copy(a); return }
  perp.divideScalar(len)
  const target = angle * t
  out.copy(a).multiplyScalar(Math.cos(target)).addScaledVector(perp, Math.sin(target))
}
```

`shrinkTowardNose` 改成（保留原有的整段註解，只換實作）：

```ts
function shrinkTowardNose(self: Aircraft, factor: number, aim: Vector3): void {
  if (factor >= 1) return
  const nose = U.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
  slerpUnit(nose, aim, factor, aim)
}
```

`U` 由 `makeScratch(2)` 改成 `makeScratch(1)`（第二個暫存移到 `SL`）。

- [ ] **Step 6: `steerCommand` 的 defend 分支改成混合**

簽名加參數（在 `k` 之後）：

```ts
  k: Knobs,
  /** 破防狀態。由 `stepDefend` 每步維護 */
  defend: DefendState,
  out: Command,
```

分支改成：

```ts
      case 'defend': {
        // 【混合而不是取代】力道 0 時瞄準點與追擊逐位元相同，離開 defend
        // 因此是 no-op。見 defendHardness 的註解：縮小破防角控制不了力道。
        const chase = DEF.v[0]!
        aimFromKnobs(basis, sit, k, chase, cfg)
        const brk = DEF.v[1]!
        defendAim(self, sit.threatLos, brk, cfg)
        slerpUnit(chase, brk, defend.hardness, out.aimWorld)
        break
      }
```

`defendAim` 的簽名由 `(self, threatLos, out, cfg)` 改成寫進傳入的 `out`——它
本來就是這個形狀，只是呼叫端由 `out.aimWorld` 換成暫存。在檔案上方加
`const DEF = makeScratch(2)`。

- [ ] **Step 7: `AiController` 接線**

`src/ai/AiController.ts`：

```ts
import {
  buildEngageBasis, createDefendState, createEngageBasis, engageKnobs, geometryGate,
  stepDefend, steerCommand, type Knobs,
} from './steer'
```

欄位（放在 `rules` 附近，公開唯讀，理由與 `rules` 相同——測試與 HUD 要讀）：

```ts
  /**
   * 破防狀態。**唯讀** —— 只有 `stepDefend` 能寫。
   *
   * 【為什麼公開】測試要分辨「有沒有在破防」與「破得多用力」，那是兩件事；
   * 只看 `intent === 'defend'` 分不出來。
   */
  readonly defend = createDefendState()
```

在 240 Hz 段，`const threat = ...` 之後、`if (decide)` 之前插入：

```ts
    stepDefend(this.defend, threat)
```

`steerCommand` 的呼叫加上 `this.defend`：

```ts
    steerCommand(
      this.intent, mode, this.sit, this.basis, self, this.seaHeight,
      this.knobs, this.defend, out,
    )
```

- [ ] **Step 8: 修既有的 `steerCommand` 呼叫端**

`test/unit/ai-steer.test.ts` 裡既有的呼叫都要補上 `defend` 參數。用
`createDefendState()` 建一個、`stepDefend(d, 1)`（滿力道）以維持舊行為，
除非該條測試本來就在測 defend。

Run: `npm run typecheck`
Expected: PASS（沒有殘留的呼叫端）

- [ ] **Step 9: 跑測試**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS（三條新測試）

Run: `npx vitest run test/integration/ai-defence.test.ts`
Expected: PASS —— 四條既有斷言全部維持。**把觀測值那一段印出的數字記下來**
（`defend %`／反應／`huntedShare`／`blueDamage`／`dealtToA`），Task 2 要拿它比對。

- [ ] **Step 10: 跑全套**

Run: `npm test`
Expected: PASS。效能閘門若紅，單獨再跑一次
`npx vitest run test/perf/` 判定（並行時的機器競爭不算退化）。

- [ ] **Step 11: Commit**

```bash
git add src/ai/steer.ts src/ai/AiController.ts test/unit/ai-steer.test.ts
git commit -m "feat: 破防力道連續化，與追擊瞄準點混合"
```

---

### Task 2: 異平面破防（甲）

破防軸由「我的升力向量」換成「攻擊者機動平面的法線」，左右號誌在進入 defend
時決定一次。

**Files:**
- Modify: `src/ai/assess.ts`
- Modify: `src/ai/steer.ts`
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-assess.test.ts`, `test/unit/ai-steer.test.ts`, `test/integration/ai-defence.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DefendState`、`stepDefend`
- Produces:
  - `considerThreatFrom` 回傳 `boolean`（true = 取代了現值）
  - `DefendState` 新增 `sign: number`、`active: boolean`、`attacker: Aircraft | null`
  - `stepDefend` 簽名變為
    `(state, self, attacker, threat, defending, sit, seaHeight, cfg?)`
  - `SteerConfig` 新增 `defendFloor: number`

- [ ] **Step 1: 寫失敗的測試（`considerThreatFrom` 的回傳值）**

加到 `test/unit/ai-assess.test.ts`：

```ts
it('considerThreatFrom 回報有沒有取代現值', () => {
  const self = makeAircraftAt(new Vector3(0, 4000, 0))
  const weak = makeAircraftAt(new Vector3(0, 4000, 3000))     // 太遠，威脅 0
  const strong = aimedAt(self, new Vector3(0, 4000, 300))     // 咬在後方
  const sit = createSituation()
  sit.threatInstant = 0
  expect(considerThreatFrom(self, weak, sit)).toBe(false)
  expect(considerThreatFrom(self, strong, sit)).toBe(true)
  expect(considerThreatFrom(self, weak, sit)).toBe(false)     // 已經有更大的了
})
```

> `aimedAt` 依該檔案既有的方式建構：把飛機擺在指定位置、機首指向 `self`，
> 使 `threatFactor > 0`（機首必須落在預瞄方向 15° 錐內）。

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-assess.test.ts`
Expected: FAIL —— `considerThreatFrom` 現在回傳 `void`，`expect(undefined).toBe(false)` 不過。

- [ ] **Step 3: 改 `considerThreatFrom`**

```ts
/**
 * 把 `threatInstant` 與 `threatLos` 換成另一架敵機 —— 當它的威脅**大於**
 * 現值時。`shotInstant` 不動（那永遠是對當前目標的）。
 *
 * @returns 有沒有取代現值。呼叫端據此知道**最大威脅是誰**，而破防要繞著
 *          那一架的機動平面算 —— 重算一次 `threatFactor` 才問得出來的話，
 *          240 Hz 下就是白花的成本。
 *
 * 不修改 self 與 other。
 */
export function considerThreatFrom(self: Aircraft, other: Aircraft, out: Situation): boolean {
  const t = threatFactor(other, self)
  if (t <= out.threatInstant) return false
  out.threatInstant = t
  aimAt(self, other, out.threatLos)
  return true
}
```

Run: `npx vitest run test/unit/ai-assess.test.ts`
Expected: PASS

- [ ] **Step 4: 寫失敗的測試（破防軸與號誌）**

加到 `test/unit/ai-steer.test.ts`。幾何刻意設計成「攻擊者的升力與我的升力不
正交」，舊版（用我的升力）才會紅：

```ts
describe('異平面破防', () => {
  /** 破防軸：由滿力道的瞄準點反解 —— aim = cos(off)·los + sin(off)·axis */
  function breakAxisOf(aim: Vector3, los: Vector3, cfg = DEFAULT_STEER): Vector3 {
    return aim.clone()
      .addScaledVector(los, -Math.cos(cfg.defendOffset))
      .divideScalar(Math.sin(cfg.defendOffset))
      .normalize()
  }

  it('破防軸與攻擊者的升力向量近乎正交', () => {
    // 我平飛（升力朝上），攻擊者在正後方 300 m、繞自己的機首滾轉 45°。
    // 他的升力因此有 0.707 的鉛直分量 —— 舊版拿「我的升力」當軸，
    // |axis · 他的升力| ≈ 0.707，這條必然紅。
    const self = makeAircraftAt(new Vector3(0, 4000, 0))          // 機首 −Z、機翼水平
    const attacker = makeAircraftAt(new Vector3(0, 4000, 300))
    lookAt(attacker, self.state.position)                          // 機首 −Z 指向我
    rollAboutNose(attacker, 45 * (Math.PI / 180))

    const sit = createSituation()
    sit.threatLos.set(0, 0, 1)                                     // 由我指向他
    const defend = createDefendState()
    stepDefend(defend, self, attacker, 1, true, sit, 0)             // 滿力道、正在破防

    const out = makeCommand()
    steerCommand('defend', 'none', sit, basisOf(self, attacker), self, 0,
      { leadLag: 1, vertical: 0 }, defend, out)

    const axis = breakAxisOf(out.aimWorld, sit.threatLos)
    const attackerLift = new Vector3(0, 1, 0).applyQuaternion(attacker.state.orientation)
    expect(Math.abs(axis.dot(attackerLift))).toBeLessThan(0.2)
  })

  it('號誌在整段破防裡不變', () => {
    const self = makeAircraftAt(new Vector3(0, 4000, 0))
    const attacker = makeAircraftAt(new Vector3(0, 4000, 300))
    lookAt(attacker, self.state.position)
    const sit = createSituation()
    sit.threatLos.set(0, 0, 1)
    const defend = createDefendState()
    stepDefend(defend, self, attacker, 1, true, sit, 0)
    const first = defend.sign
    // 讓我自己滾轉 180°：舊的「每格由我的姿態重算」會翻號
    rollAboutNose(self, Math.PI)
    stepDefend(defend, self, attacker, 1, true, sit, 0)
    expect(defend.sign).toBe(first)
  })

  it('低於 defendFloor 時破防朝上', () => {
    const low = makeAircraftAt(new Vector3(0, 200, 0))
    const attacker = makeAircraftAt(new Vector3(0, 200, 300))
    lookAt(attacker, low.state.position)
    rollAboutNose(attacker, 45 * (Math.PI / 180))
    const sit = createSituation()
    sit.threatLos.set(0, 0, 1)
    const defend = createDefendState()
    stepDefend(defend, low, attacker, 1, true, sit, 0)

    const out = makeCommand()
    steerCommand('defend', 'none', sit, basisOf(low, attacker), low, 0,
      { leadLag: 1, vertical: 0 }, defend, out)
    expect(breakAxisOf(out.aimWorld, sit.threatLos).y).toBeGreaterThan(0)
  })
})
```

> `lookAt(a, p)`、`rollAboutNose(a, rad)`、`basisOf(a, b)` 若檔案裡沒有，就在
> 該 describe 上方寫成本地輔助（`setFromUnitVectors` 定機首、再乘上一個繞機首
> 軸的 `Quaternion.setFromAxisAngle`；`basisOf` = `createEngageBasis()` +
> `buildEngageBasis`）。

- [ ] **Step 5: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL —— `stepDefend` 的參數數量不符（TS2554），且 `defend.sign` 不存在。

- [ ] **Step 6: 加 `defendFloor` 設定**

`SteerConfig` 裡：

```ts
  /**
   * 破防選邊的離地高度門檻，m。高於它朝下破防（重力幫忙保速度），
   * 低於它朝上。
   *
   * **起始值，待實測回填。** 掃描範圍 300 / 600 / 1200，守著它的是安全層的
   * 介入率（`AiController.safetyActive` 的取樣比例）。
   */
  defendFloor: number
```

`DEFAULT_STEER` 加 `defendFloor: 600,`。

- [ ] **Step 7: 抽出 `breakAxis`，改寫 `defendAim`**

```ts
const D = makeScratch(3)

/**
 * 破防的繞轉軸（未定號誌）寫進 out，回傳 true。三段退化鏈：
 *
 *   1. 攻擊者的機體橫軸 —— 他的機動平面由速度與升力張成，法線就是橫軸。
 *      沿法線破防，他必須先滾轉換平面才跟得住，那個滾轉時間就是我脫離他
 *      預瞄解的時間。
 *   2. 我的升力向量（第一批的行為）
 *   3. 我的機體橫軸
 *
 * 【2 與 3 不可能同時退化】升力與橫軸恆正交，所以
 * `|升力⊥|² = 1 − a²`、`|橫軸⊥|² = 1 − b²`，而 `a² + b² ≤ 1`。
 * a 趨近 ±1 時 b 必然趨近 0，橫軸的垂直分量反而趨近滿額。
 *
 * 全部退化時回傳 false —— 呼叫端此時只能指著他（破防為零，但那是數學上
 * 到不了的浮點退路）。
 */
function breakAxis(
  self: Aircraft, attacker: Aircraft | null, threatLos: Vector3, out: Vector3,
): boolean {
  if (attacker !== null) {
    const his = D.v[1]!.set(1, 0, 0).applyQuaternion(attacker.state.orientation)
    if (perpendicular(his, threatLos, out) >= AXIS_EPSILON) return true
  }
  const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)
  if (perpendicular(lift, threatLos, out) >= AXIS_EPSILON) return true
  const mine = D.v[2]!.set(1, 0, 0).applyQuaternion(self.state.orientation)
  return perpendicular(mine, threatLos, out) >= AXIS_EPSILON
}

function defendAim(
  self: Aircraft, attacker: Aircraft | null, threatLos: Vector3,
  sign: number, out: Vector3, cfg: SteerConfig,
): void {
  const axis = D.v[0]!
  if (!breakAxis(self, attacker, threatLos, axis)) {
    out.copy(threatLos)
    return
  }
  const s = sign < 0 ? -1 : 1
  out.copy(threatLos).multiplyScalar(Math.cos(cfg.defendOffset))
    .addScaledVector(axis, s * Math.sin(cfg.defendOffset))
    .normalize()
}
```

保留 `defendAim` 原有的三段註解，把「首選升力」那一段改寫成上面 `breakAxis`
的說明，並加一句「軸取自**他**的平面而不是我的：拿我的平面破防等於照原本的
轉彎繼續拉，那正是他已經在跟的平面」。

- [ ] **Step 8: `DefendState` 加號誌，`stepDefend` 決定它**

```ts
export interface DefendState {
  /** 這一格的破防力道，0..1。0 = 與不閃躲時的瞄準點完全相同 */
  hardness: number
  /**
   * 破防繞轉軸的正負號，+1 或 −1。**進入 defend 時決定一次，整段不變。**
   *
   * 【為什麼要閂住】平面法線有正負兩側，都同樣「異平面」，選邊的判準
   * （朝下保速度 vs 低空朝上）是離散的。每格重算必然有一個切換面，跨過去
   * 瞄準點就瞬間跳 2×`defendOffset` —— 那是上一批剛治好的抖動的同一個病。
   * 真實的飛行員也是咬定一個破防方向，不會每 4 ms 重新推導。
   */
  sign: number
  /** 上一格是不是 defend。用來抓進入 defend 的上升緣 */
  active: boolean
  /** 上一格的攻擊者。換人視同新的一段，重新選邊 */
  attacker: Aircraft | null
}

export function createDefendState(): DefendState {
  return { hardness: 0, sign: 1, active: false, attacker: null }
}

export function stepDefend(
  state: DefendState,
  self: Aircraft,
  /** 威脅最大的那一架。null = 沒有威脅來源 */
  attacker: Aircraft | null,
  /** 持續跟蹤加權後的威脅 —— 必須與 rules.ts 的閂鎖吃的是同一個量 */
  threat: number,
  defending: boolean,
  sit: Situation,
  /** 該點的海面高度，m。破防選邊要算離地餘裕 */
  seaHeight: number,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  state.hardness = defendHardness(threat, cfg)

  if (defending && (!state.active || attacker !== state.attacker)) {
    const axis = D.v[0]!
    if (breakAxis(self, attacker, sit.threatLos, axis)) {
      const low = self.state.position.y - seaHeight <= cfg.defendFloor
      // 高空取朝下的那一側（重力幫忙保速度），低空取朝上
      state.sign = low ? (axis.y >= 0 ? 1 : -1) : (axis.y <= 0 ? 1 : -1)
    }
  }
  state.active = defending
  state.attacker = attacker
}
```

`steerCommand` 的 defend 分支改成
`defendAim(self, defend.attacker, sit.threatLos, defend.sign, brk, cfg)`。

- [ ] **Step 9: `AiController` 接線**

240 Hz 段改成：

```ts
    const src = this.threatSource
    const replaced = src !== null && src !== target && considerThreatFrom(self, src, this.sit)
    // 【攻擊者是誰】`considerThreatFrom` 有沒有取代現值，就決定了最大威脅
    // 是掃描到的那一架還是當前目標。重算一次 threatFactor 才問得出來的話，
    // 240 Hz 下就是白花的成本。
    const attacker = replaced ? src : target
```

`stepDefend` 的呼叫改成：

```ts
    stepDefend(
      this.defend, self, attacker, threat, this.intent === 'defend',
      this.sit, this.seaHeight,
    )
```

> 注意 `this.intent` 是**上一個決策節拍**的值。這是刻意的：`stepDefend` 在
> `if (decide)` 之前跑，而破防的號誌只在進入 defend 的那一格用得上，晚一個
> 物理步（4 ms）不影響。順序若要調整，必須確保 `stepDefend` 讀到的是同一格
> 的意圖，不得半新半舊。

- [ ] **Step 10: 修 Task 1 留下的呼叫端**

Task 1 寫的三條測試呼叫的是 `stepDefend(defend, threat)`，這一步之後參數變成
八個。逐一補齊：

```ts
stepDefend(defend, self, null, THREAT_EXIT_ANCHOR, false, sit, 0)
```

`attacker` 傳 `null`、`defending` 傳 `false`——那三條測的是力道，與破防軸和
號誌無關，維持它們的原意。

Run: `npm run typecheck`
Expected: PASS

Run: `npx vitest run test/unit/ai-steer.test.ts test/unit/ai-assess.test.ts`
Expected: PASS

- [ ] **Step 11: 量 `huntedShare` 並收緊門檻**

Run: `npx vitest run test/integration/ai-defence.test.ts`

把觀測值那一段印出的四個 `huntedShare` 記下來，與 Task 1 記的數字並列。
在 `ai-defence.test.ts` 裡：

1. 把 `expect(o.huntedShare).toBeLessThan(0.85)` 的 0.85 換成**實測最大值加
   0.03 的緩衝**（例如四組實測最大 0.62 → 門檻 0.65）。
2. 更新該斷言上方的註解：列出三組數字（第一批修補前／第一批之後／異平面之後）
   與新門檻的由來。
3. **若 `huntedShare` 沒有下降**：不得放寬門檻。把數字如實記進註解，並在
   commit message 與最終報告裡說明——spec §7 風險 1 已經預告了這個可能
   （攻擊者平飛時他的法線是水平的，破防因此也是水平的），下一個候選規則是
   「在他的法線與垂直面之間取加權」，那要另開一輪。

- [ ] **Step 12: 跑全套並 commit**

Run: `npm test`
Expected: PASS

```bash
git add src/ai/steer.ts src/ai/assess.ts src/ai/AiController.ts \
  test/unit/ai-steer.test.ts test/unit/ai-assess.test.ts \
  test/integration/ai-defence.test.ts
git commit -m "feat: 破防改繞攻擊者的機動平面，號誌整段閂住"
```

---

### Task 3: 反轉的偵測與瞄準（丙之一）

他衝過頭時破防讓位給對他的追擊。**這一步不碰目標選擇。**

**Files:**
- Modify: `src/ai/steer.ts`
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-steer.test.ts`, `test/integration/ai-defence.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `DefendState`、`stepDefend`、`breakAxis`
- Produces:
  - `DefendState` 新增 `reversal: number`、`reversalStarted: boolean`
  - `stepDefend` 簽名新增 `dt: number`（在 `seaHeight` 之後）
  - `steerCommand` 簽名新增 `attackerBasis: EngageBasis | null`（在 `defend` 之後）
  - `SteerConfig` 新增 `reversalRange`、`reversalAspect`、`reversalHold`

- [ ] **Step 1: 寫失敗的單元測試（反轉判定的三個條件）**

```ts
describe('衝過頭之後的反轉', () => {
  /** 攻擊者在我前半球、近距離、我正在破防 —— 三個條件都成立 */
  function overshootCase(): { self: Aircraft; attacker: Aircraft; sit: Situation } {
    const self = makeAircraftAt(new Vector3(0, 4000, 0))      // 速度朝 −Z
    const attacker = makeAircraftAt(new Vector3(0, 4000, -200))  // 已經跑到我前面
    lookAt(attacker, new Vector3(0, 4000, -2000))
    const sit = createSituation()
    sit.threatLos.set(0, 0, -1)
    return { self, attacker, sit }
  }

  it('三個條件都成立時觸發', () => {
    const { self, attacker, sit } = overshootCase()
    const d = createDefendState()
    stepDefend(d, self, attacker, 1, true, sit, 0, 1 / 240)
    expect(d.reversalStarted).toBe(true)
    expect(d.reversal).toBeGreaterThan(0)
  })

  it('沒在破防時不觸發', () => {
    const { self, attacker, sit } = overshootCase()
    const d = createDefendState()
    stepDefend(d, self, attacker, 1, false, sit, 0, 1 / 240)
    expect(d.reversalStarted).toBe(false)
  })

  it('他還在後半球時不觸發', () => {
    const { self, sit } = overshootCase()
    const behind = makeAircraftAt(new Vector3(0, 4000, 200))   // 還在我後面
    lookAt(behind, new Vector3(0, 4000, 0))
    const d = createDefendState()
    stepDefend(d, self, behind, 1, true, sit, 0, 1 / 240)
    expect(d.reversalStarted).toBe(false)
  })

  it('太遠時不觸發', () => {
    const { self, sit } = overshootCase()
    const far = makeAircraftAt(new Vector3(0, 4000, -2000))
    lookAt(far, new Vector3(0, 4000, -4000))
    const d = createDefendState()
    stepDefend(d, self, far, 1, true, sit, 0, 1 / 240)
    expect(d.reversalStarted).toBe(false)
  })

  it('倒數期間不重複觸發，倒完歸零', () => {
    const { self, attacker, sit } = overshootCase()
    const d = createDefendState()
    stepDefend(d, self, attacker, 1, true, sit, 0, 1 / 240)
    stepDefend(d, self, attacker, 1, true, sit, 0, 1 / 240)
    expect(d.reversalStarted).toBe(false)      // 上升緣只有一次
    expect(d.reversal).toBeGreaterThan(0)
    for (let i = 0; i < 240 * 10; i++) {
      stepDefend(d, self, attacker, 1, true, sit, 0, 1 / 240)
    }
    expect(d.reversal).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL —— `stepDefend` 參數數量不符，`reversal` / `reversalStarted` 不存在。

- [ ] **Step 3: 加三個設定欄位**

```ts
  /** 反轉：攻擊者距離的上限，m。**起始值，待實測回填**（掃 200 / 300 / 500） */
  reversalRange: number
  /**
   * 反轉：他必須落在我速度向量周圍的這個角內，rad。
   * **起始值，待實測回填**（掃 60° / 90° / 120°）
   */
  reversalAspect: number
  /** 反轉的持續秒數。**起始值，待實測回填**（掃 1 / 2 / 4） */
  reversalHold: number
```

`DEFAULT_STEER`：`reversalRange: 300, reversalAspect: 90 * (Math.PI / 180), reversalHold: 2,`

- [ ] **Step 4: 加 `overshot` 與倒數**

```ts
const R = makeScratch(2)

/**
 * 攻擊者有沒有衝過頭。
 *
 * 【為什麼「他跑到我前半球」就是衝過頭的定義】我硬破防而他跟得住時，視線
 * 一直留在後半球；他過頭了，視線才會掃到前面來。這比「接近率翻負」穩定
 * —— 後者在他減速跟上時也會翻負，那不是機會。
 *
 * 【角度由我的速度向量量，不是機首】破防中機首與航跡差得遠，而「我能不能
 * 轉過去咬他」問的是航跡。與 `turnTime` 同一個理由。
 */
function overshot(self: Aircraft, attacker: Aircraft, cfg: SteerConfig): boolean {
  const los = R.v[0]!.copy(attacker.state.position).sub(self.state.position)
  const range = los.length()
  if (range > cfg.reversalRange || range < 1e-3) return false
  los.divideScalar(range)

  const dir = R.v[1]!.copy(self.state.velocity)
  const speed = dir.length()
  if (speed > 1e-3) dir.divideScalar(speed)
  else dir.copy(FWD).applyQuaternion(self.state.orientation)

  return Math.acos(clampUnit(dir.dot(los))) < cfg.reversalAspect
}
```

`stepDefend` 尾端（`state.active = defending` 之前）加：

```ts
  state.reversalStarted = false
  if (state.reversal > 0) {
    state.reversal = state.reversal > dt ? state.reversal - dt : 0
  } else if (defending && attacker !== null && overshot(self, attacker, cfg)) {
    state.reversal = cfg.reversalHold
    state.reversalStarted = true
  }
```

`DefendState` 加：

```ts
  /**
   * 反轉剩餘秒數。> 0 時破防讓位給對攻擊者的追擊。
   *
   * 【為什麼是倒數而不是「條件持續成立」】反轉一旦開始就要做完 —— 拉進去
   * 的過程中他會短暫離開判定範圍，條件式的寫法會讓動作做一半就放棄。
   */
  reversal: number
  /** 這一格是不是反轉的上升緣。供呼叫端做一次性的動作 */
  reversalStarted: boolean
```

- [ ] **Step 5: `steerCommand` 的反轉分支**

簽名在 `defend` 之後加：

```ts
  /** 反轉時對**攻擊者**建的基準。`null` = 沒有攻擊者或不在反轉中 */
  attackerBasis: EngageBasis | null,
```

defend 分支最前面加：

```ts
      case 'defend': {
        if (defend.reversal > 0 && attackerBasis !== null) {
          // 【反轉是全力進攻，不套力道】破防的目的已經達成，現在要的是
          // 把他咬住。用純追擊（預瞄點）而不是 aimFromKnobs —— 後者吃的
          // `sit` 是對**當前目標**算的，套在攻擊者的基準上是張冠李戴。
          normalizeInto(attackerBasis.leadPoint, attackerBasis.losAxis, out.aimWorld)
          break
        }
        ...（Task 2 的混合）
      }
```

- [ ] **Step 6: `AiController` 接線**

加欄位：

```ts
  /** 反轉時對攻擊者建的基準。與 `basis` 分開 —— 那一組是對當前目標的 */
  private readonly attackerBasis = createEngageBasis()
```

`stepDefend` 呼叫加 `dt`；之後：

```ts
    // 【只在反轉中才建】buildEngageBasis 要解預瞄，240 Hz 下不該白算
    let attackerBasis: EngageBasis | null = null
    if (this.defend.reversal > 0 && attacker !== target) {
      buildEngageBasis(self, attacker, this.attackerBasis)
      attackerBasis = this.attackerBasis
    } else if (this.defend.reversal > 0) {
      attackerBasis = this.basis
    }
```

`steerCommand` 呼叫加上 `attackerBasis`。

**既有呼叫端**：Task 1 與 Task 2 寫的測試裡每一個 `steerCommand(...)` 都要補
第 9 個參數 `null`（那些測試都不在反轉中）。同樣地，那些測試裡的
`stepDefend(...)` 要補第 8 個參數 `dt`（傳 `1 / 240`）。

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: 跑單元測試**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS

- [ ] **Step 8: 寫失敗的整合測試（高接近率場景）**

`test/integration/ai-defence.test.ts`：`Outcome` 加兩個欄位，`scenario` 加參數。

```ts
interface Outcome {
  ...既有欄位...
  /** 反轉觸發次數 */
  reversals: number
  /** 反轉觸發後的 reversalHold 秒內，藍方對紅 B 有射擊解的取樣比例 */
  shotAfterReversal: number
}
```

`scenario(behind: Vector3, redTas = TAS)`：紅 B 以 `redTas` 起飛（`place` 多吃
一個速度參數，或在 `place` 之後改寫 `redB.state.velocity`）。取樣迴圈裡：

```ts
    if (blueAi.defend.reversalStarted) { reversals++; reversalUntil = t + REVERSAL_WINDOW }
    ...
    if (t < reversalUntil) { afterSamples++; if (threatFactor(blue, redB) > 0) afterShots++ }
```

新增場景與斷言：

```ts
/** 高接近率：紅 B 快 80 m/s，會衝過頭。給反轉用。 */
const OVERTAKE_CASES: { name: string; behind: Vector3 }[] = [
  { name: '高速追擊 正後方 700 m', behind: new Vector3(0, 0, 700) },
  { name: '高速追擊 後上方 700 m', behind: new Vector3(0, 200, 670) },
]

describe('攻擊者衝過頭時的反轉（紅 B 快 80 m/s）', () => {
  for (const c of OVERTAKE_CASES) {
    it(`${c.name}`, () => {
      const o = scenario(c.behind, TAS + 80)
      // 【修改前恆為 0】反轉這個概念在程式碼裡不存在
      expect(o.reversals).toBeGreaterThan(0)
      // 反轉之後要真的換到角度，否則它只是一個沒有產出的動作
      expect(o.shotAfterReversal).toBeGreaterThan(0)
    })
  }
})
```

- [ ] **Step 9: 跑測試確認是紅的**

Run: `npx vitest run test/integration/ai-defence.test.ts`
Expected: FAIL —— `reversals` 為 0。

**若在寫實作之前它就是綠的**，代表量錯了東西，停下來查，不要繼續。

- [ ] **Step 10: 讓它綠，並回填 `blueDamage` 的護欄**

實作已在 Step 3–6 完成，這一步是量測與回填：

1. 先在**未加反轉**的版本（`git stash push -q -- src/ai/steer.ts src/ai/AiController.ts`）
   跑一次新場景，記下兩組 `blueDamage`；`git stash pop -q` 還原。
   **不得用 `git checkout HEAD -- <file>`**，那會直接毀掉未提交的修改。
2. 加上斷言 `expect(o.blueDamage).toBeLessThanOrEqual(<修改前的實測值>)`，
   並把兩組數字寫進註解。

Run: `npx vitest run test/integration/ai-defence.test.ts`
Expected: PASS

- [ ] **Step 11: 跑全套並 commit**

Run: `npm test`
Expected: PASS

```bash
git add src/ai/steer.ts src/ai/AiController.ts \
  test/unit/ai-steer.test.ts test/integration/ai-defence.test.ts
git commit -m "feat: 攻擊者衝過頭時反轉，破防讓位給追擊"
```

---

### Task 4: 反轉的目標請求（丙之二）

讓反轉可以**放行一次**目標切換——解除遲滯，但不竄改分數。

**Files:**
- Modify: `src/ai/target.ts`
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-target.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `DefendState.reversalStarted`
- Produces: `TargetState` 新增 `urgent: number`（候選索引，−1 = 無）

- [ ] **Step 1: 寫失敗的測試**

`test/unit/ai-target.test.ts`。下面用到的 `twoEnemyBoard` / `otherEnemyIndex` /
`placeBetterTarget` / `placeWorseTarget` 若檔案裡沒有同名輔助，就照該檔既有的
建板方式寫成本地輔助——關鍵是「較好」要在**評分上**成立（更近、更正對著我、
身上沒有隊友），不是憑感覺擺位置。寫完先 `console.log` 兩邊的
`targetScore` 確認大小關係，再寫斷言。

```ts
describe('反轉的目標請求', () => {
  it('分數較高時略過最小停留直接換過去', () => {
    const board = twoEnemyBoard()          // 依檔案既有的建板輔助
    const state = createTargetState()
    selectTarget(state, board, 0, 0.1, DEFAULT_TARGET)
    const first = state.current
    const other = otherEnemyIndex(board, first)
    // dwell 還沒到，正常路徑換不動
    selectTarget(state, board, 0, 0.1, DEFAULT_TARGET)
    expect(state.current).toBe(first)

    // 把 other 做成分數明確較高的那一架（擺到近距離、正前方）
    placeBetterTarget(board, other)
    state.urgent = other
    selectTarget(state, board, 0, 0.1, DEFAULT_TARGET)
    expect(state.current).toBe(other)
    expect(state.urgent).toBe(-1)          // 一次性
    expect(state.dwell).toBe(DEFAULT_TARGET.minDwell)   // 換完不准馬上換回來
  })

  it('分數沒有比較高就不換', () => {
    const board = twoEnemyBoard()
    const state = createTargetState()
    selectTarget(state, board, 0, 0.1, DEFAULT_TARGET)
    const first = state.current
    const other = otherEnemyIndex(board, first)
    placeWorseTarget(board, other)
    state.urgent = other
    selectTarget(state, board, 0, 0.1, DEFAULT_TARGET)
    expect(state.current).toBe(first)
    expect(state.urgent).toBe(-1)          // 用過即失效，不會累積
  })
})
```

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: FAIL —— `TargetState` 沒有 `urgent`（TS2339）。

- [ ] **Step 3: 加 `urgent` 到 `TargetState`**

```ts
  /**
   * 一次性的目標請求：候選索引，−1 = 無。
   *
   * 【它解除遲滯，但不放水】反轉之後我想打的是剛剛衝過我的那一架，而
   * `minDwell` 與 `switchMargin` 會把那個機會擋掉。這個欄位讓那一次切換
   * **略過遲滯**，但仍然要求它的分數**高於現任** —— 分數給不了高分就代表
   * 這不是一個真的機會。
   *
   * 【為什麼不直接改 target】把「誰在打我」與「誰最好打」綁在一起，就是
   * A→B→A 猶豫的來源（見 `AiController.threatSource` 的註解）。這裡放行的
   * 是**一次**，不是一條長期規則。
   */
  urgent: number
```

`createTargetState` 回傳 `{ current: -1, dwell: 0, urgent: -1 }`。

- [ ] **Step 4: `selectTarget` honour `urgent`**

在既有的決策段（`if (state.current < 0) … else if (state.dwell <= 0 …)`）之前
插入，並在其後把 `urgent` 歸 −1：

```ts
  const urgent = state.urgent
  state.urgent = -1

  if (state.current < 0) {
    state.current = bestIndex
    state.dwell = cfg.minDwell
  } else if (urgent >= 0 && urgent !== state.current) {
    // 【略過遲滯，但不略過評分】
    const u = candidates[urgent]
    if (u !== undefined && u.alive && u.team !== self.team) {
      const uScore = targetScore(
        self.aircraft, u.aircraft, countLocks(board, self.team, selfIndex, urgent), cfg,
      )
      const cur = candidates[state.current]!
      const curScore = targetScore(
        self.aircraft, cur.aircraft,
        countLocks(board, self.team, selfIndex, state.current), cfg,
      )
      if (uScore > curScore) {
        state.current = urgent
        state.dwell = cfg.minDwell
      }
    }
  } else if (state.dwell <= 0 && bestIndex !== state.current) {
    ...既有的 switchMargin 判斷...
  }
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: PASS

- [ ] **Step 6: `AiController` 接線**

`update` 裡，`stepDefend` 之後：

```ts
    // 【只在上升緣寫一次】反轉開始的那一格請求切換到攻擊者。持續寫會變成
    // 「反轉期間每個決策節拍都在請求」，那就不是一次性放行了。
    if (this.defend.reversalStarted && this.board !== null && attacker !== target) {
      this.targetState.urgent = this.indexOf(attacker)
    }
```

加私有方法（線性掃描，只在反轉的上升緣呼叫，不在熱路徑）：

```ts
  private indexOf(a: Aircraft): number {
    const board = this.board
    if (board === null) return -1
    const cs = board.candidates
    for (let i = 0; i < cs.length; i++) if (cs[i]!.aircraft === a) return i
    return -1
  }
```

> 僚機走 `selectWingmanTarget`，不吃 `urgent`——它的第一級「自衛」本來就掃
> 全場挑正在打我的那一架。反轉的**瞄準**對長機僚機一視同仁，只有**目標請求**
> 限定在自由獵手這條路徑。

- [ ] **Step 7: 猶豫的護欄（spec §6.4 的事前約定）**

這一步是**量測**，不是斷言。

1. `git stash push -q -- src/ai/target.ts src/ai/AiController.ts`，在
   `test/integration/multi-battle.test.ts` 的公平對照組上跑一次，記下長機的
   換目標次數與「換走又換回來」次數。`git stash pop -q` 還原後再跑一次。
   （若該檔目前沒有輸出這兩個量，臨時加一段 `console.log` 觀測，量完移除；
   不要留下一條混沌量的斷言。）
2. **事前約定的決策規則**：若「換回來」次數比修改前上升超過 **25%**，
   把 Step 6 的接線移除（保留 Task 3 的反轉瞄準），並把數據寫進 `target.ts`
   的 `urgent` 註解裡當作否決紀錄。**這條規則在看到數字之前就已經定好，
   不得事後調整。**
3. 無論結果如何，把兩組數字寫進 `urgent` 的註解。

- [ ] **Step 8: 跑全套並 commit**

Run: `npm test`
Expected: PASS

```bash
git add src/ai/target.ts src/ai/AiController.ts test/unit/ai-target.test.ts
git commit -m "feat: 反轉可以放行一次目標切換（分數仍須較高）"
```

---

### Task 5: 參數回填

五個新參數目前都是起始值。專案的規矩是先跑再定。

**Files:**
- Modify: `src/ai/steer.ts`（只改 `DEFAULT_STEER` 的值與註解裡的掃描表）

- [ ] **Step 1: 建立掃描腳本**

在 `$CLAUDE_JOB_DIR/tmp` 底下寫一支一次性的 vitest 檔（**不進版控**），對每個
參數逐一掃描，每組設定跑 `ai-defence.test.ts` 的六個場景（四個既有 + 兩個高
接近率），輸出 `huntedShare`、`blueDamage`、`dealtToA`、`reversals`、
`shotAfterReversal`、安全層介入率。

掃描順序與範圍（spec §5）：

| 參數 | 掃描值 | 判準 |
|---|---|---|
| `defendHardThreat` | 0.5 / 0.7 / 0.85 / 1.0 | `blueDamage` 低且 `dealtToA` 不掉 |
| `defendFloor` | 300 / 600 / 1200 | 安全層介入率不升 |
| `reversalRange` | 200 / 300 / 500 | `reversals` 與 `shotAfterReversal` |
| `reversalAspect` | 60° / 90° / 120° | 同上 |
| `reversalHold` | 1 / 2 / 4 | 同上 + 換目標次數 |

- [ ] **Step 2: 跑掃描**

跑之前先確認**沒有殘留的 vite dev server（port 5173），也沒有在跑遊戲的
瀏覽器分頁**——那會讓量測失真。

- [ ] **Step 3: 判讀**

**混沌敏感的判準**：若某個值的相鄰兩格方向相反（例如 −3932 / +3860 / +68），
那是軌跡分岔的巧合，不是最佳點。這種情況維持起始值，並把掃描表與「這一軸
沒有給出訊號」如實寫進註解——上一批的「射程內控速」就是這樣被否決的，那筆
紀錄留在 `DEFAULT_STEER` 的註解裡防止有人再試一次。

- [ ] **Step 4: 回填並記錄**

把選定值寫進 `DEFAULT_STEER`，把掃描表寫進各欄位的註解（格式比照
`unloadMargin` 與 `cornerEnter` 既有的表）。**沒有訊號的參數要明講「這一項的
量測沒有給出強訊號」**，不要編一個事後理由。

- [ ] **Step 5: 跑全套並 commit**

Run: `npm test`
Expected: PASS

```bash
git add src/ai/steer.ts
git commit -m "tune: 回填第二批防禦機動的五個參數"
```

---

## 完成後

- 人工驗收：`I` 模式看一輪，確認（1）被咬時會往對方轉彎平面外破防，不是繼續
  照原本的彎拉；（2）威脅小的時候只是輕微擺動，不是每次都滿舵；（3）對方衝
  過頭之後會反過來咬他，而不是繼續往外飛。
- 這一批**沒有**處理的事，留在 spec §8：不寫死剪刀、不碰 `defendLatch` 門檻、
  不處理 defend 出口在「威脅來源 ≠ 當前目標」時的瞄準點跳變。
- 尚未收斂的舊議題：20v20 的 A→B→A 猶豫（188 vs 88）。Task 4 Step 7 會量到它
  有沒有被反轉影響，但**它的主因仍未查明**，不在這一批的範圍內。
