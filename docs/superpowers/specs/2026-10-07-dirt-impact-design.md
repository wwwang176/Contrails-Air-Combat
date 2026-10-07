# 子彈打進地面的土柱（SPEC）

日期：2026-10-07　分支：`feat/dirt-impact`

## 1. 目的

子彈打到地形時噴土柱、土塊與煙塵，取代現在的金屬火星。煙塵在地上留一下，掃射時留下一排落點，玩家照著修正瞄準。

雪地（勒熱夫）噴白色雪粉，夾一部分深色泥土。

音效不在這一份（地形命中目前沒有聲音，維持沒有）。

## 2. 現況

`world/projectileHits.ts` 的陸地分支（`landHitT` 命中）推一筆 `hitEvents`，法線取地表法線。`hitEvents` 的唯一消費者是 `sparks.emit`（`app/battleEventPresentation.ts`），所以打到山、打到地面、打到飛機、船、地面目標、氣球噴的是同一種火星。

## 3. 範圍

| 打到 | 之後 |
|---|---|
| 地形（`landHitT`） | **土柱＋土塊＋煙塵**（本 SPEC） |
| 地形，但落點在河面以下 | 水柱（子彈入水那一套），不噴土 |
| 飛機、船、地面目標、氣球 | 火花，不變 |
| 海面 | 水柱，不變 |

## 4. 配方

展示區（`/tools/dirt.html`）調出、負責人認可的值，寫在 `render/dirtImpact.ts`：

```
DIRT_IMPACT（每一發）
  土塊  5 顆、初速 12 m/s、錐角 38°、尺寸 1
  土柱  4 顆、最快 54 m/s（每顆 0.3～1 倍）、錐角 10°、尺寸 1
  煙塵  1 顆、初速 2 m/s、錐角 70°、尺寸 0.8
  雪夾土 0.35

DIRT_POOL_TUNE（池）
  土塊壽命 1.3 s
  土柱壽命 0.55 s、直徑 1.6 → 3.5 m、阻尼 6 s⁻¹
  煙塵壽命 1.75 s、直徑 2.5 → 8 m、濃度 0.85
```

- 錐軸是世界 +Y，不吃地表法線。
- 顏色（sRGB）：

  | 地表 | 土塊 | 土柱 | 煙塵 | 夾的土塊 |
  |---|---|---|---|---|
  | 土 `soil` | `#3b2a1b` | `#5a4532` | `#b3a38c` | — |
  | 雪 `snow` | `#eef1f4` | `#e6eaee` | `#f2f4f6` | `#3b2a1b` |

- 煙塵開風（`SMOKE_WIND`）、用 `textures/smoke.png` 當不透明度貼圖；土塊與土柱不開風、不用貼圖。
- 一發 10 顆粒子。

## 5. 作法

### 5.1 世界層

- `World` 新增 `terrainHitEvents: ImpactEvents`（與 `hitEvents` 同型、同容量），`ProjectileHitWorld` 一起加。
- `projectileHits.ts` 的陸地分支改推 `terrainHitEvents`，**不再推 `hitEvents`**。內容是命中點＋地表法線，**命中點的高度改取該點的地表高度**（`land.field.sample(x, z)`）。`landHitT` 回傳的是第一個落到地面以下的取樣點：線段的水平長度短於一個取樣步長時，取樣只有兩端，垂直往下打的子彈命中點會在地下數公尺（平地、子步起點 0.1 m、向下 900 m/s、240 Hz 時是 −3.65 m），煙塵整團埋在地面下看不到。水平位置不動。
- 與 `hitEvents` 同一個約定：**呼叫端在物理子步裡排空**。不排空的地方（無頭模擬、工具頁）只會在滿了之後累加 `dropped`，不報錯、不影響判定。
- 其他分支（飛機、船、地面目標、氣球、海面）一行不動。

### 5.2 渲染層：`render/dirtImpact.ts`

- **池建一次，不隨地圖重建**（與 `main.ts` 其他特效池同一個原則）。顏色改成可換：`setDirtSurface(pools, surface)` 改寫各池 `color` 回呼讀的那幾個 `Color`。
- 夾土的那一池（`mixClods`）恆存在，土地上不發射，所以是空的。
- `dirtSurfaceOf(kind: TerrainKind): DirtSurface`：`rzhev` 是 `snow`，其他都是 `soil`。雪地就是用 `winterSteppe` 季節建的地圖（`render/terrain.ts`），目前只有勒熱夫；阿什是 `lateAutumn`，沒有雪。新增冬季地圖時要一起改這一支。
- `emitDirtImpacts(pools, events, cameraX, cameraY, cameraZ, waterAt, riverSplashes)`：
  - 離相機超過 `DIRT_CULL = 1500` m 的不發射。在 1,920 px、65° 視野下，1,500 m 處 1 px 約 0.9 m，煙塵約 9 px、土柱約 4 px，再遠就看不出來了。這是起始值，由試飛裁定。
  - 落點在河面以下（`waterAt(x, z) > y`）時不噴土，改推一筆到 `riverSplashes`，y 取水面高度。
  - 種子是模組層的發射序號，每發加一；`reset` 時歸零。
- 容量：土塊 1024、土柱 512、煙塵 512、夾土 512。一架六挺掃射時的存活數是土塊約 520（雪地上其中約 180 顆在夾土池）、土柱約 180、煙塵約 140，容量是它的兩倍以上。滿了就覆蓋最舊的（`createParticles` 的既有行為），被蓋掉的是快燒完的那幾顆。

### 5.3 接線（`main.ts`、`app/`）

- `main.ts`：建池、加進場景、加進 `POOLS`（換場歸零）。`buildBattleTerrain` 時呼叫 `setDirtSurface(pools, dirtSurfaceOf(kind))`。
- `battleEventPresentation.ts`：`sparks.emit` 之後呼叫 `emitDirtImpacts`；`riverSplashes` 交給 `splashes.emit`，高度函數用 `terrain.waterAt`；兩份事件都在這裡排空。
- `effectStepper.ts`：四池在 `worldSeconds` 步進，與火花相同。
- `tools/range.ts`：只多一行排空 `terrainHitEvents`（靶場是海，正常不會有）。
- 展示區 `tools/dirt.html` 保留，之後調值用。

## 6. 效能

- 多 4 個 `InstancedMesh`，也就是 4 個 draw call。
- **固定成本跟著容量走，不是存活數**：`createParticles.step` 每幀掃完整容量（死格只做一次比較），GPU 每幀畫滿容量的實例（死格縮放為 0）。四池合計 2,560 格，土地上空著的夾土池也算在內。
- 存活量：一架六挺掃射每秒約 80 發落地，同時在場約 840 顆（土塊含夾土約 520、土柱約 180、煙塵約 140）。上傳量大致跟著存活數走（分段上傳；超過兩段時退回一整段）。
- 量測：德 M4（勒熱夫）與盟 M2（洛伊納）各掃射一輪，**同頁 A/B**（同一頁、同一輪掃射，切換四池的 `visible`），GPU 用 timer query；CPU 用 performance trace 看 `step` 與 `emit` 的自身時間。數字交給負責人。

## 7. 不做

- 音效。
- 依座標分地表（沙灘、岩石、道路）。目前每張地圖只有一種地表，`archipelago`、`leyte` 的島也用 `soil`。
- 選單短片的射擊（`reelGunnery`）不動。
- 地面戰的砲彈落點（`groundShellPool`）不動。

## 8. 測試

只測小部件，不跑整關。

- `projectileHits`：子彈打到陸地時 `terrainHitEvents` 加一、`hitEvents` 不變。打到飛機、船、地面目標仍推 `hitEvents`（既有測試照跑）。
- `projectileHits`：垂直往下打進平地（起點 0.1 m、900 m/s、240 Hz），事件高度等於地表高度。`projectile-terrain.test.ts` 與 `terrain-occlusion.test.ts` 目前用 `hitEvents` 數陸地命中，要改成數 `terrainHitEvents`。
- `dirtSurfaceOf`：`rzhev` 是 `snow`，其他都是 `soil`。
- `emitDirtImpact`：每發各池的顆數等於配方；土地上 `mixClods` 恆為 0；雪地上大量取樣後，夾土比例接近 `mixRatio`，而且同一個種子每次結果一樣。
- `setDirtSurface`：換地表之後顏色改變、池物件不變（沒有重建）。
- `emitDirtImpacts`：超過 `DIRT_CULL` 的不發射；落點在河面以下的推 `riverSplashes`，不發射土。
- `battle-event-presentation.test.ts`（擴充既有那一條）：`terrainHitEvents` 在同一個子步交給土柱；土柱推出的河面水柱在同一個子步交給 `splashes.emit`，高度函數是這一次傳進來的 `terrain.waterAt`；兩份事件都排空，下一個子步不重播。
- `pool-reset-entrypoints.test.ts`：土柱各池在 `POOLS` 裡。
- 每一條護欄都要做變異測試驗紅。

## 9. 驗收

- Playwright：德 M4 與一張土地圖各掃射一輪，截圖確認有土柱、沒有火星；打到地面目標仍是火星。
- 第 6 節的效能數字。
- 手感由負責人試飛判斷。
