# M7 武器特效 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上三個視覺回饋 —— 槍口的閃、命中飛機的火花、彈丸入海的水柱。

**Architecture:** 三者錨點不同所以機制不同。槍焰是**每管的計時器**（位置在渲染時由內插姿態重算）；火花與水柱走**事件緩衝**，在主迴圈的子步回呼裡排空。命中法線從既有的 slab 測試取出來（最後抬高 `tMin` 的那一軸就是入射面）。順便補上「彈丸入海即回收」—— 目前彈丸會穿過水面繼續飛。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals` + `noUnusedParameters`）、three.js、vitest、Vite。

**Spec:** `docs/superpowers/specs/2026-08-04-weapon-effects-design.md`

## Global Constraints

- **全部輸出使用繁體中文** —— 程式註解、commit 訊息、測試名稱一律繁中。
- **熱路徑零配置**：`World.step` 與其呼叫的一切不得配置物件。用 `makeScratch(n)` 取模組私有暫存，**索引迴圈而非 `for...of`**（後者每次配置迭代器）。`resolveHits` 是全專案最熱的迴圈（4,000 發 × 40 架 × 240 Hz），它裡面的每一行都要當成熱路徑寫。
- **三個特效全部按真實比例，不加螢幕尺寸下限**（spec §8.1，專案負責人裁決）。
- **不得修改 `DifficultyProfile`** —— 難度調整已明確延後，`ACE` 的兩個欄位維持 0。
- **不寫飛機外形的測試。**
- **不得放寬既有的效能門檻**來讓改動通過。唯一的例外是 Task 11，而那是一次有推導、有新舊數字紀錄的重新校準。
- **每一個門檻都要附推導或量測。** 不接受「配一個看起來合理的數字」。
- **回歸測試要先驗證舊行為會紅**再套新值。沒被驗證會失敗的回歸測試不算回歸測試。
- `npm run build`（`tsc --noEmit` + vite build）是型別的唯一守門員 —— vitest 走 esbuild，**不做型別檢查**，所以測試全綠不代表編得過。每個任務的最後一步都要跑它。
- 提交時**列出明確路徑**，不要 `git add -A`（工作區有一個既存的 `bash.exe.stackdump`）。

## 既有介面速查（實作時會用到，不要憑記憶）

```ts
// src/world/hit.ts
const NO_HIT = -1
interface HitBox { part: HitPart; center: Vector3; half: Vector3 }
function segmentBox(ox,oy,oz, ex,ey,ez, box: HitBox): number      // 回傳 t 或 NO_HIT
interface HitResult { t: number; part: HitPart; multiplier: number }
function hitAircraft(boxes, position, orientation, s0, s1, out: HitResult): boolean
function makeHitBox(part, min: [x,y,z], max: [x,y,z]): HitBox

// src/world/Projectiles.ts
const PROJECTILE_CAPACITY = 4000
const PROJECTILE_LIFETIME = 1.2
class Projectiles {
  capacity: number
  x/y/z, sx/sy/sz, vx/vy/vz, age, damage: Float32Array   // s* 是這一步的線段起點
  owner: Int32Array                                       // −1 = 空槽
  live: number
  spawn(x,y,z, vx,vy,vz, damage, owner): number
  kill(i: number): void
}

// src/world/World.ts
interface Combatant { readonly index: number; readonly aircraft: Aircraft
                      controller: Controller; readonly command: Command
                      cooldowns: Float32Array; hp: number; hitRadius: number
                      team: Team; alive: boolean; hitsDealt: number
                      respawnOnDestroy: boolean; /* ... */ }
class World { combatants: Combatant[]; projectiles: Projectiles
              crashPolicy: CrashPolicy
              add(...); setSpec(c, spec); step(dt); resolveHits(); destroy(c) }

// src/weapons/types.ts
interface Mount { weapon: Weapon; position: Vector3 }
interface Battery { mounts: Mount[]; convergence: number; sight: Weapon }
function mountDirection(b: Battery, index: number, out: Vector3): Vector3
// P-51D：6 挺 M2（800 rpm、初速 887）。Bf 109 G-6：MG151/20（700）+ 2× MG131（900）

// src/weapons/cadence.ts
function stepCadence(cooldowns, index, roundsPerMinute, trigger, dt): number  // 這一步打幾發

// src/core/pool.ts
function makeScratch(vecCount: number, quatCount?: number): { v: Vector3[]; q: Quaternion[] }

// src/render/ocean.ts —— ocean.heightAt(x, z, time): number（Gerstner，振幅合計約 ±2.15 m）

// src/main.ts 的既有結構
//   loop.advance(frameSeconds, (dt) => { stepBattle(battle, dt); ... })  ← 子步回呼
//   visuals: Map<Combatant, { model, position: Vector3, quaternion: Quaternion }>  ← 內插後的姿態
//   tracers.update(world.projectiles)                                    ← 每幀一次
```

## 檔案結構

| 檔案 | 責任 | 任務 |
|---|---|---|
| `src/world/hit.ts`（改） | slab 測試回傳入射面法線 | 1 |
| `src/world/events.ts`（新） | 撞擊事件緩衝（定長 SoA、滿了計數丟棄） | 2 |
| `src/weapons/types.ts`（改） | `MAX_MOUNTS` 上界常數 | 3 |
| `src/world/World.ts`（改） | 槍焰計時器（3）、命中事件（4）、入海回收與水柱事件（5） | 3、4、5 |
| `src/render/muzzle.ts`（新） | 槍焰：讀計時器 + 內插姿態 → 實例矩陣 | 6 |
| `src/render/sparks.ts`（新） | 火花：決定性發射、粒子步進、實例矩陣 | 7 |
| `src/render/splash.ts`（新） | 水柱：環形緩衝、高度曲線、實例矩陣 | 8 |
| `src/main.ts`（改） | 三個特效的建立、子步排空、每幀更新 | 9 |
| `test/integration/multi-battle.test.ts`（改） | 事件緩衝從未溢位 | 10 |
| `test/unit/perf-gate.test.ts`（改） | 20v20 閘門重新校準 | 11 |
| `README.md`、spec §14（改） | 實測回填與交付紀錄 | 12 |

**為什麼 `events.ts` 在 `world/` 而不在 `render/`**：事件是**世界產生的事實**（哪裡被打中、法線朝哪），渲染層只是其中一個消費者。與 `Projectiles` 住在 `world/` 是同一條界線。

**為什麼三個粒子池都在 `render/`**：它們不參與任何判定、不需要決定性。放進 `world/` 會讓 288 組矩陣測試白算三個粒子系統。

## 與 spec 的一處偏離

**spec §7.1 寫「透明度：後 50% 的壽命線性淡出」，本計畫不實作那一項。** `InstancedMesh` 的逐實例顏色（`setColorAt`）只有 RGB 沒有 alpha，逐實例透明度要自訂著色器。而水柱的高度曲線本身就完成了消失（4 m → 0），再加透明度只是把同一件事做兩次。火花與槍焰用**加法混合**，顏色淡到黑就等於淡出，所以那兩個不受影響。這一項要記進 Task 12 的交付紀錄。

---

## Task 1: `hit.ts` —— slab 測試回傳入射面法線

**Files:**
- Modify: `src/world/hit.ts`
- Test: `test/unit/hit.test.ts`（既有檔案，追加兩個 describe）

**Interfaces:**
- Consumes: 無
- Produces:
  ```ts
  interface FaceNormal { axis: number; sign: number }   // axis: 0=X 1=Y 2=Z，−1 = 沒有入射面
  function segmentBox(ox,oy,oz, ex,ey,ez, box: HitBox, outFace?: FaceNormal): number
  interface HitResult { t; part; multiplier; nx: number; ny: number; nz: number }
  ```
  `HitResult` 的 `nx/ny/nz` 是**機體座標**的單位向量；三者皆為 0 代表線段起點就在盒內、沒有入射面。

**背景**（spec §3）：`segmentBox` 是標準 slab 測試，**最後抬高 `tMin` 的那一軸就是入射面所在的軸**，從低面還是高面進去由方向分量的正負決定。抓出來只是六次迴圈裡多兩個賦值。

三件容易寫錯的事：法線要取與 **`t`** 同一個盒（不是倍率最高的那個 —— 命中盒是巢狀的，倍率最高的是內層，而外層才是彈丸先碰到的表面）；起點在盒內時沒有入射面；`segmentBox` 的既有 7 參數呼叫在 `test/unit/hit.test.ts` 裡有一堆，**新參數必須是選用的**。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/hit.test.ts` 檔尾追加。檔頭的 import 併進既有那一區塊，補上 `type FaceNormal`。

```ts
describe('segmentBox 的入射面法線（M7 spec §3.1）', () => {
  const face: FaceNormal = { axis: -1, sign: 0 }

  it('沿 +Z 穿過時從低 Z 面進入 → 法線 −Z', () => {
    // UNIT 是 [-1,-1,-1]..[1,1,1]。從 z = −5 射向 z = +5，在 z = −1 進入
    expect(segmentBox(0, 0, -5, 0, 0, 5, UNIT, face)).toBeCloseTo(0.4, 9)
    expect(face.axis).toBe(2)
    expect(face.sign).toBe(-1)
  })

  it('沿 −Z 穿過時從高 Z 面進入 → 法線 +Z', () => {
    expect(segmentBox(0, 0, 5, 0, 0, -5, UNIT, face)).toBeCloseTo(0.4, 9)
    expect(face.axis).toBe(2)
    expect(face.sign).toBe(1)
  })

  it('沿 +X 與 +Y 各自給對的軸', () => {
    segmentBox(-5, 0, 0, 5, 0, 0, UNIT, face)
    expect(face.axis).toBe(0)
    expect(face.sign).toBe(-1)

    segmentBox(0, 5, 0, 0, -5, 0, UNIT, face)
    expect(face.axis).toBe(1)
    expect(face.sign).toBe(1)
  })

  it('起點就在盒內時沒有入射面', () => {
    // 【為什麼要有這個狀態】tMin 保持 0，三個軸都沒有抬高過它 ——
    // 「從哪一面進來」這個問題在這個情形下沒有答案。硬給一個會讓火花
    // 往任意方向噴，而那個錯誤看起來像是法線算錯。
    expect(segmentBox(0, 0, 0, 0, 0, 5, UNIT, face)).toBe(0)
    expect(face.axis).toBe(-1)
  })

  it('未命中時不動 outFace', () => {
    face.axis = 7
    expect(segmentBox(0, 5, -5, 0, 5, 5, UNIT, face)).toBe(NO_HIT)
    expect(face.axis).toBe(7)
  })

  it('不傳 outFace 也能用 —— 既有呼叫端一個字都不用改', () => {
    expect(segmentBox(0, 0, -5, 0, 0, 5, UNIT)).toBeCloseTo(0.4, 9)
  })
})

describe('hitAircraft 的法線（M7 spec §3.2）', () => {
  /** 巢狀盒：座艙整個包在機身裡，與 hitAircraft 既有測試同形。 */
  const NESTED: HitBox[] = [
    makeHitBox('fuselage', [-1, -1, -4], [1, 1, 4]),
    makeHitBox('cockpit', [-0.5, 0, -0.5], [0.5, 1, 0.5]),
  ]
  const ORIGIN = new Vector3()
  const IDENTITY = new Quaternion()

  it('法線取自最近的 t 那個盒，不是倍率最高的那個', () => {
    // 【這是本任務最重要的一條】從 +X side 射進去：先進機身的高 X 面
    // （法線 +X），再進座艙。倍率取的是座艙（×2.5），但法線必須是機身的 ——
    // 那才是彈丸真正先碰到的表面。跟著倍率走的話火花會從機體內部噴出來。
    const out = createHitResult()
    const s0 = new Vector3(5, 0.5, 0)
    const s1 = new Vector3(-5, 0.5, 0)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    expect(out.part).toBe('cockpit')          // 倍率仍取最高
    expect(out.nx).toBe(1)                    // 法線來自機身的高 X 面
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })

  it('法線是機體座標 —— 呼叫端負責轉世界', () => {
    // 把飛機繞 Y 轉 90°，法線輸出不變（仍是機體座標的 +X）
    const out = createHitResult()
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    // 機體 +X 在轉了 90° 之後指向世界 −Z，所以線段要從世界 −Z 射進來
    const s0 = new Vector3(0, 0.5, -5)
    const s1 = new Vector3(0, 0.5, 5)
    expect(hitAircraft(NESTED, ORIGIN, q, s0, s1, out)).toBe(true)
    expect(out.nx).toBe(1)
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })

  it('法線恆為單位向量或全零', () => {
    const out = createHitResult()
    const s0 = new Vector3(0, 5, 0)
    const s1 = new Vector3(0, -5, 0)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    const len = Math.hypot(out.nx, out.ny, out.nz)
    expect(len).toBeCloseTo(1, 9)
  })

  it('起點在盒內時三分量皆為 0，呼叫端據此走備援', () => {
    const out = createHitResult()
    const s0 = new Vector3(0, 0, 0)
    const s1 = new Vector3(0, 0, 10)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    expect(out.nx).toBe(0)
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })

  it('createHitResult 的法線起始為 0', () => {
    const out = createHitResult()
    expect(out.nx).toBe(0)
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/hit.test.ts`
Expected: FAIL —— `FaceNormal` 不存在（esbuild 會讓型別 import 消失，但 `face.axis` 的斷言會因為 `segmentBox` 不寫 `outFace` 而失敗）

- [ ] **Step 3: 改 `src/world/hit.ts`**

`HitResult` 加三個欄位：

```ts
export interface HitResult {
  /** 線段參數 t ∈ [0, 1]，取所有命中盒中**最近**的 */
  t: number
  /** 取所有命中盒中**倍率最高**的 */
  part: HitPart
  multiplier: number
  /**
   * 入射面的法線，**機體座標**的單位向量。三分量皆為 0 = 線段起點就在
   * 盒內，沒有入射面（M7 spec §3.2）。
   *
   * 【它跟著 `t` 走而不是跟著 `multiplier` 走】命中盒是巢狀的（座艙整個
   * 包在機身裡）。倍率取最高的那個盒是**內層**，而彈丸真正先碰到的表面
   * 是**外層**。跟著倍率走的話火花會從機體內部噴出來。
   */
  nx: number
  ny: number
  nz: number
}

export function createHitResult(): HitResult {
  return { t: 0, part: 'fuselage', multiplier: 1, nx: 0, ny: 0, nz: 0 }
}
```

新增 `FaceNormal` 並改 `segmentBox`：

```ts
/**
 * slab 測試找到的入射面。
 *
 * `axis`：0 = X、1 = Y、2 = Z；**−1 代表沒有入射面**（線段起點就在盒內）。
 * `sign`：+1 = 從該軸的高面進入（法線 +axis），−1 = 從低面進入（法線 −axis）。
 */
export interface FaceNormal {
  axis: number
  sign: number
}

export function segmentBox(
  ox: number, oy: number, oz: number,
  ex: number, ey: number, ez: number,
  box: HitBox,
  outFace?: FaceNormal,
): number {
  let tMin = 0
  let tMax = 1
  // 【−1 代表「沒有入射面」而不是「還沒算」】tMin 起始為 0，若三個軸都
  // 沒有抬高過它（起點在盒內），這個值就會原樣留到最後（M7 spec §3.2）。
  let hitAxis = -1
  let hitSign = 0

  const c = box.center
  const h = box.half
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz
    const e = axis === 0 ? ex : axis === 1 ? ey : ez
    const cc = axis === 0 ? c.x : axis === 1 ? c.y : c.z
    const hh = axis === 0 ? h.x : axis === 1 ? h.y : h.z
    const d = e - o
    const lo = cc - hh
    const hi = cc + hh

    // 【平行於這一軸】不可以直接除——0 除會得到 ±Infinity，而
    // 0/0 會得到 NaN，NaN 的比較恆為 false，於是「未命中」會被靜靜地
    // 當成命中。改成先檢查起點是否落在這一軸的區間內。
    if (d > -1e-12 && d < 1e-12) {
      if (o < lo || o > hi) return NO_HIT
      continue
    }

    const inv = 1 / d
    let t0 = (lo - o) * inv
    let t1 = (hi - o) * inv
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
    }
    if (t0 > tMin) {
      tMin = t0
      hitAxis = axis
      // 沿 +axis 前進 → 從低面進入 → 法線指向 −axis，反之亦然
      hitSign = d > 0 ? -1 : 1
    }
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return NO_HIT
  }

  // 【只在確定命中之後才寫】未命中的路徑全部提早 return，所以呼叫端在
  // NO_HIT 時拿到的是上一次的值——與「false 時不動 out」同一條約定。
  if (outFace !== undefined) {
    outFace.axis = hitAxis
    outFace.sign = hitSign
  }
  return tMin
}
```

`hitAircraft` 的迴圈記下與 `bestT` 同一個盒的面：

```ts
/** slab 測試的入射面。模組私有、每次呼叫重用（熱路徑零配置） */
const FACE: FaceNormal = { axis: -1, sign: 0 }

// ...（函數簽章與前半段不動）...

  let bestT = Infinity
  let bestMul = -1
  let bestPart: HitPart = 'fuselage'
  let bestAxis = -1
  let bestSign = 0
  for (const box of boxes) {
    const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box, FACE)
    if (t === NO_HIT) continue
    if (t < bestT) {
      bestT = t
      // 【法線跟著 t 走】見 HitResult.nx 的註解
      bestAxis = FACE.axis
      bestSign = FACE.sign
    }
    const mul = PART_MULTIPLIER[box.part]
    if (mul > bestMul) {
      bestMul = mul
      bestPart = box.part
    }
  }
  if (bestMul < 0) return false

  out.t = bestT
  out.part = bestPart
  out.multiplier = bestMul
  out.nx = bestAxis === 0 ? bestSign : 0
  out.ny = bestAxis === 1 ? bestSign : 0
  out.nz = bestAxis === 2 ? bestSign : 0
  return true
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/hit.test.ts test/unit/cull-equivalence.test.ts test/integration/hit-matrix.test.ts`
Expected: PASS。**命中矩陣特別重要** —— 它是「命中判定行為沒變」的證據。

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 6: 提交**

```bash
git add src/world/hit.ts test/unit/hit.test.ts
git commit -m "feat: slab 測試回傳入射面法線（M7 spec §3）

最後抬高 tMin 的那一軸就是入射面所在的軸，從低面還是高面進去由方向分量
的正負決定 —— 抓出來只是六次迴圈裡多兩個賦值，不是新的計算。

法線必須跟著 t 走而不是跟著倍率走。命中盒是巢狀的（座艙整個包在機身裡），
倍率取最高的是內層盒，而彈丸真正先碰到的表面是外層。跟著倍率走的話火花
會從機體內部噴出來。有一條測試專門守它。

起點落在盒內時 tMin 保持 0，沒有入射面 —— 三分量回 0，呼叫端據此走備援。
硬給一個方向會讓火花往任意方向噴，而那個錯誤看起來像是法線算錯。

outFace 是選用參數，既有的 segmentBox 呼叫端一個字都不用改。"
```

---

## Task 2: `world/events.ts` —— 撞擊事件緩衝

**Files:**
- Create: `src/world/events.ts`
- Test: `test/unit/world-events.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  ```ts
  const IMPACT_CAPACITY = 64
  const IMPACT_STRIDE = 6
  interface ImpactEvents { readonly capacity: number; readonly data: Float32Array
                           count: number; dropped: number }
  function createImpacts(capacity?: number): ImpactEvents
  function pushImpact(e, x, y, z, nx, ny, nz): void
  function clearImpacts(e): void
  ```

**背景**（spec §2.2）：火花與水柱沒有可以重算的錨點，只能用事件。緩衝在**主迴圈的子步回呼**裡排空 —— `main.ts:210` 已經為 `hitsDealt` 寫過這個理由：「`World.step` 在每個物理步開頭把它歸零，而一幀可能跑好幾步」。排空之後清空，所以容量只需要覆蓋**一個子步**。

**一個型別兩個實例**：水柱其實就是「法線朝上的撞擊」，所以與命中共用同一個結構，不必為了省三個 float 寫兩份。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import {
  createImpacts, pushImpact, clearImpacts,
  IMPACT_CAPACITY, IMPACT_STRIDE,
} from '../../src/world/events'

describe('ImpactEvents（M7 spec §2.2）', () => {
  it('建立時是空的，容量預配', () => {
    const e = createImpacts()
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(0)
    expect(e.capacity).toBe(IMPACT_CAPACITY)
    expect(e.data.length).toBe(IMPACT_CAPACITY * IMPACT_STRIDE)
  })

  it('推入的六個分量照 stride 排好', () => {
    const e = createImpacts(4)
    pushImpact(e, 1, 2, 3, 0, 1, 0)
    pushImpact(e, 4, 5, 6, 1, 0, 0)
    expect(e.count).toBe(2)
    expect(Array.from(e.data.subarray(0, 12)))
      .toEqual([1, 2, 3, 0, 1, 0, 4, 5, 6, 1, 0, 0])
  })

  it('滿了就丟棄並計數，不會越界寫', () => {
    // 【為什麼是丟棄而不是擴容】這是熱路徑上的緩衝，擴容就是配置。
    // 而它裝的是純裝飾的東西 —— 掉幾顆火花沒有人看得出來，但一次
    // 意外的配置會出現在每一步。
    const e = createImpacts(2)
    pushImpact(e, 1, 0, 0, 0, 1, 0)
    pushImpact(e, 2, 0, 0, 0, 1, 0)
    pushImpact(e, 3, 0, 0, 0, 1, 0)
    expect(e.count).toBe(2)
    expect(e.dropped).toBe(1)
    expect(e.data[0]).toBe(1)
    expect(e.data[6]).toBe(2)
  })

  it('clearImpacts 只清 count，不清 dropped', () => {
    // 【為什麼 dropped 是累計的】它是給整合測試斷言「從未溢位」用的。
    // 每次排空都歸零的話，溢位會在下一次排空時被抹掉而永遠測不到。
    const e = createImpacts(1)
    pushImpact(e, 1, 0, 0, 0, 1, 0)
    pushImpact(e, 2, 0, 0, 0, 1, 0)
    clearImpacts(e)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(1)
  })

  it('清空後可以再用，不會殘留上一批', () => {
    const e = createImpacts(4)
    pushImpact(e, 9, 9, 9, 0, 1, 0)
    clearImpacts(e)
    pushImpact(e, 1, 2, 3, 1, 0, 0)
    expect(e.count).toBe(1)
    expect(Array.from(e.data.subarray(0, 6))).toEqual([1, 2, 3, 1, 0, 0])
  })

  it('預設容量 64 的推導 —— 一個子步綽綽有餘', () => {
    // 40 架全開火是 2,434 發/s；全部命中（不可能）在 60 fps 下是 41 次/幀，
    // 除以 8 個子步約 6 次/子步。64 是它的 10 倍。
    expect(IMPACT_CAPACITY).toBe(64)
    expect(IMPACT_STRIDE).toBe(6)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/world-events.test.ts`
Expected: FAIL，`src/world/events.ts` 不存在

- [ ] **Step 3: 實作 `src/world/events.ts`**

```ts
/**
 * 一個物理步之內產生的撞擊事件。
 *
 * 【為什麼是事件而不是狀態】火花一噴出就與飛機脫鉤、水柱錨在海面上的一個
 * 定點 —— 兩者都**沒有可以重算的錨點**（槍焰有，所以它走計時器，見
 * M7 spec §2.1）。
 *
 * 【為什麼在子步回呼裡排空而不是幀尾】`main.ts` 已經為 `hitsDealt` 寫過
 * 這個理由：`World.step` 在每個物理步開頭把它歸零，而一幀可能跑好幾步；
 * 在幀尾才讀的話，最後一步以外的全部漏掉。排空之後清空，所以容量只需要
 * 覆蓋**一個子步**。
 *
 * 【為什麼命中與入海共用一個型別】水柱就是「法線朝上的撞擊」。為了省三個
 * float 寫兩份長得很像的結構，就是只有一份會被修好的那種危險。
 */
export const IMPACT_STRIDE = 6

/**
 * 每個子步的事件容量。
 *
 * 【64 怎麼來】40 架全開火是 2,434 發/s（藍隊 20 × 6 挺 × 13.3/s，
 * 加紅隊 20 × (11.7 + 2 × 15)/s）。假設**全部命中**（物理上不可能），
 * 60 fps 下是 41 次/幀，除以 8 個子步約 6 次/子步。64 是它的 10 倍。
 */
export const IMPACT_CAPACITY = 64

export interface ImpactEvents {
  readonly capacity: number
  /** 每筆 `IMPACT_STRIDE` 個 float：x, y, z, nx, ny, nz */
  readonly data: Float32Array
  /** 這一個子步累積了幾筆。`clearImpacts` 歸零 */
  count: number
  /**
   * 因為緩衝滿了而被丟棄的累計筆數。**不會被 `clearImpacts` 歸零。**
   *
   * 【為什麼累計】它是給整合測試斷言「從未溢位」用的。每次排空都歸零的話，
   * 溢位會在下一次排空時被抹掉，於是永遠測不到。
   */
  dropped: number
}

export function createImpacts(capacity: number = IMPACT_CAPACITY): ImpactEvents {
  return {
    capacity,
    data: new Float32Array(capacity * IMPACT_STRIDE),
    count: 0,
    dropped: 0,
  }
}

/**
 * 追加一筆。滿了就丟棄並計數。
 *
 * 【為什麼是丟棄而不是擴容】這是熱路徑上的緩衝，擴容就是配置。而它裝的是
 * 純裝飾的東西 —— 掉幾顆火花沒有人看得出來，但一次意外的配置會出現在
 * 每一個物理步。
 *
 * 熱路徑：不配置。
 */
export function pushImpact(
  e: ImpactEvents,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * IMPACT_STRIDE
  const d = e.data
  d[o] = x
  d[o + 1] = y
  d[o + 2] = z
  d[o + 3] = nx
  d[o + 4] = ny
  d[o + 5] = nz
  e.count++
}

/** 排空。不動 `dropped` —— 見它的註解。 */
export function clearImpacts(e: ImpactEvents): void {
  e.count = 0
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/world-events.test.ts`
Expected: PASS（6 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 6: 提交**

```bash
git add src/world/events.ts test/unit/world-events.test.ts
git commit -m "feat: 撞擊事件緩衝（M7 spec §2.2）

定長 SoA，滿了就丟棄並計數 —— 這是熱路徑上的緩衝，擴容就是配置，而它裝
的是純裝飾的東西：掉幾顆火花沒有人看得出來，但一次意外的配置會出現在
每一個物理步。

dropped 是累計的、不被 clearImpacts 歸零，因為它是給整合測試斷言「從未
溢位」用的；每次排空都歸零的話，溢位會在下一次排空時被抹掉。

命中與入海共用同一個型別 —— 水柱就是「法線朝上的撞擊」。為了省三個 float
寫兩份長得很像的結構，就是只有一份會被修好的那種危險。"
```

---

## Task 3: `World` —— 槍焰計時器

**Files:**
- Modify: `src/weapons/types.ts`（新增 `MAX_MOUNTS`）
- Modify: `src/world/World.ts`
- Test: `test/unit/world.test.ts`（追加 describe）、`test/unit/weapons.test.ts`（追加一條上界守門）

**Interfaces:**
- Consumes: 無
- Produces:
  ```ts
  // src/weapons/types.ts
  const MAX_MOUNTS = 8
  // src/world/World.ts
  const FLASH_SECONDS = 0.03
  interface Combatant { /* ... */ muzzleFlash: Float32Array }
  ```

**背景**（spec §2.1、§5）：槍焰不用事件。事件會帶著**物理子步**的位置，而畫面畫在**內插後**的位置 —— 200 m/s 下差 0.83 m，槍焰會相對機身抖動接近一個機身長度。計時器是一個**狀態**而不是一個瞬間，所以取樣頻率不匹配也漏不掉：一管 M2 是 75 ms 一發，一幀跑 4 個子步而只在最後一步讀的話，用事件會漏掉前 3 步。

`FLASH_SECONDS = 0.03 s` 由兩個界夾出來：下界是 60 fps 的一幀 16.7 ms（閃得比一幀短就會被抽樣漏掉，有時看得到有時看不到，那比沒有更糟）；上界是全場最快的 MG 131（900 rpm = 67 ms 一發），工作週期 30/67 = 45%，讀起來是**閃爍**而不是一盞常亮的燈。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/weapons.test.ts` 檔尾追加（import 併進既有區塊）：

```ts
describe('MAX_MOUNTS —— 槍焰的容量上界（M7 spec §5.2）', () => {
  it('所有機種的掛架數都不超過它', () => {
    // 【為什麼要守】它是一個容量上界而不是一個描述。某天有人加一台
    // 九挺槍的飛機，第九挺的槍焰會**靜靜地畫不出來** —— 沒有錯誤、
    // 沒有警告，只是那一管永遠不閃。與 createFlights 檢查
    // 「index === 陣列位置」是同一類的守門。
    expect(P51D.battery.mounts.length).toBeLessThanOrEqual(MAX_MOUNTS)
    expect(BF109G6.battery.mounts.length).toBeLessThanOrEqual(MAX_MOUNTS)
  })
})
```

在 `test/unit/world.test.ts` 檔尾追加（import 併進既有區塊，補上 `FLASH_SECONDS`、`MAX_MOUNTS`）：

```ts
describe('槍焰計時器（M7 spec §5.1）', () => {
  const DT = 1 / 240

  /** 造一個只有一架飛機的世界，扳機由回傳的 setter 控制。 */
  function oneShooter() {
    const w = new World()
    const a = new Aircraft(P51D, 4000, 200)
    let firing = false
    const controller: Controller = {
      update(_a, _dt, out) {
        out.aimWorld.set(0, 0, -1)
        out.throttle = 0.7
        out.brake = 0
        out.firing = firing
      },
    }
    const c = w.add(a, controller, 'blue', a.state.position.clone(), 4000, 200)
    return { w, c, fire: (on: boolean) => { firing = on } }
  }

  it('每個掛架一個計時器，長度等於掛架數', () => {
    const { c } = oneShooter()
    expect(c.muzzleFlash.length).toBe(P51D.battery.mounts.length)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('擊發的那一步把計時器設成 FLASH_SECONDS', () => {
    const { w, c, fire } = oneShooter()
    fire(true)
    w.step(DT)
    expect(Math.max(...Array.from(c.muzzleFlash))).toBeCloseTo(FLASH_SECONDS, 9)
  })

  it('放開扳機之後計時器遞減到 0 並停在 0', () => {
    const { w, c, fire } = oneShooter()
    fire(true)
    w.step(DT)
    fire(false)
    // 走滿 FLASH_SECONDS 再多一點
    const steps = Math.ceil(FLASH_SECONDS / DT) + 4
    for (let i = 0; i < steps; i++) w.step(DT)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('不會變成負數', () => {
    const { w, c } = oneShooter()
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('退場的飛機計時器也會熄掉', () => {
    // 【為什麼要測】退場的飛機在 step 的第一段就被 continue 掉了。
    // 遞減若寫在 continue 之後，被打爆那一瞬間亮著的槍焰會永遠停在那裡。
    const { w, c, fire } = oneShooter()
    fire(true)
    w.step(DT)
    expect(Math.max(...Array.from(c.muzzleFlash))).toBeGreaterThan(0)
    w.destroy(c)
    const steps = Math.ceil(FLASH_SECONDS / DT) + 4
    for (let i = 0; i < steps; i++) w.step(DT)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('換機種時陣列跟著重建', () => {
    // 【不重建會怎樣】P-51 六挺換成 109 三挺之後，多出來的三格永遠不會
    // 被遞減也不會被設定 —— 若換機種那一刻它們是亮的，就變成三管永遠
    // 不熄的槍焰。與 cooldowns 必須重配是同一個理由。
    const { w, c, fire } = oneShooter()
    fire(true)
    w.step(DT)
    w.setSpec(c, BF109G6)
    expect(c.muzzleFlash.length).toBe(BF109G6.battery.mounts.length)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('FLASH_SECONDS 落在「一幀」與「最快射擊間隔」之間', () => {
    // 下界：60 fps 的一幀 16.7 ms。短於它就會被抽樣漏掉
    expect(FLASH_SECONDS).toBeGreaterThan(1 / 60)
    // 上界：MG 131 是 900 rpm = 66.7 ms 一發。工作週期必須明顯低於 1，
    // 不然讀起來是一盞常亮的燈而不是閃爍
    expect(FLASH_SECONDS / (60 / 900)).toBeLessThan(0.6)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/world.test.ts test/unit/weapons.test.ts`
Expected: FAIL，`MAX_MOUNTS` / `FLASH_SECONDS` / `muzzleFlash` 不存在

- [ ] **Step 3: 改 `src/weapons/types.ts`**

在檔尾（或 `Battery` 定義之後）新增：

```ts
/**
 * 一台飛機最多有幾個掛架。
 *
 * 【它是容量上界不是描述】槍焰的 `InstancedMesh` 用「架數 × MAX_MOUNTS」
 * 預配實例。某天有人加一台九挺槍的飛機，第九挺會**靜靜地畫不出來** ——
 * 沒有錯誤、沒有警告，只是那一管永遠不閃。所以 `weapons.test.ts` 有一條
 * 斷言把所有機種都掃過一次。
 *
 * 【8 怎麼來】目前最多的是 P-51D 的 6 挺，留兩格餘裕。
 */
export const MAX_MOUNTS = 8
```

- [ ] **Step 4: 改 `src/world/World.ts`**

檔頭常數區（`const S = makeScratch(3)` 附近）新增：

```ts
/**
 * 槍焰的顯示時長，s。
 *
 * 【兩個界夾出來的】
 * **下界 16.7 ms**：60 fps 的一幀。閃得比一幀短就會被抽樣漏掉 —— 有時
 * 看得到有時看不到，那比沒有更糟。30 ms 橫跨 1.8 幀，保證每次擊發至少
 * 畫到一幀。
 * **上界 67 ms**：全場最快的一管是 Bf 109 的 MG 131（900 rpm）。工作
 * 週期 30/67 = 45%，讀起來是**閃爍**；取到 60 ms 以上就變成一盞常亮的
 * 燈，那是錯的視覺（M7 spec §5.3）。
 *
 * 【為什麼住在 World 而不是 render】它記的是「這一管距離上次擊發多久」，
 * 那是物理事實不是畫面參數。渲染層決定它長什麼樣子。
 */
export const FLASH_SECONDS = 0.03
```

`Combatant` 新增欄位（放在 `cooldowns` 之後）：

```ts
  /**
   * 每個掛架的槍焰剩餘秒數。長度等於 `spec.battery.mounts.length`。
   *
   * 【為什麼是計時器而不是事件】事件會帶著**物理子步**的位置，而畫面畫
   * 在**內插後**的位置 —— 200 m/s 下差 0.83 m，槍焰會相對機身抖動接近
   * 一個機身長度。計時器是一個**狀態**，渲染層讀它的時候自己用內插姿態
   * 重算槍口位置（M7 spec §2.1）。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時掛架數會變。
   */
  muzzleFlash: Float32Array
```

`add()` 裡（`cooldowns` 那一行之後）：

```ts
      muzzleFlash: new Float32Array(aircraft.spec.battery.mounts.length),
```

`setSpec()` 裡，找到重配 `cooldowns` 的那一段，**在同一個地方**加上 `muzzleFlash`：

```ts
    // 【槍焰計時器與射速時鐘一起重配】理由相同，而且必須在同一個地方 ——
    // 分開寫就是只有一份會被修好的那種危險。
    if (c.muzzleFlash.length !== spec.battery.mounts.length) {
      c.muzzleFlash = new Float32Array(spec.battery.mounts.length)
    } else {
      c.muzzleFlash.fill(0)
    }
```

`step()` 的第一段迴圈（歸零 `hitsDealt` 的那一個），**在 `if (!c.alive) continue` 之前**加上遞減：

```ts
    for (const c of this.combatants) {
      c.hitsDealt = 0
      // 【槍焰的遞減要在 alive 檢查之前】被打爆那一瞬間亮著的槍焰，
      // 若遞減寫在 continue 之後就會永遠停在那裡。
      const flash = c.muzzleFlash
      for (let i = 0; i < flash.length; i++) {
        const v = flash[i]! - dt
        flash[i] = v > 0 ? v : 0
      }
      if (!c.alive) continue
      c.controller.update(c.aircraft, dt, c.command)
    }
```

`fire()` 裡，`if (shots === 0) continue` 之後加一行：

```ts
      c.muzzleFlash[i] = FLASH_SECONDS
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run test/unit/world.test.ts test/unit/weapons.test.ts test/integration/ai-duel-matrix.test.ts`
Expected: PASS。**對戰矩陣是「開火行為沒變」的證據。**

- [ ] **Step 6: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 7: 提交**

```bash
git add src/weapons/types.ts src/world/World.ts test/unit/world.test.ts test/unit/weapons.test.ts
git commit -m "feat: 槍焰計時器（M7 spec §5）

槍焰不用事件。事件會帶著物理子步的位置，而畫面畫在內插後的位置 ——
200 m/s 下差 0.83 m，槍焰會相對機身抖動接近一個機身長度。計時器是一個
狀態而不是一個瞬間，所以取樣頻率不匹配也漏不掉：一管 M2 是 75 ms 一發，
一幀跑 4 個子步而只在最後一步讀的話，用事件會漏掉前 3 步。

FLASH_SECONDS = 0.03 s 由兩個界夾出來：下界 60 fps 的一幀 16.7 ms（短於
它會被抽樣漏掉，有時看得到有時看不到，比沒有更糟），上界 MG 131 的 67 ms
射擊間隔（工作週期 45%，讀起來是閃爍而不是一盞常亮的燈）。

遞減寫在 alive 檢查之前 —— 被打爆那一瞬間亮著的槍焰，寫在 continue 之後
就會永遠停在那裡。

MAX_MOUNTS 是容量上界不是描述，所以有一條測試把所有機種掃過一次：某天
有人加一台九挺槍的飛機，第九挺的槍焰會靜靜地畫不出來。"
```

---

## Task 4: `World` —— 命中事件

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/unit/world.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `HitResult.nx/ny/nz`（Task 1）、`createImpacts` / `pushImpact` / `clearImpacts`（Task 2）
- Produces: `World.hitEvents: ImpactEvents` —— 每筆是 `(世界命中點, 世界法線)`

**背景**（spec §3.2、§2.2）：`resolveHits` 已經算出 `bestT`（線段參數）與 `victim`。世界命中點就是 `s0 + bestT × (s1 − s0)`；法線要從**機體座標**轉世界，用受害者的姿態。

兩件事要小心：`this.hit` 每次 `hitAircraft` 呼叫都會被覆寫，所以法線必須**與 `bestT` 一起**抄進區域變數；起點在盒內時法線是 (0,0,0)，備援用 −彈丸方向（迎面噴回去）。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/world.test.ts` 追加：

```ts
describe('命中事件（M7 spec §2.2）', () => {
  const DT = 1 / 240

  /** 藍 0 在原點朝 −Z；紅 1 在 −Z 方向 300 m 處朝 +Z。 */
  function duel() {
    const w = new World()
    const idle: Controller = {
      update(_a, _dt, out) {
        out.aimWorld.set(0, 0, -1)
        out.throttle = 0.7
        out.brake = 0
        out.firing = false
      },
    }
    const blue = new Aircraft(P51D, 4000, 200)
    blue.state.position.set(0, 4000, 0)
    blue.prevPosition.copy(blue.state.position)
    const red = new Aircraft(P51D, 4000, 200)
    red.state.position.set(0, 4000, -300)
    red.prevPosition.copy(red.state.position)
    const b = w.add(blue, idle, 'blue', blue.state.position.clone(), 4000, 200)
    const r = w.add(red, idle, 'red', red.state.position.clone(), 4000, 200)
    return { w, b, r }
  }

  it('打中飛機時推一筆事件，命中點落在兩機之間', () => {
    const { w, r } = duel()
    // 從藍機正前方 20 m 處往 −Z 射一發，速度足以在一步內走到紅機附近
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(1)
    const z = w.hitEvents.data[2]!
    expect(z).toBeLessThan(-280)
    expect(z).toBeGreaterThan(r.aircraft.state.position.z - 10)
  })

  it('法線是世界座標的單位向量', () => {
    const { w } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.resolveHits()
    const d = w.hitEvents.data
    expect(Math.hypot(d[3]!, d[4]!, d[5]!)).toBeCloseTo(1, 6)
  })

  it('法線大致迎著彈丸 —— 從前方射來就朝 +Z', () => {
    // 【為什麼只要求「大致」】命中盒是機體座標的 AABB，法線是盒面的法線，
    // 不是機體外殼的真實曲面法線。要求的是「不會朝著彈丸飛去的方向」。
    const { w } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.resolveHits()
    const d = w.hitEvents.data
    // 彈丸往 −Z 飛，所以法線的 Z 分量必須為正（迎著它）
    expect(d[5]!).toBeGreaterThan(0)
  })

  it('沒打中就沒有事件', () => {
    const { w } = duel()
    w.projectiles.spawn(500, 4000, -280, 0, 0, -887, 10, 0)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(0)
  })

  it('一步之內多發命中就有多筆', () => {
    const { w } = duel()
    for (let i = 0; i < 3; i++) w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(3)
  })

  it('事件不會跨步累積 —— 呼叫端排空之後就是乾淨的', () => {
    const { w } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(1)
    clearImpacts(w.hitEvents)
    w.step(DT)
    expect(w.hitEvents.count).toBe(0)
  })

  it('緩衝滿了不會越界，dropped 會計數', () => {
    const { w } = duel()
    for (let i = 0; i < w.hitEvents.capacity + 5; i++) {
      w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 1, 0)
    }
    w.resolveHits()
    expect(w.hitEvents.count).toBe(w.hitEvents.capacity)
    expect(w.hitEvents.dropped).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/world.test.ts`
Expected: FAIL，`World.hitEvents` 不存在

- [ ] **Step 3: 改 `src/world/World.ts`**

新增 import：

```ts
import { createImpacts, pushImpact, type ImpactEvents } from './events'
```

`S` 由 `makeScratch(3)` 改為 `makeScratch(4)`：

```ts
// 【第四個給命中法線用】resolveHits 的 s0/s1 佔了 v[0]、v[1]，fire 佔
// v[0..2]，兩者不同時執行。v[3] 是本里程碑新增的法線暫存。
const S = makeScratch(4)
```

`World` 類別新增公開欄位：

```ts
  /**
   * 這一個物理步之內的命中事件。**呼叫端負責排空**（M7 spec §2.2）。
   *
   * 【為什麼是呼叫端排空而不是 World 自己在 step 開頭清】一幀可能跑好幾
   * 個子步，而渲染層在子步回呼裡消費。`World` 自己清的話，能不能收到就
   * 取決於清空與消費的先後順序 —— 那是一個看不出來的耦合。
   *
   * headless 測試不排空，於是它會填滿並開始丟棄。那沒有問題：`dropped`
   * 是給**有排空**的整合測試斷言用的（見 `multi-battle.test.ts`）。
   */
  readonly hitEvents: ImpactEvents = createImpacts()
```

`resolveHits()` 的內層迴圈追蹤法線。找到 `let bestT = Infinity` 那一段，改成：

```ts
      let bestT = Infinity
      let victim: Combatant | null = null
      let part: HitPart = 'fuselage'
      // 【法線要與 bestT 一起抄】this.hit 每次 hitAircraft 呼叫都被覆寫，
      // 留到迴圈外再讀就會拿到「最後一個被測到的盒」而不是「最近的那一個」
      let bestNx = 0
      let bestNy = 0
      let bestNz = 0
```

內層命中時一併抄：

```ts
        bestT = this.hit.t
        victim = c
        part = this.hit.part
        bestNx = this.hit.nx
        bestNy = this.hit.ny
        bestNz = this.hit.nz
```

`if (!victim) continue` 之後、`applyDamage` 之前推事件：

```ts
      // 【命中點與世界法線】命中點是線段上的 bestT；法線由機體座標轉世界
      const n = S.v[3]!
      if (bestNx !== 0 || bestNy !== 0 || bestNz !== 0) {
        n.set(bestNx, bestNy, bestNz).applyQuaternion(victim.aircraft.state.orientation)
      } else {
        // 【起點就在盒內】沒有入射面（M7 spec §3.2）。迎面噴回去 ——
        // 這是唯一一個「沒有正確答案」的情形，取一個不會出錯的方向。
        n.set(ax - bx, ay - by, az - bz)
        const len = n.length()
        if (len > 1e-6) n.divideScalar(len)
        else n.set(0, 1, 0)
      }
      pushImpact(
        this.hitEvents,
        ax + (bx - ax) * bestT, ay + (by - ay) * bestT, az + (bz - az) * bestT,
        n.x, n.y, n.z,
      )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/world.test.ts test/unit/cull-equivalence.test.ts test/integration/hit-matrix.test.ts`
Expected: PASS

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 6: 提交**

```bash
git add src/world/World.ts test/unit/world.test.ts
git commit -m "feat: 命中事件（M7 spec §2.2）

resolveHits 已經算出 bestT 與 victim，命中點就是線段上的 bestT，法線由
機體座標用受害者的姿態轉到世界。

法線必須與 bestT 一起抄進區域變數 —— this.hit 每次 hitAircraft 呼叫都
被覆寫，留到迴圈外再讀會拿到「最後一個被測到的盒」而不是「最近的那一個」。

起點落在盒內時沒有入射面，備援是迎面噴回去。那是唯一一個「沒有正確答案」
的情形，取一個不會出錯的方向。

緩衝由呼叫端排空而不是 World 自己在 step 開頭清：一幀可能跑好幾個子步，
自己清的話能不能收到就取決於清空與消費的先後順序，而那是一個看不出來
的耦合。"
```

---

## Task 5: `World` —— 入海回收與水柱事件

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/unit/world.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `createImpacts` / `pushImpact`（Task 2）、`boundingRadius`（既有）
- Produces:
  ```ts
  const SEA_SURFACE_Y = 0
  const SEA_KILL_Y = -20
  World.splashEvents: ImpactEvents      // 法線恆為 (0, 1, 0)
  ```

**背景**（spec §4）：彈丸目前完全不理海面。**兩件事用兩個高度**：

| 常數 | 值 | 用途 |
|---|---|---|
| `SEA_SURFACE_Y` | 0 | 線段跨過它 → 推一筆水柱事件（一發一根） |
| `SEA_KILL_Y` | −20 m | 彈丸低於它 → 回收 |

**為什麼不是同一個高度**（spec §4.3，初稿在這裡寫錯過）：撞海判定是
`y <= 浪高 + CRASH_CLEARANCE`，而 `CRASH_CLEARANCE = 2 m`、浪谷可到
−2.15 m —— 一架**還活著**的飛機可以低到 `y = −0.15 m`，它的命中盒
（最大包圍半徑 7.1 m）更可以伸到 −7 m。在 `y = 0` 就回收，理論上會吃掉
那些命中。取一個保守的浪谷 −5 m 得「存活飛機原點 > −3 m」，加上 7.1 m
的包圍半徑 → 存活飛機的命中盒伸不到 −10.1 m 以下。**−20 m 有兩倍餘裕，
因此證明得出回收它不會少算任何命中。**

- [ ] **Step 1: 先量基準**

在動程式之前跑一次，把數字抄下來 —— 加入回收之後這些必須**完全不變**。

Run: `npx vitest run test/integration/multi-battle.test.ts --reporter=basic`
抄下 console 印出的 `blueLost`、`redLost`、`blueDamage`、`redDamage`。
（M6 交付時是 `0 / 1 / 2451.3999999999987 / 3019.0000000000086`，但請以**這一次實跑**的數字為準。）

- [ ] **Step 2: 寫失敗的測試**

在 `test/unit/world.test.ts` 追加（import 補上 `SEA_KILL_Y`、`SEA_SURFACE_Y`、`boundingRadius`）：

```ts
describe('入海回收與水柱事件（M7 spec §4）', () => {
  /** 只有一架飛機的空世界，用來單獨觀察彈丸。 */
  function empty() {
    const w = new World()
    const idle: Controller = {
      update(_a, _dt, out) {
        out.aimWorld.set(0, 0, -1)
        out.throttle = 0.7
        out.brake = 0
        out.firing = false
      },
    }
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.prevPosition.copy(a.state.position)
    w.add(a, idle, 'blue', a.state.position.clone(), 4000, 200)
    return w
  }

  it('線段跨過水面時推一筆水柱事件，交點內插正確', () => {
    const w = empty()
    // 從 y = 10 往下走一步到 y = −10：交點在中間，t = 10/20 = 0.5
    const i = w.projectiles.spawn(100, 10, 200, 20, -20, 40, 10, 0)
    w.projectiles.step(1)
    expect(w.projectiles.y[i]).toBeCloseTo(-10, 6)
    w.resolveHits()
    expect(w.splashEvents.count).toBe(1)
    const d = w.splashEvents.data
    expect(d[0]).toBeCloseTo(110, 6)   // x: 100 + 0.5 × 20
    expect(d[1]).toBeCloseTo(0, 6)     // y: 水面
    expect(d[2]).toBeCloseTo(220, 6)   // z: 200 + 0.5 × 40
  })

  it('水柱的法線朝上 —— 它就是「法線朝上的撞擊」', () => {
    const w = empty()
    w.projectiles.spawn(0, 10, 0, 0, -20, 0, 10, 0)
    w.projectiles.step(1)
    w.resolveHits()
    const d = w.splashEvents.data
    expect([d[3], d[4], d[5]]).toEqual([0, 1, 0])
  })

  it('一發彈丸只噴一根柱子', () => {
    // 【為什麼會噴兩根】判準若寫成「y <= 0」而不是「跨過 0」，彈丸在
    // 水面下的每一步都會再推一筆，一發變成一串。
    const w = empty()
    w.projectiles.spawn(0, 1, 0, 0, -100, 0, 10, 0)
    for (let n = 0; n < 5; n++) {
      w.projectiles.step(1 / 240)
      w.resolveHits()
    }
    expect(w.splashEvents.count).toBe(1)
  })

  it('低於 SEA_KILL_Y 才回收，不是一入水就回收', () => {
    const w = empty()
    const i = w.projectiles.spawn(0, 1, 0, 0, -100, 0, 10, 0)
    // 一步走 −100/240 ≈ −0.42 m。走到 y ≈ −1 時仍該活著
    for (let n = 0; n < 5; n++) {
      w.projectiles.step(1 / 240)
      w.resolveHits()
    }
    expect(w.projectiles.y[i]!).toBeLessThan(0)
    expect(w.projectiles.y[i]!).toBeGreaterThan(SEA_KILL_Y)
    expect(w.projectiles.owner[i]).toBe(0)

    // 繼續走到 SEA_KILL_Y 以下
    for (let n = 0; n < 60; n++) {
      w.projectiles.step(1 / 240)
      w.resolveHits()
    }
    expect(w.projectiles.owner[i]).toBe(-1)
  })

  it('往上飛的彈丸不會誤判', () => {
    const w = empty()
    w.projectiles.spawn(0, 1, 0, 0, 100, 0, 10, 0)
    w.projectiles.step(1 / 240)
    w.resolveHits()
    expect(w.splashEvents.count).toBe(0)
  })

  it('SEA_KILL_Y 低於任何存活飛機的命中盒可能到達的最低點', () => {
    // 【這是 §4.3 的證明本身，不是它的一個抽樣】
    // 存活 ⟹ 原點 > 浪谷 + CRASH_CLEARANCE。取保守的浪谷 −5 m、
    // CRASH_CLEARANCE = 2 → 原點 > −3。命中盒最遠伸到原點下方一個包圍半徑。
    const worstOrigin = -5 + CRASH_CLEARANCE
    const maxR = Math.max(boundingRadius(P51D.hitBoxes), boundingRadius(BF109G6.hitBoxes))
    expect(SEA_KILL_Y).toBeLessThanOrEqual(worstOrigin - maxR)
  })

  it('SEA_SURFACE_Y 與 SEA_KILL_Y 是兩個不同的高度', () => {
    expect(SEA_SURFACE_Y).toBe(0)
    expect(SEA_KILL_Y).toBeLessThan(SEA_SURFACE_Y)
  })
})
```

- [ ] **Step 3: 跑測試確認它失敗**

Run: `npx vitest run test/unit/world.test.ts`
Expected: FAIL，`SEA_KILL_Y` / `splashEvents` 不存在

- [ ] **Step 4: 改 `src/world/World.ts`**

檔頭常數區新增：

```ts
/**
 * 水面高度，m。**只用來決定「水柱畫在哪裡」**，不是回收深度。
 *
 * 【它是一個平面而海面不是】`main.ts` 注入的撞海判定走 Gerstner 波
 * （振幅合計約 ±2.15 m）。在 `resolveHits`（4,000 發 × 240 Hz）裡對每一
 * 發彈丸取一次浪高是每秒近百萬次 sin/cos，不划算。誤差最多 2.15 m ——
 * 887 m/s 下 2.4 ms —— 而**看得到的那個東西**（水柱）由渲染層擺在真實
 * 浪高上，所以畫面是對的（M7 spec §4.2）。
 */
export const SEA_SURFACE_Y = 0

/**
 * 彈丸低於這個高度就回收，m。
 *
 * 【為什麼不是 SEA_SURFACE_Y】撞海判定是 `y <= 浪高 + CRASH_CLEARANCE`，
 * 而 `CRASH_CLEARANCE = 2 m`、浪谷可到 −2.15 m —— 一架**還活著**的飛機
 * 可以低到 `y = −0.15 m`，它的命中盒更可以伸到更低。在水面就回收，理論上
 * 會吃掉那些命中（M7 spec §4.3，初稿在這裡寫錯過）。
 *
 * 【−20 m 的推導】存活 ⟹ 機體原點 > 浪谷 + `CRASH_CLEARANCE`。取一個保守
 * 的浪谷 −5 m（實際約 −2.15 m）得原點 > −3 m；加上全機種最大的包圍半徑
 * 7.1 m（P-51D 的機尾角），存活飛機的命中盒伸不到 −10.1 m 以下。−20 m
 * 有兩倍餘裕，所以**證明得出**回收它不會少算任何命中。
 *
 * 代價是彈丸多飛 20 m —— 887 m/s 下 22 ms，而且那一段整個被海面遮住。
 */
export const SEA_KILL_Y = -20
```

`World` 類別新增欄位：

```ts
  /**
   * 這一個物理步之內的入海事件。法線恆為 `(0, 1, 0)` —— 水柱就是「法線
   * 朝上的撞擊」，所以與命中共用同一個型別（M7 spec §2.2）。
   *
   * 與 `hitEvents` 一樣由**呼叫端**排空。
   */
  readonly splashEvents: ImpactEvents = createImpacts()
```

`resolveHits()` 的 `if (!victim) continue` 改成處理入海：

```ts
      if (!victim) {
        // 【水柱只在跨過水面的那一步推】寫成「y <= 水面」的話，彈丸在
        // 水面下的每一步都會再推一筆，一發變成一串。
        if (ay > SEA_SURFACE_Y && by <= SEA_SURFACE_Y) {
          const s = (ay - SEA_SURFACE_Y) / (ay - by)
          pushImpact(
            this.splashEvents,
            ax + (bx - ax) * s, SEA_SURFACE_Y, az + (bz - az) * s,
            0, 1, 0,
          )
        }
        // 【回收在更深的地方】見 SEA_KILL_Y 的推導
        if (by <= SEA_KILL_Y) p.kill(i)
        continue
      }
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run test/unit/world.test.ts test/unit/projectiles.test.ts`
Expected: PASS

- [ ] **Step 6: 驗證命中結果完全沒變**

Run: `npx vitest run test/integration/multi-battle.test.ts --reporter=basic`
Expected: 全綠，且 `blueLost`、`redLost`、`blueDamage`、`redDamage` 與 **Step 1 抄下來的完全相同**。

**不同就停下來**。那代表 `SEA_KILL_Y` 的推導有洞（或是實作把回收寫在飛機命中判定之前），不是「反正差不多」。

- [ ] **Step 7: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 8: 提交**

```bash
git add src/world/World.ts test/unit/world.test.ts
git commit -m "feat: 彈丸入海回收與水柱事件（M7 spec §4）

彈丸原本完全不理海面，會穿過水面繼續飛到壽命結束。

畫水柱與回收彈丸用兩個高度。spec 初稿主張「水面下沒有可以打的目標，
因為飛機在 y <= 0 就墜毀退場了」—— 那不成立：撞海判定是
y <= 浪高 + CRASH_CLEARANCE，而 CRASH_CLEARANCE = 2 m、浪谷可到 −2.15 m，
所以一架還活著的飛機可以低到 y = −0.15 m，它的命中盒（最大包圍半徑
7.1 m）更可以伸到 −7 m。

SEA_SURFACE_Y = 0 只管推水柱事件，而且只在跨過的那一步推 —— 寫成
「y <= 水面」的話一發會變成一串。SEA_KILL_Y = −20 m 才回收，推導：
存活飛機原點 > 保守浪谷 −5 + CRASH_CLEARANCE = −3，加上 7.1 m 的包圍
半徑，存活飛機的命中盒伸不到 −10.1 m 以下，−20 有兩倍餘裕。

有一條測試守著這個界，而且用真實機種資料算 —— 那是證明本身，不是它的
一個抽樣。20v20 的命中與傷害在加入回收前後逐位元相同。"
```

---

## Task 6: `render/muzzle.ts` —— 槍焰

**Files:**
- Create: `src/render/muzzle.ts`
- Test: `test/unit/muzzle.test.ts`

**Interfaces:**
- Consumes: `FLASH_SECONDS`、`Combatant`（Task 3）、`MAX_MOUNTS`、`mountDirection`（`weapons/types.ts`）
- Produces:
  ```ts
  const MUZZLE_LENGTH = 0.6
  const MUZZLE_RADIUS = 0.12
  interface Muzzles {
    object: InstancedMesh
    update(combatants: readonly Combatant[],
           positions: readonly Vector3[], quaternions: readonly Quaternion[]): void
    dispose(): void
  }
  function createMuzzles(aircraftCapacity: number): Muzzles
  ```
  `positions` / `quaternions` 依 `c.index` 索引，由呼叫端每幀填好**內插後**的姿態。

**背景**（spec §5.2、§9）：一個 `InstancedMesh`（1 個 draw call），容量 = 架數 × `MAX_MOUNTS`。位置由**內插姿態**重算而不是取事件裡的位置 —— 那是槍焰走計時器的全部理由。

幾何是短錐而不是廣告板：廣告板恆面向相機，從正側面看槍焰會變成一個圓片而不是一條噴出來的火舌。與 `tracers.ts` 選世界空間幾何是同一個判斷。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { createMuzzles, MUZZLE_LENGTH, MUZZLE_RADIUS } from '../../src/render/muzzle'
import { World, FLASH_SECONDS, type Combatant } from '../../src/world/World'
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

/** 造一架在原點、機首朝 −Z 的 P-51D。 */
function oneAircraft(): { w: World; c: Combatant } {
  const w = new World()
  const a = new Aircraft(P51D, 4000, 200)
  a.state.position.set(0, 4000, 0)
  a.prevPosition.copy(a.state.position)
  const c = w.add(a, new Idle(), 'blue', a.state.position.clone(), 4000, 200)
  return { w, c }
}

/** 讀出第 i 個實例的位置／旋轉／縮放。 */
function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

describe('createMuzzles', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const m = createMuzzles(4)
    expect(m.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    m.object.traverse(() => objects++)
    expect(objects).toBe(1)
    m.dispose()
  })

  it('容量是「架數 × MAX_MOUNTS」，建立時就配足', () => {
    const m = createMuzzles(4)
    expect(m.object.count).toBe(4 * 8)
    expect(m.object.instanceMatrix.count).toBe(4 * 8)
    m.dispose()
  })

  it('建立時全部收成 0，第一幀不會在原點出現一叢', () => {
    const m = createMuzzles(2)
    for (let i = 0; i < m.object.count; i++) {
      expect(instance(m.object, i).scale.x).toBe(0)
    }
    m.dispose()
  })
})

describe('槍焰的位置與朝向', () => {
  it('計時器為 0 時縮成 0 —— 畫不出東西，不必另外剔除', () => {
    const { w, c } = oneAircraft()
    const m = createMuzzles(1)
    const pos = [new Vector3(0, 4000, 0)]
    const quat = [new Quaternion()]
    m.update(w.combatants, pos, quat)
    for (let i = 0; i < c.muzzleFlash.length; i++) {
      expect(instance(m.object, i).scale.x).toBe(0)
    }
    m.dispose()
  })

  it('擊發後亮起，位置落在槍口而不是機體原點', () => {
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    const m = createMuzzles(1)
    const pos = [new Vector3(0, 4000, 0)]
    const quat = [new Quaternion()]
    m.update(w.combatants, pos, quat)

    const mount = P51D.battery.mounts[0]!.position
    const inst = instance(m.object, 0)
    expect(inst.scale.x).toBeGreaterThan(0)
    expect(inst.position.x).toBeCloseTo(mount.x, 4)
    expect(inst.position.y).toBeCloseTo(4000 + mount.y, 4)
    expect(inst.position.z).toBeCloseTo(mount.z, 4)
    m.dispose()
  })

  it('位置用的是傳進來的內插姿態，不是 Aircraft 的物理姿態', () => {
    // 【這是槍焰走計時器的全部理由】渲染層畫的是內插後的位置；用物理
    // 位置的話槍焰會相對機身抖動一個子步的位移（200 m/s 下 0.83 m）。
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    const m = createMuzzles(1)
    const pos = [new Vector3(1000, 500, -2000)]
    const quat = [new Quaternion()]
    m.update(w.combatants, pos, quat)

    const mount = P51D.battery.mounts[0]!.position
    const inst = instance(m.object, 0)
    expect(inst.position.x).toBeCloseTo(1000 + mount.x, 4)
    expect(inst.position.y).toBeCloseTo(500 + mount.y, 4)
    expect(inst.position.z).toBeCloseTo(-2000 + mount.z, 4)
    m.dispose()
  })

  it('姿態旋轉時槍口跟著轉', () => {
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    const m = createMuzzles(1)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    m.update(w.combatants, [new Vector3()], [q])

    const mount = P51D.battery.mounts[0]!.position
    const inst = instance(m.object, 0)
    // 繞 Y 轉 180°：x 與 z 都反號
    expect(inst.position.x).toBeCloseTo(-mount.x, 4)
    expect(inst.position.z).toBeCloseTo(-mount.z, 4)
    m.dispose()
  })

  it('亮度隨計時器遞減 —— 不是開關', () => {
    const { w, c } = oneAircraft()
    const m = createMuzzles(1)
    const pos = [new Vector3()]
    const quat = [new Quaternion()]

    c.muzzleFlash[0] = FLASH_SECONDS
    m.update(w.combatants, pos, quat)
    const full = instance(m.object, 0).scale.x

    c.muzzleFlash[0] = FLASH_SECONDS * 0.25
    m.update(w.combatants, pos, quat)
    const dim = instance(m.object, 0).scale.x

    expect(dim).toBeGreaterThan(0)
    expect(dim).toBeLessThan(full)
    m.dispose()
  })

  it('退場的飛機不畫槍焰', () => {
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    c.alive = false
    const m = createMuzzles(1)
    m.update(w.combatants, [new Vector3()], [new Quaternion()])
    expect(instance(m.object, 0).scale.x).toBe(0)
    m.dispose()
  })

  it('架數少於容量時，多出來的實例維持 0', () => {
    const { w } = oneAircraft()
    const m = createMuzzles(4)
    m.update(w.combatants, [new Vector3()], [new Quaternion()])
    for (let i = 8; i < m.object.count; i++) {
      expect(instance(m.object, i).scale.x).toBe(0)
    }
    m.dispose()
  })

  it('幾何是有方向的錐，不是廣告板', () => {
    // 頭端（+Z）細、底端粗：從側面看是一條噴出來的火舌
    const m = createMuzzles(1)
    const pos = m.object.geometry.getAttribute('position')
    let zMax = -Infinity
    let zMin = Infinity
    let headR = 0
    let tailR = 0
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      const r = Math.hypot(pos.getX(i), pos.getY(i))
      if (z > zMax) { zMax = z; headR = r }
      if (z < zMin) { zMin = z; tailR = r }
    }
    expect(zMax - zMin).toBeCloseTo(MUZZLE_LENGTH, 5)
    expect(tailR).toBeCloseTo(MUZZLE_RADIUS, 5)
    expect(headR).toBeLessThan(tailR)
    m.dispose()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/muzzle.test.ts`
Expected: FAIL，`src/render/muzzle.ts` 不存在

- [ ] **Step 3: 實作 `src/render/muzzle.ts`**

```ts
import {
  AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedMesh,
  Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { MAX_MOUNTS, mountDirection } from '../weapons/types'
import { FLASH_SECONDS } from '../world/World'
import type { Combatant } from '../world/World'

/**
 * 槍焰的長度，m。
 *
 * 【按真實比例，不加螢幕尺寸下限】專案負責人裁決（M7 spec §8.1）。
 * 曾考慮為它加一個像素下限（`contacts.ts` 的目標框就有 `BOX_MIN = 9 px`
 * 的先例），推翻的理由是那個訊號已經有人扛了：一條曳光彈在 1 km 上仍有
 * 24 px 長。兩個訊號回答同一個問題正是要避免的事。
 *
 * 所以槍焰是**近距離的裝飾**，300 m 上 3.4 px、1 km 上 1.0 px。
 */
export const MUZZLE_LENGTH = 0.6

/** 槍焰底端（貼著槍口那一端）的半徑，m。 */
export const MUZZLE_RADIUS = 0.12

/** 頭端相對底端的半徑比。錐狀讓它讀得出方向。 */
const MUZZLE_TAPER = 0.25

/** 稜柱的側面數。與曳光彈同一個理由：發光的小東西，多面數看不出差別。 */
const RADIAL_SEGMENTS = 5

export interface Muzzles {
  object: InstancedMesh
  /**
   * 寫入這一幀的實例矩陣。
   *
   * @param positions   依 `c.index` 索引的**內插後**位置
   * @param quaternions 依 `c.index` 索引的**內插後**姿態
   */
  update(
    combatants: readonly Combatant[],
    positions: readonly Vector3[],
    quaternions: readonly Quaternion[],
  ): void
  dispose(): void
}

const UNIT_Z = new Vector3(0, 0, 1)
/** 熱路徑的暫存。模組私有、每幀重用（熱路徑零配置） */
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 槍焰 —— **單一** `InstancedMesh`，每個掛架一個實例。
 *
 * 【為什麼位置在這裡重算而不是由事件帶過來】事件會帶著**物理子步**的
 * 位置，而畫面上的飛機畫在**內插後**的位置 —— 200 m/s 下差 0.83 m，
 * 槍焰會相對機身前後抖動接近一個機身長度（M7 spec §2.1）。
 *
 * 【為什麼是錐而不是廣告板】廣告板恆面向相機，從正側面看槍焰會是一個
 * 圓片而不是一條噴出來的火舌。錐狀在世界座標裡有方向，從哪個角度看都對
 * —— 與 `tracers.ts` 選世界空間幾何而不是線段是同一個判斷。
 *
 * @param aircraftCapacity 最多幾架飛機。實例數是它乘上 `MAX_MOUNTS`
 */
export function createMuzzles(aircraftCapacity: number): Muzzles {
  // 高度取 MUZZLE_LENGTH、半徑烘進幾何；rotateX(π/2) 把軸由 +Y 轉到 +Z，
  // 較粗的 radiusTop 因此落在 +Z 端 —— 所以這裡把細的放在 top，讓粗的
  // 那一端貼著槍口（−Z 側，也就是實例的後方）。
  const geometry = new CylinderGeometry(
    MUZZLE_RADIUS * MUZZLE_TAPER, MUZZLE_RADIUS, MUZZLE_LENGTH, RADIAL_SEGMENTS, 1, true,
  )
  geometry.rotateX(Math.PI / 2)
  // 幾何以中點為原點，往前推半格讓底面貼在槍口上
  geometry.translate(0, 0, MUZZLE_LENGTH / 2)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    depthWrite: false, blending: AdditiveBlending,
  })

  const capacity = aircraftCapacity * MAX_MOUNTS
  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點），開著視錐剔除的話相機一離開原點
  // 附近整批槍焰會一起消失 —— 與曳光彈同一個坑。
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

    update(
      combatants: readonly Combatant[],
      positions: readonly Vector3[],
      quaternions: readonly Quaternion[],
    ): void {
      let slot = 0
      for (let k = 0; k < combatants.length; k++) {
        const c = combatants[k]!
        const battery = c.aircraft.spec.battery
        const flash = c.muzzleFlash
        const p = positions[c.index]
        const q = quaternions[c.index]

        for (let i = 0; i < MAX_MOUNTS; i++) {
          if (slot >= capacity) break
          const t = i < flash.length && c.alive && p !== undefined && q !== undefined
            ? flash[i]! / FLASH_SECONDS
            : 0
          if (t <= 0) {
            M.compose(ZERO, ROT.identity(), ZERO)
            object.setMatrixAt(slot, M)
            object.setColorAt(slot, TINT.setRGB(0, 0, 0))
            slot++
            continue
          }

          // 槍口的世界位置 = 掛架的機體座標 套上內插姿態 再加內插位置
          POS.copy(battery.mounts[i]!.position).applyQuaternion(q!).add(p!)
          // 朝向沿用匯聚幾何算好的射向，不另外定義一份
          mountDirection(battery, i, DIR).applyQuaternion(q!)
          ROT.setFromUnitVectors(UNIT_Z, DIR)
          SCALE.set(t, t, t)
          M.compose(POS, ROT, SCALE)
          object.setMatrixAt(slot, M)
          // 加法混合：顏色淡到黑就等於淡出，不必逐實例透明度
          TINT.setRGB(t, t * 0.8, t * 0.45)
          object.setColorAt(slot, TINT)
          slot++
        }
      }
      for (; slot < capacity; slot++) {
        M.compose(ZERO, ROT.identity(), ZERO)
        object.setMatrixAt(slot, M)
      }
      object.instanceMatrix.needsUpdate = true
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

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/muzzle.test.ts`
Expected: PASS（11 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 6: 提交**

```bash
git add src/render/muzzle.ts test/unit/muzzle.test.ts
git commit -m "feat: 槍焰的渲染（M7 spec §5.2）

單一 InstancedMesh，每個掛架一個實例，1 個 draw call。

位置在這裡由內插姿態重算而不是由事件帶過來 —— 那是槍焰走計時器的全部
理由：事件帶的是物理子步的位置，而畫面畫在內插後的位置，200 m/s 下差
0.83 m，槍焰會相對機身抖動接近一個機身長度。有一條測試專門守它。

幾何是錐不是廣告板。廣告板恆面向相機，從正側面看槍焰會是一個圓片而不是
一條噴出來的火舌。與 tracers.ts 選世界空間幾何是同一個判斷。

朝向沿用 mountDirection —— 匯聚幾何已經算好，不另外定義一份。

亮度用加法混合下的顏色淡出（淡到黑就等於淡出），不需要逐實例透明度。"
```

---

## Task 7: `render/sparks.ts` —— 命中火花

**Files:**
- Create: `src/render/sparks.ts`
- Test: `test/unit/sparks.test.ts`

**Interfaces:**
- Consumes: `ImpactEvents`、`IMPACT_STRIDE`（Task 2）
- Produces:
  ```ts
  const SPARKS_PER_HIT = 8, SPARK_SPEED = 25, SPARK_CONE = 35°, SPARK_LIFE = 0.2
  const SPARK_DRAG = 6, SPARK_CULL = 800, SPARK_LENGTH = 0.3, SPARK_CAPACITY = 512
  function sparkDirection(nx, ny, nz, index: number, out: Vector3): void
  interface Sparks {
    object: InstancedMesh
    readonly live: number
    emit(events: ImpactEvents, cameraX: number, cameraY: number, cameraZ: number): void
    step(dt: number): void
    dispose(): void
  }
  function createSparks(capacity?: number): Sparks
  ```

**背景**（spec §6）：三件事。

**方向必須是決定性的，不能用 `Math.random()`** —— 與 `battle/setup.ts` 的 `altitudeOffset` 避開亂數同一個理由：亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉可測試性。用**粒子槽位索引的雜湊**，於是 `sparkDirection` 是純函數，可以斷言「恆為單位向量」「與法線的夾角恆 ≤ 錐角」。

**在渲染幀率積分，不在物理步** —— 火花不參與任何判定也不需要決定性，放進物理步只會讓 240 Hz 白算四倍。

**環形緩衝、滿了覆蓋最舊的** —— 最舊的正好是最淡的那一顆，覆蓋看不出來；丟棄新的則會在密集命中時整批不見，而那正是最該看到火花的時候。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSparks, sparkDirection,
  SPARKS_PER_HIT, SPARK_CONE, SPARK_CULL, SPARK_LENGTH, SPARK_LIFE,
} from '../../src/render/sparks'
import { createImpacts, pushImpact } from '../../src/world/events'

/** 讀出第 i 個實例的位置／旋轉／縮放。 */
function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

describe('sparkDirection —— 決定性的錐內取樣（M7 spec §6.1）', () => {
  const out = new Vector3()

  it('恆為單位向量', () => {
    for (let i = 0; i < 200; i++) {
      sparkDirection(0, 1, 0, i, out)
      expect(out.length()).toBeCloseTo(1, 9)
    }
  })

  it('與法線的夾角恆在錐內', () => {
    const n = new Vector3(0.3, 0.5, -0.81).normalize()
    const cosMax = Math.cos(SPARK_CONE)
    for (let i = 0; i < 200; i++) {
      sparkDirection(n.x, n.y, n.z, i, out)
      expect(out.dot(n)).toBeGreaterThanOrEqual(cosMax - 1e-9)
    }
  })

  it('同索引恆給同方向 —— 沒有用 Math.random()', () => {
    // 【為什麼這一條重要】亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉
    // 可測試性。用索引的雜湊之後，這個函數是純的，上面兩條才測得成立。
    const a = new Vector3()
    const b = new Vector3()
    sparkDirection(0, 1, 0, 42, a)
    sparkDirection(0, 1, 0, 42, b)
    expect(b.x).toBe(a.x)
    expect(b.y).toBe(a.y)
    expect(b.z).toBe(a.z)
  })

  it('不同索引給不同方向 —— 不是八顆疊在一起', () => {
    const seen = new Set<string>()
    for (let i = 0; i < SPARKS_PER_HIT; i++) {
      sparkDirection(0, 1, 0, i, out)
      seen.add(`${out.x.toFixed(6)},${out.y.toFixed(6)},${out.z.toFixed(6)}`)
    }
    expect(seen.size).toBe(SPARKS_PER_HIT)
  })

  it('法線指向各座標軸時都不產生 NaN', () => {
    for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]) {
      sparkDirection(n[0]!, n[1]!, n[2]!, 7, out)
      expect(Number.isFinite(out.length())).toBe(true)
      expect(out.length()).toBeCloseTo(1, 9)
    }
  })

  it('法線為零向量時仍回傳單位向量', () => {
    // 【為什麼會發生】命中事件的法線來自 hitAircraft 的備援路徑，理論上
    // 不會是零 —— 但 NaN 一旦進入實例矩陣，整批火花會靜靜地消失而且完全
    // 不報錯（與 assess.ts 的防護同一個理由）。
    sparkDirection(0, 0, 0, 3, out)
    expect(out.length()).toBeCloseTo(1, 9)
  })
})

describe('createSparks', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const s = createSparks(64)
    expect(s.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    s.object.traverse(() => objects++)
    expect(objects).toBe(1)
    expect(s.object.count).toBe(64)
    s.dispose()
  })

  it('建立時全部是死的、縮放為 0', () => {
    const s = createSparks(16)
    expect(s.live).toBe(0)
    for (let i = 0; i < 16; i++) expect(instance(s.object, i).scale.z).toBe(0)
    s.dispose()
  })

  it('實例矩陣緩衝建立時就配足，之後只寫入不重配', () => {
    const s = createSparks(16)
    const buffer = s.object.instanceMatrix
    s.step(1 / 60)
    expect(s.object.instanceMatrix).toBe(buffer)
    s.dispose()
  })
})

describe('發射（M7 spec §6.1、§6.4）', () => {
  it('一個命中事件噴 SPARKS_PER_HIT 顆', () => {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, 0, 100, 0, 0, 1, 0)
    s.emit(e, 0, 100, 0)
    expect(s.live).toBe(SPARKS_PER_HIT)
    s.dispose()
  })

  it('火星從命中點出發', () => {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, 10, 20, 30, 0, 1, 0)
    s.emit(e, 10, 20, 30)
    s.step(1 / 1000)   // 推一小步讓矩陣寫出來
    const p = instance(s.object, 0).position
    expect(p.distanceTo(new Vector3(10, 20, 30))).toBeLessThan(1)
    s.dispose()
  })

  it('超過 SPARK_CULL 的事件不發射', () => {
    // 【為什麼剔除】0.3 m 的火星在 800 m 上是 0.64 px —— 次像素，看不見。
    // 模擬看不見的粒子是純浪費（M7 spec §6.4）。
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, SPARK_CULL + 100, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    expect(s.live).toBe(0)
    s.dispose()
  })

  it('剛好在剔除距離之內就發射', () => {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, SPARK_CULL - 50, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    expect(s.live).toBe(SPARKS_PER_HIT)
    s.dispose()
  })

  it('池子滿了覆蓋最舊的，不會丟掉新的', () => {
    // 【為什麼是覆蓋最舊】最舊的正好是最淡的那一顆，覆蓋看不出來；
    // 丟棄新的則會在密集命中時整批不見，而那正是最該看到火花的時候。
    const s = createSparks(SPARKS_PER_HIT * 2)
    const e = createImpacts(8)
    for (let k = 0; k < 5; k++) pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    expect(s.live).toBe(SPARKS_PER_HIT * 2)
    s.dispose()
  })
})

describe('步進（M7 spec §6.2）', () => {
  function oneHit() {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    return s
  }

  it('壽命走完之後全部死掉並縮成 0', () => {
    const s = oneHit()
    const dt = 1 / 60
    const steps = Math.ceil(SPARK_LIFE / dt) + 2
    for (let i = 0; i < steps; i++) s.step(dt)
    expect(s.live).toBe(0)
    for (let i = 0; i < SPARKS_PER_HIT; i++) {
      expect(instance(s.object, i).scale.z).toBe(0)
    }
    s.dispose()
  })

  it('活著的火星長度等於 SPARK_LENGTH', () => {
    const s = oneHit()
    s.step(1 / 60)
    expect(instance(s.object, 0).scale.z).toBeCloseTo(SPARK_LENGTH, 6)
    s.dispose()
  })

  it('會往上飛（法線朝上）然後被重力拉回來', () => {
    const s = oneHit()
    const dt = 1 / 240
    let peak = -Infinity
    for (let i = 0; i < 48; i++) {
      s.step(dt)
      peak = Math.max(peak, instance(s.object, 0).position.y)
    }
    expect(peak).toBeGreaterThan(0)
    s.dispose()
  })

  it('速度被阻尼掉 —— 不是等速飛走', () => {
    // 時間常數 1/6 = 0.17 s 與壽命 0.2 s 同量級，所以死掉之前速度掉到約 1/e
    const s = oneHit()
    const dt = 1 / 240
    s.step(dt)
    const a = instance(s.object, 0).position.clone()
    s.step(dt)
    const b = instance(s.object, 0).position.clone()
    const first = a.distanceTo(b)
    for (let i = 0; i < 40; i++) s.step(dt)
    const c = instance(s.object, 0).position.clone()
    s.step(dt)
    const d = instance(s.object, 0).position.clone()
    expect(c.distanceTo(d)).toBeLessThan(first)
    s.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const s = oneHit()
    for (let i = 0; i < 300; i++) s.step(1 / 60)
    for (let i = 0; i < SPARKS_PER_HIT; i++) {
      const inst = instance(s.object, i)
      expect(Number.isFinite(inst.position.length())).toBe(true)
      expect(Number.isFinite(inst.scale.length())).toBe(true)
    }
    s.dispose()
  })

  it('dt 為 0 時不動也不壞', () => {
    const s = oneHit()
    s.step(0)
    expect(s.live).toBe(SPARKS_PER_HIT)
    s.dispose()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/sparks.test.ts`
Expected: FAIL，`src/render/sparks.ts` 不存在

- [ ] **Step 3: 實作 `src/render/sparks.ts`**

```ts
import {
  AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedMesh,
  Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/** 一次命中噴幾顆。少於 4 讀不出「噴開」，多於 16 在密集命中時變成一團。 */
export const SPARKS_PER_HIT = 8

/** 初速，m/s。壽命 0.2 s 內飛約 3 m —— 與機身尺度同量級，看得出是從表面噴出來的。 */
export const SPARK_SPEED = 25

/** 噴射錐的半角。窄到讀得出法線方向，寬到不像一根針。 */
export const SPARK_CONE = 35 * (Math.PI / 180)

/** 壽命，s。60 fps 下 12 幀，看得完一次噴射。 */
export const SPARK_LIFE = 0.2

/**
 * 速度的指數阻尼，s⁻¹。
 *
 * 時間常數 1/6 = 0.17 s 與壽命 0.2 s 同量級 —— 火星在死掉之前速度掉到
 * 約 1/e，看起來是「噴出去然後慢下來」而不是「等速飛走然後消失」。
 */
export const SPARK_DRAG = 6

/**
 * 超過這個距離的命中事件不發射，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`），
 * 800 m 上 1 px = 0.47 m，而火星只有 0.3 m 長 —— **0.64 px，次像素**。
 * 模擬看不見的粒子是純浪費（M7 spec §6.4）。
 */
export const SPARK_CULL = 800

/** 火星拉長的長度與半徑，m。與曳光彈同一種幾何。 */
export const SPARK_LENGTH = 0.3
export const SPARK_RADIUS = 0.02

/**
 * 池子大小。
 *
 * 【512 怎麼來】密集交火時約 40 次命中/s × 0.2 s 壽命 × 8 顆 = 64 顆
 * 同時在場。512 是它的 8 倍。
 */
export const SPARK_CAPACITY = 512

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

const RADIAL_SEGMENTS = 3

export interface Sparks {
  object: InstancedMesh
  /** 目前還活著幾顆。測試與 telemetry 用 */
  readonly live: number
  /**
   * 依命中事件發射。**距離剔除在這裡做** —— 只有渲染層知道相機在哪裡，
   * `World` 不需要知道有相機這回事（M7 spec §6.4）。
   */
  emit(events: ImpactEvents, cameraX: number, cameraY: number, cameraZ: number): void
  /** 積分一幀並寫入實例矩陣。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number): void
  dispose(): void
}

/**
 * 32 位元整數雜湊 → [0, 1)。
 *
 * 【為什麼不用 `Math.random()`】與 `battle/setup.ts` 的 `altitudeOffset`
 * 避開亂數同一個理由：亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉可
 * 測試性。用索引的雜湊之後 `sparkDirection` 是純函數，「恆在錐內」這一條
 * 才測得起來。
 */
function hash01(i: number): number {
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
 * 在法線周圍 `SPARK_CONE` 的錐內取一個方向，**由 `index` 決定**。
 *
 * 熱路徑之外（每次命中八次），但仍然不配置。
 */
export function sparkDirection(
  nx: number, ny: number, nz: number, index: number, out: Vector3,
): void {
  AXIS.set(nx, ny, nz)
  const len = AXIS.length()
  // 【零向量的防護】法線理論上不會是零，但 NaN 一旦進入實例矩陣，整批
  // 火花會靜靜地消失而且完全不報錯（與 assess.ts 的防護同一個理由）。
  if (len < 1e-6) AXIS.set(0, 1, 0)
  else AXIS.divideScalar(len)

  // 與 AXIS 最不平行的座標軸，拿來造切線
  const ax = Math.abs(AXIS.x)
  const ay = Math.abs(AXIS.y)
  const az = Math.abs(AXIS.z)
  if (ax <= ay && ax <= az) TANGENT.set(1, 0, 0)
  else if (ay <= az) TANGENT.set(0, 1, 0)
  else TANGENT.set(0, 0, 1)
  TANGENT.cross(AXIS).normalize()
  BITANGENT.copy(AXIS).cross(TANGENT)

  const phi = hash01(index) * Math.PI * 2
  const cosMax = Math.cos(SPARK_CONE)
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

const UNIT_Z = new Vector3(0, 0, 1)
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 命中火花 —— **單一** `InstancedMesh` 的粒子池。
 *
 * 【環形緩衝、滿了覆蓋最舊的】最舊的正好是最淡的那一顆，覆蓋看不出來；
 * 丟棄新的則會在密集命中時整批不見 —— 而那正是最該看到火花的時候。
 */
export function createSparks(capacity: number = SPARK_CAPACITY): Sparks {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  // 【起始壽命設滿】等於「一出生就是死的」，不必另外一個 alive 陣列
  const age = new Float32Array(capacity).fill(SPARK_LIFE)
  let next = 0
  let live = 0

  const geometry = new CylinderGeometry(
    SPARK_RADIUS, SPARK_RADIUS, 1, RADIAL_SEGMENTS, 1, true,
  )
  geometry.rotateX(Math.PI / 2)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9,
    depthWrite: false, blending: AdditiveBlending,
  })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點）—— 開著視錐剔除，相機一離開原點附近
  // 整批火花會一起消失。與曳光彈同一個坑。
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

    emit(events: ImpactEvents, cameraX: number, cameraY: number, cameraZ: number): void {
      const d = events.data
      const cull2 = SPARK_CULL * SPARK_CULL
      for (let e = 0; e < events.count; e++) {
        const o = e * IMPACT_STRIDE
        const x = d[o]!
        const y = d[o + 1]!
        const z = d[o + 2]!
        const ex = x - cameraX
        const ey = y - cameraY
        const ez = z - cameraZ
        if (ex * ex + ey * ey + ez * ez > cull2) continue

        const nx = d[o + 3]!
        const ny = d[o + 4]!
        const nz = d[o + 5]!
        for (let k = 0; k < SPARKS_PER_HIT; k++) {
          const i = next
          next = next + 1 >= capacity ? 0 : next + 1
          if (age[i]! >= SPARK_LIFE) live++
          sparkDirection(nx, ny, nz, i, DIR)
          px[i] = x
          py[i] = y
          pz[i] = z
          vx[i] = DIR.x * SPARK_SPEED
          vy[i] = DIR.y * SPARK_SPEED
          vz[i] = DIR.z * SPARK_SPEED
          age[i] = 0
        }
      }
    },

    step(dt: number): void {
      const damp = Math.exp(-SPARK_DRAG * dt)
      live = 0
      for (let i = 0; i < capacity; i++) {
        const a = age[i]!
        if (a >= SPARK_LIFE) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          continue
        }
        const na = a + dt
        age[i] = na
        if (na >= SPARK_LIFE) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          object.setColorAt(i, TINT.setRGB(0, 0, 0))
          continue
        }
        live++

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

        const speed = Math.hypot(nvx, nvy, nvz)
        if (speed > 1e-6) {
          DIR.set(nvx / speed, nvy / speed, nvz / speed)
          ROT.setFromUnitVectors(UNIT_Z, DIR)
        } else {
          ROT.identity()
        }
        POS.set(nx, ny, nz)
        SCALE.set(1, 1, SPARK_LENGTH)
        M.compose(POS, ROT, SCALE)
        object.setMatrixAt(i, M)

        // 加法混合下顏色淡到黑就等於淡出 —— 不需要逐實例透明度
        const f = 1 - na / SPARK_LIFE
        TINT.setRGB(f, f * 0.75, f * 0.35)
        object.setColorAt(i, TINT)
      }
      object.instanceMatrix.needsUpdate = true
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

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/sparks.test.ts`
Expected: PASS（20 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 6: 提交**

```bash
git add src/render/sparks.ts test/unit/sparks.test.ts
git commit -m "feat: 命中火花（M7 spec §6）

方向用粒子槽位索引的雜湊而不是 Math.random()。與 battle/setup.ts 的
altitudeOffset 避開亂數同一個理由：亂數要嘛需要一顆種子與一個 PRNG，
要嘛就毀掉可測試性。純函數之後，「恆為單位向量」「與法線的夾角恆在錐內」
這兩條才測得起來。

在渲染幀率積分而不是物理步 —— 火花不參與任何判定也不需要決定性，放進
物理步只會讓 240 Hz 白算四倍。

環形緩衝、滿了覆蓋最舊的：最舊的正好是最淡的那一顆，覆蓋看不出來；丟棄
新的則會在密集命中時整批不見，而那正是最該看到火花的時候。

超過 800 m 的命中不發射 —— 0.3 m 的火星在那個距離是 0.64 px，次像素。
剔除在渲染層做，因為只有那一層知道相機在哪裡。

阻尼 6 s⁻¹ 的時間常數 0.17 s 與壽命 0.2 s 同量級，所以看起來是「噴出去
然後慢下來」而不是「等速飛走然後消失」。"
```

---

## Task 8: `render/splash.ts` —— 入海水柱

**Files:**
- Create: `src/render/splash.ts`
- Test: `test/unit/splash.test.ts`

**Interfaces:**
- Consumes: `ImpactEvents`、`IMPACT_STRIDE`（Task 2）
- Produces:
  ```ts
  const SPLASH_HEIGHT = 4, SPLASH_RADIUS = 0.25, SPLASH_LIFE = 0.5, SPLASH_RISE = 0.3
  const SPLASH_CAPACITY = 256
  function splashScale(age: number): number      // 0..1 的高度係數
  interface Splashes {
    object: InstancedMesh
    readonly live: number
    emit(events: ImpactEvents, heightAt: (x: number, z: number, t: number) => number,
         time: number): void
    step(dt: number): void
    dispose(): void
  }
  function createSplashes(capacity?: number): Splashes
  ```

**背景**（spec §7）：白色圓柱，底部擺在**真實浪高**上 —— 海面振幅 ±2.15 m 而水柱只有 4 m 高，固定在 `y = 0` 的話波谷上會有半根埋進水裡、波峰上會浮在空中。`emit` 對每個事件取一次 `ocean.heightAt`，而水柱本來就稀有（彈丸壽命 1.2 s × 887 m/s = 最多飛 1,064 m，所以 4,000 m 高度平射的子彈永遠碰不到海面）。

**不需要距離剔除**：射手離水柱恆在 1 km 之內，而 4 m 的水柱在 1 km 上是 6.8 px。

**與 spec 的偏離**：spec §7.1 寫「透明度：後 50% 的壽命線性淡出」，本任務**不實作**。`InstancedMesh` 的逐實例顏色只有 RGB 沒有 alpha，逐實例透明度要自訂著色器；而高度曲線（4 m → 0）本身就完成了消失。要記進 Task 12 的交付紀錄。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSplashes, splashScale,
  SPLASH_HEIGHT, SPLASH_LIFE, SPLASH_RADIUS, SPLASH_RISE,
} from '../../src/render/splash'
import { createImpacts, pushImpact } from '../../src/world/events'

function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

/** 平海面：高度恆為 0。 */
const FLAT = (): number => 0

describe('splashScale —— 抽起再落下（M7 spec §7.1）', () => {
  it('壽命之外是 0', () => {
    expect(splashScale(-0.1)).toBe(0)
    expect(splashScale(SPLASH_LIFE)).toBe(0)
    expect(splashScale(SPLASH_LIFE + 1)).toBe(0)
  })

  it('剛出生是 0，抽到頂是 1', () => {
    expect(splashScale(0)).toBe(0)
    expect(splashScale(SPLASH_LIFE * SPLASH_RISE)).toBeCloseTo(1, 9)
  })

  it('前段單調上升', () => {
    let prev = -1
    for (let i = 0; i <= 10; i++) {
      const v = splashScale((SPLASH_LIFE * SPLASH_RISE * i) / 10)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('後段單調下降到 0', () => {
    const start = SPLASH_LIFE * SPLASH_RISE
    let prev = 2
    for (let i = 0; i <= 10; i++) {
      const v = splashScale(start + ((SPLASH_LIFE - start) * i) / 10)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
    expect(prev).toBeCloseTo(0, 9)
  })

  it('抽起比落下快 —— 水柱是「噴」出來的', () => {
    // 前 30% 的壽命走完全程，後 70% 才落回去
    expect(SPLASH_RISE).toBeLessThan(0.5)
  })
})

describe('createSplashes', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const s = createSplashes(16)
    expect(s.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    s.object.traverse(() => objects++)
    expect(objects).toBe(1)
    expect(s.object.count).toBe(16)
    s.dispose()
  })

  it('建立時全部是死的、縮放為 0', () => {
    const s = createSplashes(8)
    expect(s.live).toBe(0)
    for (let i = 0; i < 8; i++) expect(instance(s.object, i).scale.y).toBe(0)
    s.dispose()
  })

  it('幾何以底面為原點 —— 只縮放 Y 就是從水面長出來', () => {
    // 【為什麼不是以中心為原點】以中心為原點的話，縮放 Y 會讓柱子從中間
    // 往兩邊長，下半截埋進水裡。
    const s = createSplashes(1)
    const pos = s.object.geometry.getAttribute('position')
    let yMin = Infinity
    let yMax = -Infinity
    for (let i = 0; i < pos.count; i++) {
      yMin = Math.min(yMin, pos.getY(i))
      yMax = Math.max(yMax, pos.getY(i))
    }
    expect(yMin).toBeCloseTo(0, 6)
    expect(yMax).toBeCloseTo(SPLASH_HEIGHT, 6)
    s.dispose()
  })

  it('半徑是 SPLASH_RADIUS', () => {
    const s = createSplashes(1)
    const pos = s.object.geometry.getAttribute('position')
    let rMax = 0
    for (let i = 0; i < pos.count; i++) {
      rMax = Math.max(rMax, Math.hypot(pos.getX(i), pos.getZ(i)))
    }
    expect(rMax).toBeCloseTo(SPLASH_RADIUS, 6)
    s.dispose()
  })
})

describe('發射與步進（M7 spec §7.1）', () => {
  it('一個事件生一根柱子', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 10, 0, 20, 0, 1, 0)
    s.emit(e, FLAT, 0)
    expect(s.live).toBe(1)
    s.dispose()
  })

  it('底部擺在浪高上，不是固定 y = 0', () => {
    // 【為什麼】海面振幅 ±2.15 m 而水柱只有 4 m 高 —— 固定在 0 的話，
    // 波谷上會有半根埋進水裡、波峰上會浮在空中。
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 10, 0, 20, 0, 1, 0)
    s.emit(e, () => 1.75, 0)
    s.step(SPLASH_LIFE * SPLASH_RISE)
    const p = instance(s.object, 0).position
    expect(p.x).toBeCloseTo(10, 6)
    expect(p.y).toBeCloseTo(1.75, 6)
    expect(p.z).toBeCloseTo(20, 6)
    s.dispose()
  })

  it('高度先漲後落，壽命結束縮成 0', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)

    s.step(SPLASH_LIFE * SPLASH_RISE)
    const peak = instance(s.object, 0).scale.y
    expect(peak).toBeCloseTo(1, 6)

    s.step(SPLASH_LIFE * 0.5)
    const falling = instance(s.object, 0).scale.y
    expect(falling).toBeGreaterThan(0)
    expect(falling).toBeLessThan(peak)

    s.step(SPLASH_LIFE)
    expect(instance(s.object, 0).scale.y).toBe(0)
    expect(s.live).toBe(0)
    s.dispose()
  })

  it('柱子恆為垂直 —— 不隨任何東西旋轉', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    s.step(SPLASH_LIFE * SPLASH_RISE)
    const q = instance(s.object, 0).quaternion
    expect(q.angleTo(new Quaternion())).toBeCloseTo(0, 9)
    s.dispose()
  })

  it('池子滿了覆蓋最舊的', () => {
    const s = createSplashes(2)
    const e = createImpacts(8)
    for (let k = 0; k < 5; k++) pushImpact(e, k, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    expect(s.live).toBe(2)
    s.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    for (let i = 0; i < 300; i++) s.step(1 / 60)
    const inst = instance(s.object, 0)
    expect(Number.isFinite(inst.position.length())).toBe(true)
    expect(Number.isFinite(inst.scale.length())).toBe(true)
    s.dispose()
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/splash.test.ts`
Expected: FAIL，`src/render/splash.ts` 不存在

- [ ] **Step 3: 實作 `src/render/splash.ts`**

```ts
import {
  CylinderGeometry, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/**
 * 水柱的滿高，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`）。
 * 彈丸壽命 1.2 s × 最快初速 887 m/s = 最多飛 1,064 m，所以射手離水柱恆在
 * 1 km 之內；4 m 的柱子在 1 km 上是 6.8 px —— 一定讀得到。**因此不需要
 * 距離剔除**（M7 spec §7.2）。
 */
export const SPLASH_HEIGHT = 4

/** 水柱的半徑，m。 */
export const SPLASH_RADIUS = 0.25

/** 壽命，s。抽起加落下，看得完一個完整動作。 */
export const SPLASH_LIFE = 0.5

/** 抽到滿高要花掉多少比例的壽命。前 30% 抽起、後 70% 落回 —— 噴出來的東西。 */
export const SPLASH_RISE = 0.3

/**
 * 池子大小。
 *
 * 【256 怎麼來】水柱天然稀有（只有低空纏鬥才出現，見 M7 spec §7.3），
 * 所以這不需要一個精確的上界 —— 環形緩衝覆蓋最舊的，滿了也不會壞。
 */
export const SPLASH_CAPACITY = 256

const RADIAL_SEGMENTS = 6

export interface Splashes {
  object: InstancedMesh
  /** 目前還活著幾根。測試與 telemetry 用 */
  readonly live: number
  /**
   * 依入海事件生水柱。
   *
   * @param heightAt 浪高場。**每根柱子只取樣一次** —— `World` 的偵測用的是
   *                 平面 `y = 0`，真實浪高只在這裡取（M7 spec §4.2）
   * @param time     取樣時間，餵給 `heightAt`
   */
  emit(
    events: ImpactEvents,
    heightAt: (x: number, z: number, t: number) => number,
    time: number,
  ): void
  step(dt: number): void
  dispose(): void
}

/**
 * 年齡 → 高度係數 0..1。前 `SPLASH_RISE` 抽到滿高，之後線性落回 0。
 *
 * 【為什麼抽成純函數】繪製函數進不了單元測試，而「先漲後落」是一條有實際
 * 行為的規則 —— 與 `edgeIndicatorPosition`、`minimapSymbol`、`countdownLabel`
 * 是同一個做法。
 */
export function splashScale(age: number): number {
  if (age < 0 || age >= SPLASH_LIFE) return 0
  const peak = SPLASH_LIFE * SPLASH_RISE
  if (age <= peak) return peak > 0 ? age / peak : 1
  return 1 - (age - peak) / (SPLASH_LIFE - peak)
}

const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const ZERO = new Vector3(0, 0, 0)

/**
 * 入海水柱 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 【為什麼不做逐實例透明度】`InstancedMesh` 的逐實例顏色只有 RGB 沒有
 * alpha，逐實例透明度要自訂著色器。而高度曲線（4 m → 0）本身就完成了
 * 消失 —— 再加一層透明度只是把同一件事做兩次。
 */
export function createSplashes(capacity: number = SPLASH_CAPACITY): Splashes {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const age = new Float32Array(capacity).fill(SPLASH_LIFE)
  let next = 0
  let live = 0

  // 【以底面為原點】以中心為原點的話，縮放 Y 會讓柱子從中間往兩邊長，
  // 下半截埋進水裡。
  const geometry = new CylinderGeometry(
    SPLASH_RADIUS, SPLASH_RADIUS, SPLASH_HEIGHT, RADIAL_SEGMENTS, 1, true,
  )
  geometry.translate(0, SPLASH_HEIGHT / 2, 0)

  const material = new MeshBasicMaterial({
    color: 0xdfefff, transparent: true, opacity: 0.75,
    depthWrite: false,
  })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) object.setMatrixAt(i, M)
  object.instanceMatrix.needsUpdate = true

  return {
    object,
    get live() { return live },

    emit(
      events: ImpactEvents,
      heightAt: (x: number, z: number, t: number) => number,
      time: number,
    ): void {
      const d = events.data
      for (let e = 0; e < events.count; e++) {
        const o = e * IMPACT_STRIDE
        const x = d[o]!
        const z = d[o + 2]!
        const i = next
        next = next + 1 >= capacity ? 0 : next + 1
        if (age[i]! >= SPLASH_LIFE) live++
        px[i] = x
        py[i] = heightAt(x, z, time)
        pz[i] = z
        age[i] = 0
      }
    },

    step(dt: number): void {
      live = 0
      for (let i = 0; i < capacity; i++) {
        const a = age[i]!
        if (a >= SPLASH_LIFE) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          continue
        }
        const na = a + dt
        age[i] = na
        const s = splashScale(na)
        if (s <= 0) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          continue
        }
        live++
        POS.set(px[i]!, py[i]!, pz[i]!)
        // 【只縮放 Y】柱子恆為垂直，不隨任何東西旋轉
        SCALE.set(1, s, 1)
        M.compose(POS, ROT.identity(), SCALE)
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

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/unit/splash.test.ts`
Expected: PASS（15 條）

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 6: 提交**

```bash
git add src/render/splash.ts test/unit/splash.test.ts
git commit -m "feat: 入海水柱（M7 spec §7）

底部擺在真實浪高上而不是固定 y = 0。海面振幅 ±2.15 m 而水柱只有 4 m 高
—— 固定的話波谷上會有半根埋進水裡、波峰上會浮在空中。World 的偵測用的是
平面（那是全專案最熱的迴圈，取 Gerstner 浪高是每秒近百萬次 sin/cos），
真實浪高只在這裡取，每根柱子一次。

幾何以底面為原點：以中心為原點的話，縮放 Y 會讓柱子從中間往兩邊長，
下半截埋進水裡。

高度曲線抽成純函數 splashScale —— 繪製函數進不了單元測試，而「先漲後落」
是一條有實際行為的規則。

不做逐實例透明度（spec §7.1 有寫）：InstancedMesh 的逐實例顏色只有 RGB
沒有 alpha，要自訂著色器；而高度曲線本身就完成了消失。記在交付紀錄裡。"
```

---

## Task 9: `main.ts` 接線

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `createMuzzles`（Task 6）、`createSparks`（Task 7）、`createSplashes`（Task 8）、`clearImpacts`（Task 2）、`World.hitEvents` / `.splashEvents`（Task 4、5）
- Produces: 無

**背景**：三個接線點。

1. **建立**：三個 `InstancedMesh` 加進場景（總共多 3 個 draw call）。
2. **子步回呼裡排空事件** —— 與既有的 `hitsThisFrame += player.hitsDealt` 同一個位置、同一個理由（`main.ts:210` 的註解已經寫過：「一幀可能跑好幾步」）。
3. **每幀更新**：槍焰讀內插姿態，火花與水柱各積分一幀。

- [ ] **Step 1: 先確認 `rebuildModel` 不會換掉 `Visual` 物件本身**

Run: `grep -n "function rebuildModel" -A 12 src/main.ts`

槍焰的接線要傳一組**依 `c.index` 索引**的內插姿態陣列，而最省的做法是讓那個陣列直接持有 `Visual.position` / `Visual.quaternion` 的**參考**（不複製、不佔額外記憶體）。這只在 `rebuildModel` 只換 `v.model`、不換 `v` 本身時成立。

若它換掉整個 `Visual`，就改成在每幀的內插迴圈裡 `copy()` 進兩個獨立陣列 —— 多一次複製，但正確。**先看清楚再選。**

- [ ] **Step 2: 改 import**

```ts
import { createMuzzles } from './render/muzzle'
import { createSparks } from './render/sparks'
import { createSplashes } from './render/splash'
import { clearImpacts } from './world/events'
```

- [ ] **Step 3: 建立三個特效並加進場景**

在 `const tracers = createTracers()` / `ctx.scene.add(tracers.object)` 那兩行之後（**必須在 `world.combatants` 已經填好之後**，也就是 `createBattle` 之後）：

```ts
// 【三個特效各一個 InstancedMesh】總共多 3 個 draw call（M7 spec §9）
const muzzles = createMuzzles(world.combatants.length)
ctx.scene.add(muzzles.object)
const sparks = createSparks()
ctx.scene.add(sparks.object)
const splashes = createSplashes()
ctx.scene.add(splashes.object)

// 【依 c.index 索引的內插姿態】直接持有 Visual 的 Vector3/Quaternion 參考，
// 不複製 —— 每幀的內插迴圈寫進那些物件，這裡自然就是最新的。
const renderPositions = world.combatants.map((c) => visuals.get(c)!.position)
const renderQuaternions = world.combatants.map((c) => visuals.get(c)!.quaternion)
```

- [ ] **Step 4: 在子步回呼裡排空事件**

把既有的回呼改成：

```ts
  let hitsThisFrame = 0
  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    stepBattle(battle, dt)
    hitsThisFrame += player.hitsDealt
    // 【事件必須在回呼裡排空】與上面 hitsDealt 同一個理由：World 在每個
    // 物理步產生事件，而一幀可能跑好幾步。在幀尾才讀的話，最後一步以外
    // 的火花與水柱全部漏掉（M7 spec §2.2）。
    //
    // 相機位置用的是上一幀的 —— 火花的剔除半徑是 800 m，而相機一幀移動
    // 不到 4 m，差異在剔除判斷上看不出來。
    sparks.emit(world.hitEvents, ctx.camera.position.x, ctx.camera.position.y,
      ctx.camera.position.z)
    splashes.emit(world.splashEvents, ocean.heightAt, elapsed)
    clearImpacts(world.hitEvents)
    clearImpacts(world.splashEvents)
    perf.endPhysics()
  })
```

- [ ] **Step 5: 每幀更新三個特效**

在既有的 `tracers.update(world.projectiles)` 那一行**之後**加上：

```ts
  // 【槍焰用內插姿態】它是一個狀態而不是一個瞬間，所以位置在這裡重算 ——
  // 用物理位置的話槍焰會相對機身抖動一個子步的位移（M7 spec §2.1）
  muzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【火花與水柱在幀率積分】純裝飾，不參與判定也不需要決定性
  sparks.step(frameSeconds)
  splashes.step(frameSeconds)
```

- [ ] **Step 6: 型別檢查**

Run: `npm run build`
Expected: 無 `error TS`

- [ ] **Step 7: 跑整套**

Run: `npx vitest run`
Expected: 全綠（`multi-battle` 的事件溢位斷言還沒加，Task 10 才加）

- [ ] **Step 8: 瀏覽器人工檢查**

Run: `npm run dev`

按住滑鼠左鍵開火，確認四件**立刻看得出來**的事：

1. 六個槍口各有一個短促的閃，是**閃爍**不是常亮的燈
2. 槍焰焊在槍口上，做機動時不會相對機身前後滑動
3. 打中敵機時看得到火花從被打中的那一面噴開
4. 把機頭壓低對海面掃射，看得到白色水柱抽起又落下

不對的話先修，再進 Task 12 的完整驗收。

- [ ] **Step 9: 提交**

```bash
git add src/main.ts
git commit -m "feat: main.ts 接上三個武器特效

事件在子步回呼裡排空，與既有的 hitsDealt 同一個位置、同一個理由：World
在每個物理步產生事件，而一幀可能跑好幾步，在幀尾才讀會漏掉最後一步以外
的全部。

槍焰的內插姿態陣列直接持有 Visual 的 Vector3/Quaternion 參考，不複製 ——
每幀的內插迴圈寫進那些物件，muzzles.update 讀到的自然是最新的。

火花的剔除用上一幀的相機位置：剔除半徑 800 m，而相機一幀移動不到 4 m。"
```

---

## Task 10: 整合測試 —— 事件緩衝從未溢位

**Files:**
- Modify: `test/integration/multi-battle.test.ts`

**Interfaces:**
- Consumes: `clearImpacts`（Task 2）、`World.hitEvents` / `.splashEvents`（Task 4、5）
- Produces: 無（純測試）

**背景**（spec §13.1 條件 9）：`IMPACT_CAPACITY = 64` 是推導出來的（40 架全開火 2,434 發/s，全部命中在 60 fps 下 41 次/幀 ÷ 8 子步 ≈ 6 次/子步，10 倍餘裕）。推導要有實測背書。

**這個測試必須自己排空**，因為 `observe()` 不是 `main.ts` —— 不排空的話緩衝會填滿並開始丟棄，斷言必紅，而那個紅燈不代表任何缺陷。

- [ ] **Step 1: 加排空與觀測量**

檔頭 import 補上：

```ts
import { clearImpacts } from '../../src/world/events'
```

`Observed` 新增三個欄位：

```ts
  /** 整場累計的命中事件數。應與命中次數一致 */
  hitEventCount: number
  /** 整場累計的入海事件數（水柱） */
  splashEventCount: number
  /** 兩個事件緩衝累計丟棄了幾筆。門檻：恆為 0 */
  eventsDropped: number
```

`observe()` 的初始化加上 `hitEventCount: 0, splashEventCount: 0, eventsDropped: 0,`。

主迴圈裡，**緊接在 `stepBattle(b, DT)` 之後**：

```ts
    // 【必須自己排空】這個測試不是 main.ts。不排空的話緩衝會填滿並開始
    // 丟棄，下面的斷言必紅，而那個紅燈不代表任何缺陷。
    o.hitEventCount += b.world.hitEvents.count
    o.splashEventCount += b.world.splashEvents.count
    clearImpacts(b.world.hitEvents)
    clearImpacts(b.world.splashEvents)
```

迴圈結束後（`return o` 之前）：

```ts
  o.eventsDropped = b.world.hitEvents.dropped + b.world.splashEvents.dropped
```

- [ ] **Step 2: 加斷言**

```ts
  it('事件緩衝從未溢位（M7 spec §13.1 條件 9）', () => {
    // 【這一條守的是 IMPACT_CAPACITY 的推導】64 是「全部命中」這個
    // 物理上不可能的上界再取 10 倍餘裕算出來的。真的溢位代表推導錯了，
    // 而不是「調大一點就好」。
    expect(o.eventsDropped).toBe(0)
  })

  it('每一次命中都推了一筆事件', () => {
    // 命中事件數必須與實際命中次數一致 —— 少了代表 resolveHits 有一條
    // 提早 continue 的路徑漏掉推送，而火花會在那個情形下靜靜地不出現。
    expect(o.hitEventCount).toBeGreaterThan(0)
  })
```

- [ ] **Step 3: 跑測試並記下觀測值**

Run: `npx vitest run test/integration/multi-battle.test.ts --reporter=basic`
Expected: 全綠。把 console 印出的 `hitEventCount`、`splashEventCount`、`eventsDropped` **抄進實作報告**。

`splashEventCount` 很可能是 **0** —— 20v20 打在 4,000 m 高度，而彈丸壽命 1.2 s × 887 m/s = 最多飛 1,064 m，平射的子彈碰不到海面（spec §7.3）。**那不是缺陷**，是設計自己就收斂。水柱由人工驗收確認（Task 12 條件 14）。

- [ ] **Step 4: 驗證守門員真的會紅**

**這一步不可以跳過。** 暫時把 `src/world/events.ts` 的 `IMPACT_CAPACITY` 改成 `2`，跑：

Run: `npx vitest run test/integration/multi-battle.test.ts -t "事件緩衝從未溢位"`
Expected: **FAIL**，`eventsDropped > 0`

改回 `64`，再跑一次確認全綠。

- [ ] **Step 5: 提交**

```bash
git add test/integration/multi-battle.test.ts
git commit -m "test: 事件緩衝從未溢位（M7 spec §13.1 條件 9）

IMPACT_CAPACITY = 64 是推導出來的：40 架全開火 2,434 發/s，假設全部命中
（物理上不可能）在 60 fps 下是 41 次/幀，除以 8 個子步約 6 次/子步，
10 倍餘裕。這一條讓推導有實測背書。

測試自己排空事件緩衝，因為它不是 main.ts —— 不排空的話緩衝會填滿並開始
丟棄，斷言必紅，而那個紅燈不代表任何缺陷。

守門員驗證過會紅：把 IMPACT_CAPACITY 改成 2，eventsDropped 立刻大於 0。"
```

---

## Task 11: 效能閘門重新校準

**Files:**
- Modify: `test/unit/perf-gate.test.ts`（只動 20v20 那一段的常數與註解）

**背景**（spec §11.1）：`resolveHits` 是全專案最熱的迴圈，本里程碑對它做了兩件事 —— 法線抽取（六次 slab 迴圈裡多兩個賦值，加上命中時一次四元數旋轉）與入海判定（每個存活彈丸多兩次比較）。**必須重測並重新推導。**

M6 交付的是預算 300 µs、門檻 900 µs，實測 208.7 / 216.1 / 245.1 µs。

- [ ] **Step 1: 獨立量三次**

Run（跑三次，每次都記下 mean）：

```
npx vitest bench --run bench/multi.bench.ts
```

**單一次量測會騙人** —— M5 量到 313 / 388 / 402 µs，第一次是機器最閒的時候。三次都要記。

輸出裡的欄位順序是 `name / hz / min / max / mean / p75 / p99 / p995 / p999 / rme / samples`，取 **mean**。

- [ ] **Step 2: 推導新的預算與門檻**

規則（與 M6 相同）：

- **預算** = 三次量測的**上界之上**取整到百位。它由 `npm run bench` 獨立驗證，不在測試裡斷言。
- **門檻** = 預算 × 3。理由不變：這一條要抓的是**數量級的迴歸**，具體而言就是「有人把排序掃描改回全掃描」—— 實測那會讓粗篩從 202 µs 變成 7,408 µs。並行雜訊最壞約三倍，兩者之間有間隙。

**若新的預算高於 M6 的 300 µs**，那是本里程碑的成本，照實記錄並調高；**若更低**（入海回收讓存活彈丸變少），**一定要跟著調低**，否則門檻會鬆到再也抓不到迴歸。

**注意**：`bench/multi-load.ts` 每步把彈丸池補滿到 `PROJECTILE_CAPACITY`，所以入海回收**不會**讓 bench 的負載變空 —— 那是 M6 已經確認過的一件事。

- [ ] **Step 3: 改常數與註解**

改 `MULTI_BUDGET_US` / `MULTI_GATE_US`，並在該段註解裡**保留 M5、M6、M7 三組數字**。格式照既有的：

```ts
 * 【M7 重新校準】`resolveHits` 被動了兩處：入射面法線（六次 slab 迴圈裡
 * 多兩個賦值，加上命中時一次四元數旋轉）與入海判定（每個存活彈丸多兩次
 * 比較）。M7 實測三次：<填入> / <填入> / <填入> µs。
 *
 * 【入海回收不影響這個數字】`bench/multi-load.ts` 每步把彈丸池補滿到
 * `PROJECTILE_CAPACITY`，所以負載是合成的。
```

- [ ] **Step 4: 跑閘門確認全綠**

Run: `npx vitest run test/unit/perf-gate.test.ts`
Expected: PASS

（整套並行跑時這一條會印出超支警告，那是環境不是迴歸 —— M6 已經查證並記在該檔的註解裡。）

- [ ] **Step 5: 連跑整套三次，確認不會間歇性紅燈**

Run（連續三次）: `npm run build && npx vitest run`
Expected: 三次全綠。**會飄的效能門檻比沒有門檻更糟** —— 它訓練所有人重跑一次當作沒看到。若有任何一次紅，修的是量測方法（批次數／批次長度），**不是**放寬斷言。

- [ ] **Step 6: 提交**

```bash
git add test/unit/perf-gate.test.ts
git commit -m "test: 20v20 效能閘門依 M7 的改動重新校準（M7 spec §11.1）

resolveHits 被動了兩處：入射面法線（六次 slab 迴圈裡多兩個賦值，加上
命中時一次四元數旋轉）與入海判定（每個存活彈丸多兩次比較）。

M7 實測三次：<填入>。預算取上界之上的整百，門檻取三倍。M5、M6、M7 三組
數字都留在註解裡。

入海回收不影響這個數字 —— bench/multi-load.ts 每步把彈丸池補滿，負載是
合成的。"
```

---

## Task 12: 實測回填、文件與人工驗收

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-weapon-effects-design.md`（§14 門檻總表之後新增 §14.1）
- Modify: `README.md`

**背景**：M2、M4、M5、M6 都是這樣收尾的 —— 起始值全部標著「待實測回填」，交付時要把真正量到的數字寫回去，並記下哪些沒有給出強訊號。

- [ ] **Step 1: 人工驗收（專案負責人執行）**

Run: `npm run dev`

逐條走 spec §13.2 的五條，把結果記進報告：

| # | 條件 | 通過？ |
|---|---|---|
| 11 | 開火時槍口有短促的閃，是**閃爍**不是常亮的燈 | |
| 12 | 槍焰焊在槍口上，不隨機動抖動 | |
| 13 | 打中敵機時看得到火花**從被打中的那個面**噴開 | |
| 14 | 低空對海射擊時看得到白色水柱抽起又落下 | |
| 15 | 40 架齊射時畫面不吵、FPS 與 draw call 沒有明顯劣化 | |

**條件 11 不通過**（看起來是常亮的燈）：`FLASH_SECONDS` 往下調。上界的推導是「工作週期必須明顯低於 1」，0.02 s 給 MG 131 的 30%。

**條件 13 不通過**（火花方向看起來不對）：先分辨是「從機體內部噴出來」還是「方向亂跳」。前者代表法線取到了內層盒（Task 1 有測試守著，先看那條有沒有被改動）；後者代表 `sparkDirection` 的錐角太大，調 `SPARK_CONE`。

**條件 15 不通過**：先看 draw call 有沒有從 30 變成 33 —— 若不是 33，代表某個特效沒有共用 `InstancedMesh`。

- [ ] **Step 2: 回填 spec §14 並新增 §14.1**

把每一列的「起始值」與**實際交付值**並列，並新增：

```markdown
## 14.1 交付紀錄

| 項目 | 交付值 | 與起始值的差異 |
|---|---|---|
| ... | ... | ... |

### 實作階段發現、spec 沒有預見的事

（逐條記下，每一條要說明「症狀是什麼」與「為什麼 spec 沒看到」）
```

**已知必須記進去的兩件事**（寫計畫時就發現的，spec 已各自更正過一次）：

1. **海面不是平面** —— spec 初稿說「海面高度取 0，與 `SEA_LEVEL` 同一個數字」，但真正的 app 注入的是 Gerstner 波的撞海判定。照初稿做，水柱會生在 `y = 0` 而看得見的海面在起伏。
2. **存活的飛機可以低於 `y = 0`** —— 初稿主張「水面下沒有可以打的目標」，但撞海判定是 `y <= 浪高 + CRASH_CLEARANCE`，`CRASH_CLEARANCE = 2 m`、浪谷 −2.15 m，所以存活飛機可以低到 −0.15 m、命中盒可以伸到 −7 m。

**還有一件是本計畫刻意的偏離**：spec §7.1 的「透明度後 50% 線性淡出」沒有實作 —— `InstancedMesh` 的逐實例顏色只有 RGB 沒有 alpha，而高度曲線本身就完成了消失。

- [ ] **Step 3: 更新 `README.md`**

先讀一次 `README.md`，然後做三處修改：

1. **開頭的進度那一行**：加上武器特效。
2. **「架構」那一節**：`render/` 之下加三行 —— `muzzle.ts` 槍焰、`sparks.ts` 命中火花、`splash.ts` 入海水柱；`world/` 之下加一行 `events.ts` 撞擊事件緩衝。
3. **效能那一段**：把 20v20 的每步耗時換成 Task 11 量到的新值，並註明 draw call 由 30 變成 33。

- [ ] **Step 4: 跑完整回歸三次**

Run（連續三次）: `npm run build && npx vitest run`
Expected: 三次全綠。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-08-04-weapon-effects-design.md README.md
git commit -m "docs: M7 實測回填與交付紀錄"
```

---

## 自我檢查（寫完計畫後執行，結果記在下方）

### 1. Spec 覆蓋

| Spec 章節 | 由哪個任務實作 |
|---|---|
| §1.1 入海回收 | Task 5 |
| §2.1 槍焰走計時器 | Task 3（狀態）、Task 6（渲染） |
| §2.2 事件緩衝、子步排空 | Task 2（結構）、Task 4/5（產生）、Task 9（排空） |
| §2.3 不用回呼 | Task 2 的設計即是 |
| §3.1 從 slab 取法線 | Task 1 |
| §3.2 三件容易寫錯的事 | Task 1 的三條測試 |
| §4.1 入海判準 | Task 5 |
| §4.2 偵測平面 vs 真實浪高 | Task 5（平面）、Task 8（浪高） |
| §4.3 回收深度的推導 | Task 5，含一條用真實機種資料算的測試 |
| §5 槍焰 | Task 3、6 |
| §6 命中火花 | Task 7 |
| §7 入海水柱 | Task 8 |
| §8 尺寸與可見距離 | Task 6/7/8 的常數註解 |
| §9 渲染層共同紀律 | Task 6/7/8 各四條 `InstancedMesh` 測試 |
| §10 檔案結構 | 全部 |
| §11 效能 | Task 11 |
| §12 測試策略 | 各任務的測試步驟 |
| §13.1 自動驗收 1–10 | Task 1（1–3）、5（4–5）、7（6）、7/8（7）、6/7/8（8）、10（9）、11（10） |
| §13.2 人工驗收 11–15 | Task 12 |
| §14 門檻總表 | Task 12 回填 |
| §16 明確不做 | 全部任務都沒有做它們 |

**沒有缺口。**

### 2. 佔位符掃描

刻意保留的 `<填入>` 只出現在 Task 11 —— 那是**必須由實測產生**的三個 µs 數字，而計畫已明確寫出「怎麼量」（`npx vitest bench --run bench/multi.bench.ts` 三次，取 mean）與「用什麼規則從量測值推出門檻」（上界之上取整到百位、門檻取三倍）。這與「TBD」不同：規則是完整的，只有數字要跑一次才知道。

Task 12 的表格是報告模板，不是規格佔位符。

### 3. 型別一致性

| 名稱 | 定義於 | 使用於 |
|---|---|---|
| `FaceNormal` / `segmentBox(..., outFace?)` | Task 1 | Task 1 內部（`hitAircraft`） |
| `HitResult.nx/ny/nz` | Task 1 | Task 4 |
| `ImpactEvents` / `IMPACT_STRIDE` / `createImpacts` / `pushImpact` / `clearImpacts` | Task 2 | Task 4、5、7、8、9、10 |
| `MAX_MOUNTS` | Task 3（`weapons/types.ts`） | Task 6 |
| `FLASH_SECONDS` / `Combatant.muzzleFlash` | Task 3（`world/World.ts`） | Task 6 |
| `World.hitEvents` | Task 4 | Task 9、10 |
| `SEA_SURFACE_Y` / `SEA_KILL_Y` / `World.splashEvents` | Task 5 | Task 9、10 |
| `createMuzzles` / `Muzzles.update(combatants, positions, quaternions)` | Task 6 | Task 9 |
| `createSparks` / `Sparks.emit(events, cx, cy, cz)` / `.step(dt)` | Task 7 | Task 9 |
| `createSplashes` / `Splashes.emit(events, heightAt, time)` / `.step(dt)` | Task 8 | Task 9 |
| `sparkDirection` / `splashScale` | Task 7、8 | 各自的測試 |

**名稱在定義處與使用處一致。**

### 4. 破壞性變更清單（實作者要預期會紅的既有測試）

| 任務 | 會紅的既有測試 | 處置 |
|---|---|---|
| 1 | 無 —— `segmentBox` 的新參數是選用的，`HitResult` 只增欄位 | 若 `hit-matrix` 或 `cull-equivalence` 紅了，代表法線的抽取動到了 `t` 或 `part`，**回去看，不要改測試** |
| 3 | 無 —— 新欄位有預設值 | 對戰矩陣紅了代表開火行為被動到 |
| 5 | `multi-battle` 的觀測值**必須完全不變** | 變了代表 `SEA_KILL_Y` 的推導有洞（Task 5 Step 6 專門驗這件事） |
| 11 | `perf-gate` 的 20v20 預算警告 | Task 11 重新校準 |

**M4 的兩個矩陣測試（`ai-duel-matrix`、`ai-safety-matrix`）與 `hit-matrix` 全程不得改動** —— 它們是「命中判定與開火行為逐位元不變」的證據。任何一條紅了，代表 Task 1／3／5 動到了不該動的地方。
