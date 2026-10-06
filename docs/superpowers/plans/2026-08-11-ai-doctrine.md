# AI 能量紀律與機種打法 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 AI 不再為了瞄準把自己的能量拉光，並且讓兩台飛機因為各自的甜蜜區不同而打出看得出來的不同打法。

**Architecture:** 新增 `src/ai/doctrine.ts` 一個純函數模組，提供兩個彼此獨立的量：`energyPull`（絕對，不需要對手，防止拉爆自己）與 `sweetSpotPitch`（相對，需要對手，把航跡角偏向自己佔優的高度／速度）。兩者都以**既有的、方位不變的後處理原語**消費 —— 前者併入 `steerCommand` 既有的 `shrinkTowardNose` 呼叫點，後者是 `applyFloor` 的雙向姊妹函式。不新增意圖、不動 `rules.arbitrate`、不碰飛行模型。

**Tech Stack:** TypeScript、three.js（Vector3／Quaternion）、vitest。無新依賴。

## Global Constraints

以下每一條都直接抄自 spec（`docs/superpowers/specs/2026-08-11-ai-doctrine-design.md`），每個任務都隱含適用：

- **方位絕對不能動。** 任何對 `aimWorld` 的修改只能改航跡角（俯仰），不能改水平方位。舊版違反這條時實測「滾轉指令由 2–3° 暴增到 27–29°、副翼打到滿舵」。
- **不動 `rules.arbitrate`**、**不新增意圖**（`defend | merge | extend | engage | approach | rally` 不變）、**不碰 `src/control/limiters.ts`**（飛行模型與玩家共用，2026-08-11 才刻意拆掉一個夾子）。
- **不使用滾轉率。** 實測三個量的正負號只有 65% 一致，而 P-51 的滾轉在任何速度都贏 —— 合進優勢分數會把 109 的低速優勢洗掉。
- **甜蜜區讓位給指揮，拉桿紀律不讓位。** `intent === 'rally'` 時不套甜蜜區偏移；拉桿紀律必須連 `AiController` 的 `rallyCommand` / `stationCommand` 早退路徑也涵蓋。
- **判準寫成比值**，分母是飛機自己的性能，這樣 `feel.ts` 的倍率一動分母同步跟著走。
- **效能**：`assess` 在 10 Hz、每次兩台。任何逐格求解必須先填表（沿用 `envelope.ts` 的 `bestTurnTable` 作法：WeakMap、首次一次填滿、格間線性內插）。
- 所有新常數的**出貨值由 Task 7 的掃描定值並回填註解**；在那之前用本計畫給的起手值。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/ai/doctrine.ts`（新增） | 兩個純函數 + 甜蜜區的快取表。**不 import 任何 AI 狀態**，只吃 `AircraftSpec` 與純量 |
| `src/ai/assess.ts`（修改） | `Situation` 加兩個欄位，`evaluateEnergy` 算它們 |
| `src/ai/steer.ts`（修改） | 消費兩個量；新增 `applyPitchBias`（`applyFloor` 的雙向姊妹）；`SteerConfig` 加新常數 |
| `src/ai/AiController.ts`（修改） | 早退路徑（rally／station）補上拉桿紀律 |
| `test/unit/doctrine.test.ts`（新增） | 兩個純函數的形狀與邊界 |
| `test/tools/doctrine-visible.probe.ts`（新增） | 副判準：兩機的速度／高度分布是否分開（**套 `GAME_FEEL`**） |

**為什麼兩個單元同一個檔案**：兩者都是「機體對這場仗的偏好」、都是純函數、都只被 `assess`／`steer` 消費，合計約 150 行。專案的 `assess.ts` 有 500+ 行，拆成兩個 50 行的檔案是過度分解。

---

## Task 1：`energyPull` 純函數（拉桿紀律的形狀）

**Files:**
- Create: `src/ai/doctrine.ts`
- Test: `test/unit/doctrine.test.ts`

**Interfaces:**
- Consumes: 無（純數學）
- Produces: `export function energyPull(cornerRatio: number, cfg: DoctrineConfig): number`、`export interface DoctrineConfig`、`export const DEFAULT_DOCTRINE: DoctrineConfig`

**背景（實作者需要知道的）：** `steer.ts` 已經有一個一模一樣形狀的函式 `unloadPull(stallMargin, cfg)` —— 回傳 0..1 的「拉桿係數」，1 = 照原樣拉、0 = 完全鬆桿。消費它的是 `shrinkTowardNose`，把瞄準誤差角按係數縮小而**方位不動**。本任務做的是同一族的第二個：`unloadPull` 防的是失速，`energyPull` 防的是能量見底。

`cornerRatio` 是 `Situation` 既有欄位 = `TAS ÷ 角落速度`。角落速度是「能拉出最大轉彎率的最低速度」；低於它，拉桿只會換到更少的轉彎率與更多的阻力。

- [ ] **Step 1: 寫失敗的測試**

```ts
// test/unit/doctrine.test.ts
import { describe, it, expect } from 'vitest'
import { energyPull, DEFAULT_DOCTRINE } from '../../src/ai/doctrine'

describe('energyPull：能量見底時少拉一點', () => {
  it('速度充足時完全放行', () => {
    expect(energyPull(1.0, DEFAULT_DOCTRINE)).toBe(1)
    expect(energyPull(1.5, DEFAULT_DOCTRINE)).toBe(1)
  })

  it('速度見底時夾到下限，但不歸零', () => {
    // 【為什麼不歸零】完全鬆桿的 AI 是靶子。下限保留最低限度的機動
    expect(energyPull(0.5, DEFAULT_DOCTRINE)).toBe(DEFAULT_DOCTRINE.energyMinPull)
    expect(DEFAULT_DOCTRINE.energyMinPull).toBeGreaterThan(0)
  })

  it('中間段單調遞增且連續', () => {
    let prev = -1
    for (let r = 0.5; r <= 1.2; r += 0.01) {
      const p = energyPull(r, DEFAULT_DOCTRINE)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
  })

  it('兩端接得上：門檻處剛好等於邊界值', () => {
    const c = DEFAULT_DOCTRINE
    expect(energyPull(c.energyFreeRatio, c)).toBeCloseTo(1, 12)
    expect(energyPull(c.energyFloorRatio, c)).toBeCloseTo(c.energyMinPull, 12)
  })

  it('門檻退化時安全回傳 1（不得意外把 AI 鎖死）', () => {
    const degenerate = { ...DEFAULT_DOCTRINE, energyFreeRatio: 0.7, energyFloorRatio: 0.7 }
    expect(energyPull(0.5, degenerate)).toBe(1)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/doctrine.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/ai/doctrine"`

- [ ] **Step 3: 寫最小實作**

```ts
// src/ai/doctrine.ts
/**
 * 機體對這場仗的偏好。兩個彼此獨立的量：
 *
 *   energyPull      絕對，不需要對手 —— 不要把自己拉到掉出可用包絡
 *   sweetSpotPitch  相對，需要對手   —— 把航跡角偏向自己佔優的高度／速度
 *
 * 【為什麼分開】鏡像對戰（同機種）時甜蜜區處處為 0。若把紀律綁在甜蜜區上，
 * 同機種對打會完全失去紀律 —— 而 `ai-duel-matrix` 留紅的那一場正是
 * P-51 對 P-51。見 spec §3.3。
 *
 * 本模組**不 import 任何 AI 狀態**，只吃 spec 與純量，所以整支可以在單元
 * 測試裡直接算。
 */

export interface DoctrineConfig {
  /**
   * `cornerRatio` 高於此值時拉桿完全放行。1.0 = 角落速度。
   *
   * 【為什麼放行點就是角落速度】高於它時拉滿是**對的** —— 那正是這台飛機
   * 能拉出最大轉彎率的區域，而且是它贏的地方。拉桿紀律要擋的不是「用力
   * 轉彎」，是「在已經沒有速度的地方繼續用力」。
   */
  energyFreeRatio: number
  /** `cornerRatio` 低於此值時夾到 `energyMinPull` */
  energyFloorRatio: number
  /**
   * 見底時仍然允許的拉桿係數。**不得為 0** —— 完全鬆桿的 AI 是靶子。
   */
  energyMinPull: number
}

/**
 * 出貨值。**三個都是 Task 7 掃描前的起手值**，掃描後回填並在此記錄掃描表。
 *
 * 起手值的來歷：`energyFreeRatio` 取 1.0（角落速度本身）；`energyFloorRatio`
 * 取 0.70，比 `DEFAULT_STEER.cornerEnter`（0.75，`extend` 的觸發點）再低一點
 * —— 意思是「已經低到該脫離了，還要再低一截才動用強制卸載」，兩層不搶戲；
 * `energyMinPull` 取 0.35。
 */
export const DEFAULT_DOCTRINE: DoctrineConfig = {
  energyFreeRatio: 1.0,
  energyFloorRatio: 0.70,
  energyMinPull: 0.35,
}

/**
 * 能量見底時的拉桿係數，0..1。1 = 照原樣拉、0 = 完全鬆桿。
 *
 * 【與 `steer.ts` 的 `unloadPull` 是同一族】兩者都回傳拉桿係數、都由
 * `shrinkTowardNose` 消費（方位不動）。差別只在觸發的物理：
 *
 *   unloadPull   看 stallMargin —— 防的是**失速**（迎角太大）
 *   energyPull   看 cornerRatio —— 防的是**能量見底**（速度太低）
 *
 * 消費端取兩者的較小值，所以兩層自然是「誰先擋住算誰的」。
 *
 * 【為什麼門檻退化時回傳 1 而不是 0】回傳 0 = 完全鬆桿。設定寫錯時讓 AI
 * 完全不能拉桿是災難性的失敗模式，而回傳 1 只是讓本層失效、退回既有行為。
 * 安全的方向是「這一層不生效」，不是「這一層把飛機鎖死」。
 *
 * @param cornerRatio `Situation.cornerRatio` = TAS ÷ 角落速度
 */
export function energyPull(cornerRatio: number, cfg: DoctrineConfig): number {
  const span = cfg.energyFreeRatio - cfg.energyFloorRatio
  if (!(span > 0)) return 1
  const t = (cornerRatio - cfg.energyFloorRatio) / span
  if (t >= 1) return 1
  if (t <= 0) return cfg.energyMinPull
  return cfg.energyMinPull + (1 - cfg.energyMinPull) * t
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/doctrine.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add src/ai/doctrine.ts test/unit/doctrine.test.ts
git commit -m "feat: energyPull —— 能量見底時的拉桿係數（純函數）"
```

---

## Task 2：`sweetSpotPitch` 純函數與機種對快取表

**Files:**
- Modify: `src/ai/doctrine.ts`
- Test: `test/unit/doctrine.test.ts`

**Interfaces:**
- Consumes: `DoctrineConfig`（Task 1）
- Produces: `export function sweetSpotAdvantage(self: AircraftSpec, target: AircraftSpec, altitude: number, tas: number): number`（rad/s，正 = 我佔優）、`export function sweetSpotPitch(self: AircraftSpec, target: AircraftSpec, altitude: number, tas: number, cfg: DoctrineConfig): number`（rad，正 = 該抬頭）

**背景：** 優勢定義為**持續迴旋率之差**（rad/s），刻意用既有單位以便直接與 `rules.ts` 的 `turnEnter`（0.02 rad/s）比較。**不含滾轉率** —— 見 Global Constraints。

俯仰偏置由優勢對「速度」的偏導決定：高度不變、速度變化時優勢往哪邊上升。往上升的方向若是「更快」→ 低頭（負），若是「更慢」→ 抬頭（正）。**只用速度軸**，因為俯仰的物理作用就是在高度與速度之間交換，直接用高度軸會與速度軸打架（spec §3.1）。

- [ ] **Step 1: 寫失敗的測試**

```ts
// 追加到 test/unit/doctrine.test.ts
import { sweetSpotAdvantage, sweetSpotPitch } from '../../src/ai/doctrine'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const P = applyFeel(P51D, GAME_FEEL)
const B = applyFeel(BF109G6, GAME_FEEL)
const KMH = 1 / 3.6

describe('sweetSpotAdvantage：在哪裡我贏得過他', () => {
  it('鏡像對戰處處為零', () => {
    for (const alt of [0, 4000, 8000]) {
      for (const kmh of [300, 450, 600]) {
        expect(sweetSpotAdvantage(P, P, alt, kmh * KMH)).toBeCloseTo(0, 12)
      }
    }
  })

  it('低速時 109 佔優、高速時 P-51 佔優（4000 m）', () => {
    // 實測分水嶺 366 km/h（advantage-map.probe.ts）
    expect(sweetSpotAdvantage(P, B, 4000, 300 * KMH)).toBeLessThan(0)
    expect(sweetSpotAdvantage(P, B, 4000, 500 * KMH)).toBeGreaterThan(0)
  })

  it('反對稱：交換雙方等於變號', () => {
    const a = sweetSpotAdvantage(P, B, 4000, 500 * KMH)
    const b = sweetSpotAdvantage(B, P, 4000, 500 * KMH)
    expect(a).toBeCloseTo(-b, 12)
  })
})

describe('sweetSpotPitch：往優勢上升的方向偏俯仰', () => {
  it('鏡像對戰不偏', () => {
    expect(sweetSpotPitch(P, P, 4000, 450 * KMH, DEFAULT_DOCTRINE)).toBeCloseTo(0, 12)
  })

  it('P-51 太慢時低頭換速度', () => {
    // 300 km/h 在分水嶺以下，P-51 該加速 → 低頭 → 負
    expect(sweetSpotPitch(P, B, 4000, 300 * KMH, DEFAULT_DOCTRINE)).toBeLessThan(0)
  })

  it('109 太快時抬頭換高度（減速）', () => {
    // 109 在 500 km/h 是劣勢，它的優勢在更慢處 → 該減速 → 抬頭 → 正
    expect(sweetSpotPitch(B, P, 4000, 500 * KMH, DEFAULT_DOCTRINE)).toBeGreaterThan(0)
  })

  it('偏置不得超過上界', () => {
    for (const alt of [0, 4000, 8000]) {
      for (let kmh = 250; kmh <= 700; kmh += 10) {
        const p = Math.abs(sweetSpotPitch(P, B, alt, kmh * KMH, DEFAULT_DOCTRINE))
        expect(p).toBeLessThanOrEqual(DEFAULT_DOCTRINE.sweetSpotMaxPitch + 1e-12)
      }
    }
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/doctrine.test.ts`
Expected: FAIL —— `sweetSpotAdvantage is not a function`

- [ ] **Step 3: 寫實作**

在 `DoctrineConfig` 加兩個欄位（放在既有三個之後）：

```ts
  /**
   * 甜蜜區俯仰偏置的上界，rad。**Task 7 掃描定值**，候選 5°／10°／15°／20°。
   * 起手值取 10°。
   *
   * 【為什麼一定要有上界】偏置與意圖是疊加的。無上界時 AI 會為了顧自己的
   * 框而把機首帶離敵人 —— 症狀會先出現在 `ai-targeting` 的 `onNose`。
   */
  sweetSpotMaxPitch: number
  /**
   * 優勢達到多少（rad/s）就給滿上界的偏置。
   *
   * 【0.05 的來歷】`rules.ts` 的 `turnEnter` 是 0.02 rad/s，那是「這台飛機
   * 真的轉不贏他」的界線。取它的 2.5 倍當作「差距大到值得整個航跡去遷就」。
   */
  sweetSpotFullAt: number
```

出貨值加上 `sweetSpotMaxPitch: 10 * DEG`、`sweetSpotFullAt: 0.05`（`DEG` 由 `../core/math` 匯入）。

```ts
import { DEG } from '../core/math'
import { sustainedTurnRate } from '../analysis/envelope'
import type { AircraftSpec } from '../specs/types'

/**
 * 「在這個 (高度, 速度) 我贏得過他多少」，rad/s。正 = 我佔優。
 *
 * 【為什麼是持續迴旋率之差，而不是一個無因次分數】用既有單位才能直接與
 * `rules.ts` 的 `turnEnter`（0.02 rad/s）比較 —— 同一把尺，不必再發明一個
 * 標度。
 *
 * 【為什麼不含滾轉率】實測（`test/tools/advantage-map.probe.ts`）迴旋、能量、
 * 滾轉三個量的正負號只有 31/48（65%）一致，而 **P-51 的滾轉在任何速度、
 * 任何高度都贏**（連 300 km/h 都 +2.3°/s）。合進一個分數會把 109 的低速
 * 優勢洗掉，兩台又變成一樣。滾轉是「我能贏哪一種動作」，不是「我在哪裡
 * 打得好」——它屬於未來的機動層。
 *
 * 【兩台都撐不住時回傳 0】`sustainedTurnRate` 撐不住時回傳 0，兩個 0 相減
 * 得到 0 —— 那不是「打平」是「都不行」。回傳 0 剛好讓偏置歸零，等於這一層
 * 在該處不表態，那是正確的行為（誰也沒有優勢可言）。
 */
export function sweetSpotAdvantage(
  self: AircraftSpec,
  target: AircraftSpec,
  altitude: number,
  tas: number,
): number {
  return sustainedTurnRate(self, altitude, tas) - sustainedTurnRate(target, altitude, tas)
}

/** 求偏導用的速度差分步長，m/s。取 5 m/s ≈ 18 km/h，遠小於分水嶺的尺度 */
const DV = 5

/**
 * 甜蜜區的航跡角偏置，rad。正 = 該抬頭（換高度、減速）、負 = 該低頭
 * （換速度、加速）。
 *
 * 【為什麼只用速度軸的梯度】俯仰的物理作用就是在高度與速度之間**交換**，
 * 不能同時增加兩者 —— 同時增加是油門的事，而 AI 平常就在 WEP。原始 spec
 * 寫了 `dTas` 與 `dAlt` 兩個方向量，在撰寫計畫時發現那會在「又低又慢」時
 * 互相打架而無解，因此合併成單一個俯仰偏置。
 *
 * 【方向怎麼定】看優勢對速度的偏導 `dA/dV`：
 *   dA/dV > 0 → 更快對我更好 → 低頭換速度 → 負的俯仰
 *   dA/dV < 0 → 更慢對我更好 → 抬頭換高度 → 正的俯仰
 *
 * 【為什麼用梯度而不是「離甜蜜區中心多遠」】甜蜜區的形狀是非直覺的
 * （實測 P-51 在 2000 m 有一個一級增壓器造成的鼓包，而翻轉速度隨高度
 * 非單調：321→343→366→427→392→385 km/h）。梯度不需要先定義「中心」
 * 在哪，也就不會被那些鼓包騙。
 *
 * 【大小怎麼定】用**優勢本身**的大小，不是梯度的大小。理由是梯度的單位
 * 依賴差分步長、而優勢有既有的參照物（`turnEnter`）。差距越大越值得整個
 * 航跡去遷就。
 */
export function sweetSpotPitch(
  self: AircraftSpec,
  target: AircraftSpec,
  altitude: number,
  tas: number,
  cfg: DoctrineConfig,
): number {
  const faster = sweetSpotAdvantage(self, target, altitude, tas + DV)
  const slower = sweetSpotAdvantage(self, target, altitude, Math.max(tas - DV, 1))
  const slope = faster - slower
  if (slope === 0) return 0

  const here = sweetSpotAdvantage(self, target, altitude, tas)
  // 【用「還差多少」而不是「現在多好」】已經佔優時不需要再遷就航跡；
  // 劣勢越深越該去找自己的地方。取負優勢當作強度。
  const deficit = here < 0 ? -here : 0
  const strength = Math.min(deficit / cfg.sweetSpotFullAt, 1)
  const dir = slope > 0 ? -1 : 1
  return dir * strength * cfg.sweetSpotMaxPitch
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/doctrine.test.ts`
Expected: PASS（10 tests）

若「109 太快時抬頭」那條紅了，先跑 `npx vite-node test/tools/advantage-map.probe.ts` 對照實測的分水嶺，確認是門檻選錯還是符號寫反 —— **不要逕自把測試改成符合實作**。

- [ ] **Step 5: Commit**

```bash
git add src/ai/doctrine.ts test/unit/doctrine.test.ts
git commit -m "feat: sweetSpotPitch —— 往優勢上升的方向偏航跡角"
```

---

## Task 3：`Situation` 接上兩個新量

**Files:**
- Modify: `src/ai/assess.ts`（`Situation` 介面、`createSituation`、`evaluateEnergy`）
- Test: `test/unit/assess.test.ts`（既有檔案，追加）

**Interfaces:**
- Consumes: `energyPull`、`sweetSpotPitch`（Task 1、2）
- Produces: `Situation.pullCeiling: number`（0..1）、`Situation.sweetPitch: number`（rad）

- [ ] **Step 1: 寫失敗的測試**

```ts
// 追加到 test/unit/assess.test.ts
import { createSituation, evaluateEnergy } from '../../src/ai/assess'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

describe('Situation：打法層的兩個量', () => {
  it('速度充足時拉桿上限為 1（本層不介入）', () => {
    const self = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 200)
    const target = new Aircraft(applyFeel(BF109G6, GAME_FEEL), 4000, 200)
    const sit = createSituation()
    evaluateEnergy(self, target, sit)
    expect(sit.cornerRatio).toBeGreaterThan(1)
    expect(sit.pullCeiling).toBe(1)
  })

  it('速度見底時拉桿上限下降但不為零', () => {
    const self = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 60)
    const target = new Aircraft(applyFeel(BF109G6, GAME_FEEL), 4000, 200)
    const sit = createSituation()
    evaluateEnergy(self, target, sit)
    expect(sit.pullCeiling).toBeLessThan(1)
    expect(sit.pullCeiling).toBeGreaterThan(0)
  })

  it('同機種對打時甜蜜區偏置為零', () => {
    const self = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 120)
    const target = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 120)
    const sit = createSituation()
    evaluateEnergy(self, target, sit)
    expect(sit.sweetPitch).toBeCloseTo(0, 12)
  })

  it('createSituation 把兩個欄位初始化成中性值', () => {
    const sit = createSituation()
    expect(sit.pullCeiling).toBe(1)
    expect(sit.sweetPitch).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/assess.test.ts`
Expected: FAIL —— `Property 'pullCeiling' does not exist on type 'Situation'`

- [ ] **Step 3: 寫實作**

`Situation` 介面在 `cornerRatio` 之後加：

```ts
  /**
   * 拉桿係數的上限，0..1。1 = 本層不介入。
   *
   * 【它與 `stallMargin` 那一層的關係】`steer.ts` 的 `unloadPull` 防的是
   * 失速（迎角太大），這一個防的是能量見底（速度太低）。消費端取兩者的
   * 較小值 —— 誰先擋住算誰的。
   */
  pullCeiling: number
  /**
   * 甜蜜區的航跡角偏置，rad。正 = 該抬頭、負 = 該低頭。0 = 沒有偏好
   * （同機種對打時恆為 0）。
   */
  sweetPitch: number
```

`createSituation()` 的回傳物件加 `pullCeiling: 1, sweetPitch: 0`。

`evaluateEnergy` 在算完 `out.cornerRatio` 之後加：

```ts
  out.pullCeiling = energyPull(out.cornerRatio, DEFAULT_DOCTRINE)
  out.sweetPitch = sweetSpotPitch(
    self.spec, target.spec, self.state.position.y, selfTas, DEFAULT_DOCTRINE,
  )
```

並在檔頭補 `import { energyPull, sweetSpotPitch, DEFAULT_DOCTRINE } from './doctrine'`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/assess.test.ts`
Expected: PASS

- [ ] **Step 5: 量效能，確認沒有踩到 10 Hz 的預算**

Run: `npx vitest run test/unit/perf-gate.test.ts`
Expected: 4 passed。

**若紅了**：`sweetSpotPitch` 每次呼叫做三次 `sustainedTurnRate`，而該函式內含 50 次二分。改成 spec §3.1 說的快取表（每個「機種對」一張，沿用 `envelope.ts` 的 `bestTurnTable`：WeakMap、首次一次填滿、格間線性內插）。**不要用逐格惰性填充** —— `bestTurnTable` 的註解記載那會讓 AI 步的 p999 由 217 µs 惡化到 3.8 ms。

- [ ] **Step 6: Commit**

```bash
git add src/ai/assess.ts test/unit/assess.test.ts
git commit -m "feat: Situation 加 pullCeiling 與 sweetPitch"
```

---

## Task 4：`steerCommand` 消費拉桿紀律

**Files:**
- Modify: `src/ai/steer.ts:1345-1350`（`mode === 'unload'` 那一段）
- Test: `test/control/director.test.ts` 或 `test/unit/steer.test.ts`（依既有檔案位置）

**Interfaces:**
- Consumes: `Situation.pullCeiling`（Task 3）
- Produces: 無新匯出。行為改變：`shrinkTowardNose` 現在**無條件**套用，係數為 `min(unloadPull, pullCeiling)`

**背景：** 現況是 `if (mode === 'unload') shrinkTowardNose(self, unloadPull(sit.stallMargin, cfg), out.aimWorld)`。拉桿紀律必須在**所有** mode 下生效（AI 拉爆自己不限於 unload 這個幾何），所以要把條件拆開。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('拉桿紀律在非 unload 的 mode 下也生效', () => {
  // 建一個速度見底、幾何正常（不會進 unload）的態勢，
  // 確認瞄準誤差角被收小
  const self = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 60)
  const sit = createSituation()
  sit.stallMargin = 5      // 離失速很遠 → unloadPull 回傳 1
  sit.pullCeiling = 0.4    // 但能量見底
  const aim = aimOffsetBy(60 * DEG, 0)
  const before = errDeg(self, aim)
  steerCommand('engage', 'normal', sit, basis, self, 0, knobs, defend, null, cmd)
  expect(errDeg(self, cmd.aimWorld)).toBeLessThan(before * 0.6)
})

it('pullCeiling 為 1 時逐位元不動（本層不生效）', () => {
  // 這一條守的是「沒有能量問題時，這個改動什麼也不做」
  sit.pullCeiling = 1
  sit.stallMargin = 5
  steerCommand('engage', 'normal', sit, basis, self, 0, knobs, defend, null, cmd)
  const withLayer = cmd.aimWorld.clone()
  // 與同樣輸入下 unloadPull 恆為 1 的既有行為比對
  expect(withLayer.x).toBe(expectedX)
  expect(withLayer.y).toBe(expectedY)
  expect(withLayer.z).toBe(expectedZ)
})

it('方位不動（這是硬性不變量）', () => {
  sit.pullCeiling = 0.3
  const azBefore = Math.atan2(aim.x, -aim.z)
  steerCommand('engage', 'normal', sit, basis, self, 0, knobs, defend, null, cmd)
  const azAfter = Math.atan2(cmd.aimWorld.x, -cmd.aimWorld.z)
  expect(azAfter).toBeCloseTo(azBefore, 6)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/steer.test.ts`
Expected: FAIL —— 第一條，誤差角沒有被收小

- [ ] **Step 3: 改實作**

把既有的那一段換成：

```ts
  // ── 卸載：拉太猛時把誤差角收小，方位不動 ────────────────
  // （既有註解保留）
  //
  // 【2026-08-11：`unload` 由一個 mode 變成兩個來源取較小值】
  //   unloadPull(stallMargin)  防失速 —— 只在 `unload` 這個幾何下有意義
  //   sit.pullCeiling          防能量見底 —— **任何幾何下都要生效**
  //
  // AI 把自己拉爆不限於 `unload` 的幾何：實測 `ai-defence` 正後方 400 m
  // 挨打由 0.084 s 惡化到 0.518 s，那一場的 mode 大多不是 unload。
  //
  // 【`overshoot` 與 `speedRecover` 仍然不套失速那一層】它們的優先序高於
  // `unload`（見 `geometryGate`），但**能量那一層照套** —— 它們同樣會把
  // 速度拉光。
  const stallPull = mode === 'unload' ? unloadPull(sit.stallMargin, cfg) : 1
  const pull = Math.min(stallPull, sit.pullCeiling)
  if (pull < 1) shrinkTowardNose(self, pull, out.aimWorld)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/steer.test.ts test/control/director.test.ts`
Expected: PASS

- [ ] **Step 5: 跑受影響的整合測試，記下數值（先不修）**

Run: `npx vitest run test/integration/ai-defence.test.ts test/integration/ai-visible-evasion.test.ts test/integration/ai-duel-matrix.test.ts`

把四種幾何的「藍方掉血」、700／900 m 的中彈率、高能量開局的傷害交換**記在 commit 訊息裡**。這是 Task 7 驗收的中途讀數 —— 現在還不會全綠（甜蜜區還沒接、參數還沒掃）。

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts test/unit/steer.test.ts
git commit -m "feat: 拉桿紀律接進 steerCommand（所有 mode 生效）"
```

---

## Task 5：早退路徑補上拉桿紀律

**Files:**
- Modify: `src/ai/AiController.ts:240-265`（`stationCommand` / `rallyCommand` / 平飛三個分支）
- Test: `test/integration/ai-command-channel.test.ts`（既有）+ 新增單元測試

**Interfaces:**
- Consumes: `Situation.pullCeiling`
- Produces: 無新匯出

**背景（這是 spec §4.4 明寫要獨立成任務的那一項）：** `rallyCommand` 與 `stationCommand` **直接寫 `aimWorld` 然後 return，根本不經過 `steerCommand`**。所以 Task 4 的改動對它們無效 —— 「飛去集合點」的途中仍然可以把自己拉爆。

**注意方向性**：甜蜜區**不**補到這裡（指揮位階較高），拉桿紀律**要**補。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('執行集合命令途中仍然受拉桿紀律約束', () => {
  const self = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 60) // 速度見底
  const ai = new AiController()
  ai.order = { kind: 'rally', point: new Vector3(0, 4000, -5000) }
  const cmd = createCommand()
  ai.update(self, 1 / 240, cmd)
  // 集合點在正前方偏一大角度時，誤差角不得是滿的
  expect(errDeg(self, cmd.aimWorld)).toBeLessThan(rawRallyErrDeg * 0.7)
})

it('速度充足時集合路徑逐位元不動', () => {
  const self = new Aircraft(applyFeel(P51D, GAME_FEEL), 4000, 200)
  // 與未改動前的 rallyAim 輸出比對
  expect(cmd.aimWorld.x).toBe(expectedX)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/ai-controller.test.ts`
Expected: FAIL —— 誤差角未被收小

- [ ] **Step 3: 寫實作**

在 `AiController` 裡把三個早退分支的共同尾巴抽出來。在 `this.emit(self, dt, out)` 之前插入：

```ts
      // 【拉桿紀律連早退路徑也涵蓋，甜蜜區不涵蓋】兩者的位階不同：
      // 甜蜜區是戰術偏好，指揮官比它高，執行命令時讓位；拉桿紀律是
      // 「不要弄壞自己」——**沒有任何命令是「把自己拉爆」**，所以它在
      // 任何時候都生效，包括飛去集合點的途中。見 spec §4.4。
      //
      // 【為什麼不能靠 steerCommand】這三個分支直接寫 aimWorld 然後 return，
      // 根本不經過 steerCommand，所以那一層的紀律對它們無效。
      const ceiling = energyPull(
        selfTas / cornerSpeed(self.spec, self.state.position.y), DEFAULT_DOCTRINE,
      )
      if (ceiling < 1) shrinkTowardNose(self, ceiling, raw.aimWorld)
```

這需要把 `shrinkTowardNose` 由私有改成 `export`（`steer.ts`），並在其註解補一句「早退路徑也會呼叫它，見 `AiController`」。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-controller.test.ts`
Expected: PASS

- [ ] **Step 5: 量指揮層的三條既有紅字，確認數值沒變差**

Run: `npx vitest run test/integration/ai-command-channel.test.ts test/integration/ai-command-tactics.test.ts`

這三條 **main 上本來就紅**，所以判準是**數值不得比改動前更差**，不是轉綠。把改動前後的數值都記進 commit 訊息。

- [ ] **Step 6: Commit**

```bash
git add src/ai/AiController.ts src/ai/steer.ts test/unit/ai-controller.test.ts
git commit -m "feat: 早退路徑（rally／station）補上拉桿紀律"
```

---

## Task 6：`steerCommand` 消費甜蜜區偏置

**Files:**
- Modify: `src/ai/steer.ts`（新增 `applyPitchBias`；`steerCommand` 尾端）
- Test: `test/unit/steer.test.ts`

**Interfaces:**
- Consumes: `Situation.sweetPitch`（Task 3）
- Produces: `export function applyPitchBias(self: Aircraft, deltaPitch: number, aim: Vector3): void`

**背景：** `applyFloor(self, minPitch, aim)` 已經存在，但它**只抬不壓**（那是它能無條件疊加的理由）。甜蜜區需要雙向，所以做一個姊妹函式。

**順序很重要**：甜蜜區偏置要排在 `applyFloor` **之前** —— 撞地底限的優先序最高，必須有最後決定權。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('applyPitchBias 抬頭與低頭都能，方位不動', () => {
  const aim = aimOffsetBy(30 * DEG, 0)
  const azBefore = Math.atan2(aim.x, -aim.z)
  applyPitchBias(self, 10 * DEG, aim)
  expect(pitchDeg(aim)).toBeCloseTo(pitchBefore + 10, 3)
  expect(Math.atan2(aim.x, -aim.z)).toBeCloseTo(azBefore, 9)

  applyPitchBias(self, -20 * DEG, aim)
  expect(pitchDeg(aim)).toBeCloseTo(pitchBefore - 10, 3)
})

it('偏置為 0 時逐位元不動', () => {
  const aim = aimOffsetBy(30 * DEG, 0)
  const copy = aim.clone()
  applyPitchBias(self, 0, aim)
  expect(aim.x).toBe(copy.x)
  expect(aim.y).toBe(copy.y)
  expect(aim.z).toBe(copy.z)
})

it('rally 意圖不套甜蜜區（指揮位階較高）', () => {
  sit.sweetPitch = 15 * DEG
  steerCommand('rally', 'normal', sit, basis, self, 0, knobs, defend, rallyPoint, cmd)
  // 與 sweetPitch = 0 的同一次呼叫逐位元相同
  expect(cmd.aimWorld.y).toBe(withoutBias.y)
})

it('撞地底限壓過甜蜜區的低頭', () => {
  sit.sweetPitch = -20 * DEG          // 想低頭換速度
  steerCommand('engage', 'normal', sit, basis, self, /* seaHeight */ self.state.position.y - 50, knobs, defend, null, cmd)
  expect(pitchDeg(cmd.aimWorld)).toBeGreaterThan(0)  // 底限贏
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/steer.test.ts`
Expected: FAIL —— `applyPitchBias is not a function`

- [ ] **Step 3: 寫實作**

```ts
/**
 * 把 `aim` 的**航跡角**加上 `deltaPitch`，水平方位不變。就地修改。
 *
 * 【與 `applyFloor` 的關係】`applyFloor` 只抬不壓（那是它能無條件疊加的
 * 理由），甜蜜區需要雙向，所以是它的姊妹函式而不是它本身。兩者共用同一個
 * 「改航跡角、不改方位」的作法 —— 見 `applyFloor` 的註解為什麼方位不能動
 * （動了會被指揮儀讀成滾轉需求，副翼打到滿舵）。
 *
 * 【夾在 ±80°】超過就變成垂直，而俯仰偏置的用途是「偏一點」不是「翻過去」。
 *
 * `deltaPitch === 0` 時逐位元不動。
 */
export function applyPitchBias(self: Aircraft, deltaPitch: number, aim: Vector3): void {
  if (deltaPitch === 0) return
  const horiz = Math.hypot(aim.x, aim.z)
  const pitch = Math.atan2(aim.y, horiz)
  const LIMIT = 80 * DEG
  let next = pitch + deltaPitch
  if (next > LIMIT) next = LIMIT
  else if (next < -LIMIT) next = -LIMIT
  if (horiz < 1e-9) return          // 已經垂直：方位無意義，不動
  const scale = Math.cos(next) / horiz
  aim.set(aim.x * scale, Math.sin(next), aim.z * scale)
}
```

`steerCommand` 在拉桿紀律之後、`applyFloor` 之前插入：

```ts
  // ── 甜蜜區：把航跡角偏向自己佔優的高度／速度，方位不動 ──
  // 【為什麼排在撞地底限之前】底限的優先序最高，必須有最後決定權 ——
  // 「想低頭換速度」不能贏過「快撞海了」。
  //
  // 【為什麼 rally 排除】指揮層的位階比戰術偏好高。「我想飛高一點」不該
  // 蓋過「去那個點集合」。見 spec §4.4。
  if (intent !== 'rally') applyPitchBias(self, sit.sweetPitch, out.aimWorld)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/steer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/steer.ts test/unit/steer.test.ts
git commit -m "feat: 甜蜜區偏置接進 steerCommand（rally 除外）"
```

---

## Task 7：掃描定值、副判準探針、把四筆放寬改回去

**Files:**
- Create: `test/tools/doctrine-visible.probe.ts`
- Modify: `src/ai/doctrine.ts`（回填掃描表）
- Modify: `test/integration/ai-defence.test.ts`、`test/integration/ai-visible-evasion.test.ts`、`test/integration/ai-targeting.test.ts`（把 2026-08-11 的放寬改回去）
- Modify: `docs/superpowers/specs/2026-08-11-ai-doctrine-design.md`（回填未決事項）

**Interfaces:**
- Consumes: 全部
- Produces: 無新匯出

- [ ] **Step 1: 寫副判準的量測探針**

```ts
// test/tools/doctrine-visible.probe.ts
/**
 * 副判準：打法真的看得出來嗎。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/doctrine-visible.probe.ts
 *
 * 【必須套 GAME_FEEL】`ai-defence` 等護欄走史實 spec，量的不是玩家飛的
 * 那台飛機。副判準問的是「玩家看不看得出來」，所以一定要用出貨配置。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'

const DT = 1 / 240
const SECONDS = 150
const b = createBattle(new AiController(), DEFAULT_BATTLE, 20260811)
const cs = b.world.combatants
const blueTas: number[] = []
const blueAlt: number[] = []
const redTas: number[] = []
const redAlt: number[] = []

for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  if (s % 24 !== 0) continue
  for (const c of cs) {
    if (!c.alive) continue
    const tas = c.aircraft.state.velocity.length() * 3.6
    const alt = c.aircraft.state.position.y
    if (c.aircraft.spec.id === 'p51d') { blueTas.push(tas); blueAlt.push(alt) }
    else { redTas.push(tas); redAlt.push(alt) }
  }
}
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.round((a.length - 1) * p)]!
for (const [n, t, h] of [['P-51D', blueTas, blueAlt], ['Bf 109', redTas, redAlt]] as const) {
  console.log(`${n}  TAS p10/中位/p90 ${pct(t, 0.1).toFixed(0)}/${pct(t, 0.5).toFixed(0)}/${pct(t, 0.9).toFixed(0)} km/h`
    + `　高度 ${pct(h, 0.1).toFixed(0)}/${pct(h, 0.5).toFixed(0)}/${pct(h, 0.9).toFixed(0)} m`)
}
console.log(`中位 TAS 差 ${(pct(blueTas, 0.5) - pct(redTas, 0.5)).toFixed(0)} km/h`
  + `　中位高度差 ${(pct(blueAlt, 0.5) - pct(redAlt, 0.5)).toFixed(0)} m`)
```

先跑一次**關閉**本功能的基準（把 `DEFAULT_DOCTRINE.sweetSpotMaxPitch` 暫設為 0），記下兩個差值。

- [ ] **Step 2: 掃描 `sweetSpotMaxPitch`**

對 5° / 10° / 15° / 20° 各跑一次：

- **主判準**：`ai-defence`、`ai-visible-evasion`、`ai-targeting`、`ai-duel-matrix` 各自的數值
- **護欄**：`ai-targeting` 的 `onNose`（瞄準點是否還指著敵人）不得低於 `LIMITS.onNose`；指揮層三條既有紅字的數值不得變差
- **副判準**：Step 1 探針的兩個差值

把整張表寫進 `DEFAULT_DOCTRINE` 的註解。**偏置過大的症狀會先出現在 `onNose`** —— AI 為了顧自己的框而放掉射擊解。

- [ ] **Step 3: 掃描 `energyFloorRatio` 與 `energyMinPull`**

`energyFloorRatio` 候選 0.65 / 0.70 / 0.75、`energyMinPull` 候選 0.25 / 0.35 / 0.45。主判準同上。

注意 `energyFloorRatio` 不要碰到 `DEFAULT_STEER.cornerEnter`（0.75，`extend` 的觸發點）—— 兩層搶戲時 AI 會一邊被強制卸載一邊想脫離。

- [ ] **Step 4: 把 2026-08-11 的四筆放寬改回去**

```
  test/integration/ai-defence.test.ts        刪掉「正後方 400 m」的 budgetSeconds: 0.55 整筆
  test/integration/ai-visible-evasion.test.ts SHOOTABLE_LIMIT 由 { 700: 0.14, 900: 0.08 } 改回單一常數 0.08
  test/integration/ai-targeting.test.ts       holdMedian 由 1.35 改回 1.5
  test/integration/ai-duel-matrix.test.ts     不改（它從未被放寬），確認由紅轉綠
```

- [ ] **Step 5: 跑全套**

Run: `npx vitest run > /tmp/final.log 2>&1`

**比較基準必須對齊**：main 的基準線要在獨立 worktree 跑，而且**用同一組檔案**。前一輪犯過這個錯 —— 基準跑 11 個檔案、分支跑 104 個，`rematch`（連開十場的計時測試）因此假紅。

**四筆能改回幾筆由專案負責人裁定**，不是全有全無。若三筆回得去、一筆回不去，那一筆要有量測支持的解釋，而不是再放寬一次。

- [ ] **Step 6: 回填 spec 的未決事項**

`docs/superpowers/specs/2026-08-11-ai-doctrine-design.md` 第 7 節的四項逐一結案或更新：掃描定出的值、副判準的門檻、浮現是否足夠（決定要不要進意圖層）、`steer.ts` 四個能量判準的重掃結果。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 掃描定值、副判準探針、把四筆放寬改回去"
```

---

## Self-Review

**1. Spec 覆蓋**

| spec 章節 | 對應任務 |
|---|---|
| §3.1 `sweetSpot` | Task 2 |
| §3.2 `gDiscipline` | Task 1 |
| §4.2 拉桿紀律的消費點 | Task 4 |
| §4.3 甜蜜區的消費點 | Task 6 |
| §4.4 與指揮層的位階關係 | Task 5（拉桿紀律進早退路徑）+ Task 6（rally 排除） |
| §5.1 主判準 | Task 7 Step 4-5 |
| §5.2 副判準 | Task 7 Step 1 |
| §5.3 配置的陷阱 | Task 7 Step 1 的檔頭註解 |
| §5.5 效能 | Task 3 Step 5 |

**2. 佔位符掃描**：無 TBD。所有「待掃描」都集中在 Task 7 且列出候選值、主判準與護欄。

**3. 型別一致性**：`pullCeiling` / `sweetPitch`（`Situation` 欄位）、`energyPull` / `sweetSpotAdvantage` / `sweetSpotPitch` / `applyPitchBias`（函式）在各任務間名稱一致。`DoctrineConfig` 的五個欄位在 Task 1 定義三個、Task 2 追加兩個，`DEFAULT_DOCTRINE` 同步。

**4. 已知的計畫層風險**

- Task 4 把 `shrinkTowardNose` 由「只在 unload」變成「無條件」，這是本計畫**行為改變最大**的一步。Task 4 Step 1 的第二條測試（`pullCeiling === 1` 時逐位元不動）就是為了守住「沒有能量問題時什麼也不做」。
- Task 5 需要把 `shrinkTowardNose` 由私有改成匯出。那個函式的註解記載了一個昂貴的教訓（方位偏移導致副翼滿舵），匯出時**必須連註解一起讀**。
