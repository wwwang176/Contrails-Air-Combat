# 德 M2「波爾塔瓦之夜」實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `germany-m2` 做成「He 111 夜襲波爾塔瓦機場、炸毀停放的 B-17」，沒有敵機、壓力來自輕型防空砲與探照燈，照明彈是光源；同一輪把每個陣營砍成三關。

**Architecture:** 整關是既有機制的組合：地面目標（盟 M2）＋陸上砲位會還手（lenua-build）＋任務專用地形（洛伊納那條路）＋節拍（波次那條路）。新東西只有四樣：三種地面單位、輕型砲掛到 `flakLight` 上、一個照明彈池（世界層 SoA、渲染層固定四盞點光源）、探照燈光束。全部先在 node 測試裡驗，畫面最後用有頭瀏覽器拍。

**Tech Stack:** TypeScript、three.js、vitest、Playwright（vite-node 有頭）、Blender 5.x（MCP）。

**Spec:** `docs/superpowers/specs/2026-09-10-germany-m2-poltava-design.md`

## Global Constraints

- 動工前 `npx tsc --noEmit 2>&1 | grep -c "error TS"` 量一次當基準（2026-09-10 是 **24**），每個 task 結束比對，**不得增加**；數字不要寫死在任何地方。
- 註解只寫現況與理由，不寫沿革、討論、裁決出處；全部繁體中文。
- 改檔案用編輯工具，不寫腳本做字串取代。
- 熱路徑（`World.step`、`stepBeats`、渲染迴圈）**不配置記憶體**：沒有 `new`、沒有閉包、沒有字串拼接。
- 護欄先驗紅（或變異測試）才算數；護欄的門檻值是負責人定的（見 spec §6、§16）。
- 只跑碰到的測試檔（`npx vitest run test/unit/<檔>`），整層留到最後一個 task。
- 提交訊息 trailer 只留 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`；不 `git add -A`。
- Codex 審查：`codex exec -s danger-full-access`，prompt 走 stdin、背景執行，提示詞要寫「**不要改任何檔案**」。
- 世界座標：X 橫向、Y 上、**−Z 是機首方向／北**；`heading` 0 = 朝 −Z，繞 Y。
- 起始值（座數、血量、秒數、高度）全部是負責人接受的起點，**試飛定值時只改數字不改結構**。

---

### Task 1: 每陣營砍成三關

**Files:**
- Modify: `src/battle/missions.ts`（刪 `allies-m3`、`germany-m3`、`japan-m2` 三張卡）
- Modify: `test/unit/campaigns.test.ts:7-46, 92-100`
- Modify: `test/unit/briefing.test.ts:128-131`
- Modify: `test/unit/missions.test.ts:24, 224`（註解裡的「12 關」）

**Interfaces:**
- Produces: `MISSIONS[c].length === 3`；`ALL.length === 9`；目錄卡（`battle: null`）剩 `germany-m2` 一張。

- [ ] **Step 1: 確認沒有別的地方引用那三個 id**

Run: `grep -rn "allies-m3\|germany-m3\|japan-m2" src test docs/superpowers/plans --include=*.ts`
Expected: 只有 `src/battle/missions.ts` 的三張卡本身。有別的命中就先看那一處，不要動手刪。

- [ ] **Step 2: 改護欄（先驗紅）**

`test/unit/campaigns.test.ts`：

```ts
describe('三條戰役', () => {
  it('三條線各 3 關', () => {
    expect(CAMPAIGNS).toEqual(['allies', 'germany', 'japan'])
    for (const c of CAMPAIGNS) expect(MISSIONS[c], c).toHaveLength(3)
  })

  it('9 個 id 唯一，而且前綴就是戰役', () => {
    expect(new Set(ALL.map((m) => m.id)).size).toBe(9)
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) expect(m.id.startsWith(`${c}-`), m.id).toBe(true)
    }
  })

  it('全部標題不重複，而且每一張都有一行說明', () => {
    expect(new Set(ALL.map((m) => m.title)).size).toBe(9)
    for (const m of ALL) expect(m.summary.length, m.id).toBeGreaterThan(0)
  })

  it('八張打得起來，一張是目錄卡', () => {
    const playable = ALL.filter(ready)
    expect(playable.map((m) => m.id).sort()).toEqual([
      'allies-m1', 'allies-m2', 'allies-m4', 'germany-m1', 'germany-m4',
      'japan-m1', 'japan-m3', 'japan-m4',
    ])
    expect(ALL.length - playable.length).toBe(1)
  })
})
```

檔頭註解「# 三條戰役與 12 張卡」改成「# 三條戰役與 9 張卡」。

`describe('目錄卡')` 那一組：

```ts
describe('目錄卡', () => {
  it('沒做的那一張仍然有完整的目錄資料', () => {
    const locked = ALL.filter((m) => !ready(m))
    expect(locked).toHaveLength(1)
    for (const m of locked) {
      expect(m.title.length, m.id).toBeGreaterThan(0)
      expect(m.summary.length, m.id).toBeGreaterThan(0)
    }
  })
```

`test/unit/briefing.test.ts`：

```ts
  it('九張卡的空域各不相同 —— 每一關取材自不同的地方', () => {
    const all = Object.values(MISSIONS).flat()
    expect(new Set(all.map((c) => c.place)).size).toBe(9)
  })
```

`test/unit/missions.test.ts` 第 24、224 行的註解：「12 關」→「9 關」；不改斷言。

- [ ] **Step 3: 跑，確認紅**

Run: `npx vitest run test/unit/campaigns.test.ts test/unit/briefing.test.ts`
Expected: FAIL —— `toHaveLength(3)` 收到 4、`size` 是 12、目錄卡 4 張。

- [ ] **Step 4: 刪三張卡**

`src/battle/missions.ts`：刪掉 `allies-m3 諾曼第斷軌`、`germany-m3 奧博揚公路`、`japan-m2 讀谷灘頭` 三個物件字面值（各約 6 行，`battle: null`）。`germany-m2 庫班的鐵路` 這一輪先留著，Task 4 換內容（那時可玩清單變成 9 張、目錄卡 0 張，Task 4 再改一次計數）。

「五關都出現」這句在四個地方：`src/battle/setup.ts:112`、`src/battle/missions.ts:266`、`src/world/shipGuns.ts:228,335`、`src/render/geometry/ground/index.ts:118,127`、`test/unit/ground-flak.test.ts:263`。全部改成現況「盟 M2、德 M2、日 M4」。

`MISSIONS` 上方那一段註解若有列「盟 M2 M3、德 M2 M3」之類的清單（`flakSpec` 的註解在 `setup.ts:112` 與 `missions.ts:266` 都有「五關」），改成現況：「盟 M2、德 M2、日 M4」。

- [ ] **Step 5: 跑，確認綠**

Run: `npx vitest run test/unit/campaigns.test.ts test/unit/briefing.test.ts test/unit/missions.test.ts`
Expected: PASS

- [ ] **Step 6: tsc 比對、提交**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 與基準相同。

```bash
git add src/battle/missions.ts test/unit/campaigns.test.ts test/unit/briefing.test.ts test/unit/missions.test.ts src/battle/setup.ts src/world/shipGuns.ts src/render/geometry/ground/index.ts test/unit/ground-flak.test.ts
git commit -m "chore(missions): 每個陣營砍成三關 —— 拿掉盟 M3、德 M3、日 M2 三張目錄卡"
```

---

### Task 2: 零敵機

**Files:**
- Modify: `src/battle/order.ts:405-440`（`assertOrderOfBattle`）
- Modify: `src/battle/setup.ts:947, 1880`（`pilotNames`）
- Modify: `test/unit/campaigns.test.ts:78-86`（架數）
- Modify: `test/unit/battle-order.test.ts:133-135`（「一隊都沒有 → 拋」）
- Modify: `src/ui/briefing.ts:65`（`redCount` 0 不列敵軍那一列）、`test/e2e/mission.e2e.ts:144,153`
- Test: `test/unit/battle-zero-red.test.ts`（新）、`test/unit/briefing.test.ts`（加一條）

**Interfaces:**
- Produces: `createBattle` 接受只有藍隊的編組表；`redCount: 0` 的卡合法。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/battle-zero-red.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { assertOrderOfBattle, lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { Controller } from '../../src/control/Controller'

/**
 * # 零敵機 —— 一場只有藍隊的仗
 *
 * 德 M2 的對手是地面：史實上沒有空中攔截。編組表因此可以沒有紅隊；
 * 「沒有紅隊」是資料寫錯的那一條規則不再成立。
 */
const IDLE: Controller = { update() {} }
const DT = 1 / 240

function blueOnly(): BattleConfig {
  const units = lineAbreast(HEAD_ON, B17G, 4, P51D, 0)
  return {
    ...DEFAULT_BATTLE, units,
    rules: { kind: 'destroy', count: 1 },
    ground: [{ unit: 'truck', team: 'red', x: 0, z: -6000, heading: 0 }],
  }
}

describe('零敵機', () => {
  it('編組表可以只有藍隊', () => {
    expect(() => assertOrderOfBattle(lineAbreast(HEAD_ON, B17G, 4, P51D, 0))).not.toThrow()
  })

  it('建得起來、跑兩秒仍在打、紅方存活恆 0 而不判勝', () => {
    const b = createBattle(IDLE, blueOnly(), 7)
    expect(b.world.combatants.filter((c) => c.team === 'red')).toHaveLength(0)
    for (let i = 0; i < 2 * 240; i++) stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.mission.metric).toBe(1)
  })

  it('再打一場也不炸', () => {
    const b = createBattle(IDLE, blueOnly(), 7)
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(() => resetBattle(b)).not.toThrow()
  })
})
```

`test/unit/battle-order.test.ts:133` 的「一隊都沒有 → 拋」改成：

```ts
  it('只有藍隊 → 合法（對手全是地面的關）', () => {
    expect(() => assertOrderOfBattle(blue(ok))).not.toThrow()
  })
```

`test/unit/briefing.test.ts` 加一條：

```ts
  it('沒有敵機的卡，簡報不列敵軍那一列', () => {
    const card = { ...someReadyCard, battle: { ...someReadyCard.battle, redCount: 0 } } as ReadyMissionCard
    const b = briefingOf(card)
    expect(b.foe).toEqual([])
    expect(b.mine).toHaveLength(1)
  })
```

（`someReadyCard` 取檔裡已經在用的任一張可玩卡；`foe`／`mine` 的欄位名照 `Briefing` 型別。）

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/battle-zero-red.test.ts`
Expected: FAIL —— `編組表裡沒有紅隊`。

- [ ] **Step 3: 放開三處**

`src/battle/order.ts` `assertOrderOfBattle`：刪掉 `if (!seenRed) throw new Error('編組表裡沒有紅隊')`。`seenRed` 仍然要留 —— 「藍隊全部排在紅隊之前」那一條靠它。函數的檔頭註解加一句：

```ts
 * 【可以沒有紅隊】對手全是地面的關（德 M2）編組表只有藍隊。「藍隊必須排在
 * 紅隊之前」仍然守著 —— 那是 `compactFlights` 的前提。
```

`src/battle/setup.ts` 兩處（`createBattle` 與 `resetBattle` 附近的 `redNames`）：

```ts
  // 【紅隊可以是空的】德 M2 沒有敵機；`red[0]` 那時是 undefined
  const redNames = red.length === 0
    ? []
    : pilotNames(seed, red[0]!.aircraft.spec.faction, red.length)
```

（第二處把 `red` 換成 `b.red`。）

`src/ui/briefing.ts:65`：

```ts
  // 【沒有敵機就不列】零架的那一列是「一支根本沒起飛的敵軍」
  const foe: BriefingUnit[] = b.redCount === 0
    ? []
    : [{ name: shortName(b.redSpec), role: b.redSpec.role, count: b.redCount }]
```

`test/e2e/mission.e2e.ts:144` 的「編制少於兩列」改成「少於一列」；`:153` 的 `ready.length !== 5` 改成 `!== 9`（它現在已經跟 8 張對不上，是舊的）。

`test/unit/campaigns.test.ts`「架數都是正整數」：

```ts
  it('我方架數是正整數、敵方架數是非負整數', () => {
    for (const m of playable) {
      const b = m.battle
      expect(Number.isInteger(b.blueCount), `${m.id} blue`).toBe(true)
      expect(b.blueCount, `${m.id} blue`).toBeGreaterThan(0)
      expect(Number.isInteger(b.redCount), `${m.id} red`).toBe(true)
      // 【0 是合法的】對手全是地面的關沒有敵機
      expect(b.redCount, `${m.id} red`).toBeGreaterThanOrEqual(0)
    }
  })
```

- [ ] **Step 4: 跑，確認綠**

Run: `npx vitest run test/unit/battle-zero-red.test.ts test/unit/campaigns.test.ts test/unit/battle-order.test.ts test/unit/battle-convoy.test.ts test/unit/briefing.test.ts`
Expected: PASS。

- [ ] **Step 5: tsc、提交**

```bash
git add src/battle/order.ts src/battle/setup.ts src/ui/briefing.ts test/unit/campaigns.test.ts test/unit/battle-zero-red.test.ts test/unit/battle-order.test.ts test/unit/briefing.test.ts test/e2e/mission.e2e.ts
git commit -m "feat(battle): 編組表可以沒有紅隊 —— 對手全是地面的關沒有敵機"
```

---

### Task 3: 地形 `poltava` 與機場的佈局常數

**Files:**
- Create: `src/world/poltava.ts`
- Modify: `src/world/leuna.ts:500-520`（`makeRand`＋`drawLobes` 合成 `export function drawHillLobes(seed)`）
- Modify: `src/world/terrainKind.ts:18`
- Modify: `src/render/fields.ts:591-640, 1017, 1096`（`SiteLayout.padHex`）
- Modify: `src/render/terrain.ts:115, 234-262`
- Modify: `src/tools/blast.ts:378`、`src/tools/daylight.ts:337`
- Test: `test/unit/poltava.test.ts`（新）、`test/unit/fields.test.ts`（加一條）

**Interfaces:**
- Produces（`src/world/poltava.ts`）：
  - `FIELD_CENTER: Vector3`（0, 0, −7000）、`FIELD_PAD = { halfX: 900, halfZ: 600 }`
  - `worldToField(x, z, out)`（純平移，沒有旋轉）
  - `RUNWAY`、`APRON`：`{ x0, z0, x1, z1 }` 機場局部座標
  - `PARKED_ROWS: readonly { x, z, heading }[]`（世界座標，24 筆）
  - `DUMPS: readonly { kind: 'fuelDump' | 'bombDump', x, z, heading }[]`（世界座標，3 筆）
  - `LIGHT_FLAK_SITES`、`HEAVY_FLAK_SITES`、`SEARCHLIGHT_SITES: readonly { x, z, heading }[]`（世界座標，16／6／6 筆）
  - `FLARE_DROPS: readonly { x, z }[]`（世界座標，6 筆）
  - `POLTAVA_HILLS`、`ROADS`、`ROAD_WIDTH`、`RAILS`、`RAIL_WIDTH`、`PAD_GRASS = 0x55663f`
  - `createPoltava(): { field: HeightFieldData; hills: IslandDesc[] }`
- Produces（`src/render/fields.ts`）：`SiteLayout.padHex?: number`，省略 = 混凝土。
- Produces（`src/render/terrain.ts`）：`POLTAVA_SITE: SiteLayout`；`createTerrain('poltava')`。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/poltava.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  APRON, createPoltava, DUMPS, FIELD_CENTER, FIELD_PAD, FLARE_DROPS, HEAVY_FLAK_SITES,
  LIGHT_FLAK_SITES, PARKED_ROWS, POLTAVA_HILLS, RUNWAY, SEARCHLIGHT_SITES, worldToField,
} from '../../src/world/poltava'
import { PAD_CLEARANCE } from '../../src/world/leuna'
import { FARM_CELL, HILL_GAP, HILL_LIMIT } from '../../src/world/farmland'

const L = { x: 0, z: 0 }
function inRect(x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }): boolean {
  worldToField(x, z, L)
  return L.x >= r.x0 && L.x <= r.x1 && L.z >= r.z0 && L.z <= r.z1
}
function padDistance(cx: number, cz: number): number {
  worldToField(cx, cz, L)
  const dx = Math.max(0, Math.abs(L.x) - FIELD_PAD.halfX)
  const dz = Math.max(0, Math.abs(L.z) - FIELD_PAD.halfZ)
  return Math.hypot(dx, dz)
}
const PAD = { x0: -FIELD_PAD.halfX, z0: -FIELD_PAD.halfZ, x1: FIELD_PAD.halfX, z1: FIELD_PAD.halfZ }

describe('poltava 地形', () => {
  const { field, hills } = createPoltava()

  it('每一顆丘陵的膨脹圓離墊面至少 PAD_CLEARANCE', () => {
    for (const h of hills) {
      expect(padDistance(h.cx, h.cz) - h.outerRadius, `${h.cx},${h.cz}`)
        .toBeGreaterThanOrEqual(PAD_CLEARANCE)
    }
  })

  it('墊面加一格圍裙內每一格都是 0', () => {
    const apron = FARM_CELL
    for (let x = FIELD_CENTER.x - FIELD_PAD.halfX - apron; x <= FIELD_CENTER.x + FIELD_PAD.halfX + apron; x += FARM_CELL / 2) {
      for (let z = FIELD_CENTER.z - FIELD_PAD.halfZ - apron; z <= FIELD_CENTER.z + FIELD_PAD.halfZ + apron; z += FARM_CELL / 2) {
        expect(field.sample(x, z), `${x},${z}`).toBe(0)
      }
    }
  })

  it('丘陵都在 HILL_LIMIT 之內、最近的一對至少 HILL_GAP、峰不超過 40', () => {
    expect(hills).toHaveLength(POLTAVA_HILLS.length)
    for (const h of hills) {
      expect(Math.hypot(h.cx, h.cz) + h.outerRadius).toBeLessThanOrEqual(HILL_LIMIT)
      expect(h.peak).toBeLessThanOrEqual(40)
    }
    for (let i = 0; i < hills.length; i++) {
      for (let j = i + 1; j < hills.length; j++) {
        const a = hills[i]!
        const b = hills[j]!
        expect(Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius).toBeGreaterThanOrEqual(HILL_GAP)
      }
    }
  })
})

describe('poltava 的佈局', () => {
  it('跑道與停機坪都在墊面內，而且不重疊', () => {
    for (const r of [RUNWAY, APRON]) {
      expect(r.x0).toBeGreaterThanOrEqual(PAD.x0)
      expect(r.x1).toBeLessThanOrEqual(PAD.x1)
      expect(r.z0).toBeGreaterThanOrEqual(PAD.z0)
      expect(r.z1).toBeLessThanOrEqual(PAD.z1)
    }
    const apart = RUNWAY.x1 <= APRON.x0 || APRON.x1 <= RUNWAY.x0
      || RUNWAY.z1 <= APRON.z0 || APRON.z1 <= RUNWAY.z0
    expect(apart).toBe(true)
  })

  it('24 架 B-17 全在停機坪內、翼尖距至少 34 m、排距至少 50 m', () => {
    expect(PARKED_ROWS).toHaveLength(24)
    for (const p of PARKED_ROWS) expect(inRect(p.x, p.z, APRON), `${p.x},${p.z}`).toBe(true)
    for (let i = 0; i < PARKED_ROWS.length; i++) {
      for (let j = i + 1; j < PARKED_ROWS.length; j++) {
        const a = PARKED_ROWS[i]!
        const b = PARKED_ROWS[j]!
        const dx = Math.abs(a.x - b.x)
        const dz = Math.abs(a.z - b.z)
        // 同一排：橫向翼尖距；不同排：縱向排距
        expect(dz < 1 ? dx >= 34 : dz >= 50, `${i},${j}`).toBe(true)
      }
    }
  })

  it('三堆都在墊面內、不在跑道與停機坪上', () => {
    expect(DUMPS.map((d) => d.kind).sort()).toEqual(['bombDump', 'fuelDump', 'fuelDump'])
    for (const d of DUMPS) {
      expect(inRect(d.x, d.z, PAD)).toBe(true)
      expect(inRect(d.x, d.z, RUNWAY)).toBe(false)
      expect(inRect(d.x, d.z, APRON)).toBe(false)
    }
  })

  it('砲位與探照燈都不在跑道與停機坪上，重高砲在墊面外', () => {
    expect(LIGHT_FLAK_SITES).toHaveLength(16)
    expect(HEAVY_FLAK_SITES).toHaveLength(6)
    expect(SEARCHLIGHT_SITES).toHaveLength(6)
    for (const s of [...LIGHT_FLAK_SITES, ...HEAVY_FLAK_SITES, ...SEARCHLIGHT_SITES]) {
      expect(inRect(s.x, s.z, RUNWAY), `${s.x},${s.z}`).toBe(false)
      expect(inRect(s.x, s.z, APRON), `${s.x},${s.z}`).toBe(false)
    }
    for (const s of HEAVY_FLAK_SITES) expect(padDistance(s.x, s.z)).toBeGreaterThan(500)
  })

  it('照明彈沿跑道排開', () => {
    expect(FLARE_DROPS).toHaveLength(6)
    for (const p of FLARE_DROPS) expect(inRect(p.x, p.z, RUNWAY)).toBe(true)
  })
})
```

`test/unit/fields.test.ts` 加一條（放在檔尾）：

```ts
describe('墊面的顏色', () => {
  it('padHex 省略時是混凝土，給了就用那一色，取樣與 GLSL 一致', () => {
    const site = {
      pad: { x0: -100, z0: -100, x1: 100, z1: 100 }, roads: [], roadWidth: 8, padHex: 0x55663f,
    }
    const c = new Color()
    siteSurfaceColor(0, 0, c, 'summer', site)
    // 取樣把髒污與壓暗乘進去，只比色相：綠比紅高就是草不是混凝土
    expect(c.g).toBeGreaterThan(c.r)
    // `rgb()` 走 `Color.setHex`，sRGB 轉成線性再印四位小數
    expect(fieldGlslWithSite('summer', site)).toContain('vec3(0.0908, 0.1329, 0.0497)')
    const bare = { ...site, padHex: undefined }
    siteSurfaceColor(0, 0, c, 'summer', bare)
    expect(Math.abs(c.g - c.r)).toBeLessThan(0.03)
  })
})
```

（`Color`、`siteSurfaceColor`、`fieldGlslWithSite` 的 import 補上。）

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/poltava.test.ts test/unit/fields.test.ts`
Expected: FAIL —— 找不到 `../../src/world/poltava`；`padHex` 沒有作用。

- [ ] **Step 3: `SiteLayout.padHex`**

`src/render/fields.ts` `SiteLayout` 加：

```ts
  /**
   * 墊面的顏色。**省略 = 混凝土**（廠區）。機場的墊面是草地，只有跑道與
   * 停機坪是鋼板 —— 那兩塊走 `patches`。
   */
  readonly padHex?: number
```

`siteGlsl`（第 1017 行附近）：`vec3 siteCol = ${rgb(CONCRETE)} * …` → `${rgb(site.padHex ?? CONCRETE)}`。
`siteSurfaceColor`（第 1096 行附近）：`let hex = CONCRETE` → `let hex = site.padHex ?? CONCRETE`。

- [ ] **Step 4: `src/world/poltava.ts`**

```ts
import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'

/**
 * # 波爾塔瓦：德 M2 專用的地形
 *
 * 烏克蘭中部的草原：幾乎全平，遠處幾顆極緩的丘。機場是一片草地墊面，
 * 跑道與停機坪鋪穿孔鋼板（著色器的鋪面矩形），停放的 B-17 排在東端的
 * 停機坪上。**整張圖的佈局都在這個檔案**，卡片與佈景引用這裡的常數。
 *
 * 【跑道東西向、不轉】藍隊從南邊（+Z）來、橫切跑道。機場局部座標就是世界
 * 座標減去 `FIELD_CENTER` —— 沒有旋轉，`SiteLayout` 也不給 `heading`。
 */

/** 機場中心。藍隊開局 z ≈ +5,000 朝 −Z，進場 12 km */
export const FIELD_CENTER = /* @__PURE__ */ new Vector3(0, 0, -7000)

/** 機場局部 → 世界。表格常數用 */
function at(dx: number, dz: number): { x: number; z: number } {
  return { x: FIELD_CENTER.x + dx, z: FIELD_CENTER.z + dz }
}

/** 世界 → 機場局部。護欄與佈景的測試讀它 */
export function worldToField(x: number, z: number, out: { x: number; z: number }): void {
  out.x = x - FIELD_CENTER.x
  out.z = z - FIELD_CENTER.z
}

/** 墊面：1.8 × 1.2 km 的草地，內部高度保證 0 */
export const FIELD_PAD = { halfX: 900, halfZ: 600 } as const
/** 墊面外一圈不長樹；機場周邊本來就是空曠的草原 */
export const FIELD_TREE_CLEAR = 300

/** 草地墊面的顏色。跑道與停機坪另外鋪鋼板色 */
export const PAD_GRASS = 0x55663f
/** 穿孔鋼板的顏色：深灰帶一點鏽 */
export const PSP_STEEL = 0x4a4a46

/** 跑道：東西向 1,500 × 60 m，機場局部座標 */
export const RUNWAY = { x0: -750, z0: -30, x1: 750, z1: 30 } as const
/** 停機坪：機場東端、跑道南側，400 × 300 m */
export const APRON = { x0: 350, z0: 60, x1: 850, z1: 360 } as const

/**
 * 停放的 B-17：3 排 × 8 架，翼尖距 36 m（翼展 31.6）、排距 100 m，機首朝南
 * （+Z，朝來襲方向）。全部在停機坪內 —— 史實就是翼尖對翼尖排整齊。
 */
export const PARKED_ROWS: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ (() => {
    const out: { x: number; z: number; heading: number }[] = []
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 8; k++) {
        out.push({ ...at(396 + k * 36, 110 + r * 100), heading: Math.PI })
      }
    }
    return out
  })()

/** 油桶堆兩塊在西北角、彈藥堆一塊在東南角。全部在墊面內、避開跑道與停機坪 */
export const DUMPS: readonly { kind: 'fuelDump' | 'bombDump'; x: number; z: number; heading: number }[] = [
  { kind: 'fuelDump', ...at(-700, -450), heading: 0 },
  { kind: 'fuelDump', ...at(-640, -450), heading: 0 },
  { kind: 'bombDump', ...at(700, 500), heading: 0 },
]

/**
 * 輕型防空砲 16 座：內圈 8 座手擺在墊面內（避開跑道與停機坪），外圈 8 座
 * 1,300 m 一圈。史實的蘇軍防空是多而輕。**座數由試飛裁定**
 */
export const LIGHT_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: -500, dz: -450 }, { dx: 0, dz: -480 }, { dx: 500, dz: -450 },
    { dx: -800, dz: -150 }, { dx: -800, dz: 200 }, { dx: 800, dz: -200 },
    { dx: -450, dz: 450 }, { dx: 150, dz: 480 },
    { dx: 1300, dz: 0 }, { dx: 919, dz: 919 }, { dx: 0, dz: 1300 }, { dx: -919, dz: 919 },
    { dx: -1300, dz: 0 }, { dx: -919, dz: -919 }, { dx: 0, dz: -1300 }, { dx: 919, dz: -919 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 重高砲 6 座，2 km 一圈 —— 投彈高度也不安全 */
export const HEAVY_FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: 2000, dz: 0 }, { dx: 1000, dz: 1732 }, { dx: -1000, dz: 1732 },
    { dx: -2000, dz: 0 }, { dx: -1000, dz: -1732 }, { dx: 1000, dz: -1732 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 探照燈 6 座，950 m 一圈，與內圈砲位錯開 */
export const SEARCHLIGHT_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: 950, dz: 0 }, { dx: 475, dz: 823 }, { dx: -475, dz: 823 },
    { dx: -950, dz: 0 }, { dx: -475, dz: -823 }, { dx: 475, dz: -823 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: 0 }))

/** 照明彈沿跑道從西到東六枚 */
export const FLARE_DROPS: readonly { x: number; z: number }[] =
  /* @__PURE__ */ [-625, -375, -125, 125, 375, 625].map((dx) => at(dx, 0))

/** 手擺的丘陵：極緩，全在 3 km 外。`outerRadius` 由生成器算 */
export const POLTAVA_HILLS = [
  { cx: -6000, cz: -9000, radius: 900, peak: 35, pa: 0.4, pb: 2.9, seed: 201 },
  // 【外緣要在 HILL_LIMIT（14,000）內】radius × WOBBLE_MAX（1.29）再加到中心距離
  { cx: 7000, cz: -10500, radius: 1000, peak: 40, pa: 1.7, pb: 4.1, seed: 202 },
  { cx: -8000, cz: -3000, radius: 800, peak: 30, pa: 3.3, pb: 0.8, seed: 203 },
  { cx: 6500, cz: -2500, radius: 900, peak: 35, pa: 2.2, pb: 5.0, seed: 204 },
] as const

/** 連外道路往北出圖；鐵路東西向橫過機場南邊 —— 波爾塔瓦是鐵路樞紐 */
export const ROAD_WIDTH = 10
export const ROADS: readonly (readonly { x: number; z: number }[])[] = [
  [at(-200, -600), { x: -200, z: -9000 }, { x: -200, z: -14500 }],
]
export const RAIL_WIDTH = 26
export const RAILS: readonly (readonly { x: number; z: number }[])[] = [
  [{ x: -14500, z: -5400 }, { x: 14500, z: -5400 }],
]

export function createPoltava(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of POLTAVA_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  bakeRelief(field, hills, 0)
  return { field, hills }
}
```

`drawHillLobes(seed)` 從 `leuna.ts` 來：把 `leuna.ts:500-520` 的 `makeRand` 與 `drawLobes` 合成一支 `export function drawHillLobes(seed: number): LobeDraw[]`（`drawLobes(makeRand(seed))`），`createLeuna` 改叫它，`poltava.ts` import 它 —— 兩張手擺丘陵的圖用同一支抽瓣，不留第三份。`PAD_CLEARANCE` 也從 `leuna.ts` import，不重新定值。

- [ ] **Step 5: `TerrainKind` 與 `createTerrain`**

`src/world/terrainKind.ts`：`export type TerrainKind = 'sea' | 'archipelago' | 'farmland' | 'leuna' | 'poltava'`，註解加「`poltava` 是德 M2 專用（`world/poltava.ts`）」。

`src/render/terrain.ts`：

```ts
import {
  APRON, createPoltava, FIELD_CENTER, FIELD_PAD, FIELD_TREE_CLEAR, PAD_GRASS,
  PSP_STEEL, RAIL_WIDTH as POLTAVA_RAIL_WIDTH, RAILS as POLTAVA_RAILS,
  ROAD_WIDTH as POLTAVA_ROAD_WIDTH, ROADS as POLTAVA_ROADS, RUNWAY,
} from '../world/poltava'

/** 波爾塔瓦機場的墊面（草）、跑道與停機坪（鋼板）、連外道路與鐵路 */
export const POLTAVA_SITE: SiteLayout = {
  pivot: { x: FIELD_CENTER.x, z: FIELD_CENTER.z },
  pad: { x0: -FIELD_PAD.halfX, z0: -FIELD_PAD.halfZ, x1: FIELD_PAD.halfX, z1: FIELD_PAD.halfZ },
  padHex: PAD_GRASS,
  treeClear: FIELD_TREE_CLEAR,
  roads: POLTAVA_ROADS,
  roadWidth: POLTAVA_ROAD_WIDTH,
  rails: POLTAVA_RAILS,
  railWidth: POLTAVA_RAIL_WIDTH,
  patches: [
    { ...RUNWAY, hex: PSP_STEEL },
    { ...APRON, hex: PSP_STEEL },
  ],
}

/** 波爾塔瓦：農地的算繪路徑、極緩的丘、夏季、機場的墊面。佈景 GLB 在 Task 9 接 */
function createPoltavaTerrain(): Terrain {
  return createInlandTerrain(createPoltava(), 'summer', POLTAVA_SITE)
}
```

`createTerrain`：`if (kind === 'poltava') return createPoltavaTerrain()`。

`src/tools/blast.ts:378` 與 `src/tools/daylight.ts:337` 的清單各加 `{ id: 'poltava', name: '波爾塔瓦' }`／`{ kind: 'poltava', name: '波爾塔瓦' }`（daylight 的 `DemoTerrain` 型別若是手寫聯集，跟著加）。

- [ ] **Step 6: 跑，確認綠**

Run: `npx vitest run test/unit/poltava.test.ts test/unit/fields.test.ts test/unit/leuna.test.ts`
Expected: PASS。第一次跑若「砲位在停機坪上」紅，是座標挑錯 —— 改座標，不改測試。

- [ ] **Step 7: tsc、提交**

```bash
git add src/world/poltava.ts src/world/terrainKind.ts src/render/fields.ts src/render/terrain.ts src/tools/blast.ts src/tools/daylight.ts test/unit/poltava.test.ts test/unit/fields.test.ts
git commit -m "feat(terrain): 波爾塔瓦機場的地形 —— 草地墊面、鋼板跑道與停機坪、佈局常數"
```

---

### Task 4: 三種地面單位 + 卡片（關卡打得起來）

**Files:**
- Create: `src/render/geometry/ground/parked.ts`
- Create: `src/render/geometry/ground/dump.ts`
- Modify: `src/render/geometry/ground/index.ts:27-31, 98-180`
- Modify: `src/world/groundTargets.ts:31-70`（`GROUND_HP`／`GROUND_ARMOUR`）
- Modify: `src/battle/missions.ts`（`germany-m2` 卡、`POLTAVA_GROUND`）
- Modify: `src/main.ts:636-660`（油桶堆的火）
- Test: `test/unit/ground-units.test.ts`、`test/unit/parked.test.ts`（新）、`test/unit/campaigns.test.ts`

**Interfaces:**
- Produces：`GroundUnitId` 多 `'parkedB17' | 'fuelDump' | 'bombDump' | 'searchlight'`；`bakeParkedAircraft(id: string): BufferGeometry`；`buildFuelDump()`、`buildBombDump()`、`buildSearchlight()`；`DUMP_SIZE`；`POLTAVA_GROUND: readonly GroundEntry[]`。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/parked.test.ts`：

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { bakeParkedAircraft, PARKED_TAIL_DOWN } from '../../src/render/geometry/ground/parked'
import { glbTemplate } from '../../src/render/geometry/glb'

/**
 * 停放的飛機是從機種的 GLB 樣板烘出來的一顆幾何：同一批頂點、換成頂點色、
 * 機尾下沉、最低點貼地。守的是「烘的是同一架」與「地面單位的約定」。
 */
describe('bakeParkedAircraft', () => {
  beforeAll(loadGlbTemplatesForNode)

  it('最低點在 y = 0、前後左右都置中、頂點色不是全白', () => {
    const g = bakeParkedAircraft('b17g')
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.y).toBeCloseTo(0, 6)
    expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(0.5)
    expect(Math.abs(bb.min.z + bb.max.z)).toBeLessThan(0.5)
    const col = g.getAttribute('color')
    expect(col.count).toBe(g.getAttribute('position').count)
    let dark = 0
    for (let i = 0; i < col.count; i++) if (col.getX(i) < 0.9) dark++
    expect(dark).toBeGreaterThan(0)
  })

  it('翼展與全長對得上 B-17G', () => {
    const g = bakeParkedAircraft('b17g')
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(31.6, 0)
    // 機尾下沉之後全長投影縮短 cos(10°)
    expect(bb.max.z - bb.min.z).toBeGreaterThan(22.66 * Math.cos(PARKED_TAIL_DOWN) - 1)
  })

  it('機首比機尾高 —— 尾輪機停著是抬頭的', () => {
    const g = bakeParkedAircraft('b17g')
    const pos = g.getAttribute('position')
    let noseBottom = Infinity
    let tailBottom = Infinity
    let noseCount = 0
    let tailCount = 0
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      if (z < -8) { noseBottom = Math.min(noseBottom, pos.getY(i)); noseCount++ }
      if (z > 8) { tailBottom = Math.min(tailBottom, pos.getY(i)); tailCount++ }
    }
    // 兩個取樣集合都要有東西，否則 Infinity 的比較是恆真的
    expect(noseCount).toBeGreaterThan(0)
    expect(tailCount).toBeGreaterThan(0)
    expect(noseBottom).toBeGreaterThan(tailBottom + 1)
  })

  it('不動樣板：烘兩次得到相同的頂點，而且是各自的幾何', () => {
    const a = bakeParkedAircraft('b17g')
    const b = bakeParkedAircraft('b17g')
    expect(a).not.toBe(b)
    expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array)
    a.getAttribute('position').setX(0, 999)
    expect(b.getAttribute('position').getX(0)).not.toBe(999)
  })

  it('沒載樣板就丟', () => {
    expect(glbTemplate('nope')).toBeUndefined()
    expect(() => bakeParkedAircraft('nope')).toThrow(/GLB/)
  })
})
```

`test/unit/ground-units.test.ts` 的 `beforeAll` 加 `await loadGlbTemplatesForNode()`（import 自 `../fixtures/glb`）—— `parkedB17` 的 `build` 要樣板。既有的「底面貼 0」「命中盒蓋住頂點」「左右對稱」那幾條掃 `GROUND_UNITS` 全表，四種新單位自動含進去。

`test/unit/campaigns.test.ts` 加一組（`createBattle`、`stepBattle` 從 `../../src/battle/setup` import）：

```ts
describe('德 M2 波爾塔瓦', () => {
  const card = MISSIONS.germany.find((m) => m.id === 'germany-m2') as ReadyMissionCard

  it('沒有敵機、8 架 He 111、夜間、波爾塔瓦地形、1,500 m', () => {
    const b = card.battle
    expect(b.redCount).toBe(0)
    expect(b.blueCount).toBe(8)
    expect(b.blueSpec.id).toBe('he111')
    expect(b.timeOfDay).toBe('night')
    expect(b.terrain).toBe('poltava')
    expect(b.altitude).toBe(1500)
  })

  it('24 架停放的 B-17、3 堆、16 輕砲、6 重砲、6 探照燈；炸毀 12 座', () => {
    const units = card.battle.ground!.map((e) => e.unit)
    const count = (id: string) => units.filter((u) => u === id).length
    expect(count('parkedB17')).toBe(24)
    expect(count('fuelDump')).toBe(2)
    expect(count('bombDump')).toBe(1)
    expect(count('flakLight')).toBe(16)
    expect(count('flakHeavy')).toBe(6)
    expect(count('searchlight')).toBe(6)
    expect(card.battle.ground!.every((e) => e.team === 'red')).toBe(true)
    expect(card.battle.destroyCount).toBe(12)
  })

  it('照這張卡建得起來、跑一秒不炸', () => {
    // 【走真正的路】missionConfigFrom → stackedEntry → ground，不是自己組的編組表
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    for (let i = 0; i < 240; i++) stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.world.groundTargets.filter((t) => t.guns.length > 0)).toHaveLength(22)
  })
})
```

同一檔的「三條戰役」那一組在這一步改成最終態（Task 1 的 8／1 是中間態）：

```ts
  it('九張全部打得起來', () => {
    expect(ALL.filter(ready).map((m) => m.id).sort()).toEqual([
      'allies-m1', 'allies-m2', 'allies-m4', 'germany-m1', 'germany-m2', 'germany-m4',
      'japan-m1', 'japan-m3', 'japan-m4',
    ])
  })
```

`describe('目錄卡')` 整組刪掉 —— 沒有目錄卡了。

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/parked.test.ts test/unit/campaigns.test.ts`
Expected: FAIL（模組不存在、卡片還是 null）。

- [ ] **Step 3: `parked.ts`**

```ts
import {
  BufferAttribute, BufferGeometry, Color, Matrix4, type Mesh, type MeshStandardMaterial, type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEG } from '../../../core/math'
import { glbTemplate } from '../glb'

/**
 * 停在地上的飛機：把機種的 GLB 樣板烘成**一顆**地面單位的幾何 —— 每一顆
 * mesh 套上自己的世界矩陣、材質色塗成頂點色、合併。產物與 `parseGroundGlb`
 * 同一種（不共用頂點、頂點色、一個 draw call），`render/groundTargets.ts`
 * 不必分辨。
 *
 * 【停放姿態】尾輪機停著時機尾下沉，然後整台抬到最低點貼 0、前後置中 ——
 * 地面單位的約定是底面在 y = 0、原點在腳印中心。GLB 沒有起落架，從投彈
 * 高度的夜空看下去是剪影。
 *
 * 【槳盤不烘】它是螺旋槳轉動時的殘影（`CircleGeometry`），停著的飛機只有
 * 槳葉。
 *
 * 【烘一次、每次回複本】`groundGeometry` 對每一台都叫一次 `build`，而
 * `createGroundModels` 會 dispose 程序化那幾台的幾何 —— 回共用的那一份的話
 * 第一台被 dispose 之後其餘 23 台就空了。快取烘好的、回 `clone()`。
 */
export const PARKED_TAIL_DOWN = 10 * DEG

const C = /* @__PURE__ */ new Color()
const M = /* @__PURE__ */ new Matrix4()
const baked = new Map<string, BufferGeometry>()

export function bakeParkedAircraft(id: string): BufferGeometry {
  const hit = baked.get(id)
  if (hit !== undefined) return hit.clone()
  const t = glbTemplate(id)
  if (t === undefined) throw new Error(`機種 ${id} 的 GLB 還沒載入 —— 少了 preloadAircraftModels()`)
  t.group.updateMatrixWorld(true)
  const parts: BufferGeometry[] = []
  t.group.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    if ((mesh.geometry as { type?: string }).type === 'CircleGeometry') return
    // 【不動樣板】`toNonIndexed` 對沒有索引的幾何原樣回傳自己 —— 之後的
    // 套矩陣、刪屬性、dispose 就會打在共用的樣板上
    const g = mesh.geometry.index !== null ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    for (const attr of Object.keys(g.attributes)) {
      if (attr !== 'position') g.deleteAttribute(attr)
    }
    C.copy((mesh.material as MeshStandardMaterial).color)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = C.r
      col[i * 3 + 1] = C.g
      col[i * 3 + 2] = C.b
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    parts.push(g)
  })
  if (parts.length === 0) throw new Error(`機種 ${id} 的樣板裡沒有任何網格`)
  const geo = mergeGeometries(parts)
  if (geo === null) throw new Error('停放飛機的幾何合併失敗 —— 屬性不一致')
  for (const p of parts) p.dispose()
  // 繞 X 正轉：+Z（機尾）往下
  geo.applyMatrix4(M.makeRotationX(PARKED_TAIL_DOWN))
  // 樣板的原點在重心（機尾比機首長），地面單位要的是腳印中心
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(0, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  baked.set(id, geo)
  return geo.clone()
}
```

（樣板載入時每顆 mesh 已經換成單一 `MeshStandardMaterial.color`，讀 `.color` 就對。）

- [ ] **Step 4: `dump.ts`**

```ts
import type { BufferGeometry } from 'three'
import { assemble, box, cyl, HUE } from './parts'

/**
 * 機場的三種目標：油桶堆、彈藥堆、探照燈座。程序化 —— 桶與彈是圓柱，
 * 探照燈座這一版是一個方塊（模型之後再換）。
 *
 * 尺寸在 `DUMP_SIZE`：腳印 × 高（m）。命中盒對著同一份數字。
 */
/**
 * 尺寸是**幾何算出來的**：桶 12 × 8 顆、間距 2.5、半徑 0.3 → x 半寬 13.75 + 0.3。
 * `ground-units.test.ts` 對 `real*` 的容差是 5%，登記的數字必須跟排列一致。
 */
const DRUM_R = 0.3
const DRUM_H = 0.9
const DRUM_GAP = 2.5
const DRUM_COLS = 12
const DRUM_ROWS = 8
const BOMB_R = 0.3
const BOMB_LEN = 1.6
const BOMB_GAP = 2.2
const BOMB_PER_ROW = 10
const BOMB_ROW_GAP = 4

export const DUMP_SIZE = {
  fuelDump: {
    x: (DRUM_COLS - 1) * DRUM_GAP + DRUM_R * 2,
    y: DRUM_H * 2,
    z: (DRUM_ROWS - 1) * DRUM_GAP + DRUM_R * 2,
  },
  bombDump: {
    x: (BOMB_PER_ROW - 1) * BOMB_GAP + BOMB_R * 2,
    y: 0.5 + BOMB_R,
    z: 2 * BOMB_ROW_GAP + BOMB_LEN,
  },
  searchlight: { x: 3, y: 2, z: 3 },
} as const

const DRUM = 0x3d4a3a
const DRUM_RUST = 0x6a4a34
const BOMB = 0x4b4f4a
const SLAB = 0x8a8578

/** 55 加侖油桶：直徑 0.6、高 0.9，12 × 8 一層、疊兩層，繞原點置中 */
export function buildFuelDump(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < DRUM_COLS; i++) {
      for (let j = 0; j < DRUM_ROWS; j++) {
        const x = (i - (DRUM_COLS - 1) / 2) * DRUM_GAP
        const z = (j - (DRUM_ROWS - 1) / 2) * DRUM_GAP
        const hex = ((i * 7 + j * 3 + layer) % 5 === 0) ? DRUM_RUST : DRUM
        parts.push(cyl(DRUM_R, DRUM_H, hex, { x, y: DRUM_H / 2 + layer * DRUM_H, z }, 8))
      }
    }
  }
  return assemble(parts)
}

/** 250 磅炸彈躺著排三列，每列十枚，下面墊枕木，繞原點置中 */
export function buildBombDump(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const span = (BOMB_PER_ROW - 1) * BOMB_GAP
  for (let row = 0; row < 3; row++) {
    const z = (row - 1) * BOMB_ROW_GAP
    parts.push(box(span, 0.2, 0.3, HUE.steelDark, { y: 0.1, z: z - 0.6 }))
    parts.push(box(span, 0.2, 0.3, HUE.steelDark, { y: 0.1, z: z + 0.6 }))
    for (let k = 0; k < BOMB_PER_ROW; k++) {
      const x = (k - (BOMB_PER_ROW - 1) / 2) * BOMB_GAP
      parts.push(cyl(BOMB_R, BOMB_LEN, BOMB, { x, y: 0.5, z, rx: 90 }, 8))
    }
  }
  return assemble(parts)
}

/** 探照燈座：先用方塊。光束在 `render/searchlights.ts`，不在幾何裡 */
export function buildSearchlight(): BufferGeometry {
  const s = DUMP_SIZE.searchlight
  return assemble([box(s.x, s.y, s.z, SLAB, { y: s.y / 2 })])
}
```

- [ ] **Step 5: 登記表與血量**

`src/render/geometry/ground/index.ts`：

```ts
import { buildBombDump, buildFuelDump, buildSearchlight, DUMP_SIZE } from './dump'
import { bakeParkedAircraft } from './parked'

export type GroundUnitId =
  | 'tank' | 'truck'
  | 'flakHeavy' | 'flakLight'
  | 'locomotive' | 'tender' | 'boxcar' | 'flatcar'
  | PlantKind
  | 'parkedB17' | 'fuelDump' | 'bombDump' | 'searchlight'
```

`GROUND_UNITS` 加四筆（放在火車之後）：

```ts
  {
    id: 'parkedB17',
    name: '停放的 B-17G',
    note: '停在停機坪上的轟炸機 — 德 M2',
    // 【高是停放的高，不是史實的 5.82】GLB 沒有起落架，機尾下沉 10° 之後
    // 量出來是 5.41；`ground-units.test.ts` 對 `real*` 的容差是 5%
    realLength: 22.4, realWidth: 31.62, realHeight: 5.41,
    // 【命中盒是手寫的】`boxOf` 在模組載入時就要幾何，而樣板那時還沒載。
    // 數字是烘好的幾何量的（x ±15.81、y 0…5.41、z ±11.22），四邊各留 0.1
    model: { build: () => bakeParkedAircraft('b17g') },
    hull: [groundBox([-15.9, 0.00, -11.3], [15.9, 5.5, 11.3])],
  },
  {
    id: 'fuelDump',
    name: '油桶堆',
    note: '露天堆放的航空汽油桶 — 德 M2',
    realLength: DUMP_SIZE.fuelDump.z, realWidth: DUMP_SIZE.fuelDump.x, realHeight: DUMP_SIZE.fuelDump.y,
    model: { build: buildFuelDump },
    hull: [boxOf(buildFuelDump)],
  },
  {
    id: 'bombDump',
    name: '彈藥堆',
    note: '露天堆放的炸彈 — 德 M2',
    realLength: DUMP_SIZE.bombDump.z, realWidth: DUMP_SIZE.bombDump.x, realHeight: DUMP_SIZE.bombDump.y,
    model: { build: buildBombDump },
    hull: [boxOf(buildBombDump)],
  },
  {
    id: 'searchlight',
    name: '探照燈',
    note: '防空探照燈 — 德 M2。光束由渲染層畫',
    realLength: DUMP_SIZE.searchlight.z, realWidth: DUMP_SIZE.searchlight.x, realHeight: DUMP_SIZE.searchlight.y,
    model: { build: buildSearchlight },
    hull: [boxOf(buildSearchlight)],
  },
```

`src/world/groundTargets.ts` 的 `GROUND_HP`／`GROUND_ARMOUR` 各加四格：

```ts
  // 【停放的 B-17 一枚炸毀】9,300 的彈 30 m 線性衰減，落在 20 m 內就掉到 0
  parkedB17: 3_000,
  fuelDump: 6_000,
  bombDump: 6_000,
  // 一條彈道打得掉
  searchlight: 200,
```

`GROUND_ARMOUR` 四格都是 0。

- [ ] **Step 6: 油桶堆的火**

`src/render/groundFires.ts`：

`src/main.ts` `emitGroundKills`（`groundFires.ts` 不動）：

```ts
    const t = world.groundTargets[d[o + 3]!]
    const top = t === undefined ? 0 : t.impactY - t.position.y
    // 【油桶堆整片燒】一個火點在 30 × 20 m 的堆上只是一角冒煙；其餘一個
    const n = t !== undefined && t.unit.id === 'fuelDump' ? 6 : 1
    // 【散在腳印上】六個火點沿黃金角撒在半徑 8 m 內 —— 純裝飾
    for (let k = 0; k < n; k++) {
      const r = n === 1 ? 0 : 8 * Math.sqrt((k + 0.5) / n)
      const a = k * 2.39996
      lightGroundFire(groundFires, d[o]! + Math.cos(a) * r, d[o + 1]! + top * 0.3, d[o + 2]! + Math.sin(a) * r)
    }
```

（`emitGroundKills` 是渲染幀讀事件，不是 240 Hz 熱路徑；迴圈裡沒有配置。）

- [ ] **Step 7: 卡片**

`src/battle/missions.ts` 檔頭 import：

```ts
import {
  DUMPS, FLARE_DROPS, HEAVY_FLAK_SITES, LIGHT_FLAK_SITES, PARKED_ROWS, SEARCHLIGHT_SITES,
} from '../world/poltava'
import { HE111 } from '../specs/he111'
```

`LEUNA_GROUND` 之後：

```ts
/**
 * 波爾塔瓦機場：24 架停放的 B-17、油桶堆兩塊、彈藥堆一塊、輕砲 16、重砲 6、
 * 探照燈 6。全部是紅方的地面目標，全部算進炸毀的池。
 */
const POLTAVA_GROUND: readonly GroundEntry[] = [
  ...PARKED_ROWS.map((p): GroundEntry => ({ unit: 'parkedB17', team: 'red', x: p.x, z: p.z, heading: p.heading })),
  ...DUMPS.map((d): GroundEntry => ({ unit: d.kind, team: 'red', x: d.x, z: d.z, heading: d.heading })),
  ...LIGHT_FLAK_SITES.map((s): GroundEntry => ({ unit: 'flakLight', team: 'red', x: s.x, z: s.z, heading: s.heading })),
  ...HEAVY_FLAK_SITES.map((s): GroundEntry => ({ unit: 'flakHeavy', team: 'red', x: s.x, z: s.z, heading: s.heading })),
  ...SEARCHLIGHT_SITES.map((s): GroundEntry => ({ unit: 'searchlight', team: 'red', x: s.x, z: s.z, heading: s.heading })),
]
```

`germany-m2` 換成（`FLARE_DROPS` 這一輪先 import 不用，Task 6 接 `flares`；為免 tsc 未使用的 import 變紅，Task 6 再加那一個 import）：

```ts
    {
      id: 'germany-m2', title: '波爾塔瓦之夜', type: '打擊',
      summary: '駕駛 KG 55 的 He 111 夜襲波爾塔瓦機場，炸掉穿梭轟炸落地的 B-17。',
      place: '烏克蘭　波爾塔瓦機場上空', period: '1944 年 6 月',
      battle: {
        objective: '炸毀停放的 B-17', banner: '夜襲機場，炸毀 B-17',
        blueSpec: HE111, redSpec: P51D, convoySpec: null,
        // 【沒有敵機】史實上蘇軍夜戰機沒有攔到任何一架；壓力全在地面的防空。
        // `redSpec` 只是型別要填：野馬就在皮里亞廷，沒起飛
        blueCount: 8, redCount: 0,
        blueStacked: true,
        convoyCount: 0, convoyPriority: 1,
        targetDistance: 0, targetRadius: 0, seconds: Infinity,
        entry: 'headOn',
        terrain: 'poltava',
        timeOfDay: 'night',
        /**
         * 【1,500 m】輕型砲射程 2,640 m 打得到、重砲也打得到；爬到 3,000 以上
         * 輕砲搆不著但瞄準變難 —— 那是這一關的取捨。**起始值，由試飛裁定。**
         */
        altitude: 1500,
        ground: POLTAVA_GROUND,
        // 【炸毀任意十二座】池是 24 架 B-17、3 堆、22 座砲位、6 座探照燈。
        // 8 架 × 8 枚 = 64 枚，AI 命中約三成。**起始值**
        destroyCount: 12,
        // 蘇軍的 85 mm：射速比 88 慢
        flakSpec: { ...GROUND_FLAK_SPEC, roundsPerMinute: 12 },
      },
    },
```

`ui/menu.ts:69` 德軍那一行的文案若寫「東線到本土：地面打擊」可以不動。

- [ ] **Step 8: 跑，確認綠**

Run: `npx vitest run test/unit/parked.test.ts test/unit/ground-units.test.ts test/unit/campaigns.test.ts test/unit/missions.test.ts test/unit/mission-config-baseline.test.ts`
Expected: PASS。`ground-units` 的命中盒那一條若紅，是 `parkedB17` 的手寫盒沒蓋住 —— 照它印出的頂點極值調盒子（上界，可以大不能小）。`mission-config-baseline` 若對每一張卡釘雜湊，照它的說明補 `germany-m2` 那一筆。

- [ ] **Step 9: 開瀏覽器看一眼**

`npm run dev` 已在跑（`http://localhost:5173/`）。德軍 → 第二關 → 進場。應該看得到：夜空、草地墊面、深灰跑道與停機坪、三排 B-17 剪影、砲位、方塊探照燈；重砲會開火（黑雲），輕砲還不會（Task 5）。截一張圖存 scratchpad。

- [ ] **Step 10: tsc、提交**

```bash
git add src/render/geometry/ground/parked.ts src/render/geometry/ground/dump.ts src/render/geometry/ground/index.ts src/world/groundTargets.ts src/main.ts src/battle/missions.ts test/unit/parked.test.ts test/unit/ground-units.test.ts test/unit/campaigns.test.ts
git commit -m "feat(mission): 德 M2 波爾塔瓦之夜 —— 停放的 B-17、油桶堆、彈藥堆、探照燈座，關卡打得起來"
```

---

### Task 5: 輕型防空砲會還手

**Files:**
- Modify: `src/world/shipGuns.ts:233-260, 323-370`（`GROUND_LIGHT_FLAK_SPEC`、`createGroundBattery`）
- Modify: `src/battle/setup.ts:1037-1046`（`placeGround`）
- Modify: `src/battle/missions.ts`（德 M2 卡的註解）
- Test: `test/unit/ground-light-flak.test.ts`（新）、`test/unit/ground-flak.test.ts`（既有的「省略參數用通用規格」不動）

**Interfaces:**
- Produces：`GROUND_LIGHT_FLAK_SPEC: ShipGunSpec`；`createGroundBattery(spec = GROUND_FLAK_SPEC, tier: ShipAATier = 'flak', calibreMm = 88): ShipGun[]`。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/ground-light-flak.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createGroundBattery, GROUND_FLAK_SPEC, GROUND_LIGHT_FLAK_SPEC, shipOwner, stepGunPlatform,
} from '../../src/world/shipGuns'
import { createGroundTarget } from '../../src/world/groundTargets'
import { Projectiles } from '../../src/world/Projectiles'
import { createFlak } from '../../src/world/flak'
import { createBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import type { TurretCombatant } from '../../src/world/turrets'
import type { Controller } from '../../src/control/Controller'

function target(index: number, x: number, y: number, z: number): TurretCombatant {
  return {
    index, team: 'blue', alive: true, hp: 100,
    aircraft: {
      spec: { turrets: [] },
      state: { position: new Vector3(x, y, z), velocity: new Vector3(0, 0, 0), orientation: new Quaternion() },
    },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

/**
 * # 輕型陸砲 —— 走彈丸池、有曳光
 *
 * 與重高砲同一支射控，差別是 tier：`autocannon` 進 `Projectiles`，
 * 渲染層因此畫得到曳光。這一份守規格與接線，強弱由試飛裁定。
 */
describe('輕型陸砲', () => {
  it('掛的是 autocannon 那一層：彈丸進池、不進高砲彈、彈丸真的在飛', () => {
    const t = createGroundTarget(3, 'flakLight', 'red', 0, 0, 0)
    t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', 37)
    const p = new Projectiles(512)
    const flak = createFlak()
    const dt = 1 / 240
    for (let i = 0; i < 3 * 240; i++) {
      stepGunPlatform(t, [target(0, 0, 1500, -800)], p, flak, i * dt, dt, [t])
    }
    expect(p.live).toBeGreaterThan(0)
    expect(flak.live).toBe(0)
    expect(t.guns[0]!.zone.calibreMm).toBe(37)
    expect(t.guns[0]!.hp).toBe(GROUND_LIGHT_FLAK_SPEC.hp)
    // 【不只數 live】owner 寫錯成 −1 的話 live 照加，但彈丸不推進也不畫
    let k = -1
    for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1) { k = i; break }
    expect(k).toBeGreaterThanOrEqual(0)
    expect(p.owner[k]).toBe(shipOwner(3))
    expect(p.team[k]).toBe(1)
    expect(p.caliber[k]).toBe(37)
    const y0 = p.y[k]!
    p.step(dt)
    expect(p.y[k]).not.toBe(y0)
  })

  it('射程約 2.6 km：2,400 m 開火、3,000 m 不開', () => {
    const near = createGroundTarget(0, 'flakLight', 'red', 0, 0, 0)
    near.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', 37)
    const far = createGroundTarget(1, 'flakLight', 'red', 0, 0, 0)
    far.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', 37)
    const dt = 1 / 240
    const pn = new Projectiles(512)
    const pf = new Projectiles(512)
    const flak = createFlak()
    for (let i = 0; i < 3 * 240; i++) {
      stepGunPlatform(near, [target(0, 0, 1500, -1800)], pn, flak, i * dt, dt, [near])
      stepGunPlatform(far, [target(0, 0, 1500, -2600)], pf, flak, i * dt, dt, [far])
    }
    expect(pn.live).toBeGreaterThan(0)
    expect(pf.live).toBe(0)
  })

  it('省略 tier 仍是重高砲', () => {
    const g = createGroundBattery()
    expect(g[0]!.zone.tier).toBe('flak')
    expect(g[0]!.zone.calibreMm).toBe(88)
    expect(g[0]!.spec).toBe(GROUND_FLAK_SPEC)
  })

  it('placeGround 對 flakLight 掛輕砲、對 flakHeavy 掛重砲、其餘不掛', () => {
    const IDLE: Controller = { update() {} }
    const cfg: BattleConfig = {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, B17G, 1, P51D, 1),
      ground: [
        { unit: 'flakLight', team: 'red', x: 0, z: -6000, heading: 0 },
        { unit: 'flakHeavy', team: 'red', x: 100, z: -6000, heading: 0 },
        { unit: 'truck', team: 'red', x: 200, z: -6000, heading: 0 },
      ],
    }
    const b = createBattle(IDLE, cfg, 1)
    const [light, heavy, truck] = b.world.groundTargets
    expect(light!.guns[0]!.spec).toBe(GROUND_LIGHT_FLAK_SPEC)
    expect(light!.guns[0]!.zone.tier).toBe('autocannon')
    expect(heavy!.guns[0]!.zone.tier).toBe('flak')
    expect(truck!.guns).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/ground-light-flak.test.ts`
Expected: FAIL —— `GROUND_LIGHT_FLAK_SPEC` 不存在。

- [ ] **Step 3: 規格與一般化**

`src/world/shipGuns.ts`，`GROUND_FLAK_SPEC` 之後：

```ts
/**
 * 陸上的輕型防空砲：蘇軍 37 mm 61-K 的樣子（`flakLight` 的模型是 2 cm
 * 四聯，剪影差不多）。**走彈丸池、有曳光** —— 夜空裡那一片曳光彈就是它。
 *
 * ```
 *   初速 880        沿用 40 mm 艦砲
 *   射速 160 發/分  61-K 的實際循環射速
 *   壽命 3.0 s      射程 2,640 m —— 1,500 m 的投彈高度打得到
 *   單發 7          40 mm 艦砲是 9
 * ```
 *
 * 【射界是天頂 ± 65°】陸上砲位的砲區在中線上，`axisOf` 對中線給的是天頂
 * 軸，射界錐是 `SHIP_AA_ARC_DEFAULTS.autocannon.halfAngleDeg`；仰角低於 25°
 * 的目標打不到 —— 貼地掠過的飛機是安全的，那正是掃射該有的樣子。
 *
 * 【壓力靠座數不靠單發】與洛伊納的重砲同一條哲學。**全部是起始值，由試飛
 * 裁定。** `boxHalf` 用不到（命中判定走 `GroundTarget.hull`）。
 */
export const GROUND_LIGHT_FLAK_SPEC: ShipGunSpec = {
  muzzleVelocity: 880, roundsPerMinute: 160, life: 3.0, caliber: 37,
  damage: 7, hp: 160, boxHalf: 1.0, rotationRate: 60 * DEG,
  ...NOT_FLAK,
}
```

`createGroundBattery`：

```ts
/**
 * …（既有註解）
 *
 * @param tier 走哪一層射控：`flak` 是時間引信（不進彈丸池）、`autocannon`／
 *   `mg` 是直射彈（進池、有曳光）。仰角與射界錐照 `SHIP_AA_ARC_DEFAULTS[tier]`
 * @param calibreMm 口徑，只進 `ShipAAZone`（穿甲門檻在 `spec.caliber`）
 */
export function createGroundBattery(
  spec: ShipGunSpec = GROUND_FLAK_SPEC, tier: ShipAATier = 'flak', calibreMm = 88,
): ShipGun[] {
  const zone: ShipAAZone = {
    id: 'flak_c1',
    tier,
    calibreMm,
    position: new Vector3(0, GROUND_FLAK_MUZZLE_Y, 0),
    guns: 1,
    mountsInZone: 1,
    representative: 'flak_c1',
  }
```

（其餘不動；`ShipAATier` 已經 import。）

`resetGuns`（`shipGuns.ts:396`）的 `g.hp = SHIP_GUN_SPECS[g.zone.tier].hp` 改成 `g.hp = g.spec.hp` —— 船的 `spec` 就是表裡那一份，行為不變；陸砲帶自己的規格，重設之後才不會變回艦砲的血量。

`src/battle/setup.ts` `placeGround`（簽名不變）：

```ts
    if (e.unit === 'flakHeavy') t.guns = createGroundBattery(flakSpec)
    // 【輕型砲也還手】走直射彈那一層，曳光看得見。只有德 M2 有輕砲，規格
    // 不逐關複寫 —— 試飛改 `GROUND_LIGHT_FLAK_SPEC` 本身
    else if (e.unit === 'flakLight') t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', 37)
```

`GROUND_LIGHT_FLAK_SPEC` 從 `shipGuns` import。`BattleConfig`、`MissionBattle`、卡片都不加欄位。

- [ ] **Step 4: 跑，確認綠**

Run: `npx vitest run test/unit/ground-light-flak.test.ts test/unit/ground-flak.test.ts test/unit/campaigns.test.ts test/unit/mission-config-baseline.test.ts`
Expected: PASS。射程那一條若 2,400 m 不開火：預瞄解要的是攔截點在射程內，靜止目標的斜距 = √(1500² + 1800²) = 2,343 m，壽命 3.0 × 880 = 2,640 m 夠；射界是天頂 ± 65°，目標仰角 40° 在錐內。不夠就是 `firingWindow` 的問題，不改規格。

- [ ] **Step 5: 開瀏覽器看曳光**

德軍 M2 進場，往機場飛到 2.5 km 內：應該看到地面射上來的曳光彈。

- [ ] **Step 6: tsc、提交**

```bash
git add src/world/shipGuns.ts src/battle/setup.ts src/battle/missions.ts test/unit/ground-light-flak.test.ts
git commit -m "feat(world): 陸上的輕型防空砲會還手 —— 走直射彈那一層，曳光看得見"
```

---

### Task 6: 照明彈 —— 世界層、節拍、渲染層

**Files:**
- Create: `src/world/flares.ts`
- Modify: `src/world/World.ts:288-300, 616`（`flares` 欄位、`step` 裡推進）
- Modify: `src/battle/beats.ts:57-100, 120-130`（`FlareBeat`）
- Modify: `src/battle/setup.ts:1089-1170, 1826`（`stepBeats` 的 `flare` 分支、`resetBattle` 清池）
- Modify: `src/battle/missions.ts`（`MissionFlares`、`cardBeats`、德 M2 卡）
- Create: `src/render/flares.ts`
- Modify: `src/main.ts`（建、掛、每幀更新、換場重建）
- Test: `test/unit/flares.test.ts`、`test/unit/battle-flares.test.ts`、`test/unit/render-flares.test.ts`（新）

**Interfaces:**
- Produces（`src/world/flares.ts`）：
  - `FLARE_CAPACITY = 16`、`FLARE_DESCENT = 2.5`、`FLARE_BURN = 300`、`FLARE_SWAY = 3`、`FLARE_SWAY_PERIOD = 6`
  - `interface Flares { capacity; x, y, z: Float32Array; ox, oy, oz: Float32Array; age: Float64Array; phase: Float32Array; live: Uint8Array; count: number }`
  - `createFlares(capacity?)`、`spawnFlare(f, x, y, z, phase): number`（−1 = 滿）、`stepFlares(f, dt, groundAt)`、`clearFlares(f)`
- Produces（`src/battle/beats.ts`）：`FlareBeat { kind: 'flare'; when: BeatCondition; points: readonly { x: number; z: number }[]; altitude: number }`；`Beat` 聯集含它。
- Produces（`src/battle/missions.ts`）：`MissionFlares { when: MissionTrigger; points; altitude }`；`MissionBattle.flares?: MissionFlares`。
- Produces（`src/render/flares.ts`）：`FLARE_LIGHT_COUNT = 4`；`createFlareLights(glowTexture): { object: Group; update(f: Flares): void; dispose(): void }`；`flareBrightness(age: number): number`（純函數）。

- [ ] **Step 1: 寫失敗的測試（世界層）**

`test/unit/flares.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  clearFlares, createFlares, FLARE_BURN, FLARE_CAPACITY, FLARE_DESCENT, FLARE_SWAY, spawnFlare, stepFlares,
} from '../../src/world/flares'

const DT = 1 / 240
const FLAT = () => 0

describe('照明彈池', () => {
  it('以 FLARE_DESCENT 下墜，橫向搖晃不超過 FLARE_SWAY', () => {
    const f = createFlares()
    spawnFlare(f, 100, 1200, -7000, 0.3)
    for (let i = 0; i < 60 * 240; i++) stepFlares(f, DT, FLAT)
    expect(f.y[0]).toBeCloseTo(1200 - FLARE_DESCENT * 60, 1)
    expect(Math.abs(f.x[0]! - 100)).toBeLessThanOrEqual(FLARE_SWAY + 1e-6)
    expect(Math.abs(f.z[0]! + 7000)).toBeLessThanOrEqual(FLARE_SWAY + 1e-6)
    expect(f.live[0]).toBe(1)
  })

  it('燒滿 FLARE_BURN 秒就熄', () => {
    const f = createFlares()
    spawnFlare(f, 0, 1200, 0, 0)
    for (let i = 0; i < FLARE_BURN * 240 - 1; i++) stepFlares(f, DT, FLAT)
    expect(f.live[0]).toBe(1)
    stepFlares(f, DT, FLAT)
    stepFlares(f, DT, FLAT)
    expect(f.live[0]).toBe(0)
    expect(f.count).toBe(0)
  })

  it('落到地面就熄', () => {
    const f = createFlares()
    spawnFlare(f, 0, 5, 0, 0)
    for (let i = 0; i < 3 * 240; i++) stepFlares(f, DT, () => 2)
    expect(f.live[0]).toBe(0)
  })

  it('滿了拒絕、清池之後又收', () => {
    const f = createFlares()
    for (let i = 0; i < FLARE_CAPACITY; i++) expect(spawnFlare(f, 0, 1000, 0, 0)).toBe(i)
    expect(spawnFlare(f, 0, 1000, 0, 0)).toBe(-1)
    clearFlares(f)
    expect(f.count).toBe(0)
    expect(spawnFlare(f, 0, 1000, 0, 0)).toBe(0)
  })

  it('同一個相位兩次逐位元相同、不同相位不同位置 —— 搖晃是確定性的而且吃相位', () => {
    const a = createFlares()
    const b = createFlares()
    spawnFlare(a, 0, 1000, 0, 1.7)
    spawnFlare(b, 0, 1000, 0, 1.7)
    spawnFlare(b, 0, 1000, 0, 2.9)
    for (let i = 0; i < 5 * 240; i++) {
      stepFlares(a, DT, FLAT)
      stepFlares(b, DT, FLAT)
    }
    expect(a.x[0]).toBe(b.x[0])
    expect(a.z[0]).toBe(b.z[0])
    // 【相位真的有用】忽略相位的實作會讓六枚同步搖
    expect(b.x[1]).not.toBe(b.x[0])
  })
})
```

`test/unit/battle-flares.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import type { FlareBeat } from '../../src/battle/beats'

const IDLE: Controller = { update() {} }
const DT = 1 / 240

const BEAT: FlareBeat = {
  kind: 'flare', when: { kind: 'clock', at: 2 },
  points: [{ x: -100, z: -7000 }, { x: 100, z: -7000 }], altitude: 1200,
}

function cfg(): BattleConfig {
  return {
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, B17G, 1, P51D, 1), beats: [BEAT],
  }
}

describe('照明彈節拍', () => {
  it('時鐘到了在每一個點上生一枚、不預警、不顯示訊息', () => {
    const b = createBattle(IDLE, cfg(), 3)
    for (let i = 0; i < 1.9 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(0)
    for (let i = 0; i < 0.2 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(2)
    expect(b.world.flares.y[0]).toBeCloseTo(1200, 0)
    expect(b.world.flares.x[1]).toBe(100)
    expect(b.message).toBe('')
    expect(b.beatsLeft).toBe(0)
  })

  it('再打一場只清池 —— 節拍不重播，有節拍的關 main.ts 整個 World 重建', () => {
    // 【與 battle-restart.test.ts 同一條規則】`resetBattle` 不把節拍拉回 waiting
    const b = createBattle(IDLE, cfg(), 3)
    for (let i = 0; i < 2.2 * 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(2)
    resetBattle(b)
    expect(b.world.flares.count).toBe(0)
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(b.world.flares.count).toBe(0)
  })

  it('德 M2 的卡帶六枚照明彈，沒有 flares 的卡不產生節拍', () => {
    const m2 = MISSIONS.germany.find((m) => m.id === 'germany-m2') as ReadyMissionCard
    const beats = missionConfigFrom(m2).beats ?? []
    const flare = beats.filter((x) => x.kind === 'flare')
    expect(flare).toHaveLength(1)
    expect((flare[0] as FlareBeat).points).toHaveLength(6)
    const m1 = MISSIONS.germany.find((m) => m.id === 'germany-m1') as ReadyMissionCard
    expect((missionConfigFrom(m1).beats ?? []).some((x) => x.kind === 'flare')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/flares.test.ts test/unit/battle-flares.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: `src/world/flares.ts`**

```ts
/**
 * # 照明彈 —— 傘降、慢慢搖著下來、燒五分鐘
 *
 * SoA 池，**永遠不配置**。它在 `World.step` 裡推進，所以逐位元重播含它；
 * 現在沒有任何判定讀它，渲染層讀位置與年齡畫光。
 *
 * 【為什麼放世界層而不是渲染層】之後若要「被照到的飛機防空砲散布縮小」，
 * 判定要讀它 —— 那時它必須已經是決定性的、在物理步裡的東西。
 */
export const FLARE_CAPACITY = 16
/** 下墜速率，m/s。傘降照明彈的量級 */
export const FLARE_DESCENT = 2.5
/** 燃燒秒數。LC 50 是 5 到 6 分鐘 */
export const FLARE_BURN = 300
/** 橫向搖晃的振幅，m，與週期，s */
export const FLARE_SWAY = 3
export const FLARE_SWAY_PERIOD = 6

export interface Flares {
  readonly capacity: number
  /** 這一步的位置（已含搖晃）。搖晃是相對 `ox`／`oz` 算的，不累積誤差 */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /** 生成點：搖晃繞著 `ox`／`oz` 擺，高度從 `oy` 算 */
  readonly ox: Float32Array
  readonly oy: Float32Array
  readonly oz: Float32Array
  /**
   * 已燒幾秒。**float64** —— 1/240 用 float32 累加五分鐘，誤差會讓熄滅提早
   * 好幾步、高度偏掉半公尺；位置全部由它絕對算，不做逐步積分
   */
  readonly age: Float64Array
  /** 搖晃的相位，rad。生成時給，之後不變 */
  readonly phase: Float32Array
  /** 1 = 亮著 */
  readonly live: Uint8Array
  /** 亮著的枚數 */
  count: number
}

export function createFlares(capacity: number = FLARE_CAPACITY): Flares {
  const f = (): Float32Array => new Float32Array(capacity)
  return {
    capacity, x: f(), y: f(), z: f(), ox: f(), oy: f(), oz: f(),
    age: new Float64Array(capacity), phase: f(),
    live: new Uint8Array(capacity), count: 0,
  }
}

/** 點一枚。回槽位；**滿了回 −1**（與高砲彈同一條規則：滿了代表別處出錯） */
export function spawnFlare(f: Flares, x: number, y: number, z: number, phase: number): number {
  for (let i = 0; i < f.capacity; i++) {
    if (f.live[i] !== 0) continue
    f.x[i] = x; f.y[i] = y; f.z[i] = z
    f.ox[i] = x; f.oy[i] = y; f.oz[i] = z
    f.age[i] = 0
    f.phase[i] = phase
    f.live[i] = 1
    f.count++
    return i
  }
  return -1
}

const TWO_PI = Math.PI * 2

/**
 * 推進一步。位置全部是年齡的函數（下墜是線性、搖晃是正弦），不做逐步積分
 * —— 240 Hz 積分五分鐘會漂。燒滿或落到地面就熄。
 */
export function stepFlares(f: Flares, dt: number, groundAt: (x: number, z: number) => number): void {
  for (let i = 0; i < f.capacity; i++) {
    if (f.live[i] === 0) continue
    const age = f.age[i]! + dt
    f.age[i] = age
    const y = f.oy[i]! - FLARE_DESCENT * age
    f.y[i] = y
    const t = age * (TWO_PI / FLARE_SWAY_PERIOD) + f.phase[i]!
    f.x[i] = f.ox[i]! + FLARE_SWAY * Math.sin(t)
    f.z[i] = f.oz[i]! + FLARE_SWAY * Math.sin(t * 0.7 + 1.3)
    if (age >= FLARE_BURN || y <= groundAt(f.x[i]!, f.z[i]!)) {
      f.live[i] = 0
      f.count--
    }
  }
}

export function clearFlares(f: Flares): void {
  f.live.fill(0)
  f.count = 0
}
```

`src/world/World.ts`：欄位 `readonly flares = createFlares()`（放在 `flak` 旁邊，註解「照明彈。沒有判定讀它，但它在物理步裡推進 —— 見 `flares.ts`」）；`step` 裡 `stepFlak(...)` 之後加 `stepFlares(this.flares, dt, this.groundAt)`。

- [ ] **Step 4: 節拍**

`src/battle/beats.ts`：

```ts
/**
 * 在幾個點上點照明彈。**沒有預警、沒有訊息** —— 照明機飛過去投下，玩家看到
 * 的就是天上亮起來。條件到了就生效，同一步。
 */
export interface FlareBeat {
  readonly kind: 'flare'
  readonly when: BeatCondition
  /** 世界座標的 (x, z)，每一點一枚 */
  readonly points: readonly { readonly x: number; readonly z: number }[]
  /** 點燃的高度，m */
  readonly altitude: number
}

export type Beat = ReinforceBeat | WithdrawBeat | RecycleBeat | FlareBeat
```

（`createBeatStates` 的 `slot` 對它是 −1，既有寫法已經是 `b.kind === 'reinforce' ? slot++ : -1`。）

`src/battle/setup.ts` `stepBeats`：

```ts
    if (st.phase === 'waiting') {
      if (!conditionMet(beat.when, now, aliveOf, b.batches)) continue
      st.phase = 'warned'
      st.dueAt = now + (beat.kind === 'reinforce' ? beat.warnLead : 0)
      // 【照明彈沒有訊息】天亮起來就是通知
      if (beat.kind === 'reinforce') b.message = beat.warn
      else if (beat.kind === 'withdraw') b.message = beat.message
      if (beat.kind !== 'flare') b.messageUntil = st.dueAt + MESSAGE_SECONDS
    }
    …
    st.phase = 'done'
    b.beatsLeft--
    if (beat.kind === 'reinforce') reinforce(b, beat.flight)
    else if (beat.kind === 'flare') dropFlares(b, beat)
    else { …withdraw 那一段不動… }
```

新函數（放 `stepBeats` 之後）：

```ts
/**
 * 在每一個點上點一枚。相位由點的序號給 —— 決定性，而且六枚不會同步搖。
 * 池滿就少點幾枚（`spawnFlare` 回 −1），不拋：那是容量估錯，不該炸掉一場仗。
 */
function dropFlares(b: Battle, beat: FlareBeat): void {
  for (let k = 0; k < beat.points.length; k++) {
    const p = beat.points[k]!
    spawnFlare(b.world.flares, p.x, beat.altitude, p.z, k * 1.1)
  }
}
```

`resetBattle`：`clearFlak(b.world.flak)` 旁邊加 `clearFlares(b.world.flares)`。

`src/battle/missions.ts`：

```ts
/** 這一關的照明彈。**沒有的卡不寫這一格**（與 `waves` 同一個約定） */
export interface MissionFlares {
  readonly when: MissionTrigger
  readonly points: readonly { readonly x: number; readonly z: number }[]
  /** 點燃高度，m */
  readonly altitude: number
}
```

`MissionBattle` 加 `readonly flares?: MissionFlares`；`cardBeats` 在 `withdraw` 之前加 `if (b.flares !== undefined) out.push({ kind: 'flare', when: triggerToCondition(b.flares.when), points: b.flares.points, altitude: b.flares.altitude })`。

德 M2 卡加：

```ts
        /**
         * 【80 秒】He 111 約 85 m/s 從 12 km 外進場，80 秒時離機場約 5 km；
         * 照明彈燒到 380 秒，整個投彈段都亮著。點燃高度 1,200 m，比投彈高度
         * 低 —— 光在飛機下面，照的是地。**起始值，由試飛裁定。**
         */
        flares: { when: { kind: 'clock', at: 80 }, points: FLARE_DROPS, altitude: 1200 },
```

- [ ] **Step 5: 跑，確認綠**

Run: `npx vitest run test/unit/flares.test.ts test/unit/battle-flares.test.ts test/unit/beats.test.ts test/unit/battle-beats.test.ts test/unit/strike-replay-baseline.test.ts`
Expected: PASS。`strike-replay-baseline` 兩張卡沒有照明彈，池空、迴圈 16 次早退，雜湊不變 —— 變了就是 `stepFlares` 動到別的東西。

- [ ] **Step 6: 寫失敗的測試（渲染層）**

`test/unit/render-flares.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { PointLight, Texture } from 'three'
import { createFlareLights, FLARE_LIGHT_COUNT, flareBrightness } from '../../src/render/flares'
import { createFlares, FLARE_BURN, spawnFlare } from '../../src/world/flares'

describe('照明彈的光', () => {
  it('四盞點光源開場就在、池空時強度 0', () => {
    const lights = createFlareLights(new Texture())
    const found: PointLight[] = []
    lights.object.traverse((o) => { if ((o as PointLight).isPointLight) found.push(o as PointLight) })
    expect(found).toHaveLength(FLARE_LIGHT_COUNT)
    lights.update(createFlares())
    for (const l of found) expect(l.intensity).toBe(0)
  })

  it('亮著的枚數超過四時，燒最久的先熄、最新的四枚有光', () => {
    const lights = createFlareLights(new Texture())
    const f = createFlares()
    for (let k = 0; k < 6; k++) {
      spawnFlare(f, k * 100, 1000, 0, 0)
      f.age[k] = 100 - k * 10
    }
    lights.update(f)
    const lit: number[] = []
    lights.object.traverse((o) => {
      const l = o as PointLight
      if (l.isPointLight && l.intensity > 0) lit.push(l.position.x)
    })
    expect(lit.sort((a, b) => a - b)).toEqual([200, 300, 400, 500])
  })

  it('亮度最後 30 秒衰減到 0', () => {
    expect(flareBrightness(0)).toBe(1)
    expect(flareBrightness(FLARE_BURN - 30)).toBe(1)
    expect(flareBrightness(FLARE_BURN - 15)).toBeCloseTo(0.5, 6)
    expect(flareBrightness(FLARE_BURN)).toBe(0)
  })
})
```

- [ ] **Step 7: 跑，確認紅**

Run: `npx vitest run test/unit/render-flares.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 8: `src/render/flares.ts`**

```ts
import {
  AdditiveBlending, Group, PointLight, Sprite, SpriteMaterial, type Texture,
} from 'three'
import { FLARE_BURN, type Flares } from '../world/flares'

/**
 * # 照明彈的光
 *
 * 每一枚一個加法混色的光暈 sprite；**點光源固定四盞、開場就掛進場景**，
 * 對應池裡最新的四枚（燒最久的先熄）。
 *
 * 【為什麼不能動態增減燈】`MeshStandardMaterial` 的著色器是依光源數編的：
 * 場景裡多一盞燈，**每一個材質都重編一次** —— 幾百毫秒的卡頓，而且會在
 * 照明彈點燃的那一刻發生。四盞一直在，沒在用的強度 0。
 *
 * 【四盞的代價】每個片元多四次光照，地面那一顆網格最大。`frame-time` e2e
 * 量過超預算就把 `FLARE_LIGHT_COUNT` 降到 2。
 */
export const FLARE_LIGHT_COUNT = 4
/** 光源的照射距離，m，與衰減指數 */
export const FLARE_LIGHT_DISTANCE = 2500
const FLARE_LIGHT_INTENSITY = 6
const FLARE_COLOR = 0xfff2d0
/** 光暈 sprite 的直徑，m */
const GLOW_SIZE = 40
/** 最後這幾秒亮度線性衰到 0 */
const FADE_SECONDS = 30

export function flareBrightness(age: number): number {
  const left = FLARE_BURN - age
  if (left <= 0) return 0
  if (left >= FADE_SECONDS) return 1
  return left / FADE_SECONDS
}

export interface FlareLights {
  readonly object: Group
  /** 每一渲染幀呼叫 */
  update(f: Flares): void
  dispose(): void
}

/** 依年齡排序用的索引，模組級，不配置 */
const ORDER = new Int32Array(64)

export function createFlareLights(glow: Texture): FlareLights {
  const object = new Group()
  const lights: PointLight[] = []
  for (let k = 0; k < FLARE_LIGHT_COUNT; k++) {
    const l = new PointLight(FLARE_COLOR, 0, FLARE_LIGHT_DISTANCE, 2)
    object.add(l)
    lights.push(l)
  }
  const material = new SpriteMaterial({
    map: glow, color: FLARE_COLOR, blending: AdditiveBlending, transparent: true, depthWrite: false,
  })
  const sprites: Sprite[] = []

  return {
    object,
    update(f) {
      // sprite 的數量跟池的容量走，第一次看到才建
      while (sprites.length < f.capacity) {
        const s = new Sprite(material)
        s.visible = false
        object.add(s)
        sprites.push(s)
      }
      // 亮著的依年齡由小到大排（插入排序，最多 16 個）
      let n = 0
      for (let i = 0; i < f.capacity; i++) {
        if (f.live[i] === 0) continue
        let j = n
        while (j > 0 && f.age[ORDER[j - 1]!]! > f.age[i]!) {
          ORDER[j] = ORDER[j - 1]!
          j--
        }
        ORDER[j] = i
        n++
      }
      for (let i = 0; i < f.capacity; i++) sprites[i]!.visible = false
      for (let k = 0; k < n; k++) {
        const i = ORDER[k]!
        const b = flareBrightness(f.age[i]!)
        const s = sprites[i]!
        s.visible = true
        s.position.set(f.x[i]!, f.y[i]!, f.z[i]!)
        s.scale.set(GLOW_SIZE * (0.6 + 0.4 * b), GLOW_SIZE * (0.6 + 0.4 * b), 1)
        if (k < FLARE_LIGHT_COUNT) {
          const l = lights[k]!
          l.position.copy(s.position)
          l.intensity = FLARE_LIGHT_INTENSITY * b
        }
      }
      for (let k = n; k < FLARE_LIGHT_COUNT; k++) lights[k]!.intensity = 0
    },
    dispose() {
      material.dispose()
      for (const l of lights) l.dispose()
    },
  }
}
```

（`ORDER` 的 64 格對 `FLARE_CAPACITY` 16 是上界；池容量若改大過 64，這裡也要改 —— 加一行 `if (f.capacity > ORDER.length) throw`。）

`src/main.ts`：
- 建：`const flareLights = createFlareLights(smokeTexture)`（光暈先借煙的貼圖；圓形光點的貼圖之後用 canvas 生）；`ctx.scene.add(flareLights.object)`。
- 每幀（`flakBursts.step(frameSeconds)` 附近）：`flareLights.update(world.flares)`。
- 白煙：在 `emitPlantSteam` 旁邊加一支 `emitFlareSmoke(frameSeconds)`，對每一枚亮著的照明彈每秒往 `steam` 池發 `FLARE_SMOKE_PER_SECOND`（4）顆，速度往上 `(0, 3, 0)` 加一點側風；種子用計數器，與 `emitPlantSteam` 同一套寫法。
- 換場：池由 `resetBattle` 清，燈的 `update` 讀空池就全滅，不必重建。

- [ ] **Step 9: 跑，確認綠；開瀏覽器看**

Run: `npx vitest run test/unit/render-flares.test.ts`
Expected: PASS。

瀏覽器：德 M2 進場等 80 秒，跑道上方應該亮起六枚、地面被照亮、光暈搖著慢慢下來、白煙往上飄。

- [ ] **Step 10: tsc、提交**

```bash
git add src/world/flares.ts src/world/World.ts src/battle/beats.ts src/battle/setup.ts src/battle/missions.ts src/render/flares.ts src/main.ts test/unit/flares.test.ts test/unit/battle-flares.test.ts test/unit/render-flares.test.ts
git commit -m "feat(battle): 照明彈 —— 傘降的點光源池、flare 節拍、固定四盞燈"
```

---

### Task 7: 探照燈的光束

**Files:**
- Create: `src/render/searchlights.ts`
- Modify: `src/main.ts`（與 `groundModels` 同一個生命週期）
- Test: `test/unit/searchlights.test.ts`（新）

**Interfaces:**
- Produces：`sweepAngles(phase: number, seconds: number, out: { yaw: number; pitch: number }): void`（純函數）；`createSearchlights(targets: readonly GroundTarget[]): { object: Group; update(seconds: number): void; dispose(): void }`；`BEAM_LENGTH = 2500`。

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, expect, it } from 'vitest'
import { Mesh } from 'three'
import { BEAM_LENGTH, createSearchlights, sweepAngles } from '../../src/render/searchlights'
import { createGroundTarget } from '../../src/world/groundTargets'

describe('探照燈的掃描', () => {
  it('仰角在 35° 到 75° 之間、方位會繞一整圈', () => {
    const a = { yaw: 0, pitch: 0 }
    let lo = Infinity
    let hi = -Infinity
    let yawMin = Infinity
    let yawMax = -Infinity
    for (let t = 0; t < 200; t += 0.25) {
      sweepAngles(1.2, t, a)
      lo = Math.min(lo, a.pitch)
      hi = Math.max(hi, a.pitch)
      yawMin = Math.min(yawMin, a.yaw)
      yawMax = Math.max(yawMax, a.yaw)
    }
    expect(lo).toBeGreaterThanOrEqual(35 * Math.PI / 180 - 1e-6)
    expect(hi).toBeLessThanOrEqual(75 * Math.PI / 180 + 1e-6)
    expect(yawMax - yawMin).toBeGreaterThan(Math.PI * 2 - 0.1)
  })

  it('不同相位在同一刻指向不同方向', () => {
    const a = { yaw: 0, pitch: 0 }
    const b = { yaw: 0, pitch: 0 }
    sweepAngles(0, 10, a)
    sweepAngles(2.5, 10, b)
    expect(Math.abs(a.yaw - b.yaw)).toBeGreaterThan(0.1)
  })
})

describe('探照燈的光束', () => {
  const targets = [
    createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0),
    createGroundTarget(1, 'truck', 'red', 50, -7000, 0),
    createGroundTarget(2, 'searchlight', 'red', 100, -7000, 0),
  ]

  it('只對探照燈建光束，死了就藏、復活就回來', () => {
    const s = createSearchlights(targets)
    const beams: Mesh[] = []
    s.object.traverse((o) => { if ((o as Mesh).isMesh) beams.push(o as Mesh) })
    expect(beams).toHaveLength(2)
    s.update(0)
    expect(beams.every((m) => m.visible)).toBe(true)
    targets[0]!.alive = false
    s.update(1)
    expect(beams[0]!.visible).toBe(false)
    expect(beams[1]!.visible).toBe(true)
    targets[0]!.alive = true
    s.update(2)
    expect(beams[0]!.visible).toBe(true)
  })

  it('光束長 BEAM_LENGTH、跟著座走、姿態真的套到網格上', () => {
    const s = createSearchlights(targets)
    s.update(10)
    const m = s.object.children[0] as Mesh
    m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox!
    expect(bb.max.y - bb.min.y).toBeCloseTo(BEAM_LENGTH, 3)
    expect(m.position.x).toBe(0)
    expect(m.position.z).toBe(-7000)
    // 【不只算角度，還要套上去】光束永遠直立的實作在上面兩條都是綠的
    const a = { yaw: 0, pitch: 0 }
    sweepAngles(0, 10, a)
    const dir = new Vector3(0, 1, 0).applyQuaternion(m.quaternion)
    expect(Math.asin(dir.y)).toBeCloseTo(a.pitch, 6)
  })
})
```

（`Vector3` 補進 import。）

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/searchlights.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: `src/render/searchlights.ts`**

```ts
import {
  AdditiveBlending, CylinderGeometry, DoubleSide, Euler, Group, Mesh, MeshBasicMaterial,
} from 'three'
import type { GroundTarget } from '../world/groundTargets'

/**
 * # 探照燈的光束
 *
 * 每一座 `searchlight` 地面目標一根圓錐柱：加法混色、雙面、不寫深度，
 * 從裡面看出去和從外面看都有光柱。掃描是時間的純函數（兩個不同週期的
 * 正弦），每座相位不同，**不接砲火、不接目標**。死了就藏，復活回來。
 *
 * 【加法混色不用管排序】透明物件的排序錯誤在加法下看不出來 —— 兩根光柱
 * 交疊只是更亮。
 */
export const BEAM_LENGTH = 2500
const BEAM_BOTTOM = 1.5
const BEAM_TOP = 12
const BEAM_OPACITY = 0.06
const BEAM_COLOR = 0xdfe8ff
/** 仰角的中心與擺幅，rad */
const PITCH_MID = 55 * Math.PI / 180
const PITCH_SWING = 20 * Math.PI / 180
/** 兩個掃描週期，s。互質才不會每隔幾秒重複同一個姿態 */
const YAW_PERIOD = 37
const PITCH_PERIOD = 23
/** 圓柱的分段 —— 光柱不需要圓，八段就夠 */
const SEGMENTS = 8

/** 這一座此刻指向哪裡。`yaw` 繞 Y、`pitch` 是仰角 */
export function sweepAngles(phase: number, seconds: number, out: { yaw: number; pitch: number }): void {
  out.yaw = (seconds * (Math.PI * 2 / YAW_PERIOD) + phase) % (Math.PI * 2)
  out.pitch = PITCH_MID + PITCH_SWING * Math.sin(seconds * (Math.PI * 2 / PITCH_PERIOD) + phase * 1.7)
}

export interface Searchlights {
  readonly object: Group
  /** 每一渲染幀呼叫。目標在建構時就綁定了，這裡只要畫面時間 */
  update(seconds: number): void
  dispose(): void
}

const ANGLES = { yaw: 0, pitch: 0 }
const E = new Euler()

export function createSearchlights(targets: readonly GroundTarget[]): Searchlights {
  const object = new Group()
  // 圓柱的軸沿 Y，底在 0、頂在 BEAM_LENGTH —— 姿態用 Euler 轉
  const geometry = new CylinderGeometry(BEAM_TOP, BEAM_BOTTOM, BEAM_LENGTH, SEGMENTS, 1, true)
  geometry.translate(0, BEAM_LENGTH / 2, 0)
  const material = new MeshBasicMaterial({
    color: BEAM_COLOR, transparent: true, opacity: BEAM_OPACITY,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
  })
  const beams: { mesh: Mesh; target: GroundTarget; phase: number }[] = []
  for (const t of targets) {
    if (t.unit.id !== 'searchlight') continue
    const mesh = new Mesh(geometry, material)
    object.add(mesh)
    beams.push({ mesh, target: t, phase: beams.length * 1.9 })
  }

  return {
    object,
    update(seconds) {
      for (const b of beams) {
        const t = b.target
        b.mesh.visible = t.alive
        if (!t.alive) continue
        sweepAngles(b.phase, seconds, ANGLES)
        b.mesh.position.set(t.position.x, t.position.y + 2, t.position.z)
        // 先把軸從 +Y 倒成仰角，再繞 Y 轉方位
        E.set(Math.PI / 2 - ANGLES.pitch, ANGLES.yaw, 0, 'YXZ')
        b.mesh.quaternion.setFromEuler(E)
      }
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

`src/main.ts`：與 `groundModels` 同一段生命週期 —— `let searchlights: Searchlights | null = null`；換場時 `remove`／`dispose`，`world.groundTargets.length > 0` 時 `createSearchlights(world.groundTargets)` 並 `scene.add`；每幀 `searchlights?.update(elapsed)` 放在 `groundModels?.update` 旁邊。

- [ ] **Step 4: 跑，確認綠；看畫面**

Run: `npx vitest run test/unit/searchlights.test.ts`
Expected: PASS。

瀏覽器：夜空裡六根白光柱慢慢掃。太亮就降 `BEAM_OPACITY`，太細就加 `BEAM_TOP`。

- [ ] **Step 5: tsc、提交**

```bash
git add src/render/searchlights.ts src/main.ts test/unit/searchlights.test.ts
git commit -m "feat(render): 探照燈的光束 —— 加法混色的圓錐柱，兩個週期掃描"
```

---

### Task 8: 機場佈景 GLB（Blender）

**Files:**
- Create: `tools/blender/build_airfield.py`
- Create: `public/models/poltava_airfield.glb`（Blender 匯出）、`tools/blender/poltava_airfield.blend`
- Create: `src/render/geometry/ground/airfieldScenery.ts`
- Modify: `src/render/terrain.ts`（`createPoltavaTerrain` 接佈景）、`src/main.ts:2425`（預載）
- Test: `test/unit/airfield-scenery.test.ts`（新）

**Interfaces:**
- Produces：`AIRFIELD_GLB_URL = '/models/poltava_airfield.glb'`；`preloadAirfieldScenery(fetcher?)`；`buildAirfieldScenery(): BufferGeometry`。

- [ ] **Step 1: 寫失敗的測試**

`test/unit/airfield-scenery.test.ts`：

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Box3, Vector3 } from 'three'
import {
  AIRFIELD_GLB_URL, buildAirfieldScenery, preloadAirfieldScenery,
} from '../../src/render/geometry/ground/airfieldScenery'
import { APRON, FIELD_CENTER, FIELD_PAD, PARKED_ROWS, RUNWAY, worldToField } from '../../src/world/poltava'

async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`public${url}`)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('波爾塔瓦機場的佈景', () => {
  beforeAll(() => preloadAirfieldScenery(readPublic))

  it('載得到、已經平移到機場中心、不超過 8 MB', () => {
    expect(AIRFIELD_GLB_URL).toBe('/models/poltava_airfield.glb')
    const g = buildAirfieldScenery()
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    g.computeBoundingBox()
    const c = g.boundingBox!.getCenter(new Vector3())
    expect(Math.abs(c.x - FIELD_CENTER.x)).toBeLessThan(FIELD_PAD.halfX)
    expect(Math.abs(c.z - FIELD_CENTER.z)).toBeLessThan(FIELD_PAD.halfZ)
    expect(readFileSync(`public${AIRFIELD_GLB_URL}`).byteLength).toBeLessThan(8 * 1048576)
  })

  it('沒有任何頂點落在跑道、停機坪、或停放的 B-17 腳印上', () => {
    const g = buildAirfieldScenery()
    const pos = g.getAttribute('position')
    const L = { x: 0, z: 0 }
    let bad = 0
    for (let i = 0; i < pos.count; i++) {
      worldToField(pos.getX(i), pos.getZ(i), L)
      if (L.x >= RUNWAY.x0 && L.x <= RUNWAY.x1 && L.z >= RUNWAY.z0 && L.z <= RUNWAY.z1) bad++
      if (L.x >= APRON.x0 && L.x <= APRON.x1 && L.z >= APRON.z0 && L.z <= APRON.z1) bad++
    }
    expect(bad).toBe(0)
    // 【每一種避讓都驗】腳本的 KEEPOUTS 漏了哪一組，就是那一組的頂點會冒出來。
    // 單趟掃頂點、不配置：幾萬個頂點 × 五十幾個腳印，逐點建 Vector3 會跑很久
    const boxes: { x: number; z: number; hx: number; hz: number }[] = [
      ...PARKED_ROWS.map((p) => ({ x: p.x, z: p.z, hx: 17, hz: 13 })),
      ...DUMPS.map((d) => ({ x: d.x, z: d.z, hx: 16, hz: 11 })),
      ...[...LIGHT_FLAK_SITES, ...HEAVY_FLAK_SITES, ...SEARCHLIGHT_SITES]
        .map((s) => ({ x: s.x, z: s.z, hx: 8, hz: 8 })),
    ]
    let onKeepout = 0
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      for (const b of boxes) {
        if (Math.abs(x - b.x) <= b.hx && Math.abs(z - b.z) <= b.hz) { onKeepout++; break }
      }
    }
    expect(onKeepout).toBe(0)
  })

  it('每次拿到的是複本，改一份不動另一份', () => {
    const a = buildAirfieldScenery()
    const b = buildAirfieldScenery()
    expect(a).not.toBe(b)
    a.getAttribute('position').setX(0, 12345)
    expect(b.getAttribute('position').getX(0)).not.toBe(12345)
  })
})
```

（`DUMPS`、`LIGHT_FLAK_SITES`、`HEAVY_FLAK_SITES`、`SEARCHLIGHT_SITES` 補進 import。）

- [ ] **Step 2: 跑，確認紅**

Run: `npx vitest run test/unit/airfield-scenery.test.ts`
Expected: FAIL（模組與 GLB 都不存在）。

- [ ] **Step 3: `airfieldScenery.ts`**

照 `plantScenery.ts` 逐字，換三個名字：`AIRFIELD_GLB_URL`、`preloadAirfieldScenery`、`buildAirfieldScenery`，平移到 `FIELD_CENTER`。檔頭註解寫「營舍、塔台、散桶、圍籬、電線桿 —— 一顆合併網格、沒有命中盒；目標（B-17、堆、砲位、探照燈）不在這裡」。

- [ ] **Step 4: `tools/blender/build_airfield.py`**

骨架照 `build_plant.py`：把 `Builder`、`mat`／`fixed_mat`、`get_col`、`box_mesh`／`cyl_mesh`／`plane_mesh`、`add_box`／`add_cyl`／`add_plane`、`export_*` 複製過來（Blender 的 `exec` 沒有模組路徑，不 import）。**`ROOT` 從 `bpy.data.filepath` 推**：

```python
ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'public', 'models')
```

（.blend 存在 `tools/blender/`，往上兩層是 repo 根。）

佈局資料**與 `src/world/poltava.ts` 同一份數字**（Blender y = −遊戲 dz）：

```python
PAD_HALF_X, PAD_HALF_Z = 900.0, 600.0
RUNWAY = (-750, -30, 750, 30)       # x0, z0, x1, z1
APRON = (350, 60, 850, 360)
PARKED = [(396 + k * 36, 110 + r * 100) for r in range(3) for k in range(8)]
DUMPS = [(-700, -450, 30, 20), (-640, -450, 30, 20), (700, 500, 24, 12)]
LIGHT_FLAK = [(-500, -450), (0, -480), (500, -450), (-800, -150), (-800, 200), (800, -200),
              (-450, 450), (150, 480), (1300, 0), (919, 919), (0, 1300), (-919, 919),
              (-1300, 0), (-919, -919), (0, -1300), (919, -919)]
HEAVY_FLAK = [(2000, 0), (1000, 1732), (-1000, 1732), (-2000, 0), (-1000, -1732), (1000, -1732)]
SEARCHLIGHTS = [(950, 0), (475, 823), (-475, 823), (-950, 0), (-475, -823), (475, -823)]
```

`KEEPOUTS`：跑道與停機坪矩形（各外擴 20 m）、每一架 B-17 的 36 × 26 m 腳印、三個堆的腳印、砲位與探照燈半徑 8 m 的圓。

區塊（一個區塊一顆網格，全部掛在 `Airfield` 之下）：

```
  Airfield_camp      營舍區：墊面西南角 (-800…-350, 250…550)，帳篷（斜頂盒 6×4×2.5）
                     二十來座成排、木屋（盒 10×6×3）四座、幾輛卡車（盒 6×2.4×2.5）
  Airfield_tower     塔台：(-100, -80)，兩層盒 8×8×4 疊 6×6×3，頂上一片平板
  Airfield_drums     散桶：油桶堆周圍 (-760…-560, -520…-380) 散 150 顆單桶，
                     避開兩個堆本身的腳印
  Airfield_fence     圍籬：沿墊面四周，木樁 2 m 高、每 20 m 一根、之間一條薄板；
                     南邊留 30 m 的門
  Airfield_poles     電線桿：沿連外道路 (-200, -600) → (-200, -2500)，每 40 m 一根
  Airfield_revets    跑道兩端各一片 PSP 的邊界板（薄平板，深灰），標出跑道頭
```

材質名全部用 `LP_Plant*` 既有的十幾種（`glb.ts` 的 `PLANT_MATERIALS`）：帳篷 `LP_PlantSand`、木屋 `LP_PlantPole`、卡車 `LP_PlantSteel`、塔台 `LP_PlantWall`、桶 `LP_PlantSteel`、圍籬 `LP_PlantPole`、平板 `LP_PlantSlab`。**不加新名字**。

`build_airfield()` 與 `export_airfield()`（匯出 `poltava_airfield.glb`，選項照 `export_plant`）。

在 Blender（MCP）裡：新檔存成 `tools/blender/poltava_airfield.blend`，`exec(open(r'tools/blender/build_airfield.py', encoding='utf-8').read())`，`build_airfield()`，`export_airfield()`。存檔前確認檔裡沒有參考模型（記憶：`.blend` 存檔前清參考）。

- [ ] **Step 5: 接上地形與預載**

`src/render/terrain.ts`：`createPoltavaTerrain` 改成 `createInlandTerrain(createPoltava(), 'summer', POLTAVA_SITE, buildAirfieldScenery)`。
`src/main.ts:2425` 的 `await preloadPlantScenery()` 之後加 `await preloadAirfieldScenery()`，註解同款（沒載到的症狀是德 M2 進不去）。

- [ ] **Step 6: 跑，確認綠；看畫面**

Run: `npx vitest run test/unit/airfield-scenery.test.ts`
Expected: PASS。「沒有頂點落在腳印上」紅就是 `KEEPOUTS` 漏了 —— 改腳本重匯，不改測試。

瀏覽器：營舍、塔台、圍籬看得到；從 1,500 m 看下去帳篷排成行。

- [ ] **Step 7: tsc、提交**

```bash
git add tools/blender/build_airfield.py tools/blender/poltava_airfield.blend public/models/poltava_airfield.glb src/render/geometry/ground/airfieldScenery.ts src/render/terrain.ts src/main.ts test/unit/airfield-scenery.test.ts
git commit -m "feat(render): 波爾塔瓦機場的佈景 —— Blender 產出的營舍、塔台、散桶、圍籬"
```

---

### Task 9: 試玩定值

**Files:**
- Modify: `src/battle/missions.ts`（德 M2 的數字）、`src/world/poltava.ts`（座數）、`src/world/shipGuns.ts`（`GROUND_LIGHT_FLAK_SPEC`）—— **只改數字，不改結構**

沒有探針、沒有截圖 e2e、不加逐位元基準。**遊戲性由負責人試玩**，回報「太快掉／投不出去／太空」之後再改對應的旋鈕：

```
  掉太多      輕砲座數（LIGHT_FLAK_SITES）→ 射速（GROUND_LIGHT_FLAK_SPEC.roundsPerMinute）
              → 重砲座數。單發傷害不動
  炸不完 12   destroyCount，或 B-17 的血量（GROUND_HP.parkedB17）
  太暗／太亮  FLARE_LIGHT_INTENSITY、FLARE_LIGHT_DISTANCE；光束 BEAM_OPACITY
  太卡        FLARE_LIGHT_COUNT 降到 2
```

- [ ] **Step 1: 整層測試一次**

Run: `npx vitest run`（perf-gate 並行假紅的話單獨重跑那一檔）。
Expected: 全綠。

- [ ] **Step 2: 交給負責人試玩**

`npm run dev` 已在跑。回報之後改數字、跑碰到的測試檔、提交：

```bash
git add src/battle/missions.ts src/world/poltava.ts src/world/shipGuns.ts
git commit -m "tune(mission): 德 M2 試玩定值"
```

---

## 自我檢查

**Spec 覆蓋**：§6 → Task 1；§7 → Task 2；§12 → Task 3；§8 → Task 4；§9 → Task 5；§10 → Task 6；§11 → Task 7；§13 → Task 8；§14 → Task 4 + 5 + 6；§16 護欄 → 各 task 的測試（**只寫小功能部件，不寫遊戲性、不跑整關**：spec §16 的第 9、10 條與 §17 依負責人 2026-09-10 裁定不做）；§17 → Task 9 改成試玩。§5 不做的都沒做。

**已知未做**（Codex 2026-09-10 審查指出，負責人裁定不在這一輪）：
- `stepGunPlatform` 的彈丸 owner 是 `shipOwner(index)`，陸砲與船的索引同一個空間 —— 只影響「發射的那一艘不打自己」的排除，這一關沒有船；同時有船與直射陸砲的關出現時再分開。
- 被艦砲／陸砲打下來的飛機，擊墜事件的兇手是 −1，K/D 看板把它算成自摔、不加陣亡。**艦砲今天就是這樣**，不是這一關引入的；要分「自摔」與「防空砲」是另一個題目。

**型別一致**：`createGroundBattery(spec, tier, calibreMm)`（Task 5）與 `placeGround` 的呼叫一致；`FlareBeat.points` 與 `MissionFlares.points` 同型；`Flares` 欄位名在 `flares.ts` 與 `render/flares.ts` 一致（`x y z ox oy oz age phase live count`）；`Searchlights.update(seconds)` 在 Task 7 的介面、實作、測試、`main.ts` 四處一致。
