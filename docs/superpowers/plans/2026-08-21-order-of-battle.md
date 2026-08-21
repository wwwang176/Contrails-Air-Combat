# 編組表（Order of Battle）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**：把 `BattleConfig` 的 `blueCount` / `redCount` / `blueSpec` / `redSpec` /
`entry` 五個欄位換成一張二維編組表（外層小隊、內層每一架），**行為逐位元不變**。

**Architecture**：新檔 `src/battle/order.ts` 放型別 `FlightPlan` 與兩支純函數
（`lineAbreast` 產出既有的橫隊排列、`assertOrderOfBattle` 守前提）。`createBattle`
的「側 → 小隊 → 槽位」三層迴圈壓成「掃編組表 → 掃成員」兩層。`createFlights`
從自己猜分組改成吃呼叫端給的小隊大小。既有的一百多處呼叫端靠 `lineAbreast`
做機械式替換，座標一個位元都不動。

**Tech Stack**：TypeScript（`strict` + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`）、three.js、vitest。

**Spec**：`docs/superpowers/specs/2026-08-21-order-of-battle-design.md`

## Global Constraints

- **所有註解、commit message、測試名稱一律繁體中文。**
- **護欄重新定值是專案負責人的決定。** 測試紅了要先量、先報告、先問，
  絕不為了讓測試變綠而放寬門檻。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且長期被修改的檔案，
  一律列明確路徑。
- **絕不用 PowerShell 讀寫含中文的檔案**（會變亂碼）；用 Read/Write 工具或
  Python `io.open(..., encoding='utf-8')`。
- 不得引入 `@types/node`。型別檢查指令是 `npx tsc --noEmit`。
- `test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts` **必須單獨跑**。
- 既有三條紅測試（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）是既有的，
  驗收時**確認數量沒有增加**即可。
- 熱路徑零配置的紀律不變；`createBattle` 不是熱路徑，可以配置。
- `exactOptionalPropertyTypes: true` —— `{ player: undefined }` **不能**指派給
  `player?: boolean`。要嘛不寫那個鍵，要嘛寫 `true`。
- `noUncheckedIndexedAccess: true` —— 陣列索引的結果是 `T | undefined`，
  一律用 `!` 或先判斷。
- 小隊大小上限維持 `SCHWARM_SIZE = 4`，**不動 `STATION_OFFSETS`**。

---

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| `src/battle/order.ts`（新） | 編組表的型別、`lineAbreast`、`assertOrderOfBattle`、`sideSummary`。**純函數，不 import `setup.ts`** |
| `src/battle/entry.ts` | 不動。`SideEntry` / `EntryPlan` / `ENTRY_PLANS` 原封不動被 `order.ts` 使用 |
| `src/battle/flights.ts` | `createFlights` 多一個選擇性的 `sizes` |
| `src/battle/setup.ts` | `BattleConfig` 換欄位、`DEFAULT_BATTLE` 改用 `lineAbreast`、`createBattle` 換迴圈 |
| `src/battle/skirmish.ts` / `missions.ts` | 兩個組態入口改組 `units` |
| `src/main.ts` | 除錯行改用 `sideSummary` |
| `test/fixtures/spawn-baseline.ts`（新） | 凍結的出生表、編制表、重播校驗和 |
| `test/tools/spawn-baseline.probe.ts`（新） | 產生上面那份 fixture 的工具 |
| `test/unit/battle-order.test.ts`（新） | `order.ts` 的單元測試 |
| `test/integration/order-of-battle-replay.test.ts`（新） | 出生表逐字相同 + 30 秒重播校驗和相同 |

**相依方向**：`order.ts → entry.ts / specs/types.ts / flights.ts(SCHWARM_SIZE)`，
`setup.ts → order.ts`。沒有循環。

---

## Task 1：出生與編制的基準先落地

**這一步必須在動任何 `src/battle/setup.ts` 或 `flights.ts` 之前完成並 commit。**
重構之後就再也跑不出「改動前」的那一份了。

**Files:**
- Create: `test/tools/spawn-snapshot.ts`（**純函數，沒有頂層執行碼**）
- Create: `test/tools/spawn-baseline.probe.ts`（只負責印）
- Create: `test/fixtures/spawn-baseline.ts`
- Create: `test/integration/order-of-battle-replay.test.ts`

**Interfaces:**
- Consumes：現況的 `createBattle(playerController, cfg, seed)`、`DEFAULT_BATTLE`、
  `HEAD_ON` / `PURSUIT`（`src/battle/entry.ts`）。
- Produces：
  - `test/tools/spawn-snapshot.ts` 匯出 `num`、`spawnLines`、`replayDigest`、
    `SCENES`、`Idle`
  - `test/fixtures/spawn-baseline.ts` 匯出
  - `HEADON_20V20: readonly string[]`
  - `PURSUIT_MIRROR_8V8: readonly string[]`
  - `HEADON_20V20_REPLAY: string`（`元素個數:SHA-256 十六進位`）
  - `PURSUIT_MIRROR_8V8_REPLAY: string`

- [ ] **Step 1：寫共用的快照函數**

Create `test/tools/spawn-snapshot.ts`。

**【為什麼要單獨一個檔】** 探針與重播測試要用同一份快照函數，而這個專案的
探針都是**頂層直接執行**的（`turret-arc-leak.probe.ts` 那一批都是）。測試去
import 一個會執行的模組，等於每跑一次測試就順便跑一次 30 秒的探針。

```ts
/**
 * 出生表、編制表與重播校驗和的**共用快照函數**。**沒有頂層執行碼** ——
 * 印東西的是 `spawn-baseline.probe.ts`，比對的是
 * `test/integration/order-of-battle-replay.test.ts`，兩邊 import 這裡。
 *
 * 【它為什麼存在】編組表那一輪（spec 2026-08-21）宣稱**行為逐位元不變**。
 * 重構之後就跑不出改動前的那一份了，所以基準必須先落地。

 * 【為什麼用字串而不是 Float64Array】JS 的 `String(number)` 對有限值是
 * **可逆的最短表示**（負零要特判，見 `num`）。所以文字 fixture 既是逐位元
 * 的，人也讀得懂「第 12 架在哪」。存二進位反而看不出哪裡不一樣。
 *
 * 【為什麼重播只存校驗和】30 秒 20v20 的完整快照有四萬多個浮點數，進 repo
 * 太大。出生表是這個重構**真正會弄壞的東西**，逐字存（那一半是真的逐位元）；
 * 重播只是證明「出生一樣之後，後面的動力學也一樣」，SHA-256 就夠。
 *
 * 【重新產生】`entry.ts` 的擺法或 `setup.ts` 的生成幾何**有意識地**改了之後，
 * 重跑 `spawn-baseline.probe.ts`，把輸出整段貼回
 * `test/fixtures/spawn-baseline.ts`。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../../src/battle/setup'
import { HEAD_ON, PURSUIT } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SEED = 20260821
const STEPS = 240 * 30

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

/**
 * 浮點數 → 逐位元可逆的字串。
 *
 * 【為什麼不能直接用 `String(x)`】**`String(-0)` 是 `'0'`，轉回去是 `+0`**
 * —— 負零是 `String` 唯一不可逆的有限值（實測
 * `Object.is(Number(String(-0)), -0)` 是 false）。而 `-0` 在這裡真的生得
 * 出來：`FWD` 是 `(0, 0, -1)`，套上四元數之後 x 與 y 分量會經過帶負號的
 * 乘加。少了這一行，一個「把某個分量從 −0 變成 +0」的改動會**悄悄通過**
 * 這條護欄。
 *
 * 其餘有限值 `String` 都是可逆的最短表示，NaN 與 ±Infinity 也各有唯一字串
 * —— 所以只要特判負零就夠。
 */
export function num(x: number): string {
  return Object.is(x, -0) ? '-0' : String(x)
}

/** 出生表 + 編制表。**順序就是 `world.combatants` 的順序。** */
export function spawnLines(b: Battle): string[] {
  const out: string[] = []
  for (const c of b.world.combatants) {
    const s = c.aircraft.state
    const a = c.aircraft
    out.push(`${c.index} ${c.team} ${a.spec.id}`
      + ` | ${num(s.position.x)} ${num(s.position.y)} ${num(s.position.z)}`
      + ` | ${num(s.orientation.x)} ${num(s.orientation.y)}`
      + ` ${num(s.orientation.z)} ${num(s.orientation.w)}`
      + ` | ${num(s.velocity.x)} ${num(s.velocity.y)} ${num(s.velocity.z)}`
      // 【prev* 與 spawn* 都是這個迴圈直接寫進去的 —— Codex 2026-08-21 指出
      // 漏了】漏掉的欄位在基準與候選兩邊都不會進陣列，所以「元素個數相同」
      // 補不了這個洞：那個欄位的迴歸永遠抓不到。
      + ` | ${num(a.prevPosition.x)} ${num(a.prevPosition.y)} ${num(a.prevPosition.z)}`
      + ` | ${num(a.prevOrientation.x)} ${num(a.prevOrientation.y)}`
      + ` ${num(a.prevOrientation.z)} ${num(a.prevOrientation.w)}`
      + ` | ${num(c.spawnPosition.x)} ${num(c.spawnPosition.y)} ${num(c.spawnPosition.z)}`
      + ` | ${num(c.spawnTas)} ${num(c.spawnAltitude)} ${c.respawnOnDestroy ? 1 : 0}`
      // 【玩家是誰也要進表】它由 `unit.player` 決定，正是這一輪改動的東西
      + ` | ${c.index === b.playerSeat ? '玩家' : 'AI'}`)
  }
  for (const f of b.flights.flights) out.push(`小隊 ${f.team} ${f.roster.join(',')}`)
  out.push(`玩家座位 ${b.playerSeat}`)
  return out
}

/**
 * 30 秒之後整個世界的 **SHA-256**，外加元素個數。
 *
 * 【為什麼不是 32 位元 FNV-1a —— Codex 2026-08-21】32 位元的碰撞空間只有
 * 43 億，而這裡比的是四萬多個浮點數。長度相同 + 32 位元雜湊相同**推不出**
 * 位元相同。SHA-256 在密碼學意義上碰撞不可行，所以它是**高可信校驗**
 * —— 不是數學上的逐位元比較，但足以當護欄。真正逐位元的那一半是出生表
 * （逐字存）。
 *
 * 【為什麼連元素個數一起回】校驗和相同但長度不同是「少抓了一個欄位」的
 * 典型症狀。**注意它補不了「兩邊都漏同一個欄位」** —— 那只能靠涵蓋得夠。
 *
 * 【`crypto.subtle` 不需要 @types/node】它在 `lib: ["DOM"]` 裡，實測
 * `npx tsx` 與 vitest 下都可用。代價是這支必須是 async。
 */
export async function replayDigest(b: Battle): Promise<string> {
  const cs = b.world.combatants
  const p = b.world.projectiles
  const v: number[] = [b.world.time, p.live]
  for (const c of cs) {
    const st = c.aircraft.state
    v.push(st.position.x, st.position.y, st.position.z)
    v.push(st.velocity.x, st.velocity.y, st.velocity.z)
    v.push(st.angularVelocity.x, st.angularVelocity.y, st.angularVelocity.z)
    v.push(st.orientation.x, st.orientation.y, st.orientation.z, st.orientation.w)
    v.push(c.hp, c.alive ? 1 : 0, c.hitsDealt)
    // 【controls 與 surfaces 都要 —— Codex 2026-08-21 指出漏了】`surfaces`
    // 是作動器落後的狀態，**會延續到下一步**。漏掉它等於漏掉一整條積分。
    for (const k of ['aileron', 'elevator', 'rudder', 'throttle', 'brake'] as const) {
      v.push(c.aircraft.controls[k], c.aircraft.surfaces[k])
    }
    for (let i = 0; i < c.cooldowns.length; i++) v.push(c.cooldowns[i]!)
    for (let i = 0; i < c.muzzleFlash.length; i++) v.push(c.muzzleFlash[i]!)
    for (const t of c.turretStates) {
      v.push(t.aim.x, t.aim.y, t.aim.z, t.phase, t.targetIndex, t.searchCooldown)
      v.push(t.burstFiring ? 1 : 0, t.burstTimer, t.burstScale, t.flash, t.lastBarrel)
    }
    for (let i = 0; i < c.turretCooldowns.length; i++) v.push(c.turretCooldowns[i]!)
  }
  // 【環狀游標也要】它決定下一發覆寫哪一格。兩場的彈丸完全相同但游標差一格，
  // 之後就會分岔 —— 而分岔要好幾秒才顯現，那時已經查不出源頭
  v.push(p.cursor, p.peakLive)
  for (let i = 0; i < p.capacity; i++) {
    v.push(p.owner[i]!, p.damage[i]!, p.age[i]!)
    v.push(p.sx[i]!, p.sy[i]!, p.sz[i]!)
    v.push(p.x[i]!, p.y[i]!, p.z[i]!, p.vx[i]!, p.vy[i]!, p.vz[i]!)
  }
  const f = Float64Array.from(v)
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(hash))
    .map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${f.length}:${hex}`
}

/** 兩個場景。**非鏡像與鏡像各一** —— 鏡像那一場專門守 applyFeel 的記憶化。 */
export const SCENES = {
  HEADON_20V20: () => ({
    ...DEFAULT_BATTLE,
    blueSpec: P51D, redSpec: BF109G6, blueCount: 20, redCount: 20, entry: HEAD_ON,
  }),
  PURSUIT_MIRROR_8V8: () => ({
    ...DEFAULT_BATTLE,
    blueSpec: P51D, redSpec: P51D, blueCount: 8, redCount: 8, entry: PURSUIT,
  }),
}

```

- [ ] **Step 1b：寫探針本體**

Create `test/tools/spawn-baseline.probe.ts`：

```ts
/**
 * 產生「改動前」的出生表、編制表與 30 秒重播校驗和。
 *
 *   npx tsx test/tools/spawn-baseline.probe.ts > test/fixtures/spawn-baseline.ts
 *
 * 邏輯全在 `spawn-snapshot.ts`，這裡只負責印。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { Idle, SCENES, SEED, STEPS, DT, spawnLines, replayDigest } from './spawn-snapshot'

// 【頂層 await】`isolatedModules` + ESNext module 下可用；`replayDigest` 因為
// 走 `crypto.subtle` 是 async
for (const [name, make] of Object.entries(SCENES)) {
  const b = createBattle(new Idle(), make(), SEED)
  console.log(`export const ${name}: readonly string[] = [`)
  for (const line of spawnLines(b)) console.log(`  '${line}',`)
  console.log(']')
  for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
  console.log(`export const ${name}_REPLAY = '${await replayDigest(b)}'`)
  console.log('')
}
```

**`DT` / `SEED` / `STEPS` / `Idle` / `SCENES` 都要從 `spawn-snapshot.ts`
`export` 出來** —— 探針與測試必須用同一組值，各寫一份就是遲早會漂開的那種。

**注意**：`SCENES` 的兩個字面值在 Task 4 會被換成 `units: lineAbreast(...)`，
但 fixture 的內容不變 —— 那正是這一輪要證明的事。

- [ ] **Step 2：跑探針，確認它印得出東西**

```bash
npx tsx test/tools/spawn-baseline.probe.ts | head -20
```

Expected：印出 `export const HEADON_20V20: readonly string[] = [` 開頭、
每行一架、共 40 架 + 10 個小隊 + 1 行玩家座位。

- [ ] **Step 3：把輸出存成 fixture**

```bash
mkdir -p test/fixtures
npx tsx test/tools/spawn-baseline.probe.ts > test/fixtures/spawn-baseline.ts
```

然後用 Write 工具在檔案最前面補上這段檔頭（**不要用 PowerShell 寫中文**）：

```ts
/**
 * 「編組表重構之前」的出生表、編制表與 30 秒重播校驗和。
 *
 * **這是 spec 2026-08-21（編組表）唯一的驗收基準。** 由
 * `test/tools/spawn-baseline.probe.ts` 產生 —— 生成幾何**有意識地**改了之後
 * 重跑那一支，把輸出整段貼回來。
 *
 * 【不要手改這裡的數字】它們是 `String(number)` 的最短可逆表示，逐位元等價。
 * 手改一個位數就等於悄悄放寬了一條護欄。
 */
```

- [ ] **Step 4：寫重播測試**

Create `test/integration/order-of-battle-replay.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import {
  Idle, SCENES, SEED, STEPS, DT, spawnLines, replayDigest,
} from '../tools/spawn-snapshot'
import * as BASE from '../fixtures/spawn-baseline'

/**
 * 【為什麼判準是「逐字相同」而不是「差在容差內」】這一輪宣稱的就是**同一個
 * 浮點運算序列**。容許 1e-9 的差等於承認算式變了，而那時「哪裡變了」沒有人
 * 答得出來。`String(number)` 是可逆的最短表示，字串相等就是位元相等。
 */
describe('編組表重構：行為逐位元不變', () => {
  for (const name of ['HEADON_20V20', 'PURSUIT_MIRROR_8V8'] as const) {
    it(`${name}：出生表與編制表逐字相同`, () => {
      const b = createBattle(new Idle(), SCENES[name](), SEED)
      const got = spawnLines(b)
      const want = BASE[name]
      expect(got.length).toBe(want.length)
      for (let i = 0; i < want.length; i++) expect(got[i]).toBe(want[i])
    }, 60 * 1000)

    it(`${name}：30 秒重播的校驗和相同`, async () => {
      const b = createBattle(new Idle(), SCENES[name](), SEED)
      for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
      expect(await replayDigest(b)).toBe(BASE[`${name}_REPLAY`])
    }, 5 * 60 * 1000)
  }
})
```

- [ ] **Step 5：跑測試，現在必須全綠**

```bash
npx tsc --noEmit
npx vitest run test/integration/order-of-battle-replay.test.ts
```

Expected：4 passed。**這一刻它們是同義反覆（拿現況比現況），那是對的** ——
它們要守的是 Task 4 之後。

- [ ] **Step 6：Commit**

```bash
git add test/tools/spawn-baseline.probe.ts test/fixtures/spawn-baseline.ts \
        test/integration/order-of-battle-replay.test.ts
git commit -m "test: 編組表重構的基準 —— 出生表、編制表、30 秒重播校驗和

重構之後就跑不出「改動前」的那一份了，所以基準必須先落地。

出生表逐字存（String(number) 是可逆的最短表示，字串相等就是位元相等，而且
人讀得懂第 12 架在哪，而且負零有特判）；30 秒重播只存 SHA-256 與元素個數
—— 完整快照有四萬多個浮點數，進 repo 太大，而出生表才是這個重構真正會弄壞
的東西。

兩個場景：非鏡像（P-51 vs Bf109、對頭、20v20）與鏡像（P-51 vs P-51、追擊、
8v8）。鏡像那一場專門守 applyFeel 的記憶化。"
```

---

## Task 2：`src/battle/order.ts`

純函數，**不接線**。做完之後全部既有測試照舊，只是多了一個沒有人用的模組。

**Files:**
- Create: `src/battle/order.ts`
- Create: `test/unit/battle-order.test.ts`

**Interfaces:**
- Consumes：`SideEntry` / `EntryPlan`（`./entry`）、`AircraftSpec`
  （`../specs/types`）、`SCHWARM_SIZE`（`./flights`）。
- Produces：
  - `interface FlightPlan { team; members; entry; lane; tier; player? }`
  - `type OrderOfBattle = readonly FlightPlan[]`
  - `lineAbreast(plan: EntryPlan, blueSpec, blueCount, redSpec, redCount): OrderOfBattle`
  - `assertOrderOfBattle(units: OrderOfBattle): void`
  - `sideSummary(units: OrderOfBattle, team: 'blue' | 'red'): string`

- [ ] **Step 1：寫失敗的測試**

Create `test/unit/battle-order.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  lineAbreast, assertOrderOfBattle, sideSummary, type OrderOfBattle,
} from '../../src/battle/order'
import { HEAD_ON, PURSUIT } from '../../src/battle/entry'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { B17G } from '../../src/specs/b17g'

const blue = (u: OrderOfBattle) => u.filter((f) => f.team === 'blue')
const red = (u: OrderOfBattle) => u.filter((f) => f.team === 'red')

describe('lineAbreast', () => {
  it('20v20 切成各五個小隊，每隊四架', () => {
    const u = lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)
    expect(u.length).toBe(10)
    expect(blue(u).length).toBe(5)
    expect(red(u).length).toBe(5)
    for (const f of u) expect(f.members.length).toBe(SCHWARM_SIZE)
  })

  /**
   * 【lane 是序號不是公尺】它乘上 `schwarmSpacing` 才是公尺。這條守的是
   * 「改動前 `(f − (n−1)/2)` 那個中間值」—— 數字一樣，浮點運算序列才一樣。
   */
  it('lane 對稱、以中央為 0', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)).map((f) => f.lane))
      .toEqual([-2, -1, 0, 1, 2])
    expect(blue(lineAbreast(HEAD_ON, P51D, 16, BF109G6, 16)).map((f) => f.lane))
      .toEqual([-1.5, -0.5, 0.5, 1.5])
    expect(blue(lineAbreast(HEAD_ON, P51D, 4, BF109G6, 4)).map((f) => f.lane))
      .toEqual([0])
  })

  it('tier 就是小隊序號', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)).map((f) => f.tier))
      .toEqual([0, 1, 2, 3, 4])
  })

  it('架數不是四的倍數時，最後一個小隊比較小', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 6, BF109G6, 4)).map((f) => f.members.length))
      .toEqual([4, 2])
    expect(blue(lineAbreast(HEAD_ON, P51D, 1, BF109G6, 1)).map((f) => f.members.length))
      .toEqual([1])
  })

  /**
   * 【玩家落在藍隊正中央那個小隊的長機】判準逐字照抄改動前的
   * `playerSlot = floor(ceil(blueCount / SCHWARM_SIZE) / 2) × SCHWARM_SIZE`。
   */
  it('恰好一筆 player，且在藍隊正中央那一隊', () => {
    // 【6 架的期望值是 1 不是 0 —— Codex 2026-08-21 實測抓到】
    // floor(ceil(6/4)/2) = floor(2/2) = 1，也就是第二個小隊（那一隊只有兩架）。
    // 實跑現行程式：playerIndex 4、flight 1、rosters [[0,1,2,3],[4,5],…]
    for (const [count, want] of [[20, 2], [16, 2], [6, 1], [4, 0], [1, 0]] as const) {
      const u = lineAbreast(HEAD_ON, P51D, count, BF109G6, 8)
      const marked = u.filter((f) => f.player === true)
      expect(marked.length).toBe(1)
      expect(marked[0]!.team).toBe('blue')
      expect(blue(u).indexOf(marked[0]!)).toBe(want)
    }
  })

  /**
   * 【順序是護欄，不是巧合】`world.add` 的順序決定 combatant 索引，而索引
   * 決定 AI 決策相位、名字指派、砲塔的點放錯開。藍紅交錯的表會讓那三件事
   * 全部換位置，而且不會有任何錯誤。
   */
  it('藍隊的小隊全部排在紅隊之前', () => {
    const u = lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)
    const firstRed = u.findIndex((f) => f.team === 'red')
    expect(firstRed).toBeGreaterThan(0)
    for (let i = firstRed; i < u.length; i++) expect(u[i]!.team).toBe('red')
  })

  it('entry 直接取自 EntryPlan 的兩側', () => {
    const u = lineAbreast(PURSUIT, P51D, 4, B17G, 4)
    expect(blue(u)[0]!.entry).toBe(PURSUIT.blue)
    expect(red(u)[0]!.entry).toBe(PURSUIT.red)
  })
})

describe('assertOrderOfBattle', () => {
  const ok = lineAbreast(HEAD_ON, P51D, 8, BF109G6, 8)

  it('正常的表不拋', () => {
    expect(() => assertOrderOfBattle(ok)).not.toThrow()
  })

  it('沒有玩家 → 拋', () => {
    const bad = ok.map((f) => ({ ...f, player: undefined as unknown as true }))
      .map(({ player: _p, ...rest }) => rest) as OrderOfBattle
    expect(() => assertOrderOfBattle(bad)).toThrow(/玩家/)
  })

  it('兩個玩家 → 拋', () => {
    const bad: OrderOfBattle = [{ ...ok[0]!, player: true }, { ...ok[1]!, player: true },
      ...ok.slice(2)]
    expect(() => assertOrderOfBattle(bad)).toThrow(/玩家/)
  })

  it('玩家在紅隊 → 拋', () => {
    const bad: OrderOfBattle = ok.map((f) => (f.player === true
      ? (({ player: _p, ...rest }) => rest)(f)
      : f)).concat([{ ...ok[ok.length - 1]!, player: true }]) as OrderOfBattle
    expect(() => assertOrderOfBattle(bad)).toThrow(/藍隊/)
  })

  it('空的小隊 → 拋', () => {
    const bad: OrderOfBattle = [{ ...ok[0]!, members: [] }, ...ok.slice(1)]
    expect(() => assertOrderOfBattle(bad)).toThrow(/1 … 4/)
  })

  it('五架的小隊 → 拋', () => {
    const bad: OrderOfBattle = [
      { ...ok[0]!, members: [P51D, P51D, P51D, P51D, P51D] }, ...ok.slice(1)]
    expect(() => assertOrderOfBattle(bad)).toThrow(/1 … 4/)
  })

  it('藍紅交錯 → 拋', () => {
    const bad: OrderOfBattle = [...red(ok).slice(0, 1), ...blue(ok), ...red(ok).slice(1)]
    expect(() => assertOrderOfBattle(bad)).toThrow(/順序/)
  })

  it('一隊都沒有 → 拋', () => {
    expect(() => assertOrderOfBattle(blue(ok))).toThrow(/紅隊/)
  })
})

describe('sideSummary', () => {
  it('單一機種', () => {
    expect(sideSummary(lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20), 'blue'))
      .toBe('20 × p51d')
  })

  it('混編照出現順序列出', () => {
    const u: OrderOfBattle = [
      ...lineAbreast(HEAD_ON, P51D, 4, BF109G6, 4),
    ]
    const mixed: OrderOfBattle = [
      u[0]!,
      { team: 'blue', members: [B17G, B17G], entry: HEAD_ON.blue, lane: 1, tier: 1 },
      ...u.slice(1),
    ]
    expect(sideSummary(mixed, 'blue')).toBe('4 × p51d + 2 × b17g')
  })
})
```

- [ ] **Step 2：跑測試確認它失敗**

```bash
npx vitest run test/unit/battle-order.test.ts
```

Expected：FAIL，`Failed to resolve import "../../src/battle/order"`。

- [ ] **Step 3：寫 `src/battle/order.ts`**

```ts
import { SCHWARM_SIZE } from './flights'
import type { EntryPlan, SideEntry } from './entry'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/World'

/**
 * 一個小隊的編成。**外層是小隊、內層是那個小隊的每一架。**
 *
 * 【為什麼是二維而不是「一隊一個機種 + 架數」】專案負責人 2026-08-21：
 * 「設定檔應該是一個陣列決定什麼機種、初始方位、初始姿態、小隊等等，而不是
 * 加開欄位，不然未來越多類型會更新不完。」加第三種機體時，前者只要多一列，
 * 後者要多兩個欄位（機種 + 架數）而且每加一種再多兩個。
 *
 * 【它是 `entry.ts` 那一步的後半】2026-08-16 已經把「擺位、面向、初始狀態」
 * 搬成資料表，但機種與架數留在 `BattleConfig` 上沒跟過去。這裡補完。
 */
export interface FlightPlan {
  readonly team: Team
  /**
   * 這一小隊的每一架，`[0]` 是長機。**1 … `SCHWARM_SIZE` 架。**
   *
   * 【為什麼是機種陣列而不是「機種 + 架數」】混編小隊（一架轟炸機配三架
   * 護航）在後者表達不出來。
   */
  readonly members: readonly AircraftSpec[]
  /**
   * 擺位、面向、初始姿態、速度。**沿用 `entry.ts` 的既有型別。**
   *
   * 同一隊的幾個小隊通常共用同一個物件參考 —— 那是刻意的，改一處就是改整隊。
   */
  readonly entry: SideEntry
  /**
   * 橫向槽位，**以 `BattleConfig.schwarmSpacing` 為單位**。0 = 中央，可為小數。
   *
   * 【為什麼是序號不是公尺】`schwarmSpacing`、`lateralOffset`、`entryRange`、
   * `altitudeSpread` 是探針換場景用的旋鈕（`turn-shrink.probe.ts`、
   * `ai-command-decision.test.ts` 都在覆寫）。表裡存絕對座標的話那些覆寫會
   * **靜靜失效** —— 探針照跑、數字照印，只是量的不是它宣稱的東西。
   */
  readonly lane: number
  /**
   * 高度層序號，餵給 `setup.ts` 的鋸齒 `altitudeOffset(tier, altitudeSpread)`
   * —— 它把序號映到 `[−1, 1]`、週期 5。理由同 `lane`。
   */
  readonly tier: number
  /**
   * 玩家開這一小隊的長機（`members[0]`）。
   *
   * **整張表恰好一筆為 true，而且必須在藍隊**（`assertOrderOfBattle`）。
   *
   * 【為什麼是選擇性欄位而不是 `boolean`】`exactOptionalPropertyTypes` 開著，
   * 所以「沒有這個鍵」與「`false`」在型別上是兩件事。手寫的關卡表少寫一個
   * `player: false` 不該是錯誤。
   */
  readonly player?: true
}

export type OrderOfBattle = readonly FlightPlan[]

/**
 * 產出「兩隊各自一種機、橫隊排開」的編組表。**這是 M5 以來的既有排列。**
 *
 * 【它存在的唯一理由】既有的一百多處呼叫端寫的是
 * `{ ...DEFAULT_BATTLE, blueSpec: P51D, blueCount: 20, … }`，全部是既有護欄
 * 的基準。這支讓它們變成一行替換，而且**產出的座標與改動前逐位元相同**：
 *
 * ```
 *   lane = f − (小隊數 − 1) / 2      ← 改動前 leadX 括號裡那個中間值
 *   tier = f                          ← 改動前餵給 altitudeOffset 的那個 f
 *   player 落在藍隊第 floor(藍隊小隊數 / 2) 隊的長機
 *                                     ← 改動前的 playerSlot 同一條式子
 * ```
 *
 * 【藍隊全部排在紅隊之前】`world.add` 的順序決定 combatant 索引，而索引決定
 * AI 決策相位、名字指派、砲塔的點放錯開。順序不對那三件事會全部換位置，
 * 而且不會有任何錯誤。
 */
export function lineAbreast(
  plan: EntryPlan,
  blueSpec: AircraftSpec, blueCount: number,
  redSpec: AircraftSpec, redCount: number,
): OrderOfBattle {
  const out: FlightPlan[] = []
  const playerFlight = Math.floor(Math.ceil(blueCount / SCHWARM_SIZE) / 2)
  for (const team of ['blue', 'red'] as const) {
    const blueSide = team === 'blue'
    const count = blueSide ? blueCount : redCount
    const spec = blueSide ? blueSpec : redSpec
    const entry = blueSide ? plan.blue : plan.red
    const flights = Math.ceil(count / SCHWARM_SIZE)
    for (let f = 0; f < flights; f++) {
      const size = Math.min(SCHWARM_SIZE, count - f * SCHWARM_SIZE)
      const members: AircraftSpec[] = []
      for (let k = 0; k < size; k++) members.push(spec)
      const lane = f - (flights - 1) / 2
      // 【兩個字面值而不是 `player: 條件 ? true : undefined`】
      // `exactOptionalPropertyTypes` 不接受把 `undefined` 指派給 `player?: true`
      out.push(blueSide && f === playerFlight
        ? { team, members, entry, lane, tier: f, player: true }
        : { team, members, entry, lane, tier: f })
    }
  }
  return out
}

/**
 * 守住 `createBattle` 的四個前提。**一次全檢，不散在迴圈裡。**
 *
 * 【為什麼要在生成之前擋】半條路生出來的世界比當場拋錯難查得多：兩筆
 * `player` 的症狀是「玩家的控制器同時裝在兩個座位上，其中一個永遠收不到
 * 輸入」（`resetBattle` 的註解記過同一個症狀），而畫面上只是有一架飛機
 * 呆呆地平飛。
 */
export function assertOrderOfBattle(units: OrderOfBattle): void {
  if (units.length === 0) throw new Error('編組表是空的')

  let players = 0
  let seenRed = false
  for (const u of units) {
    const n = u.members.length
    if (n < 1 || n > SCHWARM_SIZE) {
      throw new Error(`小隊的架數必須是 1 … ${SCHWARM_SIZE}，收到 ${n}`)
    }
    if (u.team === 'red') seenRed = true
    else if (seenRed) throw new Error('編組表的順序錯了：藍隊的小隊必須全部排在紅隊之前')
    if (u.player === true) {
      players++
      if (u.team !== 'blue') throw new Error('玩家必須在藍隊')
    }
  }
  if (players !== 1) throw new Error(`編組表必須恰好有一筆 player，收到 ${players}`)
  if (!units.some((u) => u.team === 'blue')) throw new Error('編組表裡沒有藍隊')
  if (!seenRed) throw new Error('編組表裡沒有紅隊')
}

/**
 * 一隊的機種摘要，例如 `20 × p51d` 或 `4 × p51d + 4 × b17g`。
 * 只給 `main.ts` 的除錯行用 —— **不是熱路徑**。
 */
export function sideSummary(units: OrderOfBattle, team: Team): string {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const u of units) {
    if (u.team !== team) continue
    for (const m of u.members) {
      if (!counts.has(m.id)) order.push(m.id)
      counts.set(m.id, (counts.get(m.id) ?? 0) + 1)
    }
  }
  return order.map((id) => `${counts.get(id)!} × ${id}`).join(' + ')
}
```

- [ ] **Step 4：跑測試確認全綠**

```bash
npx tsc --noEmit
npx vitest run test/unit/battle-order.test.ts
```

Expected：全部 passed。若 `assertOrderOfBattle` 的反例測試因為 TS 型別而寫不
出來（`readonly player?: true` 讓 `player: false` 編不過），**改測試的建構方式，
不要改型別** —— 用 `as OrderOfBattle` 從物件字面值組。

- [ ] **Step 5：Commit**

```bash
git add src/battle/order.ts test/unit/battle-order.test.ts
git commit -m "feat: battle/order.ts —— 編組表的型別與 lineAbreast

外層是小隊、內層是那個小隊的每一架。lineAbreast 產出 M5 以來的既有橫隊排列，
lane / tier / player 三條式子逐字照抄改動前的 leadX、altitudeOffset 與
playerSlot —— 它存在的唯一理由是讓既有的一百多處呼叫端變成一行替換。

lane 與 tier 是序號不是公尺：schwarmSpacing / lateralOffset / entryRange /
altitudeSpread 是探針換場景用的旋鈕，表裡存絕對座標會讓那些覆寫靜靜失效。

這一步不接線，既有行為一個字不變。"
```

---

## Task 3：`createFlights` 吃小隊大小

**Files:**
- Modify: `src/battle/flights.ts`（`createFlights`，約 76–106 行）
- Modify: `test/unit/battle-flights.test.ts`（**只新增，不改既有的 22 條**）

**Interfaces:**
- Produces：`createFlights(all, pinned = -1, sizes?: readonly number[]): FlightIndex`

- [ ] **Step 1：寫失敗的測試**

在 `test/unit/battle-flights.test.ts` 檔案最後新增：

```ts
/**
 * 【為什麼要讓呼叫端指定分組】改動前 `createFlights` **自己**照連續索引每
 * `SCHWARM_SIZE` 個切一隊，而 `createBattle` 生成時**又獨立算了一次**。今天
 * 兩者碰巧一致（都是連續每 4 個）。
 *
 * 編組表一旦允許「6 架轟炸機切成 4 + 2 但排在 4 架戰鬥機後面」或「3 機小隊」，
 * 兩邊就會切出不同的分組 —— **症狀是編隊飛行的僚機認錯長機，而且不會有任何
 * 錯誤**。所以分組只能有一份，由編組表給。
 */
describe('createFlights 吃指定的小隊大小', () => {
  /**
   * 【`roster(n)` 是 n 藍 + n 紅，總共 2n 架 —— Codex 2026-08-21 抓到】
   * 第一版的測試資料把它當成「總共 n 架」，於是每一條都先撞上「總和不符」
   * 而提早拋錯，跨隊那一條**永遠到不了它要測的分支**。
   *
   * 這裡另外造一個不對稱的 roster，因為要測的正是「藍 6 紅 4 這種切法」。
   */
  const sides = (blueN: number, redN: number): FlightMember[] => {
    const all: FlightMember[] = []
    for (let i = 0; i < blueN; i++) all.push({ index: all.length, team: 'blue', alive: true })
    for (let i = 0; i < redN; i++) all.push({ index: all.length, team: 'red', alive: true })
    return all
  }

  it('照給的大小切，不是每四個切', () => {
    // 藍 6（切 4 + 2）＋ 紅 4 —— 正是下一輪「戰鬥機 4 架 + 轟炸機 6 架」的形狀
    const fi = createFlights(sides(6, 4), -1, [4, 2, 4])
    expect(fi.flights.map((f) => f.roster)).toEqual([[0, 1, 2, 3], [4, 5], [6, 7, 8, 9]])
    expect(fi.flights.map((f) => f.team)).toEqual(['blue', 'blue', 'red'])
  })

  it('三機小隊', () => {
    // roster(3) = 3 藍 + 3 紅 = 6 架
    const fi = createFlights(roster(3), -1, [3, 3])
    expect(fi.flights.map((f) => f.roster.length)).toEqual([3, 3])
  })

  it('總和與人數不符 → 拋', () => {
    // roster(4) = 8 架，而 4 + 3 = 7
    expect(() => createFlights(roster(4), -1, [4, 3])).toThrow(/總和/)
  })

  it('小隊大小超出 1…SCHWARM_SIZE → 拋', () => {
    expect(() => createFlights(roster(4), -1, [5, 3])).toThrow(/1 … 4/)
    expect(() => createFlights(roster(4), -1, [0, 8])).toThrow(/1 … 4/)
  })

  it('一個小隊跨兩隊 → 拋', () => {
    // roster(4) = 前 4 藍、後 4 紅；[3, 2, 3] 總和是 8（先過總和那一關），
    // 而第二隊 [3, 4] 橫跨隊界 —— 這一條要測的正是這個分支
    expect(() => createFlights(roster(4), -1, [3, 2, 3])).toThrow(/同一隊/)
  })

  it('省略時與改動前相同', () => {
    const all = roster(5)
    expect(createFlights(all).flights.map((f) => f.roster))
      .toEqual(createFlights(all, -1, undefined).flights.map((f) => f.roster))
  })
})
```

`FlightMember` 已經在該檔的 import 清單裡（第 5 行），`sides` 用得到它。

- [ ] **Step 2：跑測試確認它失敗**

```bash
npx vitest run test/unit/battle-flights.test.ts
```

Expected：新增的六條 FAIL（多傳一個參數目前被忽略，分組還是每四個切），
既有 22 條仍然 PASS。

- [ ] **Step 3：改 `createFlights`**

把 `src/battle/flights.ts` 的 `createFlights` 換成：

```ts
/**
 * 依隊伍把成員切成 Schwarm。架數不是 `SCHWARM_SIZE` 的倍數時，最後一個
 * 分隊比較小 —— 那不需要特例，壓縮與站位查詢都只看 `count`。
 *
 * @param sizes 每個小隊的架數，**依 `all` 的索引順序**。總和必須等於
 *   `all.length`，每一段必須同隊，每一段必須是 1 … `SCHWARM_SIZE` 架。
 *
 *   【省略時退回每 SCHWARM_SIZE 個切一隊】那是「全員都是標準四機小隊」的
 *   意思。**正式路徑（`createBattle`）一律明寫** —— 分組被算兩次正是這個
 *   參數要消滅的東西（見 `test/unit/battle-flights.test.ts` 那一節的註解）。
 */
export function createFlights(
  all: readonly FlightMember[], pinned = -1, sizes?: readonly number[],
): FlightIndex {
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.index !== i) {
      throw new Error(`FlightMember.index 必須等於陣列位置：第 ${i} 個是 ${all[i]!.index}`)
    }
  }

  const flights: Flight[] = []
  if (sizes === undefined) {
    for (const team of ['blue', 'red'] as const) {
      const ids: number[] = []
      for (let i = 0; i < all.length; i++) if (all[i]!.team === team) ids.push(i)
      for (let s = 0; s < ids.length; s += SCHWARM_SIZE) {
        const roster = ids.slice(s, s + SCHWARM_SIZE)
        flights.push({
          team, roster, members: new Int32Array(roster.length).fill(-1), count: 0,
        })
      }
    }
  } else {
    // 【總和先檢查完再切】切到一半才發現不夠，會留下一個半成品的 FlightIndex
    let sum = 0
    for (const n of sizes) {
      if (!Number.isInteger(n) || n < 1 || n > SCHWARM_SIZE) {
        throw new Error(`小隊的架數必須是 1 … ${SCHWARM_SIZE} 的整數，收到 ${n}`)
      }
      sum += n
    }
    if (sum !== all.length) {
      throw new Error(`小隊架數的總和 ${sum} 與成員數 ${all.length} 不符`)
    }
    let at = 0
    for (const n of sizes) {
      const roster: number[] = []
      for (let k = 0; k < n; k++, at++) roster.push(at)
      const team = all[roster[0]!]!.team
      for (const id of roster) {
        if (all[id]!.team !== team) {
          throw new Error(`一個小隊必須同一隊：${roster.join(',')} 橫跨了藍紅`)
        }
      }
      flights.push({ team, roster, members: new Int32Array(n).fill(-1), count: 0 })
    }
  }

  const fi: FlightIndex = {
    flights,
    flightOf: new Int32Array(all.length).fill(-1),
    positionOf: new Int32Array(all.length).fill(-1),
    pinned,
  }
  compactFlights(fi, all)
  return fi
}
```

- [ ] **Step 4：跑測試確認全綠**

```bash
npx tsc --noEmit
npx vitest run test/unit/battle-flights.test.ts test/unit/takeover.test.ts
```

Expected：全部 passed（既有 22 條 + 新增 6 條）。

- [ ] **Step 5：Commit**

```bash
git add src/battle/flights.ts test/unit/battle-flights.test.ts
git commit -m "refactor: createFlights 改成可以吃指定的小隊大小

順手收掉一個既有缺陷：分組被算了兩次 —— createFlights 自己照連續索引每 4 個
切一隊，createBattle 生成時又獨立算了一次。今天兩者碰巧一致。

編組表一旦允許非四機小隊（6 架轟炸機排在 4 架戰鬥機後面、或三機小隊），兩邊
就會切出不同的分組，而症狀是編隊飛行的僚機認錯長機、不會有任何錯誤。

sizes 省略時行為與改動前逐字相同 —— 既有 22 條測試一個字都沒改就是證明。"
```

---

## Task 4：新生成路徑上線（`units?` 相容欄位）

**這一步一個呼叫端都不用改。** 五個舊欄位原地保留，`BattleConfig` 多一個
**選擇性**的 `units`，`createBattle` 走新迴圈；`cfg.units` 沒給時就地用
`lineAbreast` 由舊欄位組一張出來。

【為什麼要有這個中間步驟 —— Codex 2026-08-21】第一版把「換迴圈」與「全部
呼叫端搬家」寫成一個原子改動，理由是「五個欄位一刪就全部編不過」。那個理由
只在**刪欄位**時成立，而刪欄位可以晚一步。拆開之後多一個很有價值的關卡：
**基準測試在這裡就會走新迴圈**，所以逐位元紅了必定是新迴圈的錯，不可能是
某一支測試的呼叫端打錯字。第一版沒有這個關卡，兩種錯會混在一起。

**Files:**
- Modify: `src/battle/setup.ts`

**Interfaces:**
- Consumes：Task 2 的 `lineAbreast` / `assertOrderOfBattle`、
  Task 3 的 `createFlights(all, pinned, sizes)`。
- Produces：`BattleConfig.units?: OrderOfBattle`（**選擇性**，五個舊欄位仍在）。

- [ ] **Step 1：`BattleConfig` 加選擇性欄位**

在 `src/battle/setup.ts` 的 `BattleConfig` 裡，`entry: EntryPlan` 那一項**後面**
新增（五個舊欄位一個都先不要刪）：

```ts
  /**
   * 這一場的編制。**外層是小隊、內層是那個小隊的每一架。**
   *
   * 【這一步是選擇性的，下一個 Task 才變成唯一的來源】沒給時由
   * `blueSpec` / `redSpec` / `blueCount` / `redCount` / `entry` 就地組一張出來
   * —— 那五個欄位在下一個 Task 會刪掉。見 `battle/order.ts`。
   */
  units?: OrderOfBattle
```

`DEFAULT_BATTLE` **這一步不動**（不放 `units`，走 fallback）。

import 加上：

```ts
import { assertOrderOfBattle, lineAbreast, type OrderOfBattle } from './order'
```

- [ ] **Step 2：`createBattle` 換迴圈**

把 `src/battle/setup.ts` 裡從 `const blueFlights = ...` 到雙層 `for` 結束
（現行約 308–397 行）整段換成：

```ts
  /**
   * 【fallback 只活到下一個 Task】沒給 `units` 就由五個舊欄位組一張 ——
   * 那五個欄位下一步就會刪掉，這一行也跟著刪。它存在的唯一理由是讓
   * 「換迴圈」與「呼叫端搬家」變成兩個各自能編譯、各自能驗收的步驟。
   */
  const units = cfg.units ?? lineAbreast(
    cfg.entry, cfg.blueSpec, cfg.blueCount, cfg.redSpec, cfg.redCount)
  assertOrderOfBattle(units)

  const world = new World()
  const blue: Combatant[] = []
  const red: Combatant[] = []
  let player: Combatant | null = null
  /**
   * 每個小隊的架數，依 `world.add` 的順序。**交給 `createFlights`** ——
   * 分組只能有一份，不能讓它自己再猜一次（見 `flights.ts` 的 `sizes`）。
   */
  const sizes: number[] = []
  /**
   * base spec → 套過手感係數的 spec。**每陣營一張表。**
   *
   * 【為什麼要記憶】改動前 `applyFeel` 一側算一次，所以同一側的 20 架共用
   * 同一個物件。逐小隊算的話同隊會變成好幾個物件 —— 數值完全相同
   * （`applyFeel` 是純函數），但下游有三個**依物件識別**的快取會失效。
   *
   * 【為什麼是每陣營一張而不是全場一張 —— Codex 2026-08-21】全場一張會讓
   * 鏡像對戰（兩隊同機種）由兩個 spec 物件變成一份，而依物件識別的快取有
   * 三個，不只 `ceilings`：
   *
   * ```
   *   setup.ts       Map<AircraftSpec, number>        serviceCeiling
   *   envelope.ts    WeakMap<AircraftSpec, Float64Array>  最佳迴旋表
   *   doctrine.ts    WeakMap<AircraftSpec, Float64Array>  持續迴旋率表
   * ```
   *
   * 後兩者都在 **AI 更新路徑**上，而 `doctrine.ts` 的註解明寫「一次填滿、
   * 不惰性逐格填」是因為逐格填會讓 AI 步的 p999 由 217 µs 惡化到 3.8 ms。
   * 共用會少填一張表 —— 數值仍然相同，但那是一個**沒有必要冒的**啟動成本
   * 與 perf gate 的變動。
   *
   * 每陣營一張則與改動前**完全一致**：同隊同機種共用一份、兩隊各自一份。
   * 這一輪因此沒有任何一處對改動前不等價。
   */
  const feeled = { blue: new Map<AircraftSpec, AircraftSpec>(),
    red: new Map<AircraftSpec, AircraftSpec>() }

  for (const unit of units) {
    const entry = unit.entry
    // 【`along`／`across` 是係數、`gap` 是絕對公尺】理由見 `SideEntry`：
    // 探針靠覆寫 `entryRange`／`lateralOffset` 換場景，寫死絕對座標會讓
    // 那些覆寫靜靜失效
    const z = entry.along * cfg.entryRange + entry.gap
    const orientation = new Quaternion().setFromAxisAngle(UP, entry.heading)
    const velocity = FWD.clone().applyQuaternion(orientation)
      .multiplyScalar(cfg.tas * entry.speed)
    // 【乘法的順序要與改動前逐字相同】改動前是
    // `(f − (n−1)/2) × schwarmSpacing + across × lateralOffset`，
    // 而 `lane` 就是那個括號裡的中間值。浮點加法不可交換，順序不能換。
    const leadX = unit.lane * cfg.schwarmSpacing + entry.across * cfg.lateralOffset
    const leadY = cfg.altitude + entry.climb + altitudeOffset(unit.tier, cfg.altitudeSpread)

    /** 這個分隊已經造好的飛機，供 stationPoint 當參考機 */
    const made: Aircraft[] = []
    for (let k = 0; k < unit.members.length; k++) {
      const base = unit.members[k]!
      // 【手感係數在這裡套，不在 spec 檔裡】史實值必須原封不動，否則
      // `test/performance/historical.test.ts` 的整層斷言就失去意義（見
      // `specs/feel.ts`）。這裡是「史實的飛機」變成「玩起來的飛機」的唯一入口，
      // 而且**雙方一起套** —— 玩家與 AI 飛的是同一台。
      //
      // 【為什麼是 feelFor 而不是 GAME_FEEL】轟炸機另有一組（見
      // `specs/feel.ts` 的 `BOMBER_FEEL`）。寫死 `GAME_FEEL` 會把轟炸機當
      // 戰鬥機放大，爬升率變成史實的三倍。
      const cache = feeled[unit.team]
      let spec = cache.get(base)
      if (spec === undefined) {
        spec = applyFeel(base, feelFor(base))
        cache.set(base, spec)
      }

      // 【分隊內部直接由 stationPoint 生成】出生位置就是站位。兩份長得
      // 很像的幾何就是只有一份會被修好的那種危險 —— 與 `resetBattle`
      // 走 `World.respawn` 是同一個理由。
      //
      // 鏡射是自動的：`stationPoint` 由**參考機的速度方向**建座標框，
      // 而紅隊朝 +Z，所以 `across = +200` 在世界座標是 −X。
      const ref = STATION_REFERENCE[k]!
      if (ref < 0) SPAWN.set(leadX, leadY, z)
      else stationPoint(made[ref]!, STATION_OFFSETS[k]!, 0, SPAWN)

      const aircraft = new Aircraft(spec, SPAWN.y, cfg.tas)
      aircraft.state.position.copy(SPAWN)
      aircraft.state.orientation.copy(orientation)
      aircraft.state.velocity.copy(velocity)
      aircraft.prevPosition.copy(aircraft.state.position)
      aircraft.prevOrientation.copy(orientation)
      made.push(aircraft)

      const isPlayer = unit.player === true && k === 0
      const controller = isPlayer ? playerController : new AiController()
      const c = world.add(
        aircraft, controller, unit.team, aircraft.state.position.clone(), SPAWN.y, cfg.tas,
      )
      // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
      c.respawnOnDestroy = false
      if (isPlayer) player = c
      ;(unit.team === 'blue' ? blue : red).push(c)
    }
    sizes.push(unit.members.length)
  }

  if (player === null) throw new Error('玩家沒有被建立——編組表必須有一筆 player')
```

再把下面那一行：

```ts
  const flights = createFlights(world.combatants, player.index)
```

改成：

```ts
  const flights = createFlights(world.combatants, player.index, sizes)
```

**其餘所有東西一個字都不動**（`board`、`ceilings`、AI 接線、`pilotNames`、
`commandUnits`）。它們掃的是 `world.combatants`，與生成方式無關。

`playerSlot` 這個區域變數與它的註解一起刪掉（判準搬進 `lineAbreast` 了）。

**清掉變成未使用的 import（`noUnusedLocals` 開著 —— Codex 2026-08-21 指出）**：

| 名稱 | 為什麼變成未使用 |
| --- | --- |
| `SCHWARM_SIZE`（`./flights`） | 舊迴圈的 `blueFlights` / `playerSlot` / `flightCount` / 內層 `k < SCHWARM_SIZE` 是它僅有的四處用途，全部刪掉了 |
| `SideEntry`（`./entry`） | 舊迴圈的 `const entry: SideEntry = …` 是它唯一的用途 |

**`EntryPlan` 這一步要留著** —— `BattleConfig.entry` 還在，fallback 也用得到。
它在下一個 Task 才變成未使用。

`import type { AircraftSpec }` 若尚未存在要補上。

- [ ] **Step 3：型別過**

```bash
npx tsc --noEmit
```

Expected：0 errors，**而且一個呼叫端都沒有改**。有錯多半是上面那張表漏清了
某個 import。

- [ ] **Step 4：主判準 —— 逐位元不變**

```bash
npx vitest run test/integration/order-of-battle-replay.test.ts
```

Expected：4 passed。

**這是整輪最重要的一關**：測試的 config 仍然是舊寫法，但 `createBattle` 走的
已經是新迴圈。所以紅了**必定**是新迴圈的問題，與呼叫端無關。

**紅了怎麼辦**（照順序查，不要跳）：

| 症狀 | 多半是哪裡 |
| --- | --- |
| 出生表的**行數**不同 | 編組表產出的架數不對 —— 查 `lineAbreast` 的 `size` |
| 出生表**順序**不同（同樣的座標排在不同行） | 藍紅順序或小隊順序 —— 查 `lineAbreast` 的兩層迴圈 |
| 某一架的 **x** 不同 | `leadX` 的乘法順序，或 `lane` 算錯 |
| 某一架的 **y** 不同 | `tier` 沒有等於改動前的 `f` |
| **小隊** 那幾行不同 | `sizes` 沒傳進 `createFlights`，或順序錯 |
| 出生表全對、**重播校驗和**不同 | 生成之後的東西被動到了 —— 查 AI 接線、`ceilings`、`pilotNames` 那幾段有沒有被誤改 |

- [ ] **Step 5：副判準 —— 既有護欄的數字不准動**

```bash
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"
npx vitest run test/integration/rematch.test.ts
npx vitest run test/unit/perf-gate.test.ts
```

Expected：紅的仍然只有既有那三條（`ai-command-channel` ×2、
`ai-withdraw-anchor` ×1），**數量不准增加**。

**任何一條新紅的都不准靠放寬門檻解決** —— 先量、先報告、先問。

- [ ] **Step 6：Commit**

```bash
git add src/battle/setup.ts
git commit -m "refactor: createBattle 換成掃編組表，舊欄位暫時保留

BattleConfig 多一個選擇性的 units；沒給時由五個舊欄位就地用 lineAbreast 組
一張出來。所以這一步一個呼叫端都不用改，而基準測試已經在走新迴圈 ——
逐位元紅了必定是新迴圈的錯，不會與呼叫端的打字錯混在一起。

applyFeel 改成每陣營一張 base→feeled 表，與改動前完全一致（同隊同機種共用
一份、兩隊各自一份）。全場一張會讓鏡像對戰由兩個 spec 物件變成一份，而依
AircraftSpec 物件識別的快取有三個，其中兩個在 AI 更新路徑上。

createFlights 改吃編組表給的小隊大小，分組不再被算兩次。"
```

---

## Task 5：全部呼叫端搬家，刪掉五個舊欄位

**Files:**
- Modify: `src/battle/setup.ts`（刪五個舊欄位與 fallback、`DEFAULT_BATTLE`）
- Modify: `src/battle/skirmish.ts`（`battleConfigFrom`）
- Modify: `src/battle/missions.ts`（`missionConfigFrom`）
- Modify: `src/main.ts`（除錯行）
- Modify: 19 支測試／探針（清單見 Step 3）

**Interfaces:**
- Produces：`BattleConfig.units: OrderOfBattle`（**必填**，五個舊欄位消失）。

- [ ] **Step 1：兩個組態入口**

`src/battle/skirmish.ts` 的 `battleConfigFrom` 回傳值改成：

```ts
  return {
    ...DEFAULT_BATTLE,
    // 【夾制留在這裡】來源是 DOM 的字串，`Number('')` 是 NaN 而
    // `Math.min/max` 對 NaN 是傳染的。見 `clampSide`
    units: lineAbreast(
      HEAD_ON, blueSpec, clampSide(setup.blueCount), theirs[0]!, clampSide(setup.redCount)),
    // 【難度只在這條路上生效】`DEFAULT_BATTLE` 留 `ACE`，因為那是全部 AI
    // 測試量天花板用的基準。這裡是「史實的 AI」變成「打得動的 AI」的唯一
    // 入口，與 `specs/feel.ts` 在 `setup.ts` 的位置對稱。
    aiProfile: VETERAN,
  }
```

import 加 `lineAbreast`（`./order`）與 `HEAD_ON`（`./entry`）。

`src/battle/missions.ts` 的 `missionConfigFrom` 回傳值改成：

```ts
  return {
    ...DEFAULT_BATTLE,
    units: lineAbreast(
      ENTRY_PLANS[card.entry], mine[0]!, card.blueCount, theirs[0]!, card.redCount),
    aiProfile: VETERAN,
    rules: missionRules(card, DEFAULT_BATTLE.altitude),
  }
```

（`entry:` 那一行連同它的註解刪掉 —— 擺法現在是 `lineAbreast` 的第一個參數。）

- [ ] **Step 2：`main.ts` 的除錯行**

把 `src/main.ts:500-501` 那兩行換成：

```ts
    + `　藍 ${sideSummary(battle.cfg.units, 'blue')}`
    + `　紅 ${sideSummary(battle.cfg.units, 'red')}`
```

import 加 `sideSummary`（`./battle/order`）。

- [ ] **Step 3：19 支測試／探針的機械式替換**

先讓編譯器把清單列出來：

```bash
npx tsc --noEmit 2>&1 | grep -o "^[^(]*" | sort -u
```

**替換的規則**：每一處 `{ ...DEFAULT_BATTLE, … }` 都把四個值**解析成明確的
數字與機種**再寫進 `lineAbreast`。沒有覆寫的欄位要**填 `DEFAULT_BATTLE` 的
值**：`blueSpec = P51D`、`redSpec = BF109G6`、`blueCount = 20`、
`redCount = 20`、`entry = HEAD_ON`。

```ts
// 改動前
{ ...DEFAULT_BATTLE, blueSpec: P51D, redSpec: B17G, blueCount: 8, redCount: 8, entry: PURSUIT }
// 改動後
{ ...DEFAULT_BATTLE, units: lineAbreast(PURSUIT, P51D, 8, B17G, 8) }

// 改動前（只覆寫一個欄位 —— 其餘要從 DEFAULT_BATTLE 補齊）
{ ...DEFAULT_BATTLE, blueCount: 4 }
// 改動後
{ ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 4, BF109G6, 20) }
```

要動的檔案：

```
  src/  （Step 1–4 已含）
  test/unit/skirmish.test.ts                    test/unit/battle-setup.test.ts
  test/unit/missions.test.ts                    test/unit/battle-mission-wiring.test.ts
  test/unit/turret-lifecycle.test.ts
  test/integration/multi-battle.test.ts         test/integration/mission-evacuate.test.ts
  test/integration/rematch.test.ts              test/integration/turret-replay.test.ts
  test/integration/turrets.test.ts              test/integration/ai-command-decision.test.ts
  test/tools/evacuate.probe.ts                  test/tools/turn-shrink.probe.ts
  test/tools/extend-why.probe.ts                test/tools/projectile-peak.probe.ts
  test/tools/target-churn.probe.ts              test/tools/turret-balance.probe.ts
  test/tools/spawn-baseline.probe.ts            test/e2e/turret-visuals.e2e.ts
  bench/turret-load.ts
```

**三處要特別小心**：

1. `test/unit/skirmish.test.ts`（16 處）斷言的是 `battleConfigFrom` 的產物。
   斷言 `cfg.blueSpec === X` 這種要改成讀編組表，例如
   `expect(cfg.units.find((u) => u.team === 'blue')!.members[0]).toBe(X)`。
   **斷言的意思不准變** —— 它守的是「選軸心國時紅隊真的變成 P-51」。
2. `test/unit/battle-setup.test.ts`（14 處）量的是生成幾何本身。它裡面有
   「高度散布在 ±altitudeSpread 之內」這類讀 `DEFAULT_BATTLE.altitudeSpread`
   的斷言 —— **那些欄位沒有被刪，不用動**。
3. `test/unit/missions.test.ts` 有一條「架數落在 1~MAX_SIDE 的整數」，讀的是
   `MissionCard.blueCount` / `redCount`（**卡片上的欄位，不是 `BattleConfig`
   的**）。那張卡的欄位這一輪不動，這條測試不用改。

**歷史文件刻意排除（Codex 2026-08-21 提醒）**：`docs/superpowers/` 底下的
舊 spec 與 plan（`2026-08-04-m10-main-menu.md`、`2026-08-16-mission-framework.md`、
`2026-08-20-bomber-turrets.md` 等五份）裡有含舊 `BattleConfig` 的 TypeScript
程式碼區塊。**不要改它們** —— 那是當時的紀錄，改寫等於竄改歷史。它們不在
`tsconfig.json` 的 `include` 裡，不會被編譯。

- [ ] **Step 4：刪掉五個舊欄位與 fallback**

`src/battle/setup.ts`：

1. `BattleConfig` 刪掉 `blueCount` / `redCount` / `blueSpec` / `redSpec` /
   `entry`（連同它們的註解），把 `units?: OrderOfBattle` 改成 `units: OrderOfBattle`
   並補上這段註解：

```ts
  /**
   * 這一場的編制。**外層是小隊、內層是那個小隊的每一架。**
   *
   * 【為什麼取代了 blueSpec / redSpec / blueCount / redCount / entry】專案
   * 負責人 2026-08-21：「設定檔應該是一個陣列決定什麼機種、初始方位、初始
   * 姿態、小隊等等，而不是加開欄位，不然未來越多類型會更新不完。」加第三種
   * 機體時前者只要多一列。見 `battle/order.ts`。
   *
   * 【既有場景怎麼寫】`lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)` ——
   * 產出的座標與改動前逐位元相同。
   */
  units: OrderOfBattle
```

2. `DEFAULT_BATTLE` 的那五行換成一行：

```ts
  // 【對頭 20v20 是預設】全部既有護欄都建立在它上面
  units: lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20),
```

3. `createBattle` 開頭的 fallback 兩行換成：

```ts
  assertOrderOfBattle(cfg.units)
```

並把迴圈的 `for (const unit of units)` 改回 `for (const unit of cfg.units)`。

4. **`EntryPlan` 現在也變成未使用了**，把 `./entry` 的 import 改成只留 `HEAD_ON`：

```ts
import { HEAD_ON } from './entry'
```

- [ ] **Step 5：型別過**

```bash
npx tsc --noEmit
```

Expected：0 errors。**還有錯就是 Step 3 漏了檔案，回去補，不要用 `any` 繞過。**

- [ ] **Step 6：主判準**

```bash
npx vitest run test/integration/order-of-battle-replay.test.ts
```

Expected：4 passed。

**這一關紅了與 Task 4 那一關紅了意思完全不同**：Task 4 已經證明新迴圈是對的，
所以這裡紅只可能是**某一處呼叫端的四個值填錯**（多半是「只覆寫一個欄位、
忘了從 `DEFAULT_BATTLE` 補齊其餘三個」）。出生表會直接指出是哪一架。

- [ ] **Step 7：副判準 —— 既有護欄的數字不准動**

```bash
npx vitest run --exclude "**/perf-gate.test.ts" --exclude "**/rematch.test.ts"
npx vitest run test/integration/rematch.test.ts
npx vitest run test/unit/perf-gate.test.ts
```

Expected：紅的仍然只有既有那三條（`ai-command-channel` ×2、
`ai-withdraw-anchor` ×1），**數量不准增加**。

**任何一條新紅的都不准靠放寬門檻解決** —— 先量、先報告、先問。

- [ ] **Step 8：人工驗收**

```bash
npm run dev     # 埠 5178
```

開遭遇戰跑一場，確認：兩隊橫隊排開、玩家在藍隊正中央、除錯行印的是
`藍 20 × p51d　紅 20 × bf109g6`。**這一輪沒有新的視覺，「看起來一樣」就是通過。**

- [ ] **Step 9：Commit**

```bash
git add src/battle/setup.ts src/battle/skirmish.ts src/battle/missions.ts src/main.ts \
        test/unit/skirmish.test.ts test/unit/battle-setup.test.ts \
        test/unit/missions.test.ts test/unit/battle-mission-wiring.test.ts \
        test/unit/turret-lifecycle.test.ts test/integration/ test/tools/ test/e2e/ \
        bench/turret-load.ts
git commit -m "refactor: 全部呼叫端改用編組表，刪掉五個舊欄位

blueCount / redCount / blueSpec / redSpec / entry 正式消失，units 變成必填。
Task 4 的 fallback 一併刪掉。

19 支測試與探針是機械式替換：每一處都把四個值解析成明確的數字與機種再寫進
lineAbreast，沒有覆寫的欄位填 DEFAULT_BATTLE 的值（P51D / BF109G6 / 20 / 20
/ HEAD_ON）。座標一個位元都沒動 —— 由 order-of-battle-replay 的出生表逐字
比對與 SHA-256 重播校驗和證明。

docs/superpowers/ 底下的歷史 spec 與 plan 刻意不改，它們內含當時的 API。"
```

**注意**：上面的 `git add` 用了目錄（`test/integration/` 等）。先跑
`git status --short` 確認那些目錄底下沒有不相干的檔案（例如 `test-results/`），
有的話改成逐檔列出。**不准 `git add -A`。**

---

## Task 6：收尾 —— backlog、spec 回填、清掉暫時的東西

**Files:**
- Modify: `docs/backlog.md`
- Modify: `docs/superpowers/specs/2026-08-21-order-of-battle-design.md`

- [ ] **Step 1：backlog 記下混編的名字限制**

在 `docs/backlog.md` 的第二節（既有缺陷）最後新增：

```markdown
### 2.24 混編一隊時，飛行員名字全部跟第一架的機種走

**出處**：編組表那一輪（2026-08-21）的 spec §7.1，**已知且刻意不修**。

`battle/setup.ts` 的

```ts
const blueNames = pilotNames(seed, factionOf(blue[0]!.aircraft.spec.id), blue.length)
```

取**該隊第一架**的機種來決定名字用哪一國。編組表讓一隊裡可以有兩種機體之後，
若那兩種分屬不同陣營，整隊的名字會全部跟第一架走。

**現在踩不到**：護送／攔截兩張卡的混編都是同陣營（P-51 + B-17 都是同盟國、
Bf109 + He 111 都是軸心國）。

**要修的時候**：把 `factionOf` 改成逐架查，`pilotNames` 改成回傳一個「依陣營
分開的名字池」再逐架取。成本是 `pilotNames` 的簽名要動，而它有自己的護欄
（`test/unit/pilots.test.ts`）。
```

- [ ] **Step 2：spec 回填實測**

在 `docs/superpowers/specs/2026-08-21-order-of-battle-design.md` 的 §8 之後
新增一節，把實際跑出來的東西寫進去：

```markdown
## 8.5 實測結果（2026-08-21 回填）

| 項目 | 結果 |
| --- | --- |
| 出生表逐字比對 | HEADON_20V20 51 行、PURSUIT_MIRROR_8V8 21 行，全部相同 |
| 30 秒重播校驗和 | 兩個場景都相同（實際值見 `test/fixtures/spawn-baseline.ts`） |
| 機械式替換的檔案數 | （填實際數字） |
| 全套回歸 | （填 passed 數）passed，紅的仍是既有三條 |
```

（**行數與 passed 數要填實際跑出來的**，不要照抄這裡的範例數字。）

- [ ] **Step 3：確認沒有留下暫時檔案**

```bash
git status --short
```

Expected：只有 `bash.exe.stackdump`（長期被修改的既有檔案）與
`test-results/`（未追蹤）。**沒有 `_tmp-*` 之類的東西。**

- [ ] **Step 4：Commit**

```bash
git add docs/backlog.md docs/superpowers/specs/2026-08-21-order-of-battle-design.md
git commit -m "docs: 編組表回填 —— backlog §2.24 與 spec §8.5

§2.24：混編一隊時飛行員名字全部跟第一架的機種走。已知、刻意不修 ——
護送／攔截兩張卡的混編都是同陣營，現在踩不到。"
```

---

## 自我檢查（寫計畫的人已經跑過）

**1. Spec 覆蓋**

| Spec 章節 | 由哪個 Task 實作 |
| --- | --- |
| §1 五個欄位換成 `units` | Task 4 Step 1（加選擇性欄位）+ Task 5 Step 4（刪舊欄位） |
| §1.2 不做 `duty` / 不動 `STATION_OFFSETS` | 全計畫沒有任何一步碰它們 |
| §3 `FlightPlan` 型別 | Task 2 Step 3 |
| §3.1 `lane` / `tier` 是序號 | Task 2 Step 3（型別註解）+ Task 2 Step 1（測試） |
| §3.2 `EntryPlan` 留著 | Task 2 Step 3（`lineAbreast` 的第一個參數） |
| §4 `lineAbreast` | Task 2 |
| §4.1 逐位元等價 | Task 1（基準）+ Task 4 Step 7（驗收） |
| §4.2 `applyFeel` 每陣營一張表 | Task 4 Step 2 + Task 1 的鏡像場景 |
| §5 `createFlights` 吃邊界 | Task 3 |
| §6 新迴圈 | Task 4 Step 2 |
| §6.1 四條斷言 | Task 2 Step 3（`assertOrderOfBattle`）+ Task 2 Step 1（八條反例） |
| §7 不受影響的東西 | Task 4 Step 2 明寫「其餘一個字不動」 |
| §7.1 名字的限制 | Task 6 Step 1 |
| §8.1 主判準 | Task 1 + Task 4 Step 4 + Task 5 Step 6 |
| §8.2 副判準 | Task 4 Step 5 + Task 5 Step 7 |
| §8.3 新增的單元測試 | Task 2 Step 1 + Task 3 Step 1 |
| §8.4 人工驗收 | Task 5 Step 8 |
| §9 檔案清單 | 與本計畫的「檔案結構」逐項對應 |
| §10 風險 | Task 4 Step 4 的排查表逐條對應 |
| §11 沒有新的起始值 | 全計畫沒有任何一步引入新常數 |

**2. 佔位符掃描**：沒有 TBD／TODO；每一個程式步驟都有可直接貼的完整程式碼；
唯一「要照實際情況填」的地方（Task 6 Step 2 的實測數字）都明寫了「怎麼查出正確的值」而不是留空。

**3. 型別一致性**：`lineAbreast` / `assertOrderOfBattle` / `sideSummary` /
`createFlights(all, pinned, sizes)` / `FlightPlan.player?: true` /
`BattleConfig.units` 這六個簽名在 Task 2、3、4 與測試碼裡逐字相同。
