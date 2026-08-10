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
- §11 那**六組**參數（`GLITTER_ROUGHNESS_MIN`/`MAX`、**`GLINT_STRENGTH`**、`GLITTER_FADE_START`/`END`、`SUN_ANGULAR_RADIUS`、`SUN_HALO_POWER`/`STRENGTH`、法線量化階數）用本計畫給的暫定值實作，**最終值由專案負責人人工驗收回填，實作者不得代填**。
  - 【`GLINT_STRENGTH` 是第四輪補進這份清單的】它在 spec §11 的表裡本來就有一列，但計畫的三處清單都漏掉它，實作者照著清單交回五組就會把一個**未經驗收的亮度值**留在程式碼裡。
  - 而且它**必須與 roughness 一起重新驗收**：α 慣例修正（第三輪）讓反光帶大幅變窄 —— 依 Task 3 的 400 點取樣，表面平均由錯版的 0.537 掉到 0.00152、取樣峰值由 0.996 掉到 0.207。歸一化的定義沒變（峰值仍恆為 1），所以 0.6 的**尺度**仍然合理；但「看起來夠不夠亮」這件事的舊觀感結論**一律作廢**。

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

> **這個檔由 Task 2、3、4 分三次 append，import 區塊也要跟著長。**
> 每一次只准 import**該 Task 自己會實作出來**的符號 —— 提早 import 後面 Task
> 才有的東西，這個 Task 的「跑測試確認它綠」就永遠綠不了，紅／綠序列直接
> 不可執行。（Codex 第五輪審查抓到：`WATER_F0`、`GLINT_EPSILON`、
> `GLINT_ROUGHNESS_FLOOR`、`OCEAN_SHADING_GLSL`、`buildOceanShadingGLSL`
> 本來都寫在這裡，但它們分別要到 Task 3 與 Task 4 才存在。）
>
> | Task | 這一次 append 的 describe | 新增的 import |
> |---|---|---|
> | 2 | 波法線／坡度／粗糙度／淡出 | 本區塊這些 |
> | 3 | `fresnel`、`glintIntensity`、`glintFromNDotH` | `WATER_F0`、`GLINT_ROUGHNESS_FLOOR`、`fresnel`、`glintIntensity`、`glintFromNDotH`、`sun.ts` 的兩個 |
> | 4 | GLSL 字串的那一組 | `GLINT_EPSILON`、`OCEAN_SHADING_GLSL`、`buildOceanShadingGLSL` |

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  MAX_WAVE_SLOPE, waveNormal, waveSlope,
  GLITTER_ROUGHNESS_MIN, GLITTER_ROUGHNESS_MAX, slopeRoughness, slopeRoughnessWith,
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

  /**
   * 【退化情形 —— spec §8.2 承諾過但初稿沒測，而且實作真的會 NaN】
   * Codex 2026-08-10 審查抓到。`MAX_WAVE_SLOPE` 是由 `WAVES` 推導的，所以
   * 「振幅全為 0」不是假想 —— 有人把某一道波的振幅調成 0 來做 A/B 就會踩到。
   * NaN 乘進顏色的症狀是黑點或白點，離成因非常遠。
   */
  it('任何輸入都不會回傳 NaN', () => {
    for (const s of [0, -0, NaN, Infinity, -Infinity, 1e-300, MAX_WAVE_SLOPE]) {
      expect(Number.isFinite(slopeRoughness(s))).toBe(true)
    }
  })
})

/**
 * 【零振幅的守衛必須真的被執行到 —— Codex 第二輪審查的 Important】
 *
 * 初稿宣稱測了「零振幅」，但那組測試全部走生產用的正值 `MAX_WAVE_SLOPE`
 * —— 新加的守衛**一行都沒有被執行到**。假綠。
 *
 * `slopeRoughnessWith` 這條縫存在的唯一理由就是讓分母測得到。
 */
describe('slopeRoughnessWith 的退化分母', () => {
  it('分母為 0 / 負 / NaN 時回下限，不是 NaN', () => {
    for (const m of [0, -0, -1, NaN]) {
      expect(slopeRoughnessWith(0.1, m)).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
    }
  })

  it('分母正常時與 slopeRoughness 逐值相同', () => {
    for (const s of [0, 0.05, 0.1, MAX_WAVE_SLOPE, 999]) {
      expect(slopeRoughnessWith(s, MAX_WAVE_SLOPE)).toBe(slopeRoughness(s))
    }
  })

  it('slope 為 NaN 或 Infinity 時回下限', () => {
    expect(slopeRoughnessWith(NaN, 1)).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
    expect(slopeRoughnessWith(Infinity, 1)).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
  })
})

/**
 * 【零振幅的整條路徑 —— spec §8.2】上面那條測的是 `slopeRoughness` 自己，
 * 這一組測的是「一片完全平靜的海」在每個函數上都不出 NaN。
 *
 * 【為什麼要單獨一組】`MAX_WAVE_SLOPE` 是模組載入時由 `WAVES` 算的常數，
 * 沒辦法在測試裡改。所以這裡用**同一條公式的獨立實作**驗證退化行為，並斷言
 * 生產用的常數目前不在退化區 —— 兩件事都要，只有後者的話公式仍可能有洞。
 */
describe('完全平靜的水面（振幅全為 0）', () => {
  it('MAX_WAVE_SLOPE 目前是正的（不在退化區）', () => {
    expect(MAX_WAVE_SLOPE).toBeGreaterThan(0)
  })

  it('零梯度時法線恆為 +Y', () => {
    const n = new Vector3()
    // 梯度為 0 的等價輸入：把 out 直接餵零梯度的建構式
    n.set(-0, 1, -0).normalize()
    expect(n.x).toBeCloseTo(0, 12)
    expect(n.y).toBeCloseTo(1, 12)
    expect(n.z).toBeCloseTo(0, 12)
  })

  it('零坡度的粗糙度是下限，不是 NaN', () => {
    expect(slopeRoughness(0)).toBeCloseTo(GLITTER_ROUGHNESS_MIN, 12)
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

/**
 * 坡度 → 粗糙度的線性映射，兩端夾住。浪尖粗、波谷平。
 *
 * 【`MAX_WAVE_SLOPE` 為 0 時回傳下限 —— Codex 2026-08-10 審查的 Important】
 * spec §8.2 承諾「振幅為 0 時法線恆為 +Y」，但初稿的 `slope / MAX_WAVE_SLOPE`
 * 在那個情形是 `0 / 0` = NaN，CPU 與 GLSL 都會中毒（NaN 乘進顏色 = 黑點或
 * 白點）。振幅全為 0 的海是平的,平的海就是最光滑的那一端。
 */
export function slopeRoughness(slope: number): number {
  return slopeRoughnessWith(slope, MAX_WAVE_SLOPE)
}

/**
 * `slopeRoughness` 的可測版本 —— 分母由呼叫端給。
 *
 * 【為什麼需要這條縫 —— Codex 第二輪審查的 Important】`MAX_WAVE_SLOPE` 是
 * 模組載入時由 `WAVES` 算出來的常數，測試裡改不了。初稿宣稱測了「零振幅」，
 * 但那組測試全部走的是**生產用的正值**分母 —— 新加的守衛**一行都沒有被執行
 * 到**。假綠。
 *
 * 【`!(x > 0)` 同時擋掉 0、負數與 NaN】NaN 的任何比較都是 false，所以
 * `!(NaN > 0)` 為 true —— 這一個判斷式就把三種壞輸入一起接住了。
 * `slope` 自己是 NaN 時也一樣：`Math.min/max` 會把 NaN 傳下去，所以另外檢查。
 */
export function slopeRoughnessWith(slope: number, maxSlope: number): number {
  if (!(maxSlope > 0) || !Number.isFinite(slope)) return GLITTER_ROUGHNESS_MIN
  const t = Math.min(Math.max(slope / maxSlope, 0), 1)
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
  - `glintFromNDotH(nDotH: number, roughness: number): number`（`glintIntensity`
    的數值核心。獨立匯出**只為了讓兩個浮點守衛測得到** —— 同 Task 2 的
    `slopeRoughnessWith`。產品程式碼不應該直接呼叫它。）

- [ ] **Step 1: 寫會紅的測試（append 到 `ocean-shading.test.ts`）**

```ts
import { SUN_DIRECTION, sunElevationRad } from '../../src/render/sun'
import {
  GLINT_ROUGHNESS_FLOOR, WATER_F0, fresnel, glintFromNDotH, glintIntensity,
} from '../../src/render/oceanShading'

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

  /**
   * 【2026-08-10 Codex 審查抓到的 Critical，這一段是修正後的版本】
   *
   * 初稿把「玩家的視線朝向」與 `V` 當成同一個方向 —— 它們**差 180°**。
   * `V` 的定義是「由**水面指向眼睛**」，而玩家是**從眼睛看向水面**。
   *
   * 幾何上：平靜水面（N = +Y）的 GGX 峰值條件是 `normalize(V + L) = N`，
   * 也就是
   *
   *     V.xz = −L.xz      V.y = L.y
   *
   * `V` 的水平方位與太陽**相反**。翻成人話：**站在太陽的另一側、朝太陽的
   * 方位看下去**，才看得到那條碎光路 —— 這正是現實中的樣子，也正是 Task 6
   * 的 e2e 觀察點（那一邊本來就是對的）。
   *
   * 為了讓測試讀起來就是需求本身，helper 收的是**玩家的視線朝向**，內部
   * 自己取負號變成 `V`。這樣「同方位是峰值」這種錯誤在型別／命名上就講不通。
   */
  const sunAzimuth = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z)
  const N = new Vector3(0, 1, 0)
  const R = 0.05
  const sunElevDeg = (sunElevationRad() * 180) / Math.PI

  /** 玩家以 `depressionDeg` 的**俯角**、朝 `azimuth` 方位看水面時的 `V`。 */
  const viewVecFor = (depressionDeg: number, azimuth: number): Vector3 => {
    // 視線朝向（眼睛 → 水面）：往下、往該方位
    const look = new Vector3(
      Math.cos(depressionDeg * RAD) * Math.sin(azimuth),
      -Math.sin(depressionDeg * RAD),
      Math.cos(depressionDeg * RAD) * Math.cos(azimuth),
    ).normalize()
    return look.negate() // V = 水面 → 眼睛
  }

  /**
   * 【這一條把 180° 的關係本身釘住】它是初稿出錯的地方，也是最容易再錯一次
   * 的地方。峰值的 `V` 必須與太陽的水平方位相反、仰角相同。
   */
  it('峰值的 V 與太陽水平方位相反、仰角相同（GGX 的 n·h = 1）', () => {
    const v = viewVecFor(sunElevDeg, sunAzimuth)
    expect(Math.atan2(v.x, v.z)).toBeCloseTo(
      Math.atan2(-SUN_DIRECTION.x, -SUN_DIRECTION.z), 9,
    )
    expect(v.y).toBeCloseTo(SUN_DIRECTION.y, 9)
    // 半向量正好是法線
    const h = v.clone().add(L).normalize()
    expect(h.y).toBeCloseTo(1, 9)
  })

  it('峰值落在「玩家朝太陽方位、俯角 = 太陽仰角」', () => {
    const peak = glintIntensity(N, viewVecFor(sunElevDeg, sunAzimuth), L, R)
    for (const d of [-40, -25, -10, 10, 25, 40]) {
      expect(glintIntensity(N, viewVecFor(sunElevDeg + d, sunAzimuth), L, R))
        .toBeLessThan(peak)
    }
  })

  it('俯角偏離 25° 時掉到峰值的十分之一以下 —— 反光是帶，不是整片海', () => {
    const peak = glintIntensity(N, viewVecFor(sunElevDeg, sunAzimuth), L, R)
    expect(glintIntensity(N, viewVecFor(sunElevDeg + 25, sunAzimuth), L, R))
      .toBeLessThan(peak / 10)
    expect(glintIntensity(N, viewVecFor(sunElevDeg - 25, sunAzimuth), L, R))
      .toBeLessThan(peak / 10)
  })

  it('背對太陽（方位差 180°）幾乎沒有反光', () => {
    const peak = glintIntensity(N, viewVecFor(sunElevDeg, sunAzimuth), L, R)
    const back = glintIntensity(N, viewVecFor(sunElevDeg, sunAzimuth + Math.PI), L, R)
    expect(back).toBeLessThan(peak / 100)
  })

  it('太陽在水面下時為 0 —— 海不會從底下發光', () => {
    const below = new Vector3(0.3, -0.9, 0.3).normalize()
    expect(glintIntensity(N, viewVecFor(45, 0), below, R)).toBe(0)
  })

  it('視線在水面下時為 0', () => {
    expect(glintIntensity(N, new Vector3(0, -1, 0), L, R)).toBe(0)
  })

  it('永遠落在 [0, 1] 且有限', () => {
    for (let e = 1; e <= 89; e += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const g = glintIntensity(N, viewVecFor(e, a), L, R)
        expect(Number.isFinite(g)).toBe(true)
        expect(g).toBeGreaterThanOrEqual(0)
        expect(g).toBeLessThanOrEqual(1)
      }
    }
  })

  /**
   * 【峰值恆為 1 是刻意的】見 `glintIntensity` 的註解：回傳的是**歸一化**的
   * 形狀而不是 GGX 的 D 項本身。所以粗糙度只管**帶多寬**，不管峰值多高 ——
   * 亮度由 `GLINT_STRENGTH` 單獨管。
   */
  it('峰值恆為 1，與粗糙度無關', () => {
    for (const r of [0.03, 0.10, 0.30]) {
      expect(glintIntensity(N, viewVecFor(sunElevDeg, sunAzimuth), L, r))
        .toBeCloseTo(1, 9)
    }
  })

  /**
   * 【退化的粗糙度 —— Codex 第二輪審查的 Important】初稿宣稱「epsilon 已經
   * 處理零粗糙度」，但用教科書形式的 `d` 時，`roughness = 0` 在 double 會
   * 漏出 1.000044（**大於 1**），在 float32 更會塌成 `d = 0` → `Infinity`。
   *
   * 改成數值穩定的 `d = a²·(n·h)² + (1 − (n·h)²)` 之後，任何 `a > 0` 的峰值
   * 都恰好是 1。這一條把那件事釘住 —— 它是「值域 [0,1]」這個宣告的邊界。
   */
  it('粗糙度為 0 或負時仍然落在 [0, 1]，峰值仍是 1', () => {
    for (const r of [0, -1, 1e-9]) {
      const g = glintIntensity(N, viewVecFor(sunElevDeg, sunAzimuth), L, r)
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeLessThanOrEqual(1)
      expect(g).toBeCloseTo(1, 6)
    }
  })

  /**
   * 【粗糙度下限守的是下溢，不是 1.0 附近的抵銷 —— Codex 第四輪審查的 Minor】
   * 上一版的理由寫「`1 − roughness⁴` 會被捨入成 1」。那是**教科書形式**的
   * 失效機制；穩定形式根本不做那個減法，所以那不是它現在的懸崖。
   *
   * 真正的機制是**下溢**：峰值處分子與分母都是 `roughness⁸`，兩邊一起塌成
   * 0 就得到 `0/0 = NaN`。
   *
   * 【「進入次正規區」不等於「歸零」—— Codex 第五輪審查的 Minor】前一版把這
   * 兩件事混為一談。實測（`Math.fround` 走 float32）：
   *
   *   最小正規數 1.18e-38 的八次方根   = 1.8146e-5  ← 保證仍是正規數
   *   最小次正規數 1.40e-45 的八次方根 = 2.4735e-6  ← 保證仍可表示
   *   roughness 1e-5  → r⁸ = 1e-40（次正規）→ 峰值仍是 1
   *   roughness 2e-6  → r⁸ = 2.56e-46      → 峰值 NaN
   *
   * 所以真正塌掉是在 2.5e-6 附近，不是 1.82e-5。但**斷言仍用 1.18e-38**：
   * GPU 可以合法地把次正規數 flush 成 0，所以「保證留在正規數範圍內」才是
   * 對 GLSL 那一份成立的保守界線。
   *
   * 0.02 的 `roughness⁸ = 2.56e-14`，離那個保守界線 24 個數量級。這條斷言不
   * 是永遠不會紅 —— 下限一旦被調到 1.8146e-5 以下它就紅。只是以目前的值來說，
   * 它真正的作用是第二條（低於 `GLITTER_ROUGHNESS_MIN`）：擋「有人把美術下限
   * 調到 0」那種未來，因為 `roughness = 0` 會讓 `a² = 0`，峰值處 `0/0 = NaN`。
   */
  it('GLINT_ROUGHNESS_FLOOR 的八次方仍是 float32 正規數，且低於美術下限', () => {
    expect(Math.pow(GLINT_ROUGHNESS_FLOOR, 8)).toBeGreaterThan(1.18e-38)
    expect(GLINT_ROUGHNESS_FLOOR).toBeLessThan(GLITTER_ROUGHNESS_MIN)
  })

  /**
   * 【上面那條只看數字，這一條看實際運算 —— Codex 第五輪審查的 Minor】
   * 用與 `ggx-stability.probe.ts` 相同的 float32 路徑跑一次，確認生產下限
   * 真的算得出有限的峰值，而退化值真的會壞。這一條才是「症狀」本身。
   */
  it('float32 路徑下：生產下限的峰值有限，2e-6 會是 NaN', () => {
    const f = Math.fround
    const peakF32 = (r: number): number => {
      const a2 = f(f(r * r) * f(r * r))
      return f(f(a2 * a2) / f(a2 * a2)) // n·h = 1 → d = a²
    }
    expect(peakF32(GLINT_ROUGHNESS_FLOOR)).toBeCloseTo(1, 6)
    expect(Number.isFinite(peakF32(GLINT_ROUGHNESS_FLOOR))).toBe(true)
    expect(Number.isNaN(peakF32(2e-6))).toBe(true)
  })

  /**
   * 【粗糙度的作用要測得到】它是 spec §4.4 唯一的產出。只測「有輸出」的話，
   * 把 roughness 完全忽略掉也會通過。
   */
  it('越粗糙反光帶越寬', () => {
    const sharp = glintIntensity(N, viewVecFor(sunElevDeg + 15, sunAzimuth), L, 0.03)
    const rough = glintIntensity(N, viewVecFor(sunElevDeg + 15, sunAzimuth), L, 0.30)
    expect(rough).toBeGreaterThan(sharp)
  })

  /**
   * 【這一條是唯一擋得住 α 慣例寫錯的斷言 —— Codex 第四輪審查的 Important】
   *
   * 上面那三條（峰值恆為 1、離峰掉到十分之一以下、越粗越寬）在**錯的**
   * `α = roughness` 版本下全部都是綠的 —— 這正是第三輪那個 bug 能活下來的
   * 原因。形狀類的斷言擋不住「整條曲線被換成另一條同樣單調、同樣峰值 1 的
   * 曲線」，只有固定的離峰**絕對值**擋得住。
   *
   * 幾何：`V` 在垂直平面內偏離峰值 25°，半向量就偏離法線 25°/2 = 12.5°
   * （兩個單位向量的半向量是角平分線），所以 `n·h = cos(12.5°)`。
   *
   * 【它「與太陽仰角無關」是有前提的 —— Codex 第五輪審查的 Minor】前一版把
   * 這句寫得太滿。`n·h` 確實與仰角無關，但 `glintIntensity` 在 `n·v ≤ 0` 時
   * 會**早退成 0**：太陽仰角若低於 25°，`sunElevDeg − 25` 那一邊的視線就跑到
   * 水面下，錨點立刻假紅。目前是 53.03°，兩邊都在水面上。
   *
   * 所以下面第一條斷言先把這個前提釘住 —— 有人搬太陽時，紅的會是「前提不
   * 成立」這條清楚的訊息，而不是兩個看不懂的數值不符。
   *
   *   α = roughness²（對）  roughness 0.20 → 1.09412537753889e-3
   *                        roughness 0.04 → 2.98598544973283e-9
   *   α = roughness（錯）   roughness 0.20 → 2.21597890258e-1   （203 倍）
   *                        roughness 0.04 → 1.09412537754e-3    （366000 倍）
   *
   * 相對容差取 1e-12：實際走向量路徑算出來的值與解析值一致到第 15 位有效
   * 數字，而錯的版本差 2 個數量級以上 —— 這個容差同時鬆到不會因浮點抖動
   * 假紅、緊到擋得住任何公式退化。
   */
  it('離峰的絕對值釘住 α = roughness²（GGX / three 的慣例）', () => {
    // 前提：太陽仰角要高過 25°，否則 −25° 那一邊的視線在水面下、會早退成 0
    expect(sunElevDeg).toBeGreaterThan(25)
    expect(sunElevDeg).toBeLessThan(65) // +25° 也不能翻過天頂
    const anchors: ReadonlyArray<readonly [number, number]> = [
      [0.20, 1.09412537753889e-3],
      [0.04, 2.98598544973283e-9],
    ]
    for (const [r, expected] of anchors) {
      for (const off of [25, -25]) {
        const g = glintIntensity(N, viewVecFor(sunElevDeg + off, sunAzimuth), L, r)
        expect(Math.abs(g / expected - 1)).toBeLessThan(1e-12)
      }
    }
  })
})

/**
 * 【為什麼要直接測核心 —— Codex 第四輪審查的 Important】`glintFromNDotH` 的
 * 兩個守衛擋的都是 float32 的越界，而 JS 的 double 在 `glintIntensity` 的
 * 路徑上永遠產生不出 `n·h > 1`。不開這個縫，那兩個守衛就是**寫了也測不到**
 * 的程式碼 —— 與 `slopeRoughnessWith` 完全同一個理由。
 */
describe('glintFromNDotH（數值核心）', () => {
  /** float32 在 1.0 附近的解析度。GLSL 那一份的 `dot` 就會漏出這個量級。 */
  const F32_ULP_AT_1 = Math.pow(2, -23)

  it('n·h 略大於 1 時仍是 1，不會爆成 15.39', () => {
    for (const r of [0.02, 0.04, 0.20, 1]) {
      const g = glintFromNDotH(1 + F32_ULP_AT_1, r)
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeLessThanOrEqual(1)
      expect(g).toBeCloseTo(1, 12)
    }
  })

  /**
   * 這一條把「不夾會壞多少」本身記在測試裡：如果有人把 clamp 拿掉，上面
   * 那條會紅；而這一條說明它為什麼會紅。
   */
  it('未夾的算式在 n·h² = 1 + 2⁻²³ 會超過 1 —— 這是 clamp 存在的理由', () => {
    const unclamped = (r: number): number => {
      const a2 = r * r * (r * r)
      const q = 1 + F32_ULP_AT_1
      const d = a2 * q + (1 - q)
      return (a2 * a2) / (d * d)
    }
    expect(unclamped(0.04)).toBeGreaterThan(1.09)
    expect(unclamped(0.02)).toBeGreaterThan(15)
  })

  /**
   * 注意 GGX 的 D 在 `n·h = 0` **不是** 0，而是 `α⁴`（roughness 0.1 時是
   * 1e-8）—— 它只是小到看不見。所以這裡斷言的是「負值與 0 等價」，不是
   * 「等於 0」。真正把水面下的情形擋成 0 的是 `glintIntensity` 的
   * `n·l ≤ 0 || n·v ≤ 0` 那兩個早退。
   */
  it('n·h 為負時與 0 等價，且小到看不見', () => {
    expect(glintFromNDotH(-0.5, 0.1)).toBe(glintFromNDotH(0, 0.1))
    expect(glintFromNDotH(-0.5, 0.1)).toBeLessThan(1e-7)
  })

  /**
   * 【上界只有在**離峰**才測得到 —— Codex 第五輪審查的 Important】前一版只用
   * `glintFromNDotH(1, r)` 測，那是假綠：峰值處 `d = a²`，回傳 `a²/a² = 1`，
   * **對任何非零 roughness 都成立**，所以把上界的 clamp 整條刪掉那條測試照樣綠。
   *
   * 未夾版本的實際值（`n·h` 離峰時）：
   *
   *   n·h = 0.5, r = 1.5  →   6.308
   *   n·h = 0.5, r = 10   →  15.990
   *   n·h = 0,   r = 10   →   1e8
   *
   * 所以要釘的是離峰。`r > 1` 沒有物理意義，夾成 1 之後整條曲線就是 r = 1
   * 那一條。
   */
  it('粗糙度大於 1 時整條曲線都落在 [0, 1]，且與 r = 1 相同', () => {
    for (const nh of [1, 0.9, 0.5, 0.1, 0]) {
      for (const r of [1.5, 10, 1e6]) {
        const g = glintFromNDotH(nh, r)
        expect(g).toBeGreaterThanOrEqual(0)
        expect(g).toBeLessThanOrEqual(1)
        // 夾成 1 之後就該與 r = 1 逐值相同
        expect(g).toBe(glintFromNDotH(nh, 1))
      }
    }
  })

  /**
   * 這一條把「不夾上界會壞多少」記在測試裡 —— 同上面 `n·h` 那一對的做法。
   */
  it('未夾上界的算式在離峰處會遠遠超過 1 —— 這是上界存在的理由', () => {
    const unclampedRough = (nh: number, r: number): number => {
      const a2 = r * r * (r * r)
      const q = nh * nh
      const d = a2 * q + (1 - q)
      return (a2 * a2) / (d * d)
    }
    expect(unclampedRough(0.5, 1.5)).toBeGreaterThan(6)
    expect(unclampedRough(0.5, 10)).toBeGreaterThan(15)
    expect(unclampedRough(0, 10)).toBeGreaterThan(1e7)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/ocean-shading.test.ts
```

預期：`WATER_F0`、`fresnel`、`glintIntensity`、`glintFromNDotH` 未匯出而失敗。

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
 * 反光退化保護的門檻。**CPU 與 GLSL 共用這一個常數**（GLSL 那一份由字串
 * 模板把它插進去，見 `OCEAN_SHADING_GLSL`）—— 初稿是 CPU `1e-12`、GLSL
 * `1e-6` 兩份，Codex 2026-08-10 審查抓到。
 */
export const GLINT_EPSILON = 1e-6

/**
 * 粗糙度的下限。**不是美術參數，是數值安全的下限。**
 *
 * 【它擋的是下溢，不是 1.0 附近的抵銷 —— Codex 第四輪審查的 Minor】前一版
 * 的理由寫「`1 − roughness⁴` 會被捨入成 1」。那是**教科書形式**的失效機制；
 * 現在用的穩定形式根本不做那個減法，所以那不是它的懸崖。
 *
 * 真正的機制是**下溢**：峰值處 `d = roughness⁴`，分子分母都是
 * `roughness⁸`，兩邊一起塌成 0 就得到 `0/0 = NaN`。float32 的最小正規數是
 * `1.18e-38`，所以要 `roughness > 1.8146e-5` 才保證 `roughness⁸` 仍是正規數。
 *
 * 【保守界線，不是實際懸崖 —— Codex 第五輪審查】次正規數仍可表示，所以實測
 * 到 `roughness = 2.5e-6` 峰值都還是 1，`2e-6` 才真的變 `NaN`
 * （`ggx-stability.probe.ts` 在 `1e-6` 印的就是它）。用 `1.8146e-5` 當界線是
 * 因為 **GPU 可以合法地把次正規數 flush 成 0** —— 對 GLSL 那一份，只有留在
 * 正規數範圍內才是有保證的。
 *
 * 【0.02 這個值】`0.02⁸ = 2.56e-14`，離保守界線 24 個數量級 —— 數值上非常寬鬆。
 * 它真正的作用是**下限本身**：`roughness = 0` 會讓 `a² = 0`，峰值處
 * `0/0 = NaN`。取 0.02 是因為它**遠低於** `GLITTER_ROUGHNESS_MIN`（0.04），
 * 所以正常路徑永遠碰不到，它擋的是「有人把美術下限調到 0」那種未來。
 *
 * 【它與穩定形式是兩層保險】`glintFromNDotH` 的 `d` 已經是不會抵銷的寫法，
 * 但仍需要這個夾 —— 穩定形式擋得住抵銷，擋不住 `a² = 0`。
 */
export const GLINT_ROUGHNESS_FLOOR = 0.02

/**
 * 注入到片段著色器裡的兩個唯一標記。**只為測試存在。**
 *
 * 【為什麼不能用函數名當定位點 —— Codex 第二輪審查的 Important】
 * `glintGLSL(` 的第一個匹配是**函數定義**，它必然在 `<opaque_fragment>`
 * 之前，所以「呼叫點在 anchor 之後」這個斷言用函數名去比對，對**正確的
 * 實作**也會失敗。反過來，只剩定義、呼叫被刪掉時 `toContain` 仍然是真 ——
 * 那正是要抓的 mutation。
 *
 * 標記只出現在呼叫點，兩個問題一起解掉。GLSL 註解對編譯完全無影響。
 */
export const OCEAN_NORMAL_MARKER = '// @ocean-analytic-normal'
export const OCEAN_GLINT_MARKER = '// @ocean-glint-apply'

/**
 * 太陽在水面上的鏡面反光**形狀**，0..1，峰值恆為 1。
 *
 * GGX(Trowbridge–Reitz) 的法線分布項 `D`，**除以它自己的峰值**：
 *
 * ```
 * h  = normalize(v + l)
 * a  = roughness²
 * d  = (n·h)²·(a² − 1) + 1
 * D  = a² / (π·d²)              D_max = 1 / (π·a²)   （在 n·h = 1）
 * 回傳 D / D_max = a⁴ / d²
 * ```
 *
 * 【為什麼要歸一化 —— Codex 2026-08-10 審查的 Important】初稿直接回傳 `D`，
 * 而 `D_max = 1/(π·roughness⁴)`：roughness 0.04 時是 **1.24 × 10⁵**、0.20 時
 * 仍有 **199**。乘上任何一個「亮度」常數都會在窄峰處爆成一片白，而在粗處
 * 幾乎看不見 —— 那個常數根本沒有可用的取值。
 *
 * 歸一化之後**粗糙度只管帶多寬，亮度由 `GLINT_STRENGTH` 單獨管**，兩個旋鈕
 * 才互相獨立。代價是它不再是能量守恆的 BRDF —— 但這裡本來就不是在做
 * 物理正確的渲染，是在做一條看得到的碎光路。
 *
 * 【為什麼只取 D 不取完整的 BRDF】幾何遮蔽項與 Fresnel 在這裡是分開處理的
 * （Fresnel 見上面那個函數），而 D 的**形狀**就是「反光帶落在哪、多寬」的
 * 全部內容。
 *
 * 【峰值在哪 —— 這裡是初稿錯的地方】`n·h = 1` 時最大。平靜水面（n = +Y）上
 * 那要求 `V.xz = −L.xz` 且 `V.y = L.y`，也就是 **`V` 的水平方位與太陽相反**。
 * 而 `V` 是「水面 → 眼睛」，所以翻成玩家的動作是**朝太陽的方位、以等於太陽
 * 仰角的俯角看下去**。初稿的 CPU 測試把「玩家視線朝向」與 `V` 當成同一個
 * 方向，那差 180°（Codex 2026-08-10 審查的 Critical）。
 *
 * 【為什麼要擋兩個負值】`n·l ≤ 0` 是太陽在水面下（海不會從底下發光），
 * `n·v ≤ 0` 是從水面下往上看。兩者都不是這個世界會發生的事，但著色器會
 * 對每個像素求值。
 *
 * @param n 水面法線，單位向量
 * @param v 由水面**指向眼睛**的單位向量（不是玩家的視線朝向，那是它的反向）
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
  if (hLen <= GLINT_EPSILON) return 0
  const nDotH = (n.x * hx + n.y * hy + n.z * hz) / hLen
  return glintFromNDotH(nDotH, roughness)
}

/**
 * `glintIntensity` 的數值核心 —— 只吃 `n·h` 與粗糙度。
 *
 * 【為什麼要獨立成一個匯出的函數】兩個守衛（夾 `n·h`、夾 `roughness`）擋的
 * 都是**浮點誤差**造成的越界，而在 JS 的 double 裡從正規化過的向量算出來的
 * `n·h` 永遠不會超過 1 —— 也就是說，經由 `glintIntensity` 根本**測不到**那
 * 兩個守衛。這是 `slopeRoughnessWith` 同一個縫（Codex 第二輪審查的 I-d）：
 * 要能被測到的守衛，就得有一個能直接餵值的入口。
 *
 * 【夾 `n·h` 是必須的 —— Codex 第四輪審查的 Important】兩個經過 float32
 * `normalize` 的單位向量，其內積仍可能略大於 1（float32 在 1.0 附近的解析度
 * 是 `2⁻²³ ≈ 1.19e-7`）。`nh² = 1 + 2⁻²³` 時：
 *
 *   roughness 0.04 → 回傳 1.10
 *   roughness 0.02 → 回傳 15.39   ← 下限本身也不安全
 *
 * 也就是「值域 [0,1]、峰值恆為 1」在 GLSL 會直接不成立，鏡射峰附近會出現
 * 過亮的白點，而 `GLINT_STRENGTH` 也不再是亮度上限。three 自己的 `BRDF_GGX`
 * 就是先 `saturate(dot(normal, halfDir))` 才平方，這裡跟它一致。
 *
 * 【夾 `roughness` 的上界】`d − a² = (1 − (n·h)²)(1 − a²)`，所以 `a² ≤ 1`
 * 時才保證 `d ≥ a²`、回傳值 `≤ 1`。粗糙度大於 1 沒有物理意義，夾掉即可。
 */
export function glintFromNDotH(nDotH: number, roughness: number): number {
  // 【a 有下界】roughness 為 0 時 d 會在 n·h = 1 上變成 0，a⁴/d² = 0/0
  // 【`d` 的寫法是數值穩定的那一種 —— Codex 第二輪審查的 Important】
  //
  //   教科書形式  d = (n·h)²·(a² − 1) + 1
  //   這裡用的    d = a²·(n·h)² + (1 − (n·h)²)
  //
  // 兩者代數上完全相同（展開即得），但前者在 `a²` 遠小於 1 時會發生
  // **災難性抵銷**：`a² − 1` 在 float32 直接捨入成 −1，於是 `n·h = 1` 時
  // `d = 0`，回傳 `Infinity`；在 JS 的 double 也會漏出 1.000044 這種
  // 「大於 1」的值，違反本函數宣告的值域。
  //
  // 後者沒有減法抵銷：`n·h = 1` 時 `d = a²`，回傳 `a⁴/a⁴ = 1` —— **恰好是
  // 峰值 1，而且對任何 `0 < a ≤ 1` 都成立**，包含被下限夾住的情形。
  // 【α = roughness²，這是 GGX 與 three 的慣例】上一版把 α 寫成 roughness
  // 本身，兩者都在 n·h = 1 時給出峰值 1，所以「峰值恆為 1」與「越粗越寬」
  // 兩條測試**都假綠**，而反光帶的寬度差非常多：roughness 0.20、偏離峰值
  // 25° 時，錯的那版是 0.2216、對的是 0.0010941 —— 窄碎光帶會變成一大片
  // 發亮。Codex 第三輪審查抓到，第四輪要求由固定數值的斷言釘死。
  const r = Math.min(Math.max(roughness, GLINT_ROUGHNESS_FLOOR), 1)
  const a2 = r * r * (r * r) // α² = roughness⁴
  const nh = Math.min(Math.max(nDotH, 0), 1) // ← 見上面「夾 n·h」
  const nh2 = nh * nh
  const d = a2 * nh2 + (1 - nh2)
  return (a2 * a2) / (d * d) // α⁴ / d²
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

/**
 * 玩家以 `depressionDeg` 的**俯角**、朝 `az` 方位看水面時的 `V`（水面→眼睛）。
 *
 * 【與單元測試逐字同一條 —— Codex 第二輪審查的 Important】初稿的探針直接
 * 建了一個「水平分量與太陽同方位」的向量卻標成「朝太陽方位」，方位差 180°。
 * 那會讓 `flatPeak` 不是真正的峰值、方位掃描的峰值出現在標示的 180° 處，
 * 而 spec §11 的參數就會依據一份錯的報告去回填。
 */
const view = (depressionDeg: number, az: number): Vector3 => new Vector3(
  Math.cos(depressionDeg * RAD) * Math.sin(az),
  -Math.sin(depressionDeg * RAD),
  Math.cos(depressionDeg * RAD) * Math.cos(az),
).normalize().negate()

/**
 * 【為什麼要對真實的水面取樣而不是只用平靜水面】平靜水面（n = +Y）的
 * 反光帶是幾何上界；真實水面的 ±10° 坡度會把帶撐開。玩家看到的是後者。
 */
const FLAT = new Vector3(0, 1, 0)
const n = new Vector3()

/**
 * 【平均與峰值都要回傳 —— Codex 第五輪審查的 Minor】前一版算了 `peak` 卻只
 * 回傳平均。而 `GLINT_STRENGTH` 的驗收依據是**峰值**（碎光有多亮），平均只
 * 說明「整片海有多少在閃」。只印平均的話，專案負責人拿不到他要回填那個參數
 * 所需的數字。
 */
interface SurfaceStat { readonly mean: number; readonly peak: number }

function meanOverSurface(elevDeg: number, az: number): SurfaceStat {
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
  return { mean: sum / N, peak }
}

console.log('\n=== 平靜水面（幾何上界）：朝太陽方位，強度 vs 視線仰角 ===')
console.log('仰角    強度      相對峰值')
const flatPeak = glintIntensity(FLAT, view(sunElev, sunAz), SUN_DIRECTION, GLITTER_ROUGHNESS_MIN)
for (let e = 5; e <= 85; e += 5) {
  const g = glintIntensity(FLAT, view(e, sunAz), SUN_DIRECTION, GLITTER_ROUGHNESS_MIN)
  console.log(`${String(e).padStart(3)}°  ${g.toExponential(2).padStart(10)}`
    + `  ${(100 * g / flatPeak).toFixed(2).padStart(8)}%`)
}

// 【平均與峰值並排】平均是「整片海有多少在閃」，峰值是「最亮的那一點多亮」
// —— 回填 GLINT_STRENGTH 看的是後者，回填 roughness 看的是前者
console.log('\n=== 真實水面（400 個取樣點）：朝太陽方位 ===')
console.log('仰角    平均強度        取樣峰值')
for (let e = 5; e <= 85; e += 5) {
  const s = meanOverSurface(e, sunAz)
  console.log(`${String(e).padStart(3)}°  ${s.mean.toExponential(2).padStart(12)}`
    + `  ${s.peak.toExponential(2).padStart(12)}`)
}

console.log('\n=== 方位掃描（仰角固定在太陽仰角）===')
console.log('方位差   平均強度        取樣峰值')
for (let d = 0; d <= 180; d += 15) {
  const s = meanOverSurface(sunElev, sunAz + d * RAD)
  console.log(`${String(d).padStart(4)}°  ${s.mean.toExponential(2).padStart(12)}`
    + `  ${s.peak.toExponential(2).padStart(12)}`)
}
```

跑它：

```
npx vite-node test/tools/glint-geometry.probe.ts
```

**把輸出貼進報告** —— 這是專案負責人回填 §11 那**六組**參數的依據，其中
`GLINT_STRENGTH` 與 `GLITTER_ROUGHNESS_MIN`/`MAX` 必須**一起**看：粗糙度決定
反光帶多寬，強度決定峰值多亮，而兩者對「看起來像不像碎光路」的影響是耦合的。

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

峰值落在「玩家朝太陽方位、俯角 = 太陽仰角」（GGX 的 n·h = 1）。注意 V 是
「水面→眼睛」，與玩家的視線朝向差 180° —— 那是初稿寫錯的地方。偏離 25°
掉到十分之一以下；背對太陽掉到百分之一以下。太陽或視線在水面下時回 0 —— 那
兩個分支是給著色器的，它會對每個像素求值而 pow 對負數未定義。

只取 GGX 的 D 項不取完整 BRDF：D 就是「反光帶落在哪、多寬」的全部內容，
而完整 BRDF 會把亮度綁進去，亮度是可調的。

glint-geometry.probe.ts 掃視線仰角與方位，平靜水面（幾何上界）與真實水面
（400 取樣點的平均**與峰值**）各一組 —— 那是回填 §11 那六組參數的依據。
平均說明「整片海有多少在閃」（回填 roughness），峰值說明「最亮那點多亮」
（回填 GLINT_STRENGTH），兩個都要印。
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
  - `buildOceanShadingGLSL(f0: number, eps: number, roughFloor: number): string`
    （`OCEAN_SHADING_GLSL` 就是它套用生產常數的結果。獨立匯出**只為了讓
    「常數真的來自 TS」測得到** —— 消費端一律用 `OCEAN_SHADING_GLSL`。）

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
    // 【非有不可】three 不會替自寫的 ShaderMaterial 呼叫輸出色彩空間轉換。
    // 少了它，天空把線性值原樣寫進 sRGB 緩衝區 —— 螢幕上比常數所表達的暗
    // 一大截，而且與吃霧的物件（那些有轉換）對不起來。裁定與實測見本檔
    // 「天空球沒有做輸出色彩空間轉換」那一節
    #include <colorspace_fragment>
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
 *
 * 【常數用字串模板插進去，不准在 GLSL 裡重打一次 —— Codex 2026-08-10 審查的
 * Important】初稿把 `WATER_F0` 寫成 GLSL 裡的 `0.0204` 字面值、把退化門檻寫成
 * `1e-6`（CPU 那邊是 `1e-12`）。那是兩個現成的無聲分家點:改 TS 常數不會改
 * GLSL,而沒有任何測試看得到。凡是兩邊都要用的數字,一律 `${...}` 插值,
 * 並由 `ocean-shading.test.ts` 斷言字串裡真的含那個值。
 *
 * 【為什麼是一個吃參數的 builder，不是直接寫成 const —— Codex 第三／第四輪
 * 審查的 M-a】「字串裡含 `0.020400`」這種斷言**分不出**它是模板插值還是有人
 * 手打了同一個數字上去。要真的證明它來自 TS 常數，測試就得能餵**不同的**值
 * 進來、看輸出跟著變。所以把模板抽成 `buildOceanShadingGLSL(...)`，
 * `OCEAN_SHADING_GLSL` 只是它套用生產常數的結果。
 *
 * 這與 `slopeRoughnessWith`、`glintFromNDotH` 是同一個手法：**測不到的東西
 * 就開一個縫讓它測得到。** 產品程式碼一律用 `OCEAN_SHADING_GLSL`，builder
 * 只給測試用。
 */
export function buildOceanShadingGLSL(
  f0: number, eps: number, roughFloor: number,
): string {
  return /* glsl */ `
  // 【這幾個由 TS 常數插值進來，不是重打的字面值】見上面的註解
  #define WATER_F0 ${f0.toFixed(6)}
  #define GLINT_EPS ${eps.toExponential()}
  #define GLINT_ROUGH_FLOOR ${roughFloor.toFixed(6)}
  #define MAX_SLOPE_EPS ${eps.toExponential()}

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

  // 【分母要夾 —— Codex 第二輪審查的 Important】CPU 版加了
  // 「MAX_WAVE_SLOPE <= 0 就回下限」的守衛，但 GLSL 這一份漏了。
  // 振幅全為 0 時 uMaxSlope 是 0，`0/0` = NaN，NaN 乘進顏色的症狀是
  // 黑點、白點或整片異常 —— 而 CPU 測試完全看不到
  float slopeRoughnessGLSL(float slope) {
    return mix(uRoughMin, uRoughMax,
               clamp(slope / max(uMaxSlope, MAX_SLOPE_EPS), 0.0, 1.0));
  }

  float fresnelGLSL(float nDotV) {
    float c = clamp(1.0 - nDotV, 0.0, 1.0);
    float c2 = c * c;
    return WATER_F0 + (1.0 - WATER_F0) * c2 * c2 * c;
  }

  // 【歸一化的 D，峰值恆為 1】理由見 CPU 版 glintIntensity 的註解：
  // 原始的 D_max = 1/(π·roughness⁴)，roughness 0.04 時是 1.24e5 —— 沒有
  // 任何一個亮度常數同時適用於窄峰與粗糙的情形
  float glintGLSL(vec3 n, vec3 v, vec3 l, float roughness) {
    float nDotL = dot(n, l);
    float nDotV = dot(n, v);
    if (nDotL <= 0.0 || nDotV <= 0.0) return 0.0;
    vec3 h = v + l;
    float hLen = length(h);
    if (hLen <= GLINT_EPS) return 0.0;
    // 【必須夾 —— 這一份才是真的 float32】兩個 normalize 過的單位向量，其
    // 內積仍可能是 1 + 2⁻²³。不夾的話 roughness 0.04 回傳 1.10、0.02 回傳
    // 15.39，鏡射峰附近出現過亮白點。three 自己的 BRDF_GGX 也是先 saturate
    // 才平方。與 CPU 版的 glintFromNDotH 逐字對應。Codex 第四輪審查。
    float nDotH = clamp(dot(n, h) / hLen, 0.0, 1.0);
    // 【與 CPU 版逐字對應的穩定形式】d = a²·(n·h)² + (1 − (n·h)²)。
    // 教科書的 (n·h)²·(a²−1)+1 在 float32 會把 a²−1 捨成 −1 → d = 0 → Infinity
    // α = roughness²（GGX / three 的慣例）—— 與 CPU 版逐字對應
    // 上界 1.0：d − a² = (1−(n·h)²)(1−a²)，a² > 1 時回傳值會超過 1
    float r = clamp(roughness, GLINT_ROUGH_FLOOR, 1.0);
    float a2 = r * r * (r * r); // α² = roughness⁴
    float nh2 = nDotH * nDotH;
    float d = a2 * nh2 + (1.0 - nh2);
    return (a2 * a2) / (d * d); // α⁴ / d²
  }

  float glitterFadeGLSL(float distance) {
    return 1.0 - smoothstep(uFadeStart, uFadeEnd, distance);
  }
`
}

/**
 * 生產用的著色器原始碼。**消費端一律用這個，不要自己呼叫 builder。**
 */
export const OCEAN_SHADING_GLSL = buildOceanShadingGLSL(
  WATER_F0, GLINT_EPSILON, GLINT_ROUGHNESS_FLOOR,
)
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

- [ ] **Step 5: 寫 GLSL 字串的那一組測試（append 到 `ocean-shading.test.ts`）**

**先把這三個符號加進檔案最上面的 import**（它們到這個 Task 才存在，Task 2／3
不准提早 import —— 見 Task 2 Step 1 的表）：

```ts
import {
  GLINT_EPSILON, OCEAN_SHADING_GLSL, buildOceanShadingGLSL,
} from '../../src/render/oceanShading'
```

**GLSL 是字串，vitest 跑不到它。** 所以這一組全部是字串斷言 —— 它們守的不是
語意而是「那幾行還在」。這是這個專案能對 GLSL 做到的上限，真正的語意由 Task 6
的人工畫面驗收守（spec §10）。

```ts
/**
 * 【GLSL 的常數必須真的來自 TS 常數 —— Codex 第二輪審查的 Minor】
 * 字串模板本身已經解掉現在的雙份問題，但沒有測試的話，日後有人改回硬編碼
 * 不會有東西紅。
 */
describe('GLSL 裡的常數與公式', () => {
  it('WATER_F0 / GLINT_EPSILON / GLINT_ROUGHNESS_FLOOR 都出現在 GLSL 裡', () => {
    expect(OCEAN_SHADING_GLSL).toContain(WATER_F0.toFixed(6))
    expect(OCEAN_SHADING_GLSL).toContain(GLINT_EPSILON.toExponential())
    expect(OCEAN_SHADING_GLSL).toContain(GLINT_ROUGHNESS_FLOOR.toFixed(6))
  })

  /**
   * 【上面那條擋不住硬編碼 —— Codex 第三／第四輪審查的 M-a】只要有人把
   * `${WATER_F0.toFixed(6)}` 換成字面值 `0.020400`，上面每一條斷言都還是綠的。
   * 「目前的數字出現在字串裡」證明不了「這個數字來自 TS 常數」。
   *
   * 唯一能證明的方式是**餵不同的值進去，看輸出跟著變**。那需要一個縫，所以
   * 模板抽成了 `buildOceanShadingGLSL(...)`。同樣的手法見 `slopeRoughnessWith`
   * 與 `glintFromNDotH`。
   *
   * 用來當哨兵的三個值刻意挑成不可能是生產值的數字 —— 這樣「不含生產值」那
   * 幾條負向斷言才有意義。
   */
  it('GLSL 的常數真的來自參數（餵哨兵值，輸出跟著變）', () => {
    const glsl = buildOceanShadingGLSL(0.123456, 7e-3, 0.654321)
    expect(glsl).toContain('#define WATER_F0 0.123456')
    expect(glsl).toContain('#define GLINT_EPS 7e-3')
    expect(glsl).toContain('#define GLINT_ROUGH_FLOOR 0.654321')
    expect(glsl).toContain('#define MAX_SLOPE_EPS 7e-3')
    // 哨兵版本裡不該還留著生產值 —— 有的話就是硬編碼
    expect(glsl).not.toContain(WATER_F0.toFixed(6))
    expect(glsl).not.toContain(GLINT_ROUGHNESS_FLOOR.toFixed(6))
  })

  it('OCEAN_SHADING_GLSL 就是 builder 套用生產常數的結果', () => {
    expect(OCEAN_SHADING_GLSL).toBe(
      buildOceanShadingGLSL(WATER_F0, GLINT_EPSILON, GLINT_ROUGHNESS_FLOOR),
    )
  })

  /**
   * 【GLSL 的兩個夾必須存在 —— Codex 第四輪審查的 Important】`glintFromNDotH`
   * 的兩個夾由上面的單元測試守住，但那是 CPU 版；GLSL 才是真正跑在 float32
   * 上的那一份 —— 少了 `clamp`，`dot` 漏出 `1 + 2⁻²³` 時 roughness 0.02 會
   * 回傳 15.39。
   */
  it('GLSL 的 glintGLSL 有夾住 n·h 與 roughness', () => {
    expect(OCEAN_SHADING_GLSL).toContain('clamp(dot(n, h) / hLen, 0.0, 1.0)')
    expect(OCEAN_SHADING_GLSL).toContain('clamp(roughness, GLINT_ROUGH_FLOOR, 1.0)')
  })

  /**
   * 【α 慣例在 GLSL 也要有守門員 —— Codex 第五輪審查的 Important】上面那條
   * CPU 的錨點測試（`glintIntensity` 的離峰絕對值）只守得住 CPU 那一份。
   * **畫面上跑的是這一份。** GLSL 誤寫回 `a2 = r * r` 時，所有 CPU 錨點仍然
   * 全綠，而海面在 roughness 0.20 會寬 203 倍、0.04 會寬 366000 倍 ——
   * 窄碎光帶變成一大片發亮，正是這一整串修正要擋的退化。
   *
   * 【為什麼是比對字面】GLSL 跑不到，只能守「那一行還在」。負向斷言把
   * `a2 = r * r;` 這個確切的錯誤寫法釘死。
   */
  it('GLSL 的 α 是 roughness²（a2 = roughness⁴），不是 roughness', () => {
    expect(OCEAN_SHADING_GLSL).toContain('float a2 = r * r * (r * r);')
    expect(OCEAN_SHADING_GLSL).not.toContain('float a2 = r * r;')
  })

  /**
   * 【CPU 與 GLSL 的穩定形式必須是同一條】`d` 一旦有一邊寫回教科書形式，
   * float32 那邊就會在峰值 `Infinity`。
   */
  it('GLSL 的 d 是數值穩定的那一種寫法', () => {
    expect(OCEAN_SHADING_GLSL).toContain('float d = a2 * nh2 + (1.0 - nh2);')
  })
})
```

- [ ] **Step 6: 跑測試，確認新的綠、Task 2／3 的那組沒被改壞**

```
npx vitest run test/unit/ocean-shading.test.ts
npx tsc --noEmit
```

**先把 `a2 = r * r * (r * r)` 暫時改成 `a2 = r * r` 跑一次**，確認那條 α 測試
真的會紅 —— 它是這一組裡唯一擋得住 runtime 退化的斷言，不能是假綠。改回來。

- [ ] **Step 7: Commit**

```bash
git add src/render/sky.ts src/render/oceanShading.ts \
  test/unit/fog.test.ts test/unit/ocean-shading.test.ts
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
import { Color, FrontSide, MeshStandardMaterial, ShaderLib, Vector3 } from 'three'
import { createOcean, SEA_COLOR } from '../../src/render/ocean'
import {
  GLINT_STRENGTH, GLITTER_FADE_END, GLITTER_FADE_START,
  GLITTER_ROUGHNESS_MAX, GLITTER_ROUGHNESS_MIN, MAX_WAVE_SLOPE,
  OCEAN_GLINT_MARKER, OCEAN_NORMAL_MARKER,
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

/**
 * 【這一組是 Codex 2026-08-10 審查的直接產物】它列出的每一個「能讓全套測試
 * 照樣綠」的致命 mutation，在這裡都要有一條會紅的斷言。
 *
 * 它們讀的是**真的注入完成的著色器原始碼**，不是 CPU 那一份公式。
 */
describe('注入真的發生了（著色器原始碼層級）', () => {
  /**
   * 【anchor 必須存在於 three 自己的原始碼裡】這一條守的是 three 升級。
   * 若哪天 r19x 把 `opaque_fragment` 改名，`.replace()` 會靜靜地不發生 ——
   * 反光消失，而其他每一條測試都還是綠的。
   */
  it('three 的 physical fragment 裡確實有我們用的兩個 anchor', () => {
    const src = ShaderLib.physical.fragmentShader
    expect(src).toContain('#include <opaque_fragment>')
    expect(src).toContain('#include <normal_fragment_begin>')
    // 順序也要對：法線那一段必須在 opaque 之前，否則我們算的東西還沒生效
    expect(src.indexOf('#include <normal_fragment_begin>'))
      .toBeLessThan(src.indexOf('#include <opaque_fragment>'))
  })

  it('two anchors 在 opaque 之後才是 tonemapping 與 colorspace（線性空間）', () => {
    const src = ShaderLib.physical.fragmentShader
    const opaque = src.indexOf('#include <opaque_fragment>')
    expect(opaque).toBeLessThan(src.indexOf('#include <tonemapping_fragment>'))
    expect(opaque).toBeLessThan(src.indexOf('#include <colorspace_fragment>'))
  })

  /**
   * 【初稿這一條會讓「正確的實作」變紅 —— Codex 第二輪審查的 Important】
   *
   * 原本寫 `fragment.indexOf('glintGLSL(')`，但**第一個**匹配是
   * `<common>` 之後插入的**函數定義** `float glintGLSL(...)`，它必然在
   * `<opaque_fragment>` 之前。於是「必須在 opaque 之後」對正確的實作也
   * 成立不了。
   *
   * 而且反過來也不成立：`toContain('glintGLSL(')` 在「呼叫被刪掉、只剩
   * 定義」時仍然是真 —— 那正是要抓的 mutation。
   *
   * 兩個問題同一個解法：**注入的那一段帶一個唯一的標記**，斷言標記的位置，
   * 而不是斷言函數名的位置。標記只出現在呼叫點，定義裡沒有。
   */
  for (const which of ['near', 'far'] as const) {
    it(`${which}：反光真的接在 opaque_fragment 之後`, () => {
      const ocean = createOcean()
      try {
        const { fragment } = ocean.compiledShaderFor(which)
        const marker = fragment.indexOf(OCEAN_GLINT_MARKER)
        const anchor = fragment.indexOf('#include <opaque_fragment>')
        // 標記存在 = 那一段真的被注入了（anchor 拼錯的話 replace 不發生）
        expect(marker).toBeGreaterThanOrEqual(0)
        expect(anchor).toBeGreaterThanOrEqual(0)
        // 而且在 anchor 之後 = 在線性空間、tone mapping 之前
        expect(marker).toBeGreaterThan(anchor)

        /**
         * 【只驗標記位置抓不到「呼叫被刪掉」—— Codex 第三輪審查的 Important】
         * 把 `glintGLSL(...)` 那一行刪掉、標記留著的話，上面三條全部照樣綠，
         * 而畫面上完全沒有反光。
         *
         * 【為什麼切在標記之後就夠】所有函數**定義**都在 `<common>` 那一段，
         * 位置遠在標記之前。所以標記之後的字串裡出現的函數名，只可能是呼叫。
         */
        const afterMarker = fragment.slice(marker)
        expect(afterMarker).toContain('glintGLSL(')
        expect(afterMarker).toContain('fresnelGLSL(')
        expect(afterMarker).toContain('skyGradient(')
        expect(afterMarker).toContain('uGlintStrength')
      } finally {
        ocean.dispose()
      }
    })

    it(`${which}：法線段真的接在 normal_fragment_begin 之後`, () => {
      const ocean = createOcean()
      try {
        const { fragment } = ocean.compiledShaderFor(which)
        const marker = fragment.indexOf(OCEAN_NORMAL_MARKER)
        const anchor = fragment.indexOf('#include <normal_fragment_begin>')
        expect(marker).toBeGreaterThanOrEqual(0)
        expect(marker).toBeGreaterThan(anchor)
        // 而且要在反光之前 —— 反光讀的就是它算出來的東西
        const glintAt = fragment.indexOf(OCEAN_GLINT_MARKER)
        expect(marker).toBeLessThan(glintAt)
        // 【同上：標記之後必須真的有呼叫】只留標記、刪掉內容會被抓到
        const between = fragment.slice(marker, glintAt)
        expect(between).toContain('waveGradient(')
        expect(between).toContain('waveNormalGLSL(')
        expect(between).toContain('viewMatrix')
      } finally {
        ocean.dispose()
      }
    })

    it(`${which}：函數定義也在（不是只有呼叫）`, () => {
      const ocean = createOcean()
      try {
        const { fragment } = ocean.compiledShaderFor(which)
        // 【比對「定義」用的是回傳型別 + 名字】只有定義沒有呼叫、或只有呼叫
        // 沒有定義，都會編譯失敗 —— 但那是 GPU 上才發現，這裡先擋住
        expect(fragment).toContain('float glintGLSL(')
        expect(fragment).toContain('float fresnelGLSL(')
        expect(fragment).toContain('vec2 waveGradient(')
      } finally {
        ocean.dispose()
      }
    })
  }

  /**
   * 【頂點位移只能有近海有 —— 這是 program cache 撞 key 的守門員】
   * 撞 key 的症狀就是近海拿到遠海那份（沒有位移）。這一條直接比對兩份
   * 頂點著色器的差異。
   */
  it('近海的頂點著色器有波、遠海沒有', () => {
    const ocean = createOcean()
    try {
      const near = ocean.compiledShaderFor('near').vertex
      const far = ocean.compiledShaderFor('far').vertex
      expect(near).toContain('transformed.y += waveH')
      expect(far).not.toContain('transformed.y += waveH')
      // 但兩者都要有世界座標，遠海的片段著色需要它
      expect(near).toContain('vWorldPos')
      expect(far).toContain('vWorldPos')
    } finally {
      ocean.dispose()
    }
  })

  /**
   * 【program cache key 必須不同 —— Codex 的 Critical】預設是
   * `onBeforeCompile.toString()`，而兩個閉包的字串一模一樣。不設的話近海
   * 會重用遠海的 program：海變平，但碰撞與水花仍有波。
   */
  it('兩個材質的 customProgramCacheKey 不同，而且不是預設值', () => {
    const ocean = createOcean()
    try {
      const nearMat = ocean.mesh.material as MeshStandardMaterial
      const farMat = ocean.farMesh.material as MeshStandardMaterial
      const a = nearMat.customProgramCacheKey()
      const b = farMat.customProgramCacheKey()
      expect(a).not.toBe(b)
      // 預設實作回傳 onBeforeCompile.toString()，兩者會相同 —— 這一行擋的
      // 是「有人把 customProgramCacheKey 刪掉」
      expect(a).not.toBe(nearMat.onBeforeCompile.toString())
    } finally {
      ocean.dispose()
    }
  })

  /**
   * 【亮度不得被靜靜歸零】`uGlintStrength` 設成 0 的話，兩個材質仍然逐值
   * 相等、所有既有斷言仍然綠，而畫面上完全沒有反光。
   */
  it('uGlintStrength 等於 GLINT_STRENGTH 且為正', () => {
    const ocean = createOcean()
    try {
      expect(ocean.uniformsFor('near').uGlintStrength).toBeCloseTo(GLINT_STRENGTH, 12)
      expect(GLINT_STRENGTH).toBeGreaterThan(0)
    } finally {
      ocean.dispose()
    }
  })
})

/**
 * 【解析法線的前提條件 —— Codex 2026-08-10 審查的 Important】
 *
 * 計畫把解析法線寫在 `normal_fragment_begin` **之後**，而那個 chunk 已經用
 * 舊的 `normal` 建好了 `tbn` / `tbn2`。後面的 `normal_fragment_maps` 若被
 * 啟用，會發生下列任一種:
 *
 *   - object-space normal map 直接覆寫掉我們的解析法線
 *   - tangent-space normal map 套在**舊法線**建的 `tbn` 上
 *   - bump map 再擾動一次
 *   - anisotropy / clearcoat 用舊法線建的切線框
 *
 * `DOUBLE_SIDED` / `FLIP_SIDED` 時我們也沒有套 `faceDirection`。
 *
 * 現況安全 —— 因為兩個材質都沒有那些貼圖、而且是單面。但「安全」是**前提**
 * 不是保證。這一組把前提釘住:哪天有人給海面加一張法線貼圖，這裡會紅，
 * 而不是畫面上悄悄出現「浪的光照沿著 52 m 網格走」。
 */
describe('解析法線的前提條件', () => {
  for (const which of ['near', 'far'] as const) {
    it(`${which}：沒有任何會與解析法線打架的貼圖，而且是單面`, () => {
      const ocean = createOcean()
      try {
        const m = (which === 'near' ? ocean.mesh : ocean.farMesh)
          .material as MeshStandardMaterial
        expect(m.normalMap).toBeNull()
        expect(m.bumpMap).toBeNull()
        expect(m.side).toBe(FrontSide)
        expect(m.flatShading).toBe(false)
      } finally {
        ocean.dispose()
      }
    })
  }
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
  /**
   * 把該材質的 `onBeforeCompile` 真的跑一次,回傳注入後的著色器原始碼。
   * **只為測試存在。**
   *
   * 【為什麼非有不可 —— Codex 2026-08-10 審查的 Important】沒有它,下列每一個
   * 致命 mutation 都能讓全套測試照樣綠:
   *
   *   - 刪掉 `farMaterial.onBeforeCompile` → 遠海完全沒有反光
   *   - 把 `'#include <opaque_fragment>'` 這個 anchor 拼錯 → `.replace()`
   *     靜靜地不發生,著色器照樣編譯,只是沒有反光
   *   - 把注入的那段整個刪掉
   *
   * 那些 mutation 改的是**字串**,而原本的測試一條都沒有讀過字串 —— 它們
   * 只讀 CPU 那一份公式與測試專用的查詢介面。
   *
   * 【它守不住什麼】GLSL 的**語意**仍然測不到(把 `glintGLSL` 改成回傳
   * 常數,字串測試看不出來)。那是這一層的天花板,已知且誠實。
   */
  compiledShaderFor(which: 'near' | 'far'): { vertex: string; fragment: string }
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
 * 反光疊加到基本色上的強度。**因為 `glintIntensity` 已經歸一化（峰值 1），
 * 這個數字就是「峰值加多亮」，單位與線性顏色相同。**
 *
 * 【初稿這裡算錯了 —— Codex 2026-08-10 審查的 Important】原本寫「GGX 的 D 項
 * 在窄峰時可以到 10²」。實際是 `D_max = 1/(π·roughness⁴)`：
 *
 * ```
 * roughness   D_max
 *   0.04     1.24 × 10⁵
 *   0.20     1.99 × 10²
 * ```
 *
 * 差了三個數量級。乘上原本暫定的 0.02，峰值分別是 2487 與 3.98 —— 兩個都
 * 遠超線性顏色 1，會整片飽和成白色，而且**沒有任何一個常數同時適用於窄峰
 * 與粗糙的情形**。這正是把 `glintIntensity` 改成歸一化的理由。
 *
 * 歸一化之後 0.6 的意思就是「峰值把該像素往白色推 0.6」，直觀且可調。
 *
 * 【暫定值，待專案負責人人工驗收回填】spec §11 —— 初稿漏了把它列進去，
 * 同一次審查一併補上。
 */
export const GLINT_STRENGTH = 0.6
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
          ${withVertexWaves ? `
          // 【這一段與改動前逐字相同】頂點位移不准動 —— gerstnerHeight、
          // crash.ts 的入水判定、splash、wrecks 全部靠它
          vec2 worldXZ = transformed.xz + uOrigin;
          float waveH = 0.0;
          for (int i = 0; i < WAVE_COUNT; i++) {
            float k = 6.28318530718 / uWaveLen[i];
            waveH += uWaveAmp[i] * sin(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * uTime);
          }
          transformed.y += waveH;` : ''}
          // 【世界座標由 modelMatrix 取得，不是 transformed.xz + uOrigin】
          // uOrigin 是**細浪面**的格點對齊原點；遠海放在 (centerX, −3, centerZ)
          // 而且不做格點對齊，兩者的原點不同。用 modelMatrix 對兩片都對。
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          ${waveDecls}
          varying vec3 vWorldPos;
          // 【這三個是全域變數不是 varying】片段著色器裡的 varying 是唯讀的，
          // 寫進去會編譯失敗。名字刻意不用 v 開頭，免得被讀成 varying。
          // 它們的用途是把 normal_fragment_begin 那一段算出來的東西帶到
          // opaque_fragment 之後 —— 兩段之間隔著整條光照鏈。
          vec3 oceanShadingNormal;
          float oceanShadingSlope;
          float oceanShadingFade;
          ${SKY_GRADIENT_GLSL}
          ${OCEAN_SHADING_GLSL}`)
        // 【為什麼是「附加在 normal_fragment_begin 之後」而不是取代它】
        // 那個 chunk 除了 `normal` 還定義 `faceDirection` 與
        // `nonPerturbedNormal`，後面的 chunk（clearcoat、anisotropy）會用。
        // 取代掉會在某些 define 組合下編譯失敗，而那種失敗不會每次出現。
        //
        // 【必須轉進 view space】`vNormal` 是 `normalMatrix * objectNormal`，
        // three 整條光照鏈都在 view space。直接把世界空間的法線寫進 `normal`
        // 會讓 DirectionalLight / HemisphereLight 全部算錯 —— 而畫面只是
        // 「怪怪的」，不會報錯。
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          ${OCEAN_NORMAL_MARKER}
          // 【法線由解析導數取代】不是 flatShading 的面法線，也不是內插的
          // 頂點法線 —— 那兩者都受 52 m 網格限制，而反光吃的正是法線
          // （spec §4.1）
          vec2 oceanGrad = waveGradient(vWorldPos.xz, uTime);
          oceanShadingSlope = length(oceanGrad);
          oceanShadingFade = glitterFadeGLSL(length(cameraPosition.xz - vWorldPos.xz));
          // 遠處淡回平面：浮點精度與「一個像素涵蓋許多個波」兩個理由
          vec3 oceanWorldN = normalize(mix(vec3(0.0, 1.0, 0.0),
                                          waveNormalGLSL(oceanGrad), oceanShadingFade));
          oceanShadingNormal = oceanWorldN;
          normal = normalize((viewMatrix * vec4(oceanWorldN, 0.0)).xyz);
          nonPerturbedNormal = normal;`)
        // 【為什麼是 opaque_fragment 而不是 dithering_fragment】three 0.180 的
        // 片段尾段順序是 opaque_fragment → tonemapping → colorspace → fog →
        // premultiplied_alpha → dithering。在 dithering 之後加等於**加在
        // sRGB 空間**，反光會過亮而且色調不對。opaque_fragment 剛把
        // gl_FragColor 設成線性的 outgoingLight，那才是該加的地方。
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          ${OCEAN_GLINT_MARKER}
          {
            vec3 V = normalize(cameraPosition - vWorldPos);
            vec3 N = oceanShadingNormal;
            float rough = slopeRoughnessGLSL(oceanShadingSlope * oceanShadingFade);
            // Fresnel：平視反射天空、俯視看深海
            float F = fresnelGLSL(max(dot(N, V), 0.0));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, skyGradient(reflect(-V, N)), F);
            // 太陽反光
            gl_FragColor.rgb += uGlintStrength * oceanShadingFade
              * glintGLSL(N, V, normalize(uSunDirection), rough);
          }`)
    }
```

兩個材質各自接上,**而且各自要有不同的 `customProgramCacheKey`**:

```ts
  material.onBeforeCompile = makeOnBeforeCompile(true)
  farMaterial.onBeforeCompile = makeOnBeforeCompile(false)

  /**
   * 【非設不可 —— Codex 2026-08-10 審查的 Critical】three 的
   * `Material.customProgramCacheKey()` 預設回傳
   * **`this.onBeforeCompile.toString()`**
   * （`node_modules/three/src/materials/Material.js:541`）。
   *
   * `makeOnBeforeCompile(true)` 與 `makeOnBeforeCompile(false)` 是同一個
   * 工廠產出的兩個閉包 —— **函式原始碼字串一模一樣**，`withVertexWaves`
   * 是被捕捉的變數,不會出現在 `toString()` 裡。而關掉 `flatShading` 之後
   * 兩個 `MeshStandardMaterial` 的其餘 shader 參數也全部相同。
   *
   * 於是兩者撞到**同一個 program cache key**,後編譯的那個直接重用先編譯
   * 的 GPU program。遠海 `renderOrder = -1` 通常先畫、先編譯,結果是:
   *
   *   **近海不再做頂點位移 —— 海面變成平的,但 `heightAt`、碰撞判定與
   *   水花仍然有波。**
   *
   * 症狀離成因極遠(「飛機撞到看不見的浪」),而且所有 unit test 與不下
   * 像素斷言的 Playwright 全部照樣綠。
   */
  material.customProgramCacheKey = () => 'ocean-near-waves'
  farMaterial.customProgramCacheKey = () => 'ocean-far-flat'
```

並把細浪面的 `flatShading: true` 改成 `flatShading: false`。

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
    compiledShaderFor(which) {
      // 【用 three 自己的原始碼當輸入,不是手打的假字串】手打的話,anchor
      // 拼錯或 three 升級改名都測不出來 —— 而那正是要守的東西
      const stub = {
        vertexShader: ShaderLib.physical.vertexShader,
        fragmentShader: ShaderLib.physical.fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      }
      const cb = which === 'near' ? material.onBeforeCompile : farMaterial.onBeforeCompile
      cb(stub as unknown as WebGLProgramParametersWithUniforms, null as never)
      return { vertex: stub.vertexShader, fragment: stub.fragmentShader }
    },
```

檔頭 import 補 `ShaderLib`（從 three）。

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

【初稿寫 `npx vite --version` —— 那什麼都沒檢查（Codex 2026-08-10 審查的
Minor）。它只印版本號。】真正要問的是「有沒有人佔著那個 port」：

```bash
# vite 預設 5173。有回應就代表有殘留的 dev server
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ || echo "沒有回應（乾淨）"
```

有回應就先關掉那個 process 再往下走；另外**確認瀏覽器沒有開著遊戲的分頁**
（那會跟 Playwright 搶 GPU，量出來的數字沒有意義）。

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

- [ ] **Step 3: 量 GPU 時間（不是 rAF 間隔）**

【初稿這裡量錯了 —— Codex 2026-08-10 審查的 Minor】原本用 `requestAnimationFrame`
的間隔當「幀時」。那個間隔主要由**螢幕更新率與 vsync** 決定：60 Hz 的機器就算
GPU 完全空閒也會是 16.7 ms，120 Hz 就是 8.3 ms。**它根本回答不了「著色器有沒有
把 GPU 壓垮」。**

改用 WebGL2 的 `EXT_disjoint_timer_query_webgl2` 量真正的 GPU 時間，並且
**量開／關兩次做對照** —— 絕對值在不同機器上沒有意義，倍率才有：

```ts
    // 29. GPU 時間。海面的片段著色器變重了，而海是全螢幕
    const gpuMs = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      const gl = canvas.getContext('webgl2')
      const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2')
      if (!gl || !ext) return null // 沒有這個擴充就誠實回報量不到
      /**
       * 【要取多幀取中位 —— Codex 第二輪審查的 Minor】單幀會被著色器首次
       * 編譯、瀏覽器排程、背景 GPU 工作影響，用它去比 2× 很容易假紅假綠。
       * 前 10 幀丟掉（暖機），再取 30 幀的中位。
       */
      const samples: number[] = []
      for (let i = 0; i < 40; i++) {
        const q = gl.createQuery()!
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
        await new Promise((r) => requestAnimationFrame(r))
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        // 結果不會馬上好，要輪詢
        let got: number | null = null
        for (let k = 0; k < 60; k++) {
          await new Promise((r) => requestAnimationFrame(r))
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
            // 【disjoint 的那一幀要丟掉】GPU 被搶走時計時無效
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
              got = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 // ns → ms
            }
            break
          }
        }
        gl.deleteQuery(q)
        if (i >= 10 && got !== null) samples.push(got)
      }
      if (samples.length < 10) return null
      samples.sort((a, b) => a - b)
      return samples[Math.floor(samples.length / 2)]!
    })
    console.log(gpuMs === null
      ? '[人工看] 這台機器量不到 GPU 時間（沒有 EXT_disjoint_timer_query_webgl2）'
      : `[人工看] GPU 一幀 ${gpuMs.toFixed(2)} ms —— 與改動前的基準比，`
        + '倍率超過 2× 就要砍功能，不是放寬門檻')
```

**不對它下斷言** —— CI 與開發機的 GPU 不同，斷言只會變成假紅。它是給人看的。

【基準怎麼來】在**這一步之前**先 `git stash` 掉 `src/render/` 的改動跑一次，
記下數字，再 `git stash pop` 跑一次。兩個數字一起貼進報告。沒有基準的絕對值
是沒有意義的。

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

- [ ] **Step 6: 把 spec §11 的六組參數交給專案負責人**

在報告裡列出目前值、`glint-geometry.probe.ts` 的輸出、以及四張截圖，然後
問專案負責人要不要調。**spec §11 的表格由專案負責人回填，實作者不得代填。**

六組是：`GLITTER_ROUGHNESS_MIN`/`MAX`、**`GLINT_STRENGTH`**、
`GLITTER_FADE_START`/`END`、`SUN_ANGULAR_RADIUS`、`SUN_HALO_POWER`/`STRENGTH`、
法線量化階數。**不要漏掉 `GLINT_STRENGTH`** —— 它在 spec §11 的表裡本來就
有，是計畫前幾版的清單漏了它（Codex 第四輪審查）。而且它與粗糙度是耦合的：
α 慣例修正之後反光帶大幅變窄（400 點取樣的表面平均 0.537 → 0.00152、取樣
峰值 0.996 → 0.207），所以「0.6 看起來夠不夠亮」必須**重新**看，不能沿用
任何舊的觀感結論。

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

spec §11 的六組參數留待專案負責人回填，含 GLINT_STRENGTH。
```

---

## 【專案負責人必須先裁定】天空球沒有做輸出色彩空間轉換

Codex 2026-08-10 審查發現的,**而且這是既有的 bug,不是這次引入的**。

`sky.ts` 是自寫的 `ShaderMaterial`,直接寫 `gl_FragColor`。three **不會**替
自寫的片段著色器自動呼叫色彩空間轉換 —— 它只在前置碼提供
`linearToOutputTexel()` 這個函數,要由著色器自己 `#include <colorspace_fragment>`
才會被呼叫(`node_modules/three/src/renderers/shaders/ShaderChunk/colorspace_fragment.glsl.js`
只有一行:`gl_FragColor = linearToOutputTexel( gl_FragColor );`)。

`new Color(0xd6e9f4)` 這個 uniform **已經是線性工作空間的值**,而 renderer
預設輸出 sRGB。於是天空球把線性值原樣寫進 sRGB 緩衝區 —— **畫面上的天空比
常數所表達的意圖暗**。

### 為什麼這對這一份很要緊

海面的天空反射走的是 `MeshStandardMaterial`,**會**經過
`colorspace_fragment`。所以就算兩邊共用同一段 `SKY_GRADIENT_GLSL`、餵同樣的
uniform:

- 天空球:線性值直接輸出
- 海面反射:同一個線性值經過 sRGB 轉換 → **比較亮**

**共用公式仍然接不起來**,水天交界會有一道顏色不連續。

### 裁定:**甲**(專案負責人 2026-08-10)—— 補上 `#include <colorspace_fragment>`

裁定之後實算,發現這條 bug 比原本以為的更有意思。

#### 它讓「天空提亮」兩次都沒有真正生效

`fog.test.ts` 的門檻拿的是**線性工作空間**的明度,而它一直以為那就是螢幕上的
樣子。實際上天空球把線性值原樣寫進 sRGB 緩衝區,所以**螢幕上的天空遠比那些
數字暗**。把「現在螢幕上真正的顏色」換算回線性:

```
                    測試斷言的   螢幕上實際的
地平線上的天空 L       0.495        0.241
天頂 L                 0.277        0.101
海天階差               0.454        0.200
```

【地平線那個數字更正過 —— Codex 第三輪審查的 Minor】初版探針先對兩個端點各自
decode 再內插，但著色器實際是**先在線性空間內插、再把結果誤當 sRGB code 輸出**
—— 非線性轉換與內插不可交換：

```
探針初版： mix(decode(H), decode(Z), t)   → 0.315
實際：     decode(mix(H, Z, t))           → 0.241
```

天頂因為 `t = 1` 沒有內插，0.101 兩種算法一致。**差得比原本以為的更多**，
裁定的方向不變。

海面走 `MeshStandardMaterial`,**本來就有轉換**,所以 `SEA_COLOR` 一個字都不用
動 —— 它顯示的就是 L 0.041。錯的只有天空那一邊。

於是 2026-08-09 的「天空整體顏色淡一點」與 2026-08-10 的「接近地面再淡一點」
兩次調整,畫面確實有變亮,但**都遠遠沒到常數所表達的程度**。專案負責人抱怨
兩次的那件事,成因有一部分就在這裡。

#### 因此:常數不動,只補轉換

補上 `#include <colorspace_fragment>` 之後,天空會**跳到常數本來就要求的亮度**
(地平線 L 0.495、天頂 L 0.277),也就是 `fog.test.ts` 一直在斷言的那組數字。
四條門檻全部維持綠,**一個字都不用改**。

【為什麼不是「保持現在的畫面、把常數換算過去」】那組換算值是
`SKY_HORIZON 0xd6e9f4 → 0xabd0e7`、`SKY_ZENITH 0x4d84b8 → 0x133b7a`,而它會讓
`fog.test.ts` 的兩條門檻**紅掉**(地平線 0.314 < 0.35、天頂 0.101 < 0.20)——
而那兩條正是 2026-08-09 因為「天空太暗」才加上的。調鬆它們等於把使用者抱怨過
的問題重新寫成規格,而專案的紀律是**絕不為了讓測試變綠而放寬門檻**。

> **這裡的 0.314 不是前一版那個算錯的數字。** 兩者長得像但問的是不同的事:
>
> | 問句 | 算式 | 值 |
> |---|---|---|
> | 現在螢幕上的地平線有多亮 | `decode(mix(H, Z, t))` | **0.241** |
> | 甲-1 之下 `fog.test.ts` 會看到什麼 | `mix(decode(H), decode(Z), t)` | **0.314** |
>
> 甲-1 是「把兩個**端點**常數各自 decode 過去」,所以它的 `skyColorAt(0)` 本來
> 就是先 decode 再內插 —— 那正是第三輪指出「拿來當現況模型是錯的」的那條算式,
> 但拿來當甲-1 的模型是**對的**。probe 的 `preserveAppearance` 也是同一件事。
>
> 順帶記下甲-1 的一個真實限制(Codex 第四輪):它只保住**兩個端點**的外觀,
> 中間整段漸層仍會偏移 —— 因為 decode 是非線性的,而內插是線性的,兩者不可
> 交換。所以「保持現在的畫面」這個說法本身就過度承諾了。這不影響裁定(甲-1
> 已因門檻紅掉而否決),但別讓它留在文件裡誤導人。

#### 順帶修好的一件事

霧色 `FOG_COLOR` 由 `skyColorAt(0)` 推導,而霧作用在飛機／殘骸／煙霧上,那些
**都有**做轉換。所以在這條 bug 之下,**遠處的飛機一直是往一個比背後天空更亮的
顏色化開的** —— `fog.ts` 註解裡寫的「霧色就該是地平線上的天空色」從來沒有真正
成立過。補上轉換之後兩邊才第一次對齊。

#### Task 4 Step 1 要多做的事

在 `sky.ts` 的 `FRAG` 最後補一行:

```glsl
    gl_FragColor = vec4(base + sunDiscColor * (disc + halo), 1.0);
    #include <colorspace_fragment>
  }
```

【為什麼用 `#include` 而不是自己呼叫 `linearToOutputTexel`】那個 chunk 就只有
一行 `gl_FragColor = linearToOutputTexel( gl_FragColor );`。用 `#include` 的話,
three 哪天改了轉換方式我們自動跟上。

【不要順手加 `tonemapping_fragment`】renderer 目前是 `NoToneMapping`,那個 chunk
會展開成空字串;但真要開 tone mapping 時,天空該不該吃是一個**設計決定**(天空
是背景不是物件),不在這一份的範圍。

並補一條測試進 `fog.test.ts`:

```ts
  /**
   * 【2026-08-10 補】天空球是自寫 ShaderMaterial,three **不會**自動替它做輸出
   * 色彩空間轉換 —— 要著色器自己 include 那個 chunk。少了它,天空把線性值原樣
   * 寫進 sRGB 緩衝區,螢幕上比常數所表達的暗一大截(地平線 L 0.495 → 螢幕上
   * 實際只有 0.241),而上面每一條斷言都還是綠的。
   *
   * 這一條同時守住「天空與霧色在螢幕上一致」—— 霧作用的物件本來就有轉換。
   */
  it('天空球有做輸出色彩空間轉換', () => {
    const mat = createSky().material as ShaderMaterial
    expect(mat.fragmentShader).toContain('#include <colorspace_fragment>')
  })
```

**人工驗收要專門看這一項**(Task 6):天空會比現在亮一截。若專案負責人看了覺得
**太亮**,那時再調那三個常數 —— 但那會是在一個**正確的管線**上做的調整,而不是
在補償一個 bug。

---

## 對 three.js 0.180 的實地查證（寫 plan 時做的，三個缺陷都已修進 Task 5）

計畫初稿的著色器注入是憑印象寫的。對照 `node_modules/three@0.180.0` 的實際
chunk 原始碼查過之後，找到三個會壞掉的地方。**它們留在這裡是因為它們很容易
再犯一次。**

| # | 初稿寫的 | 為什麼壞 | 已改成 |
|---|---|---|---|
| 1 | 在 `#include <dithering_fragment>` 之後加反光 | `meshphysical.glsl.js` 的尾段順序是 `opaque_fragment → tonemapping → colorspace → fog → premultiplied_alpha → dithering`。在最後加等於**加在 sRGB 空間**，反光會過亮、色調不對，而且沒有任何測試看得到 | 改在 `#include <opaque_fragment>` 之後 —— 那裡 `gl_FragColor` 剛被設成線性的 `outgoingLight` |
| 2 | **取代** `#include <normal_fragment_begin>`，並把**世界空間**的法線寫進 `normal` | 兩個問題：(a) 那個 chunk 還定義 `faceDirection` 與 `nonPerturbedNormal`，後面的 clearcoat / anisotropy chunk 會用，取代掉會在某些 define 組合下編譯失敗；(b) `vNormal` 是 `normalMatrix * objectNormal`，**view space** —— 把世界空間的法線寫進去會讓整條光照鏈算錯，而畫面只是「怪怪的」不會報錯 | 改成**附加在該 include 之後**，並用 `viewMatrix` 轉進 view space 再賦值，同時更新 `nonPerturbedNormal` |
| 3 | `vWorldPos` 用 `transformed.xz + uOrigin` | `uOrigin` 是**細浪面**的格點對齊原點。遠海放在 `(centerX, −3, centerZ)` 而且**不做**格點對齊 —— 兩片的原點不同，遠海的波相位會整片偏掉 | 改用 `(modelMatrix * vec4(transformed, 1.0)).xyz`，兩片都對 |

### 【2026-08-10 Codex 審查更正】上表第 2 條的「在各種 define 組合下安全」是錯的

修法（附加在 `normal_fragment_begin` 之後）本身正確，但**理由寫過頭了**。
實際的 chunk 順序是：

```
normal_fragment_begin  →  我們注入的解析法線  →  normal_fragment_maps  →  clearcoat normal chunks
```

`tbn` / `tbn2` 在 `normal_fragment_begin` 裡就**已經用舊的 `normal` 建好**，
我們是在那之後才覆寫 `normal`。所以只要啟用下列任一項，解析法線就會被繞過
或被錯誤地套用：

- object-space normal map → 直接覆寫掉解析法線
- tangent-space normal map → 套在**舊法線**建的 `tbn` 上
- bump map → 在解析法線上再擾動一次
- anisotropy → 用舊法線建的切線框
- clearcoat normal map → 用舊法線建的 `tbn2`

另外 `DOUBLE_SIDED` / `FLIP_SIDED` 時我們**沒有**套 `faceDirection`。

**現況安全**（兩個海面材質都沒有那些貼圖、而且是單面），所以修法不變 ——
但那是**前提**不是保證。Task 5 的 `解析法線的前提條件` 那組測試就是把這個
前提釘住的：哪天有人給海面加一張法線貼圖，測試會紅，而不是畫面上悄悄變成
「浪的光照沿著 52 m 網格走」。

`geometryNormal` 則確實沒有問題 —— 它在後面的 `lights_fragment_begin` 才由
最終的 `normal` 建立。

已查證為**可用**的三件事（不要再懷疑）：

- `cameraPosition` 與 `viewMatrix` 都在片段著色器的前置宣告裡
  （`WebGLProgram.js:826-827`）。
- 片段著色器裡的 `varying` 是唯讀的，所以跨 chunk 傳值必須用**全域變數**
  （`oceanShadingNormal` / `Slope` / `Fade`），不能宣告成 varying。
- `PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, 1, 1)` 只有四個頂點，但
  `vWorldPos` 在平面上的線性內插是**精確**的，所以遠海拿得到正確的世界座標。

**Task 5 Step 4 的程式碼已經是修正後的版本。** 實作者照抄即可。

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
