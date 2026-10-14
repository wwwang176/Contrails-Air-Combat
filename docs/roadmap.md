# 任務關卡的開發順序

**這是一份活的清單。** 做完一條就打勾並註明在哪一輪收尾；發現某一條的前提
不成立就整條劃掉並寫明理由。

規則與 `docs/backlog.md` 相同：**每一條都要有出處**（`檔案:行號`、或一句可以
重跑的 `grep`），否則下一個人無從判斷它還成不成立。沒有出處的條目視為過期。

最後更新：2026-10-14（**德 M4 勒熱夫上線，三條線共 10 關**；Ju 87 進飛機池、
Yak-1B 當任務專用敵機；日 M2 換上美軍車輛、LST 與雷雨；**音效全面上線**（引擎、
槍砲、地面車輛、雷聲、選單音樂）；十張卡全部有開場導覽；設定頁、中英雙語、
選單背景短片、按住 V 望遠、手機觸控與全螢幕；新的節拍 depart／retarget／mopUp
與日 M3 的警戒機制）

前一版：2026-09-15（**戰役砍成每陣營三關、共 9 關，九關改版換上五張新卡**；
陸上砲位還手、照明彈與探照燈、兩座機場地形、滑行與滾行起飛、戰果通報、進場
橫幅、機庫、機種徽章、AI 防墜 Worker 與對地掃射航次；spec
`docs/superpowers/specs/2026-09-13-campaign-rework-design.md`）

前一版：2026-09-08（**盟 M2 上線，改題為梅澤堡–洛伊納**；spec
`docs/superpowers/specs/2026-09-08-allies-m2-leuna-design.md`）

前一版：2026-09-04（**選單重做**；spec `docs/superpowers/specs/2026-09-04-ui-1944-design.md`）

前一版：2026-09-03（三條戰役上線；里程碑 1 與 3 完成；日本三架全部進遊戲）

前一版：2026-09-01（德軍 M2 定案東線；都市地形不做；日本線定案 Ki-84）

---

## 編號約定

本文件的「盟 M3」「德 M4」「日 M2」等**指的是卡片 id**（`allies-m3`、
`germany-m4`、`japan-m2`），與 commit 訊息、討論的用法一致。

**德軍線的選單順序與 id 不一致**：選單的「第 N 關」是陣列位置 + 1
（`src/ui/menuCampaign.ts:96`），而德軍陣列把 `germany-m4` 排在第二
（`src/battle/missions/germany.ts:83-85` 的註解）：

```
  選單   第 1 關       第 2 關        第 3 關         第 4 關
  id     germany-m1    germany-m4     germany-m2      germany-m3
  題目   梅澤堡上空    勒熱夫         波爾塔瓦之夜    底板行動
  年代   1944/11       1942/11        1944/6          1945/1
```

盟軍、日本兩條線的選單順序與 id 相同。

---

## 目標

三條 Campaign（盟軍／德軍／日本），**共 10 關，全部可玩**：盟軍 3、德軍 4、
日本 3（`src/battle/missions/index.ts:13` 的 `MISSIONS`；三個卡片檔裡沒有
`battle: null`：`grep -n "battle: null" src/battle/missions/*.ts` → 零筆）。

**關數不由測試鎖**（`test/unit/campaigns.test.ts:17`「每一條線幾張不由測試鎖：
加一關是討論過才加的」；`:30` 只要求每條線至少一關）。加關是討論過才加。

~~各 4 關、共 12 關~~ → 2026-09-10 砍成每陣營 3 關、共 9 關（commit `10588f7`）
→ 2026-10-01 拔掉三關上限，德 M4 上線（spec `2026-10-03-germany-m4-rzhev-winter-design.md`）。

飛機池十台（`src/specs/catalog.ts:22` 的 `ALL_SPECS`；`src/battle/skirmish.ts`
只是轉匯出）：

```
             戰鬥機              轟炸／攻擊機             其他
  盟軍       P-51D  ✅           B-17G  ✅               F6F-5 ✅   F4F-4 ✅（任務裡只當敵機）
  德軍       Bf 109 K-4 ✅       He 111 ✅  Ju 87 ✅
  日本       A6M5   ✅           G4M    ✅               Ki-84 ✅
  任務專用   Yak-1B（不在 ALL_SPECS，只在德 M4 當敵機）
```

- **F4F-4** 在任務裡只當敵機（日 M1、日 M3：`src/battle/missions/japan.ts:88`、
  `:315`），但在 `ALL_SPECS` 與機庫順序裡（`src/ui/dossier.ts:84`），遭遇戰可以開
- **Yak-1B**（`src/specs/yak1b.ts:30`）是任務專用：遭遇戰與機庫都選不到
  （`src/ui/dossier.ts:69` 的 `MISSION_ONLY_SIDE`）
- **Ju 87** 是德 M4 的玩家機（`src/battle/missions/germany.ts:168`，commit `29e3766a`）

**日本第三架是 Ki-84，不是 B6N**（2026-09-01 裁定，理由見末段「已裁定」）。

10 關的內容見本檔末的對照表。

---

## 現況盤點（已經有的，不要重做）

```
  ✅  十種飛機＋任務專用 Yak-1B；逐部位命中盒與防護力、史實性能校準
                                                        src/specs/catalog.ts:22
  ✅  砲塔（He 111 / B-17G / G4M），AI 驅動 —— 玩家開轟炸機時不必再做
  ✅  八條任務規則：annihilate / evacuate / convoy（可帶 need）/ hunt / sink /
                    destroy / interdict / defend        src/battle/mission.ts:23
                    evacuate 只由日 M2 的返航節拍換進來（沒有「撤離」類型的卡）
  ✅  節拍：reinforce / withdraw / recycle / flare / conveyor /
            depart / retarget / mopUp                   src/battle/beats.ts:89-208
      條件：clock / alive / batch / ground / destroyed  src/battle/beats.ts:32
  ✅  警戒：被發現之前雙方不開打（日 M3）              src/battle/alert.ts
  ✅  沿路線移動的地面目標（日 M2 車隊、德 M4 縱隊）   src/world/groundMotion.ts、
                                                        src/battle/missions/groundColumns.ts
  ✅  地面戰：射手、砲兵彈著、步兵、迫擊砲（德 M4）   src/render/groundBattle.ts
  ✅  進場擺法：headOn / pursuit / bounce / strikeFromNorth / carrierGuard / aschEast
                                                        src/battle/entry.ts:68-208
  ✅  地形：sea / archipelago / farmland / autumnFarmland / leuna / poltava / asch /
            leyte / rzhev                               src/world/terrainKind.ts:24
  ✅  時段：dawn / noon / dusk / night / novemberNoon / storm / winterMorning
                                                        src/world/timeOfDay.ts:15
      storm 有閃電、雨、地面雨花與雷聲                  src/render/storm.ts、rain.ts
  ✅  戰場邊界與雲場                                    src/world/arena.ts、cloudField.ts
  ✅  海陸環境：ocean、island、terrain、farmGround、fields、flora、vegetation、
                草原與草原村、洛伊納的河、鎮的路網
  ✅  特效：fireball、debris、smoke（近鏡頭交接）、splash、sparks、wrecks、
            子彈打地噴土、砲口火焰與煙
  ✅  音效：引擎、槍砲、地面車輛、雷聲、介面、選單音樂   src/audio/
  ✅  目標圈 objectiveRing、目標距離 HUD                src/hud/widgets/objective.ts
      任務目標框（四角括號）與邊緣箭頭                  src/hud/widgets/contacts.ts、markers.ts
  ✅  畫面：landing / menu / campaign / mission / skirmish / battle / hangar
                                                        src/ui/screens.ts:10
      設定、教學卡、暫停是疊層，不是畫面
  ✅  World 的成長路徑：cull.ensure、killEvents 重建、damageTime 重配
                        src/world/cull.ts、src/world/World.ts
```

---

## ⚑ 需要專案負責人的（清單裡以 ⚑ 標出）

分成兩類。我可以先量、先做，但值與判斷是你的。

### 一、⚑ 裁決：值與判準（我量得出來，值是你定的）

- [x] ~~⚑ **新機種的血量與防護力**~~ —— 三架日本機 2026-09-03 裁定：
      血量四捨五入到百位（800 / 600 / 2,800），防護力的下限由 0.7 降到 0.60
- [ ] ⚑ **護欄門檻與平衡值** —— 「護欄重新定值是專案負責人的決定」。
      已動過一次：`specs.test.ts` 的防護力下限 0.7 → 0.60
      （2026-09-03 裁定，負責人已覆核）
- [x] ~~⚑ **三台轟炸機的失速同方向偏高 5–7%**~~ —— **接受，不修**
      （2026-09-03：「飛起來 OK，記錄起來不再問」）。線索記在
      `docs/backlog.md` §1.2，不是待辦
- [x] ~~⚑ **三台日本機飛起來對不對**~~ —— 2026-09-03 試飛通過
- [ ] ⚑ **增援預警提前幾秒** —— 手感問題，只能試飛。現值 0～20 秒，逐張卡寫在
      `warnLead`（`grep -n "warnLead:" src/battle/missions/*.ts`；最大的是日 M2
      撤退路上的堵截，`japan.ts:284`）
- [ ] ⚑ **要不要做 Bf 109 E-4 spec** —— 仍未裁定（`ls src/specs/` 沒有 E-4）
- [ ] ⚑ **史實資料表衝突時信哪一份** —— He 111 的質量就是這樣裁的
      （12,500 → 13,727）
- [ ] ⚑ **`altitudeSpread` 要不要逐卡覆寫**（盟 M1 想把護航機拉到箱子上方
      1,000 m）—— spec `2026-09-13-campaign-rework-design.md` §12 記為未定

### 二、⚑ 試飛：只有你判斷得了的

「玩起來合不合理」不是我量得出來的東西。**每一關做完都要一次。**

- [ ] ⚑ 各關的節奏、難度、第二波來得太早或太晚 —— 九關改版的起始值清單在
      spec `2026-09-13-campaign-rework-design.md` §10；德 M4 的在
      `2026-10-03-germany-m4-rzhev-winter-design.md`
- [ ] ⚑ 盟 M1 的 `convoyPriority` 3 要重新掃描（`src/battle/missions/allies.ts:34`：
      `docs/backlog.md` §1.3 量的是 4 架轟炸機，16 架箱型的砲塔數是那時的四倍）
- [ ] ⚑ 新機種飛起來對不對 —— Ju 87（含 AI 俯衝投彈，spec
      `2026-10-02-stuka-dive-bombing-design.md`）
- [ ] ⚑ AI 回升（spec `2026-09-28-band-regain-design.md` 自己還寫著待試飛；
      實作在 `src/ai/AiController.ts`，commit `87a97670`）
- [x] ~~⚑ AI 防墜與對地掃射在德 M3 的體感~~ —— 玩家試飛確認可定案
      （`docs/ai-ground-collision-recovery.md` §9.5）

---

## 里程碑 1 —— 觸發器與中途加入　✅ **2026-09-03 完成**

機制全部到位，而且遊戲裡真的走得到。

### 1.1 中途加入戰場

**做法是預配到最終容量，不是中途成長。**`World.add` 的擴容路徑會把
`killEvents` 換成空的、把 `damageTime` 整張抹掉；`FlightIndex` 根本長不大。
所以容量在建構期就配到最終架數，中途一個 ensure 都不觸發。

- [x] `TargetBoard` 收 `capacity` —— 三個 typed array 照最終架數配
- [x] `FlightIndex` 收 `capacity` 與 `teams` —— 建構期就把增援的分隊建好，
      roster 指向還不存在的座位，`compactFlights` 在它們出現時自己填上
- [x] battle 層：`commandUnits`、`blue`/`red`、`spawnOrientations`、`roster`、
      以及 `stepCommandLayer` 用的四份分隊索引清單
- [x] `main.ts` **只附加**新的 visual（`syncVisuals`）。不能用
      `rebuildVisuals` —— `attachVisual` 不冪等，而那一支會先把全場還回去
- [x] 既有卡片逐位元不變 —— 兩份重播校驗和證實

### 1.2 觸發器：條件 × 效果

**沒有做成「條件 × 效果」的矩陣。**交叉出來的組合大半沒有合法語意。實際需求
幾類，就寫幾個具名節拍（`src/battle/beats.ts:89-208`）。

**條件**（`beats.ts:32`）

- [x] 時鐘 —— 第 N 秒
- [x] 存活數 + **選擇器** —— 「紅隊的**戰鬥機**剩 ≤ 2 架」
- [x] 重生批數 `batch` —— 盟 M3 的陸攻掛在零戰的第 4 批（`allies.ts:280`）
- [x] 地面戰果 `ground` —— 敵方地面目標被摧毀數不到門檻才成立
- [x] 摧毀數 `destroyed`（可限定單位）—— 日 M2 炸到第 1、第 12 輛卡車
      （`japan.ts:252`、`:270`）；德 M4 炸掉 7 門反坦克砲（`germany.ts:78`）
- [ ] ~~位置~~ —— 沒有關卡要
- [ ] ~~事件~~ —— 同上

**效果**

- [x] 增援登場 `reinforce` —— 先預警，過 `warnLead` 秒才真的進場
- [x] 任務目標變更 `withdraw`（→ `evacuate`），目標文字一起換。日 M2 用它：
      炸夠卡車之後轉入撤離（`japan.ts:289`）
- [x] 通報訊息 —— 畫面中心單一訊息槽，後來者覆蓋（`src/hud/widgets/message.ts`）
- [x] 整隊重生 `recycle` —— 被殲滅的小隊整隊回來，席位回收
- [x] 照明彈 `flare` —— 德 M2
- [x] 轟炸機流 `conveyor` —— 抵達終點的 transit 從進場點重新進場，德 M1 用
- [x] 從地面起飛的增援 —— 波次帶 `takeoff`／`departs`，那一批地上剩幾架就上幾架、
      一架都不剩就不來（德 M3，`germany.ts:492-510`）
- [x] 地面縱隊出發 `depart` —— 德 M4 突破之後蘇軍縱隊開出來（`germany.ts:262-277`）
- [x] 換任務目標 `retarget` —— 德 M4 炸完反坦克砲改炸 8 輛戰車（`germany.ts:286`）
- [x] 掃蕩 `mopUp` —— 德 M4 突破後剩下的砲在 12～45 秒內陸續被地面部隊拔掉
      （`germany.ts:284`）

**其他**

- [x] 時鐘當兜底：每一個「存活數」觸發都要有一個時限（`byLatest`，**必填**）
- [x] 有波次的關卡按「重新開始」→ 整個 `Battle` 重建，不截斷
      （專案負責人 2026-09-01 裁定）
- [x] 任務卡上的波次**直接指名機種**（`spec`）；`side` 決定隊伍，不決定機種
- [x] 預警文字寫成無線電通報、不寫批數（commit `eed8615`）
- [x] 警戒 `alert` —— 日 M3：敵方發現攻擊隊之前雙方不開打
      （`src/battle/alert.ts`、`japan.ts:358`；spec `2026-10-08-rennell-alert-design.md`）

---

## 里程碑 2 —— 非飛機目標與投放武器　✅

**需要這一層的關全部上線**：盟 M2 梅澤堡的油廠、盟 M3 沖繩外海、德 M2 波爾塔瓦
之夜、德 M3 底板行動、德 M4 勒熱夫、日 M1 瓜達康納爾上空、日 M2 雷伊泰前線、
日 M3 倫內爾島。

### 2.1 可被攻擊的非飛機實體

- [x] 船：`src/world/ships.ts`（不是 `Combatant`）
- [x] 地面目標：`src/world/groundTargets.ts`，單位清單在 `src/specs/ground.ts:23`
      —— 子彈（口徑門檻）、炸彈（範圍傷害、擋路）、擊毀事件
- [x] AI 認得它：轟炸機的攻擊航路吃 `StrikeTarget` 視圖
      （`src/world/strikeTarget.ts`），船與地面目標都滿足它
- [x] 勝負判定認得它（見 2.4）
- [x] 砲位還手 —— 陸上輕型防空砲走直射彈、有曳光；重砲 88 mm Flak 18 與美軍
      90 mm M1；逐關複寫射速與引爆尺度
- [x] 砲塔轉向與仰角（spec `2026-10-08-gun-traverse-design.md`，
      `src/weapons/gunAim.ts`）
- [x] 地面車輛還手 —— 日 M2 只有雪曼會還擊（`japan.ts:194` 的 `armed`）
- [x] AI 對地掃射航次（`docs/ai-ground-collision-recovery.md` §9.2）；德 M3 指定
      停放與滑行中的 P-51 為優先目標
- [x] AI 俯衝投彈 —— Ju 87 過頂翻轉進場（`src/ai/diveBomb.ts`，spec
      `2026-10-02-stuka-dive-bombing-design.md`）

### 2.2 實體清單

- [x] Flak 陣地（`flak18.glb`、`flak38.glb`）、美軍 90 mm M1 與 M16 半履帶
- [x] 航空母艦、驅逐艦、重巡（盟 M3、日 M1、日 M3）；戰車登陸艦 LST
      （日 M2，不會動、不是任務目標；`src/world/ships.ts:22`）
- [x] 油廠的六種構件 —— 盟 M2（`src/render/geometry/ground/plant.ts`）
- [x] 停放的 B-17 —— 德 M2；停放的 P-51 —— 德 M3（佈局 `src/world/asch.ts`）；
      停放飛機的塗裝（spec `2026-10-12-parked-aircraft-livery.md`）
- [x] 油桶堆 `fuelDump`、彈藥堆 `bombDump`、探照燈、照明彈 —— 德 M2、德 M3
- [x] 機場地形 `poltava`、`asch` 與滑行／滾行起飛
- [x] 卡車／戰車 —— 德 M4 的蘇軍縱隊與德軍 IV 號（`panzer4`）；日 M2 的美軍車隊
      （M4A3、CCKW、M16；`src/render/geometry/ground/index.ts:77-86`）
- [x] 反坦克砲、步兵、迫擊砲 —— 德 M4 的地面戰
- [x] 冬季塗裝 —— 任務卡 `groundLivery`／`liveries`（德 M4）
- [x] 防空氣球 —— 日 M2（`japan.ts:65`）
- [ ] 虎式 `tiger` 已登記但沒有關卡用到（`grep -rn "'tiger'" src/battle src/world`
      → 零筆）
- [ ] ~~工廠／調車場的建築~~ —— 只服務已撤掉的德 M2 庫班
- [x] 火車（車頭 + 車廂）的外型 —— 沒有關卡用到
- [ ] ~~機場（守備目標）~~ —— 只服務被砍的日 M2 讀谷灘頭

### 2.2b 不做：都市地形（2026-09-01 裁定，之後再考慮）

**地面目標 ≠ 都市地形。**有地面目標的關要的是「可攻擊的東西」，那些擺在任務
專用地形上就成立（`leuna`、`poltava`、`asch`、`leyte`、`rzhev`）。

現有的聚落是**農村與鎮**（鎮的路網與密度：spec `2026-09-24-town-street-plan-design.md`、
`2026-09-24-town-density-design.md`；建築烘進遠景 `2026-09-24-building-bake-design.md`），
不是城市。城市要的街廓、多層建築、上千棟的實例數與這套系統幾乎沒有交集。

**要不要有城市地圖應該是一個獨立決定，不是被一關綁架著做出來。**

### 2.3 武器

- [x] 掛載點與投放（`src/weapons/stores.ts`、`src/weapons/bomb.ts`）
- [x] 炸彈：自由落體、爆炸範圍傷害（`src/world/bomb.ts`、`World.applyBombBlast`）
- [x] 魚雷：入水、定深、直線航行、**航跡**、命中船
- [x] 對地掃射 —— 子彈打得到地面目標，打地會噴土（spec `2026-10-07-dirt-impact-design.md`）
- [x] Flak：艦上的 5 吋砲（任務指定時優先打轟炸機與魚雷機，commit `e19206c0`）
      與陸上砲位
- [x] 彈艙與連投、投彈瞄具（`src/camera/bombsight.ts`、`src/hud/widgets/bombsight.ts`）
- [x] 掛彈戰鬥機投彈（玩家與 AI；日 M2 的 Ki-84，commit `52d5945f`）
- [x] 前機槍過熱（spec `2026-10-08-gun-overheat-design.md`，`src/control/gunHeat.ts`）
- [ ] ~~掛載改變飛行性能~~ —— 只服務被砍的德 M3 奧博揚公路。現況：掛載不進
      飛行質量

### 2.4 新的勝利條件

- [x] 「摧毀 N 個地面目標」（`destroy`，可限定單位；德 M4 可中途換目標，見 1.2）
- [x] 「至少 N 架被護送者抵達」—— `convoy.need`，湊不到門檻當場判敗（盟 M1）
- [x] 「累計擊落 N 架」（`hunt`，可限定角色；德 M1）
- [x] 「守住艦隊」（`defend`，讀要害艦；盟 M3）
- [x] 「截斷車隊」（`interdict`，炸夠 N 輛轉撤離、漏過 M 輛判敗；日 M2 `japan.ts:229`）
- [x] 擊沉帶護衛：攻擊隊之外的藍隊戰鬥機全滅判敗（日 M1）
- [x] 轟炸機全滅判敗（`defeatOnBombers`；德 M4 的 Ju 87）

---

## 里程碑 3 —— 日本機體　✅ **2026-09-03 完成**

三架全部進遊戲：外型、spec、武裝、逐部位命中盒、防護力、史實校準、登記表與
e2e 全部走完（設計 `docs/superpowers/specs/2026-09-03-japanese-aircraft-specs-design.md`）。

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

## 里程碑 3b —— 德軍新機與對手　✅

- [x] **Ju 87** —— 德 M4 玩家機；專屬引擎、機槍、俯衝警笛音效；AI 俯衝投彈
      （`src/specs/ju87.ts`、`src/ai/diveBomb.ts`）
- [x] **Yak-1B** —— 德 M4 的蘇軍對手，任務專用（spec `2026-10-03-yak1b-enemy-design.md`）
- [x] 任務卡指名手感 `feels` 與塗裝複寫 `liveries`（德 M4 讓三型穿冬季塗裝）

---

## 里程碑 4 —— 玩家開轟炸機　✅ **四關上線**

**盟 M2（B-17G）、德 M2（He 111）、德 M4（Ju 87）、日 M3（G4M）是玩家開轟炸機。**
玩家是 `combat` 小隊的長機，砲塔本來就是 AI 驅動。

- [x] `player` 旗標掛在 `duty: 'combat'` 的小隊長機上 —— 轟炸機分層擺位也一樣
      （`src/battle/order.ts` 的 `stackedEntry`）
- [x] `transit` 不必動 —— 玩家那一隊走攻擊航路（`src/ai/strikeRun.ts`）
- [x] 護送任務的判定沒有被牽動

---

## 里程碑 5 —— 呈現層

### 5.1 通報訊息

- [x] 畫面中心的文字提示，打字機逐字印出（`src/hud/widgets/message.ts`）
- [x] 進場橫幅 —— 任務目標在畫面中央印出、停 3 秒再滑進右上角目標列
      （`src/hud/widgets/objective.ts`）；開場導覽期間停在中央
- [x] 戰果通報（`src/hud/widgets/battleReport.ts`）

### 5.2 音效　✅

~~整個專案的最後一項~~ —— 已全面上線（spec `2026-09-19-audio-design.md`、
`2026-09-23-audio-dynamics-design.md`、`2026-10-09-gun-sounds-design.md`、
`2026-10-09-menu-music-design.md`）：

- [x] Web Audio 引擎、限幅器與 HDR 動態（`src/audio/engine.ts`、`limiter.ts`、
      `dynamics.ts`）；距離音色用大氣吸收
- [x] 每機一支引擎聲（`src/audio/flightAudio.ts`、`public/audio/engine-*.mp3`）
- [x] 槍砲：各砲種開火聲、每座砲各自限頻（`src/audio/cannonAudio.ts`、
      `volleyGroups.ts`）；子彈擦身
- [x] 地面車輛行進與怠速（`src/audio/groundVehicleAudio.ts`，commit `5321caa5`）
- [x] 雷聲（`src/audio/thunderVoice.ts`）、介面點擊（`src/audio/uiAudio.ts`）
- [x] 選單音樂（`src/audio/music.ts`、`public/music/menu.mp3`）。**戰鬥中沒有音樂**
- [x] Safari：從沒被手勢啟動的 context 不呼叫 `suspend()`

### 5.3 選單、機庫與設定

- [x] 機庫 —— 左邊機種卷宗、右邊那一架飛在海上（`src/ui/dossier.ts`、
      `src/app/showcase.ts`、`src/ui/menuHangar.ts`）
- [x] 機種徽章 —— 正交側影配國籍標誌（`public/ui/sil/*.png`，含 Ju 87、Yak-1B）
- [x] 選單背景短片 —— 六段依權重挑選、記得看過哪幾段（`src/app/menuReel.ts`、
      `src/app/reelShots.ts`；spec `2026-10-01-menu-reel-design.md`）
- [x] 設定頁 —— 語言、瞄準輔助、畫質、抗鋸齒（要重新載入）、音量、滑鼠靈敏度、
      恢復預設值；按確定才套用，語言即時切換（`src/ui/menuSettings.ts`）
- [x] 中英雙語（`src/i18n/`；spec `2026-09-29-i18n-design.md`）
- [x] 教學卡 —— fighter、torpedo、bomb、fighterBomb，看過就不再跳
      （`src/ui/tutorials.ts`）

### 5.4 AI

- [x] 防墜：單一 Web Worker 以正式飛行物理預演改出掉高
      （`docs/ai-ground-collision-recovery.md` §9.1）
- [x] 移除 500 m 空戰高度限制（同文件 §9.2）
- [x] 跟瞄時改平坡度、拉回高度（spec `2026-09-28-ai-track-level-design.md`、
      `2026-09-28-band-regain-design.md`）

### 5.5 鏡頭與操作

- [x] 開場導覽 —— 十張卡全部有：上下黑邊、HUD 只留任務目標框、空白鍵或點一下跳過、
      結束時滑回玩家；導覽之後才跳教學卡（`src/app/missionIntro.ts`、
      `src/app/missionIntroDirector.ts`；spec `2026-10-12-mission-intro-design.md`、
      鏡位寫法 `2026-10-12-mission-intro-shots.md`）
- [x] 按住 V 望遠 2.5 倍（`src/camera/CameraRig.ts`；spec `2026-10-10-zoom-view-design.md`）
- [x] 上帝視角（`src/camera/godCamera.ts`、`src/hud/widgets/godMarkers.ts`）
- [x] 瞄準輔助（設定頁可關；望遠時也作用）
- [x] 任務結束慢動作（`src/battle/mission.ts` 的 `END_SLOWDOWN_SECONDS`）
- [x] 手機：觸控操作、全螢幕、直放時提示橫放（`src/input/touch.ts`、
      `src/input/fullscreen.ts`）
- [ ] ~~座艙視角~~ —— 不在 main（`viewMode` 只有 `'third' | 'bomb'`，
      `src/camera/CameraRig.ts`）

### 5.6 畫面

- [x] 顯示內插（spec `2026-10-12-render-interpolation-design.md`）
- [x] 繪製剔除（spec `2026-09-29-render-culling-design.md`）
- [x] 雲場、近鏡頭煙霧交接、螺旋槳殘影
- [ ] ~~光暈（bloom）~~ —— 做過又整個拔掉（commit `f3dc0ec5`，GPU 成本不划算）
- [x] 飛機塗裝貼圖、船的塗裝與航跡（spec `2026-09-30-ship-livery-design.md`）
- [x] 田色 clipmap、草原（spec `2026-09-17-field-clipmap-showcase-design.md`、
      `2026-10-01-steppe-fields-design.md`）、洛伊納的河（`2026-09-24-leuna-river-design.md`）
- [x] 煙隨風飄（spec `2026-10-05-drop-kick-smoke-wind-design.md`；投放推力的做法與
      spec 不同：現在是全程 0.2 m/s² 漂移，`src/world/bomb.ts:40`）
- [ ] ~~即時陰影~~ —— 擱置，只在 `feat/shadows` 分支（繪製成本太高）

---

## 里程碑 6 —— 戰役外框

- [ ] Bf 109G —— 可用 K-4 換皮（機鼻、座艙、材質、飛行參數），成本最低
      （`ls src/specs/` 沒有 109G）
- [ ] 戰役進度／解鎖／存檔 —— `localStorage` 只存偏好與「看過沒」（音量、語言、
      瞄準輔助、滑鼠靈敏度、畫質、教學卡、背景短片），**沒有進度**
      （`git grep -n "localStorage" -- src`）
- [ ] 難度曲線對到既有旋鈕（`aiProfile` 的 ACE / VETERAN、編制、幾何）
      —— 十張卡一律 `VETERAN`（`src/battle/missions/configuration.ts:240`）。
      **星等已經移除**（2026-09-03 裁定）：關卡內容差太多，一個 1~5 的
      數字沒有客觀意義

---

## 待裁定（不是開發項目）

- [x] ~~**年代衝突**~~ —— **德軍 M2 是東線，不是轟炸英倫**（2026-09-01 裁定）。

      repo 裡的 He 111 是 **H-6**，1942 年才出來、主要在東線／地中海／反艦，
      不列顛空戰飛的是 H-2 / H-3。問題不是「He 111 太老」，是「轟炸英倫
      這個場景對這台飛機太新」。

      德 M2 由庫班的鐵路換成波爾塔瓦之夜（spec `2026-09-10-germany-m2-poltava-design.md`
      §1）。德軍線現為四關，依選單順序：1944/11 梅澤堡上空 → 1942/11 勒熱夫 →
      1944/6 波爾塔瓦 → 1945/1 底板行動（見「編號約定」）。

      被這個決定一起否掉的兩條：
      - 做 Spitfire 來打 1940 的英倫 —— 全新機體，只服務一關
      - 都市地形 —— 見里程碑 2 的「不做」那一段

- [ ] **要不要做 Bf 109 E-4 spec** —— 與年代**無關**。

      遊戲裡的 109 已經是「**E-4 外型 + K-4 性能**」（`bf109k4.model.ts` 檔頭，
      2026-08-25 裁定），所以做 E-4 spec 買到的不是年代正確，是
      **德軍線的機體成長感（E → G → K）**。

      成本：**外型與命中盒 0**（同一具機身），只要一輪氣動校準。
      要不要做取決於「德軍線需不需要性能升級感」。

- [x] ~~**日本第三架**~~ —— **Ki-84 疾風**（2026-09-01 裁定）。

      **判準：跨戰線重複沒關係，同一條線內不能重複。**

      **B-29 與「高空攔截」一併否決。**支撐它的理由是「高度是沒人用過的
      玩法軸」，而實測推翻了：出貨的 Bf 109 K-4 在 9,500 m 極速 737 km/h
      （比 4,000 m 的 662 還快）、爬升率 30.7 m/s、升限 16,241 m。手感層
      已經把高度懲罰抹掉了。要拿回那個體驗得動手感層的高度行為，那會影響
      全部飛機與全部既有護欄——是一個獨立決定，不該被一關拖著走。

      之後：九關改版（spec `2026-09-13-campaign-rework-design.md` §2）把護航改由
      日 M1 瓜達康納爾（A6M5 掩護 G4M）承擔；Ki-84 改去日 M2 雷伊泰掛彈打車隊。
- [x] ~~**增援預警**~~ —— **要做，畫面中心的文字提示**（2026-09-01 裁定）。見 5.1
- [x] ~~**音效**~~ —— 已上線。見 5.2

---

## 附錄：10 關的現況

**卡片在 `src/battle/missions/{allies,germany,japan}.ts`**，由
`src/battle/missions/index.ts:13` 的 `MISSIONS` 組成一張表。「關」欄是卡片 id
的編號，「選單」欄是選單上的第幾關（見「編號約定」）。十張卡全部有開場導覽
（`grep -n "intro:" src/battle/missions/*.ts` → 十筆）。

| 關 | 選單 | id | 標題 | 類型 | 我方（玩家機） | 敵方 | 被護送／攻擊隊 | 地形・時段・高度 | 勝利條件 | 節拍 | 出處 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 盟 M1 | 1 | `allies-m1` | 柏林上空 | 護航 | P-51D ×4 | Bf 109 K-4 ×10 | B-17G ×16，三中隊箱型 | farmland | `convoy`，8 架抵達 | 60 s 後方 Bf 109 ×4、110 s 側上方 ×4（5,000 m）；開場那批重生 3 批 | `allies.ts:16` |
| 盟 M2 | 2 | `allies-m2` | 梅澤堡的油廠 | 打擊 | B-17G ×12，分層 | Bf 109 K-4 ×4 正面 | — | leuna・novemberNoon・1,500 m | `destroy` 6（廠區構件＋砲位） | 90 s 後方 Bf 109 ×4 | `allies.ts:101` |
| 盟 M3 | 3 | `allies-m3` | 沖繩外海 | 殲滅 | F6F-5 ×8（carrierGuard） | A6M5 ×16；G4M ×4 | — | sea・TF58（Essex 要害＋Wichita ×2＋Fletcher ×6）・2,000 m | `defend` | 零戰整隊重生 6 批；第 4 批時 G4M ×4（1,000 m） | `allies.ts:192`、`shared.ts:126` |
| 德 M1 | 1 | `germany-m1` | 梅澤堡上空 | 攔截 | Bf 109 K-4 ×8 | P-51D（只由波次給） | 敵方 B-17G ×8 轟炸機流 | autumnFarmland・novemberNoon | `hunt` 6，只算轟炸機 | 0 s P-51 ×4、60 s P-51 ×4；轟炸機流不斷（conveyor） | `germany.ts:88` |
| 德 M4 | 2 | `germany-m4` | 勒熱夫 | 打擊 | Ju 87 ×6（2+2+2 分批）＋護航 Bf 109 K-4 ×6 | Yak-1B ×3 ×2（開場） | — | rzhev・winterMorning・2,000 m | `destroy` 7 門反坦克砲 → 改炸 8 輛戰車；Ju 87 全滅判敗 | 突破後蘇軍縱隊出發（depart ×4）、換目標（retarget）、掃蕩剩砲（mopUp）；地面戰 | `germany.ts:163` |
| 德 M2 | 3 | `germany-m2` | 波爾塔瓦之夜 | 打擊 | He 111 ×8，分層 | 沒有敵機 | — | poltava・night・1,500 m | `destroy` 停放的 B-17 全部（24 架） | 80 s 照明彈 | `germany.ts:338` |
| 德 M3 | 4 | `germany-m3` | 底板行動 | 打擊 | Bf 109 K-4 ×10（aschEast） | P-51D，全部從停機線滑出起飛 | — | asch・dawn・500 m | `destroy` 停放的 P-51 全部（16 架） | 0／0／30／60 s 各一個小隊滑行起飛，地上剩幾架上幾架 | `germany.ts:408` |
| 日 M1 | 1 | `japan-m1` | 瓜達康納爾上空 | 護航 | A6M5 ×12 | F4F-4 ×8 | 我方 G4M ×8 攻擊隊（`strike`） | archipelago・Wichita ×2＋Fletcher ×6（敵方）・1,000 m | `sink` 3；零戰全滅判敗 | F4F 重生 3 批 | `japan.ts:77` |
| 日 M2 | 2 | `japan-m2` | 雷伊泰前線 | 打擊 | Ki-84 ×6（250 kg ×2） | F6F-5 ×2 巡邏，其餘由波次給 | 美軍車隊 3 批 × 6 輛（M16 頭尾、CCKW、雪曼；只有雪曼還擊）；灘頭 90 mm ×3＋M16 ×2、前線 M16 ×2；灘頭停車與 10 艘 LST；防空氣球 | leyte・storm（雷雨）・1,500 m | `interdict`：炸 12 輛卡車 → 撤離（撤離點 z = 2,500 m、半徑 600 m）；7 輛抵達判敗 | 炸到第 1 輛（最遲 90 s）起 F6F 每波 2 架；炸到 12 輛時三組各 2 架在 3,000 m 堵截＋返航 | `japan.ts:143` |
| 日 M3 | 3 | `japan-m3` | 倫內爾島 | 打擊 | G4M ×11（200–300 m 低空交錯） | F4F-4 ×3 | — | sea・dusk・Wichita ×4＋Fletcher ×4・1,000 m | `sink` 4 | 被發現前不開打（alert） | `japan.ts:300`、`shared.ts:146` |

**被砍掉的三關**（commit `10588f7`；三張都是 `battle: null` 的目錄卡）：

- ~~盟 M3 諾曼第斷軌（P-51D 掃射機車與調車場）~~
- ~~德 M3 奧博揚公路（掛彈的 Bf 109 G 打戰車）~~
- ~~日 M2 讀谷灘頭（A6M5 攔截 F6F 再掃射登陸艇）~~

**被取代的一版**：德 M4 庫斯克 1943（spec `2026-10-01-germany-m4-kursk-design.md`）
—— 整關換成勒熱夫冬季（commit `7c98cd8b`）；程式裡已沒有 `kursk`。

> ⚑ **各關的數字全部是起始值，待試飛。** 九關的清單在 spec
> `2026-09-13-campaign-rework-design.md` §10，逐張卡的註解也都標著起始值。

### 日本線三關

```
  M1  掩護雷擊隊    A6M5    擋住 F4F，擊沉由陸攻達成               japan.ts:77
  M2  截斷車隊      Ki-84   掛彈炸公路上的補給車隊，然後撤離       japan.ts:143
  M3  反艦          G4M     黃昏低空雷擊                           japan.ts:300
```

M2 的內容見 spec `2026-09-23-japan-m2-leyte-design.md`（數值之後又改過，以卡片為準）。

### 共用資產

- 盟 M2 與德 M1 是同一場（1944 年 11 月，梅澤堡–洛伊納）的兩個座位，但德 M1 的
  地形是晚秋的內陸、地上沒有廠區（`germany.ts:110`）。
- 盟 M3、日 M1、日 M3 共用 Essex／Fletcher／Wichita 三個艦級，但三份艦隊各自
  一份（`shared.ts:126` 的 `TF58_GROUP`、`shared.ts:146` 的 `RENNELL_FLEET`、
  `japan.ts:32` 的 `GUADALCANAL_FLEET`）。
- 德 M2 與德 M3 都是機場，佈局各自一份、不共用地圖（`src/world/poltava.ts`、
  `src/world/asch.ts`）。
