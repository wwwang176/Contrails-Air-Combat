# 轟炸機自衛砲塔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 He 111 與 B-17G 長出 AI 操作的自衛砲塔，使「尾追一台轟炸機」不再完全安全。

**Architecture:** `Turret` 是與 `Battery` 平行的新概念（射界錐 + 旋轉速率 + 確定性搖晃），由 `world/turrets.ts` 每個物理步推進，彈丸進同一個 `Projectiles` 池。純函數（射界、搖晃、相位、轉向）與世界狀態（選目標、轉向、開火）分成兩個檔案；`world/turrets.ts` **不 import `World.ts`**，只吃一個結構相容的最小介面，所以既可脫離 `World` 測試，也不會形成循環相依。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess` + `noUnusedParameters`）、three.js r180、vitest、Playwright、Vite。

**Spec:** `docs/superpowers/specs/2026-08-20-bomber-turrets-design.md`

**這一版的來歷**：第一版由 Codex 審過，抓出 14 條必須修，其中三條是真缺陷而不是風格問題 —— 尾砲塔的槍口在命中盒之外（那條斷言必紅）、`resetBattle` 沒有把 `World.time` 歸零（搖晃吃它，重播會從不同相位開始）、`castRay` 對超出 `maxRadius` 的交點是**忽略**不是夾住（原本的量測驗收判準因此永遠不會觸發）。全部已驗證並反映在下面。

## Global Constraints

- **分支 `feat/bomber-turrets`**，已建立。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且長期被修改的檔案。一律列明確路徑。
- **絕不用 PowerShell 讀寫含中文的檔案**（會變亂碼）。用 Read/Write 工具，或 Python `io.open(..., encoding='utf-8')`。
- **指令一律寫成跨殼可用的形式**：不要用 `$(pwd)`、不要用反斜線續行。需要環境變數時分成兩行寫，或改用不需要環境變數的寫法。
- **不得引入 `@types/node`**。型別檢查指令是 `npx tsc --noEmit`。
- **`test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts` 必須單獨跑**，併行會假紅。
- **熱路徑零配置**：每個物理步跑到的程式碼不得配置物件。用模組私有的暫存常數，照 `src/world/World.ts` 的 `S.v` 與 `src/render/muzzle.ts` 的 `POS`/`DIR` 的既有做法。
- **確定性**：`world/turrets.ts` 不得使用 `Math.random`、不得依賴物件鍵的迭代順序。
- **護欄重新定值是專案負責人的決定。** 測試紅了要先量、先報告、先問，絕不為了讓測試變綠而放寬門檻。
- **不為飛機外形寫測試。** 特別注意：不要把 `test/unit/hitbox.test.ts` 既有的 `CASES` 擴大，那會讓整套外形斷言開始跑轟炸機。
- 所有註解與 commit message 用**繁體中文**。
- 現有的三條紅測試（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）是既有的。驗收時確認**數量沒有增加**即可。

## 既有程式碼的事實（已逐條驗證，實作時不要再猜）

| 事實 | 位置 |
| --- | --- |
| `World` 只有 `add()`，**沒有 `spawn()`**；`add()` 內沒有 `spec` 或 `index` 區域變數，是直接寫 `this.combatants.length` 與 `aircraft.spec` | `src/world/World.ts:229` |
| `respawn()` 只做 `c.cooldowns.fill(0)`，沒有碰槍焰或任何砲塔狀態 | `src/world/World.ts:580` |
| `resetBattle()` **沒有把 `world.time` 歸零** | `src/battle/setup.ts:802` |
| `FLASH_SECONDS` 由 `World.ts` 匯出，`muzzle.ts` import 它 | `src/world/World.ts:102` |
| B-17G 的 `tail` 命中盒 z 範圍是 **9.50…15.30** | `src/specs/b17g.ts:269` |
| `castRay` 對 `t > maxRadius` 是 **`continue`（忽略）**，不是夾成 `maxRadius` | `src/tools/sliceRef.ts:111` |
| `createBattle(controller, config, seed?)` 吃第三個參數 seed | `src/battle/setup.ts` |
| `bench/multi-load.ts` 用 `DEFAULT_BATTLE`（P-51D vs Bf 109），**兩者砲塔都是空陣列** | `bench/multi-load.ts:33` |
| `Projectiles.spawn(px, py, pz, vx, vy, vz, damage, owner)`、`stepCadence(Float32Array, index, rpm, trigger, dt)`、`solveLead(P, V, speed, out) → number`（無解為 `NO_INTERCEPT`） | 各自的檔案 |
| 專案**沒有機種 registry**，硬編清單散在各處 | —— |

## 檔案結構

| 檔案 | 責任 | Task |
| --- | --- | --- |
| `src/weapons/turret.ts`（新） | `Turret` 型別、`MAX_TURRETS`、射界錐、搖晃、相位、轉向 —— 純函數 | 1 |
| `test/unit/turret.test.ts`（新） | 上述的測試 | 1 |
| `src/specs/types.ts` | `AircraftSpec` 加必填的 `turrets` | 2 |
| `src/specs/*.ts` | 填 `turrets` | 2, 4 |
| `test/tools/turret-sites.probe.ts`（新） | 量兩台的砲塔位置 | 3 |
| `src/weapons/b17g.ts`、`src/weapons/he111.ts` | `TURRETS` 常數；`Battery.mounts` 清空 | 4 |
| `test/unit/turret-mount.test.ts`（新） | 砲塔的跨模組護欄。**新檔，不動 `hitbox.test.ts` 的 `CASES`** | 4 |
| `src/world/turrets.ts`（新） | `TurretState`、`TurretCombatant`、調校常數、`stepTurrets`、`resetTurretStates` | 5 |
| `test/unit/turret-step.test.ts`（新） | `stepTurrets` 的行為 | 5 |
| `src/world/World.ts` | `Combatant` 加三個欄位；`add`／`setSpec`／`respawn` 接上 | 6 |
| `src/battle/setup.ts` | `resetBattle` 把 `world.time` 歸零 | 6 |
| `test/integration/turret-replay.test.ts`（新） | **真正的逐位元重播比對** | 7 |
| `bench/turret-load.ts`（新）、`test/unit/perf-gate.test.ts` | B-17 專用的砲塔負載與門檻 | 8 |
| `src/render/turretBarrels.ts`（新）、`src/render/muzzle.ts`、`src/main.ts` | 槍管與砲塔槍焰 | 9 |
| `test/integration/turrets.test.ts`（新）、`src/main.ts`、`docs/backlog.md` | A/B 驗收、HUD、backlog | 10 |

---

### Task 1: `weapons/turret.ts` —— 純函數層

**Files:**
- Create: `src/weapons/turret.ts`
- Test: `test/unit/turret.test.ts`

**Interfaces:**
- Consumes: `WeaponSpec` from `src/weapons/types.ts`
- Produces: `Turret`、`MAX_TURRETS`、`GOLDEN`、`GOLDEN_ANGLE`、`BASIS_PARALLEL`、`inArc`、`wobbleBasis`、`wobblePhase`、`applyWobble`、`slew`

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
  id: 'test-tail', weapon: M2_BROWNING,
  position: new Vector3(0, 1, 16.4),
  axis: new Vector3(0, 0, 1),
  halfAngle: 30 * DEG, rotationRate: 90 * DEG, guns: 2,
}

describe('射界錐', () => {
  it('偏 29° 在錐內、偏 31° 在錐外、30° 邊界算內', () => {
    const at = (d: number): Vector3 =>
      new Vector3(0, Math.sin(d * DEG), Math.cos(d * DEG))
    expect(inArc(TAIL, at(29))).toBe(true)
    expect(inArc(TAIL, at(30))).toBe(true)
    expect(inArc(TAIL, at(31))).toBe(false)
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
   * 【為什麼要測門檻兩側】aim 指向正上方時 `aim × (0,1,0)` 是零向量，
   * normalize 之後整條彈流變成 NaN 而且不會有任何錯誤 —— Sperry 上部砲塔
   * 的中心方向就是正上方。只測「不是 NaN」不夠：壞實作若在門檻兩側都走
   * 備援分支，正常方向的基底就會是錯的，而測試看不出來。
   */
  it('門檻兩側都給出有效且垂直的基底', () => {
    // 剛好在門檻內側（走主分支）與外側（走備援分支）
    const inside = new Vector3(Math.sqrt(1 - 0.985 ** 2), 0.985, 0).normalize()
    const outside = new Vector3(Math.sqrt(1 - 0.995 ** 2), 0.995, 0).normalize()
    expect(Math.abs(inside.y)).toBeLessThan(BASIS_PARALLEL)
    expect(Math.abs(outside.y)).toBeGreaterThan(BASIS_PARALLEL)
    for (const aim of [inside, outside, new Vector3(0, 1, 0), new Vector3(0, -1, 0)]) {
      wobbleBasis(aim, e1, e2)
      expect(Number.isFinite(e1.x + e1.y + e1.z), `${aim.toArray()}`).toBe(true)
      expect(e1.length()).toBeCloseTo(1, 10)
      expect(e2.length()).toBeCloseTo(1, 10)
      expect(e1.dot(aim)).toBeCloseTo(0, 10)
      expect(e2.dot(aim)).toBeCloseTo(0, 10)
    }
  })
})

describe('搖晃相位', () => {
  it('同一架的各座互不相同', () => {
    const phases = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => wobblePhase(3, 8, i))
    expect(new Set(phases.map((p) => p.toFixed(6))).size).toBe(8)
  })

  it('相鄰兩架的同一座也不同 —— 編隊不會同步擺動', () => {
    expect(Math.abs(wobblePhase(3, 8, 0) - wobblePhase(4, 8, 0))).toBeGreaterThan(1e-3)
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

  it('確定性 —— 同一個 t 與相位逐位元相同', () => {
    const a = applyWobble(AIM, A, W, 0.5, 3.25, e1, e2, out).clone()
    const b = applyWobble(AIM, A, W, 0.5, 3.25, e1, e2, out).clone()
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z])
  })

  it('偏離的上界恰好是 A√2，而且真的掃到八成以上', () => {
    let worst = 0
    for (let k = 0; k < 20000; k++) {
      applyWobble(AIM, A, W, 0.7, k * 0.003, e1, e2, out)
      worst = Math.max(worst, AIM.angleTo(out))
    }
    expect(worst).toBeLessThanOrEqual(A * Math.SQRT2 * 1.0001)
    expect(worst).toBeGreaterThan(A * 0.8)
  })

  /**
   * 【為什麼要測「多個週期都不重複」】兩個頻率若整除，李薩茹圖形會退化成
   * 一條封閉曲線，目標只要待在曲線之外就永遠打不到 —— 那正是這個設計要
   * 避免的。只比一個週期不夠：頻率比若是 2 或 3，第一個週期看起來也不重複。
   */
  it('連續 12 個基本週期都沒有回到同一點', () => {
    const period = (2 * Math.PI) / W
    const first = applyWobble(AIM, A, W, 0, 0, e1, e2, out).clone()
    for (let n = 1; n <= 12; n++) {
      const later = applyWobble(AIM, A, W, 0, n * period, e1, e2, out)
      expect(first.angleTo(later), `第 ${n} 個週期回到原點了`).toBeGreaterThan(A * 0.05)
    }
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

  it('目標在範圍外時恰好轉 maxAngle，而且離目標更近', () => {
    const aim = new Vector3(0, 0, -1)
    const start = aim.clone()
    const want = new Vector3(0, Math.sin(40 * DEG), -Math.cos(40 * DEG))
    slew(aim, want, 5 * DEG)
    expect(start.angleTo(aim)).toBeCloseTo(5 * DEG, 6)
    expect(aim.angleTo(want)).toBeLessThan(start.angleTo(want))
  })

  /**
   * 【為什麼要測正反向，而且要測「真的轉了」】aim 與 want 完全相反時外積
   * 是零向量，轉軸 normalize 之後是 NaN。但只斷言「不是 NaN」抓不到壞實作
   * —— 一個「遇到退化就原地不動」的版本也會通過，而那會讓砲塔在目標繞到
   * 正後方時永遠卡住。
   */
  it('目標正好在反方向時仍然轉了 maxAngle', () => {
    const aim = new Vector3(0, 0, -1)
    const start = aim.clone()
    slew(aim, new Vector3(0, 0, 1), 5 * DEG)
    expect(Number.isFinite(aim.x + aim.y + aim.z)).toBe(true)
    expect(aim.length()).toBeCloseTo(1, 10)
    expect(start.angleTo(aim)).toBeCloseTo(5 * DEG, 6)
  })

  it('反覆呼叫之後仍是單位向量', () => {
    const aim = new Vector3(0.1, 0.2, -0.9).normalize()
    for (let k = 0; k < 500; k++) slew(aim, new Vector3(1, 0, 0), 1 * DEG)
    expect(aim.length()).toBeCloseTo(1, 8)
  })
})

describe('容量上界', () => {
  it('MAX_TURRETS 撐得住 B-17G 的八座', () => {
    expect(MAX_TURRETS).toBeGreaterThanOrEqual(8)
  })

  it('GOLDEN 是黃金比', () => {
    expect(GOLDEN).toBeCloseTo((1 + Math.sqrt(5)) / 2, 9)
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
 * 扳機驅動（`Combatant.command.firing`），砲塔自己找目標、自己決定開火。
 *
 * 設計理由見 `docs/superpowers/specs/2026-08-20-bomber-turrets-design.md` §3.1。
 */
export interface Turret {
  id: string
  weapon: WeaponSpec
  /**
   * **槍口**位置，機體座標，m。彈丸與槍焰都從這裡生。
   *
   * 【是槍口不是樞軸】真機的槍管本來就會伸出蒙皮之外，所以這個點**可以在
   * 命中盒外面**（B-17G 的尾砲塔就是：槍口 z ≈ 16.4，而尾部命中盒只到
   * 15.30）。護欄因此不是「槍口在盒內」而是「沿 −axis 回走一段槍管長度
   * 會接到機體」，見 `test/unit/turret-mount.test.ts`。
   */
  position: Vector3
  /**
   * 射界錐的中心方向，機體座標單位向量。
   *
   * 【為什麼是錐不是多邊形】真機的射界不規則，但**照片讀不出精確邊界**，
   * 而這個專案已經為「從照片讀來的前提」付過一整輪的代價（見
   * `.claude/skills/aircraft-from-reference` 坑 22）。一個中心方向 + 一個
   * 半角是**可以被試飛推翻的形式**，多邊形不是。
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
   * 這裡可以改回去。視覺上仍然畫 `guns` 根槍管。
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
export const GOLDEN = 1.618033988749895

/** 黃金角，rad。相位乘它才會在 [0, 2π) 上散得最開。 */
export const GOLDEN_ANGLE = 2.399963229728653

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
 * 順序或上一幀的狀態，同一個 t 就會給出不同的方向，逐位元重播會紅，而且
 * 症狀是隨機的。
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
  combatantIndex: number, turretCount: number, turretIndex: number,
): number {
  const n = combatantIndex * turretCount + turretIndex
  const p = (n * GOLDEN_ANGLE) % (Math.PI * 2)
  return p < 0 ? p + Math.PI * 2 : p
}

/**
 * 把 `aim` 繞兩個垂直軸各偏一個小角，寫進 `out` 並回傳。
 *
 * ```
 *   θ₁ = A · sin(ω·t + φ)          沿 e₁
 *   θ₂ = A · sin(ω·t·Φ + φ)        沿 e₂
 * ```
 *
 * 兩個頻率比是無理數，所以疊出來是**李薩茹圖形**：不重複、會把整個錐面
 * 掃滿，但每一瞬間仍然是連續平滑的移動。單一正弦是一條來回掃的直線，
 * 目標只要離開那條線就永遠打不到。
 *
 * 【偏移量加在切平面上，用 tan】偏離角恰好是 `atan(√(tan²θ₁ + tan²θ₂))`，
 * 而 `atan(√2·tan A) ≤ √2·A` 對所有 `|A| < π/2` 都成立 —— **這是精確上界，
 * 不只是小角度近似**。
 */
export function applyWobble(
  aim: Vector3, amplitude: number, omega: number, phase: number, t: number,
  e1: Vector3, e2: Vector3, out: Vector3,
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
 * 就會遇到）。**反向時仍然要轉滿 maxAngle** —— 原地不動的話砲塔會永遠卡住。
 *
 * `Vector3.applyAxisAngle` 在 three.js r180 使用模組級的 `_quaternion`，
 * 不會每次配置，符合熱路徑零配置。
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

- [ ] **Step 4: 跑測試與型別檢查**

Run: `npx vitest run test/unit/turret.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 沒有輸出

- [ ] **Step 5: Commit**

```bash
git add src/weapons/turret.ts test/unit/turret.test.ts
git commit -m "feat: weapons/turret.ts —— 砲塔的純函數層

射界錐、確定性搖晃（李薩茹）、相位散佈、轉向速率上限。

兩個會**靜靜產生 NaN** 的退化情況特別測了，而且測的是「真的做對了」
不只是「不是 NaN」：aim 指向正上方時搖晃基底的外積為零（Sperry 上部
砲塔的中心方向就是正上方），以及目標繞到正後方時轉軸的外積為零 ——
後者若實作成「退化就原地不動」，砲塔會永遠卡住而測試看不出來。

搖晃的偏離上界 A√2 是精確值不是小角度近似：
atan(√2·tan A) ≤ √2·A 對所有 |A| < π/2 都成立。"
```

---

### Task 2: `AircraftSpec.turrets` 欄位

**Files:**
- Modify: `src/specs/types.ts`、`src/specs/p51d.ts`、`src/specs/bf109g6.ts`、`src/specs/he111.ts`、`src/specs/b17g.ts`
- Test: `test/unit/specs.test.ts`

**Interfaces:**
- Consumes: `Turret`、`MAX_TURRETS` from Task 1
- Produces: `AircraftSpec.turrets: readonly Turret[]`（**必填**）

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/specs.test.ts` 最後加：

```ts
import { MAX_TURRETS } from '../../src/weapons/turret'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'

/**
 * 【為什麼還是硬編一份清單】這個專案沒有機種 registry，硬編清單散在十幾個
 * 檔案裡（見 `.claude/skills/aircraft-from-reference` 的「不要為外型寫測試」
 * 末段）。這裡照既有做法，但 `turrets` 是**必填**欄位，所以漏掉的機種會先
 * 被型別擋下來，不會靜靜地沒有測試在跑。
 */
const ALL = [P51D, BF109G6, HE111, B17G]

describe('砲塔欄位', () => {
  it('戰鬥機沒有砲塔', () => {
    expect(P51D.turrets).toHaveLength(0)
    expect(BF109G6.turrets).toHaveLength(0)
  })

  /**
   * 砲塔的槍焰與槍管用「架數 × MAX_TURRETS」預配實例，超出上界的那一座會
   * **靜靜地畫不出來**。與 `weapons.test.ts` 守 MAX_MOUNTS 的那一條同理。
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

Run: `npx tsc --noEmit`
Expected: FAIL —— `Property 'turrets' does not exist on type 'AircraftSpec'`

- [ ] **Step 3: 加欄位與四台的值**

`src/specs/types.ts`：最上方加 `import type { Turret } from '../weapons/turret'`，`AircraftSpec` 裡緊接在 `battery` 之後加：

```ts
  /**
   * 自衛砲塔。**必填，戰鬥機填空陣列。**
   *
   * 【為什麼必填而不是選填】選填的話新增機種時不會有任何東西提醒你去補；
   * 必填欄位由型別直接擋下來。這個專案已經被硬編機種清單咬過一次
   * （見 `.claude/skills/aircraft-from-reference` 末段），`role` 那一輪也是
   * 同一個理由。
   *
   * 與 `battery` 的差別：`battery` 由**玩家的扳機**驅動
   * （`Combatant.command.firing`），砲塔自己找目標、自己決定開火。
   */
  turrets: readonly Turret[]
```

四台的 `battery:` 之後各加 `turrets: [],`（戰鬥機兩台附註解「戰鬥機沒有自衛砲塔」；兩台轟炸機的真正內容在 Task 4 填）。

- [ ] **Step 4: 跑測試與型別檢查**

Run: `npx vitest run test/unit/specs.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 沒有輸出

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
- Modify: 本檔案的 Task 4 配置表

**Interfaces:**
- Consumes: `__hangarSpec`、`__hangarRef`、`__hangarSlice`（`src/tools/hangar.ts` 的既有開發出口）
- Produces: 兩台的砲塔槍口位置（機體座標）

**背景**：這個專案的紀律是「**能量的就不要用眼睛判斷**」。做法見 `.claude/skills/aircraft-from-reference` 第 5b 步。已經量到的兩個值：

- B-17G 尾砲塔的槍管：機體 z 16.4…17.14、y ≈ 1.0、x ±0.14（`docs/backlog.md` §2.15）
- He 111 機腹吊艙：剖面中心 y = −0.75、後窗 z 4.51…5.51（skill 第 5b 步）

- [ ] **Step 1: 起開發伺服器（背景）**

Run: `npm run dev`
Expected: `Local: http://localhost:5178/`（本專案固定用 port 5178）

- [ ] **Step 2: 寫量測腳本**

建立 `test/tools/turret-sites.probe.ts`。每一組要切**兩個不同的 `maxRadius`**，理由見 Step 3。

```ts
/**
 * 量兩台轟炸機的砲塔位置 —— **能量的就不要用眼睛判斷**。
 *
 *   npx tsx test/tools/turret-sites.probe.ts     # 需要 npm run dev 開在 5178
 *
 * 【射線原點要放進零件裡】從機身軸心往外打會先打到蒙皮，量到的是外殼不是
 * 砲塔。把原點放進砲塔自己的剖面中心，砲塔的輪廓才會單獨浮出來 —— 這與
 * 座艙罩那一招同源（skill 第 2 步）。
 *
 * 【每一組都用兩個 maxRadius】`castRay` 對 `t > maxRadius` 的交點是
 * **直接忽略**（`src/tools/sliceRef.ts:111`），不是夾成上界。所以「量到的
 * 值等於 maxRadius」永遠不會發生，不能當驗收判準；真正的風險是**外表面被
 * 截掉之後回報了內部的面或 0**，而那看起來完全正常。唯一可靠的檢查是換一
 * 個更大的半徑重跑，看輪廓有沒有變。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/hangar'

interface Cut {
  label: string
  kind: 'radial' | 'extent'
  axis: 'x' | 'y' | 'z'
  opt: Record<string, number | number[]>
  /** radial 才有：兩個要比對的半徑 */
  radii?: [number, number]
}

const B17: Cut[] = [
  { label: '上部 Sperry', kind: 'radial', axis: 'z', radii: [0.8, 1.3],
    opt: { from: -2.2, to: 0.4, count: 27, angles: 72, axisV: 1.15 } },
  { label: '球形腹部', kind: 'radial', axis: 'z', radii: [0.9, 1.4],
    opt: { from: 0.6, to: 2.6, count: 21, angles: 72, axisV: -1.05 } },
  { label: '尾砲塔', kind: 'radial', axis: 'z', radii: [0.7, 1.2],
    opt: { from: 15.8, to: 17.4, count: 17, angles: 72, axisV: 1.0 } },
  { label: '腰部窗（沿 x 切）', kind: 'extent', axis: 'x',
    opt: { from: 0.4, to: 1.2, count: 9, uWindow: [4.5, 6.5] } },
  { label: '頰槍（沿 x 切）', kind: 'extent', axis: 'x',
    opt: { from: 0.3, to: 1.0, count: 8, uWindow: [-5.2, -3.8] } },
]

const HE111: Cut[] = [
  { label: '機背 B-Stand', kind: 'radial', axis: 'z', radii: [0.7, 1.2],
    opt: { from: -0.8, to: 1.6, count: 25, angles: 72, axisV: 0.95 } },
  { label: '機腹後 C-Stand', kind: 'radial', axis: 'z', radii: [0.8, 1.3],
    opt: { from: 4.2, to: 5.8, count: 17, angles: 72, axisV: -0.75 } },
  { label: '側窗（沿 x 切）', kind: 'extent', axis: 'x',
    opt: { from: 0.3, to: 1.0, count: 8, uWindow: [1.0, 3.0] } },
]

async function slice(page: Page, kind: string, axis: string,
  opt: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(([k, a, o]) => (window as unknown as {
    __hangarSlice: (k: string, a: string, o: unknown) => unknown
  }).__hangarSlice(k as string, a as string, o), [kind, axis, opt] as const)
}

async function measure(page: Page, id: string, cuts: readonly Cut[]): Promise<void> {
  await page.evaluate((s) => (window as unknown as {
    __hangarSpec: (x: string) => void }).__hangarSpec(s), id)
  // 參考模型有 25 MB，輪詢到就緒為止而不是硬等
  await page.waitForFunction(() => (window as unknown as {
    __hangarRef: (on: boolean, solid: boolean) => boolean }).__hangarRef(true, true),
  undefined, { timeout: 180_000 })

  console.log(`\n══ ${id} ═══════════════════════════════════════`)
  for (const cut of cuts) {
    console.log(`\n  ── ${cut.label} ──`)
    if (cut.radii === undefined) {
      console.log(JSON.stringify(await slice(page, cut.kind, cut.axis, cut.opt)))
      continue
    }
    for (const r of cut.radii) {
      const rows = await slice(page, cut.kind, cut.axis, { ...cut.opt, maxRadius: r })
      console.log(`  maxRadius ${r}：`)
      console.log(JSON.stringify(rows))
    }
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

- [ ] **Step 3: 跑量測並驗收**

Run: `npx tsx test/tools/turret-sites.probe.ts`

**驗收判準（與第一版不同，第一版是錯的）**：

同一刀在**兩個不同 `maxRadius`** 下的輪廓要**一樣**。不一樣就代表小的那個把外表面截掉了 —— `castRay` 忽略超出上界的交點，於是回報了內部的面或 0，而那看起來完全正常。看到不一樣就再放大一級重跑，直到連續兩級相同為止。

要把別的零件排除在外時，靠**射線原點、切面窗口（`uWindow`）、或 mesh 名稱**（`__hangarSlice` 的第五個參數），**不要靠壓低 `maxRadius`**。

- [ ] **Step 4: 把數字填進 Task 4 的配置表**

用 Read/Write 工具編輯本檔案（**不要用 PowerShell**，中文會變亂碼）。每一格後面註明是從哪一刀、哪一個角度、哪一個 `maxRadius` 讀出來的。

- [ ] **Step 5: Commit**

```bash
git add test/tools/turret-sites.probe.ts docs/superpowers/plans/2026-08-20-bomber-turrets.md
git commit -m "measure: 兩台轟炸機的砲塔位置

射線原點放進砲塔自己的剖面中心，砲塔的輪廓才會單獨浮出來 —— 從機身軸心
打只會量到蒙皮（skill 第 5b 步）。

驗收判準是「兩個不同 maxRadius 給出同一個輪廓」。castRay 對超出上界的交點
是**直接忽略**不是夾住（sliceRef.ts:111），所以『量到的值等於上界』永遠不會
發生、不能當判準；真正的風險是外表面被截掉之後回報了內部的面，而那看起來
完全正常。"
```

---

### Task 4: 兩台的砲塔配置與 `Battery` 清空

**Files:**
- Modify: `src/weapons/b17g.ts`、`src/weapons/he111.ts`、`src/specs/b17g.ts`、`src/specs/he111.ts`
- Create: `test/unit/turret-mount.test.ts`

**Interfaces:**
- Consumes: `Turret` from Task 1、Task 3 量到的位置
- Produces: `B17G_TURRETS`、`HE111_TURRETS`

**⚠ 不要動 `test/unit/hitbox.test.ts` 的 `CASES`。** 把它從 `[P51D, BF109G6]` 擴成四台會讓整套**外形**斷言（頂點、命中盒幾何）開始跑兩台轟炸機，直接違反「不為飛機外形寫測試」的既有裁決。砲塔的跨模組護欄寫在新檔案裡。

**配置表**（`position` 是**槍口**；半角與旋轉速率是設計值；標「待量」的由 Task 3 填）：

B-17G —— 八座、`guns` 合計 12：

| id | position | axis | halfAngle | rotationRate | guns |
| --- | --- | --- | ---: | ---: | ---: |
| `chin` | `(0, −0.70, −5.43)` | `(0, −0.34, −0.94)` | 45° | 60°/s | 2 |
| `cheekL` / `cheekR` | 待量 | `(∓0.57, 0, −0.82)` | 35° | 90°/s | 1 |
| `top` | 待量 | `(0, 1, 0)` | 80° | 60°/s | 2 |
| `ball` | 待量 | `(0, −1, 0)` | 80° | 60°/s | 2 |
| `waistL` / `waistR` | 待量 | `(∓1, 0, 0)` | 60° | 90°/s | 1 |
| `tail` | `(0, 1.0, 16.4)` | `(0, 0.09, 1)` | 30° | 90°/s | 2 |

He 111 H-6 —— 五座、`guns` 合計 5：

| id | position | axis | halfAngle | rotationRate | guns |
| --- | --- | --- | ---: | ---: | ---: |
| `nose` | `(0.25, 0.35, −2.93)` | `(0, 0, −1)` | 40° | 90°/s | 1 |
| `dorsal` | 待量 | `(0, 0.64, 0.77)` | 70° | 90°/s | 1 |
| `ventral` | 待量（z ≈ 5.0、y ≈ −0.75） | `(0, −0.64, 0.77)` | 60° | 90°/s | 1 |
| `beamL` / `beamR` | 待量 | `(∓1, 0, 0)` | 45° | 90°/s | 1 |

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/turret-mount.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { segmentBox } from '../../src/world/hit'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 【為什麼是新檔而不是加進 hitbox.test.ts】那一支的 `CASES` 一擴大，整套
 * **外形**斷言（頂點數、命中盒幾何）就會開始跑兩台轟炸機，違反
 * 「不為飛機外形寫測試」的既有裁決。這裡只跑砲塔的跨模組一致性。
 */
const TURRET_CASES: readonly AircraftSpec[] = [HE111, B17G]

/** 護欄用：從槍口往機體方向回走這麼遠，必須碰到機體。 */
const BARREL_REACH = 1.5

describe('砲塔的位置與射界', () => {
  for (const spec of TURRET_CASES) {
    describe(spec.name, () => {
      it('axis 是單位向量', () => {
        for (const t of spec.turrets) {
          expect(t.axis.length(), `${t.id} 的 axis 不是單位向量`).toBeCloseTo(1, 6)
        }
      })

      /**
       * 【為什麼不是「槍口在命中盒內」】真機的槍管本來就伸出蒙皮之外。
       * B-17G 的尾砲塔槍口在 z ≈ 16.4，而它的 tail 命中盒只到 15.30
       * （`src/specs/b17g.ts:269`）—— 那條斷言必然紅，而正確的反應不是
       * 把命中盒撐大，是換一條有意義的護欄。
       *
       * 真正要守的是「這挺槍**接在飛機上**」：從槍口沿 −axis 回走一段
       * 槍管長度，必須進入某個命中盒。缺陷情境：某座砲塔的位置打錯正負號
       * 而飄在機外三公尺。
       */
      it('每個砲塔沿 −axis 回走 1.5 m 都會接到機體', () => {
        const back = new Vector3()
        for (const t of spec.turrets) {
          back.copy(t.position).addScaledVector(t.axis, -BARREL_REACH)
          const hit = spec.hitBoxes.some((b) => segmentBox(
            t.position.x, t.position.y, t.position.z, back.x, back.y, back.z, b) > 0)
          expect(hit, `砲塔 ${t.id} 回走 ${BARREL_REACH} m 沒有接到機體`).toBe(true)
        }
      })

      /**
       * 【為什麼要取錐邊緣而不只是中心線】中心線不撞機身不代表整個錐都不撞。
       * 腰部機槍的錐往前掃就會掃到自己的機翼與發動機艙。同隊已被 World 的
       * team 檢查排除，所以打不到自己人 —— 但那些彈丸是**白生的**，佔著只有
       * 4,000 格的池子，而且看起來像穿模。
       */
      it('射界錐的八個邊緣方向都不會撞到自己的機身', () => {
        const dir = new Vector3()
        const e1 = new Vector3()
        const e2 = new Vector3()
        const end = new Vector3()
        const UP = new Vector3(0, 1, 0)
        const ALT = new Vector3(0, 0, -1)
        for (const t of spec.turrets) {
          const u = Math.abs(t.axis.dot(UP)) > 0.99 ? ALT : UP
          e1.copy(t.axis).cross(u).normalize()
          e2.copy(t.axis).cross(e1)
          for (let k = 0; k < 8; k++) {
            const th = (k / 8) * Math.PI * 2
            dir.copy(t.axis).multiplyScalar(Math.cos(t.halfAngle))
              .addScaledVector(e1, Math.sin(t.halfAngle) * Math.cos(th))
              .addScaledVector(e2, Math.sin(t.halfAngle) * Math.sin(th))
              .normalize()
            end.copy(t.position).addScaledVector(dir, 12)
            for (const box of spec.hitBoxes) {
              if (box.part === 'wingLeft' || box.part === 'wingRight') continue
              const hit = segmentBox(
                t.position.x, t.position.y, t.position.z, end.x, end.y, end.z, box)
              expect(
                hit,
                `${spec.id} 砲塔 ${t.id} 的錐邊緣（第 ${k} 個方位）會打到 ${box.part}`,
              ).toBeLessThanOrEqual(0)
            }
          }
        }
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

  it('sight 仍然保留 —— ai/assess.ts 與 ai/steer.ts 有四處在讀它', () => {
    expect(HE111.battery.sight.muzzleVelocity).toBeGreaterThan(0)
    expect(B17G.battery.sight.muzzleVelocity).toBeGreaterThan(0)
  })
})

describe('砲塔數量與管數', () => {
  it('B-17G 八座、槍管合計 12 根', () => {
    expect(B17G.turrets).toHaveLength(8)
    expect(B17G.turrets.reduce((s, t) => s + t.guns, 0)).toBe(12)
  })

  it('He 111 五座、槍管合計 5 根', () => {
    expect(HE111.turrets).toHaveLength(5)
    expect(HE111.turrets.reduce((s, t) => s + t.guns, 0)).toBe(5)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/turret-mount.test.ts`
Expected: FAIL —— `expect(B17G.turrets).toHaveLength(8)` 得到 0

- [ ] **Step 3: 寫配置**

`src/weapons/b17g.ts` 加（`DEG` 由 `import { DEG } from '../core/math'` 取得）：

```ts
/**
 * B-17G 的自衛砲塔 —— 八座、槍管合計 12 根。
 *
 * 【為什麼下巴砲塔也在這裡】Bendix Model D 是**動力砲塔**，由機首的投彈手
 * 遙控瞄準，不是駕駛員能扣的槍。專案負責人 2026-08-20 裁定：可以轉向的
 * 都交給 AI，玩家不控火砲。所以 `B17G_BATTERY.mounts` 是空的。
 *
 * 【`position` 是槍口不是樞軸】真機的槍管本來就伸出蒙皮之外，所以尾砲塔的
 * 槍口（z 16.4）在 `tail` 命中盒（到 15.30）**之外**，那是對的。護欄是
 * 「沿 −axis 回走 1.5 m 會接到機體」，見 `test/unit/turret-mount.test.ts`。
 *
 * 【半角是設計值不是量測值】真機的射界不規則，照片讀不出精確邊界。
 * 一個中心方向 + 一個半角是可以被試飛推翻的形式。見 spec §5。
 *
 * 【旋轉速率】動力砲塔 60 °/s（馬達與減速機構，轉得穩但慢）、手持槍
 * 90 °/s（轉得快但射界小）。**兩個數字都沒有實測支撐**，由試飛裁定。
 *
 * 【位置全部量自參考模型】做法見 `test/tools/turret-sites.probe.ts`。
 */
export const B17G_TURRETS: readonly Turret[] = [
  { id: 'chin', weapon: M2_BROWNING, position: new Vector3(0, -0.70, -5.43),
    axis: new Vector3(0, -0.34, -0.94).normalize(),
    halfAngle: 45 * DEG, rotationRate: 60 * DEG, guns: 2 },
  // …其餘七座照配置表填
]
```

`B17G_BATTERY` 改成 `mounts: []`，並把「為什麼還留著 sight」的理由寫進註解。`src/weapons/he111.ts` 照同一個模式。兩份 spec 的 `turrets:` 接上。

- [ ] **Step 4: 跑測試與型別檢查**

Run: `npx vitest run test/unit/turret-mount.test.ts test/unit/hitbox.test.ts test/unit/specs.test.ts test/unit/weapons.test.ts`
Expected: 全部 PASS

Run: `npx tsc --noEmit`
Expected: 沒有輸出

**若「錐邊緣不撞機身」紅了**：那是 `axis` 或 `halfAngle` 訂錯了。縮小半角是正當的修法（半角本來就是設計值），**擴大命中盒不是**。

- [ ] **Step 5: Commit**

```bash
git add src/weapons/b17g.ts src/weapons/he111.ts src/specs/b17g.ts src/specs/he111.ts test/unit/turret-mount.test.ts
git commit -m "feat: 兩台轟炸機的砲塔配置，Battery.mounts 清空

B-17G 八座 12 管、He 111 五座 5 管。位置量自參考模型，半角與旋轉速率是
設計值。

護欄寫在新檔 turret-mount.test.ts 而不是加進 hitbox.test.ts 的 CASES ——
擴大那份清單會讓整套外形斷言開始跑轟炸機，違反「不為飛機外形寫測試」。

護欄本身也換了：不是「槍口在命中盒內」（尾砲塔的槍口在 z 16.4，而 tail
命中盒只到 15.30 —— 真機的槍管本來就伸出蒙皮），而是「沿 −axis 回走
1.5 m 會接到機體」，加上射界錐的八個邊緣方向都不撞自己的機身。"
```

---

### Task 5: `world/turrets.ts` —— 每步推進

**Files:**
- Create: `src/world/turrets.ts`
- Test: `test/unit/turret-step.test.ts`

**Interfaces:**
- Consumes: Task 1 全部、`stepCadence`、`solveLead`／`NO_INTERCEPT`、`PROJECTILE_LIFETIME`／`Projectiles`
- Produces:
  - `interface TurretState { aim, phase, targetIndex, searchCooldown, burstFiring, burstTimer, flash }`
  - `interface TurretCombatant`（結構相容的最小介面，**不 import `World.ts`**）
  - `createTurretStates(spec, combatantIndex): TurretState[]`
  - `resetTurretStates(states, spec, combatantIndex): void`（**就地重設、零配置**）
  - `stepTurrets(c, all, projectiles, time, dt): void`
  - 常數 `WOBBLE_AMPLITUDE`、`WOBBLE_OMEGA`、`BURST_ON`、`BURST_OFF`、`FIRE_THRESHOLD`、`SEARCH_INTERVAL`、`TURRET_FLASH_SECONDS`

**三個關鍵設計（第一版全錯，這裡是修正後的）**：

1. **`turrets.ts` 不 import `World.ts`。** 它定義 `TurretCombatant` 這個結構相容的最小介面；`World.Combatant` 自然滿足它。這同時解決兩件事：Task 5 的 `tsc` 不必等 Task 6，以及 `World → turrets → World` 的循環相依。`TURRET_FLASH_SECONDS` 也是自己的常數，不從 `World.ts` import。
2. **冷卻用 `Combatant.turretCooldowns: Float32Array`，直接餵給 `stepCadence`。** 不要用一格的 scratch 陣列轉接 —— 那個寫法在「沒有目標」與「預瞄失敗」兩條分支上都漏了寫回，冷卻會凍結，破壞既有的「放開扳機仍倒數到零」行為。**每座砲塔每步都必須恰好呼叫 `stepCadence` 一次**，即使 `trigger === false`。
3. **預瞄從槍口解，不是從重心解。** B-17 的尾砲塔離重心 16 m，300 m 尾追時方向誤差可達數度 —— 大於 2° 的開火門檻，砲塔會一直「對不準」而不開火，或開火但打偏。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/turret-step.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Vector3, Quaternion } from 'three'
import { Projectiles } from '../../src/world/Projectiles'
import {
  createTurretStates, resetTurretStates, stepTurrets, stepBurst,
  WOBBLE_AMPLITUDE, BURST_ON, BURST_OFF, FIRE_THRESHOLD, SEARCH_INTERVAL,
  type TurretCombatant, type TurretState,
} from '../../src/world/turrets'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240

function fake(spec: AircraftSpec, index: number, team: 'blue' | 'red',
  pos: Vector3, vel: Vector3): TurretCombatant {
  const aircraft = new Aircraft(spec, 3000, 100)
  aircraft.state.position.copy(pos)
  aircraft.state.velocity.copy(vel)
  aircraft.state.orientation.copy(new Quaternion())
  return {
    index, team, alive: true, hp: spec.hp, aircraft,
    turretStates: createTurretStates(spec, index),
    turretCooldowns: new Float32Array(spec.turrets.length),
  }
}

const bomberAt = (z: number): TurretCombatant =>
  fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, z))
const fighterAt = (z: number, vz: number): TurretCombatant =>
  fake(P51D, 1, 'red', new Vector3(0, 3000, z), new Vector3(0, 0, vz))

describe('點放狀態機', () => {
  /**
   * 【為什麼直接測狀態機而不是數「有子彈的步數」】800 rpm ÷ 240 Hz 表示
   * 即使連續開火也只有約 1/18 = 5.6% 的物理步會生出子彈。用「生彈的步數
   * 佔比」當判準的話，**把點放整個拿掉也會通過** —— 那個測試測不到它宣稱
   * 的東西。
   */
  it('在開火段與停火段之間交替，週期正確', () => {
    const s: TurretState = {
      aim: new Vector3(0, 0, 1), phase: 0, targetIndex: -1,
      searchCooldown: 0, burstFiring: true, burstTimer: BURST_ON, flash: 0,
    }
    let firing = 0
    const steps = Math.round((BURST_ON + BURST_OFF) * 10 / DT)
    for (let k = 0; k < steps; k++) if (stepBurst(s, DT)) firing++
    const duty = firing / steps
    expect(duty).toBeCloseTo(BURST_ON / (BURST_ON + BURST_OFF), 2)
  })

  it('大步長也不會卡住 —— 一步跨過好幾個週期', () => {
    const s: TurretState = {
      aim: new Vector3(0, 0, 1), phase: 0, targetIndex: -1,
      searchCooldown: 0, burstFiring: true, burstTimer: BURST_ON, flash: 0,
    }
    // 一步 10 秒，遠大於 BURST_ON + BURST_OFF
    for (let k = 0; k < 20; k++) stepBurst(s, 10)
    expect(s.burstTimer).toBeGreaterThan(0)
    expect(Number.isFinite(s.burstTimer)).toBe(true)
  })
})

describe('stepTurrets', () => {
  let projectiles: Projectiles
  beforeEach(() => { projectiles = new Projectiles(4000) })

  const run = (b: TurretCombatant, all: TurretCombatant[], steps: number): void => {
    for (let k = 0; k < steps; k++) stepTurrets(b, all, projectiles, k * DT, DT)
  }

  it('沒有敵人時不開火', () => {
    const b = bomberAt(-100)
    run(b, [b], 480)
    expect(projectiles.live).toBe(0)
  })

  it('敵人在尾後、射界內、射程內 —— 會開火', () => {
    const b = bomberAt(-100)
    const f = fighterAt(300, -150)
    run(b, [b, f], 480)
    expect(projectiles.live).toBeGreaterThan(0)
  })

  it('敵人在正前方時尾砲塔沒有目標', () => {
    const b = bomberAt(-100)
    const f = fighterAt(-300, -150)
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    run(b, [b, f], 480)
    expect(b.turretStates[tail]!.targetIndex).toBe(-1)
  })

  it('太遠（攔截時間超過彈丸壽命）不開火', () => {
    const b = bomberAt(-100)
    const f = fighterAt(5000, -150)
    run(b, [b, f], 480)
    expect(projectiles.live).toBe(0)
  })

  it('打爆的載機不再開火', () => {
    const b = bomberAt(-100)
    const f = fighterAt(300, -150)
    b.hp = 0
    run(b, [b, f], 480)
    expect(projectiles.live).toBe(0)
  })

  it('同隊的不會被當成目標', () => {
    const b = bomberAt(-100)
    const mate = fake(P51D, 1, 'blue', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
    run(b, [b, mate], 480)
    expect(projectiles.live).toBe(0)
  })

  /**
   * 【真正的換目標測試】第一版只斷言常數大於零 —— 完全不使用那個常數的
   * 實作也會通過。這裡讓兩個敵機中途交換遠近，斷言冷卻期間不換、到期才換。
   */
  it('換目標有冷卻 —— 冷卻內不換，到期才換', () => {
    const b = bomberAt(0)
    const near = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    const far = fake(P51D, 2, 'red', new Vector3(0, 3000, 600), new Vector3())
    const all = [b, near, far]
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    stepTurrets(b, all, projectiles, 0, DT)
    expect(b.turretStates[tail]!.targetIndex).toBe(1)
    // 把原本近的挪遠、原本遠的挪近
    near.aircraft.state.position.z = 900
    far.aircraft.state.position.z = 250
    // 冷卻期間內：不換
    const half = Math.floor((SEARCH_INTERVAL * 0.5) / DT)
    for (let k = 1; k < half; k++) stepTurrets(b, all, projectiles, k * DT, DT)
    expect(b.turretStates[tail]!.targetIndex).toBe(1)
    // 過了冷卻：換成 2
    const past = Math.ceil((SEARCH_INTERVAL * 1.2) / DT)
    for (let k = half; k < past; k++) stepTurrets(b, all, projectiles, k * DT, DT)
    expect(b.turretStates[tail]!.targetIndex).toBe(2)
  })

  /**
   * 【為什麼要測「沒有目標時也不能每步全掃」】搜尋是 O(架數)，而 20 架
   * B-17 × 8 座砲塔 × 40 個候選 = 每步 6,400 次 solveLead。第一版的
   * `keep` 條件要求 targetIndex >= 0，所以**找不到目標時每一步都重掃** ——
   * 而那正是最常見的開局狀態。
   */
  it('沒有目標時搜尋也受冷卻節流', () => {
    const b = bomberAt(-100)
    const far = fighterAt(9000, -150)   // 永遠搜不到
    const all = [b, far]
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    stepTurrets(b, all, projectiles, 0, DT)
    const after = b.turretStates[tail]!.searchCooldown
    expect(after).toBeGreaterThan(0)
    stepTurrets(b, all, projectiles, DT, DT)
    expect(b.turretStates[tail]!.searchCooldown).toBeLessThan(after)
  })

  it('射出去的方向偏離正後方不超過搖晃上界 + 開火門檻', () => {
    const b = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3())
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    run(b, [b, f], 960)
    const straight = new Vector3(0, 0, 1)
    const v = new Vector3()
    let worst = 0
    for (let i = 0; i < projectiles.capacity; i++) {
      if (projectiles.owner[i] !== 0) continue
      v.set(projectiles.vx[i]!, projectiles.vy[i]!, projectiles.vz[i]!).normalize()
      worst = Math.max(worst, straight.angleTo(v))
    }
    expect(worst).toBeGreaterThan(0)
    expect(worst).toBeLessThan(WOBBLE_AMPLITUDE * Math.SQRT2 + FIRE_THRESHOLD + 1e-6)
  })

  it('確定性 —— 同樣的輸入跑兩次，彈丸速度逐位元相同', () => {
    const once = (): number[] => {
      const p = new Projectiles(4000)
      const b = bomberAt(-100)
      const f = fighterAt(300, -150)
      for (let k = 0; k < 960; k++) stepTurrets(b, [b, f], p, k * DT, DT)
      const out: number[] = []
      for (let i = 0; i < p.capacity; i++) {
        if (p.owner[i] === 0) out.push(p.vx[i]!, p.vy[i]!, p.vz[i]!)
      }
      return out
    }
    expect(once()).toEqual(once())
  })

  it('resetTurretStates 就地重設，不換陣列參考', () => {
    const b = bomberAt(-100)
    const f = fighterAt(300, -150)
    run(b, [b, f], 480)
    const before = b.turretStates
    const firstAim = b.turretStates[0]!.aim
    resetTurretStates(b.turretStates, B17G, 0)
    expect(b.turretStates).toBe(before)
    expect(b.turretStates[0]!.aim).toBe(firstAim)
    expect(b.turretStates[0]!.aim.equals(B17G.turrets[0]!.axis)).toBe(true)
    expect(b.turretStates[0]!.targetIndex).toBe(-1)
    expect(b.turretStates[0]!.flash).toBe(0)
  })

  it('槍焰計時器在開火時被設起來、之後遞減', () => {
    const b = bomberAt(0)
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    let sawFlash = false
    for (let k = 0; k < 480; k++) {
      stepTurrets(b, [b, f], projectiles, k * DT, DT)
      if (b.turretStates.some((s) => s.flash > 0)) sawFlash = true
    }
    expect(sawFlash).toBe(true)
  })

  /**
   * 【為什麼死機的槍焰也要遞減】既有的固定槍是在 `alive` 檢查**之前**遞減
   * （`World.ts:290` 的註解：「被打爆那一瞬間亮著的槍焰，若遞減寫在
   * continue 之後就會永遠停在那裡」）。砲塔必須照做。
   */
  it('載機死了之後槍焰仍然會遞減到零', () => {
    const b = bomberAt(0)
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    for (let k = 0; k < 480; k++) stepTurrets(b, [b, f], projectiles, k * DT, DT)
    for (const s of b.turretStates) s.flash = 0.03
    b.alive = false
    for (let k = 0; k < 240; k++) stepTurrets(b, [b, f], projectiles, k * DT, DT)
    expect(b.turretStates.every((s) => s.flash === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/turret-step.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/world/turrets"`

- [ ] **Step 3: 寫實作**

建立 `src/world/turrets.ts`：

```ts
import { Vector3, Quaternion } from 'three'
import { DEG } from '../core/math'
import { stepCadence } from '../weapons/cadence'
import { applyWobble, inArc, slew, wobblePhase } from '../weapons/turret'
import { NO_INTERCEPT, solveLead } from './lead'
import { PROJECTILE_LIFETIME } from './Projectiles'
import type { Projectiles } from './Projectiles'
import type { Turret } from '../weapons/turret'
import type { AircraftSpec } from '../specs/types'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 砲塔推進需要的最小介面。**刻意不 import `World.ts` 的 `Combatant`。**
 *
 * 【為什麼】兩個理由，缺一不可：
 * 1. `World.ts` 會 import 這個檔案，反向再 import 回去就是循環相依。
 * 2. 測試可以用最小的假物件建場景，紅了分得出是「砲塔錯了」還是「世界
 *    推進錯了」—— 建整個 World 就分不出來。
 *
 * `World.Combatant` 結構上自然滿足這個介面，不必宣告 implements。
 */
export interface TurretCombatant {
  readonly index: number
  readonly team: 'blue' | 'red'
  alive: boolean
  hp: number
  readonly aircraft: Aircraft
  turretStates: TurretState[]
  turretCooldowns: Float32Array
}

export interface TurretState {
  /** 目前指向，**機體座標**單位向量。初始 = spec 的 `axis`。 */
  aim: Vector3
  /** 搖晃相位。 */
  phase: number
  /** 目前目標的 combatant 索引；−1 = 沒有目標。 */
  targetIndex: number
  /** 距離下一次重新搜尋還有幾秒。 */
  searchCooldown: number
  /** 點放：現在是開火段還是停火段。 */
  burstFiring: boolean
  /** 點放：目前這一段還剩幾秒。**恆為正。** */
  burstTimer: number
  /** 槍焰剩餘秒數。 */
  flash: number
}

/** 搖晃振幅，rad。**起始值，由試飛裁定。** 400 m 處 1° ≈ 7 m。 */
export const WOBBLE_AMPLITUDE = 1.0 * DEG
/** 搖晃頻率，rad/s。**起始值。** 週期 1.4 秒。 */
export const WOBBLE_OMEGA = 2 * Math.PI * 0.7
/** 點放的開火與停火秒數。**起始值。** */
export const BURST_ON = 1.2
export const BURST_OFF = 0.8
/**
 * 開火門檻角，rad。**追瞄誤差**的門檻，與搖晃無關 —— 搖晃作用在射出去的
 * 子彈上，不作用在 `aim` 上。取搖晃振幅的兩倍。
 */
export const FIRE_THRESHOLD = 2.0 * DEG
/**
 * 重新搜尋目標的間隔，秒。
 *
 * 【它同時是節流與防抖】搜尋是 O(架數)：20 架 B-17 × 8 座 × 40 個候選 =
 * 每步 6,400 次 `solveLead`。**有沒有目標都要節流** —— 找不到目標才是最常
 * 見的狀態（開局全部在遠處），若「沒目標就每步重掃」就等於完全沒有節流。
 */
export const SEARCH_INTERVAL = 1.0
/**
 * 砲塔槍焰的持續秒數。
 *
 * 【為什麼不 import `World.FLASH_SECONDS`】那會造成 `World → turrets →
 * World` 的循環相依。數值刻意與固定槍相同，但是各自的常數。
 */
export const TURRET_FLASH_SECONDS = 0.03

export function createTurretStates(
  spec: AircraftSpec, combatantIndex: number,
): TurretState[] {
  const out: TurretState[] = []
  for (let i = 0; i < spec.turrets.length; i++) {
    out.push({
      aim: spec.turrets[i]!.axis.clone(),
      phase: 0, targetIndex: -1, searchCooldown: 0,
      burstFiring: true, burstTimer: BURST_ON, flash: 0,
    })
  }
  resetTurretStates(out, spec, combatantIndex)
  return out
}

/**
 * 就地重設，**不配置任何物件**。
 *
 * 【為什麼一定要就地】`World.respawn` 可能在物理步之內被呼叫（被打爆的
 * 那一格），在那裡 `new` 一批物件會違反熱路徑零配置的紀律。
 *
 * 【初始搜尋時刻要錯開】全部從 0 開始的話，160 座砲塔會在同一個物理步
 * 一起做 O(架數) 的搜尋 —— 每 SEARCH_INTERVAL 秒出現一次尖峰。用索引
 * 確定性地攤平，不用亂數（逐位元重播需要）。
 */
export function resetTurretStates(
  states: TurretState[], spec: AircraftSpec, combatantIndex: number,
): void {
  const n = spec.turrets.length
  for (let i = 0; i < n; i++) {
    const s = states[i]!
    s.aim.copy(spec.turrets[i]!.axis)
    s.phase = wobblePhase(combatantIndex, n, i)
    s.targetIndex = -1
    s.searchCooldown = ((combatantIndex * n + i) % 16) * (SEARCH_INTERVAL / 16)
    s.burstFiring = true
    s.burstTimer = BURST_ON
    s.flash = 0
  }
}

/**
 * 推進點放一步，回傳這一步是否在開火段。
 *
 * 【為什麼用 while 而不是 if】低更新率（工具程式可能用 0.3 s 甚至更大的
 * 步長）下一步可能跨過好幾個週期。用 if 會讓 `burstTimer` 變成負數而
 * 永遠不再回復。
 */
export function stepBurst(s: TurretState, dt: number): boolean {
  const firingThisStep = s.burstFiring
  s.burstTimer -= dt
  while (s.burstTimer <= 0) {
    s.burstFiring = !s.burstFiring
    s.burstTimer += s.burstFiring ? BURST_ON : BURST_OFF
  }
  return firingThisStep
}

// ── 模組私有暫存，熱路徑零配置。禁止跨模組共用。 ──────────
const P = /* @__PURE__ */ new Vector3()
const V = /* @__PURE__ */ new Vector3()
const LEAD = /* @__PURE__ */ new Vector3()
const WANT = /* @__PURE__ */ new Vector3()
const BEST_WANT = /* @__PURE__ */ new Vector3()
const E1 = /* @__PURE__ */ new Vector3()
const E2 = /* @__PURE__ */ new Vector3()
const SHOT = /* @__PURE__ */ new Vector3()
const MUZZLE = /* @__PURE__ */ new Vector3()
const VEL = /* @__PURE__ */ new Vector3()
const INV_Q = /* @__PURE__ */ new Quaternion()

/**
 * 推進一架飛機的全部砲塔一個物理步。
 *
 * 【呼叫順序】必須在 `World.fire` **之後**、`projectiles.step` **之前**。
 * 兩者都往同一個池子寫，順序固定才可重現。
 *
 * 【所有 combatant 都要呼叫，包含死掉的】槍焰的遞減要在存活檢查之前，
 * 否則被打爆那一瞬間亮著的槍焰會永遠停在那裡（與 `World.ts:290` 的固定槍
 * 同一個理由）。
 */
export function stepTurrets(
  c: TurretCombatant,
  all: readonly TurretCombatant[],
  projectiles: Projectiles,
  time: number,
  dt: number,
): void {
  const turrets = c.aircraft.spec.turrets
  if (turrets.length === 0) return

  // 1. 槍焰遞減 —— 在存活檢查之前
  for (let i = 0; i < turrets.length; i++) {
    const s = c.turretStates[i]!
    const v = s.flash - dt
    s.flash = v > 0 ? v : 0
  }
  if (!c.alive || c.hp <= 0) return

  const pos = c.aircraft.state.position
  const vel = c.aircraft.state.velocity
  const q = c.aircraft.state.orientation
  // 【一架只算一次逆姿態】每座砲塔都算一次的話是 8 倍的四元數共軛
  INV_Q.copy(q).conjugate()

  for (let i = 0; i < turrets.length; i++) {
    const t = turrets[i]!
    const s = c.turretStates[i]!
    const firingWindow = stepBurst(s, dt)

    // 槍口的世界位置。**預瞄要從這裡解，不是從重心** —— B-17 的尾砲塔
    // 離重心 16 m，300 m 尾追時方向誤差可達數度，大於 2° 的開火門檻。
    MUZZLE.copy(t.position).applyQuaternion(q).add(pos)

    // 2. 選目標。搜尋一律受冷卻節流，**與現在有沒有目標無關**
    s.searchCooldown -= dt
    if (s.searchCooldown <= 0) {
      s.targetIndex = pickTarget(c, all, t, vel)
      s.searchCooldown += SEARCH_INTERVAL
    } else if (s.targetIndex >= 0) {
      const o = all[s.targetIndex]
      if (o === undefined || !o.alive) s.targetIndex = -1
    }

    let trigger = false
    if (s.targetIndex >= 0 && leadInBody(all[s.targetIndex]!, t, vel, WANT)) {
      slew(s.aim, WANT, t.rotationRate * dt)
      trigger = firingWindow && s.aim.angleTo(WANT) < FIRE_THRESHOLD
    } else {
      // 沒有目標就慢慢回到中心方向 —— 否則砲塔會停在最後一次追瞄的角度
      slew(s.aim, t.axis, t.rotationRate * dt)
    }

    // 3. 射速時鐘。**每座每步恰好呼叫一次**，即使 trigger 是 false ——
    //    既有的「放開扳機仍倒數到零」行為靠的就是這一點
    const shots = stepCadence(
      c.turretCooldowns, i, t.weapon.roundsPerMinute, trigger, dt)
    if (shots === 0) continue
    s.flash = TURRET_FLASH_SECONDS

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

/**
 * 解出目標的預瞄方向並轉成**機體座標**，寫進 `out`。
 * 回傳 false 代表「無解、太遠、或落在射界錐外」。
 *
 * 呼叫前 `MUZZLE` 與 `INV_Q` 必須已經是這一座砲塔的值。
 */
function leadInBody(
  target: TurretCombatant, t: Turret, shooterVel: Vector3, out: Vector3,
): boolean {
  P.copy(target.aircraft.state.position).sub(MUZZLE)
  V.copy(target.aircraft.state.velocity).sub(shooterVel)
  const tt = solveLead(P, V, t.weapon.muzzleVelocity, LEAD)
  // 【射程判定就是「t ≤ 彈丸壽命」】與 HUD 預瞄環同一個條件，不另訂數字
  if (tt === NO_INTERCEPT || tt > PROJECTILE_LIFETIME) return false
  out.copy(LEAD).applyQuaternion(INV_Q)
  return inArc(t, out)
}

/** 射程的必要條件：即使迎頭全速接近也追不上就不必解二次式。 */
const MAX_REACH_SQ = (887 * PROJECTILE_LIFETIME + 400) ** 2

/**
 * 挑目標：敵隊、存活、有解、在射界內，取**離槍口**最近的。
 *
 * 【便宜的拒絕要放在 solveLead 之前】`solveLead` 有平方根與分支，而多數
 * 候選在遠處。先用距離平方擋掉。
 */
function pickTarget(
  c: TurretCombatant, all: readonly TurretCombatant[], t: Turret, vel: Vector3,
): number {
  let best = -1
  let bestDist = Infinity
  for (let k = 0; k < all.length; k++) {
    const o = all[k]!
    if (!o.alive || o.team === c.team || o.index === c.index) continue
    const d = o.aircraft.state.position.distanceToSquared(MUZZLE)
    if (d > MAX_REACH_SQ || d >= bestDist) continue
    if (!leadInBody(o, t, vel, BEST_WANT)) continue
    bestDist = d
    best = o.index
  }
  return best
}
```

**`pickTarget` 用 `BEST_WANT` 而不是 `WANT`**，這樣搜尋不會污染外層正在用的 `WANT`。外層選完之後會再對選中的目標呼叫一次 `leadInBody(..., WANT)` —— 多解一次二次式，但換到「沒有跨函數的隱式別名」。

`o.index` 當回傳值、`all[s.targetIndex]` 當索引 —— `World` 保證 `combatants[i].index === i`（`alive` 是旗標而不是移除，見 `World.ts` 的 `Combatant.alive` 註解）。這個前提要寫進註解。

- [ ] **Step 4: 跑測試與型別檢查**

Run: `npx vitest run test/unit/turret-step.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 沒有輸出

- [ ] **Step 5: Commit**

```bash
git add src/world/turrets.ts test/unit/turret-step.test.ts
git commit -m "feat: world/turrets.ts —— 砲塔的每步推進

不 import World.ts，改吃結構相容的 TurretCombatant：既避開 World → turrets
→ World 的循環相依，也讓測試能用最小的假物件建場景。

三件第一版寫錯而 Codex 抓出來的：
- 預瞄從**槍口**解不是從重心解。B-17 尾砲塔離重心 16 m，300 m 尾追時
  方向誤差可達數度，大於 2° 的開火門檻。
- 搜尋節流與「現在有沒有目標」解耦。原本找不到目標時每一步都重掃，而那
  正是最常見的開局狀態 —— 等於完全沒有節流。
- 點放改成明確的兩段式（burstFiring + 恆正的 burstTimer），用 while 保留
  跨界的 overshoot。原本那個符號編碼的版本有一行永遠加零。

射速時鐘改用 Combatant.turretCooldowns 直接餵 stepCadence，每座每步恰好
呼叫一次 —— 既有的「放開扳機仍倒數到零」靠的就是這一點。"
```

---

### Task 6: 接進 `World` 與完整的生命週期

**Files:**
- Modify: `src/world/World.ts`、`src/battle/setup.ts`
- Test: `test/unit/turret-lifecycle.test.ts`（新）

**Interfaces:**
- Consumes: Task 5 全部
- Produces: `Combatant.turretStates: TurretState[]`、`Combatant.turretCooldowns: Float32Array`

**四個接線點，缺一個就會有 stale 狀態**：`add()`、`setSpec()`、`respawn()`、`resetBattle()`。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/turret-lifecycle.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, resetBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

const cfg = (): ReturnType<typeof battleConfigFrom> => battleConfigFrom({
  ...DEFAULT_SKIRMISH, specId: 'b17g', blueCount: 2, redCount: 2,
})

describe('砲塔狀態的生命週期', () => {
  it('建立時每架都配好，長度等於該機種的砲塔數', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    for (const c of b.world.combatants) {
      expect(c.turretStates).toHaveLength(c.aircraft.spec.turrets.length)
      expect(c.turretCooldowns).toHaveLength(c.aircraft.spec.turrets.length)
    }
  })

  it('setSpec 換機種時長度跟著換', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    b.world.setSpec(c, B17G)
    expect(c.turretStates).toHaveLength(B17G.turrets.length)
    expect(c.turretCooldowns).toHaveLength(B17G.turrets.length)
  })

  /**
   * 【為什麼 respawn 也要清】不清的話，重生後的砲塔會從上一條命的指向、
   * 目標與點放相位接著跑。`World.respawn` 原本只清固定槍的 cooldowns。
   */
  it('respawn 之後砲塔回到初始狀態', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    c.turretStates[0]!.targetIndex = 3
    c.turretStates[0]!.aim.set(1, 0, 0)
    c.turretCooldowns[0] = 0.5
    b.world.respawn(c)
    expect(c.turretStates[0]!.targetIndex).toBe(-1)
    expect(c.turretStates[0]!.aim.equals(c.aircraft.spec.turrets[0]!.axis)).toBe(true)
    expect(c.turretCooldowns[0]).toBe(0)
  })

  /**
   * 【為什麼 world.time 一定要歸零】搖晃直接吃 `world.time`。不歸零的話
   * 第二場即使種子與設定完全相同，也會從**不同的搖晃相位**開始 ——
   * 逐位元重播因此破功，而症狀看起來像隨機的。
   */
  it('resetBattle 把 world.time 歸零', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    b.world.step(1 / 240)
    expect(b.world.time).toBeGreaterThan(0)
    resetBattle(b, 1)
    expect(b.world.time).toBe(0)
  })

  it('resetBattle 之後砲塔狀態也重設', () => {
    const b = createBattle(new Idle(), cfg(), 1)
    const c = b.world.combatants[0]!
    c.turretStates[0]!.targetIndex = 3
    resetBattle(b, 1)
    expect(c.turretStates[0]!.targetIndex).toBe(-1)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/turret-lifecycle.test.ts`
Expected: FAIL —— `Property 'turretStates' does not exist on type 'Combatant'`

- [ ] **Step 3: 接線**

`src/world/World.ts`：

1. 加 `import { createTurretStates, resetTurretStates, stepTurrets } from './turrets'` 與 `import type { TurretState } from './turrets'`
2. `Combatant` 介面在 `muzzleFlash` 之後加：

```ts
  /**
   * 每座砲塔的執行期狀態。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時砲塔數會變。
   */
  turretStates: TurretState[]
  /** 每座砲塔的射速時鐘。與 `cooldowns` 平行，但砲塔走自己那一條。 */
  turretCooldowns: Float32Array
```

3. `add()`（`World.ts:229`）的物件字面量裡加兩行。**注意該函數內沒有 `spec` 或 `index` 區域變數**，要寫成：

```ts
      turretStates: createTurretStates(aircraft.spec, this.combatants.length),
      turretCooldowns: new Float32Array(aircraft.spec.turrets.length),
```

4. `setSpec()` 在 `muzzleFlash` 那一段之後加：

```ts
    // 【砲塔狀態跟著 spec 一起重配】與射速時鐘、槍焰計時器同一個理由，
    // 而且必須在同一個地方 —— 分開寫就是只有一份會被修好的那種危險。
    if (c.turretCooldowns.length !== spec.turrets.length) {
      c.turretCooldowns = new Float32Array(spec.turrets.length)
      c.turretStates = createTurretStates(spec, c.index)
    } else {
      c.turretCooldowns.fill(0)
      resetTurretStates(c.turretStates, spec, c.index)
    }
```

5. `respawn()` 在 `c.cooldowns.fill(0)` 之後加：

```ts
    // 【砲塔也要清】不清的話重生後會從上一條命的指向、目標與點放相位
    // 接著跑。就地重設，不配置 —— respawn 可能在物理步之內被呼叫。
    c.turretCooldowns.fill(0)
    resetTurretStates(c.turretStates, c.aircraft.spec, c.index)
```

6. `step()` 在 `this.fire(c, dt)` 的迴圈之後、`this.projectiles.step(dt)` 之前加：

```ts
    // 【砲塔在 fire 之後、彈丸推進之前】兩者都往同一個池子寫，順序固定
    // 才可重現。**不跳過死掉的** —— 槍焰的遞減在 stepTurrets 內部、存活
    // 檢查之前，與固定槍的做法一致。
    for (const c of this.combatants) {
      stepTurrets(c, this.combatants, this.projectiles, this.time, dt)
    }
```

`src/battle/setup.ts` 的 `resetBattle()`（`:802`）在 `b.world.projectiles.clear()` 之後加：

```ts
  // 【時鐘也要歸零】砲塔的搖晃相位吃 `world.time`。不歸零的話，第二場即使
  // 種子與設定完全相同也會從不同的相位開始 —— 逐位元重播因此破功，而症狀
  // 看起來像隨機的。
  b.world.time = 0
```

（若 `World.time` 目前是 `private`／`readonly`，改成公開可寫，並在該欄位加註解說明為什麼。）

- [ ] **Step 4: 跑測試與型別檢查**

Run: `npx vitest run test/unit/turret-lifecycle.test.ts test/unit/turret-step.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 沒有輸出

- [ ] **Step 5: Commit**

```bash
git add src/world/World.ts src/battle/setup.ts test/unit/turret-lifecycle.test.ts
git commit -m "feat: 砲塔接進 World，四個生命週期接線點都補上

add / setSpec / respawn / resetBattle，缺一個就會有 stale 狀態。原本
respawn 只清固定槍的 cooldowns，resetBattle 更是連 world.time 都沒歸零 ——
而搖晃直接吃 world.time，不歸零的話第二場會從不同的相位開始，逐位元重播
破功而症狀看起來像隨機的。

step 的呼叫點在 fire 之後、彈丸推進之前，而且**不跳過死掉的** —— 槍焰的
遞減在 stepTurrets 內部、存活檢查之前，與固定槍一致（World.ts:290 的
註解：遞減若寫在 continue 之後，被打爆那一瞬間亮著的槍焰會永遠停在那裡）。"
```

---

### Task 7: 逐位元重播測試

**Files:**
- Create: `test/integration/turret-replay.test.ts`

**Interfaces:**
- Consumes: Task 6 的接線

**背景**：現有的 `test/integration/rematch.test.ts` **沒有做任何逐位元比對** —— 它測的是「改設定重開、戰績清空、十場的效能」。所以「跑它」不能證明確定性。這個 Task 補上真正的測試。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/integration/turret-replay.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createBattle, resetBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SEED = 20260820
const STEPS = 240 * 20   // 20 秒

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

const config = (): ReturnType<typeof battleConfigFrom> => battleConfigFrom({
  ...DEFAULT_SKIRMISH, specId: 'b17g', blueCount: 8, redCount: 8,
})

/**
 * 把整個世界壓成一條固定順序的浮點序列。
 *
 * 【為什麼要涵蓋砲塔狀態與彈丸】只比飛機位置的話，一個「砲塔完全不動」的
 * 壞實作也會通過 —— 砲塔不影響飛行。彈丸的速度是搖晃唯一的外顯，不比它
 * 就等於沒測到搖晃的確定性。
 */
function snapshot(b: Battle): Float64Array {
  const cs = b.world.combatants
  const p = b.world.projectiles
  const out: number[] = [b.world.time]
  for (const c of cs) {
    const st = c.aircraft.state
    out.push(st.position.x, st.position.y, st.position.z)
    out.push(st.velocity.x, st.velocity.y, st.velocity.z)
    out.push(st.orientation.x, st.orientation.y, st.orientation.z, st.orientation.w)
    out.push(c.hp, c.alive ? 1 : 0)
    for (const s of c.turretStates) {
      out.push(s.aim.x, s.aim.y, s.aim.z)
      out.push(s.phase, s.targetIndex, s.searchCooldown)
      out.push(s.burstFiring ? 1 : 0, s.burstTimer, s.flash)
    }
    for (let i = 0; i < c.turretCooldowns.length; i++) out.push(c.turretCooldowns[i]!)
  }
  for (let i = 0; i < p.capacity; i++) {
    out.push(p.owner[i]!, p.x[i]!, p.y[i]!, p.z[i]!, p.vx[i]!, p.vy[i]!, p.vz[i]!, p.age[i]!)
  }
  return Float64Array.from(out)
}

function run(steps: number): Battle {
  const b = createBattle(new Idle(), config(), SEED)
  for (let k = 0; k < steps; k++) stepBattle(b, DT)
  return b
}

/** 逐位元比較。`toEqual` 對 Float64Array 是逐元素，NaN 也算相等。 */
function expectIdentical(a: Float64Array, c: Float64Array): void {
  expect(a.length).toBe(c.length)
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== c[i]) {
      throw new Error(`第 ${i} 個元素不同：${a[i]} vs ${c[i]}`)
    }
  }
}

describe('砲塔的逐位元重播（20 架 B-17G 的 8v8、20 秒）', () => {
  it('兩場全新的相同戰局逐位元相同', () => {
    expectIdentical(snapshot(run(STEPS)), snapshot(run(STEPS)))
  }, 5 * 60 * 1000)

  /**
   * 【這一條抓的是 stale 狀態】resetBattle 若漏掉砲塔狀態或 world.time，
   * 重開的那一場就會與全新的一場分岔。第一版的計畫兩者都漏了。
   */
  it('resetBattle 之後與全新的一場逐位元相同', () => {
    const reused = createBattle(new Idle(), config(), SEED)
    for (let k = 0; k < STEPS; k++) stepBattle(reused, DT)
    resetBattle(reused, SEED)
    for (let k = 0; k < STEPS; k++) stepBattle(reused, DT)
    expectIdentical(snapshot(reused), snapshot(run(STEPS)))
  }, 5 * 60 * 1000)
})
```

- [ ] **Step 2: 跑測試**

Run: `npx vitest run test/integration/turret-replay.test.ts`
Expected: 若 Task 6 的四個接線點都對，PASS

**若第二條紅了**：`resetBattle` 還有沒清乾淨的狀態。錯誤訊息會給出第幾個元素不同 —— 對照 `snapshot` 的寫入順序就能算出是哪一架的哪一個欄位。**不要放寬比對**。

- [ ] **Step 3: Commit**

```bash
git add test/integration/turret-replay.test.ts
git commit -m "test: 真正的逐位元重播比對

現有的 rematch.test.ts 測的是「改設定重開、戰績清空、十場的效能」，
**沒有做任何逐位元比對** —— 所以「跑它」不能證明確定性。

快照涵蓋飛機狀態、砲塔狀態、砲塔冷卻與整個彈丸池：只比飛機位置的話，
一個「砲塔完全不動」的壞實作也會通過（砲塔不影響飛行）；不比彈丸速度
就等於沒測到搖晃的確定性。

第二條專門抓 stale 狀態：resetBattle 之後要與全新的一場逐位元相同。"
```

---

### Task 8: 效能 —— B-17 專用的砲塔負載

**Files:**
- Create: `bench/turret-load.ts`
- Modify: `test/unit/perf-gate.test.ts`

**背景**：現有 `bench/multi-load.ts` 用 `DEFAULT_BATTLE`（P-51D vs Bf 109），**兩者的 `turrets` 都是空陣列** —— 所以現有的 20v20 門檻測試很可能仍然綠，卻完全沒有量到砲塔那 6,400 次 `solveLead`。

- [ ] **Step 1: 寫負載**

建立 `bench/turret-load.ts`，照 `bench/multi-load.ts` 的「單一替換點」設計。**兩種負載都要**：

```ts
/**
 * 砲塔的效能負載 —— 20 架 P-51D 對 20 架 B-17G。
 *
 * 【為什麼要兩種】砲塔的成本有兩個完全不同的峰：
 *
 *   `搜尋`   沒有目標時每 SEARCH_INTERVAL 秒做一次 O(架數) 的掃描。
 *            這是**開局最常見的狀態**，而且第一版的計畫在這裡是每步全掃。
 *   `追瞄`   全部有目標時每步都解預瞄、轉向、生彈丸。
 *
 * 只量其中一種會漏掉另一種。
 */
export function createTurretSearchLoad(): TurretLoadState   // 兩隊拉開到射程外
export function createTurretTrackLoad(): TurretLoadState    // 兩隊交纏在射程內
```

- [ ] **Step 2: 加門檻測試**

在 `test/unit/perf-gate.test.ts` 加兩條，照該檔既有的門檻寫法。**門檻先量再訂**：

先跑一次量出實際的每步耗時，把數字報出來，**由專案負責人裁定門檻**。不要沿用或放寬 `multi-load` 的既有門檻——那是另一份工作量。

- [ ] **Step 3: 量測並回報**

Run: `npx vitest run test/unit/perf-gate.test.ts`（單獨跑）

把兩種負載的每步耗時、以及與既有 20v20 負載的對比報給專案負責人，等他裁定門檻之後再填進測試。

- [ ] **Step 4: Commit**

```bash
git add bench/turret-load.ts test/unit/perf-gate.test.ts
git commit -m "perf: B-17 專用的砲塔負載與門檻

現有 bench/multi-load.ts 用 DEFAULT_BATTLE（P-51D vs Bf 109），兩者的
turrets 都是空陣列 —— 所以既有的 20v20 門檻完全沒有量到砲塔。

兩種負載：搜尋（兩隊拉開到射程外，量沒有目標時的 O(架數) 掃描，那是開局
最常見的狀態）與追瞄（兩隊交纏，量每步解預瞄 + 轉向 + 生彈丸）。只量其中
一種會漏掉另一種。

門檻由專案負責人依實測裁定。"
```

---

### Task 9: 視覺 —— 黑色三角柱槍管與砲塔槍焰

**Files:**
- Create: `src/render/turretBarrels.ts`
- Modify: `src/render/muzzle.ts`、`src/main.ts`

**座標約定（第一版寫反了）**：`Turret.position` 是**槍口**。三角柱的幾何從局部原點沿 **+Z** 往後延伸 `BARREL_LENGTH`；把 `+Z` 對準 `−aim` 之後，槍管就會由槍口往**機體方向**延伸。彈丸與槍焰仍然在 `position`。雙聯的兩根管只做左右側偏，**彈流仍然只有一道**（`guns` 乘傷害，見 Task 1）。

- [ ] **Step 1: 槍管的幾何與實例池**

建立 `src/render/turretBarrels.ts`：

```ts
/**
 * 砲塔的槍管 —— 黑色三角柱，**跟著砲塔轉**。
 *
 * 【為什麼不烘進機身】靜態槍管在砲塔轉向時，彈流會從槍管**旁邊**飛出去。
 * 砲塔的重點就是它會轉，這個穿幫每一次射擊都看得到。
 *
 * 【為什麼是 InstancedMesh】跟槍焰走同一條更新路徑，**不新增任何場景節點**。
 *
 * 【8 個三角形/根】3 個側面 ×2 + 2 個端蓋。B-17G 十二根 ≈ 96 個三角形。
 */
export const BARREL_LENGTH = 0.9
export const BARREL_RADIUS = 0.045
/** 雙聯的兩根管左右各偏這麼多，m。 */
export const BARREL_SPACING = 0.10
/** 一座砲塔最多幾根管子。雙聯是 2。 */
export const MAX_BARRELS_PER_TURRET = 2
```

實例容量 `aircraftCapacity * MAX_TURRETS * MAX_BARRELS_PER_TURRET`。材質 `MeshBasicMaterial({ color: 0x101010 })`。用不到的實例壓成零尺度（照 `muzzle.ts` 的既有做法）。

側偏方向用 `wobbleBasis(aim, e1, e2)` 的 `e1`（機體座標，再套姿態）—— 與搖晃共用同一組基底，槍管不會在砲塔轉到某個角度時突然翻面。

- [ ] **Step 2: 砲塔的槍焰池**

在 `src/render/muzzle.ts` 加 `createTurretMuzzles(aircraftCapacity)`：與 `createMuzzles` 共用 `crossFlare()` 與同一份材質設定，差別只有容量（`aircraftCapacity * MAX_TURRETS`）與 `update` 讀 `c.turretStates[i].aim` / `.flash`（除以 `TURRET_FLASH_SECONDS`）。

- [ ] **Step 3: main.ts 接線**

```ts
const turretBarrels = createTurretBarrels(MAX_COMBATANTS)
ctx.scene.add(turretBarrels.object)
const turretMuzzles = createTurretMuzzles(MAX_COMBATANTS)
ctx.scene.add(turretMuzzles.object)
```

在既有的 `muzzles.update(...)`（`main.ts:903`）之後加兩行同樣的呼叫。

- [ ] **Step 4: 型別檢查與目視驗收**

Run: `npx tsc --noEmit`

起 `npm run dev`（5178），寫一支 Playwright 腳本開一場 20 架 P-51D 對 20 架 B-17G，飛到 B-17 後方 300 m 截圖，確認三件事：

1. 尾砲塔有兩根黑色管子而且**指著你**
2. 開火時管口有槍焰
3. 彈流從**管口**出來而不是從機身中間，也不是從管子的後端

**這是目視驗收，不寫成測試**（照專案裁決）。

- [ ] **Step 5: Commit**

```bash
git add src/render/turretBarrels.ts src/render/muzzle.ts src/main.ts
git commit -m "feat: 砲塔的黑色三角柱槍管與槍焰

槍管跟著砲塔轉，用 InstancedMesh —— 靜態槍管在砲塔轉向時彈流會從管子
旁邊飛出去，而砲塔的重點就是它會轉。8 個三角形/根，B-17G 十二根 ≈ 96。

座標約定：Turret.position 是槍口，三角柱從局部原點沿 +Z 往後延伸，把 +Z
對準 −aim 之後槍管由槍口往機體方向長。側偏方向與搖晃共用同一組基底，
槍管不會在砲塔轉到某個角度時突然翻面。

砲塔的槍焰另有一個實例池（容量是架數 × MAX_TURRETS），不動 MAX_MOUNTS。"
```

---

### Task 10: 整合驗收、HUD、backlog、全套回歸

**Files:**
- Create: `test/integration/turrets.test.ts`、`test/tools/projectile-peak.probe.ts`
- Modify: `src/world/Projectiles.ts`、`src/main.ts`、`docs/backlog.md`、spec §7.2 與 §10

- [ ] **Step 1: 彈丸池的高水位**

`world.projectiles.live` 在 `World.step()` **回來之後**才讀會低估峰值 —— 一步之內的順序是生成 → 推進／過期 → 命中／回收，讀到的是回收後的殘量。在 `Projectiles` 加：

```ts
  /**
   * 存活數的歷史高水位。**在 `spawn()` 裡更新** —— 在 `World.step()` 回來
   * 之後才讀 `live` 會低估：一步之內是生成 → 推進／過期 → 命中／回收，
   * 讀到的是回收後的殘量，抓不到生成瞬間逼近容量的情況。
   */
  peakLive = 0
```

`spawn()` 更新它、`clear()` 歸零。**加了這個分支之後要重跑既有的效能護欄**。

- [ ] **Step 2: 整合 A/B 驗收**

建立 `test/integration/turrets.test.ts`。**四條斷言共用一次 `beforeAll`**，不要各自重跑 300 秒。

用 `createBattle(new Idle(), battleConfigFrom({ ...DEFAULT_SKIRMISH, specId: 'b17g', blueCount: 20, redCount: 20 }), SEED)` 建場景。關掉砲塔的那一份用 `{ ...B17G, turrets: [] }` 的 spec 複本經 `world.setSpec()` 換上 —— **不要加全域開關**，那會多一條只有測試在走的路徑。

四條斷言：

1. **主判準 A/B**：砲塔開的那一場，P-51 的存活數 **少於** 關的那一場
2. B-17 的擊落數 > 0（砲塔真的打得到）
3. P-51 的擊落數 > 0（砲塔不是無敵的）
4. `projectiles.peakLive < PROJECTILE_CAPACITY * 0.9`

**若第 4 條紅了**：把量到的峰值報出來，**問專案負責人**要不要提高 `PROJECTILE_CAPACITY`（提高會動到 `perf-gate`，那是護欄）。不要自己改門檻。

- [ ] **Step 3: HUD**

`src/main.ts` 約 1007 行：

```ts
// 【轟炸機沒有瞄準具】它們的槍全部是砲塔、由 AI 操作 —— 玩家沒有任何可扣
// 扳機的武器，畫一個預瞄環會讓人以為按了會發射。
const hasFixedGuns = aircraft.spec.battery.mounts.length > 0
```

`hasFixedGuns === false` 時把 `hudFrame` 裡與預瞄環有關的欄位填成「不顯示」的值（照該檔案既有的表達方式）。

- [ ] **Step 4: 彈丸峰值探針與 spec 回填**

建立 `test/tools/projectile-peak.probe.ts`：跑 20 架 P-51D 對 20 架 B-17G、300 秒，印出 `peakLive`、平均、佔容量的百分比。

Run: `npx tsx test/tools/projectile-peak.probe.ts`

用 Read/Write 工具把量到的數字寫進 spec §7.2（取代「這是算的不是量的」那一段），並修正 spec 的兩處內部矛盾：

- §10 寫「11 根 ≈ 88 三角形」，但配置表的 `guns` 合計是 **12**（下巴 2、頰 2、上 2、腹 2、腰 2、尾 2）。改成 12 根 ≈ 96。
- §6 寫「搖晃的參數放在 `Turret` 上」，實作放在 `world/turrets.ts` 的模組常數。改寫成：**參數是模組常數，不放在 `WeaponSpec` 上**（真正要守的是「不滲進玩家的六挺翼槍」，模組常數同樣滿足；每座砲塔各自可調是 YAGNI）。

- [ ] **Step 5: backlog §2.21**

在 `docs/backlog.md` 的 §2.20 之後加一節，記錄「AI 轟炸機仍會追擊並空扣扳機」：`src/ai/` 沒有任何一處讀 `role` 或分辨轟炸機，這是專案負責人裁定留到下一輪的，不是遺漏。附上最小的修法（在 `ai/steer.ts` 加一個「沒有前射武器就不進追擊」的閘門）。

- [ ] **Step 6: 全套回歸**

```bash
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts" --exclude "**/ai-command-channel.test.ts" --exclude "**/ai-withdraw-anchor.test.ts"
```
Expected: **全綠**。這一份排除了既有的三條紅，所以任何紅都是新缺陷。

```bash
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
npx vitest run test/integration/turret-replay.test.ts
```
Expected: 三者都 PASS

- [ ] **Step 7: Commit**

```bash
git add src/world/Projectiles.ts src/main.ts docs/backlog.md docs/superpowers/specs/2026-08-20-bomber-turrets-design.md test/integration/turrets.test.ts test/tools/projectile-peak.probe.ts
git commit -m "feat: 整合驗收、HUD 不畫預瞄環、backlog §2.21、spec 回填

彈丸池加 peakLive 高水位，在 spawn() 裡更新 —— 在 World.step() 回來之後
才讀 live 會低估：一步之內是生成 → 推進／過期 → 命中／回收，讀到的是
回收後的殘量。

整合驗收的主判準是 A/B 對照（砲塔開／關比 P-51 的存活數），四條斷言共用
一次 beforeAll。關的那一份用 { ...B17G, turrets: [] } 經 setSpec 換上，
不加全域開關 —— 那會多一條只有測試在走的路徑。

轟炸機不畫預瞄環：它們的槍全部是砲塔由 AI 操作，畫了會讓人以為按了會發射。

順手修 spec 的兩處內部矛盾：§10 的槍管數（11 → 12）、§6 的搖晃參數位置
（Turret 上 → 模組常數；真正要守的是不滲進玩家的翼槍）。"
```

---

## 自我檢查

**1. Spec 覆蓋**

| spec 章節 | Task |
| --- | --- |
| §3.1 為什麼是新概念 | 1 |
| §3.2 檔案 | 全部（Task 5 的 `turrets.ts` 不 import `World.ts`，比 spec 寫的更嚴） |
| §4 資料形狀、`guns` 乘傷害 | 1、4 |
| §5 錐不是多邊形 | 1、4 |
| §6 搖晃、相位、只作用在砲塔 | 1、5（參數位置與 spec 不同，Task 10 Step 4 修 spec） |
| §7.1 每步流程 | 5、6 |
| §7.2 彈丸預算 | 5、10 |
| §8 沒有前射武器、保留 sight、已知後果、HUD | 4、10 |
| §9 兩台的配置 | 3、4 |
| §10 視覺 | 9（槍管數與 spec 不同，Task 10 Step 4 修 spec） |
| §11 測試 | 1、4、5、6、7、8、10 |
| §12 起始值 | 4、5 |

**2. Codex 的 14 條必須修，逐條對照**

| # | 問題 | 處理 |
| --- | --- | --- |
| 1 | Task 相依讓 `tsc` 失敗；`World.add()` 沒有 `spec`／`index` 區域變數 | Task 5 的 `TurretCombatant` 結構介面；Task 6 Step 3 寫明正確寫法 |
| 2 | `burstTimer` 狀態機有一行永遠加零 | Task 5 的 `stepBurst` 兩段式 + `while` |
| 3 | `scratchCooldown` 漏寫回、失敗分支不推進 cadence | 改成 `Combatant.turretCooldowns` 直接餵 `stepCadence` |
| 4 | 預瞄從重心解 | Task 5 改從 `MUZZLE` 解 |
| 5 | 無目標時每步全掃；perf-gate 測不到 | 搜尋節流與 `targetIndex` 解耦；Task 8 加 B-17 專用負載 |
| 6 | 重生／重置生命週期不完整 | Task 6 的四個接線點 + `resetTurretStates` 就地重設 + `world.time = 0` |
| 7 | `flash` 該在 Task 5；死機的 flash 會凍結；`FLASH_SECONDS` 循環相依 | `flash` 進 Task 5 的 `TurretState`；遞減在存活檢查之前；`TURRET_FLASH_SECONDS` 自己的常數 |
| 8 | 擴大 `hitbox.test.ts` 的 `CASES` 違反紀律；尾砲塔斷言必紅 | Task 4 用新檔 `turret-mount.test.ts`；護欄改成「回走 1.5 m 接到機體」+ 錐邊緣八方位 |
| 9 | `maxRadius` 驗收判準與 `castRay` 相反 | Task 3 改成「兩個不同半徑給同一個輪廓」 |
| 10 | 數個測試測不到宣稱的缺陷 | Task 1 與 Task 5 的測試全部重寫（點放直接測狀態機、換目標真的換、反向 slew 斷言轉了 maxAngle、基底測門檻兩側、12 個週期） |
| 11 | 整合測試引用不存在的 helper；rematch 沒有逐位元比對 | Task 7 新增真正的重播測試；Task 10 寫明場景建法 |
| 12 | `live` 在 step 後取樣低估峰值 | Task 10 Step 1 的 `peakLive` 高水位 |
| 13 | Bash 語法在 PowerShell 不能跑 | Global Constraints 加一條；所有指令改成跨殼可用 |
| 14 | spec 說搖晃參數在 `Turret`，計畫用模組常數 | Task 10 Step 4 修 spec（選模組常數，YAGNI） |

Codex 的四條「檢查過沒問題」也記在這裡，免得日後有人重複懷疑：`applyWobble` 的 `A√2` 是**精確上界**（`atan(√2·tan A) ≤ √2·A` 對所有 `|A| < π/2` 成立）、`Vector3.applyAxisAngle` 在 r180 用模組級 `_quaternion` 不配置、`WANT` 的 aliasing 沒有實際錯值（但 Task 5 仍改成 `BEST_WANT` 消除隱式別名）、既有 API 簽名全部正確。

**3. 型別一致性**：`TurretState` 的七個欄位（`aim`、`phase`、`targetIndex`、`searchCooldown`、`burstFiring`、`burstTimer`、`flash`）在 Task 5 定義，Task 6、7、9 消費，名字一致。`createTurretStates(spec, combatantIndex)` 與 `resetTurretStates(states, spec, combatantIndex)` 的簽名在 Task 5、6 一致。`Combatant.turretStates` / `turretCooldowns` 的名字在 Task 5 的介面、Task 6 的真欄位、Task 7 的快照一致。`TURRET_FLASH_SECONDS` 在 Task 5 定義、Task 9 消費。
