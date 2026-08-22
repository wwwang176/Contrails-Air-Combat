# `extend` 的絕對出場條件 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 給 `extend` 一條**絕對**的出場路徑 —— 速度補回來了就回去打，
不必等到「比對手強」。

**Architecture:** `rules.ts` 新增一個只吃 `cornerRatio` 的正交閂鎖
`extendRecoveredLatch`，仲裁時與既有的 `extendEnergyLatch` 取合取。
`AiController` 加一個 `rulesConfig` 注入點讓消融能開關。
**`steer.ts` 一個字不改**，不碰瞄準解，不碰另外兩個 extend 閂鎖。

**Spec:** `docs/superpowers/specs/2026-08-22-extend-recovery-design.md`（第三版）

**改動很小 —— 大約 15 行 `src/`。** 這一份的份量在驗收，不在實作。

## Global Constraints

- **所有註解、commit message 用繁體中文。註解寫現狀，不寫沿革。**
- **護欄重新定值是專案負責人的決定。** 測試紅了先量、先報告、先問，
  **絕不為了讓測試變綠而放寬門檻**。
- **絕不 `git add -A`**（`bash.exe.stackdump` 是被追蹤且長期被修改的檔案）。
- **絕不用 PowerShell 讀寫含中文的檔案**；用 Write 工具或 Python
  `io.open(..., encoding='utf-8')`。
- **絕不把反引號放進 bash heredoc 或 `python -c`** —— bash 會靜靜吃掉。
  commit message 含反引號時，先用 Write 工具寫成檔案再 `git commit -F`。
- 不得引入 `@types/node`；型別檢查是 `npx tsc --noEmit`。
- `test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts`
  **必須單獨跑**。
- 熱路徑零配置；**不得 `Math.random`**；`src/ai/` 不得 import `src/battle/`。
- commit message 結尾加：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QUHJrQKi3G1XAY5SpZN4vK
  ```

**已知的既有紅測試**（**不是這一份造成的，不要試圖修綠**）：
`order-of-battle-replay` ×2、`ai-withdraw-anchor`、`ai-command-channel`、
`ai-command-decision`、`ai-targeting`、`ai-command-tactics`。

## 一條貫穿全篇的分工

**測試斷言少而準，量測放探針。** 這是專案既有的作法：`ai-withdraw-anchor`
只斷言三件事，其餘全部 `console.log`。這一份照辦 —— Task 4 的整合測試只
斷言三條，所有診斷交給既有的 `extend-exit.probe.ts` 前後各跑一次。

---

## File Structure

| 檔案 | 動作 | 行數量級 |
|---|---|---|
| `src/ai/rules.ts` | 修改 | +12 |
| `src/ai/AiController.ts` | 修改 | +3 |
| `test/unit/ai-rules.test.ts` | 修改 | 新增一個 describe |
| `test/integration/extend-recovery.test.ts` | 新增 | 一支消融測試 |
| `test/tools/extend-exit.probe.ts` | 修改 | 加一個開關常數 |

---

## Task 1：三個欄位 + `stepRules` 維護新閂鎖

**Files:**
- Modify: `src/ai/rules.ts`
- Test: `test/unit/ai-rules.test.ts`

**Interfaces:**
- Produces：`RuleConfig.recoverExit: number`（0.85）、
  `RuleConfig.recoveredExit: boolean`（`true`）、
  `RuleState.extendRecoveredLatch: boolean`

**這個 Task 不改變任何行為** —— 只是讓閂鎖存在並被維護。仲裁是 Task 2。

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/ai-rules.test.ts`。`sit()` 這個 helper 檔案裡已經有了，
沿用；沒有的話照既有測試的作法組一個 `Situation`。

```ts
describe('extendRecoveredLatch —— 絕對的「我回到能打的狀態」', () => {
  it('初始 false，門檻夾在 cornerEnter 與 cornerExit 之間', () => {
    expect(createRuleState().extendRecoveredLatch).toBe(false)
    expect(DEFAULT_RULES.recoverExit).toBeGreaterThan(DEFAULT_RULES.cornerEnter)
    expect(DEFAULT_RULES.recoverExit).toBeLessThan(DEFAULT_RULES.cornerExit)
  })

  it('高於 cornerExit 才進場，掉到 recoverExit 以下才出場', () => {
    const s = createRuleState()
    stepRules(s, sit({ cornerRatio: 0.95 }), 0, 0.1)
    expect(s.extendRecoveredLatch).toBe(false)   // 嚴格 >，等於不算
    stepRules(s, sit({ cornerRatio: 0.96 }), 0, 0.1)
    expect(s.extendRecoveredLatch).toBe(true)
    stepRules(s, sit({ cornerRatio: 0.90 }), 0, 0.1)
    expect(s.extendRecoveredLatch).toBe(true)    // 遲滯帶內維持
    stepRules(s, sit({ cornerRatio: 0.84 }), 0, 0.1)
    expect(s.extendRecoveredLatch).toBe(false)
  })

  /**
   * 【為什麼關掉時閂鎖也不能更新】消融的兩檔不得有不同的狀態演進，
   * 否則差異會在日後打開時以「殘留的舊值」的形式冒出來。
   */
  it('recoveredExit 關掉時閂鎖不更新', () => {
    const s = createRuleState()
    stepRules(s, sit({ cornerRatio: 1.5 }), 0, 0.1,
      { ...DEFAULT_RULES, recoveredExit: false })
    expect(s.extendRecoveredLatch).toBe(false)
  })
})
```

- [ ] **Step 2：跑它，確認紅**

```
npx vitest run test/unit/ai-rules.test.ts -t extendRecoveredLatch
```

預期：`Property 'extendRecoveredLatch' does not exist` 的型別錯誤。

- [ ] **Step 3：加欄位**

`RuleConfig` 裡，`cornerExit` 之後：

```ts
  /**
   * 「我回到能打的狀態」失效的門檻 —— `extendRecoveredLatch` 的出場。
   * 進場門檻**直接用 `cornerExit`**：「我飛得動了」只該有一個定義，
   * 與 `extendFloorLatch` 共用同一把尺。
   *
   * 值域被夾在 `cornerEnter`（0.75）與 `cornerExit`（0.95）之間 ——
   * 低於前者等於沒有這個閂鎖（要撐到見底才失效），高於後者等於沒有遲滯。
   *
   * **起始值，待 Task 5 掃描後回填。**
   */
  recoverExit: number
  /**
   * 關掉時 `extendRecoveredLatch` 不更新、仲裁退化成舊式。**消融用**。
   *
   * 【為什麼是布林不是把進場門檻設成 `Infinity`】那只在「全新、未啟動」
   * 的狀態下等價 —— `latch()` 在 `active === true` 時走的是 `value > exit`，
   * 仍然會被評估。而且 `JSON.stringify` 會把 `Infinity` 輸出成 `null`。
   */
  recoveredExit: boolean
```

`DEFAULT_RULES` 裡，`cornerExit: 0.95,` 之後：

```ts
  recoverExit: 0.85,
  recoveredExit: true,
```

`RuleState` 裡，`extendFloorLatch` 之後：

```ts
  /**
   * 「我回到能打的狀態」的閂鎖，**絕對量，與對手無關**。
   * 與 `extendEnergyLatch` 正交：那一個說「我比他弱」（相對），
   * 這一個說「我飛得動」（絕對）。**一個閂鎖只維護一種事實。**
   */
  extendRecoveredLatch: boolean
```

`createRuleState()` 的 `extendFloorLatch: false,` 那一行補
`extendRecoveredLatch: false,`。

`stepRules` 裡，`s.extendFloorLatch = latch(...)` 之後、
`s.extendLatch = ...` 之前：

```ts
  // 【第四個閂鎖：絕對的「我回到能打的狀態」】進場用 cornerExit、出場用
  // recoverExit。進場門檻與 extendFloorLatch 的出場共用同一個值，因為那是
  // 同一件事的同一把尺；出場另設一個較低的值製造遲滯，否則速度在 0.95
  // 附近抖動就會讓意圖跟著抖。
  //
  // 【關掉時不更新】消融的兩檔不得有不同的狀態演進。
  if (cfg.recoveredExit) {
    s.extendRecoveredLatch = latch(
      s.extendRecoveredLatch, sit.cornerRatio, cfg.cornerExit, cfg.recoverExit,
    )
  }
```

- [ ] **Step 4：跑測試與型別**

```
npx vitest run test/unit/ai-rules.test.ts
npx tsc --noEmit
```

**整支 `ai-rules` 都要綠** —— 這一步還沒動仲裁，行為應該完全沒變。

`tsc` 不能跳過：`RuleConfig` 是必填欄位的介面，任何自己組 config 物件的
呼叫端都會在這裡爆出來；有的話逐一補上這兩個欄位。

- [ ] **Step 5：commit**

```
feat: rules.ts 長出 extendRecoveredLatch

只加閂鎖並維護它，仲裁還沒接上 —— 行為完全沒變。

進場用 cornerExit（0.95）、出場用 recoverExit（0.85）。進場門檻與
extendFloorLatch 的出場共用同一個值，因為那是同一件事的同一把尺。

消融開關用布林而不是把進場門檻設成 Infinity，因為那只在全新未啟動
的狀態下等價，而且 JSON.stringify 會把 Infinity 輸出成 null。
```

---

## Task 2：`arbitrate` 改成合取 —— 唯一改變行為的一步

**Files:**
- Modify: `src/ai/rules.ts`
- Test: `test/unit/ai-rules.test.ts`

- [ ] **Step 1：寫失敗的測試**

```ts
describe('因能量脫離改成合取', () => {
  /** 四個象限，只有「弱且飛不動」才脫離 */
  const cases: [string, number, number, boolean][] = [
    ['弱、飛不動   → extend',     -800, 0.80, true],
    ['弱、飛得動   → 不 extend',  -800, 1.10, false],
    ['不弱、飛不動 → 不 extend',      0, 0.80, false],
    ['不弱、飛得動 → 不 extend',      0, 1.10, false],
  ]
  for (const [name, energy, ratio, want] of cases) {
    it(name, () => {
      const s = createRuleState()
      // 先跑一拍讓閂鎖進入該有的狀態，再看第二拍的仲裁
      stepRules(s, sit({ cornerRatio: ratio, energyAdvantage: energy }), 0, 0.1)
      const got = stepRules(
        s, sit({ cornerRatio: ratio, energyAdvantage: energy, range: 800 }), 0, 0.1,
      )
      expect(got === 'extend').toBe(want)
    })
  }

  /**
   * 【迴旋理由不套合取】「轉不贏他」談的是機體，補速度改變不了它。
   */
  it('迴旋劣勢時，飛得動也照樣脫離', () => {
    const s = createRuleState()
    stepRules(s, sit({ cornerRatio: 1.5, airframeTurnAdvantage: -0.05 }), 0, 0.1)
    const got = stepRules(s, sit({
      cornerRatio: 1.5, airframeTurnAdvantage: -0.05, range: 800,
    }), 0, 0.1)
    expect(got).toBe('extend')
  })

  /** 【關掉時退回舊行為】消融的恆等基準 */
  it('recoveredExit 關掉時，弱且飛得動仍然 extend', () => {
    const cfg = { ...DEFAULT_RULES, recoveredExit: false }
    const s = createRuleState()
    stepRules(s, sit({ cornerRatio: 1.10, energyAdvantage: -800 }), 0, 0.1, cfg)
    const got = stepRules(s, sit({
      cornerRatio: 1.10, energyAdvantage: -800, range: 800,
    }), 0, 0.1, cfg)
    expect(got).toBe('extend')
  })
})
```

【`minDwell` 注意】`createRuleState()` 的 `dwell` 初值是 `Infinity`
（刻意的，見該處註解），所以第一次切換不會被擋。上面每條先跑一拍再看
第二拍，是為了讓閂鎖先到位。若某條因 `minDwell` 卡住，在測試裡明寫
`s.dwell = Infinity`，**不要改 `minDwell` 本身**。

- [ ] **Step 2：跑它，確認紅**

```
npx vitest run test/unit/ai-rules.test.ts -t "因能量脫離改成合取"
```

預期：只有「弱、飛得動 → 不 extend」紅。**其餘三條是防迴歸的，
現在就該綠；紅了表示測試本身寫錯**（多半是 `sit()` 的中性值不對）。

- [ ] **Step 3：改仲裁**

`arbitrate` 裡把

```ts
  if (
    !shooting
    && (s.extendEnergyLatch || s.extendTurnLatch)
    && sit.range < cfg.extendRange
  ) return 'extend'
```

改成

```ts
  // 【能量理由是合取，迴旋理由不是】「我比他弱」（相對）與「我飛不動」
  // （絕對）是兩件事，兩件都成立才該脫離。速度補回來了就回去打 ——
  // 「比對手強」那個條件對劣勢方在整場戰鬥中都達不到，實測閂鎖曾連續
  // 開著 166 秒。
  //
  // 迴旋劣勢不套合取：那談的是機體，補速度改變不了它。
  const weakAndSlow = s.extendEnergyLatch && !s.extendRecoveredLatch
  if (
    !shooting
    && (weakAndSlow || s.extendTurnLatch)
    && sit.range < cfg.extendRange
  ) return 'extend'
```

- [ ] **Step 4：跑測試**

```
npx vitest run test/unit/ai-rules.test.ts
```

全綠。若既有的某條紅了，**先讀那條在守什麼再決定** —— 它可能正好釘住了
舊行為（那時改測試的敘述），也可能抓到真的迴歸（那時改程式）。

- [ ] **Step 5：commit**

```
feat: 因能量脫離改成合取 —— 飛得動就回去打

唯一改變行為的一步。extendEnergyLatch 說「我比他弱」（相對），
extendRecoveredLatch 說「我飛得動」（絕對），兩件都成立才脫離。

實測（extend-exit.probe.ts）：純能量型段落有 83% 會因此縮短，
其中約一半在進場那一拍 cornerRatio 就已經高於 0.95 —— 那些會被
直接擋掉，不只是縮短。

迴旋理由不套合取，那談的是機體。
```

---

## Task 3：`AiController` 的 config 注入點

**Files:**
- Modify: `src/ai/AiController.ts`

**為什麼需要**：`stepRules` 目前用預設參數呼叫，**沒有注入點**。消融測試
若改 `DEFAULT_RULES` 的全域欄位，兩檔會互相污染而且逼測試串行。加一個
欄位就解決 —— 與既有的 `tacticalConfig`（`AiController.ts:287`）同一手法。

- [ ] **Step 1：加欄位並接線**

`readonly rules = createRuleState()`（約第 220 行）之後：

```ts
  /**
   * 意圖仲裁的設定。**掃描與消融換這個欄位，不要改 `DEFAULT_RULES`** ——
   * 那是模組層級的共用物件，改它會讓同一支測試裡的兩檔互相污染。
   * 與 `tacticalConfig` 同一個手法。
   */
  rulesConfig: RuleConfig = DEFAULT_RULES
```

`import` 補上 `DEFAULT_RULES` 與 `type RuleConfig`。

把 `this.intent = stepRules(this.rules, this.sit, danger, period)` 改成
`this.intent = stepRules(this.rules, this.sit, danger, period, this.rulesConfig)`。

- [ ] **Step 2：驗證**

```
npx tsc --noEmit
npx vitest run test/unit/ai-controller.test.ts
```

【不另寫測試】這是一個純粹的接線，Task 4 的消融測試會直接消費它 ——
它跑得起來就是這一步對了的證明。多寫一支只驗「欄位存在」的測試是同義
反覆，專案不寫那種。

- [ ] **Step 3：commit**

```
feat: AiController 加 rulesConfig 注入點

stepRules 原本用預設參數呼叫，沒有注入點。消融測試若改 DEFAULT_RULES
的全域欄位，兩檔會互相污染。與既有的 tacticalConfig 同一手法。
```

---

## Task 4：消融整合測試 —— 只斷言三條

**Files:**
- Create: `test/integration/extend-recovery.test.ts`

**斷言三條，其餘全部 `console.log`。** 與 `ai-withdraw-anchor.test.ts`
同一個格式。

- [ ] **Step 1：寫測試**

```ts
/**
 * `extend` 的絕對出場條件：脫離的**總量**要下降，而且沒有人死得更快。
 *
 * ── 【為什麼主判準是「率」不是段落長度的分布】────────────
 *
 * 實測（`extend-exit.probe.ts`）：開啟後約一半的純能量型段落**根本不會
 * 出生** —— 它們在進場那一拍 `cornerRatio` 就已經高於 0.95，合取直接
 * 是 false。而被擋掉的全是最短的那些。
 *
 * 所以只比較「仍然存在的段落」的 p90 會**系統性看錯方向**：剩下的自然
 * 偏長，分布可以完全不動甚至變差，而總量其實掉了一半。
 *
 * 率把分母固定在「飛機活著的時間」，不受這個選樣影響。
 *
 * ── 【為什麼是消融不是與歷史數字比】──────────────────
 *
 * `ai-withdraw-anchor.test.ts:236` 的註解逐字警告過「單次量測當門檻是
 * 變更偵測器不是設計判準」。這裡的對照組由同一個 binary、同一組種子、
 * 同一組微擾產生。
 *
 * ── 【為什麼效果量要超過雜訊帶】────────────────────
 *
 * 只要求「開 < 關」的話任意小的差都會通過。而這個系統的雜訊很大：
 * 同一張卡只把初速擾動 ±0.5%，`extend` 佔時可以由 6.2% 跑到 36.4%。
 * 雜訊帶取 `off` 組五次的全距，與 `energy-tactics-design` §12 同一手法。
 */
const SALTS = [0, 101, 202, 303, 404]
const CARDS: [string, 'allies' | 'axis'][] = [
  ['axis-escort', 'axis'],
  ['allies-escort', 'allies'],
]
const SECONDS = 300
```

`run(id, faction, salt, on)` 回傳四個數：

```ts
interface Result {
  /** 純能量型 extend 的總秒數 ÷ 戰鬥機存活秒數 */
  share: number
  /** protected 的存活積分，aircraft-seconds */
  protectedAlive: number
  /** 己方戰鬥機的存活積分，aircraft-seconds */
  fighterAlive: number
  /** 診斷用，不斷言：純能量段落數、平均長度 */
  entries: number
  meanSeconds: number
}
```

**「純能量型」的認定**：進場那一拍 `extendEnergyLatch` 為真、
`extendTurnLatch` 與 `extendFloorLatch` 都為假，且段落期間那兩個
**都不曾成立過**。實測混合型只佔 0.3~1.8%，直接排除即可。

**`on` 檔設 `ai.rulesConfig = { ...DEFAULT_RULES, recoveredExit: true }`，
`off` 檔設 `false`。** 兩檔都建新的 battle，`AiController` 逐架設定。

微擾直接抄 `test/tools/extend-exit.probe.ts` 的 `jitter()`
（整數雜湊，不得 `Math.random`）。

```ts
describe('extend 的絕對出場條件（消融對照）', () => {
  for (const [id, faction] of CARDS) {
    it(`${id}：脫離的總量下降，且沒有人死得更快`, () => {
      const on = SALTS.map((s) => run(id, faction, s, true))
      const off = SALTS.map((s) => run(id, faction, s, false))

      // 同一個 salt 配對，取五對之差的中位數
      const d = (f: (r: Result) => number): number =>
        median(SALTS.map((_, i) => f(on[i]!) - f(off[i]!)))

      const noise = range(off.map((r) => r.share))

      console.log(JSON.stringify({
        card: id,
        shareOn: on.map((r) => r.share.toFixed(3)),
        shareOff: off.map((r) => r.share.toFixed(3)),
        noise: noise.toFixed(3),
        dShare: d((r) => r.share).toFixed(3),
        dProtected: d((r) => r.protectedAlive).toFixed(0),
        dFighter: d((r) => r.fighterAlive).toFixed(0),
        entriesOn: on.map((r) => r.entries),
        entriesOff: off.map((r) => r.entries),
      }))

      // ── 一：脫離的總量要真的下降，而且幅度要超過雜訊 ──
      expect(d((r) => r.share)).toBeLessThan(-noise)

      // ── 二、三：沒有人死得更快 ─────────────────
      // 【為什麼是積分不是終點存活數】只看 300 秒終點擋不住「前 200 秒
      // 死得比較多、後來剛好同數」。積分把整條存活曲線納進來，順帶也
      // 抓得到提早全滅 —— 全滅越早，積分越小。
      //
      // 【為什麼戰鬥機也要守】只守 protected 擋不住「護航機更早死光」，
      // 而觀測對象一消失，脫離的總量自然變小。
      expect(d((r) => r.protectedAlive)).toBeGreaterThanOrEqual(0)
      expect(d((r) => r.fighterAlive)).toBeGreaterThanOrEqual(0)
    })
  }
})
```

- [ ] **Step 2：跑它**

```
npx vitest run test/integration/extend-recovery.test.ts
```

**紅了不一定是錯的。** 三種可能，處理方式不同：

| 現象 | 意思 | 怎麼辦 |
|---|---|---|
| `dShare` 沒超過雜訊帶 | 效果被雜訊淹沒 | 看印出的五對原始值。方向一致只是幅度小 → **回報，不放寬門檻** |
| `dProtected` / `dFighter` 為負 | AI 因為不再脫離而死得更多 | **這是 spec §3.6 預言的主要風險。** 記下數字，跑完 Task 5 一起回報 |

**任何情況下都不得為了讓它變綠而改門檻。**

- [ ] **Step 3：commit**

```
test: extend 絕對出場的消融對照

只斷言三條：脫離的總量下降超過雜訊帶、protected 與己方戰鬥機的存活
積分都不退步。其餘全部 console.log。

主判準用率不是段落長度的分布 —— 開啟後約一半的段落根本不出生，而被
擋掉的全是最短的，比較「仍然存在的段落」會系統性看錯方向。
```

---

## Task 5：掃描 `recoverExit`、跑全套回歸、回填

**Files:**
- Modify: `test/tools/extend-exit.probe.ts`（加一個開關與 `recoverExit` 常數）
- Modify: `src/ai/rules.ts`（回填定值）
- Modify: `docs/superpowers/specs/2026-08-22-extend-recovery-design.md`

- [ ] **Step 1：讓既有探針能掃**

`extend-exit.probe.ts` 已經在量結束原因、段落長度、churn。加兩個常數
與一層迴圈就能當掃描器 —— **不要另寫一支新探針**：

```ts
/** 掃描檔位。`null` = 關閉（消融的對照組） */
const EXITS: (number | null)[] = [null, 0.80, 0.85, 0.90]
```

每個 combatant 的 `AiController` 設
`ai.rulesConfig = { ...DEFAULT_RULES, recoveredExit: v !== null, recoverExit: v ?? 0.85 }`。

- [ ] **Step 2：跑，兩階段選值**

```
npx vite-node test/tools/extend-exit.probe.ts
```

1. **安全先過**：三檔的 protected 全滅時刻、存活數都不得比 `null` 那一檔差。
2. **再看 churn**：在通過的檔位裡取「段落結束 → 下一次進場的間隔
   ≤ 2×`minDwell`」比例最低者。

【不要用效果量選值】`recoverExit` **只控制 recovered 何時失效** —— 它不
影響第一次達到 0.95，也不影響那些「一進場就被擋掉」的段落。三檔在效果量
上很可能完全同分，那時用它選值等於擲銅板。真正被它決定的是 churn。

【並列取 0.85】churn 也並列才取中間值。**不設「取較大」這種機械規則**：
`recoverExit` 較大在速度安全上較保守，但遲滯帶較窄、churn 上較危險，
兩個方向相反。

【現況基準已經有了】改動前實測 `axis-escort` 25.6%、`allies-escort`
29.7% 的段落是在 1.6 秒內重新進場的。**這幾個數字不該惡化。**

- [ ] **Step 3：回填定值**

改 `DEFAULT_RULES.recoverExit`（若不是 0.85），把掃描表填進該欄位的註解
與 spec §6。**註解寫現狀不寫沿革** —— 掃描表是現狀（它說明這個值怎麼
來的）。

**若定值不是 0.85，Task 4 的結果作廢，重跑一次。**

- [ ] **Step 4：全套回歸**

```
npx vitest run test/unit/ai-rules.test.ts test/unit/ai-steer.test.ts test/unit/ai-controller.test.ts
npx vitest run test/integration/ai-manoeuvre.test.ts test/integration/ai-visible-evasion.test.ts test/integration/ai-defence.test.ts
npx vitest run test/integration/ai-targeting.test.ts test/integration/ai-duel-matrix.test.ts
npx vitest run test/integration/ai-withdraw-anchor.test.ts
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
npx vitest run
```

與「已知的既有紅測試」清單逐條比對。新紅的每一條分開處理：

- **`ai-manoeuvre` / `ai-visible-evasion` / `ai-defence` 紅 → 硬否決。**
  那三條守的是失速、安全層介入與破防。退回 Task 2。
- **`fireShare` 或 `ai-duel-matrix` 退步、而 Task 4 的主判準同時大幅改善**
  → 那是真正的取捨，**回報給專案負責人**。
- **`ai-withdraw-anchor`**：本來就紅（`maxRadius 11110.26 > 6500`）。
  要看的是那個數字**沒有變大**。
- **replay digest 變了 → 預期會變**（行為改了）。要證明的是：
  `recoveredExit: false` 時 digest 逐位元等於改動前。基準要不要更新是
  專案負責人的決定。

- [ ] **Step 5：回填 spec 並整理驗收說明**

spec 要填的：§6 的掃描表與定值、§8.2 的 §9 門檻裁定（用 Task 4 印出的
離場距離長尾）、§5 的實測結果。

人工驗收的觀察重點 —— 專案負責人**只看得到自己那一架**（按 `I` 代飛），
HUD 已經有「意圖」與「extend 理由」兩格：

- 意圖停在 `extend` 的**持續時間**應該明顯變短
- 理由是「能量」的次數變少；「見底」的比例會相對變高
  （§4 不碰見底型，而它本來就佔 41~45%）
- **不該出現**：意圖在 `extend` 與別的意圖之間高頻跳動 —— 那表示 churn
  惡化，spec §4.3 的「不需要冷卻」就錯了

- [ ] **Step 6：commit**

```
feat: recoverExit 掃描定值、全套回歸、回填 spec

兩階段選值：安全硬護欄先過，再取 churn 最低者。不用效果量選值，因為
recoverExit 只控制 recovered 何時失效，三檔在效果量上會同分。
```

---

## Self-Review

**Spec 覆蓋**：

| spec 節 | Task |
|---|---|
| §4.1 新閂鎖與合取 | 1、2 |
| §4.2 更新順序、`minDwell` | 1 Step 3、2 Step 1 的註記 |
| §4.3 不需要冷卻 | 5 Step 2 的 churn（**這是它唯一的證據**） |
| §4.4 兩個門檻的定法 | 1 Step 1 第一條測試、5 |
| §4.5 HUD 不動 | 沒有任何 Task 碰 `src/hud/` |
| §5.1 消融、率、開關 | 3、4 |
| §5.2 存活性 | 4 Step 1 的第二、三條斷言 |
| §5.3 §9 的門檻 | 5 Step 5 |
| §5.4 副判準 | 5 Step 4 |
| §5.5 出場路徑計量 | 5 Step 1（既有探針就在量） |
| §5.6 churn | 5 Step 2 |
| §6 掃描與選值 | 5 |
| §7 但書的觀測窗 | 5 Step 1 |
| §8.2b replay digest | 5 Step 4 |

**刻意沒有做的**：

- **沒有為 §9 寫錨點漂移的統計。** 那是一個可能永遠不會發生的決定的輸入，
  用 Task 4 已經印出的離場距離判斷就夠。
- **沒有寫 `AiController.rulesConfig` 的單元測試。** 純接線，Task 4 跑得
  起來就是證明。
- **沒有把診斷塞進整合測試。** 專案既有的分工是「測試斷言少而準，量測放
  探針」，而 `extend-exit.probe.ts` 已經在量那些。

**型別一致性**：`recoverExit` / `recoveredExit` / `extendRecoveredLatch`
三個名字在 Task 1 定義，2–5 全部沿用同一組拼寫，已逐一核對。
