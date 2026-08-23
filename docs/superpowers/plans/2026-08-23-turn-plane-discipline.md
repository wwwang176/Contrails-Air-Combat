# 迴轉平面的紀律 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `steerCommand` 的後處理鏈插入第三層，讓 AI 在「要轉一大圈才瞄得到」的態勢下不准把航跡角壓成負的，並依能量優勢帶一點拉高。

**Architecture:** 三個純函數（方位角、方位係數、拉高量）+ 一個就地修改 `aimWorld` 的層（`applyTurnPlane`），全部住在 `src/ai/steer.ts`。層插在 `applyPitchBias` 之後、`applyFloor` 之前。**不動任何函式簽名、不動 `AiController`、不碰玩家飛控。** 消融開關是 `climbMax: 0`，早退（early return）保證逐位元退回改動前。

**Tech Stack:** TypeScript、three.js（`Vector3`）、vitest、vite-node（探針）。

**設計來源：** `docs/superpowers/specs/2026-08-23-turn-plane-discipline-design.md`。以下每一節都標了對應的 spec 章節。

## Global Constraints

- **判準是「玩起來合不合理」，不是攻擊效率。** 不得拿 `fireShare` / `redDamage` / 命中率 / 戰損比當**否決**依據（spec §8）。行為的絕對量測（掉幾公尺、指令壓到幾度）才是判準。
- **每一層只能動一個東西**（spec §5.2 不變式二）：縮誤差、改航跡角、改方位 —— 三選一。本層只改**航跡角**，水平方位一格都不准動。
- **安全層永遠最後**（spec §5.2 不變式一）：新層插在 `applyFloor` **之前**。
- **`rally` 不套戰術偏好**（spec §5.2 不變式三）。
- **`climbMax: 0` 是消融開關**，兩個效果（拉高偏置與航跡角下限）都要能被它關掉，關掉時行為**逐位元**退回改動前（spec §6）。
- 角度常數一律就地寫 `X * (Math.PI / 180)`，不為了一個常數多一條相依（`src/ai/steer.ts` 的既有慣例，見 `EXTEND_PITCH`）。
- 起始參數值（spec §6）：`planeEnter: 60°`、`planeFull: 120°`、`climbMin: 3°`、`climbMax: 8°`、`energyFull: 500`。
- 註解寫**現狀**不寫沿革（專案紀律）。

---

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/ai/steer.ts` | `SteerConfig` 五個新欄位、`DEFAULT_STEER` 五個值、四個新函式、`steerCommand` 內接線 | 修改 |
| `test/unit/ai-steer.test.ts` | 純函數的逐條斷言 + `steerCommand` 層級的整合斷言（覆蓋度表、豁免、消融） | 修改 |
| `test/tools/escort-trace.probe.ts` | 加 stderr 主判準摘要 + `TP` 環境變數覆寫設定 | 修改 |
| `docs/superpowers/specs/2026-08-23-turn-plane-discipline-design.md` | §6 掃描結果、§8 實測數字回填 | 修改 |

**為什麼全部塞進 `src/ai/steer.ts` 而不開新檔：** 本層與 `applyFloor`、`applyPitchBias`、`shrinkTowardNose`、`sweetYield` 是同一族（同樣就地改 `aimWorld`、同樣讀 `SteerConfig`、同樣被 `steerCommand` 尾端串起來），它們全部住在這個檔案裡。拆出去會讓「後處理鏈」這件事散在兩個檔案，而 spec §5 整節的重點就是這條鏈的順序要看得見。

---

### Task 1: 三個純函數與五個設定欄位

**Files:**
- Modify: `src/ai/steer.ts`（`SteerConfig` 介面尾端、`DEFAULT_STEER` 尾端、`sweetYield` 之後）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `SteerConfig`、`DEFAULT_STEER`、`clampUnit` 與 `FWD`（兩者都是 `src/ai/steer.ts` 檔案內的私有符號，不需要 import）、`smoothstep` / `lerp` / `clamp`（`../core/math`）、`makeScratch`（`../core/pool`）
- Produces:
  - `turnPlaneAngle(self: Aircraft, leadPoint: Vector3): number` —— rad，正前 0、正後 π
  - `turnPlaneWeight(angle: number, cfg?: SteerConfig): number` —— 0..1
  - `turnPlaneClimb(energyAdvantage: number, cfg?: SteerConfig): number` —— rad，值域 `[climbMin, climbMax]`
  - `SteerConfig` 新欄位：`planeEnter`、`planeFull`、`climbMin`、`climbMax`、`energyFull`

- [ ] **Step 1: 先確認 `clamp` 與 `lerp` 已經被 import**

`src/ai/steer.ts` 第 3 行目前是：

```ts
import { smoothstep } from '../core/math'
```

改成：

```ts
import { clamp, lerp, smoothstep } from '../core/math'
```

- [ ] **Step 2: 寫失敗的測試**

先把需要的符號加進 import。`test/unit/ai-steer.test.ts` 第 5–11 行那一組改成：

```ts
import {
  aimFromKnobs, buildEngageBasis, createEngageBasis, engageKnobs, extendPitchAngle,
  geometryGate, steerCommand, DEFAULT_STEER, type Knobs,
  createDefendState, stepDefend, defendAim, floorPitchAngle, applyFloor, unloadPull, applyPitchBias,
  sweetYield, type SteerConfig,
  headingErrorTo, extendHeadingBias, stepExtendSide,
  turnPlaneAngle, turnPlaneWeight, turnPlaneClimb,
} from '../../src/ai/steer'
```

（**只加這三個。** `raiseTowardLevel` 與 `applyTurnPlane` 到 Task 2 才存在，
先寫進來的話 Task 1 Step 6/7 的 `tsc` 過不了。）

然後在檔案**最後**追加：

```ts
/**
 * 迴轉平面的紀律 —— 方位與能量兩個維度。
 * spec `2026-08-23-turn-plane-discipline-design.md` §2。
 */
describe('turnPlaneAngle —— 預瞄點相對機鼻的 3D 夾角', () => {
  /** 機首朝 −Z、平飛 */
  function nosed(): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    return a
  }

  it('正前方是 0', () => {
    expect(turnPlaneAngle(nosed(), new Vector3(0, 0, -800))).toBeCloseTo(0, 9)
  })

  it('正後方是 π', () => {
    expect(turnPlaneAngle(nosed(), new Vector3(0, 0, 800))).toBeCloseTo(Math.PI, 9)
  })

  it('正側方是 π/2，長度不影響結果', () => {
    expect(turnPlaneAngle(nosed(), new Vector3(800, 0, 0))).toBeCloseTo(Math.PI / 2, 9)
    expect(turnPlaneAngle(nosed(), new Vector3(5, 0, 0))).toBeCloseTo(Math.PI / 2, 9)
  })

  /**
   * 【正上方也是 π/2】它是 **3D** 夾角，不是水平投影 —— 「要轉多少才瞄得到」
   * 在垂直方向與水平方向一樣是要轉。
   */
  it('正上方是 π/2', () => {
    expect(turnPlaneAngle(nosed(), new Vector3(0, 800, 0))).toBeCloseTo(Math.PI / 2, 9)
  })

  /**
   * 【零向量回 0 = 不介入】預瞄點與自機重合時方位沒有定義。回 0 讓方位係數
   * 也是 0，整層無操作 —— 與 `sweetYield` 的退化方向一致（讓本層失效）。
   */
  it('零向量回 0', () => {
    expect(turnPlaneAngle(nosed(), new Vector3(0, 0, 0))).toBe(0)
  })

  it('機首轉向之後跟著轉', () => {
    const a = nosed()
    // 機首朝 +X
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(1, 0, 0))
    expect(turnPlaneAngle(a, new Vector3(800, 0, 0))).toBeCloseTo(0, 9)
    expect(turnPlaneAngle(a, new Vector3(0, 0, -800))).toBeCloseTo(Math.PI / 2, 9)
  })
})

describe('turnPlaneWeight —— 方位係數', () => {
  const cfg = DEFAULT_STEER

  it('小於 planeEnter 嚴格是 0', () => {
    expect(turnPlaneWeight(0, cfg)).toBe(0)
    expect(turnPlaneWeight(cfg.planeEnter, cfg)).toBe(0)
    expect(turnPlaneWeight(cfg.planeEnter - 1e-6, cfg)).toBe(0)
  })

  it('大於等於 planeFull 是 1', () => {
    expect(turnPlaneWeight(cfg.planeFull, cfg)).toBe(1)
    expect(turnPlaneWeight(Math.PI, cfg)).toBe(1)
  })

  it('中點是 0.5，而且單調遞增', () => {
    const mid = (cfg.planeEnter + cfg.planeFull) / 2
    expect(turnPlaneWeight(mid, cfg)).toBeCloseTo(0.5, 9)
    let prev = -1
    for (let d = 0; d <= 180; d += 5) {
      const w = turnPlaneWeight(d * DEG, cfg)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
  })

  /** NaN 會穿過每一個比較然後汙染整個 `aimWorld`。回 0 = 本層失效。 */
  it('非有限值回 0', () => {
    expect(turnPlaneWeight(NaN, cfg)).toBe(0)
    expect(turnPlaneWeight(Infinity, cfg)).toBe(0)
  })
})

describe('turnPlaneClimb —— 拉高量', () => {
  const cfg = DEFAULT_STEER

  /** 【能量劣勢也要帶一點拉高】專案負責人的規則明寫，見 spec §6。 */
  it('能量劣勢時給 climbMin，而且不為零', () => {
    expect(turnPlaneClimb(-5000, cfg)).toBe(cfg.climbMin)
    expect(turnPlaneClimb(0, cfg)).toBe(cfg.climbMin)
    expect(cfg.climbMin).toBeGreaterThan(0)
  })

  it('能量優勢滿了給 climbMax', () => {
    expect(turnPlaneClimb(cfg.energyFull, cfg)).toBe(cfg.climbMax)
    expect(turnPlaneClimb(cfg.energyFull * 10, cfg)).toBe(cfg.climbMax)
  })

  it('中間線性連續，沒有跳階', () => {
    expect(turnPlaneClimb(cfg.energyFull / 2, cfg))
      .toBeCloseTo((cfg.climbMin + cfg.climbMax) / 2, 12)
    // 門檻上下相鄰取樣不得出現階躍
    const eps = 1e-6
    expect(turnPlaneClimb(eps, cfg) - cfg.climbMin).toBeLessThan(1e-6)
  })

  it('非有限值回 climbMin', () => {
    expect(turnPlaneClimb(NaN, cfg)).toBe(cfg.climbMin)
  })

  /** 設定寫壞時不得產生 NaN —— `0 / 0` 會穿過 `clamp` 出去。 */
  it('energyFull <= 0 退化成 0 處的階梯，不產生 NaN', () => {
    const bad = { ...cfg, energyFull: 0 }
    expect(turnPlaneClimb(100, bad)).toBe(cfg.climbMax)
    expect(turnPlaneClimb(-100, bad)).toBe(cfg.climbMin)
  })
})
```

- [ ] **Step 3: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t turnPlane`
Expected: FAIL，訊息類似 `turnPlaneAngle is not a function` 或 TypeScript 找不到匯出。

- [ ] **Step 4: 加五個設定欄位**

在 `src/ai/steer.ts` 的 `SteerConfig` 介面中，`sweetYieldTime` 之後追加：

```ts
  /**
   * 迴轉平面紀律：方位係數**開始淡入**的角度，rad。方位角小於它時整層無操作。
   *
   * 【方位角是什麼】彈道預瞄點相對**機鼻**的 3D 夾角 —— 「我要轉多少才打得到
   * 他」。不是 `angleOffTail`（那一個問的是「**他**能不能打我」，是防禦），
   * 也不是相對速度向量（機鼻才是槍口指向）。
   *
   * 【60° 的意思】正常追擊（預瞄點在機鼻前方一個小角度內）完全不受影響。
   * 這是消融時最該逐位元相同的區域。
   */
  planeEnter: number
  /**
   * 方位係數**淡到滿**的角度，rad。之後全量生效。
   *
   * 【為什麼不是 180°】180° 是精確的正後方，實務上罕見；120° 已經是「要轉
   * 一大圈」的態勢。設在 180° 等於這一層幾乎不生效。
   */
  planeFull: number
  /**
   * 能量**劣勢**時的拉高量，rad。乘上方位係數與 `pullCeiling` 之後加到航跡角。
   *
   * 【為什麼不為零】專案負責人的規則明寫「能量比他低時也要帶一點拉高機鼻」
   * —— 轉彎本來就會掉能量，補一點高度回來。它的下限是 0（掃描得到），但
   * 預設不為零。
   */
  climbMin: number
  /**
   * 能量**優勢**時的拉高量，rad。
   *
   * **這個欄位是整層的消融開關：`climbMax <= 0` 時 `applyTurnPlane` 立刻
   * 早退，兩個效果（拉高偏置與航跡角下限）一起關掉，行為逐位元退回改動前。**
   *
   * 【訂太大會變成強迫爬升】拉高會掉速度，而 `pullCeiling` 只在速度**已經**
   * 低的時候才節流 —— 它是事後的。掃描時要看 `cornerRatio` 的分布有沒有整體
   * 下移。
   */
  climbMax: number
  /**
   * 拉高量到達 `climbMax` 所需的比能量差，m。
   *
   * 【為什麼用 `energyAdvantage` 而不是新開一個判準】它有一個已知弱點 ——
   * **把高度與速度視為等價**，所以「我能量比他高」可能其實是「我比他快但比
   * 他低」。速度那一半由 `sit.pullCeiling` 節流（拉高量會乘上它），不新增
   * 第三個量。
   */
  energyFull: number
```

在 `DEFAULT_STEER` 中，`sweetYieldTime: PROJECTILE_LIFETIME,` 之後追加：

```ts
  planeEnter: 60 * (Math.PI / 180),
  planeFull: 120 * (Math.PI / 180),
  climbMin: 3 * (Math.PI / 180),
  climbMax: 8 * (Math.PI / 180),
  energyFull: 500,
```

- [ ] **Step 5: 寫三個純函數**

在 `src/ai/steer.ts` 的 `sweetYield` 函式**之後**、`clampUnit` 之前插入：

```ts
/** 迴轉平面紀律的暫存向量 */
const P = makeScratch(1)

/**
 * 彈道預瞄點相對**機鼻**的 3D 夾角，rad。正前方 0、正後方 π。
 *
 * 這是「我要轉多少才打得到他」——與 `sit.aspectAngle` / `angleOffTail`
 * （「**他**能不能打我」，防禦用）是兩個不同的問題。
 *
 * @param leadPoint `EngageBasis.leadPoint`，由我到預瞄點的向量（非單位向量）
 */
export function turnPlaneAngle(self: Aircraft, leadPoint: Vector3): number {
  const len = leadPoint.length()
  // 【重合時方位沒有定義】回 0 讓方位係數也是 0，整層無操作
  if (!(len > 1e-6)) return 0
  const nose = P.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
  return Math.acos(clampUnit(leadPoint.dot(nose) / len))
}

/**
 * 方位係數，0..1。`planeEnter` 以下嚴格是 0、`planeFull` 以上是 1。
 *
 * 【為什麼是 smoothstep 而不是門檻】方位角在門檻附近會震盪，離散門檻會讓
 * 偏置在 0 與滿值之間跳、機首跟著抖。這個專案已經為了同一件事把 `energyPull`、
 * `sweetYield`、編隊收攏、`extendTurnFade` 連續化過。
 */
export function turnPlaneWeight(angle: number, cfg: SteerConfig = DEFAULT_STEER): number {
  // 【非有限值回 0】NaN 與任何數比都是 false，會穿過 clamp 出去汙染 aimWorld
  if (!Number.isFinite(angle)) return 0
  return smoothstep(cfg.planeEnter, cfg.planeFull, angle)
}

/**
 * 拉高量，rad。值域 `[climbMin, climbMax]`，由比能量差線性內插。
 *
 * 【方向由這裡定、幅度由 `pullCeiling` 定】呼叫端會再乘上 `sit.pullCeiling`
 * —— `energyAdvantage` 把高度與速度視為等價，速度那一半交給既有的節流層。
 */
export function turnPlaneClimb(
  energyAdvantage: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  if (!Number.isFinite(energyAdvantage)) return cfg.climbMin
  // 【`energyFull <= 0` 是數學上的極限而不是失效】0 / 0 會穿過 clamp 變成
  // NaN，所以要明寫這一支：尺度為 0 等於「有一點優勢就給滿」
  if (!(cfg.energyFull > 0)) return energyAdvantage > 0 ? cfg.climbMax : cfg.climbMin
  return lerp(cfg.climbMin, cfg.climbMax, clamp(energyAdvantage / cfg.energyFull, 0, 1))
}
```

- [ ] **Step 6: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts -t turnPlane`
Expected: PASS（19 條）。

- [ ] **Step 7: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 8: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat(ai): 迴轉平面紀律的三個純函數與五個設定欄位"
```

---

### Task 2: `raiseTowardLevel` 與 `applyTurnPlane` 整層

**Files:**
- Modify: `src/ai/steer.ts`（接在 Task 1 的三個函式之後）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `turnPlaneAngle(self, leadPoint)`、`turnPlaneWeight(angle, cfg?)`、`turnPlaneClimb(energyAdvantage, cfg?)`；既有的 `applyPitchBias(deltaPitch, aim)`、`sweetYield(interceptTime, cfg?)`
- Produces:
  - `raiseTowardLevel(weight: number, aim: Vector3): void` —— 就地修改
  - `applyTurnPlane(self: Aircraft, intent: Intent, sit: Situation, basis: EngageBasis, aim: Vector3, cfg?: SteerConfig): void` —— 就地修改

- [ ] **Step 1: 寫失敗的測試**

先把 Task 2 的兩個新符號與兩個型別加進 import。`from '../../src/ai/steer'` 那一組補上 `raiseTowardLevel, applyTurnPlane, type EngageBasis`，並在下方新增：

```ts
import type { Situation } from '../../src/ai/assess'
import type { Intent } from '../../src/ai/rules'
```

然後在檔案最後追加：

```ts
describe('raiseTowardLevel —— 軟性的航跡角下限 0', () => {
  const pitchOf = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z))
  const bearingOf = (v: Vector3) => Math.atan2(v.x, v.z)

  /** 朝下 `deg` 度、水平方位偏 +30° 的單位向量 */
  function diving(deg: number): Vector3 {
    const p = -deg * DEG
    const b = 30 * DEG
    return new Vector3(
      Math.sin(b) * Math.cos(p), Math.sin(p), Math.cos(b) * Math.cos(p),
    )
  }

  it('權重 1 時把航跡角拉到 0，水平方位不變', () => {
    const aim = diving(30)
    const before = bearingOf(aim)
    raiseTowardLevel(1, aim)
    expect(pitchOf(aim)).toBeCloseTo(0, 9)
    expect(bearingOf(aim)).toBeCloseTo(before, 9)
    expect(aim.length()).toBeCloseTo(1, 9)
  })

  /** 【這就是 spec §3.2 的「下限本身也乘上方位係數」】方位差小時不介入。 */
  it('權重 0.5 時只拉一半', () => {
    const aim = diving(30)
    raiseTowardLevel(0.5, aim)
    expect(pitchOf(aim)).toBeCloseTo(-15 * DEG, 9)
  })

  it('權重 0 時逐位元不動', () => {
    const aim = diving(30)
    const copy = aim.clone()
    raiseTowardLevel(0, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  /** 【只抬不壓】這是它能疊在任何東西上的前提，與 `applyFloor` 同一條紀律。 */
  it('已經在爬升時逐位元不動', () => {
    const aim = new Vector3(0, Math.sin(20 * DEG), -Math.cos(20 * DEG))
    const copy = aim.clone()
    raiseTowardLevel(1, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  /**
   * 【鉛直朝下時放棄】方位沒有定義。與 `applyPitchBias` 走同一條退化路徑
   * （它只是偏好），撞地那一條由後面的 `applyFloor` 接手 —— 那一層非動不可。
   */
  it('鉛直朝下時放棄，不產生 NaN', () => {
    const aim = new Vector3(0, -1, 0)
    raiseTowardLevel(1, aim)
    expect(aim.y).toBe(-1)
    expect(Number.isNaN(aim.x + aim.y + aim.z)).toBe(false)
  })
})

describe('applyTurnPlane —— 整層的豁免與消融', () => {
  const pitchOf = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z))

  /** 機首朝 −Z、平飛的自機 */
  function nosed(): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    return a
  }

  /**
   * 預瞄點在**後下方**、與機鼻夾角 150°，瞄準點朝下 30° —— 本層該全量生效。
   *
   * 【為什麼是 sin30/cos30 而不是 sin60/cos60】機鼻是 −Z，所以方向
   * `(0, −sin30°, cos30°)` 與機鼻的點積是 `−cos30°`，夾角 150°。用 60° 那一組
   * 算出來是 **120°**，剛好壓在 `planeFull` 的邊界上 —— 能過，但一個貼著邊界
   * 的前提在門檻再動時會沉默地失效。
   */
  function rearLow(): { sit: Situation, basis: EngageBasis, aim: Vector3 } {
    const sit = createSituation()
    sit.energyAdvantage = 0
    sit.pullCeiling = 1
    const basis = createEngageBasis()
    // 機首朝 −Z；預瞄點朝 +Z 偏下 → 與機鼻夾角 150°
    basis.leadPoint.set(0, -Math.sin(30 * DEG), Math.cos(30 * DEG)).multiplyScalar(900)
    // 打不到 → 不豁免
    basis.interceptTime = DEFAULT_STEER.sweetYieldTime * 3
    const aim = new Vector3(0, -Math.sin(30 * DEG), -Math.cos(30 * DEG))
    return { sit, basis, aim }
  }

  it('全量生效時航跡角不再為負', () => {
    const { sit, basis, aim } = rearLow()
    applyTurnPlane(nosed(), 'engage', sit, basis, aim)
    expect(pitchOf(aim)).toBeGreaterThan(0)
    expect(aim.length()).toBeCloseTo(1, 9)
  })

  it('能量優勢越大拉得越高，而且單調', () => {
    const climb = (ea: number) => {
      const { sit, basis, aim } = rearLow()
      sit.energyAdvantage = ea
      applyTurnPlane(nosed(), 'engage', sit, basis, aim)
      return pitchOf(aim)
    }
    expect(climb(1000)).toBeGreaterThan(climb(250))
    expect(climb(250)).toBeGreaterThan(climb(-1000))
  })

  /**
   * 【spec §7 要特別確認的第一格：後方 × 明顯劣勢】拉高的同時速度可能已經很
   * 低。`pullCeiling` 必須真的在節流 —— 這一條就是守它。
   */
  it('pullCeiling 見底時拉高偏置趨近 0，但下限仍在', () => {
    const { sit, basis, aim } = rearLow()
    sit.pullCeiling = 0
    applyTurnPlane(nosed(), 'engage', sit, basis, aim)
    // 拉高沒了，但「不准壓低」那一半照舊
    expect(pitchOf(aim)).toBeCloseTo(0, 9)
  })

  /** 【消融開關】climbMax <= 0 時整層無操作。 */
  it('climbMax = 0 時逐位元不動', () => {
    const { sit, basis, aim } = rearLow()
    const copy = aim.clone()
    applyTurnPlane(nosed(), 'engage', sit, basis, aim, { ...DEFAULT_STEER, climbMax: 0 })
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  /**
   * 【extend 完全豁免】`extendPitchAngle` 在速度見底時給滿 −25° 俯衝，那是
   * 低頭換速度、是脫離的核心手段，而脫離時方位差幾乎必然很大（背對敵人）。
   * 不豁免等於把換速度的能力關掉。見 spec §4.1。
   */
  it('extend 逐位元不動', () => {
    const { sit, basis, aim } = rearLow()
    const copy = aim.clone()
    applyTurnPlane(nosed(), 'extend', sit, basis, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  it('rally 逐位元不動', () => {
    const { sit, basis, aim } = rearLow()
    const copy = aim.clone()
    applyTurnPlane(nosed(), 'rally', sit, basis, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  /** 【扳機優先】預瞄環亮著時完全讓位，判準與 `sweetYield` 共用。 */
  it('打得到時逐位元不動', () => {
    const { sit, basis, aim } = rearLow()
    basis.interceptTime = DEFAULT_STEER.sweetYieldTime / 2
    const copy = aim.clone()
    applyTurnPlane(nosed(), 'engage', sit, basis, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })

  /**
   * 【防禦永遠優先】專案負責人裁定 `defend` ＞ 射擊解 ＞ 限制。而拉高那一半
   * 讓給既有的 `defendPitchBias`（疊加的效果沒有量過），見 spec §4.3。
   */
  it('defend 不因射擊解豁免，而且只有下限沒有拉高', () => {
    const { sit, basis, aim } = rearLow()
    basis.interceptTime = DEFAULT_STEER.sweetYieldTime / 2
    sit.energyAdvantage = 5000
    applyTurnPlane(nosed(), 'defend', sit, basis, aim)
    // 限制生效：不再朝下
    expect(pitchOf(aim)).toBeCloseTo(0, 9)
  })

  /** 【正前方完全不介入】覆蓋度表的第一列，消融時最該逐位元相同的區域。 */
  it('預瞄點在正前方時逐位元不動', () => {
    const { sit, basis, aim } = rearLow()
    basis.leadPoint.set(0, 0, -900)
    const copy = aim.clone()
    applyTurnPlane(nosed(), 'engage', sit, basis, aim)
    expect(aim.x).toBe(copy.x)
    expect(aim.y).toBe(copy.y)
    expect(aim.z).toBe(copy.z)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "raiseTowardLevel|applyTurnPlane"`
Expected: FAIL，`raiseTowardLevel is not a function`。

- [ ] **Step 3: 實作兩個函式**

在 `src/ai/steer.ts` 的 `turnPlaneClimb` 之後插入：

```ts
/**
 * 把**負的**航跡角往水平拉 `weight` 的比例，水平方位不變。就地修改。
 *
 * `weight = 1` 等於「航跡角下限 0」、`weight = 0` 逐位元不動，中間連續 ——
 * 這正是 spec §3.2 的「下限本身也乘上方位係數」。
 *
 * 【為什麼不是 `applyFloor(self, 0, aim)`】那一層的 `minPitch <= 0` 直接
 * return（高空無操作是它能無條件疊加的前提），而且它沒有權重的概念。
 *
 * 【只抬不壓】已經在爬升時逐位元不動，所以可以疊在任何東西上。
 *
 * 假設 `aim` 是單位向量。
 */
export function raiseTowardLevel(weight: number, aim: Vector3): void {
  if (!(weight > 0)) return
  if (aim.y >= 0) return
  const horiz = Math.hypot(aim.x, aim.z)
  // 【鉛直朝下：方位沒有定義】與 `applyPitchBias` 走同一條退化路徑 —— 這一層
  // 只是偏好，放棄是安全的；撞地那一條由後面的 `applyFloor` 接手
  if (horiz < 1e-9) return
  const next = weight >= 1 ? 0 : Math.atan2(aim.y, horiz) * (1 - weight)
  const scale = Math.cos(next) / horiz
  aim.set(aim.x * scale, Math.sin(next), aim.z * scale)
}

/**
 * 迴轉平面的紀律：方位差大時**不准把航跡角壓成負的**，並依能量優勢帶一點
 * 拉高。就地修改 `aim`，**水平方位一格不動**。
 *
 * 這是 `steerCommand` 後處理鏈的第三層，排在 `applyPitchBias` 之後、
 * `applyFloor` 之前（spec §5.1）。兩個效果共用同一個方位係數，所以能量剛好
 * 持平時偏置自然落在中間，沒有任何一刻跳變。
 *
 * 【它修的是「AI 主動選擇往下轉」】人工回報：109 交會之後持續瞄準往下繞了
 * 一圈掉頭，拉平後能量不夠只好脫離。史實上交會之後追不上就別追 —— 有能量
 * 拉高脫離、沒能量水平緊轉，**兩種都不往下**。
 *
 * 【它不修「不該跟著繞」】那個追擊判斷本身目前沒有好答案（spec §9.1 的前瞻
 * 判準實測否決）。AI 一樣會繞，只是繞的時候不再往下掉。
 */
export function applyTurnPlane(
  self: Aircraft,
  intent: Intent,
  sit: Situation,
  basis: EngageBasis,
  aim: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // 【消融開關】兩個效果一起關掉，行為逐位元退回改動前
  if (!(cfg.climbMax > 0)) return
  // 【extend 完全豁免】`extendPitchAngle` 在速度見底時給滿俯衝，那是低頭換
  // 速度、是脫離的核心手段，而脫離時方位差幾乎必然很大（背對敵人）。不豁免
  // 等於把換速度的能力關掉，比原本的問題嚴重得多（spec §4.1）。
  //
  // 【rally 不套】指揮層的位階比戰術偏好高，與 `applyPitchBias` 同一條紀律。
  if (intent === 'extend' || intent === 'rally') return

  // 【射擊解讓位，判準複用 `sweetYield`】`interceptTime <= PROJECTILE_LIFETIME`
  // 已經同時是三件事：HUD 畫預瞄環、`shouldFire` 允許開火、甜蜜區讓位。
  // 不新增第四套尺度。
  //
  // 【為什麼 defend 不讓位】與甜蜜區那一層同一個理由：`basis` 永遠對**攻擊
  // 目標**建立，而 `defend` 是對**威脅來源**做的，兩者可以是不同的飛機。
  // 而且專案負責人裁定「防禦永遠優先」。
  const yieldFactor = intent === 'defend' ? 1 : sweetYield(basis.interceptTime, cfg)
  const weight = turnPlaneWeight(turnPlaneAngle(self, basis.leadPoint), cfg) * yieldFactor
  if (!(weight > 0)) return

  // 【下限先於拉高，順序不能反】反過來的話拉高量會被下限吃掉：−30° 的航跡角
  // 加 8° 還是負的，下限再把它拉成 0 —— 那八度就這樣消失了，而且「能量越高
  // 拉得越高」在任何俯衝態勢下都量不出來。先拉平、再往上加。
  raiseTowardLevel(weight, aim)

  // 【defend 只要下限那一半】`defendPitchBias` 已經在管破防時的俯仰，兩者
  // 疊加的效果沒有量過。先保留「不准壓低」，把「拉多少」留給那一層（spec §4.3）。
  if (intent !== 'defend') {
    applyPitchBias(turnPlaneClimb(sit.energyAdvantage, cfg) * weight * sit.pullCeiling, aim)
  }
}
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "raiseTowardLevel|applyTurnPlane"`
Expected: PASS（14 條）。

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat(ai): applyTurnPlane —— 方位差大時不准壓低航跡角"
```

---

### Task 3: 接進 `steerCommand`

**Files:**
- Modify: `src/ai/steer.ts:1824` 附近（`applyPitchBias` 區塊與 `applyFloor` 區塊之間）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `applyTurnPlane(self, intent, sit, basis, aim, cfg?)`
- Produces: `steerCommand` 的行為改變。**簽名不動**、`AiController` 不動。

- [ ] **Step 1: 寫失敗的整合測試**

在 `test/unit/ai-steer.test.ts` 追加：

```ts
/**
 * 迴轉平面紀律在 `steerCommand` 這一層的行為。spec §5.1 的第三層。
 *
 * 【與 `applyTurnPlane` 的單元測試分工】那一組驗的是「這個函式自己對不對」，
 * 這一組驗的是「它在鏈上的位置對不對」——順序、豁免、與相鄰兩層的互動。
 */
describe('steerCommand：迴轉平面的紀律', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const cmd = createCommand()
  const k: Knobs = { leadLag: 0, vertical: 0 }
  let self: Aircraft
  let target: Aircraft

  const pitchOf = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z))
  const bearingOf = (v: Vector3) => Math.atan2(v.x, v.z)

  /**
   * 人工回報那個態勢的最小重現：自機平飛朝 −Z、目標在**後下方** 900 m
   * 且正在遠離 —— 「他從下方穿越到後下方」之後的那一刻。
   */
  const rearLowScene = () => {
    self = flyer()
    target = flyer()
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 3400, 780], [0, 0, 200])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 5
    sit.cornerRatio = 1
    sit.pullCeiling = 1
    sit.sweetPitch = 0
    engageKnobs(sit, k)
  }

  /** 正常追擊：目標在正前方 800 m 同速同高 */
  const tailChaseScene = () => {
    self = flyer()
    target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -800], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 5
    sit.cornerRatio = 1
    sit.pullCeiling = 1
    sit.sweetPitch = 0
    engageKnobs(sit, k)
  }

  const run = (intent: Intent, cfg = DEFAULT_STEER) => {
    steerCommand(intent, 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd, cfg)
    return cmd.aimWorld.clone()
  }

  /** 【主判準對應物】方位差大時命令的航跡角不得為負。 */
  it('後下方的目標：命令不再壓低航跡角', () => {
    rearLowScene()
    const off = run('engage', { ...DEFAULT_STEER, climbMax: 0 })
    const on = run('engage')
    expect(pitchOf(off)).toBeLessThan(0)
    expect(pitchOf(on)).toBeGreaterThanOrEqual(0)
  })

  /** 【不變式二：每一層只能動一個東西】本層只准動航跡角。 */
  it('水平方位一格不動', () => {
    rearLowScene()
    const off = run('engage', { ...DEFAULT_STEER, climbMax: 0 })
    const on = run('engage')
    expect(bearingOf(on)).toBeCloseTo(bearingOf(off), 9)
    expect(on.length()).toBeCloseTo(1, 9)
  })

  /**
   * 【覆蓋度表「正前 × 任何能量」那一列】正常追擊必須逐位元不受影響 ——
   * 這一格保證了這一層不會偷偷改掉既有的攻擊行為。
   */
  it('正前方追擊逐位元不變，能量差再大也一樣', () => {
    tailChaseScene()
    for (const ea of [-3000, 0, 3000]) {
      sit.energyAdvantage = ea
      const off = run('engage', { ...DEFAULT_STEER, climbMax: 0 })
      const on = run('engage')
      expect(on.x).toBe(off.x)
      expect(on.y).toBe(off.y)
      expect(on.z).toBe(off.z)
    }
  })

  /**
   * 【它證明的是早退沒有副作用，不是「等同改動前」】兩條互相獨立的「整層
   * 無操作」路徑必須給出一模一樣的位元：`climbMax: 0` 走早退，
   * `planeEnter/planeFull` 推到天上則走完整條路徑但權重為 0。
   *
   * **這一條抓不到「新呼叫點本身改變了行為」** —— 兩邊都跑同一份接好線的
   * `steerCommand`。那一半由 Task 4 Step 3 負責：`TP='{"climbMax":0}'` 跑
   * 探針必須逐字重現改動前的主判準數字，那才是真正的跨版本對照。
   */
  it('climbMax = 0 與權重恆 0 逐位元相同', () => {
    rearLowScene()
    const ablated = run('engage', { ...DEFAULT_STEER, climbMax: 0 })
    const zeroWeight = run('engage', {
      ...DEFAULT_STEER, planeEnter: 1e9, planeFull: 1e9 + 1,
    })
    expect(ablated.x).toBe(zeroWeight.x)
    expect(ablated.y).toBe(zeroWeight.y)
    expect(ablated.z).toBe(zeroWeight.z)
  })

  /** 【spec §4.1】脫離時方位差必然很大，豁免掉才留得住「低頭換速度」。 */
  it('extend 逐位元不變', () => {
    rearLowScene()
    sit.cornerRatio = 0.7
    sit.speedAdvantage = -0.3
    const off = run('extend', { ...DEFAULT_STEER, climbMax: 0 })
    const on = run('extend')
    expect(on.x).toBe(off.x)
    expect(on.y).toBe(off.y)
    expect(on.z).toBe(off.z)
    // 而且它確實還在俯衝 —— 換速度的能力沒有被關掉
    expect(pitchOf(on)).toBeLessThan(0)
  })

  /**
   * 【spec §10 風險三：與 sweetPitch 疊加】順序上 `sweetPitch` 在前，所以
   * 本層看到的是已經偏過的值，「不得為負」對兩者的**合計**生效。
   */
  it('甜蜜區把航跡角壓下去之後，下限對合計生效', () => {
    rearLowScene()
    sit.sweetPitch = -25 * DEG
    const off = run('engage', { ...DEFAULT_STEER, climbMax: 0 })
    const on = run('engage')
    expect(pitchOf(off)).toBeLessThan(-20 * DEG)
    expect(pitchOf(on)).toBeGreaterThanOrEqual(0)
  })

  /**
   * 【不變式一：安全層永遠最後】撞地底限必須有最後決定權。本層只抬不壓，
   * 兩者同向，所以驗的是底限仍然贏得了 —— 抬得比本層更多。
   */
  it('撞地底限仍然是最後一個說話的', () => {
    rearLowScene()
    steerCommand(
      'engage', 'normal', sit, basis, self, self.state.position.y - 50,
      k, createDefendState(), null, cmd,
    )
    expect(pitchOf(cmd.aimWorld)).toBeCloseTo(floorPitchAngle(50), 9)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "迴轉平面的紀律"`
Expected: FAIL —— `後下方的目標：命令不再壓低航跡角` 那一條會紅（`pitchOf(on)` 仍然是負的），因為層還沒接上。

- [ ] **Step 3: 接線**

在 `src/ai/steer.ts` 的 `applyPitchBias` 區塊（`if (intent !== 'rally') { ... }`）與 `applyFloor` 那一行之間插入：

```ts
  // ── 迴轉平面的紀律：方位差大時不准壓低航跡角，方位不動 ──
  // 【它在回答一個沒有人回答的問題】現在的架構回答了「做什麼」（意圖）與
  // 「瞄哪裡」（瞄準解），**沒有人回答「往哪個面轉」**。所以 `engage` 一路
  // 追預瞄點，而預瞄點在目標往下往後跑的時候會把 AI 整個帶著繞下去 ——
  // 人工回報：109 交會之後向下繞一圈掉頭，掉了 1,093 m。
  //
  // 【為什麼排在甜蜜區之後】兩者都改航跡角。順序上甜蜜區在前，本層看到的
  // 是已經偏過的值，「不得為負」因此對兩者的**合計**生效 —— 那是對的方向。
  //
  // 【為什麼排在撞地底限之前】底限的優先序最高，必須有最後決定權。
  // 見 `applyFloor` 的註解。
  applyTurnPlane(self, intent, sit, basis, out.aimWorld, cfg)
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS（整個檔案，含既有的每一條）。

若既有測試轉紅，**先確認是不是前提被推翻而不是壞掉** —— 場景的方位角是否本來就 > 60°。是的話把那一條的場景改成正前方，或在 `describe` 的 scene 裡把 `basis.interceptTime` 推進開火範圍，並在註解裡寫清楚為什麼。

- [ ] **Step 5: 跑全套單元與整合測試**

Run: `npx vitest run`
Expected: 與改動前相同的紅／綠分布。**任何新增的紅都要當場處理**，不要留到 Task 5。

- [ ] **Step 6: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat(ai): 迴轉平面紀律接進 steerCommand 後處理鏈第三層"
```

---

### Task 4: 主判準的量測（`escort-trace.probe.ts`）

**Files:**
- Modify: `test/tools/escort-trace.probe.ts`

**Interfaces:**
- Consumes: `DEFAULT_STEER`（`src/ai/steer`）
- Produces: stderr 一段主判準摘要；`TP` 環境變數（JSON）覆寫 `DEFAULT_STEER` 的欄位

**為什麼要改探針：** spec §8.1 的三個量（谷底對轟炸機的高度差、峰值到谷底掉的高度、第一段的指令航跡角極值）目前是人工從 JSON 挑出來的。要 A/B 就得能重複跑，而且掃描（Task 5）要跑十幾次。

- [ ] **Step 1: 加環境變數覆寫**

在 `test/tools/escort-trace.probe.ts` 的 import 區塊追加：

```ts
import { DEFAULT_STEER } from '../../src/ai/steer'
```

在 `main()` 呼叫**之前**（檔案尾端 `main()` 那一行上方）插入：

```ts
/**
 * 【設定覆寫】`TP` 是一段 JSON，逐欄蓋掉 `DEFAULT_STEER`。A/B 與掃描都用它：
 *
 *   TP='{"climbMax":0}'   —— 迴轉平面紀律關掉，等於改動前
 *   TP='{"planeEnter":0.785}'  —— 掃描單一參數（rad）
 *
 * 【為什麼直接改 `DEFAULT_STEER`】`AiController` 不帶 `SteerConfig`，走的就是
 * 這個預設物件。探針是一次性的行程，就地改比穿一整條參數鏈誠實。
 */
const override = process.env.TP
if (override !== undefined && override !== '') {
  Object.assign(DEFAULT_STEER, JSON.parse(override) as Partial<typeof DEFAULT_STEER>)
  console.error('TP override: ' + override)
}
```

- [ ] **Step 2: 加主判準摘要**

在 `console.log(JSON.stringify({ ... }))` 那一段**之前**插入：

```ts
  // ── 主判準（spec §8.1）──────────────────────────────────
  //
  // 三個量都是**行為的絕對量測**，不是效率。判準是「玩起來合不合理」——
  // 攻擊效率有沒有提高沒差（專案負責人 2026-08-23 裁定）。
  //
  // 【量測窗必須與結果無關】上面那個事件窗的條件是「曾掉到轟炸機下方 400 m」
  // —— 而那正是這一輪要修掉的東西。沿用它的話，**修好之後窗就框不出來、
  // 摘要變成空的**，成功反而讀不到數字。這裡改用**交會**當錨點：目標距離
  // 第一次進到 600 m 以內。那件事不論修得成不成功都會發生。
  const MERGE_RANGE = 600
  const LEAD_IN = 10
  const SPAN = 40
  // 坡度低於這個值算「機翼接近水平」。第一段要量的是**平飛時主動壓了多少
  // 機頭**，把已經明顯滾轉的取樣算進來就會混進第二段的「大坡度撐不住」。
  const BANK_LEVEL = 10

  let mergeAt = -1
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!
    if (s.tr > 0 && s.tr < MERGE_RANGE) { mergeAt = i; break }
  }
  if (mergeAt < 0) {
    console.error('主判準  這一場沒有交會（目標距離從未進到 ' + MERGE_RANGE + ' m）')
  } else {
    const lo = Math.max(0, mergeAt - Math.round(LEAD_IN / STEP))
    const hi = Math.min(out.length - 1, mergeAt + Math.round(SPAN / STEP))
    const win = out.slice(lo, hi + 1)

    // 谷底 = 窗內高度最低的取樣
    let trough = win[0]!
    for (const s of win) if (s.y < trough.y) trough = s
    // 峰值 = 谷底**之前**高度最高的取樣
    let peak = win[0]!
    for (const s of win) {
      if (s.t >= trough.t) break
      if (s.y > peak.y) peak = s
    }
    // 第一段 = 峰值之後、坡度首次超過 BANK_LEVEL 之前
    let dive = 0
    for (const s of win) {
      if (s.t < peak.t) continue
      if (Math.abs(s.bk) > BANK_LEVEL) break
      if (s.cmd < dive) dive = s.cmd
    }
    // 【`by` 可能是 NaN】被護送單位全滅時沒有平均高度可言
    const gap = Number.isFinite(trough.by) ? (trough.y - trough.by).toFixed(0) : 'n/a'
    console.error(
      '主判準  谷底對轟炸機 ' + gap + ' m'
      + '  |  峰值→谷底 ' + (peak.y - trough.y).toFixed(0) + ' m'
      + '  |  第一段指令 γ 極值 ' + dive.toFixed(1) + '°'
      + '  |  谷底 ' + trough.y.toFixed(0) + ' m @ ' + trough.t.toFixed(1) + ' s'
      + '  |  交會 @ ' + out[mergeAt]!.t.toFixed(1) + ' s',
    )
  }
```

- [ ] **Step 3: 量改動前的基準**

**用 Bash 跑**，環境變數只作用於那一行：

Run: `TP='{"climbMax":0}' npx vite-node test/tools/escort-trace.probe.ts > /dev/null`

（若改用 PowerShell，`$env:TP` 會**留在整個工作階段**，下一步的「改動後」會沉默地跑到消融版本。務必在下一步之前 `Remove-Item Env:TP -ErrorAction SilentlyContinue`。這是一個查不出來的錯 —— 兩次量到一模一樣的數字，而且看起來完全正常。）

Expected: stderr 印出四個數字。**谷底對轟炸機應該重現 spec §8.1 的 −401 m 上下、峰值→谷底 1093 m 上下** —— 那兩個量與分段定義無關，是窗內的極值。

【第一段指令 γ 極值沒有可對照的舊值】spec §8.1 的 −28.7° 是那張 4 秒一列的表**取樣到的一格**，不是整段的極值（真正的極值更負）。這一步量到多少就是新基準，**記下來**，Task 5 回填 spec 時要順手把 §8.1 那一欄改成「取樣值，非極值」。

若前兩個量對不上，**先停手查為什麼**：這條路徑是 `climbMax: 0` 早退，行為應該逐位元等同改動前。對不上表示接線洩漏了副作用（回 Task 3 Step 4 的消融測試）。

- [ ] **Step 4: 量改動後**

Run: `npx vite-node test/tools/escort-trace.probe.ts > /dev/null`
（先確認 `TP` 沒有殘留：`echo "TP=[$TP]"` 應該印出 `TP=[]`）

Expected: **谷底對轟炸機不得為負**；峰值→谷底明顯減少；第一段指令 γ 極值相對 Step 3 的新基準顯著收斂。

把兩次的數字記下來，Task 5 要寫進 spec §8。

若第一段指令 γ 極值**沒有**收斂：表示這一層在那個態勢下沒生效。用 `TP='{"planeEnter":0.52,"planeFull":1.57}'`（30°/90°）再量一次確認是不是方位角一直落在 60° 以下 —— 若是，那不是 bug 而是「第一段的方位差其實不大」，要回頭跟專案負責人確認 spec §2.1 的定義。**不要自己把門檻一路調低來湊數字。**

- [ ] **Step 5: Commit**

```bash
git add test/tools/escort-trace.probe.ts
git commit -m "test: escort-trace 加主判準摘要與 TP 設定覆寫"
```

---

### Task 5: 硬否決回歸、參數掃描、回填 spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-23-turn-plane-discipline-design.md`（§6 與 §8）
- Modify: `src/ai/steer.ts`（掃描結果若指向不同的定值，改 `DEFAULT_STEER` 並把掃描表寫進欄位註解）

**Interfaces:**
- Consumes: Task 4 的 `TP` 覆寫與 stderr 摘要
- Produces: 定案的五個參數值、spec §6／§8 的實測回填

- [ ] **Step 1: 跑硬否決那一組**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts test/integration/ai-visible-evasion.test.ts test/integration/ai-defence.test.ts test/integration/ai-duel-matrix.test.ts test/integration/ai-safety-matrix.test.ts test/integration/low-speed-authority.test.ts`

Expected（spec §8.2）：
- `ai-manoeuvre`、`ai-visible-evasion`、`ai-defence` **不得新增紅**
- `ai-duel-matrix` 的 1v1 **必須仍然打得起來**（`redDamage > 0`）—— 這一條在 `extendTurnCap` 那一輪抓到過「雙方繞圈互不接觸」
- `belowStall`、`safetyShare` 不得惡化

**先跑 `git stash` 前的基準做對照**：用 `TP` 關不掉整合測試（它們不讀環境變數），所以基準的取法是暫時把 `DEFAULT_STEER.climbMax` 改成 `0` 跑一次、記下數字、再改回來。這比 `git stash` 可靠 —— 消融路徑已經被測試釘死是逐位元等價的。

- [ ] **Step 2: 掃描三個關鍵參數**

每一組跑一次探針，記三個主判準。掃描範圍照 spec §6：

```bash
for v in 0.785 1.047 1.571; do TP="{\"planeEnter\":$v}" npx vite-node test/tools/escort-trace.probe.ts > /dev/null; done
for v in 1.571 2.094 2.618; do TP="{\"planeFull\":$v}" npx vite-node test/tools/escort-trace.probe.ts > /dev/null; done
for v in 0.0873 0.1396 0.2094; do TP="{\"climbMax\":$v}" npx vite-node test/tools/escort-trace.probe.ts > /dev/null; done
```

（`planeEnter` 45/60/90° = 0.785/1.047/1.571；`planeFull` 90/120/150° = 1.571/2.094/2.618；`climbMax` 5/8/12° = 0.0873/0.1396/0.2094）

**`climbMax` 那一組要額外看 `cornerRatio` 的分布有沒有整體下移**（spec §10 風險四：拉高會掉速度）。從 JSON 取 `cr` 欄位算中位數：

```bash
TP='{"climbMax":0.2094}' npx vite-node test/tools/escort-trace.probe.ts 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).samples.map(x=>x.cr).sort((p,q)=>p-q);console.log('cornerRatio p50',a[a.length>>1].toFixed(3))})"
```

- [ ] **Step 3: 裁定定值**

**判準只有一條：行為的絕對量測（spec §8.1 三項）＋ 硬否決不破線。** 不得拿 `fireShare` / `redDamage` 的**大小**當取捨依據 ——`redDamage > 0` 是一條門檻（打得起來），不是一個要最大化的量。

若掃描表沒有明顯的最佳點（很可能，`extendTurnCap` 那一輪就是這樣），**取 spec §6 的起始值**並把掃描表寫進 `SteerConfig` 對應欄位的註解，標明「待人工試飛定案」。

若定值有改，同步更新 `DEFAULT_STEER`。

- [ ] **Step 4: 回填 spec**

在 `docs/superpowers/specs/2026-08-23-turn-plane-discipline-design.md` 的 §6 參數表下方追加掃描結果，格式照專案既有的做法（見 `SteerConfig.extendTurnCap` 的掃描表）：一張表、每一列一個值、欄位是三個主判準，再加一段文字說明為什麼取這個值。

在 §8.1 的表格「目標」欄旁邊追加「實測」欄，填 Task 4 Step 4 的數字。

在 §10 風險五下方追加一行實測結論：這一版做完之後，AI 在同一個場景還會不會跟著繞（看 JSON 的 `bk` 有沒有仍然出現 60° 以上的長段），以及第二段「撐不住」還剩多少 —— 那是 §9.2 指揮儀轉彎補償要不要動的依據。

- [ ] **Step 5: 跑全套回歸**

Run: `npx vitest run`
Expected: 與 Task 3 Step 5 相同的紅／綠分布，沒有新增的紅。

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts docs/superpowers/specs/2026-08-23-turn-plane-discipline-design.md
git commit -m "docs: 迴轉平面紀律的掃描結果與主判準實測回填"
```

- [ ] **Step 7: 交專案負責人試飛**

最終判準是人工試飛（spec §8.4）：在護送關看 AI 交會之後的動作像不像那麼回事。

回報時**必須說清楚這一版只修一半**（spec §10 風險五）：AI 一樣會跟著繞，只是繞的時候不再往下掉。「不該跟著繞」那個追擊判斷本身目前沒有好答案（§9.1 的前瞻判準實測否決），不要當成整件事解決了。

---

## 自我檢查

**1. spec 覆蓋度**

| spec 章節 | 對應 |
|---|---|
| §2.1 方位維度（預瞄點相對機鼻的 3D 夾角） | Task 1 `turnPlaneAngle` |
| §2.2 能量維度（方向 `energyAdvantage`、幅度 `pullCeiling`） | Task 1 `turnPlaneClimb` + Task 2 呼叫端乘 `pullCeiling` |
| §3.1 連續形式（四行算式） | Task 1 + Task 2 `applyTurnPlane` |
| §3.2 「不允許壓低」= 航跡角下限、下限乘方位係數 | Task 2 `raiseTowardLevel` |
| §4 三條豁免與優先序 | Task 2 `applyTurnPlane` 的早退與 `yieldFactor` |
| §4.3 `defend` 只要下限不要拉高 | Task 2 `intent !== 'defend'` 那一支 |
| §5.1 後處理鏈第三層的位置 | Task 3 接線點 |
| §5.2 三條不變式 | Task 3 的「水平方位一格不動」「撞地底限最後」「rally 逐位元不動」三條測試 |
| §6 五個參數與消融開關 | Task 1 欄位、Task 2 早退、Task 5 掃描 |
| §7 覆蓋度交叉表要特別確認的三格 | 後方×劣勢 → Task 2 `pullCeiling` 見底那條；側向×持平 → Task 1 `turnPlaneWeight` 單調性；正前×任何能量 → Task 3 逐位元不變 |
| §8.1 主判準三個量 | Task 4 stderr 摘要 |
| §8.2 硬否決 | Task 5 Step 1 |
| §8.4 人工試飛 | Task 5 Step 7 |
| §10 風險一（門檻震盪） | `smoothstep`（Task 1）＋單調性測試 |
| §10 風險二（擋掉合理俯衝） | Task 3「正前方追擊逐位元不變」＋ Task 2「打得到時逐位元不動」 |
| §10 風險三（與 sweetPitch 疊加） | Task 3「下限對合計生效」 |
| §10 風險四（climbMax 太大） | Task 5 Step 2 的 `cornerRatio` p50 |
| §10 風險五（只修一半） | Task 5 Step 7 的回報要求 |

§9（已否決與已擱置）不需要對應的 Task —— 那一節記的是**不要做什麼**。

**2. 沒有佔位符**：每一個 code step 都有完整可貼上的內容；每一個 run step 都有確切的指令與期望結果；兩個「若對不上怎麼辦」的分支都寫了具體的下一步。

**3. 型別一致**：`turnPlaneAngle` / `turnPlaneWeight` / `turnPlaneClimb` / `raiseTowardLevel` / `applyTurnPlane` 五個名字在 Task 1→2→3 與測試中逐字相同；`planeEnter` / `planeFull` / `climbMin` / `climbMax` / `energyFull` 五個欄位名在介面、預設值、測試、探針覆寫、掃描指令中逐字相同。
