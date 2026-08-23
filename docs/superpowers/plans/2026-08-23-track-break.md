# 追不上就別追 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 在機頭物理上追不上預瞄點時，改用「後置追擊 + 依能量拉高」佈局下一次射擊機會，而不是繼續全力追瞄把能量繳光。

**Architecture:** 一個無因次的量（`Situation.trackRatio` = 視線角速度 ÷ 瞬時轉彎率上限）+ 一個閂鎖（`TrackState`／`stepTrack`）+ 一個純函數（`repositionKnobs`）。接在 `steerCommand` 的 **`engage` 與 `approach` 兩個意圖分支**裡 —— **不加後處理層、不做成 `SteerMode`**。同一輪要先把前一份設計（迴轉平面紀律）移除。

**Tech Stack:** TypeScript、three.js（`Vector3`）、vitest、vite-node（探針）。

**設計來源：** `docs/superpowers/specs/2026-08-23-track-break-design.md`。以下每一節都標了對應章節。

## Global Constraints

- **判準是「玩起來合不合理」，不是攻擊效率。** 不得拿 `fireShare` / `redDamage` / 命中率 / 戰損比的**大小**當**否決**依據（spec §8）。`redDamage > 0` 是「打得起來」的門檻，不是要最大化的量。
- **不加第六層後處理。** 後處理鏈的紀律是「每一層只能動一個東西」，而換瞄準點同時動方位與航跡角 —— 它屬於瞄準點的選擇，不屬於後處理鏈（spec §6.1）。
- **不做成 `SteerMode`。** `mode` 在 `steerCommand` 裡壓過意圖，做成 mode 會連 `defend` 與 `extend` 一起蓋掉（spec §6.2）。
- **只碰 `engage` 與 `approach`。** `merge` / `defend` / `extend` / `rally` 不受影響，而且要是**結構上保證**的，不是靠額外的 if。
- **`trackEnter <= 0` 是消融開關**，關掉時兩個意圖分支逐位元退回改動前（spec §7）。
- 起始參數值（spec §7）：`trackEnter: 1.4`、`trackExit: 1.0`、`trackHold: 3.0`、`zoomEnter: 1.00`、`zoomFull: 1.30`、`trackCap: 4.0`。
- 角度常數就地寫 `X * (Math.PI / 180)`；註解寫**現狀**不寫沿革（專案紀律）。
- **`RAD = 180/π`（弧度→度）、`DEG = π/180`（度→弧度）。** `escort-trace.probe.ts` 自己定義了一個叫 `DEG` 的 `180/π` —— 別跟著抄。

---

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/ai/assess.ts` | `Situation.trackRatio` —— 無因次的「追不追得上」 | 修改 |
| `src/ai/steer.ts` | 五個設定欄位、`TrackState` / `stepTrack`、`repositionKnobs`、兩個意圖分支的接線 | 修改 |
| `src/ai/AiController.ts` | 持有 `TrackState`、每步 `stepTrack`、把旗標交給 `steerCommand` | 修改 |
| `test/unit/ai-assess.test.ts` | `trackRatio` 的值域與退化 | 修改 |
| `test/unit/ai-steer.test.ts` | 閂鎖生命週期、`repositionKnobs`、接線與豁免、消融 | 修改 |
| `test/tools/escort-trace.probe.ts` | 移除已死的 `tp`/`tw`/`te` 欄位，加閂鎖佔時 | 修改 |
| `test/tools/slash-track.probe.ts` | 加閂鎖佔時（三張卡都要看） | 修改 |
| `docs/superpowers/specs/2026-08-23-track-break-design.md` | §3 掃描、§8 實測回填 | 修改 |

**為什麼 `trackRatio` 放在 `assess.ts` 而不是 `steer.ts`：** `Situation` 已經住著一整族無因次的量（`cornerRatio`、`energyRatio`、`speedAdvantage`、`stallMargin`），而且 `losRate` 本來就在那裡算。放進去讓探針與測試都拿得到，不必重算。

---

### Task 1: 移除迴轉平面的紀律

**Files:**
- Modify: `src/ai/steer.ts`、`test/unit/ai-steer.test.ts`、`test/tools/escort-trace.probe.ts`

**Interfaces:**
- Consumes: 無
- Produces: `src/ai/steer.ts` 不再有 `turnPlaneAngle` / `turnPlaneWeight` / `turnPlaneClimb` / `raiseTowardLevel` / `applyTurnPlane`，`SteerConfig` 不再有 `planeEnter` / `planeFull` / `climbMin` / `climbMax` / `energyFull`

**為什麼先做：** 那一份設計實測否決（spec §9.1）—— 第一段方位係數全程 0.000、交會後掉最凶的 11 秒逐位元相同，而代價是 `ai-duel-matrix` 高能量開局由「42 秒擊落」變成「200 秒紅 0 : 藍 0」。留著它會讓本文的量測讀不準。

- [ ] **Step 1: 用 revert 移除三個 commit**

```bash
git revert --no-commit 816dbda f748bce 6129cc9
```

（由新到舊：`816dbda` 接線、`f748bce` `applyTurnPlane`、`6129cc9` 三個純函數與五個欄位。）

- [ ] **Step 2: 修好探針**

`test/tools/escort-trace.probe.ts` 引用了剛被移除的函式。把 import 改成：

```ts
import {
  DEFAULT_STEER, buildEngageBasis, createEngageBasis,
} from '../../src/ai/steer'
```

刪掉 `Sample` 介面裡的三個欄位宣告（`tp`、`tw`、`te`）與它們的註解，刪掉 `out.push` 裡對應的三行，刪掉算 `tpAngle` / `tpEffective` 的那一段，以及摘要裡「第一段方位角」那一整段 `console.error`。

`probeBasis` 與 `buildEngageBasis` **留著** —— 下一個 Task 還要用它算 `trackRatio` 的對照。

- [ ] **Step 3: 型別檢查與單元測試**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS（`turnPlane` 那幾個 describe 應該已經隨 revert 消失）。

- [ ] **Step 4: 確認探針還跑得動**

Run: `npx vite-node test/tools/escort-trace.probe.ts > /dev/null`
Expected: stderr 印出主判準那一行，數字應該回到 **谷底對轟炸機 −443 m、峰值→谷底 1132 m**（那是消融值，也就是改動前）。

- [ ] **Step 5: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts test/tools/escort-trace.probe.ts
git commit -m "revert(ai): 移除迴轉平面的紀律 —— 實測在關鍵 11 秒逐位元無作用"
```

---

### Task 2: `Situation.trackRatio`

**Files:**
- Modify: `src/ai/assess.ts`
- Test: `test/unit/ai-assess.test.ts`

**Interfaces:**
- Consumes: `Situation.losRate`（既有）、`instantaneousTurnRate(spec, altitude, tas)`（`../analysis/envelope`）
- Produces: `Situation.trackRatio: number` —— 無因次，值域 `[0, TRACK_CAP]`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-assess.test.ts` 檔案最後追加。先確認檔案頂端已經 import 了 `createSituation`、`evaluateGeometry`、`Aircraft`、`P51D`、`Vector3`；若缺就補。

```ts
/**
 * 「機頭追不追得上預瞄點」。
 * spec `2026-08-23-track-break-design.md` §2。
 */
describe('trackRatio —— 視線角速度 ÷ 瞬時轉彎率上限', () => {
  const sit = createSituation()

  /** 造一架在 `alt` 平飛、機首朝 −Z、速度 `tas` 的飛機 */
  function flyer(alt: number, tas: number): Aircraft {
    const a = new Aircraft(P51D, alt, tas)
    a.state.position.set(0, alt, 0)
    a.state.velocity.set(0, 0, -tas)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    return a
  }

  /**
   * 【共速同向尾追 = 沒有橫向相對運動】視線角速度是 0，所以比值也是 0。
   * 這一格保證了正常追擊不會誤觸發。
   */
  it('共速同向尾追是 0', () => {
    const self = flyer(4000, 200)
    const target = flyer(4000, 200)
    target.state.position.set(0, 4000, -800)
    evaluateGeometry(self, target, sit)
    expect(sit.trackRatio).toBe(0)
  })

  /**
   * 【近距離高交叉會爆表】300 m 外橫向 200 m/s → 視線角速度 0.67 rad/s
   * = 38°/s，而 P-51 在 4000 m / 200 m/s 的瞬時上限約 22~25°/s。
   */
  it('近距離橫向穿越時大於 1', () => {
    const self = flyer(4000, 200)
    const target = flyer(4000, 200)
    target.state.position.set(0, 4000, -300)
    target.state.velocity.set(200, 0, 0)
    evaluateGeometry(self, target, sit)
    expect(sit.trackRatio).toBeGreaterThan(1)
  })

  /**
   * 【同樣的橫向速度，距離拉遠就追得上】這是這個判準能分開「近距離纏鬥」
   * 與「遠距離俯衝」的結構性原因：分母是距離。
   */
  it('同樣的橫向速度，距離拉到 3 km 就遠小於 1', () => {
    const self = flyer(4000, 200)
    const target = flyer(4000, 200)
    target.state.position.set(0, 4000, -3000)
    target.state.velocity.set(200, 0, 0)
    evaluateGeometry(self, target, sit)
    expect(sit.trackRatio).toBeLessThan(0.3)
  })

  /**
   * 【極近距離會炸】分母趨近 0。護送關全場實測到 20.15。夾住上限，
   * 否則它乘進任何東西都會汙染整條鏈。
   */
  it('極近距離夾在上限', () => {
    const self = flyer(4000, 200)
    const target = flyer(4000, 200)
    target.state.position.set(0, 4000, -30)
    target.state.velocity.set(200, 0, 0)
    evaluateGeometry(self, target, sit)
    expect(sit.trackRatio).toBeLessThanOrEqual(4)
    expect(Number.isFinite(sit.trackRatio)).toBe(true)
  })

  it('createSituation 的預設值是 0', () => {
    expect(createSituation().trackRatio).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-assess.test.ts -t trackRatio`
Expected: FAIL —— `expect(undefined).toBe(0)` 之類（欄位還不存在）。

- [ ] **Step 3: 加欄位與計算**

`src/ai/assess.ts` 第 5 行附近的 import 加上 `instantaneousTurnRate`：

```ts
import {
  specificExcessPower, stallSpeed, sustainedTurnRate, instantaneousTurnRate,
} from '../analysis/envelope'
```

（原本那一行是 `specificExcessPower, stallSpeed, sustainedTurnRate,` —— 保持同一個 import 區塊，不新增一條相依。）

在 `losRate: number` 那個欄位**之後**插入：

```ts
  /**
   * 視線角速度 ÷ 我此刻的**瞬時**轉彎率上限。無因次，夾在 `TRACK_CAP` 以內。
   *
   * **> 1 = 即使拉到極限過載，機頭也追不上預瞄點。** 那是真人飛行員收手改為
   * 佈局下一次機會的訊號 —— 「準星跟不上預瞄點的移動」。
   *
   * 【為什麼分子分母都要】`losRate` 單獨是有因次的，換一台轉彎率不同的飛機
   * 就得重訂門檻。除以自己的能力之後它變成「相對於我做得到的」，換機種、
   * 換高度、換關卡都不必調。
   *
   * 【為什麼用瞬時而不是持續轉彎率】`sustainedTurnRate`（Ps = 0 的最大轉速）
   * 在空戰高度撐不住時回傳 0，拿它當分母整條線都是「追不上」。而「準星跟不
   * 跟得上」問的是**此刻拉得出多少角速度**。
   *
   * 【它是保守的】分母用的是最大過載，所以 `> 1` 的意思是「連極限都不夠」，
   * 不是「我現在懶得拉」。
   */
  trackRatio: number
```

在 `createSituation()` 的 `aspectAngle: 0, angleOffTail: 0, losRate: 0,` 那一行改成：

```ts
    aspectAngle: 0, angleOffTail: 0, losRate: 0, trackRatio: 0,
```

在 `evaluateGeometry` 裡計算 —— 放在 `out.pullCeiling = ...` 那一行**之前**（`selfAlt` 與 `selfTas` 在那裡已經算好了）：

```ts
  // ── 追不追得上：視線角速度相對於我的機頭能力 ────────────────
  const itr = instantaneousTurnRate(self.spec, selfAlt, selfTas)
  out.trackRatio = itr > 0
    ? Math.min(out.losRate / itr, TRACK_CAP)
    // 【拉不出任何過載】那就是完全追不上；沒有橫向運動時仍然是 0
    : (out.losRate > 0 ? TRACK_CAP : 0)
```

在檔案的常數區（`MIN_RANGE` 附近）加：

```ts
/**
 * `trackRatio` 的上限。極近距離時分母趨近 0，實測護送關全場出現過 20.15。
 *
 * 【為什麼是常數而不是設定】它是防爆用的夾子，不是可調的判準 —— 任何大於
 * 門檻兩倍的值在語意上都是同一件事（「完全追不上」）。
 */
const TRACK_CAP = 4
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-assess.test.ts -t trackRatio`
Expected: PASS（5 條）。

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/ai/assess.ts test/unit/ai-assess.test.ts
git commit -m "feat(ai): Situation.trackRatio —— 機頭追不追得上預瞄點"
```

---

### Task 3: `TrackState` 與 `stepTrack`

**Files:**
- Modify: `src/ai/steer.ts`（`SteerConfig`、`DEFAULT_STEER`、`createDefendState` 附近）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `Situation.trackRatio`（Task 2）
- Produces:
  - `interface TrackState { latched: boolean, quiet: number }`
  - `createTrackState(): TrackState`
  - `stepTrack(state: TrackState, ratio: number, active: boolean, dt: number, cfg?: SteerConfig): void`
  - `SteerConfig` 新欄位：`trackEnter`、`trackExit`、`trackHold`、`zoomEnter`、`zoomFull`

- [ ] **Step 1: 寫失敗的測試**

先把新符號加進 `test/unit/ai-steer.test.ts` 的 steer import 區塊：`createTrackState`、`stepTrack`、`type TrackState`。然後在檔案最後追加：

```ts
/**
 * 「追不上」的閂鎖。spec `2026-08-23-track-break-design.md` §5。
 *
 * 【為什麼一定要閂】實測連續超過 `trackEnter` 的最長一段只有 **1.7 秒**。
 * 直接讀瞬時值的話 AI 會佈局 1.7 秒、切回追瞄、再觸發 —— 機首每兩秒抖一次。
 */
describe('stepTrack —— 追不上的閂鎖', () => {
  const cfg = DEFAULT_STEER
  const DT = 1 / 240

  /** 餵 `seconds` 秒的 `ratio`，回傳結束時的狀態 */
  function feed(state: TrackState, ratio: number, seconds: number): TrackState {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) stepTrack(state, ratio, true, DT, cfg)
    return state
  }

  it('起始沒有閂上', () => {
    expect(createTrackState().latched).toBe(false)
  })

  it('超過 trackEnter 立刻閂上', () => {
    const s = createTrackState()
    stepTrack(s, cfg.trackEnter + 0.01, true, DT, cfg)
    expect(s.latched).toBe(true)
  })

  it('恰好等於 trackEnter 不閂 —— 嚴格大於', () => {
    const s = createTrackState()
    stepTrack(s, cfg.trackEnter, true, DT, cfg)
    expect(s.latched).toBe(false)
  })

  /** 【這一條是整個閂鎖存在的理由】1.7 秒的脈衝要撐得住。 */
  it('1.7 秒的脈衝之後仍然閂著', () => {
    const s = createTrackState()
    feed(s, 2.5, 1.7)
    expect(s.latched).toBe(true)
    // 訊號消失，但還沒滿 trackHold
    feed(s, 0.2, cfg.trackHold * 0.9)
    expect(s.latched).toBe(true)
  })

  it('低於 trackExit 連續滿 trackHold 秒才釋放', () => {
    const s = createTrackState()
    feed(s, 2.5, 0.5)
    feed(s, 0.2, cfg.trackHold + 0.05)
    expect(s.latched).toBe(false)
  })

  /** 【計時器要能被打斷】中途又超過門檻就重新計。 */
  it('安靜期被打斷就重新計時', () => {
    const s = createTrackState()
    feed(s, 2.5, 0.5)
    feed(s, 0.2, cfg.trackHold * 0.8)
    feed(s, 2.5, 0.1)                    // 又爆一次
    feed(s, 0.2, cfg.trackHold * 0.8)    // 再等 0.8 倍 —— 不夠
    expect(s.latched).toBe(true)
  })

  /**
   * 【介於兩個門檻之間不算安靜】遲滯帶：閂上之後要掉到 `trackExit` 以下
   * 才開始計時，不是掉到 `trackEnter` 以下。
   */
  it('落在遲滯帶裡不開始計時', () => {
    const s = createTrackState()
    feed(s, 2.5, 0.5)
    feed(s, (cfg.trackEnter + cfg.trackExit) / 2, cfg.trackHold * 3)
    expect(s.latched).toBe(true)
  })

  it('沒有目標時立刻釋放', () => {
    const s = createTrackState()
    feed(s, 2.5, 0.5)
    stepTrack(s, 0, false, DT, cfg)
    expect(s.latched).toBe(false)
  })

  /** 非有限值不得讓狀態卡死或閂上。 */
  it('NaN 不閂上', () => {
    const s = createTrackState()
    stepTrack(s, NaN, true, DT, cfg)
    expect(s.latched).toBe(false)
  })

  /** 【消融開關】trackEnter <= 0 時永遠不閂。 */
  it('trackEnter <= 0 永遠不閂', () => {
    const s = createTrackState()
    const off = { ...cfg, trackEnter: 0 }
    for (let i = 0; i < 2400; i++) stepTrack(s, 99, true, DT, off)
    expect(s.latched).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t stepTrack`
Expected: FAIL —— `createTrackState is not a function`。

- [ ] **Step 3: 加五個設定欄位**

在 `SteerConfig` 介面的 `sweetYieldTime: number` **之後**追加：

```ts
  /**
   * 「追不上」的閂上門檻（`Situation.trackRatio`）。嚴格大於才閂。
   *
   * 【1.4 是四個場景一起決定的】非護送場景的最高點是纏鬥的 **1.28**，
   * 護送關的峰值是 **2.36~2.73** —— 中間有 1.8 倍的空隙。1.4 落在纏鬥
   * 上界之上 9%、護送峰值之下 41%。
   *
   * 【為什麼不是 1.0】門檻 1.0 會讓共速共高的純纏鬥有 **47.4%** 的時間在
   * 收手。近距離繞圈時比值本來就在 1 附近徘徊，而那時候繼續轉才是對的。
   * 取 1.0 等於照著護送關過擬合。
   *
   * **`<= 0` 是整個機制的消融開關** —— 閂鎖永遠不成立，兩個意圖分支逐位元
   * 退回改動前。（0 在語意上是「任何值都觸發」，那是永遠不會要的設定。）
   */
  trackEnter: number
  /**
   * 釋放的門檻。低於它才開始累積安靜時間。
   *
   * 【遲滯帶】`trackExit` 到 `trackEnter` 之間既不閂上也不開始釋放，
   * 防止在門檻上抖動。與 `RuleState` 那幾個閂鎖同一個手法。
   */
  trackExit: number
  /**
   * 低於 `trackExit` 之後還要連續維持幾秒才釋放，s。
   *
   * 【為什麼要計時而不只是遲滯】遲滯處理的是門檻附近的抖動；這裡的問題是
   * **訊號本身只有 1.7 秒**（實測最長一段）。佈局是一個要花好幾秒走完的
   * 動作，不能訊號一掉就中止。
   */
  trackHold: number
  /**
   * 開始往上佈局的 `cornerRatio`。低於它只做水平轉向。
   *
   * 【為什麼用 `cornerRatio` 而不是比能量】它問的是「**現在**拉得動嗎」，
   * 而比能量問的是「帳面上有多少本錢」。後者在這個專案已經被否決兩次。
   */
  zoomEnter: number
  /** 往上佈局到滿的 `cornerRatio`。中間連續，不會跳。 */
  zoomFull: number
```

在 `DEFAULT_STEER` 的 `sweetYieldTime: PROJECTILE_LIFETIME,` **之後**追加：

```ts
  trackEnter: 1.4,
  trackExit: 1.0,
  trackHold: 3.0,
  zoomEnter: 1.00,
  zoomFull: 1.30,
```

- [ ] **Step 4: 寫閂鎖**

在 `createDefendState()` 之後插入：

```ts
/**
 * 「追不上預瞄點」的跨格狀態。由 `stepTrack` 每步維護。
 *
 * 【為什麼與 `DefendState` 分開】那一個是破防的狀態（反轉倒數、破防軸、
 * 脫離側別），這一個是追擊幾何的狀態。兩者的生命週期無關。
 */
export interface TrackState {
  /** 閂上 = 正在佈局下一次機會，而不是追瞄 */
  latched: boolean
  /** 已經連續低於 `trackExit` 幾秒。只在閂上時有意義 */
  quiet: number
}

export function createTrackState(): TrackState {
  return { latched: false, quiet: 0 }
}

/**
 * 維護「追不上」的閂鎖。就地修改 `state`。
 *
 * 生命週期（spec §5.2）：
 * ```
 *   未閂 → 閂上：  trackRatio > trackEnter
 *   閂上 → 釋放：  trackRatio < trackExit 連續維持 trackHold 秒
 * ```
 *
 * @param ratio  `Situation.trackRatio`
 * @param active 有沒有攻擊目標。沒有目標時立刻釋放
 */
export function stepTrack(
  state: TrackState,
  ratio: number,
  active: boolean,
  dt: number,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // 【消融開關】見 `SteerConfig.trackEnter`
  if (!active || !(cfg.trackEnter > 0) || !Number.isFinite(ratio)) {
    state.latched = false
    state.quiet = 0
    return
  }
  if (!state.latched) {
    if (ratio > cfg.trackEnter) {
      state.latched = true
      state.quiet = 0
    }
    return
  }
  // 【遲滯帶裡不算安靜】要掉到 `trackExit` 以下才開始計時
  if (ratio < cfg.trackExit) {
    state.quiet += dt
    if (state.quiet >= cfg.trackHold) {
      state.latched = false
      state.quiet = 0
    }
  } else {
    state.quiet = 0
  }
}
```

- [ ] **Step 5: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts -t stepTrack`
Expected: PASS（10 條）。

- [ ] **Step 6: 型別檢查與整個測試檔**

Run: `npx tsc --noEmit && npx vitest run test/unit/ai-steer.test.ts`
Expected: 無錯誤、全綠。

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat(ai): TrackState 與 stepTrack —— 追不上的閂鎖"
```

---

### Task 4: `repositionKnobs`

**Files:**
- Modify: `src/ai/steer.ts`（`engageKnobs` 之後）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `Knobs`（既有）、`Situation.cornerRatio`（既有）、Task 3 的 `zoomEnter` / `zoomFull`
- Produces: `repositionKnobs(sit: Situation, out: Knobs, cfg?: SteerConfig): void` —— 就地寫入 `out`

- [ ] **Step 1: 寫失敗的測試**

把 `repositionKnobs` 加進 steer import，然後在 `test/unit/ai-steer.test.ts` 最後追加：

```ts
/**
 * 佈局的旋鈕。spec `2026-08-23-track-break-design.md` §4。
 *
 * 專案負責人的原話：「我就會拉平並轉向方位，或是抬高 90 度轉方位（因為我有
 * 能量所以可以垂直抬高）⋯⋯之所以轉向的原因是**我要創造下一次瞄準敵人的
 * 機會**。」—— 後置追擊 + 高 yo-yo 正是這兩個動作。
 */
describe('repositionKnobs —— 佈局下一次機會', () => {
  const cfg = DEFAULT_STEER
  const k: Knobs = { leadLag: 0, vertical: 0 }

  function at(cornerRatio: number): Knobs {
    const sit = createSituation()
    sit.cornerRatio = cornerRatio
    repositionKnobs(sit, k, cfg)
    return k
  }

  /**
   * 【後置給滿】後置的目的是把需要的角速度降下來，而觸發條件本身就是
   * 「降不下來」。要調的是保持多久，不是深淺。
   */
  it('永遠全後置追擊', () => {
    expect(at(0.5).leadLag).toBe(-1)
    expect(at(1.0).leadLag).toBe(-1)
    expect(at(2.0).leadLag).toBe(-1)
  })

  /** 【速度見底就別再拿速度換高度】水平轉向就好。 */
  it('cornerRatio 低於 zoomEnter 時不往上', () => {
    expect(at(cfg.zoomEnter).vertical).toBe(0)
    expect(at(cfg.zoomEnter - 0.2).vertical).toBe(0)
    expect(at(0.5).vertical).toBe(0)
  })

  it('cornerRatio 高於 zoomFull 時給滿', () => {
    expect(at(cfg.zoomFull).vertical).toBe(1)
    expect(at(cfg.zoomFull + 1).vertical).toBe(1)
  })

  it('中間連續而且單調遞增', () => {
    const mid = (cfg.zoomEnter + cfg.zoomFull) / 2
    expect(at(mid).vertical).toBeCloseTo(0.5, 9)
    let prev = -1
    for (let c = 0.6; c <= 2.0; c += 0.05) {
      const v = at(c).vertical
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  /** NaN 會穿過每一個比較然後汙染瞄準點。 */
  it('非有限的 cornerRatio 不產生 NaN', () => {
    const v = at(NaN).vertical
    expect(Number.isNaN(v)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t repositionKnobs`
Expected: FAIL —— `repositionKnobs is not a function`。

- [ ] **Step 3: 實作**

在 `engageKnobs` 函式**之後**插入：

```ts
/**
 * 佈局下一次射擊機會的旋鈕：**後置追擊 + 依能量往上**。就地寫入 `out`。
 *
 * 【它不是脫離】專案負責人的原話：「之所以轉向的原因是**我要創造下一次
 * 瞄準敵人的機會**」。後置追擊把需要的角速度降下來、保住能量，高 yo-yo 用
 * 高度換取下一次進場的位置 —— 兩者都是為了繼續打，不是為了離開。
 *
 * 【與 `engageKnobs` 的分工】那一個由**接近率**決定（太快就後置、追不上就
 * 切內線），問的是速度；這一個在**機頭追不上預瞄點**時取代它，問的是角速度。
 * 兩者不會同時生效 —— 呼叫端二選一。
 */
export function repositionKnobs(
  sit: Situation,
  out: Knobs,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  out.leadLag = -1
  // 【非有限值退化成不往上】水平轉向在任何狀態下都是安全的
  out.vertical = Number.isFinite(sit.cornerRatio)
    ? smoothstep(cfg.zoomEnter, cfg.zoomFull, sit.cornerRatio)
    : 0
}
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts -t repositionKnobs`
Expected: PASS（5 條）。

- [ ] **Step 5: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat(ai): repositionKnobs —— 後置追擊加依能量往上"
```

---

### Task 5: 接進 `steerCommand` 與 `AiController`

**Files:**
- Modify: `src/ai/steer.ts`（`steerCommand` 的簽名與意圖分支）
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `stepTrack` / `createTrackState`、Task 4 的 `repositionKnobs`、Task 2 的 `Situation.trackRatio`
- Produces: `steerCommand(..., out, cfg?, repositioning?)` —— **新參數在最尾端且有預設值**；`AiController.track: TrackState`（公開唯讀）

**為什麼新參數放最尾端：** `steerCommand(` 有 **59 個呼叫點**（多數在 `test/unit/ai-steer.test.ts`）。插在中間會動到每一個，而那些呼叫點與本文無關 —— 動它們只增加出錯機會。放尾端帶預設 `false`，既有呼叫點逐位元退回改動前。

**為什麼傳布林而不是 `TrackState`：** `steerCommand` 需要的是**決定**，不是狀態。傳狀態進去會讓人以為它可以修改，而閂鎖的持有者是 `AiController`（與 `DefendState` 由 `stepDefend` 維護同一個道理）。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-steer.test.ts` 最後追加：

```ts
/**
 * 佈局在 `steerCommand` 這一層的接線。
 * spec `2026-08-23-track-break-design.md` §6。
 *
 * 【與 `repositionKnobs` 的單元測試分工】那一組驗「旋鈕算得對不對」，
 * 這一組驗「哪些意圖會用它、哪些不會」—— 而後者是這份設計的核心約束。
 */
describe('steerCommand：追不上就改為佈局', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const cmd = createCommand()
  const k: Knobs = { leadLag: 0, vertical: 0 }
  let self: Aircraft

  /** 目標在右前方 900 m、橫向高速穿越 —— 追不上的典型幾何 */
  const crossing = () => {
    self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [300, 4000, -800], [200, 0, 0])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 5
    sit.cornerRatio = 1.5
    sit.pullCeiling = 1
    sit.sweetPitch = 0
    engageKnobs(sit, k)
  }

  const run = (intent: Intent, repositioning: boolean) => {
    steerCommand(
      intent, 'normal', sit, basis, self, 0, k, createDefendState(), null,
      cmd, DEFAULT_STEER, repositioning,
    )
    return cmd.aimWorld.clone()
  }

  const same = (a: Vector3, b: Vector3) => {
    expect(a.x).toBe(b.x)
    expect(a.y).toBe(b.y)
    expect(a.z).toBe(b.z)
  }

  it('engage 閂上時瞄準點改變', () => {
    crossing()
    const off = run('engage', false)
    const on = run('engage', true)
    expect(on.distanceTo(off)).toBeGreaterThan(0.01)
    expect(on.length()).toBeCloseTo(1, 9)
  })

  /** 【問題窗的 53.2%】`approach` 原本是純預瞄追擊、零旋鈕。 */
  it('approach 閂上時瞄準點改變', () => {
    crossing()
    const off = run('approach', false)
    const on = run('approach', true)
    expect(on.distanceTo(off)).toBeGreaterThan(0.01)
    expect(on.length()).toBeCloseTo(1, 9)
  })

  /**
   * 【merge 刻意排除】它管交會的那 2.5 秒，要的是「乾淨的預瞄追擊，拿一次
   * 正面快照」—— 見 `engageKnobs` 的註解，那是既有的刻意設計。
   */
  it('merge 逐位元不變', () => {
    crossing()
    same(run('merge', true), run('merge', false))
  })

  it('defend 逐位元不變', () => {
    crossing()
    same(run('defend', true), run('defend', false))
  })

  it('extend 逐位元不變', () => {
    crossing()
    sit.cornerRatio = 0.7
    sit.speedAdvantage = -0.3
    same(run('extend', true), run('extend', false))
  })

  it('rally 逐位元不變', () => {
    crossing()
    steerCommand(
      'rally', 'normal', sit, basis, self, 0, k, createDefendState(),
      new Vector3(3000, 4000, -3000), cmd, DEFAULT_STEER, true,
    )
    const on = cmd.aimWorld.clone()
    steerCommand(
      'rally', 'normal', sit, basis, self, 0, k, createDefendState(),
      new Vector3(3000, 4000, -3000), cmd, DEFAULT_STEER, false,
    )
    same(on, cmd.aimWorld)
  })

  /**
   * 【幾何閘門壓過佈局】撞上去、失速、沒空速都比「佈局下一次」急。
   * 那是既有的順序（mode 分支在意圖分支之前），這一條釘住它。
   */
  it('overshoot 這個 mode 壓過佈局', () => {
    crossing()
    steerCommand(
      'engage', 'overshoot', sit, basis, self, 0, k, createDefendState(), null,
      cmd, DEFAULT_STEER, true,
    )
    const on = cmd.aimWorld.clone()
    steerCommand(
      'engage', 'overshoot', sit, basis, self, 0, k, createDefendState(), null,
      cmd, DEFAULT_STEER, false,
    )
    same(on, cmd.aimWorld)
  })

  /** 【預設值】既有的 59 個呼叫點不帶這個參數，行為必須逐位元不變。 */
  it('不傳參數等同於沒閂上', () => {
    crossing()
    steerCommand('engage', 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd)
    const bare = cmd.aimWorld.clone()
    same(bare, run('engage', false))
  })

  /**
   * 【射擊解是自動豁免的】`maxLosRate = 0.35 rad/s`，而實測的瞬時轉彎率是
   * 22~25°/s（0.38~0.44 rad/s）。所以 `trackRatio > trackEnter` 蘊含
   * `losRate > maxLosRate`，`shouldFire` 早就是 false —— 不需要另寫讓位層。
   *
   * **這一條依賴兩個常數的相對大小。** 哪天有人調 `maxLosRate`、或加一台
   * 轉彎率很低的飛機，它就不再成立，而那時這份設計要重新想豁免。
   */
  it('閂上的門檻蘊含「開不了火」', () => {
    // 閂上時 losRate 至少是 trackEnter × 最小的瞬時轉彎率
    const minItr = 0.38   // rad/s，實測 22°/s
    expect(DEFAULT_STEER.trackEnter * minItr).toBeGreaterThan(DEFAULT_FIRE.maxLosRate)
  })
})
```

（`DEFAULT_FIRE` 要從 `../../src/ai/fire` import；`Intent` 型別從 `../../src/ai/rules` import。）

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "追不上就改為佈局"`
Expected: FAIL —— `steerCommand` 還不吃第 12 個參數（TypeScript 會直接報錯）。

- [ ] **Step 3: 改 `steerCommand` 的簽名與分支**

在 `steerCommand` 的參數列尾端（`cfg: SteerConfig = DEFAULT_STEER,` **之後**）加：

```ts
  /**
   * 「機頭追不上預瞄點，改為佈局下一次機會」。由 `stepTrack` 維護的閂鎖，
   * 呼叫端傳 `track.latched`。
   *
   * 【為什麼傳布林而不是 `TrackState`】這一層需要的是**決定**不是狀態；
   * 狀態的持有者是 `AiController`，與 `DefendState` 由 `stepDefend` 維護
   * 同一個道理。
   *
   * 【為什麼在最尾端】`steerCommand` 有 59 個呼叫點。插在中間會動到每一個，
   * 而那些呼叫點與本機制無關。預設 `false` = 既有行為逐位元不變。
   */
  repositioning = false,
```

在檔案的暫存區（`const A = makeScratch(2)` 附近）加：

```ts
/** `repositionKnobs` 的輸出暫存。與 `makeScratch` 同一個理由：不在熱路徑配置 */
const RK: Knobs = { leadLag: 0, vertical: 0 }
```

把意圖分支改成（注意 `merge` 與 `approach` **要拆開**）：

```ts
      case 'engage':
        // 【追不上就改為佈局】見 `repositionKnobs`。幾何閘門（上面的 mode
        // 分支）壓過這裡 —— 撞上去、失速、沒空速都比佈局急。
        if (repositioning) {
          repositionKnobs(sit, RK, cfg)
          aimFromKnobs(basis, sit, RK, out.aimWorld, cfg)
        } else {
          aimFromKnobs(basis, sit, k, out.aimWorld, cfg)
        }
        break
```

```ts
      case 'approach':
        // 【它原本是純預瞄追擊、零旋鈕】而問題窗裡它佔 53.2% —— 交會之後
        // 一路追著預瞄點往下繞的就是這一格。
        if (repositioning) {
          repositionKnobs(sit, RK, cfg)
          aimFromKnobs(basis, sit, RK, out.aimWorld, cfg)
        } else {
          normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        }
        break
      case 'merge':
        // 【merge 不套佈局】它管交會的那 2.5 秒，要的是乾淨的預瞄追擊、
        // 拿一次正面快照。見 `engageKnobs` 的註解。
        normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        break
```

（原本是 `case 'merge': case 'approach':` 共用一個 `normalizeInto`。）

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "追不上就改為佈局"`
Expected: PASS（9 條）。

- [ ] **Step 5: 接 `AiController`**

在 `src/ai/AiController.ts` 第 11 行的 steer import 加上 `createTrackState`、`stepTrack`。

在 `readonly defend = createDefendState()` 之後加：

```ts
  /**
   * 「追不上預瞄點」的閂鎖。**唯讀** —— 只有 `stepTrack` 能改。
   * 探針與測試靠它讀閂鎖佔時。
   */
  readonly track = createTrackState()
```

在 `stepExtendSide(...)` 那一行之後加：

```ts
    // 【與 stepDefend 同一個位階】追不追得上是跨格的閂鎖，必須由持有者每步
    // 維護。訊號本身只有 1.7 秒，讀瞬時值會讓機首每兩秒抖一次。
    stepTrack(this.track, this.sit.trackRatio, target !== null, dt)
```

把 `steerCommand` 的呼叫改成（在 `raw` 之後補兩個參數）：

```ts
      steerCommand(
        this.intent, mode, this.sit, this.basis, self, this.seaHeight,
        this.knobs, this.defend,
        this.order === null || this.order.kind === 'focus' ? null : this.order.point,
        raw, DEFAULT_STEER, this.track.latched,
      )
```

（`DEFAULT_STEER` 若尚未 import 就補進第 11 行那一組。）

- [ ] **Step 6: 型別檢查與全套單元、整合測試**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

Run: `npx vitest run`
Expected: 記錄紅／綠分布。**與 Task 1 之後的基準比較** —— 這是第一次行為改變，紅的分布會動。任何新增的紅要在 Task 6 裁定，但**校驗和 golden 類的紅是預期的**（`編組表重構：行為逐位元不變`、`戰術層關掉時等於它上線之前`），因為 AI 行為確實改了。

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts src/ai/AiController.ts test/unit/ai-steer.test.ts
git commit -m "feat(ai): 追不上時 engage 與 approach 改為佈局下一次機會"
```

---

### Task 6: 量測、掃描、硬否決回歸、回填

**Files:**
- Modify: `test/tools/escort-trace.probe.ts`、`test/tools/slash-track.probe.ts`
- Modify: `docs/superpowers/specs/2026-08-23-track-break-design.md`
- Modify: `src/ai/steer.ts`（掃描若指向不同的定值）

**Interfaces:**
- Consumes: Task 5 的 `AiController.track`
- Produces: spec §3／§8 的實測回填、定案的參數值

- [ ] **Step 1: 兩支探針加閂鎖佔時**

`test/tools/escort-trace.probe.ts`：在 `Sample` 加

```ts
  /** 追不追得上的比值 */
  tr2: number
  /** 閂鎖有沒有閂上，0 / 1 */
  lat: number
```

在 `out.push` 裡加

```ts
      tr2: +ai.sit.trackRatio.toFixed(3),
      lat: ai.track.latched ? 1 : 0,
```

在主判準摘要之後加一行

```ts
    const latched = out.filter(s => s.lat === 1).length
    console.error(
      '        閂鎖佔時 ' + (100 * latched / out.length).toFixed(1) + '%'
      + '  |  交會後 20 s 內的平均坡度 ' + (() => {
        const seg = out.filter(s => s.t >= out[mergeAt]!.t && s.t <= out[mergeAt]!.t + 20)
        const m = seg.reduce((a, s) => a + Math.abs(s.bk), 0) / Math.max(1, seg.length)
        return m.toFixed(0) + '°'
      })(),
    )
```

`test/tools/slash-track.probe.ts`：在 `Sample` 加同樣兩個欄位，在 `out.push` 裡填
`tr2: +blueAi.sit.trackRatio.toFixed(3), lat: blueAi.track.latched ? 1 : 0,`，
在摘要加一行 `閂鎖佔時 X%`。

- [ ] **Step 2: 量主判準的 A/B**

```bash
TP='{"trackEnter":0}' npx vite-node test/tools/escort-trace.probe.ts > /dev/null   # 消融 = 改動前
npx vite-node test/tools/escort-trace.probe.ts > /dev/null                          # 改動後
```

（PowerShell 的 `$env:TP` 會**留在整個工作階段**，下一次會沉默地沿用。用 bash，或每次跑完 `Remove-Item Env:TP -ErrorAction SilentlyContinue`。）

Expected（spec §8.2）：

| 量 | 改動前 | 目標 |
|---|---|---|
| 谷底對轟炸機 | −443 m | 不得為負 |
| 峰值→谷底 | 1132 m | 明顯減少 |
| 交會後 20 s 平均坡度 | 記下消融值 | 顯著下降 |
| 閂鎖佔時 | 0% | 個位數 % |

消融那一次的三個量**必須逐字重現 −443 / 1132**（`trackEnter: 0` 是早退，行為應該逐位元等同改動前）。對不上就停手查接線有沒有洩漏副作用。

- [ ] **Step 3: 三張對戰卡的閂鎖佔時**

```bash
for c in high co low; do CARD=$c npx vite-node test/tools/slash-track.probe.ts > /dev/null; done
```

Expected：三張卡的閂鎖佔時都應該**接近 0**（靜態量測在 1.4 門檻下是 0.0% / 0.0% / 0.0%）。

**若共速共高那一場不是 0，當場停手重量** —— 那表示動態中的幾何與靜態量測不同（AI 的飛法變了會繞出新幾何，spec §10 風險二）。此時要先弄清楚新幾何長什麼樣，再決定是調門檻還是改設計，**不要直接把門檻往上推到綠為止**。

- [ ] **Step 4: 硬否決回歸**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts test/integration/ai-visible-evasion.test.ts test/integration/ai-defence.test.ts test/integration/ai-duel-matrix.test.ts test/integration/ai-safety-matrix.test.ts test/integration/low-speed-authority.test.ts`

Expected（spec §8.3）：
- `ai-manoeuvre`、`ai-visible-evasion`、`ai-defence` **不得新增紅**
- **`ai-duel-matrix` 三張卡都要打得起來**（`redDamage > 0`）。上一輪就是在這裡爆的
- `belowStall`、`safetyShare` 不得惡化

基準的取法：暫時把 `DEFAULT_STEER.trackEnter` 改成 `0` 跑一次、記下數字、再改回來。消融路徑已經被單元測試釘死是逐位元等價的，比 `git stash` 可靠。

- [ ] **Step 5: 掃描三個關鍵參數**

```bash
for v in 1.3 1.4 1.5 1.8; do TP="{\"trackEnter\":$v}" npx vite-node test/tools/escort-trace.probe.ts > /dev/null; done
for v in 1.5 3 5;        do TP="{\"trackHold\":$v}"  npx vite-node test/tools/escort-trace.probe.ts > /dev/null; done
for v in 0.9 1.0 1.2;    do TP="{\"trackExit\":$v}"  npx vite-node test/tools/escort-trace.probe.ts > /dev/null; done
```

每一組記三個主判準 + 閂鎖佔時。`trackHold` 那一組還要跑一次 `CARD=co` 的掠襲探針 —— 它直接對應 spec §10 風險一（閂太久 = 丟掉射擊機會）。

**判準只有一條：行為的絕對量測（spec §8.2）＋ 硬否決不破線。** 不得拿 `redDamage` 的**大小**當取捨依據。若沒有明顯的最佳點（很可能），**取起始值** 1.4 / 1.0 / 3.0 並把掃描表寫進 `SteerConfig` 對應欄位的註解，標明「待人工試飛定案」。

- [ ] **Step 6: 回填 spec**

在 `docs/superpowers/specs/2026-08-23-track-break-design.md`：

- §3.1 的掃描表下方追加**實作後**的閂鎖佔時（三張卡 + 護送關），與靜態量測對照
- §8.2 的表格加一欄「實測」
- §9.4 把已經補完的量測劃掉，把還沒補的（20v20、雜訊帶）留著並標明**這一輪沒做**
- §10 風險二下方追加一行：實作後共速共高的閂鎖佔時是多少

- [ ] **Step 7: 全套回歸與型別檢查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 與 Task 5 Step 6 相同的紅／綠分布，沒有新增的紅。

- [ ] **Step 8: Commit**

```bash
git add test/tools/escort-trace.probe.ts test/tools/slash-track.probe.ts \
        src/ai/steer.ts docs/superpowers/specs/2026-08-23-track-break-design.md
git commit -m "docs: 追不上就別追的掃描結果與主判準實測回填"
```

- [ ] **Step 9: 交專案負責人試飛**

最終判準是人工試飛（spec §8.4）：在護送關看 AI 交會之後的動作像不像那麼回事。

回報時**必須說清楚三件事**：

1. **這一版只修「別再進那個大坡度」**，沒修「進了也撐得住」（spec §9.3 的指揮儀轉彎補償仍然擱置）。AI 若仍拉大坡度，高度照樣會掉
2. **`approach` 是全域行為改動**，不只護送關。三張對戰卡與 20v20 的表現要一起看
3. **20v20 與雜訊帶這一輪沒量**（spec §9.4），門檻 1.4 的信心來自四個單一 seed 的場景

---

## 自我檢查

**1. spec 覆蓋度**

| spec 章節 | 對應 |
|---|---|
| §2.1 量的定義（`losRate ÷ instantaneousTurnRate`） | Task 2 |
| §2.3 用瞬時而不是持續轉彎率 | Task 2 Step 3 的欄位註解 |
| §3.3 門檻 1.4 | Task 3 的 `trackEnter` 欄位註解與預設值 |
| §4.1 兩個旋鈕 | Task 4 `repositionKnobs` |
| §4.2 上下由 `cornerRatio` 連續決定 | Task 4 的 `smoothstep` 與單調性測試 |
| §5 閂鎖（遲滯 + 計時） | Task 3 `stepTrack` |
| §5.2 `trackCap` 夾上限 | Task 2 的 `TRACK_CAP` 常數與「極近距離」測試 |
| §6.1 不加後處理層 | 全計畫沒有任何後處理層的改動 |
| §6.2 只碰 engage 與 approach | Task 5 的四條「逐位元不變」測試 |
| §6.3 幾何閘門壓過它 | Task 5 的 `overshoot` 測試 |
| §6.4 射擊解自動豁免 | Task 5 的「蘊含開不了火」測試 |
| §7 五個參數與消融開關 | Task 3 欄位、Task 3 的 `trackEnter <= 0` 測試、Task 6 掃描 |
| §8.1 單元測試五項 | Task 2／3／4／5 逐條對應 |
| §8.2 主判準（含平均坡度） | Task 6 Step 1 的摘要與 Step 2 |
| §8.3 硬否決（含三張卡） | Task 6 Step 3、Step 4 |
| §8.4 人工試飛 | Task 6 Step 9 |
| §9.1 移除迴轉平面 | Task 1 |
| §9.4 定案前必須補的量測 | Task 6 Step 6 明寫「這一輪沒做」 |
| §10 五條風險 | 風險一 → Task 6 Step 5 的 `trackHold` 掃描；風險二 → Step 3 的停手條件；風險三 → Task 5 的 extend 逐位元測試；風險四 → Step 3／4 的三張卡；風險五 → Step 9 的回報要求 |

**2. 沒有佔位符**：每個 code step 都有可貼上的完整內容；每個 run step 都有指令與期望結果；兩處「若對不上怎麼辦」寫了具體的下一步（Task 6 Step 2、Step 3），而且 Step 3 明寫**不要把門檻推到綠為止**。

**3. 型別一致**：`trackRatio`、`TrackState`、`createTrackState`、`stepTrack`、`repositionKnobs`、`trackEnter`／`trackExit`／`trackHold`／`zoomEnter`／`zoomFull`／`TRACK_CAP` 在 Task 2→3→4→5→6 與所有測試中逐字相同；`stepTrack(state, ratio, active, dt, cfg?)` 的參數順序在定義（Task 3）、測試（Task 3）與呼叫端（Task 5）一致。
