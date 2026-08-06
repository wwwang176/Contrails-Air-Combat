# 追擊的離地底限與破防的能量讓位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 AI 在快撞地時把航跡角抬起來（所有意圖、所有幾何模式一律適用），
並讓 `defend` 不再壓過 `rules.ts` 自己定義的「絕對理由」脫離。

**Architecture:** 在 `steerCommand` 的 `unload` 後處理之後、油門段之前，加一層
**只抬不壓**的離地底限。抬角由離地餘裕連續決定，餘裕 ≥ `clearanceScale`（500 m）
時嚴格回傳 0 —— 那是它能無條件套用在所有意圖與所有 mode 上而不污染高空的前提。
第二個改動只是把 `arbitrate` 裡「絕對理由」那一行移到 `defendLatch` 之前。

**Tech Stack:** TypeScript（無 `@types/node`）、three.js 的 `Vector3`、vitest。

## Global Constraints

以下每一條都直接抄自 spec 或專案的既有規矩，**每個任務都隱含適用**：

- **不動破防軸、不動 `defendOffset`、不動 `defendTilt`。** 前一份已定案，抬角
  20 / 30 / 40 / 50 全掃過，每一個都至少有一場掉到 11~345 m —— 高度不是抬角能解的。
- **不動 `src/ai/safety.ts`。** 它是 120 m 的最後硬限制，這一份加的是它上面的政策層。
- **不改測試場景的腳本射手。** 實測給它 600 m 地板之後 AI 的 `minAlt` 沒有改善
  （115 / 238），責任不在場景。
- `src/ai/` 的熱路徑**不得配置記憶體**。新向量一律走檔案既有的 `makeScratch` 暫存池。
- 專案**沒有** `@types/node`：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 為開啟狀態：陣列索引後必須 `!` 或做 undefined 檢查。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`（本計畫不觸及，列出以免誤觸）。
- **絕不為了讓測試變綠而放寬門檻。** 紅了先查根因；若斷言本身錯了，改斷言並在
  註解裡寫清楚為什麼。
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
- 護欄重新定值是**專案負責人的決定**，不是實作者的。紅了要先量、先報告、先問。

## File Structure

| 檔案 | 責任 | 本計畫的改動 |
|------|------|------|
| `src/ai/steer.ts` | 意圖 → 轉向指令 | 新增 `floorPitchAngle` / `applyFloor`；`SteerConfig` 加 `floorPitch`；`steerCommand` 加後處理 |
| `src/ai/rules.ts` | 態勢 → 意圖 | `arbitrate` 移動一行（Task 3） |
| `test/unit/ai-steer.test.ts` | `steer.ts` 的單元測試 | 底限函式的端點、連續性、方位不變性 |
| `test/unit/ai-rules.test.ts` | `rules.ts` 的單元測試 | 絕對理由對 `defend` 也生效 |
| `test/integration/ai-visible-evasion.test.ts` | 三機場景 | `measure` 加 `aspect` 與 `minAlt`；六場護欄 |
| `docs/superpowers/specs/2026-08-07-defend-energy-floor-design.md` | 設計文件 | 實作後回填實測值 |

**為什麼六場護欄放 `ai-visible-evasion.test.ts` 而不是 spec §5 寫的
`ai-manoeuvre.test.ts`**：後者是 1v1、300 秒、雙方都是 `AiController` 的對決，
沒有「腳本射手在後方連續射擊」這個場景，而問題正是在那個場景下才出現的。
`ai-visible-evasion.test.ts` 已經有三機場景與 `measure()`，擴充它比在別處
重建一個場景省事，也讓同一組數字可以互相對照。spec §5 的表格在 Task 4 一併更正。

---

### Task 1: 離地底限的兩個函式與接線

**Files:**
- Modify: `src/ai/steer.ts`
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: 檔案既有的 `FWD`、`const U = makeScratch(2)`、`SteerConfig.clearanceScale`
- Produces:
  - `SteerConfig` 新欄位 `floorPitch: number`（rad），`DEFAULT_STEER.floorPitch = 20 * (Math.PI / 180)`
  - `export function floorPitchAngle(groundClearance: number, cfg?: SteerConfig): number`
  - 私有 `function applyFloor(self: Aircraft, minPitch: number, aim: Vector3): void`

- [ ] **Step 1: 先讀懂現況**

讀 `src/ai/steer.ts` 的這幾個位置，不要改：

- `unloadAim`（檔案末段）—— 它的註解解釋了**為什麼俯仰必須相對地平線定義**，
  以及水平分量退化時改用機首投影的寫法。`applyFloor` 要照抄那個退化路徑。
- `shrinkTowardNose` 與它上面的 `const U = makeScratch(2)`
- `steerCommand` 裡 `if (mode === 'unload') { … }` 那一段，以及它下面的
  `// ── 油門與減速` 註解 —— 新的後處理夾在這兩者之間
- `SteerConfig` 的 `clearanceScale` 欄位（值 500）與 `extendPitchAngle`

**`aimWorld` 在所有分支都是單位向量，可以直接用 `aim.y = sin(航跡角)`。**
已逐條確認：`normalizeInto` 與 `defendAim` 結尾都 `.normalize()`；`unloadAim`
的輸出由 `cos/sin` 構造；`reversalAim` 走 `solveLead`，而
`src/world/lead.ts:69` 是 `out.copy(P).addScaledVector(V, t).normalize()`。
既有的 `shrinkTowardNose` 也已經這樣假設（它對 `aim` 直接取 `acos(dot)`）。

**注意 `DEG` 與 `RAD`**：`DEG = π/180`、`RAD = 180/π`，都在 `src/core/math.ts`。
把度數轉成弧度是 `× DEG`；寫成 `× RAD` 會得到 229 弧度這種荒謬值。

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/ai-steer.test.ts` 檔案最後加。檔案頂端的 import 已經有
`DEFAULT_STEER`、`Vector3`、`Aircraft`、`P51D`；把 `floorPitchAngle` 加進
`from '../../src/ai/steer'` 那一組。

```ts
describe('離地底限', () => {
  const cfg = DEFAULT_STEER

  /** 造一架在 4000 m、機首朝 −Z、機翼水平的飛機 */
  function level(): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    return a
  }

  /**
   * 【這一條是 spec §4.4 的否決條件之一】餘裕夠時必須是**嚴格**的 0，
   * 不是「很小的值」。整層之所以能無條件套用在所有意圖與所有 mode 上，
   * 前提就是它在高空完全不存在。
   */
  it('餘裕 ≥ clearanceScale 時嚴格回傳 0', () => {
    expect(floorPitchAngle(cfg.clearanceScale, cfg)).toBe(0)
    expect(floorPitchAngle(cfg.clearanceScale + 1, cfg)).toBe(0)
    expect(floorPitchAngle(4000, cfg)).toBe(0)
  })

  it('貼地時給滿 floorPitch，再低也不超過', () => {
    expect(floorPitchAngle(0, cfg)).toBeCloseTo(cfg.floorPitch, 12)
    // 負餘裕（已經在地面下）不得外插出更大的值
    expect(floorPitchAngle(-500, cfg)).toBeCloseTo(cfg.floorPitch, 12)
  })

  it('中間是線性連續，沒有跳階', () => {
    expect(floorPitchAngle(cfg.clearanceScale / 2, cfg)).toBeCloseTo(cfg.floorPitch / 2, 12)
    expect(floorPitchAngle(cfg.clearanceScale / 4, cfg)).toBeCloseTo(cfg.floorPitch * 0.75, 12)
    // 門檻上下相鄰取樣不得出現階躍
    const eps = 1e-6
    const inside = floorPitchAngle(cfg.clearanceScale - eps, cfg)
    expect(inside).toBeGreaterThan(0)
    expect(inside).toBeLessThan(1e-6)
  })
})
```

- [ ] **Step 3: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-steer.test.ts -t "離地底限"
```

預期：編譯失敗，`floorPitchAngle` 與 `DEFAULT_STEER.floorPitch` 都不存在。

- [ ] **Step 4: 加 `floorPitch` 到 `SteerConfig`**

在 `SteerConfig` 的 `clearanceScale` 欄位**正下方**插入：

```ts
  /**
   * 離地底限的最大抬角，rad。餘裕歸零時要求的航跡角。
   *
   * 【為什麼需要這一層】`extend` 有 `extendPitchAngle` 會隨離地餘裕抬頭，
   * 而 `engage` / `approach` / `merge` / `defend` **一個都沒有** —— 唯一的
   * 防線是 `safety.ts` 的 120 m 硬限制，那是最後一道不是政策。
   *
   * 【實測的因果鏈，2026-08-07】水平面破防成功甩開射手 → AI 換目標改追
   * 射手 → 射手是沒有高度意識的腳本、一路往下 → AI 在 `approach` 60% /
   * `engage` 30% 的狀態跟著追，低空 90% 的時間仍在下沉。**低於 500 m 時
   * AI 幾乎不在破防（0.0% / 0.9%）**，所以這不是破防的能量問題。
   *
   * 【起始值 20°，待 Task 2 掃描回填】與 `speedRecoverPitch` 和安全層的
   * `recoveryPitch` 相同 —— 這個專案的三處抬頭／壓頭幅度目前都是 20°。
   */
  floorPitch: number
```

在 `DEFAULT_STEER` 裡 `clearanceScale: 500,` 那一行**正下方**加：

```ts
  floorPitch: 20 * (Math.PI / 180),
```

- [ ] **Step 5: 寫 `floorPitchAngle`**

放在 `extendPitchAngle` 的**正下方**（兩者共用 `clearanceScale`，放在一起讀）：

```ts
/**
 * 這個離地餘裕下，瞄準方向的航跡角至少要多少，rad。永遠 ≥ 0。
 *
 * 形狀與 `extendPitchAngle` 的 `altitudeDeficit` 同構，**刻意復用同一個特徵
 * 高度 `clearanceScale`**，不新增第二套幾何 —— 兩層在同一個高度開始作用。
 *
 * 【`deficit <= 0` 直接回傳 0，不是回傳一個很小的數】離地底限之所以能無條件
 * 套用在所有意圖與所有 `SteerMode` 上，前提就是它在高空是**嚴格**的無操作。
 * 有一條單元測試把這件事釘住。
 *
 * @param groundClearance 離地（海面）高度，m。可以是負的
 */
export function floorPitchAngle(
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  let deficit = 1 - groundClearance / cfg.clearanceScale
  if (deficit <= 0) return 0
  if (deficit > 1) deficit = 1
  return cfg.floorPitch * deficit
}
```

- [ ] **Step 6: 跑測試，確認前三條綠**

```
npx vitest run test/unit/ai-steer.test.ts -t "離地底限"
npx tsc --noEmit
```

預期：三條綠、`tsc` 無輸出。

- [ ] **Step 7: 寫 `applyFloor` 的失敗測試**

在同一個 `describe('離地底限', …)` 區塊裡追加。`applyFloor` 是私有函式，
**透過 `steerCommand` 驗它太繞** —— 改為驗一個與它等價的公開行為不可行，
所以這一步把它 export 出來（與前一份把 `defendAim` export 出來同一個理由：
直接驗幾何比透過整場模擬反推可靠得多）。

```ts
  /** 由單位向量取航跡角（相對地平線），rad */
  function pitchOf(v: Vector3): number {
    return Math.asin(v.y / v.length())
  }
  /** 由單位向量取水平方位角，rad */
  function bearingOf(v: Vector3): number {
    return Math.atan2(v.x, v.z)
  }

  it('把朝下的瞄準點抬到底限，水平方位不變', () => {
    const self = level()
    // 朝下 40°、方位偏 +30°
    const down = -40 * DEG
    const bear = 30 * DEG
    const aim = new Vector3(
      Math.sin(bear) * Math.cos(down), Math.sin(down), Math.cos(bear) * Math.cos(down),
    )
    const before = bearingOf(aim)
    applyFloor(self, 20 * DEG, aim)

    expect(pitchOf(aim)).toBeCloseTo(20 * DEG, 9)
    expect(bearingOf(aim)).toBeCloseTo(before, 9)
    expect(aim.length()).toBeCloseTo(1, 9)
  })

  /**
   * 【只抬不壓】這是整層能無條件套用的另一半前提。已經在爬升的瞄準點
   * 被壓下來的話，`extend` 的 `extendPitchAngle` 與這一層就會互相打架。
   */
  it('已經高於底限時逐位元不動', () => {
    const self = level()
    const aim = new Vector3(0, Math.sin(50 * DEG), -Math.cos(50 * DEG))
    const copy = aim.clone()
    applyFloor(self, 20 * DEG, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  it('底限為 0 時逐位元不動 —— 高空無操作', () => {
    const self = level()
    const aim = new Vector3(0, -Math.sin(60 * DEG), -Math.cos(60 * DEG))
    const copy = aim.clone()
    applyFloor(self, 0, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  /**
   * 【垂直朝下是最危險也最容易寫錯的一格】水平分量退化，「保持方位」沒有
   * 定義。此時**必須**仍然抬起來 —— 直接 return 等於在垂直俯衝時放棄拉桿。
   * 退化路徑與 `unloadAim` 一致：改用機首的水平投影。
   */
  it('垂直朝下時仍然抬得起來，用機首的水平投影當方位', () => {
    const self = level()   // 機首朝 −Z
    const aim = new Vector3(0, -1, 0)
    applyFloor(self, 20 * DEG, aim)

    expect(pitchOf(aim)).toBeCloseTo(20 * DEG, 9)
    expect(aim.length()).toBeCloseTo(1, 9)
    // 機首朝 −Z，所以水平分量應該落在 −Z
    expect(aim.z).toBeLessThan(0)
    expect(Math.abs(aim.x)).toBeLessThan(1e-9)
  })

  it('瞄準點與機首都鉛直時不產生 NaN', () => {
    const self = level()
    // 機首朝正上方
    self.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(0, 1, 0))
    const aim = new Vector3(0, -1, 0)
    applyFloor(self, 20 * DEG, aim)

    expect(Number.isNaN(aim.x + aim.y + aim.z)).toBe(false)
    expect(aim.length()).toBeCloseTo(1, 9)
    expect(pitchOf(aim)).toBeCloseTo(20 * DEG, 9)
  })
```

檔案頂端要補兩個 import：

- 把 `applyFloor` 加進 `from '../../src/ai/steer'` 那一組（`floorPitchAngle`
  在 Step 2 已經加過）
- **新增一行** `import { DEG } from '../../src/core/math'` —— 這個檔案目前
  **沒有** import `core/math` 的任何東西（既有的測試都寫 `Math.PI / 180`
  字面），所以是整行新增，不是往現有的 import 裡加

- [ ] **Step 8: 跑測試，確認它紅**

```
npx vitest run test/unit/ai-steer.test.ts -t "離地底限"
```

預期：後五條失敗，`applyFloor is not a function`。

- [ ] **Step 9: 寫 `applyFloor`**

放在 `shrinkTowardNose` 的**正下方**（兩者都是「就地修改 aim 的後處理」，
放在一起讀）：

```ts
/**
 * 把 `aim` 的**航跡角**抬到不低於 `minPitch`，水平方位不變。就地修改。
 * 已經高於底限、或 `minPitch <= 0` 時逐位元不動。
 *
 * 【為什麼是航跡角而不是加一個偏置】見 `unloadAim` 的註解：偏置加在**當前**
 * 方向上會每格滾雪球，實測 `extend` 4 秒內由 −27° 跑到 −56°（垂直俯衝）。
 * 相對地平線的航跡角是一個**穩定的**目標。
 *
 * 【為什麼方位必須不動】見 `shrinkTowardNose` 的註解：指揮儀把瞄準誤差的
 * 方位讀成滾轉需求，動到方位會讓副翼打到滿舵。
 *
 * 【只抬不壓】所以它可以無條件疊在任何意圖與任何 `SteerMode` 的輸出上，
 * 包括 `extend`（`extendPitchAngle` 與這一層自然取較高者）。
 *
 * 假設 `aim` 是單位向量 —— `steerCommand` 的每一條路徑都保證這件事。
 */
export function applyFloor(self: Aircraft, minPitch: number, aim: Vector3): void {
  if (minPitch <= 0) return
  const s = Math.sin(minPitch)
  if (aim.y >= s) return

  let hx = aim.x
  let hz = aim.z
  let h = Math.hypot(hx, hz)
  if (h < 1e-6) {
    // 垂直（朝下）：方位沒有定義。與 unloadAim 走同一條退化路徑 —— 機首的
    // 水平投影。直接 return 等於在垂直俯衝時放棄拉桿，那正是要防的情況。
    const nose = U.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
    hx = nose.x
    hz = nose.z
    h = Math.hypot(hx, hz)
    if (h < 1e-6) {
      // 機首也鉛直：任何水平方位都一樣好，取機體座標的正前方在世界的投影
      // 已經沒有意義，直接用 −Z。重點是抬起來而且不是 NaN
      aim.set(0, s, -Math.cos(minPitch))
      return
    }
  }
  const c = Math.cos(minPitch) / h
  aim.set(hx * c, s, hz * c)
}
```

**暫存向量的重複使用**：`U.v[0]` 也被 `shrinkTowardNose` 用。兩者在
`steerCommand` 裡是**先後**執行（`shrinkTowardNose` 先跑完才輪到
`applyFloor`），而且 `applyFloor` 進去就重新 `copy`，所以安全。
**不要**把 `applyFloor` 的呼叫挪到 `shrinkTowardNose` 中間。

- [ ] **Step 10: 跑測試，確認全綠**

```
npx vitest run test/unit/ai-steer.test.ts
npx tsc --noEmit
```

預期：整檔綠（含既有的 92 條）、`tsc` 無輸出。

- [ ] **Step 11: 接到 `steerCommand`**

找到 `steerCommand` 裡的

```ts
  if (mode === 'unload') {
    shrinkTowardNose(self, unloadPull(sit.stallMargin, cfg), out.aimWorld)
  }
```

在它的**正下方**、`// ── 油門與減速` 那一段的**正上方**插入：

```ts
  // ── 離地底限：快撞地時把航跡角抬起來，方位不動 ──────────
  // 【為什麼無條件套，連 speedRecover 與 overshoot 都套】它只抬不壓，而且
  // 餘裕 ≥ clearanceScale 時 floorPitchAngle 嚴格回傳 0 —— 高空完全不存在。
  // 「沒速度」（speedRecover 主動壓機頭 20°）與「快撞地」同時發生時撞地
  // 優先，那本來就是安全層與瞄準點層的既有順序；overshoot 刻意消耗能量，
  // 但撞地比讓對方跑掉嚴重。
  //
  // 【為什麼 extend 不需要特例】extendPitchAngle 已經吃了 groundClearance，
  // 兩者自然取較高者 —— 這正是「只抬不壓」買到的東西。
  applyFloor(self, floorPitchAngle(self.state.position.y - seaHeight, cfg), out.aimWorld)
```

- [ ] **Step 12: 跑單元測試與型別檢查**

```
npx vitest run test/unit/ai-steer.test.ts test/unit/ai-rules.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 13: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
```

commit 訊息（含中文，走檔案）：

```
feat: 追擊時的離地底限 —— 快撞地就把航跡角抬起來

extend 有 extendPitchAngle 會隨離地餘裕抬頭，engage / approach /
merge / defend 一個都沒有，唯一防線是 safety.ts 的 120 m 硬限制。

只抬不壓，而且餘裕 ≥ clearanceScale（500 m）時嚴格回傳 0，所以能
無條件疊在所有意圖與所有 SteerMode 上，extend 也不必開特例。

三個設計約束都有出處：航跡角相對地平線（unloadAim 的滾雪球）、
連續無截斷（extendPitchAngle 的消抖動）、方位不變（shrinkTowardNose
的滿舵）。垂直朝下的退化走機首水平投影，與 unloadAim 一致 ——
直接 return 等於在垂直俯衝時放棄拉桿。

floorPitch 起始值 20°，待掃描回填。
```

---

### Task 2: 六場護欄與 `floorPitch` 定值

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`
- Modify: `src/ai/steer.ts`（只改 `DEFAULT_STEER.floorPitch` 的值與它的註解）

**Interfaces:**
- Consumes: Task 1 的 `floorPitchAngle`、`DEFAULT_STEER.floorPitch`
- Produces: `measure(standoff, aspect)` 多一個參數與 `minAlt` / `survived` 兩個回傳欄位；
  一條跑六場的護欄測試

- [ ] **Step 1: 讀懂現行測試的形狀**

`test/integration/ai-visible-evasion.test.ts` 目前的 `measure(standoff: number)`：

- 三機：受測 AI（`prey`，藍）追腳本獵物（`bait`，紅，`Lazy` 慵懶盤旋），
  腳本射手（`hunter`，紅，`Sniper`）在後方 `standoff` 處連續射擊
- 三架的起始位置：`prey (0, ALT, 0)`、`bait (0, ALT, -500)`、`hunter (0, ALT, standoff)`
- 三架都朝 `FWD`（`(0,0,-1)`）
- 迴圈 `for (let s = 0; s < SECONDS * 240; s++)`，`if (!pc.alive || !hc.alive) break`
- `Result` 目前有 `underFire` / `coverage` / `defendMedian` / `ordinaryMedian` /
  `straightness` / `shootableShare` / `straightMedian` / `contrast`

- [ ] **Step 2: 寫失敗的測試**

先給 `measure` 加參數與兩個回傳欄位。在 `Result` 介面加：

```ts
  /** 受測 AI 整場的最低高度，m */
  minAlt: number
  /** 有沒有跑滿整個觀察窗。false = 有人中途出局 */
  survived: boolean
```

把 `measure` 的簽名改成：

```ts
function measure(standoff: number, aspect: Aspect = 'tail'): Result {
```

並在檔案上方（`BLUNT` 附近）加型別與說明：

```ts
/**
 * 射手的起始方位。
 *
 * `tail` = 正後方尾追；`beam` = 正側方橫越、機首指向受測 AI。
 *
 * 【為什麼需要 beam】撞地的兩場之一是 800 m 橫越（另一場是 1000 m 尾追）。
 * 只有尾追的話量不到那個場景。
 */
type Aspect = 'tail' | 'beam'
```

`measure` 裡把 `hunter` 的起始位置與朝向改成隨 `aspect` 走。原本是

```ts
  const hunterPos = new Vector3(0, ALT, standoff)
```

且三架共用同一個 `FWD` 朝向的迴圈。改成：

```ts
  const hunterPos = aspect === 'tail'
    ? new Vector3(0, ALT, standoff)
    : new Vector3(standoff, ALT, 0)
  for (const [a, p] of [[prey, preyPos], [bait, baitPos], [hunter, hunterPos]] as const) {
    a.state.position.copy(p)
    // 橫越的射手機首指向受測 AI，否則它要先繞一大圈才進得了場
    const look = a === hunter && aspect === 'beam'
      ? new Vector3().subVectors(preyPos, hunterPos).normalize()
      : FWD.clone()
    a.state.velocity.copy(look).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, look)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
```

在取樣迴圈之前加 `let minAlt = ALT`，迴圈裡（`if (!pc.alive || !hc.alive) break`
的**下一行**）加：

```ts
    minAlt = Math.min(minAlt, prey.state.position.y)
```

迴圈需要知道有沒有跑完。把 `for` 迴圈上方加 `let steps = 0`，迴圈裡
`minAlt` 那一行旁邊加 `steps = s + 1`，回傳時：

```ts
    minAlt,
    survived: steps >= SECONDS * 240,
```

**`measure` 內部呼叫 `scripted('none', standoff)` 取 `straightMedian` 的那一行不動** ——
基準線是兩機腳本場景，與 `aspect` 無關。

然後在 `describe` 區塊裡加護欄測試：

```ts
  /**
   * 【這一條是 #136 的主判準】前一份（破防軸）的 §5.4 要求「最低高度不得
   * 低於現行同場景」，那條標準不可執行 —— 它預設了「閃躲不該有代價」，而
   * 舊軸不掉高度的原因正是它根本沒在閃（位移 2.96° 對新軸的 9.99°）。
   *
   * 可執行的標準是**不進安全層的作用區**：`safety.ts` 的 `clearance` 是
   * 120 m，瞄準點層的 `clearanceScale` 是 500 m，取後者。
   *
   * 【修補前的實測，2026-08-07】離地底限上線之前的六場：
   *
   * ```
   * 場景          最低高度   結局
   * 400 尾追        2687     滿場
   * 800 尾追        3953     滿場
   * 1000 尾追        113 ←   113 s，腳本射手撞海
   * 400 橫越        2556     滿場
   * 800 橫越         225 ←    99 s，腳本射手撞海
   * 1000 橫越       3940     滿場
   * ```
   *
   * 誘餌起始位置微擾 ±20 / ±40 各跑 5 次，那兩場 10 次全部提早結束 ——
   * 系統性可重現，不是混沌抽樣。
   */
  it('六場都不掉進安全層的作用區', () => {
    const bad: string[] = []
    for (const aspect of ['tail', 'beam'] as const) {
      for (const standoff of [400, 800, 1000]) {
        const r = measure(standoff, aspect)
        if (r.minAlt <= 500 || !r.survived) {
          bad.push(`${standoff} ${aspect}: minAlt=${r.minAlt.toFixed(0)} survived=${r.survived}`)
        }
      }
    }
    expect(bad).toEqual([])
  }, 10 * 60 * 1000)
```

- [ ] **Step 3: 跑測試，記錄它是紅是綠**

```
npx vitest run test/integration/ai-visible-evasion.test.ts -t "六場"
```

**這一步的預期不是「一定紅」。** Task 1 的 `floorPitch` 起始值 20° 可能已經
夠用，也可能不夠。兩種結果都要照實記下來：

- 紅 → 進 Step 4 掃描
- 綠 → 仍然要跑 Step 4 的掃描，確認 20° 不是剛好卡在邊緣（`minAlt` 只比
  500 高一點點的話沒有餘裕，下次動別的參數就會紅）

- [ ] **Step 4: 掃描 `floorPitch`**

在 `$CLAUDE_JOB_DIR/tmp/` 之外**不要**留下探針檔。做法是暫時在測試檔裡加一個
掃描用的 `it`，量完就刪：

```ts
  it.skip('掃描 floorPitch（量測用，不是判準）', () => {
    for (const deg of [10, 20, 30, 40]) {
      DEFAULT_STEER.floorPitch = deg * DEG
      for (const aspect of ['tail', 'beam'] as const) {
        for (const standoff of [400, 800, 1000]) {
          const r = measure(standoff, aspect)
          console.log(JSON.stringify({
            deg, standoff, aspect,
            minAlt: r.minAlt.toFixed(0), survived: r.survived,
            shootable: (r.shootableShare * 100).toFixed(1) + '%',
          }))
        }
      }
    }
    DEFAULT_STEER.floorPitch = 20 * DEG
  }, 30 * 60 * 1000)
```

這段用到 `DEG`，而 `ai-visible-evasion.test.ts` 目前只 import 了 `RAD`
（第 12 行 `import { RAD } from '../../src/core/math'`）。把那一行改成
`import { DEG, RAD } from '../../src/core/math'`，掃描的 `it` 刪掉時
再把 `DEG` 移除。

把 `it.skip` 改成 `it` 跑一次：

```
npx vitest run test/integration/ai-visible-evasion.test.ts -t "掃描 floorPitch"
```

`DEFAULT_STEER` 是 `const` 物件但屬性可寫，直接指派即可（前一份掃 `defendTilt`
用的是同一手）。**掃完把這個 `it` 整段刪掉** —— 它會改動全域設定，留在檔案裡
會污染同檔的其他測試。

選值的判準（spec §2.1）：**六場的 `minAlt` 都拉回 500 m 以上、六場都跑滿，
而 `shootableShare` 不變差。** 兩者都滿足的最小抬角勝出 —— 抬角越大對正常
空戰的干擾越多。

- [ ] **Step 5: 回填定值**

把 `DEFAULT_STEER.floorPitch` 改成掃描選出來的值（若 20° 勝出就不用改值），
並把 Task 1 Step 4 寫的那段註解裡的

```
   * 【起始值 20°，待 Task 2 掃描回填】與 `speedRecoverPitch` 和安全層的
   * `recoveryPitch` 相同 —— 這個專案的三處抬頭／壓頭幅度目前都是 20°。
```

換成掃描表與選值理由，格式照這個檔案既有的參數註解（例如 `defendTilt` 或
`reversalRange`）：實測表格 + 為什麼選這個 + 重試的前提。

- [ ] **Step 6: 跑整檔**

```
npx vitest run test/integration/ai-visible-evasion.test.ts
npx tsc --noEmit
```

預期：五條全綠（原本四條 + 新的六場護欄）。

**若六場護欄仍紅**：不准調 500 這個門檻，也不准縮小場景。spec §4.4 明寫
「六場的 `minAlt` 仍有任何一場低於 500 m」是否決條件 —— 把實測值報告給
專案負責人。

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/integration/ai-visible-evasion.test.ts
```

訊息：

```
test: 六場的離地護欄，並回填 floorPitch 的定值

measure 加 aspect 參數（尾追／橫越）與 minAlt / survived 兩個回傳。
撞地的兩場之一是 800 m 橫越，只有尾追量不到。

門檻取 500 m（= clearanceScale）而不是「不低於舊軸同場景」：後者
預設了閃躲不該有代價，而舊軸不掉高度正是因為它根本沒在閃。
```

---

### Task 3: 破防不再壓過「絕對理由」的 extend

**Files:**
- Modify: `src/ai/rules.ts`
- Test: `test/unit/ai-rules.test.ts`

**Interfaces:**
- Consumes: `rules.ts` 既有的 `s.defendLatch`、`s.extendFloorLatch`、
  `cfg.floorExempt`、`sit.energyAdvantage`
- Produces: 無新的公開介面 —— 只有 `arbitrate` 內部的優先序改變

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-rules.test.ts` 的
`describe('extend 的三個理由與射擊否決權', …)` 區塊**最後**追加：

```ts
  /**
   * 【破防不能壓過「我飛不動了」】`arbitrate` 第一行是
   * `if (s.defendLatch) return 'defend'`，它把同一個檔案自己定義的分野
   * （相對理由 vs 絕對理由）對 `defend` 整條蓋掉。
   *
   * 實測 2026-08-07，三機場景 400 m：破防期間有 **50.1% / 45.1%** 的時間
   * `cornerRatio` 已經低於 `cornerEnter` —— AI 一邊轉不動一邊繼續硬破防。
   */
  it('速度見底時，就算正在被咬也要走', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    // 威脅拉滿：threatEnter 以上，defendLatch 一定閂上
    for (let i = 0; i < 20; i++) stepRules(s, sit, 1, DT)

    expect(s.defendLatch).toBe(true)        // 破防的閂鎖確實閂著
    expect(s.extendFloorLatch).toBe(true)   // 速度見底的閂鎖也閂著
    expect(s.intent).toBe('extend')          // 絕對理由勝出
  })

  /**
   * 【但相對理由仍然輸給破防】「比他弱」不是丟下防禦不管的理由 ——
   * 這一條守住上面那個改動沒有順手把所有 extend 都提到 defend 之前。
   */
  it('能量劣勢不能把正在被咬的 AI 拉去 extend', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.energyAdvantage = DEFAULT_RULES.energyEnter * 1.5
    for (let i = 0; i < 20; i++) stepRules(s, sit, 1, DT)

    expect(s.defendLatch).toBe(true)
    expect(s.extendEnergyLatch).toBe(true)
    expect(s.intent).toBe('defend')
  })

  /**
   * 【`floorExempt` 的豁免對 defend 也要成立】佔著明顯能量優勢時，
   * 「我飛不動了」不強制脫離 —— 缺的是此刻的速度，低頭換就有。
   */
  it('能量優勢夠大時，速度見底也不脫離', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    sit.energyAdvantage = DEFAULT_RULES.floorExempt * 1.5
    for (let i = 0; i < 20; i++) stepRules(s, sit, 1, DT)

    expect(s.extendFloorLatch).toBe(true)
    expect(s.intent).toBe('defend')
  })
```

**`stepRules` 的第三個參數是 `threat`**（0..1），不是 dt。上面三條都傳 `1`
（威脅拉滿）好讓 `defendLatch` 閂上；既有的測試傳 `0`，所以它們的 `defend`
不會觸發 —— 兩組互不干擾。

- [ ] **Step 2: 跑測試，確認第一條紅**

```
npx vitest run test/unit/ai-rules.test.ts -t "速度見底時，就算正在被咬也要走"
```

預期：`expected 'defend' to be 'extend'`。第二、三條此時應該已經綠
（現況就是 defend 壓過一切），那是刻意的 —— 它們是**防迴歸**的護欄，
守著 Step 3 不要改過頭。

- [ ] **Step 3: 移動那一行**

在 `src/ai/rules.ts` 的 `arbitrate` 裡，把

```ts
  if (s.extendFloorLatch && sit.energyAdvantage < cfg.floorExempt) return 'extend'
```

從它現在的位置**剪下**，貼到函式的**最上面**，也就是
`if (s.defendLatch) return 'defend'` 的**正上方**，並把註解改成：

```ts
function arbitrate(s: RuleState, sit: Situation, cfg: RuleConfig): Intent {
  // 【絕對理由排在破防之前，2026-08-07】這個函式底下用一長段註解區分了
  // 「相對理由」（比他弱、轉不贏他 —— 有槍在手就先開槍）與「絕對理由」
  // （我飛不動了 —— 開著槍也得走）。但 `defendLatch` 原本排在最前面，
  // 於是那個分野對「正在被咬」的情況整條失效。
  //
  // 【實測 2026-08-07】三機場景 400 m：破防期間有 50.1% / 45.1% 的時間
  // `cornerRatio` 已經低於 `cornerEnter` —— AI 一邊轉不動一邊繼續硬破防。
  //
  // 【`floorExempt` 的豁免照舊】佔著明顯能量優勢時「我飛不動了」不強制
  // 脫離：缺的是此刻的速度，低頭換就有。
  if (s.extendFloorLatch && sit.energyAdvantage < cfg.floorExempt) return 'extend'

  if (s.defendLatch) return 'defend'
```

原本那一行的位置留下的空隙，把它上面那段以
`// 【絕對理由的豁免】見 `RuleConfig.floorExempt`：` 開頭的註解也一起搬走
（那段註解是在解釋被搬走的那一行）。**不要**留下一段沒有程式碼的孤兒註解。

- [ ] **Step 4: 跑測試與型別檢查**

```
npx vitest run test/unit/ai-rules.test.ts
npx tsc --noEmit
```

預期：整檔綠、`tsc` 無輸出。

- [ ] **Step 5: 驗 B 的否決條件 —— `shootableShare` 不得變差**

```
npx vitest run test/integration/ai-visible-evasion.test.ts
```

spec §2.2 與 §4.2：B 的收益未經證實而風險具體（被咬時切 `extend` 就是沿
速度向量直線飛），所以它的驗收是硬性的。

- 五條全綠 → B 留下，進 Step 6
- `shootableShare` 那兩條任一紅 → **把 Step 3 的改動 revert 掉**
  （`git checkout src/ai/rules.ts`，並把 Step 1 的三條測試改成記錄這個結果
  的形式），只留 Task 1–2 的 A 部分，並把實測值報告給專案負責人

**不准為了讓它綠而調 `SHOOTABLE_LIMIT`。**

- [ ] **Step 6: Commit**

```bash
git add src/ai/rules.ts test/unit/ai-rules.test.ts
```

訊息：

```
fix: 破防不再壓過「我飛不動了」的脫離

rules.ts 自己用一長段註解區分了相對理由（比他弱 —— 有槍在手就先
開槍）與絕對理由（我飛不動了 —— 開著槍也得走），但 defendLatch
排在最前面，那個分野對「正在被咬」整條失效。

實測三機場景 400 m：破防期間有 50.1% / 45.1% 的時間 cornerRatio
已經低於 cornerEnter —— AI 一邊轉不動一邊繼續硬破防。

floorExempt 的豁免照舊。加了兩條防迴歸測試守著「相對理由仍然輸給
破防」與「能量優勢夠大時速度見底也不脫離」。
```

---

### Task 4: 全套回歸、L4-C 裁定、回填 spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-defend-energy-floor-design.md`
- Modify: `docs/superpowers/specs/2026-08-07-defend-axis-design.md`（§8.5 的處置表）
- 可能 Modify（**須先問過專案負責人**）：`test/integration/ai-duel-matrix.test.ts`、
  `ai-manoeuvre.test.ts`、`multi-battle.test.ts`

**Interfaces:**
- Consumes: Task 1–3 的完整改動
- Produces: 回填實測值的兩份 spec；L4-C 的處置記錄

- [ ] **Step 1: 跑全套（排除兩個並行假紅的檔案）**

```
npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"
```

- [ ] **Step 2: 單獨複測那兩個檔案**

```
npx vitest run test/unit/perf-gate.test.ts test/integration/rematch.test.ts
```

跑之前確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁。

- [ ] **Step 3: 處理 `ai-duel-matrix` L4-C**

那一條在破防軸那一份就紅著（`docs/.../2026-08-07-defend-axis-design.md` §8.5），
專案負責人裁定「等 #136 做完再重測」。現在重測：

```
npx vitest run test/integration/ai-duel-matrix.test.ts -t "能量優勢"
```

它的斷言是 `expect(o.blueDamage * 3).toBeLessThan(o.redDamage)`。
基線：破防軸之前是「紅 122 : 藍 0」，破防軸之後是「紅 561 : 藍 428」。

- 綠了 → 記錄新的傷害交換數字，不改測試
- 仍紅 → **不准自己調門檻。** 報告格式：

```
測試名
  舊值 → 新值（門檻）
  根因：一句話
  建議：重新定值 / 改判準 / 撤回 B
```

- [ ] **Step 4: 逐條處理其他紅掉的測試**

`ai-manoeuvre.test.ts` 的 `safetyShare`（現行上限 0.05、實測最差 1.83%）
預期會**下降** —— 政策層提早介入，硬限制就少動。它是單邊上限，下降不會變紅。
其餘紅的一律先查根因再報告，不得逕自調門檻。

**spec §4.4 的三條否決條件優先於一切**：六場 `minAlt` 仍有低於 500 m 的、
`shootableShare` 變差、`floorPitchAngle` 在高空不是嚴格無操作 —— 任何一條
成立就整份撤回，不是調數字。

- [ ] **Step 5: 回填 `2026-08-07-defend-energy-floor-design.md`**

加一節「## 6. 實作後的實測回填」，內容：

- `floorPitch` 的掃描表（Task 2 Step 4）與選值理由
- 六場的 `minAlt` / `survived` / `shootableShare`，修補前後對照
- B 部分的裁決：留下還是 revert，附 `shootableShare` 的前後值
- `ai-duel-matrix` L4-C 的處置
- 若有任何一節的設計在實作中被推翻，明寫「實作後修正」並保留原文供追溯
  （這個專案的既有慣例，見 `2026-08-06-visible-evasion-design.md`）

**同時更正 spec §5 的影響範圍表**：它原本寫六場護欄放
`test/integration/ai-manoeuvre.test.ts`，實際放在
`test/integration/ai-visible-evasion.test.ts`（理由見本計畫的 File Structure），
且 `applyFloor` 的簽名多收一個 `self`（垂直朝下的退化需要機首的水平投影）。

- [ ] **Step 6: 更新破防軸那一份的 §8.5**

`docs/superpowers/specs/2026-08-07-defend-axis-design.md` §8.5 的處置表裡，
`ai-duel-matrix` L4-C 那一列目前寫「**仍紅，待裁定**」。依 Step 3 的結果更新，
並在 §8.7 的裁定段落補一行指向 #136 的實際結果。

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-defend-energy-floor-design.md docs/superpowers/specs/2026-08-07-defend-axis-design.md
```

（若 Step 3/4 有經專案負責人裁定的測試改動，一併 `git add` 那些明確路徑。）

訊息：

```
docs: #136 —— 實作後結果回填

floorPitch 的掃描表與選值、六場的修補前後對照、B 部分的裁決、
ai-duel-matrix L4-C 的處置。

一併更正設計文件 §5：六場護欄實際放在 ai-visible-evasion.test.ts
而不是 ai-manoeuvre.test.ts（後者是 1v1、300 秒，沒有腳本射手在
後方連續射擊那個場景），applyFloor 的簽名多收一個 self。
```

---

## Self-Review

**1. Spec 覆蓋**

| Spec 節 | 對應任務 |
|---|---|
| §2.1 `floorPitchAngle` / `applyFloor` | Task 1 Step 5 / 9 |
| §2.1 三個設計約束（航跡角／連續／方位不變） | Task 1 Step 2、7 的測試逐條對應 |
| §2.1 套用範圍：所有意圖與所有 mode | Task 1 Step 11 的接線位置（在 mode 分支之後） |
| §2.1 `floorPitch` 待掃描回填 | Task 2 Step 4 / 5 |
| §2.2 B：`arbitrate` 移一行 | Task 3 Step 3 |
| §2.2 B 的硬性驗收 | Task 3 Step 5 |
| §3 不做的（軸／安全層／腳本射手／高空消耗） | Global Constraints 前三條 + 未安排任何任務 |
| §4.1 六場 `minAlt` > 500 且跑滿 | Task 2 Step 2 的護欄測試 |
| §4.2 `shootableShare` 不得變差 | Task 3 Step 5 |
| §4.3 回歸 | Task 4 Step 1–4 |
| §4.4 否決條件 | Task 2 Step 6、Task 3 Step 5、Task 4 Step 4 都明寫 |
| §5 影響範圍 | Task 4 Step 5 更正它 |

**發現的缺口與修補**：§4.4 第三條否決條件（「`floorPitchAngle` 在高空不是
嚴格的無操作」）原本只在 Task 4 被提及，沒有測試落點 —— 已在 Task 1 Step 2
的第一條測試用 `toBe(0)`（不是 `toBeCloseTo`）釘住，並在 Step 7 補了
「底限為 0 時逐位元不動」。

**2. 佔位符掃描**

Task 2 Step 3 刻意不預設紅或綠 —— 那不是佔位符，是因為 `floorPitch` 的
起始值夠不夠用要靠實測，而兩種結果的後續動作都寫明了。Task 2 Step 5
「若 20° 勝出就不用改值」同理。

Task 2 Step 4 的掃描 `it` 是**暫時**的，Step 4 最後明寫要刪掉，不會留下
會改動全域設定的測試。

**3. 型別一致性**

- `SteerConfig.floorPitch`：Task 1 Step 4 定義，Step 5 消費 ✓
- `floorPitchAngle(groundClearance, cfg?)`：Task 1 Step 5 定義，Step 11 呼叫、
  Task 1 Step 2 的測試消費 ✓
- `applyFloor(self, minPitch, aim)`：Task 1 Step 9 定義，Step 11 呼叫、
  Step 7 的測試消費 ✓ —— **比 spec §2.1 的簽名多一個 `self`**，已在
  Task 4 Step 5 安排更正 spec
- `Aspect = 'tail' | 'beam'`：Task 2 Step 2 定義並在同一步消費 ✓
- `Result.minAlt` / `Result.survived`：Task 2 Step 2 定義並在同一步消費 ✓
- `measure(standoff, aspect?)`：Task 2 Step 2 改簽名，既有的兩條
  `for (const standoff of [700, 900])` 測試不傳第二個參數，靠預設值
  `'tail'` 維持原行為 ✓

**4. 既有檔案的前置確認（已驗）**

- `test/unit/ai-steer.test.ts` 存在（1180+ 行），已 import `DEFAULT_STEER`、
  `Vector3`、`Aircraft`、`P51D`；需補 `floorPitchAngle`、`applyFloor`、`DEG`
- `test/unit/ai-rules.test.ts` 存在，已有 `neutral()` 輔助函式與
  `describe('extend 的三個理由與射擊否決權')` 區塊，已 import
  `createRuleState`、`stepRules`、`DEFAULT_RULES`
- `src/ai/rules.ts` 的 `arbitrate` 第一行是 `if (s.defendLatch) return 'defend'`；
  `if (s.extendFloorLatch && sit.energyAdvantage < cfg.floorExempt) return 'extend'`
  在它下方約 35 行處
- `src/ai/steer.ts` 的 `const U = makeScratch(2)` 在 `shrinkTowardNose` 上方；
  `steerCommand` 的 `if (mode === 'unload')` 區塊緊接在意圖 switch 之後
- `src/world/lead.ts:69` 是 `out.copy(P).addScaledVector(V, t).normalize()`
  —— 這是「`aimWorld` 在所有分支都是單位向量」的最後一塊拼圖
  （行號會隨改動漂移，用符號搜尋而不是行號定位）
