# 低速操控權衰減實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓飛機在低速時失去舵面效力，使垂直懸掛從免費的招式變成有代價的決定，而 AI 仍然救得回來。

**Architecture:** 在 `aero.ts` 既有的高速端 `controlEffectiveness` 之外補一個低速端乘數，兩者相乘後套在三個舵面偏轉量上。拐點動壓由 `q_low = 1.44 × W / (S · CL_max)` 得出——這個量與高度無關，所以是每機種一個常數。物理層算出的乘數經 `StepDiagnostics` 送到 HUD 顯示獨立的低速警告。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess`）、three.js（僅 `Vector3` / `Quaternion` 型別）、Vitest。無新增執行期相依。

規格：`docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md`

---

## Global Constraints

以下逐條抄自 spec，**每一個任務的要求都隱含包含本節**。

- **拐點 1.2 × Vs(1 G)**，即 `q_low = 1.44 × W / (S · CL_max)`（spec §2、§4.1）。
- **衰減陡度 m = 1**，乘數就是 `q / q_low`，不是次方（spec §2、§4.1）。
- **三軸統一**：副翼、升降舵、方向舵乘同一個因子，不做差異化（spec §2）。
- **螺旋槳扭矩與 P-factor 維持關閉**，沿用 M1 §6.4（spec §2）。
- **`CL_max` 的慣例必須與 `analysis/envelope.ts` 的 `stallSpeed()` 完全一致**：`derivedClMax(spec, spec.lift.slatAlphaBonus > 0)`。否則 109 的拐點會對不上它自己的 Vs（spec §4.3）。
- **不需要下限**：速度趨近 0 時力矩本來就趨近 0，乘數再小也不會除出無限大或 NaN（spec §4.5）。
- **不動既有的 `controlEffectiveness`**——它的測試一條都不用改。新函數獨立、獨立測試，兩者在 `aeroForceMoment` 裡相乘（spec §7）。
- **指揮儀不預先加 anti-windup**，改用驗收條件 6 去量（spec §5.2）。
- **`stallGuardSpeed` (1.4) 必須大於本設計的 1.2**，AI 才會在物理懲罰它之前放棄追高（spec §5.3）。
- **熱路徑零配置**。沿用 M1 §15 的紀律。
- **既有的 1,217 條測試全程必須維持全綠**（spec §8.1、§9.5）。

### 已由既有測試涵蓋、本計畫不重寫

驗收條件 2（持續轉彎率交叉點仍在 280–380 km/h）**已經有測試**：`test/balance/relative.test.ts:200`。它由 `analysis/envelope.ts` 的閉式求解得出，完全不經過舵面，結構上不可能被本次改動影響。Task 6 只要確認它仍綠即可，不新增重複的斷言。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/physics/aero.ts` | 新增 `stallDynamicPressure`、`LOW_SPEED_KNEE`、`lowSpeedEffectiveness`；在 `aeroForceMoment` 裡乘進三個舵面 |
| `src/physics/dynamics.ts` | `StepDiagnostics.controlAuthority`，由 `stepDynamics` 每步寫入 |
| `src/hud/types.ts` | `HudFrame.controlAuthority` |
| `src/hud/widgets/energy.ts` | `LOW SPEED` 警告（與 `STALL` 並列，兩者獨立） |
| `src/main.ts` | `diag.controlAuthority` → `hudFrame.controlAuthority` |
| `test/unit/aero.test.ts` | L1 純函數（Task 1）、力矩實際衰減（Task 2） |
| `test/unit/dynamics.test.ts` | `stepDynamics` 寫入 diag（Task 2） |
| `test/unit/hud.test.ts` | `HudFrame` 初值（Task 3） |
| `test/integration/low-speed-authority.test.ts` | L4-A 脫離（Task 4）、L4-B AI 救機（Task 5） |

修改：spec 的 §8.2 回填、`README.md`。

---

## Task 1: 失速動壓與低速衰減乘數（純函數）

**Files:**
- Modify: `src/physics/aero.ts`
- Test: `test/unit/aero.test.ts`（增補）

**Interfaces:**
- Consumes: `derivedClMax`（`src/specs/types.ts`，已在 `aero.ts` import）、`G0`（`src/core/math.ts`）
- Produces:
  - `const LOW_SPEED_KNEE = 1.44`
  - `function stallDynamicPressure(spec: AircraftSpec): number`
  - `function lowSpeedEffectiveness(spec: AircraftSpec, qbar: number): number`

本任務**只加純函數，不接線**。接線在 Task 2，這樣「函數本身對不對」與「接進去會不會弄壞既有行為」可以分開被審。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/aero.test.ts` 追加。檔頭的 import 補上三個新函數與 `stallSpeed`：

```ts
import {
  liftCoefficient, dragCoefficient, inducedDragFactor, controlEffectiveness,
  lowSpeedEffectiveness, stallDynamicPressure, LOW_SPEED_KNEE,
  updateSlatState, computeAeroState, aeroForceMoment,
} from '../../src/physics/aero'
import { stallSpeed } from '../../src/analysis/envelope'
```

檔尾追加：

```ts
describe('stallDynamicPressure', () => {
  /**
   * 【這是整個設計成立的關鍵性質】1 G 失速時的動壓與高度無關：
   *
   *   Vs(1G) = √( 2W / (ρ·S·CLmax) )
   *   q      = ½ρ·Vs² = W / (S·CLmax)      ← ρ 消掉了
   *
   * 所以拐點是每機種一個常數，不必查大氣、不必開根號。而且它自動處理
   * 高度——9,000 m 要 268 km/h 才有同樣的動壓，這正是真實情況。
   */
  it('與高度無關：對照 stallSpeed() 在四個高度算出的 ½ρVs²', () => {
    for (const spec of [P51D, BF109G6]) {
      const expected = stallDynamicPressure(spec)
      for (const alt of [0, 3000, 6000, 9000]) {
        const vs = stallSpeed(spec, alt, 1)
        const a = air(alt)
        expect(0.5 * a.density * vs * vs).toBeCloseTo(expected, 6)
      }
    }
  })

  /**
   * 【CL_max 的慣例必須與 stallSpeed() 對齊】上面那條測試同時驗了這件事：
   * 若這裡用了不含縫翼加成的 CL_max，109 的值會與 stallSpeed() 差一截，
   * 對照就會失敗。這不是巧合，是刻意讓兩者互相釘死（spec §4.3）。
   */
  it('等於 W / (S · CLmax)，且兩台的實測值', () => {
    expect(stallDynamicPressure(P51D)).toBeCloseTo(
      (P51D.mass * 9.80665) / (P51D.wing.area * derivedClMax(P51D, P51D.lift.slatAlphaBonus > 0)),
      9,
    )
    // 實測值，供日後改參數時一眼看出量級是否跑掉
    expect(stallDynamicPressure(P51D)).toBeCloseTo(1289.9, 0)
    expect(stallDynamicPressure(BF109G6)).toBeCloseTo(1239.0, 0)
  })
})

describe('lowSpeedEffectiveness', () => {
  const knee = (spec: AircraftSpec) => LOW_SPEED_KNEE * stallDynamicPressure(spec)

  it('拐點以上恆為 1', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = knee(spec)
      expect(lowSpeedEffectiveness(spec, q)).toBe(1)
      expect(lowSpeedEffectiveness(spec, q * 1.5)).toBe(1)
      expect(lowSpeedEffectiveness(spec, q * 100)).toBe(1)
    }
  })

  it('拐點以下等於 q / q_low', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = knee(spec)
      expect(lowSpeedEffectiveness(spec, q * 0.5)).toBeCloseTo(0.5, 12)
      expect(lowSpeedEffectiveness(spec, q * 0.25)).toBeCloseTo(0.25, 12)
    }
  })

  it('在拐點連續（左右極限相等）', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = knee(spec)
      const below = lowSpeedEffectiveness(spec, q * (1 - 1e-9))
      expect(below).toBeCloseTo(1, 8)
      expect(lowSpeedEffectiveness(spec, q)).toBe(1)
    }
  })

  it('q = 0 時為 0，不是 NaN', () => {
    // 【為什麼不必設下限】力矩 = 動壓 × 面積 × 係數，動壓為 0 時力矩本來
    // 就是 0。乘數再小也不會除出無限大（spec §4.5）。
    for (const spec of [P51D, BF109G6]) {
      expect(lowSpeedEffectiveness(spec, 0)).toBe(0)
      expect(Number.isFinite(lowSpeedEffectiveness(spec, 0))).toBe(true)
    }
  })

  it('單調遞增', () => {
    const q = knee(P51D)
    let prev = -1
    for (let f = 0; f <= 1.5; f += 0.05) {
      const v = lowSpeedEffectiveness(P51D, q * f)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  /**
   * 【拐點以上到高速變重之間有一大段完全不受影響】P-51D 的 q_low 是
   * 1858 Pa、q_ref 是 10884 Pa，相隔 5.9 倍。兩個機制不會同時作用。
   */
  it('低速端與高速端的作用區間不重疊', () => {
    for (const spec of [P51D, BF109G6]) {
      expect(knee(spec)).toBeLessThan(spec.controlStiffening.qRef)
      // 在兩者中間取一點，兩個乘數都應該是 1
      const mid = Math.sqrt(knee(spec) * spec.controlStiffening.qRef)
      expect(lowSpeedEffectiveness(spec, mid)).toBe(1)
      expect(controlEffectiveness(
        spec.controlStiffening.elevatorK, spec.controlStiffening.qRef, mid,
      )).toBe(1)
    }
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/aero.test.ts`
Expected: FAIL，`lowSpeedEffectiveness is not a function`（或 import 解析失敗）。

- [ ] **Step 3: 在 `src/physics/aero.ts` 加三個 export**

檔頭的 import 補上 `G0`：

```ts
import { G0, smoothstep } from '../core/math'
```

在既有的 `controlEffectiveness` 之後加：

```ts
/**
 * 拐點動壓相對 1 G 失速動壓的倍率。**1.2² = 1.44** —— 拐點在 1.2 × Vs。
 *
 * 【為什麼是 1.2】實測纏鬥不會發生在 1.44 × Vs 以下（最佳持續轉彎
 * 1.44–1.61、109／P-51 轉彎率交叉區 1.69–2.35、角落速度 2.74–2.83），
 * 所以 1.2 與有戰術意義的速度有安全距離。真實世界的進場速度也訂在
 * 1.2–1.3 × Vs，理由正是「操縱仍堪用但已開始變軟」（spec §3）。
 */
export const LOW_SPEED_KNEE = 1.44

/**
 * 1 G 失速時的動壓，Pa。**與高度無關。**
 *
 *   Vs(1G) = √( 2W / (ρ·S·CLmax) )
 *   q      = ½ρ·Vs² = W / (S·CLmax)      ← ρ 消掉了
 *
 * 所以低速拐點是每機種一個常數：P-51D 1290 Pa、Bf 109 1239 Pa。不必查
 * 大氣、不必開根號，而且它自動處理高度——9,000 m 要 268 km/h 才有同樣的
 * 動壓，這正是真實情況。
 *
 * 【CL_max 的慣例】用 `derivedClMax(spec, 有縫翼就當展開)`，與
 * `analysis/envelope.ts` 的 `stallSpeed()` **完全一致**。否則 109 的拐點會
 * 對不上它自己的 Vs，「1.2 × Vs」在兩個地方會是不同的意思（spec §4.3）。
 */
export function stallDynamicPressure(spec: AircraftSpec): number {
  return (spec.mass * G0)
    / (spec.wing.area * derivedClMax(spec, spec.lift.slatAlphaBonus > 0))
}

/**
 * 低速舵面失效：δ_eff = δ × min(1, q / q_low)。
 *
 * 【為什麼這樣就會產生懲罰】舵面力矩與氣動阻尼**原本都正比於動壓**，
 * 比值與速度無關——這正是未修正前飛機能在 15 km/h 維持乾淨姿態的原因：
 * 能達到的角**速率**幾乎不隨速度變化。乘上這個因子之後控制力矩被砍、
 * 阻尼不變，飛機變糊，重力接管（spec §4.4）。
 *
 * 【為什麼不設下限】速度趨近 0 時力矩本來就趨近 0（力矩 = 動壓 × 面積 ×
 * 係數），乘數再小也不會除出無限大或 NaN（spec §4.5）。
 */
export function lowSpeedEffectiveness(spec: AircraftSpec, qbar: number): number {
  const qLow = LOW_SPEED_KNEE * stallDynamicPressure(spec)
  return qbar >= qLow ? 1 : qbar / qLow
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/aero.test.ts`
Expected: PASS。

若「與高度無關」那條失敗且 109 差得比 P-51 多，檢查 `derivedClMax` 的第二個參數 ——
慣例必須與 `envelope.ts` 的 `clMaxFor` 一致（`spec.lift.slatAlphaBonus > 0`）。

- [ ] **Step 5: 全套回歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠（1,217 + 8 = 1,225）。**這一步不該有任何既有測試變紅** —— 新函數還沒有任何呼叫端。

- [ ] **Step 6: Commit**

```bash
git add src/physics/aero.ts test/unit/aero.test.ts
git commit -m "feat(physics): 低速舵面失效的純函數（失速動壓與衰減乘數）"
```

---

## Task 2: 接進 aeroForceMoment 與 StepDiagnostics

**Files:**
- Modify: `src/physics/aero.ts`（`aeroForceMoment` 內的三行舵面計算）
- Modify: `src/physics/dynamics.ts`（`StepDiagnostics`、`createDiagnostics`、`stepDynamics`）
- Test: `test/unit/aero.test.ts`（增補）、`test/unit/dynamics.test.ts`（增補）

**Interfaces:**
- Consumes: `lowSpeedEffectiveness`（Task 1）
- Produces: `StepDiagnostics.controlAuthority: number`（0..1，1 = 完全有效）

**這是本計畫唯一有機會弄壞既有測試的任務。** spec §5.1 已實測波及範圍近乎為零：衰減門檻換算成空速是海平面 55 m/s，而既有測試最低飛 70 m/s、其餘 110 m/s 以上。唯一貼近的是 `pitch-limiter-departure` 的 70 m/s 組，它在 6 秒猛拉中會減速，但該測試斷言「峰值迎角不超過失速臨界角」，舵面變弱只會讓迎角**更低**，往安全方向移動。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/aero.test.ts` 追加：

```ts
describe('aeroForceMoment 的低速舵面衰減', () => {
  const ZERO_OMEGA = new Vector3()

  /**
   * 取「升降舵由 0 打到 1」造成的俯仰力矩增量，換算回力矩係數。
   *
   * 【為什麼可以直接捏造 AeroState】角速度給 0 時 pHat/qHat/rHat 全部為 0，
   * `aero.tas` 於是完全不進入力矩計算——只有 `qbar` 進得去。所以捏一個
   * tas 與 qbar 不自洽的狀態是安全的，而且能把 q 的依賴單獨隔離出來。
   *
   * 俯仰力矩在標準軸是 y，`stdToBody` 把它放到機體 x（見 aeroForceMoment
   * 檔內的軸向註解）。
   */
  const elevatorCmDe = (spec: AircraftSpec, qbar: number): number => {
    const st: AeroState = { tas: 100, alpha: 0, beta: 0, qbar, mach: 0 }
    const fm = fmOut()
    aeroForceMoment(spec, st, ZERO_OMEGA, NO_CONTROL, false, fm)
    const base = fm.moment.x
    aeroForceMoment(spec, st, ZERO_OMEGA, { ...NO_CONTROL, elevator: 1 }, false, fm)
    return (fm.moment.x - base) / (qbar * spec.wing.area * spec.wing.chord)
  }

  it('拐點以上：升降舵力矩係數就是 cmDe，未被衰減', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = LOW_SPEED_KNEE * stallDynamicPressure(spec) * 1.5
      expect(elevatorCmDe(spec, q)).toBeCloseTo(spec.moments.cmDe, 9)
    }
  })

  it('拐點以下：力矩係數等於 cmDe × (q / q_low)', () => {
    for (const spec of [P51D, BF109G6]) {
      const qLow = LOW_SPEED_KNEE * stallDynamicPressure(spec)
      for (const frac of [0.75, 0.5, 0.25]) {
        expect(elevatorCmDe(spec, qLow * frac))
          .toBeCloseTo(spec.moments.cmDe * frac, 9)
      }
    }
  })

  /**
   * 【三軸統一】專案負責人裁決：不做副翼／升降舵／方向舵的差異化。
   * 這一條把它釘死——日後若有人只改了其中一個軸，這裡會紅。
   */
  it('三個舵面乘的是同一個因子', () => {
    const spec = P51D
    const qLow = LOW_SPEED_KNEE * stallDynamicPressure(spec)
    const q = qLow * 0.4
    const st: AeroState = { tas: 100, alpha: 0, beta: 0, qbar: q, mach: 0 }
    const fm = fmOut()
    const { area, span, chord } = spec.wing

    aeroForceMoment(spec, st, ZERO_OMEGA, NO_CONTROL, false, fm)
    const b = { x: fm.moment.x, y: fm.moment.y, z: fm.moment.z }

    aeroForceMoment(spec, st, ZERO_OMEGA, { ...NO_CONTROL, aileron: 1 }, false, fm)
    const clDa = (fm.moment.z - b.z) / (q * area * span)
    aeroForceMoment(spec, st, ZERO_OMEGA, { ...NO_CONTROL, elevator: 1 }, false, fm)
    const cmDe = (fm.moment.x - b.x) / (q * area * chord)
    aeroForceMoment(spec, st, ZERO_OMEGA, { ...NO_CONTROL, rudder: 1 }, false, fm)
    const cnDr = (fm.moment.y - b.y) / (q * area * span)

    // 三個都被同一個 0.4 砍過（副翼與方向舵的軸向帶負號，取比值即可）
    expect(Math.abs(clDa / spec.moments.clDa)).toBeCloseTo(0.4, 9)
    expect(Math.abs(cmDe / spec.moments.cmDe)).toBeCloseTo(0.4, 9)
    expect(Math.abs(cnDr / spec.moments.cnDr)).toBeCloseTo(0.4, 9)
  })

  /**
   * 【L3 相對關係】同一個 TAS 下，高空的動壓較低，所以操縱權較低。
   * 這是本設計「自動處理高度」那句話的具體兌現。
   */
  it('同一個 TAS 下，高空的操縱權低於低空', () => {
    const tas = 60
    const low = air(0)
    const high = air(6000)
    const qLow = 0.5 * low.density * tas * tas
    const qHigh = 0.5 * high.density * tas * tas
    expect(lowSpeedEffectiveness(P51D, qHigh))
      .toBeLessThan(lowSpeedEffectiveness(P51D, qLow))
  })

  /**
   * 【L3 相對關係】同一個動壓、兩台都在各自拐點以下時，操縱權的比例
   * 等於它們 q_low 的反比。
   */
  it('同一個動壓下，兩機種的操縱權成 q_low 的反比', () => {
    const q = 800   // 遠低於兩台的 q_low（1858 / 1784）
    const ratio = lowSpeedEffectiveness(P51D, q) / lowSpeedEffectiveness(BF109G6, q)
    expect(ratio).toBeCloseTo(
      stallDynamicPressure(BF109G6) / stallDynamicPressure(P51D), 9,
    )
  })
})
```

在 `test/unit/dynamics.test.ts` 追加。該檔已經 import 了 `createDiagnostics`、
`createFlightState`、`stepDynamics` 與 `P51D`，**只需新增一行**：

```ts
import { lowSpeedEffectiveness } from '../../src/physics/aero'
```


```ts
describe('stepDynamics 的 controlAuthority', () => {
  const CONTROLS = { aileron: 0, elevator: 0, rudder: 0, throttle: 0.7, brake: 0 }

  it('createDiagnostics 的初值是 1（完全有效）', () => {
    expect(createDiagnostics().controlAuthority).toBe(1)
  })

  it('巡航速度下為 1', () => {
    const state = createFlightState(3000, 150)
    const diag = createDiagnostics()
    stepDynamics(P51D, state, CONTROLS, 1 / 240, diag)
    expect(diag.controlAuthority).toBe(1)
  })

  it('低速時等於 lowSpeedEffectiveness(spec, 當前動壓)', () => {
    const state = createFlightState(3000, 40)
    const diag = createDiagnostics()
    stepDynamics(P51D, state, CONTROLS, 1 / 240, diag)
    expect(diag.controlAuthority).toBeCloseTo(
      lowSpeedEffectiveness(P51D, diag.aero.qbar), 12,
    )
    expect(diag.controlAuthority).toBeLessThan(1)
    expect(diag.controlAuthority).toBeGreaterThan(0)
  })

  it('速度為 0 時為 0，且不產生 NaN', () => {
    const state = createFlightState(3000, 0)
    state.velocity.set(0, 0, 0)
    const diag = createDiagnostics()
    stepDynamics(P51D, state, CONTROLS, 1 / 240, diag)
    expect(diag.controlAuthority).toBe(0)
    expect(Number.isFinite(state.position.y)).toBe(true)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/aero.test.ts test/unit/dynamics.test.ts`
Expected: FAIL —— aero 的衰減斷言拿到未衰減的 `cmDe`；dynamics 的 `controlAuthority` 是 `undefined`。

- [ ] **Step 3: 在 `aeroForceMoment` 裡乘上因子**

把既有的三行改成：

```ts
  const CS = spec.controlStiffening
  // 【低速衰減與高速變重是同一個概念的兩端】兩者相乘。中間有一大段兩者
  // 都不作用——P-51D 是 1858 → 10884 Pa，相隔 5.9 倍（spec §4.2）。
  //
  // 三軸乘同一個因子是專案負責人的裁決：不做副翼／升降舵／方向舵的差異化。
  const low = lowSpeedEffectiveness(spec, aero.qbar)
  const da = controls.aileron * low * controlEffectiveness(CS.aileronK, CS.qRef, aero.qbar)
  const de = controls.elevator * low * controlEffectiveness(CS.elevatorK, CS.qRef, aero.qbar)
  const dr = controls.rudder * low * controlEffectiveness(CS.rudderK, CS.qRef, aero.qbar)
```

- [ ] **Step 4: 在 `dynamics.ts` 加 `controlAuthority`**

檔頭的 import 補上 `lowSpeedEffectiveness`：

```ts
import {
  aeroForceMoment, computeAeroState, lowSpeedEffectiveness, updateSlatState,
} from './aero'
```

（若既有 import 的成員不同，只需把 `lowSpeedEffectiveness` 加進同一個 `from './aero'` 的清單。）

`StepDiagnostics` 介面加：

```ts
  /**
   * 低速舵面效力，0..1。1 = 完全有效。
   *
   * 【為什麼放在 diag 而不是各自重算】HUD 要顯示的正是這個乘數。走
   * diag 讓物理與畫面共用同一份數字，不會出現第二套會漂掉的判斷邏輯
   * （低速操控權 spec §6）。
   */
  controlAuthority: number
```

`createDiagnostics()` 的回傳物件加：

```ts
    controlAuthority: 1,
```

`stepDynamics` 裡，緊接在 `computeAeroState` 那一行之後加：

```ts
  diag.controlAuthority = lowSpeedEffectiveness(spec, diag.aero.qbar)
```

**放在 `aeroForceMoment` 之前是刻意的**：`aeroForceMoment` 在 `qbar <= 0` 時會提早回傳，若把這一行放在它後面，靜止狀態下 `controlAuthority` 會停在上一步的舊值。

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/unit/aero.test.ts test/unit/dynamics.test.ts`
Expected: PASS。

- [ ] **Step 6: 全套回歸 —— 這一步是本任務的重點**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。

**若有既有測試變紅，先分類再動手**：

1. **它是在驗史實數字嗎**（極速、爬升率、失速速度、升限、轉彎率交叉點）？那些由 `analysis/envelope.ts` 的閉式求解得出，完全不經過舵面 —— 若它們紅了，代表接線接錯地方，回頭檢查 Step 3。
2. **它是 `pitch-limiter-departure` 的 70 m/s 組嗎**？該測試斷言「峰值迎角不超過失速臨界角」，舵面變弱只會讓迎角更低。若它反而紅了，印出峰值迎角確認方向 —— 變高才是真的有問題。
3. **其他**：印出該測試飛的速度與對應動壓，與 `1.44 × stallDynamicPressure(spec)` 比較。若動壓遠高於拐點卻仍受影響，代表因子算錯。

- [ ] **Step 7: Commit**

```bash
git add src/physics/aero.ts src/physics/dynamics.ts test/unit/aero.test.ts test/unit/dynamics.test.ts
git commit -m "feat(physics): 低速舵面失效接進 aeroForceMoment 與 StepDiagnostics"
```

---

## Task 3: HUD 低速警告

**Files:**
- Modify: `src/hud/types.ts`
- Modify: `src/hud/widgets/energy.ts`
- Modify: `src/main.ts`
- Test: `test/unit/hud.test.ts`（增補）

**Interfaces:**
- Consumes: `StepDiagnostics.controlAuthority`（Task 2）
- Produces: `HudFrame.controlAuthority: number`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/hud.test.ts` 追加：

```ts
describe('低速操縱權警告', () => {
  it('新的 frame 是完全有效', () => {
    expect(createHudFrame().controlAuthority).toBe(1)
  })

  /**
   * 【為什麼不沿用 STALL】現有的 STALL 以 `|α| / α_crit` 觸發，而垂直爬升時
   * 攻角接近 0——它一次都不會亮，即使飛機正在變得不可控。這與 M4 出貨後
   * 修掉的 AI 缺陷（`stallMargin` 對「快沒空速」是瞎的）是同一個盲區。
   *
   * 語意也不同：垂直爬升時你離失速很遠，你只是快沒速度了。
   */
  it('初始值不含 NaN', () => {
    expect(Number.isFinite(createHudFrame().controlAuthority)).toBe(true)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: FAIL，`expected undefined to be 1`。

- [ ] **Step 3: 在 `src/hud/types.ts` 加欄位**

`HudFrame` 介面裡，緊接在 `hpMax` 之後加：

```ts
  /**
   * 低速舵面效力，0..1。< 1 時 HUD 顯示 `LOW SPEED`。
   *
   * 由 `StepDiagnostics.controlAuthority` 抄過來——物理與畫面共用同一份
   * 數字，不會出現第二套會漂掉的判斷邏輯。
   */
  controlAuthority: number
```

`createHudFrame()` 的回傳物件裡，緊接在 `aiFlying: false,` 之後加：

```ts
    controlAuthority: 1,
```

- [ ] **Step 4: 在 `src/hud/widgets/energy.ts` 畫警告**

檔案最上方、`drawEnergy` 之前加常數：

```ts
/**
 * 低於此效力轉為危險色。`(1 / 1.2)² = 0.694` —— 速度剛好掉到 1 G 失速
 * 速度的那一點。不是配出來的數字。
 */
const LOW_SPEED_DANGER = 1 / 1.44
```

在既有的失速警告區塊之後加：

```ts
  // 低速警告。
  // 【為什麼不沿用 STALL】STALL 以 |α|/α_crit 觸發，而垂直爬升時攻角接近
  // 0——它一次都不會亮，即使飛機正在變得不可控。語意也不同：你離失速很遠，
  // 你只是快沒速度了。把兩者混在同一個字樣下會讓玩家學到錯的因果。
  if (f.controlAuthority < 1) {
    ctx.fillStyle = f.controlAuthority < LOW_SPEED_DANGER
      ? HUD_COLORS.danger
      : HUD_COLORS.warn
    ctx.font = hudFont(18 * L.scale, true)
    ctx.textAlign = 'center'
    ctx.fillText('LOW SPEED', L.cx, L.height * 0.29)
  }
```

**位置 0.29 是刻意的**：`STALL` 在 0.24、字級 22，`LOW SPEED` 字級 18，兩者不重疊。兩個警告可以同時亮 —— 它們是兩件不同的事。

- [ ] **Step 5: 在 `src/main.ts` 接線**

在 `hudFrame.aiFlying = input.playerAi` 那一行之後加：

```ts
  hudFrame.controlAuthority = aircraft.diag.controlAuthority
```

- [ ] **Step 6: 執行測試與建置**

Run: `npx tsc --noEmit && npx vitest run test/unit/hud.test.ts && npx vite build`
Expected: 全部通過、建置成功。

- [ ] **Step 7: 全套回歸**

Run: `npx vitest run`
Expected: 全綠。

- [ ] **Step 8: Commit**

```bash
git add src/hud src/main.ts test/unit/hud.test.ts
git commit -m "feat(hud): LOW SPEED 警告，與 STALL 分開（後者對垂直爬升是瞎的）"
```

---

## Task 4: L4-A —— 脫離必須發生

**Files:**
- Create: `test/integration/low-speed-authority.test.ts`
- Modify: `docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md`（回填 §8.2 的門檻）

**Interfaces:**
- Consumes: `stepDynamics` / `createDiagnostics` / `createFlightState`（`src/physics/dynamics.ts`）、`lowSpeedEffectiveness` / `stallDynamicPressure` / `LOW_SPEED_KNEE`（Task 1）
- Produces: 無（純測試）

驗收條件 3 與 4（spec §8.2）。**spec 刻意沒有給門檻數字** —— 本任務先量再定，比照 M2 的命中盒座標與 M4 的 25 個門檻。

**為什麼用 `stepDynamics` 而不是 `Aircraft`**：這一條驗的是**物理**，不是指揮儀。直接給固定的滿舵指令，把「舵面打滿換得到多少俯仰率」單獨隔離出來 —— 這與 `pitch-limiter-departure.test.ts` 的做法一致。

- [ ] **Step 1: 先量，把數字印出來**

建立 `test/integration/low-speed-authority.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import { LOW_SPEED_KNEE, stallDynamicPressure } from '../../src/physics/aero'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls } from '../../src/physics/types'
import { RAD } from '../../src/core/math'

const DT = 1 / 240
const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)

interface Sample {
  t: number
  altitude: number
  tas: number
  /** 滿舵指令下的機體俯仰率，°/s */
  pitchRate: number
  /** 機首仰角，° */
  noseElevation: number
  authority: number
}

/**
 * 垂直向上、升降舵打滿，全程取樣。
 *
 * 【為什麼不用 Aircraft】這一條驗的是物理不是指揮儀。固定滿舵把
 * 「舵面打滿換得到多少俯仰率」單獨隔離出來。
 */
function verticalHang(spec: AircraftSpec, altitude: number, tas: number, seconds: number): Sample[] {
  const state = createFlightState(altitude, tas)
  state.velocity.copy(UP).multiplyScalar(tas)
  state.orientation.setFromUnitVectors(FWD, UP)
  const diag = createDiagnostics()
  const controls: Controls = { aileron: 0, elevator: 1, rudder: 0, throttle: 1.1, brake: 0 }

  const nose = new Vector3()
  const out: Sample[] = []
  const steps = Math.round(seconds / DT)
  for (let i = 0; i <= steps; i++) {
    stepDynamics(spec, state, controls, DT, diag)
    if (i % 24 !== 0) continue
    nose.copy(FWD).applyQuaternion(state.orientation)
    out.push({
      t: i * DT,
      altitude: state.position.y,
      tas: state.velocity.length(),
      pitchRate: Math.abs(state.angularVelocity.x) * RAD,
      noseElevation: Math.asin(Math.max(-1, Math.min(1, nose.y))) * RAD,
      authority: diag.controlAuthority,
    })
  }
  return out
}

describe('L4-A 量測：垂直懸掛時滿舵換得到多少俯仰率', () => {
  it('印出全程取樣（觀測用，不是門檻）', () => {
    for (const spec of [P51D, BF109G6]) {
      const qLow = LOW_SPEED_KNEE * stallDynamicPressure(spec)
      console.log(`\n=== ${spec.name}（q_low = ${qLow.toFixed(0)} Pa）===`)
      console.log('  t(s)   高度   TAS(km/h)   俯仰率(°/s)   機首仰角(°)   authority')
      for (const s of verticalHang(spec, 1000, 200, 34)) {
        console.log(
          `  ${s.t.toFixed(1).padStart(4)}  ${s.altitude.toFixed(0).padStart(5)}`
          + `  ${(s.tas * 3.6).toFixed(0).padStart(8)}`
          + `  ${s.pitchRate.toFixed(1).padStart(10)}`
          + `  ${s.noseElevation.toFixed(0).padStart(10)}`
          + `  ${s.authority.toFixed(3).padStart(10)}`,
        )
      }
    }
    expect(true).toBe(true)
  })
})
```

Run: `npx vitest run test/integration/low-speed-authority.test.ts`

**把印出來的表存下來**，Step 3 與 spec 回填都要用。

- [ ] **Step 2: 由量測結果訂門檻**

從表裡讀出兩個數字：

1. **`PITCH_RATE_FLOOR`** —— 巡航段（`authority = 1` 的那幾列）的俯仰率，取一個明顯低於它的值當「已經失去姿態控制」的門檻。**取巡航值的四分之一，向下取整到整數**，避免門檻黏在量測雜訊上。
2. **`COLLAPSE_TIME`** —— 表中俯仰率首次跌破 `PITCH_RATE_FLOOR` 的時間，加 2 秒當上限。

**若巡航段的俯仰率本身就很低**（例如小於 5°/s），代表滿舵在垂直姿態下本來就轉不動，這條測試量不到東西 —— 改成把初始速度提高到 250 m/s 重跑 Step 1，並在 spec §8.2 記下這個調整與理由。

- [ ] **Step 3: 把量測改寫成斷言**

把 Step 1 的 `describe` 區塊整段換成：

```ts
/**
 * 【門檻由 Task 4 Step 1 的量測訂出】巡航段（authority = 1）的俯仰率取
 * 四分之一。這不是配出來的數字——它是「舵面打滿卻只剩巡航時四分之一的
 * 效果」這句話的量化，而衰減乘數在該速度下的值也對得上。
 *
 * 實測表見 spec §8.2。
 */
const PITCH_RATE_FLOOR = 0   // ← 由 Step 2 填入
const COLLAPSE_TIME = 0      // ← 由 Step 2 填入，秒

describe('L4-A 脫離必須發生', () => {
  for (const spec of [P51D, BF109G6]) {
    it(`${spec.name}：垂直懸掛時滿舵換不到姿態控制`, () => {
      const samples = verticalHang(spec, 1000, 200, 34)

      // 一：巡航段的滿舵俯仰率遠高於門檻——否則這條測試量不到東西
      const cruising = samples.filter((s) => s.authority === 1)
      expect(cruising.length).toBeGreaterThan(3)
      expect(Math.max(...cruising.map((s) => s.pitchRate)))
        .toBeGreaterThan(PITCH_RATE_FLOOR * 3)

      // 二：低速段必須跌破門檻，且在時限內
      const collapsed = samples.find(
        (s) => s.t > 1 && s.pitchRate < PITCH_RATE_FLOOR,
      )
      expect(collapsed, '俯仰率從未跌破門檻').toBeDefined()
      expect(collapsed!.t).toBeLessThan(COLLAPSE_TIME)

      // 三：全程有限，沒有數值爆掉
      for (const s of samples) {
        expect(Number.isFinite(s.tas)).toBe(true)
        expect(Number.isFinite(s.pitchRate)).toBe(true)
      }
    })

    /**
     * 驗收條件 4：機頭最終被重力帶下來，不會維持指向。
     *
     * 【為什麼要單獨驗這一條】舵面失效只保證「你控制不了」，不保證
     * 「機頭會掉下來」。若氣動阻尼把飛機鎖在垂直姿態，結果會是一架
     * 卡在天上的飛機——那比原本的問題更糟。
     */
    it(`${spec.name}：機頭最終被重力帶下來`, () => {
      const samples = verticalHang(spec, 1000, 200, 34)
      const last = samples[samples.length - 1]!
      expect(last.noseElevation).toBeLessThan(0)
    })
  }
})
```

**把 `PITCH_RATE_FLOOR` 與 `COLLAPSE_TIME` 換成 Step 2 訂出的數字。**

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/integration/low-speed-authority.test.ts`
Expected: PASS（4 條）。

若「機頭最終被重力帶下來」失敗，印出最後 5 秒的 `noseElevation`。若它卡在正值不動，代表氣動阻尼把飛機鎖住了 —— 這是真正需要停下來討論的訊號，回報而不要調門檻。

- [ ] **Step 5: 回填 spec §8.2**

把 Step 1 印出的表與 Step 2 訂出的兩個門檻寫進
`docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md` 的 §8.2，
取代「**條件 3 的量化門檻待實作時量出來再定。**」那一段。格式：

```markdown
**條件 3 的量化門檻（Task 4 實測後回填）**

| 機種 | 巡航段滿舵俯仰率 | `PITCH_RATE_FLOOR` | 首次跌破的時間 | `COLLAPSE_TIME` |
|---|---|---|---|---|
| P-51D | （填入） | （填入） | （填入） | （填入） |
| Bf 109 | （填入） | （填入） | （填入） | （填入） |

門檻取巡航值的四分之一：這不是配出來的數字，而是「舵面打滿卻只剩巡航時
四分之一的效果」這句話的量化。
```

- [ ] **Step 6: 全套回歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add test/integration/low-speed-authority.test.ts docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md
git commit -m "test: L4-A 垂直懸掛時滿舵換不到姿態控制；回填 spec 門檻"
```

---

## Task 5: L4-B —— AI 必須救得回來

**Files:**
- Modify: `test/integration/low-speed-authority.test.ts`（增補）

**Interfaces:**
- Consumes: `AiController`（`src/ai/AiController.ts`）、`Aircraft`、`createCommand`、`stallDynamicPressure` / `LOW_SPEED_KNEE`（Task 1）
- Produces: 無（純測試）

**這是本設計的硬門檻**（spec §8.3、§9.4）。專案負責人的原話：「AI 要有能力救機」。

- [ ] **Step 1: 寫測試**

在 `test/integration/low-speed-authority.test.ts` 追加。檔頭 import 補上：

```ts
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { AiController } from '../../src/ai/AiController'
import { PILOT_G_POSITIVE } from '../../src/control/limiters'
```

檔尾追加：

```ts
interface Recovery {
  /** 是否恢復到可控飛行 */
  recovered: boolean
  /** 恢復所花的秒數；未恢復為 Infinity */
  seconds: number
  /** 全程最低高度，m */
  minAltitude: number
  /** 恢復後三秒內的過載峰值 */
  peakG: number
  finite: boolean
}

/**
 * 把飛機放成垂直懸掛的姿態，交給 AI，看它救不救得回來。
 *
 * 【目標放在很遠的地方】這一條驗的是**救機**，不是纏鬥。目標擺遠讓 AI 的
 * 意圖落在 approach，轉向不會干擾判定；但目標仍然存在，所以走的是完整的
 * 程式路徑而不是「沒有目標」那條捷徑。
 *
 * 【恢復的定義】速度回到拐點以上（舵面重新有效）**而且**航跡角高於 −60°
 * （不是還在直直往下掉）。兩個條件都要，因為單看速度的話，一路俯衝到
 * 底也會「恢復」。
 */
function aiRecovery(spec: AircraftSpec, altitude: number, tas: number): Recovery {
  const self = new Aircraft(spec, altitude, tas)
  self.state.position.set(0, altitude, 0)
  self.state.velocity.copy(UP).multiplyScalar(tas)
  self.state.orientation.setFromUnitVectors(FWD, UP)
  self.prevPosition.copy(self.state.position)
  self.prevOrientation.copy(self.state.orientation)

  const target = new Aircraft(spec, 5000, 180)
  target.state.position.set(0, 5000, -6000)
  target.prevPosition.copy(target.state.position)

  const ai = new AiController()
  ai.target = target
  const cmd = createCommand()

  const qKnee = LOW_SPEED_KNEE * stallDynamicPressure(spec)
  let recoveredAt = Infinity
  let minAltitude = altitude
  let peakG = 0

  for (let i = 0; i < 40 * 240; i++) {
    const t = i * DT
    ai.update(self, DT, cmd)
    self.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake)
    target.update(FWD, 0.7, DT)

    minAltitude = Math.min(minAltitude, self.state.position.y)
    if (!Number.isFinite(self.state.position.y)) {
      return { recovered: false, seconds: t, minAltitude: -Infinity, peakG, finite: false }
    }

    const v = self.state.velocity
    const speed = v.length()
    const gamma = speed > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / speed))) : 0
    if (recoveredAt === Infinity
      && self.diag.aero.qbar >= qKnee
      && gamma > -60 * (Math.PI / 180)) {
      recoveredAt = t
    }
    // 恢復後三秒內的過載峰值——積分飽和會在這裡表現成一個尖峰
    if (recoveredAt !== Infinity && t <= recoveredAt + 3) {
      peakG = Math.max(peakG, Math.abs(self.diag.loadFactor))
    }
  }

  return {
    recovered: recoveredAt !== Infinity,
    seconds: recoveredAt,
    minAltitude,
    peakG,
    finite: true,
  }
}

describe('L4-B AI 必須救得回來', () => {
  const CASES: readonly [number, number][] = [
    [3000, 40],   // 幾乎停住
    [3000, 80],   // 還有一點速度
    [1500, 40],   // 低空且幾乎停住
    [1500, 80],
  ]

  for (const spec of [P51D, BF109G6]) {
    for (const [altitude, tas] of CASES) {
      it(`${spec.name} / ${altitude} m / ${(tas * 3.6).toFixed(0)} km/h 垂直懸掛 → 救得回來`, () => {
        const r = aiRecovery(spec, altitude, tas)
        expect(r.finite).toBe(true)
        expect(r.recovered, '四十秒內未恢復可控飛行').toBe(true)
        // 【不觸海是硬要求】spec §8.3 條件 5
        expect(r.minAltitude).toBeGreaterThan(0)
        /**
         * 【過載尖峰是積分飽和的指紋】指揮儀的 PID 在舵面失效期間看不到
         * 飽和（`controls.elevator` 讀起來仍是滿舵，是空氣不理它），積分項
         * 會爬到上限；速度回來的瞬間那個積分變成一個猛拉。若這裡紅了，
         * 先確認是不是 spec §5.2 說的那件事，再考慮調衰減陡度。
         */
        expect(r.peakG).toBeLessThan(PILOT_G_POSITIVE + 0.5)
      })
    }
  }
})
```

- [ ] **Step 2: 執行測試**

Run: `npx vitest run test/integration/low-speed-authority.test.ts`
Expected: PASS（4 + 8 = 12 條）。

**若「四十秒內未恢復」失敗**，依序檢查：

1. 印出全程的 `qbar` 與 `gamma` —— 是速度一直回不來，還是速度回來了但航跡角仍在 −60° 以下（一路俯衝）？後者代表安全層在低空接管而它拉不起來，那是 M4 的安全層問題不是本設計的。
2. 印出 `ai.safetyActive` —— 安全層若全程都開著，代表它判定來不及了，檢查起始高度是否本來就低於 M4 spec §3.4 的最低可恢復高度。
3. 最後才考慮把 `LOW_SPEED_KNEE` 調小。**調它之前必須先回報**：那會改變整個設計的手感，是專案負責人的決定不是實作者的。

**若過載尖峰超標**，那正是 spec §5.2 預期的積分飽和。回報並提議：在 `FlightDirector` 的角速率迴路加 conditional integration（`diag.controlAuthority < 1` 時凍結積分）。**不要自己加** —— spec 明文寫了「先不加，改用驗收條件量」，加不加是一次新的決定。

- [ ] **Step 3: 全套回歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。這個檔案每場跑 40 秒 × 240 步 × 2 架 × 8 組，約需十餘秒，屬正常。

- [ ] **Step 4: Commit**

```bash
git add test/integration/low-speed-authority.test.ts
git commit -m "test: L4-B AI 從垂直懸掛救得回來（8 組 × 不觸海 × 無過載尖峰）"
```

---

## Task 6: 迴歸確認、文件同步與人工驗收清單

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md`（§8 驗收紀錄）
- Modify: `README.md`

**Interfaces:**
- Consumes: 全部前面的任務
- Produces: 無

- [ ] **Step 1: 確認驗收條件 2 仍綠**

Run: `npx vitest run test/balance/relative.test.ts`
Expected: PASS。

**這一條不新增測試。** 持續轉彎率交叉點（280–380 km/h）已由 `test/balance/relative.test.ts:200` 釘死，而它由 `analysis/envelope.ts` 的閉式求解得出，完全不經過舵面 —— 結構上不可能被本次改動影響。這一步是確認那個推理成立，不是補一條重複的斷言。

- [ ] **Step 2: 全套驗收**

Run: `npx tsc --noEmit && npx vitest run && npx vite build && npm run bench`
Expected: 型別無誤、全部測試綠、建置成功、基準數字無數量級變化。

**記下 `npm run bench` 的三組數字**（物理步、彈丸步、AI 步）並與改動前比較。低速衰減每步多兩次乘法與一次除法，理論上量不出來；若物理步變慢超過 10%，代表 `stallDynamicPressure` 被放進了不該放的地方（例如每個舵面各算一次）。

- [ ] **Step 3: 在 spec §8 加驗收紀錄**

在 spec 的 §8.4 之後新增 §8.5，逐項填入實測：

```markdown
### 8.5 驗收紀錄（實作後回填）

| 條件 | 結果 |
|---|---|
| 1. 既有測試全綠 | （填入測試總數） |
| 2. 轉彎率交叉點仍在 280–380 km/h | （填入 test/balance/relative.test.ts 的結果） |
| 3. 垂直懸掛時失去姿態控制 | （填入 Task 4 的門檻與實測） |
| 4. 機頭最終被重力帶下來 | （填入最終機首仰角） |
| 5. AI 救得回來、不觸海 | （填入 8 組的恢復時間與最低高度） |
| 6. 無指揮儀震盪 | （填入過載峰值） |
| 7–9. 人工驗收 | ⬜ **未執行** 或 填入結果 |

效能：物理步 （填入） µs，改動前 1.0 µs。
```

**沒跑的就寫沒跑**，不要寫「應該沒問題」。

- [ ] **Step 4: 更新 README**

測試數改為實測值。並在「尚未實作」那一節之前，於架構段落的物理描述後補一句：

```markdown
低速時舵面會失去效力（動壓低於 1 G 失速動壓的 1.44 倍時線性衰減），
所以垂直懸掛不是免費的招式——掛太久就拉不回來，機頭會被重力帶下去。
設計與實測見 `docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md`。
```

文件表格加：

```markdown
| 低速操控權 設計規格 | `docs/superpowers/specs/2026-08-03-low-speed-control-authority-design.md` |
| 低速操控權 實作計畫 | `docs/superpowers/plans/2026-08-03-low-speed-control-authority.md` |
```

- [ ] **Step 5: 人工驗收（spec §8.4）**

Run: `npm run dev`

1. 自己拉垂直，確認變鈍的手感明確但不像「操縱壞了」；`LOW SPEED` 字樣有出現
2. 按 `I` 讓 AI 開自機、按 `5` 開敵機 AI，把它引進垂直爬升，看它是否放棄追高並改出
3. 打一場低速纏鬥，確認手感沒有改變

**把每一條的實際結果寫進 §8.5。沒做的就寫沒做。**

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "docs: 低速操控權的驗收紀錄與 README 同步"
```

---

## 自我審查紀錄

**1. Spec 覆蓋率**

| spec 章節 | 由哪個任務實作 |
|---|---|
| §2 全部裁決 | Task 1（拐點、陡度）、Task 2（三軸統一）、Task 3（獨立警告）、Task 5（anti-windup 不預先加） |
| §4.1 公式 | Task 1 Step 3、Task 2 Step 3 |
| §4.2 q_low 是常數 | Task 1 的「與高度無關」測試 |
| §4.3 CL_max 慣例對齊 | Task 1 的兩條測試（對照 `stallSpeed()` 與直接比對 `derivedClMax`） |
| §4.5 不需要下限 | Task 1 的「q = 0 時為 0」測試 |
| §5.1 波及範圍 | Task 2 Step 6 的分類指引 |
| §5.2 不預先加 anti-windup | Task 5 Step 2 的處置指引 |
| §5.3 順序約束 | Global Constraints 明列 |
| §6 HUD | Task 3 |
| §7 檔案結構 | 本計畫的「檔案結構」節 |
| §8.1 條件 1 | 每個任務的全套回歸步驟 |
| §8.1 條件 2 | Task 6 Step 1（沿用既有測試，不重寫） |
| §8.2 條件 3、4 | Task 4 |
| §8.3 條件 5、6 | Task 5 |
| §8.4 人工 | Task 6 Step 5 |
| §9.1 L1 | Task 1 |
| §9.2 L3 | Task 2 的兩條相對關係測試 |
| §9.3 L4-A | Task 4 |
| §9.4 L4-B | Task 5 |
| §9.5 迴歸 | Task 6 |

無缺口。

**2. 佔位符掃描**

Task 4 的 `PITCH_RATE_FLOOR = 0` 與 `COLLAPSE_TIME = 0` 帶有「由 Step 2 填入」的註記。**這不是佔位符** —— spec §8.2 明文要求這兩個門檻由實測訂出，而 Task 4 Step 1 給了完整的量測程式碼、Step 2 給了明確的取值規則（巡航值的四分之一、首次跌破時間加 2 秒）、Step 5 給了回填格式。這與 M2 的命中盒座標、M4 的 25 個門檻是同一個模式。

Task 6 Step 3 的 §8.5 表格同理：那是回填格式，不是待辦。

**3. 型別一致性**

- `lowSpeedEffectiveness(spec: AircraftSpec, qbar: number): number` —— Task 1 定義，Task 2（`aeroForceMoment`、`stepDynamics`）、Task 4、Task 5 引用，簽章一致。
- `stallDynamicPressure(spec: AircraftSpec): number` —— Task 1 定義，Task 2 測試、Task 4、Task 5 引用。
- `LOW_SPEED_KNEE`（常數 1.44）—— Task 1 定義，Task 2、4、5 引用。命名全程一致，未出現 `LOW_SPEED_KNEE_FACTOR` 之類的變體。
- `StepDiagnostics.controlAuthority` —— Task 2 定義，Task 3（HUD）、Task 4（量測）引用。
- `HudFrame.controlAuthority` —— Task 3 定義，同檔的 `energy.ts` 使用。
- `verticalHang(spec, altitude, tas, seconds): Sample[]` —— Task 4 Step 1 定義，Step 3 的斷言沿用同一個簽章。
- `Sample` 的六個欄位（`t` / `altitude` / `tas` / `pitchRate` / `noseElevation` / `authority`）在 Task 4 的量測與斷言之間一致。
