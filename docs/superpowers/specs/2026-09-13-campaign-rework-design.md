# 戰役九關改版 —— 收斂重複的任務型態，換上五張新卡

2026-09-13

## 1. 要做的事

九關裡有五張要改，四張不動。目標三條，依序是：

```
  一、護航／攔截的重複性收斂   原本 9 關裡 3 關跑 convoy，其中兩張逐格相同
  二、每一關都是那台飛機的高光  「打不贏」的關不寫（撤離、撐過空襲都因此作廢）
  三、九台飛機各有一關能開      F4F-4 是唯一的例外，見 §2.8
```

**不動的四張**（已經調教過遊戲性，這一輪一個字都不碰）：
`allies-m2` 梅澤堡的油廠、`allies-m4` 沖繩外海、`germany-m2` 波爾塔瓦之夜、
`japan-m4` 倫內爾島。

## 2. 負責人裁定

依討論順序記，每一條都是定案：

1. **三條線各 3 關不變**，不加第四關。
2. **盟 M1 保留 P-51D 當玩家機**，但戰役換掉 —— 不再用洛伊納那一區。
3. **每一關要是那台飛機的高光戰役。** 日本線原本提的撤離（呂宋）與撐過空襲
   （臺灣沖）兩案作廢，理由是「打不贏玩起來不舒服」。
4. **德 M1 不再與盟 M1 共用 B-17 的護送／攔截鏡像。** 改成 `hunt`：轟炸機流
   持續進場，累積擊落數，沒有判定圈。
5. **德 M3 換成底板行動**，機場定在 **Y-29（比利時 Asch）** —— 十七個目標裡
   唯一停著 P-51 的，而且史實上那裡剛好是「地面在起飛、空中已經有人」。
6. **停放的敵機沒打掉就會起飛加入戰鬥**，而且**滾行段要能被打**（在跑道上打掉
   正在加速的飛機是這一關最好的一幕）。**不做起落架** —— 模型整體抬高約 1.5 m
   避免陷進跑道面即可。
7. **日 M1 改成掩護雷擊隊**，規則用現成的 `sink`：擊沉數由陸攻達成，玩家只負責
   把 F4F 擋掉。原本的「滯空時限（油料倒數）」作廢 —— 畫面上沒東西可看。
8. **F4F-4 沒有玩家座位**，它在日 M1 與日 M3 當敵機。盟軍有四台飛機而只有三個
   座位，B-17G 與 F6F-5 已被不動的兩張鎖死，P-51D 不讓位。

## 3. 九關定案

| | 關 | 標題 | 玩家機 | 戰役 | 規則 | 地形 |
|---|---|---|---|---|---|---|
| 盟 | M1 | 柏林上空 | P-51D | 1944/3/6　首次白天轟炸柏林 | `convoy` ＋ `need` | farmland |
| 盟 | M2 | 梅澤堡的油廠 | B-17G | 【不動】 | `destroy` | leuna |
| 盟 | M3 | 沖繩外海 | F6F-5 | 【不動】 | `defend` | sea |
| 德 | M1 | 梅澤堡上空 | Bf 109 K-4 | 1944/11　本土防空 | **`hunt`** | **leuna** |
| 德 | M2 | 波爾塔瓦之夜 | He 111 | 【不動】 | `destroy` | poltava |
| 德 | M3 | 底板行動 | Bf 109 K-4 | 1945/1/1　Y-29 | `destroy` | **asch** |
| 日 | M1 | 瓜達康納爾上空 | A6M5 | 1942/8/7　拉包爾長程出擊 | `sink` | archipelago |
| 日 | M2 | 漢口上空（已由 `2026-09-23-japan-m2-leyte-design.md` 取代） | Ki-84 | 1944/8/20　飛行第 22 戰隊首戰 | `annihilate` | farmland |
| 日 | M3 | 倫內爾島 | G4M | 【不動】 | `sink` | sea |

規則分佈：`destroy` 3、`sink` 2、`convoy` 1、`defend` 1、`hunt` 1、`annihilate` 1。
**護航剩一張、攔截的鏡像歸零。**

**卡片 id 一個都不改**（2026-09-10 砍成三關時留下的編號空洞照舊），換的只有內容。
表上的 M1/M2/M3 是它在選單上的第幾關，不是 id：

```
  盟 M1 = allies-m1     德 M1 = germany-m1     日 M1 = japan-m1
  盟 M2 = allies-m2     德 M2 = germany-m2     日 M2 = japan-m3
  盟 M3 = allies-m4     德 M3 = germany-m4     日 M3 = japan-m4
```

僅存的重疊，先寫明以免日後被當成疏漏：

- `destroy` 三張裡，德 M2 與德 M3 都是打機場上的飛機（夜間高空投彈 vs 黎明低空
  掃射）。機場佈局各自一份，不共用地圖。
- `sink` 兩張都在太平洋（日 M1 掩護雷擊隊、日 M3 自己雷擊）。玩家的動作相反：
  一個全程纏鬥、一個全程對準船身。
- 敘事上盟 M1 與日 M1 都是「掩護轟炸機」。底層是兩條規則、兩種勝負、兩種失敗。

## 4. 史實

### 4.1 盟 M1　1944 年 3 月 6 日，柏林（Mission 250）

第八航空軍第一次以大編隊在白天轟炸柏林：730 架轟炸機、801 架戰鬥機，目標是
柏林的 VKF 滾珠軸承廠、Erkner 的博世廠、Genshagen 的戴姆勒—賓士發動機廠。
德國空軍出動約 500 架，是他們最後一次能集中這種規模。

結果是**美軍單日損失的最高紀錄**：69 架轟炸機、11 架戰鬥機；德軍損失六十幾到
八十架。

選它的理由有兩個。一是**只有 P-51 飛得到柏林** —— P-47 與 P-38 半路就得折返，
德軍攔截最兇的最後那一段只有野馬在，那正是第 4、355、357 大隊接的那一棒。
二是它是 Doolittle 新政策的第一次大考：1944 年 1 月他下令護航機不必再緊貼
轟炸機，可以脫離去追。三月之後德國空軍再也擋不住白天的轟炸。

**型號的簡化**：1944 年 3 月德軍主力是 Bf 109 G-6 與 Fw 190 A-8，K-4 要到十月
才服役。遊戲每個陣營只有一台戰鬥機模型，所以卡片寫戰役、不寫次型號。日 M1 的
零戰用同一套說法。

### 4.2 德 M1　1944 年 11 月，梅澤堡—洛伊納

與盟 M2 是同一場的兩個座位（那張卡的註解已經這樣寫）。洛伊納是德國最大的合成
油廠、油料戰役的頭號目標；1944 年 11 月 2 日第八航空軍出動六百多架 B-17 打它，
德國空軍做出那年秋天最大規模的攔截。

德軍的作戰目標從來不是「攔下某一批」，是**把損失率推到 10% 讓對方停飛** ——
這就是這一關用 `hunt` 而不是 `convoy` 的理由。

攔截主力是突擊大隊集體從**後方**衝進轟炸箱、貼到一百公尺內才開火，Bf 109 在
上層擋住護航機。遊戲沒有 Fw 190，玩家扮演的是衝進去那一架。

### 4.3 德 M3　1945 年 1 月 1 日，底板行動 / Y-29

德軍為阿登攻勢解套而發動的奇襲：約 900 至 1,000 架，來自十一個戰鬥機聯隊，
黎明貼著樹梢同時撲向十七個機場。戰鬥機飛行員當時已缺乏導航訓練，每一群由
Ju 88 夜戰機帶路。戰果約 300 架盟軍飛機（絕大多數停在地面），代價是德軍損失
約 280 架、213 名飛行員，其中相當比例**死於自己的高砲** —— 行動保密到連德軍
防空部隊都沒被告知。盟軍幾天內補齊，德國空軍再沒恢復。

**Y-29（比利時 Asch）**，上午九點十五分，JG 11 約 65 架撲進來。那一刻：

- 第 352 大隊第 487 中隊的 **12 架 P-51D 正在跑道上滾行起飛**，隊長 Meyer 在
  滾行途中就打下一架 Fw 190
- 第 366 大隊的 P-47 **已經在空中**巡邏

美軍宣稱擊落二十幾架、自己幾乎無損；JG 11 損失約 25 架，聯隊長 Specht 陣亡。

**為什麼選這個打得最差的目標**：十七個機場裡只有 Y-29 停著 P-51，而我們沒有
颱風式與噴火式的模型。底板真正成功的是 JG 3 打埃因霍溫，做不了。勝負條件是
「摧毀 N 架地面上的飛機」，玩家打得比史實好是被允許的。

**Y-29 是 ALG（前進降落場），不是水泥機場**：

```
  跑道     鋼板網（PSP）鋪在草地上，單條，約 1,400 × 36 m
  滑行道   跑道一側的環狀滑行帶
  停機位   滑行帶外側的分散停機墊，一架一格
  建物     幾乎沒有 —— 帳篷、油桶堆、簡易塔台
```

### 4.4 日 M1　1942 年 8 月 7 日，拉包爾 → 瓜達康納爾

美軍在瓜島登陸的當天，27 架一式陸攻從拉包爾出擊攻擊外海的登陸船團，零戰全程
掩護 —— 單程 1,040 公里，**戰史上最長的戰鬥機掩護任務**。那一天也是坂井三郎
被打瞎一隻眼、再靠剩下的油飛 1,040 公里回來的那一天。

這是零戰真正的高光：不是它的槍，是它的航程。攔截的是 F4F-4。

**型號的簡化**：1942 年 8 月的實機是 21 型，A6M5 要到 1943 年秋。同 §4.1。

**艦種的替代**：史實目標是運輸船團，遊戲沒有運輸船模型。這一關的目標群用現有
艦級組成「登陸船團的護衛艦隊」，卡片文案照此寫。

### 4.5 日 M2　1944 年 8 月 20 日，漢口上空

> 日 M2 已由 `2026-09-23-japan-m2-leyte-design.md`（雷伊泰前線）取代。

飛行第 22 戰隊帶著剛服役的四式戰疾風進駐中國戰線，在漢口上空迎戰第 14 航空軍
的 P-51。那是疾風第一次大規模投入，也是它名聲的來源 —— 唯一被公認能與野馬
平起平坐的日本戰鬥機，而那個評價只在那段時間成立過。

一號作戰期間第 22 戰隊常以二、三十架的規模出擊，所以 8 對 10 是合理的規模。

那場空戰的幾何：第 14 航空軍的野馬在高空有優勢，習慣從上面俯衝、一擊脫離、
再拉高；疾風的長處在中低空的纏鬥。**這一關的內容就是「把他們拖下來」。**

## 5. 已經在的（查證過，不必做）

- **六條任務規則**：`annihilate` / `evacuate` / `convoy` / `sink` / `destroy` /
  `defend`（`src/battle/mission.ts:21`）。`evacuate` 這一輪仍然沒有卡片用它。
- **波次與重生**：`MissionWave`（`when` / `warn` / `warnLead` / `spec` / `count` /
  `along` / `altitude` / `starboard`）、`MissionRecycle`、`byLatest` 兜底、
  席位預留（`setup.ts` 的 `reserve`）。
- **節拍條件**：`clock` / `alive`（可限定 `role`）/ `batch`（`battle/beats.ts`）。
- **進場擺法**：`HEAD_ON` 與 `PURSUIT`（`battle/entry.ts`）。九關目前全部用
  `headOn`，`PURSUIT` 零使用。
- **AI 的攻擊航路**：`ai/strikeRun.ts` 的狀態機、`ai/bombRun.ts` 的轟炸剖面、
  `ai/torpedoRun.ts` 的雷擊剖面（盟 M3 的 G4M 在用）。
- **轟炸機砲塔**：`world/turrets.ts` 對每一架存活的機無條件跑，玩家開的也一樣。
  `TURRET_DAMAGE_SCALE = 0.46875`。
- **艦隊**：`MissionFleet`、`vital` 旗標、艦砲（`world/shipGuns.ts`）、火與煙。
- **地面目標**：`GroundEntry`、`destroy` 計數、高砲（`GROUND_FLAK_SPEC`）、
  探照燈、停放機（`parkedB17`）、油桶堆（`fuelDump`）。
- **機場地形的機制**：`world/poltava.ts` 的跑道／滑行道／停機位是「著色器的鋪面
  矩形」加手擺座標，整套可以換一份佈局資料重用。
- **腳本控制器**：`control/ScriptedController.ts`（`straight` / `turn` / `weave` /
  `climb`），餵指令給同一套物理與指揮儀，不覆寫世界座標。
- **結算已經在印轟炸機存活數**（`ui/scoreboard.ts:176`，`x / y` 格式）。

## 6. 缺的東西

| 缺口 | 現況 | 這一輪 |
|---|---|---|
| 護送的勝負門檻 | 任一架進圈就判定 | `convoy.need`＋已抵達的累計，見 §7.1 |
| 抵達後的去留 | 沒有這回事 | 記一個閂、不退場，見 §7.1 |
| 大編隊的幾何 | 被護送的只有橫向一軸 | 三中隊箱型，見 §7.4 |
| 累積擊落的規則 | 沒有 | `hunt`，見 §7.2 |
| 我方的攻擊隊 | 同隊的轟炸機一律 `transit` | `convoyDuty`，見 §7.3 |
| 高度劣勢的開局 | 只有 `headOn` / `PURSUIT` | `BOUNCE` 擺法，見 §7.5 |
| 讀地面戰果的節拍 | 條件只看時鐘／飛機數／批數 | `ground` 條件，見 §7.6 |
| 從跑道起飛 | 飛機一律空中生成 | 滾行腳本，見 §7.7 |
| Y-29 的機場 | 只有波爾塔瓦那一份佈局 | `world/asch.ts`＋地形 `asch` |
| 停放的 P-51 | 只有 `parkedB17` | `parkedP51`，幾何指向現有 GLB |

## 7. 規則層新增

每一項都要能單獨關掉：**預設值等於「沒有這一項」**，這樣不動的四張卡與遭遇戰
逐字不受影響。

### 7.1 `convoy` 的門檻與已抵達累計

```ts
| {
    kind: 'convoy'
    owner: Team
    point: Vector3
    radius: number
    /** 要幾架抵達才算那一隊贏。**預設 1 = 現行行為** */
    need?: number
  }
```

`MissionInputs` 加一格 `convoyArrived`（**累計**，不是當步在圈內的數量）。
判定改成：

```
  那一隊贏   convoyArrived >= need
  那一隊輸   convoyAlive + convoyArrived < need    ← 湊不到門檻就當場結束
  那一隊輸   convoyAlive === 0（need = 1 時與上一條等價）
```

**第二條是這一項的重點。** 沒有它，16 架剩 7 架的玩家還要再飛兩分鐘才知道輸了。

**抵達是一個閂，抵達的那幾架不退場**（**實作時改掉的決定**，原本寫的是「進圈
即退場」）。`ConvoyIndex.arrived` 與 `seats` 對齊，一旦是 true 就不再看那一架的
位置 —— 存活與距離的掃描都跳過它，所以「同一架被重複計入」與「進過圈又飛出去」
兩個問題都不存在。**不讓它退場的理由**：整隊是一起到的，從第一架進圈到定案只有
幾秒，為那幾秒讓一架轟炸機在玩家眼前憑空消失不划算。

**半徑與 NaN 的防線抽成 `setup.ts` 的 `arrivedAt(distance, radius)`**（也是實作時
補的）。判定不再由規則做，那兩件事就得有自己的落點：嚴格小於、NaN 回 false。
兩者都要能單獨被殺死，寫在 `stepBattle` 裡面就只能靠開一場仗才碰得到。

**顯示**：`MissionState.metric` 維持「領頭那架到圈心的距離」（只算**還在路上**
的），`remaining` 維持「還在路上幾架」，新增的 `MissionState.arrived` 印「已送到
幾架」—— `need` 是 1 時它恆為 −1，目標列就不畫。

### 7.2 `hunt` 規則

形狀與 `sink` / `destroy` 逐字相同 —— 「達到 N 個就贏，我方全滅就輸」：

```ts
| {
    kind: 'hunt'
    count: number
    /** 只算這個角色的擊落。省略 = 全部 */
    role?: AircraftSpec['role']
  }
```

`MissionInputs` 加一格「紅方累計被擊落數（可依角色）」。累計，不是場上存活數的
補數 —— 有重生的關兩者不相等。

目標列沿用 `sink` 已經在用的「還差 N（分母 M）」那一套（`metricTotal`）。

### 7.3 攻擊隊職務 `convoyDuty`

`MissionBattle` 加一格：

```ts
readonly convoyDuty?: 'transit' | 'strike'   // 預設 transit
```

`transit` 是現行行為（不交戰、不閃彈、直線飛完，必須配 `convoy` 規則）。
`strike` 時那一群是 **`combat` 職務**：照常掛載、照常執行攻擊航路
（`ai/strikeRun.ts`）、照常閃彈，而且**不需要 `convoy` 規則** ——
`setup.ts` 那條「有 transit 卻不是護送規則就拋」的檢查只對 `transit` 生效。

日 M1 用它把 G4M 放進我方編組。德 M1 的 B-17 走另一條路（見 §8.2），不需要它。

### 7.4 三中隊箱型

只有 `transit` 的那一群需要（也就是只有盟 M1）。現在每一架的終點寫死成
`(自己的 x, 圈心的 y, 圈心的 z)`，要讓它帶自己的 y 與 z 偏移：

```
  中隊    架數   橫向            高度     縱深
  lead     6     −250 … +250      ±0       0
  high     5      +50 … +450     +250     後 500 m
  low      5     −450 …  −50     −250     後 500 m

  箱內間隔 100 m（CONVOY_LANE 0.25 → 這一關 0.125）
  最外側一架離圈心 √(450² + 250² + 500²) = 718 m  <  1,000 m  ✓
```

`setup.ts:900` 那條「離圈心不得大於半徑」的檢查要跟著改成量三維距離（現在只量
x），否則它會放過一個實際判不到的擺法。

護航機走現成的 `ESCORT_TIER = 4`，在轟炸機層上方 600 m；箱子自己佔 ±250，所以
P-51 只高出 high 中隊 350 m。**要不要把這一關的 `altitudeSpread` 從 300 開到
500 是未定項**（見 §12）。

### 7.5 `BOUNCE` 進場擺法

第三份 `EntryPlan`：對頭，但紅方高 1,000 m。

```ts
export const BOUNCE: EntryPlan = {
  id: 'bounce',
  blue: { ...NEUTRAL, along: 0.5, across: -0.5 },
  red: { ...NEUTRAL, along: -0.5, across: 0.5, heading: Math.PI, climb: 1000 },
}
```

`PURSUIT` 的註解已經分析過高度差的副作用（「斜距幾乎全被高度吃掉，追兵開場在
俯衝而不是在接近」）—— 這裡要的正是那個效果，只是方向相反。

### 7.6 讀地面戰果的節拍條件

```ts
| {
    readonly kind: 'ground'
    /** 敵方地面目標被摧毀的數量**不到**這個數才成立 */
    readonly below: number
    readonly byLatest: number
  }
```

`MissionInputs.targetsDestroyed` 每步都在算，條件只是讀它。

**二元，不做連續版**。「剩幾架就上來幾架」要讓波次的架數變成動態的，而
`MissionWave.count` 是常數、席位在建構期就預留好了。玩家讀得懂「打掉夠多就沒人
上來」，護欄也好寫。

### 7.7 滾行起飛腳本

```
  1  貼地姿態    位置鎖在跑道面、機身水平、航向沿跑道
  2  加速滾行    沿跑道中線推進，約 12 秒到離地速度
  3  抬頭離地    俯仰拉到 8–10°
  4  初期爬升    離地後三到四秒
  5  交還        解開座標鎖，當下速度向量接回物理，控制器換成 AI
```

**腳本期間那一架要留在 `world.combatants`、留在命中判定裡** —— 在跑道上打掉
正在加速的野馬是這一關最好的一幕。位置由腳本驅動，物理積分跳過。

**不做起落架。** P-51 的飛行模型沒有放下的輪子，把模型整體抬高約 1.5 m
（機腹離地高度）避免陷進跑道面即可。

**要注意的一件事**：腳本期間它在目標評分裡看得到，僚機可能為了追一架在地上的
飛機撞地。那段期間給它極低的分數（可以被玩家打，但 AI 不主動指派）。

## 8. 九關逐張規格

以下**全部是起始值**，由試飛裁定。幾何常數在 `DEFAULT_BATTLE`：
`entryRange 10000`、`lateralOffset 1500`、`schwarmSpacing 800`、
`altitudeSpread 300`、`altitude 4000`。`headOn` 的藍隊在 `z = +5000`、
`x = −750`，紅隊在 `z = −5000`、`x = +750`。

### 8.1 盟 M1　柏林上空

```
  blueSpec    P51D    blueCount    4     ← 玩家 + 3 架 AI
  convoySpec  B17G    convoyCount  16    ← 藍隊 20 席用滿，沒有增援空間
  redSpec     BF109K4 redCount     10
  entry       headOn        terrain  farmland
  targetDistance 12000      targetRadius 1000      need 8
  convoyPriority 3          convoyDuty  transit（預設）
```

**航程是 17 km，不是 12 km** —— 終點在 `z = −12000`，藍隊出生在 `z = +5000`。
以 B-17G 的開局巡航 355 km/h（`BOMBER_CRUISE 0.80`）算約 2 分 50 秒。
`targetDistance` **不加長**，這一關的問題是那三分鐘裡什麼都沒發生。

```
  0:00   Bf 109 K-4 × 10 正面，10 km 外對頭
  1:00   波次 A   Bf 109 × 4 從尾部（starboard: π）
  1:50   波次 B   Bf 109 × 4 從側上方
  全程   重生     開場那十架，小隊被打光就整隊回來，batches 3，warnLead 5
  ~2:50  抵達

  紅隊席位 10 + 4 + 4 = 18 ≤ 20 ✓（重生回收席位，不另外佔）
```

目標：**送 8 架轟炸機抵達柏林**。

`convoyPriority` 現行值是 5，而 `docs/backlog.md` §1.3 量到護送卡在 5 之下 AI
代飛必敗。16 架箱型加 128 座砲塔會徹底改變那個結論，**要重新掃描**。

### 8.2 德 M1　梅澤堡上空

```
  blueSpec  BF109K4  blueCount 8     ← 玩家在內
  redSpec   B17G     redCount  8     ← combat 職務，對廠區投彈
  convoySpec null    convoyCount 0
  entry     headOn         terrain  leuna
  ground    LEUNA_GROUND（重用盟 M2 那一份）
  rules     hunt { count: 6, role: 'bomber' }
```

**B-17 不是 `transit`，是普通的 combat 轟炸機。** 它們照 `ai/strikeRun.ts` 飛
自己的攻擊航路去炸洛伊納廠區 —— 盟 M2 的十一架 AI B-17 已經是這樣。所以這一關
不需要 §7.3 也不需要 §7.4，而且沒攔住的話**廠區真的會燒起來**。

護航機用波次進場（卡片只有一個 `redSpec`）：

```
  0:00   波次   P-51D × 4（side: theirs）—— 與轟炸機同時到
  0:60   波次   P-51D × 4
  全程   重生   side: theirs, role: 'bomber', batches 3 —— 轟炸機流不斷

  紅隊席位 8 + 4 + 4 = 16 ≤ 20 ✓
```

目標：**擊落 6 架轟炸機**。沒有判定圈，攔下哪一批不重要。

### 8.3 德 M3　底板行動

```
  blueSpec  BF109K4  blueCount 8
  redSpec   P51D
  entry     headOn         terrain  asch（新）
  timeOfDay dawn           altitude 300（低空進場）
  destroyCount 8
  ground    Y-29 的停機線（parkedP51 × 12）、油桶堆、輕高砲
```

```
  0:00   你貼著樹梢從東邊進來，跑道上停著一排 P-51
  0:00   波次   P-51D × 4 在 2,000 m 巡邏（第 366 大隊的 P-47 代打）
  0:40   節拍   ground { below: 6, byLatest: 40 } → 兩架開始滾行起飛
  1:20   節拍   ground { below: 10, byLatest: 80 } → 再兩架

  紅隊席位 4 + 2 + 2 = 8 ≤ 20 ✓
```

目標：**摧毀 8 架地面上的敵機**。壓力有兩層 —— 頭上那批隨時會壓下來，地上那批
不打掉就會加入他們。

`world/asch.ts` 照 `world/poltava.ts` 的形狀寫：鋪面矩形（跑道 1,400 × 36、
單側環狀滑行帶、分散停機墊）、停機位座標、油桶堆、輕高砲。鋼板網（PSP）的材質
與水泥不同色。

### 8.4 日 M1　瓜達康納爾上空

```
  blueSpec    A6M5   blueCount    12
  convoySpec  G4M    convoyCount  8     convoyDuty: 'strike'   ← §7.3
  redSpec     F4F4   redCount     8
  entry       headOn        terrain  archipelago
  fleet       瓜島外海的美軍船團（新的 MissionFleet，沒有 vital）
  rules       sink { count: 3, escorts: true }
  blueLoadout 不覆寫 —— G4M 保留預設的魚雷
```

藍隊席位 12 + 8 = 20 ≤ 20 ✓（用滿）。陸攻活幾架決定沉幾艘，那是這一關的骨架，
所以陸攻維持 8 架、加的是零戰；敵方 F4F 維持 8 架加重生，一次只動一邊。

```
  全程   重生   side: theirs, role: 'fighter', batches 3
  結束   陸攻飛到船團上空、投雷 —— 時限因此是看得見的事件，不是抽象倒數
```

目標：**掩護雷擊隊擊沉 3 艘**。正常打下來玩家一顆魚雷都不投；陸攻被 F4F 咬掉
幾架，就沉不了幾艘。**這一關玩家的動詞是九關裡唯一的：勝利條件由別人達成。**

**零戰全滅就是任務失敗。** 這一關的目標是掩護，護衛全滅即使陸攻還活著、船還沒
沉夠也判敗 —— 玩家不會改開被護的對象把仗打完。

```
  勝   擊沉 3 艘（與敗同一步時算勝）
  敗   藍隊的戰鬥機全滅（sink 的 escorts 旗標）
  敗   藍隊全滅
```

- **判準是「這一關有沒有護衛編制」**：`missionRules` 只在卡片有 `convoyDuty:
  'strike'` 的攻擊隊時加上 `escorts: true`。日 M3 倫內爾島藍隊全是陸攻、沒有
  攻擊隊，戰鬥機數恆為 0，那一張不帶這個旗標。
- **護衛就是藍隊的戰鬥機**：攻擊隊恆是轟炸機，所以數 `role === 'fighter'` 的
  存活數（`MissionInputs.aliveBlueFighters`）。
- 接手機制不動：零戰還活著時玩家死了照常接手僚機；最後一架零戰掉下來的那一步
  任務已經定案。

### 8.5 日 M2　漢口上空

> 日 M2 已由 `2026-09-23-japan-m2-leyte-design.md`（雷伊泰前線）取代。

```
  blueSpec  KI84  blueCount 8
  redSpec   P51D  redCount  10
  entry     bounce（§7.5，紅方高 1,000 m）     terrain  farmland
  rules     annihilate
  waves     無
```

目標：**擊落全部敵機**。

**刻意不加波次。** 德 M3 已經不是空戰關了，但日 M2 要跟其他八關分開就得少放
東西 —— 這是九關裡唯一一場封閉的、沒有第二階段的戰鬥機對決。壓力只來自兩件事：
對方多兩架，而且開局在你頭上。

## 9. 護欄

**要改的既有測試**

| 檔案 | 哪一條、為什麼 |
|---|---|
| `test/integration/mission-convoy.test.ts` | 釘的是「任一架抵達判贏」，門檻進來後那句話不再成立 |
| `test/unit/campaigns.test.ts:60` | 「護送與攔截有被護送的機種，其餘沒有」—— 德 M1 不再有 `convoySpec`，而日 M1 有 `convoySpec` 卻不是護送 |
| `test/unit/campaigns.test.ts:68` | 「地形逐關指定」—— 新增 `asch`，要跟著列 |
| `test/unit/campaigns.test.ts:152 / :171` | sink 要有 fleet、destroy 要有 ground —— 日 M1 與德 M3 各多一張 |
| `test/unit/briefing.test.ts:52` | 寫死 `allies-m1` 的空域是「德國　施韋因富特上空」 |
| `test/unit/briefing.test.ts:90` | 寫死 `germany-m4` 的空域是「德國南部　巴伐利亞上空」 |
| `test/unit/briefing.test.ts:97` | 寫死 `japan-m3` 的空域是「菲律賓　雷伊泰灣」 |
| `test/unit/briefing.test.ts:138` | 「九張卡的空域各不相同」—— 新的五個地名要保持互斥 |
| `test/unit/missions.test.ts` | 逐卡檢查，五張卡的機種／架數／地形全變了 |

`campaigns.test.ts:22`（三條線各 3 關）與那幾條只針對盟 M2、德 M2 的斷言
（:92、:102、:199、:215）**不受影響** —— 那兩張是不動的卡。

**要新增的**

```
  convoy 門檻      need = 1 時與改版前逐字相同（退化測試，最重要的一條）
                   湊不到門檻當場判敗，而不是等全滅
                   已抵達是累計 —— 進圈又飛出去不會被扣回來
  hunt             達標判勝、我方全滅判敗、role 過濾正確
                   有重生時「累計擊落」與「存活數的補數」不相等
  箱型幾何         16 架的每一架離圈心都小於半徑（三維，不是只量 x）
  convoyDuty       strike 時不觸發「transit 卻不是護送規則」那條拋錯
  ground 條件      byLatest 兜底；地面目標全毀時不再觸發
  滾行腳本         腳本期間可以被打；交還時速度是連續的（不是瞬間歸零）
```

**護欄不綁平衡**：`mission-convoy.test.ts` 現行手法是把紅隊的槍拆掉
（`harmless`），釘的是規則本身。架數、門檻、偏置怎麼調都不該讓它紅。這一輪
新增的測試照同一個原則寫。

## 10. 起始值清單（待試飛裁定）

```
  盟 M1   need 8 / convoyPriority 3 / 重生 3 批 / 兩個波次的秒數 / 箱型的三個偏移
  德 M1   hunt count 6 / 轟炸機流 8 架、終點 12 km / 兩批護航的秒數
  德 M3   destroyCount 8 / 停放機 12 架 / 三批起飛的秒數（0、45、90） / 滾行 12 秒
          滑行 8 m/s（約 29 km/h）、原地轉向 90°/s / 排隊間距 40 m、起步時差 1 秒
  日 M1   sink count 3 / A6M5 12 架 / G4M 8 架 / F4F 8 架 / 重生 3 批 / 船團的艦數與陣型
  日 M2   高度差 1,000 m / 8 對 10
```

## 11. 平行開發的切法

**切工照檔案，不照關卡。** 原本的瓶頸是 `src/battle/missions.ts`（1,291 行，
九張卡全住在裡面），拆檔之後變成：

```
  src/battle/missions/index.ts     門面：MISSIONS 組裝、missionRules、
                                   missionConfigFrom、型別轉出
  src/battle/missions/types.ts     全部型別
  src/battle/missions/shared.ts    CONVOY / KILL / 艦隊 / 地面表
  src/battle/missions/allies.ts    盟軍三張卡      ← 一個主人
  src/battle/missions/germany.ts   德軍三張卡      ← 一個主人
  src/battle/missions/japan.ts     日本三張卡      ← 一個主人
```

**對外的 import 路徑沒有變**（`from '../battle/missions'` 解析到 `index.ts`），
所以既有的四十幾個 import 站點一個字都不用動。

⚠️ **德國有兩張卡要改（德 M1、德 M3）、日本也有兩張（日 M1、日 M2）。**
那兩張必須是**同一個 agent**做完，否則又回到互相覆蓋 —— 分檔只買到三份所有權，
不是六份。

依賴關係：

```
  第 0 步  ✅ missions.ts 拆成六個檔案（純搬移，行為逐位元不變）

  第 1 步  ✅ 規則層 —— mission.ts 的 need / hunt、MissionInputs 的三格累計、
             setup.ts 的抵達閂與擊落累計、missions 的卡片欄位
             ★ 這一步沒完成，後面每一張卡都編不過

  第 2 步（機制，可平行 —— 每一項的檔案互不重疊）
    A  箱型幾何          order.ts 的 pushSide ＋ setup.ts 的 transit 終點
    B  convoyDuty        order.ts 的 pushSide ＋ missions/types.ts
    C  BOUNCE 擺法       entry.ts（只加一個常數）
    D  Y-29 機場         world/asch.ts（新檔）＋ terrainKind ＋ render/terrain
    E  滾行腳本          ScriptedController ＋ setup.ts 的生成路徑
    F  ground 節拍條件   beats.ts ＋ setup.ts 的 stepBeats

  第 3 步（卡片，可平行 —— 一人一檔）
    盟  allies.ts   盟 M1              依賴 A
    德  germany.ts  德 M1 ＋ 德 M3      依賴 D、E、F
    日  japan.ts    日 M1 ＋ 日 M2      依賴 B、C

  第 4 步（serial）  九張卡一起跑 campaigns / missions / briefing /
                     mission-config-baseline
```

⚠️ **A 與 B 都改 `order.ts` 的 `pushSide`，E 與 F 都改 `setup.ts`。**
那兩組要嘛同一個 agent 做，要嘛排先後。其餘六項互不重疊。

### 實際切成三個 worktree

把機制與它唯一的消費者綁在一起，每個 worktree 各自獨佔一個卡片檔：

```
  allies-berlin        A 箱型幾何                → allies.ts 的盟 M1
  japan-pacific        B convoyDuty、C BOUNCE、船團 → japan.ts 的日 M1、日 M2
  germany-bodenplatte  D Y-29 機場、E 滾行腳本、F ground 條件
                                                 → germany.ts 的德 M1、德 M3
```

重疊只剩兩處，都是同一檔的不同函數：

```
  order.ts 的 pushSide   allies-berlin 與 japan-pacific 都碰
  setup.ts               allies-berlin（transit 終點）與
                         germany-bodenplatte（生成路徑）都碰
```

**合併順序：`allies-berlin` 先進** —— 它對 `order.ts` 與 `setup.ts` 動得最深，
另外兩個 rebase 上去比反過來容易。

### ⚠️ node_modules 是 junction，移除 worktree 的順序不能反

每個 worktree 的 `node_modules` 是指回 `C:\projects\grok-aircraft2\node_modules`
的 junction（省 142 MB／個；被追蹤的檔案只有 8.9 MB，`ref/` 與 `dist/` 都在
`.gitignore` 裡不會跟著走）。

**`git worktree remove` 會順著 junction 把主目錄的 node_modules 一起刪掉。**
症狀是之後 `npx tsc` 說 `not the tsc command` —— `.bin` 整個沒了。所以：

```
  cmd /c rmdir "<worktree>\node_modules"     ← 先拆 junction
  orca worktree rm ...                       ← 再移除
```

收工用 `git stash` 而不是移除 worktree，也可以完全避開這件事。

`npx tsc --noEmit` 有一批既存錯誤（`test/tools/` 的探針與 e2e 的 `process`）。
**每一個 agent 開工前先量一次行數當基準**，改完比對有沒有增加。2026-09-13 量到
的是 **24 行**。

### 第 0、1 步已經在的（後面的 agent 直接用，不要重做）

```
  missions/      拆成 index / types / shared / allies / germany / japan 六檔
                 對外 import 路徑不變；搬移逐字，只有八個 const 多了 export
  mission.ts     convoy 的 need（省略 = 1）、hunt 規則（count + 可選 role）
                 MissionInputs 的 convoyArrived / redKilled / redKilledBombers
                 MissionState 的 arrived（−1 = 這一關沒有門檻）
  setup.ts       arrivedAt(distance, radius)：嚴格小於、NaN 回 false
                 ConvoyIndex 的 radius 與 arrived 閂、每步掃描改成三分支
                 Battle 的 redKilled / redKilledBombers，在 drainKills 累加
                 resetBattle 會把三者歸零
  missions.ts    MissionBattle 的 need / huntCount / huntRole
                 missionRules 產得出 hunt，也把 need 帶進 convoy
  護欄           battle-convoy.test.ts 的 arrivedAt 與 need 兩組
                 mission.test.ts 的「擊落」一組
                 battle-hunt.test.ts（新檔）—— 擊落累計的四條
                 campaigns.test.ts 的三格互斥、huntRole 要配 huntCount、
                 need 只出現在護航與攔截
```

**行為對既有的四張卡逐位元不變**：`strike-replay-baseline`、
`order-of-battle-replay`、`replay-determinism`、`rematch` 四組重播校驗和全綠。

## 12. 這一輪不做的事

- **返航穿過自家高砲**（底板行動最有名的一筆）。史實素材在，但它是額外的一段，
  等九關跑得動再談。
- **連續版的起飛數量**（剩幾架就上來幾架）。理由見 §7.6。
- **`altitudeSpread` 逐卡覆寫**（盟 M1 想把護航機拉到箱子上方 1,000 m）。
  **未定** —— 要不要為此多開一個卡片欄位，動工前再決定。
- **F4F-4 的玩家座位**。盟軍四台飛機三個座位，見 §2.8。
- **`evacuate` 規則的第一張卡**。它仍然沒有卡片用，那是它該待的地方。
- **停放機的起落架**。見 §2.6。
