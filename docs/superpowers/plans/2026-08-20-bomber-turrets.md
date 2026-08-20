# 轟炸機自衛砲塔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 He 111 與 B-17G 長出 AI 操作的自衛砲塔，使「尾追一台轟炸機」不再完全安全。

**Architecture:** `Turret` 是與 `Battery` 平行的新概念（射界錐 + 旋轉速率 + 確定性搖晃），由 `world/turrets.ts` 每個物理步推進，彈丸進同一個 `Projectiles` 池。純函數（射界、搖晃、相位）與世界狀態（選目標、轉向、開火）分成兩個檔案，前者可以完全脫離 `World` 測試。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess`）、three.js、vitest、Playwright、Vite。

**Spec:** `docs/superpowers/specs/2026-08-20-bomber-turrets-design.md`

## Global Constraints

- **分支 `feat/bomber-turrets`**，已建立。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且長期被修改的檔案。一律列明確路徑。
- **絕不用 PowerShell 讀寫含中文的檔案**（會變亂碼）。用 Read/Write 工具，或 Python `io.open(..., encoding='utf-8')`。
- **不得引入 `@types/node`**。型別檢查指令是 `npx tsc --noEmit`。
- **`test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts` 必須單獨跑**，併行會假紅。
- **熱路徑零配置**：每個物理步執行的程式碼不得配置物件。暫存向量用模組私有常數，照 `src/world/World.ts` 的 `S.v` 與 `src/render/muzzle.ts` 的 `POS`/`DIR` 的既有做法。
- **護欄重新定值是專案負責人的決定。** 測試紅了要先量、先報告、先問，絕不為了讓測試變綠而放寬門檻。
- **不寫飛機外形的測試。**
- 所有註解與 commit message 用**繁體中文**。
- 現有的三條紅測試（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）是既有的，與本計畫無關；驗收時確認**數量沒有增加**即可。

## 檔案結構

| 檔案 | 責任 | Task |
| --- | --- | --- |
| `src/weapons/turret.ts`（新） | `Turret` 型別、`MAX_TURRETS`、射界錐、搖晃基底／角度／相位、轉向 —— **純函數，不 import 任何 world/ 的東西** | 1 |
| `test/unit/turret.test.ts`（新） | 上述純函數的測試 | 1 |
| `src/specs/types.ts` | `AircraftSpec` 加必填的 `turrets` | 2 |
| `src/specs/{p51d,bf109g6,he111,b17g}.ts` | 填 `turrets` | 2, 4 |
| `test/tools/turret-sites.probe.ts`（新） | 用 `__hangarSlice` 量兩台的砲塔位置 | 3 |
| `src/weapons/b17g.ts`、`src/weapons/he111.ts` | `TURRETS` 常數；`Battery.mounts` 清空 | 4 |
| `test/unit/hitbox.test.ts` | 加轟炸機、加砲塔的槍口與射界檢查 | 4 |
| `src/world/turrets.ts`（新） | `TurretState`、調校常數、`stepTurrets` | 5 |
| `test/unit/turret-step.test.ts`（新） | `stepTurrets` 的行為測試（用最小的假 Combatant） | 5 |
| `src/world/World.ts` | `Combatant.turrets`；`setSpec` 配置；`step` 呼叫 | 6 |
| `test/integration/turrets.test.ts`（新） | 20v20 的 A/B 對照與彈丸池峰值 | 6 |
| `src/render/turretBarrels.ts`（新） | 黑色三角柱槍管的 `InstancedMesh` | 7 |
| `src/render/muzzle.ts` | `createTurretMuzzles`（砲塔專用的槍焰池） | 7 |
| `src/main.ts` | 接線；預瞄環判準改成 `mounts.length > 0` | 7, 8 |
| `docs/backlog.md` | §2.21「AI 轟炸機仍會空扣扳機」 | 8 |

---

### Task 1: `weapons/turret.ts` —— 純函數層

**Files:**
- Create: `src/weapons/turret.ts`
- Test: `test/unit/turret.test.ts`

**Interfaces:**
- Consumes: `WeaponSpec` from `src/weapons/types.ts`（既有）
- Produces:
  - `interface Turret { id, weapon, position, axis, halfAngle, rotationRate, guns }`
  - `MAX_TURRETS: number`（= 8）
  - `inArc(turret: Turret, dir: Vector3): boolean`
  - `wobbleBasis(aim: Vector3, e1: Vector3, e2: Vector3): void`
  - `wobblePhase(combatantIndex: number, turretCount: number, turretIndex: number): number`
  - `applyWobble(aim, amplitude, omega, phase, t, e1, e2, out): Vector3`
  - `slew(aim: Vector3, want: Vector3, maxAngle: number): void`
  - `GOLDEN`, `GOLDEN_ANGLE`, `BASIS_PARALLEL`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/turret.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  inArc, wobbleBasis, wobblePhase, applyWobble, slew,
  BASIS_PARALLEL, GOLDEN, MAX_TURRETS,
} from '../../src/weapons/turret'
import type { Turret } from '../../src/weapons/turret'
import { M2_BROWNING } from '../../src/weapons/p51d'

const DEG = Math.PI / 180

const TAIL: Turret = {
  id: 'test-tail',
  weapon: M2_BROWNING,
  position: new Vector3(0, 1, 16.4),
  axis: new Vector3(0, 0, 1),
  halfAngle: 30 * DEG,
  rotationRate: 90 * DEG,
  guns: 2,
}

describe('射界錐', () => {
  it('正對中心方向在錐內', () => {
    expect(inArc(TAIL, new Vector3(0, 0, 1))).toBe(true)
  })

  it('偏 29° 在錐內、偏 31° 在錐外', () => {
    const near = new Vector3(0, Math.sin(29 * DEG), Math.cos(29 * DEG))
    const far = new Vector3(0, Math.sin(31 * DEG), Math.cos(31 * DEG))
    expect(inArc(TAIL, near)).toBe(true)
    expect(inArc(TAIL, far)).toBe(false)
  })

  it('剛好在邊界上算錐內', () => {
    const edge = new Vector3(0, Math.sin(30 * DEG), Math.cos(30 * DEG))
    expect(inArc(TAIL, edge)).toBe(true)
  })

  it('正後方（與中心相反）在錐外', () => {
    expect(inArc(TAIL, new Vector3(0, 0, -1))).toBe(false)
  })
})

describe('搖晃基底', () => {
  const e1 = new Vector3()
  const e2 = new Vector3()

  it('兩軸與 aim 互相垂直且都是單位長', () => {
    const aim = new Vector3(0.3, 0.2, -0.9).normalize()
    wobbleBasis(aim, e1, e2)
    expect(e1.length()).toBeCloseTo(1, 10)
    expect(e2.length()).toBeCloseTo(1, 10)
    expect(e1.dot(aim)).toBeCloseTo(0, 10)
    expect(e2.dot(aim)).toBeCloseTo(0, 10)
    expect(e1.dot(e2)).toBeCloseTo(0, 10)
  })

  /**
   * 【為什麼要測這個】aim 指向正上方時 `aim × (0,1,0)` 會退化成零向量，
   * normalize 之後是 NaN，整條彈流會消失而且不會有任何錯誤。
   * Sperry 上部砲塔的中心方向就是正上方。
   */
  it('aim 指向正上方時基底仍然有效（不是 NaN）', () => {
    wobbleBasis(new Vector3(0, 1, 0), e1, e2)
    expect(Number.isFinite(e1.x + e1.y + e1.z)).toBe(true)
    expect(e1.length()).toBeCloseTo(1, 10)
    expect(e2.length()).toBeCloseTo(1, 10)
  })

  it('aim 指向正下方時基底仍然有效', () => {
    wobbleBasis(new Vector3(0, -1, 0), e1, e2)
    expect(e1.length()).toBeCloseTo(1, 10)
    expect(e2.length()).toBeCloseTo(1, 10)
  })

  it('切換門檻是常數而不是寫死的字面量', () => {
    expect(BASIS_PARALLEL).toBeGreaterThan(0.9)
    expect(BASIS_PARALLEL).toBeLessThan(1)
  })
})

describe('搖晃相位', () => {
  it('同一架的各座互不相同', () => {
    const phases = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => wobblePhase(3, 8, i))
    const unique = new Set(phases.map((p) => p.toFixed(6)))
    expect(unique.size).toBe(8)
  })

  it('相鄰兩架的同一座也不同 —— 編隊不會同步擺動', () => {
    expect(wobblePhase(3, 8, 0)).not.toBeCloseTo(wobblePhase(4, 8, 0), 6)
  })

  it('落在 [0, 2π)', () => {
    for (let k = 0; k < 200; k++) {
      const p = wobblePhase(k, 8, k % 8)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(Math.PI * 2)
    }
  })
})

describe('搖晃', () => {
  const e1 = new Vector3()
  const e2 = new Vector3()
  const out = new Vector3()
  const AIM = new Vector3(0, 0, -1)
  const A = 1.0 * DEG
  const W = 2 * Math.PI * 0.7

  it('確定性 —— 同一個 t 與相位必然給同一個方向', () => {
    const a = applyWobble(AIM, A, W, 0.5, 3.25, e1, e2, out).clone()
    const b = applyWobble(AIM, A, W, 0.5, 3.25, e1, e2, out).clone()
    expect(a.x).toBe(b.x)
    expect(a.y).toBe(b.y)
    expect(a.z).toBe(b.z)
  })

  it('偏離不超過 A√2', () => {
    let worst = 0
    for (let k = 0; k < 2000; k++) {
      const t = k * 0.01
      applyWobble(AIM, A, W, 0.7, t, e1, e2, out)
      worst = Math.max(worst, AIM.angleTo(out))
    }
    expect(worst).toBeLessThanOrEqual(A * Math.SQRT2 * 1.001)
  })

  it('真的有在動 —— 掃幅至少到振幅的八成', () => {
    let worst = 0
    for (let k = 0; k < 2000; k++) {
      applyWobble(AIM, A, W, 0.7, k * 0.01, e1, e2, out)
      worst = Math.max(worst, AIM.angleTo(out))
    }
    expect(worst).toBeGreaterThan(A * 0.8)
  })

  /**
   * 【為什麼要測不重複】兩個頻率若整除，李薩茹圖形會退化成一條封閉曲線，
   * 目標只要待在曲線之外就永遠打不到 —— 那正是這個設計要避免的。
   */
  it('兩個頻率比是無理數 —— 一個週期之後不回到原點', () => {
    expect(GOLDEN).toBeGreaterThan(1.6)
    expect(GOLDEN).toBeLessThan(1.62)
    const period = (2 * Math.PI) / W
    const a = applyWobble(AIM, A, W, 0, 0, e1, e2, out).clone()
    const b = applyWobble(AIM, A, W, 0, period, e1, e2, out).clone()
    expect(a.angleTo(b)).toBeGreaterThan(A * 0.1)
  })

  it('回傳的是單位向量', () => {
    applyWobble(AIM, A, W, 1.1, 7.3, e1, e2, out)
    expect(out.length()).toBeCloseTo(1, 10)
  })
})

describe('轉向', () => {
  it('目標在範圍內時一步到位', () => {
    const aim = new Vector3(0, 0, -1)
    const want = new Vector3(0, Math.sin(2 * DEG), -Math.cos(2 * DEG))
    slew(aim, want, 5 * DEG)
    expect(aim.angleTo(want)).toBeCloseTo(0, 6)
  })

  it('目標在範圍外時只轉 maxAngle，方向正確', () => {
    const aim = new Vector3(0, 0, -1)
    const start = aim.clone()
    const want = new Vector3(0, Math.sin(40 * DEG), -Math.cos(40 * DEG))
    slew(aim, want, 5 * DEG)
    expect(start.angleTo(aim)).toBeLessThanOrEqual(5 * DEG + 1e-9)
    expect(start.angleTo(aim)).toBeGreaterThan(4.9 * DEG)
    // 轉過去之後離目標更近
    expect(aim.angleTo(want)).toBeLessThan(start.angleTo(want))
  })

  it('已經對準時不動、不產生 NaN', () => {
    const aim = new Vector3(0, 0, -1)
    slew(aim, new Vector3(0, 0, -1), 5 * DEG)
    expect(aim.length()).toBeCloseTo(1, 10)
    expect(aim.z).toBeCloseTo(-1, 10)
  })

  /**
   * 【為什麼要測正反向】aim 與 want 完全相反時，兩者的外積是零向量，
   * 轉軸 normalize 之後是 NaN。砲塔在目標繞到正後方那一瞬間會遇到。
   */
  it('目標正好在反方向時不產生 NaN', () => {
    const aim = new Vector3(0, 0, -1)
    slew(aim, new Vector3(0, 0, 1), 5 * DEG)
    expect(Number.isFinite(aim.x + aim.y + aim.z)).toBe(true)
    expect(aim.length()).toBeCloseTo(1, 10)
  })

  it('回傳後仍是單位向量', () => {
    const aim = new Vector3(0.1, 0.2, -0.9).normalize()
    for (let k = 0; k < 500; k++) slew(aim, new Vector3(1, 0, 0), 1 * DEG)
    expect(aim.length()).toBeCloseTo(1, 8)
  })
})

describe('容量上界', () => {
  it('MAX_TURRETS 撐得住 B-17G 的八座', () => {
    expect(MAX_TURRETS).toBeGreaterThanOrEqual(8)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/turret.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/weapons/turret"`

- [ ] **Step 3: 寫實作**

建立 `src/weapons/turret.ts`：

```ts
import { Vector3 } from 'three'
import type { WeaponSpec } from './types'

/**
 * 一座自衛砲塔。與 `Battery` 平行而不是它的一部分 —— `Battery` 由玩家的
 * 扳機驅動（`c.command.firing`），砲塔自己找目標、自己決定開火。
 *
 * 設計理由見 `docs/superpowers/specs/2026-08-20-bomber-turrets-design.md` §3.1。
 */
export interface Turret {
  id: string
  weapon: WeaponSpec
  /** 槍口位置，**機體座標**，m */
  position: Vector3
  /**
   * 射界錐的中心方向，機體座標單位向量。
   *
   * 【為什麼是錐不是多邊形】真機的射界是不規則的（腰部機槍被機身擋、球形
   * 砲塔打不到正上方），但**照片讀不出精確邊界**，而這個專案已經為「從照片
   * 讀來的前提」付過一整輪的代價（見 aircraft-from-reference 坑 22）。
   * 一個中心方向 + 一個半角是**可以被試飛推翻的形式**，多邊形不是。
   */
  axis: Vector3
  /** 射界半角，rad。**設計值，不是量測值。** */
  halfAngle: number
  /** 旋轉速率上限，rad/s。這是「不能久留」的來源。 */
  rotationRate: number
  /**
   * 幾管。雙聯砲塔填 2。
   *
   * 【乘的是傷害不是射速】雙聯照實模擬要吐兩倍彈丸，而彈丸池只有 4,000 格。
   * 乘傷害的話 DPS 一樣、彈流看起來是一道而不是兩道 —— 1,000 m 外分不出來，
   * 但省一半的池子。**這是被預算逼出來的簡化，不是物理**；日後擴容池子時
   * 這裡可以改回去。
   */
  guns: number
}

/**
 * 一台飛機最多幾座砲塔。**容量上界不是描述** —— 與 `MAX_MOUNTS` 同一個
 * 理由：砲塔的槍焰與槍管用「架數 × MAX_TURRETS」預配實例，超出的那一座會
 * **靜靜地畫不出來**。目前最多的是 B-17G 的 8 座。
 */
export const MAX_TURRETS = 8

/** 黃金比。搖晃的第二個頻率乘它，兩個頻率因此不整除。 */
export const GOLDEN = 1.6180339887

/** 黃金角，rad。相位乘它才會在 [0, 2π) 上散得最開。 */
export const GOLDEN_ANGLE = 2.39996322973

/**
 * 搖晃基底的退化門檻。`|aim · up| > BASIS_PARALLEL` 時改用備援上方向。
 *
 * 【為什麼需要】`aim × (0,1,0)` 在 aim 指向正上方時是零向量，normalize
 * 之後整條彈流變成 NaN 而且不會有任何錯誤。Sperry 上部砲塔的中心方向
 * 就是正上方。
 */
export const BASIS_PARALLEL = 0.99

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const UP_FALLBACK = /* @__PURE__ */ new Vector3(0, 0, -1)
/** 模組私有暫存，熱路徑零配置。禁止跨模組共用。 */
const AXIS = /* @__PURE__ */ new Vector3()

/** 方向是否落在射界錐內。`dir` 與 `turret.axis` 都必須是機體座標的單位向量。 */
export function inArc(turret: Turret, dir: Vector3): boolean {
  return turret.axis.dot(dir) >= Math.cos(turret.halfAngle)
}

/**
 * 由 `aim` **唯一決定**的一組與它垂直的正交基底，寫進 e1、e2。
 *
 * 【為什麼要唯一決定】搖晃的「確定性」建立在這組基底上。若基底依賴呼叫
 * 順序或上一幀的狀態，同一個 t 就會給出不同的方向，`rematch` 那條逐位元
 * 重現的測試會紅，而且症狀是隨機的。
 */
export function wobbleBasis(aim: Vector3, e1: Vector3, e2: Vector3): void {
  const u = Math.abs(aim.dot(UP)) > BASIS_PARALLEL ? UP_FALLBACK : UP
  e1.copy(aim).cross(u).normalize()
  // aim ⟂ e1 且兩者皆單位長，所以外積已經是單位長，不必再 normalize
  e2.copy(aim).cross(e1)
}

/**
 * 第 `turretIndex` 座砲塔的搖晃相位。
 *
 * 【為什麼要把載機索引也算進去】只用砲塔索引的話，編隊裡每一架的第 0 座
 * 都同相位，二十架 B-17 的尾砲塔會整齊劃一地擺動 —— 那看起來像機械故障
 * 而不是二十個砲手。
 */
export function wobblePhase(
  combatantIndex: number,
  turretCount: number,
  turretIndex: number,
): number {
  const n = combatantIndex * turretCount + turretIndex
  const p = (n * GOLDEN_ANGLE) % (Math.PI * 2)
  return p < 0 ? p + Math.PI * 2 : p
}

/**
 * 把 `aim` 繞兩個垂直軸各轉一個小角，寫進 `out` 並回傳。
 *
 * ```
 *   θ₁ = A · sin(ω·t + φ)          繞 e₁
 *   θ₂ = A · sin(ω·t·Φ + φ)        繞 e₂
 * ```
 *
 * 兩個頻率比是無理數，所以疊出來是**李薩茹圖形**：不重複、會把整個錐面
 * 掃滿，但每一瞬間仍然是連續平滑的移動。單一正弦是一條來回掃的直線，
 * 目標只要離開那條線就永遠打不到。
 *
 * 用 `tan` 而不是 `sin` 是因為偏移量加在**切平面**上：偏離角恰好是
 * `atan(√(tan²θ₁ + tan²θ₂))`，上界 `A√2`（小角度下）。
 */
export function applyWobble(
  aim: Vector3,
  amplitude: number,
  omega: number,
  phase: number,
  t: number,
  e1: Vector3,
  e2: Vector3,
  out: Vector3,
): Vector3 {
  wobbleBasis(aim, e1, e2)
  const a = amplitude * Math.sin(omega * t + phase)
  const b = amplitude * Math.sin(omega * t * GOLDEN + phase)
  return out.copy(aim)
    .addScaledVector(e1, Math.tan(a))
    .addScaledVector(e2, Math.tan(b))
    .normalize()
}

/**
 * `aim` 往 `want` 轉，一步最多 `maxAngle`。就地寫回 `aim`。
 *
 * 兩個退化情況都必須處理，否則轉軸 normalize 之後是 NaN：已經對準
 * （外積為零）、正好反向（外積也為零，而且砲塔在目標繞到正後方那一瞬間
 * 就會遇到）。
 */
export function slew(aim: Vector3, want: Vector3, maxAngle: number): void {
  const angle = aim.angleTo(want)
  if (angle <= maxAngle) {
    aim.copy(want)
    return
  }
  AXIS.copy(aim).cross(want)
  const len = AXIS.length()
  if (len < 1e-9) {
    // 正好反向：任取一個與 aim 垂直的軸，往哪一邊繞都對
    AXIS.copy(aim).cross(Math.abs(aim.dot(UP)) > BASIS_PARALLEL ? UP_FALLBACK : UP)
    AXIS.normalize()
  } else {
    AXIS.divideScalar(len)
  }
  aim.applyAxisAngle(AXIS, maxAngle).normalize()
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/turret.test.ts`
Expected: PASS，全部綠

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 沒有輸出

- [ ] **Step 6: Commit**

```bash
git add src/weapons/turret.ts test/unit/turret.test.ts
git commit -m "feat: weapons/turret.ts —— 砲塔的純函數層

射界錐、確定性搖晃（李薩茹）、相位散佈、轉向速率上限。不 import 任何
world/ 的東西，所以可以完全脫離 World 測試。

兩個退化情況特別測了，因為它們都會**靜靜地**產生 NaN 而不是報錯：
aim 指向正上方時搖晃基底的外積為零（Sperry 上部砲塔的中心方向就是
正上方），以及目標繞到正後方時轉軸的外積為零。"
```

---

### Task 2: `AircraftSpec.turrets` 欄位

**Files:**
- Modify: `src/specs/types.ts`
- Modify: `src/specs/p51d.ts`、`src/specs/bf109g6.ts`、`src/specs/he111.ts`、`src/specs/b17g.ts`
- Test: `test/unit/specs.test.ts`

**Interfaces:**
- Consumes: `Turret`、`MAX_TURRETS` from Task 1
- Produces: `AircraftSpec.turrets: readonly Turret[]`（**必填**）

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/specs.test.ts` 的最後（`describe('機種資料', ...)` 區塊之外）加一段：

```ts
import { MAX_TURRETS } from '../../src/weapons/turret'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'

describe('砲塔欄位', () => {
  const ALL = [P51D, BF109G6, HE111, B17G]

  it('每一台都有 turrets 欄位（戰鬥機是空陣列）', () => {
    for (const spec of ALL) {
      expect(Array.isArray(spec.turrets), `${spec.id} 沒有 turrets`).toBe(true)
    }
  })

  it('戰鬥機沒有砲塔', () => {
    expect(P51D.turrets).toHaveLength(0)
    expect(BF109G6.turrets).toHaveLength(0)
  })

  /**
   * 【為什麼要守這一條】砲塔的槍焰與槍管用「架數 × MAX_TURRETS」預配實例。
   * 超出上界的那一座會**靜靜地畫不出來** —— 沒有錯誤、沒有警告。
   * 這與 `weapons.test.ts` 守 MAX_MOUNTS 的那一條是同一個理由。
   */
  it('沒有任何機種的砲塔數超過 MAX_TURRETS', () => {
    for (const spec of ALL) {
      expect(spec.turrets.length, `${spec.id} 超過 MAX_TURRETS`)
        .toBeLessThanOrEqual(MAX_TURRETS)
    }
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/specs.test.ts`
Expected: FAIL —— `Property 'turrets' does not exist on type 'AircraftSpec'`（vitest 會先報型別以外的錯，`tsc` 會明確報這一條）

- [ ] **Step 3: 加欄位與四台的值**

在 `src/specs/types.ts` 的 `AircraftSpec` 裡，緊接在 `battery` 之後加：

```ts
  /**
   * 自衛砲塔。**必填，戰鬥機填空陣列。**
   *
   * 【為什麼必填而不是選填】選填的話新增機種時不會有任何東西提醒你去補；
   * 必填欄位由型別直接擋下來。這個專案已經被硬編機種清單咬過一次
   * （見 `.claude/skills/aircraft-from-reference` 的「不要為外型寫測試」末段），
   * `role` 那一輪也是同一個理由。
   *
   * 與 `battery` 的差別：`battery` 由**玩家的扳機**驅動
   * （`Combatant.command.firing`），砲塔自己找目標、自己決定開火。
   */
  turrets: readonly Turret[]
```

同一個檔案的最上方加 `import type { Turret } from '../weapons/turret'`。

在 `src/specs/p51d.ts` 與 `src/specs/bf109g6.ts` 的 `battery:` 那一行之後各加：

```ts
  // 戰鬥機沒有自衛砲塔
  turrets: [],
```

在 `src/specs/he111.ts` 與 `src/specs/b17g.ts` 同樣先各加 `turrets: [],`（真正的內容在 Task 4 填）。

- [ ] **Step 4: 跑測試與型別檢查**

Run: `npx vitest run test/unit/specs.test.ts && npx tsc --noEmit`
Expected: 測試 PASS、`tsc` 沒有輸出

- [ ] **Step 5: Commit**

```bash
git add src/specs/types.ts src/specs/p51d.ts src/specs/bf109g6.ts src/specs/he111.ts src/specs/b17g.ts test/unit/specs.test.ts
git commit -m "feat: AircraftSpec 加必填的 turrets 欄位

必填而不是選填：選填的話新增機種時不會有任何東西提醒你去補，必填由型別
直接擋。這個專案已經被硬編機種清單咬過一次。

四台先全部填空陣列，兩台轟炸機的內容在配置那一輪填。"
```

---

### Task 3: 量出兩台的砲塔位置

**Files:**
- Create: `test/tools/turret-sites.probe.ts`
- Modify: `docs/superpowers/plans/2026-08-20-bomber-turrets.md`（把量到的數字填進 Task 4 的表）

**Interfaces:**
- Consumes: 機庫的 `__hangarSpec`、`__hangarRef`、`__hangarSlice` 開發用出口（既有，見 `src/tools/hangar.ts`）
- Produces: 兩台各自的砲塔槍口位置（機體座標），寫進 Task 4 的常數

**背景（實作者必讀）**：這個專案的紀律是「**能量的就不要用眼睛判斷**」。砲塔位置一律從參考模型量，不從照片配。做法與外型那一輪相同，見 `.claude/skills/aircraft-from-reference` 第 5b 步。已經量到的兩個值先記在這裡，其餘要量：

- B-17G 尾砲塔的槍管：機體 z 16.4…17.14、y ≈ 1.0、x ±0.14（`docs/backlog.md` §2.15）
- He 111 機腹吊艙：剖面中心 y = −0.75、後窗 z 4.51…5.51（skill 第 5b 步）

- [ ] **Step 1: 起開發伺服器**

Run: `npm run dev`（在背景跑；本專案固定用 **port 5178**）
Expected: `Local: http://localhost:5178/`

- [ ] **Step 2: 寫量測腳本**

建立 `test/tools/turret-sites.probe.ts`：

```ts
/**
 * 量兩台轟炸機的砲塔位置 —— **能量的就不要用眼睛判斷**。
 *
 *   npx tsx test/tools/turret-sites.probe.ts     # 需要 npm run dev 開在 5178
 *
 * 【射線原點要放進零件裡】從機身軸心往外打會先打到蒙皮，量到的是外殼不是
 * 砲塔。把原點放進砲塔自己的剖面中心，砲塔的輪廓才會單獨浮出來 —— 這與
 * 座艙罩那一招同源（見 skill 第 2 步）。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/hangar'

interface Cut {
  label: string
  axis: 'x' | 'y' | 'z'
  opt: Record<string, unknown>
}

const B17: Cut[] = [
  // 上部 Sperry：座艙後方的隆起。原點抬到罩內
  { label: '上部 Sperry', axis: 'z',
    opt: { from: -2.2, to: 0.4, count: 27, angles: 72, axisV: 1.15, maxRadius: 0.8 } },
  // 球形腹部：機腹的球。原點放進球心
  { label: '球形腹部', axis: 'z',
    opt: { from: 0.6, to: 2.6, count: 21, angles: 72, axisV: -1.05, maxRadius: 0.9 } },
  // 腰部窗：側面。用 extent 沿 x 切，uWindow 限住 z
  { label: '腰部窗', axis: 'x',
    opt: { from: 0.4, to: 1.2, count: 9, uWindow: [4.5, 6.5] } },
  // 頰槍：機首兩側
  { label: '頰槍', axis: 'x',
    opt: { from: 0.3, to: 1.0, count: 8, uWindow: [-5.2, -3.8] } },
  // 尾砲塔：已量過，這裡重跑一次確認
  { label: '尾砲塔', axis: 'z',
    opt: { from: 15.8, to: 17.4, count: 17, angles: 72, axisV: 1.0, maxRadius: 0.7 } },
]

const HE111: Cut[] = [
  { label: '機背 B-Stand', axis: 'z',
    opt: { from: -0.8, to: 1.6, count: 25, angles: 72, axisV: 0.95, maxRadius: 0.7 } },
  { label: '機腹後 C-Stand', axis: 'z',
    opt: { from: 4.2, to: 5.8, count: 17, angles: 72, axisV: -0.75, maxRadius: 0.8 } },
  { label: '側窗', axis: 'x',
    opt: { from: 0.3, to: 1.0, count: 8, uWindow: [1.0, 3.0] } },
]

async function measure(page: Page, id: string, cuts: readonly Cut[]): Promise<void> {
  await page.evaluate((spec) => (window as never as {
    __hangarSpec: (s: string) => void }).__hangarSpec(spec), id)
  // 參考模型有 25 MB，輪詢到就緒為止而不是硬等
  await page.waitForFunction(() => (window as never as {
    __hangarRef: (on: boolean, solid: boolean) => boolean }).__hangarRef(true, true),
  undefined, { timeout: 120_000 })

  console.log(`\n══ ${id} ═══════════════════════════════════════`)
  for (const cut of cuts) {
    const rows = await page.evaluate(([kind, axis, opt]) => (window as never as {
      __hangarSlice: (k: string, a: string, o: unknown) => unknown
    }).__hangarSlice(kind as string, axis as string, opt),
    [cut.axis === 'x' || cut.axis === 'y' ? 'extent' : 'radial', cut.axis, cut.opt] as const)
    console.log(`\n  ${cut.label}`)
    console.log(JSON.stringify(rows, null, 1).slice(0, 4000))
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
  await page.goto(URL)
  await measure(page, 'b17g', B17)
  await measure(page, 'he111', HE111)
  await browser.close()
}
void main()
```

- [ ] **Step 3: 跑量測**

Run: `NODE_PATH=$(pwd)/node_modules npx tsx test/tools/turret-sites.probe.ts`
Expected: 印出每一刀的輪廓。**驗收判準**：每一組的半徑要在合理範圍（0.2–0.9 m）而且**沒有任何一個等於 `maxRadius`** —— 等於上界代表擬合撞到邊界，那不是量測值是垃圾（skill 坑 6）。撞到就把 `maxRadius` 收小重跑。

- [ ] **Step 4: 把數字填進 Task 4 的表**

用 Read/Write 工具編輯本檔案（**不要用 PowerShell**，中文會變亂碼），把 Task 4 表格裡標著「待量」的那幾格換成量到的值，並在每一格後面註明是從哪一刀哪一個角度讀出來的。

- [ ] **Step 5: Commit**

```bash
git add test/tools/turret-sites.probe.ts docs/superpowers/plans/2026-08-20-bomber-turrets.md
git commit -m "measure: 兩台轟炸機的砲塔位置

照 aircraft-from-reference 第 5b 步的做法：射線原點放進砲塔自己的剖面
中心，砲塔的輪廓才會單獨浮出來 —— 從機身軸心打只會量到蒙皮。

驗收判準是「沒有任何半徑等於 maxRadius」（坑 6：撞到參數上界的不是量測值
是垃圾）。"
```

---

### Task 4: 兩台的砲塔配置與 `Battery` 清空

**Files:**
- Modify: `src/weapons/b17g.ts`、`src/weapons/he111.ts`
- Modify: `src/specs/b17g.ts`、`src/specs/he111.ts`（`turrets:` 接上）
- Test: `test/unit/hitbox.test.ts`

**Interfaces:**
- Consumes: `Turret` from Task 1、Task 3 量到的位置
- Produces: `B17G_TURRETS: readonly Turret[]`、`HE111_TURRETS: readonly Turret[]`

**配置表**（半角與旋轉速率是設計值；位置由 Task 3 填）：

B-17G —— 八座：

| id | 位置 | axis | halfAngle | rotationRate | guns |
| --- | --- | --- | ---: | ---: | ---: |
| `chin` | `(0, −0.70, −5.43)` | `(0, −0.34, −0.94)` | 45° | 60°/s | 2 |
| `cheekL` / `cheekR` | 待量 | `(∓0.57, 0, −0.82)` | 35° | 90°/s | 1 |
| `top` | 待量 | `(0, 1, 0)` | 80° | 60°/s | 2 |
| `ball` | 待量 | `(0, −1, 0)` | 80° | 60°/s | 2 |
| `waistL` / `waistR` | 待量 | `(∓1, 0, 0)` | 60° | 90°/s | 1 |
| `tail` | `(0, 1.0, 16.4)` | `(0, 0.09, 1)`（正規化） | 30° | 90°/s | 2 |

He 111 —— 五座：

| id | 位置 | axis | halfAngle | rotationRate | guns |
| --- | --- | --- | ---: | ---: | ---: |
| `nose` | `(0.25, 0.35, −2.93)` | `(0, 0, −1)` | 40° | 90°/s | 1 |
| `dorsal` | 待量 | `(0, 0.64, 0.77)`（正規化） | 70° | 90°/s | 1 |
| `ventral` | 待量（z ≈ 5.0、y ≈ −0.75） | `(0, −0.64, 0.77)`（正規化） | 60° | 90°/s | 1 |
| `beamL` / `beamR` | 待量 | `(∓1, 0, 0)` | 45° | 90°/s | 1 |

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/hitbox.test.ts` 把 `CASES` 由 `[P51D, BF109G6]` 改成 `[P51D, BF109G6, HE111, B17G]`（連同 import），並在檔案最後加一個新的 describe：

```ts
import { inArc } from '../../src/weapons/turret'

describe('砲塔的位置與射界', () => {
  for (const spec of CASES) {
    if (spec.turrets.length === 0) continue
    describe(spec.name, () => {
      it('每個砲塔的槍口都在自己的命中盒內', () => {
        for (const t of spec.turrets) {
          expect(
            spec.hitBoxes.some((b) => inside(t.position, b)),
            `砲塔 ${t.id} @ ${t.position.toArray()} 不在任何命中盒內`,
          ).toBe(true)
        }
      })

      /**
       * 【為什麼要守】同隊已經被 World.ts 的 team 檢查排除，所以打不到自己人。
       * 但砲塔若把射界對著自己的機身，那些彈丸是**白生的** —— 佔著只有 4,000
       * 格的池子，而且看起來像穿模。
       */
      it('射界錐的中心方向不會撞到自己的機身', () => {
        const end = new Vector3()
        for (const t of spec.turrets) {
          end.copy(t.position).addScaledVector(t.axis, 12)
          for (const box of spec.hitBoxes) {
            if (box.part === 'wingLeft' || box.part === 'wingRight') continue
            const hit = segmentBox(
              t.position.x, t.position.y, t.position.z, end.x, end.y, end.z, box)
            expect(hit, `${spec.id} 砲塔 ${t.id} 的中心方向會打到自己的 ${box.part}`)
              .toBeLessThanOrEqual(0)
          }
        }
      })

      it('axis 是單位向量', () => {
        for (const t of spec.turrets) {
          expect(t.axis.length(), `砲塔 ${t.id} 的 axis 不是單位向量`).toBeCloseTo(1, 6)
        }
      })

      it('inArc 對自己的中心方向永遠為真', () => {
        for (const t of spec.turrets) expect(inArc(t, t.axis)).toBe(true)
      })
    })
  }
})

describe('兩台轟炸機沒有固定前射武器', () => {
  /**
   * He 111 的機首 MG 15 是球形槍座上的**手持活動槍**、B-17G 的下巴是 Bendix
   * **動力砲塔遙控瞄準** —— 兩者都是投彈手操作的，不是駕駛員能扣的槍。
   * 專案負責人裁定：可以轉向的都交給 AI，玩家不控火砲。
   */
  it('mounts 是空的', () => {
    expect(HE111.battery.mounts).toHaveLength(0)
    expect(B17G.battery.mounts).toHaveLength(0)
  })

  it('但 sight 仍然保留 —— AI 的預瞄計算在讀它', () => {
    expect(HE111.battery.sight.muzzleVelocity).toBeGreaterThan(0)
    expect(B17G.battery.sight.muzzleVelocity).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/hitbox.test.ts`
Expected: FAIL —— 轟炸機的 `turrets` 是空陣列所以砲塔那幾條被 `continue` 跳過，但「mounts 是空的」會紅（現在 He 111 有 1 個、B-17G 有 2 個）

- [ ] **Step 3: 寫配置**

在 `src/weapons/b17g.ts` 的最後加（位置用 Task 3 量到的值取代註解裡的「待量」）：

```ts
import type { Turret } from './turret'

/**
 * B-17G 的自衛砲塔 —— 八座。
 *
 * 【為什麼下巴砲塔也在這裡】Bendix Model D 是**動力砲塔**，由機首的投彈手
 * 遙控瞄準，不是駕駛員能扣的槍。專案負責人 2026-08-20 裁定：可以轉向的
 * 都交給 AI，玩家不控火砲。所以 `B17G_BATTERY.mounts` 是空的。
 *
 * 【半角是設計值不是量測值】真機的射界不規則（腰部機槍被機身擋、球形砲塔
 * 打不到正上方），照片讀不出精確邊界。一個中心方向 + 一個半角是**可以被
 * 試飛推翻的形式**。見 spec §5。
 *
 * 【旋轉速率】動力砲塔 60 °/s（馬達與減速機構，轉得穩但慢）、手持槍
 * 90 °/s（轉得快但射界小，高速下氣流壓著槍管更費力）。**這兩個數字沒有
 * 實測支撐**，由試飛裁定。
 *
 * 【位置全部量自參考模型】做法見 `test/tools/turret-sites.probe.ts`。
 */
export const B17G_TURRETS: readonly Turret[] = [
  { id: 'chin', weapon: M2_BROWNING, position: new Vector3(0, -0.70, -5.43),
    axis: new Vector3(0, -0.34, -0.94).normalize(),
    halfAngle: 45 * DEG, rotationRate: 60 * DEG, guns: 2 },
  // …其餘七座照上表填
]
```

`DEG` 由 `import { DEG } from '../core/math'` 取得（既有常數）。

`B17G_BATTERY` 改成：

```ts
export const B17G_BATTERY: Battery = {
  /**
   * **空的。** 下巴砲塔搬到 `B17G_TURRETS` 了 —— 它是投彈手遙控的動力
   * 砲塔，不是駕駛員的槍。玩家開 B-17 時沒有任何可扣扳機的武器。
   */
  mounts: [],
  convergence: 300,
  /**
   * 【為什麼還留著】`ai/assess.ts` 與 `ai/steer.ts` 有四處在讀
   * `battery.sight.muzzleVelocity` 算預瞄，而這一輪**不碰 AI**（負責人裁定）。
   * 這個欄位對轟炸機已經沒有物理意義。
   */
  sight: M2_BROWNING,
}
```

`src/weapons/he111.ts` 照同一個模式寫 `HE111_TURRETS`（五座）並清空 `mounts`。

`src/specs/b17g.ts` 與 `src/specs/he111.ts` 的 `turrets: [],` 改成 `turrets: B17G_TURRETS,` / `turrets: HE111_TURRETS,`（連同 import）。

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/hitbox.test.ts test/unit/specs.test.ts test/unit/weapons.test.ts && npx tsc --noEmit`
Expected: 全部 PASS

**若「射界錐不會撞到自己的機身」紅了**：那是 `axis` 或 `position` 訂錯了，不是門檻太嚴。回去看量測值，不要放寬測試。

- [ ] **Step 5: Commit**

```bash
git add src/weapons/b17g.ts src/weapons/he111.ts src/specs/b17g.ts src/specs/he111.ts test/unit/hitbox.test.ts
git commit -m "feat: 兩台轟炸機的砲塔配置，Battery.mounts 清空

B-17G 八座、He 111 五座。位置量自參考模型，半角與旋轉速率是設計值。

Battery.mounts 清空的理由是史實：He 111 的機首 MG 15 是球形槍座上的手持
活動槍、B-17G 的下巴是 Bendix 動力砲塔遙控瞄準，兩者都是投彈手操作的。
負責人裁定「可以轉向的都交給 AI，玩家不控火砲」。

sight 保留 —— ai/assess.ts 與 ai/steer.ts 有四處在讀它，而這一輪不碰 AI。

hitbox.test.ts 的 CASES 加進兩台轟炸機（原本只有兩台戰鬥機）。"
```

---

### Task 5: `world/turrets.ts` —— 每步推進

**Files:**
- Create: `src/world/turrets.ts`
- Test: `test/unit/turret-step.test.ts`

**Interfaces:**
- Consumes: Task 1 的全部、`stepCadence` from `src/weapons/cadence.ts`、`solveLead`／`NO_INTERCEPT` from `src/world/lead.ts`、`PROJECTILE_LIFETIME`／`Projectiles` from `src/world/Projectiles.ts`、`Combatant`（type-only）from `src/world/World.ts`
- Produces:
  - `interface TurretState { aim, cooldown, phase, targetIndex, switchCooldown, burstTimer }`
  - `createTurretStates(spec: AircraftSpec, combatantIndex: number): TurretState[]`
  - `stepTurrets(c: Combatant, all: readonly Combatant[], projectiles: Projectiles, time: number, dt: number): void`
  - 調校常數 `WOBBLE_AMPLITUDE`、`WOBBLE_OMEGA`、`BURST_ON`、`BURST_OFF`、`FIRE_THRESHOLD`、`TARGET_SWITCH_COOLDOWN`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/turret-step.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Vector3 } from 'three'
import { Projectiles } from '../../src/world/Projectiles'
import {
  createTurretStates, stepTurrets,
  WOBBLE_AMPLITUDE, BURST_ON, BURST_OFF, FIRE_THRESHOLD, TARGET_SWITCH_COOLDOWN,
} from '../../src/world/turrets'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240

/**
 * 最小的假 Combatant。只填 `stepTurrets` 讀得到的欄位 —— 不建整個 World，
 * 那會把「砲塔對不對」與「世界推進對不對」綁在一起，紅了分不出是誰的錯。
 */
function fake(spec: typeof B17G, index: number, team: 'blue' | 'red',
  pos: Vector3, vel: Vector3): Combatant {
  const aircraft = new Aircraft(spec, 3000, 100)
  aircraft.state.position.copy(pos)
  aircraft.state.velocity.copy(vel)
  return {
    index, team, alive: true, hp: spec.hp,
    aircraft,
    turrets: createTurretStates(spec, index),
  } as never as Combatant
}

describe('stepTurrets', () => {
  let projectiles: Projectiles

  beforeEach(() => { projectiles = new Projectiles(4000) })

  it('沒有敵人時不開火', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    for (let k = 0; k < 240; k++) stepTurrets(bomber, [bomber], projectiles, k * DT, DT)
    expect(projectiles.live).toBe(0)
  })

  it('敵人在尾後、射界內、射程內 —— 會開火', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    // 正後方 300 m（機體 +Z 是機尾），同向飛
    const fighter = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
    const all = [bomber, fighter]
    for (let k = 0; k < 240; k++) stepTurrets(bomber, all, projectiles, k * DT, DT)
    expect(projectiles.live).toBeGreaterThan(0)
  })

  it('敵人在正前方（尾砲塔的射界外）—— 尾砲塔不開火', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    // 正前方 300 m
    const fighter = fake(P51D, 1, 'red', new Vector3(0, 3000, -300), new Vector3(0, 0, -150))
    const all = [bomber, fighter]
    const tailIndex = B17G.turrets.findIndex((t) => t.id === 'tail')
    for (let k = 0; k < 240; k++) stepTurrets(bomber, all, projectiles, k * DT, DT)
    expect(bomber.turrets[tailIndex]!.targetIndex).toBe(-1)
  })

  it('太遠（攔截時間超過彈丸壽命）不開火', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    // 正後方 5,000 m —— 遠超過 887 m/s × 1.2 s
    const fighter = fake(P51D, 1, 'red', new Vector3(0, 3000, 5000), new Vector3(0, 0, -150))
    for (let k = 0; k < 240; k++) {
      stepTurrets(bomber, [bomber, fighter], projectiles, k * DT, DT)
    }
    expect(projectiles.live).toBe(0)
  })

  it('打爆的載機不再開火', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    const fighter = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
    bomber.hp = 0
    for (let k = 0; k < 240; k++) {
      stepTurrets(bomber, [bomber, fighter], projectiles, k * DT, DT)
    }
    expect(projectiles.live).toBe(0)
  })

  it('同隊的不會被當成目標', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    const mate = fake(P51D, 1, 'blue', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
    for (let k = 0; k < 240; k++) {
      stepTurrets(bomber, [bomber, mate], projectiles, k * DT, DT)
    }
    expect(projectiles.live).toBe(0)
  })

  /** 點放：BURST_ON + BURST_OFF 一個週期內，開火的時間佔比要接近責任週期。 */
  it('點放 —— 不是連續掃射', () => {
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
    const fighter = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
    const all = [bomber, fighter]
    let firing = 0
    const steps = Math.round((BURST_ON + BURST_OFF) * 4 / DT)
    for (let k = 0; k < steps; k++) {
      const before = projectiles.live
      stepTurrets(bomber, all, projectiles, k * DT, DT)
      if (projectiles.live > before) firing++
    }
    const duty = firing / steps
    const expected = BURST_ON / (BURST_ON + BURST_OFF)
    expect(duty).toBeLessThan(expected + 0.15)
    expect(duty).toBeGreaterThan(0)
  })

  it('射出去的方向偏離預瞄不超過搖晃振幅的 √2 倍 + 開火門檻', () => {
    // 只留尾砲塔，其餘的射界對不到這個目標
    const bomber = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, 0))
    const fighter = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3(0, 0, 0))
    const all = [bomber, fighter]
    const straight = new Vector3(0, 0, 1)
    const v = new Vector3()
    for (let k = 0; k < 480; k++) stepTurrets(bomber, all, projectiles, k * DT, DT)
    let worst = 0
    for (let i = 0; i < projectiles.capacity; i++) {
      if (projectiles.owner[i] !== 0) continue
      v.set(projectiles.vx[i]!, projectiles.vy[i]!, projectiles.vz[i]!).normalize()
      worst = Math.max(worst, straight.angleTo(v))
    }
    expect(worst).toBeLessThan(WOBBLE_AMPLITUDE * Math.SQRT2 + FIRE_THRESHOLD + 1e-6)
  })

  it('確定性 —— 同樣的輸入跑兩次，彈丸逐位元相同', () => {
    const run = (): number[] => {
      const p = new Projectiles(4000)
      const b = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, -100))
      const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
      for (let k = 0; k < 480; k++) stepTurrets(b, [b, f], p, k * DT, DT)
      const out: number[] = []
      for (let i = 0; i < p.capacity; i++) {
        if (p.owner[i] === 0) out.push(p.vx[i]!, p.vy[i]!, p.vz[i]!)
      }
      return out
    }
    expect(run()).toEqual(run())
  })

  it('換目標有冷卻 —— 不會逐格跳', () => {
    expect(TARGET_SWITCH_COOLDOWN).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/turret-step.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/world/turrets"`

- [ ] **Step 3: 寫實作**

建立 `src/world/turrets.ts`：

```ts
import { Vector3 } from 'three'
import { DEG } from '../core/math'
import { stepCadence } from '../weapons/cadence'
import { applyWobble, inArc, slew, wobblePhase } from '../weapons/turret'
import { NO_INTERCEPT, solveLead } from './lead'
import { PROJECTILE_LIFETIME } from './Projectiles'
import type { Projectiles } from './Projectiles'
import type { AircraftSpec } from '../specs/types'
import type { Combatant } from './World'

/**
 * 搖晃振幅，rad。**起始值，由試飛裁定。**
 *
 * 400 m 處 1° ≈ 7 m，而戰鬥機翼展約 11 m。掃幅 ±7 m 的意思是「定點不動
 * 會被掃到，動起來就掃不到」—— 這正是「不能久留」要的分寸。
 */
export const WOBBLE_AMPLITUDE = 1.0 * DEG

/**
 * 搖晃頻率，rad/s。**起始值，由試飛裁定。**
 *
 * 2π × 0.7 Hz，週期 1.4 秒。快到讓玩家看得出彈流在掃，慢到讓「這一下掃
 * 過去了」是一個可以反應的事件。
 */
export const WOBBLE_OMEGA = 2 * Math.PI * 0.7

/** 點放的開火與停火秒數。**起始值，由試飛裁定。** */
export const BURST_ON = 1.2
export const BURST_OFF = 0.8

/**
 * 開火門檻角，rad。**追瞄誤差**的門檻，與搖晃無關 —— 搖晃作用在射出去的
 * 子彈上，不作用在 `aim` 上。
 *
 * 取搖晃振幅的兩倍：小於它就等於要求砲手比自己的槍還準，大於它就變成
 * 朝著明顯偏掉的方向亂射。
 */
export const FIRE_THRESHOLD = 2.0 * DEG

/** 換目標的冷卻，秒。沒有它砲塔會在兩個等距的目標之間逐格跳。 */
export const TARGET_SWITCH_COOLDOWN = 1.0

export interface TurretState {
  /** 目前指向，**機體座標**單位向量。初始 = spec 的 `axis`。 */
  aim: Vector3
  /** `stepCadence` 的射速時鐘。 */
  cooldown: number
  /** 搖晃相位，見 `weapons/turret.ts` 的 `wobblePhase`。 */
  phase: number
  /** 目前目標的 combatant 索引；−1 = 沒有目標。 */
  targetIndex: number
  switchCooldown: number
  /** 點放計時：正數 = 還要打幾秒，負數 = 還要停幾秒。 */
  burstTimer: number
}

export function createTurretStates(spec: AircraftSpec, combatantIndex: number): TurretState[] {
  const n = spec.turrets.length
  const out: TurretState[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      aim: spec.turrets[i]!.axis.clone(),
      cooldown: 0,
      phase: wobblePhase(combatantIndex, n, i),
      targetIndex: -1,
      switchCooldown: 0,
      burstTimer: BURST_ON,
    })
  }
  return out
}

// 模組私有暫存，熱路徑零配置。禁止跨模組共用。
const P = /* @__PURE__ */ new Vector3()
const V = /* @__PURE__ */ new Vector3()
const LEAD = /* @__PURE__ */ new Vector3()
const WANT = /* @__PURE__ */ new Vector3()
const E1 = /* @__PURE__ */ new Vector3()
const E2 = /* @__PURE__ */ new Vector3()
const SHOT = /* @__PURE__ */ new Vector3()
const MUZZLE = /* @__PURE__ */ new Vector3()
const VEL = /* @__PURE__ */ new Vector3()
const INV = /* @__PURE__ */ new Vector3()

/**
 * 推進一架飛機的全部砲塔一個物理步。
 *
 * 【為什麼是自由函數而不是 World 的私有方法】它可以用最小的假 Combatant
 * 測，不必建整個 World。紅了分得出是「砲塔錯了」還是「世界推進錯了」。
 *
 * 【呼叫順序】必須在 `World.fire` **之後**、`projectiles.step` **之前**。
 * 兩者都往同一個池子寫，順序固定才可重現（`rematch.test.ts` 需要）。
 */
export function stepTurrets(
  c: Combatant,
  all: readonly Combatant[],
  projectiles: Projectiles,
  time: number,
  dt: number,
): void {
  // 打爆的飛機不會繼續射擊。與 World.fire 同一條規則。
  if (c.hp <= 0 || !c.alive) return
  const spec = c.aircraft.spec
  const turrets = spec.turrets
  if (turrets.length === 0) return

  const pos = c.aircraft.state.position
  const vel = c.aircraft.state.velocity
  const q = c.aircraft.state.orientation

  for (let i = 0; i < turrets.length; i++) {
    const t = turrets[i]!
    const s = c.turrets[i]!

    // ── 點放 ────────────────────────────────────────
    s.burstTimer -= dt
    if (s.burstTimer <= 0) {
      s.burstTimer = s.burstTimer + (s.burstTimer > -BURST_OFF ? 0 : 0)
      // 正 → 負代表打完了，改成停火計時；負到底代表停完了，改回開火計時
      s.burstTimer = s.burstTimer <= -BURST_OFF ? BURST_ON : s.burstTimer
    }
    const firingWindow = s.burstTimer > 0

    // ── 選目標 ──────────────────────────────────────
    s.switchCooldown -= dt
    const keep = s.targetIndex >= 0
      && s.switchCooldown > 0
      && all[s.targetIndex] !== undefined
      && all[s.targetIndex]!.alive
    if (!keep) {
      s.targetIndex = pickTarget(c, all, t, s, pos, vel, q)
      s.switchCooldown = TARGET_SWITCH_COOLDOWN
    }

    if (s.targetIndex < 0) {
      // 沒有目標就慢慢回到中心方向 —— 否則砲塔會停在最後一次追瞄的角度
      slew(s.aim, t.axis, t.rotationRate * dt)
      stepCadence(scratchCooldown(s), 0, t.weapon.roundsPerMinute, false, dt)
      continue
    }

    // ── 預瞄（機體座標）────────────────────────────
    const target = all[s.targetIndex]!
    if (!leadInBody(c, target, t, pos, vel, q)) {
      slew(s.aim, t.axis, t.rotationRate * dt)
      continue
    }

    // ── 轉向 ────────────────────────────────────────
    slew(s.aim, WANT, t.rotationRate * dt)

    // ── 開火 ────────────────────────────────────────
    const onTarget = s.aim.angleTo(WANT) < FIRE_THRESHOLD
    const trigger = firingWindow && onTarget
    const cd = scratchCooldown(s)
    const shots = stepCadence(cd, 0, t.weapon.roundsPerMinute, trigger, dt)
    s.cooldown = cd[0]!
    if (shots === 0) continue

    MUZZLE.copy(t.position).applyQuaternion(q).add(pos)
    for (let n = 0; n < shots; n++) {
      applyWobble(s.aim, WOBBLE_AMPLITUDE, WOBBLE_OMEGA, s.phase, time, E1, E2, SHOT)
      SHOT.applyQuaternion(q)
      VEL.copy(SHOT).multiplyScalar(t.weapon.muzzleVelocity).add(vel)
      projectiles.spawn(
        MUZZLE.x, MUZZLE.y, MUZZLE.z, VEL.x, VEL.y, VEL.z,
        t.weapon.damage * t.guns, c.index,
      )
    }
  }
}
```

輔助函數（同一個檔案，寫在 `stepTurrets` 之後）：

```ts
/** `stepCadence` 吃 Float32Array，這裡用一格的模組私有陣列轉接。 */
const CD = /* @__PURE__ */ new Float32Array(1)
function scratchCooldown(s: TurretState): Float32Array {
  CD[0] = s.cooldown
  return CD
}

/**
 * 解出目標的預瞄方向並轉成**機體座標**，寫進模組私有的 `WANT`。
 * 回傳 false 代表「無解、太遠、或落在射界錐外」。
 */
function leadInBody(
  c: Combatant, target: Combatant, t: Turret,
  pos: Vector3, vel: Vector3, q: Quaternion,
): boolean {
  P.copy(target.aircraft.state.position).sub(pos)
  V.copy(target.aircraft.state.velocity).sub(vel)
  const tt = solveLead(P, V, t.weapon.muzzleVelocity, LEAD)
  // 【射程判定就是「t ≤ 彈丸壽命」】與 HUD 預瞄環同一個條件，不另外訂數字
  if (tt === NO_INTERCEPT || tt > PROJECTILE_LIFETIME) return false
  // 世界 → 機體
  INV.copy(LEAD).applyQuaternion(CONJ.copy(q).conjugate())
  WANT.copy(INV)
  return inArc(t, WANT)
}

/** 挑目標：敵隊、存活、有解、在射界內，取最近的。 */
function pickTarget(
  c: Combatant, all: readonly Combatant[], t: Turret, s: TurretState,
  pos: Vector3, vel: Vector3, q: Quaternion,
): number {
  let best = -1
  let bestDist = Infinity
  for (let k = 0; k < all.length; k++) {
    const o = all[k]!
    if (!o.alive || o.team === c.team || o.index === c.index) continue
    if (!leadInBody(c, o, t, pos, vel, q)) continue
    const d = o.aircraft.state.position.distanceToSquared(pos)
    if (d < bestDist) { bestDist = d; best = o.index }
  }
  return best
}
```

需要在檔頭補 `import { Quaternion } from 'three'`、`const CONJ = new Quaternion()`，以及 `import type { Turret } from '../weapons/turret'`。

**注意**：`pickTarget` 用 `o.index` 當回傳值而 `all[s.targetIndex]` 用它當索引 —— `World` 保證 `combatants[i].index === i`（`alive` 是旗標而不是移除，見 `World.ts` 的 `Combatant.alive` 註解），所以兩者等價。實作時要在註解裡寫明這個前提。

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/turret-step.test.ts && npx tsc --noEmit`
Expected: 全部 PASS

**若「點放」那條紅了**：先印出 `burstTimer` 的軌跡再改 —— 上面的點放狀態機寫得很繞，很可能要重寫成明確的兩段式（`burstTimer` 恆為正、另加一個 `firing: boolean`）。**重寫狀態機是對的，放寬 0.15 的容差不是。**

- [ ] **Step 5: Commit**

```bash
git add src/world/turrets.ts test/unit/turret-step.test.ts
git commit -m "feat: world/turrets.ts —— 砲塔的每步推進

選目標（敵隊、存活、有解、t ≤ 彈丸壽命、在射界錐內、取最近）、轉向
（受 rotationRate 上限）、點放、搖晃、生彈丸。

寫成自由函數而不是 World 的私有方法，所以可以用最小的假 Combatant 測 ——
紅了分得出是「砲塔錯了」還是「世界推進錯了」。

射程判定直接用「攔截時間 ≤ PROJECTILE_LIFETIME」，與 HUD 預瞄環同一個
條件，不另外訂一個數字。"
```

---

### Task 6: 接進 `World` 與整合驗收

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/integration/turrets.test.ts`

**Interfaces:**
- Consumes: `createTurretStates`、`stepTurrets`、`TurretState` from Task 5
- Produces: `Combatant.turrets: TurretState[]`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/integration/turrets.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { PROJECTILE_CAPACITY } from '../../src/world/Projectiles'
// 場景建置沿用既有的整合測試怎麼做 —— 見 test/integration/ai-defence.test.ts
// 的 setup helper，照抄它的 20v20 建法，只把紅隊機種換成 B17G。

/**
 * 主判準是 **A/B 對照**：砲塔開與關跑同一場，比 P-51 的存活率。
 * 單看絕對數字看不出「砲塔有沒有用」—— 那取決於 AI、地圖、初始配置。
 */
describe('轟炸機砲塔（20 架 P-51D 對 20 架 B-17G、300 秒）', () => {
  it('砲塔開的時候 P-51 死得比較多', () => {
    const on = runBattle({ turrets: true })
    const off = runBattle({ turrets: false })
    expect(on.blueAlive).toBeLessThan(off.blueAlive)
  }, 10 * 60 * 1000)

  it('砲塔真的打得到 —— B-17 的擊落數 > 0', () => {
    const on = runBattle({ turrets: true })
    expect(on.redKills).toBeGreaterThan(0)
  }, 10 * 60 * 1000)

  /** 反方向也要成立：砲塔不是無敵的，否則轟炸機就不能被打下來。 */
  it('P-17 仍然打得下 B-17', () => {
    const on = runBattle({ turrets: true })
    expect(on.blueKills).toBeGreaterThan(0)
  }, 10 * 60 * 1000)

  /**
   * 【為什麼要守彈丸池】環狀緩衝滿了會**覆寫最舊的** —— 子彈在半空中消失，
   * 而且不會有任何錯誤。spec §7.2 算出來的最壞情況是 3,456；這一條把它
   * 從「算的」變成「量的」。
   */
  it('彈丸池峰值存活數低於九成容量', () => {
    const on = runBattle({ turrets: true })
    expect(on.peakLive).toBeLessThan(PROJECTILE_CAPACITY * 0.9)
  }, 10 * 60 * 1000)
})
```

`runBattle` 照 `test/integration/ai-defence.test.ts` 既有的 20v20 建法寫，並在每一步之後記錄 `world.projectiles.live` 的最大值。`{ turrets: false }` 的做法是傳一份 `{ ...B17G, turrets: [] }` 的 spec 複本 —— **不要加全域開關**，那會多一條只有測試在走的路徑。

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/integration/turrets.test.ts`
Expected: FAIL —— `Property 'turrets' does not exist on type 'Combatant'`

- [ ] **Step 3: 接線**

在 `src/world/World.ts`：

1. `import { createTurretStates, stepTurrets } from './turrets'` 與 `import type { TurretState } from './turrets'`
2. `Combatant` 介面裡，在 `muzzleFlash` 之後加：

```ts
  /**
   * 每座砲塔的執行期狀態。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時砲塔數會變。
   */
  turrets: TurretState[]
```

3. 建立 `Combatant` 的地方（`add`／`spawn`，約 `World.ts:232` 附近）加 `turrets: createTurretStates(spec, index),`
4. `setSpec` 裡，在 `muzzleFlash` 重配之後加：

```ts
    // 【砲塔狀態跟著 spec 一起重配】與射速時鐘、槍焰計時器同一個理由，
    // 而且必須在同一個地方 —— 分開寫就是只有一份會被修好的那種危險。
    c.turrets = createTurretStates(spec, c.index)
```

5. `step` 的第 2 段，在 `this.fire(c, dt)` 的迴圈之後、`this.projectiles.step(dt)` 之前加：

```ts
    // 【砲塔在 fire 之後、彈丸推進之前】兩者都往同一個池子寫，順序固定
    // 才可重現（rematch.test.ts 逐位元比對）。
    for (const c of this.combatants) {
      if (!c.alive) continue
      stepTurrets(c, this.combatants, this.projectiles, this.time, dt)
    }
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/integration/turrets.test.ts && npx tsc --noEmit`
Expected: PASS

**若「彈丸池峰值」紅了**：把量到的峰值報出來，然後**問專案負責人**要不要提高 `PROJECTILE_CAPACITY`（提高會動到 `perf-gate`，那是護欄）。不要自己改門檻。

- [ ] **Step 5: 跑重現性與效能護欄（必須單獨跑）**

```bash
npx vitest run test/integration/rematch.test.ts
npx vitest run test/unit/perf-gate.test.ts
```
Expected: 兩者都 PASS

**若 `rematch` 紅了**：搖晃或選目標裡有非確定性的東西。查 `Math.random`、物件迭代順序、以及 `stepTurrets` 的呼叫順序是否穩定。**不要在測試裡放寬比對。**

- [ ] **Step 6: Commit**

```bash
git add src/world/World.ts test/integration/turrets.test.ts
git commit -m "feat: 砲塔接進 World

Combatant 加 turrets: TurretState[]，在 add/spawn 與 setSpec 兩處配置
（與 cooldowns、muzzleFlash 同一個地方 —— 分開寫就是只有一份會被修好）。

step 的呼叫點在 fire 之後、彈丸推進之前：兩者都往同一個池子寫，順序固定
才可重現。

整合驗收的主判準是 A/B 對照（砲塔開／關跑同一場比存活率），因為單看絕對
數字看不出砲塔有沒有用。關的那一份用 { ...B17G, turrets: [] } 的 spec
複本，不加全域開關 —— 那會多一條只有測試在走的路徑。"
```

---

### Task 7: 視覺 —— 黑色三角柱槍管與砲塔槍焰

**Files:**
- Create: `src/render/turretBarrels.ts`
- Modify: `src/render/muzzle.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `MAX_TURRETS` from Task 1、`Combatant.turrets` from Task 6
- Produces:
  - `createTurretBarrels(aircraftCapacity: number): TurretBarrels`，介面與 `Muzzles` 相同（`object`、`update(combatants, positions, quaternions)`、`dispose`）
  - `createTurretMuzzles(aircraftCapacity: number): Muzzles`

- [ ] **Step 1: 寫槍管的幾何與實例池**

建立 `src/render/turretBarrels.ts`。三角柱：3 個側面（6 個三角形）+ 2 個端蓋（2 個三角形）= **8 個三角形/根**。

```ts
/**
 * 砲塔的槍管 —— 黑色三角柱，**跟著砲塔轉**。
 *
 * 【為什麼不烘進機身】靜態槍管在砲塔轉向時，彈流會從槍管**旁邊**飛出去。
 * 砲塔的重點就是它會轉，這個穿幫每一次射擊都看得到。
 *
 * 【為什麼是 InstancedMesh】跟槍焰走同一條更新路徑，**不新增任何場景節點**。
 * 40 架 × 每架最多 MAX_TURRETS × 2 管 = 640 個實例，對 InstancedMesh 是零壓力。
 *
 * 【8 個三角形/根】3 個側面 ×2 + 2 個端蓋。B-17G 十二根 ≈ 96 個三角形。
 */
export const BARREL_LENGTH = 0.9
export const BARREL_RADIUS = 0.045
/** 雙聯砲塔的兩根管子左右各偏這麼多，m。 */
export const BARREL_SPACING = 0.10
/** 一座砲塔最多幾根管子。雙聯是 2。 */
export const MAX_BARRELS_PER_TURRET = 2
```

幾何用 `BufferGeometry` 手工組：三個頂點在 `+Z` 方向的等邊三角形截面，沿 `−Z`（往機體外）延伸 `BARREL_LENGTH`。材質 `MeshBasicMaterial({ color: 0x101010 })`。

`update` 逐架、逐砲塔、逐管寫入實例矩陣：

```ts
// 管子的世界位置 = 砲塔位置 + 側偏 套上內插姿態 再加內插位置
// 朝向 = 砲塔目前的 aim（機體座標）套上內插姿態
```

用不到的實例照 `muzzle.ts` 的既有做法壓成零尺度（`M.compose(ZERO, ROT.identity(), ZERO)`）。

- [ ] **Step 2: 砲塔的槍焰池**

在 `src/render/muzzle.ts` 加 `createTurretMuzzles(aircraftCapacity)`：與 `createMuzzles` **共用同一個 `crossFlare()` 幾何與材質建構**，差別只有兩處 —— 容量是 `aircraftCapacity * MAX_TURRETS`，以及 `update` 讀的是 `c.turrets[i].aim`（機體座標，要套姿態）與砲塔自己的槍焰計時器。

砲塔的槍焰計時器加在 `TurretState` 上（`flash: number`），由 Task 5 的 `stepTurrets` 在開火時設成 `FLASH_SECONDS`、每步遞減。**這需要回頭改 Task 5 的檔案**，改完把 `turret-step.test.ts` 重跑一次。

- [ ] **Step 3: main.ts 接線**

```ts
import { createTurretBarrels } from './render/turretBarrels'
import { createMuzzles, createTurretMuzzles } from './render/muzzle'

const turretBarrels = createTurretBarrels(MAX_COMBATANTS)
ctx.scene.add(turretBarrels.object)
const turretMuzzles = createTurretMuzzles(MAX_COMBATANTS)
ctx.scene.add(turretMuzzles.object)
```

在既有的 `muzzles.update(...)` 那一行（`main.ts:903`）之後加兩行同樣的呼叫。

- [ ] **Step 4: 型別檢查與 Playwright 目視驗收**

```bash
npx tsc --noEmit
npm run dev        # 5178
```

寫一支 Playwright 腳本開一場 20v20（藍隊 P-51D、紅隊 B-17G），飛到 B-17 後方 300 m 截圖，確認：
1. 尾砲塔有兩根黑色管子而且**指著你**
2. 開火時管子末端有槍焰
3. 彈流從**管口**出來而不是從機身中間

**這是目視驗收，不寫成測試**（照專案裁決：不為外形寫測試）。

- [ ] **Step 5: Commit**

```bash
git add src/render/turretBarrels.ts src/render/muzzle.ts src/main.ts src/world/turrets.ts test/unit/turret-step.test.ts
git commit -m "feat: 砲塔的黑色三角柱槍管與槍焰

槍管跟著砲塔轉，用 InstancedMesh —— 靜態槍管在砲塔轉向時彈流會從管子
旁邊飛出去，而砲塔的重點就是它會轉。8 個三角形/根，B-17G 十二根 ≈ 96。

砲塔的槍焰另有一個實例池（容量是架數 × MAX_TURRETS），不動 MAX_MOUNTS。
TurretState 因此加了 flash 計時器。"
```

---

### Task 8: HUD、backlog 與全套驗收

**Files:**
- Modify: `src/main.ts`
- Modify: `docs/backlog.md`
- Create: `test/tools/projectile-peak.probe.ts`

**Interfaces:**
- Consumes: 前七個 Task 的全部

- [ ] **Step 1: HUD 的預瞄環**

`src/main.ts` 約第 1007 行的 `const sight = aircraft.spec.battery.sight` 之後，把畫預瞄環的條件改成先檢查 `aircraft.spec.battery.mounts.length > 0`：

```ts
// 【轟炸機沒有瞄準具】它們的槍全部是砲塔，由 AI 操作 —— 玩家沒有任何可扣
// 扳機的武器，畫一個預瞄環會讓人以為按了會發射。
const hasFixedGuns = aircraft.spec.battery.mounts.length > 0
```

把 `hudFrame` 裡與預瞄環有關的欄位在 `hasFixedGuns === false` 時填成「不顯示」的值（照該檔案既有的表達方式，例如把 `leadValid` 設成 false）。

- [ ] **Step 2: 彈丸峰值探針**

建立 `test/tools/projectile-peak.probe.ts`：跑一場 20 架 P-51D 對 20 架 B-17G、300 秒，每步記錄 `world.projectiles.live`，最後印出峰值、平均、以及佔容量的百分比。

Run: `NODE_PATH=$(pwd)/node_modules npx tsx test/tools/projectile-peak.probe.ts`

把量到的峰值**寫進 spec §7.2**（取代「這是算的不是量的」那一段），用 Read/Write 工具編輯。

- [ ] **Step 3: backlog §2.21**

在 `docs/backlog.md` 的 §2.20 之後加：

```markdown
### 2.21 AI 轟炸機仍會追擊並空扣扳機 ★

**出處**：`docs/superpowers/specs/2026-08-20-bomber-turrets-design.md` §8

`src/ai/` 裡沒有任何一處讀 `role` 或分辨轟炸機。兩台轟炸機的
`Battery.mounts` 清空之後，AI 轟炸機**會繼續把機首指向敵人、繼續扣扳機、
繼續射不出東西** —— 一台 22 噸的飛機在空中追著戰鬥機跑。

**這是專案負責人 2026-08-20 裁定留到下一輪的**，不是遺漏。砲塔那一輪的
範圍是「讓轟炸機打得到人」，AI 轟炸機該怎麼飛（編隊、航線、投彈、遭遇敵
機時的反應）是另一份完整的 spec。

**最小的修法**（如果只想止血）：在 `ai/steer.ts` 加一個「沒有前射武器就
不進追擊」的閘門，讓轟炸機維持航向與編隊（`rally`／站位邏輯已經有了）。
```

- [ ] **Step 4: 全套回歸**

```bash
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

Expected: 紅的**仍然只有既有那三條**（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）。數量增加就是新缺陷，要查不要放行。

判斷方法（不要靠肉眼看 tail）：

```bash
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts" \
  --exclude "**/ai-command-channel.test.ts" --exclude "**/ai-withdraw-anchor.test.ts"
```
這一份必須**全綠**。

- [ ] **Step 5: Commit**

```bash
git add src/main.ts docs/backlog.md docs/superpowers/specs/2026-08-20-bomber-turrets-design.md test/tools/projectile-peak.probe.ts
git commit -m "feat: 轟炸機不畫預瞄環、backlog §2.21、彈丸峰值回填

轟炸機的槍全部是砲塔由 AI 操作，玩家沒有任何可扣扳機的武器 —— 畫一個
預瞄環會讓人以為按了會發射。

§2.21 記下已知後果：AI 沒有任何一處分辨轟炸機，所以 AI 轟炸機會繼續追擊
並空扣扳機。這是負責人裁定留到下一輪的，不是遺漏，連最小的修法一起寫下。

spec §7.2 的彈丸預算由「算的」換成「量的」。"
```

---

## 自我檢查

**1. Spec 覆蓋**

| spec 章節 | Task |
| --- | --- |
| §3.1 為什麼是新概念 | 1（`turret.ts` 的檔頭註解） |
| §3.2 檔案 | 全部 |
| §4 資料形狀、`guns` 乘傷害 | 1、4 |
| §5 錐不是多邊形 | 1（註解）、4（半角） |
| §6 搖晃、相位、只作用在砲塔 | 1、5 |
| §7.1 每步流程 | 5、6 |
| §7.2 彈丸預算（點放、雙聯、射程門檻） | 5、6、8 |
| §8 沒有前射武器、保留 sight、已知後果、HUD | 4、8 |
| §9 兩台的配置 | 3、4 |
| §10 視覺 | 7 |
| §11 測試 | 1、4、5、6 |
| §12 起始值 | 4（半角、轉速）、5（其餘） |

**2. 佔位符掃描**：Task 3 與 Task 4 的「待量」不是佔位符 —— Task 3 的整個責任就是產出那些數字，而且驗收判準（沒有半徑等於 `maxRadius`）是具體的。其餘各步都有可執行的指令與可貼上的程式碼。

**3. 型別一致性**：`TurretState` 在 Task 5 定義、Task 6 與 Task 7 消費，欄位名一致；Task 7 會**回頭加一個 `flash` 欄位**並要求重跑 Task 5 的測試，這一點已在該步寫明。`createTurretStates(spec, combatantIndex)` 的簽名在 Task 5、6 一致。`Combatant.turrets` 的名字在 Task 5 的假物件與 Task 6 的真介面一致。

**4. 已知的粗糙處**（留給實作者，不是佔位符）：Task 5 的點放狀態機寫得很繞，該步已經寫明「重寫成明確的兩段式是對的，放寬容差不是」。
