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

- **不動任何 `src/` 檔案。** 本輪只在一個測試檔裡改。
- **不動 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條既有測試。** 第四版已落地的 `advanceLamp` 與六條合約也不動 —— 那一組已全綠、已 commit,是本輪的地基。
- **門檻由專案負責人依試玩裁定,不由掃描的現況推導。** 這專案已經三次栽在「自訂量測看起來過關、實際沒解決問題」。
- **`Swing` 不再是主判準的工具。** 它量路徑長度,第五版要落點差距。新判準用自己的算法。
- **外推只能有一份實作。** `predictAhead` 必須同時被合約與量測呼叫 —— Codex 連三輪抓到的都是這一類缺陷(第四輪:手電筒黏在目標身上;第五輪:合約用手工擺的狀態;第六輪 I3:量測自己手寫外推)。
- **「只改一個檔案」指的是程式碼。** 回填 spec 是文件,不在那條約束裡。

---

### Task 0: 預測基準的 O(1) 合約(不跑場景)

**這個任務可能會結束整個計畫。** 第五版的核心主張是「理想等速直線的外推是精確的,所以數學地板恆為 0」。那是代數,毫秒內就能證偽。

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`(加進既有的合約 `describe`)

**Interfaces:**
- Consumes: 第四版已落地的 `LampTrack`、`advanceLamp`
- Produces: `function predictAhead(pos, vel, seconds, ghost, look): Aircraft`、`function aimErrorDeg(lamp, actual, predicted, basis, a, b): number`

**`predictAhead` 收的是裸的位置與速度,不是一架 `Aircraft`。** 理由:量測路徑的來源是環形緩衝裡的兩個向量。若它收 `Aircraft`,量測就只能自己再手寫一次外推 —— **那樣合約驗的就是另一份實作**(審查 I3)。

- [ ] **Step 1: 寫外推與誤差兩個純函數**

接在既有的 `advanceLamp` 之後:

```ts
/**
 * 把一組位置與速度直線外推 `seconds` 秒,寫進 `ghost` 並回傳它。
 *
 * 【為什麼吃裸的位置速度而不是一架 `Aircraft`】量測路徑的來源是環形
 * 緩衝裡的兩個向量,不是一架飛機。若這裡收 `Aircraft`,量測就只能自己
 * 再手寫一次外推 —— 而**合約驗的就會是另一份實作**。Codex 連三輪抓到
 * 的正是這一類缺陷(2026-08-16 審查 I3)。
 *
 * 【幽靈機只是資料載體】它不進世界、不受物理、不被任何人看見。存在的
 * 唯一理由是 `buildEngageBasis` 吃的是 `Aircraft`,而我們必須用**產線
 * 那一份**彈道解,不能自己重寫一個 `solveLead`。
 */
function predictAhead(
  pos: Vector3, vel: Vector3, seconds: number, ghost: Aircraft, look: Vector3,
): Aircraft {
  ghost.state.position.copy(pos).addScaledVector(vel, seconds)
  ghost.state.velocity.copy(vel)
  ghost.state.angularVelocity.set(0, 0, 0)
  // 【姿態取速度方向，不複製當下的 prey 姿態】前者與「它照這樣飛下去」
  // 自洽；後者會把**實際狀態**漏進預測裡，那正是這個量要排除的東西
  const speed = vel.length()
  if (speed > 1e-6) {
    ghost.state.orientation.setFromUnitVectors(FWD, look.copy(vel).divideScalar(speed))
  }
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
   * 【六 —— 第五版的地基】理想等速直線的目標,預測誤差恆為 0。
   *
   * 這是整個第五版的核心主張:地板不是實測出來的,是**代數上的**。
   * 第四版的地板是 4.10 / 3.15 / 3.19 / 0.44 度、**方位相依**,害得跨
   * 方位不能比絕對度數;第五版四個方位對齊在 0。
   *
   * 【限定:理想】真實飛機受推力與阻力,速度大小不是嚴格常數,所以
   * **物理**直飛的自我檢查只能要求接近 0,不能宣稱恆等於 0(審查 M1)。
   * 這一條驗的是代數,不是物理。
   *
   * 這一條紅掉 = 那個主張是假的 = 整個計畫要重想。
   */
  it('理想等速直線的目標：預測誤差是 0', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 目標帶一個任意的斜向等速 —— 直線就好，不必與觀測儀同向
    const vel = new Vector3(60, -10, -TAS)
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.velocity.copy(vel)
    prey.state.orientation.setFromUnitVectors(FWD, vel.clone().normalize())

    // 一秒前的位置拿來外推，與「一秒後的實際狀態」比
    const pastPos = prey.state.position.clone().addScaledVector(vel, -1)

    advanceLamp(lamp, prey, track, 0, basis, new Vector3())
    expect(aimErrorDeg(lamp, prey, predictAhead(pastPos, vel, 1, ghost, look), basis, a, b))
      .toBeCloseTo(0, 6)
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
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 一秒前：往 −X 橫飛
    const pastPos = new Vector3(0, ALT, 0)
    const pastVel = new Vector3(-150, 0, -TAS)
    // 一秒後的實際：橫向收掉了，所以位置落在「繼續橫飛」的右邊
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(-40, ALT, -TAS)
    prey.state.velocity.set(0, 0, -TAS)

    // 【17.3° 是算出來的，不是觀察出來的】獨立解一次彈道：
    //   實際   p=(-40,0,-800) v=(0,0,0)      → t=0.903，lead 方向偏 2.9°
    //   預測   p=(-150,0,-800) v=(-150,0,0)  → t=0.961，lead 方向偏 20.2°
    // 差 17.33°。用區間而不是 toBeCloseTo：容得下浮點與求根分支的差異，
    // 但擋得住「少乘一個提前量」或「正負號寫反」那一類的錯
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    const err = aimErrorDeg(lamp, prey, predictAhead(pastPos, pastVel, 1, ghost, look), basis, a, b)
    expect(err).toBeGreaterThan(14)
    expect(err).toBeLessThan(21)
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
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    const pastPos = new Vector3(0, ALT, 0)
    const pastVel = new Vector3(0, 0, -TAS)
    // 一秒後：它拉起來了，比「繼續直飛」高 40 m
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(0, ALT + 40, -TAS)
    prey.state.velocity.set(0, 60, -TAS)

    // 獨立解一次彈道：預測是純尾追（相對速度 0，lead 就是 (0,0,-1)），
    // 實際 p=(0,40,-800) v=(0,60,0) → t=0.908，lead=(0,94.5,-800)，偏 6.74°
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    const err = aimErrorDeg(lamp, prey, predictAhead(pastPos, pastVel, 1, ghost, look), basis, a, b)
    expect(err).toBeGreaterThan(5)
    expect(err).toBeLessThan(9)
  })
```

**這三條的數字是動工前獨立算出來的**(自己解 `|p + v·t| = 887 t`,不呼叫專案的 `solveLead`),不是跑出來之後回填的 —— 那樣就變成照著現況畫靶:

| 合約 | 獨立算出來的值 | Codex 覆核 |
|---|---|---|
| 六(理想等速直線) | **0.0000000000°** —— 精確,不是近似 | 同意 |
| 七(橫向收掉) | 17.32° | 17.325° |
| 八(拉起 40 m) | 6.74° | 6.736° |

合約六算出精確的 0,是第五版整個地基成立的證據:**數學地板不是實測的,是代數的。**

- [ ] **Step 3: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "合約"`
Expected: 九條全綠(第四版的六條 + 這三條),秒級完成。

| 紅掉的合約 | 代表 |
|---|---|
| 六 | 「數學地板是 0」是假的 —— 整個第五版要重想 |
| 七 | 判準抓不到「角度變小」—— 沒有解決第四版的問題,白改 |
| 八 | 判準只對水平面敏感 —— 負責人原話的後半句沒被滿足 |

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 預測誤差的三條合約 —— 數學地板是 0，而且抓得到「角度變小」"
```

---

### Task 1: 兩架的量測函數 + 四方位掃描

**Task 1 與 Task 2 併成一個可編譯的 commit。** `aimMeasure` 沒有消費端時 `noUnusedLocals` 會讓 `tsc --noEmit` 非零退出 —— 拆開會留下一個明知編不過的中間提交(審查 M2)。

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

**Interfaces:**
- Consumes: Task 0 的 `predictAhead`、`aimErrorDeg`;第四版的 `LampTrack`、`advanceLamp`、`probeOffset`、`Probe`;既有的 `median`、`BLUNT`、`Lazy`、`ScriptedBreaker`、`ALT`、`TAS`、`DT`、`FWD`、`createEngageBasis`、`createTargetBoard`、`VETERAN`
- Produces: `interface AimResult`、`function aimMeasure(standoff: number, probe: Probe, evade: boolean): AimResult`

- [ ] **Step 1: 刪掉第四版的 `lampMeasure`、`SwingResult` 與它的 describe**

**這一步會刪既有的行 —— 是本輪唯一的例外,而且刪的是第四版自己上一個 commit 加的東西,不是任何既有基準。**

留下:`Probe`、`probeOffset`、`advanceLamp`、`LampTrack`、合約 `describe`。

已查證(審查覆核):`Swing`、`WINDOW`、`Lazy`、`ScriptedBreaker` 都還有既有使用點,不能刪也不會變成未使用。

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
  /** 有效取樣裡受測方進 `defend` 的比例 */
  defendShare: number
  /**
   * 取樣點上 `defend.reversal > 0` 的比例 —— **歸因的破口**。
   *
   * `defend` 的意圖不保證轉向命令是閃躲:`reversalAim` 是明確的**追擊解**,
   * 而 `geometryGate` 的 `overshoot` / `speedRecover` / `planeDegenerate`
   * 也會在意圖仍是 `defend` 時覆蓋防禦分支（審查 I2）。這一欄與
   * `normalModeShare` 把那些情況印出來,不用嘴巴保證。
   */
  reversalShare: number
  /** 取樣點上 `ai.mode === 'normal'` 的比例 —— 沒有被幾何閘門改寫 */
  normalModeShare: number
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
 * 【取樣前要先讓場景進入穩態】審查 I1:
 *
 * 第一筆樣本在 `t ≈ 1s`,它比的是 `t=0` 到 `t=1s` —— 而那一秒的歷史
 * **完整包含開場**:`alarmRamp` 約 0.2 秒才跨過門檻,`VETERAN.reactionDelay`
 * 是 0.3 秒(意圖已是 `defend`,舵令還要再等)。也就是說第一批樣本量到的
 * 是「AI 還沒開始閃」。
 *
 * 修法不是猜一個延遲常數,而是**直接要求整段前瞻窗都在閃**:維護一個
 * 連續 `defend` 的計數器,只有連續時間 ≥ `LOOKAHEAD` + 反應延遲才取樣。
 */
const SETTLE_STEPS = Math.ceil(VETERAN.reactionDelay * 240)

/**
 * 手電筒量測(第五版):場上只有受測方與觀測儀。
 *
 * @param evade `false` 時把受測方換成腳本直飛(`ScriptedBreaker` + `mode='none'`)
 *              —— 那是**量測工具的自我檢查**,預測誤差應該接近 0。它不是
 *              對照組:第五版的數學地板是 0,不需要跑第二場來取得。
 *
 * 【為什麼沒有誘餌】專案負責人 2026-08-16:「量測時不應該讓敵機去追逐
 * 敵人,也不是追逐手電筒,是讓敵機直飛,但是被手電筒瞄準時閃躲。」
 * 誘餌會讓受測 AI 為了追它而轉彎,那個彎一樣會讓預瞄點移動而且無法歸因。
 *
 * 【目標是手電筒,會不會變成追逐手電筒】場上只有兩架,受測 AI 必然選
 * 觀測儀當目標。緩解在於它全程處在 `defend`,而破防的瞄準是
 * `LOS·cos(75°) + axis·sin(75°)` —— **偏離視線 75°,是破開不是追擊**。
 *
 * 但這**不是**一個程式上的不變量(審查 I2):`cos 75° ≈ 0.259`,仍含
 * 26% 朝攻擊者的分量;`reversalAim` 更是明確的追擊解;`geometryGate` 也
 * 會覆蓋防禦分支。所以本函數回報 `defendShare`、`reversalShare` 與
 * `normalModeShare` 三個數字,讓讀表的人自己判斷,不靠敘述保證。
 *
 * 【歷史環形緩衝】要拿「一秒前的位置與速度」,所以存 `LOOKAHEAD_STEPS + 1`
 * 格,先寫後讀。只存位置與速度 —— 外推只需要這兩個。
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
  // 【觀測儀不開火】它是量測儀器,不是戰鬥單位(spec §6)。`Lazy.update`
  // 明確 `firing = false`,而且兩架都用 `BLUNT`（無傷害彈藥）
  const lc = world.add(lamp, new Lazy(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, lc]) c.respawnOnDestroy = false

  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = pc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const dir = new Vector3()
  const look = new Vector3()
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
  let reversalN = 0
  let normalN = 0
  let lampN = 0
  let samples = 0
  let inside = false
  let validFrom = 0
  let validTo = 0
  let allAlive = true
  /** 連續處在 `defend` 的格數 —— 見 `SETTLE_STEPS` 的註解 */
  let defendRun = 0

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

    defendRun = !evade || ai.intent === 'defend' ? defendRun + 1 : 0

    // 記這一格的狀態，然後回頭拿 LOOKAHEAD 秒前的那一格
    const n = histP.length
    histP[head]!.copy(prey.state.position)
    histV[head]!.copy(prey.state.velocity)
    const oldIdx = (head - LOOKAHEAD_STEPS + n) % n
    head = (head + 1) % n
    if (filled <= LOOKAHEAD_STEPS) filled++

    // 【整段前瞻必須落在有效期內，而且整段都在閃】
    // `filled` 保證環形緩衝有一秒歷史；`s - validFrom` 保證那一秒都在
    // 彈道有效期內；`defendRun` 保證那一秒 AI 都在 defend 而且反應延遲
    // 已經排空（審查 I1）
    if (filled <= LOOKAHEAD_STEPS) continue
    if (s - validFrom < LOOKAHEAD_STEPS) continue
    if (defendRun < LOOKAHEAD_STEPS + SETTLE_STEPS) continue
    if (s % 12 !== 0) continue

    samples++
    errors.push(aimErrorDeg(
      lamp, prey, predictAhead(histP[oldIdx]!, histV[oldIdx]!, LOOKAHEAD, ghost, look),
      basis, va, vb,
    ))
    if (evade) {
      if (ai.intent === 'defend') defendN++
      if (ai.defend.reversal > 0) reversalN++
      if (ai.mode === 'normal') normalN++
      if (ai.threatSource === lamp) lampN++
    }
  }

  const d = Math.max(samples, 1)
  return {
    aimError: median(errors),
    defendShare: defendN / d,
    reversalShare: reversalN / d,
    normalModeShare: normalN / d,
    lampShare: lampN / d,
    samples,
    validSeconds: (validTo - validFrom) * DT,
    allAlive,
  }
}
```

- [ ] **Step 3: 寫掃描的 describe**

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
        + ` 反轉=${(on.reversalShare * 100).toFixed(1)}%`
        + ` 正常模式=${(on.normalModeShare * 100).toFixed(1)}%`
        + ` 瞄我的是手電筒=${(on.lampShare * 100).toFixed(1)}%`
        + ` 有效窗=${on.validSeconds.toFixed(1)}s／自檢 ${off.validSeconds.toFixed(1)}s`
        + ` 取樣=${on.samples}／自檢 ${off.samples}`
        + ` 存活=${on.allAlive}／${off.allAlive}`,
      )
      // 【這一輪的斷言只驗「量測有效」，不驗「AI 夠好」】主判準的門檻由
      // 專案負責人裁定，這一輪連寫都不寫。
      for (const [name, r] of [['閃躲', on], ['自檢', off]] as const) {
        expect(r.allAlive, `${name}：兩架飛機要全程活著`).toBe(true)
        // 【直接斷言取樣數，不用秒數間接推】審查 I4：validSeconds 只比 2
        // 大一點時大約只有 21 筆、涵蓋約一秒實際資料，容易被一次短暫機動
        // 主導中位數。Codex 的獨立診斷是 129~376 筆，40 有充分餘裕
        expect(r.samples, `${name}：取樣數`).toBeGreaterThanOrEqual(40)
        expect(r.validSeconds, `${name}：連續有效窗`).toBeGreaterThan(3)
        expect(Number.isFinite(r.aimError)).toBe(true)
      }
      // 【量測工具的自我檢查】腳本直飛的預測誤差必須接近 0。
      // 它若不接近 0，代表外推或彈道解寫錯了，整張表都不能看。
      // 【為什麼不是恰好 0】真實飛機受推力與阻力，速度大小不是嚴格常數
      expect(off.aimError, '直飛的預測誤差要接近 0').toBeLessThan(1)
      // 場景成立：AI 真的在閃、而且知道是誰在瞄它
      expect(on.defendShare).toBeGreaterThan(0.9)
      expect(on.lampShare).toBeGreaterThan(0.9)
    }, 10 * 60 * 1000)
  }
})
```

**這一輪的斷言全部都是「量測有效」,沒有一條是「AI 夠好」。**

`reversalShare` 與 `normalModeShare` **只印不擋** —— 它們是給讀表的人看的歸因線索,現在還不知道合理值是多少,先訂門檻就是拍腦袋。

- [ ] **Step 4: 型別檢查與跑**

Run: `npx tsc --noEmit`
Expected: 無輸出。

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "預測誤差"`
Expected: 四列 `[預測誤差]`。把表抄下來。

- [ ] **Step 5: 判讀**

1. **`直飛自檢`** —— **先看這一欄**。應該 < 1°。不接近 0 的話後面全部不用看。
2. **`有效窗`** —— Codex 的獨立診斷(不經 vitest,同樣的 240 Hz 順序)給 tail 7.41 s / beam 19.78 s / high 7.43 s / low 7.79 s。實測若與這組差很多,先查為什麼。
3. **`defend佔時` 與 `瞄我的是手電筒`** —— 都應該接近 100%。
4. **`反轉` 與 `正常模式`** —— 歸因線索。反轉佔比高的話,那一段量到的是**追擊解**不是閃躲(審查 I2);`正常模式` 遠低於 100% 代表幾何閘門常常覆蓋防禦分支。
5. **`閃躲`** —— 主判準。與第四版的表**不可直接比較**(量的不是同一件事)。特別看 `beam`:第四版它是 1.1 倍近乎沒閃,第五版若明顯高於自檢,就證實了第四版的 1.1 是量測方法造成的假象。

- [ ] **Step 6: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 預測誤差判準與四方位掃描（兩架、無誘餌）"
```

---

### Task 2: 交裁定、回填門檻、全套回歸

**前置:** Task 1 的表。**沒有專案負責人的裁定就不做 Step 2 之後。**

- [ ] **Step 1: 交專案負責人**

要裁定的:

- **`aimError` 的下限,度**(主判準)—— 依他的試玩感受定,不由現況推導
- 是否要調整**前瞻時間**(現況 `LOOKAHEAD = 1` 秒)。他的敘述是「N 秒內偏移 N 度」,兩個 N 都是他的

要**回報**(不是請他裁定)的:

- **`beam` 在新判準下的值。** 第四版的 1.1 倍是真的還是量測假象,這一輪會有答案
- **四個方位在新判準下的相對高低。** 第四版預期「上下方比較差」被實測推翻;第五版重新回答一次
- **`反轉` 與 `正常模式` 的佔比。** 若反轉佔比高,代表 AI 在那些取樣點做的是追擊而不是閃躲 —— 那是一個新的待辦,不是這一輪要解的

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
 * 【數學地板是 0】理想等速直線的外推是精確的,所以完全不閃的飛機誤差
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
