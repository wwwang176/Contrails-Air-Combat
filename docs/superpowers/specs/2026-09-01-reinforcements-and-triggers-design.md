# 增援與觸發器的設計

> 專案負責人裁定：**做真正的中途加入**（`world.add` 在戰鬥中被呼叫），不做
> 「預先生成 + 第三態」。觸發條件第一版只做**時鐘**與**存活數**，效果做
> **增援登場**、**任務目標變更**、**畫面中心提示**三種。

`docs/roadmap.md` 里程碑 1。解鎖德 M1、德 M4、盟 M1、盟 M4、日 M2 的骨架。

---

## 一、病灶

一場仗的參戰名單在 `createBattle` 那一刻就定死了。`world.add` 只在建構期被
呼叫（`src/battle/setup.ts:532`），之後沒有任何路徑能讓一架新飛機進場。

規劃中的 12 關**每一關**都有「第二波」的節拍：

```
  德 M1  發現 B-17 編隊 → 「敵方護航機！」P-51 出現
  盟 M4  打退 A6M5 → 雷達發現低空目標 → B6N 正朝航母接近
  日 M2  擊退第一波 F6F → 地面通報登陸部隊 → 第二波 F6F
  德 M4  友軍逐漸減少 → 任務更新：RETURN TO BASE
```

最後一條與前三條不同：它不生增援，它**改任務目標**。同一套條件判斷接不同
的效果——所以條件與效果要分成兩個軸，只做「增援觸發器」的話德 M4 又要另外
挖一個機制。

### 為什麼不用「預先生成 + 第三態」

那條路便宜得多：開場就把增援生出來、`alive = false` 藏著，登場時走現成的
`World.respawn`。`World.step` 有六個迴圈都是 `if (!c.alive) continue`
（`src/world/World.ts:339–452`），沒登場的飛機完全惰性。

**但它要求每一個讀 `combatants` 的地方都記得問一次「這一架登場了沒」。**
今天數得出六處；明天加的每一個功能都要記得，而忘記問的症狀是靜默的——多算
一架、少算一架、勝負判錯。`alive: false` 已經佔走「陣亡」，再疊一個布林值
上去就是兩個布林編三個狀態。

動態加入不需要任何人改：**一架還沒加進來的飛機不可能被誤處理，因為它不存在。**

### `World` 那一層本來就支援

```
  cull.ensure          容量不夠就長大    src/world/cull.ts:48
  killEvents           容量不夠就重建    src/world/World.ts（add 內）
  damageTime           n×n 不夠就重配    src/world/World.ts:297
```

`cull.ts:48` 的註解還明寫：「**也沒有一個「最多幾架」的魔術上限等著某天被
撞破**」。`World.add` 本來就是一個「隨時可以再呼叫」的函式，它只被呼叫一次
是因為 `setup.ts` 只呼叫一次。

> **`setDecisionPhase` 不是障礙。** 它只是一次性設定自己的 `decisionTimer`
> 起點（`src/ai/AiController.ts:907`），中途加人不會擾動別人的相位。這一條
> 我在調查時判斷錯過一次，記下來免得重蹈。

---

## 二、目標與非目標

**目標**

1. 戰鬥進行中可以讓一批新飛機從指定位置、指定速度進場。
2. 兩種觸發條件（時鐘、存活數 + 選擇器）× 三種效果（增援、目標變更、提示）。
3. 既有 10 張任務卡**逐位元不變**。
4. 畫面中心的文字提示，增援登場前先給預警。

**非目標**

- 位置觸發與事件觸發——沒有地面目標可以指，等里程碑 2。
- 無限波次。波次是有限的、寫在任務卡上的。
- 「視玩家表現決定派什麼來」——機種與數量在任務卡上寫死。
- 音效（整個專案排最後）。

---

## 三、要動的四層

### 3.1 `TargetBoard`：由假快照正名成活的視圖

它**已經是活的視圖了**——`candidates` 收的就是 `world.combatants`
那一個陣列（`src/battle/setup.ts:574`），只是另外四個 typed array 沒跟上：

```
  assignments     Int32Array(candidates.length)     src/ai/target.ts:767
  flightOf        FlightIndex.flightOf 的參照         同上 768
  priority        Float64Array(candidates.length)   同上 771
  protectedMask   Uint8Array(candidates.length)     同上 773
  pressure        Uint8Array(2)                     固定長度，不必動
```

**改動**

- 加 `ensureBoard(board, n)`：不夠就重配並**抄回舊值**。
  `assignments` 是當下的鎖定狀態、`priority` 與 `protectedMask` 是建構期填
  好的設定——三者都必須留住，不能像 `cull` 那樣重填。
- 那四個欄位的 `readonly` 要拿掉（介面上改成可重新指派）。`candidates` 維持
  `readonly`——它永遠是同一個陣列實體。
- `flightOf` 是 `FlightIndex.flightOf` 的**參照**。編制長大時那個實體會換掉，
  所以 `ensureBoard` 之後 battle 層要把新的實體重新指給板子。
- `createTargetBoard` 的 `candidates[i].index === i` 檢查對「附加」永遠成立，
  不必動。

### 3.2 `FlightIndex`：新來的自成一個分隊

```
  flights      readonly Flight[]                    src/battle/flights.ts:57
  flightOf     Int32Array(all.length)               同上 59
  positionOf   Int32Array(all.length)               同上 61
  pinned       number                               同上 69
```

**增援自成一個新的 `Flight` 附加在尾端**，不併進既有分隊。理由：既有分隊的
`flightOf` 完全不動，`pinned`（玩家恆佔 `members[0]`）也不受影響。併進去要
重排 roster，而 `compactFlights` 每步重算的前提是 roster 穩定。

`compactFlights` 本身不必改——它是存活旗標的純函數，陣列長大之後照跑。

### 3.3 battle 層：六個依架數的陣列要附加

```
  b.blue / b.red        Combatant[]
  b.commandUnits        CommandUnit[]
  b.spawnOrientations   Quaternion[]
  sizes                 每小隊架數（createFlights 用）
  roster                飛行員名單（src/battle/pilots.ts）
  b.blueCommand / b.redCommand   索引是分隊索引，新增分隊時要開長
```

**新增一個進場點**（暫名 `reinforce(b, plan)`），做的事與 `createBattle`
內層迴圈相同：套手感、`openingTas`、擺位、`world.add`、接線
（`ai.board`、`ai.selfIndex`、`ai.profile`、`setDecisionPhase`）。

**那段程式要抽出來共用，不能複製。** 兩份長得很像的生成邏輯就是「只有一份
會被修好」的那種危險——`setup.ts:452` 的註解對出生位置講過同一件事。

### 3.4 `main.ts`：兩個位置陣列要重建

```
  renderPositions    = world.combatants.map(c => visuals.get(c)!.position)
  renderQuaternions  = 同上                            src/main.ts:418
```

`attachVisual` 本身已經是「惰性 + Map」的形狀（`src/main.ts:248`），不必動；
但那兩個 `.map()` 出來的固定陣列要在加人之後重建。加人不是熱路徑。

---

## 四、觸發器：條件 × 效果

### 4.1 資料形狀

寫在 `MissionCard` 上（`src/battle/missions.ts:20`），預設空陣列——**沒有波次
的卡走不到任何新程式**。

```ts
interface Wave {
  when: WaveCondition
  then: WaveEffect
  /** 只觸發一次。觸發後標記，不再判斷 */
  fired?: boolean
}

type WaveCondition =
  | { kind: 'clock', at: number }                     // 第 N 秒
  | { kind: 'alive', team: Team, role?: Role, atMost: number }

type WaveEffect =
  | { kind: 'reinforce', team: Team, spec: string, count: number, entry: SideEntry, warn: string }
  | { kind: 'objective', rules: MissionRules, message: string }
  | { kind: 'message', text: string }
```

### 4.2 選擇器一開始就要有

盟 M4 是「打退**戰鬥機**之後魚雷機才來」，不是「紅隊剩幾架」。日 M2 同理。
`alive` 條件因此要能限定 `role`，之後補會很痛。

### 4.3 時鐘是兜底，不是備案

**每一個 `alive` 觸發都要配一個時限。** 玩家太慢（打不完第一波）或太快（提前
繞過）時，第二波永遠不出現，那一關就卡死了。做法：`alive` 條件內建一個
`byLatest` 秒數，到了就無條件觸發。

### 4.4 什麼時候判斷

排在 `stepBattle` 的 `stepPressure` 之後、勝負判定之前
（`src/battle/setup.ts:1063`）。**每步都判**——條件都是 O(架數) 的整數比較，
而 `stepPressure` 那種 10 Hz 節流是為了距離平方掃描，這裡不需要。

**判斷必須是當步狀態的純函數**，否則決定性重播會壞。

### 4.5 預警

增援效果帶一個 `warn` 字串，**在登場前先顯示**。延遲多久是手感問題，先取一個
常數，試飛之後再定。

---

## 五、畫面中心的文字提示

HUD 現在有目標距離（`src/hud/widgets/objective.ts`）與按鍵提示
（`hints.ts`），**沒有事件訊息的位置**。

新增一個 widget：畫面中心、有顯示時長、淡入淡出、多則連續進來時排隊。
`HudFrame` 加一個欄位承載當前訊息。

---

## 六、驗收

### 6.1 既有 10 張卡逐位元不變

**這一條是結構性的**：沒有波次就走不到成長路徑，`world.add` 在建構期的行為
一個字都沒動。但仍要用兩份重播校驗和證實
（`test/fixtures/spawn-baseline.ts`、`tactics-baseline.ts`）。

### 6.2 成長本身

- 加人之後 `board.assignments` 的**舊值原封不動**，新格是 −1
- `priority` / `protectedMask` 的舊值原封不動
- `flightOf` 重新指過之後，板子讀到的是新的實體
- 加人之後跑一段，`countLocks` 不把新來的算成幽靈鎖定
- 兩份 `Int32Array` 的長度與 `combatants.length` 一致

### 6.3 觸發器

- 時鐘：第 N 秒觸發，**只觸發一次**
- 存活數 + 選擇器：只數指定 team + role 的存活數
- `byLatest` 兜底：條件永遠不成立時仍然觸發
- 決定性：同一組設定跑兩次，逐位元相同
- 對照組：沒有波次的卡，觸發器一次都不評估

### 6.4 不做「戰場上有沒有出現第二波」這種測試

那是戰場的產物。`test/integration/ai-tactics.test.ts` 才剛因為同樣的理由
搬進靶機場景（commit `5dce114`）。這一輪驗的是**機制**：條件在該成立的時候
成立、效果在被觸發時發生、既有的路徑沒被動到。

---

## 七、風險

**`TargetBoard` 的 `readonly` 拿掉之後，誰都能重新指派那四個陣列。**
現在的 `readonly` 是一道真的護欄。緩解：`ensureBoard` 是唯一該碰它們的地方，
在型別上收成一個 `BoardStorage` 內部介面，並在註解裡寫死這一條。

**新增分隊會讓 `blueCommand` / `redCommand` 的長度需求變大。**
兩個 state 目前「開滿全域分隊數、各自只填自己隊伍的格」（`Battle` 的註解）。
加分隊時兩邊都要跟著開長，漏掉一邊的症狀是指揮層對新分隊靜默無效。

**增援的機種必須在任務卡上寫死。**`buildAircraft` 在 `main.ts` 是逐架惰性
建模，但 GLB 樣板要先載好（`loadGlbTemplates`）。若增援的機種在開場沒有任何
一架，樣板可能沒載——**進場點要確認樣板已就緒**，否則第一幀會是空模型。

**40 架的上限。**`MAX_COMBATANTS = MAX_SIDE × 2 = 40`
（`src/battle/skirmish.ts:21`）。渲染池（muzzles、wrecks、turretBarrels）照
這個數訂容量，模擬那一側沒有上限。**主力 + 全部增援不得超過 40**，否則渲染
池會溢位。任務卡上要有一條檢查。
