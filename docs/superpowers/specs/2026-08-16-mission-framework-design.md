# 任務框架 設計文件

**狀態**：設計已由專案負責人核可（2026-08-16），實作中。

---

## 1. 問題

`src/ui/missions.ts` 有 10 張任務卡，**全部不可點**。該檔案的檔頭寫著：

> 【M10 全部不可點】這裡只有資料與文案，沒有任何行為。

這是「沙盒」與「遊戲」的分界線。現在打完一場沒有目標、沒有下一關 —— 遭遇戰只有一種
勝負條件，而且是寫死的兩行：

```ts
// src/battle/setup.ts:689-690
if (aliveCount(b.red) === 0) b.outcome = 'victory'
else if (aliveCount(b.blue) === 0) b.outcome = 'defeat'
```

M10 已經把介面留好了（M10 spec §15）：`BattleConfig` 吃雙方機種與雙方架數、
`nextScreen` 只差一條轉移、結算畫面與記分板都在。**這一輪要長出來的只有一件事：
勝負條件不再是「誰全滅」。** 其餘都是接線。

---

## 2. 目標

1. 四張任務卡真的可以點、可以打：**殲滅**與**撤離**，各兩個陣營。
2. 勝負條件成為一個可替換的東西，而不是 `stepBattle` 裡的兩行。
3. 判定與 HUD 顯示**同源** —— 不可能出現「畫面說剩 3 架，卻突然贏了」。
4. 遭遇戰的行為**逐字不變**，全套既有護欄的數字不得移動。

---

## 3. 不做的事

| 項目 | 為什麼 |
|---|---|
| 攔截、護航 | 需要第三種機體（轟炸機／運輸機）—— 那是另一整份 spec |
| 打擊 | 需要對地武器 + 地面目標，兩者都不存在（`grep bomb\|rocket` 零結果） |
| 解鎖／存檔／進度 | 專案目前沒有任何持久化。四張卡一律可點 |
| 難度選單 | 星等是**那張卡的配置的標籤**，不是玩家的選項。`DifficultyProfile` 一貫不碰 |
| 僚機一起撤離 | 需要「任務強制命令」的通道打進指揮層，而指揮層目前有兩條未裁定的紅護欄（`docs/backlog.md` §1）。專案負責人裁定：**只要玩家到** |
| 地形 | 只有海。撤離點就在海上 |

---

## 4. 三個做法與取捨

### 4.1 甲：每種任務一個判定純函數

```ts
type MissionCheck = (b: Battle, elapsed: number) => Outcome
```

- 抽象最少，判定就是一段讀得懂的程式碼。
- **否決的理由**：HUD 要顯示進度時，函數只回勝負，進度得**另外算一次** ——
  兩份邏輯會漂移。玩家看到「剩 12 架」卻突然贏了，是這一輪最糟的 bug。

### 4.2 乙：目標清單（Objective 資料 + 通用求值器）

```ts
interface Objective { kind: 'destroyAll' | 'reachPoint' | 'timeLimit'; progress: number; done: boolean }
```

- HUD 直接讀進度，一份來源。加任務類型 = 加一個 kind。
- **否決的理由**：現在只有兩種任務、三種條件，這個資料結構是替**想像中的第五種
  任務**蓋的 —— 而那些任務還缺機體與武器，規格根本還沒定。而且「全達成才贏／
  任一失敗就輸」的組合律要另外定義、另外測。

### 4.3 丙：判定與顯示同源的一次求值 —— **採用**

一次呼叫同時寫出判定與顯示，HUD 與 3D 圓環都讀同一個 `out`。

- **不可能漂移** —— 這一輪唯一真正的新風險，從結構上消掉。
- 不替不存在的任務蓋抽象。
- 這正是專案的既有慣例：`steerCommand(..., out)` 就地寫回、`HudFrame` 本來就是
  一個大的聯集式快照、`CommandUnit` 是指揮層讀的最小快照。
- 代價：`MissionState` 有些欄位對某些任務無意義（殲滅的 `target` 是 null）。
- **真要走到乙，`stepMission` 的內部換成求值器，簽章不用動。**

---

## 5. 核心決定：遭遇戰就是「一個沒有時限的殲滅任務」

`BattleConfig` 多一個 `rules` 欄位，`DEFAULT_BATTLE` 給 `{ kind: 'annihilate' }`，
§1 那兩行搬進 `stepMission`。

**理由是專案自己的紀律**，M10 spec §5.3 的原話：

> 種類沒變也重建 —— 那條路徑因此每一場都在走，不是一條等著被第一次使用的死碼。

遭遇戰每一場都在跑任務判定，所以任務判定不可能悄悄壞掉。反過來，若任務判定是
一條只有任務模式才走的旁路，它會在沒有人注意的時候腐爛。

**代價**：`annihilate` 的判定必須**逐字**等於現況，否則現有護欄會集體移動。
由 §9.4 的回歸比較守住。

---

## 6. 撤離的幾何

### 6.1 撤離點放在敵人後方

開局是既有的對頭（`setup.ts` 的 `createBattle`）：藍隊在 `z = +entryRange/2`、
紅隊在 `z = −entryRange/2`、藍隊機首朝 −Z。

**撤離點放在紅隊後方**（`z ≈ −20,000`）。所以玩家必須**穿過敵機陣列**才逃得出去。

【為什麼不放在玩家背後】那樣的話最佳打法是開局轉頭直線飛、完全不打 ——
5 星任務會變成一場無聊的直線飛行。放在前方讓「且戰且走」「撤出包圍」這兩張卡的
文案**真的成立**，而且**不需要任何新的生成程式碼**，只是一個座標。

【為什麼不需要額外機制擋退化】對頭接近之後玩家已經在敵陣後方，敵機必須反轉追擊
—— 玩家天然有一段領先。難度來自數量劣勢與時限，不是來自一道人工圍籬。

### 6.2 高度

撤離點的 Y 取 `BattleConfig.altitude`（預設 4,000 m），不寫死 —— 高度設定改了，
撤離點自動跟上。

### 6.3 判定是球形，圓環是那顆球的輪廓

判定：`playerPos.distanceTo(point) < radius`。

視覺：一個**永遠正對相機的 billboard 圓環**，半徑就是 `radius`。

【為什麼是 billboard 而不是固定朝向的環面】billboard 圓環**就是那顆球的輪廓** ——
所以「你看到的那個圈 = 判定範圍」從**任何角度**都逐字成立。固定朝向的環面從側面
看是一條線，玩家會遇到「我明明穿過去了卻沒算到」，而那種 bug 沒有辦法從畫面上
自我解釋。

### 6.4 可見性已驗證

| 量 | 值 | 出處 |
|---|---|---|
| 20 km 處的霧遮蔽 | 7.5% | `fogFactor(20000, 1.4e-5)` |
| 15 km 處的霧遮蔽 | 4.3% | 同上 |
| 相機遠平面 | 5,000 km | `render/scene.ts` 的 `CAMERA_FAR` |
| 半徑 1 km 的環在 20 km 外 | 佔螢幕高度 8.8% | `2·atan(1000/20000) / 65°` |
| 同上，在 15 km 外 | 11.7% | 同上 |

**沒有戰場邊界或 leash** —— `grep -rn "BOUND\|boundary\|leash"` 於 `world/`、
`battle/`、`ai/` 零結果。飛到 −20 km 不會被任何機制攔下。遠海與網格都跟著玩家
位置捲動（`terrain.update(elapsed, x, z)`）。

---

## 7. 介面

### 7.1 `src/battle/mission.ts`（新檔，純函數）

```ts
export type MissionRules =
  | { kind: 'annihilate' }
  | { kind: 'evacuate'; point: Vector3; radius: number; seconds: number }

/**
 * `stepMission` 讀的快照。就地重填，不配置。
 *
 * 【為什麼不直接吃 `Battle`】與 `CommandUnit`、`SteerConfig` 同一套手法：
 * 吃快照才能單元測試而不用建一個世界出來。
 */
export interface MissionInputs {
  aliveBlue: number
  aliveRed: number
  /** 玩家目前那一架的位置 */
  playerPos: Vector3
  /**
   * 玩家那一架還活著嗎。
   *
   * 【為什麼一定要有】接手有 2 秒延遲（`TAKEOVER_DELAY`），那段期間 `b.player`
   * 仍然指著**已經退場的那一架**，而它的位置停在墜落點。少了這個旗標，
   * 「玩家死在圓環裡、僚機還活著」會判成撤離成功。
   */
  playerAlive: boolean
}

export interface MissionState {
  outcome: Outcome
  /** 撤離點。`hasTarget` 為 false 時無意義 */
  readonly target: Vector3
  hasTarget: boolean
  /** 抵達半徑，m。也就是圓環的半徑 */
  targetRadius: number
  /** 剩餘秒數。無時限時是 `Infinity` */
  secondsLeft: number
  /** HUD 的計量。殲滅＝剩餘敵機數，撤離＝到撤離點的距離 m */
  metric: number
}

export function createMissionState(rules: MissionRules): MissionState
export function resetMissionState(rules: MissionRules, out: MissionState): void
export function stepMission(
  rules: MissionRules, inp: MissionInputs, dt: number, out: MissionState,
): void
```

**目標文字不進 `MissionState`** —— 它是常數，放在卡片上。`stepMission` 每個物理步
跑 240 次，在裡面組字串等於每秒配置 240 個字串。

### 7.2 判定表

| rules | victory | defeat | metric |
|---|---|---|---|
| `annihilate` | `aliveRed === 0` | `aliveBlue === 0` | `aliveRed` |
| `evacuate` | `playerAlive && dist < radius` | `aliveBlue === 0` 或 `secondsLeft <= 0` | `dist` |

**優先序**：`outcome !== 'fighting'` 時直接回，不再改任何欄位 —— 一場只判一次，
與 `stepBattle` 現況的 `if (b.outcome !== 'fighting') return` 一致。

`victory` 先於 `defeat`：同一步同時滿足時算贏（飛進圓環的那一步剛好時限歸零，
判贏才符合玩家的認知）。

### 7.3 `src/battle/missions.ts`（由 `src/ui/missions.ts` 搬過來）

它不再只是文案，是**關卡資料** —— 所以離開 `ui/`。

```ts
export interface MissionCard {
  id: string
  title: string
  type: MissionType
  /** 1~5 星。這一張卡的配置的標籤，不是玩家的選項 */
  difficulty: number
  summary: string
  /** HUD 上的目標文字，例如「飛抵撤離點」 */
  objective: string
  /** 這一關的編制 */
  blueCount: number
  redCount: number
  /** 撤離點在 −Z 多遠，m。非撤離任務為 0 */
  evacDistance: number
  /** 抵達半徑，m。非撤離任務為 0 */
  evacRadius: number
  /** 時限，秒。無時限為 `Infinity` */
  seconds: number
  /** 這一張卡做了沒有。false 的卡在選單上維持 disabled */
  playable: boolean
}

export function missionRules(card: MissionCard, altitude: number): MissionRules
export function missionConfigFrom(card: MissionCard, faction: FactionChoice): BattleConfig
```

`missionConfigFrom` 與 `battleConfigFrom`（`skirmish.ts`）對稱：**兩者都是「設定 →
`BattleConfig`」的唯一入口**，難度 `VETERAN` 也在這裡套（理由見 `setup.ts` 的
`aiProfile` 註解）。

### 7.4 `BattleConfig` / `Battle`

```ts
// BattleConfig 新欄位
rules: MissionRules   // DEFAULT_BATTLE 給 { kind: 'annihilate' }

// Battle 新欄位
readonly mission: MissionState
```

`stepBattle` 的改動：

```ts
if (b.outcome !== 'fighting') return
fillMissionInputs(b, MISSION_INPUTS)          // 就地重填，不配置
stepMission(b.cfg.rules, MISSION_INPUTS, dt, b.mission)
b.outcome = b.mission.outcome
```

【`Battle.outcome` 與 `MissionState.outcome` 誰是權威】**`MissionState` 是權威**，
`Battle.outcome` 是它的複本。不刪掉 `Battle.outcome` 的理由：`main.ts`、
`scoreboard`、Playwright 判準與五支既有測試都讀它，改成處處讀 `b.mission.outcome`
是一次與這一輪無關的擴散性修改。

`resetBattle` 尾端加 `resetMissionState(b.cfg.rules, b.mission)`。

### 7.5 `HudFrame` 新欄位

```ts
/** 任務目標。false 時整組無意義（遭遇戰不顯示目標列） */
objectiveActive: boolean
/** 目標文字。逐幀指派**同一個**字串參考，不組字串 */
objectiveText: string
/** 計量。殲滅＝剩餘敵機數，撤離＝到撤離點的距離 m */
objectiveMetric: number
/** 計量的種類，決定 widget 怎麼格式化 */
objectiveMetricKind: 'count' | 'distance'
/** 剩餘秒數。`Infinity` 時不畫倒數 */
objectiveSeconds: number
/** 撤離點的世界平面座標，供小地圖。`objectiveHasTarget` 為 false 時無意義 */
objectiveHasTarget: boolean
objectiveWorldX: number
objectiveWorldZ: number
```

【為什麼 `objectiveActive` 由 `main.ts` 給而不是由 rules 推導】遭遇戰與殲滅任務的
`rules` **完全相同**（§5），差別只在「這一場是不是從任務列表進來的」—— 那是畫面
模式，不是規則。

### 7.6 `src/render/objectiveRing.ts`（新檔）

```ts
export interface ObjectiveRing {
  readonly object: Object3D
  /** 每幀更新：位置、半徑、朝向相機 */
  update(center: Vector3, radius: number, camera: Camera): void
  setVisible(v: boolean): void
  dispose(): void
}
export function createObjectiveRing(): ObjectiveRing
```

生命週期比照 `terrain`：**每一場都重建**（`enterBattle` 拆掉舊的、建新的），
那條路徑因此每一場都在走。

### 7.7 `src/hud/widgets/objective.ts`（新 widget）

畫面上緣一列：目標文字、計量、倒數（`Infinity` 時不畫）。

撤離點在小地圖上：復用 `minimap.ts` 既有的 `edgeClamp` —— 撤離點在 4 km 之外時
貼邊，之內時畫實際位置。**不新增幾何原語。**

### 7.8 畫面與選單

| 檔案 | 改動 |
|---|---|
| `src/ui/screens.ts` | `mission` 加 `fight: 'battle'`；`battle` 加 `toMission: 'mission'`；`ScreenEvent` 加 `'toMission'` |
| `src/ui/menu.ts` | `playable` 的卡可點（送出 `onMission(card)` 再送 `fight`），其餘維持 `disabled`；`MenuHooks` 加 `onMission` |
| `index.html` | `#board-actions` 加第二顆返回鈕 `data-act="toMission"`（「回任務列表」），與既有的 `toSetup` 依模式擇一顯示 |
| `src/main.ts` | `mode: 'skirmish' \| 'mission'`、`pendingMission`、`enterBattle` 分流、圓環的建立與拆除、結算兩顆按鈕的顯示 |

【為什麼結算是加一顆按鈕而不是改 `data-act`】`data-act` 是選單那一層唯一的協定
（`menu.ts` 的事件委派註解）。逐幀改它等於讓一個 DOM 屬性變成隱性狀態；多一顆
按鈕、切 `hidden`，是宣告式的。

---

## 8. 起始值（**全部待實測掃描**）

專案紀律：起始值不是定值。這一節的每一格都要在實作的最後一個 Task 掃描並回填。

| 量 | 起始值 | 推導 / 掃描要回答的問題 |
|---|---|---|
| 撤離點 z | −20,000 m | 太近 → 不用打就到；太遠 → 時限不可能達成 |
| 抵達半徑 | 1,000 m | 就是圓環半徑。§6.4 已驗 20 km 外佔螢幕 8.8% |
| 撤離時限 | 240 s | 玩家起點 z≈+5,000，直線 25 km。巡航 200 m/s → 125 s；纏鬥速度 100~130 m/s → 190~250 s。**設計討論時我給的是 180 s，把算式攤開才發現它落在下緣** |
| 撤離 藍/紅 | 4 / 16 | 5 星的數量劣勢 |
| 殲滅 藍/紅 | 8 / 6 | 2 星 |

---

## 9. 測試策略

### 9.1 單元：`stepMission` 純函數

- `annihilate` 三態，**逐字**等於 §1 那兩行。
- `evacuate`：抵達、超時、我方全滅。
- `secondsLeft = Infinity` 不會被 `dt` 吃掉（`Infinity - dt === Infinity`，但要有
  測試釘住，否則哪天改成計時器就靜靜壞掉）。
- `playerPos` 含 `NaN` 時不得誤判 victory —— `NaN < radius` 是 false，所以現況
  安全，但這是**要被釘住的安全**（前例：`sweetYield` 的 `Number.isFinite` 守衛
  就是 Codex 在審查時抓出來的）。
- **`playerAlive === false` 且玩家的最後位置在圓環內、但還有僚機活著 → 不得判
  victory。** 這是接手延遲那 2 秒的邊角（§7.1）。
- `outcome !== 'fighting'` 之後再呼叫，不得改任何欄位。

### 9.2 同源護欄 ★

**選項丙的核心保證，這一條紅了就代表 HUD 會騙人。**

以性質而非單點斷言：掃一組玩家位置與存活數，斷言

```
evacuate:   (out.metric < radius)  ⟺  (out.outcome === 'victory')
annihilate: (out.metric === 0)     ⟺  (out.outcome === 'victory')
```

（前提：`aliveBlue > 0` 且 `secondsLeft > 0`。）

### 9.3 整合

- headless 跑一場撤離，腳本控制器直飛撤離點 → `outcome === 'victory'`，
  且 `secondsLeft > 0`。
- 同一場，控制器原地盤旋 → `secondsLeft` 歸零 → `outcome === 'defeat'`。
- **消融**：把 `seconds` 設成 `Infinity`，第二條必須不再成立 —— 讓「時限真的
  生效」可證偽。

### 9.4 回歸 ★

**遭遇戰全套護欄的數字必須逐字不動。** §5 的代價由這一條守。

作法：改動前跑全套並存下結果，改動後逐條比較。基準是本輪開始時的
main（`b4ddff8`）：2506 綠 / 3 紅（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1，
均為 `docs/backlog.md` §1 待裁定），外加 `perf-gate` 在平行負載下的偽紅。

### 9.5 畫面狀態機

`mission → fight → battle → toMission → mission` 走得通；不合法的組合回傳 `current`。

### 9.6 Playwright

- 從主選單點進任務列表，四張卡可點、三張 disabled。
- 點「且戰且走」進戰鬥，HUD 出現目標列。
- 圓環畫得出來（截圖判準）。
- 結算的「回任務列表」回得去。

---

## 10. 已知未解（進 `docs/backlog.md`）

1. **僚機不會撤離。** 專案負責人裁定「只要玩家到」（§3）。要做「把每一架帶回去」
   得先有任務強制命令的通道，而指揮層有兩條未裁定的紅護欄。
2. **敵方 AI 的追擊沒有為撤離調整。** 它照既有的目標選擇打，沒有「攔截逃跑者」
   的行為。掃描時要確認這不會讓 5 星變成散步。
3. **三張卡仍然不可點**（攔截、護航、打擊）—— 缺機體與對地武器。
4. **§8 全部是起始值。**

---

## 11. 交付紀錄

（實作完成後回填：掃描結果、回歸比較、Codex 審查發現、試飛驗收。）
