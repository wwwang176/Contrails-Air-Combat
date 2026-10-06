# 繪製呼叫與每幀上傳 實作計畫

**Spec**：`docs/superpowers/specs/2026-08-30-draw-calls-and-uploads-design.md`

**目標**：把繪製側的 24.4 ms 壓下來，而**畫面一個像素都不動**。

**架構**：任務一 上傳的閘與 `count`（零像素風險，先做）；任務二 天空最後畫
（要先修深度）；任務三 飛機靜態零件合併（**只併不需烘變換的那一批**）；
任務四 量測。

**技術**：TypeScript、three.js r180、`BufferGeometryUtils.mergeGeometries`、
vitest、playwright。

## 全域限制

- **判準是逐像素相同。**做不到的改動不進這一版 —— 這是 spec 的明文。
- 不使用 `Math.random`；不得引入 `@types/node`（e2e 也不行，`process`／`fs` 都不能用）。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- 註解寫現狀，不寫沿革。
- 每一條新測試都要先驗紅，或以變異證明它承重。
- 全套測試一次，但 `perf-gate.test.ts` 與 `test/integration/rematch.test.ts` 要單獨跑。
- `tsc` 的既有噪音基準是 23 行。
- 提交訊息寫檔案再 `git commit -F`；**絕不 `git add -A`**。
- 掃描參數時用 `cp` 備份還原，不要用 git。

---

## Codex 審查的結論（2026-08-30，六條 BLOCKER，全部覆核成立）

| # | 結論 | 覆核 | 本計畫的處置 |
| --- | --- | --- | --- |
| 1 | 天空最後畫會蓋掉 40 km 外的遠海 | 成立。`SKY_RADIUS = 40000` 而遠海半邊 3,000 km；深度約 0.99998，不是最遠 | 任務二加一行 `gl_Position.z = gl_Position.w` |
| 2 | `InstancedMesh.count` 建立時等於容量，全死時因 `touched` 早退而永遠不會縮 | 成立 | 建立時就設 `count = 0`；`count` 改成「本幀最高活著的索引 + 1」，不是高水位 |
| 3 | `addUpdateRange` 吃元素不吃 byte，three 會自己清 | 成立 | 照用 |
| 4 | tracers 的 `wasLive` 邏輯在環狀緩衝下沒有洞 | 成立 | 照用 |
| 5 | 烘變換的合併**做不到逐像素相同**（96 組中 82 組有 byte 差） | 成立 —— float64 的 CPU 烘焙與 float32 的 GPU 矩陣乘在最低位不同，邊緣像素必然翻動 | **改成只併不需烘變換的零件**，見下 |
| 6 | `setPropSpin` 是 `finish()` 的閉包，外部函式拿不到 | 成立 | 合併寫在 `finish()` 裡，`props` 直接在手上，根本不需要行為探測 |
| 7 | `pixel-identical.e2e.ts` 的 `PREFIX` 寫死、port 是 5173 | 成立（檔頭自己寫著「手動改它」） | 不用 `git stash`：先拍基準再改碼；port 用 5173 |
| 8 | `main.ts` 的 `__gfx` 以 `renderOrder === -1000` 找天空；vortex 的 `dirty[t]` 在 `writeTrail` 後就被清掉 | 成立 | 匯入 `SKY_RENDER_ORDER`；區間在 `writeTrail` 當下累積 |

### 第 5 條的重新定值 —— 實測過的可併範圍

原計畫要把每一架併到 8～22 個 mesh，靠的是
`geometry.clone().applyMatrix4(mesh.matrixWorld)`。那一步一定改像素：CPU 用
float64 算完再存成 float32，GPU 是 float32 矩陣乘 float32 頂點，最低位不同，
三角形邊緣的像素必然翻動。所以出局。

**不烘變換也能併的條件**：零件掛在 `hull` 底下、局部矩陣是單位矩陣、材質不透明。
併出來的 mesh 也掛在 `hull` 底下 —— 世界矩陣一模一樣，頂點資料一個 bit 都沒動，
GPU 收到的裁剪座標完全相同。

實測（`test/tools/merge-groups.probe.ts`）：

```
   機種      總 mesh   可併    組數   會動   非單位矩陣   半透明   合併後
   p51d          30       9      3      5         15         1       24
   bf109k4       31       6      2      4         20         1       27
   he111         46      16      3      8         18         4       33
   b17g          52      18      4     16         13         5       38
```

剩下的「非單位矩陣」幾乎全是整流罩與凸出物（`mesh.scale.set` ＋
`mesh.position.set` 的 `BoxGeometry`）。要併它們就得烘變換 —— 不在這一版。

40 架戰鬥機由 1,220 個 draw call 降到約 1,020，**省 16%**。比原本估的 72% 少很多，
但它是**證明得了逐像素相同**的那一半。烘變換那一半的實際像素差要量出來寫進
backlog，交給專案負責人裁決是否放寬判準（任務四步驟 3）。

---

## 任務一：逐池的上傳閘與 `count`

**先做這一項** —— 它一個像素都不會動，而且是三項裡收益最大的。

**檔案**
- 改：`src/render/tracers.ts`、`sparks.ts`、`splash.ts`、`muzzle.ts`、`vortex.ts`
- 新：`test/unit/pools.test.ts`

**共通的形狀**

```ts
let touched = false      // 這一幀有沒有寫過任何一格
let lo = capacity        // 寫過的最小索引
let up = -1              // 寫過的最大索引
const wasLive = new Uint8Array(capacity)   // 上一次 render 時 GPU 上是不是活的
```

每寫一格就 `touched = true; if (i < lo) lo = i; if (i > up) up = i`。

收尾：

```ts
object.count = hiLive + 1                     // hiLive = 本幀最高活著的索引
if (touched) {
  object.instanceMatrix.addUpdateRange(lo * 16, (up - lo + 1) * 16)
  object.instanceMatrix.needsUpdate = true
}
```

`addUpdateRange` 的單位是**型別化陣列的元素**：矩陣 stride 16，顏色 stride 3。
`needsUpdate` 被消費完 three 會自己 `clearUpdateRanges()`，不要每幀手動清。

`count` 用「本幀最高活著的索引 + 1」而不是不往下收的高水位：死格散在中間仍然
要歸零（`wasLive` 管這件事），但**尾巴上的死格連歸零都不必** —— 它們不在畫的
範圍裡。建立時的全零填充之後要明寫 `object.count = 0`。

- [ ] **步驟 1：先寫紅的測試**（`test/unit/pools.test.ts`）

每一個池四條。以 tracers 為例：

```ts
it('剛建立的池 count 就是 0', () => {
  expect(createTracers(64).object.count).toBe(0)
})

it('整池全死時不上傳，而且不畫', () => {
  const t = createTracers(64)
  const p = deadProjectiles(64)
  t.update(p)                                   // 第一次：把 count 降到 0
  t.object.instanceMatrix.needsUpdate = false
  t.update(p)
  expect(t.object.instanceMatrix.needsUpdate).toBe(false)
  expect(t.object.count).toBe(0)
})

it('有東西動時一定上傳', () => {
  const t = createTracers(64)
  const p = deadProjectiles(64)
  t.update(p)
  t.object.instanceMatrix.needsUpdate = false
  live(p, 3)                                    // 第 3 格生一發
  t.update(p)
  expect(t.object.instanceMatrix.needsUpdate).toBe(true)
  expect(t.object.count).toBe(4)
})

it('死掉的那一格會被歸零', () => {
  const t = createTracers(64)
  const p = deadProjectiles(64)
  live(p, 3); live(p, 10)
  t.update(p)
  kill(p, 3)
  t.update(p)
  const m = new Matrix4()
  t.object.getMatrixAt(3, m)
  expect(scaleOf(m)).toBe(0)          // 縮放三軸全 0
})
```

「有東西動時一定上傳」那一條最重要 —— 漏標 `touched` 的症狀是那一層停在上一幀，
靜態截圖看不出來。

- [ ] **步驟 2：跑，確認紅**（`count` 是容量、`needsUpdate` 恆真）

- [ ] **步驟 3：改 `tracers.ts`**

`update` 裡把 `if (length <= 0)` 那一支拆成三種：活著就寫並記 `hiLive`；死了且
`wasLive[i] === 0` 就 `continue`（GPU 上本來就是零矩陣）；死了但 `wasLive[i] === 1`
才寫零矩陣。收尾照共通形狀。

- [ ] **步驟 4：跑 tracers 那四條，確認綠**

- [ ] **步驟 5：同樣改 `sparks.ts`、`splash.ts`、`muzzle.ts`（兩個池）**

`sparks` 與 `muzzle` 還有 `instanceColor`，同一套 `touched`／區間／`needsUpdate`
要各記一份（stride 3）。`sparks.step` 的第一支 `if (a >= SPARK_LIFE)` 現在無條件
寫零矩陣，那正是 `wasLive` 要擋掉的。

`reset()` 走全緩衝路徑：`wasLive.fill(0)`、`count = 0`、直接 `needsUpdate = true`
不加區間（沒有區間 three 就整條傳）。

- [ ] **步驟 6：改 `vortex.ts` 的區間**

`writeTrail(trail)` 裡**當場**累積這一條尾跡碰到的頂點區間：

```ts
// 頂點索引 → position 用 ×3、alpha 用 ×1
vLo = Math.min(vLo, v0); vUp = Math.max(vUp, v1)
```

**不要事後掃 `dirty[]`** —— `step` 在「本幀剛清空」那一支寫完零頂點之後立刻
`dirty[t] = 0`，事後掃會漏掉它，症狀是已死的尾跡殘留在畫面上。

`step` 收尾：`position.addUpdateRange(vLo * 3, (vUp - vLo) * 3)`、
`alpha.addUpdateRange(vLo, vUp - vLo)`，每幀開頭重設 vLo/vUp。
`reset()` 那一支不加區間。

- [ ] **步驟 7：跑全套（不含 `perf-gate`／`rematch`）＋ `tsc`**

```
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
```

- [ ] **步驟 8：逐像素驗收**

開 dev server（5173）。`pixel-identical.e2e.ts` 現在把飛機／曳光彈／粒子全關掉，
守不到這幾個池 —— 這一輪要把它們打開。戰況的變因用 `__still` 定格移除：
先連拍兩張同一姿態證明定格下畫面是確定的，再比 before/after。

`PREFIX` 手動改（檔頭寫著這件事）：先 `'before'` 拍一輪，套用改動後改成
`'after'` 再拍一輪，兩批 PNG 逐 byte 比。

- [ ] **步驟 9：量幀時間並提交**

---

## 任務二：天空最後畫

**檔案**
- 改：`src/render/sky.ts`、`src/render/ocean.ts`、`src/main.ts`
- 改測試：`test/unit/sky.test.ts`

**介面**：`export const SKY_RENDER_ORDER = 1000`（`sky.ts`）、
`export const FAR_SEA_RENDER_ORDER = 1`（`ocean.ts`，目前是字面值）。
`main.ts` 匯入前者。

- [ ] **步驟 1：寫紅的測試**（`test/unit/sky.test.ts`）

```ts
it('排在所有不透明物之後、透明物之前', () => {
  const sky = createSky()
  expect(sky.renderOrder).toBe(SKY_RENDER_ORDER)
  expect(SKY_RENDER_ORDER).toBeGreaterThan(PROP_DISC_RENDER_ORDER)
  expect(SKY_RENDER_ORDER).toBeGreaterThan(FAR_SEA_RENDER_ORDER)
  // 材質不是 transparent，所以它留在不透明那一批 —— renderOrder 只在批內排序
  expect((sky.material as ShaderMaterial).transparent).toBe(false)
})

it('深度輸出在遠平面上，不是球面的 40 km', () => {
  const src = (createSky().material as ShaderMaterial).vertexShader
  // 【為什麼非有不可】球半徑 40 km 而遠海半邊 3,000 km。最後畫又開深度測試的
  // 話，天空的深度（約 0.99998）比遠海小，會反過來把遠海蓋掉。
  expect(src).toContain('gl_Position.z = gl_Position.w')
})

it('不寫深度', () => {
  expect((createSky().material as ShaderMaterial).depthWrite).toBe(false)
})
```

- [ ] **步驟 2：跑，確認紅**

- [ ] **步驟 3：改 `sky.ts`**

`VERT` 的 `main` 末端加一行 `gl_Position.z = gl_Position.w;`；
`mesh.renderOrder = SKY_RENDER_ORDER`；材質不動（`depthWrite: false`、
`depthTest` 維持預設的 `true`）。

`SKY_RADIUS` 的註解要改 —— 現在寫著「先畫、不寫深度，所以任何東西都蓋得過它」，
改完之後成立的理由變成「深度輸出在遠平面上，所以任何東西都蓋得過它」。

- [ ] **步驟 4：改 `main.ts`**

`sky: () => byRenderOrder(SKY_RENDER_ORDER)`，並刪掉那段「改那個常數時這裡要
跟著改」的註解 —— 常數共用之後那個縫不存在了。

- [ ] **步驟 5：跑，確認綠；跑全套＋`tsc`**

- [ ] **步驟 6：逐像素驗收**

姿態序列已經跨過地平線（`PITCHES` 有 −3／0／3），**遠海被蓋掉的話會在那三張
炸開**。`HIDE_SKY = false`。任一像素不同就回退這一項並記錄原因。

- [ ] **步驟 7：量幀時間並提交**

---

## 任務三：飛機靜態零件合併（不烘變換的那一批）

**檔案**
- 改：`src/render/geometry/assembly.ts`
- 新：`test/unit/aircraft-merge.test.ts`
- 新：`test/e2e/plane-identical.e2e.ts`、`test/e2e/fixtures/plane-probe.ts`

**介面**：`finish()` 裡新增私有的 `mergeStatic()`，在量完 metrics 之後、組
`AircraftModel` 之前跑。**不匯出、不做行為探測** —— `props` 就在同一個閉包裡。

**可併的判準**（三條全中才併）
1. `mesh.parent === hull` 且局部矩陣是單位矩陣（逐元素比 `mesh.matrix.elements`）。
2. 材質 `transparent === false`。半透明的合併會失去逐物件排序。
3. 不在任何 `props[*].hub` 的子樹裡。`spinner` 有 `rotation.x` 與 `position`，
   本來就被第 1 條擋掉。

**分組鑰匙**：材質物件的身分 ＋ 屬性名稱集合（排序後）＋ 有沒有 index。
`mergeGeometries` 對混用 indexed／non-indexed 會直接回 `null`，所以簽名一定要
進鑰匙。實測四個機種全部是 `normal,position` 的 non-indexed，但鑰匙仍然要帶著
—— 加一個帶 uv 的零件就會踩到。

- [ ] **步驟 1：先寫紅的測試**（`test/unit/aircraft-merge.test.ts`）

```ts
const EXPECTED: Record<string, number> = { p51d: 24, bf109k4: 27, he111: 33, b17g: 38 }

it.each(Object.keys(EXPECTED))('%s 的 mesh 數降到實測值', (id) => {
  const model = buildAircraft({ id } as never)
  let n = 0
  model.group.traverse((o) => { if ((o as Mesh).isMesh) n++ })
  expect(n).toBe(EXPECTED[id]!)
  model.dispose()
})

it('合併不動任何一個世界座標的頂點', () => {
  // 兩份多重集：一份由 buildAircraft 取得，一份由同一個 spec 走「不併」的
  // 路徑取得（測試裡自己拆掉合併：把 hull 的孩子逐個列出來再併回去比）。
  // 判準是 toBe，不是 toBeCloseTo —— 不烘變換的話它們是同一批 float32。
})

it('setPropSpin 仍然有效', () => {
  const model = buildAircraft({ id: 'p51d' } as never)
  model.setPropSpin(1.5, true)
  let disc = 0, hub = 0
  model.group.traverse((o) => {
    if (o.renderOrder === PROP_DISC_RENDER_ORDER && o.visible) disc++
    if (o.rotation.z === 1.5) hub++
  })
  expect(disc).toBe(1)
  expect(hub).toBeGreaterThan(0)
  model.dispose()
})

it('dispose 每一份幾何剛好一次', () => {
  const model = buildAircraft({ id: 'b17g' } as never)
  const seen = new Map<BufferGeometry, number>()
  // 在 dispose 之前掛 'dispose' 監聽，數每一份被呼叫幾次
  model.group.traverse((o) => {
    const g = (o as Mesh).geometry
    if (g) { seen.set(g, 0); g.addEventListener('dispose', () => seen.set(g, seen.get(g)! + 1)) }
  })
  model.dispose()
  for (const n of seen.values()) expect(n).toBe(1)
})
```

「世界座標多重集不變」是這一項的核心：不烘變換的合併必須讓每一個頂點的
float32 位元完全不動。

- [ ] **步驟 2：跑，確認 mesh 數那四條紅（30/31/46/52）**

- [ ] **步驟 3：實作 `mergeStatic()`**

```ts
const mergeStatic = (): void => {
  const moving = new Set<Object3D>()
  for (const p of props) p.hub.traverse((o) => moving.add(o))
  const groups = new Map<string, Mesh[]>()
  for (const child of hull.children) {
    const m = child as Mesh
    if (!m.isMesh || moving.has(m)) continue
    if ((m.material as Material).transparent) continue
    if (!isIdentity(m.matrix)) continue
    const attrs = Object.keys(m.geometry.attributes).sort().join(',')
    const key = `${(m.material as Material).uuid}|${attrs}|${m.geometry.index ? 'i' : 'n'}`
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const merged = mergeGeometries(list.map((m) => m.geometry), false)
    if (!merged) throw new Error('mergeGeometries 回 null：屬性集合不一致')
    for (const m of list) {
      hull.remove(m)
      m.geometry.dispose()
      const at = disposables.indexOf(m.geometry)
      if (at >= 0) disposables.splice(at, 1)
    }
    const mesh = new Mesh(merged, list[0]!.material)
    disposables.push(merged)
    hull.add(mesh)
  }
}
```

`hull.children` 在迴圈中會被改動，所以第一段只收集、第二段才動場景圖。
`isIdentity` 逐元素比 `mesh.matrix.elements`（`finish()` 開頭已經
`updateMatrixWorld(true)` 過）。被併掉的幾何要從 `disposables` 移除，避免二次
dispose。

**順序**：metrics 先算完再併。世界座標不變所以先後都對，但先算 metrics 少一個
要證明的東西。

- [ ] **步驟 4：跑，確認四條綠；跑全套＋`tsc`**

`hitbox.test.ts` 靠 `userData['spinning']` 排除槳葉 —— 那些不在可併範圍裡，
但仍要確認它沒紅。

- [ ] **步驟 5：逐像素驗收（新 fixture）**

`test/e2e/fixtures/plane-probe.ts`：固定燈光（`createLights()`）、固定相機、
單獨一架飛機、`preserveDrawingBuffer`，回傳 PNG 位元組。
`test/e2e/plane-identical.e2e.ts`：四機種 × 六方位（0/60/120/180/240/300°）×
兩俯角（0／−30°）× 兩種槳狀態 = **96 張**。`PREFIX` 一樣手動改。

判準逐 byte。合併前先拍一輪 `before`，再套改動拍 `after`。

- [ ] **步驟 6：量幀時間並提交**

---

## 任務四：量測與 backlog 回填

- [ ] **步驟 1：農地與群島各量一次**

代飛纏鬥、鎖 vsync 與解鎖各一組，三輪取中位數。

- [ ] **步驟 2：重跑 `layer-live.e2e.ts` 的逐層消融**

飛機、曳光彈、渦流三層的絕對成本，與 2026-08-29 那一組對照。

- [ ] **步驟 3：量「烘變換的合併」實際差多少像素**

在一個丟棄用的工作區裡實作烘變換版本（`clone().applyMatrix4(matrixWorld)`，
半透明仍不併），拍同一組 96 張，統計：

```
   有差的張數 / 96
   每張的差異像素數與佔比
   最大單通道差（0～255）
   差異像素是不是全部落在輪廓邊上
```

寫進 `docs/backlog.md`，附上它能多省的 draw call（p51d 24→9 之類）。
**不合併進主線** —— 判準要不要放寬是專案負責人的決定。

- [ ] **步驟 4：回填 backlog 並提交**
