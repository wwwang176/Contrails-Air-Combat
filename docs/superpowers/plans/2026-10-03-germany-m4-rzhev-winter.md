# 德 M4 勒熱夫雪地版：實作計畫

SPEC：`docs/superpowers/specs/2026-10-03-germany-m4-rzhev-winter-design.md`。分支 `wwwang176/snow`。
每個任務一個 commit；每個任務結束都要 `npx tsc --noEmit`（與基準比對）與該任務點名的測試全綠才進下一個。
**塗裝（Ju 87、Yak）不在這份計畫裡**，記在記憶，氛圍試玩後再提醒負責人。

狀態：T1–T7 已完成、待負責人試玩。T7 實測：整套單元測試只有 perf-gate 並行假紅（單獨跑綠）、`tsc` 0 行、
`glsl-compile.e2e` 全過、截圖看過總覽／俯衝／村／遠景／第二段突擊、兩邊防空都會開火、Codex 審查一項缺陷（兩支縱隊停妥疊車）已修。

## 0. 基準（動工前量一次、寫進 commit 訊息）

- `npx tsc --noEmit` 的行數（寫下當時量到的數字，不寫死）。
- `npx vitest run test/unit --maxWorkers=4 --minWorkers=1` 的檔數與項數。

## T1 命名取代：庫斯克 → 勒熱夫（純改名，行為不變）

機械式改寫，幾十個檔案，**改完 `tsc` 與整套單元測試逐一驗證**（CLAUDE.md 規則 2 的例外）。

- `git mv`：`src/world/kursk.ts`→`rzhev.ts`、`kurskRavines.ts`→`rzhevRavines.ts`、`test/unit/kursk*.test.ts`→`rzhev*.test.ts`。
- 識別字：`KURSK_*`→`RZHEV_*`、`createKursk`→`createRzhev`、`createKurskTerrain`→`createRzhevTerrain`、
  `TerrainKind` 的 `'kursk'`→`'rzhev'`、`terrain.kursk*` 的 i18n 鍵、`ui/menu.ts` 的選單值。
- 範圍清單：`git grep -il kursk`（32 個檔案，含 `test/tools` 的探針與 `glsl-compile.e2e.ts`）**再加 `git grep -l 庫斯克`**
  （`render/battleScars.ts`、`chunks.ts`、`geometry/ground/index.ts`、`heightFog.ts`、`timeOfDay.ts`、`tools/battlefield/craters.py`、
  `tools/livery/yak1b.py`、`test/unit/ground-battle.test.ts` 等，只出現中文的檔案）。舊的 2026-10-01 文件不動。
- 檔案開頭與函式的**敘述性註解**（「1943 年 7 月…蘇軍守村」）這一步不改，T5／T6 重寫。
- 玩家設定不存地形名（只存教學、音量、語言、輔助瞄準、畫質），不需要遷移。
- 驗證：`git grep -i kursk` 只剩舊文件、i18n 文字（T6 才換）與敘述註解；`tsc` 與基準相同；整套單元測試與基準同數。

## T2 冬季季節（`render/season.ts` 與使用處）

**加入 `winterSteppe` 與刪除 `julyWheat` 必須在同一個 commit**：刪掉之後，三處寫死 `'julyWheat'` 的比較
（`farmSettlements.ts:129`、`buildingBake.ts:72`、`floraShapes.ts:118`）會變成 TS2367 編譯錯誤，`tsc` 才會把它們抓出來。

先寫測試（紅）：
- `season.test.ts`：`winterSteppe` 色盤剛好 8 階、`layout === 'steppe'`；`SEASONS` 不含 `julyWheat`。
- **草原村才有的產出**（歐陸那支回傳 `[]`，`farmSettlements.ts:135`；`farmPlaces` 就是 `farmLaneVillages`，只斷言「村 `v-2,0`
  生得出來」抓不到錯）：`farmSettlements(…, 'winterSteppe', war)` 的 `streets` 與 `gardens` 長度 > 0；
  `buildingColors('winterSteppe')` 的屋頂不等於 `summer` 那一套。

實作：
1. `season.ts`：`Season = 'summer' | 'lateAutumn' | 'winterSteppe'`；`FIELD_COLORS`、`FLORA_COLORS` 補 `winterSteppe`、刪 `julyWheat`。
   起始色（截圖調）：田 8 階由 `#f4f6f8` 到 `#cdd6de`（雪、微藍灰）、犁田 `#d8dde2`、牧草 `#e6eaee`／`#dde3e8`、田埂 `#b9b2a6`、
   凹路 `#a8a49c`（壓實的雪）。樹：闊葉與灌木偏白（`#e9edf0`／`#dfe5ea`）；**針葉與遠處林帶保留偏暗**（`#9fb0ab` 上下），
   雪地空照裡林子通常是最暗的東西，全部漆白會讓林帶、沖溝與村樹在空中消失，試色看截圖再決定。
   `hedgeChance`／`woodGate`／`ploughChance` 沿用原庫斯克值。
2. 三處寫死 `julyWheat` 改成看格局（`layout === 'steppe'`）；`floraShapes.ts` 加冬季建築色表（屋頂偏白，燒毀維持焦黑）。
3. `terrain.ts` 的 `rzhev` 分支用 `winterSteppe`；林帶色由 `FLORA_COLORS` 推出（`belts.hex` 不再寫死 `0x2d3a22`）。
4. **顏色直接改常數，不加季節參數**（只剩一個草原季節，預設值沒有東西可以引用）：`steppeRavines.ts` 的 `RAVINE_SLOPE`、
   `RAVINE_BOTTOM`；`steppeVillage.ts` 的 `GARDEN_COLORS`、`STREET_COLOR`、`STEPPE_VILLAGE` **原地改色**（另開一張冬季表的話舊表沒人用，
   `noUnusedLocals` 會報錯）；`FIELD_COLORS.winterSteppe`。原本明寫 `julyWheat` 的測試（`steppe-ravines`、`steppe-village`、
   `belt-glsl`、`rzhev.test.ts`）改成 `winterSteppe`，只有顏色相關的斷言重算。
- 驗證：`season`、`terrain`、`steppe-ravines`、`steppe-village`、`flora-*`、`belt-glsl`、`fields`、`rzhev` 測試；
  `glsl-compile.e2e.ts` 補冬季一份。

## T3 冬季時段

- 先寫測試：`time-of-day.test.ts` 的完整清單含 `winterMorning`；色盤欄位齊全。
- `world/timeOfDay.ts` 聯集、`render/timeOfDay.ts` 的 `DAY_PALETTES` 與 `TIME_OF_DAY_IDS` 加 `winterMorning`：低太陽（仰角約 10°）、
  陽光冷白、地平線與天頂灰白、`hemiGround` 調亮（雪反光）、`fogDensity` 比正午濃。
  `ui/menu.ts` 的時段清單是手寫的，**不加**（這個時段只給任務用）。
- 卡片 `timeOfDay: 'winterMorning'`。`julyMorning` 換完沒人用，已刪除（聯集、`DAY_PALETTES`、`TIME_OF_DAY_IDS`）。

## T4 白霧

- `BATTLE_HAZE`（圓心與半徑，`world/rzhev.ts`）不變；**霧色底色**改由卡片帶：`MissionTheater` 加選填 `fogColor`
  （放在 `theater` 底下，**不放進 `haze`**，`battle-haze-wiring.test.ts` 的 `toEqual(BATTLE_HAZE)` 才不受影響），
  `main.ts` 的 `setBattleFog` 呼叫與 `render/heightFog.ts` 的 `battleFogTint` 讀它。`battleFogTint` 是
  `lerp(底色, 天色, 0.4)`：`fogColor` 取代的是**底色**；省略時與現在逐位元相同，其他任務不變。塵團色（霧色乘 0.85）自動跟著。
- 測試：有 `fogColor` 時底色是它、省略時等於預設；**`battle-haze-wiring.test.ts` 加原始碼斷言**，確認 `main.ts` 把
  `theater.fogColor` 傳進去（比照該檔第 42-47 行的做法）；`toEqual(BATTLE_HAZE)` 仍成立。
- 卡片 `theater.fogColor = 0xe8edf1`（起始值，截圖調）。

## T5 敵我互換、新擺位與規則（`world/rzhev.ts`、`missions/germany.ts`、`battle/setup.ts`）

**地圖幾何不動**（村、路、壕溝、雷區、障礙線、沖溝、`BATTLE_HALF`）。航向數值不變（局部 180° = 朝南 = 朝蘇軍，0° = 朝北 = 朝德軍），
原本蘇軍朝德軍的單位現在是德軍朝蘇軍，航向照用。

| 原陣列（庫斯克） | 新陣列 | 隊伍／單位 |
|---|---|---|
| `AT_GUNS`（10，北側三個支撐點） | `GERMAN_AT_GUNS` | **藍** `atGun` |
| `FRONT_T34`（8） | `GERMAN_DUG_PANZERS` | **藍** `panzer4`，`index` 2 劇本打掉沿用 |
| `WRECK_PANZERS`（6，南） | `WRECK_SOVIET_TANKS` | **紅** **`tankDug`**，`killAt: 0` |
| `WRECK_T34`（1） | `WRECK_GERMAN_PANZERS` | **藍** `panzer4`，`killAt: 0` |
| `STALLED_PANZERS`（2，雷帶南緣） | `STALLED_SOVIET_TANKS` | **紅** **`tankDug`**，`killAt` 40／150 |
| `SOVIET_INFANTRY`（31 班，沿壕溝） | `GERMAN_INFANTRY` | **藍** `infantry` |
| `GERMAN_INFANTRY`（22 班，雷帶南緣外） | `SOVIET_INFANTRY` | **紅** `infantry` |
| `SOVIET_MORTARS`（6，北） | `GERMAN_MORTARS` | **藍** `mortar` |
| `GERMAN_MORTARS`（4，南） | `SOVIET_MORTARS` | **紅** `mortar` |
| `SOVIET_TRUCKS`（4，村北端） | `GERMAN_TRUCKS` | **藍** `truck`（德軍後方在北邊） |

**紅隊殘骸與劇本戰車用 `tankDug` 而不是 `tank`**：同一個 `t34.glb`（`geometry/ground/index.ts:128-133`）、已在 `BURNS`
（`groundBattle.ts:62`）會冒煙；而 `campaigns.test.ts:682-690`「劇本不打任務目標」不准紅隊帶 `killAt` 的條目是 `atGun` 或 `tank`，
並且玩家若在劇本擊毀前先炸停住的戰車，不會被算進第二段的 `tank` 數。

**縱隊**：
- 紅縱隊兩支（各 10 輛 `tank`，**不放虎式**）**`hidden: true`**、`depart: RZHEV_BREAKTHROUGH`。藏著才不會在第一段就被炸毀、
  湊滿第二段的 8 輛（`destroyedInPool` 與 `stepMission` 每一步重數所有被炸毀的紅隊 `tank`，沒有「換段後才算」的切點；
  庫斯克的 `hidden` 就是為這個）。集結點在戰場框外的南邊：`SOVIET_ROUTE_A/B` 由 `lz +1900` 起，沿原德軍縱隊的路進來，
  **終點收在雷帶南緣外**（A 的車頭 `lz ≈ +440`、B 的車頭 `lz ≈ +600`，沿路排隊）。離任何德軍單位 ≥ 300 m：
  炸彈不分敵我（殺傷半徑約 33 m），原德軍縱隊的終點在德軍陣地裡（最近的反坦克砲 68 m），會誤炸自己人。
- 藍預備隊兩支（各 10 輛 `panzer4`）`hidden: true`、`depart: RZHEV_BREAKTHROUGH`。`GERMAN_RESERVE_WEST/EAST` 起點沿用
  原蘇軍預備隊的 `lz −1900`，沿村的東西外側南下，**終點延伸到第一線壕溝後（`lz ≈ +60…+110`、`|lx| ≈ 450…650`）**，
  離德軍反坦克砲與步兵 ≥ 80 m、離紅縱隊終點 ≥ 300 m（這樣「反擊」才接得到敵人，而不是停在自己的砲後面）。

**新增（原本沒有）**：
- `SOVIET_SUPPORT_GUNS`：紅 `atGun` **10 門**（第一段的目標），擺在無人地帶與蘇軍集結區（局部 `lz +300…+900`，兩翼與路兩側），
  航向朝北（0°）。限制（寫成佈局測試）：彼此 ≥ 150 m；離路中線 ≥ 70 m；不在雷區／壕溝／障礙線上；離任何縱隊路線 ≥ 100 m；
  **離每一個藍隊固定單位 ≥ 66 m**（兩倍殺傷半徑，取代原本「德軍離反坦克砲 ≥ 500 m」那條防誤炸）；**1,500 m 內至少有一個德軍射手**
  （反坦克砲或戰車；`mopUp` 的補射只在 1,500 m 內找射手，否則看不到是誰打掉的）；`|lx|`、`|lz|` 在 `BATTLE_HALF` 內。
- 防空：**德軍 `GERMAN_FLAK`（藍）8 門**，沿德軍陣地與村擺（`lz −100…−700`），目標是從北邊進場的 Yak；
  **蘇軍 `SOVIET_FLAK`（紅）12 門**，隨突擊隊與支援砲擺在南邊（`lz +350…+900`），目標是從南邊進場的 Ju 87。
  數量是起始值（德軍太多會把 Yak 全打光）。限制（**全部寫成測試**，原本只在註解裡）：離任何砲 ≥ 170 m、彼此 ≥ 150 m；
  離路中線 ≥ 60 m；不在主街兩端 100 m 內；離所有固定單位 ≥ 45 m、離障礙物 ≥ 10 m；**離兩邊所有縱隊路線 ≥ 60 m**
  （德軍預備隊的最後一段會穿過德軍防空要擺的那一帶）。
- 位置用守方演練法排（Opus 子代理當批評者），結果寫成常數。

**「全部單位」清單要補**（`tsc` 抓不到：`SOVIET_FLAK` 沿用名字但意思變了、步兵與迫擊砲互換名字、`GERMAN_FLAK` 與
`SOVIET_SUPPORT_GUNS` 是新增）：`UNIT_SPOTS`（`rzhev.ts`，決定村的房子要讓開哪些點）、`rzhev.test.ts` 三處
（原 97-100、352-355、398-401 行）、`rzhev-obstacles.test.ts`（原 74-77 行）。

**任務卡**（`missions/germany.ts`）：地面表依上表重組；`RZHEV_BREAKTHROUGH` 仍是「`atGun` 炸毀 ≥ 7」（只數敵方）；
`destroyCount: 7, destroyUnit: 'atGun'`；`retarget`：`tank` 8 輛；`defeatOnBombers`、`bomberPriority`、`airOnly`、護航、Yak 波次沿用；
`theater.shooters` 去掉 `tiger`。

**規則（`setup.ts`）**：
- **`mopUp` 只打敵方（紅）**：處理 `mopUp` 的迴圈（約 1413-1417 行）只看 `t.unit.id`，德軍的藍隊 `atGun` 會被一起打掉。
  先寫測試（紅）：場上有藍隊 `atGun` 時 `mopUp` 不動它。
- **友軍不報戰果**：`reportNameKey` 的 `ground` 分支略過藍隊目標（`drainReportBuffer` 不看隊伍，炸死自己的砲會跳出
  「擊毀 ZiS-3 反坦克砲」）。先寫測試（紅）。

**測試**（點名這些，T5 結束要全綠）：`rzhev`、`rzhev-mission`、`rzhev-obstacles`、`campaigns`、`ground-battle`
（`ground-battle.test.ts:102、127` 在真卡片找 `tankDug && killAt === Infinity`，T5 之後沒有這種單位，改成找新的條目）、
`dust-clouds`、`steppe-ravines`（第 176-184 行比對縱隊路線與沖溝）、`battle-haze-wiring`、`mission-waves`。新增：
- **隊伍分區測試**：藍隊固定單位的 `lz` 都 ≤ +105（除了列明的殘骸）、紅隊固定單位都 ≥ +160；抓互換名字時放錯陣列。
- 一門藍隊 `flakLight` 對一架紅隊 Yak 會選中目標並開火；反過來，紅隊防空對藍隊 Ju 87 也一樣（最小情境）。
- 佈局限制的測試（上面兩個「新增」條目）。

## T6 文字與敘述

- zh／en：`mission.germany-m4.*`（標題「勒熱夫」、地點「蘇聯 勒熱夫突出部西側（別雷方向）」、摘要、目標「炸毀蘇軍支援砲」、
  橫幅、第二段「炸毀突擊的 T-34」）、`terrain.rzhev`／`.hint`（「冬季的裝甲戰場」）；`period` 1942 年 11 月。
  **不寫 Ju 87 的次型號。**
- `world/rzhev.ts` 檔頭與各陣列的敘述註解重寫（現狀與理由，不寫沿革）；`battle/entry.ts` 的 `strikeDeep` 註解、`missions/germany.ts`、
  `render` 內提到庫斯克的註解。
- 再 grep 一次 `kursk` 與「庫斯克」，剩下的只有舊文件。`i18n` 測試（鍵集一致）全綠。
- 選單的地形剪影（`ui/menu.ts`）是夏季色，換成冬季色。

## T7 驗證與調校（可試玩的門檻）

- `tsc` 與基準相同；整套單元測試（`--maxWorkers=4 --minWorkers=1`）全綠；`glsl-compile.e2e.ts` 冬季那份編得過。
- **Playwright 截圖**（vite 開發伺服器、上帝視角）：戰場總覽、村與沖溝、遠景（霧中地平線不能一片純白）、德軍陣地近景、蘇軍突擊區、
  護航編隊。依截圖調 T2／T3／T4 的色值。
- **量測**（最小情境，不跑整場）：德軍防空與蘇軍防空確實會開火（T5 的兩個小測試）；Ju 87 對紅隊支援砲的俯衝能觸發
  （`diveBombPhase`，一個情境）。`ju87-flak-attrition.probe.ts` 要跑的話，它的 `FLAK` 對照組只看單位 id，換邊後會把德軍防空也關掉，
  要先加「只動紅隊」的過濾。**不跑 `dive-bomb-baseline`**（它是 AI 回歸的逐位元比對，這份計畫沒動 `AiController`，卡片又整個改了）。
- **Codex 審查**（背景、`codex exec -s danger-full-access`）→ 過濾過度設計 → 修確認的缺陷。
- 收尾：設計文件與記憶更新；dev server 開著、告訴負責人從哪一關進去；**提醒塗裝待辦**。

## T8 冬季塗裝（SPEC §4.7）

**T8a 複寫的管線（先紅後綠）**
- 測試先寫：`missionConfigFrom` 把卡片的 `liveries` 帶進 `BattleConfig.liveries`，省略時沒有這個鍵；德 M4 卡片對 `ju87`、`yak1b`、
  `bf109k4` 都指定 `winter`；`buildAircraft(spec, variant)` 取到的是變體樣板（材質的貼圖不同）、沒載入就拋錯、沒給變體就是預設；
  `liveryTexturesFor` 依變體換路徑。驗紅（變異：忽略變體、落回預設）。
- `missions/types.ts`、`missions/index.ts`、`battle/setup.ts`（型別與帶入）；`render/geometry/glb.ts`（樣板以 id＋變體為鍵、
  `loadGlbTemplate` 可載變體）、`buildAircraft.ts`（`buildAircraft(spec, variant?)`、`preloadLiveryVariants`、
  `liveryTexturesFor`）、三個 `*.model.ts`（`liveryVariants`）。
- `main.ts`：`loadBattle` 在 `startWorld` 前 `await preloadLiveryVariants`；三個建模型的地方與增援的 GPU 預傳讀 `battle.cfg.liveries`。

**T8b 貼圖**
- `paint.py` 加 `whitewash` 與 `red_star` 的外圈紅邊（預設不畫，夏季輸出逐位元不變）；三支腳本加 `--winter`；`export.py` 補尺寸表；
  用 `test/tools/livery-faces.ts` 倒出版面、畫圖、輸出 `textures-src/<id>_winter.png` 與 `public/textures/<id>_winter.png`。
- 貼圖測試：兩張圖都在、長寬比 4:3、與夏季版尺寸相同。

**T8c 驗收**：Playwright 截圖三型的冬季塗裝（上帝視角近拍與遠看）；遭遇戰仍是夏季塗裝（同一個機種在遭遇戰的樣板取預設）；
`tsc`、相關單元測試。

## 已知偏差（寫進 SPEC，負責人試玩後決定要不要改）

- **進場方向**：已改成村在敵我正中、兩邊對頭：Ju 87 在村中心北邊 2 km 朝南、Yak 開場預警 5 秒後在南邊 2 km 朝北
  （`STRIKE_FROM_NORTH`，`entry.ts`），見 SPEC §6。
- **蘇軍突擊由玩家的戰果觸發**：玩家炸掉蘇軍的砲，蘇軍第二梯隊才進場，劇情因果是反的；是沿用兩段式骨架的代價。
- 地面戰的戲是純畫面（`atGun` 在模擬裡沒有掛砲），蘇軍縱隊停在雷帶外與德軍互射，誰都打不死。

## 風險與守門

| 風險 | 守門 |
|---|---|
| 三處 `julyWheat` 漏改，村生不出來而測試不紅 | T2 的 `streets`／`gardens` 與建築色斷言；加入與刪除同一個 commit |
| `mopUp` 打掉德軍反坦克砲 | T5 的 `mopUp` 隊伍測試（先紅） |
| 友軍被炸卻報成戰果 | T5 的通報測試（先紅） |
| 第二段的數量在第一段就湊滿 | 紅縱隊 `hidden`；紅隊殘骸與劇本戰車用 `tankDug` |
| Ju 87 的炸彈炸到德軍 | 支援砲與縱隊終點離藍隊單位的距離測試 |
| 新單位陣列沒進五份「全部單位」清單 | T5 明列要補的清單；佈局測試涵蓋 |
| 德軍輕高砲過強、Yak 被打光 | 數量是起始值；試飛裁定 |
| 霧與雪都是白，遠景失去深度；樹全白而消失 | T7 截圖；`fogColor`、`winterMorning`、針葉與林帶色可調 |
| 改名漏檔（含只有中文的檔案） | `git grep -i kursk`、`git grep 庫斯克` 與 `tsc` |
| 冬季色盤階數錯，田塊圖案跑掉 | `season.test.ts` 的 8 階斷言 |
