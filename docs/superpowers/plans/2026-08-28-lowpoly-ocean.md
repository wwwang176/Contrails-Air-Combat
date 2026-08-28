# 實作計畫：低多邊形的海

spec：`docs/superpowers/specs/2026-08-28-lowpoly-ocean-design.md`
分支：`feat/lowpoly-ocean`（由 `main` 的 `8c79439` 分出）

## 全域約束

- **背景工作跑的時候不得做任何會改動工作區的 git 操作**（stash / checkout / rebase）。
- 每一條新測試都要**先驗紅**，或以變異證明承重。
- 註解寫現狀，不寫沿革。可調參數就地改掉。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。這一輪不碰那兩層。
- 熱路徑不得配置。
- 不用 PowerShell 讀寫含中文的檔案；含中文的 commit message 走檔案 + `git commit -F`。
- `perf-gate.test.ts` 與 `rematch.test.ts` 必須單獨跑。
- 指令：`node node_modules/vitest/vitest.mjs`、`node node_modules/typescript/bin/tsc --noEmit`、
  `node node_modules/vite-node/vite-node.mjs`、`node node_modules/vite/bin/vite.js --port 5178`。

## 任務 0：把「改動前」的基準線釘下來

**這一步不寫任何產品程式碼。** 沒有它，後面每一句「沒有變差」都是空話。

1. `node node_modules/typescript/bin/tsc --noEmit` —— 記下錯誤數（基準 22）。
2. 全套 `vitest run`，記下通過數。
3. `perf-gate` 單跑、三支 replayDigest 護欄單跑，記下結果。
4. 開 dev server，跑 `test/e2e/ocean-cost.e2e.ts`，把四個情境的數字存進
   `docs/superpowers/plans/` 旁邊的一個 measurements 區塊（或直接貼進本檔末尾）。

**驗收**：四組數字都在檔案裡，之後任何一句比較都指得出來源。

## 任務 1：常數層 —— 格子、層數、浪、淡出窗

只動 `src/render/ocean.ts` 的常數區，**不動幾何建構、不動著色器**。
這一步會讓畫面變醜（2.5 m 的著色器配 60 m 的格子），那是預期的；
它的目的是讓後面每一步都有一個可編譯、可測的地基。

### 1.1 先寫測試（紅）

`test/unit/ocean.test.ts` 新增：

- `OCEAN_BASE_CELL === FIELD_CELL * 1.5`
  —— import `world/archipelago` 的 `FIELD_CELL`。**意圖是「山變了海要跟著變」**，
  所以比的是關係不是數字。
- 每一道 `WAVES` 的 `wavelength > 2 * OCEAN_BASE_CELL`（Nyquist）。
- `RIPPLE_WAVES` 為空（整套微波刪掉之後）。
- 淡出權重：對 `[60, 120, 240, 480]` 四個格距 × 三道波算 `w`，斷言
  L0 三道全 > 0、L2 與 L3 三道全 === 0。**用一支從 `ocean.ts` 匯出的純函數算**，
  不要在測試裡抄一份 smoothstep（抄一份就是第二個真相）。
- `FAR_SEA_Y < -(WAVES 的振幅和)`，由 `WAVES` 算出來比，不是寫死 −5。

### 1.2 再改常數（綠）

```
  OCEAN_BASE_CELL      2.5 → 60
  OCEAN_LEVELS         10  → 4
  OCEAN_VERT_FADE_LO   0.2 → 0.35
  OCEAN_VERT_FADE_HI   0.4 → 0.5
  WAVES                五道 → 三道（380/2.0/0°、250/1.5/55°、165/1.0/115°）
  RIPPLE_WAVES         → []
  FAR_SEA_Y            −5.0 → 由振幅和推導
```

速度沿用既有的色散關係（`√λ` 上內插），註解要寫清楚三道是怎麼定出來的。

**風險**：`RIPPLE_*` 一整套（`RIPPLE_RESOLVED`、`RIPPLE_GLSL`、
`SHADE_SLOPE_RMS` 的預算分配）與著色器交織。這一步只把 `RIPPLE_WAVES` 清空，
讓既有的「空的時候著色器不產生微波那一段」那條路徑生效；**整套刪除留到任務 3**。

**驗收**：`ocean.test.ts` 綠、`tsc` 錯誤數不變、全套不紅。畫面此時會醜，正常。

## 任務 2：格點吸附

### 2.1 先寫測試（紅）

- `update(t, cx, cz)` 之後，`mesh.position.x / z` 是 **480 的整數倍**。
- 連續餵入一段相機軌跡（例如 x 從 0 走到 1000，每步 7.3 m），
  每一步之後檢查 `mesh.position` 只在 480 的倍數上跳，且與 `(cx, cz)` 的
  距離永遠 ≤ 240。
- **承重證明**：把吸附拿掉，上面兩條都要紅。

### 2.2 實作

`update` 裡把中心 `Math.round(c / 480) * 480`。`uOrigin` 跟著改成吸附後的值
（不然頂點算的相位與它實際所在的世界座標對不上）。

`ocean.ts` 那段「不做格點對齊」的註解要**改寫**成新的理由（60 m 之後滑動
就是外觀），不是在後面補一段沿革。

**驗收**：測試綠。目視：飛一段直線，海面不蠕動。

## 任務 3：片段著色器 —— 刪掉假的低多邊形

這是最大的一步，而且是**只刪不加**。加的部分在任務 4。

### 3.1 刪除清單

```
  兩套 Voronoi（oceanVoronoi、oceanCellWidth、hash22）
  塊傾斜（SPARKLE_TILT_SHARE 與它的相位/速率）
  逐像素的波坡度迴圈（g、slopeVar、shadeScale、WAVE_FADE_LO/HI 那一套）
  微波的整套（RIPPLE_RESOLVED / RIPPLE_GLSL / RIPPLE_WARP_*）
  SPARKLE_CELL / CELL_REF / DRIFT / EDGE / JITTER / DARK_*
```

法線改為 `flatShading` 給的面法線（材質已經是 `flatShading: true`，
所以刪掉 `oceanNormal` 的計算之後直接用 `normal` 即可）。

### 3.2 留下來的

`SEA_AERIAL_*`（近深遠淺）、`SPARKLE_FADE_START/END`、`SPARKLE_TWINKLE`、
`SPARKLE_CREST_BIAS` 與它的偏置函數、`SEA_SHADE_GAIN`、天空反射那一段。

### 3.3 測試

`ocean.test.ts` 裡驗被刪那些性質的條目**一併刪掉**，不是註解掉。
留下來的（碎光偏置四條、遠海三條、clipmap 恆等式、`dispose`）必須仍然綠。

**驗收**：全套綠、`tsc` 不變。畫面此時是「真的低多邊形幾何 + 沒有白點」。
**這裡截第一張圖** —— 稜角對不對，這一張就看得出來，而且還沒投入任務 4。

## 任務 4：一面一色 + 逐面白點

### 4.1 先寫測試（紅）

面 id 的重建是純幾何，可以在 node 裡驗，**不必開瀏覽器**：把 GLSL 的那幾行
在 TS 裡實作成一支匯出的參考函數 `faceIdAt(x, z, cell)`，然後

- 同一個 `(cell, tri)` 恆得同一個 id（決定性）。
- 同一格的兩個三角形 id 不相等。
- 相鄰格的 id 不相等（掃 20×20 格，全部相異對）。
- **對角線與幾何一致**：從 `clipmapLevelGeometry` 回傳的 index buffer 反算
  「這一格往哪一邊切」，與 `faceIdAt` 的 `tri` 判準比對。
  **不要抄一個常數** —— 抄了就沒有在驗一致性。

### 4.2 實作

- 頂點著色器多傳一個 varying：**未位移**的 `rawXZ`。
- 片段：`floor/fract` 反推 cell 與 tri → hash → id。
- 顏色：基底 `SEA_COLOR` + id 的明度微擾（起始 ±6%）+ 波峰亮度偏置。
- 白點：面 id 擲一次 × 波峰偏置的機率 → 整個面變白。

GLSL 的 hash 與 TS 的參考函數必須是**同一條算式**。
若兩邊在 float 精度上對不齊，測試改成驗「性質」（決定性、相鄰相異）而不是
逐位元相等 —— 但對角線那一條**必須**是嚴格比對。

**驗收**：測試綠。**第二張截圖** —— 白點與面色。

## 任務 5：碰撞改平面

### 5.1 測試

`aircraft.test.ts` 那兩條不動（它們測 `isCrashed` 這個函式）。
新增一條在 `terrain.test.ts` 或新檔：判定用的高度場在海上恆為 0、
在島上等於 `field.sample`。

### 5.2 實作

- `render/terrain.ts` 的 `Terrain` 多一個 `collisionHeightAt(x, z)`：
  `'sea'` 回 0；群島回 `max(field.sample(x, z), 0)`。**不吃 time。**
- `main.ts:521` 改成用它。
- `crash.ts` 的註解改寫（§6.1）。
- `heightAt` 維持原樣，`splash` / `wrecks` / `debris` 一個字都不改。

**驗收**：全套綠。目視：貼海飛不會被看不見的浪打下來；撞山照樣死。

## 任務 6：收尾與量測

1. `tsc --noEmit` —— 錯誤數必須回到基準。
2. 全套 `vitest run`。
3. `perf-gate` 單跑、三支 replayDigest 護欄單跑 —— 與任務 0 的數字比。
4. `ocean-cost.e2e.ts` 重跑，與任務 0 的四組數字比。**不得變差。**
5. `battlefield-visuals.e2e.ts`、`god-view.e2e.ts`。
6. 三張截圖：座艙貼海、座艙中空、上帝視角高空。
7. `docs/backlog.md` 更新。

## 順序為什麼是這個

```
  0 基準線      沒有它，後面所有「沒變差」都是空話
  1 常數        地基。畫面會醜，但每一步都可編譯可測
  2 吸附        必須排在著色器之前 —— 蠕動會蓋過稜角，看不出任務 3 對不對
  3 只刪不加    刪完就截圖。稜角錯的話，任務 4 的工全白做
  4 只加不刪    面色與白點
  5 碰撞        一行，隨時可做，排最後是因為它與畫面無關
  6 收尾
```

## 已知的風險

- **任務 3 的刪除面積大**。片段著色器的各段互相引用（`slopeVar` 餵 `σ`、
  `shadeScale` 餵波淡出、`drift` 餵碎光座標）。刪錯一段的症狀是編譯過但畫面
  變成純色。緩解：一次刪一段、每段之後開一次瀏覽器看。
- **`RIPPLE_GLSL` 是字串拼接**。空的時候走另一條路徑（`ocean.test.ts` 有一條
  在守），先靠它、最後才整段拿掉。
- **60 m 的稜角可能太柔**。振幅是起始值。若截圖看起來還是太平，先加振幅
  （`WAVES` 的三個 `amplitude`），那是一行；不夠再降格子。
  **降格子要回頭改任務 1 的常數與任務 2 的 480**。
- **白點整面變白可能像馬賽克**。退路寫在 spec §5：面內用 id 決定一個小點。
