# 盟 M4「沖繩外海」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `allies-m4` 由 `battle: null` 變成打得起來的一關 —— 玩家開 F6F-5 守住第 58 特遣艦隊（Essex ×1、Wichita ×2、Fletcher ×6），先擋零戰，零戰剩 30% 或兩分鐘到（先到先算）之後 G4M 低空進場雷擊。**航母被擊沉就輸。**

**Architecture:** 主體是一條新的任務規則 `defend`，其餘大半是既有機制的資料 —— 艦船、艦載三層防空、AI 的雷擊剖面、波次的 `role` 選擇器都已經在，而且**每一條都是團隊感知的**（`shipGuns.ts:366`、`shipAttack.ts:117`、`setup.ts:920` 的 `placeFleet` 逐字透傳 `e.team`）。要害艦由 `MissionFleet` 條目上的 `vital?: true` 指名 —— 誰要緊與艦名單住在同一個地方。

**但不是「只加一條規則」。** 查證之後另有三件不是資料的事（spec §2.2）：預警期間會提前判勝（要多一格 `redInbound`）、Essex 沒有預載（`main.ts:2199` 只載 wichita 與 fletcher）、紅方 G4M 打藍方船的整條路徑從來沒跑過（既有整合測試全是藍打紅）。

**Tech Stack:** TypeScript、three.js、vitest、Playwright。`battle/mission.ts` 是純函數，不 import three 以外的重東西。

**Spec:** `docs/superpowers/specs/2026-09-07-allies-m4-okinawa-design.md`

## Global Constraints

- **只加，不改。** 日 M4 靠 `sink` 規則與 `RENNELL_FLEET`，這一輪一個字都不碰；`mission.test.ts`、`torpedo-vs-ship.test.ts`、`mission-evacuate.test.ts` 既有的每一條都要綠。
- **`defend` 的勝負寫在同一條規則裡**，不散在兩個地方 —— 理由同 `convoy` 的「寫成兩個分支的話，兩邊的判定順序、邊界、NaN 處理會各自漂移」。
- **要害艦不得用 `cls === 'essex'` 判**。換一艘船當主角就要改規則的話，那個耦合遲早會咬人。
- **`missionRules` 的判準不得用 `card.type`**。既有註解已經寫明理由：`type` 是給玩家看的分類，用它推導的話日後多一張同型卡就會靜靜地變成另一種規則。
- **`missionConfigFrom` 是明列欄位、不透傳未知資料。** 漏抄一格的症狀是「型別過了但進戰鬥零艘船」，不報錯 —— 每一格新資料都要有透傳測試。
- 註解**只寫事實，不寫討論過程**；設計值一律標「起始值，由試飛裁定」。
- **絕不 `git add -A`**，一律列明確路徑。
- commit message 含中文時寫進暫存檔再 `git commit -F`；**絕不用 PowerShell 讀寫含中文的檔案**。
- 提交訊息結尾只加 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`，**不附 session 網址**。
- 動工前先量 `npx tsc --noEmit` 的基準行數（**不要寫死數字**），每個 Task 結束前比對沒有增加。
- 每一條新測試**先驗紅**，或用 mutation 證明它承重。
- **`perf-gate.test.ts` 與 `rematch.test.ts` 單獨跑，而且要在機器閒置時跑** —— dev server 或無頭 chromium 在跑的時候 `perf-gate` 會紅 3~5 條，那是它自己註解記載的並行雜訊。
- **護欄重新定值是負責人的決定。** 測試紅了先量、先報告、先問。

---

### Task 1: `defend` 規則 + `MissionInputs` 的兩格（含所有呼叫端）

**Files:**
- Modify: `src/battle/mission.ts`、**`src/battle/setup.ts`**
- Test: `test/unit/mission.test.ts`、**`test/unit/battle-convoy.test.ts`**（`MissionInputs` 的字面值）

**為什麼把 wiring 併進來**：`MissionInputs` 的兩格是**必填**的，加了之後每一個建構那個物件的字面值都會編譯錯 —— `setup.ts:1354` 與 `battle-convoy.test.ts:126` 都有。分成兩個 Task 的話，Task 1 做完 repo 的 `tsc` 是壞的，違反這份計畫自己的護欄。**不得為了過渡把欄位改成 optional。**

**Interfaces:**
- `MissionRules` 多一支 `{ kind: 'defend' }`
- `MissionInputs` 多兩格：
  - `vitalSunk: number` —— 我方要害艦沉了幾艘
  - `redInbound: boolean` —— **已經預警、還沒生出來**的敵機

**判定（spec §5.4）—— 要害艦排在勝利之前，刻意不沿用「victory 先於 defeat」：**

```
  vitalSunk > 0                → defeat
  否則 紅方全滅 且 !redInbound  → victory
  否則 藍方飛機全滅             → defeat
```

**沒有 `vitalTotal`、沒有顯式的 `annihilate` fallback** —— 一艘 `vital` 都沒有時 `vitalSunk` 恆為 0，自然退化。多寫一條 fallback 是死碼（拿掉它行為完全相同，所以那條 mutation 殺不死）。

**`redInbound` 由誰填**：`setup.ts` 掃 `b.beatStates`，任何一個 `phase === 'warned'` 且那個節拍是**紅方增援**就是 true。

- [ ] **Step 1: 先量 tsc 基準行數**，記下來
- [ ] **Step 2: 寫失敗的測試**
  - 紅方全滅、`redInbound` false → victory（要害艦還在）
  - 藍方全滅 → defeat
  - **要害艦沉 → defeat，而且雙方飛機都還在**（證明這一條自己判得出來）
  - **要害艦沉的同一步紅方也全滅 → defeat**（殺掉判定順序寫反）
  - **紅方全滅但 `redInbound` 為 true → 仍然 `fighting`**（spec §7.5）
  - **`vitalSunk = 0` 且 `redInbound` false 時與 `annihilate` 逐格相同**：
    同一組輸入餵兩種規則，斷言整個 `MissionState` 相同，不是只比 `outcome`
  - `metric` / `metricTotal` / `objectiveText` 那幾格填什麼要釘死
- [ ] **Step 3: 實作。** 不得配置；`stepMission` 定案之後不再改任何欄位（既有紀律）
- [ ] **Step 4:** 補齊 `setup.ts` 與 `battle-convoy.test.ts` 的字面值，`tsc` 回到基準
- [ ] **Step 5:** `mission.test.ts` 既有的每一條**都不得修改、不得刪除**，且全綠

**Verification:** mutation —— (a) 把 `vitalSunk > 0` 移到 victory **之後** → 「同一步」那條紅；(b) 把 `vitalSunk > 0` 改成 `>= 0` → 「要害艦還在時不判輸」那條紅；(c) 拿掉 `!redInbound` → 預警那條紅。

**這一條不做的 mutation**：拿掉「沒有要害艦時退化」的分支 —— 那個分支不存在（見上），行為等價測試守的是自然退化。

---

### Task 2: `MissionFleet` 的 `vital` 旗標

**Files:**
- Modify: `src/battle/missions.ts`
- Test: `test/unit/missions.test.ts`（或既有的卡片測試檔）

**Interfaces:**
```ts
readonly ships: readonly {
  readonly cls: ShipClassId
  readonly team: Team
  readonly offset: Vector3
  /** 這一艘沉了就輸。**只有 `defend` 規則讀它** */
  readonly vital?: true
}[]
```

**`?: true` 不是 `boolean`** —— `exactOptionalPropertyTypes` 開著，與 `FlightPlan.player` 同一個寫法。

- [ ] **Step 1: 寫失敗的測試**
  - `RENNELL_FLEET` 一艘 `vital` 都沒有（日 M4 不受影響）
  - 型別上 `vital` 可省略（既有的 `RENNELL_FLEET` 字面值不必改一個字）
- [ ] **Step 2: 實作**
- [ ] **Step 3:** 全套綠、tsc 不增行

**Verification:** `RENNELL_FLEET` 的字面值**一個字都沒有改**（讀 diff 確認）。

---

### Task 3: `missionRules` 認得 `defend`

**Files:**
- Modify: `src/battle/missions.ts`
- Test: `test/unit/mission-cards.test.ts`（或既有的 `missionRules` 測試處）

**判準是「艦隊裡有沒有要害艦」，不是 `card.type`：**

```ts
if (b.fleet?.ships.some((s) => s.vital === true)) return { kind: 'defend' }
```

**排在 `sinkCount` 之後**（日 M4 的艦隊一艘 `vital` 都沒有，所以順序不影響結果 —— 但先擊沉後守住讀起來才是「進攻的規則優先」）。

- [ ] **Step 1: 寫失敗的測試**
  - 帶 `vital` 艦隊的卡 → `{ kind: 'defend' }`
  - **日 M4（有艦隊、有 `sinkCount`、沒有 `vital`）→ 仍然是 `sink`**
  - 沒有艦隊的卡 → 不受影響（殲滅／護航／撤離各驗一張）
- [ ] **Step 2: 實作**
- [ ] **Step 3:** 全套綠、tsc 不增行

**Verification:** mutation —— 把 `defend` 的分支排到 `sinkCount` **之前**，日 M4 那條必須仍然綠（它沒有 `vital`）；把判準改成 `card.type === '殲滅'` → 德 M4／日 M1 那些殲滅卡會變成 `defend`，卡片測試必須紅。

---

### Task 4: `setup.ts` 的計數與透傳

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/unit/battle-mission-wiring.test.ts`

**在既有的那個迴圈裡多一個計數**（`setup.ts:1513`），不另開一輪。
**兩格都要每一步先歸零** —— 既有的 `shipsSunk` / `shipsTotal` 就是那樣寫的
（`setup.ts:1513-1514`），少了歸零的話上一步的值會累加下去，而重開同一關時
舊的 `vitalSunk` 殘留就是「開場立刻判輸」：

```ts
inp.shipsSunk = 0
inp.shipsTotal = 0
inp.vitalSunk = 0          // ← 一起歸零
for (const sh of b.world.ships) {
  if (sh.team === 'blue') {
    if (sh.vital && !sh.alive) inp.vitalSunk++
    continue
  }
  inp.shipsTotal++
  if (!sh.alive) inp.shipsSunk++
}
inp.redInbound = /* 掃 b.beatStates 有沒有 warned 的紅方增援 */
```

（`setup.ts:1361` 那一組**是模組級 singleton 的初值，不是一支
`resetMissionInputs`** —— 這份計畫的前一版把它寫錯了。）

**`Ship` 要帶得動 `vital`** —— `createShip` 多收一個參數，或 `placeFleet` 生完之後就地寫入。`placeFleet` 逐字透傳 `e.vital`。

- [ ] **Step 1: 寫失敗的測試**
  - 藍方要害艦沉 → `vitalSunk` 變 1
  - **紅方的船沉掉不影響 `vitalSunk`**（保護日 M4）
  - **藍方非要害艦沉掉不影響 `vitalSunk`**（六艘 Fletcher 沉光也不算輸）
  - **連續兩步不累加**：同一艘沉船跑兩個 `stepBattle`，`vitalSunk` 仍然是 1
  - **重建 Battle 之後歸零**：判輸的那一場之後重開，健康的航母仍然 `fighting`
  - `shipsSunk` / `shipsTotal` 的既有行為逐字不變
- [ ] **Step 2: 實作**
- [ ] **Step 3:** 全套綠、tsc 不增行

**Verification:** mutation —— (a) 把 `sh.vital` 的檢查拿掉 → 「非要害艦沉掉不算」那條紅；(b) 拿掉 `inp.vitalSunk = 0` → 「連續兩步不累加」那條紅。

---

### Task 5: `allies-m4` 卡片與 TF 58 艦隊

**Files:**
- Modify: `src/battle/missions.ts`、**`src/main.ts`**（預載 Essex）
- Test: `test/unit/mission-cards.test.ts`、**`test/unit/campaigns.test.ts`**、`test/integration/`（新的一支端到端）

**`main.ts:2199` 一定要一起改。** 現在是 `preloadShipModels(['wichita', 'fletcher'])`，註解寫著「只載會用到的兩艘 —— japan-m4 沒有航母」。不補 `'essex'` 的話 `createShipModels`（`render/ships.ts:105`）找不到樣板會**丟例外**，這一關進不去 —— 而前面每一條單元測試都還是綠的。

**`campaigns.test.ts:41` 也一定要一起改。** 它精確斷言鎖定關卡 `toBe(6)`；`allies-m4` 一填就變 5，可玩由 6 變 7。

**艦隊**（spec §4.2，全部 `team: 'blue'`）：

```
  Essex     ×1   中心，vital: true
  Wichita   ×2   內環，左右各一
  Fletcher  ×6   外環警戒幕
```

陣型尺度沿用 `RENNELL_FLEET`（整隊橫跨約 1.8 km）。**中心在原點** —— 雙方 `headOn` 收斂的中點就是艦隊上空，艦載防空因此真的參戰（spec §4.3）。

**卡片**：

```
  blueSpec F6F5 ×4（玩家）   redSpec A6M5 ×8
  terrain 'sea'              altitude 2000（起始值）
  timeOfDay 預設
  waves: [{
    when: { kind: 'alive', side: 'theirs', role: 'fighter', atMost: 2, byLatest: 120 },
    warn: '雷擊機低空進場', warnLead: 6,
    side: 'theirs', spec: G4M, count: 4,
  }]
```

**`role: 'fighter'` 不能省** —— 省了的話第一批 G4M 進場之後會把自己算進存活數，第二批就永遠不來（`MissionTrigger` 的註解已經寫明）。

- [ ] **Step 1: 寫失敗的測試**
  - `allies-m4` 的 `battle !== null`，而且 `missionRules` 給出 `defend`
  - 艦隊恰好 9 艘、恰好一艘 `vital`、**全部 `team: 'blue'`**
  - 波次的 `role` 是 `'fighter'`、`byLatest` 有限
  - **透傳**：`fleet`（含 `vital`）原樣到 `BattleConfig`；`waves` **轉成等價的
    `cfg.beats`** —— `BattleConfig` 上**沒有** `waves` 這一格（`missionConfigFrom`
    會轉譯），**不要為了測試新增一個**
  - `campaigns.test.ts` 的可玩 7／鎖定 5
- [ ] **Step 2: 實作**（含 `main.ts` 的 `'essex'`）
- [ ] **Step 3: 端到端**：`createBattle` 之後場上真的有 9 艘藍船、其中一艘 `vital`；把那一艘的 hp 打到 0 之後 `stepBattle` 判 defeat
- [ ] **Step 4:** 全套綠、tsc 不增行

**Verification:** 把 Essex 的 `vital` 拿掉 → Step 3 那條端到端必須紅（打沉航母卻沒判輸）。預載那一條由 Task 7 的 e2e 守（進得了關而且 `pageerror` 是空的）—— 單元測試看不到 GLB 載入。

---

### Task 5.5: 紅方 G4M 真的打得到藍方的船

**Files:**
- Test: `test/integration/red-torpedo-vs-blue-ship.test.ts`（新）

**為什麼要單獨一個 Task**：既有的整合測試**全部是藍打紅**（`torpedo-vs-ship.test.ts` 是玩家的 G4M 打紅艦）。每一層查起來都是團隊感知的，但**反向從來沒跑過**。少了這一條，前面每一條護欄都綠，而玩起來是「敵機繞著艦隊飛，什麼也不做」。

固定場景，逐步斷言（spec §7.4）：

```
  紅方 G4M 選中藍船        pickShipTarget 回傳那一艘
  進入雷擊剖面             TORPEDO_PROFILE 的 phase 走到 run
  投得出去                 世界上真的多一枚魚雷
  藍船掉血                 hp 實際下降
```

- [ ] **Step 1: 寫失敗的測試**（先驗紅 —— 這一條有可能一開始就綠，那就用
      mutation 證明它承重：把 `pickShipTarget` 的 `s.team === selfTeam` 改成
      `!==`，這一條必須紅）
- [ ] **Step 2:** 若真的有東西壞了，**停下來報告**，不要順手改 AI
- [ ] **Step 3:** 全套綠

---

### Task 6: HUD 的目標讀數

**Files:**
- Modify: `src/battle/mission.ts`（`objectiveText` 那一段）
- Test: `test/unit/hud-objective.test.ts` 或 `mission.test.ts`

第一版**沿用殲滅那一套**（敵機剩幾架），目標文字取卡片的 `objective`。

- [ ] **Step 1:** 確認 `defend` 走得到既有的顯示路徑，`objectiveMetric` 不是 NaN、不是 −1
- [ ] **Step 2:** 全套綠

**Verification:** `hud.test.ts` 的「初始值不含 NaN」與 `hud-objective` 既有的每一條都綠。

---

### Task 7: Playwright 驗收 + 試飛

**Files:**
- Create: `test/e2e/allies-m4.e2e.ts`
- 跑法：`npx vite-node test/e2e/allies-m4.e2e.ts`（**不要用 tsx**）

**要斷言的（不是只截圖 —— 上一輪的教訓）**，透過 `__probe`：

1. 進得了關：`allies-m4` 選得到、打得起來
2. 場上有 9 艘船，而且**是藍的**
3. 開場規則是 `defend`
4. 波次在條件成立後真的來了：等到紅方戰鬥機 ≤ 2 或 120 秒，`world.combatants` 裡出現 G4M
5. **艦載防空真的在開火**（艦隊上空有紅機時）

**要目視的：**

- 艦隊的陣型讀得出是一支艦隊（不是九個分開的點）
- Essex 看得出來是主角

- [ ] **Step 1:** `__probe` 補上這一關要的幾格（船數／隊別／要害艦狀態／規則種類）
- [ ] **Step 2:** 寫 e2e，前置條件不成立就**拋錯**
- [ ] **Step 3:** 跑一次，截圖逐張看
- [ ] **Step 4:** `page.on('pageerror')` 必須是空的
- [ ] **Step 5: 交給負責人試玩**

---

## 實作與計畫的差異（做完之後回填）

## 收尾

- [ ] `npx tsc --noEmit` 與動工前的基準行數相同
- [ ] `npx vitest run test/unit test/integration` 全綠
- [ ] `perf-gate.test.ts`、`rematch.test.ts` **在機器閒置時**單獨跑，綠
- [ ] 日 M4 一個字都沒動（讀 diff 確認 `RENNELL_FLEET` 與 `sink` 規則）
- [ ] Codex 複審
- [ ] 分 Task commit，不 `git add -A`
