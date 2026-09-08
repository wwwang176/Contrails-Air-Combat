# 洛伊納廠區填滿 —— 實作計畫

> **給代理執行者：** 必須搭配 superpowers:subagent-driven-development（建議）
> 或 superpowers:executing-plans 逐任務執行。步驟用 `- [ ]` 追蹤。

**目標：** 把洛伊納廠區由「空水泥板上散著幾個物件」變成從投彈高度俯視
時被結構物填滿的合成油廠，俯視覆蓋率由 7.6% 拉到 35% 以上。

**做法：** 墊面用巷道格線切成 24 個街廓，每個街廓掛一個機能標籤，由對應
的填充器按固定種子鋪滿；十二座可炸構件的外型膨脹但命中盒不動；地面在
既有的著色器裡多鋪幾層髒污。佈景仍是**一顆合併網格、一個 draw call、
沒有命中盒**。

**技術：** TypeScript、three.js r180、vitest、Playwright。幾何全部由
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
    plantParts.ts                 新：廠區專用的零件工廠與髒舊色盤
    plantFill.ts                  新：六個機能填充器與避讓表
    plantScenery.ts               改：走街廓表、組骨幹、assemble 成一顆網格
    plant.ts                      改：十二座可炸構件的外型
  src/render/fields.ts            改：墊面的髒污層與街廓鋪面
  src/render/terrain.ts           改：LEUNA_SITE 帶 patches
  src/main.ts                     改：佈景煙囪也發白煙
  test/unit/leuna.test.ts         改：街廓表的護欄
  test/unit/plant-parts.test.ts   新：零件工廠的護欄
  test/unit/plant-fill.test.ts    新：填充器的護欄
  test/unit/plant-scenery.test.ts 改：覆蓋率、三角形預算、避讓
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
 * 道路。格線另開一套的話，街廓會被道路從中間切開，填充器鋪的東西一半
 * 壓在路上。
 */
export const PLANT_LANES = {
  x: [-1100, -600, -100, 500, 1000],
  z: [-400, 0, 400],
} as const

/** 巷道寬，m。街廓從格線各退一半 */
export const LANE_WIDTH = 16

/** 街廓的機能。填充器照這個標籤決定鋪什麼 */
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

/** 二十四個街廓。填充器逐個鋪，render/geometry/ground/plantFill.ts 讀它 */
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

### Task 2：零件工廠與髒舊色盤

**Files:**
- Create: `src/render/geometry/ground/plantParts.ts`
- Test: `test/unit/plant-parts.test.ts`

**Interfaces:**
- Consumes: `box`, `cyl`, `type Place`（`./parts`）
- Produces（全部回 `BufferGeometry[]`，呼叫端 push 進 parts 陣列後由
  `assemble` 一次吃掉）：
  - `PLANT_PALETTE: readonly number[]` —— 五色髒舊色盤
  - `grime(seed: number): number`
  - `trussTower(x: number, z: number, size: number, layers: number, seed: number): BufferGeometry[]`
  - `uprightTank(x: number, z: number, r: number, h: number, seed: number): BufferGeometry[]`
  - `horizTank(x: number, z: number, r: number, len: number, ry: number, seed: number): BufferGeometry[]`
  - `sphereTank(x: number, z: number, r: number, seed: number): BufferGeometry[]`
  - `fanStack(x: number, z: number, r: number, h: number, seed: number): BufferGeometry[]`
  - `bundWall(x0: number, z0: number, x1: number, z1: number, height: number): BufferGeometry[]`
  - `sawtoothHall(x: number, z: number, w: number, d: number, h: number, teeth: number, ry: number, seed: number): BufferGeometry[]`
  - `railTrack(ax: number, az: number, bx: number, bz: number): BufferGeometry[]`
  - `railCar(x: number, z: number, ry: number, tank: boolean, seed: number): BufferGeometry[]`
  - `pipeBridge(ax: number, az: number, bx: number, bz: number, height: number, pipes: number, seed: number): BufferGeometry[]`

- [ ] **Step 1：寫失敗的測試**

Create `test/unit/plant-parts.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Box3, type BufferGeometry } from 'three'
import {
  bundWall, fanStack, grime, horizTank, pipeBridge, PLANT_PALETTE, railCar, railTrack,
  sawtoothHall, sphereTank, trussTower, uprightTank,
} from '../../src/render/geometry/ground/plantParts'

/** 一批零件的合併包圍盒 */
function bounds(parts: BufferGeometry[]): Box3 {
  const b = new Box3()
  for (const p of parts) {
    p.computeBoundingBox()
    b.union(p.boundingBox!)
  }
  return b
}

function triangles(parts: BufferGeometry[]): number {
  let n = 0
  for (const p of parts) n += p.getAttribute('position').count / 3
  return n
}

describe('廠區零件', () => {
  /**
   * 【三角形數是精確比對，不是上限】它是 40 萬預算的分母。零件悄悄變胖
   * 的話，密度就得跟著砍，而砍下去沒有人會發現。
   */
  it('每一種零件都貼地、有頂點色、三角形數在標稱值', () => {
    const cases: readonly { name: string; parts: BufferGeometry[]; tris: number }[] = [
      { name: 'trussTower', parts: trussTower(0, 0, 20, 4, 1), tris: 288 },
      { name: 'uprightTank', parts: uprightTank(0, 0, 12, 14, 2), tris: 64 },
      { name: 'horizTank', parts: horizTank(0, 0, 3, 20, 0, 3), tris: 56 },
      { name: 'sphereTank', parts: sphereTank(0, 0, 8, 4), tris: 64 },
      { name: 'fanStack', parts: fanStack(0, 0, 5, 8, 5), tris: 44 },
      { name: 'sawtoothHall', parts: sawtoothHall(0, 0, 60, 30, 10, 4, 0, 6), tris: 108 },
      { name: 'railCar', parts: railCar(0, 0, 0, true, 7), tris: 48 },
      { name: 'railTrack', parts: railTrack(0, 0, 0, 300), tris: 12 },
      { name: 'bundWall', parts: bundWall(-100, -60, 100, 60, 4), tris: 48 },
    ]
    for (const c of cases) {
      expect(c.parts.length, c.name).toBeGreaterThan(0)
      const b = bounds(c.parts)
      expect(b.min.y, `${c.name} 陷地`).toBeGreaterThanOrEqual(-0.001)
      for (const p of c.parts) expect(p.getAttribute('color'), c.name).toBeDefined()
      expect(triangles(c.parts), `${c.name} 的三角形數變了`).toBe(c.tris)
    }
  })

  it('立式槽的外廓等於給的半徑與高度', () => {
    const b = bounds(uprightTank(100, -50, 12, 14, 2))
    expect(b.min.x).toBeCloseTo(88, 3)
    expect(b.max.x).toBeCloseTo(112, 3)
    expect(b.max.y).toBeCloseTo(14, 3)
    expect(b.min.z).toBeCloseTo(-62, 3)
  })

  it('管線橋的管子橫跨兩端，架高等於給的高度', () => {
    const b = bounds(pipeBridge(0, 0, 200, 0, 8, 4, 11))
    expect(b.min.x).toBeLessThanOrEqual(1)
    expect(b.max.x).toBeGreaterThanOrEqual(199)
    expect(b.max.y).toBeGreaterThan(8)
    expect(b.min.y).toBeGreaterThanOrEqual(-0.001)
  })

  it('環形土堤圍住給的矩形，四邊都在', () => {
    const b = bounds(bundWall(-100, -60, 100, 60, 4))
    expect(b.min.x).toBeCloseTo(-102, 1)
    expect(b.max.x).toBeCloseTo(102, 1)
    expect(b.min.z).toBeCloseTo(-62, 1)
    expect(b.max.z).toBeCloseTo(62, 1)
    expect(b.max.y).toBeCloseTo(4, 3)
  })

  it('鋸齒廠房轉了 90° 之後仍在自己的腳印內', () => {
    const b = bounds(sawtoothHall(0, 0, 60, 30, 10, 4, 90, 6))
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(30.5)
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(60.5)
  })

  /**
   * 【色盤要抖明度】同一排二十個槽全是同一個灰的話，俯視是一片死板的
   * 圓點陣。抖動由序號決定，所以是決定性的。
   */
  it('grime：同序號同色、相鄰序號不同色、色數夠多', () => {
    expect(grime(5)).toBe(grime(5))
    expect(grime(5)).not.toBe(grime(6))
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(grime(i))
    expect(seen.size).toBeGreaterThan(20)
    expect(PLANT_PALETTE.length).toBe(5)
  })
})
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/plant-parts.test.ts`

Expected: FAIL，找不到模組。

- [ ] **Step 3：實作 `plantParts.ts`**

檔頭要寫：這支是廠區專用的零件（`parts.ts` 是載具用的低階原語，這裡是
廠區的中階組件）、圓管一律三角柱的理由、三角形成本表。色盤與 `grime`：

```ts
import type { BufferGeometry } from 'three'
import { box, cyl } from './parts'

/**
 * 髒舊色盤。廠區不共用 HUE —— 那一組是給載具用的乾淨色，整片廠區塗上去
 * 像剛出廠。
 */
export const PLANT_PALETTE = [
  0x6e5a4a, // 鏽紅
  0x3c3a37, // 煤灰黑
  0x6b6d68, // 髒鋼灰
  0x554a3c, // 油污棕
  0x8a5a3c, // 褪色的鉛丹橘
] as const

/**
 * 序號進、顏色出。同一排的東西因此深淺不一，而且每次建都一樣。
 *
 * 【明度要量化成 16 階】連續的抖動在低多邊形的平面著色下看起來是雜訊；
 * 分階之後才像不同批補漆的鋼。
 */
export function grime(seed: number): number {
  const s = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0
  const base = PLANT_PALETTE[s % PLANT_PALETTE.length]!
  const f = 1 + (((s >>> 8) & 0xf) / 15 - 0.5) * 0.12
  const r = Math.min(255, Math.round(((base >> 16) & 0xff) * f))
  const g = Math.min(255, Math.round(((base >> 8) & 0xff) * f))
  const b = Math.min(255, Math.round((base & 0xff) * f))
  return (r << 16) | (g << 8) | b
}
```

各零件的組成與三角形成本（`box` = 12、`cyl(seg)` = `seg × 4`）：

- `trussTower`：四根角柱（`box` ×4 = 48）＋每層平台一片與外側欄杆兩道
  （`box` ×3 × layers）＋每層一片斜樓梯板（`box` × layers）＋頂上兩根
  細管（`cyl(…, 3)` ×2 = 24）。`layers = 4` → 48 + 4×48 + 24 = **288**。
  樓梯板抬 0.3 m，斜板的下角不得穿到地面下。
- `uprightTank`：八邊筒（`cyl(r, h × 0.92, …, 8)` = 32）＋淺錐頂
  （`cyl(r, h × 0.08, …, 8, r × 0.25)` = 32）＝ **64**。外廓正好是
  `2r × h`，測試量它。
- `horizTank`：臥筒（`cyl(…, 8)` 加 `rx: 90` = 32）＋兩座鞍座
  （`box` ×2 = 24）＝ **56**。
- `sphereTank`：兩個對扣的截錐（`cyl(…, 8)` ×2 = 64）。真球在這個距離
  看不出來，省 5 倍三角形。
- `fanStack`：八邊筒（32）＋頂上一片十字扇葉（`box` = 12）＝ **44**。
- `sawtoothHall`：牆體（`box` = 12）＋每個鋸齒一片斜屋頂板與一片天窗
  （`box` ×2 × teeth）。`teeth = 4` → 12 + 96 = **108**。斜板轉 20°，
  轉之前先把長寬縮到轉完仍在 `w × d` 的腳印內。整棟由 `ry` 轉向。
- `railTrack`：一整條薄板（`box` = 12），高 0.4 m。枕木不做 —— 俯視
  看不見，只吃三角形。
- `railCar`：底架（`box`）＋車身（罐車 `cyl(…, 6)` = 24、敞車 `box`）
  ＋兩組轉向架（`box` ×2）。罐車 = **48**。
- `bundWall`：四道薄牆（`box` ×4 = **48**），外緣各外推 2 m。
- `pipeBridge`：每 12 m 一個門型鋼架（兩柱一樑 = 36）＋每根管一支
  三角柱（`cyl(…, 3)` = 12）。**把現有 `plantScenery.ts` 的管架那一段
  原樣搬過來**，只把顏色換成 `grime(seed)`、相對座標換成世界座標。

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/plant-parts.test.ts` 然後 `npx tsc --noEmit 2>&1 | wc -l`

Expected: PASS。三角形數對不上時**改測試裡的期望值**（它是預算的分母，
要準），不要為了遷就數字去改零件的造型。

- [ ] **Step 5：提交**

```bash
git add src/render/geometry/ground/plantParts.ts test/unit/plant-parts.test.ts
git commit -m "feat(render): 廠區零件工廠 —— 桁架塔、槽、鋸齒廠房、軌道、管線橋"
```

---

### Task 3：六個機能填充器

**Files:**
- Create: `src/render/geometry/ground/plantFill.ts`
- Test: `test/unit/plant-fill.test.ts`

**Interfaces:**
- Consumes: `PLANT_BLOCKS`, `type PlantBlock`, `PLANT_LAYOUT`, `TRUCKS`,
  `ROADS`, `ROAD_WIDTH`, `PLANT_CENTER`（`world/leuna`）；`PLANT_SIZE`
  （`./plant`）；Task 2 的全部零件
- Produces:
  - `interface Keepout { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }`
  - `keepouts(): Keepout[]`
  - `fillBlock(block: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[]`

- [ ] **Step 1：寫失敗的測試**

Create `test/unit/plant-fill.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Box3, type BufferGeometry } from 'three'
import { fillBlock, keepouts } from '../../src/render/geometry/ground/plantFill'
import { PLANT_BLOCKS, PLANT_CENTER, PLANT_LAYOUT } from '../../src/world/leuna'
import { PLANT_SIZE } from '../../src/render/geometry/ground/plant'

function bounds(parts: BufferGeometry[]): Box3 {
  const b = new Box3()
  for (const p of parts) {
    p.computeBoundingBox()
    b.union(p.boundingBox!)
  }
  return b
}

/** 10 m 格塗格，回覆蓋率。三角形的 XZ 包圍盒塗格 —— 高估法 */
function coverage(
  parts: BufferGeometry[], b: { x0: number; z0: number; x1: number; z1: number },
): number {
  const CELL = 10
  const nx = Math.max(1, Math.round((b.x1 - b.x0) / CELL))
  const nz = Math.max(1, Math.round((b.z1 - b.z0) / CELL))
  const grid = new Uint8Array(nx * nz)
  for (const p of parts) {
    const pos = p.getAttribute('position')
    for (let t = 0; t < pos.count; t += 3) {
      let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity
      for (let k = 0; k < 3; k++) {
        const X = pos.getX(t + k)
        const Z = pos.getZ(t + k)
        ax = Math.min(ax, X); bx = Math.max(bx, X)
        az = Math.min(az, Z); bz = Math.max(bz, Z)
      }
      const i0 = Math.max(0, Math.floor((ax - b.x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((bx - b.x0) / CELL))
      const j0 = Math.max(0, Math.floor((az - b.z0) / CELL))
      const j1 = Math.min(nz - 1, Math.floor((bz - b.z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
    }
  }
  let on = 0
  for (const v of grid) on += v
  return on / grid.length
}

describe('街廓填充器', () => {
  const blocked = keepouts()

  it('鋪出來的東西不出街廓、不陷地', () => {
    for (const b of PLANT_BLOCKS) {
      const parts = fillBlock(b, blocked)
      if (parts.length === 0) continue
      const bb = bounds(parts)
      expect(bb.min.x, `${b.kind} 越西界`).toBeGreaterThanOrEqual(b.x0 - 0.01)
      expect(bb.max.x, `${b.kind} 越東界`).toBeLessThanOrEqual(b.x1 + 0.01)
      expect(bb.min.z, `${b.kind} 越北界`).toBeGreaterThanOrEqual(b.z0 - 0.01)
      expect(bb.max.z, `${b.kind} 越南界`).toBeLessThanOrEqual(b.z1 + 0.01)
      expect(bb.min.y, `${b.kind} 陷地`).toBeGreaterThanOrEqual(-0.01)
    }
  })

  /**
   * 【要逐街廓量，不能只量整片】只量整片的話，把一個填充器整支停掉，
   * 其他五個補得回來，護欄仍是綠的。
   */
  it('每一個非 open 街廓的覆蓋率至少 25%', () => {
    for (const b of PLANT_BLOCKS) {
      if (b.kind === 'open') continue
      const c = coverage(fillBlock(b, blocked), b)
      expect(c, `${b.kind} (${b.x0},${b.z0}) 只有 ${(c * 100).toFixed(1)}%`)
        .toBeGreaterThanOrEqual(0.25)
    }
  })

  it('open 街廓是留白：覆蓋率低於 8%', () => {
    for (const b of PLANT_BLOCKS) {
      if (b.kind !== 'open') continue
      expect(coverage(fillBlock(b, blocked), b)).toBeLessThan(0.08)
    }
  })

  it('避讓：沒有任何頂點落在可炸構件的腳印加 6 m 之內', () => {
    for (const b of PLANT_BLOCKS) {
      for (const p of fillBlock(b, blocked)) {
        const pos = p.getAttribute('position')
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i)
          const z = pos.getZ(i)
          for (const t of PLANT_LAYOUT) {
            const s = PLANT_SIZE[t.kind]
            const cx = PLANT_CENTER.x + t.dx
            const cz = PLANT_CENTER.z + t.dz
            const hit = Math.abs(x - cx) < s.x / 2 + 6 && Math.abs(z - cz) < s.z / 2 + 6
            expect(hit, `佈景壓在 ${t.kind} 上：(${x.toFixed(1)},${z.toFixed(1)})`).toBe(false)
          }
        }
      }
    }
  })

  it('決定性：同一個街廓鋪兩次逐位元相同', () => {
    const b = PLANT_BLOCKS.find((k) => k.kind === 'tankFarm')!
    const a1 = fillBlock(b, blocked)
    const a2 = fillBlock(b, blocked)
    expect(a2.length).toBe(a1.length)
    for (let i = 0; i < a1.length; i++) {
      expect(Array.from(a2[i]!.getAttribute('position').array as Float32Array))
        .toEqual(Array.from(a1[i]!.getAttribute('position').array as Float32Array))
    }
  })

  it('避讓表涵蓋十二座構件、八台卡車與每一條道路', () => {
    expect(keepouts().length).toBeGreaterThanOrEqual(12 + 8 + 5)
  })
})
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/plant-fill.test.ts`

Expected: FAIL，找不到模組。

- [ ] **Step 3：實作 `plantFill.ts`**

檔頭要寫的三件事：一個街廓進、一批零件出；工廠是格線的（所以用格線不用
撒點）；避讓是硬約束（佈景沒有命中盒，疊上去會看到炸彈穿過管架在構件上
爆，畫面上像命中判定壞了）。

骨架：

```ts
/** 種子進、序列出。與 world/leuna.ts 的 makeRand 同一式 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export interface Keepout {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
}

/**
 * 不能擺佈景的矩形：可炸構件的腳印加 6 m、卡車加 4 m、道路的半寬加 2 m。
 * 建構期算一次，`fillBlock` 的呼叫端傳進去 —— 每個街廓重算是 24 倍的白工。
 */
export function keepouts(): Keepout[] {
  const out: Keepout[] = []
  for (const t of PLANT_LAYOUT) {
    const s = PLANT_SIZE[t.kind]
    out.push({
      x0: PLANT_CENTER.x + t.dx - s.x / 2 - 6, x1: PLANT_CENTER.x + t.dx + s.x / 2 + 6,
      z0: PLANT_CENTER.z + t.dz - s.z / 2 - 6, z1: PLANT_CENTER.z + t.dz + s.z / 2 + 6,
    })
  }
  for (const t of TRUCKS) {
    out.push({ x0: t.x - 7, x1: t.x + 7, z0: t.z - 7, z1: t.z + 7 })
  }
  for (const road of ROADS) {
    for (let s = 0; s + 1 < road.length; s++) {
      const a = road[s]!
      const b = road[s + 1]!
      const pad = ROAD_WIDTH / 2 + 2
      out.push({
        x0: Math.min(a.x, b.x) - pad, x1: Math.max(a.x, b.x) + pad,
        z0: Math.min(a.z, b.z) - pad, z1: Math.max(a.z, b.z) + pad,
      })
    }
  }
  return out
}

/** 一個以 (x, z) 為中心、半徑 r 的位子有沒有被佔 */
function free(x: number, z: number, r: number, blocked: readonly Keepout[]): boolean {
  for (const k of blocked) {
    if (x + r > k.x0 && x - r < k.x1 && z + r > k.z0 && z - r < k.z1) return false
  }
  return true
}

export function fillBlock(block: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  switch (block.kind) {
    case 'tankFarm': return fillTankFarm(block, blocked)
    case 'process': return fillProcess(block, blocked)
    case 'halls': return fillHalls(block, blocked)
    case 'railyard': return fillRailyard(block, blocked)
    case 'utility': return fillUtility(block, blocked)
    case 'open': return fillOpen(block, blocked)
  }
}
```

六支填充器的規格（每一支都：先算格線 → 逐格 `free` 檢查 → 通過才擺；
顏色一律 `grime(block.seed * 31 + 序號)`）：

- `fillTankFarm`：先 `bundWall` 圍住街廓內縮 12 m 的矩形。槽半徑由
  `rand()` 在 `[8, 16]` 抽三級，格距 = 該級半徑 × 2.6；逐格 `uprightTank`。
  每兩排之間拉一條 `pipeBridge`（架高 5、管 3）。
- `fillProcess`：沿長軸放 3–4 座 `trussTower`（`size` 16–26、`layers` 3–6），
  塔距 = `size × 2.2`；塔之間鋪成排的細高塔柱 `uprightTank`
  （`r` 3–5、`h` 20–34），柱距 9 m；每座塔到下一座拉 `pipeBridge`
  （架高 6–10、管 3–5）；剩下的空隙填 `horizTank` 與 `fanStack`。
- `fillHalls`：2–3 棟 `sawtoothHall`（`w` 40–70、`d` 20–34、`h` 8–14、
  `teeth` 3–6），長軸對齊街廓長軸，棟距 14 m；屋頂之間一條 `pipeBridge`
  （架高 12）。
- `fillRailyard`：3–5 股 `railTrack` 平行、股距 8 m、貫穿街廓長軸；
  每股停 2–4 節 `railCar`（罐車與敞車交錯，長 14 m、間距 16 m）；
  街廓的一端放一棟 `sawtoothHall` 當卸料棚。
- `fillUtility`：一棟小 `sawtoothHall`（`w` 30、`d` 18、`teeth` 3）
  ＋ 4–6 座 `fanStack` 成排（`r` 4–6、`h` 6–10、間距 14 m）
  ＋ 2–3 座 `sphereTank`（`r` 7–10）＋一片變電站（`box` 的框架柱陣列，
  6 × 3 根，柱距 6 m）＋兩堆壓扁的 `box` 當堆煤。
- `fillOpen`：2–3 個 `horizTank` 與一小堆 `box`。覆蓋率壓在 8% 以下 ——
  **這是留白，不是還沒做完**。

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/plant-fill.test.ts`

Expected: PASS。覆蓋率不足 25% 的街廓：**加物件或縮格距，不要改門檻**
—— 門檻是負責人裁的。

- [ ] **Step 5：提交**

```bash
git add src/render/geometry/ground/plantFill.ts test/unit/plant-fill.test.ts
git commit -m "feat(render): 六個機能填充器 —— 儲槽、製程、廠房、調車場、動力、留白"
```

---

### Task 4：佈景網格改走街廓表

**Files:**
- Modify: `src/render/geometry/ground/plantScenery.ts`
- Modify: `src/world/leuna.ts`（刪 `pipeRacks`／`steelTowers`／`sheds`）
- Modify: `test/unit/plant-scenery.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `fillBlock`／`keepouts`、Task 2 的 `pipeBridge`
- Produces: `buildPlantScenery(): BufferGeometry`（簽名不變）

- [ ] **Step 1：改測試（先驗紅）**

`test/unit/plant-scenery.test.ts`：三角形那一條改成預算的上下限，並加
覆蓋率那一條。匯入加 `PLANT_CENTER, PLANT_PAD`：

```ts
  it('三角形在 15 萬到 40 萬之間', () => {
    expect(g.index).toBeNull()
    const tris = pos.count / 3
    expect(tris).toBeGreaterThanOrEqual(150_000)
    expect(tris).toBeLessThanOrEqual(400_000)
  })

  /**
   * 【俯視覆蓋率】這一關的視距重心是投彈高度的俯視，而「填滿」是可以量的：
   * 把每個三角形的 XZ 包圍盒塗進 10 m 格。**包圍盒是高估** —— 高估法都
   * 過不了門檻的話，實際只會更空。
   */
  it('墊面的俯視覆蓋率至少 35%', () => {
    const CELL = 10
    const x0 = PLANT_CENTER.x - PLANT_PAD.halfX
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ
    const nx = Math.round(PLANT_PAD.halfX * 2 / CELL)
    const nz = Math.round(PLANT_PAD.halfZ * 2 / CELL)
    const grid = new Uint8Array(nx * nz)
    for (let t = 0; t < pos.count; t += 3) {
      let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity
      for (let k = 0; k < 3; k++) {
        const X = pos.getX(t + k)
        const Z = pos.getZ(t + k)
        ax = Math.min(ax, X); bx = Math.max(bx, X)
        az = Math.min(az, Z); bz = Math.max(bz, Z)
      }
      const i0 = Math.max(0, Math.floor((ax - x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((bx - x0) / CELL))
      const j0 = Math.max(0, Math.floor((az - z0) / CELL))
      const j1 = Math.min(nz - 1, Math.floor((bz - z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
    }
    let on = 0
    for (const v of grid) on += v
    const ratio = on / grid.length
    expect(ratio, `覆蓋率只有 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.35)
  })
```

- [ ] **Step 2：跑測試確認紅**

Run: `npx vitest run test/unit/plant-scenery.test.ts`

Expected: FAIL —— 三角形 50,532 低於下限、覆蓋率 7.6% 低於 35%。
**把實測的兩個數字記在提交訊息裡**，那是這一輪的起點。

- [ ] **Step 3：改 `plantScenery.ts`**

- 開頭算一次 `const blocked = keepouts()`，走 `PLANT_BLOCKS`，對每一個
  `parts.push(...fillBlock(b, blocked))`。
- 管線橋改成沿巷道的骨幹：`PLANT_LANES.x` 的每一條（貫穿墊面南北）與
  `PLANT_LANES.z` 的每一條（貫穿東西）各一條 `pipeBridge`，架高在
  6–9 之間輪替、管數 3–5。
- **刪掉** `PLANT_SCENERY.pipeRacks`、`steelTowers`、`sheds` 三份清單
  與 `plantScenery.ts` 裡對應的三段（骨幹與填充器取代它們）。
- 圍牆、沙包、電線桿三段**原樣留著**。
- 檔頭的三角形預算那一句改成 40 萬。

- [ ] **Step 4：跑測試確認綠**

Run: `npx vitest run test/unit/plant-scenery.test.ts test/unit/leuna.test.ts test/unit/plant-fill.test.ts`
然後 `npx tsc --noEmit 2>&1 | wc -l`

Expected: PASS。覆蓋率過不了就回 Task 3 加密度；超過 40 萬就降密度，
或把 `sawtoothHall` 的鋸齒數減一。

- [ ] **Step 5：提交**

```bash
git add src/render/geometry/ground/plantScenery.ts src/world/leuna.ts test/unit/plant-scenery.test.ts
git commit -m "feat(render): 廠區佈景改走街廓填充，俯視覆蓋率拉到 35%"
```

---

### Task 5：十二座可炸構件的外型

**Files:**
- Modify: `src/render/geometry/ground/plant.ts`
- Test: `test/unit/ground-units.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `grime`、`trussTower`、`pipeBridge`
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

- `hydroTower`（8 × 40 × 8）：細塔身＋四根角柱的鋼骨架（`trussTower`
  的 `size = 7.6`、`layers = 5`）＋兩根貼著塔身爬的三角柱管＋頂上的
  小附屬槽。
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

每一件的顏色走 `grime`，序號用 `kind` 的字串雜湊固定住 —— 同一種構件
每次建都同一色。

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

`plantFill.ts` 的 `fillProcess`／`fillUtility` 要把這些煙囪的幾何也建
出來（`cyl(…, 6)` 的錐形磚身），否則煙從空中冒出來。做法：兩支填充器
在鋪完之後走一次 `PLANT_STACKS`，落在自己街廓內的就建。

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
git add src/world/leuna.ts src/main.ts src/render/geometry/ground/plantFill.ts test/unit/plant-stacks.test.ts
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

- **Spec 覆蓋**：§15.2 → Task 1；§15.3 → Task 2、3、4；§15.4 → Task 6；
  §15.5 → Task 5；§15.6 → Task 2（`grime`）；§15.7 → Task 7；
  §15.8 的九條護欄 → Task 1、3、4、5、6、7、8。
- **型別一致**：`PlantBlock` 的欄位名（`x0/z0/x1/z1/kind/seed`）在
  Task 1、3、4、6 一致；`Keepout` 只在 Task 3 定義、Task 4 使用；
  零件的簽名在 Task 2 定義、Task 3 與 Task 5 使用。
- **沒有佔位**：每一步都有可執行的指令或可貼上的程式碼。
