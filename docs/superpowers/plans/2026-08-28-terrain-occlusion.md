# 山要擋得住子彈與視線 —— 實作計畫

**Goal:** 畫面上打得到的地方，就是子彈到得了的地方；AI（戰鬥機與轟炸機
砲塔）不把山後面的敵人列入考慮。

**Architecture:** 一份高度場，三個消費者，精度要求不同。

```
  world/occlusion.ts  LandField = HeightFieldData + ceiling
                      landHitT   彈丸用，步長 cell/4，要交點參數
                      losBlocked AI 用，步長 cell/2，只要 true/false
  彈丸端              World.land；landT 與 bestT 比先後，不是無條件 continue
  戰鬥機 AI           shouldFire 查**預瞄射線**；danger 的 mask 套在
                      AiController，不穿進 assess.ts
  砲塔 AI             pickTarget 不選被擋住的目標（搜尋本來就每秒一次）
```

**Spec:** `docs/superpowers/specs/2026-08-28-terrain-occlusion-design.md`

### Codex 審查改掉的四個 P0 與三項過度開發

```
  P0  'sea' 的假平原 + 缺 h > 0  →  一發入海的子彈會在水下 8 m 爆火花
  P0  迴圈開頭無條件 continue    →  吃掉同一步「先中飛機、後入地」的命中
  P0  只查終點                   →  兩端都在地形上、中間仍可能跨過稜線
  P0  遮蔽穿進 assess.ts         →  四處呼叫端漏接不會有型別錯誤
  砍  GroundField 同義介面       →  改用 HeightFieldData + ceiling
  砍  中央差分法線               →  改用三角形的真法線（與 sample 同一組）
  砍  targetScore 也擋           →  那是另一個需求
```

## Global Constraints

- **註解與 commit message 用繁體中文。註解寫現狀，不寫沿革。**
- **護欄重新定值是專案負責人的決定。** 測試紅了先量、先報告、先問。
- **絕不 `git add -A`**（`bash.exe.stackdump` 被追蹤且長期被修改）。
- **絕不用 PowerShell 讀寫含中文的檔案**；用 Write 工具或 Python
  `io.open(..., encoding='utf-8')`。
- **絕不把反引號放進 bash heredoc**（含 `python - <<PY` 這種）。含反引號的
  中文內容一律用 Write 工具。
- **背景工作跑的時候不得做任何會改動工作區的 git 操作。**
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
node node_modules/vite-node/vite-node.mjs <path>    # 一次性量測、也用來跑 e2e
node node_modules/vite/bin/vite.js --port 5178      # e2e 的 dev server
```

`node_modules/.bin` 不存在，`npx tsc` 會抓到系統上另一支同名程式。
專案沒有 `tsx`。`perf-gate.test.ts` 與 `rematch.test.ts` **必須單獨跑**。

### 基準

上一輪收尾（`430778c`）：**3,017 條綠**、14 skipped；`perf-gate` 單跑 6/6；
`tsc` 22 個既有錯誤、`src/` 零錯誤。

**三支 digest 護欄 2026-08-28 實跑 10/10 綠**：`replay-determinism`、
`order-of-battle-replay`、`tactics-off`。**`rematch` 不是其中之一** ——
它驗的是「連開十場不會愈來愈慢」，前兩輪的收尾把它寫成 digest 護欄，
那是引錯了。

---

## File Structure

| 檔案 | 動作 | 行數量級 |
|---|---|---|
| `src/world/heightfield.ts` | 修改 | +35 |
| `src/world/occlusion.ts` | 新增 | ~95 |
| `src/world/World.ts` | 修改 | +35 |
| `src/world/turrets.ts` | 修改 | +20 |
| `src/render/terrain.ts` | 修改 | +20 |
| `src/ai/terrainSense.ts` | 修改 | +8 |
| `src/ai/fire.ts` | 修改 | +20 |
| `src/ai/AiController.ts` | 修改 | +20 |
| `src/main.ts` | 修改 | +5 |
| `test/unit/occlusion.test.ts` | 新增 | ~120 |
| `test/unit/heightfield.test.ts` | 修改 | +25 |
| `test/unit/perf-gate.test.ts` | 修改 | +35 |
| `test/integration/terrain-occlusion.test.ts` | 新增 | ~220 |

**`src/ai/assess.ts` 與 `src/ai/target.ts` 不動** —— 見 Task 4。

---

## Task 1 —— `heightfield.normalAt`

**先驗紅。** `test/unit/heightfield.test.ts` 加：`normalAt` 與 `sample` 用
**同一個三角形** —— 在格內取三點，法線與任兩點連線的內積為 0（共面）。
對角線 `tx + tz = 1` 兩側各驗一次。

兩個梯度（與 `sample` 的三角形一一對應）：

```
  三角形 a–c–b   dh/dx = (h10 − h00)/cell   dh/dz = (h01 − h00)/cell
  三角形 b–c–d   dh/dx = (h11 − h01)/cell   dh/dz = (h11 − h10)/cell
  n = normalize(−dh/dx, 1, −dh/dz)
```

**它就是畫面上那個面的法線** —— 與 `sample` 共用同一段三角形判斷，不會有
第二個真相。中央差分算的是跨好幾格的平滑近似，那才是憑空多出來的幾何。

---

## Task 2 —— `world/occlusion.ts`

**先驗紅。** `test/unit/occlusion.test.ts`：

1. 兩端都高於 `ceiling` → 不擋，而且**一次高度場都沒查**
   （包一個計數器在 `sample` 外面，證明早退真的早退）
2. spec §1.2 的考題 → 擋
3. 兩架各抬高 60 m → 不擋
4. `landHitT` 沒交點回 `Infinity`；有交點時 t 落在 [0,1]，而且那一點確實
   在地形之下
5. **高度場沒島的地方（−8）不算陸地** —— 一條全程在開闊海面上、y = −5 的
   線段不得被判成撞地

實作：

```ts
export interface LandField { readonly field: HeightFieldData; readonly ceiling: number }
export function losBlocked(ax,ay,az, bx,by,bz, land): boolean   // 步長 cell/2
export function landHitT(ax,ay,az, bx,by,bz, land): number      // 步長 cell/4
```

- 兩端都 `> land.ceiling` 立刻早退。
- **陸地的判準是 `h > 0`。**
- **不要加取樣數上限** —— 那會讓實際步長超過標稱步長，直接推翻正確性論證。
  長度由呼叫端保證（彈丸一步 ≤ 5 m、AI 射程約 1 km）。
- 熱路徑：不配置。

---

## Task 3 —— 彈丸端（`World.ts`）

**先驗紅。** 四條，其中三條是 Codex 抓到的 P0：

1. `land` 設好之後，往山裡飛的彈丸被回收，而且推一筆 `hitEvents`
2. `land` 為 null 時行為與改動前逐位元相同
3. **海面回歸**：入海的彈丸，水柱仍在 y = 0、到 `SEA_KILL_Y` 才消失、
   **沒有**地形火花
4. **同一步先中飛機、後進地形** → 算命中，不算撞地

實作：`World` 加 `land: LandField | null = null`。**順序是關鍵**：

```
  1. 照舊掃視窗內的飛機 → bestT
  2. landT = landHitT(這一步的線段)
  3. landT < bestT  → 火花 + kill，不算命中
     否則           → 照舊（含水柱與 SEA_KILL_Y）
```

**不可以在迴圈開頭無條件 `continue`。** 那會吃掉同一步之內「先打中飛機、
後進入地面」的合法命中 —— 甲板實測量到過離地 6 m 的飛機，而彈丸一步走
3.7~4.5 m。那個窗口是真的。

**火花沿用 `hitEvents`**（消費者是 `sparks.emit`），**不推 `damageEvents`**
（那一條要 `victim.index`）。法線用 `normalAt`。

**`hitEvents` 的語意變了**：從「打中飛機」變成「彈丸撞到東西」。
`multi-battle.test.ts` 拿它的 `count` 當命中數（不注入地形，不受影響），
但要在 `hitEvents` 的文件上寫下來。

- `land` 在迴圈外取出。
- `by <= land.ceiling` 是第一道閘門，但**甲板的仗裡它擋不住多少** ——
  那正是 Task 7 要加 perf 案例的理由。

---

## Task 4 —— 戰鬥機 AI（`fire.ts` + `AiController.ts`，**不動 `assess.ts`**）

**先驗紅。**

- `shouldFire` 加第五個條件，**排在最後**。查的是**預瞄射線**：
  `self.position → self.position + basis.leadPoint`。
- `AiController` 算一次 `visible`，把 `threat` 與 `alarm` **一起**歸零。

**為什麼不穿進 `assess.ts`。** `threatFactor`／`alarmFactor` 的呼叫端有
四處（`evaluateThreat` 兩次、`considerThreatFrom`、`targetScore` 兩次），
可選參數漏接哪一條都**不會有型別錯誤**，症狀是「測試全綠但飛機照樣閃山
後面的瞄準」。在 `AiController` 套一次 mask 是一個地方、一條路。

**threat 與 alarm 一定要一起。** `danger = max(threat, alarm)`，而
「`alarm ≥ threat` 恆成立」有單元測試釘住。只擋一邊等於沒擋。

**查預瞄射線而不是目標現在的位置。** 子彈飛的是那條線。橫向相對速度
200 m/s、攔截時間 1 秒就是 200 m 的差。

**`targetScore` 不改。** 山後面的敵人仍可能被選為目標 —— 那是另一個需求。

---

## Task 5 —— 砲塔 AI（`world/turrets.ts`）

**專案負責人 2026-08-28：「轟炸機身上的自動機槍理論上不應該把山後的敵人
列入考慮。」**

**先驗紅。** 把一架敵機擺在山的另一側、落在砲塔的射界與射程內：
`pickTarget` 現在會選它，加了之後不選。

實作：`pickTarget` 的候選迴圈，在 `leadInBody` 通過之後加一道
`losBlocked(槍口 → 目標)`。

**為什麼放在最後**：`leadInBody` 已經是那個迴圈裡最貴的一項，而遮蔽比它
更貴。放在後面等於只對「已經是最佳候選」的那一架查。

**為什麼只擋選目標、不擋扳機**：搜尋每 `SEARCH_INTERVAL`（1 秒）一次，
而扳機是每步的。160 座砲塔 × 240 Hz 的遮蔽查詢付不起（它有自己的 perf
gate）。代價是目標剛轉到山後的那**最多一秒**裡砲塔還在打 —— 那些子彈
由 Task 3 收掉，畫面上是打在山壁上的火花。**這是取捨，不是漏掉。**

---

## Task 6 —— 接線

```
  render/terrain.ts   Terrain 加 land；**'sea' 回 null**
  ai/terrainSense.ts  TerrainSource 加可選的 land
  ai/AiController.ts  把 this.terrain?.land 傳給 shouldFire 與 mask
  world/World.ts      stepTurrets 多收 this.land
  main.ts             world.land = terrain.land（與 crashPolicy 同一處）
```

**`'sea'` 回 `null`，不是一個假的平原。** 假物件會讓每一發入海的子彈都去
查高度場，而且「陸地要 > 0」會變成唯一擋住海面回歸的東西 —— 兩道保險比
一道好。

---

## Task 7 —— 新的 perf 案例

**既有的六條證明不了這一輪。** `bench/projectile-load.ts`、`ai-load.ts`、
`multi-load.ts` 建的 `World` 都沒有地形 —— 新路徑一次都沒走到。而且甲板的
仗裡子彈本來就在 `ceiling` 以下，**早退在這一輪真正要支援的情境裡不會早退**。

`perf-gate.test.ts` 加一條：注入地形、彈丸都在 `ceiling` 以下的 20v20。
門檻用同一手（`*_GATE_US` 給數量級、`*_BUDGET_US` 給警告）。

---

## Task 8 —— 主要護欄（`test/integration/terrain-occlusion.test.ts`）

用 spec §1.2 的考題（兩架同高 850 m、島心兩側各 500 m、相距 1 km、
離地 126.6 m、山頂比連線高 49.6 m）。**每一條都要對照組。**

```
  彈丸  開火 6 秒       有山 命中 0、火花 > 0    沒山 命中 > 0
  AI    shouldFire      有山 false               沒山 true
  AI    跑 AiController  有山 不進 defend         沒山 進 defend
  砲塔  pickTarget       有山 不選                沒山 選
```

**第三條要跑控制器，不能只測純函式。** 只測 `shouldFire` 抓不到「mask 沒
接上」——而那正是這一輪最容易漏的地方。要跑滿反應延遲與 `alarmRamp` 的
飽和時間。

**每一步都要 `clearImpacts` 並累加**，不要跑完 6 秒才讀 `count`（緩衝只有
64）。同時斷言 `dropped === 0`。

fixture 的座標**寫死在測試裡並註明怎麼算出來的**（`occlusion-case.probe.ts`）。

---

## Task 9 —— 回歸與收尾

```
  perf-gate 單跑    ← 最先跑，這一輪動了最熱的迴圈
  三支 digest       replay-determinism / order-of-battle-replay / tactics-off
  全套
  tsc               src/ 零錯誤
  terrain-in-play   甲板 7/40、中空 0/40 不變
```

`docs/backlog.md` §7.1.1 畫掉；順手更正 §1.2（那兩條 replay 護欄 2026-08-28
實跑是**綠的**，backlog 說它們「必然紅」已經過期）。

---

## 事前約定的否決條件

- 新的 perf 案例超出預算 → **回頭改演算法，不改門檻**
- 三支 digest 護欄任一條變了 → 有東西漏進了不該有地形的路徑
- 海面回歸那一條紅 → `h > 0` 或 `'sea' → null` 這兩道保險漏了一道
- 對照組（沒山）那一半不成立 → 考題擺錯了，不是修好了

## 明確不做

新的粒子種類（火花沿用 `hitEvents`）、砲塔的**扳機**（只擋選目標，
見 Task 5）、目標選擇（`targetScore`）、玩家的預瞄環、部分可見、
路徑層、地形戰術層。
