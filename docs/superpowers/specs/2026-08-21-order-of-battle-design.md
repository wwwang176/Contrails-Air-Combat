# 編組表（Order of Battle）設計

**日期**：2026-08-21
**狀態**：待實作
**前一輪**：轟炸機自衛砲塔（`2026-08-20-bomber-turrets-design.md`）
**下一輪**：護送／攔截任務（本輪是它的前置）

---

## 1. 這一輪要做什麼

把 `BattleConfig` 上的五個欄位

```
  blueCount   redCount   blueSpec   redSpec   entry
```

**整組換成一張二維的編組表**：外層是小隊，內層是那個小隊的每一架飛機。

```ts
units: readonly FlightPlan[]
```

**這一輪不新增任何玩家看得到的功能。** 唯一的驗收是**行為逐位元不變**。

### 1.1 為什麼現在做

專案負責人 2026-08-21：

> 「我認為設定檔應該是一個陣列決定什麼機種、初始方位、初始姿態、小隊等等，
> 而不是加開欄位，不然未來越多類型會更新不完。」

這句話的直接觸發點是下一輪的護送／攔截：那兩張卡需要**同一隊裡有兩種機體**
（我方＝戰鬥機＋轟炸機、敵方＝轟炸機＋護航機），而 `blueSpec` / `redSpec`
是一隊一個機種。

但真正的理由比那個更早：`battle/entry.ts` 在 2026-08-16 已經為了同一句話做過
一次這件事 —— 那一輪把「擺位、面向、初始狀態」搬成資料表，卻**只搬了擺法，
機種與架數留在 `BattleConfig` 上沒跟過去**。這一輪把那半套補完。

### 1.2 明確不做的事

| 不做 | 為什麼 |
| --- | --- |
| `duty`（永遠飛終點、不纏鬥） | 專案負責人 2026-08-21 裁定「不放，下一輪再加」。這一輪的驗收是「逐位元不變」，放一個沒有讀者也沒有測試守得住的欄位只會讓審核分心 |
| 新的 `MissionRules` 分支 | 下一輪 |
| 護送／攔截那四張卡翻 `playable` | 下一輪 |
| `SideEntry` 加俯仰／滾轉 | 目前沒有任何一種擺法需要非水平的初始姿態。要的時候加一個欄位就好，而那正是這張表存在的意義 |
| 動 `STATION_OFFSETS` 或小隊大小 | 站位表是四個槽寫死的，改小隊大小會連帶動到編隊飛行與僚機邏輯。**小隊上限維持 `SCHWARM_SIZE = 4`** |
| 改任何護欄門檻 | 護欄重新定值是專案負責人的決定 |

---

## 2. 現況

### 2.1 `BattleConfig` 現在長這樣

```ts
export interface BattleConfig {
  blueCount: number          // ← 換掉
  redCount: number           // ← 換掉
  blueSpec: AircraftSpec     // ← 換掉
  redSpec: AircraftSpec      // ← 換掉
  entry: EntryPlan           // ← 換掉
  altitude: number
  tas: number
  entryRange: number
  schwarmSpacing: number
  lateralOffset: number
  altitudeSpread: number
  aiProfile: DifficultyProfile
  rules: MissionRules
}
```

### 2.2 `createBattle` 現在怎麼生

`src/battle/setup.ts` 的雙層迴圈（側 → 小隊 → 槽位）：

```
for side of ['blue', 'red']:
    count       = side === 'blue' ? cfg.blueCount : cfg.redCount
    flightCount = ceil(count / SCHWARM_SIZE)
    entry       = side === 'blue' ? cfg.entry.blue : cfg.entry.red
    base        = side === 'blue' ? cfg.blueSpec : cfg.redSpec
    spec        = applyFeel(base, feelFor(base))
    z           = entry.along * entryRange + entry.gap
    orientation = quat(UP, entry.heading)
    velocity    = FWD · orientation × (tas × entry.speed)
    lateral     = entry.across * lateralOffset

    for f in 0 … flightCount−1:
        leadX = (f − (flightCount−1)/2) × schwarmSpacing + lateral
        leadY = altitude + entry.climb + altitudeOffset(f, altitudeSpread)
        for k in 0 … 3, while slot < count:
            ref = STATION_REFERENCE[k]
            位置 = ref < 0 ? (leadX, leadY, z) : stationPoint(made[ref], STATION_OFFSETS[k])
            isPlayer = side === 'blue' && slot === playerSlot
```

其中 `playerSlot = floor(ceil(blueCount / SCHWARM_SIZE) / 2) × SCHWARM_SIZE`
—— 也就是**藍隊正中央那個小隊的長機**。

### 2.3 爆炸半徑（實測）

`grep -rc "blueSpec\|redSpec\|blueCount\|redCount"`：**24 個檔案、約 130 處**。
但分佈非常不平均：

```
  src/  只有五個檔案            測試與探針  19 個檔案
    battle/missions.ts   17       test/unit/skirmish.test.ts        16
    battle/setup.ts      13       test/unit/battle-setup.test.ts    14
    battle/skirmish.ts   10       test/unit/missions.test.ts        10
    main.ts               2       test/unit/battle-mission-wiring   10
    ui/menu.ts            2       test/tools/evacuate.probe.ts      10
                                  （其餘 14 個檔案各 1~6 處）
```

**關鍵事實：`BattleConfig` 在 `src/` 裡只有兩個地方組得出來** ——
`skirmish.ts` 的 `battleConfigFrom` 與 `missions.ts` 的 `missionConfigFrom`，
外加常數 `DEFAULT_BATTLE`。

- `src/ui/menu.ts` 那兩處讀的是 `SkirmishSetup`（選單自己的型別，有自己的
  `blueCount` / `redCount`），**不是 `BattleConfig`** —— 選單完全不受這一輪影響。
- `src/main.ts` 那兩處是一行除錯字串。
- 其餘 19 個檔案全是 `{ ...DEFAULT_BATTLE, blueSpec: X, blueCount: n, … }`
  這個寫法，是**機械式的一行替換**。

### 2.4 `resetBattle` 不受影響

它讀的是每個 combatant 自己記下的 `spawnPosition` / `spawnOrientations` /
`spawnTas` / `spawnAltitude`，一個字都沒碰 `cfg` 的五個欄位（只讀
`cfg.aiProfile`）。所以「再打一場」這條路徑這一輪不動。

---

## 3. 型別

新檔 `src/battle/order.ts`。

```ts
import type { AircraftSpec } from '../specs/types'
import type { SideEntry } from './entry'

/**
 * 一個小隊的編成。
 *
 * 【為什麼是「小隊」而不是「一隊」】專案負責人 2026-08-21：「是不是可以是
 * 二維陣列？這樣小隊分組、隊伍裡有什麼飛機都很清楚。」外層是小隊、內層是
 * 那個小隊的每一架 —— 兩件事在同一個字面值上一眼看得完。
 */
export interface FlightPlan {
  readonly team: 'blue' | 'red'
  /**
   * 這一小隊的每一架，`[0]` 是長機。1 … `SCHWARM_SIZE` 架。
   *
   * 【為什麼是機種陣列而不是「機種 + 架數」】混編小隊（一架轟炸機配三架
   * 護航）在後者表達不出來，而那正是下一輪要的東西之一。
   */
  readonly members: readonly AircraftSpec[]
  /**
   * 擺位、面向、初始姿態、速度。**沿用 `entry.ts` 的既有型別，一個字不動。**
   *
   * 同一隊的幾個小隊通常共用同一個物件參考 —— 那是刻意的，改一處就是改整隊。
   */
  readonly entry: SideEntry
  /**
   * 橫向槽位，**以 `schwarmSpacing` 為單位**。0 = 中央，可以是小數。
   *
   * 五個小隊排開就是 `−2, −1, 0, +1, +2`；四個是 `−1.5, −0.5, +0.5, +1.5`。
   */
  readonly lane: number
  /**
   * 高度層序號，餵給既有的鋸齒 `altitudeOffset(tier, altitudeSpread)`
   * —— 它把序號映到 `[−1, 1]`、週期 5。
   */
  readonly tier: number
  /**
   * 玩家開這一小隊的長機（`members[0]`）。
   *
   * **整張表恰好一筆為 true**，由 `createBattle` 斷言。
   */
  readonly player?: boolean
}

export type OrderOfBattle = readonly FlightPlan[]
```

### 3.1 為什麼 `lane` 與 `tier` 是序號，不是公尺

`entryRange`、`lateralOffset`、`schwarmSpacing`、`altitudeSpread` 這四個是
**探針換場景用的旋鈕**：`turn-shrink.probe.ts`、`stall-loop.probe.ts`、
`ai-command-decision.test.ts` 都靠覆寫它們來造場景。

編組表若存絕對座標，那些覆寫會**靜靜失效** —— 探針照跑、數字照印，只是量的
不是它宣稱的東西。`entry.ts` 的 `SideEntry` 註解本來就在警告這件事，這裡沿用
同一條紀律：**表裡存係數與序號，公尺由 `createBattle` 乘出來。**

### 3.2 `EntryPlan` 留著

`ENTRY_PLANS`（`headOn` / `pursuit`）與 `MissionCard.entry: EntryPlanId` 一個字
不動。`EntryPlan` 從「`BattleConfig` 的一個欄位」變成「`lineAbreast` 的一個
輸入」—— 它的內容（`blue` / `red` 兩份 `SideEntry`）正好是產一張橫隊表需要的
東西。

---

## 4. `lineAbreast` —— 產出今天那張表

```ts
/**
 * 產出「兩隊各自一種機、橫隊排開」的編組表。**這是 M5 以來的既有排列。**
 *
 * 【它存在的唯一理由是不要動到既有的一百多處呼叫端】那些站點寫的是
 * `{ ...DEFAULT_BATTLE, blueSpec: P51D, blueCount: 20, … }`，全部是既有護欄的
 * 基準。這支 helper 讓它們變成一行替換，而且**產出的座標與改動前逐位元相同**
 * （推導見 spec §4.1）。
 */
export function lineAbreast(
  plan: EntryPlan,
  blueSpec: AircraftSpec, blueCount: number,
  redSpec: AircraftSpec, redCount: number,
): OrderOfBattle
```

產法（兩隊各跑一次，**藍隊全部排在紅隊之前**）：

```
  flightCount = ceil(count / SCHWARM_SIZE)
  for f in 0 … flightCount−1:
      size    = min(SCHWARM_SIZE, count − f × SCHWARM_SIZE)
      members = size 份同一個 spec
      lane    = f − (flightCount − 1) / 2
      tier    = f
      entry   = plan[team]
      player  = (team === 'blue' && f === floor(blueFlightCount / 2))
```

### 4.1 逐位元等價的推導

| 量 | 改動前 | 改動後 | 相同嗎 |
| --- | --- | --- | --- |
| `world.add` 的順序 | 側（藍→紅）→ 小隊 → 槽位 | 掃編組表；`lineAbreast` 把藍隊全部排在紅隊之前，小隊順序即 `f` | ✓ 完全相同的序列 |
| `z` | `entry.along × entryRange + entry.gap` | 同一條式子，`entry` 改由 `FlightPlan` 取 | ✓ 逐字 |
| `orientation` / `velocity` | 由 `entry.heading` / `entry.speed` | 同上 | ✓ 逐字 |
| `leadX` | `(f − (n−1)/2) × schwarmSpacing + across × lateralOffset` | `lane × schwarmSpacing + across × lateralOffset`，而 `lane = f − (n−1)/2` | ✓ 同一個浮點運算序列 |
| `leadY` | `altitude + climb + altitudeOffset(f, spread)` | `altitude + climb + altitudeOffset(tier, spread)`，而 `tier = f` | ✓ 逐字 |
| 小隊內的位置 | `STATION_REFERENCE[k]` / `STATION_OFFSETS[k]`，`k` 是槽位序 | 同上，`k` 是 `members` 的索引 | ✓ 逐字 |
| 最後一個不滿的小隊 | 內層 `while slot < count` 提早停 | `members.length` 就是 `size` | ✓ 相同架數、相同 `k` |
| 玩家 | `slot === floor(blueFlights/2) × SCHWARM_SIZE` | `player === true && k === 0` | ✓ 同一架 |

**`lane` 為小數是正常的**：四個小隊時是 `±0.5`、`±1.5`。乘法的順序也刻意
維持「先乘 `schwarmSpacing` 再加 `lateral`」，浮點加法不可交換。

### 4.2 `applyFeel` 的物件識別：每陣營一張表

改動前 `applyFeel(base, feelFor(base))` **一側算一次**，所以同一側的 20 架共用
同一個 spec 物件。逐小隊算的話同隊會變成好幾個物件。

**做法：在 `createBattle` 內用「每陣營一張 `Map<AircraftSpec, AircraftSpec>`」
依 base 記憶。** 這與改動前完全一致：同隊同機種共用一份、兩隊各自一份。

【為什麼不是全場一張】第一版寫的是全場一張，理由是「數值相同，只差
`ceilings` 少算一次」。**Codex 2026-08-21 指出那個理由不完整** —— 依
`AircraftSpec` 物件識別的快取有三個，不只一個：

```
  setup.ts       Map<AircraftSpec, number>             serviceCeiling
  envelope.ts    WeakMap<AircraftSpec, Float64Array>   最佳迴旋表
  doctrine.ts    WeakMap<AircraftSpec, Float64Array>   持續迴旋率表
```

後兩者都在 **AI 更新路徑**上，而 `doctrine.ts` 自己的註解記載：逐格惰性填
會讓 AI 步的 p999 由 217 µs 惡化到 3.8 ms。鏡像對戰共用一張表雖然數值相同，
卻是一個沒有必要冒的啟動成本與 perf gate 變動。

**每陣營一張之後，這一輪沒有任何一處對改動前不等價。**

---

## 5. `createFlights` 必須跟著改

### 5.1 缺陷是既有的，只是今天碰巧不會發作

`battle/flights.ts` 的 `createFlights` **自己照連續索引每 `SCHWARM_SIZE` 個切
一隊**：

```ts
for (let s = 0; s < ids.length; s += SCHWARM_SIZE) {
  const roster = ids.slice(s, s + SCHWARM_SIZE)
```

也就是說**分組被算了兩次**：`createBattle` 生成時算一次、`createFlights` 又
獨立算一次。今天兩者碰巧一致（都是連續每 4 個）。

編組表一旦允許「6 架轟炸機切成 4 + 2 但排在 4 架戰鬥機後面」或「3 機小隊」，
兩邊就會切出不同的分組。**症狀是編隊飛行的僚機認錯長機，而且不會有任何錯誤**
—— 這正是這個專案反覆踩到的那一類：兩份長得很像的幾何，只有一份會被修好。

### 5.2 做法：多一個選擇性參數

```ts
export function createFlights(
  all: readonly FlightMember[],
  pinned = -1,
  /**
   * 每個小隊的架數，**依 `all` 的索引順序**。總和必須等於 `all.length`，
   * 而且每一段必須同隊（兩者都斷言）。
   *
   * 【省略時退回每 SCHWARM_SIZE 個切一隊】那是「全員都是標準四機小隊」的
   * 意思，`test/unit/battle-flights.test.ts` 的 22 處呼叫全部走這一條，
   * 一個字都不用改。**正式路徑（`createBattle`）一律明寫。**
   */
  sizes?: readonly number[],
): FlightIndex
```

`pinned` 排在第二個是既有簽名，不動它 —— 22 處測試與 `takeover.test.ts` 都
按位置傳。

### 5.3 為什麼不是把 `createFlights` 併進 `createBattle`

它是純函數，而 `battle-flights.test.ts` 有 22 條測試直接餵它假的 roster ——
那是這個專案「吃快照才能單元測試」的一貫作風。併進去等於把那 22 條測試改成
要先建一個世界。

---

## 6. `createBattle` 的新迴圈

```
players = 0
specs   = new Map<AircraftSpec, AircraftSpec>()      // base → 套過手感的
sizes   = []

assertOrderOfBattle(cfg.units)          // §6.1 的四條，一次全檢

for u of cfg.units:
    z           = u.entry.along × entryRange + u.entry.gap
    orientation = quat(UP, u.entry.heading)
    velocity    = FWD · orientation × (tas × u.entry.speed)
    leadX       = u.lane × schwarmSpacing + u.entry.across × lateralOffset
    leadY       = altitude + u.entry.climb + altitudeOffset(u.tier, altitudeSpread)

    made = []
    for k, member of u.members:
        // 【手感係數逐「機種」記憶，不是逐小隊】見 §4.2。
        // 混編小隊裡兩種機各查各的，所以這一行在內層
        spec = specs.get(member) ?? applyFeel(member, feelFor(member))
        ref  = STATION_REFERENCE[k]
        位置 = ref < 0 ? (leadX, leadY, z) : stationPoint(made[ref], STATION_OFFSETS[k])
        isPlayer = u.player === true && k === 0
        …world.add…
    sizes.push(u.members.length)

flights = createFlights(world.combatants, player.index, sizes)
```

### 6.1 要斷言的前提

| 斷言 | 為什麼 |
| --- | --- |
| 恰好一筆 `player: true` | 0 筆 → 現行的 `throw new Error('玩家沒有被建立')`；2 筆 → 玩家的控制器同時裝在兩個座位上，其中一個永遠收不到輸入（`resetBattle` 註解記過同一個症狀） |
| `1 ≤ members.length ≤ SCHWARM_SIZE` | `STATION_OFFSETS` 只有四個槽，超出會 `undefined` 當場炸；0 架則是一個沒有長機的小隊 |
| 藍隊的小隊全部排在紅隊之前 | `createFlights` 依隊別分段，交錯的表會切出跨隊的小隊。**斷言而不是排序** —— 自動排序會讓 `world.add` 的順序與表面上的順序不一致，而索引順序決定 AI 決策相位、名字指派、砲塔錯開 |
| 至少一筆 blue、至少一筆 red | 空的一隊會讓 `pilotNames(…, factionOf(red[0]…))` 讀到 `undefined` |

**這些是 `createBattle` 開頭的一支 `assertOrderOfBattle(units)`**，不是散在
迴圈裡的 if —— 半條路生出來的世界比當場拋錯難查得多。

---

## 7. 這些東西為什麼不受影響

| 東西 | 為什麼不動 |
| --- | --- |
| `resetBattle` | 讀的是每架自己記下的 spawn 資料，見 §2.4 |
| `ui/menu.ts` | 走 `SkirmishSetup`，不碰 `BattleConfig` |
| 指揮層 / `AiController` 接線 / `TargetBoard` | 全部掃 `world.combatants`，與生成方式無關 |
| `MIN_SIDE` / `MAX_SIDE` 夾制 | 留在 `skirmish.ts` 的 `clampSide`，夾的是餵給 `lineAbreast` 的架數 |
| `MissionCard` / `missionRules` | 一個字不動；`missionConfigFrom` 只改「組出 `units`」那一行 |
| `specs/feel.ts` 的 `feelFor` | 逐機種查表，本來就與隊伍無關 |

### 7.1 一個已知的、這一輪不修的既有限制

`pilotNames(seed, factionOf(blue[0]!.aircraft.spec.id), blue.length)` 取**該隊
第一架**的機種來決定名字用哪一國。混編之後若一隊裡有兩個陣營的機種，名字會
全部跟第一架走。

護送／攔截兩張卡的混編都是**同陣營**（P-51 + B-17 都是同盟國、Bf109 + He 111
都是軸心國），所以下一輪也不會踩到。**記進 `docs/backlog.md`**，等真的出現
跨陣營混編再處理。

---

## 8. 驗收

### 8.1 主判準：出生表逐位元 + 重播高可信

分成強度不同的兩半，**而且刻意講清楚哪一半是哪一種**。

**一、出生表與編制表 —— 真的逐位元。** 逐架把位置、姿態、速度、`prev*`、
出生點、`spawnTas` / `spawnAltitude`、是不是玩家寫成一行字串，加上每個小隊的
成員索引與玩家座位，存進 `test/fixtures/spawn-baseline.ts`。

`String(number)` 對有限值是**可逆的最短表示**，所以字串相等就是位元相等 ——
唯一的例外是**負零**（`String(-0)` 是 `'0'`，轉回去變 `+0`），由 `num()` 特判。

**這一半正好涵蓋這個重構會弄壞的東西**：生成幾何、生成順序、小隊分組、
玩家的位置。

**二、30 秒重播 —— SHA-256 的高可信校驗。** 涵蓋飛機的完整運動狀態與作動器
`surfaces`、血量、射速時鐘、砲塔狀態、全部彈丸與環狀游標、`damageTime`、
指派板、編制壓縮結果、任務狀態與勝負。

**不涵蓋** `AiController` 的決策計時器與延遲佇列、`FlightDirector` 的 PID
積分、`World` 的事件緩衝區 —— 那些是 private，要讀就得在四個生產檔各開一個
replay snapshot 方法，而這一輪一個字都沒碰那四個檔（Codex 複審 2026-08-21
建議補完，**專案負責人裁定不補**，理由與這條記在這裡）。

**為什麼仍然守得住**：隱藏狀態分岔不會沉默。AI 讀位置、寫控制面，控制面改變
位置，而這條回饋迴路每秒跑 240 次 —— 一個分岔的決策計時器會改變決策時刻、
改變控制輸入、改變位置。30 秒之後位置仍然一模一樣，幾乎不可能來自一個真的
分岔了的世界。

**兩個場景**：`HEADON_20V20`（P-51 vs Bf109，非鏡像）與 `PURSUIT_MIRROR_8V8`
（P-51 vs P-51，鏡像）。後者專門守 §4.2 的每陣營記憶化。

**基準必須先落地**：`test/tools/spawn-baseline.probe.ts` 在動任何
`setup.ts` / `flights.ts` **之前**跑一次、commit 進 repo。重構之後就跑不出
改動前的那一份了。

### 8.2 副判準：既有護欄的數字不准動

下列測試量的是 AI 行為與戰局統計，對生成幾何極度敏感 —— 它們全綠**而且
數字不變**才算過：

```
  test/integration/multi-battle.test.ts        20v20 的統計
  test/integration/rematch.test.ts             再打一場（單獨跑）
  test/integration/ai-command-decision.test.ts 覆寫 entryRange / altitudeSpread
  test/integration/ai-targeting.test.ts        指派板
  test/integration/mission-evacuate.test.ts    pursuit 擺法
  test/unit/battle-setup.test.ts               生成幾何本身
  test/unit/battle-flights.test.ts             小隊分組（22 條）
```

既有的三條紅測試（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）維持紅，
**數量不准增加**。

### 8.3 新增的單元測試

| 測試 | 判準 |
| --- | --- |
| `lineAbreast` 的 `lane` | 5 個小隊給 `−2 … +2`、4 個給 `±0.5 / ±1.5`、1 個給 `0` |
| `lineAbreast` 的 `tier` | 等於小隊序號 |
| `lineAbreast` 的最後一隊 | `count = 6` → `[4, 2]`；`count = 1` → `[1]` |
| `lineAbreast` 的玩家 | `blueCount` 20 → 第 2 隊、**6 → 第 1 隊**、1 → 第 0 隊，且恰好一筆。（6 那一格原本寫 0，Codex 2026-08-21 實測糾正：`floor(ceil(6/4)/2) = 1`）|
| `lineAbreast` 的順序 | 全部 blue 在全部 red 之前 |
| `assertOrderOfBattle` | §6.1 的四條各一個反例，各自拋出可辨識的訊息 |
| `createFlights` 吃 `sizes` | `[4,2,4]` 切出三隊；總和不符、跨隊各拋一次 |
| `createFlights` 省略 `sizes` | 與改動前逐條相同（既有 22 條測試不動就是這條的證明） |

### 8.4 人工驗收

跑一次遊戲，確認開局畫面與改動前一樣（兩隊橫隊、玩家在藍隊正中央）。
**這一輪沒有新的視覺，所以「看起來一樣」就是通過。**

---

## 9. 動到的檔案

| 檔案 | 改什麼 |
| --- | --- |
| `src/battle/order.ts` | **新檔**：`FlightPlan`、`OrderOfBattle`、`lineAbreast`、`assertOrderOfBattle` |
| `src/battle/setup.ts` | `BattleConfig` 拿掉五個欄位、加 `units`；`DEFAULT_BATTLE` 改用 `lineAbreast`；`createBattle` 的雙層迴圈換成掃表；`applyFeel` 記憶化 |
| `src/battle/flights.ts` | `createFlights` 多一個選擇性的 `sizes` |
| `src/battle/skirmish.ts` | `battleConfigFrom` 改組 `units`（夾制不動） |
| `src/battle/missions.ts` | `missionConfigFrom` 改組 `units` |
| `src/main.ts` | 除錯行改成掃表印出各機種架數 |
| `docs/backlog.md` | 記 §7.1 的名字限制 |
| 19 支測試／探針 | 機械式替換成 `units: lineAbreast(...)` |
| `test/integration/order-of-battle-replay.test.ts` | **新增** |
| `test/tools/spawn-snapshot.ts` | **新增**：共用的快照函數，沒有頂層執行碼 |
| `test/tools/spawn-baseline.probe.ts` | **新增**：只負責印，重構前跑一次 |
| `test/fixtures/spawn-baseline.ts` | **新增**：凍結的基準 |
| `src/world/Projectiles.ts` | 加一個唯讀的 `writeCursor` getter（`cursor` 維持 private） |
| `test/unit/battle-order.test.ts` | **新增**，§8.3 的那幾條 |

---

## 10. 風險

| 風險 | 對策 |
| --- | --- |
| 130 處機械式替換打錯一處，而那一處是某條護欄的基準 | 型別會擋掉大部分（五個欄位刪掉之後舊寫法直接編不過）。剩下的靠 §8.2「數字不變」 |
| 逐位元基準本身抓錯（例如少抓了一個欄位） | 基準探針同時輸出**筆數**與**校驗和**；重播測試先斷言筆數，再逐位元比 |
| `applyFeel` 記憶化改變了鏡像對戰的行為 | 改成**每陣營一張表**之後不存在（§4.2）。鏡像對戰的重播場景仍然保留 —— 它現在守的是「真的完全一致」而不是「差異可接受」 |
| `lane` 的浮點：`f − (n−1)/2` 先算再乘，與改動前的括號順序不同 | 刻意保持**同一個算式**：`lineAbreast` 算出的 `lane` 就是 `f − (n−1)/2` 這個 `number`，`createBattle` 再乘 `schwarmSpacing`。改動前是 `(f − (n−1)/2) × schwarmSpacing` —— 同一個中間值、同一次乘法 |
| 小隊順序斷言太嚴，擋掉日後合理的表 | 只斷言「藍全部在紅之前」，不管小隊之間的順序。真的需要交錯時再改 `createFlights` 的分段邏輯，那時是一個有意識的決定 |

---

## 11. 起始值一覽

**這一輪沒有任何新的起始值。** 所有幾何常數（`entryRange` 10,000、
`schwarmSpacing` 800、`lateralOffset` 1,500、`altitudeSpread` 300、
`altitude` 4,000、`tas` 200）逐值沿用，這正是「逐位元不變」的意思。
