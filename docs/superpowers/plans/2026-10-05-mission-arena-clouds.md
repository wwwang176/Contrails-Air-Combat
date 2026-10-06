# 任務戰場邊界與雲場（PLAN）

SPEC：`docs/superpowers/specs/2026-10-05-mission-arena-clouds-design.md`

每一步先寫會紅的測試、再改程式；`npx tsc --noEmit` 的錯誤行數不得比動工前（0）多。只跑相關測試，整套留到合併前（`--maxWorkers=4 --minWorkers=1`）。

## 1. 邊界可以不在原點（`world/arena.ts`）

1. 測試 `test/unit/arena.test.ts`（既有檔則增補）：
   - `SKIRMISH_ARENA` 是 (0, 0, 12000)。
   - `stepArena(s, { x: 5000, z: -3000, radius: 10000 }, …)`：(5000, 1000, −3000 + 9999) 界內、(5000, 1000, −3000 + 10001) 界外；原點 (0, 0, 0) 在這個界內（距離 5.83 km）；(−6000, 1000, −3000) 界外。
   - 高度超過 `ARENA_CEILING` 仍是界外；倒數與 `expired` 的單向性照舊。
2. 實作：`ArenaBounds`、`SKIRMISH_ARENA`、`ARENA_MIN_RADIUS`；`stepArena` 多一個 `bounds` 參數；刪 `ARENA_RADIUS`，引用處改用 `SKIRMISH_ARENA.radius`。
3. 改檔頭與相關註解（SPEC §2.3 最後一條）。

## 2. 任務卡帶邊界（`battle/missions/*`）

1. `MissionBattle` 加 `readonly arena: ArenaBounds`（必填）。
2. 測試 `test/unit/mission-arena.test.ts`：對每一張 `battle !== null` 的卡：
   - `arena.radius ≥ ARENA_MIN_RADIUS`；
   - `createBattle({ update() {} }, missionConfigFrom(card), 1)` 之後，`blue` 與 `red` 每一架的水平位置離圓心 ≤ `radius − 1000`；
   - `cfg.ground` 的每一個地面目標在界內（≤ `radius − 1000`）；
   - `missionRules(card, cfg.altitude, cfg.lateralOffset)` 有 `point` 的，`point` 在界內（≤ `radius − 1000`）；
   - 依 `cfg.beats` 的順序，每一個 `reinforce` 節拍用 `reinforce(b, beat.flight)` 實際生出來、檢查出生點；每一個 `withdraw` 節拍的 `point` 在界內。
   - 先驗紅（變異）：allies-m1 圓心挪到 z +8000（開場站位越界）、japan-m2 的 `withdraw.distance` 改 −20000、allies-m3 雷擊波次 `along` 改 −3，三者各自要紅，再改回。
3. 十張卡填上 SPEC §2.2 的數值。

## 3. 主程式與 HUD 接邊界

1. `hud/types.ts`：`arenaX`、`arenaZ`、`arenaRadius`（預設取 `SKIRMISH_ARENA`）。
2. `main.ts`：模組層一個 `arenaBounds: ArenaBounds`；`resetArena` 依模式設定它與 `hudFrame.arenaX/Z/Radius`，`arenaShow = true`；物理步呼叫 `stepArena(arena, arenaBounds, …)`；接手僚機（`battle.player !== player` 那一段）時倒數狀態歸零。
3. `hud/widgets/minimap.ts`：圈心改為 `(arenaX − worldX, arenaZ − worldZ)`（仍在旋轉座標系內，乘 `px` 與既有的負號慣例一致），半徑 `arenaRadius`。
4. 不寫測試（UI）；第 6 步截圖驗。

## 4. 雲場資料（`world/cloudField.ts`、`render/clouds.ts`）

1. 測試 `test/unit/cloud-field.test.ts`：
   - `cloudFieldCount(field, radius)` = round(密度 × π × (radius + 8000)² / 10⁶)；
   - `cloudFieldSpecs(field, bounds, key)`：數量等於上式、每朵離圓心 ≤ radius + 8000、高度在 `yMin`～`yMax`、半徑 60～140、同一個 key 每次一樣、不同 key 不一樣；
   - 每一張任務卡、以及每一種「地形 × 時段」的遭遇戰組合，雲塊總數（`cloudPuffCount` 加總）≤ `CLOUD_PUFF_CAPACITY`；
   - `skirmishCloudField` 對每一種地形與時段都有值，`yMin < yMax`。
2. 實作：
   - `world/cloudField.ts`：型別、`CLOUD_DENSITY`、`CLOUD_FIELD_MARGIN`、`skirmishCloudField`、`cloudFieldCount`。
   - `render/clouds.ts`：`cloudFieldSpecs(field, bounds, key)`（字串雜湊成種子，交給 `scatterClouds`）；`CLOUD_PUFF_CAPACITY = 16384`。
3. `MissionBattle` 加 `readonly clouds: CloudField`（必填），十張卡填 SPEC §3.2。

## 5. 主程式接雲場

1. `buildBattleTerrain`：`applyTimeOfDay` 之後，依模式取 `CloudField` 與 `ArenaBounds`、key（任務 id／`skirmish:<terrain>:<tod>`），`clouds.set(cloudFieldSpecs(...), cloudColorOf(DAY_PALETTES[timeOfDay], CLOUD_COLOR))`。
2. `leaveBattle`：`clouds.clear()`。
3. 檢查：重開一場（`restartBattle`）不重建地形，雲照舊；回選單後短片的 `setClouds` 換上它自己的雲。

## 6. 驗收（Playwright）

1. 十關任務與遭遇戰（海、農地，正午與暴雨）各進場截一張：有雲、雲色符合時段。
2. 任一關任務把玩家搬到界外：警告、倒數、小地圖的圈位置正確，截圖；倒數到期爆炸後接手界內的僚機，確認僚機沒有被殺。
3. 效能：germany-m1 進場後上帝視角活畫面，同頁切換 `clouds.object.visible` 量 GPU 時間（timer query、取中位數），回報。
4. Codex 審查程式；修查證過的缺陷。
5. 整套測試；commit 到分支（不推）。
