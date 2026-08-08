# 戰場視覺三則：海到地平線、翼尖凝結尾、螺旋槳圓盤

> 來源：上帝視角（`2026-08-08-god-view-design.md`）§8.7 手動試飛的回報。
> 三件事彼此獨立，共用一份 spec 是因為它們都是「上帝視角把既有的
> 算繪缺陷照出來了」——分三份會讓「為什麼現在才發現」這個共同的理由
> 散掉。實作上三者不共用任何一行程式。

## 1. 目標

| # | 現象（專案負責人在試飛時回報） | 交付 |
|---|---|---|
| 一 | 「海面好像不夠寬，我從上帝視角會看到海面只有局部」 | 海延伸到地平線；遠方用霧化開，但地平線仍是一條看得出來的線 |
| 二 | 「飛機機翼兩邊要有氣流線，尤其大幅度轉彎的時候氣流線應該更明顯」 | 翼尖高 G 凝結尾 |
| 三 | 「螺旋槳好像只畫到一邊」 | 模糊圓盤兩面都畫 |

---

## 2. 現況與成因

### 2.1 海只有 10 km 見方

`src/render/ocean.ts:39` `OCEAN_SIZE = 10000`、192×192 格，`update()` 把它
以格點對齊的方式搬到鏡頭下方。也就是說**海是一塊以鏡頭為中心、邊長 10 km
的方形**，邊緣之外什麼都沒有畫 —— 看到的是天空球（`sky.ts`，半徑 40 km、
`BackSide`）的下半部。

座艙視角在 200–500 m 高度平飛時，5 km 外的邊緣落在地平線附近、被 65° 的
FOV 壓成很淺的一條，所以一直沒被發現。上帝視角可以爬到 12,000 m
（`godCamera.ts` 的 `maxAltitude`），俯角一大，那塊方形的兩條邊直接出現在
畫面正中央 —— 海變成一片浮在天上的板子。

場景**目前完全沒有霧**（`scene.ts` 沒有任何 `scene.fog`），相機遠平面
60 km。

### 2.2 沒有任何氣流線

`src/render/` 現有的特效是 particles（廣告板粒子池）、smoke、spray、
splash、sparks、tracers、muzzle、fireball、debris、wrecks、tumble。
沒有一個與翼面氣流有關。

要接的資料**已經每個物理步都在算**：`StepDiagnostics.loadFactor`
（`dynamics.ts:22`，機體 Y 方向比力 / g）與 `StepDiagnostics.aero.alpha`
（迎角，rad）。缺的只有翼尖在機體座標的位置 —— `HullMetrics`
（`assembly.ts:31`）目前只有 `realLength` / `noseZ` / `noseY` / `tipY`，
而 `finish()` 內部其實已經算出 `maxAbsX` 了，只是沒往外送。

### 2.3 螺旋槳只從後面看得到

`assembly.ts:308` 的模糊圓盤是 `CircleGeometry`，材質 `blur`（:197）
**沒有設 `side`**，`MeshStandardMaterial` 的預設是 `FrontSide`。
`CircleGeometry` 的法線指 +Z，而機首朝 −Z —— 圓盤因此**只有從飛機後方
才畫得出來**。

而 `main.ts:603` 是 `setPropSpin(propRotation, c.command.throttle > 0.15)`，
`setPropSpin` 在 blurred 時會把三／四片槳葉**全部隱藏**（:319）。兩件事
合起來的結果是：**只要油門大於 0.15，從飛機前方或斜前方看，螺旋槳整個
不存在。**

座艙視角的相機永遠在圓盤後方，所以這個缺陷從 M1 活到現在。上帝視角是
第一個會從機頭方向看自己飛機的視角。

這一條是純缺陷，不是新功能。

---

## 3. 已裁定的決策

專案負責人在 2026-08-08 選定：

- **海**：超大平海 + 指數霧（而不是把細浪面加大到 20 km）。
- **氣流線**：高 G 凝結尾（而不是「永遠都有的淡線」，也不含失速抖動）。

---

## 4. 設計一：海延伸到地平線

### 4.1 三層

```
天空球 renderOrder −1000、depthWrite false、半徑 40 km、跟著鏡頭
   ↓ （被蓋過）
遠海   單一四邊形（2 個三角形）、邊長 500 km、y = −3、跟著鏡頭的 XZ
   ↓ （被蓋過）
細浪面 現有的 10 km × 192² Gerstner 網格，一行都不改
```

**遠海為什麼只要兩個三角形**：它是平的、單色、只受一盞平行光與半球光。
分段沒有任何意義。霧是逐片段算的，所以顏色在整面上仍然是連續漸層。

**為什麼 y = −3 而不是 0**：三道波的振幅和是 1.1 + 0.7 + 0.35 = 2.15 m
（`WAVES`），細浪面的最低點是 −2.15。遠海放在 0 會與細浪面在波與波之間
穿插、產生 z-fighting；放在 −3 保證**永遠在細浪面下方**，在 ±5 km 的範圍
內完全被蓋住。代價是接縫處有一道 3 m 的落差 —— 那在 5 km 外張角 0.6 mrad
（0.034°），而 1080p / 65° FOV 的一個像素是 0.06°，落在一個像素以內。

**為什麼遠海要跟著鏡頭走**：與細浪面同一個理由。不跟的話飛出 250 km 就
掉出去了。跟隨**不需要格點對齊**（那是為了避免頂點在格點之間滑動造成波形
抖動，而遠海沒有波）。

**遠海用 `MeshStandardMaterial` 而不是 `MeshBasicMaterial`**：要跟細浪面
接得上，就得受同一組燈光。顏色、roughness、metalness 全部沿用細浪面的值。

### 4.2 指數霧

`scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY)`。

指數霧的因子是 `1 − exp(−(d·density)²)`。取 `density = 1.4e-5`：

| 距離 | 霧因子 | 意義 |
|---|---|---|
| 5 km | 0.5 % | 纏鬥距離內顏色幾乎不受影響 |
| 10 km | 1.9 % | 上帝視角看得到的整個戰場，仍然清楚 |
| 30 km | 16 % | 開始化開 |
| 100 km | 86 % | 幾乎全霧 |
| 250 km（遠海邊緣） | ~100 % | 邊緣完全化進霧色，看不到硬邊 |

**為什麼指數霧而不是線性霧**：線性霧要選一個 near，而 near 之內完全沒有
霧、之外馬上開始 —— 在 near 那一圈會出現一道環。指數霧在近處的二次項幾乎
是零，沒有起點可言。而「近處不影響、遠處吃滿」正是這裡要的形狀。

**FOG_COLOR 刻意不等於天空的地平色**。天空球的 `horizon` 是 `0x9fc3d8`；
霧取 `0x7ea8c4`（同色相、暗一階）。兩者相等的話，遠海化進霧色之後就與
天空**完全同色**，地平線會消失 —— 而專案負責人明確要求「要看得出地平線」。
差一階明度就是那條線。

這條關係要被測試釘住（§8.2.3），而釘它需要天空那個顏色是**具名的**：
`sky.ts` 目前把 `0x9fc3d8` / `0x1f4f80` 直接寫在 `uniforms` 字面量裡，
本份把它們抽成 `export const SKY_HORIZON` / `SKY_ZENITH` 兩個常數，
`createSky` 照用。純粹是把既有的字面量取個名字，行為不變。

**霧會套到誰**：three 的 `Fog` 是逐材質的（`material.fog`，預設 `true`）。
於是飛機、遠海、細浪面、參照物、殘骸、曳光彈、粒子全部吃霧；天空球是
`ShaderMaterial`（`fog` 預設 `false`）**不吃**，正確 —— 天空本來就是無限遠。

### 4.3 相機遠平面 60 km → 800 km

遠海半邊 250 km，遠平面必須大於它，否則邊緣會被裁掉、又變回一條硬邊。

**深度精度的代價幾乎是零**。透視投影的深度解析度是
`Δz ≈ z²·(f−n)/(n·f·2²⁴)`，而 `f ≫ n` 時 `(f−n)/(n·f) → 1/n`。近平面
（1 m）沒有動，所以近場精度不變：100 m 處仍然是 0.6 mm。遠平面從 60 km
拉到 800 km 只改變那個趨近於 1/n 的因子的第三位小數。

天空球半徑 40 km 遠小於遠海，但它 `depthWrite: false` 而且
`renderOrder = −1000`（先畫、不寫深度），所以遠海照樣蓋得過去。
`SKY_RADIUS` 不動。

### 4.4 已知取捨

**細浪面與遠海在 5 km 處的明暗接縫。** 細浪面是 `flatShading`，波面的
法線會偏離垂直方向約 `atan(2π·1.1/140) ≈ 0.049 rad`；遠海的法線恆為垂直。
在斜射的太陽光下這會是一道**亮度**的接縫（不是幾何的接縫）。5 km 處的
霧只有 0.5%，幫不上忙。

**這一版接受它。** 消除它的三條路都更貴：(a) 把細浪面加大到 20 km ——
三角形數 74k→295k，而專案負責人已經否決；(b) 在 shader 裡把波幅往邊緣
收到零 —— 那會讓畫面上的海與 `heightAt` 的碰撞海在邊緣分家，而
`terrain.ts:22` 的註解明寫兩者必須是同一份；(c) 遠海也做波 —— 那就是 (a)。

實際刺不刺眼要在手動試飛時判定（§10）。若判定要修，(a) 是唯一不違反
既有不變量的路，屆時單獨開單。

---

## 5. 設計二：翼尖高 G 凝結尾

### 5.1 物理依據與判準

真機的翼尖渦凝結尾成因是翼尖低壓區把水氣凝出來，而低壓的強度跟著升力
係數走 —— 也就是跟著 **G** 走。所以判準取 `|loadFactor|`：

```
intensity = clamp((|loadFactor| − VORTEX_G_ON) / (VORTEX_G_FULL − VORTEX_G_ON), 0, 1)
```

**為什麼取絕對值**：負 G（推桿）時機翼一樣被載重，只是方向相反，翼尖
一樣會凝。1 g 平飛 `|g| = 1 < 3`，什麼都不出來 —— 那正是要的。

**「大幅度轉彎更明顯」不需要另外寫程式**：大幅度轉彎就是高 G，
`intensity` 直接就是它。

### 5.2 濃度怎麼跟著 intensity 走

粒子池的 `alphaFrom` 是**整池一個常數**（`ParticleConfig`），不能逐顆
調。可以逐顆調的只有 `emit(..., sizeScale)`。所以濃度用兩件事表達：

```
spacing   = SPACING_MAX + (SPACING_MIN − SPACING_MAX) · intensity   // 4.0 → 1.5 m
sizeScale = SIZE_MIN    + (SIZE_MAX    − SIZE_MIN   ) · intensity   // 0.45 → 1.0
```

- 剛過門檻（3 g）：粒子小、間隔 4 m —— 讀起來是**斷續的淡痕**。
- 拉滿（6.5 g）：粒子大、間隔 1.5 m，彼此重疊 —— 讀起來是**一條實心白帶**。

這正是專案負責人選定的那張示意圖。

### 5.3 沿飛行軌跡補點，不是每幀一顆

200 m/s 在 60 fps 下一幀走 3.3 m，在無頭 Chromium 的 7.5 fps 下走 27 m。
每幀只發一顆的話尾跡是虛線，而且**虛線的疏密會隨幀率變化** —— 同一個
動作在不同機器上長得不一樣。

所以每幀在「上一幀的翼尖位置 → 這一幀的翼尖位置」這條線段上，**每
`spacing` 公尺補一顆**：

```
count = min(floor(distance / spacing), VORTEX_MAX_PER_FRAME)
第 k 顆的位置 = lerp(prevTip, tip, (k + 1) / count)
```

粒子生出來之後速度是 0、`gravity` 是 0、`drag` 只用來讓它稍微收斂 ——
**尾跡因此留在空中不動，自動描出飛機剛剛走過的路徑**。那就是凝結尾的
樣子。

**`VORTEX_MAX_PER_FRAME`（每翼尖每幀 8 顆）** 是防爆閥，不是視覺參數：
幀率崩到 7.5 fps 時單幀會想補 18 顆，池子會被一架飛機吃光。8 顆讓極慢的
幀率下尾跡變疏，但不會拖垮其他人。

**`VORTEX_MAX_STEP`（60 m）**：兩幀之間的位移超過它就**只記錄、不發射**。
擋的是換場、重生、接手、以及分頁切回來時的巨大 `dt` —— 否則會出現一條
橫跨半個地圖的白線。與 `main.ts` 對 `prevPosition` 的處理同一個道理。

### 5.4 翼尖座標：`HullMetrics` 補兩個欄位

`finish()` 已經在掃全部頂點時算出 `maxAbsX`，並用 `|x| > 0.92·maxAbsX`
的那一批頂點的 y 平均值當 `tipY`。同一批頂點再取兩個平均即可：

```ts
/** 翼尖的展向位置（半翼展），m，機體座標。左翼取 −tipX。 */
tipX: number
/** 翼尖的縱向位置（已含重心位移），m，機體座標。 */
tipZ: number
```

**為什麼 0.92 這個既有的視窗不用動**：主翼是全機 |x| 最大的部件，水平
尾翼的半翼展遠小於 `0.92 × 主翼半翼展`（P-51D：1.95 m vs 5.19 m），
不會被誤收進來。這是 `tipY` 已經依賴的同一個前提。

**為什麼取平均而不是最後緣**：渦其實在翼尖的後緣附近脫離，但平均值與
後緣差不到半個翼弦（< 1 m），而尾跡本身直徑就有 2–4 m。多一個「找後緣」
的規則要多一組會漂掉的判準，換不到看得出來的差別。

### 5.5 模組界線

新檔 `src/render/vortex.ts`，暴露：

```ts
export function vortexIntensity(loadFactor: number): number
export function vortexSpacing(intensity: number): number
export function vortexSizeScale(intensity: number): number
export function vortexEmitCount(distance: number, spacing: number): number

export interface Vortex {
  object: InstancedMesh
  readonly live: number
  /** 一架飛機的一幀。tip 是**世界座標**的兩個翼尖。 */
  emit(index: number, loadFactor: number,
       lx: number, ly: number, lz: number,
       rx: number, ry: number, rz: number): void
  step(dt: number): void
  reset(): void
  dispose(): void
}
export function createVortex(capacity?: number, seats?: number): Vortex
```

- 四個純函數各自可測，不碰 three。
- `emit` 內部持有「上一幀的翼尖位置」——`Float32Array(seats × 6)`，
  以 `index`（`Combatant.index`）定址，外加一個 `Uint8Array` 的
  「有沒有上一幀」旗標。`index` 超出 `seats` 直接 return（`emit` 是熱
  路徑，不丟例外）。

  **`seats` 預設 `VORTEX_SEATS = 64`，而不是 import `MAX_COMBATANTS`。**
  後者住在 `src/battle/skirmish.ts`，而 §9 規定 `vortex.ts` 不得相依
  `src/battle/`。64 對 20v20 的 40 個座位有 1.6 倍餘裕，而一個
  `Float32Array(384)` 的成本可以忽略。**測試要釘住 `VORTEX_SEATS >=
  MAX_COMBATANTS`** —— 那條測試住在 `test/`，跨層相依在測試裡是允許的，
  而它正是「兩個常數不准漂開」的唯一防線。
- **狀態放在特效模組裡而不是 `main.ts`**：與
  smoke / spray / splash 一致，`main.ts` 只負責餵資料與呼叫 `reset()`。
- `reset()` 清粒子池**與**上一幀的翼尖位置。漏掉後者的話，換場後第一幀
  會從上一場的位置拉一條線過來 —— 這正是 `VORTEX_MAX_STEP` 的第二道防線，
  但不能靠防線當設計。
- 粒子池本身直接用 `createParticles`（`particles.ts`），與火球／煙／噴濺
  同一個池子實作。**不新寫一份積分器。**

### 5.6 `main.ts` 的接線

在既有的「逐 combatant 更新視覺」迴圈裡（`main.ts:579–604`，`v.wrecked`
與 `!c.alive` 都已經 `continue` 掉了），`setPropSpin` 那一行之後加：

```ts
TIP.set(model.metrics.tipX, model.metrics.tipY, model.metrics.tipZ)
   .applyQuaternion(v.quaternion).add(v.position)      // 右翼尖
TIP2.set(-tipX, tipY, tipZ).applyQuaternion(...).add(...)  // 左翼尖
vortex.emit(c.index, c.aircraft.diag.loadFactor, ...)
```

`TIP` / `TIP2` 是模組層的暫存，**熱路徑不配置**。

`vortex.step(frameSeconds)` 放在 `smoke.step` 那一段；`vortex.reset()`
放在 `restartBattle()` / `enterBattle()` 既有的那五個 `reset()` 旁邊
（`main.ts:349–353`）。

### 5.7 已知取捨

**池子滿了會截短尾跡。** 40 架同時 6.5 G、200 m/s 的極端情形每秒要
10,667 顆，1.4 s 壽命等於 14,933 顆存活，超過 6,144 的容量。環形緩衝會
覆蓋最舊的 —— 也就是**尾跡的尾端先消失**，尾跡從 1.4 s 縮到約 0.5 s。
這是刻意選的退化方向：尾端本來就是最淡的一段，而「所有人的尾跡一起
變短」遠好過「有些人完全沒有尾跡」。與 `sparks.ts` / `particles.ts` 的
覆蓋策略一致。

**殘骸與死掉的飛機不冒尾跡。** 接線點在 `v.wrecked` / `!c.alive` 的
`continue` 之後，所以是免費得到的。翻滾的殘骸沒有升力，本來就不該有。

---

## 6. 設計三：螺旋槳圓盤雙面

`assembly.ts:197` 的 `blur` 材質加 `side: DoubleSide`。

`blur` 全專案只有模糊圓盤一個使用者（`assembly.ts:308`），所以這一個字
的影響範圍就是那一片圓盤。`MeshStandardMaterial` 在 `DoubleSide` 下會依
`gl_FrontFacing` 翻轉法線，兩面的受光都正確。

`PROP_DISC_RENDER_ORDER`、`depthWrite: false`、`opacity: 0.22` 全部不動 ——
那三個是為了曳光彈與圓盤的混合順序（:150–165 的長註解），與正反面無關。

**槳葉不改。** blurred 時隱藏槳葉是刻意的（那是「轉太快看不見葉片」），
而槳葉是實心方盒、本來就兩面都看得到。

---

## 7. 參數總表

全部是**初值**。§10 的手動試飛才是定值的地方 ——
**護欄與手感參數的重新定值是專案負責人的決定，不是實作者的。**

### 海與霧（`src/render/ocean.ts`、`src/render/fog.ts`、`src/render/scene.ts`）

| 常數 | 初值 | 由來 |
|---|---|---|
| `FAR_SEA_SIZE` | 500,000 m | 12 km 高時邊緣落在俯角 2.7°，而該處霧已吃滿 |
| `FAR_SEA_Y` | −3 m | 低於波谷 −2.15 m，且落差在 5 km 外不到一個像素 |
| `FOG_COLOR` | `0x7ea8c4` | 天空地平色 `0x9fc3d8` 暗一階，用來留下地平線 |
| `FOG_DENSITY` | 1.4e-5 | 5 km 0.5%、30 km 16%、250 km ~100% |
| `CAMERA_FAR` | 800,000 m | > 遠海半邊 250 km；近平面不動所以精度不變 |

### 凝結尾（`src/render/vortex.ts`）

| 常數 | 初值 | 由來 |
|---|---|---|
| `VORTEX_G_ON` | 3.0 | 平飛 1 g 與緩轉 2 g 完全乾淨 |
| `VORTEX_G_FULL` | 6.5 | 兩機的持續轉彎大致落在 4–6 g，拉滿要看得出是「拉滿」 |
| `VORTEX_SPACING_MAX` | 4.0 m | 剛過門檻時的間隔，粒子之間有縫＝斷續 |
| `VORTEX_SPACING_MIN` | 1.5 m | 拉滿時的間隔，小於粒子直徑＝連成實心 |
| `VORTEX_SIZE_FROM` | 1.6 m | 出生直徑。翼展約 11 m，尾跡粗細約 1/7 翼展 |
| `VORTEX_SIZE_TO` | 4.5 m | 死亡直徑。渦會擴散 |
| `VORTEX_SIZE_MIN_SCALE` | 0.45 | intensity = 0 時的尺寸倍率 |
| `VORTEX_LIFE` | 1.4 s | 200 m/s × 1.4 = 280 m 的尾跡長度 |
| `VORTEX_LIFE_JITTER` | 0.15 | 尾端不要切齊（與 `SMOKE_LIFE_JITTER` 同一個理由） |
| `VORTEX_ALPHA` | 0.42 | 出生不透明度 |
| `VORTEX_DRAG` | 0.8 s⁻¹ | 只用來收掉數值殘留；速度本來就發射為 0 |
| `VORTEX_MAX_PER_FRAME` | 8 | 防爆閥，見 §5.3 |
| `VORTEX_MAX_STEP` | 60 m | 換場／重生／分頁切回的防線，見 §5.3 |
| `VORTEX_CAPACITY` | 6,144 | 與 `SMOKE_CAPACITY` 同級 |
| `VORTEX_SEATS` | 64 | 上一幀翼尖位置的座位數。20v20 是 40，留 1.6 倍 |

---

## 8. 測試策略

**算繪本身測不到**（WebGL canvas 沒開 `preserveDrawingBuffer`，讀不回來）。
所以測的是**產生器的機制與不變量**，不是「好不好看」——
與 `geometry.test.ts` 檔頭那三條裁決同一條線。

### 8.1 `test/unit/ocean.test.ts`（既有檔，新增）

1. 遠海遠大於細浪面：`FAR_SEA_SIZE > OCEAN_SIZE * 20`。
2. **遠海恆在波谷之下**：`FAR_SEA_Y < −Σ WAVES.amplitude`。這是不會
   z-fighting 的充要條件，而且它會跟著 `WAVES` 一起變 —— 有人加一道
   大浪就會紅。
3. `update(t, cx, cz)` 同時搬動兩者，且遠海的 XZ 精確等於中心
   （不做格點對齊）。
4. `dispose()` 把遠海的幾何與材質也釋放掉。

### 8.2 `test/unit/fog.test.ts`（新）

1. `fogFactor(d, density)` 是純函數，且 `fogFactor(0, ρ) === 0`、
   單調遞增、上界 1。
2. **設計意圖的三個點**：`fogFactor(5000, FOG_DENSITY) < 0.01`、
   `fogFactor(30000, …)` 落在 0.10–0.25、
   `fogFactor(FAR_SEA_SIZE / 2, …) > 0.999`。
   把 §4.2 那張表變成會紅的東西 —— 有人調 density 就得同時面對這三個
   後果。
3. `FOG_COLOR !== SKY_HORIZON`，且明度較低（`FOG_COLOR` 的
   HSL `l` 小於 `SKY_HORIZON` 的）。這一條守的是「地平線要看得出來」
   這個**需求**本身 —— 不是實作細節。
4. `CAMERA_FAR > FAR_SEA_SIZE / 2`。

### 8.3 `test/unit/vortex.test.ts`（新）

純函數：

1. `vortexIntensity`：1 g → 0；3 g → 0；6.5 g → 1；10 g → 1（夾住）；
   −5 g → 與 +5 g 相同（絕對值）。
2. `vortexSpacing`：intensity 0 → `SPACING_MAX`；1 → `SPACING_MIN`；
   單調遞減。
3. `vortexSizeScale`：0 → `SIZE_MIN_SCALE`；1 → 1。
4. `vortexEmitCount`：距離不足一個間隔 → 0；剛好三個間隔 → 3。

有狀態的部分：

5. **第一幀不發射**（沒有上一幀的位置可以連），第二幀才發射。
6. 位移超過 `VORTEX_MAX_STEP` → 不發射，但**位置有記錄下來**
   （下一幀恢復正常）。
7. `|loadFactor|` 在門檻以下 → 不發射，但位置仍要記錄
   （否則從緩轉切進硬拉的第一幀會拉一條長線）。
8. 單幀的發射數不超過 `VORTEX_MAX_PER_FRAME × 2`（兩個翼尖）。
9. `reset()` 之後 `live === 0`，**而且**下一幀不發射（上一幀位置也被清掉）。
   ——這一條是 §5.5 那個「不能靠防線當設計」的斷言。
10. `index >= VORTEX_SEATS` 不會爆（靜默 return），而且不影響其他座位。
11. **跨層一致性**：`VORTEX_SEATS >= MAX_COMBATANTS`。`vortex.ts` 依 §9
    不得 import `src/battle/`，所以這兩個常數只有在測試裡才碰得到面 ——
    這是「有人把 20v20 改成 32v32 卻沒動 `VORTEX_SEATS`」的唯一防線。

### 8.4 `test/unit/geometry.test.ts`（既有檔，新增）

10. **模糊圓盤兩面都畫**：建出兩個機種的模型，找出 `userData.spinning`
    且幾何是 `CircleGeometry` 的那一個 mesh，斷言其材質
    `side === DoubleSide`。
    這是「產生器的機制」不是「造型」——改壞了是錯誤，不是美感問題。
11. `HullMetrics.tipX` 落在 `spec.wing.span / 2` 的合理鄰域，
    `tipZ` 落在機身的 Z 範圍內。
    **注意**：`geometry.test.ts` 已有一條「包圍盒翼展等於 `spec.wing.span`」
    的跨模組一致性測試，這一條與它同類（跨模組一致性），不是造型測試。

### 8.5 `test/unit/pool-reset.test.ts`（既有檔，新增）

12. 凝結尾池併入既有的三條 reset 測試（存活歸零／再 step 不冒出來／
    reset 後還能再用）。

### 8.6 護欄

13. **凝結尾不得改變戰局。** 與上帝視角的鏡頭護欄
    （`test/integration/god-view.test.ts`）同一招：20v20 跑兩場、每場
    120 秒，一場呼叫 `vortex.emit`/`step`、一場不呼叫，逐隊 HP 損失
    必須**逐位元組相同**。`vortex.ts` 用的是 `makeScratch`
    （`core/pool.ts`）之外的自有陣列，但 `applyQuaternion` 會不會碰到
    共用暫存池仍然要用測試釘死 —— 那正是上帝視角那條護欄抓到的類型。

### 8.7 Playwright 驗收

`test/e2e/` 能斷言的很有限（讀不回 WebGL 畫面）。做兩件事：

14. 進遊戲 → 按 `G` → 用 `E` 爬到高空 → 停留數秒 → 回座艙，
    全程 `console` **零錯誤**。遠平面 800 km、遠海 500 km 的四邊形、
    霧的 uniform 都會在這條路徑上被 three 實際編譯與繪製，
    shader 或幾何出問題會以 WebGL warning/error 的形式現形。
15. 高 G 會產生凝結尾這件事，用**單元測試**斷言（§8.3），
    不在 e2e 重複 —— e2e 讀不到粒子數。

---

## 9. 架構約束

沿用既有的分層規則，這一份新增的部分：

- `src/render/vortex.ts` **不得** import `src/battle/`、`src/ai/`、
  `src/hud/`。它只吃數字（index、loadFactor、六個座標）。
- `src/render/fog.ts` 是純的（只 import three 的 `Color` / `FogExp2`），
  **不得** import `scene.ts` —— 方向是 `scene.ts → fog.ts`。
- `HullMetrics` 加欄位不得讓 `src/render/geometry/` 產生新的對外相依。
- 熱路徑不配置：`vortex.emit` / `step`、`main.ts` 的翼尖換算全部走
  模組層暫存。
- `noUncheckedIndexedAccess` 開著，`Float32Array` 的索引一樣要處理。

---

## 10. 驗收條件

**自動：**

- `npx tsc --noEmit` 無輸出。
- 全套 `npx vitest run`（扣掉需單獨跑的 `perf-gate` 與 `rematch`）
  無新增紅燈。
- `perf-gate` 4 綠、`rematch` 3 綠（各自單獨跑）。
  —— 這三件事都在 CPU 側，本份改動不碰物理，預期無變化；跑它是為了
  證明「無變化」而不是期待改善。
- Playwright §8.7 的兩條。

**手動試飛（專案負責人）——** 這才是三件事真正的驗收：

1. 上帝視角爬到 3,000 m 與 12,000 m，**海是不是到地平線了**、
   **地平線是不是一條看得出來的線**。
2. 5 km 處細浪面與遠海的明暗接縫**刺不刺眼**（§4.4）。若刺眼，
   §4.4 的 (a) 另開單。
3. 遠處的敵機有沒有被霧吃掉（`FOG_DENSITY` 太大的症狀）。
4. 凝結尾：平飛乾淨嗎？緩轉是不是斷續的淡痕？硬拉是不是兩條白帶？
   `VORTEX_G_ON` / `VORTEX_G_FULL` 兩個門檻是否要調。
5. 20v20 大混戰時凝結尾會不會糊成一片（`VORTEX_ALPHA` / 容量）。
6. 從機頭方向看自己與敵機，螺旋槳圓盤在不在。

---

## 11. 不做的事

- **不加大細浪面。** 專案負責人已在 §3 選定另一條路。
- **不做失速抖動氣流。** 同上。
- **不做「永遠都有的淡尾跡」。** 同上。若日後上帝視角需要「一眼看出
  誰在哪」，那是小地圖／接觸點的職責，不是尾跡的。
- **不碰 `heightAt`。** 碰撞用的海面與畫面上的海面必須是同一份
  （`terrain.ts:22`）。
- **不碰 `SKY_RADIUS`。** 天空球跟著相機、不寫深度，遠海比它大不構成問題。
- **不做尾跡的排序。** `InstancedMesh` 逐實例不可排序，這是
  `particles.ts:170` 已經記錄過的既有限制，凝結尾繼承它。
- 上帝視角那三張未修的單（`CameraRig` 低幀率發散、指標鎖定的滑鼠位移
  尖峰、`playerAi` 留在被接手的舊座位）**不在這一份的範圍內**。
