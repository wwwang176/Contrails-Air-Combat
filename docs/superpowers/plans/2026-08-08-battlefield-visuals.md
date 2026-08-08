# 戰場視覺三則 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓海延伸到地平線、翼尖在高 G 時拉出凝結尾、螺旋槳從正面也看得到。

**Architecture:** 三件事實作上完全獨立。海是「現有 10 km 細浪面不動 + 底下墊一片
500 km 的平海 + FogExp2 + 相機遠平面拉大」；凝結尾是一個新的 `src/render/vortex.ts`，
沿用既有的 `createParticles` 粒子池，判準吃 `diag.loadFactor`；螺旋槳是
`assembly.ts` 的一個材質加 `side: DoubleSide`。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess`）、three.js、vitest、Playwright、Vite。

**Spec:** `docs/superpowers/specs/2026-08-08-battlefield-visuals-design.md`

## Global Constraints

- 語言：所有註解、測試名稱、commit message 一律**繁體中文**。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已被改過的檔案。一律指定明確路徑。
- **不得引入 `@types/node`**：不可用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 開著，**`Float32Array` / `Uint8Array` 的索引一樣要處理**（`arr[i]!`）。
- `noUnusedLocals` / `noUnusedParameters` 開著。
- 分層：`src/world/` 不得 import `src/render/` 或 `src/hud/`；`src/ai/` 不得 import `src/battle/`；
  **`src/render/vortex.ts` 不得 import `src/battle/`、`src/ai/`、`src/hud/`**；
  **`src/render/fog.ts` 不得 import `scene.ts`**（方向是 `scene.ts → fog.ts`）。
- **熱路徑不得配置**（每幀、每步跑到的程式碼不得 `new`）。
- **絕不為了讓測試變綠而放寬門檻。** 每一條新測試都要先驗證它是紅的。
- **絕不用 PowerShell 讀寫含中文的檔案**（用 Read 工具，或 Python 的 `io.open(..., encoding='utf-8')`）。
- 含中文的 commit message 一律寫進 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`。
- 型別檢查指令是 `npx tsc --noEmit`（**沒有** `npm run typecheck`）。
- `perf-gate` 與 `rematch.test.ts` 必須**單獨跑**。
- **不寫飛機外形的測試**（`test/unit/geometry.test.ts` 檔頭的三條裁決）。本計畫新增的
  幾何測試只屬於「產生器的機制」與「跨模組一致性」兩類。
- 參數的重新定值是**專案負責人**的決定，不是實作者的 —— 紅了要先量、先報告、先問。

---

### Task 1：螺旋槳模糊圓盤兩面都畫

**Files:**
- Modify: `src/render/geometry/assembly.ts:197`
- Test: `test/unit/geometry.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: 無（純缺陷修正，對外介面不變）

- [ ] **Step 1: 寫會紅的測試**

在 `test/unit/geometry.test.ts` 的最後、`describe` 之外的同一層加一個新 `describe`。
檔頭 import 要補 `CircleGeometry` 與 `DoubleSide`（`Mesh`、`Vector3` 已經有了）：

```ts
import { BufferGeometry, CircleGeometry, DoubleSide, Mesh, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
```

```ts
/**
 * 【為什麼這條不是造型測試】它測的是材質的一個布林旗標，改壞了的症狀是
 * 「螺旋槳整個不見」而不是「不好看」—— 屬於檔頭裁決留下的「產生器的機制」。
 *
 * 【它守的是什麼】圓盤是 CircleGeometry，法線指 +Z，而機首朝 −Z。材質若是
 * FrontSide（MeshStandardMaterial 的預設），圓盤**只有從飛機後方畫得出來**；
 * 而油門 > 0.15 時 setPropSpin 會把槳葉全部藏起來。兩件事合起來 = 從前方看
 * 螺旋槳整個不存在。座艙相機永遠在圓盤後面，所以這個缺陷從 M1 活到上帝視角
 * 才被發現。
 */
describe('螺旋槳模糊圓盤', () => {
  for (const [name, spec] of [['P-51D', P51D], ['Bf 109 G-6', BF109G6]] as const) {
    it(`${name}：圓盤兩面都畫得出來`, () => {
      const m = buildAircraft(spec)
      let disc: Mesh | undefined
      m.group.traverse((o) => {
        const mesh = o as Mesh
        if (mesh.userData['spinning'] && mesh.geometry instanceof CircleGeometry) disc = mesh
      })
      expect(disc).toBeDefined()
      expect((disc!.material as MeshStandardMaterial).side).toBe(DoubleSide)
      m.dispose()
    })
  }
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/geometry.test.ts
```
預期：兩條新測試紅，訊息是 `expected 0 to be 2`（`FrontSide` 是 0、`DoubleSide` 是 2）。
**若它一開始就綠，停下來報告** —— 那表示 spec §2.3 的診斷錯了。

- [ ] **Step 3: 改材質**

`src/render/geometry/assembly.ts`，先在檔頭的 three import 裡加 `DoubleSide`，
再把 `blur` 改成：

```ts
  /**
   * 模糊圓盤的材質。
   *
   * 【`side: DoubleSide` 非有不可】`CircleGeometry` 的法線指 +Z，而機首朝
   * −Z —— 預設的 `FrontSide` 讓圓盤**只有從飛機後方才畫得出來**。而
   * `setPropSpin` 在 blurred 時會把槳葉全部藏起來（見下方），所以油門一過
   * 0.15，從前方或斜前方看螺旋槳就整個不存在。
   *
   * 座艙相機永遠在圓盤後方，所以這個缺陷從 M1 活到上帝視角才被看見 ——
   * 那是第一個會從機頭方向看自己飛機的視角。
   */
  const blur = new MeshStandardMaterial({
    color: 0xc8d0d8, transparent: true, opacity: 0.22, roughness: 0.5,
    depthWrite: false, side: DoubleSide,
  })
```

**不要動** `PROP_DISC_RENDER_ORDER`、`depthWrite: false`、`opacity: 0.22` ——
那三個是為了曳光彈與圓盤的混合順序（:150–165 的長註解），與正反面無關。
**不要動槳葉**：blurred 時隱藏槳葉是刻意的。

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/geometry.test.ts test/unit/hitbox.test.ts
```
預期：全綠。`hitbox.test.ts` 一起跑是因為它靠 `userData.spinning` 排除圓盤 ——
確認那條路徑沒被動到。

- [ ] **Step 5: 型別檢查與提交**

```
npx tsc --noEmit
```

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
fix: 螺旋槳模糊圓盤兩面都畫

CircleGeometry 的法線指 +Z 而機首朝 −Z，材質沒設 side（預設 FrontSide）
於是圓盤只有從飛機後方畫得出來。而油門 > 0.15 時 setPropSpin 會把槳葉
全部藏起來 —— 兩件事合起來的結果是：從前方或斜前方看，螺旋槳整個不存在。

座艙相機永遠在圓盤後面，所以這個缺陷從 M1 活到現在；上帝視角是第一個會
從機頭方向看自己飛機的視角，專案負責人在試飛時回報「螺旋槳好像只畫到
一邊」。

renderOrder、depthWrite、opacity 都沒動 —— 那三個守的是曳光彈與圓盤的
混合順序，與正反面無關。槳葉也沒動。

測試測的是材質的 side 旗標，屬於 geometry.test.ts 檔頭裁決留下的「產生器
的機制」，不是造型。
EOF
git add src/render/geometry/assembly.ts test/unit/geometry.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 2：霧 + 天空常數具名 + 相機遠平面

**Files:**
- Create: `src/render/fog.ts`
- Modify: `src/render/sky.ts`（抽出兩個顏色常數、更新遠平面的註解）
- Modify: `src/render/scene.ts`（掛霧、遠平面常數化）
- Test: `test/unit/fog.test.ts`（新）

**Interfaces:**
- Produces:
  - `src/render/fog.ts`：`FOG_COLOR: number`、`FOG_DENSITY: number`、
    `fogFactor(distance: number, density: number): number`、`createFog(): FogExp2`
  - `src/render/sky.ts`：`SKY_HORIZON: number`、`SKY_ZENITH: number`（Task 2 的測試要用）
  - `src/render/scene.ts`：`CAMERA_NEAR: number`、`CAMERA_FAR: number`（Task 3 的測試要用）

- [ ] **Step 1: 寫會紅的測試**

建立 `test/unit/fog.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createFog, fogFactor, FOG_COLOR, FOG_DENSITY } from '../../src/render/fog'
import { SKY_HORIZON } from '../../src/render/sky'
import { CAMERA_FAR } from '../../src/render/scene'
import { FAR_SEA_SIZE } from '../../src/render/ocean'

describe('fogFactor', () => {
  it('零距離沒有霧', () => {
    expect(fogFactor(0, FOG_DENSITY)).toBe(0)
  })

  it('隨距離單調遞增且不超過 1', () => {
    let prev = -1
    for (let d = 0; d <= 400_000; d += 5_000) {
      const f = fogFactor(d, FOG_DENSITY)
      expect(f).toBeGreaterThanOrEqual(prev)
      expect(f).toBeLessThanOrEqual(1)
      prev = f
    }
  })
})

/**
 * 【這一組把 spec §4.2 那張表變成會紅的東西】
 *
 * 密度是一個數字，而它同時決定三件相互拉扯的事：纏鬥距離內顏色不失真、
 * 上帝視角看得到整個戰場、遠海的邊緣化得掉。只斷言「有霧」的話，這三個
 * 後果沒有任何一個被守住 —— 有人為了讓遠方更朦朧把密度加十倍，近處的
 * 敵機會一起變灰，而沒有東西會紅。
 */
describe('霧的濃度落在設計意圖上', () => {
  it('5 km（纏鬥距離）幾乎沒有霧', () => {
    expect(fogFactor(5_000, FOG_DENSITY)).toBeLessThan(0.01)
  })

  it('30 km（上帝視角的全戰場）開始化開但仍看得清楚', () => {
    const f = fogFactor(30_000, FOG_DENSITY)
    expect(f).toBeGreaterThan(0.10)
    expect(f).toBeLessThan(0.25)
  })

  it('遠海邊緣完全化進霧色（才不會看到硬邊）', () => {
    expect(fogFactor(FAR_SEA_SIZE / 2, FOG_DENSITY)).toBeGreaterThan(0.999)
  })
})

/**
 * 【這一條守的是需求本身，不是實作細節】專案負責人的原話是「遠方可以考慮
 * FOG，但是要看得出地平線」。霧色若等於天空的地平色，遠海化進霧色之後就與
 * 天空完全同色 —— 地平線消失，而畫面上不會有任何錯誤。
 */
describe('地平線要看得出來', () => {
  it('霧色比天空的地平色暗', () => {
    const fog = new Color(FOG_COLOR).getHSL({ h: 0, s: 0, l: 0 })
    const sky = new Color(SKY_HORIZON).getHSL({ h: 0, s: 0, l: 0 })
    expect(fog.l).toBeLessThan(sky.l)
  })

  it('霧色與天空的地平色不是同一個值', () => {
    expect(FOG_COLOR).not.toBe(SKY_HORIZON)
  })
})

describe('createFog', () => {
  it('用的是設計值', () => {
    const f = createFog()
    expect(f.density).toBe(FOG_DENSITY)
    expect(f.color.getHex()).toBe(FOG_COLOR)
  })
})

/**
 * 遠平面若小於遠海的半邊，遠海會被裁掉 —— 而被裁掉的邊緣就是我們正要
 * 消除的那條硬邊。
 */
describe('相機遠平面容得下遠海', () => {
  it('遠平面大於遠海的半邊', () => {
    expect(CAMERA_FAR).toBeGreaterThan(FAR_SEA_SIZE / 2)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/fog.test.ts
```
預期：整檔紅在 import 解析（`src/render/fog.ts` 不存在、`SKY_HORIZON` / `CAMERA_FAR` /
`FAR_SEA_SIZE` 都還沒有）。

**注意**：`FAR_SEA_SIZE` 是 Task 3 才會建立的。為了讓這一個 Task 能獨立驗收，
**Task 2 就要把 `FAR_SEA_SIZE` 與 `FAR_SEA_Y` 兩個常數先加進 `ocean.ts`**（只加
常數，不加幾何）—— Task 3 再用它們建立網格。常數與使用它的測試同時進來，
而幾何跟在後面，是最小的可獨立驗收切法。

- [ ] **Step 3: 建立 `src/render/fog.ts`**

```ts
import { FogExp2 } from 'three'

/**
 * 霧色。**刻意不等於天空球的 `SKY_HORIZON`。**
 *
 * 遠海化進霧色之後若與天空完全同色，地平線就消失了 —— 而畫面上不會有
 * 任何錯誤，只是海與天連成一片。取同色相、暗一階，那一階明度就是地平線。
 * 專案負責人的要求原文：「遠方可以考慮 FOG，但是要看得出地平線」。
 */
export const FOG_COLOR = 0x7ea8c4

/**
 * 指數霧的密度，m⁻¹。
 *
 * 【為什麼是指數霧不是線性霧】線性霧要選一個 near，而 near 之內完全沒有霧、
 * 之外立刻開始 —— 在那個半徑上會出現一道看得見的環。指數霧的因子是
 * `1 − exp(−(d·ρ)²)`，近處由二次項壓到幾乎是零，沒有起點可言。
 *
 * 【1.4e-5 是怎麼來的】它要同時滿足三件相互拉扯的事：
 *
 *   5 km（纏鬥距離）    0.5 %   —— 敵機的顏色不能被霧改掉
 *   30 km（全戰場）      16 %   —— 開始化開，給得出深度感
 *   250 km（遠海邊緣）  ~100 %  —— 邊緣要完全化掉，否則就是另一條硬邊
 *
 * 三個數字都被 `test/unit/fog.test.ts` 釘住。要改密度就得同時面對這三個
 * 後果，那正是那三條測試存在的理由。
 */
export const FOG_DENSITY = 1.4e-5

/**
 * 指數霧的因子，0..1。0 = 完全看得到，1 = 完全是霧色。
 *
 * 【為什麼要有這個純函數】`FogExp2` 的計算在 GPU 的著色器裡，測不到。
 * 把同一條公式寫成 CPU 的一份，設計意圖才有東西可以斷言。**兩份必須一致**
 * —— 這是 three 的 `fog_fragment` chunk 用的公式（`FOG_EXP2` 分支）。
 */
export function fogFactor(distance: number, density: number): number {
  const d = distance * density
  return 1 - Math.exp(-d * d)
}

export function createFog(): FogExp2 {
  return new FogExp2(FOG_COLOR, FOG_DENSITY)
}
```

- [ ] **Step 4: `sky.ts` 抽出兩個顏色常數**

在 `SKY_RADIUS` 下方加：

```ts
/**
 * 天空球的地平色與天頂色。
 *
 * 【為什麼要具名】`fog.ts` 的霧色必須比地平色暗一階，否則地平線會消失
 * （見 `FOG_COLOR`）。那條關係要被測試釘住，而釘它需要這個值有名字 ——
 * 原本它是 `uniforms` 字面量裡的一個 magic number。純粹是取名，值沒有動。
 */
export const SKY_HORIZON = 0x9fc3d8
export const SKY_ZENITH = 0x1f4f80
```

`createSky` 裡改用它們：

```ts
      horizon: { value: new Color(SKY_HORIZON) },
      zenith: { value: new Color(SKY_ZENITH) },
```

同時更新 `SKY_RADIUS` 的註解 —— 它現在寫著「遠平面是 60 km（見
render/scene.ts）。……同時遠大於任何場景物件（海面 10 km）」，兩句話這一份
都推翻了：

```ts
/**
 * 天空球半徑，m。
 *
 * 【與相機遠平面的關係】遠平面是 800 km（`scene.ts` 的 `CAMERA_FAR`）。
 * 天空球跟著相機走，所以它永遠在視野正中央，只要半徑落在近平面與遠平面
 * 之間即可。
 *
 * 【為什麼遠海比它還大卻沒問題】遠海半邊 250 km，遠大於這顆球。但天空球
 * `depthWrite: false` 而且 `renderOrder = −1000` —— 先畫、不寫深度，所以
 * 任何東西都蓋得過它。它是背景不是物件。
 */
export const SKY_RADIUS = 40000
```

- [ ] **Step 5: `ocean.ts` 先加兩個常數**

在 `OCEAN_SEGMENTS` 下方加（幾何是 Task 3 的事）：

```ts
/**
 * 遠海的邊長，m。**這是一片平的四邊形，不是網格**（見 Task 3 / spec §4.1）。
 *
 * 【為什麼要 500 km】12,000 m（上帝視角的 `maxAltitude`）往下看時，半邊
 * 250 km 的邊緣落在俯角 `atan(12/250) ≈ 2.7°` —— 幾乎就在地平線上，而該處
 * 的霧已經吃滿（`fogFactor(250000, FOG_DENSITY) > 0.999`），看不到硬邊。
 */
export const FAR_SEA_SIZE = 500_000

/**
 * 遠海的高度，m。
 *
 * 【為什麼是負的】三道波的振幅和是 2.15 m，細浪面的最低點因此是 −2.15。
 * 遠海放在 0 會在波谷之間穿插、產生 z-fighting。放在 −3 保證它在 ±5 km
 * 的範圍內**永遠被細浪面蓋住**。
 *
 * 代價是接縫處有一道 3 m 的落差 —— 在 5 km 外張角 0.6 mrad（0.034°），
 * 而 1080p / 65° FOV 的一個像素是 0.06°。落在一個像素以內。
 */
export const FAR_SEA_Y = -3
```

- [ ] **Step 6: `scene.ts` 掛霧與遠平面**

```ts
import { createFog } from './fog'

/** 近平面，m。**沒有動過** —— 深度精度幾乎全由它決定。 */
export const CAMERA_NEAR = 1

/**
 * 遠平面，m。
 *
 * 【為什麼從 60 km 拉到 800 km】遠海半邊 250 km，遠平面小於它的話遠海會被
 * 裁掉，而被裁掉的邊緣就是我們正要消除的那條硬邊。
 *
 * 【深度精度的代價幾乎是零】解析度是 `Δz ≈ z²·(f−n)/(n·f·2²⁴)`，而 `f ≫ n`
 * 時 `(f−n)/(n·f) → 1/n`。近平面沒有動，所以近場精度不變 —— 100 m 處仍然
 * 是 0.6 mm。遠平面只改變那個趨近 1/n 的因子的第三位小數。
 */
export const CAMERA_FAR = 800_000
```

`createScene` 裡：

```ts
  const scene = new Scene()
  scene.add(createSky())
  // 【霧掛在 scene 上，逐材質生效】three 的 material.fog 預設為 true，所以
  // 飛機、海、參照物、殘骸、曳光彈、粒子全部吃霧。天空球是 ShaderMaterial
  // （fog 預設 false）不吃 —— 正確，天空本來就是無限遠。
  scene.fog = createFog()
```

```ts
  const camera = new PerspectiveCamera(65, 1, CAMERA_NEAR, CAMERA_FAR)
```

- [ ] **Step 7: 跑測試確認它綠**

```
npx vitest run test/unit/fog.test.ts test/unit/sky.test.ts test/unit/ocean.test.ts
npx tsc --noEmit
```
預期：全綠、`tsc` 無輸出。

- [ ] **Step 8: 提交**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 場景加指數霧，相機遠平面拉到 800 km

海要延伸到地平線的第一半：霧與遠平面。遠海的幾何在下一個 commit。

FogExp2 密度 1.4e-5，同時滿足三件相互拉扯的事 —— 5 km 的纏鬥距離只有
0.5%（敵機顏色不失真）、30 km 的全戰場 16%（給得出深度感）、250 km 的
遠海邊緣吃滿（邊緣化得掉、不會變成另一條硬邊）。三個數字都被測試釘住，
要改密度就得同時面對三個後果。

用指數霧而不是線性霧：線性霧要選一個 near，而 near 那一圈會出現一道
看得見的環；指數霧的二次項在近處壓到幾乎是零，沒有起點可言。

霧色 0x7ea8c4 刻意不等於天空的地平色 0x9fc3d8 —— 相等的話遠海化進霧色
之後會與天空完全同色，地平線消失，而畫面上不會有任何錯誤。專案負責人
的要求原文是「遠方可以考慮 FOG，但是要看得出地平線」，所以那條關係也
寫成測試（霧色的 HSL 明度必須低於天空地平色）。

遠平面 60 km→800 km 是為了容得下半邊 250 km 的遠海。近平面沒動，所以
深度精度不變 —— 解析度 Δz ≈ z²(f−n)/(n·f·2²⁴)，f ≫ n 時那個因子趨近
1/n，遠平面只改變它的第三位小數。

順帶把 sky.ts 的兩個顏色字面量取名為 SKY_HORIZON / SKY_ZENITH（值沒動），
因為霧色那條關係要釘住就得叫得出天空那個值的名字；並更新 SKY_RADIUS 的
註解 —— 它原本寫著「遠平面是 60 km」「遠大於任何場景物件（海面 10 km）」，
兩句話都被這一份推翻了。
EOF
git add src/render/fog.ts src/render/sky.ts src/render/scene.ts src/render/ocean.ts test/unit/fog.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 3：遠海平面

**Files:**
- Modify: `src/render/ocean.ts`
- Modify: `src/render/terrain.ts`
- Test: `test/unit/ocean.test.ts`

**Interfaces:**
- Consumes: `FAR_SEA_SIZE`、`FAR_SEA_Y`（Task 2 已加進 `ocean.ts`）
- Produces: `Ocean.farMesh: Mesh`、`SEA_COLOR: number`

- [ ] **Step 1: 寫會紅的測試**

在 `test/unit/ocean.test.ts` 末尾加：

```ts
import {
  createOcean, FAR_SEA_SIZE, FAR_SEA_Y, OCEAN_SEGMENTS, OCEAN_SIZE,
} from '../../src/render/ocean'
```
（與檔頭既有的 `gerstnerHeight, WAVES` 併成同一個 import）

```ts
/**
 * 【遠海在守什麼】細浪面只有以鏡頭為中心的 10 km 見方，邊緣之外是天空球的
 * 下半部 —— 上帝視角爬到 12,000 m 就會看到海是一塊浮在天上的板子。遠海是
 * 一片跟著鏡頭走的巨大平面，把海接到地平線。
 */
describe('遠海', () => {
  it('遠大於細浪面', () => {
    expect(FAR_SEA_SIZE).toBeGreaterThan(OCEAN_SIZE * 20)
  })

  /**
   * 【這一條是「不會 z-fighting」的充要條件】遠海只要有任何一點高於細浪面的
   * 波谷，兩個面就會在 ±5 km 之內穿插。而它會跟著 WAVES 一起變 —— 有人加一道
   * 大浪、振幅和超過 3 m，這條就紅。那正是它存在的理由。
   */
  it('恆在所有波谷之下', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    expect(FAR_SEA_Y).toBeLessThan(-maxAmp)
  })

  it('update 讓遠海精確落在中心（不做格點對齊）', () => {
    const o = createOcean()
    // 刻意選一個**不是**格點倍數的中心：細浪面會被對齊到格點，遠海不該被
    const cx = 1234.5
    const cz = -6789.25
    o.update(3, cx, cz)
    expect(o.farMesh.position.x).toBe(cx)
    expect(o.farMesh.position.z).toBe(cz)
    expect(o.farMesh.position.y).toBe(FAR_SEA_Y)
    o.dispose()
  })

  it('細浪面仍然對齊到格點', () => {
    const o = createOcean()
    o.update(3, 1234.5, -6789.25)
    const cell = OCEAN_SIZE / OCEAN_SEGMENTS
    expect(o.mesh.position.x % cell).toBeCloseTo(0, 6)
    expect(o.mesh.position.z % cell).toBeCloseTo(0, 6)
    o.dispose()
  })

  it('dispose 釋放遠海的幾何與材質', () => {
    const o = createOcean()
    let disposed = 0
    o.farMesh.geometry.addEventListener('dispose', () => { disposed++ })
    ;(o.farMesh.material as { addEventListener(t: string, f: () => void): void })
      .addEventListener('dispose', () => { disposed++ })
    o.dispose()
    expect(disposed).toBe(2)
  })
})
```

`OCEAN_SIZE` 與 `OCEAN_SEGMENTS` 目前是模組私有的 —— 這個 Task 要把
`OCEAN_SIZE` 與 `OCEAN_SEGMENTS` 都 `export` 出去（測試要用來算格子大小）。

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/ocean.test.ts
```
預期：import 解析失敗（`OCEAN_SIZE` 沒 export、`farMesh` 不存在）。

- [ ] **Step 3: 實作**

`src/render/ocean.ts`：

1. `const OCEAN_SIZE` / `const OCEAN_SEGMENTS` 改成 `export const`。
2. 把材質顏色抽成常數：

```ts
/**
 * 海的基本色。細浪面與遠海**必須共用**這一個值 —— 兩份會漂開，而漂開的
 * 症狀是 5 km 處出現一條色帶。
 */
export const SEA_COLOR = 0x1d3f5c
```
細浪面的 `MeshStandardMaterial` 改用 `color: SEA_COLOR`。

3. `Ocean` 介面加一行：

```ts
export interface Ocean {
  mesh: Mesh
  /**
   * 遠海。**平的、單色、只有兩個三角形**，墊在細浪面底下把海接到地平線。
   *
   * 【為什麼不必分段】它是平的，分段沒有任何意義。霧是逐片段算的，所以
   * 顏色在整面上仍然是連續漸層。
   */
  farMesh: Mesh
  update(time: number, centerX: number, centerZ: number): void
  heightAt(x: number, z: number, time: number): number
  dispose(): void
}
```

4. `createOcean` 裡，在 `const mesh = new Mesh(geometry, material)` 附近加：

```ts
  // 遠海。用 MeshStandardMaterial 而不是 Basic：要跟細浪面接得上就得受同一組
  // 燈光。roughness / metalness 全部沿用細浪面的值。
  const farGeometry = new PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, 1, 1)
  farGeometry.rotateX(-Math.PI / 2)
  const farMaterial = new MeshStandardMaterial({
    color: SEA_COLOR, roughness: 0.72, metalness: 0.05,
  })
  const farMesh = new Mesh(farGeometry, farMaterial)
  farMesh.frustumCulled = false // 隨鏡頭捲動，永遠可見
```

**不要設 `renderOrder`。** three 的不透明物件預設由近到遠排序，細浪面因此
先畫、遠海被深度測試擋掉大部分 —— 那正是想要的。設了反而變慢。

5. `update` 末尾加：

```ts
      // 【遠海不做格點對齊】對齊是為了避免頂點在格點之間滑動造成波形抖動，
      // 而遠海沒有波。精確跟著中心走，才不會在極端座標下累積偏差。
      farMesh.position.set(centerX, FAR_SEA_Y, centerZ)
```

6. 回傳物件加 `farMesh`，`dispose` 加 `farGeometry.dispose()` 與
   `farMaterial.dispose()`。

`src/render/terrain.ts` 的 `createTerrain`：

```ts
  const group = new Group()
  // 【順序：遠海先進去】不影響繪製（three 自己排序），但讀起來是由遠到近
  group.add(ocean.farMesh)
  group.add(ocean.mesh)
  group.add(props.mesh)
```

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/ocean.test.ts test/unit/terrain.test.ts test/unit/fog.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 遠海把海接到地平線

海要延伸到地平線的第二半。現有的 10 km 細浪面一行都沒動，底下墊一片
邊長 500 km、只有兩個三角形的平海，跟著鏡頭的 XZ 走。

專案負責人在上帝視角試飛時回報「海面只有局部」。成因是 ocean.ts 的
OCEAN_SIZE = 10000 —— 海是一塊以鏡頭為中心、邊長 10 km 的方形，邊緣之外
畫的是天空球的下半部。座艙視角在低空平飛時那條邊被 65° 的 FOV 壓在地平線
附近，所以從 M1 活到現在；上帝視角可以爬到 12,000 m，俯角一大那兩條邊就
出現在畫面正中央。

為什麼不加大細浪面：那是專案負責人否決的選項（三角形數 74k→295k），而且
就算加到 20 km 也還是到不了地平線 —— 仍然要墊平海。

y = −3 是為了永遠在波谷（−2.15 m）之下，否則兩個面會穿插、z-fighting。
代價是接縫的 3 m 落差，在 5 km 外張角 0.034°，小於 1080p / 65° FOV 的一個
像素（0.06°）。測試把「恆在波谷之下」釘成會跟著 WAVES 走的斷言 —— 有人加
一道大浪就會紅。

遠海不做格點對齊（那是為了避免波形抖動，而遠海沒有波），也不設 renderOrder
（three 的不透明物件由近到遠排序，細浪面先畫、遠海被深度測試擋掉大部分，
本來就是想要的）。

已知取捨：細浪面是 flatShading，波面法線偏離垂直約 0.049 rad，而遠海的法線
恆為垂直 —— 5 km 處會有一道亮度的接縫（不是幾何的接縫），該處的霧只有 0.5%
幫不上忙。這一版接受它，刺不刺眼由手動試飛判定。消除它的三條路都更貴，
而且其中一條會讓畫面上的海與 heightAt 的碰撞海分家。
EOF
git add src/render/ocean.ts src/render/terrain.ts test/unit/ocean.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 4：`HullMetrics` 長出翼尖的展向與縱向位置

**Files:**
- Modify: `src/render/geometry/assembly.ts`（`HullMetrics` 介面 + `finish()`）
- Test: `test/unit/geometry.test.ts`

**Interfaces:**
- Produces: `HullMetrics.tipX: number`、`HullMetrics.tipZ: number`
  （Task 6 的 `main.ts` 要用它們算翼尖的世界座標）

- [ ] **Step 1: 寫會紅的測試**

在 `test/unit/geometry.test.ts` 既有的「跨模組一致性」那一組裡加：

```ts
/**
 * 【這一條屬於跨模組一致性，不是造型】翼尖凝結尾要從翼尖冒出來，而翼尖在
 * 哪裡由視覺模型決定、由 `HullMetrics` 送出去。它與既有的「包圍盒翼展等於
 * spec.wing.span」是同一類：兩個模組對同一件事的說法必須對得起來。
 *
 * 用範圍而不是精確值：`tipX` 是 |x| > 0.92·半翼展 那一批頂點的平均，落在
 * 0.92 半翼展與半翼展之間 —— 寫死一個數字就變成對造型數字的同義反覆，
 * 而那正是檔頭裁決要避免的。
 */
it('翼尖的展向位置落在外側 8% 的區間內', () => {
  const m = buildAircraft(spec)
  const half = spec.wing.span / 2
  expect(m.metrics.tipX).toBeGreaterThan(half * 0.92)
  expect(m.metrics.tipX).toBeLessThanOrEqual(half + 1e-6)
  m.dispose()
})

it('翼尖的縱向位置落在機身的前後界之間', () => {
  const m = buildAircraft(spec)
  expect(m.metrics.tipZ).toBeGreaterThan(m.metrics.noseZ)
  expect(m.metrics.tipZ).toBeLessThan(m.metrics.noseZ + m.metrics.realLength)
  m.dispose()
})
```

（放進既有的 `for (const [name, spec] of ...)` 迴圈裡，兩個機種各跑一次；
若既有結構不是這樣，照既有結構擺。）

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/geometry.test.ts
```
預期：紅在 `tipX` / `tipZ` 不存在（TS 編譯錯或 `undefined`）。

- [ ] **Step 3: 實作**

`HullMetrics` 介面（在 `tipY` 旁邊）加：

```ts
  /**
   * 翼尖的展向位置（＝半翼展），m。**左翼取 −tipX。**
   *
   * 【用途】翼尖凝結尾要知道渦從哪裡脫離（`render/vortex.ts`）。
   */
  tipX: number
  /**
   * 翼尖的縱向位置（已含重心位移），m。
   *
   * 【為什麼取平均而不是後緣】渦其實在翼尖後緣附近脫離，但平均值與後緣
   * 差不到半個翼弦（< 1 m），而尾跡本身直徑就有 2–4 m。多一個「找後緣」的
   * 規則要多一組會漂掉的判準，換不到看得出來的差別。
   */
  tipZ: number
```

`finish()` 裡，既有的那個累加迴圈：

```ts
      const lim = maxAbsX * 0.92
      let sum = 0, n = 0
      let sumX = 0, sumZ = 0
      let noseLo = Infinity, noseHi = -Infinity
      for (const { mesh, i } of verts) {
        const pos = mesh.geometry.getAttribute('position')
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
        // 【同一個 0.92 視窗同時給 tipY / tipX / tipZ】主翼是全機 |x| 最大的
        // 部件，水平尾翼的半翼展遠小於 0.92 × 主翼半翼展（P-51D：1.95 vs
        // 5.19），不會被誤收進來。這是 tipY 本來就依賴的同一個前提。
        if (Math.abs(v.x) > lim) { sum += v.y; sumX += Math.abs(v.x); sumZ += v.z; n++ }
        if (v.z < noseZ + 0.03) { noseLo = Math.min(noseLo, v.y); noseHi = Math.max(noseHi, v.y) }
      }
```

回傳的 `metrics` 加：

```ts
          tipY: n ? sum / n : 0,
          tipX: n ? sumX / n : 0,
          tipZ: n ? sumZ / n : 0,
```

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/geometry.test.ts test/unit/hitbox.test.ts
npx tsc --noEmit
```

若 `tipX` 的下界沒過，**先量、先報告，不要調容差** —— 那表示 0.92 這個既有
視窗對某個機種的翼尖收縮太寬鬆，是一個要讓專案負責人知道的事實。

- [ ] **Step 5: 提交**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: HullMetrics 送出翼尖的展向與縱向位置

翼尖凝結尾（下一個 commit）要知道渦從哪裡脫離。finish() 本來就在掃全部
頂點時算出 maxAbsX、並用 |x| > 0.92·maxAbsX 那一批頂點的 y 平均值當 tipY
—— 同一批頂點再取兩個平均就是 tipX / tipZ，掃描成本沒有增加。

沿用既有的 0.92 視窗：主翼是全機 |x| 最大的部件，水平尾翼的半翼展遠小於
0.92 × 主翼半翼展（P-51D 是 1.95 對 5.19），不會被誤收。那是 tipY 本來就
依賴的同一個前提。

tipZ 取平均而不是找後緣：渦其實在翼尖後緣附近脫離，但平均與後緣差不到
半個翼弦（< 1 m），而尾跡本身直徑就有 2–4 m。多一組「找後緣」的判準換不到
看得出來的差別，卻多一組會漂掉的規則。

測試用區間不用精確值 —— 寫死一個數字就變成對造型數字的同義反覆，而那正是
geometry.test.ts 檔頭裁決要避免的。這兩條屬於「跨模組一致性」，與既有的
「包圍盒翼展等於 spec.wing.span」同類。
EOF
git add src/render/geometry/assembly.ts test/unit/geometry.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 5：`src/render/vortex.ts`

**Files:**
- Create: `src/render/vortex.ts`
- Test: `test/unit/vortex.test.ts`（新）

**Interfaces:**
- Consumes: `createParticles` / `Particles`（`src/render/particles.ts`）
- Produces:
  ```ts
  export function vortexIntensity(loadFactor: number): number
  export function vortexSpacing(intensity: number): number
  export function vortexSizeScale(intensity: number): number
  export function vortexEmitCount(distance: number, spacing: number): number
  export interface Vortex {
    object: InstancedMesh
    readonly live: number
    emit(index: number, loadFactor: number,
         lx: number, ly: number, lz: number,
         rx: number, ry: number, rz: number): void
    step(dt: number): void
    reset(): void
    dispose(): void
  }
  export function createVortex(capacity?: number, seats?: number): Vortex
  ```
  外加 spec §7 那張表上的所有常數。

- [ ] **Step 1: 寫會紅的測試**

建立 `test/unit/vortex.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  createVortex, vortexEmitCount, vortexIntensity, vortexSizeScale, vortexSpacing,
  VORTEX_G_FULL, VORTEX_G_ON, VORTEX_MAX_PER_FRAME, VORTEX_MAX_STEP,
  VORTEX_SEATS, VORTEX_SIZE_MIN_SCALE, VORTEX_SPACING_MAX, VORTEX_SPACING_MIN,
} from '../../src/render/vortex'
import { MAX_COMBATANTS } from '../../src/battle/skirmish'

describe('vortexIntensity', () => {
  it('平飛 1 g 什麼都沒有', () => {
    expect(vortexIntensity(1)).toBe(0)
  })

  it('門檻上恰好是 0', () => {
    expect(vortexIntensity(VORTEX_G_ON)).toBe(0)
  })

  it('拉滿是 1，超過也夾在 1', () => {
    expect(vortexIntensity(VORTEX_G_FULL)).toBe(1)
    expect(vortexIntensity(10)).toBe(1)
  })

  /**
   * 【為什麼取絕對值】負 G（推桿）時機翼一樣被載重，只是方向相反，翼尖
   * 一樣會凝。這條防的是有人把 Math.abs 拿掉。
   */
  it('負 G 與同大小的正 G 相同', () => {
    expect(vortexIntensity(-5)).toBe(vortexIntensity(5))
  })

  it('門檻與拉滿之間是連續遞增的', () => {
    const mid = (VORTEX_G_ON + VORTEX_G_FULL) / 2
    expect(vortexIntensity(mid)).toBeGreaterThan(0)
    expect(vortexIntensity(mid)).toBeLessThan(1)
  })
})

describe('vortexSpacing', () => {
  it('剛過門檻是最寬的間隔（＝斷續的淡痕）', () => {
    expect(vortexSpacing(0)).toBe(VORTEX_SPACING_MAX)
  })
  it('拉滿是最窄的間隔（＝連成實心白帶）', () => {
    expect(vortexSpacing(1)).toBe(VORTEX_SPACING_MIN)
  })
  it('隨 intensity 遞減', () => {
    expect(vortexSpacing(0.7)).toBeLessThan(vortexSpacing(0.3))
  })
})

describe('vortexSizeScale', () => {
  it('剛過門檻粒子最小', () => {
    expect(vortexSizeScale(0)).toBe(VORTEX_SIZE_MIN_SCALE)
  })
  it('拉滿是原尺寸', () => {
    // 【用 toBeCloseTo 不用 toBe】0.45 + 0.55 在 IEEE754 下剛好落回 1.0，
    // 但那是巧合不是保證 —— 換一組常數就會差一個 ulp，而這條測試守的是
    // 「拉滿等於原尺寸」這個意思，不是浮點數的位元。
    expect(vortexSizeScale(1)).toBeCloseTo(1, 12)
  })
})

describe('vortexEmitCount', () => {
  it('距離不足一個間隔就不發射', () => {
    expect(vortexEmitCount(1.4, 1.5)).toBe(0)
  })
  it('剛好三個間隔發三顆', () => {
    expect(vortexEmitCount(4.5, 1.5)).toBe(3)
  })
  it('被每幀上限夾住', () => {
    expect(vortexEmitCount(1000, 1.5)).toBe(VORTEX_MAX_PER_FRAME)
  })
})

/** emit 的三個引數組：兩個翼尖 + 一個 loadFactor。位置用世界座標。 */
function tips(x: number): [number, number, number, number, number, number] {
  return [x, 1000, 0, x, 1000, 10]
}

describe('凝結尾的發射', () => {
  /**
   * 【第一幀不發射】尾跡是「上一幀翼尖 → 這一幀翼尖」那條線段上的補點，
   * 第一幀沒有上一幀可以連。少了這條守衛，換場後第一幀會從一個未初始化的
   * 位置（0,0,0）拉一條線過來。
   */
  it('第一幀只記錄位置，不發射', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    expect(v.live).toBe(0)
    v.dispose()
  })

  it('第二幀才開始發射', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })

  it('G 在門檻以下不發射', () => {
    const v = createVortex()
    v.emit(0, 1, ...tips(0))
    v.emit(0, 1, ...tips(20))
    expect(v.live).toBe(0)
    v.dispose()
  })

  /**
   * 【門檻以下也要記錄位置】不記的話，從緩轉切進硬拉的第一幀會拿到很久
   * 以前的位置，拉出一條長線。這條測試是那個行為的唯一防線。
   */
  it('門檻以下仍然記錄位置，切進高 G 時不會拉長線', () => {
    const v = createVortex()
    v.emit(0, 1, ...tips(0))
    v.emit(0, 1, ...tips(20))   // 低 G 走了 20 m
    v.emit(0, 6, ...tips(23))   // 切進高 G，只走了 3 m
    // 3 m / 1.5 m 間隔 = 2 顆 × 兩個翼尖 = 4；若拿到的是 0 m 那一幀的位置，
    // 距離會是 23 m，會被每幀上限夾到 8 × 2 = 16
    expect(v.live).toBeLessThanOrEqual(2 * 2)
    v.dispose()
  })

  /**
   * 【超過 MAX_STEP 不發射】擋的是換場、重生、接手、以及分頁切回來時的
   * 巨大 dt —— 否則會出現一條橫跨半個地圖的白線。
   */
  it('位移超過上限不發射，但位置有記錄下來', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(VORTEX_MAX_STEP * 10))
    expect(v.live).toBe(0)
    // 下一幀恢復正常：從剛剛記錄的位置起算，只走了 6 m
    v.emit(0, 6, ...tips(VORTEX_MAX_STEP * 10 + 6))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })

  it('單幀不超過每翼尖上限 × 2', () => {
    const v = createVortex()
    v.emit(0, 6.5, ...tips(0))
    v.emit(0, 6.5, ...tips(VORTEX_MAX_STEP - 1))
    expect(v.live).toBeLessThanOrEqual(VORTEX_MAX_PER_FRAME * 2)
    v.dispose()
  })

  /**
   * 【reset 也要清上一幀的位置】只清粒子池的話，換場後第一幀會從上一場的
   * 位置拉一條線過來。MAX_STEP 是防線，但不能靠防線當設計。
   */
  it('reset 清掉粒子與上一幀的位置', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.reset()
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(500))
    expect(v.live).toBe(0)      // 又是第一幀
    v.dispose()
  })

  it('座位超出範圍不會爆，也不影響別的座位', () => {
    const v = createVortex()
    v.emit(VORTEX_SEATS, 6, ...tips(0))
    v.emit(VORTEX_SEATS, 6, ...tips(20))
    expect(v.live).toBe(0)
    v.emit(-1, 6, ...tips(0))
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })
})

/**
 * 【跨層一致性，只有測試守得到】`vortex.ts` 依 spec §9 不得 import
 * `src/battle/`，所以 VORTEX_SEATS 與 MAX_COMBATANTS 這兩個常數在產品碼裡
 * 永遠碰不到面。這條是「有人把 20v20 改成 32v32 卻沒動 VORTEX_SEATS」的
 * 唯一防線 —— 症狀會是編號較大的那幾架完全沒有尾跡，而不是任何錯誤。
 */
describe('座位數容得下全部參戰者', () => {
  it('VORTEX_SEATS 不小於 MAX_COMBATANTS', () => {
    expect(VORTEX_SEATS).toBeGreaterThanOrEqual(MAX_COMBATANTS)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/vortex.test.ts
```
預期：`src/render/vortex.ts` 不存在，整檔紅。

- [ ] **Step 3: 實作 `src/render/vortex.ts`**

```ts
import { Color, NormalBlending, type InstancedMesh } from 'three'
import { createParticles } from './particles'

/**
 * 翼尖凝結尾。
 *
 * 【物理依據】真機的翼尖渦凝結尾成因是翼尖低壓區把水氣凝出來，而低壓的
 * 強度跟著升力係數走 —— 也就是跟著 G 走。所以判準取 `|loadFactor|`。
 *
 * 【「大幅度轉彎更明顯」不必另外寫程式】大幅度轉彎就是高 G，`intensity`
 * 直接就是它。這是專案負責人的原始要求。
 *
 * 【為什麼尾跡會留在空中】粒子發射時速度是 0、`gravity` 是 0 —— 它們生在
 * 翼尖走過的地方就不動了，於是自動描出飛機剛剛走過的路徑。那就是凝結尾。
 */

/** 開始凝結的 G。平飛 1 g 與緩轉 2 g 完全乾淨。 */
export const VORTEX_G_ON = 3.0
/** 濃度拉滿的 G。兩機的持續轉彎大致落在 4–6 g。 */
export const VORTEX_G_FULL = 6.5
/** 剛過門檻時的補點間隔，m。大於粒子直徑 ⇒ 讀起來是斷續的淡痕。 */
export const VORTEX_SPACING_MAX = 4.0
/** 拉滿時的補點間隔，m。小於粒子直徑 ⇒ 彼此重疊、連成實心白帶。 */
export const VORTEX_SPACING_MIN = 1.5
/** 出生直徑，m。翼展約 11 m，尾跡粗細約 1/7 翼展。 */
export const VORTEX_SIZE_FROM = 1.6
/** 死亡直徑，m。渦會擴散。 */
export const VORTEX_SIZE_TO = 4.5
/** intensity = 0 時的尺寸倍率。 */
export const VORTEX_SIZE_MIN_SCALE = 0.45
/** 壽命，s。200 m/s × 1.4 = 280 m 的尾跡長度。 */
export const VORTEX_LIFE = 1.4
/** 壽命抖動。與 SMOKE_LIFE_JITTER 同一個理由：尾端不要切齊。 */
export const VORTEX_LIFE_JITTER = 0.15
/** 出生不透明度。 */
export const VORTEX_ALPHA = 0.42
/** 指數阻尼，s⁻¹。速度本來就發射為 0，這個只用來收掉數值殘留。 */
export const VORTEX_DRAG = 0.8

/**
 * 每個翼尖每幀最多補幾顆。**這是防爆閥，不是視覺參數。**
 *
 * 幀率崩到 7.5 fps 時（無頭 Chromium 就是這個數量級）單幀位移 27 m，
 * 以 1.5 m 的間隔會想補 18 顆 —— 一架飛機就能把池子吃光。8 顆讓極慢的
 * 幀率下尾跡變疏，但不會拖垮其他人。
 */
export const VORTEX_MAX_PER_FRAME = 8

/**
 * 兩幀之間的位移上限，m。超過就只記錄、不發射。
 *
 * 擋的是換場、重生、接手、以及分頁切回來時的巨大 `dt` —— 否則會出現一條
 * 橫跨半個地圖的白線。與 `main.ts` 對 `prevPosition` 的處理同一個道理。
 * 200 m/s × 0.3 s = 60 m，比任何正常幀都寬得多。
 */
export const VORTEX_MAX_STEP = 60

/**
 * 粒子容量。與 `SMOKE_CAPACITY` 同級。
 *
 * 【滿了會截短尾跡，那是刻意選的退化方向】40 架同時 6.5 G、200 m/s 的極端
 * 情形每秒要 10,667 顆，1.4 s 壽命等於 14,933 顆存活，超過這個容量。環形
 * 緩衝會覆蓋最舊的 —— 也就是**尾跡的尾端先消失**，長度從 1.4 s 縮到約
 * 0.5 s。尾端本來就是最淡的一段，而「所有人的尾跡一起變短」遠好過「有些人
 * 完全沒有尾跡」。與 `sparks.ts` / `particles.ts` 的覆蓋策略一致。
 */
export const VORTEX_CAPACITY = 6144

/**
 * 上一幀翼尖位置的座位數。
 *
 * 【為什麼不 import MAX_COMBATANTS】它住在 `src/battle/skirmish.ts`，而
 * spec §9 規定這個檔不得相依 `src/battle/`。64 對 20v20 的 40 個座位有
 * 1.6 倍餘裕，而一個 Float32Array(384) 的成本可以忽略。兩個常數不准漂開
 * 由 `test/unit/vortex.test.ts` 守著 —— 跨層相依在測試裡是允許的。
 */
export const VORTEX_SEATS = 64

/** 凝結尾的顏色。近白、略帶天空的藍。 */
const VORTEX_COLOR = new Color(0xeef4f8)

export function vortexIntensity(loadFactor: number): number {
  const g = Math.abs(loadFactor)
  if (g <= VORTEX_G_ON) return 0
  if (g >= VORTEX_G_FULL) return 1
  return (g - VORTEX_G_ON) / (VORTEX_G_FULL - VORTEX_G_ON)
}

export function vortexSpacing(intensity: number): number {
  return VORTEX_SPACING_MAX + (VORTEX_SPACING_MIN - VORTEX_SPACING_MAX) * intensity
}

export function vortexSizeScale(intensity: number): number {
  return VORTEX_SIZE_MIN_SCALE + (1 - VORTEX_SIZE_MIN_SCALE) * intensity
}

/**
 * 這一段線段要補幾顆。
 *
 * 【為什麼是沿線段補點而不是每幀一顆】200 m/s 在 60 fps 下一幀走 3.3 m，
 * 在 7.5 fps 下走 27 m。每幀一顆的話尾跡是虛線，而且**虛線的疏密會隨幀率
 * 變化** —— 同一個動作在不同機器上長得不一樣。
 */
export function vortexEmitCount(distance: number, spacing: number): number {
  if (!(spacing > 0)) return 0
  return Math.min(Math.floor(distance / spacing), VORTEX_MAX_PER_FRAME)
}

export interface Vortex {
  object: InstancedMesh
  /** 目前還活著幾顆。測試與 telemetry 用 */
  readonly live: number
  /**
   * 一架飛機的一幀。`l*` / `r*` 是兩個翼尖的**世界座標**。
   *
   * 熱路徑：不配置。`index` 超出座位數直接 return（不丟例外）。
   */
  emit(
    index: number, loadFactor: number,
    lx: number, ly: number, lz: number,
    rx: number, ry: number, rz: number,
  ): void
  step(dt: number): void
  /** 全部歸零，**含上一幀的翼尖位置**。換一場戰鬥時呼叫。 */
  reset(): void
  dispose(): void
}

export function createVortex(
  capacity: number = VORTEX_CAPACITY, seats: number = VORTEX_SEATS,
): Vortex {
  const pool = createParticles({
    capacity,
    blending: NormalBlending,
    life: VORTEX_LIFE,
    sizeFrom: VORTEX_SIZE_FROM,
    sizeTo: VORTEX_SIZE_TO,
    gravity: 0,
    drag: VORTEX_DRAG,
    alphaFrom: VORTEX_ALPHA,
    lifeJitter: VORTEX_LIFE_JITTER,
    color: (_t, out) => { out.copy(VORTEX_COLOR) },
  })

  /** 上一幀的兩個翼尖，世界座標。每個座位 6 個數（左 xyz、右 xyz）。 */
  const prev = new Float32Array(seats * 6)
  /** 這個座位有沒有上一幀。第一幀不發射，見 emit。 */
  const seen = new Uint8Array(seats)

  const trail = (
    px: number, py: number, pz: number,
    x: number, y: number, z: number,
    spacing: number, scale: number,
  ): void => {
    const dx = x - px
    const dy = y - py
    const dz = z - pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > VORTEX_MAX_STEP) return
    const n = vortexEmitCount(dist, spacing)
    for (let k = 1; k <= n; k++) {
      const t = k / n
      pool.emit(px + dx * t, py + dy * t, pz + dz * t, 0, 0, 0, scale)
    }
  }

  return {
    object: pool.object,
    get live() { return pool.live },

    emit(index, loadFactor, lx, ly, lz, rx, ry, rz): void {
      if (index < 0 || index >= seats) return
      const b = index * 6
      const intensity = vortexIntensity(loadFactor)
      // 【門檻以下也要記錄位置（見下方的無條件寫入）】不記的話，從緩轉
      // 切進硬拉的第一幀會拿到很久以前的位置，拉出一條長線。
      if (intensity > 0 && seen[index] === 1) {
        const spacing = vortexSpacing(intensity)
        const scale = vortexSizeScale(intensity)
        trail(prev[b]!, prev[b + 1]!, prev[b + 2]!, lx, ly, lz, spacing, scale)
        trail(prev[b + 3]!, prev[b + 4]!, prev[b + 5]!, rx, ry, rz, spacing, scale)
      }
      prev[b] = lx
      prev[b + 1] = ly
      prev[b + 2] = lz
      prev[b + 3] = rx
      prev[b + 4] = ry
      prev[b + 5] = rz
      seen[index] = 1
    },

    step(dt: number): void {
      pool.step(dt)
    },

    reset(): void {
      pool.reset()
      // 【這一行不能漏】只清粒子池的話，換場後第一幀會從上一場的位置拉一條
      // 線過來。VORTEX_MAX_STEP 擋得住，但不能靠防線當設計。
      seen.fill(0)
    },

    dispose(): void {
      pool.dispose()
    },
  }
}
```

- [ ] **Step 4: 跑測試確認它綠**

```
npx vitest run test/unit/vortex.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: 併進既有的池歸零測試**

`test/unit/pool-reset.test.ts` 的 `pools` 陣列加一項：

```ts
    ['凝結尾', () => createVortex()],
```
並補 import。**注意**：那三條測試呼叫的是 `p.emit(0, 100, 0, 1, 2, 3)`
（`Particles` 的簽章），而 `Vortex.emit` 的簽章不同 —— 所以這一項要另外寫，
不能塞進共用迴圈。改成在該檔末尾加一個獨立的 `describe`：

```ts
describe('凝結尾池的歸零', () => {
  /** 讓池子裡有東西：兩幀，第二幀才會發射（見 vortex.test.ts）。 */
  const fill = (v: ReturnType<typeof createVortex>) => {
    v.emit(0, 6, 0, 1000, 0, 0, 1000, 10)
    v.emit(0, 6, 20, 1000, 0, 20, 1000, 10)
  }

  it('reset 之後存活數歸零', () => {
    const v = createVortex()
    fill(v)
    expect(v.live).toBeGreaterThan(0)
    v.reset()
    expect(v.live).toBe(0)
    v.dispose()
  })

  it('reset 之後再 step 也不會冒出東西', () => {
    const v = createVortex()
    fill(v)
    v.reset()
    v.step(1 / 60)
    expect(v.live).toBe(0)
    v.dispose()
  })

  it('reset 之後還能正常再用', () => {
    const v = createVortex()
    fill(v)
    v.reset()
    fill(v)
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })
})
```

```
npx vitest run test/unit/pool-reset.test.ts
```

- [ ] **Step 6: 提交**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 翼尖高 G 凝結尾

專案負責人在上帝視角試飛時要求「飛機機翼兩邊要有氣流線，尤其大幅度轉彎
的時候氣流線應該更明顯」，並在三個選項中選定高 G 凝結尾。

判準是 |diag.loadFactor|：3 g 起、6.5 g 拉滿。真機的翼尖渦凝結尾成因是
翼尖低壓區把水氣凝出來，而低壓強度跟著升力係數走 —— 也就是跟著 G 走。
「大幅度轉彎更明顯」因此不必另外寫程式，那就是 G。取絕對值是因為推桿時
機翼一樣被載重，翼尖一樣會凝。

濃度用間隔（4.0→1.5 m）與尺寸倍率（0.45→1.0）表達，不用 alpha —— 粒子池
的 alphaFrom 是整池一個常數，只有 sizeScale 是逐顆的。剛過門檻是小粒子、
寬間隔（斷續的淡痕），拉滿是大粒子、窄間隔（實心白帶）。

沿「上一幀翼尖 → 這一幀翼尖」的線段每 spacing 公尺補一顆，而不是每幀一顆：
200 m/s 在 60 fps 下一幀走 3.3 m、在 7.5 fps 下走 27 m，每幀一顆的話虛線的
疏密會隨幀率變化，同一個動作在不同機器上長得不一樣。

粒子發射速度 0、gravity 0，所以尾跡留在空中不動、自動描出飛機走過的路徑。

兩道守衛，各有一條測試：第一幀只記錄不發射（沒有上一幀可以連）；位移超過
60 m 只記錄不發射（換場、重生、接手、分頁切回的巨大 dt）。門檻以下也要記錄
位置 —— 不記的話從緩轉切進硬拉的第一幀會拉一條長線。reset 連上一幀位置一起
清，因為只清粒子池的話換場後會從上一場的位置拉線過來；60 m 那道是防線，
不能靠防線當設計。

VORTEX_SEATS = 64 而不是 import MAX_COMBATANTS —— 這個檔依 spec §9 不得
相依 src/battle/。兩個常數不准漂開由測試守著（跨層相依在測試裡是允許的），
症狀會是編號較大的那幾架完全沒有尾跡，而不是任何錯誤。

池子滿了會截短尾跡的尾端，那是刻意選的退化方向：尾端本來就是最淡的一段，
「所有人一起變短」遠好過「有些人完全沒有」。

參數全部是初值，手動試飛才是定值的地方。
EOF
git add src/render/vortex.ts test/unit/vortex.test.ts test/unit/pool-reset.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 6：`main.ts` 接線 + 護欄 + Playwright + 回填

**Files:**
- Modify: `src/main.ts`
- Test: `test/integration/vortex-neutrality.test.ts`（新）
- Test: `test/e2e/battlefield-visuals.e2e.ts`（新）
- Modify: `docs/superpowers/specs/2026-08-08-battlefield-visuals-design.md`（§10 回填）

**Interfaces:**
- Consumes: `createVortex`（Task 5）、`HullMetrics.tipX` / `tipZ`（Task 4）

- [ ] **Step 1: 先寫護欄測試（會紅）**

建立 `test/integration/vortex-neutrality.test.ts`。**照 `test/integration/god-view.test.ts:74–118`
的 `damage(stepCamera)` 那一招**，檔頭：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { createVortex } from '../../src/render/vortex'

const DT = 1 / 240
const SECONDS = 120

/** 翼尖的世界座標。與 `main.ts` 同一招：模組層暫存，迴圈裡不配置。 */
const TIP = new Vector3()
const TIP2 = new Vector3()
```

本體：

```ts
/**
 * 【這條護欄實際在守什麼】它看起來近乎恆真 —— `vortex.ts` 不 import
 * `src/battle/`，怎麼可能改到戰局？但這個專案裡有一個真的會踩到的機制：
 * **模組層級的共用暫存池**（`core/pool.ts` 的 `makeScratch`，`src/ai/` 與
 * `CameraRig` 都在用）。特效若借用了別人的池子，就會在別人用到一半時把
 * 內容改掉，而症狀是「戰局悄悄變了」而不是任何錯誤。
 *
 * 上帝視角那條同型的護欄（`god-view.test.ts`）就是為這個而寫的。
 */
function damage(stepVortex: boolean): { blue: number, red: number } {
  const b = createBattle(new AiController())
  const hp0 = b.world.combatants.map((c) => c.hp)
  const vortex = createVortex()
  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)
    if (stepVortex) {
      for (const c of b.world.combatants) {
        if (!c.alive) continue
        const p = c.aircraft.state.position
        const q = c.aircraft.state.orientation
        // 用真的翼尖換算：applyQuaternion 會不會碰到共用暫存池，正是要測的
        TIP.set(-2.8, 0, 0).applyQuaternion(q).add(p)
        TIP2.set(2.8, 0, 0).applyQuaternion(q).add(p)
        vortex.emit(
          c.index, c.aircraft.diag.loadFactor,
          TIP.x, TIP.y, TIP.z, TIP2.x, TIP2.y, TIP2.z,
        )
      }
      vortex.step(DT)
    }
  }
  const out = { blue: 0, red: 0 }
  for (const c of b.world.combatants) {
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') out.blue += lost
    else out.red += lost
  }
  vortex.dispose()
  return out
}

it('推進凝結尾不改變任何一架的掉血', () => {
  const off = damage(false)
  const on = damage(true)
  console.log(JSON.stringify({
    off: `B${off.blue.toFixed(0)}:R${off.red.toFixed(0)}`,
    on: `B${on.blue.toFixed(0)}:R${on.red.toFixed(0)}`,
  }))
  expect(on.blue).toBe(off.blue)
  expect(on.red).toBe(off.red)
}, 10 * 60 * 1000)
```

`damage` 與那條 `it` 包在一個 `describe('凝結尾不得改變戰局（20v20、120 秒、兩場）')` 裡。

**`TIP.set(-2.8, 0, 0)` 的 2.8 是隨便取的一個約當半翼展** —— 這條護欄測的是
「有沒有碰到共用暫存池」，翼尖精確在哪裡與它無關，所以刻意不 import
`buildAircraft`（那會把整個 `src/render/geometry/` 拉進一條 120 秒 × 240 Hz
的迴圈裡，只為了兩個常數）。

- [ ] **Step 2: 跑護欄確認它綠（而且是真判準）**

```
npx vitest run test/integration/vortex-neutrality.test.ts
```

**這一條預期一開始就綠**（`vortex.ts` 本來就不該碰戰局）。所以要用
**mutation** 證明它不是空的：暫時在 `vortex.ts` 的 `emit` 開頭插一行
會改到共用暫存池的程式碼（例如 `import { makeScratch } from '../core/pool'`
再寫入它），確認測試轉紅，然後**把那行拿掉**。把這個實驗的結果寫進報告。

- [ ] **Step 3: `main.ts` 接線**

1. import：

```ts
import { createVortex } from './render/vortex'
```

2. 建立與加進場景（在 `const spray = createSpray(WATER_COLOR)` 那一段附近）：

```ts
const vortex = createVortex()
ctx.scene.add(vortex.object)
```

3. 模組層暫存（與其他 `new Vector3()` 的暫存放一起）：

```ts
/** 翼尖的世界座標。熱路徑：不配置。 */
const TIP_L = new Vector3()
const TIP_R = new Vector3()
```

4. 換場歸零 —— 在既有那五行旁邊（`main.ts:349–353` 的
   `fireball.reset()` … `splashes.reset()`）加：

```ts
  vortex.reset()
```

5. 發射 —— 在逐 combatant 的視覺更新迴圈裡，`v.model.setPropSpin(...)`
   那一行**之後**：

```ts
    // 【接線點在 v.wrecked / !c.alive 的 continue 之後】翻滾的殘骸沒有升力，
    // 本來就不該冒尾跡 —— 這是免費得到的。
    const m = v.model.metrics
    TIP_L.set(-m.tipX, m.tipY, m.tipZ).applyQuaternion(v.quaternion).add(v.position)
    TIP_R.set(m.tipX, m.tipY, m.tipZ).applyQuaternion(v.quaternion).add(v.position)
    vortex.emit(
      c.index, c.aircraft.diag.loadFactor,
      TIP_L.x, TIP_L.y, TIP_L.z,
      TIP_R.x, TIP_R.y, TIP_R.z,
    )
```

**用 `v.position` / `v.quaternion`（內插後的畫面姿態）而不是
`c.aircraft.state.*`** —— 尾跡要接在畫面上看到的翼尖，不是物理子步的位置。
與殘骸接管用 `v` 的理由完全相同（`main.ts:594` 的註解）。

6. 每幀推進 —— 在 `smoke.step(frameSeconds)` 那一段：

```ts
  vortex.step(frameSeconds)
```

- [ ] **Step 4: 型別檢查 + 全套回歸**

```
npx tsc --noEmit
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"
```
（若既有的跑法不是這個旗標，照專案既有的跑法。）

預期：無**新增**紅燈。已知既有紅燈一條：第二份 spec 刻意留紅的側翼方位角紀錄。

單獨跑：
```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/**/rematch.test.ts
```
預期：`perf-gate` 4 綠、`rematch` 3 綠。**跑它們是為了證明「無變化」**——
這一份不碰物理，不該有任何改善或劣化。

- [ ] **Step 5: Playwright 驗收**

**先確認沒有殘留的 vite dev server、也沒有瀏覽器分頁開著這個遊戲。**

建立 `test/e2e/battlefield-visuals.e2e.ts`。照 `test/e2e/god-view.e2e.ts` 的
結構（三次點擊進場：`[data-act="start"]` → `[data-act="skirmish"]` →
`#skirmish [data-act="fight"]`；`try/finally` 包 `browser.close()`；
**不要**點畫面去取得指標鎖 —— 那會讓瞄準向量暴衝，是 god-view e2e 已經
記錄過的既有缺陷）。

```
/**
 * 【這個 e2e 能斷言的很有限，而那是儀器的限制不是設計的取巧】WebGL canvas
 * 沒開 preserveDrawingBuffer，畫面讀不回來。所以它做的是**執行路徑的驗收**：
 *
 *   遠平面 800 km、遠海那片 500 km 的四邊形、FogExp2 的 uniform、
 *   雙面的圓盤材質、凝結尾的 InstancedMesh 與它改造過的著色器 ——
 *   全部會在「進場 → 上帝視角 → 爬高 → 回座艙」這條路徑上被 three 實際
 *   編譯與繪製。shader 或幾何出問題會以 WebGL warning / console error
 *   的形式現形，而這正是這一份最可能壞掉的方式（新的著色器注入、
 *   新的巨大幾何、新的 fog uniform）。
 *
 *   「高 G 真的會冒尾跡」由 test/unit/vortex.test.ts 斷言，不在這裡重複 ——
 *   e2e 讀不到粒子數。
 */
```

要做的事：

1. 收集 `page.on('console')` 的 `error` 與 `page.on('pageerror')`。
2. 進場 → 等戰鬥開始。
3. 按 `G` 進上帝視角。
4. 按住 `E`（升降）配合 `Shift` 爬升數秒 —— 目標是把鏡頭推到夠高，
   讓遠海與霧真的被繪製到。
5. 停留 2 秒。
6. 按 `G` 回座艙，再停留 1 秒。
7. 斷言：console error 陣列長度為 0，pageerror 陣列長度為 0。

執行（兩個終端機，與 `god-view.e2e.ts` 檔頭記載的完全相同 ——
`.e2e.ts` 不由 vitest 收，`vite.config.ts` 的 `test.include` 只收 `*.test.ts`）：

```
npm run dev                                              # 終端機一，開在 5173
npx vite-node test/e2e/battlefield-visuals.e2e.ts        # 終端機二
```

**不得使用 `process` / `fs`** —— 專案沒有 `@types/node`。截圖交給 playwright
自己寫檔，判斷全部走 `page.evaluate`。

- [ ] **Step 6: 回填 spec §10**

在 spec 末尾加一節 `## 12. 實作後的回填`，寫下：

- 護欄的 mutation 實驗結果（Step 2）。
- 全套回歸、`perf-gate`、`rematch` 的實際數字。
- Playwright 的實際結果。
- **任何與 spec 不符的地方**（例如 `tipX` 的區間、霧的三個點是否落在預期）。
- 手動試飛清單（spec §10 的六項）**原樣保留** —— 那是專案負責人的事，
  不是這一份能勾掉的。

- [ ] **Step 7: 提交**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 凝結尾接進 main.ts，加護欄與 Playwright 驗收

接線點在逐 combatant 的視覺更新迴圈裡、v.wrecked 與 !c.alive 的 continue
之後 —— 翻滾的殘骸沒有升力，本來就不該冒尾跡，這是免費得到的。

翼尖用 v.position / v.quaternion（內插後的畫面姿態）換算，不是
c.aircraft.state.*：尾跡要接在畫面上看到的翼尖，不是物理子步的位置。與
殘骸接管用 v 的理由完全相同。TIP_L / TIP_R 是模組層暫存，熱路徑不配置。

護欄：20v20 跑兩場、每場 SECONDS 秒，一場推進凝結尾、一場不推，逐隊 HP
損失必須逐位元組相同。它看起來近乎恆真，但這個專案有一個真的會踩到的
機制 —— core/pool.ts 的共用暫存池。特效若借用了別人的池子，症狀是「戰局
悄悄變了」而不是任何錯誤。上帝視角那條同型的護欄就是為這個而寫的。已用
mutation 確認它不是空的（實驗結果寫在 spec §12）。

Playwright 能斷言的很有限（WebGL canvas 沒開 preserveDrawingBuffer，畫面
讀不回來），所以它做的是執行路徑的驗收：遠平面 800 km、遠海那片 500 km
的四邊形、fog uniform、雙面圓盤、凝結尾改造過的著色器，全部會在「進場 →
上帝視角 → 爬高 → 回座艙」這條路徑上被 three 實際編譯與繪製，出問題會以
console error 現形。「高 G 真的會冒尾跡」由單元測試斷言，不在 e2e 重複。

真正的驗收是手動試飛，spec §10 的六項留給專案負責人。
EOF
git add src/main.ts test/integration/vortex-neutrality.test.ts test/e2e/battlefield-visuals.e2e.ts docs/superpowers/specs/2026-08-08-battlefield-visuals-design.md
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

## 完成後

三件事都是**視覺**，自動測試只守得到機制與不變量。跑完 Task 6 之後：

1. `npm run dev`，請專案負責人依 spec §10 的六項手動試飛。
2. 回報時附上：霧的三個距離實際值、`tipX` 兩個機種的實際值、
   護欄 mutation 實驗的結果、Playwright 的 console error 數。
3. **不要自行調整 spec §7 的任何參數。** 紅了或看起來不對，先量、先報告、
   先問 —— 參數的重新定值是專案負責人的決定。
