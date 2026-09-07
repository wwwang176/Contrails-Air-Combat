# 魚雷投放的 HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 掛魚雷時，投彈模式下從入水點沿水中航向畫一條 2,000 m 的航跡線（每 500 m 一刻度、末端標射程），畫面下方與「裝填中」同位、二擇一地顯示逐軸的投放閘門（坡度／俯仰／高度，顯示數值），高度錶長針那一圈加一段可投高度的弧。**不動任何模擬。**

**Architecture:** 三個顯示物共用**同一份包絡與同一個 AGL** —— `main.ts` 把它餵給 `canRelease` 的那一個 `ReleaseEnvelope` 物件與那一個 `agl` 區域變數原封放進 `HudFrame`，widget 只讀這兩格。`canRelease` 改寫成四支逐軸述詞的合取，閘門直接呼叫其中三支，所以「錶上綠燈但投不出去」在結構上不可能發生。航跡線的取樣點在 `main.ts` 投影（那裡才有相機，做法照抄 `BOMB_NDC`），「哪幾個點在相機前面」是一支測得到的純函數。

**Tech Stack:** TypeScript、three.js、vitest、Playwright。`weapons/releaseEnvelope.ts`、`world/torpedo.ts`、`hud/widgets/*` **不 import three**。

**Spec:** `docs/superpowers/specs/2026-09-07-torpedo-hud-design.md`

## Global Constraints

- **不動模擬。** 不碰彈道、不碰包絡的值、不碰命中判定、不碰 AI。`spawn-baseline` 的校驗和、`rematch.test.ts`、`perf-gate.test.ts` 全部不得變 —— 變了就是誤動了模擬，**停下來報告**。
- **門檻只有一份。** widget 內不得出現 `12 * DEG`、`200`、`20` 這種字面值，一律從 `HudFrame.releaseEnv` 讀。
- **高度只有一份。** 閘門與高度弧讀 `HudFrame.releaseAgl`，**不得**讀 `HudFrame.altitude` 再自己減地形。
- **航向只有一份。** `world/torpedo.ts` 轉出 `torpedoHeading`，`stepAir` 與 HUD 兩邊都呼叫它。
- 顏色只用 `HUD_COLORS` 既有的六個，**不新增顏色**（`primary` 就是綠）。
- HUD 每幀不得 `new Vector3()`：投影用預先配置的暫存（照抄 `main.ts` 的 `BOMB_NDC`）；`HudFrame` 上的取樣點是固定長度的預先配置陣列（照抄 `contacts` / `markers`）。
- 註解**只寫事實，不寫討論過程**；設計值一律標「起始值，由試飛裁定」。
- **絕不 `git add -A`**，一律列明確路徑。
- commit message 含中文時寫進暫存檔再 `git commit -F`；**絕不用 PowerShell 讀寫含中文的檔案**。
- 提交訊息結尾只加 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`，**不附 session 網址**。
- 動工前先量 `npx tsc --noEmit` 的基準行數（**不要寫死數字**），每個 Task 結束前比對沒有增加。
- 每一條新測試**先驗紅**，或用 mutation 證明它承重。
- `perf-gate.test.ts` 與 `rematch.test.ts` **單獨跑**。
- **護欄重新定值是負責人的決定。** 測試紅了先量、先報告、先問。

---

### Task 1: `canRelease` 拆成四支逐軸述詞

**Files:**
- Modify: `src/weapons/releaseEnvelope.ts`
- Test: `test/unit/release-envelope.test.ts`

**Interfaces:**
- Produces: `rollOk(env, roll)`、`pitchOk(env, pitch)`、`aglOk(env, agl)`、`tasOk(env, tas)`
- `canRelease` 改寫成四者的合取，**簽章與行為一個字都不變**

**為什麼**（spec §4.3）：閘門要逐軸的結果，`canRelease` 回一個布林。兩邊各寫一份比較就會漂，症狀是「三格全綠而扳機沒反應」，不拋例外也沒有訊息。

- [x] **Step 1: 先量 tsc 基準行數**，記下來
- [x] **Step 2: 寫失敗的測試**
  - 四支述詞各自的邊界：剛好在內為真、剛好在外為假（`<=` / `>=` 都要驗到）
  - `rollOk` 取絕對值：`−89°` 與 `+89°` 同結果
  - **合取律**：掃一格網格（roll、pitch、agl 各取邊界內外若干點，tas 取 0 / 100 / 1e9），逐點斷言
    `canRelease(...) === rollOk && pitchOk && aglOk && tasOk`
  - **NaN 一律為假**（既有 `canRelease` 靠正向比較達成，四支述詞要保持同一性質）
- [x] **Step 3: 實作。** 不得 `new`、不得呼叫三角函數（門檻已存 rad）
- [x] **Step 4:** `test/unit/release-envelope.test.ts` 既有的每一條**都不得修改、不得刪除**，且全綠

**Verification:** 兩個變異的對象不同，要分開驗：

- 動**述詞**（`rollOk` 的 `<=` 改成 `<`）→ 邊界那條紅。**合取律那條不會紅，那是對的** —— `canRelease` 與期望值都由同一支述詞算出來，合取律對述詞本身的改動免疫
- 動 **`canRelease`**（拿掉 `aglOk`）→ **合取律那條紅**。這才是它的守備範圍

---

### Task 2: 水中航向與取樣距離抽成純函數

**Files:**
- Modify: `src/world/torpedo.ts`
- Test: `test/unit/torpedo.test.ts`

**Interfaces:**
- Produces:
  - `TORPEDO_RUN_STEP = 500`（m，起始值）
  - `TORPEDO_RUN_SAMPLES`（= `TORPEDO_RANGE / TORPEDO_RUN_STEP + 1`，**算出來不是寫死**）
  - `runSampleDistance(k: number): number` —— 第 k 點離入水點多遠；**最後一點恰好是 `TORPEDO_RANGE`**
  - `torpedoHeading(vx, vz, noseX, noseZ, out: Float64Array): void` —— 寫進 `out[0]`、`out[1]`，不配置
- Modifies: `stepAir` 改成呼叫 `torpedoHeading`（行為不變）

**為什麼**（spec §5.1）：HUD 要在投放**之前**畫出雷會跑到哪，所以航向的退化分支得在兩個地方各算一次 —— 除非只有一份。

**契約逐字照現行 `stepAir`（`torpedo.ts:306`）：`hl > 1e-9` 才正規化，否則走 nose。** 也就是 `hl === 1e-9` 那一點**走 nose**。寫成「`hl < 1e-9` 才退化」會在等號那一點翻面，而 `stepAir` 呼叫這一支 —— **那是改到模擬**。

- [x] **Step 1: 寫失敗的測試**
  - `runSampleDistance(0) === 0`
  - `runSampleDistance(TORPEDO_RUN_SAMPLES - 1) === TORPEDO_RANGE`（**比的是常數，不是 2000 這個字面值**）
  - 相鄰兩點差恆為 `TORPEDO_RUN_STEP`
  - `torpedoHeading` 回單位向量；`(vx, vz) = (0, 0)` 時退化回 nose；nose 也退化時的行為要釘死
  - **`hl` 恰為 `1e-9` 時走 nose**（邊界那一點，殺 `>` ↔ `>=` 的變異）
  - **`hl` 略大於 `1e-9` 時正規化**（邊界的另一側）
  - **`TORPEDO_RANGE` 改成 2500 時 `TORPEDO_RUN_SAMPLES` 跟著變**（證明沒寫死）
- [x] **Step 2: 實作**
- [x] **Step 3:** `torpedo.test.ts`、`torpedo-vs-ship.test.ts` 全綠 —— **`stepAir` 是改寫不是改行為**，那兩支是它的守門員
- [x] **Step 4:** 加一條 `Torpedoes.step` 的回歸：入水航向在重構前後逐位元相同（`spawn-baseline` 的三個場景**沒有 G4M／魚雷**，指望不上它）

**Verification:** mutation —— `torpedoHeading` 的 `>` 改成 `>=` 之後，`hl === 1e-9` 那條必須紅。`stepAir` 重構前後，`torpedo.test.ts` 裡任何逐位元的彈道斷言不得移動。

---

### Task 3: `HudFrame` 的新欄位

**Files:**
- Modify: `src/hud/types.ts`
- Test: `test/unit/hud.test.ts`（初始值那一組）

**Interfaces:**
```ts
/** 這一幀 `canRelease` 吃的那一個包絡物件。null = 這一台掛不了東西 */
releaseEnv: ReleaseEnvelope | null
/** 這一幀 `canRelease` 吃的那一個離地高度，m */
releaseAgl: number
/** 航跡線取樣點的 NDC 座標。長度恆為 TORPEDO_RUN_SAMPLES */
runX: Float64Array
runY: Float64Array
/** 從第 0 點起連續落在相機前方的點數。< 2 = 不畫 */
runCount: number
```

- [x] **Step 1:** 加欄位與註解；`createHudFrame` 的預設值（`releaseEnv: null`、`releaseAgl: 0`、兩個 `Float64Array(TORPEDO_RUN_SAMPLES)`、`runCount: 0`）
- [x] **Step 2: 加一條新測試給陣列。** 既有的「初始值不含 NaN」是
      `for (const v of Object.values(f)) if (typeof v === 'number')` ——
      **`Float64Array` 是物件，整個被跳過**。長度少一格或元素是 NaN 都不會紅，
      而 typed array 越界寫入不拋例外，症狀是末段航跡與末端刻度**靜靜消失**。
      新測試要明寫：`runX.length === runY.length === TORPEDO_RUN_SAMPLES`，
      且兩條陣列**逐元素**都是有限值
- [x] **Step 3:** 這一步**不畫任何東西**，全套綠、tsc 不增行

**Verification:** mutation —— 把 `Float64Array(TORPEDO_RUN_SAMPLES)` 改成 `Float64Array(TORPEDO_RUN_SAMPLES - 1)` 之後，Step 2 那條必須紅（既有那條不會）。`HudFrame` 是 `Record` 型別的消費者之一，漏掉預設值是編譯錯誤。

---

### Task 4: 航跡線 widget

**Files:**
- Create: `src/hud/widgets/torpedoLine.ts`
- Modify: `src/hud/Hud.ts`（`HudWidget` 聯集、`FULL`、`WIDGET_DRAW`）
- Test: `test/unit/hud-torpedo-line.test.ts`（新）、`test/unit/hud.test.ts`（順序那兩條）

**Interfaces:**
- Produces:
  - `runFrontCount(z: ArrayLike<number>, n: number): number` —— 從 0 起連續 `z < 1` 的點數。**收 `ArrayLike` 不收 `number[]`**：`main.ts` 餵進來的是預先配置的 `Float64Array`（spec §9），簽章寫死 `number[]` 就逼出每幀一次配置
  - `torpedoLineVisible(f: HudFrame): boolean` —— spec §5.7 的條件（陸地那一條在 `main.ts` 就已經讓 `runCount = 0`，這裡只看 `runCount >= 2`）
  - `drawTorpedoLine(ctx, L, f)`
- Modifies: `HudWidget` 加 `'torpedoLine'`；`FULL` 裡**插在 `'bombsight'` 之前**（圈壓在線上面）；`BOMB` 靠既有的 `filter` 自動繼承；`GOD` 不加

**為什麼 `runFrontCount`**（spec §5.4）：`w ≤ 0` 的點投影出來是穿過中心鏡射的 —— 它會落在畫面上、方向剛好相反，canvas 再乾乾淨淨把它裁到邊緣。**得到的是一條線條漂亮、方向錯 180° 的瞄準線，不會報錯。**

- [ ] **Step 1: 寫失敗的測試** —— `runFrontCount`
  - 全部 `z < 1` → n
  - `z[0] >= 1` → 0
  - 中間一個非 front → 停在它之前
  - **後面又變回 front 不得復活**（鏡射線的守門員）
  - 邊界：`z === 1` 算非 front
- [ ] **Step 2: 寫失敗的測試** —— `torpedoLineVisible`
  - 四條各自為假時都不畫（非投彈模式／掛炸彈／`bombState !== 'solved'`／`runCount < 2`）
  - **`bombVisible === false` 但 `runCount >= 2` 時照畫**（spec §5.7：圈滑出畫面時線還有一大段在畫面裡）
- [ ] **Step 3: 實作** `torpedoLine.ts`
  - 顏色走 `bombsightColor('ring', f.releaseOk)`，**從 `bombsight.ts` import，不得自己判一次**
  - 刻度是垂直於線的短橫；末端那一格長一截並標 `2000`（值取自 `TORPEDO_RANGE`，不寫死）
  - 線寬 `1 * L.scale`，與落點圈相同
- [ ] **Step 4:** 註冊進 `Hud.ts` 三處；`hud.test.ts` 的順序斷言更新，並確認 `BOMB` 自動含它、`GOD` 不含
- [ ] **Step 5:** 全套綠、tsc 不增行

**Verification:** mutation —— `runFrontCount` 的 `>= 1` 改成 `> 1` 之後邊界那條必須紅；`WIDGET_DRAW` 少一格是編譯錯誤（既有機制）。

---

### Task 5: 投放閘門

**Files:**
- Modify: `src/hud/widgets/bombBay.ts`
- Test: `test/unit/hud-release-gate.test.ts`（新）

**Interfaces:**
- Produces:
  - `releaseGateVisible(f: HudFrame): boolean` —— `bombCapable && bombBayCapacity > 0 && ordnance === 'torpedo' && !bombReloading && releaseEnv !== null`
  - `releaseGateColor(ok: boolean): string`
- 三格的判定直接呼叫 Task 1 的 `rollOk` / `pitchOk` / `aglOk`

**版面**（spec §6）：與「裝填中」同一個 baseline（`y − LABEL_RISE`）、同樣置中、同樣 `textBaseline = 'bottom'`。

```
        坡度 18°    俯仰 −2°    高度 240 m
```

**只驗兩支純函數是不夠的**（spec §8.4）。下面每一種寫錯都能讓純函數測試全綠：

```
  坡度與俯仰兩格對調
  高度那一格讀 HudFrame.altitude 而不是 releaseAgl
  在繪圖函數裡重抄一份 12° 的比較
  裝填中的時候把閘門也一起畫上去
```

所以主要護欄是**用假 canvas context 直接呼叫 `drawBombBay`**。`test/unit/hud.test.ts` 已經有記錄式 context 的用法（比對 `texts.map(t => t.color)` 與 `t.text`）—— **沿用它，不要為了可測性在 production 端新增抽象。**

- [ ] **Step 1: 寫失敗的測試（純函數）**
  - **二擇一**：`bombReloading` 為真 → `releaseGateVisible` 為假
  - 掛炸彈 → 為假；掛魚雷且未裝填 → 為真
  - **不限投彈模式**：`bombing` 為假時仍為真（spec §6.2）
  - `releaseGateColor(true) === HUD_COLORS.primary`、`false === HUD_COLORS.danger`
- [ ] **Step 2: 寫失敗的測試（畫出來的東西）** —— 假 ctx 呼叫 `drawBombBay`
  - 三段文字的**內容與順序**是坡度／俯仰／高度
  - 三段各自的顏色**只受自己那一軸影響**：只把 `pitch` 推出界時，只有「俯仰」轉紅、另外兩格仍綠（**這一條殺「兩格對調」**）
  - **高度那一格跟著 `releaseAgl` 走**：固定 `altitude`、只動 `releaseAgl`，文字要變（**殺「讀 altitude」**）
  - **門檻跟著 `releaseEnv` 走**：換一組包絡，同一組姿態的紅綠翻面（**殺「重抄一份 12°」**）
  - `bombReloading` 為真時：畫得出「裝填中」，而且**完全沒有閘門的三段文字**（**殺「兩個都畫」**）
- [ ] **Step 3: 實作。** 一定要自己設 `ctx.textBaseline` 與 `textAlign`（既有註解已寫明這個 ctx 是共用且屬性黏著的），畫完把 `textAlign` 還原成 `'left'`
- [ ] **Step 4: 回歸**：掛炸彈且 `bombReloading` 時「裝填中」照舊畫 —— `bomb-bay` 相關的既有測試全綠
- [ ] **Step 5:** 全套綠、tsc 不增行

**Verification:** 上面括號裡標的四條 mutation 逐一手動驗紅。

---

### Task 6: 高度錶的可投高度弧

**Files:**
- Modify: `src/hud/widgets/dials.ts`
- Test: `test/unit/hud-altimeter-band.test.ts`（新）

**Interfaces:**
- Produces: `releaseBandArc(altitude, releaseAgl, env): { from: number; to: number } | null` —— 角度用 `needle` 的慣例（0 指 12 點、順時針為正，rad）

**算法**（spec §7.2）：
```
  ground = altitude − releaseAgl
  lo = ground + env.minAgl,  hi = ground + env.maxAgl
  from = (lo / 1000 mod 1) · 2π,  to = (hi / 1000 mod 1) · 2π
```

- [ ] **Step 1: 寫失敗的測試**
  - 海上（ground 0）、altitude 150 → 弧是 20…200 m 對應的角度（7.2°…72°）
  - **altitude 1,020 → `null`**（長針繞回來了，spec §7.3 第一條）
  - **ground 900（弧跨 1,000 m 邊界）→ `null`**（第二條）
  - **ground 300、altitude 400 → 弧是 320…500 m 的角度**（證明跟著地形走）
  - **換一組 `env`（例如 30…150）→ 弧跟著變**（證明沒寫死）
- [ ] **Step 2: 實作。** `needle` 角度（0 指 12 點）轉 canvas `arc()`（0 指 3 點）**差 −90°**，換算要寫出來不要用猜的
- [ ] **Step 3: 接進 `drawAltimeter`。** 只在 `ordnance === 'torpedo' && releaseEnv !== null` 時畫；半徑避開刻度（`r*0.78`…`r*0.94`）與刻度數字（`r*0.62`）；顏色 `HUD_COLORS.primary` 或 `dim`，粗細與半徑標「起始值，由試飛裁定」
- [ ] **Step 4: 寫失敗的測試（畫出來的東西）。** 用假 ctx 呼叫 `drawDials`，捕捉 `ctx.arc()` **實際收到的起訖角**，斷言等於 `releaseBandArc` 的值**減 90°**。
      **少了這一條，把 needle 慣例的角度直接餵進 `ctx.arc()` 時，Step 1 的每一條與下面的 ground mutation 都還是綠的**，而弧會從 12–2 點整段轉到 3–5 點
- [ ] **Step 5:** 既有的 `dials` 相關測試全綠、tsc 不增行

**Verification:** mutation —— (a) 把 `ground` 那一項拿掉（直接用 `env.minAgl`）之後「ground 300」那條必須紅；(b) 把 `−90°` 的換算拿掉之後 Step 4 那條必須紅。

---

### Task 7: `main.ts` 串接

**Files:**
- Modify: `src/main.ts`
- Test: 無新單元測試（`main.ts` 的每幀迴圈進不了單元測試 —— 這正是前六個 Task 把規則都抽成純函數的理由）。驗收走 Task 8。

**要接的五件事：**

1. `hudFrame.releaseEnv` = **餵給 `canRelease` 的那一個物件**（`playerLoadout === null` 時 `null`）
2. `hudFrame.releaseAgl` = **餵給 `canRelease` 的那一個 `agl` 區域變數**
3. **入水點是不是水**（spec §5.7）：`bombState === 'solved'` 不代表落在水上 —— `solveImpact` 撞到任何地面都回成功，而真雷遇到陸地是立刻結束、根本沒有水中段。判準**逐字沿用 `stepAir`**（`torpedo.ts:296`）：

   ```
   terrain.collisionHeightAt(E.x, E.z) > 0 || !Number.isFinite(terrain.waterAt(E.x, E.z))  →  runCount = 0
   ```

   兩支在 `main.ts` 都拿得到（`main.ts:996-997` 就是把它們接到 `world` 上的）。**不得改用含浪的高度，也不得寫成 `> 雷體高度`。**
4. 航跡線取樣點：`ordnance === 'torpedo' && bombState === 'solved' && 是水` 時，用 `torpedoHeading` 取方向、`runSampleDistance(k)` 取距離，逐點 `.project(ctx.camera)` 寫進 `runX` / `runY` / `RUN_Z`，再 `runFrontCount(RUN_Z, TORPEDO_RUN_SAMPLES)` 算 `runCount`；否則 `runCount = 0`
5. 退化分支的 nose 方向與投放路徑（`main.ts:1521-1524` 的 `NOSE_H`）**共用同一段計算**

- [ ] **Step 1:** 加預先配置的暫存（`TORP_DIR: Float64Array(2)`、**`RUN_Z: Float64Array(TORPEDO_RUN_SAMPLES)`**、`RUN_WORLD: Vector3`、`RUN_NDC: Vector3`），**照抄 `BOMB_NDC` 的做法**。
      `RUN_Z` 不能省：`runFrontCount` 要一次看完五個 z，而 `HudFrame` 上只有 `runX`/`runY`。省掉它只剩兩條路 —— 每幀生一個陣列，或在這裡另寫一份判斷讓那支測過的純函數變成**沒人呼叫的死護欄**
- [ ] **Step 2:** 五件事接上；`NOSE_H` 那一段抽出來讓投放與 HUD 共用
- [ ] **Step 3:** `npx tsc --noEmit` 不增行；全套單元測試綠
- [ ] **Step 4:** 手動確認 `spawn-baseline` 的校驗和沒有變（**變了就是誤動了模擬，停下來報告**）

**Verification:**
- `hudFrame.releaseEnv` 與 `canRelease` 的引數必須是同一個運算式的結果 —— 讀 code diff 確認，不是各查一次 `envelopeFor`
- `runFrontCount` 在 `main.ts` 裡**真的被呼叫**（grep 確認），不是另寫一份迴圈
- 陸地那一條走 Task 8 的內陸截圖驗收

---

### Task 8: Playwright 驗收 + 試飛

**Files:**
- Create: `test/e2e/torpedo-hud.e2e.ts`
- 跑法：`npx vite-node test/e2e/torpedo-hud.e2e.ts`（**不要用 tsx** —— 會 `__name is not defined`）

**要拍到的：**

1. G4M 掛魚雷、低空進場、投彈模式 —— **航跡線與刻度都在畫面裡**（spec §5.5：150 m 高、入水點離機 500 m 時，末端離機 2,500 m、俯角 3.4°，落在畫面中心上方 13.3°，而半視角是 32.5°）
2. 同一幀的閘門三格（低空平飛時應為全綠）
3. 高度錶上的綠弧與長針的相對位置 —— **弧要在 12–2 點方向**（在 3–5 點就是 §7.1 那個 90° 換算掉了）
4. 一張**包絡外**的截圖（例如帶 30° 坡度）—— 線與圈轉紅、閘門的「坡度」那一格轉紅而另外兩格仍綠
5. **一張飛在島／內陸農地上空的截圖 —— 航跡線必須完全不出現**（Task 7 第 3 件事的驗收；海上的截圖抓不到這一條）

- [ ] **Step 1:** 寫 e2e，凍結姿態讓像素可比，輸出目錄用參數帶
- [ ] **Step 2:** 跑一次，五張圖逐張看
- [ ] **Step 3:** `page.on('pageerror')` 必須是空的
- [ ] **Step 4: 交給負責人試玩**

---

## 實作與計畫的差異（做完之後回填）

## 收尾

- [ ] `npx tsc --noEmit` 與動工前的基準行數相同
- [ ] `npx vitest run test/unit` 全綠
- [ ] `perf-gate.test.ts`、`rematch.test.ts` 單獨跑，綠
- [ ] `spawn-baseline` 的校驗和未變
- [ ] Codex 複審
- [ ] 分 Task commit，不 `git add -A`
