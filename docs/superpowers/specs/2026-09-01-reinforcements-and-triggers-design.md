# 增援與觸發器的設計

> 專案負責人裁定：**做真正的中途加入**（增援是 `world.combatants` 裡真的多
> 出一架），不做「預先生成 + 第三態」。觸發條件第一版只做**時鐘**與
> **存活數**。

`docs/roadmap.md` 里程碑 1。解鎖德 M1、德 M4、盟 M1、盟 M4、日 M2 的骨架。

> **第二版。** 第一版有三個 P0 的事實錯誤（Codex 審查 2026-09-01），最要命的
> 是「`World` 那一層本來就支援成長」——**那是錯的**，見第三節。修正之後設計
> 反而變小：預配容量之後 `ensureBoard`、`BoardStorage`、四個可重新指派的欄位
> 全部不必要。

---

## 一、病灶

一場仗的參戰名單在 `createBattle` 那一刻就定死了。`world.add` 只在建構期被
呼叫（`src/battle/setup.ts:532`），之後沒有任何路徑能讓一架新飛機進場。

規劃中的 12 關**每一關**都有「第二波」的節拍：

```
  德 M1  發現 B-17 編隊 → 「敵方護航機！」P-51 出現
  盟 M4  打退 A6M5 → 雷達發現低空目標 → 魚雷機正朝航母接近
  日 M2  擊退第一波 F6F → 地面通報登陸部隊 → 第二波 F6F
  德 M4  友軍逐漸減少 → 任務更新：RETURN TO BASE
```

最後一條與前三條不同：它不生增援，它**改任務目標**。

---

## 二、為什麼不用「預先生成 + 第三態」

那條路便宜：開場就把增援生出來、`alive = false` 藏著，登場時走現成的
`World.respawn`。

**但它要求每一個讀 `combatants` 的地方都記得問一次「這一架登場了沒」。**
今天數得出六處；明天加的每一個功能都要記得，而忘記問的症狀是靜默的——多算
一架、少算一架、勝負判錯。`alive: false` 已經佔走「陣亡」，再疊一個布林值
上去就是兩個布林編三個狀態。

> 【第一版寫錯的一點】我寫「沒登場的飛機完全惰性」。**不完全對**：
> `World.step` 的第一個迴圈在檢查 `alive` **之前**就會清 `hitsDealt` 與遞減
> 槍焰（`src/world/World.ts:321`），而 battle、渲染、HUD、記分板、編制層
> 也都會掃 `combatants`。這反而**加強**了不要用第三態的判斷，但成本敘述
> 原本過度樂觀。

---

## 三、`World.add` 現在**不能**中途呼叫（P0）

第一版說「`World` 那一層本來就支援成長」，引 `cull.ts:48` 的「沒有一個
最多幾架的魔術上限」。**那個類比是錯的。**

`cull` 是每次命中判定前重建的暫存，丟掉沒有代價。另外兩個不是：

```ts
// src/world/World.ts:291
if (this.killEvents.capacity < this.combatants.length) {
  this.killEvents = createKills(this.combatants.length)   // ← 換成空的
}
// src/world/World.ts:295
// 【重配就整張清掉】`add` 只發生在場景組裝期，那時還沒有任何傷害。
if (this.damageStride < this.combatants.length) {
  this.damageTime = new Float32Array(n * n).fill(-Infinity)  // ← 抹掉全部
}
```

**那句註解就是前提，而中途加入會違反它。**具體會壞的：

1. `World.step` 產生擊墜事件 → 2. `drainKills` 記下戰績 → 3. 觸發器呼叫
   `world.add`，`killEvents` 被換成空的 → 4. `main.ts` 才要用那個 buffer 生
   火球、煙與碎片（`src/main.ts:900`）。**戰績記到了，爆炸不見了。**
2. `damageTime` 是助攻窗口（`damageTime[攻擊者 × stride + 受害者]`）。
   增援進場會把**全場所有還活著的目標的助攻紀錄抹掉**。

---

## 四、解法：開場預配到最終容量，中途零重配

**波次是有限的，而且寫在任務卡上**——所以「開局兵力 + 全部波次」的最終架數
在 `createBattle` 那一刻就算得出來。

於是：

```
  建構期   照最終架數配置全部容量（不建 Combatant，不引入第三態）
  觸發時   world.add 真的加一架 —— 但每一條 ensure 都不會觸發，因為容量夠
```

這一步同時解掉三件事：

- `killEvents` 與 `damageTime` **中途不會被重配**，上一節的兩個錯誤消失
- `TargetBoard` 的四個 typed array **參照永遠不換**，`readonly` 護欄留著，
  `ensureBoard` 與 `BoardStorage` 都不必存在
- 熱路徑零配置的保證不變

「有效範圍」由 `world.combatants.length` 決定——那個值本來就是每一個迴圈的
上界，不需要另一個欄位。

### 4.1 要預配的東西

```
  World          cull、killEvents、damageTime（固定 stride）
  TargetBoard    assignments / priority / protectedMask
  FlightIndex    flightOf / positionOf，以及**最終分隊數**的 flights
  CommandState   blueCommand / redCommand（依分隊數）
  battle 層      blue / red / commandUnits / spawnOrientations / roster
```

### 4.2 第一版漏掉的四份清單（P0）

`stepCommandLayer` 每步直接使用這四份，它們在建構期一次算好
（`src/battle/setup.ts:655`）：

```
  blueFlightIndices    redFlightIndices
  blueOrderFlights     redOrderFlights
```

新增分隊時四份都要跟上。漏掉的症狀是**指揮層對新分隊靜默無效**。

`CommandState` 若重建而不是預配，全場的 `orders`／`spent`／`idle`／`timer`
會突然歸零——預配就沒有這個問題。

### 4.3 `FlightIndex` 的成長（P0）

`flights` 是 `readonly Flight[]`，**連陣列本身都不能 push**
（`src/battle/flights.ts:56`）。而 `compactFlights` 對超出長度的 typed array
索引寫入會**靜默失效**——新飛機於是永遠沒有 `flightOf` 與 `positionOf`，
而且不會有任何錯誤。

做法：建構期就把最終分隊建好（增援的分隊先建成空的 roster），
`compactFlights` 是存活旗標的純函數，空分隊自然不佔位。

### 4.4 `main.ts`：只附加，不重建（P1）

第一版說 `attachVisual` 是「惰性 + Map」。**不是**——它每次呼叫都會建模型、
加進 scene、覆寫 Map，沒有先查（`src/main.ts:247`）。所以也不能呼叫現有的
`rebuildVisuals`：那會釋放並重建全場模型、重置殘骸狀態（`src/main.ts:405`）。

要的是：Battle 提供「這一步新增了哪些索引」，`main.ts` 只建那幾具 visual 並
附加到 `renderPositions` / `renderQuaternions`（`src/main.ts:418`），
**而且要在下一個物理子步之前做完**。

> GLB 樣板不是風險：`preloadAircraftModels` 開場就載完 `GLB_MODELS` 的全部
> 機種，不看這一場有沒有用到（`src/render/geometry/buildAircraft.ts:51`）。
> 真正的風險是新機種忘了登記時 `buildAircraft` 會**同步拋錯**。

---

## 五、觸發器：兩種節拍，不是條件 × 效果矩陣

第一版設計了「2 種條件 × 3 種效果」可任意交叉。**那是過度抽象**：實際需求只有
兩類節拍，而交叉出來的組合大半沒有合法語意（例如「時鐘到了把 convoy 規則
換成任意其他規則」）。

第一版只做兩個具名節拍：

```ts
/** 增援節拍：條件成立 → 預警 → 過 warnLead 秒後一支分隊進場 */
interface ReinforceBeat {
  when: BeatCondition
  warn: string          // 預警文字
  warnLead: number      // 預警到進場的秒數
  flight: FlightPlan    // 已經是 typed 的編組（不是 spec: string）
}

/** 返航節拍：友軍剩不多 → 任務改成撤離 */
interface WithdrawBeat {
  when: BeatCondition
  message: string
  point: Vector3
  radius: number
  seconds: number
}

type BeatCondition =
  | { kind: 'clock', at: number }
  | { kind: 'alive', team: Team, role?: Role, atMost: number, byLatest: number }
```

砍掉的四樣（有第二個真實案例再加）：

- 泛用的 `message` 效果——提示是節拍自己的欄位
- 泛用的 `objective: MissionRules`——先做明確的「返航」
- `spec: string`——專案已經有 typed 的 `AircraftSpec` 與 `FlightPlan`
- 每個節拍自己的 `fired`——見下

### 5.1 `fired` 不能放在 `MissionCard`（P0）

`MISSIONS` 是模組級常數，跨場重用（`src/battle/missions.ts:275`）。把
`fired` 寫回去的話：同一張卡第二次開場時波次已是 fired，而 `resetBattle`
沒有任何重置邏輯——**同一組設定跑兩次會得到不同結果**。

節拍的執行狀態一律放在 `Battle` 上：目前進行到第幾個節拍、已預警／待進場、
預定進場的 tick。

### 5.2 `byLatest` 是必填，不是選填

每一個 `alive` 條件都要有時限兜底。玩家太慢（打不完第一波）或太快（繞過）
時，第二波永遠不出現，那一關就卡死了。

### 5.3 決定性的四條規則

「當步的純函數」不夠。還要明訂：

1. **時鐘用整數 tick，不是累加的浮點秒數**做臨界判斷
2. **先對同一份快照判斷全部條件，再套效果**——否則第一個增援會改變存活數，
   讓同一步後面的條件依陣列順序產生隱性耦合
3. 同一步多個條件成立時，照 `MissionCard` 上的固定順序處理
4. 預警到進場的延遲用 tick，不能用 `setTimeout` 或 render time

### 5.4 步內順序

`stepBattle` 現在的順序是：`world.step` → `drainKills` → 接手倒數 →
`compactFlights` → `wireStations` → `stepCommandLayer` → `stepPressure` →
勝負判定（`src/battle/setup.ts:1036`）。

節拍插在 **`drainKills` 之後、`compactFlights` 之前**：

```
  world.step → drainKills → 【判斷節拍、附加增援】 → compactFlights
             → wireStations → command → pressure → 勝負判定
```

這樣最後一架第一波敵機被擊落的**同一步**就能加第二波（勝負判定之前），
而新分隊在下一次 `world.step` 之前完成編制與命令接線。

---

## 六、畫面中心的文字提示

HUD 現在沒有事件訊息的位置（`objective.ts` 是目標距離、`hints.ts` 是按鍵）。

第一版做**單一訊息槽**：文字 + 顯示到哪個 tick，後來者覆蓋。
**不做排隊**——目前只有預警與目標更新兩種訊息，沒有「同時多則都必須看到」
的案例。

---

## 七、重新開始：整個 Battle 重建（已裁定）

暫停選單的「重新開始」走 `resetBattle`（就地重置）。有波次的關卡重開時，
已經進場的增援要怎麼處理？

```
  甲  截斷回開局架數    要從十幾份 append-only 結構裡安全裁掉，
                       容易留下 roster、命令、visual 的殘骸
  乙  整個 Battle 重建   用原始的不可變設定重新 createBattle，保留地形
```

**已裁定：乙**（2026-09-01）：驗證容易得多。代價是 `main.ts` 的重開
路徑要能換掉 `battle` 物件。

---

## 八、驗收

### 8.1 既有 10 張卡

沒有節拍就走不到任何新程式。用兩份重播校驗和證實
（`spawn-baseline.ts`、`tactics-baseline.ts`）。

> **但那兩份守的範圍要說清楚**：它們是既有遭遇戰的出生表與特定 30 秒重播，
> **不是十張任務卡的逐卡 fixture**。它們證明得了「無波次的遭遇戰沒有漂移」，
> 證明不了「每一張任務卡仍然相同」。

### 8.2 中途加入

- **`killEvents` 與 `damageTime` 在加人前後逐位元不變**（這是第三節那個
  P0 的直接護欄）
- 加人之後 `board.assignments` 的舊值原封不動，新格是 −1
- `priority` / `protectedMask` 的舊值原封不動
- 四個 typed array 的**參照**在整場戰鬥中永遠是同一個實體
- 新飛機拿得到 `flightOf` 與 `positionOf`（擋 4.3 那個靜默失效）
- 四份分隊索引清單含得到新分隊

### 8.3 節拍

- 時鐘：第 N tick 觸發，只觸發一次
- 存活數 + 選擇器：只數指定 team + role
- `byLatest` 兜底：條件永遠不成立時仍然觸發
- 預警：警告顯示在進場**之前** `warnLead` 秒
- **同一張含波次的卡在同一個 process 連跑兩次完全相同**（擋 5.1 的全域污染）
- **增援之後重開，t=0 的 combatants／flights／roster／節拍狀態與第一次開場
  完全相同**
- 對照組：沒有節拍的卡，一次都不評估

### 8.4 不做「戰場上有沒有出現第二波」這種測試

那是戰場的產物。`ai-tactics.test.ts` 才剛因為同樣的理由搬進靶機場景
（commit `5dce114`）。

---

## 九、風險

**預配的最終架數算錯就會退回中途重配**，而那正是第三節那兩個錯誤。
任務卡上要有一條檢查：開局兵力 + 全部波次 ≤ `MAX_COMBATANTS`（40，
`src/battle/skirmish.ts:21`）。渲染池（muzzles、wrecks、turretBarrels）
照這個數訂容量，超過會溢位在渲染那一側。

**一波四架會在同一幀建四具模型**（`buildAircraft` + three.js 物件）。
不違反「`World.step` 零配置」，但可能是玩家看得到的進場卡頓。緩解：增援
在**遠處**進場（本來就是設計），第一幀不在畫面裡。

**增援提交不是交易性的。**機種沒登記、分隊超大、容量不足若在批次中途才發現，
會只加入半個波次。**要在改動世界之前驗完**：最終架數、機種登記、分隊大小、
進場幾何。

**`setDecisionPhase` 的 fraction 要另訂。**它不擾動既有 AI（只設自己的
`decisionTimer` 起點，`src/ai/AiController.ts:907`），但新機若照
`newIndex / currentLength` 算，同一波的值會全部接近 1，決策尖峰聚在一起。
要給一個能把同一波攤開的固定規則。
