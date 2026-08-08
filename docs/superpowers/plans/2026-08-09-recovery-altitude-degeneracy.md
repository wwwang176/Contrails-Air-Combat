# 拉起高度在「拉不動」時的退化 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `recoveryAltitude` 在「用現在的速度拉不動」時回傳一個有限、物理正確的高度代價，使撞地硬接管不再於五公里高空誤觸發並對已失速的飛機下令爬升。

**Architecture:** 把 `recoveryAltitude` 從「單段拉平」補完成「先俯衝換速度、再拉平」的兩段模型。最佳拉起過載有閉式解 `n* = √(1 + (2(1−cos|γ|))^(2/3))`，只與航跡角有關，因此不引入任何新參數。`nMax ≥ n*` 時第一段長度為零，回傳值與修改前逐位元相同。

**Tech Stack:** TypeScript（strict、`noUncheckedIndexedAccess`）、vitest、three.js。

**依據 spec:** `docs/superpowers/specs/2026-08-09-recovery-altitude-degeneracy-design.md`

## Global Constraints

- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已被修改的檔案。一律列明確路徑。
- **沒有 `@types/node`** —— 不可用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 開著（對 typed array 也適用）；`noUnusedLocals` / `noUnusedParameters` 開著。
- `src/ai/` **不得** import `src/battle/`。
- 熱路徑不得配置（`applySafety` 是 240 Hz × 40 架）。
- **絕不為了讓測試變綠而放寬門檻。** 護欄重新定值是專案負責人的決定，不是實作者的 —— 紅了要先量、先報告、先問。
- 每一條新測試都要先看到它紅（或用 mutation 證明它不是假綠）。
- 型別檢查指令是 `npx tsc --noEmit`（沒有 `npm run typecheck`）。
- **絕不用 PowerShell 讀寫含中文的檔案。** 中文 commit message 一律寫到 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`。
- 暫存檔放 `$CLAUDE_JOB_DIR/tmp`。
- 效能測試前要確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁。

## 檔案結構

| 檔案 | 這次的職責 |
|---|---|
| `src/ai/safety.ts` | 唯一的實作改動點。`recoveryAltitude` 的公式與兩處註解 |
| `test/unit/ai-safety.test.ts` | 純函數斷言（`describe('recoveryAltitude')`）與行為斷言（`describe('applySafety')`）。既有的 `describe('失速硬介入')` **一字不改** |
| `test/integration/ai-safety-matrix.test.ts` | **不改**。它是「這次沒有動到既有行為」的證據，改了就不是證據了 |
| `docs/superpowers/specs/2026-08-09-recovery-altitude-degeneracy-design.md` | Task 2 回填實測結果 |

---

### Task 1: `recoveryAltitude` 的兩段式改出

**Files:**
- Modify: `src/ai/safety.ts:51-71`（`recoveryAltitude` 及其文件註解）
- Modify: `src/ai/safety.ts:233-236`（`lookahead` 前瞻守衛的註解，其中一句描述的機制在本次被移除）
- Test: `test/unit/ai-safety.test.ts`

**Interfaces:**
- Consumes: 無（本計畫的第一個 task）
- Produces: `recoveryAltitude(tas: number, gamma: number, nMax: number): number` —— 簽名不變、export 不變。行為改變只發生在 `nMax < n*(gamma)` 的區域。

- [ ] **Step 1: 刪掉那條記錄舊行為的測試**

`test/unit/ai-safety.test.ts` 裡，把這一整條刪除：

```ts
  it('拉不動（nMax ≤ 1）時回傳 Infinity', () => {
    // 【為什麼是 Infinity 而不是一個很大的數】它會流進「離海高度夠不夠」
    // 的比較。用大數的話，在極高空仍然可能通過比較而不介入；Infinity
    // 保證任何有限高度都會觸發。
    expect(recoveryAltitude(200, -45 * DEG, 1)).toBe(Infinity)
    expect(recoveryAltitude(200, -45 * DEG, 0.5)).toBe(Infinity)
  })
```

【為什麼是刪掉而不是改斷言】它釘住的正是這次要修掉的缺陷，而它的註解記載
的理由（「Infinity 保證任何有限高度都會觸發」）已被實測否決 —— 那正是誤
觸發的成因。留著改斷言會讓那段理由變成一句與程式碼矛盾的註解。

- [ ] **Step 2: 寫失敗的單元測試**

先把檔案頂端的

```ts
import { DEG } from '../../src/core/math'
```

改成

```ts
import { DEG, G0 } from '../../src/core/math'
```

【為什麼測試要用同一個 `G0` 常數】下面「逐位元相同」那一條用 `toBe` 比浮點
結果。自己在測試裡寫 `9.80665` 只要有一位不同就會變成一條神秘的 ULP 失敗。

然後在 `describe('recoveryAltitude')` 內，`it('爬升時（gamma > 0）不需要高度', …)`
之前，插入下列六條。

```ts
  /**
   * 【`nMax > 1` 只是說「用現在這個速度」拉不平，不是說救不回來】俯衝會把
   * 高度換成速度，而 `nMax ∝ V²`。真正的改出是兩段：先換速度、再拉平，
   * 兩段的高度代價都是有限的。回 Infinity 會讓撞地分支在任何高度接管，
   * 而那台飛機其實只是失速（spec 2026-08-09 §2）。
   */
  it('拉不動（nMax < 1）時回傳有限值，不是 Infinity', () => {
    const h = recoveryAltitude(200, -45 * DEG, 0.5)
    expect(Number.isFinite(h)).toBe(true)
    expect(h).toBeGreaterThan(0)
  })

  it('拉不動時，俯衝角越陡仍然需要越多高度', () => {
    const shallow = recoveryAltitude(200, -20 * DEG, 0.5)
    const steep = recoveryAltitude(200, -60 * DEG, 0.5)
    expect(steep).toBeGreaterThan(shallow)
  })

  /** 越拉不動，要換的速度越多，第一段就越長。 */
  it('拉不動時，nMax 越小需要越多高度', () => {
    const weak = recoveryAltitude(200, -45 * DEG, 0.3)
    const strong = recoveryAltitude(200, -45 * DEG, 0.9)
    expect(weak).toBeGreaterThan(strong)
  })

  /**
   * 【真正的「救不回來」與無效輸入】完全沒有升力時 `n(v) = nMax·(v/tas)²`
   * 恆為 0，換多少速度都拉不動。負值與 `NaN` 也走這條 —— 少了這道守衛，
   * `NaN` 會一路流到 `margin <= needed`，那個比較永遠為假，安全層就**永遠
   * 不介入**，比誤觸發更糟。
   */
  it('沒有升力或輸入無效時回傳 Infinity', () => {
    expect(recoveryAltitude(200, -45 * DEG, 0)).toBe(Infinity)
    expect(recoveryAltitude(200, -45 * DEG, -1)).toBe(Infinity)
    expect(recoveryAltitude(200, -45 * DEG, NaN)).toBe(Infinity)
  })

  /**
   * 【這一條是兩段模型的定義，也是唯一守得住 `n*` 的斷言】兩段模型是
   * 「先俯衝到某個速度 `v`，再在 `v` 上拉平」，而 `v` 只能比現在快
   * （俯衝只會加速）。`recoveryAltitude` 宣稱回傳的是**所有可行 `v` 之中
   * 最便宜的那一個**，`n*` 只是那個最小值點的閉式解。
   *
   * 所以直接數值掃描一遍，比對兩件事：回傳值不高於掃描到的最小值（`n*`
   * 沒有解錯），也不顯著低於它（沒有少算某一段）。
   *
   * 【為什麼要涵蓋 1 < nMax < n\*】那一段是「現在拉得動，但加速一點更划算」。
   * 若分界誤寫成 `nMax > 1`，這幾格會走單段公式而偏高，只有這條會抓到。
   */
  it('回傳的是兩段模型在所有可行拉起速度上的最小值', () => {
    const g = -45 * DEG
    const c = 1 - Math.cos(Math.abs(g))
    const tas = 200
    for (const nMax of [0.4, 0.9, 1.1, 1.3, 3]) {
      let best = Infinity
      // v 從 tas 掃到 5 × tas，步長 0.2 m/s
      for (let i = 0; i <= 4000; i++) {
        const v = tas * (1 + i * 0.001)
        const r = v / tas
        const n = nMax * r * r
        if (n <= 1) continue
        const dive = (v * v - tas * tas) / (2 * G0)
        const pull = ((v * v) / (G0 * Math.sqrt(n * n - 1))) * c
        best = Math.min(best, dive + pull)
      }
      const h = recoveryAltitude(tas, g, nMax)
      expect(h).toBeLessThanOrEqual(best)
      expect(h).toBeGreaterThan(best * 0.999)
    }
  })

  /**
   * 【拉得動的那一側一個字都沒變】這一條釘住「不是換模型，是把定義域補完」。
   * 手算：R = 200²/(G0·√35)，H = R·(1 − cos45°)。用 `toBe` 逐位元比 ——
   * 運算順序與實作相同，所以浮點結果應完全一致。
   */
  it('拉得動時與單段閉式解逐位元相同', () => {
    const radius = (200 * 200) / (G0 * Math.sqrt(6 * 6 - 1))
    expect(recoveryAltitude(200, -45 * DEG, 6))
      .toBe(radius * (1 - Math.cos(45 * DEG)))
  })

  /**
   * 【`tas` 會抵消掉】第一段要換到的速度是 `v² = tas²·n*/nMax`，而
   * `nMax ∝ tas²`，所以 `tas²` 上下相消 —— `v` 有極限，不是奇點。
   * 這裡用固定的 `nMax/tas²` 比值把速度一路壓小來驗。
   */
  it('速度趨近 0 時回傳有限值', () => {
    const a = 0.5 / (200 * 200) // nMax / tas²，固定
    for (const tas of [200, 20, 2, 0.2]) {
      const h = recoveryAltitude(tas, -45 * DEG, a * tas * tas)
      expect(Number.isFinite(h)).toBe(true)
    }
  })
```

- [ ] **Step 3: 寫失敗的行為測試**

在 `describe('applySafety')` 內，`it('連續呼叫不配置：一萬次結果一致', …)`
之前插入。這一條是缺陷的直接複現。

```ts
  /**
   * 【缺陷複現，spec 2026-08-09 §1】實測 `ai-command-channel` 的
   * `groundUnderOrder` 護欄紅掉時，六次事件全部長這樣：五公里以上、
   * TAS 48–58、下沉率約 0.5 m/s。那個高度不可能有撞地風險，飛機只是
   * 失速了 —— 而撞地分支會命令它爬升，正好是最不該做的事。
   *
   * 修改前這裡回 `'ground'`：`nMax = 0.71 ≤ 1` → `recoveryAltitude`
   * 回 Infinity → `margin <= Infinity` 在任何高度都成立。
   */
  it('五公里高空、失速速度、微幅下沉 → 走失速分支而不是撞地分支', () => {
    const a = new Aircraft(P51D, 5038, 50)
    a.state.position.set(0, 5038, 0)
    a.state.velocity.set(0, -0.5, -50)
    a.prevPosition.copy(a.state.position)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('stall')
  })

  /** 【光是換分支不夠】補救方向要真的反過來：失速要壓頭、加油門。 */
  it('那一格的補救是壓頭加油門，不是爬升', () => {
    const a = new Aircraft(P51D, 5038, 50)
    a.state.position.set(0, 5038, 0)
    a.state.velocity.set(0, -0.5, -50)
    a.prevPosition.copy(a.state.position)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.aimWorld.y).toBeLessThan(0)
    expect(cmd.throttle).toBeGreaterThan(1)
    expect(cmd.brake).toBe(0)
  })
```

- [ ] **Step 4: 跑測試，確認全部是紅的**

```
npx vitest run test/unit/ai-safety.test.ts
```

預期**六條紅、兩條綠**：

| 測試 | 預期 |
|---|---|
| 拉不動（nMax < 1）時回傳有限值 | 🔴 `Number.isFinite(Infinity)` → `false` |
| 拉不動時，俯衝角越陡仍然需要越多高度 | 🔴 `Infinity > Infinity` → false |
| 拉不動時，nMax 越小需要越多高度 | 🔴 `Infinity > Infinity` → false |
| 回傳的是所有可行拉起速度上的最小值 | 🔴 第一格 `nMax = 0.4` 就回 `Infinity`，`Infinity <= best` 為假 |
| 速度趨近 0 時回傳有限值 | 🔴 `nMax` 全部小於 1 → `Infinity` |
| 五公里 → `'stall'` | 🔴 實得 `'ground'` |
| 沒有升力或輸入無效時回傳 Infinity | 🟢 舊碼 `!(nMax > 1)` 對 0 / −1 / NaN 都回 Infinity → 靠 Step 8 的 mutation 證明 |
| 拉得動時與單段閉式解逐位元相同 | 🟢 它就是舊公式。這一條是防迴歸用的，本來就該綠 |

行為測試那一組（Step 3）另有兩條紅：`五公里 → 'stall'`（上表已列）與
`那一格的補救是壓頭加油門`（`aimWorld.y` 實得正值）。

**記下實際紅了幾條與各自的訊息**，Task 2 的回填要用。

【若「逐位元相同」在此刻就紅了，停下來】那代表 `G0` 不是 `9.80665`，或
測試裡的運算順序與實作不同 —— 先查清楚，不要改成 `toBeCloseTo` 蒙混過去。

- [ ] **Step 5: 改實作**

`src/ai/safety.ts`，把整段 `recoveryAltitude`（含文件註解，第 51–71 行）換成：

```ts
/**
 * 由俯衝角 γ 改出到水平所需的高度，m。
 *
 * 改出是兩段：**先俯衝把高度換成速度**（只有速度夠才拉得動），**再拉平**。
 * 第二段的拉起半徑 `R = V² / (g·√(n²−1))`，由 γ 回到 0 掉的高度是
 * `R·(1 − cos|γ|)`。第一段的代價由能量守恆給：`(V² − V₀²) / 2g`。
 *
 * 【最佳拉起過載有閉式解，所以這裡沒有新參數】第一段越長，速度越高、半徑
 * 越小，但換速度本身要付高度。令 `c = 1 − cos|γ|`、`u = V²`，固定高度下
 * `n = a·u`（`a = nMax / tas²`，因為 `n = q̄·S·CL_max / W ∝ V²`）：
 *
 * ```
 * H(u) = (u − tas²)/(2g) + u·c / (g·√(a²u² − 1))
 * dH/du = 1/(2g) − c·(a²u² − 1)^(−3/2) / g = 0
 *   ⟹ n*² = 1 + (2c)^(2/3)
 * ```
 *
 * `n*` **只與航跡角有關**，與速度、高度、機種都無關（−45° 時 1.3039，
 * −89° 時 1.6028）。
 *
 * 【分界為什麼是 `nMax ≥ n*` 而不是 `nMax > 1`】`nMax ≥ n*` 代表現在就
 * 拉得動、而且再加速也不划算，第一段長度為零，式子退回單段閉式解 ——
 * **拉得動的那一側一個字都沒變**。用 `nMax > 1` 當分界則會在 `nMax → 1⁺`
 * 留一個跳到無限大的斷點。
 *
 * 【為什麼不是回 Infinity】`nMax ≤ 1` 說的是「用**現在這個速度**拉不平」，
 * 不是「救不回來」。回 Infinity 會讓 `applySafety` 的撞地分支在**任何有限
 * 高度**接管，並對一台已經失速的飛機下令爬升。實測誤觸發六次，全部在
 * 5,038–7,671 m、下沉率 0.5 m/s（spec 2026-08-09 §1）。
 *
 * 【模型忽略了什麼】第一段假設推力與阻力相消。WEP 下低速段推力大於阻力，
 * 所以這裡**高估**所需高度，偏保守。反方向的偏差（俯衝中 γ 還會變陡）由
 * `factor` 與 `lookahead` 覆蓋，與單段閉式解面對的是同一件事。
 *
 * 熱路徑。多付一個 `cbrt`、一個 `sqrt` 與幾次乘除，不配置。
 */
export function recoveryAltitude(tas: number, gamma: number, nMax: number): number {
  if (gamma >= 0) return 0
  // 【唯一真正的「救不回來」】完全沒有升力，`n(v) = nMax·(v/tas)²` 恆為 0，
  // 換多少速度都拉不動。NaN 也落在這裡，與修改前 `!(nMax > 1)` 的處置一致。
  if (!(nMax > 0)) return Infinity

  const c = 1 - Math.cos(Math.abs(gamma))
  // `root` 就是 √(n*² − 1)：由 n*² = 1 + (2c)^(2/3) 直接得 (2c)^(1/3)
  const root = Math.cbrt(2 * c)
  const nStar = Math.sqrt(1 + root * root)

  if (nMax >= nStar) {
    return ((tas * tas) / (G0 * Math.sqrt(nMax * nMax - 1))) * c
  }

  // 先換速度到 n = n*（`n ∝ V²` ⟹ `V² = tas²·n*/nMax`），再拉平
  const v2 = (tas * tas * nStar) / nMax
  return (v2 - tas * tas) / (2 * G0) + ((v2 / (G0 * root)) * c)
}
```

- [ ] **Step 6: 改 `lookahead` 前瞻守衛的註解**

同一個檔案，`applySafety` 內。把這一段：

```ts
  // 【前瞻只在已經下降時生效】它要補的是「**我正在俯衝，而且還在加深**」。
  // 平飛或爬升時套用會製造出一個不存在的俯衝 —— 而且低速時 `nMax ≤ 1`，
  // `recoveryAltitude` 回 Infinity，撞地分支會在任何高度永久接管。實測 4000 m、
  // TAS 30 的平飛就是這樣被吃掉的（那本來該由下面的失速硬接管處理）。
```

換成：

```ts
  // 【前瞻只在已經下降時生效】它要補的是「**我正在俯衝，而且還在加深**」。
  // 平飛或爬升時套用會製造出一個不存在的俯衝：實測 4000 m、TAS 30 的平飛
  // 被推出一個負的 γ，於是要付一份根本不存在的改出高度。
  //
  // 【這道守衛不再兼任「擋掉 Infinity」】2026-08-09 之前 `recoveryAltitude`
  // 在 `nMax ≤ 1` 時回 Infinity，這道守衛順便擋掉了平飛那一格；但只要有
  // 一點點下沉就擋不住，實測五公里高空仍然誤觸發。根因已在
  // `recoveryAltitude` 修掉，這裡只剩上面那個理由。
```

- [ ] **Step 7: 跑測試，確認全綠**

```
npx vitest run test/unit/ai-safety.test.ts
npx tsc --noEmit
```

預期：`ai-safety.test.ts` 全綠（含既有的 `describe('失速硬介入')` 五條，
**特別是 `同時有撞地風險與失速時，走撞地分支（拉起）`** —— 那條是 §4.5 的
裁定，實測 150 m / TAS 31.6 / γ −18.4° / `nMax = 0.468` 的 `needed` 為
263.5 m > 150 m，仍然走 `'ground'`）。

- [ ] **Step 8: 用 mutation 證明 Step 4 裡「本來就綠」的三條不是假綠**

Step 4 有兩條在修改前就是綠的。它們不是靠「先紅」證明的，要靠 mutation。
每個 mutation 做完**立刻還原**，逐個跑 `npx vitest run test/unit/ai-safety.test.ts`：

| # | mutation（改 `src/ai/safety.ts`） | 必須轉紅的測試 | 為什麼會紅 |
|---|---|---|---|
| 1 | `if (!(nMax > 0)) return Infinity` → 整行刪除 | `沒有升力或輸入無效時回傳 Infinity` | `NaN` 會一路算成 `NaN`（不是 `Infinity`）；`−1` 會算出負值 |
| 2 | `if (nMax >= nStar)` → `if (nMax > 1)` | `回傳的是兩段模型在所有可行拉起速度上的最小值` | `nMax = 1.1` 與 `1.3` 這兩格會走單段公式，值偏高，`h <= best` 為假 |
| 3 | `Math.sqrt(1 + root * root)` → `Math.sqrt(1 + root)` | 同上 | `n*` 解錯（−45° 時 1.3553 而非 1.3039），不再是最小值點 |

**三個都必須轉紅。** 若第 1 個沒紅，代表那道守衛是多餘的 —— 那就把它刪掉，
不要留一行沒有作用的程式。若第 2 或第 3 個沒紅，代表最小值那條斷言太弱
（多半是掃描步長或容差問題），**要加強斷言，不是接受**。

**三個都還原後再跑一次確認全綠**，才可以進下一步。用
`git diff src/ai/safety.ts` 確認還原乾淨。

- [ ] **Step 9: 跑安全矩陣，確認 288 組零變動**

```
npx vitest run test/integration/ai-safety-matrix.test.ts
```

預期全綠，包含 `契約內案例不少於 190 組`。spec §8 已用逐格比對算過
`changed = 0`、`min(nMax / n*) = 3.332`，這一步是把它在真實模擬裡驗一次。

**若這裡紅了，停下來報告** —— 那代表 spec §8 的逐格比對有誤，不是門檻該放寬。

- [ ] **Step 10: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
fix: 拉不動時的改出高度改成兩段式，不再回 Infinity

recoveryAltitude 在 nMax <= 1 時回 Infinity，使撞地硬接管在任何高度成立，
並對一台已失速的飛機下令爬升。實測誤觸發六次，全部在 5,038-7,671 m、
下沉率 0.5 m/s。

改成「先俯衝換速度、再拉平」。最佳拉起過載有閉式解
n* = sqrt(1 + (2(1-cos|gamma|))^(2/3))，只與航跡角有關，沒有新參數。
nMax >= n* 時第一段長度為零，回傳值與修改前逐位元相同 ——
安全矩陣 288 組零變動。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add src/ai/safety.ts test/unit/ai-safety.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 2: 護欄量測、全套回歸、回填

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-recovery-altitude-degeneracy-design.md`（新增 §13 實測結果）
- 不改任何測試檔或 `src/`

**Interfaces:**
- Consumes: Task 1 的 `recoveryAltitude(tas, gamma, nMax): number`
- Produces: 無（本計畫的最後一個 task）

- [ ] **Step 1: 跑主判準護欄**

先確認沒有殘留的 vite dev server、沒有開著遊戲的瀏覽器分頁（這幾條是重模擬，
背景負載會拉長時間但不影響結果；仍照專案慣例確認）。

```
npx vitest run test/integration/ai-command-channel.test.ts
```

看 `命令期間不動用安全層的撞地接管`（`o.groundUnderOrder === 0`）。

**這是驗收主判準。** 三種可能：

1. **轉綠** → 記下數字，進下一步。
2. **仍不為 0 但顯著下降** → 代表還有第二個來源。**先量**：把每次事件的
   高度、TAS、γ、`nMax` 印出來（改測試檔的 `console.log`，量完還原，不 commit），
   再**報告並詢問**專案負責人。**不得放寬門檻。**
3. **沒有下降** → 代表 spec §2 的根因判斷錯了。停下來報告。

- [ ] **Step 2: 跑戰術那三份同名護欄**

```
npx vitest run test/integration/ai-command-tactics.test.ts
```

看 `側翼期間不動用安全層的撞地接管`、`集火期間不動用安全層的撞地接管`
（以及第一份 `observe` 的 `groundUnderOrder`）。處置同 Step 1。

- [ ] **Step 3: 跑副判準**

```
npx vitest run test/integration/ai-withdraw-anchor.test.ts
```

看它印出來的觀測 JSON：`r60`、`r300`、`maxRadius`、`damage`、`leavingShare`、
`improvedShare`、`deathsUnderOrder`。與 spec `2026-08-09-withdraw-anchor-design.md`
§11 記錄的修後數字比對。

預期持平或變好（安全層在高空少接管一次，AI 就少被推去爬一次）。
**若惡化，停下來查**，不要因為「主判準綠了」就放過。

- [ ] **Step 4: 全套回歸**

```
npx vitest run
npx tsc --noEmit
```

`rematch.test.ts` 與效能門檻那兩支照專案慣例**單獨跑**：

```
npx vitest run test/integration/rematch.test.ts
```

- [ ] **Step 5: 回填 spec**

在 `docs/superpowers/specs/2026-08-09-recovery-altitude-degeneracy-design.md`
末尾新增：

```markdown
## 13. 實測結果（2026-08-09 回填）

### 13.1 主判準

| 護欄 | 修改前 | 修改後 |
|---|---|---|
| `ai-command-channel` / `groundUnderOrder` | （填入實測值） | （填入實測值） |
| `ai-command-tactics` / 側翼 | （填入） | （填入） |
| `ai-command-tactics` / 集火 | （填入） | （填入） |

### 13.2 副判準（`ai-withdraw-anchor`）

| 量 | 本次修改前 | 本次修改後 |
|---|---|---|
| r60 → r300（藍） | （填入） | （填入） |
| r60 → r300（紅） | （填入） | （填入） |
| maxRadius | （填入） | （填入） |
| 總傷害 | （填入） | （填入） |
| 撤退佔用率 | （填入） | （填入） |

### 13.3 迴歸

（填入：全套 vitest 的通過數 / 失敗數、`npx tsc --noEmit` 結果、安全矩陣
288 組的結果。）

### 13.4 Mutation 驗證

（填入 Task 1 Step 8 三個 mutation 各自打紅了哪一條。）
```

**把括號裡的字換成實際量到的數字。** 若某一格沒有「修改前」的數字，就跑
`git stash` 前的版本量一次，或註明「未量測」而不是留空。

- [ ] **Step 6: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
docs: 回填拉起高度退化的實測結果（主判準、副判準、迴歸、mutation）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add docs/superpowers/specs/2026-08-09-recovery-altitude-degeneracy-design.md
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

## 驗收（Playwright / 人工試飛）

本次改動**沒有可見的畫面變化**，Playwright 沒有新的斷言可加。改動的可觀察
後果是「AI 在高空失速時會壓頭改出，而不是抬頭爬升」——那是模擬層的行為，
已由 Task 1 Step 3 的兩條行為測試與 Task 2 的四份整合護欄涵蓋。

人工試飛的觀察點（專案負責人自行決定要不要做）：高空纏鬥拉到近失速時，
敵機不再出現「機頭抬起卻掉高度」的怪異姿態。

## 不做的事

- **不改「拉不動時撞地分支該下什麼命令」。** 150 m、`nMax = 0.468` 的飛機被
  命令爬升，物理上兌現不了多少 —— 但那是 spec `2026-08-05-ai-combat-fixes-design.md`
  §4.5 已裁定的政策，改它要另開一份 spec。
- **不處理 `ai-command-channel` 的撤退佔用率 2.81% < 5%。** 那是撤退令棘輪
  那份 spec 留下的獨立待決項。
- **不掃 `factor` / `clearance` / `lookahead` / `stallMargin`。** 本次沒有引入
  新的自由參數。
- **不動 `recoveryAltitude` 的簽名。**
- **不動 `test/integration/ai-safety-matrix.test.ts`。** 它是「沒有動到既有
  行為」的證據。
