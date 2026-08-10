# 海面太陽反光 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 海面在特定視角出現太陽反光（glitter path），維持 low-poly 輪廓，遠海與近海無接縫，天空有對應的太陽盤。

**Architecture:** 太陽的方向／顏色抽成 `src/render/sun.ts` 這個葉節點模組，由 `scene.ts`（燈光）、`sky.ts`（太陽盤）、`ocean.ts`（反光）三處共用。海面沿用既有的 `MeshStandardMaterial` + `onBeforeCompile`，在**片段**著色器裡由 `WAVES` 的解析導數算法線、坡度相依的粗糙度、Fresnel 與 glitter；細浪面與遠海共用同一段程式碼，所以 5 km 接縫在光照上完全連續。每一條著色器公式都寫一份 CPU 版並由測試釘住兩者一致。

**Tech Stack:** TypeScript（strict）、three.js、vitest、Playwright、Vite

## Global Constraints

以下每一條在**每一個 task** 都成立，不再逐條重複：

- 回覆一律用繁體中文；程式碼註解與 commit message 也是。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已被修改的檔案。一律列明確路徑。
- **不得引入 `@types/node`**：不可用 `node:path`、`__dirname`、`process`、`fs`。
- `tsconfig` 開著 `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`。
- 模組相依禁令（既有）：`src/world/` 不得 import `src/render/` 或 `src/hud/`；`src/ai/` 不得 import `src/battle/`；`src/hud/` 不得 import `src/battle/` 或 `src/world/`；`src/render/vortex.ts` 與 `tube.ts` 不得 import `src/battle/`、`src/ai/`、`src/hud/`；**`src/render/fog.ts` 不得 import `scene.ts`**。
- 本次新增的禁令：**`src/render/sun.ts` 不得 import 任何其他 render 模組**（它是葉節點，否則會與 `sky.ts` ↔ `fog.ts` 形成環）。
- 熱路徑不得配置記憶體（每幀跑的程式碼不得 `new`）。
- **絕不為了讓測試變綠而放寬門檻。** 護欄重新定值是專案負責人的決定，不是實作者的 —— 紅了要先量、先報告、先問。
- 每一條新測試都要**先驗紅**（或以 mutation 證明它是承重的）。
- **絕不用 PowerShell 讀寫含中文的檔案。** 用 Read 工具，或 Python 搭配 `io.open(..., encoding='utf-8')`。
- commit message 含中文時寫進 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`，結尾附 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 與 `Claude-Session:` 兩行 trailer。
- 型別檢查指令是 `npx tsc --noEmit`（**沒有** `npm run typecheck`）。
- `perf-gate.test.ts` 與 `rematch.test.ts` 必須單獨跑。
- 暫存檔放 `$CLAUDE_JOB_DIR/tmp`。
- **不寫飛機外形的測試。**
- 分支：`feat/ocean-glint`（已建立，spec 已 commit 於 `9568be1`）。
- **`WAVES`、`gerstnerHeight`、`FAR_SEA_Y`、`OCEAN_SIZE`、`OCEAN_SEGMENTS` 一個字都不准動** —— `crash.ts` / `splash` / `wrecks` 全走 `heightAt`，動它就動到物理。
- **`fog.test.ts` 既有的任何門檻都不准改。**
- §11 那五個參數（`GLITTER_ROUGHNESS_MIN`/`MAX`、`GLITTER_FADE_START`/`END`、`SUN_ANGULAR_RADIUS`、`SUN_HALO_POWER`/`STRENGTH`、法線量化階數）用本計畫給的暫定值實作，**最終值由專案負責人人工驗收回填，實作者不得代填**。

## 檔案結構

| 檔案 | 動作 | 單一責任 |
|---|---|---|
| `src/render/sun.ts` | 新增 | 太陽的方向、顏色、強度、角半徑、光暈參數的**唯一權威**。葉節點，不 import 任何 render 模組。 |
| `src/render/oceanShading.ts` | 新增 | 海面著色公式的 **CPU 版**（`waveNormal` / `fresnel` / `glintIntensity` / `glitterFade` / `slopeRoughness`）＋ 對應的 **GLSL 原始碼字串**。兩份放同一個檔，因為它們必須一起改。 |
| `src/render/sky.ts` | 修改 | 讀 `sun.ts` 畫太陽盤與光暈；匯出共用的漸層 GLSL 字串。 |
| `src/render/ocean.ts` | 修改 | 把 `oceanShading.ts` 的 GLSL 拼進兩個材質的片段著色器；關掉 `flatShading`。 |
| `src/render/scene.ts` | 修改 | `DirectionalLight` 改讀 `sun.ts`。 |
| `test/unit/sun.test.ts` | 新增 | 太陽常數本身，以及三個消費端真的用的是它。 |
| `test/unit/ocean-shading.test.ts` | 新增 | 五個 CPU 版公式的性質與邊界。 |
| `test/unit/fog.test.ts` | 修改 | 補「天空的太陽 uniform 來自 `sun.ts`」。 |
| `test/tools/glint-geometry.probe.ts` | 新增 | 掃描視角，印出反光帶落在哪、多寬。 |
| `test/e2e/battlefield-visuals.e2e.ts` | 修改 | 四個新的人工觀察點＋一次幀時取樣。 |

**為什麼 CPU 版與 GLSL 放同一個檔**：`ocean.ts` 已經有一個「`gerstnerHeight` 與頂點著色器必須一致」的縫，靠註解維持。這次的公式有五條，靠註解維持五個縫是行不通的。放同一個檔、上下相鄰、由測試釘住 —— 這是這個專案處理「兩份必須一致」的既有做法（見 `sky.ts` 的 `skyColorAt` 與 `FRAG`）。

---

### Task 1：`sun.ts` —— 太陽的唯一權威

**Files:**
- Create: `src/render/sun.ts`
- Create: `test/unit/sun.test.ts`
- Modify: `src/render/scene.ts:60-62`

**Interfaces:**
- Produces:
  - `SUN_DIRECTION: Vector3`（**已正規化**，由地表指向太陽）
  - `SUN_LIGHT_COLOR: number`、`SUN_LIGHT_INTENSITY: number`
  - `SUN_DISC_COLOR: number`
  - `SUN_ANGULAR_RADIUS: number`（弧度）
  - `SUN_DISC_SOFTNESS: number`（弧度）
  - `SUN_HALO_POWER: number`、`SUN_HALO_STRENGTH: number`
  - `sunElevationRad(): number`

- [ ] **Step 1: 寫會紅的測試**

建立 `test/unit/sun.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DirectionalLight, Vector3 } from 'three'
import {
  SUN_DIRECTION, SUN_LIGHT_COLOR, SUN_LIGHT_INTENSITY,
  SUN_ANGULAR_RADIUS, SUN_DISC_SOFTNESS, SUN_HALO_POWER, SUN_HALO_STRENGTH,
  sunElevationRad,
} from '../../src/render/sun'
import { createSunLight } from '../../src/render/sun'

describe('太陽常數', () => {
  it('方向是單位向量', () => {
    expect(SUN_DIRECTION.length()).toBeCloseTo(1, 12)
  })

  /**
   * 【為什麼要釘住仰角】海面反光的峰值落在「視線仰角 = 太陽仰角」，
   * 而 spec §2.2 的整個推導、以及 ocean-shading 那組測試的期望值，
   * 全部建立在 53° 這個數字上。太陽被搬動時那些測試必須跟著紅。
   */
  it('仰角是 53.0°（spec §2.2 的推導基礎）', () => {
    expect((sunElevationRad() * 180) / Math.PI).toBeCloseTo(53.0, 1)
  })

  it('太陽在地平線以上', () => {
    expect(SUN_DIRECTION.y).toBeGreaterThan(0)
  })

  it('角半徑是刻意誇大的：大於真實的 0.265°，小於 3°', () => {
    const deg = (SUN_ANGULAR_RADIUS * 180) / Math.PI
    expect(deg).toBeGreaterThan(0.265)
    expect(deg).toBeLessThan(3)
  })

  it('盤緣的柔化寬度為正，且小於角半徑', () => {
    expect(SUN_DISC_SOFTNESS).toBeGreaterThan(0)
    expect(SUN_DISC_SOFTNESS).toBeLessThan(SUN_ANGULAR_RADIUS)
  })

  it('光暈的指數夠高，不會把整片天空染亮', () => {
    // pow(cos θ, P) 在 θ = 30° 要掉到 1e-3 以下，否則那不是光暈是霞光
    expect(Math.pow(Math.cos(Math.PI / 6), SUN_HALO_POWER)).toBeLessThan(1e-3)
    expect(SUN_HALO_STRENGTH).toBeGreaterThan(0)
    expect(SUN_HALO_STRENGTH).toBeLessThanOrEqual(1)
  })
})

describe('createSunLight', () => {
  /**
   * 【這條守的是什麼】太陽的方向現在有三個消費端（燈光、天空盤、海面反光）。
   * 燈光若不是由 SUN_DIRECTION 建出來的，畫面上會出現「反光在這裡、陰影
   * 在那裡」，而沒有任何東西會紅。
   */
  it('燈的位置就是 SUN_DIRECTION，顏色與強度也來自常數', () => {
    const light: DirectionalLight = createSunLight()
    expect(light.position.x).toBeCloseTo(SUN_DIRECTION.x, 12)
    expect(light.position.y).toBeCloseTo(SUN_DIRECTION.y, 12)
    expect(light.position.z).toBeCloseTo(SUN_DIRECTION.z, 12)
    expect(light.color.getHex()).toBe(SUN_LIGHT_COLOR)
    expect(light.intensity).toBe(SUN_LIGHT_INTENSITY)
  })

  it('回傳的是新的燈，改它不會汙染 SUN_DIRECTION', () => {
    const before = SUN_DIRECTION.clone()
    createSunLight().position.set(9, 9, 9)
    expect(SUN_DIRECTION.equals(before)).toBe(true)
  })

  it('兩次呼叫回傳不同實體', () => {
    expect(createSunLight()).not.toBe(createSunLight())
  })
})

describe('SUN_DIRECTION 是唯讀的意圖', () => {
  it('不是原點', () => {
    expect(SUN_DIRECTION.equals(new Vector3())).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/sun.test.ts
```

預期：`Cannot find module '../../src/render/sun'`。

- [ ] **Step 3: 寫 `src/render/sun.ts`**

```ts
import { DirectionalLight, Vector3 } from 'three'

/**
 * 太陽的方向、顏色與外觀。**這個檔是唯一權威。**
 *
 * 【為什麼要獨立成一個模組】太陽同時被三個地方需要：`scene.ts` 的
 * `DirectionalLight`、`sky.ts` 的太陽盤、`ocean.ts` 的海面反光。三份各自
 * 寫死的話，改一份忘另外兩份，太陽的位置就會與它的反光、與它照出來的光
 * 分家 —— 而畫面上沒有任何東西會紅。
 *
 * 2026-08-10 剛修掉一個同類的縫：天空漸層的指數在 `FRAG` 字串裡與
 * `SKY_GRADIENT_POWER` 各存在一份。處置方式相同：一份常數、多處引用、
 * 測試釘住。
 *
 * 【它必須是葉節點】`sky.ts` 要 import 它，而 `fog.ts` 要 import `sky.ts`。
 * 這個檔若反過來 import 任何 render 模組就會成環。**不要在這裡 import
 * `scene.ts`、`sky.ts` 或 `ocean.ts`。**
 */

/**
 * 由地表**指向太陽**的單位向量，世界座標。
 *
 * 【數值沿用 2026-08-10 之前 `scene.ts` 裡的那一組】`(-0.4, 0.8, 0.45)`
 * 正規化後仰角 53.0°。整份 spec 的反光幾何推導（§2.2）與
 * `ocean-shading.test.ts` 的期望值都建立在這個角度上，所以它由
 * `sun.test.ts` 釘住 —— 搬動太陽時那些測試會跟著紅，那是刻意的。
 *
 * 【為什麼是「指向太陽」而不是「光線行進方向」】three 的
 * `DirectionalLight.position` 就是這個慣例（燈從 position 照向 target，
 * 而 target 預設在原點）。反光公式的 `L` 也是指向光源。統一成一個慣例，
 * 省掉每個消費端各自決定要不要取負號。
 */
export const SUN_DIRECTION: Vector3 = new Vector3(-0.4, 0.8, 0.45).normalize()

/** 太陽的仰角，弧度。由 `SUN_DIRECTION` 推導，不是另一個常數。 */
export function sunElevationRad(): number {
  return Math.asin(Math.min(Math.max(SUN_DIRECTION.y, -1), 1))
}

/** 平行光的顏色與強度。沿用 2026-08-10 之前 `scene.ts` 的值，未調整。 */
export const SUN_LIGHT_COLOR = 0xfff2e0
export const SUN_LIGHT_INTENSITY = 2.2

/** 天空上那顆盤子的顏色。比燈光更白 —— 直視光源本來就會過曝。 */
export const SUN_DISC_COLOR = 0xfffaf0

/**
 * 太陽盤的角半徑，弧度。**刻意誇大。**
 *
 * 真實的太陽是 0.265°，在 1080p / 65° FOV 下只有 8 px —— 看起來像壞點。
 * 取 1.0°（約 30 px）。這是遊戲的選擇，不是物理。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11。
 */
export const SUN_ANGULAR_RADIUS = (1.0 * Math.PI) / 180

/**
 * 盤緣柔化的寬度，弧度。硬邊在 30 px 的圓上會有明顯的鋸齒。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11。
 */
export const SUN_DISC_SOFTNESS = (0.25 * Math.PI) / 180

/**
 * 光暈 `pow(cos θ, P)` 的指數與強度。
 *
 * 【指數的下界由測試守住】30° 之外必須掉到 1e-3 以下，否則那不是光暈，
 * 是把半邊天空染亮。P = 64 時 `cos(30°)^64 = 8.6e-5`。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11。
 */
export const SUN_HALO_POWER = 64
export const SUN_HALO_STRENGTH = 0.5

/**
 * 造一盞代表太陽的平行光。
 *
 * 【為什麼是函數而不是共用一個實體】`DirectionalLight` 是可變的、而且會被
 * 加進 scene graph。匯出單一實體的話，第二次 `createScene`（測試裡就會
 * 發生）會把同一盞燈加進兩個場景。
 */
export function createSunLight(): DirectionalLight {
  const light = new DirectionalLight(SUN_LIGHT_COLOR, SUN_LIGHT_INTENSITY)
  light.position.copy(SUN_DIRECTION)
  return light
}
```

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/sun.test.ts
```

預期：全綠。

- [ ] **Step 5: 把 `scene.ts` 接上去**

把 `src/render/scene.ts` 第 60~62 行

```ts
  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  scene.add(sun)
```

改成

```ts
  // 【方向與顏色都來自 sun.ts】它同時是天空那顆盤子與海面反光的來源。
  // 寫死在這裡的話，改燈忘了改反光，畫面上不會有任何東西紅。
  scene.add(createSunLight())
```

並在檔頭 import 加上 `import { createSunLight } from './sun'`，同時從 three
的 import 清單移除 `DirectionalLight`（`noUnusedLocals` 會擋）。

- [ ] **Step 6: 型別檢查與既有測試**

```
npx tsc --noEmit
npx vitest run test/unit/
```

預期：`tsc` 無輸出；unit 全綠（1636 + 12 條新的）。

- [ ] **Step 7: 以 mutation 證明 Step 1 的測試是承重的**

把 `sun.ts` 的 `createSunLight` 暫時改成 `light.position.set(0, 1, 0)`，跑
`npx vitest run test/unit/sun.test.ts`，預期「燈的位置就是 SUN_DIRECTION」
那條紅。改回來，再確認綠。

- [ ] **Step 8: Commit**

```bash
git add src/render/sun.ts src/render/scene.ts test/unit/sun.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

message 內容（寫進 `$CLAUDE_JOB_DIR/tmp/msg.txt`，記得補兩行 trailer）：

```
feat: 太陽的方向與外觀抽成 sun.ts

太陽同時被 scene.ts 的 DirectionalLight、sky.ts 的太陽盤、ocean.ts 的海面
反光需要。三份寫死就會分家而沒有東西會紅 —— 與剛修掉的「漸層指數兩份」
同一類縫。

sun.ts 是葉節點，不 import 任何 render 模組（sky.ts → fog.ts 已經是一條
相依鏈，反過來會成環）。

行為零變動：方向、顏色、強度逐值沿用改動前 scene.ts 的那一組。
```

---

### Task 2：`oceanShading.ts` 的三條幾何公式（法線、坡度粗糙度、淡出）

**Files:**
- Create: `src/render/oceanShading.ts`
- Create: `test/unit/ocean-shading.test.ts`

**Interfaces:**
- Consumes: `WAVES`、`gerstnerHeight`（`src/render/ocean.ts`，**只讀不改**）
- Produces:
  - `MAX_WAVE_SLOPE: number`
  - `waveNormal(x: number, z: number, time: number, out: Vector3): Vector3`
  - `waveSlope(x: number, z: number, time: number): number`
  - `GLITTER_ROUGHNESS_MIN: number`、`GLITTER_ROUGHNESS_MAX: number`
  - `slopeRoughness(slope: number): number`
  - `GLITTER_FADE_START: number`、`GLITTER_FADE_END: number`
  - `glitterFade(distance: number): number`

- [ ] **Step 1: 寫會紅的測試**

建立 `test/unit/ocean-shading.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  MAX_WAVE_SLOPE, waveNormal, waveSlope,
  GLITTER_ROUGHNESS_MIN, GLITTER_ROUGHNESS_MAX, slopeRoughness,
  GLITTER_FADE_START, GLITTER_FADE_END, glitterFade,
} from '../../src/render/oceanShading'
import { gerstnerHeight, WAVES } from '../../src/render/ocean'

/**
 * 【這一組守的是「法線與高度不會分家」】法線是解析導數、高度是同一組波的
 * 取樣。兩者若用了不同的波參數、不同的相位慣例、或漏掉一項，畫面上會出現
 * 「光在這裡、浪在那裡」—— 而那種錯誤沒有任何既有測試看得到。
 *
 * 數值微分是唯一不倚賴「我抄對了導數」的檢查方式。
 */
describe('waveNormal 與 gerstnerHeight 來自同一組波', () => {
  const EPS = 0.01

  it('解析導數與數值微分一致（六個取樣點）', () => {
    const n = new Vector3()
    for (const [x, z, t] of [
      [0, 0, 0], [37.5, -12.25, 3.7], [-880, 640, 11.3],
      [1e4, 1e4, 0.5], [-5.5, 5.5, 60], [123.456, -789.012, 42],
    ] as const) {
      const dhdx = (gerstnerHeight(x + EPS, z, t) - gerstnerHeight(x - EPS, z, t)) / (2 * EPS)
      const dhdz = (gerstnerHeight(x, z + EPS, t) - gerstnerHeight(x, z - EPS, t)) / (2 * EPS)
      const expected = new Vector3(-dhdx, 1, -dhdz).normalize()
      waveNormal(x, z, t, n)
      expect(n.x).toBeCloseTo(expected.x, 5)
      expect(n.y).toBeCloseTo(expected.y, 5)
      expect(n.z).toBeCloseTo(expected.z, 5)
    }
  })

  it('回傳單位向量', () => {
    const n = new Vector3()
    expect(waveNormal(11, 22, 33, n).length()).toBeCloseTo(1, 12)
  })

  it('永遠朝上（水面不會翻過來）', () => {
    const n = new Vector3()
    for (let i = 0; i < 200; i++) {
      waveNormal(i * 7.3, i * -3.1, i * 0.21, n)
      expect(n.y).toBeGreaterThan(0)
    }
  })

  it('寫進呼叫端給的 out，不配置新的向量', () => {
    const out = new Vector3()
    expect(waveNormal(1, 2, 3, out)).toBe(out)
  })
})

describe('waveSlope', () => {
  it('等於水平梯度的長度', () => {
    const EPS = 0.01
    for (const [x, z, t] of [[0, 0, 0], [55, -66, 7]] as const) {
      const dhdx = (gerstnerHeight(x + EPS, z, t) - gerstnerHeight(x - EPS, z, t)) / (2 * EPS)
      const dhdz = (gerstnerHeight(x, z + EPS, t) - gerstnerHeight(x, z - EPS, t)) / (2 * EPS)
      expect(waveSlope(x, z, t)).toBeCloseTo(Math.hypot(dhdx, dhdz), 5)
    }
  })

  /**
   * 【MAX_WAVE_SLOPE 必須是推導值不是寫死的數字】它是 slopeRoughness 的
   * 分母。寫死的話，日後有人動 WAVES（本次禁止，但不是永遠禁止）粗糙度
   * 的對應關係就悄悄跑掉了。
   */
  it('MAX_WAVE_SLOPE 等於 Σ Aᵢ·kᵢ，且沒有取樣點超過它', () => {
    let sum = 0
    for (const w of WAVES) sum += (w.amplitude * Math.PI * 2) / w.wavelength
    expect(MAX_WAVE_SLOPE).toBeCloseTo(sum, 12)
    for (let i = 0; i < 500; i++) {
      expect(waveSlope(i * 13.7, i * -5.3, i * 0.37)).toBeLessThanOrEqual(MAX_WAVE_SLOPE + 1e-9)
    }
  })
})

describe('slopeRoughness', () => {
  it('平的水面最光滑、最陡的浪最粗', () => {
    expect(slopeRoughness(0)).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
    expect(slopeRoughness(MAX_WAVE_SLOPE)).toBeCloseTo(GLITTER_ROUGHNESS_MAX, 12)
  })

  it('單調遞增', () => {
    let prev = -1
    for (let s = 0; s <= MAX_WAVE_SLOPE; s += MAX_WAVE_SLOPE / 50) {
      const r = slopeRoughness(s)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })

  it('超出範圍時夾住，不外插', () => {
    expect(slopeRoughness(-5)).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
    expect(slopeRoughness(1e6)).toBeCloseTo(GLITTER_ROUGHNESS_MAX, 12)
  })

  /**
   * 【為什麼要有下界】roughness 為 0 時 GGX 的分母會變成 0/0。
   * 【為什麼要有上界】超過 0.5 就不再是水，是磨砂玻璃。
   */
  it('兩個端點都落在物理上合理的區間', () => {
    expect(GLITTER_ROUGHNESS_MIN).toBeGreaterThan(0.01)
    expect(GLITTER_ROUGHNESS_MIN).toBeLessThan(GLITTER_ROUGHNESS_MAX)
    expect(GLITTER_ROUGHNESS_MAX).toBeLessThan(0.5)
  })
})

describe('glitterFade', () => {
  it('近處全額、遠處歸零', () => {
    expect(glitterFade(0)).toBe(1)
    expect(glitterFade(GLITTER_FADE_START)).toBeCloseTo(1, 12)
    expect(glitterFade(GLITTER_FADE_END)).toBeCloseTo(0, 12)
    expect(glitterFade(1e9)).toBe(0)
  })

  it('單調遞減且落在 [0, 1]', () => {
    let prev = 2
    for (let d = 0; d <= GLITTER_FADE_END * 1.5; d += GLITTER_FADE_END / 100) {
      const f = glitterFade(d)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
      expect(f).toBeLessThanOrEqual(prev + 1e-12)
      prev = f
    }
  })

  /**
   * 【這條守的是「不會出現環」】5 km 是細浪面與遠海的接縫。淡出若在那裡
   * 有一個折點或不連續，接縫就會變成一條亮度環 —— 那正是 spec §2.3 要
   * 避免的失敗模式。
   */
  it('接縫（5 km）落在淡出開始之前，那裡兩側都是全額', () => {
    expect(GLITTER_FADE_START).toBeGreaterThan(5000)
    expect(glitterFade(4999)).toBe(1)
    expect(glitterFade(5001)).toBe(1)
  })

  it('淡出的區間是正的', () => {
    expect(GLITTER_FADE_END).toBeGreaterThan(GLITTER_FADE_START)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/ocean-shading.test.ts
```

預期：`Cannot find module '../../src/render/oceanShading'`。

- [ ] **Step 3: 寫 `src/render/oceanShading.ts` 的 CPU 部分**

```ts
import { Vector3 } from 'three'
import { WAVES } from './ocean'

/**
 * 海面著色公式。**CPU 版與 GLSL 版並存於同一個檔，因為它們必須一起改。**
 *
 * 【為什麼不寫在 ocean.ts 裡】那個檔已經有幾何（網格、遠海、renderOrder）
 * 與波參數兩份責任。再塞五條著色公式加它們的 GLSL 原始碼，會變成沒有人
 * 讀得完的檔案。這裡只管「一個點該是什麼顏色」。
 *
 * 【為什麼 CPU 版與 GLSL 版不分兩個檔】`ocean.ts` 已經示範過那個縫怎麼咬人
 * （`gerstnerHeight` 與頂點著色器靠一行註解維持一致）。這次有五條公式 ——
 * 五個縫靠註解是行不通的。放同一個檔、上下相鄰、由 `ocean-shading.test.ts`
 * 釘住 CPU 版的性質，而 GLSL 版就寫在它旁邊十行以內。
 *
 * 【GLSL 那一份測不到】這是誠實的限制，與 `sky.ts` 的 `FRAG` 完全相同。
 * 能守住的是「CPU 版是對的」與「uniform 餵的是同一組常數」，守不住
 * 「字串裡的算式抄對了」。
 */

/**
 * 三道波各自最大坡度的和，`Σ Aᵢ·kᵢ`。**推導值，不是寫死的數字。**
 *
 * 這是 `slopeRoughness` 的分母。寫死的話，日後有人動 `WAVES`，粗糙度的
 * 對應關係就悄悄跑掉 —— 沒有東西會紅。
 *
 * 現值 0.1767（`atan` 後 10.02°）。spec §2.2 的整個反光帶寬度推導建立在
 * 這個數字上。
 */
export const MAX_WAVE_SLOPE: number = WAVES.reduce(
  (sum, w) => sum + (w.amplitude * Math.PI * 2) / w.wavelength,
  0,
)

/**
 * 水面法線，由 `WAVES` 的**解析導數**算出來 —— 與網格取樣無關。
 *
 * ```
 * ∂h/∂x = Σ Aᵢ·kᵢ·dirXᵢ·cos(φᵢ)      φᵢ = kᵢ·(dirᵢ·xz) − spdᵢ·kᵢ·t
 * ∂h/∂z = Σ Aᵢ·kᵢ·dirZᵢ·cos(φᵢ)
 * n     = normalize(−∂h/∂x, 1, −∂h/∂z)
 * ```
 *
 * 【為什麼不用 flatShading 的面法線】那是每個 52 m 面的常數，反光會變成
 * 巨大的方塊。解析導數與網格密度無關，所以第三道波（31 m，網格每波長只有
 * 0.60 個取樣點、幾何上根本不存在）仍然在光照裡出現 —— 那正是遠處小浪
 * 真實的樣子：看不到起伏，只看得到反光的變化（spec §4.3）。
 *
 * 【代價】法線是「真波」的、高度是「混疊波」的，兩者在高頻上對不齊。31 m
 * 的波在 52 m 的面內走完 1.7 個週期，所以對不齊的尺度**小於一個面** ——
 * 看起來是面內的細碎明暗，不是錯位。這是刻意選的取捨。
 *
 * @param out 呼叫端給的暫存。熱路徑不得配置。
 */
export function waveNormal(x: number, z: number, time: number, out: Vector3): Vector3 {
  let dx = 0
  let dz = 0
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.wavelength
    const c = Math.cos(k * (w.dirX * x + w.dirZ * z) - w.speed * k * time)
    dx += w.amplitude * k * w.dirX * c
    dz += w.amplitude * k * w.dirZ * c
  }
  return out.set(-dx, 1, -dz).normalize()
}

/** 水平梯度的長度，0 ~ `MAX_WAVE_SLOPE`。`slopeRoughness` 的輸入。 */
export function waveSlope(x: number, z: number, time: number): number {
  let dx = 0
  let dz = 0
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.wavelength
    const c = Math.cos(k * (w.dirX * x + w.dirZ * z) - w.speed * k * time)
    dx += w.amplitude * k * w.dirX * c
    dz += w.amplitude * k * w.dirZ * c
  }
  return Math.hypot(dx, dz)
}

/**
 * 微觀粗糙度的兩端。**比 31 m 更細的浪不進法線，只進這裡。**
 *
 * 它決定 glitter 散得多開，不決定往哪個方向反 —— 那是統計量，不需要與幾何
 * 對齊，所以不需要更密的網格（spec §4.4）。
 *
 * 【為什麼不用貼圖、也不用程序噪音】這個專案沒有貼圖管線，加一張圖等於加
 * 一條資產路徑；程序噪音要一整個雜湊函數，那是可觀的片段成本，換來的隨機
 * 性在 52 m 的面上看不出比坡度好。坡度是**現成的**（導數已經算了），而且
 * 與波的相位綁在一起 —— 它會跟著浪一起動，噪音不會。
 *
 * 【下界不能是 0】GGX 的分母會變成 0/0。
 * 【上界不能超過 0.5】那就不是水，是磨砂玻璃。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11。
 */
export const GLITTER_ROUGHNESS_MIN = 0.04
export const GLITTER_ROUGHNESS_MAX = 0.20

/** 坡度 → 粗糙度的線性映射，兩端夾住。浪尖粗、波谷平。 */
export function slopeRoughness(slope: number): number {
  const t = Math.min(Math.max(slope / MAX_WAVE_SLOPE, 0), 1)
  return GLITTER_ROUGHNESS_MIN + (GLITTER_ROUGHNESS_MAX - GLITTER_ROUGHNESS_MIN) * t
}

/**
 * 反光淡出的起訖水平距離，m。
 *
 * 【為什麼要淡出】兩個理由，一個工程一個物理：
 *
 *   1. 遠海延伸到 3,000 km。`sin(k·x)` 在 x ~ 10⁶、k ~ 0.2 時相位是 10⁵
 *      量級，`highp float` 的 24 bit 尾數只剩約 0.006 rad 解析度 —— 還可用，
 *      但已接近極限，再遠就會出現規則的條紋。
 *   2. 夠遠時一個像素涵蓋許多個波，glitter 本來就該平均掉、只剩鏡面。
 *
 * 【起點必須大於 5,000】那是細浪面與遠海的接縫。淡出若在接縫上有折點，
 * 接縫就變成一條亮度環 —— 正是 spec §2.3 要避免的失敗模式。由測試守住。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11。
 */
export const GLITTER_FADE_START = 8_000
export const GLITTER_FADE_END = 40_000

/** 1 → 0 的線性淡出，兩端夾住。連續，所以不會有環。 */
export function glitterFade(distance: number): number {
  if (distance <= GLITTER_FADE_START) return 1
  if (distance >= GLITTER_FADE_END) return 0
  return 1 - (distance - GLITTER_FADE_START) / (GLITTER_FADE_END - GLITTER_FADE_START)
}
```

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/ocean-shading.test.ts
npx tsc --noEmit
```

預期：全綠、`tsc` 無輸出。

- [ ] **Step 5: 以 mutation 證明數值微分那條是承重的**

把 `waveNormal` 的 `out.set(-dx, 1, -dz)` 暫時改成 `out.set(dx, 1, dz)`
（符號錯 —— 這是抄導數時最常犯的錯），跑
`npx vitest run test/unit/ocean-shading.test.ts`，預期「解析導數與數值微分
一致」那條紅。改回來，再確認綠。

再做第二個 mutation：把 `MAX_WAVE_SLOPE` 改成寫死的 `0.1767`，預期
「等於 Σ Aᵢ·kᵢ」那條**仍然綠**（`toBeCloseTo(sum, 12)` 會紅，因為 0.1767
與精確值差在小數第五位）—— 若它沒紅，代表那條的精度不夠，要提高到 12 位
再確認。改回來。

- [ ] **Step 6: Commit**

```bash
git add src/render/oceanShading.ts test/unit/ocean-shading.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

message：

```
feat: 海面著色的三條幾何公式（CPU 版）

waveNormal 由 WAVES 的解析導數算法線，與網格取樣無關 —— 所以第三道波
（31 m，網格每波長只有 0.60 個取樣點、幾何上根本不存在）仍然在光照裡
出現。那正是遠處小浪真實的樣子：看不到起伏，只看得到反光的變化。

slopeRoughness 把「比 31 m 更細的浪」變成統計性的粗糙度：浪尖粗、波谷平。
不用貼圖也不用程序噪音 —— 坡度是導數的副產品，免費，而且會跟著浪動。

glitterFade 的起點必須大於 5,000 m（細浪面與遠海的接縫），否則接縫會變成
一條亮度環。由測試守住。

法線與高度不分家這件事由「解析導數 vs gerstnerHeight 的數值微分」六個
取樣點釘住 —— 那是唯一不倚賴「我抄對了導數」的檢查方式。符號寫反會紅。

WAVES / gerstnerHeight 一個字沒動。
```

---

### Task 3：Fresnel 與 glint 的 CPU 版

**Files:**
- Modify: `src/render/oceanShading.ts`（append）
- Modify: `test/unit/ocean-shading.test.ts`（append）

**Interfaces:**
- Consumes: Task 1 的 `SUN_DIRECTION`、`sunElevationRad`；Task 2 的 `slopeRoughness`
- Produces:
  - `WATER_F0: number`
  - `fresnel(nDotV: number): number`
  - `glintIntensity(n: Vector3, v: Vector3, l: Vector3, roughness: number): number`

- [ ] **Step 1: 寫會紅的測試（append 到 `ocean-shading.test.ts`）**

```ts
import { SUN_DIRECTION, sunElevationRad } from '../../src/render/sun'
import { WATER_F0, fresnel, glintIntensity } from '../../src/render/oceanShading'

describe('fresnel', () => {
  it('正對水面時是 F0（水 = 0.02）', () => {
    expect(fresnel(1)).toBeCloseTo(WATER_F0, 12)
    expect(WATER_F0).toBeCloseTo(0.02, 3)
  })

  it('掠角時趨近全反射', () => {
    expect(fresnel(0)).toBeCloseTo(1, 12)
  })

  it('隨 n·v 單調遞減', () => {
    let prev = 2
    for (let c = 0; c <= 1; c += 0.02) {
      const f = fresnel(c)
      expect(f).toBeLessThanOrEqual(prev + 1e-12)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
      prev = f
    }
  })

  it('負的 n·v（從水面下看）夾成 1，不外插成負數', () => {
    expect(fresnel(-0.5)).toBeCloseTo(1, 12)
  })
})

/**
 * 【這一組就是「一定角度會反光」這句需求本身】
 *
 * 專案負責人的原話：「一定角度會太陽反光。」那句話有兩個內容 ——
 * **在對的角度會亮**，而且**在別的角度不會亮**。兩個都要斷言，只測前者
 * 的話「整片海一直在閃」也會通過。
 */
describe('glintIntensity', () => {
  const RAD = Math.PI / 180
  const L = SUN_DIRECTION.clone()

  /** 平靜水面（法線 +Y）在給定仰角、給定方位往下看時，指向眼睛的單位向量 */
  const viewFrom = (elevationDeg: number, azimuthRad: number): Vector3 =>
    new Vector3(
      Math.cos(elevationDeg * RAD) * Math.sin(azimuthRad),
      Math.sin(elevationDeg * RAD),
      Math.cos(elevationDeg * RAD) * Math.cos(azimuthRad),
    ).normalize()

  /** 太陽的方位角，從 +Z 往 +X 量 */
  const sunAzimuth = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z)
  const N = new Vector3(0, 1, 0)
  const R = 0.05

  it('峰值落在「視線仰角 = 太陽仰角、同方位」', () => {
    const sunElevDeg = (sunElevationRad() * 180) / Math.PI
    const peak = glintIntensity(N, viewFrom(sunElevDeg, sunAzimuth), L, R)
    for (const d of [-40, -25, -10, 10, 25, 40]) {
      const off = glintIntensity(N, viewFrom(sunElevDeg + d, sunAzimuth), L, R)
      expect(off).toBeLessThan(peak)
    }
  })

  it('仰角偏離 25° 時掉到峰值的十分之一以下 —— 反光是帶，不是整片海', () => {
    const e = (sunElevationRad() * 180) / Math.PI
    const peak = glintIntensity(N, viewFrom(e, sunAzimuth), L, R)
    expect(glintIntensity(N, viewFrom(e + 25, sunAzimuth), L, R)).toBeLessThan(peak / 10)
    expect(glintIntensity(N, viewFrom(e - 25, sunAzimuth), L, R)).toBeLessThan(peak / 10)
  })

  it('背對太陽（方位差 180°）幾乎沒有反光', () => {
    const e = (sunElevationRad() * 180) / Math.PI
    const peak = glintIntensity(N, viewFrom(e, sunAzimuth), L, R)
    const back = glintIntensity(N, viewFrom(e, sunAzimuth + Math.PI), L, R)
    expect(back).toBeLessThan(peak / 100)
  })

  it('太陽在水面下時為 0 —— 海不會從底下發光', () => {
    const below = new Vector3(0.3, -0.9, 0.3).normalize()
    expect(glintIntensity(N, viewFrom(45, 0), below, R)).toBe(0)
  })

  it('視線在水面下時為 0', () => {
    expect(glintIntensity(N, new Vector3(0, -1, 0), L, R)).toBe(0)
  })

  it('永遠非負且有限', () => {
    for (let e = 1; e <= 89; e += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const g = glintIntensity(N, viewFrom(e, a), L, R)
        expect(Number.isFinite(g)).toBe(true)
        expect(g).toBeGreaterThanOrEqual(0)
      }
    }
  })

  /**
   * 【粗糙度的作用要測得到】它是 spec §4.4 唯一的產出。越粗 → 峰值越低、
   * 帶越寬。只測「有輸出」的話，把 roughness 完全忽略掉也會通過。
   */
  it('越粗糙峰值越低、反光帶越寬', () => {
    const e = (sunElevationRad() * 180) / Math.PI
    const sharpPeak = glintIntensity(N, viewFrom(e, sunAzimuth), L, 0.03)
    const roughPeak = glintIntensity(N, viewFrom(e, sunAzimuth), L, 0.30)
    expect(roughPeak).toBeLessThan(sharpPeak)

    const sharpOff = glintIntensity(N, viewFrom(e + 15, sunAzimuth), L, 0.03)
    const roughOff = glintIntensity(N, viewFrom(e + 15, sunAzimuth), L, 0.30)
    // 相對於各自的峰值，粗的那一組在偏離處保留得更多 = 帶更寬
    expect(roughOff / roughPeak).toBeGreaterThan(sharpOff / sharpPeak)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/ocean-shading.test.ts
```

預期：`WATER_F0`、`fresnel`、`glintIntensity` 未匯出而失敗。

- [ ] **Step 3: 實作（append 到 `src/render/oceanShading.ts`）**

```ts
/**
 * 水的垂直入射反射率。`((1.33 − 1) / (1.33 + 1))² = 0.0204`。
 *
 * 【它為什麼這麼小】正對著水面往下看，幾乎看不到反射 —— 你看到的是水底
 * 的顏色。反射只在掠角才主導，那正是 Fresnel 這條的內容。
 */
export const WATER_F0 = 0.0204

/**
 * Schlick 近似。`F = F0 + (1 − F0)·(1 − n·v)^5`。
 *
 * 【它單獨就會讓地平線附近的海變亮】而那是真實海面的樣子，不是缺陷。
 *
 * 【與「海面近到遠幾乎沒有顏色變化」不衝突】既有那條要求針對的是**霧**
 * 造成的近遠色差（已由 `ocean.ts` 的 `fog: false` 解掉）。Fresnel 造成的
 * 是**視角**相依的變化 —— 同一片海低頭看與平視看不一樣。`fog.test.ts`
 * 釘的是 base color，不受影響（spec §4.5）。
 */
export function fresnel(nDotV: number): number {
  const c = Math.min(Math.max(1 - nDotV, 0), 1)
  const c2 = c * c
  return WATER_F0 + (1 - WATER_F0) * c2 * c2 * c
}

/**
 * 太陽在水面上的鏡面反光強度。GGX(Trowbridge–Reitz) 的法線分布項。
 *
 * ```
 * h = normalize(v + l)
 * a = roughness²
 * D = a² / (π · ((n·h)²·(a² − 1) + 1)²)
 * ```
 *
 * 【為什麼只取 D 不取完整的 BRDF】幾何遮蔽項與 Fresnel 在這裡是分開處理的
 * （Fresnel 見上面那個函數），而 D 就是「反光帶落在哪、多寬」的全部內容。
 * 這是這份需求要的東西 —— 完整的 BRDF 會把亮度綁進去，而亮度是可調的。
 *
 * 【峰值在哪】`n·h = 1` 時最大，也就是半向量與法線同向。平靜水面（n = +Y）
 * 上那等於「視線仰角 = 太陽仰角、同方位」—— **這就是「一定角度會反光」**。
 *
 * 【為什麼要擋兩個負值】`n·l ≤ 0` 是太陽在水面下（海不會從底下發光），
 * `n·v ≤ 0` 是從水面下往上看。兩者都不是這個世界會發生的事，但著色器會
 * 對每個像素求值，而 `pow` 對負數的行為是未定義的。
 *
 * @param n 水面法線，單位向量
 * @param v 由水面**指向眼睛**的單位向量
 * @param l 由水面**指向太陽**的單位向量（`SUN_DIRECTION` 的慣例）
 */
export function glintIntensity(n: Vector3, v: Vector3, l: Vector3, roughness: number): number {
  const nDotL = n.dot(l)
  const nDotV = n.dot(v)
  if (nDotL <= 0 || nDotV <= 0) return 0

  const hx = v.x + l.x
  const hy = v.y + l.y
  const hz = v.z + l.z
  const hLen = Math.hypot(hx, hy, hz)
  if (hLen <= 1e-12) return 0
  const nDotH = (n.x * hx + n.y * hy + n.z * hz) / hLen

  const a = roughness * roughness
  const a2 = a * a
  const d = nDotH * nDotH * (a2 - 1) + 1
  return a2 / (Math.PI * d * d)
}
```

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/ocean-shading.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: 以 mutation 證明「反光是帶」那條是承重的**

把 `glintIntensity` 暫時改成 `return Math.max(0, nDotL)`（等於「只要太陽在
上面就一直亮」），跑測試。預期至少「偏離 25° 掉到十分之一」與「背對太陽」
兩條紅。改回來，再確認綠。

- [ ] **Step 6: 寫量測探針**

建立 `test/tools/glint-geometry.probe.ts`：

```ts
/**
 * 反光帶落在哪個視角、多寬。**不是測試**（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/glint-geometry.probe.ts`
 *
 * 【要回答什麼】「一定角度會反光」是需求，但「那個角度是不是玩家實際會用
 * 的視角」是另一回事。座艙裡多半是平視到俯角 20° 之間；上帝視角才會俯視
 * 50° 以上。這支把強度分布印出來，好讓人工驗收有數字可談。
 */
import { Vector3 } from 'three'
import { SUN_DIRECTION, sunElevationRad } from '../../src/render/sun'
import {
  GLITTER_ROUGHNESS_MIN, GLITTER_ROUGHNESS_MAX, MAX_WAVE_SLOPE,
  glintIntensity, waveNormal, waveSlope, slopeRoughness,
} from '../../src/render/oceanShading'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const sunAz = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z)
const sunElev = sunElevationRad() * DEG

console.log(`太陽仰角 ${sunElev.toFixed(1)}°、方位 ${(sunAz * DEG).toFixed(1)}°`)
console.log(`坡度上限 ${MAX_WAVE_SLOPE.toFixed(4)}（${(Math.atan(MAX_WAVE_SLOPE) * DEG).toFixed(2)}°）`)
console.log(`粗糙度 ${GLITTER_ROUGHNESS_MIN} ~ ${GLITTER_ROUGHNESS_MAX}`)

const view = (elevDeg: number, az: number): Vector3 => new Vector3(
  Math.cos(elevDeg * RAD) * Math.sin(az),
  Math.sin(elevDeg * RAD),
  Math.cos(elevDeg * RAD) * Math.cos(az),
).normalize()

/**
 * 【為什麼要對真實的水面取樣而不是只用平靜水面】平靜水面（n = +Y）的
 * 反光帶是幾何上界；真實水面的 ±10° 坡度會把帶撐開。玩家看到的是後者。
 */
const FLAT = new Vector3(0, 1, 0)
const n = new Vector3()
function meanOverSurface(elevDeg: number, az: number): number {
  const v = view(elevDeg, az)
  let sum = 0
  let peak = 0
  const N = 400
  for (let i = 0; i < N; i++) {
    const x = i * 17.3
    const z = i * -11.7
    waveNormal(x, z, 0, n)
    const g = glintIntensity(n, v, SUN_DIRECTION, slopeRoughness(waveSlope(x, z, 0)))
    sum += g
    if (g > peak) peak = g
  }
  return sum / N
}

console.log('\n=== 平靜水面（幾何上界）：朝太陽方位，強度 vs 視線仰角 ===')
console.log('仰角    強度      相對峰值')
const flatPeak = glintIntensity(FLAT, view(sunElev, sunAz), SUN_DIRECTION, GLITTER_ROUGHNESS_MIN)
for (let e = 5; e <= 85; e += 5) {
  const g = glintIntensity(FLAT, view(e, sunAz), SUN_DIRECTION, GLITTER_ROUGHNESS_MIN)
  console.log(`${String(e).padStart(3)}°  ${g.toExponential(2).padStart(10)}`
    + `  ${(100 * g / flatPeak).toFixed(2).padStart(8)}%`)
}

console.log('\n=== 真實水面（400 個取樣點的平均）：朝太陽方位 ===')
console.log('仰角    平均強度')
for (let e = 5; e <= 85; e += 5) {
  console.log(`${String(e).padStart(3)}°  ${meanOverSurface(e, sunAz).toExponential(2).padStart(12)}`)
}

console.log('\n=== 方位掃描（仰角固定在太陽仰角）===')
console.log('方位差   平均強度')
for (let d = 0; d <= 180; d += 15) {
  console.log(`${String(d).padStart(4)}°  ${meanOverSurface(sunElev, sunAz + d * RAD).toExponential(2).padStart(12)}`)
}
```

跑它：

```
npx vite-node test/tools/glint-geometry.probe.ts
```

**把輸出貼進報告** —— 這是專案負責人回填 §11 那五個參數的依據。

- [ ] **Step 7: Commit**

```bash
git add src/render/oceanShading.ts test/unit/ocean-shading.test.ts test/tools/glint-geometry.probe.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

message：

```
feat: Fresnel 與 GGX 反光的 CPU 版，加一支反光帶的量測探針

「一定角度會反光」這句需求被拆成兩個可斷言的東西：在對的角度會亮，而且
在別的角度不會亮。只測前者的話「整片海一直在閃」也會通過。

峰值落在「視線仰角 = 太陽仰角、同方位」（GGX 的 n·h = 1）；偏離 25° 掉到
十分之一以下；背對太陽掉到百分之一以下。太陽或視線在水面下時回 0 —— 那
兩個分支是給著色器的，它會對每個像素求值而 pow 對負數未定義。

只取 GGX 的 D 項不取完整 BRDF：D 就是「反光帶落在哪、多寬」的全部內容，
而完整 BRDF 會把亮度綁進去，亮度是可調的。

glint-geometry.probe.ts 掃視線仰角與方位，平靜水面（幾何上界）與真實水面
（400 取樣點）各一組 —— 那是回填五個參數的依據。
```

---

### Task 4：GLSL 原始碼與 `sky.ts` 的太陽盤

**Files:**
- Modify: `src/render/oceanShading.ts`（append GLSL 字串）
- Modify: `src/render/sky.ts`
- Modify: `test/unit/fog.test.ts`

**Interfaces:**
- Consumes: Task 1、Task 2、Task 3 的全部常數
- Produces:
  - `SKY_GRADIENT_GLSL: string`（`sky.ts` 匯出）
  - `OCEAN_SHADING_GLSL: string`（`oceanShading.ts` 匯出）

- [ ] **Step 1: 把天空漸層的 GLSL 抽成可共用的字串**

在 `src/render/sky.ts`，把現有 `FRAG` 裡那兩行抽出來：

```ts
/**
 * 天空漸層的 GLSL 函數原始碼。**天空球與海面的 Fresnel 共用這一份。**
 *
 * 【為什麼要抽出來】海面平視時反射的是天空，所以它需要「往這個方向看出去
 * 的天空是什麼顏色」。不抽的話這條公式會有三份（`skyColorAt` 的 JS、天空
 * 球的 FRAG、海面的 FRAG），而 2026-08-10 才剛因為「指數有兩份」修過一次。
 *
 * 【JS 那一份為什麼不能一起消掉】霧色（`fog.ts` 的 `FOG_COLOR`）在 CPU 上
 * 就要算出來，而且它是 `FogExp2` 的建構參數。兩份仍然必須一致，由
 * `fog.test.ts` 的「霧色就是地平線上的天空色」釘住。
 *
 * 【呼叫端要自己宣告 uniform】`skyHorizon`、`skyZenith`、`skyPower`。
 */
export const SKY_GRADIENT_GLSL = /* glsl */ `
  uniform vec3 skyHorizon;
  uniform vec3 skyZenith;
  uniform float skyPower;
  vec3 skyGradient(vec3 dir) {
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    return mix(skyHorizon, skyZenith, pow(t, skyPower));
  }
`
```

天空球自己的 `FRAG` 改成：

```ts
const FRAG = /* glsl */ `
  ${SKY_GRADIENT_GLSL}
  uniform vec3 sunDirection;
  uniform vec3 sunDiscColor;
  uniform float sunCosOuter;
  uniform float sunCosInner;
  uniform float sunHaloPower;
  uniform float sunHaloStrength;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    vec3 base = skyGradient(dir);
    // 【為什麼用 cos 的門檻而不是 acos】acos 在接近 1 的地方數值很差，而
    // 太陽盤正好就在那裡。比較 cos 是單調且精確的。
    float c = dot(dir, sunDirection);
    float disc = smoothstep(sunCosOuter, sunCosInner, c);
    float halo = pow(max(c, 0.0), sunHaloPower) * sunHaloStrength;
    gl_FragColor = vec4(base + sunDiscColor * (disc + halo), 1.0);
  }
`
```

`createSky` 的 uniforms 改名並補上太陽那六個（`horizon` → `skyHorizon` 等，
因為共用的 GLSL 用的是新名字）：

```ts
    uniforms: {
      skyHorizon: { value: new Color(SKY_HORIZON) },
      skyZenith: { value: new Color(SKY_ZENITH) },
      skyPower: { value: SKY_GRADIENT_POWER },
      sunDirection: { value: SUN_DIRECTION.clone() },
      sunDiscColor: { value: new Color(SUN_DISC_COLOR) },
      // 【外圈比內圈大一個柔化寬度】smoothstep(outer, inner, c) 在
      // c 由 outer 升到 inner 的區間由 0 平滑升到 1，而 cos 是遞減的，
      // 所以「外」對應較小的 cos
      sunCosOuter: { value: Math.cos(SUN_ANGULAR_RADIUS + SUN_DISC_SOFTNESS) },
      sunCosInner: { value: Math.cos(SUN_ANGULAR_RADIUS) },
      sunHaloPower: { value: SUN_HALO_POWER },
      sunHaloStrength: { value: SUN_HALO_STRENGTH },
    },
```

檔頭補 `import { SUN_ANGULAR_RADIUS, SUN_DISC_COLOR, SUN_DISC_SOFTNESS, SUN_DIRECTION, SUN_HALO_POWER, SUN_HALO_STRENGTH } from './sun'`。

- [ ] **Step 2: 改 `fog.test.ts` 既有那條 uniform 測試並補新的**

既有的「天空球的 uniform 用的是同三個常數」要改用新名字，並補太陽那一組：

```ts
  it('天空球的 uniform 用的是同三個常數', () => {
    const sky = createSky()
    const mat = sky.material as ShaderMaterial
    expect((mat.uniforms.skyHorizon!.value as Color).getHex()).toBe(SKY_HORIZON)
    expect((mat.uniforms.skyZenith!.value as Color).getHex()).toBe(SKY_ZENITH)
    expect(mat.uniforms.skyPower!.value).toBe(SKY_GRADIENT_POWER)
  })

  /**
   * 【天上的太陽與海上的反光不得分家】天空盤的方向若不是 sun.ts 的那一個，
   * 玩家會看到反光在一邊、太陽在另一邊，而沒有東西會紅。
   */
  it('天空的太陽 uniform 全部來自 sun.ts', () => {
    const mat = createSky().material as ShaderMaterial
    const dir = mat.uniforms.sunDirection!.value as Vector3
    expect(dir.x).toBeCloseTo(SUN_DIRECTION.x, 12)
    expect(dir.y).toBeCloseTo(SUN_DIRECTION.y, 12)
    expect(dir.z).toBeCloseTo(SUN_DIRECTION.z, 12)
    expect((mat.uniforms.sunDiscColor!.value as Color).getHex()).toBe(SUN_DISC_COLOR)
    expect(mat.uniforms.sunCosInner!.value).toBeCloseTo(Math.cos(SUN_ANGULAR_RADIUS), 12)
    expect(mat.uniforms.sunCosOuter!.value)
      .toBeCloseTo(Math.cos(SUN_ANGULAR_RADIUS + SUN_DISC_SOFTNESS), 12)
    expect(mat.uniforms.sunHaloPower!.value).toBe(SUN_HALO_POWER)
    expect(mat.uniforms.sunHaloStrength!.value).toBe(SUN_HALO_STRENGTH)
  })

  /**
   * 【uniform 拿的是複本】天空球被加進 scene 之後，three 可能在別處寫它。
   * 若拿的是 SUN_DIRECTION 本身，海面與燈光會跟著被改掉。
   */
  it('天空的太陽方向是複本，不是 SUN_DIRECTION 本身', () => {
    const mat = createSky().material as ShaderMaterial
    expect(mat.uniforms.sunDirection!.value).not.toBe(SUN_DIRECTION)
  })

  /**
   * 【太陽盤不得寫深度】否則飛機飛過太陽前面時會被它蓋掉。
   * 天空球本來就 depthWrite: false，這條是防止有人日後為了「太陽要在雲後
   * 面」之類的理由把它打開。
   */
  it('天空球仍然不寫深度', () => {
    const mat = createSky().material as ShaderMaterial
    expect(mat.depthWrite).toBe(false)
  })
```

檔頭 import 補 `Vector3`（從 three）與 `SUN_ANGULAR_RADIUS, SUN_DIRECTION, SUN_DISC_COLOR, SUN_DISC_SOFTNESS, SUN_HALO_POWER, SUN_HALO_STRENGTH`（從 `sun`）。

- [ ] **Step 3: 跑測試**

```
npx vitest run test/unit/fog.test.ts
npx tsc --noEmit
```

預期：全綠。若「天空球的 uniform」那條因為改名而紅，那是預期中的 —— Step 2
已經把它改成新名字了。

- [ ] **Step 4: 寫海面的 GLSL（append 到 `oceanShading.ts`）**

```ts
/**
 * 海面著色的 GLSL。**與上面那幾個 CPU 函數是同一組公式的兩份實作。**
 *
 * 【這一份測不到】與 `sky.ts` 的 `FRAG` 完全相同的限制：它是字串。測得到
 * 的是「CPU 版是對的」（`ocean-shading.test.ts`）與「uniform 餵的是同一組
 * 常數」（`ocean.test.ts`）。守得住兩件也比零好。
 *
 * 【改這裡就要改上面】逐條對應：
 *   waveNormalGLSL   ↔ waveNormal
 *   waveSlopeGLSL    ↔ waveSlope（順帶回傳，避免算兩次 cos）
 *   slopeRoughness   ↔ slopeRoughness
 *   fresnelGLSL      ↔ fresnel
 *   glintGLSL        ↔ glintIntensity
 *   glitterFadeGLSL  ↔ glitterFade
 *
 * 【呼叫端要自己宣告的 uniform】`uTime`、`uWaveDir/Amp/Len/Spd`（`ocean.ts`
 * 已經有了）、`uSunDirection`、`uMaxSlope`、`uRoughMin`、`uRoughMax`、
 * `uFadeStart`、`uFadeEnd`、`uGlintStrength`。
 */
export const OCEAN_SHADING_GLSL = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uMaxSlope;
  uniform float uRoughMin;
  uniform float uRoughMax;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uGlintStrength;

  // 一次算完梯度，法線與坡度共用 —— cos 不算兩次
  vec2 waveGradient(vec2 worldXZ, float t) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < WAVE_COUNT; i++) {
      float k = 6.28318530718 / uWaveLen[i];
      float c = cos(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * t);
      g += uWaveAmp[i] * k * uWaveDir[i] * c;
    }
    return g;
  }

  vec3 waveNormalGLSL(vec2 g) {
    return normalize(vec3(-g.x, 1.0, -g.y));
  }

  float slopeRoughnessGLSL(float slope) {
    return mix(uRoughMin, uRoughMax, clamp(slope / uMaxSlope, 0.0, 1.0));
  }

  float fresnelGLSL(float nDotV) {
    float c = clamp(1.0 - nDotV, 0.0, 1.0);
    float c2 = c * c;
    return 0.0204 + (1.0 - 0.0204) * c2 * c2 * c;
  }

  float glintGLSL(vec3 n, vec3 v, vec3 l, float roughness) {
    float nDotL = dot(n, l);
    float nDotV = dot(n, v);
    if (nDotL <= 0.0 || nDotV <= 0.0) return 0.0;
    vec3 h = v + l;
    float hLen = length(h);
    if (hLen <= 1e-6) return 0.0;
    float nDotH = dot(n, h) / hLen;
    float a = roughness * roughness;
    float a2 = a * a;
    float d = nDotH * nDotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265359 * d * d);
  }

  float glitterFadeGLSL(float distance) {
    return 1.0 - smoothstep(uFadeStart, uFadeEnd, distance);
  }
`
```

**注意**：GLSL 的 `glitterFadeGLSL` 用 `smoothstep`，CPU 版用線性。這是刻意
的差異嗎？**不是** —— 兩份必須一致。把 CPU 版改成同樣的 smoothstep：

```ts
/** 1 → 0 的平滑淡出，兩端夾住。與 GLSL 的 `smoothstep` 逐值相同。 */
export function glitterFade(distance: number): number {
  if (distance <= GLITTER_FADE_START) return 1
  if (distance >= GLITTER_FADE_END) return 0
  const t = (distance - GLITTER_FADE_START) / (GLITTER_FADE_END - GLITTER_FADE_START)
  return 1 - t * t * (3 - 2 * t)
}
```

Task 2 寫的 `glitterFade` 測試（單調、值域、端點、接縫）**全部仍然成立** ——
它們沒有斷言線性。跑一次確認。

- [ ] **Step 5: 跑測試確認 Task 2 的那組沒被改壞**

```
npx vitest run test/unit/ocean-shading.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/render/sky.ts src/render/oceanShading.ts test/unit/fog.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

message：

```
feat: 天空長出太陽盤，海面著色的 GLSL 就位

天空漸層的 GLSL 抽成 SKY_GRADIENT_GLSL，天空球與海面的 Fresnel 共用一份
—— 不抽的話這條公式會有三份，而 2026-08-10 才剛因為「指數有兩份」修過。

太陽盤用 cos 的門檻而不是 acos：acos 在接近 1 的地方數值很差，而太陽盤
正好就在那裡。角半徑 1.0° 是刻意誇大的（真實 0.265° 在 1080p 只有 8 px，
看起來像壞點）。

太陽的六個 uniform 由 fog.test.ts 釘住來自 sun.ts，並補一條「拿的是複本」
—— 拿本體的話 three 在別處寫它會連帶改掉燈光與海面反光。

glitterFade 的 CPU 版改成 smoothstep 與 GLSL 對齊。Task 2 那組測試沒有
斷言線性，所以全部仍然成立。
```

---

### Task 5：把著色接進 `ocean.ts` 的兩個材質

**Files:**
- Modify: `src/render/ocean.ts`
- Create: `test/unit/ocean.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `OCEAN_SHADING_GLSL`、`SKY_GRADIENT_GLSL`；Task 1~3 的全部常數
- Produces: 無新的公開介面（`createOcean` 的簽名不變）

- [ ] **Step 1: 寫會紅的測試**

建立 `test/unit/ocean.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Color, MeshStandardMaterial, Vector3 } from 'three'
import { createOcean, SEA_COLOR } from '../../src/render/ocean'
import {
  GLITTER_FADE_END, GLITTER_FADE_START,
  GLITTER_ROUGHNESS_MAX, GLITTER_ROUGHNESS_MIN, MAX_WAVE_SLOPE,
} from '../../src/render/oceanShading'
import { SUN_DIRECTION } from '../../src/render/sun'
import { SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH } from '../../src/render/sky'

/**
 * 【這一組守的是 5 km 那條接縫】細浪面與遠海是兩個材質、兩份 uniform。
 * 任何一個值漂開，5 km 處就會出現一條色帶或亮度環 —— `ocean.ts` 自己的
 * 註解已經為 `fog` 旗標記過同一個失敗模式，而 glitter 多了九個值。
 *
 * 【為什麼逐值比對而不是比對物件】兩個材質各自 `onBeforeCompile`，uniform
 * 是各自建的物件。比對參考會永遠失敗；比對值才是需求。
 */
describe('細浪面與遠海的 glitter uniform 逐值相同', () => {
  const NUMERIC = [
    'uMaxSlope', 'uRoughMin', 'uRoughMax', 'uFadeStart', 'uFadeEnd',
    'uGlintStrength', 'skyPower',
  ] as const

  it('數值 uniform 兩邊一致，且等於常數', () => {
    const ocean = createOcean()
    try {
      const near = ocean.uniformsFor('near')
      const far = ocean.uniformsFor('far')
      for (const k of NUMERIC) {
        expect(near[k]).toBeCloseTo(far[k]!, 12)
      }
      expect(near.uMaxSlope).toBeCloseTo(MAX_WAVE_SLOPE, 12)
      expect(near.uRoughMin).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
      expect(near.uRoughMax).toBeCloseTo(GLITTER_ROUGHNESS_MAX, 12)
      expect(near.uFadeStart).toBeCloseTo(GLITTER_FADE_START, 12)
      expect(near.uFadeEnd).toBeCloseTo(GLITTER_FADE_END, 12)
      expect(near.skyPower).toBeCloseTo(SKY_GRADIENT_POWER, 12)
    } finally {
      ocean.dispose()
    }
  })

  it('太陽方向兩邊一致，且等於 SUN_DIRECTION', () => {
    const ocean = createOcean()
    try {
      for (const which of ['near', 'far'] as const) {
        const d = ocean.sunDirectionFor(which)
        expect(d.x).toBeCloseTo(SUN_DIRECTION.x, 12)
        expect(d.y).toBeCloseTo(SUN_DIRECTION.y, 12)
        expect(d.z).toBeCloseTo(SUN_DIRECTION.z, 12)
        expect(d).not.toBe(SUN_DIRECTION)
      }
    } finally {
      ocean.dispose()
    }
  })

  it('天空色兩邊一致，且等於 sky.ts 的常數', () => {
    const ocean = createOcean()
    try {
      for (const which of ['near', 'far'] as const) {
        expect(ocean.skyColorsFor(which).horizon.getHex()).toBe(SKY_HORIZON)
        expect(ocean.skyColorsFor(which).zenith.getHex()).toBe(SKY_ZENITH)
      }
    } finally {
      ocean.dispose()
    }
  })
})

describe('既有的不變式沒被動到', () => {
  it('兩個材質仍然共用同一個 SEA_COLOR', () => {
    const ocean = createOcean()
    try {
      expect((ocean.mesh.material as MeshStandardMaterial).color.getHex())
        .toBe(new Color(SEA_COLOR).getHex())
      expect((ocean.farMesh.material as MeshStandardMaterial).color.getHex())
        .toBe(new Color(SEA_COLOR).getHex())
    } finally {
      ocean.dispose()
    }
  })

  /**
   * 【flatShading 關掉了，但那不影響輪廓】low-poly 的觀感來自頂點位移造成
   * 的多邊形邊緣，不是來自法線。這條記錄那個決定，並防止有人「順手」把它
   * 打開 —— 打開的話面法線會蓋掉解析法線，反光變成 52 m 的方塊。
   */
  it('細浪面關掉 flatShading（法線改由解析導數提供）', () => {
    const ocean = createOcean()
    try {
      expect((ocean.mesh.material as MeshStandardMaterial).flatShading).toBe(false)
    } finally {
      ocean.dispose()
    }
  })

  it('遠海仍然在細浪面之前畫（renderOrder = −1）', () => {
    const ocean = createOcean()
    try {
      expect(ocean.farMesh.renderOrder).toBe(-1)
      expect(ocean.mesh.renderOrder).toBe(0)
    } finally {
      ocean.dispose()
    }
  })

  it('dispose 之後不丟例外，且可重複呼叫', () => {
    const ocean = createOcean()
    ocean.dispose()
    expect(() => ocean.dispose()).not.toThrow()
  })

  /**
   * 【update 仍然把兩片都搬到中心】這是既有行為，glitter 的距離淡出讀的是
   * 「離相機的水平距離」，而那是由頂點的世界座標算的 —— 搬錯了淡出就會
   * 以錯的中心展開。
   */
  it('update 把細浪面對齊格點、遠海精確跟隨', () => {
    const ocean = createOcean()
    try {
      ocean.update(0, 1234.5, -6789.5)
      const cell = 10000 / 192
      expect(ocean.mesh.position.x).toBeCloseTo(Math.round(1234.5 / cell) * cell, 9)
      expect(ocean.farMesh.position.x).toBeCloseTo(1234.5, 9)
      expect(ocean.farMesh.position.z).toBeCloseTo(-6789.5, 9)
    } finally {
      ocean.dispose()
    }
  })
})

describe('太陽方向是複本', () => {
  it('改海面的 uniform 不會汙染 SUN_DIRECTION', () => {
    const before = SUN_DIRECTION.clone()
    const ocean = createOcean()
    try {
      ocean.sunDirectionFor('near').set(9, 9, 9)
      expect(SUN_DIRECTION.equals(before)).toBe(true)
    } finally {
      ocean.dispose()
    }
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/ocean.test.ts
```

預期：`ocean.uniformsFor is not a function`。

- [ ] **Step 3: 擴充 `Ocean` 介面（`src/render/ocean.ts`）**

在 `export interface Ocean` 加三個查詢方法：

```ts
  /**
   * 兩個材質各自的數值 uniform，**只為測試存在**。
   *
   * 【為什麼要開這個口】細浪面與遠海是兩份 uniform，任何一個值漂開就是
   * 5 km 處的一條環。`ocean.ts` 的註解已經為 `fog` 旗標記過同一個失敗模式
   * —— 那次靠兩條「不吃霧」的測試守住，而 glitter 多了七個數值。
   *
   * 【為什麼不直接讓測試去摸 material.userData】`onBeforeCompile` 的
   * uniform 物件不掛在 material 上，只活在閉包裡。沒有這個口就測不到。
   */
  uniformsFor(which: 'near' | 'far'): Record<string, number>
  sunDirectionFor(which: 'near' | 'far'): Vector3
  skyColorsFor(which: 'near' | 'far'): { horizon: Color; zenith: Color }
```

- [ ] **Step 4: 實作 —— 把 uniform 與著色器注入抽成一個內部函數**

在 `createOcean` 裡，兩個材質共用同一段注入邏輯：

```ts
  /**
   * 兩個材質共用的 glitter uniform。**一份物件、兩邊引用** —— 這比「兩邊
   * 各建一份、再用測試比對」更強：值不可能漂開，因為只有一份。
   *
   * 測試那一組（`ocean.test.ts`）仍然留著，它守的是「日後有人把這裡改回
   * 兩份」。
   */
  const shared = {
    uSunDirection: { value: SUN_DIRECTION.clone() },
    uMaxSlope: { value: MAX_WAVE_SLOPE },
    uRoughMin: { value: GLITTER_ROUGHNESS_MIN },
    uRoughMax: { value: GLITTER_ROUGHNESS_MAX },
    uFadeStart: { value: GLITTER_FADE_START },
    uFadeEnd: { value: GLITTER_FADE_END },
    uGlintStrength: { value: GLINT_STRENGTH },
    skyHorizon: { value: new Color(SKY_HORIZON) },
    skyZenith: { value: new Color(SKY_ZENITH) },
    skyPower: { value: SKY_GRADIENT_POWER },
  }
```

在 `oceanShading.ts` 補一個常數（Task 4 漏了它的定義，這裡補上）：

```ts
/**
 * 反光疊加到基本色上的強度。GGX 的 D 項在窄峰時可以到 10²，直接加會過曝。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11。
 */
export const GLINT_STRENGTH = 0.02
```

片段著色器的注入（兩個材質共用同一個 `onBeforeCompile` 工廠）：

```ts
  /**
   * 建立兩個材質共用的 `onBeforeCompile`。
   *
   * @param withVertexWaves 細浪面要在頂點位移；遠海只有兩個三角形，位移
   *   沒有意義（也算不出來），所以它只做片段層的著色。**法線兩邊都是由
   *   世界座標解析算的**，所以 5 km 接縫在光照上完全連續 —— 那正是不加
   *   幾何就解掉硬環的關鍵（spec §5）。
   */
  const makeOnBeforeCompile = (withVertexWaves: boolean) =>
    (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, shared, {
        uTime,
        uOrigin,
        uWaveDir: { value: WAVES.map((w) => new Vector2(w.dirX, w.dirZ)) },
        uWaveAmp: { value: WAVES.map((w) => w.amplitude) },
        uWaveLen: { value: WAVES.map((w) => w.wavelength) },
        uWaveSpd: { value: WAVES.map((w) => w.speed) },
      })

      const waveDecls = `
        #define WAVE_COUNT ${WAVES.length}
        uniform float uTime;
        uniform vec2 uOrigin;
        uniform vec2 uWaveDir[WAVE_COUNT];
        uniform float uWaveAmp[WAVE_COUNT];
        uniform float uWaveLen[WAVE_COUNT];
        uniform float uWaveSpd[WAVE_COUNT];`

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          ${waveDecls}
          varying vec3 vWorldPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 worldXZ = transformed.xz + uOrigin;
          ${withVertexWaves ? `
          float waveH = 0.0;
          for (int i = 0; i < WAVE_COUNT; i++) {
            float k = 6.28318530718 / uWaveLen[i];
            waveH += uWaveAmp[i] * sin(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * uTime);
          }
          transformed.y += waveH;` : ''}
          vWorldPos = vec3(worldXZ.x, transformed.y, worldXZ.y);`)

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          ${waveDecls}
          varying vec3 vWorldPos;
          ${SKY_GRADIENT_GLSL}
          ${OCEAN_SHADING_GLSL}`)
        .replace('#include <normal_fragment_begin>', `
          // 【法線完全由解析導數取代】不是 flatShading 的面法線，也不是
          // 內插的頂點法線 —— 那兩者都受 52 m 網格限制，而反光吃的正是
          // 法線（spec §4.1）
          vec2 grad = waveGradient(vWorldPos.xz, uTime);
          vec3 normal = waveNormalGLSL(grad);
          float waveSlopeV = length(grad);`)
        .replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fade = glitterFadeGLSL(length(cameraPosition.xz - vWorldPos.xz));
          vec3 N = mix(vec3(0.0, 1.0, 0.0), normal, fade);
          float rough = slopeRoughnessGLSL(waveSlopeV * fade);
          // Fresnel：平視反射天空、俯視看深海
          float F = fresnelGLSL(max(dot(N, V), 0.0));
          vec3 skyRefl = skyGradient(reflect(-V, N));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, skyRefl, F);
          // 太陽反光
          gl_FragColor.rgb += uGlintStrength * fade
            * glintGLSL(N, V, normalize(uSunDirection), rough);`)
    }
```

兩個材質各自 `material.onBeforeCompile = makeOnBeforeCompile(true)` 與
`farMaterial.onBeforeCompile = makeOnBeforeCompile(false)`，並把細浪面的
`flatShading: true` 改成 `flatShading: false`。

三個查詢方法：

```ts
    uniformsFor() {
      // 【兩邊回傳同一份是刻意的】上面的 `shared` 就是一份物件、兩邊引用。
      // 這個方法存在的意義是讓「有人日後改回兩份」會被測試抓到。
      return {
        uMaxSlope: shared.uMaxSlope.value,
        uRoughMin: shared.uRoughMin.value,
        uRoughMax: shared.uRoughMax.value,
        uFadeStart: shared.uFadeStart.value,
        uFadeEnd: shared.uFadeEnd.value,
        uGlintStrength: shared.uGlintStrength.value,
        skyPower: shared.skyPower.value,
      }
    },
    sunDirectionFor() {
      return shared.uSunDirection.value
    },
    skyColorsFor() {
      return { horizon: shared.skyHorizon.value, zenith: shared.skyZenith.value }
    },
```

**注意 `noUnusedParameters`**：三個方法都沒用到 `which`。TypeScript 的規則
是**以底線開頭的參數不算未使用**，所以簽名寫成 `uniformsFor(_which: 'near' | 'far')`。
介面那一側的參數名不受影響。

- [ ] **Step 5: 跑測試**

```
npx vitest run test/unit/ocean.test.ts test/unit/fog.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: 全套 unit 回歸**

```
npx vitest run test/unit/
```

預期：全綠。若 `fog.test.ts` 有任何一條紅，**停下來報告，不要改門檻**。

- [ ] **Step 7: Commit**

```bash
git add src/render/ocean.ts src/render/oceanShading.ts test/unit/ocean.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

message：

```
feat: 海面接上解析法線、Fresnel 與太陽反光

細浪面與遠海共用同一份 uniform 物件（不是兩份再比對）—— 值不可能漂開，
因為只有一份。ocean.test.ts 那組守的是「日後有人改回兩份」，與既有那兩條
「不吃霧」同一個理由：5 km 接縫的失敗模式已經發生過一次。

法線在片段層完全由 waveGradient 取代，flatShading 因此關掉。low-poly 的
輪廓來自頂點位移，一個字沒動 —— 換掉的只有面內著色。

遠海不做頂點位移（它只有兩個三角形），但法線同樣由世界座標解析算，所以
5 km 接縫在光照上完全連續。這是不加幾何就解掉硬環的關鍵。

距離淡出同時作用在法線（趨向 +Y）與反光強度上，所以遠處自然回到鏡面，
不會出現浮點精度造成的條紋。
```

---

### Task 6：Playwright 驗收、效能實測、參數回填

**Files:**
- Modify: `test/e2e/battlefield-visuals.e2e.ts`
- Modify: `docs/superpowers/specs/2026-08-10-ocean-glint-design.md`（§11 回填）

**Interfaces:**
- Consumes: Task 1~5 的全部
- Produces: 無

- [ ] **Step 1: 確認沒有殘留的 vite dev server 與開著遊戲的分頁**

專案既有紀律：跑效能相關的東西之前要先確認環境乾淨。

```
npx vite --version
```

（若有背景的 dev server 佔著 port，先關掉。）

- [ ] **Step 2: 在 `battlefield-visuals.e2e.ts` 補四個觀察點**

沿用既有形式（截圖 + `console.log('[人工看] …')`，**不對像素下斷言**）。
在既有的觀察序列之後補：

```ts
    // 25. 朝太陽方位、俯角約 50°，應看到碎光路
    await page.keyboard.press('KeyG') // 上帝視角
    await lookToward(page, SUN_AZIMUTH_DEG, -50)
    await page.screenshot({ path: `${SHOTS}sea-1-glint-toward-sun.png` })
    console.log(`[人工看] ${SHOTS}sea-1-glint-toward-sun.png —— 海面應有一條`
      + '碎光路指向太陽方位；不得是一整片均勻的亮，也不得是 52 m 的方塊')

    // 26. 同一位置轉 180°，應沒有碎光
    await lookToward(page, SUN_AZIMUTH_DEG + 180, -50)
    await page.screenshot({ path: `${SHOTS}sea-2-glint-away.png` })
    console.log(`[人工看] ${SHOTS}sea-2-glint-away.png —— 背對太陽，海面應`
      + '幾乎沒有反光。這一張與上一張的差別就是「一定角度會反光」')

    // 27. 高空俯視，5 km 接縫不得出現亮度環
    await climbTo(page, 9000)
    await page.screenshot({ path: `${SHOTS}sea-3-seam.png` })
    console.log(`[人工看] ${SHOTS}sea-3-seam.png —— 以鏡頭為圓心 5 km 處`
      + '不得出現亮度環或色帶（細浪面與遠海的接縫）；8~40 km 的淡出要看不出邊界')

    // 28. 天頂附近的太陽盤，且飛機蓋得過它
    await lookToward(page, SUN_AZIMUTH_DEG, 53)
    await page.screenshot({ path: `${SHOTS}sea-4-sun-disc.png` })
    console.log(`[人工看] ${SHOTS}sea-4-sun-disc.png —— 應看得到一顆約 30 px`
      + '的太陽盤與柔和光暈；有飛機經過時飛機必須蓋在太陽前面')
```

`SUN_AZIMUTH_DEG` 由 `sun.ts` 推導，不要寫死：

```ts
import { SUN_DIRECTION } from '../../src/render/sun'
/** 太陽的方位角，度。從 +Z 往 +X 量 —— 與遊戲的鏡頭方位同一個慣例 */
const SUN_AZIMUTH_DEG = (Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z) * 180) / Math.PI
```

`lookToward` 與 `climbTo` 若既有檔案裡沒有，用既有的鍵盤操作方式實作
（既有的 god-view e2e 用 `Shift+A/S/E` 之類的組合移動鏡頭，照抄那個手法，
不要新發明輸入介面）。

- [ ] **Step 3: 補一次幀時取樣**

既有的 `battlefield-visuals.e2e.ts` 已經在讀 WebGL 參數。在同一條路徑加：

```ts
    // 29. GPU 幀時。海面的片段著色器變重了，而海是全螢幕
    const frameMs = await page.evaluate(() => new Promise<number>((resolve) => {
      const samples: number[] = []
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        samples.push(now - last)
        last = now
        if (samples.length < 120) requestAnimationFrame(tick)
        else {
          const sorted = samples.slice(20).sort((a, b) => a - b)
          resolve(sorted[Math.floor(sorted.length / 2)]!)
        }
      }
      requestAnimationFrame(tick)
    }))
    console.log(`[人工看] 幀時中位 ${frameMs.toFixed(2)} ms`
      + `（${(1000 / frameMs).toFixed(0)} fps）—— 低於 60 fps 就要砍功能，不是放寬門檻`)
```

**不對它下斷言** —— CI 與開發機的 GPU 不同，斷言只會變成假紅。它是給人看的。

- [ ] **Step 4: 跑 Playwright**

```
npx playwright test test/e2e/battlefield-visuals.e2e.ts
```

把四張截圖與幀時**貼進報告**。

- [ ] **Step 5: 全套回歸**

```
npx vitest run
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
npx tsc --noEmit
```

預期：既有的 5 條紅（4 條指揮層 + 併行跑的 perf-gate）不變，**沒有新的紅**。
若有新的紅，**停下來量、報告、問** —— 不要改門檻。

- [ ] **Step 6: 把 spec §11 的五個參數交給專案負責人**

在報告裡列出目前值、`glint-geometry.probe.ts` 的輸出、以及四張截圖，然後
問專案負責人要不要調。**spec §11 的表格由專案負責人回填，實作者不得代填。**

若專案負責人認為「太寫實、不夠 low poly」，套用 spec §4.2 的退路：在
`waveNormalGLSL` 之後把法線量化：

```glsl
  // 【low-poly 退路，spec §4.2】把法線的方位與仰角各量化成 N 階，
  // 反光就會回到一格一格的塊狀
  vec3 quantizeNormal(vec3 n, float steps) {
    float az = atan(n.z, n.x);
    float el = acos(clamp(n.y, -1.0, 1.0));
    az = floor(az / (6.28318530718 / steps) + 0.5) * (6.28318530718 / steps);
    el = floor(el / (1.57079632679 / steps) + 0.5) * (1.57079632679 / steps);
    return vec3(sin(el) * cos(az), cos(el), sin(el) * sin(az));
  }
```

**這一步只在專案負責人要求時才做。**

- [ ] **Step 7: Commit 並回填 spec**

```bash
git add test/e2e/battlefield-visuals.e2e.ts docs/superpowers/specs/2026-08-10-ocean-glint-design.md
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

message：

```
test: 海面反光的 Playwright 觀察點與幀時取樣

四個人工觀察點：朝太陽有碎光路、背對太陽沒有、5 km 接縫沒有亮度環、
太陽盤在且飛機蓋得過它。第二張與第一張的差別就是「一定角度會反光」這句
需求本身。

太陽方位由 sun.ts 推導不寫死 —— 搬動太陽時 e2e 會跟著走。

幀時只印不斷言：CI 與開發機的 GPU 不同，斷言只會變成假紅。低於 60 fps
的處置是砍功能，不是放寬門檻。

spec §11 的五個參數留待專案負責人回填。
```

---

## Self-Review

**1. Spec 覆蓋**

| spec 節 | 對應 task |
|---|---|
| §3 架構（`sun.ts` 葉節點） | Task 1 |
| §3.2 天空漸層 GLSL 共用 | Task 4 Step 1 |
| §4.1 解析法線 | Task 2（CPU）、Task 4（GLSL）、Task 5（接線） |
| §4.2 low-poly 退路 | Task 6 Step 6 |
| §4.3 不加密網格的理由 | Task 2 的 `waveNormal` 註解 |
| §4.4 坡度粗糙度 | Task 2 的 `slopeRoughness` |
| §4.5 Fresnel | Task 3 |
| §5 遠海共用著色器 | Task 5 Step 4 的 `makeOnBeforeCompile(false)` |
| §5.1 遠處淡出 | Task 2 的 `glitterFade`、Task 5 的 `fade` |
| §6 天空太陽盤 | Task 4 Step 1 |
| §8.1 三個 CPU 純函數 | Task 2、Task 3（實際是六個：多了 `waveSlope`、`slopeRoughness`、`glitterFade`） |
| §8.2 斷言表 | Task 1/2/3/5 的測試 |
| §8.3 探針 | Task 3 Step 6 |
| §8.4 Playwright | Task 6 |
| §9 效能 | Task 6 Step 3 |
| §11 參數回填 | Task 6 Step 6 |

無缺口。

**2. Placeholder 掃描**

`GLINT_STRENGTH` 在 Task 4 的 GLSL 用到但沒定義 —— 已在 Task 5 Step 4 補上
定義並註明「Task 4 漏了它」。其餘每一步都有可執行的內容與完整的程式碼。

**3. 型別一致性**

- `waveNormal(x, z, time, out)` —— Task 2 定義、Task 3 探針使用、Task 5 GLSL 對應 `waveNormalGLSL(grad)`（**簽名刻意不同**：GLSL 版收梯度以避免重算，CPU 版收座標以便測試。這個差異寫在 `OCEAN_SHADING_GLSL` 的對應表註解裡）。
- `glintIntensity(n, v, l, roughness)` ↔ `glintGLSL(n, v, l, roughness)` —— 一致。
- `glitterFade(distance)` ↔ `glitterFadeGLSL(distance)` —— Task 4 Step 4 已把 CPU 版改成 smoothstep 對齊。
- `uniformsFor` / `sunDirectionFor` / `skyColorsFor` —— Task 5 的介面與測試、實作三處名稱一致。
- `SKY_HORIZON` / `SKY_ZENITH` / `SKY_GRADIENT_POWER` 的 uniform 名在 Task 4 由 `horizon`/`zenith`/`power` 改成 `skyHorizon`/`skyZenith`/`skyPower`，Task 4 Step 2 已同步改 `fog.test.ts`，Task 5 的 `shared` 用的也是新名字。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-ocean-glint.md`.
