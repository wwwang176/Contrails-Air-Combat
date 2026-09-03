# 三條戰役與任務卡 —— 實作計畫

設計：`docs/superpowers/specs/2026-09-03-campaigns-and-mission-cards-design.md`（第三版）

**技術**：TypeScript、vitest、three.js r180。

## 全域限制

- 不使用 `Math.random`；不得引入 `@types/node`。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- 熱路徑零配置：`World.step` 與 `stepBattle` 每步不得配置。
- 註解寫現狀，不寫沿革。
- 每一條新測試都要**先驗紅**，或以變異證明它承重。
- 全套測試一次，但 `perf-gate.test.ts` 與 `rematch.test.ts` 要單獨跑。
  **絕不同時開兩個 vitest**（2026-09-03 撞過 OOM，7 個 worker 中途死掉）。
- `tsc` 的既有噪音基準是 **23 行**。
- 提交訊息寫檔案再 `git commit -F`；**絕不 `git add -A`**。
- 不用 PowerShell 讀寫含中文的檔案；Python 走 stdin 會弄壞中文，用 Write 工具。

---

## 任務零：先抓 golden（**必須在動 `missions.ts` 之前**）

`allies-escort` 與 `axis-intercept` 現在產出的 `BattleConfig`，正規化成純量
快照存成 fixture。**這一步做完才准動任何生產碼** —— 事後再抓等於拿改動後的
自己比自己。

- 新檔 `test/fixtures/mission-config-baseline.ts`：兩張卡的正規化快照。
  機種寫 `spec.id`、向量寫 `[x, y, z]`、`Infinity` 寫成 `'Infinity'`。
- **不得 import 任何 spec 常數或 `MISSIONS`** —— 全部是字面值。
- 產生器 `test/tools/mission-config-baseline.probe.ts`，檔頭寫怎麼重跑。

驗收：新測試讀 fixture 與現況比對，**綠**。

---

## 任務一：型別（行為一個 bit 都不動）

`src/battle/missions.ts`：

```
  Campaign               'allies' | 'germany' | 'japan'
  MissionCard            id / title / type / summary / battle: MissionBattle | null
  MissionBattle          objective、三個 spec、五個數字、entry、terrain、waves?、withdraw?
  ReadyMissionCard       MissionCard & { battle: MissionBattle }
  MissionWithdraw        when / message / distance / radius / seconds
  MissionWave            …、spec 取代 role、加選填 along
```

`missionConfigFrom(card: ReadyMissionCard): BattleConfig` —— **第二個參數刪掉**。

這一步**同時**要把 12 張卡改寫成新形狀（型別與資料不可能分兩步）。

### 測試（先寫，先驗紅）

- 三落各 4 張、12 個 id 唯一、前綴對得上戰役
- 5 張有 `battle`、7 張是 null
- 每一張卡的機種是 `ALL_SPECS` 裡的同一個物件（`toBe`）
- 護送／攔截有 `convoySpec`，其餘 null，與 `type` 逐條對得上
- **盟 M1／德 M1 的 config 對得上任務零的 fixture**（德 M1 排除 `beats`）

---

## 任務二：翻譯層

- `waveBeat` 吃 `spec` 而不是 `role`；`along` 有給就覆寫 `entry.along`
- 新 `withdrawBeat`：`distance` → `point = (0, DEFAULT_BATTLE.altitude, −distance)`，
  與 `missionRules` 的撤離點**同一條路**
- `beats` = 波次的 `ReinforceBeat` ＋ 返航的 `WithdrawBeat`，**返航排最後**
  （`reserve` 是照 reinforce 的順序推的，混在中間不影響，但順序寫死比較好讀）

### 測試

- `spec` 原樣帶到 `flight.members`，機種是同一個物件
- `along` 有給就換縱深、沒給就沿用那一邊的擺法
- `withdraw` 翻成的 `WithdrawBeat` 的 `point` 與 `missionRules` 對同一個
  距離算出來的相同
- 一張同時有 `waves` 與 `withdraw` 的卡，兩種節拍都在，順序是波次在前

---

## 任務三：刪掉 `FactionChoice` / `SPECS` / `specsFor`

生產碼：`skirmish.ts` 三個符號、`main.ts` 的 `missionFaction`、`menu.ts` 的
`FactionChoice` import。**`ALL_SPECS` 不刪。**

測試與探針（Codex 掃出 19 支測試 + 12 支探針；`tsconfig.json:18` 把整個
`test/` 納入編譯，所以探針不修會讓 `tsc` 紅）。逐檔處置：

```
  找舊卡的         ai-tactics、extend-recovery、mission-convoy、mission-evacuate
                   → 改成自己建設定，不從 MISSIONS 找
  讀 specsFor 的   mission-waves、skirmish 等 → 直接寫機種
  讀 MISSIONS 的   convoy.probe 等 12 支探針 → 逐支看
```

**不用 `.skip`。**

`EVAC_SECONDS_ALLIES` / `EVAC_SECONDS_AXIS` 刪掉（`noUnusedLocals`）；
`EVAC_MARGIN` 留著，德 M4 的 158 s 用它推。

---

## 任務四：畫面

- `menu.ts`：`FACTION_LABEL` → `CAMPAIGN_LABEL` 三格；`factionRow` 迭代
  **`MISSIONS` 的鍵**不是寫死陣列；卡片渲染改讀 `battle === null`
- `main.ts`：`pendingMission` 收 `ReadyMissionCard`；地形讀
  `pendingMission.battle.terrain` 不再寫死 `archipelago`；`missionFaction` 刪掉

### 測試

`hudWidgets` 那一類的純函數測試守不到 DOM，所以這一步靠 §五的 e2e。
但**地形那一條可以驗**：`missionConfigFrom` 不管地形，地形在 `main.ts`——
所以改成驗「每一張可玩卡的 `terrain` 都是 `TerrainKind` 的合法值，而且
日 M3 是 `sea`、德 M4 是 `farmland`」。

---

## 任務五：e2e 重寫

`mission.e2e.ts` 現在只看預設那一頁、只點第一張卡。重寫成：

- 三顆戰役按鈕都在，切得動
- 每一條線 4 張卡，可點的張數對得上（1 / 2 / 2）
- **逐一啟動那 5 關**，每一關驗：主迴圈印出的編制含正確機種、console 0 錯誤
- 日 M3 特別驗：Ki-84 與 G4M 都真的生成

---

## 收尾

全套 → tsc → 兩份重播校驗和 → Codex 覆審 → Playwright → 更新 roadmap。
