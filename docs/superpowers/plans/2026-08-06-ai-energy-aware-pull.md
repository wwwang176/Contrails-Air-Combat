# 依能量狀態限制拉桿量 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。步驟以 `- [ ]` 追蹤。

**Goal:** 讓 AI 在能量不足時不再硬拉，除非手上有射擊解。

**Architecture:** 一個純函數 `energyPull(cornerRatio, shotInstant)` 產生 0..1 的
係數，經既有的 `shrinkTowardNose` 套在瞄準誤差角上（方位不動），與既有的
`unloadPull` 相乘。不新增任何狀態。

**Spec:** `docs/superpowers/specs/2026-08-06-ai-energy-aware-pull-design.md`

## Global Constraints

- 不得引入 `@types/node`；`noUncheckedIndexedAccess` 開啟。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體。
- 每一條新測試**先跑一次確認是紅的**。
- **不得為了讓測試通過而放寬門檻。**
- 型別檢查：`npx tsc --noEmit`（沒有 `npm run typecheck`）。
- 測試：`npm test`；單檔 `npx vitest run <path>`。
- 效能閘門在整套並行時會因機器競爭而紅；判定以單獨跑該檔為準。
- commit 指定明確路徑，**不得 `git add -A`**。
- 暫時的量測探針放在 `test/_probe.test.ts`，**每次量完立刻刪除**，不得進版控。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/ai/steer.ts`（改） | `energyPull`、三個設定欄位、`steerCommand` 的後處理段 |
| `test/unit/ai-steer.test.ts`（改） | 係數的形狀、免除規則、與 unload 相乘、套用範圍 |
| `test/integration/ai-manoeuvre.test.ts`（可能改） | 若意圖分布明顯改變，回填註解裡的實測表 |

---

### Task 1: `energyPull` 純函數

**Files:** Modify `src/ai/steer.ts`, `test/unit/ai-steer.test.ts`

**Produces:** `export function energyPull(cornerRatio, shotInstant, cfg?): number`、
`SteerConfig` 新增 `pullEase` / `pullFloor` / `pullShotRelief`

- [ ] **Step 1: 寫失敗的測試**

```ts
describe('依能量狀態限制拉桿', () => {
  it('能量充足時完全不限制', () => {
    expect(energyPull(1.0, 0)).toBe(1)
    expect(energyPull(1.5, 0)).toBe(1)
  })

  it('由 pullEase 線性降到 cornerEnter 的 pullFloor', () => {
    const lo = DEFAULT_RULES.cornerEnter
    expect(energyPull(lo, 0)).toBeCloseTo(DEFAULT_STEER.pullFloor, 9)
    expect(energyPull(lo - 0.2, 0)).toBeCloseTo(DEFAULT_STEER.pullFloor, 9)
    const mid = energyPull((lo + DEFAULT_STEER.pullEase) / 2, 0)
    expect(mid).toBeGreaterThan(DEFAULT_STEER.pullFloor)
    expect(mid).toBeLessThan(1)
  })

  it('單調不遞減', () => {
    let prev = -1
    for (let r = 0.5; r <= 1.3; r += 0.05) {
      const v = energyPull(r, 0)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('有射擊解時免除限制', () => {
    const lo = DEFAULT_RULES.cornerEnter
    // 【與 target.ts 的 shotRelief 同一條分野】省能量是預防性的理由，
    // 有槍在手就先開槍
    expect(energyPull(lo, DEFAULT_STEER.pullShotRelief)).toBeCloseTo(1, 9)
    expect(energyPull(lo, DEFAULT_STEER.pullShotRelief * 2)).toBeCloseTo(1, 9)
    const half = energyPull(lo, DEFAULT_STEER.pullShotRelief / 2)
    expect(half).toBeGreaterThan(DEFAULT_STEER.pullFloor)
    expect(half).toBeLessThan(1)
  })

  it('起始值：pullEase 不低於 cornerEnter，pullFloor 在 (0,1)', () => {
    expect(DEFAULT_STEER.pullEase).toBeGreaterThan(DEFAULT_RULES.cornerEnter)
    expect(DEFAULT_STEER.pullFloor).toBeGreaterThan(0)
    expect(DEFAULT_STEER.pullFloor).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL —— `energyPull` 不存在。

- [ ] **Step 3: 加設定欄位**

`SteerConfig` 裡，`defendOffset` 之後：

```ts
  /**
   * 能量充足的門檻：`cornerRatio` 高於此值時完全不限制拉桿。
   *
   * **起始值，待實測回填。** 掃描 0.9 / 1.0 / 1.1 / 1.25。
   */
  pullEase: number
  /**
   * 拉桿係數的下限。0 = 能量見底時完全不拉（不可接受，連指向都做不到）。
   *
   * **起始值，待實測回填。** 掃描 0.3 / 0.5 / 0.7。
   */
  pullFloor: number
  /**
   * 有射擊解時免除限制的飽和點：`shotInstant` 達此值即完全免除。
   *
   * 與 `DEFAULT_TARGET.shotRelief` 同值同理由 —— 省能量是**預防性**的理由，
   * 「有槍在手就先開槍」壓過它。
   */
  pullShotRelief: number
```

`DEFAULT_STEER` 加 `pullEase: 1.0, pullFloor: 0.5, pullShotRelief: 0.25,`。

- [ ] **Step 4: 實作**

```ts
/**
 * 能量不足時把拉桿量收小，0..1。乘在瞄準誤差角上，**方位不動**。
 *
 * 【為什麼鑰匙是 cornerRatio 而不是失速裕度】`unloadPull` 已經在管「拉太猛
 * 會失速嗎」。這一項問的是另一件事：「我付得起這個拉桿嗎」。誘導阻力 ∝ n²，
 * 4.32 G 的誘導阻力是 1 G 的 18.7 倍 —— 實測 `approach` 以 52° 坡度拉 4.32 G，
 * 每秒燒掉 32 公尺比能量，而引擎只給得起 13.6。
 *
 * 【下限不是 0】能量見底也要保有基本的指向能力；而且低於 `cornerEnter`
 * 之後 `extend` 已經接手，這個係數不再主導。
 *
 * 【有射擊解時免除】與 `rules.ts` 的「有槍在手時『比他弱』不是離開的理由」、
 * `target.ts` 的 `shotRelief` 是同一條分野的第三次套用：預防性的理由讓位給
 * 「現在就打得到」。內插而非布林，避免在門檻上跳變。
 */
export function energyPull(
  cornerRatio: number, shotInstant: number, cfg: SteerConfig = DEFAULT_STEER,
): number {
  const span = cfg.pullEase - PULL_FLOOR_RATIO
  let base: number
  if (!(span > 0)) {
    base = 1
  } else {
    const t = (cornerRatio - PULL_FLOOR_RATIO) / span
    const c = t < 0 ? 0 : t > 1 ? 1 : t
    base = cfg.pullFloor + (1 - cfg.pullFloor) * c
  }
  if (base >= 1) return 1
  const relief = cfg.pullShotRelief > 0
    ? Math.min(1, shotInstant / cfg.pullShotRelief)
    : 0
  return base + relief * (1 - base)
}
```

並在 `THREAT_EXIT_ANCHOR` 那一類常數旁加：

```ts
/**
 * `energyPull` 斜坡的下端。**必須等於 `DEFAULT_RULES.cornerEnter`** —— 那是
 * `extend` 接手的點，係數在該處觸底才與意圖層的分工對齊。
 *
 * 【為什麼不 import DEFAULT_RULES】`steer.ts` 不依賴 `rules.ts` 的設定。
 * 耦合由 `test/unit/ai-steer.test.ts` 的一條斷言釘住。
 */
export const PULL_FLOOR_RATIO = 0.75
```

並在測試裡加一條 `expect(PULL_FLOOR_RATIO).toBe(DEFAULT_RULES.cornerEnter)`。

- [ ] **Step 5: 跑測試**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: energyPull —— 依能量狀態的拉桿係數（尚未接線）"
```

---

### Task 2: 接進 `steerCommand`

**Files:** Modify `src/ai/steer.ts`, `test/unit/ai-steer.test.ts`

- [ ] **Step 1: 寫失敗的測試**

```ts
it('能量不足時 engage 的誤差角被收小，方位不動', () => {
  scene([600, 4300, -400], [0, 0, -180])
  sit.stallMargin = 3            // 不觸發 unload
  sit.shotInstant = 0
  sit.cornerRatio = 1.2
  steerCommand('engage', 'normal', sit, basis, self, 0, k, cmd)
  const rich = cmd.aimWorld.clone()

  sit.cornerRatio = DEFAULT_RULES.cornerEnter    // 能量見底
  steerCommand('engage', 'normal', sit, basis, self, 0, k, cmd)

  const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
  expect(cmd.aimWorld.angleTo(nose)).toBeLessThan(rich.angleTo(nose) - 1e-3)
  // 方位不動 —— 那才是滾轉指令的來源
  const perp = (v: Vector3): Vector3 =>
    v.clone().addScaledVector(nose, -v.dot(nose)).normalize()
  expect(perp(cmd.aimWorld).angleTo(perp(rich))).toBeCloseTo(0, 6)
})

it('有射擊解時不收小', () => {
  scene([600, 4300, -400], [0, 0, -180])
  sit.stallMargin = 3
  sit.cornerRatio = DEFAULT_RULES.cornerEnter
  sit.shotInstant = DEFAULT_STEER.pullShotRelief
  steerCommand('engage', 'normal', sit, basis, self, 0, k, cmd)
  const shooting = cmd.aimWorld.clone()
  sit.cornerRatio = 1.2
  steerCommand('engage', 'normal', sit, basis, self, 0, k, cmd)
  expect(cmd.aimWorld.angleTo(shooting)).toBeCloseTo(0, 6)
})

it('extend 不套用（否則會把瞄準點拉到速度向量上方，變成命令爬升）', () => {
  scene([0, 4000, -600], [0, 0, -180])
  sit.cornerRatio = 1
  steerCommand('extend', 'normal', sit, basis, self, 0, k, cmd)
  const rich = cmd.aimWorld.clone()
  sit.cornerRatio = DEFAULT_RULES.cornerEnter
  steerCommand('extend', 'normal', sit, basis, self, 0, k, cmd)
  // extend 的瞄準點只由 extendPitchAngle 決定，與 energyPull 無關。
  // cornerRatio 改變會改 extendPitchAngle，所以這裡驗的是「仍然貼著速度向量」
  const velDir = self.state.velocity.clone().normalize()
  expect(cmd.aimWorld.angleTo(velDir)).toBeLessThan(30 * Math.PI / 180)
  void rich
})
```

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL —— 前兩條，因為係數還沒接線。

- [ ] **Step 3: 改 `steerCommand` 的後處理段**

```ts
  // ── 收小拉桿：兩個獨立的理由，都表達成「誤差角乘一個 ≤1 的係數」 ──
  //
  // 【為什麼相乘】`unloadPull` 管「拉太猛會失速嗎」、`energyPull` 管「我付得起
  // 這個拉桿嗎」，兩者互相獨立；都在各自的門檻上等於 1，乘積因此也連續。
  //
  // 【`extend` 與 `defend` 不套】extend 的瞄準點在速度向量上，往機首收會把它
  // 拉到速度向量**上方**（大攻角時機首高於航跡）＝命令爬升，與目的相反；
  // defend 是這一輪刻意不動的（使用者的訴求是要更會閃）。
  //
  // 【`overshoot` / `speedRecover` / `planeDegenerate` 不套】它們的優先序高於
  // 意圖，各自在處理更急的問題。
  const chasing = intent === 'engage' || intent === 'approach' || intent === 'merge'
  if (mode === 'normal' || mode === 'unload') {
    const unload = mode === 'unload' ? unloadPull(sit.stallMargin, cfg) : 1
    const energy = chasing ? energyPull(sit.cornerRatio, sit.shotInstant, cfg) : 1
    const factor = unload * energy
    if (factor < 1) shrinkTowardNose(self, factor, out.aimWorld)
  }
```

（取代原本只處理 `mode === 'unload'` 的那一段。）

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS，且既有的 unload 相關斷言全部維持。

- [ ] **Step 5: 型別與全套**

Run: `npx tsc --noEmit`
Run: `npm test`
Expected: 除效能閘門（並行負載）外全綠。**任何其他紅燈都要先查根因，不得放寬。**

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: 追擊型意圖依能量狀態收小拉桿量"
```

---

### Task 3: 量測與回填

**Files:** Modify `src/ai/steer.ts`（只改 `DEFAULT_STEER` 的值與註解）

- [ ] **Step 1: 建立量測探針**

`test/_probe.test.ts`（量完刪除）。1v1、300 秒、六種開局，輸出：

- 五個意圖的佔比
- 每個意圖的平均過載、比能率、坡度
- split-S 發生率：進入 `extend` 後 4 秒內坡度是否超過 90°
- `unloadPull` 與 `energyPull` **同時** < 1 的時間佔比（spec §7 風險 3）

以及受控場景（`ai-defence` 的三台前後咬）36 種幾何、**120 秒**：

- 藍方掉血、打掉紅 A、安全層介入率

- [ ] **Step 2: 量修改前的基線**

`git stash push -q -- src/ai/steer.ts` → 跑 → `git stash pop -q`。
**不得用 `git checkout HEAD -- <file>`。**

已知的修改前數值（2026-08-06 實測，可交叉核對）：

```
extend 44~47%   engage 8~15%
approach 過載 4.32、比能率 −31.8、坡度 52°
extend 過載 1.67、坡度 54°、取得率 40%
```

- [ ] **Step 3: 掃描三個參數**

| 參數 | 掃描值 |
|---|---|
| `pullEase` | 0.9 / 1.0 / 1.1 / 1.25 |
| `pullFloor` | 0.3 / 0.5 / 0.7 |
| `pullShotRelief` | 0.15 / 0.25 / 0.4 |

逐一掃（不做全組合），每次只改一個。

- [ ] **Step 4: 依 spec §6.3 判定**

- `engage` 佔比**沒有上升** → 撤回整個提案。
- 攻擊產出（受控場景的「打掉紅 A」總量）下降**超過 15%** → 撤回。
- 撤回時把掃描表與根因寫進 `DEFAULT_STEER` 的註解，比照「射程內控速」等三筆。

若通過：回填選定值，把掃描表寫進三個欄位的註解，格式比照 `unloadMargin`。

- [ ] **Step 5: 若某一軸呈現混沌**（相鄰值方向相反、非單調）

維持起始值，並在註解裡如實寫「這一軸的量測沒有給出強訊號」。**不得編一個
事後理由。**

- [ ] **Step 6: 刪除探針、跑全套、Commit**

```bash
rm -f test/_probe.test.ts
npm test
git add src/ai/steer.ts
git commit -m "tune: 回填 energyPull 的三個參數"
```

---

### Task 4: 回填既有測試的實測表

**Files:** Modify `test/integration/ai-manoeuvre.test.ts`

- [ ] **Step 1: 檢查五個門檻的實測值有沒有明顯移動**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts`

該檔的註解裡有一張六場開局的實測表（`belowStall` / `safetyShare` /
`longestExtend` / `steepShare` / `offNose`）。若數值明顯改變，更新那張表並
註明是本次修改造成的。

**門檻本身不動**——它們是護欄，改了就失去比較基準。

- [ ] **Step 2: Commit**

```bash
git add test/integration/ai-manoeuvre.test.ts
git commit -m "docs: 回填 ai-manoeuvre 的實測表"
```

---

## 完成後

- 人工驗收：`I` 模式看一輪，確認（1）AI 不再頻繁地爬升到一半翻過去往下拉
  （split-S）；（2）能量低時它會鬆一點桿而不是硬拉；（3）咬到人時仍然敢拉。
- 尚未處理、已記錄的鄰近問題：`extend` 安定後仍有 1.5 G（機翼水平俯衝應該
  接近 1.0）；僚機由站位下方歸隊時誤差會先擴大 70%。
