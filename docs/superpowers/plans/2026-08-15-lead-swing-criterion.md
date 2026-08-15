# 預瞄點偏移判準 Implementation Plan(第三版:手電筒觀測儀)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一隻**始終瞄準敵機、不受物理支配**的觀測儀,量「照著 N 秒之後,預瞄點相對 N 秒前偏移幾度」,四個方位各一個值。

**Architecture:** 在 `test/integration/ai-visible-evasion.test.ts` **新增**一條獨立的量測路徑。既有的 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條可見度測試 —— **一個字都不動**。

**Tech Stack:** TypeScript、vitest。無新相依、無新檔案、不動任何 `src/`。

**Spec:** `docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md`(第三版)

## 這一版與前兩版的差異

專案負責人 2026-08-15:

> 射手不要用真的飛機去測量,因為真的飛機轉向瞄準也是需要滾轉的時間。把射手當成一隻可以自由轉動的手電筒,始終瞄準在敵機身上就好。原本的「預瞄點動了幾度」直接當判準就可以保留。

**把污染源移除,比把污染扣掉簡單。** 這一句話同時消掉了前兩版的三個問題:

| 前兩版的問題 | 為什麼消失 |
|---|---|
| 主判準無法歸因(審查 C4):射手自己的滾轉與拉桿灌進預瞄點位移 | 觀測儀不機動,貢獻是 0。**配對消融整個不要了** |
| 垂直場景 2.5 秒就收斂成尾追(審查 C3) | 觀測儀不追擊,方位由建構保證 |
| `Command.aimWorld` 同時是飛行方向與射擊方向,「維持站位」與「機首指著目標」互斥 | 觀測儀不飛,死結不存在 |

連帶不再需要:方位閘門 `aspectHolds`、場景有效性計數 `aspectSamples`、`hunterLook`、對 `scripted` 的改動、以及整套「逐位元恆等」的驗證負擔(因為根本不碰既有路徑)。

## Global Constraints

- **不動任何 `src/` 檔案。** 本輪只在一個測試檔裡新增。
- **不動 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條既有測試。** 新路徑是獨立函數。這一條讓「有沒有破壞既有基準」變成一個**看 diff 就能回答**的問題。
- **門檻由專案負責人依試玩裁定,不由掃描的現況推導。** 2026-08-05 的「位移 ≥ 5°」是猜的;第一版的「現況最小值 × 0.8」是照著現況畫靶 —— 同一類錯誤的兩面。
- **量的形狀不變:** 滑動窗、窗長 `WINDOW`(240 步 = 1 秒)、取「現在的預瞄方向」與「1 秒前」的淨夾角。沿用既有的 `Swing`。

---

### Task 1: 觀測儀與量測函數

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`(只新增,不改既有符號)

**Interfaces:**
- Consumes: 既有的 `Swing`、`median`、`BLUNT`、`Lazy`、`ALT`、`TAS`、`DT`、`FWD`、`buildEngageBasis`、`createEngageBasis`、`createTargetBoard`、`VETERAN`
- Produces:
  - `type Probe = 'tail' | 'beam' | 'high' | 'low'`
  - `probeOffset(probe, standoff, out): Vector3`
  - `interface SwingResult { leadSwing, straightness, defendShare, samples }`
  - `function lampMeasure(standoff: number, probe: Probe, evade: boolean): SwingResult`

- [ ] **Step 1: 觀測儀的擺位**

在檔案**末尾**(既有的 `describe` 之後)新增:

```ts
// ══ 手電筒觀測儀 ═══════════════════════════════════════════
//
// 【為什麼要另一條量測路徑】上面那一套用的是**真飛機**射手，而真飛機要
// 滾轉、要拉桿才轉得過來 —— 那些動作全都灌進「預瞄點動了幾度」，量到的
// 不只是 AI 的閃躲（2026-08-15 Codex 審查 C4；同一份檔案記錄的
// `ordinaryMedian` 6~11° 就是證據）。
//
// 專案負責人 2026-08-15 的解法：把射手當成一隻**可以自由轉動的手電筒**，
// 始終瞄準在敵機身上。污染源直接移除，比把污染扣掉簡單。
//
// 【這是新增不是取代】完美的手電筒瞄準誤差恆為 0，所以上面那條路徑的主
// 判準 `shootableShare`（機首落在預瞄錐內的佔比）在它身上恆為 1、完全失
// 去意義。兩條路徑回答兩個不同的問題：真射手問「一個受物理限制的追擊者
// 跟不跟得住」，手電筒問「預瞄點本身動了多少」。見 spec §3.3。

/** 觀測儀相對受測 AI 的方位 */
type Probe = 'tail' | 'beam' | 'high' | 'low'

/**
 * 觀測儀相對受測 AI 的固定位移。
 *
 * 【為什麼可以是固定的】它不追擊、不受物理支配，方位由建構保證 ——
 * 這正是它取代真射手的理由（真射手 2.5 秒就收斂成尾追，spec §3.2）。
 */
function probeOffset(probe: Probe, standoff: number, out: Vector3): Vector3 {
  if (probe === 'tail') return out.set(0, 0, standoff)
  if (probe === 'beam') return out.set(standoff, 0, 0)
  return out.set(0, probe === 'high' ? standoff : -standoff, 0)
}
```

- [ ] **Step 2: 量測函數**

```ts
interface SwingResult {
  /** **主判準**：預瞄方向的 1 秒窗淨角位移中位數，度 */
  leadSwing: number
  /** 淨位移 ÷ 逐格位移總和。直線接近 1、來回抽搐接近 0 */
  straightness: number
  /** 取樣裡受測 AI 進 `defend` 的比例。觀測值 —— 見下面的註解 */
  defendShare: number
  /** 有效取樣數 */
  samples: number
}

/**
 * 手電筒量測：觀測儀在 `probe` 方位、`standoff` 距離處始終瞄著受測 AI，
 * 量預瞄方向的 1 秒窗淨角位移。
 *
 * @param evade `false` 時把受測方換成腳本直飛（`ScriptedBreaker` + `mode='none'`）
 *              —— 那是「完全不閃」的地板，任何數字都要跟它並排看。
 *
 * 【觀測儀怎麼實作】它是一個真的 `Combatant`（受測 AI 要靠
 * `threatFactor(觀測儀, AI)` 才會進入 `defend`，那需要姿態與武裝），但每個
 * 物理步之後把它的狀態**直接覆寫**：位置 = AI 的位置 + 固定位移、速度 = 與
 * AI 相同、機首指向預瞄點。移除的是它的飛行動力學，不是它的存在。
 *
 * 【覆寫為什麼排在 `world.step` 之後】`World.step` 是「先全部跑控制器、
 * 再全部積分物理」。排在之後，AI 下一格才讀到修正過的位置 —— 延遲一個
 * 物理步（4 ms），可忽略；排在之前會被同一步的積分立刻蓋掉。
 *
 * 【`prevPosition` / `prevOrientation` 必須一起覆寫】它們是內插與角速度的
 * 來源。只改 `state` 的話會產生假的角速度（spec §5 風險三）。
 *
 * 【預瞄點在這裡等於目標位置】`solveLead` 吃的是**相對**速度，而觀測儀與
 * AI 等速並飛，相對速度為零 —— 預瞄解因此就是目標本身。這是正確的（等速
 * 並飛的觀測者不需要提前量），但下一個人要知道：這條路徑量到的是**目標
 * 方向**的變化，不是提前量的變化。
 */
function lampMeasure(standoff: number, probe: Probe, evade: boolean): SwingResult {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const bait = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)

  const preyPos = new Vector3(0, ALT, 0)
  const baitPos = new Vector3(0, ALT, -500)
  const lampPos = probeOffset(probe, standoff, new Vector3()).add(preyPos)
  for (const [a, p] of [[prey, preyPos], [bait, baitPos], [lamp, lampPos]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(FWD).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, FWD)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const breaker = new ScriptedBreaker()
  breaker.mode = 'none'
  breaker.threat = lamp
  const pc = world.add(prey, evade ? ai : breaker, 'blue', preyPos, ALT, TAS)
  const bc = world.add(bait, new Lazy(), 'red', baitPos, ALT, TAS)
  // 【觀測儀不開火】它是量測儀器，不是戰鬥單位（spec §6）
  const lc = world.add(lamp, new Lazy(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, bc, lc]) c.respawnOnDestroy = false

  const board = createTargetBoard(world.combatants)
  ai.board = board
  ai.selfIndex = pc.index
  ai.target = bait
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const dir = new Vector3()
  const swing = new Swing()
  const offset = new Vector3()
  const look = new Vector3()
  const swings: number[] = []
  const straights: number[] = []
  let defendN = 0
  let samples = 0

  for (let s = 0; s < SECONDS * 240; s++) {
    world.step(DT)
    if (!pc.alive) break

    // ── 觀測儀歸位：位置、速度、姿態 ────────────────────
    probeOffset(probe, standoff, offset)
    lamp.state.position.copy(prey.state.position).add(offset)
    lamp.state.velocity.copy(prey.state.velocity)
    look.subVectors(prey.state.position, lamp.state.position).normalize()
    lamp.state.orientation.setFromUnitVectors(FWD, look)
    lamp.prevPosition.copy(lamp.state.position)
    lamp.prevOrientation.copy(lamp.state.orientation)

    buildEngageBasis(lamp, prey, basis)
    swing.push(dir.copy(basis.leadPoint).normalize())
    if (!swing.ready || s % 12 !== 0) continue

    samples++
    swings.push(swing.net)
    if (swing.straightness > 0) straights.push(swing.straightness)
    if (evade && ai.intent === 'defend') defendN++
  }

  return {
    leadSwing: median(swings),
    straightness: median(straights),
    defendShare: defendN / Math.max(samples, 1),
    samples,
  }
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出。

若 `ScriptedBreaker` 的 `threat` 欄位型別或 `Lazy` 的建構不合,依既有用法調整 —— **但不得修改那兩個類別**。

- [ ] **Step 4: 確認既有路徑一個字都沒動**

Run: `git diff test/integration/ai-visible-evasion.test.ts`

Expected: diff **只有新增的行**,沒有任何一行被刪除或修改。

**有任何既有行被動到 = 違反 Global Constraints,回退重做。**

- [ ] **Step 5: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 手電筒觀測儀 —— 量預瞄點偏移，排除射手自身機動的污染"
```

---

### Task 2: 掃描四個方位

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

- [ ] **Step 1: 寫掃描的 describe**

```ts
describe('預瞄點偏移（手電筒觀測儀、800 m、180 秒）', () => {
  for (const probe of ['tail', 'beam', 'high', 'low'] as const) {
    it(`${probe}：手電筒照著 1 秒，預瞄點偏移幾度`, () => {
      const on = lampMeasure(800, probe, true)
      const off = lampMeasure(800, probe, false)
      console.log(
        `[手電筒] ${probe} 800m`
        + ` 閃躲=${on.leadSwing.toFixed(2)}°`
        + ` 直飛地板=${off.leadSwing.toFixed(2)}°`
        + ` 倍率=${(on.leadSwing / Math.max(off.leadSwing, 1e-6)).toFixed(1)}`
        + ` 同向性=${on.straightness.toFixed(3)}`
        + ` defend佔時=${(on.defendShare * 100).toFixed(1)}%`
        + ` 取樣=${on.samples}`,
      )
      // 【這一輪唯一的斷言】場景要成立：受測 AI 真的感覺到被瞄準。
      // 觀測儀始終精準瞄著，所以 `defend` 佔時應該很高；若接近 0，代表
      // 威脅判定沒有如預期觸發，那要先查，不是調門檻（spec §4.2）。
      expect(on.defendShare).toBeGreaterThan(0.5)
    }, 10 * 60 * 1000)
  }
})
```

**這一輪只有這一條斷言。** 主判準的門檻是 Task 3 的事,而且由專案負責人定。

- [ ] **Step 2: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "手電筒"`
Expected: 四列 `[手電筒]`。把表抄下來。

- [ ] **Step 3: 判讀**

1. **`defend佔時`** —— 應該很高(觀測儀始終瞄著)。若某個方位接近 0,先查威脅判定,不要繼續。
2. **`閃躲` vs `直飛地板`** —— 地板應該在 1° 上下。倍率就是「閃躲讓預瞄點多動了幾倍」。
3. **`high` / `low` 與水平兩個的差距** —— spec 預期它們**比較差**,因為 `defendAim` 在視線接近鉛直時走的是**沒有抬角的退化路徑**。若成立,那是一個新的待辦(要不要補那條路徑),交專案負責人。
4. **`同向性`** —— 應該遠高於 0.5。低的話代表那是抽搐不是閃躲。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 手電筒量測四個方位的掃描"
```

---

### Task 3: 交裁定、回填門檻、全套回歸

**前置:** Task 2 的表。**沒有專案負責人的裁定就不做 Step 2 之後。**

- [ ] **Step 1: 交專案負責人**

把四列表與 Task 2 Step 3 的四點判讀交出去。要裁定的是:

- **`leadSwing` 的下限,度**(主判準)—— 依他的試玩感受定,不由現況推導
- 是否要調整**窗長**(現況 1 秒)。他的敘述是「N 秒內偏移 N 度」,兩個 N 都是他的

若他的判斷是「現況不夠好」,那本身就是下一輪的入口(`defendTilt` 由 20° 調低 —— 2026-08-15 已量到 0° 讓玩家壓得住準星的時間由 6.23% 降到 1.28%),而不是把門檻降到現況之下。

- [ ] **Step 2: 回填**

```ts
/**
 * 預瞄點偏移的下限：手電筒照著 1 秒，預瞄方向的淨角位移中位數，度。
 *
 * **這就是「玩家看得出 AI 在閃」的直接判準** —— 預瞄點在玩家視角裡動了
 * 多少度，正是他手上必須修正的量。
 *
 * 【為什麼用手電筒而不是真射手】真飛機要滾轉、要拉桿才轉得過來，那些動作
 * 全都會灌進這個數字（同檔的 `ordinaryMedian` 6~11° 就是證據）。觀測儀不
 * 機動，量到的只剩 AI 自己的動作。專案負責人 2026-08-15 裁定。
 *
 * 【讀這個數字一定要並排看直飛地板】完全不閃是 1° 上下。
 *
 * 【定值】專案負責人依試玩裁定，不由掃描的現況推導 —— 那會照著現況畫靶。
 */
const LEAD_SWING_FLOOR = <負責人裁定>
```

```ts
      expect(on.leadSwing).toBeGreaterThan(LEAD_SWING_FLOOR)
```

- [ ] **Step 3: 單檔與全套**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 全綠。

Run: `npx vitest run`
Expected: 與基準相同的 4 條紅(`ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑)。`perf-gate` 在全套並行下假紅,單獨跑會綠。

**本輪只在一個測試檔裡新增、不動任何 `src/`,所以多出任何一條紅都是異常。**

- [ ] **Step 4: 寫「實作結果」進 spec,commit**

含:四列掃描表、四點判讀、門檻的定值與裁定理由、`high` / `low` 是否真的比較差(以及那對 `defendAim` 鉛直退化路徑的意義)、全套紅燈清單、下一輪的入口。

```bash
git add test/integration/ai-visible-evasion.test.ts docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md
git commit -m "test: 預瞄點偏移判準回填定值 + docs: 實作結果"
```
