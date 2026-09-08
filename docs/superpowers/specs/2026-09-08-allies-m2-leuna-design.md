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
- **AI 的攻擊航路**：`ai/bombRun.ts` 的 `makeBombProfile`，日 M4 的 G4M
  已經在用。
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
| AI 對地面目標的投彈 | `pickShipTarget` 與 `bombRun.ts` 五支的第二個參數都是 `Ship` | §9 打擊目標視圖 |
| 工廠的外型 | 沒有任何地面建築的幾何 | §11 程序化構件 |
| 地面目標的 HUD 標記 | `fillMarkers` 只掃船 | §10 |

## 5. 範圍：不做的

- **不做陸上 Flak 的邏輯**。砲位的瞄準、發射、被炸掉，全部在另一個
  worktree。這裡只有佈局常數 `FLAK_SITES` 與方塊佔位，方塊不能被打。
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
- **廠區墊面靠距離保證平坦，不做壓平運算。** 每一顆丘陵的膨脹圓離墊面
  矩形至少 `PAD_CLEARANCE`（起始值 400 m）。多瓣的最大擺動是
  `WOBBLE_MAX`，所以墊面內的高度在結構上就是 0。護欄量它（§12.1）。
- 丘陵之間維持 `HILL_GAP`（200 m），那是 AI 避障的硬約束，理由見
  `farmland.ts`。

### 6.2 佈局常數

**整張圖的空間關係寫在同一個檔案裡**，關卡卡片引用它，不自己寫座標：

```
  PLANT_CENTER    廠區中心，(0, −7,000)。藍隊開局在 z ≈ +5,000 朝 −Z，
                  投彈航路 12 km，4,000 m 高度約兩分多鐘
  PLANT_HEADING   廠區的朝向（構件的相對偏移繞它轉）
  PLANT_PAD       墊面矩形，1,400 × 800 m
  FLAK_SITES      預定砲位，環繞廠區 1.5 到 3 km，各有座標與朝向。
                  起始 8 座。這一版只是方塊
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
`timeOfDay` 選它。海色欄位照抄正午，內陸用不到。

**田區**：`fields.ts` 的色盤、犁田、樹籬、凹路、樹林五個常數收成一份
`FieldColors`，由季節決定。`FIELD_GLSL` 與 `fieldSurfaceColor` 改成吃季節
的工廠函數。夏季那一份**逐位元不變**（§12.6 守著）。晚秋的起始值：

```
  色盤     麥茬赭 → 冬麥苗淡綠，八階仍是一條漸層
  犁田     深褐，而且 PLOUGH_CHANCE 由夏季的值提高（大半的田犁過了）
  樹籬     深褐灰
  凹路     泥色，比夏季暗
  樹林     褐橄欖
```

**樹**：`floraShapes.ts` 的 `BROAD_LEAF`、`CONIFER`、`BUSH_LEAF` 收成
`FloraColors`，`createFloraGeometries(season)` 與 `POINT_COLOR` 跟著季節。
晚秋：闊葉樹冠換成枯枝的褐灰、灌木換褐、針葉略暗。**房子的顏色不動。**

季節型別 `Season = 'summer' | 'lateAutumn'` 放在 `src/render/season.ts`，
農地與群島恆為 `summer`。所有色值都是起始值，拿眼睛校。

## 7. 地面目標

### 7.1 實體

新模組 `src/world/groundTargets.ts`，照 `ships.ts` 的形狀：

```ts
type GroundKind = 'hydroTower' | 'chimney' | 'boilerHouse'
  | 'oilTank' | 'gasHolder' | 'coolingTower'
interface GroundClass { id; name; hull: readonly Box[]; radius; hp }
interface GroundTarget { index; team; cls; position; heading; hp; alive }
```

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

命中盒用一個或兩個軸對齊盒近似（圓柱用外接方盒），與船同一套 `Box`。
`radius` 是包圍球的上界，護欄守（同 `ships.ts` 的規則）。

沒有裝甲欄位：機槍打得到但傷害是 5 對 8,000，實質免疫，不必另寫規則。

### 7.2 廠區的擺法

`MissionBattle.ground?: MissionGround`，形狀照 `MissionFleet`：中心、朝向、
相對偏移的清單。12 座構件的相對座標寫在 `leuna.ts`（`PLANT_LAYOUT`），
卡片引用它。放置在 `setup.ts` 的 `placeGround`，與 `placeFleet` 並列。
高度取 `groundAt`，墊面保證是 0。

### 7.3 World 的接線

三處，全部抄船那段的形狀：

1. **範圍傷害**：`applyBombBlast` 多掃一圈地面目標 —— 包圍球粗篩、
   `pointBoxDistance` 對自身座標的盒、`bombBlastDamage`。
2. **擋路**：`onBombBlocked` 把地面目標的盒也算進去。煙囪與塔有高度，
   炸彈不該穿過去在地上爆。
3. **摧毀**：血量歸零就 `alive = false`，並推一個落點事件。`ImpactEvents`
   的 `kind` 加第四種 `3 = 建築`，算繪層用船命中的爆炸配方加碎片。

熱路徑不配置：地面目標最多 16 座，迴圈用索引。

### 7.4 預定砲位

`FLAK_SITES` 只是佈局常數。算繪層在每一座放一個 6 × 6 × 3 m 的深灰方塊；
World 不知道它們存在。另一個 worktree 的 Flak 合進來時，用同一份座標。

## 8. 規則與卡片

### 8.1 新規則 `destroy`

```ts
| { kind: 'destroy'; count: number }
```

`MissionInputs` 加 `targetsDestroyed`、`targetsTotal`；`setup.ts` 的計數
迴圈加地面版，**只算 `team !== 'blue'` 的**（與船同一條理由）。
`stepMission` 的分支抄 `sink`：`metric = count − destroyed`、
`metricTotal = count`，HUD 目標列印 `(2/6)`。判負維持現狀：玩家陣亡。

`missionRules` 的判準是卡片有沒有 `destroyCount`，**排在 `sink` 旁邊、
`defend` 之前**，理由同 `sink` 那段註解：進攻的規則優先。

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
```

開場的四架 Bf 109 由 `headOn` 放在正前方，接近約 40 秒 —— 那是 1944 年
標準的十二點鐘正面攻擊。第二批從後方來，對應突擊大隊從尾部衝進轟炸箱。
**時間與架數全部是起始值，由試飛裁定。**

### 8.3 我方的座位

四架 B-17 同一個小隊、`duty: 'combat'`、玩家是小隊長。`order.ts` 的
「玩家不坐 transit」與「transit 恆為一架」都不適用 —— 這一關沒有 transit。
AI 僚機在沒有攻擊目標時走既有的編隊跟隨，有目標時走攻擊航路（§9）。

## 9. AI

### 9.1 打擊目標視圖

`pickShipTarget` 與 `bombRun.ts` 的 `releaseWindowOf` / `insideWindow` /
`shipAt` / `shouldRelease` / `stepBombAim` 五支，第二個參數都是 `Ship`。
收一個最小的視圖：

```ts
interface StrikeTarget {
  readonly position: Vector3     // 世界座標
  readonly heading: number
  readonly speed: number         // 地面目標恆 0
  readonly hull: readonly Box[]  // 自身座標
  readonly deckY: number         // 落點求解的平面高度
  readonly value: number         // 選目標用，船是艦級血量，地面是構件血量
}
```

船與地面目標各給一個轉接（不複製資料，讀同一份欄位）。地面目標的
`shipAt` 退化成常數 —— 靜止讓抽象更容易，不是更難。船那條路的行為
**逐位元不變**（§12.5）。

### 9.2 選目標

`pickShipTarget` 改成掃兩份清單（船、地面目標），價值優先、距離次之，
規則不變。`AiController` 拿到的是 `StrikeTarget`，不再直接碰 `Ship`。
砲位鎖定（`gun` 索引）只有船有，地面目標恆 −1。

### 9.3 三架 AI B-17

它們有彈艙、有目標，就走 `makeBombProfile` 的攻擊航路：進場、鎖航向直飛、
`shouldRelease` 成立就放。三架各自挑價值最高、離自己最近的構件，所以會
分散打，而不是三架疊在同一座上。

## 10. HUD

- `fillMarkers` 多一個地面目標的迴圈，高度用構件的頂（`cls` 的盒頂，
  不像船需要模型才知道桅杆），敵對紅。
- 目標列印 `炸毀洛伊納油廠 (2/6)`。
- 目標圈不用；小地圖照船的現況，不畫。

## 11. 外型與毀壞

- 六種構件的程序化幾何放在 `src/render/geometry/plant/`，**不碰另一個
  worktree 的 `geometry/ground/` 目錄**，避免合併衝突。積木自己寫一份
  最小的（box、cylinder、合併），合併時再看要不要換成那邊的 `parts.ts`。
- 畫法照 `render/ships.ts`：少量、指定座標、一座一個 `Mesh`；毀壞後換成
  矮一截的深色殘骸網格（高度取原來的 25%）。
- 毀壞的那一刻：船命中的爆炸配方（`blast.ts`）加剛做好的 `debris.burst`，
  然後重用船的「起火加垂直煙」讓煙柱掛著。洛伊納被炸後的煙柱幾十公里外
  都看得到，那個效果現成。
- `hangar`／`blast` 工具頁列出六種構件，調色與驗尺寸用。

## 12. 護欄

每一條先驗紅或做變異測試。

1. **墊面平坦**：`leuna` 高度場在 `PLANT_PAD` 內每一格都是 0；把任一顆
   丘陵挪進 `PAD_CLEARANCE` 之內要紅。
2. **丘陵不出界、間隙成立**：沿用 `farmland.test.ts` 的兩條，對 leuna 跑。
3. **地面目標吃得到範圍傷害**：直擊扣滿、30 m 外為 0、兩座相鄰只有近的
   那一座扣血。包圍球是上界（同船的測試）。
4. **擋路**：從煙囪正上方投的炸彈在煙囪頂引爆，不落到地面。
5. **船那條路逐位元不變**：日 M4 的 `replayDigest` 在視圖抽出前後相同。
6. **夏季色盤逐位元不變**：`fieldSurfaceColor('summer')` 與 `FIELD_GLSL`
   的字串在改動前後相同；樹的頂點色同。
7. **`destroy` 規則**：炸毀 5 座是 `fighting`、6 座是 `victory`；玩家陣亡
   仍是 `defeat`；`metricTotal` 是 6。
8. **卡片就緒**：`campaigns.test.ts` 認得 `allies-m2` 已經是 `ReadyMissionCard`，
   `ground` 透傳到 `BattleConfig`。
9. **AI 投得到**（整合，`beforeAll`）：headless 跑三架 AI B-17 對廠區，
   至少一枚炸彈落在墊面內、至少一座構件掉血。這是「疊新的一層之前先量它
   跑不跑得到」那條紀律。
10. **標記池含地面目標**：敵對紅、摧毀後消失、不影響船的標記。
11. **幾何與命中盒對得上**：每一種構件的幾何包圍盒在 `hull` 之內、腳印
    貼 y = 0（同 `ground-units.test.ts` 的做法）。

## 13. 開放項（負責人裁決）

- **德 M1 要不要換成 `leuna`**。它現在是 `archipelago`，梅澤堡是內陸。
  換了之後兩關真的是同一張圖的兩面。
- **Flak 合併時的接點**：`FLAK_SITES` 的座標與朝向、`ImpactEvents` 的
  `kind = 3`、`GroundTarget` 要不要就是砲位的載體。這一版不預設答案。
- **試飛裁定的起始值**：兩批 Bf 109 的時間與架數、`destroyCount`、
  構件血量、`PAD_CLEARANCE`、全部色值、`novemberNoon` 的光照數字。
