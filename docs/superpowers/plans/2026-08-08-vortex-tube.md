# 凝結尾改用掃掠管 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把翼尖凝結尾從廣告板粒子換成掃掠管，讓它真的是連續的。

**Architecture:** `src/render/vortex.ts` 的**判準與狀態機不動**（`intensity`、
`carry` 餘數累積、`seen` 第一幀、`MAX_STEP`、`seats`），換掉的是「畫成什麼」——
從 `createParticles` 的廣告板池改成一個自有的掃掠管幾何。`main.ts` 的介面
（`emit(index, loadFactor, 六個座標)` / `step` / `reset` / `object`）一個字都不改。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess`）、three.js、vitest。

**Spec:** `docs/superpowers/specs/2026-08-08-battlefield-visuals-design.md` §13
（§13 取代 §5.2 與 §5.3 的粒子做法；§5.1 / §5.5 / §5.6 / §8.6 沿用）

## Global Constraints

- 註解、測試名稱、commit message 一律**繁體中文**。
- **絕不 `git add -A`**（`bash.exe.stackdump` 是被追蹤且已改過的檔案）。
- **不得引入 `@types/node`**（不可用 `node:path`、`__dirname`、`process`、`fs`）。
- `noUncheckedIndexedAccess` 開著，**`Float32Array` / `Uint8Array` / `Uint32Array` 的索引一樣要處理**。
- `noUnusedLocals` / `noUnusedParameters` 開著。
- `src/render/vortex.ts` **不得** import `src/battle/`、`src/ai/`、`src/hud/`。
- **熱路徑不得配置**（每幀跑到的程式碼不得 `new`、不得建陣列字面量、不得建閉包）。
- **絕不為了讓測試變綠而放寬門檻。** 每一條新測試都要先驗證它是紅的。
- 含中文的 commit message 一律寫進 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`。
- 型別檢查是 `npx tsc --noEmit`（**沒有** `npm run typecheck`）。
- `perf-gate` 與 `rematch.test.ts` 必須**單獨跑**，而且**跑之前要先關掉 dev server**。
- 參數的重新定值是**專案負責人**的決定 —— 紅了要先量、先報告、先問。

---

### Task 1：掃掠管的幾何原語（純函數）

**Files:**
- Create: `src/render/tube.ts`
- Test: `test/unit/tube.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function ringBasis(
    dx: number, dy: number, dz: number,
    out: { ax: number, ay: number, az: number, bx: number, by: number, bz: number },
  ): void
  export function tubeIndices(trails: number, nodes: number, sides: number): Uint32Array
  export const TUBE_VERTEX_COUNT: (trails: number, nodes: number, sides: number) => number
  ```

**為什麼先做這一個**：索引緩衝與環的基底是整件事唯一「算錯了會整個爛掉、
而且看得出來是算錯」的部分，而它們都是純函數 —— 先把它們釘死，後面的
組裝就只是搬資料。

- [ ] **Step 1: 寫會紅的測試**

`test/unit/tube.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { ringBasis, tubeIndices, tubeVertexCount } from '../../src/render/tube'

const B = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 }

describe('ringBasis', () => {
  /**
   * 【它算什麼】給一段方向，回傳兩個與它垂直、而且彼此垂直的單位向量 ——
   * 環上的頂點就是 `cos θ · a + sin θ · b`。
   *
   * 【為什麼不做平行搬運】管身會沿著扭轉，但它是無光照的單色半透明管，
   * 扭轉看不出來（spec §13.5）。這裡只要求「垂直、單位長」。
   */
  for (const [name, d] of [
    ['沿 X', [1, 0, 0]], ['沿 Y', [0, 1, 0]], ['沿 Z', [0, 0, 1]],
    ['斜的', [0.3, -0.9, 0.31]], ['很長的', [300, -900, 310]],
  ] as const) {
    it(`${name}：兩軸都與方向垂直、彼此垂直、且是單位長`, () => {
      ringBasis(d[0], d[1], d[2], B)
      const dir = new Vector3(d[0], d[1], d[2]).normalize()
      const a = new Vector3(B.ax, B.ay, B.az)
      const b = new Vector3(B.bx, B.by, B.bz)
      expect(a.length()).toBeCloseTo(1, 6)
      expect(b.length()).toBeCloseTo(1, 6)
      expect(a.dot(dir)).toBeCloseTo(0, 6)
      expect(b.dot(dir)).toBeCloseTo(0, 6)
      expect(a.dot(b)).toBeCloseTo(0, 6)
    })
  }

  /**
   * 【零向量必須有定義】兩個節點在同一個位置時（退化環，見 spec §13.5）
   * 方向是零向量。回傳 NaN 的話整條管子會消失 —— 而那是「斷開處」才會
   * 發生的事，最難察覺。
   */
  it('零向量回傳一組合法的基底，不是 NaN', () => {
    ringBasis(0, 0, 0, B)
    for (const v of [B.ax, B.ay, B.az, B.bx, B.by, B.bz]) expect(Number.isFinite(v)).toBe(true)
    expect(new Vector3(B.ax, B.ay, B.az).length()).toBeCloseTo(1, 6)
    expect(new Vector3(B.bx, B.by, B.bz).length()).toBeCloseTo(1, 6)
  })

  it('熱路徑不配置：同一個 out 反覆使用不會累積', () => {
    ringBasis(1, 0, 0, B)
    const first = [B.ax, B.ay, B.az]
    ringBasis(1, 0, 0, B)
    expect([B.ax, B.ay, B.az]).toEqual(first)
  })
})

describe('tubeVertexCount', () => {
  it('是 條數 × 環數 × 邊數', () => {
    expect(tubeVertexCount(3, 5, 4)).toBe(60)
  })
})

describe('tubeIndices', () => {
  /**
   * 【索引建一次就不動】管子畫好之後不會移動（粒子的發射速度本來就是 0），
   * 所以每一條尾跡在共用幾何裡擁有固定的一段，環 i 與 i+1 之間一圈四邊形。
   */
  it('三角形數是 條數 × (環數−1) × 邊數 × 2', () => {
    const idx = tubeIndices(3, 5, 4)
    expect(idx.length).toBe(3 * 4 * 4 * 2 * 3)
  })

  it('每一個索引都落在頂點範圍內', () => {
    const [trails, nodes, sides] = [3, 5, 4]
    const idx = tubeIndices(trails, nodes, sides)
    const max = tubeVertexCount(trails, nodes, sides)
    for (const i of idx) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(max)
    }
  })

  /**
   * 【不可以跨越尾跡的邊界】第 0 條的最後一環若接到第 1 條的第一環，就會
   * 出現一條橫跨兩架飛機的管子。這條檢查每一個三角形的三個頂點都落在
   * 同一條尾跡的範圍內。
   */
  it('沒有任何三角形跨越兩條尾跡', () => {
    const [trails, nodes, sides] = [3, 5, 4]
    const per = nodes * sides
    const idx = tubeIndices(trails, nodes, sides)
    for (let t = 0; t < idx.length; t += 3) {
      const a = Math.floor(idx[t]! / per)
      const b = Math.floor(idx[t + 1]! / per)
      const c = Math.floor(idx[t + 2]! / per)
      expect(b).toBe(a)
      expect(c).toBe(a)
    }
  })

  /**
   * 【每一環都要真的被縫起來】只檢查範圍的話，一個「全部指向頂點 0」的
   * 索引緩衝也會過。這條確認第 0 條的每一個相鄰環對都出現過。
   */
  it('每一對相鄰環都有三角形接起來', () => {
    const [nodes, sides] = [5, 4]
    const idx = tubeIndices(1, nodes, sides)
    const bands = new Set<number>()
    for (let t = 0; t < idx.length; t += 3) {
      const rings = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((v) => Math.floor(v / sides))
      bands.add(Math.min(...rings))
    }
    for (let i = 0; i < nodes - 1; i++) expect(bands.has(i)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認它紅**

```
npx vitest run test/unit/tube.test.ts
```
預期：整檔紅在 `src/render/tube.ts` 不存在。

- [ ] **Step 3: 實作 `src/render/tube.ts`**

```ts
/**
 * 掃掠管的幾何原語。**不知道凝結尾的存在** —— 它只管「一串點怎麼變成管」。
 *
 * 【為什麼獨立成檔】索引緩衝與環的基底是整件事唯一「算錯了會整個爛掉」的
 * 部分，而它們都是純函數。抽出來才測得到 —— `vortex.ts` 的其餘部分要嘛是
 * 狀態機（已經有測試），要嘛是 `BufferAttribute` 的搬運。
 */

/** 環的基底：兩個彼此垂直、且都與管軸垂直的單位向量。 */
export interface RingBasis {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
}

/**
 * 由管軸方向算出環的基底。**熱路徑：寫進 `out`，不配置。**
 *
 * 【不做平行搬運】管身會沿著扭轉，但它是無光照的單色半透明管，扭轉看不
 * 出來（spec §13.5）。平行搬運要多存上一環的基底、還要處理第一環的初始化，
 * 換不到任何看得見的差別。
 *
 * 【零向量要有定義】兩個節點在同一個位置時（斷開處的退化環）方向是零向量。
 * 回傳 NaN 的話整條管子會消失，而那正是最難察覺的情形。
 */
export function ringBasis(dx: number, dy: number, dz: number, out: RingBasis): void {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  // 零向量：任選一組正交基底。方向本身沒有意義（環會塌成一點）
  const ux = len > 1e-9 ? dx / len : 1
  const uy = len > 1e-9 ? dy / len : 0
  const uz = len > 1e-9 ? dz / len : 0
  // 【參考向量要挑與 u 最不平行的那一軸】固定用 (0,1,0) 的話，管軸剛好
  // 垂直向上時叉積是零向量 —— 而爬升與俯衝正好是那個方向
  const ax0 = Math.abs(ux)
  const ay0 = Math.abs(uy)
  const az0 = Math.abs(uz)
  let rx = 0, ry = 0, rz = 0
  if (ax0 <= ay0 && ax0 <= az0) rx = 1
  else if (ay0 <= az0) ry = 1
  else rz = 1
  // a = normalize(u × r)
  let axv = uy * rz - uz * ry
  let ayv = uz * rx - ux * rz
  let azv = ux * ry - uy * rx
  const al = Math.sqrt(axv * axv + ayv * ayv + azv * azv)
  axv /= al; ayv /= al; azv /= al
  out.ax = axv; out.ay = ayv; out.az = azv
  // b = u × a（兩者都是單位長且垂直，叉積自然是單位長）
  out.bx = uy * azv - uz * ayv
  out.by = uz * axv - ux * azv
  out.bz = ux * ayv - uy * axv
}

export function tubeVertexCount(trails: number, nodes: number, sides: number): number {
  return trails * nodes * sides
}

/**
 * 索引緩衝。**建一次就不動** —— 管子畫好之後不會移動。
 *
 * 每一條尾跡擁有 `nodes × sides` 個連續頂點；環 `i` 與 `i+1` 之間一圈四邊形。
 * 三角形一律落在同一條尾跡之內 —— 跨過去的話會出現一條橫跨兩架飛機的管子。
 */
export function tubeIndices(trails: number, nodes: number, sides: number): Uint32Array {
  const quads = trails * (nodes - 1) * sides
  const idx = new Uint32Array(quads * 6)
  let k = 0
  for (let t = 0; t < trails; t++) {
    const base = t * nodes * sides
    for (let i = 0; i < nodes - 1; i++) {
      const r0 = base + i * sides
      const r1 = r0 + sides
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides
        idx[k++] = r0 + s
        idx[k++] = r1 + s
        idx[k++] = r1 + s1
        idx[k++] = r0 + s
        idx[k++] = r1 + s1
        idx[k++] = r0 + s1
      }
    }
  }
  return idx
}
```

- [ ] **Step 4: 跑測試確認它綠 + 型別檢查**

```
npx vitest run test/unit/tube.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 掃掠管的幾何原語（環的基底與索引緩衝）

凝結尾要從廣告板粒子換成掃掠管（spec §13）。這一個 commit 只做兩個純函數，
它們是整件事唯一「算錯了會整個爛掉」的部分。

ringBasis 的參考向量挑「與管軸最不平行的那一軸」而不是固定用 (0,1,0)ct
—— 固定的話管軸垂直向上時叉積是零向量，而爬升與俯衝正好是那個方向。
零向量方向也有定義（斷開處的退化環會餵它零向量），回 NaN 的話整條管子會
消失，而那是最難察覺的情形。

tubeIndices 建一次就不動：管子畫好之後不會移動（粒子的發射速度本來就是 0）。
測試除了範圍檢查，還守兩件事：沒有任何三角形跨越兩條尾跡（跨過去會出現一條
橫跨兩架飛機的管子）、以及每一對相鄰環都真的被縫起來（只檢查範圍的話，
一個「全部指向頂點 0」的索引緩衝也會過）。
EOF
git add src/render/tube.ts test/unit/tube.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 2：`vortex.ts` 換掉繪製層

**Files:**
- Modify: `src/render/vortex.ts`
- Modify: `test/unit/vortex.test.ts`
- Modify: `test/unit/pool-reset.test.ts`

**Interfaces:**
- Consumes: `ringBasis` / `tubeIndices` / `tubeVertexCount`（Task 1）
- Produces: `Vortex` 介面**不變**（`object` / `live` / `emit` / `step` / `reset` / `dispose`）；
  `object` 的型別從 `InstancedMesh` 變成 `Mesh`。新常數見 spec §13.8。
  移除：`vortexSpacing`、`vortexSizeScale`、`VORTEX_SPACING_MIN/MAX`、
  `VORTEX_SIZE_*`、`VORTEX_LIFE_JITTER`、`VORTEX_ALPHA`、`VORTEX_DRAG`、
  `VORTEX_CAPACITY`。

**這一步保留什麼**：`vortexIntensity`、`vortexEmitCount`（改吃常數間隔）、
`carry`、`seen`、`prev`、`VORTEX_G_ON/FULL`、`VORTEX_MAX_STEP`、`VORTEX_SEATS`。
`test/unit/vortex.test.ts` 裡與這些有關的**十六條測試原封不動**。

- [ ] **Step 1: 先改測試（會紅）**

`test/unit/vortex.test.ts`：

1. **刪掉** `vortexSpacing` / `vortexSizeScale` 那兩個 `describe`（共 5 條）——
   它們測的東西已經不存在。**不是放寬，是移除已刪除的 API。**
2. `vortexEmitCount` 的三條改成吃常數間隔：
   ```ts
   expect(vortexEmitCount(TRAIL_NODE_SPACING - 0.1)).toBe(0)
   expect(vortexEmitCount(TRAIL_NODE_SPACING * 3)).toBe(3)
   expect(vortexEmitCount(TRAIL_NODE_SPACING * 1000)).toBe(VORTEX_MAX_PER_FRAME)
   ```
3. **有狀態的那十條全部把位移換算成新的間隔。** 舊測試用 `tips(20)`
   （20 m，對 1.857 m 的間隔是 10 節點）；新間隔是 8 m，20 m 只有 2 節點。
   把每一條的距離改成 `TRAIL_NODE_SPACING` 的倍數，並重算期望值。
   **每一條的期望值都要先用 node 原型算過**（見下方 Step 2）。
4. `live` 的語意改成「目前有幾個節點」（不再是粒子數）。介面註解要跟著改。
5. 新增兩條：
   ```ts
   it('斷開時推入兩個退化節點（alpha 0、半徑 0）', ...)
   it('每一條尾跡的節點數不超過 TRAIL_NODES', ...)
   ```

- [ ] **Step 2: 用 node 原型把每一條的期望值算出來**

**不要用猜的。** 照 §13 的規則寫一個 30 行的 JS 原型（`$CLAUDE_JOB_DIR/tmp/`
底下，不進 repo），把每一條測試的輸入餵進去，印出節點數。前一份 spec 的
`carry` 修正就是這樣驗的，而且抓到過寫死的錯誤期望值。

- [ ] **Step 3: 跑測試確認它紅**

```
npx vitest run test/unit/vortex.test.ts
```
預期：紅在被刪掉的 API 與新常數不存在。

- [ ] **Step 4: 實作**

`src/render/vortex.ts` 的改法：

**保留不動**：`VORTEX_G_ON`、`VORTEX_G_FULL`、`VORTEX_MAX_PER_FRAME`、
`VORTEX_MAX_STEP`、`VORTEX_SEATS`、`vortexIntensity`、`prev` / `seen` /
`carry` 的整套邏輯與 `emit` 的守衛順序。

**新常數**（值見 spec §13.8）：
```ts
export const TRAIL_NODE_SPACING = 8
export const TRAIL_NODES = 40
export const TRAIL_SIDES = 4
export const TRAIL_LIFE = 1.4
export const TRAIL_RADIUS_FROM = 0.6
export const TRAIL_RADIUS_TO = 2.0
export const TRAIL_ALPHA = 0.55
```

**`vortexEmitCount` 改吃常數間隔**：
```ts
export function vortexEmitCount(travelled: number): number {
  return Math.min(Math.floor(travelled / TRAIL_NODE_SPACING), VORTEX_MAX_PER_FRAME)
}
```

**每條尾跡的節點資料**（模組內，`Float32Array`，以 `trail × TRAIL_NODES` 定址）：
```
nx / ny / nz   節點位置
nAge           節點年齡，s（`step` 每幀加 dt）
nAlpha0        生成當下的 intensity × TRAIL_ALPHA（0 = 退化節點）
nCount[trail]  這一條目前有幾個節點（上限 TRAIL_NODES）
nHead[trail]   環形緩衝的頭
```

**加節點**（`pushNode`）：滿了就覆蓋最舊的（環形緩衝，與 `particles.ts` 的
覆蓋策略一致 —— 尾跡的尾端先消失）。

**斷開**（`intensity` 掉到 0、位移超過 `MAX_STEP`、`seen` 為 0、`reset` 之後）：
下一次加節點前先推入**兩個** `alpha0 = 0` 的節點，一個在舊尾巴位置、
一個在新位置（spec §13.5）。用一個 `broken: Uint8Array(trails)` 旗標記錄
「下一個節點是新的一段」。

**`step(dt)`**：
1. 所有節點 `nAge += dt`；`nAge >= TRAIL_LIFE` 的從尾端退休（`nCount--`）。
2. 重寫**活著的**尾跡的頂點：對每一條，依「最舊 → 最新」走訪節點，
   - 方向 = 下一個節點 − 上一個節點（端點用單側差分）
   - `ringBasis(方向, BASIS)`（`BASIS` 是模組層暫存）
   - `radius = TRAIL_RADIUS_FROM + (TRAIL_RADIUS_TO − TRAIL_RADIUS_FROM) × age / TRAIL_LIFE`
   - `alpha = nAlpha0 × (1 − age / TRAIL_LIFE)`
   - 寫 `TRAIL_SIDES` 個頂點：`p + radius × (cos θ · a + sin θ · b)`
   - **`cos` / `sin` 預先算好**（`TRAIL_SIDES` 是常數，開一個模組層的表）
   - 沒用到的環（`nCount` 之外的）：全部塌到第一個節點的位置、alpha 0
3. `position.needsUpdate = true`、`aAlpha.needsUpdate = true`。

**材質**：
```ts
const material = new MeshBasicMaterial({
  color: 0xeef4f8, transparent: true, depthWrite: false, side: DoubleSide,
})
material.onBeforeCompile = injectVertexAlpha
```
`injectVertexAlpha` 是本檔私有的注入（**不共用 `particles.ts` 的
`injectBillboard`** —— 那邊還要做廣告板，這邊不用）：在
`#include <common>` 加 `attribute float aAlpha; varying float vAlpha;`，
在 `#include <project_vertex>` 前設 `vAlpha = aAlpha;`，在
`#include <dithering_fragment>` 之後 `gl_FragColor.a *= vAlpha;`。

**與 `particles.ts` 同樣的兩個坑**：
- `object.frustumCulled = false`（包圍球是建立時算的，全部在原點）。
- 用 `String.replace` 注入，找不到目標**不會報錯** —— 所以要有一條測試
  拿 three 真正的 `ShaderLib.basic` 去斷言注入確實發生了（`particles.ts`
  的 `injectBillboard` 就有，照抄那個做法）。

- [ ] **Step 5: 跑測試確認它綠 + 型別檢查**

```
npx vitest run test/unit/vortex.test.ts test/unit/pool-reset.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: 提交**（訊息略，照前面的格式：現象 → 成因 → 處置 → 取捨）

---

### Task 3：接線、護欄、回歸、驗收

**Files:**
- Modify: `src/main.ts`（只有一行：`vortex.object` 的型別跟著變，若有型別註記）
- Test: `test/integration/vortex-neutrality.test.ts`（不改，重跑）
- Test: `test/e2e/battlefield-visuals.e2e.ts`（不改，重跑）
- Modify: `docs/superpowers/specs/2026-08-08-battlefield-visuals-design.md`（§14 回填）

- [ ] **Step 1: 確認 `main.ts` 不用改**

`vortex.object` 加進場景的那一行吃的是 `Object3D`，`Mesh` 與 `InstancedMesh`
都可以。若 `tsc` 沒紅就是不用改 —— **不要為了「看起來一致」去動它**。

- [ ] **Step 2: 護欄重跑**

```
npx vitest run test/integration/vortex-neutrality.test.ts
```
預期綠。**它的兩個實驗不必重做** —— 那驗的是「斷言本身有沒有靈敏度」，
與畫成什麼無關（結果記在該檔檔頭）。

- [ ] **Step 3: 全套回歸**

```
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"
```
預期：無**新增**紅燈。已知既有紅燈一條（`ai-command-tactics` 的側翼方位角）。

**跑之前先關掉 dev server。** 然後單獨跑：
```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

- [ ] **Step 4: Playwright**

```
npm run dev                                            # 終端機一
npx vite-node test/e2e/battlefield-visuals.e2e.ts      # 終端機二
```
斷言是 console 錯誤 0 則。**新的著色器注入正是這條會抓到的東西** ——
`String.replace` 找不到目標時不報錯，但編出來的著色器會缺 `aAlpha`，
WebGL 會噴 warning。

順便看 `vis-3-high.png` 的 `triangles` 數字：粒子池的 12,288 應該被
掃掠管的 39,936 取代，總數約 +28k。

- [ ] **Step 5: 回填 spec §14**

寫下：實測的三角形數與 FPS、每一條測試期望值的原型計算結果、任何與 §13
不符的地方。**§13.8 的七個參數原樣保留待試飛** —— 那是專案負責人的事。

- [ ] **Step 6: 提交**

---

## 完成後

`npm run dev`，請專案負責人看四件事：

1. **管子連不連續**（這一整份的理由）。
2. **透明度有沒有代表強度** —— 3 g 淡、6.5 g 白。
3. **粗細對不對**（`TRAIL_RADIUS_FROM` 0.6 / `TRAIL_RADIUS_TO` 2.0）。
4. **從正後方看是不是還是管** —— 追尾視角看自己的翼尖。那是選真管而不是
   緞帶的唯一理由，沒驗到就等於沒選。

**不要自行調整 §13.8 的任何參數。** 紅了或看起來不對，先量、先報告、先問。
