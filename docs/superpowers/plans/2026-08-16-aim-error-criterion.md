# 預瞄預測誤差判準 Implementation Plan(第五版:兩架 + 預測誤差)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 量「**我以為它一秒後會在哪 vs 它實際在哪**,在我的視角裡差幾度」,四個開局方位各一個值。

**Architecture:** 在 `test/integration/ai-visible-evasion.test.ts` **新增**一條獨立的量測路徑。既有的 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條可見度測試 —— **一個字都不動**。

**Tech Stack:** TypeScript、vitest。無新相依、無新檔案、不動任何 `src/`。

**Spec:** `docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md`(第五版)

**前一份計畫:** `docs/superpowers/plans/2026-08-15-lead-swing-criterion.md`(第四版,已被推翻,但 Task 0 的六條合約與 `advanceLamp` **已經落地且全綠**,本計畫承接它們)

---

## 第四版為什麼被推翻

專案負責人 2026-08-16 看完第四版的表之後:

> 由左飛向右,本來沒被瞄準時預瞄點是移動 15 度(因為飛機飛行 15 度);我瞄準後,預瞄點變成只走 10 度(因為敵機往左飛或往右飛,相對於我來說角度變小),或是預瞄點往上或往下(這樣也是成功閃躲)。所以閃躲成功與失效看的是**沒被瞄的一秒後位置 vs 被瞄的一秒後位置差距**。

**第四版比的是長度,不是位置。** `Swing.net` 是「預瞄方向在 1 秒窗內的淨角位移**大小**」,然後拿閃躲組的大小去比不閃組的大小。本來要走 15 度、閃躲後只走 10 度 —— 第四版判「10 < 15,閃躲比不閃還糟」,而那 5 度的落差正是玩家準星必須修正的量。

實測的後果就在第四版的表裡:

| 開局方位 | 閃躲 | 直飛地板 | 倍率 |
|---|---|---|---|
| tail | 17.51° | 4.10° | 4.3 |
| **beam** | **3.55°** | 3.15° | **1.1** |
| high | 15.00° | 3.19° | 4.7 |
| low | 18.29° | 0.44° | 41.4 |

`beam` 的 1.1 倍不可信 —— 它可能正是「閃了,但相對於觀測者角度變小」被判成「沒閃」。

**同時,負責人砍掉了誘餌:**

> 量測時不應該讓敵機去追逐敵人,也不是追逐手電筒,是讓敵機直飛,但是被手電筒瞄準時閃躲。

這一刀把「它本來就要轉的彎」整個消掉,「本來會在哪」因此有了乾淨的答案:**直線外推**。

## Global Constraints

- **不動任何 `src/` 檔案。** 本輪只在一個測試檔裡新增。
- **不動 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條既有測試。** 也不動第四版已落地的 `advanceLamp` 與六條合約 —— 那一組已經全綠、已經 commit,是本輪的地基。
- **門檻由專案負責人依試玩裁定,不由掃描的現況推導。** 這專案已經三次栽在「自訂量測看起來過關、實際沒解決問題」。
- **`Swing` 不再是主判準的工具。** 它量路徑長度,第五版要落點差距。新判準用自己的算法。
- **「只改一個檔案」指的是程式碼。** 回填 spec 是文件,不在那條約束裡。

---

### Task 0: 預測基準的 O(1) 合約(不跑場景)

**這個任務可能會結束整個計畫。** 第五版的核心主張是「等速直線的外推是精確的,所以地板是恆等的 0」。那是代數,毫秒內就能證偽。

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`(加進既有的合約 `describe`)

**Interfaces:**
- Consumes: 第四版已落地的 `LampTrack`、`advanceLamp`
- Produces: `function predictAhead(from: Aircraft, seconds: number, ghost: Aircraft): Aircraft`、`function aimErrorDeg(lamp, actual, predicted, basis, a, b): number`

- [ ] **Step 1: 寫外推與誤差兩個純函數**

接在既有的 `advanceLamp` 之後:

```ts
/**
 * 把 `from` 的狀態直線外推 `seconds` 秒,寫進 `ghost` 並回傳它。
 *
 * 【幽靈機只是資料載體】它不進世界、不受物理、不被任何人看見。存在的
 * 唯一理由是 `buildEngageBasis` 吃的是 `Aircraft` 而不是裸的位置速度 ——
 * 而我們必須用**產線那一份**彈道解,不能自己重寫一個 `solveLead`。
 *
 * 【姿態一起帶】`buildEngageBasis` 在目標速度趨近 0 時會退回目標的機首
 * 方向。這裡速度不會是 0,但把姿態一起複製才不會留下一個「只有在退化
 * 路徑上才會爆」的地雷。
 */
function predictAhead(from: Aircraft, seconds: number, ghost: Aircraft): Aircraft {
  ghost.state.position.copy(from.state.position).addScaledVector(from.state.velocity, seconds)
  ghost.state.velocity.copy(from.state.velocity)
  ghost.state.orientation.copy(from.state.orientation)
  ghost.state.angularVelocity.set(0, 0, 0)
  ghost.prevPosition.copy(ghost.state.position)
  ghost.prevOrientation.copy(ghost.state.orientation)
  return ghost
}

/**
 * **主判準的算法。** 從 `lamp` 的當下位置看出去,「實際的預瞄方向」與
 * 「預測的預瞄方向」差幾度。
 *
 * 【兩條都用同一個 `lamp`】差距因此純粹來自目標狀態的不同,不含觀測者
 * 自己的位移。
 *
 * 【為什麼不是比位置而是比方向】玩家修正的是**準星的角度**,不是目標的
 * 公尺數。同樣 50 m 的偏移,在 300 m 與 900 m 對玩家的意義差三倍。
 */
function aimErrorDeg(
  lamp: Aircraft, actual: Aircraft, predicted: Aircraft,
  basis: EngageBasis, a: Vector3, b: Vector3,
): number {
  buildEngageBasis(lamp, actual, basis)
  a.copy(basis.leadPoint).normalize()
  buildEngageBasis(lamp, predicted, basis)
  b.copy(basis.leadPoint).normalize()
  return a.angleTo(b) * RAD
}
```

- [ ] **Step 2: 寫三條合約**

加進既有的 `describe('手電筒觀測儀的合約（O(1)，不跑場景）', ...)`:

```ts
  /**
   * 【六 —— 第五版的地基】等速直線的目標,預測誤差恆為 0。
   *
   * 這是整個第五版的核心主張:地板不是實測出來的,是**代數上的**。
   * 第四版的地板是 4.10 / 3.15 / 3.19 / 0.44 度、**方位相依**,害得跨
   * 方位不能比絕對度數;第五版四個方位對齊在 0。
   *
   * 這一條紅掉 = 那個主張是假的 = 整個計畫要重想。
   */
  it('等速直線的目標：預測誤差是 0', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 目標帶一個任意的斜向等速 —— 直線就好，不必與觀測儀同向
    const vel = new Vector3(60, -10, -TAS)
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.velocity.copy(vel)
    prey.state.orientation.setFromUnitVectors(FWD, vel.clone().normalize())

    // 一秒前的狀態拿來外推，與「一秒後的實際狀態」比
    const past = new Aircraft(BLUNT, ALT, TAS)
    past.state.position.copy(prey.state.position).addScaledVector(vel, -1)
    past.state.velocity.copy(vel)
    past.state.orientation.copy(prey.state.orientation)

    advanceLamp(lamp, prey, track, 0, basis, new Vector3())
    expect(aimErrorDeg(lamp, prey, predictAhead(past, 1, ghost), basis, a, b)).toBeCloseTo(0, 6)
  })

  /**
   * 【七 —— 「角度變小也算閃」的守門員】這是專案負責人推翻第四版的那個
   * 例子,直接寫成測試。
   *
   * 目標在一秒前是往 −X 橫飛的;一秒之內它**把橫向速度收掉**（拉回同向）。
   * 從觀測者看過去，預瞄點跑的**距離變短了** —— 第四版會判「動得比較少
   * = 沒在閃」。預測誤差不會：它比的是落點，而落點差很多。
   */
  it('角度變小也是閃躲：預測誤差抓得到', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 一秒前：往 −X 橫飛
    const past = new Aircraft(BLUNT, ALT, TAS)
    past.state.position.set(0, ALT, 0)
    past.state.velocity.set(-150, 0, -TAS)
    // 一秒後的實際：橫向收掉了，所以位置落在「繼續橫飛」的右邊
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(-40, ALT, -TAS)
    prey.state.velocity.set(0, 0, -TAS)

    // 【17.3° 是算出來的，不是觀察出來的】獨立解一次彈道：
    //   實際   p=(-40,0,-800) v=(0,0,0)      → t=0.903，lead 方向偏 2.9°
    //   預測   p=(-150,0,-800) v=(-150,0,0)  → t=0.961，lead 方向偏 20.2°
    // 差 17.3°。用區間而不是 toBeCloseTo：容得下浮點與求根分支的差異，
    // 但擋得住「少乘一個提前量」或「正負號寫反」那一類的錯
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    expect(aimErrorDeg(lamp, prey, predictAhead(past, 1, ghost), basis, a, b))
      .toBeGreaterThan(14)
    expect(aimErrorDeg(lamp, prey, predictAhead(past, 1, ghost), basis, a, b))
      .toBeLessThan(21)
  })

  /**
   * 【八 —— 「往上下偏開也算閃」的守門員】同樣的位移量，改成鉛直方向。
   *
   * 負責人原話的後半句：「或是預瞄點往上或往下（這樣也是成功閃躲）」。
   * 這一條確認判準不是只對水平面敏感。
   */
  it('往上偏開也是閃躲：預測誤差抓得到', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    const past = new Aircraft(BLUNT, ALT, TAS)
    past.state.position.set(0, ALT, 0)
    past.state.velocity.set(0, 0, -TAS)
    // 一秒後：它拉起來了，比「繼續直飛」高 40 m
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(0, ALT + 40, -TAS)
    prey.state.velocity.set(0, 60, -TAS)

    // 獨立解一次彈道：預測是純尾追（相對速度 0，lead 就是 (0,0,-1)），
    // 實際 p=(0,40,-800) v=(0,60,0) → t=0.908，lead=(0,94.5,-800)，偏 6.7°
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    expect(aimErrorDeg(lamp, prey, predictAhead(past, 1, ghost), basis, a, b))
      .toBeGreaterThan(5)
    expect(aimErrorDeg(lamp, prey, predictAhead(past, 1, ghost), basis, a, b))
      .toBeLessThan(9)
  })
```

**這三條的數字是動工前獨立算出來的**(自己解 `|p + v·t| = 887 t`,不呼叫專案的
`solveLead`),不是跑出來之後回填的 —— 那樣就變成照著現況畫靶:

| 合約 | 獨立算出來的值 |
|---|---|
| 六(等速直線) | **0.0000000000°** —— 精確,不是近似 |
| 七(橫向收掉) | 17.32° |
| 八(拉起 40 m) | 6.74° |

合約六算出精確的 0,是第五版整個地基成立的證據:**地板不是實測的,是代數的。**

- [ ] **Step 3: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "合約"`
Expected: 九條全綠(第四版的六條 + 這三條),秒級完成。

| 紅掉的合約 | 代表 |
|---|---|
| 六 | 「地板是代數上的 0」是假的 —— 整個第五版要重想 |
| 七 | 判準抓不到「角度變小」—— 沒有解決第四版的問題,白改 |
| 八 | 判準只對水平面敏感 —— 負責人原話的後半句沒被滿足 |

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 預測誤差的三條合約 —— 地板是代數的 0，而且抓得到「角度變小」"
```

---

### Task 1: 兩架的量測函數

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: Task 0 的 `predictAhead`、`aimErrorDeg`;第四版的 `LampTrack`、`advanceLamp`、`probeOffset`、`Probe`;既有的 `median`、`BLUNT`、`Lazy`、`ScriptedBreaker`、`ALT`、`TAS`、`DT`、`FWD`、`createEngageBasis`、`createTargetBoard`、`VETERAN`
- Produces: `interface AimResult { aimError, defendShare, lampShare, samples, validSeconds, allAlive }`、`function aimMeasure(standoff: number, probe: Probe, evade: boolean): AimResult`

- [ ] **Step 1: 保留第四版的 `probeOffset` 與 `Probe`,刪掉 `lampMeasure` 與 `SwingResult`**

**這一步會刪既有的行 —— 是本輪唯一的例外,而且刪的是第四版自己上一個 commit 加的東西,不是任何既有基準。** 一併刪掉第四版的 `describe('預瞄點偏移（手電筒觀測儀、開局 800 m）', ...)` 與 `LAMP_SECONDS` 的舊註解。

留下:`Probe`、`probeOffset`、`advanceLamp`、`LampTrack`、合約 `describe`。

- [ ] **Step 2: 寫量測函數**

```ts
/**
 * 預測窗長,秒。判準問的是「我以為它**一秒後**會在哪」。
 *
 * 【它與 `WINDOW` 是同一個數字但不是同一件事】`WINDOW`（240 步）是
 * `Swing` 的滑動窗;這裡是外推的前瞻時間。第五版不用 `Swing`,兩者
 * 因此不再耦合 —— 專案負責人日後要調「N 秒」時只改這一個。
 */
const LOOKAHEAD = 1
const LOOKAHEAD_STEPS = LOOKAHEAD * 240

/** 觀察窗上界,秒。實際窗長是第一段連續彈道有效期,見 `validSeconds` */
const LAMP_SECONDS = 20

interface AimResult {
  /** **主判準**:預測誤差的中位數,度 */
  aimError: number
  /** 有效取樣裡受測方進 `defend` 的比例。開場的警戒斜坡是唯一預期的破口 */
  defendShare: number
  /** 有效取樣裡 AI 認定「在瞄我的是手電筒」的比例 —— 歸因護欄 */
  lampShare: number
  /** 有效取樣數 */
  samples: number
  /** 第一段**連續**有效窗的長度,秒 */
  validSeconds: number
  /** 兩架飛機全程都活著 */
  allAlive: boolean
}

/**
 * 手電筒量測(第五版):場上只有受測方與觀測儀。
 *
 * @param evade `false` 時把受測方換成腳本直飛(`ScriptedBreaker` + `mode='none'`)
 *              —— 那是**量測工具的自我檢查**,預測誤差應該接近 0。它不是
 *              對照組:第五版的地板是代數上的 0,不需要跑第二場來取得。
 *
 * 【為什麼沒有誘餌】專案負責人 2026-08-16:「量測時不應該讓敵機去追逐
 * 敵人,也不是追逐手電筒,是讓敵機直飛,但是被手電筒瞄準時閃躲。」
 * 誘餌會讓受測 AI 為了追它而轉彎,那個彎一樣會讓預瞄點移動而且無法歸因。
 *
 * 【目標是手電筒,但不是追逐手電筒】場上只有兩架,受測 AI 必然選觀測儀
 * 當目標;但觀測儀全程握有完美射擊解,`alarmFactor` 恆為 1,所以它全程
 * 處在 `defend` —— 那一層是相對攻擊者做閃躲,不是飛過去打它。破口是開場
 * 警戒斜坡(0.5 s)還沒滿的那半秒,而取樣要等 `LOOKAHEAD` 的歷史填滿才
 * 開始,剛好避開。**用 `defendShare` 擋著,不靠推論。**
 *
 * 【歷史環形緩衝】要拿「一秒前的位置與速度」,所以存 `LOOKAHEAD_STEPS + 1`
 * 格。只存位置與速度 —— 外推只需要這兩個。
 */
function aimMeasure(standoff: number, probe: Probe, evade: boolean): AimResult {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)
  const ghost = new Aircraft(BLUNT, ALT, TAS)

  const preyPos = new Vector3(0, ALT, 0)
  const lampPos = probeOffset(probe, standoff, new Vector3()).add(preyPos)
  for (const [a, p] of [[prey, preyPos], [lamp, lampPos]] as const) {
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
  // 【觀測儀不開火】它是量測儀器,不是戰鬥單位(spec §6)
  const lc = world.add(lamp, new Lazy(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, lc]) c.respawnOnDestroy = false

  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = pc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const dir = new Vector3()
  const va = new Vector3()
  const vb = new Vector3()
  const track: LampTrack = { start: lampPos.clone(), vel: new Vector3(0, 0, -TAS) }

  // 歷史環形緩衝:一秒前的位置與速度
  const histP: Vector3[] = []
  const histV: Vector3[] = []
  for (let i = 0; i <= LOOKAHEAD_STEPS; i++) {
    histP.push(new Vector3())
    histV.push(new Vector3())
  }
  let head = 0
  let filled = 0

  const errors: number[] = []
  let defendN = 0
  let lampN = 0
  let samples = 0
  let inside = false
  let validFrom = 0
  let validTo = 0
  let allAlive = true

  for (let s = 0; s < LAMP_SECONDS * 240; s++) {
    world.step(DT)
    if (!pc.alive || !lc.alive) {
      allAlive = false
      break
    }

    advanceLamp(lamp, prey, track, (s + 1) * DT, basis, dir)

    // ── 有效窗:第一段連續的「彈道解成立」，失效即停 ──────
    const valid = alarmFactor(lamp, prey) > 0
    if (!inside) {
      if (!valid) continue
      inside = true
      validFrom = s
    } else if (!valid) {
      break
    }
    validTo = s

    // 記這一格的狀態，然後回頭拿 LOOKAHEAD 秒前的那一格
    const n = histP.length
    histP[head]!.copy(prey.state.position)
    histV[head]!.copy(prey.state.velocity)
    const oldIdx = (head - LOOKAHEAD_STEPS + n) % n
    head = (head + 1) % n
    if (filled <= LOOKAHEAD_STEPS) filled++

    // 【整段前瞻必須落在有效期內】跨進無威脅的歷史就不算
    if (filled <= LOOKAHEAD_STEPS || s - validFrom < LOOKAHEAD_STEPS || s % 12 !== 0) continue

    ghost.state.position.copy(histP[oldIdx]!).addScaledVector(histV[oldIdx]!, LOOKAHEAD)
    ghost.state.velocity.copy(histV[oldIdx]!)
    ghost.state.orientation.copy(prey.state.orientation)
    ghost.prevPosition.copy(ghost.state.position)
    ghost.prevOrientation.copy(ghost.state.orientation)

    samples++
    errors.push(aimErrorDeg(lamp, prey, ghost, basis, va, vb))
    if (evade && ai.intent === 'defend') defendN++
    if (evade && ai.threatSource === lamp) lampN++
  }

  const d = Math.max(samples, 1)
  return {
    aimError: median(errors),
    defendShare: defendN / d,
    lampShare: lampN / d,
    samples,
    validSeconds: (validTo - validFrom) * DT,
    allAlive,
  }
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 只剩「`aimMeasure` 宣告了沒用」—— Task 2 接上消費端就消失。

---

### Task 2: 掃描四個方位

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

- [ ] **Step 1: 寫掃描的 describe**

```ts
describe('預瞄預測誤差（手電筒觀測儀、兩架、開局 800 m）', () => {
  for (const probe of ['tail', 'beam', 'high', 'low'] as const) {
    it(`開局 ${probe}：我以為它一秒後在哪 vs 它實際在哪`, () => {
      const on = aimMeasure(800, probe, true)
      const off = aimMeasure(800, probe, false)
      console.log(
        `[預測誤差] 開局${probe} 800m`
        + ` 閃躲=${on.aimError.toFixed(2)}°`
        + ` 直飛自檢=${off.aimError.toFixed(2)}°`
        + ` defend佔時=${(on.defendShare * 100).toFixed(1)}%`
        + ` 瞄我的是手電筒=${(on.lampShare * 100).toFixed(1)}%`
        + ` 有效窗=${on.validSeconds.toFixed(1)}s／自檢 ${off.validSeconds.toFixed(1)}s`
        + ` 取樣=${on.samples}／自檢 ${off.samples}`
        + ` 存活=${on.allAlive}／${off.allAlive}`,
      )
      // 【這一輪的斷言只驗「量測有效」，不驗「AI 夠好」】主判準的門檻由
      // 專案負責人裁定，這一輪連寫都不寫。
      for (const [name, r] of [['閃躲', on], ['自檢', off]] as const) {
        expect(r.allAlive, `${name}：兩架飛機要全程活著`).toBe(true)
        expect(r.samples, `${name}：要有取樣`).toBeGreaterThan(0)
        expect(r.validSeconds, `${name}：連續有效窗`).toBeGreaterThan(2)
        expect(Number.isFinite(r.aimError)).toBe(true)
      }
      // 【量測工具的自我檢查】腳本直飛的預測誤差必須接近 0。
      // 它若不接近 0，代表外推或彈道解寫錯了，整張表都不能看
      expect(off.aimError, '直飛的預測誤差要接近 0').toBeLessThan(1)
      // 場景成立：AI 真的在閃、而且知道是誰在瞄它
      expect(on.defendShare).toBeGreaterThan(0.9)
      expect(on.lampShare).toBeGreaterThan(0.9)
    }, 10 * 60 * 1000)
  }
})
```

**這一輪的斷言全部都是「量測有效」,沒有一條是「AI 夠好」。**

- [ ] **Step 2: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "預測誤差"`
Expected: 四列 `[預測誤差]`。把表抄下來。

- [ ] **Step 3: 判讀**

1. **`直飛自檢`** —— **先看這一欄**。應該 < 1°(理論上 0,實測會有物理積分的殘差)。不接近 0 的話後面全部不用看。
2. **`有效窗`** —— 第五版的 AI 全程在閃,會與直飛的觀測儀分開得比第四版快。第四版是 6.0~19.1 秒;若第五版只剩 2~3 秒,那本身就是要回報的發現。
3. **`defend佔時` 與 `瞄我的是手電筒`** —— 都應該接近 100%。低的話代表場景沒有如預期成立。
4. **`閃躲`** —— 主判準。與第四版的表**不可直接比較**(量的不是同一件事)。特別看 `beam`:第四版它是 1.1 倍近乎沒閃,第五版若明顯高於自檢,就證實了第四版的 1.1 是量測方法造成的假象。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 預測誤差判準與四方位掃描（兩架、無誘餌）"
```

---

### Task 3: 交裁定、回填門檻、全套回歸

**前置:** Task 2 的表。**沒有專案負責人的裁定就不做 Step 2 之後。**

- [ ] **Step 1: 交專案負責人**

要裁定的:

- **`aimError` 的下限,度**(主判準)—— 依他的試玩感受定,不由現況推導
- 是否要調整**前瞻時間**(現況 `LOOKAHEAD = 1` 秒)。他的敘述是「N 秒內偏移 N 度」,兩個 N 都是他的

要**回報**(不是請他裁定)的:

- **`有效窗` 實測幾秒。** 若只剩 2~3 秒,代表「當我瞄準攻擊時」這個前提在 800 m 只成立很短的時間 —— 他可能會想改 standoff
- **`beam` 在新判準下的值。** 第四版的 1.1 倍是真的還是量測假象,這一輪會有答案
- **四個方位在新判準下的相對高低。** 第四版預期「上下方比較差」被實測推翻;第五版重新回答一次

- [ ] **Step 2: 回填**

```ts
/**
 * 預瞄預測誤差的下限:玩家一秒前把準星放在預瞄點上,一秒後必須修正的
 * 角度,度。中位數。
 *
 * **這就是「玩家看得出 AI 在閃」的直接判準** —— 準星要修正多少,正是
 * 玩家手上的工作量。
 *
 * 【為什麼是「預測誤差」而不是「預瞄點動了幾度」】後者量的是路徑長度,
 * 會把「本來要走 15°、閃躲後只走 10°」判成「閃躲比不閃還糟」——
 * 而那 5° 的落差正是玩家必須修正的量。專案負責人 2026-08-16 裁定。
 *
 * 【地板是代數上的 0】等速直線的外推是精確的,所以完全不閃的飛機誤差
 * 恆為 0。不需要實測地板來對照,四個方位的數字可以直接比。
 *
 * 【定值】專案負責人依試玩裁定,不由掃描的現況推導 —— 那會照著現況畫靶。
 */
const AIM_ERROR_FLOOR = <負責人裁定>
```

```ts
      expect(on.aimError).toBeGreaterThan(AIM_ERROR_FLOOR)
```

- [ ] **Step 3: 單檔與全套**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 全綠。

Run: `npx vitest run`
Expected: 與基準相同的 5 條紅 —— `ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑,以及 `perf-gate`(全套並行下的假紅,單獨跑會綠)。

**本輪只在一個測試檔裡改、不動任何 `src/`,所以多出任何一條紅都是異常。**

- [ ] **Step 4: 寫「實作結果」進 spec,commit**
