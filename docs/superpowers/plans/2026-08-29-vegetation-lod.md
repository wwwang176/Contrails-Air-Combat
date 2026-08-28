# 植被與地面聚落 實作計畫

> **For agentic workers:** 本計畫由 Claude 於同一個 session 內 inline 執行。
> 每個任務結束都要跑該任務指定的測試指令、`tsc`，然後提交。
>
> **本版已納入 Codex 2026-08-29 的十七條 BLOCKER。** 被它抓到的地方在對應
> 段落標了「【Codex #n】」。

**Goal:** 農地與群島兩張圖長出樹、樹籬灌木、樹林、村落與教堂尖塔，帶四段 LOD；
田裡加上犁溝條紋。

**Architecture:** 一套 tile ＋ LOD 引擎（`render/vegetation.ts`），四個放置來源
（`render/flora.ts`）。所有實例由「全域決定性生成器 ＋ tile 過濾」產生，
所以同一株的座標與「哪一格在生成」無關。

**Spec:** `docs/superpowers/specs/2026-08-29-vegetation-lod-design.md`

## Global Constraints

- **不得 `Math.random`。** 一切由整數雜湊決定。
- **不得 `git add -A`** —— `bash.exe.stackdump` 是被追蹤的檔案且不斷變動。
- **`src/battle/` 不得 import `src/render/`。** 植被全部住在 `src/render/`。
- **沒有 `@types/node`。** 測試與 e2e 都不得用 `process` / `fs`。
- **沒有任何貼圖。**
- 註解寫現狀，不寫沿革。
- 指令：
  - 單元測試 `node node_modules/vitest/vitest.mjs run <path>`
  - 型別 `node node_modules/typescript/bin/tsc --noEmit`
    （**基線 23 行**，2026-08-29 實測，存在 scratchpad 的 `tsc-baseline.txt`，用 diff 比）
  - GLSL 編譯 `node node_modules/vite-node/vite-node.mjs test/e2e/glsl-compile.e2e.ts`
- **每一條新測試都要先驗紅**，或以變異證明它承重。
- 提交訊息走檔案：`git commit -F <scratchpad>/msg.txt`，含兩行 trailer。

---

## 全域的資料形狀（Task 4 建立）

```ts
export const FLORA_STRIDE = 6            // x, y, z, rotY, scale, tint

export const enum FloraKind {
  BroadTree = 0, ConeTree = 1, Bush = 2, House = 3, Barn = 4, Church = 5,
}

export interface FloraBuffer {
  readonly data: Float32Array            // capacity * FLORA_STRIDE
  readonly kind: Uint8Array              // capacity
  readonly capacity: number
  count: number
  /** 容量不足丟掉幾筆。**不得靜默截斷** */
  dropped: number
}

export type FloraSource = (
  x0: number, z0: number, x1: number, z1: number,
  heightAt: (x: number, z: number) => number,
  out: FloraBuffer,
) => void
```

### 鐵律一：座標只由全域索引決定

tile 的邊界**只能用來過濾**（`x0 ≤ x < x1 && z0 ≤ z < z1`），不得進入座標的
計算。違反的話相鄰兩格的接縫上會重複或缺漏，而且鏡頭一動植被就換位置。

**【Codex #3】「不重複」與「密度差不多」證明不了這件事。** 每個來源都要有
這一條**分割等價**測試：

```ts
/** 大 AABB 的結果，必須與把它切成 N × N 個半開子矩形之後的聯集逐位元相同 */
function assertPartitionEquivalent(src: FloraSource, x0, z0, x1, z1, n: number) {
  const whole = collect(src, x0, z0, x1, z1)
  const parts: Row[] = []
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    parts.push(...collect(src,
      x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * j / n,
      x0 + (x1 - x0) * (i + 1) / n, z0 + (z1 - z0) * (j + 1) / n))
  }
  expect(parts.length).toBe(whole.length)
  expect(sortRows(parts)).toEqual(sortRows(whole))     // Float32 逐位元
}
```

測試範圍要**刻意**跨 tile 界、跨區塊界、負座標，以及格線正上方。

### 鐵律二：沒有一條測試可以在「零筆」時通過

**【Codex #4】** 每一組集合性斷言的前面都要先斷言筆數下界，而且下界要由
密度推出來（不是隨手寫一個 1）。

---

## Task 1: `fields.ts` —— 三支匯出與樹林地色

**Files:** Modify `src/render/fields.ts`；Test `test/unit/fields.test.ts`

**Interfaces（Produces）**

```ts
export function regionSeed(i: number, j: number, out: Vec2): number
export function regionParams(id: number, out: RegionSample): void
export interface SplitCut {
  /** 0 = 切線垂直於區塊的 x 軸（沿 z 走）；1 = 沿 x 走 */
  axis: number
  /** 切線在區塊座標系的位置 */
  at: number
  /** 切線的兩端 */
  lo: number
  hi: number
}
export function splitCut(c: number, r: number, reg: RegionSample, out: SplitCut): boolean
export const WOOD_CHANCE = 0.05
export function isWoodField(id: number): boolean
```

**【Codex #2】`regionAt` 與 `fieldAt` 自己也要改成呼叫這三支**，否則就是兩份
公式。`splitCut` 必須是 `fieldAt` 裡那一段對切邏輯的唯一來源。

- [ ] **Step 1: 先驗紅（8 條）**

```ts
it('regionSeed 與 regionAt 用的是同一顆種子', () => {
  for (const [i, j] of [[0, 0], [3, -2], [-5, 7]] as const) {
    regionSeed(i, j, P); regionAt(P.x, P.z, REG)
    expect(REG.r1).toBeLessThan(1e-6)
  }
})

it('regionParams(id) 與 regionAt 給的參數相同', () => {
  for (let k = 0; k < 200; k++) {
    const x = k * 137.5, z = k * 91.3
    regionAt(x, z, REG)
    regionParams(REG.id, OTHER)
    expect(OTHER.angle).toBe(REG.angle)
    expect(OTHER.cellW).toBe(REG.cellW)
    expect(OTHER.cellH).toBe(REG.cellH)
    expect(OTHER.tone).toBe(REG.tone)
  }
})

it('splitCut 就是 fieldAt 認定的那一條切線', () => {
  // 在切線上取點，fieldAt 的 edge 必須接近 0；
  // 切線兩側 5 m 處，part 必須不同（id 不同）
  // 【承重】splitCut 若回錯的位置，這一條立刻紅
})

it('有對切的格子佔 SPLIT_CHANCE —— 精確計數', () => {
  // 【Codex #5】不要用寬鬆的比例。固定 4,000 個 (c, r)，
  // 斷言 splitCut 回 true 的**確切筆數**（第一次跑印出來，寫死）
  expect(hits).toBe(EXPECT_SPLIT_HITS)
})

it('樹林田的比例 —— 精確計數', () => {
  // 同上：固定 10,000 個 id，斷言 isWoodField 為真的確切筆數
  expect(woods).toBe(EXPECT_WOOD_HITS)
  // 再加一條量級護欄，讓寫死的數字自己說得出意義
  expect(woods / 10000).toBeGreaterThan(0.03)
  expect(woods / 10000).toBeLessThan(0.07)
})

it('樹林用的位元與犁田、色調、明度都不重疊', () => {
  // 24–31 位。改動 0–23 位不得改變 isWoodField 的答案
})

it('樹林田的地色比任何一塊非樹林的田都暗', () => { /* 不比樹籬 */ })

it('GLSL 有 isWoodField 與樹林色，而且常數由 TS 產生', () => {})
```

- [ ] **Step 2: 跑，確認全紅**
- [ ] **Step 3: 實作**

```ts
export function regionSeed(i: number, j: number, out: Vec2): number {
  const h = hash2(i, j)
  out.x = (i + 0.5 + ((h & 0xffff) / 65536 - 0.5) * 0.76) * REGION_SPACING
  out.z = (j + 0.5 + ((h >>> 16) / 65536 - 0.5) * 0.76) * REGION_SPACING
  return h
}

/** 一塊田整片變成樹林的機率 */
export const WOOD_CHANCE = 0.05
/** 樹林。比色盤最深的一階再暗，而且不在漸層上 */
const WOOD = 0x2f3a28

/**
 * 這塊田是不是樹林。**放置與地色共用這一支** —— `flora.ts` 用它決定要不要
 * 在這塊田裡填樹，`fieldSurfaceColor` 用它決定地色。兩邊分家的話，會出現
 * 「深綠的地上沒有樹」或「樹長在麥田裡」。
 *
 * 【位元的挑選】低 8 位是犁田、8–15 是色調、16–23 是明度抖動。樹林用
 * 24–31，四者互不相關。
 */
export function isWoodField(id: number): boolean {
  return ((id >>> 24) & 0xff) / 256 < WOOD_CHANCE
}
```

`fieldSurfaceColor` 的順序：凹路 → 樹籬 → **樹林** → 犁田 → 作物。
`FIELD_GLSL` 同步加 `isWoodField` 與 `WOOD_COLOR`，常數由樣板字串內插。

- [ ] **Step 4: 全綠**
- [ ] **Step 5: GLSL 真的編得過**（不得跳過 —— `half` 那次全套件全綠而畫面全黑）
- [ ] **Step 6: `tsc` diff 比基線 ＋ 提交**

---

## Task 2: 犁溝與作物條紋（GLSL 專屬）

**Files:** Modify `src/render/fields.ts`；Test `test/unit/fields.test.ts`

- [ ] **Step 1: 先驗紅**

```ts
it('條紋確實被 fieldColorAt 呼叫，不是宣告了放著', () => {
  // 【Codex #7】只檢查 'fwidth' 與 'stripe' 存在的話，
  // 把 helper 放著不用也會綠。把**呼叫點那一行**放進金本位白名單
  expect(FIELD_GLSL).toContain('col *= stripe(q, STRIPE_PERIOD, amp);')
})

it('CPU 那一份沒有條紋，而且這是寫明的例外', () => {
  // fields.ts 的檔頭必須寫明理由（抗鋸齒需要導數）
})

it('犁田的條紋幅度是作物的兩倍', () => {
  expect(FIELD_GLSL).toContain('float amp = ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP;')
})
```

- [ ] **Step 2: 驗紅 → Step 3: 實作**

```glsl
// 【條紋只在 GPU 上做】抗鋸齒需要片段導數，CPU 沒有對應物。取樣不足時自動
// 淡掉 —— 沒有這一步的話 1 km 外整片田會出現摩爾紋，比沒有條紋更糟。
float stripe(vec2 q, float period, float amp) {
  float u = q.y / period;
  float fade = 1.0 - smoothstep(0.15, 0.5, fwidth(u));
  return 1.0 + amp * fade * (fract(u) < 0.5 ? 1.0 : -1.0);
}
```

**金本位測試不用改結構** —— 它是一份逐行 `toContain` 白名單
（`fields.test.ts:254`），把上面兩行加進 `want` 就承重了。原本計畫的
`CORE-BEGIN` / `CORE-END` 標記是多餘的，不做。

**順手修**：`fields.test.ts:236` 的註解說語法由 `farmland-shot.e2e.ts` 守，
實際上是 `glsl-compile.e2e.ts`。

- [ ] **Step 4: 綠 → Step 5: GLSL 編譯 → Step 6: `tsc` ＋ 提交**

---

## Task 3: `island.ts` 匯出草帶的謂語，並把撞名改掉

**Files:** Modify `src/render/island.ts`；Test `test/unit/island-shade.test.ts`（新，5 條）

**【Codex #16】只給謂語還不夠 —— 把撞名從源頭拿掉。**
`island.ts` 的 `SHORE_BAND`（12，顏色分帶）改名為 **`GRASS_MIN_HEIGHT`**；
`archipelago.ts` 的 `SHORE_BAND`（200，烘岸）不動。`flora.ts` **只 import
`isGrass`**，看不到任何一個常數。

**Produces:** `GRASS_MIN_HEIGHT`、`ROCK_FRACTION`、`shade`、
`isGrass(h, peak): boolean`

- [ ] **Step 1: 先驗紅**

```ts
it('isGrass 與 shade 對同一個高度給同一個答案', () => {
  for (const peak of [100, 350, 900]) {
    for (let h = 0; h < peak; h += peak / 400) {
      expect(isGrass(h, peak)).toBe(shade(h, peak, C).getHex() === GRASS_HEX)
    }
  }
})
it('草帶的下界是 12，不是 200', () => {
  expect(isGrass(20, 900)).toBe(true)      // 【Codex #16】拿錯常數這一條就紅
  expect(isGrass(11, 900)).toBe(false)
})
it('沙灘與裸岩都不是草', () => {})
it('峰高很低的島也有草帶', () => {})
it('專案裡沒有第二個名叫 SHORE_BAND 的高度分帶常數', () => {
  // 讀 island.ts 的原始碼，斷言不含 'SHORE_BAND'
})
```

- [ ] **Step 2 – 6:** 驗紅 → 改名與匯出 → 綠 → `tsc` ＋ 提交

---

## Task 4: `flora.ts` 的骨架、樹籬的喬木與灌木

**Files:** Create `src/render/flora.ts`；Test `test/unit/flora-hedge.test.ts`（新，12 條）

**Consumes:** `regionAt`、`regionParams`、`regionSeed`、`fieldAt`、`edgeAt`、
`splitCut`、`HEDGE_WIDTH`、`REGION_SPACING`

**Produces:** `FLORA_STRIDE`、`FloraKind`、`FloraBuffer`、`createFloraBuffer`、
`pushFlora`、`farmHedgeFlora: FloraSource`

### 4.1 走線要覆蓋三種線（實測，2026-08-29）

```
  樹籬帶的取樣點      300,385
  其中落在格線上的    264,910（88.2 %）
  只走格線會漏掉      11.8 %
```

漏掉的是 `SPLIT_CHANCE` 對切出來的那一刀 —— `fieldAt` 認定它是樹籬、著色器
把它畫成暗帶，但它不在任何一條格線上。**那些樹籬會畫在地上卻沒有樹。**

三種線：橫線（salt 1）、縱線（`colSalt = r * 2 + 1`，限制在該列的上下界之間）、
**對切線**（`splitCut`）。

### 4.2 一格 tile 可能屬於好幾個區塊

**【Codex #1】四角加中心是猜的**（細長的楔形可以穿過 tile 而不含那五點），
而且原稿的驗證條件還寫成「等於 tile 中心那一區」，照字面做等於其他區塊全丟掉。

正確的列舉 —— **與 `regionAt` 自己的 3×3 搜尋同一個範圍，再加一道精確的剔除**：

```
候選 = tile 中心所在區塊格的 3×3 共 9 顆種子
對每一顆 s_i：
  dMin = tile 的 AABB 到 s_i 的最短距離
  若存在另一顆 s_k 使 dMin > (tile 的 AABB 到 s_k 的**最長**距離)
     → s_i 在這格 tile 裡永遠贏不了任何一點，剔除
```

這道剔除是**保守且精確的**：被剔除的種子不可能擁有 tile 內任何一點
（`d(p,s_i) ≥ dMin > dMax_k ≥ d(p,s_k)`），所以不會漏；留下來的通常只有
一到三顆。每一顆用 `regionParams(id)` 拿參數各走一遍，
**候選點的驗證條件是「`regionAt` 回的 id 等於我正在走的那一個」**，不是
tile 中心那一個。

### 4.3 灌木

**【Codex #6】灌木原本完全沒有生成任務**，bush 那個池會永遠是 0。
灌木走**同樣的三種線**，間距 6 m，索引與喬木各自獨立（各有各的全域 `m`），
`FloraKind.Bush`。目標密度 1,184 叢/km²。

### 4.4 走線的細節

```
沿線的位置由**全域索引 m** 決定：t = (m + 0.5 + jitter(m)) * SPACING
側向再抖 ±3 m。轉回世界座標：
  x = qx·cos a − qz·sin a
  z = qx·sin a + qz·cos a
過濾：不在 [x0, x1) × [z0, z1) 就丟掉
驗證：regionAt(x, z).id === 正在走的區塊，且 fieldAt 回 hedged
      且 edge < HEDGE_WIDTH / 2
樹種：由**那條線**的雜湊決定，不是逐棵 —— 整排同種才讀得出防風林
```

- [ ] **Step 1: 先驗紅（12 條）**

```ts
const H = (): number => 0

it('分割等價：大 AABB ≡ 切成 4×4 之後的聯集', () => {
  assertPartitionEquivalent(farmHedgeFlora, -600, -600, 600, 600, 4)
})
it('分割等價：跨區塊界、負座標、格線正上方', () => { /* 三個刻意挑的窗 */ })
it('決定性：同一格生兩次逐位元相同', () => {})
it('每一棵都在樹籬帶上，而且筆數 > 400', () => {})
it('每一株都落在自己那一格裡', () => {})
it('對切線上也長樹（不在格線上的佔 > 5%）', () => {})
it('樹籬帶的覆蓋率：每 5 m 取樣，到最近一棵的距離 p95 < 14 m', () => {})
it('跨區塊的 tile 兩邊都有樹', () => {
  // 先找一格真的跨兩區的 tile（4.2 的列舉回兩顆以上），再斷言兩側都非空
})
it('同一條樹籬是同一種樹', () => {})
it('喬木密度 473/km² ±25%，而且筆數 > 400', () => {})
it('灌木密度 1,184/km² ±25%，而且筆數 > 1,000', () => {})
it('pushFlora 滿了就丟並累加 dropped，不覆寫既有資料', () => {
  // 容量 4 的 buffer 推 10 筆：count === 4、dropped === 6、前 4 筆完好
})
```

- [ ] **Step 2: 全紅 → Step 3: 實作 → Step 4: 全綠**
- [ ] **Step 5: 三次變異，每次都要有測試變紅**
  1. 拿掉對切線的走線 → 「對切線上也長樹」與「覆蓋率」紅
  2. 驗證改回比 tile 中心的區塊 → 「跨區塊的 tile 兩邊都有樹」紅
  3. 讓 `t` 由 tile 邊界起算而不是全域索引 → 「分割等價」紅
- [ ] **Step 6: `tsc` ＋ 提交**

---

## Task 5: 樹林

**Files:** Modify `src/render/flora.ts`；Test `test/unit/flora-wood.test.ts`（新，7 條）

**Produces:** `farmWoodFlora: FloraSource`

全域 16 m 網格，索引 `(gx, gz) = (floor(x / 16), floor(z / 16))`，位置由
`hash2(gx, gz)` 抖動。接受條件：`isWoodField(FLD.id)` 且**不在樹籬帶上**
（樹林田的邊界仍然是樹籬，不要疊兩層樹）。

- [ ] **Step 1: 先驗紅**

```ts
it('分割等價', () => {})
it('筆數：在一塊已知的樹林田上生，> 200 筆', () => {
  // 【Codex #4】先掃出一塊確定是樹林的田的座標，寫進測試當固定窗
})
it('每一棵都在樹林田裡', () => {})
it('每一棵腳下的地色就是樹林色', () => {
  // 把「放置」與「地色」釘在同一個判準上
})
it('樹林的樹不在樹籬帶上', () => {})
it('樹林田裡的密度接近 16 m 網格（3,900/km² ±25%）', () => {})
it('非樹林的田一棵都沒有', () => {})
```

- [ ] **Step 2 – 6:** 驗紅 → 實作 → 綠 → 變異（`isWoodField` 改成恆真，
      第三與第七條必須紅）→ `tsc` ＋ 提交

---

## Task 6: 村落與教堂

**Files:** Modify `src/render/flora.ts`；Test `test/unit/flora-village.test.ts`（新，10 條）

**Produces:** `villageSite(i, j, out): boolean`、`farmVillageFlora: FloraSource`

**站址**

```
1. h = regionSeed(i, j, A)
2. 由 h 挑一個軸向鄰格：((h >>> 5) & 3) → 四選一
3. regionSeed(i', j', B)
4. 站址 = A 與 B 的中點 —— 到兩顆種子等距，所以落在它們的邊界上，也就是凹路上
5. 驗證：regionAt(站址) 的 r2 − r1 < TRACK_WIDTH。不通過就沒有村
```

**建築**：站址周圍 60～140 m 內由雜湊放 6～14 棟，接受條件是離凹路中心
8～45 m。約三分之一是穀倉。**教堂**：站址雜湊 < 0.45 時一座，偏移 25 m。

**tile 的責任**：檢查周圍 2×2 個區塊格的站址（間距 3,200 ≫ tile 250），
生出那些村的建築，只留落在自己格裡的。

- [ ] **Step 1: 先驗紅（10 條）**

```ts
it('站址一定在路上，而且 9×9 格裡至少 20 個', () => {})
it('有村的格子佔三到八成', () => {})
it('房子不在路上：每棟離路中心 8–45 m', () => {})
it('每個村 6–14 棟，而且沒有一個村是 0 棟', () => {})
it('穀倉佔 25–45%，而且至少有 30 棟', () => {
  // 【Codex #17】沒有這一條，穀倉永遠是 0 也會綠
})
it('掃 40 個村，教堂總數在 12–28 之間', () => {
  // 【Codex #4】「最多一座」對零筆是空操作。要下界
})
it('每個村最多一座教堂，且在站址 40 m 內', () => {})
it('分割等價', () => {})
it('決定性 ＋ 落在自己那一格裡', () => {})
it('每棟建築的 y 等於腳下的地面高度', () => {})
```

- [ ] **Step 2 – 6:** 同節奏。變異：拿掉第 5 步的驗證 → 第一條紅。

---

## Task 7: 群島的來源

**Files:** Modify `src/render/flora.ts`；Test `test/unit/flora-island.test.ts`（新，8 條）

**Produces:** `createIslandFlora(field, islands): FloraSource`

**只 import `isGrass`**，不 import 任何高度常數（【Codex #16】）。
全域 50 m 網格（400 棵/km²）＋ 索引抖動；早退：tile 中心到每座島的距離
> `outerRadius + 200` 就整格跳過。接受條件 `isGrass(h, peak)`，`peak` 取最近
那座島的。密度乘 `cos(slope)`。

- [ ] **Step 1: 先驗紅**

```ts
it('最大的那座島上樹的總數 > 300', () => {
  // 【Codex #4】沒有這一條，一個永遠回零的來源可以通過下面每一條
})
it('12–200 m 的草帶確實有樹', () => {
  // 【Codex #16】錯用 archipelago 的 SHORE_BAND = 200 當下界的話，
  // 這一段會整片光禿，而「都符合 isGrass」仍然是綠的
  expect(treesWithHeightIn(12, 200)).toBeGreaterThan(150)
})
it('每一棵都在綠色的地方（isGrass 且 shade 回 GRASS）', () => {})
it('沒有一棵在海裡（h > 0）', () => {})
it('陡的地方比緩的地方稀疏', () => {})
it('全海的格子回 0 筆', () => {})
it('分割等價', () => {})
it('每一棵的 y 等於 field.sample(x, z)', () => {})
```

- [ ] **Step 2 – 6:** 同節奏。

---

## Task 8: 幾何

**Files:** Create `src/render/floraShapes.ts`；Test `test/unit/flora-shapes.test.ts`（新，8 條）

**【Codex #8】三角形數要與實際的建構方式對得上。**
`OctahedronGeometry(detail = 1)` 是 **32** 個三角形，不是原稿估的那樣。
球冠改用 **detail 0（8 tri）**，非等向縮放拉成樹冠的形狀。

**【Codex #9】八個幾何就要八個池。** `InstancedMesh` 一個只能綁一個 geometry，
而 `scale` 只有一個純量，做不出「比較長比較高」的穀倉。

```
  broadL0   6 邊無蓋圓柱(12) ＋ 八面體 detail 0(8)      20 tri
  coneL0    6 邊無蓋圓柱(12) ＋ 7 邊無底錐(7)           19 tri
  treeMid   6 邊無底錐，無樹幹                            6 tri
  treeFar   四面體                                        4 tri
  bush      八面體 detail 0                               8 tri
  house     盒子(12) ＋ 人字屋頂(8)                       20 tri
  barn      同形狀、比例不同                              20 tri
  church    本堂 ＋ 塔身 ＋ 尖頂                          40 tri
```

八個池 = **八個 draw call**。

- [ ] **Step 1: 先驗紅**

```ts
it('每個幾何的三角形數等於上表 —— 逐項精確比對', () => {})
it('幾何的名字與池的名字一一對應（PoolName 的聯集）', () => {})
it('每個幾何的底面在 y = 0', () => {
  // 實例的 y 直接放地面高度。底面不在 0 的話整批浮空或陷地
})
it('樹幹是棕色、樹冠是綠色（頂點色分兩群）', () => {})
it('房子的牆與屋頂顏色不同', () => {})
it('每個幾何都有法線與 boundingSphere', () => {})
it('縮放 1.0 的樹高在 12–18 m 的中間', () => {})
it('disposeFloraGeometries 之後每一個都被 dispose', () => {})
```

**材質的測試不在這裡**（【Codex #10】—— 這個模組只回 geometry），移到 Task 9。

- [ ] **Step 2 – 6:** 同節奏。

---

## Task 9: 引擎（tile 快取、LOD、池）

**Files:** Create `src/render/vegetation.ts`；Test `test/unit/vegetation.test.ts`（新，18 條）

**Produces**

```ts
export const TILE_SIZE = 250
export const FLORA_RADIUS = 2000
export const LOD_NEAR = 450
export const LOD_MID = 1100
export const LOD_FAR = 2000
export const LOD_HYSTERESIS = 40
export const BUSH_RANGE = 500
export const TILES_PER_FRAME = 4
export type PoolName =
  'broadL0' | 'coneL0' | 'treeMid' | 'treeFar' | 'bush' | 'house' | 'barn' | 'church'
export function lodFor(dist: number, prev: number): number
export function createVegetation(sources: readonly FloraSource[], heightAt): {
  object: Object3D
  update(centerX: number, centerZ: number): void
  /** 一次把生成佇列排乾。定格截圖與容量掃描要它（【Codex #11 #14】）*/
  settle(): void
  dispose(): void
  readonly counts: Readonly<Record<PoolName, number>>
  readonly stats: { dropped: number; overflow: number }
}
```

**行為**

- tile 的 key 是**數值**（`i * 65536 + j` 之類），不是字串 —— 字串每幀都在配置。
- 每幀最多生 `TILES_PER_FRAME` 格；佇列清空的那一幀重建池的矩陣。
- **LOD 或 bush 範圍改變也要標 dirty**（【Codex #13】）—— tile 集合沒變但
  鏡頭跨過門檻時，池一樣要重建。
- **中心移動超過 `FLORA_RADIUS` 視為傳送**：整個佇列丟掉重排（【Codex NOTE 5】）。
- 重建之後 `instanceMatrix.needsUpdate = true`、`instanceColor.needsUpdate = true`
  （【Codex #10】—— 少了它第一次畫得出來、之後移動仍是舊資料）。
- 池 `frustumCulled = false`。**理由**：`Frustum.intersectsObject` 對
  `InstancedMesh` 走 `object.boundingSphere`，而那顆球只在是 `null` 時算一次
  就快取；池每次重建實例全換，球就過期，症狀是某些朝向下整批樹消失。而池是
  跟著鏡頭的 4 km 圓環，那顆球恆與視錐相交 —— 剔除本來就一次也不會生效。
- 材質共用一個 `MeshStandardMaterial({ vertexColors: true, flatShading: true })`。
  `vertexColors` 不開的話 `USE_COLOR` 不定義，樹幹會跟樹冠同色。

- [ ] **Step 1: 先驗紅（18 條）**

```ts
it('lodFor 隨距離單調不增', () => {})
it('lodFor 的遲滯：邊界上來回不會每次換級', () => {})
it('引擎真的用了 LOD：鏡頭跨過門檻時各池的 count 會遷移', () => {
  // 【Codex #13】只測純函式的話，「引擎永遠塞 L0」也會全綠。
  // 固定來源、把鏡頭由 200 m 推到 1,900 m，斷言
  // broadL0 遞減、treeMid 先增後減、treeFar 遞增
})
it('灌木只出現在 500 m 內，而且 500 m 內的灌木 > 500 株', () => {})
it('tile 集合沒變、但鏡頭跨過 LOD 門檻時，池仍然會重建', () => {})
it('鏡頭移動小於一格時不重生任何 tile', () => {})
it('圈外的 tile 會被釋放，free list 回得來', () => {})
it('每幀最多生 TILES_PER_FRAME 格', () => {})
it('傳送（移動超過半徑）會丟掉舊佇列', () => {})
it('settle() 一次排乾：之後再 update 不會再生任何 tile', () => {})
it('容量掃描：200 個位置，每個先 settle，池與 tile 都不溢位', () => {
  // 【Codex #11】不 settle 的話量到的是殘缺的池，容量會被嚴重低估
  // 路線要刻意經過已知最密的樹林
  expect(stats.overflow).toBe(0)
  expect(stats.dropped).toBe(0)
  expect(maxima.treeFar).toBeGreaterThan(2000)   // 掃描本身不得是空操作
})
it('暖機後 update 不再配置：所有預配結構的身分不變', () => {
  // 【Codex #12】只比 instanceMatrix.array 不夠。
  // 逐一比對：每個 tile buffer 的 data/kind、佇列陣列、scratch Matrix4、
  // 每個池的 instanceMatrix.array 與 instanceColor.array
  // 並斷言 tile key 是 number 不是 string
})
it('重建之後 instanceMatrix 與 instanceColor 都標了 needsUpdate', () => {})
it('每個池都關了視錐剔除', () => {})
it('材質開了 vertexColors', () => {})
it('object 的子節點數等於池數（8）', () => {})
it('dispose 之後所有 geometry 與 material 都被釋放，材質只 dispose 一次', () => {})
it('空的來源不會產生任何實例，也不會崩', () => {})
```

- [ ] **Step 2: 全紅 → Step 3: 實作 → Step 4: 全綠**
- [ ] **Step 5: 掃描定值** —— 跑容量那一條，把印出來的最大值 × 1.35 進位寫進
      常數，掃描結果寫進註解（現狀，不是沿革）
- [ ] **Step 6: `tsc` ＋ 提交**

---

## Task 10: 接線

**Files:** Modify `src/render/terrain.ts`、`src/main.ts`；Test `test/unit/terrain.test.ts`（加 8 條）

- 農地：`createVegetation([farmHedgeFlora, farmWoodFlora, farmVillageFlora], solid.sample)`
- 群島：`createVegetation([createIslandFlora(field, islands)], field.sample)`
- 兩者 `group.add(veg.object)` —— **索引 3**，既有的 0/1/2 不動
- `Terrain` 加選填的 `settle?(): void`，兩種地形接上（【Codex #14】）
- `update` 把 `centerX, centerZ` 傳下去；`dispose` 加 `veg.dispose()`
- **`__gfx` 要防純海面**（【Codex #15】）：

```ts
// 【純海面沒有第四個孩子】固定回 children[3]! 的話，切到純海之後
// 消融 flora 會對 undefined 呼叫 traverse 而當場崩
flora: () => terrain.object.children.slice(3),
```

- [ ] **Step 1: 先驗紅**

```ts
it('農地的 terrain 第四個子節點是植被', () => {})
it('群島的也有', () => {})
it('純海面沒有第四個子節點', () => {})
it('__gfx 的 flora 在純海面回空陣列而不是崩', () => {})
it('terrain.update 會把鏡頭位置傳給植被', () => {})
it('terrain.settle 會排乾植被的佇列', () => {})
it('terrain.dispose 會釋放植被', () => {})
it('既有的 0/1/2 索引契約沒有變', () => {})
```

- [ ] **Step 2 – 5:** 驗紅 → 實作 → 綠 → **`npm run dev` 人眼看一次**
- [ ] **Step 6: `tsc` ＋ 提交**

---

## Task 11: 試飛截圖

**Files:** Modify `src/main.ts`；Create `test/e2e/farmland-shot.e2e.ts`

**定格前必須排乾植被。** `__still` 只呼叫一次 `terrain.update`，而引擎每幀只生
4 格 —— 直接拍會拍到光禿禿的地。**這一條同時影響既有的 `pixel-identical.e2e.ts`。**

- [ ] Step 1：`__still`（`main.ts:1457`）加選填的 `x` / `z`（接在 `time` 之後，
      既有三個呼叫端不動），並在 `terrain.update` 之後呼叫 `terrain.settle?.()`
- [ ] Step 2：`farmland-shot.e2e.ts` —— 六個定格：3 km 俯瞰、600 m 巡航、
      150 m 貼地、細節區邊緣往外、往內、**450 m 的 LOD 邊界**
- [ ] Step 3：跑一次 `pixel-identical.e2e.ts`，確認植被沒有讓它不穩定
- [ ] Step 4：人眼驗收（交給專案負責人）
- [ ] Step 5：提交

---

## Task 12: 量測與收尾

**Files:** Modify `test/e2e/frame-time.e2e.ts`（【Codex NOTE 7】）、
`test/integration/terrain-in-play.test.ts`、`docs/backlog.md`

- [ ] Step 1：`frame-time` e2e，用 `__gfx` 的 `flora` 開關各量一次
      （平均、1% low、0.1% low、掉幀數）
- [ ] Step 2：**重算三角形預算**（【Codex NOTE 6】）。幾何定稿後：
      L0 20/19 tri、treeMid 6、treeFar 4、bush 8，再加樹林那 5% 的額外樹 ——
      估計約 52k，實際由掃描確認並寫進 backlog
- [ ] Step 3：`terrain-in-play` 補農地那一場的基準
- [ ] Step 4：`docs/backlog.md` §11 —— 做了什麼、量到什麼、**沒做什麼**
      （樹的碰撞、村落的院子地色、LOD 逐 tile 切換、AI 看不見植被）
- [ ] Step 5：全套件（`perf-gate` 與 `rematch` 各自單獨跑）＋ `tsc` diff ＋ 提交

---

## Codex 十七條的處置

| # | 處置 |
|---|---|
| 1 | Task 4.2 改成 3×3 種子 ＋ 精確剔除；驗證比「正在走的那一區」 |
| 2 | `regionParams` / `splitCut` / `SplitCut` 進 Task 1，有實作步驟與承重測試 |
| 3 | 分割等價測試，四個來源都要 |
| 4 | 每組集合斷言都加筆數下界 |
| 5 | Task 1 的兩個比例改成精確計數 |
| 6 | 灌木的走線寫進 Task 4.3 |
| 7 | 條紋的**呼叫點**進金本位白名單 |
| 8 | 球冠改 detail 0，三角數表重算 |
| 9 | 八個幾何 = 八個池 = 八個 draw call |
| 10 | 材質測試移到 Task 9，加 `needsUpdate` |
| 11 | 掃描每個位置先 `settle()`，並斷言 dropped / overflow / 非空 |
| 12 | 不配置測試改成逐一比對所有預配結構的身分；tile key 用數值 |
| 13 | 加「池的 count 會隨鏡頭遷移」與「跨門檻也要 dirty」 |
| 14 | `settle()` 進正式介面、Terrain、Task 10 的測試 |
| 15 | `__gfx.flora` 用 `children.slice(3)` |
| 16 | `island.ts` 的常數改名 `GRASS_MIN_HEIGHT`；加「下界是 12 不是 200」 |
| 17 | 補落地高度、`pushFlora` 容量邊界、穀倉比例 |
| NOTE 5 | 傳送時丟掉佇列 |
| NOTE 6 | Task 12 Step 2 重算預算 |
| NOTE 7 | `frame-time` 進 Task 12 的 Files |
