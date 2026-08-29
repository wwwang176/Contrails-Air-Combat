# 繪製呼叫與每幀上傳 實作計畫

**Spec**：`docs/superpowers/specs/2026-08-30-draw-calls-and-uploads-design.md`

**目標**：把繪製側的 24.4 ms 壓下來，而畫面**一個像素都不動**。

**做法**：天空最後畫（最小、風險最低，先做以建立逐像素的驗收流程）→ 逐池的
上傳閘與 count（照抄 `debris.ts` 驗過的招）→ 飛機按材質合併（最大，也最容易
不小心改到畫面）。

**技術**：TypeScript、three.js（`BufferGeometryUtils.mergeGeometries`）、
vitest、playwright。

## 全域約束

- **判準是逐像素相同。** 做不到的改動不進這一版。
- 不得使用 `Math.random`；不得引 `@types/node`（e2e 也不行）。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- 註解寫現狀，不寫沿革。
- 每一條新測試先驗紅，或以變異證明承重。
- 逐項提交，每一項自己量一次幀時間 —— 三項一起進場出問題無法歸因。
- 提交訊息走檔案 ＋ `git commit -F`；絕不 `git add -A`。
- 掃描參數一律 `cp` 備份還原，不用 git。
- `perf-gate.test.ts` 與 `rematch.test.ts` 要單獨跑。

---

## 任務 1：天空最後畫

**檔案**
- 改：`src/render/sky.ts`
- 測：`test/unit/sky.test.ts`（沒有就建）

**介面**
- 產出：`SKY_RENDER_ORDER`（匯出，給測試與其他層對照）

- [ ] **步驟 1：查清楚場上用到的所有 `renderOrder`**

```bash
grep -rn "renderOrder" src/ --include=*.ts
```

已知：天空 −1000、遠海 1、螺旋槳圓盤 `PROP_DISC_RENDER_ORDER = 10`。
新的值要比**所有不透明物**大。

- [ ] **步驟 2：寫失敗測試**

```ts
/**
 * 【為什麼要最後畫】天空原本 `renderOrder = -1000` 先畫，整個螢幕被著色一次
 * 再被地面蓋掉。改成最後畫（深度測試仍然開著）之後，只有真正看得到的天空
 * 像素才付錢。
 *
 * 【仍然要在不透明那一批裡】three 先畫 opaque 再畫 transparent。天空的材質
 * 不是 transparent，所以大的 renderOrder 會把它排在不透明的最後、粒子與
 * 曳光彈之前 —— 那正是要的位置。
 */
it('天空排在所有不透明物之後', () => {
  const sky = createSky()
  expect(sky.renderOrder).toBe(SKY_RENDER_ORDER)
  expect(SKY_RENDER_ORDER).toBeGreaterThan(PROP_DISC_RENDER_ORDER)
  expect(SKY_RENDER_ORDER).toBeGreaterThan(FAR_SEA_RENDER_ORDER)
  // 【材質不能是 transparent】那會把它推到透明那一批，排在粒子後面
  expect((sky.material as Material).transparent).toBe(false)
  // 【深度測試一定要開】關掉就等於還是「畫滿整個螢幕」
  expect((sky.material as Material).depthTest).toBe(true)
  // 【深度寫入一定要關】天空球在近平面附近，寫深度會把它前面的東西剔掉
  expect((sky.material as Material).depthWrite).toBe(false)
})
```

- [ ] **步驟 3：跑，確認紅**

- [ ] **步驟 4：實作**

`sky.ts`：

```ts
/**
 * 天空的繪製順序。**比所有不透明物大** —— 見下方 `depthTest` 的說明。
 *
 * 【為什麼不是先畫】先畫的話整個螢幕會被天空的片段著色器跑一遍，然後
 * 大部分被地面與海蓋掉。最後畫加上深度測試，只有真的看得到的那些像素
 * 才付錢。
 */
export const SKY_RENDER_ORDER = 1000
```

`mesh.renderOrder = SKY_RENDER_ORDER`，材質 `depthTest` 維持預設的 `true`、
`depthWrite` 維持 `false`。

- [ ] **步驟 5：跑，確認綠**

- [ ] **步驟 6：逐像素驗收**

```
node node_modules/vite/bin/vite.js --port 5190
git stash                                              # 回到改動前
node node_modules/vite-node/vite-node.mjs test/e2e/pixel-identical.e2e.ts before
git stash pop
node node_modules/vite-node/vite-node.mjs test/e2e/pixel-identical.e2e.ts after
```

比對兩批 PNG（檔尾有說明）。**必須逐位元組相同。**

- [ ] **步驟 7：全套件、`tsc`、量一次幀時間、提交**

---

## 任務 2：逐池的上傳閘與 `count`

**檔案**
- 改：`src/render/tracers.ts`、`sparks.ts`、`splash.ts`、`muzzle.ts`、`vortex.ts`
- 測：`test/unit/pools.test.ts`（新建）

**介面**
- 每一個池的回傳型別加一個只給測試看的 `stats: { uploads: number, count: number }`。

- [ ] **步驟 1：寫失敗測試（兩條，逐池跑）**

```ts
/**
 * 【為什麼要有這一組】`debris` 與 `turretBarrels` 之前每幀無條件對**正在被
 * GPU 讀的**緩衝呼叫 `bufferSubData`，那一下佔掉 70% 的幀時間。剩下五個池
 * 是同一個寫法。
 *
 * 【量的是「有沒有標 needsUpdate」】`needsUpdate` 在 three 只有 setter 沒有
 * getter，讀出來恆是 undefined —— 它做的事是把 `version` 加一，所以比 version。
 */
const POOLS = [
  { name: 'tracers', make: () => createTracers(), idle: (p) => p.update(EMPTY_PROJECTILES) },
  { name: 'sparks', make: () => createSparks(), idle: (p) => p.update(0.016) },
  // …splash、muzzle 槍口、muzzle 砲塔、vortex
] as const

it.each(POOLS)('$name：整池全死時不上傳', ({ make, idle }) => {
  const p = make()
  idle(p)                       // 先跑一幀讓它把該歸零的歸零
  const v0 = versionOf(p)
  for (let k = 0; k < 10; k++) idle(p)
  expect(versionOf(p)).toEqual(v0)
})

it.each(POOLS)('$name：有東西動時一定上傳', ({ make, idle, spawn }) => {
  const p = make()
  idle(p)
  const v0 = versionOf(p)
  spawn(p)                      // 生一個
  idle(p)
  expect(versionOf(p)[0]).toBeGreaterThan(v0[0]!)
})
```

**第二條比第一條重要。** 漏標 `touched` 的症狀是那一層**停在上一幀**（曳光彈
不動、火花凍住），而那在靜態截圖上看不出來。

- [ ] **步驟 2：跑，確認第一條紅、第二條綠**

現況是無條件上傳，所以「全死時不上傳」必紅、「有東西動時一定上傳」必綠。

- [ ] **步驟 3：`tracers.ts`**

```ts
/**
 * 這一幀有沒有動到任何一格。**沒動就不上傳。**
 *
 * 【為什麼】對正在被 GPU 讀的緩衝呼叫 `bufferSubData` 會強迫管線同步，
 * 而空戰大部分時間場上不到十發子彈 —— 見 `render/debris.ts` 的同一段。
 */
let touched = false
/** 曾經活過的最大槽位。上傳與 `count` 都只走到這裡 */
let hi = -1
/** 這一格上一幀是不是活的。用來知道「剛死掉」的那一格要不要歸零 */
const wasLive = new Uint8Array(capacity)
```

`update` 改成：

```ts
update(p: Projectiles): void {
  const n = Math.min(capacity, p.capacity)
  let lo = n
  let up = -1
  for (let i = 0; i < n; i++) {
    const live = p.owner[i] !== -1
    // 【死了而且上一幀就已經歸零過的格子，一個指令都不必下】
    if (!live && wasLive[i] === 0) continue
    …原本的計算…
    object.setMatrixAt(i, M)
    wasLive[i] = live ? 1 : 0
    if (i < lo) lo = i
    if (i > up) up = i
    if (live && i > hi) hi = i
    touched = true
  }
  if (!touched) return
  object.count = hi + 1
  object.instanceMatrix.addUpdateRange(lo * 16, (up - lo + 1) * 16)
  object.instanceMatrix.needsUpdate = true
  touched = false
}
```

**`hi` 不往下收。** 收的話要重掃全部找新的最大值，而那正是想省掉的迴圈。
容量 4,000 但實戰的高水位遠低於它；真的打滿一次之後 `count` 會停在高處，
代價是頂點著色器多跑一些退化三角形 —— 那會被早期剔除掉，不是問題。

- [ ] **步驟 4：`sparks.ts` / `splash.ts` / `muzzle.ts`（兩個池）**

同一招。這四個已經有 `live` 計數，所以 `touched` 可以直接由「這一幀有沒有寫
過任何一格」得到。**`muzzle` 有兩個池，兩個都要改**（槍口與砲塔各一）。

- [ ] **步驟 5：`vortex.ts` 只補 `addUpdateRange`**

它已經有 `touched`，缺的是「只傳動過的那一段」。尾跡在緩衝裡是連續配置的
（`slotOf(t, k)`），而它自己有逐尾跡的 `dirty[t]` —— 由那個算出 `[lo, up]`：

```ts
// 【只傳動過的尾跡】任何一條動過就整條 327 KB 全傳的話，纏鬥中那個閘
// 幾乎永遠是開的，等於沒有閘
let lo = vertexCount
let up = -1
for (let t = 0; t < trails; t++) {
  if (dirty[t] === 0) continue
  const a = t * TRAIL_NODES * TRAIL_SIDES
  const b = a + TRAIL_NODES * TRAIL_SIDES
  if (a < lo) lo = a
  if (b > up) up = b
}
```

- [ ] **步驟 6：跑，兩條都綠**

- [ ] **步驟 7：變異驗證**

逐池把 `touched` 改成恆真 → 第一條紅；改成恆假 → 第二條紅。

- [ ] **步驟 8：逐像素驗收**

`pixel-identical.e2e.ts` 把粒子與曳光彈關掉了，所以它守不到這一項。**要另外
做一個動態的驗收**：定格不行（定格時這些池本來就不更新）。改成——

```
   代飛纏鬥 20 秒，每 0.5 秒抓一次畫面的雜湊（改動前後各一輪）
   → 不會相同（戰況不同），所以這一條**不是**逐像素比對
```

**改用行為的判準**：`pools.test.ts` 的第二條（有東西動時一定上傳）加上一條
新的整合測試「生一個粒子 → 跑十幀 → 它的矩陣確實在動」。畫面的部分靠人眼
複查一次代飛截圖。

- [ ] **步驟 9：全套件、`tsc`、量一次幀時間、提交**

---

## 任務 3：飛機的靜態零件按材質合併

**檔案**
- 改：`src/render/geometry/assembly.ts`（在 `api` 的回傳處合併）
- 測：`test/unit/aircraft-merge.test.ts`（新建）
- 建：`test/e2e/fixtures/plane-probe.ts`
- 建：`test/e2e/plane-identical.e2e.ts`

**介面**
- 產出：`mergeStaticParts(group: Group): { merged: number, kept: number }`
  —— 匯出給測試。就地改 `group`。

- [ ] **步驟 1：先寫「不改頂點集合」的失敗測試**

```ts
/**
 * 【判準是頂點的多重集，不是順序】合併會把零件串起來，順序一定會變；
 * 但每一個頂點的**世界座標與世界法線**必須一個不多一個不少。
 *
 * 【一定要比法線】只比位置的話，忘了對法線套法線矩陣也會全綠 —— 而那個
 * 缺陷的症狀是非等比縮放的零件亮度不對。
 */
function worldVerts(root: Object3D): string[] {
  root.updateMatrixWorld(true)
  const out: string[] = []
  const p = new Vector3()
  const n = new Vector3()
  const nm = new Matrix3()
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    nm.getNormalMatrix(o.matrixWorld)
    const pos = o.geometry.getAttribute('position')
    const nor = o.geometry.getAttribute('normal')
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
      out.push([p.x, p.y, p.z, n.x, n.y, n.z].map((v) => v.toFixed(4)).join(','))
    }
  })
  return out.sort()
}

it.each(SPECS)('$id：合併不改頂點集合', (spec) => {
  const a = buildAircraft(spec)
  const before = worldVerts(a.group)
  const b = buildAircraft(spec)
  mergeStaticParts(b.group)
  expect(worldVerts(b.group)).toEqual(before)
})
```

- [ ] **步驟 2：寫「會動的零件仍然獨立」的失敗測試**

```ts
/**
 * 【怎麼認出會動的】不用名字比對（會漏）。呼叫 `setPropSpin` 兩次不同的
 * 參數，把 `rotation` 或 `visible` 變過的節點連同它的子樹標成會動。
 */
it.each(SPECS)('$id：合併之後 setPropSpin 仍然有效', (spec) => {
  const m = buildAircraft(spec)
  mergeStaticParts(m.group)
  const snap = () => {
    const out: string[] = []
    m.group.traverse((o) => out.push(`${o.rotation.z},${o.visible}`))
    return out.join('|')
  }
  const a = snap()
  m.setPropSpin(1.234, true)
  const b = snap()
  m.setPropSpin(0, false)
  expect(b).not.toBe(a)
  expect(snap()).toBe(a)
})
```

- [ ] **步驟 3：寫「draw call 數」的失敗測試**

```ts
/** 【精確比對，不是上限】這是這一項的收益本身 —— 改壞了要當場知道 */
it('合併後的 mesh 數逐機種釘死', () => {
  const want: Record<string, number> = {
    p51d: 9, bf109k4: 8, he111: 14, b17g: 22,
  }
  for (const spec of SPECS) {
    const m = buildAircraft(spec)
    mergeStaticParts(m.group)
    let n = 0
    m.group.traverse((o) => { if (o instanceof Mesh) n++ })
    expect([spec.id, n]).toEqual([spec.id, want[spec.id]])
  }
})
```

- [ ] **步驟 4：跑，三條都紅（`mergeStaticParts is not a function`）**

- [ ] **步驟 5：實作 `mergeStaticParts`**

```ts
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 把不會動的零件按材質合併。**就地改 `group`。**
 *
 * 【為什麼】一架 P-51D 是 30 個 `Mesh`，20v20 就是 1,220 個 draw call。
 * 靜態的那 25 個只用到 4 顆材質，合併之後整架剩 9 個。
 *
 * 【會動的靠行為認，不靠名字】`setPropSpin` 只碰槳轂的 `rotation.z` 與
 * 槳葉／圓盤的 `visible`。呼叫兩次不同的參數，狀態變過的節點連同子樹就是
 * 會動的 —— 名字比對會漏掉新加的零件。
 *
 * 【變換要烘進頂點】`mergeGeometries` 只吃幾何。每一個要併的先
 * `clone().applyMatrix4(mesh.matrixWorld)` —— 那一支對 `normal` 用的是
 * 法線矩陣，所以非等比縮放的零件法線才不會歪。前提是 `updateMatrixWorld`
 * 先跑過。
 *
 * 【材質按身分分組，不按參數】座艙內裝是「朝內的殼」（`side` 不同），
 * 機身、玻璃、金屬各有各的參數。比身分就自動保住這一點。
 *
 * 【屬性集合不同的不併】`mergeGeometries` 要求所有幾何有相同的屬性集合。
 * 缺 `uv` 或 `color` 的自成一組，原樣留著。
 */
export function mergeStaticParts(group: Group): { merged: number, kept: number }
```

實作要點的順序：

1. `group.updateMatrixWorld(true)`
2. 用 `setPropSpin` 探出會動的節點集合 `moving`（含子樹）
3. 走訪，把不在 `moving` 裡的 `Mesh` 按 `(material, 屬性集合的簽名)` 分組
4. 每一組 ≥ 2 個才併；只有一個的原樣留著
5. 併出來的 `Mesh` 加到 `group` 的**根**上（變換已經烘進去，所以不能掛在
   原本的父節點下）
6. 由父節點移除被併掉的 `Mesh`，並 `dispose` 它們的幾何
7. 回 `{ merged, kept }`

- [ ] **步驟 6：在 `assembly.ts` 的回傳處呼叫它**

合併出來的幾何要進 `disposables`。

- [ ] **步驟 7：跑，三條都綠**

- [ ] **步驟 8：`dispose` 不漏**

```ts
it.each(SPECS)('$id：dispose 之後每一個幾何都被釋放，各只一次', (spec) => {
  const m = buildAircraft(spec)
  const seen = new Map<BufferGeometry, number>()
  m.group.traverse((o) => {
    if (!(o instanceof Mesh)) return
    seen.set(o.geometry, 0)
    o.geometry.addEventListener('dispose', () =>
      seen.set(o.geometry, seen.get(o.geometry)! + 1))
  })
  m.dispose()
  expect([...seen.values()]).toEqual(new Array(seen.size).fill(1))
})
```

- [ ] **步驟 9：逐像素的 e2e**

`test/e2e/fixtures/plane-probe.ts`：在固定姿態渲染單獨一架飛機，用
`render/lighting.ts` 的正式燈光，回像素。

`test/e2e/plane-identical.e2e.ts`：

```
   四個機種 × 六個方位（0/60/120/180/240/300°）× 兩個俯角（0/−30°）
   × 螺旋槳兩種狀態（轉動／模糊圓盤）  = 96 張
```

合併前後各跑一輪，**逐位元組比對**。

```bash
node node_modules/vite/bin/vite.js --port 5190
git stash
node node_modules/vite-node/vite-node.mjs test/e2e/plane-identical.e2e.ts before
git stash pop
node node_modules/vite-node/vite-node.mjs test/e2e/plane-identical.e2e.ts after
```

- [ ] **步驟 10：全套件、`tsc`、量一次幀時間、提交**

---

## 任務 4：三項都進場之後的總量測

- [ ] **步驟 1：農地與群島各量一次**

代飛纏鬥、鎖 vsync（玩家實境）與解鎖（餘裕）各一組，三輪取中位數。

- [ ] **步驟 2：逐層再量一次**

`layer-live.e2e.ts`（不暫停、逐層開關）—— 確認 `aircraft` 與 `tracers` 兩項
真的降下來了，而不是被別的東西吸收掉。

- [ ] **步驟 3：把數字回填 backlog**

## 自我檢查

- **SPEC 覆蓋**：SPEC 的三項各對應任務 1～3，驗收表的六條各落在對應任務的
  步驟裡；任務 4 是 SPEC「幀時間」那一段。
- **佔位字**：無 TBD，每一個程式碼步驟都有實際內容。
- **型別一致**：`mergeStaticParts` 在任務 3 步驟 5 產出、步驟 6 消費；
  `SKY_RENDER_ORDER` 在任務 1 產出，任務 4 不再動它；各池的 `stats` 只在
  任務 2 內部使用。
