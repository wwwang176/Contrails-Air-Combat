# 投彈瞄具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 轟炸機按 `B` 切到機腹視角，畫面上一個圓準星標出「現在投會落在哪」，左鍵真的投得下去、真的落海濺水。

**Architecture:** 彈道是一支純函數 `stepBomb`；準星的預測與空中的炸彈**共用它、共用同一個 `dt`**，所以兩者不可能分家。相機加第三個 `viewMode`，視線自動指向落點、夾進機體 −Y 的 70° 圓錐、以時間常數 slerp 過去。落海走現成的 `world.splashEvents` → `render/splash.ts`，不新增管道。

**Tech Stack:** TypeScript、three.js、vitest。`world/bomb.ts` 與 `camera/bombsight.ts` **不 import three**（要能在 node 裡測）。

**Spec:** `docs/superpowers/specs/2026-09-04-bombsight-design.md`

## Global Constraints

- 重力用 `core/math.ts` 既有的 `G0 = 9.80665`，**不得新增第二個重力常數**。
- 熱路徑零配置：`stepBomb`、`solveImpact`、`coneClamp` 內部不得 `new`；輸出就地寫入。
- `world/bomb.ts`、`camera/bombsight.ts` 不得 `import ... from 'three'`。
- 物理步 240 Hz，`World.step(dt)` 內；預測與模擬**必須用同一支 `stepBomb`**。
- 註解寫現狀不寫沿革（`docs` 既有紀律）；設計值一律標「起始值，由試飛裁定」。
- 提交訊息結尾只加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`，**不附 session 網址**。
- 每個 Task 結束前 `npx tsc --noEmit` 的 `src/` 必須 0 錯誤。

---

### Task 1: 彈道核心

**Files:**
- Create: `src/world/bomb.ts`
- Test: `test/unit/bomb.test.ts`

**Interfaces:**
- Consumes: `G0` from `src/core/math.ts`
- Produces:
  - `BOMB_TERMINAL_SPEED: number`、`BOMB_MAX_SECONDS: number`
  - `bombDragK(terminalSpeed: number): number`
  - `interface BombState { x, y, z, vx, vy, vz: number }`
  - `stepBomb(s: BombState, k: number, dt: number): void`
  - `interface Impact { x, y, z, seconds, speed: number }`
  - `solveImpact(s: BombState, k: number, groundAt: (x: number, z: number) => number, dt: number, out: Impact): boolean`

- [ ] **Step 1: 寫失敗的測試**

`test/unit/bomb.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { G0 } from '../../src/core/math'
import {
  BOMB_TERMINAL_SPEED, bombDragK, stepBomb, solveImpact,
  type BombState, type Impact,
} from '../../src/world/bomb'

const DT = 1 / 240
const SEA = () => 0
const state = (o: Partial<BombState>): BombState =>
  ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ...o })
const impact = (): Impact => ({ x: 0, y: 0, z: 0, seconds: 0, speed: 0 })

describe('stepBomb', () => {
  it('無阻力時就是等加速度自由落體', () => {
    const s = state({ y: 1000 })
    for (let i = 0; i < 240; i++) stepBomb(s, 0, DT)
    // 半隱式歐拉一秒之後：v = −g、y = 1000 − g(1 + dt)/2 … 取寬一點的容差
    expect(s.vy).toBeCloseTo(-G0, 6)
    expect(s.y).toBeCloseTo(1000 - G0 / 2, 1)
  })

  it('阻力讓垂直速度收斂到終端速度', () => {
    const s = state({ y: 100000 })
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 120; i++) stepBomb(s, k, DT)
    expect(Math.abs(s.vy)).toBeCloseTo(BOMB_TERMINAL_SPEED, 0)
  })

  it('阻力同時減速水平分量 —— 那就是 trail', () => {
    const s = state({ y: 4000, vz: -90 })
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 10; i++) stepBomb(s, k, DT)
    expect(Math.abs(s.vz)).toBeLessThan(90)
  })
})

describe('solveImpact', () => {
  it('無阻力時對得上解析解 t = √(2h/g)、x = v·t', () => {
    const out = impact()
    const ok = solveImpact(state({ y: 4000, vz: -90 }), 0, SEA, DT, out)
    expect(ok).toBe(true)
    const t = Math.sqrt((2 * 4000) / G0)
    expect(out.seconds).toBeCloseTo(t, 1)
    expect(out.z).toBeCloseTo(-90 * t, 0)
    expect(out.y).toBeCloseTo(0, 6)
  })

  it('有阻力時前拋比真空短 —— 4,000 m 落在 2,100~2,350 m', () => {
    const out = impact()
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    expect(solveImpact(state({ y: 4000, vz: -90 }), k, SEA, DT, out)).toBe(true)
    expect(-out.z).toBeGreaterThan(2100)
    expect(-out.z).toBeLessThan(2350)
    expect(out.seconds).toBeGreaterThan(30)
    expect(out.speed).toBeGreaterThan(200)
  })

  it('爬升中投彈：先上升再落下，不在第一步就終止', () => {
    const out = impact()
    // 起點恰在地面高度上，速度朝上 —— 沒有「先走一步」就會立刻判落地
    const ok = solveImpact(state({ y: 0.5, vy: 60 }), 0, SEA, DT, out)
    expect(ok).toBe(true)
    expect(out.seconds).toBeGreaterThan(10)
  })

  it('落點取的是地形高度，不是海平面', () => {
    const out = impact()
    const hill = (_x: number, z: number) => (z < -1000 ? 600 : 0)
    expect(solveImpact(state({ y: 4000, vz: -90 }), 0, hill, DT, out)).toBe(true)
    expect(out.y).toBeCloseTo(600, 0)
  })

  it('永遠落不下來就回 false', () => {
    const out = impact()
    // 無重力、無阻力、水平飛 —— 這條軌跡碰不到地面
    expect(solveImpact(state({ y: 4000, vz: -90 }), 0, () => -Infinity, DT, out)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/bomb.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/world/bomb"`

- [ ] **Step 3: 寫實作**

`src/world/bomb.ts`：

```ts
import { G0 } from '../core/math'

/**
 * 炸彈的終端速度，m/s。**起始值，由試飛裁定**（性質同 `WOBBLE_AMPLITUDE`）。
 *
 * 【為什麼可調的是終端速度而不是 Cd·A/m】那三個量只以 `g/vt²` 的組合出現，
 * 拆開來寫是三個互相抵銷的旋鈕。終端速度是查得到、也能直接在試飛裡讀出來
 * 的量（落地速度），280 m/s 是 500 lb 通用炸彈的量級。
 */
export const BOMB_TERMINAL_SPEED = 280

/**
 * 解算與飛行的時間上限，秒。
 *
 * 【90 怎麼來】8,000 m 投下落地 47.9 s（spec §1 的量測），留近一倍餘裕。
 * 超過它 `solveImpact` 回 false、空中的炸彈直接回收。
 */
export const BOMB_MAX_SECONDS = 90

/** 二次阻力係數：`a = −k·|v|·v`。由終端速度反推 —— 終端時阻力恰好抵銷重力 */
export function bombDragK(terminalSpeed: number): number {
  return G0 / (terminalSpeed * terminalSpeed)
}

export interface BombState {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

/** 落點。就地寫入 —— 熱路徑不得配置 */
export interface Impact {
  x: number
  y: number
  z: number
  /** 飛行時間，秒 */
  seconds: number
  /** 落地速度，m/s */
  speed: number
}

/**
 * 推進一步。半隱式歐拉（先速度後位置），與 `Projectiles.step` 同一個形狀。
 *
 * 【為什麼不是 RK4】1/240 之下歐拉與 RK4 在這條軌跡上的差距，遠小於把步長
 * 放寬到 1/4 造成的差（量過：4,000 m 的前拋差 < 3 m）。而 RK4 會讓「準星的
 * 預測與空中的炸彈逐位元相同」這條護欄變成四次求值都要對齊 —— 用不上的精度
 * 換來更難守的不變式。
 */
export function stepBomb(s: BombState, k: number, dt: number): void {
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz)
  s.vx += -k * sp * s.vx * dt
  s.vy += (-G0 - k * sp * s.vy) * dt
  s.vz += -k * sp * s.vz * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  s.z += s.vz * dt
}

/** `solveImpact` 內部重用的狀態 —— 模組層級的單例，避免每幀配置 */
const SIM: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }

/**
 * 「現在投會落在哪」。**跑的是與空中的炸彈完全相同的 `stepBomb` 與 `dt`。**
 *
 * 【為什麼不省步數】最壞情況（8,000 m）是 11,498 步，60 fps 下約 69 萬步/秒，
 * 相對於 40 架 × 240 Hz 的飛行物理可以忽略。粗步長也量過（`dt` 放寬到 1/4
 * 只差 3 m）—— 便宜到不必省，所以不省：省下來換到的是準星與水柱分家，而且
 * 分家的程度會**隨畫面更新率變動**。
 *
 * @param s        起始狀態。**不會被修改**
 * @param groundAt 該點的地面高度。出界請回 `-Infinity`（呼叫端的既有慣例）
 * @returns 落地為 true；`BOMB_MAX_SECONDS` 內落不下來為 false
 */
export function solveImpact(
  s: BombState,
  k: number,
  groundAt: (x: number, z: number) => number,
  dt: number,
  out: Impact,
): boolean {
  SIM.x = s.x; SIM.y = s.y; SIM.z = s.z
  SIM.vx = s.vx; SIM.vy = s.vy; SIM.vz = s.vz

  const steps = Math.ceil(BOMB_MAX_SECONDS / dt)
  for (let i = 0; i < steps; i++) {
    const py = SIM.y
    const px = SIM.x
    const pz = SIM.z
    stepBomb(SIM, k, dt)
    const g = groundAt(SIM.x, SIM.z)
    if (!(SIM.y <= g)) continue

    // 【落地那一步要內插】一步走 1 m 以上，不內插的話落點系統性偏過頭
    const drop = py - SIM.y
    const t = drop > 1e-9 ? (py - g) / drop : 0
    out.x = px + (SIM.x - px) * t
    out.y = g
    out.z = pz + (SIM.z - pz) * t
    out.seconds = (i + t) * dt
    out.speed = Math.sqrt(SIM.vx * SIM.vx + SIM.vy * SIM.vy + SIM.vz * SIM.vz)
    return true
  }
  return false
}
```

【`continue` 用 `!(y <= g)` 而不是 `y > g`】`groundAt` 出界回 `-Infinity`，
兩者在那裡等價；但寫成否定式時 `NaN` 也會走 `continue` 而不是誤判成落地。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/bomb.test.ts`
Expected: PASS（6 個 it 全綠）

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: `src/` 0 錯誤（`test/` 的既有錯誤不算）

- [ ] **Step 6: Commit**

```bash
git add src/world/bomb.ts test/unit/bomb.test.ts
git commit -m "feat(bomb): 彈道核心 —— stepBomb 與 solveImpact 共用同一支積分"
```

---

### Task 2: 圓錐夾制

**Files:**
- Create: `src/camera/bombsight.ts`
- Test: `test/unit/bombsight.test.ts`

**Interfaces:**
- Consumes: 無（純數學，不 import three）
- Produces:
  - `BOMB_CONE_HALF_ANGLE: number`（弧度）
  - `interface Vec3Like { x: number; y: number; z: number }`
  - `coneClamp(dx, dy, dz, ax, ay, az, cosHalf, sinHalf, out: Vec3Like): boolean`
    —— 回傳 true 代表**有夾制**（`bombState: 'clamped'`）

- [ ] **Step 1: 寫失敗的測試**

`test/unit/bombsight.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { BOMB_CONE_HALF_ANGLE, coneClamp, type Vec3Like } from '../../src/camera/bombsight'

const COS = Math.cos(BOMB_CONE_HALF_ANGLE)
const SIN = Math.sin(BOMB_CONE_HALF_ANGLE)
const out = (): Vec3Like => ({ x: 0, y: 0, z: 0 })
const angleTo = (v: Vec3Like, ax: number, ay: number, az: number) =>
  Math.acos(Math.max(-1, Math.min(1, v.x * ax + v.y * ay + v.z * az)))

describe('coneClamp', () => {
  it('圓錐半角是 70 度', () => {
    expect(BOMB_CONE_HALF_ANGLE).toBeCloseTo((70 * Math.PI) / 180, 12)
  })

  it('錐內不動', () => {
    const o = out()
    // 天底軸 (0,−1,0)，方向偏 30°
    const a = (30 * Math.PI) / 180
    const clamped = coneClamp(Math.sin(a), -Math.cos(a), 0, 0, -1, 0, COS, SIN, o)
    expect(clamped).toBe(false)
    expect(o.x).toBeCloseTo(Math.sin(a), 9)
    expect(o.y).toBeCloseTo(-Math.cos(a), 9)
  })

  it('錐外落在錐面上，與軸恰好夾 70 度', () => {
    const o = out()
    // 水平方向（離天底 90°）
    const clamped = coneClamp(1, 0, 0, 0, -1, 0, COS, SIN, o)
    expect(clamped).toBe(true)
    expect(angleTo(o, 0, -1, 0)).toBeCloseTo(BOMB_CONE_HALF_ANGLE, 9)
    // 夾制只把方向拉回錐面，方位角不變 —— 仍在 +X 那一側
    expect(o.x).toBeGreaterThan(0)
    expect(o.z).toBeCloseTo(0, 9)
  })

  it('恆不在軸的 70 度之外 —— 抬頭是不可能的', () => {
    const o = out()
    for (const [dx, dy, dz] of [[0, 1, 0], [0, 0.9, 0.44], [-0.7, 0.7, 0], [0, 0.999, 0.045]]) {
      const n = Math.hypot(dx!, dy!, dz!)
      coneClamp(dx! / n, dy! / n, dz! / n, 0, -1, 0, COS, SIN, o)
      expect(angleTo(o, 0, -1, 0)).toBeLessThanOrEqual(BOMB_CONE_HALF_ANGLE + 1e-9)
    }
  })

  it('與軸恰好反向時不產生 NaN', () => {
    const o = out()
    expect(coneClamp(0, 1, 0, 0, -1, 0, COS, SIN, o)).toBe(true)
    expect(Number.isFinite(o.x)).toBe(true)
    expect(Number.isFinite(o.y)).toBe(true)
    expect(Number.isFinite(o.z)).toBe(true)
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 9)
  })

  it('圓錐軸是機體固定的 —— 側滾 60° 時錐跟著轉', () => {
    const o = out()
    // 右滾 60°，機腹軸由 (0,−1,0) 轉到 (−sin60, −cos60, 0)
    const ax = -Math.sin(Math.PI / 3), ay = -Math.cos(Math.PI / 3)
    // 正下方 (0,−1,0) 離這根軸 60°，仍在錐內 → 不夾制
    expect(coneClamp(0, -1, 0, ax, ay, 0, COS, SIN, o)).toBe(false)
    // 但離軸 80° 的方向會被夾
    const a = (80 * Math.PI) / 180
    const dx = ax * Math.cos(a) - ay * Math.sin(a)
    const dy = ay * Math.cos(a) + ax * Math.sin(a)
    expect(coneClamp(dx, dy, 0, ax, ay, 0, COS, SIN, o)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/bombsight.test.ts`
Expected: FAIL —— 找不到 `src/camera/bombsight`

- [ ] **Step 3: 寫實作**

`src/camera/bombsight.ts`：

```ts
/**
 * 投彈視線的圓錐半角，弧度。**專案負責人指定 70°。**
 *
 * 【它是安全網不是常態限制】量測（spec §1）：B-17G 巡航 90 m/s 之下，落點
 * 離天底的角度在 4,000 m 是 29°、1,000 m 是 50°，要到**高度 200 m** 才達到
 * 70°。平飛投彈時這個錐永遠不作用；它只擋兩種退化情況 —— 貼地投彈（落點跑
 * 到地平線上）、投彈航路上大幅機動（機腹軸被姿態帶歪）。
 *
 * 【軸是機體固定的】負責人裁定。等於「機腹上的一個窗口」：側滾大了看到的
 * 就是天，機動中投不了彈。
 */
export const BOMB_CONE_HALF_ANGLE = (70 * Math.PI) / 180

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/**
 * 把單位方向 `d` 夾進以單位向量 `a` 為軸、半角為 `acos(cosHalf)` 的圓錐。
 * 就地寫進 `out`（熱路徑不得配置）。
 *
 * `cosHalf` / `sinHalf` 由呼叫端預先算好 —— 半角是常數，每幀重算兩個三角
 * 函數沒有意義。
 *
 * @returns 有沒有夾制。true 對應 HUD 的 `clamped` 狀態 —— 圓圈不在真正的
 *          落點上，必須看得出來
 */
export function coneClamp(
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  cosHalf: number, sinHalf: number,
  out: Vec3Like,
): boolean {
  const dot = dx * ax + dy * ay + dz * az
  if (dot >= cosHalf) {
    out.x = dx; out.y = dy; out.z = dz
    return false
  }

  // d 在垂直於 a 的平面上的分量，正規化後就是錐面上最近的那個方位
  let nx = dx - ax * dot
  let ny = dy - ay * dot
  let nz = dz - az * dot
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (len < 1e-9) {
    // 【d 與 a 恰好反向】方位角未定義。取任一與 a 垂直的方向 —— 那個姿態下
    // 畫面上是什麼都無所謂，重點是不能吐出 NaN（同 CameraRig 對天頂的處理）
    const px = Math.abs(ax) < 0.9 ? 1 : 0
    const py = Math.abs(ax) < 0.9 ? 0 : 1
    const d2 = px * ax + py * ay
    nx = px - ax * d2
    ny = py - ay * d2
    nz = -az * d2
    const l2 = Math.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= l2; ny /= l2; nz /= l2
  } else {
    nx /= len; ny /= len; nz /= len
  }

  out.x = ax * cosHalf + nx * sinHalf
  out.y = ay * cosHalf + ny * sinHalf
  out.z = az * cosHalf + nz * sinHalf
  return true
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/bombsight.test.ts`
Expected: PASS（6 個 it 全綠）

- [ ] **Step 5: Commit**

```bash
git add src/camera/bombsight.ts test/unit/bombsight.test.ts
git commit -m "feat(bomb): 視線的 70 度圓錐夾制 —— 軸是機腹方向，機體固定"
```

---

### Task 3: 炸彈池與 World 接線

**Files:**
- Modify: `src/world/bomb.ts`（追加 `Bombs` 池）
- Modify: `src/world/World.ts`（`groundAt`、`bombs`、`step` 內推進）
- Test: `test/unit/bomb.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `stepBomb` / `bombDragK` / `BOMB_MAX_SECONDS`；
  `pushImpact` from `src/world/events.ts`；`World.splashEvents`（既有）
- Produces:
  - `BOMBS_CAPACITY: number`
  - `class Bombs`：`live`、`spawn(x,y,z,vx,vy,vz): number`、`clear()`、
    `step(dt, k, groundAt, onImpact)`；SoA 欄位 `x/y/z/vx/vy/vz/age/active`
  - `World.groundAt: (x: number, z: number) => number`
  - `World.waterAt: (x: number, z: number) => number`
  - `World.bombs: Bombs`
  - `World.dropBomb(x, y, z, vx, vy, vz): void`

- [ ] **Step 1: 寫失敗的測試**

追加到 `test/unit/bomb.test.ts`：

```ts
import { Bombs, BOMBS_CAPACITY, BOMB_MAX_SECONDS } from '../../src/world/bomb'

describe('Bombs 池', () => {
  it('投下去、飛、落地時回報一次', () => {
    const b = new Bombs()
    b.spawn(0, 4000, 0, 0, 0, -90)
    expect(b.live).toBe(1)
    const hits: number[][] = []
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    for (let i = 0; i < 240 * 60 && b.live > 0; i++) {
      b.step(DT, k, SEA, (x, y, z) => hits.push([x, y, z]))
    }
    expect(hits).toHaveLength(1)
    expect(b.live).toBe(0)
  })

  it('護欄：預測與實跑落在同一點', () => {
    const k = bombDragK(BOMB_TERMINAL_SPEED)
    const start = state({ y: 4000, vz: -90 })
    const out = impact()
    expect(solveImpact(start, k, SEA, DT, out)).toBe(true)

    const b = new Bombs()
    b.spawn(start.x, start.y, start.z, start.vx, start.vy, start.vz)
    let hit: number[] | null = null
    for (let i = 0; i < 240 * 60 && b.live > 0; i++) {
      b.step(DT, k, SEA, (x, y, z) => { hit = [x, y, z] })
    }
    expect(hit).not.toBeNull()
    // 【逐位元，不是「很接近」】兩邊跑同一支 stepBomb、同一個 dt、同一種
    // 精度（池子是 Float64Array，見那裡的註解），連落地的內插都是同一段
    // 算式。**用 toBe 而不是 toBeCloseTo** —— 只要有人把池子改回 float32，
    // 或替其中一邊「順手優化」一個分支，這一條就會紅。
    expect(hit![0]).toBe(out.x)
    expect(hit![2]).toBe(out.z)
  })

  it('超過壽命就回收，不會永遠佔著槽位', () => {
    const b = new Bombs()
    b.spawn(0, 4000, 0, 0, 0, 0)
    let n = 0
    // groundAt 回 −Infinity → 永遠碰不到地面
    for (let i = 0; i < Math.ceil(BOMB_MAX_SECONDS / DT) + 10; i++) {
      b.step(DT, 0, () => -Infinity, () => { n++ })
    }
    expect(n).toBe(0)
    expect(b.live).toBe(0)
  })

  it('池滿了覆寫最舊的，不拒絕投彈', () => {
    const b = new Bombs()
    for (let i = 0; i < BOMBS_CAPACITY + 5; i++) b.spawn(0, 1000, 0, 0, 0, 0)
    expect(b.live).toBe(BOMBS_CAPACITY)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/bomb.test.ts`
Expected: FAIL —— `Bombs is not exported`

- [ ] **Step 3: 追加 `Bombs` 到 `src/world/bomb.ts`**

```ts
/**
 * 池子大小。
 *
 * 【64 怎麼來】玩家單次最多 8 顆同時在空中（4,000 m 落地要 31 秒，全投完
 * 第一顆還沒落地）。64 是留給日後 AI 投彈的餘裕，而且相對
 * `PROJECTILE_CAPACITY = 4000` 可以忽略。
 */
export const BOMBS_CAPACITY = 64

/** 落地回呼。**不得配置** —— 一步之內可能呼叫好幾次 */
export type BombImpactFn = (x: number, y: number, z: number, speed: number) => void

/**
 * 空中的炸彈。SoA，形狀照 `Projectiles` —— 型別化陣列、環狀寫入指標、
 * 池滿時覆寫最舊的而不是拒絕投彈。
 *
 * 【**但精度用 Float64Array，與 `Projectiles` 不同**】「準星的預測與空中的
 * 炸彈逐位元相同」這條護欄靠的是兩邊跑同一支 `stepBomb`，而 `solveImpact`
 * 的狀態全程在一般 `number`（float64）裡。這裡若存 float32，每一步都會捨入
 * 一次 —— 4,000 m 那個案例實算差 0.00378 m，護欄測試直接紅。
 * 64 格 × 6 欄 × 8 bytes = 3 KB，換一條真的成立的不變式。
 */
export class Bombs {
  readonly capacity: number
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array
  readonly age: Float64Array
  readonly active: Uint8Array

  private cursor = 0
  private liveCount = 0
  private readonly sim: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }

  constructor(capacity: number = BOMBS_CAPACITY) {
    this.capacity = capacity
    const f = (): Float64Array => new Float64Array(capacity)
    this.x = f(); this.y = f(); this.z = f()
    this.vx = f(); this.vy = f(); this.vz = f()
    this.age = f()
    this.active = new Uint8Array(capacity)
  }

  get live(): number { return this.liveCount }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number): number {
    const i = this.cursor
    this.cursor = (i + 1) % this.capacity
    if (this.active[i] === 0) this.liveCount++
    this.x[i] = x; this.y[i] = y; this.z[i] = z
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
    this.age[i] = 0
    this.active[i] = 1
    return i
  }

  clear(): void {
    this.active.fill(0)
    this.liveCount = 0
    this.cursor = 0
  }

  /**
   * 推進一步。**用的是與 `solveImpact` 相同的 `stepBomb`。**
   *
   * @param groundAt 該點的地面高度，出界回 `-Infinity`
   * @param onImpact 落地回呼。落地的那一顆在回呼之前就已經回收
   */
  step(dt: number, k: number, groundAt: (x: number, z: number) => number, onImpact: BombImpactFn): void {
    const s = this.sim
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue

      const age = this.age[i]! + dt
      if (age > BOMB_MAX_SECONDS) {
        this.active[i] = 0
        this.liveCount--
        continue
      }
      this.age[i] = age

      const py = this.y[i]!
      const px = this.x[i]!
      const pz = this.z[i]!
      s.x = px; s.y = py; s.z = pz
      s.vx = this.vx[i]!; s.vy = this.vy[i]!; s.vz = this.vz[i]!
      stepBomb(s, k, dt)
      this.x[i] = s.x; this.y[i] = s.y; this.z[i] = s.z
      this.vx[i] = s.vx; this.vy[i] = s.vy; this.vz[i] = s.vz

      const g = groundAt(s.x, s.z)
      if (!(s.y <= g)) continue

      // 內插與 solveImpact 逐字相同 —— 兩邊差一個字就是準星與水柱分家
      const drop = py - s.y
      const t = drop > 1e-9 ? (py - g) / drop : 0
      this.active[i] = 0
      this.liveCount--
      onImpact(
        px + (s.x - px) * t, g, pz + (s.z - pz) * t,
        Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz),
      )
    }
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/bomb.test.ts`
Expected: PASS（10 個 it 全綠）

- [ ] **Step 4b: 追加落陸不噴水柱的測試**

追加到 `test/unit/bomb.test.ts`（放在 `Bombs 池` 那個 describe 之後）：

```ts
import { World } from '../../src/world/World'
import { BOMB_SPLASH_JETS } from '../../src/world/bomb'

describe('落地事件的水陸之分', () => {
  const runToImpact = (waterAt: (x: number, z: number) => number) => {
    const w = new World()
    w.groundAt = () => 0
    w.waterAt = waterAt
    w.dropBomb(0, 500, 0, 0, 0, 0)
    for (let i = 0; i < 240 * 30 && w.bombs.live > 0; i++) w.step(DT)
    return w.splashEvents.count
  }

  it('落海推 BOMB_SPLASH_JETS 根柱子 —— 用數量換規模', () => {
    expect(runToImpact(() => 0)).toBe(BOMB_SPLASH_JETS)
  })

  it('落在陸地上什麼都不推 —— 純內陸地圖每一顆都會噴才是缺陷', () => {
    expect(runToImpact(() => -Infinity)).toBe(0)
  })
})
```

【`splashEvents` 在子步開頭不會被 `World` 清掉】排空是呼叫端的事
（`main.ts` 讀完才 `clearImpacts`），所以這裡跑完直接讀 `count` 是對的。
若 `World.step` 的既有實作會清它，就改成在回呼裡自己數。

- [ ] **Step 5: 接進 `World`**

`src/world/World.ts`：

1. import 追加 `import { Bombs, bombDragK, BOMB_TERMINAL_SPEED } from './bomb'`
   與既有的 `pushImpact`（`./events` 已經 import 過 `createImpacts`，補上 `pushImpact`）。
2. 欄位（放在 `readonly projectiles = new Projectiles()` 之後）：

```ts
  readonly bombs = new Bombs()

  /**
   * 該點的**判定用**地面高度，m。海面是平的（0），陸地讀高度場。
   *
   * 【為什麼是注入的而不是自己讀 `this.land.field`】自己讀就要自己寫一次
   * 「海面是平的」，而那條規則的權威在 `render/terrain.ts` 的
   * `collisionHeightAt`（負責人 2026-08-28 裁定）。抄一份就是第二份真相。
   * 與 `crashPolicy` 同一個注入方式。
   */
  groundAt: (x: number, z: number) => number = () => 0

  /**
   * 該點的**水面**高度，m。沒有水的地方回 `-Infinity`（`terrain.waterAt`）。
   *
   * 【為什麼要第二支而不是用 `groundAt` 判斷】`groundAt` 回的是「陸地與平海
   * 取 max」，答不出「這裡碰到的是水嗎」。少了這一支，炸彈落在島上會噴水柱
   * —— `render/debris.ts` 已經為同一個坑留過註解（「只有落水才噴濺」），
   * 而純內陸地圖上那是**每一顆**都會發生。
   */
  waterAt: (x: number, z: number) => number = () => 0

  /** 炸彈的阻力係數。與 `groundAt` 一樣由外面決定，World 不持有設計值 */
  bombDrag = bombDragK(BOMB_TERMINAL_SPEED)

  /** 投一顆。座標與速度都是世界座標 */
  dropBomb(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    this.bombs.spawn(x, y, z, vx, vy, vz)
  }
```

3. `step(dt)` 內，緊接在 `this.projectiles.step(dt)` 之後：

```ts
    // 【只有落水才推水柱】陸地上噴水柱是純內陸地圖每一顆都會發生的缺陷，
    // `render/debris.ts` 已經為同一個坑留過註解。落陸這一輪什麼都不做
    // （爆炸在範圍外），所以這裡只有一個分支
    this.bombs.step(dt, this.bombDrag, this.groundAt, (x, y, z) => {
      if (!(this.waterAt(x, z) > -Infinity)) return
      // 【一顆炸彈推三根柱子】現有的水柱是子彈打出來的 12 m，炸彈不是子彈。
      // **用數量換規模，`splash.ts` 不用改** —— `main.ts:1121` 為殘骸入水
      // 寫過同一句。高低粗細本來就由 `splashSize` 依格子隨機，所以三根不會
      // 疊成一根粗的
      for (let n = 0; n < BOMB_SPLASH_JETS; n++) {
        const a = (n / BOMB_SPLASH_JETS) * Math.PI * 2
        pushImpact(this.splashEvents, x + Math.cos(a) * 2.5, y, z + Math.sin(a) * 2.5, 0, 1, 0)
      }
    })
```

`BOMB_SPLASH_JETS = 3` 與 `BOMB_TERMINAL_SPEED` 放在一起（`world/bomb.ts`），
標「起始值，由試飛裁定」。

4. `src/battle/setup.ts` 的 `resetBattle`（**第 1469 行**，`b.world.projectiles
   .clear()` 那一行下面）補 `b.world.bombs.clear()`。少了它，上一場還在空中的
   炸彈會在第二場繼續落下 —— 而落地要 30 秒，看起來像憑空冒出來的水柱。

- [ ] **Step 6: 型別檢查與全測**

Run: `npx tsc --noEmit` 然後 `npx vitest run test/unit`
Expected: `src/` 0 錯誤；unit 全綠

- [ ] **Step 7: Commit**

```bash
git add src/world/bomb.ts src/world/World.ts test/unit/bomb.test.ts
git commit -m "feat(bomb): 炸彈池進 World.step —— 240 Hz，落地推進既有的 splashEvents"
```

---

### Task 4: 輸入與相機的第三個模式

**Files:**
- Modify: `src/input/InputState.ts`（`viewMode` 三態、`bombCapable`）
- Modify: `src/input/bindings.ts`（`B` 鍵、`V` 的守衛）
- Modify: `src/render/geometry/glb.ts`（`GlbAircraft.bombPoint`、樣板與 model 帶出去）
- Modify: `src/render/geometry/assembly.ts`（`AircraftModel.bombPoint`，程式版填 `null`）
- Modify: `src/render/geometry/b17g.model.ts`、`he111.model.ts`、`g4m.model.ts`
- Modify: `src/camera/CameraRig.ts`（`'bomb'` 分支、`bombPoint`、slerp）
- Test: `test/unit/bindings.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `coneClamp` / `BOMB_CONE_HALF_ANGLE`
- Produces:
  - `InputState.viewMode: 'third' | 'first' | 'bomb'`、`InputState.bombCapable: boolean`
  - `CameraRigOptions.bombPoint: Vector3`、`BOMB_LERP_TIME`
  - `CameraRig.update(..., viewMode, ..., bombTarget: Vector3 | null)`
    —— `bombTarget` 是**世界座標的落點**，`null` 代表解不出來

- [ ] **Step 1: 寫失敗的測試**

追加到 `test/unit/bindings.test.ts` 的最後。`setupDom()` 是檔案層級的，
但 **`key(code)` 是每個 describe 各自宣告一份**（第 156、258、347 行各一），
所以新的 describe 要自己帶一份：

```ts
describe('attachInput：投彈模式', () => {
  const key = (code: string) => ({ code, preventDefault: () => {} })

  const arm = (capable: boolean) => {
    const dom = setupDom()
    const state = createInputState()
    state.bombCapable = capable
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    return { dom, state }
  }

  it('B 在帶彈的飛機上切換投彈模式', () => {
    const { dom, state } = arm(true)
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('bomb')
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })

  it('沒有掛彈時 B 沒有作用', () => {
    const { dom, state } = arm(false)
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })

  it('投彈模式下 V 沒有作用 —— 它的軸是座艙／機外，投彈不在那條軸上', () => {
    const { dom, state } = arm(true)
    dom.win.fire('keydown', key('KeyB'))
    dom.win.fire('keydown', key('KeyV'))
    expect(state.viewMode).toBe('bomb')
  })
})
```


- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/bindings.test.ts`
Expected: FAIL —— `viewMode` 仍是 `'third'`（B 還沒接）

- [ ] **Step 3: 輸入層**

`src/input/InputState.ts`：

```ts
  viewMode: 'third' | 'first' | 'bomb'
  /**
   * 這一台飛機掛得了彈嗎。**由 `main.ts` 在玩家換飛機時寫入。**
   *
   * 【為什麼不是 bindings 自己判斷】`bindings.ts` 是純 DOM 外殼，對飛機
   * 一無所知（見檔頭）。寫入點與 `rig.options.firstPersonOffset` 相同 ——
   * 那裡本來就是「玩家換了一台飛機」。
   */
  bombCapable: boolean
```

`createInputState()` 補 `bombCapable: false`。

`src/input/bindings.ts` 的 `onKeyDown`，在 `case 'KeyV'` 之前插入：

```ts
      case 'KeyB':
        if (state.bombCapable) state.viewMode = state.viewMode === 'bomb' ? 'third' : 'bomb'
        break
```

`case 'KeyV'` 改成：

```ts
      // 【投彈模式下不作用】V 的軸是「座艙／機外」，投彈模式不是那條軸上的
      // 一個點。照舊寫的話 `=== 'third'` 為 false 會把它彈回 third，等於
      // 多了一個沒有人記得的離開鍵
      case 'KeyV':
        if (state.viewMode !== 'bomb') {
          state.viewMode = state.viewMode === 'third' ? 'first' : 'third'
        }
        break
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/bindings.test.ts`
Expected: PASS

- [ ] **Step 5: `bombPoint` 進模型**

`src/render/geometry/glb.ts`：`GlbAircraft` 與 `GlbTemplate` 各加一行

```ts
  /**
   * 投彈瞄具的眼點，**機體座標**。沒有掛彈的機種為 `null`。
   *
   * 【為什麼一機一個值而不是從包圍盒推】與 `eyePoint` 同一個理由：三台的
   * 機身剖面差很多，共用一條「底面往上 0.3 m」的規則必然有一台的相機在
   * 蒙皮外面。**起始值** —— 試飛時看到機身內壁就再往下調。
   *
   * 【近平面幫了忙】`CAMERA_NEAR = 1`，所以相機一公尺內的蒙皮會被裁掉，
   * 視線自然穿出機腹。
   */
  bombPoint: Vector3 | null
```

`loadGlbTemplate` 的回傳（`glb.ts:264` 附近）與 `AircraftModel` 的組裝
（`glb.ts:340` 附近）各補 `bombPoint: def.bombPoint ? def.bombPoint.clone() : null`
／`bombPoint: t.bombPoint ? t.bombPoint.clone() : null`。

`src/render/geometry/assembly.ts`：`AircraftModel` 加 `bombPoint: Vector3 | null`，
`finish` 的回傳補 `bombPoint: null`（程式版目前沒有轟炸機走這條路）。

五台戰鬥機的 `*.model.ts` 各補 `bombPoint: null`。三台轟炸機：

```ts
// b17g.model.ts —— 投彈手在機首下方。z −4.60 那一站的機腹底是 y −0.88
// （`b17g.hull.ts`），相機放在它上方 0.33 m
bombPoint: new Vector3(0, -0.55, -4.60),

// he111.model.ts —— 腹部吊艙（Bola）的位置
bombPoint: new Vector3(0, -0.45, -3.20),

// g4m.model.ts —— 機首下方的投彈手席
bombPoint: new Vector3(0, -0.55, -3.80),
```

- [ ] **Step 6: `CameraRig` 的 `'bomb'` 分支**

`src/camera/CameraRig.ts`：

1. `CameraRigOptions` 加：

```ts
  /**
   * 投彈瞄具的眼點（**機體座標**）。`main.ts` 每次換飛機後改寫成該機種的
   * `model.bombPoint`，與 `firstPersonOffset` 同一個做法。
   */
  bombPoint: Vector3
```

`DEFAULT_CAMERA_OPTIONS` 補 `bombPoint: new Vector3(0, -0.55, -4.60)`，
建構子的 clone 名單也要補上。

2. 模組層級常數：

```ts
/**
 * 投彈視線靠向落點的時間常數，秒。**起始值，由試飛裁定。**
 *
 * 對齊 `lookReturnTime` —— 兩者都是「相機自己在動」，而不是玩家正在下指令。
 */
export const BOMB_LERP_TIME = 0.25

const CONE_COS = Math.cos(BOMB_CONE_HALF_ANGLE)
const CONE_SIN = Math.sin(BOMB_CONE_HALF_ANGLE)
```

3. **暫存槽要加三格**：檔頭的 `const S = makeScratch(9, 4)` 改成
   `makeScratch(12, 4)`，投彈分支只用 `S.v[9]` / `S.v[10]` / `S.v[11]`。

   【為什麼不撿現成的空格】`baseOrientation` 內部用的正是 `S.v[5]` 與
   `S.v[6]`，而投彈分支會呼叫它 —— 借那兩格的話「圓錐軸」會在算視角基準的
   途中被覆寫，症狀是視線偶爾抽一下，而且只在特定姿態下出現。

4. 私有狀態：

```ts
  private readonly bombDir = new Vector3(0, -1, 0)
  private bombClamped = false
  /**
   * 投彈視線已經起算了。
   *
   * 【為什麼不共用 `initialised`】那一格的語意是「第三人稱的彈簧要不要吸附」，
   * 而投彈模式**離開時**必須把它留成 false 讓第三人稱重新吸附 —— 兩個意思
   * 塞進一格的話，切回機外視角相機會從投彈時的落後量開始盪。
   */
  private bombInit = false
```

   加一個唯讀取值器 `get sightClamped(): boolean { return this.bombClamped }`。
   `snapTo()` 內補 `this.bombInit = false`。

5. `update` 簽章尾端加 `bombTarget: Vector3 | null = null`，
   並在 `if (viewMode === 'first')` 之前插入：

```ts
    if (viewMode === 'bomb') {
      // 眼點是機體上的一個位置，**要跟著滾** —— 與機首視角同一條理由
      const eye = S.v[9]!.copy(o.bombPoint).applyQuaternion(orientation).add(position)

      // 圓錐軸 = 機體 −Y。**機體固定**（負責人裁定）：等於機腹上的一個窗口，
      // 側滾大了看到的就是天
      const axis = S.v[10]!.set(0, -1, 0).applyQuaternion(orientation)

      // 解不出落點時就盯著軸自己 —— 不會有 NaN，畫面也停在機腹正下方
      const want = S.v[11]!
      if (bombTarget !== null) want.copy(bombTarget).sub(eye).normalize()
      else want.copy(axis)

      this.bombClamped = coneClamp(
        want.x, want.y, want.z, axis.x, axis.y, axis.z, CONE_COS, CONE_SIN, want,
      )

      // 【LERP】負責人指定視線轉換要漸變。指數趨近，與相機其餘的平滑同一個
      // 慣例；剛切進來時從當下的相機朝向起算，所以視線是轉過去而不是跳過去
      if (!this.bombInit) {
        this.bombDir.set(0, 0, -1).applyQuaternion(camera.quaternion)
        this.bombInit = true
      }
      // 【恰好反向時線性混合會得到零向量】從仰視切進投彈模式做得到這個角度。
      // 先把起點推離對蹠點一點點，之後的 nlerp 就有定義了
      if (this.bombDir.dot(want) < -0.9999) {
        this.bombDir.x += 1e-3
        this.bombDir.normalize()
      }
      const kb = dt > 0 ? 1 - Math.exp(-dt / BOMB_LERP_TIME) : 1
      // 【nlerp 不是 slerp】`baseOrientation` 的上方向量用的就是 lerp + 正交化，
      // 這是這個檔案既有的做法。差別只在大角度時的角速度分布，而這裡插的是一個
      // τ = 0.25 s 的追隨，看不出來
      this.bombDir.lerp(want, kb).normalize()

      const look = this.baseOrientation(this.bombDir, dt, S.q[2]!)
      this.viewBase.copy(look)
      camera.position.copy(eye)
      camera.quaternion.copy(look)
      // 【切回第三人稱要重新吸附】與機首視角那一行同一個理由
      this.initialised = false
      return
    }
    this.bombInit = false
    this.bombClamped = false
```

【`baseOrientation` 在這裡就是「上方向量不隨機體滾」】`CameraRig` 檔頭那條
「相機不隨機體側滾」的鐵律，理由是滑鼠的正回饋螺旋 —— 投彈視線不吃滑鼠，
那半條理由不成立。但另一半成立：地平線跟著轉，就讀不出落點往畫面哪一邊漂。

【`initialised` 被兩個模式共用】第三人稱用它做彈簧吸附、投彈模式用它做
「剛切進來」。兩者都只在**進入該模式的第一幀**為 false，語意相容。

6. FOV 那一段（`update` 結尾）在 `'bomb'` 分支 `return` 之前就跳過了。
   **刻意**：投彈時 FOV 隨速度變化只會讓落點在畫面上抖動；而且落點的投影
   （`main.ts` 那一半）與相機是同一幀，FOV 一變兩邊就要對齊，沒有理由。

- [ ] **Step 7: 型別檢查**

Run: `npx tsc --noEmit`
Expected: `src/` 0 錯誤（`main.ts` 尚未傳 `bombTarget`，預設值 `null` 讓它先編得過）

- [ ] **Step 8: Commit**

```bash
git add src/input src/camera/CameraRig.ts src/render/geometry test/unit/bindings.test.ts
git commit -m "feat(bomb): B 鍵切機腹視角 —— 視線盯落點、夾進 70 度錐、slerp 過去"
```

---

### Task 5: HUD 圓準星

**Files:**
- Create: `src/hud/widgets/bombsight.ts`
- Modify: `src/hud/types.ts`（`HudFrame` 五個欄位 + `createHudFrame` 之類的初值）
- Modify: `src/hud/Hud.ts`（`HudWidget` 加 `'bombsight'`、`BOMB` 清單、`hudWidgets`）
- Test: `test/unit/hud-bombsight.test.ts`

**Interfaces:**
- Consumes: `HUD_COLORS`、`HudLayout`、`HudFrame`
- Produces:
  - `HudFrame.bombX / bombY / bombVisible / bombState / bombLoad`
  - `bombState: 'off' | 'solved' | 'clamped' | 'none'`（`'off'` = 不在投彈模式）
  - `drawBombsight(ctx, L, f): void`
  - `Hud.ts` 匯出的 `FULL`、`BOMB: readonly HudWidget[]`
  - `hudWidgets(godView: boolean, bombing?: boolean): readonly HudWidget[]`
    —— 第二個參數**必須有預設值 `false`**：`hudWidgets` 目前有 **11 個單參數
    呼叫點**（`test/unit/hud.test.ts` 8 處、`hud-arena.test.ts` 3 處），
    做成必填會讓那 11 條全部變紅，而它們測的事情與投彈完全無關

- [ ] **Step 1: 寫失敗的測試**

`test/unit/hud-bombsight.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { BOMB, FULL, hudWidgets } from '../../src/hud/Hud'

describe('投彈模式的 HUD 清單', () => {
  it('不含 reticle —— 瞄準點是凍結的，畫出來是誤導', () => {
    expect(BOMB).not.toContain('reticle')
  })

  it('含 bombsight', () => {
    expect(BOMB).toContain('bombsight')
  })

  it('除了那一項換掉之外與一般飛行相同', () => {
    expect([...BOMB].sort()).toEqual(
      [...FULL.filter((w) => w !== 'reticle'), 'bombsight'].sort(),
    )
  })

  it('hudWidgets 三分支：上帝視角優先於投彈模式', () => {
    expect(hudWidgets(false, false)).toBe(FULL)
    expect(hudWidgets(false, true)).toBe(BOMB)
    // 【上帝視角贏】鏡頭都不在飛機上了，機腹瞄具更沒有意義
    expect(hudWidgets(true, true)).not.toBe(BOMB)
  })
})
```

（`Hud.ts` 目前沒有匯出 `FULL`；這一步順手把 `FULL` 改成 `export const FULL`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/unit/hud-bombsight.test.ts`
Expected: FAIL —— `BOMB` 沒有匯出

- [ ] **Step 3: `HudFrame` 欄位**

`src/hud/types.ts`，接在 `noseVisible` 之後：

```ts
  /**
   * 落點在畫面上的位置，**NDC（−1…1）**，慣例同 `noseX` / `noseY`。
   *
   * 【為什麼不是恆在畫面中央】相機自動盯落點，所以解穩定時圓圈會回到中心；
   * 飛機一機動、速度一變、圓錐一夾制，LERP 就讓它漂開。那個分離量就是
   * 「投彈解還沒收斂」—— 與滑鼠準星／機首十字的分離量是同一個語言。
   */
  bombX: number
  bombY: number
  bombVisible: boolean
  /**
   * `off` = 不在投彈模式；`clamped` = 圓錐夾住了，圓圈不在真正的落點上；
   * `none` = 在投彈模式但 90 秒內解不出落點。
   *
   * 【為什麼把「在不在投彈模式」也塞進這一格】`hudWidgets` 讀的是 frame
   * （現況 `f.godView`），需要知道要不要換清單；另開一個 `bombing: boolean`
   * 就會有兩個欄位描述同一件事，而它們遲早會不同步。
   */
  bombState: 'off' | 'solved' | 'clamped' | 'none'
  /** 剩餘彈數 */
  bombLoad: number
```

同檔的 frame 工廠補初值 `bombX: 0, bombY: 0, bombVisible: false,
bombState: 'off', bombLoad: 0`。

- [ ] **Step 4: widget**

`src/hud/widgets/bombsight.ts`：

```ts
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/** 圓的半徑，px（未乘 `L.scale`）。與滑鼠準星同尺寸 —— 它們是同一種東西 */
const RADIUS = 11

/**
 * 投彈落點的圓準星。**圓形，不是十字**（專案負責人指定）。
 *
 * 【為什麼不畫離屏箭頭】落點跑出畫面只會發生在 `clamped` 之下，而那個狀態
 * 本身已經在警告了 —— 再加一個指標是同一件事講兩次。
 */
export function drawBombsight(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (f.bombState === 'off') return

  // 【解不出來時留一個中心點】什麼都不畫的話，「90 秒內落不到地面」與
  // 「HUD 壞了」在畫面上長得一模一樣
  if (f.bombState === 'none' || !f.bombVisible) {
    ctx.fillStyle = HUD_COLORS.dim
    ctx.beginPath()
    ctx.arc(L.cx, L.cy, 1.5 * L.scale, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  const x = L.cx + (f.bombX * L.width) / 2
  const y = L.cy - (f.bombY * L.height) / 2
  const clamped = f.bombState === 'clamped'

  ctx.strokeStyle = clamped ? HUD_COLORS.warn : HUD_COLORS.primary
  ctx.lineWidth = 1 * L.scale
  if (clamped) ctx.setLineDash([4 * L.scale, 4 * L.scale])
  ctx.beginPath()
  ctx.arc(x, y, RADIUS * L.scale, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
}
```

- [ ] **Step 5: `Hud.ts` 接線**

- `HudWidget` union 加 `| 'bombsight'`
- `const FULL` 改成 `export const FULL`
- 新增：

```ts
/**
 * 投彈模式畫的那一套：**把準星換成落點圓圈，其餘照舊。**
 *
 * 【為什麼一定要換掉 `reticle` 而不是疊上去】瞄準點在投彈模式下是凍結的，
 * 畫出來就是一個指著沒有意義的方向的圓圈。理由與上帝視角那一段逐字相同：
 * 「準星更是直接誤導 —— 它會讓人以為那個方向會有子彈出去」。
 */
export const BOMB: readonly HudWidget[] = FULL.map((w) => (w === 'reticle' ? 'bombsight' : w))
```

- `WIDGET_DRAW` 那張表補一項 `bombsight: drawBombsight`（該檔用的是查表，
  不是 switch —— 見 `Hud.ts:146` 的 `WIDGET_DRAW[w](ctx, L, f, dt)`）。
- `hudWidgets` 改簽章（`Hud.ts:74`）：

```ts
/**
 * 這一幀畫哪些 widget。
 *
 * 【上帝視角優先於投彈模式】鏡頭都不在飛機上了，機腹瞄具更沒有意義。
 */
export function hudWidgets(godView: boolean, bombing = false): readonly HudWidget[] {
  if (godView) return GOD
  return bombing ? BOMB : FULL
}
```

- 呼叫端（`Hud.ts:146`）改成 `hudWidgets(f.godView, f.bombState !== 'off')`。
- **預設值不可省**：既有的 11 個單參數呼叫點都在測試裡，測的事情與投彈無關，
  沒有理由為了一個新模式去動它們。
- `WIDGET_DRAW` 是 `Record<HudWidget, …>`（`Hud.ts:86` 的護欄），所以 union
  加了 `'bombsight'` 卻忘了補表**是編譯錯誤**，不會靜靜地不顯示。

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run test/unit/hud-bombsight.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/hud test/unit/hud-bombsight.test.ts
git commit -m "feat(bomb): HUD 的落點圓準星 —— 投彈模式把準星換掉而不是疊上去"
```

---

### Task 6: main.ts 串接與炸彈渲染 —— 可以試玩

**Files:**
- Create: `src/render/bombs.ts`
- Create: `src/weapons/bomb.ts`
- Modify: `src/main.ts`
- Modify: `src/control/PlayerController.ts:22`（**投彈模式下左鍵不開槍**真正的
  落點是這裡的 `out.firing = this.input.firing`，不是 `main.ts`）

**Interfaces:**
- Consumes: 前五個 Task 的全部產出
- Produces: 可試玩的投彈模式

- [ ] **Step 1: 載彈量表**

`src/weapons/bomb.ts`：

```ts
/**
 * 各機種的載彈量。**沒有列在這裡的機種不能投彈。**
 *
 * 起始值，史實量級。投完就沒有 —— 本輪不做補彈，重生時回滿。
 */
export const BOMB_LOAD: Readonly<Record<string, number>> = {
  b17g: 8,
  he111: 8,
  g4m: 4,
}

/** 兩顆之間的最小間隔，秒。單投，可以走棋盤式散布 */
export const BOMB_RELEASE_INTERVAL = 0.25

export function bombLoadFor(specId: string): number {
  return BOMB_LOAD[specId] ?? 0
}
```

- [ ] **Step 2: 炸彈的樣子**

`src/render/bombs.ts`：一個 `InstancedMesh`，容量 `BOMBS_CAPACITY`，
每幀依 `Bombs` 的 SoA 更新矩陣。

```ts
import {
  ConeGeometry, InstancedMesh, MeshLambertMaterial, Object3D, Quaternion, Vector3,
} from 'three'
import { BOMBS_CAPACITY, type Bombs } from '../world/bomb'

const DUMMY = new Object3D()
const DIR = new Vector3()
const UP = new Vector3(0, 1, 0)
const Q = new Quaternion()

/**
 * 空中的炸彈。
 *
 * 【為什麼是圓錐而不是一顆真的炸彈】這一輪的交付物是**瞄具**：要看得見
 * 「東西真的掉下去了」，不需要看得清它長什麼樣。八個側面 12 個三角形，
 * 而且尖端朝速度方向 —— 落下時會自己轉正，那就是可讀性的全部來源。
 */
export function createBombs(): {
  object: InstancedMesh
  update(bombs: Bombs): void
  dispose(): void
} {
  // 尖端朝 −Y，長 1.6 m、半徑 0.22 m
  const geo = new ConeGeometry(0.22, 1.6, 8)
  geo.rotateX(Math.PI)
  const mat = new MeshLambertMaterial({ color: 0x4a4a48 })
  const mesh = new InstancedMesh(geo, mat, BOMBS_CAPACITY)
  mesh.frustumCulled = false
  mesh.count = BOMBS_CAPACITY

  return {
    object: mesh,
    update(bombs) {
      for (let i = 0; i < BOMBS_CAPACITY; i++) {
        if (bombs.active[i] === 0) {
          DUMMY.position.set(0, -1e6, 0)
          DUMMY.quaternion.identity()
          DUMMY.scale.setScalar(1)
        } else {
          DUMMY.position.set(bombs.x[i]!, bombs.y[i]!, bombs.z[i]!)
          DIR.set(bombs.vx[i]!, bombs.vy[i]!, bombs.vz[i]!)
          // 【尖端朝速度】炸彈會順著氣流轉正，而這也是唯一免費的可讀性
          if (DIR.lengthSq() > 1e-6) {
            DIR.normalize()
            DUMMY.quaternion.copy(Q.setFromUnitVectors(UP, DIR))
          }
          DUMMY.scale.setScalar(1)
        }
        DUMMY.updateMatrix()
        mesh.setMatrixAt(i, DUMMY.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      mesh.dispose()
    },
  }
}
```

注意 `ConeGeometry` 的尖端原本朝 +Y；`rotateX(π)` 之後朝 −Y，
`setFromUnitVectors(UP, DIR)` 才會把它轉到速度方向 —— 這裡 `UP` 當的是
「模型的尾端方向」。

- [ ] **Step 3: `main.ts` 串接**

依序加入（位置以既有的相鄰行為錨）：

1. import —— **只列真的用到的**（`tsconfig.json` 開了 `noUnusedLocals`，
   多一個沒用到的就是編譯錯誤）：

```ts
import { createBombs } from './render/bombs'
import { solveImpact, type BombState, type Impact } from './world/bomb'
import { bombLoadFor, BOMB_RELEASE_INTERVAL } from './weapons/bomb'
```

`bombDragK` 與 `BOMB_TERMINAL_SPEED` **不要 import** —— 阻力係數在 `World`
的 `bombDrag` 欄位（Task 3 已經設好預設值），`main.ts` 讀 `world.bombDrag`。
2. 模組層級：

```ts
const bombVisuals = createBombs()
ctx.scene.add(bombVisuals.object)
// 【每幀重用】solveImpact 的輸出就地寫入，不得每幀 new
const BOMB_IMPACT: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
const BOMB_START: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const BOMB_EYE = new Vector3()
const BOMB_POINT = new Vector3()
const BOMB_NDC = new Vector3()
let bombLoad = 0
let bombCooldown = 0
let bombWasFiring = false
```

3. `startWorld` 內、**`world.land = terrain.land`（`main.ts:616`）那一行旁邊**：

```ts
  // 【炸彈的地面與水面】與 `crashPolicy` 同一個注入方式：規則的權威在
  // `render/terrain.ts`，World 不抄第二份。**放在這裡就自動涵蓋換地形** ——
  // 這一段每一場都重跑
  world.groundAt = terrain.collisionHeightAt
  world.waterAt = terrain.waterAt
```
4. 玩家換飛機的兩處（`rig.options.firstPersonOffset.copy(...)`，
   `main.ts:424` 與 `main.ts:1001`）各追加：

```ts
  {
    const m = visuals.get(player)!.model
    bombLoad = bombLoadFor(player.aircraft.spec.id)
    input.bombCapable = m.bombPoint !== null && bombLoad > 0
    if (m.bombPoint !== null) rig.options.bombPoint.copy(m.bombPoint)
    // 【換到不能投彈的飛機要強制退出】少了這一條，重生成戰鬥機之後相機會
    // 卡在一個沒有 bombPoint 的模式裡
    if (!input.bombCapable && input.viewMode === 'bomb') input.viewMode = 'third'
    bombCooldown = 0
    bombWasFiring = false
  }
```

5. `main.ts:902` 那條 if/else 鏈（上帝視角 / `aiFlying` / 一般飛行）**插入
   一個分支**，放在 `else if (aiFlying)` 之後、最後的 `else` 之前：

```ts
  } else if (input.viewMode === 'bomb') {
    // 【投彈模式凍結瞄準點】瞄準點就是飛行指令，而 slewAimWorld 的旋轉軸
    // 取自相機 —— 相機一朝下，滑鼠的語意就變了。凍結它，指揮儀照舊追它，
    // 等於「保持航向與姿態」。什麼都不做就是凍結
  } else {
    slewAimWorld(...)   // 現況不動
  }
```

`input.aimDeltaX = 0` / `aimDeltaY = 0`（`main.ts:912`）**照舊在鏈外面執行**
—— 不歸零的話位移會累積到離開投彈模式的那一幀，鏡頭一次噴過去。

6. `rig.update(...)` 之前算落點：

```ts
  let bombTarget: Vector3 | null = null
  let bombState: 'off' | 'solved' | 'clamped' | 'none' = 'off'
  if (input.viewMode === 'bomb') {
    bombState = 'none'
    const m = visuals.get(player)!.model
    BOMB_EYE.copy(m.bombPoint!).applyQuaternion(renderQuat).add(renderPos)
    BOMB_START.x = BOMB_EYE.x; BOMB_START.y = BOMB_EYE.y; BOMB_START.z = BOMB_EYE.z
    const v = player.aircraft.state.velocity
    BOMB_START.vx = v.x; BOMB_START.vy = v.y; BOMB_START.vz = v.z
    // 【dt 用 loop.stepSeconds 而不是 frameSeconds】預測必須與空中的炸彈
    // 同一個步長，那條護欄的整個重點就在這裡
    if (solveImpact(BOMB_START, world.bombDrag, world.groundAt, loop.stepSeconds, BOMB_IMPACT)) {
      BOMB_POINT.set(BOMB_IMPACT.x, BOMB_IMPACT.y, BOMB_IMPACT.z)
      bombTarget = BOMB_POINT
      bombState = 'solved'
    }
  }
  rig.update(
    ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
    input.viewMode, input.lookYaw, input.lookPitch, frameSeconds, bombTarget,
  )
  if (bombState === 'solved' && rig.sightClamped) bombState = 'clamped'
```

`renderPos` / `renderQuat` 是 `main.ts:1062` 已經取好的內插姿態 —— 用它們
而不是物理姿態，理由與槍焰、砲塔槍管相同（那兩處已有註解）。

7. 投彈（`rig.update` 之後，因為要用同一幀的 `BOMB_EYE`）：

```ts
  if (bombCooldown > 0) bombCooldown -= frameSeconds
  if (input.viewMode === 'bomb') {
    // 【邊緣觸發】firing 是持續按著的布林；不做邊緣的話一次點擊會投掉整艙
    if (input.firing && !bombWasFiring && bombLoad > 0 && bombCooldown <= 0) {
      const v = player.aircraft.state.velocity
      world.dropBomb(BOMB_EYE.x, BOMB_EYE.y, BOMB_EYE.z, v.x, v.y, v.z)
      bombLoad--
      bombCooldown = BOMB_RELEASE_INTERVAL
    }
    bombWasFiring = input.firing
  } else {
    bombWasFiring = false
  }
```

8. **投彈模式下左鍵不開槍** —— 落點在 `src/control/PlayerController.ts:22`
   （`out.firing = this.input.firing`），**不在 `main.ts`**：

```ts
    // 【投彈模式下左鍵是投彈，不是扳機】機砲朝前、鏡頭朝下 —— 開出去的子彈
    // 玩家根本看不到，而彈藥是真的在消耗
    out.firing = this.input.firing && this.input.viewMode !== 'bomb'
```
9. HUD frame 填欄位（在既有的 `noseX/noseY` 投影旁邊；變數名是 `hudFrame`）：

```ts
  hudFrame.bombState = bombState
  hudFrame.bombLoad = bombLoad
  hudFrame.bombVisible = false
  if (bombState === 'solved' || bombState === 'clamped') {
    // 照 noseX/noseY 既有的投影寫法：世界點 → NDC
    BOMB_NDC.copy(BOMB_POINT).project(ctx.camera)
    hudFrame.bombX = BOMB_NDC.x
    hudFrame.bombY = BOMB_NDC.y
    hudFrame.bombVisible = BOMB_NDC.z < 1 &&
      Math.abs(BOMB_NDC.x) <= 1 && Math.abs(BOMB_NDC.y) <= 1
  }
```

10. `bombVisuals.update(world.bombs)` 放在 `tracers.update(world.projectiles)`
    旁邊（`main.ts:1104`）；`bombVisuals.dispose()` 放進既有的釋放路徑。
    炸彈池的清空在 Task 3 已經接在 `resetBattle` 裡；`bombLoad` 的重設在
    上面第 4 點那個區塊（玩家換飛機／重生都會走到）。
11. `hudWidgets` 由 `hudFrame.bombState` 自己判斷，**`main.ts` 不必多傳參數**。

- [ ] **Step 4: 型別檢查與全測**

Run: `npx tsc --noEmit` 然後 `npx vitest run`
Expected: `src/` 0 錯誤；測試全綠（`test/` 既有的 23 個錯誤不算）

- [ ] **Step 5: 試飛**

Run: `npm run dev`，開 `http://localhost:5175/`
遭遇戰 → 我方機種選 **B-17G** → 出擊 → 爬到 4,000 m → 按 `B`。

驗收：

1. 視線**轉**過去（不是跳過去），最後停在斜前下方約 29°
2. 圓圈在畫面中央附近；壓坡度時圓圈往一側漂，改平之後漂回來
3. 左鍵投一顆，一顆炸彈掉出去，約 31 秒後**水柱噴在圓圈壓著的那個位置**
   —— 這是這個功能唯一真正的驗收
4. 降到 200 m 以下：圓圈變黃、變虛線（`clamped`）
5. 再按 `B` 回到第三人稱；按 `V` 在投彈模式下沒有反應
6. 投完 8 顆之後左鍵沒有反應

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/render/bombs.ts src/weapons/bomb.ts src/control/PlayerController.ts
git commit -m "feat(bomb): 接上投彈 —— B 進瞄具、左鍵投彈、落海噴水柱"
```

---

## 收尾

- [ ] `npx vitest run` 全綠、`npx tsc --noEmit` 的 `src/` 0 錯誤
- [ ] `docs/roadmap.md` 里程碑 2 的「投彈瞄準輔助 —— 現在完全沒有」改成已完成，
      並註明其餘武器項目未動
