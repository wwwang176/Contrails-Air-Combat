# 子彈打進地面的土柱（PLAN）

SPEC：`docs/superpowers/specs/2026-10-07-dirt-impact-design.md`　分支：`feat/dirt-impact`

開工前量一次 `npx tsc --noEmit` 的錯誤數當基準；每一步完成後只跑相關測試（`--maxWorkers=4 --minWorkers=1`）。每一條新護欄都要做變異驗紅，改回來用編輯工具。

## 步驟 1　世界層：`terrainHitEvents`

**先紅**
- `test/unit/projectile-terrain.test.ts`：`fireOne` 多數一個 `terrain`（`w.terrainHitEvents.count`，同樣排空）。「往高台裡飛」那一條改成斷言 `terrain === 1`、`hits === 0`。其他斷言 `hits` 的陸地案例同樣改。
- `test/integration/terrain-occlusion.test.ts`：`sparks` 改數 `terrainHitEvents`，`dropped` 讀 `terrainHitEvents.dropped`。
- 打到飛機、船、地面目標的既有測試不動，它們守的是「仍推 `hitEvents`」。
- `projectile-terrain.test.ts` 新增一條：平地（高度 0，`landAbove: -Infinity` —— 既有 `plateau(0)` 的 `landAbove: 0` 不會命中）、起點 y = 0.1、速度 (0, −900, 0)、`DT` 一步。先斷言 `terrainHitEvents.count === 1`，再斷言事件 y 等於 0（`toBeCloseTo`）—— 沒有事件時陣列初值也是 0。

**實作**
- `World`：`readonly terrainHitEvents: ImpactEvents = createImpacts()`，註解寫它的消費者與排空約定。
- `ProjectileHitWorld` 加這個欄位。
- `projectileHits.ts` 陸地分支：`pushImpact(world.hitEvents, …)` 換成 `world.terrainHitEvents`；`hy` 改成 `land.field.sample(hx, hz)`，註解寫為什麼（`landHitT` 回的是第一個地下取樣點）。

**變異**：把陸地分支改回推 `hitEvents`，兩支測試要紅；`hy` 改回線段內插，平地那一條要紅。

## 步驟 2　`render/dirtImpact.ts`：遊戲用的介面

把展示區用的「每換地表就重建」改成建一次：

```ts
export interface DirtImpacts {
  readonly pools: DirtPools                  // 四個 Particles；場景加 .object、測試讀 .live
  readonly params: MutableDirtParams         // 每一發的配方，emit 讀它；展示區直接改
  setSurface(s: DirtSurface): void           // 只改顏色
  emit(events: ImpactEvents, camX, camY, camZ, waterAt, riverSplashes): void
  step(dt: number): void
  reset(): void                              // 池歸零、種子歸零
  dispose(): void
}
export function createDirtImpacts(tune?, dustTex?): DirtImpacts
export function dirtSurfaceOf(kind: TerrainKind): DirtSurface
export const DIRT_CULL = 1500
```

- 四池恆存在（`mixClods` 在土地上不發射）。容量：土塊 1024、土柱 512、煙塵 512、夾土 512（展示區沿用同一組）。顏色由模組內幾個 `Color` 持有，`color` 回呼讀它們；`setSurface` 改寫這幾個 `Color`。
- `emit` 每筆：距離平方 > `DIRT_CULL²` 跳過；`waterAt(x, z) > y` 推 `riverSplashes`（y 取水面）；其餘 `emitDirtImpact(…, seed++)`。
- `emitDirtImpact`、`DIRT_IMPACT`、`DIRT_POOL_TUNE`、`DIRT_COLORS` 保留。`createDirtPools`／`dirtPoolList` 收進模組內部。

**先紅**（新檔 `test/unit/dirt-impact.test.ts`，用真的 `createParticles`，讀 `pools.*.live` 與 `instanceColor`；取樣量都在容量以內）
1. 土地一發：土塊 5、土柱 4、煙塵 1、夾土 0。
2. 雪地 80 發（土塊＋夾土 400 顆、土柱 320、煙塵 80，都不滿）：夾土比例在 `mixRatio ± 0.08`。
3. 決定性與種子歸零：同一個實例發 80 發記下夾土數 → `reset` → 再發同一串 → 夾土數相同；另建一個新實例發同一串也相同。（種子不歸零時第二輪用的是 80 之後的種子，夾土數不同 —— 變異時確認。）
4. `setSurface('snow')`：`pools` 裡是同一批物件；發射並 `step` 之後，土柱的實例顏色是雪的顏色。
5. 相機在 1,501 m 外不發射；1,499 m 有發射。
6. `waterAt` 回 `y + 1`：`riverSplashes` 多一筆、y 等於水面，四池都是 0。
7. `dirtSurfaceOf`：`rzhev` 是 `snow`，其他每一種 `TerrainKind` 都是 `soil`。

**變異**：拿掉剔除、拿掉河面判斷、`setSurface` 不改顏色、夾土條件反轉、`reset` 不歸零種子，對應的測試各自要紅。

## 步驟 3　接線

- `app/battleEventPresentation.ts`：`BattleEventSinks` 加 `dirt: Pick<DirtImpacts, 'emit'>`；`sparks.emit` 之後呼叫 `dirt.emit(world.terrainHitEvents, 相機, terrain.waterAt, riverSplashes)`，接著 `splashes.emit(riverSplashes, terrain.waterAt, elapsed)`；兩份都排空。`riverSplashes` 在 `createBattleEventPresentation` 裡建一次。`EventWorld` 加 `terrainHitEvents`。
- `test/unit/battle-event-presentation.test.ts`（擴充既有那一條）：deps 加 `dirt`，它的 `emit` 是假的：記下 `dirt:<count>`，並依收到的事件數往 `riverSplashes` 推同樣筆數（事件排空之後第二個子步推 0 筆）。推一筆 `terrainHitEvents` 之後斷言：
  - 順序多一格 `dirt:1`；
  - `splashes.emit` 在同一個子步收到 `riverSplashes`（count 1），第二個參數是這一次傳進來的 `terrain.waterAt`（同一個函數物件）；
  - `terrainHitEvents` 與 `riverSplashes` 都排空，下一個子步不重播。

  **變異**：刪掉 `clearImpacts(world.terrainHitEvents)`、刪掉 `splashes.emit(riverSplashes, …)`、高度函數改傳 `heightAt`，各自要紅。
- `render/effectStepper.ts`：`EffectStepPools` 加 `dirt: StepEffect`，在 `sparks.step` 旁邊 `dirt.step(worldSeconds)`。`test/unit/effect-stepper.test.ts` 的 `deps` 加 `dirt`，並斷言它被推。
- `main.ts`：`const dirt = createDirtImpacts(undefined, smokeTexture)`，四池的 `object` 加進場景；`dirt` 加進 `POOLS`；`createEffectStepper` 與 `createBattleEventPresentation` 傳 `dirt`；`buildBattleTerrain` 在換完地形後 `dirt.setSurface(dirtSurfaceOf(terrainKind))`。
- `test/unit/pool-reset-entrypoints.test.ts`：清單加 `'dirt'`（`dirt.step(` 由既有那一條守）。
- `tools/range.ts`：排空 `terrainHitEvents`。

## 步驟 4　展示區改走同一個介面

`src/tools/dirt.ts` 改用 `createDirtImpacts`：滑桿改 `impacts.params`；換地表呼叫 `setSurface`；改池參數時 `dispose` 再建（新實例沿用目前的 `params` 與地表）。展示區看到的就是遊戲那一份。

## 步驟 5　驗收

- `npx tsc --noEmit` 錯誤數不增加。
- 跑相關測試：`projectile-terrain`、`terrain-occlusion`、`dirt-impact`、`battle-event-presentation`、`effect-stepper`、`pool-reset-entrypoints`、`world`、`ground-targets`、`damage`、`i18n-guard`。
- Codex 審實作。
- 瀏覽器：`main.ts` 加一個量測出口 `__dirt`：
  - `strafe(n, x?, z?)`：從自機位置往 (x, z) 的地面射 `n` 發（省略時是機首前方 400 m），走真正的彈丸 → `projectileHits` → 事件 → 渲染那條路。
  - `visible(on)`：四池的 `object.visible`，同頁 A/B 用。
- 德 M4（勒熱夫）與盟 M2（洛伊納）各打一輪截圖，確認是土柱不是火星；對準一個地面目標打一輪，確認仍是火星。
- 效能：同一頁、同一輪掃射，切 `visible` 開關，GPU 用 timer query；CPU 用 performance trace 看 `dirt.step` 與 `emit` 的自身時間。數字交給負責人。
- commit（只 commit，不 push），交給負責人試玩。
