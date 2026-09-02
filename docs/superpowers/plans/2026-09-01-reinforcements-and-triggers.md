# 增援與觸發器 實作計畫

**Spec**：`docs/superpowers/specs/2026-09-01-reinforcements-and-triggers-design.md`（第二版）

**目標**：戰鬥進行中能讓一支分隊從遠方進場，由「時鐘」或「存活數」觸發，
並在進場前給畫面中心的預警。**既有 10 張任務卡的行為一個 bit 都不動。**

**架構**：五個任務，**每一個做完都要全套綠**。任務一是純預配（行為不變），
任務二才第一次真的加人，任務三接節拍，任務四接畫面，任務五收重開。

**技術**：TypeScript、vitest、three.js r180。

## 全域限制

- **判準是既有 10 張卡逐位元不變。**兩份重播校驗和是最後一道。
- 不使用 `Math.random`；不得引入 `@types/node`。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- 熱路徑零配置：`World.step` 與 `stepBattle` 每步不得配置。
- 註解寫現狀，不寫沿革。
- 每一條新測試都要先驗紅，或以變異證明它承重。
- 全套測試一次，但 `perf-gate.test.ts` 與 `test/integration/rematch.test.ts`
  要單獨跑。
- `tsc` 的既有噪音基準是 **23 行**。
- 提交訊息寫檔案再 `git commit -F`；**絕不 `git add -A`**
  （`bash.exe.stackdump` 是被追蹤且永遠是髒的）。
- 不用 PowerShell 讀寫含中文的檔案；Python 走 stdin 會弄壞中文，用 Write 工具。

---

## Codex 審查的結論（2026-09-01，三個 P0 全部覆核成立）

| # | 結論 | 覆核 | 處置 |
| --- | --- | --- | --- |
| 1 | `World.add` 中途呼叫會清空 `killEvents`、抹掉 `damageTime` | 成立。`World.ts:291,295`，註解自己寫著前提「add 只發生在場景組裝期」 | 任務一：預配到最終容量，中途不觸發任何 ensure |
| 2 | `fired` 放 `MissionCard` 破壞重播（模組級常數、跨場重用） | 成立。`missions.ts:275` | 任務三：節拍狀態一律放 `Battle` |
| 3 | `FlightIndex` 無法成長，`compactFlights` 越界寫入靜默失效 | 成立。`flights.ts:56,171` | 任務一：建構期就把最終分隊建好 |
| 4 | 漏列 `stepCommandLayer` 用的四份分隊索引清單 | 成立。`setup.ts:655` | 任務一 |
| 5 | `attachVisual` 不冪等、不能用 `rebuildVisuals` | 成立。`main.ts:247,405` | 任務四：只附加 |
| 6 | 條件 × 效果矩陣過度抽象 | 成立 | 任務三：兩個具名節拍 |

**⚑ 專案負責人裁定（2026-09-01）**：有波次的關卡按「重新開始」→ **整個
Battle 重建**，不截斷。任務五。

---

## 任務一：容量預配（行為一個 bit 都不動）

**這一個任務不加任何飛機。**它只是把「照開局架數配」改成「照最終架數配」，
而沒有波次時兩者相等——所以既有 10 張卡走的是同一條路。

### 做什麼

`BattleConfig` 加一個 `capacity`（最終架數與最終分隊數），預設等於開局值。
往下傳給：

```
  World          cull、killEvents、damageTime 的 stride
  TargetBoard    assignments / priority / protectedMask
  FlightIndex    flightOf / positionOf、以及最終分隊（增援的分隊 roster 為空）
  CommandState   blueCommand / redCommand
  battle 層      blue / red / commandUnits / spawnOrientations / roster
                 blueFlightIndices / redFlightIndices
                 blueOrderFlights / redOrderFlights
```

### 測試（先寫，先驗紅）

- `capacity` 大於開局架數時，六個容器的長度等於 `capacity`
- **`capacity` 等於開局架數時，與改動前逐位元相同**——兩份重播校驗和
- 空 roster 的分隊不影響 `compactFlights`（存活旗標的純函數）
- `damageStride` 等於 `capacity`，不是 `combatants.length`

### 驗收

全套綠 + 兩份校驗和不變。**這一步若讓校驗和變了就是做錯了**，不要重錄。

---

## 任務二：進場點 `reinforce()`

**第一次真的加人**，但還沒有任何東西會呼叫它——由測試直接叫。

### 做什麼

把 `createBattle` 內層那段生成邏輯抽出來共用（套手感、`openingTas`、擺位、
`world.add`、接線）。**不能複製**——兩份長得很像的生成邏輯就是「只有一份會
被修好」的那種危險。

`reinforce(b, plan)` 做的事：

1. **先驗完再動世界**（交易性）：最終架數 ≤ capacity、機種有登記、
   分隊大小合法、進場幾何合法
2. `world.add` × N（capacity 夠，所以不觸發任何 ensure）
3. 填進預留的分隊 roster
4. 四份分隊索引清單、`commandUnits`、`spawnOrientations`、roster 附加
5. `setDecisionPhase` —— 用能把同一波攤開的固定規則，不是 `index / length`
6. 回傳新增的索引範圍（任務四要用）

### 測試

- **`killEvents` 與 `damageTime` 在加人前後逐位元不變**（P0 的直接護欄）
- `board.assignments` 舊值不動、新格是 −1；`priority`／`protectedMask` 同理
- 四個 typed array 的**參照**是同一個實體（`toBe`，不是 `toEqual`）
- 新飛機拿得到 `flightOf` 與 `positionOf`（擋越界靜默失效）
- 四份分隊索引清單含得到新分隊
- 超過 capacity 時**拋錯而且世界沒有被改到**
- 加人之後跑一段，`countLocks` 不把新來的算成幽靈鎖定

---

## 任務三：節拍

### 做什麼

`MissionCard` 加 `beats: readonly Beat[]`，**預設空陣列**。
兩個具名節拍：`ReinforceBeat`、`WithdrawBeat`。條件兩種：`clock`、
`alive`（含必填的 `byLatest` 與選擇器 `team` + `role`）。

執行狀態放 `Battle`：進行到第幾個節拍、已預警／待進場、預定進場的 tick。

插在 `stepBattle` 的 **`drainKills` 之後、`compactFlights` 之前**。

**決定性四條**：整數 tick 判臨界；先對同一份快照判斷全部條件、再套效果；
同一步多個成立時照卡片順序；預警延遲用 tick。

### 測試

- 時鐘：第 N tick 觸發，**只觸發一次**
- 存活數 + 選擇器：只數指定 team + role
- `byLatest` 兜底：條件永遠不成立時仍然觸發
- **先判斷後套效果**：同一步兩個 `alive` 條件都成立時，第一個的增援不得影響
  第二個的判斷（變異測試：把順序倒過來，結果必須相同）
- **同一張含波次的卡在同一個 process 連跑兩次完全相同**（擋 `fired` 的全域污染）
- 對照組：`beats` 為空的卡，一次都不評估

**不做**「20v20 跑一場看第二波有沒有出現」那種測試——那是戰場的產物
（見 `5dce114`）。

---

## 任務四：畫面

### 做什麼

- `main.ts` 讀 `reinforce` 回傳的索引範圍，**只建那幾具 visual** 並附加到
  `renderPositions` / `renderQuaternions`。不呼叫 `rebuildVisuals`
- 中央訊息 widget：**單一訊息槽**（文字 + 顯示到哪個 tick，後來者覆蓋）。
  不做排隊
- 在**下一個物理子步之前**做完

### 測試

- 訊息槽：到期消失、後來者覆蓋
- 版面：不與既有 HUD 元件重疊

Playwright 那一關留到最後一起跑。

---

## 任務五：重新開始 → 重建 Battle

有波次的關卡走「用原始的不可變設定重新 `createBattle`」，保留地形。

### 測試

- **增援之後重開，t=0 的 combatants／flights／roster／節拍狀態與第一次開場
  完全相同**
- 沒有波次的關卡仍然走 `resetBattle`，行為不變（`rematch.test.ts` 單獨跑）

---

## 收尾

1. 全套測試（`perf-gate` 與 `rematch` 單獨跑）
2. `npx tsc --noEmit`，基準 23 行
3. 兩份重播校驗和
4. Codex 覆審
5. Playwright 跑一遍實際畫面
6. `docs/roadmap.md` 里程碑 1 的 14 條打勾

## 不做（這一輪明確排除）

- 位置觸發、事件觸發（沒有地面目標可以指，等里程碑 2）
- 無限波次、動態決定增援機種
- 泛用的 `message` 效果、泛用的 `objective: MissionRules`
- 中央訊息的排隊
- 音效
