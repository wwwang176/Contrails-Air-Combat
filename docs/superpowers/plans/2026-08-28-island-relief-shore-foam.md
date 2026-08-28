# 實作計畫：島的起伏與海岸浪花

SPEC：`docs/superpowers/specs/2026-08-28-island-relief-shore-foam-design.md`

## 步驟一：多瓣島（`src/world/archipelago.ts`）

### 1.1 常數

**以下是計畫階段寫的形狀；實際落地的常數見 `src/world/archipelago.ts`，
差異記在附錄二。**

```ts
const LOBE_COUNT = 4          // 主瓣之外每座島幾瓣
const LOBE_MIN_RADIUS = 60    // 一瓣至少 1.5 格才畫得出形狀
const LOBE_RADIUS = [0.28, 0.45] as const   // 瓣半徑佔島半徑
const LOBE_LIFT = 0.08        // 至少比主瓣高出島峰的幾成
const LOBE_SLOPE = 2.0        // 瓣最陡是主瓣的幾倍（守 occlusion 的步長）
const LOBE_LIFT_MAX = 100     // 最多比主瓣高出幾公尺（守飛行掃描）
```

### 1.2 資料形狀

`phase: {a, b}[]` 換成 `lobes: Lobe[][]`（與 `islands` 同索引）：

```ts
interface Lobe {
  /** 瓣心的世界座標 */
  cx: number
  cz: number
  /** 標稱半徑 m；地形延伸到 radius × WOBBLE_MAX */
  radius: number
  peak: number
  pa: number
  pb: number
}
```

錨島與隨機島都經過同一支 `makeLobes(isl, pa, pb, draw)`，其中主瓣是
`{cx: isl.cx, cz: isl.cz, radius: isl.radius, peak: isl.peak, pa, pb}`。

**錨島不呼叫 `rand()` 這件事必須守住** —— 它們的瓣也要是常數。做法：
`ANCHORS` 各多帶一組寫死的瓣參數（四組 `[dir, off, rf, pf, pa, pb]`），
`makeLobes` 吃一個 `draw: () => number` 或一個常數陣列的讀取器，兩邊共用
同一段幾何推導。

### 1.3 偏移的不變式

```ts
const r = Math.max(LOBE_MIN_RADIUS, d.rf * radius)
// 【一律放到還放得下的最遠處】off + r × WOBBLE_MAX = outerRadius 因此是
// 恆等式，不是要驗的條件。那裡主瓣最低，所以同樣的峰高露出得最多
const off = outerRadius * (1 - r / radius)
```

### 1.4 `bake`

內層迴圈由「一座島一條 smoothstep」換成「對這座島的每一瓣取 max」。
島層級的 `if (d > isl.outerRadius) continue` 早退保留（所有瓣都在裡面）。

### 1.5 血緣

`createArchipelago` 的回傳形狀不變（`{field, islands}` 再加一個 `shore`，
見步驟二）。`IslandDesc` 不變 —— AI 的圓盤仍然只看 `outerRadius`。

## 步驟二：膨脹圖（`src/world/archipelago.ts`）

```ts
/** 浪花帶的寬度，m。5 格 —— 貼圖一個 texel 就是一格 */
export const SHORE_BAND = 200

export interface ShoreFieldData {
  readonly size: number
  readonly cell: number
  /** size² 個 0–255。255 = 岸上。列優先，與 HeightFieldData 同一套索引 */
  readonly data: Uint8Array
}

export function bakeShore(field: HeightFieldData): ShoreFieldData
```

兩趟 chamfer 距離（正交 1、對角 √2，單位是格），再
`v = smoothstep(bandCells, 0, d)`，寫成 `round(v * 255)`。

【為什麼不是逐島解析算】步驟一大改海岸線的形狀，而膨脹圖吃烘好的
`field.data` —— 海岸線怎麼變它自動跟著走，兩份不可能漂。

## 步驟三：貼圖與著色器（`src/render/ocean.ts`）

### 3.1 簽名

`createOcean(shore: ShoreFieldData | null): Ocean`。`null`（純海面）掛一張
1×1 的零貼圖，`uShoreExtent = 1`。

```ts
const shoreTex = new DataTexture(
  shore ? shore.data : new Uint8Array(1),
  shore ? shore.size : 1, shore ? shore.size : 1,
  RedFormat, UnsignedByteType)
shoreTex.minFilter = LinearFilter
shoreTex.magFilter = LinearFilter
shoreTex.wrapS = ClampToEdgeWrapping
shoreTex.wrapT = ClampToEdgeWrapping
// 【1×1 的退化貼圖列長不是 4 的倍數】預設 unpackAlignment = 4 會讀過界
shoreTex.unpackAlignment = 1
shoreTex.needsUpdate = true
```

### 3.2 UV

`uv = faceCen / uShoreExtent + 0.5`，其中 `uShoreExtent = size * cell = 40,960`。

【為什麼是 `size × cell` 而不是 `(size − 1) × cell`】GL 的第 `col` 個 texel
中心在 `(col + 0.5) / size`。高度場的 `col = x / cell + (size − 1) / 2`，
代進去正好是 `x / (size·cell) + 0.5` —— 偏移恰好是 0.5，不必另外傳。
用 `(size − 1) × cell` 會整張差半個 texel（20 m）。

【場外不必判斷邊界】島散布在 ±16.9 km 內，場地半寬 20.48 km，所以邊緣的
texel 恆為 0；`ClampToEdgeWrapping` 讓場外自然取到 0。

### 3.3 機率式

`FACE_FRAGMENT` 內，`faceCen` 算好之後：

```glsl
// 【在面的重心取樣】與 faceH 同一個理由 —— 逐片段取樣會把一個三角形
// 切成半白半不白。
float shore = texture2D(uShoreMap, faceCen / uShoreExtent + 0.5).r;
```

並把

```glsl
float p = max(align * uDensity * fade * (1.0 + uCrestBias * crest), 0.0);
```

換成

```glsl
p += max(shore * uShoreDensity * fade * (1.0 + uCrestBias * crest), 0.0);
p = min(p, uPMax);
```

**原式一個字都不動** —— 改寫成 `(align × uDensity + shore × uShoreDensity)
× …` 讀起來漂亮，但那樣 `shore = 0` 時就不再逐位元等於改動前（運算圖變了，
而 GLSL 不保證不同算式數值一致）。這是 Codex 的 SHOULD-FIX 之一。

新常數：`SHORE_DENSITY = 0.45`（起手值，看截圖調）。

## 步驟四：接線（`src/render/terrain.ts`）

`createTerrain` 現在先 `createOcean()` 再 `createArchipelago()`。對調：

```ts
if (kind === 'sea') { const ocean = createOcean(null); ... }
const { field, islands } = createArchipelago()
const ocean = createOcean(bakeShore(field))
```

`group.add` 的次序（遠海、近海、陸地）**不得改變** —— `__gfx` 的消融表與
`src/tools/` 兩支工具靠索引。

## 步驟五：測試（先驗紅）

| 檔案 | 條 | 守什麼 |
|---|---|---|
| `archipelago.test.ts` | `outerRadius` 外恰好是 `SEA_FLOOR` | 瓣溢出 = 撞到畫面上沒有的陸地 |
| | 島心恰好是 `peak` | `PEAK_MAX` 仍是實際最高點 |
| | 沿半徑非單調 | **起伏真的存在**，不是換了個寫法的同一顆圓錐 |
| | 逐位元決定性（既有） | 錨島仍然不吃 `rand()` |
| | 膨脹圖：岸上 255、帶外 0、帶內單調 | |
| `ocean.test.ts` | 兩個材質都取樣 `uShoreMap` | |
| | 取樣點是 `faceCen` 不是 `vOceanWorld` | 半白半不白 |
| | `shore = 0` 時機率式等價 | 回歸保護 |
| `terrain-in-play` | 重量三條 | 坡度變陡的後果 |

## 步驟六：截圖

`island-shot.e2e.ts`（已寫好）before / after 五個姿態對比。

## 附錄一：Codex 審 PLAN 抓到的兩個 BLOCKER

1. **`terrainSense` 會低估偏心的次峰。** `profileHeight` 假設高度是離島心
   距離的單調函數，`checkClimb` 又假設沿航跡的最大值落在離島心最近的那一點
   —— 多瓣之後兩者都不成立。Codex 的反例用的全是合法參數，低估 704 m；
   我自己在真的群島上量到 284 m。**低估的方向是「我爬得過去」。**
   → 改成 `terrainCeiling(isl, x, z)`：逐瓣量真正的二維距離取 max，
   並在 `checkClimb` 補上每一瓣自己的最近點。

2. **計畫裡的整合測試擋不住那件事。** `terrain-in-play` 不要求撞山為零；
   `terrain-avoidance` 的註解明寫「島圓對稱，換方位不增加覆蓋」而只取兩個
   方位 —— 那句話對多瓣的島不成立。
   → 方位改回八個（192 → 768 組，3.6 → 9.3 s）。

十個 SHOULD-FIX 裡照做的：貼圖要 `dispose`（`material.dispose()` 不收
uniform 裡的貼圖）；著色器測試要真的呼叫 `onBeforeCompile` 檢查 uniform
有沒有綁上去（宣告了 sampler 卻沒綁也會編譯過、字串斷言全綠）；遠海一個面
480 m 比浪花帶 200 m 還寬，逐點取樣會整條帶漏掉 → 取 mip；機率會超過 1 →
封頂；膨脹圖只在 `createTerrain` 烘一次（`createArchipelago` 不回傳它）；
「島心恰好等於 peak」不是合法的高度場斷言（島心不落在格點上）→ 改成掃格點。

三個 NIT 是複驗通過的確認：`outerRadius` 的三角不等式（θ 由瓣心量起不影響）、
uv 的半個 texel 推導、`DataTexture` 在 three 0.180 的預設（`unpackAlignment`
本來就是 1，`ClampToEdge` 也是預設，計畫裡那兩行是多餘的）。

## 附錄二：實作時才發現的兩件事

1. **AI 的模型太保守會讓另一條護欄變紅。** 第一版 `terrainCeiling` 取的是
   「離島心 dist 那一整圈上最高的瓣」—— 是合法的上界，但航跡從東邊掠過時會
   被島**西邊**的次峰嚇到。結果是 AI 提早爬升、從不橫向規避，
   `terrain-in-play` 的「山真的擋得住路」由 5/40 掉到 0/40。改成逐瓣量二維
   距離之後兩件事一起解決。

2. **撞山的成因不是坡度，是側翼被墊高。** 離錨島心 1,200 m 那一圈，圓錐是
   236 m 而不封抬升的多瓣是 443 m —— 那一圈正是「已經轉開主峰、沿著島邊繞
   出去」的飛機所在的地方。所以上限要封**絕對抬升**（`LOBE_LIFT_MAX`）而不是
   比例：比例會連坐小島，而一座 160 m 的礁石殺不死轟炸機。
