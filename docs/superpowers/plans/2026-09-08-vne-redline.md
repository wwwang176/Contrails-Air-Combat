# 紅線 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓規格表上的 `limits.vne` 在飛行中有後果：超速三軸操縱面指數變重、HUD 速度錶黃紅、AI 追擊不追過紅線、規則 3 的脫離會俯衝到對手放手的速度。

**Architecture:** 一個純函數 `redlineEffectiveness(vne, qbar)` 住在 `physics/aero.ts`，三個消費端（`aeroForceMoment`、`envelope.maxRollRate`、`FlightDirector.steadyRollRate`）都乘它。HUD 只加一個比值欄位。AI 的守線是安全層的第四種動作；脫離的俯衝目標經由 `Knobs` 傳進 `steerCommand`，它不讀 `RuleState`。

**Tech Stack:** TypeScript、three.js、Vitest、vite-node 探針。

**Spec:** `docs/superpowers/specs/2026-09-07-vne-redline-design.md`

## Global Constraints

- 熱路徑（240 Hz）不配置記憶體。
- 註解只寫現況與理由，不寫沿革；繁體中文。
- 護欄要能被殺死：先驗紅，或做變異測試。
- `npx tsc --noEmit` 基準 **24 個錯**（全在 `test/`），改完不得增加。
- 不 `git add -A`；提交訊息 trailer 只留 `Co-Authored-By`。
- 紅線是 IAS：`IAS = √(2·qbar / RHO0)`，`RHO0` 來自 `physics/atmosphere.ts`。
- 曲線：`r ≤ 0.85 → 1`；`r > 0.85 → exp(−K·(r − 0.85))`，`K = ln(10)/0.15`。

---

### Task 1: 物理 —— 紅線因子與三軸乘法

**Files:**
- Modify: `src/physics/aero.ts`（`controlEffectiveness` 下方新增；`aeroForceMoment` 三軸乘上）
- Test: `test/unit/aero.test.ts`

**Interfaces:**
- Produces: `export function redlineEffectiveness(vne: number, qbar: number): number`（vne 為 m/s IAS）；`export const REDLINE_KNEE = 0.85`；`export const REDLINE_K`。

- [ ] **Step 1: 寫失敗的測試**

```ts
describe('redlineEffectiveness', () => {
  const vne = 700 * KMH
  const q = (ias: number): number => 0.5 * RHO0 * ias * ias

  it('r ≤ 0.85 時恆為 1', () => {
    expect(redlineEffectiveness(vne, q(0.5 * vne))).toBe(1)
    expect(redlineEffectiveness(vne, q(0.85 * vne))).toBe(1)
  })
  it('紅線那一點剩 10%', () => {
    expect(redlineEffectiveness(vne, q(vne))).toBeCloseTo(0.10, 3)
  })
  it('單調遞減', () => {
    let prev = 1
    for (let r = 0.86; r <= 1.2; r += 0.01) {
      const e = redlineEffectiveness(vne, q(r * vne))
      expect(e).toBeLessThan(prev)
      prev = e
    }
  })
  it('0.85 兩側一階連續：斜率在膝點左右都趨近 0', () => {
    // 左側恆為 1（斜率 0）；右側是 exp(−K·ε)，ε → 0 時斜率 → −K，
    // 所以「一階連續」的意思是**值**連續、斜率有一個 −K 的折角。
    // 值連續才是玩家感受到的「越來越重」，折角由 K 的大小決定，不會跳。
    const left = redlineEffectiveness(vne, q(0.85 * vne))
    const right = redlineEffectiveness(vne, q(0.8501 * vne))
    expect(right).toBeCloseTo(left, 3)
  })
  it('三軸拿到同一個值，而且是乘在 controlEffectiveness 後面不是取代', () => {
    // 對 P51D 在 q 超過 qRef 又超過紅線時，總權限 = controlEffectiveness × redline
    const CS = P51D.controlStiffening
    const qbar = q(1.0 * P51D.limits.vne)
    const a = controlEffectiveness(CS.aileronK, CS.qRef, qbar) * redlineEffectiveness(P51D.limits.vne, qbar)
    expect(a).toBeLessThan(controlEffectiveness(CS.aileronK, CS.qRef, qbar))
    expect(a).toBeCloseTo(controlEffectiveness(CS.aileronK, CS.qRef, qbar) * 0.10, 3)
  })
})
```

`aero.test.ts` 已匯入 `controlEffectiveness`、`P51D`；補匯入 `redlineEffectiveness`、`RHO0`（`../../src/physics/atmosphere`）、`KMH`（`../../src/core/units` —— 用 `grep -rn "export const KMH" src/` 確認路徑）。

- [ ] **Step 2: 跑，確認紅** —— `npx vitest run test/unit/aero.test.ts`，預期 `redlineEffectiveness is not exported`。

- [ ] **Step 3: 實作**

`aero.ts` 的 `controlEffectiveness` 下方：

```ts
/** 紅線因子開始作用的 IAS / vne 比值。它與 HUD 變黃的門檻是同一個數 */
export const REDLINE_KNEE = 0.85
/** 使 r = 1（紅線）時剩 10%：exp(−K · 0.15) = 0.1 */
export const REDLINE_K = Math.log(10) / (1 - REDLINE_KNEE)

/**
 * 超速的操縱面變重：δ_eff = δ × exp(−K·(IAS/vne − 0.85))，膝點以下為 1。
 *
 * 【與 controlEffectiveness 的分工】那一個是「高速舵面變重」的冪次曲線，
 * 在 qRef 之上就緩緩生效；這一個是紅線附近的**指數**懲罰，膝點之前完全
 * 不作用。兩者相乘。
 *
 * 【為什麼是 IAS】史實紅線是 IAS，而舵面變重的物理量本來就是動壓。
 * 高空 TAS 大、動壓小，紅線自然比較晚到。
 *
 * 【壞掉會怎樣】沒有它時 `limits.vne` 在飛行中沒有任何後果 —— 零戰俯衝到
 * 600 km/h 照樣轉，F4F 的俯衝脫離在物理上不存在出口。
 *
 * 熱路徑（240 Hz）。膝點以下連 exp 都不算。
 */
export function redlineEffectiveness(vne: number, qbar: number): number {
  const r = Math.sqrt(2 * qbar / RHO0) / vne
  if (r <= REDLINE_KNEE) return 1
  return Math.exp(-REDLINE_K * (r - REDLINE_KNEE))
}
```

`aeroForceMoment` 三軸那段：

```ts
  const low = lowSpeedEffectiveness(spec, aero.qbar)
  // 【紅線因子三軸同一個值】與低速衰減同一個原則，不做軸的差異化
  const red = redlineEffectiveness(spec.limits.vne, aero.qbar)
  const da = controls.aileron * low * red * controlEffectiveness(CS.aileronK, CS.qRef, aero.qbar)
  const de = controls.elevator * low * red * controlEffectiveness(CS.elevatorK, CS.qRef, aero.qbar)
  const dr = controls.rudder * low * red * controlEffectiveness(CS.rudderK, CS.qRef, aero.qbar)
```

`aero.ts` 要匯入 `RHO0`（確認它現在有沒有匯入 `atmosphere`；沒有就加）。

- [ ] **Step 4: 跑，確認綠** —— `npx vitest run test/unit/aero.test.ts`。

- [ ] **Step 5: 連坐檢查** —— `npx vitest run test/integration/order-of-battle-replay.test.ts`。三個校驗和**預期都不變**（P-51／Bf109／B-17 護送場 30 秒內沒有人碰到 0.85）。變了就停下來查是誰，不要重錄。

- [ ] **Step 6: Commit**

```bash
git add src/physics/aero.ts test/unit/aero.test.ts
git commit -m "feat(physics): 紅線因子 —— IAS 超過 0.85 vne 三軸操縱面指數變重"
```

---

### Task 2: 兩個滾轉率估算跟著乘

**Files:**
- Modify: `src/analysis/envelope.ts:434-441`（`maxRollRate`）
- Modify: `src/control/FlightDirector.ts:739-743`（`steadyRollRate`）
- Test: `test/unit/envelope.test.ts`（`describe('maxRollRate')` 內新增）

**Interfaces:**
- Consumes: Task 1 的 `redlineEffectiveness`。

- [ ] **Step 1: 寫失敗的測試**

```ts
  it('超過紅線之後滾轉率跟著操縱權限一起掉', () => {
    const below = maxRollRate(A6M5, 0, 0.8 * A6M5.limits.vne)
    const atLine = maxRollRate(A6M5, 0, A6M5.limits.vne)
    // 紅線那一點權限剩 10%，滾轉率也該掉到同一個量級（高速變硬另外再乘）
    expect(atLine / below).toBeLessThan(0.15)
  })
```

補匯入 `A6M5`（`../../src/specs/a6m5`）。

- [ ] **Step 2: 跑，確認紅**。

- [ ] **Step 3: 實作**

`envelope.ts`：
```ts
  const da = controlEffectiveness(CS.aileronK, CS.qRef, qbar) * redlineEffectiveness(spec.limits.vne, qbar)
```

`FlightDirector.ts`：
```ts
  const eff = controlEffectiveness(s.aileronK, s.qRef, aero.qbar)
    * redlineEffectiveness(spec.limits.vne, aero.qbar)
```

兩處都補匯入。`FlightDirector` 那段的註解補一句：「紅線因子也乘進去，否則
在紅線附近會高估自己轉得動」。

- [ ] **Step 4: 跑，確認綠** —— `npx vitest run test/unit/envelope.test.ts test/unit/controllers.test.ts`。

- [ ] **Step 5: Commit**

```bash
git add src/analysis/envelope.ts src/control/FlightDirector.ts test/unit/envelope.test.ts
git commit -m "feat: 滾轉率估算乘上紅線因子，與物理同一個數"
```

---

### Task 3: HUD —— 速度錶變色

**Files:**
- Modify: `src/hud/types.ts`（`HudFrame` 加 `vneRatio`；`createHudFrame` 預設 0）
- Modify: `src/main.ts:1790` 旁（填 `vneRatio`）
- Modify: `src/hud/widgets/dials.ts:220`（`TAS … M …` 那行的字色）
- Create: `test/unit/hud-dials-redline.test.ts`

**Interfaces:**
- Produces: `HudFrame.vneRatio: number`（IAS / vne）。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'
import { drawDials } from '../../src/hud/widgets/dials'

/** 記下每一次 fillText 當時的 fillStyle */
function fakeCtx(): { ctx: CanvasRenderingContext2D; texts: Array<{ text: string; color: string }> } {
  const texts: Array<{ text: string; color: string }> = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '',
    beginPath(): void {}, closePath(): void {}, clip(): void {},
    moveTo(): void {}, lineTo(): void {}, stroke(): void {}, fill(): void {},
    fillRect(): void {}, strokeRect(): void {},
    fillText(text: string): void { texts.push({ text, color: String((this as { fillStyle: string }).fillStyle) }) },
    save(): void {}, restore(): void {},
    translate(): void {}, rotate(): void {}, setTransform(): void {},
    arc(): void {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts }
}

const L: HudLayout = { width: 1280, height: 720, scale: 1 } as HudLayout

function tasColor(vneRatio: number): string {
  const f = createHudFrame()
  f.vneRatio = vneRatio
  const { ctx, texts } = fakeCtx()
  drawDials(ctx, L, f)
  const line = texts.find((t) => t.text.startsWith('TAS '))
  expect(line).toBeDefined()
  return line!.color
}

describe('速度錶的紅線警告', () => {
  it('0.84 —— 沒事，用暗色', () => {
    expect(tasColor(0.84)).toBe(HUD_COLORS.dim)
  })
  it('0.86 —— 黃', () => {
    expect(tasColor(0.86)).toBe(HUD_COLORS.warn)
  })
  it('0.96 —— 紅', () => {
    expect(tasColor(0.96)).toBe(HUD_COLORS.danger)
  })
})
```

`HudLayout` 的必要欄位以 `hud-altimeter-band.test.ts` 用的那份為準，照抄。

- [ ] **Step 2: 跑，確認紅**（`vneRatio` 不存在型別會先擋；用 `npx vitest run` 看到失敗即可）。

- [ ] **Step 3: 實作**

`types.ts` `HudFrame`（`ias` 下方）：
```ts
  /** IAS / vne。0.85 起操縱面變重、HUD 變黃；0.95 變紅。見 `redlineEffectiveness` */
  vneRatio: number
```
`createHudFrame`：`tas: 0, ias: 0, vneRatio: 0, mach: 0, …`。

`main.ts:1790` 下一行：
```ts
  hudFrame.vneRatio = hudFrame.ias / aircraft.spec.limits.vne
```

`dials.ts:220`：
```ts
  // 【與失速警告同一組門檻】0.85 是操縱面開始變重的點，0.95 剩 22%
  ctx.fillStyle = f.vneRatio > 0.95 ? HUD_COLORS.danger
    : f.vneRatio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.dim
  ctx.fillText(`TAS ${(f.tas * 3.6).toFixed(0)}   M ${f.mach.toFixed(2)}`, asiX, subY)
```

注意上一行 `IAS km/h`／`ALT m` 仍然要 `dim`，所以 `fillStyle` 在 `TAS` 那行之前才改。

- [ ] **Step 4: 跑，確認綠** —— `npx vitest run test/unit/hud-dials-redline.test.ts test/unit/hud-altimeter-band.test.ts test/unit/hud.test.ts`。

- [ ] **Step 5: Commit**

```bash
git add src/hud/types.ts src/hud/widgets/dials.ts src/main.ts test/unit/hud-dials-redline.test.ts
git commit -m "feat(hud): 速度錶在 0.85 vne 變黃、0.95 變紅"
```

---

### Task 4: 安全層 —— 守線

**Files:**
- Modify: `src/ai/safety.ts`（`SafetyAction` 加 `'overspeed'`；`SafetyConfig` 加 `overspeedRatio`；`applySafety` 在撞地分支之後、失速分支之前）
- Test: `test/unit/ai-safety.test.ts`

**Interfaces:**
- Produces: `SafetyAction = 'none' | 'ground' | 'stall' | 'terrain' | 'overspeed'`；`DEFAULT_SAFETY.overspeedRatio = 0.90`。

- [ ] **Step 1: 寫失敗的測試**

```ts
describe('超速守線', () => {
  /** 讓一台 A6M5 以給定的 IAS 比值俯衝 */
  function overspeeding(ratio: number, gammaDeg: number): Aircraft {
    const ias = ratio * A6M5.limits.vne
    return divingSpec(A6M5, 3000, ias / Math.sqrt(atmosphere(3000).sigma), gammaDeg)
  }

  it('r = 0.91 且俯衝中 → overspeed：收油門、抬到平飛', () => {
    const a = overspeeding(0.91, -20)
    const cmd = createCommand()
    expect(applySafety(a, 0, cmd)).toBe('overspeed')
    expect(cmd.throttle).toBe(0)
    expect(cmd.aimWorld.y).toBeGreaterThanOrEqual(-1e-9)
  })
  it('r = 0.91 但正在爬升 → none', () => {
    const a = overspeeding(0.91, +10)
    expect(applySafety(a, 0, createCommand())).toBe('none')
  })
  it('r = 0.88 俯衝中 → none（門檻是 0.90）', () => {
    const a = overspeeding(0.88, -20)
    expect(applySafety(a, 0, createCommand())).toBe('none')
  })
  it('撞地與超速同時成立時撞地贏', () => {
    const a = overspeeding(0.95, -60)
    a.state.position.y = 150
    expect(applySafety(a, 0, createCommand())).toBe('ground')
  })
})
```

`diving()` 目前寫死 `P51D`；抽一個 `divingSpec(spec, altitude, tas, gammaDeg)`，`diving` 改成呼叫它。`atmosphere` 的回傳型別照 `aero.test.ts` 的用法（那裡是 `atmosphere(altitude, air)` 填物件 —— 依實際簽名調整）。

- [ ] **Step 2: 跑，確認紅**。

- [ ] **Step 3: 實作**

`SafetyConfig`：
```ts
  /**
   * 超速守線的 IAS / vne 門檻。**只擋往下。**
   *
   * 【為什麼是 0.90】紅線因子在 0.90 還剩 46% 權限，抬得起來；0.95 只剩
   * 22%，來不及。拉起的閉式解假設 `gPositive` 全部可用，紅線一過那個假設
   * 整個失效 —— 沒有這一條，追擊中的 AI 會追進紅線、拉不起來、撞海。
   */
  overspeedRatio: number
```
`DEFAULT_SAFETY`：`overspeedRatio: 0.90,`。

`applySafety`，撞地分支 `return action` 之後、失速分支之前：
```ts
  // ── 超速守線 ────────────────────────────────────────────
  // 【只擋往下，不擋往上】拉平之後 r 自己會掉。優先序在撞地之後：離地已經
  // 不夠時拉起是唯一的事。
  const ias = Math.sqrt(2 * self.diag.aero.qbar / RHO0)
  if (gamma < 0 && ias > cfg.overspeedRatio * self.spec.limits.vne) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)
    out.aimWorld.copy(horiz)
    out.throttle = 0
    out.brake = 0
    return 'overspeed'
  }
```
`safety.ts` 匯入 `RHO0`。**`firing`／`bombing` 不動** —— 守線不是閃避，開火權留給上層。

- [ ] **Step 4: 跑，確認綠** —— `npx vitest run test/unit/ai-safety.test.ts`。

- [ ] **Step 5: 變異測試** —— 把 `gamma < 0 &&` 拿掉，「爬升 → none」那條要紅；放回去。

- [ ] **Step 6: Commit**

```bash
git add src/ai/safety.ts test/unit/ai-safety.test.ts
git commit -m "feat(ai): 安全層守紅線 —— 俯衝到 0.9 vne 就收油門抬平"
```

---

### Task 5: 規則 3 的俯衝目標

**Files:**
- Modify: `src/ai/steer.ts`（`Knobs` 加 `diveIas`；新增純函數 `redlineDiveIas`；`extend` 分支）
- Modify: `src/ai/AiController.ts:437`（`knobs` 初值）、`:794` 附近（每步算 `diveIas`）
- Test: `test/unit/ai-rules.test.ts` 或新檔 `test/unit/redline-dive.test.ts`（純函數 + 分支）

**Interfaces:**
- Produces: `export function redlineDiveIas(vneSelf: number, vneTarget: number, cfg = DEFAULT_STEER): number`（0 = 沒有餘裕）；`Knobs.diveIas: number`；`SteerConfig.diveSelfRatio = 0.90`、`diveTargetRatio = 1.05`。

- [ ] **Step 1: 寫失敗的測試**

```ts
describe('redlineDiveIas', () => {
  it('F4F 對 A6M 有餘裕：目標是對手紅線 × 1.05', () => {
    expect(redlineDiveIas(F4F4.limits.vne, A6M5.limits.vne)).toBeCloseTo(1.05 * A6M5.limits.vne, 6)
  })
  it('P-51 對 Bf109 沒有餘裕 → 0', () => {
    expect(redlineDiveIas(P51D.limits.vne, BF109K4.limits.vne)).toBe(0)
  })
  it('同機種 → 0', () => {
    expect(redlineDiveIas(A6M5.limits.vne, A6M5.limits.vne)).toBe(0)
  })
  it('目標永遠不超過自己的 0.9', () => {
    const v = redlineDiveIas(1000, 100)
    expect(v).toBeLessThanOrEqual(900)
  })
})

describe('extend 分支的俯衝目標', () => {
  it('diveIas > 0 且 IAS 還沒到 → 俯仰是滿俯衝 −extendPitch', () => {
    // 造一台 F4F 在 4000 m、TAS 100 m/s 平飛，sit 為中性、intent extend、
    // knobs.diveIas = 150；呼叫 steerCommand 後 aimWorld 的俯仰角 ≈ −extendPitch
  })
  it('diveIas > 0 且 IAS 已到 → 回到 extendPitchAngle 的正常值', () => {})
  it('diveIas = 0 → 與現在逐位元相同', () => {})
})
```

第二組要看 `test/unit/ai-steer*.test.ts` 或 `controllers.test.ts` 裡現有 `steerCommand` 的呼叫方式照抄（找 `steerCommand(` 的既有測試）。

- [ ] **Step 2: 跑，確認紅**。

- [ ] **Step 3: 實作**

`steer.ts` `SteerConfig`：
```ts
  /** 規則 3 俯衝目標的自身上限，IAS / vne。與安全層的守線同一個數，不能高於它 */
  diveSelfRatio: number
  /** 規則 3 俯衝目標：對手紅線的這個倍數。過一點就夠，多俯衝的高度是白丟的 */
  diveTargetRatio: number
```
`DEFAULT_STEER`：`diveSelfRatio: 0.90, diveTargetRatio: 1.05,`。

```ts
/**
 * 規則 3 的俯衝目標 IAS，m/s。**0 = 沒有實質餘裕，不俯衝。**
 *
 * 【餘裕條件】對手紅線 × 1.05 要低於自己的 × 0.9 才算 —— P-51 對 Bf109
 * （787 對 729）不成立，行為一個字不變；F4F 對 A6M（549 對 630）成立。
 */
export function redlineDiveIas(vneSelf: number, vneTarget: number, cfg: SteerConfig = DEFAULT_STEER): number {
  const target = cfg.diveTargetRatio * vneTarget
  const ceiling = cfg.diveSelfRatio * vneSelf
  return target < ceiling ? target : 0
}
```

`Knobs`：
```ts
  /** 規則 3 的俯衝目標 IAS，m/s。0 = 關閉。由 AiController 每步寫入 */
  diveIas: number
```

`extend` 分支：
```ts
        const clearance = self.state.position.y - seaHeight
        let pitch = extendPitchAngle(sit.cornerRatio, sit.altitudeAdvantage, clearance, cfg)
        // 【規則 3 的俯衝】目標速度還沒到就滿俯衝；離地餘裕的爬升項仍然
        // 蓋在上面（floorDeficit 滿時 extendPitchAngle 已經是正的，取 max）
        if (knobs.diveIas > 0) {
          const ias = self.diag.aero.tas * Math.sqrt(self.diag.air.sigma)
          if (ias < knobs.diveIas) {
            const floor = extendPitchAngle(1, -Infinity, clearance, cfg)  // 只剩離地項
            pitch = Math.max(-cfg.extendPitch, floor > 0 ? floor : -cfg.extendPitch)
          }
        }
        unloadAim(self, pitch, out.aimWorld)
```

`extendPitchAngle(1, -Infinity, …)`：`cornerRatio = 1` 讓速度項為 0，`altitudeAdvantage = −Infinity` 被 `Number.isFinite` 擋掉讓高度差項為 0，剩下離地項。**確認 `altitudeAdvantage` 傳 `-Infinity` 時 `gapDeficit` 真的是 0** —— 讀 `extendPitchAngle` 那段 `Number.isFinite(altitudeAdvantage)`。

`AiController`：
- `:437` 初值 `{ leadLag: 1, vertical: 0, diveIas: 0 }`。
- `:794` `engageKnobs(this.sit, this.knobs)` 之後：
```ts
    // 【規則 3 的俯衝目標】steerCommand 讀不到 RuleState，這裡算好塞進 knobs
    this.knobs.diveIas = this.rules.trackExtend > 0
      ? redlineDiveIas(self.spec.limits.vne, target.spec.limits.vne)
      : 0
```
`engageKnobs` 若整個重設 `out`，要確認它不會把 `diveIas` 洗掉（它只寫 `leadLag`／`vertical`）。

- [ ] **Step 4: 跑，確認綠**。

- [ ] **Step 5: 起始一致性測試** —— `DEFAULT_STEER.diveSelfRatio <= DEFAULT_SAFETY.overspeedRatio`（俯衝目標不得高於守線）。放在 `ai-safety.test.ts`。

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts src/ai/AiController.ts test/unit/redline-dive.test.ts test/unit/ai-safety.test.ts
git commit -m "feat(ai): 規則 3 有紅線餘裕時俯衝到對手放手的速度"
```

---

### Task 6: 單機護欄

**Files:**
- Create: `test/integration/redline.test.ts`

**Interfaces:**
- Consumes: `battleConfigFrom(uniform('f4f4', 20, 'a6m5', 20))`、`AiController.rules.trackExtend`、`.intent`、`aircraft.diag.aero.tas`、`diag.air.sigma`、`spec.limits.vne`。

- [ ] **Step 1: 先量基準** —— 用 `test/tools/` 寫一支臨時探針（結構照 `turn-disadvantage.test.ts` 的 `solo()`），量 Task 5 **之前**（`git stash` 禁用；用 `DEFAULT_STEER.diveTargetRatio = 10`（讓餘裕永遠不成立）當關閉開關）與之後的：
  - F4F 座位 0 規則 3 脫離時「離最近敵機」的變化率（m/s）
  - 全部 A6M 追擊中（`intent` 為 approach／engage）IAS / vne 的最大值
  - A6M 撞海數
  記下數字，探針刪掉。

- [ ] **Step 2: 寫護欄**

```ts
describe('紅線：F4F 對 A6M', () => {
  let s: Redline
  beforeAll(() => { s = measure() }, 600_000)

  it('F4F 規則 3 脫離時真的在拉開 —— 比沒有俯衝目標時快', () => {
    // 門檻由 Step 1 的兩個數字定：取兩者中點，先驗紅（把 diveTargetRatio 設 10 跑一次要紅）
    expect(s.separationRate).toBeGreaterThan(THRESHOLD)
  })
  it('A6M 追擊時 IAS 從不超過 0.92 vne —— 守線有 0.02 給反應延遲', () => {
    expect(s.maxPursuitRatio).toBeLessThan(0.92)
  })
  it('A6M 沒有撞海', () => {
    expect(s.seaCrashes).toBe(0)
  })
})
```

- [ ] **Step 3: 先驗紅** —— 第一條用 `diveTargetRatio = 10` 跑要紅；第二條把 `overspeedRatio` 設 2 跑要紅。改回。

- [ ] **Step 4: 跑綠**；**Step 5: Commit** `test: 紅線的單機護欄`。

---

### Task 7: 轟炸機不能被紅線害死

**Files:**
- 臨時探針（不入庫）：B-17 護送場（`ESCORT_B17` 的場景，見 `test/tools/spawn-snapshot.ts` 的 `SCENES`）與 He 111 的 `bombRun`。

- [ ] **Step 1: 量** —— 300 秒內每一架轟炸機 IAS / vne 的最大值、有沒有觸發 `'overspeed'`、撞海數。
- [ ] **Step 2: 判讀** —— 最大值 < 0.85：沒事，記在 PLAN 收尾。0.85～0.9：HUD 會黃但物理輕微，記錄。> 0.9 且觸發守線把投彈打斷：**停下來回報負責人**，不要自己改 `bombRun`。

---

### Task 8: 收尾

- [ ] `npx tsc --noEmit 2>&1 | grep -c "error TS"` 必須 ≤ 24。
- [ ] `npx vitest run > out.txt 2>&1; echo $?` —— **拿 vitest 自己的離開碼**，不要接 tail。
- [ ] `order-of-battle-replay` 三個校驗和不變（Task 1 Step 5 已驗，這裡再驗一次）。
- [ ] Codex 審查：`codex exec -s danger-full-access`，prompt 走 stdin，**背景執行**。收查證過的缺陷，加結構的建議要它先證明少了會壞。
- [ ] 開發伺服器 `npx vite --port 5182 --strictPort` 背景，回報可以試飛的配置：遭遇戰 20 F4F 對 20 A6M；HUD 看零戰貼海全速會黃、俯衝到紅線幾乎轉不動；F4F 被咬時低頭、零戰追到一半放手。
