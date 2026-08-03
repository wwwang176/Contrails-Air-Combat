# M5 多機 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把戰場從 1v1 拉到 20v20 —— 命中判定的空間分割、AI 目標選擇、死亡退場、陣營生成與重置。

**Architecture:** 三塊互相獨立的新程式碼加上既有結構的接線。`src/world/cull.ts` 是一組沿 X 軸排序的並排陣列，把 `resolveHits` 的 `O(彈丸 × 架數)` 粗篩換成滑動視窗；`src/ai/target.ts` 是純函數的目標評分與遲滯選擇，外加一塊全場共享的指派板；`src/battle/setup.ts` 負責一場 20v20 的生成、存活統計與重置。`World` 新增一個存活旗標與一個可注入的撞地判定，其餘結構不動。

**Tech Stack:** TypeScript 5.7（strict + `noUncheckedIndexedAccess` + `noUnusedLocals` + `noUnusedParameters` + `exactOptionalPropertyTypes`）、three.js 0.180、vitest 2.1、vite 6。

**規格：** `docs/superpowers/specs/2026-08-03-m5-multi-aircraft-design.md`

## Global Constraints

- **輸出一律繁體中文**，包含程式碼註解、測試名稱與 commit 訊息。
- **熱路徑零配置**：每個物理步會跑到的程式碼不得 `new`、不得 `[...]`、不得 `for...of` 迭代型別化陣列。暫存向量一律用 `makeScratch(n)`，模組私有、禁止跨模組共用。
- **索引迴圈而不是 `for...of`**：`for...of` 每次配置一個迭代器物件。已存在的 `resolveHits` 就是為此寫成索引迴圈。
- **`noUncheckedIndexedAccess` 生效**：所有型別化陣列與一般陣列的索引存取都回傳 `T | undefined`，必須以 `!` 或明確的 `undefined` 檢查處理。
- **不得放寬既有測試的門檻**。效能門檻失敗代表熱路徑有迴歸，必須修程式而不是改數字。
- **不得從 `World.combatants` 移除元素**：`Combatant.index` 是彈丸記錄射手用的，`splice` 會讓所有在飛的彈丸認錯主人。退場是標記，不是刪除。
- **不得修改 `src/ai/profile.ts`**：難度調整由專案負責人明確延後。`ACE` 的兩個欄位維持 0。
- **不得為飛機外型寫測試**。
- **門檻不得用「看起來合理的數字」**：spec §13 列的 12 個門檻在 Task 16 由量測回填，並把依據寫回 spec。實作期間先用本計畫給的起始值，每個起始值都在註解裡標明「起始值，待 Task 16 回填」。
- **每個任務結束時整套測試必須全綠**：`npx vitest run`。型別檢查用 `npm run build`。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/world/cull.ts`（新增） | 沿 X 軸排序的粗篩索引。純資料結構，不知道 `World` 的存在 |
| `src/world/World.ts`（修改） | 存活旗標、退場、可注入的撞地判定、接上 `cull` |
| `src/ai/target.ts`（新增） | 目標評分、指派板、遲滯選擇。純函數 |
| `src/ai/AiController.ts`（修改） | 接上目標選擇；決策相位錯開 |
| `src/battle/setup.ts`（新增） | 20v20 的生成、存活統計、全滅偵測與重置 |
| `src/hud/types.ts`（修改） | `HudFrame` 增加存活數與重置倒數 |
| `src/hud/widgets/roster.ts`（新增） | 存活數與重置倒數的繪製 |
| `src/hud/Hud.ts`（修改） | 掛上新 widget |
| `src/main.ts`（修改） | 改用 `battle/setup` 建場；注入撞地判定；填 HUD 新欄位 |
| `bench/multi-load.ts`（新增） | 20v20 × 滿載彈丸的負載定義（單一替換點） |
| `bench/multi.bench.ts`（新增） | 上述負載的 benchmark |
| `test/unit/perf-gate.test.ts`（修改） | 加一條 20v20 的門檻斷言 |

---

## Task 1: 粗篩索引 `CullIndex`

**Files:**
- Create: `src/world/cull.ts`
- Test: `test/unit/cull.test.ts`

**Interfaces:**
- Consumes: 無（純新增，不 import 專案內任何模組）
- Produces:
  - `class CullIndex`，公開欄位 `x` / `y` / `z` / `r2`（`Float32Array`）、`index`（`Int32Array`）、`team`（`Uint8Array`）、`count: number`、`rMax: number`
  - `ensure(n: number): void`、`clear(): void`、`add(x: number, y: number, z: number, radius: number, index: number, team: number): void`、`sort(): void`、`lowerBound(value: number): number`

- [ ] **Step 1: 寫失敗的測試**

`test/unit/cull.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { CullIndex } from '../../src/world/cull'

/** 填入一組 (x, index) 並排序，回傳排序後的 x 序列。 */
function sortedXs(xs: readonly number[]): number[] {
  const c = new CullIndex()
  c.ensure(xs.length)
  c.clear()
  for (let i = 0; i < xs.length; i++) c.add(xs[i]!, 0, 0, 1, i, 0)
  c.sort()
  return Array.from({ length: c.count }, (_, i) => c.x[i]!)
}

describe('CullIndex 的排序不變量', () => {
  it('sort 之後 x 遞增', () => {
    expect(sortedXs([5, -3, 12, 0, 7])).toEqual([-3, 0, 5, 7, 12])
  })

  it('已排好的輸入不被打亂', () => {
    expect(sortedXs([-3, 0, 5, 7, 12])).toEqual([-3, 0, 5, 7, 12])
  })

  it('六個並排陣列一起搬，不會錯位', () => {
    const c = new CullIndex()
    c.ensure(3)
    c.clear()
    // x 故意逆序，讓每一筆都要移動
    c.add(9, 90, 900, 2, 7, 1)
    c.add(5, 50, 500, 3, 8, 0)
    c.add(1, 10, 100, 4, 9, 1)
    c.sort()
    expect(Array.from(c.x.slice(0, 3))).toEqual([1, 5, 9])
    expect(Array.from(c.y.slice(0, 3))).toEqual([10, 50, 90])
    expect(Array.from(c.z.slice(0, 3))).toEqual([100, 500, 900])
    expect(Array.from(c.r2.slice(0, 3))).toEqual([16, 9, 4])
    expect(Array.from(c.index.slice(0, 3))).toEqual([9, 8, 7])
    expect(Array.from(c.team.slice(0, 3))).toEqual([1, 0, 1])
  })
})

describe('CullIndex.rMax', () => {
  it('是所有已加入半徑的最大值', () => {
    const c = new CullIndex()
    c.ensure(3)
    c.clear()
    c.add(0, 0, 0, 4, 0, 0)
    c.add(1, 0, 0, 9, 1, 0)
    c.add(2, 0, 0, 6, 2, 0)
    expect(c.rMax).toBe(9)
  })

  it('clear 之後歸零', () => {
    const c = new CullIndex()
    c.ensure(1)
    c.clear()
    c.add(0, 0, 0, 4, 0, 0)
    c.clear()
    expect(c.rMax).toBe(0)
    expect(c.count).toBe(0)
  })
})

describe('CullIndex.lowerBound', () => {
  const build = (): CullIndex => {
    const c = new CullIndex()
    c.ensure(5)
    c.clear()
    for (const x of [-10, -2, 0, 3, 8]) c.add(x, 0, 0, 1, 0, 0)
    c.sort()
    return c
  }

  it('回傳第一個 x >= value 的槽位', () => {
    const c = build()
    expect(c.lowerBound(-10)).toBe(0)
    expect(c.lowerBound(-9)).toBe(1)
    expect(c.lowerBound(0)).toBe(2)
    expect(c.lowerBound(3.5)).toBe(4)
  })

  it('全部都小於 value 時回傳 count', () => {
    expect(build().lowerBound(100)).toBe(5)
  })

  it('空的索引回傳 0', () => {
    const c = new CullIndex()
    c.clear()
    expect(c.lowerBound(0)).toBe(0)
  })
})

describe('CullIndex.ensure', () => {
  it('容量不足才重新配置；夠用時沿用同一份記憶體', () => {
    const c = new CullIndex(8)
    const before = c.x
    c.ensure(8)
    expect(c.x).toBe(before)
    c.ensure(64)
    expect(c.x).not.toBe(before)
    expect(c.x.length).toBeGreaterThanOrEqual(64)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/cull.test.ts`
Expected: FAIL —— 找不到 `src/world/cull.ts`。

- [ ] **Step 3: 寫實作**

`src/world/cull.ts`：

```ts
/**
 * 命中判定的粗篩索引 —— 沿 X 軸排序的並排陣列（spec §5.2）。
 *
 * 【為什麼是排序掃描而不是網格】實測（spec §5.1）：40 架 × 滿載 4,000 發，
 * 全掃描的粗篩要 7,408 µs，排序掃描只要 202 µs。中間試過「把位置攤平成
 * Float32Array」，只省 7% —— 成本不在指標穿越，在那 160,000 次距離計算
 * 本身。要贏只能**不做那些計算**。
 *
 * 【為什麼不知道 World 的存在】等價測試（Task 2）要能單獨呼叫掃描並與
 * 暴力法比對。與 World 綁在一起就只能透過整個 step 間接觀察。
 */
export class CullIndex {
  /** 重心座標，**依 x 遞增排序**。只有前 count 格有效 */
  x: Float32Array
  y: Float32Array
  z: Float32Array
  /** 包圍球半徑的平方 */
  r2: Float32Array
  /** 對應的 `World.combatants` 索引 */
  index: Int32Array
  /** 陣營，0 或 1。同隊的彈丸直接穿過（spec §5.4） */
  team: Uint8Array

  count = 0
  /**
   * 本次填入的最大包圍球半徑，m。滑動視窗的半寬（spec §5.3）。
   *
   * 【每次重算，不是常數】換機種會變（P-51D 與 Bf 109 的包圍球不同）。
   * 寫死一個值會在換裝時算出太窄的視窗，靜靜地漏掉命中。
   */
  rMax = 0

  private cap = 0

  constructor(capacity = 8) {
    // 先讓欄位有值，滿足 strict 的明確賦值檢查；ensure 立刻換成足夠大的
    this.x = new Float32Array(0)
    this.y = new Float32Array(0)
    this.z = new Float32Array(0)
    this.r2 = new Float32Array(0)
    this.index = new Int32Array(0)
    this.team = new Uint8Array(0)
    this.ensure(capacity < 8 ? 8 : capacity)
  }

  /**
   * 確保容量至少 n。
   *
   * 【為什麼容量不是一個寫死的數字】飛機數在 `World.add` 時才知道，而
   * `add` 不是熱路徑。穩態下 `ensure` 一次都不會重新配置，所以「熱路徑
   * 零配置」仍然成立，同時也沒有一個「最多幾架」的魔術上限。
   */
  ensure(n: number): void {
    if (n <= this.cap) return
    this.x = new Float32Array(n)
    this.y = new Float32Array(n)
    this.z = new Float32Array(n)
    this.r2 = new Float32Array(n)
    this.index = new Int32Array(n)
    this.team = new Uint8Array(n)
    this.cap = n
  }

  clear(): void {
    this.count = 0
    this.rMax = 0
  }

  add(x: number, y: number, z: number, radius: number, index: number, team: number): void {
    const i = this.count++
    this.x[i] = x
    this.y[i] = y
    this.z[i] = z
    this.r2[i] = radius * radius
    this.index[i] = index
    this.team[i] = team
    if (radius > this.rMax) this.rMax = radius
  }

  /**
   * 依 x 遞增排序。
   *
   * 【為什麼是插入排序】飛機數是數十的量級，而且幀間的排列幾乎已經排好
   * （240 Hz 下一步只移動幾公尺），實際比較次數接近 O(N)。不配置、不遞迴，
   * 也不需要一個間接的順序陣列 —— 六個並排陣列一起搬。
   */
  sort(): void {
    const { x, y, z, r2, index, team, count } = this
    for (let i = 1; i < count; i++) {
      const kx = x[i]!, ky = y[i]!, kz = z[i]!
      const kr = r2[i]!, ki = index[i]!, kt = team[i]!
      let j = i - 1
      while (j >= 0 && x[j]! > kx) {
        x[j + 1] = x[j]!
        y[j + 1] = y[j]!
        z[j + 1] = z[j]!
        r2[j + 1] = r2[j]!
        index[j + 1] = index[j]!
        team[j + 1] = team[j]!
        j--
      }
      x[j + 1] = kx
      y[j + 1] = ky
      z[j + 1] = kz
      r2[j + 1] = kr
      index[j + 1] = ki
      team[j + 1] = kt
    }
  }

  /** 第一個 `x >= value` 的槽位；全部都小於時回傳 `count`。 */
  lowerBound(value: number): number {
    const x = this.x
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (x[mid]! < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/cull.test.ts`
Expected: PASS，11 條。

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無錯誤。

- [ ] **Step 6: 提交**

```bash
git add src/world/cull.ts test/unit/cull.test.ts
git commit -m "feat(world): 粗篩索引 CullIndex——沿 X 軸排序的並排陣列"
```

---

## Task 2: 存活旗標與退場

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/unit/world.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `Combatant.alive: boolean`（`add` 時為 `true`）
  - `World.destroy(c: Combatant): void` —— 退場：`hp = 0`，`respawnOnDestroy` 為真則重生，否則 `alive = false`
  - `World.respawn` 額外把 `alive` 設回 `true`

- [ ] **Step 1: 先讀既有測試**

Run: `npx vitest run test/unit/world.test.ts`
把 `test/unit/world.test.ts` 整份讀過，特別是第 205–230 行關於 `respawnOnDestroy` 的兩條。本任務會讓「HP 0 的飛機不再推進物理」，若有既有測試依賴「HP 0 之後位置仍會變」，那條測試要改成明確斷言新行為，**不是刪掉**。

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/world.test.ts` 末尾追加：

```ts
describe('退場', () => {
  it('add 出來的 Combatant 是活的', () => {
    const w = new World()
    const c = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    expect(c.alive).toBe(true)
  })

  it('HP 歸零且不重生 → alive 轉為 false', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    expect(t.alive).toBe(false)
  })

  it('HP 歸零但會重生 → 仍然是活的', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = true
    w.applyDamage(t, 99999, 'cockpit')
    expect(t.alive).toBe(true)
    expect(t.hp).toBe(P51D.hp)
  })

  it('退場之後不再推進物理', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'red', new Vector3(0, 4000, 0))
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    const before = t.aircraft.state.position.clone()
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(t.aircraft.state.position.distanceTo(before)).toBe(0)
  })

  it('退場之後打不中', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    // 已經是 0 血；再打一次不應該讓 hitsDealt 增加
    const s = w.add(new Aircraft(BF109G6), new Fixed(), 'blue', new Vector3(0, 0, 100))
    w.applyDamage(t, 10, 'fuselage', s)
    expect(s.hitsDealt).toBe(0)
  })

  it('重生把 alive 設回 true', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    w.respawn(t)
    expect(t.alive).toBe(true)
    expect(t.hp).toBe(P51D.hp)
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run test/unit/world.test.ts`
Expected: FAIL —— `alive` 不存在。

- [ ] **Step 4: 寫實作**

在 `src/world/World.ts` 的 `Combatant` 介面加欄位（放在 `team` 之後）：

```ts
  /**
   * 還在戰場上。false = 已退場（被打爆或撞地）。
   *
   * 【為什麼是旗標而不是從 combatants 移除】`index` 是彈丸記錄射手用的。
   * `splice` 之後所有在飛的彈丸都會認錯主人 —— 包括「打不到自己」那條
   * 規則，於是死人的遺彈會開始打活人，而且症狀離成因很遠。
   */
  alive: boolean
```

`add` 的物件字面值加 `alive: true`。

`step` 的三個迴圈各加一道跳過（`hitsDealt` 仍然對全部歸零，讓 HUD 那一層不必分辨死活）：

```ts
    for (const c of this.combatants) {
      c.hitsDealt = 0
      if (!c.alive) continue
      c.controller.update(c.aircraft, dt, c.command)
    }

    for (const c of this.combatants) {
      if (!c.alive) continue
      c.aircraft.update(c.command.aimWorld, c.command.throttle, dt, c.command.brake)
    }
    for (const c of this.combatants) {
      if (!c.alive) continue
      this.fire(c, dt)
    }
```

`resolveHits` 裡的 `if (c.hp <= 0) continue` 改成 `if (!c.alive) continue`。

`applyDamage` 改成：

```ts
  applyDamage(victim: Combatant, damage: number, part: HitPart, shooter?: Combatant): void {
    // 退場的飛機打不中——這一條也讓「死人身上還在扣血」不可能發生
    if (!victim.alive) return

    victim.hp -= damage * PART_MULTIPLIER[part]
    if (shooter) shooter.hitsDealt++
    if (victim.hp > 0) return

    this.destroy(victim)
  }

  /**
   * 退場。被打爆與撞地走同一條路徑（spec §7）。
   *
   * 【為什麼抽出來】兩個觸發、一套後果。分成兩份長得很像的副本，就是
   * 只有一份會被修好的那種危險 —— 與 `isCrashed` 當初抽出來同一個理由。
   */
  destroy(c: Combatant): void {
    c.hp = 0
    if (c.respawnOnDestroy) {
      this.respawn(c)
      return
    }
    c.alive = false
  }
```

`respawn` 末尾加 `c.alive = true`。

- [ ] **Step 5: 跑整套測試**

Run: `npx vitest run`
Expected: 全綠。若 `world.test.ts` 有既有測試因「HP 0 不再推進物理」而紅，改成明確斷言新行為並在測試名稱裡說清楚。

- [ ] **Step 6: 型別檢查並提交**

```bash
npm run build
git add src/world/World.ts test/unit/world.test.ts
git commit -m "feat(world): 存活旗標與退場——標記而不是從 combatants 移除"
```

---

## Task 3: `resolveHits` 接上排序掃描，並證明無迴歸

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/unit/cull-equivalence.test.ts`（新增）

**Interfaces:**
- Consumes: `CullIndex`（Task 1）、`Combatant.alive`（Task 2）
- Produces: `World.resolveHits(): void` 由 `private` 改為公開（與既有的 `applyDamage` 同一個理由：測試可以直接呼叫）

- [ ] **Step 1: 寫失敗的等價測試**

`test/unit/cull-equivalence.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World, type Combatant } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import {
  createHitResult, hitAircraft, segmentPointDistanceSq, PART_MULTIPLIER, type HitPart,
} from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

/** 什麼都不做的控制器。等價測試只關心命中判定。 */
class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
  }
}

/**
 * 決定性的偽亂數（mulberry32）。
 *
 * 【為什麼不用 Math.random】等價測試失敗時必須能重現。種子寫在測試裡，
 * 紅燈就能原樣再跑一次。
 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 暴力法的參考實作：對每一發彈丸掃過**全部**存活的敵機，取最近的。
 *
 * 這一份刻意寫成最笨的形式，與 World 裡的排序掃描沒有共用任何一行 —— 兩份
 * 各自算出答案才叫等價驗證。用的是同一組低階原語（hitAircraft、
 * segmentPointDistanceSq），因為要驗的是**候選集合**，不是命中盒數學。
 */
function referenceDamage(w: World): Map<number, number> {
  const hit = createHitResult()
  const s0 = new Vector3()
  const s1 = new Vector3()
  const out = new Map<number, number>()
  const p = w.projectiles

  for (let i = 0; i < p.capacity; i++) {
    const owner = p.owner[i]!
    if (owner === -1) continue
    const ax = p.sx[i]!, ay = p.sy[i]!, az = p.sz[i]!
    const bx = p.x[i]!, by = p.y[i]!, bz = p.z[i]!
    const shooter = w.combatants[owner]

    let bestT = Infinity
    let victim: Combatant | null = null
    let part: HitPart = 'fuselage'
    for (const c of w.combatants) {
      if (!c.alive) continue
      if (c.index === owner) continue
      if (shooter !== undefined && c.team === shooter.team) continue
      const pos = c.aircraft.state.position
      if (segmentPointDistanceSq(ax, ay, az, bx, by, bz, pos.x, pos.y, pos.z)
        > c.hitRadius * c.hitRadius) continue
      s0.set(ax, ay, az)
      s1.set(bx, by, bz)
      if (!hitAircraft(
        c.aircraft.spec.hitBoxes, pos, c.aircraft.state.orientation, s0, s1, hit,
      )) continue
      if (hit.t >= bestT) continue
      bestT = hit.t
      victim = c
      part = hit.part
    }
    if (!victim) continue
    out.set(victim.index, (out.get(victim.index) ?? 0) + PART_MULTIPLIER[part] * p.damage[i]!)
  }
  return out
}

/** 隨機擺 n 架飛機、隨機發射 shots 發彈丸，回傳世界。 */
function scenario(seed: number, n: number, shots: number): World {
  const r = rng(seed)
  const w = new World()
  for (let i = 0; i < n; i++) {
    const spec = i % 2 === 0 ? P51D : BF109G6
    const ac = new Aircraft(spec, 4000, 200)
    ac.state.position.set((r() - 0.5) * 600, 4000 + (r() - 0.5) * 300, (r() - 0.5) * 600)
    // 【隨機姿態用四個分量正規化，不要用 Euler 角】Euler 角在極點附近分布
    // 不均，某些姿態幾乎抽不到——而命中盒是長條形的，姿態分布不均等於
    // 有一整類幾何從來沒被這條等價測試走過
    ac.state.orientation.set(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize()
    ac.prevPosition.copy(ac.state.position)
    const c = w.add(ac, new Idle(), i % 2 === 0 ? 'blue' : 'red', ac.state.position.clone())
    c.respawnOnDestroy = false
  }

  // 彈丸：起點在某架附近、終點往隨機方向走一步的距離（240 Hz 下 .50 走 3.7 m）
  for (let k = 0; k < shots; k++) {
    const shooter = Math.floor(r() * n)
    const o = w.combatants[shooter]!.aircraft.state.position
    const px = o.x + (r() - 0.5) * 200
    const py = o.y + (r() - 0.5) * 200
    const pz = o.z + (r() - 0.5) * 200
    const dx = (r() - 0.5) * 8, dy = (r() - 0.5) * 8, dz = (r() - 0.5) * 8
    const idx = w.projectiles.spawn(px, py, pz, 0, 0, 0, 6, shooter)
    w.projectiles.sx[idx] = px
    w.projectiles.sy[idx] = py
    w.projectiles.sz[idx] = pz
    w.projectiles.x[idx] = px + dx
    w.projectiles.y[idx] = py + dy
    w.projectiles.z[idx] = pz + dz
  }
  return w
}

describe('排序掃描與暴力全掃描等價', () => {
  it('40 架 × 2,000 發 × 8 組種子，逐架傷害完全相同', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const expected = referenceDamage(scenario(seed, 40, 2000))

      const w = scenario(seed, 40, 2000)
      const before = w.combatants.map((c) => c.hp)
      w.resolveHits()
      const actual = new Map<number, number>()
      for (const c of w.combatants) {
        const d = before[c.index]! - c.hp
        if (d !== 0) actual.set(c.index, d)
      }

      expect(actual.size, `種子 ${seed} 的受害者架數`).toBe(expected.size)
      for (const [index, damage] of expected) {
        expect(actual.get(index), `種子 ${seed} 的第 ${index} 架`).toBeCloseTo(damage, 6)
      }
    }
  })

  it('至少要真的打中一些人，否則這條測試是空的', () => {
    const w = scenario(1, 40, 2000)
    const before = w.combatants.map((c) => c.hp)
    w.resolveHits()
    const hurt = w.combatants.filter((c) => c.hp < before[c.index]!).length
    expect(hurt).toBeGreaterThan(3)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/cull-equivalence.test.ts`
Expected: FAIL —— `resolveHits` 是 private，而且同隊穿透還沒實作（參考實作已經跳過同隊，World 還沒有），兩者都會讓數字對不上。

- [ ] **Step 3: 寫實作**

`src/world/World.ts` 頂部 import：

```ts
import { CullIndex } from './cull'
```

欄位：

```ts
  /** 命中判定的粗篩索引。每個物理步重填一次（spec §5.2） */
  private readonly cull = new CullIndex()
```

`add` 的末尾（`push` 之後）加一行 `this.cull.ensure(this.combatants.length)`。

新增私有方法：

```ts
  /**
   * 重填粗篩索引：只收存活的飛機，依 x 排序。
   *
   * 【為什麼在 resolveHits 裡而不是 step 開頭】判定吃的是**推進後**的位置。
   * 在飛機推進之前填，粗篩用的是上一步的殘影，視窗會偏掉一整步的位移。
   */
  private buildCull(): void {
    const cull = this.cull
    cull.clear()
    const combatants = this.combatants
    for (let i = 0; i < combatants.length; i++) {
      const c = combatants[i]!
      if (!c.alive) continue
      const p = c.aircraft.state.position
      cull.add(p.x, p.y, p.z, c.hitRadius, c.index, c.team === 'blue' ? 0 : 1)
    }
    cull.sort()
  }
```

`resolveHits` 整個換掉（`private` 拿掉）：

```ts
  /**
   * 線段 vs 各機的命中盒，取最近的那一架。
   *
   * 【公開是為了等價測試】與 `applyDamage` 同一個理由。Task 3 的
   * `cull-equivalence.test.ts` 要能在完全掌控的狀態下呼叫它，再與暴力法比對。
   *
   * 【這是整個專案最熱的迴圈】滿載 4,000 發 × 40 架。粗篩換成排序掃描之前
   * 是 7,408 µs，換之後 202 µs（spec §5.1）。所以這裡刻意寫得比別處囉嗦：
   *
   *   - **索引迴圈而不是 for...of**。後者每次配置一個迭代器物件。
   *   - **視窗用 x 區間夾**。窗外的飛機在代數上不可能被命中（spec §5.3），
   *     所以窗內取到的最小 t 就是全場的最小 t。
   *   - **座標從 CullIndex 的並排陣列讀**，不穿 Combatant → Aircraft → state。
   */
  resolveHits(): void {
    this.buildCull()

    const p = this.projectiles
    const combatants = this.combatants
    const cull = this.cull
    const rMax = cull.rMax
    const s0 = S.v[0]!
    const s1 = S.v[1]!

    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner === -1) continue
      const ax = p.sx[i]!, ay = p.sy[i]!, az = p.sz[i]!
      const bx = p.x[i]!, by = p.y[i]!, bz = p.z[i]!

      // 射手的陣營。同隊的彈丸直接穿過（spec §5.4）；射手不在名單上時
      // 取 −1，於是不會與任何 0/1 相等，等於不做同隊過濾。
      const shooter = owner >= 0 && owner < combatants.length ? combatants[owner] : undefined
      const ownerTeam = shooter === undefined ? -1 : (shooter.team === 'blue' ? 0 : 1)

      const lo = (ax < bx ? ax : bx) - rMax
      const hi = (ax > bx ? ax : bx) + rMax

      let bestT = Infinity
      let victim: Combatant | null = null
      let part: HitPart = 'fuselage'
      const count = cull.count
      for (let j = cull.lowerBound(lo); j < count; j++) {
        const cx = cull.x[j]!
        if (cx > hi) break
        if (cull.team[j]! === ownerTeam) continue
        // 【同隊過濾已經涵蓋自傷，但這一條要留】spec §5.4：「同隊零傷害」
        // 必須是一條自己成立的規則，而不是碰巧被另一條擋掉。
        if (cull.index[j]! === owner) continue
        const cy = cull.y[j]!, cz = cull.z[j]!
        if (segmentPointDistanceSq(ax, ay, az, bx, by, bz, cx, cy, cz) > cull.r2[j]!) continue

        const c = combatants[cull.index[j]!]!
        s0.set(ax, ay, az)
        s1.set(bx, by, bz)
        if (!hitAircraft(
          c.aircraft.spec.hitBoxes, c.aircraft.state.position, c.aircraft.state.orientation,
          s0, s1, this.hit,
        )) continue
        if (this.hit.t >= bestT) continue
        bestT = this.hit.t
        victim = c
        part = this.hit.part
      }
      if (!victim) continue

      this.applyDamage(victim, p.damage[i]!, part, shooter)
      p.kill(i)
    }
  }
```

- [ ] **Step 4: 跑等價測試**

Run: `npx vitest run test/unit/cull-equivalence.test.ts`
Expected: PASS，2 條。

- [ ] **Step 5: 跑整套測試**

Run: `npx vitest run`
Expected: 全綠。`test/integration/hit-matrix.test.ts` 與 `test/unit/world.test.ts` 是這一塊的既有覆蓋，它們必須原樣通過 —— 若有紅燈，是排序掃描寫錯了，**不要改測試**。

- [ ] **Step 6: 型別檢查並提交**

```bash
npm run build
git add src/world/World.ts test/unit/cull-equivalence.test.ts
git commit -m "perf(world): 命中判定改用排序掃描粗篩；同隊彈丸穿透"
```

---

## Task 4: 同隊零傷害的獨立驗收

**Files:**
- Test: `test/unit/world.test.ts`

**Interfaces:**
- Consumes: Task 3 的同隊過濾
- Produces: 無新程式碼

理由：Task 3 的等價測試比對的是「兩份實作算出同一個答案」，兩份都跳過同隊 —— 若同隊規則本身寫反，兩邊會**一起錯**而測試照樣綠。這一條從外部獨立驗收 spec §3.1 條件 8。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/world.test.ts` 追加：

```ts
describe('同隊彈丸穿透（spec §3.1 條件 8）', () => {
  /** 把射手擺在目標正後方 60 m，機首朝 −Z，連射一秒。 */
  function shootAt(shooterTeam: 'blue' | 'red', targetTeam: 'blue' | 'red'): number {
    const w = new World()
    const shooter = w.add(
      new Aircraft(P51D), new Fixed(new Vector3(0, 0, -1), 0, true),
      shooterTeam, new Vector3(0, 0, 0),
    )
    const target = w.add(
      new Aircraft(BF109G6), new Fixed(), targetTeam, new Vector3(0, 0, -60),
    )
    target.respawnOnDestroy = false
    pin(shooter.aircraft, 0, 0, 0)
    pin(target.aircraft, 0, 0, -60)
    const before = target.hp
    for (let i = 0; i < 240; i++) {
      pin(shooter.aircraft, 0, 0, 0)
      pin(target.aircraft, 0, 0, -60)
      w.step(DT)
    }
    return before - target.hp
  }

  it('敵隊會被打中——先確認這個測試佈置真的打得到', () => {
    expect(shootAt('blue', 'red')).toBeGreaterThan(0)
  })

  it('同隊的傷害恆為 0', () => {
    expect(shootAt('blue', 'blue')).toBe(0)
  })

  it('紅隊對紅隊同樣為 0', () => {
    expect(shootAt('red', 'red')).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試**

Run: `npx vitest run test/unit/world.test.ts -t "同隊"`
Expected: PASS（Task 3 已經實作）。**若「敵隊會被打中」那條是紅的，代表測試佈置本身沒打到人，後兩條就是空的** —— 先把佈置修對再說。

- [ ] **Step 3: 提交**

```bash
git add test/unit/world.test.ts
git commit -m "test(world): 同隊零傷害的獨立驗收（不與等價測試共用實作）"
```

---

## Task 5: 可注入的撞地判定

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/unit/world.test.ts`

**Interfaces:**
- Consumes: `World.destroy`（Task 2）
- Produces:
  - `export type CrashPolicy = (c: Combatant) => boolean`
  - `World.crashPolicy: CrashPolicy`（預設：重心 `y <= 0`）

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/world.test.ts` 追加：

```ts
describe('撞地退場（spec §7）', () => {
  it('預設政策：重心低於海平面就退場', () => {
    const w = new World()
    const c = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3())
    c.respawnOnDestroy = false
    c.aircraft.state.position.set(0, -1, 0)
    w.step(DT)
    expect(c.alive).toBe(false)
    expect(c.hp).toBe(0)
  })

  it('撞地也適用於 AI 駕駛的飛機，不只玩家', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109G6, 4000, 200), new Fixed(), 'red', new Vector3())
    a.respawnOnDestroy = false
    b.respawnOnDestroy = false
    a.aircraft.state.position.set(0, -1, 0)
    b.aircraft.state.position.set(0, -1, 0)
    w.step(DT)
    expect(a.alive).toBe(false)
    expect(b.alive).toBe(false)
  })

  it('注入的政策取代預設值', () => {
    const w = new World()
    const c = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3())
    c.respawnOnDestroy = false
    // 3,000 m 以下就算撞地——用一個絕不會與預設值混淆的門檻
    w.crashPolicy = (x) => x.aircraft.state.position.y <= 3000
    c.aircraft.state.position.set(0, 2999, 0)
    w.step(DT)
    expect(c.alive).toBe(false)
  })

  it('respawnOnDestroy 為真時撞地會重生而不是退場', () => {
    const w = new World()
    const c = w.add(
      new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3(0, 4000, 0), 4000, 200,
    )
    c.respawnOnDestroy = true
    c.aircraft.state.position.set(0, -1, 0)
    w.step(DT)
    expect(c.alive).toBe(true)
    expect(c.aircraft.state.position.y).toBeCloseTo(4000, 3)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/world.test.ts -t "撞地"`
Expected: FAIL —— `crashPolicy` 不存在。

- [ ] **Step 3: 寫實作**

`src/world/World.ts`：

```ts
/**
 * 撞地判定。回傳 true 代表這一架已經碰到地面／海面。
 *
 * 【為什麼是注入的而不是寫死】玩家看到的海面是 Gerstner 波，判定必須
 * 走與著色器同一份波參數（見 aircraft/crash.ts）；而 headless 測試沒有
 * 海面著色器，也不該為此拖進渲染層。一個呼叫點、一條可替換的政策，
 * 就不會變成兩份長得很像、只有一份會被修好的判定。
 */
export type CrashPolicy = (c: Combatant) => boolean

/** 預設政策：平海面。headless 測試與對戰矩陣用這一個。 */
const SEA_LEVEL: CrashPolicy = (c) => c.aircraft.state.position.y <= 0
```

`World` 加公開欄位：

```ts
  /** 撞地判定。`main.ts` 注入與海面著色器共用波參數的版本 */
  crashPolicy: CrashPolicy = SEA_LEVEL
```

`step` 在飛機推進之後、開火之前插入：

```ts
    // 【撞地要在開火之前判】撞地的那一步不該還打得出子彈。
    for (const c of this.combatants) {
      if (!c.alive) continue
      if (this.crashPolicy(c)) this.destroy(c)
    }
```

- [ ] **Step 4: 跑整套測試**

Run: `npx vitest run`
Expected: 全綠。特別注意 `test/integration/ai-safety-matrix.test.ts` 與 `ai-duel-matrix.test.ts` —— 它們在 4,000 m 打，不該碰到海平面；若有案例變紅，代表那個案例本來就掉到海裡了，**那是一個要報告的發現，不是要改的測試**。

- [ ] **Step 5: 型別檢查並提交**

```bash
npm run build
git add src/world/World.ts test/unit/world.test.ts
git commit -m "feat(world): 撞地退場擴及所有飛機，判定改為可注入的政策"
```

---

## Task 6: 目標評分 `targetScore`

**Files:**
- Create: `src/ai/target.ts`
- Test: `test/unit/ai-target.test.ts`

**Interfaces:**
- Consumes: `Aircraft`、`makeScratch`
- Produces:
  - `interface TargetConfig { opportunityWeight: number; threatWeight: number; rangeScale: number; crowdPenalty: number; switchMargin: number; minDwell: number }`
  - `const DEFAULT_TARGET: TargetConfig`
  - `function targetScore(self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig): number`

- [ ] **Step 1: 寫失敗的測試**

`test/unit/ai-target.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { targetScore, DEFAULT_TARGET } from '../../src/ai/target'
import { P51D } from '../../src/specs/p51d'

const UP = new Vector3(0, 1, 0)

/** 把飛機擺在 (x, y, z)，機首繞 Y 軸轉 yaw 弧度（0 = 朝 −Z）。 */
function place(x: number, y: number, z: number, yaw: number): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  a.state.position.set(x, y, z)
  a.state.orientation.copy(new Quaternion().setFromAxisAngle(UP, yaw))
  return a
}

describe('targetScore 的機會項', () => {
  it('我在他正後方時最高（他背對我）', () => {
    // 我在 z = 0，他在 z = −300 且機首朝 −Z（背對我）
    const me = place(0, 4000, 0, 0)
    const tail = place(0, 4000, -300, 0)
    // 同距離、他機首朝 +Z（正對我）
    const nose = place(0, 4000, -300, Math.PI)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 }
    expect(targetScore(me, tail, 0, cfg)).toBeGreaterThan(targetScore(me, nose, 0, cfg))
  })

  it('側面時歸零（不是負的）', () => {
    const me = place(0, 4000, 0, 0)
    const beam = place(0, 4000, -300, Math.PI / 2)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 }
    expect(targetScore(me, beam, 0, cfg)).toBeCloseTo(0, 9)
  })
})

describe('targetScore 的威脅項', () => {
  it('他機首正對我時最高', () => {
    const me = place(0, 4000, 0, 0)
    const nose = place(0, 4000, -300, Math.PI)
    const tail = place(0, 4000, -300, 0)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    expect(targetScore(me, nose, 0, cfg)).toBeGreaterThan(targetScore(me, tail, 0, cfg))
  })

  it('機會與威脅是兩個獨立的權重，不會退化成一個', () => {
    // 若用 0.5(1±b)，兩者相加恆為 1，score 只剩 (ow−tw) 一個自由度。
    // 取正部之後：純尾追時威脅權重完全不影響分數。
    const me = place(0, 4000, 0, 0)
    const tail = place(0, 4000, -300, 0)
    const a = targetScore(me, tail, 0, { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 })
    const b = targetScore(me, tail, 0, { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 5 })
    expect(b).toBeCloseTo(a, 9)
  })
})

describe('targetScore 的折扣項', () => {
  it('距離越遠分數越低', () => {
    const me = place(0, 4000, 0, 0)
    const near = place(0, 4000, -200, 0)
    const far = place(0, 4000, -2000, 0)
    expect(targetScore(me, near, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, far, 0, DEFAULT_TARGET))
  })

  it('rangeScale 處恰好打對折', () => {
    const cfg = { ...DEFAULT_TARGET, rangeScale: 500, crowdPenalty: 0 }
    const me = place(0, 4000, 0, 0)
    const at0 = place(0, 4000, -1e-6, 0)
    const at500 = place(0, 4000, -500, 0)
    expect(targetScore(me, at500, 0, cfg) / targetScore(me, at0, 0, cfg)).toBeCloseTo(0.5, 4)
  })

  it('鎖定的人越多分數越低', () => {
    const me = place(0, 4000, 0, 0)
    const t = place(0, 4000, -300, 0)
    const s0 = targetScore(me, t, 0, DEFAULT_TARGET)
    const s1 = targetScore(me, t, 1, DEFAULT_TARGET)
    const s3 = targetScore(me, t, 3, DEFAULT_TARGET)
    expect(s1).toBeLessThan(s0)
    expect(s3).toBeLessThan(s1)
  })

  it('分數恆非負——乘法遲滯的前提', () => {
    const me = place(0, 4000, 0, 0)
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      for (const locks of [0, 1, 5, 40]) {
        const t = place(300, 4000, -300, yaw)
        expect(targetScore(me, t, locks, DEFAULT_TARGET)).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('targetScore 的退化處理', () => {
  it('兩機重疊時不產生 NaN', () => {
    const me = place(0, 4000, 0, 0)
    const same = place(0, 4000, 0, 0)
    expect(Number.isFinite(targetScore(me, same, 0, DEFAULT_TARGET))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: FAIL —— 找不到 `src/ai/target.ts`。

- [ ] **Step 3: 寫實作**

`src/ai/target.ts`（本任務只寫到 `targetScore` 為止）：

```ts
import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import type { Aircraft } from '../aircraft/Aircraft'

export interface TargetConfig {
  /** 「我在他尾後」的權重 */
  opportunityWeight: number
  /** 「他機首指著我」的權重 */
  threatWeight: number
  /** 距離折扣的特徵長度，m。分數在此距離減半 */
  rangeScale: number
  /** 分攤折扣係數。1/crowdPenalty 是「分數折半所需的隊友鎖定數」 */
  crowdPenalty: number
  /** 新目標要好過現任的比例才換 */
  switchMargin: number
  /** 換過之後不再換的秒數 */
  minDwell: number
}

/**
 * **全部都是起始值，待 Task 16 由 20v20 的實測回填**（spec §13）。
 *
 * 與 M2 的命中盒座標、M4 的規則門檻同一個做法：先跑再定，不接受
 * 「配一個看起來合理的數字」。
 *
 * `rangeScale` 的起始值 400 m 有依據：M2 的匯聚點在 300 m，1944 年的
 * 實戰有效射程也在 400 m 以內 —— 「打得到的距離」就是這個量級。
 */
export const DEFAULT_TARGET: TargetConfig = {
  opportunityWeight: 1,
  threatWeight: 1,
  rangeScale: 400,
  crowdPenalty: 1,
  switchMargin: 0.25,
  minDwell: 2,
}

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(3)
/** 視線退化的距離下限，m。與 assess.ts 用同一個量級 */
const MIN_RANGE = 1e-3

/**
 * 一個候選目標的分數。**恆非負**（spec §6.2）。
 *
 * 令 `b = 敵機首 · 由我指向他的單位向量`：
 *
 *   機會 = max(0, b)    —— 1 = 我正咬著他
 *   威脅 = max(0, −b)   —— 1 = 他機首正對著我
 *
 * 【為什麼取正部而不是 0.5(1 ± b)】後者相加恆等於 1，代進評分只剩
 * `0.5(ow+tw) + 0.5(ow−tw)·b` —— 兩個權重退化成一個自由度，而且是 b 的
 * 線性函數。但要的是「我咬住他」與「他咬住我」**兩端都加分**、側面不加分，
 * 那是 V 形不是直線。
 *
 * 【為什麼三個因子全是折扣形式】分攤原本設計成減法，分數會變負；而換目標
 * 門檻是乘法的（`> 現任 × (1 + margin)`），現任為負時乘 1.25 會**更負**，
 * 門檻反而變低 —— 遲滯在最需要它的時候失效。統一成 `1/(1 + k·x)` 之後
 * score 恆 ≥ 0，乘法門檻在整個定義域上單調。
 *
 * 熱路徑：不配置。不修改 self 與 enemy。
 */
export function targetScore(
  self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig,
): number {
  const los = S.v[0]!.copy(enemy.state.position).sub(self.state.position)
  const range = los.length()

  // 【重疊時的退化處理】重生的瞬間可能發生。方向取機首，避免 normalize
  // 除以 0 產生 NaN —— NaN 一旦進入分數，所有比較都變成 false，選擇會靜靜
  // 退化成「永遠選第一架」而且完全不報錯（與 assess.ts 同一個防護）。
  const losUnit = S.v[1]!
  if (range > MIN_RANGE) losUnit.copy(los).divideScalar(range)
  else losUnit.copy(FWD).applyQuaternion(self.state.orientation)

  const enemyFwd = S.v[2]!.copy(FWD).applyQuaternion(enemy.state.orientation)
  let b = enemyFwd.dot(losUnit)
  // 浮點誤差會讓點積跑出 [−1, 1]
  if (b < -1) b = -1
  else if (b > 1) b = 1

  const opportunity = b > 0 ? b : 0
  const threat = b < 0 ? -b : 0

  const geometry = cfg.opportunityWeight * opportunity + cfg.threatWeight * threat
  const rangeDiscount = 1 / (1 + range / cfg.rangeScale)
  const crowdDiscount = 1 / (1 + cfg.crowdPenalty * locks)
  return geometry * rangeDiscount * crowdDiscount
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: PASS，9 條。

- [ ] **Step 5: 型別檢查並提交**

```bash
npm run build
git add src/ai/target.ts test/unit/ai-target.test.ts
git commit -m "feat(ai): 目標評分——機會與威脅取正部，三個因子統一為折扣"
```

---

## Task 7: 指派板與分攤統計

**Files:**
- Modify: `src/ai/target.ts`
- Test: `test/unit/ai-target.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `target.ts`
- Produces:
  - `interface TargetCandidate { readonly index: number; readonly aircraft: Aircraft; readonly team: Team; alive: boolean }`
  - `interface TargetBoard { readonly candidates: readonly TargetCandidate[]; readonly assignments: Int32Array }`
  - `function createTargetBoard(candidates: readonly TargetCandidate[]): TargetBoard`
  - `function countLocks(board: TargetBoard, team: Team, selfIndex: number, candidateIndex: number): number`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-target.test.ts` 追加：

```ts
import {
  countLocks, createTargetBoard, type TargetCandidate,
} from '../../src/ai/target'
import type { Team } from '../../src/world/World'

/** 造一組候選：teams 決定陣營，索引即為陣列位置。 */
function candidates(teams: readonly Team[]): TargetCandidate[] {
  return teams.map((team, index) => ({
    index, team, alive: true, aircraft: place(index * 50, 4000, 0, 0),
  }))
}

describe('createTargetBoard', () => {
  it('assignments 長度等於候選數，初值全為 −1', () => {
    const b = createTargetBoard(candidates(['blue', 'blue', 'red']))
    expect(b.assignments).toHaveLength(3)
    expect(Array.from(b.assignments)).toEqual([-1, -1, -1])
  })

  it('index 與陣列位置不符時直接拋錯', () => {
    const cs = candidates(['blue', 'red'])
    const broken = [cs[0]!, { ...cs[1]!, index: 7 }]
    expect(() => createTargetBoard(broken)).toThrow()
  })
})

describe('countLocks', () => {
  it('只數同隊的', () => {
    // 0、1 藍，2、3 紅。全部都鎖定候選 2
    const cs = candidates(['blue', 'blue', 'red', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([2, 2, 2, 2])
    // 站在 0（藍）的角度：同隊的只有 1
    expect(countLocks(b, 'blue', 0, 2)).toBe(1)
  })

  it('不數自己', () => {
    const cs = candidates(['blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([2, -1, -1])
    expect(countLocks(b, 'blue', 0, 2)).toBe(0)
  })

  it('不數已退場的', () => {
    const cs = candidates(['blue', 'blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([3, 3, 3, -1])
    cs[1]!.alive = false
    expect(countLocks(b, 'blue', 0, 3)).toBe(1)
  })

  it('沒有人鎖定時回傳 0', () => {
    const cs = candidates(['blue', 'red'])
    const b = createTargetBoard(cs)
    expect(countLocks(b, 'blue', 0, 1)).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/ai-target.test.ts -t "countLocks"`
Expected: FAIL —— 這些匯出不存在。

- [ ] **Step 3: 寫實作**

在 `src/ai/target.ts` 追加（`import type { Team } from '../world/World'` 加到檔頭）：

```ts
/**
 * 一個候選目標。
 *
 * 【為什麼另外定義而不是直接用 Combatant】`World.Combatant` 在結構上滿足
 * 這個介面，但 `target.ts` 不需要知道世界是怎麼組裝的（射速時鐘、包圍球
 * 半徑、出生點都與選目標無關）。`Team` 以 `import type` 取得 —— 型別匯入
 * 會被完全抹除，不產生執行期相依。
 */
export interface TargetCandidate {
  /** **必須等於它在 candidates 陣列裡的位置**。`createTargetBoard` 會檢查 */
  readonly index: number
  readonly aircraft: Aircraft
  readonly team: Team
  alive: boolean
}

/** 全場共享的目標指派板（spec §6.3）。 */
export interface TargetBoard {
  readonly candidates: readonly TargetCandidate[]
  /** `assignments[i]` = 第 i 架正在鎖定的候選索引；−1 = 無 */
  readonly assignments: Int32Array
}

/**
 * 建立指派板。
 *
 * 【為什麼要檢查 index 與位置一致】`assignments` 用陣列位置索引、
 * `state.current` 存的也是位置，而 `Combatant.index` 是 `World.add` 給的
 * 遞增序號。兩者恆等（`add` 就是用 `combatants.length` 當 index），但
 * 「恆等」若沒有被檢查，某天有人插入一架就會變成無聲的錯位 —— 所有 AI
 * 都會鎖到隔壁那一架。設定期檢查一次，成本為零。
 */
export function createTargetBoard(candidates: readonly TargetCandidate[]): TargetBoard {
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.index !== i) {
      throw new Error(`TargetCandidate.index 必須等於陣列位置：第 ${i} 個是 ${candidates[i]!.index}`)
    }
  }
  return { candidates, assignments: new Int32Array(candidates.length).fill(-1) }
}

/**
 * 有幾架**同隊且存活**的飛機正鎖定 `candidateIndex`，不含 `selfIndex` 自己。
 *
 * 【為什麼每次重掃而不是維護一個增減計數器】計數器要求每一次「放棄目標」
 * 都配一次遞減 —— 陣亡、撞地、重置、換目標各是一條路徑，漏掉任何一條就
 * 留下一個永遠不會消失的幽靈鎖定，而症狀（大家都不打那一架）離成因很遠。
 * 重掃是 O(N)，40 架 × 10 Hz = 每秒 16,000 次整數比較，而且**自我修復**：
 * 任何錯誤的指派都會在下一拍被沖掉。
 *
 * 【為什麼要限定同隊】`assignments` 是全場共用一份。不限定的話，紅隊鎖定
 * 某架紅機（不可能發生，但這是一條資料而不是一條保證）會污染藍隊的統計。
 */
export function countLocks(
  board: TargetBoard, team: Team, selfIndex: number, candidateIndex: number,
): number {
  const { candidates, assignments } = board
  let n = 0
  for (let i = 0; i < assignments.length; i++) {
    if (i === selfIndex) continue
    if (assignments[i]! !== candidateIndex) continue
    const c = candidates[i]
    if (c === undefined || !c.alive || c.team !== team) continue
    n++
  }
  return n
}
```

- [ ] **Step 4: 跑測試並提交**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: PASS，15 條。

```bash
npm run build
git add src/ai/target.ts test/unit/ai-target.test.ts
git commit -m "feat(ai): 目標指派板與同隊分攤統計（重掃而不是增減計數器）"
```

---

## Task 8: 遲滯選擇 `selectTarget`

**Files:**
- Modify: `src/ai/target.ts`
- Test: `test/unit/ai-target.test.ts`

**Interfaces:**
- Consumes: Task 6、7
- Produces:
  - `interface TargetState { current: number; dwell: number }`
  - `function createTargetState(): TargetState`
  - `function selectTarget(state: TargetState, board: TargetBoard, selfIndex: number, dt: number, cfg: TargetConfig): Aircraft | null`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-target.test.ts` 追加：

```ts
import { createTargetState, selectTarget } from '../../src/ai/target'

/** 造一個「藍 0 對紅 1、紅 2」的板，紅 1 在近處、紅 2 在遠處。 */
function board3(): ReturnType<typeof createTargetBoard> {
  const cs: TargetCandidate[] = [
    { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
    { index: 1, team: 'red', alive: true, aircraft: place(0, 4000, -200, 0) },
    { index: 2, team: 'red', alive: true, aircraft: place(0, 4000, -1500, 0) },
  ]
  return createTargetBoard(cs)
}

describe('selectTarget 的基本選擇', () => {
  it('選分數最高的敵機，並寫進 assignments', () => {
    const b = board3()
    const s = createTargetState()
    const t = selectTarget(s, b, 0, 0.1, DEFAULT_TARGET)
    expect(t).toBe(b.candidates[1]!.aircraft)
    expect(b.assignments[0]).toBe(1)
  })

  it('不會選同隊', () => {
    const cs: TargetCandidate[] = [
      { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
      { index: 1, team: 'blue', alive: true, aircraft: place(0, 4000, -100, 0) },
    ]
    const b = createTargetBoard(cs)
    expect(selectTarget(createTargetState(), b, 0, 0.1, DEFAULT_TARGET)).toBeNull()
  })

  it('沒有存活的敵機時回傳 null 並清掉指派', () => {
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, DEFAULT_TARGET)
    b.candidates[1]!.alive = false
    b.candidates[2]!.alive = false
    expect(selectTarget(s, b, 0, 0.1, DEFAULT_TARGET)).toBeNull()
    expect(b.assignments[0]).toBe(-1)
  })

  it('自己退場時回傳 null', () => {
    const b = board3()
    b.candidates[0]!.alive = false
    expect(selectTarget(createTargetState(), b, 0, 0.1, DEFAULT_TARGET)).toBeNull()
  })
})

describe('selectTarget 的遲滯', () => {
  it('最小停留期間不換目標，即使遠處那架突然變好', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 2, switchMargin: 0 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
    // 把 2 搬到比 1 更近，讓它分數更高
    b.candidates[2]!.aircraft.state.position.set(0, 4000, -50)
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
  })

  it('停留時間走完之後才換', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 0.5, switchMargin: 0 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    b.candidates[2]!.aircraft.state.position.set(0, 4000, -50)
    for (let i = 0; i < 6; i++) selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(2)
  })

  it('換目標門檻擋掉「只好一點點」的候選', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 0, switchMargin: 5 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    // 只把 2 搬到略近於 1，分數差遠低於 500%
    b.candidates[2]!.aircraft.state.position.set(0, 4000, -190)
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
  })

  it('目標退場時立即重選，不受最小停留約束', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 999 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
    b.candidates[1]!.alive = false
    expect(selectTarget(s, b, 0, 0.1, cfg)).toBe(b.candidates[2]!.aircraft)
    expect(s.current).toBe(2)
  })
})

describe('selectTarget 的分攤', () => {
  it('隊友都鎖定近的那架時，我會挑遠的那架', () => {
    const cs: TargetCandidate[] = [
      { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
      { index: 1, team: 'blue', alive: true, aircraft: place(10, 4000, 0, 0) },
      { index: 2, team: 'blue', alive: true, aircraft: place(20, 4000, 0, 0) },
      { index: 3, team: 'blue', alive: true, aircraft: place(30, 4000, 0, 0) },
      { index: 4, team: 'red', alive: true, aircraft: place(0, 4000, -300, 0) },
      { index: 5, team: 'red', alive: true, aircraft: place(0, 4000, -500, 0) },
    ]
    const b = createTargetBoard(cs)
    // 三個隊友已經鎖定 4
    b.assignments.set([-1, 4, 4, 4, -1, -1])
    const cfg = { ...DEFAULT_TARGET, crowdPenalty: 1 }
    selectTarget(createTargetState(), b, 0, 0.1, cfg)
    expect(b.assignments[0]).toBe(5)
  })

  it('crowdPenalty 為 0 時分攤完全不起作用', () => {
    const cs: TargetCandidate[] = [
      { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
      { index: 1, team: 'blue', alive: true, aircraft: place(10, 4000, 0, 0) },
      { index: 2, team: 'blue', alive: true, aircraft: place(20, 4000, 0, 0) },
      { index: 3, team: 'blue', alive: true, aircraft: place(30, 4000, 0, 0) },
      { index: 4, team: 'red', alive: true, aircraft: place(0, 4000, -300, 0) },
      { index: 5, team: 'red', alive: true, aircraft: place(0, 4000, -500, 0) },
    ]
    const b = createTargetBoard(cs)
    b.assignments.set([-1, 4, 4, 4, -1, -1])
    selectTarget(createTargetState(), b, 0, 0.1, { ...DEFAULT_TARGET, crowdPenalty: 0 })
    expect(b.assignments[0]).toBe(4)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/ai-target.test.ts -t "selectTarget"`
Expected: FAIL —— `selectTarget` 不存在。

- [ ] **Step 3: 寫實作**

在 `src/ai/target.ts` 追加：

```ts
/**
 * 一架 AI 的目標選擇狀態。**這是遲滯的記憶**。
 *
 * 【只能由 selectTarget 自己寫】M4 在遲滯上踩過一個坑：`latch` 的 OR 結果
 * 被寫回它自己的記憶，遲滯因此被毒化，0.29°/s 的雜訊就能讓閂鎖永遠關不掉。
 * 教訓是遲滯的記憶不能有第二條寫入路徑。`current` 同理。
 */
export interface TargetState {
  /** 現任目標在 `board.candidates` 裡的索引；−1 = 無 */
  current: number
  /** 距離可以再換目標還有多久，s */
  dwell: number
}

export function createTargetState(): TargetState {
  return { current: -1, dwell: 0 }
}

/**
 * 挑一個目標，回傳它的 `Aircraft`；沒有可打的敵機時回傳 null。
 *
 * @param dt 距離上次呼叫的秒數。呼叫端是 10 Hz 的決策節拍，所以這裡通常
 *           是 0.1 —— 最小停留因此以「秒」而不是「拍數」計。
 *
 * 熱路徑之外（10 Hz），但仍然不配置。
 */
export function selectTarget(
  state: TargetState, board: TargetBoard, selfIndex: number,
  dt: number, cfg: TargetConfig,
): Aircraft | null {
  const { candidates, assignments } = board
  const self = candidates[selfIndex]
  if (self === undefined || !self.alive) {
    state.current = -1
    state.dwell = 0
    if (selfIndex >= 0 && selfIndex < assignments.length) assignments[selfIndex] = -1
    return null
  }

  state.dwell = state.dwell > dt ? state.dwell - dt : 0

  // 【立即重選就是靠這裡】現任失效時把記憶清成「沒有現任」，下面的
  // `current < 0` 分支就會直接接受最佳解，完全繞過最小停留。
  const held = state.current >= 0 ? candidates[state.current] : undefined
  if (held === undefined || !held.alive || held.team === self.team) {
    state.current = -1
    state.dwell = 0
  }

  let bestIndex = -1
  let bestScore = -1
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive || c.team === self.team) continue
    const locks = countLocks(board, self.team, selfIndex, i)
    const s = targetScore(self.aircraft, c.aircraft, locks, cfg)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i
    }
  }

  if (bestIndex < 0) {
    state.current = -1
    assignments[selfIndex] = -1
    return null
  }

  if (state.current < 0) {
    state.current = bestIndex
    state.dwell = cfg.minDwell
  } else if (state.dwell <= 0 && bestIndex !== state.current) {
    const cur = candidates[state.current]!
    const curLocks = countLocks(board, self.team, selfIndex, state.current)
    const curScore = targetScore(self.aircraft, cur.aircraft, curLocks, cfg)
    // 【乘法門檻在這裡才安全】targetScore 恆非負（見該函數註解）
    if (bestScore > curScore * (1 + cfg.switchMargin)) {
      state.current = bestIndex
      state.dwell = cfg.minDwell
    }
  }

  assignments[selfIndex] = state.current
  return candidates[state.current]!.aircraft
}
```

- [ ] **Step 4: 跑測試並提交**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: PASS，25 條。

```bash
npm run build
git add src/ai/target.ts test/unit/ai-target.test.ts
git commit -m "feat(ai): 目標選擇的遲滯與立即重選"
```

---

## Task 9: `AiController` 接上目標選擇與相位錯開

**Files:**
- Modify: `src/ai/AiController.ts`
- Test: `test/unit/ai-controller.test.ts`

**Interfaces:**
- Consumes: Task 6–8 的 `target.ts`
- Produces:
  - `AiController.board: TargetBoard | null`（預設 `null`）
  - `AiController.selfIndex: number`（預設 `-1`）
  - `AiController.targetConfig: TargetConfig`（預設 `DEFAULT_TARGET`）
  - `AiController.setDecisionPhase(fraction: number): void`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-controller.test.ts` 追加：

```ts
import { AI_DECISION_HZ } from '../../src/ai/AiController'
import { createTargetBoard, type TargetCandidate } from '../../src/ai/target'
import { createCommand } from '../../src/control/Controller'
import { Quaternion, Vector3 } from 'three'
import { BF109G6 } from '../../src/specs/bf109g6'

const UP2 = new Vector3(0, 1, 0)

function ac(x: number, y: number, z: number, yaw = 0): Aircraft {
  const a = new Aircraft(P51D, y, 200)
  a.state.position.set(x, y, z)
  a.state.orientation.copy(new Quaternion().setFromAxisAngle(UP2, yaw))
  return a
}

describe('AiController 的目標選擇', () => {
  it('board 為 null 時完全不碰 target（M4 行為）', () => {
    const c = new AiController()
    const self = ac(0, 4000, 0)
    const enemy = ac(0, 4000, -400)
    c.target = enemy
    c.update(self, 1 / 240, createCommand())
    expect(c.target).toBe(enemy)
  })

  it('board 設定之後會自己挑目標', () => {
    const self = ac(0, 4000, 0)
    const near = ac(0, 4000, -300)
    const far = ac(0, 4000, -3000)
    const cs: TargetCandidate[] = [
      { index: 0, team: 'blue', alive: true, aircraft: self },
      { index: 1, team: 'red', alive: true, aircraft: near },
      { index: 2, team: 'red', alive: true, aircraft: far },
    ]
    const c = new AiController()
    c.board = createTargetBoard(cs)
    c.selfIndex = 0
    c.update(self, 1 / 240, createCommand())
    expect(c.target).toBe(near)
  })

  it('目標退場後下一個決策節拍就換人', () => {
    const self = ac(0, 4000, 0)
    const near = ac(0, 4000, -300)
    const far = ac(0, 4000, -3000)
    const cs: TargetCandidate[] = [
      { index: 0, team: 'blue', alive: true, aircraft: self },
      { index: 1, team: 'red', alive: true, aircraft: near },
      { index: 2, team: 'red', alive: true, aircraft: far },
    ]
    const c = new AiController()
    c.board = createTargetBoard(cs)
    c.selfIndex = 0
    const out = createCommand()
    c.update(self, 1 / 240, out)
    expect(c.target).toBe(near)
    cs[1]!.alive = false
    // 推進超過一個決策週期
    for (let i = 0; i < Math.ceil(240 / AI_DECISION_HZ) + 1; i++) c.update(self, 1 / 240, out)
    expect(c.target).toBe(far)
  })
})

describe('AiController 的決策相位', () => {
  it('setDecisionPhase 讓兩個實例在不同的物理步做決策', () => {
    const self = ac(0, 4000, 0)
    const enemy = ac(0, 4000, -400)
    const a = new AiController()
    const b = new AiController()
    a.target = enemy
    b.target = enemy
    a.setDecisionPhase(0)
    b.setDecisionPhase(0.5)

    // 用 intent 是否在同一步變動不好觀測；改為直接觀測決策次數：
    // 相位 0 的實例在第一步就決策，相位 0.5 的要再過半個週期。
    const stepsPerPeriod = 240 / AI_DECISION_HZ
    let aDecisions = 0
    let bDecisions = 0
    const outA = createCommand()
    const outB = createCommand()
    for (let i = 0; i < stepsPerPeriod; i++) {
      const beforeA = a.decisionsMade
      const beforeB = b.decisionsMade
      a.update(self, 1 / 240, outA)
      b.update(self, 1 / 240, outB)
      if (a.decisionsMade > beforeA) aDecisions++
      if (b.decisionsMade > beforeB) bDecisions++
    }
    // 一個週期內兩者各決策一次，但不在同一步
    expect(aDecisions).toBe(1)
    expect(bDecisions).toBe(1)
  })

  it('相位不改變頻率——一秒仍然是 AI_DECISION_HZ 次', () => {
    const self = ac(0, 4000, 0)
    const c = new AiController()
    c.target = ac(0, 4000, -400)
    c.setDecisionPhase(0.37)
    const out = createCommand()
    for (let i = 0; i < 240; i++) c.update(self, 1 / 240, out)
    expect(c.decisionsMade).toBe(AI_DECISION_HZ)
  })
})
```

**兩點注意**：

1. 上面用到 `decisionsMade` —— 一個累計決策次數的公開計數器。它不是為測試發明的裝飾品，而是 §3.2 條件 12（幀率沒有週期性頓挫）唯一可自動化的代理量，Task 13 的整合測試也會用它檢查相位真的分散開了。
2. `test/unit/ai-controller.test.ts` 已經有自己的 import 與輔助函式。**把上面的 import 併進既有的群組，輔助函式若與既有的同名就沿用既有的**（例如它可能已經有一個造飛機的 helper）—— 重複宣告在 `noUnusedLocals` 之下會直接是編譯錯誤。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/ai-controller.test.ts`
Expected: FAIL —— `board` / `setDecisionPhase` / `decisionsMade` 不存在。

- [ ] **Step 3: 寫實作**

`src/ai/AiController.ts`：

檔頭加：

```ts
import {
  createTargetState, selectTarget, DEFAULT_TARGET, type TargetBoard, type TargetConfig,
} from './target'
```

欄位：

```ts
  /**
   * 目標選擇的共享指派板。
   *
   * 【null 時完全是 M4 的行為】`target` 由外部指派、不做選擇。M4 的全部
   * 測試與 `bench/ai-load.ts` 因此一個字都不用改（spec §6.6）。
   */
  board: TargetBoard | null = null
  /** 自己在 `board.candidates` 裡的索引。`board` 為 null 時不使用 */
  selfIndex = -1
  targetConfig: TargetConfig = DEFAULT_TARGET

  /**
   * 累計做過幾次意圖仲裁。
   *
   * 【為什麼公開】相位錯開（spec §6.4）唯一可自動化的觀測量。人工驗收看
   * 的是「幀率沒有週期性頓挫」，那不可能寫成斷言；「40 架的決策沒有擠在
   * 同一步」則可以。
   */
  decisionsMade = 0
```

私有欄位加 `private readonly targetState = createTargetState()`。

`update` 改成（整個方法替換）：

```ts
  update(self: Aircraft, dt: number, out: Command): void {
    const period = 1 / AI_DECISION_HZ

    // 【節拍先算，分支後用】決策這一步要不要跑，必須在「有沒有目標」之前
    // 決定 —— 否則沒有目標時計時器不會前進，board 一設上去就會變成每個
    // 物理步都在選目標。
    this.decisionTimer -= dt
    const decide = this.decisionTimer <= 0
    if (decide) {
      this.decisionTimer += period
      this.decisionsMade++
      if (this.board) {
        this.target = selectTarget(
          this.targetState, this.board, this.selfIndex, period, this.targetConfig,
        )
      }
    }

    const target = this.target
    if (!target) {
      // 沒有目標時維持機首方向平飛。這比「保持上一格的指令」安全——
      // 上一格可能是一個俯衝中的脫離向量。
      out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
      out.throttle = 0.7
      out.brake = 0
      out.firing = false
      this.safetyActive = applySafety(self, this.seaHeight, out)
      return
    }

    // ── 240 Hz：便宜的運動學 ──────────────────────────────
    evaluateGeometry(self, target, this.sit)
    evaluateThreat(self, target, this.sit)
    buildEngageBasis(self, target, this.basis)

    this.trackingSeconds = this.sit.threatInstant > 0 ? this.trackingSeconds + dt : 0
    const threat = this.sit.threatInstant * trackingFactor(this.trackingSeconds)

    // ── 10 Hz：昂貴的包絡查詢與意圖仲裁 ────────────────────
    if (decide) {
      evaluateEnergy(self, target, this.sit)
      this.intent = stepRules(this.rules, this.sit, threat, period)
    }

    // ── 240 Hz：轉向、開火 ────────────────────────────────
    engageKnobs(this.sit, this.knobs)
    const mode = geometryGate(this.sit, this.basis)
    steerCommand(this.intent, mode, this.sit, this.basis, self, this.knobs, out)
    out.firing = shouldFire(this.sit, this.basis, self)

    // ── 240 Hz：安全層，可覆寫上面全部 ─────────────────────
    this.safetyActive = applySafety(self, this.seaHeight, out)
  }

  /**
   * 錯開決策相位（spec §6.4）。
   *
   * 【為什麼需要】40 架的 `decisionTimer` 都從 0 起算，會在**同一個物理步**
   * 一起做昂貴的包絡查詢，變成每 100 ms 一次的週期性尖峰。
   *
   * 【它不解決分攤的順序相依】那件事無法消除，只能換一種形式 —— 見
   * spec §6.4。這裡要保證的是決定性，不是順序無關。
   *
   * @param fraction 0..1，在一個決策週期裡的位置
   */
  setDecisionPhase(fraction: number): void {
    const period = 1 / AI_DECISION_HZ
    let f = fraction % 1
    if (f < 0) f += 1
    this.decisionTimer = f * period
  }
```

- [ ] **Step 4: 跑整套測試**

Run: `npx vitest run`
Expected: 全綠。M4 的既有測試（`ai-controller`、`ai-duel-matrix`、`ai-safety-matrix`）必須原樣通過 —— 這是 spec §6.6 的驗收。

- [ ] **Step 5: 型別檢查並提交**

```bash
npm run build
git add src/ai/AiController.ts test/unit/ai-controller.test.ts
git commit -m "feat(ai): AiController 接上目標選擇；決策相位可錯開"
```

---

## Task 10: 20v20 的生成

**Files:**
- Create: `src/battle/setup.ts`
- Test: `test/unit/battle-setup.test.ts`

**Interfaces:**
- Consumes: `World`、`Aircraft`、`AiController`、`createTargetBoard`
- Produces:
  - `interface BattleConfig { perSide: number; altitude: number; tas: number; entryRange: number; lateralSpacing: number; altitudeSpread: number; resetCountdown: number }`
  - `const DEFAULT_BATTLE: BattleConfig`
  - `interface Battle { world: World; board: TargetBoard; blue: Combatant[]; red: Combatant[]; player: Combatant; countdown: number }`
  - `function createBattle(playerController: Controller, cfg?: BattleConfig): Battle`
  - `function aliveCount(cs: readonly Combatant[]): number`

- [ ] **Step 1: 寫失敗的測試**

`test/unit/battle-setup.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { aliveCount, createBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

describe('createBattle 的編制', () => {
  it('雙方各 perSide 架，玩家在藍隊', () => {
    const b = createBattle(new Idle())
    expect(b.blue).toHaveLength(DEFAULT_BATTLE.perSide)
    expect(b.red).toHaveLength(DEFAULT_BATTLE.perSide)
    expect(b.world.combatants).toHaveLength(DEFAULT_BATTLE.perSide * 2)
    expect(b.blue).toContain(b.player)
    expect(b.player.team).toBe('blue')
  })

  it('玩家用傳進來的控制器，其餘都是 AI', () => {
    const pc = new Idle()
    const b = createBattle(pc)
    expect(b.player.controller).toBe(pc)
    const others = b.world.combatants.filter((c) => c !== b.player)
    expect(others.every((c) => c.controller !== pc)).toBe(true)
  })

  it('combatants 的 index 等於陣列位置——指派板的前提', () => {
    const b = createBattle(new Idle())
    b.world.combatants.forEach((c, i) => expect(c.index).toBe(i))
    expect(b.board.assignments).toHaveLength(DEFAULT_BATTLE.perSide * 2)
  })

  it('沒有人一出生就設定了固定目標', () => {
    const b = createBattle(new Idle())
    expect(Array.from(b.board.assignments).every((a) => a === -1)).toBe(true)
  })
})

describe('createBattle 的出生幾何', () => {
  const b = createBattle(new Idle())

  it('兩隊相距 entryRange', () => {
    const centre = (cs: typeof b.blue): Vector3 => {
      const v = new Vector3()
      for (const c of cs) v.add(c.aircraft.state.position)
      return v.divideScalar(cs.length)
    }
    expect(centre(b.blue).distanceTo(centre(b.red)))
      .toBeCloseTo(DEFAULT_BATTLE.entryRange, 3)
  })

  it('兩隊面對面：機首方向的點積為 −1', () => {
    const fwd = (c: typeof b.player): Vector3 =>
      new Vector3(0, 0, -1).applyQuaternion(c.aircraft.state.orientation)
    expect(fwd(b.blue[0]!).dot(fwd(b.red[0]!))).toBeCloseTo(-1, 6)
  })

  it('速度與機首同向', () => {
    for (const c of b.world.combatants) {
      const fwd = new Vector3(0, 0, -1).applyQuaternion(c.aircraft.state.orientation)
      const v = c.aircraft.state.velocity.clone().normalize()
      expect(v.dot(fwd)).toBeCloseTo(1, 5)
      expect(c.aircraft.state.velocity.length()).toBeCloseTo(DEFAULT_BATTLE.tas, 3)
    }
  })

  it('同隊相鄰兩架的橫向間距等於 lateralSpacing', () => {
    for (let i = 1; i < b.blue.length; i++) {
      const dx = Math.abs(
        b.blue[i]!.aircraft.state.position.x - b.blue[i - 1]!.aircraft.state.position.x,
      )
      expect(dx).toBeCloseTo(DEFAULT_BATTLE.lateralSpacing, 3)
    }
  })

  it('高度散布在 ±altitudeSpread 之內，而且真的有散開', () => {
    const ys = b.world.combatants.map((c) => c.aircraft.state.position.y)
    for (const y of ys) {
      expect(Math.abs(y - DEFAULT_BATTLE.altitude)).toBeLessThanOrEqual(
        DEFAULT_BATTLE.altitudeSpread + 1e-6,
      )
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(DEFAULT_BATTLE.altitudeSpread)
  })

  it('沒有兩架出生在同一點', () => {
    const cs = b.world.combatants
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        expect(cs[i]!.aircraft.state.position.distanceTo(cs[j]!.aircraft.state.position))
          .toBeGreaterThan(1)
      }
    }
  })
})

describe('createBattle 的決策相位', () => {
  it('40 架的相位平均散開，不是全部擠在 0', () => {
    const b = createBattle(new Idle())
    // 跑滿一個決策週期，統計每一步有幾架做了決策
    const stepsPerPeriod = 24
    const perStep: number[] = []
    for (let s = 0; s < stepsPerPeriod; s++) {
      let n = 0
      for (const c of b.world.combatants) {
        if (c === b.player) continue
        const ai = c.controller as { decisionsMade: number }
        const before = ai.decisionsMade
        c.controller.update(c.aircraft, 1 / 240, c.command)
        if (ai.decisionsMade > before) n++
      }
      perStep.push(n)
    }
    // 39 架 AI 攤在 24 步裡，任何一步都不該超過 4 架
    expect(Math.max(...perStep)).toBeLessThanOrEqual(4)
    expect(perStep.reduce((a, x) => a + x, 0)).toBe(39)
  })
})

describe('aliveCount', () => {
  it('數存活的', () => {
    const b = createBattle(new Idle())
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide)
    b.blue[0]!.alive = false
    b.blue[1]!.alive = false
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide - 2)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL —— 找不到 `src/battle/setup.ts`。

- [ ] **Step 3: 寫實作**

`src/battle/setup.ts`：

```ts
import { Quaternion, Vector3 } from 'three'
import { World, type Combatant } from '../world/World'
import { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard, type TargetBoard } from '../ai/target'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import type { Controller } from '../control/Controller'

/**
 * 一場戰鬥的編制與出生幾何。
 *
 * **`entryRange` / `lateralSpacing` / `altitudeSpread` / `resetCountdown`
 * 是起始值，待 Task 16 由實測回填**（spec §13）。
 */
export interface BattleConfig {
  /** 每隊架數。專案負責人裁決：M5 固定 20（spec §2） */
  perSide: number
  altitude: number
  tas: number
  /** 兩隊重心的初始距離，m */
  entryRange: number
  /** 同隊相鄰兩架的橫向間距，m */
  lateralSpacing: number
  /** 高度散布的半幅，m */
  altitudeSpread: number
  /** 一方全滅後到重置的秒數 */
  resetCountdown: number
}

export const DEFAULT_BATTLE: BattleConfig = {
  perSide: 20,
  altitude: 4000,
  tas: 200,
  entryRange: 3000,
  lateralSpacing: 120,
  altitudeSpread: 300,
  resetCountdown: 3,
}

export interface Battle {
  readonly world: World
  readonly board: TargetBoard
  readonly blue: Combatant[]
  readonly red: Combatant[]
  /** 玩家那一架。恆在 `blue` 裡 */
  readonly player: Combatant
  readonly cfg: BattleConfig
  /** 重置倒數的剩餘秒數；> 0 代表戰鬥已分出結果 */
  countdown: number
}

const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)

/**
 * 高度散布：把 slot 映到 [−1, 1] 的鋸齒。
 *
 * 【為什麼不是亂數】spec §3.1 條件 7 要求決定性 —— 同一組設定跑兩次要
 * 逐幀一致。亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉決定性；而這裡
 * 真正要的只是「別讓 20 架擠在同一個高度」，鋸齒就夠了。
 *
 * 週期取 5 而不是 2，是因為 2 只會產生兩個高度層 —— 那在畫面上看起來是
 * 兩排整齊的飛機，不是一團散開的機群。
 */
function altitudeOffset(slot: number, spread: number): number {
  const cycle = slot % 5
  return ((cycle / 4) * 2 - 1) * spread
}

/**
 * 造一場 N vs N。
 *
 * 【玩家固定在藍隊中央】開局視野裡兩側都是友機、敵機在正前方 —— 與 M2
 * 「靶機擺正前方 400 m」同一個理由：看得到才算存在。
 */
export function createBattle(
  playerController: Controller, cfg: BattleConfig = DEFAULT_BATTLE,
): Battle {
  const world = new World()
  const blue: Combatant[] = []
  const red: Combatant[] = []
  const playerSlot = Math.floor(cfg.perSide / 2)
  let player: Combatant | null = null

  // 藍隊在 +Z、機首朝 −Z；紅隊在 −Z、機首朝 +Z（繞 Y 轉 π）
  for (const side of ['blue', 'red'] as const) {
    const blueSide = side === 'blue'
    const z = blueSide ? cfg.entryRange / 2 : -cfg.entryRange / 2
    const yaw = blueSide ? 0 : Math.PI
    const orientation = new Quaternion().setFromAxisAngle(UP, yaw)
    const velocity = FWD.clone().applyQuaternion(orientation).multiplyScalar(cfg.tas)

    for (let slot = 0; slot < cfg.perSide; slot++) {
      const x = (slot - (cfg.perSide - 1) / 2) * cfg.lateralSpacing
      const y = cfg.altitude + altitudeOffset(slot, cfg.altitudeSpread)
      const spec = blueSide ? P51D : BF109G6
      const aircraft = new Aircraft(spec, y, cfg.tas)
      aircraft.state.position.set(x, y, z)
      aircraft.state.orientation.copy(orientation)
      aircraft.state.velocity.copy(velocity)
      aircraft.prevPosition.copy(aircraft.state.position)
      aircraft.prevOrientation.copy(orientation)

      const isPlayer = blueSide && slot === playerSlot
      const controller = isPlayer ? playerController : new AiController()
      const c = world.add(
        aircraft, controller, side, aircraft.state.position.clone(), y, cfg.tas,
      )
      // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
      c.respawnOnDestroy = false
      if (isPlayer) player = c
      ;(blueSide ? blue : red).push(c)
    }
  }

  if (player === null) throw new Error('玩家沒有被建立——perSide 必須 >= 1')

  // 【指派板必須在全部 add 完之後才建】它會檢查 index 與陣列位置一致，
  // 而 index 是 add 依序給的
  const board = createTargetBoard(world.combatants)

  // AI 接線：指派板、自身索引、決策相位
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  return { world, board, blue, red, player, cfg, countdown: 0 }
}

/** 還活著的架數。 */
export function aliveCount(cs: readonly Combatant[]): number {
  let n = 0
  for (let i = 0; i < cs.length; i++) if (cs[i]!.alive) n++
  return n
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: PASS，12 條。

若「高度散布真的有散開」那條紅，代表 `altitudeOffset` 的週期讓所有 slot 落在同一層 —— 改週期，不要改斷言。

- [ ] **Step 5: 型別檢查並提交**

```bash
npm run build
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat(battle): 20v20 的生成、指派板接線與決策相位攤平"
```

---

## Task 11: 全滅偵測與整場重置

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/unit/battle-setup.test.ts`

**Interfaces:**
- Consumes: Task 10 的 `Battle`
- Produces:
  - `function stepBattle(b: Battle, dt: number): void` —— 推進世界、處理全滅倒數與重置
  - `function resetBattle(b: Battle): void` —— 整場回到滿編

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/battle-setup.test.ts` 追加：

```ts
import { resetBattle, stepBattle } from '../../src/battle/setup'

const DT = 1 / 240

describe('全滅與重置', () => {
  it('雙方都還有人時倒數為 0', () => {
    const b = createBattle(new Idle())
    stepBattle(b, DT)
    expect(b.countdown).toBe(0)
  })

  it('一方全滅後開始倒數', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    stepBattle(b, DT)
    expect(b.countdown).toBeGreaterThan(0)
    expect(b.countdown).toBeLessThanOrEqual(b.cfg.resetCountdown)
  })

  it('倒數走完之後整場回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    const steps = Math.ceil(b.cfg.resetCountdown / DT) + 2
    for (let i = 0; i < steps; i++) stepBattle(b, DT)
    expect(aliveCount(b.red)).toBe(b.cfg.perSide)
    expect(aliveCount(b.blue)).toBe(b.cfg.perSide)
    expect(b.countdown).toBe(0)
  })

  it('重置把血量、位置、指派板一起清乾淨', () => {
    const b = createBattle(new Idle())
    const spawn = b.red[0]!.aircraft.state.position.clone()
    b.red[0]!.hp = 1
    b.red[0]!.aircraft.state.position.set(9999, 9999, 9999)
    b.board.assignments.set(b.board.assignments.map(() => 3))
    resetBattle(b)
    expect(b.red[0]!.hp).toBe(b.red[0]!.aircraft.spec.hp)
    expect(b.red[0]!.aircraft.state.position.distanceTo(spawn)).toBeLessThan(1e-6)
    expect(Array.from(b.board.assignments).every((a) => a === -1)).toBe(true)
  })

  it('重置後彈丸池是空的——上一場的流彈不會打到新的一場', () => {
    const b = createBattle(new Idle())
    b.world.projectiles.spawn(0, 4000, 0, 0, 0, -800, 6, 0)
    expect(b.world.projectiles.live).toBeGreaterThan(0)
    resetBattle(b)
    expect(b.world.projectiles.live).toBe(0)
  })

  it('重置後方位與速度回到開局狀態', () => {
    const b = createBattle(new Idle())
    const before = b.red[0]!.aircraft.state.orientation.clone()
    b.red[0]!.aircraft.state.orientation.set(0.5, 0.5, 0.5, 0.5).normalize()
    resetBattle(b)
    expect(b.red[0]!.aircraft.state.orientation.angleTo(before)).toBeLessThan(1e-6)
  })
})

describe('決定性（spec §3.1 條件 7）', () => {
  it('同一組設定跑兩次，逐架位置一致', () => {
    const run = (): number[] => {
      const b = createBattle(new Idle())
      for (let i = 0; i < 240 * 5; i++) stepBattle(b, DT)
      return b.world.combatants.flatMap((c) => [
        c.aircraft.state.position.x, c.aircraft.state.position.y, c.aircraft.state.position.z,
        c.hp,
      ])
    }
    expect(run()).toEqual(run())
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/battle-setup.test.ts -t "全滅"`
Expected: FAIL —— `stepBattle` / `resetBattle` 不存在。

- [ ] **Step 3: 寫實作**

`Battle` 介面加一個欄位（放在 `countdown` 旁）：

```ts
  /** 每一架的開局姿態。重置時抄回去 */
  readonly spawnOrientations: Quaternion[]
```

`createBattle` 回傳時一併帶上 `spawnOrientations: world.combatants.map((c) => c.aircraft.state.orientation.clone())`。

追加：

```ts
/**
 * 推進一場戰鬥：世界一步，加上全滅倒數與重置。
 *
 * 【倒數而不是立刻重置】一方被打光的瞬間直接換場，玩家會以為遊戲當掉了
 * （spec §3.2 條件 15）。倒數是唯一的新狀態 —— 這是「零選單、零狀態機」
 * 這條 M2 紀律在多機下還能延續的方式。
 */
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)

  if (b.countdown > 0) {
    b.countdown -= dt
    if (b.countdown <= 0) {
      b.countdown = 0
      resetBattle(b)
    }
    return
  }

  if (aliveCount(b.blue) === 0 || aliveCount(b.red) === 0) {
    b.countdown = b.cfg.resetCountdown
  }
}

/**
 * 整場回到滿編。
 *
 * 【與 R 鍵共用同一條路徑】兩份長得很像的初始化，就是只有一份會被修好的
 * 那種危險 —— 與 `Aircraft.respawn`、`World.destroy` 是同一個理由。
 */
export function resetBattle(b: Battle): void {
  b.world.projectiles.clear()
  const combatants = b.world.combatants
  for (let i = 0; i < combatants.length; i++) {
    const c = combatants[i]!
    b.world.respawn(c)
    // 【方位與速度要另外抄回去】`World.respawn` 走的是 `Aircraft.reset`，
    // 它重建的是一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
    const q = b.spawnOrientations[i]!
    c.aircraft.state.orientation.copy(q)
    c.aircraft.prevOrientation.copy(q)
    c.aircraft.state.velocity.copy(FWD).applyQuaternion(q).multiplyScalar(c.spawnTas)
  }
  b.board.assignments.fill(-1)
  b.countdown = 0
}
```

**注意**：`resetBattle` 不重建 `AiController` 的內部狀態（閂鎖、停留計時器、目標記憶）。這是刻意的 —— 那些狀態在下一拍就會被沖掉（`selectTarget` 發現現任已不在敵隊或已重生，會走立即重選）。若 Task 13 的整合測試顯示重置後行為異常，再加一個 `AiController.reset()`，**但要先量到異常，不要預先加**。

- [ ] **Step 4: 跑整套測試**

Run: `npx vitest run`
Expected: 全綠。

「決定性」那條若紅，最可能的成因是實作裡混進了 `Math.random()` 或 `Date.now()` —— 兩者在這份計畫裡都不該出現。

- [ ] **Step 5: 型別檢查並提交**

```bash
npm run build
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat(battle): 全滅倒數與整場重置；決定性驗收"
```

---

## Task 12: 效能負載與門檻

**Files:**
- Create: `bench/multi-load.ts`, `bench/multi.bench.ts`
- Modify: `test/unit/perf-gate.test.ts`

**Interfaces:**
- Consumes: `createBattle`、`stepBattle`
- Produces: `createMultiLoad()`、`stepMultiLoad(state)`、`resetMultiLoad(state)`

- [ ] **Step 1: 寫負載定義**

`bench/multi-load.ts`：

```ts
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../src/battle/setup'
import { PROJECTILE_CAPACITY, PROJECTILE_LIFETIME } from '../src/world/Projectiles'
import type { Aircraft } from '../src/aircraft/Aircraft'
import type { Command, Controller } from '../src/control/Controller'

export const LOAD_DT = 1 / 240

/** 玩家位置上放一個恆平飛的假控制器——量的是 39 架 AI 加滿載彈丸。 */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

export interface MultiLoadState {
  battle: Battle
}

/**
 * 20v20 × 滿載 4,000 發的負載。
 *
 * 【與 M1 的 physics-load、M2 的 projectile-load、M4 的 ai-load 同一個
 * 「單一替換點」設計】門檻測試與 benchmark 呼叫同一份負載定義，改一處、
 * 兩邊量到同一份工作量，不會各自維護一份初始條件而悄悄量到不同的東西。
 *
 * 【為什麼要人工把池灌滿】20v20 的穩態存量取決於有多少人正扣著扳機，
 * 那會隨戰況起伏。要量的是**最壞情形**，所以每步補回滿載。
 */
export function createMultiLoad(): MultiLoadState {
  const battle = createBattle(new Idle(), DEFAULT_BATTLE)
  const state: MultiLoadState = { battle }
  fill(state)
  return state
}

function fill(state: MultiLoadState): void {
  const p = state.battle.world.projectiles
  const cs = state.battle.world.combatants
  for (let i = 0; i < PROJECTILE_CAPACITY; i++) {
    const c = cs[i % cs.length]!
    const o = c.aircraft.state.position
    const a = (i / PROJECTILE_CAPACITY) * Math.PI * 2
    p.spawn(
      o.x + Math.cos(a) * 40, o.y + Math.sin(a) * 40, o.z - 100 - (i % 700),
      Math.cos(a) * 20, Math.sin(a) * 20, -887, 6, c.index,
    )
    // 【壽命要錯開】全部給 age 0 的話會在同一步一起到期、再被一起補滿，
    // 量到的是週期性的尖峰而不是穩態
    p.age[i] = (i / PROJECTILE_CAPACITY) * PROJECTILE_LIFETIME
  }
}

export function stepMultiLoad(state: MultiLoadState): void {
  const p = state.battle.world.projectiles
  const o = state.battle.world.combatants[0]!.aircraft.state.position
  while (p.live < PROJECTILE_CAPACITY) {
    p.spawn(o.x, o.y, o.z - 200, 0, 0, -887, 6, 0)
  }
  stepBattle(state.battle, LOAD_DT)
}

export function resetMultiLoad(state: MultiLoadState): void {
  state.battle.world.projectiles.clear()
  for (const c of state.battle.world.combatants) state.battle.world.respawn(c)
  fill(state)
}
```

`bench/multi.bench.ts`（照 `bench/ai.bench.ts` 的體例，實作時先讀那一份對齊寫法）：

```ts
import { bench, describe } from 'vitest'
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from './multi-load'

describe('20v20 × 滿載 4,000 發', () => {
  const state = createMultiLoad()
  for (let i = 0; i < 500; i++) stepMultiLoad(state)
  resetMultiLoad(state)

  bench('World.step', () => {
    stepMultiLoad(state)
  })
})
```

- [ ] **Step 2: 量實際成本**

Run: `npx vitest bench --run bench/multi.bench.ts`
把量到的 µs/step 記下來 —— 它是下一步兩個門檻的依據。設計預估是 570 µs（spec §5.5）。

- [ ] **Step 3: 加門檻斷言**

在 `test/unit/perf-gate.test.ts` 末尾追加。`MULTI_BUDGET_US` 填上一步量到的值向上取整到百位；`MULTI_GATE_US` 取預算的三倍（與 M2/M4 同樣的並行雜訊餘裕）。

```ts
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from '../../bench/multi-load'

/**
 * 20v20 的效能守門（spec §10）。
 *
 * 【兩個數字各有用途】與 M2 的彈丸門檻、M4 的 AI 門檻同一個理由：vitest 把
 * 測試檔分散到多個 worker 並行跑，門檻壓在預算線上會**時紅時綠**，而會飄的
 * 效能門檻比沒有門檻更糟 —— 它訓練所有人重跑一次當作沒看到，真的迴歸時
 * 也就沒人信了。
 *
 * 這一條要抓的是**數量級的迴歸**，具體而言就是「有人把排序掃描改回全掃描」
 * ——實測那會從 202 µs 變成 7,408 µs，十四倍（spec §5.1）。
 */
const MULTI_BUDGET_US = 0 // ← Step 2 量到的值，向上取整到百位
const MULTI_GATE_US = 0   // ← 預算的三倍

describe('20v20 perf gate', () => {
  it('20v20 × 滿載 4,000 發的 World.step 沒有數量級的迴歸', () => {
    const state = createMultiLoad()
    for (let i = 0; i < 300; i++) stepMultiLoad(state)
    resetMultiLoad(state)

    // 取多批的最小值，不是單批的平均——見上面關於並行雜訊的說明
    const BATCHES = 5
    const N = 200
    let best = Infinity
    for (let b = 0; b < BATCHES; b++) {
      const t0 = performance.now()
      for (let i = 0; i < N; i++) stepMultiLoad(state)
      best = Math.min(best, ((performance.now() - t0) * 1000) / N)
    }

    expect(best).toBeLessThan(MULTI_GATE_US)
    if (best >= MULTI_BUDGET_US) {
      console.warn(
        `20v20 步 ${best.toFixed(0)} µs 超過 ${MULTI_BUDGET_US} µs 的設計預算；`
        + '若非並行雜訊所致，請以 npm run bench 獨立複測。',
      )
    }
  })
})
```

- [ ] **Step 4: 跑門檻測試**

Run: `npx vitest run test/unit/perf-gate.test.ts`
Expected: PASS。

**若實測遠高於 570 µs 的預估，不要放寬門檻。** 先用 `bench/multi.bench.ts` 獨立複測排除並行雜訊，再回頭找熱點 —— spec §5.1 的量測方法（分別量無彈丸與滿載）可以直接套用來定位。

- [ ] **Step 5: 提交**

```bash
npm run build
git add bench/multi-load.ts bench/multi.bench.ts test/unit/perf-gate.test.ts
git commit -m "test(perf): 20v20 x 滿載彈丸的效能門檻"
```

---

## Task 13: 20v20 整合矩陣

**Files:**
- Create: `test/integration/multi-battle.test.ts`

**Interfaces:**
- Consumes: `createBattle`、`stepBattle`、`aliveCount`、`countLocks`
- Produces: 無新程式碼

- [ ] **Step 1: 寫測試**

`test/integration/multi-battle.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  aliveCount, createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { countLocks } from '../../src/ai/target'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SECONDS = 60

/** 玩家位置放一個恆平飛的假駕駛——這是 AI 對 AI 的測試。 */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

interface Observed {
  /** 全程任一時刻的最大同時鎖定數 */
  maxLocks: number
  /** 全程是否有飛機出現在海面之下 */
  wentUnderwater: boolean
  /** 退場的飛機在退場之後仍被鎖定的次數 */
  lockedAfterExit: number
  /** 每架換目標的總次數 */
  switches: number
  /** 一個決策週期內單一物理步的最大決策架數 */
  maxDecisionsInOneStep: number
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const cs = b.world.combatants
  const last = new Int32Array(cs.length).fill(-1)
  const o: Observed = {
    maxLocks: 0, wentUnderwater: false, lockedAfterExit: 0,
    switches: 0, maxDecisionsInOneStep: 0,
  }

  const ais = cs.map((c) => c.controller as { decisionsMade?: number })
  let prevDecisions = ais.map((a) => a.decisionsMade ?? 0)

  for (let i = 0; i < SECONDS / DT; i++) {
    stepBattle(b, DT)

    // 一步之內有幾架做了決策
    let decidedThisStep = 0
    for (let k = 0; k < ais.length; k++) {
      const now = ais[k]!.decisionsMade ?? 0
      if (now > prevDecisions[k]!) decidedThisStep++
      prevDecisions[k] = now
    }
    if (decidedThisStep > o.maxDecisionsInOneStep) o.maxDecisionsInOneStep = decidedThisStep

    for (const c of cs) {
      if (c.alive && c.aircraft.state.position.y < 0) o.wentUnderwater = true

      const a = b.board.assignments[c.index]!
      if (a !== last[c.index]!) {
        if (last[c.index]! >= 0 && a >= 0) o.switches++
        last[c.index] = a
      }
      // 退場的飛機不該還被鎖定
      if (!c.alive && a >= 0) o.lockedAfterExit++
    }

    // 最大同時鎖定數（每 0.5 s 抽樣一次，逐步算太貴）
    if (i % 120 === 0) {
      for (const target of cs) {
        if (!target.alive) continue
        const team = target.team === 'blue' ? 'red' : 'blue'
        const n = countLocks(b.board, team, -1, target.index)
        if (n > o.maxLocks) o.maxLocks = n
      }
    }
  }
  return o
}

describe('20v20 跑滿 60 秒', () => {
  const o = observe()

  it('沒有任何一架被超過 maxLocks 架同時鎖定（spec §3.1 條件 3）', () => {
    // MAX_LOCKS 由本測試的實測分布回填（Task 16）。20 架分攤 20 個目標，
    // 完全均勻是 1；門檻要能容忍「幾架擠在同一個好目標上」但擋掉「全隊撲一架」。
    expect(o.maxLocks).toBeLessThanOrEqual(MAX_LOCKS)
  })

  it('分攤真的有在起作用——不是因為沒人選目標', () => {
    expect(o.maxLocks).toBeGreaterThan(0)
  })

  it('沒有飛機在海面之下（spec §3.1 條件 4）', () => {
    expect(o.wentUnderwater).toBe(false)
  })

  it('退場的飛機不再被鎖定（spec §3.1 條件 5）', () => {
    expect(o.lockedAfterExit).toBe(0)
  })

  it('換目標次數在遲滯的上限之內（spec §3.1 條件 10）', () => {
    // MAX_SWITCHES 由實測回填。上界的意義：40 架 × 60 s，若遲滯完全失效，
    // 換目標會逼近 40 × 60 × AI_DECISION_HZ = 24,000 次。
    expect(o.switches).toBeLessThan(MAX_SWITCHES)
  })

  it('決策相位真的攤開了（spec §6.4）', () => {
    // 39 架 AI 攤在 24 步（一個 10 Hz 週期）裡，平均每步 1.6 架
    expect(o.maxDecisionsInOneStep).toBeLessThanOrEqual(4)
  })

  it('戰鬥真的打起來了——有人被打下來', () => {
    const b = createBattle(new Idle())
    for (let i = 0; i < SECONDS / DT; i++) stepBattle(b, DT)
    expect(aliveCount(b.blue) + aliveCount(b.red))
      .toBeLessThan(DEFAULT_BATTLE.perSide * 2)
  })
})

describe('全滅重置（spec §3.1 條件 9）', () => {
  it('人為打光紅隊後，resetCountdown 內回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) b.world.destroy(c)
    const steps = Math.ceil(b.cfg.resetCountdown / DT) + 4
    for (let i = 0; i < steps; i++) stepBattle(b, DT)
    expect(aliveCount(b.red)).toBe(DEFAULT_BATTLE.perSide)
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide)
  })
})
```

**`MAX_LOCKS` 與 `MAX_SWITCHES` 在 Step 2 由實測回填** —— 先寫成常數並在 Step 2 印出實測值。

- [ ] **Step 2: 先量再定門檻**

在測試檔頂端暫時加 `console.log(o)` 並跑：

Run: `npx vitest run test/integration/multi-battle.test.ts`

把印出的 `maxLocks` 與 `switches` 記下來。門檻的取法：

- `MAX_LOCKS`：實測值 + 1。理由是它要抓的是「全隊撲同一架」（20v20 下那會是 19），不是抓正常的擁擠。若實測值本身就 ≥ 8，**那是分攤沒在運作的證據**，回去查 `crowdPenalty` 而不是提高門檻。
- `MAX_SWITCHES`：實測值 × 1.5。上界的意義寫在測試註解裡：遲滯完全失效時是 24,000 次。

拿掉 `console.log`，填入常數。

- [ ] **Step 3: 跑測試確認通過**

Run: `npx vitest run test/integration/multi-battle.test.ts`
Expected: PASS，8 條。

**「沒有飛機在海面之下」若是紅的，不要改測試。** 它代表 AI 安全層在 20v20 的密度下失效了，那是一個必須報告的真發現 —— 記下發生時的高度、速度與意圖，交回專案負責人裁決。

- [ ] **Step 4: 提交**

```bash
git add test/integration/multi-battle.test.ts
git commit -m "test(battle): 20v20 x 60 秒的整合矩陣（分攤、撞海、退場、遲滯、相位）"
```

---

## Task 14: HUD 的存活數與重置倒數

**Files:**
- Modify: `src/hud/types.ts`, `src/hud/Hud.ts`
- Create: `src/hud/widgets/roster.ts`
- Test: `test/unit/hud.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `HudFrame.blueAlive: number`、`HudFrame.redAlive: number`、`HudFrame.resetCountdown: number`
  - `function countdownLabel(seconds: number): string | null`（`src/hud/widgets/roster.ts`）
  - `function drawRoster(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void`

**測試策略的說明（先讀這一段）**：`test/unit/hud.test.ts` **沒有**假的 canvas context —— 既有的 HUD 測試全部是純函數（`indicatedAirspeed`、`attitudeFromOrientation`、`edgeIndicatorPosition`、`minimapSymbol`、`nextHitFlash`、`advanceGEffect`），繪製函數一條都沒測。這是這個 codebase 刻意的做法：**把繪製裡的判斷抽成純函數，測那個純函數**；`edgeIndicatorPosition` 與 `minimapSymbol` 就是從 `drawContacts` 與 `drawMinimap` 裡抽出來的。

`drawRoster` 裡唯一有判斷的東西是倒數的顯示規則（要不要顯示、顯示成什麼），所以抽成 `countdownLabel`。**不要為了測繪製而發明一套假 canvas** —— 那會是這個專案裡唯一的一套，而且它測的是 `fillText` 被呼叫過幾次，不是玩家看到什麼。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/hud.test.ts` 追加（`countdownLabel` 加進檔頭既有的 import 群組，不要另開一行 import）：

```ts
describe('HudFrame 的戰場欄位', () => {
  it('createHudFrame 的預設值', () => {
    const f = createHudFrame()
    expect(f.blueAlive).toBe(0)
    expect(f.redAlive).toBe(0)
    expect(f.resetCountdown).toBe(0)
  })
})

describe('countdownLabel', () => {
  it('戰鬥進行中不顯示', () => {
    expect(countdownLabel(0)).toBeNull()
  })

  it('負數也不顯示——倒數不會走成負的，但這一條擋掉「−0 秒」那種畫面', () => {
    expect(countdownLabel(-0.4)).toBeNull()
  })

  it('無條件進位：剩 2.4 秒顯示 3', () => {
    expect(countdownLabel(2.4)).toContain('3')
  })

  it('剩 0.1 秒顯示 1，不是 0', () => {
    // 【為什麼不能顯示 0】倒數走到 0 的那一格就重置了，畫面上永遠不該
    // 出現「重新開始 0」——那看起來像卡住
    expect(countdownLabel(0.1)).toContain('1')
  })
})
```

- [ ] **Step 1b: 跑測試確認失敗**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: FAIL —— `countdownLabel` 與三個欄位都不存在。

- [ ] **Step 2: 寫實作**

`src/hud/types.ts` 的 `HudFrame` 追加：

```ts
  /**
   * 雙方存活架數。
   *
   * 【為什麼顯示數量而不顯示各機血量】與 M2 §8 的裁決一致：你看不出對方的
   * 結構完整度。但「還有幾架在天上」是看得出來的 —— 那是一個真實可觀察的量。
   */
  blueAlive: number
  redAlive: number
  /** 重置倒數的剩餘秒數；0 代表戰鬥進行中，不佔版面 */
  resetCountdown: number
```

`createHudFrame` 的回傳值加 `blueAlive: 0, redAlive: 0, resetCountdown: 0`。

`src/hud/widgets/roster.ts`：

```ts
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 重置倒數要顯示的字串；戰鬥進行中回傳 null。
 *
 * 【為什麼抽成純函數】`main.ts` 與繪製函數都進不了單元測試，判斷留在
 * 裡面就等於沒有覆蓋。這與 `edgeIndicatorPosition` 從 `drawContacts`
 * 抽出來、`minimapSymbol` 從 `drawMinimap` 抽出來是同一個做法。
 *
 * 【為什麼是無條件進位】倒數走到 0 的那一格就重置了，所以畫面上永遠不該
 * 出現「重新開始 0」—— 那看起來像卡住。`Math.ceil` 讓最後一格顯示 1。
 */
export function countdownLabel(seconds: number): string | null {
  if (seconds <= 0) return null
  return `重新開始 ${Math.ceil(seconds)}`
}

/**
 * 雙方存活數與重置倒數。
 *
 * 【為什麼倒數為 0 時什麼都不畫】戰鬥進行中那一行永遠是空的，畫一個
 * 「--」只是在版面上佔一塊會被學會忽略的地方。
 */
export function drawRoster(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const size = Math.round(15 * L.scale)
  ctx.font = hudFont(size, true)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const y = L.height * 0.04

  ctx.fillStyle = HUD_COLORS.friendly
  ctx.fillText(String(f.blueAlive), L.cx - size * 2, y)

  ctx.fillStyle = HUD_COLORS.dim
  ctx.fillText('vs', L.cx, y)

  ctx.fillStyle = HUD_COLORS.danger
  ctx.fillText(String(f.redAlive), L.cx + size * 2, y)

  const label = countdownLabel(f.resetCountdown)
  if (label !== null) {
    ctx.font = hudFont(Math.round(20 * L.scale), true)
    ctx.fillStyle = HUD_COLORS.warn
    ctx.fillText(label, L.cx, y + size * 1.6)
  }
}
```

`src/hud/Hud.ts` 的 `render` 裡照既有 widget 的順序加上 `drawRoster(ctx, L, f)` —— 實作時先讀該檔，插在與其他抬頭資訊同一層。

- [ ] **Step 3: 跑測試並提交**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: PASS。

```bash
npm run build
git add src/hud/types.ts src/hud/widgets/roster.ts src/hud/Hud.ts test/unit/hud.test.ts
git commit -m "feat(hud): 雙方存活數與重置倒數"
```

---

## Task 15: `main.ts` 接上 20v20 戰場

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `createBattle`、`stepBattle`、`resetBattle`、`aliveCount`、`drawRoster` 的欄位
- Produces: 無（進入點）

**這一步沒有自動化測試** —— `main.ts` 是 DOM 進入點，測試碰不到。所以本任務的規則是：**任何有行為的邏輯都不准新增在 `main.ts` 裡**，全部只能是接線。若途中發現需要一段判斷，把它放進 `battle/setup.ts` 並補單元測試。

- [ ] **Step 1: 替換建場那一段**

刪掉 `main.ts` 第 55–89 行那一整段（`new World()`、`playerController`、`player`、`droneController`、`drone`、`droneAi`、`playerAi`），換成：

```ts
const playerController = new PlayerController(input)
const battle = createBattle(playerController)
const world = battle.world
const player = battle.player

/**
 * 自機的 AI（`I`）。純觀測用：讓同一顆腦袋同時開兩台，從外面看它怎麼打。
 *
 * 【為什麼要獨立一個實例而不是共用戰場裡的某一個】`AiController` 持有
 * 跨格狀態（遲滯閂鎖、最小停留、10 Hz 節流、跟蹤計時器、目標記憶）。
 * 共用的話兩架會互相踩掉對方的決策狀態，看到的行為不是任何一架真正的行為。
 */
const playerAi = new AiController()
playerAi.board = battle.board
playerAi.selfIndex = player.index
playerAi.setDecisionPhase(player.index / world.combatants.length)
```

`DRONE_OFFSET`、`START_ALTITUDE`、`START_TAS` 改為從 `battle.cfg` 取（`DRONE_OFFSET` 整個刪掉，它的註解搬進 `battle/setup.ts` 的 `entryRange` 說明）。

- [ ] **Step 2: 刪掉預錄機動的切換**

`ScriptedController` / `MANOEUVRES` 相關的 import 與那一整段 `wantAi` 切換邏輯刪掉 —— 20v20 裡沒有「靶機」這個角色了。`input.droneAi` 與 `input.droneManoeuvre` 若在 `bindings.ts` 有對應按鍵，一併移除並更新 `test/unit/bindings.test.ts`。

**若移除按鍵導致 `bindings.test.ts` 變紅，改測試是對的** —— 那些按鍵確實不存在了。但要在 commit 訊息裡寫明刪了什麼。

- [ ] **Step 3: 注入撞地判定，移除玩家專用的那一條**

```ts
// 【撞地判定擴及所有飛機】M2 到 M4 只對玩家做，理由是「靶機在固定高度
// 巡航，不會撞海」。20v20 裡總有人會被打到失控 —— 不補的話會出現在海面
// 下繼續飛的飛機（spec §1.1）。
//
// 波參數與海面著色器共用（見 aircraft/crash.ts），所以玩家看到的浪頭
// 就是撞得到的浪頭。
world.crashPolicy = (c) => isCrashed(c.aircraft.state.position, ocean.heightAt, elapsed)
```

刪掉迴圈裡原本那一段 `if (isCrashed(player.aircraft.state.position, ...)) respawnPlayer()`。

`respawnPlayer` 追加 `player.alive = true`，並把「玩家陣亡」那一條改成：

```ts
  // 【玩家陣亡走與撞海完全相同的路徑】spec §2 的裁決：雙方陣亡都自動重生。
  // 撞地現在由 world.crashPolicy 統一判定，這裡只負責把玩家接回來。
  if (!player.alive) respawnPlayer()
```

- [ ] **Step 4: 世界推進改走 `stepBattle`**

```ts
  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    stepBattle(battle, dt)
    hitsThisFrame += player.hitsDealt
    perf.endPhysics()
  })
```

`input.resetRequested` 的處理改成 `resetBattle(battle); respawnPlayer()`。

- [ ] **Step 5: 視覺層處理退場**

`visuals` 那個迴圈加一道：

```ts
  for (const c of world.combatants) {
    const v = visuals.get(c)!
    // 退場的飛機直接消失。爆炸火焰與殘骸模型延後至後續里程碑（spec §2）
    v.model.group.visible = c.alive
    if (!c.alive) continue
    v.position.lerpVectors(c.aircraft.prevPosition, c.aircraft.state.position, alpha)
    ...
  }
```

接觸點那個迴圈加 `if (!c.alive) continue`。

- [ ] **Step 6: 填 HUD 的新欄位**

```ts
  hudFrame.blueAlive = aliveCount(battle.blue)
  hudFrame.redAlive = aliveCount(battle.red)
  hudFrame.resetCountdown = battle.countdown
```

- [ ] **Step 7: 型別檢查與實際開起來看**

```bash
npm run build
npm run dev
```

在瀏覽器裡對照 spec §3.2 的五條人工驗收：

| # | 條件 |
|---|---|
| 11 | 開局能一眼看出敵我：友機藍框、敵機紅框，小地圖同色 |
| 12 | 20v20 全程幀率穩定，沒有週期性的頓挫 |
| 13 | AI 不會全隊撲向同一架敵機；戰場看起來是散開的多組纏鬥 |
| 14 | 被咬住時，附近的友機會有人轉過來 |
| 15 | 一方被打光時，重置是清楚的，不會讓人以為遊戲當掉 |

**逐條記下觀察，通過與否都要記。** 沒通過的交回專案負責人裁決，不要自行調參數。

**條件 12 特別要盯渲染，不是物理。** 這份計畫從頭到尾量的都是 `World.step`（CPU、node 裡跑），但 20v20 會在場景圖裡放 **40 個 `AircraftModel`** —— 那是這個專案從來沒跑過的規模（M2 到 M4 一直是 2 個），而且完全沒有量過。若幀率不穩，先用瀏覽器的效能面板分辨是 draw call 還是物理步：`perf` 覆蓋層已經把物理時間單獨切出來（`perf.beginPhysics` / `endPhysics`），兩者一比就知道。

**這是本計畫唯一一個沒有事前量測的風險。** 若渲染真的是瓶頸，那是一份新的工作（實例化、LOD、或降低模型面數），**不要在這個任務裡順手做** —— 記錄下來交回裁決。

- [ ] **Step 8: 提交**

```bash
git add src/main.ts src/input/bindings.ts src/input/InputState.ts test/unit/bindings.test.ts
git commit -m "feat(main): 開局改為 20v20 戰場；撞地判定擴及所有飛機"
```

---

## Task 16: 門檻回填與文件同步

**Files:**
- Modify: `src/ai/target.ts`, `src/battle/setup.ts`, `test/integration/multi-battle.test.ts`, `test/unit/perf-gate.test.ts`
- Modify: `docs/superpowers/specs/2026-08-03-m5-multi-aircraft-design.md`, `README.md`

**Interfaces:**
- Consumes: 前 15 個任務
- Produces: 無新程式碼

- [ ] **Step 1: 量四個評分門檻**

寫一支暫時的量測（跑完刪掉，不進 git），對 `opportunityWeight` / `threatWeight` / `crowdPenalty` / `switchMargin` / `minDwell` 各掃三到五個值，每組跑 20v20 × 60 s，記錄：

- 最大同時鎖定數（`maxLocks`）
- 換目標總次數
- 60 秒後雙方存活數
- 「被咬住時多久有隊友轉過來」的代理量：對每一架**正被鎖定且自己沒有射擊解**的飛機，統計有多少隊友把它的攻擊者選為目標

把結果做成表。**選值的依據寫下來，不要只寫結論。**

- [ ] **Step 2: 量三個出生幾何門檻**

`entryRange`：從開局跑到「第一次有任何一架取得射擊解」的秒數。取一個讓玩家有時間反應的值（下界的意義：M2 的有效射程 400 m，`entryRange` 至少要遠到雙方有一段接近過程）。掃 1,500 / 2,000 / 3,000 / 4,000 m。

`lateralSpacing` 與 `altitudeSpread`：開局跑 5 秒，量最小兩機距離。門檻是「不會近到看起來像要撞在一起」。

`resetCountdown`：與 §3.2 條件 15 的人工觀察對齊。

- [ ] **Step 3: 回填程式碼**

把量到的值填進 `DEFAULT_TARGET` 與 `DEFAULT_BATTLE`，並把每個常數的**推導**寫進註解 —— 格式照 `src/ai/rules.ts` 的 `turnEnter`（先寫數值怎麼來的，再寫它在什麼情況下休眠或失效）。

把 `test/integration/multi-battle.test.ts` 的 `MAX_LOCKS` / `MAX_SWITCHES` 與 `test/unit/perf-gate.test.ts` 的 `MULTI_BUDGET_US` / `MULTI_GATE_US` 一併確定。

**刪掉所有「起始值，待 Task 16 回填」的註解。**

- [ ] **Step 4: 回填 spec**

在 spec 末尾新增一節「§14 門檻回填紀錄（日期）」，逐項寫：門檻名稱、最終值、量測方法、量到的數字、選這個值的理由。§13 的表格加一欄「最終值」。

若過程中發現 spec 與實作對不起來（例如某個驗收條件寫不出測試、或某個設計決定在實作時被推翻），**寫進 spec 而不是默默改掉**。M4 的 §16 就是這麼做的。

- [ ] **Step 5: 更新 README**

`docs` 表格加一行 M5 實作計畫。「尚未實作」那一段的最後一句：

```
M4 只做了 1v1。多機、視野盲區、難度下調（`DifficultyProfile` 的兩個欄位在 M4 一律為 0）留給 M5。
```

改成記錄 M5 交付了什麼、以及明確留給後續的是什麼（編隊與僚機協同、飛機互撞、爆炸火焰與殘骸模型、難度下調、視野盲區）。

- [ ] **Step 6: 最後一次全套測試與型別檢查**

```bash
npx vitest run
npm run build
npx vitest bench --run
```

三個都要乾淨。benchmark 的數字記進 spec §14。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "docs: M5 的 12 個門檻由量測回填，spec 與 README 同步"
```

---

## 自我檢查

**Spec 覆蓋**

| spec 章節 | 對應任務 |
|---|---|
| §5 排序掃描 | Task 1、3 |
| §5.4 同隊跳過 | Task 3、4 |
| §6.1 候選集合 | Task 7 |
| §6.2 評分 | Task 6 |
| §6.3 指派板與分攤 | Task 7 |
| §6.4 決策相位 | Task 9、10 |
| §6.5 遲滯與重選 | Task 8 |
| §6.6 M4 相容 | Task 9 |
| §7 死亡與退場 | Task 2、5 |
| §8.1 生成 | Task 10 |
| §8.2 重置 | Task 11 |
| §9 HUD | Task 14 |
| §10 效能 | Task 12 |
| §11 測試策略 | Task 1–14 分散涵蓋 |
| §13 門檻 | Task 16 |
| §3.1 條件 1 | Task 3 |
| §3.1 條件 2 | Task 12 |
| §3.1 條件 3、4、5、7、10 | Task 13 |
| §3.1 條件 6 | Task 8 |
| §3.1 條件 8 | Task 4 |
| §3.1 條件 9 | Task 11、13 |
| §3.2 條件 11–15 | Task 15 |

**已知的計畫層級風險**

1. **Task 13 的門檻是先量再定的**，所以 Task 13 第一次跑必然是「印出數字」而不是「通過」。這是刻意的 —— 專案紀律不接受先配一個數字再回頭湊。
2. **Task 15 沒有自動化測試**，靠的是「不准在 `main.ts` 寫邏輯」這條規則。審查時要盯這一點。
3. **Task 5 可能讓既有的 AI 矩陣測試變紅**。若發生，那是一個真發現（有案例本來就掉到海裡），要報告而不是修測試。
4. **`resetBattle` 不清 `AiController` 的內部狀態**（Task 11 的註記）。這是刻意的取捨，若 Task 13 顯示重置後行為異常再加，但要先量到異常。
5. **渲染 40 架完全沒有量過**。整份計畫量的都是 `World.step`（CPU、node 裡），但場景圖裡會多出 38 個 `AircraftModel`。這是唯一一個沒有事前量測的風險，只會在 Task 15 的人工驗收（條件 12）暴露出來。若命中，那是一份新工作，不在本計畫範圍內。
6. **Task 15 要刪掉預錄機動（`ScriptedController` 的 UI 接線）**。`ScriptedController` 本身與它的測試留著（`test/unit/controllers.test.ts` 在用），刪的只是 `main.ts` 的靶機切換與對應按鍵 —— 20v20 裡沒有「靶機」這個角色了。刪之前先確認沒有別處在用。
