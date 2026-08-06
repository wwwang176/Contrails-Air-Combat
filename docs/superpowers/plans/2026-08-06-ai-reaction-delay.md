# AI 反應延遲 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。步驟用 `- [ ]` 追蹤。

**Goal:** 讓 `DifficultyProfile.reactionDelay` 真的生效——把 AI 的輸出指令延後 n 步，安全層排在延遲之後。

**Architecture:** 一個環形緩衝區（`src/ai/delay.ts`）把 `Command` 的四個欄位延後；`AiController` 把三條輸出路徑寫進私有的 `raw`，經緩衝區流進 `out`，最後才套安全層。零延遲走位元等價的捷徑，所以既有測試逐值不變。

**Tech Stack:** TypeScript、three.js（僅 `Vector3`）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-06-ai-reaction-delay-design.md`

## Global Constraints

- 不得引入 `@types/node`（沒有 `node:path`、`__dirname`、`process`、`fs`）。
- `noUncheckedIndexedAccess` 開啟。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`。
- 每一條新測試先驗紅。
- **不得為了讓測試通過而放寬門檻**；若斷言本身錯了，改斷言並說明理由。
- commit 指定明確路徑，**不得 `git add -A`**。
- 型別檢查：`npx tsc --noEmit`。
- 不寫飛機外形的測試。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/ai/delay.ts`（新） | `CommandDelay` 環形緩衝區、`MAX_REACTION_DELAY` |
| `src/ai/profile.ts`（改） | 新增 `VETERAN` |
| `src/ai/AiController.ts`（改） | 三條輸出路徑收斂到 `raw` → 延遲 → 安全層 |
| `src/battle/setup.ts`（改） | `BattleConfig.aiProfile`，三處建構點套上 |
| `src/battle/skirmish.ts`（改） | 遊戲的 config 帶 `VETERAN` |
| `test/unit/ai-delay.test.ts`（新） | 緩衝區的五條性質 |
| `test/integration/ai-reaction-delay.test.ts`（新） | 出貨設定的兩條 |

---

### Task 1：`CommandDelay` 環形緩衝區

**Files:** Create `src/ai/delay.ts`、`test/unit/ai-delay.test.ts`

**Produces:** `MAX_REACTION_DELAY: number`、`class CommandDelay { push(input: Command, delaySeconds: number, dt: number, out: Command): void }`

- [ ] **Step 1: 寫失敗的測試** —— spec §6.1 的五條：零延遲位元等價、延遲 n 步取到 n 步前的輸入、priming 不吐零向量、超過上限被夾住、關掉再開會重新 prime。用一串可辨識的假指令（`aimWorld` 的 x 帶序號）。
- [ ] **Step 2: 跑測試驗紅** —— `npx vitest run test/unit/ai-delay.test.ts`，預期「找不到模組」。
- [ ] **Step 3: 實作** —— `SLOTS = 256`；`aimWorld` 存 `Float32Array(3 * SLOTS)`，`throttle` / `brake` 各一條 `Float32Array(SLOTS)`，`firing` 一條 `Uint8Array(SLOTS)`；`primed` 旗標；`steps <= 0` 走捷徑並清 `primed`；`push` 不配置。
- [ ] **Step 4: 跑測試驗綠**，並 `npx tsc --noEmit`。
- [ ] **Step 5: commit** —— `git add src/ai/delay.ts test/unit/ai-delay.test.ts`

### Task 2：`AiController` 接上延遲，安全層後移

**Files:** Modify `src/ai/AiController.ts`

**Consumes:** Task 1 的 `CommandDelay`

- [ ] **Step 1: 先確認既有測試全綠**（這是位元等價的基準）—— `npx vitest run test/unit test/integration`
- [ ] **Step 2: 改寫 `update()`** —— 新增 private `raw = createCommand()`、private `delay = new CommandDelay()`；三條輸出路徑（站位、平飛、主路徑）全部寫進 `this.raw`；刪掉分支裡的兩個 `applySafety` 呼叫；結尾統一 `this.delay.push(this.raw, this.profile.reactionDelay, dt, out)` 再 `this.safetyActive = applySafety(self, this.seaHeight, out)`。註解寫清楚「安全層為什麼在延遲之後」。
- [ ] **Step 3: 驗證位元等價** —— 全部既有測試逐值不變（`ACE` 是預設，延遲走捷徑）。任何數值變動代表捷徑沒做到，回頭修實作。
- [ ] **Step 4: 效能** —— 確認沒有 vite dev server、沒有開著遊戲的瀏覽器分頁，單獨跑 `npx vitest run test/performance/ai-load.test.ts`。
- [ ] **Step 5: commit** —— `git add src/ai/AiController.ts`

### Task 3：掃描延遲值，定 `VETERAN`

**Files:** Modify `src/ai/profile.ts`

- [ ] **Step 1: 寫掃描探針**（`test/_probe.test.ts`，不進 commit）—— 同機種 1v1、≥12 開局、300 秒，延遲方 vs 零延遲方，掃 `reactionDelay ∈ {0.15, 0.20, 0.30, 0.40, 0.50}`，記錄零延遲方勝率與延遲方的觸地數。
- [ ] **Step 2: 跑掃描，讀表**
- [ ] **Step 3: 新增 `VETERAN`** —— 取**最小的、能讓零延遲方勝率明顯過半**的值；掃描表寫進 `profile.ts` 的註解。
- [ ] **Step 4: 補 `test/unit/ai-controller.test.ts` 的 `VETERAN.reactionDelay > 0`**，驗紅再驗綠。
- [ ] **Step 5: 刪掉探針**，commit `src/ai/profile.ts test/unit/ai-controller.test.ts`

### Task 4：`BattleConfig.aiProfile`，遊戲吃 `VETERAN`

**Files:** Modify `src/battle/setup.ts`、`src/battle/skirmish.ts`；Create `test/integration/ai-reaction-delay.test.ts`

**Consumes:** Task 3 的 `VETERAN`

- [ ] **Step 1: 寫失敗的整合測試** —— spec §6.4 的兩條：(a) `VETERAN` 對 `ACE` 的 1v1 勝率顯著低於五成；(b) `VETERAN` 的 20v20 觸地損失不高於 `ACE` 同場。門檻依 Task 3 的實測填，實測數字寫進註解。
- [ ] **Step 2: 驗紅**（此時 `BattleConfig` 還沒有 `aiProfile`，型別就會擋）
- [ ] **Step 3: 實作** —— `BattleConfig` 新增 `aiProfile: DifficultyProfile`；`DEFAULT_BATTLE.aiProfile = ACE`；`createBattle`、`resetBattle`、還座位那三處新建 `AiController` 之後設定 `ai.profile`；`battleConfigFrom` 回傳 `aiProfile: VETERAN`。
- [ ] **Step 4: 驗綠**，跑全套 + `npx tsc --noEmit`
- [ ] **Step 5: commit** —— 指定路徑

### Task 5：收尾

- [ ] **Step 1: 全套測試** —— `npx vitest run`
- [ ] **Step 2: 把 §2 的兩個附帶結論寫進 `src/ai/steer.ts` 的 `DEFAULT_STEER` 註解** —— 「力道連續化」那一段補上「控制迴路飽和 → 0.25/0.5/0.75 三行相同」的新根因與延遲掃描表；「異平面破防」那一段補上「延遲下復活但高度成本不變」的表，並寫明重試的前提是先解決高度。
- [ ] **Step 3: commit**
