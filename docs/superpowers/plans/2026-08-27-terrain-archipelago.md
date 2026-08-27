# 群島地形 —— 實作計畫

**Goal:** 讓地形真的存在 —— 畫面上有島、飛機會撞上去、AI 閃得掉。

**Architecture:** heightmap 是唯一真相。`world/heightfield.ts` 是純資料
（不 import three），`world/archipelago.ts` 生成它，`render/island.ts` 從
**同一份**資料切 mesh。AI 端用**圓弧 × 圓盤**的解析判斷（不查高度場、
不取樣），把「地板高度」餵給 `applySafety` 既有的 `seaHeight` 參數。

**`applySafety` 的數學一行不改。** 新增的 `'terrain'` 分支是 `'ground'` 的
**升級**，只在 `'ground'` 已經觸發、而且爬不過時才接手。

**Spec:** `docs/superpowers/specs/2026-08-27-terrain-archipelago-design.md`

## Global Constraints

- **註解與 commit message 用繁體中文。註解寫現狀，不寫沿革。**
- **護欄重新定值是專案負責人的決定。** 測試紅了先量、先報告、先問。
- **絕不 `git add -A`**（`bash.exe.stackdump` 被追蹤且長期被修改）。
- **絕不用 PowerShell 讀寫含中文的檔案**；用 Write 工具或 Python
  `io.open(..., encoding='utf-8')`。
- **絕不把反引號放進 bash heredoc 或 `python -c`**。
- 不得引入 `@types/node`。熱路徑零配置；**不得 `Math.random`**。
- `src/ai/` 不得 import `src/battle/`。不寫飛機外形的測試。
- commit message 結尾加：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Y72mnpXy4V7QMrcpAi4BAo
  ```

### 這台機器上的指令

```
node node_modules/vitest/vitest.mjs run <path>      # 測試
node node_modules/typescript/bin/tsc --noEmit       # 型別
node node_modules/vite-node/vite-node.mjs <path>    # 一次性量測
```

`node_modules/.bin` 不存在，`npx tsc` 會抓到系統上另一支同名程式。
`perf-gate.test.ts` 與 `rematch.test.ts` **必須單獨跑**。

### 基準

**vitest 全綠**（2026-08-27 實測）：126 檔、2,964 條、零紅（不含單獨跑的兩支）。
**沒有既有紅測試**，所以接下來任何一條紅都是這一份造成的。

**tsc 有 21 個既有錯誤**，全部在 test/e2e/ 與 test/tools/：escort-live 8、
band-drill.probe 6、band-drill.e2e 6、defence-below.probe 1。多數是
Cannot find name process —— 那些檔案不由 vitest 執行，而專案規定不得引入
@types/node。**這 21 個是基準，不是這一份造成的**（以 git stash 逐一驗過）。
src/ 一個錯誤都沒有，任何新的 src/ 錯誤都是這一份的。

## 一條貫穿全篇的分工

**測試斷言少而準，量測放 `console.log`。** 效能不新增 probe 檔案 ——
用既有的 `perf-gate` 與 `frame-time.e2e.ts`，需要細節時做一次性量測、不留檔。

---

## File Structure

| 檔案 | 動作 | 行數量級 |
|---|---|---|
| `src/world/heightfield.ts` | 新增 | ~60 |
| `src/world/archipelago.ts` | 新增 | ~110 |
| `src/render/island.ts` | 新增 | ~80 |
| `src/ai/terrainSense.ts` | 新增 | ~120 |
| `src/render/terrain.ts` | 修改 | +25 |
| `src/render/props.ts` | **刪除** | −80 |
| `src/ai/safety.ts` | 修改 | +35 |
| `src/ai/AiController.ts` | 修改 | +20 |
| `src/main.ts` | 修改 | +20（`wireTerrain`，不是 +6） |
| `test/unit/heightfield.test.ts` | 新增 | |
| `test/unit/archipelago.test.ts` | 新增 | |
| `test/unit/terrain-sense.test.ts` | 新增 | |
| `test/unit/terrain.test.ts` | **修改** | children 契約 |
| `test/integration/terrain-avoidance.test.ts` | 新增 | 飛行掃描 |
| `test/e2e/frame-time.e2e.ts` | 修改 | 圖層改名 |
| `test/e2e/pixel-identical.e2e.ts` | 修改 | 圖層改名 + 重錄 |

---

## Task 1：高度場

**Files:** New `src/world/heightfield.ts`, New `test/unit/heightfield.test.ts`

```ts
export interface HeightFieldData {
  readonly size: number          // 頂點數
  readonly cell: number          // 格距，m
  readonly data: Float32Array    // size² 個高度，列優先
  sample(x: number, z: number): number
}
export function createHeightField(size: number, cell: number): HeightFieldData
```

世界座標原點在場地中心：頂點 `(col, row)` 的世界座標是
`((col − (size−1)/2)·cell, (row − (size−1)/2)·cell)`。出界回 `-Infinity`
（呼叫端與海面取 max，出界自然退回純海面）。

**不 import three。**

- [x] **Step 1：寫失敗的測試** —— 格點取樣 = 格點值、中點 = 兩端平均、
      正負邊界的精確跨度（`(size−1)·cell`）、出界四個方向
- [x] **Step 2：驗紅**
- [x] **Step 3：實作** —— 雙線性。**`sample` 在熱路徑上，不得配置**
- [x] **Step 4：綠 + tsc**

---

## Task 2：群島生成

**Files:** New `src/world/archipelago.ts`, New `test/unit/archipelago.test.ts`

```ts
export interface IslandDesc {
  readonly cx: number; readonly cz: number
  readonly radius: number
  readonly outerRadius: number   // radius × WOBBLE_MAX
  readonly peak: number
}
export function createArchipelago(): {
  field: HeightFieldData; islands: readonly IslandDesc[]
}
```

**無參數，seed 私有寫死** —— 這一輪 `main.ts` 本來就只有一種群島，
公開 seed 是沒有需求的擴充點。

島形見 spec §3.3。**`WOBBLE_MAX = 1.29` 必須與 wobble 的振幅和綁死**，
註解要寫明「動振幅就要回來重算」。

**常數：**

```
  FIELD_SIZE  = 1024   頂點
  FIELD_CELL  = 40     m      → 40.92 km 見方
  ISLAND_MIN  = 300    m      小島直徑下限
  PEAK_MAX    = 1000   m      峰高上限
  WOBBLE_MAX  = 1.29          = 1 + 0.18 + 0.11
```

- [x] **Step 1：寫失敗的測試**
  - 固定地形**逐位元**決定性（`Object.is`，不是 `toBeCloseTo`）
  - 每座島直徑 ≥ 300 m、峰高 ≤ 1000 m
  - `outerRadius === radius * 1.29`
  - **島間距足夠讓通道穿過** —— 任兩座島的 `outerRadius` 圓不重疊，
    且間隙寬於一個保守的通道寬度
  - `field.sample` 在 `outerRadius` 之外回海平面以下
- [x] **Step 2：驗紅**
- [x] **Step 3：實作** —— **不得 `Math.random`**，用 LCG
- [x] **Step 4：綠 + tsc**

【不寫的測試】不同 seed 產生不同地形、島心恰好等於 peak、距離 2r 為零。
理由見 spec §6.2。

---

## Task 3：島 mesh + 接進 terrain，移除綠色方塊

**Files:** New `src/render/island.ts`, Modify `src/render/terrain.ts`,
**Delete** `src/render/props.ts`, Modify `src/main.ts`,
Modify `test/unit/terrain.test.ts`, Modify 兩支 e2e

逐島從 `field` 切出 `[cx ± outerRadius, cz ± outerRadius]` 的格子
（**不是 `radius`** —— 見 spec §3.3），`flatShading: true` + `vertexColors`
（水線沙色 → 中段草綠 → 峰頂岩灰）。**頂點高度直接讀 `field.data`，不重算。**

**誤刪陷阱**：`render/props.ts` 是海面參照物（刪）；`assembly.ts` 的 `props`
與 `PROP_DISC_RENDER_ORDER` 是**螺旋槳**（不能碰）。

`kind === 'sea'` 時第三個 child 是**空 Group**（保住索引契約，
`src/tools/propdisc.ts` 與 `damageedge.ts` 才不用改）。

- [x] **Step 1：先讀 `test/unit/terrain.test.ts:18`**，看它怎麼驗證 children
      次序並「自我驗證抓對了人」，改動要保住那個性質
- [x] **Step 2：寫失敗的測試** —— `kind` 切換、dispose 不漏、
      **mesh 頂點高度 = `field.sample`**（鐵律的護欄）
- [x] **Step 3：驗紅**
- [x] **Step 4：實作 `island.ts`**
- [x] **Step 5：接 `terrain.ts`，刪 `props.ts`，改圖層名四處**
- [x] **Step 6：綠 + tsc**
- [x] **Step 7：`npm run dev` 目視** —— 島在不在、形狀像不像、
      有沒有 z-fighting、水線接不接得上

---

## Task 4：地形感知（圓弧 × 圓盤）

**Files:** New `src/ai/terrainSense.ts`, New `test/unit/terrain-sense.test.ts`

介面見 spec §5。判斷次序見 spec §4.4，鎖存規則見 §4.5。

**常數：**

```
  SENSE_RANGE    = 1200   m     繞開一堵牆最貴 1,016 m（K-4 800 km/h 滿載），
                                但 He 111 600 km/h 是 1,267 m —— 見掃描
  SENSE_INTERVAL = 12     tick  20 Hz
  MIN_HOLD_TICKS = 120    tick  最短鎖存 0.5 s
  CLEAR_SAMPLES  = 3            連續三次無威脅才解除
  BODY_MARGIN    = spec.wing.span / 2 + 餘裕
```

**這個 Task 完全不查高度場** —— 只吃 `islands`。這是它能在 headless
測試裡跑、也不受格點解析度影響的原因。

- [x] **Step 1：寫失敗的測試**（合成的 `islands` 當 fixture）
  - **通道直穿不介入** —— 左右各一座島、航跡從中間過，`turn === 0`、
    `island === −1`（這是專案負責人指定的情境）
  - 爬得過 → `turn === 0`、`floor === peak`
  - 爬不過 → `turn ≠ 0`，方向背離島心
  - **鎖存不反轉** —— 承諾側單次受阻時 `turn` 不得變號
  - 通過島心橫斷面且離開圓盤且連續三次無威脅 → `island` 回到 −1
  - `resetSense` 清空
  - 速度為零不 NaN
- [x] **Step 2：驗紅**
- [x] **Step 3：實作** —— 零配置，scratch 向量用 `core/pool.ts` 的 `makeScratch`
- [x] **Step 4：綠 + tsc**

---

## Task 5：安全層的 `'terrain'` 分支 + 接線

**Files:** Modify `src/ai/safety.ts`, `src/ai/AiController.ts`, `src/main.ts`

```ts
export type SafetyAction = 'none' | 'ground' | 'stall' | 'terrain'
```

**`sense` 不傳時完全走原路徑。**

**`seaHeight` 絕對不能被改寫** —— 它還被 `stationPoint`、`stationCommand`、
`tacticalCommand`、`steerCommand` 讀（spec §4.6）。只在 `emit` 建局部值。

`main.ts` 要有 `wireTerrain()`，在 `enterBattle`、`restartBattle`、換座位、
respawn 之後統一呼叫，**並清掉鎖存**（`playerAi` 跨場重用，
`resetBattle` 會建新的 `AiController`，`setup.ts:1066`）。

- [x] **Step 1：寫失敗的測試**（`test/unit/ai-safety.test.ts` 加一個 describe）
  - 拉得過時仍然回 `'ground'`，不升級
  - 爬不過且 `turn ≠ 0` 時回 `'terrain'`
  - `'terrain'` 不會在 `'ground'` 不觸發時觸發
- [x] **Step 2：驗紅**
- [x] **Step 3：實作**
- [x] **Step 4：綠 + tsc**
- [x] **Step 5：跑 `ai-manoeuvre` / `ai-duel-matrix` / `ai-defence`**

預期**全綠且數字不動**（headless 不注入地形）。**任何一條變號就停下來查
根因** —— 那代表有東西漏進了 headless 路徑，是 bug 不是重錄理由。

- [x] **Step 6：單獨跑 `rematch.test.ts`**，確認 `replayDigest` 不變

---

## Task 6：飛行掃描護欄

**Files:** New `test/integration/terrain-avoidance.test.ts`

障礙取三個代表（最寬、最高、最小）× 機型四種（**各用自己的合法速度區間**）
× 方位 8 向。

四條斷言（spec §6.1）：不得撞上、期限內通過、鎖存最終解除、
最大連續接管時間有上界。

- [x] **Step 1：寫測試**，維度診斷全部 `console.log`
- [x] **Step 2：跑**

**若掃出撞山**，依 spec §7 的事前約定：**第一個要試的是把 `R` 乘 1.5**
（滾轉建立的系統性偏差），**不是**先去調地形。

---

## Task 7：收尾

- [x] 全套測試（`perf-gate` / `rematch` 單獨跑）
- [x] `tsc --noEmit`
- [x] `frame-time.e2e.ts` 比對 1% low（相位錯開沒做對會在這裡現形）
- [x] `pixel-identical.e2e.ts` —— **讓 islands 顯示並重錄**（spec §6.4）
- [x] `docs/backlog.md` 加一條：地形選單、海岸線／內陸、AI 地形戰術、島的 LOD
