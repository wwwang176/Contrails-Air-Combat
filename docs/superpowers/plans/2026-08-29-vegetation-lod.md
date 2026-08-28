# 植被與地面聚落 實作計畫

> **For agentic workers:** 本計畫由 Claude 於同一個 session 內 inline 執行。
> 每個任務結束都要跑該任務指定的測試指令、`tsc`，然後提交。

**Goal:** 農地與群島兩張圖長出樹、樹籬灌木、樹林、村落與教堂尖塔，帶四段 LOD；
田裡加上犁溝條紋。

**Architecture:** 一套 tile ＋ LOD 引擎（`render/vegetation.ts`），兩個放置來源
（`render/flora.ts`）。所有實例由「全域決定性生成器 ＋ tile 過濾」產生，
所以同一株的座標與「哪一格在生成」無關。

**Tech Stack:** TypeScript、three r0.180、vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-29-vegetation-lod-design.md`

## Global Constraints

- **不得 `Math.random`。** 一切由整數雜湊決定。
- **不得 `git add -A`** —— `bash.exe.stackdump` 是被追蹤的檔案且不斷變動。
- **`src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。**
  植被全部住在 `src/render/`。
- **沒有 `@types/node`。** 測試與 e2e 都不得用 `process` / `fs`。
- **沒有任何貼圖。** 遠處用更少面的立體，不用廣告板。
- 註解寫現狀，不寫沿革。
- 指令：
  - 單元測試 `node node_modules/vitest/vitest.mjs run <path>`
  - 型別 `node node_modules/typescript/bin/tsc --noEmit`（基線是 4 個既有錯誤）
  - GLSL 編譯 `node node_modules/vite-node/vite-node.mjs test/e2e/glsl-compile.e2e.ts`
- **每一條新測試都要先驗紅**，或以變異證明它承重。
- 提交訊息走檔案：`git commit -F <scratchpad>/msg.txt`，含兩行 trailer。

---

## 全域的資料形狀（Task 4 建立，之後每個任務都依賴）

```ts
/** 一株植被／一棟建築。stride 6 的 Float32Array 加一條 Uint8Array 的種類 */
export const FLORA_STRIDE = 6
/** 欄位順序：x, y, z, rotY, scale, tint */

export const enum FloraKind {
  BroadTree = 0,   // 闊葉，球冠
  ConeTree = 1,    // 針葉，錐冠
  Bush = 2,        // 樹籬的灌木
  House = 3,
  Barn = 4,
  Church = 5,
}

/** 一格 tile 的產出。呼叫端預配，放置函數就地寫入 */
export interface FloraBuffer {
  readonly data: Float32Array   // 長度 = capacity * FLORA_STRIDE
  readonly kind: Uint8Array     // 長度 = capacity
  readonly capacity: number
  /** 寫進去幾筆。放置函數負責更新 */
  count: number
  /** 因為容量不足被丟掉幾筆。**不得靜默截斷** */
  dropped: number
}

/** 放置來源。tile 的邊長由引擎決定，來源只吃邊界 */
export type FloraSource = (
  x0: number, z0: number, x1: number, z1: number,
  heightAt: (x: number, z: number) => number,
  out: FloraBuffer,
) => void
```

**鐵律（每個來源都要守，§9 有對應的測試）：** 一株植被的座標只由它自己的
全域索引決定；tile 的邊界只用來**過濾**（`x0 ≤ x < x1 && z0 ≤ z < z1`），
不得進入座標的計算。違反的話相鄰兩格的接縫上會重複或缺漏。

---

## Task 1: `fields.ts` —— 種子匯出與樹林地色

**Files:**
- Modify: `src/render/fields.ts`
- Test: `test/unit/fields.test.ts`（既有 12 條，加 6 條）

**Interfaces:**
- Produces:
  - `export function regionSeed(i: number, j: number, out: { x: number; z: number }): number`
    —— 寫入第 `(i, j)` 格的種子座標，回傳那一格的雜湊。
  - `export const WOOD_CHANCE = 0.05`
  - `export function isWoodField(id: number): boolean`
  - `WOOD` 顏色常數（私有）＋ `fieldSurfaceColor` 對樹林田回它
  - `FIELD_GLSL` 同步加上 `isWoodField` 與 `WOOD`

- [ ] **Step 1: 先驗紅 —— 三條新測試**

```ts
it('regionSeed 與 regionAt 用的是同一顆種子', () => {
  // regionAt 在種子上取樣時，r1 必須是 0
  const p = { x: 0, z: 0 }
  for (const [i, j] of [[0, 0], [3, -2], [-5, 7]] as const) {
    regionSeed(i, j, p)
    regionAt(p.x, p.z, REG)
    expect(REG.r1).toBeLessThan(1e-6)
  }
})

it('樹林田佔 5% 上下', () => {
  let wood = 0
  const N = 4000
  for (let k = 0; k < N; k++) {
    regionAt(k * 37.1, k * 91.7, REG)
    fieldAt(k * 37.1, k * 91.7, REG, FLD)
    if (isWoodField(FLD.id)) wood++
  }
  // 取樣是逐點的，一塊田會被抽中好幾次 —— 只要求量級對
  expect(wood / N).toBeGreaterThan(0.02)
  expect(wood / N).toBeLessThan(0.10)
})

it('樹林田的地色比任何一塊非樹林的田都暗', () => {
  const wood = new Color()
  const crop = new Color()
  let gotWood = false
  let maxCrop = 0
  for (let k = 0; k < 20000; k++) {
    const x = k * 13.7
    const z = k * 29.3
    regionAt(x, z, REG)
    if (REG.r2 - REG.r1 < TRACK_WIDTH) continue
    fieldAt(x, z, REG, FLD)
    if (FLD.hedged && FLD.edge < HEDGE_WIDTH / 2) continue
    fieldSurfaceColor(x, z, crop)
    if (isWoodField(FLD.id)) { wood.copy(crop); gotWood = true; continue }
    maxCrop = Math.max(maxCrop, crop.r + crop.g + crop.b)
  }
  expect(gotWood).toBe(true)
  // 【不比樹籬】樹籬比樹林還暗，那是對的 —— 這一條比的是田
  expect(wood.r + wood.g + wood.b).toBeLessThan(maxCrop)
})
```

- [ ] **Step 2: 跑，確認三條都紅**

`node node_modules/vitest/vitest.mjs run test/unit/fields.test.ts`
預期：`regionSeed is not a function` ×2、樹林色那條失敗。

- [ ] **Step 3: 實作**

把 `regionAt` 迴圈裡的種子計算抽成 `regionSeed`：

```ts
/**
 * 第 `(i, j)` 格區塊的種子座標，寫進 `out`；回傳那一格的雜湊。
 *
 * 【為什麼要匯出】村落的站址是兩顆種子的中點（`flora.ts`）。在那邊重抄
 * 一次公式就是兩個真相 —— 一邊改了，村子會離開路面而且沒有人會發現。
 */
export function regionSeed(i: number, j: number, out: { x: number; z: number }): number {
  const h = hash2(i, j)
  out.x = (i + 0.5 + ((h & 0xffff) / 65536 - 0.5) * 0.76) * REGION_SPACING
  out.z = (j + 0.5 + ((h >>> 16) / 65536 - 0.5) * 0.76) * REGION_SPACING
  return h
}
```

`regionAt` 改成呼叫它（用一個模組層的 scratch 物件，**不配置**）。

樹林：

```ts
/** 一塊田整片變成樹林的機率 */
export const WOOD_CHANCE = 0.05

/** 樹林。比色盤最深的一階再暗，而且不在漸層上 */
const WOOD = 0x2f3a28

/**
 * 這塊田是不是樹林。**放置與地色共用這一支** —— `flora.ts` 用它決定
 * 要不要在這塊田裡填樹，`fieldSurfaceColor` 用它決定地色。兩邊分家的話，
 * 會出現「深綠的地上沒有樹」或「樹長在麥田裡」。
 */
export function isWoodField(id: number): boolean {
  return ((id >>> 24) & 0xff) / 256 < WOOD_CHANCE
}
```

**注意位元的挑選**：`id` 的低 8 位已經被 `PLOUGH_CHANCE` 用掉、8–15 位被
色調用掉、16–23 位被明度抖動用掉。樹林用 24–31 位，互不相關。

`fieldSurfaceColor` 的順序：凹路 → 樹籬 → **樹林** → 犁田 → 作物。

`FIELD_GLSL` 同步：

```glsl
bool isWoodField(uint id) { return float((id >> 24u) & 0xffu) / 256.0 < 0.05; }
```

（常數由 TS 的樣板字串內插，維持「數字只有一個來源」。）

- [ ] **Step 4: 跑測試 —— 18 條全綠**
- [ ] **Step 5: GLSL 真的編得過**

`node node_modules/vite-node/vite-node.mjs test/e2e/glsl-compile.e2e.ts`

**這一步不得跳過。** 上一輪 `half` 是保留字那次，全套件 3,152 條全綠而遊戲
開起來是黑畫面。

- [ ] **Step 6: `tsc` 與提交**

---

## Task 2: 犁溝與作物條紋（GLSL 專屬）

**Files:**
- Modify: `src/render/fields.ts`
- Test: `test/unit/fields.test.ts`

**Interfaces:** 無新的匯出。`FIELD_GLSL` 內容改變。

- [ ] **Step 1: 先驗紅**

```ts
it('條紋只存在於 GLSL，CPU 那一份沒有', () => {
  expect(FIELD_GLSL).toContain('fwidth')
  expect(FIELD_GLSL).toContain('stripe')
  // CPU 那一份不得有條紋 —— 它沒有導數，做不了抗鋸齒
  const src = fieldsSource()          // 由測試讀檔（見 Step 3）
  expect(src).not.toMatch(/function\s+stripe/)
})

it('金本位：核心那幾行兩邊仍然逐行對得上', () => {
  // 既有的金本位測試，比對範圍縮到 CORE 標記之間
})
```

- [ ] **Step 2: 跑，確認紅**
- [ ] **Step 3: 實作**

在 `FIELD_GLSL` 裡加，並且**只加在 GLSL**：

```glsl
// 【條紋只在 GPU 上做】抗鋸齒需要片段導數，CPU 沒有對應物。取樣不足時
// 自動淡掉 —— 沒有這一步的話 1 km 外整片田會出現摩爾紋，比沒有條紋更糟。
float stripe(vec2 q, float period, float amp) {
  float u = q.y / period;
  float w = fwidth(u);
  float fade = 1.0 - smoothstep(0.15, 0.5, w);
  return 1.0 + amp * fade * (fract(u) < 0.5 ? 1.0 : -1.0);
}
```

`fieldColorAt` 的最後一步乘上它；犁田的幅度加倍（0.08 對 0.04）。
`q` 是區塊座標系裡的座標 —— 條紋因此順著田自己的長軸。

**金本位測試的範圍**：在 `fields.ts` 與 `FIELD_GLSL` 兩邊各放一對
`// CORE-BEGIN` / `// CORE-END` 標記，金本位只比對標記之間。標記之外
新增的東西由上面那條「條紋只存在於 GLSL」守著，例外因此不會悄悄擴大。

- [ ] **Step 4: 測試綠**
- [ ] **Step 5: GLSL 編譯 e2e** —— `fwidth` 在 GLSL ES 3.00 是內建，但
      `fract(u) < 0.5 ? 1.0 : -1.0` 這種寫法要確認編得過
- [ ] **Step 6: `tsc` 與提交**

---

## Task 3: `island.ts` 匯出草帶的判準

**Files:**
- Modify: `src/render/island.ts`
- Test: `test/unit/island-shade.test.ts`（新檔，4 條）

**Interfaces:**
- Produces: `export function isGrass(h: number, peak: number): boolean`
  —— 以及 `SHORE_BAND` / `ROCK_FRACTION` 兩個常數。

**【為什麼要有 `isGrass` 這支，而不是讓 `flora.ts` 直接讀兩個常數】**
`archipelago.ts` 也有一個 `SHORE_BAND`，值是 **200**（烘岸用），而
`island.ts` 這個是 **12**（顏色分帶）。同名不同義，拿錯完全不報錯 ——
症狀是樹全長在山頂。給一支謂語，放置那邊根本看不到常數。

- [ ] **Step 1: 先驗紅**

```ts
it('isGrass 與 shade 對同一個高度給同一個答案', () => {
  const c = new Color()
  for (const peak of [100, 350, 900]) {
    for (let h = 0; h < peak; h += peak / 200) {
      const grass = isGrass(h, peak)
      shadeForTest(h, peak, c)
      expect(grass).toBe(c.getHex() === GRASS_HEX)
    }
  }
})
```

（`shade` 目前是私有的。這一條需要它 —— 匯出 `shade` 或匯出 `GRASS` 的
hex 並由 `isGrass` 的定義反推。**選前者**：匯出 `shade`，因為「樹只長在
綠色的地方」這條恆等式的價值就在於它比對的是畫面上真的那一支函數。）

- [ ] **Step 2 – 6:** 同樣的節奏（驗紅 → 實作 → 綠 → `tsc` → 提交）。
      實作只是把 `SHORE_BAND` / `ROCK_FRACTION` / `shade` 加上 `export`，
      並新增 `isGrass(h, peak) { return h >= SHORE_BAND && h < peak * ROCK_FRACTION }`。

---

## Task 4: `flora.ts` 的骨架與農地的樹籬樹

**Files:**
- Create: `src/render/flora.ts`
- Test: `test/unit/flora-hedge.test.ts`（新檔，10 條）

**Interfaces:**
- Consumes: `fields.ts` 的 `regionAt` / `fieldAt` / `edgeAt` / `HEDGE_WIDTH`
- Produces: `FLORA_STRIDE`、`FloraKind`、`FloraBuffer`、`createFloraBuffer(capacity)`、
  `pushFlora(out, x, y, z, rot, scale, tint, kind)`、`farmHedgeFlora: FloraSource`

**演算法（走線，不是密集取樣）**

```
給 tile 的四角，用 tile 中心的 region 參數轉進區塊座標系，取 AABB：
  橫線：r ∈ [rMin, rMax]，線在 qz = edgeAt(r, cellH, 1)，
        沿 qx 走，索引 m = floor(qxMin / SPACING) … ceil(qxMax / SPACING)
  縱線：每一條橫向帶 r，colSalt = r * 2 + 1，
        k ∈ [kMin, kMax]，線在 qx = edgeAt(k, cellW, colSalt)，
        qz 限制在 [edgeAt(r, ...), edgeAt(r + 1, ...)]，沿 qz 走，索引 m 同理
每個候選：
  t = (m + 0.5 + jitter) * SPACING，側向再抖 ±3 m
  轉回世界座標 (x, z)：x = qx·cos a − qz·sin a，z = qx·sin a + qz·cos a
  **過濾**：不在 [x0, x1) × [z0, z1) 就丟掉
  **驗證**：regionAt(x, z) 的 id 要與 tile 中心同一區，且 fieldAt 回
            hedged 且 edge < HEDGE_WIDTH / 2
  樹種：由那條線的雜湊決定（hash2(k, colSalt) 或 hash2(r, 0x9e37)），
        **不是逐棵** —— 整排同種才讀得出防風林
```

- [ ] **Step 1: 先驗紅 —— 六條**

```ts
const H = (): number => 0            // 平地，高度恆為 0

it('決定性：同一格生兩次逐位元相同', () => {
  const a = createFloraBuffer(512)
  const b = createFloraBuffer(512)
  farmHedgeFlora(0, 0, 250, 250, H, a)
  farmHedgeFlora(0, 0, 250, 250, H, b)
  expect(a.count).toBe(b.count)
  expect(a.data.slice(0, a.count * FLORA_STRIDE))
    .toEqual(b.data.slice(0, b.count * FLORA_STRIDE))
})

it('每一棵都在樹籬帶上', () => {
  const buf = createFloraBuffer(512)
  let n = 0
  for (let tz = -1000; tz < 1000; tz += 250) {
    for (let tx = -1000; tx < 1000; tx += 250) {
      buf.count = 0
      farmHedgeFlora(tx, tz, tx + 250, tz + 250, H, buf)
      for (let i = 0; i < buf.count; i++) {
        const x = buf.data[i * FLORA_STRIDE]!
        const z = buf.data[i * FLORA_STRIDE + 2]!
        regionAt(x, z, REG)
        fieldAt(x, z, REG, FLD)
        expect(FLD.hedged).toBe(true)
        expect(FLD.edge).toBeLessThan(HEDGE_WIDTH / 2)
        n++
      }
    }
  }
  expect(n).toBeGreaterThan(400)      // 沒長樹的話上面整段是空操作
})

it('每一棵都落在自己那一格裡', () => { /* x0 ≤ x < x1、z0 ≤ z < z1 */ })

it('相鄰的格不會重複也不會漏', () => {
  // 3×3 格一起生，任兩棵的距離 > 0.5 m；
  // 且總數 ≈ 面積 × 473/km²（±35%）
})

it('同一條樹籬是同一種樹', () => {
  // 找出彼此相距 < 20 m 且共線的一串，斷言 kind 相同
})

it('密度落在實測的 473 棵/km² 附近', () => { /* ±30% */ })
```

- [ ] **Step 2: 跑，確認全紅（模組還不存在）**
- [ ] **Step 3: 實作 `flora.ts`**
- [ ] **Step 4: 六條全綠**
- [ ] **Step 5: 變異驗證** —— 把驗證那一步（`fieldAt` 的 `hedged` 檢查）
      註解掉，第二條必須變紅。改回來。
- [ ] **Step 6: `tsc` 與提交**

---

## Task 5: 樹林

**Files:**
- Modify: `src/render/flora.ts`
- Test: `test/unit/flora-wood.test.ts`（新檔，5 條）

**Interfaces:**
- Produces: `farmWoodFlora: FloraSource`

**演算法**：全域 16 m 網格，索引 `(gx, gz) = (floor(x / 16), floor(z / 16))`，
每格由 `hash2(gx, gz)` 抖動位置；接受條件是 `isWoodField(FLD.id)` 且
**不在樹籬帶上**（樹林田的邊界仍然是樹籬，不要疊兩層樹）。

- [ ] **Step 1: 先驗紅**

```ts
it('樹林的樹都在樹林田裡', () => { /* isWoodField(FLD.id) === true */ })
it('樹林的地色就是樹林色', () => {
  // 對每一棵，fieldSurfaceColor 回的 hex 等於 WOOD ——
  // 這一條把「放置」與「地色」釘在同一個判準上
})
it('樹林的樹不在樹籬帶上', () => { /* edge ≥ HEDGE_WIDTH / 2 */ })
it('決定性 ＋ 落在自己那一格裡', () => { /* 同 Task 4 */ })
it('一塊樹林田裡的密度接近 16 m 網格', () => { /* 每 km² 3,900 ± 30% */ })
```

- [ ] **Step 2 – 6:** 驗紅 → 實作 → 綠 → 變異（把 `isWoodField` 改成恆真，
      第一與第二條必須紅）→ `tsc` → 提交

---

## Task 6: 村落與教堂

**Files:**
- Modify: `src/render/flora.ts`
- Test: `test/unit/flora-village.test.ts`（新檔，8 條）

**Interfaces:**
- Produces: `villageSite(i, j, out): boolean`（站址，回傳「這一格有沒有村」）、
  `farmVillageFlora: FloraSource`

**站址**

```
1. h = regionSeed(i, j, A)
2. 由 h 挑一個軸向鄰格 (i', j')：((h >>> 5) & 3) → 四選一
3. regionSeed(i', j', B)
4. 站址 = A 與 B 的中點 —— 到兩顆種子等距，所以落在它們的邊界上
5. **驗證**：regionAt(站址) 的 r2 − r1 < TRACK_WIDTH。不通過就沒有村
   （第三顆種子更近的情形）
```

**建築**：站址周圍 60～140 m 內由雜湊放 6～14 棟，接受條件是
**離凹路中心 8～45 m**（`r2 − r1` 換算過去）。房子沿路排，不蓋在路上。
其中約三分之一是穀倉（比較長、比較高）。

**教堂**：站址的雜湊 < 0.45 時一座，放在站址偏移 25 m 處。

**tile 的責任**：一個 tile 要看它周圍 200 m 內的所有站址（區塊間距 3,200 m
遠大於 tile 的 250 m，所以最多檢查 2×2 個區塊格），生出那些村的建築，
**只留落在自己格裡的**。

- [ ] **Step 1: 先驗紅 —— 八條**

```ts
it('站址一定在路上', () => {
  let sites = 0
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
    if (!villageSite(i, j, P)) continue
    sites++
    regionAt(P.x, P.z, REG)
    expect(REG.r2 - REG.r1).toBeLessThan(TRACK_WIDTH)
  }
  expect(sites).toBeGreaterThan(20)   // 81 格裡至少兩成有村
})

it('有村的比例落在三到八成之間', () => { /* 驗證會刷掉一部分 */ })
it('房子不在路上', () => { /* 每棟離路中心 8–45 m */ })
it('每個村有 6–14 棟', () => {})
it('教堂最多一座，而且在站址附近 40 m 內', () => {})
it('決定性 ＋ 落在自己那一格裡', () => {})
it('跨格不重複：3×3 格一起生，任兩棟距離 > 3 m', () => {})
it('村的間距 ≈ 每 4–5 km 一個', () => {})
```

- [ ] **Step 2 – 6:** 同節奏。變異：把第 5 步的驗證拿掉，第一條必須紅。

---

## Task 7: 群島的來源

**Files:**
- Modify: `src/render/flora.ts`
- Test: `test/unit/flora-island.test.ts`（新檔，6 條）

**Interfaces:**
- Produces: `createIslandFlora(field, islands): FloraSource`

**演算法**：全域 50 m 網格（400 棵/km² 對應 50 m），索引抖動；早退：
tile 的中心到每座島的距離 > `outerRadius + 200` 就整格跳過。接受條件：
`isGrass(h, peak)`，其中 `peak` 取**最近那座島**的峰高。密度再乘
`cos(slope)`：`hash01 > cos(slope)` 就丟掉。

- [ ] **Step 1: 先驗紅**

```ts
it('島上的樹都長在綠色的地方', () => {
  // 對每一棵：h = field.sample(x, z)，找出最近的島，
  // isGrass(h, peak) === true，而且 shade(h, peak) 回 GRASS
})
it('沒有一棵樹在海裡', () => { /* h > 0 */ })
it('陡的地方比緩的地方稀疏', () => {
  // 把樹按坡度分兩堆，比每單位面積的棵數
})
it('決定性 ＋ 落在自己那一格裡 ＋ 跨格不重複', () => {})
it('全海的格子回 0 筆而且很快', () => {})
```

- [ ] **Step 2 – 6:** 同節奏。

---

## Task 8: 幾何

**Files:**
- Create: `src/render/floraShapes.ts`
- Test: `test/unit/flora-shapes.test.ts`（新檔，8 條）

**Interfaces:**
- Produces: `createFloraGeometries(): Record<PoolName, BufferGeometry>`、
  `disposeFloraGeometries(g)`

八個幾何（樹幹與樹冠合併成一個 geometry，用頂點色分）：

```
  broadL0   圓柱樹幹（6 邊、無蓋）＋ 球冠（八面體細分一次）    ~26 tri
  coneL0    圓柱樹幹 ＋ 7 邊錐                                  ~26 tri
  treeMid   5 邊錐，無樹幹                                       10 tri
  treeFar   四面角錐                                              4 tri
  bush      八面體                                                8 tri
  house     盒子 ＋ 人字屋頂                                      20 tri
  barn      同上，比較長比較高                                    20 tri
  church    塔身 ＋ 尖頂 ＋ 本堂                                  ~40 tri
```

- [ ] **Step 1: 先驗紅**

```ts
it('每個幾何的三角形數不超過預算', () => { /* 逐項比對上表 */ })
it('每個幾何的底面在 y = 0', () => {
  // 【為什麼】實例的 y 直接放地面高度。底面不在 0 的話整批浮空或陷地
  expect(box.min.y).toBeCloseTo(0, 3)
})
it('樹幹是棕色、樹冠是綠色', () => { /* 逐頂點色分兩群，比 hue */ })
it('房子的牆與屋頂顏色不同', () => {})
it('每個幾何都有法線', () => {})
it('球冠的頂點數與八面體細分一次相符', () => {})
it('高度符合設計（樹 12–18 m 的基準是 1.0 縮放）', () => {})
it('disposeFloraGeometries 之後每一個都被 dispose', () => {})
```

- [ ] **Step 2 – 6:** 同節奏。

---

## Task 9: 引擎（tile 快取、LOD、池）

**Files:**
- Create: `src/render/vegetation.ts`
- Test: `test/unit/vegetation.test.ts`（新檔，12 條）

**Interfaces:**
- Produces:
  ```ts
  export const TILE_SIZE = 250
  export const FLORA_RADIUS = 2000
  export const LOD_NEAR = 450       // L0 → L1
  export const LOD_MID = 1100       // L1 → L2
  export const LOD_FAR = 2000       // L2 → 不畫
  export const LOD_HYSTERESIS = 40
  export const BUSH_RANGE = 500
  export function lodFor(dist: number, prev: number): number
  export function createVegetation(sources, heightAt): {
    object: Object3D
    update(centerX: number, centerZ: number): void
    dispose(): void
    readonly counts: Readonly<Record<PoolName, number>>   // 測試用
  }
  ```

**行為**

- 每次 `update` 算出圈內的 tile 集合；不在集合裡的釋放回 free list。
- 每幀最多生 **4** 格。
- 生成佇列清空的那一幀重建池的矩陣（不是每幀）。
- 池的容量常數由 Step 5 的掃描定值，溢位丟棄並 `console.warn` 一次。

- [ ] **Step 1: 先驗紅 —— 十二條**

```ts
it('LOD 隨距離單調不增', () => {})
it('遲滯：在邊界上來回移動不會每次都換級', () => {
  expect(lodFor(LOD_NEAR + 10, 0)).toBe(0)        // 已經是 L0，還留著
  expect(lodFor(LOD_NEAR + 10, 1)).toBe(1)        // 已經是 L1，不回頭
  expect(lodFor(LOD_NEAR + LOD_HYSTERESIS + 1, 0)).toBe(1)
})
it('鏡頭移動小於一格時不重生任何 tile', () => { /* 用 spy 數來源被呼叫幾次 */ })
it('圈外的 tile 會被釋放，free list 回得來', () => {})
it('每幀最多生 4 格', () => {})
it('暖機後 update 不再配置', () => {
  // 記下每個池的 instanceMatrix.array 參考，跑 600 次 update，比對參考不變
})
it('掃描 200 個鏡頭位置，沒有一個池溢位', () => {
  // 沿一條穿過全圖的航線；同時印出每個池的最大值供定值用
})
it('灌木只出現在 500 m 內', () => {})
it('建築不分級，2 km 內都畫', () => {})
it('dispose 之後所有 geometry 與 material 都被釋放', () => {})
it('object 的子節點數等於池數', () => {})
it('空的來源不會產生任何實例，也不會崩', () => {})
```

- [ ] **Step 2: 跑，全紅**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 全綠**
- [ ] **Step 5: 掃描定值** —— 跑第七條，把印出來的最大值 × 1.35 進位寫進
      容量常數，把掃描的結果寫進註解（**現狀，不是沿革**）
- [ ] **Step 6: `tsc` 與提交**

---

## Task 10: 接線

**Files:**
- Modify: `src/render/terrain.ts`、`src/main.ts`
- Test: `test/unit/terrain.test.ts`（加 6 條）

- 農地：`createVegetation([farmHedgeFlora, farmWoodFlora, farmVillageFlora], solid.sample)`
- 群島：`createVegetation([createIslandFlora(field, islands)], field.sample)`
- 兩者都 `group.add(veg.object)` —— **索引 3**，既有的 0/1/2 不動
- `update` 把 `centerX, centerZ` 傳下去
- `dispose` 加上 `veg.dispose()`
- `main.ts` 的 `__gfx` 加 `flora: () => [terrain.object.children[3]!]`

- [ ] **Step 1: 先驗紅**

```ts
it('農地的 terrain 有第四個子節點，而且是植被', () => {})
it('群島的 terrain 也有', () => {})
it('純海面沒有植被（第四個位置不存在）', () => {})
it('terrain.update 會把鏡頭位置傳給植被', () => {})
it('terrain.dispose 會釋放植被', () => {})
it('既有的 0/1/2 索引契約沒有變', () => {})
```

- [ ] **Step 2 – 6:** 同節奏。**這一步之後遊戲裡看得到樹** ——
      跑 `npm run dev`，人眼確認一次再提交。

---

## Task 11: 試飛截圖（含上一輪的遺留）

**Files:**
- Modify: `src/main.ts`（`__still` 擴充成吃 `x` / `z`）
- Create: `test/e2e/farmland-shot.e2e.ts`

六個定格：3 km 俯瞰、600 m 巡航、150 m 貼地、細節區邊緣往外、往內、
**450 m 的 LOD 邊界**。

- [ ] Step 1：`__still` 現在釘在原點（`main.ts:1417-1422`），改成吃選填的
      `x` / `z`，預設維持原點
- [ ] Step 2：寫 e2e，六張圖存到 scratchpad
- [ ] Step 3：**人眼驗收** —— 交給專案負責人看
- [ ] Step 4：提交

---

## Task 12: 量測與收尾

**Files:**
- Modify: `test/integration/terrain-in-play.test.ts`、`docs/backlog.md`

- [ ] Step 1：`frame-time` e2e，植被開與關（用 `__gfx` 的 `flora`）各量一次，
      記錄平均、1% low、0.1% low、掉幀數
- [ ] Step 2：`terrain-in-play` 補農地那一場的基準（墜機數、最小離地、
      地形接管佔比、丘陵數）
- [ ] Step 3：`docs/backlog.md` §11 —— 做了什麼、量到什麼、**沒做什麼**
      （樹的碰撞、村落的院子地色、LOD 逐 tile 切換、AI 看不見植被）
- [ ] Step 4：全套件（`perf-gate` 與 `rematch` 各自單獨跑）＋ `tsc` ＋ 提交

---

## 自我檢查

- **SPEC 的每一節都有對應的任務**：§4 LOD → Task 8/9；§5 放置 → Task 4–7；
  §6 條紋 → Task 2；§7 預算 → Task 12；§8 容量 → Task 9 Step 5；
  §9 恆等式 → 各任務的測試；§10 延後 → Task 12 Step 3。
- **沒有佔位符**：每個任務都有實際的測試碼與實作要點。
- **型別一致**：`FloraSource` 的簽章在 Task 4 定義，Task 5/6/7 沿用；
  `FloraBuffer` 由引擎預配，來源只寫不配。
- **最容易寫出「錯的程式也會綠」的地方**：Task 4 的「每一棵都在樹籬帶上」——
  一棵樹都沒生的話它是空操作。所以那一條同時斷言 `n > 400`，而且 Step 5
  用變異證明它承重。同樣的陷阱在 Task 5、6、7 的第一條，處理方式相同。
