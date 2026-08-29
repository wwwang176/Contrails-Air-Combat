# 植被 LOD 修訂與地面圖案抗鋸齒

2026-08-29。承接 `2026-08-29-vegetation-lod-design.md`，改四件試飛回報的事。
Codex 審過一輪，第 2.4 節整段重寫。

## 一、要解決的四個問題

### 1.1 LOD 換級時樹種會變

`render/vegetation.ts` 的 `poolOf` 把兩種樹在 L1／L2 併成同一個池：

```ts
case FloraKind.BroadTree: return lod === 0 ? 'broadL0' : lod === 1 ? 'treeMid' : 'treeFar'
case FloraKind.ConeTree:  return lod === 0 ? 'coneL0' : lod === 1 ? 'treeMid' : 'treeFar'
```

`treeMid` 是八面體、`treeFar` 是四邊錐，兩者都用 `BROAD_LEAF` 的顏色。後果：

- **針葉樹過 450 m**：尖錐 → 八面體，同時 `CONIFER 0x2f4530` → `BROAD_LEAF 0x3f5233`。
  形狀與顏色一起換。
- **闊葉樹過 1,100 m**：八面體 → 四邊錐。圓的東西變尖的。

兩種樹各在一個門檻上換成另一個樹種的模樣。

### 1.2 最外圈太近

`FLORA_RADIUS = 2000`。甲板高度平飛時樹在 2 km 處成列冒出來，而 15 m 的樹在
2 km 外仍有約 12 px。加上 `REBUILD_MOVE = 200` 的重建閘，冒出來是**整批**的。

樹幹門檻 `LOD_NEAR = 450` 在 150 m/s 下只有 3 秒。

### 1.3 遠方的線條爬行鋸齒

`render/fields.ts` 的 `fieldColorAt` 對凹路與樹籬帶各做一次硬判斷：

```glsl
if (r2 - r1 < TRACK_WIDTH) return TRACK_COLOR;
if (float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE
  && best < HEDGE_WIDTH * 0.5) return HEDGE_COLOR;
```

`render/scene.ts` 的 `antialias: true` 幫不上忙 —— MSAA 只解析幾何邊緣，
片段著色器一個像素仍然只跑一次，帶的內部邊界是在單一取樣點上做的二選一。
一個像素蓋到的地一超過 18 m，那個二選一就隨鏡頭微動翻面。

### 1.4 樹的三角形繞反了（已修，commit a5794e3）

`floraShapes.ts` 的 `cylinder`／`cone`／`octa` 三個圓形基本體繞序是反的，
五個植被幾何與教堂的尖頂因此內面朝外。材質是 `FrontSide`，背面剔除開著，
所以畫面上是遠側那一面的內側。已補一條逐面的測試。

## 二、決定

### 2.1 兩級，分樹種

池由「近／中／遠 × 不分樹種」改成「近／遠 × 分樹種」。池數維持 8 個，
draw call 不變。

```
  broadNear  0 – 900 m    圓柱幹 ＋ 八面體冠（BROAD_LEAF）    20 tri
  broadFar   900 m +      八面體冠（BROAD_LEAF）               8 tri
  coneNear   0 – 900 m    圓柱幹 ＋ 七邊錐（CONIFER）          19 tri
  coneFar    900 m +      六邊錐（CONIFER）                     6 tri
  bush / house / barn / church                                 不變
```

**為什麼砍成兩級，而不是補成三級分樹種。** 一個從各角度都讀得出「圓」的形狀
最少就是 8 個三角形（八面體），所以遠級再省也省不下來。實測
（`test/tools/flora-radius.probe.ts`，R = 3 km）三級分樹種是 184k 三角形、
兩級是 187k —— 第三級買不到效能，只多一個會跳的門檻。

**遠級不是近級的簡化，是同一個輪廓的便宜版。** 闊葉遠近都是圓的八面體，
針葉遠近都是尖錐；換級只掉樹幹與幾個面，不改剪影也不改顏色。

### 2.2 樹幹門檻 900 m

樹幹直徑 1 m。960 px 高、60° 垂直視角下，1 m 在 d 公尺外約占 `917 / d` 個像素：

```
   門檻   樹幹 px   150 m/s 飛過的秒數
    450     2.04       3.0
    900     1.02       6.0
   1200     0.76       8.0
```

**900 m 是樹幹剛好掉到 1 px 的距離。** 再往外就是在畫看不見的東西。
成本只有 25k 三角形（228k → 253k），因為一棵樹升級只多 12 個三角形。

### 2.3 維持半徑 3 km、灌木 1.2 km

`test/tools/flora-radius.probe.ts`，24 個位置各取最大同時實例數：

```
     R   灌木R    格數   broadNear coneNear   broadFar  coneFar    bush   三角形
  2000     900     208         840      548       7342     3588    5054     120k
  2500    1100     318         840      548      11429     4578    7085     172k
  3000    1200     455         840      548      16379     6166    8314     228k
  3500    1200     620         840      548      21592     8204    8314     282k
  4000    1200     812         840      548      29462    10275    8314     344k
```

加上樹幹門檻 900 m 之後，R = 3 km 是 **253k**。地形本身是 281k，今天的植被
是 129k。

`TILE_CACHE` 由 288 抬到 560。預配的 tile 緩衝因此由 3.7 MB 變 7.2 MB
（每槽 `512 × 6 × 4` bytes 的資料加 512 bytes 的 kind）。

**這一項有兩個效能風險，都要量。**

1. **上傳。** 上一輪釘死的結論是「停頓隨 `bufferSubData` 的次數走，不隨量走」
   —— 半徑砍半、最大的緩衝整條消失時一點改善都沒有。放大半徑不增加上傳次數，
   所以理論上安全；但那是在 12.7 頓挫/s 的壞區間量的，現在是 0.90。
2. **每幀掃描。** `fill` 的候選範圍由 17×17 變 25×25，`evict` 與 `relevel`
   各掃 560 個槽。穩態約每幀 1,600 次小迴圈，缺格時最多約 5,000 —— 舊版的
   2～5 倍。這不會製造頓挫，但會抬 p50。

**所以驗收要同時看 p50、1% low 與頓挫，不能只看頓挫。**

### 2.4 帶的邊緣改用解析盒濾波

新增一個 GLSL 輔助函數：

```glsl
float bandCoverage(float d, float halfW, float w) {
  return clamp((min(d + w, halfW) - max(d - w, 0.0)) / (2.0 * w), 0.0, 1.0);
}
```

`d` 是到帶中心線的距離（恆為非負），`halfW` 是帶的半寬，`w` 是像素在地面上
的半足跡。這是把「帶」在像素的 `[d − w, d + w]` 區間上做**盒濾波**：重疊長度
除以區間長度。

**極限行為是可以寫下來的**：`w → ∞` 時回傳值趨近 `halfW / w`，也就是那條帶
在像素裡的真實面積比 —— 遠處的細線會**變淡**而不是變寬。
`1 - smoothstep(halfW - w, halfW + w, d)` 沒有這個性質：`w` 超過帶寬時它把
影響範圍撐到 `halfW + w`，遠處會變成一片過暗的灰霧。

**足跡要在函數最前面無條件算，而且用世界座標：**

```glsl
float px = 0.5 * length(vec2(fwidth(world.x), fwidth(world.y)));
```

- **不能用 `fwidth(best)`。** `best` 是四條外框加一條切線的 `min`，在最近邊
  換手的角平分線上連續但不可微 —— 田角會長出楔形接縫，而且鏡頭移動時
  2×2 的 fragment quad 跨過換手線會讓 `fwidth` 跳，變成另一種爬行。
- **不能放在分支裡。** 導數指令在 quad 內分歧時結果不可靠。`world` 是內插的
  varying，處處平滑。

`fieldColorAt` 由「提早 return」改成「先算田的底色，再依覆蓋率疊上去」，
**優先序一個字都不動**：

```
  底色    wood > ploughed > 作物色盤
  條紋    只套在作物與犁田上，wood 沒有（與現況、與 CPU 版一致）
  疊加    先 hedge，再 track
```

**現況的順序本來就是 `TRACK → HEDGE → WOOD → PLOUGH → 作物`**，樹籬判斷在
樹林之前 —— 所以樹林的田本來就有樹籬，這次不是在修那件事。

### 2.5 這一次不處理的

- **田與田之間的色階跳變。** 要抗它得同時算出相鄰兩格的顏色，著色器會長一倍。
  樹籬帶正好蓋在多數的格線上（`HEDGE_CHANCE = 0.92`），沒有樹籬的那些邊界
  兩側是相近的色階。
- **`edgeKey` 在角平分線上的硬換手。** 兩條邊一條有樹籬一條沒有時，
  `isHedge` 本身在田角形成一條沒有抗鋸齒的斜線。約 14.7% 的邊對會遇到。
  它在遠處會隨覆蓋率一起變淡，所以順位在色階跳變之後。

## 三、CPU 與 GLSL 的分歧

鐵律仍然是「`fieldAt` 與 `fieldColorAt` 是同一份公式」。核可的分歧有兩項：

1. `stripe()` —— 犁溝條紋只在 GPU 上做。
2. **（新）帶的邊緣覆蓋率。** `fieldAt` 與 `fieldSurfaceColor` 維持二值，
   因為樹的位置靠它；GPU 端在遠處把邊界化開。近距離 `w → 0` 時覆蓋率收斂
   回二值，所以樹的位置與看到的暗帶仍然對得上。

**田格、`id`、`best`、`edgeKey`、`hedged` 的公式一個字都不改。**
`fields.test.ts` 那條「GLSL 與 CPU 逐行對得上」的金本位會因為
`if (float(fieldHash1(edgeKey)) ...` 改寫成 `bool isHedge = ...` 而紅 ——
那正是它的工作。釘的那一行跟著改成新的寫法，內容一樣。

## 四、驗收

1. `flora-shapes.test.ts`：四個喬木幾何的三角形數、底面在 y = 0、逐面朝外；
   **新增**：`broadNear`／`broadFar` 樹冠同色、`coneNear`／`coneFar` 樹冠同色，
   兩組不同色。這一條正面擋住 1.1。
2. `vegetation.test.ts`：`poolOf` 的**四個映射逐一比對**（不是只驗前綴 ——
   「兩級都回 `broadNear`」或「近遠對調」都要紅）。
3. `CAPACITY` 重新定值：**先用哨兵容量（十萬）掃**，因為 `v.counts` 會被
   `CAPACITY` 截斷，用正式容量掃是循環量測。定值後對每一池做變異驗證：
   容量降到實測最大以下必須讓 `stats.overflow > 0`。
4. `fields.test.ts` 對 GLSL 的新測試要守得住這些錯誤實作：
   宣告 `bandCoverage` 卻不呼叫、只是把硬判斷改寫成三元式、參數傳錯、
   疊色順序反了、`return WOOD_COLOR` 還在、wood 被套上 stripe。
   語法由 `glsl-compile.e2e.ts` 在真的 WebGL2 裡編譯來守。
5. 幀時間 A/B：**p50、1% low、頓挫三個都要看。** 頓挫 ≤ 1.2/s，
   p50 相對關植被不得多 4 ms 以上。
6. 試飛截圖：甲板平視地平線（看鋸齒）、900 m 門檻附近（看樹幹消失得順不順）、
   針葉密的一塊（看遠處還是不是深綠的尖）。
