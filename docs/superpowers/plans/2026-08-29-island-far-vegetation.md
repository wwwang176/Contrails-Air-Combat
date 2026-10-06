# 群島遠處植被 實作計畫

**Spec**：`docs/superpowers/specs/2026-08-29-island-far-vegetation-design.md`

**目標**：飛向一座島時，任何距離都不出現「植被整批出現」的感受。

**做法**：地色先帶上林相（免費）→ 外圈抖開（免費）→ tile 緩衝懶配（省 87 MB）
→ 群島半徑推到 12 km（因為前一項而變便宜）→ 遠處三個池改點粒子（省 2.7 倍）。

**技術**：TypeScript、three.js、vitest、playwright。

## 全域約束

- 一株植被的座標**只由它自己的全域索引決定**；tile 的邊界只用來過濾。
- 覆蓋率與 `accept()` 必須同源，不得各寫一條。
- 不得使用 `Math.random`、不得使用任何貼圖、不得引 `@types/node`。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- `island.ts` 不得 import `flora.ts`（會成環）。
- 註解寫現狀，不寫沿革。
- 每一條新測試先驗紅，或以變異證明承重。
- 逐項提交，每一項自己有畫面或數字的驗收。
- 掃描參數一律 `cp` 備份還原，不用 git。
- 提交訊息走檔案 + `git commit -F`；絕不 `git add -A`。

---

## 任務 1：地色按樹冠覆蓋率上色

**檔案**
- 改：`src/render/floraShapes.ts`（匯出 `CONE_CROWN_R`、`BUSH_R`）
- 改：`src/render/flora.ts`（抽出 `islandAccept`、新增 `islandCanopyCover`）
- 改：`src/render/island.ts`（`shade` 收覆蓋率、`createIslands` 收 `coverAt`）
- 改：`src/render/terrain.ts`（把 `islandCanopyCover` 接上）
- 測：`test/unit/flora-island.test.ts`、`test/unit/island-shade.test.ts`

**介面**
- 產出：`islandCanopyCover(field, islands): (x: number, z: number) => number`
  —— 回 0～1。
- 產出：`shade(h: number, cover: number, out: Color): Color`
- 產出：`createIslands(field, islands, coverAt?: (x, z) => number)`

- [ ] **步驟 1：把 `accept` 由 `createIslandFlora` 的閉包裡抽成模組級函式**

現在它是閉包裡的箭頭函式，覆蓋率那一支拿不到。抽成

```ts
export function islandAccept(
  field: HeightFieldData, peak: number, x: number, z: number, h: number,
): number {
  const cell = field.cell
  const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
  const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
  return (ISLAND_SHORE_DENSITY + (1 - ISLAND_SHORE_DENSITY)
    * Math.min(1, Math.max(0, h / peak))) / Math.hypot(1, Math.hypot(dx, dz))
}
```

`createIslandFlora` 改成呼叫它。這一步不改行為 —— 跑一次
`flora-island.test.ts`，13 條全綠才往下。

- [ ] **步驟 2：寫覆蓋率的失敗測試**

**分母與分子都要是「聯集」，不是「面積相加」。** 樹冠會互相重疊：名目強度
0.35 的實際遮蔽只有 `1 − e^(−0.35) ≈ 0.295`，少了五個半百分點。相加的話兩邊
同時高估，測試再寬也抓不到 —— 這一條的重點正是抓它。

實測用佔據柵格：把大島切成 2 m 的格，每一株把自己的圓蓋上去（重疊只算一次），
最後數有幾格被蓋到。

```ts
it('覆蓋率與柵格量到的實際遮蔽對得起來', () => {
  const coverAt = islandCanopyCover(arch.field, arch.islands)
  const rows = onBig()
  const CELL = 2
  const r = big.outerRadius
  const n = Math.ceil((2 * r) / CELL)
  const hit = new Uint8Array(n * n)
  for (const row of rows) {
    const rad = (row.kind === FloraKind.Bush ? BUSH_R : CONE_CROWN_R) * row.scale
    const gx = (row.x - (big.cx - r)) / CELL
    const gz = (row.z - (big.cz - r)) / CELL
    const gr = rad / CELL
    const a0 = Math.max(0, Math.floor(gx - gr))
    const a1 = Math.min(n - 1, Math.ceil(gx + gr))
    const b0 = Math.max(0, Math.floor(gz - gr))
    const b1 = Math.min(n - 1, Math.ceil(gz + gr))
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const dx = a + 0.5 - gx
        const dz = b + 0.5 - gz
        if (dx * dx + dz * dz <= gr * gr) hit[b * n + a] = 1
      }
    }
  }
  // 只在「可以長樹的地」上比，否則分母混進沙灘與海
  let covered = 0
  let usable = 0
  let predicted = 0
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const x = big.cx - r + (a + 0.5) * CELL
      const z = big.cz - r + (b + 0.5) * CELL
      if (!isGrass(height(x, z))) continue
      usable++
      covered += hit[b * n + a]!
      predicted += coverAt(x, z)
    }
  }
  const actual = covered / usable
  const model = predicted / usable
  console.log(JSON.stringify({ 模型: model.toFixed(3), 柵格: actual.toFixed(3) }))
  expect(usable).toBeGreaterThan(100000)
  expect(model).toBeGreaterThan(actual * 0.9)
  expect(model).toBeLessThan(actual * 1.1)
})
```

`collect()` 目前不回 `scale`，`Row` 要加一欄（`FLORA_STRIDE` 的第 5 欄）。

- [ ] **步驟 3：跑，確認紅**

`node node_modules/vitest/vitest.mjs run test/unit/flora-island.test.ts`
預期：`islandCanopyCover is not a function`。

- [ ] **步驟 4：實作 `islandCanopyCover`**

```ts
/** 逐株縮放均勻分佈於 [0.5, 1]，所以 E[s²] = 7/12 */
const E_SCALE2 = 7 / 12
/** 一株樹與一叢灌木的期望樹冠面積，m² */
const CONE_AREA = Math.PI * CONE_CROWN_R * CONE_CROWN_R * E_SCALE2
const BUSH_AREA = Math.PI * BUSH_R * BUSH_R * E_SCALE2 * ISLAND_BUSH_RATIO

export function islandCanopyCover(
  field: HeightFieldData, islands: readonly IslandDesc[],
): (x: number, z: number) => number {
  return (x, z) => {
    const h = field.sample(x, z)
    if (!isGrass(h)) return 0
    let peak = islands[0]!.peak
    let bd = Infinity
    for (const o of islands) {
      const d = Math.hypot(o.cx - x, o.cz - z)
      if (d < bd) { bd = d; peak = o.peak }
    }
    // 【要的是聯集不是面積和】樹冠會重疊。名目強度 λ 的實際遮蔽是
    // 1 − e^(−λ) —— λ = 0.35 時是 0.295，差五個半百分點。直接相加會讓
    // 遠處的地色比實際的林相暗
    const lambda = (islandAccept(field, peak, x, z, h) * (CONE_AREA + BUSH_AREA))
      / (ISLAND_GRID * ISLAND_GRID)
    return 1 - Math.exp(-lambda)
  }
}
```

【模型不合就校準，不要放寬測試】`1 − e^(−λ)` 假設位置是 Poisson 的，而實際是
一格一株的抖動網格 —— 比 Poisson 規則，重疊會少一點。步驟 2 的柵格量測若落在
±10% 之外，就在 λ 上乘一個由柵格反解出來的常數並把它寫進註解，不是把容忍度
放寬。

- [ ] **步驟 5：跑，確認綠**

- [ ] **步驟 6：寫「地色隨覆蓋率變暗」的失敗測試**

`test/unit/island-shade.test.ts`：

```ts
it('覆蓋率愈高地色愈暗，而且往樹冠色靠', () => {
  const bare = shade(400, 0, c).getHex()
  const full = shade(400, 1, c).clone()
  expect(shade(400, 0.35, c).getHex()).not.toBe(bare)
  // 全覆蓋時就是樹冠色
  expect(full.getHex()).toBe(CANOPY.getHex())
  // 亮度單調遞減
  let prev = 999
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const l = shade(400, k, c).getHSL({ h: 0, s: 0, l: 0 }).l
    expect(l).toBeLessThan(prev)
    prev = l
  }
})

it('沙灘不吃覆蓋率', () => {
  // 樹長不到沙灘上，所以那一段的顏色不得被覆蓋率動到
  expect(shade(5, 1, c).getHex()).toBe(shade(5, 0, c).getHex())
})
```

- [ ] **步驟 7：跑，確認紅（簽名不合）**

- [ ] **步驟 8：實作**

`island.ts`：

```ts
/**
 * 樹冠的平均色。針葉與灌木按樹冠面積加權 —— `CONE_CROWN_R²` 對
 * `ISLAND_BUSH_RATIO × BUSH_R²`，也就是 66% 對 34%。
 *
 * 【為什麼地要先帶上林相】6 km 外植被整片不畫，而地色比樹冠亮很多 ——
 * 飛進圈時整座島同時變暗變花。地先按實際被遮住的面積比調暗，樹進圈就
 * 只是加上質感。
 */
const CANOPY = new Color(0x30452e)

export function shade(h: number, cover: number, out: Color): Color {
  if (h < GRASS_MIN_HEIGHT) return out.copy(SAND)
  return out.copy(GRASS).lerp(CANOPY, Math.min(1, Math.max(0, cover)))
}
```

`buildIsland` 收 `coverAt`，逐頂點 `shade(h, coverAt(x, z), scratch)`。
`createIslands(field, islands, coverAt = () => 0)`。

`terrain.ts`：`createIslands(field, islands, islandCanopyCover(field, islands))`。

`isGrass` 不變（覆蓋率是顏色的事，不是植被放置的事）。

- [ ] **步驟 9：跑全套件、`tsc`**

```
node node_modules/vitest/vitest.mjs run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"
node node_modules/typescript/bin/tsc --noEmit    # 應為 23 行基線
```

- [ ] **步驟 10：變異驗證**

`cp src/render/island.ts /tmp/isl.bak`，把 `lerp` 那一行改成
`return out.copy(GRASS)` → 步驟 6 的兩條必紅。還原。

- [ ] **步驟 11：畫面驗收**

重拍 `island-dist.e2e.ts` 的 6,500 m 那一張，與改動前並排 —— 島應該已經是
林相的顏色。

- [ ] **步驟 12：提交**

```bash
git add src/render/floraShapes.ts src/render/flora.ts src/render/island.ts \
        src/render/terrain.ts test/unit/flora-island.test.ts \
        test/unit/island-shade.test.ts test/tools/canopy-cover.probe.ts
git commit -F /tmp/msg1.txt
```

---

## 任務 2：外圈抖開

**檔案**
- 改：`src/render/vegetation.ts`（`lodFor` 收外圈半徑、`relevel` 逐格算）
- 測：`test/unit/vegetation.test.ts`

**介面**
- 消費：任務 1 無。
- 產出：`lodFor(dist: number, prev: number, outer: number): number`

- [ ] **步驟 1：寫失敗測試**

```ts
/**
 * 【為什麼要抖】`FLORA_RADIUS` 是一個精確的圓，掃過地面時整排樹一起出現。
 * 逐格把有效半徑往內抖 0～20%，那一環就變成一條毛毛的帶。
 */
it('外圈是一條帶不是一個圓', () => {
  const v = createVegetation([SIX], FLAT)
  v.update(0, 0)
  v.settle(true)
  // 收集所有「還在畫」的格子離鏡頭的距離
  const d = drawnTileDistances(v)          // 測試輔助：由 v.debugTiles() 取
  const maxD = Math.max(...d)
  const minMissing = smallestMissingDistance(v)
  // 帶寬至少是半徑的一成
  expect(maxD - minMissing).toBeGreaterThan(FLORA_RADIUS * 0.1)
})
```

`vegetation.ts` 要匯出一支只給測試用的 `debugTiles()`，回
`{ i, j, lod }[]`。**不要**回內部陣列本身。

- [ ] **步驟 2：跑，確認紅**

- [ ] **步驟 3：實作**

```ts
/**
 * 外圈的抖動幅度。逐格把有效半徑乘 `1 - JITTER × hash`。
 *
 * 【只往內不往外】往外會越過 tile 快取的維持半徑 —— 那一格根本沒生成，
 * 症狀是圈緣閃爍。往內只是少畫，恆安全。
 */
export const OUTER_JITTER = 0.2

function outerFor(i: number, j: number): number {
  return FLORA_RADIUS * (1 - OUTER_JITTER * (hash2(i, j ^ 0x6b1f) / 4294967296))
}
```

`lodFor(dist, prev, outer)`：把 `LOD_STEP[2]` 換成參數。
`relevel` 逐格傳 `outerFor(i, j)`。

**`hash2` 要由 `flora.ts` 匯出**（現在是私有的）。

- [ ] **步驟 4：跑，確認綠**

- [ ] **步驟 5：變異驗證**

`OUTER_JITTER = 0` → 步驟 1 必紅。

- [ ] **步驟 6：全套件、`tsc`、提交**

---

## 任務 3：tile 緩衝改成有東西才配

**檔案**
- 改：`src/render/vegetation.ts`
- 測：`test/unit/vegetation.test.ts`

- [ ] **步驟 1：寫失敗測試（兩條）**

```ts
/**
 * 【為什麼】群島 6 km 圈有 1,815 格，而只有 485 格真的長東西。預配的話
 * 八成的記憶體是空水格佔的位子，而半徑推遠時那個浪費是平方成長的。
 */
it('空格不佔緩衝', () => {
  const arch = createArchipelago()
  const v = createVegetation([createIslandFlora(arch.field, arch.islands)],
    (x, z) => arch.field.sample(x, z), { maxPerTile: ISLAND_MAX_PER_TILE })
  v.update(0, 0)
  v.settle(true)
  const s = v.stats
  console.log(JSON.stringify({ 格數: s.tiles, 配出去的緩衝: s.buffers.length }))
  expect(s.buffers.length).toBeLessThan(s.tiles * 0.5)
  expect(s.buffers.length).toBeGreaterThan(0)
})

/**
 * 【空格一定要繼續佔槽位】不佔的話每一幀都會重生一次那一格 —— 而群島
 * 的圈裡九成是空格。
 */
it('空格不會每幀重生', () => {
  const v = createVegetation([EMPTY], FLAT)
  v.update(0, 0)
  v.settle(true)
  const first = v.stats.generated
  for (let k = 0; k < 10; k++) v.update(0, 0)
  expect(v.stats.generated).toBe(first)
})
```

`stats` 要加一個 `generated`（累計呼叫過幾次 source）。

- [ ] **步驟 2：跑，確認紅**

- [ ] **步驟 3：實作**

```ts
const slotBuf: (FloraBuffer | null)[] = new Array<FloraBuffer | null>(tileCache).fill(null)
const freeBufs: FloraBuffer[] = []
const allBufs: Float32Array[] = []

function takeBuf(): FloraBuffer {
  const b = freeBufs.pop()
  if (b !== undefined) return b
  const n = createFloraBuffer(maxPerTile)
  allBufs.push(n.data)
  return n
}
```

`makeTile`：`const buf = takeBuf()` → 生成 → `buf.count === 0` 時
`freeBufs.push(buf)`、`slotBuf[slot] = null`，否則 `slotBuf[slot] = buf`。
`freeSlot`：`slotBuf[slot]` 非 null 就 push 回 `freeBufs` 並設 null。
`rebuild`：`const buf = slotBuf[s]; if (buf === null) continue`。

`takeSlot` 改成自由槽堆疊：

```ts
/** 空著的槽位。堆疊 —— 線性掃描在 7,600 槽時是每幀十二萬次迴圈 */
const freeSlots: number[] = []
for (let s = tileCache - 1; s >= 0; s--) freeSlots.push(s)
```

`stats.buffers` 指向 `allBufs`。

- [ ] **步驟 4：跑，確認綠**

- [ ] **步驟 5：改既有的「暖機後 update 不再配置」**

`vegetation.test.ts` 那一條先 snapshot `stats.buffers`，再要求 600 次移動後
**身分與長度完全相等**。懶配之後那個語意不成立：農地原點圈有 1,804 個非空格，
路徑上會升到 1,813 —— 圈是圓的，移動時同時涵蓋的格數本來就會變。

改成兩件事，兩件都要：

```ts
it('暖機後緩衝池只重用不增長', () => {
  const v = createVegetation([SIX], FLAT)
  // 【先把峰值跑出來】圈是圓的，移動時同時非空的格數會小幅上下 ——
  // 沒跑過峰值就 snapshot 的話，量到的是「還在爬」而不是「在漏」
  for (let k = 0; k < 60; k++) { v.update(k * 40, k * 40); v.settle() }
  const mark = v.stats.buffers.length
  const ids = [...v.stats.buffers]
  for (let k = 0; k < 600; k++) v.update(2400 + k * 40, 2400 + k * 40)
  v.settle()
  expect(v.stats.buffers.length).toBe(mark)
  // 【身分也要比】長度一樣但整批換掉的話，代表配了新的又丟了舊的
  expect(v.stats.buffers.slice(0, ids.length)).toEqual(ids)
})
```

這條的變異：`freeSlot` 忘了把緩衝還回 `freeBufs` → 池會一路長，長度必不等。

- [ ] **步驟 6：變異驗證**

把「空格仍然佔槽位」拿掉（`bySlot.set` 只在有東西時做）→ 「空格不會每幀重生」
必紅。把 `freeSlot` 的歸還拿掉 → 步驟 5 必紅。

- [ ] **步驟 7：全套件、`tsc`、提交**

---

## 任務 4：`fill` 改成距離排序的格環

**這是任務 5 的前提。** `fill(budget)` 現在**每生一格就重掃一次整個包圍方陣**
找最近的空格。6 km 是 49² = 2,401 個候選 × 每幀 16 格 = 3.8 萬次；12 km 是
97² = 9,409 × 每幀 61 格 = **每幀 57 萬次**。半徑推遠之前一定要先修掉。

**檔案**
- 改：`src/render/vegetation.ts`
- 測：`test/unit/vegetation.test.ts`

- [ ] **步驟 1：寫失敗測試**

```ts
/**
 * 【為什麼要量掃描次數而不是時間】時間在 CI 上不穩。`fill` 的成本是
 * 「看了幾個候選格」，那是決定性的 —— 直接數。
 */
it('補格的候選掃描是每幀一趟，不是每格一趟', () => {
  const v = createVegetation([SIX], FLAT)
  v.update(0, 0)          // 冷啟動那一幀補滿 TILES_PER_FRAME 格
  const s = v.stats
  console.log(JSON.stringify({ 生了: s.tiles, 看過的候選: s.scanned }))
  expect(s.tiles).toBeGreaterThan(8)
  // 一趟的上限是圈內格數加一點餘裕；每格一趟的話是它的 TILES_PER_FRAME 倍
  expect(s.scanned).toBeLessThan(3000)
})
```

`stats` 要加 `scanned`（累計看過幾個候選格）。

- [ ] **步驟 2：跑，確認紅**

現況是 16 × 2,401 ≈ 38,000，遠大於 3,000。

- [ ] **步驟 3：實作**

建構時算一次「由近到遠的格偏移表」：

```ts
/**
 * 由近到遠的格偏移。**建構時算一次。**
 *
 * 【為什麼要有它】上一版 `fill` 每生一格就重掃整個包圍方陣挑最近的空格 ——
 * 12 km、每幀 61 格是每幀 57 萬次 `hypot`。改成照這張表由近往外走，每幀
 * 只掃一趟。
 *
 * 【半徑多留一格】表只是候選的順序，真正的圈由 `inRange` 決定；多留一格
 * 讓鏡頭落在格內任何位置時都不會漏掉邊緣那一環。
 */
const ringDI: Int16Array
const ringDJ: Int16Array
```

`fill`：

```ts
function fill(budget: number): number {
  const ci = Math.floor(centerX / TILE_SIZE)
  const cj = Math.floor(centerZ / TILE_SIZE)
  let made = 0
  for (let k = 0; k < ringDI.length && made < budget; k++) {
    const i = ci + ringDI[k]!
    const j = cj + ringDJ[k]!
    stats.scanned++
    if (!inRange(i, j)) continue
    if (bySlot.has(keyOf(i, j))) continue
    makeTile(i, j)
    made++
  }
  return made
}
```

**順序的近似是可接受的**：偏移表是相對於**格中心**排序的，而鏡頭可以落在格內
任何位置，所以順序最多差半格。那只影響「先生哪一格」，不影響最後生了哪些格。

- [ ] **步驟 4：跑，確認綠**

- [ ] **步驟 5：確認補格的集合沒有變**

```ts
it('換成格環之後，補出來的格子集合與半徑一致', () => {
  const v = createVegetation([SIX], FLAT)
  v.update(0, 0)
  v.settle(true)
  for (const t of v.debugTiles()) {
    const cx = t.i * TILE_SIZE + TILE_SIZE / 2
    const cz = t.j * TILE_SIZE + TILE_SIZE / 2
    expect(Math.hypot(cx, cz)).toBeLessThanOrEqual(FLORA_RADIUS)
  }
})
```

- [ ] **步驟 6：全套件、`tsc`、提交**

---

## 任務 5：群島的半徑 6 → 12 km

**檔案**
- 改：`src/render/vegetation.ts`（簽名改 options、逐圖的半徑／快取／每幀格數）
- 改：`src/render/terrain.ts`
- 測：`test/unit/vegetation.test.ts`
- 工具：`test/tools/island-peak.probe.ts`（改吃新簽名）

**介面**
- 產出：`createVegetation(sources, heightAt, opts?: VegetationOptions)`
- 產出：`interface VegetationOptions { capacity?, maxPerTile?, radius?, tileCache?, tilesPerFrame? }`
- 產出：`ISLAND_RADIUS`、`ISLAND_TILE_CACHE`、`ISLAND_TILES_PER_FRAME`

- [ ] **步驟 1：先把簽名改成 options，不改行為**

所有呼叫點與測試改成 `{ capacity: SENTINEL, maxPerTile: ISLAND_MAX_PER_TILE }`。
跑全套件確認全綠 —— 這一步是純機械改寫。

- [ ] **步驟 2：把三個常數改成逐實例**

`FLORA_RADIUS` / `TILE_CACHE` / `TILES_PER_FRAME` 仍然匯出（農地的預設值），
但引擎內部一律讀 `opts` 解出來的區域變數。

- [ ] **步驟 3：量群島 12 km 的冷啟動**

寫 `test/tools/island-coldstart.probe.ts`：由靜止開始，數要幾次 `update`
才補完整圈，乘上每格的實測成本。由它反推 `ISLAND_TILES_PER_FRAME`，
目標是**兩秒以內補完**（120 幀 × 61 格 = 7,320 > 7,248；60 格要 121 幀）。

- [ ] **步驟 4：重掃容量**

`node node_modules/vite-node/vite-node.mjs test/tools/island-peak.probe.ts`
（半徑改成 12 km）。餘裕維持兩倍（專案負責人裁定）。

- [ ] **步驟 5：把掃描的測試航線也改成 12 km，確認紅**

沿用 6 km 的容量會讓「容量 ≥ 峰值 × 1.35」那一條紅 —— 那就是這一步要的紅。

- [ ] **步驟 6：填新容量，確認綠**

- [ ] **步驟 7：全套件、`tsc`**

- [ ] **步驟 8：幀時間與冷啟動的實測**

群島・甲板・開 vsync、植被開關對照、三輪取中位數。另外量「開場到整圈補完」
的秒數。

- [ ] **步驟 9：提交**

---

## 任務 6：遠處三個池改成 `gl.POINTS`

**檔案**
- 建：`src/render/lighting.ts`（三盞燈的唯一定義）
- 改：`src/render/scene.ts`（改用 `createLights`）
- 改：`src/render/floraShapes.ts`（匯出逐池的點邊長與三個樹冠色）
- 改：`src/render/vegetation.ts`（池的型別分岔、寫入路徑分岔、點材質）
- 改：`test/e2e/fixtures/card-probe.ts`（改用 `createLights`）
- 測：`test/unit/flora-shapes.test.ts`、`test/unit/vegetation.test.ts`、
  `test/e2e/flora-card.e2e.ts`

**介面**
- 產出：`CARD_POINT_SIZE: Record<'broadCard' | 'coneCard' | 'bushCard', number>`

- [ ] **步驟 1：寫「面積相等」的失敗測試**

```ts
/**
 * 【為什麼是面積不是寬度】點是實心方塊、公告板是菱形或三角形。同寬的話
 * 方塊的面積是兩倍，3 km 那條門檻上林相會突然變厚 —— 而那正是這一版要
 * 消滅的感受。
 */
it('點的面積等於它取代的公告板', () => {
  for (const name of CARD_POOLS) {
    const geo = geometries[name]!
    const area = triangleAreaOf(geo)       // 逐三角形求和，投影到 xy 平面
    const s = CARD_POINT_SIZE[name]!
    expect(s * s).toBeCloseTo(area, 1)
  }
})
```

- [ ] **步驟 2：跑，確認紅**

- [ ] **步驟 3：算出三個邊長並填進 `floraShapes.ts`**

```
   broadCard  菱形 halfW 10、高 20   面積 200 m²   邊長 14.142
   coneCard   三角 底 14、高 22      面積 154 m²   邊長 12.410
   bushCard   菱形 halfW 6、高 8     面積  48 m²   邊長  6.928
```

不要寫死數字 —— 由同一組樹冠常數算出來，否則改樹冠尺寸時會漂。

- [ ] **步驟 4：跑，確認綠**

- [ ] **步驟 5：把三個池換成 `Points`**

```ts
function createPointMaterial(): PointsMaterial {
  // 【size 一定要留著且設成 1】DPR 藏在它裡面 ——
  // `WebGLMaterials` 寫的是 `uniforms.size.value = material.size * pixelRatio`，
  // 而 `uniforms.scale.value = height * 0.5` 用的是 **CSS 高**。把 `size`
  // 整個換掉的話，DPR = 2 的螢幕上點只有一半大
  const m = new PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: 1 })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aSize;\n' + sh.vertexShader
      .replace('gl_PointSize = size;', 'gl_PointSize = aSize * projectionMatrix[1][1] * size;')
  }
  m.customProgramCacheKey = () => 'flora-point'
  return m
}
```

四個因子各自的來源：

```
   aSize                     世界長度，m（逐株屬性）
   projectionMatrix[1][1]    1 / tan(fovY/2)
   size                      1 × devicePixelRatio      ← three 自己乘上去的
   scale / -mvPosition.z     (CSS 高 / 2) / 距離        ← sizeAttenuation 區塊
```

相乘就是世界長度 `aSize` 在**緩衝區像素**上的大小。不必自己維護視埠 uniform，
改視窗、改 DPR、改視角都自動跟上。

【WebGL2 下 `attribute` 沒問題】three 會先加 `#define attribute in`。

屬性：`position`（3）、`color`（3）、`aSize`（1），各兩份輪流換。
`geometry.setDrawRange(0, count)`。`frustumCulled = false`。

- [ ] **步驟 6：把光照抽成一個模組，再把係數烘進顏色**

**現況接不起來**：`sun` 是 `scene.ts` 的區域變數，`SceneContext` 沒有回傳它，
而 `createVegetation` 的呼叫點在 `terrain.ts`、`createTerrain` 只收 `kind`。

不要把係數一路串過 `main → terrain → vegetation`。改成**把光照的定義抽出來**，
新檔 `src/render/lighting.ts`：

```ts
/**
 * 場上的三盞燈。**`scene.ts` 與量測用的 e2e fixture 共用同一份。**
 *
 * 【為什麼要獨立成一個模組】點粒子那三個池吃不到光照，亮度是烘進頂點色的，
 * 而那個係數只有在「與真正的光照下的樹冠比對」時才校得準。fixture 若自己
 * 另外配一組燈，校出來的係數在遊戲裡就是錯的。
 */
export function createLights(): Object3D[] {
  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  return [
    sun,
    new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9),
    new AmbientLight(0xffffff, 0.15),
  ]
}
```

`scene.ts` 改成 `for (const l of createLights()) scene.add(l)`。
`test/e2e/fixtures/card-probe.ts` 也改用它。

係數本身是一個常數 `POINT_LIGHT`（逐通道的 RGB 乘數），**由步驟 7 的 e2e 量出來
再填**，並由同一條 e2e 守著。

- [ ] **步驟 6b：`floraShapes.ts` 的樹冠色不再私有**

點池要在 CPU 端算「樹冠色 × `POINT_LIGHT` × 逐株色差」，所以
`CONIFER` / `BROAD_LEAF` / `BUSH_LEAF` 要匯出。

- [ ] **步驟 7：e2e —— 量實際像素與亮度**

`flora-card.e2e.ts` 增三條：

- **絕對像素數**：`broadCard` 的點邊長 14.14 m，在 fixture 的投影下算出預期
  像素數，實測差不得超過 1 px。**只斷言 3 km 與 6 km 的比值不夠** —— 拿掉
  `projectionMatrix[1][1]` 或拿掉 `* size` 之後比值仍然是 2:1，錯的是絕對值。
- **俯角 −85°**（幾乎正上方）時點仍然看得到。公告板只繞 Y 轉，那個角度下
  是側面朝上、幾乎消失 —— 這一條同時是「點比公告板好」的證據。
- **亮度接得上**：在 3 km 那條門檻的兩側各量一次平均 RGB，點與它取代的中級
  樹冠差不得超過 8%。`POINT_LIGHT` 就是由這一條解出來的。

fixture 要改用 `createLights()`，否則量到的亮度與遊戲裡不同。

- [ ] **步驟 8：變異驗證**

拿掉 `* projectionMatrix[1][1]` → 像素比那一條仍然過（比例不變），但**絕對
值**會錯 —— 所以那一條要同時斷言絕對像素數，不能只斷言比值。

- [ ] **步驟 9：全套件、`tsc`、幀時間**

- [ ] **步驟 10：畫面驗收與提交**

重拍距離序列，相鄰兩張之間不得看出「植被整批出現」。

---

## 自我檢查

- **SPEC 覆蓋**：五節對應任務 1、2、3、5、6；任務 4 是審查加出來的前提，驗收表的八條各落在對應任務的步驟裡。
- **佔位字**：無 TBD、無「適當處理錯誤」、每一個程式碼步驟都有實際內容。
- **型別一致**：`islandCanopyCover` 在任務 1 產出、任務 1 步驟 8 消費；
  `lodFor` 的第三參數在任務 2 產出、任務 5 沿用；`VegetationOptions` 在任務 5
  產出、任務 6 的 `createVegetation` 沿用同一個物件。
