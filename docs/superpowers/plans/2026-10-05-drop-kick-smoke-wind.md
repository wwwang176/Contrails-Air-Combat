# 投放物的隨機推力與煙的風（PLAN）

SPEC：`docs/superpowers/specs/2026-10-05-drop-kick-smoke-wind-design.md`

每一步先寫會紅的測試再改程式；`npx tsc --noEmit` 的錯誤數不得增加（動工前 0）；只跑相關測試，整套留到合併前。

## 1. 推力（`world/bomb.ts`）

1. 測試（`test/unit/bomb.test.ts` 增補）：`dropDrift(n, out)` 水平、大小 = `DROP_DRIFT_ACCEL`、可重現、4,000 個序號的平均向量長度 < 0.05 × 大小、四個象限各約四分之一。
2. 行為測試：用 `Bombs` 實際跑到落地（第 0 格無推力、第 1…200 格各帶推力），算平均水平偏移：俯衝（600 m、俯角 60°、130 m/s）< 平拋 1,500 m（100 m/s）的五分之一；平拋 4,000 m > 平拋 1,500 m 的兩倍。
3. 實作 `DROP_DRIFT_ACCEL`、`dropDrift`、`Bombs` 的 `ax`／`az`；刪 `BOMB_SPREAD_RAD`。

## 2. 炸彈與魚雷接推力（`World.ts`、`world/torpedo.ts`）

1. 測試：`World.dropBomb` 之後 `bombs` 那一格初速不變、推力大小 = `DROP_DRIFT_ACCEL`。
2. 測試：`Torpedoes.spawn` 帶推力時，入水後航向 = 投放速度的水平方向；入水點與不帶推力的不同。不帶推力時沿用既有測試（逐位元）。
3. 實作：`Torpedoes.spawn(…, owner, ax = 0, az = 0)`，空中段每一步加推力；帶推力的在 `spawn` 時存航向、入水時用它；`World.dropTorpedo` 先套角度散佈再給推力；`World.dropBomb` 只給推力。
4. 既有測試裡用到 `BOMB_SPREAD_RAD` 或依賴舊散佈的，照新行為改（不是放寬）。

## 3. 風（`render/wind.ts`、`render/particles.ts`）

1. 測試：`windOf` 大小在 `[WIND_MIN, WIND_MAX]`、同一種子一樣、不同種子方向不同；`createParticles({ wind: true })` 的一顆自由粒子 `step` 一秒後 x/z 比不開風的多 `SMOKE_WIND`；吸附在錨點上的不受影響。
2. 實作 `render/wind.ts`、`ParticleConfig.wind`；SPEC §2.3 列的池子開 `wind: true`。
3. `main.ts`：`buildBattleTerrain` 設風（建地圖時定一次）、`leaveBattle` 歸零。

## 4. 驗收

1. Codex 審查程式；修查證過的缺陷。
2. Playwright：一關有地面火災的任務（例如盟 M2 炸過之後，或用 `__bombs` 點火），截煙柱。
3. 整套測試；commit 到分支（不推），給負責人試飛。
