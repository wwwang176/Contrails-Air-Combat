# 砲塔轉向 實作計畫

SPEC：`docs/superpowers/specs/2026-10-08-gun-traverse-design.md`。分支 `feat/gun-traverse`。
模型端已交五支轉軸版 GLB（`models-src/`，未提交）。

## T1 登記表

- `GroundModel` 的 glb 那一型加 `turret?: { readonly traverse: string; readonly elevate: string }`
- `GROUND_MODELS`：`usFlakHeavy`（M1_）、`flakHeavy`（F18_）、`flakLight`／`atGun`（F38_）、
  `usFlakTrack`（M16_）、`tank`／`tankDug`（T34_）填上節點名
- `specs/ground.ts`：flak38 兩筆 `realLength` 2.57、`realHeight` 1.50、盒頂 1.50
  （`groundBox([-0.95, 0, -0.75], [0.95, 1.50, 1.06])`）；m16 `realHeight` 2.61
- **紅**：新 GLB 放進來之後 `ground-units.test.ts` 現在就有 5 條紅（尺寸、盒頂），T1 改完轉綠

## T2 載入拆塊（`render/geometry/ground/glb.ts`）

- `parseGroundGlb(buf, turret?)`：有 `turret` 時找兩個節點，少一個丟錯；Elevate 必須是
  Traverse 的後代；兩者的 `matrixWorld` 只能是平移（旋轉、縮放 ≠ 單位就丟錯）
- 每個網格往上找祖先：碰到 Elevate → 上下抬組；碰到 Traverse → 水平轉組；都沒有 → 固定組
- 頂點照舊烘 `matrixWorld`，再減掉該組的轉軸世界座標（水平轉組減 Traverse、上下抬組減 Elevate）
- 回傳固定組的合併幾何；`userData[GUN_TURRET_KEY] = { traverse, elevate, traversePivot, elevatePivot }`
  （`elevatePivot` 相對於 `traversePivot`）。材質清單算全部三組
- `preloadGroundGlbs` 改吃 `{ url, turret }[]`（同一個 url 兩筆登記的 `turret` 必須相同，不同就丟錯；
  flak38 由 `flakLight` 與 `atGun` 共用）。**`groundModelUrls` 一起改**：回傳 `{ url, turret }[]`，
  一致性檢查在去重之前做；`preloadGroundModels` 照傳
- `restGeometry(geo)`：有 `GUN_TURRET_KEY` 時回一份新的合併幾何（三塊放回靜止姿勢），沒有就回原物。
  給模型展示頁（`tools/ground.ts` 的取景、尺寸、三角形數、畫面）與 `ground-units.test.ts` 的
  `boundsOf` 共用 —— 兩邊都量整台
- 測試（新檔 `ground-turret.test.ts`）：
  - 三塊放回轉軸後與「不拆」的合併結果逐點相同（五支）
  - 少節點丟錯、Elevate 不在 Traverse 底下丟錯、空節點帶旋轉丟錯（用 three 現建一個小場景經
    `GLTFExporter` 不行 —— node 沒有；改成把拆塊核心抽成吃 `Object3D` 的函式，測試直接給場景）

## T3 既有測試配套（`ground-units.test.ts`）

- `boundsOf`：量 `restGeometry(u)`（兩塊放回轉軸、靜止）
- 「命中盒蓋住砲管以外」：有 `turret` 的單位改成排除 Elevate 的後代（沒有的照舊用 `barrelNodes`）
- 新增：固定組＋水平轉組（Elevate 以外）在 yaw 每 15° 一次都在盒子裡。**實測 Flak 38 的
  `F38_Wing_R`（yaw 135° 超出 0.65 m）與 M16 的 `M45Shield_L`（yaw 120° 超出 0.13 m）過不了**，
  處理方式待負責人裁定（盒子放大或 Flak 38／M16 的旋轉零件比照 Elevate 不要求蓋住）

## T4 角度計算（新檔 `render/gunAim.ts`，純函式、不配置）

```ts
export const GUN_PITCH_MAX = 85 * DEG
export const GUN_YAW_HOLD = 0.02             // 水平分量小於它沿用上一幀的 yaw
export const TANK_TRAVERSE_RATE = 20 * DEG   // rad/s
export const TANK_PITCH_MIN = -5 * DEG, TANK_PITCH_MAX = 25 * DEG
/**
 * 本體座標的方向（**不必是單位向量**）→ yaw／pitch，寫進 out。
 * pitch = atan2(y, hypot(x, z))；水平分量 / 長度 < GUN_YAW_HOLD 時 yaw 用 prevYaw；長度 0 兩者都沿用
 */
export function aimAngles(x, y, z, prevYaw, prevPitch, pitchMin, pitchMax, out: { yaw: number; pitch: number }): void
/** 往 wantYaw 以 rate·dt 轉（走短的那一邊），回新角度 */
export function slewYaw(yaw, wantYaw, rate, dt): number
```

測試：正前方 (0,0,−1) → yaw 0；左 (−1,0,0) → +90°；右 → −90°；正上方沿用 prevYaw、pitch 夾 85°；
帶距離的 (0, 2, −100) → pitch ≈ 1.15°（不是 asin 的 90°）；
slew 不超過 rate·dt、跨 ±π 走短邊、到了不抖。

## T5 地面戰的瞄準目標（`render/groundBattle.ts`）

- `aimTargets: Int32Array`、`aimClock: Float32Array`，與 `trackClock` 同一處依單位數配置；`reset` 清成 −1／0
- 每一台會直射的（`isTank`）：`aimClock` 到了就 `nearestEnemy(targets, s, theater.range, isTarget)`
  寫進去，下一次 1 秒後；第一次的相位依 `s` 錯開
- `shoot` 開火時把 `aimTargets[s] = j`（含 `victim`）
- 介面加 `aimTarget(s: number): number`
- 測試：週期挑最近、開火後指向那一發的目標（含劇本 `victim`）、reset 清掉

## T6 畫面（`render/groundTargets.ts`）

- 有 `GUN_TURRET_KEY` 的單位多兩顆 Mesh：`trav` 掛在車身下（位置 `traversePivot`）、`elev` 掛在
  `trav` 下（位置 `elevatePivot`）；逐台 `yaw`、`pitch` 存在 `Float32Array`
- `update(list, cam, seconds = 0, aim: { aimTarget(s: number): number } | null = null)`：兩個都可省略
  （`tools/daylight.ts`、`ground-units.test.ts`、`personnel-death.test.ts` 只傳兩個）。`seconds` 0 時
  坦克不轉
  - 死了：角度不動
  - `t.guns.length > 0`：`aimAngles(aim 的 x,y,z, yaw[k], −5°, 85°)`
  - 否則 `aim` 有給、`aimTarget(k) ≥ 0`：目標中心減掉耳軸世界位置 → 以 `t.orientation` 的反轉
    換成本體座標 → `aimAngles` → yaw 以 `slewYaw(TANK_TRAVERSE_RATE)` 逼近、pitch 夾 [−5°, 25°]
  - 否則：yaw 以同轉速回 0、pitch 回 0
  - `trav.rotation.y = yaw`、`elev.rotation.x = pitch`；材質三顆一起換
- `battleSceneFrame.ts` 傳 `battleScenery.groundBattle ?? null`；`menuReel` 不傳
- 測試：砲位照 `guns[0].aim` 轉、坦克照 `aimTarget` 慢慢轉、沒來源朝前、死了不動、三顆同材質

## T7 驗收

- `tsc` 行數與基準（0）比對；相關測試；整套（`--maxWorkers=4 --minWorkers=1`）
- Playwright 截圖：洛伊納 Flak 18、雷伊泰 90 mm、勒熱夫 T-34
- 洛伊納 GPU 時間前後對照（`gpu-timer-query` 探針做法），差在 0.3 ms 內定案
- Codex 實作審查
