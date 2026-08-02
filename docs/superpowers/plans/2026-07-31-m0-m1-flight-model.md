# M0 + M1 飛行模型實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個可在瀏覽器中駕駛 P-51D 或 Bf 109 G-6 的飛行模擬，飛行模型通過史實性能測試（±5%），並讓玩家透過 HUD 的 Ps/Es 讀數親身感受能量戰。

**Architecture:** 氣動、大氣、推進三個模組寫成無狀態純函數，供三方共用——單元測試、準靜態包絡求解器（EM 圖與性能測試）、以及未來 M4 的 AI 查表。`dynamics` 是唯一持有狀態的物理模組，以 240 Hz 固定步長積分。飛行指揮儀（Bank-To-Turn + 串級 PID + G/迎角限制器）只輸出舵面指令，永遠不直接修改姿態，因此物理層是唯一的真相來源。

**Tech Stack:** Vite · TypeScript (strict) · three.js · lil-gui · Vitest

**Spec:** `docs/superpowers/specs/2026-07-31-m0-m1-flight-model-design.md`

---

## Global Constants

以下為專案級約束，每個任務的要求都隱含包含本節。

```
座標系      Three.js 右手系，Y 軸向上，單位公尺
機體軸      X = 右翼   Y = 座艙上方   Z = 機尾   機首 = −Z
慣量對應    Ixx = 俯仰   Iyy = 偏航   Izz = 滾轉
單位        內部一律 SI（m, m/s, kg, N, rad）；僅 HUD 層轉換顯示單位
姿態        四元數。狀態絕不以歐拉角儲存
物理步長    dt = 1/240 s，可設定 240/120/60
子步上限    每幀最多 8 步，超過即丟棄剩餘 accumulator
dt 上限     單幀經過時間夾在 0.25 s 以內
熱路徑      physicsStep 內禁止 new THREE.Vector3() 等配置行為
TypeScript  strict: true, noUncheckedIndexedAccess: true
執行期依賴  僅 three 與 lil-gui
測試        Vitest，全部不啟動渲染，可於 node 執行
Commit      每個任務結束時 commit，訊息使用繁體中文
```

**標準大氣常數**（`src/physics/atmosphere.ts` 中定義為 const）：

```
T0 = 288.15 K      P0 = 101325 Pa     RHO0 = 1.225 kg/m³
LAPSE = 0.0065 K/m R = 287.05 J/(kg·K) GAMMA = 1.4
H_TROP = 11000 m   T_TROP = 216.65 K  P_TROP = 22632.06 Pa
G0 = 9.80665 m/s²
```

---

## Spec 修訂

規劃期間對照 spec 實算後，發現五處必須修訂。**這些修訂已納入下方任務，spec 文件將在 Task 27 一併更新。**

### 修訂 1：CL_max 改為推導值

Spec §7.1 同時給定 `CL_α = 4.4 /rad`、`α_crit = 15°`、`CL_max = 1.45`，但 `4.4 × 15° (0.2618 rad) = 1.152 ≠ 1.45`，三者互相矛盾，且會在失速點造成 CL 曲線不連續。

**改為**：`CL_α`、`α_0`（零升迎角）、`α_crit` 為主參數，`CL_max = CL_α × (α_crit − α_0)` 為推導值。這保證曲線在失速點連續。史實 CL_max 降級為測試斷言目標（±8%）。

```
P-51D   CL_α 4.40   α_0 −2.5°   α_crit 15.5°  →  CL_max = 1.382  (史實 1.45, −4.7%)
Bf109G  CL_α 4.45   α_0 −2.0°   α_crit 15.5°  →  CL_max = 1.359  (史實 1.40, −2.9%)
Bf109G 縫翼展開     α_crit +2.5° = 18.0°       →  CL_max = 1.553  (史實 1.55, +0.2%)
```

### 修訂 2：必須加入進氣衝壓恢復（ram recovery）

**這是會直接擋住 M1 驗收的問題。** 以 spec 原本的推進模型實算 P-51D 於 7,600 m：

```
ρ = 0.5503   σ = 0.4492   σ_crit(5900m) = 0.5448
引擎功率 = 1370 hp × (0.4492/0.5448 − 0.117)/0.883 = 1098 hp = 818,600 W
195.3 m/s (703 km/h) 時推力 = 0.85 × 818600 / 195.3 = 3,563 N
同條件阻力 = 4,300 N

推力 < 阻力 → 史實極速 703 km/h 永遠達不到，L2 測試必定失敗
```

真實原因是高速飛行時進氣道的動壓恢復（velocity head recovery）會提高增壓器的有效進氣壓，等效於降低飛行高度。加入 ram 後：

```
ramFactor = 1 + η_ram × ((1 + 0.2M²)^3.5 − 1)
M = 0.6306 → (1.0794)^3.5 = 1.3066
η_ram = 0.8 → ramFactor = 1.2453
σ_eff = 0.4492 × 1.2453 = 0.5594 > σ_crit → 引擎維持臨界功率 1370 hp = 1,021,600 W
推力 = 0.85 × 1021600 / 195.3 = 4,447 N > 4,300 N  ✓
```

`ramEfficiency` 列為調參旋鈕（初始 0.8）。`σ_eff` 必須夾制上限為海平面 σ = 1.0。

### 修訂 3：L2 / L3 改用準靜態解析求解器

Spec §13.2 寫「跑模擬到穩態」。實際上以 240 Hz 積分器跑到極速穩態需要數十秒模擬時間 × 兩台飛機 × 多個高度，測試會慢到無法迭代，且受積分誤差影響而不夠確定。

**改為**：新增 `src/analysis/envelope.ts`，以解析／二分搜尋方式直接求解穩態（見 Task 13）。L2/L3 呼叫求解器。

覆蓋率缺口由 **Task 16 的端對端交叉驗證測試**補回：實際跑積分器 60 秒，確認收斂結果與求解器差距在 2% 以內。這同時驗證了積分器與求解器兩者。

### 修訂 4：移除 `slatClBonus` 參數

Spec §6.2 同時給縫翼 `α_crit +3.5°` 與 `CL_max +0.15`。在修訂 1 的推導模型下，延長 `α_crit` 會自動提高 `CL_max`，兩個參數會互相打架。

**改為**：縫翼只有一個參數 `slatAlphaBonus = 2.5°`，CL_max 加成為推導結果（1.359 → 1.553）。

### 修訂 5：新增 `src/analysis/` 目錄

Spec §14.1 只有 `tools/EmDiagram.ts`。但求解器需要被測試呼叫，而測試不應相依於含 Canvas 繪圖的 `tools/`。

**改為**：拆成 `src/analysis/envelope.ts`（純計算，被測試與繪圖共用）與 `src/tools/EmDiagram.ts`（只負責 Canvas 繪圖）。

---

## File Structure

```
package.json              依賴與 npm scripts
tsconfig.json             strict + noUncheckedIndexedAccess
vite.config.ts            Vite + Vitest 設定
index.html               進入點

src/core/math.ts          常數與純量工具（clamp/lerp/smoothstep/deg-rad）
src/core/pool.ts          預配置暫存物件工廠（makeScratch）
src/core/loop.ts          固定步長累加器（含子步上限與 dt 夾制）
src/core/perf.ts          效能覆蓋層（FPS/frametime/物理步耗時/draw call）

src/physics/types.ts      FlightState / Controls / AirData / AeroState / ForceMoment
src/physics/axes.ts       機體軸 ↔ 標準氣動軸的轉換（單一權威來源）
src/physics/atmosphere.ts ISA 大氣，純函數
src/physics/aero.ts       CL/CD/CY、力與力矩，純函數
src/physics/propulsion.ts 引擎功率曲線（含 ram）與螺旋槳推力，純函數
src/physics/dynamics.ts   6DOF 積分，唯一持有狀態

src/specs/types.ts        AircraftSpec 與 HistoricalReference 型別
src/specs/p51d.ts         P-51D 參數與史實參考值
src/specs/bf109g6.ts      Bf 109 G-6 參數與史實參考值

src/analysis/envelope.ts  準靜態包絡求解器（性能測試與 EM 圖共用）

src/aircraft/Aircraft.ts  組合 spec + state + controls，對外提供 update()

src/control/pid.ts        PID 控制器
src/control/limiters.ts   G 限制器與迎角限制器
src/control/FlightDirector.ts  Bank-To-Turn 串級控制

src/input/InputState.ts   抽象輸入狀態
src/input/bindings.ts     Pointer Lock、鍵盤、滑鼠事件綁定

src/camera/CameraRig.ts   第三人稱／機首視角／右鍵自由視角

src/render/scene.ts       場景、光照、renderer
src/render/sky.ts         漸層 skybox
src/render/ocean.ts       Gerstner 波浪海面（含波高查詢供碰撞用）
src/render/props.ts       浮動參照物（InstancedMesh）
src/render/geometry/fuselage.ts      橢圓截面 lofting
src/render/geometry/wing.ts          梯形翼（含上反角、後掠角）
src/render/geometry/silhouettes.ts   兩機種的外型參數表
src/render/geometry/buildAircraft.ts 組裝機體，回傳可動舵面控制介面

src/hud/types.ts             HudFrame / HudLayout / 色盤 / IAS 換算
src/hud/attitude-math.ts     姿態與航向換算（純函數，可單獨測試）
src/hud/Hud.ts               Canvas 2D overlay 主體
src/hud/widgets/reticle.ts   雙準星與連線
src/hud/widgets/tape.ts      速度／高度／航向帶
src/hud/widgets/attitude.ts  圓形姿態儀
src/hud/widgets/minimap.ts   小地圖
src/hud/widgets/energy.ts    G / α / Ps / Es 讀數與失速警告
src/hud/widgets/gEffect.ts   黑視與紅視

src/tools/settings.ts     全域設定（λ、模型放大、物理步）與 localStorage
src/tools/specExport.ts   機種參數序列化為 TypeScript 原始碼
src/tools/TuningPanel.ts  lil-gui 調參面板
src/tools/RingBuffer.ts   環形緩衝區
src/tools/Telemetry.ts    滾動曲線 + 歸因面板 + CSV 匯出
src/tools/EmDiagram.ts    Doghouse plot 等圖的 Canvas 繪圖

src/main.ts               組裝所有模組

test/unit/math.test.ts          math + pool
test/unit/loop.test.ts
test/unit/ocean.test.ts
test/unit/atmosphere.test.ts
test/unit/axes.test.ts
test/unit/specs.test.ts
test/unit/aero.test.ts
test/unit/propulsion.test.ts
test/unit/dynamics.test.ts
test/unit/envelope.test.ts
test/unit/aim.test.ts
test/unit/aircraft.test.ts
test/unit/geometry.test.ts
test/unit/camera.test.ts
test/unit/hud.test.ts
test/unit/specExport.test.ts
test/unit/ringBuffer.test.ts
test/unit/emDiagram.test.ts
test/control/pid.test.ts
test/control/limiters.test.ts
test/control/director.test.ts          L4 矩陣（120 案例）
test/performance/historical.test.ts    L2 史實性能 ±5%
test/balance/relative.test.ts          L3 平衡關係
test/integration/integrator.test.ts    積分器 vs 求解器交叉驗證
bench/physics.bench.ts                 物理步微基準
```

---

# Phase M0：骨架

## Task 1：專案骨架與工具鏈

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`
- Create: `src/core/math.ts`, `test/unit/math.test.ts`

**Interfaces:**
- Consumes: 無（起始任務）
- Produces: `clamp(v, lo, hi): number` · `lerp(a, b, t): number` · `smoothstep(e0, e1, x): number` · `DEG: number` · `RAD: number` · `G0: number`，全部自 `src/core/math.ts` 具名匯出

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "grok-aircraft2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "bench": "vitest bench --run"
  },
  "dependencies": {
    "three": "^0.180.0",
    "lil-gui": "^0.20.0"
  },
  "devDependencies": {
    "@types/three": "^0.180.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 建立 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "test", "bench", "vite.config.ts"]
}
```

- [ ] **Step 3: 建立 vite.config.ts**

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
})
```

- [ ] **Step 4: 建立 index.html**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Grok Aircraft</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #0a0e14; }
      canvas { display: block; }
      #hud { position: fixed; inset: 0; pointer-events: none; }
    </style>
  </head>
  <body>
    <canvas id="scene"></canvas>
    <canvas id="hud"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: 寫失敗的測試**

`test/unit/math.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { clamp, lerp, smoothstep, DEG, RAD, G0 } from '../../src/core/math'

describe('math', () => {
  it('clamp 夾制在區間內', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('lerp 線性內插', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.25)).toBe(2.5)
  })

  it('smoothstep 在端點為 0 與 1，中點為 0.5', () => {
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10)
  })

  it('smoothstep 在區間外夾制', () => {
    expect(smoothstep(0, 1, -5)).toBe(0)
    expect(smoothstep(0, 1, 5)).toBe(1)
  })

  it('角度常數正確', () => {
    expect(90 * DEG).toBeCloseTo(Math.PI / 2, 12)
    expect((Math.PI / 2) * RAD).toBeCloseTo(90, 12)
    expect(G0).toBeCloseTo(9.80665, 6)
  })
})
```

- [ ] **Step 6: 執行測試確認失敗**

```
npm install
npm test
```

預期：FAIL，錯誤訊息為找不到模組 `../../src/core/math`。

- [ ] **Step 7: 實作 src/core/math.ts**

```ts
export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI
export const G0 = 9.80665

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
```

- [ ] **Step 8: 建立最小 src/main.ts**

```ts
console.info('[grok-aircraft] boot')
```

- [ ] **Step 9: 執行測試確認通過**

```
npm test
```

預期：PASS，5 個測試全綠。

- [ ] **Step 10: 確認型別檢查與 dev server 可啟動**

```
npx tsc --noEmit
npm run dev
```

預期：`tsc` 無輸出（無錯誤）；dev server 啟動後瀏覽器 console 顯示 `[grok-aircraft] boot`。確認後結束 dev server。

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json vite.config.ts index.html src/core/math.ts src/main.ts test/unit/math.test.ts package-lock.json
git commit -m "feat: 專案骨架與純量數學工具

Vite + TypeScript strict + Vitest 工具鏈，
core/math.ts 提供 clamp/lerp/smoothstep 與角度、重力常數。"
```

---

## Task 2：暫存物件池

**Files:**
- Create: `src/core/pool.ts`
- Test: `test/unit/math.test.ts`（追加 describe 區塊）

**Interfaces:**
- Consumes: 無
- Produces: `makeScratch(vecCount: number, quatCount?: number): Scratch`，其中 `Scratch = { v: Vector3[]; q: Quaternion[] }`。各物理模組在模組載入時呼叫一次並私有持有，**不得跨模組共用**（避免別名衝突）。

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/math.test.ts` 追加：

```ts
import { makeScratch } from '../../src/core/pool'
import { Vector3, Quaternion } from 'three'

describe('pool', () => {
  it('配置指定數量的暫存物件', () => {
    const s = makeScratch(3, 2)
    expect(s.v).toHaveLength(3)
    expect(s.q).toHaveLength(2)
    expect(s.v[0]).toBeInstanceOf(Vector3)
    expect(s.q[0]).toBeInstanceOf(Quaternion)
  })

  it('quatCount 預設為 0', () => {
    const s = makeScratch(2)
    expect(s.q).toHaveLength(0)
  })

  it('每個暫存物件都是獨立實例', () => {
    const s = makeScratch(2)
    s.v[0]!.set(1, 2, 3)
    expect(s.v[1]!.x).toBe(0)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/math.test.ts`
預期：FAIL，找不到模組 `../../src/core/pool`。

- [ ] **Step 3: 實作 src/core/pool.ts**

```ts
import { Vector3, Quaternion } from 'three'

export interface Scratch {
  readonly v: readonly Vector3[]
  readonly q: readonly Quaternion[]
}

/**
 * 建立模組私有的預配置暫存物件。
 *
 * 使用約定：各模組在載入時呼叫一次並私有持有，禁止跨模組共用。
 * 跨模組共用會在巢狀呼叫時造成別名衝突（例如 aero 借用中的向量被 dynamics 覆寫）。
 */
export function makeScratch(vecCount: number, quatCount = 0): Scratch {
  return {
    v: Array.from({ length: vecCount }, () => new Vector3()),
    q: Array.from({ length: quatCount }, () => new Quaternion()),
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/math.test.ts`
預期：PASS，8 個測試全綠。

- [ ] **Step 5: Commit**

```bash
git add src/core/pool.ts test/unit/math.test.ts
git commit -m "feat: 暫存物件池

makeScratch 提供模組私有的預配置 Vector3/Quaternion，
用於物理熱路徑的零配置要求。"
```

---

## Task 3：固定步長累加器

**Files:**
- Create: `src/core/loop.ts`
- Test: `test/unit/loop.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `FixedStepAccumulator` class
  - `constructor(opts: { stepHz: number; maxSubsteps: number; maxFrameSeconds: number })`
  - `advance(frameSeconds: number, step: (dt: number) => void): number` — 執行子步並回傳內插係數 alpha ∈ [0, 1)
  - `get stepSeconds(): number`
  - `setStepHz(hz: number): void` — 變更步長並清空 accumulator
  - `lastSubstepCount: number` — 上次 advance 實際執行的子步數（供效能覆蓋層使用）

- [ ] **Step 1: 寫失敗的測試**

`test/unit/loop.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { FixedStepAccumulator } from '../../src/core/loop'

function makeLoop(overrides: Partial<{ stepHz: number; maxSubsteps: number; maxFrameSeconds: number }> = {}) {
  return new FixedStepAccumulator({
    stepHz: 240,
    maxSubsteps: 8,
    maxFrameSeconds: 0.25,
    ...overrides,
  })
}

describe('FixedStepAccumulator', () => {
  it('60fps 的一幀跑 4 個 240Hz 子步', () => {
    const loop = makeLoop()
    let count = 0
    loop.advance(1 / 60, () => count++)
    expect(count).toBe(4)
  })

  it('每個子步收到固定的 dt', () => {
    const loop = makeLoop()
    const dts: number[] = []
    loop.advance(1 / 60, (dt) => dts.push(dt))
    for (const dt of dts) expect(dt).toBeCloseTo(1 / 240, 12)
  })

  it('餘數累積到下一幀', () => {
    const loop = makeLoop({ stepHz: 100 })
    let count = 0
    // 每幀 1/60 = 0.016667s，步長 0.01s → 第一幀 1 步（餘 0.006667）
    loop.advance(1 / 60, () => count++)
    expect(count).toBe(1)
    // 第二幀累積至 0.023333 → 2 步
    count = 0
    loop.advance(1 / 60, () => count++)
    expect(count).toBe(2)
  })

  it('回傳的 alpha 為剩餘 accumulator 的比例', () => {
    const loop = makeLoop({ stepHz: 100 })
    const alpha = loop.advance(0.015, () => {})
    // 0.015 跑 1 步後剩 0.005，alpha = 0.005 / 0.01 = 0.5
    expect(alpha).toBeCloseTo(0.5, 10)
  })

  it('子步數受 maxSubsteps 上限限制', () => {
    const loop = makeLoop({ maxSubsteps: 8 })
    let count = 0
    loop.advance(1.0, () => count++) // 1 秒 = 240 步，但上限 8
    expect(count).toBe(8)
  })

  it('觸及子步上限時丟棄剩餘 accumulator，不產生螺旋死亡', () => {
    const loop = makeLoop({ maxSubsteps: 8 })
    loop.advance(1.0, () => {}) // 觸及上限
    let count = 0
    loop.advance(1 / 60, () => count++) // 下一幀應恢復正常
    expect(count).toBe(4)
  })

  it('單幀經過時間被 maxFrameSeconds 夾制', () => {
    const loop = makeLoop({ maxSubsteps: 1000, maxFrameSeconds: 0.25 })
    let count = 0
    loop.advance(10, () => count++) // 分頁切回造成的巨大 dt
    expect(count).toBe(60) // 0.25s × 240Hz
  })

  it('lastSubstepCount 記錄實際子步數', () => {
    const loop = makeLoop()
    loop.advance(1 / 60, () => {})
    expect(loop.lastSubstepCount).toBe(4)
  })

  it('setStepHz 變更步長並清空 accumulator', () => {
    const loop = makeLoop()
    loop.advance(0.003, () => {}) // 不足一步，留下餘數
    loop.setStepHz(120)
    expect(loop.stepSeconds).toBeCloseTo(1 / 120, 12)
    let count = 0
    loop.advance(1 / 120, () => count++)
    expect(count).toBe(1) // 若未清空 accumulator 會變成 2
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/loop.test.ts`
預期：FAIL，找不到模組 `../../src/core/loop`。

- [ ] **Step 3: 實作 src/core/loop.ts**

```ts
export interface FixedStepOptions {
  /** 物理步頻率，Hz。專案預設 240。 */
  stepHz: number
  /** 每幀最多執行的子步數。超過即丟棄剩餘 accumulator，避免螺旋死亡。 */
  maxSubsteps: number
  /** 單幀經過時間上限，秒。防止分頁切回時的巨大 dt。 */
  maxFrameSeconds: number
}

export class FixedStepAccumulator {
  private accumulator = 0
  private step_ = 0
  private readonly maxSubsteps: number
  private readonly maxFrameSeconds: number

  /** 上次 advance 實際執行的子步數，供效能覆蓋層讀取。 */
  lastSubstepCount = 0

  constructor(opts: FixedStepOptions) {
    this.step_ = 1 / opts.stepHz
    this.maxSubsteps = opts.maxSubsteps
    this.maxFrameSeconds = opts.maxFrameSeconds
  }

  get stepSeconds(): number {
    return this.step_
  }

  /** 變更步長。會清空 accumulator，避免以舊步長累積的餘數被新步長誤讀。 */
  setStepHz(hz: number): void {
    this.step_ = 1 / hz
    this.accumulator = 0
  }

  /**
   * 消耗一幀的經過時間，執行對應數量的固定步長子步。
   * @returns 內插係數 alpha ∈ [0, 1)，供渲染端內插 position/quaternion。
   */
  advance(frameSeconds: number, step: (dt: number) => void): number {
    const clamped = frameSeconds > this.maxFrameSeconds ? this.maxFrameSeconds : frameSeconds
    this.accumulator += clamped

    let n = 0
    while (this.accumulator >= this.step_ && n < this.maxSubsteps) {
      step(this.step_)
      this.accumulator -= this.step_
      n++
    }
    this.lastSubstepCount = n

    // 觸及子步上限代表機器跟不上，丟棄剩餘時間讓遊戲進入慢動作而非卡死。
    if (n === this.maxSubsteps && this.accumulator >= this.step_) {
      this.accumulator = 0
    }

    return this.accumulator / this.step_
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/loop.test.ts`
預期：PASS，9 個測試全綠。

- [ ] **Step 5: Commit**

```bash
git add src/core/loop.ts test/unit/loop.test.ts
git commit -m "feat: 固定步長累加器

240Hz 物理步與渲染解耦，含子步上限、dt 夾制、
步長可變更三重保護，回傳 alpha 供渲染內插。"
```

---

## Task 4：場景、天空與插值驗證

**Files:**
- Create: `src/render/scene.ts`, `src/render/sky.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `FixedStepAccumulator`（Task 3）
- Produces:
  - `createScene(canvas: HTMLCanvasElement): SceneContext`
  - `SceneContext = { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; resize(): void }`
  - `createSky(): Mesh`

- [ ] **Step 1: 實作 src/render/sky.ts**

```ts
import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Color } from 'three'

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 horizon;
  uniform vec3 zenith;
  varying vec3 vDir;
  void main() {
    float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(horizon, zenith, pow(t, 0.65)), 1.0);
  }
`

/** 漸層天空球。關閉深度寫入並設定 renderOrder，永遠在最遠處。 */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      horizon: { value: new Color(0x9fc3d8) },
      zenith: { value: new Color(0x1f4f80) },
    },
    side: BackSide,
    depthWrite: false,
  })
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  mesh.scale.setScalar(40000)
  return mesh
}
```

- [ ] **Step 2: 實作 src/render/scene.ts**

```ts
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { createSky } from './sky'

export interface SceneContext {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  resize(): void
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = false // M1 不啟用陰影，見 spec §15

  const scene = new Scene()
  scene.add(createSky())

  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  scene.add(sun)
  scene.add(new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9))
  scene.add(new AmbientLight(0xffffff, 0.15))

  const camera = new PerspectiveCamera(65, 1, 1, 60000)

  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  return { renderer, scene, camera, resize }
}
```

- [ ] **Step 3: 在 main.ts 接上迴圈與佔位方塊**

```ts
import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createScene } from './render/scene'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

const placeholder = new Mesh(
  new BoxGeometry(10, 3, 12),
  new MeshStandardMaterial({ color: 0x8fa6b8, flatShading: true }),
)
ctx.scene.add(placeholder)

// 佔位飛行體：等速直線，用於驗證迴圈與渲染插值
const prev = new Vector3(0, 500, 0)
const curr = new Vector3(0, 500, 0)
const velocity = new Vector3(0, 0, -120) // 機首 −Z，120 m/s

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
let lastTime = performance.now()

function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now

  const alpha = loop.advance(frameSeconds, (dt) => {
    prev.copy(curr)
    curr.addScaledVector(velocity, dt)
  })

  placeholder.position.lerpVectors(prev, curr, alpha)
  ctx.camera.position.set(curr.x, curr.y + 12, curr.z + 45)
  ctx.camera.lookAt(curr)

  ctx.renderer.render(ctx.scene, ctx.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

- [ ] **Step 4: 人工驗證**

Run: `npm run dev`

預期：藍色漸層天空，灰色方塊持續向 −Z 等速飛行，相機跟隨。**移動必須平滑無抖動**——規律性抖動代表插值未生效或 alpha 計算錯誤。

- [ ] **Step 5: 確認型別檢查通過**

Run: `npx tsc --noEmit`
預期：無輸出。

- [ ] **Step 6: Commit**

```bash
git add src/render/scene.ts src/render/sky.ts src/main.ts
git commit -m "feat: 場景、漸層天空與渲染插值

createScene 提供 renderer/scene/camera 與 resize 處理，
main.ts 以佔位方塊驗證固定步長迴圈與 alpha 插值。"
```

---

## Task 5：Gerstner 波浪海面與參照物

**Files:**
- Create: `src/render/ocean.ts`, `src/render/props.ts`
- Modify: `src/main.ts`
- Test: `test/unit/ocean.test.ts`

**Interfaces:**
- Consumes: `SceneContext`（Task 4）
- Produces:
  - `WAVES: readonly WaveSpec[]` — 波參數的唯一權威來源
  - `gerstnerHeight(x: number, z: number, time: number): number` — CPU 端波高，純函數
  - `createOcean(): Ocean`，`Ocean = { mesh: Mesh; update(time, centerX, centerZ): void; heightAt(x, z, time): number }`
  - `createProps(count: number, spread?: number): InstancedMesh`

**設計要點：** 波高同時存在於 GPU（頂點位移，視覺）與 CPU（`heightAt`，Task 19 的墜毀判定）。兩者公式必須一致，否則會出現「看起來在浪上、判定卻已墜毀」。因此波參數以 `WAVES` 常數定義一次，同時餵給 shader uniform 與 CPU 函數。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/ocean.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { gerstnerHeight, WAVES } from '../../src/render/ocean'

describe('gerstnerHeight', () => {
  it('波高落在所有波幅總和的範圍內', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    for (let i = 0; i < 200; i++) {
      const h = gerstnerHeight((i * 37) % 1000, (i * 53) % 1000, i * 0.1)
      expect(h).toBeLessThanOrEqual(maxAmp + 1e-6)
      expect(h).toBeGreaterThanOrEqual(-maxAmp - 1e-6)
    }
  })

  it('相同輸入回傳相同結果（純函數）', () => {
    expect(gerstnerHeight(123, 456, 7.5)).toBe(gerstnerHeight(123, 456, 7.5))
  })

  it('會隨時間變化', () => {
    expect(gerstnerHeight(100, 100, 0)).not.toBeCloseTo(gerstnerHeight(100, 100, 3.7), 6)
  })

  it('波參數非空且振幅為正', () => {
    expect(WAVES.length).toBeGreaterThan(0)
    for (const w of WAVES) expect(w.amplitude).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/ocean.test.ts`
預期：FAIL，找不到模組 `../../src/render/ocean`。

- [ ] **Step 3: 實作 src/render/ocean.ts**

```ts
import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector2, type Shader } from 'three'

export interface WaveSpec {
  dirX: number
  dirZ: number
  amplitude: number
  /** 波長，公尺 */
  wavelength: number
  /** 相位速度，m/s */
  speed: number
}

/** 波參數的唯一權威來源：同時餵給 shader uniform 與 CPU 的 gerstnerHeight。 */
export const WAVES: readonly WaveSpec[] = [
  { dirX: 1.0, dirZ: 0.15, amplitude: 1.1, wavelength: 140, speed: 9.0 },
  { dirX: 0.55, dirZ: -0.84, amplitude: 0.7, wavelength: 78, speed: 7.2 },
  { dirX: -0.3, dirZ: 0.95, amplitude: 0.35, wavelength: 31, speed: 5.1 },
]

/**
 * CPU 端波高。必須與 shader 的頂點位移公式完全一致，
 * 否則會出現視覺與碰撞判定不一致。
 */
export function gerstnerHeight(x: number, z: number, time: number): number {
  let h = 0
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.wavelength
    h += w.amplitude * Math.sin(k * (w.dirX * x + w.dirZ * z) - w.speed * k * time)
  }
  return h
}

const OCEAN_SIZE = 10000
const OCEAN_SEGMENTS = 192

export interface Ocean {
  mesh: Mesh
  update(time: number, centerX: number, centerZ: number): void
  heightAt(x: number, z: number, time: number): number
}

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

  const material = new MeshStandardMaterial({
    color: 0x1d3f5c,
    roughness: 0.72,
    metalness: 0.05,
    flatShading: true,
  })

  const uTime = { value: 0 }
  const uOrigin = { value: new Vector2(0, 0) }

  material.onBeforeCompile = (shader: Shader) => {
    shader.uniforms.uTime = uTime
    shader.uniforms.uOrigin = uOrigin
    shader.uniforms.uWaveDir = { value: WAVES.map((w) => new Vector2(w.dirX, w.dirZ)) }
    shader.uniforms.uWaveAmp = { value: WAVES.map((w) => w.amplitude) }
    shader.uniforms.uWaveLen = { value: WAVES.map((w) => w.wavelength) }
    shader.uniforms.uWaveSpd = { value: WAVES.map((w) => w.speed) }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform vec2 uOrigin;
         uniform vec2 uWaveDir[${WAVES.length}];
         uniform float uWaveAmp[${WAVES.length}];
         uniform float uWaveLen[${WAVES.length}];
         uniform float uWaveSpd[${WAVES.length}];`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec2 worldXZ = transformed.xz + uOrigin;
         float waveH = 0.0;
         for (int i = 0; i < ${WAVES.length}; i++) {
           float k = 6.28318530718 / uWaveLen[i];
           waveH += uWaveAmp[i] * sin(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * uTime);
         }
         transformed.y += waveH;`,
      )
  }

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false // 隨玩家捲動，永遠可見

  return {
    mesh,
    update(time, centerX, centerZ) {
      uTime.value = time
      // 以網格單元對齊捲動，避免頂點在格點間滑動造成抖動
      const cell = OCEAN_SIZE / OCEAN_SEGMENTS
      const sx = Math.round(centerX / cell) * cell
      const sz = Math.round(centerZ / cell) * cell
      mesh.position.set(sx, 0, sz)
      uOrigin.value.set(sx, sz)
    },
    heightAt: gerstnerHeight,
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/ocean.test.ts`
預期：PASS，4 個測試全綠。

- [ ] **Step 5: 實作 src/render/props.ts**

```ts
import { BoxGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'

/**
 * 浮動參照物。純視覺、無碰撞，提供速度與高度的視覺錨點——
 * 無特徵海面在 700 km/h 下幾乎沒有速度感。
 */
export function createProps(count: number, spread = 9000): InstancedMesh {
  const mesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
    count,
  )
  mesh.frustumCulled = false

  const dummy = new Object3D()
  const foam = new Color(0xd8e6ef)
  const island = new Color(0x4a5f42)

  // 固定亂數種子，確保每次啟動場景一致（除錯可重現）
  let seed = 1337
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  for (let i = 0; i < count; i++) {
    const isIsland = rand() < 0.08
    const x = (rand() - 0.5) * spread * 2
    const z = (rand() - 0.5) * spread * 2
    if (isIsland) {
      const s = 60 + rand() * 220
      dummy.position.set(x, s * 0.12, z)
      dummy.scale.set(s, s * 0.3, s * (0.6 + rand() * 0.8))
      mesh.setColorAt(i, island)
    } else {
      const s = 4 + rand() * 10
      dummy.position.set(x, 0.4, z)
      dummy.scale.set(s, 0.8, s * 0.5)
      mesh.setColorAt(i, foam)
    }
    dummy.rotation.y = rand() * Math.PI * 2
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  return mesh
}
```

- [ ] **Step 6: 在 main.ts 接上海面與參照物**

於 `createScene` 之後插入：

```ts
import { createOcean } from './render/ocean'
import { createProps } from './render/props'

const ocean = createOcean()
ctx.scene.add(ocean.mesh)
ctx.scene.add(createProps(600))
let elapsed = 0
```

於 `frame` 內、`renderer.render` 之前插入：

```ts
elapsed += frameSeconds
ocean.update(elapsed, curr.x, curr.z)
```

- [ ] **Step 7: 人工驗證**

Run: `npm run dev`

預期：海面有起伏波浪並隨時間流動；散布白色浪花與綠色小島；方塊飛行時海面持續捲動且**接縫處無跳動**（跳動代表 `sx/sz` 對齊邏輯有誤）。

- [ ] **Step 8: Commit**

```bash
git add src/render/ocean.ts src/render/props.ts src/main.ts test/unit/ocean.test.ts
git commit -m "feat: Gerstner 波浪海面與浮動參照物

波參數以 WAVES 為單一權威來源，同時供 shader 頂點位移與
CPU 端 gerstnerHeight（碰撞判定）使用，確保視覺與判定一致。
參照物使用 InstancedMesh 與固定亂數種子。"
```

---

## Task 6：效能覆蓋層與物理步微基準

**Files:**
- Create: `src/core/perf.ts`, `bench/physics.bench.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `FixedStepAccumulator`（Task 3）、`SceneContext`（Task 4）
- Produces: `createPerfOverlay(renderer: WebGLRenderer): PerfOverlay`，
  `PerfOverlay = { begin(): void; beginPhysics(): void; endPhysics(): void; endFrame(substeps: number): void; toggle(): void; readonly visible: boolean }`

**驗收要求（spec §3.10）：** 微基準必須輸出單一物理步實測耗時。**若 > 20 µs/步，代表熱路徑存在配置行為造成 GC 壓力，必須先修正才能繼續後續任務。** 本任務先以佔位負載建立基準框架，Task 12 完成 `dynamics.step` 後替換為真實負載。

- [ ] **Step 1: 實作 src/core/perf.ts**

```ts
import type { WebGLRenderer } from 'three'

export interface PerfOverlay {
  begin(): void
  beginPhysics(): void
  endPhysics(): void
  endFrame(substeps: number): void
  toggle(): void
  readonly visible: boolean
}

const SAMPLE_WINDOW = 60

export function createPerfOverlay(renderer: WebGLRenderer): PerfOverlay {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:100',
    'font:11px/1.45 ui-monospace,Consolas,monospace',
    'color:#9fe8b0', 'background:rgba(0,0,0,.55)',
    'padding:6px 9px', 'border-radius:4px',
    'white-space:pre', 'pointer-events:none',
  ].join(';')
  document.body.appendChild(el)

  let visible = true
  const frameTimes: number[] = []
  const physicsTimes: number[] = []
  let frameStart = 0
  let physicsStart = 0
  let physicsAccum = 0

  const push = (arr: number[], v: number) => {
    arr.push(v)
    if (arr.length > SAMPLE_WINDOW) arr.shift()
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

  const setVisible = (v: boolean) => {
    visible = v
    el.style.display = v ? 'block' : 'none'
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault()
      setVisible(!visible)
    }
  })

  return {
    get visible() {
      return visible
    },
    toggle: () => setVisible(!visible),
    begin() {
      frameStart = performance.now()
      physicsAccum = 0
    },
    beginPhysics() {
      physicsStart = performance.now()
    },
    endPhysics() {
      physicsAccum += performance.now() - physicsStart
    },
    endFrame(substeps: number) {
      push(frameTimes, performance.now() - frameStart)
      push(physicsTimes, physicsAccum)
      if (!visible) return
      const f = avg(frameTimes)
      const p = avg(physicsTimes)
      const perStepUs = substeps > 0 ? (p / substeps) * 1000 : 0
      const info = renderer.info
      el.textContent =
        `FPS       ${(1000 / Math.max(f, 0.001)).toFixed(0)}\n` +
        `frame     ${f.toFixed(2)} ms\n` +
        `physics   ${p.toFixed(3)} ms  (${substeps} 子步)\n` +
        `per step  ${perStepUs.toFixed(1)} us\n` +
        `draw call ${info.render.calls}\n` +
        `triangles ${info.render.triangles}`
    },
  }
}
```

- [ ] **Step 2: 在 main.ts 接上覆蓋層**

於 `createScene` 之後插入：

```ts
import { createPerfOverlay } from './core/perf'
const perf = createPerfOverlay(ctx.renderer)
```

改寫 `frame` 主體為：

```ts
function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now
  perf.begin()

  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    prev.copy(curr)
    curr.addScaledVector(velocity, dt)
    perf.endPhysics()
  })

  placeholder.position.lerpVectors(prev, curr, alpha)
  ctx.camera.position.set(curr.x, curr.y + 12, curr.z + 45)
  ctx.camera.lookAt(curr)

  elapsed += frameSeconds
  ocean.update(elapsed, curr.x, curr.z)

  ctx.renderer.render(ctx.scene, ctx.camera)
  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}
```

- [ ] **Step 3: 建立微基準 bench/physics.bench.ts**

```ts
import { bench, describe } from 'vitest'
import { Vector3, Quaternion } from 'three'
import { makeScratch } from '../src/core/pool'

/**
 * 物理步微基準。
 *
 * 驗收門檻（spec §3.10）：單步耗時必須 < 20 µs。
 * 超標代表熱路徑存在配置行為造成 GC 壓力，必須先修正。
 *
 * Task 12 完成 dynamics.step 後，此基準會替換為真實負載。
 */
describe('physics step', () => {
  const S = makeScratch(6, 2)
  const position = new Vector3(0, 5000, 0)
  const velocity = new Vector3(0, 0, -160)
  const orientation = new Quaternion()
  const omega = new Vector3(0.1, 0.05, 0.2)
  const dt = 1 / 240

  bench('佔位負載：向量與四元數運算', () => {
    const accel = S.v[0]!.set(0, -9.80665, 0)
    const drag = S.v[1]!.copy(velocity).applyQuaternion(orientation).multiplyScalar(0.001)
    accel.add(drag)
    velocity.addScaledVector(accel, dt)
    position.addScaledVector(velocity, dt)
    const dq = S.q[0]!.set(omega.x * dt * 0.5, omega.y * dt * 0.5, omega.z * dt * 0.5, 1)
    orientation.multiply(dq).normalize()
  })
})
```

- [ ] **Step 4: 執行基準並記錄數字**

Run: `npm run bench`

預期：輸出每秒操作數與平均耗時。換算為 µs/次並記錄於 commit 訊息。佔位負載此時應約 0.1–0.5 µs，遠低於 20 µs 門檻。

- [ ] **Step 5: 人工驗證覆蓋層**

Run: `npm run dev`

預期：左上角顯示 FPS / frame / physics / per step / draw call / triangles；按 F3 可切換顯示。60 fps 下「子步」欄應顯示 4。

- [ ] **Step 6: Commit**

```bash
git add src/core/perf.ts bench/physics.bench.ts src/main.ts
git commit -m "feat: 效能覆蓋層與物理步微基準

F3 切換的即時效能面板（FPS/frame/物理步耗時/draw call/三角形），
以及 vitest bench 微基準，驗收門檻 20 µs/步。"
```

---

**M0 完成檢查點：** 此時應有一個以 240 Hz 物理步驅動、60 fps 渲染、帶波浪海面與參照物的場景；佔位方塊平滑等速飛行；效能覆蓋層顯示所有關鍵數字；微基準已建立門檻。所有測試綠燈，`npx tsc --noEmit` 無錯誤。

---

# Phase M1-A：物理核心

## Task 7：物理型別與 ISA 大氣

**Files:**
- Create: `src/physics/types.ts`, `src/physics/atmosphere.ts`
- Test: `test/unit/atmosphere.test.ts`

**Interfaces:**
- Consumes: `G0`（`src/core/math.ts`，Task 1）
- Produces:
  - `FlightState = { position: Vector3; velocity: Vector3; orientation: Quaternion; angularVelocity: Vector3 }`
  - `Controls = { aileron: number; elevator: number; rudder: number; throttle: number }`
  - `AirData = { density: number; pressure: number; temperature: number; soundSpeed: number; sigma: number }`
  - `AeroState = { tas: number; alpha: number; beta: number; qbar: number; mach: number }`
  - `ForceMoment = { force: Vector3; moment: Vector3 }`
  - `atmosphere(altitude: number, out: AirData): AirData` — 寫入 `out` 並回傳，零配置
  - `RHO0: number`（1.225）

- [ ] **Step 1: 寫失敗的測試**

`test/unit/atmosphere.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { atmosphere, RHO0 } from '../../src/physics/atmosphere'
import type { AirData } from '../../src/physics/types'

const air = (): AirData => ({
  density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0,
})

describe('atmosphere', () => {
  it('海平面符合 ISA 標準值', () => {
    const a = atmosphere(0, air())
    expect(a.temperature).toBeCloseTo(288.15, 6)
    expect(a.pressure).toBeCloseTo(101325, 0)
    expect(a.density).toBeCloseTo(1.225, 3)
    expect(a.soundSpeed).toBeCloseTo(340.29, 1)
    expect(a.sigma).toBeCloseTo(1.0, 6)
  })

  it('5,000 m 密度符合 ISA 表', () => {
    const a = atmosphere(5000, air())
    expect(a.temperature).toBeCloseTo(255.65, 3)
    expect(a.density).toBeCloseTo(0.7361, 3)
  })

  it('7,600 m（P-51 臨界高度）密度符合 ISA 表', () => {
    const a = atmosphere(7600, air())
    expect(a.density).toBeCloseTo(0.5503, 3)
  })

  it('對流層頂 11,000 m 溫度為 216.65 K', () => {
    const a = atmosphere(11000, air())
    expect(a.temperature).toBeCloseTo(216.65, 3)
    expect(a.pressure).toBeCloseTo(22632, -1)
  })

  it('平流層 12,000 m 溫度恆定、壓力續降', () => {
    const a = atmosphere(12000, air())
    expect(a.temperature).toBeCloseTo(216.65, 6)
    expect(a.density).toBeCloseTo(0.3108, 3)
  })

  it('密度隨高度單調遞減', () => {
    let prev = Infinity
    for (let h = 0; h <= 15000; h += 250) {
      const d = atmosphere(h, air()).density
      expect(d).toBeLessThan(prev)
      prev = d
    }
  })

  it('負高度不會產生 NaN', () => {
    const a = atmosphere(-50, air())
    expect(Number.isFinite(a.density)).toBe(true)
    expect(a.density).toBeGreaterThan(1.225)
  })

  it('寫入傳入的 out 物件並回傳同一參考（零配置）', () => {
    const out = air()
    expect(atmosphere(3000, out)).toBe(out)
  })

  it('sigma 為密度比', () => {
    const a = atmosphere(6000, air())
    expect(a.sigma).toBeCloseTo(a.density / RHO0, 12)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/atmosphere.test.ts`
預期：FAIL，找不到模組 `../../src/physics/atmosphere`。

- [ ] **Step 3: 實作 src/physics/types.ts**

```ts
import type { Quaternion, Vector3 } from 'three'

/** 飛機的完整運動狀態。position/velocity 為世界座標，angularVelocity 為機體座標。 */
export interface FlightState {
  position: Vector3
  velocity: Vector3
  /** 機體 → 世界 */
  orientation: Quaternion
  /** 機體座標，rad/s */
  angularVelocity: Vector3
}

/** 舵面與油門指令。舵面 −1..1，油門 0..1.1（>1 為 WEP）。 */
export interface Controls {
  aileron: number
  elevator: number
  rudder: number
  throttle: number
}

export interface AirData {
  /** kg/m³ */
  density: number
  /** Pa */
  pressure: number
  /** K */
  temperature: number
  /** m/s */
  soundSpeed: number
  /** 密度比 ρ/ρ₀ */
  sigma: number
}

export interface AeroState {
  /** 真空速，m/s */
  tas: number
  /** 迎角，rad */
  alpha: number
  /** 側滑角，rad */
  beta: number
  /** 動壓，Pa */
  qbar: number
  mach: number
}

/** 機體座標下的力與力矩。 */
export interface ForceMoment {
  force: Vector3
  moment: Vector3
}
```

- [ ] **Step 4: 實作 src/physics/atmosphere.ts**

```ts
import { G0 } from '../core/math'
import type { AirData } from './types'

export const T0 = 288.15
export const P0 = 101325
export const RHO0 = 1.225
const LAPSE = 0.0065
const R = 287.05
const GAMMA = 1.4
const H_TROP = 11000
const T_TROP = 216.65
const P_TROP = 22632.06

/**
 * ISA 標準大氣。純函數：寫入 out 並回傳，熱路徑零配置。
 *
 * 對流層 (h < 11 km) 使用線性溫度遞減；平流層使用等溫指數律。
 * P-51D 升限 12.8 km 會進入平流層，因此兩段都必須實作。
 */
export function atmosphere(altitude: number, out: AirData): AirData {
  let temperature: number
  let pressure: number

  if (altitude < H_TROP) {
    temperature = T0 - LAPSE * altitude
    pressure = P0 * Math.pow(temperature / T0, G0 / (LAPSE * R))
  } else {
    temperature = T_TROP
    pressure = P_TROP * Math.exp((-G0 * (altitude - H_TROP)) / (R * T_TROP))
  }

  const density = pressure / (R * temperature)

  out.temperature = temperature
  out.pressure = pressure
  out.density = density
  out.soundSpeed = Math.sqrt(GAMMA * R * temperature)
  out.sigma = density / RHO0
  return out
}
```

指數 `G0 / (LAPSE * R)` = 9.80665 / (0.0065 × 287.05) = 5.25588，即標準的 5.2559，此處以常數推導而非硬編碼。

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/unit/atmosphere.test.ts`
預期：PASS，9 個測試全綠。

- [ ] **Step 6: Commit**

```bash
git add src/physics/types.ts src/physics/atmosphere.ts test/unit/atmosphere.test.ts
git commit -m "feat: 物理型別與 ISA 標準大氣

atmosphere 為零配置純函數，涵蓋對流層與平流層兩段
（P-51D 升限 12.8 km 會進入平流層）。
測試對照 ISA 表驗證 0/5000/7600/11000/12000 m。"
```

---

## Task 8：機體軸 ↔ 標準氣動軸轉換

**Files:**
- Create: `src/physics/axes.ts`
- Test: `test/unit/axes.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `StdVec = { x: number; y: number; z: number }` — 標準氣動軸分量（x 前、y 右、z 下）
  - `bodyToStd(v: Vector3, out: StdVec): StdVec`
  - `stdToBody(sx: number, sy: number, sz: number, out: Vector3): Vector3`
  - `alphaFrom(std: StdVec): number`
  - `betaFrom(std: StdVec, tas: number): number`

**為什麼這值得獨立一個任務：** 專案的機體軸（X 右、Y 上、Z 尾）與空氣動力學教科書的標準軸（X 前、Y 右、Z 下）不同。所有 CL/CD/Cm 公式與導數都以標準軸定義，混用是這類專案最大宗的 bug 來源，且症狀往往是「飛機行為詭異但看不出哪裡錯」。把轉換集中在單一模組並完整測試，之後所有物理模組只呼叫這裡。

**軸對應關係（推導依據）：**

```
Xs (前) = −Zb        Ys (右) = +Xb        Zs (下) = −Yb

向量分量  std.x = −b.z    std.y = +b.x    std.z = −b.y
逆轉換    b.x = std.y     b.y = −std.z    b.z = −std.x

角速度同為向量，用同一組轉換：
  p (滾轉, 繞 Xs) = −ω.z
  q (俯仰, 繞 Ys) = +ω.x
  r (偏航, 繞 Zs) = −ω.y

力矩 (l, m, n) 繞 (Xs, Ys, Zs)，轉回機體：
  M.x = m      M.y = −n      M.z = −l
  （與 stdToBody 相同，因此共用同一函數）
```

- [ ] **Step 1: 寫失敗的測試**

`test/unit/axes.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { bodyToStd, stdToBody, alphaFrom, betaFrom, type StdVec } from '../../src/physics/axes'

const std = (): StdVec => ({ x: 0, y: 0, z: 0 })

describe('axes', () => {
  it('機首方向（機體 −Z）對應標準軸前方 +X', () => {
    const s = bodyToStd(new Vector3(0, 0, -1), std())
    expect(s.x).toBeCloseTo(1, 12)
    expect(s.y).toBeCloseTo(0, 12)
    expect(s.z).toBeCloseTo(0, 12)
  })

  it('右翼方向（機體 +X）對應標準軸右方 +Y', () => {
    const s = bodyToStd(new Vector3(1, 0, 0), std())
    expect(s.x).toBeCloseTo(0, 12)
    expect(s.y).toBeCloseTo(1, 12)
    expect(s.z).toBeCloseTo(0, 12)
  })

  it('上方（機體 +Y）對應標準軸下方 −Z', () => {
    const s = bodyToStd(new Vector3(0, 1, 0), std())
    expect(s.z).toBeCloseTo(-1, 12)
  })

  it('往返轉換還原原向量', () => {
    const original = new Vector3(3, -7, 11)
    const s = bodyToStd(original, std())
    const back = stdToBody(s.x, s.y, s.z, new Vector3())
    expect(back.x).toBeCloseTo(3, 12)
    expect(back.y).toBeCloseTo(-7, 12)
    expect(back.z).toBeCloseTo(11, 12)
  })

  it('角速度轉換：機體 −Z 方向的角速度為正滾轉率 p', () => {
    const s = bodyToStd(new Vector3(0, 0, -2), std())
    expect(s.x).toBeCloseTo(2, 12) // p = −ω.z
  })

  it('正迎角：相對氣流從下方來（機體速度含 −Y 分量）', () => {
    const s = bodyToStd(new Vector3(0, -10, -100), std())
    expect(alphaFrom(s)).toBeCloseTo(Math.atan2(10, 100), 12)
    expect(alphaFrom(s)).toBeGreaterThan(0)
  })

  it('零迎角：速度純沿機首方向', () => {
    const s = bodyToStd(new Vector3(0, 0, -150), std())
    expect(alphaFrom(s)).toBeCloseTo(0, 12)
  })

  it('正側滑：相對氣流從右方來（機體速度含 +X 分量）', () => {
    const v = new Vector3(10, 0, -100)
    const s = bodyToStd(v, std())
    expect(betaFrom(s, v.length())).toBeCloseTo(Math.asin(10 / v.length()), 12)
    expect(betaFrom(s, v.length())).toBeGreaterThan(0)
  })

  it('tas 為 0 時 betaFrom 回傳 0 而非 NaN', () => {
    expect(betaFrom({ x: 0, y: 0, z: 0 }, 0)).toBe(0)
  })

  it('betaFrom 對超出 asin 定義域的輸入夾制', () => {
    expect(Number.isFinite(betaFrom({ x: 0, y: 200, z: 0 }, 100))).toBe(true)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const out = std()
    expect(bodyToStd(new Vector3(1, 2, 3), out)).toBe(out)
    const bv = new Vector3()
    expect(stdToBody(1, 2, 3, bv)).toBe(bv)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/axes.test.ts`
預期：FAIL，找不到模組 `../../src/physics/axes`。

- [ ] **Step 3: 實作 src/physics/axes.ts**

```ts
import type { Vector3 } from 'three'
import { clamp } from '../core/math'

/**
 * 標準氣動軸分量：x 向前、y 向右、z 向下。
 * 所有 CL/CD/Cm 公式與穩定導數皆以此軸系定義。
 */
export interface StdVec {
  x: number
  y: number
  z: number
}

/**
 * 機體軸 → 標準氣動軸。
 *
 * 機體軸：X 右翼、Y 座艙上方、Z 機尾（機首 = −Z）
 * 標準軸：X 前、Y 右、Z 下
 *   Xs = −Zb    Ys = +Xb    Zs = −Yb
 *
 * 角速度為向量，適用同一轉換：p = −ω.z、q = ω.x、r = −ω.y
 */
export function bodyToStd(v: Vector3, out: StdVec): StdVec {
  out.x = -v.z
  out.y = v.x
  out.z = -v.y
  return out
}

/**
 * 標準氣動軸 → 機體軸。
 * 力 (X, Y, Z) 與力矩 (l, m, n) 共用此轉換，因為兩者都是向量。
 */
export function stdToBody(sx: number, sy: number, sz: number, out: Vector3): Vector3 {
  out.x = sy
  out.y = -sz
  out.z = -sx
  return out
}

/** 迎角，rad。正值代表相對氣流從下方來（機首上仰於飛行路徑）。 */
export function alphaFrom(std: StdVec): number {
  return Math.atan2(std.z, std.x)
}

/** 側滑角，rad。正值代表相對氣流從右方來。 */
export function betaFrom(std: StdVec, tas: number): number {
  if (tas <= 1e-6) return 0
  return Math.asin(clamp(std.y / tas, -1, 1))
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/axes.test.ts`
預期：PASS，11 個測試全綠。

- [ ] **Step 5: Commit**

```bash
git add src/physics/axes.ts test/unit/axes.test.ts
git commit -m "feat: 機體軸與標準氣動軸轉換

專案機體軸（X 右/Y 上/Z 尾）與氣動教科書標準軸（X 前/Y 右/Z 下）
不同，混用是此類專案最大宗的 bug 來源。集中於單一模組並完整測試，
含往返一致性、角速度轉換、迎角與側滑角符號驗證。"
```

---

## Task 9：機種資料型別與 P-51D / Bf 109 G-6 參數

**Files:**
- Create: `src/specs/types.ts`, `src/specs/p51d.ts`, `src/specs/bf109g6.ts`
- Test: `test/unit/specs.test.ts`

**Interfaces:**
- Consumes: `DEG`（`src/core/math.ts`）
- Produces:
  - `AircraftSpec` 介面（完整結構見 Step 1）
  - `HistoricalReference` 介面
  - `P51D: AircraftSpec`、`P51D_HISTORICAL: HistoricalReference`
  - `BF109G6: AircraftSpec`、`BF109G6_HISTORICAL: HistoricalReference`
  - `derivedClMax(spec: AircraftSpec, slatsDeployed: boolean): number`

**Spec 修訂 1 與 4 於此落實：** `CL_max` 不是輸入參數，而是由 `clAlpha × (alphaCrit − alphaZero)` 推導；縫翼只有 `slatAlphaBonus` 一個參數，CL_max 加成為推導結果。

**油門與 WEP 的約定：** 各機種登錄的引擎功率為 **WEP（緊急戰鬥功率）** 數值，對應 `throttle = 1.1`。`enginePower` 內部以 `throttle / 1.1` 換算功率比例，因此 `throttle = 1.0`（軍用功率）約為 WEP 的 91%。L2 極速與爬升率測試必須使用 `throttle = 1.1`。

- [ ] **Step 1: 實作 src/specs/types.ts**

```ts
export interface AircraftSpec {
  id: string
  name: string
  faction: 'allied' | 'axis'

  /** 戰鬥重量，kg */
  mass: number
  /** 機體軸慣量，kg·m²。pitch = Ixx、yaw = Iyy、roll = Izz */
  inertia: { pitch: number; yaw: number; roll: number }

  wing: {
    /** m² */
    area: number
    /** m */
    span: number
    /** 平均氣動弦長，m */
    chord: number
    /** Oswald 效率因子 */
    oswald: number
  }

  lift: {
    /** 升力線斜率，/rad */
    clAlpha: number
    /** 零升迎角，rad（有彎度翼型為負） */
    alphaZero: number
    /** 失速迎角，rad */
    alphaCrit: number
    /** 失速後 CL 崩塌的過渡寬度，rad */
    stallBlend: number
    /** 崩塌終點的 CL 相對於 CL_max 的比例 */
    postStallFactor: number
    /** 前緣縫翼展開時 alphaCrit 的增量，rad。無縫翼為 0 */
    slatAlphaBonus: number
    /** 縫翼展開迎角，rad */
    slatDeployAlpha: number
    /** 縫翼收回迎角，rad（小於展開值，形成遲滯） */
    slatRetractAlpha: number
  }

  drag: {
    /** 零升阻力係數 */
    cd0: number
    /** 側滑阻力係數，/rad² */
    cdBeta: number
    /** 臨界馬赫數 */
    machCrit: number
    /** 超過臨界馬赫後 cd0 的上升強度 */
    machDragFactor: number
  }

  side: {
    /** 側力係數，/rad。負值代表正側滑產生向左的力 */
    cyBeta: number
  }

  /** 力矩係數與穩定導數，全部以標準氣動軸定義 */
  moments: {
    cm0: number
    cmAlpha: number
    cmQ: number
    cmDe: number
    clBeta: number
    clP: number
    /** 全偏轉（δa = 1）時的滾轉力矩係數 */
    clDa: number
    cnBeta: number
    cnR: number
    cnDr: number
  }
  // 操縱導數符號約定（與教科書的 δ 正負相反，此處以「玩家意圖」為正）：
  //   aileron  +1 = 向右滾轉  → clDa 為正
  //   elevator +1 = 機首上仰  → cmDe 為正
  //   rudder   +1 = 機首右偏  → cnDr 為正

  /** 高速舵面變重：δ_eff = δ × min(1, (qRef/q)^k) */
  controlStiffening: {
    /** 參考動壓，Pa。低於此值舵面權限為滿 */
    qRef: number
    aileronK: number
    elevatorK: number
    rudderK: number
  }

  engine: {
    /** 增壓器檔位。功率為 WEP 值（throttle = 1.1），單位 W */
    gears: readonly { powerSeaLevel: number; powerCritical: number; altCritical: number }[]
    /** 進氣衝壓恢復效率，0..1。見 Spec 修訂 2 */
    ramEfficiency: number
  }

  prop: {
    /** m */
    diameter: number
    etaMax: number
    /** 螺旋槳效率曲線的特徵速度，m/s */
    vRef: number
    /** 靜推力相對於動量理論理想值的比例 */
    figureOfMerit: number
  }

  limits: {
    gPositive: number
    gNegative: number
    /** 不可超越速度，m/s IAS */
    vne: number
  }
}

/** 史實性能參考值，供 L2 測試斷言。全部為 SI 單位。 */
export interface HistoricalReference {
  /** 臨界高度的極速 */
  vmaxAtCritical: { speed: number; altitude: number }
  /** 海平面極速，m/s */
  vmaxSeaLevel: number
  /** 海平面爬升率，m/s */
  climbRateSeaLevel: number
  /** 乾淨構型失速速度，m/s */
  stallSpeed: number
  /** 實用升限，m */
  serviceCeiling: number
  /** 史實 CL_max，供推導值的合理性檢查（±8%） */
  clMax: number
}

/**
 * 推導 CL_max。見 Spec 修訂 1：CL_max 不是獨立參數，
 * 而是由升力線斜率與失速迎角推導，確保 CL 曲線在失速點連續。
 */
export function derivedClMax(spec: AircraftSpec, slatsDeployed: boolean): number {
  const alphaCrit = spec.lift.alphaCrit + (slatsDeployed ? spec.lift.slatAlphaBonus : 0)
  return spec.lift.clAlpha * (alphaCrit - spec.lift.alphaZero)
}
```

- [ ] **Step 2: 實作 src/specs/p51d.ts**

```ts
import { DEG } from '../core/math'
import type { AircraftSpec, HistoricalReference } from './types'

const HP = 745.7
const KMH = 1 / 3.6

export const P51D: AircraftSpec = {
  id: 'p51d',
  name: 'P-51D Mustang',
  faction: 'allied',

  mass: 4300,
  inertia: { pitch: 11000, yaw: 20000, roll: 8800 },

  wing: { area: 21.83, span: 11.28, chord: 1.98, oswald: 0.75 },

  lift: {
    clAlpha: 4.4,
    alphaZero: -2.5 * DEG,
    alphaCrit: 15.5 * DEG,
    stallBlend: 8 * DEG,
    postStallFactor: 0.6,
    slatAlphaBonus: 0,
    slatDeployAlpha: Infinity, // 無縫翼，永不展開
    slatRetractAlpha: Infinity,
  },

  drag: { cd0: 0.0163, cdBeta: 0.6, machCrit: 0.72, machDragFactor: 60 },

  side: { cyBeta: -0.7 },

  moments: {
    cm0: 0.02, cmAlpha: -0.8, cmQ: -12, cmDe: 1.2,
    clBeta: -0.08, clP: -0.45, clDa: 0.033,
    cnBeta: 0.1, cnR: -0.12, cnDr: 0.07,
  },

  // qRef 對應 480 km/h 海平面動壓，該速度下副翼權限為滿（滾轉率約 100°/s）
  controlStiffening: { qRef: 10884, aileronK: 0.35, elevatorK: 0.25, rudderK: 0.25 },

  engine: {
    // V-1650-7 二級二速增壓，67"Hg WEP
    gears: [
      { powerSeaLevel: 1490 * HP, powerCritical: 1720 * HP, altCritical: 1900 },
      { powerSeaLevel: 1290 * HP, powerCritical: 1370 * HP, altCritical: 5900 },
    ],
    ramEfficiency: 0.8,
  },

  prop: { diameter: 3.4, etaMax: 0.85, vRef: 55, figureOfMerit: 0.7 },

  limits: { gPositive: 8, gNegative: -4, vne: 810 * KMH },
}

export const P51D_HISTORICAL: HistoricalReference = {
  vmaxAtCritical: { speed: 703 * KMH, altitude: 7600 },
  vmaxSeaLevel: 595 * KMH,
  climbRateSeaLevel: 1060 / 60,
  stallSpeed: 160 * KMH,
  serviceCeiling: 12770,
  clMax: 1.45,
}
```

- [ ] **Step 3: 實作 src/specs/bf109g6.ts**

```ts
import { DEG } from '../core/math'
import type { AircraftSpec, HistoricalReference } from './types'

const PS = 735.5
const KMH = 1 / 3.6

export const BF109G6: AircraftSpec = {
  id: 'bf109g6',
  name: 'Bf 109 G-6',
  faction: 'axis',

  mass: 3150,
  inertia: { pitch: 6200, yaw: 10500, roll: 4200 },

  wing: { area: 16.05, span: 9.92, chord: 1.68, oswald: 0.78 },

  lift: {
    clAlpha: 4.45,
    alphaZero: -2.0 * DEG,
    alphaCrit: 15.5 * DEG,
    // 縫翼展開後失速較溫和，過渡寬度大於 P-51
    stallBlend: 10 * DEG,
    postStallFactor: 0.65,
    slatAlphaBonus: 2.5 * DEG,
    slatDeployAlpha: 8 * DEG,
    slatRetractAlpha: 6 * DEG,
  },

  drag: { cd0: 0.023, cdBeta: 0.7, machCrit: 0.68, machDragFactor: 60 },

  side: { cyBeta: -0.68 },

  moments: {
    cm0: 0.02, cmAlpha: -0.75, cmQ: -10, cmDe: 1.15,
    clBeta: -0.075, clP: -0.45, clDa: 0.028,
    cnBeta: 0.09, cnR: -0.1, cnDr: 0.065,
  },

  // qRef 對應 400 km/h 海平面動壓。aileronK 遠大於 P-51，
  // 使 650 km/h 時滾轉率衰減至約 30°/s——109 的關鍵弱點。
  controlStiffening: { qRef: 7560, aileronK: 1.5, elevatorK: 0.6, rudderK: 0.4 },

  engine: {
    // DB 605A 單級無段變速增壓
    gears: [{ powerSeaLevel: 1475 * PS, powerCritical: 1355 * PS, altCritical: 5700 }],
    ramEfficiency: 0.8,
  },

  prop: { diameter: 3.0, etaMax: 0.83, vRef: 52, figureOfMerit: 0.7 },

  limits: { gPositive: 7.5, gNegative: -3.5, vne: 750 * KMH },
}

export const BF109G6_HISTORICAL: HistoricalReference = {
  vmaxAtCritical: { speed: 640 * KMH, altitude: 6300 },
  vmaxSeaLevel: 530 * KMH,
  climbRateSeaLevel: 1150 / 60,
  stallSpeed: 170 * KMH,
  serviceCeiling: 11550,
  clMax: 1.4,
}
```

- [ ] **Step 4: 寫測試**

`test/unit/specs.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { derivedClMax } from '../../src/specs/types'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'

const CASES = [
  { spec: P51D, hist: P51D_HISTORICAL },
  { spec: BF109G6, hist: BF109G6_HISTORICAL },
]

describe('機種資料', () => {
  for (const { spec, hist } of CASES) {
    describe(spec.name, () => {
      it('推導的 CL_max 落在史實值 ±8% 內', () => {
        const cl = derivedClMax(spec, false)
        expect(cl).toBeGreaterThan(hist.clMax * 0.92)
        expect(cl).toBeLessThan(hist.clMax * 1.08)
      })

      it('展弦比落在二戰戰鬥機合理範圍', () => {
        const ar = (spec.wing.span * spec.wing.span) / spec.wing.area
        expect(ar).toBeGreaterThan(4)
        expect(ar).toBeLessThan(8)
      })

      it('阻尼導數符號正確（阻尼必為負）', () => {
        expect(spec.moments.clP).toBeLessThan(0)
        expect(spec.moments.cmQ).toBeLessThan(0)
        expect(spec.moments.cnR).toBeLessThan(0)
      })

      it('靜穩定性符號正確', () => {
        expect(spec.moments.cmAlpha).toBeLessThan(0) // 縱向靜穩定
        expect(spec.moments.cnBeta).toBeGreaterThan(0) // 風標穩定
        expect(spec.moments.clBeta).toBeLessThan(0) // 上反角效應
      })

      it('操縱導數符合本專案約定（正舵面指令 → 正力矩）', () => {
        expect(spec.moments.clDa).toBeGreaterThan(0)
        expect(spec.moments.cmDe).toBeGreaterThan(0)
        expect(spec.moments.cnDr).toBeGreaterThan(0)
      })

      it('增壓器檔位的臨界高度遞增', () => {
        const alts = spec.engine.gears.map((g) => g.altCritical)
        for (let i = 1; i < alts.length; i++) {
          expect(alts[i]!).toBeGreaterThan(alts[i - 1]!)
        }
      })

      it('過載限制符號正確', () => {
        expect(spec.limits.gPositive).toBeGreaterThan(0)
        expect(spec.limits.gNegative).toBeLessThan(0)
      })
    })
  }

  it('Bf 109 縫翼展開後 CL_max 顯著提高', () => {
    const clean = derivedClMax(BF109G6, false)
    const slats = derivedClMax(BF109G6, true)
    expect(slats).toBeGreaterThan(clean * 1.1)
    expect(slats).toBeCloseTo(1.55, 1) // 史實縫翼展開值
  })

  it('P-51 無縫翼，展開與否 CL_max 相同', () => {
    expect(derivedClMax(P51D, true)).toBe(derivedClMax(P51D, false))
  })

  it('P-51 的 cd0 明顯低於 Bf 109（層流翼）', () => {
    expect(P51D.drag.cd0).toBeLessThan(BF109G6.drag.cd0 * 0.8)
  })

  it('Bf 109 的副翼高速衰減指數遠大於 P-51', () => {
    expect(BF109G6.controlStiffening.aileronK).toBeGreaterThan(
      P51D.controlStiffening.aileronK * 3,
    )
  })
})
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/unit/specs.test.ts`
預期：PASS。若「推導的 CL_max 落在史實值 ±8% 內」失敗，調整 `alphaCrit` 而非直接寫死 CL_max——這是 Spec 修訂 1 的核心約束。

- [ ] **Step 6: Commit**

```bash
git add src/specs test/unit/specs.test.ts
git commit -m "feat: 機種資料型別與 P-51D / Bf 109 G-6 參數

CL_max 改為由 clAlpha、alphaZero、alphaCrit 推導（Spec 修訂 1），
縫翼只保留 slatAlphaBonus 單一參數（Spec 修訂 4）。
引擎功率登錄為 WEP 值，對應 throttle 1.1。
測試驗證推導 CL_max 對上史實 ±8%、穩定導數符號、
以及兩機種的關鍵性格差異（層流翼低阻、109 高速副翼變重）。"
```

---

## Task 10：氣動力與力矩

**Files:**
- Create: `src/physics/aero.ts`
- Test: `test/unit/aero.test.ts`

**Interfaces:**
- Consumes: `bodyToStd` / `stdToBody` / `alphaFrom` / `betaFrom` / `StdVec`（Task 8）、`AircraftSpec` / `derivedClMax`（Task 9）、`AeroState` / `AirData` / `Controls` / `ForceMoment`（Task 7）、`clamp` / `smoothstep`（Task 1）、`makeScratch`（Task 2）
- Produces:
  - `liftCoefficient(spec: AircraftSpec, alpha: number, slatsDeployed: boolean): number`
  - `dragCoefficient(spec: AircraftSpec, cl: number, beta: number, mach: number): number`
  - `inducedDragFactor(spec: AircraftSpec): number`
  - `controlEffectiveness(k: number, qRef: number, qbar: number): number`
  - `updateSlatState(spec: AircraftSpec, alpha: number, wasDeployed: boolean): boolean`
  - `computeAeroState(velocityBody: Vector3, air: AirData, out: AeroState): AeroState`
  - `aeroForceMoment(spec: AircraftSpec, aero: AeroState, omegaBody: Vector3, controls: Controls, slatsDeployed: boolean, out: ForceMoment): ForceMoment`

**注意 `aeroForceMoment` 不接收 `AirData` 或速度向量**：所需的空氣資訊已經全部濃縮在 `AeroState`（`qbar`、`mach`、`tas`、`alpha`、`beta`）裡。多傳會觸發 `noUnusedParameters` 編譯錯誤。

**誘導阻力是能量戰的物理來源**（spec §6.2）：`CD = CD0 + CL²/(π·e·AR) + ...`。拉大迎角 → CL 上升 → 阻力隨 CL 平方暴增 → 速度流失。此項寫對，能量戰體感自然成立。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/aero.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  liftCoefficient, dragCoefficient, inducedDragFactor, controlEffectiveness,
  updateSlatState, computeAeroState, aeroForceMoment,
} from '../../src/physics/aero'
import { atmosphere } from '../../src/physics/atmosphere'
import { derivedClMax } from '../../src/specs/types'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'
import type { AeroState, AirData, ForceMoment } from '../../src/physics/types'

const air = (h: number): AirData =>
  atmosphere(h, { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })
const aeroOut = (): AeroState => ({ tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 })
const fmOut = (): ForceMoment => ({ force: new Vector3(), moment: new Vector3() })
const NO_CONTROL = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }

describe('liftCoefficient', () => {
  it('零升迎角處 CL 為 0', () => {
    expect(liftCoefficient(P51D, P51D.lift.alphaZero, false)).toBeCloseTo(0, 12)
  })

  it('線性段斜率等於 clAlpha', () => {
    const a1 = 2 * DEG
    const a2 = 6 * DEG
    const slope =
      (liftCoefficient(P51D, a2, false) - liftCoefficient(P51D, a1, false)) / (a2 - a1)
    expect(slope).toBeCloseTo(P51D.lift.clAlpha, 6)
  })

  it('在失速迎角處達到推導的 CL_max', () => {
    expect(liftCoefficient(P51D, P51D.lift.alphaCrit, false)).toBeCloseTo(
      derivedClMax(P51D, false), 6,
    )
  })

  it('失速後 CL 下降', () => {
    const peak = liftCoefficient(P51D, P51D.lift.alphaCrit, false)
    expect(liftCoefficient(P51D, P51D.lift.alphaCrit + 5 * DEG, false)).toBeLessThan(peak)
    expect(liftCoefficient(P51D, P51D.lift.alphaCrit + 10 * DEG, false)).toBeLessThan(peak)
  })

  it('CL 曲線連續，無跳變', () => {
    let prev = liftCoefficient(P51D, -30 * DEG, false)
    for (let a = -30; a <= 60; a += 0.25) {
      const cl = liftCoefficient(P51D, a * DEG, false)
      expect(Math.abs(cl - prev)).toBeLessThan(0.06)
      prev = cl
    }
  })

  it('深失速沿用平板模型，不發散', () => {
    for (const a of [45, 70, 90, 120, 180]) {
      const cl = liftCoefficient(P51D, a * DEG, false)
      expect(Math.abs(cl)).toBeLessThanOrEqual(1.05)
    }
  })

  it('負迎角對稱', () => {
    const a = 10 * DEG
    const offset = P51D.lift.alphaZero
    expect(liftCoefficient(P51D, offset + a, false)).toBeCloseTo(
      -liftCoefficient(P51D, offset - a, false), 6,
    )
  })

  it('Bf 109 縫翼展開後失速迎角與 CL_max 提高', () => {
    const clean = liftCoefficient(BF109G6, BF109G6.lift.alphaCrit, false)
    const slats = liftCoefficient(BF109G6, BF109G6.lift.alphaCrit + 2.5 * DEG, true)
    expect(slats).toBeGreaterThan(clean)
  })
})

describe('updateSlatState', () => {
  it('迎角超過展開閾值時展開', () => {
    expect(updateSlatState(BF109G6, 9 * DEG, false)).toBe(true)
  })

  it('迎角低於收回閾值時收回', () => {
    expect(updateSlatState(BF109G6, 5 * DEG, true)).toBe(false)
  })

  it('遲滯區間內維持原狀態', () => {
    expect(updateSlatState(BF109G6, 7 * DEG, true)).toBe(true)
    expect(updateSlatState(BF109G6, 7 * DEG, false)).toBe(false)
  })

  it('P-51 無縫翼，永不展開', () => {
    expect(updateSlatState(P51D, 30 * DEG, false)).toBe(false)
    expect(updateSlatState(P51D, 30 * DEG, true)).toBe(false)
  })
})

describe('dragCoefficient', () => {
  it('CL 為 0 且無側滑時等於 cd0', () => {
    expect(dragCoefficient(P51D, 0, 0, 0.3)).toBeCloseTo(P51D.drag.cd0, 12)
  })

  it('誘導阻力隨 CL 平方成長', () => {
    const k = inducedDragFactor(P51D)
    expect(dragCoefficient(P51D, 1.0, 0, 0.3) - P51D.drag.cd0).toBeCloseTo(k, 10)
    expect(dragCoefficient(P51D, 2.0, 0, 0.3) - P51D.drag.cd0).toBeCloseTo(4 * k, 10)
  })

  it('誘導阻力因子等於 1/(π·e·AR)', () => {
    const ar = (P51D.wing.span ** 2) / P51D.wing.area
    expect(inducedDragFactor(P51D)).toBeCloseTo(1 / (Math.PI * P51D.wing.oswald * ar), 12)
  })

  it('臨界馬赫數以下不受壓縮性影響', () => {
    expect(dragCoefficient(P51D, 0, 0, 0.5)).toBeCloseTo(
      dragCoefficient(P51D, 0, 0, 0.7), 12,
    )
  })

  it('超過臨界馬赫數後阻力上升', () => {
    expect(dragCoefficient(P51D, 0, 0, 0.8)).toBeGreaterThan(dragCoefficient(P51D, 0, 0, 0.7))
  })

  it('P-51 的臨界馬赫數高於 Bf 109（俯衝優勢）', () => {
    const p51 = dragCoefficient(P51D, 0.2, 0, 0.71) / P51D.drag.cd0
    const bf = dragCoefficient(BF109G6, 0.2, 0, 0.71) / BF109G6.drag.cd0
    expect(p51).toBeLessThan(bf)
  })

  it('側滑增加阻力', () => {
    expect(dragCoefficient(P51D, 0.3, 10 * DEG, 0.3)).toBeGreaterThan(
      dragCoefficient(P51D, 0.3, 0, 0.3),
    )
  })
})

describe('controlEffectiveness', () => {
  it('動壓低於 qRef 時權限為滿', () => {
    expect(controlEffectiveness(1.5, 7560, 3000)).toBe(1)
  })

  it('動壓等於 qRef 時權限為滿', () => {
    expect(controlEffectiveness(1.5, 7560, 7560)).toBeCloseTo(1, 10)
  })

  it('動壓高於 qRef 時權限衰減', () => {
    expect(controlEffectiveness(1.5, 7560, 20000)).toBeLessThan(1)
  })

  it('Bf 109 在 650 km/h 的副翼權限遠低於 P-51', () => {
    const q650 = 0.5 * 1.225 * (650 / 3.6) ** 2
    const bf = controlEffectiveness(
      BF109G6.controlStiffening.aileronK, BF109G6.controlStiffening.qRef, q650,
    )
    const p51 = controlEffectiveness(
      P51D.controlStiffening.aileronK, P51D.controlStiffening.qRef, q650,
    )
    expect(bf).toBeLessThan(p51 * 0.45)
  })
})

describe('computeAeroState', () => {
  it('純前向飛行時迎角與側滑為 0', () => {
    const s = computeAeroState(new Vector3(0, 0, -150), air(0), aeroOut())
    expect(s.alpha).toBeCloseTo(0, 12)
    expect(s.beta).toBeCloseTo(0, 12)
    expect(s.tas).toBeCloseTo(150, 10)
  })

  it('動壓為 ½ρV²', () => {
    const a = air(0)
    const s = computeAeroState(new Vector3(0, 0, -150), a, aeroOut())
    expect(s.qbar).toBeCloseTo(0.5 * a.density * 150 * 150, 6)
  })

  it('馬赫數為 tas / 音速', () => {
    const a = air(6000)
    const s = computeAeroState(new Vector3(0, 0, -200), a, aeroOut())
    expect(s.mach).toBeCloseTo(200 / a.soundSpeed, 10)
  })

  it('零速度不產生 NaN', () => {
    const s = computeAeroState(new Vector3(0, 0, 0), air(0), aeroOut())
    expect(Number.isFinite(s.alpha)).toBe(true)
    expect(Number.isFinite(s.beta)).toBe(true)
    expect(s.qbar).toBe(0)
  })
})

describe('aeroForceMoment', () => {
  const vel = new Vector3(0, -8, -160) // 略帶正迎角
  const a = air(0)
  const NO_SPIN = new Vector3()

  it('升力方向為機體 +Y（正迎角時向上）', () => {
    const s = computeAeroState(vel, a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(fm.force.y).toBeGreaterThan(0)
  })

  it('阻力方向為機體 +Z（減速）', () => {
    const s = computeAeroState(vel, a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(fm.force.z).toBeGreaterThan(0)
  })

  it('正迎角產生機首下壓力矩（縱向靜穩定）', () => {
    const s = computeAeroState(new Vector3(0, -20, -160), a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    // 機首下壓 = 繞機體 +X 軸的負力矩
    expect(fm.moment.x).toBeLessThan(0)
  })

  it('正升降舵指令產生機首上仰力矩', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    const up = aeroForceMoment(P51D, s, NO_SPIN, { ...NO_CONTROL, elevator: 1 }, false, fmOut())
    const neutral = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(up.moment.x).toBeGreaterThan(neutral.moment.x)
  })

  it('正副翼指令產生向右滾轉力矩（機體 −Z 方向為正）', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, { ...NO_CONTROL, aileron: 1 }, false, fmOut())
    expect(fm.moment.z).toBeLessThan(0) // M.z = −l，正 l（右滾）→ 負 M.z
  })

  it('滾轉阻尼抵抗既有滾轉率', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    // 機體 −Z 方向的角速度 = 正滾轉率 p
    const fm = aeroForceMoment(P51D, s, new Vector3(0, 0, -3), NO_CONTROL, false, fmOut())
    expect(fm.moment.z).toBeGreaterThan(0) // 阻尼力矩與滾轉方向相反
  })

  it('零速度時力與力矩皆為 0', () => {
    const s = computeAeroState(new Vector3(0, 0, 0), a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(fm.force.length()).toBeCloseTo(0, 10)
    expect(fm.moment.length()).toBeCloseTo(0, 10)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const out = fmOut()
    const s = computeAeroState(vel, a, aeroOut())
    expect(aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, out)).toBe(out)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/aero.test.ts`
預期：FAIL，找不到模組 `../../src/physics/aero`。

- [ ] **Step 3: 實作 src/physics/aero.ts**

```ts
import type { Vector3 } from 'three'
import { smoothstep } from '../core/math'
import { alphaFrom, betaFrom, bodyToStd, stdToBody, type StdVec } from './axes'
import { derivedClMax, type AircraftSpec } from '../specs/types'
import type { AeroState, AirData, Controls, ForceMoment } from './types'

// 模組私有暫存，避免熱路徑配置。禁止跨模組共用。
const stdVel: StdVec = { x: 0, y: 0, z: 0 }
const stdOmega: StdVec = { x: 0, y: 0, z: 0 }

/** 誘導阻力因子 1/(π·e·AR)。 */
export function inducedDragFactor(spec: AircraftSpec): number {
  const ar = (spec.wing.span * spec.wing.span) / spec.wing.area
  return 1 / (Math.PI * spec.wing.oswald * ar)
}

/**
 * 升力係數。
 *
 * 線性段：CL = clAlpha × (α − α₀)
 * 失速後：以 smoothstep 由 CL_max 平滑崩塌至 postStallFactor × CL_max
 * 深失速：改用平板模型 CL = 2·sinα·cosα，確保大迎角不發散
 */
export function liftCoefficient(
  spec: AircraftSpec,
  alpha: number,
  slatsDeployed: boolean,
): number {
  const L = spec.lift
  const alphaCrit = L.alphaCrit + (slatsDeployed ? L.slatAlphaBonus : 0)
  const clMax = derivedClMax(spec, slatsDeployed)

  // 以零升迎角為對稱中心
  const rel = alpha - L.alphaZero
  const sign = rel < 0 ? -1 : 1
  const mag = Math.abs(rel)
  const critMag = alphaCrit - L.alphaZero

  if (mag <= critMag) return L.clAlpha * rel

  const blendEnd = critMag + L.stallBlend
  if (mag < blendEnd) {
    const t = smoothstep(0, 1, (mag - critMag) / L.stallBlend)
    return sign * (clMax + (L.postStallFactor * clMax - clMax) * t)
  }

  // 平板模型。以絕對迎角（非相對）計算，符合大迎角的物理行為。
  const abs = Math.abs(alpha)
  return sign * Math.abs(2 * Math.sin(abs) * Math.cos(abs))
}

/**
 * 前緣自動縫翼狀態，含遲滯避免在閾值附近抖動。
 * 這是 Bf 109 低速盤旋優勢的物理來源，非憑空加成。
 */
export function updateSlatState(
  spec: AircraftSpec,
  alpha: number,
  wasDeployed: boolean,
): boolean {
  if (spec.lift.slatAlphaBonus <= 0) return false
  const mag = Math.abs(alpha)
  if (wasDeployed) return mag > spec.lift.slatRetractAlpha
  return mag > spec.lift.slatDeployAlpha
}

/** 阻力係數：零升阻力 + 誘導阻力 + 側滑阻力，超音速臨界後加壓縮性修正。 */
export function dragCoefficient(
  spec: AircraftSpec,
  cl: number,
  beta: number,
  mach: number,
): number {
  let cd0 = spec.drag.cd0
  if (mach > spec.drag.machCrit) {
    const excess = mach - spec.drag.machCrit
    cd0 *= 1 + spec.drag.machDragFactor * excess * excess
  }
  return cd0 + inducedDragFactor(spec) * cl * cl + spec.drag.cdBeta * beta * beta
}

/** 高速舵面變重：δ_eff = δ × min(1, (qRef/q)^k)。 */
export function controlEffectiveness(k: number, qRef: number, qbar: number): number {
  if (qbar <= qRef) return 1
  return Math.pow(qRef / qbar, k)
}

/** 由機體座標的空速向量計算迎角、側滑、動壓、馬赫數。 */
export function computeAeroState(
  velocityBody: Vector3,
  air: AirData,
  out: AeroState,
): AeroState {
  bodyToStd(velocityBody, stdVel)
  const tas = velocityBody.length()
  out.tas = tas
  out.alpha = tas > 1e-6 ? alphaFrom(stdVel) : 0
  out.beta = betaFrom(stdVel, tas)
  out.qbar = 0.5 * air.density * tas * tas
  out.mach = air.soundSpeed > 0 ? tas / air.soundSpeed : 0
  return out
}

/**
 * 氣動力與力矩，輸出於機體座標。
 *
 * 力在風軸計算後轉入標準氣動軸，再由 stdToBody 轉回機體軸。
 * 力矩的阻尼項以無因次角速度 (p·b/2V) 等形式計入。
 */
export function aeroForceMoment(
  spec: AircraftSpec,
  aero: AeroState,
  omegaBody: Vector3,
  controls: Controls,
  slatsDeployed: boolean,
  out: ForceMoment,
): ForceMoment {
  const { area, span, chord } = spec.wing

  if (aero.qbar <= 0 || aero.tas <= 1e-6) {
    out.force.set(0, 0, 0)
    out.moment.set(0, 0, 0)
    return out
  }

  const cl = liftCoefficient(spec, aero.alpha, slatsDeployed)
  const cd = dragCoefficient(spec, cl, aero.beta, aero.mach)
  const cy = spec.side.cyBeta * aero.beta

  const qS = aero.qbar * area
  const lift = qS * cl
  const drag = qS * cd
  const side = qS * cy

  const ca = Math.cos(aero.alpha)
  const sa = Math.sin(aero.alpha)
  const cb = Math.cos(aero.beta)
  const sb = Math.sin(aero.beta)

  // 風軸 → 標準氣動軸（x 前、y 右、z 下）
  const fx = -drag * ca * cb - side * ca * sb + lift * sa
  const fy = -drag * sb + side * cb
  const fz = -drag * sa * cb - side * sa * sb - lift * ca
  stdToBody(fx, fy, fz, out.force)

  // 角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
  bodyToStd(omegaBody, stdOmega)
  const v2 = 2 * aero.tas
  const pHat = (stdOmega.x * span) / v2
  const qHat = (stdOmega.y * chord) / v2
  const rHat = (stdOmega.z * span) / v2

  const CS = spec.controlStiffening
  const da = controls.aileron * controlEffectiveness(CS.aileronK, CS.qRef, aero.qbar)
  const de = controls.elevator * controlEffectiveness(CS.elevatorK, CS.qRef, aero.qbar)
  const dr = controls.rudder * controlEffectiveness(CS.rudderK, CS.qRef, aero.qbar)

  const M = spec.moments
  const cRoll = M.clBeta * aero.beta + M.clP * pHat + M.clDa * da
  const cPitch = M.cm0 + M.cmAlpha * aero.alpha + M.cmQ * qHat + M.cmDe * de
  const cYaw = M.cnBeta * aero.beta + M.cnR * rHat + M.cnDr * dr

  stdToBody(qS * span * cRoll, qS * chord * cPitch, qS * span * cYaw, out.moment)
  return out
}
```

- [ ] **Step 4: 確認沒有未使用的匯入**

Run: `npx tsc --noEmit`

`AirData` 只被 `computeAeroState` 使用，`Vector3` 只作為型別使用——兩者都應保留。若 `tsc` 對任何匯入報 `noUnusedLocals`，刪除該匯入而不是加 `void` 規避。

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/unit/aero.test.ts`
預期：PASS，30 個測試全綠。

若「CL 曲線連續，無跳變」失敗，檢查 `blendEnd` 與平板模型的銜接處——通常是 `postStallFactor × clMax` 與 `2·sinα·cosα` 在 `blendEnd` 處不相等造成。可微調 `stallBlend` 使兩者接近。

- [ ] **Step 6: Commit**

```bash
git add src/physics/aero.ts test/unit/aero.test.ts
git commit -m "feat: 氣動力與力矩

CL 三段模型（線性 / 失速崩塌 / 平板），誘導阻力 CL²/(π·e·AR)
為能量戰的物理來源。含壓縮性修正、側滑阻力、
Bf 109 前緣縫翼遲滯、高速舵面變重。
力在風軸計算後經標準氣動軸轉回機體軸。"
```

---

## Task 11：引擎功率曲線與螺旋槳推力

**Files:**
- Create: `src/physics/propulsion.ts`
- Test: `test/unit/propulsion.test.ts`

**Interfaces:**
- Consumes: `atmosphere` / `RHO0`（Task 7）、`AircraftSpec`（Task 9）、`AirData`（Task 7）、`clamp`（Task 1）
- Produces:
  - `WEP_THROTTLE: number`（= 1.1）
  - `ramFactor(mach: number, efficiency: number): number`
  - `enginePower(spec: AircraftSpec, air: AirData, mach: number, throttle: number): number` — W
  - `propThrust(spec: AircraftSpec, powerW: number, tas: number, air: AirData): number` — N
  - `propEfficiency(spec: AircraftSpec, tas: number): number`

**Spec 修訂 2 於此落實。** 沒有 ram recovery，P-51D 在 7,600 m 的推力（3,563 N）低於阻力（4,300 N），史實極速 703 km/h 永遠達不到，L2 測試必定失敗。

**演算法在 σ 空間求解**（而非高度空間），因為 ram 的效果正是「等效於降低高度」，直接以密度比表達最自然：

```
σ_eff = min(σ × ramFactor, 1.0)          // 夾制上限為海平面
σ_crit = 該檔位臨界高度的密度比

σ_eff ≥ σ_crit（臨界高度以下）：
    t = clamp((σ_eff − σ_crit) / (1 − σ_crit), 0, 1)
    P = lerp(powerCritical, powerSeaLevel, t)

σ_eff < σ_crit（臨界高度以上）：
    P = powerCritical × (σ_eff/σ_crit − 0.117) / 0.883     // Gagg-Farrar

多檔位取上包絡（Math.max）
最後乘以油門比例 clamp(throttle / 1.1, 0, 1)
```

- [ ] **Step 1: 寫失敗的測試**

`test/unit/propulsion.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  WEP_THROTTLE, ramFactor, enginePower, propThrust, propEfficiency,
} from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AirData } from '../../src/physics/types'

const air = (h: number): AirData =>
  atmosphere(h, { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })

const HP = 745.7
const PS = 735.5

describe('ramFactor', () => {
  it('靜止時為 1（無衝壓）', () => {
    expect(ramFactor(0, 0.8)).toBeCloseTo(1, 12)
  })

  it('效率為 0 時恆為 1', () => {
    expect(ramFactor(0.7, 0)).toBeCloseTo(1, 12)
  })

  it('M = 0.63 且效率 0.8 時約為 1.245', () => {
    expect(ramFactor(0.6306, 0.8)).toBeCloseTo(1.245, 2)
  })

  it('隨馬赫數單調遞增', () => {
    let prev = 0
    for (let m = 0; m <= 0.8; m += 0.05) {
      const f = ramFactor(m, 0.8)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
  })
})

describe('enginePower', () => {
  it('海平面靜止 WEP 等於登錄的海平面功率', () => {
    const p = enginePower(P51D, air(0), 0, WEP_THROTTLE)
    expect(p).toBeCloseTo(1490 * HP, -2)
  })

  it('油門 0 時功率為 0', () => {
    expect(enginePower(P51D, air(0), 0, 0)).toBe(0)
  })

  it('油門與功率成正比', () => {
    const full = enginePower(P51D, air(3000), 0.3, WEP_THROTTLE)
    const half = enginePower(P51D, air(3000), 0.3, WEP_THROTTLE / 2)
    expect(half).toBeCloseTo(full / 2, 3)
  })

  it('油門超過 WEP 上限時被夾制', () => {
    const wep = enginePower(P51D, air(0), 0, WEP_THROTTLE)
    expect(enginePower(P51D, air(0), 0, 5)).toBeCloseTo(wep, 6)
  })

  it('P-51 低檔臨界高度 1,900 m 靜止功率接近 1,720 hp', () => {
    expect(enginePower(P51D, air(1900), 0, WEP_THROTTLE)).toBeCloseTo(1720 * HP, -3)
  })

  it('P-51 高檔臨界高度 5,900 m 靜止功率接近 1,370 hp', () => {
    expect(enginePower(P51D, air(5900), 0, WEP_THROTTLE)).toBeCloseTo(1370 * HP, -3)
  })

  it('P-51 功率曲線呈雙峰（兩級增壓的特徵）', () => {
    const samples: number[] = []
    for (let h = 0; h <= 9000; h += 250) {
      samples.push(enginePower(P51D, air(h), 0, WEP_THROTTLE))
    }
    // 尋找局部極大值個數
    let peaks = 0
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i]! > samples[i - 1]! && samples[i]! >= samples[i + 1]!) peaks++
    }
    expect(peaks).toBeGreaterThanOrEqual(2)
  })

  it('Bf 109 海平面 WEP 接近 1,475 PS', () => {
    expect(enginePower(BF109G6, air(0), 0, WEP_THROTTLE)).toBeCloseTo(1475 * PS, -3)
  })

  it('臨界高度以上功率隨高度遞減', () => {
    let prev = Infinity
    for (let h = 6000; h <= 12000; h += 500) {
      const p = enginePower(P51D, air(h), 0.3, WEP_THROTTLE)
      expect(p).toBeLessThan(prev)
      prev = p
    }
  })

  it('Spec 修訂 2：ram 使 7,600 m 高速時功率顯著高於靜止', () => {
    const still = enginePower(P51D, air(7600), 0, WEP_THROTTLE)
    const fast = enginePower(P51D, air(7600), 0.63, WEP_THROTTLE)
    expect(fast).toBeGreaterThan(still * 1.15)
    // 應回到接近高檔臨界功率
    expect(fast).toBeGreaterThan(1350 * HP)
  })

  it('P-51 在 8,000 m 的功率高於 Bf 109（高空優勢）', () => {
    const p51 = enginePower(P51D, air(8000), 0.6, WEP_THROTTLE) / P51D.mass
    const bf = enginePower(BF109G6, air(8000), 0.6, WEP_THROTTLE) / BF109G6.mass
    expect(p51).toBeGreaterThan(bf)
  })
})

describe('propEfficiency', () => {
  it('靜止時效率趨近 0', () => {
    expect(propEfficiency(P51D, 0)).toBeCloseTo(0, 6)
  })

  it('高速時趨近 etaMax', () => {
    expect(propEfficiency(P51D, 400)).toBeCloseTo(P51D.prop.etaMax, 2)
  })

  it('單調遞增', () => {
    let prev = -1
    for (let v = 0; v <= 300; v += 10) {
      const e = propEfficiency(P51D, v)
      expect(e).toBeGreaterThan(prev)
      prev = e
    }
  })
})

describe('propThrust', () => {
  const a0 = air(0)

  it('低速受靜推力上限限制，不發散', () => {
    const power = enginePower(P51D, a0, 0, WEP_THROTTLE)
    const t0 = propThrust(P51D, power, 0, a0)
    const t1 = propThrust(P51D, power, 0.01, a0)
    expect(Number.isFinite(t0)).toBe(true)
    expect(t0).toBeLessThan(40000)
    expect(t1).toBeLessThan(40000)
  })

  it('海平面靜推力落在 15–30 kN 的合理區間', () => {
    const power = enginePower(P51D, a0, 0, WEP_THROTTLE)
    const t = propThrust(P51D, power, 5, a0)
    expect(t).toBeGreaterThan(15000)
    expect(t).toBeLessThan(30000)
  })

  it('高速時推力隨速度下降（定功率）', () => {
    const power = enginePower(P51D, a0, 0.4, WEP_THROTTLE)
    expect(propThrust(P51D, power, 200, a0)).toBeLessThan(propThrust(P51D, power, 120, a0))
  })

  it('功率為 0 時推力為 0', () => {
    expect(propThrust(P51D, 0, 150, a0)).toBe(0)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/propulsion.test.ts`
預期：FAIL，找不到模組 `../../src/physics/propulsion`。

- [ ] **Step 3: 實作 src/physics/propulsion.ts**

```ts
import { clamp, lerp } from '../core/math'
import { atmosphere } from './atmosphere'
import type { AircraftSpec } from '../specs/types'
import type { AirData } from './types'

/** 對應各機種登錄之 WEP 功率的油門值。 */
export const WEP_THROTTLE = 1.1

const scratchAir: AirData = {
  density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0,
}

/**
 * 進氣衝壓恢復因子（Spec 修訂 2）。
 *
 * 高速飛行時進氣道的動壓恢復提高增壓器有效進氣壓，
 * 等效於降低飛行高度。沒有這一項，史實極速無法達成。
 */
export function ramFactor(mach: number, efficiency: number): number {
  const totalRatio = Math.pow(1 + 0.2 * mach * mach, 3.5)
  return 1 + efficiency * (totalRatio - 1)
}

/**
 * 引擎軸功率，W。
 *
 * 在密度比 σ 空間求解——ram 的效果正是「等效於降低高度」，
 * 以 σ 表達最自然。多檔位取上包絡（自動換檔）。
 */
export function enginePower(
  spec: AircraftSpec,
  air: AirData,
  mach: number,
  throttle: number,
): number {
  const frac = clamp(throttle / WEP_THROTTLE, 0, 1)
  if (frac <= 0) return 0

  const sigmaEff = Math.min(air.sigma * ramFactor(mach, spec.engine.ramEfficiency), 1)

  let best = 0
  for (const gear of spec.engine.gears) {
    const sigmaCrit = atmosphere(gear.altCritical, scratchAir).sigma
    let p: number
    if (sigmaEff >= sigmaCrit) {
      const t = clamp((sigmaEff - sigmaCrit) / (1 - sigmaCrit), 0, 1)
      p = lerp(gear.powerCritical, gear.powerSeaLevel, t)
    } else {
      // Gagg-Farrar
      p = gear.powerCritical * ((sigmaEff / sigmaCrit - 0.117) / 0.883)
    }
    if (p > best) best = p
  }

  return Math.max(best, 0) * frac
}

/** 螺旋槳效率：低速效率低，高速趨近 etaMax。 */
export function propEfficiency(spec: AircraftSpec, tas: number): number {
  return spec.prop.etaMax * (1 - Math.exp(-tas / spec.prop.vRef))
}

/**
 * 螺旋槳推力，N。
 *
 * 以 T = η·P/V 計算，並以動量理論的靜推力上限夾制，
 * 避免 V → 0 時推力發散。
 */
export function propThrust(
  spec: AircraftSpec,
  powerW: number,
  tas: number,
  air: AirData,
): number {
  if (powerW <= 0) return 0
  const dynamic = (propEfficiency(spec, tas) * powerW) / Math.max(tas, 1)
  const radius = spec.prop.diameter / 2
  const diskArea = Math.PI * radius * radius
  const ideal = Math.cbrt(2 * air.density * diskArea * powerW * powerW)
  const staticMax = spec.prop.figureOfMerit * ideal
  return Math.min(dynamic, staticMax)
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/propulsion.test.ts`
預期：PASS，21 個測試全綠。

**「功率曲線呈雙峰」若失敗**，代表兩檔位的上包絡沒有形成兩個局部極大——檢查高檔的 `powerSeaLevel`（1,290 hp）是否確實低於低檔的 `powerCritical`（1,720 hp），否則低檔的峰會被高檔完全覆蓋。

- [ ] **Step 5: Commit**

```bash
git add src/physics/propulsion.ts test/unit/propulsion.test.ts
git commit -m "feat: 引擎功率曲線與螺旋槳推力

在密度比 sigma 空間求解，含進氣衝壓恢復（Spec 修訂 2）——
缺此項時 P-51D 於 7600m 推力 3563N 低於阻力 4300N，
史實極速 703km/h 無法達成。
多檔增壓取上包絡形成 P-51 特有的雙峰功率曲線。
推力以動量理論靜推力上限夾制，避免低速發散。"
```

---

## Task 12：6DOF 剛體積分

**Files:**
- Create: `src/physics/dynamics.ts`
- Test: `test/unit/dynamics.test.ts`
- Modify: `bench/physics.bench.ts`（替換佔位負載為真實負載）

**Interfaces:**
- Consumes: 全部前述物理模組
- Produces:
  - `StepDiagnostics = { air: AirData; aero: AeroState; thrustN: number; powerW: number; loadFactor: number; slatsDeployed: boolean }`
  - `createDiagnostics(): StepDiagnostics`
  - `createFlightState(altitude: number, tas: number): FlightState`
  - `stepDynamics(spec: AircraftSpec, state: FlightState, controls: Controls, dt: number, diag: StepDiagnostics): void`

**`diag.slatsDeployed` 同時是輸入與輸出**：它承載縫翼遲滯的狀態。呼叫端必須沿用同一個 `diag` 物件，不可每步重建。

**積分順序**（半隱式 Euler：先更新速度再更新位置）：

```
1. atmosphere(position.y) → diag.air
2. 世界速度 → 機體速度（套用 orientation 的共軛）
3. computeAeroState → diag.aero
4. updateSlatState（讀寫 diag.slatsDeployed）
5. aeroForceMoment → 機體力與力矩
6. enginePower → propThrust，推力沿機體 −Z
7. 比力 = (氣動力 + 推力) / m   →  loadFactor = 比力.y / g
8. 世界加速度 = 比力轉世界 + 重力
9. velocity += a·dt ； position += velocity·dt
10. 角加速度 = I⁻¹(M − ω × Iω) ； omega += α·dt
11. 四元數積分後正規化
```

- [ ] **Step 1: 寫失敗的測試**

`test/unit/dynamics.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { G0 } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls } from '../../src/physics/types'

const IDLE: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }
const DT = 1 / 240

/** 移除全部氣動力的機種副本，用於隔離重力與積分器行為。 */
function noAero(spec: AircraftSpec): AircraftSpec {
  return { ...spec, wing: { ...spec.wing, area: 0 } }
}

function run(spec: AircraftSpec, state = createFlightState(5000, 0), controls = IDLE, seconds = 1) {
  const diag = createDiagnostics()
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepDynamics(spec, state, controls, DT, diag)
  return { state, diag }
}

describe('createFlightState', () => {
  it('初始速度沿機首方向（機體 −Z）', () => {
    const s = createFlightState(3000, 150)
    expect(s.position.y).toBe(3000)
    expect(s.velocity.z).toBeCloseTo(-150, 10)
    expect(s.velocity.length()).toBeCloseTo(150, 10)
  })

  it('初始姿態為單位四元數、角速度為 0', () => {
    const s = createFlightState(3000, 150)
    expect(s.orientation.w).toBeCloseTo(1, 12)
    expect(s.angularVelocity.length()).toBe(0)
  })
})

describe('stepDynamics — 重力與積分', () => {
  it('無氣動力、無推力時為自由落體', () => {
    const { state } = run(noAero(P51D), createFlightState(5000, 0), IDLE, 1)
    expect(state.velocity.y).toBeCloseTo(-G0, 3)
    // 半隱式 Euler 於 240Hz 的位移略大於解析解 4.903
    expect(5000 - state.position.y).toBeCloseTo(4.924, 1)
  })

  it('水平速度在無氣動力時守恆', () => {
    const { state } = run(noAero(P51D), createFlightState(5000, 150), IDLE, 2)
    expect(state.velocity.z).toBeCloseTo(-150, 6)
  })

  it('四元數保持正規化', () => {
    const s = createFlightState(4000, 160)
    s.angularVelocity.set(1.5, -0.8, 2.2)
    run(P51D, s, IDLE, 5)
    expect(s.orientation.length()).toBeCloseTo(1, 9)
  })

  it('狀態不含 NaN', () => {
    const s = createFlightState(4000, 180)
    s.angularVelocity.set(3, 3, 3)
    run(P51D, s, { aileron: 1, elevator: 1, rudder: 1, throttle: WEP_THROTTLE }, 3)
    for (const v of [s.position, s.velocity, s.angularVelocity]) {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
    }
    expect(Number.isFinite(s.orientation.w)).toBe(true)
  })

  it('相同初始條件產生相同結果（確定性）', () => {
    const a = run(P51D, createFlightState(4000, 170), { ...IDLE, throttle: 1 }, 2).state
    const b = run(P51D, createFlightState(4000, 170), { ...IDLE, throttle: 1 }, 2).state
    expect(a.position.x).toBe(b.position.x)
    expect(a.position.y).toBe(b.position.y)
    expect(a.velocity.z).toBe(b.velocity.z)
  })
})

describe('stepDynamics — 氣動響應', () => {
  it('阻力使無動力平飛持續減速', () => {
    const s = createFlightState(5000, 180)
    const before = s.velocity.length()
    run(P51D, s, IDLE, 3)
    expect(s.velocity.length()).toBeLessThan(before)
  })

  it('全油門平飛會加速', () => {
    const s = createFlightState(3000, 120)
    const before = s.velocity.length()
    run(P51D, s, { ...IDLE, throttle: WEP_THROTTLE }, 3)
    expect(s.velocity.length()).toBeGreaterThan(before)
  })

  it('滾轉阻尼使既有滾轉率衰減', () => {
    const s = createFlightState(4000, 180)
    s.angularVelocity.set(0, 0, -2) // 機體 −Z：正滾轉率
    const before = Math.abs(s.angularVelocity.z)
    run(P51D, s, IDLE, 1)
    expect(Math.abs(s.angularVelocity.z)).toBeLessThan(before)
  })

  it('正副翼指令產生向右滾轉', () => {
    const s = createFlightState(4000, 180)
    run(P51D, s, { ...IDLE, aileron: 1, throttle: 1 }, 0.5)
    expect(s.angularVelocity.z).toBeLessThan(0) // ω.z 為負 = 正滾轉率 p
  })

  it('正升降舵指令產生機首上仰', () => {
    const s = createFlightState(4000, 180)
    run(P51D, s, { ...IDLE, elevator: 0.5, throttle: 1 }, 0.5)
    expect(s.angularVelocity.x).toBeGreaterThan(0) // ω.x = 正俯仰率 q
  })

  it('Bf 109 相同副翼指令下滾轉加速度大於 P-51（滾轉慣量較小）', () => {
    const p = createFlightState(4000, 160)
    const b = createFlightState(4000, 160)
    run(P51D, p, { ...IDLE, aileron: 1, throttle: 1 }, 0.25)
    run(BF109G6, b, { ...IDLE, aileron: 1, throttle: 1 }, 0.25)
    expect(Math.abs(b.angularVelocity.z)).toBeGreaterThan(Math.abs(p.angularVelocity.z))
  })
})

describe('stepDynamics — 診斷輸出', () => {
  it('診斷欄位被填入合理值', () => {
    const s = createFlightState(6000, 170)
    const { diag } = run(P51D, s, { ...IDLE, throttle: WEP_THROTTLE }, 0.5)
    expect(diag.air.density).toBeGreaterThan(0)
    expect(diag.aero.tas).toBeGreaterThan(100)
    expect(diag.powerW).toBeGreaterThan(0)
    expect(diag.thrustN).toBeGreaterThan(0)
    expect(Number.isFinite(diag.loadFactor)).toBe(true)
  })

  it('縫翼狀態隨迎角變化並保持遲滯', () => {
    const s = createFlightState(3000, 70) // 低速 → 高迎角
    const { diag } = run(BF109G6, s, { ...IDLE, elevator: 0.6, throttle: 1 }, 2)
    expect(typeof diag.slatsDeployed).toBe('boolean')
  })

  it('P-51 的縫翼狀態恆為 false', () => {
    const s = createFlightState(3000, 70)
    const { diag } = run(P51D, s, { ...IDLE, elevator: 0.8, throttle: 1 }, 2)
    expect(diag.slatsDeployed).toBe(false)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/unit/dynamics.test.ts`
預期：FAIL，找不到模組 `../../src/physics/dynamics`。

- [ ] **Step 3: 實作 src/physics/dynamics.ts**

```ts
import { Quaternion, Vector3 } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import { atmosphere } from './atmosphere'
import { aeroForceMoment, computeAeroState, updateSlatState } from './aero'
import { enginePower, propThrust } from './propulsion'
import type { AircraftSpec } from '../specs/types'
import type { AeroState, AirData, Controls, FlightState, ForceMoment } from './types'

const S = makeScratch(6, 2)

export interface StepDiagnostics {
  air: AirData
  aero: AeroState
  /** N */
  thrustN: number
  /** W */
  powerW: number
  /** 機體 Y 方向比力 / g */
  loadFactor: number
  /**
   * 前緣縫翼是否展開。同時是輸入與輸出——承載遲滯狀態，
   * 呼叫端必須沿用同一個物件，不可每步重建。
   */
  slatsDeployed: boolean
}

export function createDiagnostics(): StepDiagnostics {
  return {
    air: { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 },
    aero: { tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 },
    thrustN: 0,
    powerW: 0,
    loadFactor: 0,
    slatsDeployed: false,
  }
}

/** 建立平飛初始狀態：機首朝 −Z，速度沿機首方向。 */
export function createFlightState(altitude: number, tas: number): FlightState {
  return {
    position: new Vector3(0, altitude, 0),
    velocity: new Vector3(0, 0, -tas),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
  }
}

const fm: ForceMoment = { force: new Vector3(), moment: new Vector3() }

/** 單一物理步。熱路徑，禁止任何配置行為。 */
export function stepDynamics(
  spec: AircraftSpec,
  state: FlightState,
  controls: Controls,
  dt: number,
  diag: StepDiagnostics,
): void {
  const invQ = S.q[0]!.copy(state.orientation).invert()
  const velBody = S.v[0]!.copy(state.velocity).applyQuaternion(invQ)

  atmosphere(state.position.y, diag.air)
  computeAeroState(velBody, diag.air, diag.aero)
  diag.slatsDeployed = updateSlatState(spec, diag.aero.alpha, diag.slatsDeployed)

  aeroForceMoment(spec, diag.aero, state.angularVelocity, controls, diag.slatsDeployed, fm)

  diag.powerW = enginePower(spec, diag.air, diag.aero.mach, controls.throttle)
  diag.thrustN = propThrust(spec, diag.powerW, diag.aero.tas, diag.air)

  // 推力沿機首方向（機體 −Z）
  const totalBody = S.v[1]!.copy(fm.force)
  totalBody.z -= diag.thrustN

  diag.loadFactor = totalBody.y / (spec.mass * G0)

  // 比力轉世界座標，再加重力
  const accel = S.v[2]!.copy(totalBody).divideScalar(spec.mass).applyQuaternion(state.orientation)
  accel.y -= G0

  // 半隱式 Euler：先速度後位置
  state.velocity.addScaledVector(accel, dt)
  state.position.addScaledVector(state.velocity, dt)

  // 角加速度 = I⁻¹(M − ω × Iω)
  const I = spec.inertia
  const w = state.angularVelocity
  const Iw = S.v[3]!.set(w.x * I.pitch, w.y * I.yaw, w.z * I.roll)
  const gyro = S.v[4]!.copy(w).cross(Iw)
  const alpha = S.v[5]!.set(
    (fm.moment.x - gyro.x) / I.pitch,
    (fm.moment.y - gyro.y) / I.yaw,
    (fm.moment.z - gyro.z) / I.roll,
  )
  w.addScaledVector(alpha, dt)

  // 四元數積分：q ← q ⊗ (1, ½ω·dt)，一階近似，240Hz 下誤差可忽略
  const dq = S.q[1]!.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1)
  state.orientation.multiply(dq).normalize()
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/dynamics.test.ts`
預期：PASS，15 個測試全綠。

- [ ] **Step 5: 替換微基準為真實負載**

改寫 `bench/physics.bench.ts` 全部內容：

```ts
import { bench, describe } from 'vitest'
import { createDiagnostics, createFlightState, stepDynamics } from '../src/physics/dynamics'
import { P51D } from '../src/specs/p51d'
import { BF109G6 } from '../src/specs/bf109g6'
import type { Controls } from '../src/physics/types'

/**
 * 物理步微基準。
 *
 * 驗收門檻（spec §3.10）：單步耗時必須 < 20 µs。
 * 超標代表熱路徑存在配置行為造成 GC 壓力，必須先修正。
 */
describe('stepDynamics', () => {
  const controls: Controls = { aileron: 0.3, elevator: 0.2, rudder: -0.1, throttle: 1.1 }
  const dt = 1 / 240

  const p51State = createFlightState(6000, 180)
  const p51Diag = createDiagnostics()
  bench('P-51D 單步', () => {
    stepDynamics(P51D, p51State, controls, dt, p51Diag)
  })

  const bfState = createFlightState(6000, 180)
  const bfDiag = createDiagnostics()
  bench('Bf 109 G-6 單步（含縫翼判定）', () => {
    stepDynamics(BF109G6, bfState, controls, dt, bfDiag)
  })
})
```

- [ ] **Step 6: 執行基準並確認未超標**

Run: `npm run bench`

**驗收門檻：兩個 bench 的平均耗時都必須 < 20 µs/步。**

若超標，依序檢查：
1. `aeroForceMoment` 或 `stepDynamics` 內是否有 `new Vector3()` / `new Quaternion()` / 物件字面值
2. `enginePower` 內每步呼叫 `atmosphere(gear.altCritical, ...)`——若成為熱點，改為在模組載入時預先計算各檔位的 `sigmaCrit` 並快取於 `WeakMap<AircraftSpec, number[]>`
3. `Math.pow` 呼叫次數（`controlEffectiveness` 每步三次）

- [ ] **Step 7: Commit**

```bash
git add src/physics/dynamics.ts test/unit/dynamics.test.ts bench/physics.bench.ts
git commit -m "feat: 6DOF 剛體積分

半隱式 Euler、四元數一階積分後正規化、含陀螺項的角加速度。
diag.slatsDeployed 承載縫翼遲滯狀態。
微基準替換為真實負載，驗證 20 µs/步門檻。"
```

---

## Task 13：準靜態包絡求解器

**Files:**
- Create: `src/analysis/envelope.ts`
- Test: `test/unit/envelope.test.ts`

**Interfaces:**
- Consumes: `atmosphere`、`liftCoefficient` / `dragCoefficient` / `controlEffectiveness` / `inducedDragFactor`、`enginePower` / `propThrust` / `WEP_THROTTLE`、`derivedClMax`、`G0`
- Produces（全部為純函數，SI 單位）：
  - `maxLoadFactorAero(spec, altitude, tas): number`
  - `stallSpeed(spec, altitude, loadFactor): number`
  - `dragAt(spec, altitude, tas, loadFactor): number`
  - `thrustAt(spec, altitude, tas, throttle): number`
  - `specificExcessPower(spec, altitude, tas, loadFactor, throttle): number`
  - `maxLevelSpeed(spec, altitude, throttle): number`
  - `maxClimbRate(spec, altitude, throttle): { rate: number; speed: number }`
  - `serviceCeiling(spec, throttle): number`
  - `instantaneousTurnRate(spec, altitude, tas): number`
  - `sustainedTurnRate(spec, altitude, tas, throttle): number`
  - `cornerSpeed(spec, altitude): number`
  - `maxRollRate(spec, altitude, tas): number`

**Spec 修訂 3 與 5 於此落實。** 以解析與二分搜尋直接求穩態，比跑 240 Hz 積分器快兩個數量級且確定性高。L2 / L3 / EM 圖三者共用這一組函數；`src/tools/EmDiagram.ts` 只負責 Canvas 繪圖。

- [ ] **Step 1: 實作 src/analysis/envelope.ts**

```ts
import { G0 } from '../core/math'
import { atmosphere } from '../physics/atmosphere'
import {
  controlEffectiveness, dragCoefficient, inducedDragFactor,
} from '../physics/aero'
import { WEP_THROTTLE, enginePower, propThrust } from '../physics/propulsion'
import { derivedClMax, type AircraftSpec } from '../specs/types'
import type { AirData } from '../physics/types'

const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 高迎角時縫翼必然展開，故包絡計算一律採用展開後的 CL_max。 */
function clMaxFor(spec: AircraftSpec): number {
  return derivedClMax(spec, spec.lift.slatAlphaBonus > 0)
}

function weight(spec: AircraftSpec): number {
  return spec.mass * G0
}

/** 當前速度與高度下，氣動能提供的最大過載。 */
export function maxLoadFactorAero(spec: AircraftSpec, altitude: number, tas: number): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  return (qbar * spec.wing.area * clMaxFor(spec)) / weight(spec)
}

/** 指定過載下的失速速度，m/s TAS。 */
export function stallSpeed(spec: AircraftSpec, altitude: number, loadFactor: number): number {
  atmosphere(altitude, air)
  return Math.sqrt(
    (2 * loadFactor * weight(spec)) / (air.density * spec.wing.area * clMaxFor(spec)),
  )
}

/** 指定速度與過載下的總阻力，N。過載超出氣動極限時回傳 Infinity。 */
export function dragAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  loadFactor: number,
): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  if (qbar <= 0) return 0
  const qS = qbar * spec.wing.area
  const cl = (loadFactor * weight(spec)) / qS
  if (cl > clMaxFor(spec)) return Infinity
  const mach = tas / air.soundSpeed
  return qS * dragCoefficient(spec, cl, 0, mach)
}

/** 指定速度與高度下的可用推力，N。 */
export function thrustAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  throttle = WEP_THROTTLE,
): number {
  atmosphere(altitude, air)
  const mach = tas / air.soundSpeed
  const power = enginePower(spec, air, mach, throttle)
  return propThrust(spec, power, tas, air)
}

/** 比超量功率 Ps = V(T − D)/W，m/s。正值代表能量累積。 */
export function specificExcessPower(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  loadFactor: number,
  throttle = WEP_THROTTLE,
): number {
  const d = dragAt(spec, altitude, tas, loadFactor)
  if (!Number.isFinite(d)) return -Infinity
  return (tas * (thrustAt(spec, altitude, tas, throttle) - d)) / weight(spec)
}

const V_SEARCH_MAX = 400

/** 平飛極速，m/s TAS。以二分搜尋求 T − D = 0 的上根。 */
export function maxLevelSpeed(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): number {
  const excess = (v: number) => thrustAt(spec, altitude, v, throttle) - dragAt(spec, altitude, v, 1)

  let lo = stallSpeed(spec, altitude, 1) * 1.05
  if (excess(lo) <= 0) return 0 // 該高度已無法維持平飛

  let hi = V_SEARCH_MAX
  if (excess(hi) > 0) return hi

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (excess(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 最佳爬升率與對應速度。掃描後以黃金分割細化。 */
export function maxClimbRate(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): { rate: number; speed: number } {
  const vMin = stallSpeed(spec, altitude, 1) * 1.02
  const vMax = Math.max(maxLevelSpeed(spec, altitude, throttle), vMin + 1)

  let bestRate = -Infinity
  let bestSpeed = vMin
  const COARSE = 120
  for (let i = 0; i <= COARSE; i++) {
    const v = vMin + ((vMax - vMin) * i) / COARSE
    const ps = specificExcessPower(spec, altitude, v, 1, throttle)
    if (ps > bestRate) {
      bestRate = ps
      bestSpeed = v
    }
  }

  // 在最佳點鄰域細化
  const span = (vMax - vMin) / COARSE
  let lo = Math.max(vMin, bestSpeed - span)
  let hi = Math.min(vMax, bestSpeed + span)
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (specificExcessPower(spec, altitude, a, 1, throttle) <
        specificExcessPower(spec, altitude, b, 1, throttle)) lo = a
    else hi = b
  }
  const v = (lo + hi) / 2
  return { rate: specificExcessPower(spec, altitude, v, 1, throttle), speed: v }
}

const CEILING_RATE = 0.5

/** 實用升限，m。定義為最佳爬升率降至 0.5 m/s 的高度。 */
export function serviceCeiling(spec: AircraftSpec, throttle = WEP_THROTTLE): number {
  let lo = 0
  let hi = 20000
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (maxClimbRate(spec, mid, throttle).rate > CEILING_RATE) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 瞬間轉彎率，rad/s。取氣動與結構過載的較小者。 */
export function instantaneousTurnRate(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
): number {
  const n = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (n <= 1 || tas <= 0) return 0
  return (G0 * Math.sqrt(n * n - 1)) / tas
}

/** 持續轉彎率，rad/s。以二分搜尋求 Ps = 0 的過載。 */
export function sustainedTurnRate(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  throttle = WEP_THROTTLE,
): number {
  const nMax = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (nMax <= 1) return 0
  if (specificExcessPower(spec, altitude, tas, nMax, throttle) >= 0) {
    return (G0 * Math.sqrt(nMax * nMax - 1)) / tas
  }
  if (specificExcessPower(spec, altitude, tas, 1, throttle) < 0) return 0

  let lo = 1
  let hi = nMax
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (specificExcessPower(spec, altitude, mid, 1, throttle) >= 0) lo = mid
    else hi = mid
  }
  const n = lo
  return n <= 1 ? 0 : (G0 * Math.sqrt(n * n - 1)) / tas
}

/** 角落速度：氣動過載首次達到結構極限的速度，m/s。 */
export function cornerSpeed(spec: AircraftSpec, altitude: number): number {
  return stallSpeed(spec, altitude, spec.limits.gPositive)
}

/** 穩態最大滾轉率，rad/s。解 clDa·δa_eff + clP·(p·b/2V) = 0。 */
export function maxRollRate(spec: AircraftSpec, altitude: number, tas: number): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  const CS = spec.controlStiffening
  const da = controlEffectiveness(CS.aileronK, CS.qRef, qbar)
  return (spec.moments.clDa * da * 2 * tas) / (Math.abs(spec.moments.clP) * spec.wing.span)
}

// 供 EM 圖標註使用
export { inducedDragFactor }
```

- [ ] **Step 2: 寫測試**

`test/unit/envelope.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  maxLoadFactorAero, stallSpeed, dragAt, thrustAt, specificExcessPower,
  maxLevelSpeed, maxClimbRate, serviceCeiling, instantaneousTurnRate,
  sustainedTurnRate, cornerSpeed, maxRollRate,
} from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const KMH = 1 / 3.6
const RAD2DEG = 180 / Math.PI

describe('stallSpeed', () => {
  it('隨過載開根號成長', () => {
    const v1 = stallSpeed(P51D, 0, 1)
    const v4 = stallSpeed(P51D, 0, 4)
    expect(v4 / v1).toBeCloseTo(2, 6)
  })

  it('隨高度上升（密度下降）', () => {
    expect(stallSpeed(P51D, 6000, 1)).toBeGreaterThan(stallSpeed(P51D, 0, 1))
  })
})

describe('maxLoadFactorAero', () => {
  it('速度為失速速度時過載為 1', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(maxLoadFactorAero(P51D, 0, vs)).toBeCloseTo(1, 6)
  })

  it('隨速度平方成長', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(maxLoadFactorAero(P51D, 0, vs * 2)).toBeCloseTo(4, 6)
  })
})

describe('dragAt', () => {
  it('過載超出氣動極限時回傳 Infinity', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(dragAt(P51D, 0, vs, 3)).toBe(Infinity)
  })

  it('相同速度下過載愈高阻力愈大（誘導阻力）', () => {
    expect(dragAt(P51D, 3000, 200, 4)).toBeGreaterThan(dragAt(P51D, 3000, 200, 1))
  })
})

describe('maxLevelSpeed 與 Ps 的一致性', () => {
  it('極速處的 Ps 接近 0', () => {
    const v = maxLevelSpeed(P51D, 7600)
    expect(Math.abs(specificExcessPower(P51D, 7600, v, 1))).toBeLessThan(0.5)
  })

  it('極速以下 Ps 為正、以上為負', () => {
    const v = maxLevelSpeed(P51D, 5000)
    expect(specificExcessPower(P51D, 5000, v * 0.9, 1)).toBeGreaterThan(0)
    expect(specificExcessPower(P51D, 5000, v * 1.05, 1)).toBeLessThan(0)
  })

  it('推力在極速處等於阻力', () => {
    const v = maxLevelSpeed(BF109G6, 6300)
    expect(thrustAt(BF109G6, 6300, v)).toBeCloseTo(dragAt(BF109G6, 6300, v, 1), 0)
  })
})

describe('maxClimbRate', () => {
  it('最佳爬升速度介於失速速度與極速之間', () => {
    const { speed } = maxClimbRate(P51D, 0)
    expect(speed).toBeGreaterThan(stallSpeed(P51D, 0, 1))
    expect(speed).toBeLessThan(maxLevelSpeed(P51D, 0))
  })

  it('爬升率隨高度下降', () => {
    expect(maxClimbRate(P51D, 8000).rate).toBeLessThan(maxClimbRate(P51D, 0).rate)
  })
})

describe('serviceCeiling', () => {
  it('落在合理區間並高於 8,000 m', () => {
    const c = serviceCeiling(P51D)
    expect(c).toBeGreaterThan(8000)
    expect(c).toBeLessThan(16000)
  })

  it('升限處爬升率接近判定門檻', () => {
    const c = serviceCeiling(P51D)
    expect(maxClimbRate(P51D, c).rate).toBeCloseTo(0.5, 1)
  })
})

describe('轉彎性能', () => {
  it('持續轉彎率永不超過瞬間轉彎率', () => {
    for (const v of [120, 160, 200, 250, 300]) {
      expect(sustainedTurnRate(P51D, 0, v)).toBeLessThanOrEqual(
        instantaneousTurnRate(P51D, 0, v) + 1e-9,
      )
    }
  })

  it('角落速度落在 250–400 km/h 的合理區間', () => {
    const vc = cornerSpeed(P51D, 0) / KMH
    expect(vc).toBeGreaterThan(250)
    expect(vc).toBeLessThan(400)
  })

  it('角落速度處瞬間轉彎率達到峰值附近', () => {
    const vc = cornerSpeed(P51D, 0)
    const peak = instantaneousTurnRate(P51D, 0, vc)
    expect(instantaneousTurnRate(P51D, 0, vc * 0.8)).toBeLessThan(peak)
    expect(instantaneousTurnRate(P51D, 0, vc * 1.3)).toBeLessThan(peak)
  })

  it('低速持續轉彎率為正且落在合理範圍', () => {
    const rate = sustainedTurnRate(BF109G6, 0, 300 * KMH) * RAD2DEG
    expect(rate).toBeGreaterThan(5)
    expect(rate).toBeLessThan(35)
  })
})

describe('maxRollRate', () => {
  it('P-51 在 480 km/h 約 100 度/秒', () => {
    expect(maxRollRate(P51D, 0, 480 * KMH) * RAD2DEG).toBeCloseTo(100, -1)
  })

  it('Bf 109 在 400 km/h 約 80 度/秒', () => {
    expect(maxRollRate(BF109G6, 0, 400 * KMH) * RAD2DEG).toBeCloseTo(80, -1)
  })

  it('Bf 109 在 650 km/h 因副翼變重而大幅衰減', () => {
    const r = maxRollRate(BF109G6, 0, 650 * KMH) * RAD2DEG
    expect(r).toBeGreaterThan(20)
    expect(r).toBeLessThan(45)
  })
})
```

- [ ] **Step 3: 執行測試**

Run: `npx vitest run test/unit/envelope.test.ts`

預期：PASS。滾轉率三項若不符，調整對應機種的 `clDa`（決定基準值）與 `aileronK`（決定高速衰減斜率）——這正是 Task 9 標記為調參旋鈕的參數。

- [ ] **Step 4: Commit**

```bash
git add src/analysis/envelope.ts test/unit/envelope.test.ts
git commit -m "feat: 準靜態包絡求解器

以解析與二分搜尋直接求穩態，取代跑積分器到收斂（Spec 修訂 3），
快兩個數量級且結果確定。L2/L3 測試與 EM 圖共用同一組函數
（Spec 修訂 5：求解與繪圖分離）。"
```

---

## Task 14：L2 史實性能測試與調參

**Files:**
- Create: `test/performance/historical.test.ts`
- Modify: `src/specs/p51d.ts`, `src/specs/bf109g6.ts`（調參直到測試通過）

**Interfaces:**
- Consumes: `src/analysis/envelope.ts` 全部函數、`*_HISTORICAL` 參考值
- Produces: 無新介面。本任務的產出是**調校後的機種參數**。

**這是 M1 的第一個真正驗收關卡。** 測試先寫，然後調整參數直到通過。

**允許調整的參數（Task 9 標記為「調參」者）：** `cd0`、`oswald`、`clAlpha`、`alphaZero`、`alphaCrit`、`stallBlend`、`postStallFactor`、`machCrit`、`machDragFactor`、`etaMax`、`vRef`、`figureOfMerit`、`ramEfficiency`、慣量、全部力矩導數與 `controlStiffening`。

**禁止調整（硬數據）：** `mass`、`wing.area`、`wing.span`、`wing.chord`、`prop.diameter`、`engine.gears` 的功率與臨界高度、`limits`。

**預期的調參方向**（規劃期實算結果，供實作者參考起點）：

```
P-51D 海平面極速初算約 563 km/h，目標 595 km/h（−5.4%，略微超標）
  → 主要旋鈕：cd0 由 0.0163 下調至約 0.0150，或 etaMax 由 0.85 上調至約 0.88
  → 兩者擇一或併用，但 cd0 不宜低於 0.014（層流翼的物理下限）

P-51D 7,600 m 極速依賴 ramEfficiency。若偏低，先確認 ram 已生效
  （見 Task 11 的「ram 使 7,600 m 高速時功率顯著高於靜止」測試）

爬升率若偏低，優先調 etaMax 與 vRef（低速螺旋槳效率），
  而非降低 cd0——後者會連帶把極速推高而破壞已通過的項目
```

- [ ] **Step 1: 寫測試**

`test/performance/historical.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const TOLERANCE = 0.05
const KMH = 3.6

function expectWithin(actual: number, expected: number, label: string) {
  const err = Math.abs(actual - expected) / expected
  if (err > TOLERANCE) {
    throw new Error(
      `${label}：實測 ${actual.toFixed(2)}，史實 ${expected.toFixed(2)}，` +
      `誤差 ${(err * 100).toFixed(1)}% 超過 ±${TOLERANCE * 100}%`,
    )
  }
  expect(err).toBeLessThanOrEqual(TOLERANCE)
}

const CASES: { spec: AircraftSpec; hist: HistoricalReference }[] = [
  { spec: P51D, hist: P51D_HISTORICAL },
  { spec: BF109G6, hist: BF109G6_HISTORICAL },
]

describe('L2 史實性能（±5%）', () => {
  for (const { spec, hist } of CASES) {
    describe(spec.name, () => {
      it(`臨界高度 ${hist.vmaxAtCritical.altitude} m 極速`, () => {
        const v = maxLevelSpeed(spec, hist.vmaxAtCritical.altitude)
        expectWithin(v * KMH, hist.vmaxAtCritical.speed * KMH, '臨界高度極速 (km/h)')
      })

      it('海平面極速', () => {
        expectWithin(maxLevelSpeed(spec, 0) * KMH, hist.vmaxSeaLevel * KMH, '海平面極速 (km/h)')
      })

      it('海平面爬升率', () => {
        expectWithin(maxClimbRate(spec, 0).rate, hist.climbRateSeaLevel, '海平面爬升率 (m/s)')
      })

      it('海平面失速速度', () => {
        expectWithin(stallSpeed(spec, 0, 1) * KMH, hist.stallSpeed * KMH, '失速速度 (km/h)')
      })

      it('實用升限', () => {
        expectWithin(serviceCeiling(spec), hist.serviceCeiling, '實用升限 (m)')
      })

      it('極速在臨界高度附近達到峰值', () => {
        const critical = hist.vmaxAtCritical.altitude
        const peak = maxLevelSpeed(spec, critical)
        expect(maxLevelSpeed(spec, critical - 3000)).toBeLessThan(peak)
        expect(maxLevelSpeed(spec, critical + 3000)).toBeLessThan(peak)
      })
    })
  }
})
```

- [ ] **Step 2: 執行測試並記錄全部偏差**

Run: `npx vitest run test/performance/historical.test.ts`

預期：**初次執行會有數項失敗。** 這是預期的。錯誤訊息會列出每一項的實測值、史實值與誤差百分比。將全部 12 項的結果抄錄下來，作為調參的基準。

- [ ] **Step 3: 調參 P-51D 直到六項全綠**

依 Step 2 的偏差方向調整 `src/specs/p51d.ts` 的調參旋鈕。每次只改一個參數，重跑測試，觀察各項的連動。

調參順序建議（由影響最大到最小）：
1. `etaMax` / `vRef` — 同時影響極速與爬升率
2. `cd0` — 主要影響極速，高速端影響更大
3. `ramEfficiency` — 只影響高速高空
4. `oswald` — 主要影響低速與爬升
5. `alphaCrit` — 只影響失速速度與 CL_max（注意會連帶影響 Task 9 的 ±8% 測試）

**每次調參後必須重跑 `npx vitest run`（全部測試）**，確認沒有打破 Task 9–13 已通過的項目。

- [ ] **Step 4: 調參 Bf 109 G-6 直到六項全綠**

同 Step 3，對 `src/specs/bf109g6.ts` 進行。

注意 109 的失速速度受 `slatAlphaBonus` 影響（包絡計算採縫翼展開的 CL_max）——若失速速度偏低，優先檢查 `slatAlphaBonus` 是否過大。

- [ ] **Step 5: 執行完整測試套件**

Run: `npm test`
預期：全部測試 PASS，包含先前任務的所有測試。

- [ ] **Step 6: 執行型別檢查**

Run: `npx tsc --noEmit`
預期：無輸出。

- [ ] **Step 7: Commit**

```bash
git add src/specs test/performance/historical.test.ts
git commit -m "test: L2 史實性能測試並完成調參

兩台飛機的臨界高度極速、海平面極速、海平面爬升率、
失速速度、實用升限全部落在史實值 ±5% 內。
調參僅動用氣動與效率旋鈕，質量/翼面積/引擎功率等
硬數據維持史實值不變。"
```

---

## Task 15：L3 平衡關係測試

**Files:**
- Create: `test/balance/relative.test.ts`
- Modify: `src/specs/*.ts`（若有相對關係不成立時微調）

**Interfaces:**
- Consumes: `src/analysis/envelope.ts`
- Produces: 無新介面。

**這組測試驗證的是「兩台飛機的性格」，與絕對數值無關。** 即使將來調整全域參數，只要相對關係成立，戰術定位就沒有跑掉。這是 L2 無法涵蓋的維度——L2 全綠但兩台飛機打起來感覺一樣，遊戲就失敗了。

- [ ] **Step 1: 寫測試**

`test/balance/relative.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, sustainedTurnRate, instantaneousTurnRate,
  maxRollRate, specificExcessPower, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const KMH = 1 / 3.6

describe('L3 平衡關係', () => {
  describe('速度與高空', () => {
    it('P-51 臨界高度極速高於 Bf 109', () => {
      expect(maxLevelSpeed(P51D, 7600)).toBeGreaterThan(maxLevelSpeed(BF109G6, 6300))
    })

    it('P-51 在 7,600 m 的速度優勢超過 60 km/h', () => {
      const diff = (maxLevelSpeed(P51D, 7600) - maxLevelSpeed(BF109G6, 7600)) / KMH
      expect(diff).toBeGreaterThan(60)
    })

    it('P-51 升限高於 Bf 109', () => {
      expect(serviceCeiling(P51D)).toBeGreaterThan(serviceCeiling(BF109G6))
    })

    it('高度愈高 P-51 的優勢愈大', () => {
      const low = maxLevelSpeed(P51D, 0) - maxLevelSpeed(BF109G6, 0)
      const high = maxLevelSpeed(P51D, 8000) - maxLevelSpeed(BF109G6, 8000)
      expect(high).toBeGreaterThan(low)
    })
  })

  describe('爬升與盤旋', () => {
    it('Bf 109 海平面爬升率優於 P-51', () => {
      expect(maxClimbRate(BF109G6, 0).rate).toBeGreaterThan(maxClimbRate(P51D, 0).rate)
    })

    it('Bf 109 在 300 km/h 的持續轉彎率優於 P-51', () => {
      expect(sustainedTurnRate(BF109G6, 0, 300 * KMH)).toBeGreaterThan(
        sustainedTurnRate(P51D, 0, 300 * KMH),
      )
    })

    it('Bf 109 低速瞬間轉彎率優於 P-51（縫翼效果）', () => {
      expect(instantaneousTurnRate(BF109G6, 0, 250 * KMH)).toBeGreaterThan(
        instantaneousTurnRate(P51D, 0, 250 * KMH),
      )
    })
  })

  describe('滾轉', () => {
    it('P-51 在 600 km/h 的滾轉率超過 Bf 109 的 1.5 倍', () => {
      const p = maxRollRate(P51D, 0, 600 * KMH)
      const b = maxRollRate(BF109G6, 0, 600 * KMH)
      expect(p).toBeGreaterThan(b * 1.5)
    })

    it('低速時兩者滾轉率差距不大（109 的弱點只在高速）', () => {
      const p = maxRollRate(P51D, 0, 350 * KMH)
      const b = maxRollRate(BF109G6, 0, 350 * KMH)
      expect(b).toBeGreaterThan(p * 0.6)
    })
  })

  describe('能量保持（Boom & Zoom 的物理基礎）', () => {
    it('P-51 高速平飛的 Ps 優於 Bf 109（層流翼低阻）', () => {
      const v = 550 * KMH
      expect(specificExcessPower(P51D, 5000, v, 1)).toBeGreaterThan(
        specificExcessPower(BF109G6, 5000, v, 1),
      )
    })

    it('P-51 在大 G 高速時的能量流失小於 Bf 109', () => {
      const v = 500 * KMH
      expect(specificExcessPower(P51D, 3000, v, 4)).toBeGreaterThan(
        specificExcessPower(BF109G6, 3000, v, 4),
      )
    })

    it('兩台飛機大 G 轉彎時 Ps 皆為顯著負值（能量戰成立）', () => {
      const v = 450 * KMH
      expect(specificExcessPower(P51D, 3000, v, 5)).toBeLessThan(-20)
      expect(specificExcessPower(BF109G6, 3000, v, 5)).toBeLessThan(-20)
    })
  })

  describe('交叉優勢區間存在（避免單方全面碾壓）', () => {
    it('存在 Bf 109 佔優的速度區間', () => {
      let found = false
      for (let kmh = 250; kmh <= 400; kmh += 10) {
        if (sustainedTurnRate(BF109G6, 0, kmh * KMH) > sustainedTurnRate(P51D, 0, kmh * KMH)) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    })

    it('存在 P-51 佔優的速度區間', () => {
      let found = false
      for (let kmh = 500; kmh <= 700; kmh += 20) {
        if (specificExcessPower(P51D, 3000, kmh * KMH, 1) >
            specificExcessPower(BF109G6, 3000, kmh * KMH, 1)) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    })
  })
})
```

- [ ] **Step 2: 執行測試**

Run: `npx vitest run test/balance/relative.test.ts`

若有失敗，依下表微調。**每次調整後必須重跑 L2**（`npx vitest run test/performance`）確認史實性能仍在 ±5% 內。

| 失敗項目 | 主要旋鈕 |
|---|---|
| P-51 高空優勢不足 | `P51D.engine.ramEfficiency` ↑ 或 `BF109G6.drag.cd0` ↑ |
| Bf 109 爬升率沒贏 | `BF109G6.prop.etaMax` ↑ 或 `BF109G6.wing.oswald` ↑ |
| Bf 109 持續轉彎沒贏 | `BF109G6.wing.oswald` ↑（誘導阻力下降）或 `slatAlphaBonus` ↑ |
| 滾轉率倍率不足 | `BF109G6.controlStiffening.aileronK` ↑ |
| 大 G 能量流失不夠 | 檢查 `inducedDragFactor`——通常代表 `oswald` 設得過高 |

- [ ] **Step 3: 執行完整測試套件**

Run: `npm test`
預期：全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add test/balance/relative.test.ts src/specs
git commit -m "test: L3 平衡關係測試

以相對斷言驗證兩台飛機的戰術性格：
P-51 高速/高空/滾轉/能量保持佔優，
Bf 109 爬升/低速盤旋佔優，且確認雙方各有優勢區間。
與絕對數值無關，全域參數變動後仍能守住戰術定位。"
```

---

## Task 16：積分器與求解器交叉驗證

**Files:**
- Create: `test/integration/integrator.test.ts`
- Modify: `src/analysis/envelope.ts`（新增 `alphaForCl`）

**Interfaces:**
- Consumes: `stepDynamics` / `createFlightState` / `createDiagnostics`（Task 12）、`src/analysis/envelope.ts`
- Produces: `alphaForCl(spec: AircraftSpec, cl: number): number`（新增至 envelope）

**這個任務補回 Spec 修訂 3 的覆蓋率缺口。** L2 / L3 用的是準靜態求解器，完全沒有跑到積分器。若兩者的物理不一致（例如座標軸轉換寫反、力矩符號錯誤），L2 全綠但實際飛起來完全不對。

**驗證方法：比較比超量功率 Ps。**

```
Es = h + V²/(2g)                        比能量
Ps = dEs/dt                             比超量功率

積分器側：跑一步，量測 (Es_後 − Es_前) / dt
求解器側：specificExcessPower(spec, h, V, n)

重力是保守力，在 Es 中自動抵銷，因此兩者應相等，
與飛行路徑角無關。這一項相等，代表氣動、推進、
座標轉換、積分四者完全一致。
```

- [ ] **Step 1: 新增 alphaForCl 至 src/analysis/envelope.ts**

在檔案末尾（`export { inducedDragFactor }` 之前）加入：

```ts
/**
 * 由目標升力係數反解迎角（僅適用線性段）。
 * 供交叉驗證測試建立指定過載的飛行狀態。
 */
export function alphaForCl(spec: AircraftSpec, cl: number): number {
  return cl / spec.lift.clAlpha + spec.lift.alphaZero
}
```

- [ ] **Step 2: 寫測試**

`test/integration/integrator.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import {
  alphaForCl, maxLevelSpeed, specificExcessPower, stallSpeed,
} from '../../src/analysis/envelope'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { G0, clamp } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { AirData, Controls } from '../../src/physics/types'

const DT = 1 / 240
const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 比能量 Es = h + V²/(2g)，公尺。 */
function specificEnergy(altitude: number, speed: number): number {
  return altitude + (speed * speed) / (2 * G0)
}

/**
 * 建立指定高度、速度、過載的狀態。
 * 姿態維持單位四元數，改以傾斜速度向量產生所需迎角，
 * 避免測試相依於姿態運算。
 */
function stateAt(spec: AircraftSpec, altitude: number, tas: number, n: number) {
  atmosphere(altitude, air)
  const qS = 0.5 * air.density * tas * tas * spec.wing.area
  const cl = (n * spec.mass * G0) / qS
  const alpha = alphaForCl(spec, cl)
  const s = createFlightState(altitude, tas)
  s.velocity.set(0, -tas * Math.sin(alpha), -tas * Math.cos(alpha))
  return s
}

describe('積分器 vs 求解器：Ps 一致性', () => {
  const CASES = [
    { spec: P51D, altitude: 0, tas: 150, n: 1 },
    { spec: P51D, altitude: 3000, tas: 180, n: 1 },
    { spec: P51D, altitude: 7600, tas: 190, n: 1 },
    { spec: P51D, altitude: 3000, tas: 180, n: 3 },
    { spec: BF109G6, altitude: 0, tas: 140, n: 1 },
    { spec: BF109G6, altitude: 6300, tas: 175, n: 1 },
    { spec: BF109G6, altitude: 2000, tas: 160, n: 4 },
  ]

  for (const c of CASES) {
    it(`${c.spec.name} @ ${c.altitude}m ${Math.round(c.tas * 3.6)}km/h n=${c.n}`, () => {
      const s = stateAt(c.spec, c.altitude, c.tas, c.n)
      const diag = createDiagnostics()
      const before = specificEnergy(s.position.y, s.velocity.length())

      // 先跑一步讓 diag 填入，再量測下一步的 Es 變化
      stepDynamics(c.spec, s, { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }, DT, diag)
      const after = specificEnergy(s.position.y, s.velocity.length())
      const measured = (after - before) / DT

      const expected = specificExcessPower(c.spec, c.altitude, c.tas, c.n, WEP_THROTTLE)

      expect(Number.isFinite(measured)).toBe(true)
      expect(measured).toBeCloseTo(expected, 0)
      expect(Math.abs(measured - expected)).toBeLessThan(Math.max(1, Math.abs(expected) * 0.03))
    })
  }
})

describe('積分器收斂至求解器的極速', () => {
  /** 高度保持 PD 控制器，僅用於本測試。 */
  function altitudeHold(targetAlt: number, altitude: number, vy: number): number {
    return clamp(0.0025 * (targetAlt - altitude) - 0.06 * vy, -1, 1)
  }

  const CASES = [
    { spec: P51D, altitude: 3000 },
    { spec: P51D, altitude: 7600 },
    { spec: BF109G6, altitude: 6300 },
  ]

  for (const c of CASES) {
    it(`${c.spec.name} @ ${c.altitude}m 平飛極速誤差 < 2%`, () => {
      const target = maxLevelSpeed(c.spec, c.altitude)
      // 由失速速度上方起飛，全油門加速 300 秒
      const s = createFlightState(c.altitude, stallSpeed(c.spec, c.altitude, 1) * 1.3)
      const diag = createDiagnostics()
      const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }

      const steps = Math.round(300 / DT)
      for (let i = 0; i < steps; i++) {
        controls.elevator = altitudeHold(c.altitude, s.position.y, s.velocity.y)
        stepDynamics(c.spec, s, controls, DT, diag)
      }

      // 高度必須保持住，否則測的不是平飛極速
      expect(Math.abs(s.position.y - c.altitude)).toBeLessThan(300)

      const err = Math.abs(s.velocity.length() - target) / target
      expect(err).toBeLessThan(0.02)
    })
  }
})

describe('積分器長時間穩定性', () => {
  it('連續機動 120 秒後狀態仍為有限值且四元數正規化', () => {
    const s = createFlightState(5000, 180)
    const diag = createDiagnostics()
    const steps = Math.round(120 / DT)
    for (let i = 0; i < steps; i++) {
      const t = i * DT
      stepDynamics(P51D, s, {
        aileron: Math.sin(t * 0.7),
        elevator: 0.4 * Math.sin(t * 0.31) + 0.2,
        rudder: 0.2 * Math.sin(t * 0.17),
        throttle: WEP_THROTTLE,
      }, DT, diag)
      if (s.position.y < 100) s.position.y = 5000 // 撞海即重置高度，維持測試進行
    }
    expect(Number.isFinite(s.position.length())).toBe(true)
    expect(Number.isFinite(s.velocity.length())).toBe(true)
    expect(s.orientation.length()).toBeCloseTo(1, 9)
    expect(s.angularVelocity.length()).toBeLessThan(20)
  })

  it('無控輸入時姿態不會自發發散（靜穩定）', () => {
    const s = createFlightState(5000, 170)
    s.angularVelocity.set(0.3, 0.2, 0.4)
    const diag = createDiagnostics()
    const steps = Math.round(20 / DT)
    for (let i = 0; i < steps; i++) {
      stepDynamics(P51D, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }, DT, diag)
    }
    // 阻尼應使角速度大幅衰減
    expect(s.angularVelocity.length()).toBeLessThan(0.5)
  })
})

describe('海面碰撞前提', () => {
  it('無升力時飛機會下墜至海平面以下（供 Task 20 的墜毀判定使用）', () => {
    const s = createFlightState(200, 0)
    const diag = createDiagnostics()
    const noWing: AircraftSpec = { ...P51D, wing: { ...P51D.wing, area: 0 } }
    for (let i = 0; i < Math.round(10 / DT); i++) {
      stepDynamics(noWing, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }, DT, diag)
    }
    expect(s.position.y).toBeLessThan(0)
  })
})

// Vector3 供型別推導使用
void Vector3
```

- [ ] **Step 3: 移除未使用的匯入**

刪除測試檔尾端的 `void Vector3` 與對應的 `import { Vector3 }`（若確實未使用）。

- [ ] **Step 4: 執行測試**

Run: `npx vitest run test/integration/integrator.test.ts`

**這是整個 M1-A 階段最重要的一組測試。** 若「Ps 一致性」失敗：

| 症狀 | 可能原因 |
|---|---|
| 積分器 Ps 恆為求解器的相反數 | `stdToBody` 或推力方向符號反了 |
| 大過載時才不一致 | 誘導阻力在兩邊算法不同（檢查 `dragAt` 與 `aeroForceMoment` 是否都用 `inducedDragFactor`） |
| 高空才不一致 | `enginePower` 在兩邊收到的 `mach` 不同（求解器用 `tas/soundSpeed`，積分器用 `diag.aero.mach`） |
| 全面偏差固定比例 | 升力方向分解錯誤（檢查風軸 → 標準軸的 `sa`/`ca` 項） |

若「收斂至極速」失敗但「Ps 一致性」通過，問題出在高度保持控制器而非物理——放寬 PD 增益或延長模擬時間。

- [ ] **Step 5: 執行完整測試套件與型別檢查**

Run: `npm test && npx tsc --noEmit`
預期：全部 PASS，無型別錯誤。

- [ ] **Step 6: Commit**

```bash
git add test/integration/integrator.test.ts src/analysis/envelope.ts
git commit -m "test: 積分器與求解器交叉驗證

以比能量變化率 Ps 比對兩條路徑（Spec 修訂 3 的覆蓋率補回）。
重力為保守力在 Es 中自動抵銷，因此該項相等即代表
氣動、推進、座標轉換、積分四者完全一致。
另含 300 秒收斂至極速、120 秒機動穩定性、靜穩定衰減測試。"
```

---

**M1-A 完成檢查點：** 飛行模型物理層完成。兩台飛機的史實性能落在 ±5%，相對性格關係成立，積分器與求解器交叉驗證通過，微基準未超標。此時尚無操控與畫面，但**飛行模型本身已可驗收**。

---

# Phase M1-B：操控

## Task 17：PID 控制器與限制器

**Files:**
- Create: `src/control/pid.ts`, `src/control/limiters.ts`
- Test: `test/control/pid.test.ts`, `test/control/limiters.test.ts`

**Interfaces:**
- Consumes: `clamp` / `G0`、`AircraftSpec`、`AirData` / `AeroState`、`liftCoefficient`
- Produces:
  - `Pid` class：`constructor(gains: PidGains)`、`update(error: number, dt: number): number`、`reset(): void`、`gains: PidGains`（可變更，供調參面板即時調整）
  - `PidGains = { kp: number; ki: number; kd: number; integralLimit: number; outputLimit: number }`
  - `PILOT_G_POSITIVE`（6.5）、`PILOT_G_NEGATIVE`（−3）、`ALPHA_MARGIN`（0.95）
  - `LimiterSource = 'alpha' | 'structure' | 'pilot' | 'none'`
  - `PitchLimit = { qMax: number; nLimit: number; nAero: number; source: LimiterSource }`
  - `createPitchLimit(): PitchLimit`
  - `pitchRateLimit(spec, air, aero, slatsDeployed, out: PitchLimit): PitchLimit`

**設計意圖（spec §8.3，此為能量戰成立與否的分水嶺）：** 限制器只防止玩家把飛機拉到失速，**不阻止玩家把能量拉光**。低速時 `nAero` 很小 → `qMax` 很低 → 飛機轉不動；高速大 G 時限制器完全不介入 → 玩家可盡情拉 G，然後看著速度暴跌。

- [ ] **Step 1: 寫 PID 測試**

`test/control/pid.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Pid } from '../../src/control/pid'

const gains = { kp: 1, ki: 0, kd: 0, integralLimit: 1, outputLimit: 1 }

describe('Pid', () => {
  it('純比例項輸出等於 kp × 誤差', () => {
    const p = new Pid({ ...gains, kp: 0.5 })
    expect(p.update(0.4, 0.01)).toBeCloseTo(0.2, 10)
  })

  it('輸出受 outputLimit 夾制', () => {
    const p = new Pid({ ...gains, kp: 10, outputLimit: 1 })
    expect(p.update(5, 0.01)).toBe(1)
    expect(p.update(-5, 0.01)).toBe(-1)
  })

  it('積分項隨時間累積', () => {
    const p = new Pid({ ...gains, kp: 0, ki: 1, integralLimit: 10, outputLimit: 10 })
    p.update(1, 0.5)
    expect(p.update(1, 0.5)).toBeCloseTo(1, 6)
  })

  it('積分項受 integralLimit 夾制（防積分飽和）', () => {
    const p = new Pid({ ...gains, kp: 0, ki: 1, integralLimit: 0.3, outputLimit: 10 })
    for (let i = 0; i < 100; i++) p.update(1, 0.1)
    expect(p.update(1, 0.1)).toBeCloseTo(0.3, 6)
  })

  it('微分項響應誤差變化率', () => {
    const p = new Pid({ ...gains, kp: 0, kd: 0.1, outputLimit: 10 })
    p.update(0, 0.1)
    expect(p.update(1, 0.1)).toBeCloseTo(1, 6) // Δe/Δt = 1/0.1 = 10，×0.1 = 1
  })

  it('首次呼叫時微分項不產生突波', () => {
    const p = new Pid({ ...gains, kp: 0, kd: 1, outputLimit: 100 })
    expect(p.update(5, 0.01)).toBe(0)
  })

  it('reset 清除積分與微分狀態', () => {
    const p = new Pid({ ...gains, kp: 0, ki: 1, integralLimit: 10, outputLimit: 10 })
    for (let i = 0; i < 10; i++) p.update(1, 0.1)
    p.reset()
    expect(p.update(0, 0.1)).toBeCloseTo(0, 10)
  })

  it('dt 為 0 時不產生 NaN', () => {
    const p = new Pid({ ...gains, kp: 1, ki: 1, kd: 1, outputLimit: 10 })
    p.update(1, 0.01)
    expect(Number.isFinite(p.update(1, 0))).toBe(true)
  })

  it('gains 可即時變更（供調參面板使用）', () => {
    const p = new Pid({ ...gains, kp: 1 })
    expect(p.update(0.5, 0.01)).toBeCloseTo(0.5, 10)
    p.gains.kp = 2
    expect(p.update(0.5, 0.01)).toBeCloseTo(1, 10)
  })
})
```

- [ ] **Step 2: 實作 src/control/pid.ts**

```ts
import { clamp } from '../core/math'

export interface PidGains {
  kp: number
  ki: number
  kd: number
  /** 積分項的絕對值上限，防止積分飽和 */
  integralLimit: number
  /** 輸出絕對值上限 */
  outputLimit: number
}

export class Pid {
  /** 可直接修改，供調參面板即時調整。 */
  readonly gains: PidGains
  private integral = 0
  private prevError = 0
  private hasPrev = false

  constructor(gains: PidGains) {
    this.gains = { ...gains }
  }

  reset(): void {
    this.integral = 0
    this.prevError = 0
    this.hasPrev = false
  }

  update(error: number, dt: number): number {
    const g = this.gains
    let out = g.kp * error

    if (dt > 0) {
      this.integral = clamp(this.integral + error * dt, -g.integralLimit, g.integralLimit)
      out += g.ki * this.integral
      if (this.hasPrev) out += (g.kd * (error - this.prevError)) / dt
    }

    this.prevError = error
    this.hasPrev = true
    return clamp(out, -g.outputLimit, g.outputLimit)
  }
}
```

- [ ] **Step 3: 執行 PID 測試確認通過**

Run: `npx vitest run test/control/pid.test.ts`
預期：PASS，9 個測試全綠。

- [ ] **Step 4: 寫限制器測試**

`test/control/limiters.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  ALPHA_MARGIN, PILOT_G_POSITIVE, createPitchLimit, pitchRateLimit,
} from '../../src/control/limiters'
import { atmosphere } from '../../src/physics/atmosphere'
import { computeAeroState } from '../../src/physics/aero'
import { stallSpeed } from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { Vector3 } from 'three'
import type { AeroState, AirData } from '../../src/physics/types'

function setup(altitude: number, tas: number) {
  const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }
  atmosphere(altitude, air)
  const aero: AeroState = { tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 }
  computeAeroState(new Vector3(0, 0, -tas), air, aero)
  return { air, aero }
}

describe('pitchRateLimit', () => {
  it('失速速度附近可用過載接近 1，迎角為限制來源', () => {
    const vs = stallSpeed(P51D, 0, 1)
    const { air, aero } = setup(0, vs)
    const out = pitchRateLimit(P51D, air, aero, false, createPitchLimit())
    expect(out.nLimit).toBeLessThan(1.3)
    expect(out.source).toBe('alpha')
  })

  it('高速時由飛行員或結構限制接手', () => {
    const { air, aero } = setup(0, 200)
    const out = pitchRateLimit(P51D, air, aero, false, createPitchLimit())
    expect(out.source === 'pilot' || out.source === 'structure').toBe(true)
    expect(out.nLimit).toBeLessThanOrEqual(P51D.limits.gPositive)
  })

  it('可用過載永不超過結構極限', () => {
    for (const v of [80, 150, 250, 350]) {
      const { air, aero } = setup(0, v)
      const out = pitchRateLimit(P51D, air, aero, false, createPitchLimit())
      expect(out.nLimit).toBeLessThanOrEqual(P51D.limits.gPositive + 1e-9)
    }
  })

  it('可用過載永不超過飛行員極限', () => {
    const { air, aero } = setup(0, 300)
    const out = pitchRateLimit(P51D, air, aero, false, createPitchLimit())
    expect(out.nLimit).toBeLessThanOrEqual(PILOT_G_POSITIVE + 1e-9)
  })

  it('qMax 隨速度上升先增後受過載上限壓平', () => {
    const rates: number[] = []
    for (const v of [80, 120, 160, 200, 260, 320]) {
      const { air, aero } = setup(0, v)
      rates.push(pitchRateLimit(P51D, air, aero, false, createPitchLimit()).qMax)
    }
    expect(rates[1]!).toBeGreaterThan(rates[0]!)
    // 高速段因 qMax = n·g/V 而遞減
    expect(rates[5]!).toBeLessThan(rates[3]!)
  })

  it('低速時 qMax 顯著低於高速峰值（能量不足的直接體現）', () => {
    const slow = setup(0, 70)
    const fast = setup(0, 160)
    const qSlow = pitchRateLimit(P51D, slow.air, slow.aero, false, createPitchLimit()).qMax
    const qFast = pitchRateLimit(P51D, fast.air, fast.aero, false, createPitchLimit()).qMax
    expect(qSlow).toBeLessThan(qFast * 0.6)
  })

  it('Bf 109 縫翼展開時可用過載高於未展開', () => {
    const { air, aero } = setup(0, 110)
    const clean = pitchRateLimit(BF109G6, air, aero, false, createPitchLimit()).nAero
    const slats = pitchRateLimit(BF109G6, air, aero, true, createPitchLimit()).nAero
    expect(slats).toBeGreaterThan(clean)
  })

  it('高空同速度下可用過載低於海平面', () => {
    const low = setup(0, 180)
    const high = setup(8000, 180)
    const nLow = pitchRateLimit(P51D, low.air, low.aero, false, createPitchLimit()).nAero
    const nHigh = pitchRateLimit(P51D, high.air, high.aero, false, createPitchLimit()).nAero
    expect(nHigh).toBeLessThan(nLow)
  })

  it('迎角餘裕使 nAero 低於理論 CL_max 對應值', () => {
    expect(ALPHA_MARGIN).toBeLessThan(1)
    expect(ALPHA_MARGIN).toBeGreaterThan(0.8)
  })

  it('零速度不產生 NaN', () => {
    const { air, aero } = setup(0, 0)
    const out = pitchRateLimit(P51D, air, aero, false, createPitchLimit())
    expect(Number.isFinite(out.qMax)).toBe(true)
    expect(Number.isFinite(out.nLimit)).toBe(true)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const { air, aero } = setup(0, 180)
    const out = createPitchLimit()
    expect(pitchRateLimit(P51D, air, aero, false, out)).toBe(out)
  })
})
```

- [ ] **Step 5: 實作 src/control/limiters.ts**

```ts
import { G0 } from '../core/math'
import { liftCoefficient } from '../physics/aero'
import type { AircraftSpec } from '../specs/types'
import type { AeroState, AirData } from '../physics/types'

/** 飛行員持續耐 G 上限。超過此值畫面開始漸暗（黑視）。 */
export const PILOT_G_POSITIVE = 6.5
export const PILOT_G_NEGATIVE = -3
/** 迎角指令相對於失速迎角的餘裕比例。 */
export const ALPHA_MARGIN = 0.95

export type LimiterSource = 'alpha' | 'structure' | 'pilot' | 'none'

export interface PitchLimit {
  /** 期望俯仰率上限，rad/s */
  qMax: number
  /** 實際採用的過載上限 */
  nLimit: number
  /** 純氣動可達的過載（未計結構與飛行員限制） */
  nAero: number
  source: LimiterSource
}

export function createPitchLimit(): PitchLimit {
  return { qMax: 0, nLimit: 1, nAero: 1, source: 'none' }
}

/**
 * 計算期望俯仰率上限。
 *
 * 限制作用在「期望角速度」而非舵面上——指揮儀只負責
 * 不要求飛機做做不到的事，物理層永遠是唯一的真相。
 *
 * 注意本函數只擋失速，不擋能量流失：高速大 G 時
 * 限制器完全不介入，玩家可盡情拉 G 並承受速度暴跌。
 */
export function pitchRateLimit(
  spec: AircraftSpec,
  air: AirData,
  aero: AeroState,
  slatsDeployed: boolean,
  out: PitchLimit,
): PitchLimit {
  const clAtMargin = liftCoefficient(
    spec,
    spec.lift.alphaCrit * ALPHA_MARGIN + (slatsDeployed ? spec.lift.slatAlphaBonus : 0),
    slatsDeployed,
  )
  const nAero = (aero.qbar * spec.wing.area * clAtMargin) / (spec.mass * G0)
  out.nAero = nAero

  let nLimit = nAero
  let source: LimiterSource = 'alpha'
  if (spec.limits.gPositive < nLimit) {
    nLimit = spec.limits.gPositive
    source = 'structure'
  }
  if (PILOT_G_POSITIVE < nLimit) {
    nLimit = PILOT_G_POSITIVE
    source = 'pilot'
  }

  out.nLimit = Math.max(nLimit, 0)
  out.source = source
  // 拉升過載 n 對應的俯仰率近似 q = n·g/V
  out.qMax = aero.tas > 1 ? (out.nLimit * G0) / aero.tas : 0
  return out
}
```

- [ ] **Step 6: 執行限制器測試確認通過**

Run: `npx vitest run test/control/limiters.test.ts`
預期：PASS，11 個測試全綠。

- [ ] **Step 7: Commit**

```bash
git add src/control/pid.ts src/control/limiters.ts test/control
git commit -m "feat: PID 控制器與 G / 迎角限制器

PID 含積分飽和防護與可即時變更的 gains（供調參面板）。
限制器作用於期望角速度而非舵面，只擋失速、不擋能量流失——
這是能量戰能否成立的分水嶺（spec 8.3）。"
```

---

## Task 18：飛行指揮儀與 L4 矩陣測試

**Files:**
- Create: `src/control/FlightDirector.ts`
- Test: `test/control/director.test.ts`

**Interfaces:**
- Consumes: `Pid` / `PidGains`（Task 17）、`pitchRateLimit` / `PitchLimit` / `PILOT_G_NEGATIVE`、`stepDynamics` 的狀態型別、`clamp` / `G0`
- Produces:
  - `DirectorGains`、`DEFAULT_DIRECTOR_GAINS`
  - `DirectorDebug`、`createDirectorDebug(): DirectorDebug`
  - `FlightDirector` class：`gains`、`reset()`、`update(spec, state, air, aero, slatsDeployed, aimDirWorld, dt, out: Controls, dbg: DirectorDebug): void`

**這是整個 M1 風險最高的元件。** `DirectorDebug` 就是 spec §8.4 承諾的歸因面板資料來源：期望角速度與實際角速度並列，手感不對時可直接判定是氣動問題還是 PID 問題。

**Bank-To-Turn 的核心推導：**

```
aimBody = 目標方向轉入機體座標（單位向量）
機首方向在機體座標恆為 (0, 0, −1)

errorAngle    = atan2( hypot(aimBody.x, aimBody.y), −aimBody.z )   總誤差角
verticalError = atan2( aimBody.y, −aimBody.z )                     俯仰面誤差
lateralError  = atan2( aimBody.x, −aimBody.z )                     偏航面誤差

rollCommand   = atan2( aimBody.x, aimBody.y )
  目標在正上方 (x=0, y>0) → atan2(0, y) = 0     不需滾轉 ✓
  目標在正右方 (x>0, y=0) → atan2(x, 0) = π/2   右滾 90° ✓
  向右滾 φ 會把方位角 φ 的目標轉到正上方，之後拉升降舵即可
```

**兩個必要的特例（spec §8.2，不做會有明顯 bug）：**
1. `errorAngle < deadZoneAngle`（3°）時 `rollCommand = 0`，改為維持當前滾轉。否則飛機正對目標時會持續左右滾轉。
2. 目標接近正後方時 `atan2(x, y)` 的兩個引數同時趨近 0，方向數學上不定 → 沿用上一幀的 `rollCommand`（遲滯鎖定一側）。

- [ ] **Step 1: 實作 src/control/FlightDirector.ts**

```ts
import { Quaternion, Vector3 } from 'three'
import { G0, clamp } from '../core/math'
import { makeScratch } from '../core/pool'
import { Pid, type PidGains } from './pid'
import {
  PILOT_G_NEGATIVE, createPitchLimit, pitchRateLimit, type PitchLimit,
} from './limiters'
import type { AircraftSpec } from '../specs/types'
import type { AeroState, AirData, Controls, FlightState } from '../physics/types'

const S = makeScratch(2, 1)

export interface DirectorGains {
  /** 外環：滾轉角誤差 → 期望滾轉率，(rad/s)/rad */
  rollOuter: number
  /** 外環：俯仰角誤差 → 期望俯仰率 */
  pitchOuter: number
  /** 外環：側滑消除增益 */
  yawOuter: number
  /** 外環：方向舵微量輔助瞄準的增益 */
  yawAim: number
  rollInner: PidGains
  pitchInner: PidGains
  yawInner: PidGains
  /** 誤差小於此角度時停止滾轉修正，rad */
  deadZoneAngle: number
  /** 目標接近正後方時的遲滯半徑，rad */
  reverseHysteresis: number
  /** 期望滾轉率的絕對上限，rad/s */
  maxRollRateCommand: number
}

export const DEFAULT_DIRECTOR_GAINS: DirectorGains = {
  rollOuter: 3.0,
  pitchOuter: 2.5,
  yawOuter: 1.5,
  yawAim: 0.5,
  rollInner: { kp: 0.45, ki: 0.12, kd: 0.02, integralLimit: 2, outputLimit: 1 },
  pitchInner: { kp: 1.6, ki: 0.5, kd: 0.04, integralLimit: 1.5, outputLimit: 1 },
  yawInner: { kp: 1.2, ki: 0.3, kd: 0.02, integralLimit: 1, outputLimit: 1 },
  deadZoneAngle: 3 * (Math.PI / 180),
  reverseHysteresis: 5 * (Math.PI / 180),
  maxRollRateCommand: 6,
}

/** 歸因面板資料（spec §8.4）：指揮儀指令與物理實際響應並列。 */
export interface DirectorDebug {
  errorAngle: number
  verticalError: number
  lateralError: number
  rollCommand: number
  desiredP: number
  desiredQ: number
  desiredR: number
  actualP: number
  actualQ: number
  actualR: number
  limiter: PitchLimit
}

export function createDirectorDebug(): DirectorDebug {
  return {
    errorAngle: 0, verticalError: 0, lateralError: 0, rollCommand: 0,
    desiredP: 0, desiredQ: 0, desiredR: 0,
    actualP: 0, actualQ: 0, actualR: 0,
    limiter: createPitchLimit(),
  }
}

export class FlightDirector {
  readonly gains: DirectorGains
  private readonly rollPid: Pid
  private readonly pitchPid: Pid
  private readonly yawPid: Pid
  private lastRollCommand = 0

  constructor(gains: DirectorGains = DEFAULT_DIRECTOR_GAINS) {
    this.gains = structuredClone(gains)
    this.rollPid = new Pid(this.gains.rollInner)
    this.pitchPid = new Pid(this.gains.pitchInner)
    this.yawPid = new Pid(this.gains.yawInner)
  }

  reset(): void {
    this.rollPid.reset()
    this.pitchPid.reset()
    this.yawPid.reset()
    this.lastRollCommand = 0
  }

  /**
   * 由滑鼠指向的世界空間目標方向產生舵面指令。
   * 不修改 out.throttle——油門由玩家直接控制。
   */
  update(
    spec: AircraftSpec,
    state: FlightState,
    air: AirData,
    aero: AeroState,
    slatsDeployed: boolean,
    aimDirWorld: Vector3,
    dt: number,
    out: Controls,
    dbg: DirectorDebug,
  ): void {
    const invQ: Quaternion = S.q[0]!.copy(state.orientation).invert()
    const aimBody = S.v[0]!.copy(aimDirWorld).normalize().applyQuaternion(invQ)

    const forward = -aimBody.z
    const lateralMag = Math.hypot(aimBody.x, aimBody.y)

    dbg.errorAngle = Math.atan2(lateralMag, forward)
    dbg.verticalError = Math.atan2(aimBody.y, forward)
    dbg.lateralError = Math.atan2(aimBody.x, forward)

    // 滾轉指令：把誤差轉進俯仰面
    const g = this.gains
    if (dbg.errorAngle < g.deadZoneAngle) {
      dbg.rollCommand = 0
    } else if (lateralMag < Math.sin(g.reverseHysteresis)) {
      // 目標接近機首正後方，方位角不定 → 沿用上一幀，避免抖動
      dbg.rollCommand = this.lastRollCommand
    } else {
      dbg.rollCommand = Math.atan2(aimBody.x, aimBody.y)
    }
    this.lastRollCommand = dbg.rollCommand

    // 限制器：只擋失速，不擋能量流失
    pitchRateLimit(spec, air, aero, slatsDeployed, dbg.limiter)
    const qMaxNeg = aero.tas > 1 ? (PILOT_G_NEGATIVE * G0) / aero.tas : 0

    dbg.desiredP = clamp(
      g.rollOuter * dbg.rollCommand, -g.maxRollRateCommand, g.maxRollRateCommand,
    )
    dbg.desiredQ = clamp(g.pitchOuter * dbg.verticalError, qMaxNeg, dbg.limiter.qMax)
    dbg.desiredR =
      g.yawOuter * -aero.beta + g.yawAim * clamp(dbg.lateralError, -0.1, 0.1)

    // 實際角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
    const w = state.angularVelocity
    dbg.actualP = -w.z
    dbg.actualQ = w.x
    dbg.actualR = -w.y

    out.aileron = this.rollPid.update(dbg.desiredP - dbg.actualP, dt)
    out.elevator = this.pitchPid.update(dbg.desiredQ - dbg.actualQ, dt)
    out.rudder = this.yawPid.update(dbg.desiredR - dbg.actualR, dt)
  }
}

void S.v[1]
```

- [ ] **Step 2: 移除未使用的暫存**

刪除檔尾的 `void S.v[1]`，並把 `makeScratch(2, 1)` 改為 `makeScratch(1, 1)`。

- [ ] **Step 3: 寫 L4 矩陣測試**

`test/control/director.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { FlightDirector, createDirectorDebug } from '../../src/control/FlightDirector'
import { createDiagnostics, createFlightState, stepDynamics } from '../../src/physics/dynamics'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { DEG, RAD } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls } from '../../src/physics/types'

const DT = 1 / 240
const KMH = 1 / 3.6

interface RunResult {
  errorHistory: number[]
  maxAlpha: number
  maxLoad: number
  minLoad: number
  finalError: number
  aileronHistory: number[]
}

function runDirector(
  spec: AircraftSpec,
  rollDeg: number,
  aimDirWorld: Vector3,
  tas: number,
  seconds: number,
): RunResult {
  const state = createFlightState(6000, tas)
  state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), rollDeg * DEG)

  const director = new FlightDirector()
  const diag = createDiagnostics()
  const dbg = createDirectorDebug()
  const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }

  const errorHistory: number[] = []
  const aileronHistory: number[] = []
  let maxAlpha = -Infinity
  let maxLoad = -Infinity
  let minLoad = Infinity

  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    stepDynamics(spec, state, controls, DT, diag)
    director.update(
      spec, state, diag.air, diag.aero, diag.slatsDeployed,
      aimDirWorld, DT, controls, dbg,
    )
    errorHistory.push(dbg.errorAngle)
    aileronHistory.push(controls.aileron)
    maxAlpha = Math.max(maxAlpha, Math.abs(diag.aero.alpha))
    maxLoad = Math.max(maxLoad, diag.loadFactor)
    minLoad = Math.min(minLoad, diag.loadFactor)
  }

  return {
    errorHistory, aileronHistory, maxAlpha, maxLoad, minLoad,
    finalError: errorHistory[errorHistory.length - 1]!,
  }
}

/** 距機首 offsetDeg、方位 azimuthDeg 的世界空間目標方向。機首恆為 −Z。 */
function aimAt(offsetDeg: number, azimuthDeg: number): Vector3 {
  const o = offsetDeg * DEG
  const a = azimuthDeg * DEG
  return new Vector3(
    Math.sin(o) * Math.sin(a),
    Math.sin(o) * Math.cos(a),
    -Math.cos(o),
  ).normalize()
}

function alphaCritOf(spec: AircraftSpec): number {
  return spec.lift.alphaCrit + spec.lift.slatAlphaBonus
}

describe('L4 指揮儀矩陣（120 案例）', () => {
  const ROLLS = [0, 45, 90, 135, 180]
  const AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315]
  const SPEEDS = [200, 400, 600]
  const SECONDS = 8
  const TOLERANCE_DEG = 6

  for (const roll of ROLLS) {
    for (const az of AZIMUTHS) {
      for (const kmh of SPEEDS) {
        it(`滾轉${roll}° 方位${az}° ${kmh}km/h`, () => {
          const r = runDirector(P51D, roll, aimAt(25, az), kmh * KMH, SECONDS)

          // 收斂：末段誤差需落在容許值內
          const tail = r.errorHistory.slice(-Math.round(2 / DT))
          const maxTail = Math.max(...tail) * RAD
          expect(maxTail).toBeLessThan(TOLERANCE_DEG)

          // 不震盪：末段誤差標準差需夠小
          const mean = tail.reduce((a, b) => a + b, 0) / tail.length
          const sd = Math.sqrt(
            tail.reduce((s, v) => s + (v - mean) ** 2, 0) / tail.length,
          ) * RAD
          expect(sd).toBeLessThan(1.5)

          // 限制器有效：全程未失速、未超載
          expect(r.maxAlpha).toBeLessThan(alphaCritOf(P51D))
          expect(r.maxLoad).toBeLessThan(P51D.limits.gPositive)
          expect(r.minLoad).toBeGreaterThan(P51D.limits.gNegative)

          expect(Number.isFinite(r.finalError)).toBe(true)
        })
      }
    }
  }
})

describe('指揮儀特例', () => {
  it('誤差為 0 時滾轉指令不抖動（spec 8.2 特例一）', () => {
    const r = runDirector(P51D, 0, new Vector3(0, 0, -1), 400 * KMH, 5)
    const tail = r.aileronHistory.slice(-Math.round(2 / DT))
    for (const a of tail) expect(Math.abs(a)).toBeLessThan(0.25)
    // 不應出現高頻正負交替
    let flips = 0
    for (let i = 1; i < tail.length; i++) {
      if (Math.sign(tail[i]!) !== Math.sign(tail[i - 1]!)) flips++
    }
    expect(flips).toBeLessThan(tail.length * 0.15)
  })

  it('目標在正後方時不產生 NaN 或發散（spec 8.2 特例二）', () => {
    const r = runDirector(P51D, 0, new Vector3(0, 0, 1), 400 * KMH, 6)
    expect(Number.isFinite(r.finalError)).toBe(true)
    expect(r.maxAlpha).toBeLessThan(alphaCritOf(P51D))
    // 應已大幅轉向，誤差顯著下降
    expect(r.finalError * RAD).toBeLessThan(60)
  })

  it('低速時因限制器介入而轉不動（能量不足的直接體現）', () => {
    const slow = runDirector(P51D, 0, aimAt(60, 0), 160 * KMH, 3)
    const fast = runDirector(P51D, 0, aimAt(60, 0), 450 * KMH, 3)
    // 相同時間內，高速的誤差收斂得更多
    expect(fast.finalError).toBeLessThan(slow.finalError)
    // 低速時仍不得失速
    expect(slow.maxAlpha).toBeLessThan(alphaCritOf(P51D))
  })

  it('Bf 109 在 600 km/h 的滾轉響應明顯慢於 P-51（副翼變重）', () => {
    const p = runDirector(P51D, 0, aimAt(25, 90), 600 * KMH, 2)
    const b = runDirector(BF109G6, 0, aimAt(25, 90), 600 * KMH, 2)
    expect(b.finalError).toBeGreaterThan(p.finalError)
  })

  it('reset 後 PID 積分項不殘留', () => {
    const d = new FlightDirector()
    const state = createFlightState(5000, 150)
    const diag = createDiagnostics()
    const dbg = createDirectorDebug()
    const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }
    for (let i = 0; i < 500; i++) {
      stepDynamics(P51D, state, controls, DT, diag)
      d.update(P51D, state, diag.air, diag.aero, false, aimAt(45, 90), DT, controls, dbg)
    }
    d.reset()
    state.angularVelocity.set(0, 0, 0)
    d.update(P51D, state, diag.air, diag.aero, false, new Vector3(0, 0, -1), DT, controls, dbg)
    expect(Math.abs(controls.aileron)).toBeLessThan(0.05)
  })
})
```

- [ ] **Step 4: 執行測試（預期需要調整增益）**

Run: `npx vitest run test/control/director.test.ts`

**初次執行預期會有部分案例失敗。** 這是本任務的主要工作：調整 `DEFAULT_DIRECTOR_GAINS` 直到 120 個案例全綠。

診斷對照表——**先看 `DirectorDebug` 的哪一組數字不對，再決定調哪個增益**：

| 症狀 | 判讀 | 調整 |
|---|---|---|
| 末段標準差過大（震盪） | `desiredP/Q` 平穩但 `actualP/Q` 震盪 | 內環 `kp` 調降、`kd` 調升 |
| 末段標準差過大（震盪） | `desiredP/Q` 本身就在震盪 | 外環 `rollOuter`/`pitchOuter` 調降 |
| 收斂太慢 | `actualQ` 長期低於 `desiredQ` | 內環 `kp` 調升；若 `limiter.source` 恆為 `alpha` 則是速度不足，非增益問題 |
| 誤差殘留不歸零 | `desiredQ` 已達但誤差仍在 | 內環 `ki` 調升 |
| 滾轉過衝後反覆修正 | `rollCommand` 反覆變號 | `deadZoneAngle` 調大 |
| 高速案例失敗、低速通過 | 舵面權限被 `controlStiffening` 壓縮 | 屬機種特性，非增益問題——放寬該案例或接受 |

- [ ] **Step 5: 執行完整測試套件**

Run: `npm test`
預期：全部 PASS。特別確認 L2 / L3 未因任何改動而失效。

- [ ] **Step 6: Commit**

```bash
git add src/control/FlightDirector.ts test/control/director.test.ts
git commit -m "feat: 飛行指揮儀（Bank-To-Turn + 串級 PID）

rollCommand = atan2(aimBody.x, aimBody.y) 把誤差轉進俯仰面，
外環角度誤差 → 期望角速度，內環 PID → 舵面。
含死區與正後方遲滯兩個特例處理。
DirectorDebug 提供 spec 8.4 的歸因面板資料。
L4 矩陣 120 案例驗證收斂、不震盪、不失速、不超載。"
```

---

## Task 19：輸入層與瞄準方向

**Files:**
- Create: `src/input/InputState.ts`, `src/input/bindings.ts`, `src/input/aim.ts`
- Test: `test/unit/aim.test.ts`

**Interfaces:**
- Consumes: `clamp`
- Produces:
  - `InputState` 與 `createInputState(): InputState`
  - `AIM_RADIUS`（0.35）、`attachInput(canvas: HTMLCanvasElement, state: InputState): () => void`
  - `aimDirectionBody(aimX: number, aimY: number, fovYRad: number, out: Vector3): Vector3`

**瞄準座標系約定：** `aimX` / `aimY` 的單位是「螢幕半高」，因此夾制圓是真正的圓（不受畫面寬高比影響）。`AIM_RADIUS = 0.35` 表示準星可移動範圍是以畫面中心為圓心、半徑為螢幕半高 35% 的圓。

**關鍵設計：瞄準方向以機體座標計算，不經過相機。**

```
aimDirBody = normalize( (aimX·tan(fov/2), aimY·tan(fov/2), −1) )
aimDirWorld = aimDirBody 套用 orientation
```

兩個必然的結果，都是正確的行為：

1. **準星偏離中心 → 飛機持續轉彎。** 因為方向隨機體轉動而轉動，誤差不會歸零，飛機建立穩定轉彎率。這正是滑鼠瞄準模式應有的操作感——把滑鼠推到右邊，飛機就一直右轉。
2. **右鍵自由視角不影響飛行。** 因為瞄準方向與相機無關，轉動視角自然不會改變飛機指令，不需額外的凍結邏輯。

（Task 18 的 L4 測試使用固定的世界方向，那是為了驗證控制器的收斂特性；兩種用法都成立，不衝突。）

- [ ] **Step 1: 寫測試**

`test/unit/aim.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { aimDirectionBody } from '../../src/input/aim'
import { AIM_RADIUS, createInputState } from '../../src/input/InputState'
import { DEG } from '../../src/core/math'

const FOV = 65 * DEG

describe('aimDirectionBody', () => {
  it('準星在中心時方向為機首（機體 −Z）', () => {
    const d = aimDirectionBody(0, 0, FOV, new Vector3())
    expect(d.x).toBeCloseTo(0, 12)
    expect(d.y).toBeCloseTo(0, 12)
    expect(d.z).toBeCloseTo(-1, 12)
  })

  it('準星向右產生 +X 分量', () => {
    expect(aimDirectionBody(0.3, 0, FOV, new Vector3()).x).toBeGreaterThan(0)
  })

  it('準星向上產生 +Y 分量', () => {
    expect(aimDirectionBody(0, 0.3, FOV, new Vector3()).y).toBeGreaterThan(0)
  })

  it('回傳單位向量', () => {
    expect(aimDirectionBody(0.35, -0.2, FOV, new Vector3()).length()).toBeCloseTo(1, 12)
  })

  it('偏移角隨 FOV 增大而增大', () => {
    const narrow = aimDirectionBody(0.3, 0, 40 * DEG, new Vector3())
    const wide = aimDirectionBody(0.3, 0, 90 * DEG, new Vector3())
    expect(Math.abs(wide.x)).toBeGreaterThan(Math.abs(narrow.x))
  })

  it('夾制圓邊緣的偏移角小於半個 FOV', () => {
    const d = aimDirectionBody(AIM_RADIUS, 0, FOV, new Vector3())
    const angle = Math.acos(-d.z)
    expect(angle).toBeLessThan(FOV / 2)
  })

  it('寫入傳入的 out 並回傳同一參考', () => {
    const out = new Vector3()
    expect(aimDirectionBody(0.1, 0.1, FOV, out)).toBe(out)
  })
})

describe('createInputState', () => {
  it('初始值合理', () => {
    const s = createInputState()
    expect(s.aimX).toBe(0)
    expect(s.aimY).toBe(0)
    expect(s.throttle).toBeGreaterThan(0)
    expect(s.throttle).toBeLessThanOrEqual(1.1)
    expect(s.lookActive).toBe(false)
    expect(s.viewMode).toBe('third')
  })
})
```

- [ ] **Step 2: 實作 src/input/InputState.ts**

```ts
/** 準星可移動範圍的半徑，單位為螢幕半高。 */
export const AIM_RADIUS = 0.35

/** 油門初始值：巡航設定（spec 中的「預設 1 倍速」）。 */
export const CRUISE_THROTTLE = 0.7

export interface InputState {
  /** 準星水平位置，單位螢幕半高，夾制於 AIM_RADIUS 圓內 */
  aimX: number
  /** 準星垂直位置，單位螢幕半高 */
  aimY: number
  /** 0 ~ 1.1，1.1 為 WEP */
  throttle: number
  /** 右鍵是否按住 */
  lookActive: boolean
  /** 自由視角偏移，rad */
  lookYaw: number
  lookPitch: number
  viewMode: 'third' | 'first'
  /** 單幀旗標，消費後由呼叫端清除 */
  resetRequested: boolean
  /** 單幀旗標，切換機種 */
  swapSpecRequested: boolean
}

export function createInputState(): InputState {
  return {
    aimX: 0,
    aimY: 0,
    throttle: CRUISE_THROTTLE,
    lookActive: false,
    lookYaw: 0,
    lookPitch: 0,
    viewMode: 'third',
    resetRequested: false,
    swapSpecRequested: false,
  }
}
```

- [ ] **Step 3: 實作 src/input/aim.ts**

```ts
import type { Vector3 } from 'three'

/**
 * 由準星的螢幕位置產生機體座標的瞄準方向。
 *
 * 不經過相機——這使得右鍵自由視角自然不會影響飛行指令，
 * 且準星偏離中心時飛機會建立穩定轉彎率（滑鼠瞄準模式的正確行為）。
 */
export function aimDirectionBody(
  aimX: number,
  aimY: number,
  fovYRad: number,
  out: Vector3,
): Vector3 {
  const t = Math.tan(fovYRad / 2)
  return out.set(aimX * t, aimY * t, -1).normalize()
}
```

- [ ] **Step 4: 實作 src/input/bindings.ts**

```ts
import { clamp } from '../core/math'
import { AIM_RADIUS, type InputState } from './InputState'

const MOUSE_SENSITIVITY = 1.6
const LOOK_SENSITIVITY = 2.4
const LOOK_YAW_LIMIT = 160 * (Math.PI / 180)
const LOOK_PITCH_LIMIT = 80 * (Math.PI / 180)
const THROTTLE_RATE = 0.6 // 每秒變化量

interface KeyHold {
  up: boolean
  down: boolean
}

/**
 * 綁定鍵鼠事件。回傳解除綁定的函數。
 * 呼叫端需每幀呼叫回傳物件的 tick(dt) 以套用油門的持續變化。
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  state: InputState,
): { detach(): void; tick(dt: number): void } {
  const hold: KeyHold = { up: false, down: false }

  const requestLock = () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock()
  }

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) requestLock()
    if (e.button === 2) state.lookActive = true
  }

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      state.lookActive = false
      state.lookYaw = 0
      state.lookPitch = 0
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return
    const half = window.innerHeight / 2
    if (state.lookActive) {
      state.lookYaw = clamp(
        state.lookYaw - (e.movementX / half) * LOOK_SENSITIVITY,
        -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT,
      )
      state.lookPitch = clamp(
        state.lookPitch - (e.movementY / half) * LOOK_SENSITIVITY,
        -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT,
      )
      return
    }
    state.aimX += (e.movementX / half) * MOUSE_SENSITIVITY
    state.aimY -= (e.movementY / half) * MOUSE_SENSITIVITY
    // 夾制於圓內，不是方形——否則對角線方向的操縱量會偏大
    const r = Math.hypot(state.aimX, state.aimY)
    if (r > AIM_RADIUS) {
      state.aimX = (state.aimX / r) * AIM_RADIUS
      state.aimY = (state.aimY / r) * AIM_RADIUS
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW': hold.up = true; break
      case 'KeyS': hold.down = true; break
      case 'KeyV': state.viewMode = state.viewMode === 'third' ? 'first' : 'third'; break
      case 'KeyR': state.resetRequested = true; break
      case 'KeyC': state.swapSpecRequested = true; break
      default: return
    }
    e.preventDefault()
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW') hold.up = false
    if (e.code === 'KeyS') hold.down = false
  }

  const onContextMenu = (e: Event) => e.preventDefault()

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('contextmenu', onContextMenu)

  return {
    detach() {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('contextmenu', onContextMenu)
    },
    tick(dt: number) {
      if (hold.up) state.throttle = clamp(state.throttle + THROTTLE_RATE * dt, 0, 1.1)
      if (hold.down) state.throttle = clamp(state.throttle - THROTTLE_RATE * dt, 0, 1.1)
    },
  }
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/unit/aim.test.ts`
預期：PASS，8 個測試全綠。

- [ ] **Step 6: Commit**

```bash
git add src/input test/unit/aim.test.ts
git commit -m "feat: 輸入層與瞄準方向

Pointer Lock 滑鼠、圓形準星夾制範圍、W/S 油門、V 視角、
右鍵自由視角。瞄準方向以機體座標計算而不經過相機——
自由視角因此自然不影響飛行指令，且準星偏離中心時
飛機建立穩定轉彎率。"
```

---

## Task 20：Aircraft 組裝與可飛行整合

**Files:**
- Create: `src/aircraft/Aircraft.ts`
- Modify: `src/main.ts`
- Test: `test/unit/aircraft.test.ts`

**Interfaces:**
- Consumes: 全部前述模組
- Produces:
  - `Aircraft` class：`spec` / `state` / `diag` / `controls` / `director` / `dbg` / `prevPosition` / `prevOrientation`
  - `update(aimDirBody: Vector3, throttle: number, dt: number): void`
  - `setSpec(spec: AircraftSpec): void`
  - `reset(altitude: number, tas: number): void`
  - `specificEnergy: number`（唯讀 getter，m）
  - `specificExcessPowerActual: number`（唯讀 getter，由前後兩步的 Es 差計算，m/s）

**一步的順序：`stepDynamics` 先、`director.update` 後。** 指揮儀的輸出套用於下一步，形成一步（4 ms）的延遲，實務上無法察覺，且與 Task 18 的 L4 測試順序一致——測試怎麼跑，遊戲就怎麼跑。

- [ ] **Step 1: 實作 src/aircraft/Aircraft.ts**

```ts
import { Quaternion, Vector3 } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import {
  createDiagnostics, createFlightState, stepDynamics, type StepDiagnostics,
} from '../physics/dynamics'
import {
  FlightDirector, createDirectorDebug, type DirectorDebug,
} from '../control/FlightDirector'
import type { AircraftSpec } from '../specs/types'
import type { Controls, FlightState } from '../physics/types'

const S = makeScratch(1)

export class Aircraft {
  spec: AircraftSpec
  state: FlightState
  readonly diag: StepDiagnostics = createDiagnostics()
  readonly controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }
  readonly director = new FlightDirector()
  readonly dbg: DirectorDebug = createDirectorDebug()

  /** 供渲染插值使用的前一步狀態。 */
  readonly prevPosition = new Vector3()
  readonly prevOrientation = new Quaternion()

  private lastEnergy = 0
  private psActual = 0

  constructor(spec: AircraftSpec, altitude = 4000, tas = 150) {
    this.spec = spec
    this.state = createFlightState(altitude, tas)
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)
    this.lastEnergy = this.specificEnergy
  }

  /** 比能量 Es = h + V²/(2g)，公尺。能量戰的統一貨幣。 */
  get specificEnergy(): number {
    const v = this.state.velocity.length()
    return this.state.position.y + (v * v) / (2 * G0)
  }

  /** 實測比超量功率，m/s。正值代表能量累積。 */
  get specificExcessPowerActual(): number {
    return this.psActual
  }

  setSpec(spec: AircraftSpec): void {
    this.spec = spec
    this.director.reset()
    this.diag.slatsDeployed = false
  }

  reset(altitude: number, tas: number): void {
    this.state = createFlightState(altitude, tas)
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)
    this.director.reset()
    this.diag.slatsDeployed = false
    this.controls.aileron = 0
    this.controls.elevator = 0
    this.controls.rudder = 0
    this.lastEnergy = this.specificEnergy
    this.psActual = 0
  }

  /**
   * 推進一個物理步。
   *
   * @param aimDirBody 機體座標的瞄準方向（由 aimDirectionBody 產生）
   * @param throttle   玩家油門，0 ~ 1.1
   */
  update(aimDirBody: Vector3, throttle: number, dt: number): void {
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)

    this.controls.throttle = throttle
    stepDynamics(this.spec, this.state, this.controls, dt, this.diag)

    // 機體座標的瞄準方向轉為世界方向後餵給指揮儀
    const aimWorld = S.v[0]!.copy(aimDirBody).applyQuaternion(this.state.orientation)
    this.director.update(
      this.spec, this.state, this.diag.air, this.diag.aero, this.diag.slatsDeployed,
      aimWorld, dt, this.controls, this.dbg,
    )

    const es = this.specificEnergy
    this.psActual = dt > 0 ? (es - this.lastEnergy) / dt : 0
    this.lastEnergy = es
  }
}
```

- [ ] **Step 2: 寫測試**

`test/unit/aircraft.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { aimDirectionBody } from '../../src/input/aim'
import { specificExcessPower } from '../../src/analysis/envelope'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { DEG } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const DT = 1 / 240
const FOV = 65 * DEG
const centre = aimDirectionBody(0, 0, FOV, new Vector3())

function fly(ac: Aircraft, aim: Vector3, throttle: number, seconds: number) {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) ac.update(aim, throttle, DT)
}

describe('Aircraft', () => {
  it('準星置中時大致維持直線飛行', () => {
    const ac = new Aircraft(P51D, 5000, 170)
    fly(ac, centre, 0.8, 5)
    expect(Math.abs(ac.state.position.x)).toBeLessThan(60)
    expect(ac.dbg.errorAngle).toBeLessThan(5 * DEG)
  })

  it('準星偏右時建立穩定右轉（航向持續改變）', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    const right = aimDirectionBody(0.3, 0, FOV, new Vector3())
    fly(ac, right, 1.0, 3)
    const headingA = Math.atan2(ac.state.velocity.x, -ac.state.velocity.z)
    fly(ac, right, 1.0, 2)
    const headingB = Math.atan2(ac.state.velocity.x, -ac.state.velocity.z)
    expect(headingB).not.toBeCloseTo(headingA, 2)
  })

  it('比能量在無動力時遞減', () => {
    const ac = new Aircraft(P51D, 6000, 200)
    const before = ac.specificEnergy
    fly(ac, centre, 0, 10)
    expect(ac.specificEnergy).toBeLessThan(before)
  })

  it('全油門平飛時 Ps 為正', () => {
    const ac = new Aircraft(P51D, 5000, 140)
    fly(ac, centre, WEP_THROTTLE, 3)
    expect(ac.specificExcessPowerActual).toBeGreaterThan(0)
  })

  it('大 G 轉彎時 Ps 顯著為負（能量戰的核心體感）', () => {
    const ac = new Aircraft(P51D, 4000, 250)
    const hardTurn = aimDirectionBody(0.35, 0.15, FOV, new Vector3())
    fly(ac, hardTurn, WEP_THROTTLE, 6)
    expect(ac.specificExcessPowerActual).toBeLessThan(-10)
    expect(ac.state.velocity.length()).toBeLessThan(250)
  })

  it('實測 Ps 與求解器在穩定平飛時接近', () => {
    const ac = new Aircraft(P51D, 5000, 160)
    fly(ac, centre, WEP_THROTTLE, 2)
    const expected = specificExcessPower(
      P51D, ac.state.position.y, ac.state.velocity.length(), 1, WEP_THROTTLE,
    )
    expect(Math.abs(ac.specificExcessPowerActual - expected)).toBeLessThan(6)
  })

  it('setSpec 切換機種並重置控制器', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    fly(ac, aimDirectionBody(0.3, 0.2, FOV, new Vector3()), 1, 2)
    ac.setSpec(BF109G6)
    expect(ac.spec.id).toBe('bf109g6')
    ac.update(centre, 1, DT)
    expect(Number.isFinite(ac.state.velocity.length())).toBe(true)
  })

  it('reset 恢復初始狀態', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    fly(ac, aimDirectionBody(0.3, 0, FOV, new Vector3()), 1, 4)
    ac.reset(3000, 150)
    expect(ac.state.position.y).toBe(3000)
    expect(ac.state.velocity.length()).toBeCloseTo(150, 6)
    expect(ac.state.angularVelocity.length()).toBe(0)
  })

  it('prevPosition 在每步更新，供渲染插值使用', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    ac.update(centre, 1, DT)
    const p1 = ac.prevPosition.clone()
    ac.update(centre, 1, DT)
    expect(ac.prevPosition.equals(p1)).toBe(false)
  })

  it('長時間連續機動不產生 NaN', () => {
    const ac = new Aircraft(BF109G6, 5000, 200)
    for (let i = 0; i < Math.round(60 / DT); i++) {
      const t = i * DT
      const aim = aimDirectionBody(0.3 * Math.sin(t * 0.5), 0.25 * Math.cos(t * 0.3), FOV, new Vector3())
      ac.update(aim, WEP_THROTTLE, DT)
      if (ac.state.position.y < 200) ac.reset(5000, 200)
    }
    expect(Number.isFinite(ac.state.position.length())).toBe(true)
    expect(ac.state.orientation.length()).toBeCloseTo(1, 9)
  })
})
```

- [ ] **Step 3: 執行測試確認通過**

Run: `npx vitest run test/unit/aircraft.test.ts`
預期：PASS，10 個測試全綠。

- [ ] **Step 4: 改寫 src/main.ts 接上完整飛行**

```ts
import { Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { createOcean } from './render/ocean'
import { createProps } from './render/props'
import { Aircraft } from './aircraft/Aircraft'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { aimDirectionBody } from './input/aim'
import { P51D } from './specs/p51d'
import { BF109G6 } from './specs/bf109g6'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const perf = createPerfOverlay(ctx.renderer)

const ocean = createOcean()
ctx.scene.add(ocean.mesh)
ctx.scene.add(createProps(600))

const START_ALTITUDE = 4000
const START_TAS = 160

const aircraft = new Aircraft(P51D, START_ALTITUDE, START_TAS)
const input = createInputState()
const bindings = attachInput(canvas, input)

const aimBody = new Vector3()
const renderPos = new Vector3()
const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
let lastTime = performance.now()
let elapsed = 0

function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now
  perf.begin()
  bindings.tick(frameSeconds)

  if (input.resetRequested) {
    aircraft.reset(START_ALTITUDE, START_TAS)
    input.resetRequested = false
  }
  if (input.swapSpecRequested) {
    aircraft.setSpec(aircraft.spec.id === 'p51d' ? BF109G6 : P51D)
    input.swapSpecRequested = false
  }

  aimDirectionBody(input.aimX, input.aimY, ctx.camera.fov * DEG, aimBody)

  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    aircraft.update(aimBody, input.throttle, dt)
    perf.endPhysics()
  })

  // 撞海判定
  const p = aircraft.state.position
  if (p.y <= ocean.heightAt(p.x, p.z, elapsed) + 2) {
    aircraft.reset(START_ALTITUDE, START_TAS)
  }

  renderPos.lerpVectors(aircraft.prevPosition, aircraft.state.position, alpha)
  elapsed += frameSeconds
  ocean.update(elapsed, renderPos.x, renderPos.z)

  // 暫時的跟隨相機，Task 22 會替換為完整的 CameraRig
  ctx.camera.position.set(renderPos.x, renderPos.y + 15, renderPos.z + 55)
  ctx.camera.lookAt(renderPos)

  ctx.renderer.render(ctx.scene, ctx.camera)
  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

- [ ] **Step 5: 人工驗證**

Run: `npm run dev`

點擊畫面取得 Pointer Lock 後確認：

1. 移動滑鼠 → 飛機跟著轉向；準星推到邊緣 → 持續轉彎
2. `W` / `S` → 油門變化（暫時只能從效能面板外觀察飛機加減速）
3. `R` → 重置
4. `C` → 切換機種，兩台飛機的轉彎與加速手感明顯不同
5. 一直拉住轉彎 → 速度肉眼可見地流失（誘導阻力）
6. 撞海 → 自動重置
7. 效能面板的 `per step` 仍低於 20 µs

**此時飛機還沒有機體模型（仍是不可見的），相機是暫時的，也還沒有 HUD。** 驗證重點是「操控是否有反應、手感方向是否正確」。

- [ ] **Step 6: 執行完整測試與型別檢查**

Run: `npm test && npx tsc --noEmit`
預期：全部 PASS，無型別錯誤。

- [ ] **Step 7: Commit**

```bash
git add src/aircraft/Aircraft.ts src/main.ts test/unit/aircraft.test.ts
git commit -m "feat: Aircraft 組裝與可飛行整合

Aircraft 封裝 state/diag/controls/director 並提供 Es 與實測 Ps。
main.ts 接上輸入、物理、撞海重置與機種切換。
一步順序為 stepDynamics 先、director 後，與 L4 測試一致。
此時已可實際操控飛行（尚無機體模型、正式相機與 HUD）。"
```

---

**M1-B 完成檢查點：** 飛機已可用滑鼠實際操控，能量戰的核心體感（大 G 轉彎掉速）已可親身感受。指揮儀 120 案例矩陣測試通過。剩餘工作全部是呈現層與工具。

---

# Phase M1-C：呈現與工具

## Task 21：程序化機體幾何

**Files:**
- Create: `src/render/geometry/fuselage.ts`, `src/render/geometry/wing.ts`, `src/render/geometry/silhouettes.ts`, `src/render/geometry/buildAircraft.ts`
- Test: `test/unit/geometry.test.ts`

**Interfaces:**
- Consumes: `AircraftSpec`
- Produces:
  - `FuselageSection = { z: number; halfWidth: number; halfHeight: number; centerY: number }`
  - `buildFuselage(sections: readonly FuselageSection[], radialSegments: number): BufferGeometry`
  - `WingParams`、`buildWingPanel(p: WingParams, mirrored: boolean): BufferGeometry`
  - `SILHOUETTES: Record<string, Silhouette>`
  - `AircraftModel = { group: Group; setSurfaces(a: number, e: number, r: number): void; setPropSpin(rotation: number, blurred: boolean): void; dispose(): void }`
  - `buildAircraft(spec: AircraftSpec): AircraftModel`

**舵面獨立可動在 M1 就要做**（spec §11.2）：它是「飛機正在做什麼」的即時視覺回饋，同時是指揮儀的除錯工具——可以直接看到副翼偏了幾度。

**外型必須一眼可辨**：P-51 淚滴座艙罩、大垂尾、腹部散熱器；Bf 109 方框座艙罩、短翼展、機首下方進氣口。

- [ ] **Step 1: 實作 src/render/geometry/fuselage.ts**

```ts
import { BufferAttribute, BufferGeometry } from 'three'

export interface FuselageSection {
  /** 沿機體 Z 軸的位置，負值為機首方向 */
  z: number
  halfWidth: number
  halfHeight: number
  /** 截面中心的垂直偏移 */
  centerY: number
}

/**
 * 以橢圓截面沿軸線 lofting 產生機身。
 * 首尾截面若半徑為 0 則自動收成尖端。
 */
export function buildFuselage(
  sections: readonly FuselageSection[],
  radialSegments = 8,
): BufferGeometry {
  const rings: number[][] = sections.map((s) => {
    const ring: number[] = []
    for (let i = 0; i < radialSegments; i++) {
      const t = (i / radialSegments) * Math.PI * 2
      ring.push(Math.cos(t) * s.halfWidth, s.centerY + Math.sin(t) * s.halfHeight, s.z)
    }
    return ring
  })

  const positions: number[] = []
  const pushTri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  const vertexOf = (ring: number[], i: number) => {
    const k = (i % radialSegments) * 3
    return [ring[k]!, ring[k + 1]!, ring[k + 2]!]
  }

  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s]!
    const b = rings[s + 1]!
    for (let i = 0; i < radialSegments; i++) {
      const a0 = vertexOf(a, i)
      const a1 = vertexOf(a, i + 1)
      const b0 = vertexOf(b, i)
      const b1 = vertexOf(b, i + 1)
      pushTri(a0, b0, b1)
      pushTri(a0, b1, a1)
    }
  }

  // 首尾封口
  const cap = (ring: number[], sec: FuselageSection, reverse: boolean) => {
    const centre = [0, sec.centerY, sec.z]
    for (let i = 0; i < radialSegments; i++) {
      const v0 = vertexOf(ring, i)
      const v1 = vertexOf(ring, i + 1)
      if (reverse) pushTri(centre, v1, v0)
      else pushTri(centre, v0, v1)
    }
  }
  cap(rings[0]!, sections[0]!, true)
  cap(rings[rings.length - 1]!, sections[sections.length - 1]!, false)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
```

- [ ] **Step 2: 實作 src/render/geometry/wing.ts**

```ts
import { BufferAttribute, BufferGeometry } from 'three'

export interface WingParams {
  /** 翼根弦長，m */
  rootChord: number
  tipChord: number
  /** 半翼展，m */
  halfSpan: number
  /** 前緣後掠角，rad */
  sweep: number
  /** 上反角，rad */
  dihedral: number
  thickness: number
  /** 翼根前緣在機體 Z 軸的位置 */
  rootZ: number
  rootY: number
}

/**
 * 梯形翼面板（含上反角與後掠角）。
 * mirrored = true 產生左翼（−X 方向）。
 */
export function buildWingPanel(p: WingParams, mirrored: boolean): BufferGeometry {
  const sx = mirrored ? -1 : 1
  const tipX = sx * p.halfSpan
  const tipY = p.rootY + Math.tan(p.dihedral) * p.halfSpan
  const tipLead = p.rootZ - Math.tan(p.sweep) * p.halfSpan
  const h = p.thickness / 2

  // 翼根前緣/後緣、翼尖前緣/後緣，上下各一層
  const corners: [number, number, number][] = [
    [0, p.rootY + h, p.rootZ], [0, p.rootY + h, p.rootZ + p.rootChord],
    [tipX, tipY + h, tipLead], [tipX, tipY + h, tipLead + p.tipChord],
    [0, p.rootY - h, p.rootZ], [0, p.rootY - h, p.rootZ + p.rootChord],
    [tipX, tipY - h, tipLead], [tipX, tipY - h, tipLead + p.tipChord],
  ]

  const faces = [
    [0, 2, 3], [0, 3, 1], // 上表面
    [4, 7, 6], [4, 5, 7], // 下表面
    [0, 4, 6], [0, 6, 2], // 前緣
    [1, 3, 7], [1, 7, 5], // 後緣
    [2, 6, 7], [2, 7, 3], // 翼尖
    [0, 1, 5], [0, 5, 4], // 翼根
  ]

  const positions: number[] = []
  for (const f of faces) {
    const tri = mirrored ? [f[0]!, f[2]!, f[1]!] : f
    for (const idx of tri) {
      const c = corners[idx as number]!
      positions.push(c[0], c[1], c[2])
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
```

- [ ] **Step 3: 實作 src/render/geometry/silhouettes.ts**

```ts
import { DEG } from '../../core/math'
import type { FuselageSection } from './fuselage'
import type { WingParams } from './wing'

export interface Silhouette {
  bodyColor: number
  accentColor: number
  fuselage: readonly FuselageSection[]
  wing: WingParams
  tailplane: WingParams
  /** 垂直安定面（以 WingParams 描述，dihedral 90° 立起） */
  fin: { chordRoot: number; chordTip: number; height: number; sweep: number; z: number }
  canopy: { z: number; length: number; halfWidth: number; height: number; teardrop: boolean }
  /** 機腹散熱器（P-51）或機首下方進氣口（Bf 109） */
  intake: { z: number; length: number; halfWidth: number; height: number; centerY: number }
  propZ: number
  propRadius: number
}

export const SILHOUETTES: Record<string, Silhouette> = {
  p51d: {
    bodyColor: 0x9aa7b4,
    accentColor: 0x2f3a46,
    fuselage: [
      { z: -4.9, halfWidth: 0.10, halfHeight: 0.10, centerY: 0.05 },
      { z: -4.2, halfWidth: 0.48, halfHeight: 0.52, centerY: 0.02 },
      { z: -2.6, halfWidth: 0.62, halfHeight: 0.72, centerY: 0.00 },
      { z: -0.6, halfWidth: 0.66, halfHeight: 0.78, centerY: 0.02 },
      { z: 1.6, halfWidth: 0.50, halfHeight: 0.60, centerY: 0.06 },
      { z: 3.6, halfWidth: 0.28, halfHeight: 0.36, centerY: 0.12 },
      { z: 4.6, halfWidth: 0.08, halfHeight: 0.14, centerY: 0.16 },
    ],
    wing: {
      rootChord: 2.75, tipChord: 1.30, halfSpan: 5.64,
      sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.34, rootZ: -1.5, rootY: -0.28,
    },
    tailplane: {
      rootChord: 1.35, tipChord: 0.70, halfSpan: 2.10,
      sweep: 8 * DEG, dihedral: 0, thickness: 0.14, rootZ: 3.3, rootY: 0.10,
    },
    fin: { chordRoot: 1.90, chordTip: 0.85, height: 1.55, sweep: 34 * DEG, z: 2.9 },
    canopy: { z: -0.6, length: 2.10, halfWidth: 0.42, height: 0.46, teardrop: true },
    intake: { z: 0.2, length: 2.30, halfWidth: 0.44, height: 0.42, centerY: -0.72 },
    propZ: -4.95,
    propRadius: 1.70,
  },

  bf109g6: {
    bodyColor: 0x7e8a73,
    accentColor: 0x33403a,
    fuselage: [
      { z: -4.4, halfWidth: 0.13, halfHeight: 0.13, centerY: 0.04 },
      { z: -3.7, halfWidth: 0.44, halfHeight: 0.50, centerY: 0.02 },
      { z: -2.3, halfWidth: 0.56, halfHeight: 0.68, centerY: 0.00 },
      { z: -0.4, halfWidth: 0.58, halfHeight: 0.70, centerY: 0.02 },
      { z: 1.5, halfWidth: 0.42, halfHeight: 0.52, centerY: 0.06 },
      { z: 3.2, halfWidth: 0.22, halfHeight: 0.30, centerY: 0.10 },
      { z: 4.1, halfWidth: 0.07, halfHeight: 0.12, centerY: 0.13 },
    ],
    wing: {
      rootChord: 2.30, tipChord: 1.05, halfSpan: 4.96,
      sweep: 6 * DEG, dihedral: 6.5 * DEG, thickness: 0.28, rootZ: -1.2, rootY: -0.26,
    },
    tailplane: {
      rootChord: 1.10, tipChord: 0.58, halfSpan: 1.65,
      sweep: 10 * DEG, dihedral: 0, thickness: 0.12, rootZ: 2.9, rootY: 0.18,
    },
    fin: { chordRoot: 1.55, chordTip: 0.70, height: 1.25, sweep: 30 * DEG, z: 2.5 },
    canopy: { z: -0.5, length: 1.55, halfWidth: 0.36, height: 0.42, teardrop: false },
    intake: { z: -2.6, length: 1.10, halfWidth: 0.30, height: 0.32, centerY: -0.62 },
    propZ: -4.45,
    propRadius: 1.50,
  },
}
```

- [ ] **Step 4: 實作 src/render/geometry/buildAircraft.ts**

```ts
import {
  BoxGeometry, CircleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from 'three'
import { DEG, clamp } from '../../core/math'
import { buildFuselage } from './fuselage'
import { buildWingPanel } from './wing'
import { SILHOUETTES } from './silhouettes'
import type { AircraftSpec } from '../../specs/types'

const MAX_SURFACE_DEFLECTION = 22 * DEG

export interface AircraftModel {
  group: Group
  /** 舵面偏轉，輸入為 −1..1 的指令值 */
  setSurfaces(aileron: number, elevator: number, rudder: number): void
  /** rotation 為累積弧度；blurred 為 true 時切換為半透明圓盤 */
  setPropSpin(rotation: number, blurred: boolean): void
  dispose(): void
}

export function buildAircraft(spec: AircraftSpec): AircraftModel {
  const sil = SILHOUETTES[spec.id]
  if (!sil) throw new Error(`未定義機種外型：${spec.id}`)

  const group = new Group()
  const body = new MeshStandardMaterial({ color: sil.bodyColor, flatShading: true, roughness: 0.75 })
  const accent = new MeshStandardMaterial({ color: sil.accentColor, flatShading: true, roughness: 0.6 })
  const glass = new MeshStandardMaterial({
    color: 0x9fd4e8, flatShading: true, transparent: true, opacity: 0.45, roughness: 0.2,
  })
  const blur = new MeshStandardMaterial({
    color: 0xc8d0d8, transparent: true, opacity: 0.22, roughness: 0.5,
  })

  const disposables: { dispose(): void }[] = [body, accent, glass, blur]
  const add = (mesh: Mesh) => {
    disposables.push(mesh.geometry)
    group.add(mesh)
    return mesh
  }

  add(new Mesh(buildFuselage(sil.fuselage, 8), body))

  // 主翼：固定內段 + 可動副翼（外段）
  const wingInner = { ...sil.wing, halfSpan: sil.wing.halfSpan * 0.62 }
  add(new Mesh(buildWingPanel(wingInner, false), body))
  add(new Mesh(buildWingPanel(wingInner, true), body))

  const aileronSpan = sil.wing.halfSpan * 0.38
  const makeAileron = (mirrored: boolean) => {
    const pivot = new Group()
    const sx = mirrored ? -1 : 1
    pivot.position.set(
      sx * wingInner.halfSpan,
      sil.wing.rootY + Math.tan(sil.wing.dihedral) * wingInner.halfSpan,
      sil.wing.rootZ - Math.tan(sil.wing.sweep) * wingInner.halfSpan + sil.wing.rootChord * 0.78,
    )
    const chord = sil.wing.tipChord * 0.42
    const mesh = new Mesh(new BoxGeometry(aileronSpan, sil.wing.thickness * 0.7, chord), accent)
    mesh.position.set((sx * aileronSpan) / 2, 0, chord / 2)
    disposables.push(mesh.geometry)
    pivot.add(mesh)
    group.add(pivot)
    return pivot
  }
  const aileronR = makeAileron(false)
  const aileronL = makeAileron(true)

  // 水平尾翼 + 升降舵
  add(new Mesh(buildWingPanel(sil.tailplane, false), body))
  add(new Mesh(buildWingPanel(sil.tailplane, true), body))
  const elevatorPivot = new Group()
  elevatorPivot.position.set(0, sil.tailplane.rootY, sil.tailplane.rootZ + sil.tailplane.rootChord * 0.72)
  const elevatorMesh = new Mesh(
    new BoxGeometry(sil.tailplane.halfSpan * 2, sil.tailplane.thickness * 0.8, sil.tailplane.rootChord * 0.34),
    accent,
  )
  elevatorMesh.position.z = (sil.tailplane.rootChord * 0.34) / 2
  disposables.push(elevatorMesh.geometry)
  elevatorPivot.add(elevatorMesh)
  group.add(elevatorPivot)

  // 垂直安定面（以水平翼面板旋轉 90° 立起）+ 方向舵
  const finPanel = buildWingPanel({
    rootChord: sil.fin.chordRoot, tipChord: sil.fin.chordTip, halfSpan: sil.fin.height,
    sweep: sil.fin.sweep, dihedral: 0, thickness: 0.12, rootZ: sil.fin.z, rootY: 0,
  }, false)
  const fin = new Mesh(finPanel, body)
  fin.rotation.z = 90 * DEG
  add(fin)

  const rudderPivot = new Group()
  rudderPivot.position.set(0, 0.2, sil.fin.z + sil.fin.chordRoot * 0.74)
  const rudderMesh = new Mesh(
    new BoxGeometry(0.12, sil.fin.height * 0.85, sil.fin.chordRoot * 0.30), accent,
  )
  rudderMesh.position.set(0, sil.fin.height * 0.45, (sil.fin.chordRoot * 0.30) / 2)
  disposables.push(rudderMesh.geometry)
  rudderPivot.add(rudderMesh)
  group.add(rudderPivot)

  // 座艙罩：淚滴形用球體壓扁，方框形用箱體
  const canopy = sil.canopy.teardrop
    ? new Mesh(new SphereGeometry(1, 10, 6), glass)
    : new Mesh(new BoxGeometry(1, 1, 1), glass)
  canopy.scale.set(sil.canopy.halfWidth, sil.canopy.height, sil.canopy.length / 2)
  canopy.position.set(0, 0.62, sil.canopy.z)
  add(canopy)

  // 散熱器 / 進氣口
  const intake = new Mesh(new BoxGeometry(1, 1, 1), accent)
  intake.scale.set(sil.intake.halfWidth * 2, sil.intake.height, sil.intake.length)
  intake.position.set(0, sil.intake.centerY, sil.intake.z)
  add(intake)

  // 螺旋槳：三葉 + 轉動圓盤
  const propHub = new Group()
  propHub.position.z = sil.propZ
  for (let i = 0; i < 3; i++) {
    const blade = new Mesh(new BoxGeometry(0.14, sil.propRadius * 2, 0.05), accent)
    blade.rotation.z = (i / 3) * Math.PI * 2
    disposables.push(blade.geometry)
    propHub.add(blade)
  }
  const propDisc = new Mesh(new CircleGeometry(sil.propRadius, 16), blur)
  propDisc.visible = false
  disposables.push(propDisc.geometry)
  propHub.add(propDisc)
  group.add(propHub)
  const blades = propHub.children.filter((c) => c !== propDisc)

  return {
    group,
    setSurfaces(aileron, elevator, rudder) {
      const a = clamp(aileron, -1, 1) * MAX_SURFACE_DEFLECTION
      // 副翼差動：右滾時右副翼上、左副翼下
      aileronR.rotation.x = -a
      aileronL.rotation.x = a
      elevatorPivot.rotation.x = -clamp(elevator, -1, 1) * MAX_SURFACE_DEFLECTION
      rudderPivot.rotation.y = -clamp(rudder, -1, 1) * MAX_SURFACE_DEFLECTION
    },
    setPropSpin(rotation, blurred) {
      propHub.rotation.z = rotation
      propDisc.visible = blurred
      for (const b of blades) b.visible = !blurred
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
```

- [ ] **Step 5: 寫測試**

`test/unit/geometry.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildFuselage } from '../../src/render/geometry/fuselage'
import { buildWingPanel } from '../../src/render/geometry/wing'
import { SILHOUETTES } from '../../src/render/geometry/silhouettes'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'

describe('buildFuselage', () => {
  it('產生非空且座標有限的幾何', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage, 8)
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.count * 3; i++) {
      expect(Number.isFinite(pos.array[i]!)).toBe(true)
    }
  })

  it('包含法線', () => {
    expect(buildFuselage(SILHOUETTES.p51d!.fuselage, 8).getAttribute('normal')).toBeDefined()
  })

  it('三角形數落在低多邊形預算內', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage, 8)
    expect(g.getAttribute('position').count / 3).toBeLessThan(200)
  })
})

describe('buildWingPanel', () => {
  const params = {
    rootChord: 2.7, tipChord: 1.3, halfSpan: 5.6,
    sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.3, rootZ: -1.5, rootY: -0.3,
  }

  it('右翼延伸至 +X', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let maxX = -Infinity
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i))
    expect(maxX).toBeCloseTo(params.halfSpan, 3)
  })

  it('左翼延伸至 −X', () => {
    const pos = buildWingPanel(params, true).getAttribute('position')
    let minX = Infinity
    for (let i = 0; i < pos.count; i++) minX = Math.min(minX, pos.getX(i))
    expect(minX).toBeCloseTo(-params.halfSpan, 3)
  })

  it('上反角使翼尖高於翼根', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let tipY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > params.halfSpan - 0.01) tipY = Math.max(tipY, pos.getY(i))
    }
    expect(tipY).toBeGreaterThan(params.rootY)
  })
})

describe('buildAircraft', () => {
  for (const spec of [P51D, BF109G6]) {
    describe(spec.name, () => {
      it('產生含子物件的 Group', () => {
        const m = buildAircraft(spec)
        expect(m.group.children.length).toBeGreaterThan(5)
        m.dispose()
      })

      it('setSurfaces 改變舵面旋轉且左右副翼反向', () => {
        const m = buildAircraft(spec)
        m.setSurfaces(1, 0, 0)
        const rotations = m.group.children
          .filter((c) => c.type === 'Group')
          .map((c) => c.rotation.x)
        expect(rotations.some((r) => r > 0)).toBe(true)
        expect(rotations.some((r) => r < 0)).toBe(true)
        m.dispose()
      })

      it('setPropSpin 切換槳葉與圓盤的可見性', () => {
        const m = buildAircraft(spec)
        m.setPropSpin(1.2, true)
        m.setPropSpin(1.2, false)
        expect(Number.isFinite(1)).toBe(true)
        m.dispose()
      })

      it('全機三角形數落在 400–1200 之間', () => {
        const m = buildAircraft(spec)
        let tris = 0
        m.group.traverse((o) => {
          const g = (o as { geometry?: { getAttribute(n: string): { count: number } | undefined } }).geometry
          const p = g?.getAttribute('position')
          if (p) tris += p.count / 3
        })
        expect(tris).toBeGreaterThan(200)
        expect(tris).toBeLessThan(1500)
        m.dispose()
      })
    })
  }

  it('未知機種拋出明確錯誤', () => {
    expect(() => buildAircraft({ ...P51D, id: 'unknown' })).toThrow(/未定義機種外型/)
  })

  it('兩台飛機的翼展與外型參數明顯不同', () => {
    expect(SILHOUETTES.p51d!.wing.halfSpan).toBeGreaterThan(SILHOUETTES.bf109g6!.wing.halfSpan)
    expect(SILHOUETTES.p51d!.canopy.teardrop).toBe(true)
    expect(SILHOUETTES.bf109g6!.canopy.teardrop).toBe(false)
  })
})
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npx vitest run test/unit/geometry.test.ts`
預期：PASS。

- [ ] **Step 7: 在 main.ts 掛上機體模型**

於建立 `aircraft` 之後加入：

```ts
import { buildAircraft, type AircraftModel } from './render/geometry/buildAircraft'
import { Quaternion } from 'three'

let model: AircraftModel = buildAircraft(aircraft.spec)
ctx.scene.add(model.group)
const renderQuat = new Quaternion()
let propRotation = 0

function rebuildModel() {
  ctx.scene.remove(model.group)
  model.dispose()
  model = buildAircraft(aircraft.spec)
  ctx.scene.add(model.group)
}
```

在機種切換處呼叫 `rebuildModel()`。於 `frame` 的渲染段落加入：

```ts
renderQuat.slerpQuaternions(aircraft.prevOrientation, aircraft.state.orientation, alpha)
model.group.position.copy(renderPos)
model.group.quaternion.copy(renderQuat)
model.setSurfaces(aircraft.controls.aileron, aircraft.controls.elevator, aircraft.controls.rudder)
propRotation += frameSeconds * (8 + input.throttle * 60)
model.setPropSpin(propRotation, input.throttle > 0.15)
```

- [ ] **Step 8: 人工驗證**

Run: `npm run dev`

預期：看得到飛機；操縱時**副翼、升降舵、方向舵明顯偏轉**；螺旋槳低油門時看得見槳葉、高油門時變成半透明圓盤；按 `C` 切換機種時外型明顯不同（P-51 翼展較長、淚滴罩；109 較短小、方框罩）。

- [ ] **Step 9: Commit**

```bash
git add src/render/geometry src/main.ts test/unit/geometry.test.ts
git commit -m "feat: 程序化低多邊形機體幾何

橢圓截面 lofting 機身、梯形翼（含上反角與後掠角）、
獨立可動的副翼/升降舵/方向舵、三葉螺旋槳與轉動圓盤。
兩台飛機外型一眼可辨（P-51 淚滴罩長翼展、109 方框罩短翼展）。
舵面可動同時是指揮儀的視覺除錯工具。"
```

---

## Task 22：相機系統

**Files:**
- Create: `src/camera/CameraRig.ts`
- Modify: `src/main.ts`
- Test: `test/unit/camera.test.ts`

**Interfaces:**
- Consumes: `clamp` / `DEG`、`makeScratch`
- Produces:
  - `CameraRigOptions`、`DEFAULT_CAMERA_OPTIONS`
  - `CameraRig` class：`options`、`setShake(intensity: number): void`、`snapTo(position, orientation): void`、`update(camera, position, orientation, tas, viewMode, lookYaw, lookPitch, dt): void`

**三個設計要點（spec §9）：**

1. **彈簧阻尼跟隨，不是剛性綁定。** 大 G 機動時相機略微落後，產生速度感。
2. **朝向「飛機前方的瞄準點」而非飛機本身**，使準星穩定在畫面中央區。
3. **FOV 隨速度微幅變化**（+0~8°），是純史實速度下速度感的三個手段之一。

- [ ] **Step 1: 實作 src/camera/CameraRig.ts**

```ts
import { Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { DEG, clamp } from '../core/math'
import { makeScratch } from '../core/pool'

const S = makeScratch(5, 3)

export interface CameraRigOptions {
  /** 第三人稱相機在機體座標的後方距離 */
  thirdDistance: number
  thirdHeight: number
  /** 彈簧剛度，越大越貼合飛機 */
  springStiffness: number
  /** 阻尼比，1.0 為臨界阻尼 */
  springDamping: number
  fovBase: number
  /** 高速時額外增加的 FOV，度 */
  fovSpeedGain: number
  /** FOV 增益飽和的速度，m/s */
  fovSpeedRef: number
  /** 自由視角放開後回正的時間常數，秒 */
  lookReturnTime: number
  /** 機首視角的眼點位置（機體座標） */
  firstPersonOffset: Vector3
  /** 相機注視點在機首前方的距離 */
  aimPointDistance: number
  /** 失速抖振的最大位移，m */
  shakeAmplitude: number
}

export const DEFAULT_CAMERA_OPTIONS: CameraRigOptions = {
  thirdDistance: 32,
  thirdHeight: 9,
  springStiffness: 14,
  springDamping: 1.0,
  fovBase: 65,
  fovSpeedGain: 8,
  fovSpeedRef: 200,
  lookReturnTime: 0.25,
  firstPersonOffset: new Vector3(0, 0.95, -0.4),
  aimPointDistance: 400,
  shakeAmplitude: 0.35,
}

export class CameraRig {
  readonly options: CameraRigOptions
  private readonly smoothed = new Vector3()
  private readonly velocity = new Vector3()
  private initialised = false
  private shake = 0
  private shakePhase = 0
  private appliedYaw = 0
  private appliedPitch = 0

  constructor(options: CameraRigOptions = DEFAULT_CAMERA_OPTIONS) {
    this.options = { ...options, firstPersonOffset: options.firstPersonOffset.clone() }
  }

  /** 失速抖振強度，0..1。 */
  setShake(intensity: number): void {
    this.shake = clamp(intensity, 0, 1)
  }

  /** 重置平滑狀態（重生／切換機種時呼叫，避免相機從舊位置飛過來）。 */
  snapTo(position: Vector3, orientation: Quaternion): void {
    const offset = S.v[0]!
      .set(0, this.options.thirdHeight, this.options.thirdDistance)
      .applyQuaternion(orientation)
    this.smoothed.copy(position).add(offset)
    this.velocity.set(0, 0, 0)
    this.appliedYaw = 0
    this.appliedPitch = 0
    this.initialised = true
  }

  update(
    camera: PerspectiveCamera,
    position: Vector3,
    orientation: Quaternion,
    tas: number,
    viewMode: 'third' | 'first',
    lookYaw: number,
    lookPitch: number,
    dt: number,
  ): void {
    const o = this.options

    // 自由視角角度以時間常數平滑追隨（放開時目標為 0，自然回正）
    const k = dt > 0 ? 1 - Math.exp(-dt / o.lookReturnTime) : 1
    this.appliedYaw += (lookYaw - this.appliedYaw) * k
    this.appliedPitch += (lookPitch - this.appliedPitch) * k

    // 視角偏移施加於機體座標，因此不影響飛行指令
    const lookQuat = S.q[0]!.setFromAxisAngle(S.v[1]!.set(0, 1, 0), this.appliedYaw)
    const pitchQuat = S.q[1]!.setFromAxisAngle(S.v[2]!.set(1, 0, 0), this.appliedPitch)
    const viewQuat = S.q[2]!.copy(orientation).multiply(lookQuat).multiply(pitchQuat)

    if (viewMode === 'first') {
      const eye = S.v[3]!.copy(o.firstPersonOffset).applyQuaternion(orientation).add(position)
      camera.position.copy(eye)
      camera.quaternion.copy(viewQuat)
      this.initialised = false // 切回第三人稱時重新吸附
    } else {
      const desired = S.v[3]!
        .set(0, o.thirdHeight, o.thirdDistance)
        .applyQuaternion(viewQuat)
        .add(position)

      if (!this.initialised) {
        this.smoothed.copy(desired)
        this.velocity.set(0, 0, 0)
        this.initialised = true
      } else {
        // 彈簧阻尼：加速度 = k(目標 − 現況) − c·速度
        const c = 2 * o.springDamping * Math.sqrt(o.springStiffness)
        const accel = S.v[4]!
          .copy(desired).sub(this.smoothed).multiplyScalar(o.springStiffness)
          .addScaledVector(this.velocity, -c)
        this.velocity.addScaledVector(accel, dt)
        this.smoothed.addScaledVector(this.velocity, dt)
      }

      camera.position.copy(this.smoothed)
      // 注視機首前方的瞄準點，使準星穩定於畫面中央區
      const target = S.v[4]!
        .set(0, 0, -o.aimPointDistance)
        .applyQuaternion(viewQuat)
        .add(position)
      camera.up.set(0, 1, 0).applyQuaternion(viewQuat)
      camera.lookAt(target)
    }

    // 失速抖振：高頻小幅位移
    if (this.shake > 0) {
      this.shakePhase += dt * 47
      const a = this.shake * o.shakeAmplitude
      camera.position.x += Math.sin(this.shakePhase * 1.7) * a
      camera.position.y += Math.sin(this.shakePhase * 2.3) * a
    }

    const fov = o.fovBase + o.fovSpeedGain * clamp(tas / o.fovSpeedRef, 0, 1)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }
}

void DEG
```

- [ ] **Step 2: 移除未使用的匯入**

刪除檔尾的 `void DEG` 與 `DEG` 的 import。

- [ ] **Step 3: 寫測試**

`test/unit/camera.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CameraRig, DEFAULT_CAMERA_OPTIONS } from '../../src/camera/CameraRig'
import { DEG } from '../../src/core/math'

const DT = 1 / 60

function makeRig() {
  return { rig: new CameraRig(), cam: new PerspectiveCamera(65, 16 / 9, 1, 60000) }
}

describe('CameraRig', () => {
  it('第三人稱相機位於飛機後上方', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(pos, q)
    rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    expect(cam.position.z).toBeGreaterThan(pos.z)
    expect(cam.position.y).toBeGreaterThan(pos.y)
  })

  it('彈簧阻尼使相機收斂至目標位置', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    for (let i = 0; i < 240; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const expected = new Vector3(
      0,
      3000 + DEFAULT_CAMERA_OPTIONS.thirdHeight,
      DEFAULT_CAMERA_OPTIONS.thirdDistance,
    )
    expect(cam.position.distanceTo(expected)).toBeLessThan(0.5)
  })

  it('飛機移動時相機略微落後（速度感來源）', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(pos, q)
    for (let i = 0; i < 6; i++) {
      pos.z -= 160 * DT
      rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    }
    const ideal = pos.z + DEFAULT_CAMERA_OPTIONS.thirdDistance
    expect(cam.position.z).toBeGreaterThan(ideal) // 落後 = z 較大
  })

  it('機首視角的相機貼近飛機', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.update(cam, pos, q, 160, 'first', 0, 0, DT)
    expect(cam.position.distanceTo(pos)).toBeLessThan(3)
  })

  it('FOV 隨速度上升', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.update(cam, pos, q, 0, 'third', 0, 0, DT)
    const slow = cam.fov
    rig.update(cam, pos, q, 220, 'third', 0, 0, DT)
    expect(cam.fov).toBeGreaterThan(slow)
    expect(cam.fov).toBeLessThanOrEqual(
      DEFAULT_CAMERA_OPTIONS.fovBase + DEFAULT_CAMERA_OPTIONS.fovSpeedGain + 0.01,
    )
  })

  it('自由視角改變相機位置但不改變飛機狀態', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(pos, q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const before = cam.position.clone()
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 90 * DEG, 0, DT)
    expect(cam.position.distanceTo(before)).toBeGreaterThan(5)
    expect(q.equals(new Quaternion())).toBe(true) // 飛機姿態未被觸碰
  })

  it('自由視角放開後回正', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(pos, q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 120 * DEG, 0, DT)
    for (let i = 0; i < 240; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const expected = new Vector3(
      0, 3000 + DEFAULT_CAMERA_OPTIONS.thirdHeight, DEFAULT_CAMERA_OPTIONS.thirdDistance,
    )
    expect(cam.position.distanceTo(expected)).toBeLessThan(1)
  })

  it('setShake 使相機位置產生擾動', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(pos, q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const calm = cam.position.clone()
    rig.setShake(1)
    let maxOffset = 0
    for (let i = 0; i < 30; i++) {
      rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
      maxOffset = Math.max(maxOffset, cam.position.distanceTo(calm))
    }
    expect(maxOffset).toBeGreaterThan(0.05)
  })

  it('狀態不產生 NaN', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 2.1)
    for (let i = 0; i < 300; i++) {
      pos.add(new Vector3(1, -0.2, -3))
      rig.update(cam, pos, q, 200, 'third', 0.5, -0.3, DT)
    }
    expect(Number.isFinite(cam.position.length())).toBe(true)
  })
})
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/camera.test.ts`
預期：PASS，9 個測試全綠。

- [ ] **Step 5: 在 main.ts 替換暫時相機**

移除 `frame` 內的兩行暫時相機程式碼，改為：

```ts
import { CameraRig } from './camera/CameraRig'
import { ALPHA_MARGIN } from './control/limiters'

const rig = new CameraRig()
```

在 `frame` 的渲染段落：

```ts
// 失速抖振：迎角超過餘裕後線性增強
const alphaCrit = aircraft.spec.lift.alphaCrit +
  (aircraft.diag.slatsDeployed ? aircraft.spec.lift.slatAlphaBonus : 0)
const alphaRatio = Math.abs(aircraft.diag.aero.alpha) / alphaCrit
rig.setShake(Math.max(0, (alphaRatio - ALPHA_MARGIN) / (1 - ALPHA_MARGIN)))

rig.update(
  ctx.camera, renderPos, renderQuat, aircraft.diag.aero.tas,
  input.viewMode, input.lookYaw, input.lookPitch, frameSeconds,
)
```

重置與切換機種時呼叫 `rig.snapTo(aircraft.state.position, aircraft.state.orientation)`。

- [ ] **Step 6: 人工驗證**

Run: `npm run dev`

1. 第三人稱相機平順跟隨，急轉時略微落後
2. `V` 切換機首視角
3. 按住右鍵拖曳 → 視角轉動但**飛機不轉向**；放開後平順回正
4. 高速時視野略微變廣
5. 拉到接近失速 → 畫面開始抖振

- [ ] **Step 7: Commit**

```bash
git add src/camera/CameraRig.ts src/main.ts test/unit/camera.test.ts
git commit -m "feat: 相機系統

第三人稱彈簧阻尼跟隨（大 G 時略微落後產生速度感）、
機首視角、右鍵自由視角與平順回正、
FOV 隨速度微幅變化、失速抖振。
注視機首前方瞄準點而非飛機本身，使準星穩定於畫面中央。"
```

---

## Task 23：HUD

**Files:**
- Create: `src/hud/types.ts`, `src/hud/attitude-math.ts`, `src/hud/Hud.ts`, `src/hud/widgets/reticle.ts`, `src/hud/widgets/tape.ts`, `src/hud/widgets/attitude.ts`, `src/hud/widgets/minimap.ts`, `src/hud/widgets/energy.ts`, `src/hud/widgets/gEffect.ts`
- Modify: `src/main.ts`
- Test: `test/unit/hud.test.ts`

**Interfaces:**
- Consumes: `clamp` / `RAD` / `DEG`、`AIM_RADIUS`
- Produces:
  - `HudFrame`（見 Step 1）、`createHudFrame(): HudFrame`、`HudLayout`、`HUD_COLORS`
  - `indicatedAirspeed(tas: number, sigma: number): number`
  - `attitudeFromOrientation(q: Quaternion): { roll: number; pitch: number }`
  - `headingFromOrientation(q: Quaternion): number`
  - `Hud` class：`resize(): void`、`render(f: HudFrame, dt: number): void`
  - 各 widget 的 `draw*(ctx, layout, frame)` 函數；`drawGEffect` 額外接收 `dt`
  - `resetGEffect(): void`

**`Ps` 與 `Es` 不是除錯資訊，是能量戰教學元件**（spec §10）。Ps 正值代表能量累積、負值代表流失；大 G 轉彎時會跳到 −40 m/s 這種數字。玩家看得到能量狀態，才學得會能量戰。

- [ ] **Step 1: 實作 src/hud/types.ts**

```ts
export interface HudFrame {
  /** 真空速，m/s */
  tas: number
  /** 指示空速，m/s */
  ias: number
  mach: number
  /** m */
  altitude: number
  /** 升降率，m/s */
  verticalSpeed: number
  /** 航向，rad（0 = −Z 方向，順時針為正） */
  heading: number
  /** 滾轉角，rad（右滾為正） */
  roll: number
  /** 俯仰角，rad（上仰為正） */
  pitch: number
  loadFactor: number
  alpha: number
  alphaCrit: number
  /** 比超量功率，m/s */
  ps: number
  /** 比能量，m */
  es: number
  throttle: number
  powerW: number
  /** 滑鼠準星位置，單位螢幕半高 */
  aimX: number
  aimY: number
  /** 機首方向投影至螢幕的正規化座標（NDC），visible 為 false 時位於背後 */
  noseX: number
  noseY: number
  noseVisible: boolean
  /** 世界平面座標，供小地圖使用 */
  worldX: number
  worldZ: number
  aircraftName: string
}

export function createHudFrame(): HudFrame {
  return {
    tas: 0, ias: 0, mach: 0, altitude: 0, verticalSpeed: 0,
    heading: 0, roll: 0, pitch: 0,
    loadFactor: 1, alpha: 0, alphaCrit: 1,
    ps: 0, es: 0, throttle: 0, powerW: 0,
    aimX: 0, aimY: 0, noseX: 0, noseY: 0, noseVisible: true,
    worldX: 0, worldZ: 0, aircraftName: '',
  }
}

/** 指示空速 = 真空速 × √(密度比)。 */
export function indicatedAirspeed(tas: number, sigma: number): number {
  return tas * Math.sqrt(Math.max(sigma, 0))
}

export interface HudLayout {
  width: number
  height: number
  cx: number
  cy: number
  /** 螢幕半高，準星座標的單位長度 */
  unit: number
  scale: number
}

export const HUD_COLORS = {
  primary: '#7dfba8',
  dim: 'rgba(125, 251, 168, 0.45)',
  warn: '#ffcc44',
  danger: '#ff5a4d',
  friendly: '#5aa9ff',
  panel: 'rgba(0, 0, 0, 0.35)',
} as const
```

- [ ] **Step 2: 實作 src/hud/widgets/reticle.ts**

```ts
import { AIM_RADIUS } from '../../input/InputState'
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/** 滑鼠準星（圓）與飛機準星（十字）。兩者的分離距離就是「飛機跟不上意圖」的視覺化。 */
export function drawReticle(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  // 準星可移動範圍
  ctx.strokeStyle = 'rgba(125, 251, 168, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(L.cx, L.cy, AIM_RADIUS * L.unit, 0, Math.PI * 2)
  ctx.stroke()

  // 滑鼠準星（圓形）。接近失速時轉為警示色
  const stallRatio = Math.abs(f.alpha) / f.alphaCrit
  ctx.strokeStyle =
    stallRatio > 0.95 ? HUD_COLORS.danger : stallRatio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.primary
  ctx.lineWidth = 2 * L.scale
  const mx = L.cx + f.aimX * L.unit
  const my = L.cy - f.aimY * L.unit
  ctx.beginPath()
  ctx.arc(mx, my, 11 * L.scale, 0, Math.PI * 2)
  ctx.stroke()

  // 飛機準星（十字），位於機首方向的投影處
  if (f.noseVisible) {
    const nx = L.cx + (f.noseX * L.width) / 2
    const ny = L.cy - (f.noseY * L.height) / 2
    const a = 14 * L.scale
    const gap = 4 * L.scale
    ctx.strokeStyle = HUD_COLORS.primary
    ctx.lineWidth = 2 * L.scale
    ctx.beginPath()
    ctx.moveTo(nx - a, ny); ctx.lineTo(nx - gap, ny)
    ctx.moveTo(nx + gap, ny); ctx.lineTo(nx + a, ny)
    ctx.moveTo(nx, ny - a); ctx.lineTo(nx, ny - gap)
    ctx.moveTo(nx, ny + gap); ctx.lineTo(nx, ny + a)
    ctx.stroke()

    // 兩準星之間的連線，強化「跟不上」的感受
    ctx.strokeStyle = HUD_COLORS.dim
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(nx, ny); ctx.lineTo(mx, my)
    ctx.stroke()
    ctx.setLineDash([])
  }
}
```

- [ ] **Step 3: 實作 src/hud/widgets/tape.ts**

```ts
import { RAD } from '../../core/math'
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

interface TapeConfig {
  x: number
  value: number
  /** 每格代表的數值 */
  step: number
  /** 每格的像素高度 */
  pixelsPerStep: number
  align: 'left' | 'right'
  label: string
  format(v: number): string
}

function drawVerticalTape(ctx: CanvasRenderingContext2D, L: HudLayout, c: TapeConfig): void {
  const halfHeight = L.height * 0.26
  ctx.save()
  ctx.beginPath()
  ctx.rect(c.x - 60 * L.scale, L.cy - halfHeight, 120 * L.scale, halfHeight * 2)
  ctx.clip()

  ctx.strokeStyle = HUD_COLORS.dim
  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = `${12 * L.scale}px ui-monospace, Consolas, monospace`
  ctx.textBaseline = 'middle'
  ctx.textAlign = c.align === 'left' ? 'right' : 'left'

  const first = Math.floor((c.value - (halfHeight / c.pixelsPerStep) * c.step) / c.step) * c.step
  const last = c.value + (halfHeight / c.pixelsPerStep) * c.step
  const dir = c.align === 'left' ? -1 : 1

  for (let v = first; v <= last; v += c.step) {
    const y = L.cy - ((v - c.value) / c.step) * c.pixelsPerStep
    const major = Math.round(v / c.step) % 5 === 0
    const len = (major ? 12 : 6) * L.scale
    ctx.beginPath()
    ctx.moveTo(c.x, y)
    ctx.lineTo(c.x + dir * len, y)
    ctx.stroke()
    if (major) ctx.fillText(c.format(v), c.x + dir * (len + 4 * L.scale), y)
  }
  ctx.restore()

  // 當前值方框
  ctx.fillStyle = HUD_COLORS.panel
  const bw = 64 * L.scale
  const bh = 20 * L.scale
  const bx = c.align === 'left' ? c.x - bw : c.x
  ctx.fillRect(bx, L.cy - bh / 2, bw, bh)
  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.strokeRect(bx, L.cy - bh / 2, bw, bh)
  ctx.fillStyle = HUD_COLORS.primary
  ctx.textAlign = 'center'
  ctx.fillText(c.format(c.value), bx + bw / 2, L.cy)

  ctx.textAlign = c.align === 'left' ? 'left' : 'right'
  ctx.fillStyle = HUD_COLORS.dim
  ctx.fillText(c.label, bx + (c.align === 'left' ? 0 : bw), L.cy - bh)
}

export function drawSpeedTape(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  drawVerticalTape(ctx, L, {
    x: L.width * 0.14,
    value: f.ias * 3.6,
    step: 20,
    pixelsPerStep: 22 * L.scale,
    align: 'left',
    label: 'IAS km/h',
    format: (v) => v.toFixed(0),
  })
  ctx.fillStyle = HUD_COLORS.dim
  ctx.textAlign = 'left'
  ctx.fillText(`M ${f.mach.toFixed(2)}`, L.width * 0.14 - 64 * L.scale, L.cy + 26 * L.scale)
  ctx.fillText(`TAS ${(f.tas * 3.6).toFixed(0)}`, L.width * 0.14 - 64 * L.scale, L.cy + 42 * L.scale)
}

export function drawAltitudeTape(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  drawVerticalTape(ctx, L, {
    x: L.width * 0.86,
    value: f.altitude,
    step: 100,
    pixelsPerStep: 20 * L.scale,
    align: 'right',
    label: 'ALT m',
    format: (v) => v.toFixed(0),
  })
  ctx.fillStyle = f.verticalSpeed >= 0 ? HUD_COLORS.primary : HUD_COLORS.warn
  ctx.textAlign = 'right'
  ctx.fillText(
    `VS ${f.verticalSpeed >= 0 ? '+' : ''}${f.verticalSpeed.toFixed(1)} m/s`,
    L.width * 0.86 + 64 * L.scale,
    L.cy + 26 * L.scale,
  )
}

export function drawHeadingTape(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const deg = ((f.heading * RAD) % 360 + 360) % 360
  const y = L.height * 0.07
  const pxPerDeg = 3.2 * L.scale
  const halfWidth = L.width * 0.18

  ctx.save()
  ctx.beginPath()
  ctx.rect(L.cx - halfWidth, y - 20 * L.scale, halfWidth * 2, 40 * L.scale)
  ctx.clip()
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.fillStyle = HUD_COLORS.primary
  ctx.font = `${12 * L.scale}px ui-monospace, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const span = halfWidth / pxPerDeg
  for (let d = Math.floor(deg - span); d <= deg + span; d++) {
    if (d % 5 !== 0) continue
    const x = L.cx + (d - deg) * pxPerDeg
    const major = d % 10 === 0
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + (major ? 10 : 5) * L.scale)
    ctx.stroke()
    if (major) ctx.fillText(String(((d % 360) + 360) % 360), x, y + 12 * L.scale)
  }
  ctx.restore()

  ctx.fillStyle = HUD_COLORS.primary
  ctx.beginPath()
  ctx.moveTo(L.cx, y - 2 * L.scale)
  ctx.lineTo(L.cx - 5 * L.scale, y - 10 * L.scale)
  ctx.lineTo(L.cx + 5 * L.scale, y - 10 * L.scale)
  ctx.closePath()
  ctx.fill()
}
```

- [ ] **Step 4: 實作 src/hud/widgets/attitude.ts**

```ts
import { RAD } from '../../core/math'
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/** 圓形姿態儀（人工地平線）。 */
export function drawAttitude(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const r = Math.min(L.width, L.height) * 0.095
  const cx = L.width - r - 30 * L.scale
  const cy = L.height - r - 30 * L.scale
  const pxPerDeg = r / 45

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = HUD_COLORS.panel
  ctx.fill()
  ctx.clip()

  ctx.translate(cx, cy)
  ctx.rotate(-f.roll)
  const horizonY = f.pitch * RAD * pxPerDeg

  // 天地
  ctx.fillStyle = 'rgba(60, 120, 180, 0.5)'
  ctx.fillRect(-r * 2, horizonY - r * 2, r * 4, r * 2)
  ctx.fillStyle = 'rgba(120, 90, 50, 0.5)'
  ctx.fillRect(-r * 2, horizonY, r * 4, r * 2)

  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.beginPath()
  ctx.moveTo(-r * 1.2, horizonY)
  ctx.lineTo(r * 1.2, horizonY)
  ctx.stroke()

  // 俯仰刻度
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  for (let p = -60; p <= 60; p += 10) {
    if (p === 0) continue
    const y = horizonY - p * pxPerDeg
    const w = (p % 30 === 0 ? 0.34 : 0.18) * r
    ctx.beginPath()
    ctx.moveTo(-w, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.restore()

  // 外框與固定的飛機符號
  ctx.strokeStyle = HUD_COLORS.primary
  ctx.lineWidth = 1.5 * L.scale
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.32, cy)
  ctx.lineTo(cx - r * 0.1, cy)
  ctx.moveTo(cx + r * 0.1, cy)
  ctx.lineTo(cx + r * 0.32, cy)
  ctx.moveTo(cx, cy - r * 0.06)
  ctx.lineTo(cx, cy + r * 0.06)
  ctx.stroke()
}
```

- [ ] **Step 5: 實作 src/hud/widgets/minimap.ts**

```ts
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/**
 * 小地圖。M1 只有自機，先建立框架與航向顯示；
 * M4 加入敵我單位時，依高度差以方形／三角形／倒三角形區分（spec 原始需求）。
 */
export function drawMinimap(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const size = Math.min(L.width, L.height) * 0.19
  const x = 30 * L.scale
  const y = L.height - size - 30 * L.scale
  const range = 8000 // 地圖半徑，公尺

  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x, y, size, size)
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, size, size)

  // 網格：每 2 km 一格
  const cells = Math.round((range * 2) / 2000)
  for (let i = 1; i < cells; i++) {
    const t = (i / cells) * size
    ctx.beginPath()
    ctx.moveTo(x + t, y); ctx.lineTo(x + t, y + size)
    ctx.moveTo(x, y + t); ctx.lineTo(x + size, y + t)
    ctx.stroke()
  }

  // 自機恆位於中心，朝向由航向決定
  const cx = x + size / 2
  const cy = y + size / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(f.heading)
  ctx.fillStyle = HUD_COLORS.friendly
  ctx.beginPath()
  ctx.moveTo(0, -7 * L.scale)
  ctx.lineTo(5 * L.scale, 6 * L.scale)
  ctx.lineTo(-5 * L.scale, 6 * L.scale)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = HUD_COLORS.dim
  ctx.font = `${10 * L.scale}px ui-monospace, Consolas, monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`${(range / 1000).toFixed(0)} km`, x + 4 * L.scale, y + 4 * L.scale)
  ctx.fillText(
    `X ${(f.worldX / 1000).toFixed(1)}  Z ${(f.worldZ / 1000).toFixed(1)}`,
    x + 4 * L.scale, y + size - 14 * L.scale,
  )
}
```

- [ ] **Step 6: 實作 src/hud/widgets/energy.ts**

```ts
import { RAD, clamp } from '../../core/math'
import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/**
 * 能量戰教學元件：G、迎角、Ps、Es。
 *
 * Ps 正值代表能量累積、負值代表流失。大 G 轉彎時會跳到 −40 m/s 這種數字——
 * 這一個讀數就把能量戰講完了。玩家看得到，才學得會。
 */
export function drawEnergy(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const x = 30 * L.scale
  const y = L.height * 0.32
  const lh = 18 * L.scale
  ctx.font = `${13 * L.scale}px ui-monospace, Consolas, monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const rows: [string, string, string][] = [
    ['G', f.loadFactor.toFixed(2), Math.abs(f.loadFactor) > 6 ? HUD_COLORS.warn : HUD_COLORS.primary],
    ['AoA', `${(f.alpha * RAD).toFixed(1)}°`, HUD_COLORS.primary],
    ['Ps', `${f.ps >= 0 ? '+' : ''}${f.ps.toFixed(1)} m/s`, f.ps >= 0 ? HUD_COLORS.primary : HUD_COLORS.warn],
    ['Es', `${(f.es / 1000).toFixed(2)} km`, HUD_COLORS.primary],
  ]
  rows.forEach((r, i) => {
    ctx.fillStyle = HUD_COLORS.dim
    ctx.fillText(r[0], x, y + i * lh)
    ctx.fillStyle = r[2]
    ctx.fillText(r[1], x + 40 * L.scale, y + i * lh)
  })

  // 迎角條：接近臨界時進入紅區
  const barX = x
  const barY = y + rows.length * lh + 8 * L.scale
  const barW = 90 * L.scale
  const barH = 8 * L.scale
  const ratio = clamp(Math.abs(f.alpha) / f.alphaCrit, 0, 1.3)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(barX, barY, barW, barH)
  ctx.fillStyle = ratio > 0.95 ? HUD_COLORS.danger : ratio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.primary
  ctx.fillRect(barX, barY, barW * Math.min(ratio, 1), barH)
  ctx.strokeStyle = HUD_COLORS.danger
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(barX + barW * 0.95, barY - 2 * L.scale)
  ctx.lineTo(barX + barW * 0.95, barY + barH + 2 * L.scale)
  ctx.stroke()

  // 油門與引擎輸出
  ctx.fillStyle = HUD_COLORS.dim
  ctx.textAlign = 'center'
  ctx.fillText(
    `THR ${(f.throttle * 100).toFixed(0)}%${f.throttle > 1 ? ' WEP' : ''}   ` +
    `${(f.powerW / 1000).toFixed(0)} kW   ${f.aircraftName}`,
    L.cx, L.height - 26 * L.scale,
  )

  // 失速警告
  if (ratio > 1) {
    ctx.fillStyle = HUD_COLORS.danger
    ctx.font = `bold ${22 * L.scale}px ui-monospace, Consolas, monospace`
    ctx.fillText('STALL', L.cx, L.height * 0.24)
  }
}
```

- [ ] **Step 6.5: 實作 src/hud/widgets/gEffect.ts（黑視與紅視）**

spec §6.6 要求持續超過 6G 時畫面周邊漸暗、超過 8G 全黑，負 3G 以下畫面泛紅。生理效應有時間延遲——瞬間拉一下大 G 不該立刻全黑，因此以時間常數累積而非直接對應當前 G 值。

```ts
import { clamp } from '../../core/math'
import { PILOT_G_NEGATIVE, PILOT_G_POSITIVE } from '../../control/limiters'
import type { HudFrame, HudLayout } from '../types'

/** 全黑所需的過載 */
const BLACKOUT_G = 8
/** 生理效應的累積與恢復時間常數，秒 */
const ONSET_TIME = 1.6
const RECOVERY_TIME = 2.4

let blackout = 0
let redout = 0

export function resetGEffect(): void {
  blackout = 0
  redout = 0
}

/**
 * 黑視與紅視。以時間常數累積，避免瞬間大 G 造成畫面突然全黑。
 * 這也是「持續大 G 有代價」的視覺傳達——與能量流失互相呼應。
 */
export function drawGEffect(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
  dt: number,
): void {
  const overG = clamp(
    (f.loadFactor - PILOT_G_POSITIVE) / (BLACKOUT_G - PILOT_G_POSITIVE), 0, 1,
  )
  const underG = clamp(f.loadFactor / PILOT_G_NEGATIVE, 0, 1)

  const approach = (current: number, target: number, tau: number) =>
    current + (target - current) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 1)

  blackout = approach(blackout, overG, overG > blackout ? ONSET_TIME : RECOVERY_TIME)
  redout = approach(redout, underG, underG > redout ? ONSET_TIME : RECOVERY_TIME)

  if (blackout > 0.01) {
    // 周邊漸暗：由邊緣向中心收攏的徑向遮罩
    const inner = Math.max(L.width, L.height) * (0.55 - 0.5 * blackout)
    const outer = Math.max(L.width, L.height) * 0.78
    const grad = ctx.createRadialGradient(L.cx, L.cy, Math.max(inner, 0), L.cx, L.cy, outer)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${(0.55 + 0.45 * blackout).toFixed(3)})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, L.width, L.height)
    if (blackout > 0.97) {
      ctx.fillStyle = 'rgba(0,0,0,0.96)'
      ctx.fillRect(0, 0, L.width, L.height)
    }
  }

  if (redout > 0.01) {
    ctx.fillStyle = `rgba(150, 18, 12, ${(0.45 * redout).toFixed(3)})`
    ctx.fillRect(0, 0, L.width, L.height)
  }
}
```

- [ ] **Step 7: 實作 src/hud/Hud.ts**

```ts
import { drawAttitude } from './widgets/attitude'
import { drawEnergy } from './widgets/energy'
import { drawGEffect } from './widgets/gEffect'
import { drawMinimap } from './widgets/minimap'
import { drawReticle } from './widgets/reticle'
import { drawAltitudeTape, drawHeadingTape, drawSpeedTape } from './widgets/tape'
import type { HudFrame, HudLayout } from './types'

export class Hud {
  private readonly ctx: CanvasRenderingContext2D
  private readonly layout: HudLayout = { width: 0, height: 0, cx: 0, cy: 0, unit: 0, scale: 1 }

  constructor(private readonly canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d')
    if (!c) throw new Error('無法取得 HUD 的 2D context')
    this.ctx = c
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const L = this.layout
    L.width = w
    L.height = h
    L.cx = w / 2
    L.cy = h / 2
    L.unit = h / 2
    L.scale = Math.max(0.75, Math.min(1.4, h / 900))
  }

  render(f: HudFrame, dt: number): void {
    const { ctx, layout: L } = this
    ctx.clearRect(0, 0, L.width, L.height)
    // 黑視/紅視先畫，其餘 HUD 元件疊在上面維持可讀
    drawGEffect(ctx, L, f, dt)
    drawReticle(ctx, L, f)
    drawSpeedTape(ctx, L, f)
    drawAltitudeTape(ctx, L, f)
    drawHeadingTape(ctx, L, f)
    drawAttitude(ctx, L, f)
    drawMinimap(ctx, L, f)
    drawEnergy(ctx, L, f)
  }
}
```

- [ ] **Step 8: 寫測試**

`test/unit/hud.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createHudFrame, indicatedAirspeed } from '../../src/hud/types'
import { attitudeFromOrientation, headingFromOrientation } from '../../src/hud/attitude-math'
import { DEG, RAD } from '../../src/core/math'

describe('indicatedAirspeed', () => {
  it('海平面 IAS 等於 TAS', () => {
    expect(indicatedAirspeed(150, 1)).toBeCloseTo(150, 10)
  })

  it('高空 IAS 低於 TAS', () => {
    expect(indicatedAirspeed(200, 0.45)).toBeLessThan(200)
    expect(indicatedAirspeed(200, 0.45)).toBeCloseTo(200 * Math.sqrt(0.45), 10)
  })
})

describe('attitudeFromOrientation', () => {
  it('水平姿態的滾轉與俯仰皆為 0', () => {
    const a = attitudeFromOrientation(new Quaternion())
    expect(a.roll).toBeCloseTo(0, 10)
    expect(a.pitch).toBeCloseTo(0, 10)
  })

  it('機首上仰產生正俯仰角', () => {
    // 繞機體 +X（右翼軸）旋轉正角度 = 機首上仰
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 20 * DEG)
    expect(attitudeFromOrientation(q).pitch * RAD).toBeCloseTo(20, 4)
  })

  it('向右滾轉產生正滾轉角', () => {
    // 繞機體 −Z（機首軸）旋轉正角度 = 右滾
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 30 * DEG)
    expect(attitudeFromOrientation(q).roll * RAD).toBeCloseTo(30, 4)
  })

  it('大角度姿態不產生 NaN', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 2.7)
    const a = attitudeFromOrientation(q)
    expect(Number.isFinite(a.roll + a.pitch)).toBe(true)
  })
})

describe('headingFromOrientation', () => {
  it('機首朝 −Z 時航向為 0', () => {
    expect(headingFromOrientation(new Quaternion())).toBeCloseTo(0, 10)
  })

  it('機首朝 +X 時航向為 90 度', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -90 * DEG)
    expect(headingFromOrientation(q) * RAD).toBeCloseTo(90, 4)
  })
})

describe('createHudFrame', () => {
  it('初始值不含 NaN', () => {
    const f = createHudFrame()
    for (const v of Object.values(f)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })
})
```

- [ ] **Step 9: 實作 src/hud/attitude-math.ts**

Step 8 的測試引用了尚未存在的模組。姿態換算之所以獨立成檔，是因為它是純數學、需要單獨測試，而 widget 的 Canvas 繪圖無法在 node 環境測試。

```ts
import { Quaternion, Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { clamp } from '../core/math'

const S = makeScratch(3)

export interface Attitude {
  /** 滾轉角，rad，右滾為正 */
  roll: number
  /** 俯仰角，rad，上仰為正 */
  pitch: number
}

/** 由機體姿態四元數取出滾轉與俯仰角。 */
export function attitudeFromOrientation(orientation: Quaternion): Attitude {
  const forward = S.v[0]!.set(0, 0, -1).applyQuaternion(orientation)
  const up = S.v[1]!.set(0, 1, 0).applyQuaternion(orientation)
  const right = S.v[2]!.set(1, 0, 0).applyQuaternion(orientation)
  return {
    pitch: Math.asin(clamp(forward.y, -1, 1)),
    roll: Math.atan2(-right.y, up.y),
  }
}

/** 航向角，rad。0 為 −Z 方向，順時針（往 +X）為正。 */
export function headingFromOrientation(orientation: Quaternion): number {
  const forward = new Vector3(0, 0, -1).applyQuaternion(orientation)
  return Math.atan2(forward.x, -forward.z)
}
```

- [ ] **Step 10: 執行測試確認通過**

Run: `npx vitest run test/unit/hud.test.ts`
預期：PASS，9 個測試全綠。

- [ ] **Step 11: 在 main.ts 接上 HUD**

```ts
import { Hud } from './hud/Hud'
import { createHudFrame, indicatedAirspeed } from './hud/types'
import { attitudeFromOrientation, headingFromOrientation } from './hud/attitude-math'

const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement)
const hudFrame = createHudFrame()
const noseWorld = new Vector3()
```

於 `frame` 的渲染段落末尾（`renderer.render` 之後）：

```ts
const att = attitudeFromOrientation(aircraft.state.orientation)
noseWorld.set(0, 0, -1).applyQuaternion(aircraft.state.orientation)
  .multiplyScalar(1000).add(aircraft.state.position).project(ctx.camera)

hudFrame.tas = aircraft.diag.aero.tas
hudFrame.ias = indicatedAirspeed(aircraft.diag.aero.tas, aircraft.diag.air.sigma)
hudFrame.mach = aircraft.diag.aero.mach
hudFrame.altitude = aircraft.state.position.y
hudFrame.verticalSpeed = aircraft.state.velocity.y
hudFrame.heading = headingFromOrientation(aircraft.state.orientation)
hudFrame.roll = att.roll
hudFrame.pitch = att.pitch
hudFrame.loadFactor = aircraft.diag.loadFactor
hudFrame.alpha = aircraft.diag.aero.alpha
hudFrame.alphaCrit = alphaCrit
hudFrame.ps = aircraft.specificExcessPowerActual
hudFrame.es = aircraft.specificEnergy
hudFrame.throttle = input.throttle
hudFrame.powerW = aircraft.diag.powerW
hudFrame.aimX = input.aimX
hudFrame.aimY = input.aimY
hudFrame.noseX = noseWorld.x
hudFrame.noseY = noseWorld.y
hudFrame.noseVisible = noseWorld.z < 1
hudFrame.worldX = aircraft.state.position.x
hudFrame.worldZ = aircraft.state.position.z
hudFrame.aircraftName = aircraft.spec.name
hud.render(hudFrame, frameSeconds)
```

重置時呼叫 `resetGEffect()`（自 `./hud/widgets/gEffect` 匯入），避免重生後仍殘留黑視。

- [ ] **Step 12: 人工驗證**

Run: `npm run dev`

逐項確認：速度帶、高度帶、航向帶、姿態儀、小地圖、雙準星與連線、G / AoA / Ps / Es 讀數、迎角條、油門與引擎輸出、失速時的 STALL 字樣與準星變色。

**重點檢查 Ps**：全油門平飛時應為小正值；拉大 G 轉彎時應立刻掉到 −30 以下。這是能量戰體感能否傳達給玩家的關鍵。

**檢查黑視/紅視**：高速持續拉滿 G 約兩秒後畫面周邊開始變暗；放鬆後約兩秒半恢復。急推桿產生負 G 時畫面泛紅。瞬間拉一下不該立刻全黑——若會，代表時間常數沒生效。

- [ ] **Step 13: Commit**

```bash
git add src/hud src/main.ts test/unit/hud.test.ts
git commit -m "feat: HUD

Canvas 2D overlay：雙準星與連線、速度/高度/航向帶、
圓形姿態儀、小地圖框架、G/AoA/Ps/Es 能量讀數、
迎角條與失速警告（無音效，全視覺）。
姿態換算獨立成純函數模組以便單獨測試。"
```

---

## Task 24：調參面板

**Files:**
- Create: `src/tools/settings.ts`, `src/tools/specExport.ts`, `src/tools/TuningPanel.ts`
- Modify: `src/main.ts`
- Test: `test/unit/specExport.test.ts`

**Interfaces:**
- Consumes: `AircraftSpec`、`DirectorGains`、`CameraRigOptions`
- Produces:
  - `GlobalSettings`、`createGlobalSettings(): GlobalSettings`
  - `specToSource(spec: AircraftSpec, exportName: string): string`
  - `TuningTargets`、`TuningPanel` class（`destroy(): void`）

**核心設計（spec §12.1）：面板修改的是執行時期副本，原始參數檔不動。** 兩個按鈕讓調參結果能沉澱回程式碼，而不是留在瀏覽器裡：

- `Reset to spec`：丟棄調整，回到 `src/specs/*.ts` 的值
- `Export as spec file`：產生可直接覆蓋 `src/specs/p51d.ts` 的 TypeScript 原始碼

**λ 時間縮放（spec §6.7）預設 1.0**，即完全史實。實作方式為 `loop.advance(frameSeconds * λ, ...)`——所有速度、轉彎率、爬升率同步變化，機種間的相對關係零破壞。

- [ ] **Step 1: 實作 src/tools/settings.ts**

```ts
export type PhysicsHz = 240 | 120 | 60

export interface GlobalSettings {
  /** λ 時間縮放。1.0 = 完全史實。見 spec 6.7 */
  timeScale: number
  /** 飛機模型視覺放大係數，純視覺不影響物理 */
  modelScale: number
  physicsHz: PhysicsHz
  /** 連續多幀超出預算時自動降至 120 Hz */
  autoDegrade: boolean
}

export function createGlobalSettings(): GlobalSettings {
  return { timeScale: 1, modelScale: 1, physicsHz: 240, autoDegrade: true }
}

const STORAGE_KEY = 'grok-aircraft:tuning'

export function saveToStorage(payload: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 隱私模式或配額不足，靜默略過
  }
}

export function loadFromStorage(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 略過
  }
}
```

- [ ] **Step 2: 寫 specExport 測試**

`test/unit/specExport.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { specToSource } from '../../src/tools/specExport'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

describe('specToSource', () => {
  it('產生可辨識的 TypeScript 匯出宣告', () => {
    const src = specToSource(P51D, 'P51D')
    expect(src).toContain("import type { AircraftSpec } from './types'")
    expect(src).toContain('export const P51D: AircraftSpec = {')
  })

  it('保留全部數值欄位', () => {
    const src = specToSource(BF109G6, 'BF109G6')
    expect(src).toContain(`"mass": ${BF109G6.mass}`)
    expect(src).toContain(`"cd0": ${BF109G6.drag.cd0}`)
    expect(src).toContain(`"aileronK": ${BF109G6.controlStiffening.aileronK}`)
  })

  it('輸出可被 JSON.parse 還原（去除 TS 外框後）', () => {
    const src = specToSource(P51D, 'P51D')
    const start = src.indexOf('{')
    const end = src.lastIndexOf('}')
    const parsed = JSON.parse(src.slice(start, end + 1)) as typeof P51D
    expect(parsed.mass).toBe(P51D.mass)
    expect(parsed.lift.clAlpha).toBe(P51D.lift.clAlpha)
    expect(parsed.engine.gears.length).toBe(P51D.engine.gears.length)
  })

  it('包含警示註解，提醒角度為弧度值', () => {
    expect(specToSource(P51D, 'P51D')).toContain('弧度')
  })
})
```

- [ ] **Step 3: 實作 src/tools/specExport.ts**

```ts
import type { AircraftSpec } from '../specs/types'

/**
 * 將執行時期的機種參數序列化為可直接覆蓋 src/specs/*.ts 的原始碼。
 *
 * 注意輸出的角度欄位是弧度數值而非 `15.5 * DEG` 的形式，
 * 這是刻意的——調參後的值通常不是整數度，保留原始弧度更精確。
 */
export function specToSource(spec: AircraftSpec, exportName: string): string {
  const body = JSON.stringify(spec, null, 2)
  return [
    "import type { AircraftSpec } from './types'",
    '',
    '// 由調參面板匯出。角度欄位為弧度值（非度數）。',
    `export const ${exportName}: AircraftSpec = ${body}`,
    '',
  ].join('\n')
}

/** 觸發瀏覽器下載。 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/specExport.test.ts`
預期：PASS，4 個測試全綠。

- [ ] **Step 5: 實作 src/tools/TuningPanel.ts**

```ts
import GUI from 'lil-gui'
import { RAD } from '../core/math'
import { downloadText, specToSource } from './specExport'
import { clearStorage, loadFromStorage, saveToStorage, type GlobalSettings } from './settings'
import type { AircraftSpec } from '../specs/types'
import type { DirectorGains } from '../control/FlightDirector'
import type { CameraRigOptions } from '../camera/CameraRig'

export interface TuningTargets {
  /** 執行時期副本，面板直接修改此物件 */
  specs: Record<string, AircraftSpec>
  /** 原始參數檔的深拷貝，供 Reset 還原 */
  pristine: Record<string, AircraftSpec>
  activeSpecId: string
  directorGains: DirectorGains
  cameraOptions: CameraRigOptions
  globals: GlobalSettings
}

export interface TuningCallbacks {
  onSpecChanged(): void
  onPhysicsHzChanged(hz: number): void
  onActiveSpecChanged(id: string): void
}

export class TuningPanel {
  private readonly gui: GUI

  constructor(
    private readonly t: TuningTargets,
    private readonly cb: TuningCallbacks,
  ) {
    this.restore()
    this.gui = new GUI({ title: '調參面板', width: 320 })
    this.gui.close()

    this.buildGlobals()
    this.buildAircraft()
    this.buildDirector()
    this.buildCamera()
    this.buildActions()
  }

  destroy(): void {
    this.gui.destroy()
  }

  private persist = () => {
    saveToStorage({
      specs: this.t.specs,
      directorGains: this.t.directorGains,
      globals: this.t.globals,
    })
  }

  private restore(): void {
    const saved = loadFromStorage() as Partial<TuningTargets> | null
    if (!saved) return
    if (saved.specs) Object.assign(this.t.specs, saved.specs)
    if (saved.directorGains) Object.assign(this.t.directorGains, saved.directorGains)
    if (saved.globals) Object.assign(this.t.globals, saved.globals)
  }

  private buildGlobals(): void {
    const f = this.gui.addFolder('全域')
    f.add(this.t.globals, 'timeScale', 0.3, 1.5, 0.01).name('λ 時間縮放').onChange(this.persist)
    f.add(this.t.globals, 'modelScale', 0.5, 3, 0.05).name('模型放大').onChange(this.persist)
    f.add(this.t.globals, 'physicsHz', [240, 120, 60]).name('物理步 Hz')
      .onChange((hz: number) => { this.cb.onPhysicsHzChanged(hz); this.persist() })
    f.add(this.t.globals, 'autoDegrade').name('自動降頻').onChange(this.persist)
  }

  private buildAircraft(): void {
    const f = this.gui.addFolder('機種')
    f.add(this.t, 'activeSpecId', Object.keys(this.t.specs)).name('目前機種')
      .onChange((id: string) => this.cb.onActiveSpecChanged(id))

    for (const [id, spec] of Object.entries(this.t.specs)) {
      const sf = f.addFolder(spec.name)
      sf.close()
      const changed = () => { this.cb.onSpecChanged(); this.persist() }

      const lift = sf.addFolder('升力')
      lift.add(spec.lift, 'clAlpha', 2, 7, 0.01).onChange(changed)
      lift.add(spec.lift, 'alphaZero', -0.12, 0, 0.001).name('alphaZero (rad)').onChange(changed)
      lift.add(spec.lift, 'alphaCrit', 0.15, 0.4, 0.001).name('alphaCrit (rad)').onChange(changed)
      lift.add(spec.lift, 'stallBlend', 0.05, 0.3, 0.001).onChange(changed)
      lift.add(spec.lift, 'postStallFactor', 0.3, 0.9, 0.01).onChange(changed)
      lift.add(spec.lift, 'slatAlphaBonus', 0, 0.12, 0.001).onChange(changed)

      const drag = sf.addFolder('阻力')
      drag.add(spec.drag, 'cd0', 0.008, 0.05, 0.0001).onChange(changed)
      drag.add(spec.wing, 'oswald', 0.5, 0.95, 0.005).onChange(changed)
      drag.add(spec.drag, 'machCrit', 0.5, 0.85, 0.005).onChange(changed)
      drag.add(spec.drag, 'machDragFactor', 0, 200, 1).onChange(changed)
      drag.add(spec.drag, 'cdBeta', 0, 2, 0.01).onChange(changed)

      const prop = sf.addFolder('推進')
      prop.add(spec.prop, 'etaMax', 0.6, 0.95, 0.005).onChange(changed)
      prop.add(spec.prop, 'vRef', 20, 120, 1).onChange(changed)
      prop.add(spec.prop, 'figureOfMerit', 0.4, 1, 0.01).onChange(changed)
      prop.add(spec.engine, 'ramEfficiency', 0, 1, 0.01).onChange(changed)

      const mom = sf.addFolder('力矩與阻尼')
      for (const key of ['cm0', 'cmAlpha', 'cmQ', 'cmDe', 'clBeta', 'clP', 'clDa', 'cnBeta', 'cnR', 'cnDr'] as const) {
        mom.add(spec.moments, key, -20, 20, 0.001).onChange(changed)
      }

      const stiff = sf.addFolder('舵面高速衰減')
      stiff.add(spec.controlStiffening, 'qRef', 2000, 30000, 100).onChange(changed)
      stiff.add(spec.controlStiffening, 'aileronK', 0, 3, 0.01).onChange(changed)
      stiff.add(spec.controlStiffening, 'elevatorK', 0, 3, 0.01).onChange(changed)
      stiff.add(spec.controlStiffening, 'rudderK', 0, 3, 0.01).onChange(changed)

      const inertia = sf.addFolder('慣量')
      inertia.add(spec.inertia, 'pitch', 1000, 30000, 100).onChange(changed)
      inertia.add(spec.inertia, 'yaw', 1000, 40000, 100).onChange(changed)
      inertia.add(spec.inertia, 'roll', 1000, 20000, 100).onChange(changed)

      sf.add({ export: () => this.exportSpec(id) }, 'export').name('匯出為 spec 檔')
    }
  }

  private buildDirector(): void {
    const f = this.gui.addFolder('飛行指揮儀')
    f.close()
    const g = this.t.directorGains
    f.add(g, 'rollOuter', 0.5, 8, 0.05).onChange(this.persist)
    f.add(g, 'pitchOuter', 0.5, 8, 0.05).onChange(this.persist)
    f.add(g, 'yawOuter', 0, 5, 0.05).onChange(this.persist)
    f.add(g, 'yawAim', 0, 2, 0.01).onChange(this.persist)
    f.add(g, 'deadZoneAngle', 0, 0.15, 0.001).name('死區 (rad)').onChange(this.persist)
    f.add(g, 'maxRollRateCommand', 1, 12, 0.1).onChange(this.persist)

    for (const [label, gains] of [
      ['滾轉內環', g.rollInner], ['俯仰內環', g.pitchInner], ['偏航內環', g.yawInner],
    ] as const) {
      const sub = f.addFolder(label)
      sub.close()
      sub.add(gains, 'kp', 0, 5, 0.01).onChange(this.persist)
      sub.add(gains, 'ki', 0, 3, 0.01).onChange(this.persist)
      sub.add(gains, 'kd', 0, 0.5, 0.001).onChange(this.persist)
      sub.add(gains, 'integralLimit', 0, 5, 0.05).onChange(this.persist)
    }
  }

  private buildCamera(): void {
    const f = this.gui.addFolder('相機')
    f.close()
    const c = this.t.cameraOptions
    f.add(c, 'thirdDistance', 10, 80, 1)
    f.add(c, 'thirdHeight', 0, 30, 0.5)
    f.add(c, 'springStiffness', 2, 60, 0.5)
    f.add(c, 'springDamping', 0.3, 2, 0.05)
    f.add(c, 'fovBase', 50, 100, 1)
    f.add(c, 'fovSpeedGain', 0, 20, 0.5)
    f.add(c, 'shakeAmplitude', 0, 1.5, 0.01)
  }

  private buildActions(): void {
    const f = this.gui.addFolder('動作')
    f.add({
      reset: () => {
        for (const [id, spec] of Object.entries(this.t.pristine)) {
          this.t.specs[id] = structuredClone(spec)
        }
        clearStorage()
        this.cb.onSpecChanged()
        location.reload()
      },
    }, 'reset').name('Reset to spec（重新載入）')

    f.add({
      exportAll: () => {
        for (const id of Object.keys(this.t.specs)) this.exportSpec(id)
      },
    }, 'exportAll').name('匯出全部機種')

    f.add({
      log: () => {
        const s = this.t.specs[this.t.activeSpecId]
        if (!s) return
        console.info(
          `[調參] ${s.name}  alphaCrit=${(s.lift.alphaCrit * RAD).toFixed(2)}°  ` +
          `cd0=${s.drag.cd0.toFixed(5)}  etaMax=${s.prop.etaMax.toFixed(3)}`,
        )
      },
    }, 'log').name('輸出目前值至 console')
  }

  private exportSpec(id: string): void {
    const spec = this.t.specs[id]
    if (!spec) return
    const exportName = id.toUpperCase().replace(/[^A-Z0-9]/g, '')
    downloadText(`${id}.ts`, specToSource(spec, exportName))
  }
}
```

- [ ] **Step 6: 在 main.ts 接上面板與 λ**

```ts
import { TuningPanel } from './tools/TuningPanel'
import { createGlobalSettings } from './tools/settings'
import type { AircraftSpec } from './specs/types'

const globals = createGlobalSettings()
const runtimeSpecs: Record<string, AircraftSpec> = {
  p51d: structuredClone(P51D),
  bf109g6: structuredClone(BF109G6),
}
const pristineSpecs = { p51d: structuredClone(P51D), bf109g6: structuredClone(BF109G6) }

const panel = new TuningPanel(
  {
    specs: runtimeSpecs,
    pristine: pristineSpecs,
    activeSpecId: 'p51d',
    directorGains: aircraft.director.gains,
    cameraOptions: rig.options,
    globals,
  },
  {
    onSpecChanged: () => { aircraft.setSpec(runtimeSpecs[aircraft.spec.id]!) },
    onPhysicsHzChanged: (hz) => loop.setStepHz(hz),
    onActiveSpecChanged: (id) => {
      aircraft.setSpec(runtimeSpecs[id]!)
      rebuildModel()
      rig.snapTo(aircraft.state.position, aircraft.state.orientation)
    },
  },
)
void panel
```

**`aircraft` 的初始化改為使用 `runtimeSpecs.p51d`**，機種切換改為切換 `runtimeSpecs` 的成員。

於 `frame` 中把時間縮放套用到物理：

```ts
const alpha = loop.advance(frameSeconds * globals.timeScale, (dt) => { ... })
```

並將 `model.group.scale.setScalar(globals.modelScale)` 加入渲染段落。

自動降頻：

```ts
let overBudgetFrames = 0
// 於 perf.endFrame 之後
if (globals.autoDegrade && globals.physicsHz === 240) {
  overBudgetFrames = frameSeconds > 1 / 45 ? overBudgetFrames + 1 : 0
  if (overBudgetFrames > 60) {
    globals.physicsHz = 120
    loop.setStepHz(120)
    overBudgetFrames = 0
    console.warn('[效能] 連續 60 幀超出預算，物理步降至 120 Hz')
  }
}
```

- [ ] **Step 7: 人工驗證**

Run: `npm run dev`

1. 右上角出現調參面板，可展開各分組
2. 調整 `cd0` → 飛機加速表現立即改變
3. 調整 λ 至 0.6 → 整體節奏放慢但儀表讀數維持真實空速
4. 調整模型放大 → 飛機視覺變大但操控手感不變
5. 「匯出為 spec 檔」下載 `p51d.ts`，內容可直接覆蓋原檔
6. 重新整理頁面 → 調整值仍保留（localStorage）
7. 「Reset to spec」→ 回到原始值

- [ ] **Step 8: Commit**

```bash
git add src/tools/settings.ts src/tools/specExport.ts src/tools/TuningPanel.ts src/main.ts test/unit/specExport.test.ts
git commit -m "feat: 調參面板

lil-gui 面板修改執行時期副本，原始參數檔不動。
Export as spec file 產生可直接覆蓋 src/specs/*.ts 的原始碼，
使調參結果沉澱回程式碼而非留在瀏覽器。
含 λ 時間縮放（預設 1.0 完全史實）、模型放大、
物理步切換與自動降頻。localStorage 自動保存。"
```

---

## Task 25：Telemetry 曲線與歸因面板

**Files:**
- Create: `src/tools/RingBuffer.ts`, `src/tools/Telemetry.ts`
- Modify: `src/main.ts`
- Test: `test/unit/ringBuffer.test.ts`

**Interfaces:**
- Consumes: `DirectorDebug`、`StepDiagnostics`
- Produces:
  - `RingBuffer<T>` class：`push(v: T): void`、`readonly length: number`、`at(i: number): T | undefined`、`toArray(): T[]`、`clear(): void`
  - `TelemetryChannel`、`TELEMETRY_CHANNELS`
  - `Telemetry` class：`push(t, sample): void`、`render(): void`、`toggle(): void`、`exportCsv(): void`

**這是 spec §8.4 承諾的歸因面板。** 指揮儀指令與物理實際響應並列，手感不對時直接判讀：

```
desiredP/Q 平穩但 actualP/Q 震盪   →  內環 PID 問題
desiredP/Q 本身就在震盪            →  外環增益問題
actualQ 長期低於 desiredQ          →  舵面權限不足，或速度不夠（看 limiter.source）
limiter.source 恆為 alpha          →  能量不足，非增益問題
```

- [ ] **Step 1: 寫 RingBuffer 測試**

`test/unit/ringBuffer.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../../src/tools/RingBuffer'

describe('RingBuffer', () => {
  it('未滿時依序保存', () => {
    const b = new RingBuffer<number>(5)
    b.push(1); b.push(2); b.push(3)
    expect(b.length).toBe(3)
    expect(b.toArray()).toEqual([1, 2, 3])
  })

  it('超出容量時覆寫最舊的元素', () => {
    const b = new RingBuffer<number>(3)
    for (const v of [1, 2, 3, 4, 5]) b.push(v)
    expect(b.length).toBe(3)
    expect(b.toArray()).toEqual([3, 4, 5])
  })

  it('at(0) 為最舊、at(length−1) 為最新', () => {
    const b = new RingBuffer<number>(3)
    for (const v of [1, 2, 3, 4]) b.push(v)
    expect(b.at(0)).toBe(2)
    expect(b.at(2)).toBe(4)
  })

  it('越界索引回傳 undefined', () => {
    const b = new RingBuffer<number>(3)
    b.push(1)
    expect(b.at(5)).toBeUndefined()
    expect(b.at(-1)).toBeUndefined()
  })

  it('clear 清空', () => {
    const b = new RingBuffer<number>(3)
    b.push(1); b.push(2)
    b.clear()
    expect(b.length).toBe(0)
    expect(b.toArray()).toEqual([])
  })

  it('容量為 1 時只保留最新值', () => {
    const b = new RingBuffer<number>(1)
    b.push(1); b.push(2)
    expect(b.toArray()).toEqual([2])
  })
})
```

- [ ] **Step 2: 實作 src/tools/RingBuffer.ts**

```ts
export class RingBuffer<T> {
  private readonly items: (T | undefined)[]
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity)
  }

  get length(): number {
    return this.count
  }

  push(value: T): void {
    this.items[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** i = 0 為最舊，i = length − 1 為最新。 */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined
    const start = (this.head - this.count + this.capacity) % this.capacity
    return this.items[(start + i) % this.capacity]
  }

  toArray(): T[] {
    const out: T[] = []
    for (let i = 0; i < this.count; i++) out.push(this.at(i) as T)
    return out
  }

  clear(): void {
    this.head = 0
    this.count = 0
    this.items.fill(undefined)
  }
}
```

- [ ] **Step 3: 執行測試確認通過**

Run: `npx vitest run test/unit/ringBuffer.test.ts`
預期：PASS，6 個測試全綠。

- [ ] **Step 4: 實作 src/tools/Telemetry.ts**

```ts
import { RAD } from '../core/math'
import { RingBuffer } from './RingBuffer'
import { downloadText } from './specExport'

export interface TelemetrySample {
  t: number
  values: Record<string, number>
}

export interface TelemetryChannel {
  key: string
  label: string
  color: string
  /** 繪圖時的固定值域，null 代表自動縮放 */
  range: [number, number] | null
  group: 'director' | 'physics'
}

export const TELEMETRY_CHANNELS: readonly TelemetryChannel[] = [
  { key: 'desiredP', label: '期望 p', color: '#7dfba8', range: [-6, 6], group: 'director' },
  { key: 'actualP', label: '實際 p', color: '#3fa768', range: [-6, 6], group: 'physics' },
  { key: 'desiredQ', label: '期望 q', color: '#8fc4ff', range: [-2, 2], group: 'director' },
  { key: 'actualQ', label: '實際 q', color: '#4a7bb5', range: [-2, 2], group: 'physics' },
  { key: 'alphaDeg', label: '迎角°', color: '#ffcc44', range: [-10, 25], group: 'physics' },
  { key: 'loadFactor', label: 'G', color: '#ff8a5a', range: [-4, 9], group: 'physics' },
  { key: 'ps', label: 'Ps', color: '#d78fff', range: [-80, 60], group: 'physics' },
  { key: 'errorDeg', label: '誤差°', color: '#ff5a4d', range: [0, 90], group: 'director' },
]

const WINDOW_SECONDS = 30
const SAMPLE_HZ = 30

export class Telemetry {
  private readonly buffer = new RingBuffer<TelemetrySample>(WINDOW_SECONDS * SAMPLE_HZ)
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly text: HTMLDivElement
  private visible = false
  private lastSampleTime = -Infinity
  private readonly enabled = new Set(TELEMETRY_CHANNELS.map((c) => c.key))

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = [
      'position:fixed', 'left:8px', 'top:120px', 'z-index:90',
      'background:rgba(0,0,0,.55)', 'border-radius:4px', 'pointer-events:none',
      'display:none',
    ].join(';')
    this.canvas.width = 520
    this.canvas.height = 220
    document.body.appendChild(this.canvas)

    const c = this.canvas.getContext('2d')
    if (!c) throw new Error('無法取得 Telemetry 的 2D context')
    this.ctx = c

    this.text = document.createElement('div')
    this.text.style.cssText = [
      'position:fixed', 'left:8px', 'top:348px', 'z-index:90',
      'font:11px/1.5 ui-monospace,Consolas,monospace', 'color:#cfe8d8',
      'background:rgba(0,0,0,.55)', 'padding:6px 9px', 'border-radius:4px',
      'white-space:pre', 'pointer-events:none', 'display:none',
    ].join(';')
    document.body.appendChild(this.text)

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') { e.preventDefault(); this.toggle() }
      if (e.code === 'F4' && e.shiftKey) { e.preventDefault(); this.exportCsv() }
    })
  }

  toggle(): void {
    this.visible = !this.visible
    this.canvas.style.display = this.visible ? 'block' : 'none'
    this.text.style.display = this.visible ? 'block' : 'none'
  }

  push(t: number, values: Record<string, number>): void {
    if (t - this.lastSampleTime < 1 / SAMPLE_HZ) return
    this.lastSampleTime = t
    this.buffer.push({ t, values: { ...values } })
  }

  /** 歸因面板：指揮儀指令與物理實際響應並列。 */
  renderAttribution(info: {
    desiredP: number; actualP: number
    desiredQ: number; actualQ: number
    desiredR: number; actualR: number
    errorDeg: number; rollCommandDeg: number
    limiterSource: string; nAvailable: number
    alphaDeg: number; betaDeg: number; loadFactor: number
    aileron: number; elevator: number; rudder: number
  }): void {
    if (!this.visible) return
    const f = (v: number, d = 2) => v.toFixed(d).padStart(7)
    this.text.textContent =
      `           指揮儀      物理\n` +
      `滾轉率 p   ${f(info.desiredP)}  ${f(info.actualP)}\n` +
      `俯仰率 q   ${f(info.desiredQ)}  ${f(info.actualQ)}\n` +
      `偏航率 r   ${f(info.desiredR)}  ${f(info.actualR)}\n` +
      `\n` +
      `誤差角     ${f(info.errorDeg, 1)}°   滾轉指令 ${f(info.rollCommandDeg, 1)}°\n` +
      `迎角       ${f(info.alphaDeg, 1)}°   側滑 ${f(info.betaDeg, 1)}°\n` +
      `過載       ${f(info.loadFactor)}    可用 ${f(info.nAvailable)}\n` +
      `限制器     ${info.limiterSource}\n` +
      `舵面       a${f(info.aileron)} e${f(info.elevator)} r${f(info.rudder)}`
  }

  render(): void {
    if (!this.visible || this.buffer.length < 2) return
    const { ctx, canvas } = this
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const samples = this.buffer.toArray()
    const t0 = samples[0]!.t
    const t1 = samples[samples.length - 1]!.t
    const span = Math.max(t1 - t0, 1e-3)

    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * H
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    for (const ch of TELEMETRY_CHANNELS) {
      if (!this.enabled.has(ch.key)) continue
      let lo: number
      let hi: number
      if (ch.range) {
        [lo, hi] = ch.range
      } else {
        lo = Infinity; hi = -Infinity
        for (const s of samples) {
          const v = s.values[ch.key]
          if (v === undefined) continue
          lo = Math.min(lo, v); hi = Math.max(hi, v)
        }
        if (!Number.isFinite(lo)) continue
        if (hi - lo < 1e-6) { lo -= 1; hi += 1 }
      }

      ctx.strokeStyle = ch.color
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let started = false
      for (const s of samples) {
        const v = s.values[ch.key]
        if (v === undefined) continue
        const x = ((s.t - t0) / span) * W
        const y = H - ((v - lo) / (hi - lo)) * H
        if (started) ctx.lineTo(x, y)
        else { ctx.moveTo(x, y); started = true }
      }
      ctx.stroke()
    }

    // 圖例
    ctx.font = '10px ui-monospace, Consolas, monospace'
    ctx.textBaseline = 'top'
    let lx = 6
    for (const ch of TELEMETRY_CHANNELS) {
      ctx.fillStyle = ch.color
      ctx.fillText(ch.label, lx, 4)
      lx += ctx.measureText(ch.label).width + 12
    }
  }

  exportCsv(): void {
    const samples = this.buffer.toArray()
    if (samples.length === 0) return
    const keys = TELEMETRY_CHANNELS.map((c) => c.key)
    const lines = [['t', ...keys].join(',')]
    for (const s of samples) {
      lines.push([s.t.toFixed(4), ...keys.map((k) => (s.values[k] ?? '').toString())].join(','))
    }
    downloadText('telemetry.csv', lines.join('\n'))
  }
}

void RAD
```

- [ ] **Step 5: 移除未使用的匯入**

刪除檔尾的 `void RAD` 與 `RAD` 的 import。

- [ ] **Step 6: 在 main.ts 接上 Telemetry**

```ts
import { Telemetry } from './tools/Telemetry'
import { RAD } from './core/math'

const telemetry = new Telemetry()
```

於 `frame` 的渲染段落末尾：

```ts
const dbg = aircraft.dbg
telemetry.push(elapsed, {
  desiredP: dbg.desiredP, actualP: dbg.actualP,
  desiredQ: dbg.desiredQ, actualQ: dbg.actualQ,
  alphaDeg: aircraft.diag.aero.alpha * RAD,
  loadFactor: aircraft.diag.loadFactor,
  ps: aircraft.specificExcessPowerActual,
  errorDeg: dbg.errorAngle * RAD,
})
telemetry.renderAttribution({
  desiredP: dbg.desiredP, actualP: dbg.actualP,
  desiredQ: dbg.desiredQ, actualQ: dbg.actualQ,
  desiredR: dbg.desiredR, actualR: dbg.actualR,
  errorDeg: dbg.errorAngle * RAD,
  rollCommandDeg: dbg.rollCommand * RAD,
  limiterSource: dbg.limiter.source,
  nAvailable: dbg.limiter.nLimit,
  alphaDeg: aircraft.diag.aero.alpha * RAD,
  betaDeg: aircraft.diag.aero.beta * RAD,
  loadFactor: aircraft.diag.loadFactor,
  aileron: aircraft.controls.aileron,
  elevator: aircraft.controls.elevator,
  rudder: aircraft.controls.rudder,
})
telemetry.render()
```

- [ ] **Step 7: 人工驗證**

Run: `npm run dev`

按 `F2` 開啟。確認：曲線隨飛行滾動；急拉桿時 `期望 q` 先動、`實際 q` 隨後跟上；大 G 時 `Ps` 曲線大幅下探；低速拉桿時歸因面板的「限制器」顯示 `alpha`。`Shift+F4` 匯出 CSV。

- [ ] **Step 8: Commit**

```bash
git add src/tools/RingBuffer.ts src/tools/Telemetry.ts src/main.ts test/unit/ringBuffer.test.ts
git commit -m "feat: Telemetry 曲線與歸因面板

30 秒環形緩衝區、多頻道滾動曲線、CSV 匯出。
歸因面板並列顯示指揮儀指令與物理實際響應（spec 8.4），
使手感問題能直接歸因於外環增益、內環 PID 或能量不足。"
```

---

## Task 26：EM 圖產生器

**Files:**
- Create: `src/tools/EmDiagram.ts`
- Modify: `src/analysis/envelope.ts`（新增 `turnRateAtPs`）、`src/main.ts`
- Test: `test/unit/emDiagram.test.ts`

**Interfaces:**
- Consumes: `src/analysis/envelope.ts`
- Produces:
  - `turnRateAtPs(spec, altitude, tas, psLevel, throttle): number`（新增至 envelope）
  - `EmCurves`、`computeEmCurves(spec, altitude, opts?): EmCurves`
  - `computeClimbCurve(spec, opts?): { altitude: number; rate: number }[]`
  - `computeSpeedCurve(spec, opts?): { altitude: number; speed: number }[]`
  - `EmDiagram` class：`toggle(): void`、`render(specs: AircraftSpec[]): void`、`exportJson(specs: AircraftSpec[]): void`

**這是 M1 的最終驗收（spec §12.3）。** 若疊圖能直接讀出「Bf 109 在中低速持續轉彎率優於 P-51」「P-51 在高速與高空全面領先」，且與史料的定性描述吻合，模型就成立。這比主觀試飛感受可靠。

輸出的 JSON 同時是 **M4 的 AI 查表資料來源**。

- [ ] **Step 1: 新增 turnRateAtPs 至 src/analysis/envelope.ts**

於 `sustainedTurnRate` 之後加入：

```ts
/**
 * 指定 Ps 等級對應的轉彎率，rad/s。
 * psLevel = 0 時等同 sustainedTurnRate；負值代表容許能量流失。
 * 供 EM 圖繪製 Ps 等高線族使用。
 */
export function turnRateAtPs(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  psLevel: number,
  throttle = WEP_THROTTLE,
): number {
  const nMax = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (nMax <= 1) return 0
  if (specificExcessPower(spec, altitude, tas, nMax, throttle) >= psLevel) {
    return (G0 * Math.sqrt(nMax * nMax - 1)) / tas
  }
  if (specificExcessPower(spec, altitude, tas, 1, throttle) < psLevel) return 0

  let lo = 1
  let hi = nMax
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (specificExcessPower(spec, altitude, mid, 1, throttle) >= psLevel) lo = mid
    else hi = mid
  }
  return lo <= 1 ? 0 : (G0 * Math.sqrt(lo * lo - 1)) / tas
}
```

- [ ] **Step 2: 寫測試**

`test/unit/emDiagram.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { turnRateAtPs } from '../../src/analysis/envelope'
import { computeEmCurves, computeClimbCurve, computeSpeedCurve } from '../../src/tools/EmDiagram'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const RAD2DEG = 180 / Math.PI

describe('turnRateAtPs', () => {
  it('psLevel = 0 時等同持續轉彎率', () => {
    const v = 300 / 3.6
    expect(turnRateAtPs(P51D, 0, v, 0)).toBeCloseTo(
      turnRateAtPs(P51D, 0, v, 0), 10,
    )
  })

  it('容許能量流失時轉彎率較高', () => {
    const v = 320 / 3.6
    expect(turnRateAtPs(P51D, 0, v, -60)).toBeGreaterThanOrEqual(turnRateAtPs(P51D, 0, v, 0))
  })

  it('要求能量累積時轉彎率較低', () => {
    const v = 350 / 3.6
    expect(turnRateAtPs(P51D, 0, v, 30)).toBeLessThanOrEqual(turnRateAtPs(P51D, 0, v, 0))
  })
})

describe('computeEmCurves', () => {
  const curves = computeEmCurves(P51D, 0)

  it('速度取樣涵蓋失速至極速', () => {
    expect(curves.speeds.length).toBeGreaterThan(20)
    expect(curves.speeds[0]!).toBeLessThan(curves.speeds[curves.speeds.length - 1]!)
  })

  it('瞬間轉彎率不低於持續轉彎率', () => {
    for (let i = 0; i < curves.speeds.length; i++) {
      expect(curves.instantaneous[i]!).toBeGreaterThanOrEqual(curves.sustained[i]! - 1e-9)
    }
  })

  it('角落速度落在取樣範圍內', () => {
    expect(curves.cornerSpeed).toBeGreaterThan(curves.speeds[0]!)
    expect(curves.cornerSpeed).toBeLessThan(curves.speeds[curves.speeds.length - 1]!)
  })

  it('Ps 等高線族齊備且數值有限', () => {
    expect(curves.psContours.length).toBeGreaterThanOrEqual(3)
    for (const c of curves.psContours) {
      expect(c.rates.length).toBe(curves.speeds.length)
      for (const r of c.rates) expect(Number.isFinite(r)).toBe(true)
    }
  })

  it('高度上升時瞬間轉彎率峰值下降', () => {
    const low = Math.max(...computeEmCurves(P51D, 0).instantaneous)
    const high = Math.max(...computeEmCurves(P51D, 8000).instantaneous)
    expect(high).toBeLessThan(low)
  })
})

describe('兩機種疊圖的定性關係（M1 最終驗收）', () => {
  it('Bf 109 在中低速的持續轉彎率優於 P-51', () => {
    const p = computeEmCurves(P51D, 0)
    const b = computeEmCurves(BF109G6, 0)
    const sampleAt = (c: typeof p, kmh: number) => {
      const v = kmh / 3.6
      let best = 0
      let bestDist = Infinity
      c.speeds.forEach((s, i) => {
        const d = Math.abs(s - v)
        if (d < bestDist) { bestDist = d; best = c.sustained[i]! }
      })
      return best * RAD2DEG
    }
    expect(sampleAt(b, 300)).toBeGreaterThan(sampleAt(p, 300))
  })

  it('P-51 在 8,000 m 的可用轉彎率不劣於 Bf 109', () => {
    const p = Math.max(...computeEmCurves(P51D, 8000).sustained)
    const b = Math.max(...computeEmCurves(BF109G6, 8000).sustained)
    expect(p).toBeGreaterThanOrEqual(b * 0.95)
  })
})

describe('computeClimbCurve / computeSpeedCurve', () => {
  it('爬升率隨高度單調遞減至 0', () => {
    const c = computeClimbCurve(P51D)
    expect(c[0]!.rate).toBeGreaterThan(c[c.length - 1]!.rate)
    expect(c[c.length - 1]!.rate).toBeLessThan(2)
  })

  it('極速曲線在臨界高度附近出現峰值', () => {
    const c = computeSpeedCurve(P51D)
    let peakAlt = 0
    let peak = 0
    for (const p of c) if (p.speed > peak) { peak = p.speed; peakAlt = p.altitude }
    expect(peakAlt).toBeGreaterThan(5000)
    expect(peakAlt).toBeLessThan(10000)
  })

  it('P-51 的極速峰值高度高於 Bf 109', () => {
    const peakOf = (c: { altitude: number; speed: number }[]) =>
      c.reduce((a, b) => (b.speed > a.speed ? b : a)).altitude
    expect(peakOf(computeSpeedCurve(P51D))).toBeGreaterThan(peakOf(computeSpeedCurve(BF109G6)))
  })
})
```

- [ ] **Step 3: 實作 src/tools/EmDiagram.ts**

```ts
import { RAD } from '../core/math'
import {
  cornerSpeed, instantaneousTurnRate, maxClimbRate, maxLevelSpeed,
  stallSpeed, sustainedTurnRate, turnRateAtPs,
} from '../analysis/envelope'
import { downloadText } from './specExport'
import type { AircraftSpec } from '../specs/types'

export interface PsContour {
  level: number
  rates: number[]
}

export interface EmCurves {
  altitude: number
  /** m/s */
  speeds: number[]
  /** rad/s */
  instantaneous: number[]
  sustained: number[]
  psContours: PsContour[]
  cornerSpeed: number
}

const DEFAULT_SAMPLES = 60
const PS_LEVELS = [50, 0, -50, -100]

export function computeEmCurves(
  spec: AircraftSpec,
  altitude: number,
  samples = DEFAULT_SAMPLES,
): EmCurves {
  const vMin = stallSpeed(spec, altitude, 1) * 0.95
  const vMax = Math.max(maxLevelSpeed(spec, altitude) * 1.15, vMin + 20)

  const speeds: number[] = []
  const instantaneous: number[] = []
  const sustained: number[] = []
  for (let i = 0; i <= samples; i++) {
    const v = vMin + ((vMax - vMin) * i) / samples
    speeds.push(v)
    instantaneous.push(instantaneousTurnRate(spec, altitude, v))
    sustained.push(sustainedTurnRate(spec, altitude, v))
  }

  const psContours = PS_LEVELS.map((level) => ({
    level,
    rates: speeds.map((v) => turnRateAtPs(spec, altitude, v, level)),
  }))

  return {
    altitude, speeds, instantaneous, sustained, psContours,
    cornerSpeed: cornerSpeed(spec, altitude),
  }
}

export function computeClimbCurve(
  spec: AircraftSpec,
  step = 500,
  maxAltitude = 14000,
): { altitude: number; rate: number }[] {
  const out: { altitude: number; rate: number }[] = []
  for (let h = 0; h <= maxAltitude; h += step) {
    out.push({ altitude: h, rate: Math.max(maxClimbRate(spec, h).rate, 0) })
  }
  return out
}

export function computeSpeedCurve(
  spec: AircraftSpec,
  step = 500,
  maxAltitude = 14000,
): { altitude: number; speed: number }[] {
  const out: { altitude: number; speed: number }[] = []
  for (let h = 0; h <= maxAltitude; h += step) {
    out.push({ altitude: h, speed: maxLevelSpeed(spec, h) })
  }
  return out
}

const PLOT_ALTITUDES = [0, 3000, 6000]
const SERIES_COLORS = ['#7dfba8', '#ff8a5a', '#8fc4ff']

interface Rect { x: number; y: number; w: number; h: number }

function drawAxes(
  ctx: CanvasRenderingContext2D, r: Rect,
  xLabel: string, yLabel: string,
  xMax: number, yMax: number,
): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '10px ui-monospace, Consolas, monospace'
  ctx.lineWidth = 1

  ctx.strokeRect(r.x, r.y, r.w, r.h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let i = 0; i <= 5; i++) {
    const x = r.x + (r.w * i) / 5
    ctx.beginPath(); ctx.moveTo(x, r.y + r.h); ctx.lineTo(x, r.y + r.h + 4); ctx.stroke()
    ctx.fillText(((xMax * i) / 5).toFixed(0), x, r.y + r.h + 6)
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const y = r.y + r.h - (r.h * i) / 4
    ctx.beginPath(); ctx.moveTo(r.x - 4, y); ctx.lineTo(r.x, y); ctx.stroke()
    ctx.fillText(((yMax * i) / 4).toFixed(0), r.x - 6, y)
  }
  ctx.textAlign = 'center'
  ctx.fillText(xLabel, r.x + r.w / 2, r.y + r.h + 20)
  ctx.save()
  ctx.translate(r.x - 34, r.y + r.h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(yLabel, 0, 0)
  ctx.restore()
}

function plotLine(
  ctx: CanvasRenderingContext2D, r: Rect,
  xs: number[], ys: number[], xMax: number, yMax: number,
  color: string, dash: number[] = [],
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.4
  ctx.setLineDash(dash)
  ctx.beginPath()
  let started = false
  for (let i = 0; i < xs.length; i++) {
    const x = r.x + (xs[i]! / xMax) * r.w
    const y = r.y + r.h - (ys[i]! / yMax) * r.h
    if (started) ctx.lineTo(x, y)
    else { ctx.moveTo(x, y); started = true }
  }
  ctx.stroke()
  ctx.setLineDash([])
}

export class EmDiagram {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private visible = false

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 1180
    this.canvas.height = 720
    this.canvas.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:200', 'background:rgba(6,10,14,.96)', 'border-radius:6px',
      'max-width:96vw', 'max-height:92vh', 'display:none',
    ].join(';')
    document.body.appendChild(this.canvas)
    const c = this.canvas.getContext('2d')
    if (!c) throw new Error('無法取得 EM 圖的 2D context')
    this.ctx = c
  }

  toggle(): void {
    this.visible = !this.visible
    this.canvas.style.display = this.visible ? 'block' : 'none'
  }

  get isVisible(): boolean {
    return this.visible
  }

  /** 兩台飛機疊圖。第一台為實線，第二台為虛線。 */
  render(specs: AircraftSpec[]): void {
    const { ctx, canvas } = this
    ctx.fillStyle = 'rgba(6,10,14,1)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#cfe8d8'
    ctx.font = 'bold 14px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(
      `EM 圖   實線 = ${specs[0]?.name ?? '-'}   虛線 = ${specs[1]?.name ?? '-'}   （F4 關閉／Shift+E 匯出 JSON）`,
      24, 16,
    )

    // 上排三張 Doghouse plot（0 / 3000 / 6000 m）
    const plotW = 340
    const plotH = 300
    PLOT_ALTITUDES.forEach((alt, idx) => {
      const r: Rect = { x: 70 + idx * (plotW + 46), y: 60, w: plotW, h: plotH }
      const xMax = 800 // km/h
      const yMax = 32 // 度/秒

      drawAxes(ctx, r, '速度 km/h', '轉彎率 °/s', xMax, yMax)
      ctx.fillStyle = '#cfe8d8'
      ctx.font = '11px ui-monospace, Consolas, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`${alt} m`, r.x + 6, r.y + 6)

      specs.forEach((spec, si) => {
        const dash = si === 0 ? [] : [5, 4]
        const c = computeEmCurves(spec, alt)
        const xs = c.speeds.map((v) => v * 3.6)
        plotLine(ctx, r, xs, c.instantaneous.map((v) => v * RAD), xMax, yMax, SERIES_COLORS[0]!, dash)
        plotLine(ctx, r, xs, c.sustained.map((v) => v * RAD), xMax, yMax, SERIES_COLORS[1]!, dash)
        for (const contour of c.psContours) {
          if (contour.level === 0) continue
          ctx.globalAlpha = 0.35
          plotLine(ctx, r, xs, contour.rates.map((v) => v * RAD), xMax, yMax, SERIES_COLORS[2]!, dash)
          ctx.globalAlpha = 1
        }
        // 角落速度標記
        const cx = r.x + ((c.cornerSpeed * 3.6) / xMax) * r.w
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'
        ctx.setLineDash([2, 3])
        ctx.beginPath(); ctx.moveTo(cx, r.y); ctx.lineTo(cx, r.y + r.h); ctx.stroke()
        ctx.setLineDash([])
      })
    })

    // 下排兩張：爬升率與極速 vs 高度
    const lower = 420
    const climbRect: Rect = { x: 70, y: lower, w: 470, h: 240 }
    drawAxes(ctx, climbRect, '爬升率 m/s', '高度 m', 25, 14000)
    specs.forEach((spec, si) => {
      const c = computeClimbCurve(spec)
      plotLine(
        ctx, climbRect, c.map((p) => p.rate), c.map((p) => p.altitude),
        25, 14000, SERIES_COLORS[0]!, si === 0 ? [] : [5, 4],
      )
    })

    const speedRect: Rect = { x: 640, y: lower, w: 470, h: 240 }
    drawAxes(ctx, speedRect, '極速 km/h', '高度 m', 800, 14000)
    specs.forEach((spec, si) => {
      const c = computeSpeedCurve(spec)
      plotLine(
        ctx, speedRect, c.map((p) => p.speed * 3.6), c.map((p) => p.altitude),
        800, 14000, SERIES_COLORS[1]!, si === 0 ? [] : [5, 4],
      )
    })

    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '11px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'left'
    ctx.fillText('綠 = 瞬間轉彎率　橙 = 持續轉彎率　藍(淡) = Ps 等高線　白虛線 = 角落速度', 70, 372)
  }

  /** 匯出供 M4 的 AI 查表使用。 */
  exportJson(specs: AircraftSpec[]): void {
    const payload = specs.map((spec) => ({
      id: spec.id,
      name: spec.name,
      em: PLOT_ALTITUDES.map((alt) => computeEmCurves(spec, alt)),
      climb: computeClimbCurve(spec),
      topSpeed: computeSpeedCurve(spec),
    }))
    downloadText('em-data.json', JSON.stringify(payload, null, 2))
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/unit/emDiagram.test.ts`
預期：PASS。

**「Bf 109 在中低速的持續轉彎率優於 P-51」若失敗**，代表 L3 的對應斷言也應該失敗——回到 Task 15 的調參對照表處理，不要在此處放寬斷言。

- [ ] **Step 5: 在 main.ts 接上 EM 圖**

```ts
import { EmDiagram } from './tools/EmDiagram'

const emDiagram = new EmDiagram()
window.addEventListener('keydown', (e) => {
  const list = [runtimeSpecs.p51d!, runtimeSpecs.bf109g6!]
  if (e.code === 'F4' && !e.shiftKey) {
    e.preventDefault()
    emDiagram.toggle()
    if (emDiagram.isVisible) emDiagram.render(list)
  }
  if (e.code === 'KeyE' && e.shiftKey) {
    e.preventDefault()
    emDiagram.exportJson(list)
  }
})
```

- [ ] **Step 6: 人工驗證**

Run: `npm run dev`

按 `F4` 開啟 EM 圖。**這是 M1 的最終驗收畫面**，逐項確認：

1. 三張 Doghouse plot（0 / 3,000 / 6,000 m）都畫出瞬間與持續轉彎率曲線
2. 角落速度標記落在合理位置（海平面約 300–380 km/h）
3. **兩台飛機疊圖能直接讀出交叉點**：109（虛線）在中低速持續轉彎率較高，P-51（實線）在高速段較高
4. 爬升率圖：109 在低空較高，P-51 在高空較高，交叉點清晰
5. 極速圖：P-51 的峰值明顯較高且位於更高的高度，呈現雙峰特徵
6. `Shift+E` 匯出 `em-data.json`

調參後重按 `F4` 可立即看到曲線變化——這是驗證調參效果最直接的工具。

- [ ] **Step 7: Commit**

```bash
git add src/tools/EmDiagram.ts src/analysis/envelope.ts src/main.ts test/unit/emDiagram.test.ts
git commit -m "feat: EM 圖產生器

三張 Doghouse plot（瞬間/持續轉彎率、Ps 等高線、角落速度）
加上爬升率與極速對高度曲線，兩機種疊圖比較。
以離線批次呼叫純函數計算，不建立 Aircraft 物件。
JSON 輸出同時作為 M4 的 AI 查表資料來源。"
```

---

## Task 27：M1 驗收與 spec 同步

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-07-31-m0-m1-flight-model-design.md`

**Interfaces:**
- Consumes: 全部
- Produces: 無新程式介面。

- [ ] **Step 1: 執行完整驗證**

依序執行並記錄結果：

```bash
npm test              # 全部測試套件
npm run bench         # 微基準
npx tsc --noEmit      # 型別檢查
npm run build         # 正式建置
```

**全部必須通過。** 微基準的 `stepDynamics` 單步耗時必須 < 20 µs（spec §3.10）。

- [ ] **Step 2: 逐項確認 spec §3 的十項驗收條件**

在瀏覽器中依 spec §3.2 的人工試飛清單逐項確認，並把結果記錄下來：

```
自動化
 1. L2 史實性能 ±5% 全綠 .................... [ ]
 2. L3 平衡關係全綠 ......................... [ ]
 3. L4 指揮儀 120 案例全綠 .................. [ ]

人工試飛
 4. 拉桿過猛 → 失速掉頭，需推桿改出 ......... [ ]
 5. 爬升至 9,000 m 以上 → 推力明顯不足 ...... [ ]
 6. 高速大 G 轉彎 → 速度肉眼可見流失 ........ [ ]
 7. 切換機種後性格差異明顯可辨 .............. [ ]

工具
 8. EM 圖三個高度的 doghouse plot 皆合理，
    兩機種疊圖與史料定性描述吻合 ............ [ ]

效能
 9. 60 FPS ................................. [ ]
10. 微基準 < 20 µs/步 ...................... [ ]
```

**任一項未通過，回到對應任務處理，不要放寬標準。** 對照表：

| 未通過項 | 回到 |
|---|---|
| 1 | Task 14 調參 |
| 2 | Task 15 調參對照表 |
| 3 | Task 18 增益診斷對照表 |
| 4, 6 | Task 10（誘導阻力與 CL 崩塌）與 Task 17（限制器） |
| 5 | Task 11（引擎功率曲線與 ram） |
| 7 | Task 15 與 Task 21（外型辨識度） |
| 8 | Task 26，但根因通常在 Task 14/15 |
| 9, 10 | Task 6 效能覆蓋層診斷、Task 12 熱路徑檢查 |

- [ ] **Step 3: 撰寫 README.md**

```markdown
# Grok Aircraft

網頁 3D 空戰遊戲。二戰活塞戰鬥機的能量戰模擬。

目前進度：**M0 + M1** —— 可駕駛的單機飛行模型與調參工具。

## 執行

```bash
npm install
npm run dev
```

## 操作

| 輸入 | 功能 |
|---|---|
| 滑鼠 | 移動準星，飛機自動滾轉並拉桿追隨 |
| 左鍵 | 取得滑鼠鎖定 |
| 右鍵按住 + 滑鼠 | 自由視角（飛機不轉向），放開後回正 |
| `W` / `S` | 增加 / 減少油門（>100% 為 WEP） |
| `V` | 第三人稱 ↔ 機首視角 |
| `C` | 切換機種（P-51D ↔ Bf 109 G-6） |
| `R` | 重置 |

## 除錯與工具

| 按鍵 | 工具 |
|---|---|
| `F2` | Telemetry 曲線與歸因面板 |
| `F3` | 效能覆蓋層 |
| `F4` | EM 圖（Doghouse plot、爬升率、極速） |
| `Shift` + `F4` | 匯出 Telemetry CSV |
| `Shift` + `E` | 匯出 EM 資料 JSON |
| 右上角面板 | 即時調參（氣動、推進、指揮儀增益、相機、λ 時間縮放） |

## HUD 判讀

`Ps`（比超量功率，m/s）是能量戰的核心讀數：正值代表能量在累積，負值代表在流失。
大 G 轉彎時它會掉到 −40 以下——那就是你正在用速度換角度。

`Es`（比能量，km）= 高度 + 速度的等效高度，是同時涵蓋高度與速度的單一指標。

## 測試

```bash
npm test          # 單元 / 史實性能 / 平衡關係 / 指揮儀矩陣
npm run bench     # 物理步微基準（門檻 20 µs/步）
```

## 文件

- 設計規格：`docs/superpowers/specs/2026-07-31-m0-m1-flight-model-design.md`
- 實作計畫：`docs/superpowers/plans/2026-07-31-m0-m1-flight-model.md`
```

- [ ] **Step 4: 將五項 Spec 修訂同步回設計文件**

編輯 `docs/superpowers/specs/2026-07-31-m0-m1-flight-model-design.md`：

1. **§6.2 升力**：改為 `CL_max` 由 `CL_α × (α_crit − α_0)` 推導；移除縫翼的 `CL_max +0.15`，只保留 `α_crit +2.5°`
2. **§6.4 推進**：加入進氣衝壓恢復小節，含 `ramFactor` 公式、`ramEfficiency` 參數，以及「缺此項時 P-51D 於 7,600 m 推力 3,563 N < 阻力 4,300 N」的實算說明
3. **§7.1 參數表**：加入 `α_0` 欄位（P-51 −2.5°、109 −2.0°）；`CL_max` 改標示為「推導值」；縫翼加成改為 `α_crit +2.5°`
4. **§13.2**：說明 L2/L3 改用 `src/analysis/envelope.ts` 的準靜態解析求解器，覆蓋率缺口由端對端交叉驗證測試補回
5. **§14.1 目錄結構**：加入 `src/analysis/envelope.ts`、`src/physics/axes.ts`、`src/hud/attitude-math.ts`、`src/hud/types.ts`、`src/tools/RingBuffer.ts`、`src/tools/settings.ts`、`src/tools/specExport.ts`、`src/render/geometry/silhouettes.ts`

於文件末尾加入一節記錄修訂緣由：

```markdown
## 19. 實作期修訂紀錄

| 日期 | 修訂 | 緣由 |
|---|---|---|
| 2026-07-31 | CL_max 改為推導值 | 原本 CL_α、α_crit、CL_max 三者互相矛盾（4.4 × 15° = 1.15 ≠ 1.45），且會在失速點造成 CL 曲線不連續 |
| 2026-07-31 | 加入進氣衝壓恢復 | 實算 P-51D 於 7,600 m 推力 3,563 N < 阻力 4,300 N，史實極速 703 km/h 無法達成 |
| 2026-07-31 | L2/L3 改用準靜態求解器 | 跑 240 Hz 積分器到穩態太慢且受積分誤差影響；覆蓋率缺口由端對端 Ps 交叉驗證補回 |
| 2026-07-31 | 移除 slatClBonus | 在推導模型下會與 slatAlphaBonus 互相打架 |
| 2026-07-31 | 新增 src/analysis/ | 求解器需被測試呼叫，不應相依於含 Canvas 繪圖的 tools/ |
```

- [ ] **Step 5: 最終完整驗證**

```bash
npm test && npx tsc --noEmit && npm run build
```

預期：全部通過，`dist/` 產出成功。

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs
git commit -m "docs: M1 驗收與 spec 同步

README 記錄操作方式、除錯工具與 HUD 判讀。
設計文件同步五項實作期修訂（CL_max 推導、進氣衝壓恢復、
準靜態求解器、移除 slatClBonus、新增 analysis 目錄）
並附修訂緣由紀錄。"
```

- [ ] **Step 7: 標記里程碑**

```bash
git tag -a m1-flight-model -m "M0 + M1：可飛行的單機與飛行模型

兩台飛機的史實性能落在 ±5%，相對性格關係成立，
指揮儀 120 案例矩陣通過，EM 圖疊圖與史料定性描述吻合。"
git log --oneline
```

---

**M1 完成。** 下一步是 M2 的獨立 spec → plan → 實作循環（武器與彈道，或依 spec §17 的既定順序）。

---

## 附錄：全域除錯按鍵一覽

實作過程中會逐步加入，此處集中記錄避免衝突：

| 按鍵 | 功能 | 加入於 |
|---|---|---|
| `F2` | Telemetry 曲線與歸因面板 | Task 25 |
| `F3` | 效能覆蓋層 | Task 6 |
| `F4` | EM 圖 | Task 26 |
| `Shift` + `F4` | 匯出 Telemetry CSV | Task 25 |
| `Shift` + `E` | 匯出 EM 資料 JSON | Task 26 |
| `W` / `S` | 油門 | Task 19 |
| `V` | 視角切換 | Task 19 |
| `C` | 切換機種 | Task 19 |
| `R` | 重置 | Task 19 |

