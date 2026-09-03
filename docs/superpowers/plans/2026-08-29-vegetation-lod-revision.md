# 植被 LOD 修訂與地面圖案抗鋸齒 實作計畫

> **給執行者：** 逐任務做，每一條新測試都要先驗紅或以變異證明它承重。

**目標：** LOD 換級不再換樹種；維持半徑與樹幹門檻放大；遠方的帶邊改用解析盒濾波。

**架構：** 喬木的池由「三級不分樹種」改成「兩級分樹種」，池數維持 8 個。
`fieldColorAt` 由提早 return 改成疊加，優先序不變。

**Spec：** `docs/superpowers/specs/2026-08-29-vegetation-lod-revision-design.md`

**已完成：** Task 0（幾何繞序，commit 4200f86）。

## 全域約束

- 不得 `Math.random`。不得引入 `@types/node`。不用任何貼圖。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- 註解寫現狀，不寫沿革。**改架構就要把提到舊架構的註解一起改掉** ——
  `vegetation.ts` 現有註解裡的「三條 LOD 環」「treeFar 緩衝」都會過期。
- `fieldAt` / `fieldSurfaceColor`（CPU）的公式一個字都不改。
- 跑測試：`node node_modules/vitest/vitest.mjs run`；型別：`node node_modules/typescript/bin/tsc --noEmit`（基準 23 條）。

---

### Task 1：四個喬木幾何，分樹種的兩級

**檔案：** 改 `src/render/floraShapes.ts`、`test/unit/flora-shapes.test.ts`

**介面產出：** `PoolName` = `'broadNear' | 'broadFar' | 'coneNear' | 'coneFar' | 'bush' | 'house' | 'barn' | 'church'`

- [ ] **步驟 1：先寫會紅的測試**

```ts
/** 樹冠色 —— 樹幹先建，所以最後一個頂點一定是樹冠 */
function crownColour(g: BufferGeometry): string {
  const c = g.getAttribute('color')
  const i = c.count - 1
  return [c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(4)).join(',')
}

it('換級不換樹種：兩級同色，兩樹種不同色', () => {
  expect(crownColour(geo.broadFar)).toBe(crownColour(geo.broadNear))
  expect(crownColour(geo.coneFar)).toBe(crownColour(geo.coneNear))
  expect(crownColour(geo.broadFar)).not.toBe(crownColour(geo.coneFar))
})

it('換級不換剪影：闊葉遠近都圓，針葉遠近都尖', () => {
  const ratio = (n: PoolName): number => {
    const b = bounds(geo[n])
    return (b.max.x - b.min.x) / b.max.y
  }
  // 闊葉的樹冠接近球
  expect(ratio('broadFar')).toBeGreaterThan(0.6)
  // 針葉細長 —— 兩級都是
  expect(ratio('coneNear')).toBeLessThan(0.6)
  expect(ratio('coneFar')).toBeLessThan(0.6)
})
```

三角形數那條的 `want` 改成 `broadNear: 20, broadFar: 8, coneNear: 19, coneFar: 6`。
`STAR_Y` 的鍵跟著換：`broadNear: 5, broadFar: 7.5, coneNear: 4, coneFar: 1`。

- [ ] **步驟 2：跑一次確認是紅的**

- [ ] **步驟 3：改 `floraShapes.ts`**

```ts
// 闊葉近：圓柱樹幹 12 ＋ 八面體樹冠 8 = 20
broadNear: build((s) => {
  cylinder(s, TRUNK, 6, 0.5, 0, 5)
  octa(s, BROAD_LEAF, 4.5, 5, 10)
}),
// 【遠級不是簡化版，是同一個剪影的便宜版】掉的是樹幹，顏色與「圓」這件事
// 都留著 —— 換級只該讓樹變簡單，不該讓它變成另一種樹
broadFar: build((s) => { octa(s, BROAD_LEAF, 5, TREE_HEIGHT / 2, TREE_HEIGHT / 2) }),
// 針葉近：圓柱樹幹 12 ＋ 七邊錐 7 = 19
coneNear: build((s) => {
  cylinder(s, TRUNK, 6, 0.45, 0, 4)
  cone(s, CONIFER, 7, 3.5, 4, TREE_HEIGHT)
}),
// 針葉遠：六邊錐，底落地。仍然是深綠的尖
coneFar: build((s) => { cone(s, CONIFER, 6, 3.2, 0, TREE_HEIGHT) }),
```

檔頭那段「中距離沒有樹幹 / 形狀是圓的不是尖的」的註解換掉 —— 它描述的是
不分樹種的舊配置。

- [ ] **步驟 4：跑到綠**

- [ ] **步驟 5：變異驗證** —— 把 `coneFar` 的顏色改成 `BROAD_LEAF`，
  確認步驟 1 第一條紅；把 `coneFar` 換成 `octa`，確認第二條紅。改回來。

- [ ] **步驟 6：commit**

---

### Task 2：兩級的池與新的距離

**檔案：** 改 `src/render/vegetation.ts`、`test/unit/vegetation.test.ts`

**介面產出：** `LOD_NEAR = 900`（唯一的換級門檻）、`FLORA_RADIUS = 3000`、
`BUSH_RANGE = 1200`、`TILE_CACHE = 560`；`export function poolOf`；
`lodFor` 回 `0 | 1 | 2`（2 = 圈外不畫）；`LOD_MID` / `LOD_FAR` 移除。

- [ ] **步驟 1：先寫會紅的測試**

```ts
/**
 * 【逐一比對四個映射，不是只驗前綴】只驗 `/^broad/` 的話，「兩級都回
 * broadNear」與「近遠對調」都會綠 —— 而那兩個正是最可能寫出來的錯。
 */
it('換級不換樹種，而且近遠沒有對調', () => {
  expect(poolOf(FloraKind.BroadTree, 0, false)).toBe('broadNear')
  expect(poolOf(FloraKind.BroadTree, 1, false)).toBe('broadFar')
  expect(poolOf(FloraKind.ConeTree, 0, false)).toBe('coneNear')
  expect(poolOf(FloraKind.ConeTree, 1, false)).toBe('coneFar')
  expect(poolOf(FloraKind.BroadTree, 2, false)).toBeNull()
  expect(poolOf(FloraKind.ConeTree, 2, false)).toBeNull()
})

it('lodFor 只有一個換級門檻，而且有遲滯', () => {
  expect(lodFor(100, -1)).toBe(0)
  expect(lodFor(LOD_NEAR + 1, -1)).toBe(1)
  expect(lodFor(FLORA_RADIUS + 1, -1)).toBe(2)
  expect(lodFor(LOD_NEAR + 10, 0)).toBe(0)
  expect(lodFor(LOD_NEAR - 10, 1)).toBe(1)
  expect(lodFor(LOD_NEAR + LOD_HYSTERESIS + 1, 0)).toBe(1)
  expect(lodFor(LOD_NEAR - LOD_HYSTERESIS - 1, 1)).toBe(0)
})
```

- [ ] **步驟 2：跑一次確認是紅的**

- [ ] **步驟 3：改 `vegetation.ts`**

1. 常數：`FLORA_RADIUS = 3000`、`LOD_NEAR = 900`、`BUSH_RANGE = 1200`、
   `TILE_CACHE = 560`。刪 `LOD_MID` / `LOD_FAR`，`LOD_STEP = [LOD_NEAR, FLORA_RADIUS]`。
2. `poolOf` 改成 export，四個映射如上；`if (lod >= 2) return null`。
3. `lodFor` 的兩個 `while` 上界由 3 改成 2。
4. `markLevel`：`lod === 0` 標 `broadNear` / `coneNear`，`lod === 1` 標
   `broadFar` / `coneFar`。
5. `POOL_NAMES`、`counts`、`poolDirty` 的初值換成新的八個名字。
6. **註解**：檔頭階梯圖改成兩級四池；`REBUILD_EVERY` 那段的「三條 LOD 環上
   大約有 88 格」與 `REBUILD_MOVE` 那段的「treeFar 緩衝整個消失」都要改寫成
   現況（量測的結論仍然成立，過期的是那些名字與數字）。`TILE_CACHE` 的
   註解寫 560 槽約 7.2 MB。

- [ ] **步驟 4：掃一遍舊名字**

`grep -rn "broadL0\|coneL0\|treeMid\|treeFar\|LOD_MID\|LOD_FAR" src test`
（`docs/` 的歷史文件不動。）

- [ ] **步驟 5：跑 `vegetation.test.ts` 到綠。**
  既有那幾條靠舊池名的（`near.treeFar > near.broadL0` 之類）跟著改成
  新的兩級語意：近處 `broadNear > 0`、遠處 `broadFar` 遠多於 `broadNear`。

- [ ] **步驟 6：commit**

---

### Task 3：容量重新定值（先哨兵，再定值）

**檔案：** 改 `src/render/vegetation.ts`（只有 `CAPACITY`）、`test/unit/vegetation.test.ts`

**為什麼要哨兵：** 掃描讀的是 `v.counts`，而 `rebuild()` 已經先用 `CAPACITY`
截斷過它。用正式容量掃出來的「最大值」可能就是截斷值 —— 那是循環量測。

- [ ] **步驟 1：讓掃描可以指定容量**

`createVegetation` 加一個可選參數 `capacity?: Partial<Record<PoolName, number>>`，
預設用 `CAPACITY`。測試用十萬跑。

- [ ] **步驟 2：用哨兵掃**

沿既有那條穿過全圖的航線取 40 個位置，印各池最大同時實例數。

- [ ] **步驟 3：定值**

實測最大 × 1.35 進位，註解裡寫實測最大值。與
`test/tools/flora-radius.probe.ts` 的 R=3,000 / 樹幹 900 / 灌木 1,200 那一列
對照（那份是 24 個位置、直接按 tile 原始種類分桶，走的不是引擎）：

```
  broadNear 2165   coneNear 1052   broadFar 15427   coneFar 5787   bush 8314
```

兩份走的路不同但共用同一組 flora 生成器，所以**它只擋得住引擎那一側的錯**
（`poolOf`、`lodFor`、遲滯、打包），擋不住生成器本身的密度 bug。
差一成以內算正常；差三成以上停下來查。

- [ ] **步驟 4：變異驗證每一池**

用哨兵參數把某一池的容量調到實測最大 − 1，跑同一條航線，
斷言 `stats.overflow > 0`。八個池各一次。**沒有這一條，×1.35 沒有任何東西守著。**

- [ ] **步驟 5：正式容量下 `stats.overflow === 0`**

- [ ] **步驟 6：commit**

---

### Task 4：帶的邊緣改用解析盒濾波

**檔案：** 改 `src/render/fields.ts`（只有 `FIELD_GLSL`）、`test/unit/fields.test.ts`

**`fieldAt` / `fieldSurfaceColor` 一行都不動。**

- [ ] **步驟 1：先寫會紅的測試**

```ts
/**
 * 【守的是疊出來的順序，不是「有沒有這個字」】只查 `toContain('bandCoverage')`
 * 的話，宣告了卻不呼叫、參數傳錯、疊色順序反了都會綠。
 */
it('帶的邊緣走盒濾波，而且順序是 底色 → 條紋 → 樹籬 → 凹路', () => {
  // 足跡在最前面、無條件、吃世界座標
  expect(FIELD_GLSL).toContain(
    'float px = 0.5 * length(vec2(fwidth(world.x), fwidth(world.y)));')
  // 【不得用 fwidth(best)】best 是五個距離取 min，角平分線上不可微
  expect(FIELD_GLSL).not.toContain('fwidth(best)')
  // 盒濾波的本體
  expect(FIELD_GLSL).toContain(
    'clamp((min(d + w, halfW) - max(d - w, 0.0)) / (2.0 * w), 0.0, 1.0)')
  // 硬判斷一個都不准留
  expect(FIELD_GLSL).not.toContain('return TRACK_COLOR;')
  expect(FIELD_GLSL).not.toContain('return HEDGE_COLOR;')
  expect(FIELD_GLSL).not.toContain('return WOOD_COLOR;')

  const body = FIELD_GLSL.slice(FIELD_GLSL.indexOf('vec3 fieldColorAt'))
  const at = (s: string): number => body.indexOf(s)
  expect(at('col *= stripe(')).toBeGreaterThan(0)
  expect(at('col = mix(col, HEDGE_COLOR')).toBeGreaterThan(at('col *= stripe('))
  expect(at('col = mix(col, TRACK_COLOR')).toBeGreaterThan(at('col = mix(col, HEDGE_COLOR'))
})

/**
 * 【樹林不得有條紋】現況樹林是純色，CPU 的 fieldSurfaceColor 也回純色。
 * 把 stripe 無條件套上去會多出一個沒核可的 CPU/GPU 分歧。
 */
it('條紋不套在樹林上', () => {
  const body = FIELD_GLSL.slice(FIELD_GLSL.indexOf('vec3 fieldColorAt'))
  expect(body).toContain('float amp = wood ? 0.0 : (ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP);')
})
```

金本位那條釘的 `'if (float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE'`
改成 `'bool isHedge = float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE;'`
—— 運算式一個字沒變，只是不再是 `if` 的條件。

- [ ] **步驟 2：跑一次確認是紅的**

- [ ] **步驟 3：改 GLSL**

加輔助函數（**參數不能叫 `half`，那是 GLSL 保留字**）：

```glsl
// 【解析盒濾波】一個像素蓋到的地一超過帶寬，「在不在帶上」的二選一就隨鏡頭
// 微動翻面 —— 那是遠方線條爬行的原因，而 MSAA 幫不上忙（片段著色器一個
// 像素只跑一次）。
//
// d 是到帶中心線的距離（非負），halfW 是半寬，w 是像素在地面上的半足跡。
// 回傳的是那條帶在 [d - w, d + w] 這一段裡佔的比例。
//
// 【極限行為】w → ∞ 時趨近 halfW / w，也就是真實的面積比 —— 遠處的細線
// 變淡而不是變寬。smoothstep 沒有這個性質，它會把影響範圍撐到 halfW + w。
float bandCoverage(float d, float halfW, float w) {
  return clamp((min(d + w, halfW) - max(d - w, 0.0)) / (2.0 * w), 0.0, 1.0);
}
```

`fieldColorAt` 的改法：

1. 函數第一行（在任何分支之前）算足跡：

```glsl
  // 【無條件、吃世界座標】導數指令在 fragment quad 內分歧時結果不可靠，
  // 而 world 是內插的 varying，處處平滑
  float px = 0.5 * length(vec2(fwidth(world.x), fwidth(world.y)));
```

2. `if (r2 - r1 < TRACK_WIDTH) return TRACK_COLOR;` 拿掉，其餘照走。
3. 樹籬那一段改成 `bool isHedge = ...;`（運算式不變）。
4. `if (isWoodField(fh)) return WOOD_COLOR;` 改成 `bool wood = isWoodField(fh);`
5. 底色與條紋：

```glsl
  bool ploughed = float(fh & 0xffu) / 256.0 < PLOUGH_CHANCE;
  vec3 col = wood ? WOOD_COLOR : PLOUGHED_COLOR;
  if (!wood && !ploughed) {
    int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, 7);
    float k = 0.94 + (float((fh >> 16u) & 0xffu) / 255.0) * 0.12;
    col = FIELD_PALETTE[t] * k;
  }
  // 【犁田加倍、樹林沒有】溝比行深；樹林是林冠不是作物
  float amp = wood ? 0.0 : (ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP);
  col *= stripe(q, STRIPE_PERIOD, amp);
  // 【順序就是優先權】凹路壓過樹籬，樹籬壓過田 —— 與 fieldSurfaceColor 相同
  col = mix(col, HEDGE_COLOR, isHedge ? bandCoverage(best, HEDGE_WIDTH * 0.5, px) : 0.0);
  col = mix(col, TRACK_COLOR, bandCoverage(r2 - r1, TRACK_WIDTH, px));
  return col;
```

**注意 `TRACK_WIDTH` 傳的是整個寬度不是半寬** —— 現況的判準是
`r2 - r1 < TRACK_WIDTH`，凹路的半寬就是 `TRACK_WIDTH`。樹籬那邊現況是
`best < HEDGE_WIDTH * 0.5`，所以傳半寬。**兩者不一樣，別統一。**

- [ ] **步驟 4：跑到綠。** 尤其 `fields.test.ts` 全部與 `flora-wood.test.ts`。

- [ ] **步驟 5：語法** —— `node node_modules/vitest/vitest.mjs run test/e2e/glsl-compile.e2e.ts`
  （要真的 WebGL2 context）。

- [ ] **步驟 6：commit**

---

### Task 5：量測與試飛

- [ ] **步驟 1：全套件 ＋ tsc**（`perf-gate` 與 `rematch` 單獨跑；tsc 必須仍是 23 條）

- [ ] **步驟 2：幀時間 A/B**

起 dev server，跑 `flora-cost` 腳本（三輪各取中位數）。
**驗收：頓挫 ≤ 1.2/s，且 p50 相對關植被不得多 4 ms 以上。**
p50 超標就先退 `TILE_CACHE` 相關的每幀掃描（`fill` 只在有缺格時掃全範圍）；
頓挫超標就把 `FLORA_RADIUS` 退到 2,500 再量。

- [ ] **步驟 3：截圖三張** —— 甲板平視地平線、900 m 門檻附近、針葉密的一塊。

- [ ] **步驟 4：backlog §11 補一段修訂，commit**
