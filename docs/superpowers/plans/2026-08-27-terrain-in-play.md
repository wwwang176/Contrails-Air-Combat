# 讓地形進得了場 —— 實作計畫

**Goal:** 玩家選得到「甲板高度、群島上空」這一場，而且那一場裡的山真的
擋得住路 —— 護欄從此量得到「安全層因為地形接管過」。

**Architecture:** 兩件事。

```
  選得到   SkirmishSetup 加 terrain 與 altitude → 選單兩列按鈕
  打得到   archipelago 把一座 tier-0 大島換成寫死的錨島，放在有效戰區
```

**不動的東西：** 戰場幾何（`entryRange`、出生點、`lateralOffset`）一個數字
都不動 —— 那是幾十條護欄的基準。**搬的是山，不是戰場。**

**不做的東西：** `BattleConfig.terrain`、出生帶淨空、`senseIsland` getter。
三項都在初稿裡，被 Codex 審查砍掉 —— 理由見 spec §3、§6.4、§8.1。

**Spec:** `docs/superpowers/specs/2026-08-27-terrain-in-play-design.md`

## Global Constraints

- **註解與 commit message 用繁體中文。註解寫現狀，不寫沿革。**
- **護欄重新定值是專案負責人的決定。** 測試紅了先量、先報告、先問。
- **絕不 `git add -A`**（`bash.exe.stackdump` 被追蹤且長期被修改）。
- **絕不用 PowerShell 讀寫含中文的檔案**；用 Write 工具或 Python
  `io.open(..., encoding='utf-8')`。
- **絕不把反引號放進 bash heredoc 或 `python -c`**。
- 不得引入 `@types/node`。熱路徑零配置；**不得 `Math.random`**。
- `src/ai/` 不得 import `src/battle/`；`src/battle/` 不得 import `src/render/`。
- commit message 結尾加：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Y72mnpXy4V7QMrcpAi4BAo
  ```

### 這台機器上的指令

```
node node_modules/vitest/vitest.mjs run <path>      # 測試
node node_modules/typescript/bin/tsc --noEmit       # 型別
node node_modules/vite-node/vite-node.mjs <path>    # 一次性量測
```

`node_modules/.bin` 不存在，`npx tsc` 會抓到系統上另一支同名程式。
`perf-gate.test.ts` 與 `rematch.test.ts` **必須單獨跑**。

### 基準

**開工前實跑（2026-08-27）**：132 檔、**3,007 條全綠**、14 skipped，零紅
（不含單獨跑的 `perf-gate` 與 `rematch`）。`ai-command-tactics` 的三個數字
是 `8108 / 14319 / 0.566`，與上一輪記錄的基準同值。

`tsc` 在 `src/` 零錯誤；21 個既有錯誤全部在 `test/e2e/` 與 `test/tools/`。

**沒有既有紅測試，所以接下來任何一條紅都是這一份造成的。**

---

## File Structure

| 檔案 | 動作 | 行數量級 |
|---|---|---|
| `src/world/terrainKind.ts` | 新增 | ~15 |
| `src/world/archipelago.ts` | 修改 | +35 |
| `src/render/terrain.ts` | 修改 | ±5 |
| `src/battle/skirmish.ts` | 修改 | +45 |
| `src/ui/menu.ts` | 修改 | +45 |
| `index.html` | 修改 | +6 |
| `src/main.ts` | 修改 | ±15 |
| `test/unit/archipelago.test.ts` | 修改 | +25 |
| `test/unit/skirmish.test.ts` | 修改 | +30 |
| `test/unit/battle-setup.test.ts` | 修改 | +20 |
| `test/e2e/skirmish-roster.e2e.ts` | 修改 | +25 |
| `test/integration/terrain-in-play.test.ts` | 新增 | ~150 |

---

## Task 1 —— 錨島（`src/world/archipelago.ts`）✅

**先驗紅過了**（`交會區兩側各有一座真正的山` 一開始是 `expected 0 to be
greater than 0`）。

```ts
const ANCHORS = [
  { cx: 2500, cz: -950, radius: 1400, peak: 900, pa: 0, pb: 0 },
  { cx: -2500, cz: 950, radius: 1500, peak: 850, pa: 2.1, pb: 4.3 },
]
```

- `TIERS[0].count` 由 2 改成 **0** —— 兩座錨島補那兩席，島數維持 48。
- 兩座先 push，**不呼叫 `rand()`**（位置與相位都是常數）。
- **兩座尺寸不同**：相同的話「最高」與「最寬」會是同一座，
  `terrain-avoidance` 的 192 組會有 64 組靜靜地變成重複。

三條新測試（錨島存在且分兩側、通道 ≥ CHANNEL_MIN、島數 48），
「島數 48」以變異證明承重（`count` 改回 2 → 49 → 紅）。

---

## Task 2 —— 錨島位置：量出來，不是論證出來 ✅

一次性探針（跑完刪掉），8v8 與 20v20 各一輪，**把繞島佔時拆成交會前與
交會後**（交會＝兩隊質心的 z 間距首次 < 1,000 m）：

```
  候選位置   交會前佔時   交會後佔時   撞山   陸上最低餘裕
```

候選至少四個，涵蓋「壓在進場航跡上」與「側在航跡外」兩類。**挑交會後高、
交會前低的那一個。**

`outerRadius = 1,806`，而編隊橫向撐到 |x| ≤ 2,675 —— 放在 `|cx| ≥ 4,500`
才完全避得開進場航跡，但那樣島緣離原點 2,694 m，纏鬥不一定過得去。
**這個取捨就是這一支探針要回答的東西。**

**撞山怎麼數**：在 `crashPolicy` 這個 predicate 裡讀 `hp` —— 那一刻它還是
真值。**不要事後讀**（`World.destroy` 第一行就是 `c.hp = 0`，判準會靜靜地
恆為「沒撞山」），**也不要只數「死在陸地上」**（被打下來的殘骸落在島上會
被算成撞山，實測一場數到 1、實際 0）。

**量出來的結果**（8 個候選位置 × 5 種規模）：單座是**開關式**的 ——
五種規模只有兩種會用到，而且其中一種繞的還是別的島。**改成兩座**之後
四種會用到，每一次繞的都是錨島。交會前的介入率是 **0.00%**。

**順帶量到一件要記住的事**：`createBattle` 的 seed **不是這條路徑的變因** ——
換三個種子跑同一組參數，結果逐位元相同。它只配飛行員名字。

---

## Task 3 —— `TerrainKind` 搬家 ✅

`src/world/terrainKind.ts` 新檔，只有那個聯集與它的文件。
`render/terrain.ts` 改成 `export type { TerrainKind }` 再匯出 ——
既有 import 站點一個字都不用改。

**為什麼要搬**：`battle/skirmish.ts` 要用它，而 battle 層不該相依 render 層。

---

## Task 4 —— 設定與夾制 ✅（`src/battle/skirmish.ts`）

**先寫測試，先驗紅。** `test/unit/skirmish.test.ts` 加：

1. `DEFAULT_SKIRMISH.terrain === 'archipelago'`、`.altitude === 4000`。
2. `battleConfigFrom({ ...s, altitude: 600 }).altitude === 600`。
3. 不合法的高度（`NaN`、`-1`、`99999`）退回 `DEFAULT_BATTLE.altitude`。

實作：

```ts
export const ALTITUDES = [
  { label: '甲板', value: 600 },
  { label: '低空', value: 1500 },
  { label: '中空', value: 4000 },
] as const
```

夾制走**白名單**（必須是 `ALTITUDES` 裡的值）。

**這是一個 API 陷阱，要寫進註解**：未來的探針若寫
`battleConfigFrom({ ...setup, altitude: 800 })`，會**靜靜地**退回 4,000。
既有探針全部是「先 `battleConfigFrom`、再覆寫回傳值的 `altitude`」
（`altitude-drift`、`climb-blame`、`extend-pitch`、`rally-handover`），
所以不受影響 —— 但下一個人不會知道。

**`setup.terrain` 不進 `BattleConfig`。** 它由 `main.ts` 交給
`createTerrain`。

---

## Task 5 —— 選單 ✅（`index.html`、`src/ui/menu.ts`）

`#skirmish` 加一列，`menu.ts` 加一個共用的
`renderPick(host, options, current, onPick)`，兩組共用。

**護欄是 `test/e2e/skirmish-roster.e2e.ts`**（專案沒有 `menu.test.ts`）。
照那一支既有的模式加一條：點「甲板」之後開場高度真的是 600。

---

## Task 6 —— `main.ts` 接線 ✅

```
  遭遇戰   createTerrain(setup.terrain)
  任務     createTerrain('archipelago')   ← 固定，不吃遭遇戰的設定
```

**`wireTerrain` 原封不動。** 它每幀比對參考、`restartBattle` 用
`wireTerrain(true)` 強制清鎖存 —— 那兩件事都還需要，因為 `restartBattle`
走的是 `resetBattle`（不是整場重建），而 `resetTactics()` 不清 `sense`。

**換地形要走重建那條路**：`enterBattle` 每次都 `createTerrain`，所以選單
改地形之後按「開始戰鬥」自然生效。`restartBattle`（暫停選單的「重新開始」）
不換地形 —— 那是既有行為，正確。

---

## Task 7 —— 主要護欄 ✅（`test/integration/terrain-in-play.test.ts`）

8v8 遭遇戰、群島、120 秒，兩個高度。**地形照既有探針的做法注入建好的
battle**（`ctl.terrain` 與 `world.crashPolicy`）—— 接線不是這一支的題目，
幾何才是。這一點要寫進檔頭。

```
  600 m    safetyAction === 'terrain' 的步數 > 0     撞山 0
  4000 m   safetyAction === 'terrain' 的步數 = 0
```

另外一條放 `test/unit/battle-setup.test.ts`：**甲板開場時每一架的出生點
離地 > `clearance`**。

實測值印 `console.log`，不進斷言。

---

## Task 8 —— 重跑三支被錨島影響的測試 ✅

錨島換掉一座 tier-0 大島，**後面每一座島都會不一樣**（`TIERS[0].count`
少一輪、rejection 多幾次）。這三支的實測值要重跑、重記：

```
  archipelago.test.ts        島數與最差通道間隙（上一輪 48 / 1,504 m）
  terrain.test.ts            islands[0] 現在是錨島
  terrain-avoidance.test.ts  它動態挑最高／最寬／最小三座，三座都會換人
```

**`terrain-avoidance` 的 `worstClear` 若掉到門檻以下，那是護欄重新定值，
要先量、先報告、先問。** 不得自己放寬。

---

## Task 9 —— 回歸與收尾 ✅

```
  全套             node node_modules/vitest/vitest.mjs run
  單獨兩支         perf-gate、rematch
  型別             tsc --noEmit（src/ 必須零錯誤）
  replayDigest     rematch 逐位元不變
  ai-command-tactics  8108 / 14319 / 0.566
```

`docs/backlog.md` §7 更新：畫掉「遭遇戰選單選地形」，補上這一輪量到的
兩件事（路徑層 0 分母的那三張表、山擋得住路的條件式）。

---

## 事前約定的否決條件

- 甲板群島跑不出「被地形接管過 > 0」→ **改錨島，不改門檻**
  （沒觸發：實測 7/40）
- 交會前的介入率高於交會後 → 換位置（沒觸發：實測交會前 0.00%）
- `replayDigest` 變了 → 回頭修（沒觸發：`rematch` 3/3）
- 甲板關卡出現撞山 → **觸發了。** 實測 1/40。查明是
  「俯衝追人 + 腳下地形同時上升」，接近率 124 m/s 而 `clearance` 只有
  120 m —— 那個常數是照平的海面訂的。提高到 160 會歸零，但那是全域 AI
  常數（存活 34 → 27，全部基準要重錄）。**專案負責人 2026-08-28 裁定
  不付那個代價**，判準改成「撞山只能是來不及的那一種」，門檻由拉平時間
  推導（見 spec §8.2）。

## 明確不做

`BattleConfig.terrain`、出生帶淨空、`senseIsland` getter、路徑層、
地形戰術層、任務卡選地形／高度、大島海岸線與內陸、島的 LOD、搬戰場、
玩家自訂種子。


---

## 收尾實測（2026-08-28）

```
  全套             3,017 條綠、14 skipped；只有 perf-gate 那三條假紅
  perf-gate 單跑   6/6
  rematch 單跑     3/3，replayDigest 逐位元不變
  tsc              22 個既有錯誤，src/ 零錯誤（與開工前同數）
  terrain-avoidance 192 組零撞山，worstClear 99.5 m（上一輪 88.6）
  skirmish-roster.e2e  24 條全過，含新加的四條
  地形進得了場     甲板 7/40 架被接管、中空 0/40
```

**這一輪多出來的四支探針**（都被某個決定引用）：

```
  anchor-place.probe.ts     錨島位置怎麼挑的 —— 交會前／後分開量
  terrain-crash-why.probe.ts 那一架為什麼撞山 —— 逐 0.5 秒的軌跡
  terrain-clearance.probe.ts clearance 掃描 —— 專案負責人裁定的依據
  terrain-los.probe.ts      山擋不擋得住視線 —— 0.12~0.42%
```
