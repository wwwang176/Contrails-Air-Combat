# 預瞄點偏移判準 Implementation Plan(第二版)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個**排除得掉射手機動與正常追擊**的「玩家看得出 AI 在閃」量測 —— 配對消融的效果量 —— 並讓四個方位場景真的成立。

**Architecture:** 只動 `test/integration/ai-visible-evasion.test.ts`。不新增檔案、不動任何出貨程式碼。三件事:配對消融(`threatEnter` 開/關)、垂直射手的初速改成同向並飛、逐格方位閘門。

**Tech Stack:** TypeScript、vitest。無新相依。

**Spec:** `docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md`(2026-08-15 審查後改版)

## 這一版與第一版的差異

第一版被 Codex 審查推翻了兩處設計。**兩處都是「量到的不是要量的東西」**,不是實作細節:

| 第一版 | 為什麼錯 | 這一版 |
|---|---|---|
| `defendMedian` 直接當主判準 | 射手機動與 AI 追誘餌的大彎都灌進去 —— `ordinaryMedian` 6~11° 就是證據 | **配對消融的差值**(§Task 2) |
| `high`/`low` 只改起始座標 | `Sniper` 是純追擊,2.5 秒就收斂;`Swing` 要滿 1 秒才 ready,取樣開始時幾何已消失 | **同向並飛的初速 + 逐格方位閘門**(§Task 1) |
| `inRangeCount` 當場景閘門 | 閃得好 → AI 跑出 `THREAT_RANGE` → 計數反而下降,仍然耦合 | **方位閘門的取樣數**(§Task 1) |
| 門檻 = 現況最小值 × 0.5 / 0.8 | 照著現況畫靶,現況必然通過 | **由專案負責人依需求裁定**(§Task 4) |

## Global Constraints

- **不動任何出貨參數與任何 `src/` 檔案。** 本輪只改一個測試檔。
- **不改 `ai-defence` 的門檻。** 護欄重新定值是專案負責人的決定。
- **不重寫 `measure()` 的既有算法。** `shootableShare`、`contrast`、`straightness`、`coverage` 一個字不動 —— 否則所有既有基準作廢。
- **恆等的精確範圍:**
  - **`tail` 的每一個既有欄位逐位元不變。** 那是既有兩條可見度測試唯一用到的 aspect。
  - **`beam` 的 `straightMedian` / `contrast` 會改變**(Task 1 把 aspect 傳給 `scripted`,基準線由「尾追直飛」換成「橫越直飛」)。**那是刻意的修正**,而且 `beam` 目前只出現在六場護欄(741 行),那裡只讀 `safetyShare` 與 `aiAlive` —— `scripted` 開的是獨立 `World`、又排在取樣迴圈之後,碰不到那兩個值。**實作時必須確認這一點仍然成立。**
- **「逐位元」的驗證方式要名副其實**(第一版被審查點名 I4):不得只比 `toFixed` 的四個欄位。做法見 Task 1 Step 6。
- **門檻一律由專案負責人裁定,不由現況推導。** 2026-08-05 的「位移 ≥ 5°」是猜的,結果它連「完全不閃」都快通過;第一版的「現況最小值 × 0.8」是照著現況畫靶,同一類錯誤的另一面。

---

### Task 1: 方位閘門、四個 aspect、同向並飛的垂直射手

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Produces:
  - `Aspect` 多兩個成員 `'high' | 'low'`
  - `hunterOffset(aspect, standoff, out): Vector3` —— 射手相對受測 AI 的起始位移
  - `hunterLook(aspect, preyPos, hunterPos, out): Vector3` —— 射手的起始機首/速度方向
  - `aspectHolds(aspect, hunter, prey): boolean` —— **逐格**的方位閘門
  - `Result.aspectSamples: number`
  - `scripted(mode, standoff, seconds, aspect)` —— 第四個參數,預設 `'tail'`

- [ ] **Step 1: 先存下 `tail` 的完整基準**

**在改任何一行之前**,把現況的 `Result` 完整存下來 —— 這是 Task 1 Step 6 唯一有效的恆等證據。

在 `it` 內、`const r = measure(standoff)` 之後暫時插入:

```ts
      console.log(`[基準] ${standoff} ${JSON.stringify(r)}`)
```

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "連續射擊"`

把兩列 JSON **原封不動**貼進一個暫存檔(`/tmp` 或 scratchpad),它含 `Result` 的**全部**欄位、全精度。跑完把這一行**移除**。

【為什麼不能用 `toFixed` 的四個欄位】那會讓「底層變了但四捨五入後相同」的改動矇混過關。

- [ ] **Step 2: 擴充 `Aspect` 與兩個擺位輔助函數**

把 `type Aspect = 'tail' | 'beam'` 那一段(304~309 行)換成:

```ts
/**
 * 射手的起始方位。
 *
 * `tail` = 正後方尾追;`beam` = 正側方橫越;`high` / `low` = 正上方 / 正下方。
 *
 * 【為什麼需要 beam】撞地的兩場之一是 800 m 橫越（另一場是 1000 m 尾追）。
 * 只有尾追的話量不到那個場景。
 *
 * 【為什麼需要 high / low，2026-08-15】專案負責人指定的三個場景之一是
 * 「敵人在我下方或上方」。而且 `defendAim` 在**視線接近鉛直**時會走一條
 * 完全沒有用到 `defendTilt` 的退化路徑（見 `steer.ts` 的註解），那條路徑
 * 目前零測試覆蓋。
 *
 * 【起始方位不等於量測期間的方位】`Sniper` 是**純追擊**腳本，而
 * `Command.aimWorld` 在這個框架裡同時是飛行方向 —— 任何起始方位最後都會
 * 收斂成尾追。所以除了擺位之外還需要 `aspectHolds` 這道**逐格**閘門，
 * 只有視線真的還在該方位帶內的取樣才算數。詳見 spec §3.2。
 */
type Aspect = 'tail' | 'beam' | 'high' | 'low'

/**
 * 射手相對受測 AI 的起始位移。
 *
 * 【`low` 為什麼不會碰到地板】受測 AI 在 `ALT`（4000 m），射手在 3200 m，
 * 兩者都遠高於離地底限的 `clearanceScale`（500 m）。
 */
function hunterOffset(aspect: Aspect, standoff: number, out: Vector3): Vector3 {
  if (aspect === 'tail') return out.set(0, 0, standoff)
  if (aspect === 'beam') return out.set(standoff, 0, 0)
  return out.set(0, aspect === 'high' ? standoff : -standoff, 0)
}

/**
 * 射手的起始機首與速度方向。
 *
 * 【垂直的兩個為什麼是同向並飛而不是對著目標】對著目標的話它會以 200 m/s
 * 直直俯衝，800 m 的垂直間距**2.5 秒**就跌破 `inRange` 的 300 m 下限，而
 * `Swing` 要滿 1 秒才 `ready` —— 正式取樣開始時垂直幾何早就不存在了
 * （spec §3.2）。同向並飛是「高位待機」，它仍然會被 `leadPoint` 拉成俯衝，
 * 但過程由 2.5 秒的直線對撞變成十幾秒的漸進俯衝，取樣窗才有東西可量。
 *
 * 【`tail` 維持 `FWD` 是為了逐位元恆等】它本來就已經對著目標。
 */
function hunterLook(
  aspect: Aspect, preyPos: Vector3, hunterPos: Vector3, out: Vector3,
): Vector3 {
  if (aspect === 'tail' || aspect === 'high' || aspect === 'low') return out.copy(FWD)
  return out.subVectors(preyPos, hunterPos).normalize()
}
```

- [ ] **Step 3: `measure` 與 `scripted` 共用同一段擺位**

**第一版被審查點名 C2:** `scripted` 只改位置、沒同步機首與速度,基準線的幾何會與被比的那一場對不上。兩邊必須走同一段程式。

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

並把迴圈裡的 `look` 改成

```ts
    const look = a === hunter
      ? hunterLook(aspect, preyPos, hunterPos, new Vector3())
      : FWD.clone()
```

`scripted` 的簽名與擺位同步改:

```ts
function scripted(
  mode: BreakMode, standoff = 800, seconds = 90, aspect: Aspect = 'tail',
): ScriptResult {
```

```ts
  const hunterPos = hunterOffset(aspect, standoff, new Vector3()).add(preyPos)
```

```ts
  for (const [a, p] of [[prey, preyPos], [hunter, hunterPos]] as const) {
    a.state.position.copy(p)
    const look = a === hunter
      ? hunterLook(aspect, preyPos, hunterPos, new Vector3())
      : FWD.clone()
    a.state.velocity.copy(look).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, look)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
```

在 `measure` 結尾把 aspect 傳下去:

```ts
  const straightMedian = scripted('none', standoff, 90, aspect).swingMedian
```

【`tail` 為什麼仍然逐位元不變】`hunterOffset('tail', s)` 給 `(0,0,s)`,加上 `preyPos = (0,ALT,0)` 三個分量都是精確加法;`hunterLook('tail', …)` 回 `FWD` 的複本。與舊碼逐值相同。

- [ ] **Step 4: 逐格方位閘門**

在 `underFireGate` 之後新增:

```ts
/** 該 aspect 的方位帶,rad */
const ASPECT_CONE = 45 * DEG
/** 垂直方位帶的仰／俯角下限,rad */
const VERTICAL_CONE = 30 * DEG

/**
 * **逐格**判斷「射手現在還在不在這個方位」。
 *
 * 【為什麼需要它】起始方位不等於量測期間的方位：`Sniper` 是純追擊腳本，
 * 任何起始方位最後都會收斂成尾追（spec §3.2）。少了這道閘門，`high` 的
 * 統計裡混的其實幾乎全是尾追的取樣。
 *
 * 【它同時是場景有效性的判準】它只描述兩機的相對幾何，不含「射手有沒有
 * 射擊解」也不含距離上界 —— 與 AI 的閃躲品質真正解耦。第一版打算用的
 * `inRangeCount` 做不到這件事：`inRange` 要求距離 < `THREAT_RANGE`，而閃得
 * 好的 AI 會跑出去，計數反而下降（審查 I1）。
 *
 * 【角度是起始值，待實測回填】45° / 30° 沒有實測依據。第一輪把
 * `aspectSamples` 當**觀測值**印出來，看四個 aspect 各累積多少秒，再決定
 * 要不要調（spec §5 風險三）。
 */
function aspectHolds(aspect: Aspect, hunter: Aircraft, prey: Aircraft): boolean {
  const los = new Vector3().subVectors(prey.state.position, hunter.state.position)
  const len = los.length()
  if (len < 1e-6) return false
  los.divideScalar(len)
  if (aspect === 'high') return -los.y >= Math.sin(VERTICAL_CONE)
  if (aspect === 'low') return los.y >= Math.sin(VERTICAL_CONE)
  // 水平兩個看的是「射手在受測 AI 的哪個鐘面」：視線反向 vs AI 的速度方向
  const v = prey.state.velocity
  const vl = v.length()
  if (vl < 1e-6) return false
  const cos = -los.dot(v) / vl
  return aspect === 'tail' ? cos >= Math.cos(ASPECT_CONE) : cos < Math.cos(ASPECT_CONE)
}
```

**注意:** 這個函數每格配置三個 `Vector3`。取樣是每 12 格一次、180 秒 = 3600 次,不在熱路徑,可接受;但若 `tsc` 或既有的效能護欄抱怨,改成模組層的暫存向量。

- [ ] **Step 5: `Result` 加 `aspectSamples`,取樣迴圈接上閘門**

`interface Result` 加:

```ts
  /**
   * 方位閘門成立的取樣格數 —— **場景有效性的判準**。
   *
   * 除以每秒取樣數（240 ÷ 12 = 20）就是「這個方位維持了幾秒」。
   */
  aspectSamples: number
```

取樣迴圈裡,把

```ts
    if (underFireGate(hunter, prey)) {
```

改成

```ts
    const holds = aspectHolds(aspect, hunter, prey)
    if (holds) aspectSamples++
    if (holds && underFireGate(hunter, prey)) {
```

並宣告 `let aspectSamples = 0`、回傳物件加上它。

【`tail` 會不會因此改變】會 —— `tail` 的取樣現在多了一道 `cos >= cos(45°)` 的條件。**這一步會破壞 Task 1 的恆等基準,所以它必須排在 Step 6 的驗證之後。**

**因此 Step 5 的正確順序是:先做 Step 3(擺位),跑 Step 6 驗恆等,通過之後才做 Step 4 與 Step 5。** 實作者請照這個順序。

- [ ] **Step 6: 驗證 `tail` 逐位元恆等(在 Step 4/5 之前)**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "連續射擊"`

把印出的兩列 JSON 與 Step 1 存下來的**逐字比對**(`diff`)。

Expected: **完全相同,一個字元都不差。**

**任何差異 = 擺位的重構不是純搬家,停下來查。**

- [ ] **Step 7: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 8: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 閃躲量測加 high/low aspect 與逐格方位閘門（tail 逐位元恆等）"
```

---

### Task 2: 配對消融 —— 把「射手機動 + 正常追擊」的貢獻扣掉

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_RULES.threatEnter`(既有,`src/ai/rules.ts`)
- Produces: `Result.swingUnderFire`、`ablate(standoff, aspect): { on, off }`

- [ ] **Step 1: `Result` 加一個不分意圖的欄位**

現有的 `defendMedian` / `ordinaryMedian` 依 `intent` 分組。消融的 off 那一組**永遠不會有 `defend`**,所以兩組沒得比 —— 需要一個不分意圖、同一個閘門下的量:

```ts
  /**
   * `underFireGate` 且 `aspectHolds` 成立的取樣裡，1 秒窗預瞄方向淨角位移
   * 的中位數，度。**不依 `intent` 分組。**
   *
   * 【為什麼需要它】配對消融的 off 那一組把 `defend` 整個關掉了，
   * `defendMedian` 在那一組是 NaN。要比就得用同一個閘門下的全部取樣。
   */
  swingUnderFire: number
```

在取樣迴圈的 `if (holds && underFireGate(...))` 區塊裡,無條件 `underFireSwings.push(swing.net)`,回傳 `swingUnderFire: median(underFireSwings)`。

- [ ] **Step 2: 寫消融函數**

```ts
/**
 * 配對消融：同一個場景跑兩次，唯一差別是**閃躲關掉、正常追擊保留**。
 *
 * 【為什麼主判準一定要是差值】`swingUnderFire` 量的是「從移動中的射手看向
 * 移動中的預瞄點」，貢獻它的有三件事：射手自己的轉彎、AI 追誘餌的正常大彎、
 * 以及真正的閃躲。同一份檔案記著 `ordinaryMedian` 有 6~11°，而完全不閃的
 * 地板只有 0.7~0.9° —— **非閃躲的機動足以撐起絕大部分的絕對數字**。一個
 * 只把 `intent` 切成 `defend`、實際仍沿原軌跡飛的 AI 也會拿到很高的分數。
 * 只有配對消融的差值排除得掉它（spec §3.1，2026-08-15 Codex 審查 C4）。
 *
 * 【`threatEnter = 2` 為什麼等於關掉閃躲】威脅值的上界是 1，而 `rules.ts`
 * 的 `s.defendLatch = latch(s.defendLatch, threat, cfg.threatEnter, ...)` 是
 * `defend` 意圖的唯一入口。調到 2 之後閂鎖永遠不成立，AI 就當作沒發現有人
 * 在打它，繼續追誘餌 —— 正是要的反事實。
 */
function ablate(standoff: number, aspect: Aspect): { on: Result, off: Result } {
  const on = measure(standoff, aspect)
  const saved = DEFAULT_RULES.threatEnter
  DEFAULT_RULES.threatEnter = 2
  try {
    return { on, off: measure(standoff, aspect) }
  } finally {
    DEFAULT_RULES.threatEnter = saved
  }
}
```

需要在檔頭加 `import { DEFAULT_RULES } from '../../src/ai/rules'`。

- [ ] **Step 3: 驗證消融真的關掉了 `defend`**

**spec §5 風險二明寫這一條不能靠推論。** `Result` 已經有 `coverage`(`defend` 佔 under-fire 取樣的比例)。off 那一組的 `coverage` 必須是 **0**:

```ts
      expect(r.off.coverage).toBe(0)
```

若不是 0,代表 `threatEnter` 不是唯一入口 —— **停下來查,不要繼續**。

- [ ] **Step 4: 掃描 —— 四個 aspect × 800 m**

把 800 m 那一組寫成新的 `describe`(700 / 900 的既有兩條**不動**):

```ts
describe('預瞄點偏移：配對消融（三機、腳本射手、180 秒 × 2）', () => {
  for (const aspect of ['tail', 'beam', 'high', 'low'] as const) {
    it(`${aspect} 800 m：閃躲讓預瞄點多動了多少`, () => {
      const { on, off } = ablate(800, aspect)
      console.log(
        `[消融] ${aspect} 800m`
        + ` swingOn=${on.swingUnderFire.toFixed(2)}°`
        + ` swingOff=${off.swingUnderFire.toFixed(2)}°`
        + ` 效果量=${(on.swingUnderFire - off.swingUnderFire).toFixed(2)}°`
        + ` straight=${on.straightMedian.toFixed(2)}°`
        + ` aspectSamples=${on.aspectSamples}（${(on.aspectSamples / 20).toFixed(1)}s）`
        + ` shootable=${(on.shootableShare * 100).toFixed(2)}%`
        + ` coverage=${(on.coverage * 100).toFixed(1)}%`,
      )
      expect(off.coverage).toBe(0)
    }, 10 * 60 * 1000)
  }
})
```

**這一輪只有 `off.coverage === 0` 這一條斷言。** 其餘全是輸出 —— 門檻是 Task 4 的事,而且由專案負責人定。

- [ ] **Step 5: 跑,收表**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "配對消融"`
Expected: 四列 `[消融]`。把表抄下來。

- [ ] **Step 6: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 預瞄點偏移的配對消融 —— 扣掉射手機動與正常追擊的貢獻"
```

---

### Task 3: 判讀,交專案負責人

**Files:** 無(這是一個判讀與回報的任務)

- [ ] **Step 1: 四件事逐一判讀**

1. **`aspectSamples` 夠不夠。** 除以 20 是秒數。若 `high` / `low` 只有兩三秒 —— **那是「這個框架量不到那個場景」的證據,回報,不要調參數硬湊**(spec §5 風險四)。
2. **效果量佔絕對值的比重。** `(on − off) / on`。若某個 aspect 的效果量接近 0,代表那個幾何下閃躲**幾乎沒有貢獻**,絕對數字全部來自射手機動與正常追擊 —— 那個 aspect 的絕對度數判準沒有鑑別力。
3. **`swingOff` 與 `straightMedian` 的距離。** 前者是「三機、正常追擊、不閃」,後者是「兩機、直飛」。兩者的差就是 AI 追誘餌那個大彎的貢獻。
4. **`shootableShare` / `coverage`** 有沒有比現況(700 m 6.23% / 96.5%、900 m 5.43% / 98.4%)惡化。

- [ ] **Step 2: 交專案負責人裁定兩個門檻**

把表交出去,附上上面四點的判讀。要裁定的是:

- **效果量的下限**(主判準)
- **`aspectSamples` 的下限**(場景有效性,以秒計)

**這兩個數字不由實作者決定。** 第一版寫成「現況最小值 × 0.8 / × 0.5」被審查點名是照著現況畫靶(I1、I2)—— 現況必然通過,護欄沒有牙齒。

若負責人的判斷是「現況不夠好」,那本身就是下一輪的入口(`defendTilt` 由 20° 調低),而不是把門檻降到現況之下。

---

### Task 4: 回填門檻與全套回歸

**前置:** Task 3 的裁定。**沒有裁定就不做這個任務。**

- [ ] **Step 1: 加常數與斷言**

```ts
/**
 * 閃躲讓預瞄點多動的度數下限（`swingOn − swingOff`）—— **主判準**。
 *
 * 【為什麼是差值不是絕對值】見 `ablate` 的註解。
 *
 * 【定值】專案負責人 2026-08-15 依配對消融的四場實測裁定。表見 spec §7。
 */
const SWING_EFFECT_FLOOR = <負責人裁定>

/**
 * 方位維持的最短秒數 —— **場景有效性**。
 *
 * 【為什麼不用 `underFire` 或 `inRangeCount`】兩者都與被測的功能耦合：
 * 閃得越好，射手的射擊解越少、距離越常跑出 `THREAT_RANGE`，計數反而下降。
 * 方位閘門只描述兩機的相對幾何，解耦。
 */
const ASPECT_SECONDS_FLOOR = <負責人裁定>
```

```ts
      expect(on.aspectSamples / 20).toBeGreaterThan(ASPECT_SECONDS_FLOOR)
      expect(on.swingUnderFire - off.swingUnderFire).toBeGreaterThan(SWING_EFFECT_FLOOR)
```

- [ ] **Step 2: 單檔跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 全綠。

- [ ] **Step 3: 全套回歸**

Run: `npx vitest run`
Expected: 與基準相同的 4 條紅(`ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑)。`perf-gate` 在全套並行下假紅,單獨跑會綠。

**本輪只改一個測試檔、不動任何 `src/`,所以多出任何一條紅都是異常。**

- [ ] **Step 4: 寫「實作結果」進 spec,commit**

含:配對消融四場表、四點判讀、兩個門檻的定值與裁定理由、`high`/`low` 是否成立(以及那對 `defendAim` 鉛直退化路徑的意義)、全套紅燈清單、下一輪的入口。

```bash
git add test/integration/ai-visible-evasion.test.ts docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md
git commit -m "test: 預瞄點偏移判準回填定值 + docs: 實作結果"
```
