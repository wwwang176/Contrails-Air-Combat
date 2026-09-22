# 任務關卡的開發順序

**這是一份活的清單。** 做完一條就打勾並註明在哪一輪收尾；發現某一條的前提
不成立就整條劃掉並寫明理由。

規則與 `docs/backlog.md` 相同：**每一條都要有出處**（`檔案:行號`、或一句可以
重跑的 `grep`），否則下一個人無從判斷它還成不成立。沒有出處的條目視為過期。

最後更新：2026-09-15（**戰役砍成每陣營三關、共 9 關，九關改版換上五張新卡**；
陸上砲位還手、照明彈與探照燈、兩座機場地形、滑行與滾行起飛、戰果通報、進場
橫幅、機庫、機種徽章、AI 防墜 Worker 與對地掃射航次；spec
`docs/superpowers/specs/2026-09-13-campaign-rework-design.md`）

前一版：2026-09-08（**盟 M2 上線，改題為梅澤堡–洛伊納**；地面目標實體
與炸毀規則；任務專用地形 `leuna` 與晚秋色盤；spec
`docs/superpowers/specs/2026-09-08-allies-m2-leuna-design.md`）

前一版：2026-09-04（**選單重做**：簡報資料夾風格、任務線改成 陣營 → 簡報、
遭遇戰改成分隊編組；spec `docs/superpowers/specs/2026-09-04-ui-1944-design.md`）

前一版：2026-09-03（三條戰役上線，12 關取代舊的 10 張卡，5 關可玩；
里程碑 1 與 3 完成；日本三架全部進遊戲）

前一版：2026-09-01（德軍 M2 定案東線；都市地形不做；日本線定案 Ki-84 +
M3 護航／M4 反艦；增援預警要做、音效排最後）

---

## 目標

三條 Campaign（盟軍／德軍／日本）各 3 關，共 9 關，**九關全部可玩**
（`test/unit/campaigns.test.ts:20`「三條線各 3 關」；三個卡片檔裡沒有
`battle: null`：`grep -n "battle: null" src/battle/missions/*.ts` → 零筆）。

~~各 4 關、共 12 關~~ —— 2026-09-10 砍掉盟 M3、德 M3、日 M2 三張目錄卡
（commit `10588f7`；spec `2026-09-10-germany-m2-poltava-design.md` §1 第 6 條）。

飛機池九台（`src/battle/skirmish.ts:114` 的 `ALL_SPECS`）：

```
             戰鬥機              轟炸／攻擊機      第三架
  盟軍       P-51D  ✅           B-17G  ✅        F6F-5  ✅   ＋ F4F-4 ✅（只當敵機）
  德軍       Bf 109 K-4 ✅       He 111 ✅        Bf 109（同機）
  日本       A6M5   ✅           G4M    ✅        Ki-84 疾風 ✅
```

**F4F-4 沒有玩家座位**，在日 M1、日 M2 當敵機（spec `2026-09-13-campaign-rework-design.md`
§2 第 8 條；`src/battle/missions/japan.ts:54`、`:98`）。GLB 在 commit `1be868a`。

**日本第三架是 Ki-84，不是 B6N**（2026-09-01 裁定，理由見末段「已裁定」）。

9 關的內容見本檔末的對照表。

---

## 現況盤點（已經有的，不要重做）

```
  ✅  九種飛機、逐部位命中盒與防護力、史實性能校準     src/battle/skirmish.ts:114
  ✅  砲塔（He 111 / B-17G / G4M），AI 驅動 —— 玩家開轟炸機時不必再做
  ✅  七條任務規則：annihilate / evacuate / convoy（可帶 need）/ hunt / sink /
                    destroy / defend                    src/battle/mission.ts:23
                    evacuate 目前沒有卡片用（grep "type: '撤離'" src/battle/missions → 零筆）
  ✅  節拍：reinforce / withdraw / recycle / flare / conveyor   src/battle/beats.ts:142
      條件：clock / alive / batch / ground                       src/battle/beats.ts:29
  ✅  進場擺法：headOn / pursuit / bounce               src/battle/entry.ts:67、:123、:138
  ✅  地形：sea / archipelago / farmland / autumnFarmland / leuna / poltava / asch
                                                        src/world/terrainKind.ts:21
  ✅  時段：dawn / noon / dusk / night / novemberNoon   src/world/timeOfDay.ts:15
  ✅  海陸環境：ocean、island、terrain、farmGround、fields、flora、vegetation
  ✅  特效：fireball、debris、smoke、splash、sparks、wrecks
  ✅  目標圈 objectiveRing、目標距離 HUD src/hud/widgets/objective.ts
  ✅  畫面：landing / menu / campaign / mission / skirmish / battle / hangar
                                                        src/ui/screens.ts:10
  ✅  World 的成長路徑：cull.ensure、killEvents 重建、damageTime 重配
                        src/world/cull.ts:48、src/world/World.ts:297
```

---

## ⚑ 需要專案負責人的（清單裡以 ⚑ 標出）

分成三類。**第一類是硬阻塞**——沒有它我做不下去；後兩類我可以先量、先做，
但值與判斷是你的。

### 一、⚑ 要放進 `ref/` 的參考模型 —— **總共 5 個，全部到位**

現有的 `ref/*.glb` 都是你提供的（`bf109e.ts` 檔頭：「專案負責人提供的參考
模型是 E-4」）。

- [x] ⚑ ~~**G4M 一式陸攻**~~ —— 參考模型已提供，外型已完成（2026-09-03）
- [x] ⚑ ~~**A6M5 零戰**~~ —— 同上
- [x] ⚑ ~~**Ki-84 疾風**~~ —— 同上
- [x] ⚑ ~~**美軍航空母艦**~~ —— `ref/uss_essex_cv-9.glb` → `public/models/essex.glb`
      （commit `360df0d`，2026-09-03）
- [x] ⚑ ~~**美軍驅逐艦**~~ —— `ref/uss_fletcher.glb` → `public/models/fletcher.glb`
      （commit `0104bfa`，2026-09-03）

清單外另有兩個也到位了：重巡 `ref/uss_wichita_wows.glb` → `wichita.glb`
（commit `fcc637b`）、F4F-4 `ref/f4f4-ref.glb` → `f4f4.glb`（commit `1be868a`）。

**其餘地面目標我自己程序化生成，不必你找**（2026-09-01 裁定乙案）：
Flak 砲位、火車頭與車廂、卡車、戰車、~~登陸艇~~、工廠、調車場、機場。
（登陸艇只服務日 M2 讀谷灘頭，那一關已被砍，見里程碑 2.2。）

> 找模型的要求與現有的 `ref/` 一致：**比例可信比面數低重要**。外型我會照
> `aircraft-from-reference` 那套流程重做成低多邊形，參考模型只當量尺用。
> 飛機最好查得到全長與翼展，才對得上史實尺寸並交叉驗證（技能坑 21）。

### 二、⚑ 裁決：值與判準（我量得出來，值是你定的）

- [x] ~~地面目標用參考模型還是程序化生成~~ —— **乙案**（2026-09-01 裁定）：
      艦船用參考模型（輪廓辨識度高、是兩關的主角），其餘程序化
- [x] ~~⚑ **新機種的血量與防護力**~~ —— 三架日本機 2026-09-03 裁定：
      血量四捨五入到百位（800 / 600 / 2,800），防護力的下限由 0.7 降到 0.60
- [ ] ⚑ **護欄門檻與平衡值** —— 「護欄重新定值是專案負責人的決定」。
      已動過一次：`specs.test.ts` 的防護力下限 0.7 → 0.60
      （2026-09-03 裁定，負責人已覆核）
- [x] ~~⚑ **三台轟炸機的失速同方向偏高 5–7%**~~ —— **接受，不修**
      （2026-09-03：「飛起來 OK，記錄起來不再問」）。線索記在
      `docs/backlog.md` §1.2，不是待辦
- [x] ~~⚑ **三台日本機飛起來對不對**~~ —— 2026-09-03 試飛通過
- [ ] ⚑ **增援預警提前幾秒** —— 手感問題，只能試飛。現值 0～6 秒，逐張卡寫在
      `warnLead`（例：`src/battle/missions/allies.ts:45`、`:192`）
- [ ] ⚑ **要不要做 Bf 109 E-4 spec** —— 仍未裁定（`ls src/specs/` 沒有 E-4）
- [ ] ⚑ **史實資料表衝突時信哪一份** —— He 111 的質量就是這樣裁的
      （12,500 → 13,727）
- [ ] ⚑ **`altitudeSpread` 要不要逐卡覆寫**（盟 M1 想把護航機拉到箱子上方
      1,000 m）—— spec `2026-09-13-campaign-rework-design.md` §12 記為未定

### 三、⚑ 試飛：只有你判斷得了的

「玩起來合不合理」不是我量得出來的東西。**每一關做完都要一次。**

- [ ] ⚑ 新關卡的節奏、難度、第二波來得太早或太晚 —— 九關改版的起始值清單在
      spec `2026-09-13-campaign-rework-design.md` §10
- [ ] ⚑ 盟 M1 的 `convoyPriority` 3 要重新掃描（`src/battle/missions/allies.ts:30`：
      `docs/backlog.md` §1.3 量的是 4 架轟炸機，16 架箱型的砲塔數是那時的四倍）
- [ ] ⚑ 新機種飛起來對不對
- [x] ~~⚑ AI 防墜與對地掃射在德 M3 的體感~~ —— 玩家試飛確認可定案
      （`docs/ai-ground-collision-recovery.md` §9.5）

---

## 里程碑 1 —— 觸發器與中途加入　✅ **2026-09-03 完成**

**解鎖：德 M1、德 M3、盟 M1、盟 M3、日 M2 的骨架（5 關）**

機制全部到位，而且遊戲裡真的走得到：**帝國防空巡邏**是第一張有第二波的卡。
剩下的是那五關的**卡片內容**（文案、編制、數值），不是機制。

### 1.1 中途加入戰場

**做法是預配到最終容量，不是中途成長。**`World.add` 的擴容路徑會把
`killEvents` 換成空的、把 `damageTime` 整張抹掉（`World.ts:295` 的註解自己
寫著前提：「add 只發生在場景組裝期，那時還沒有任何傷害」）。`FlightIndex`
更是根本長不大。所以容量在建構期就配到最終架數，中途一個 ensure 都不觸發。

- [x] `TargetBoard` 收 `capacity` —— 三個 typed array 照最終架數配
- [x] `FlightIndex` 收 `capacity` 與 `teams` —— 建構期就把增援的分隊建好，
      roster 指向還不存在的座位，`compactFlights` 在它們出現時自己填上
- [x] battle 層：`commandUnits`、`blue`/`red`、`spawnOrientations`、`roster`、
      以及 `stepCommandLayer` 用的四份分隊索引清單
- [x] `main.ts` **只附加**新的 visual（`syncVisuals`）。不能用
      `rebuildVisuals` —— `attachVisual` 不冪等，而那一支會先把全場還回去
- [x] 既有 10 張卡逐位元不變 —— 兩份重播校驗和證實

> `setDecisionPhase` **不是**障礙。它只是一次性設定自己的 `decisionTimer`
> 起點（`src/ai/AiController.ts:907`），中途加人不會擾動別人的相位。

### 1.2 觸發器：條件 × 效果

兩個軸要分開。德 M3 的節拍是「友軍剩不多 → 任務改成 返航」——
同一套條件判斷，接的卻不是增援。

**沒有做成「條件 × 效果」的矩陣。**交叉出來的組合大半沒有合法語意
（「時鐘到了把 convoy 規則換成任意其他規則」）。實際需求幾類，就寫幾個
具名節拍（`src/battle/beats.ts:142`）。

**條件**

- [x] 時鐘 —— 第 N 秒
- [x] 存活數 + **選擇器** —— 「紅隊的**戰鬥機**剩 ≤ 2 架」
      選擇器一開始就要有：盟 M3 是「打退戰鬥機之後魚雷機才來」，
      不是「紅隊剩幾架」。之後補會很痛
- [x] 重生批數 `batch`（`beats.ts:54`）—— 盟 M3 沖繩外海的陸攻掛在第五批
      （`src/battle/missions/allies.ts:191`，commit `7c4ae4c`）
- [x] 地面戰果 `ground`（`beats.ts:65`）—— 敵方地面目標被摧毀數不到門檻才成立，
      二元（spec `2026-09-13-campaign-rework-design.md` §7.6）
- [ ] ~~位置~~ —— 等里程碑 2，現在沒有東西可以指
- [ ] ~~事件~~ —— 同上

**效果**

- [x] 增援登場 —— 先預警，過 `warnLead` 秒才真的進場
- [x] 任務目標變更（`annihilate` → `evacuate`），目標文字一起換。**目前沒有卡片
      用返航**（`grep -n "withdraw:" src/battle/missions/*.ts` → 零筆）
- [x] 通報訊息 —— 畫面中心單一訊息槽，後來者覆蓋（`hud/widgets/message.ts`）
- [x] 整隊重生 `recycle`（`beats.ts:99`）—— 被殲滅的小隊整隊回來，席位回收
- [x] 照明彈 `flare`（`beats.ts:125`）—— 德 M2（`src/battle/missions/germany.ts:109`）
- [x] 轟炸機流 `conveyor`（`beats.ts:139`）—— 抵達終點的 transit 從進場點重新
      進場，德 M1 用（`germany.ts:39`）
- [x] 從地面起飛的增援 —— 波次帶 `takeoff`／`departs`，那一批地上剩幾架就上幾架、
      一架都不剩就不來（`germany.ts:140`；`src/battle/setup.ts:1285`、`:1473`）

**其他**

- [x] 時鐘當兜底：每一個「存活數」觸發都要有一個時限，否則玩家太慢／太快
      時第二波永遠不出現（`byLatest`，**必填**）
- [x] 有波次的關卡按「重新開始」→ 整個 `Battle` 重建，不截斷
      （專案負責人 2026-09-01 裁定）
- [x] 任務卡上怎麼描述波次（`MissionBattle.waves`）—— 卡片**直接指名機種**
      （`spec`）。第一版寫成「敵方的戰鬥機」那種相對描述，三條戰役上線時
      改掉了：相對寫法表達不出**第三架**飛機，而日本線有兩台戰鬥機。
      `side` 留著 —— 它決定隊伍，不決定機種
- [x] 預警文字寫成無線電通報、不寫批數（commit `eed8615`；例
      `allies.ts:181`「雷達發現更多零戰」）

---

## 里程碑 2 —— 非飛機目標與投放武器

**需要這一層的關全部上線**：盟 M2 梅澤堡的油廠、盟 M3 沖繩外海、德 M2 波爾塔瓦
之夜、德 M3 底板行動、日 M1 瓜達康納爾上空、日 M2 倫內爾島。

~~還剩 4 關：盟 M3 諾曼第斷軌、德 M2 庫班的鐵路、德 M3 奧博揚公路、日 M2 讀谷
灘頭~~ —— 三張被砍（commit `10588f7`）；德 M2 題目換成波爾塔瓦之夜（不補蘇軍
陣營，spec `2026-09-10-germany-m2-poltava-design.md` §1），commit `a841121` 上線。

### 2.1 可被攻擊的非飛機實體

- [x] 船：`src/world/ships.ts`（不是 `Combatant`）
- [x] 地面目標：`src/world/groundTargets.ts` —— 戰車、卡車、砲位、火車、
      油廠構件、停放的 B-17／P-51、油桶堆、探照燈共用一個實體；子彈（口徑門檻）、
      炸彈（範圍傷害、擋路）、擊毀事件
- [x] AI 認得它：轟炸機的攻擊航路吃 `StrikeTarget` 視圖
      （`src/world/strikeTarget.ts`），船與地面目標都滿足它
- [x] 勝負判定認得它（見 2.4）
- [x] 砲位還手 —— 陸上輕型防空砲走直射彈、有曳光（commit `8475f4a`，
      `src/world/shipGuns.ts:204`）；重砲 88 mm Flak 18（commit `a8dc91e`），
      逐關複寫射速與引爆尺度（`allies.ts:112`、`germany.ts:102`）
- [x] AI 對地掃射航次 —— 動態離場／再進場、防墜釋放閘門只作用於對地掃射
      （commit `e3bd6f5`，`docs/ai-ground-collision-recovery.md` §9.2）；德 M3 指定
      停放與滑行中的 P-51 為優先目標（`germany.ts:135`，commit `a436efc`）

### 2.2 實體清單

- [x] Flak 陣地的外型（`public/models/flak18.glb`、`flak38.glb`）—— 會還手（見 2.1）
- [x] 航空母艦、驅逐艦、重巡（盟 M3、日 M1、日 M2）
- [x] 油廠的六種構件 —— 盟 M2（`src/render/geometry/ground/plant.ts`）。
      **是一片廠區的構件，不是一片城市**
- [x] 停放的 B-17 —— 德 M2（`src/world/groundTargets.ts:55`，低模
      `public/models/b17g_lod2.glb`）
- [x] 停放的 P-51 —— 德 M3（`groundTargets.ts:61`，佈局 `src/world/asch.ts:95`）
- [x] 油桶堆 `fuelDump`、彈藥堆 `bombDump` —— 德 M2 兩堆油桶一堆彈藥
      （`src/world/poltava.ts:152`）、德 M3 兩堆油桶（`germany.ts:14`）
      （`groundTargets.ts:56`、`:57`）
- [x] 探照燈 —— 德 M2（`groundTargets.ts:59`、`src/render/searchlights.ts`，
      commit `d7abb89`）
- [x] 照明彈 —— 德 M2（`src/world/flares.ts`，commit `5210a26`、`9737046`）
- [x] 機場地形 `poltava`（`src/world/poltava.ts`，commit `38ab092`；佈景
      `public/models/poltava_airfield.glb`，commit `b075a1b`）
- [x] 機場地形 `asch`（Y-29）與滑行／滾行起飛（`src/world/asch.ts:121` 的
      `taxiRoute`、`src/control/takeoffRoll.ts`；commit `7f21eff`、`ad27eeb`）
- [ ] ~~工廠／調車場的建築~~ —— 只服務德 M2 庫班的鐵路；德 M2 題目換成波爾塔瓦
- [x] 火車（車頭 + 車廂）的外型 —— ~~盟 M3 還要調車場與掃射的關卡~~（盟 M3 被砍）
- [x] 卡車／戰車的外型（`public/models/zis150.glb`、`t34.glb`）——
      ~~德 M3 還要關卡~~（德 M3 奧博揚公路被砍）
- [ ] ~~登陸艇~~ —— 只服務日 M2 讀谷灘頭，那一關被砍
- [ ] ~~機場（守備目標）~~ —— 只服務日 M2 讀谷灘頭，那一關被砍

### 2.2b 不做：都市地形（2026-09-01 裁定，之後再考慮）

**地面目標 ≠ 都市地形。**九關裡有地面目標的三關要的是「可攻擊的東西」——
一座油廠、兩座機場上的停放機與砲位——那些擺在任務專用地形上就成立
（`leuna`、`poltava`、`asch`）。

現有的「聚落」是**農村**，不是城市（`docs/backlog.md` §11）：

```
  站址   兩顆區塊種子的中點，落在 Voronoi 邊界的凹路上 —— 村子在路口
  房子   沿路排，牆 12 個三角形 + 人字屋頂 6 個
  同時可見  house 14、barn 4、church 1
```

一次看得到 14 棟房子。城市要的街廓、格狀街道、多層建築、上千棟的實例數，
與這套系統幾乎沒有交集，而且會拖到正在收尾的繪製呼叫那條線（backlog §12）。

唯一真的要城市的是「轟炸英倫」，而那一關已經改成東線。**要不要有城市地圖
應該是一個獨立決定，不是被一關綁架著做出來。**

### 2.3 武器

- [x] 掛載點與投放（`src/weapons/stores.ts`、`src/weapons/bomb.ts`）
- [x] 炸彈：自由落體、爆炸範圍傷害（`src/world/bomb.ts`、`World.applyBombBlast`）
- [x] 魚雷：入水、定深、直線航行、**航跡**、命中船
- [x] 對地掃射 —— 子彈打得到地面目標（`World.resolveHits`）
- [x] Flak：艦上的 5 吋砲（`src/world/flak.ts`、`shipGuns.ts`）與陸上砲位
- [x] 彈艙與連投（`src/weapons/bomb.ts` 的 `stepBombBay`）
- [x] 投彈瞄具（`src/camera/bombsight.ts`、`src/hud/widgets/bombsight.ts`）
- [ ] ~~掛載改變飛行性能（德 M3 的「投彈前後手感差異」是那一關的賣點）~~ ——
      德 M3 奧博揚公路被砍。現況：掛載不進飛行質量
      （`grep -rn "mass" src/physics src/weapons | grep -i "store\|load\|bomb"` → 零筆）

### 2.4 新的勝利條件

- [x] 「摧毀 N 個地面目標」（`destroy`，與 `sink` 同一個形狀；可限定單位，
      `germany.ts:138`）
- [x] 「至少 N 架被護送者抵達」—— `convoy.need`，湊不到門檻當場判敗
      （`src/battle/mission.ts:74`；盟 M1 `allies.ts:28`；commit `2d81b6b`）
- [x] 「累計擊落 N 架」（`hunt`，可限定角色；`mission.ts:88`；德 M1 `germany.ts:57`）
- [x] 「守住艦隊」（`defend`，讀要害艦；`mission.ts:153`）
- [x] 擊沉帶護衛：攻擊隊之外的藍隊戰鬥機全滅判敗（`src/battle/missions/index.ts:74`；
      日 M1）

---

## 里程碑 3 —— 日本機體　✅ **2026-09-03 完成**

**解鎖：日 M1（只要 A6M5）、日 M2（再加 G4M 與 Ki-84）** —— 兩關都已上線。
（九關改版後三架的座位：A6M5 日 M1、Ki-84 日 M2、G4M 日 M2；見附錄。）

**日 M1 與日 M2 兩關不需要里程碑 1、2、4 中的任何一個**——飛機做出來就能玩。
日 M2 的勝利條件是「G4M 飛抵投雷點」，那正好是現有 `convoy` 規則的語意
（`src/battle/mission.ts:33`），與 `allies-escort` 是同一張卡換機種。

所以這三架的優先度不低於里程碑 2：**一架飛機換一整關，而且不欠任何系統。**

- [x] ~~**A6M5**~~ —— 解鎖日 M1
- [x] ~~**G4M 一式陸攻**~~ —— 日 M2 當被護送者、日 M3 玩家駕駛、盟 M3 當敵機。
      三關都用得到。轟炸機路徑，五座砲塔
- [x] ~~**Ki-84 疾風**~~ —— 日 M2 玩家駕駛。戰鬥機路徑

**2026-09-03：三架全部進遊戲了。** 外型、spec、武裝、逐部位命中盒、防護力、
史實校準、登記表與 e2e 全部走完（設計 `docs/superpowers/specs/
2026-09-03-japanese-aircraft-specs-design.md`、計畫 `.../plans/...`）。

```
              質量 kg    hp    史實驗收        還沒守住的
  Ki-84        3,600     800   六項全綠        —
  A6M5         2,733     600   六項全綠        —
  G4M         12,500   2,800   五項全綠        失速（估算值，見下）
```

三件要記住的事：

- **Ki-84 那個 687 km/h 從來沒有人量過** —— 1946 年繳獲機報告的數據欄逐字
  照抄 1945 年的 TAIC 估算表，同一份報告第 11 頁寫著「Performance — None
  obtained」。改用日方三次試飛的平均 630 km/h（負責人 2026-09-03 裁決）。
- **防護力的下限為 A6M5 由 0.7 降到 0.60**（負責人裁決）。TAIC Report No. 38
  逐字：「no protective armor plate, and no provision for leak proofing」。
- **G4M 二四型不是「一式ライター」** —— 主翼油箱除最外側兩槽外全部外覆
  28 mm 防護墊，上方銃塔有 10 mm 裝甲。常被引用的駕駛席鋼板屬於二四型丁。

每一架共同要走的：

- [x] ⚑ ~~**找到可信的參考模型**~~ —— 三架都到位了
- [x] ~~外型~~ —— 三架都走完 `aircraft-from-reference`（2026-09-03）：
      `a6m5.glb`／`g4m.glb`／`ki84.glb` 與各自的 `*.model.ts`
- [x] **進登記表** —— `GLB_MODELS`（`src/render/geometry/buildAircraft.ts:98`）、
      `BODY_COLORS`（`buildAircraft.ts:193`）、`ALL_SPECS`（`src/battle/skirmish.ts:114`）
- [x] 逐部位命中盒（`src/specs/ki84.ts:314`、`src/specs/g4m.ts:270`，由
      `test/tools/hitbox-emit.probe.ts` 產生）
- [x] 防護力與血量（`src/specs/ki84.ts:276` 等，值見上表）
- [x] 史實表與氣動係數校準（上表的史實驗收）
- [x] 武器配置（`src/weapons/ki84.ts`、`a6m5.ts`、`g4m.ts`；G4M 砲塔
      `src/weapons/g4m.ts:3`）
- [x] ~~`feel.ts` 的手感輪廓要不要另開一組~~ —— 沒有另開：`feelFor` 只依
      `role` 分戰鬥機與轟炸機兩組（`src/specs/feel.ts:409`）

---

## 里程碑 4 —— 玩家開轟炸機　✅ **三關都上線**

**盟 M2（B-17G）、德 M2（He 111）、日 M2（G4M）都是玩家開轟炸機。** 玩家是
`combat` 小隊的長機，砲塔本來就是 AI 驅動。

- [x] `player` 旗標掛在 `duty: 'combat'` 的小隊長機上 —— 轟炸機分層擺位也一樣
      （`src/battle/order.ts:202` 的 `stackedEntry`；盟 M2 `allies.ts:91`、德 M2
      `germany.ts:85`）
- [x] `transit` 不必動 —— 玩家那一隊是 `combat`、走攻擊航路（`ai/strikeRun.ts`），
      不經 `transit`（`src/ai/AiController.ts:661` 的語意維持原樣）
- [x] 護送任務的判定沒有被牽動 —— `transit` 只剩被護送的轟炸機與德 M1 的轟炸機流
      （`src/battle/missions/index.ts:171`、`:201`）

> 砲塔已經是 AI 驅動，所以「玩家不能操作機槍、AI 自動防禦」這個設定
> **不必開發**，它是現況。

---

## 里程碑 5 —— 呈現層

### 5.1 通報訊息

**增援一律先給預警，位置在畫面中心**（2026-09-01 裁定）。

- [x] 畫面中心的文字提示 —— `src/hud/widgets/message.ts`，畫面高 0.30 那一帶，
      打字機逐字印出（commit `2aecbed`）
- [x] 顯示時長、淡入淡出、多則訊息連續進來時怎麼排隊 —— 由 `main.ts` 依物理時間
      決定、不做淡入淡出（`message.ts:25`）；後來者覆蓋（`src/hud/types.ts:422`）
- [x] 進場橫幅 —— 任務目標在畫面中央打字機印出、停 3 秒再滑進右上角目標列；
      卡片的 `banner` 欄位（commit `2aecbed`、`ebf049e`；`src/hud/widgets/objective.ts:121`）
- [x] 戰果通報 —— 玩家打爆東西時堆疊一行字、舊的往下推並淡出
      （commit `d1aeb49`；`src/hud/widgets/battleReport.ts:29`）

### 5.2 音效 —— **整個專案的最後一項**（2026-09-01 裁定）

`src/audio` 不存在，整個專案沒有音訊系統（`ls src/audio` → 不存在）。
**所有其他項目做完之前不碰。**

- [ ] 是否要做、做到什麼程度 —— 等其餘全部收尾之後再談

### 5.3 選單與機庫

- [x] 機庫 —— 左邊機種卷宗、右邊那一架飛在海上（commit `79dc162`；
      `src/ui/dossier.ts`、`src/app/showcase.ts`、`src/ui/screens.ts:10` 的 `hangar`）
- [x] 機種徽章 —— 九台 GLB 的正交側影配國籍標誌，用在簡報編組列、編組頁與機庫
      （commit `3570b5e`；`public/ui/sil/*.png`）

### 5.4 AI 防墜

- [x] 單一 Web Worker 以正式飛行物理預演改出掉高，4 Hz 排程；Worker 失敗時阻擋
      遊戲並顯示錯誤（commit `8f7d1e1`、`e3bd6f5`；`docs/ai-ground-collision-recovery.md`
      §9.1）
- [x] 移除 500 m 空戰高度限制（commit `582a194`；同文件 §9.2）

---

## 里程碑 6 —— 戰役外框

> 三架日本機體移到**里程碑 3**——它們解鎖的兩關不欠任何系統，排在最後是錯的。
> ~~B6N 天山~~ **不做**（2026-09-01 裁定）：它會讓日 M2 與日 M3 變成兩關魚雷
> 攻擊；那個位置改給 Ki-84，日本線四關才有四個動詞。

- [ ] Bf 109G —— 可用 K-4 換皮（機鼻、座艙、材質、飛行參數），成本最低
      （`ls src/specs/` 沒有 109G）
- [ ] 戰役進度／解鎖／存檔
      —— `grep -rln "localStorage" src/` → **零個檔案**
- [ ] 難度曲線對到既有旋鈕（`aiProfile` 的 ACE / VETERAN、編制、幾何）
      —— 九張卡一律 `VETERAN`（`src/battle/missions/index.ts:226`）。
      **星等已經移除**（2026-09-03 裁定）：關卡內容差太多，一個 1~5 的
      數字沒有客觀意義

---

## 待裁定（不是開發項目）

- [x] ~~**年代衝突**~~ —— **德軍 M2 是東線鐵路樞紐轟炸，不是轟炸英倫**
      （2026-09-01 裁定）。

      repo 裡的 He 111 是 **H-6**，1942 年才出來、主要在東線／地中海／反艦，
      不列顛空戰飛的是 H-2 / H-3。所以問題不是「He 111 太老」，是「轟炸英倫
      這個場景對這台飛機太新」。

      改成東線之後每一架都落在它對的年份，德軍線變成
      **1942 東線 → 1945 本土防空**，年代從問題變成敘事弧線
      （「從獵人變成獵物」正是規劃想講的）。零成本，只改場景文案。

      被這個決定一起否掉的兩條：
      - 做 Spitfire 來打 1940 的英倫 —— 全新機體，只服務一關
      - 都市地形 —— 見里程碑 2 的「不做」那一段

      之後：德 M2 仍在東線，題目由庫班的鐵路換成波爾塔瓦之夜（1944 年 6 月，
      spec `2026-09-10-germany-m2-poltava-design.md` §1）；德軍線現為
      1944/6 波爾塔瓦 → 1944/11 梅澤堡 → 1945/1 底板行動（`germany.ts:34`、`:78`、`:115`）。

- [ ] **要不要做 Bf 109 E-4 spec** —— 與年代**無關**，這兩件事一直被綁在
      一起談但沒有關係。

      遊戲裡的 109 已經是「**E-4 外型 + K-4 性能**」（`bf109k4.model.ts` 檔頭，
      2026-08-25 裁定），所以做 E-4 spec 買到的不是年代正確，是
      **德軍線的機體成長感（E → G → K）**。

      成本：**外型與命中盒 0**（同一具機身），只要一輪氣動校準。
      沒有建模、不動外型測試。要不要做取決於「德軍線需不需要性能升級感」。

- [x] ~~**日本第三架**~~ —— **Ki-84 疾風，而且日本線改成 M3 護航 / M4 反艦**
      （2026-09-01 裁定）。

      **判準：跨戰線重複沒關係，同一條線內不能重複。**

      日本線本來缺「轟炸機航線」那一關——盟軍 M1 是護送 B-17、德軍 M1 是攔截
      B-17，同一件事的兩面，日本一關都沒有。原規劃的「本土防空」是在試圖填
      這個缺口卻沒有轟炸機可攔，所以怎麼配對手都彆扭：

      ```
        Ki-84 vs F6F      守機場打艦載機  →  與日 M2 撞
        Ki-84 vs 轟炸機   要 B-29         →  第四架新飛機
      ```

      改填**護航**那一面就不必加飛機：

      ```
        日 M2  護航       Ki-84   護送 G4M 攻擊艦隊，玩家當護衛
        日 M3  倫內爾島    G4M     反艦（玩家開轟炸機）—— 規劃原本的終章
      ```

      **B-29 與「高空攔截」一併否決。**支撐它的理由是「高度是沒人用過的
      玩法軸」，而實測推翻了：出貨的 Bf 109 K-4 在 9,500 m 極速 737 km/h
      （比 4,000 m 的 662 還快）、爬升率 30.7 m/s、升限 16,241 m。手感層
      （`GAME_FEEL` 的 power ×1.572、cd0 ×1.636、mass ×0.8）已經把高度懲罰
      抹掉了。要拿回那個體驗得動手感層的高度行為，那會影響全部五架飛機與
      全部既有護欄——是一個獨立決定，不該被一關拖著走。

      之後：九關改版（負責人 2026-09-13 裁定，spec
      `2026-09-13-campaign-rework-design.md` §2）把 Ki-84 那一關換成漢口上空的
      殲滅戰、護航改由日 M1 瓜達康納爾（A6M5 掩護 G4M）承擔；德 M1 也不再與
      盟 M1 互為護送／攔截的鏡像。
- [x] ~~**增援預警**~~ —— **要做，畫面中心的文字提示**（2026-09-01 裁定）。
      見 5.1
- [x] ~~**音效**~~ —— **排到最後**（2026-09-01 裁定）。見 5.2

---

## 附錄：9 關的現況

**卡片在 `src/battle/missions/{allies,germany,japan}.ts`**，由
`src/battle/missions/index.ts:33` 的 `MISSIONS` 組成一張表。

**編號**：選單印的是「第 N 關」，N 是那張卡在陣營清單裡的順序
（`src/ui/menu.ts:308`）。本文件的「盟 M3」「德 M3」「日 M2」等指的就是這個
順序，**不是卡片 id** —— 砍掉三張後 id 沒有重編（spec
`2026-09-13-campaign-rework-design.md` §3）。

| 關 | id | 標題 | 類型 | 我方（玩家機） | 敵方 | 被護送／攻擊隊 | 地形・時段・高度 | 勝利條件 | 節拍 | 出處 |
|---|---|---|---|---|---|---|---|---|---|---|
| 盟 M1 | `allies-m1` | 柏林上空 | 護航 | P-51D ×4 | Bf 109 K-4 ×10 | B-17G ×16，三中隊箱型 | farmland | `convoy`，8 架抵達 | 60 s 後方 Bf 109 ×4、110 s 側上方 ×4（5,000 m）；開場那批重生 3 批 | `allies.ts:15` |
| 盟 M2 | `allies-m2` | 梅澤堡的油廠 | 打擊 | B-17G ×12，分層 | Bf 109 K-4 ×4 正面 | — | leuna・novemberNoon・1,500 m | `destroy` 6（廠區 12 構件＋48 砲位；重砲 30 發/分） | 90 s 後方 Bf 109 ×4 | `allies.ts:70` |
| 盟 M3 | `allies-m3` | 沖繩外海 | 殲滅 | F6F-5 ×4 | A6M5 ×16 分兩路；G4M ×4 | — | sea・TF58（Essex 要害＋Wichita ×2＋Fletcher ×6）・2,000 m | `defend` | 零戰整隊重生 6 批；第 5 批時 G4M ×4（1,000 m） | `allies.ts:128`、`shared.ts:126` |
| 德 M1 | `germany-m1` | 梅澤堡上空 | 攔截 | Bf 109 K-4 ×8 | P-51D（只由波次給） | 敵方 B-17G ×8 轟炸機流 | autumnFarmland・novemberNoon | `hunt` 6，只算轟炸機 | 0 s P-51 ×4、60 s P-51 ×4；轟炸機流不斷（conveyor） | `germany.ts:32` |
| 德 M2 | `germany-m2` | 波爾塔瓦之夜 | 打擊 | He 111 ×8，分層 | 沒有敵機 | — | poltava・night・1,500 m | `destroy` 12（24 架停放 B-17、3 堆、16 輕砲、6 重砲、6 探照燈） | 80 s 照明彈 | `germany.ts:76`、`campaigns.test.ts:123` |
| 德 M3 | `germany-m3` | 底板行動 | 打擊 | Bf 109 K-4 ×8 | P-51D，全部從停機線滑出起飛 | — | asch・dawn・500 m | `destroy` 8 架停放的 P-51（油桶堆與輕砲不算） | 0／45／90 s 各一個小隊滑行起飛，地上剩幾架上幾架 | `germany.ts:113` |
| 日 M1 | `japan-m1` | 瓜達康納爾上空 | 護航 | A6M5 ×12 | F4F-4 ×8 | 我方 G4M ×8 攻擊隊（`strike`） | archipelago・Wichita ×2＋Fletcher ×6（敵方）・1,000 m | `sink` 3；零戰全滅判敗 | F4F 重生 3 批 | `japan.ts:46`、`japan.ts:27` |
| 日 M2 | `japan-m2` | 漢口上空 | 殲滅 | Ki-84 ×8 | P-51D ×10，高 1,000 m（`bounce`） | — | farmland | `annihilate` | 無（刻意） | `japan.ts:75` |
| 日 M2 | `japan-m3` | 倫內爾島 | 打擊 | G4M ×11 | F4F-4 ×8 | — | sea・dusk・Wichita ×4＋Fletcher ×4・1,000 m | `sink` 4 | 無 | `japan.ts:90`、`shared.ts:146` |

**九關改版換掉的五張**（spec `2026-09-13-campaign-rework-design.md` §1）：盟 M1、
德 M1、德 M3、日 M1、日 M2；commit `774bf1e`、`7f21eff`、`15e25a8`、`534d109`、
`ad27eeb`、`2ead2b8`、`aec79f8`。**不動的四張**：盟 M2、盟 M3、德 M2、日 M2。

**被砍掉的三關**（commit `10588f7`，每陣營砍成三關；三張都是 `battle: null` 的目錄卡）：

- ~~盟 M3 諾曼第斷軌（P-51D 掃射機車與調車場）~~ —— 被砍
- ~~德 M3 奧博揚公路（掛彈的 Bf 109 G 打戰車）~~ —— 被砍
- ~~日 M2 讀谷灘頭（A6M5 攔截 F6F 再掃射登陸艇）~~ —— 被砍

隨之失去目的的待辦：登陸艇、日 M2 的機場守備（2.2）；德 M3 的掛彈手感（2.3）；
調車場與掃射關（2.2 火車那一條）；卡車／戰車的關卡（2.2）。

> ⚑ **九關的數字全部是起始值，待試飛。** 清單在 spec
> `2026-09-13-campaign-rework-design.md` §10，逐張卡的註解也都標著「起始值，
> 由試飛裁定」。
> ~~德 M3：返航條件「我方剩 ≤4 架或最遲 40 秒」、撤離點 12 km、時限 158 秒、
> 兩批各 4 架~~ —— 帝國最後防線那張卡換成底板行動（commit `7f21eff`），
> 現在沒有卡片用返航。

### 日本線三關（2026-09-13 定案）

```
  M1  掩護雷擊隊    A6M5    擋住 F4F，擊沉由陸攻達成         japan.ts:46
  M2  戰鬥機對決    Ki-84   把高空俯衝下來的 P-51 拖進纏鬥   japan.ts:75
  M3  反艦           G4M     黃昏低空雷擊                     japan.ts:90
```

~~2026-09-01 的「四關四個動詞」~~ —— M2 守備＋對地（讀谷灘頭）被砍；M3 由
「Ki-84 護送 G4M 到投雷點」換成漢口上空的殲滅戰（負責人 2026-09-13 裁定，
spec `2026-09-13-campaign-rework-design.md` §2 第 3、7 條）。

### 共用資產

- 盟 M2 與德 M1 是同一場（1944 年 11 月，梅澤堡–洛伊納）的兩個座位，但德 M1 的
  地形是晚秋的內陸、地上沒有廠區（`germany.ts:43`，commit `aec79f8`）。
- 盟 M3、日 M1、日 M2 共用 Essex／Fletcher／Wichita 三個艦級，但三份艦隊各自
  一份（`shared.ts:126` 的 `TF58_GROUP`、`shared.ts:146` 的 `RENNELL_FLEET`、
  `japan.ts:27` 的 `GUADALCANAL_FLEET`）。
- 德 M2 與德 M3 都是機場，佈局各自一份、不共用地圖（`world/poltava.ts`、
  `world/asch.ts`；spec `2026-09-13-campaign-rework-design.md` §3）。
