# 空投魚雷與投放包絡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** G4M 預設掛一枚魚雷，按 `B` 進投彈視角、扳機投放；魚雷落水後定深 1 m 等速直航，撞船或撞岸引爆，航行時在水面拉出一條水花航跡。同一輪補上**投放包絡** —— 姿態／高度不在包絡內時準星轉紅且扳機無效，炸彈也適用。

**Architecture:** 空中段**直接呼叫炸彈的 `stepBomb`**，所以「瞄具解出來的落點 ≡ 魚雷的入水點」是逐位元成立的，不是近似。入水後換一套定深等速的積分，兩段之間只有一個切換點。掛載的三張表（容量／傷害／裝填）合併成一張 `Loadout`，任務卡片可以整份複寫。包絡是一支收五個純量的純函數，`stepBombBay` 收它的布林結果當閘。

**Tech Stack:** TypeScript、three.js、vitest。`world/torpedo.ts`、`weapons/stores.ts`、`weapons/envelope.ts` **不 import three**（要能在 node 裡測）。

**Spec:** `docs/superpowers/specs/2026-09-06-aerial-torpedo-design.md`

**Review:** Codex 已審過本計畫的前一版，六個「會壞」的問題已就地修正（撞岸判準、包絡閘的位置、`headX/headZ` 的介面、`torpedoShip` 的傳遞、逐位元護欄的觀察點、`TORPEDO_MAX_SECONDS` 會截短射程）。下面的 Task 是修正後的版本。

## Global Constraints

- **空中段不得重寫積分。** `world/torpedo.ts` 呼叫 `world/bomb.ts` 的 `stepBomb`，落地內插那八行照抄 —— 差一個字就是準星與入水點分家。
- **水陸判準一律是 `collisionHeightAt(x, z) > 0`**（平海碰撞面）。**不得用 `waterAt`**（含浪、12 次 `sin`、岸線差一個帶），也**不得寫成 `> 雷體高度`**（`0 > −1` 恆真，魚雷會在海中央自爆）。`waterAt` 只在航跡與入水水花取高度時用。
- 熱路徑零配置：`Torpedoes.step`、`canRelease` 內部不得 `new`；輸出就地寫入。
- `world/torpedo.ts`、`weapons/stores.ts`、`weapons/envelope.ts` 不得 `import ... from 'three'`。
- 池用 `Float64Array`（同 `Bombs`）—— 逐位元護欄靠它。
- 散佈走 `spreadPair(dropped, …)`，**不得 `Math.random()`**：逐位元重播是鐵律。
- 註解**只寫事實，不寫討論過程或思考過程**；設計值一律標「起始值，由試飛裁定」。
- **絕不 `git add -A`**（`bash.exe.stackdump` 是被追蹤且長期被修改的檔案），一律列明確路徑。
- commit message 含中文時寫進暫存檔再 `git commit -F`；**絕不用 PowerShell 讀寫含中文的檔案**。
- 提交訊息結尾只加 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`，**不附 session 網址**。
- 每個 Task 結束前 `npx tsc --noEmit` 的 `src/` 必須 0 錯誤。
- 每一條新測試**先驗紅**，或用 mutation 證明它承重。
- `perf-gate.test.ts` 與 `rematch.test.ts` **單獨跑**。
- **護欄重新定值是負責人的決定。** 測試紅了先量、先報告、先問。

---

### Task 1: 掛載表併成一張

**Files:**
- Create: `src/weapons/stores.ts`
- Modify: `src/weapons/bomb.ts`、`src/main.ts`、`src/battle/missions.ts`、`src/battle/setup.ts`、`src/world/World.ts`（只有一行過期註解，`World.ts:607` 的 `bombDamageOf`）
- Test: `test/unit/stores.test.ts`（新）；改 `test/unit/bomb-bay.test.ts`、**`test/unit/bomb-vs-ship.test.ts`**（直接 import `bombDamageOf`，有兩條 G4M 的行為要重寫）

**Interfaces:**
- Produces:
  - `type OrdnanceKind = 'bomb' | 'torpedo'`
  - `interface Loadout { kind, count, damage, reloadSeconds }`（全 `readonly`）
  - `LOADOUT_BY_AIRCRAFT: Readonly<Record<string, Loadout>>`
  - `loadoutOf(aircraftId: string): Loadout | null`
- Removes: `BOMB_BAY_BY_AIRCRAFT`、`bombBayOf`、`BOMB_BAY_MAX`、`BOMB_DAMAGE_BY_AIRCRAFT`、`bombDamageOf`、`canBomb`、`BOMB_RELOAD_SECONDS`
- **不新增 `LOADOUT_COUNT_MAX`。** HUD 的格數讀的是 `HudFrame.bombBayCapacity`（`bombBay.ts:36`），`BOMB_BAY_MAX` 現在只是 `createBombBay` 的預設值與測試資料。`createBombBay(capacity = 0)`，`syncBombLoad` 一律立刻 `resetBombBay`。
- Keeps in `weapons/bomb.ts`: `BOMB_BLAST_DAMAGE`、`blastScaleOf`、`BOMB_BLAST_RADIUS`、`blastRadiusOf`、`bombBlastDamage`、`BOMB_SALVO_INTERVAL`、`BombBay` 狀態機

**表（spec §2.2）：**

```
  b17g    bomb     10    9,000   20 s
  he111   bomb      8    9,300   20 s
  g4m     torpedo   1   15,000   45 s
```

- [ ] **Step 1: 寫失敗的測試** — `test/unit/stores.test.ts`
  - 三台各自的 `kind` / `count` / `damage` / `reloadSeconds`（**釘死數值**）
  - `loadoutOf('bf109k4')`、`'p51d'`、`'f6f5'`、`'ki84'`、`'a6m5'` 都是 `null`
  - **魚雷的裝填比每一台炸彈久**（寫成比較，不寫死 45）
  - `LOADOUT_BY_AIRCRAFT` 的每一個 key 都是真的機種 id（拿 `specOf` 對）
- [ ] **Step 2: 實作** `src/weapons/stores.ts`
- [ ] **Step 3: 三張舊表退場。** `BombBay` 加 `reloadSeconds` 欄，`resetBombBay(b, loadout)` 一併寫入，`stepBombBay` 的回補讀 `b.reloadSeconds`；`main.ts` 的三個呼叫點換成 `loadoutOf`
- [ ] **Step 4:** `MissionBattle` 加 `readonly blueLoadout?: Loadout`
  - **`missionConfigFrom` 是明列欄位、不透傳未知資料**（`missions.ts:733`），漏抄會靜默消失 → **要有透傳測試**：一張帶 `blueLoadout` 的卡片，走完 `missionConfigFrom` 之後 `BattleConfig` 上讀得到同一個物件
- [ ] **Step 5:** 全套綠、`npx tsc --noEmit` 0 錯誤

**Verification:** `bomb-bay.test.ts` 現有的 15 條改寫成讀 `Loadout` 之後**一條都不能少**；`bomb-vs-ship.test.ts` 的 G4M 兩條要改成魚雷的語意或改用 `he111`。

---

### Task 2: 投放包絡

**Files:**
- Create: `src/weapons/envelope.ts`
- Test: `test/unit/envelope.test.ts`

**Interfaces:**
- `interface ReleaseEnvelope { maxRoll, minPitch, maxPitch, minAgl, maxAgl, minTas, maxTas }`
- `canRelease(env, roll, pitch, agl, tas): boolean`
- `BOMB_ENVELOPE`、`TORPEDO_ENVELOPE`、`envelopeFor(kind: OrdnanceKind): ReleaseEnvelope`

**值（spec §5.2，起始值）：**

```
                    |roll|     pitch        AGL          TAS
  BOMB_ENVELOPE      ≤ 90°   −70°…+70°    ≥ 60 m       不限
  TORPEDO_ENVELOPE   ≤ 12°    −6°…+6°    20…120 m      不限
```

**兩張表的 `minTas` 都是 0、`maxTas` 都是 `Infinity`**（負責人 2026-09-06：
魚雷包絡先不限速度）。欄位保留 —— 重開限制時改一個數字，不是改簽章。

- [ ] **Step 1: 寫失敗的測試**
  - 倒飛（roll = ±180°、±91°）在**兩張表**都投不出去
  - 魚雷包絡：`roll`、`pitch` 上下、`agl` 上下共六個邊界，各驗「剛好在內」與「剛好在外」
  - 炸彈包絡在「平飛、AGL 60…8,000 m、任意速度」的整條帶上恆為真
  - **`maxTas = Infinity` 時任何速度都過**（含 0 與 1e9）—— 這一條守住「不限速度」是真的不限
  - `roll` 用絕對值：`−89°` 與 `+89°` 結果相同
- [ ] **Step 2: 實作。** 不得 `new`，不得呼叫三角函數（門檻直接存 rad）
- [ ] **Step 3:** 全套綠

**Verification:** mutation —— `maxRoll` 的比較由 `<=` 改成 `<` 之後邊界那一條必須紅；`maxAgl` 由 120 改成 121 之後上界那一條必須紅。

---

### Task 3: 船的吃水

**Files:**
- Modify: `src/world/ships.ts`（三個艦體盒的底、`hp` 那一段註解）
- Test: `test/unit/ship-draft.test.ts`

**改動（spec §4）：** 艦體盒底 `0.0` → fletcher `−4.0`、wichita `−6.5`、essex `−8.5`。
**Essex 的第二個盒（飛行甲板 `[12.0, 14.0]`）不動。**

- [ ] **Step 1: 寫失敗的測試**
  - **釘死每一個值**：三個艦體盒的 `center.y − half.y` 分別是 −4.0 / −6.5 / −8.5，且 Essex 第二個盒仍是 12.0 —— 不寫成「至少一個 < 0」，那樣改成 −0.01 也會綠
  - 盒頂仍分別是 4.5 / 7.0 / 12.0（沒有順手動到）
  - **迴歸護欄**：`py ≥ 0` 的網格取樣上，`bombBlastDamage(pointBoxDistance(...))` 與改盒前**逐位元相同**（`Object.is`）。期望值在改盒**之前**先跑一次取得並寫成字面常數
  - 盒頂仍低於該艦最低的砲位（既有護欄不得因此變紅）
- [ ] **Step 2: 改盒**
- [ ] **Step 3:** `test/unit/ships.test.ts`、`test/unit/bomb-vs-ship.test.ts`、`test/integration/ship-aa.test.ts` 全綠
- [ ] **Step 4:** 改 `ships.ts:47` 的血量註解 —— 括號裡的「若一枚 10,000」換成現行的 15,000，枚數重算（2 / 3 / 4）

**Verification:** 迴歸護欄的期望值要在**舊盒**上跑一次取得。兩次結果不同就是 spec §4.1 算錯了，**停下來報告，不要調容差**。（已先量過：`py ≥ 0` 的 21,525 個取樣點全等。）

---

### Task 4: 魚雷彈道

**Files:**
- Create: `src/world/torpedo.ts`
- Test: `test/unit/torpedo.test.ts`

**Interfaces:**
- Consumes: `stepBomb`、`BombState`、`BOMB_MAX_SECONDS` from `src/world/bomb.ts`
- Produces:
  - `TORPEDO_SPEED = 22`、`TORPEDO_RANGE = 2000`、`TORPEDO_DEPTH = 1`、`WAKE_INTERVAL = 8`
  - `type TorpedoEndFn = (x, y, z, kind: 0 | 1, damage) => void`（0 撞岸、1 撞船）
  - `type TorpedoBlockFn = (x0,y0,z0, x1,y1,z1) => number`（同 `BombBlockFn`）
  - `type TorpedoPointFn = (x, y, z) => void`（`onEntry` 與 `onWake` 共用）
  - `class Torpedoes`：`x/y/z/vx/vy/vz/age/run/damage/headX/headZ` 皆 `Float64Array`、`phase: Uint8Array`、`active: Uint8Array`、`dropped: number`
  - `spawn(x,y,z, vx,vy,vz, damage, headX, headZ): number`
  - `clear(): void` —— **`active` 歸零、`liveCount` 歸零、`cursor` 歸零、`dropped` 歸零**（照 `Bombs.clear`）
  - `step(dt, k, groundAt, waterAt, onEnd, onEntry, onWake, blockedBy?): void`

**行為（spec §3）：**

```
  phase 0（空中）  stepBomb + 落地內插（照抄 world/bomb.ts:366 那八行）
                   age > BOMB_MAX_SECONDS 就回收
                   內插後的落點 x/z 問 groundAt：
                     > 0  → onEnd(kind 0)
                     否則 → onEntry(落點三軸) 然後轉 phase 1
  phase 1（水中）  y ≡ −TORPEDO_DEPTH（平海常數，不吃浪）
                   水平等速 TORPEDO_SPEED，無重力無阻力
                   blockedBy 命中（bt >= 0 && bt <= 1）→ onEnd(kind 1)
                   groundAt(x, z) > 0                  → onEnd(kind 0)
                   run > TORPEDO_RANGE                 → 無聲回收，不呼叫 onEnd
                   每 WAKE_INTERVAL 公尺 → onWake(x, waterAt(x,z), z)
```

**`groundAt` 就是 `terrain.collisionHeightAt`；`waterAt` 只在 `onWake` 用一次。**

- [ ] **Step 1: 寫失敗的測試**
  - **逐位元**：同一組初始條件下 `onEntry` 收到的三軸 `toBe` 等於 `solveImpact` 的 `out.x/y/z`（不是 `toBeCloseTo`）
  - 入水後 `y` 恆等於 `−TORPEDO_DEPTH`，**第一步就是**，而且**不隨 `waterAt` 變動**（餵一個回 ±3 的 `waterAt` 進去，`y` 不變）
  - 水中段跑 10 秒之後水平位移 = `22 × 10`（容差一步），`vy === 0`
  - 射程耗盡：跑滿 2,000 m 之後 `active === 0` 且 `onEnd` **從未被呼叫**
  - **射程不被秒數截斷**：2,000 ÷ 22 = 90.9 s > `BOMB_MAX_SECONDS` 的 90，跑滿全程仍然只由航程回收
  - 撞岸：`groundAt` 在某個 x 之後回 5，魚雷到那裡結束、`kind === 0`
  - **海上不會自爆**：`groundAt` 全程回 0（平海）時跑滿射程都不 `onEnd`
  - 撞船：`blockedBy` 回 0.5，結束點是那一步線段的中點、`kind === 1`
  - 航跡：跑 80 m 剛好 10 筆 `onWake`，每一筆的 `y` 是 `waterAt` 的回值**不是** `−1`
  - 空中段落在陸地（`groundAt` 回 5）：不呼叫 `onEntry`，直接 `kind === 0`
  - 水平分量退化（`vx = vz = 0` 垂直投放）時沿用 `spawn` 帶進來的 `headX/headZ`
  - `clear()` 之後 `dropped === 0`
- [ ] **Step 2: 實作。** 逐位元那一條要求的實作次序，**寫死不得動**：
  - 池用 `Float64Array`
  - 先存 `px/py/pz`，以**完全相同的欄位順序**呼叫 `stepBomb`
  - 在**更新後**的 `(x, z)` 問 `groundAt`
  - 保留否定式 `if (!(y <= g))`
  - 內插的算式與運算順序**逐字**照抄 `world/bomb.ts:366`
  - 水陸分類問的是**內插後**的落點 x/z
- [ ] **Step 3:** 全套綠

**Verification:** 逐位元那一條先用 `toBeCloseTo(…, 10)` 確認數量級，再改成 `toBe`。`toBe` 紅就是空中段沒有共用 `stepBomb` —— **修實作，不要放寬斷言。**

---

### Task 5: `World` 的接線

**Files:**
- Modify: `src/world/World.ts`、**`src/battle/setup.ts`**（`resetBattle` 清池）
- Test: `test/unit/torpedo-vs-ship.test.ts`

**Interfaces（spec §7）：**
- `readonly torpedoes = new Torpedoes()`
- `readonly torpedoEvents: ImpactEvents`（`nx` = 0 岸／1 船，`ny` = damage）
- `readonly torpedoWakeEvents: ImpactEvents`（入水與航跡共用）
- `dropTorpedo(x, y, z, vx, vy, vz, damage, headX, headZ): void`
- `private torpedoShip: Ship | null`
- `private onTorpedoBlocked: TorpedoBlockFn` —— **只掃 `sh.cls.hull`，不掃砲位**；第一行清 `torpedoShip = null`；比較寫成 `t === NO_HIT || (best !== NO_HIT && t >= best)`
- `private onTorpedoEnd` —— `kind === 1 && torpedoShip !== null` 時 `sh.hp -= damage` 再 `sinkIfDead`

`step()` 的 3.5 之後插 3.6。

- [ ] **Step 1: 寫失敗的測試**
  - 命中 Fletcher 扣滿 15,000
  - 三級船各要幾枚沉（2 / 3 / 4）
  - **不掃 `combatants`**：一架飛機停在爆點上，血量不變
  - **不掃砲位**：魚雷從砲位盒正下方（y = −1）通過，不打掉任何砲位
  - **spec §1.3 那個坑**：魚雷從船底下 −1 m 通過**會**命中（Task 3 之前這一條紅）
  - **多船同線**：兩艘船排在同一條航線上，扣血的是**近的那一艘**（`t` 最小）
  - 死掉的船不再擋雷
  - `torpedoEvents` 的編碼：`nx` 是 0/1、`ny` 是 damage
  - `dropTorpedo` 的散佈由 `dropped` 決定，同一組輸入兩次結果相同
  - **`resetBattle` 之後**：池空、`dropped === 0`
- [ ] **Step 2: 實作**
- [ ] **Step 3:** 全套綠

**Verification:** 「不掃砲位」與「近的那一艘」兩條先把實作故意改壞，確認會紅。

---

### Task 5.5: 量效能，報告數字

**Files:** 無（只跑與記錄）

Codex 指出：現行 `perf-gate` 的 20v20 負載走 `DEFAULT_BATTLE`，**沒有艦隊也沒有魚雷**，所以「跑 perf-gate 是綠的」對這一輪不承重。

改用平海判準之後每枚活魚雷每個物理步的成本是：**1 次高度場取樣**（零次 `sin`）＋ 對每一艘船 1 次線段到船心的粗篩。8 枚 × 8 艘 × 240 Hz = 每秒 15,360 次粗篩、1,920 次取樣。

- [ ] **Step 1:** 在 `bench/` 加一支一次性的量測（不進 `perf-gate` 的護欄清單），載入含艦隊的關卡、生 8 枚活魚雷，量 `World.step` 的每步時間
- [ ] **Step 2:** 與同一台機器上的空池基準線對照，**把兩個數字報告給負責人**
- [ ] **Step 3:** 若逼近門檻，**先報告再談對策** —— 護欄重新定值是負責人的決定

---

### Task 6: 模型

**Files:**
- Modify: `src/render/bombs.ts`（`PROFILE` 與尾翼常數參數化）
- Create: `src/render/torpedoes.ts`
- Test: 改 `test/unit/bomb-geometry.test.ts`

**Interfaces:**
- `createBombGeometry(shape: OrdnanceShape): BufferGeometry`
- `BOMB_SHAPE`、`TORPEDO_SHAPE`（軸向 ×3.3、徑向 ×1.25、尾翼跨度 = 直徑 ×1.5）
- `createTorpedoes(): TorpedoVisuals`，形狀同 `createBombs`

- [ ] **Step 1: 寫失敗的測試**
  - 魚雷全長 ≈ 5.27 m、最大直徑 ≈ 0.45 m（由幾何的包圍盒量）
  - **`BOMB_SHAPE` 的頂點與索引陣列與參數化之前逐位元相同** —— 改之前先把 `position` 與 `index` 兩個陣列 dump 成字面常數，測試逐格比。**只比頂點數與包圍盒抓不到頂點重排或局部變形**
  - 姿態沿用 `bombOrientation`（既有護欄不得變紅）
- [ ] **Step 2: 實作**
- [ ] **Step 3:** 全套綠

---

### Task 7: 命中的爆炸配方

**Files:** Modify `src/render/blast.ts`；Test 改 `test/unit/blast.test.ts`

```
                  jetCount  jetSpread  jetHeight  jetRadius  mistPerJet
  TORPEDO_BLAST       9       4.0 m      46 m       3.6 m         6
```

- [ ] **Step 1: 寫失敗的測試**
  - **釘死上表每一個值**（不寫成「比 `WATER_BLAST` 窄／高」—— 那樣填錯數字也會綠）
  - `fire*` / `smoke*` / `dust*` / `glow*` **每一個欄位**都是 0（不只 `fireCount`）
  - `scaleBlast(TORPEDO_BLAST, …)` 與其他配方走同一支
- [ ] **Step 2: 實作**

---

### Task 8: HUD

**Files:** Modify `src/hud/types.ts`、`src/hud/widgets/bombsight.ts`、`src/hud/widgets/bombBay.ts`

- `HudFrame` 加 `releaseOk: boolean`、`ordnance: OrdnanceKind | null`
- `bombsightColor(style: BombsightStyle, releaseOk: boolean): string`

- [ ] **Step 1: 寫失敗的測試**
  - `bombsightColor` 四種組合：ring×ok = `primary`、ring×!ok = `danger`、faint×ok = `dim`、faint×!ok = 紅的暗色
  - `bombsightStyle` 的既有五條**不得改變**（顏色與樣式是兩件事）
  - `ordnance === null` 時彈艙不畫
  - `ordnance === 'torpedo'` 時 1 格、圖示是魚雷
  - `textBaseline` 護欄（`hud-text-state.test.ts`）仍綠
- [ ] **Step 2: 實作**

---

### Task 9: `main.ts` 串接

**Files:** Modify `src/main.ts`、`src/weapons/bomb.ts`（`stepBombBay` 收 `releaseOk`）
**Test:** 改 `test/unit/bomb-bay.test.ts`（狀態機）、`test/unit/pool-reset-entrypoints.test.ts`（寫死的 POOLS 清單）、確認 `test/unit/bomb-bay-wiring.test.ts` 仍綠

- [ ] **Step 1: `stepBombBay(b, dt, trigger, releaseOk, drop)`。** 先寫失敗的測試：
  - `releaseOk === false` 時按扳機**不排入 queue**
  - `releaseOk` 在連投中途轉 false：**queue 暫停**，`load` 與 `queue` **都不遞減**（彈藥不被無聲吃掉）
  - 轉回 true 之後**接著投完剩下的**
  - `releaseOk === false` 期間 `timer` 與回補**照常推進**
- [ ] **Step 2:** 建 `torpedoVisuals`，加進場景與 `POOLS`，**同步更新 `pool-reset-entrypoints` 的寫死清單**（`flakBursts` 那次已經紅過一次）
- [ ] **Step 3:** `syncBombLoad` 改讀 `loadoutOf` / `mission.blueLoadout`，寫入 `hudFrame.ordnance`
- [ ] **Step 4:** 每幀算 `releaseOk`：`attitudeFromOrientation` 的 roll/pitch、`renderPos.y − terrain.collisionHeightAt(x, z)` 的 AGL、`aircraft.diag.aero.tas`，餵 `canRelease(envelopeFor(kind), …)`
- [ ] **Step 5:** `drop()` 依 `kind` 分流 `world.dropBomb` / `world.dropTorpedo`（後者要帶**機首的水平方向**）
- [ ] **Step 6:** 消費 `world.torpedoEvents` → `emitBlast(TORPEDO_BLAST)`；`world.torpedoWakeEvents` → `emitSpray(spray, …, WAKE_SPRAY_COUNT)`。兩者在**物理子步**的回呼裡消費並 `clearImpacts`（同 `bombEvents`）
- [ ] **Step 7:** 全套綠（`perf-gate`、`rematch` 單獨跑）

**Verification:** 手動試飛：G4M 起飛 → 按 B → 爬升時準星紅、改平轉綠 → 投雷 → 入水、航跡、命中水柱 → 兩枚沉一艘 Fletcher。

---

### Task 10: 展示區

**Files:** Create `torpedo.html`、`src/tools/torpedo.ts`；Modify `vite.config.ts`

演一整條：投放 → 空中段 → 入水 → 航跡 → 命中引爆。旋鈕見 spec §8（**速度那一格留著當視覺參數，包絡不吃它**）。

- [ ] **Step 1:** 照 `blast.html` / `src/tools/blast.ts` 的慣例建檔
- [ ] **Step 2:** 旋鈕：投放高度 AGL、投放速度、坡度／俯仰、定深、雷速、射程、航跡間隔／顆數、目標距離、目標航速、播放速度、自動重播
- [ ] **Step 3:** 準星的紅綠**也要畫在展示區**上
- [ ] **Step 4:** `__torpedoProbe.sheet()`：固定 dt 手動推進、瀏覽器內合成 contact sheet
- [ ] **Step 5:** `npm run build` 產出所有 entry

---

## 實作與計畫的差異（做完之後回填）

| 計畫寫的 | 實際做的 | 為什麼 |
|---|---|---|
| `weapons/envelope.ts` | **`weapons/releaseEnvelope.ts`** | `analysis/envelope.ts` 已經佔了那個字（飛行包絡）。用同名時我真的**整份覆蓋掉了既有的 `test/unit/envelope.test.ts`**（32 條），而且全套仍然是綠的 —— 測試消失不會紅 |
| `render/torpedoes.ts` | `createTorpedoes()` 放在 **`render/bombs.ts`** | 兩者共用 `createOrdnanceVisuals`，差別只有幾何、容量與顏色。另開一個檔只會是一支五行的轉呼叫 |
| — | `Torpedoes` 加 **`tuning`** 欄位 | 展示區要拉雷速／定深／射程／航跡間隔的滑桿。預設等於那四個常數，遊戲路徑不動它 —— 同 `World.bombDrag` 是注入的 |
| — | `vite.config.ts` 加 **`build.target: 'es2022'`** | `vite build` **本來就是壞的**：`main.ts` 與五個工具頁都用 top-level await，而預設 target 是 es2020。dev server 照樣能開，所以一直沒被發現。不修的話這一輪的展示區驗不了打包 |
| 魚雷包絡限速 55…110 m/s | **不限速** | 負責人 2026-09-06 中途裁定 |
| 「不掃砲位」要有承重的護欄 | **做不到，已在註解裡寫明** | 砲位盒全在甲板上，定深 1 m 的魚雷本來就碰不到 —— 掃與不掃**行為等價**（mutation 驗過：故意改成掃砲位，17 條全綠）。那是成本決定，不是行為差異 |

## 收尾

- [x] `npx tsc --noEmit` 的 `src/` 0 錯誤
- [x] 全套測試（`perf-gate`、`rematch` 單獨跑）
- [x] Task 5.5 的效能數字已量（見 spec §9）
- [ ] Codex 審查 commit
- [ ] Playwright 驗收
- [x] `docs/roadmap.md` 的「魚雷」那一行打勾
