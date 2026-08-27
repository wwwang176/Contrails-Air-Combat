# 群島地形 設計

**日期**：2026-08-27
**相關**：`2026-08-06-safety-lookahead-design.md`（安全層的**時間**前瞻，本份加的是**空間**前瞻）

## 1. 目標

讓地形真的存在：畫面上有島、飛機會撞上去、AI 閃得掉。

`docs/prompt.md` 預告了兩件事，這一份只做第一件的第一種：

> 「遭遇戰模式一樣要選陣營，然後設定**地形** & 敵我數量後，直接殊死戰」
> 「未來可能會增加山丘地形，所以 **AI 也要能判斷地形**」

專案負責人裁定最終要三種地形（群島、大島海岸線、內陸），**這一輪只做群島**，
但資料結構要能長到另外兩種而不重來。

## 2. 現況：三個接點已經預留好了，而且都是活的路徑

| 接點 | 現況 | 位置 |
|---|---|---|
| `TerrainKind` 聯集 + `createTerrain(kind)` 分支 | 只有 `'sea'`，但拆除／重建每場都跑 | `render/terrain.ts` |
| `Terrain.heightAt(x, z, time)` | 撞地、水柱、殘骸、零件入水全部走它 | `main.ts` 七處 |
| `AiController.seaHeight` | 宣告成 `= 0`，**從來沒有被寫過** | `AiController.ts:79` |

`applySafety`、`stationPoint`、`command.ts` 的高度下界都已經讀 `seaHeight`。
**介面是現成的，本份不重新設計它們。**

`safety.ts:285` 的 JSDoc 已經寫著「該點的海面（**未來為地表**）高度」——
這一份就是那個未來。

## 3. 設計：單一高度場，兩種消費者

`render/terrain.ts` 立了一條鐵律：

> 【必須與畫面上那一份是同一份】…兩者分家的話，飛機會撞到一片看不見的海。

因此 **heightmap 是唯一真相**：CPU 端 `heightAt` 對它插值，渲染端從**同一份**
資料生成 mesh。不採用「CPU 一份解析函數、GLSL 一份解析函數」的做法——海面
現在能兩份並存是因為波是五道正弦、逐位元對得上，地形 noise 兩份實作漂開的
機率高得多，而症狀正是那條鐵律警告的東西。

### 3.1 高度場規格

**1024² @ 40 m/texel = 40.96 km 見方，`Float32Array` 4.2 MB。** 出界回海面。

40 m 是由三角形數推導的，不是調的。以陸地占 6%（8 座大島 + 40 座小島）估：

```
  格子    陸地三角形    對照：海面現在是 245,760    一座 3 km 大島   一座 300 m 小島
  20 m     505,000      2 倍 ← 太貴                150×150 格       15 格
  40 m     126,000      51%                        75×75 格         7.5 格
  80 m      31,600      13%                        38×38 格         3.75 格 ← 塌了
```

40 m 讓地形成本約是海面的一半，而海面已經是這個場景最貴的東西。

【為什麼粗格在這裡是對的，不是妥協】flatShading 的三角面本來就要看得見。
更重要的是它守住鐵律：畫面上那個山壁是 40 m 一段的斜面，而 `heightAt`
插值的**是同一個斜面**——玩家看到什麼就撞到什麼。

【格子大小不影響 `heightAt` 的成本】雙線性插值是 O(1)，40 m 與 2 m 一樣快。
粗格省的是三角形，不是查詢。

### 3.2 小島的尺度下限：300 m

40 m 格子下，一座 100 m 的島只有 2.5 格——長不出形狀。下限訂在 **300 m**
（7–8 格），那會長成一塊有三四個面的礁石，而在 low-poly 下那正是它該有的
樣子。低於下限的島生成器不放。

**這是一條可測試的約束，不是風格建議。**

### 3.3 島清單來自生成器，不是從 heightmap 反推

```
generateArchipelago(seed) ──→ { field, islands[] }
                                 │        │
                    ┌────────────┘        └──────────┐
                    ▼                                ▼
        heightAt(x,z,t) = max(field.sample, 海面)   逐島切 mesh
```

生成時就知道每座島的中心與半徑，省掉連通區域分析，也天然給了視錐剔除的
包圍球。

### 3.4 綠色方塊移除

專案負責人裁定：`render/props.ts` 的浮動參照物**不再需要**。它只有一個
消費者（`terrain.ts`），整個模組刪除。

**誤刪陷阱**：`props` 在這個 repo 裡有兩個意思——`render/props.ts` 是海面
參照物（刪），`assembly.ts` 的 `props` 與 `PROP_DISC_RENDER_ORDER` 是
**螺旋槳**（不能碰）。

連帶要動：

```
  render/terrain.ts        children 由 farSea/nearSea/props → farSea/nearSea/islands
  main.ts:1420             __gfx 消融表的 'props' 圖層 → 'islands'
  e2e/frame-time.e2e.ts    圖層清單同上
  e2e/pixel-identical.e2e.ts   同上
  （另有一條單元測試靠 children 次序，並自我驗證抓對了人）
```

## 4. 設計：AI 的地形感知

### 4.1 `applySafety` 的數學一行都不動

把餵給它的 `seaHeight` 從 0 換成「沿航跡前方地形的最高點」，
`margin = position.y − seaHeight` 就自動變成「對最壞情況的餘裕」。
`recoveryAltitude` 的兩段式閉式解、`n*² = 1 + (2c)^(2/3)`、288 格安全矩陣的
迴歸證據**全部原封不動繼續成立**。

**改的是餵它的數字，不是它的推導。**

### 4.2 前視距離 1.2 km 是量出來的

用專案自己的閉式解掃描（`recoveryAltitude` × `factor 1.5` + `clearance 120`）：

```
  情境                        需要的前視距離     最壞值出現在
  俯衝撞地（緩坡）            219 – 577 m        800 km/h、−15° 淺俯衝
  水平閃一堵牆                337 – 1,016 m      800 km/h、滿載過載
  爬升翻過 1,000 m 的山       2,747 m            20° recoveryPitch
```

**AI 不需要翻山，只需要繞開**——繞開最貴 1,016 m，翻越要 2,747 m，差 2.7 倍。
而繞開本來就是空戰在做的事。取 **1.2 km**，餘裕 18%。

（水平閃牆的最壞值 P-51D 是 634 m、K-4 是 677 m，K-4 大 7%，因為 `gPositive`
是 7.5 對 8.0。1.2 km 對兩台都夠。）

### 4.3 三射線，先試拉起、拉不過就轉

安全層現在只會**拉起**（20° `recoveryPitch`）。從地板高度 120 m 起，1.2 km
內只爬得到 **437 m**——而主島是 1,000 m 級的，過不去。

因此取三條射線，各 1.2 km、每 100 m 一點（12 點／射線）：

```
        左 30°  ╲
                 ╲
   正前 ──────────→  1.2 km
                 ╱
        右 30°  ╱
```

- `ahead` = 正前射線的最高點 → 餵給 `applySafety` 當 `seaHeight`
- 既有的觸發判斷**完全照跑**：`margin ≤ needed` 才介入，不改
- 介入時再問一次「拉得過嗎」（`position.y + 437 ≥ ahead + clearance`）：
  拉得過 → 走既有的 `'ground'` 分支（拉起）；
  拉不過 → 升級成**新的** `'terrain'` 分支，往左右較低的那一側轉，同時爬升

**`'terrain'` 是 `'ground'` 的升級，不是它的替代。** 沒有任何情況下
`'terrain'` 會在 `'ground'` 不觸發時觸發——這讓「介入頻率」這件事完全
由既有的 `safetyShare ≤ 5%` 守住，不必新增一條門檻。

【為什麼是新分支而不是改既有分支】「拉得動的那一側逐位元不變」是
`applySafety` 最強的迴歸證據（見 `recoveryAltitude` 的註解）。加分支保得住
它，改分支保不住。

【爬升能力先用固定的 `recoveryPitch` 估】不解實際的爬升角。專案負責人裁定
「先做一版簡單的，之後再調整」。真值會比 437 m 低（拉起要時間、俯衝中還要
先改平），所以這個估**偏樂觀**——由 §6.1 的掃描護欄兜底，掃不過就把
`recoveryPitch` 那一項打折後重掃。

### 4.4 每 12 tick 重算，按機號錯開相位

地形是靜態的，不需要 240 Hz 重算。

```
  240 Hz 下飛機每 tick 走          0.81 m
  每 12 tick（20 Hz）兩次之間走     9.7 m   ← 遠小於取樣間隔 100 m、格子 40 m
  同時 8G 轉彎（23°/s）50 ms 轉    1.15°   ← 1.2 km 外橫向偏移 24 m，仍在一格內
```

成本因此是 1/12。

**必須按機號錯開相位**（`index % 12`）：40 架同一 tick 全算會做出週期性尖峰，
而那會直接打在 `frame-time.e2e.ts` 量的 1% low 上。

### 4.5 注入方式：public 欄位，與 `target` 同一個模式

```ts
class AiController {
  target: Aircraft | null = null
  seaHeight = 0
  terrainField: HeightField | null = null   // 新增
}
```

`main.ts` 設定，headless 測試不設定。

**這是本份風險最低的一個決定**：`terrainField` 為 null 時走的是與現在
**完全相同**的路徑，所以既有的對戰矩陣、AI 護欄、`replayDigest` 全部
不受影響、不必重錄。地形迴避的行為改用**新的**帶地形場景來守（§6.1）。

## 5. 介面

**`src/world/heightfield.ts`**（新，不 import three）

```ts
export interface HeightFieldData {
  readonly size: number        // 邊長格數（1024）
  readonly cell: number        // 格子邊長，m（40）
  readonly data: Float32Array
  sample(x: number, z: number): number   // 雙線性；出界回 -Infinity
}
```

**`src/world/archipelago.ts`**（新）

```ts
export interface IslandDesc { cx: number; cz: number; radius: number; peak: number }
export function generateArchipelago(seed: number): {
  field: HeightFieldData
  islands: readonly IslandDesc[]
}
```

**`src/render/island.ts`**（新）

```ts
export function createIslands(
  field: HeightFieldData, islands: readonly IslandDesc[],
): { object: Object3D; dispose(): void }
```

**`src/render/terrain.ts`**（改）

```ts
export type TerrainKind = 'sea' | 'archipelago'
```

**`src/ai/terrainSense.ts`**（新）

```ts
/** 可變，由 `senseTerrain` 就地填寫——240 Hz 熱路徑不得配置 */
export interface TerrainSense {
  ahead: number            // 正前 1.2 km 內「地形與海面」的最高點，m
  turn: -1 | 0 | 1         // 建議規避方向；0 = 不需要
}
export function senseTerrain(
  self: Aircraft, field: HeightField, time: number, out: TerrainSense,
): void
```

【為什麼吃 `HeightField`（含 `time`）而不是 `HeightFieldData`】海面也是地板。
AI 前視要的是「前方那個點的地板在哪」，那是地形與海面取大——正是
`Terrain.heightAt` 的語義。取樣點在島外時它退回純 Gerstner，與現況相同。

**`src/ai/safety.ts`**（改）

```ts
export type SafetyAction = 'none' | 'ground' | 'stall' | 'terrain'   // 加一個
export function applySafety(
  self: Aircraft, seaHeight: number, out: Command,
  cfg?: SafetyConfig, sense?: TerrainSense,                          // 新增可選參數
): SafetyAction
```

`sense` 不傳時**完全走原路徑**——既有單元測試一個字都不用改。

## 6. 量測與驗收

### 6.1 主要護欄：掃描式「任何進入角度都閃得掉」

> 群島裡任何一座島，從**任何方位、任何合法速度、任何俯衝角**進入，
> 三射線前視 + 拉起／轉向都不得撞上。

掃描維度：方位 16 × 速度 {400, 600, 800} km/h × 俯衝角 {0, −15, −30} × 島。

**這是本份唯一真正承重的測試。** 它的價值在於把「地形生成」與「AI 能力」
綁成一個閉環——生成器不能長出 AI 閃不掉的山，而不是靠人眼檢查。

### 6.2 其餘新測試（每一條先驗紅）

```
  heightfield.test.ts    格點上取樣 = 格點值（恆等式）、出界回海面、插值單調
  archipelago.test.ts    同種子逐位元相同、小島下限 300 m、島不重疊
  terrain.test.ts        kind 切換、children 次序契約、dispose 不漏
  terrainSense.test.ts   三射線幾何、相位錯開的覆蓋率
```

`archipelago` 的決定性是硬要求——模擬是全決定性的，地形不得破壞這一點。

### 6.3 不得退步的既有護欄

- `test/unit/perf-gate.test.ts` 的三個 900 µs
- `test/integration/ai-manoeuvre.test.ts`，特別是 **`safetyShare ≤ 5%`**
  （抓過度介入；新的 `'terrain'` 分支同樣受它管）
- `test/integration/ai-duel-matrix.test.ts`、`ai-defence.test.ts`
- `replayDigest`（`terrainField` 為 null，**預期逐位元不變**——若變了就是
  有東西漏進了 headless 路徑，那是 bug 不是重錄理由）

### 6.4 要重錄的

只有 `pixel-identical.e2e.ts`（畫面變了）。

### 6.5 效能量測

`senseTerrain` 是 20 Hz × 40 架 × 36 點。實作前先寫探針量真值，**不得用估算
下結論**。若超出 250 µs AI 預算，退路依序是：降到 10 Hz、減少射線取樣點、
加一層低解析「這附近有沒有陸地」的 bitmask 剔除。

## 7. 事前約定的否決條件

1. §6.1 的掃描若有任何一格撞上，**先調地形生成的約束**（降峰高、拉開間距），
   不調 AI 參數——AI 的能力是物理，地形是設計。
2. 若把地形約束調到「島矮到看不出是山」才過得了掃描，**整個 §4.3 的丙方案
   撤回**，改記為「安全層需要真正的橫向規避，另案處理」，並把掃描表寫進
   `applySafety` 的註解。
3. `replayDigest` 若在 `terrainField = null` 下改變，**停下來查根因**，
   不得重錄。

## 8. 風險

1. **`'terrain'` 分支過度介入。** 由 `safetyShare ≤ 5%` 守。三射線的左右
   射線可能在正常低空機動時誤報。
2. **§4.3 的爬升能力估算偏樂觀**（用固定 `recoveryPitch`，不計拉起耗時）。
   由 §6.1 掃描兜底。
3. **島的 LOD 這一輪不做。** 一座島在 40 km 外仍然畫 5,625 quad。靜態島
   預生成 2–3 級 LOD 很便宜，但先量了再決定。
4. **`heightAt` 在 240 Hz 熱路徑上變貴。** 現在是純 Gerstner，之後多一次
   插值。撞地判定是 40 架 × 240 Hz = 9,600 次／秒，應可忽略，但要量。

## 9. 明確不做

- **不做**遭遇戰選單的地形選項（`kind` 在 `main.ts` 寫死 `'archipelago'`）。
- **不做**海岸線與內陸地形（資料結構要能長到，但這一輪不生成）。
- **不做** AI 的地形**戰術**層（不追進峽谷、把敵人往山逼）——那要動
  `steer.ts` / `tactics.ts` / `command.ts`，是另一輪。
- **不做**島的 LOD、陰影、植被、地形貼圖。
- **不做**地面單位、防空砲、機場（`prompt.md` 的「未來」另一項）。
- **不改** `factor`、`clearance`、`recoveryPitch`、`lookahead`、
  `stallMargin` 的任何既有值。
- **不改** `recoveryAltitude` 的簽章與語義。
- **不改** `DEFAULT_STEER` 的任何參數。
- **不動** `assembly.ts` 的螺旋槳（名字撞了，見 §3.4）。

## 10. 全域限制

- 不得引入 `@types/node`。
- `noUncheckedIndexedAccess` 開啟。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體。
- 每一條新測試先驗紅。
- **不得為了讓測試通過而放寬門檻**——護欄重新定值是專案負責人的決定。
- commit 指定明確路徑，不得 `git add -A`。
- 型別檢查是 `npx tsc --noEmit`。
- `perf-gate.test.ts` 與 `rematch.test.ts` 必須單獨跑。
- 不寫飛機外形的測試。
