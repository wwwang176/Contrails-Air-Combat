# 實作計畫：島的起伏與海岸浪花

SPEC：`docs/superpowers/specs/2026-08-28-island-relief-shore-foam-design.md`

## 步驟一：多瓣島（`src/world/archipelago.ts`）

### 1.1 常數

```ts
/**
 * 每座島額外抽幾瓣。**不論用不用得上都抽這麼多組** —— 抽的次數固定，
 * LCG 的序列才不會因為「這座島留了幾瓣」而漂。
 */
const LOBE_DRAWS = 4
/** 一瓣至少要有這麼大才畫得出形狀，m。1.5 格 —— 再小只是一個尖角 */
const LOBE_MIN_RADIUS = 60
/** 瓣半徑佔島半徑的比例 */
const LOBE_RADIUS = [0.30, 0.62] as const
/**
 * 瓣高佔島峰高的比例。上界貼近 1 才有雙峰與鞍部；**恆小於 1**，
 * 所以 `peak` 仍然是實際的最高點（`PEAK_MAX` 因此不必重新定值）。
 */
const LOBE_PEAK = [0.35, 0.92] as const
/**
 * 瓣心離島心的距離，佔**還放得下的最大偏移**的比例。下界不為 0 ——
 * 同心的瓣被主瓣蓋掉，等於白抽。
 */
const LOBE_OFFSET = [0.45, 1.0] as const
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
const r = isl.radius * between(LOBE_RADIUS[0], LOBE_RADIUS[1])
// 【偏移由「還放得下多少」反推】不變式因此是恆等式，不是要驗的條件
const room = isl.outerRadius - r * WOBBLE_MAX
const off = room * between(LOBE_OFFSET[0], LOBE_OFFSET[1])
const dir = rand() * Math.PI * 2
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
float crestGain = max(1.0 + uCrestBias * crest, 0.0);
float p = (align * uDensity + shore * uShoreDensity) * fade * crestGain;
```

**`shore = 0` 時兩式逐字等價** —— `max` 那一層原本擋的就是 `crestGain < 0`，
現在提前擋在 `crestGain` 上。

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

## 附錄：Codex 審查抓到的 BLOCKER

（待填）
