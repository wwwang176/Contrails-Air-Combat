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

```ts
it('覆蓋率與實際的樹冠面積對得起來', () => {
  const coverAt = islandCanopyCover(arch.field, arch.islands)
  const rows = onBig()
  // 取樣點按覆蓋率求平均，與實際樹冠面積除以可用面積比
  const r = big.outerRadius
  let sum = 0
  let n = 0
  const STEP = 20
  for (let z = big.cz - r; z < big.cz + r; z += STEP) {
    for (let x = big.cx - r; x < big.cx + r; x += STEP) {
      if (!isGrass(height(x, z))) continue
      sum += coverAt(x, z)
      n++
    }
  }
  const predicted = sum / n
  let crown = 0
  for (const row of rows) {
    const rad = (row.kind === FloraKind.Bush ? BUSH_R : CONE_CROWN_R) * row.scale
    crown += Math.PI * rad * rad
  }
  const actual = crown / (n * STEP * STEP)
  console.log(JSON.stringify({ 預測: predicted.toFixed(3), 實測: actual.toFixed(3) }))
  expect(predicted).toBeGreaterThan(actual * 0.85)
  expect(predicted).toBeLessThan(actual * 1.15)
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
    const a = islandAccept(field, peak, x, z, h)
    return Math.min(1, (a * (CONE_AREA + BUSH_AREA)) / (ISLAND_GRID * ISLAND_GRID))
  }
}
```

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

- [ ] **步驟 5：變異驗證**

把「空格仍然佔槽位」拿掉（`bySlot.set` 只在有東西時做）→ 第二條必紅。

- [ ] **步驟 6：全套件、`tsc`、提交**

---

## 任務 4：群島的半徑 6 → 12 km

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
目標是**兩秒以內補完**。

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

## 任務 5：遠處三個池改成 `gl.POINTS`

**檔案**
- 改：`src/render/floraShapes.ts`（匯出逐池的點邊長）
- 改：`src/render/vegetation.ts`（池的型別分岔、寫入路徑分岔、點材質）
- 改：`src/main.ts`（把太陽的漫射係數傳進去）
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
  const m = new PointsMaterial({ vertexColors: true, sizeAttenuation: true })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aSize;\n' + sh.vertexShader
      .replace('gl_PointSize = size;', 'gl_PointSize = aSize * projectionMatrix[1][1];')
  }
  m.customProgramCacheKey = () => 'flora-point'
  return m
}
```

`projectionMatrix[1][1]` 是 `1 / tan(fovY/2)`；three 的 `sizeAttenuation`
區塊接著乘 `scale / -mvPosition.z`（`scale` 是它自己維護的視埠高一半）。
兩者相乘就是「世界長度 `aSize` 的像素數」，不必自己維護視埠 uniform。

屬性：`position`（3）、`color`（3）、`aSize`（1），各兩份輪流換。
`geometry.setDrawRange(0, count)`。`frustumCulled = false`。

- [ ] **步驟 6：把太陽的漫射烘進顏色**

`main.ts` 已有的平行光方向與強度，開場算一次係數傳進 `createVegetation`。
點的逐株顏色乘它。**只乘點那三個池** —— 其餘的池仍然吃真的光照。

- [ ] **步驟 7：e2e —— 量實際像素**

`flora-card.e2e.ts` 增兩條：
- 同一株點在 3 km 與 6 km 的像素寬度比應為 2:1（±1 px）。
- 俯角 −85°（幾乎正上方）時點仍然看得到，而公告板會消失。

- [ ] **步驟 8：變異驗證**

拿掉 `* projectionMatrix[1][1]` → 像素比那一條仍然過（比例不變），但**絕對
值**會錯 —— 所以那一條要同時斷言絕對像素數，不能只斷言比值。

- [ ] **步驟 9：全套件、`tsc`、幀時間**

- [ ] **步驟 10：畫面驗收與提交**

重拍距離序列，相鄰兩張之間不得看出「植被整批出現」。

---

## 自我檢查

- **SPEC 覆蓋**：五節各對應一個任務，驗收表的八條各落在對應任務的步驟裡。
- **佔位字**：無 TBD、無「適當處理錯誤」、每一個程式碼步驟都有實際內容。
- **型別一致**：`islandCanopyCover` 在任務 1 產出、任務 1 步驟 8 消費；
  `lodFor` 的第三參數在任務 2 產出、任務 4 沿用；`VegetationOptions` 在任務 4
  產出、任務 5 的 `createVegetation` 沿用同一個物件多一個 `sunDiffuse` 欄位。
