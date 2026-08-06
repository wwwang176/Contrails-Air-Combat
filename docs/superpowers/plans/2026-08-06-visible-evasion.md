# 看得見的閃躲 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。步驟用 `- [ ]` 追蹤。

**Goal:** 讓玩家在後方射擊時**看得出來** AI 在閃 —— 主判準是「預瞄點 1 秒內位移 ≥ 5°」。

**Architecture:** 三層。(1) 新的**警戒訊號**（純幾何，無距離衰減、射程由武器決定）取代命中機率當 `defend` 的觸發判準；(2) 破防軸換成**攻擊者的機動平面**（由 stash 還原）；(3) 攻擊者衝過頭時**反轉**。

**Tech Stack:** TypeScript、three.js（僅 `Vector3`）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-06-visible-evasion-design.md`

## Global Constraints

- 不得引入 `@types/node`。
- `noUncheckedIndexedAccess` 開啟。
- `src/world/` 不得 import `src/render/`、`src/hud/`。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體。
- **不得改動 `threatFactor` 的內部**（浮點漂移會動搖全部既有基準）。
- 每一條新測試先驗紅。
- **不得為了讓測試通過而放寬門檻**；門檻要改必須由專案負責人裁定。
- commit 指定明確路徑，**不得 `git add -A`**。
- 型別檢查：`npx tsc --noEmit`。效能門檻**單獨跑**。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/ai/assess.ts`（改） | `alarmFactor`、`alarmRamp`、`ALARM_CONE`、`ALARM_SATURATION` |
| `src/ai/AiController.ts`（改） | `alarmSeconds` 累加、`danger = max(threat, alarm)`、`scanThreat` 改用 `alarmFactor` |
| `src/ai/steer.ts`（改） | 由 stash 還原 `DefendState` / `stepDefend` / `breakAxis`；新增反轉 |
| `test/unit/ai-assess.test.ts`（改） | `alarmFactor` 的性質 |
| `test/integration/ai-visible-evasion.test.ts`（新） | **主判準**：預瞄點位移與觸發涵蓋率 |

---

### Task 1：`alarmFactor` —— 警戒訊號

**Files:** Modify `src/ai/assess.ts`、`test/unit/ai-assess.test.ts`

**Produces:** `ALARM_CONE`、`ALARM_SATURATION`、`alarmFactor(shooter, victim): number`、`alarmRamp(seconds): number`

- [ ] **Step 1: 寫失敗的測試**
  - 正後方 500 m、機首對準 → 接近 1
  - **正後方 1000 m、機首對準 → 仍然接近 1**（`threatFactor` 在此為 0，這是關鍵差異）
  - 正後方 1500 m（P-51 打不到）→ **0**
  - 偏 15° → 0；偏 7.5° → 約 0.5；單調
  - `alarmFactor ≥ threatFactor` 在一組隨機幾何上恆成立
  - `alarmRamp`：0 → 0、0.25 s → 0.5、≥0.5 s → 1
  - 速度為零、重合位置等退化情形不產生 NaN
- [ ] **Step 2: 驗紅** —— `npx vitest run test/unit/ai-assess.test.ts`
- [ ] **Step 3: 實作。** 與 `threatFactor` **刻意重複**前八行，兩邊互相指名並寫明理由（`threatFactor` 是全部基準的來源，不重構）。自己的 scratch，不配置。
- [ ] **Step 4: 驗綠 + `npx tsc --noEmit`**
- [ ] **Step 5: commit** —— `git add src/ai/assess.ts test/unit/ai-assess.test.ts`

### Task 2：主判準的量測工具（先寫測試，此時應該是紅的）

**Files:** Create `test/integration/ai-visible-evasion.test.ts`

**Consumes:** 無（純量測）

- [ ] **Step 1: 寫場景。** 三機：藍方 AI 追腳本 `Lazy`（0.05 rad/s 水平盤旋）、紅 B 是腳本 `Sniper`（準星壓在預瞄點、連續開火、油門維持 standoff）。180 秒，子彈無傷害。
- [ ] **Step 2: 寫指標。** 由紅 B 指向藍方預瞄點的單位向量，1 秒滑動窗（240 格）的角位移；只採「紅 B 有射擊解且距離 300~2000 m」的取樣；依 `intent === 'defend'` 拆兩組。
- [ ] **Step 3: 寫斷言**（spec §5.1、§5.2）
  - 觸發涵蓋率 > 50%
  - `defend` 期間位移中位數 ≥ 5°
  - 同向性：1 秒窗的淨位移 ÷ 逐格位移總和 ≥ 0.5
- [ ] **Step 4: 驗紅。** 預期涵蓋率 0.0%、中位 0°（基準線實測值）。**把實測的紅燈數字抄進測試註解。**
- [ ] **Step 5: commit** —— 只 commit 測試檔

### Task 3：接上警戒訊號

**Files:** Modify `src/ai/AiController.ts`

**Consumes:** Task 1 的 `alarmFactor` / `alarmRamp`

- [ ] **Step 1: 記錄全部既有基準。** 跑 `ai-manoeuvre` / `ai-duel-matrix` / `ai-defence` / `multi-battle`，**把數值抄下來**（spec §5.3 要拿它們去交裁定）。
- [ ] **Step 2: 實作**
  - `scanThreat` 改用 `alarmFactor` 評分
  - 新增公開欄位 `alarmSeconds`；在警戒幾何成立時累加、否則歸零
  - `danger = Math.max(threat, alarmFactor(attacker, self) * alarmRamp(alarmSeconds))`
  - 傳給 `stepRules` 的改成 `danger`；`stepRules` 簽章不變
- [ ] **Step 3: 跑 Task 2 的測試。** 涵蓋率應該由 0% 大幅上升。**若中位位移已經 ≥ 5°，Task 4/5 就是錦上添花，要在報告裡講清楚。**
- [ ] **Step 4: 跑全套，把變紅的門檻與新舊數值整理成一張表。**
- [ ] **Step 5: 停下來交裁定。** 不改任何門檻。把表交給專案負責人，等他決定新值。
- [ ] **Step 6: commit** —— `git add src/ai/AiController.ts`

### Task 4：異平面破防（由 stash 還原）

**Files:** Modify `src/ai/steer.ts`、`src/ai/AiController.ts`、`test/unit/ai-steer.test.ts`

- [ ] **Step 1: `git stash apply "stash@{0}"`**，解衝突（已知 `AiController.ts` 與 `ai-defence.test.ts` 會衝突；`AiController` 要寫進 `raw` 不是 `out`）
- [ ] **Step 2: `npx tsc --noEmit`** 與 `test/unit/ai-steer.test.ts`
- [ ] **Step 3: 掃 `defendFloor` ∈ {600, 2000, ∞}**，在**警戒已上線**的前提下，量 12 幾何 × 300 秒的觸地場次與最低高度
- [ ] **Step 4: 判定。** 若三個值都壓不下觸地（護欄：不得高於同場同平面版本），**整段撤回**，理由寫進 `DEFAULT_STEER` 註解（比照前五次）
- [ ] **Step 5: 掃描表寫進 `defendFloor` 註解，commit**

### Task 5：反轉（只做瞄準）

**Files:** Modify `src/ai/steer.ts`、`test/unit/ai-steer.test.ts`

- [ ] **Step 1: 寫失敗的單元測試** —— 三個條件各自不成立時都不觸發；三個都成立時瞄準點轉向攻擊者的追擊解；倒數期間即使條件消失仍然維持（`reversalHold`）
- [ ] **Step 2: 驗紅**
- [ ] **Step 3: 實作。** `DefendState` 新增 `reversal: number`（剩餘秒數），`stepDefend` 維護；`steerCommand` 的 `defend` 分支在 `reversal > 0` 時改用對攻擊者的追擊瞄準。**不碰 `target.ts`。**
- [ ] **Step 4: 驗綠；掃 `reversalRange` / `reversalAspect` / `reversalHold`**
- [ ] **Step 5: commit**

### Task 6：收尾

- [ ] **Step 1: 全套 + 效能門檻單獨跑**
- [ ] **Step 2: 把新的實測值填進各參數註解**
- [ ] **Step 3: 把「本案沒做的第二階段（子彈近失）」與成本評估寫進 spec §3.4 的追溯位置**
- [ ] **Step 4: commit**
