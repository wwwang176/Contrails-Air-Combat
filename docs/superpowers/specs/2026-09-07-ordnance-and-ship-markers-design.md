# 彈藥與艦船的 HUD 標記

2026-09-07

## 1. 要做的事

專案負責人的五條：

1. 炸彈、魚雷必須有標記
2. 船也要有標記
3. 標記是一個**倒三角形**
4. 同隊藍色、敵對紅色
5. **標記高度看該物體的高度**

## 2. 為什麼現在沒有

`hud/widgets/contacts.ts` 的目標框只吃 `HudFrame.contacts`，而
`main.ts` 只把 `world.combatants` 填進去 —— **飛機以外的東西一律沒有畫面
標示**。炸彈、魚雷、船在 HUD 上完全不存在，玩家只能靠 3D 模型本身找它們，
而那三種東西恰好都很難找：

| 物體 | 為什麼難找 |
|---|---|
| 炸彈 | 0.5 m 的圓柱，脫手兩秒後就只剩幾個像素 |
| 魚雷 | 入水後只剩航跡，而航跡在黃昏／夜間幾乎看不見 |
| 船 | 灰色、貼在灰色的海上，8 km 外辨識不出艏向 |

## 3. 範圍

**只加畫面標示，不動任何模擬。** 這一輪不碰彈道、不碰命中判定、不碰 AI。

不做的事：

- **不做畫面外指示。** 目標框那一套有邊緣箭頭（`edgeIndicatorPosition`），
  這一輪不套用 —— 64 顆彈的箭頭擠在邊框上是雜訊，而負責人要的是「找得到
  它在哪」，不是「知道它在畫面外」。
- **不做距離讀數。** 目標框有，標記沒有。

## 4. 資料

### 4.1 `HudMarker`

```ts
export interface HudMarker {
  active: boolean
  /** 螢幕座標，單位為螢幕半高（與 contacts 同一套） */
  x: number
  y: number
  /** 在相機背後 —— 不畫 */
  behind: boolean
  hostile: boolean
}
```

**沒有 `radius`。** 標記是固定像素大小的符號而不是隨距離縮放的框 ——
它要解決的是「太小看不到」，跟著距離縮小就把問題原封不動搬回來了。

### 4.2 池的容量

```
炸彈 BOMBS_CAPACITY      64
魚雷 TORPEDOES_CAPACITY   8
船   艦隊最大值           ~12
                        ────
HUD_MAX_MARKERS          96
```

固定長度的池，`markerCount` 界定範圍 —— 與 `HUD_MAX_CONTACTS` 逐字同一個
做法（每幀 new 一個陣列就是每幀一次配置）。

### 4.3 彈藥要帶隊伍

`Bombs` 與 `Torpedoes` 目前**沒有隊伍欄位**，所以第 4 條做不出來。兩個池
各加一條 `readonly team: Int8Array`，**0 = 藍、1 = 紅**，與
`projectiles.ts` 的 `team: Int8Array` 逐字同一個編碼；轉換走 `teamSlot(team)`，
不要在呼叫端自己寫 `team === 'blue' ? 0 : 1`。**`teamSlot` 要從
`ai/target.ts` 搬到 `world/World.ts`**（`Team` 的定義處）—— 三個池都要用它，
而 `world/` 不能往上依賴 `ai/`；`ai/target.ts` 轉出它。

`World.dropBomb` / `World.dropTorpedo` 各加一個 `team: number` 參數，**不給
預設值**。給 0 當預設的話，漏傳的呼叫端會靜靜地把彈標成藍色 —— 而
`main.ts` 的**玩家投放路徑**正是這樣漏掉的（Codex 審查 2026-09-07）。
沒有預設值就讓它變成編譯錯誤。

反過來 `Bombs.spawn` / `Torpedoes.spawn` **保留預設值**：進得了遊戲的路徑
只有 `World` 那一層，強制在那裡就夠；池是資料結構，十幾支彈道測試不該為了
一個顏色欄位每一行都多帶一個 0。

兩個呼叫端：`releaseBombs(c, dt)` 從 `c.team` 帶（AI），`main.ts` 的
`stepBombBay` 回呼從 `player.team` 帶（玩家）。

**這一格是可重播的**：它由投放者決定，不吃亂數。但要注意
`replayDigest`（`test/tools/spawn-snapshot.ts`）**根本不含 `bombs` 與
`torpedoes`** —— 所以「重播護欄不受影響」這句話沒有測試在背書，它只是
資料路徑上的推論。真正守住它的是 `spawn` 每一次都覆寫 `team` 的那一行，
而那一行的護欄是**環狀繞滿一圈之後同一格的隊別要跟著新的那一顆走**
（Codex 審查 2026-09-07）。

### 4.4 填池的那一段要離開 `main.ts`

`main.ts` 沒有任何測試（見 `test/e2e/` 幾支的檔頭），而填池這一段有兩條會
**靜靜壞掉**的性質：漏掉某一種物體（症狀只是「炸彈沒有標記」）、敵我判反
（症狀只是「顏色不對」）。兩者都不會有任何錯誤訊息。

抽成 `hud/markerFeed.ts` 的 `fillMarkers(f, ships, pools, own, project)`：

- `pools` 收的是一個**介面**（`capacity`／`x`／`y`／`z`／`team`／`active`）
  而不是 `Bombs | Torpedoes`。收具體類別的話，測試就得造一整顆 `Bombs` ——
  那把「標記有沒有長出來」與「炸彈積分對不對」綁在一起。
- `project` 是一個回呼而不是 `Camera`。`three` 的相機進不了這一層的單元
  測試，而投影不是這支函數的內容：它負責的是「哪些東西進池、敵我怎麼判、
  滿了怎麼辦」。

### 4.5 `deckHeightOf` 搬到 `world/ships.ts`

它本來住在 `ai/bombRun.ts`（轟炸解算的落地平面）。標記的高度要用同一個
數字，而 `hud/` 不能往上依賴 `ai/` —— 所以搬到 `ShipClass` 的旁邊，
`ai/bombRun.ts` 轉出它。

## 5. 幾何

### 5.1 倒三角形

```
        ┌───────┐   ← 上緣，寬 2·HALF
         \     /
          \   /
           \ /
            V        ← 尖端，**貼在物體的投影點上**
```

**尖端貼在物體上、本體長在它上方。** 這是第 5 條的實作：標記的螢幕位置
就是物體世界座標的投影，所以物體爬升時標記跟著上移。

【為什麼是尖端不是中心】倒三角形是一個「指下去」的符號。把中心對齊物體
的話，符號指的是物體**下方**一個空點；貼尖端才讓符號指的位置與它標的東西
是同一點。

尺寸（CSS px，未乘 `L.scale`）：

```
MARKER_HALF   5    半寬
MARKER_HEIGHT 8    尖端到上緣
MARKER_GAP    3    尖端與物體之間留的空隙，免得符號把小目標整個蓋住
```

尖端在物體**上方** `MARKER_GAP` px（畫布 y 往下為正 ⇒ `tipY = objY − GAP·scale`），
本體再往上長 `MARKER_HEIGHT`。

### 5.2 顏色

`contactColor(hostile, false)` —— 敵紅 `#ff5a4d`、友藍 `#5aa9ff`。

【為什麼不自己寫 `hostile ? danger : friendly`】那正是 M6 改色時踩到的：
目標框改了、小地圖沒改。第三個參數固定 `false`：**分隊只對飛機有意義**，
一顆炸彈不屬於任何 Schwarm。

## 6. 繪製順序

`markers` 排在 `contacts` **之前** —— 目標框壓在標記上面。同一個位置同時
有飛機與炸彈時（剛脫手的那一瞬間），該讀的是飛機。

**三種視角都要排。** 標記是**世界疊加層**而不是座艙儀表 —— 彈、雷、船在
哪裡與鏡頭在哪裡無關，與 `godMarkers` 同一個性質。

- `BOMB`（投彈模式；**陣列的名字是 `BOMB` 不是 `BOMBING`**）正是最需要
  看到船在哪的時候。它由 `FULL.filter(...)` 推出來，所以不必重複加。
- `GOD`（上帝視角）那裡沒有目標框，整片海上只剩幾個灰色小點 ——
  **這一關是負責人 2026-09-07 試玩當場回報的**（第一版把它當座艙儀表排除了）。

## 7. 護欄

| 測什麼 | 怎麼測 |
|---|---|
| 三角形是倒的 | `markerPath(x, y, scale)` 回三個頂點，驗尖端 y **大於**另外兩點的 y（畫布 y 往下為正） |
| 尖端貼在物體上 | 尖端的 y = 物體投影 y − `MARKER_GAP·scale`（畫布 y 往下為正，所以是**上方**） |
| 同隊藍、敵對紅 | `contactColor(false, false) === HUD_COLORS.friendly`（既有） |
| 背後的不畫 | `behind = true` 的那一格不產生任何路徑 |
| 彈藥帶得到隊伍 | 藍隊投的彈 `bombs.team[i] === 0`；`dropTorpedo` 同 |
| 標記數等於場上物體數 | 一場 japan-m4 跑 30 秒，`markerCount === 活船 + 空中彈 + 空中雷` |
| 環狀繞回來要覆寫隊別 | 池投滿一圈之後，第 0 格的 `team` 跟著新的那一顆 |
| `fillMarkers` 真的被呼叫 | 讀 `main.ts` 原始碼（同 `bomb-bay-wiring.test.ts`）—— 單元測試是直接呼叫它的，刪掉 `main.ts` 那一行不會紅 |
| 兩個池都接上去 | 同上，`world.bombs` 與 `world.torpedoes` 都要在那一行附近 |

**變異測試**：把 `markerPath` 的尖端與上緣對調（三角形變正的）必須讓第一條
紅；把 `teamIndex` 的回傳固定成 0 必須讓「彈藥帶得到隊伍」紅。

## 8. 效能

每幀最多 96 次 `Vector3.project`，而且**走的是畫面頻率而不是 240 Hz 的
物理步** —— 不進 `perf-gate` 的預算（那一支只量 `World.step`）。

比較的基準不是「48 次」：20v20 上限是 40 架，座艙裡最多 39 次基本投影加上
20 次預瞄投影 = 59，上帝視角是 40 + 20 = 60。而 `contacts` 每一格還要
`distanceTo`、`Math.tan`、分隊查詢與 `solveLead`；標記那一側只有投影與一次
整數比較。所以增量是「固定上限的純投影」，量級低於現況（Codex 審查
2026-09-07 訂正了原本寫的 48）。

投影用的 `Vector3` 走模組私有的 scratch，不在迴圈裡配置。
