# 德 M4「庫斯克」Implementation Plan

> **已被取代**：德 M4 改成勒熱夫的冬季版，見 `2026-10-03-germany-m4-rzhev-winter.md`。

**Goal:** 德國線第四張卡：Ju 87 B-2 ×4 先炸 6 門反坦克砲，再炸 4 輛反擊的 T-34；下面的
德蘇坦克互射是純畫面的戲。

**Architecture:** 地面單位仍是 `GroundTarget`。三樣新機制：

1. **事件啟動的縱隊**：出發時刻放在單位身上（`GroundTarget.departAt`，可變），由新的
   `depart` 節拍寫入；位置仍是時間的純函數，走到終點停住
2. **換目標節拍** `retarget`：把 `destroy` 規則換成另一種單位與數量、換目標文字
3. **照劇本擊毀**：`GroundEntry.killAt`，時間到了在 `World.step` 走擊毀流程，旗標
   `scripted` 讓它不算進摧毀數

互射、彈著、砲兵塵土、長燒的煙是**渲染層**的模組，讀世界的地面目標，不進 `BattleConfig`。

**Spec:** `docs/superpowers/specs/2026-10-01-germany-m4-kursk-design.md`

## Global Constraints

- 註解與文件用繁體中文，寫現狀與理由，不寫沿革與裁決出處（`CLAUDE.md` §1）
- 改檔案用編輯工具（`CLAUDE.md` §2）
- 熱路徑（240 Hz）不配置記憶體
- `npx tsc --noEmit` 動工前基準 **0 個錯誤**，完工後仍須是 0
- 只跑相關測試：`npx vitest run <檔案>`；整層 `--maxWorkers=4 --minWorkers=1`
- 只測小部件，不寫跑整關的測試；新測試先驗紅
- trailer 只留 `Co-Authored-By`；不 `git add -A`；功能分支只 commit 不 push
- 數值全部是**起始值，由試飛裁定**
- 世界座標：藍隊開局在 +Z 朝 −Z。敘述的「南（德軍）」= +Z，「北（蘇軍後方）」= −Z

## 檔案地圖

```
  新增  src/world/kursk.ts                  地形生成器、丘陵、道路、全部擺位常數
  新增  src/render/groundBattle.ts          地面戰的戲（互射、彈著、砲兵塵土、長燒的煙）
  新增  test/unit/kursk.test.ts
  新增  test/unit/ground-battle.test.ts     射擊排程的純函數
  新增  test/unit/ground-column.test.ts     縱隊的出發與停住、照劇本擊毀
  修改  src/render/geometry/ground/index.ts 四個新單位 id（暫代模型）
  修改  src/world/groundTargets.ts          HP／裝甲／價值；departAt、killAt、scripted
  修改  src/world/groundMotion.ts           motionPose 改吃 departAt；hold 模式
  修改  src/world/World.ts                  照劇本擊毀（公開的 scriptKill）
  修改  src/battle/beats.ts                 DepartBeat、RetargetBeat
  修改  src/battle/setup.ts                 stepBeats 的兩個效果；destroyedInPool 排除 scripted；placeGround 帶 killAt
  修改  src/battle/missions/types.ts        MissionGroundColumn、MissionRetarget、GroundEntry.killAt、MissionTheater；Campaign 註解
  修改  src/battle/missions/index.ts        columns 展開、depart／retarget 節拍
  修改  src/battle/missions/germany.ts      germany-m4
  修改  src/world/terrainKind.ts、src/render/terrain.ts、src/ui/menu.ts   kursk 地形
  修改  src/i18n/zh.ts、en.ts、names.ts     卡片文案、地形名、單位名
  修改  src/main.ts                         建立／更新／釋放地面戰的戲
  修改  test/unit/campaigns.test.ts、briefing.test.ts   拿掉張數斷言，改結構斷言
```

## Task 1：拿掉每陣營三關的張數斷言

- `campaigns.test.ts`：`toHaveLength(3)`、`toBe(9)` ×2、九個可玩 id 的清單 → 改成
  「每張的前綴等於戰役」「id 唯一」「兩種語言標題唯一」「每張都可玩（`battle !== null`）」
- `briefing.test.ts:166-169`：`placeKey` 集合大小 `toBe(9)` → `toBe(全部卡片數)`
- `types.ts:200` 的 `Campaign` 註解「三條線各 4 關」改成不寫張數
- 驗：現有 9 張下全綠；把一張卡的 id 改成重複 → 紅

## Task 2：四個新單位 id（暫代模型）

`GROUND_UNITS` 加：

| id | model | real* 與 hull |
|---|---|---|
| `panzer4` | `m4a3.glb`，`barrelNodes: ['M4_Gun']` | 抄 `usTank` |
| `tiger` | 同上 | 抄 `usTank` |
| `atGun` | `flak38.glb`，`barrelNodes: ['F38_Barrel_']` | 抄 `flakLight` |
| `tankDug` | `t34.glb`，`barrelNodes: ['T34_Gun']` | 抄 `tank` |

- `GROUND_HP`：panzer4／tiger 抄 usTank；atGun 160；tankDug 抄 tank
- `GROUND_ARMOUR`：panzer4／tiger 抄 usTank；atGun 抄 flakLight；tankDug 抄 tank
- `GROUND_VALUE`：`atGun: 5_000`、`tank: 2_000`、`tankDug: 600`（AI 先炸反坦克砲、再炸
  反擊的 T-34，最後才是第一線）
- `i18n/names.ts` 的 `GROUND`：四個名字，兩種語言各不相同（`i18n-names.test.ts` 守）
- 另加 `infantry`：一個班，五根圓柱（直徑 0.5 m、高 1.8 m，左右對稱散在 8 × 4 m 內），
  `model: { build: buildInfantrySquad }`；HP 60、裝甲 0、`GROUND_VALUE` 10（AI 最後才炸）
- `atGun` 不在 `placeGround` 的掛砲分支裡 → 不對空射擊（不必改碼，測一條）
- `tank` 的 `note` 改成「蘇軍戰車 — 德 M4 庫斯克（反擊縱隊）」
- 驗：`ground-units.test.ts`、`ground-targets.test.ts`、`i18n-names.test.ts` 綠

## Task 3：縱隊的出發時刻放在單位上、走到終點停住

**為什麼不寫回 `GroundMotion.departAt`：** 有節拍的卡重開時用同一份 `cfg` 重建 World
（`main.ts` 的 `restartBattle`），`motion` 物件是 `cfg.ground` 裡共用的那一份。寫回去的話
第二場的縱隊開場就在走。

- `GroundMotion` 加 `readonly hold: boolean`（走完停住）；`createGroundMotion(..., hold = false)`
- `motionPose(m, departAt, time, out)`：`departAt` 由呼叫端給。`hold` 時 `tau` 夾在
  `totalSeconds` 之前一點，回傳 true
- `GroundTarget` 加 `departAt: number`（可變），建立時抄 `motion?.departAt ?? Infinity`；
  `resetGroundTarget` 抄回去
- `stepGroundMotion` 讀 `t.departAt`；`hold` 的車走完設 `speed = 0`，不設 `arrived`
- `convoyGround` 的呼叫改成新簽名，行為逐位元不變
- 測試 `ground-column.test.ts`：
  - `departAt = Infinity` 時永遠停在集結位置
  - 設成 T 之後，T 之前不動、之後沿路走
  - `hold` 走完停在終點、`alive` 仍為 true、`arrived` 為 false
  - 不 hold 的仍然退場（既有的雷伊泰行為）
  - `resetGroundTarget` 把 `departAt` 抄回開局值

## Task 4：照劇本擊毀

- `GroundEntry.killAt?: number`（世界秒）
- `GroundTarget` 加 `killAt: number`（預設 `Infinity`）、`scripted: boolean`
- `World.step`：`stepGroundMotion` 之後，對 `alive && time >= killAt` 的呼叫
  `scriptKill(t)`：`hp = 0、alive = false、scripted = true`，推 `groundKillEvents`，
  killer −1；`killAt === 0` 的那一筆 `nz = 1`（開場殘骸：不爆、不震、照樣點火）
- `destroyedInPool`：`scripted` 一律 false
- `resetGroundTarget`：`scripted = false`
- 熱路徑：只有一次比較，不配置
- 測試：時間到了才擊毀；`killAt: 0` 第一步就是殘骸；不算進 `countDestroyed`；
  `resetGroundTarget` 之後復活

## Task 5：兩個新節拍

```ts
export interface DepartBeat {
  readonly kind: 'depart'
  readonly when: BeatCondition
  /** `world.groundTargets` 的索引範圍 [first, first + count) */
  readonly first: number
  readonly count: number
}

export interface RetargetBeat {
  readonly kind: 'retarget'
  readonly when: BeatCondition
  readonly messageKey: MessageKey
  readonly count: number
  readonly unit: GroundUnitId
}
```

- `stepBeats` 的效果分支：
  - `depart`：範圍內每一台 `departAt = now`
  - `retarget`：`b.rules = { kind: 'destroy', count, unit }`、`resetMissionState`、
    `b.objectiveKey = messageKey`；`b.message` 在 warned 那一步設（同 `withdraw`）
- `stepBeats` 在 `stepMission` 之前，所以第 6 門炸掉的那一步先換規則，不判勝 —— 測一條
- 測試放在既有的節拍測試旁（`test/unit/beats*.test.ts` 或新檔）：
  - `depart` 觸發前縱隊不動、觸發那一步之後開始走
  - `retarget` 觸發後 `rules.unit` 換掉、目標文字換掉、同一步沒有判勝
  - 第二段數到 `count` 才判勝

## Task 6：卡片型別與展開

```ts
export interface MissionGroundColumn {
  readonly team: Team
  readonly route: readonly { readonly x: number; readonly z: number }[]
  readonly speed: number
  readonly turnRadius: number
  readonly gap: number
  readonly units: readonly GroundUnitId[]
  readonly depart: MissionTrigger
}

export interface MissionRetarget {
  readonly when: MissionTrigger
  readonly messageKey: MessageKey
  readonly destroyCount: number
  readonly destroyUnit: GroundUnitId
}
```

- `MissionBattle.columns?`、`MissionBattle.retarget?`、`GroundEntry.killAt?`
- `missionConfigFrom`：`ground = [...ground, ...convoyGround, ...columnGround]`。每一個縱隊
  記下它在清單裡的起點索引，`cardBeats` 推一個 `depart` 節拍
- 縱隊的集結：第一輛在路線起點往前 `(n − 1) × gap`，依序往後排；`departAt = Infinity`、
  `hold = true`
- `cardBeats` 推 `retarget`（排在 withdraw 之前）
- `campaigns.test.ts` 的結構斷言：
  - `retarget.destroyCount ≤` 紅方該單位的數量（含縱隊）
  - 縱隊的路線至少兩點、`units` 非空
  - `killAt` 的單位不是 `destroyUnit` 或 `retarget.destroyUnit` 的那一種（劇本不搶玩家的目標）

## Task 7：地形 `kursk`

- `world/kursk.ts`：
  - `createKursk()`：`createHeightField(FARM_SIZE, FARM_CELL)`，手擺 `KURSK_HILLS`
    （北方高地峰高 60 m、西側緩丘 30 m），`bakeRelief`；照 `world/poltava.ts` 的寫法
  - `KURSK_ROADS`：南北兩條土路（推進與反擊共用），世界座標
  - 擺位常數：`AT_GUNS`、`FRONT_T34`、`PANZERS`、`WRECKS`、`SOVIET_FLAK`、`TRUCKS`、
    兩條縱隊的路線（取 `KURSK_ROADS` 的片段）
- `terrainKind.ts` 加 `'kursk'`；`render/terrain.ts` 加 `createKurskTerrain` 與 `KURSK_SITE`
  （`createInlandTerrain(createKursk(), 'summer', KURSK_SITE, undefined, gfx)`，照阿什）
- `ui/menu.ts` 的 `TERRAINS` 加一項（SVG 照晚秋內陸改色）；`terrain.kursk`／`.hint` 兩種語言
- `kursk.test.ts`：丘陵不重疊（`HILL_GAP`）、峰高 ≤ `HILL_PEAK_MAX`、反坦克砲線與德軍
  坦克相距 ≥ 500 m、所有擺位在 ±1,500 m 的戰場框內、道路在場地內

## Task 8：卡片 `germany-m4`

- 接在 `GERMANY` 最後；`type: 'strike'`、`period: 1943-07`、`terrain: 'kursk'`、
  `altitude: 2000`、`entry: 'headOn'`、`timeOfDay: 'noon'`
- `blueSpec: JU87`、`blueCount: 4`、`redSpec: P51D`、`redCount: 0`、`convoySpec: null`、
  `convoyCount: 0`、`convoyPriority: 1`、`targetDistance: 0`、`targetRadius: 0`、
  `seconds: Infinity`
- `ground`：反坦克砲 6、第一線 `tankDug` 6、殘骸（`panzer4` ×2 `killAt: 0`、`tankDug` ×1
  `killAt: 0`）、雷區前停著的 `panzer4` ×2、`flakLight` 4、`truck` 4；
  步兵：德軍 6 個班在雷區後、蘇軍 8 個班沿壕溝線；
  劇本擊毀：開場後 40 秒一輛停著的 `panzer4`、95 秒一輛 `tankDug`、150 秒另一輛 `panzer4`
  （劇本只打 `ground` 的條目，縱隊的單位沒有 `killAt`）
- `columns`：德軍兩路（`panzer4`／`tiger`，藍）與蘇軍反擊（`tank` ×6，紅），全部
  `depart: { kind: 'destroyed', atLeast: 6, unit: 'atGun' }`
- `destroyCount: 6, destroyUnit: 'atGun'`；`retarget`：同一個觸發，`destroyCount: 4,
  destroyUnit: 'tank'`
- **德軍坦克的兩種身分**：會推進的 8 輛 `panzer4`＋2 輛 `tiger` 寫在 `columns`（兩路），
  集結位置就是開場的擺位；`ground` 裡的德軍只有殘骸與劇本要打掉的兩輛
- 文案（zh／en）：title、summary、place、objective、banner（中文 ≤ 14 字）、retarget 的訊息
- 驗：`campaigns.test.ts`、`missions.test.ts`、`briefing.test.ts`、`i18n-guard.test.ts` 綠

## Task 9：地面戰的戲（渲染層）

`MissionBattle.theater?: MissionTheater`，**不進 `BattleConfig`**（與 `timeOfDay` 同一條
路：`main.ts` 直接從卡片讀）。

```ts
export interface MissionTheater {
  /** 會開砲的單位 */
  readonly shooters: readonly GroundUnitId[]
  /** 平均幾秒一發，s */
  readonly period: number
  /** 射程，m：範圍內最近的敵方才打 */
  readonly range: number
  /** 砲兵彈著的矩形與平均間隔 */
  readonly artillery?: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly period: number }
  /** 整場不熄的煙柱（村莊的火） */
  readonly smokes?: readonly { readonly x: number; readonly z: number }[]
}
```

- **射擊排程是純函數**：第 i 台的第 k 發在 `phase(i) + Σ period × (0.7 + 0.6 × hash(i, k))`；
  每一幀算出 (上一幀, 這一幀] 之間的發數。`hash` 是整數雜湊，不用亂數狀態
- 一發：找範圍內最近的存活敵方 → 坦克與反坦克砲：砲口槍焰＋一小團煙（單位前方的固定
  偏移：車長的一半、車高的八成）；步兵：沒有槍焰 → 曳光（自己的 `Projectiles` 池餵
  `createTracers`，世界看不到這個池；步兵另一個池、`createTracers(cap, 0.5)`）→ 到達時
  彈著：雜湊決定命中（火花）或打偏（塵土，落在目標旁 8–25 m）
- `createTracers(capacity, widthScale = 1)`：半徑與最小像素寬同乘 `widthScale`；
  `customProgramCacheKey` 帶上倍率。既有呼叫不變
- 砲兵：矩形內的雜湊位置，`blastDust`
- 長燒的煙：`scripted` 而且死掉的單位，加上 `smokes` 的點，定時往 firePuff 池補一團
- 死掉的射手不開砲；沒有範圍內的敵人就跳過那一發
- 每幀的工作量：射擊數個位數，最近敵人的搜尋只在開砲時做。不在物理步裡
- `ground-battle.test.ts`：排程的純函數（同一區間同結果、區間可拼接、間隔落在
  0.7–1.3 倍）、最近敵人的挑選（跳過同隊、跳過死的、超出射程回 −1）

## Task 10：接到 `main.ts`

- 戰鬥建好之後（`groundModels` 旁邊）：`pendingMission?.battle.theater` 有值就建
  `createGroundBattle(scene, theater, …)`；每幀 `update(world.groundTargets, worldSeconds, dt)`；
  `releaseVisuals` 時釋放
- 重開（有節拍的卡走重建）要跟著重建

## Task 11：驗收

1. `npx tsc --noEmit` 0 個錯誤
2. 動到的測試檔全部綠；新測試各自驗紅過一次
3. Codex 審查實作（背景執行）
4. Playwright：選德國 M4 進場 → 截圖開場的戰場（互射、殘骸的煙）→ 用測試掛勾把反坦克砲
   炸光 → 截圖縱隊推進、目標文字換成第二段 → 再炸 4 輛 `tank` → 截圖勝利畫面
5. commit（不 push），請負責人試玩

## Codex 審查後的修正（以下覆蓋前面各 Task 的對應寫法）

1. **戲的時間**：`update(targets, world.time, worldSeconds)` —— 排程吃絕對的世界秒數，
   `worldSeconds` 只是這一幀前進了多少
2. **縱隊停住要保持車距**：`createGroundMotion(path, motion, startS, departAt, holdBack)`，
   `holdBack` 是這一輛停在終點前多少公尺（第一輛 0、往後每輛加 `gap`）。`holdTau =
   totalSeconds − holdBack / speed`；`holdBack` 省略 = 不停、走完退場（既有行為）
3. **第二段不能被預先炸光**：縱隊多一格 `hidden?: true` —— 出發前**不在場上**
   （`GroundTarget.dormant`：`alive = false`、不畫、不擋彈、不算摧毀）。`depart` 節拍
   把它變回 `alive = true`。蘇軍反擊縱隊用它，德軍縱隊開場就在
4. **卡片明列 `theater`**：shooters `panzer4`／`tiger`／`tank`／`tankDug`／`atGun`／
   `infantry`，period 7 s，range 1,500 m，砲兵 `ARTILLERY_ZONE` 每 2.5 s，煙柱 `KURSK_SMOKES`
5. **行進揚塵**：戲的模組對 `speed > 0` 的地面單位每 0.35 s 在車尾補一團塵土
6. **換目標不配置**：`RetargetBeat` 帶一份**建場時就建好**的 `MissionRules`，觸發時只
   換參考

## 風險

- **炸彈敵我都吃**：反坦克砲線與德軍坦克相距 ≥ 500 m。縱隊推進之後會靠近蘇軍陣地，
  第二段炸 T-34 時有誤傷的可能 —— 這是試玩要看的，不先擋
- **AI 僚機挑目標靠固定價值**：第一段若反坦克砲全滅前縱隊 T-34 就在 8 km 內，AI 會照價值
  先炸反坦克砲（5,000 > 2,000），沒有問題；第二段第一線的 `tankDug`（600）排在 `tank` 後面
- **暫代模型**：IV 號與虎式都是 M4A3 的樣子，試玩時要知道那是暫代
