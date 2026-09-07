# 轉不贏的一方改打能量戰 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `extendTurnLatch`（「我轉不贏他」）從 `extend` 的觸發條件改成
戰術層（boom and zoom）的徵召條件，讓迴旋吃虧的機種改用能量戰法而不是拒戰。

**Architecture:** 五個變更，全部在 AI 三個檔案裡。意圖層 `arbitrate` 拿掉
迴旋這個脫離理由（A）；`engage` 的門票不動（B）；戰術層的名額由 `quota`
抽籤改成「轉不贏就徵召」（C）；徵召者的入場不看距離與再進入條件（D）；
`build` 撞期限改成帶著手上的能量進 `perch`，並用一格綁在輪次上的記憶免除
本輪的能量門檻（E）。配套定值 `buildMax` 13 → 20。

**Tech Stack:** TypeScript、vitest、vite-node（探針）。無新相依。

**Spec:** `docs/superpowers/specs/2026-09-07-turn-disadvantage-doctrine-design.md`

## Global Constraints

- 全部註解與文件用**繁體中文**。註解只寫現狀與理由，不寫沿革、不寫裁決
  出處、不寫被否決的方案（`CLAUDE.md` §1）。
- 改檔案用編輯工具，**不要寫腳本做字串取代**（`CLAUDE.md` §2）。
- 熱路徑（240 Hz）不配置記憶體。`settled` 是既有物件上的一個布林欄位，
  就地改寫。
- `npx tsc --noEmit` 的既存錯誤基準是 **24 行**。每個任務結束前比對，
  不得增加。
- 測試指令：`npx vitest run <path>`。探針：`npx vite-node <path>`
  （`tsx` 會 `__name is not defined`）。
- 提交訊息 trailer 只留 `Co-Authored-By`，不加 session 網址。
- **不要 `git add -A`** —— 每次提交列出檔案。
- 護欄的具體門檻已由負責人定值，見 spec §7.1。實作者不得自行調整；
  測不過是實作的問題，不是門檻的問題。
- 量測場景一律 `SEED = 20260907`。`createBattle` 的 seed 只餵飛行員名字，
  同一顆種子逐位元可重現。

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/ai/rules.ts` | 意圖仲裁 | 改 `arbitrate` 一處分支、改 `extendReason` |
| `src/ai/tactics.ts` | 戰術相位機 | 加 `mandatory` 輸入、加 `settled` 狀態、改三處轉移、改 `buildMax` |
| `src/ai/AiController.ts` | 逐機決策的組裝 | 改 `ti.slot` 與 `ti.mandatory` 兩行 |
| `test/integration/turn-disadvantage.test.ts` | 本設計的護欄 | 新增 |
| `test/integration/tactics-off.test.ts` | 戰術層關閉時的等價 | 前提更新 + 基準重錄 |
| `test/fixtures/tactics-baseline.ts` | 上面那支的基準 | 重錄 |
| `test/tools/turn-doctrine.probe.ts` | 意圖／相位／俯衝高度差 | 新增（由 tmp 整理） |
| `test/tools/build-gap.probe.ts` | `build` 期間的能量帳 | 新增（由 tmp 整理） |
| `test/tools/band-by-intent.probe.ts` | 空層鎖逐意圖生效率 | 新增（由 tmp 整理） |

---

### Task 1: 護欄測試（先驗紅）

**Files:**
- Create: `test/integration/turn-disadvantage.test.ts`

**Interfaces:**
- Consumes: `createBattle` / `stepBattle`（`src/battle/setup`）、
  `battleConfigFrom` / `uniform`（`src/battle/skirmish`）、`AiController`。
- Produces: 六條護欄 G1～G6。後續每一個任務結束都要重跑這支。

- [ ] **Step 1: 寫測試**

```ts
import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

/**
 * 迴旋吃虧的一方要改打能量戰，不是拒戰。
 *
 * 【為什麼場景是 20v20 而不是 1v1】`dive` 相位需要一個它比得贏的目標，
 * 而能量帳是對**當前目標**算的。1v1 只有一個目標，能量劣勢時整場都不成立
 * —— 實測 1v1 的循環進不到 `perch`，20v20 進得去。這一層的設計本來就是
 * 混戰用的。
 *
 * 【為什麼對照組是同機種而不是關掉功能】關掉功能要多一個旗標，而旗標會
 * 被忘記拿掉。同機種對戰的 `airframeTurnAdvantage` 是 0，徵召條件天然
 * 不成立 —— 對照組因此由**資料**產生而不是由開關產生。
 *
 * 【為什麼不列「射擊解提升」】改動前 4.1%、改動後 4.3%，本設計解不掉。
 * 把解不掉的東西寫成護欄只會得到一條永遠紅的測試。原因見 spec §5.4。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907

interface Sample {
  alive: number
  extend: number
  engage: number
  build: number
  dives: number
  diveAltMedian: number
  intents: Record<string, number>
}

function measure(blue: string, red: string, perSide: number): Sample {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform(blue, perSide, red, perSide)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const isBlue = cs.map(c => b.blue.includes(c))
  const intents: Record<string, number> = {}
  const diveAlt: number[] = []
  let alive = 0, extend = 0, engage = 0, build = 0, dives = 0
  const prevPhase: string[] = cs.map(() => 'off')
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const a = c.controller
      if (!(a instanceof AiController) || !c.alive || !isBlue[i]) continue
      alive += DT
      intents[a.intent] = (intents[a.intent] ?? 0) + DT
      if (a.intent === 'extend') extend += DT
      if (a.intent === 'engage') engage += DT
      const p = a.tactics.phase
      if (p === 'build') build += DT
      if (p === 'dive' && prevPhase[i] !== 'dive') {
        dives++
        diveAlt.push(a.sit.altitudeAdvantage)
      }
      prevPhase[i] = p
    }
  }
  const sorted = [...diveAlt].sort((x, y) => x - y)
  return {
    alive, extend, engage, build, dives,
    diveAltMedian: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN,
    intents,
  }
}

describe('轉不贏的一方改打能量戰', () => {
  it('F4F 對 A6M：六條護欄', { timeout: 600_000 }, () => {
    const s = measure('f4f4', 'a6m5', 20)

    // G1 `engage` 不再是結構上不可達（改動前 0.0%）
    expect(s.engage / s.alive, 'G1 engage 佔時').toBeGreaterThan(0)

    // G2 完整循環真的走到攻擊相位（改動前 0 次）
    expect(s.dives, 'G2 dive 進入次數').toBeGreaterThanOrEqual(5)

    // G3 自鎖斷開（改動前 54.6%）
    expect(s.extend / s.alive, 'G3 extend 佔時').toBeLessThan(0.45)

    // G4 俯衝時真的有高度優勢。單位是公尺——這是負責人給的判準單位
    expect(s.diveAltMedian, 'G4 俯衝時高度優勢中位').toBeGreaterThan(300)

    // G6 不會變成「無腦爬升」
    expect(s.build / s.alive, 'G6 build 佔時').toBeLessThan(0.30)
  })

  /**
   * G5：轉得贏的一方一個字都不能變。
   *
   * 【為什麼是變異測試的錨】把 `ti.mandatory` 寫成恆真、或把徵召條件的
   * `||` 寫成 `&&`，主判準那一組看起來會更好（全隊都去蓄能就不容易死），
   * 只有這一條會紅。實測抓過一次：掃描第一版誤用 `quota = 1` 徵召所有人，
   * 這一組的 `engage` 由 12.1% 掉到 0.0%。
   */
  it('G5 同機種對戰不受影響', { timeout: 600_000 }, () => {
    const s = measure('f4f4', 'f4f4', 20)
    expect(s.dives, 'G5 同機種不得進入戰術層').toBe(0)
    expect(s.build, 'G5 同機種不得進入 build').toBe(0)
    expect(s.engage / s.alive, 'G5 同機種的 engage 佔時').toBeGreaterThan(0.10)
  })
})
```

- [ ] **Step 2: 跑，確認 G1～G4、G6 全紅、G5 全綠**

Run: `npx vitest run test/integration/turn-disadvantage.test.ts`

Expected：第一個 `it` 失敗於 **G1**（`engage 佔時` 是 0，不 > 0）。
第二個 `it` **通過** —— 它是對照組，改動前後都該綠。

若 G5 一開始就紅，停下來：代表量測本身有問題，不要往下做。

- [ ] **Step 3: 提交**

```bash
git add test/integration/turn-disadvantage.test.ts
git commit -m "test: 轉不贏改打能量戰的六條護欄（先驗紅）"
```

---

### Task 2: 變更 A —— 迴旋不再是脫離的理由

**Files:**
- Modify: `src/ai/rules.ts`（`arbitrate` 的相對理由分支、`extendReason`）

**Interfaces:**
- Consumes: 無新相依。
- Produces: `extendReason` 的回傳字串不再含「迴旋」。唯一消費端是
  `src/main.ts:1770`（HUD），不需改動。

- [ ] **Step 1: 改 `arbitrate`**

把

```ts
  if (
    !shooting
    && (weakAndSlow || s.extendTurnLatch)
    && sit.range < cfg.extendRange
  ) return 'extend'
```

改成

```ts
  if (
    !shooting
    && weakAndSlow
    && sit.range < cfg.extendRange
  ) return 'extend'
```

- [ ] **Step 2: 改那一段的註解**

原本那段註解解釋「相對理由 vs 絕對理由」時把迴旋算進相對理由。現在迴旋
不走這條路，註解要跟著改。把該分支上方的說明改成：

```ts
  // 【能量理由是合取】「我比他弱」（相對）與「我還飛不動」（絕對）是兩件
  // 事，兩件都成立才該脫離。速度補回來了就回去打 ——「比對手強」那個出場
  // 條件對劣勢方在整場戰鬥中都達不到，實測能量閂鎖曾連續開著 166 秒。
  //
  // 【迴旋劣勢不在這裡】`extendTurnLatch` 是**打法的選擇**，不是脫離的
  // 理由：轉不贏他的飛機照樣要靠近他打，只是不能跟他繞圈。它改由戰術層
  // 消費（`AiController` 的 `ti.mandatory`），走 boom and zoom 那條路。
```

- [ ] **Step 3: 改 `extendReason`**

刪掉迴旋那一行：

```ts
export function extendReason(s: RuleState): string {
  const parts: string[] = []
  if (s.extendEnergyLatch) parts.push('能量')
  if (s.extendFloorLatch) parts.push('見底')
  if (s.altFloorLatch) parts.push('高度')
  return parts.length > 0 ? parts.join('+') : '無'
}
```

並在函數註解裡補一句（取代原本「三個都成立就全列」的說法）：

```ts
/**
 * `extend` 是被哪一個閂鎖推過去的，供 HUD 顯示。**成立的全列。**
 *
 * 【為什麼沒有迴旋】`extendTurnLatch` 不再推 `extend`（見 `arbitrate`）。
 * 列一個不成立的因果會讓 HUD 指著錯的原因，而那是人工驗收唯一看得到的
 * 東西。「這架被徵召去打能量戰」屬於戰術相位，不掛在 `extend` 底下。
 */
```

- [ ] **Step 4: 跑既有測試，確認沒有別的東西依賴舊行為**

Run: `npx vitest run test/unit/ai-rules.test.ts test/integration/extend-recovery.test.ts`

Expected：`ai-rules.test.ts` 可能有一條斷言 `extendTurnLatch` 造成 `extend`。
若有，那條測試的**前提已經改變**：把它改成斷言「迴旋閂鎖成立但不足以造成
`extend`」，並在測試註解寫明理由。不要刪掉那條測試。

- [ ] **Step 5: 跑護欄，確認 G3 往下走但整體仍紅**

Run: `npx vitest run test/integration/turn-disadvantage.test.ts`

Expected：G1 仍紅（戰術層還沒接上，`engage` 仍是 0）。G5 仍綠。

- [ ] **Step 6: `tsc` 比對基準**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: `24`

- [ ] **Step 7: 提交**

```bash
git add src/ai/rules.ts test/unit/ai-rules.test.ts
git commit -m "feat(ai): 迴旋劣勢不再是 extend 的理由"
```

---

### Task 3: 變更 C + D 的介面 —— `TacticalInput.mandatory`

**Files:**
- Modify: `src/ai/tactics.ts`（`TacticalInput` 介面、`stepTactics` 的入場）
- Modify: `src/ai/AiController.ts`（`ti.slot` 與 `ti.mandatory`）

**Interfaces:**
- Consumes: `RuleState.extendTurnLatch`（`src/ai/rules.ts`，既有欄位）。
- Produces: `TacticalInput.mandatory: boolean`。`stepTactics` 讀它。

- [ ] **Step 1: 在 `TacticalInput` 加欄位**

在 `slot` 下面加：

```ts
  /**
   * 徵召：這架飛機沒有別的打法可選（機體迴旋明顯吃虧）。
   *
   * 【與 `slot` 的分工】`slot` 是「有名額」—— 一個與機種無關的抽籤，用來
   * 控制有多少架轉得贏的飛機也去打能量戰。`mandatory` 是「非這樣不可」，
   * 它不佔名額、也不受名額限制。
   *
   * 【它豁免哪兩道門】入場的距離門檻與再進入條件（見 `stepTactics` 的
   * `off → build`）。那兩道門的前提都是「這架飛機還有別的事可做」，對
   * 徵召者不成立 —— 它們對它會變成永久關門而不是節流。
   */
  mandatory: boolean
```

- [ ] **Step 2: `stepTactics` 的入場改成認徵召**

```ts
  if (s.phase === 'off') {
    if (!inp.mandatory && !s.farLatch) return
    // 【再進入條件】同一個目標、同樣打不動的能量，不會一直重試。少了它，
    // `build → cooldown → off → 立刻 build → …` 會永遠繞下去。
    //
    // 【徵召者豁免】它沒有別的打法可選，「不再重試」對它等於永久失效。
    // 節流改由 `cooldownSeconds` 與 `longCooldownSeconds` 承擔 —— 那兩個
    // 是時間，會自己走完。
    const fresh = Number.isNaN(s.lastCooldownRatio)
      || inp.energyRatio > s.lastCooldownRatio
    if (!inp.mandatory && !fresh) return
    enter(s, 'build')
    openCycle(s, inp.energyRatio)
    return
  }
```

- [ ] **Step 3: `AiController` 餵這兩格**

把

```ts
      ti.slot = this.slotHas
```

改成

```ts
      ti.slot = this.slotHas || this.rules.extendTurnLatch
      // 【徵召的來源是機體比較，不是當下態勢】`extendTurnLatch` 讀的是
      // `airframeTurnAdvantage`，對一組機種對幾乎是常數。那個性質讓它
      // 不適合當「此刻要不要撤」的開關（會永遠鎖著），卻正好適合當
      // 「這一對該用哪種打法」的開關 —— 打法本來就該整場一致。
      ti.mandatory = this.rules.extendTurnLatch
```

- [ ] **Step 4: 補 `tacticalInput` 的初始值**

`AiController` 裡建立 `this.tacticalInput` 的那個物件字面量要加
`mandatory: false`，否則 TypeScript 會報缺欄位。

- [ ] **Step 5: `tsc` 比對基準**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: `24`

- [ ] **Step 6: 跑護欄**

Run: `npx vitest run test/integration/turn-disadvantage.test.ts`

Expected：G1 應該由 0 變成正數（`dive` 相位開始覆寫意圖）。
**G2 很可能仍紅** —— 循環還會卡在 build↔cooldown，那是 Task 4 要解的。
G5 必須仍綠：同機種的 `extendTurnLatch` 是 false，這兩行對它是恆等式。

- [ ] **Step 7: 提交**

```bash
git add src/ai/tactics.ts src/ai/AiController.ts
git commit -m "feat(ai): 戰術層改由迴旋劣勢徵召，徵召者豁免入場的兩道門"
```

---

### Task 4: 變更 E —— 撞期限就拿手上的能量去打

**Files:**
- Modify: `src/ai/tactics.ts`（`TacticalState`、`createTacticalState`、
  `resetTacticalState`、`openCycle`、`stepTactics` 的兩處轉移）

**Interfaces:**
- Consumes: `TacticalState`（既有）。
- Produces: `TacticalState.settled: boolean`。

- [ ] **Step 1: 在 `TacticalState` 加欄位**

放在 `farLatch` 下面：

```ts
  /**
   * 本輪的蓄能已經跑滿期限：能量門檻對這一輪免除。
   *
   * 【為什麼不能用 `perchLatch` 代替】那個閂鎖每一拍由
   * `latch(perchLatch, energyRatio, perchEnter, perchExit)` 重算。把它設成
   * true，`energyRatio` 低於 `perchExit` 的下一拍就被打回 false。這一格的
   * 生命週期綁在**一輪**上，不綁在能量上。
   *
   * 【壞掉會怎樣，而且不會報錯】少了它，撞期限進 `perch` 的飛機會因為
   * `perchLatch` 為 false 立刻被彈回 `build`，再撞一次期限，再彈回來 ——
   * build ↔ perch 乒乓，`dive` 永遠不會發生。實測 4v4：`dive` 0 次。
   */
  settled: boolean
```

- [ ] **Step 2: 三處生命週期**

`createTacticalState` 的回傳物件加 `settled: false,`（放在 `farLatch` 後面）。

`resetTacticalState` 加 `s.settled = false`（放在 `s.farLatch = false` 後面）。

`openCycle` 加 `s.settled = false`：

```ts
function openCycle(s: TacticalState, energyRatio: number): void {
  s.cycleBase = energyRatio
  s.cycleValid = true
  s.cycleShot = false
  s.settled = false
}
```

- [ ] **Step 3: `build` 撞期限改去 `perch`**

```ts
  // ── 第 2 級：絕對止損 ────────────────────────────────
  //
  // 【撞期限不是放棄這一輪】蓄能是盡力而為：跑滿期限代表「這就是我拿得到
  // 的能量」，那就帶著它去等機會。實測累積速率 0.0057 /s，由進場的 0.16
  // 爬到 `perchEnter` 0.5 需要約 60 秒 —— 而 60 秒不可能不被打斷。要求
  // 「蓄滿才准打」等於永遠不准打。
  if (s.phase === 'build' && s.dwell >= cfg.buildMax) {
    s.settled = true
    enter(s, 'perch')
    return
  }
```

- [ ] **Step 4: `perch` 的退場認 `settled`**

```ts
    case 'perch':
      if (s.commit >= cfg.commitSeconds) enter(s, 'dive')
      // 【`settled` 擋掉彈回】撞期限進來的飛機定義上 `perchLatch` 就是
      // false，少了這個條件它會立刻被彈回 `build` 形成乒乓。
      else if (!s.perchLatch && !s.settled) {
        enter(s, 'build')
        openCycle(s, inp.energyRatio)
      }
      break
```

- [ ] **Step 5: `tsc` 比對基準**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: `24`

- [ ] **Step 6: 跑護欄**

Run: `npx vitest run test/integration/turn-disadvantage.test.ts`

Expected：G2（`dive` ≥ 5）應該轉綠。G4 可能仍紅 —— 俯衝高度差在
`buildMax = 13` 時實測是 233 m，低於 300 m 的門檻。那是 Task 5。

- [ ] **Step 7: 提交**

```bash
git add src/ai/tactics.ts
git commit -m "feat(ai): build 撞期限改成帶著現有能量進 perch"
```

---

### Task 5: 定值 —— `buildMax` 13 → 20

**Files:**
- Modify: `src/ai/tactics.ts`（`DEFAULT_TACTICS.buildMax` 與它的註解）

**Interfaces:** 無新介面。

- [ ] **Step 1: 改值與註解**

把 `buildMax: 13` 那一整段註解換成：

```ts
  // 【20 的來源是掃描】13 / 20 / 30 / 45 各跑一次 f4f4 vs a6m5 20v20：
  // 進入 `dive` 時的高度優勢中位分別是 233 / 396 / 409 / 462 m，而
  // 射擊解佔時是 4.5 / 4.3 / 1.6 / 3.7%。取 20 —— 高度優勢過 300 m 的
  // 門檻，射擊解沒有明顯代價。
  //
  // 【它是節奏不是止損】撞到它的時候相位去 `perch` 而不是 `cooldown`
  // （見上面那一段），所以這個值決定的是「花多久蓄能」。訂太大會讓飛機
  // 長時間爬升不參戰 —— 45 秒那一檔有 20.9% 的時間在 `build`。
  buildMax: 20,
```

- [ ] **Step 2: 跑護欄，六條應該全綠**

Run: `npx vitest run test/integration/turn-disadvantage.test.ts`

Expected：兩個 `it` 都通過。若 G4 仍未過 300 m，**不要調門檻** —— 回頭
確認 Task 4 的 `settled` 三處生命週期是不是漏了一處（漏 `openCycle` 會讓
`settled` 跨輪殘留，第二輪之後行為就不對了）。

- [ ] **Step 3: 提交**

```bash
git add src/ai/tactics.ts
git commit -m "feat(ai): buildMax 13 → 20"
```

---

### Task 6: `tactics-off.test.ts` 的前提更新與基準重錄

**Files:**
- Modify: `test/integration/tactics-off.test.ts`
- Modify: `test/fixtures/tactics-baseline.ts`

**背景（實作者必讀）：** 這支測試斷言「`quota = 0` 時與戰術層上線之前逐
位元相同」。變更 C 之後 `quota = 0` **不再代表沒有飛機進戰術層** —— 迴旋
吃虧的機種會被徵召。它的兩個場景：

- `HEADON_20V20` 是 **P-51D vs Bf 109 K-4**，`airframeTurnAdvantage` 是
  −0.026 ～ −0.044，低於 `turnEnter`（−0.02）→ **會被徵召，digest 必變**
- `PURSUIT_MIRROR_8V8` 是 **P-51D vs P-51D**，差值 0 → 不徵召，**digest
  必須不變**

所以這支測試要拆成兩個意思不同的斷言，不是整組重錄。

- [ ] **Step 1: 先確認上面那句話**

Run: `npx vitest run test/integration/tactics-off.test.ts`

Expected：`PURSUIT_MIRROR_8V8` 綠、`HEADON_20V20` 紅。

**若 `PURSUIT_MIRROR_8V8` 也紅，停下來。** 那代表變更漏到了不該碰的機種
對，是實作錯誤，不是基準過期。

- [ ] **Step 2: 改測試的意思**

`PURSUIT_MIRROR_8V8` 那一格保持原樣（比對舊基準），並在 `describe` 的註解
補上：

```ts
/**
 * 戰術層不徵召的機種對，必須與**它上線之前**逐位元相同。
 *
 * 【為什麼只剩鏡像對戰】徵召條件是機體迴旋明顯吃虧
 * （`AiController` 的 `ti.mandatory`），所以同機種的差值恆為 0、恆不徵召
 * —— 它因此是這個等價性唯一還成立的場景，而且是由資料決定的，不靠開關。
 *
 * 【`HEADON_20V20` 為什麼改成另一件事】P-51D vs Bf 109 K-4 的迴旋差值
 * 低於 `turnEnter`，會被徵召，digest 必然改變。那不是回歸，是設計。
 * 它改成量「徵召確實發生了」——見下面第二個 `it`。
 */
```

- [ ] **Step 3: `HEADON_20V20` 改成斷言徵召有發生**

把那一格由 digest 比對改成：

```ts
  it('HEADON_20V20：迴旋吃虧的一方會被徵召進戰術層', { timeout: 300_000 }, async () => {
    const b = createBattle(new Idle(), SCENES.HEADON_20V20(), SEED)
    const ais: AiController[] = []
    for (const c of b.world.combatants) {
      if (c.controller instanceof AiController) {
        c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota: 0 }
        ais.push(c.controller)
      }
    }
    let anyPhase = 0
    for (let k = 0; k < STEPS; k++) {
      stepBattle(b, DT)
      if (k % 24 !== 0) continue
      for (const a of ais) if (a.tactics.phase !== 'off') anyPhase++
    }
    // `quota = 0` 而相位仍然離開 `off`，只可能來自徵召
    expect(anyPhase, '徵召的取樣數').toBeGreaterThan(0)
  })
```

- [ ] **Step 4: 檢查 fixture 有沒有孤兒**

若 `test/fixtures/tactics-baseline.ts` 裡的 `HEADON_20V20` 那一筆已經沒有
消費端，把它刪掉並在檔頭註解說明只剩鏡像對戰用得到。**不要留著沒人讀的
基準** —— 它會讓下一個人以為那個等價性還成立。

- [ ] **Step 5: 跑**

Run: `npx vitest run test/integration/tactics-off.test.ts`
Expected: 兩個 `it` 都綠。

- [ ] **Step 6: 提交**

```bash
git add test/integration/tactics-off.test.ts test/fixtures/tactics-baseline.ts
git commit -m "test: 戰術層等價性縮到不徵召的機種對，徵召場景改斷言徵召發生"
```

---

### Task 7: 全套測試與探針整理

**Files:**
- Create: `test/tools/turn-doctrine.probe.ts`
- Create: `test/tools/build-gap.probe.ts`
- Create: `test/tools/band-by-intent.probe.ts`
- Delete: `test/tools/tmp-*.probe.ts`（七支）

- [ ] **Step 1: 跑全套**

Run: `npx vitest run`

Expected：全綠。**若有別的測試紅了，逐條判斷是「前提改變」還是「改壞了」**
—— 前者改測試並在註解寫明新前提，後者回頭修實作。不要為了讓測試變綠而
放寬護欄。

- [ ] **Step 2: 把三支暫存探針整理成正式的**

`tmp-tactics-reach` + `tmp-buildmax-scan` 的量測欄位合併成
`turn-doctrine.probe.ts`：意圖佔時、相位佔時、射擊解、存活、`dive` 次數與
俯衝高度差，含 `f4f4 vs f4f4` 對照組。檔頭註解要寫「回答什麼問題」與
「跑法」，照 `test/tools/extend-why.probe.ts` 的格式。

`tmp-build-gap` → `build-gap.probe.ts`，`tmp-band-by-intent` →
`band-by-intent.probe.ts`，同樣補檔頭。

- [ ] **Step 3: 刪掉七支暫存探針**

七支都是未追蹤的檔案，直接刪：

```bash
rm test/tools/tmp-20v20.probe.ts test/tools/tmp-band-by-intent.probe.ts \
   test/tools/tmp-build-gap.probe.ts test/tools/tmp-buildmax-scan.probe.ts \
   test/tools/tmp-phase-count.probe.ts test/tools/tmp-ratio-metres.probe.ts \
   test/tools/tmp-tactics-reach.probe.ts
```

- [ ] **Step 4: 三支探針各跑一次，確認能跑**

Run:
```bash
npx vite-node test/tools/turn-doctrine.probe.ts
npx vite-node test/tools/build-gap.probe.ts
npx vite-node test/tools/band-by-intent.probe.ts
```

- [ ] **Step 5: `tsc` 比對基準**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: `24`

- [ ] **Step 6: 提交**

```bash
git add test/tools/turn-doctrine.probe.ts test/tools/build-gap.probe.ts \
  test/tools/band-by-intent.probe.ts
git commit -m "test: 本設計的三支量測探針"
```

---

### Task 8: 變異測試 —— 護欄殺得死嗎

**Files:** 暫時改動後改回，不提交。

**為什麼要做：** 專案規則「護欄要能被殺死才算數」。G1～G4、G6 已經先驗過
紅（Task 1），但 **G5 沒有** —— 它從頭到尾是綠的，所以要證明它殺得死。

- [ ] **Step 1: 把徵召條件改成恆真**

`src/ai/AiController.ts`：`ti.mandatory = this.rules.extendTurnLatch`
→ `ti.mandatory = true`；`ti.slot` 同樣改成 `true`。

- [ ] **Step 2: 跑護欄，G5 必須紅**

Run: `npx vitest run test/integration/turn-disadvantage.test.ts`
Expected: 第二個 `it` 失敗（同機種進了戰術層）。

**若 G5 仍綠，護欄是假的**，回頭修測試。

- [ ] **Step 3: 用編輯工具改回來**

**不要用 `git checkout` 還原** —— 用編輯工具把那兩行改回原狀，再跑一次
確認全綠、`git diff` 是空的。

- [ ] **Step 4: 確認工作樹乾淨**

Run: `git status --porcelain`
Expected: 空。

---

### Task 9: 試玩前的最後檢查

- [ ] **Step 1: `tsc`**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: `24`

- [ ] **Step 2: 全套測試**

Run: `npx vitest run`
Expected: 全綠。

- [ ] **Step 3: 開發伺服器起得來**

Run: `npx vite --port 5173`（背景），開 `http://localhost:5173`，
確認主選單載入、可以開一場 20v20 遭遇戰。

- [ ] **Step 4: 交給負責人試飛**

要看的四件事（spec §7.2）：

1. F4F 會不會主動切進去、打一輪、拉開、再回來
2. 會不會變成「衝進去被零戰纏住」的另一種死法
3. 會不會出現「爬完逃、逃完爬」的節奏
4. 空層鎖與戰術層有沒有互相拉扯 —— 症狀是俯衝進場時機頭忽上忽下，
   或明明敵人在下方卻維持平飛（spec §9.5）

**這一步不是我能判定的。** 數據只證明機制通了；「玩起來像不像那麼回事」
只有試飛回答得了。
