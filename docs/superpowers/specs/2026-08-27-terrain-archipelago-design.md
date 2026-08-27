# 群島地形 設計

**日期**：2026-08-27
**相關**：`2026-08-06-safety-lookahead-design.md`（安全層的**時間**前瞻。本份加的是
**空間**前瞻，而且刻意不動那一份的任何推導）

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

`safety.ts:285` 的 JSDoc 已經寫著「該點的海面（**未來為地表**）高度」——
這一份就是那個未來。

**但 `seaHeight` 不能直接改寫成「前方山高」**，見 §4.6。

## 3. 設計：單一高度場，兩種消費者

`render/terrain.ts` 立了一條鐵律：

> 【必須與畫面上那一份是同一份】…兩者分家的話，飛機會撞到一片看不見的海。

因此 **heightmap 是唯一真相**：CPU 端 `heightAt` 對它插值，渲染端從**同一份**
資料生成 mesh。不採用「CPU 一份解析函數、GLSL 一份解析函數」的做法——海面
現在能兩份並存是因為波是五道正弦、逐位元對得上，地形兩份實作漂開的機率
高得多，而症狀正是那條鐵律警告的東西。

### 3.1 高度場規格

**1024² @ 40 m/格 = 40.92 km 見方，`Float32Array` 4.2 MB。** 出界回海面。

40 m 是由三角形數推導的，不是調的。以陸地占 6% 估：

```
  格子    陸地三角形    對照：海面 286,720    一座 3 km 大島   一座 300 m 小島
  20 m     505,000      176% ← 太貴          150×150 格       15 格
  40 m     126,000       44%                  75×75 格         7.5 格
  80 m      31,600       11%                  38×38 格         3.75 格 ← 塌了
```

【海面的 286,720 怎麼來的】近海 clipmap 的 L0 是 `128²`、其餘九層各是
`128² − 64²`，合計 253,952 個三角形；遠海是一片四邊形 32,768。
（初稿寫 245,760，把 L0 也當成中空的，錯了。）

【為什麼粗格在這裡是對的，不是妥協】flatShading 的三角面本來就要看得見。
更重要的是它守住鐵律：畫面上那個山壁是 40 m 一段的斜面，而 `heightAt`
插值的**是同一個斜面**——玩家看到什麼就撞到什麼。

【格子大小不影響 `heightAt` 的成本】雙線性插值是 O(1)，40 m 與 2 m 一樣快。
粗格省的是三角形，不是查詢。

【`size` 是頂點數】`1024²` 個頂點、`1023` 個格距，跨度 `1023 × 40 = 40.92 km`。
單元測試要釘住正負邊界的精確值。

### 3.2 小島的尺度下限：300 m

40 m 格子下，一座 100 m 的島只有 2.5 格——長不出形狀。下限訂在 **300 m**
（7–8 格），那會長成一塊有三四個面的礁石，而在 low-poly 下那正是它該有的
樣子。低於下限的島生成器不放。

### 3.3 島形與 `outerRadius`——那條鐵律的一個缺口

島形完全解析，不用 noise 函式庫：

```
  r      = hypot(x − cx, z − cz) / radius
  wobble = 1 + 0.18·sin(3θ + φ₁) + 0.11·sin(5θ + φ₂)
  h      = peak · smoothstep(1, 0, r / wobble)
```

**`wobble` 最大是 1 + 0.18 + 0.11 = 1.29**，所以地形實際延伸到 `1.29 × radius`。

初稿讓 mesh 只切 `±radius`——那會讓高度場在 `1.29r` 處還有陸地、畫面上卻
沒有，**直接違反鐵律**。因此 `IslandDesc` 帶一個推導出來的

```
  outerRadius = radius × WOBBLE_MAX        // WOBBLE_MAX = 1.29
```

**mesh 切它、視錐包圍球用它、AI 的圓盤也用它。** 三個消費者共用同一個數字，
就不會有人切得比別人小。

### 3.4 綠色方塊移除

專案負責人裁定：`render/props.ts` 的浮動參照物**不再需要**。它只有一個
消費者，整個模組刪除。

**誤刪陷阱**：`props` 在這個 repo 裡有兩個意思——`render/props.ts` 是海面
參照物（刪），`assembly.ts` 的 `props` 與 `PROP_DISC_RENDER_ORDER` 是
**螺旋槳**（不能碰）。

連帶要動：`render/terrain.ts` 的 children 契約、`main.ts:1420` 的 `__gfx`
圖層鍵、`test/unit/terrain.test.ts`、兩支 e2e 的圖層清單。

## 4. 設計：AI 的地形感知

### 4.1 表示法：圓弧 × 圓盤，不是射線取樣

初稿是「沿航跡射七條線、每 100 m 取樣高度」。**那個做法被三個問題否決：**

**一、取樣會漏。** 步長 100 m 而格子 40 m，射線可以直接跨過一座 40–80 m 的
窄峰，或只擦過 300 m 小島不到一格。

**二、射線是直線，飛機走弧線。** 射線說「右 45° 是空的」，但飛機轉到 45°
需要 498 m 弧長；若障礙在 300 m 處，那時橫向只偏了 69 m，照撞。

**三、它不知道自己在繞什麼。** 射線是相對於**當下航向**的，飛機一轉，同一條
射線掃的就是另一塊區域——「該側仍然通」因此不等於「原本那條走廊仍然通」，
鎖存的解除條件寫不出來。

改用**解析**的表示法。島本來就是圓，飛機的轉彎軌跡也是圓：

```
  飛機軌跡   圓，半徑 R = V²/(g·√(n²−1))，圓心在側方 R 處
  島         圓，中心 (cx, cz)，半徑 outerRadius + 機體膨脹
  會不會撞   兩圓相不相交 —— 閉式解，一次 hypot、兩次比較
```

**沒有取樣就沒有 alias**，成本是 O(島數) 的加減乘，而且**知道自己在繞哪座島**
（島的索引），解除條件因此明確。

### 4.2 這個圓正不正確：重力與失速都在裡面，滾轉建立不在

`R = V²/(g·√(n²−1))` 的 **−1 就是重力**——它扣掉的正是撐住機重所需的那部分
升力。**失速**則由 `maxLoadFactorAero(spec, alt, tas)` 進到 `n` 裡；實測
P-51D 在 600／800 km/h 拿得到 8.00 G（結構極限），400 km/h 只有 **5.41**，
那就是失速限制在作用。

真正的誤差是**滾轉建立**——飛機得先滾到坡度才有向心力，那段時間軌跡近乎
直線。實測「橫向讓開 W 公尺所需的前進距離 ÷ 圓模型的答案」：

```
  機型      速度   R(m)  nMax │ W=100  W=200  W=400
  p51d       800    634  8.00 │  1.12   1.06   1.02   ← R 大，滾轉期佔比小
  p51d       600    357  8.00 │  1.26   1.19   1.16
  p51d       400    237  5.41 │  1.41   1.38   1.95
  bf109k4    600    381  7.50 │  1.37   1.27   1.23
  he111      400    375  3.50 │  1.52   1.42   1.39
  b17g       400    445  3.00 │  1.60   1.47   1.41   ← 低速重機，差最多
```

**不加修正係數。** 專案負責人裁定：「幾乎無時無刻都在檢查撞牆，這種誤差可以
接受。」依據有三：

1. 上表用的指令是瞄準正橫 90°，那是最極端的滾轉需求；實際避障只偏 15–30°，
   偏差會比表上小。
2. 每 12 tick 重檢一次，候選會**自動升級**——15° 不夠時下一次選 30°、
   再不夠拉起。
3. **§6.1 的掃描護欄直接驗證這件事。** 掃過了就證明不需要修正；沒過，
   會有「哪一格、差多少」的數據再定。

【這個裁定的已知風險，寫下來讓下一位知道】閉迴路吸收得了**隨機**誤差，
吸收不了**系統性偏差**。模型若一路樂觀，每次重檢都會得到同樣樂觀的答案，
不是「發現偏差」而是「一路 OK 到撞上」。上面第 2 點是它唯一的自救機制。
若 §6.1 掃出撞山，**第一個要試的就是把 `R` 乘 1.5**，而不是去調地形。

### 4.3 三種膨脹是三件不同的事

```
  機體膨脹      spec.wing.span / 2 + 餘裕     幾十公尺   飛機不是質點
  島形膨脹      radius × 1.29 = outerRadius   見 §3.3    地形超出標稱半徑
  半徑修正      不做（見 §4.2）                 —         滾轉建立
```

機體那一項相對於島半徑 1,500 m 是 1% 以下，幾乎不影響結果；真正決定成敗的
是後兩項。**由 `spec.wing.span` 推導而不是新增機型常數**——既有資料已經有了。

### 4.4 判斷的次序

每 `SENSE_INTERVAL` tick 跑一次：

```
  1  broad phase：水平航跡線段（長 SENSE_RANGE）對每座島的膨脹圓做
                 線段-圓相交。取最近的命中。
  2  沒有命中                    → floor = 海面、turn = 0、island = −1
  3  有命中，且爬得過                → floor = 沿途最高地形、turn = 0
                                    交給既有的 'ground' 分支
  4  爬不過                      → 決定繞的方向：島心在航跡的哪一側，
                                    就往反側繞
  5  驗算那個方向                 → 新航向的線段若進入**別座**島的圓，
                                    改試另一側；兩側都不行 → turn = 0，
                                    全力拉起（安全網）
```

【「爬得過」怎麼算 —— 沿剖面八點，不是拿峰高比一次】設計初稿寫的是
`y + d·tan(recoveryPitch) ≥ peak + clearance`，用到島心的距離對比峰高。
那個式子有一個方向不對：用島心距離是**樂觀**的（飛機在飛到島心之前就會
撞到坡面），用進入點距離則過度保守（要求飛機在剛進圓盤時就高過峰頂，
而它其實還有一整個 outerRadius 可以繼續爬）。

實作改成沿航跡取八點，對島的**解析剖面**檢查。

**那八個點不是空間取樣。** 我否決射線法正是因為取樣會漏窄峰 —— 但剖面是
平滑單調的 smoothstep，沒有窄峰可漏。八個點在這裡是數值積分，不是取樣。
剖面用 outerRadius 當尺度而不是 radius，等於假設每個方位都是最胖的那一個：
高估地形，偏保守。

**第 2 步就是「通道」情境的答案。** 左右各一座島、飛機從中間直穿——航跡線段
不進入任何圓盤，**不介入，直接飛過去**。這不是調參數調出來的，是這個表示法
天然給的。（射線法在這裡會反覆誤觸發，因為它問的是「正前方有多高」而不是
「我的軌跡會不會撞到誰」。）

### 4.5 鎖存：綁在**島的索引**上，不是綁在方向上

```ts
island: number        // 正在繞哪一座；−1 = 沒有
turn: number          // 承諾的航向偏移，rad
clearSamples: number
```

解除條件（全部要成立）：

```
  飛機已通過島心所在的橫斷面（(pos − centre) · 航向 > 0）
  且離開膨脹圓
  且連續 3 次感知都判定無威脅
```

【為什麼綁島而不是綁方向】方向是相對於當下航向的，飛機一轉那個方向就變了；
島的索引不會變。這是 §4.1 第三個問題的直接解法。

【承諾側暫時受阻不得立刻反轉】單次讀值只能升級成拉起，**不能反向**——
否則就是換一個觸發條件的乒乓。反轉需要連續多個感知週期都受阻。

【設計時的「最短鎖存 0.5 秒」，實作時拿掉了】那條的用意是避免「才轉 15°、
山還在翼尖前方」就交還控制權。但上面那三個幾何條件已經涵蓋它 —— 要通過
島心的橫斷面、**而且**離開膨脹圓、**而且**連續三次，飛機轉一點點是滿足
不了的。

加上時間下限反而有害：高速掠過一座 300 m 的小島只要兩三次感知就過去了，
硬等滿 0.5 秒的話 AI 會對著一個早就沒有威脅的方向繼續轉。是
`terrain-sense.test.ts` 的「飛過去之後解除鎖存」把它逼出來的。

### 4.6 `seaHeight` 不能直接改寫——它有四個其他讀者

`AiController.seaHeight` 還被 `stationPoint`、`stationCommand`、
`tacticalCommand`、`steerCommand` 讀。把「前方山高」寫進去，會讓整套站位與
戰術層以為地板抬高了，僚機會莫名其妙爬升。

**只在 `emit` 裡建一個局部值**餵給 `applySafety`：

```ts
const floor = this.terrain === null ? this.seaHeight : this.sense.floor
this.safetyAction = applySafety(self, floor, out, undefined, this.sense)
```

### 4.7 `time` 的來源

`AiController.update(self, dt, out)` **沒有世界絕對時間**，而 Gerstner 波要它。

**第一版 AI 只看靜態陸地，海面一律以 0 計。** 波高 ±4.7 m 相對於
`clearance` 120 m 是 4%，而安全層的餘裕本來就是為了蓋這種量級。
不為了 4% 去替每架 AI 接一條時間線。

（真要精確，做法是 `main.ts` 注入一個捕捉當前 `elapsed` 的共享 closure——
**不能**讓每架 AI 自己累加時間，那會漂。）

### 4.8 每 12 tick 重算，按機號錯開相位

```
  240 Hz、800 km/h 下每 tick 走      0.926 m
  每 12 tick（20 Hz）兩次之間走      11.11 m   ← 遠小於格距 40 m
  角落速度的最大轉率 44.2°/s，
  50 ms 轉 2.21°，1.2 km 外橫向      46 m      ← 超過一格，見下
```

【初稿的兩個數字都錯】初稿寫「走 9.7 m」（用了 700 km/h 而非 800）與
「轉 1.15°」（用 8G 巡航轉率 23°/s，而真正的最大轉率在**角落速度**是
44.2°/s）。修正後 46 m **超過一格 40 m**，所以「仍在一格內」不成立。

**但這對圓盤法無害**——它不查格點，查的是島心距離；50 ms 內島心距離的變化
遠小於 `outerRadius`。這個缺陷是射線取樣法才有的，換表示法之後自然消失。

**仍然要按機號錯開相位**：40 架同一 tick 全算會做出週期性尖峰，
而那會直接打在 `frame-time.e2e.ts` 量的 1% low 上。

### 4.9 注入：public 欄位，與 `target` 同一個模式

```ts
class AiController {
  terrain: TerrainSource | null = null   // 新增，null = 平海面
}
```

**`terrain` 為 null 時，輸出的浮點與既有狀態逐位元相同**，所以既有的對戰
矩陣、AI 護欄、`replayDigest` 全部不受影響、不必重錄。

（初稿寫「程式碼路徑完全相同」，字面上不成立——會多一次 null 判斷、多一個
sense 物件。能成立的主張是逐位元相同的**輸出**。）

**注入點不只一處。** `playerAi` 跨場重用，而 `resetBattle` 在玩家接手過座位
後會建立新的 `AiController`（`setup.ts:1066`）。因此 `main.ts` 要有一個
`wireTerrain()`，在 `enterBattle`、`restartBattle`、換座位、respawn 之後統一
呼叫，並且**同時清掉鎖存狀態**。初稿估的「+6 行」太樂觀。

## 5. 介面

```ts
// src/world/heightfield.ts   —— 不 import three
export interface HeightFieldData {
  readonly size: number      // 頂點數（1024）
  readonly cell: number      // 格距，m（40）
  readonly data: Float32Array
  sample(x: number, z: number): number     // 雙線性；出界回 -Infinity
}

// src/world/archipelago.ts
export interface IslandDesc {
  readonly cx: number; readonly cz: number
  readonly radius: number        // 標稱
  readonly outerRadius: number   // radius × 1.29 —— mesh、包圍球、AI 圓盤共用
  readonly peak: number
}
export function createArchipelago(): {
  field: HeightFieldData
  islands: readonly IslandDesc[]
}

// src/render/island.ts
export function createIslands(
  field: HeightFieldData, islands: readonly IslandDesc[],
): { object: Object3D; dispose(): void }

// src/render/terrain.ts
export type TerrainKind = 'sea' | 'archipelago'

// src/ai/terrainSense.ts
export interface TerrainSource { readonly islands: readonly IslandDesc[] }
export interface TerrainSense {
  floor: number         // 餵給 applySafety 的地板高度
  turn: number          // 承諾的航向偏移，rad；0 = 不需要
  island: number        // 正在繞哪一座；−1 = 沒有（鎖存）
  clearSamples: number
  heldTicks: number
}
export function createSense(): TerrainSense
export function resetSense(s: TerrainSense): void
export function senseTerrain(
  self: Aircraft, src: TerrainSource, out: TerrainSense, cfg?: SafetyConfig,
): void

// src/ai/safety.ts
export type SafetyAction = 'none' | 'ground' | 'stall' | 'terrain'
export function applySafety(
  self: Aircraft, seaHeight: number, out: Command,
  cfg?: SafetyConfig, sense?: TerrainSense,      // 新增，可選
): SafetyAction
```

`sense` 不傳時**完全走原路徑**——既有單元測試一個字都不用改。

【`senseTerrain` 只吃 `islands`，不吃 `HeightFieldData`】圓盤法不查高度場。
這讓 AI 完全不依賴格點解析度，也讓它可以在沒有渲染的 headless 測試裡跑。
**碰撞與渲染仍然以 heightmap 為唯一真相**；圓盤只是 AI 的保守 broad phase，
不構成第二份可碰撞地形。

## 6. 量測與驗收

### 6.1 主要護欄：飛行掃描

> 從各方位、各機型的合法速度區間進入代表性障礙，**不得撞上**，
> **而且要在期限內通過**。

- 障礙取三個代表：最寬、最高、最小
- 機型取四種，**各用自己的合法速度區間**（800 km/h 對 K-4／B-17／He 111
  不是合法速度，初稿的「任何合法速度 {400,600,800}」是錯誤描述）
- 方位 8 向

**只斷言「不撞」不夠**——原地繞圈、或永遠維持 terrain 接管也能通過。
因此同時斷言：

```
  不得撞上
  在期限內通過障礙（離島距離重新增加）
  鎖存最終解除（island 回到 −1）
  最大連續接管時間有上界
```

【為什麼過度介入不能靠 `safetyShare ≤ 5%` 守】那條在 headless 平海面跑，
`terrain` 是 null，新分支根本不會執行。**地形場景要自己量。**

### 6.2 其餘新測試（每一條先驗紅）

```
  heightfield.test.ts    格點取樣 = 格點值、線性內插、正負邊界的精確跨度
  archipelago.test.ts    固定地形逐位元決定性、小島下限、峰高上限、
                         **島間距足夠讓通道穿過**
  terrain.test.ts        kind 切換、dispose 不漏
  terrain-sense.test.ts  通道直穿不介入、爬得過走 ground、爬不過走 terrain、
                         **鎖存不反轉**、通過後解除、reset 清空
  render/collision 一致  mesh 的頂點高度 = field.sample（鐵律的護欄）
```

【砍掉的測試】Codex 指出下列偏向「為測而測」，全部不寫：不同 seed 產生
不同地形（產品不需要多 seed）、島心恰好等於 peak（島心不落在格點上，
雙線性後不保證）、距離 2r 為零（重述解析公式）、全零場處處為零（實作細節）、
自建一份 288 格「不傳 sense 等同修改前」（沒有舊實作 oracle，只會複製一份
舊邏輯——既有安全單元測試加 `replayDigest` 已經足夠）。

`children` 固定索引契約也不新增——那是 `__gfx` 工具造成的耦合，不是地形的
產品契約；改既有那條測試即可。

### 6.3 不得退步的既有護欄

`perf-gate` 三個 900 µs、`ai-manoeuvre`、`ai-duel-matrix`、`ai-defence`、
`replayDigest`。**基準是全綠的**（2026-08-27 實測 126 檔 2,964 條，零紅），
所以任何一條紅都是本份造成的。

### 6.4 `pixel-identical`：讓島顯示，但沒有東西要「重錄」

初稿自相矛盾：一邊把圖層鍵改成 `islands` 並隱藏，一邊又說要重錄群島畫面。
**讓島顯示** —— 這一輪的重點就是畫面上要有島，把它藏起來驗海面沒有意義。
而且它是固定種子的解析生成，逐像素可重現，跟原本那 600 個撒點的參照物不同。

**但「重錄」這個詞用錯了。** 那支工具沒有 committed 的基準檔：它的流程是
「改動前跑一次存 before-、改動後跑一次存 after-、手動比對」，產物在
`.shots/pixel/`。所以這一輪要做的只是確認它改過圖層名之後仍然跑得動，
沒有基準要更新。

### 6.5 效能

**不新增 probe 檔案。** 用既有的 `perf-gate`（AI 預算 250 µs）與
`frame-time.e2e.ts`（1% low）。需要細節時做一次性量測，不留檔。

圓盤法是 O(島數) 的加減乘，沒有高度查詢——若這樣還超預算，退路是降到
10 Hz，或先用島的粗網格做空間剔除。

## 7. 事前約定的否決條件

1. §6.1 掃出撞山 → **先把 `R` 乘 1.5**（§4.2 的已知風險），再考慮調地形。
2. 若必須把地形調到「島矮到看不出是山」才過得了，**`'terrain'` 分支撤回**，
   掃描表寫進 `applySafety` 的註解，改記為「安全層需要真正的橫向規避，
   另案處理」。
3. `replayDigest` 若在 `terrain = null` 下改變 → **停下來查根因**，不得重錄。

## 8. 風險

1. **`'terrain'` 過度介入**，由 §6.1 的接管時間上界守。
2. **滾轉建立的系統性偏差**（§4.2），由 §6.1 守，退路是乘 1.5。
3. **島的 LOD 這一輪不做**——一座島在 40 km 外仍然畫滿。先量再決定。
4. **`heightAt` 變貴**：撞地判定 40 架 × 240 Hz，多一次插值。應可忽略，要量。

## 9. 明確不做

- **不做**遭遇戰選單的地形選項（`main.ts` 寫死 `'archipelago'`）。
- **不做**海岸線與內陸地形。
- **不做** AI 的地形**戰術**層（不追進峽谷、把敵人往山逼）。
- **不做**島的 LOD、陰影、植被、地形貼圖。
- **不做**多候選軌跡採樣——圓盤的 broad phase 加兩側驗算已經夠。
- **不加**轉彎半徑修正係數（§4.2 的裁定）。
- **不改** `factor`、`clearance`、`recoveryPitch`、`lookahead`、`stallMargin`。
- **不改** `recoveryAltitude` 的簽章與語義。
- **不動** `assembly.ts` 的螺旋槳（名字撞了，見 §3.4）。

## 10. 全域限制

- 註解與 commit message 用繁體中文；註解寫現狀，不寫沿革。
- 不得引入 `@types/node`。`noUncheckedIndexedAccess` 開啟。
- `src/ai/` 的 240 Hz 熱路徑不得配置記憶體；不得 `Math.random`。
- 每一條新測試先驗紅。**不得為了讓測試通過而放寬門檻。**
- commit 指定明確路徑，不得 `git add -A`。
- 這台機器的指令：`node node_modules/vitest/vitest.mjs run`、
  `node node_modules/typescript/bin/tsc --noEmit`
  （`npx tsc` 會抓到系統上另一支同名程式）。
- `perf-gate.test.ts` 與 `rematch.test.ts` 必須單獨跑。
- 不寫飛機外形的測試。
