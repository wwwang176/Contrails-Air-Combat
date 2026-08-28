# 實作計畫：低多邊形的海

spec：`docs/superpowers/specs/2026-08-28-lowpoly-ocean-design.md`
分支：`feat/lowpoly-ocean`（由 `main` 的 `8c79439` 分出）

**第二版** —— Codex 審出六個 BLOCKER，全部複驗成立，任務順序與測試設計整個重排。
被推翻的幾件事記在「§附錄 審查修掉了什麼」，因為它們是很容易再犯一次的錯。

## 全域約束

- **背景工作跑的時候不得做任何會改動工作區的 git 操作**（stash / checkout / rebase）。
- 每一條新測試都要**先驗紅**，或以變異證明承重。**測不到的就不要寫測試**，
  改用截圖驗收並在計畫裡寫明「這一項由截圖守」。
- 註解寫現狀，不寫沿革。可調參數就地改掉。
- 熱路徑不得配置。不用 PowerShell 讀寫含中文的檔案；含中文的 commit 走 `-F`。
- `perf-gate.test.ts` 與 `rematch.test.ts` 必須單獨跑。
- 指令：`node node_modules/vitest/vitest.mjs`、`node node_modules/typescript/bin/tsc --noEmit`、
  `node node_modules/vite-node/vite-node.mjs`、`node node_modules/vite/bin/vite.js --port 5178`。

## 任務 0：基準線（已完成）

```
  tsc --noEmit          22 個錯誤（與 main 相同）
  全套 vitest           3,056 通過 / 14 skipped；唯一的紅是 perf-gate 的砲塔追瞄
                        那條，與 Codex 搶 CPU 所致，要單跑補驗
  ocean-cost.e2e.ts     見 spec §1.2 的四組數字
```

## 任務 1：常數 + 著色器清理 + 世界空間面法線 + 逐面底色

**合成一步，因為分開做截不出有意義的圖。** spec §4.1 已經算過：相鄰面的法線
只差約 12°，所以「只換幾何、還沒有逐面色」的中間態看不出低多邊形 ——
Codex 說得對，那張截圖判斷不了主效果。

### 1.1 常數

```
  OCEAN_BASE_CELL      2.5 → 60          （= FIELD_CELL 40 × 1.5）
  OCEAN_LEVELS         10  → 4
  OCEAN_VERT_FADE_LO   0.2 → 0.35
  OCEAN_VERT_FADE_HI   0.4 → 0.5         （0.5 = Nyquist，硬上限）
  WAVES                五道 → 三道：380/2.0/0°、250/1.5/55°、165/1.0/115°
  RIPPLE_WAVES         → 整套刪除（不是先清空再刪，見附錄）
  FAR_SEA_Y            −5.0 不動         （靠 depthFunc 解決，見 1.4）
  uHalfSeg             新增 uniform = OCEAN_RING_SEGMENTS / 2，給 1.5 用
```

速度沿用既有色散關係（`√λ` 上內插）。註解要寫清楚三道怎麼定出來的。

### 1.2 片段著色器：刪除

```
  兩套 Voronoi（oceanVoronoi / oceanCellWidth / oceanHash2 / sparkleLight / sparkleDark）
  塊傾斜（uTiltShare 與它的相位、速率）
  逐像素波坡度迴圈（g / slopeVar / shadeScale / drift / uNyqLo / uNyqHi）
  微波整套（RIPPLE_RESOLVED / RIPPLE_GLSL / RIPPLE_WARP_* / uRipStaticVar / uShadeFloor）
  SPARKLE_CELL / CELL_REF / DRIFT / EDGE / JITTER / DARK_*
```

### 1.3 片段著色器：面法線（**這一步是「加」，不是「刪」**）

three 內建的 `normal` 是 **view space**，而 `uSunDirection`、`oceanV`、
天空反射全部是 world space。直接替換會讓漫射與反射隨鏡頭旋轉，**而且只在某些
視角看得出來**。用 three `common` 裡就有的：

```glsl
vec3 oceanNormal = normalize(inverseTransformDirection(normal, viewMatrix));
```

`flatShading: true` 已經在材質上，所以 `normal` 就是面法線。

**天空反射那一段（菲涅耳）不准刪** —— spec §4.4：`SEA_AERIAL_STRENGTH` 是 0，
「近深遠淺」現在**全部**來自它。

### 1.4 遠海的深度

`farMaterial.depthFunc = LessDepth`。理由與正確性論證見 spec §3.3。

### 1.5 逐面底色

spec §4.2 的重建。**掛在 `applySparkle` 的 `displace` 旗標下** —— 遠海不套
（spec §4.3：它一格 46.9 km）。

### 1.6 測試

**刪掉**驗被刪那些性質的條目（微波階、Voronoi 塊地板、塊傾斜、微波扭曲互質、
「著色沒有比幾何更細的結構」），不是註解掉。

**改寫**：

- 深度那一條 → 守 `farMaterial.depthFunc === LessDepth` 與 `renderOrder` 先後。
  舊的三倍量化餘裕拿掉，理由寫在測試的註解裡（新判準與距離無關，更強）。

**新增**（每一條都要先驗紅或變異證明）：

- `OCEAN_BASE_CELL === FIELD_CELL * 1.5` —— 比的是關係不是數字。
- 每一道 `WAVES` 的 `wavelength > 2 * OCEAN_BASE_CELL`。
- **淡出用真實模型驗**：`vCell = max(baseCell, r / 64)`，斷言每一道波的消失
  半徑 `0.5 × λ × 64` 落在近海覆蓋範圍（30,720 m）之內 —— 否則浪會被遠海
  硬切掉。**變異證明**：把 `OCEAN_VERT_FADE_HI` 調到 0.9，這一條要紅。
- **層格距的重建與幾何一致**：把 §4.2 的 `exp2(ceil(log2(...)))` 在 TS 裡實作
  成 `levelCellAt(r)`，對每一層的內外緣半徑斷言它回傳那一層 `clipmapLevelGeometry`
  實際用的 `cell`。**變異證明**：把 `ceil` 換成 `floor`，這一條要紅。
- `island.ts` 的 `DRAW_FLOOR` 必須低於 `−(WAVES 振幅和)` —— 由兩邊的常數算，
  不是寫死。**這是 Codex 抓到的**：調高振幅會讓波谷露出沒畫的海床格、破洞。

**不新增**（Codex 判定 vacuous，同意）：`faceIdAt` 的決定性、20×20 相鄰 id
全不同、TS helper 與 index buffer 的對角線比對。前兩者在功能完全不存在時也綠；
第三者只驗 TS 抄得對不對，GLSL 把 `step` 寫反照樣綠。**對角線由截圖守**，
已寫進 spec §4.2。

### 1.7 驗收

`tsc` 錯誤數不變、`ocean.test.ts` 綠、全套不紅。
**第一張截圖**：貼海、中空、上帝視角三個凍結姿態，看得出是多邊形的海，
而且近深遠淺還在。

## 任務 2：逐面白點

面 id 擲一次 × 重心高度的偏置機率 → 整個面變白。

**重心是必須的**（Codex BLOCKER 6）：用內插的 `vOceanWorld.y` 會讓 `p` 在面內
變動，`roll < p` 把三角形切成半白半不白。局部重心固定在 `(1/3,1/3)` 與
`(2/3,2/3)`，在那一點重算波高。

`SPARKLE_CREST_BIAS` 那一套與它的四條測試**原封不動**。

**驗收**：**第二張截圖**。遠海沒有白點了會不會變死板，這一張回答（spec §4.3）。

## 任務 3：格點吸附

排在截圖之後，因為它只影響**移動時**的蠕動，凍結姿態看不出來。

`update` 把 `centerX / centerZ` 各自吸附到 480 的整數倍，**再**去設
`mesh.position` 與 `uOrigin.value`。兩者從同一個吸附後的值來，天然一致。

測試：

- `update` 之後 `mesh.position.x / z` 是 480 的整數倍，且與 `(cx, cz)` 距離 ≤ 240。
- **相位同步**：`uOrigin.value` 與 `mesh.position` 恆相等。
  Codex 提醒：只吸附其中一份會讓波相位與網格錯開，而只看 `mesh.position` 的
  測試抓不到。這一條要能在「只吸附 mesh.position」時紅。

`ocean.ts` 那段「不做格點對齊」的註解**改寫**成新理由。

**驗收**：測試綠。目視飛一段直線，海面不蠕動。

## 任務 4：碰撞改平面

### 4.1 可測的接線

Codex BLOCKER：只測 `Terrain.collisionHeightAt` 的話，main 忘了換過去仍然全綠。

所以判定政策抽成一支**不在 DOM 進入點**的工廠：

```ts
// src/world/seaCrash.ts（新檔，不 import render/）
export function flatSeaCrashPolicy(landHeightAt: (x: number, z: number) => number): CrashPolicy
```

`render/terrain.ts` 的 `Terrain` 多一個 `collisionHeightAt(x, z)`：
`'sea'` 回 0；群島回 `max(field.sample(x, z), 0)`。**不吃 time。**
`main.ts:521` 改成 `world.crashPolicy = flatSeaCrashPolicy(terrain.collisionHeightAt)`。

測試：一個真正走 `World.crashPolicy → destroy` 的整合案例 —— 一架擺在
`y = CRASH_CLEARANCE - 0.01` 的飛機，step 一次要死；擺在 `+0.01` 不死。
**門檻是 `y ≤ CRASH_CLEARANCE`，不是 `y ≤ 0`**（Codex 指出我原本的說法不精確）。

### 4.2 視覺放置一個字都不改

`heightAt` 在 `main.ts` 有**六個**呼叫點（不是我原本寫的四個），
`src/tools/range.ts` 另有五個：

```
  main.ts:521    crashPolicy          ← 只有這一個改
  main.ts:841    彈丸入水的水柱
  main.ts:994    wrecks.step
  main.ts:995    debris.step
  main.ts:1001   殘骸入水的水柱
  main.ts:1004   碎片的水花
  tools/range.ts 五處
```

**禁止批次替換。** 這幾個吃的是連續波高，那是對的（spec §6.3）。

### 4.3 `crash.ts` 的註解

現在寫的正好相反，改寫成新的理由（浪的量級縮進 `CRASH_CLEARANCE` 這個自承的
估計值裡了）。**不在後面補一行沿革。**

## 任務 5：收尾與量測

1. `tsc --noEmit` 回到 22。
2. 全套 `vitest run`。
3. `perf-gate` 單跑、三支 replayDigest 護欄單跑（Codex 已 `rg` 確認它們走
   `World` 的預設平面，不經 `crashPolicy` 讀 `gerstnerHeight` —— 但還是要實跑）。
4. `ocean-cost.e2e.ts` 重跑，與任務 0 的四組數字比。**不得變差。**
5. `battlefield-visuals.e2e.ts`、`god-view.e2e.ts`。
6. 三張截圖 + 選單背景（`menu-camera` 也看得到海）。
7. `docs/backlog.md` 更新。

## 已知的風險

- **任務 1 的刪除面積大**，而且同一步還要加東西。片段著色器各段互相引用
  （`slopeVar` 餵 σ、`shadeScale` 餵波淡出、`drift` 餵碎光座標）。
  緩解：一段一段刪，每段之後開一次瀏覽器看，不要一次刪完才編譯。
- **60 m 的稜角可能太柔**。振幅是起始值。往上調的話 `DRAW_FLOOR`（−5.5）
  會先擋住 —— 那條測試就是為此而立。
- **白點整面變白可能像馬賽克**。退路在 spec §5：面內用 id 決定一個小點。
- **遠海拿掉白點可能變死板**。退路在 spec §4.3：便宜的噪聲，不撿回 Voronoi。

## 附錄：審查修掉了什麼

六個 BLOCKER，全部自行複驗成立：

1. **淡出模型錯了。** 我以為是逐層常數，實際是徑向連續（`vCell = 距離/64`）。
   照我原本的模型寫的測試會**對錯的模型驗綠**。
2. **`FAR_SEA_Y` 在深度緩衝上不安全。** 新的最長波撐到 12,160 m，量化階 8.81 m，
   既有那條「三倍餘裕」的測試必紅。修法不是把遠海壓深，是 `LessDepth`。
3. **一個共用的格距識別不了四層的面。** 四層共用同一顆材質，一律除以 60 的話
   L1/L2/L3 的每個真實三角形會被切成 4/16/64 個假色塊 —— **而測試照樣全綠**。
4. **遠海會長出假的 60 m 色塊。** 它一格 46.9 km。
5. **`normal` 是 view space。** 直接用會讓反射隨鏡頭轉，而且只在某些視角看錯。
   所以任務 1 不是「只刪不加」。
6. **白面會被切開。** 機率要用面重心算，不能用內插的片段高度。

以及三件我寫進文件的事實錯誤，一併更正：`SEA_AERIAL_STRENGTH` 是 0（近深遠淺
來自菲涅耳反射，不是大氣透視）；`three@0.180` 的內建材質是 GLSL3，`flat` 可用
（不用它的理由是 indexed 幾何共用頂點，與版本無關）；`heightAt` 是六個呼叫點。

Codex 也主動刪掉三個我多慮的：`clipmapLevelGeometry` 的 `a,c,b / b,c,d` 確實與
`tx + tz = 1` 一致；`vOceanWorld.xz` 已經是未位移座標、透視插值不會跑錯 cell；
`__gfx` 的 children 索引契約不受這一輪影響。三角形算術也是對的
（106,496，但那只是近海 —— 遠海另有 32,768，全部是 139,264）。
