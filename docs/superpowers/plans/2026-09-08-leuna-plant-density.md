# 洛伊納廠區填滿 —— 實作計畫

> **給代理執行者：** 必須搭配 superpowers:subagent-driven-development（建議）
> 或 superpowers:executing-plans 逐任務執行。步驟用 `- [ ]` 追蹤。

**目標：** 把洛伊納廠區由「空水泥板上散著幾個物件」變成從投彈高度俯視
時被結構物填滿的合成油廠，俯視覆蓋率由 7.6% 拉到 35% 以上。

**做法：** 墊面用巷道格線切成 24 個街廓，每個街廓掛一個機能標籤；十二座
可炸構件的外型膨脹但命中盒不動；地面在既有的著色器裡多鋪幾層髒污。佈景
仍是**一顆合併網格、一個 draw call、沒有命中盒**。

**技術：** TypeScript、three.js r180、vitest、Playwright。可炸構件由
`render/geometry/ground/parts.ts` 的 `box`／`cyl`／`assemble` 堆，頂點色，
`flatShading`。

**Spec：** `docs/superpowers/specs/2026-09-08-allies-m2-leuna-design.md` §15

## 全域約束

- 全部註解與文件用**繁體中文**；註解寫現狀與理由，不寫沿革與裁決出處。
- **不得 `Math.random`**：所有程序化的擺放走種子進、序列出的 LCG
  （`s = (Math.imul(s, 1664525) + 1013904223) >>> 0`，與 `world/leuna.ts`
  的 `makeRand` 同一式）。
- 熱路徑（240 Hz、每幀）**不配置記憶體**。
- 幾何的**底面在 y = 0**，沒有任何頂點在地面以下。
- 佈景網格：一顆幾何、`index` 為 `null`、有 `color` 與 `normal` 屬性。
- 三角形預算：佈景整顆 **15 萬 ≤ n ≤ 40 萬**。
- 十二座可炸構件的 `PLANT_SIZE` 與 `hull` **一個數字都不改**。
- 每個任務結束前跑 `npx tsc --noEmit`，錯誤行數不得比動工前的基準多。
  **動工前先量一次基準並記下來**（`test/tools/` 的探針與 e2e 的 `process`
  有一批既存錯誤）。
- 提交訊息的 trailer 只留 `Co-Authored-By`。不要 `git add -A`。

## 檔案結構

```
  src/world/leuna.ts              街廓格線、街廓表與機能指派、佈景煙囪（資料）
  src/render/geometry/ground/
    plant.ts                      改：十二座可炸構件的外型
  src/render/fields.ts            改：墊面的髒污層與街廓鋪面
  src/render/terrain.ts           改：LEUNA_SITE 帶 patches
  src/main.ts                     改：佈景煙囪也發白煙
  test/unit/leuna.test.ts         改：街廓表的護欄
  test/unit/ground-units.test.ts  改：構件的包圍盒仍在 PLANT_SIZE 內
  test/unit/site-layout.test.ts   改：墊面的髒污層
```

---

### Task 0：量基準

**Files:**
- 不改任何檔案

- [ ] **Step 1：量 tsc 的既存錯誤行數**

Run: `npx tsc --noEmit 2>&1 | wc -l`

把數字記在這一行後面：`基準 = ____`。之後每個任務比對它，不得增加。

- [ ] **Step 2：跑一次現有的單元測試，確認全綠**

Run: `npx vitest run test/unit/plant-scenery.test.ts test/unit/leuna.test.ts test/unit/site-layout.test.ts`

Expected: PASS

---

### Task 1：街廓格線與機能指派

**Files:**
- Modify: `src/world/leuna.ts`
- Test: `test/unit/leuna.test.ts`

**Interfaces:**
- Produces:
  - `PLANT_LANES: { readonly x: readonly number[]; readonly z: readonly number[] }`
    —— 巷道中心線，相對廠區中心的偏移
  - `LANE_WIDTH: number` —— 巷道寬 16 m
  - `type BlockKind = 'process' | 'tankFarm' | 'halls' | 'railyard' | 'utility' | 'open'`
  - `interface PlantBlock { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly kind: BlockKind; readonly seed: number }`
    —— **世界座標**，已經退掉巷道寬的一半
  - `PLANT_BLOCKS: readonly PlantBlock[]` —— 24 個

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/leuna.test.ts` 的最後（`describe('leuna 地形')` 之外）。
匯入那一行加上 `LANE_WIDTH, PLANT_BLOCKS`：

```ts
describe('廠區的街廓', () => {
  it('24 個街廓，全部在墊面內，互不重疊', () => {
    expect(PLANT_BLOCKS).toHaveLength(24)
    const x0 = PLANT_CENTER.x - PLANT_PAD.halfX
    const x1 = PLANT_CENTER.x + PLANT_PAD.halfX
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ
    const z1 = PLANT_CENTER.z + PLANT_PAD.halfZ
    for (const b of PLANT_BLOCKS) {
      expect(b.x0).toBeGreaterThanOrEqual(x0)
      expect(b.x1).toBeLessThanOrEqual(x1)
      expect(b.z0).toBeGreaterThanOrEqual(z0)
      expect(b.z1).toBeLessThanOrEqual(z1)
      expect(b.x1 - b.x0).toBeGreaterThan(100)
      expect(b.z1 - b.z0).toBeGreaterThan(100)
    }
    for (let i = 0; i < PLANT_BLOCKS.length; i++) {
      for (let j = i + 1; j < PLANT_BLOCKS.length; j++) {
        const a = PLANT_BLOCKS[i]!
        const b = PLANT_BLOCKS[j]!
        const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0
        expect(apart, `街廓 ${i} 與 ${j} 重疊`).toBe(true)
      }
    }
  })

  /**
   * 【為什麼要驗這一條】巷道是格線退出來的。退錯邊（減成加）街廓會壓在
   * 巷道上，而畫面上只是「東西擺得比較滿」，看不出錯。
   */
  it('相鄰街廓之間恰好留一條 LANE_WIDTH 的巷', () => {
    const cols = [...new Set(PLANT_BLOCKS.map((b) => b.x0))].sort((a, b) => a - b)
    for (let i = 0; i + 1 < cols.length; i++) {
      const left = PLANT_BLOCKS.filter((b) => b.x0 === cols[i])[0]!
      const right = PLANT_BLOCKS.filter((b) => b.x0 === cols[i + 1])[0]!
      expect(right.x0 - left.x1).toBeCloseTo(LANE_WIDTH, 6)
    }
  })

  it('每一座可炸構件都落在某個街廓內，而且那個街廓不是 open', () => {
    for (const p of PLANT_LAYOUT) {
      const x = PLANT_CENTER.x + p.dx
      const z = PLANT_CENTER.z + p.dz
      const b = PLANT_BLOCKS.find((k) => x >= k.x0 && x < k.x1 && z >= k.z0 && z < k.z1)
      expect(b, `構件 ${p.kind} (${p.dx},${p.dz}) 掉在巷道或街廓外`).toBeDefined()
      expect(b!.kind, `構件 ${p.kind} 落在 open 街廓`).not.toBe('open')
    }
  })

  it('機能配比：open 不超過 4 個，六種機能都有人用，種子互不相同', () => {
    const open = PLANT_BLOCKS.filter((b) => b.kind === 'open')
    expect(open.length).toBeLessThanOrEqual(4)
    const kinds = new Set(PLANT_BLOCKS.map((b) => b.kind))
    expect(kinds.size).toBe(6)
    expect(new Set(PLANT_BLOCKS.map((b) => b.seed)).size).toBe(24)
  })
})
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/leuna.test.ts`

Expected: FAIL，`PLANT_BLOCKS` 不存在。

- [ ] **Step 3：實作**

在 `src/world/leuna.ts` 的 `PLANT_SCENERY` 之後加：

```ts
/**
 * 巷道的中心線，相對廠區中心。`x` 是縱向（沿 Z 走）的巷、`z` 是橫向的巷。
 *
 * 【與廠內道路共線】-600、500（縱向）與 0（橫向）就是 ROADS 那三條廠內
 * 道路。格線另開一套的話，街廓會被道路從中間切開，佈景一半壓在路上。
 */
export const PLANT_LANES = {
  x: [-1100, -600, -100, 500, 1000],
  z: [-400, 0, 400],
} as const

/** 巷道寬，m。街廓從格線各退一半 */
export const LANE_WIDTH = 16

/** 街廓的機能。決定街廓裡鋪什麼與地面的鋪面色 */
export type BlockKind = 'process' | 'tankFarm' | 'halls' | 'railyard' | 'utility' | 'open'

/** 一個街廓，世界座標，已經退掉巷道 */
export interface PlantBlock {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
  readonly kind: BlockKind
  readonly seed: number
}

/**
 * 機能指派，6 欄 × 4 列，欄由西到東、列由北到南。
 *
 * 【要與十二座構件的位置相符】西側是氫化製程、中央是動力、東側是儲槽；
 * 南緣留給調車場，接南門的連外道路。open 是刻意的留白 —— 沒有空地就
 * 看不出密的地方有多密。
 */
const BLOCK_KINDS: readonly (readonly BlockKind[])[] = [
  ['halls', 'process', 'utility', 'railyard'],      // x -1500…-1100
  ['process', 'process', 'halls', 'railyard'],      // x -1100…-600
  ['utility', 'process', 'utility', 'open'],        // x -600…-100
  ['process', 'utility', 'utility', 'halls'],       // x -100…500
  ['halls', 'tankFarm', 'tankFarm', 'railyard'],    // x 500…1000
  ['tankFarm', 'tankFarm', 'open', 'open'],         // x 1000…1500
]

function buildBlocks(): PlantBlock[] {
  const half = LANE_WIDTH / 2
  const xs = [-PLANT_PAD.halfX, ...PLANT_LANES.x, PLANT_PAD.halfX]
  const zs = [-PLANT_PAD.halfZ, ...PLANT_LANES.z, PLANT_PAD.halfZ]
  const out: PlantBlock[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      out.push({
        x0: PLANT_CENTER.x + xs[i]! + half,
        x1: PLANT_CENTER.x + xs[i + 1]! - half,
        z0: PLANT_CENTER.z + zs[j]! + half,
        z1: PLANT_CENTER.z + zs[j + 1]! - half,
        kind: BLOCK_KINDS[i]![j]!,
        seed: 2000 + i * 10 + j,
      })
    }
  }
  return out
}

/** 二十四個街廓。地面著色器的鋪面讀它 */
export const PLANT_BLOCKS: readonly PlantBlock[] = /* @__PURE__ */ buildBlocks()
```

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/leuna.test.ts` 然後 `npx tsc --noEmit 2>&1 | wc -l`

Expected: PASS；tsc 的行數等於 Task 0 的基準。

- [ ] **Step 5：提交**

```bash
git add src/world/leuna.ts test/unit/leuna.test.ts
git commit -m "feat(world): 洛伊納廠區切成 24 個街廓，六種機能"
```

---

### Task 5：十二座可炸構件的外型

**Files:**
- Modify: `src/render/geometry/ground/plant.ts`
- Test: `test/unit/ground-units.test.ts`

**Interfaces:**
- Consumes: `parts.ts` 的 `box`／`cyl`／`assemble`
- Produces: `PLANT_BUILDERS` 的六支（簽名不變）

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/ground-units.test.ts`（若已有廠區構件的段落就加在裡面）：

```ts
describe('廠區構件的外型', () => {
  /**
   * 【外型可以膨脹，盒子不行】命中盒與投彈難度已經凍結。這一條把兩者
   * 分開驗：幾何要在 PLANT_SIZE 的腳印與高度之內，而 PLANT_SIZE 的值
   * 獨立寫死在這裡 —— 由幾何反推的話這條就是恆真的。
   */
  const EXPECTED = {
    hydroTower: { x: 8, y: 40, z: 8 },
    chimney: { x: 8, y: 100, z: 8 },
    boilerHouse: { x: 60, y: 18, z: 30 },
    oilTank: { x: 25, y: 12, z: 25 },
    gasHolder: { x: 40, y: 35, z: 40 },
    coolingTower: { x: 30, y: 40, z: 30 },
  } as const

  it('PLANT_SIZE 沒有被動過', () => {
    expect(PLANT_SIZE).toEqual(EXPECTED)
  })

  it('每一種的幾何都在自己的腳印與高度之內，而且比以前細緻', () => {
    for (const [kind, size] of Object.entries(EXPECTED)) {
      const g = PLANT_BUILDERS[kind as keyof typeof EXPECTED]()
      g.computeBoundingBox()
      const b = g.boundingBox!
      expect(b.min.y, `${kind} 陷地`).toBeGreaterThanOrEqual(-0.01)
      expect(b.max.y, `${kind} 超高`).toBeLessThanOrEqual(size.y + 0.01)
      expect(b.max.x - b.min.x, `${kind} 超出腳印`).toBeLessThanOrEqual(size.x + 0.01)
      expect(b.max.z - b.min.z, `${kind} 超出腳印`).toBeLessThanOrEqual(size.z + 0.01)
      const tris = g.getAttribute('position').count / 3
      expect(tris, `${kind} 只有 ${tris} 個三角形`).toBeGreaterThanOrEqual(400)
      expect(tris, `${kind} 有 ${tris} 個三角形`).toBeLessThanOrEqual(900)
    }
  })

  it('殘骸仍然是矮一截的同一個腳印', () => {
    for (const [kind, size] of Object.entries(EXPECTED)) {
      const g = buildPlantRuin(kind as keyof typeof EXPECTED)
      g.computeBoundingBox()
      const b = g.boundingBox!
      expect(b.max.y).toBeCloseTo(size.y * 0.25, 3)
      expect(b.max.x - b.min.x).toBeCloseTo(size.x, 3)
    }
  })
})
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/ground-units.test.ts`

Expected: FAIL —— 現在每座只有 36–128 個三角形，低於 400 的下限。

- [ ] **Step 3：改 `plant.ts` 的六支建構函式**

每一支保留現有的主體，外掛裝置群。腳印是硬約束：**外掛的東西全部要在
`PLANT_SIZE` 的框內**，所以主體要先讓出空間（例如 `hydroTower` 的塔身
半徑由 `x / 2 × 0.85` 縮到 `× 0.55`，讓出外圍給鋼骨架）。

- `hydroTower`（8 × 40 × 8）：細塔身＋四根角柱的鋼骨架（7.6 m 見方、
  五層平台）＋兩根貼著塔身爬的三角柱管＋頂上的小附屬槽。
- `chimney`（8 × 100 × 8）：錐形磚身＋每 25 m 一圈箍（薄 `box`）＋
  一道貼著爬的檢修梯（細 `box` 疊）＋頂端一圈燈架。
- `boilerHouse`（60 × 18 × 30）：磚牆＋階梯屋頂（現有）＋屋頂上四座
  小通風筒＋南牆外一排 `horizTank`＋沿牆的管線（三角柱）。
- `oilTank`（25 × 12 × 25）：十六邊筒（現有）＋外圍一圈螺旋梯（八段
  斜 `box`）＋頂上的中央柱與四道輻射樑。
- `gasHolder`（40 × 35 × 40）：筒身＋外圍八根導柱與兩圈環樑（照片裡的
  乾式氣櫃就是這個外觀）。
- `coolingTower`（30 × 40 × 30）：截錐＋底部一圈進風百葉（十二片
  `box`）＋頂緣一圈環。

每一件的顏色固定 —— 同一種構件每次建都同一色。

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/ground-units.test.ts` 然後 `npx tsc --noEmit 2>&1 | wc -l`

Expected: PASS。超出腳印時縮主體，不要改 `PLANT_SIZE`。

- [ ] **Step 5：提交**

```bash
git add src/render/geometry/ground/plant.ts test/unit/ground-units.test.ts
git commit -m "feat(render): 十二座構件換成裝置群外型，命中盒不動"
```

---

### Task 6：墊面的髒污與街廓鋪面

**Files:**
- Modify: `src/render/fields.ts`
- Modify: `src/render/terrain.ts`
- Test: `test/unit/site-layout.test.ts`

**Interfaces:**
- Produces: `SiteLayout` 多一個可選欄位
  `readonly patches?: readonly { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly hex: number }[]`

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/site-layout.test.ts`：

```ts
describe('墊面的髒污', () => {
  it('墊面不再是單一色：一百個取樣點裡至少八種顏色', () => {
    const c = new Color()
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const x = PLANT_CENTER.x - 1400 + i * 280
        const z = PLANT_CENTER.z - 700 + j * 140
        seen.add(siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE).getHexString())
      }
    }
    expect(seen.size, `只有 ${seen.size} 種顏色`).toBeGreaterThanOrEqual(8)
  })

  /**
   * 【農地那條路要逐位元不變】夏季基準守著它。有 site 與沒 site 是兩條
   * 路，改墊面不得動到沒有 site 的那一條。
   */
  it('沒有 site 的 GLSL 仍與 fieldGlsl 逐字相同', () => {
    expect(fieldGlslWithSite('summer')).toBe(fieldGlsl('summer'))
    expect(fieldGlslWithSite('lateAutumn')).toBe(fieldGlsl('lateAutumn'))
  })

  it('調車場的街廓是碴石色，留白的街廓是裸土色', () => {
    const c = new Color()
    const rail = LEUNA_SITE.patches!.find((p) => p.hex === 0x5f5a52)
    expect(rail, '沒有碴石鋪面').toBeDefined()
    const x = (rail!.x0 + rail!.x1) / 2
    const z = (rail!.z0 + rail!.z1) / 2
    expect(siteSurfaceColor(x, z, c, 'lateAutumn', LEUNA_SITE).getHex()).toBe(0x5f5a52)
  })

  it('道路仍然壓過墊面與鋪面', () => {
    const c = new Color()
    expect(siteSurfaceColor(PLANT_CENTER.x, PLANT_CENTER.z, c, 'lateAutumn', LEUNA_SITE)
      .getHexString()).toBe('3f3d3a')
  })
})
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/site-layout.test.ts`

Expected: FAIL —— 墊面現在只有一種顏色（CPU 版回固定的 `CONCRETE`）、
`patches` 不存在。

- [ ] **Step 3：實作**

`fields.ts`：

- `SiteLayout` 加可選的 `patches`。
- `siteGlsl` 的墊面那一段改成三層：120 m 格的鋪面明度階、40 m 格抽
  一成壓暗的油漬、既有的 40 m 微亮暗。全部用 `fieldHash2`，不加
  uniform 也不加貼圖。
- 鋪面矩形接在墊面之後、道路之前展開（`patches` 是 3–7 個矩形，
  直接展成 if 串）。
- `siteSurfaceColor` **照同一個順序**做一份 CPU 版：墊面 → 鋪面 → 道路。
  兩份的雜湊要用同一式，否則 CPU 取樣與畫面上的顏色對不上。

`terrain.ts` 的 `LEUNA_SITE` 加 `patches`：`PLANT_BLOCKS` 裡
`kind === 'railyard'` 的四個矩形給碴石色 `0x5f5a52`、`kind === 'open'`
的給裸土色 `0x6b5f4e`。

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/site-layout.test.ts test/unit/terrain.test.ts`
然後 `npx vitest run test/unit` 確認夏季基準沒紅。

Expected: PASS

- [ ] **Step 5：GLSL 要編得過**

Run: `node node_modules/vite/bin/vite.js --port 5190`（終端機一）
與 `node node_modules/vite-node/vite-node.mjs test/e2e/glsl-compile.e2e.ts`（終端機二）

Expected: 沒有編譯錯誤。**這一步不能跳** —— GLSL 的語法錯在單元測試裡
是看不到的。

- [ ] **Step 6：提交**

```bash
git add src/render/fields.ts src/render/terrain.ts test/unit/site-layout.test.ts
git commit -m "feat(render): 墊面加鋪面塊、油漬與街廓鋪面"
```

---

### Task 7：佈景煙囪的白煙

**Files:**
- Modify: `src/world/leuna.ts`
- Modify: `src/main.ts:747-766`
- Test: `test/unit/pool-reset-entrypoints.test.ts`（既有的接線護欄）

**Interfaces:**
- Produces: `PLANT_STACKS: readonly { readonly x: number; readonly z: number; readonly y: number }[]`
  —— **世界座標**，模組常數（熱路徑不得換算）

- [ ] **Step 1：寫失敗的測試**

新增 `test/unit/plant-stacks.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { PLANT_BLOCKS, PLANT_STACKS } from '../../src/world/leuna'

describe('佈景煙囪', () => {
  it('至少六根，全部落在非 open 的街廓內，高度 40 m 以上', () => {
    expect(PLANT_STACKS.length).toBeGreaterThanOrEqual(6)
    for (const s of PLANT_STACKS) {
      expect(s.y).toBeGreaterThanOrEqual(40)
      const b = PLANT_BLOCKS.find((k) => s.x >= k.x0 && s.x < k.x1 && s.z >= k.z0 && s.z < k.z1)
      expect(b, `煙囪 (${s.x},${s.z}) 不在任何街廓內`).toBeDefined()
      expect(b!.kind).not.toBe('open')
    }
  })

  /**
   * 【座標必須是世界座標】發煙的迴圈每幀跑，那裡不能有換算，更不能
   * 建物件。
   */
  it('座標是世界座標，不是相對廠區中心的偏移', () => {
    for (const s of PLANT_STACKS) expect(s.z).toBeLessThan(-5000)
  })
})
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/plant-stacks.test.ts`

Expected: FAIL，`PLANT_STACKS` 不存在。

- [ ] **Step 3：實作**

`world/leuna.ts` 加 `PLANT_STACKS`：六到八根，擺在 `process` 與
`utility` 街廓內、避開可炸構件，高度 45–70 m。**寫成世界座標的常數
陣列**。

佈景裡每一個 `PLANT_STACKS` 的座標都要有煙囪，否則煙從空中冒出來。

`main.ts` 的 `emitPlantSteam` 在既有的 `world.groundTargets` 迴圈之後
加第二段：

```ts
  for (const s of PLANT_STACKS) {
    for (let k = 0; k < n; k++) {
      const q = (steamSeed = (steamSeed + 1) | 0)
      const a = hash01(q * 3 + 1) * Math.PI * 2
      const r = hash01(q * 3 + 2) * STEAM_DRIFT
      const ox = (hash01(q * 3 + 3) * 2 - 1) * 1.5
      steam.emit(s.x + ox, s.y, s.z, Math.cos(a) * r, 0, Math.sin(a) * r, 1)
    }
  }
```

**迴圈裡不得建物件**（沒有 `new`、沒有陣列字面值、沒有解構出新物件）。

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/plant-stacks.test.ts test/unit/pool-reset-entrypoints.test.ts`

Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/world/leuna.ts src/main.ts test/unit/plant-stacks.test.ts
git commit -m "feat(world): 佈景煙囪也冒白煙"
```

---

### Task 8：驗收 —— 幀時間與試飛截圖

**Files:**
- 不改產品程式碼（除非量出問題）

- [ ] **Step 1：整套單元測試**

Run: `npx vitest run test/unit test/control test/balance`

Expected: 全綠。任何一條紅的都要修，不得改門檻。

- [ ] **Step 2：量幀時間**

終端機一：`node node_modules/vite/bin/vite.js --port 5190`
終端機二：`node node_modules/vite-node/vite-node.mjs test/e2e/frame-time.e2e.ts`

把改動前後的數字都記下來。**這一步不設門檻** —— 40 萬是負責人裁的預算，
量到才知道要不要縮。數字回報給負責人。

- [ ] **Step 3：試飛截圖**

用 `test/e2e/` 的既有做法寫一支 `leuna-shot.e2e.ts`：進盟 M2、
`__gfx` 關掉飛機與粒子、`__still` 拍九個視角
（4 km 進場、3 km 俯角 60°、2.5 km 正上方、1.2 km 進場、300 m 低空、
東側 3.2 km 側看、350 m 貼近儲槽區、350 m 貼近製程區、200 m 沿連外道路）。
**一定要有頭**（無頭 chromium 走 SwiftShader，不是玩家機器上的編譯器）。

Expected: 九張圖裡，2.5 km 正上方那張看得出街廓的機能差異（圓的一片、
鋸齒的一片、平行線的一片），1.2 km 那張看不到大片空水泥。

- [ ] **Step 4：Codex 審查**

Run（背景執行、prompt 走 stdin）：`codex exec -s danger-full-access`

審查範圍：這一輪的全部 diff。把「加結構」的建議先要它證明少了會壞。

- [ ] **Step 5：交負責人裁定**

回報三件事：幀時間的前後數字、九張截圖、覆蓋率與三角形的實測值。
Spec §15.9 的三個開放項（覆蓋率門檻、40 萬要不要縮、街廓的機能指派）
在這一步定案。

---

## 自我檢查

- **Spec 覆蓋**：§15.2 → Task 1；§15.4 → Task 6；§15.5 → Task 5；
  §15.7 → Task 7；§15.8 的護欄 → Task 1、5、6、7、8。
- **型別一致**：`PlantBlock` 的欄位名（`x0/z0/x1/z1/kind/seed`）在
  Task 1、6 一致。
- **沒有佔位**：每一步都有可執行的指令或可貼上的程式碼。
