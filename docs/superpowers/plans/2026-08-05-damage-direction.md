# 受擊方向指示器 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 被擊中時，螢幕邊緣依來彈方向閃出紅色漸層並在 0.5 秒內淡出。

**Architecture:** `World` 在命中的那一步推一筆「受害者 + 來彈方向」事件（與 `hitEvents`／`killEvents` 同一套並排 Float32Array）；`main.ts` 在子步回呼裡排空、過濾出玩家自己的、轉成視角座標後推進一個固定容量的痕跡池；HUD 每幀把所有痕跡加總成一個 `alpha(θ)`，沿螢幕邊界掃 64 段梯形畫出去。純邏輯（痕跡池、角度窗、邊界求交）全部是可測的純函數，Canvas 繪製那一層與既有的 `gEffect` 一樣不測。

**Tech Stack:** TypeScript（`strict` + `noUncheckedIndexedAccess`）、three.js（只用 `Vector3` / `Quaternion` 做座標轉換）、Canvas 2D、Vitest。

**依據的 spec：** `docs/superpowers/specs/2026-08-05-damage-direction-design.md`

## Global Constraints

- **所有註解、測試名稱、commit 訊息一律用繁體中文。**
- `src/world/` **不得** import `src/render/`、`src/hud/`。方向是單向的。
- `noUncheckedIndexedAccess` 為 on：所有陣列索引存取都要 `!` 或先判 `undefined`。
- 專案沒有 `@types/node`，且 `npm run build` 第一步是 `tsc --noEmit` —— 不要用 `node:path`、`__dirname`、`process`。
- **絕不為了讓測試通過而放寬門檻。** 若某條斷言的主張變成假的，改寫那個主張並說明。
- **每一條新測試都要先看到它紅。**
- commit 一律**列出明確路徑**，不用 `git add -A`（`bash.exe.stackdump` 是被追蹤且已被改動的檔案）。
- 熱路徑（`World.resolveHits`、每個物理子步）**不配置**：不用 `for...of`、不 `new`、暫存物件放模組層。
- 常數的**確切值**（spec §7，不可改動）：
  - `DAMAGE_STRIDE = 4`
  - `DAMAGE_MARK_CAPACITY = 6`
  - `DAMAGE_MARK_SECONDS = 0.5`
  - `DAMAGE_MERGE_DOT = Math.cos(30 * DEG)`
  - `DAMAGE_HALF_WIDTH = 70 * DEG`
  - `DAMAGE_DEPTH = 0.22`
  - `DAMAGE_PEAK_ALPHA = 0.55`
  - `DAMAGE_SEGMENTS = 64`
  - 顏色 `rgb(255, 42, 32)`

## 檔案結構

| 檔案 | 職責 |
|---|---|
| `src/world/damage.ts`（新） | `DamageEvents` 並排緩衝：`create` / `push` / `clear`。與 `world/kills.ts` 同一套形狀 |
| `src/world/World.ts`（改） | 多一個 `damageEvents` 欄位；`resolveHits` 命中的那一步推一筆 |
| `src/hud/damageMarks.ts`（新） | 痕跡池 + 角度數學。**純函數，不碰 Canvas** |
| `src/hud/widgets/damageEdge.ts`（新） | 邊界求交（純函數）+ Canvas 繪製 |
| `src/hud/types.ts`（改） | `HudFrame.damageMarks` |
| `src/hud/Hud.ts`（改） | 繪製順序：`drawGEffect` 之後、`drawContacts` 之前 |
| `src/main.ts`（改） | 排空事件、推進痕跡、三處清除 |
| `src/tools/damageedge.ts`（改） | 改用正式模組，刪掉自己那一份副本 |
| `test/unit/damage.test.ts`（新） | `DamageEvents` + `World` 的推送 |
| `test/unit/damage-marks.test.ts`（新） | 痕跡池與角度數學 |
| `test/unit/damage-edge.test.ts`（新） | `borderPoint` |
| `test/integration/multi-battle.test.ts`（改） | 20v20 跑滿 150 秒，`damageEvents.dropped` 恆為 0 |

---

### Task 1: `DamageEvents` 事件緩衝

**Files:**
- Create: `src/world/damage.ts`
- Test: `test/unit/damage.test.ts`

**Interfaces:**
- Consumes: `IMPACT_CAPACITY` from `src/world/events.ts`
- Produces: `DAMAGE_STRIDE: 4`、`interface DamageEvents { readonly capacity: number; readonly data: Float32Array; count: number; dropped: number }`、`createDamageEvents(capacity?: number): DamageEvents`、`pushDamage(e: DamageEvents, victim: number, dx: number, dy: number, dz: number): void`、`clearDamage(e: DamageEvents): void`

- [ ] **Step 1: 寫下會紅的測試**

新增 `test/unit/damage.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  createDamageEvents, pushDamage, clearDamage, DAMAGE_STRIDE,
} from '../../src/world/damage'
import { IMPACT_CAPACITY } from '../../src/world/events'

describe('DamageEvents', () => {
  it('每筆四個 float：受害者索引 + 來彈方向', () => {
    expect(DAMAGE_STRIDE).toBe(4)
    const e = createDamageEvents(4)
    expect(e.data.length).toBe(4 * DAMAGE_STRIDE)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(0)
  })

  it('預設容量沿用 IMPACT_CAPACITY —— 每次命中推一筆，與 hitEvents 同數量', () => {
    expect(createDamageEvents().capacity).toBe(IMPACT_CAPACITY)
  })

  it('追加一筆，欄位依序寫入', () => {
    const e = createDamageEvents(4)
    pushDamage(e, 7, 1, 0, 0)
    expect(e.count).toBe(1)
    expect(Array.from(e.data.slice(0, DAMAGE_STRIDE))).toEqual([7, 1, 0, 0])
  })

  it('索引存進 float32 仍然精確', () => {
    // 【為什麼要測】float32 對 2^24 以內的整數精確，而參戰架數是 40。
    // 這條把那個推導釘住，免得日後有人把 victim 換成別的東西。
    const e = createDamageEvents(64)
    for (let i = 0; i < 64; i++) pushDamage(e, i, 0, 0, 1)
    for (let i = 0; i < 64; i++) expect(e.data[i * DAMAGE_STRIDE]).toBe(i)
  })

  it('滿了就丟棄並計數', () => {
    const e = createDamageEvents(2)
    pushDamage(e, 0, 0, 0, 1)
    pushDamage(e, 1, 0, 0, 1)
    pushDamage(e, 2, 0, 0, 1)
    expect(e.count).toBe(2)
    expect(e.dropped).toBe(1)
  })

  it('排空歸零 count，但不動 dropped', () => {
    // 【為什麼 dropped 是累計的】它是給整合測試斷言「從未溢位」用的。
    // 每次排空都歸零的話，溢位會在下一次排空時被抹掉，於是永遠測不到。
    const e = createDamageEvents(1)
    pushDamage(e, 0, 0, 0, 1)
    pushDamage(e, 1, 0, 0, 1)
    clearDamage(e)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(1)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/damage.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/world/damage"`

- [ ] **Step 3: 實作**

新增 `src/world/damage.ts`：

```ts
import { IMPACT_CAPACITY } from './events'

/**
 * 一個物理步之內的受擊事件：誰被打中、子彈**從哪個方向來**。
 *
 * 【為什麼另開一個緩衝而不是塞進 `hitEvents`】那個型別是 `x,y,z,nx,ny,nz`，
 * 消費者是火花與水柱。加兩個欄位會逼它們去猜哪幾個 float 是自己的 ——
 * `kills.ts` 的檔頭已經寫過這個理由（spec §3.1）。
 *
 * 【為什麼對每一架都推，而不是只推玩家的】`World` 不知道誰是玩家，這一版
 * 也不該讓它知道。一次 push 是四個 float，`main.ts` 自己過濾。
 *
 * 與 `hitEvents` 一樣由**呼叫端**排空。
 */
export const DAMAGE_STRIDE = 4

export interface DamageEvents {
  readonly capacity: number
  /** 每筆 `DAMAGE_STRIDE` 個 float：受害者索引, dx, dy, dz（來彈方向，世界座標單位向量） */
  readonly data: Float32Array
  /** 這一個子步累積了幾筆。`clearDamage` 歸零 */
  count: number
  /**
   * 因為緩衝滿了而被丟棄的累計筆數。**不會被 `clearDamage` 歸零。**
   *
   * 【為什麼累計】它是給整合測試斷言「從未溢位」用的。每次排空都歸零的話，
   * 溢位會在下一次排空時被抹掉，於是永遠測不到。
   */
  dropped: number
}

/**
 * 【容量為什麼沿用 `IMPACT_CAPACITY`】每一次命中推一筆撞擊、也推一筆受擊 ——
 * 兩者在同一個子步裡數量完全相同，所以那個 64 的推導原封不動成立。
 */
export function createDamageEvents(capacity: number = IMPACT_CAPACITY): DamageEvents {
  return {
    capacity,
    data: new Float32Array(capacity * DAMAGE_STRIDE),
    count: 0,
    dropped: 0,
  }
}

/** 追加一筆。滿了就丟棄並計數。熱路徑：不配置。 */
export function pushDamage(
  e: DamageEvents, victim: number, dx: number, dy: number, dz: number,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * DAMAGE_STRIDE
  const d = e.data
  d[o] = victim
  d[o + 1] = dx
  d[o + 2] = dy
  d[o + 3] = dz
  e.count++
}

/** 排空。不動 `dropped` —— 見它的註解。 */
export function clearDamage(e: DamageEvents): void {
  e.count = 0
}
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/damage.test.ts`
Expected: PASS，6 條

- [ ] **Step 5: commit**

```bash
git add src/world/damage.ts test/unit/damage.test.ts
git commit -m "feat: 受擊事件緩衝 DamageEvents"
```

---

### Task 2: `World` 在命中時推受擊事件

**Files:**
- Modify: `src/world/World.ts`（import、`damageEvents` 欄位、`resolveHits` 內 `pushImpact` 旁邊）
- Modify: `test/unit/damage.test.ts`（追加一個 describe）
- Modify: `test/integration/multi-battle.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createDamageEvents` / `pushDamage` / `clearDamage` / `DAMAGE_STRIDE`
- Produces: `World.damageEvents: DamageEvents`（`readonly`）—— 每次命中一筆，方向 = **彈丸速度的反向、已正規化**

- [ ] **Step 1: 寫下會紅的測試**

在 `test/unit/damage.test.ts` 末尾追加（檔頭的 import 一併補上）：

```ts
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.7
    out.firing = false
  }
}

/**
 * 藍隊射手（座位 0，擺在 500 m 外）與紅隊受害者（座位 1，擺在原點），原地不動。
 *
 * 【射手為什麼要擺遠】不擺開的話「同隊不推」那條測試裡的彈丸會改打到射手
 * 旁邊那一架敵機，測到的就不是想測的東西了。
 */
function shooterAndVictim(): World {
  const w = new World()
  const at = (x: number, y: number, z: number, team: 'blue' | 'red'): void => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(x, y, z)
    a.state.velocity.set(0, 0, 0)
    a.prevPosition.copy(a.state.position)
    w.add(a, new Idle(), team, a.state.position.clone(), 4000, 200)
  }
  at(0, 4000, 500, 'blue')
  at(0, 4000, 0, 'red')
  return w
}

describe('World 的受擊事件', () => {
  it('命中就推一筆，方向是彈丸速度的反向', () => {
    // 由 +X 側往 −X 打，橫向穿過機身 —— 來彈方向於是是 +X。
    const w = shooterAndVictim()
    w.projectiles.spawn(50, 4000, 0, -1000, 0, 0, 10, 0)
    w.projectiles.step(0.1)
    w.resolveHits()

    expect(w.damageEvents.count).toBe(1)
    const d = w.damageEvents.data
    expect(d[0]).toBe(1)
    expect(d[1]).toBeCloseTo(1, 5)
    expect(d[2]).toBeCloseTo(0, 5)
    expect(d[3]).toBeCloseTo(0, 5)
  })

  it('方向是單位向量 —— 初速大小不會漏進去', () => {
    // 【為什麼要測】漏掉正規化的話 `markOffAxis` 會是 887 而不是 1，
    // 角度窗直接壞掉，而畫面上看起來只是「紅光有點怪」。
    const w = shooterAndVictim()
    w.projectiles.spawn(30, 4000, 30, -700, 0, -700, 10, 0)
    w.projectiles.step(0.1)
    w.resolveHits()

    expect(w.damageEvents.count).toBe(1)
    const d = w.damageEvents.data
    expect(Math.hypot(d[1]!, d[2]!, d[3]!)).toBeCloseTo(1, 5)
  })

  it('沒打中就不推', () => {
    const w = shooterAndVictim()
    w.projectiles.spawn(50, 5000, 0, -1000, 0, 0, 10, 0)
    w.projectiles.step(0.1)
    w.resolveHits()
    expect(w.damageEvents.count).toBe(0)
  })

  it('同隊的彈丸穿過去，不推', () => {
    // 【為什麼要測】同隊零傷害是一條既有規則；受擊事件推在 applyDamage
    // 旁邊，若位置放錯（例如放到粗篩之後、命中判定之前）就會漏出來。
    // 射手寫 1（紅隊自己），彈丸於是穿過紅隊那一架。
    const w = shooterAndVictim()
    w.projectiles.spawn(50, 4000, 0, -1000, 0, 0, 10, 1)
    w.projectiles.step(0.1)
    w.resolveHits()
    expect(w.damageEvents.count).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/damage.test.ts`
Expected: FAIL —— `w.damageEvents` 是 `undefined`（TS 也會抱怨該屬性不存在）

- [ ] **Step 3: 實作**

`src/world/World.ts` 三處改動。

一、import（接在 `createKills` 那一行之後）：

```ts
import { createDamageEvents, pushDamage, type DamageEvents } from './damage'
```

二、欄位（緊接在 `killEvents` 宣告之後）：

```ts
  /**
   * 這一個物理步的受擊事件。與 `hitEvents` 一樣由**呼叫端**排空。
   *
   * 【為什麼對每一架都推】`World` 不知道誰是玩家（M11 spec §3.1）。
   */
  readonly damageEvents: DamageEvents = createDamageEvents()
```

三、`resolveHits` 裡，緊接在 `pushImpact(this.hitEvents, ...)` 那一段之後、
`this.applyDamage(...)` 之前插入：

```ts
      // 【方向取彈丸速度的反向，不是射手的位置】887 m/s 飛 500 m 要 0.56 秒
      // —— 指射手**現在**的位置，指的是一個玩家沒看到過的東西；而射手可能
      // 已經死了。「子彈從那裡來」正是玩家在畫面上看到的曳光彈方向（spec §3.2）。
      const vx = p.vx[i]!, vy = p.vy[i]!, vz = p.vz[i]!
      const vs = Math.hypot(vx, vy, vz)
      // 靜止的彈丸不存在，但除以 0 會把 NaN 一路餵進 HUD —— 擋在源頭
      if (vs > 1e-6) {
        pushDamage(this.damageEvents, victim.index, -vx / vs, -vy / vs, -vz / vs)
      }
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/damage.test.ts`
Expected: PASS，10 條

- [ ] **Step 5: 整合測試 —— 先讓它紅**

`test/integration/multi-battle.test.ts` 四處改動。

一、import（接在 `clearKills` 那一行之後）：

```ts
import { clearDamage } from '../../src/world/damage'
```

二、`Observed` 介面裡，緊接在 `killsDropped` 之後追加：

```ts
  /** 受擊事件緩衝累計丟棄了幾筆。門檻：恆為 0 */
  damageDropped: number
```

三、`observe()` 的初值物件裡，把 `killEventCount: 0, killsDropped: 0,` 改成：

```ts
    killEventCount: 0, killsDropped: 0, damageDropped: 0,
```

四、主迴圈裡 `clearKills(b.world.killEvents)` 之後追加一行：

```ts
    clearDamage(b.world.damageEvents)
```

五、`o.killsDropped = b.world.killEvents.dropped` 之後追加：

```ts
  o.damageDropped = b.world.damageEvents.dropped
```

六、`drainEvents` 補一行（那個 helper 的存在理由就是「排空全部緩衝」，
少一個就是一個會靜靜地把後面的斷言弄紅的洞）：

```ts
function drainEvents(b: Battle): void {
  clearKills(b.world.killEvents)
  clearImpacts(b.world.hitEvents)
  clearImpacts(b.world.splashEvents)
  clearDamage(b.world.damageEvents)
}
```

七、在「擊墜事件緩衝從未溢位」那條 `it` 之後追加：

```ts
  it('受擊事件緩衝從未溢位（M11 spec §8）', () => {
    // 容量與 hitEvents 同一個 64 —— 每次命中各推一筆，數量必然相同。
    // 這一條守的就是那個「必然」。
    expect(o.damageDropped).toBe(0)
  })
```

- [ ] **Step 6: 跑整合測試**

Run: `npx vitest run test/integration/multi-battle.test.ts`
Expected: PASS。（這一條在 Task 2 的實作已完成的情況下應該直接綠 —— 它守的是
容量推導，不是新行為。**若它紅，代表 64 的推導錯了，要回頭改推導而不是調大常數。**）

- [ ] **Step 7: commit**

```bash
git add src/world/World.ts test/unit/damage.test.ts test/integration/multi-battle.test.ts
git commit -m "feat: World 命中時推受擊方向事件"
```

---

### Task 3: 痕跡的角度數學

**Files:**
- Create: `src/hud/damageMarks.ts`
- Test: `test/unit/damage-marks.test.ts`

**Interfaces:**
- Consumes: `DEG` from `src/core/math.ts`
- Produces: `interface DamageMark { x: number; y: number; z: number; intensity: number }`、`DAMAGE_HALF_WIDTH: number`（rad）、`markAngle(m: DamageMark): number`、`markOffAxis(m: DamageMark): number`、`angleDelta(a: number, b: number): number`、`damageWindow(delta: number, half: number, offAxis: number): number`

- [ ] **Step 1: 寫下會紅的測試**

新增 `test/unit/damage-marks.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DEG } from '../../src/core/math'
import {
  angleDelta, damageWindow, markAngle, markOffAxis,
  DAMAGE_HALF_WIDTH, type DamageMark,
} from '../../src/hud/damageMarks'

/** 視角座標的一筆痕跡。x=右 y=上 z=後 */
function mark(x: number, y: number, z: number): DamageMark {
  return { x, y, z, intensity: 1 }
}

describe('markAngle', () => {
  it('正右是 0、正上是 π/2', () => {
    expect(markAngle(mark(1, 0, 0))).toBeCloseTo(0, 6)
    expect(markAngle(mark(0, 1, 0))).toBeCloseTo(Math.PI / 2, 6)
  })

  it('「右上 15°」就是 15° —— 專案負責人原話裡的那個例子', () => {
    // 右上 15° 指的是螢幕上偏離正右 15°：右上多一點、右下少一點。
    const m = mark(Math.cos(15 * DEG), Math.sin(15 * DEG), 0)
    expect(markAngle(m) / DEG).toBeCloseTo(15, 6)
  })
})

describe('markOffAxis', () => {
  it('正側面是 1', () => {
    expect(markOffAxis(mark(1, 0, 0))).toBeCloseTo(1, 6)
  })

  it('正後方與正前方都是 0 —— 畫面上沒有角度可言', () => {
    // 【為什麼兩者相同】spec §10：兩者都畫整圈，刻意不區分。
    expect(markOffAxis(mark(0, 0, 1))).toBeCloseTo(0, 6)
    expect(markOffAxis(mark(0, 0, -1))).toBeCloseTo(0, 6)
  })

  it('斜後方 45° 是 sin 45°', () => {
    const s = Math.SQRT1_2
    expect(markOffAxis(mark(s, 0, s))).toBeCloseTo(s, 6)
  })
})

describe('angleDelta', () => {
  it('跨過 ±π 取最短的那一邊', () => {
    expect(angleDelta(179 * DEG, -179 * DEG) / DEG).toBeCloseTo(2, 6)
    expect(angleDelta(-179 * DEG, 179 * DEG) / DEG).toBeCloseTo(-2, 6)
  })

  it('結果永遠落在 −π..π', () => {
    for (let a = -720; a <= 720; a += 17) {
      for (let b = -720; b <= 720; b += 23) {
        const d = angleDelta(a * DEG, b * DEG)
        expect(d).toBeGreaterThanOrEqual(-Math.PI - 1e-9)
        expect(d).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })
})

describe('damageWindow', () => {
  const H = DAMAGE_HALF_WIDTH

  it('offAxis = 1：中心是 1、半寬之外是 0', () => {
    expect(damageWindow(0, H, 1)).toBeCloseTo(1, 6)
    expect(damageWindow(H, H, 1)).toBeCloseTo(0, 6)
    expect(damageWindow(H * 1.5, H, 1)).toBe(0)
    expect(damageWindow(-H * 1.5, H, 1)).toBe(0)
  })

  it('offAxis = 0：任何角度都是 1 —— 正後方就是整圈', () => {
    // 【這是主幹不是特例】追尾視角下被咬六點是最常見的中彈方式，而那個
    // 方向正好投影在畫面正中央（spec §2.1）。
    for (let a = -180; a <= 180; a += 15) {
      expect(damageWindow(a * DEG, H, 0)).toBeCloseTo(1, 6)
    }
  })

  it('offAxis = 0.5：最遠處剩一半的底，中心仍然是 1', () => {
    expect(damageWindow(0, H, 0.5)).toBeCloseTo(1, 6)
    expect(damageWindow(Math.PI, H, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('左右對稱', () => {
    expect(damageWindow(0.4, H, 1)).toBeCloseTo(damageWindow(-0.4, H, 1), 9)
  })

  it('在半寬處平滑落地 —— 斜率為 0，所以看不見折痕', () => {
    // 【為什麼是升餘弦而不是線性】線性衰減會在光消失的那個角度留下一道
    // 看得見的折痕（spec §4.2）。斜率為 0 是「看不見」的可測形式。
    const eps = 1e-4
    const slope = (damageWindow(H, H, 1) - damageWindow(H - eps, H, 1)) / eps
    expect(Math.abs(slope)).toBeLessThan(1e-3)
  })

  it('中心也是平的 —— 兩端斜率都是 0', () => {
    const eps = 1e-4
    const slope = (damageWindow(eps, H, 1) - damageWindow(0, H, 1)) / eps
    expect(Math.abs(slope)).toBeLessThan(1e-3)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/damage-marks.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/hud/damageMarks"`

- [ ] **Step 3: 實作**

新增 `src/hud/damageMarks.ts`：

```ts
import { DEG } from '../core/math'

/**
 * 受擊方向痕跡 —— **純邏輯，不碰 Canvas**。繪製在 `widgets/damageEdge.ts`。
 *
 * 【為什麼拆開】Canvas 在 node 環境測不了，而「兩發要不要併成一團」、
 * 「正後方是不是整圈」都是有實際行為的規則。拆開之後它們就是普通的單元
 * 測試 —— 與 `advanceGEffect` 當初從 `drawGEffect` 拆出來同一個做法。
 */

/** 角度窗的半寬，rad。原型上調出來的（spec §7） */
export const DAMAGE_HALF_WIDTH = 70 * DEG

export interface DamageMark {
  /** 中彈當下的**視角座標**來彈方向，單位向量。x=右 y=上 z=後 */
  x: number
  y: number
  z: number
  /** 剩餘強度 0..1。0 = 空格 */
  intensity: number
}

/** 螢幕上的角度。0 = 正右、π/2 = 正上 */
export function markAngle(m: DamageMark): number {
  return Math.atan2(m.y, m.x)
}

/**
 * 這一發偏離視線多少：1 = 正側面、0 = 正前或正後（畫面上沒有角度）。
 *
 * 方向是單位向量，所以這就是它與視線夾角的正弦。
 */
export function markOffAxis(m: DamageMark): number {
  return Math.hypot(m.x, m.y)
}

/** 兩個角度的最短夾角，−π..π */
export function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * 角度窗：中心最亮，往兩側以升餘弦落到 0，並依 `offAxis` 混合到均勻一圈。
 *
 * 【為什麼要與「均勻一圈」混合】偏離視線越小，方向越不可信 —— 極限是正後方
 * 的整圈。用 `offAxis` 當混合比例，兩端都對而且中間是連續的：側面來彈是
 * 一團、斜後方是一團加一圈微亮的底、正後方就是整圈。沒有門檻、沒有跳變。
 *
 * 【為什麼是升餘弦而不是線性】升餘弦（Hann）兩端的**斜率都是 0**，所以光
 * 消失的地方切線平滑接上背景。線性衰減會在那個角度留下一道看得見的折痕。
 */
export function damageWindow(delta: number, half: number, offAxis: number): number {
  const d = Math.abs(delta)
  const lobe = d >= half ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / half))
  return offAxis * lobe + (1 - offAxis)
}
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/damage-marks.test.ts`
Expected: PASS，13 條

- [ ] **Step 5: commit**

```bash
git add src/hud/damageMarks.ts test/unit/damage-marks.test.ts
git commit -m "feat: 受擊方向的角度窗與角度數學"
```

---

### Task 4: 痕跡池

**Files:**
- Modify: `src/hud/damageMarks.ts`
- Modify: `test/unit/damage-marks.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `DamageMark`
- Produces: `DAMAGE_MARK_CAPACITY: 6`、`DAMAGE_MARK_SECONDS: 0.5`、`DAMAGE_MERGE_DOT: number`、`createDamageMarks(): DamageMark[]`、`pushDamageMark(marks: DamageMark[], x: number, y: number, z: number): void`、`stepDamageMarks(marks: DamageMark[], dt: number): void`、`resetDamageMarks(marks: DamageMark[]): void`

- [ ] **Step 1: 寫下會紅的測試**

在 `test/unit/damage-marks.test.ts` 末尾追加（檔頭 import 一併補上
`createDamageMarks, pushDamageMark, stepDamageMarks, resetDamageMarks,
DAMAGE_MARK_CAPACITY, DAMAGE_MARK_SECONDS`）：

```ts
/** 目前還亮著的痕跡 */
function live(marks: DamageMark[]): DamageMark[] {
  return marks.filter((m) => m.intensity > 0)
}

describe('痕跡池', () => {
  it('建出固定容量、全空的池', () => {
    const marks = createDamageMarks()
    expect(marks.length).toBe(DAMAGE_MARK_CAPACITY)
    expect(live(marks).length).toBe(0)
  })

  it('推一發就佔一格，強度是 1', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    expect(live(marks).length).toBe(1)
    expect(live(marks)[0]!.intensity).toBe(1)
  })

  it('幾乎平行的兩發只佔一格，而且方向不動', () => {
    // 【為什麼方向不能動】動了的話連射會讓那團光左右抖。一個攻擊者應該是
    // 一團持續亮著，不是六十團（spec §4.1）。
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS / 2)
    pushDamageMark(marks, Math.cos(10 * DEG), Math.sin(10 * DEG), 0)

    expect(live(marks).length).toBe(1)
    const m = live(marks)[0]!
    expect(m.intensity).toBe(1)
    expect(m.x).toBe(1)
    expect(m.y).toBe(0)
  })

  it('相反方向佔兩格 —— 兩邊夾擊要看得出來', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    pushDamageMark(marks, -1, 0, 0)
    expect(live(marks).length).toBe(2)
  })

  it('正後方來的兩發併成一格 —— 用 3D 方向判斷才擋得住這個退化情形', () => {
    // 【為什麼不用螢幕角度判斷】正後方來的兩發都投影在畫面中心，
    // atan2(0, 0) 沒有意義；但 3D 方向幾乎平行（spec §4.1）。
    const marks = createDamageMarks()
    pushDamageMark(marks, 0, 0, 1)
    pushDamageMark(marks, 0.05, -0.05, Math.sqrt(1 - 0.005))
    expect(live(marks).length).toBe(1)
  })

  it('池滿了就佔強度最小的那一格', () => {
    const marks = createDamageMarks()
    // 先塞滿 CAPACITY 個彼此相距 60° 的方向（> 30° 所以不會互相合併）
    for (let i = 0; i < DAMAGE_MARK_CAPACITY; i++) {
      const a = i * 60 * DEG
      pushDamageMark(marks, Math.cos(a), Math.sin(a), 0)
      // 每一發之間淡一點，最早的那一發最弱
      stepDamageMarks(marks, DAMAGE_MARK_SECONDS / 20)
    }
    expect(live(marks).length).toBe(DAMAGE_MARK_CAPACITY)
    const weakest = marks.reduce((a, b) => (a.intensity <= b.intensity ? a : b))
    expect(weakest.x).toBeCloseTo(1, 6)

    // 第七個方向（與所有既有方向都超過 30°）擠掉最弱的那一格
    pushDamageMark(marks, 0, 0, 1)
    expect(live(marks).length).toBe(DAMAGE_MARK_CAPACITY)
    expect(marks.some((m) => m.z === 1 && m.intensity === 1)).toBe(true)
    expect(marks.some((m) => m.x === 1 && m.y === 0)).toBe(false)
  })

  it('DAMAGE_MARK_SECONDS 之後歸零，而且不會變成負數', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS)
    expect(marks[0]!.intensity).toBe(0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS)
    expect(marks[0]!.intensity).toBe(0)
  })

  it('線性淡出：一半的時間剩一半的強度', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS / 2)
    expect(marks[0]!.intensity).toBeCloseTo(0.5, 6)
  })

  it('reset 把全部歸零', () => {
    // 【為什麼需要】不清的話上一場的紅邊會留到新的一場（spec §6.2）。
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    pushDamageMark(marks, -1, 0, 0)
    resetDamageMarks(marks)
    expect(live(marks).length).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/damage-marks.test.ts`
Expected: FAIL —— `createDamageMarks is not a function`（import 解析不到那些名字）

- [ ] **Step 3: 實作**

在 `src/hud/damageMarks.ts` 的 `DAMAGE_HALF_WIDTH` 旁邊追加兩個常數：

```ts
/** 同時記得住幾個方向。同時有六個不同方向的攻擊者已經是極端情形（spec §7） */
export const DAMAGE_MARK_CAPACITY = 6
/**
 * 一筆痕跡從最亮淡到消失要多久，s。
 *
 * 【為什麼比命中標記的 0.15 s 長】那個是「我打中了」的瞬間回饋，這個是
 * 「有人在打我」的處境資訊 —— 要撐得夠久讓人反應得過來（spec §7）。
 */
export const DAMAGE_MARK_SECONDS = 0.5
/** 方向夾角小於 30° 就併進既有那一格。連射的方向抖動遠小於它 */
export const DAMAGE_MERGE_DOT = Math.cos(30 * DEG)
```

在檔案末尾追加四個函數：

```ts
export function createDamageMarks(): DamageMark[] {
  return Array.from(
    { length: DAMAGE_MARK_CAPACITY },
    () => ({ x: 0, y: 0, z: 1, intensity: 0 }),
  )
}

/**
 * 記一次中彈。
 *
 * 【為什麼用 3D 方向判斷合併而不是螢幕角度】正後方來的兩發**沒有螢幕角度
 * 可以比**（它們都投影在畫面中心），但 3D 方向幾乎平行 —— 用點積判斷，
 * 那個退化情形自然就對了。
 *
 * 【合併時不動方向】動了的話連射會讓那團光左右抖。
 */
export function pushDamageMark(
  marks: DamageMark[], x: number, y: number, z: number,
): void {
  let weakest = 0
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!
    if (m.intensity > 0 && m.x * x + m.y * y + m.z * z > DAMAGE_MERGE_DOT) {
      m.intensity = 1
      return
    }
    if (m.intensity < marks[weakest]!.intensity) weakest = i
  }
  const m = marks[weakest]!
  m.x = x
  m.y = y
  m.z = z
  m.intensity = 1
}

/** 線性淡出。一幀呼叫一次，不是一個物理子步一次。 */
export function stepDamageMarks(marks: DamageMark[], dt: number): void {
  const drop = dt / DAMAGE_MARK_SECONDS
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!
    const v = m.intensity - drop
    m.intensity = v > 0 ? v : 0
  }
}

/**
 * 全部清空。
 *
 * 【與 `resetGEffect` 成對出現】兩者的觸發條件完全相同：玩家的處境發生了
 * 不連續的改變（重生、接手僚機、死亡鏡頭開始）。不清的話上一場的紅邊會
 * 留到新的一場（spec §6.2）。
 */
export function resetDamageMarks(marks: DamageMark[]): void {
  for (let i = 0; i < marks.length; i++) marks[i]!.intensity = 0
}
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/damage-marks.test.ts`
Expected: PASS，22 條（13 + 9）

- [ ] **Step 5: commit**

```bash
git add src/hud/damageMarks.ts test/unit/damage-marks.test.ts
git commit -m "feat: 受擊方向痕跡池"
```

---

### Task 5: 邊界求交

**Files:**
- Create: `src/hud/widgets/damageEdge.ts`
- Test: `test/unit/damage-edge.test.ts`

**Interfaces:**
- Produces: `interface BorderPoint { x: number; y: number; dx: number; dy: number }`、`borderPoint(theta: number, cx: number, cy: number, out: BorderPoint): void`

- [ ] **Step 1: 寫下會紅的測試**

新增 `test/unit/damage-edge.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DEG } from '../../src/core/math'
import { borderPoint, type BorderPoint } from '../../src/hud/widgets/damageEdge'

/** 1600×900 的畫面（16:9） */
const W = 1600
const H = 900
const CX = W / 2
const CY = H / 2

function at(theta: number): BorderPoint {
  const out: BorderPoint = { x: 0, y: 0, dx: 0, dy: 0 }
  borderPoint(theta, CX, CY, out)
  return out
}

describe('borderPoint', () => {
  it('正右打在右緣的中點', () => {
    const p = at(0)
    expect(p.x).toBeCloseTo(W, 6)
    expect(p.y).toBeCloseTo(CY, 6)
  })

  it('正上打在上緣的中點 —— 螢幕 y 向下，所以 y = 0', () => {
    const p = at(90 * DEG)
    expect(p.x).toBeCloseTo(CX, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('正左打在左緣的中點', () => {
    const p = at(180 * DEG)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(CY, 6)
  })

  it('正下打在下緣的中點', () => {
    const p = at(-90 * DEG)
    expect(p.x).toBeCloseTo(CX, 6)
    expect(p.y).toBeCloseTo(H, 6)
  })

  it('16:9 下的 45° 打在**上緣**而不是右緣', () => {
    // 【這一條擋的是「用圓當邊界」那個經典錯誤】圓會讓四個角空掉，
    // 而 45° 正是角落的方向（spec §8）。取 min(tx, ty) 才會打在真正的
    // 矩形邊上：16:9 下 cy/|sin| 比 cx/|cos| 小，所以先碰到上緣。
    const p = at(45 * DEG)
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.x).toBeCloseTo(CX + CY, 6)
    expect(p.x).toBeLessThan(W)
  })

  it('任何角度算出來的點都落在矩形邊界上', () => {
    for (let a = -180; a <= 180; a += 3) {
      const p = at(a * DEG)
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(W + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeLessThanOrEqual(H + 1e-9)
      // 至少貼在四條邊的其中一條上
      const onEdge = Math.abs(p.x) < 1e-6 || Math.abs(p.x - W) < 1e-6
        || Math.abs(p.y) < 1e-6 || Math.abs(p.y - H) < 1e-6
      expect(onEdge).toBe(true)
    }
  })

  it('回傳的方向是由中心指向邊界的單位向量', () => {
    // 【為什麼要一起回傳】繪製要用它把邊界點往**內**推一個固定距離，
    // 而那個方向必須與求交用的是同一個，不能各算一次。
    for (let a = -180; a <= 180; a += 11) {
      const p = at(a * DEG)
      expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1, 9)
      expect(p.x - CX).toBeCloseTo(p.dx * Math.hypot(p.x - CX, p.y - CY), 6)
      expect(p.y - CY).toBeCloseTo(p.dy * Math.hypot(p.x - CX, p.y - CY), 6)
    }
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/damage-edge.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/hud/widgets/damageEdge"`

- [ ] **Step 3: 實作**

新增 `src/hud/widgets/damageEdge.ts`：

```ts
export interface BorderPoint {
  /** 邊界上的螢幕座標 */
  x: number
  y: number
  /** 由畫面中心指向它的單位向量 */
  dx: number
  dy: number
}

/**
 * 由畫面中心朝角度 `theta` 射出去，打在畫面邊界的哪一點。
 *
 * 【為什麼是 `min` 而不是 `max`】最小的那個 t 才會打在真正的矩形邊上。
 * 用圓（固定半徑）的話四個角會空掉 —— 而角落正是「右上方來彈」最需要
 * 亮起來的地方（spec §5）。
 *
 * 【為什麼一併回傳方向】繪製要用它把邊界點往內推一個固定距離。分開各算
 * 一次就是兩份會漂掉的真相。
 */
export function borderPoint(
  theta: number, cx: number, cy: number, out: BorderPoint,
): void {
  // 【螢幕 y 向下】所以 sin 要取負，θ 才是「數學正向、上為正」
  const dx = Math.cos(theta)
  const dy = -Math.sin(theta)
  const tx = Math.abs(dx) > 1e-9 ? cx / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-9 ? cy / Math.abs(dy) : Infinity
  const t = tx < ty ? tx : ty
  out.dx = dx
  out.dy = dy
  out.x = cx + dx * t
  out.y = cy + dy * t
}
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/damage-edge.test.ts`
Expected: PASS，7 條

- [ ] **Step 5: commit**

```bash
git add src/hud/widgets/damageEdge.ts test/unit/damage-edge.test.ts
git commit -m "feat: 螢幕邊界的射線求交"
```

---

### Task 6: 繪製與 HUD 接線

**Files:**
- Modify: `src/hud/widgets/damageEdge.ts`
- Modify: `src/hud/types.ts`（`HudFrame` 加欄位、`createHudFrame` 初始化）
- Modify: `src/hud/Hud.ts`（繪製順序）

**Interfaces:**
- Consumes: Task 3/4 的 `damageMarks.ts` 全部匯出、Task 5 的 `borderPoint`、`HudFrame` / `HudLayout` from `src/hud/types.ts`
- Produces: `DAMAGE_DEPTH: 0.22`、`DAMAGE_PEAK_ALPHA: 0.55`、`DAMAGE_SEGMENTS: 64`、`drawDamageEdge(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void`、`HudFrame.damageMarks: DamageMark[]`

- [ ] **Step 1: `HudFrame` 加欄位**

`src/hud/types.ts`：

檔頭 import 追加：

```ts
import { createDamageMarks, type DamageMark } from './damageMarks'
```

`HudFrame` 介面裡，緊接在 `hitFlash` 之後追加：

```ts
  /**
   * 受擊方向痕跡。`main.ts` 推入與步進，widget 只讀。
   *
   * 【為什麼與 `hitFlash` 分開】那個是**我打中人**（讀 `player.hitsDealt`），
   * 方向相反 —— 沿用它就是把兩個相反的意思塞進同一個數字（spec §1）。
   */
  damageMarks: DamageMark[]
```

`createHudFrame()` 的回傳物件裡，`hitFlash: 0,` 之後追加：

```ts
    damageMarks: createDamageMarks(),
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: PASS（`HudFrame` 是結構型別，既有的 `createHudFrame()` 呼叫端不受影響）

- [ ] **Step 3: 實作繪製**

`src/hud/widgets/damageEdge.ts` 檔頭追加 import：

```ts
import {
  angleDelta, damageWindow, markAngle, markOffAxis, DAMAGE_HALF_WIDTH,
} from '../damageMarks'
import type { HudFrame, HudLayout } from '../types'
```

在 `borderPoint` 之前追加常數：

```ts
/** 沿邊界取樣的段數。64 段 = 每段 5.6°，配上升餘弦窗看不出接縫 */
export const DAMAGE_SEGMENTS = 64
/**
 * 紅帶往內衰減的深度，**短邊的比例**。
 *
 * 【為什麼不是半徑的百分比】用百分比的話角落的半徑比中間長四成，紅帶會在
 * 四個角腫起來（spec §5）。
 */
export const DAMAGE_DEPTH = 0.22
/** 最亮處的 alpha。原型上調出來的（spec §7） */
export const DAMAGE_PEAK_ALPHA = 0.55
/**
 * 紅色的 rgb 三元組，供內插進 `rgba(...)`。
 *
 * 【為什麼不用 `HUD_COLORS.danger`】那個（#ff5a4d）是目標框那種細線的
 * 強調色；攤成一大片半透明會發粉。這裡刻意更飽和（spec §7）。
 */
const DAMAGE_COLOR = '255, 42, 32'
```

在檔案末尾追加暫存與繪製函數：

```ts
// 【模組層的暫存】HUD 每幀跑 64 段 × 2 個點，每段 new 兩個物件就是每幀
// 128 次配置 —— 沿用 M1 §15 的紀律
const A: BorderPoint = { x: 0, y: 0, dx: 0, dy: 0 }
const B: BorderPoint = { x: 0, y: 0, dx: 0, dy: 0 }

/**
 * 受擊方向指示器：螢幕邊緣依來彈方向的紅色漸層。
 *
 * 【為什麼先把所有痕跡加總成一個 alpha(θ) 再畫】重疊的痕跡自然疊亮（夾在
 * 1 以內），而且每幀的填充次數固定 `DAMAGE_SEGMENTS` 次 —— 與同時有幾個
 * 痕跡無關（spec §5）。
 *
 * 【為什麼漸層是「邊界 → 內」而不是徑向】方向永遠垂直於邊界，所以長邊、
 * 短邊、角落看起來是同一條帶子；而往內的深度是一個**固定的螢幕距離**，
 * 光於是只在邊緣、不會跑到畫面中央。
 */
export function drawDamageEdge(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const marks = f.damageMarks
  let live = false
  for (let i = 0; i < marks.length; i++) {
    if (marks[i]!.intensity > 0) { live = true; break }
  }
  if (!live) return

  const depth = Math.min(L.width, L.height) * DAMAGE_DEPTH

  for (let s = 0; s < DAMAGE_SEGMENTS; s++) {
    const t0 = (s / DAMAGE_SEGMENTS) * Math.PI * 2
    const t1 = ((s + 1) / DAMAGE_SEGMENTS) * Math.PI * 2
    // 【取中點的值】段夠密（5.6°）而角度窗是平滑的，看不出階梯
    const mid = (t0 + t1) / 2

    let a = 0
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]!
      if (m.intensity <= 0) continue
      a += m.intensity
        * damageWindow(angleDelta(mid, markAngle(m)), DAMAGE_HALF_WIDTH, markOffAxis(m))
    }
    a = Math.min(1, a) * DAMAGE_PEAK_ALPHA
    // 低於 1/255 的 alpha 在畫面上是看不見的，省下一次漸層與一次填充
    if (a <= 0.002) continue

    borderPoint(t0, L.cx, L.cy, A)
    borderPoint(t1, L.cx, L.cy, B)
    const ix0 = A.x - A.dx * depth
    const iy0 = A.y - A.dy * depth
    const ix1 = B.x - B.dx * depth
    const iy1 = B.y - B.dy * depth

    const grad = ctx.createLinearGradient(
      (A.x + B.x) / 2, (A.y + B.y) / 2, (ix0 + ix1) / 2, (iy0 + iy1) / 2,
    )
    grad.addColorStop(0, `rgba(${DAMAGE_COLOR}, ${a.toFixed(3)})`)
    grad.addColorStop(1, `rgba(${DAMAGE_COLOR}, 0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(A.x, A.y)
    ctx.lineTo(B.x, B.y)
    ctx.lineTo(ix1, iy1)
    ctx.lineTo(ix0, iy0)
    ctx.closePath()
    ctx.fill()
  }
}
```

- [ ] **Step 4: 接進 `Hud.render`**

`src/hud/Hud.ts` 檔頭 import 追加（維持既有的字母順序，放在 `drawContacts` 之後）：

```ts
import { drawDamageEdge } from './widgets/damageEdge'
```

`render()` 裡，`drawGEffect(ctx, L, f, dt)` 那一行之後、`drawContacts` 之前插入：

```ts
    // 受擊方向壓在世界上面、儀表與數字之下——與黑視/紅視同一個理由
    drawDamageEdge(ctx, L, f)
```

- [ ] **Step 5: 型別檢查 + 全套測試**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。`tsc` 尤其重要 —— 這一步唯一的驗證手段就是它加上下一個 Task 的工具頁。

- [ ] **Step 6: commit**

```bash
git add src/hud/widgets/damageEdge.ts src/hud/types.ts src/hud/Hud.ts
git commit -m "feat: 受擊方向指示器的繪製與 HUD 接線"
```

---

### Task 7: `main.ts` 接線

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `DAMAGE_STRIDE` / `clearDamage` from `src/world/damage.ts`、`pushDamageMark` / `stepDamageMarks` / `resetDamageMarks` from `src/hud/damageMarks.ts`、`hudFrame.damageMarks`
- Produces: 無新的匯出

- [ ] **Step 1: import**

`src/main.ts` 檔頭，`import { clearKills } from './world/kills'` 之後追加：

```ts
import { clearDamage, DAMAGE_STRIDE } from './world/damage'
```

`import { resetGEffect } from './hud/widgets/gEffect'` 之後追加：

```ts
import { pushDamageMark, resetDamageMarks, stepDamageMarks } from './hud/damageMarks'
```

- [ ] **Step 2: 模組層暫存**

在 `const hudFrame = createHudFrame()` 之後追加：

```ts
/**
 * 受擊方向轉座標用的暫存。**模組層** —— 排空發生在物理子步的回呼裡，
 * 一幀可能跑八次，在裡面 new 就是每幀八次配置。
 */
const DAMAGE_DIR = new Vector3()
const DAMAGE_VIEW = new Quaternion()
```

- [ ] **Step 3: 在子步回呼裡排空**

`stepAndDrawBattle` 的 `loop.advance` 回呼裡，`clearImpacts(world.splashEvents)`
那一行之後插入：

```ts
    // 【只取玩家自己的】World 不知道誰是玩家，所以它對每一架都推
    // （M11 spec §3.1）。過濾在這裡做。
    //
    // 【相機用的是上一幀的姿態】`rig.update` 排在物理迴圈之後 —— 硬轉
    // 90°/s、一幀 16 ms 下的誤差是 1.4°，對一個 70° 寬的光團看不出來。
    // 為了少一幀而多開一個暫存緩衝，複雜度換不到任何看得見的東西
    // （M11 spec §6.1）。
    const dmg = world.damageEvents
    if (dmg.count > 0) {
      DAMAGE_VIEW.copy(ctx.camera.quaternion).invert()
      for (let i = 0; i < dmg.count; i++) {
        const o = i * DAMAGE_STRIDE
        if (dmg.data[o]! !== player.index) continue
        DAMAGE_DIR.set(dmg.data[o + 1]!, dmg.data[o + 2]!, dmg.data[o + 3]!)
          .applyQuaternion(DAMAGE_VIEW)
        pushDamageMark(hudFrame.damageMarks, DAMAGE_DIR.x, DAMAGE_DIR.y, DAMAGE_DIR.z)
      }
    }
    clearDamage(dmg)
```

- [ ] **Step 4: 幀尾步進**

`hudFrame.hitFlash = nextHitFlash(hudFrame.hitFlash, hitsThisFrame, frameSeconds)`
那一行之後插入：

```ts
  // 【一幀一次，不是一個子步一次】淡出走的是畫面時間。在子步裡步進的話，
  // 一幀跑幾個子步就淡幾倍快 —— 而子步數會隨幀率變動。
  stepDamageMarks(hudFrame.damageMarks, frameSeconds)
```

- [ ] **Step 5: 三處清除**

`resetDamageMarks` 與 `resetGEffect` **成對出現**。三處都要，一處都不能少
（M11 spec §6.2）。

一、`respawnPlayer()` 裡，`resetGEffect()` 之後：

```ts
  // 上一條命的紅邊不屬於這一條命
  resetDamageMarks(hudFrame.damageMarks)
```

二、`stepAndDrawBattle` 開頭的死亡鏡頭那一行：

```ts
  if (dying && !wasDying) {
    resetGEffect()
    resetDamageMarks(hudFrame.damageMarks)
  }
```

三、接手僚機那一段（`if (battle.player !== player) { ... }`）裡的
`resetGEffect()` 之後：

```ts
    // 打死上一架的那些方向不屬於新的這一架
    resetDamageMarks(hudFrame.damageMarks)
```

- [ ] **Step 6: 型別檢查 + 全套測試**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠

- [ ] **Step 7: 檢查沒有遺漏的清除點**

Run: `grep -n "resetGEffect\|resetDamageMarks" src/main.ts`
Expected: 八行 —— 兩行 import ＋ **三對**呼叫。**呼叫數對不上就是漏了一處。**

- [ ] **Step 8: commit**

```bash
git add src/main.ts
git commit -m "feat: 受擊方向指示器接進遊戲迴圈"
```

---

### Task 8: 工具頁改用正式模組

**Files:**
- Modify: `src/tools/damageedge.ts`
- Modify: `damageedge.html`

**Interfaces:**
- Consumes: `src/hud/damageMarks.ts` 與 `src/hud/widgets/damageEdge.ts` 的全部匯出、`createHudFrame` from `src/hud/types.ts`

**為什麼這一步不能省：** 工具頁現在自己抄了一份痕跡池與繪製邏輯。留兩份就是
這個專案一再點名的「只有一份會被修好」—— 而工具頁的那一份還會**反過來製造
錯誤的信心**，因為它看起來像在驗證正式的東西（spec §11）。

**這一步會改變工具頁的性質：** 持續／張角／深度／最亮四個滑桿要**移除** ——
它們現在是正式模組裡的常數。工具頁從「調參數」變成「驗證正式實作」。要再調
參數就改常數再重新整理。（讓 `drawDamageEdge` 收 override 參數是另一條路，
但那是為了工具頁而在正式 API 上開一個沒有人會用的洞。）

- [ ] **Step 1: 改寫 `src/tools/damageedge.ts`**

（這一步與 Step 2 是一組：新程式碼會去抓 `#consts` 與 `#clear` 兩個元素，
在 Step 2 的 HTML 落地之前開頁面會拋錯。兩步都做完再開。）

把第 32 行（`// ── 痕跡池（原型）──`）到第 200 行（`range('peak', ...)`）之間
自抄的那一份**整段刪掉**，換成 import 與正式模組的呼叫。改完之後的檔案：

```ts
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { buildAircraft } from '../render/geometry/buildAircraft'
import { DEG } from '../core/math'
import { P51D } from '../specs/p51d'
import { createHudFrame, type HudLayout } from '../hud/types'
import {
  markAngle, markOffAxis, pushDamageMark, resetDamageMarks, stepDamageMarks,
  DAMAGE_HALF_WIDTH, DAMAGE_MARK_CAPACITY, DAMAGE_MARK_SECONDS,
} from '../hud/damageMarks'
import {
  drawDamageEdge, DAMAGE_DEPTH, DAMAGE_PEAK_ALPHA,
} from '../hud/widgets/damageEdge'

/**
 * 受擊方向指示器 —— **驗證頁**，跑的是遊戲裡的那一份程式碼。
 *
 * spec §7 的三個數字（張角、深度、最亮）當初是在這一頁的滑桿上調出來的；
 * 定案之後邏輯搬進 `src/hud/`，這一頁改成 import 它 —— **不留第二份**
 * （spec §11）。要再調參數就改 `damageMarks.ts` / `damageEdge.ts` 的常數。
 *
 * 進入方式：`npm run dev` 之後開 /damageedge.html。
 */

// ── 3D 背景：只是為了判斷紅色在天空與海面上讀不讀得出來 ────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx3d = createScene(canvas)
const terrain = createTerrain('sea')
terrain.object.position.y = -300
ctx3d.scene.add(terrain.object)
const model = buildAircraft(P51D)
ctx3d.scene.add(model.group)
const controls = new OrbitControls(ctx3d.camera, ctx3d.renderer.domElement)
controls.target.set(0, 0, -2)
ctx3d.camera.position.set(4.6, 1.7, 13)
controls.update()

// ── 遊戲用的那一份 ─────────────────────────────────────────────────────
const frame = createHudFrame()
const marks = frame.damageMarks
const edge = document.getElementById('edge') as HTMLCanvasElement
const g = edge.getContext('2d')!
const L: HudLayout = { width: 0, height: 0, cx: 0, cy: 0, unit: 0, scale: 1 }

// ── 控制面板 ───────────────────────────────────────────────────────────
let azimuth = 90
let elevation = 0
let auto = false
let autoTimer = 0

const range = (id: string, onChange: (v: number) => void, fmt: (v: number) => string): void => {
  const el = document.getElementById(id) as HTMLInputElement
  const out = document.getElementById(`${id}V`)!
  const sync = (): void => {
    const v = Number(el.value)
    onChange(v)
    out.textContent = fmt(v)
  }
  el.addEventListener('input', sync)
  sync()
}
range('az', (v) => { azimuth = v }, (v) => `${v}°`)
range('el', (v) => { elevation = v }, (v) => `${v}°`)

// 參數不再可調——它們是正式模組裡的常數。顯示出來只是為了對照畫面。
document.getElementById('consts')!.textContent = [
  `持續　${DAMAGE_MARK_SECONDS.toFixed(2)} s`,
  `張角　${(DAMAGE_HALF_WIDTH / DEG).toFixed(0)}°`,
  `深度　${DAMAGE_DEPTH.toFixed(2)}`,
  `最亮　${DAMAGE_PEAK_ALPHA.toFixed(2)}`,
].join('\n')

/**
 * 方位／俯仰 → 視角座標的單位向量。
 *
 * 方位 0 = 正前方、90 = 正右、180 = 正後方。相機看向 −Z，所以正前方是 z = −1。
 */
function direction(azDeg: number, elDeg: number): [number, number, number] {
  const a = azDeg * DEG
  const e = elDeg * DEG
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]
}

function hitNow(azDeg = azimuth, elDeg = elevation): void {
  const [x, y, z] = direction(azDeg, elDeg)
  pushDamageMark(marks, x, y, z)
}

document.getElementById('hit')!.addEventListener('click', () => hitNow())
document.getElementById('both')!.addEventListener('click', () => {
  hitNow(90, 10)
  hitNow(-90, -10)
})
document.getElementById('clear')!.addEventListener('click', () => resetDamageMarks(marks))
const autoBtn = document.getElementById('auto') as HTMLButtonElement
autoBtn.addEventListener('click', () => {
  auto = !auto
  autoBtn.classList.toggle('on', auto)
})

// 【不用展開運算子】專案的 lib 目標下 NodeListOf 沒有 Symbol.iterator
const presets = Array.prototype.slice.call(
  document.querySelectorAll('.grid button'),
) as HTMLButtonElement[]
presets.forEach((b, i) => {
  const apply = (): void => {
    const az = document.getElementById('az') as HTMLInputElement
    const el = document.getElementById('el') as HTMLInputElement
    az.value = b.dataset['az']!
    el.value = b.dataset['el']!
    az.dispatchEvent(new Event('input'))
    el.dispatchEvent(new Event('input'))
    hitNow()
  }
  b.addEventListener('click', apply)
  window.addEventListener('keydown', (e) => {
    if (e.code === `Digit${i + 1}`) apply()
  })
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); hitNow() }
})

// ── 迴圈 ───────────────────────────────────────────────────────────────
const stats = document.getElementById('stats')!
let last = performance.now()

function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now

  if (auto) {
    autoTimer += dt
    // 六挺 .50 大約 80 發/s，但命中率遠低於此 —— 取 12 次/s 當「被咬住」
    while (autoTimer >= 1 / 12) {
      autoTimer -= 1 / 12
      hitNow()
    }
  }
  stepDamageMarks(marks, dt)

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight
  if (edge.width !== Math.round(w * dpr) || edge.height !== Math.round(h * dpr)) {
    edge.width = Math.round(w * dpr)
    edge.height = Math.round(h * dpr)
    edge.style.width = `${w}px`
    edge.style.height = `${h}px`
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  L.width = w
  L.height = h
  L.cx = w / 2
  L.cy = h / 2
  L.unit = h / 2
  drawDamageEdge(g, L, frame)

  controls.update()
  terrain.update(now / 1000, ctx3d.camera.position.x, ctx3d.camera.position.z)
  ctx3d.renderer.render(ctx3d.scene, ctx3d.camera)

  const live = marks.filter((m) => m.intensity > 0)
  stats.textContent = `活著的痕跡 ${live.length} / ${DAMAGE_MARK_CAPACITY}\n`
    + live
      .map((m) => `  ${(markAngle(m) / DEG).toFixed(0).padStart(4)}°`
        + `　偏離 ${markOffAxis(m).toFixed(2)}　強度 ${m.intensity.toFixed(2)}`)
      .join('\n')

  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
```

**注意：** `drawDamageEdge` 自己不清畫布（遊戲裡由 `Hud.render` 開頭的
`clearRect` 負責），所以這一頁必須自己 `g.clearRect`。

- [ ] **Step 2: 改 `damageedge.html`**

一、標題與說明改成驗證頁：

```html
    <title>受擊方向指示器 驗證頁 — Grok Aircraft</title>
```

```html
      <h1>受擊方向指示器　驗證頁</h1>
```

二、`<h2>參數</h2>` 到 `<div id="stats"></div>` 之前的四組滑桿（`life`、
`half`、`depth`、`peak`）**整段刪掉**，換成：

```html
      <h2>參數（正式模組的常數，不可調）</h2>
      <div id="consts" style="white-space: pre; color: #8ea6bb"></div>
```

三、在「兩邊夾擊」那一列之後追加一個清除鈕（驗收條件 7 要看的就是它）：

```html
      <div class="row">
        <button id="clear" style="flex:1">清除（換一場／接手僚機）</button>
      </div>
```

- [ ] **Step 3: 型別檢查與建置**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS。`build` 會一併確認 `damageedge` 這個入口沒有壞掉。

- [ ] **Step 4: 目視驗證**

Run: `npm run dev`，開 http://localhost:5173/damageedge.html

依 spec §9 逐條看（1~6 與 8 在這一頁看得到，7 用新的清除鈕看）：

1. 按「正右」→ 紅光出現在右側，0.5 秒內淡掉
2. 按「正後方」→ **整圈**，不是某一邊
3. 按「兩邊夾擊」→ **兩團**，各自淡出
4. 開「連射」→ **一團持續亮著**，不左右抖
5. 光還亮著時用滑鼠拖曳轉動視角 → 光**不動**（釘在畫面上）
6. 任何方位／俯仰下，光都只在邊緣，不會出現在畫面中央
7. 按「清除」→ 紅光立刻消失
8. 「右上 15°」→ 右上多、右下少（連續一團偏向右上，不是兩塊）

- [ ] **Step 5: commit**

```bash
git add src/tools/damageedge.ts damageedge.html
git commit -m "refactor: 工具頁改用正式的受擊方向模組，不留第二份"
```

---

## 完成後

- [ ] 全套測試：`npx vitest run`（基準：實作前 1,847 條、80 檔全綠；
      新增 39 條單元測試（3 個新檔）＋ 1 條整合測試）
- [ ] 型別與建置：`npx tsc --noEmit && npm run build`
- [ ] 效能閘門要在**沒有 vite dev server、沒有任何跑著遊戲迴圈的瀏覽器分頁**
      的情況下量。`perf-gate.test.ts` 量的是牆鐘時間，兩者都會灌高它。
      若它紅，用 `npm run bench` 獨立複量再下結論。
- [ ] 遊戲內人工驗收（spec §9，需要真的挨打）：
      條件 1~6、8 在遭遇戰裡看；
      條件 7 分三種觸發 —— 暫停選單的「重新開始」、被打死後接手僚機、
      死亡鏡頭開始的那一瞬間。

## 刻意不做（spec §10）

- 強度不隨傷害量變化
- 不區分正前方與正後方（兩者都是整圈）
- 不跟著世界轉（釘在畫面上）
- 不脈動、不抖動
