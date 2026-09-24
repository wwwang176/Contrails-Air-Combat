# 日 M2「雷伊泰前線」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `japan-m2` 由漢口上空換成雷伊泰前線：Ki-84 掛彈截斷沿公路移動的補給車隊，炸夠之後撤離，F6F 堵在退路上。

**Architecture:** 車輛仍是 `GroundTarget`，多帶一份 `motion`，由 `World.step` 依世界時間沿路線（滑行腳本抽出來的 `walkRoute`）擺位。新規則 `interdict` 只判敗（卡車抵達、全滅），勝利由新條件 `destroyed ≥ N` 觸發的返航節拍轉成 `evacuate` 給。新地形 `leyte` 由自己的生成器建高度場，算繪沿用群島的低多邊形網格（改成方塊切片）、海面與植被機制，公路畫在地面材質的 shader 裡。

**Tech Stack:** TypeScript、three.js、vitest、Playwright（e2e 用 vite-node 跑）

**Spec:** `docs/superpowers/specs/2026-09-23-japan-m2-leyte-design.md`

## Global Constraints

- 全部註解與文件用繁體中文；註解寫現狀與理由，不寫沿革、不寫裁決出處（`CLAUDE.md` §1）
- 改檔案用編輯工具，不寫腳本做字串取代（`CLAUDE.md` §2）
- 熱路徑（240 Hz 物理步）不配置記憶體
- `npx tsc --noEmit` 動工前基準是 **0 個錯誤**，完工後仍須是 0
- 測試只跑相關的：`npx vitest run <檔案>`；整層用 `--maxWorkers=4 --minWorkers=1`
- 只寫小部件的測試，不寫跑整關的遊戲性測試
- 護欄要能被殺死：新測試先驗紅
- 提交訊息的 trailer 只留 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`；不要 `git add -A`
- 全部數值是**起始值，由試飛裁定**，註解要寫明
- 世界座標：藍隊開局在 +Z 朝 −Z。敘述的「西（內陸、撤離）」= +Z，「東（海、灘頭）」= −Z

## 檔案地圖

```
  新增  src/world/leyte.ts                    地形生成器與全部座標常數（海岸線、公路、灘頭、前線、撤離點、丘陵）
  新增  src/world/groundMotion.ts             車輛沿路線的步進（純函數＋就地寫回）
  新增  src/render/leyteGround.ts             leyte 的地色、地面切片、公路 shader
  新增  test/unit/walk-route.test.ts
  新增  test/unit/leyte.test.ts
  新增  test/unit/ground-motion.test.ts
  新增  test/unit/leyte-render.test.ts
  新增  test/unit/interdict.test.ts
  修改  src/control/takeoffRoll.ts            walkTaxi → 可參數化的 walkRoute（滑行行為逐位元不變）
  修改  src/world/groundTargets.ts            motion、arrived、speed 可變；reset 回到開局航向
  修改  src/world/World.ts                    每一步推進地面目標的 motion
  修改  src/render/groundTargets.ts           抵達的不畫
  修改  src/render/island.ts                  buildIsland 拆出以方框切片的版本
  修改  src/render/flora.ts                   leyte 的植被來源與林相覆蓋
  修改  src/render/terrain.ts                 createLeyteTerrain 與分支
  修改  src/world/terrainKind.ts              加 'leyte'
  修改  src/battle/mission.ts                 interdict 規則、MissionInputs.targetsArrived
  修改  src/battle/beats.ts                   destroyed 條件
  修改  src/battle/setup.ts                   destroyedInPool 排除抵達、抵達計數、destroyed 條件的逐單位計數、placeGround 帶 motion
  修改  src/battle/missions/types.ts          MissionTrigger.destroyed、MissionBattle.vehicleConvoy/interdict、GroundEntry.motion
  修改  src/battle/missions/index.ts          interdict 規則、車隊展開、返航節拍吃卡片高度
  修改  src/battle/missions/japan.ts          新的日 M2 卡
  修改  src/weapons/stores.ts                 KI84_BOMB_LOADOUT
  修改  src/main.ts                           HUD 門檻（objectiveNeed）
  修改  src/ui/menu.ts                        日本線說明
  修改  test/fixtures/mission.ts              合成的 KILL_CARD
  修改  test/unit/campaigns.test.ts、briefing.test.ts、battle-lights.test.ts、
        test/integration/mission-convoy.test.ts、test/e2e/mission.e2e.ts
  修改  docs/roadmap.md、docs/superpowers/specs/2026-09-13-campaign-rework-design.md
```

---

### Task 1: 滑行腳本抽出 `walkRoute`

**Files:**
- Modify: `src/control/takeoffRoll.ts`（`cornerTrim`、`walkTaxi`、`taxiSeconds`、`taxiPose`）
- Test: `test/unit/walk-route.test.ts`（新）、既有 `test/unit/takeoff-roll.test.ts`、`test/unit/asch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PoseState = { position: Vector3; velocity: Vector3; orientation: Quaternion; angularVelocity: Vector3 }
  export interface RouteMotion { readonly speed: number; readonly turnRadius: number; readonly turnRate: number }
  export const TAXI_MOTION: RouteMotion  // { speed: TAXI_SPEED, turnRadius: TAXI_TURN_RADIUS, turnRate: TAXI_TURN_RATE }
  /** 沿折線走 budget 秒，回傳走完全程（含頭尾原地轉）要幾秒；state 不為 null 時寫下那一刻的姿態，y 是機體原點高度 */
  export function walkRoute(
    path: readonly TaxiPoint[], startHeading: number, endHeading: number,
    budget: number, y: number, state: PoseState | null, motion?: RouteMotion,
  ): number
  export function headingToward(dx: number, dz: number): number
  ```

**做法：** 把 `walkTaxi` 改名為 `walkRoute` 並 export，參數 `groundY` 改成 `y`（呼叫端自己加 `GEAR_CLEARANCE`），`TAXI_SPEED`（6 處：`:223, 226, 229, 244, 247, 253`）／`TAXI_TURN_RADIUS`／`TAXI_TURN_RATE` 改讀 `motion`（預設 `TAXI_MOTION`）。`cornerTrim` 多收 `radius`。**運算順序一個字都不改**，只把常數換成同值的欄位 —— 浮點結果因此逐位元相同。

**熱路徑不配置**：`walkRoute` 目前在函式內定義 `pivot`、`arcAt` 兩個箭頭函式，每次呼叫都建閉包。車隊是 15 輛 × 240 Hz，所以把兩者改成**模組層函式**，共用的走訪狀態（`t`、`h`、`x`、`z`、`speed`、`left`）改放模組層的暫存（與既有的 `SEG_*`、`segCount` 同一種做法），運算式逐字搬過去、順序不變。

- [ ] **Step 1: 寫失敗的測試** `test/unit/walk-route.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { walkRoute, headingToward, type PoseState, type RouteMotion } from '../../src/control/takeoffRoll'

const pose = (): PoseState => ({
  position: new Vector3(), velocity: new Vector3(),
  orientation: new Quaternion(), angularVelocity: new Vector3(),
})
const CAR: RouteMotion = { speed: 10, turnRadius: 25, turnRate: 10 / 25 }
const PATH = [{ x: 0, z: 0 }, { x: 0, z: -500 }, { x: -400, z: -800 }] as const
const H0 = headingToward(0, -500)
const H1 = headingToward(-400, -300)

describe('walkRoute：車輛用的參數', () => {
  it('全程秒數等於弧切之後的路長除以車速（頭尾不必原地轉）', () => {
    const total = walkRoute(PATH, H0, H1, Infinity, 0, null, CAR)
    // 直線段 500 + 500，轉角 53.13° 以 25 m 圓弧切入
    const turn = Math.abs(H1 - H0)
    const trim = 25 * Math.tan(turn / 2)
    const len = 500 - trim + 500 - trim + turn * 25
    expect(total).toBeCloseTo(len / 10, 6)
  })

  it('位置與航向沿時間連續，沒有跳動', () => {
    const total = walkRoute(PATH, H0, H1, Infinity, 0, null, CAR)
    const a = pose()
    const b = pose()
    for (let t = 0; t + 0.05 < total; t += 0.05) {
      walkRoute(PATH, H0, H1, t, 0, a, CAR)
      walkRoute(PATH, H0, H1, t + 0.05, 0, b, CAR)
      expect(a.position.distanceTo(b.position)).toBeLessThan(10 * 0.05 + 1e-6)
      expect(a.orientation.angleTo(b.orientation)).toBeLessThan(CAR.turnRate * 0.05 + 1e-6)
    }
  })

  it('走完之後停在最後一點', () => {
    const s = pose()
    walkRoute(PATH, H0, H1, 1e6, 3, s, CAR)
    expect(s.position.x).toBeCloseTo(-400, 6)
    expect(s.position.z).toBeCloseTo(-800, 6)
    expect(s.position.y).toBe(3)
  })

  it('弧上的點離兩段折線的距離不超過 r·(1/cos(θ/2) − 1)', () => {
    const turn = Math.abs(H1 - H0)
    const bound = 25 * (1 / Math.cos(turn / 2) - 1) + 1e-6
    const total = walkRoute(PATH, H0, H1, Infinity, 0, null, CAR)
    const s = pose()
    for (let t = 0; t < total; t += 0.1) {
      walkRoute(PATH, H0, H1, t, 0, s, CAR)
      const d = Math.min(
        Math.abs(s.position.x),                                  // 第一段 x = 0
        distToSeg(s.position.x, s.position.z, 0, -500, -400, -800),
      )
      expect(d).toBeLessThan(bound)
    }
  })
})

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)))
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t))
}
```

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/walk-route.test.ts`
Expected: FAIL（`walkRoute` 不存在）

- [ ] **Step 3: 改 `src/control/takeoffRoll.ts`**

1. 在 `TAXI_TURN_RADIUS` 之後加：
```ts
/**
 * 沿路線走的三個量：直線速度、轉角圓弧的半徑、原地轉向的角速度。
 *
 * 【滑行與車隊共用一支走法】`walkRoute` 只認這三個數字；滑行用 `TAXI_MOTION`，
 * 地面車隊用自己的（`world/groundMotion.ts`）。
 */
export interface RouteMotion {
  readonly speed: number
  readonly turnRadius: number
  readonly turnRate: number
}

export const TAXI_MOTION: RouteMotion = {
  speed: TAXI_SPEED, turnRadius: TAXI_TURN_RADIUS, turnRate: TAXI_TURN_RATE,
}
```
2. `headingToward` 加 `export`。
3. `cornerTrim(turn, prevLen, nextLen)` → `cornerTrim(turn, prevLen, nextLen, radius)`，函式體的 `TAXI_TURN_RADIUS` 換成 `radius`；`buildSegments(path)` → `buildSegments(path, radius)`，呼叫 `cornerTrim(..., radius)`。
4. `walkTaxi(path, startHeading, endHeading, budget, groundY, state)` 改名 `walkRoute`、export、簽名改成 `(path, startHeading, endHeading, budget, y, state, motion = TAXI_MOTION)`；函式內：`buildSegments(path, motion.turnRadius)`；`TAXI_TURN_RATE` → `motion.turnRate`；`TAXI_SPEED` → `motion.speed`（四處：`straight / ...`、`left * ...`、兩處 `speed = ...`、`arc = ... / ...`、`k = ...`）；最後一行 `state.position.set(x, groundY + GEAR_CLEARANCE, z)` → `state.position.set(x, y, z)`。註解「熱路徑：不配置」保留，檔頭說明改成「沿折線走：直線段與轉角圓弧交替，頭尾原地轉」。
5. `taxiSeconds` 改呼叫 `walkRoute(path, startHeading, endHeading, Infinity, 0, null)`。
6. `taxiPose` 改呼叫 `walkRoute(plan.path, plan.startHeading, roll.heading, time, roll.groundY + GEAR_CLEARANCE, state)`。
7. `type PoseState` 加 `export`。

- [ ] **Step 4: 跑新測試與既有滑行護欄**

Run: `npx vitest run test/unit/walk-route.test.ts test/unit/takeoff-roll.test.ts test/unit/asch.test.ts test/unit/ai-ground-strafe.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 變異驗證** —— 暫時把 `walkRoute` 裡弧段的 `k = (s * motion.speed) / r` 改成 `(s * motion.speed) / (r * 1.1)`，確認 walk-route 的連續性或終點測試變紅，再用編輯工具改回來。

- [ ] **Step 6: Commit**

```bash
git add src/control/takeoffRoll.ts test/unit/walk-route.test.ts
git commit -m "refactor(takeoff): 滑行的折線走法抽成可參數化的 walkRoute"
```

---

### Task 2: 地形生成器 `world/leyte.ts`

**Files:**
- Create: `src/world/leyte.ts`
- Modify: `src/world/terrainKind.ts`（聯集加 `'leyte'`，檔頭「還沒做的一種：大島海岸線」那段刪掉、改寫「`leyte` 是任務專用：日 M2 雷伊泰的海岸線地形」）
- Test: `test/unit/leyte.test.ts`

**Interfaces:**
- Consumes: `createHeightField`（`world/heightfield.ts`）、`bakeRelief`、`makeLobes`、`WOBBLE_MAX`、`SEA_FLOOR`、`IslandDesc`（`world/archipelago.ts`）、`drawHillLobes`（`world/leuna.ts`）、`headingToward`（Task 1）
- Produces:
  ```ts
  export const LEYTE_SIZE = 376
  export const LEYTE_CELL = 80
  export const PLAIN_HEIGHT = 8
  export const SAND_TOP = 3
  export const LEYTE_PEAK_MAX = 150
  export function coastZ(x: number): number
  export function baseHeight(x: number, z: number): number
  export const LEYTE_ROAD: readonly { x: number; z: number }[]
  export const ROAD_WIDTH = 8
  export const ROAD_TREE_CLEAR = 15            // 公路中線兩側不長樹的半寬，m
  export const FRONT_LINE: { x: number; z: number }  // = LEYTE_ROAD 的最後一點
  export const BEACHHEAD: { x: number; z: number }   // = LEYTE_ROAD 的第一點
  export const EVACUATE_Z = 9000
  export const LEYTE_HILLS: readonly { cx; cz; radius; peak; pa; pb; seed }[]
  export function createLeyte(): { field: HeightFieldData; hills: IslandDesc[] }
  export function distanceToRoad(x: number, z: number): number
  ```

- [ ] **Step 1: 寫失敗的測試** `test/unit/leyte.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  BEACHHEAD, EVACUATE_Z, FRONT_LINE, LEYTE_HILLS, LEYTE_PEAK_MAX, LEYTE_ROAD, PLAIN_HEIGHT,
  baseHeight, coastZ, createLeyte, distanceToRoad,
} from '../../src/world/leyte'
import { headingToward } from '../../src/control/takeoffRoll'
import { WOBBLE_MAX } from '../../src/world/archipelago'
import { ARENA_RADIUS } from '../../src/world/arena'

const { field, hills } = createLeyte()

describe('雷伊泰的海岸線', () => {
  it('陸在 +Z、海在 −Z：岸線以北 600 m 是海、以南 600 m 是平地', () => {
    for (let x = -10000; x <= 10000; x += 250) {
      expect(field.sample(x, coastZ(x) - 600)).toBeLessThan(0)
      expect(field.sample(x, coastZ(x) + 600)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
    }
  })
  it('岸線是彎的：振幅至少 400 m', () => {
    let lo = Infinity, hi = -Infinity
    for (let x = -12000; x <= 12000; x += 100) { lo = Math.min(lo, coastZ(x)); hi = Math.max(hi, coastZ(x)) }
    expect(hi - lo).toBeGreaterThan(400)
  })
})

describe('雷伊泰的公路', () => {
  it('每一點都在平地上（沒有落進海或斜坡）', () => {
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const a = LEYTE_ROAD[i - 1]!, b = LEYTE_ROAD[i]!
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 20)
      for (let k = 0; k <= n; k++) {
        const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n
        expect(baseHeight(x, z)).toBeCloseTo(PLAIN_HEIGHT, 6)
      }
    }
  })
  it('彎的：至少 5 個轉角，每個轉角不超過 45°（車走圓弧時偏離中線不超過路半寬）', () => {
    let turns = 0
    for (let i = 1; i + 1 < LEYTE_ROAD.length; i++) {
      const p = LEYTE_ROAD[i - 1]!, q = LEYTE_ROAD[i]!, r = LEYTE_ROAD[i + 1]!
      const h0 = headingToward(q.x - p.x, q.z - p.z)
      const h1 = headingToward(r.x - q.x, r.z - q.z)
      const d = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
      expect(d).toBeLessThanOrEqual(Math.PI / 4 + 1e-9)
      if (d > 5 * Math.PI / 180) turns++
    }
    expect(turns).toBeGreaterThanOrEqual(5)
  })
  it('每一段至少 400 m；第一段放得下 15 輛車的集結（≥ 450 m）', () => {
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const a = LEYTE_ROAD[i - 1]!, b = LEYTE_ROAD[i]!
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(400)
    }
    const a = LEYTE_ROAD[0]!, b = LEYTE_ROAD[1]!
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(450)
  })
  it('灘頭與前線就是公路的兩端', () => {
    expect(BEACHHEAD).toEqual(LEYTE_ROAD[0])
    expect(FRONT_LINE).toEqual(LEYTE_ROAD[LEYTE_ROAD.length - 1])
  })
  it('distanceToRoad 在中線上是 0、離開就變大', () => {
    const a = LEYTE_ROAD[2]!
    expect(distanceToRoad(a.x, a.z)).toBeCloseTo(0, 6)
    expect(distanceToRoad(a.x + 1000, a.z)).toBeGreaterThan(100)
  })
})

describe('雷伊泰的丘陵', () => {
  it('峰高不超過上限、全部在陸上、膨脹圓離公路至少 400 m', () => {
    for (const h of LEYTE_HILLS) {
      expect(h.peak).toBeLessThanOrEqual(LEYTE_PEAK_MAX)
      expect(h.cz - h.radius * WOBBLE_MAX).toBeGreaterThan(coastZ(h.cx) + 300)
      expect(distanceToRoad(h.cx, h.cz) - h.radius * WOBBLE_MAX).toBeGreaterThanOrEqual(400)
    }
  })
  it('避障清單只有丘陵，高度場的最高點落在丘陵上', () => {
    expect(hills.length).toBe(LEYTE_HILLS.length)
    let top = -Infinity
    for (const v of field.data) top = Math.max(top, v)
    expect(top).toBeGreaterThan(PLAIN_HEIGHT + 50)
    expect(top).toBeLessThanOrEqual(LEYTE_PEAK_MAX + 1e-6)
  })
})

describe('撤離點', () => {
  it('在陸上、場地之內', () => {
    expect(baseHeight(0, EVACUATE_Z)).toBeCloseTo(PLAIN_HEIGHT, 6)
    expect(EVACUATE_Z).toBeLessThan(ARENA_RADIUS)
  })
})
```

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/leyte.test.ts` → FAIL（模組不存在）

- [ ] **Step 3: 寫 `src/world/leyte.ts`**

```ts
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, SEA_FLOOR, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { drawHillLobes } from './leuna'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 一座很大的平坦島嶼：世界 −Z 是海（雷伊泰灣），+Z 是陸。陸上是平地、一條
 * 蜿蜒的公路與幾座小山丘。
 *
 * 【高度場的組成】先把丘陵烘進去（底面是 `SEA_FLOOR`），再逐格與「海岸線
 * 加平地」的基準面取 max。丘陵的瓣緣因此併入平地，不會在平地上挖出環溝。
 *
 * 【避障清單只有丘陵】平地只有 `PLAIN_HEIGHT` 高，那是地面不是障礙；AI 的
 * 圓盤法只需要知道丘陵（`ai/terrainSense.ts`）。
 *
 * 【平地的高度】高過海浪的波峰（三道波合計振幅 4.5 m，見 `render/island.ts`
 * 的 `DRAW_FLOOR`），浪才不會從陸地上冒出來；又要低到 AI 以海平面當地板時
 * 的誤差可以忽略（AI 的安全層讀 `seaHeight` 加丘陵的圓盤，不讀平地）。
 *
 * 全部座標與數值是**起始值，由試飛裁定**。
 */

/** 高度場邊長頂點數。375 × 80 m = 30 km 見方，與農地同一個尺寸 */
export const LEYTE_SIZE = 376
/** 格距，m。平地與緩丘用 80 m 就夠；公路畫在 shader 裡，不吃格距 */
export const LEYTE_CELL = 80
const HALF_EXTENT = ((LEYTE_SIZE - 1) * LEYTE_CELL) / 2

/** 平地的高度，m */
export const PLAIN_HEIGHT = 8
/** 這個高度以下是沙灘色、不長植被，m。`render/leyteGround.ts` 與植被共用 */
export const SAND_TOP = 3
/** 丘陵峰高的上限，m。`LandField.ceiling` 用它 */
export const LEYTE_PEAK_MAX = 150

/** 岸線平均位置，m（世界 z） */
const COAST_Z = -4000
/** 岸線的三道起伏：振幅 m、波長 m、相位 rad。振幅合計 770 m */
const COAST_WAVES = [
  { amp: 400, len: 9000, phase: 0.7 },
  { amp: 250, len: 3700, phase: 2.1 },
  { amp: 120, len: 1700, phase: 4.4 },
] as const
/** 由水線升到平地的斜坡寬，m */
const SHORE_RAMP = 240
/** 海床由水線降到 `SEA_FLOOR` 的距離，m */
const SEABED_RAMP = 200
/**
 * 場地另外三邊由平地降回海裡的帶寬，m。**它是這座島另外幾面的海岸** ——
 * 少了它，高度場的邊界是一道 8 m 的直崖，外面接著遠海。
 */
const EDGE_RAMP = 1200

/** 岸線在這個 x 上的世界 z。陸地在 `z > coastZ(x)` */
export function coastZ(x: number): number {
  let z = COAST_Z
  for (const w of COAST_WAVES) z += w.amp * Math.sin((2 * Math.PI * x) / w.len + w.phase)
  return z
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 沒有丘陵時這一點的高度，m：海床、海岸斜坡、平地，再被場地邊緣的帶壓回海裡。
 *
 * 【距離取 z 向】`z − coastZ(x)` 不是到岸線的真正距離，但岸線的最大斜率
 * （Σ 2π·amp/len ≈ 1.13）之下斜坡只會被拉寬到約 1.5 倍，看不出來。
 */
export function baseHeight(x: number, z: number): number {
  const d = z - coastZ(x)
  const h = d <= 0
    ? Math.max(SEA_FLOOR, (d / SEABED_RAMP) * -SEA_FLOOR)
    : PLAIN_HEIGHT * smoothstep(0, SHORE_RAMP, d)
  const edge = Math.min(HALF_EXTENT - Math.abs(x), HALF_EXTENT - z)
  const cap = SEA_FLOOR + (PLAIN_HEIGHT - SEA_FLOOR) * smoothstep(0, EDGE_RAMP, edge)
  return Math.min(h, cap)
}

/**
 * 公路：灘頭 → 前線的折線，世界座標。**車隊的路線、地上畫的路、植被的清空帶
 * 全部讀這一份** —— 各寫一份的話車會開在路旁的樹林裡，而且不報錯。
 *
 * 【轉角不超過 45°】車在轉角走 25 m 半徑的圓弧（`world/groundMotion.ts`），
 * 離折線最遠 `25 × (1/cos 22.5° − 1)` ≈ 2.1 m，落在路的半寬 4 m 之內。
 *
 * 【第一段至少 450 m】三批 15 輛、車距 30 m 的集結全部排在這一段上。
 */
export const LEYTE_ROAD: readonly { x: number; z: number }[] = [
  { x: 2800, z: -3250 },
  { x: 2200, z: -2500 },
  { x: 2000, z: -1700 },
  { x: 1300, z: -1000 },
  { x: 1100, z: -200 },
  { x: 300, z: 300 },
  { x: -600, z: 500 },
  { x: -1400, z: 1200 },
]
/** 路面寬，m */
export const ROAD_WIDTH = 8
/** 公路中線兩側不長樹的半寬，m */
export const ROAD_TREE_CLEAR = 15
/** 美軍灘頭的集結區：公路起點 */
export const BEACHHEAD = LEYTE_ROAD[0]!
/** 前線：公路終點。卡車走到這裡就算抵達 */
export const FRONT_LINE = LEYTE_ROAD[LEYTE_ROAD.length - 1]!
/** 撤離點的世界 z（x = 0）。Ki-84 從這一側進場，也從這一側撤離 */
export const EVACUATE_Z = 9000

/** 這一點到公路中線的最短距離，m */
export function distanceToRoad(x: number, z: number): number {
  let best = Infinity
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
    if (d < best) best = d
  }
  return best
}

/**
 * 手擺的小山丘。全部在陸上、膨脹圓離公路至少 400 m（`leyte.test.ts` 守著）。
 * 瓣的形狀用 `drawHillLobes` 依種子抽，與洛伊納／阿什同一套。
 */
export const LEYTE_HILLS = [
  { cx: -5000, cz: -1500, radius: 700, peak: 110, pa: 0.9, pb: 3.4, seed: 401 },
  { cx: -3500, cz: 3500, radius: 800, peak: 140, pa: 2.1, pb: 4.6, seed: 402 },
  { cx: 3000, cz: 2500, radius: 700, peak: 120, pa: 3.0, pb: 1.2, seed: 403 },
  { cx: 5500, cz: -1000, radius: 600, peak: 90, pa: 1.4, pb: 5.3, seed: 404 },
  { cx: -6500, cz: 6500, radius: 900, peak: 150, pa: 4.2, pb: 0.6, seed: 405 },
  { cx: 4000, cz: 7500, radius: 800, peak: 130, pa: 5.1, pb: 2.8, seed: 406 },
  { cx: -2500, cz: 9500, radius: 700, peak: 120, pa: 0.3, pb: 4.0, seed: 407 },
] as const

export function createLeyte(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(LEYTE_SIZE, LEYTE_CELL)
  const hills: IslandDesc[] = []
  for (const h of LEYTE_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(LEYTE_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  bakeRelief(field, hills, SEA_FLOOR)
  const { size, cell, data } = field
  const half = (size - 1) / 2
  for (let row = 0; row < size; row++) {
    const z = (row - half) * cell
    for (let col = 0; col < size; col++) {
      const x = (col - half) * cell
      const i = row * size + col
      const b = baseHeight(x, z)
      if (b > data[i]!) data[i] = b
    }
  }
  return { field, hills }
}
```

（`SEA_FLOOR` 若未 export，改成在 `archipelago.ts` 加 `export`；它已經是 `export const SEA_FLOOR = -8`。`drawHillLobes` 已 export。）

- [ ] **Step 4: 跑，確認綠**。若「每一點都在平地上」或丘陵的距離斷言紅了，**只調 `LEYTE_ROAD`／`LEYTE_HILLS` 的座標**（不放寬測試），直到綠。

Run: `npx vitest run test/unit/leyte.test.ts`

- [ ] **Step 5: 變異驗證** —— 把 `LEYTE_ROAD[0]` 暫時改成 `{ x: 2800, z: -3700 }`（岸線外），確認「每一點都在平地上」變紅；改回來。

- [ ] **Step 6: Commit**

```bash
git add src/world/leyte.ts src/world/terrainKind.ts test/unit/leyte.test.ts
git commit -m "feat(terrain): 雷伊泰的海岸線地形生成器與公路座標"
```

（`terrainKind.ts` 加了 `'leyte'` 之後 `render/terrain.ts` 的 `createTerrain` 會落到群島那一支 —— 這一步 tsc 仍是 0 錯誤，Task 3 才接上。）

---

### Task 3: leyte 的算繪（地面、公路、植被）

**Files:**
- Create: `src/render/leyteGround.ts`
- Modify: `src/render/island.ts`（`buildIsland` 拆出 `buildGroundRect`）、`src/render/flora.ts`（`createLeyteFlora`、`leyteCanopyCover`）、`src/render/terrain.ts`（`createLeyteTerrain` 與分支）
- Test: `test/unit/leyte-render.test.ts`（新）

**Interfaces:**
- Consumes: Task 2 的全部 export
- Produces:
  ```ts
  // render/island.ts
  export function buildGroundRect(
    field: HeightFieldData, c0: number, c1: number, r0: number, r1: number,
    coverAt: (x: number, z: number) => number,
    shadeAt: (h: number, cover: number, out: Color) => Color,
  ): BufferGeometry | null
  // render/leyteGround.ts
  export function leyteShade(h: number, cover: number, out: Color): Color
  export function isLeyteGrass(h: number): boolean
  export const LEYTE_TILE_CELLS = 40
  export function createLeyteGround(field, coverAt): { object: Object3D; material: MeshStandardMaterial; dispose(): void }
  export function roadCoverageAt(x: number, z: number): number   // CPU 版，測試用；與 shader 同一條式子
  // render/flora.ts
  export function leyteAccept(field: HeightFieldData, x: number, z: number, h: number): number
  export function createLeyteFlora(field: HeightFieldData): FloraSource
  export function leyteCanopyCover(field: HeightFieldData): (x: number, z: number) => number
  ```

- [ ] **Step 1: 寫失敗的測試** `test/unit/leyte-render.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { createLeyte, LEYTE_ROAD, PLAIN_HEIGHT, ROAD_TREE_CLEAR, SAND_TOP, distanceToRoad } from '../../src/world/leyte'
import { createLeyteGround, isLeyteGrass, leyteShade, roadCoverageAt } from '../../src/render/leyteGround'
import { createLeyteFlora, leyteAccept, FLORA_STRIDE, FloraKind } from '../../src/render/flora'
import { createTerrain } from '../../src/render/terrain'
import type { BufferGeometry, Mesh } from 'three'

const { field } = createLeyte()

describe('leyte 的地面網格', () => {
  it('每一個頂點的高度就是高度場的值（畫面與撞地同一個數字）', () => {
    const g = createLeyteGround(field, () => 0)
    let checked = 0
    g.object.traverse((o) => {
      const geo = (o as Mesh).geometry as BufferGeometry | undefined
      if (geo === undefined) return
      const p = geo.getAttribute('position')
      for (let i = 0; i < p.count; i += 97) {
        expect(p.getY(i)).toBe(field.sample(p.getX(i), p.getZ(i)))
        checked++
      }
    })
    expect(checked).toBeGreaterThan(100)
    g.dispose()
  })
  it('沙灘只在 SAND_TOP 以下；平地是草色', () => {
    const c = new Color()
    const sand = leyteShade(SAND_TOP - 0.1, 0, new Color()).getHex()
    expect(leyteShade(PLAIN_HEIGHT, 0, c).getHex()).not.toBe(sand)
    expect(isLeyteGrass(SAND_TOP - 0.1)).toBe(false)
    expect(isLeyteGrass(PLAIN_HEIGHT)).toBe(true)
  })
})

describe('公路只有一份座標', () => {
  it('路面覆蓋在中線上是 1、離開 10 m 是 0', () => {
    const a = LEYTE_ROAD[3]!
    expect(roadCoverageAt(a.x, a.z)).toBe(1)
    expect(roadCoverageAt(a.x + 10, a.z + 10)).toBe(0)
  })
  it('植被在公路清空帶內接受率為 0，平地上遠低於丘陵上', () => {
    const a = LEYTE_ROAD[4]!
    expect(leyteAccept(field, a.x, a.z, PLAIN_HEIGHT)).toBe(0)
    // 平地上離路夠遠的一點與丘陵頂的接受率上界比
    const plain = maxAccept(field, 6000, 1000)
    const hill = maxAccept(field, -3500, 3500)
    expect(plain).toBeLessThan(hill * 0.3)
  })
  it('實際長出來的樹沒有一棵落在清空帶內，而且是闊葉樹或灌木', () => {
    const src = createLeyteFlora(field)
    const out = { data: new Float32Array(20000 * FLORA_STRIDE), kind: new Uint8Array(20000), capacity: 20000, count: 0, dropped: 0 }
    const a = LEYTE_ROAD[2]!
    src(a.x - 300, a.z - 300, a.x + 300, a.z + 300, (x, z) => field.sample(x, z), out)
    expect(out.count).toBeGreaterThan(0)
    for (let i = 0; i < out.count; i++) {
      const x = out.data[i * FLORA_STRIDE]!, z = out.data[i * FLORA_STRIDE + 2]!
      expect(distanceToRoad(x, z)).toBeGreaterThanOrEqual(ROAD_TREE_CLEAR)
      expect([FloraKind.BroadTree, FloraKind.Bush]).toContain(out.kind[i])
    }
  })
})

describe('createTerrain("leyte")', () => {
  it('海面在岸線外、陸地在平地上；避障清單是丘陵', () => {
    const t = createTerrain('leyte')
    expect(t.collisionHeightAt(0, -8000)).toBe(0)
    expect(t.collisionHeightAt(0, 2000)).toBeCloseTo(PLAIN_HEIGHT, 6)
    expect(t.waterAt(0, 2000)).toBe(-Infinity)
    expect(t.islands.length).toBeGreaterThan(0)
    t.dispose()
  })
})

function maxAccept(f: typeof field, cx: number, cz: number): number {
  let m = 0
  for (let x = cx - 300; x <= cx + 300; x += 13) {
    for (let z = cz - 300; z <= cz + 300; z += 13) m = Math.max(m, leyteAccept(f, x, z, f.sample(x, z)))
  }
  return m
}
```

- [ ] **Step 2: 跑，確認紅**：`npx vitest run test/unit/leyte-render.test.ts`

- [ ] **Step 3: `render/island.ts` 拆出 `buildGroundRect`**

把 `buildIsland` 的主體（從 `const nx = c1 - c0 + 1` 到 `return geo`）搬進新的 export 函式 `buildGroundRect(field, c0, c1, r0, r1, coverAt, shadeAt)`，其中 `shade(h, coverAt(x, z), scratch)` 改成 `shadeAt(h, coverAt(x, z), scratch)`。`buildIsland` 只剩算 `c0..r1` 之後 `return buildGroundRect(field, c0, c1, r0, r1, coverAt, shade)`。群島的行為逐字不變。

- [ ] **Step 4: 寫 `src/render/leyteGround.ts`**

```ts
import { Color, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from 'three'
import type { HeightFieldData } from '../world/heightfield'
import { LEYTE_ROAD, ROAD_WIDTH, SAND_TOP } from '../world/leyte'
import { buildGroundRect } from './island'

/**
 * # 雷伊泰的地面
 *
 * 低多邊形的頂點色網格，與群島同一種畫法；差別在三件事：
 *
 * 1. **切成方塊**，不是一座座圓島 —— 陸地是一整片。一塊一個 Mesh，各自進出視錐。
 * 2. **沙灘由高度 `SAND_TOP` 分界**，平地（8 m）是草。群島的分界是 12 m，
 *    照搬的話整片平地都是沙。
 * 3. **公路畫在材質的 shader 裡**：離 `LEYTE_ROAD` 任一段小於半寬就是柏油色。
 *    不另建貼地的網格 —— 那會與地面共面，拉遠就閃。
 */

const ROUGHNESS = 0.95
const SAND = new Color(0xc2b280)
const GRASS = new Color(0x55703f)
/** 樹冠的平均色：闊葉樹與灌木 */
const CANOPY = new Color(0x2f4a2a)
const ASPHALT = new Color(0x4a4640)

/** 一塊方塊幾格邊長。40 × 80 m = 3.2 km */
export const LEYTE_TILE_CELLS = 40

export function isLeyteGrass(h: number): boolean {
  return h >= SAND_TOP
}

export function leyteShade(h: number, cover: number, out: Color): Color {
  if (!isLeyteGrass(h)) return out.copy(SAND)
  return out.copy(GRASS).lerp(CANOPY, Math.min(1, Math.max(0, cover)))
}

/**
 * 這一點被路面蓋住多少，0 或 1。**與 shader 同一條式子**（不含抗鋸齒帶）：
 * 測試拿它確認路畫在 `LEYTE_ROAD` 上。
 */
export function roadCoverageAt(x: number, z: number): number {
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
    if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < ROAD_WIDTH / 2) return 1
  }
  return 0
}

/** 公路的 GLSL：世界座標 xz 到折線的距離小於半寬就混柏油色，邊緣一個像素寬的抗鋸齒 */
function roadGlsl(): string {
  const segs: string[] = []
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    segs.push(`vec4(${a.x.toFixed(1)}, ${a.z.toFixed(1)}, ${b.x.toFixed(1)}, ${b.z.toFixed(1)})`)
  }
  const c = ASPHALT
  return `
  {
    const vec4 ROAD[${segs.length}] = vec4[${segs.length}](${segs.join(', ')});
    float roadD = 1.0e9;
    for (int i = 0; i < ${segs.length}; i++) {
      vec2 a = ROAD[i].xy;
      vec2 ab = ROAD[i].zw - a;
      float t = clamp(dot(vRoadXZ - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
      roadD = min(roadD, length(vRoadXZ - (a + ab * t)));
    }
    float px = max(fwidth(roadD), 1.0e-3);
    float cover = 1.0 - smoothstep(${(ROAD_WIDTH / 2).toFixed(1)} - px, ${(ROAD_WIDTH / 2).toFixed(1)} + px, roadD);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}), cover);
  }`
}

function createGroundMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: ROUGHNESS })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadXZ;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvRoadXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>${roadGlsl()}`)
  }
  // 【快取鍵】onBeforeCompile 注入的程式要有自己的鍵，否則 three 會拿別的
  // MeshStandardMaterial 編好的程式來用
  m.customProgramCacheKey = () => 'leyte-ground-road'
  return m
}

export function createLeyteGround(
  field: HeightFieldData, coverAt: (x: number, z: number) => number,
): { object: Object3D; material: MeshStandardMaterial; dispose(): void } {
  const group = new Group()
  const material = createGroundMaterial()
  const geometries: BufferGeometry[] = []
  const last = field.size - 1
  for (let r0 = 0; r0 < last; r0 += LEYTE_TILE_CELLS) {
    for (let c0 = 0; c0 < last; c0 += LEYTE_TILE_CELLS) {
      const geo = buildGroundRect(
        field, c0, Math.min(last, c0 + LEYTE_TILE_CELLS), r0, Math.min(last, r0 + LEYTE_TILE_CELLS),
        coverAt, leyteShade,
      )
      if (geo === null) continue
      geometries.push(geo)
      group.add(new Mesh(geo, material))
    }
  }
  return {
    object: group,
    material,
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
```

（`#include <worldpos_vertex>` 只在有 `USE_SHADOWMAP` 等定義時才算 `worldPosition`；這裡自己用 `modelMatrix * vec4(transformed, 1.0)`，不依賴它。若 `#include <worldpos_vertex>` 在 three 目前版本的 standard vertex shader 不存在，改掛在 `#include <project_vertex>` 之後。）

- [ ] **Step 5: `render/flora.ts` 加 leyte 的植被**

在 `createIslandFlora` 之後加（`hash1`、`hash2`、`pushFlora`、`TREE_SCALE`、`BUSH_SCALE`、`islandClump`、`ISLAND_GRID`、`ISLAND_BUSH_RATIO` 都已在本檔）：

```ts
/**
 * 雷伊泰平地上的密度相對丘陵頂。**平地的樹少** —— 平地取代了水田，
 * 看起來該是開闊地夾著零星的林子。
 */
export const LEYTE_PLAIN_DENSITY = 0.08
/** 高出平地這麼多就是滿密度，m。丘陵的山腰往上是林子 */
const LEYTE_HILL_FULL = 40

/**
 * 雷伊泰一個候選點的接受機率。**放置與地色共用這一支**（同 `islandAccept`）。
 *
 * 沙灘與公路清空帶是 0；平地是 `LEYTE_PLAIN_DENSITY`；高出平地
 * `LEYTE_HILL_FULL` 就是 1；乘上成叢遮罩、除以坡度（同群島）。
 */
export function leyteAccept(field: HeightFieldData, x: number, z: number, h: number): number {
  if (!isLeyteGrass(h)) return 0
  if (distanceToRoad(x, z) < ROAD_TREE_CLEAR) return 0
  const cell = field.cell
  const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
  const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
  const up = Math.min(1, Math.max(0, (h - PLAIN_HEIGHT) / LEYTE_HILL_FULL))
  return (LEYTE_PLAIN_DENSITY + (1 - LEYTE_PLAIN_DENSITY) * up) * islandClump(x, z)
    / Math.hypot(1, Math.hypot(dx, dz))
}
```

`createLeyteFlora(field)`：照抄 `createIslandFlora` 的網格走法（`ISLAND_GRID`、樹與灌木各一個候選、座標只由全域索引決定），差別：沒有「最近的島」那一段（整格早退改成：tile 四角與中心的 `field.sample` 全部 < `SAND_TOP` 就 return）；判準換成 `isLeyteGrass` 與 `leyteAccept(field, x, z, h)`；樹的種類是 `FloraKind.BroadTree`。完整程式照 `createIslandFlora` 逐行對應寫出，不共用可變狀態。

`leyteCanopyCover(field)`：照 `islandCanopyCover`，`lambda = leyteAccept(...) * (BROAD_AREA + BUSH_AREA) / ISLAND_GRID²`，其中 `BROAD_AREA = π · BROAD_CROWN_R² · E_SCALE2`。`BROAD_CROWN_R` 在 `floraShapes.ts:47` 是 `const`，**要加 `export`**（與 `CONE_CROWN_R`、`BUSH_R` 並列）。

import：`isLeyteGrass` 從 `./leyteGround`（`leyteGround.ts` 不 import `flora.ts`，不成環）；`distanceToRoad`、`PLAIN_HEIGHT`、`ROAD_TREE_CLEAR` 從 `../world/leyte`。

- [ ] **Step 6: `render/terrain.ts` 接上**

`createTerrain` 加 `if (kind === 'leyte') return createLeyteTerrain()`（放在 `'sea'` 之前）。新函式照 `createArchipelagoTerrain` 寫：

```ts
function createLeyteTerrain(): Terrain {
  const { field, hills } = createLeyte()
  const ocean = createOcean(bakeShore(field))
  const ground = createLeyteGround(field, leyteCanopyCover(field))
  // 【容量用內陸那一組，不用群島的】雷伊泰的樹是闊葉樹，而群島的闊葉池只留
  // 了 16 格防呆 —— 超出的由 `stats.overflow` 靜靜丟掉。半徑也用預設的 6 km：
  // 群島的 12 km 是建立在「七千格裡只有三百格有東西」上，雷伊泰的陸地是整片，
  // 照搬的話非空格子多一個量級。單格上限用群島的 768（丘陵上的林子單格實測到 568）
  const flora = createVegetation(
    [createLeyteFlora(field)], (x, z) => field.sample(x, z),
    { maxPerTile: ISLAND_MAX_PER_TILE },
  )
  const group = new Group()
  group.add(ocean.farMesh)
  group.add(ocean.mesh)
  group.add(ground.object)
  group.add(flora.object)
  return {
    object: group,
    heightAt(x, z, time) {
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, time)
      return h > sea ? h : sea
    },
    collisionHeightAt(x, z) {
      const h = field.sample(x, z)
      return h > 0 ? h : 0
    },
    waterAt(x, z) {
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, 0)
      return h > sea ? -Infinity : sea
    },
    islands: hills,
    land: { field, ceiling: LEYTE_PEAK_MAX, landAbove: 0 },
    fieldClip: null,
    setPalette(p) {
      ocean.setPalette(p)
      flora.setPointLight(p.foliage)
    },
    update(time, centerX, centerZ) {
      ocean.update(time, centerX, centerZ)
      flora.update(centerX, centerZ)
    },
    settle() { flora.settle() },
    dispose() {
      ocean.dispose()
      ground.dispose()
      flora.dispose()
    },
  }
}
```

**先查** `createArchipelagoTerrain` 的 `collisionHeightAt` 完整內容與 `main.ts` 的 `__gfx`「前三個 child 是明文契約」（索引 0 遠海、1 海、2 陸地）—— leyte 照同一個順序擺，`main.ts:3702` 的 `islands: () => [terrain.object.children[2]!]` 才拿得到地面。

- [ ] **Step 7: 跑，確認綠**

Run: `npx vitest run test/unit/leyte-render.test.ts test/unit/terrain.test.ts test/unit/island-shade.test.ts`
Expected: PASS（群島相關既有測試不受影響）

- [ ] **Step 8: 變異驗證** —— `leyteAccept` 的清空帶判斷暫時改成 `< 0`，確認「沒有一棵落在清空帶內」變紅；改回來。

- [ ] **Step 9: tsc 與 Commit**

Run: `npx tsc --noEmit` → 0 errors

```bash
git add src/render/leyteGround.ts src/render/island.ts src/render/flora.ts src/render/terrain.ts test/unit/leyte-render.test.ts
git commit -m "feat(terrain): leyte 的地面切片、公路 shader 與闊葉植被"
```

---

### Task 4: 會移動的地面目標

**Files:**
- Create: `src/world/groundMotion.ts`
- Modify: `src/world/groundTargets.ts`、`src/world/World.ts`（地面砲位那一段之前）、`src/render/groundTargets.ts:58`
- Test: `test/unit/ground-motion.test.ts`（新）

**Interfaces:**
- Consumes: `walkRoute`、`headingToward`、`RouteMotion`、`PoseState`（Task 1）
- Produces:
  ```ts
  // world/groundMotion.ts
  export interface GroundMotion {
    readonly path: readonly { x: number; z: number }[]
    readonly motion: RouteMotion
    readonly startHeading: number      // 第一段的航向
    readonly endHeading: number        // 最後一段的航向
    readonly offsetSeconds: number     // 開場時已經在路線上走了幾秒（集結位置）
    readonly departAt: number          // 世界時間幾秒開始走
    readonly totalSeconds: number      // 走完全程的秒數（walkRoute 的回傳）
  }
  export function createGroundMotion(
    path: readonly { x: number; z: number }[], motion: RouteMotion, startS: number, departAt: number,
  ): GroundMotion
  export function motionPose(m: GroundMotion, time: number, out: PoseState): boolean  // false = 已走完
  export function stepGroundMotion(t: GroundTarget, time: number, groundAt: (x: number, z: number) => number): void
  // world/groundTargets.ts —— GroundTarget 新增/修改的欄位
  speed: number                  // 原本 readonly 0
  readonly motion: GroundMotion | null
  arrived: boolean               // 走完路線退場。alive 同時為 false，但不算摧毀
  ```
- `createGroundTarget(index, id, team, x, z, heading, motion: GroundMotion | null = null)`

- [ ] **Step 1: 寫失敗的測試** `test/unit/ground-motion.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createGroundTarget, resetGroundTarget, groundTopOf } from '../../src/world/groundTargets'
import { createGroundMotion, stepGroundMotion } from '../../src/world/groundMotion'
import { createGroundBattery, GROUND_LIGHT_FLAK_SPEC } from '../../src/world/shipGuns'

const PATH = [{ x: 0, z: 0 }, { x: 0, z: -1000 }, { x: -500, z: -1500 }]
const CAR = { speed: 10, turnRadius: 25, turnRate: 10 / 25 }
const ground = (x: number, z: number): number => 5 + x * 0.001

function vehicle(startS: number, departAt: number, unit: 'truck' | 'flakLight' = 'truck') {
  const m = createGroundMotion(PATH, CAR, startS, departAt)
  const t = createGroundTarget(0, unit, 'red', 0, 0, 0, m)
  stepGroundMotion(t, 0, ground)
  return t
}

describe('地面目標沿路線移動', () => {
  it('出發前停在集結位置、speed 為 0', () => {
    const t = vehicle(200, 30)
    const z0 = t.position.z
    expect(z0).toBeCloseTo(-200, 6)
    stepGroundMotion(t, 10, ground)
    expect(t.position.z).toBeCloseTo(z0, 9)
    expect(t.speed).toBe(0)
  })
  it('出發之後每秒前進 speed 公尺，speed 讀得到車速', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 10, ground)
    expect(t.position.z).toBeCloseTo(-100, 6)
    expect(t.speed).toBe(10)
  })
  it('高度等於地面、impactY 跟著動', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 60, ground)
    expect(t.position.y).toBeCloseTo(ground(t.position.x, t.position.z), 9)
    expect(t.impactY).toBeCloseTo(t.position.y + groundTopOf(t.unit), 9)
  })
  it('航向沿路線：第一段朝 −Z', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 5, ground)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(t.orientation)
    expect(fwd.z).toBeCloseTo(-1, 6)
  })
  it('死了就不動', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 5, ground)
    t.alive = false
    const z = t.position.z
    stepGroundMotion(t, 50, ground)
    expect(t.position.z).toBe(z)
    expect(t.speed).toBe(0)
  })
  it('走完就退場：arrived 為真、alive 為假、不再動', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 1e4, ground)
    expect(t.arrived).toBe(true)
    expect(t.alive).toBe(false)
    expect(t.speed).toBe(0)
  })
  it('重開回到集結位置與開局航向', () => {
    const t = vehicle(100, 0)
    stepGroundMotion(t, 1e4, ground)
    resetGroundTarget(t)
    expect(t.arrived).toBe(false)
    expect(t.alive).toBe(true)
    stepGroundMotion(t, 0, ground)
    expect(t.position.z).toBeCloseTo(-100, 6)
  })
  it('防空車移動之後，砲台步進打出去的彈丸從車的新位置出膛', () => {
    // 真的跑 `stepGunPlatform`：車開 200 m 之後開火，彈丸的起點要在車旁邊
    // （做法：建一架在車正上方 800 m 的紅隊目標飛機、一個 Projectiles 池，
    //  對 t 呼叫 stepGunPlatform 數步直到 fired > 0，取最新一發的位置，
    //  斷言它離 t.position 的水平距離 < 30 m、離開局位置 > 150 m。
    //  建構細節照 `test/unit/ground-targets.test.ts` 裡既有的輕砲開火測試抄。）
  })
  it('沒有 motion 的地面目標完全不受影響', () => {
    const t = createGroundTarget(0, 'truck', 'red', 12, 34, 0)
    stepGroundMotion(t, 100, ground)
    expect(t.position.x).toBe(12)
    expect(t.position.z).toBe(34)
    expect(t.speed).toBe(0)
  })
})
```

- [ ] **Step 2: 跑，確認紅**：`npx vitest run test/unit/ground-motion.test.ts`

- [ ] **Step 3: 寫 `src/world/groundMotion.ts`**

```ts
import { Quaternion, Vector3 } from 'three'
import { headingToward, walkRoute, type PoseState, type RouteMotion } from '../control/takeoffRoll'
import type { GroundTarget } from './groundTargets'

/**
 * # 地面車輛沿路線的移動
 *
 * 位置是**世界時間的純函數**，不積分：`walkRoute` 在第 τ 秒的姿態，
 * τ = 集結位置換算的秒數 + 出發之後經過的秒數。同一個時間永遠得到同一個
 * 位置 —— 重開一場、重播都一樣。
 *
 * 【集結】開場時每一輛已經在路線上的某一點（`offsetSeconds`），出發時刻到了
 * 才開始走。同一條路線上前車在前、後車在後，車速相同所以不會追撞。
 *
 * 【抵達】走完全程就退場：`arrived = true`、`alive = false`，**不走擊毀流程**
 * —— 不推擊毀事件、不算進摧毀數（`battle/setup.ts` 的 `destroyedInPool`）。
 *
 * 熱路徑：不配置。
 */

export interface GroundMotion {
  readonly path: readonly { x: number; z: number }[]
  readonly motion: RouteMotion
  readonly startHeading: number
  readonly endHeading: number
  /** 開場時已經在路線上走了幾秒 —— 集結位置 */
  readonly offsetSeconds: number
  /** 世界時間幾秒開始走 */
  readonly departAt: number
  /** 走完全程的秒數 */
  readonly totalSeconds: number
}

/**
 * @param startS 集結位置離路線起點多遠，m（沿路線量）
 */
export function createGroundMotion(
  path: readonly { x: number; z: number }[], motion: RouteMotion, startS: number, departAt: number,
): GroundMotion {
  const a = path[0]!
  const b = path[1]!
  const y = path[path.length - 2]!
  const z = path[path.length - 1]!
  const startHeading = headingToward(b.x - a.x, b.z - a.z)
  const endHeading = headingToward(z.x - y.x, z.z - y.z)
  return {
    path, motion, startHeading, endHeading,
    offsetSeconds: startS / motion.speed,
    departAt,
    totalSeconds: walkRoute(path, startHeading, endHeading, Infinity, 0, null, motion),
  }
}

/** 世界時間 `time` 的姿態，就地寫 `out`。回傳 false = 已經走完 */
export function motionPose(m: GroundMotion, time: number, out: PoseState): boolean {
  const moving = time > m.departAt ? time - m.departAt : 0
  const tau = m.offsetSeconds + moving
  if (tau >= m.totalSeconds) return false
  walkRoute(m.path, m.startHeading, m.endHeading, tau, 0, out, m.motion)
  return true
}

const POSE: PoseState = {
  position: new Vector3(), velocity: new Vector3(),
  orientation: new Quaternion(), angularVelocity: new Vector3(),
}

/**
 * 推進一台。沒有 `motion`、已經死了或已經抵達的都不動。
 *
 * @param groundAt 地面高度。與 `World.groundAt` 同一支 —— 車就貼在撞地判定的那個面上
 */
export function stepGroundMotion(
  t: GroundTarget, time: number, groundAt: (x: number, z: number) => number,
): void {
  const m = t.motion
  if (m === null) return
  if (!t.alive) {
    t.speed = 0
    return
  }
  if (!motionPose(m, time, POSE)) {
    t.arrived = true
    t.alive = false
    t.speed = 0
    return
  }
  t.position.set(POSE.position.x, groundAt(POSE.position.x, POSE.position.z), POSE.position.z)
  t.orientation.copy(POSE.orientation)
  t.speed = time > m.departAt ? m.motion.speed : 0
}
```

- [ ] **Step 4: 改 `src/world/groundTargets.ts`**

1. `import type { GroundMotion } from './groundMotion'`
2. `GroundTarget` 介面：`readonly speed: 0` 改成
```ts
  /**
   * 沿車頭（−Z）的速率，m/s。**靜止的目標恆為 0**；沿路線移動的車由
   * `world/groundMotion.ts` 每一步寫入。AI 的提前量讀它（與船同一條路）。
   */
  speed: number
  /** 沿路線移動的設定。**null = 不動**（停放的飛機、砲位、廠房） */
  readonly motion: GroundMotion | null
  /**
   * 走完路線退場了。**`alive` 同時為 false**：不擋子彈、不是目標、畫面上不畫。
   * **不算摧毀** —— 它是開到了，不是被打掉（`battle/setup.ts` 的 `destroyedInPool`）。
   */
  arrived: boolean
```
   並把 `orientation` 的註解「只有航向（繞 Y）」保留；`position` 的註解改成「世界座標，底面中心。`y` 是地面高度。沿路線移動的車每一步重寫」。
3. `createGroundTarget` 多一個參數 `motion: GroundMotion | null = null`，物件裡加 `motion,`、`arrived: false,`；`speed: 0` 維持。
4. `resetGroundTarget` 加：
```ts
  t.arrived = false
  t.speed = 0
  // 【航向也要回開局】移動的車整場都在改 orientation；靜止的目標抄回去是 no-op
  t.orientation.setFromAxisAngle(UP, t.heading)
```
5. `StrikeTarget.speed` 的註解（`world/strikeTarget.ts`）「地面目標恆 0」改成「靜止的地面目標恆 0；沿路線移動的車是車速」。

- [ ] **Step 5: 改 `src/world/World.ts`**：在 `// 【陸上的高砲位走同一支】` 那個迴圈**之前**加

```ts
    // 【車先動、砲後打】防空車的槍口由這一步的位置算，順序反過來的話
    // 砲口落後車身一步（10 m/s × 1/240 s，看不出來，但沒有理由讓它錯）
    for (const t of this.groundTargets) stepGroundMotion(t, this.time, this.groundAt)
```
並 `import { stepGroundMotion } from './groundMotion'`。**先確認 `this.time` 在這一行時已經是這一步的時間**（讀 `World.step` 開頭 `this.time += dt` 的位置）；若 `time` 在步尾才加，改用 `this.time + dt`，並在註解寫明。

- [ ] **Step 6: 改 `src/render/groundTargets.ts:97`**：`m.visible = !t.departed` → `m.visible = !t.departed && !t.arrived`，註解補一句「開到前線退場的車也不畫」。

- [ ] **Step 6b: AI 掃射移動目標要有提前量** —— `src/ai/shipAttack.ts` 的 `groundAttackCommand` 目前把目標速度寫死 `0, 0, 0`。改成照 `shipAttackCommand` 的寫法：

```ts
  // 【沿路線移動的車要帶速度】掃射核心拿它算提前量；靜止的目標 speed 為 0，
  // 走原本那一條 0, 0, 0，行為逐位元不變
  if (target.speed === 0) {
    groundStrafeCommand(state, target, self, aim, 0, 0, 0, replan, out, fireAim)
    return
  }
  const tv = S.v[3]!.set(0, 0, -1).applyQuaternion(target.orientation).multiplyScalar(target.speed)
  groundStrafeCommand(state, target, self, aim, tv.x, tv.y, tv.z, replan, out, fireAim)
```
測試加在 `test/unit/ai-ground-strafe.test.ts`：同一架飛機、同一台卡車，`speed = 10` 與 `speed = 0` 時 `groundAttackCommand` 產出的命令不同（先確認 `groundStrafeCommand` 會讀那三個分量；若它另外有純函數的提前量解，直接測那一支的輸出點往車頭方向移）。

**AI 僚機不投彈**：戰鬥機走不到 `bombRun`（`AiController.ts:478-492` 只有非戰鬥機走轟炸航路），這一輪不補對地投彈的路徑 —— 僚機掃射卡車，炸彈是玩家的。SPEC §7.5 同步改寫。

- [ ] **Step 7: 跑，確認綠**

Run: `npx vitest run test/unit/ground-motion.test.ts test/unit/ground-targets.test.ts test/unit/ai-ground-strafe.test.ts`
Expected: PASS

- [ ] **Step 8: 變異驗證** —— `stepGroundMotion` 的「死了就不動」那一段暫時刪掉，確認「死了就不動」變紅；改回來。

- [ ] **Step 9: tsc、Commit**

```bash
git add src/world/groundMotion.ts src/world/groundTargets.ts src/world/World.ts src/world/strikeTarget.ts src/render/groundTargets.ts test/unit/ground-motion.test.ts
git commit -m "feat(ground): 地面目標可以沿路線移動，走完退場但不算摧毀"
```

---

### Task 5: `interdict` 規則、`destroyed` 條件、抵達計數

**Files:**
- Modify: `src/battle/mission.ts`、`src/battle/beats.ts`、`src/battle/setup.ts`（`inDestroyPool`、`destroyedInPool`、`stepBeats`、`MISSION_INPUTS` 填值、`MissionInputs` 初值 `targetsArrived: 0`）、`src/main.ts:3178`
- Test: `test/unit/interdict.test.ts`（新）

**Interfaces:**
- Produces:
  ```ts
  // mission.ts —— MissionRules 新增
  | { kind: 'interdict'; count: number; leak: number; unit: GroundUnitId }
  // MissionInputs 新增
  targetsArrived: number
  // beats.ts —— BeatCondition 新增
  | { readonly kind: 'destroyed'; readonly atLeast: number; readonly unit?: GroundUnitId; readonly byLatest?: number }
  // conditionMet 簽名不變：destroyed 條件讀第五個參數 `destroyed`（呼叫端依條件的 unit 數好再傳）
  ```

- [ ] **Step 1: 寫失敗的測試** `test/unit/interdict.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createMissionState, stepMission, type MissionInputs, type MissionRules } from '../../src/battle/mission'
import { conditionMet, type BeatCondition } from '../../src/battle/beats'

const RULES: MissionRules = { kind: 'interdict', count: 6, leak: 4, unit: 'truck' }

function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
  return {
    aliveBlue: 8, aliveBlueFighters: 8, aliveRed: 0, playerPos: new Vector3(), playerAlive: true,
    convoyAlive: 0, convoyLead: Infinity, convoyArrived: 0, redKilled: 0, redKilledBombers: 0,
    shipsSunk: 0, shipsTotal: 0, targetsDestroyed: 0, targetsTotal: 9, targetsArrived: 0,
    vitalSunk: 0, vitalHp: 1, redInbound: false, ...over,
  }
}

describe('interdict', () => {
  it('抵達數到 leak 判敗', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ targetsArrived: 3 }), 1 / 240, s)
    expect(s.outcome).toBe('fighting')
    stepMission(RULES, inputs({ targetsArrived: 4 }), 1 / 240, s)
    expect(s.outcome).toBe('defeat')
  })
  it('藍隊全滅判敗', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ aliveBlue: 0 }), 1 / 240, s)
    expect(s.outcome).toBe('defeat')
  })
  it('摧毀數到 count 不判勝（勝利只來自撤離）', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ targetsDestroyed: 9 }), 1 / 240, s)
    expect(s.outcome).toBe('fighting')
  })
  it('計量：還差幾輛、分母是 count、抵達數給 HUD', () => {
    const s = createMissionState(RULES)
    stepMission(RULES, inputs({ targetsDestroyed: 2, targetsArrived: 1 }), 1 / 240, s)
    expect(s.metric).toBe(4)
    expect(s.metricTotal).toBe(6)
    expect(s.metricKind).toBe('count')
    expect(s.arrived).toBe(1)
  })
})

describe('destroyed 條件', () => {
  const none = (): number => 0
  const c: BeatCondition = { kind: 'destroyed', atLeast: 6, unit: 'truck' }
  it('到 N 才成立', () => {
    expect(conditionMet(c, 100, none, 0, 5)).toBe(false)
    expect(conditionMet(c, 100, none, 0, 6)).toBe(true)
  })
  it('byLatest 兜底', () => {
    const d: BeatCondition = { kind: 'destroyed', atLeast: 1, byLatest: 90 }
    expect(conditionMet(d, 89, none, 0, 0)).toBe(false)
    expect(conditionMet(d, 90, none, 0, 0)).toBe(true)
  })
})
```

另在 `test/unit/interdict.test.ts` 加一組**setup 層**的測試，確認「抵達不算摧毀」與「條件只數指定單位」—— 用 `createBattle(missionConfigFrom(...))` 太重，改測 `setup.ts` 新 export 的兩支小函式：

```ts
import { destroyedInPool, countDestroyed } from '../../src/battle/setup'
import { createGroundTarget } from '../../src/world/groundTargets'

describe('摧毀的計數', () => {
  it('抵達退場的車不算摧毀', () => {
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    t.alive = false
    t.arrived = true
    expect(destroyedInPool(t, [])).toBe(false)
  })
  it('只數指定單位、只數紅方', () => {
    const a = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 0, 0, 0)
    const c = createGroundTarget(2, 'truck', 'blue', 0, 0, 0)
    for (const t of [a, b, c]) t.alive = false
    expect(countDestroyed([a, b, c], [], 'truck')).toBe(1)
    expect(countDestroyed([a, b, c], [], undefined)).toBe(2)
  })
})
```

- [ ] **Step 2: 跑，確認紅**：`npx vitest run test/unit/interdict.test.ts`

- [ ] **Step 3: `mission.ts`**

1. `MissionRules` 在 `destroy` 之後加：
```ts
  | {
    /**
     * 截斷沿公路開往前線的車隊。**這條規則只判敗、不判勝。**
     *
     * ```
     *   負  抵達前線的 `unit` 累計到 `leak` 輛
     *   負  藍隊全滅
     * ```
     *
     * 勝利來自撤離：卡片上「摧毀 ≥ count」的返航節拍把規則換成 `evacuate`。
     * `stepBeats` 排在 `stepMission` 之前（`setup.ts` 的 `stepBattle`），所以同一步
     * 炸到第 count 輛又剛好有卡車抵達時，規則已經換成撤離，不判敗。
     *
     * 【為什麼不在摧毀數到了時判勝】那一刻這一關才進入下半場（F6F 堵退路、
     * 飛回撤離點）。有 interdict 的卡一定要有那個返航節拍，否則贏不了 ——
     * `campaigns.test.ts` 守著。
     */
    kind: 'interdict'
    /** 要炸毀幾輛，目標列的分母 */
    count: number
    /** 抵達幾輛就判敗 */
    leak: number
    /** 只數這一種地面單位 */
    unit: GroundUnitId
  }
```
2. `MissionInputs` 在 `targetsTotal` 之後加：
```ts
  /**
   * 敵方地面目標**開到終點退場**的有幾座，只數規則指定的單位。`interdict`
   * 以外的規則不讀它。只增不減 —— 退場是一個閂（`GroundTarget.arrived`）。
   */
  targetsArrived: number
```
3. `resetMissionState` 裡 `const counted = ...` 那一行加上 `|| rules.kind === 'interdict'`。
4. `stepMission` 在 `destroy` 分支之後加：
```ts
  // ── 截斷 ──────────────────────────────────────────────
  //
  // 計量與炸毀同一個形狀，另外把抵達數交給目標列（`arrived`，分母是 `leak`）
  if (rules.kind === 'interdict') {
    out.metric = Math.max(0, rules.count - inp.targetsDestroyed)
    out.metricTotal = rules.count
    out.remaining = -1
    out.arrived = inp.targetsArrived
    if (inp.targetsArrived >= rules.leak || inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }
```

- [ ] **Step 4: `beats.ts`**：`BeatCondition` 在 `ground` 之後加

```ts
  /**
   * 敵方地面目標的摧毀數達到 `atLeast`。**`unit` 省略 = 敵方地面目標全部。**
   *
   * 與 `ground` 相反：那一條是「時限到了還沒炸夠」，這一條是「炸夠了」。
   * 摧毀數只增不減，成立之後保持成立。開到終點退場的不算摧毀。
   *
   * 【`byLatest` 是選填的兜底】到了這個秒數無條件成立。「玩家開始攻擊之後
   * 敵機才來」那種波次要它 —— 玩家遲遲不動手，敵機仍然要來。
   *
   * 【計數由呼叫端依 `unit` 數好】`conditionMet` 讀第五個參數，不自己掃目標。
   */
  | {
    readonly kind: 'destroyed'
    readonly atLeast: number
    readonly unit?: GroundUnitId
    readonly byLatest?: number
  }
```
`conditionMet` 在 `ground` 那一行之後加：
```ts
  if (when.kind === 'destroyed') {
    return destroyed >= when.atLeast || (when.byLatest !== undefined && time >= when.byLatest)
  }
```
`import type { GroundUnitId } from '../render/geometry/ground'`。

- [ ] **Step 5: `setup.ts`**

1. `inDestroyPool`：
```ts
function inDestroyPool(t: GroundTarget, rules: MissionRules): boolean {
  if (t.team === 'blue') return false
  if (rules.kind === 'interdict') return t.unit.id === rules.unit
  return rules.kind !== 'destroy' || rules.unit === undefined || t.unit.id === rules.unit
}
```
2. `destroyedInPool` 加 `export`，第一行加 `if (t.arrived) return false`，註解表格加一列「開到終點　不算（它是開到了，不是被打掉）」。
3. 新 export：
```ts
/**
 * 敵方地面目標裡 `unit`（省略 = 全部）已摧毀幾座。**`destroyed` 節拍條件用它** ——
 * 那一條自帶單位，不跟著這一場的規則走（返航之後規則換成撤離，池就變了）。
 */
export function countDestroyed(
  targets: readonly GroundTarget[], cs: readonly Combatant[], unit: GroundUnitId | undefined,
): number {
  let n = 0
  for (const t of targets) {
    if (t.team === 'blue') continue
    if (unit !== undefined && t.unit.id !== unit) continue
    if (destroyedInPool(t, cs)) n++
  }
  return n
}
```
4. `stepBeats` 的 `conditionMet(beat.when, now, aliveOf, b.batches, destroyed)` 改成：
```ts
      const d = beat.when.kind === 'destroyed'
        ? countDestroyed(b.world.groundTargets, b.world.combatants, beat.when.unit)
        : destroyed
      if (!conditionMet(beat.when, now, aliveOf, b.batches, d)) continue
```
5. 新 export `countArrived(targets, rules): number`：只數 `inDestroyPool(t, rules) && t.arrived`。填 `MISSION_INPUTS` 的地面那一段改成 `inp.targetsArrived = countArrived(b.world.groundTargets, b.rules)`（與 `targetsDestroyed` 同一處）。模組級 `MISSION_INPUTS` 的初值物件加 `targetsArrived: 0`；`test/unit/mission.test.ts`、`test/integration/battle-convoy.test.ts` 裡自建的 `MissionInputs` 也補 `targetsArrived: 0`。

   `interdict.test.ts` 加：
```ts
  it('抵達數只數規則指定的單位', () => {
    const rules: MissionRules = { kind: 'interdict', count: 6, leak: 4, unit: 'truck' }
    const a = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 0, 0, 0)
    for (const t of [a, b]) { t.alive = false; t.arrived = true }
    expect(countArrived([a, b], rules)).toBe(1)
  })
```

6. **判定順序的護欄**（SPEC §7.1）：`interdict.test.ts` 加一條只跑**一步**的整合測試 —— 用 `createBattle` 建一場：一張合成卡（`missionConfigFrom` 吃的形狀，`vehicleConvoy` 兩輛卡車、`interdict: { count: 1, leak: 1, unit: 'truck' }`、`withdraw` 在 `destroyed ≥ 1`）。開場後把第一輛設 `alive = false`（摧毀）、第二輛設 `alive = false; arrived = true`（抵達），然後 `stepBattle` 一步，斷言 `b.outcome === 'fighting'` 且 `b.rules.kind === 'evacuate'`。把 `stepBattle` 裡 `stepBeats(b)` 暫時移到勝負判定之後，確認這一條變紅（變異驗證），再改回來。這一條要等 Task 6 的卡片欄位進來才寫得出，**放在 Task 6 Step 9 之後執行**。

- [ ] **Step 6: `main.ts:3178`**：

```ts
  hudFrame.objectiveNeed = battle.rules.kind === 'convoy'
    ? battle.rules.need ?? 1
    : battle.rules.kind === 'interdict' ? battle.rules.leak : -1
```

- [ ] **Step 7: 跑**：`npx vitest run test/unit/interdict.test.ts test/unit/mission.test.ts test/unit/mission-waves.test.ts` → PASS；`npx tsc --noEmit` → 0（`MissionInputs` 的其他建構點若 tsc 報缺 `targetsArrived`，逐處補 `targetsArrived: 0`）

- [ ] **Step 8: 變異驗證** —— `stepMission` interdict 分支的 `>= rules.leak` 暫時改 `> rules.leak`，確認「抵達數到 leak 判敗」紅；`destroyedInPool` 的 `arrived` 那一行暫時刪掉，確認「抵達退場的車不算摧毀」紅。都改回來。

- [ ] **Step 9: Commit**

```bash
git add src/battle/mission.ts src/battle/beats.ts src/battle/setup.ts src/main.ts test/unit/interdict.test.ts
git commit -m "feat(mission): interdict 規則與「摧毀至少 N」節拍條件"
```

---

### Task 6: 卡片層：車隊、interdict、返航節拍、Ki-84 掛載、新的日 M2

**Files:**
- Modify: `src/battle/missions/types.ts`、`src/battle/missions/index.ts`、`src/battle/missions/japan.ts`、`src/battle/setup.ts`（`GroundEntry` 帶 motion 進 `placeGround`）、`src/weapons/stores.ts`、`src/ui/menu.ts:107`
- Test: `test/unit/campaigns.test.ts`（改＋新增）、`test/unit/missions.test.ts`（新增幾條）

**Interfaces:**
- Consumes: Task 1–5
- Produces:
  ```ts
  // types.ts
  export interface MissionTrigger 多一種 { kind: 'destroyed'; atLeast: number; unit?: GroundUnitId; byLatest?: number }
  export interface GroundEntry { ...既有; readonly motion?: GroundMotion }
  export interface MissionVehicleBatch { readonly departAt: number; readonly units: readonly GroundUnitId[] }
  export interface MissionVehicleConvoy {
    readonly route: readonly { x: number; z: number }[]
    readonly speed: number
    readonly turnRadius: number
    readonly gap: number
    readonly batches: readonly MissionVehicleBatch[]
  }
  MissionBattle.vehicleConvoy?: MissionVehicleConvoy
  MissionBattle.interdict?: { readonly count: number; readonly leak: number; readonly unit: GroundUnitId }
  // index.ts
  export function convoyGround(c: MissionVehicleConvoy): GroundEntry[]
  // stores.ts
  export const KI84_BOMB_LOADOUT: Loadout
  ```

- [ ] **Step 1: 寫失敗的測試**（加在 `test/unit/campaigns.test.ts` 末尾，並把「日 M2 漢口上空」那一整個 `describe` 換成下面的「日 M2 雷伊泰前線」）

```ts
import { EVACUATE_Z, LEYTE_ROAD } from '../../src/world/leyte'
import { convoyGround } from '../../src/battle/missions'
import { KI84 } from '../../src/specs/ki84'
import { F6F5 } from '../../src/specs/f6f5'

describe('日 M2 雷伊泰前線', () => {
  const card = MISSIONS.japan.find((m) => m.id === 'japan-m2') as ReadyMissionCard
  const b = card.battle
  it('Ki-84 掛彈、F6F 全部由波次給、地形 leyte', () => {
    expect(b.blueSpec).toBe(KI84)
    expect(b.redSpec).toBe(F6F5)
    expect(b.redCount).toBe(0)
    expect(b.terrain).toBe('leyte')
    expect(b.loadouts?.ki84?.kind).toBe('bomb')
  })
  it('車隊走的就是 LEYTE_ROAD', () => {
    expect(b.vehicleConvoy?.route).toBe(LEYTE_ROAD)
  })
  it('撤離點在我方身後的 EVACUATE_Z、高度等於任務高度', () => {
    const cfg = missionConfigFrom(card)
    const w = cfg.beats?.find((x) => x.kind === 'withdraw')
    expect(w?.kind).toBe('withdraw')
    if (w?.kind !== 'withdraw') return
    expect(w.point.z).toBe(EVACUATE_Z)
    expect(w.point.y).toBe(b.altitude)
  })
})

describe('有 interdict 的卡一定打得贏', () => {
  const cards = ALL.filter(ready).filter((m) => m.battle.interdict !== undefined)
  it('至少有一張（日 M2）', () => { expect(cards.length).toBeGreaterThan(0) })
  for (const card of cards) {
    const b = card.battle
    const it2 = b.interdict!
    it(`${card.id}：有「摧毀 ≥ count」觸發的返航`, () => {
      const w = b.withdraw!
      expect(w.when.kind).toBe('destroyed')
      if (w.when.kind !== 'destroyed') return
      expect(w.when.atLeast).toBe(it2.count)
      expect(w.when.unit).toBe(it2.unit)
    })
    it(`${card.id}：count + leak 大於那一種車的總數（兩條不會同時可能）`, () => {
      const total = b.vehicleConvoy!.batches.reduce(
        (n, x) => n + x.units.filter((u) => u === it2.unit).length, 0)
      expect(it2.count).toBeLessThanOrEqual(total)
      expect(it2.count + it2.leak).toBeGreaterThan(total)
    })
    it(`${card.id}：車隊一路透傳成地面目標、每一台都帶 motion`, () => {
      const cfg = missionConfigFrom(card)
      const moving = (cfg.ground ?? []).filter((g) => g.motion !== undefined)
      const n = b.vehicleConvoy!.batches.reduce((k, x) => k + x.units.length, 0)
      expect(moving.length).toBe(n)
      expect(cfg.rules.kind).toBe('interdict')
    })
  }
})

describe('convoyGround', () => {
  const c = {
    route: LEYTE_ROAD, speed: 10, turnRadius: 25, gap: 30,
    batches: [{ departAt: 0, units: ['truck', 'truck'] as const }, { departAt: 60, units: ['tank'] as const }],
  }
  it('前車在前：第一批第一輛的集結位置最遠，後面每輛差一個車距', () => {
    const g = convoyGround(c)
    expect(g.map((e) => e.motion!.offsetSeconds * 10)).toEqual([60, 30, 0])
    expect(g.map((e) => e.motion!.departAt)).toEqual([0, 0, 60])
  })
  it('開場擺位就是 motion 在第 0 秒的位置', () => {
    const g = convoyGround(c)
    expect(g[2]!.x).toBeCloseTo(LEYTE_ROAD[0]!.x, 6)
    expect(g[2]!.z).toBeCloseTo(LEYTE_ROAD[0]!.z, 6)
  })
})
```

（`ALL`、`ready`、`missionConfigFrom`、`ReadyMissionCard`、`MISSIONS` 已在該檔頂部 import 或定義；缺的就補 import。）

- [ ] **Step 2: 跑，確認紅**：`npx vitest run test/unit/campaigns.test.ts`

- [ ] **Step 3: `types.ts`**

1. `MissionTrigger` 加：
```ts
  /**
   * 敵方地面目標的摧毀數達到 `atLeast`（`unit` 省略 = 全部）。`byLatest` 選填：
   * 到了那一秒無條件成立。**沒有 `ground`／`vehicleConvoy` 的卡不能用它** ——
   * 摧毀數永遠是 0。
   */
  | { readonly kind: 'destroyed'; readonly atLeast: number; readonly unit?: GroundUnitId; readonly byLatest?: number }
```
2. `GroundEntry` 加 `readonly motion?: GroundMotion`（註解：「沿路線移動的設定。省略 = 不動。由 `vehicleConvoy` 展開時填，卡片不直接寫」），`import type { GroundMotion } from '../../world/groundMotion'`。
3. 新增 `MissionVehicleBatch`、`MissionVehicleConvoy`（見 Interfaces，逐欄寫註解：`gap` 是同一條路上前後兩輛的車距 m；`batches` 依出發順序，第一批排在路線最前面；`units` 依行進順序，第一個是車頭）。
4. `MissionBattle` 加：
```ts
  /**
   * 沿公路開往前線的車隊。**展開成 `ground` 的條目**（`missionConfigFrom`），
   * 每一台帶 `motion`。與 `ground` 可以並存。
   */
  readonly vehicleConvoy?: MissionVehicleConvoy
  /**
   * 截斷車隊：炸毀 `count` 輛 `unit`，抵達 `leak` 輛就輸。**有這一格就是截斷關**，
   * 勝負規則變成 `{ kind: 'interdict' }`。它必須配 `vehicleConvoy`，而且要有
   * 「摧毀 ≥ count」觸發的 `withdraw` —— `campaigns.test.ts` 守著。
   */
  readonly interdict?: { readonly count: number; readonly leak: number; readonly unit: GroundUnitId }
```
5. `MissionWithdraw.distance` 的註解改成：「撤離點在我方機首方向多遠，m。與 `targetDistance` 同一套。**負值 = 在我方開局位置的後方**（撤離點在來時的方向，日 M2）」。

- [ ] **Step 4: `index.ts`**

1. `missionRules` 最前面（`sinkCount` 之前）加：
```ts
  // 【截斷排在最前】它與其他數數量的規則不共存（`campaigns.test.ts`）；排前面
  // 只是讓讀的人先看到它
  if (b.interdict !== undefined) {
    return { kind: 'interdict', count: b.interdict.count, leak: b.interdict.leak, unit: b.interdict.unit }
  }
```
2. 新 export：
```ts
/**
 * 卡片上的車隊 → 地面目標的條目。
 *
 * 【集結位置】全部車輛排在路線起點往前的同一條線上：第一批的車頭最遠，最後一批
 * 的車尾在起點（s = 0）。沿路線距離 = (之後還有幾輛) × `gap`。車速相同，
 * 所以後一批晚出發也不會追撞前一批。
 *
 * 【開場的 x、z、heading 就是 motion 在第 0 秒的姿態】`World.step` 第一步才會
 * 改寫它；擺成別的值的話開場那一幀車會閃一下。
 */
export function convoyGround(c: MissionVehicleConvoy): GroundEntry[] {
  const motion = { speed: c.speed, turnRadius: c.turnRadius, turnRate: c.speed / c.turnRadius }
  const total = c.batches.reduce((n, x) => n + x.units.length, 0)
  const out: GroundEntry[] = []
  const pose = {
    position: new Vector3(), velocity: new Vector3(),
    orientation: new Quaternion(), angularVelocity: new Vector3(),
  }
  let k = 0
  for (const batch of c.batches) {
    for (const unit of batch.units) {
      const m = createGroundMotion(c.route, motion, (total - 1 - k) * c.gap, batch.departAt)
      motionPose(m, 0, pose)
      // 【航向取第一段的】集結位置全部落在第一段上（`leyte.test.ts` 守第一段夠長）
      out.push({
        unit, team: 'red', x: pose.position.x, z: pose.position.z,
        heading: m.startHeading, motion: m,
      })
      k++
    }
  }
  return out
}
```
（`import { Quaternion } from 'three'`、`import { createGroundMotion, motionPose } from '../../world/groundMotion'`。載入期跑一次，不在熱路徑。）
3. `missionConfigFrom` 的 `...(b.ground === undefined ? {} : { ground: b.ground })` 改成：
```ts
    // 【車隊併進地面目標】兩者都有時串起來；只有車隊時就是車隊
    ...(b.ground === undefined && b.vehicleConvoy === undefined
      ? {}
      : { ground: [...(b.ground ?? []), ...(b.vehicleConvoy === undefined ? [] : convoyGround(b.vehicleConvoy))] }),
```
4. `cardBeats` 的 `withdrawBeat(b.withdraw)` → `withdrawBeat(b.withdraw, altitude)`；`withdrawBeat(w, altitude)` 用 `evacuatePoint(altitude, w.distance)`，註解：「【高度跟著卡片】撤離的判定是三維距離（`mission.ts` 的 `distanceTo`）。用預設的 4,000 m 的話，低空關的圓環浮在玩家頭上兩三公里、飛不進去」。
5. `triggerToCondition` 加：
```ts
  if (t.kind === 'destroyed') {
    return {
      kind: 'destroyed', atLeast: t.atLeast,
      ...(t.unit === undefined ? {} : { unit: t.unit }),
      ...(t.byLatest === undefined ? {} : { byLatest: t.byLatest }),
    }
  }
```

- [ ] **Step 5: `setup.ts` 的 `placeGround`**：`createGroundTarget(world.groundTargets.length, e.unit, e.team, e.x, e.z, e.heading)` → 多傳 `e.motion ?? null`。`GroundEntry` 型別若在 `setup.ts` 另有一份（`BattleConfig.ground` 的元素型別），同步加 `motion?`。

- [ ] **Step 6: `stores.ts`**：在 `A6M5_BOMB_LOADOUT` 之後加

```ts
/**
 * 疾風的戰鬥轟炸掛載：翼下兩個掛架，各一顆 250 kg。**不在預設表上**，由任務卡
 * 依機種指定（日 M2 雷伊泰前線）。
 *
 * 【單枚 9,300】與 He 111 的 SC 250 同一個當量。一枚直擊炸得掉同一批裡相鄰的
 * 兩三輛卡車（車距 30 m、爆心 30 m 線性衰減）。**起始值，由試飛裁定。**
 */
export const KI84_BOMB_LOADOUT: Loadout = {
  kind: 'bomb', count: 2, damage: 9_300, reloadSeconds: 20,
}
```

- [ ] **Step 7: `japan.ts`**：import 換掉 `P51D`，加 `F6F5`、`KI84_BOMB_LOADOUT`、`EVACUATE_Z`、`LEYTE_ROAD`；`japan-m2` 整張換成

```ts
  {
    id: 'japan-m2', title: '雷伊泰前線', type: '打擊',
    summary: '駕駛疾風掛彈攻擊美軍補給車隊，趕在它們抵達前線之前，然後撤離。',
    place: '菲律賓　雷伊泰島', period: '1944 年 11 月',
    battle: {
      objective: '炸毀補給卡車', banner: '找到車隊，別讓它們抵達前線',
      blueSpec: KI84, redSpec: F6F5, convoySpec: null,
      // 【F6F 全部由波次給】開場天上沒有敵機 —— 那一段是找車、俯衝
      blueCount: 8, redCount: 0,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'leyte',
      altitude: 1500,
      loadouts: { ki84: KI84_BOMB_LOADOUT },
      // 【僚機先打卡車】遭到敵機直接瞄準時才自衛
      priorityGroundUnit: 'truck',
      /**
       * 【三批、每批五輛】卡車 3、戰車 1、防空車 1。戰車只有炸彈炸得掉、不計分；
       * 防空車照陸上輕型砲開火。0／75／150 秒從灘頭出發，全程約 6.6 km、
       * 約 11 分鐘。**全部是起始值，由試飛裁定。**
       */
      vehicleConvoy: {
        route: LEYTE_ROAD, speed: 10, turnRadius: 25, gap: 30,
        batches: [
          { departAt: 0, units: ['flakLight', 'truck', 'truck', 'tank', 'truck'] },
          { departAt: 75, units: ['flakLight', 'truck', 'truck', 'tank', 'truck'] },
          { departAt: 150, units: ['flakLight', 'truck', 'truck', 'tank', 'truck'] },
        ],
      },
      // 【9 輛卡車：炸 6 輛、放走 4 輛就輸】6 + 4 > 9，兩條不會同時可能
      interdict: { count: 6, leak: 4, unit: 'truck' },
      /**
       * 【F6F 兩批都從撤退的方向來】`starboard: π` 把紅方的進場轉到 +Z 那一側
       * （Ki-84 來的方向）。第一批在開始攻擊之後進場、第二批在轉入撤離的那一刻
       * 從撤離點附近正面迎上。
       */
      waves: [
        {
          when: { kind: 'destroyed', atLeast: 1, unit: 'truck', byLatest: 90 },
          warn: '敵艦載機接近中',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 4, starboard: Math.PI, altitude: 2500,
        },
        // 【預警會被撤離訊息蓋掉】與返航同一步觸發，`stepBeats` 依陣列順序寫
        // `b.message`，返航排在最後 —— 畫面上是「撤離戰區」。敵機就在退路上，
        // 玩家飛回去就看得到
        {
          when: { kind: 'destroyed', atLeast: 6, unit: 'truck' },
          warn: '撤離戰區',
          warnLead: 0,
          side: 'theirs', spec: F6F5, count: 4, starboard: Math.PI, along: 0.8,
        },
      ],
      withdraw: {
        when: { kind: 'destroyed', atLeast: 6, unit: 'truck' },
        message: '撤離戰區',
        // 【負值 = 在開局位置的後方】撤離點在 Ki-84 來的方向
        distance: -EVACUATE_Z,
        radius: 1000,
        seconds: Infinity,
      },
    },
  },
```
並刪掉 `japan.ts` 頂部已不再使用的 `P51D` import。**先確認 `MissionWave` 有 `starboard` 與 `altitude` 兩格**（`index.ts` 的 `waveBeat` 讀 `w.starboard`、`w.altitude`）；`along: 0.8` 在 `starboard` 之後覆寫縱深 —— 轉過之後藍方那一側是正的 along，所以 0.8 × 10,000 = z ≈ +8,000，在撤離點前 1 km。

- [ ] **Step 8: `menu.ts:107`**：`'瓜島到倫內爾島：掩護雷擊隊，漢口迎擊野馬。'` → `'瓜島、雷伊泰到倫內爾島：掩護雷擊隊，截斷補給車隊。'`

- [ ] **Step 9: 三處會紅的既有斷言**（不屬於 `KILL_CARD`／漢口，這一步就改）
  - `test/unit/campaigns.test.ts:217-225`「地面 P-51 優先權只在德國第三張任務卡啟用」：改成逐卡的期待表 —— `germany-m3` 是 `'parkedP51'`、`japan-m2` 是 `'truck'`、其餘 `undefined`；標題改成「地面優先權只在需要它的卡上」
  - `test/unit/missions.test.ts:246-259`：跳過的規則清單加上 `'interdict'`（它沒有 `point`）
  - `test/integration/mission-convoy.test.ts:328-333`：斷言 `japan-m2` 的 `rules.kind` 是 `'annihilate'` —— 改用 Task 7 的合成殲滅卡（若 Task 7 尚未完成，這一條併到 Task 7 Step 1 一起改）

- [ ] **Step 9b: 跑**：`npx vitest run test/unit/campaigns.test.ts test/unit/missions.test.ts` → 除了引用 `KILL_CARD`／漢口的舊斷言（Task 7 處理）之外全綠；`npx tsc --noEmit` → 0。接著回頭執行 Task 5 Step 5 第 6 點的判定順序護欄。

- [ ] **Step 10: 變異驗證** —— `withdraw.when.atLeast` 暫時改 7，確認「有摧毀 ≥ count 觸發的返航」紅；`withdrawBeat` 暫時改回讀 `DEFAULT_BATTLE.altitude`，確認「高度等於任務高度」紅。都改回來。

- [ ] **Step 11: Commit**

```bash
git add src/battle/missions/types.ts src/battle/missions/index.ts src/battle/missions/japan.ts src/battle/setup.ts src/weapons/stores.ts src/ui/menu.ts test/unit/campaigns.test.ts test/unit/missions.test.ts
git commit -m "feat(battle): 日 M2 換成雷伊泰前線——Ki-84 截斷補給車隊後撤離"
```

---

### Task 7: 既有測試與文件跟上

**Files:**
- Modify: `test/fixtures/mission.ts`、`test/unit/briefing.test.ts`、`test/unit/campaigns.test.ts`（地形表、其他寫死漢口的斷言）、`test/unit/battle-lights.test.ts`、`test/integration/mission-convoy.test.ts`、`test/e2e/mission.e2e.ts`、`docs/roadmap.md`、`docs/superpowers/specs/2026-09-13-campaign-rework-design.md`

- [ ] **Step 1: 合成的殲滅卡** —— `test/fixtures/mission.ts` 的 `export const KILL_CARD = 'japan-m2'` 改成照 `INTERCEPT_CARD` 的做法：一個 id 常數 `KILL_CARD = 'kill-fixture'`，並讓 `readyCard(KILL_CARD)` 回傳一張合成卡（Ki-84 ×8 對 P-51D ×10、`entry: 'bounce'`、`terrain: 'farmland'`、`...KILL`）—— 也就是舊漢口卡的戰鬥內容。**先讀 `readyCard` 與 `INTERCEPT_CARD` 怎麼分派**，照同一個分支寫；`cardWith(KILL_CARD, ...)` 要能用。註解：「出貨的九關沒有殲滅卡了；遭遇戰仍然用這條規則，所以殲滅相關的測試用這一張合成卡」。

- [ ] **Step 2: 跑所有用到 `KILL_CARD` 的測試**

Run: `npx vitest run test/unit/briefing.test.ts test/unit/mission-waves.test.ts test/unit/missions.test.ts test/unit/takeoff-roll.test.ts test/integration/mission-evacuate.test.ts`
失敗的斷言逐一看：寫死漢口空域／`japan-m2` 的，改成合成卡或新的雷伊泰。

- [ ] **Step 3: 其他寫死 `japan-m2` 的地方**

- `briefing.test.ts:89-90`：「日 M2 的空域是漢口」→「日 M2 的空域是雷伊泰島」，期待值 `'菲律賓　雷伊泰島'`
- `campaigns.test.ts:96-97`：`expect(of('japan-m2')).toBe('leyte')`，註解改成「日 M2 是雷伊泰（海岸線地形）」
- `campaigns.test.ts:305` 附近取 `japan-m2` 的那一段：讀它在測什麼，改成合適的卡或刪掉只為漢口存在的斷言
- `battle-lights.test.ts:27`、`mission-convoy.test.ts:328`：讀斷言內容，依新卡調整（例如 `mission-convoy` 若是「非護送卡沒有 convoy」，`japan-m2` 仍然成立就不動）
- `test/e2e/mission.e2e.ts:187`：`ringOf({ campaign: 'japan', id: 'japan-m2' })` 是拿它當殲滅卡量「沒有圓環」—— 換成沖繩外海（`allies-m3`，規則 `defend`，同樣沒有圓環）

Run: `npx vitest run test/unit/campaigns.test.ts test/unit/briefing.test.ts test/unit/battle-lights.test.ts test/integration/mission-convoy.test.ts` → PASS

- [ ] **Step 4: 文件**

- `docs/roadmap.md` 的九關表（第 534 行附近）：日 M2 那一列換成 `| 日 M2 | japan-m2 | 雷伊泰前線 | 打擊 | Ki-84 ×8（250 kg ×2） | F6F-5 ×4 + ×4（波次） | — | leyte | interdict → evacuate | 兩批 F6F、撤離 | japan.ts |`；第 47、320–332 行一帶提到「日 M2 漢口」「Ki-84 日 M2」的敘述照現況改寫；待辦區加一條「日 M2 的美軍車輛模型：GMC CCKW 卡車、M16 半履帶防空車（目前沿用 ZiS-150／Flak 38）」
- `2026-09-13-campaign-rework-design.md` 的 §3 表格日 M2 那一列與 §8.5 標題下各加一行：「日 M2 已由 `2026-09-23-japan-m2-leyte-design.md` 取代。」

- [ ] **Step 5: 整層回歸**

Run: `npx vitest run --maxWorkers=4 --minWorkers=1`
Expected: 全綠（perf-gate 類在並行下假紅時單獨重跑確認）。`npx tsc --noEmit` → 0。

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/mission.ts test/unit/briefing.test.ts test/unit/campaigns.test.ts test/unit/battle-lights.test.ts test/integration/mission-convoy.test.ts test/e2e/mission.e2e.ts docs/roadmap.md docs/superpowers/specs/2026-09-13-campaign-rework-design.md
git commit -m "test(battle): 殲滅卡改用合成卡；文件跟上雷伊泰前線"
```

---

### Task 8: 實機驗收（Playwright）

**Files:** 無（驗收用的探針若要留，放 `test/e2e/leyte-shot.e2e.ts`，照 `farmland-shot.e2e.ts` 的寫法，用 vite-node 跑）

- [ ] **Step 1**: 起 dev server（`npm run dev`，背景），照 `test/e2e/farmland-shot.e2e.ts` 的方式開頁、進日本線 M2。
- [ ] **Step 2**: 開場截圖：看得到海岸線（上方是海）、公路、灘頭的車隊。
- [ ] **Step 3**: 用 `__still` 或時間快轉推進 60 秒，再截一張：第一批車已經沿公路離開灘頭（比對車的位置）。
- [ ] **Step 4**: 讀 console，不得有 shader 編譯錯誤（公路的 GLSL）。讀植被的 `stats.overflow`（`main.ts` 的量測出口），必須是 0；不是 0 就給 leyte 一組自己的 `capacity`，照 `vegetation.test.ts` 的哨兵掃描定值。
- [ ] **Step 5**: 若主控台或截圖有問題，修正後重跑；通過之後把截圖放 scratchpad，回報負責人試飛。

---

## Self-Review 紀錄

- Spec §4 座標 → Task 2；§5 地形 → Task 2、3；§6 車隊 → Task 1、4、6；§7 規則節拍 → Task 5、6；§7.4 撤離高度與負距離 → Task 6 Step 4、7；§7.5 AI 僚機 → Task 6（`priorityGroundUnit`，提前量走既有 `speed`）；§7.6 HUD → Task 5 Step 3、6；§8 卡片 → Task 6；§10 護欄 → 各 Task 的測試；§11 驗收 → Task 7 Step 5、Task 8
- 型別一致：`GroundMotion`、`createGroundMotion`、`motionPose`、`stepGroundMotion`、`walkRoute`、`RouteMotion`、`countDestroyed`、`destroyedInPool`、`convoyGround`、`KI84_BOMB_LOADOUT` 在定義與使用處同名同簽名
