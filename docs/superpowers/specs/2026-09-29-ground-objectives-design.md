# 地上的飛機是地面目標；主要目標標距離

## §1 問題

### 1.1 幽靈防禦（德 M3）

P-51 一開始滑行就從停機墊（`GroundTarget`）變成空中那一池的 `Combatant`，帶著
`takeoff` 滑行、滾行、離地。它於是在滑行期間就進了 AI 的索敵、威脅與 HUD 的空中
接觸點：

- 德 M3 無頭 150 秒：Bf 109 進入防禦 24 次，**21 次的觸發者是還在地上滑行的 P-51**
  （8 m/s、高 2 m、114～899 m）；防禦總步數的 68% 是幽靈。滾行中的飛機不能開火
  （`World.step` 在 `takeoff !== null` 時把 `firing` 設成 false）。
- 為了打滑行中的飛機，AI 有一整批專用程式：`groundedAircraftTarget`、
  `pickPriorityGroundAircraft`、`priorityAirIndex`、`groundedAircraftAttackCommand`。
- HUD 對它畫目標框與預瞄環，和空中的飛機一樣。

### 1.2 主要目標看不出距離

地面目標與船在 HUD 上只有倒三角（`hud/widgets/markers.ts`），沒有距離；空中接觸點
才有框下的 `0.9 km`。玩家找不到最近的任務目標要多遠。

## §2 規則（負責人裁定）

1. **在地上就是地面目標，離地才是飛機。** 滑行、排隊、滾行都是地面目標；離地那一刻
   才在空中那一池上場。
2. **地上的 P-51 與天上的一樣**：血量 1,000、部位與防護力（座艙、引擎…的倍率）。
   **停機墊上的也一樣**（德 M3 的 12 架由 250 變 1,000）。離地時**已受的傷帶過去**。
3. **打中任何地面目標或船都有命中 X**（`hitsDealt`）。
4. **炸毀計數不分地上天上**：目標是摧毀那幾架 P-51，在哪裡被打掉都算一次。
5. **主要目標**的倒三角上方顯示距離（格式同接觸點：`0.8 km`），一般地面物件（防空）
   不顯示。
6. 滑行慢，提前量不是重點；但滾行末段到 50 m/s，地面目標的 `speed` 照寫（AI 既有的
   提前量公式讀它，幾乎免費）。

## §3 設計

### 3.1 地面目標可以滑行

`GroundTarget` 多兩格：

| 欄位 | 意義 |
|---|---|
| `taxi: TakeoffRoll \| null` | 滑行中的腳本（沿用 `control/takeoffRoll.ts`）。null = 停著或已離場 |
| `airframe: AircraftSpec \| null` | 這一台是一架飛機：命中與傷害照飛機算（§3.2）。null = 一般地面物件 |

- **推進**：`World.step` 在推進移動地面目標的同一處（`stepGroundMotion` 那一圈），對
  `taxi !== null` 的跑 `stepTakeoff`，把姿態寫回：`position`（地面高度）、航向、`speed`
  （腳本速度的大小）。滾行段（`t > 0`）機身水平；停著與滑行時機尾下沉（與停放模型
  一致）。
- **離地**：腳本走到 `ROLL_SECONDS`（離地，50 m/s、機身水平）時由 `World` 交接：
  - `departedAs` 那一席 `alive = true`、`retired = false`，姿態、速度照腳本，
    **`prevPosition`／`prevOrientation` 設成同一個姿態**（等待期間它沒有更新，不設的話
    算繪會從出生點內插過來），`hp = 地面目標的 hp`，`takeoff = 同一個 roll`（繼續跑
    抬頭與初期爬升 3.5 s，與現在相同）；
  - 地面目標 `departed = true`、`alive = false`、`taxi = null`；
  - 推一筆離地事件（席位索引）。戰鬥層在 `world.step` 之後把**飛行員名冊**那一列設成
    活著 —— 名冊在出動時抄了 `alive = false`，不同步的話擊落它時擊墜、助攻都不記
    （`battle/pilots.ts` 的 `recordKill` 跳過死人）。
- **在地上被打掉**：`alive = false`（未 `departed`），那一席永遠不上場。
- `resetGroundTarget` 清 `taxi`，血量回 `airframe.hp`（有的話），否則照 `GROUND_HP`。
- **模型姿態**：停放模型把「繞 X 下沉 `PARKED_TAIL_DOWN`、再平移到底面貼 0 且前後置中」
  烘進幾何（`render/geometry/ground/parked.ts`）。烘焙記下那個平移；算繪在**滾行段**
  對模型套反向修正（放平、原點抬到 `GEAR_CLEARANCE`），停著與滑行照舊。

### 3.2 地上的飛機照飛機算傷害

`airframe !== null` 的地面目標：

- `hp` 初值 = `airframe.hp`；`value` 不變（`GROUND_VALUE`）。
- **子彈**：`resolveHits` 的地面目標那一段改走 `hitAircraft(airframe.hitBoxes, 原點, 姿態, …)`，
  傷害 = `damage × PART_MULTIPLIER[part] ÷ airframe.protection[part]` —— 與
  `World.applyDamage` 同一條式子（抽成一支共用函數，兩邊都呼叫）。
  - 停著／滑行：姿態 = 航向 × 繞 X 下沉 `PARKED_TAIL_DOWN`；機體原點 = 腳印中心 ＋
    航向 × 平移，平移用 `airframe.hitBoxes` 以同一個旋轉算（底面貼 0、前後置中），
    與模型的烘焙同一套作法，差距只有命中盒與網格的幾十公分。
  - 滾行：姿態 = 航向；原點 = 腳印中心 ＋ `GEAR_CLEARANCE`（與交接後的飛機相同）。
- **炸彈爆風、破片**：照現在的地面目標路徑（盒子距離），不改。
- 哪些地面單位是飛機：`parkedP51` → 這一場 P-51 的規格（**含手感**，與紅隊那一席同一份
  spec，`battle/setup.ts` 建場時填）。`parkedB17` 不在這次範圍。

### 3.3 等待離地的席位

出動的節拍（`reinforce`）照舊預留四席、照舊 `world.add`、掛 roster 與 AI。不同處：

- 對每一席挑一個**還停著**的停機墊（`alive && !departed && taxi === null`），在**停機墊**
  上建 `taxi`（起步時刻的排法不變），`departedAs = c.index`；
- 那一席 `alive = false`、`retired = true`（不在場上、不算陣亡）；離地時兩者都翻回來。
- 挑不到停機墊的席位照舊 `retired`。
- `parkedLeft`（地上還剩幾架，決定下一批來不來）數**還停著的**。
- 炸毀計數 `destroyedInPool` 不變：沒離場看自己 `alive`（停著或滑行中被打掉都算），
  離場了看那一架。

### 3.4 命中 X

`resolveHits` 打中地面目標或船時，owner 是飛機就 `hitsDealt++`（與打飛機同一格）。

### 3.5 主要目標

一支純函數判定，依**當下的**規則（`b.rules`，撤離節拍換掉規則之後主要目標就沒了）：

```
主要目標（船）   = rules.kind === 'sink' 且是敵艦
主要目標（地面） = rules.kind ∈ {destroy, interdict} 且在炸毀的池裡（inDestroyPool）
                   且不是防空（flakHeavy、flakLight、usFlakTrack、searchlight）
```

- 盟 M2 洛伊納：池裡有 12 座廠區構件與 48 座高砲 —— 只有廠區構件是主要目標。
- 德 M2 停放的 B-17、德 M3 的 P-51、日 M2 的卡車、擊沉關的敵艦照池子。

HUD：`HudMarker` 多 `objective`、`range`；`fillMarkers` 多收判定與量距離的基準點
（上帝視角是鏡頭，否則是自機 —— 與接觸點的 `refPos` 相同）；`drawMarkers` 對
`objective` 在三角形上方畫 `contactRangeLabel(range)`。

### 3.6 AI

滑行中的 P-51 已經是地面目標、單位是任務的優先單位 `parkedP51`，走一般的
`strafeGround`：

- 拿掉 `groundedAircraftTarget`、`pickPriorityGroundAircraft`、`priorityAirIndex`、
  `groundedAircraftAttackCommand` 與它們的呼叫點。
- 幽靈防禦不再存在：空中那一池裡沒有地上的飛機。

## §4 不做

- 停放的 B-17（德 M2）改成飛機的傷害模型。
- AI 依「主要目標」挑任務目標（轟炸機仍照價值挑）。
- 任何數值的重新定值（`GROUND_VALUE`、滑行速度、滾行時間都不動）。

## §5 驗收

單元／整合：

1. 地面目標滑行：沿腳本移動，`speed` 與腳本一致；到離地交接給那一席，姿態、速度連續，
   `hp` 帶過去。
2. 滑行中被打掉：計入炸毀，那一席永遠不上場、不推擊墜事件。
3. 停機墊上的 P-51：`hp` 1,000；打座艙比打翼傷得多（部位倍率生效）。
4. 下一批出動不會挑到已經在滑行的那一台。
5. 打中地面目標、打中船，`hitsDealt` 都加一。
6. 主要目標判定：盟 M2 廠區是、高砲不是；撤離規則之後都不是；HUD 標記帶 `objective` 與 `range`。
7. 滑行、滾行期間那一席不存活、不在名冊上存活 —— 空中那一池（威脅判斷、索敵）裡沒有地上的
   飛機；德 M3 的判勝照舊（停機墊上、滑行中、離地後打掉都算）。

既有測試要改寫的：`takeoff-roll.test.ts`「滾行中那一架」一節、`ai-ground-strafe.test.ts`
追滑行機的幾條、`campaigns.test.ts` 的離場計數。
