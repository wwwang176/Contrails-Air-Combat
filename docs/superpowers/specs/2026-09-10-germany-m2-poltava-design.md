# 德 M2「波爾塔瓦之夜」—— He 111 夜襲機場

2026-09-10

## 1. 要做的事

把 `germany-m2` 由 `battle: null` 變成打得起來的一關，題目換掉：不再是
庫班的鐵路（對手要蘇軍戰鬥機，負責人不補蘇軍陣營），改成**波爾塔瓦空襲**。
同一輪把每個陣營砍成三關。

```
  我方   He 111 ×8（玩家領隊 + 7 架 AI，兩個小隊分層擺位）
  敵方   沒有飛機。壓力全部來自地面：輕型防空砲、重高砲、探照燈
  要炸   波爾塔瓦機場停放的 B-17G、油桶堆、彈藥堆；炸毀 12 座算贏
  時地   1944 年 6 月 21 日深夜，烏克蘭　波爾塔瓦機場上空
  地形   任務專用的 poltava：平坦的草原、鋼板跑道墊、機場區墊面
  時段   night（已有）；照明彈是這一關的光源
```

負責人裁定（2026-09-10）：

1. 背景是波爾塔瓦，不是庫班；阿爾及爾雷擊與克里特島列為備案，不做
2. **史實上沒有空中攔截，這一關就沒有敵機**；防空火力要比史實強，讓玩家
   有壓力 —— 畫面照史實（滿天曳光彈），數值由試飛定
3. 照明彈：緩慢搖晃下墜的點光源 + 白色煙霧，簡單處理
4. 探照燈：先用方塊當砲座、正反兩面半透明的白柱當光束；**不與砲火連動**
5. 機場走 Blender，照洛伊納廠區的做法（一個區塊一顆網格）
6. 每個陣營砍成三關：砍盟 M3 諾曼第、德 M3 奧博揚、日 M2 讀谷

## 2. 史實

- 1944 年 6 月 21 日「狂亂行動」第二次穿梭轟炸：第八航空軍第 3 轟炸師的
  B-17G 炸完柏林南邊的合成油廠，落地烏克蘭的波爾塔瓦、米爾哥羅德、
  皮里亞廷三座機場。一架 He 177 偵察機跟到波爾塔瓦，拍到 73 架 B-17。
- 當夜 00:30，KG 53 與 KG 55 的約 75 架 He 111（KG 4 的 He 111 先投照明彈）
  攻擊波爾塔瓦近兩小時。先照明、再高空投彈、最後低空掃射。投下約 111 噸
  彈藥：5 枚 1,000 公斤、78 噸破片彈、17 噸燃燒彈與蝴蝶彈。
- 結果：73 架 B-17 之中 47 架炸毀、26 架受損；45 萬加侖航空汽油燒光；
  彈藥堆引爆。美軍陣亡 2 人、蘇軍 30 餘人。**德軍零損失。**
- 蘇軍防空打了近 30,000 發，一架都沒打下；主力是 12.7 mm 機槍與 37 mm
  機砲，中口徑高砲很少、沒有雷達射控。夜間戰鬥機起飛了，沒有接觸。
  美軍自己沒有防空部隊 —— 蘇方拒絕美軍帶防空砲與夜戰機進駐。
- 停機坪：場地小，B-17 「翼尖對翼尖排成整齊的幾列」，停在機場東端，
  沒有掩體、沒有分散停放。跑道與停機坪鋪的是美國運來的穿孔鋼板（PSP），
  一萬兩千噸。周邊是平坦的草原與簡陋的營舍。
- 油料：美軍的 100 號辛烷汽油全部從美國經摩曼斯克或波斯灣走鐵路運來，
  裝在 55 加侖油桶裡露天堆放。45 萬加侖約 8,000 桶。**沒找到照片，這一點是
  從補給方式推的。**
- 照明彈：LC 50 傘降照明彈，42 公斤，白黃光約 140 萬燭光，**燃燒 5 到 6
  分鐘**。「一列照明彈從東到西排開」把停機坪照成白晝。

參考照片（抓在 scratchpad `poltava/`）：空襲當夜的 NA410（照明彈光柱、曳光彈、
B-17 剪影）、空襲前的 B-17 與 PSP 跑道、6 月 22 日早上的殘骸三張。

## 3. 已經在的（查證過，不必做）

- **He 111 整台**：`specs/he111.ts`、`he111.glb` 與 hull、砲塔
  （`weapons/he111.ts`）、掛載 `LOADOUT_BY_AIRCRAFT.he111` = 8 枚 × 9,300、
  簡報名稱、飛行員名單的陣營。**沒有任何一關用到它。**
- **地面目標的一切**（盟 M2）：`world/groundTargets.ts` 的 `GroundTarget`、
  `GROUND_HP`／`GROUND_ARMOUR`、`settleGroundTargets`、炸彈範圍傷害掃地面
  目標、`destroy` 規則與 `destroyCount`、HUD 的計數與打擊目標視圖、
  `render/groundTargets.ts` 的死了換焦黑材質、`groundFires` 在彈著點起火。
- **陸上砲位會還手**（lenua-build，2026-09-10 併入）：`createGroundBattery`
  給 `flakHeavy` 掛一門 `GROUND_FLAK_SPEC` 的 88，走 `stepGunPlatform`；
  `BattleConfig.flakSpec` 逐關複寫；`ground-flak.test.ts` 有 323 行護欄。
- **`flakLight` 地面單位已經有模型**（`flak38.glb`，2 cm Flakvierling 38，
  `GROUND_HP` 160）—— 只是還沒掛砲。
- **輕型砲的規格與曳光**：艦砲的 `mg`（20 mm，射程 1,330 m）與
  `autocannon`（40 mm，2,990 m）走彈丸池，`render/tracers.ts` 畫得到 ——
  照片裡那一整片曳光彈就是這一層。
- **夜間時段** `night`（`render/timeOfDay.ts`）。
- **地面是真的吃光的**：`farmGround.ts` 是 `MeshStandardMaterial` 加
  `onBeforeCompile`，飛機、地面單位、佈景也都是 `MeshStandardMaterial` ——
  加 `PointLight` 它們就亮。
- **AI 對地面目標的投彈**：`ai/strikeRun.ts` + `ai/bombRun.ts`，盟 M2 的
  B-17 僚機就是這樣投的；`main.ts` 對每一架 AI 接 `groundTargets`。
- **分層擺位** `blueStacked`、**節拍** `beats.ts`（`reinforce`／`withdraw`／
  `recycle`，觸發 `clock`／`alive`／`batch`）。
- **任務專用地形的整條路**：`TerrainKind` → `createTerrain` →
  `createInlandTerrain(field, season, site, scenery)`；`SiteLayout` 的墊面、
  道路、鐵路、鋪面矩形；`tools/blender/build_plant.py` 的 Blender 管線與
  `parseGroundGlb` 的材質名合約。
- **粒子**：`steam`（白煙）、`smoke`、`firePuff`、`fireball`、`blast`；
  加法混色的材質範例在 `render/muzzle.ts`（`AdditiveBlending` + `DoubleSide`）。
- **零敵機只擋在三處**（2026-09-10 量的，探針已刪）：
  `order.ts` 的 `assertOrderOfBattle` 丟「編組表裡沒有紅隊」、`setup.ts`
  兩處 `red[0]!` 取飛行員名單。放開之後 `createBattle`、10 秒的
  `stepBattle`、`destroy` 規則、`metric 6/6` 全部正常。

## 4. 缺的東西

| 缺口 | 現況 | 這一輪 |
|---|---|---|
| 每陣營三關 | 12 張卡、4 張 null；計數護欄釘 4／12／4 | §6 |
| 零敵機 | 三處擋著 | §7 |
| 停放的 B-17 當地面目標 | 地面單位只有車輛、砲、火車、廠房 | §8.1 |
| 油桶堆、彈藥堆 | 沒有 | §8.2 |
| 探照燈 | 沒有 | §8.3、§11 |
| 輕型防空砲會還手 | `flakLight` 只是靶 | §9 |
| 照明彈 | 沒有 | §10 |
| 機場地形 | 沒有 | §12 |
| 機場佈景 GLB | 沒有 | §13 |
| 卡片與規則 | `germany-m2` 是 null | §14 |

## 5. 範圍：不做的

- **不做敵機。** 史實沒有；虛構的 P-51 夜間攔截留給之後的遊戲性補充。
- **不做探照燈與砲火連動**（被照到就集火）。負責人裁定之後再看。
- **不做低空掃射段。** He 111 的機槍對地面目標打得到（`GROUND_ARMOUR` 0），
  但不設計成一段。
- **不做殘骸模型。** 炸毀的 B-17 只換焦黑材質（與廠房同一條規則）。
- **不做起落架。** B-17 的 GLB 沒有起落架，停放姿態用機腹貼地、機尾下沉
  （§8.1）。從 1,500 m 的夜空看下去是剪影，看不出來 —— **負責人若不接受，
  這一項是新資產。**
- **不做蝴蝶彈、燃燒彈、1,000 公斤彈。** 掛載照 He 111 現在的 8 枚。
- **不做蘇軍夜間戰鬥機、不做 C-47、P-51 停放**（史實有 15 架其他飛機被毀）。
  停放的只有 B-17。
- **不動盟 M2、日 M4、盟 M4 一個字**；`GROUND_FLAK_SPEC` 不改，德 M2 用
  自己的 `flakSpec`。

## 6. 每陣營三關

砍 `allies-m3`、`germany-m3`、`japan-m2` 三張目錄卡，`MISSIONS` 各剩三張。

護欄改值（**負責人 2026-09-10 裁定**，不是實作者重新定值）：

```
  campaigns.test.ts   每陣營 3 張；9 個 id 唯一；9 個標題唯一；
                      未做的張數：這一輪做完 germany-m2 之後是 0
  briefing.test.ts    9 個空域各不相同
  missions.test.ts    有引用 12 的註解跟著改
```

砍卡在 germany-m2 動工之前先做、單獨一個 commit —— 這樣「未做的張數」
從 4 → 1 → 0 各有一個 commit 可對照。

選單：`ui/menu.ts` 目前照 `MISSIONS` 的長度排，三張與四張都排得下；要驗一次
版面（試飛）。

## 7. 零敵機

- `assertOrderOfBattle`：「沒有紅隊」由拋例外改成**允許**。它擋的是編組表
  寫錯，但「沒有敵機」是這一關的正確資料。藍隊全部排在紅隊之前那一條保留。
- `setup.ts` 兩處 `pilotNames(seed, red[0]!…)`：紅隊為空時給空陣列。
- `campaigns.test.ts`「架數都是正整數」：`redCount` 改成**非負**整數，
  `blueCount` 仍要正。
- **要驗的行為**（護欄，§16）：零敵機的一場 `createBattle` 不拋、跑 10 秒
  仍是 `fighting`、`aliveRed` 恆 0 而 `destroy` 規則不因此判勝。
- HUD 的接觸列表、K/D 看板、雷達對空敵機為零都只是空 —— 試飛看一眼。

`redSpec` 仍要填（型別非空）。填 `P51D`：史實上第 4 戰鬥機大隊的野馬就在
皮里亞廷，只是沒起飛。它不生任何飛機。

## 8. 新的地面單位

三種新 id 進 `GroundUnitId`，`GROUND_HP`／`GROUND_ARMOUR` 是 `Record`，
少填會編譯錯。

### 8.1 `parkedB17` 停放的 B-17G

- **幾何從 B-17 的 GLB 樣板烘**：`glbTemplate('b17g').group` 走一遍，每一顆
  mesh 套世界矩陣、把材質色塗成頂點色、合併成一顆 `BufferGeometry` ——
  產物與 `parseGroundGlb` 相同（不共用頂點、帶頂點色、一個 draw call）。
  螺旋槳一起烘進去（靜止）。新函數 `bakeParkedAircraft(id)` 放在
  `render/geometry/ground/parked.ts`，載入期跑一次、快取。
- **停放姿態**：機腹貼地、機尾下沉 10°（尾輪機的地面角），整台抬到最低點
  剛好貼 0。`GroundModel` 用 `{ build }` 那一種。
- `hull`：一個大盒，從烘好的幾何量（與火車同一條規則）。約 32 × 6 × 23 m。
- `GROUND_HP`：**3,000**。一枚 9,300 的炸彈 30 m 線性衰減，落在 20 m 內就
  炸毀；落在翼尖外 10 m 只剩三成血。**起始值，由試飛裁定。**
- `GROUND_ARMOUR` 0：機槍打得到。
- `realLength` 22.66、`realWidth` 31.62、`realHeight` 5.82（史實）。

### 8.2 `fuelDump` 油桶堆、`bombDump` 彈藥堆

- 程序化幾何（`render/geometry/ground/dump.ts`）：油桶堆是 8 × 12 顆直立
  圓柱疊兩層的一塊（約 30 × 20 × 2 m），彈藥堆是三排並列的橫躺圓柱。
  各一顆合併網格。**它們是目標，各自要有命中盒**，所以不進佈景 GLB。
- `GROUND_HP`：油桶堆 6,000（一枚直擊）、彈藥堆 6,000。
- **死了要燒**：油桶堆炸毀時在腳印內點 6 個 `groundFires`（現在只在彈著點
  點一個），燒的秒數是一般的三倍；彈藥堆炸毀時多放一個 `blast`。這兩件事
  由 `main.ts` 讀 `world` 的地面目標擊毀事件做 —— 現在擊毀是狀態不是事件，
  §16 的護欄要守「每一座只點一次火」。
- 它們算進 `destroyCount` 的池（與砲位同一條規則）。

### 8.3 `searchlight` 探照燈

- 程序化幾何：**一個 3 × 2 × 3 m 的方塊**當砲座（負責人裁定先用方塊）。
- `GROUND_HP` 200、`GROUND_ARMOUR` 0：一條彈道打得掉。
- 光束在渲染層（§11），不在地面單位裡。

## 9. 防空

### 9.1 輕型砲會還手

`createGroundBattery(spec, tier, calibre, muzzleY)` 一般化：現在寫死
`tier: 'flak'`、`calibreMm: 88`、`GROUND_FLAK_MUZZLE_Y`。`placeGround` 對
`flakLight` 掛 `GROUND_LIGHT_FLAK_SPEC`，`BattleConfig.lightFlakSpec` 逐關
複寫（與 `flakSpec` 同一條路，透傳三處都要接）。

`GROUND_LIGHT_FLAK_SPEC`（新，`shipGuns.ts`）：

```
  tier            'autocannon'（走彈丸池、有曳光、仰角 45°／半角 65°）
  口徑            37 mm（蘇軍 61-K；`flakLight` 的模型是 2 cm 四聯，剪影差不多）
  初速 880        沿用 40 mm
  射速 160 發/分  61-K 的實際循環射速
  壽命 3.0 s      射程 2,640 m —— 1,500 m 投彈高度打得到
  單發 7          40 mm 艦砲是 9
  hp／boxHalf     用不到，照 `GROUND_FLAK_SPEC` 的寫法填
```

**全部是起始值。** 壓力的來源是座數 × 射速，不是單發 —— 與洛伊納「範圍大
單發輕」同一條哲學，只是這裡是曳光彈而不是黑雲。

### 9.2 重高砲

`flakHeavy` 沿用，`flakSpec` 複寫成 85 mm 的樣子：`{ ...GROUND_FLAK_SPEC,
roundsPerMinute: 12 }`。座數少（§14 的佈局），它的用途是「投彈高度也不
安全」。

### 9.3 佈局（世界座標由 `world/poltava.ts` 算，卡片引用）

```
  flakLight   16 座，兩圈：內圈 8 座離機場中心 600 m，外圈 8 座 1,200 m
  flakHeavy    6 座，離中心 2,000 m，六等分
  searchlight  6 座，離中心 900 m，與內圈砲位錯開相位
```

史實的蘇軍防空是「多而輕」，佈局照這個方向；**座數由試飛裁定**。

### 9.4 壓力的量法

與盟 M4 同一套探針：8 架 He 111 走 `headOn` 從 12 km 外進場，記每一架被
打掉的距離與時間、投出幾枚、炸毀幾座。目標是「每趟掉一到兩架、投得出去、
炸得到」。掉太多先調座數不調單發。

## 10. 照明彈

### 10.1 世界層 `world/flares.ts`

SoA 池，容量 16，不配置：

```
  x, y, z        位置
  age            已燒幾秒
  phase          搖晃的相位（生成時由索引給，確定性）
  live           Uint8
```

- 生成：`spawnFlare(pool, x, y, z)`，滿了拒絕（與高砲彈同一條規則）。
- `stepFlares(pool, dt)`：`y −= FLARE_DESCENT × dt`（2.5 m/s）；
  `x`／`z` 加一個小幅的正弦搖晃（振幅 3 m、週期 6 s，相位各自）；
  `age += dt`，超過 `FLARE_BURN`（300 s）熄滅；落到地面高度也熄滅。
- 它在 `World.step` 裡跑（240 Hz 沒有配置），與戰鬥的確定性同一條路。
  逐位元基準因此含它。

### 10.2 節拍 `flare`

`beats.ts` 加第四種 `FlareBeat { kind: 'flare', when, points }`：觸發時在
每一個 `points` 的 (x, z) 上以 `FLARE_ALTITUDE`（1,200 m）生一枚。
`when` 用既有的 `MissionTrigger`；德 M2 用 `{ kind: 'clock', at: 80 }` ——
He 111 以約 85 m/s 從 12 km 外進場，80 秒時離機場約 5 km，照明彈燒到
380 秒，整個投彈段都亮著。**起始值，由試飛裁定。**

卡片上是 `flares?: { when, points }`，`cardBeats` 轉成節拍。**沒有這一格的
卡完全不產生**（與 `waves` 同一個約定）。

### 10.3 渲染層 `render/flares.ts`

- **`PointLight` 固定四盞，開場就建好**、掛在場景裡，`intensity 0` 代表
  沒在用。**不能動態增減** —— `MeshStandardMaterial` 的光源數變了會整批
  重編著色器，那是一次幾百毫秒的卡頓。四盞對應池裡最亮的四枚（依 `age`
  排序，燒最久的先熄）。`distance` 2,500 m、`decay` 2、色 0xfff2d0。
- 每一枚一個加法混色的 sprite（光暈，`fireball.ts` 的貼圖）。
- 白煙：每枚每秒對 `steam` 池發幾顆，往上飄（傘降的煙是往上拖的）。
- 亮度隨 `age` 在最後 30 秒衰減。
- 池是狀態不是事件，渲染幀讀 `world.flares` 就好。

### 10.4 效能

四盞點光源對 `MeshStandardMaterial` 的成本是每個片元四次光照；地面網格是
最大的那一顆。§16 的 e2e 量幀時間，超過預算就降到兩盞。

## 11. 探照燈的光束 `render/searchlights.ts`

- 對 `world.groundTargets` 裡每一座 `searchlight` 建一根圓柱：底半徑 1.5 m、
  頂半徑 12 m、長 2,500 m、16 段；材質 `MeshBasicMaterial`
  `{ side: DoubleSide, blending: AdditiveBlending, transparent, depthWrite:
  false, opacity 0.06 }`，色偏冷白。加法混色不用管透明排序。
- 掃描：仰角 55° ± 20°、方位 360° 慢轉，兩個不同週期的正弦（周期 23 s 與
  37 s），每座相位不同。純函數 of 時間，不接砲火、不接目標。
- 死了就隱藏（`alive` 為 false → `visible = false`），復活要能回來。
- 光束底部的光暈：一個加法混色 sprite。

## 12. 地形 `poltava`

`TerrainKind` 加第五種。切換點（2026-09-10 grep 過）：`terrainKind.ts`、
`render/terrain.ts` 的 `createTerrain`、`main.ts` 793 那一支（洛伊納專用的
蒸汽）、`tools/blast.ts` 與 `tools/daylight.ts` 的清單。

`world/poltava.ts`（與 `leuna.ts` 同一個形狀）：

```
  FIELD_CENTER     機場中心 (0, −7,000)。藍隊開局 z ≈ +5,000 朝 −Z，
                   進場 12 km —— 與洛伊納同一段距離
  FIELD_HEADING    0（跑道東西向；藍隊從南邊來，橫切跑道 —— 史實照明彈
                   「從東到西排開」正是沿跑道）
  FIELD_PAD        1,800 × 1,200 m 的草地墊面，保證平坦。**墊面是草不是
                   混凝土**：`SiteLayout.pad` 的顏色改成可設（草色）
  RUNWAY           跑道墊矩形 1,500 × 60 m，`patches` 用深灰的 PSP 色
  APRON            停機坪矩形，機場東端 400 × 300 m，同 PSP 色
  ROWS             停放的 B-17：3 排 × 8 架，翼尖距 36 m，排距 60 m，
                   機首朝南（朝來襲方向 —— 照片裡機首朝跑道）
  DUMPS            油桶堆 ×2（機場西北角）、彈藥堆 ×1（東南角）
  FLAK / LIGHTS    §9.3
  HILLS            手擺 4 顆極緩的丘（峰高 ≤ 40 m），全在 3 km 外；
                   波爾塔瓦是平原
  ROADS / RAILS    一條連外道路往北、一條鐵路往東（波爾塔瓦是鐵路樞紐）
```

`createTerrain('poltava')` = `createInlandTerrain(createPoltava(), 'summer',
POLTAVA_SITE, buildAirfieldScenery)`。六月是 `summer`。

## 13. 機場佈景 GLB

`tools/blender/build_airfield.py` → `public/models/poltava_airfield.glb`，照
`build_plant.py` 的骨架：

- **一個區塊一顆網格**：營舍區（帳篷、木屋、幾輛卡車的方塊）、塔台、
  油桶堆的**佈景部分**（目標那兩堆之外的散桶）、圍籬、電線桿。
- PSP 墊面不建幾何 —— 它是著色器的 `patches`。
- `KEEPOUTS`：24 架 B-17 的腳印、三個堆、22 座砲位、6 座探照燈。
- 材質名走 `LP_Plant*`（`glb.ts` 的 `PLANT_MATERIALS`）；要新色再加名字。
- `ROOT` 路徑**改成從 `bpy.data.filepath` 推**，不寫死 worktree 的絕對路徑
  （`build_plant.py` 現在寫死的是舊 worktree）。
- 載入與 `plantScenery.ts` 同一套：`preloadAirfieldScenery()` 開場 await、
  `buildAirfieldScenery()` 同步回複本。

## 14. 規則與卡片

```ts
{
  id: 'germany-m2', title: '波爾塔瓦之夜', type: '打擊',
  summary: '駕駛 KG 55 的 He 111 夜襲波爾塔瓦機場，炸掉穿梭轟炸落地的 B-17。',
  place: '烏克蘭　波爾塔瓦機場上空', period: '1944 年 6 月',
  battle: {
    objective: '炸毀停放的 B-17', banner: '夜襲機場，炸毀 B-17',
    blueSpec: HE111, redSpec: P51D, convoySpec: null,
    blueCount: 8, redCount: 0, blueStacked: true,
    convoyCount: 0, convoyPriority: 1,
    targetDistance: 0, targetRadius: 0, seconds: Infinity,
    entry: 'headOn', terrain: 'poltava', timeOfDay: 'night',
    altitude: 1500,
    ground: POLTAVA_GROUND,      // 24 B-17 + 3 堆 + 22 砲位 + 6 探照燈
    destroyCount: 12,
    flakSpec: { ...GROUND_FLAK_SPEC, roundsPerMinute: 12 },
    lightFlakSpec: GROUND_LIGHT_FLAK_SPEC,
    flares: { when: { kind: 'clock', at: 80 }, points: FLARE_LINE },
  },
}
```

- 標題「波爾塔瓦之夜」與橫幅「夜襲機場，炸毀 B-17」（12 字）都是提案，
  **負責人定**。
- `destroyCount` 12：8 架 × 8 枚 = 64 枚對 27 個目標；AI 投彈的命中率照
  盟 M2 的實測約三成，12 座要 40 枚上下 —— 玩家不投也打得完，玩家投就快。
  **起始值。**
- `altitude` 1,500：與盟 M2 同。輕型砲 2,640 m 的射程打得到，重高砲也打得到。
  玩家爬到 3,000 以上輕型砲就搆不到，但瞄準變難 —— 那是這一關的取捨。
- 勝負：`destroy` 規則原封不動。藍隊全滅判負。

## 15. 簡報、選單、HUD

- 簡報的機種表已有 He 111；橫幅走現有的打字機。
- HUD 目標列印 `炸毀停放的 B-17 12`（`count` 計量，現有）。
- 雷達與接觸列表沒有敵機 —— 試飛確認畫面不怪。

## 16. 護欄

每一條先驗紅或做變異測試。

1. **砍卡**：計數護欄改成 3／9／9／0（§6）；`missions.test.ts` 的橫幅長度
   對新卡成立。
2. **零敵機**：`assertOrderOfBattle` 對只有藍隊的編組表不拋（先驗紅：現在
   拋）；`createBattle` 零紅隊跑 10 秒仍 `fighting`；`pilotNames` 那兩處不炸。
3. **地面單位**：三種新單位的 `hull` 蓋住全部頂點且不浮空
   （`ground-units.test.ts` 既有的那一條掃全表就會含到）；`parkedB17` 的
   烘焙幾何頂點數與 B-17 樣板一致、最低點是 0。
4. **輕型砲**：`placeGround` 對 `flakLight` 掛砲（現在不掛，先驗紅）；
   掛的是 `lightFlakSpec`；`stepGunPlatform` 對 1,500 m 高的目標開火、
   彈丸進 `Projectiles` 而不是 `FlakShells`（變異：tier 改 `flak` 就紅）。
5. **照明彈**：下墜速率、燒 300 秒熄滅、落地熄滅、滿 16 拒絕、搖晃是確定性
   的（同種子兩次逐位元相同）；`flare` 節拍在 `clock` 到時生成指定枚數，
   沒有 `flares` 的卡不產生節拍。
6. **渲染**：四盞燈開場就在場景裡（數一次 `PointLight`）、池空時強度 0；
   探照燈死了 `visible` 為 false、復活回 true。
7. **油桶堆起火只點一次**：炸毀後跑 10 秒，`groundFires` 的點火次數是 6
   不是 6 × 步數。
8. **地形**：墊面內高度全 0；丘陵離墊面 ≥ `PAD_CLEARANCE`；24 架 B-17 全在
   停機坪矩形內、互不重疊；砲位不在跑道與停機坪上。
9. **逐位元基準**：`strike-replay-baseline.test.ts` 加 `germany-m2` 跑 90 秒，
   在試飛定值之後凍結。
10. **e2e**（vite-node 有頭）：`poltava-shot.e2e.ts` 照 `leuna-shot` 拍三個
    視角（進場 5 km、投彈 1.5 km 正上方、地面 200 m 看探照燈與照明彈）；
    `frame-time` 對這一關量一次。

## 17. 量測計畫（動工前後）

1. **壓力**（§9.4）：8 架 AI He 111 走完一趟，記損失、投彈數、炸毀數。
   基準值：盟 M4 的同一支探針。
2. **投彈數對目標數**：AI 的命中率決定 `destroyCount` 對不對。
3. **幀時間**：四盞點光源 + 六根光束 + 曳光彈。
4. **畫面**：照明彈底下的 B-17 剪影看不看得出來；探照燈的光束在夜空裡夠不
   夠白；曳光彈夠不夠密。判準是照片 NA410。

## 18. 提交順序

```
  1  砍三張卡 + 護欄改值
  2  零敵機（三處 + 護欄）
  3  地形 poltava + world/poltava.ts（沒有佈景 GLB 也開得起來）
  4  三種地面單位 + 卡片（這時關卡已經打得起來，只是空曠）
  5  輕型砲會還手 + lightFlakSpec
  6  照明彈（世界層 + 節拍 + 渲染）
  7  探照燈光束
  8  Blender 佈景 GLB
  9  試飛定值、凍結基準
```

3 到 7 互不相依，可以分開審、分開提交；6 與 7 是純畫面。

## 19. 開放項（負責人裁決）

1. 標題與橫幅文案（§14）。
2. B-17 沒有起落架的停放姿態接不接受（§5）。
3. 油桶堆與彈藥堆算不算進 `destroyCount`（§8.2 現在算）。
4. `destroyCount` 12、8 架 He 111、1,500 m —— 起始值。
5. 探照燈要不要是可炸的目標（現在是，hp 200）。
6. 三張目錄卡砍掉之後，`campaigns.test.ts` 那一組「目錄卡」測試的名字與
   註解改寫。
