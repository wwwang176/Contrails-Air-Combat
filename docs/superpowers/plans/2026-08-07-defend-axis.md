# 破防軸改動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `defendAim` 的破防軸由「飛機自身的升力向量」換成「世界水平面內垂直於威脅視線、再往上抬 20°」，讓閃躲成為一個持續、看得見、且不掉高度的硬彎。

**Architecture:** 只改 `src/ai/steer.ts` 一個私有函式 `defendAim` 的軸取法，加上 `DefendState` 一個新欄位（進入破防時決定一次的左右號誌）與 `SteerConfig` 一個新參數（抬角）。判準層改寫 `test/integration/ai-visible-evasion.test.ts` 的主判準 —— 現行的「絕對位移 ≥ 5°」擋不住任何東西，換成「新軸 vs 現行軸」的同場景比值。

**Tech Stack:** TypeScript（無 `@types/node`）、three.js 的 `Vector3`、vitest。

## Global Constraints

以下每一條都直接抄自 spec 或專案的既有規矩，**每個任務都隱含適用**：

- `defendOffset`（75°）**不動**。這一份只改「軸」，不改「幅度」——幅度已三度被證明在 `aimWorld` 介面下表達不出來。
- `src/ai/` 的熱路徑**不得配置記憶體**。新向量一律走檔案既有的 `makeScratch` 暫存池。
- 專案**沒有** `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態：陣列索引後必須 `!` 或做 undefined 檢查。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`（本計畫不觸及，列出以免誤觸）。
- **絕不為了讓測試變綠而放寬門檻。** 紅了先查根因；若斷言本身錯了，改斷言並在註解裡寫清楚為什麼。
- 每一條新測試**必須先驗證它是紅的**才寫實作。
- 型別檢查指令是 `npx tsc --noEmit`（**沒有** `npm run typecheck` 這個 script）。
- 效能閘門（`test/unit/perf-gate.test.ts`）與 `test/integration/rematch.test.ts` 在全套並行下會假紅，**必須單獨複測**。
- 跑效能測試前先確認沒有殘留的 vite dev server、也沒有開著遊戲的瀏覽器分頁。
- **不寫飛機外形的測試。**
- commit 一律用明確路徑，**絕對不要 `git add -A`**（`bash.exe.stackdump` 是已追蹤且已被修改的檔案）。
- commit 訊息含中文時，先用 Write 工具寫到 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`。**不要**用 PowerShell here-string 語法混進 Bash。
- 護欄重新定值（§6 受波及的既有測試）是**專案負責人的決定**，不是實作者的。紅了要先量、先報告、先問。

## File Structure

| 檔案 | 責任 | 本計畫的改動 |
|------|------|------|
| `src/ai/steer.ts` | 意圖 → 轉向指令。破防的瞄準點在 `defendAim` | `DefendState` 加 `axisSign`；`SteerConfig` 加 `defendTilt`；`defendAim` 換軸；`stepDefend` 維護號誌 |
| `test/unit/ai-steer.test.ts` | `steer.ts` 的單元測試 | 新增破防軸的幾何斷言 |
| `test/integration/ai-visible-evasion.test.ts` | 「玩家看得出 AI 在閃」這一層的判準 | 主判準由絕對值改成同場景比值 |
| `docs/superpowers/specs/2026-08-07-defend-axis-design.md` | 設計文件 | 實作後回填實測值 |

`defendAim` 是 `steer.ts` 的私有函式（非 export），只有 `steerCommand` 一個呼叫點。Task 1 會把它 export 出來供單元測試直接驗幾何 —— 這比透過整場模擬去反推軸方向可靠得多。

---

### Task 1: 破防軸換成「水平面抬 20°」，含左右號誌

**Files:**
- Modify: `src/ai/steer.ts`
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: 檔案既有的 `perpendicular(v, axis, out): number`、`AXIS_EPSILON = 0.15`、`const D = makeScratch(3)`、`UP`、`FWD`
- Produces:
  - `export interface DefendState { reversal: number; attacker: Aircraft | null; axisSign: number }`
  - `export function createDefendState(): DefendState` 回傳 `{ reversal: 0, attacker: null, axisSign: 0 }`
  - `SteerConfig` 新欄位 `defendTilt: number`（rad），`DEFAULT_STEER.defendTilt = 20 * (Math.PI / 180)`
  - `export function defendAim(self: Aircraft, threatLos: Vector3, sign: number, out: Vector3, cfg?: SteerConfig): void` —— 由私有改為 export，並多收一個 `sign` 參數

- [ ] **Step 1: 先讀懂現況**

讀 `src/ai/steer.ts` 的這幾個位置，不要改：
- `perpendicular`（約 56 行）與 `AXIS_EPSILON`（約 64 行）
- `DefendState` / `createDefendState`（約 112–124 行）
- `stepDefend`（約 148 行起）
- `defendAim`（約 1100 行起，`const D = makeScratch(3)` 在它上面）
- `DEFAULT_STEER`（約 659 行起）與 `defendOffset` 的欄位宣告（約 284 行）

`makeScratch(n)` 回傳 `{ v: Vector3[], q: Quaternion[] }`。`D.v[0]`、`D.v[1]`、`D.v[2]` 目前被 `defendAim`、`reversalAim`、`stepDefend` 共用。本任務需要第 4 個暫存向量，所以要把 `makeScratch(3)` 改成 `makeScratch(4)`。

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/ai-steer.test.ts` 檔案最後加一個新的 describe 區塊。若該檔尚未 import `defendAim`、`DEFAULT_STEER`、`DEG`，一併加上。

**注意**：`DEG = π/180`、`RAD = 180/π`，兩者在 `src/core/math.ts`。要把度數轉成弧度是 `× DEG`，寫成 `× RAD` 會得到 229 弧度這種荒謬值。

```ts
describe('破防軸：世界水平面往上抬', () => {
  /** 造一架在原點、機首朝 −Z、機翼水平的飛機 */
  function level(): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    return a
  }

  it('軸落在水平面內、再往上抬 defendTilt', () => {
    const self = level()
    // 威脅在正後方：視線 +Z
    const los = new Vector3(0, 0, 1)
    const out = new Vector3()
    defendAim(self, los, 1, out)

    // out = los·cos(75°) + axis·sin(75°)，所以 axis 可以解回來
    const axis = out.clone()
      .addScaledVector(los, -Math.cos(DEFAULT_STEER.defendOffset))
      .divideScalar(Math.sin(DEFAULT_STEER.defendOffset))
      .normalize()

    // 抬角 = axis 與水平面的夾角
    const tilt = Math.asin(axis.y)
    expect(tilt).toBeCloseTo(DEFAULT_STEER.defendTilt, 6)
    // 水平分量必須垂直於視線（視線是 ±Z，所以水平分量必須純 X）
    expect(Math.abs(axis.z)).toBeLessThan(1e-6)
    expect(Math.abs(axis.x)).toBeGreaterThan(0.5)
  })

  it('sign 只翻水平分量，抬角永遠朝天', () => {
    const self = level()
    const los = new Vector3(0, 0, 1)
    const plus = new Vector3()
    const minus = new Vector3()
    defendAim(self, los, 1, plus)
    defendAim(self, los, -1, minus)

    const axisOf = (v: Vector3): Vector3 => v.clone()
      .addScaledVector(los, -Math.cos(DEFAULT_STEER.defendOffset))
      .divideScalar(Math.sin(DEFAULT_STEER.defendOffset))
      .normalize()
    const a = axisOf(plus)
    const b = axisOf(minus)

    // 水平分量相反
    expect(b.x).toBeCloseTo(-a.x, 6)
    // 鉛直分量相同，而且都朝上
    expect(b.y).toBeCloseTo(a.y, 6)
    expect(a.y).toBeGreaterThan(0)
  })

  it('視線鉛直時退化回自身升力，不指向威脅', () => {
    const self = level()
    // 威脅在正上方：視線 +Y，UP × los 退化
    const los = new Vector3(0, 1, 0)
    const out = new Vector3()
    defendAim(self, los, 1, out)
    // 不得指著他
    expect(out.dot(los)).toBeLessThan(0.5)
    expect(out.length()).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-steer.test.ts
```

預期：編譯失敗，`defendAim` 不是 export、`DEFAULT_STEER.defendTilt` 不存在。

- [ ] **Step 4: 加 `defendTilt` 到 `SteerConfig`**

在 `SteerConfig` 的 `defendOffset` 欄位**正下方**插入：

```ts
  /**
   * 破防軸往上抬的角度，rad。
   *
   * 【為什麼需要它】破防軸取世界水平面之後，75° 坡度的水平大彎會自然掉
   * 高度 —— 那個坡度要 3.9 G 才維持水平，低速時做不到。抬角把它抵消。
   *
   * 【20° 是掃出來的，不是估的】出貨飛行模型、800 m 尾追、90 秒：
   *
   * ```
   * 抬角     位移    瞄準誤差   打得中    最低高度   收尾TAS
   * 不閃     0.9°     0.0°    100.0%     4000      146
   * 現行     1.8°     0.6°     77.1%     4000       84
   *   0°    20.0°    47.5°      2.0%     2287      162   ← 掉 1713 m
   *  10°    16.4°    63.1°      6.8%     3969      133
   *  20°    11.5°    55.4°      2.4%     4000      123   ← 選定
   *  30°     9.6°    56.7°      3.2%     4000      122
   *  40°     9.1°    55.3°      8.3%     4000      127
   *  50°     9.5°    54.6°      7.0%     4000      145
   * ```
   *
   * 20° 是「打得中」的最低點，也是高度損失歸零的第一個值。橫越與對頭同向。
   *
   * 【低空不需要額外規則】3000 / 1500 / 800 m 三個開局高度，抬 20° 的最低
   * 高度都**等於開局高度**。反而是舊的升力軸在 800 m 開局時自己掉了 498 m。
   * 原本規劃的「離地餘裕小就再抬高一點」因此沒有實測依據，不做。
   *
   * 【重試的前提】這一項依賴當前的升力係數與過載能力，不是幾何恆等式。
   * `specs/feel.ts` 的 `lift` 或 `oswald` 大幅調動之後要重掃。
   */
  defendTilt: number
```

在 `DEFAULT_STEER` 裡 `defendOffset` 那一行**正下方**加：

```ts
  defendTilt: 20 * (Math.PI / 180),
```

- [ ] **Step 5: `DefendState` 加號誌欄位**

把 `DefendState` 改成：

```ts
export interface DefendState {
  /** 反轉倒數的剩餘秒數。> 0 = 正在反轉 */
  reversal: number
  /**
   * 觸發那一刻的攻擊者。換人時取消 —— 對著別人做到一半的反轉沒有意義，
   * 而且瞄準點會指向一架已經不相干的飛機。
   */
  attacker: Aircraft | null
  /**
   * 破防軸的左右號誌，+1 / −1。**0 = 尚未決定**。
   *
   * 【為什麼要跨格記住】`UP × threatLos` 有 ±兩側，兩側同樣「橫向破防」。
   * 每一格重算必然存在一個切換面，跨過去就是瞄準點瞬間跳 2×75° —— 那是
   * 這個專案 2026-08-05 才治好的抖動的同一個病。進入破防時決定一次、
   * 整段不變。攻擊者換人或離開破防時歸零，下次重新決定。
   */
  axisSign: number
}
```

`createDefendState` 跟著改：

```ts
export function createDefendState(): DefendState {
  return { reversal: 0, attacker: null, axisSign: 0 }
}
```

- [ ] **Step 6: 換 `defendAim` 的軸**

把 `const D = makeScratch(3)` 改成 `const D = makeScratch(4)`。

`defendAim` 整個換掉（保留原本的函式說明開頭，把「退化」那幾段重寫）：

```ts
/**
 * 破防：由**威脅來源**的視線轉開一個大角度。
 *
 * 目的是**破壞他的預瞄解**，不是逃跑——逃跑會把尾巴一直送給他。
 *
 * 【對準的是威脅來源，不是當前目標，2026-08-05】舊版吃 `EngageBasis`，
 * 而那是對**當前目標**建的。實測 20v20：長機被鎖定時，97.8% 的鎖定來自
 * 不是它目標的敵機 —— 拿目標的視線去破防，破的是錯的人。改吃
 * `Situation.threatLos`（由 AiController 掃全場填）。
 *
 * 【轉開的角度相對視線量，不是相對機首的增量】所以它是一個固定的幾何目標，
 * 轉彎中不會像舊的 `unloadAim` 那樣每格滾雪球。
 *
 * ## 破防軸：世界水平面抬 `defendTilt`（2026-08-07）
 *
 * 【舊版錯在哪】軸取自**飛機自己的升力向量**，而升力向量跟著滾轉走。
 * 飛機一開始破防就會滾，滾了之後軸轉到別的地方 —— 破防因此不是一個持續
 * 的硬彎，是一個**方向一直飄的螺旋**。實測破防期間坡度常駐 ±150~180°
 * （倒飛）。三個後果同時發生：視覺上跟「不閃」幾乎沒差別（1.8° 對 0.9°）、
 * 破壞不掉射擊解（玩家 77.1% 的時間仍打得中）、能量被榨乾（收尾 TAS 84）。
 *
 * 【新軸】`UP × threatLos` 正規化後往上抬 `defendTilt`。世界水平面不跟著
 * 飛機滾，所以破防維持在同一個平面上。同場景實測：位移 11.5°、玩家打得中
 * 2.4%、最低高度零損失、收尾 TAS 123。
 *
 * 【退化】`threatLos` 平行於世界鉛直時 `UP × threatLos` 趨近 0。此時退回
 * 舊的升力軸 —— 那個退化路徑本身是對的（升力與視線平行時再退到機體橫軸，
 * 兩者恆正交所以不可能同時退化，證明見下）。
 *
 * `|升力⊥|² = 1 − a²`、`|橫軸⊥|² = 1 − b²`，而 `a² + b² ≤ 1`（a、b 是兩者
 * 與視線的餘弦）。`a` 趨近 ±1 時 `b` 必然趨近 0，橫軸的垂直分量反而趨近
 * 滿額。永遠有一側可選。
 *
 * @param sign 左右號誌 +1 / −1，由 `stepDefend` 在進入破防時決定一次。
 *             0 視同 +1（呼叫端不該傳 0，但傳了也要有定義的行為）。
 */
export function defendAim(
  self: Aircraft,
  threatLos: Vector3,
  sign: number,
  out: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  const axis = D.v[0]!
  const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)

  // ── 首選：世界水平面內、垂直於視線 ──────────────────
  const horiz = D.v[3]!.copy(UP).cross(threatLos)
  if (horiz.length() >= AXIS_EPSILON) {
    horiz.normalize()
    if (sign < 0) horiz.multiplyScalar(-1)
    // 視線垂面內指天的方向。抬角在定號**之後**才套，所以永遠朝天
    const up = D.v[2]!.copy(UP).addScaledVector(threatLos, -UP.dot(threatLos))
    const upLen = up.length()
    if (upLen > 1e-6) {
      up.divideScalar(upLen)
      axis.copy(horiz).multiplyScalar(Math.cos(cfg.defendTilt))
        .addScaledVector(up, Math.sin(cfg.defendTilt))
    } else {
      axis.copy(horiz)
    }
  } else if (perpendicular(lift, threatLos, axis) < AXIS_EPSILON) {
    // 視線鉛直 **且** 升力平行視線 —— 此時機體橫軸必然垂直於視線
    const right = D.v[2]!.set(1, 0, 0).applyQuaternion(self.state.orientation)
    if (perpendicular(right, threatLos, axis) < AXIS_EPSILON) {
      // 數學上到不了，但浮點世界留一條退路：任何非平行的方向都比「指著他」好
      out.copy(threatLos)
      return
    }
  }

  out.copy(threatLos).multiplyScalar(Math.cos(cfg.defendOffset))
    .addScaledVector(axis, Math.sin(cfg.defendOffset))
    .normalize()
}
```

**注意 `perpendicular` 的回傳值語意**：它回傳的是**投影前的原始模長**，
不是投影後的。上面沿用既有寫法（原碼就是這樣判的），不要「順手修正」。

- [ ] **Step 7: 跑測試，確認它綠**

```
npx vitest run test/unit/ai-steer.test.ts
npx tsc --noEmit
```

`tsc` 此時會在 `steerCommand` 的呼叫點報錯（少一個參數）—— 那是 Task 2 的事，
本步驟只要求新的 describe 區塊三條綠。若要先讓 `tsc` 過，可以暫時在呼叫點
傳 `1`，Task 2 會改成真正的號誌。

- [ ] **Step 8: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
```

commit 訊息（含中文，走檔案）：

```
feat: 破防軸由自身升力向量改為世界水平面抬 20°

升力向量跟著滾轉走，所以舊的破防是一個方向一直飄的螺旋 ——
視覺上跟「不閃」幾乎沒差別（1.8° 對 0.9°）、玩家 77.1% 的時間
仍打得中、收尾速度被榨到 84 m/s。

世界水平面不跟著飛機滾。抬 20° 是掃出來的：純水平會掉 1713 m，
抬 20° 高度零損失，而且是「打得中」的最低點。

DefendState 加 axisSign（進入破防時決定一次的左右號誌），
理由與異平面那次相同 —— 每格重算會在切換面讓瞄準點跳 2×75°。
```

---

### Task 2: 號誌的生命週期接到 `stepDefend`

**Files:**
- Modify: `src/ai/steer.ts`
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DefendState.axisSign`、`defendAim(self, threatLos, sign, out, cfg)`
- Produces: `stepDefend` 在進入破防的那一格寫入 `state.axisSign`；離開破防或換攻擊者時歸零。`steerCommand` 傳 `defend.axisSign` 給 `defendAim`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-steer.test.ts` 加：

```ts
describe('破防軸號誌的生命週期', () => {
  function pair(): { self: Aircraft; foe: Aircraft } {
    const self = new Aircraft(P51D, 4000, 200)
    self.state.position.set(0, 4000, 0)
    self.state.velocity.set(0, 0, -200)
    self.state.orientation.identity()
    const foe = new Aircraft(P51D, 4000, 200)
    foe.state.position.set(0, 4000, 800)
    foe.state.velocity.set(0, 0, -200)
    foe.state.orientation.identity()
    return { self, foe }
  }

  it('進入破防時決定一次，之後不再變', () => {
    const { self, foe } = pair()
    const st = createDefendState()
    expect(st.axisSign).toBe(0)

    stepDefend(st, self, foe, true, 1 / 240)
    const first = st.axisSign
    expect(first === 1 || first === -1).toBe(true)

    // 把飛機滾成倒飛：升力向量翻過去了，但號誌不該動
    self.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)
    for (let i = 0; i < 240; i++) stepDefend(st, self, foe, true, 1 / 240)
    expect(st.axisSign).toBe(first)
  })

  it('離開破防就歸零，下次重新決定', () => {
    const { self, foe } = pair()
    const st = createDefendState()
    stepDefend(st, self, foe, true, 1 / 240)
    expect(st.axisSign).not.toBe(0)
    stepDefend(st, self, foe, false, 1 / 240)
    expect(st.axisSign).toBe(0)
  })

  it('攻擊者換人就歸零', () => {
    const { self, foe } = pair()
    const other = new Aircraft(P51D, 4000, 200)
    other.state.position.set(500, 4000, 800)
    other.state.velocity.set(0, 0, -200)
    other.state.orientation.identity()

    const st = createDefendState()
    stepDefend(st, self, foe, true, 1 / 240)
    const first = st.axisSign
    expect(first).not.toBe(0)
    stepDefend(st, self, other, true, 1 / 240)
    // 換人之後仍然在破防，所以會立刻重新決定 —— 但不得沿用舊的號誌狀態，
    // 判斷依據是「它是針對 other 的幾何算出來的」
    expect(st.attacker).toBe(other)
    expect(st.axisSign === 1 || st.axisSign === -1).toBe(true)
  })
})
```

檔案頂端若尚未 import `createDefendState`、`stepDefend`、`Vector3`，一併加上。

- [ ] **Step 2: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-steer.test.ts -t "破防軸號誌"
```

預期：第一條就失敗，`st.axisSign` 在 `stepDefend` 之後仍是 0。

- [ ] **Step 3: 在 `stepDefend` 維護號誌**

在 `stepDefend` 現有的 `state.attacker = attacker` 那一行**之後**、
`if (!defending || attacker === null) return` 之前，插入號誌邏輯。改成：

```ts
  // ── 破防軸的左右號誌（進入時決定一次）──────────────
  // 【為什麼寫在這裡而不是 defendAim 裡】defendAim 是純函數、每格被呼叫，
  // 它沒有「這是不是第一格」的資訊。號誌是跨格狀態，必須由持有狀態的這一層
  // 決定（與 reversal 同一個理由）。
  if (!defending || attacker === null) {
    state.attacker = attacker
    state.axisSign = 0
    return
  }
  if (attacker !== state.attacker) state.axisSign = 0
  state.attacker = attacker
  if (state.axisSign === 0) {
    // 取與當下升力同側 —— 進入破防時轉場最小
    const los = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
    const r = los.length()
    if (r > 1e-3) {
      los.divideScalar(r)
      const h = D.v[2]!.copy(UP).cross(los)
      if (h.lengthSq() > 1e-12) {
        h.normalize()
        const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)
        state.axisSign = h.dot(lift) >= 0 ? 1 : -1
      } else state.axisSign = 1
    } else state.axisSign = 1
  }
```

並把原本那兩行刪掉：

```ts
  state.attacker = attacker
  if (!defending || attacker === null) return
```

**注意暫存向量的重複使用**：號誌這段用了 `D.v[0]`、`D.v[1]`、`D.v[2]`，
而下面的反轉偵測也用 `D.v[0]`（`los`）與 `D.v[1]`（`vel`）。號誌算完就不再
需要那些值，反轉那段會重新 `copy`，所以安全。**不要**把號誌那段挪到反轉
偵測中間。

- [ ] **Step 4: `steerCommand` 傳號誌**

找到 `steerCommand` 裡的 `case 'defend':`，把

```ts
          defendAim(self, sit.threatLos, out.aimWorld, cfg)
```

改成

```ts
          defendAim(self, sit.threatLos, defend.axisSign, out.aimWorld, cfg)
```

- [ ] **Step 5: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-steer.test.ts
npx tsc --noEmit
```

預期：新的三條綠，`tsc` 無輸出。

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
```

訊息：

```
feat: 破防軸的左右號誌在進入破防時決定一次

號誌由 stepDefend 維護（與 reversal 同一層，defendAim 是純函數、
拿不到「這是不是第一格」）。離開破防或換攻擊者時歸零。

取與當下升力同側，理由是進入破防時轉場最小。
```

---

### Task 3: 主判準換成同場景比值

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: Task 1–2 的新破防行為
- Produces: 一支能在同一場景下跑「現行軸」與「新軸」的量測，斷言寫成比值

- [ ] **Step 1: 讀懂現行測試的形狀**

`test/integration/ai-visible-evasion.test.ts` 目前的結構：
- `Sniper`（腳本射手，壓在預瞄點上連續開火、用油門維持 `standoff`）
- `Lazy`（腳本獵物，0.05 rad/s 水平盤旋，把受測 AI 的注意力佔住）
- `measure(standoff)` → `{ underFire, coverage, defendMedian, ordinaryMedian, straightness }`
- 現行斷言在 281 / 290 / 297 / 303 行

**現行的主判準 `defendMedian ≥ 5` 是壞的**，這一步要把它換掉。原因寫在
spec §5.1：完全不閃的基準線是 0.9°，而 AI 平常追擊就有 6~11° —— 及格線訂在
一個連不閃都快通過、而平常機動一定通過的位置。

- [ ] **Step 2: 讓 `Sniper` 回報瞄準誤差**

在 `Sniper` 類別加一個公開欄位與一個暫存向量，並在 `update` 結尾計算：

```ts
class Sniper implements Controller {
  target: Aircraft | null = null
  standoff = 900
  /** 這一格機頭離預瞄點差幾度 —— 就是玩家打不中的量 */
  aimError = 0
  private readonly nose = new Vector3()
  private readonly basis = createEngageBasis()
  // …既有的 update 內容不動，在設定 out.aimWorld 之後加：
  //   this.nose.copy(FWD).applyQuaternion(self.state.orientation)
  //   this.aimError = this.nose.angleTo(out.aimWorld) * RAD
}
```

`aimError` 必須在 `out.aimWorld` **已經被寫好之後**才算。`Sniper` 的
`update` 有一個 `if (!t)` 的早退分支，該分支把 `aimWorld` 設成機首方向，
所以誤差是 0 —— 那一格沒有目標，量測端本來就不會取樣，不必特別處理。

- [ ] **Step 3: `measure` 多回傳三個量**

在 `Result` 介面加：

```ts
  /** 破防期間，射手機頭落在預瞄點 2° 錐內的時間佔比 —— 玩家真的打得中的時間 */
  defendHitShare: number
  /** 腳本直飛的基準線：同場景下不閃時的 1 秒位移中位數，度 */
  straightMedian: number
  /** 視覺對比 = defendMedian ÷ straightMedian */
  contrast: number
```

`straightMedian` 需要一個**不閃的對照場景**。在 `measure` 之外新增一個
`measureStraight(standoff)`：它與 `measure` 完全相同，只把受測 AI 換成一個
腳本直飛控制器：

```ts
/** 腳本直飛：沿著自身速度向量飛，完全不閃。視覺對比的基準線 */
class Straight implements Controller {
  update(self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(self.state.velocity).normalize()
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
  }
}
```

**為什麼不能用 `ordinaryMedian` 當基準線**：那是 AI **非破防期間**的位移，
被 AI 自己的追擊大彎污染（6~11°）—— 正是舊判準壞掉的原因。基準線必須是
「完全不動作」的那一條（0.7~0.9°）。

在 `measure` 的取樣迴圈裡，`if (isDefending)` 那一支加上：

```ts
        if (sniper.aimError < 2) defendHits++
        defendSamples++
```

回傳時 `defendHitShare = defendHits / Math.max(1, defendSamples)`。

- [ ] **Step 4: 加腳本破防者，同場景跑兩種軸**

門檻要寫成「新軸 vs 舊軸」的比值，所以測試裡必須同時跑得出兩種軸。
**不要**用 `git stash` 或 `git show` 去取舊版程式碼 —— Task 1–2 已經 commit，
而且那種做法無法寫進測試。

正確做法：在測試檔裡加一個**腳本破防者**，它自己實作兩種軸。這與 spec §3.1
那張掃描表用的是同一個工具，所以數字可以直接對照。

```ts
/** 腳本破防者：偏轉角一律 `DEFAULT_STEER.defendOffset`，只有軸的取法不同 */
class ScriptedBreaker implements Controller {
  threat: Aircraft | null = null
  /** 'none' = 直飛基準線、'lift' = 舊軸、'horizUp' = 新軸 */
  mode: 'none' | 'lift' | 'horizUp' = 'horizUp'
  private sign = 0
  private readonly los = new Vector3()
  private readonly axis = new Vector3()
  private readonly lift = new Vector3()
  private readonly up = new Vector3()

  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    const th = this.threat
    if (this.mode === 'none' || th === null) {
      out.aimWorld.copy(self.state.velocity).normalize()
      return
    }
    this.los.copy(th.state.position).sub(self.state.position).normalize()
    this.lift.copy(UP).applyQuaternion(self.state.orientation)

    if (this.mode === 'lift') {
      this.axis.copy(this.lift).addScaledVector(this.los, -this.lift.dot(this.los))
    } else {
      this.axis.copy(UP).cross(this.los)
      if (this.axis.lengthSq() < 1e-8) this.axis.copy(this.lift)
      this.axis.normalize()
      if (this.sign === 0) this.sign = this.axis.dot(this.lift) >= 0 ? 1 : -1
      this.axis.multiplyScalar(this.sign)
      this.up.copy(UP).addScaledVector(this.los, -UP.dot(this.los))
      if (this.up.lengthSq() > 1e-12) {
        this.up.normalize()
        this.axis.multiplyScalar(Math.cos(DEFAULT_STEER.defendTilt))
          .addScaledVector(this.up, Math.sin(DEFAULT_STEER.defendTilt))
      }
    }
    if (this.axis.lengthSq() < 1e-12) this.axis.set(1, 0, 0)
    this.axis.normalize()
    out.aimWorld.copy(this.los).multiplyScalar(Math.cos(DEFAULT_STEER.defendOffset))
      .addScaledVector(this.axis, Math.sin(DEFAULT_STEER.defendOffset))
      .normalize()
  }
}
```

`UP` 是 `new Vector3(0, 1, 0)`，若檔案裡還沒有就在頂端加一個模組常數。

再加一個兩機場景的量測函式（受測者用 `ScriptedBreaker`，射手用既有的
`Sniper`），回傳 `{ swingMedian, hitShare }`：

```ts
interface ScriptResult { swingMedian: number; hitShare: number; minAlt: number }

function scripted(mode: 'none' | 'lift' | 'horizUp', standoff = 800): ScriptResult
```

它與 `measure()` 的差別只有兩個：受測者是腳本不是 `AiController`，
而且**不需要誘餌** —— 腳本破防者沒有自己的目標要追。取樣邏輯（1 秒滑動窗的
淨角位移、`sniper.aimError < 2`）與 `measure()` 完全一致，直接複用同一段。

- [ ] **Step 4b: 用它先驗證舊軸真的很糟（先紅）**

```ts
it('腳本對照：新軸必須明顯優於舊軸', () => {
  const none = scripted('none')
  const lift = scripted('lift')
  const horiz = scripted('horizUp')

  // 基準線：完全不閃時射手幾乎百分百打得中
  expect(none.hitShare).toBeGreaterThan(0.8)
  // 主判準：新軸的「打得中」低於舊軸的一半
  expect(horiz.hitShare).toBeLessThan(lift.hitShare / 2)
  // 副判準：新軸的視覺對比至少是舊軸的 3 倍
  const contrastLift = lift.swingMedian / none.swingMedian
  const contrastHoriz = horiz.swingMedian / none.swingMedian
  expect(contrastHoriz).toBeGreaterThan(contrastLift * 3)
  // 護欄：新軸不得比舊軸掉更多高度
  expect(horiz.minAlt).toBeGreaterThanOrEqual(lift.minAlt)
})
```

跑 `npx vitest run test/integration/ai-visible-evasion.test.ts -t "腳本對照"`
確認它綠 —— 這一條驗的是**軸的幾何**，與 Task 1–2 的接線無關，所以在
Task 1–2 完成後應該直接通過。若它紅，代表 §5.4 的否決條件成立，
**撤回整份改動並報告**。

- [ ] **Step 5: 換掉斷言**

把 297 行的

```ts
      expect(r.defendMedian).toBeGreaterThanOrEqual(5)
```

換成兩條：

```ts
      // 【主判準】破防期間玩家真的打得中的時間。舊的「位移 ≥ 5°」是壞的：
      // 完全不閃的基準線只有 0.9°，而 AI 平常追擊就有 6~11°，那條門檻連
      // 「不閃」都快要通過。詳見 spec §5.1。
      expect(r.defendHitShare).toBeLessThan(HIT_SHARE_LIMIT)
      // 【副判準】視覺對比 —— 相對於**腳本直飛**的基準線，不是 AI 的平常機動
      expect(r.contrast).toBeGreaterThan(CONTRAST_FLOOR)
```

兩個常數連同實測值一起寫在檔案上方：

```ts
/**
 * 【這兩個數字是實測回填的，不是猜的】
 *
 * 腳本對腳本、出貨飛行模型、800 m：
 *
 * ```
 * 破防軸              位移    玩家打得中    對比（÷ 不閃的 0.9°）
 * 不閃（基準線）        0.9°     100.0%          1.0×
 * 自身升力（舊）        1.8°      77.1%          2.0×
 * 水平面抬 20°（新）   11.5°       2.4%         12.8×
 * ```
 *
 * spec §5.3 要求主副判準都寫成**相對值**：主判準取「低於舊值的一半」、
 * 副判準取「至少是舊值的 3 倍」。真實 AI 會比腳本差一截（它還要追自己的
 * 目標、切換意圖、管能量），所以門檻放在腳本值與舊值之間，留給真實 AI
 * 的餘裕，而不是貼著腳本的理想值。
 */
const HIT_SHARE_LIMIT = 0.38   // 舊值 77.1% 的一半
const CONTRAST_FLOOR = 6       // 舊值 2.0× 的 3 倍
```

**這兩個常數與 Step 4b 的比值斷言是兩層不同的東西**，兩層都要留：

- Step 4b 的比值（腳本對腳本）驗的是**軸的幾何**。它不含任何魔術數字，
  下次調手感倍率也不會失效。
- 這裡的絕對常數驗的是**真實 AI 在完整場景下**的表現。它會隨手感倍率漂移，
  所以註解裡必須寫清楚它是從哪一組倍率量出來的。

若日後 `specs/feel.ts` 大幅調動導致這兩個常數紅了，處置方式是**重量並回填**
（連同新的倍率一起記進註解），不是逕自放寬 —— 那是專案負責人的裁定。

- [ ] **Step 6: 跑測試**

```
npx vitest run test/integration/ai-visible-evasion.test.ts
```

若紅：**先查根因，不准調 `HIT_SHARE_LIMIT` 或 `CONTRAST_FLOOR`**。
spec §5.4 的否決條件明寫「這三條紅了要撤回整份改動，不是放寬數字」。
把實測值報告給專案負責人。

- [ ] **Step 7: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
```

訊息：

```
test: 看得見的閃躲 —— 主判準由絕對位移改成同場景比值

舊的「破防期間位移 ≥ 5°」擋不住任何東西：完全不閃的基準線是 0.9°，
而 AI 平常追擊就有 6~11°。5° 這個數字是專案負責人給的，但拿去量
絕對位移是實作的錯 —— 該量的是破防與不破防的對比。

改成兩條：破防期間玩家打得中的時間（主）、相對於腳本直飛基準線的
視覺對比（副）。兩條都由實測回填，門檻寫成相對值。
```

---

### Task 4: 全套回歸、護欄實測、回填 spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-defend-axis-design.md`
- 可能 Modify（**須先問過專案負責人**）：`test/integration/ai-defence.test.ts`、`ai-manoeuvre.test.ts`、`ai-duel-matrix.test.ts`、`multi-battle.test.ts`

**Interfaces:**
- Consumes: Task 1–3 的完整改動
- Produces: 回填實測值的 spec；受波及測試的處置記錄

- [ ] **Step 1: 跑全套（排除兩個並行假紅的檔案）**

```
npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"
```

- [ ] **Step 2: 單獨複測那兩個檔案**

```
npx vitest run test/unit/perf-gate.test.ts test/integration/rematch.test.ts
```

跑之前確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁。

- [ ] **Step 3: 逐條處理紅掉的測試**

spec §6 列出的受波及範圍：`ai-defence.test.ts`、`ai-manoeuvre.test.ts`
（`safetyShare` / `steepShare` / 最低高度）、`ai-duel-matrix.test.ts`、
`multi-battle.test.ts`。

**每一條紅的都要先查根因再報告，不得逕自調門檻。** 報告的格式：

```
檔案 / 測試名
  舊值 → 新值（門檻）
  根因：一句話
  建議：撤回 / 重新定值 / 改判準
```

**§5.4 的三條否決條件優先於一切**：最低高度低於現行同場景、視覺對比沒到
現行的 3 倍、打得中沒降到現行的一半 —— 任何一條成立就整份撤回，不是調數字。

- [ ] **Step 4: 量真實 AI 的絕對值**

腳本對腳本的數字是理想值。用真實 `AiController` 在三機場景（受測 AI 追腳本
獵物、腳本射手在後方）量 400 / 800 / 1000 m × 尾追 / 橫越，180 秒，記錄：

- 破防期間「打得中」的時間佔比
- 最低高度 vs 開局高度
- 收尾 TAS

把這六列連同結論寫進 spec §5.3 的「實作時回填」位置。

- [ ] **Step 5: 回填 spec**

在 `docs/superpowers/specs/2026-08-07-defend-axis-design.md` 加一節
「## 8. 實作後的實測回填」，內容：

- Task 4 Step 4 的真實 AI 六列
- 受波及測試的處置一覽（哪些紅了、根因、專案負責人的裁定）
- 若有任何一節的設計在實作中被推翻，明寫「實作後修正」並保留原文供追溯
  （這個專案的既有慣例，見 `2026-08-06-visible-evasion-design.md`）

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-defend-axis-design.md
```

（若 Step 3 有經專案負責人裁定的測試改動，一併 `git add` 那些明確路徑。）

訊息：

```
docs: 破防軸 —— 實作後結果回填

真實 AI 的六個場景實測、受波及測試的處置一覽、以及設計在實作中
被推翻的部分（若有）。
```

---

## Self-Review

**1. Spec 覆蓋**

| Spec 節 | 對應任務 |
|---|---|
| §3.1 破防軸 + 抬 20° | Task 1 Step 4/6 |
| §3.2 選邊，進入時決定一次 | Task 1 Step 5、Task 2 全部 |
| §3.3 低空不做 | Task 1 Step 4 的註解明寫「不做」與理由 |
| §4 四個已否決的替代方案 | 已在 spec 記錄，不需程式碼任務 |
| §5.1 廢掉舊判準 | Task 3 Step 5 |
| §5.2 三條新判準 | Task 3 Step 3/5（1、2 兩條）；第 3 條（最低高度護欄）在 Task 4 Step 3/4 |
| §5.3 相對判準 + 回填 | Task 3 Step 5 常數、Task 4 Step 4/5 |
| §5.4 否決條件 | Task 3 Step 6、Task 4 Step 3 都明寫 |
| §6 受波及範圍 | Task 4 Step 3 |
| §7 不處理的 | 不需任務 |

**發現的缺口與修補**：§5.2 第 3 條（最低高度護欄）原本沒有明確的任務落點，
已補進 Task 4 Step 3/4，並在 Task 3 Step 4b 的腳本對照裡加了一條
`horiz.minAlt >= lift.minAlt`。

**2. 佔位符掃描**

Task 3 Step 4 原本寫了兩段互相矛盾的「怎麼取得對照值」（`git stash` /
`git show`），兩者都不可行且沒有具體程式碼 —— 已改寫成 Step 4 / 4b：
測試檔裡自帶一個 `ScriptedBreaker`（完整程式碼已列出），同場景跑
`none` / `lift` / `horizUp` 三種模式，比值直接寫成斷言。

**3. 型別一致性**

- `DefendState.axisSign`：Task 1 Step 5 定義，Task 2 Step 3/4 消費 ✓
- `defendAim(self, threatLos, sign, out, cfg?)`：Task 1 Step 6 定義，Task 2 Step 4 呼叫 ✓
- `SteerConfig.defendTilt`：Task 1 Step 4 定義，Task 1 Step 6 消費 ✓
- `Sniper.aimError`：Task 3 Step 2 定義，Step 3 消費 ✓
- `Result.defendHitShare` / `straightMedian` / `contrast`：Task 3 Step 3 定義，Step 5 消費 ✓
- `HIT_SHARE_LIMIT` / `CONTRAST_FLOOR`：Task 3 Step 5 同時定義與消費 ✓
- `ScriptedBreaker` / `ScriptResult` / `scripted()`：Task 3 Step 4 定義，Step 4b 消費 ✓
- `Straight` 類別（Step 3）與 `ScriptedBreaker` 的 `mode: 'none'`（Step 4）**功能重複** ——
  實作時只留 `ScriptedBreaker`，`measureStraight` 改用 `ScriptedBreaker` 配 `mode: 'none'`，
  不要建兩個做同一件事的類別。

**4. 既有檔案的前置確認（已驗）**

- `test/unit/ai-steer.test.ts` 存在，且已經 import 了 `createDefendState`、
  `stepDefend`、`DEFAULT_STEER`、`Vector3`、`Aircraft`、`P51D` —— Task 1/2 的
  測試只需要補 import `defendAim`。
- `src/ai/steer.ts` 的 `const D = makeScratch(3)` 在第 1076 行、`defendAim` 在
  第 1100 行、`perpendicular` 在第 56 行、`AXIS_EPSILON = 0.15` 在第 64 行、
  `DEFAULT_STEER` 在第 659 行起、`defendOffset` 欄位宣告在第 284 行。
  （行號會隨改動漂移，用符號搜尋而不是行號定位。）
