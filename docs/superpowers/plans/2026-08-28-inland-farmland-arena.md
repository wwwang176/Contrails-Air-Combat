# 內陸農地與戰場邊界 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入第三種地形 `'farmland'`（歐洲內陸農地：田區、防風林、緩丘、遠景平地），以及只對玩家生效的 12 km 戰場邊界。

**Architecture:** 高度場與丘陵沿用 `archipelago.ts` 的多瓣機制（`makeLobes` 直接匯入，`bake` 抽出一個吃 `floor` 參數的版本）。田區與防風林**不烘貼圖**，而是在片段著色器裡算抖動網格的 Voronoi —— 同一支 GLSL 給細節地形與遠景平地共用，所以圖案延伸到無限遠而且釘在世界座標上。邊界是 `world/` 的一個純狀態機，`main.ts` 接線、HUD 顯示。

**Tech Stack:** TypeScript（無 `@types/node`）、three r0.180、vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-28-inland-farmland-design.md`

## Global Constraints

- **不得 `git add -A`** —— `bash.exe.stackdump` 是被追蹤的檔案而且一直在變。一律列明確路徑。
- **不得用 PowerShell 讀寫含中文的檔案** —— 用 Write 工具或 python `io.open(..., encoding='utf-8')`。
- **含中文的 commit message 寫進檔案，再 `git commit -F`。** 結尾要有 `Co-Authored-By:` 與 `Claude-Session:` 兩行。
- **不得 `Math.random`** —— 決定性是 `replayDigest` 的前提。用 LCG 或整數雜湊。
- **`src/ai/` 的熱路徑不得配置**；`src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- **`perf-gate.test.ts` 與 `rematch.test.ts` 必須單獨跑。**
- **每一條新測試都要先驗紅**，或用變異證明它承重。
- **註解寫現狀，不寫沿革** —— 可調參數就地改掉，不要在註解裡疊歷史。
- **護欄紅了要回報，不得自己放寬。** 重新定值是專案負責人的決定。
- **`'archipelago'` 與 `'sea'` 的行為一個位元都不能變。**
- 掃描參數時用 `cp` 備份還原，**不要用 `git checkout`**。

---

### Task 1: 田區的 Voronoi —— 單一真相，CPU 與 GLSL 共用同一組常數

**Files:**
- Create: `src/render/fields.ts`
- Test: `test/unit/fields.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `FIELD_SPACING: number`、`FIELD_JITTER: number`、`HEDGE_WIDTH: number`
  - `interface FieldSample { f1: number; f2: number; id: number }`
  - `fieldAt(x: number, z: number, out: FieldSample): void`
  - `fieldColor(id: number, out: Color): Color`
  - `FIELD_GLSL: string` —— 由上面同一組常數產生的 GLSL，提供 `vec3 fieldColorAt(vec2 world)`

- [ ] **Step 1: 先寫失敗的測試**

`test/unit/fields.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  fieldAt, fieldColor, FIELD_GLSL, FIELD_JITTER, FIELD_SPACING, HEDGE_WIDTH,
  type FieldSample,
} from '../../src/render/fields'

const s: FieldSample = { f1: 0, f2: 0, id: 0 }

describe('田區的抖動網格 Voronoi', () => {
  it('同一個世界座標恆得到同一塊田', () => {
    fieldAt(1234.5, -8765.25, s)
    const first = s.id
    fieldAt(1234.5, -8765.25, s)
    expect(s.id).toBe(first)
  })

  /**
   * 【為什麼要與 7×7 對答案】3×3 的鄰域搜尋只在抖動 ≤ 0.5 格時保證找得到
   * 最近的種子，而**次近**的那一顆條件更嚴。這一條直接暴力比對，把
   * 「搜尋範圍不夠」這個失效變成測得到的。
   */
  it('3×3 的搜尋與 7×7 的暴力解一致', () => {
    let worst = 0
    for (let z = -900; z <= 900; z += 7) {
      for (let x = -900; x <= 900; x += 7) {
        fieldAt(x, z, s)
        const [b1, b2] = bruteForce(x, z)
        worst = Math.max(worst, Math.abs(s.f1 - b1), Math.abs(s.f2 - b2))
      }
    }
    console.log(JSON.stringify({ 最大誤差: worst.toExponential(2) }))
    expect(worst).toBeLessThan(1e-9)
  })

  it('抖動小於半格 —— 3×3 的前提', () => {
    expect(FIELD_JITTER).toBeLessThan(0.5)
  })

  /**
   * 【帶寬怎麼量】沿一條穿過交界的線走，記錄 `f2 − f1 < HEDGE_WIDTH` 的那一段
   * 有多長。垂直平分線上 `f2 − f1 ≈ 2 × 到平分線的距離`，所以帶的總寬約等於
   * `HEDGE_WIDTH`。斜著穿過去會量到更寬，所以判準是「不短於」。
   */
  it('防風林的帶寬在設定值附近', () => {
    let widest = 0
    let found = 0
    for (let z = -2000; z <= 2000; z += 137) {
      let run = 0
      for (let x = -2000; x <= 2000; x += 0.5) {
        fieldAt(x, z, s)
        if (s.f2 - s.f1 < HEDGE_WIDTH) { run += 0.5; widest = Math.max(widest, run) }
        else { if (run > 0) found++; run = 0 }
      }
    }
    console.log(JSON.stringify({ 交界數: found, 最寬: widest.toFixed(1) + ' m' }))
    expect(found).toBeGreaterThan(50)
    expect(widest).toBeGreaterThan(HEDGE_WIDTH * 0.8)
  })

  it('田的尺度與間距同量級', () => {
    // 一塊田的直徑應該落在 0.5 ~ 2 倍間距之間
    let maxF1 = 0
    for (let z = -3000; z <= 3000; z += 31) {
      for (let x = -3000; x <= 3000; x += 31) {
        fieldAt(x, z, s)
        maxF1 = Math.max(maxF1, s.f1)
      }
    }
    console.log(JSON.stringify({ 離種子最遠: maxF1.toFixed(1) + ' m', FIELD_SPACING }))
    expect(maxF1).toBeLessThan(FIELD_SPACING)
  })

  it('顏色由 id 決定，而且不是全部同一色', () => {
    const seen = new Set<string>()
    const c = new Color()
    for (let i = 0; i < 400; i++) {
      fieldAt(i * 411.7, i * -233.3, s)
      seen.add(fieldColor(s.id, c).getHexString())
    }
    expect(seen.size).toBeGreaterThan(3)
  })

  /**
   * 【為什麼驗字串】GLSL 跑不進 headless。但這裡的 GLSL 是**由 TS 的常數
   * 產生的**，所以只要那幾個數字有出現在字串裡，兩份就不可能漂 —— 這比
   * `fogFactor` 那種「兩邊各寫一次公式」更強。
   */
  it('GLSL 的常數由 TS 那一份產生', () => {
    expect(FIELD_GLSL).toContain(FIELD_SPACING.toFixed(1))
    expect(FIELD_GLSL).toContain(HEDGE_WIDTH.toFixed(1))
    expect(FIELD_GLSL).toContain(FIELD_JITTER.toFixed(3))
    expect(FIELD_GLSL).toContain('vec3 fieldColorAt(')
  })
})

/** 7×7 的暴力解，回傳最近與次近 */
function bruteForce(x: number, z: number): [number, number] {
  const gx = Math.floor(x / FIELD_SPACING)
  const gz = Math.floor(z / FIELD_SPACING)
  let f1 = Infinity
  let f2 = Infinity
  for (let dj = -3; dj <= 3; dj++) {
    for (let di = -3; di <= 3; di++) {
      const i = gx + di
      const j = gz + dj
      const h = hash2(i, j)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (i + 0.5 + ox) * FIELD_SPACING
      const sz = (j + 0.5 + oz) * FIELD_SPACING
      const d = Math.hypot(x - sx, z - sz)
      if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
    }
  }
  return [f1, f2]
}

/** 與 fields.ts 裡那一支必須相同 —— 測試自己抄一份是刻意的，見上面 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/fields.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/render/fields"`

- [ ] **Step 3: 寫實作**

`src/render/fields.ts`：

```ts
import { Color } from 'three'

/**
 * 田區與防風林。**同一個機制、兩個視覺** —— 抖動網格的 Voronoi，最近的種子
 * 決定田的顏色，最近與次近之差夠小就是兩塊田的交界，也就是防風林。
 *
 * 【為什麼不烘貼圖】要讓 26 m 的防風林不鋸齒，30 km 見方需要 4096² 的貼圖
 * （7.3 m/texel），RGB 是 50 MB。在著色器裡算是解析的、與解析度無關，
 * **而且延伸到無限遠** —— 遠景平地用同一支函式，圖案自動接得上。
 *
 * 【為什麼這不違背「不用 noise 函式庫」】`archipelago.ts` 的檔頭要的是
 * 「決定性天然成立、沒有第三方相依」。整數雜湊的閉式函數兩條都成立。
 *
 * 【GLSL 由這裡的常數產生，不是另抄一份】`fogFactor` 那種「CPU 一份、
 * GLSL 一份」靠測試釘住，這裡更省事：字串是模板，數字只有一個來源。
 */

/** 種子網格的間距，m。一塊田的直徑就是這個量級 */
export const FIELD_SPACING = 340

/**
 * 種子在自己那一格內的抖動，格的比例。
 *
 * **必須 < 0.5** —— 3×3 的鄰域搜尋要找得到最近與次近的種子，前提是任何
 * 種子都不會跑出自己那一格。`fields.test.ts` 拿 7×7 的暴力解對答案。
 */
export const FIELD_JITTER = 0.38

/**
 * 防風林的帶寬，m。
 *
 * 【它是 `f2 − f1` 的門檻，不是幾何寬度】在垂直平分線附近
 * `f2 − f1 ≈ 2 × 到平分線的距離`，所以帶的總寬約等於這個數字。斜著穿過去
 * 會更寬，那是對的 —— 樹籬本來就不是等寬的。
 */
export const HEDGE_WIDTH = 26

/** 作物色。犁過的褐、幾種綠、麥黃、牧草 */
const PALETTE = [
  0x6b7f4a, 0x54683c, 0x7d8b52, 0x8f7a3e,
  0xa39152, 0x5f7444, 0x6e5c3a, 0x87954f,
] as const

/** 防風林的顏色。比任何一塊田都暗 —— 從空中看就是一條深線 */
const HEDGE = 0x2c3a24

export interface FieldSample {
  /** 到最近那顆種子的距離，m */
  f1: number
  /** 到次近那顆種子的距離，m */
  f2: number
  /** 最近那一格的雜湊。田的身分 */
  id: number
}

/**
 * 32 位元的兩維整數雜湊。**不得 `Math.random`** —— 見檔頭。
 *
 * 【與 `scatter.ts` 的 `hash01` 為什麼不共用】那一支吃一個索引，這裡要
 * 兩個座標而且要拿到 32 位元全部（低 16 位與高 16 位各給一個方向的抖動）。
 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}

/**
 * 世界座標 (x, z) 落在哪一塊田、離交界多遠。就地寫進 `out`。
 *
 * 熱路徑之外（測試與工具用；畫面上跑的是 GLSL 那一份），但仍然不配置。
 */
export function fieldAt(x: number, z: number, out: FieldSample): void {
  const gx = Math.floor(x / FIELD_SPACING)
  const gz = Math.floor(z / FIELD_SPACING)
  let f1 = Infinity
  let f2 = Infinity
  let id = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = gx + di
      const j = gz + dj
      const h = hash2(i, j)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (i + 0.5 + ox) * FIELD_SPACING
      const sz = (j + 0.5 + oz) * FIELD_SPACING
      const d = Math.hypot(x - sx, z - sz)
      if (d < f1) { f2 = f1; f1 = d; id = h } else if (d < f2) f2 = d
    }
  }
  out.f1 = f1
  out.f2 = f2
  out.id = id
}

/** 田的顏色。`id` 是 `fieldAt` 給的雜湊 */
export function fieldColor(id: number, out: Color): Color {
  return out.setHex(PALETTE[(id >>> 8) % PALETTE.length]!)
}

const glslPalette = PALETTE
  .map((c) => {
    const t = new Color().setHex(c)
    return `  vec3(${t.r.toFixed(4)}, ${t.g.toFixed(4)}, ${t.b.toFixed(4)})`
  })
  .join(',\n')

const hedge = new Color().setHex(HEDGE)

/**
 * 上面那一切的 GLSL。**數字全部由上面的常數插值進來**，所以兩份不可能漂。
 *
 * 提供 `vec3 fieldColorAt(vec2 world)` —— 細節地形與遠景平地共用它，
 * 而且因為吃的是**世界座標**，網格跟著鏡頭走時圖案照樣釘在地上。
 */
export const FIELD_GLSL = `
const float FIELD_SPACING = ${FIELD_SPACING.toFixed(1)};
const float FIELD_JITTER = ${FIELD_JITTER.toFixed(3)};
const float HEDGE_WIDTH = ${HEDGE_WIDTH.toFixed(1)};
const vec3 HEDGE_COLOR = vec3(${hedge.r.toFixed(4)}, ${hedge.g.toFixed(4)}, ${hedge.b.toFixed(4)});
const vec3 FIELD_PALETTE[${PALETTE.length}] = vec3[${PALETTE.length}](
${glslPalette}
);

// 與 fields.ts 的 hash2 逐位元相同。GLSL 沒有 imul，但 uint 乘法本來就是
// 模 2³²，所以直接乘就是同一件事
uint fieldHash2(int i, int j) {
  uint h = uint(i) * 0x27d4eb2du ^ uint(j) * 0x85ebca6bu;
  h = (h ^ (h >> 15u)) * 0x2545f491u;
  return h ^ (h >> 13u);
}

vec3 fieldColorAt(vec2 world) {
  float gx = floor(world.x / FIELD_SPACING);
  float gz = floor(world.y / FIELD_SPACING);
  float f1 = 1e20;
  float f2 = 1e20;
  uint id = 0u;
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = int(gx) + di;
      int j = int(gz) + dj;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * FIELD_SPACING;
      float d = distance(world, seed);
      if (d < f1) { f2 = f1; f1 = d; id = h; }
      else if (d < f2) { f2 = d; }
    }
  }
  if (f2 - f1 < HEDGE_WIDTH) return HEDGE_COLOR;
  return FIELD_PALETTE[int((id >> 8u) % uint(${PALETTE.length}))];
}
`
```

- [ ] **Step 4: 跑測試確認它綠**

Run: `npx vitest run test/unit/fields.test.ts`
Expected: PASS，7 條

- [ ] **Step 5: 變異驗證這批測試承重**

把 `fieldAt` 的搜尋範圍由 `-1..1` 改成 `0..0`，重跑：「3×3 的搜尋與 7×7 的暴力解一致」必須紅。改回來。

- [ ] **Step 6: Commit**

```bash
git add src/render/fields.ts test/unit/fields.test.ts
git commit -F <訊息檔>
```

---

### Task 2: 把 `bake` 抽成吃 `floor` 參數的版本

**Files:**
- Modify: `src/world/archipelago.ts`（`bake` → `bakeRelief`）
- Test: `test/unit/archipelago.test.ts`（既有的 19 條就是護欄，不新增）

**Interfaces:**
- Consumes: Task 1 無
- Produces: `export function bakeRelief(field: HeightFieldData, islands: readonly IslandDesc[], floor: number): void`

- [ ] **Step 1: 先確認既有測試全綠（這一步是基準線）**

Run: `npx vitest run test/unit/archipelago.test.ts`
Expected: PASS，19 條

- [ ] **Step 2: 改實作**

`src/world/archipelago.ts`：把現有的 `function bake(field, islands)` 改名並加一個參數，內部把兩處 `SEA_FLOOR` 換成 `floor`：

```ts
/**
 * 把島（或丘陵）烘進高度場。**`floor` 是沒有任何瓣蓋到的地方的高度。**
 *
 * 【為什麼要參數化】群島的島緣必須沉到水下（見 `SEA_FLOOR`），而內陸農地的
 * 基準平原就是 `0`。兩者只差這一個數字，其餘逐字相同 —— 複製一份的代價是
 * 「多瓣怎麼取 max」以後只會有一邊被修好。
 */
export function bakeRelief(
  field: HeightFieldData, islands: readonly IslandDesc[], floor: number,
): void {
  const { size, cell, data } = field
  const half = (size - 1) / 2
  const last = size - 1
  data.fill(floor)

  for (let k = 0; k < islands.length; k++) {
    const isl = islands[k]!
    const c0 = Math.max(0, Math.floor((isl.cx - isl.outerRadius) / cell + half))
    const c1 = Math.min(last, Math.ceil((isl.cx + isl.outerRadius) / cell + half))
    const r0 = Math.max(0, Math.floor((isl.cz - isl.outerRadius) / cell + half))
    const r1 = Math.min(last, Math.ceil((isl.cz + isl.outerRadius) / cell + half))

    for (let row = r0; row <= r1; row++) {
      const z = (row - half) * cell
      const dz = z - isl.cz
      for (let col = c0; col <= c1; col++) {
        const x = (col - half) * cell
        const dx = x - isl.cx
        if (Math.hypot(dx, dz) > isl.outerRadius) continue

        let h = floor
        for (const lo of isl.lobes) {
          const lx = x - lo.cx
          const lz = z - lo.cz
          const d = Math.hypot(lx, lz)
          if (d > lo.radius * WOBBLE_MAX) continue
          const theta = Math.atan2(lz, lx)
          const wobble = 1
            + WOBBLE_A * Math.sin(3 * theta + lo.pa)
            + WOBBLE_B * Math.sin(5 * theta + lo.pb)
          const s = smoothstep(1, 0, d / lo.radius / wobble)
          const hl = lo.peak * s + floor * (1 - s)
          if (hl > h) h = hl
        }
        const i = row * size + col
        if (h > data[i]!) data[i] = h
      }
    }
  }
}
```

在 `createArchipelago` 裡把 `bake(field, islands)` 改成 `bakeRelief(field, islands, SEA_FLOOR)`。

- [ ] **Step 3: 跑測試確認行為逐位元不變**

Run: `npx vitest run test/unit/archipelago.test.ts test/unit/terrain-sense.test.ts test/unit/ocean.test.ts`
Expected: PASS，全部

- [ ] **Step 4: Commit**

```bash
git add src/world/archipelago.ts
git commit -F <訊息檔>
```

---

### Task 3: `world/farmland.ts` —— 高度場與丘陵

**Files:**
- Create: `src/world/farmland.ts`
- Test: `test/unit/farmland.test.ts`

**Interfaces:**
- Consumes: `bakeRelief`（Task 2）、`makeLobes` / `LobeDraw` / `IslandDesc` / `WOBBLE_MAX`（既有的 `archipelago.ts`）
- Produces:
  - `FARM_SIZE = 376`、`FARM_CELL = 80`、`FARM_EXTENT = 30000`、`HILL_PEAK_MAX = 120`、`HILL_LIMIT = 14000`
  - `createFarmland(): { field: HeightFieldData; hills: IslandDesc[] }`

- [ ] **Step 1: 先寫失敗的測試**

`test/unit/farmland.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  createFarmland, FARM_CELL, FARM_EXTENT, FARM_SIZE, HILL_LIMIT, HILL_PEAK_MAX,
} from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'

const farm = createFarmland()

describe('內陸農地的高度場', () => {
  it('尺寸就是 30 km 見方', () => {
    expect(FARM_SIZE).toBe(376)
    expect(FARM_CELL).toBe(80)
    expect(FARM_EXTENT).toBe((FARM_SIZE - 1) * FARM_CELL)
    expect(FARM_EXTENT).toBe(30000)
  })

  it('沒有丘陵的地方恰好是 0', () => {
    // 場地的四個角落 —— HILL_LIMIT 之外
    for (const [x, z] of [[-14900, -14900], [14900, -14900], [-14900, 14900], [14900, 14900]]) {
      expect(farm.field.sample(x!, z!)).toBe(0)
    }
  })

  it('沒有一格是負的', () => {
    let min = Infinity
    for (const h of farm.field.data) if (h < min) min = h
    expect(min).toBe(0)
  })

  it('峰不超過上限', () => {
    let max = -Infinity
    for (const h of farm.field.data) if (h > max) max = h
    console.log(JSON.stringify({ 最高: max.toFixed(1) + ' m', 丘陵數: farm.hills.length }))
    expect(max).toBeLessThanOrEqual(HILL_PEAK_MAX)
    expect(max).toBeGreaterThan(HILL_PEAK_MAX * 0.6)
  })

  /**
   * 【為什麼要有這一條】丘陵被場地邊界切掉的話，外圈會出現一道垂直的崖，
   * 而遠景平地是平的 —— 接縫會變成畫面上一條看得見的線。
   */
  it('每一顆丘陵的地形都在 HILL_LIMIT 之內', () => {
    let worst = -Infinity
    for (const h of farm.hills) {
      worst = Math.max(worst, Math.hypot(h.cx, h.cz) + h.outerRadius - HILL_LIMIT)
    }
    console.log(JSON.stringify({ 最大溢出: worst.toFixed(1) + ' m' }))
    expect(worst).toBeLessThanOrEqual(0)
  })

  it('丘陵的每一瓣都放得下', () => {
    let worst = -Infinity
    for (const h of farm.hills) {
      for (const lo of h.lobes) {
        worst = Math.max(worst, lo.offset + lo.radius * WOBBLE_MAX - h.outerRadius)
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-6)
  })

  /**
   * 【起伏真的存在】與上一輪的島同一條代理判準：沿一條線走出去不是單調的。
   * 單瓣的錐子保證單調，多瓣才有鞍部。
   */
  it('每一顆丘陵都有一條半徑不是單調遞減的', () => {
    let flat = 0
    for (const h of farm.hills) {
      let rose = false
      for (let a = 0; a < Math.PI * 2 && !rose; a += Math.PI / 12) {
        let min = Infinity
        for (let r = 0; r <= h.outerRadius; r += 5) {
          const v = farm.field.sample(h.cx + Math.cos(a) * r, h.cz + Math.sin(a) * r)
          if (v > min + 0.5) { rose = true; break }
          if (v < min) min = v
        }
      }
      if (!rose) flat++
    }
    console.log(JSON.stringify({ 沒有起伏的丘陵: flat, 總數: farm.hills.length }))
    expect(flat).toBe(0)
  })

  it('決定性 —— 兩次生成逐位元相同', () => {
    const b = createFarmland()
    expect(b.hills.length).toBe(farm.hills.length)
    for (let i = 0; i < farm.field.data.length; i++) {
      expect(b.field.data[i]).toBe(farm.field.data[i])
    }
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/farmland.test.ts`
Expected: FAIL —— 找不到 `src/world/farmland`

- [ ] **Step 3: 寫實作**

`src/world/farmland.ts`：

```ts
import { createHeightField, type HeightFieldData } from './heightfield'
import {
  bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc, type LobeDraw,
} from './archipelago'

/**
 * 內陸農地的生成器。
 *
 * 【與群島的關係】起伏用的是同一套多瓣機制（`makeLobes` / `bakeRelief`），
 * 差別只有兩個數字：基準面是 `0` 而不是 `SEA_FLOOR`，尺度由「島」換成「丘陵」。
 * **不抽共用模組** —— 抽出來會讓 `archipelago.test.ts` 的 19 條變成在測另一個
 * 檔案，而那批測試正是這次改動唯一的安全網。
 *
 * 【丘陵為什麼用 `IslandDesc`】名字不精確，但換到的是 AI 的避障、
 * `terrainCeiling`、`checkClimb`、遮蔽判斷一行都不用改。`islands: []` 的話
 * AI 對地形會完全沒有感知，而貼地纏鬥正是這張圖最常發生的事。
 */

/** 高度場的邊長頂點數。376 × 80 m = 30 km 見方 */
export const FARM_SIZE = 376

/**
 * 格距，m。
 *
 * 【為什麼比群島的 40 粗一倍】30 km 見方在 40 m 下是 1.125 M 個三角形，
 * 是現在整個場景（陸地 126k + 海面 287k）的 2.7 倍。80 m 下是 281k，而純內陸
 * 把海面整個拿掉了，所以總量反而下降。
 *
 * 【粗格不會讓畫面變空】田與防風林是片段著色器算的，銳利度與網格密度脫鉤。
 */
export const FARM_CELL = 80

/** 場地的邊長，m */
export const FARM_EXTENT = (FARM_SIZE - 1) * FARM_CELL

/** 丘陵的峰高上限，m。`LandField.ceiling` 用它 */
export const HILL_PEAK_MAX = 120

/**
 * 丘陵的地形不得超出這個半徑，m。
 *
 * 【為什麼要留一圈】場地半徑是 15,000，而丘陵被邊界切掉的話外圈會出現一道
 * 垂直的崖；遠景平地是平的，接縫會變成畫面上一條線。留 1 km 的平地讓兩者
 * 在 `y = 0` 上接得上。
 */
export const HILL_LIMIT = 14000

/** 丘陵中心的候選網格。11 × 11 = 121 個候選，落在 HILL_LIMIT 外的丟掉 */
const HILL_GRID = 11
const HILL_STEP = 2400
const HILL_JITTER = 800
const HILL_RADIUS = [1000, 1800] as const
const HILL_PEAK = [40, HILL_PEAK_MAX] as const
/** 每顆丘陵除主瓣外的瓣數。與群島同一個理由：固定，不隨機 */
const HILL_LOBES = 4
const HILL_LOBE_RADIUS = [0.30, 0.48] as const

/** 亂數的種子。私有 —— 與 `archipelago.ts` 同一個理由 */
const SEED = 20260828

function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function createFarmland(): { field: HeightFieldData; hills: IslandDesc[] } {
  const rand = makeRand(SEED)
  const between = (lo: number, hi: number): number => lo + rand() * (hi - lo)
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []

  const first = -((HILL_GRID - 1) / 2) * HILL_STEP
  for (let j = 0; j < HILL_GRID; j++) {
    for (let i = 0; i < HILL_GRID; i++) {
      // 【所有 rand() 都要無條件抽完，篩選在之後】與 `archipelago.ts` 的
      // rejection sampling 同一個理由：條件式的抽樣會讓序列漂
      const cx = first + i * HILL_STEP + between(-HILL_JITTER, HILL_JITTER)
      const cz = first + j * HILL_STEP + between(-HILL_JITTER, HILL_JITTER)
      const radius = between(HILL_RADIUS[0], HILL_RADIUS[1])
      const peak = between(HILL_PEAK[0], HILL_PEAK[1])
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2
      const draws: LobeDraw[] = []
      for (let k = 0; k < HILL_LOBES; k++) {
        draws.push({
          dir: rand() * Math.PI * 2,
          rf: HILL_LOBE_RADIUS[0] + rand() * (HILL_LOBE_RADIUS[1] - HILL_LOBE_RADIUS[0]),
          uOff: rand(),
          uPeak: rand(),
          pa: rand() * Math.PI * 2,
          pb: rand() * Math.PI * 2,
        })
      }

      const outerRadius = radius * WOBBLE_MAX
      if (Math.hypot(cx, cz) + outerRadius > HILL_LIMIT) continue

      hills.push({
        cx, cz, radius, outerRadius, peak,
        lobes: makeLobes(cx, cz, radius, outerRadius, peak, pa, pb, draws),
      })
    }
  }

  // 【基準面是 0，不是負的】內陸沒有海，島緣沉到水下那條理由不存在
  bakeRelief(field, hills, 0)
  return { field, hills }
}
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/farmland.test.ts`
Expected: PASS，8 條。記下 log 印出的丘陵數與最高點。

- [ ] **Step 5: 變異驗證**

把 `HILL_LOBES` 改成 0，重跑：「每一顆丘陵都有一條半徑不是單調遞減的」必須紅。改回來。

- [ ] **Step 6: Commit**

```bash
git add src/world/farmland.ts test/unit/farmland.test.ts
git commit -F <訊息檔>
```

---

### Task 4: `occlusion` 的 `landAbove`

**Files:**
- Modify: `src/world/occlusion.ts:37`（`SEA`）、`:96`、`:129`、`LandField`
- Modify: `src/render/terrain.ts`（群島那一支補 `landAbove: 0`）
- Test: `test/unit/occlusion.test.ts`

**Interfaces:**
- Produces: `LandField` 多一個欄位 `readonly landAbove: number`

- [ ] **Step 1: 先寫失敗的測試**

在 `test/unit/occlusion.test.ts` 末尾加：

```ts
describe('地面的判準由 landAbove 決定', () => {
  /**
   * 【為什麼需要它】群島的判準是 `h > 0`（海平面），而內陸的基準平原**正好
   * 等於 0** —— 平地上的視線與彈丸會完全不被擋，症狀是子彈鑽進田裡不噴土、
   * 飛到 SEA_KILL_Y = −20 才靜靜消失。
   */
  it('農地：貼著地面的視線被平地擋住', () => {
    const field = createHeightField(9, 100)   // 全零，也就是內陸的基準平原
    const land = { field, ceiling: 120, landAbove: -Infinity }
    // 由 −1 m 拉到 −1 m：整段都在地面之下
    expect(losBlocked(-300, -1, 0, 300, -1, 0, land)).toBe(true)
  })

  it('群島：同一條視線不被海面擋住', () => {
    const field = createHeightField(9, 100)
    const land = { field, ceiling: 120, landAbove: 0 }
    expect(losBlocked(-300, -1, 0, 300, -1, 0, land)).toBe(false)
  })

  it('農地：彈丸打進平地會回一個有限的 t', () => {
    const field = createHeightField(9, 100)
    const land = { field, ceiling: 120, landAbove: -Infinity }
    const t = landHitT(0, 50, 0, 0, -50, 300, land)
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(1)
  })
})
```

（`createHeightField`、`losBlocked`、`landHitT` 的 import 依該檔既有的寫法補齊。）

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/occlusion.test.ts`
Expected: FAIL —— `landAbove` 不在 `LandField` 上（TS 錯），或行為不對

- [ ] **Step 3: 改實作**

`src/world/occlusion.ts`：

```ts
export interface LandField {
  /** 與 `render/island.ts` 切 mesh 用的是同一份 */
  readonly field: HeightFieldData
  /** 全場陸地的最高點，m。兩端都高於它就不必查 */
  readonly ceiling: number
  /**
   * **高過這個值才算陸地**，m。群島是 `0`（海平面），內陸是 `-Infinity`。
   *
   * 【為什麼群島那一條不能一起改成 −Infinity】高度場沒有島的地方是
   * `SEA_FLOOR = −8` —— 一發入海的子彈會在水下 8 m 被當成撞地、爆一朵火花
   * 並提早消失。而現行行為是在 y = 0 推水柱、到 `SEA_KILL_Y = −20` 才回收。
   *
   * 【為什麼內陸非改不可】內陸的基準平原正好是 `0`，而 `h > 0` 對它恆為假
   * —— 平地上的視線與彈丸會完全不被擋。
   */
  readonly landAbove: number
}
```

刪掉 `const SEA = 0` 與它上面那段註解（那段說明搬進 `landAbove` 的文件註解）。
把兩處判準改掉：

```ts
// 第 96 行附近
if (h > land.landAbove && ay + (by - ay) * t < h) return true
// 第 129 行附近
if (h > land.landAbove && ay + dy * t <= h) return t
```

`src/render/terrain.ts` 的群島分支：

```ts
land: { field, ceiling: PEAK_MAX, landAbove: 0 },
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/occlusion.test.ts test/unit/terrain.test.ts`
Expected: PASS。**既有的每一條都必須綠** —— `landAbove: 0` 讓群島逐位元不變。

- [ ] **Step 5: 跑會用到遮蔽的整合測試**

Run: `npx vitest run test/integration/terrain-occlusion.test.ts test/integration/turrets.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/world/occlusion.ts src/render/terrain.ts test/unit/occlusion.test.ts
git commit -F <訊息檔>
```

---

### Task 5: `render/farmGround.ts` —— 切塊的細節地形

**Files:**
- Create: `src/render/farmGround.ts`
- Test: `test/unit/farm-ground.test.ts`

**Interfaces:**
- Consumes: `FIELD_GLSL`（Task 1）、`HeightFieldData`
- Produces: `createFarmGround(field: HeightFieldData): { object: Object3D; dispose(): void }`

- [ ] **Step 1: 先寫失敗的測試**

`test/unit/farm-ground.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, type BufferAttribute } from 'three'
import { createFarmGround, FARM_CHUNKS } from '../../src/render/farmGround'
import { createFarmland } from '../../src/world/farmland'

const farm = createFarmland()
const ground = createFarmGround(farm.field)
const meshes = ground.object.children.filter((c): c is Mesh => c instanceof Mesh)

describe('農地的切塊 mesh', () => {
  it('切成 FARM_CHUNKS² 塊', () => {
    expect(meshes.length).toBe(FARM_CHUNKS * FARM_CHUNKS)
  })

  /**
   * 【這是 `render/terrain.ts` 那條鐵律】畫出來的頂點與撞地判定查到的
   * 必須是同一個數字。只要 mesh 改成自己再算一次高度，兩份就開始漂，
   * 而症狀是飛機撞到一片看不見的陸地。
   */
  it('每一個頂點的高度就是 field.data 裡的那一個', () => {
    let worst = 0
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position') as BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const y = pos.getY(i)
        const z = pos.getZ(i)
        worst = Math.max(worst, Math.abs(y - farm.field.sample(x, z)))
      }
    }
    expect(worst).toBe(0)
  })

  it('不帶頂點色 —— 顏色全部由片段著色器算', () => {
    for (const m of meshes) expect(m.geometry.getAttribute('color')).toBeUndefined()
  })

  it('每一塊都有自己的包圍球，可以被視錐剔除', () => {
    for (const m of meshes) {
      expect(m.geometry.boundingSphere).not.toBeNull()
      expect(m.frustumCulled).toBe(true)
    }
  })

  it('三角形總數是 375² × 2', () => {
    let tris = 0
    for (const m of meshes) tris += m.geometry.getIndex()!.count / 3
    expect(tris).toBe(375 * 375 * 2)
  })

  it('材質是平面著色，而且注入了田的 GLSL', () => {
    const m = meshes[0]!
    const mat = Array.isArray(m.material) ? m.material[0]! : m.material
    expect((mat as { flatShading: boolean }).flatShading).toBe(true)
    // onBeforeCompile 在 headless 不會被呼叫 —— 手動餵一個假 shader 物件
    const shader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>', uniforms: {} }
    ;(mat as unknown as { onBeforeCompile: (s: typeof shader) => void }).onBeforeCompile(shader)
    expect(shader.fragmentShader).toContain('fieldColorAt')
    expect(shader.vertexShader).toContain('vFarmWorld')
  })

  /**
   * 【為什麼掛事件而不是看屬性】`BufferGeometry.dispose()` 只發一個事件，
   * 屬性仍然留在物件上 —— 用 `attributes.position` 判斷會恆為綠。
   * 與 `terrain.test.ts` 的那一條同一個手法。
   */
  it('dispose 真的釋放每一塊的 geometry 與那份共用的材質', () => {
    const g = createFarmGround(farm.field)
    const pending = new Set<object>()
    for (const c of g.object.children) {
      if (!(c instanceof Mesh)) continue
      pending.add(c.geometry)
      c.geometry.addEventListener('dispose', () => { pending.delete(c.geometry) })
      const mat = Array.isArray(c.material) ? c.material[0]! : c.material
      if (!pending.has(mat)) {
        pending.add(mat)
        mat.addEventListener('dispose', () => { pending.delete(mat) })
      }
    }
    // 25 塊 geometry + 1 份共用材質
    expect(pending.size).toBe(FARM_CHUNKS * FARM_CHUNKS + 1)
    g.dispose()
    expect(pending.size).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/farm-ground.test.ts`
Expected: FAIL —— 找不到 `src/render/farmGround`

- [ ] **Step 3: 寫實作**

`src/render/farmGround.ts`：

```ts
import {
  BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial,
  type Object3D, type WebGLProgramParametersWithUniforms,
} from 'three'
import { FIELD_GLSL } from './fields'
import type { HeightFieldData } from '../world/heightfield'

/**
 * 把農地的高度場切成 low-poly 的地面。
 *
 * 【頂點高度直接讀 `field.data`，不重算】與 `render/island.ts` 同一條鐵律：
 * 畫出來的頂點與撞地判定查到的值必須是同一個數字。
 *
 * 【為什麼不帶頂點色】島那一支把三段高度色（沙／草／岩）烘進頂點屬性，
 * 那一套對農地沒有意義，而且 80 m 的格會把田的邊界糊成一格寬的漸層。
 * 顏色全部由片段著色器算 —— 見 `fields.ts`。
 *
 * 【平面著色仍然開著】起伏的面由光照分出來，田的邊界由片段分出來。
 * 兩者互不干擾，這正是「大片多邊形」與「大片田」可以同時成立的原因。
 *
 * 【為什麼切塊】5 × 5 = 25 塊，每塊 6 km 見方、各有包圍球，所以背對著的
 * 半張圖不會進畫面。比現在群島的 48 個 draw call 還少。
 */

/** 每一邊切幾塊。375 格 ÷ 5 = 75 格／塊 = 6,000 m */
export const FARM_CHUNKS = 5

const ROUGHNESS = 0.95

/** 一塊地的 geometry。`c0/r0` 是這一塊的起始格點索引，`n` 是格數 */
function buildChunk(
  field: HeightFieldData, c0: number, r0: number, n: number,
): BufferGeometry {
  const { size, cell, data } = field
  const half = (size - 1) / 2
  const nv = n + 1

  const positions = new Float32Array(nv * nv * 3)
  for (let j = 0; j < nv; j++) {
    const row = r0 + j
    const z = (row - half) * cell
    for (let i = 0; i < nv; i++) {
      const col = c0 + i
      const v = (j * nv + i) * 3
      positions[v] = (col - half) * cell
      positions[v + 1] = data[row * size + col]!
      positions[v + 2] = z
    }
  }

  // 【對角線的方向必須跟著 heightfield.ts 的 sample】那裡是 a,c,b 與 b,c,d，
  // 對角線是 b–c。動了這裡就要動那裡，否則格子內部兩份會分家
  const indices = new Uint32Array(n * n * 6)
  let k = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * nv + i
      const b = a + 1
      const c = a + nv
      const d = c + 1
      indices[k++] = a; indices[k++] = c; indices[k++] = b
      indices[k++] = b; indices[k++] = c; indices[k++] = d
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setIndex(new BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 把田的顏色注入一個 `MeshStandardMaterial`。**遠景平地共用這一支** ——
 * 兩邊的圖案因此不可能對不上。
 *
 * 【為什麼取樣用 `modelMatrix` 算出來的世界座標】遠景平地會跟著鏡頭平移，
 * 而圖案必須釘在地上。吃世界座標的話，網格往前移一公里、取樣點跟著移一
 * 公里，畫出來的田原地不動 —— 與近海用 `uOrigin` 把波的相位釘在世界座標
 * 是同一個手法。
 */
export function applyFields(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vFarmWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFarmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFarmWorld;
${FIELD_GLSL}`)
      // 【換掉整個 color_fragment】那個 chunk 的工作就是把頂點色乘進
      // diffuseColor，而農地沒有頂點色 —— 顏色的來源就是這裡
      .replace('#include <color_fragment>', `
diffuseColor.rgb = fieldColorAt(vFarmWorld.xz);`)
  }
  // 【換了著色器就要換 key】three 用它決定程式能不能重用
  material.customProgramCacheKey = () => 'farm-fields'
}

export function createFarmGround(
  field: HeightFieldData,
): { object: Object3D; dispose(): void } {
  const group = new Group()
  const material = new MeshStandardMaterial({ flatShading: true, roughness: ROUGHNESS })
  applyFields(material)

  const n = (field.size - 1) / FARM_CHUNKS
  const geometries: BufferGeometry[] = []
  for (let j = 0; j < FARM_CHUNKS; j++) {
    for (let i = 0; i < FARM_CHUNKS; i++) {
      const geo = buildChunk(field, i * n, j * n, n)
      geometries.push(geo)
      group.add(new Mesh(geo, material))
    }
  }

  return {
    object: group,
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/farm-ground.test.ts`
Expected: PASS，7 條

- [ ] **Step 5: 變異驗證**

把 `buildChunk` 的 `positions[v + 1]` 改成 `0`，重跑：「每一個頂點的高度就是 `field.data` 裡的那一個」必須紅。改回來。

- [ ] **Step 6: Commit**

```bash
git add src/render/farmGround.ts test/unit/farm-ground.test.ts
git commit -F <訊息檔>
```

---

### Task 6: `render/farHorizon.ts` —— 跟著鏡頭的遠景平地

**Files:**
- Create: `src/render/farHorizon.ts`
- Test: `test/unit/far-horizon.test.ts`

**Interfaces:**
- Consumes: `applyFields`（Task 5）
- Produces: `createFarHorizon(): { mesh: Mesh; update(centerX: number, centerZ: number): void; dispose(): void }`、`FAR_GROUND_SIZE`

- [ ] **Step 1: 先寫失敗的測試**

`test/unit/far-horizon.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { MeshStandardMaterial } from 'three'
import { createFarHorizon, FAR_GROUND_SIZE } from '../../src/render/farHorizon'

describe('遠景平地', () => {
  const h = createFarHorizon()

  it('跟著鏡頭走，而且不吸附', () => {
    h.update(1234.5, -6789.25)
    expect(h.mesh.position.x).toBe(1234.5)
    expect(h.mesh.position.z).toBe(-6789.25)
  })

  /**
   * 【為什麼 y 是 0 而不是沉下去】群島靠 SEA_FLOOR = −8 把島緣沉到水下、
   * 讓海面蓋在上面。內陸兩者都是地面，那招搬不過來 —— 相機遠平面 5,000 km，
   * 深度緩衝在幾十公里外分不出幾公尺。改用畫家順序：不寫深度、先畫。
   */
  it('與基準平原共面，靠不寫深度避開 z-fighting', () => {
    expect(h.mesh.position.y).toBe(0)
    const mat = h.mesh.material as MeshStandardMaterial
    expect(mat.depthWrite).toBe(false)
    expect(h.mesh.renderOrder).toBe(-900)
  })

  it('先於一切地面畫，但在天空之後', () => {
    // sky.ts 是 −1000
    expect(h.mesh.renderOrder).toBeGreaterThan(-1000)
    expect(h.mesh.renderOrder).toBeLessThan(0)
  })

  it('不做視錐剔除 —— 它永遠可見', () => {
    expect(h.mesh.frustumCulled).toBe(false)
  })

  it('夠大到看不見邊', () => {
    // 霧在 100 km 吃掉 86%，2,000 km 綽綽有餘
    expect(FAR_GROUND_SIZE).toBeGreaterThanOrEqual(2_000_000)
  })

  it('與細節地形用同一支田的著色器', () => {
    const mat = h.mesh.material as MeshStandardMaterial
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
      uniforms: {},
    }
    ;(mat as unknown as { onBeforeCompile: (s: typeof shader) => void }).onBeforeCompile(shader)
    expect(shader.fragmentShader).toContain('fieldColorAt')
  })

  it('dispose 真的釋放 geometry 與材質', () => {
    const g = createFarHorizon()
    const pending = new Set<object>([g.mesh.geometry, g.mesh.material as object])
    g.mesh.geometry.addEventListener('dispose', () => { pending.delete(g.mesh.geometry) })
    ;(g.mesh.material as { addEventListener(t: string, f: () => void): void })
      .addEventListener('dispose', () => { pending.delete(g.mesh.material as object) })
    g.dispose()
    expect(pending.size).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/far-horizon.test.ts`
Expected: FAIL —— 找不到 `src/render/farHorizon`

- [ ] **Step 3: 寫實作**

`src/render/farHorizon.ts`：

```ts
import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { applyFields } from './farmGround'

/**
 * 遠景平地 —— 細節地形之外的那一片。
 *
 * 【照抄 `ocean.ts` 的遠海】一片跟著相機的大平面。差別在遠海是純色，
 * 這裡有田：`applyFields` 吃的是**世界座標**，所以網格往前移一公里、
 * 取樣點跟著移一公里，畫出來的田原地不動。
 *
 * 【跟著鏡頭但不吸附】與遠海同一個理由：它是平的、沒有面可言，精確跟才
 * 不會在極端座標下累積偏差。近海要吸附是因為頂點在格點之間滑動會讓面的
 * 形狀逐幀改變 —— 這裡沒有那個問題。
 *
 * 【深度用畫家順序解，不用 y 位移】它與細節地形都是地面，群島那招
 * （沉到水下、讓海面蓋在上面）搬不過來：相機遠平面 5,000 km，深度緩衝在
 * 幾十公里外分不出幾公尺，而細節地形的角落離中心 21 km。改用天空球那一招
 * —— **不寫深度、先畫**，細節地形之後畫上去一定蓋得過。世界上沒有東西該
 * 被它擋住（它是最低的一層），所以不寫深度沒有代價。
 */

/** 邊長，m。霧在 100 km 吃掉 86%，2,000 km 遠遠看不到邊 */
export const FAR_GROUND_SIZE = 2_000_000

/**
 * 細分數。
 *
 * 【為什麼不是一個大四邊形】田的取樣座標由頂點的世界座標透視插值而來。
 * 整片 2,000 km 只有兩個三角形的話，float32 的量化誤差會讓 26 m 的防風林
 * 在遠處抖 —— 與遠海碎光那次是同一個病（`ocean.ts` 的 `FAR_SEGMENTS`）。
 * 32 段下單格 62.5 km，誤差遠小於一塊田。
 */
const FAR_SEGMENTS = 32

const ROUGHNESS = 0.95

export interface FarHorizon {
  readonly mesh: Mesh
  update(centerX: number, centerZ: number): void
  dispose(): void
}

export function createFarHorizon(): FarHorizon {
  const geometry = new PlaneGeometry(
    FAR_GROUND_SIZE, FAR_GROUND_SIZE, FAR_SEGMENTS, FAR_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

  const material = new MeshStandardMaterial({
    flatShading: false,
    roughness: ROUGHNESS,
    depthWrite: false,
  })
  applyFields(material)

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -900
  // 建立時就擺好，讓「還沒 update 過」的狀態也是一致的（與 sky.ts 同一招）
  mesh.position.y = 0

  return {
    mesh,
    update(centerX, centerZ) {
      mesh.position.set(centerX, 0, centerZ)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/far-horizon.test.ts`
Expected: PASS，7 條

- [ ] **Step 5: Commit**

```bash
git add src/render/farHorizon.ts test/unit/far-horizon.test.ts
git commit -F <訊息檔>
```

---

### Task 7: `createTerrain` 的第三條分支

**Files:**
- Modify: `src/world/terrainKind.ts`
- Modify: `src/render/terrain.ts`
- Modify: `src/ui/menu.ts:70-73`
- Test: `test/unit/terrain.test.ts`

**Interfaces:**
- Consumes: `createFarmland`（Task 3）、`createFarmGround`（Task 5）、`createFarHorizon`（Task 6）
- Produces: `TerrainKind` 多一個值 `'farmland'`

- [ ] **Step 1: 先寫失敗的測試**

在 `test/unit/terrain.test.ts` 加：

```ts
describe('內陸農地', () => {
  const t = createTerrain('farmland')

  it('三個位置的契約照舊', () => {
    // 0 = 遠景平地（遠海那一格）、1 = 空 Group（近海那一格）、2 = 陸地
    expect(t.object.children.length).toBe(3)
    expect(t.object.children[1]!.children.length).toBe(0)
    expect(t.object.children[2]!.children.length).toBe(25)
  })

  /**
   * 【為什麼場外一定要回 0】`field.sample` 出界回 −Infinity，群島靠海面
   * 那一支接住（退回平海面）。純內陸沒有海可退。
   */
  it('細節區之外的地面是 0，不是 −Infinity', () => {
    expect(t.collisionHeightAt(50_000, 50_000)).toBe(0)
    expect(t.heightAt(50_000, 50_000, 0)).toBe(0)
  })

  it('丘陵上的高度就是高度場那一份', () => {
    const h = t.islands[0]!
    expect(t.collisionHeightAt(h.cx, h.cz)).toBeCloseTo(h.peak, 3)
  })

  it('AI 拿得到丘陵', () => {
    expect(t.islands.length).toBeGreaterThan(30)
  })

  it('陸地的判準是 landAbove = −Infinity', () => {
    expect(t.land!.landAbove).toBe(-Infinity)
    expect(t.land!.ceiling).toBe(HILL_PEAK_MAX)
  })

  it('update 把遠景平地移到鏡頭下', () => {
    t.update(0, 7000, -3000)
    expect(t.object.children[0]!.position.x).toBe(7000)
    expect(t.object.children[0]!.position.z).toBe(-3000)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/terrain.test.ts`
Expected: FAIL —— `'farmland'` 不在 `TerrainKind` 上

- [ ] **Step 3: 改實作**

`src/world/terrainKind.ts`：

```ts
export type TerrainKind = 'sea' | 'archipelago' | 'farmland'
```

把檔頭「還沒做的兩種」那段改成現狀：內陸已經做了，剩「大島海岸線」。

`src/render/terrain.ts` 加分支（放在 `'sea'` 那一段之後、群島之前）：

```ts
if (kind === 'farmland') {
  const farm = createFarmland()
  const horizon = createFarHorizon()
  const ground = createFarmGround(farm.field)
  // 【三個位置的次序與群島相同】索引契約由 `main.ts` 的 `__gfx` 消融表與
  // `src/tools/` 的兩支工具共用
  group.add(horizon.mesh)
  group.add(new Group())
  group.add(ground.object)

  // 【場外回 0，不是 −Infinity】內陸沒有海可以退回去
  const groundAt = (x: number, z: number): number => {
    const h = farm.field.sample(x, z)
    return h > 0 ? h : 0
  }

  return {
    object: group,
    // 【不吃 time】內陸沒有波
    heightAt: (x, z) => groundAt(x, z),
    collisionHeightAt: groundAt,
    islands: farm.hills,
    land: { field: farm.field, ceiling: HILL_PEAK_MAX, landAbove: -Infinity },
    update(_time, centerX, centerZ) { horizon.update(centerX, centerZ) },
    dispose() { horizon.dispose(); ground.dispose() },
  }
}
```

注意 `heightAt` 的簽章是 `(x, z, time)`，這裡忽略 `time`。

`src/ui/menu.ts`：

```ts
const TERRAINS: readonly { label: string; value: TerrainKind }[] = [
  { label: '群　島', value: 'archipelago' },
  { label: '內　陸', value: 'farmland' },
  { label: '純海面', value: 'sea' },
]
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/terrain.test.ts test/unit/menu.test.ts`
Expected: PASS

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 只剩既有的三條非 `process` 基準錯誤。**新的 `TerrainKind` 若讓某個 switch 少一支，這裡會抓到。**

- [ ] **Step 6: Commit**

```bash
git add src/world/terrainKind.ts src/render/terrain.ts src/ui/menu.ts test/unit/terrain.test.ts
git commit -F <訊息檔>
```

---

### Task 8: `world/arena.ts` —— 戰場邊界的狀態機

**Files:**
- Create: `src/world/arena.ts`
- Test: `test/unit/arena.test.ts`

**Interfaces:**
- Produces:
  - `ARENA_RADIUS = 12000`、`ARENA_CEILING = 10000`、`ARENA_COUNTDOWN = 15`
  - `interface ArenaState { outside: boolean; remaining: number; expired: boolean }`
  - `createArenaState(): ArenaState`
  - `stepArena(s: ArenaState, x: number, y: number, z: number, dt: number): void`

- [ ] **Step 1: 先寫失敗的測試**

`test/unit/arena.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  ARENA_CEILING, ARENA_COUNTDOWN, ARENA_RADIUS, createArenaState, stepArena,
} from '../../src/world/arena'

describe('戰場邊界', () => {
  it('界內什麼都不發生', () => {
    const s = createArenaState()
    stepArena(s, 0, 4000, 0, 1)
    expect(s.outside).toBe(false)
    expect(s.remaining).toBe(ARENA_COUNTDOWN)
    expect(s.expired).toBe(false)
  })

  it('圓柱 —— 水平距離看的是半徑，不是方框', () => {
    const s = createArenaState()
    // 對角線方向 (0.9R, 0.9R)：方框內，圓外
    stepArena(s, ARENA_RADIUS * 0.9, 4000, ARENA_RADIUS * 0.9, 0)
    expect(s.outside).toBe(true)
  })

  it('高度也是界的一部分', () => {
    const s = createArenaState()
    stepArena(s, 0, ARENA_CEILING + 1, 0, 0)
    expect(s.outside).toBe(true)
  })

  it('界外開始倒數', () => {
    const s = createArenaState()
    for (let i = 0; i < 5; i++) stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    expect(s.remaining).toBeCloseTo(ARENA_COUNTDOWN - 5, 6)
    expect(s.expired).toBe(false)
  })

  it('回到界內就歸零重置', () => {
    const s = createArenaState()
    for (let i = 0; i < 5; i++) stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    stepArena(s, 0, 4000, 0, 1)
    expect(s.outside).toBe(false)
    expect(s.remaining).toBe(ARENA_COUNTDOWN)
  })

  it('倒數歸零就 expired，而且之後一直是', () => {
    const s = createArenaState()
    for (let i = 0; i < ARENA_COUNTDOWN + 1; i++) stepArena(s, ARENA_RADIUS + 100, 4000, 0, 1)
    expect(s.expired).toBe(true)
    expect(s.remaining).toBe(0)
    // 【expired 之後回到界內也不會復活】飛機已經爆了
    stepArena(s, 0, 4000, 0, 1)
    expect(s.expired).toBe(true)
  })

  it('12 km 對開場的 5,945 m 有一倍餘裕', () => {
    expect(ARENA_RADIUS).toBeGreaterThan(5945 * 2)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/arena.test.ts`
Expected: FAIL —— 找不到 `src/world/arena`

- [ ] **Step 3: 寫實作**

`src/world/arena.ts`：

```ts
/**
 * 戰場邊界。**圓柱，不是正方體。**
 *
 * 【為什麼是圓柱】正方體的角落比面心遠 41%，玩家看到的「離界多遠」會隨
 * 方位跳。圓柱只有一個半徑、HUD 一個數字。
 *
 * 【為什麼只對玩家】AI 沒有任何絕對的牽引 —— 實測 8v8 對頭 900 秒打不完、
 * 中位數飛到 44 km 外，成因是「沒有目標就平飛」。專案負責人 2026-08-28
 * 裁定這一輪不處理那一側，見 `docs/backlog.md` §10.2。
 *
 * 【為什麼只在遭遇戰】任務卡的幾何直接與它衝突：撤離點在 −20,000 m
 * （玩家起點 z ≈ +5,000，直線 25 km），護航的集合點 12,000 m。
 *
 * 【為什麼住在 `world/` 而不是 `main.ts`】它是規則，要 headless 測得到。
 * `main.ts` 只負責接線與畫面。
 */

/** 水平半徑，m。開場最遠的一架在 5,945 m，餘裕一倍 */
export const ARENA_RADIUS = 12000

/** 高度上限，m。P-51D 的升限是 12,770，所以這一條是飛得到的 */
export const ARENA_CEILING = 10000

/** 界外到爆炸的秒數 */
export const ARENA_COUNTDOWN = 15

export interface ArenaState {
  /** 這一刻在界外嗎 */
  outside: boolean
  /** 還剩幾秒。界內恆為 `ARENA_COUNTDOWN` */
  remaining: number
  /** 倒數已經歸零。**單向** —— 飛機已經爆了，回到界內也不會復活 */
  expired: boolean
}

export function createArenaState(): ArenaState {
  return { outside: false, remaining: ARENA_COUNTDOWN, expired: false }
}

/**
 * 推進一步。就地寫 `s`。
 *
 * 熱路徑（240 Hz，一架），不配置。
 */
export function stepArena(
  s: ArenaState, x: number, y: number, z: number, dt: number,
): void {
  if (s.expired) return
  const outside = x * x + z * z > ARENA_RADIUS * ARENA_RADIUS || y > ARENA_CEILING
  s.outside = outside
  if (!outside) {
    s.remaining = ARENA_COUNTDOWN
    return
  }
  s.remaining -= dt
  if (s.remaining <= 0) {
    s.remaining = 0
    s.expired = true
  }
}
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/arena.test.ts`
Expected: PASS，7 條

- [ ] **Step 5: Commit**

```bash
git add src/world/arena.ts test/unit/arena.test.ts
git commit -F <訊息檔>
```

---

### Task 9: HUD 的警告與倒數

**Files:**
- Create: `src/hud/widgets/arena.ts`
- Modify: `src/hud/types.ts`（`HudFrame` 加三個欄位、`createHudFrame` 的初值）
- Modify: `src/hud/Hud.ts`（註冊 widget）
- Modify: `src/hud/widgets/minimap.ts`（畫界的弧）
- Test: `test/unit/hud-arena.test.ts`

**Interfaces:**
- Consumes: `ARENA_COUNTDOWN`（Task 8）
- Produces: `drawArena(ctx, L, f)`；`HudFrame` 多 `arenaOutside: boolean`、`arenaRemaining: number`、`arenaShow: boolean`

- [ ] **Step 1: 先寫失敗的測試**

`test/unit/hud-arena.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { drawArena } from '../../src/hud/widgets/arena'
import { createHudFrame } from '../../src/hud/types'
import { makeCtx, makeLayout } from './helpers/hud'   // 沿用該目錄既有的假 ctx

describe('返回戰場的警告', () => {
  it('界內不畫任何東西', () => {
    const f = createHudFrame()
    f.arenaShow = true
    f.arenaOutside = false
    const ctx = makeCtx()
    drawArena(ctx.ctx, makeLayout(), f)
    expect(ctx.calls.filter((c) => c.startsWith('fillText'))).toHaveLength(0)
  })

  it('界外畫警告與秒數', () => {
    const f = createHudFrame()
    f.arenaShow = true
    f.arenaOutside = true
    f.arenaRemaining = 8.4
    const ctx = makeCtx()
    drawArena(ctx.ctx, makeLayout(), f)
    const texts = ctx.calls.filter((c) => c.startsWith('fillText')).join('|')
    expect(texts).toContain('返回戰場')
    expect(texts).toContain('9')   // Math.ceil(8.4)
  })

  it('這一場沒有界就完全不畫', () => {
    const f = createHudFrame()
    f.arenaShow = false
    f.arenaOutside = true
    f.arenaRemaining = 3
    const ctx = makeCtx()
    drawArena(ctx.ctx, makeLayout(), f)
    expect(ctx.calls.filter((c) => c.startsWith('fillText'))).toHaveLength(0)
  })

  it('createHudFrame 的初值是界內', () => {
    const f = createHudFrame()
    expect(f.arenaOutside).toBe(false)
    expect(f.arenaShow).toBe(false)
  })
})
```

**先讀 `test/unit/` 底下既有的 HUD 測試**，照抄它們造假 `ctx` 的方式；上面的 `makeCtx` / `makeLayout` 若不存在就照既有寫法就地造一個。

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/hud-arena.test.ts`
Expected: FAIL

- [ ] **Step 3: 寫實作**

`src/hud/widgets/arena.ts`：

```ts
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 「返回戰場」的警告與倒數。
 *
 * 【為什麼秒數用 ceil】剩 0.2 秒時顯示 0 會讓玩家以為已經沒救了。
 * 進位之後「畫面上的 1」與「還有時間」是同一件事。
 *
 * 【為什麼要 `arenaShow`】界只掛在遭遇戰上（任務卡的撤離點在 −20 km）。
 * 沒有這一格的話，任務裡飛去撤離點會一路閃警告。
 */
export function drawArena(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  if (!f.arenaShow || !f.arenaOutside) return

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = HUD_COLORS.warn
  ctx.font = hudFont(28 * L.scale, true)
  ctx.fillText('返回戰場', L.width / 2, L.height * 0.24)

  ctx.font = hudFont(46 * L.scale, true)
  ctx.fillText(String(Math.ceil(f.arenaRemaining)), L.width / 2, L.height * 0.24 + 46 * L.scale)
}
```

`src/hud/types.ts`：在 `HudFrame` 上加

```ts
  /**
   * 這一場有沒有戰場邊界。**遭遇戰有，任務卡沒有** —— 撤離點在 −20 km，
   * 護航的集合點 12 km，兩者都在界外。
   */
  arenaShow: boolean
  /** 這一刻在界外嗎 */
  arenaOutside: boolean
  /** 還剩幾秒 */
  arenaRemaining: number
```

`createHudFrame()` 的初值：`arenaShow: false, arenaOutside: false, arenaRemaining: ARENA_COUNTDOWN`。

`src/hud/Hud.ts`：import 並在 widget 表加 `arena: (ctx, L, f) => drawArena(ctx, L, f)`，位置排在 `damageEdge` 之後、`contacts` 之前（警告要壓在接觸點之下、受擊痕跡之上）。

`src/hud/widgets/minimap.ts`：在畫完地圖框之後、畫符號之前，加界的弧：

```ts
  // 【戰場邊界】小地圖半徑 4 km、界 12 km，所以只有靠近時才進得了畫面。
  // 那正是它該出現的時機
  if (f.arenaShow) {
    const cx = -f.worldX * px
    const cz = -f.worldZ * px
    const r = ARENA_RADIUS * px
    ctx.save()
    ctx.beginPath()
    ctx.rect(-size / 2, -size / 2, size, size)
    ctx.clip()
    ctx.strokeStyle = HUD_COLORS.warn
    ctx.lineWidth = 1.5 * L.scale
    ctx.beginPath()
    ctx.arc(cx, cz, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
```

（`px`、`size` 與座標原點沿用該檔既有的變數；先讀那一段再落筆。）

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/hud-arena.test.ts test/unit/hud*.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hud/widgets/arena.ts src/hud/types.ts src/hud/Hud.ts src/hud/widgets/minimap.ts test/unit/hud-arena.test.ts
git commit -F <訊息檔>
```

---

### Task 10: `main.ts` 接線

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 8 的 `createArenaState` / `stepArena`、Task 9 的 HudFrame 欄位

- [ ] **Step 1: 接線**

在 `main.ts`：

```ts
import { createArenaState, stepArena } from './world/arena'
```

模組層：

```ts
/**
 * 玩家的戰場邊界。**只有玩家有** —— AI 那一側見 `world/arena.ts` 的說明。
 */
const arena = createArenaState()
```

開新的一場時（`wireTerrain(true)` 附近，也就是重置那一段）：

```ts
Object.assign(arena, createArenaState())
hudFrame.arenaShow = from === 'skirmish'
```

（`from` 是既有的「這一場從哪裡進來」那個變數；讀該處實際的名字。）

在物理步進之後、`crashPolicy` 讀得到的地方推進狀態。`crashPolicy` 是
**predicate，不放副作用** —— 所以在主迴圈推進：

```ts
  const p = player.aircraft.state.position
  stepArena(arena, p.x, p.y, p.z, dt)
  hudFrame.arenaOutside = arena.outside
  hudFrame.arenaRemaining = arena.remaining
```

`crashPolicy` 那一行改成：

```ts
  const seaCrash = flatSeaCrashPolicy(terrain.collisionHeightAt)
  world.crashPolicy = (c) => {
    // 【界只對玩家】見 `world/arena.ts`
    if (c.controller === playerController && arena.expired) return true
    return seaCrash(c)
  }
```

（`playerController` 的實際比對方式讀 `main.ts` 現況；若玩家是
`combatants[0]` 就比索引。）

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 只剩既有的基準錯誤

- [ ] **Step 3: 手動驗一次**

```
node node_modules/vite/bin/vite.js --port 5178
```

開遭遇戰 → 選「內　陸」→ 起飛 → 直飛出 12 km。預期：HUD 出現「返回戰場」與
倒數、小地圖出現界的弧、15 秒後爆炸。**回頭飛進界內倒數要歸零。**

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -F <訊息檔>
```

---

### Task 11: 整合、效能、截圖

**Files:**
- Modify: `test/integration/terrain-in-play.test.ts`（加農地的一組）
- Create: `test/e2e/farmland-shot.e2e.ts`

- [ ] **Step 1: 跑全套件（`perf-gate` 與 `rematch` 除外）**

Run: `npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"`
Expected: 全綠。**任何一條紅了就停下來回報，不要自己放寬。**

- [ ] **Step 2: 單獨跑那兩支**

Run: `npx vitest run test/integration/rematch.test.ts`
Run: `npx vitest run test/**/perf-gate.test.ts`
Expected: PASS。`perf-gate` 抖動的話單獨重跑三次記錄。

- [ ] **Step 3: 量丘陵數對 AI 迴圈的影響**

在 `terrain-in-play.test.ts` 加一組吃 `createFarmland().hills` 的掃描，記錄
撞山數、最低離地、繞島佔時。**這是新的基準線，不是護欄** —— 第一次跑就是
把數字記下來。

- [ ] **Step 4: 截圖**

`test/e2e/farmland-shot.e2e.ts`，照 `island-shot.e2e.ts` 的骨架，五個凍結姿態：

```ts
const VIEWS = [
  { name: 'high',    yaw: 0,  pitch: -38, alt: 3000, desc: '3 km 俯瞰 —— 田的圖樣' },
  { name: 'cruise',  yaw: 30, pitch: -12, alt: 600,  desc: '600 m 巡航 —— 田與防風林的尺度' },
  { name: 'deck',    yaw: 30, pitch: -4,  alt: 150,  desc: '150 m 貼地 —— 田會不會太碎' },
  { name: 'edge-out', yaw: 0, pitch: -8,  alt: 1200, desc: '界上朝外 —— 起伏斷不斷得出來' },
  { name: 'edge-in', yaw: 180, pitch: -8, alt: 1200, desc: '界上朝內' },
] as const
```

**驗收的問題是 §五.9 那一條**：`edge-out` 那一張看不看得出細節地形的邊。
看得出來就回報，處置是讓丘陵密度往外遞減。

- [ ] **Step 5: 更新 backlog**

`docs/backlog.md` 加第十一節，記錄這一輪做了什麼、量到什麼、以及沒做的
（AI 牽引、樹與房屋、大島海岸線）。

- [ ] **Step 6: Commit**

```bash
git add test/integration/terrain-in-play.test.ts test/e2e/farmland-shot.e2e.ts docs/backlog.md
git commit -F <訊息檔>
```

---

## 自審紀錄

**SPEC 的每一節都有對應的任務：**

| SPEC | 任務 |
|---|---|
| 2.1 第三種地形 | 7 |
| 2.2 丘陵沿用多瓣 | 2、3 |
| 2.3 田與防風林在著色器 | 1、5 |
| 2.4 遠景平地 | 6 |
| 2.5 場外地面與遮蔽判準 | 4、7 |
| 2.6 戰場邊界 | 8、9、10 |
| 五、驗收 1–6 | 各任務的單元測試 |
| 五、驗收 7–9 | 11 |

**型別一致性：** `LandField.landAbove`（Task 4 定義）在 Task 7 的農地分支用
`-Infinity`、群島用 `0`。`applyFields`（Task 5 匯出）在 Task 6 被 import。
`HILL_PEAK_MAX`（Task 3）在 Task 7 當 `ceiling`。`ARENA_COUNTDOWN`（Task 8）
在 Task 9 當 HudFrame 的初值。

**已知會在實作時才確定的兩件事**（都不是佔位符，是要讀現況的接點）：
Task 9 的假 `ctx` 造法要照抄 `test/unit/` 既有的 HUD 測試；Task 10 的
「玩家是哪一架」要讀 `main.ts` 現況的比對方式。
