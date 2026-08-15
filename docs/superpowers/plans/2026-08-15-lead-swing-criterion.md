# 預瞄點偏移判準 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「玩家看得出 AI 在閃」變成可以定值、可以回歸的量 —— `defendMedian`(玩家握有射擊解時,預瞄點在他視角 1 秒內的淨角位移)—— 並補上唯一缺的幾何(正上方 / 正下方)。

**Architecture:** 不發明新量測。`test/integration/ai-visible-evasion.test.ts` 已經有 `Result.defendMedian`、`underFireGate`、`straightMedian`,窗長恰好 1 秒。本計畫只做四件事:加兩個 aspect、加 800 m、把 `defendMedian` 由觀測值升成判準、換掉一條與被測功能耦合的場景閘門。

**Tech Stack:** TypeScript、vitest。無新相依,不新增檔案。

**Spec:** `docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md`

## Global Constraints

- **不動任何出貨參數。** 本輪只建立量測與定值。`defendTilt` 要不要改是下一輪。
- **不改 `ai-defence` 的門檻。** 護欄重新定值是專案負責人的決定。
- **不重寫 `measure()` 的算法。** 只加 aspect 與欄位;既有四條判準(`shootableShare`、`contrast`、`straightness`、`coverage`)的算式一個字不動 —— 否則所有既有基準作廢。
- **不抽共用模組。** `measure` 連同依賴約 490 行,抽出的風險遠大於收益(2026-08-15 已評估)。
- **恆等基準(2026-08-15 實測,`defendTilt = 20°`)。** Task 1 之後這四個數必須逐位元不變:

  | standoff | `shootableShare` | `contrast` | `coverage` | `straightness` |
  |---|---|---|---|---|
  | 700 | 0.0623 | 13.69 | 0.965 | 0.995 |
  | 900 | 0.0543 | 15.88 | 0.984 | 0.995 |

- **門檻一律由實測回填,不預設。** 2026-08-05 的「位移 ≥ 5°」就是猜出來的,結果它連「完全不閃」都快通過。

---

### Task 1: 兩個新 aspect、`inRangeCount`、逐列輸出

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: 既有的 `Aspect`、`measure`、`scripted`、`Result`、`inRange`
- Produces:
  - `Aspect` 多兩個成員 `'high' | 'low'`
  - `Result.inRangeCount: number`
  - `scripted(mode, standoff, seconds, aspect)` —— 第四個參數,預設 `'tail'`
  - 每一列印出完整的 `Result`

- [ ] **Step 1: 擴充 `Aspect` 與射手擺位**

把 `type Aspect = 'tail' | 'beam'` 改成:

```ts
/**
 * 射手的起始方位。
 *
 * `tail` = 正後方尾追;`beam` = 正側方橫越、機首指向受測 AI;
 * `high` / `low` = 正上方 / 正下方,機首指向受測 AI。
 *
 * 【為什麼需要 beam】撞地的兩場之一是 800 m 橫越（另一場是 1000 m 尾追）。
 * 只有尾追的話量不到那個場景。
 *
 * 【為什麼需要 high / low，2026-08-15】專案負責人指定的三個場景之一是
 * 「敵人在我下方或上方」。而且 `defendAim` 在**視線接近鉛直**時會走一條
 * 完全沒有用到 `defendTilt` 的退化路徑（見 `steer.ts` 的註解），那條路徑
 * 目前零測試覆蓋 —— 這兩個 aspect 正好把它逼出來。
 *
 * 【為什麼是純垂直而不是斜的】斜的落在 `tail` 與 `high` 之間，量到的是
 * 兩者的混合；純垂直是這三個方向裡唯一還沒被覆蓋的**極端**。
 */
type Aspect = 'tail' | 'beam' | 'high' | 'low'

/**
 * 射手相對受測 AI 的起始位移。
 *
 * 【`low` 為什麼不會碰到地板】受測 AI 在 `ALT`（4000 m），射手在 3200 m，
 * 兩者都遠高於離地底限的 `clearanceScale`（500 m）—— 量到的是純幾何，
 * 不含地板干擾。
 */
function hunterOffset(aspect: Aspect, standoff: number, out: Vector3): Vector3 {
  if (aspect === 'tail') return out.set(0, 0, standoff)
  if (aspect === 'beam') return out.set(standoff, 0, 0)
  return out.set(0, aspect === 'high' ? standoff : -standoff, 0)
}
```

在 `measure` 裡把

```ts
  const hunterPos = aspect === 'tail'
    ? new Vector3(0, ALT, standoff)
    : new Vector3(standoff, ALT, 0)
```

改成

```ts
  const hunterPos = hunterOffset(aspect, standoff, new Vector3()).add(preyPos)
```

再把機首方向那一行的條件由「只有 beam」放寬到「只要不是 tail」:

```ts
    // 【非尾追的射手機首指向受測 AI】否則它要先繞一大圈才進得了場。
    // 尾追本來就已經對著它，維持 FWD 以保逐位元不變。
    const look = a === hunter && aspect !== 'tail'
      ? new Vector3().subVectors(preyPos, hunterPos).normalize()
      : FWD.clone()
```

**`tail` 走的仍然是 `FWD.clone()` 那一支,逐位元不變。**

- [ ] **Step 2: `scripted` 也吃 aspect**

`contrast = defendMedian / straightMedian`,而 `straightMedian` 來自 `scripted('none', standoff)`。**基準線的幾何必須與被比的那一場相同**,否則 `high` 的對比會拿尾追的基準線去除,數字沒有意義。

把簽名改成:

```ts
function scripted(
  mode: BreakMode, standoff = 800, seconds = 90, aspect: Aspect = 'tail',
): ScriptResult {
```

擺位改成:

```ts
  const hunterPos = hunterOffset(aspect, standoff, new Vector3()).add(preyPos)
```

並在 `measure` 的結尾把 aspect 傳下去:

```ts
  const straightMedian = scripted('none', standoff, 90, aspect).swingMedian
```

**`aspect` 預設 `'tail'`,其餘呼叫端一個字不改,逐位元不變。**

- [ ] **Step 3: `Result` 加 `inRangeCount`**

在 `interface Result` 裡,`underFire` **之後**插入:

```ts
  /**
   * 射手在有效射程內的取樣格數。**不含**「他有沒有射擊解」。
   *
   * 【它取代 `underFire` 當場景有效性閘門】`underFire` 與被測的功能耦合
   * ——「閃得越好它越紅」（見它自己的註解）。實測已經撞到兩次：2026-08-07
   * 由 500 下修到 300；2026-08-15 的 `defendTilt = 0` 量到 278，而那一輪的
   * 閃躲其實**更好**（`shootableShare` 6.23% → 1.28%）。而它是第一條斷言，
   * 一紅就讓下游四條真正的判準一條都跑不到。
   *
   * `inRange` 只看距離，由腳本射手的追擊行為決定，與受測 AI 的閃躲品質
   * 解耦 —— 它問的正是「射手有沒有把飛機擺在該擺的位置」。
   */
  inRangeCount: number
```

在取樣迴圈裡,把

```ts
    if (inRange(hunter, prey) && sniper.aimError < HIT_CONE) hits++
```

改成

```ts
    const near = inRange(hunter, prey)
    if (near) inRangeCount++
    if (near && sniper.aimError < HIT_CONE) hits++
```

並在函數開頭與 `underFire` 一起宣告 `let inRangeCount = 0`,回傳物件裡加 `inRangeCount`。

**`hits` 的算法逐字不變** —— `near` 只是把同一個呼叫存成區域變數。

- [ ] **Step 4: 每一列印出完整結果**

在 `describe` 的 `it` 裡、`const r = measure(...)` **之後**加入:

```ts
      // 【為什麼常駐輸出】門檻要由實測回填，而綠燈不會告訴你數字。
      // 本專案 2026-08-14 的教訓：「移動但未破門檻」這條紀律沒有數字就
      // 執行不了（見 `defend-energy` 那一輪的 spec §7.5）。
      console.log(
        `[閃躲] ${aspect} ${standoff}m`
        + ` defendMedian=${r.defendMedian.toFixed(2)}°`
        + ` straightMedian=${r.straightMedian.toFixed(2)}°`
        + ` ordinaryMedian=${r.ordinaryMedian.toFixed(2)}°`
        + ` contrast=${r.contrast.toFixed(2)}`
        + ` shootable=${(r.shootableShare * 100).toFixed(2)}%`
        + ` coverage=${(r.coverage * 100).toFixed(1)}%`
        + ` straightness=${r.straightness.toFixed(3)}`
        + ` underFire=${r.underFire} inRange=${r.inRangeCount}`,
      )
```

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 6: 確認逐位元恆等**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 全綠,且印出的 700 / 900 兩列必須與 Global Constraints 那張表**完全相同**:

```
[閃躲] tail 700m ... contrast=13.69 shootable=6.23% coverage=96.5% straightness=0.995
[閃躲] tail 900m ... contrast=15.88 shootable=5.43% coverage=98.4% straightness=0.995
```

**任何一個數字不同 = 這一步不是純新增,停下來查,不要往下做。**

- [ ] **Step 7: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 閃躲量測加上／下方兩個 aspect 與 inRangeCount（純新增，逐位元恆等）"
```

---

### Task 2: 掃描 —— 四個 aspect × 三個距離

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`(把 `it` 的迴圈擴成兩維)

**Interfaces:**
- Consumes: Task 1 的 aspect 與輸出
- Produces: 12 列實測,決定兩個門檻的定值

- [ ] **Step 1: 把迴圈擴成兩維**

把

```ts
  for (const standoff of [700, 900]) {
    it(`射手在 ${standoff} m 連續射擊時，AI 的閃躲看得出來`, () => {
      const r = measure(standoff)
```

改成

```ts
  // 【800 是專案負責人 2026-08-15 指定的距離；700 / 900 保留】後兩者是
  // 2026-08-07 以來的既有基準，砍掉會失去回歸的對照。
  for (const aspect of ['tail', 'beam', 'high', 'low'] as const) {
    for (const standoff of [700, 800, 900]) {
      it(`${aspect} ${standoff} m 連續射擊時，AI 的閃躲看得出來`, () => {
        const r = measure(standoff, aspect)
```

(對應的括號與縮排一併調整;`it` 的 timeout `5 * 60 * 1000` 保留。)

- [ ] **Step 2: 跑,收表**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`

Expected: 12 列 `[閃躲]` 輸出。**部分會紅** —— `underFire > 300` 這條在垂直與 800 m 的新場景很可能不成立,那正是 Task 3 要換掉的東西。把 12 列抄下來。

- [ ] **Step 3: 判讀**

三件事要看:

1. **場景成不成立** —— `inRange` 是不是遠大於 0。若某個 aspect 幾乎是 0,代表射手根本追不上,那要調整射手腳本(spec §5 風險二),**不是降門檻**。
2. **`defendMedian` 與 `straightMedian` 的差距** —— 後者應該在 0.7~0.9°。若某個 aspect 的 `defendMedian` 接近它,代表那個幾何下 AI 幾乎沒在閃。
3. **`ordinaryMedian`** —— 這是 2026-08-05 舊判準壞掉的那個 6~11°。它必須明顯低於 `defendMedian`,否則「絕對度數」這個判準在這個幾何下沒有鑑別力。

- [ ] **Step 4: Commit(只提交迴圈改動,門檻還沒動)**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 閃躲量測擴成四個 aspect × 三個距離"
```

---

### Task 3: 換掉與被測功能耦合的場景閘門

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: Task 2 的 12 列 `inRange` 數字
- Produces: `IN_RANGE_FLOOR` 常數

- [ ] **Step 1: 定 `IN_RANGE_FLOOR`**

取 12 列裡 `inRange` 的**最小值**,再乘 0.5 取整到百位。

【為什麼是最小值的一半而不是某個絕對數】這條閘門要擋的是「場景根本沒成立」,不是「場景不夠激烈」。定在現況最差的那一場的一半,代表**要比目前最差的情況再壞一倍**才會擋 —— 那才是真的沒成立。

在 `SHOOTABLE_LIMIT` 附近新增:

```ts
/**
 * 場景有效性的地板：射手在有效射程內的取樣格數。
 *
 * 【為什麼不用 `underFire`】那個量與被測的功能耦合 ——「閃得越好它越紅」。
 * 它已經因為同一個理由由 500 下修到 300（2026-08-07）；2026-08-15 的
 * `defendTilt = 0` 又量到 278，而那一輪的閃躲其實**更好**
 * （`shootableShare` 6.23% → 1.28%）。而它是第一條斷言，一紅就讓下游
 * 四條真正的判準一條都跑不到。
 *
 * 【定值】取 2026-08-15 十二場實測裡 `inRange` 的最小值的一半 —— 要比
 * 目前最差的那一場再壞一倍才擋得住。掃描表見 spec §7。
 */
const IN_RANGE_FLOOR = <實測回填>
```

- [ ] **Step 2: 換掉那條斷言**

把

```ts
      expect(r.underFire).toBeGreaterThan(300)
```

改成

```ts
      // 【場景成立 = 射手有沒有把飛機擺在該擺的位置】與受測 AI 的閃躲
      // 品質解耦。`underFire` 降級成觀測值，繼續印，不再擋。
      expect(r.inRangeCount).toBeGreaterThan(IN_RANGE_FLOOR)
```

- [ ] **Step 3: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 12 列全綠(或只剩 `defendMedian` 相關的問題,那是 Task 4)。

**若某一列仍然紅在 `inRangeCount`,不要降門檻** —— 那代表那個場景真的沒成立,回 Task 2 Step 3 調射手腳本。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 場景有效性閘門改用 inRangeCount —— 與被測功能解耦"
```

---

### Task 4: `defendMedian` 升成判準

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: Task 2 的 12 列 `defendMedian` 與 `straightMedian`
- Produces: `LEAD_SWING_FLOOR` 常數與一條新斷言

- [ ] **Step 1: 定 `LEAD_SWING_FLOOR`,交專案負責人**

**這一個數字不由實作者決定。** 把 Task 2 的表(含 `defendMedian` / `straightMedian` / `ordinaryMedian` 三欄並排)交專案負責人,由他定值。

建議的起點:12 列 `defendMedian` 的**最小值的 0.8 倍**,並且必須**明顯大於同列的 `ordinaryMedian`** —— 若不成立,代表那個幾何下這個判準沒有鑑別力,那件事本身要先回報。

- [ ] **Step 2: 加常數與斷言**

```ts
/**
 * 預瞄點偏移的地板：`defend` 期間、1 秒窗的預瞄方向淨角位移中位數，度。
 *
 * **這就是「玩家看得出 AI 在閃」的直接判準** —— 預瞄點在玩家視角裡動了
 * 多少度，正是他手上必須修正的量（專案負責人 2026-08-15 裁定）。
 *
 * 【為什麼絕對度數這次可以用】2026-08-05 有一條「位移 ≥ 5°」被否決，因為
 * 它量**整場**的絕對位移，而 AI 平常追擊就有 6~11°（見 `ordinaryMedian`）。
 * 這一個只在 `defend` 期間、而且只在射手真的握有射擊解時取樣 —— 分母不同，
 * 舊的坑不會重演。
 *
 * 【讀這個數字一定要並排看 `straightMedian`】完全不閃的基準線是 0.7~0.9°。
 * 少了它，下一個人會重蹈 2026-08-05 的覆轍。
 *
 * 【定值】專案負責人依 2026-08-15 的十二場掃描裁定。表見 spec §7。
 */
const LEAD_SWING_FLOOR = <負責人裁定>
```

在既有的可見度斷言**之前**插入:

```ts
      // ── 二之零：預瞄點偏移（主判準）────────────────────
      expect(r.defendMedian).toBeGreaterThan(LEAD_SWING_FLOOR)
      // 【對照，不是門檻】沒有它，絕對度數會重演 2026-08-05 的錯誤
      expect(r.straightMedian).toBeLessThan(2)
```

- [ ] **Step 3: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 12 列全綠。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 預瞄點偏移升成判準 —— 玩家看得出 AI 在閃"
```

---

### Task 5: 全套回歸與回填

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md`(補「實作結果」)

- [ ] **Step 1: 全套**

Run: `npx vitest run`
Expected: 與基準相同的 4 條紅(`ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑)。`perf-gate` 在全套並行下假紅,單獨跑會綠。

**多出任何一條紅 = 本輪動到了不該動的東西。** 本輪只改一個測試檔、不動任何出貨程式碼,所以理論上不可能 —— 真的發生就停下來查。

- [ ] **Step 2: 單獨跑計時測試**

Run: `npx vitest run test/unit/perf-gate.test.ts`

- [ ] **Step 3: 寫「實作結果」一節**

在 spec 末尾追加:

- 12 列掃描表(`defendMedian` / `straightMedian` / `ordinaryMedian` / `contrast` / `shootable` / `coverage` / `straightness` / `underFire` / `inRange`)
- 兩個門檻的定值與理由
- **`high` / `low` 的 `defendMedian` 與水平場景的比較** —— spec §5 風險三預期它們會比較差(鉛直退化路徑沒有抬角)。若成立,那是一個**新的待辦**:要不要補那條路徑,交專案負責人。
- 執行時間的變化(12 場 vs 原本 2 場),以及是否需要調整 `it` 的 timeout

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md
git commit -m "docs: 預瞄點偏移判準的實作結果與十二場掃描表"
```

- [ ] **Step 5: 交專案負責人**

回報:12 列的表、兩個門檻的定值、`high` / `low` 是不是真的比較差(以及那代表 `defendAim` 的鉛直退化路徑要不要補)、全套紅燈清單、以及下一輪的入口(`defendTilt` 要不要由 20° 調低 —— 現在有了正確的判準才談得上)。
