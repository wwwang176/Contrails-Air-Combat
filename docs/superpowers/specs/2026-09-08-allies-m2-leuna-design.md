# 盟 M2「梅澤堡的油廠」—— B-17 炸洛伊納

2026-09-08

## 1. 要做的事

把 `allies-m2` 由 `battle: null` 變成打得起來的一關，而且題目換掉：
不再是魯爾的蓋爾森基興，改成**梅澤堡–洛伊納**。

```
  我方   B-17G ×4（玩家領隊 + 3 架 AI，同一個小隊）
  敵方   Bf 109 K-4 ×8，分兩批攔截
  要炸   洛伊納合成油廠：12 座構件，炸毀 6 座算贏
  時地   1944 年 11 月 2 日正午，德國中部　梅澤堡—洛伊納
  地形   任務專用的 leuna：薩勒河平原、手擺的低丘、廠區墊面保證平坦
  色彩   十一月的當下：收割後的田、落葉的闊葉樹、灰白的天
```

負責人裁定：

1. 題目換成梅澤堡–洛伊納，與德 M1「梅澤堡上空」是同一場的兩個座位
2. **這一版不做 Flak**。陸上砲位的邏輯在另一個 worktree 做；這裡只留方塊佔位
3. 廠區是多棟建築、炸毀 N 棟算贏
4. 我方是玩家領隊加三架 AI B-17，**AI 照自己的攻擊航路投彈**，不跟著玩家放
5. 轟炸高度 4,000 m（預設值）
6. 地形是任務專用、手擺、固定的；色彩符合 1944 年 11 月的史實

## 2. 史實

- 洛伊納是德國最大的合成油廠，油料戰役的頭號目標，1944 年 5 月到 1945 年
  4 月被打了二十幾次。
- 1944 年 11 月 2 日第八航空軍出動六百多架 B-17 打洛伊納。德國空軍做出
  那年秋天最大規模的攔截，出動約五百架，第八航空軍損失四十架轟炸機，
  大半是被戰鬥機打下來的。
- 攔截主力是 Fw 190 A-8 突擊大隊集體從後方衝進轟炸箱，Bf 109 G-14／K-4
  在上層掩護。遊戲沒有 Fw 190，用 K-4 頂替 —— **K-4 在 1944 年 11 月已經
  服役，年代對得上**。
- 洛伊納在薩勒河西岸的平原上，梅澤堡在北邊，地勢平坦；西邊是蓋澤爾谷的
  露天褐煤礦區。
- 11 月初的德國中部：田收完了，犁過的深褐色地與麥茬的赭色佔大半；闊葉樹
  落葉、針葉樹留著；正午太陽仰角只有二十幾度，天色灰白。

## 3. 已經在的（查證過，不必做）

- **炸彈的一切**：彈道（`world/bomb.ts`）、彈艙與連投（`weapons/bomb.ts`）、
  爆炸範圍傷害 `bombBlastDamage`（30 m 線性衰減）、確定性散佈。
- **B-17G 的掛載**：`LOADOUT_BY_AIRCRAFT.b17g` = 10 枚 × 9,000，回補 20 s。
- **投彈瞄具**：B 模式機腹視角、圓錐夾制、落點圈、紅綠包絡
  （`camera/bombsight.ts`、`hud/widgets/bombsight.ts`、
  `weapons/releaseEnvelope.ts`）。`solveImpact` 吃的是 `world.groundAt`，
  落點本來就落在地形上。
- **轟炸機砲塔的 AI 自衛**：`World.ts` 對每一架存活的機無條件跑
  `stepTurrets`，玩家的 B-17 也一樣。
- **AI 的攻擊航路**：`ai/strikeRun.ts` 的 `stepStrike` 狀態機（進場、鎖
  航向直飛、投放、脫離）與 `ai/bombRun.ts` 的 `makeBombProfile`。日 M4 的
  G4M 走的是同一個狀態機，但剖面是**雷擊**（`TORPEDO_PROFILE`，掛載預設
  魚雷）；轟炸剖面目前只有掛彈零戰的掃射路徑在用。
- **十二關裡七張已經就緒**（盟 M1、M4；德 M1、M4；日 M1、M3、M4），五張
  目錄卡。做完這一關是八張就緒、四張目錄卡。
- **增援波次與預警**：`MissionWave`、`byLatest`、`warnLead`。
- **農地地形的全部**：生成器、田區著色器、樹籬、樹林、村落、遠景環。
- **船的火與煙**（`ship-coast-and-fires`）、剛做好的爆炸碎片。

`docs/roadmap.md` 里程碑 2 的「炸彈艙開關」「投彈瞄準輔助」「炸彈範圍
傷害」勾選狀態是舊的，三項都已上線。

## 4. 缺的東西

| 缺口 | 現況 | 這一輪 |
|---|---|---|
| 地面目標實體 | `applyBombBlast` 只掃飛機與船，地面上沒有任何東西吃得到傷害 | §7 `world/groundTargets.ts` |
| 「炸毀 N 座」的規則 | `MissionRules` 只有殲滅／撤離／護航／擊沉／守住 | §8.1 `destroy` |
| 任務專用地形 | 三種地形都是程序化撒的，指不了廠區的位置 | §6 `leuna` |
| 十一月的色彩 | 田區色盤與樹冠色是模組常數，烘進著色器與頂點色 | §6.4 季節參數 |
| AI 對地面目標的投彈 | `stepStrike`、`StrikeProfile.plan`／`shouldRelease`、`pickShipTarget` 與 `bombRun.ts` 的四支都吃 `Ship`；`AiController` 沒有船就早退 | §9 打擊目標 |
| 工廠的外型 | 沒有任何地面建築的幾何 | §11 程序化構件 |
| 地面目標的 HUD 標記 | `fillMarkers` 只掃船 | §10 |

## 5. 範圍：不做的

- **不做陸上 Flak 的邏輯**。砲位的瞄準與發射還沒接。這裡只有佈局常數
  `FLAK_SITES`，擺的是不還手的 8.8 cm 砲位靶（§7.4）。
- **不做 P-51 護航**。史實上護航被引開了；而且四架 B-17 加八架 Bf 109
  已經是這一關的效能預算。
- **不做煙幕**。它是下一個難度旋鈕，等關卡跑起來再談。
- **不做薩勒河、鐵路、廠內道路**。廠區本身夠大就看得出來。
- **不做光禿的樹的幾何**。闊葉樹只換樹冠色，形狀不動。
- **不做 AI 僚機跟著領隊投**。負責人裁定 AI 走自己的攻擊航路。
- **不動 `sink`、`defend`、日 M4、盟 M4 一個字**。
- **不改德 M1 的地形**。它現在是 `archipelago`，要不要換成 `leuna` 是
  負責人的決定，列在 §13。

## 6. 地形 `leuna`

### 6.1 生成器

`TerrainKind` 加第四種 `'leuna'`。生成器在 `src/world/leuna.ts`：

- 用農地那套多瓣起伏（`makeLobes` / `bakeRelief`）與同尺寸的高度場
  （`FARM_SIZE` × `FARM_CELL`，30 km 見方）。
- **丘陵是手擺的清單，不撒隨機。** 每一顆寫中心、半徑、峰高、瓣的種子，
  形狀與 `archipelago.ts` 的 `ANCHORS` 同。西側幾顆較高的代表蓋澤爾谷的
  礦區土堆，其餘是平原上零星的緩丘。峰高上限沿用 `HILL_PEAK_MAX`（120）。
  **`outerRadius` 由生成器自己算 `radius × WOBBLE_MAX`**，清單裡不寫 ——
  `makeLobes` 信任呼叫端給的值，寫錯的話墊面保證就沒了而且不報錯。
- **廠區墊面靠距離保證平坦，不做壓平運算。** 每一顆丘陵的膨脹圓離墊面
  矩形至少 `PAD_CLEARANCE`（起始值 400 m）。`bakeRelief` 只掃膨脹圓內，
  圓外回到 `floor = 0`，所以墊面內的高度在結構上就是 0。護欄量的是
  **圓到矩形的幾何距離**，不是只量墊面內的高度 —— 後者在丘陵挪到離墊面
  100 m 時還是綠的（§12.1）。
- 丘陵之間維持 `HILL_GAP`（200 m），那是 AI 避障的硬約束，理由見
  `farmland.ts`。常數從農地匯出共用，護欄斷言最近的一對 `≥ HILL_GAP`，
  不是只斷言不重疊。
- 每一顆丘陵的膨脹圓都在 `HILL_LIMIT` 之內，理由同農地（外圈要接得上
  遠景環）。

### 6.2 佈局常數

**整張圖的空間關係寫在同一個檔案裡**，關卡卡片引用它，不自己寫座標：

```
  PLANT_CENTER    廠區中心，(0, −7,000)。藍隊開局在 z ≈ +5,000 朝 −Z，
                  投彈航路 12 km，4,000 m 高度約兩分多鐘
  PLANT_HEADING   廠區的朝向（構件的相對偏移繞它轉）
  PLANT_PAD       墊面矩形，1,400 × 800 m
  FLAK_SITES      預定砲位，環繞廠區 1.5 到 3 km，各有座標與朝向。
                  起始 8 座。這一版是不還手的靶
  EGRESS          脫離方向，−Z 繼續往前 —— 投完不回頭，那是史實的脫離
```

出生線與進場點沿用 `ENTRY_PLANS` 的 `headOn`，不另寫。

### 6.3 算繪

`createTerrain('leuna')` 走農地的算繪路徑（`createFarmGround`、遠景環、
`createVegetation` 與三個農地散佈器），只把高度場、丘陵與**季節**換掉。
`createFarmlandTerrain` 抽一個吃 `{ field, hills, season }` 的內部函數，
農地與 leuna 各叫一次。

遭遇戰選單不列 `leuna`，它是任務專用。

### 6.3b 展示區

**不新開頁面，用現有的 `daylight.html`。** 它走的就是遊戲那條路徑
（`createScene` + `createTerrain` + `applyTimeOfDay`），工具若自己抄一份
光照，看到的就不是遊戲裡的東西。這一輪加進去的：

- 地形清單列 `leuna`，時段清單列 `novemberNoon`。切到 leuna 時預設時段
  跟著切成 `novemberNoon`，因為那張圖的色盤是為它調的。
- 切到 leuna 時把 `PLANT_LAYOUT` 的 12 座構件與 `FLAK_SITES` 的方塊擺在
  墊面上，飛機停在廠區上空 4,000 m 朝 −Z —— 那正是投彈航路上看到的畫面。
  地形、廠區、天色三者只有同時在畫面上才判斷得出來。
- 鏡頭沿用工具現有的自由視角，可以降到低空看丘陵的起伏與樹冠色。

`tools/blast.ts` 的地形清單也列 `leuna`，那是看爆炸在深色田上的對比用的。
六種構件各自的尺寸與調色在 `hangar.html` 看（§11）。

### 6.4 十一月的色彩

三層，各自從現有的機制接，不另做系統：

**天色**：`DAY_PALETTES` 加一個時段 `'novemberNoon'`。太陽仰角約 25°、
色溫偏冷、`hemiSky` 與 `skyZenith` 灰白、`fogDensity` 比正午高。卡片的
`timeOfDay` 選它。海色欄位照抄正午，內陸用不到。它進 `TIME_OF_DAY_IDS`，
所以 daylight／blast／torpedo 三個工具頁的時段按鈕會多一顆；遭遇戰選單
的四筆是另一份手寫清單，**刻意不列它**。

**田區**：`fields.ts` 的色盤、犁田、樹籬、凹路、樹林五個常數與
`PLOUGH_CHANCE` 收成一份 `FieldColors`，由季節決定。`FIELD_GLSL` 與
`fieldSurfaceColor` 改成吃季節的工廠函數；`applyFields(material, season)`
的 `customProgramCacheKey` 要帶季節（`farm-fields:${season}`），否則先看過
夏季農地再進 leuna，three 會重用夏季的著色器，畫面還是綠的。
`createFarmGround` 與 `createFarHorizon` 都明確收季節。夏季那一份
**逐位元不變**（§12.6 守著）。晚秋的起始值：

```
  色盤     麥茬赭 → 冬麥苗淡綠，八階仍是一條漸層
  犁田     深褐，而且 PLOUGH_CHANCE 由夏季的值提高（大半的田犁過了）
  樹籬     深褐灰
  凹路     泥色，比夏季暗
  樹林     褐橄欖
```

**樹**：`floraShapes.ts` 的 `BROAD_LEAF`、`CONIFER`、`BUSH_LEAF` 收成
`FloraColors`，`createFloraGeometries(season)` 與點池的樹冠色跟著季節。
季節從 `VegetationOptions.season` 進（預設 `summer`），**不改
`createVegetation` 的位置參數**，也不改全域的 `POINT_COLOR`。每一份植被
自己建幾何與池、自己 dispose，兩種季節不會互相污染。晚秋：闊葉樹冠換成
枯枝的褐灰、灌木換褐、針葉略暗。**房子的顏色不動。**

季節型別 `Season = 'summer' | 'lateAutumn'` 放在 `src/render/season.ts`，
農地與群島恆為 `summer`。所有色值都是起始值，拿眼睛校。

## 7. 地面目標

### 7.1 實體

新模組 `src/world/groundTargets.ts`，照 `ships.ts` 的形狀：

```ts
type PlantKind = 'hydroTower' | 'chimney' | 'boilerHouse'
  | 'oilTank' | 'gasHolder' | 'coolingTower'   // GroundUnitId 的一部分
interface GroundTarget extends StrikeTarget { index; team; unit; armour; position;
  orientation; heading; spawn; radius; hull; impactY; value; hp; alive }
```

六種構件登記在 `render/geometry/ground` 的 `GROUND_UNITS`（與戰車、卡車、
砲位、火車同一張表），血量與裝甲在 `world/groundTargets.ts` 的
`GROUND_HP`／`GROUND_ARMOUR`。

**不是 `Combatant`，也不是 `Ship`。** 船那份檔頭的理由（沒有飛行模型、
不進記分板、不上接觸列表）完全適用；而且船有沉沒動畫與「`position.y`
恆為水線」的假設，硬套會把工廠沉進地裡。

六種構件，尺寸與血量。血量用「幾枚炸彈」訂（一枚 9,000，30 m 線性衰減，
直擊算滿）：

| 構件 | 外型 | 尺寸（m） | 血量 | 幾枚 |
|---|---|---|---|---|
| 氫化塔 | 高瘦圓柱，成排 | ⌀8 × 40 | 8,000 | 1 |
| 煙囪 | 最高的，遠處先看到 | ⌀8 × 100 | 8,000 | 1 |
| 鍋爐房 | 大方盒、人字頂 | 60 × 30 × 18 | 16,000 | 2 |
| 儲油槽 | 矮圓柱，成群 | ⌀25 × 12 | 6,000 | 1 |
| 氣櫃 | 大圓桶 | ⌀40 × 35 | 14,000 | 2 |
| 冷卻塔 | 截錐 | ⌀30 × 40 | 14,000 | 2 |

命中盒用一個或兩個軸對齊盒近似，與船同一套 `Box`。圓柱與截錐用
**外接方盒**，是保守近似：盒角比圓面多出一圈，炸彈落在那一圈會提前在
盒頂引爆。煙囪的角差不到 2 m，氣櫃約 8 m，對 30 m 的爆炸半徑都不構成
差別，**接受，不做窄相**。`radius` 是包圍球的上界，護欄守（同 `ships.ts`
的規則）。

**子彈與炸彈都認得地面目標，飛機穿過去。** 地面目標是與戰車、卡車、
砲位、火車共用的實體（`world/groundTargets.ts`，登記表在
`render/geometry/ground`）：子彈走口徑門檻（廠房裝甲 0，但 5 對 8,000 是
實質免疫），炸彈走範圍傷害與擋路。撞建築不做 —— 這一關沒有路徑會用到。

### 7.2 廠區的擺法

`MissionBattle.ground?: readonly GroundEntry[]`，每一座一筆**世界座標**
（`unit`、`team`、`x`、`z`、`heading`）—— 地面目標各自有各自的位置與朝向，
不像艦隊要排陣型。12 座構件相對廠區中心的偏移寫在 `leuna.ts`
（`PLANT_LAYOUT`），卡片把它們換成絕對座標，砲位（`FLAK_SITES`）同。
放置在 `setup.ts` 的 `placeGround`，與 `placeFleet` 並列。

**高度先擺 0，地形接上之後落地。** `createBattle` 跑的時候地形還沒注入
`World`（那是 `main.ts` 之後才做的事），建構期讀 `groundAt` 拿到的是預設
平面。`main.ts` 在接上地形之後呼叫 `settleGroundTargets` 填高度；墊面在
結構上保證是 0（§6.1），所以廠區落地之後還是 0。`missionConfigFrom` 要
**明列透傳** `ground`，那一支刻意不透傳未知欄位，漏了的症狀是卡片上有
廠區、場上沒有。

### 7.3 World 的接線

全部抄船那段的形狀，接在船的迴圈**之後**、不合併迭代器、不動船那段的
運算順序 —— 那是船的路逐位元不變的前提。

1. **範圍傷害**：`applyBombBlast` 多掃一圈地面目標 —— 包圍球粗篩、
   `pointBoxDistance` 對自身座標的盒、`bombBlastDamage`。
2. **擋路**：`onBombBlocked` 把地面目標的盒也算進去。煙囪與塔有高度，
   炸彈不該穿過去在地上爆。**兩個閘都要改**：`Bombs.step` 只有在
   `ships.length > 0` 才拿得到擋路回呼，回呼裡沒有船也直接早退 —— 改成
   「船與地面目標都空」才早退。漏一個的症狀是煙囪擋彈那條護欄紅得莫名
   其妙，因為回呼根本沒被傳進去。擋到的是船還是建築要分開記
   （`bombShip` 旁加 `bombGround`）。
3. **落點事件的種類**：`ImpactEvents.kind` 加第四種 `3 = 建築`，擋路擋到
   建築的落點用它。`emitBombBlasts` 對它用船命中的爆炸配方加碎片。
   **`lightShipFires` 改成只認 `kind === 2`** —— 它現在只看第六格的索引
   `≥ 0`，建築的索引會被當成船的索引，火會長到編號相同的那艘船上。
4. **摧毀事件與落點事件分開。** 每一顆炸彈恰好推一筆落點事件；建築在
   `alive` 由真變假的那一步另外推一筆 `groundKillEvents`（座標與
   構件索引），只推一次。合在一起的話直擊剛好炸毀時同一個爆點推兩次，
   火球、碎片、煙全部加倍。
5. **重設與生命週期**：`resetGroundTarget` 在 `resetBattle` 與船並列（這一
   關有波次所以重開會重建 World，但通用的 `MissionGround` 不能靠這個
   巧合）；模型照 `shipModels` 的 create／update／dispose 三段掛在換場的
   同一個位置；新增的火煙池列進 `resetPools`。

熱路徑不配置：地面目標最多 16 座，迴圈用索引，轉接物件在組場時建一次。

### 7.4 預定砲位

`FLAK_SITES` 是佈局常數；卡片把每一座擺成一台 `flakHeavy` 地面目標
（8.8 cm Flak 18 的 GLB，`render/geometry/ground`）。它們是不還手的靶：
打得掉、算進炸毀的計數，但不瞄不射 —— 陸上砲位的瞄準與發射還沒接。

## 8. 規則與卡片

### 8.1 新規則 `destroy`

```ts
| { kind: 'destroy'; count: number }
```

`MissionInputs` 加 `targetsDestroyed`、`targetsTotal`；`setup.ts` 的計數
迴圈加地面版，**只算 `team !== 'blue'` 的**（與船同一條理由）。那一份
`MISSION_INPUTS` 是跨場的模組單例，兩格在初始化與**每一步掃描前**都要
顯式歸零 —— 上一場炸毀六座之後重開，新場第一步繼承舊值直接判勝，與
`vitalSunk` 出過的殘留是同一類錯。`resetMissionState` 對 `sink` 設
`metric`／`metricTotal` 的那兩行也要含 `destroy`，漏了的症狀是開局目標列
閃一下 `(6/6)`。

`stepMission` 的分支逐行抄 `sink`：`metric = count − destroyed`、
`metricTotal = count`，HUD 目標列印 `(2/6)`。**判負是藍隊全滅
（`aliveBlue === 0`），不是玩家陣亡** —— `sink` 就是這樣寫的，玩家被擊落
後兩秒接手友機的機制才保得住。

`missionRules` 的判準是卡片有沒有 `destroyCount`，**排在 `sink` 旁邊、
`defend` 之前**，理由同 `sink` 那段註解：進攻的規則優先。一張卡不得同時
帶 `sinkCount` 與 `destroyCount`，`campaigns.test.ts` 擋。

### 8.2 卡片

```
  id        allies-m2（不變，campaigns 測試釘住前綴）
  title     梅澤堡的油廠
  summary   駕駛第八航空軍的 B-17G 轟炸洛伊納合成油廠，穿過德國空軍那年
            秋天最大的一次攔截。
  place     德國中部　梅澤堡—洛伊納
  period    1944 年 11 月
  type      打擊
  battle    objective   炸毀洛伊納油廠
            blueSpec    B17G ×4        redSpec  BF109K4 ×4（開場）
            terrain     leuna          altitude 4,000
            timeOfDay   novemberNoon
            ground      PLANT（12 座）  destroyCount 6
            entry       headOn
            waves       第二批 4 架 Bf 109，時鐘 90 s，從後方追上
                        （starboard: π —— 省略的話仍沿用紅方的正面進場，
                        會生在前方反向飛來）
```

開場的四架 Bf 109 由 `headOn` 放在正前方，接近約 40 秒 —— 那是 1944 年
標準的十二點鐘正面攻擊。第二批從後方來，對應突擊大隊從尾部衝進轟炸箱；
護欄量它的出生點在藍隊後方、機首朝 −Z（§12.8）。
**時間與架數全部是起始值，由試飛裁定。**

### 8.3 我方的座位

四架 B-17 同一個小隊、`duty: 'combat'`、玩家是小隊長。`order.ts` 的
「玩家不坐 transit」與「transit 恆為一架」都不適用 —— 這一關沒有 transit。
AI 僚機在沒有攻擊目標時走既有的編隊跟隨，有目標時走攻擊航路（§9）。

## 9. AI

### 9.1 泛化的邊界：轟炸機的攻擊航路，不是整套船攻擊

**只泛化轟炸機走的那條路**：`ai/strikeRun.ts` 的 `stepStrike` 與
`StrikeProfile.plan`／`shouldRelease`，以及它們呼叫的 `bombRun.ts` 四支
（`insideWindow`、`shipAt`、`shouldRelease`、`stepBombAim`；
`releaseWindowOf` 吃的是 `ShipClass`，同樣要改）。**戰鬥機的掃射
（`shipAttackCommand`）、砲位鎖定、雷擊剖面的船專用部分一個字不動** ——
它們讀砲位與艦體座標，地面目標沒有這些，硬套一個共用型別只會讓兩邊都
變薄。

打擊目標的視圖：

```ts
interface StrikeTarget {
  readonly kind: 'ship' | 'ground'
  readonly index: number           // 在各自清單裡的位置，10 Hz 決策拍之間用它複查
  readonly team: Team
  readonly position: Vector3       // 世界座標
  readonly orientation: Quaternion // 直接透傳，不從 heading 重算 —— 三角函數
                                   // 與四元數的浮點結果不保證逐位元相同
  readonly speed: number           // 地面目標恆 0
  readonly hull: readonly Box[]    // 自身座標，第一個盒是主體
  readonly impactY: number         // 落點求解的平面：世界高度，
                                   // = position.y + max(box.center.y + box.half.y)
  readonly value: number           // 選目標用：船是艦級血量，地面是構件血量
  readonly alive: boolean          // 就是原物件的旗標，決策拍之間死了要看得到
}
```

**沒有轉接物件。** `Ship` 與 `GroundTarget` 直接滿足它：船多三格艦級資料的
複本（`hull`、`impactY`、`value`，建船時填一次），地面目標本來就有這幾格。
決策拍與物理步上不配置。地面目標的 `shipAt` 退化成常數。船那條路的行為
**逐位元不變**（§12.5）。

### 9.2 選目標與接線

- 轟炸機的目標選擇掃兩份清單（船、地面目標），價值優先、距離次之，規則
  照 `pickShipTarget`。鎖定存的是 `{ kind, index }`，每一步用 `alive`
  複查，與現在對船的做法相同。
- `AiController.attackShip` 的早退改成「船與地面目標都空」才退；
  `main.ts` 的 `wireTerrain` 每幀注入 `ctl.groundTargets`，整合測試的
  `wire()` 副本也要加；`clearTerrainState` 一併清掉鎖定。漏了任何一處的
  症狀是三架 AI B-17 一枚都不投、畫面上一切正常。
- 戰鬥機仍走 `pickShipTarget` 的船專用路徑；掛彈零戰在這一關不存在。

### 9.3 三架 AI B-17

它們有彈艙、有目標，就走 `makeBombProfile` 的攻擊航路：進場、鎖航向直飛、
`shouldRelease` 成立就放。**目標分派不做**：選擇規則是價值優先，三架很
可能同時鎖住同一座 16,000 的鍋爐房，投完才轉下一座。這是負責人裁定的
「AI 照自己的邏輯」，要不要加決定性的分派是試飛之後的事（§13）。

接戰半徑 `SHIP_ATTACK_RANGE` 是 8 km，開局離廠區 12 km，所以前四公里
AI 走編隊跟隨，進到 8 km 才切攻擊航路。這個常數是共用的，不動。

## 10. HUD

- `fillMarkers` 多一個地面目標的迴圈，高度用構件的頂（`cls` 的盒頂，
  不像船需要模型才知道桅杆），敵對紅。
- 目標列印 `炸毀洛伊納油廠 (2/6)`。
- 目標圈不用；小地圖照船的現況，不畫。

## 11. 外型與毀壞

- 六種構件的程序化幾何在 `src/render/geometry/ground/plant.ts`，用地面單位
  共用的積木（`parts.ts` 的 box、cyl、assemble），登記進 `GROUND_UNITS`；
  命中盒由 `PLANT_SIZE` 撐起來，不從幾何量。
- 畫法是地面單位共用的 `render/groundTargets.ts`：一台一個 `Mesh`；炸毀後
  換材質，有殘骸版的（廠區六種）連形狀一起換成矮一截的深色殘骸（高度取
  原來的 25%），重開一場換回來。
- 毀壞的那一刻（讀 `groundKillEvents`）：船命中的爆炸配方
  （`blast.ts`）加剛做好的 `debris.burst`，然後點一個固定在世界座標的
  火點，重用 `shipFires.ts` 的噴煙回呼 `FirePuffFn` 與船火同一套「起火
  加垂直煙」的參數。**不重用船火的資料結構**：它把火點存成艦體座標、每
  幀跟著船轉，建築不動，直接存世界座標更簡單。洛伊納被炸後的煙柱幾十
  公里外都看得到，那個效果現成。
- `hangar`／`blast` 工具頁列出六種構件，調色與驗尺寸用。

## 12. 護欄

每一條先驗紅或做變異測試。**兩條「逐位元不變」的基準要在重構之前先
凍結並提交**（§12.5、§12.6），改完之後用兩次新程式互比是恆真的。

1. **墊面平坦**：量兩件事 —— 每一顆丘陵的膨脹圓到墊面矩形的**幾何距離**
   `≥ PAD_CLEARANCE`，以及墊面加一格圍裙內每一格高度都是 0。只量高度的
   話，丘陵挪到離墊面 100 m 還是綠的。變異：把一顆丘陵挪進 clearance。
2. **丘陵不出界、間隙成立**：膨脹圓在 `HILL_LIMIT` 之內；最近的一對
   `≥ HILL_GAP`（不是只斷言不重疊 —— 那樣 gap 改成 1 m 仍是綠的）。
3. **地面目標吃得到範圍傷害**：**經由 World 的一顆真炸彈**驗，不是只驗
   純函數 —— 直擊扣滿、30 m 外為 0、兩座相鄰只有近的那一座扣血、扣到
   0 就 `alive = false` 且 `groundKillEvents` 恰好一筆。包圍球是上界
   （同船的測試）。
4. **擋路**：**零船、一座煙囪**的 World，從煙囪正上方投的炸彈在煙囪頂
   引爆、落點事件 `kind = 3`。零船才殺得到回呼閘那個缺陷。
5. **船那條路逐位元不變**：現有的 `replayDigest` 不含船、炸彈池、魚雷池
   與攻擊狀態機，30 秒時飛機姿態相同不代表投放時刻相同。重構前先寫一支
   擴充的摘要（船的位置與血量、炸彈與魚雷池、每架的 `strike` 狀態），
   對日 M4 與盟 M4 各跑 90 秒，把摘要**凍結成基準提交**；重構後比對。
6. **夏季色盤逐位元不變**：重構前先提交夏季 `FIELD_GLSL` 的雜湊、
   `fieldSurfaceColor` 的取樣表、樹的頂點色陣列雜湊；重構後比對。
   晚秋的 GLSL 字串也要進 `glsl-compile` 的 e2e 編一次。
7. **`destroy` 規則**：炸毀 5 座是 `fighting`、6 座是 `victory`；藍隊全滅
   是 `defeat`，玩家陣亡但僚機還在**不是**；`metricTotal` 是 6；重設之後
   `metric` 是 6 不是 0。
8. **卡片就緒**：`campaigns.test.ts` 認得 `allies-m2` 已經是 `ReadyMissionCard`
   （八張就緒、四張目錄卡）、`ground` 透傳到 `BattleConfig`、
   `destroyCount ≤` 敵方構件數、`sinkCount` 與 `destroyCount` 不共存、
   第二批的出生點在藍隊後方且機首朝 −Z。
9. **AI 投得到**（整合，`beforeAll`）：headless 跑三架 AI B-17 對廠區，
   **三架的彈艙各自都減少**（只驗「至少一枚」抓不到兩架僚機因站位不投），
   至少一枚落在墊面內、至少一座構件掉血。這是「疊新的一層之前先量它
   跑不跑得到」那條紀律。
10. **標記池含地面目標**：敵對紅、摧毀後消失、不影響船的標記；另加一條
    源碼接線測試守 `main.ts` 真的把 `world.groundTargets` 傳進
    `fillMarkers`（照 `bomb-bay-wiring.test.ts` 的做法）。
11. **幾何與命中盒對得上**：期望尺寸**獨立寫死**在測試裡，幾何包圍盒與
    `hull` 都對著它比 —— 命中盒若直接由幾何推導，「幾何在盒內」就是
    恆真的；腳印貼 y = 0（同 `ground-units.test.ts` 的做法）。

## 13. 開放項（負責人裁決）

- **德 M1 要不要換成 `leuna`**。它現在是 `archipelago`，梅澤堡是內陸。
  換了之後兩關真的是同一張圖的兩面。
- **Flak 合併時的接點**：`FLAK_SITES` 的座標與朝向、`ImpactEvents` 的
  `kind = 3`、`GroundTarget` 要不要就是砲位的載體。這一版不預設答案。
- **試飛裁定的起始值**：兩批 Bf 109 的時間與架數、`destroyCount`、
  構件血量、`PAD_CLEARANCE`、全部色值、`novemberNoon` 的光照數字。
- **AI B-17 的目標分派**：三架很可能疊在同一座構件上。試飛看了覺得浪費
  再加決定性的分派，那是另一條規則。headless 實測（`ai-bombing-leuna`）
  三架先鎖進到 8 km 之內的砲位，進到廠區才換成鍋爐房；兩座鍋爐房各挨
  一趟。
- **轟炸機的存活**：headless 實測玩家席位不動時，開場四架 K-4 在 55 秒打掉
  一架 B-17，四架到 210 秒全滅。玩家會閃、砲塔也在打，但要不要調 K-4 的
  架數、開場距離或 B-17 的血量，是試飛之後的事。
- **德 M1 的空域字串**：兩關是同一場的兩個座位，簡報的護欄要求十二關的
  空域各不相同，所以盟 M2 寫「洛伊納油廠上空」、德 M1 維持「梅澤堡—洛伊納」。
