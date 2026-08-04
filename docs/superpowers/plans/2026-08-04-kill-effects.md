# M8 擊墜表現 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓擊墜從「憑空消失」變成「火球 + 沿飛行方向散射的零件 + 黑煙 + 無動力翻滾墜落的殘骸，一路掉到海面濺起水花」。

**Architecture:** `World` 只在 `destroy()` 推一筆擊墜事件，外觀全部發生在渲染層。火球、黑煙、噴濺共用一套**廣告板粒子池**（自訂著色器提供逐實例 alpha 與軟邊圓形，不用貼圖）；零件是獨立的方塊 `InstancedMesh`；殘骸**接管既有的 `AircraftModel`**，不新建幾何。

**Tech Stack:** TypeScript（strict）、three.js、vitest、Vite。

## Global Constraints

- **spec 是 `docs/superpowers/specs/2026-08-04-kill-effects-design.md`。** 每個任務的數值以 spec §12 的總表為準，逐字照抄。
- **全部註解、commit 訊息、測試名稱用繁體中文。** 這是專案既有慣例。
- **`src/world/` 不得 import 任何 `src/render/` 的東西。** 這是 spec §2 的分層界線，也是驗收條件 §14.1.2。
- **熱路徑不配置。** 所有粒子池預先配足容量，用環形緩衝覆蓋最舊的；`emit`/`step` 內不得 `new`。模組私有的暫存物件（`const M = new Matrix4()`）是既有做法，照抄 `src/render/sparks.ts`。
- **`InstancedMesh` 一律 `frustumCulled = false`。** 包圍球是建立時算的（全部在原點），開著剔除的話相機一離開原點附近整批粒子會消失。`sparks.ts:167` 有這個註解。
- **不用 `Math.random()`。** 需要隨機時用索引的整數雜湊 `hash01`（`sparks.ts:75`），保持純函數與可測試性。
- **不引入任何貼圖。** 專案目前一張貼圖都沒有（`grep -rn "Texture" src/` 為空）。軟邊圓形用片段著色器的 `smoothstep` 做。
- **tsconfig 開了 `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`、`exactOptionalPropertyTypes`。** vitest 用 esbuild 轉譯**不做型別檢查**，所以 `npm run build` 是唯一的型別關卡 —— 每個任務結束前都要跑。
- **`git add` 一律列明確路徑。** 工作區有一個先前就被修改過的 `bash.exe.stackdump`，`git add -A` 會把它一起提交。
- **效能閘門 `test/unit/perf-gate.test.ts` 的 `MULTI_BUDGET_US = 300` 不得放寬。** 擊墜表現全在渲染層，動到這個數字表示有東西跑進了物理迴圈（spec §13.3）。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/world/kills.ts`（新） | 擊墜事件緩衝。`events.ts` 的鄰居，同樣的形狀 |
| `src/world/hit.ts`（改） | 新增 `lowestPoint()` —— 旋轉後 OBB 的最低點。與 `boundingRadius` 並列 |
| `src/world/World.ts`（改） | `killEvents` 欄位；`destroy()` 推事件；`add()` 保容量 |
| `src/render/particles.ts`（新） | 泛用廣告板粒子池 + 著色器注入。火球／黑煙／噴濺共用 |
| `src/render/fireball.ts`（新） | 火球：常數、顏色曲線、由擊墜事件發射 |
| `src/render/smoke.ts`（新） | 黑煙：常數、發射器計時 |
| `src/render/spray.ts`（新） | 噴濺：常數、由接觸事件發射 |
| `src/render/debris.ts`（新） | 零件：方塊 `InstancedMesh`、逐實例顏色與翻滾 |
| `src/render/tumble.ts`（新） | `tumble()` —— 年齡 → 翻滾姿態的純函數。零件與殘骸共用 |
| `src/render/wrecks.ts`（新） | 殘骸：接管模型、翻滾墜落、表面接觸、回收 |
| `src/main.ts`（改） | 建池、排空事件、每幀步進；`visible = c.alive` 那一段讓路給殘骸池 |

**為什麼 `tumble` 獨立成檔**：零件與殘骸都要它，而它是這份計畫裡唯一一段「算錯了只會看起來有點怪」的旋轉數學 —— 值得自己的測試檔。

---

## Task 1: 擊墜事件緩衝

**Files:**
- Create: `src/world/kills.ts`
- Modify: `src/world/World.ts`（`add()` 與 `destroy()`）
- Test: `test/unit/kills.test.ts`

**Interfaces:**
- Consumes: 無（第一個任務）
- Produces:
  - `KILL_STRIDE = 7`
  - `interface KillEvents { readonly capacity: number; readonly data: Float32Array; count: number; dropped: number }`
  - `createKills(capacity: number): KillEvents`
  - `pushKill(e, x, y, z, vx, vy, vz, index): void`
  - `clearKills(e): void`
  - `World` 上新增 `killEvents: KillEvents`（**非 readonly**）

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/kills.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createKills, pushKill, clearKills, KILL_STRIDE } from '../../src/world/kills'

describe('KillEvents', () => {
  it('每筆七個 float：位置、速度、combatant 索引', () => {
    expect(KILL_STRIDE).toBe(7)
    const e = createKills(4)
    expect(e.data.length).toBe(4 * KILL_STRIDE)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(0)
  })

  it('追加一筆，欄位依序寫入', () => {
    const e = createKills(4)
    pushKill(e, 1, 2, 3, 10, 20, 30, 7)
    expect(e.count).toBe(1)
    expect(Array.from(e.data.slice(0, KILL_STRIDE))).toEqual([1, 2, 3, 10, 20, 30, 7])
  })

  it('索引存進 float32 仍然精確', () => {
    // 【為什麼要測】float32 對 2^24 以內的整數精確，而參戰架數是 40。
    // 這條測試是把那個推導釘住，免得日後有人把 index 換成別的東西。
    const e = createKills(64)
    for (let i = 0; i < 64; i++) pushKill(e, 0, 0, 0, 0, 0, 0, i)
    for (let i = 0; i < 64; i++) {
      expect(e.data[i * KILL_STRIDE + 6]).toBe(i)
    }
  })

  it('滿了就丟棄並計數', () => {
    const e = createKills(2)
    pushKill(e, 0, 0, 0, 0, 0, 0, 0)
    pushKill(e, 0, 0, 0, 0, 0, 0, 1)
    pushKill(e, 0, 0, 0, 0, 0, 0, 2)
    expect(e.count).toBe(2)
    expect(e.dropped).toBe(1)
  })

  it('排空歸零 count，但不動 dropped', () => {
    // 【為什麼 dropped 是累計的】它是給整合測試斷言「從未溢位」用的。
    // 每次排空都歸零的話，溢位會在下一次排空時被抹掉，於是永遠測不到。
    const e = createKills(1)
    pushKill(e, 0, 0, 0, 0, 0, 0, 0)
    pushKill(e, 0, 0, 0, 0, 0, 0, 1)
    clearKills(e)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(1)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/kills.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/world/kills"`

- [ ] **Step 3: 寫 `src/world/kills.ts`**

```ts
/**
 * 一個物理步之內產生的擊墜事件。
 *
 * 【為什麼是事件而不是每幀比對 `alive`】玩家會在**同一幀之內**死而復生 ——
 * `main.ts` 的 `if (!player.alive) respawnPlayer()` 跑在所有子步之後，一個
 * 排在它後面的邊緣偵測器看到的 `alive` 從頭到尾都是 true，玩家自己的死會
 * 被整個漏掉。把偵測器排到重生前面能修好它，但那是一個沒有任何東西保護
 * 的順序相依（M8 spec §2.1）。
 *
 * 【為什麼與 `ImpactEvents` 分開】那個型別是 `x,y,z,nx,ny,nz`；擊墜要帶
 * **速度**與**是誰**（火球要繼承母機速度、零件要取機種的機身色）。硬塞進
 * 六個 float 會逼消費者去猜哪三個是法線哪三個是速度。
 */
export const KILL_STRIDE = 7

export interface KillEvents {
  readonly capacity: number
  /** 每筆 `KILL_STRIDE` 個 float：x, y, z, vx, vy, vz, combatant 索引 */
  readonly data: Float32Array
  /** 這一個子步累積了幾筆。`clearKills` 歸零 */
  count: number
  /**
   * 因為緩衝滿了而被丟棄的累計筆數。**不會被 `clearKills` 歸零。**
   *
   * 【為什麼在「結構上不可能溢位」的情況下還留這個計數器】容量由
   * `World.add()` 維持在參戰架數，而一個子步之內每架最多死一次 —— 溢位
   * 應該是不可能的。但「應該不可能」與「測過了不可能」差一個整合測試，
   * 而掉一次擊墜等於少一次爆炸，是絕不能默默發生的事。這個數字存在的
   * 唯一目的就是讓那條斷言寫得出來（spec §14.1.1）。
   */
  dropped: number
}

export function createKills(capacity: number): KillEvents {
  return {
    capacity,
    data: new Float32Array(capacity * KILL_STRIDE),
    count: 0,
    dropped: 0,
  }
}

/** 追加一筆。滿了就丟棄並計數。熱路徑：不配置。 */
export function pushKill(
  e: KillEvents,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  index: number,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * KILL_STRIDE
  const d = e.data
  d[o] = x
  d[o + 1] = y
  d[o + 2] = z
  d[o + 3] = vx
  d[o + 4] = vy
  d[o + 5] = vz
  d[o + 6] = index
  e.count++
}

/** 排空。不動 `dropped` —— 見它的註解。 */
export function clearKills(e: KillEvents): void {
  e.count = 0
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/kills.test.ts`
Expected: PASS（5 條）

- [ ] **Step 5: 把 `killEvents` 接進 `World`**

在 `src/world/World.ts` 的 import 區塊加：

```ts
import { createKills, pushKill, type KillEvents } from './kills'
```

在 `hitEvents` / `splashEvents` 兩個欄位旁邊（約 `World.ts:160`）加：

```ts
  /**
   * 這一個物理步的擊墜事件。與 `hitEvents` 一樣由**呼叫端**排空。
   *
   * 【為什麼不是 readonly】容量要跟著參戰架數走，而架數是 `add()` 一架一架
   * 長出來的。一個子步之內每架最多死一次（重生走的是每幀一次的 `main.ts`
   * 路徑，不在子步裡），所以「容量 = 架數」是一個**上界**而不是猜測。
   *
   * 【重新配置只發生在 `add()`】那是場景組裝期，不是熱路徑。代價是持有
   * `world.killEvents` 參考的人必須在所有 `add()` 之後才取 —— `main.ts`
   * 每幀重新讀屬性，不快取。
   */
  killEvents: KillEvents = createKills(0)
```

在 `add()` 方法把 combatant push 進 `this.combatants` 之後加：

```ts
    // 見 killEvents 的註解：容量跟著架數走，溢位於是在結構上不可能
    if (this.killEvents.capacity < this.combatants.length) {
      this.killEvents = createKills(this.combatants.length)
    }
```

在 `destroy()`（約 `World.ts:466`）的 `c.alive = false` **之前**加：

```ts
    // 【推事件而不是讓渲染層比對 alive】見 kills.ts 的註解
    const p = c.aircraft.state.position
    const v = c.aircraft.state.velocity
    pushKill(this.killEvents, p.x, p.y, p.z, v.x, v.y, v.z, c.index)
```

**注意**：這一行要放在 `if (c.respawnOnDestroy) { this.respawn(c); return }` **之後** —— 自動重生的靶機（M2 用）不是一次擊墜，不該生爆炸。

- [ ] **Step 6: 為 `World` 的佈線寫測試**

在 `test/unit/kills.test.ts` 末尾追加：

```ts
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { Vector3 } from 'three'
import type { Command, Controller } from '../../src/control/Controller'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.7
    out.firing = false
  }
}

function oneWorld(n: number): World {
  const w = new World()
  for (let i = 0; i < n; i++) {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(i * 100, 4000, 0)
    a.prevPosition.copy(a.state.position)
    w.add(a, new Idle(), 'blue', a.state.position.clone(), 4000, 200)
  }
  return w
}

describe('World 的擊墜事件', () => {
  it('容量跟著參戰架數長', () => {
    const w = oneWorld(5)
    expect(w.killEvents.capacity).toBe(5)
  })

  it('destroy 推一筆，帶著位置、速度與索引', () => {
    const w = oneWorld(2)
    const c = w.combatants[1]!
    c.aircraft.state.velocity.set(120, -3, -40)
    w.destroy(c)
    expect(w.killEvents.count).toBe(1)
    const d = w.killEvents.data
    expect(d[0]).toBeCloseTo(100, 4)
    expect(d[3]).toBeCloseTo(120, 4)
    expect(d[4]).toBeCloseTo(-3, 4)
    expect(d[5]).toBeCloseTo(-40, 4)
    expect(d[6]).toBe(1)
  })

  it('自動重生的靶機不算擊墜', () => {
    // 【為什麼】respawnOnDestroy 是 M2 靶機用的：被打爆就滿血回到出生點。
    // 那不是一次擊墜，不該生爆炸與殘骸。
    const w = oneWorld(1)
    const c = w.combatants[0]!
    c.respawnOnDestroy = true
    w.destroy(c)
    expect(w.killEvents.count).toBe(0)
    expect(c.alive).toBe(true)
  })

  it('全員陣亡也不溢位', () => {
    const w = oneWorld(40)
    for (const c of w.combatants) w.destroy(c)
    expect(w.killEvents.count).toBe(40)
    expect(w.killEvents.dropped).toBe(0)
  })
})
```

- [ ] **Step 7: 跑測試與型別檢查**

Run: `npx vitest run test/unit/kills.test.ts && npm run build`
Expected: 9 條全過、build 乾淨

- [ ] **Step 8: 確認 `World` 沒有 import 到 `render/`**

Run: `grep -rn "from '\.\./render\|from './render" src/world/`
Expected: 無輸出（spec §14.1.2）

- [ ] **Step 9: Commit**

```bash
git add src/world/kills.ts src/world/World.ts test/unit/kills.test.ts
git commit -m "feat: 擊墜事件緩衝 —— World.destroy 推事件，容量跟著參戰架數"
```

---

## Task 2: 旋轉後 OBB 的最低點

**Files:**
- Modify: `src/world/hit.ts`（在 `boundingRadius` 之後，約 `hit.ts:144`）
- Test: `test/unit/lowest-point.test.ts`

**Interfaces:**
- Consumes: `HitBox { part, center: Vector3, half: Vector3 }`（`hit.ts:27`，既有）
- Produces: `lowestPoint(box: HitBox, q: Quaternion, pos: Vector3, out: Vector3): number`
  —— 回傳最低的世界 Y，並把**最低角點的世界座標**寫進 `out`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/lowest-point.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { makeHitBox, lowestPoint } from '../../src/world/hit'

/** 暴力解：把八個角點都轉過去，取最低的那個。 */
function brute(
  box: ReturnType<typeof makeHitBox>, q: Quaternion, pos: Vector3,
): { y: number; p: Vector3 } {
  let best = Infinity
  const bp = new Vector3()
  const t = new Vector3()
  for (let s = 0; s < 8; s++) {
    t.set(
      box.center.x + (s & 1 ? box.half.x : -box.half.x),
      box.center.y + (s & 2 ? box.half.y : -box.half.y),
      box.center.z + (s & 4 ? box.half.z : -box.half.z),
    ).applyQuaternion(q).add(pos)
    if (t.y < best) {
      best = t.y
      bp.copy(t)
    }
  }
  return { y: best, p: bp }
}

/** 由索引決定的可重現「隨機」四元數 —— 不用 Math.random()，失敗可重放。 */
function poseOf(i: number): Quaternion {
  const a = (i * 0.7853981633974483) % (Math.PI * 2)
  const b = (i * 1.1071487177940904) % (Math.PI * 2)
  const c = (i * 0.4636476090008061) % (Math.PI * 2)
  return new Quaternion()
    .setFromAxisAngle(new Vector3(1, 0, 0), a)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), c))
}

const WING = makeHitBox('wingRight', [0.44, -0.86, -0.97], [5.65, -0.08, 2.06])

describe('lowestPoint —— 旋轉後 OBB 的最低點（M8 spec §9.1）', () => {
  it('無旋轉時就是盒底', () => {
    const out = new Vector3()
    const y = lowestPoint(WING, new Quaternion(), new Vector3(0, 100, 0), out)
    expect(y).toBeCloseTo(100 - 0.86, 6)
    expect(out.y).toBeCloseTo(y, 9)
  })

  it('與暴力列舉八個角點一致 —— 1000 個姿態', () => {
    // 【為什麼要對照暴力解】解析式是這份計畫裡唯一一段「算錯了只會看起來
    // 有點怪」的數學：翼尖入水的時機差半個翼展，在畫面上只是「水花好像
    // 晚了一點」，不會壞給你看。
    const out = new Vector3()
    const pos = new Vector3()
    for (let i = 1; i <= 1000; i++) {
      const q = poseOf(i)
      pos.set(i % 37, 200 + (i % 11), -(i % 23))
      const y = lowestPoint(WING, q, pos, out)
      const b = brute(WING, q, pos)
      expect(y).toBeCloseTo(b.y, 6)
      expect(out.x).toBeCloseTo(b.p.x, 6)
      expect(out.y).toBeCloseTo(b.p.y, 6)
      expect(out.z).toBeCloseTo(b.p.z, 6)
    }
  })

  it('翻滾中翼尖比機身重心低 —— 這就是要它的理由', () => {
    // 繞 Z 轉 90°：右翼盒被轉到下方
    const out = new Vector3()
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    const y = lowestPoint(WING, q, new Vector3(0, 0, 0), out)
    // 翼展 5.65 m —— 最低點應該比原點低好幾公尺，不是 0.86
    expect(y).toBeLessThan(-3)
  })

  it('out 寫的是最低角點本身，不是盒心', () => {
    const out = new Vector3()
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.6)
    lowestPoint(WING, q, new Vector3(10, 50, -20), out)
    const b = brute(WING, q, new Vector3(10, 50, -20))
    expect(out.distanceTo(b.p)).toBeLessThan(1e-6)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/lowest-point.test.ts`
Expected: FAIL —— `lowestPoint is not a function`

- [ ] **Step 3: 實作**

`src/world/hit.ts` 的 import 要加上 `Quaternion`（檔頭現在是 `import { Vector3 } from 'three'` 之類，改成同時 import `Quaternion`）。在 `boundingRadius` 之後加：

```ts
/** `lowestPoint` 的暫存。模組私有、每次呼叫重用（熱路徑之外，但仍不配置）。 */
const LOW = new Vector3()

/**
 * 旋轉後的 OBB 在世界 Y 上的最低點。回傳最低的世界 Y，`out` 收最低角點的
 * 世界座標。
 *
 * 【為什麼不是列舉八個角點】列舉要八次四元數旋轉；解析式只要旋轉矩陣的
 * **第二列**（世界 Y 在機體三軸上的投影）：
 *
 *     minY = pos.y + (R10·cx + R11·cy + R12·cz) − (|R10|·hx + |R11|·hy + |R12|·hz)
 *
 * 前半是盒心的世界高度，後半是半尺寸在世界 Y 上能往下延伸的最大量。最低
 * 角點各軸取 `−sign(R1j)`。六個盒一具殘骸每幀 18 次乘法 —— 可以忽略。
 *
 * 【為什麼殘骸需要它】殘骸是**翻滾**的，翼尖會比重心早很多碰到水。用重心
 * 判定會讓水花晚一整個翼展才出現（M8 spec §9.1）。
 */
export function lowestPoint(
  box: HitBox, q: Quaternion, pos: Vector3, out: Vector3,
): number {
  const x = q.x
  const y = q.y
  const z = q.z
  const w = q.w
  // 旋轉矩陣的第二列
  const r0 = 2 * (x * y + w * z)
  const r1 = 1 - 2 * (x * x + z * z)
  const r2 = 2 * (y * z - w * x)

  const h = box.half
  const c = box.center
  // 各軸取讓世界 Y 最小的那一側
  const sx = r0 > 0 ? -h.x : h.x
  const sy = r1 > 0 ? -h.y : h.y
  const sz = r2 > 0 ? -h.z : h.z

  LOW.set(c.x + sx, c.y + sy, c.z + sz).applyQuaternion(q).add(pos)
  out.copy(LOW)
  return LOW.y
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/lowest-point.test.ts && npm run build`
Expected: 4 條全過、build 乾淨

- [ ] **Step 5: 確認它真的會抓錯**

把 `const sy = r1 > 0 ? -h.y : h.y` 暫時改成 `const sy = -h.y`（忽略符號），跑測試。

Run: `npx vitest run test/unit/lowest-point.test.ts`
Expected: 「與暴力列舉八個角點一致」**變紅**。確認之後改回來再跑一次確認變綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/hit.ts test/unit/lowest-point.test.ts
git commit -m "feat: lowestPoint —— 旋轉後 OBB 的最低點，殘骸入水判定用"
```

---

## Task 3: 翻滾姿態

**Files:**
- Create: `src/render/tumble.ts`
- Test: `test/unit/tumble.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `tumble(rx: number, ry: number, rz: number, t: number, base: Quaternion, out: Quaternion): void`
  —— `rx/ry/rz` 是三軸角速度（rad/s），`t` 是年齡（s），`base` 是初始姿態

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/tumble.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { tumble } from '../../src/render/tumble'

describe('tumble —— 年齡決定姿態的純函數（M8 spec §7、§8.2）', () => {
  it('t = 0 就是初始姿態', () => {
    const base = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2)
    const out = new Quaternion()
    tumble(2, -3, 1.5, 0, base, out)
    expect(out.angleTo(base)).toBeCloseTo(0, 9)
  })

  it('恆為單位四元數 —— 積分漂移在這裡結構上不存在', () => {
    // 【為什麼用「年齡的函數」而不是每幀累加】每幀 q += 0.5·ω⊗q·dt 會漂移，
    // 要定期正規化；而姿態寫成 t 的純函數之後，第 10000 幀與第 1 幀一樣精確，
    // 而且測得起來。
    const base = new Quaternion()
    const out = new Quaternion()
    for (let i = 0; i <= 600; i++) {
      tumble(2.1, -1.3, 0.7, i * 0.1, base, out)
      expect(out.length()).toBeCloseTo(1, 9)
    }
  })

  it('角速度為零時姿態不動', () => {
    const base = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
    const out = new Quaternion()
    tumble(0, 0, 0, 12.5, base, out)
    expect(out.angleTo(base)).toBeCloseTo(0, 9)
  })

  it('單軸時就是繞該軸的等速旋轉', () => {
    const out = new Quaternion()
    tumble(0, Math.PI / 2, 0, 1, new Quaternion(), out)
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    expect(out.angleTo(expected)).toBeCloseTo(0, 6)
  })

  it('三軸同時轉時，短時間內的姿態變化率接近角速度的模', () => {
    // 【為什麼只測「接近」】三個軸的旋轉不可交換，合成的瞬時角速度不會
    // 恰好等於三者的向量和。但在小角度下兩者一致，而這就是「轉得多快」
    // 這個參數真正的意思。
    const out = new Quaternion()
    const dt = 0.001
    tumble(1, 2, 2, dt, new Quaternion(), out)
    // |ω| = 3 rad/s → dt 之後轉過約 0.003 rad
    expect(out.angleTo(new Quaternion())).toBeCloseTo(3 * dt, 4)
  })

  it('不同的角速度給出不同的姿態 —— 每一具殘骸翻得不一樣', () => {
    const a = new Quaternion()
    const b = new Quaternion()
    tumble(2, -1, 0.5, 1.7, new Quaternion(), a)
    tumble(-1, 2, 1.5, 1.7, new Quaternion(), b)
    expect(a.angleTo(b)).toBeGreaterThan(0.5)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/tumble.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/tumble`

- [ ] **Step 3: 實作 `src/render/tumble.ts`**

```ts
import { Quaternion, Vector3 } from 'three'

const AX = new Vector3(1, 0, 0)
const AY = new Vector3(0, 1, 0)
const AZ = new Vector3(0, 0, 1)
/** 模組私有的暫存。熱路徑（每幀每片零件一次）：不配置。 */
const QX = new Quaternion()
const QY = new Quaternion()
const QZ = new Quaternion()

/**
 * 三軸等速翻滾：年齡 → 姿態。零件與殘骸共用。
 *
 * 【為什麼是年齡的純函數而不是每幀積分】每幀 `q += 0.5·ω⊗q·dt` 會累積誤差
 * 而漂離單位長度，要定期正規化；寫成 `t` 的函數之後第 10,000 幀與第 1 幀
 * 一樣精確，**而且測得起來**（繪製迴圈進不了單元測試，純函數進得去 ——
 * 與 `splashScale`、`edgeIndicatorPosition` 是同一個做法）。
 *
 * 【為什麼是三軸而不是單一隨機軸】繞單一固定軸轉讀起來是「機械式旋轉」，
 * 而失控的機體是**翻滾**的。三個速率不同的軸疊起來就沒有週期性
 * （M8 spec §14.2.14）。
 *
 * @param rx,ry,rz 三軸角速度，rad/s
 * @param t        年齡，s
 * @param base     初始姿態（陣亡那一刻的機體姿態）
 */
export function tumble(
  rx: number, ry: number, rz: number, t: number,
  base: Quaternion, out: Quaternion,
): void {
  QX.setFromAxisAngle(AX, rx * t)
  QY.setFromAxisAngle(AY, ry * t)
  QZ.setFromAxisAngle(AZ, rz * t)
  out.copy(QZ).multiply(QY).multiply(QX).multiply(base)
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/tumble.test.ts && npm run build`
Expected: 6 條全過、build 乾淨

- [ ] **Step 5: Commit**

```bash
git add src/render/tumble.ts test/unit/tumble.test.ts
git commit -m "feat: tumble —— 年齡決定姿態的三軸翻滾純函數"
```

---

## Task 4: 廣告板粒子池

**Files:**
- Create: `src/render/particles.ts`
- Test: `test/unit/particles.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `interface ParticleConfig { capacity: number; blending: Blending; life: number; sizeFrom: number; sizeTo: number; gravity: number; drag: number; alphaFrom: number; color(t: number, out: Color): void }`
  - `interface Particles { object: InstancedMesh; readonly live: number; emit(x, y, z, vx, vy, vz): void; step(dt: number): void; dispose(): void }`
  - `createParticles(cfg: ParticleConfig): Particles`
  - `particleSize(age, life, from, to): number`
  - `particleAlpha(age, life, alphaFrom): number`
  - `injectBillboard(shader: { vertexShader: string; fragmentShader: string }): void`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/particles.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  InstancedMesh, Matrix4, NormalBlending, Quaternion, ShaderLib, Vector3,
} from 'three'
import {
  createParticles, injectBillboard, particleAlpha, particleSize,
  type ParticleConfig,
} from '../../src/render/particles'

function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

const CFG: ParticleConfig = {
  capacity: 8,
  blending: NormalBlending,
  life: 1,
  sizeFrom: 2,
  sizeTo: 6,
  gravity: 0,
  drag: 0,
  alphaFrom: 0.5,
  color: (_t, out) => { out.setRGB(0.1, 0.1, 0.1) },
}

describe('particleSize / particleAlpha', () => {
  it('壽命之外都是 0', () => {
    expect(particleSize(-0.1, 1, 2, 6)).toBe(0)
    expect(particleSize(1, 1, 2, 6)).toBe(0)
    expect(particleAlpha(-0.1, 1, 0.5)).toBe(0)
    expect(particleAlpha(1, 1, 0.5)).toBe(0)
  })

  it('尺寸由 from 線性長到 to', () => {
    expect(particleSize(0, 1, 2, 6)).toBeCloseTo(2, 9)
    expect(particleSize(0.5, 1, 2, 6)).toBeCloseTo(4, 9)
  })

  it('alpha 由 alphaFrom 線性淡到 0', () => {
    expect(particleAlpha(0, 1, 0.5)).toBeCloseTo(0.5, 9)
    expect(particleAlpha(0.5, 1, 0.5)).toBeCloseTo(0.25, 9)
  })
})

describe('injectBillboard —— 著色器注入（M8 spec §4.3）', () => {
  it('對 three 真正的 basic 著色器有作用', () => {
    // 【為什麼要對照 ShaderLib 而不是自己編一段假的】String.replace 找不到
    // 目標時**不報錯，只是什麼都不做** —— three 改版重新命名 chunk 的話，
    // 廣告板會靜靜地退化成一面固定朝向的方片，而且沒有任何東西會失敗。
    // 這條測試是唯一擋得住那件事的東西。
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    }
    const beforeV = shader.vertexShader
    const beforeF = shader.fragmentShader
    injectBillboard(shader)
    expect(shader.vertexShader).not.toBe(beforeV)
    expect(shader.fragmentShader).not.toBe(beforeF)
    expect(shader.vertexShader).toContain('attribute float aAlpha')
    expect(shader.vertexShader).toContain('instanceMatrix')
    expect(shader.fragmentShader).toContain('vAlpha')
  })

  it('注入之後不再留下原本的 project_vertex include', () => {
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    }
    injectBillboard(shader)
    expect(shader.vertexShader).not.toContain('#include <project_vertex>')
  })
})

describe('createParticles', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const p = createParticles(CFG)
    expect(p.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    p.object.traverse(() => objects++)
    expect(objects).toBe(1)
    expect(p.object.count).toBe(8)
    p.dispose()
  })

  it('建立時全部是死的、縮放為 0', () => {
    const p = createParticles(CFG)
    expect(p.live).toBe(0)
    for (let i = 0; i < 8; i++) expect(instance(p.object, i).scale.x).toBe(0)
    p.dispose()
  })

  it('幾何有 aAlpha 這個逐實例屬性', () => {
    const p = createParticles(CFG)
    const a = p.object.geometry.getAttribute('aAlpha')
    expect(a).toBeDefined()
    expect(a.count).toBe(8)
    p.dispose()
  })

  it('發射一顆就活一顆，位置與初速照傳入值', () => {
    const p = createParticles(CFG)
    p.emit(10, 20, 30, 1, 0, 0)
    p.step(0.5)
    expect(p.live).toBe(1)
    const inst = instance(p.object, 0)
    expect(inst.position.x).toBeCloseTo(10.5, 5)
    expect(inst.position.y).toBeCloseTo(20, 5)
    expect(inst.scale.x).toBeCloseTo(4, 5)
    p.dispose()
  })

  it('恆為單位旋轉、XYZ 同縮放 —— 著色器靠第 0 欄的長度取尺寸', () => {
    // 【為什麼】廣告板是在視圖空間攤平的，實例矩陣只帶位置與尺寸。寫旋轉
    // 或非等向縮放進去，著色器取到的 length(instanceMatrix[0].xyz) 就不再
    // 是直徑。
    const p = createParticles(CFG)
    p.emit(0, 0, 0, 0, 0, 0)
    p.step(0.3)
    const inst = instance(p.object, 0)
    expect(inst.quaternion.angleTo(new Quaternion())).toBeCloseTo(0, 9)
    expect(inst.scale.x).toBeCloseTo(inst.scale.y, 9)
    expect(inst.scale.y).toBeCloseTo(inst.scale.z, 9)
    p.dispose()
  })

  it('重力與阻尼：終端速度收斂到 gravity / drag', () => {
    const p = createParticles({ ...CFG, life: 100, capacity: 1, gravity: -20, drag: 4 })
    p.emit(0, 0, 0, 0, 0, 0)
    for (let i = 0; i < 2000; i++) p.step(0.01)
    const before = instance(p.object, 0).position.y
    p.step(0.01)
    const after = instance(p.object, 0).position.y
    // 收斂之後每一步下降 v_term × dt = (20 / 4) × 0.01 = 0.05
    expect(before - after).toBeCloseTo(0.05, 3)
    p.dispose()
  })

  it('壽命結束縮成 0，而且格子可以重用', () => {
    const p = createParticles(CFG)
    p.emit(0, 0, 0, 0, 0, 0)
    p.step(CFG.life + 0.01)
    expect(instance(p.object, 0).scale.x).toBe(0)
    expect(p.live).toBe(0)
    p.emit(5, 5, 5, 0, 0, 0)
    p.step(0.1)
    expect(p.live).toBe(1)
    p.dispose()
  })

  it('池子滿了覆蓋最舊的', () => {
    const p = createParticles({ ...CFG, capacity: 2 })
    for (let k = 0; k < 5; k++) p.emit(k, 0, 0, 0, 0, 0)
    p.step(0.1)
    expect(p.live).toBe(2)
    p.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const p = createParticles({ ...CFG, gravity: -9.81, drag: 1.5 })
    p.emit(0, 0, 0, 3, 4, 5)
    for (let i = 0; i < 300; i++) p.step(1 / 60)
    const inst = instance(p.object, 0)
    expect(Number.isFinite(inst.position.length())).toBe(true)
    expect(Number.isFinite(inst.scale.length())).toBe(true)
    p.dispose()
  })

  it('顏色曲線每幀被呼叫，t 是年齡佔壽命的比例', () => {
    const seen: number[] = []
    const p = createParticles({
      ...CFG, capacity: 1,
      color: (t, out) => { seen.push(t); out.setRGB(1, 1, 1) },
    })
    p.emit(0, 0, 0, 0, 0, 0)
    p.step(0.25)
    p.step(0.25)
    expect(seen[0]).toBeCloseTo(0.25, 6)
    expect(seen[1]).toBeCloseTo(0.5, 6)
    p.dispose()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/particles.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/particles`

- [ ] **Step 3: 實作 `src/render/particles.ts`**

```ts
import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3,
  type Blending,
} from 'three'

export interface ParticleConfig {
  capacity: number
  /** `AdditiveBlending`（火球）或 `NormalBlending`（黑煙、噴濺） */
  blending: Blending
  /** 壽命，s */
  life: number
  /** 出生時的**直徑**，m。著色器把四邊形裁成內接圓，所以縮放值就是直徑 */
  sizeFrom: number
  /** 死亡時的直徑，m */
  sizeTo: number
  /** 加速度，m/s²。負值下墜、正值上浮 */
  gravity: number
  /** 指數阻尼，s⁻¹。終端速度是 `gravity / drag` */
  drag: number
  /** 出生時的不透明度，線性淡到 0 */
  alphaFrom: number
  /**
   * 顏色曲線。`t` 是年齡佔壽命的比例（0..1）。
   *
   * 【為什麼是回呼而不是兩個顏色常數】火球要走白 → 橘 → 暗紅三段，兩點
   * 線性內插到中段會變成脫色的土黃。煙與噴濺則是常數色 —— 一個回呼同時
   * 容得下這兩種需求，而且各自的曲線在各自的模組裡被測試。
   */
  color(t: number, out: Color): void
}

export interface Particles {
  object: InstancedMesh
  /** 目前還活著幾顆。測試與 telemetry 用 */
  readonly live: number
  /** 發射一顆。熱路徑：不配置 */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number): void
  /** 積分一幀並寫入實例矩陣。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number): void
  dispose(): void
}

/** 年齡 → 直徑。線性膨脹；壽命之外是 0。 */
export function particleSize(age: number, life: number, from: number, to: number): number {
  if (age < 0 || age >= life) return 0
  return from + (to - from) * (age / life)
}

/** 年齡 → 不透明度。線性淡出；壽命之外是 0。 */
export function particleAlpha(age: number, life: number, alphaFrom: number): number {
  if (age < 0 || age >= life) return 0
  return alphaFrom * (1 - age / life)
}

/**
 * 把 three 的 `MeshBasicMaterial` 著色器改造成**廣告板 + 逐實例 alpha +
 * 軟邊圓形**。
 *
 * 【為什麼非得動著色器】`InstancedMesh` 的逐實例顏色只有 RGB 沒有 alpha。
 * M7 兩次繞開這條限制（槍焰靠加法混合淡到黑、水柱靠幾何曲線），黑煙繞不
 * 開：加法混合對黑色無效（`dst + 0` 等於隱形），往黑淡在亮天空上方向是反
 * 的，而一團 9 m 的深色物體直接消失非常明顯（M8 spec §4.3）。
 *
 * 【為什麼不用貼圖】專案目前一張貼圖都沒有。片段端一行 `smoothstep` 就
 * 得到軟邊圓形，而且不必管資產管線。
 *
 * 【為什麼抽成獨立的具名函式】`String.replace` 找不到目標時**不報錯**。
 * 抽出來之後可以拿 three 真正的 `ShaderLib.basic` 去斷言注入確實發生了 ——
 * 否則 three 改版重新命名 chunk，廣告板會靜靜地退化而沒有任何東西失敗。
 */
export function injectBillboard(
  shader: { vertexShader: string; fragmentShader: string },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       varying float vAlpha;
       varying vec2 vOffset;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       vOffset = position.xy;
       // 【廣告板】只取實例矩陣的平移與縮放，在視圖空間把四邊形攤平 ——
       // 於是它永遠正對相機，不論從哪個角度看都是一團。
       vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float instScale = length(instanceMatrix[0].xyz);
       mvPosition.xy += position.xy * instScale;
       gl_Position = projectionMatrix * mvPosition;`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;
       varying vec2 vOffset;`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       // 軟邊圓形：四邊形的頂點在 [-0.5, 0.5]，所以半徑 0.5 是內接圓
       float rEdge = smoothstep(0.5, 0.25, length(vOffset));
       gl_FragColor.a *= vAlpha * rEdge;`,
    )
}

/** 模組私有的暫存。熱路徑：不配置。 */
const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 廣告板粒子池 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 火球、黑煙、噴濺各是它的一個實例。三者的幾何完全相同（一個面向相機的
 * 四邊形）、積分器完全相同、淡出曲線完全相同 —— 差別只有數值與混合模式。
 * 寫成三個長得幾乎一樣的檔案正是這個專案一再點名的**「只有一份會被修好」**
 * 的危險（M8 spec §4.1）。
 *
 * 【與 M7 三個特效各自成檔的差別】那三個的**幾何本身**不同（十字／拉長的
 * 圓柱／收緊的圓柱），運動也不同 —— 共用會是硬湊。
 *
 * 【已知限制：實例之間不排序】`InstancedMesh` 無法逐實例排序，所以互相
 * 重疊的煙團會依繪製順序而非深度混合。因為每一團的顏色幾乎相同、而且
 * `depthWrite` 關著（彼此不遮擋），這個誤差在畫面上看不出來。煙與**飛機**
 * 之間仍然正確：`depthTest` 開著。
 */
export function createParticles(cfg: ParticleConfig): Particles {
  const { capacity, life } = cfg
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  // 【起始壽命設滿】等於「一出生就是死的」，不必另外一個 alive 陣列
  const age = new Float32Array(capacity).fill(life)
  let next = 0
  let live = 0

  // 四邊形的頂點落在 [-0.5, 0.5]，所以縮放值就是直徑（見著色器的 rEdge）
  const geometry = new PlaneGeometry(1, 1)
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  alphas.setUsage(DynamicDrawUsage)
  geometry.setAttribute('aAlpha', alphas)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: cfg.blending,
  })
  material.onBeforeCompile = injectBillboard

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點）——開著視錐剔除，相機一離開原點附近
  // 整批粒子會一起消失。與曳光彈、火花同一個坑。
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(0, 0, 0))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true

  return {
    object,
    get live() { return live },

    emit(x, y, z, evx, evy, evz): void {
      const i = next
      next = next + 1 >= capacity ? 0 : next + 1
      // 【滿了覆蓋最舊的】最舊的正好是最淡的那一顆，覆蓋看不出來；丟棄新的
      // 則會在最該看到爆炸的時候整批不見。與 sparks.ts 同一個取捨。
      if (age[i]! >= life) live++
      px[i] = x
      py[i] = y
      pz[i] = z
      vx[i] = evx
      vy[i] = evy
      vz[i] = evz
      age[i] = 0
    },

    step(dt: number): void {
      const damp = Math.exp(-cfg.drag * dt)
      const a = alphas.array as Float32Array
      live = 0
      for (let i = 0; i < capacity; i++) {
        const old = age[i]!
        if (old >= life) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          a[i] = 0
          continue
        }
        const na = old + dt
        age[i] = na
        if (na >= life) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          object.setColorAt(i, TINT.setRGB(0, 0, 0))
          a[i] = 0
          continue
        }
        live++

        const nvx = vx[i]! * damp
        const nvy = vy[i]! * damp + cfg.gravity * dt
        const nvz = vz[i]! * damp
        vx[i] = nvx
        vy[i] = nvy
        vz[i] = nvz
        const nx = px[i]! + nvx * dt
        const ny = py[i]! + nvy * dt
        const nz = pz[i]! + nvz * dt
        px[i] = nx
        py[i] = ny
        pz[i] = nz

        const s = particleSize(na, life, cfg.sizeFrom, cfg.sizeTo)
        POS.set(nx, ny, nz)
        // 【不寫旋轉】朝向由著色器在視圖空間決定；寫進矩陣會讓著色器取到的
        // length(instanceMatrix[0].xyz) 不再是直徑。
        SCALE.set(s, s, s)
        M.compose(POS, ROT.identity(), SCALE)
        object.setMatrixAt(i, M)

        cfg.color(na / life, TINT)
        object.setColorAt(i, TINT)
        a[i] = particleAlpha(na, life, cfg.alphaFrom)
      }
      object.instanceMatrix.needsUpdate = true
      alphas.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/particles.test.ts && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 5: 確認著色器測試真的會抓錯**

把 `injectBillboard` 裡的 `'#include <project_vertex>'` 暫時改成 `'#include <project_vertexX>'`，跑測試。

Run: `npx vitest run test/unit/particles.test.ts`
Expected: 「對 three 真正的 basic 著色器有作用」與「注入之後不再留下原本的 project_vertex include」**變紅**。確認之後改回來再跑一次確認變綠。

- [ ] **Step 6: Commit**

```bash
git add src/render/particles.ts test/unit/particles.test.ts
git commit -m "feat: 廣告板粒子池 —— 自訂著色器提供逐實例 alpha 與軟邊圓形"
```

---

## Task 5: 散射方向（並讓 `sparks.ts` 改用它）

**Files:**
- Create: `src/render/scatter.ts`
- Modify: `src/render/sparks.ts`（刪掉私有的 `hash01`，`sparkDirection` 改為委派）
- Test: `test/unit/scatter.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `hash01(i: number): number`
  - `coneDirection(ax, ay, az, cone: number, index: number, out: Vector3): void`

**為什麼要動 M7 的程式碼**：火球（等向）、零件（沿飛行方向的錐）、噴濺（繞 +Y 的錐）三者要的都是「在某個軸周圍的錐內取一個由索引決定的方向」，而 `sparks.ts:92` 的 `sparkDirection` 已經是那件事，只是把半角寫死成 `SPARK_CONE`。再抄三份就是這個專案一再點名的「只有一份會被修好」。`sparks.ts` 既有的測試會保護這次搬移。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/scatter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { coneDirection, hash01 } from '../../src/render/scatter'

describe('hash01', () => {
  it('恆在 [0, 1)', () => {
    for (let i = -50; i < 5000; i++) {
      const v = hash01(i)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('同一個索引恆得同一個值 —— 這是不用 Math.random() 的全部理由', () => {
    for (let i = 0; i < 100; i++) expect(hash01(i)).toBe(hash01(i))
  })

  it('相鄰索引不相關 —— 不會整批粒子往同一邊噴', () => {
    let sum = 0
    for (let i = 0; i < 1000; i++) sum += hash01(i)
    // 均勻分布的平均應該接近 0.5
    expect(sum / 1000).toBeGreaterThan(0.45)
    expect(sum / 1000).toBeLessThan(0.55)
  })
})

describe('coneDirection', () => {
  const out = new Vector3()

  it('恆為單位向量', () => {
    for (let i = 0; i < 500; i++) {
      coneDirection(0, 1, 0, 0.6, i, out)
      expect(out.length()).toBeCloseTo(1, 6)
    }
  })

  it('恆落在指定的半角之內', () => {
    const cone = 35 * (Math.PI / 180)
    const axis = new Vector3(0.3, -0.5, 0.81).normalize()
    for (let i = 0; i < 500; i++) {
      coneDirection(axis.x, axis.y, axis.z, cone, i, out)
      expect(out.dot(axis)).toBeGreaterThanOrEqual(Math.cos(cone) - 1e-6)
    }
  })

  it('半角 π 就是等向 —— 火球用這個', () => {
    let minDot = 1
    for (let i = 0; i < 2000; i++) {
      coneDirection(0, 1, 0, Math.PI, i, out)
      minDot = Math.min(minDot, out.y)
    }
    // 等向的話一定有粒子往正下方噴
    expect(minDot).toBeLessThan(-0.9)
  })

  it('零向量的軸不會產生 NaN', () => {
    // 【為什麼要防】NaN 一旦進入實例矩陣，整批粒子會靜靜地消失而且完全
    // 不報錯。與 sparks.ts:97 同一個理由。
    coneDirection(0, 0, 0, 0.5, 3, out)
    expect(Number.isFinite(out.length())).toBe(true)
    expect(out.length()).toBeCloseTo(1, 6)
  })

  it('同一個索引恆得同一個方向', () => {
    const a = new Vector3()
    const b = new Vector3()
    coneDirection(0, 1, 0, 0.5, 42, a)
    coneDirection(0, 1, 0, 0.5, 42, b)
    expect(a.distanceTo(b)).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/scatter.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/scatter`

- [ ] **Step 3: 建立 `src/render/scatter.ts`**

把 `sparks.ts` 的 `hash01`（第 75 行起）與 `sparkDirection`（第 92 行起）的內容搬過來，半角改成參數：

```ts
import { Vector3 } from 'three'

/**
 * 32 位元整數雜湊 → [0, 1)。
 *
 * 【為什麼不用 `Math.random()`】與 `battle/setup.ts` 的 `altitudeOffset`
 * 避開亂數同一個理由：亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉可
 * 測試性。用索引的雜湊之後 `coneDirection` 是純函數，「恆在錐內」這一條
 * 才測得起來。
 */
export function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const AXIS = new Vector3()
const TANGENT = new Vector3()
const BITANGENT = new Vector3()

/**
 * 在軸周圍 `cone` 半角的圓錐內取一個方向，**由 `index` 決定**。
 *
 * `cone = Math.PI` 就是等向（整個球面），火球用它。
 *
 * 【為什麼是共用的而不是每個特效各抄一份】火花（法線錐）、火球（等向）、
 * 零件（沿飛行方向的錐）、噴濺（繞世界 +Y 的錐）要的都是同一件事，只有
 * 半角與軸不同。四份長得一樣的副本就是只有一份會被修好的那種危險。
 *
 * 熱路徑之外（每次事件十幾次），但仍然不配置。
 */
export function coneDirection(
  ax: number, ay: number, az: number, cone: number, index: number, out: Vector3,
): void {
  AXIS.set(ax, ay, az)
  const len = AXIS.length()
  // 【零向量的防護】NaN 一旦進入實例矩陣，整批粒子會靜靜地消失而且完全
  // 不報錯（與 assess.ts 的防護同一個理由）。
  if (len < 1e-6) AXIS.set(0, 1, 0)
  else AXIS.divideScalar(len)

  // 與 AXIS 最不平行的座標軸，拿來造切線
  const bx = Math.abs(AXIS.x)
  const by = Math.abs(AXIS.y)
  const bz = Math.abs(AXIS.z)
  if (bx <= by && bx <= bz) TANGENT.set(1, 0, 0)
  else if (by <= bz) TANGENT.set(0, 1, 0)
  else TANGENT.set(0, 0, 1)
  TANGENT.cross(AXIS).normalize()
  BITANGENT.copy(AXIS).cross(TANGENT)

  const phi = hash01(index) * Math.PI * 2
  const cosMax = Math.cos(cone)
  // 均勻取在 [cosMax, 1]：立體角上均勻，不會擠在錐心
  const cosT = cosMax + (1 - cosMax) * hash01(index * 2 + 1)
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))

  out.copy(AXIS).multiplyScalar(cosT)
    .addScaledVector(TANGENT, Math.cos(phi) * sinT)
    .addScaledVector(BITANGENT, Math.sin(phi) * sinT)
  const l = out.length()
  if (l > 1e-9) out.divideScalar(l)
  else out.copy(AXIS)
}
```

- [ ] **Step 4: 讓 `sparks.ts` 改用它**

在 `src/render/sparks.ts`：

1. 加 `import { coneDirection } from './scatter'`
2. **刪掉**私有的 `hash01`（第 75–81 行）與模組私有的 `AXIS` / `TANGENT` / `BITANGENT`（第 83–85 行）
3. `sparkDirection` 的整個函式體換成一行委派：

```ts
/**
 * 在法線周圍 `SPARK_CONE` 的錐內取一個方向，**由 `index` 決定**。
 *
 * 【為什麼還留著這個包裝】它把「火花的半角是 SPARK_CONE」這件事釘在火花
 * 自己的模組裡，呼叫端不必知道那個常數。實作在 `scatter.ts`，四個特效共用。
 */
export function sparkDirection(
  nx: number, ny: number, nz: number, index: number, out: Vector3,
): void {
  coneDirection(nx, ny, nz, SPARK_CONE, index, out)
}
```

- [ ] **Step 5: 跑全部測試 —— M7 既有的火花測試就是這次搬移的保護網**

Run: `npx vitest run test/unit/scatter.test.ts test/unit/sparks.test.ts && npm run build`
Expected: 全過。**若 `sparks.test.ts` 有任何一條變紅，表示搬移改變了行為，必須查清楚而不是改測試。**

- [ ] **Step 6: 跑完整套件確認沒有別的東西依賴被刪掉的東西**

Run: `npx vitest run && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 7: Commit**

```bash
git add src/render/scatter.ts src/render/sparks.ts test/unit/scatter.test.ts
git commit -m "refactor: 抽出 scatter.ts 的 hash01 與 coneDirection，火花改為委派"
```

---

## Task 6: 火球

**Files:**
- Create: `src/render/fireball.ts`
- Test: `test/unit/fireball.test.ts`

**Interfaces:**
- Consumes: `createParticles`, `type Particles`（Task 4）；`coneDirection`（Task 5）；`KILL_STRIDE`, `type KillEvents`（Task 1）
- Produces:
  - 常數 `FIREBALL_COUNT = 12`、`FIREBALL_LIFE = 0.5`、`FIREBALL_SIZE_FROM = 3`、`FIREBALL_SIZE_TO = 8`、`FIREBALL_SPEED = 15`、`FIREBALL_INHERIT = 0.5`、`FIREBALL_DRAG = 4`、`FIREBALL_CAPACITY = 512`
  - `fireballColor(t: number, out: Color): void`
  - `createFireball(capacity?: number): Particles`
  - `emitFireball(pool: Particles, events: KillEvents): void`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/fireball.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createFireball, emitFireball, fireballColor,
  FIREBALL_COUNT, FIREBALL_INHERIT, FIREBALL_LIFE, FIREBALL_SIZE_FROM, FIREBALL_SPEED,
} from '../../src/render/fireball'
import { createKills, pushKill } from '../../src/world/kills'

function positionOf(mesh: InstancedMesh, i: number): Vector3 {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const p = new Vector3()
  m.decompose(p, new Quaternion(), new Vector3())
  return p
}

describe('fireballColor —— 白到橘到暗紅（M8 spec §5）', () => {
  const c = new Color()

  it('出生是近白的熱色', () => {
    fireballColor(0, c)
    expect(c.r).toBeCloseTo(1, 3)
    expect(c.g).toBeGreaterThan(0.9)
    expect(c.b).toBeGreaterThan(0.7)
  })

  it('中段是橘的 —— 紅遠大於綠、綠遠大於藍', () => {
    // 【為什麼不能用兩點內插】白 (1,.95,.8) 直接線性內插到暗紅 (.25,.02,0)，
    // 中點是 (.63,.49,.4) —— 那是脫色的土黃，不是火。
    fireballColor(0.5, c)
    expect(c.r).toBeGreaterThan(c.g * 1.8)
    expect(c.g).toBeGreaterThan(c.b * 3)
  })

  it('末段是暗紅', () => {
    fireballColor(1, c)
    expect(c.r).toBeLessThan(0.35)
    expect(c.g).toBeLessThan(0.1)
    expect(c.b).toBeLessThan(0.05)
  })

  it('亮度全程單調遞減 —— 火球只會變暗不會回頭', () => {
    let prev = 2
    for (let i = 0; i <= 20; i++) {
      fireballColor(i / 20, c)
      const lum = c.r + c.g + c.b
      expect(lum).toBeLessThanOrEqual(prev + 1e-9)
      prev = lum
    }
  })
})

describe('emitFireball', () => {
  it('一筆擊墜事件生 FIREBALL_COUNT 顆', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.01)
    expect(pool.live).toBe(FIREBALL_COUNT)
    pool.dispose()
  })

  it('兩筆事件生兩倍', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    pushKill(e, 500, 1000, 0, 0, 0, 0, 1)
    emitFireball(pool, e)
    pool.step(0.01)
    expect(pool.live).toBe(FIREBALL_COUNT * 2)
    pool.dispose()
  })

  it('生在事件的位置上', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 300, 1000, -700, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.001)
    for (let i = 0; i < FIREBALL_COUNT; i++) {
      // 0.001 s 內最多飛 FIREBALL_SPEED × 0.001 = 0.015 m
      expect(positionOf(pool.object, i).distanceTo(new Vector3(300, 1000, -700)))
        .toBeLessThan(0.05)
    }
    pool.dispose()
  })

  it('繼承一半的母機速度 —— 火球會跟著往前衝', () => {
    // 【為什麼要繼承】完全靜止的話，一架 150 m/s 的飛機在火球 0.5 s 的壽命
    // 內會飛出 75 m，畫面上是「爆炸發生在飛機後面」（M8 spec §5）。
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -200, 0)
    emitFireball(pool, e)
    pool.step(0.05)
    // 質心應該往 −Z 移動了約 0.5 × 200 × 0.05 = 5 m（阻尼會略減）
    let sumZ = 0
    for (let i = 0; i < FIREBALL_COUNT; i++) sumZ += positionOf(pool.object, i).z
    const meanZ = sumZ / FIREBALL_COUNT
    expect(meanZ).toBeLessThan(-3)
    expect(meanZ).toBeGreaterThan(-6)
    expect(FIREBALL_INHERIT).toBe(0.5)
    pool.dispose()
  })

  it('等向噴射 —— 有粒子往上也有往下', () => {
    const pool = createFireball(256)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.05)
    let hi = 0
    let lo = 0
    for (let i = 0; i < FIREBALL_COUNT; i++) {
      const y = positionOf(pool.object, i).y
      if (y > 1000.1) hi++
      if (y < 999.9) lo++
    }
    expect(hi).toBeGreaterThan(0)
    expect(lo).toBeGreaterThan(0)
    pool.dispose()
  })

  it('壽命內就死光 —— 不會有殘留的火球', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(FIREBALL_LIFE + 0.01)
    expect(pool.live).toBe(0)
    pool.dispose()
  })

  it('起始直徑是 FIREBALL_SIZE_FROM', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 0, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.0001)
    const m = new Matrix4()
    pool.object.getMatrixAt(0, m)
    const s = new Vector3()
    m.decompose(new Vector3(), new Quaternion(), s)
    expect(s.x).toBeCloseTo(FIREBALL_SIZE_FROM, 1)
    pool.dispose()
  })

  it('速度是 FIREBALL_SPEED —— 常數沒有被悄悄改掉', () => {
    expect(FIREBALL_SPEED).toBe(15)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/fireball.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/fireball`

- [ ] **Step 3: 實作 `src/render/fireball.ts`**

```ts
import { AdditiveBlending, Color, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { KILL_STRIDE, type KillEvents } from '../world/kills'

/** 一次擊墜噴幾顆。 */
export const FIREBALL_COUNT = 12

/** 壽命，s。60 fps 下 30 幀，看得完一次爆開。 */
export const FIREBALL_LIFE = 0.5

/** 出生直徑，m。 */
export const FIREBALL_SIZE_FROM = 3

/**
 * 死亡直徑，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`）。8 m 的
 * 火球在 1 km 上是 13.5 px，而空戰交戰距離通常在 500 m 內（約 27 px）——
 * **因此不需要距離剔除**（M8 spec §5）。
 */
export const FIREBALL_SIZE_TO = 8

/** 向外噴的初速，m/s。 */
export const FIREBALL_SPEED = 15

/**
 * 繼承多少比例的母機速度。
 *
 * 【為什麼不是 0】火球若完全靜止，一架 150 m/s 的飛機在 0.5 s 的壽命內會
 * 飛出 75 m —— 畫面上是「爆炸發生在飛機後面」。真實的火球會先隨殘骸往前
 * 衝，再被空氣迅速煞住（M8 spec §5）。
 */
export const FIREBALL_INHERIT = 0.5

/** 指數阻尼，s⁻¹。時間常數 0.25 s，正好在壽命之內煞停。 */
export const FIREBALL_DRAG = 4

/** 池子大小。40 架 × 12 顆 = 480，512 有餘裕。 */
export const FIREBALL_CAPACITY = 512

/** 三個色標：白熱 → 橘 → 暗紅。 */
const HOT = { r: 1.0, g: 0.95, b: 0.80 }
const MID = { r: 1.0, g: 0.45, b: 0.05 }
const COLD = { r: 0.25, g: 0.02, b: 0.0 }

/**
 * 年齡比例 → 顏色。
 *
 * 【為什麼是三段而不是兩點內插】白 (1,.95,.8) 直接線性內插到暗紅
 * (.25,.02,0)，中點是 (.63,.49,.4) —— 那是脫色的土黃，不是火。火焰的色溫
 * 曲線本來就不是直線。
 *
 * 【淡出交給 alpha】加法混合下 `blendSrc` 是 `SrcAlphaFactor`，所以
 * `particleAlpha` 的線性淡出對加法混合一樣有效（M8 spec §5）。
 */
export function fireballColor(t: number, out: Color): void {
  if (t <= 0.5) {
    const k = t * 2
    out.setRGB(
      HOT.r + (MID.r - HOT.r) * k,
      HOT.g + (MID.g - HOT.g) * k,
      HOT.b + (MID.b - HOT.b) * k,
    )
    return
  }
  const k = (t - 0.5) * 2
  out.setRGB(
    MID.r + (COLD.r - MID.r) * k,
    MID.g + (COLD.g - MID.g) * k,
    MID.b + (COLD.b - MID.b) * k,
  )
}

export function createFireball(capacity: number = FIREBALL_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: AdditiveBlending,
    life: FIREBALL_LIFE,
    sizeFrom: FIREBALL_SIZE_FROM,
    sizeTo: FIREBALL_SIZE_TO,
    gravity: 0,
    drag: FIREBALL_DRAG,
    alphaFrom: 1,
    color: fireballColor,
  })
}

/** 模組私有的暫存。熱路徑：不配置。 */
const DIR = new Vector3()

/**
 * 依擊墜事件噴一團火球。
 *
 * **不做距離剔除**：見 `FIREBALL_SIZE_TO` 的推導 —— 8 m 在 1 km 上仍有
 * 13.5 px，而火球本來就該從遠處看得到（那是戰場資訊）。
 */
export function emitFireball(pool: Particles, events: KillEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * KILL_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    const ivx = d[o + 3]! * FIREBALL_INHERIT
    const ivy = d[o + 4]! * FIREBALL_INHERIT
    const ivz = d[o + 5]! * FIREBALL_INHERIT
    for (let k = 0; k < FIREBALL_COUNT; k++) {
      // 半角 π = 等向。軸取 +Y 只是為了給錐一個參考，等向下不影響結果
      coneDirection(0, 1, 0, Math.PI, e * FIREBALL_COUNT + k, DIR)
      pool.emit(
        x, y, z,
        ivx + DIR.x * FIREBALL_SPEED,
        ivy + DIR.y * FIREBALL_SPEED,
        ivz + DIR.z * FIREBALL_SPEED,
      )
    }
  }
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/fireball.test.ts && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 5: 確認「中段是橘的」真的會抓錯**

把 `fireballColor` 暫時改成單純的兩點內插（`out.lerpColors` 從 HOT 到 COLD），跑測試。

Run: `npx vitest run test/unit/fireball.test.ts`
Expected: 「中段是橘的」**變紅**。確認之後改回三段。

- [ ] **Step 6: Commit**

```bash
git add src/render/fireball.ts test/unit/fireball.test.ts
git commit -m "feat: 火球 —— 三段色溫曲線、繼承一半母機速度"
```

---

## Task 7: 黑煙

**Files:**
- Create: `src/render/smoke.ts`
- Test: `test/unit/smoke.test.ts`

**Interfaces:**
- Consumes: `createParticles`, `type Particles`（Task 4）；`IMPACT_STRIDE`, `type ImpactEvents`（既有 `src/world/events.ts`）
- Produces:
  - 常數 `SMOKE_LIFE = 2.5`、`SMOKE_SIZE_FROM = 2`、`SMOKE_SIZE_TO = 9`、`SMOKE_ALPHA = 0.55`、`SMOKE_RISE = 3`、`SMOKE_DRAG = 1.5`、`SMOKE_GRAVITY`、`WRECK_SMOKE_INTERVAL = 0.08`、`DEBRIS_SMOKE_INTERVAL = 0.3`、`DEBRIS_SMOKE_COUNT = 4`、`SMOKE_CAPACITY = 3072`
  - `smokeColor(t: number, out: Color): void`
  - `smokePuffs(timer: number, dt: number, interval: number): number`
  - `smokeTimer(timer: number, dt: number, interval: number): number`
  - `createSmoke(capacity?: number): Particles`
  - `emitSmoke(pool: Particles, events: ImpactEvents): void`

**為什麼用既有的 `ImpactEvents` 而不是新型別**：煙只需要「一個位置」。`ImpactEvents` 是 `x,y,z,nx,ny,nz`，法線欄位填 `0,1,0` 忽略即可。M7 spec §2.2 已經為「命中與入海共用一個型別」寫過同樣的理由 —— 為了省三個 float 再發明一個結構才是壞的。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/smoke.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSmoke, emitSmoke, smokeColor, smokePuffs, smokeTimer,
  DEBRIS_SMOKE_COUNT, DEBRIS_SMOKE_INTERVAL, SMOKE_ALPHA, SMOKE_DRAG,
  SMOKE_GRAVITY, SMOKE_LIFE, SMOKE_RISE, SMOKE_SIZE_FROM, SMOKE_SIZE_TO,
  WRECK_SMOKE_INTERVAL,
} from '../../src/render/smoke'
import { createImpacts, pushImpact } from '../../src/world/events'

function decompose(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const scale = new Vector3()
  m.decompose(position, new Quaternion(), scale)
  return { position, scale }
}

describe('smokePuffs / smokeTimer —— 發射器計時', () => {
  it('一幀不到一個間隔就不生', () => {
    expect(smokePuffs(0, 1 / 60, 0.08)).toBe(0)
    expect(smokeTimer(0, 1 / 60, 0.08)).toBeCloseTo(1 / 60, 9)
  })

  it('累積滿一個間隔就生一團，計時器留下餘數', () => {
    // 0.07 + 0.0167 = 0.0867 ≥ 0.08 → 生一團，餘 0.0067
    expect(smokePuffs(0.07, 1 / 60, 0.08)).toBe(1)
    expect(smokeTimer(0.07, 1 / 60, 0.08)).toBeCloseTo(0.0867 - 0.08, 4)
  })

  it('低幀率時一次補足，不會漏掉整段煙', () => {
    // 【為什麼要補】0.5 s 的長幀若只生一團，煙帶會出現一段 75 m 的空隙。
    expect(smokePuffs(0, 0.5, 0.08)).toBe(6)
  })

  it('間隔為 0 或負值時不生，也不會除以零', () => {
    expect(smokePuffs(0, 1, 0)).toBe(0)
    expect(smokeTimer(0, 1, 0)).toBe(0)
    expect(Number.isFinite(smokePuffs(0, 1, -1))).toBe(true)
  })

  it('殘骸比零件冒得密 —— 主體才是煙的來源', () => {
    expect(WRECK_SMOKE_INTERVAL).toBeLessThan(DEBRIS_SMOKE_INTERVAL)
  })
})

describe('smokeColor', () => {
  it('全程是深灰 —— 黑煙不變色，變的是 alpha', () => {
    const c = new Color()
    for (let i = 0; i <= 10; i++) {
      smokeColor(i / 10, c)
      expect(c.r).toBeLessThan(0.2)
      expect(c.r).toBeCloseTo(c.g, 6)
      expect(c.g).toBeCloseTo(c.b, 6)
    }
  })
})

describe('黑煙的參數（M8 spec §6）', () => {
  it('上浮寫成加速度，終端速度是 SMOKE_RISE', () => {
    // 【為什麼】積分器只有 gravity 這一個欄位（particles.ts），而終端速度是
    // gravity / drag。要 3 m/s 就得餵 3 × 1.5 = 4.5 m/s²。
    expect(SMOKE_GRAVITY).toBeCloseTo(SMOKE_RISE * SMOKE_DRAG, 9)
    expect(SMOKE_GRAVITY).toBeGreaterThan(0)
  })

  it('會膨脹不會縮小', () => {
    expect(SMOKE_SIZE_TO).toBeGreaterThan(SMOKE_SIZE_FROM)
  })

  it('半透明 —— 不透明的煙會把後面的空戰整個蓋掉', () => {
    expect(SMOKE_ALPHA).toBeGreaterThan(0)
    expect(SMOKE_ALPHA).toBeLessThan(1)
  })

  it('大零件才冒煙，不是全部十二片', () => {
    // 【為什麼】12 條煙會糊成一團，讀不出「零件在散開」，而發射器數量會從
    // 20×4 變成 20×12（M8 spec §6.1）。
    expect(DEBRIS_SMOKE_COUNT).toBe(4)
  })
})

describe('emitSmoke', () => {
  it('一筆事件生一團', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 1, 2, 3, 0, 1, 0)
    emitSmoke(s, e)
    s.step(0.01)
    expect(s.live).toBe(1)
    expect(decompose(s.object, 0).position.x).toBeCloseTo(1, 4)
    s.dispose()
  })

  it('初速為零 —— 煙生出來就與發射體脫鉤', () => {
    // 【為什麼不跟著跑】拖曳的觀感來自「發射體在動、每一團生在不同位置」。
    // 跟著跑的話整條煙會像一根黏在殘骸上的棍子（M8 spec §6）。
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    s.step(0.1)
    const p = decompose(s.object, 0).position
    expect(Math.abs(p.x)).toBeLessThan(0.01)
    expect(Math.abs(p.z)).toBeLessThan(0.01)
    // 只有上浮
    expect(p.y).toBeGreaterThan(0)
    s.dispose()
  })

  it('往上飄且愈飄愈大', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    s.step(0.5)
    const a = decompose(s.object, 0)
    s.step(0.5)
    const b = decompose(s.object, 0)
    expect(b.position.y).toBeGreaterThan(a.position.y)
    expect(b.scale.x).toBeGreaterThan(a.scale.x)
    s.dispose()
  })

  it('壽命結束就死光', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    s.step(SMOKE_LIFE + 0.01)
    expect(s.live).toBe(0)
    s.dispose()
  })

  it('連續十秒不產生 NaN', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    for (let i = 0; i < 600; i++) s.step(1 / 60)
    const d = decompose(s.object, 0)
    expect(Number.isFinite(d.position.length())).toBe(true)
    expect(Number.isFinite(d.scale.length())).toBe(true)
    s.dispose()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/smoke.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/smoke`

- [ ] **Step 3: 實作 `src/render/smoke.ts`**

```ts
import { Color, NormalBlending } from 'three'
import { createParticles, type Particles } from './particles'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/** 壽命，s。60 fps 下 150 幀 —— 拖得出一條讀得到的煙帶。 */
export const SMOKE_LIFE = 2.5

/** 出生直徑，m。 */
export const SMOKE_SIZE_FROM = 2

/** 死亡直徑，m。膨脹是煙散開的樣子。 */
export const SMOKE_SIZE_TO = 9

/** 出生時的不透明度，線性淡到 0。 */
export const SMOKE_ALPHA = 0.55

/** 終端上浮速度，m/s。 */
export const SMOKE_RISE = 3

/** 指數阻尼，s⁻¹。 */
export const SMOKE_DRAG = 1.5

/**
 * 餵給積分器的上浮加速度，m/s²。
 *
 * 【為什麼是加速度而不是速度】`particles.ts` 的積分器只有 `gravity` 這一個
 * 欄位，而終端速度是 `gravity / drag`。要 3 m/s 的上浮就得餵
 * 3 × 1.5 = 4.5 —— 與殘骸的阻尼由終端速度 80 m/s 反推是同一個做法。
 */
export const SMOKE_GRAVITY = SMOKE_RISE * SMOKE_DRAG

/** 殘骸每隔多久冒一團，s。150 m/s 下相鄰兩團相距 12 m —— 一條連續的煙帶。 */
export const WRECK_SMOKE_INTERVAL = 0.08

/** 大零件每隔多久冒一團，s。 */
export const DEBRIS_SMOKE_INTERVAL = 0.3

/**
 * 十二片零件裡有幾片冒煙。
 *
 * 【為什麼不是全部】12 條煙會糊成一團，讀不出「零件在散開」；而發射器數量
 * 會從 20 次擊墜 × 4 變成 × 12，穩態團數逼近 2,600（M8 spec §6.1）。
 */
export const DEBRIS_SMOKE_COUNT = 4

/**
 * 池子大小。
 *
 * 【3072 怎麼來】20 具殘骸各 `2.5 / 0.08 = 31` 團、80 片大零件各
 * `2.5 / 0.3 = 8` 團 —— 穩態約 1,260 團。3072 是它的兩倍餘裕。
 */
export const SMOKE_CAPACITY = 3072

/**
 * 年齡比例 → 顏色。**常數深灰。**
 *
 * 【為什麼不隨年齡變色】煙的消失靠 alpha，不靠顏色。往黑淡在亮天空上方向
 * 是反的（愈淡愈明顯），往白淡則會變成蒸汽（M8 spec §4.3）。
 */
export function smokeColor(_t: number, out: Color): void {
  out.setRGB(0.102, 0.102, 0.102)
}

/**
 * 這一幀該生幾團。`timer` 是上一幀留下的餘數。
 *
 * 【為什麼低幀率要一次補足】0.5 s 的長幀若只生一團，150 m/s 的殘骸會在煙帶
 * 上留下一段 75 m 的空隙。補足的代價是那幾團生在同一個位置（沒有做位置
 * 內插）—— 一個只在掉幀時出現、而且比空隙輕微得多的瑕疵。
 */
export function smokePuffs(timer: number, dt: number, interval: number): number {
  if (interval <= 0) return 0
  return Math.floor((timer + dt) / interval)
}

/** 這一幀之後計時器該留下多少。與 `smokePuffs` 成對使用。 */
export function smokeTimer(timer: number, dt: number, interval: number): number {
  if (interval <= 0) return 0
  return (timer + dt) % interval
}

export function createSmoke(capacity: number = SMOKE_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: SMOKE_LIFE,
    sizeFrom: SMOKE_SIZE_FROM,
    sizeTo: SMOKE_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    color: smokeColor,
  })
}

/**
 * 依位置事件生煙。**初速恆為零** —— 一團煙生出來就與發射體脫鉤。
 *
 * 事件的法線欄位被忽略（見檔頭關於重用 `ImpactEvents` 的說明）。
 */
export function emitSmoke(pool: Particles, events: ImpactEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    pool.emit(d[o]!, d[o + 1]!, d[o + 2]!, 0, 0, 0)
  }
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/smoke.test.ts && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 5: Commit**

```bash
git add src/render/smoke.ts test/unit/smoke.test.ts
git commit -m "feat: 黑煙 —— 逐實例 alpha 淡出、上浮加速度由終端速度反推"
```

---

## Task 8: 噴濺

**Files:**
- Create: `src/render/spray.ts`
- Test: `test/unit/spray.test.ts`

**Interfaces:**
- Consumes: `createParticles`, `type Particles`（Task 4）；`coneDirection`（Task 5）；`IMPACT_STRIDE`, `type ImpactEvents`
- Produces:
  - 常數 `SPRAY_LIFE = 0.6`、`SPRAY_SIZE = 0.4`、`SPRAY_SPEED = 25`、`SPRAY_CONE`、`SPRAY_DRAG = 2`、`SPRAY_GRAVITY = -9.80665`、`SPRAY_ALPHA = 0.85`、`WRECK_SPRAY_COUNT = 24`、`DEBRIS_SPRAY_COUNT = 6`、`SPRAY_CAPACITY = 1024`、`WATER_COLOR = 0xf2f8ff`
  - `createSpray(color: number, capacity?: number): Particles`
  - `emitSpray(pool: Particles, events: ImpactEvents, count: number): void`

**spec 沒有列 `SPRAY_LIFE`**（§12 的總表缺這一項）。這裡補上 0.6 s，推導寫在常數的註解裡：25 m/s 配阻尼 2 s⁻¹，0.6 s 內飛約 10 m —— 與水柱的 12 m 同一個尺度，兩者一起讀起來是同一次撞擊。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/spray.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSpray, emitSpray,
  DEBRIS_SPRAY_COUNT, SPRAY_CONE, SPRAY_LIFE, SPRAY_SIZE, WATER_COLOR,
  WRECK_SPRAY_COUNT,
} from '../../src/render/spray'
import { createImpacts, pushImpact } from '../../src/world/events'

function positionOf(mesh: InstancedMesh, i: number): Vector3 {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const p = new Vector3()
  m.decompose(p, new Quaternion(), new Vector3())
  return p
}

describe('emitSpray', () => {
  it('一筆事件生 count 顆', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(0.01)
    expect(s.live).toBe(WRECK_SPRAY_COUNT)
    s.dispose()
  })

  it('零件用比較小的數量 —— 同一個池子，兩種規模', () => {
    expect(DEBRIS_SPRAY_COUNT).toBeLessThan(WRECK_SPRAY_COUNT)
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, DEBRIS_SPRAY_COUNT)
    s.step(0.01)
    expect(s.live).toBe(DEBRIS_SPRAY_COUNT)
    s.dispose()
  })

  it('往上噴 —— 錐軸是世界 +Y，不是事件裡的法線', () => {
    // 【為什麼不用法線】水面的法線幾乎恆為向上（Gerstner 波的坡度很小），
    // 而向上正是水花該去的方向。命中飛機的火花才需要真正的表面法線，因為
    // 機身的朝向什麼都可能（M8 spec §9.2）。
    // 這裡故意餵一個朝下的法線，噴濺仍然必須往上。
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 100, 0, 0, -1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(0.05)
    let above = 0
    for (let i = 0; i < WRECK_SPRAY_COUNT; i++) {
      if (positionOf(s.object, i).y > 100) above++
    }
    expect(above).toBe(WRECK_SPRAY_COUNT)
    s.dispose()
  })

  it('是四散的 —— 不是一柱往上', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(0.1)
    let maxR = 0
    for (let i = 0; i < WRECK_SPRAY_COUNT; i++) {
      const p = positionOf(s.object, i)
      maxR = Math.max(maxR, Math.hypot(p.x, p.z))
    }
    // 半角 55°、25 m/s、0.1 s → 橫向最多約 2 m
    expect(maxR).toBeGreaterThan(0.8)
    expect(SPRAY_CONE).toBeGreaterThan(0.5)
    s.dispose()
  })

  it('受重力 —— 噴上去會落回來', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, 1)
    let peak = -Infinity
    let last = 0
    for (let i = 0; i < 36; i++) {
      s.step(SPRAY_LIFE / 36)
      const y = positionOf(s.object, 0).y
      if (y > peak) peak = y
      last = y
    }
    expect(peak).toBeGreaterThan(0)
    expect(last).toBeLessThan(peak)
    s.dispose()
  })

  it('尺寸固定不膨脹 —— 水滴不是煙', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, 1)
    const m = new Matrix4()
    const sc = new Vector3()
    s.step(0.05)
    s.object.getMatrixAt(0, m)
    m.decompose(new Vector3(), new Quaternion(), sc)
    const early = sc.x
    s.step(0.3)
    s.object.getMatrixAt(0, m)
    m.decompose(new Vector3(), new Quaternion(), sc)
    expect(sc.x).toBeCloseTo(early, 6)
    expect(early).toBeCloseTo(SPRAY_SIZE, 6)
    s.dispose()
  })

  it('顏色是參數 —— 之後接地面只要換一個池子', () => {
    // 【為什麼】M8 spec §9.4：地面之後會用土色噴射。顏色寫死的話那時要動
    // 這個模組；當成參數的話只要多建一個實例。
    const water = createSpray(WATER_COLOR, 16)
    const dirt = createSpray(0x8a6a44, 16)
    expect(water.object).not.toBe(dirt.object)
    water.dispose()
    dirt.dispose()
  })

  it('壽命結束就死光', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(SPRAY_LIFE + 0.01)
    expect(s.live).toBe(0)
    s.dispose()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/spray.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/spray`

- [ ] **Step 3: 實作 `src/render/spray.ts`**

```ts
import { Color, NormalBlending, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/**
 * 壽命，s。
 *
 * 【推導】25 m/s 配阻尼 2 s⁻¹，0.6 s 內飛約 10 m —— 與水柱的 12 m 同一個
 * 尺度，兩者一起讀起來才是同一次撞擊而不是兩件事。60 fps 下 36 幀。
 *
 * （M8 spec §12 的總表沒有列這一項，這個值與推導是實作時補上的。）
 */
export const SPRAY_LIFE = 0.6

/** 直徑，m。固定不膨脹 —— 水滴不是煙。 */
export const SPRAY_SIZE = 0.4

/** 初速，m/s。 */
export const SPRAY_SPEED = 25

/** 噴射錐的半角。寬到讀得出「四散」，窄到仍然是往上的。 */
export const SPRAY_CONE = 55 * (Math.PI / 180)

/** 指數阻尼，s⁻¹。 */
export const SPRAY_DRAG = 2

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
export const SPRAY_GRAVITY = -9.80665

/** 出生時的不透明度。水花幾乎不透明，但仍要淡出。 */
export const SPRAY_ALPHA = 0.85

/** 殘骸入水噴幾顆。 */
export const WRECK_SPRAY_COUNT = 24

/** 一片零件入水噴幾顆。比殘骸小一號。 */
export const DEBRIS_SPRAY_COUNT = 6

/** 池子大小。 */
export const SPRAY_CAPACITY = 1024

/** 水花的顏色。 */
export const WATER_COLOR = 0xf2f8ff

/**
 * 噴濺池。**顏色是參數。**
 *
 * 【為什麼顏色不寫死】M8 spec §9.4：之後加地面時要用土色噴射。寫死的話那時
 * 得回來改這個模組；當成參數的話只要在 `main.ts` 多建一個實例，代價是多一個
 * draw call。地面本身不在這份計畫的範圍內。
 */
export function createSpray(color: number, capacity: number = SPRAY_CAPACITY): Particles {
  const tint = new Color(color)
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: SPRAY_LIFE,
    sizeFrom: SPRAY_SIZE,
    sizeTo: SPRAY_SIZE,
    gravity: SPRAY_GRAVITY,
    drag: SPRAY_DRAG,
    alphaFrom: SPRAY_ALPHA,
    color: (_t, out) => { out.copy(tint) },
  })
}

/** 模組私有的暫存。熱路徑：不配置。 */
const DIR = new Vector3()

/**
 * 依接觸事件噴一叢水花。
 *
 * **錐軸是世界 +Y 而不是事件裡的法線** —— 水面的法線幾乎恆為向上（Gerstner
 * 波的坡度很小），而向上正是水花該去的方向。命中飛機的火花才需要真正的表面
 * 法線，因為機身的朝向什麼都可能（M8 spec §9.2）。事件的法線欄位在這裡被
 * 忽略，留著是為了與 `ImpactEvents` 共型。
 *
 * @param count 這一筆事件噴幾顆。殘骸用 `WRECK_SPRAY_COUNT`、零件用
 *              `DEBRIS_SPRAY_COUNT` —— 同一個池子，兩種規模
 */
export function emitSpray(pool: Particles, events: ImpactEvents, count: number): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    for (let k = 0; k < count; k++) {
      coneDirection(0, 1, 0, SPRAY_CONE, e * count + k, DIR)
      pool.emit(
        x, y, z,
        DIR.x * SPRAY_SPEED, DIR.y * SPRAY_SPEED, DIR.z * SPRAY_SPEED,
      )
    }
  }
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/spray.test.ts && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 5: Commit**

```bash
git add src/render/spray.ts test/unit/spray.test.ts
git commit -m "feat: 入水噴濺 —— 錐軸為世界 +Y，顏色是參數以便日後接地面"
```

---

## Task 9: 零件

**Files:**
- Create: `src/render/debris.ts`
- Modify: `src/render/geometry/p51d.ts`、`src/render/geometry/bf109e.ts`、`src/render/geometry/buildAircraft.ts`（把機身色抽成匯出常數並提供查表）
- Test: `test/unit/debris.test.ts`

**Interfaces:**
- Consumes: `tumble`（Task 3）；`coneDirection`, `hash01`（Task 5）；`KILL_STRIDE`, `type KillEvents`（Task 1）；`createImpacts`, `pushImpact`, `clearImpacts`, `type ImpactEvents`（既有）；`type HeightField`（`src/aircraft/crash.ts:11`，既有）
- Produces:
  - `bodyColorOf(spec: AircraftSpec): number`（在 `buildAircraft.ts`）
  - `P51D_BODY_COLOR = 0x9aa7b4`、`BF109_BODY_COLOR = 0x7e8a73`
  - 常數 `DEBRIS_COUNT = 12`、`DEBRIS_SIZE_MIN = 0.8`、`DEBRIS_SIZE_MAX = 2.0`、`DEBRIS_SPEED = 20`、`DEBRIS_CONE`、`DEBRIS_DRAG = 0.4`、`DEBRIS_SPIN`、`DEBRIS_MAX_LIFE = 40`、`DEBRIS_CAPACITY = 480`
  - `interface Debris { object: InstancedMesh; readonly live: number; readonly smokeEvents: ImpactEvents; readonly sprayEvents: ImpactEvents; emit(events: KillEvents, colorOf: (index: number) => number): void; step(dt: number, heightAt: HeightField, time: number): void; dispose(): void }`
  - `createDebris(capacity?: number): Debris`

- [ ] **Step 1: 把機身色抽成匯出常數**

在 `src/render/geometry/p51d.ts`，把 `bodyColor: 0x9aa7b4,`（約第 241 行）改成引用一個新的模組層級常數：

```ts
/** 機身色。零件（`render/debris.ts`）要用同一個值 —— 抄成兩份就是只有一份會被修好。 */
export const P51D_BODY_COLOR = 0x9aa7b4
```

然後那一行改成 `bodyColor: P51D_BODY_COLOR,`。

在 `src/render/geometry/bf109e.ts` 同樣處理（約第 175 行）：

```ts
/** 機身色。零件（`render/debris.ts`）要用同一個值。 */
export const BF109_BODY_COLOR = 0x7e8a73
```

在 `src/render/geometry/buildAircraft.ts` 加：

```ts
import { BF109_BODY_COLOR } from './bf109e'
import { P51D_BODY_COLOR } from './p51d'

/**
 * 機種 id → 機身色。與 `BUILDERS` 同一把鑰匙。
 *
 * 【為什麼在這裡而不是 `AircraftSpec` 裡】`specs/` 放的是飛行與武裝的物理
 * 參數，塗裝是渲染層的事。這個檔案本來就是「機種 id → 外型」的查表處。
 */
const BODY_COLORS: Record<string, number> = {
  p51d: P51D_BODY_COLOR,
  bf109g6: BF109_BODY_COLOR,
}

export function bodyColorOf(spec: AircraftSpec): number {
  const c = BODY_COLORS[spec.id]
  if (c === undefined) throw new Error(`未定義機種塗裝：${spec.id}`)
  return c
}
```

- [ ] **Step 2: 寫失敗的測試**

建立 `test/unit/debris.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createDebris,
  DEBRIS_CONE, DEBRIS_COUNT, DEBRIS_MAX_LIFE, DEBRIS_SIZE_MAX, DEBRIS_SIZE_MIN,
} from '../../src/render/debris'
import { DEBRIS_SMOKE_COUNT } from '../../src/render/smoke'
import { createKills, pushKill } from '../../src/world/kills'
import { bodyColorOf } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const FLAT = (): number => 0
const DEEP = (): number => -100000

function decompose(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

const WHITE = () => 0xffffff

describe('bodyColorOf', () => {
  it('兩個機種各有自己的塗裝，而且不相同', () => {
    expect(bodyColorOf(P51D)).toBe(0x9aa7b4)
    expect(bodyColorOf(BF109G6)).toBe(0x7e8a73)
  })
})

describe('createDebris', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const d = createDebris(16)
    expect(d.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    d.object.traverse(() => objects++)
    expect(objects).toBe(1)
    d.dispose()
  })

  it('建立時全部縮成 0', () => {
    const d = createDebris(16)
    expect(d.live).toBe(0)
    for (let i = 0; i < 16; i++) expect(decompose(d.object, i).scale.x).toBe(0)
    d.dispose()
  })
})

describe('零件的發射（M8 spec §7）', () => {
  it('一筆擊墜事件生 DEBRIS_COUNT 片', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
    d.dispose()
  })

  it('沿飛行方向噴 —— 不是往四周炸開', () => {
    // 【這是驗收條件 §14.2.12】繼承母機速度再疊一個朝前的散射錐，所以
    // 所有零件在短時間內都在母機前方。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.1, DEEP, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      // 母機朝 −Z 飛，所以零件的 z 一定變小
      expect(decompose(d.object, i).position.z).toBeLessThan(-5)
    }
    d.dispose()
  })

  it('散射錐讓零件彼此分開，不是一條線', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.5, DEEP, 0)
    let maxR = 0
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const p = decompose(d.object, i).position
      maxR = Math.max(maxR, Math.hypot(p.x, p.y - 1000))
    }
    expect(maxR).toBeGreaterThan(1)
    expect(DEBRIS_CONE).toBeGreaterThan(0.3)
    d.dispose()
  })

  it('大小落在 MIN 與 MAX 之間', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const s = decompose(d.object, i).scale.x
      expect(s).toBeGreaterThanOrEqual(DEBRIS_SIZE_MIN - 1e-6)
      expect(s).toBeLessThanOrEqual(DEBRIS_SIZE_MAX + 1e-6)
    }
    d.dispose()
  })

  it('每一次擊墜只有 DEBRIS_SMOKE_COUNT 片冒煙，而且是比較大的那幾片', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    // 一幀 0.4 s、間隔 0.3 s → 每一片冒煙的正好生一團，所以事件數就是
    // 冒煙的片數。全部十二片都冒的話這裡會是 12。
    d.step(0.4, DEEP, 0)
    expect(d.smokeEvents.count).toBe(DEBRIS_SMOKE_COUNT)
    d.dispose()
  })

  it('翻滾中 —— 姿態隨時間改變', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    const a = decompose(d.object, 0).quaternion.clone()
    d.step(0.3, DEEP, 0)
    const b = decompose(d.object, 0).quaternion
    expect(a.angleTo(b)).toBeGreaterThan(0.1)
    d.dispose()
  })

  it('受重力 —— 會往下掉', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(2, DEEP, 0)
    let below = 0
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      if (decompose(d.object, i).position.y < 1000) below++
    }
    expect(below).toBeGreaterThan(DEBRIS_COUNT / 2)
    d.dispose()
  })
})

describe('零件入水（M8 spec §7）', () => {
  it('碰到水面就推一筆噴濺事件並退場', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 3, 0, 0, -50, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, 0)
    expect(d.sprayEvents.count).toBe(DEBRIS_COUNT)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('噴濺事件生在水面上，不是零件的位置', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 100, 3, -200, 0, -50, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, () => 1.75, 0)
    expect(d.sprayEvents.count).toBeGreaterThan(0)
    expect(d.sprayEvents.data[1]).toBeCloseTo(1.75, 4)
    d.dispose()
  })

  it('事件緩衝每一次 step 開頭排空 —— 不會重複發射', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 3, 0, 0, -50, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, 0)
    const first = d.sprayEvents.count
    expect(first).toBeGreaterThan(0)
    d.step(0.2, FLAT, 0)
    expect(d.sprayEvents.count).toBe(0)
    d.dispose()
  })

  it('永遠碰不到水面的零件也會在 DEBRIS_MAX_LIFE 之後退場', () => {
    // 【為什麼要上限】海面網格只有 10 km 見方；飄出去的零件永遠不會入水。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    for (let i = 0; i < 100; i++) d.step(DEBRIS_MAX_LIFE / 100, DEEP, 0)
    d.step(0.1, DEEP, 0)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 30, 10, -150, 0)
    d.emit(e, WHITE)
    for (let i = 0; i < 300; i++) d.step(1 / 60, DEEP, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const inst = decompose(d.object, i)
      expect(Number.isFinite(inst.position.length())).toBe(true)
      expect(Number.isFinite(inst.scale.length())).toBe(true)
      expect(Number.isFinite(inst.quaternion.length())).toBe(true)
    }
    d.dispose()
  })

  it('池子滿了覆蓋最舊的', () => {
    const d = createDebris(DEBRIS_COUNT)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    pushKill(e, 500, 1000, 0, 0, 0, 0, 1)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
    d.dispose()
  })
})
```

- [ ] **Step 3: 跑測試確認它失敗**

Run: `npx vitest run test/unit/debris.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/debris`

- [ ] **Step 4: 實作 `src/render/debris.ts`**

```ts
import {
  BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshStandardMaterial, Quaternion, Vector3,
} from 'three'
import { coneDirection, hash01 } from './scatter'
import { tumble } from './tumble'
import { DEBRIS_SMOKE_COUNT, DEBRIS_SMOKE_INTERVAL, smokePuffs, smokeTimer } from './smoke'
import { KILL_STRIDE, type KillEvents } from '../world/kills'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'
import type { HeightField } from '../aircraft/crash'

/** 一次擊墜噴幾片。 */
export const DEBRIS_COUNT = 12

/** 最小／最大邊長，m。一架 10 m 的飛機解體，碎片本來就有大有小。 */
export const DEBRIS_SIZE_MIN = 0.8
export const DEBRIS_SIZE_MAX = 2.0

/** 散射的初速，m/s。疊在母機速度之上。 */
export const DEBRIS_SPEED = 20

/** 散射錐的半角。窄到讀得出「往前噴」，寬到不像一束。 */
export const DEBRIS_CONE = 40 * (Math.PI / 180)

/**
 * 指數阻尼，s⁻¹。終端速度 9.80665 / 0.4 = 24.5 m/s。
 *
 * 零件比殘骸輕得多，所以終端速度低得多（24.5 vs 80 m/s）—— 畫面上零件會被
 * 殘骸拋在後面，那是對的（M8 spec §7）。
 */
export const DEBRIS_DRAG = 0.4

/** 三軸角速度的上限，rad/s。±180°/s。 */
export const DEBRIS_SPIN = Math.PI

/** 壽命上限，s。海面網格只有 10 km 見方，飄出去的零件永遠不會入水。 */
export const DEBRIS_MAX_LIFE = 40

/** 池子大小。40 架 × 12 片。 */
export const DEBRIS_CAPACITY = 40 * DEBRIS_COUNT

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

export interface Debris {
  object: InstancedMesh
  /** 目前還活著幾片。測試與 telemetry 用 */
  readonly live: number
  /**
   * 這一次 `step` 產生的冒煙位置。**每次 `step` 開頭排空** —— 呼叫端在
   * `step` 之後讀，不必自己清。
   */
  readonly smokeEvents: ImpactEvents
  /** 這一次 `step` 產生的入水位置。與 `smokeEvents` 同樣的生命週期。 */
  readonly sprayEvents: ImpactEvents
  /**
   * 依擊墜事件噴一批零件。
   *
   * @param colorOf combatant 索引 → 機身色。渲染層知道機種對應哪個塗裝，
   *                `World` 不需要知道有塗裝這回事
   */
  emit(events: KillEvents, colorOf: (index: number) => number): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number, heightAt: HeightField, time: number): void
  dispose(): void
}

/** 模組私有的暫存。熱路徑：不配置。 */
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const IDENTITY = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 零件 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 【為什麼是方塊而不是真的把機體切開】專案負責人裁決「同色的 BOX 模擬就好，
 * 不用太精細」。真正切開程序化機體幾何是另一個量級的工作，而在交戰距離上
 * 一片 1 m 的碎片只有幾個像素（M8 spec §15）。
 *
 * 【為什麼姿態是年齡的函數而不是每幀積分】見 `tumble` 的註解 —— 沒有漂移，
 * 而且測得起來。基準姿態取單位四元數：翻滾本來就是隨機的，一個隨機的起點
 * 疊在隨機的角速度上看不出差別，卻要多存四個陣列。
 */
export function createDebris(capacity: number = DEBRIS_CAPACITY): Debris {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  const rx = new Float32Array(capacity)
  const ry = new Float32Array(capacity)
  const rz = new Float32Array(capacity)
  const size = new Float32Array(capacity)
  const timer = new Float32Array(capacity)
  const smokes = new Uint8Array(capacity)
  const age = new Float32Array(capacity).fill(DEBRIS_MAX_LIFE)
  let next = 0
  let live = 0

  const geometry = new BoxGeometry(1, 1, 1)
  // 【與機體同一種材質】零件是機體掉下來的，光照不一致會讓它看起來像貼紙
  const material = new MeshStandardMaterial({ flatShading: true, roughness: 0.75 })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.frustumCulled = false

  M.compose(ZERO, IDENTITY, ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(1, 1, 1))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true

  const smokeEvents = createImpacts(capacity)
  const sprayEvents = createImpacts(capacity)

  /** 讓某一格退場並縮成 0。 */
  function kill(i: number): void {
    age[i] = DEBRIS_MAX_LIFE
    M.compose(ZERO, IDENTITY, ZERO)
    object.setMatrixAt(i, M)
  }

  return {
    object,
    smokeEvents,
    sprayEvents,
    get live() { return live },

    emit(events: KillEvents, colorOf: (index: number) => number): void {
      const d = events.data
      const mid = (DEBRIS_SIZE_MIN + DEBRIS_SIZE_MAX) / 2
      for (let e = 0; e < events.count; e++) {
        const o = e * KILL_STRIDE
        const x = d[o]!
        const y = d[o + 1]!
        const z = d[o + 2]!
        const pvx = d[o + 3]!
        const pvy = d[o + 4]!
        const pvz = d[o + 5]!
        TINT.set(colorOf(d[o + 6]!))
        // 飛行方向：速度的單位向量。速度為零時退回 +Z，散射仍然成立
        const speed = Math.hypot(pvx, pvy, pvz)
        const fx = speed > 1e-6 ? pvx / speed : 0
        const fy = speed > 1e-6 ? pvy / speed : 0
        const fz = speed > 1e-6 ? pvz / speed : 1

        for (let k = 0; k < DEBRIS_COUNT; k++) {
          const i = next
          next = next + 1 >= capacity ? 0 : next + 1
          if (age[i]! >= DEBRIS_MAX_LIFE) live++
          const seed = e * DEBRIS_COUNT + k

          // 【沿飛行方向散射】繼承母機速度，再疊一個朝前的錐 —— 一架
          // 150 m/s 的飛機解體，碎片的動量本來就還在（M8 spec §7）
          coneDirection(fx, fy, fz, DEBRIS_CONE, seed, DIR)
          px[i] = x
          py[i] = y
          pz[i] = z
          vx[i] = pvx + DIR.x * DEBRIS_SPEED
          vy[i] = pvy + DIR.y * DEBRIS_SPEED
          vz[i] = pvz + DIR.z * DEBRIS_SPEED

          rx[i] = (hash01(seed * 3) * 2 - 1) * DEBRIS_SPIN
          ry[i] = (hash01(seed * 3 + 1) * 2 - 1) * DEBRIS_SPIN
          rz[i] = (hash01(seed * 3 + 2) * 2 - 1) * DEBRIS_SPIN

          // 【前幾片是大的，而且只有它們冒煙】12 條煙會糊成一團，讀不出
          // 「零件在散開」（M8 spec §6.1）
          const big = k < DEBRIS_SMOKE_COUNT
          const h = hash01(seed * 5 + 4)
          size[i] = big
            ? mid + (DEBRIS_SIZE_MAX - mid) * h
            : DEBRIS_SIZE_MIN + (mid - DEBRIS_SIZE_MIN) * h
          smokes[i] = big ? 1 : 0
          timer[i] = 0
          age[i] = 0
          object.setColorAt(i, TINT)
        }
      }
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },

    step(dt: number, heightAt: HeightField, time: number): void {
      // 【每次 step 開頭排空】呼叫端在 step 之後讀就好，不必記得清
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
      const damp = Math.exp(-DEBRIS_DRAG * dt)
      live = 0
      for (let i = 0; i < capacity; i++) {
        const old = age[i]!
        if (old >= DEBRIS_MAX_LIFE) continue
        const na = old + dt
        age[i] = na
        if (na >= DEBRIS_MAX_LIFE) {
          kill(i)
          continue
        }

        const nvx = vx[i]! * damp
        const nvy = vy[i]! * damp + G * dt
        const nvz = vz[i]! * damp
        vx[i] = nvx
        vy[i] = nvy
        vz[i] = nvz
        const nx = px[i]! + nvx * dt
        const ny = py[i]! + nvy * dt
        const nz = pz[i]! + nvz * dt
        px[i] = nx
        py[i] = ny
        pz[i] = nz

        // 【用中心點判定入水】一片零件最大 2 m，用中心與用角點的差距在半片
        // 零件之內。角點的解析式（`lowestPoint`）是為翼展 11 m 的翻滾整機
        // 而存在的（M8 spec §7）
        const surface = heightAt(nx, nz, time)
        if (ny <= surface) {
          pushImpact(sprayEvents, nx, surface, nz, 0, 1, 0)
          kill(i)
          continue
        }

        live++
        if (smokes[i] === 1) {
          const t = timer[i]!
          const puffs = smokePuffs(t, dt, DEBRIS_SMOKE_INTERVAL)
          timer[i] = smokeTimer(t, dt, DEBRIS_SMOKE_INTERVAL)
          for (let k = 0; k < puffs; k++) pushImpact(smokeEvents, nx, ny, nz, 0, 1, 0)
        }

        tumble(rx[i]!, ry[i]!, rz[i]!, na, IDENTITY, ROT)
        POS.set(nx, ny, nz)
        const s = size[i]!
        SCALE.set(s, s, s)
        M.compose(POS, ROT, SCALE)
        object.setMatrixAt(i, M)
      }
      object.instanceMatrix.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
```

- [ ] **Step 5: 跑測試確認它通過**

Run: `npx vitest run test/unit/debris.test.ts && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 6: 確認「沿飛行方向噴」真的會抓錯**

把 `coneDirection(fx, fy, fz, DEBRIS_CONE, seed, DIR)` 的半角暫時改成 `Math.PI`（等向），跑測試。

Run: `npx vitest run test/unit/debris.test.ts`
Expected: 「沿飛行方向噴 —— 不是往四周炸開」**變紅**。確認之後改回 `DEBRIS_CONE`。

- [ ] **Step 7: 跑完整套件，確認抽出機身色常數沒有改變任何模型**

Run: `npx vitest run && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 8: Commit**

```bash
git add src/render/debris.ts src/render/geometry/p51d.ts src/render/geometry/bf109e.ts \
        src/render/geometry/buildAircraft.ts test/unit/debris.test.ts
git commit -m "feat: 零件 —— 沿飛行方向散射的同色方塊，大的那幾片冒煙"
```

---

## Task 10: 殘骸

**Files:**
- Create: `src/render/wrecks.ts`
- Test: `test/unit/wrecks.test.ts`

**Interfaces:**
- Consumes: `lowestPoint`（Task 2）；`tumble`（Task 3）；`hash01`（Task 5）；`WRECK_SMOKE_INTERVAL`, `smokePuffs`, `smokeTimer`（Task 7）；`createImpacts`, `pushImpact`, `clearImpacts`, `type ImpactEvents`；`type HitBox`；`type HeightField`；`type AircraftModel`
- Produces:
  - 常數 `WRECK_TERMINAL = 80`、`WRECK_DRAG`、`WRECK_SPIN`、`WRECK_MAX_LIFE = 120`、`WRECK_SINK_DEPTH = 25`、`WRECK_SPLASH_COLUMNS = 10`、`WRECK_SPLASH_RADIUS = 6`
  - `interface Wrecks { readonly live: number; readonly smokeEvents: ImpactEvents; readonly sprayEvents: ImpactEvents; readonly splashEvents: ImpactEvents; adopt(model: AircraftModel, boxes: readonly HitBox[], vx: number, vy: number, vz: number, seed: number): void; step(dt: number, heightAt: HeightField, time: number): void; dispose(): void }`
  - `createWrecks(capacity: number, release: (model: AircraftModel) => void): Wrecks`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/unit/wrecks.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Group, Quaternion, Vector3 } from 'three'
import {
  createWrecks,
  WRECK_DRAG, WRECK_MAX_LIFE, WRECK_SINK_DEPTH, WRECK_SPLASH_COLUMNS,
  WRECK_SPLASH_RADIUS, WRECK_TERMINAL,
} from '../../src/render/wrecks'
import type { AircraftModel } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'

const FLAT = (): number => 0
const DEEP = (): number => -100000

interface Fake { model: AircraftModel; spins: { rotation: number; blurred: boolean }[] }

function fakeModel(): Fake {
  const spins: { rotation: number; blurred: boolean }[] = []
  const model: AircraftModel = {
    group: new Group(),
    metrics: { realLength: 9.83, noseZ: -3.4, noseY: 0.3, tipY: 0 },
    eyePoint: new Vector3(),
    setPropSpin: (rotation: number, blurred: boolean) => { spins.push({ rotation, blurred }) },
    dispose: () => {},
  }
  return { model, spins }
}

describe('殘骸的接管（M8 spec §8.1）', () => {
  it('初始位置與旋轉取自模型當前的內插姿態，不是傳入的參數', () => {
    // 【為什麼】事件帶的是物理子步的位置，而模型畫在內插後的位置 ——
    // 用事件位置設殘骸，它在誕生的那一幀會跳最多 0.83 m（M8 spec §3.1）。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(123, 4000, -456)
    f.model.group.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 1.1)
    const before = f.model.group.quaternion.clone()
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.step(0.0001, DEEP, 0)
    expect(f.model.group.position.distanceTo(new Vector3(123, 4000, -456))).toBeLessThan(0.01)
    expect(f.model.group.quaternion.angleTo(before)).toBeLessThan(0.01)
  })

  it('接管時螺旋槳停轉並切回葉片', () => {
    // 【為什麼】失去動力的飛機槳是停的。模型 API 本來就支援
    // （assembly.ts 的 setPropSpin），main.ts 的全域 propRotation 不再餵它。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    expect(f.spins.length).toBe(1)
    expect(f.spins[0]!.blurred).toBe(false)
    w.step(0.1, DEEP, 0)
    w.step(0.1, DEEP, 0)
    // step 不再動它 —— 停了就是停了
    expect(f.spins.length).toBe(1)
  })

  it('模型變成可見的 —— 陣亡那一幀 main.ts 可能已經把它藏起來', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.visible = false
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    expect(f.model.group.visible).toBe(true)
  })
})

describe('殘骸的運動（M8 spec §8.2）', () => {
  it('阻尼由終端速度反推', () => {
    expect(WRECK_DRAG).toBeCloseTo(9.80665 / WRECK_TERMINAL, 9)
    expect(WRECK_TERMINAL).toBe(80)
  })

  it('自由落下時速度收斂到終端速度', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 100000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    for (let i = 0; i < 4000; i++) w.step(0.02, DEEP, 0)
    const before = f.model.group.position.y
    w.step(0.02, DEEP, 0)
    const after = f.model.group.position.y
    expect((before - after) / 0.02).toBeCloseTo(WRECK_TERMINAL, 0)
  })

  it('繼承陣亡瞬間的速度', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, -150, 0)
    w.step(0.1, DEEP, 0)
    expect(f.model.group.position.z).toBeLessThan(-10)
  })

  it('翻滾 —— 姿態隨時間改變，而且每一具不一樣', () => {
    const w = createWrecks(4, () => {})
    const a = fakeModel()
    const b = fakeModel()
    a.model.group.position.set(0, 4000, 0)
    b.model.group.position.set(0, 4000, 0)
    w.adopt(a.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.adopt(b.model, P51D.hitBoxes, 0, 0, 0, 1)
    w.step(0.5, DEEP, 0)
    expect(a.model.group.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
    expect(a.model.group.quaternion.angleTo(b.model.group.quaternion)).toBeGreaterThan(0.1)
  })

  it('持續冒煙', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.step(0.5, DEEP, 0)
    expect(w.smokeEvents.count).toBeGreaterThan(3)
  })
})

describe('殘骸入水（M8 spec §9）', () => {
  it('翼尖先碰到水 —— 判定用 hitBox 的角點而不是重心', () => {
    // 繞 Z 轉 90°，右翼被轉到正下方。重心還在水面上方 4 m，但翼尖已經
    // 碰到水了 —— 用重心判定的話水花會晚一整個翼展才出現（M8 spec §9.1）。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4, 0)
    // 【姿態必須在 adopt 之前擺好】adopt 會把當時的 quaternion 存成翻滾的
    // 基準；step 每次都用 tumble(基準, age) 覆寫 group.quaternion，所以
    // adopt 之後再改是沒有用的。
    f.model.group.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    // 極小的 dt 讓角速度還來不及把姿態轉走
    w.step(0.0001, FLAT, 0)
    // 翼展 5.65 m > 4 m，所以這一步就該接觸
    expect(w.sprayEvents.count).toBe(1)
  })

  it('接觸時同時噴濺與生一圈水柱', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, 0)
    expect(w.sprayEvents.count).toBe(1)
    expect(w.splashEvents.count).toBe(WRECK_SPLASH_COLUMNS)
  })

  it('水柱散佈在接觸點周圍，不是疊在同一點', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(100, 0.5, -200)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, 0)
    const d = w.splashEvents.data
    let maxR = 0
    const seen = new Set<string>()
    for (let k = 0; k < w.splashEvents.count; k++) {
      const x = d[k * 6]!
      const z = d[k * 6 + 2]!
      seen.add(`${x.toFixed(3)},${z.toFixed(3)}`)
      maxR = Math.max(maxR, Math.hypot(x - 100, z + 200))
    }
    expect(seen.size).toBe(WRECK_SPLASH_COLUMNS)
    expect(maxR).toBeGreaterThan(0.5)
    expect(maxR).toBeLessThanOrEqual(WRECK_SPLASH_RADIUS + 1e-6)
  })

  it('入水之後只噴一次 —— 不會每幀都噴', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, 0)
    expect(w.sprayEvents.count).toBe(1)
    w.step(0.05, FLAT, 0)
    expect(w.sprayEvents.count).toBe(0)
  })

  it('入水之後停止冒煙', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.5, FLAT, 0)
    // 接觸的那一幀仍然冒了煙（冒煙排在接觸判定之前），下一幀起就停
    const afterContact = w.smokeEvents.count
    expect(afterContact).toBeGreaterThan(0)
    w.step(0.5, FLAT, 0)
    expect(w.smokeEvents.count).toBe(0)
  })

  it('沉到夠深就釋放模型', () => {
    // 【為什麼看不見還要沉】海面是不透明的（ocean.ts:52），沉下去就被水
    // 擋住 —— 這個深度門檻純粹是回收用的（M8 spec §9.3）。
    const released: AircraftModel[] = []
    const w = createWrecks(4, (m) => released.push(m))
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    for (let i = 0; i < 200; i++) w.step(0.05, FLAT, 0)
    expect(f.model.group.position.y).toBeLessThan(-WRECK_SINK_DEPTH + 1)
    expect(released.length).toBe(1)
    expect(released[0]).toBe(f.model)
    expect(w.live).toBe(0)
  })

  it('永遠碰不到水面的殘骸在 WRECK_MAX_LIFE 之後也會被釋放', () => {
    const released: AircraftModel[] = []
    const w = createWrecks(4, (m) => released.push(m))
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    for (let i = 0; i < 200; i++) w.step(WRECK_MAX_LIFE / 100, DEEP, 0)
    expect(released.length).toBe(1)
    expect(w.live).toBe(0)
  })

  it('釋放之後格子可以重用', () => {
    const w = createWrecks(1, () => {})
    const a = fakeModel()
    const b = fakeModel()
    a.model.group.position.set(0, 0.5, 0)
    w.adopt(a.model, P51D.hitBoxes, 0, -50, 0, 0)
    for (let i = 0; i < 200; i++) w.step(0.05, FLAT, 0)
    expect(w.live).toBe(0)
    b.model.group.position.set(0, 4000, 0)
    w.adopt(b.model, P51D.hitBoxes, 0, 0, 0, 1)
    w.step(0.05, DEEP, 0)
    expect(w.live).toBe(1)
  })

  it('連續兩分鐘不產生 NaN', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 30, 5, -150, 0)
    for (let i = 0; i < 7200; i++) w.step(1 / 60, DEEP, 0)
    expect(Number.isFinite(f.model.group.position.length())).toBe(true)
    expect(Number.isFinite(f.model.group.quaternion.length())).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/wrecks.test.ts`
Expected: FAIL —— 無法解析 `../../src/render/wrecks`

- [ ] **Step 3: 實作 `src/render/wrecks.ts`**

```ts
import { Quaternion, Vector3 } from 'three'
import { hash01 } from './scatter'
import { tumble } from './tumble'
import { WRECK_SMOKE_INTERVAL, smokePuffs, smokeTimer } from './smoke'
import { lowestPoint } from '../world/hit'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'
import type { HitBox } from '../world/hit'
import type { HeightField } from '../aircraft/crash'
import type { AircraftModel } from './geometry/buildAircraft'

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

/** 終端速度，m/s。一具翻滾的機體大約掉這麼快。 */
export const WRECK_TERMINAL = 80

/**
 * 指數阻尼，s⁻¹。**由終端速度反推**：線性阻尼下 `v_term = g / k`。
 *
 * 時間常數 `1 / 0.1226 = 8.2 s` —— 水平速度也在這個尺度上散掉，所以一具
 * 150 m/s 的殘骸會往前飄約 1.2 km 才轉為近乎垂直。從 4,000 m 掉到海面
 * 約 58 s（M8 spec §8.2）。
 */
export const WRECK_DRAG = -G / WRECK_TERMINAL

/** 三軸角速度的上限，rad/s。±120°/s。 */
export const WRECK_SPIN = (120 * Math.PI) / 180

/**
 * 壽命上限，s。
 *
 * 正常路徑（掉到海裡再沉 25 m）約 60 s，所以這條只在異常情形觸發 —— 例如
 * 殘骸飄出海面網格（10 km 見方，`ocean.ts:39`）之外，永遠碰不到水。它是
 * 一道保險，不是主要路徑（M8 spec §8.3）。
 */
export const WRECK_MAX_LIFE = 120

/**
 * 沉到接觸點下方多深就回收，m。
 *
 * 25 m 是最大包圍球半徑 7.1 m 的三倍多 —— 即使殘骸以最不利的姿態翻滾，
 * 也早已整具沒入。海面不透明，所以這段完全看不見（M8 spec §9.3）。
 */
export const WRECK_SINK_DEPTH = 25

/** 入水時在接觸點周圍生幾根水柱。用數量換規模，`splash.ts` 不用改。 */
export const WRECK_SPLASH_COLUMNS = 10

/** 那幾根水柱的散佈半徑，m。 */
export const WRECK_SPLASH_RADIUS = 6

export interface Wrecks {
  /** 目前有幾具在場。測試與 telemetry 用 */
  readonly live: number
  /** 這一次 `step` 產生的冒煙位置。**每次 `step` 開頭排空** */
  readonly smokeEvents: ImpactEvents
  /** 這一次 `step` 產生的入水噴濺。同樣的生命週期 */
  readonly sprayEvents: ImpactEvents
  /** 這一次 `step` 產生的水柱位置。同樣的生命週期 */
  readonly splashEvents: ImpactEvents
  /**
   * 接管一架飛機的模型，讓它變成殘骸。
   *
   * **初始位置與旋轉直接讀 `model.group`** —— 那是內插後的姿態。用擊墜事件
   * 裡的子步位置會讓殘骸在誕生的那一幀跳最多 0.83 m（M8 spec §3.1）。
   *
   * @param boxes 那架飛機的 `spec.hitBoxes`，入水判定用
   * @param seed  決定翻滾方向的索引。同一個 seed 恆得同一種翻法
   */
  adopt(
    model: AircraftModel, boxes: readonly HitBox[],
    vx: number, vy: number, vz: number, seed: number,
  ): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number, heightAt: HeightField, time: number): void
  dispose(): void
}

/** 模組私有的暫存。每幀每具殘骸重用：不配置。 */
const LOWEST = new Vector3()
const BEST = new Vector3()
const ROT = new Quaternion()

/**
 * 殘骸池。
 *
 * 【為什麼不新建幾何】它**接管**那架飛機既有的 `AircraftModel` —— 模型在
 * 它活著時已經在畫，變成殘骸只是換一個東西寫它的 `position` 與
 * `quaternion`。**渲染成本等於它活著時的成本，沒有增加**（M8 spec §8.1）。
 *
 * 【為什麼用物件陣列而不是平行的 typed array】容量是參戰架數（40），而且
 * 每一格要存一個模型參考與一組 hitBox 參考 —— 那本來就不是數字。四十個
 * 物件不是熱路徑。
 *
 * @param release 模型不再需要時的回收回呼。`main.ts` 用它把 group 移出
 *                場景並 `dispose()` —— 殘骸池不該知道有場景這回事
 */
export function createWrecks(
  capacity: number, release: (model: AircraftModel) => void,
): Wrecks {
  interface Slot {
    model: AircraftModel | null
    boxes: readonly HitBox[]
    base: Quaternion
    vx: number; vy: number; vz: number
    rx: number; ry: number; rz: number
    age: number
    timer: number
    sunk: boolean
    hideY: number
  }

  const slots: Slot[] = []
  for (let i = 0; i < capacity; i++) {
    slots.push({
      model: null, boxes: [], base: new Quaternion(),
      vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0,
      age: 0, timer: 0, sunk: false, hideY: -Infinity,
    })
  }
  let next = 0
  let live = 0

  const smokeEvents = createImpacts(capacity * 8)
  const sprayEvents = createImpacts(capacity)
  const splashEvents = createImpacts(capacity * WRECK_SPLASH_COLUMNS)

  function free(s: Slot): void {
    const m = s.model
    s.model = null
    if (m) release(m)
  }

  return {
    smokeEvents,
    sprayEvents,
    splashEvents,
    get live() { return live },

    adopt(model, boxes, vx, vy, vz, seed): void {
      const s = slots[next]!
      next = next + 1 >= capacity ? 0 : next + 1
      // 【滿了就回收最舊的】容量等於參戰架數，所以這在一場戰鬥之內不會發生；
      // 但若真的發生，覆蓋最舊的比拒絕新的好 —— 剛被打爆的那一架才是玩家
      // 正在看的。
      if (s.model) free(s)

      s.model = model
      s.boxes = boxes
      s.base.copy(model.group.quaternion)
      s.vx = vx
      s.vy = vy
      s.vz = vz
      s.rx = (hash01(seed * 3) * 2 - 1) * WRECK_SPIN
      s.ry = (hash01(seed * 3 + 1) * 2 - 1) * WRECK_SPIN
      s.rz = (hash01(seed * 3 + 2) * 2 - 1) * WRECK_SPIN
      s.age = 0
      s.timer = 0
      s.sunk = false
      s.hideY = -Infinity
      // 陣亡那一幀 main.ts 可能已經把它藏起來了
      model.group.visible = true
      // 【螺旋槳停轉】失去動力的飛機槳是停的。切回葉片（不是模糊圓盤），
      // 之後 step 不再動它。
      model.setPropSpin(0, false)
    },

    step(dt: number, heightAt: HeightField, time: number): void {
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
      clearImpacts(splashEvents)
      const damp = Math.exp(-WRECK_DRAG * dt)
      live = 0

      for (let i = 0; i < capacity; i++) {
        const s = slots[i]!
        const model = s.model
        if (!model) continue

        s.age += dt
        if (s.age >= WRECK_MAX_LIFE) {
          free(s)
          continue
        }

        s.vx *= damp
        s.vy = s.vy * damp + G * dt
        s.vz *= damp
        const g = model.group
        g.position.x += s.vx * dt
        g.position.y += s.vy * dt
        g.position.z += s.vz * dt

        tumble(s.rx, s.ry, s.rz, s.age, s.base, ROT)
        g.quaternion.copy(ROT)

        if (s.sunk) {
          // 【水下不模擬】運動完全不變 —— 海面不透明，這段沒有觀察者，
          // 為它寫水阻力是純粹的浪費（M8 spec §9.3）
          if (g.position.y < s.hideY) free(s)
          else live++
          continue
        }

        live++

        // 【冒煙只在水面上】沉下去之後看不見，繼續發射只是白費池子
        const puffs = smokePuffs(s.timer, dt, WRECK_SMOKE_INTERVAL)
        s.timer = smokeTimer(s.timer, dt, WRECK_SMOKE_INTERVAL)
        for (let k = 0; k < puffs; k++) {
          pushImpact(smokeEvents, g.position.x, g.position.y, g.position.z, 0, 1, 0)
        }

        // 【入水判定用 hitBox 的角點】殘骸是翻滾的，翼尖會比重心早很多碰到
        // 水；用重心判定會讓水花晚一整個翼展才出現（M8 spec §9.1）
        let lowY = Infinity
        for (const box of s.boxes) {
          const y = lowestPoint(box, g.quaternion, g.position, LOWEST)
          if (y < lowY) {
            lowY = y
            BEST.copy(LOWEST)
          }
        }
        // 浪高在最低角點的水平位置取樣 —— 海面振幅 ±2.15 m，在機身尺度上
        // 是有差別的
        const surface = heightAt(BEST.x, BEST.z, time)
        if (lowY > surface) continue

        s.sunk = true
        s.hideY = surface - WRECK_SINK_DEPTH
        pushImpact(sprayEvents, BEST.x, surface, BEST.z, 0, 1, 0)
        for (let k = 0; k < WRECK_SPLASH_COLUMNS; k++) {
          const a = hash01(i * 64 + k * 2) * Math.PI * 2
          const r = Math.sqrt(hash01(i * 64 + k * 2 + 1)) * WRECK_SPLASH_RADIUS
          pushImpact(
            splashEvents,
            BEST.x + Math.cos(a) * r, surface, BEST.z + Math.sin(a) * r,
            0, 1, 0,
          )
        }
      }
    },

    dispose(): void {
      for (const s of slots) free(s)
      live = 0
    },
  }
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/wrecks.test.ts && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 5: 確認「翼尖先碰到水」真的會抓錯**

把入水判定暫時改成只看 `g.position.y <= surface`（重心），跑測試。

Run: `npx vitest run test/unit/wrecks.test.ts`
Expected: 「翼尖先碰到水 —— 判定用 hitBox 的角點而不是重心」**變紅**。確認之後改回角點版本。

- [ ] **Step 6: Commit**

```bash
git add src/render/wrecks.ts test/unit/wrecks.test.ts
git commit -m "feat: 殘骸 —— 接管既有模型、翻滾墜落、以 hitBox 角點判定入水"
```

---

## Task 11: 接進 `main.ts`

**Files:**
- Modify: `src/main.ts`
- Test: 無新測試（`main.ts` 是 DOM 進入點，測試碰不到）。驗證靠瀏覽器與 draw call 計數，見 Step 6

**Interfaces:**
- Consumes: 前十個任務的全部產出
- Produces: 無（這是佈線）

- [ ] **Step 1: 加 import**

在 `src/main.ts` 既有的 render import 之後加：

```ts
import { createFireball, emitFireball } from './render/fireball'
import { createSmoke, emitSmoke } from './render/smoke'
import {
  createSpray, emitSpray, DEBRIS_SPRAY_COUNT, WATER_COLOR, WRECK_SPRAY_COUNT,
} from './render/spray'
import { createDebris } from './render/debris'
import { createWrecks } from './render/wrecks'
import { bodyColorOf } from './render/geometry/buildAircraft'
import { clearKills } from './world/kills'
```

- [ ] **Step 2: 讓 `Visual` 記得模型已經被交出去**

把 `interface Visual`（約 `main.ts:77`）改成：

```ts
interface Visual {
  model: AircraftModel
  readonly position: Vector3
  readonly quaternion: Quaternion
  /**
   * 模型已經交給殘骸池了嗎。
   *
   * 【為什麼需要這個旗標】殘骸池從此擁有那個 `group` 的位置與旋轉；每幀的
   * 內插迴圈若繼續寫它，殘骸會被釘在飛機死掉的地方一動也不動。
   */
  wrecked: boolean
}
```

`attachVisual` 的物件字面值加上 `wrecked: false,`。

**`rebuildModel` 不用動**：它只在玩家換機種時被呼叫，而玩家永遠不會被接管（見 Step 5）。

- [ ] **Step 3: 建立四個新池子**

在既有的三個特效池之後（約 `main.ts:100`）加：

```ts
// 【擊墜表現：+4 個 draw call】火球、黑煙、噴濺、零件。殘骸接管既有的
// AircraftModel，所以它 +0；水柱沿用 M7 的池子，也是 +0（M8 spec §11）
const fireball = createFireball()
ctx.scene.add(fireball.object)
const smoke = createSmoke()
ctx.scene.add(smoke.object)
const spray = createSpray(WATER_COLOR)
ctx.scene.add(spray.object)
const debris = createDebris()
ctx.scene.add(debris.object)
const wrecks = createWrecks(world.combatants.length, (m) => {
  ctx.scene.remove(m.group)
  m.dispose()
})

/** combatant 索引 → 機身色。零件用它上色 —— `World` 不需要知道有塗裝這回事。 */
const debrisColorOf = (index: number): number =>
  bodyColorOf(world.combatants[index]!.aircraft.spec)
```

- [ ] **Step 4: 在子步回呼裡排空擊墜事件**

在 `loop.advance` 的回呼裡，`clearImpacts(world.splashEvents)` 之後加：

```ts
    // 【火球與零件走事件】它們是世界錨定的一次性效果，用事件裡的子步位置
    // ——與火花同一個理由（M7 spec §2.2）。**玩家自己被擊墜時也要有**，
    // 而那正是「每幀比對 alive」做不到的事（M8 spec §2.1）
    emitFireball(fireball, world.killEvents)
    debris.emit(world.killEvents, debrisColorOf)
    clearKills(world.killEvents)
```

- [ ] **Step 5: 改寫每幀的模型更新迴圈**

把 `main.ts:259–269` 那個迴圈整段換掉：

```ts
  for (const c of world.combatants) {
    const v = visuals.get(c)!
    // 模型已經交給殘骸池，位置與旋轉從此由它寫
    if (v.wrecked) continue

    v.position.lerpVectors(c.aircraft.prevPosition, c.aircraft.state.position, alpha)
    v.quaternion.slerpQuaternions(c.aircraft.prevOrientation, c.aircraft.state.orientation, alpha)
    v.model.group.position.copy(v.position)
    v.model.group.quaternion.copy(v.quaternion)

    if (!c.alive) {
      // 【殘骸的判準是「還有沒有人要用這個模型」，不是「這是不是玩家」】
      // 玩家在上面幾行已經被 respawnPlayer 接回來，alive 於是又是 true ——
      // 所以他不留殘骸而 AI 留。專案負責人已載明未來玩家陣亡會改成接手
      // 僚機的飛機，那時他的 alive 會維持 false，這裡不用改一個字就會
      // 自動留下殘骸（M8 spec §10）。
      //
      // 【為什麼先內插再接管】殘骸的起始姿態必須接在畫面上最後看到的位置。
      // 用擊墜事件裡的子步位置會跳最多 0.83 m（M8 spec §3.1）。
      v.wrecked = true
      const vel = c.aircraft.state.velocity
      wrecks.adopt(v.model, c.aircraft.spec.hitBoxes, vel.x, vel.y, vel.z, c.index)
      continue
    }

    v.model.group.visible = true
    v.model.setPropSpin(propRotation, c.command.throttle > 0.15)
  }
```

**注意**：這一段必須留在 `if (!player.alive) respawnPlayer()`（`main.ts:254`）**之後** —— 那個順序正是玩家不留殘骸的機制本身。

- [ ] **Step 6: 每幀步進四個新池子**

在既有的 `sparks.step(frameSeconds)` / `splashes.step(frameSeconds)` 旁邊（約 `main.ts:290`）加：

```ts
  // 【殘骸與零件先步進，再把它們吐出來的事件餵給煙、噴濺與水柱】兩者的
  // 事件緩衝在各自的 step 開頭排空，所以這裡讀到的恆是這一幀的
  wrecks.step(frameSeconds, ocean.heightAt, elapsed)
  debris.step(frameSeconds, ocean.heightAt, elapsed)
  emitSmoke(smoke, wrecks.smokeEvents)
  emitSmoke(smoke, debris.smokeEvents)
  emitSpray(spray, wrecks.sprayEvents, WRECK_SPRAY_COUNT)
  emitSpray(spray, debris.sprayEvents, DEBRIS_SPRAY_COUNT)
  // 殘骸入水的那一圈水柱沿用 M7 的池子 —— 用數量換規模，splash.ts 不用改
  splashes.emit(wrecks.splashEvents, ocean.heightAt, elapsed)
  fireball.step(frameSeconds)
  smoke.step(frameSeconds)
  spray.step(frameSeconds)
```

- [ ] **Step 7: 型別檢查與完整測試**

Run: `npm run build && npx vitest run`
Expected: build 乾淨、全部測試通過

- [ ] **Step 8: 瀏覽器驗證**

```bash
npm run dev
```

在瀏覽器開啟後，用效能覆蓋層確認 **draw call 由 593 變成 597**（+4，M8 spec §11）。開 AI 接管（讓玩家自動飛）觀察一次擊墜，確認：

1. 有火球、有往前噴的零件、有黑煙
2. 殘骸在翻滾墜落，螺旋槳是停的
3. 主控台**零錯誤**（著色器編譯失敗會在這裡出現 —— 那是單元測試抓不到的）

**若主控台出現 GLSL 編譯錯誤，那是 Task 4 的著色器注入問題，回去修那裡**，不要在 `main.ts` 想辦法繞過。

看完之後停掉 dev server。

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "feat: 把擊墜表現接進 main —— 火球、零件走事件，殘骸接管模型"
```

---

## Task 12: 整合測試與交付紀錄

**Files:**
- Modify: `test/integration/multi-battle.test.ts`
- Modify: `docs/superpowers/specs/2026-08-04-kill-effects-design.md`（加 §17 交付紀錄）
- Test: 同上

**Interfaces:**
- Consumes: `world.killEvents`（Task 1）
- Produces: 無

- [ ] **Step 1: 在 20v20 整合測試裡觀察擊墜事件**

在 `test/integration/multi-battle.test.ts` 既有的 20v20 案例裡，加上兩個觀測量。在跑迴圈之前宣告：

```ts
  let killEventTotal = 0
  let killsDropped = 0
```

在既有排空 `hitEvents` / `splashEvents` 的地方（子步回呼裡）加：

```ts
    killEventTotal += world.killEvents.count
    killsDropped = world.killEvents.dropped
    clearKills(world.killEvents)
```

（記得 `import { clearKills } from '../../src/world/kills'`。）

在斷言區加：

```ts
  it('擊墜事件數恰好等於陣亡數 —— 不多也不少', () => {
    // 【為什麼「不多」也要測】respawnOnDestroy 的靶機被打爆會走 respawn 而
    // 不是真的陣亡；若事件推在那個分支之前，一架靶機會生出無限多次爆炸。
    const dead = world.combatants.filter((c) => !c.alive).length
    expect(killEventTotal).toBe(dead)
  })

  it('擊墜事件緩衝從未溢位', () => {
    // 【為什麼這條測得起來】容量由 World.add() 維持在參戰架數，而一個子步
    // 之內每架最多死一次 —— 溢位應該是結構上不可能的。這條把「應該」變成
    // 「測過了」。掉一次擊墜等於少一次爆炸（M8 spec §14.1.1）。
    expect(killsDropped).toBe(0)
  })
```

- [ ] **Step 2: 跑整合測試**

Run: `npx vitest run test/integration/multi-battle.test.ts`
Expected: 全過。**若「恰好等於陣亡數」失敗，先確認 `pushKill` 是不是被放在 `respawnOnDestroy` 分支之前**（Task 1 Step 5 的注意事項）。

- [ ] **Step 3: 確認溢位那一條真的會抓錯**

把 `World.add()` 裡維持容量的那段暫時註解掉（於是容量恆為 0），跑整合測試。

Run: `npx vitest run test/integration/multi-battle.test.ts`
Expected: 兩條都**變紅**（`killEventTotal` 為 0、`killsDropped` 大於 0）。確認之後改回來。

- [ ] **Step 4: 確認效能閘門沒有被動到**

Run: `npx vitest run test/unit/perf-gate.test.ts`
Expected: PASS，且 `MULTI_BUDGET_US` 仍然是 **300**。

**若它變紅，表示有東西跑進了物理迴圈** —— 擊墜表現應該全在渲染層。回去查是不是把某個 `step` 放進了 `loop.advance` 的回呼裡（M8 spec §13.3）。

- [ ] **Step 5: 確認分層界線**

Run: `grep -rn "from '\.\./render\|from './render" src/world/`
Expected: 無輸出（M8 spec §14.1.2）

- [ ] **Step 6: 跑完整套件與 build**

Run: `npx vitest run && npm run build`
Expected: 全過、build 乾淨

- [ ] **Step 7: 在 spec 加交付紀錄**

在 `docs/superpowers/specs/2026-08-04-kill-effects-design.md` 的 §15 之後加一節，逐項列出**實作與 spec 的偏離**。至少要記錄以下已知的三項（實作過程若有別的偏離，一併補上，每項都要寫「為什麼」）：

```markdown
## 17. 交付紀錄

### 17.1 與 spec 的偏離

| 項目 | spec 怎麼寫 | 實際怎麼做 | 為什麼 |
|---|---|---|---|
| `KillEvents.dropped` | §3 說「因此不需要 `dropped` 計數器」 | 保留了 | 「結構上不可能溢位」是一個推導，而推導要有東西驗證它。這個欄位存在的唯一目的是讓整合測試寫得出 `expect(dropped).toBe(0)`。掉一次擊墜等於少一次爆炸，不能默默發生 |
| `SPRAY_LIFE` | §12 的總表沒有列 | 補上 0.6 s | 25 m/s 配阻尼 2 s⁻¹，0.6 s 內飛約 10 m —— 與水柱的 12 m 同一個尺度，兩者一起讀起來才是同一次撞擊 |
| 殘骸的觸發來源 | §2.1 說擊墜走事件緩衝 | 火球、零件、煙走事件；**殘骸走「模型還有沒有人要用」這個狀態** | 兩者問的不是同一個問題。火球問「這一步發生了擊墜嗎」——玩家的也算，所以非事件不可。殘骸問「這個 `AircraftModel` 可以交出去了嗎」，那等價於「`alive` 為 false 且沒有人要重生它」，而玩家在 `respawnPlayer` 之後 `alive` 又是 true。用同一個判準反而更貼近 §10 的規則：那不是關於玩家，是關於模型的所有權 |

### 17.2 驗收條件的狀態

§14.1 的十條自動化條件全部有對應的測試。§14.2 的九條（第 11–19 條）是人工驗收，交給專案負責人。
```

- [ ] **Step 8: Commit**

```bash
git add test/integration/multi-battle.test.ts docs/superpowers/specs/2026-08-04-kill-effects-design.md
git commit -m "test: 20v20 擊墜事件的整合觀測，並補上 M8 交付紀錄"
```

---

## 完成後

全部十二個任務做完之後：

1. `npx vitest run` 全綠、`npm run build` 乾淨
2. `npm run dev` 手動確認 M8 spec §14.2 的第 11–19 條人工驗收條件
3. 把結果回報給專案負責人 —— 那九條是只有他能結的帳

**REQUIRED SUB-SKILL:** 收尾時使用 `superpowers:finishing-a-development-branch`。
