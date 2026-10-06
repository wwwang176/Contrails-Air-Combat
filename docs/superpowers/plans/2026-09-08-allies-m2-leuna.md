# 盟 M2「梅澤堡的油廠」實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `allies-m2` 變成打得起來的一關：B-17G 四架在任務專用的洛伊納地形上炸毀合成油廠的 12 座構件中的 6 座，Bf 109 K-4 兩批攔截。

**Architecture:** 地面目標是照軍艦形狀寫的獨立實體（不是 Combatant、不是 Ship），只有炸彈認得它；AI 轟炸機的攻擊航路泛化成吃「打擊目標視圖」，船與建築各自滿足它；地形是農地生成器加手擺丘陵與保證平坦的墊面；色彩用季節參數穿過田區著色器與樹的頂點色，夏季逐位元不變。

**Tech Stack:** TypeScript、three.js、vitest。

**Spec:** `docs/superpowers/specs/2026-09-08-allies-m2-leuna-design.md`

## Global Constraints

- `CLAUDE.md` 全部適用：註解只寫現狀與理由（繁體中文）、直接編輯不用腳本、`npx tsc --noEmit` 開工前量一次基準（目前 24 行）改完不得增加、提交 trailer 只留 `Co-Authored-By`、不 `git add -A`、護欄先驗紅或做變異。
- 熱路徑（240 Hz 物理步、10 Hz 決策拍）不配置記憶體。轉接物件在組場時建一次。
- 船那條路逐位元不變：新迴圈接在船的迴圈之後，不合併迭代器、不動運算順序、`orientation` 直接透傳。
- 夏季色盤逐位元不變：`FIELD_GLSL`、`fieldSurfaceColor` 的夏季輸出、樹的頂點色都要與凍結的基準相同。
- 每個 task 結尾跑 `npx vitest run <相關檔案>`，全部 task 做完跑 `npm run test:unit` 與 `npm run test:integration`，然後 `npx tsc --noEmit | Measure-Object -Line` 比基準。
- 這一版**不做**：陸上 Flak 邏輯、P-51 護航、煙幕、河與鐵路、光禿樹的幾何、彈丸命中建築、飛機撞建築、AI 目標分派。

---

## 檔案結構

新增：

| 檔案 | 責任 |
|---|---|
| `src/render/season.ts` | `Season` 型別、`FIELD_COLORS`、`FLORA_COLORS` 兩張查表 |
| `src/world/leuna.ts` | leuna 生成器、手擺丘陵、`PLANT_*`、`FLAK_SITES`、`PLANT_LAYOUT` |
| `src/world/groundTargets.ts` | `GroundKind`／`GroundClass`／`GroundTarget`、`GROUND_CLASSES`、`createGroundTarget`、`resetGroundTarget` |
| `src/world/strikeTarget.ts` | `StrikeTarget` 視圖介面（world 層的純資料視圖，AI 與 World 都能 import） |
| `src/ai/shipStrikeView.ts` | `ShipStrikeView`：一個可重複指向不同 `Ship` 的視圖物件 |
| `src/render/geometry/plant/parts.ts` | 三角形湯積木：`box`、`cylinder`、`frustum`、`build` |
| `src/render/geometry/plant/index.ts` | 六種構件的 `buildPlantGeometry(kind)` 與 `PLANT_SHAPES` 尺寸表 |
| `src/render/plant.ts` | `createPlantModels(targets)`：一座一個 Mesh、摧毀換殘骸 |
| `src/render/groundFires.ts` | 固定世界座標的火點池 |
| `test/unit/strike-replay-baseline.test.ts` | 日 M4／盟 M4 攻擊路徑的擴充摘要基準 |
| `test/unit/summer-palette-baseline.test.ts` | 夏季色盤與樹頂點色的凍結基準 |
| `test/unit/leuna.test.ts`、`test/unit/ground-targets.test.ts`、`test/unit/plant-geometry.test.ts`、`test/unit/bomb-vs-ground.test.ts`、`test/integration/ai-bombing-leuna.test.ts` | 護欄 |

修改（責任不變，各加一段）：`terrainKind.ts`、`farmland.ts`（匯出 `HILL_GAP`）、`render/terrain.ts`、`fields.ts`、`farmGround.ts`、`farHorizon.ts`、`floraShapes.ts`、`vegetation.ts`、`world/timeOfDay.ts`、`render/timeOfDay.ts`、`World.ts`、`mission.ts`、`missions.ts`、`setup.ts`、`ai/bombRun.ts`、`ai/torpedoRun.ts`、`ai/strikeRun.ts`、`ai/shipAttack.ts`、`ai/AiController.ts`、`hud/markerFeed.ts`、`main.ts`、`tools/daylight.ts`、`tools/blast.ts`、`shipFires.ts`、對應測試。

---

### Task 0: 量 tsc 基準

- [ ] **Step 1:** `npx tsc --noEmit 2>&1 | Measure-Object -Line`，記下行數（預期 24）。之後每個 task 結尾比它。

---

### Task 1: 凍結兩份「逐位元不變」的基準

**Files:**
- Create: `test/unit/strike-replay-baseline.test.ts`
- Create: `test/unit/summer-palette-baseline.test.ts`

**Interfaces:**
- Produces: `strikeDigest(b: Battle): string`（測試內部的輔助，之後 Task 8 沿用同一支比對）。

- [ ] **Step 1: 寫攻擊路徑的擴充摘要測試**

```ts
// test/unit/strike-replay-baseline.test.ts
import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import type { Controller } from '../../src/aircraft/Controller'

/**
 * 攻擊路徑的逐位元基準。**改 AI 的目標型別之前先凍結，改完比對。**
 *
 * `replayDigest` 不含船、炸彈池、魚雷池與攻擊狀態機 —— 30 秒時飛機姿態
 * 相同不代表投放時刻相同。這一份把那幾樣全部摺進去。
 */
const IDLE: Controller = { update() {} }
const DT = 1 / 240
const SEED = 1234

function wire(b: Battle): void {
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.groundTargets = b.world.groundTargets
    ctl.bombBay = c.bombBay
    ctl.bombDrag = b.world.bombDrag
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  }
}

function num(x: number): string { return x.toPrecision(12) }

export function strikeDigest(b: Battle): string {
  const lines: string[] = []
  for (const c of b.world.combatants) {
    const s = c.aircraft.state
    lines.push(`a ${c.index} ${c.alive ? 1 : 0} ${num(s.position.x)} ${num(s.position.y)} ${num(s.position.z)} ${num(c.hp)}`)
    const ctl = c.controller
    if (ctl instanceof AiController) {
      lines.push(`k ${ctl.strike.phase} ${ctl.strike.seconds.toPrecision(6)} ${ctl.strikeRef.kind} ${ctl.strikeRef.index}`)
    }
    if (c.bombBay !== null) lines.push(`b ${c.bombBay.load} ${c.bombBay.queue}`)
  }
  for (const sh of b.world.ships) {
    lines.push(`s ${sh.index} ${sh.alive ? 1 : 0} ${num(sh.position.x)} ${num(sh.position.z)} ${num(sh.hp)}`)
  }
  lines.push(`bombs ${b.world.bombs.dropped} torps ${b.world.torpedoes.dropped}`)
  return lines.join('\n')
}

function run(card: ReadyMissionCard, seconds: number): Battle {
  const b = createBattle(IDLE, missionConfigFrom(card), SEED)
  for (let i = 0; i < seconds * 240; i++) { wire(b); stepBattle(b, DT) }
  return b
}

const japan = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard
const allies = MISSIONS.allies.find((c) => c.id === 'allies-m4') as ReadyMissionCard

describe('攻擊路徑的逐位元基準', () => {
  it('japan-m4 跑 90 秒', () => {
    expect(hash(strikeDigest(run(japan, 90)))).toBe('<填入>')
  }, 120_000)
  it('allies-m4 跑 90 秒', () => {
    expect(hash(strikeDigest(run(allies, 90)))).toBe('<填入>')
  }, 120_000)
})

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(16)
}
```

注意：這一步 `ctl.groundTargets` 與 `ctl.strikeRef` 還不存在。**第一版先拿掉這兩行**（`wire` 不接 `groundTargets`、`k` 行改成 `ctl.strike.phase / seconds / ctl.strike.ship`），跑一次把兩個雜湊填進去；Task 8 改完型別後再把那兩行換回來、雜湊不變才算過。

- [ ] **Step 2: 跑一次取雜湊**：`npx vitest run test/unit/strike-replay-baseline.test.ts`，把兩個實際雜湊填進 `<填入>`。再跑一次確認綠。
- [ ] **Step 3: 寫夏季色盤基準**

```ts
// test/unit/summer-palette-baseline.test.ts
import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { FIELD_GLSL, fieldSurfaceColor } from '../../src/render/fields'
import { createFloraGeometries, disposeFloraGeometries } from '../../src/render/floraShapes'

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(16)
}

describe('夏季色盤的凍結基準（季節參數加進去前後都要相同）', () => {
  it('FIELD_GLSL 逐字相同', () => {
    expect(hash(FIELD_GLSL)).toBe('<填入>')
  })
  it('fieldSurfaceColor 的取樣表相同', () => {
    const out = new Color()
    const rows: string[] = []
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        fieldSurfaceColor(i * 137.3 - 2700, j * 91.7 - 1800, out)
        rows.push(out.getHexString())
      }
    }
    expect(hash(rows.join(','))).toBe('<填入>')
  })
  it('樹與房子的頂點色相同', () => {
    const g = createFloraGeometries()
    const rows: string[] = []
    for (const k of Object.keys(g).sort()) {
      const col = g[k as keyof typeof g].getAttribute('color').array as Float32Array
      rows.push(k + ':' + Array.from(col, (v) => v.toFixed(5)).join(','))
    }
    disposeFloraGeometries(g)
    expect(hash(rows.join('\n'))).toBe('<填入>')
  })
})
```

- [ ] **Step 4:** 跑一次填雜湊，再跑確認綠。
- [ ] **Step 5: Commit** `test: 凍結攻擊路徑與夏季色盤的逐位元基準`

---

### Task 2: 季節模組與田區／樹的季節參數

**Files:**
- Create: `src/render/season.ts`
- Modify: `src/render/fields.ts:86-125`、`:384-403`、`:405-422`
- Modify: `src/render/farmGround.ts:88-105`、`:108-112`
- Modify: `src/render/farHorizon.ts:61`、`:103`
- Modify: `src/render/floraShapes.ts:64-67`、`:91-95`、`:250`
- Modify: `src/render/vegetation.ts:456-467`、`:485`、`:546`
- Test: `test/unit/season.test.ts`（新）、`test/unit/fields.test.ts:17-20`

**Interfaces:**
- Produces:
  - `type Season = 'summer' | 'lateAutumn'`
  - `interface FieldColors { palette: readonly number[]; ploughed; hedge; track; wood; ploughChance }`
  - `FIELD_COLORS: Record<Season, FieldColors>`、`FLORA_COLORS: Record<Season, { broadLeaf; conifer; bushLeaf }>`
  - `fieldGlsl(season: Season): string`；`FIELD_GLSL = fieldGlsl('summer')` 保留
  - `fieldSurfaceColor(x, z, out, season: Season = 'summer')`
  - `applyFields(material, season: Season = 'summer')`；`createFarmGround(field, season = 'summer')`；`createFarHorizon(season = 'summer')`
  - `createFloraGeometries(season: Season = 'summer')`；`pointColorOf(pool: PointPool, season: Season): number`
  - `VegetationOptions.season?: Season`

- [ ] **Step 1: 寫季節測試**

```ts
// test/unit/season.test.ts
import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { FIELD_COLORS, FLORA_COLORS, SEASONS } from '../../src/render/season'
import { FIELD_GLSL, fieldGlsl, fieldSurfaceColor } from '../../src/render/fields'
import { createFloraGeometries, disposeFloraGeometries, pointColorOf } from '../../src/render/floraShapes'

describe('季節', () => {
  it('兩個季節都有完整的查表，色盤八階', () => {
    for (const s of SEASONS) {
      expect(FIELD_COLORS[s].palette).toHaveLength(8)
      expect(FLORA_COLORS[s].broadLeaf).toBeGreaterThan(0)
    }
  })
  it('夏季的 GLSL 就是 FIELD_GLSL，晚秋的不同而且含晚秋的色值', () => {
    expect(fieldGlsl('summer')).toBe(FIELD_GLSL)
    const autumn = fieldGlsl('lateAutumn')
    expect(autumn).not.toBe(FIELD_GLSL)
    const c = new Color().setHex(FIELD_COLORS.lateAutumn.ploughed)
    expect(autumn).toContain(`vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`)
  })
  it('晚秋的地色與夏季不同、犁田比例更高', () => {
    const a = new Color(); const b = new Color()
    fieldSurfaceColor(1234, -567, a)
    fieldSurfaceColor(1234, -567, b, 'lateAutumn')
    expect(a.getHex()).not.toBe(b.getHex())
    expect(FIELD_COLORS.lateAutumn.ploughChance).toBeGreaterThan(FIELD_COLORS.summer.ploughChance)
  })
  it('晚秋的闊葉樹冠換色、房子不變', () => {
    const s = createFloraGeometries('summer'); const w = createFloraGeometries('lateAutumn')
    const col = (g: typeof s, k: keyof typeof s) => Array.from(g[k].getAttribute('color').array as Float32Array)
    expect(col(w, 'broadMid')).not.toEqual(col(s, 'broadMid'))
    expect(col(w, 'house')).toEqual(col(s, 'house'))
    expect(pointColorOf('broadPoint', 'lateAutumn')).toBe(FLORA_COLORS.lateAutumn.broadLeaf)
    disposeFloraGeometries(s); disposeFloraGeometries(w)
  })
})
```

- [ ] **Step 2:** 跑，預期紅（模組不存在）。
- [ ] **Step 3: 寫 `season.ts`**

```ts
// src/render/season.ts
/**
 * # 季節
 *
 * 田區的地色與樹冠色由季節決定。**農地與群島恆為夏季**，leuna 是
 * 1944 年 11 月的晚秋。色值都是起始值，拿眼睛校。
 */
export type Season = 'summer' | 'lateAutumn'
export const SEASONS: readonly Season[] = ['summer', 'lateAutumn']

export interface FieldColors {
  /** 作物色，**八階漸層** —— `fields.ts` 在「區塊基調 ± 1」裡挑，索引相鄰就必須顏色相近 */
  readonly palette: readonly number[]
  readonly ploughed: number
  readonly hedge: number
  readonly track: number
  readonly wood: number
  /** 犁過的田的比例 */
  readonly ploughChance: number
}

export interface FloraColors {
  readonly broadLeaf: number
  readonly conifer: number
  readonly bushLeaf: number
}

export const FIELD_COLORS: Readonly<Record<Season, FieldColors>> = {
  summer: {
    palette: [0x414d37, 0x4d5a40, 0x59664a, 0x677253, 0x767e5c, 0x858863, 0x928f6a, 0xa09872],
    ploughed: 0x615242, hedge: 0x293123, track: 0x938b77, wood: 0x2f3a28, ploughChance: 0.12,
  },
  // 收割後：麥茬的赭 → 冬麥苗的淡綠；大半的田犁過了
  lateAutumn: {
    palette: [0x6b5a3e, 0x75634a, 0x7f6c52, 0x8a775b, 0x8f8062, 0x8d8a66, 0x83906a, 0x76946c],
    ploughed: 0x4a3a2c, hedge: 0x3a3226, track: 0x7d7059, wood: 0x4a4a2e, ploughChance: 0.45,
  },
}

export const FLORA_COLORS: Readonly<Record<Season, FloraColors>> = {
  summer: { broadLeaf: 0x3f5233, conifer: 0x2f4530, bushLeaf: 0x33452c },
  // 闊葉樹落葉：樹冠是枯枝的褐灰；針葉略暗；灌木褐
  lateAutumn: { broadLeaf: 0x5a4a3c, conifer: 0x2b3d2c, bushLeaf: 0x4d3f30 },
}
```

- [ ] **Step 4: 改 `fields.ts`**。刪掉 `PLOUGH_CHANCE`、`PALETTE`、`PLOUGHED`、`HEDGE`、`TRACK`、`WOOD` 六個常數（`WOOD_CHANCE`、`STRIPE_*` 留著）。`fieldSurfaceColor` 加第四個參數 `season: Season = 'summer'`，內部 `const c = FIELD_COLORS[season]`，把 `PALETTE[t]`→`c.palette[t]`、`PLOUGHED`→`c.ploughed`（其餘同）、`PLOUGH_CHANCE`→`c.ploughChance`。`FIELD_GLSL` 改成：

```ts
export function fieldGlsl(season: Season): string {
  const c = FIELD_COLORS[season]
  const glslPalette = c.palette.map((h) => '  ' + rgb(h)).join(',\n')
  return `
const float FIELD_SPACING = ${FIELD_SPACING.toFixed(1)};
… （原本的字面值逐行照抄，把 PLOUGH_CHANCE→c.ploughChance、HEDGE→c.hedge、TRACK→c.track、PLOUGHED→c.ploughed、WOOD→c.wood、PALETTE→c.palette）
`
}
/** 夏季那一份。既有的呼叫端與測試都讀它 */
export const FIELD_GLSL = fieldGlsl('summer')
```

檢查 `PALETTE.length` 的兩處要改成 `c.palette.length`。

- [ ] **Step 5: 改 `farmGround.ts` 與 `farHorizon.ts`**：`applyFields(material, season: Season = 'summer')`，注入 `${fieldGlsl(season)}`，`material.customProgramCacheKey = () => 'farm-fields:' + season`（註解：換了 GLSL 就要換 key，否則先看過夏季再切晚秋會重用夏季的程式）。`createFarmGround(field, season = 'summer')` 與 `createFarHorizon(season = 'summer')` 把 season 傳給 `applyFields`。
- [ ] **Step 6: 改 `floraShapes.ts`**：刪 `BROAD_LEAF`／`CONIFER`／`BUSH_LEAF` 三個常數；`createFloraGeometries(season: Season = 'summer')`，開頭 `const c = FLORA_COLORS[season]`，積木呼叫改讀 `c.broadLeaf` 等。`POINT_COLOR` 改成函數：

```ts
export function pointColorOf(pool: PointPool, season: Season): number {
  const c = FLORA_COLORS[season]
  return pool === 'broadPoint' ? c.broadLeaf : pool === 'conePoint' ? c.conifer : c.bushLeaf
}
```

`test/unit/flora-shapes.test.ts:4,372` 若讀 `POINT_COLOR`，改成 `pointColorOf(name, 'summer')`。

- [ ] **Step 7: 改 `vegetation.ts`**：`VegetationOptions` 加 `season?: Season`；`const season = opts.season ?? 'summer'`；`createFloraGeometries(season)`；`pointColorOf(name as PointPool, season)`。
- [ ] **Step 8: 修 `test/unit/fields.test.ts:17-20`** 的四個字面值改成從 `FIELD_COLORS.summer` 讀（`.toString(16)`）。
- [ ] **Step 9:** 跑 `npx vitest run test/unit/season.test.ts test/unit/summer-palette-baseline.test.ts test/unit/fields.test.ts test/unit/flora-shapes.test.ts test/unit/flora-wood.test.ts test/unit/terrain.test.ts`，全綠；基準那三個雜湊必須不變。
- [ ] **Step 10: Commit** `feat(render): 田區與樹冠色加季節參數，夏季逐位元不變`

---

### Task 3: `novemberNoon` 時段

**Files:**
- Modify: `src/world/timeOfDay.ts:15`
- Modify: `src/render/timeOfDay.ts:23`、`:91-176`
- Test: `test/unit/time-of-day.test.ts`

- [ ] **Step 1: 寫測試**（加進 `time-of-day.test.ts`）

```ts
it('novemberNoon：太陽低、天色灰、霧比正午濃、海色照抄正午', () => {
  const n = DAY_PALETTES.novemberNoon
  const noon = DAY_PALETTES.noon
  const el = Math.asin(n.sunDir[1] / Math.hypot(...n.sunDir))
  expect(el).toBeGreaterThan(20 * Math.PI / 180)
  expect(el).toBeLessThan(30 * Math.PI / 180)
  expect(n.fogDensity).toBeGreaterThan(noon.fogDensity)
  expect(n.seaColor).toBe(noon.seaColor)
  expect(TIME_OF_DAY_IDS).toContain('novemberNoon')
})
```

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3:** `TimeOfDay` 加 `'novemberNoon'`；`TIME_OF_DAY_IDS` 加在最後；`DAY_PALETTES` 加：

```ts
  // 1944 年 11 月的正午：51°N 的太陽仰角只有二十幾度、天色灰白、遠處
  // 泛霧。leuna 的色盤是為它調的。**它進工具頁的時段清單，不進遭遇戰選單**
  novemberNoon: {
    id: 'novemberNoon', name: '十一月正午',
    skyHorizon: 0xd9d9d6, skyZenith: 0x7f93a8, skyPower: 0.9, stars: 0,
    sunDir: [-0.55, 0.42, 0.72],
    sunColor: 0xfff0dc, sunIntensity: 1.5,
    hemiSky: 0xb9c2cc, hemiGround: 0x3a3630, hemiIntensity: 0.8,
    ambientColor: 0xdfe3e8, ambientIntensity: 0.22,
    seaColor: SEA_COLOR, seaHorizon: SEA_HORIZON_COLOR,
    sparkle: 0.6, foliage: 0.85, fogDensity: FOG_DENSITY * 1.6,
  },
```

檢查 `time-of-day.test.ts` 有沒有「四個時段」的長度斷言，有的話改成 5。遭遇戰選單 `ui/menu.ts:97` 的 `TIMES` 不動。

- [ ] **Step 4:** 跑 `npx vitest run test/unit/time-of-day.test.ts test/unit/menu*.test.ts`，綠。
- [ ] **Step 5: Commit** `feat(render): 加十一月正午的時段`

---

### Task 4: leuna 地形生成器與算繪

**Files:**
- Create: `src/world/leuna.ts`
- Modify: `src/world/farmland.ts:74`（`HILL_GAP` 改 `export`）
- Modify: `src/world/terrainKind.ts:15`
- Modify: `src/render/terrain.ts:103-107`、`:205-243`
- Modify: `src/tools/daylight.ts:248`、`src/tools/blast.ts:375`
- Test: `test/unit/leuna.test.ts`、`test/unit/terrain.test.ts`

**Interfaces:**
- Produces:
  - `createLeuna(): { field: HeightFieldData; hills: IslandDesc[] }`
  - `PLANT_CENTER: Vector3`（`(0, 0, -7000)`）、`PLANT_HEADING = 0`、`PLANT_PAD = { halfX: 700, halfZ: 400 }`、`PAD_CLEARANCE = 400`
  - `FLAK_SITES: readonly { x: number; z: number; heading: number }[]`（8 座）
  - `PLANT_LAYOUT: readonly { kind: GroundKind; dx: number; dz: number; heading: number }[]`（12 座，`GroundKind` 型別在 Task 5，這裡先用字串字面值聯集）
  - `LEUNA_HILLS`（匯出給測試）

- [ ] **Step 1: 寫地形測試**

```ts
// test/unit/leuna.test.ts
import { describe, expect, it } from 'vitest'
import {
  createLeuna, LEUNA_HILLS, PAD_CLEARANCE, PLANT_CENTER, PLANT_LAYOUT, PLANT_PAD, FLAK_SITES,
} from '../../src/world/leuna'
import { HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX, FARM_CELL } from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'

/** 圓心到墊面矩形（軸對齊，中心 PLANT_CENTER）的最近距離 */
function padDistance(cx: number, cz: number): number {
  const dx = Math.max(0, Math.abs(cx - PLANT_CENTER.x) - PLANT_PAD.halfX)
  const dz = Math.max(0, Math.abs(cz - PLANT_CENTER.z) - PLANT_PAD.halfZ)
  return Math.hypot(dx, dz)
}

describe('leuna 地形', () => {
  const { field, hills } = createLeuna()

  it('每一顆丘陵的膨脹圓離墊面至少 PAD_CLEARANCE', () => {
    for (const h of hills) {
      expect(padDistance(h.cx, h.cz) - h.outerRadius, `${h.cx},${h.cz}`).toBeGreaterThanOrEqual(PAD_CLEARANCE)
    }
  })
  it('墊面加一格圍裙內每一格都是 0', () => {
    const apron = FARM_CELL
    for (let x = PLANT_CENTER.x - PLANT_PAD.halfX - apron; x <= PLANT_CENTER.x + PLANT_PAD.halfX + apron; x += FARM_CELL / 2) {
      for (let z = PLANT_CENTER.z - PLANT_PAD.halfZ - apron; z <= PLANT_CENTER.z + PLANT_PAD.halfZ + apron; z += FARM_CELL / 2) {
        expect(field.sample(x, z)).toBe(0)
      }
    }
  })
  it('outerRadius 由 radius × WOBBLE_MAX 推出', () => {
    for (const h of hills) expect(h.outerRadius).toBeCloseTo(h.radius * WOBBLE_MAX, 9)
  })
  it('丘陵都在 HILL_LIMIT 之內，最近的一對至少 HILL_GAP', () => {
    let closest = Infinity
    for (let i = 0; i < hills.length; i++) {
      const a = hills[i]!
      expect(Math.hypot(a.cx, a.cz) + a.outerRadius).toBeLessThanOrEqual(HILL_LIMIT)
      for (let j = i + 1; j < hills.length; j++) {
        const b = hills[j]!
        const gap = Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius
        if (gap < closest) closest = gap
      }
    }
    expect(closest).toBeGreaterThanOrEqual(HILL_GAP)
  })
  it('峰不超過 HILL_PEAK_MAX，而且沒有一格是負的', () => {
    let top = 0
    for (const v of field.data) { expect(v).toBeGreaterThanOrEqual(0); if (v > top) top = v }
    expect(top).toBeLessThanOrEqual(HILL_PEAK_MAX)
    expect(top).toBeGreaterThan(30)
  })
  it('手擺的清單就是場上的丘陵，而且決定性', () => {
    expect(hills.length).toBe(LEUNA_HILLS.length)
    const again = createLeuna()
    expect(Array.from(again.field.data)).toEqual(Array.from(field.data))
  })
  it('12 座構件與 8 座砲位都在墊面內／墊面外', () => {
    expect(PLANT_LAYOUT).toHaveLength(12)
    for (const p of PLANT_LAYOUT) {
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(PLANT_PAD.halfX - 40)
      expect(Math.abs(p.dz)).toBeLessThanOrEqual(PLANT_PAD.halfZ - 40)
    }
    expect(FLAK_SITES).toHaveLength(8)
    for (const s of FLAK_SITES) expect(padDistance(s.x, s.z)).toBeGreaterThan(800)
  })
})
```

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3: 寫 `leuna.ts`**

```ts
import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import {
  bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc, type LobeDraw,
} from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'

/**
 * # 洛伊納：盟 M2 專用的地形
 *
 * 薩勒河平原：大片平地、零星的緩丘，西邊幾顆較高的是蓋澤爾谷的礦區土堆。
 * 用農地的那一套多瓣起伏與高度場，但**丘陵全部手擺，不撒隨機** —— 這張
 * 圖的空間關係（出生線、廠區、砲位、脫離方向）是關卡設計的一部分。
 *
 * 【整張圖的佈局都在這個檔案】卡片引用這裡的常數，不自己寫座標。
 */

/** 廠區中心。藍隊開局在 z ≈ +5,000 朝 −Z，投彈航路 12 km */
export const PLANT_CENTER = /* @__PURE__ */ new Vector3(0, 0, -7000)
export const PLANT_HEADING = 0
/** 墊面矩形的半邊長，m。墊面內保證高度為 0 */
export const PLANT_PAD = { halfX: 700, halfZ: 400 } as const
/**
 * 丘陵的膨脹圓離墊面至少這麼遠，m。
 *
 * 【為什麼是距離不是壓平】`bakeRelief` 只掃膨脹圓內，圓外回到 0；圓離
 * 墊面有距離，墊面就在結構上是 0。壓平運算是多的，而且會遮掉「丘陵擺錯」
 * 這個錯 —— 護欄量的是這個距離。
 */
export const PAD_CLEARANCE = 400

/**
 * 手擺的丘陵。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`，清單不寫 ——
 * `makeLobes` 信任呼叫端給的值，寫錯的話墊面保證就沒了而且不報錯。
 */
export const LEUNA_HILLS = [
  // 西側：礦區土堆，較高
  { cx: -9000, cz: -8500, radius: 1200, peak: 110, pa: 0.4, pb: 2.9, seed: 101 },
  { cx: -11500, cz: -4500, radius: 1100, peak: 95, pa: 1.7, pb: 4.1, seed: 102 },
  { cx: -8500, cz: -1500, radius: 900, peak: 70, pa: 3.3, pb: 0.8, seed: 103 },
  // 平原上的緩丘
  { cx: 6500, cz: -11000, radius: 1000, peak: 60, pa: 2.2, pb: 5.0, seed: 104 },
  { cx: 9500, cz: -6000, radius: 1300, peak: 80, pa: 0.9, pb: 3.6, seed: 105 },
  { cx: 4500, cz: -2500, radius: 800, peak: 45, pa: 4.4, pb: 1.3, seed: 106 },
  { cx: -3500, cz: 3500, radius: 900, peak: 55, pa: 5.1, pb: 2.4, seed: 107 },
  { cx: 3000, cz: 8500, radius: 1100, peak: 65, pa: 1.1, pb: 4.8, seed: 108 },
  { cx: -7500, cz: 9000, radius: 1000, peak: 75, pa: 2.8, pb: 0.3, seed: 109 },
  { cx: 8500, cz: 3000, radius: 900, peak: 50, pa: 3.9, pb: 1.9, seed: 110 },
] as const

/** 預定砲位。這一版只是方塊；另一個 worktree 的 Flak 合進來時用同一份座標 */
export const FLAK_SITES: readonly { x: number; z: number; heading: number }[] = [
  { x: -1800, z: -8600, heading: 0.6 }, { x: 1800, z: -8600, heading: -0.6 },
  { x: -2400, z: -7000, heading: 1.5 }, { x: 2400, z: -7000, heading: -1.5 },
  { x: -1800, z: -5400, heading: 2.5 }, { x: 1800, z: -5400, heading: -2.5 },
  { x: 0, z: -9400, heading: 0 }, { x: 0, z: -4600, heading: Math.PI },
]

/** 12 座構件相對廠區中心的偏移與朝向。氫化塔成排、油槽成群、煙囪最高 */
export const PLANT_LAYOUT: readonly {
  kind: 'hydroTower' | 'chimney' | 'boilerHouse' | 'oilTank' | 'gasHolder' | 'coolingTower'
  dx: number; dz: number; heading: number
}[] = [
  { kind: 'hydroTower', dx: -300, dz: -120, heading: 0 },
  { kind: 'hydroTower', dx: -240, dz: -120, heading: 0 },
  { kind: 'hydroTower', dx: -180, dz: -120, heading: 0 },
  { kind: 'chimney', dx: -60, dz: -200, heading: 0 },
  { kind: 'chimney', dx: 60, dz: -200, heading: 0 },
  { kind: 'boilerHouse', dx: 0, dz: -60, heading: 0 },
  { kind: 'boilerHouse', dx: 220, dz: -60, heading: 0 },
  { kind: 'oilTank', dx: 380, dz: 160, heading: 0 },
  { kind: 'oilTank', dx: 460, dz: 160, heading: 0 },
  { kind: 'oilTank', dx: 420, dz: 240, heading: 0 },
  { kind: 'gasHolder', dx: -420, dz: 180, heading: 0 },
  { kind: 'coolingTower', dx: 120, dz: 220, heading: 0 },
]

/** 瓣的抽法與農地相同：固定 4 瓣，半徑比在 [0.30, 0.48] */
const HILL_LOBES = 4
const HILL_LOBE_RADIUS = [0.30, 0.48] as const

function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

function drawLobes(rand: () => number): LobeDraw[] {
  const out: LobeDraw[] = []
  for (let k = 0; k < HILL_LOBES; k++) {
    out.push({
      dir: rand() * Math.PI * 2,
      rf: HILL_LOBE_RADIUS[0] + rand() * (HILL_LOBE_RADIUS[1] - HILL_LOBE_RADIUS[0]),
      uOff: rand(), uPeak: rand(), pa: rand() * Math.PI * 2, pb: rand() * Math.PI * 2,
    })
  }
  return out
}

export function createLeuna(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of LEUNA_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawLobes(makeRand(h.seed))),
    })
  }
  bakeRelief(field, hills, 0)
  return { field, hills }
}
```

`LobeDraw` 的欄位名以 `archipelago.ts:333` 為準，寫之前對一次；`drawLobes` 若在 `farmland.ts` 或 `archipelago.ts` 已有匯出就直接用，不重寫。

- [ ] **Step 4:** `farmland.ts:74` 的 `HILL_GAP` 改 `export const`。`terrainKind.ts` 加 `'leuna'`（檔頭那段「加一種要動的地方」照樣成立）。
- [ ] **Step 5: 改 `render/terrain.ts`**：把 `createFarmlandTerrain` 抽成

```ts
function createInlandTerrain(
  land: { field: HeightFieldData; hills: IslandDesc[] }, season: Season,
): Terrain { … 原本的內容，createFarmGround(land.field, season)、createFarHorizon(season)、
  createVegetation([...], heightAt, { season })、islands: land.hills … }
function createFarmlandTerrain(): Terrain { return createInlandTerrain(createFarmland(), 'summer') }
function createLeunaTerrain(): Terrain { return createInlandTerrain(createLeuna(), 'lateAutumn') }
```

`createTerrain` 加 `if (kind === 'leuna') return createLeunaTerrain()`。四個子節點的順序不動。

- [ ] **Step 6: `terrain.test.ts`** 加 `describe('leuna')`：前三個位置契約照舊、`islands.length === LEUNA_HILLS.length`、`waterAt` 恆 −Infinity、`heightAt(PLANT_CENTER.x, PLANT_CENTER.z) === 0`。
- [ ] **Step 7:** `tools/daylight.ts:248` 的 `TERRAINS` 與 `tools/blast.ts:375` 加 `leuna`（名稱「洛伊納」）。`ui/menu.ts` 不動。
- [ ] **Step 8:** 跑 `npx vitest run test/unit/leuna.test.ts test/unit/terrain.test.ts test/unit/farmland.test.ts`，綠。變異：把 `LEUNA_HILLS[5]` 的 `cx` 改成 `1500`，第一條要紅；改回。
- [ ] **Step 9: Commit** `feat(world): 洛伊納地形 —— 手擺丘陵、墊面保證平坦、晚秋色盤`

---

### Task 5: 地面目標實體

**Files:**
- Create: `src/world/strikeTarget.ts`
- Create: `src/world/groundTargets.ts`
- Test: `test/unit/ground-targets.test.ts`

**Interfaces:**
- Produces:

```ts
// src/world/strikeTarget.ts
export interface StrikeTarget {
  readonly kind: 'ship' | 'ground'
  readonly index: number
  readonly team: Team
  readonly position: Vector3
  readonly orientation: Quaternion
  readonly speed: number
  readonly hull: readonly Box[]
  readonly impactY: number
  readonly value: number
  readonly alive: boolean
}
```

```ts
// src/world/groundTargets.ts
export type GroundKind = 'hydroTower' | 'chimney' | 'boilerHouse' | 'oilTank' | 'gasHolder' | 'coolingTower'
export interface GroundClass { readonly id: GroundKind; readonly name: string;
  readonly size: { readonly x: number; readonly y: number; readonly z: number };  // 腳印 × 高
  readonly hull: readonly Box[]; readonly radius: number; readonly hp: number }
export interface GroundTarget extends StrikeTarget { readonly kind: 'ground'; readonly cls: GroundClass; hp: number; alive: boolean }
export const GROUND_CLASSES: Readonly<Record<GroundKind, GroundClass>>
export function createGroundTarget(index, cls, team, x, z, heading): GroundTarget
export function resetGroundTarget(t: GroundTarget): void
export function groundTopOf(cls: GroundClass): number   // hull 各盒頂的最大值
```

- [ ] **Step 1: 寫測試**

```ts
// test/unit/ground-targets.test.ts
import { describe, expect, it } from 'vitest'
import { boundingRadius } from '../../src/world/hit'
import {
  GROUND_CLASSES, createGroundTarget, groundTopOf, resetGroundTarget, type GroundKind,
} from '../../src/world/groundTargets'

/** 期望尺寸獨立寫死：腳印 x × z、高 y（m）。命中盒與幾何都對著它比 */
const EXPECTED: Record<GroundKind, [number, number, number]> = {
  hydroTower: [8, 40, 8], chimney: [8, 100, 8], boilerHouse: [60, 18, 30],
  oilTank: [25, 12, 25], gasHolder: [40, 35, 40], coolingTower: [30, 40, 30],
}

describe('地面目標的艦級表', () => {
  for (const [id, [x, y, z]] of Object.entries(EXPECTED) as [GroundKind, [number, number, number]][]) {
    it(`${id}：命中盒的外廓就是期望尺寸、底貼 0、頂 = 高`, () => {
      const cls = GROUND_CLASSES[id]
      expect(cls.size).toEqual({ x, y, z })
      let minY = Infinity, maxY = -Infinity, maxX = 0, maxZ = 0
      for (const b of cls.hull) {
        minY = Math.min(minY, b.center.y - b.half.y); maxY = Math.max(maxY, b.center.y + b.half.y)
        maxX = Math.max(maxX, Math.abs(b.center.x) + b.half.x); maxZ = Math.max(maxZ, Math.abs(b.center.z) + b.half.z)
      }
      expect(minY).toBe(0); expect(maxY).toBeCloseTo(y, 6)
      expect(maxX * 2).toBeCloseTo(x, 6); expect(maxZ * 2).toBeCloseTo(z, 6)
      expect(groundTopOf(cls)).toBeCloseTo(y, 6)
    })
  }
  it('包圍球是上界', () => {
    for (const cls of Object.values(GROUND_CLASSES)) {
      expect(cls.radius).toBeGreaterThanOrEqual(boundingRadius(cls.hull))
    }
  })
  it('血量用幾枚炸彈訂：塔與煙囪一枚，鍋爐房、氣櫃、冷卻塔兩枚', () => {
    expect(GROUND_CLASSES.chimney.hp).toBeLessThanOrEqual(9000)
    expect(GROUND_CLASSES.boilerHouse.hp).toBeGreaterThan(9000)
    expect(GROUND_CLASSES.boilerHouse.hp).toBeLessThanOrEqual(18000)
  })
})

describe('createGroundTarget / reset', () => {
  it('位置 y = 0、朝向由 heading、impactY = 頂、value = 血量、速度 0', () => {
    const t = createGroundTarget(3, GROUND_CLASSES.chimney, 'red', 100, -200, 0.5)
    expect(t.kind).toBe('ground'); expect(t.index).toBe(3); expect(t.team).toBe('red')
    expect(t.position.y).toBe(0); expect(t.speed).toBe(0)
    expect(t.impactY).toBeCloseTo(100, 6); expect(t.value).toBe(t.cls.hp)
    expect(t.hull).toBe(t.cls.hull)
  })
  it('打死再 reset 回滿血、活著', () => {
    const t = createGroundTarget(0, GROUND_CLASSES.oilTank, 'red', 0, 0, 0)
    t.hp = 0; t.alive = false
    resetGroundTarget(t)
    expect(t.hp).toBe(t.cls.hp); expect(t.alive).toBe(true)
  })
})
```

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3: 寫兩個模組**

```ts
// src/world/strikeTarget.ts
import type { Quaternion, Vector3 } from 'three'
import type { Box } from './hit'
import type { Team } from './World'
/**
 * # 打擊目標的視圖
 *
 * AI 的攻擊航路（`ai/strikeRun.ts`）與投放判斷（`ai/bombRun.ts`、
 * `ai/torpedoRun.ts`）只讀這幾格。船與地面目標各自滿足它：地面目標直接
 * 就是（`groundTargets.ts`），船靠 `ai/shipStrikeView.ts` 的視圖物件。
 *
 * 【`orientation` 直接透傳】從 `heading` 用三角函數重算的方向與四元數的
 * 浮點結果不保證逐位元相同，而船那條路的基準是逐位元的。
 *
 * 【`impactY` 是世界高度】落點求解的平面：`position.y + 盒頂`。
 */
export interface StrikeTarget { …如上 }
```

```ts
// src/world/groundTargets.ts
import { Quaternion, Vector3 } from 'three'
import { boundingRadius, type Box } from './hit'
import type { StrikeTarget } from './strikeTarget'
import type { Team } from './World'
/**
 * # 場上的地面目標
 *
 * **不是 `Combatant`，也不是 `Ship`。** 沒有飛行模型、不進記分板、不上
 * 接觸列表（理由同 `ships.ts` 檔頭）；船有沉沒動畫與「`position.y` 恆為
 * 水線」的假設，硬套會把工廠沉進地裡。
 *
 * **這一版只有炸彈認得它。** 子彈與飛機都穿過去 —— 這一關沒有任何路徑會
 * 用到彈丸命中或撞建築。
 *
 * ## 座標系
 * 自身座標：X 橫、Y 上、−Z 前，原點在**地面 × 腳印中心**。
 */
const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

function box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Box {
  return { center: new Vector3(cx, cy, cz), half: new Vector3(hx, hy, hz) }
}
/** 一個由腳印與高度撐起來的盒，底貼 0。圓柱與截錐用外接方盒：保守近似，盒角
 *  比圓面多出一圈，對 30 m 的爆炸半徑不構成差別 */
function block(x: number, y: number, z: number): Box { return box(0, y / 2, 0, x / 2, y / 2, z / 2) }

function cls(id: GroundKind, name: string, x: number, y: number, z: number, hp: number): GroundClass {
  const hull = [block(x, y, z)]
  return { id, name, size: { x, y, z }, hull, radius: boundingRadius(hull) * 1.05, hp }
}

/** 血量用「幾枚炸彈」訂：一枚 9,000、30 m 線性衰減，直擊算滿。起始值 */
export const GROUND_CLASSES: Readonly<Record<GroundKind, GroundClass>> = {
  hydroTower: cls('hydroTower', '氫化塔', 8, 40, 8, 8_000),
  chimney: cls('chimney', '煙囪', 8, 100, 8, 8_000),
  boilerHouse: cls('boilerHouse', '鍋爐房', 60, 18, 30, 16_000),
  oilTank: cls('oilTank', '儲油槽', 25, 12, 25, 6_000),
  gasHolder: cls('gasHolder', '氣櫃', 40, 35, 40, 14_000),
  coolingTower: cls('coolingTower', '冷卻塔', 30, 40, 30, 14_000),
}

export function groundTopOf(c: GroundClass): number {
  let top = 0
  for (const b of c.hull) { const t = b.center.y + b.half.y; if (t > top) top = t }
  return top
}

export function createGroundTarget(
  index: number, cls: GroundClass, team: Team, x: number, z: number, heading: number,
): GroundTarget {
  return {
    kind: 'ground', index, team, cls,
    position: new Vector3(x, 0, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    speed: 0, hull: cls.hull, impactY: groundTopOf(cls), value: cls.hp,
    hp: cls.hp, alive: true,
  }
}

export function resetGroundTarget(t: GroundTarget): void { t.hp = t.cls.hp; t.alive = true }
```

（`position.y` 恆 0 是定義：墊面在結構上是 0，見 `leuna.ts`。）

- [ ] **Step 4:** 跑，綠。變異：把 `chimney` 的 `block` 高度改 90，第一組測試要紅；改回。
- [ ] **Step 5: Commit** `feat(world): 地面目標實體與打擊目標視圖`

---

### Task 6: World 的接線：範圍傷害、擋路、摧毀事件

**Files:**
- Modify: `src/world/World.ts:269`（欄位）、`:342`（事件）、`:349`（`bombGround`）、`:591-598`、`:619-632`、`:648-687`、`:1307-1339`
- Test: `test/unit/bomb-vs-ground.test.ts`

**Interfaces:**
- Produces: `World.groundTargets: GroundTarget[]`、`World.groundDestroyedEvents: ImpactEvents`（`x,y,z` 是構件中心、`nx` 是構件索引、`ny` 是頂高、`nz` 0）、落點事件 `kind = 3`。

- [ ] **Step 1: 寫測試**

```ts
// test/unit/bomb-vs-ground.test.ts
import { describe, expect, it } from 'vitest'
import { World } from '../../src/world/World'
import { GROUND_CLASSES, createGroundTarget } from '../../src/world/groundTargets'
import { IMPACT_STRIDE } from '../../src/world/events'
import { BOMB_BLAST_RADIUS } from '../../src/weapons/bomb'

const DT = 1 / 240
function world(): World {
  const w = new World()
  w.groundAt = () => 0
  w.waterAt = () => -Infinity
  return w
}
/** 讓一顆炸彈落到 (x, z)。從 y0 靜止放下，直到落點事件出現 */
function drop(w: World, x: number, z: number, y0 = 300, damage = 9000): void {
  w.bombs.spawn(x, y0, z, 0, 0, 0, damage, 'blue')
  for (let i = 0; i < 240 * 30 && w.bombEvents.count === 0; i++) w.step(DT)
}

describe('炸彈對地面目標', () => {
  it('零船一座煙囪：從正上方投的炸彈在煙囪頂引爆，落點事件 kind = 3', () => {
    const w = world()
    w.groundTargets.push(createGroundTarget(0, GROUND_CLASSES.chimney, 'red', 0, 0, 0))
    drop(w, 0, 0)
    expect(w.bombEvents.count).toBe(1)
    const d = w.bombEvents.data
    expect(d[1]).toBeCloseTo(100, 0)     // 煙囪頂
    expect(d[3]).toBe(3)
    expect(w.groundTargets[0]!.hp).toBeLessThan(GROUND_CLASSES.chimney.hp)
  })
  it('直擊扣滿並摧毀；摧毀事件恰好一筆，落點事件也恰好一筆', () => {
    const w = world()
    const t = createGroundTarget(0, GROUND_CLASSES.oilTank, 'red', 50, 50, 0)
    w.groundTargets.push(t)
    drop(w, 50, 50)
    expect(t.alive).toBe(false)
    expect(w.groundDestroyedEvents.count).toBe(1)
    expect(w.groundDestroyedEvents.data[3]).toBe(0)
    expect(w.bombEvents.count).toBe(1)
    w.step(DT)
    // 【只推一次】下一步不會再推
    expect(w.groundDestroyedEvents.count).toBe(0)
  })
  it('半徑外為 0；兩座相鄰只有近的那一座扣血', () => {
    const w = world()
    const near = createGroundTarget(0, GROUND_CLASSES.hydroTower, 'red', 0, 0, 0)
    const far = createGroundTarget(1, GROUND_CLASSES.hydroTower, 'red', BOMB_BLAST_RADIUS + 60, 0, 0)
    w.groundTargets.push(near, far)
    drop(w, 12, 0)
    expect(near.hp).toBeLessThan(near.cls.hp)
    expect(far.hp).toBe(far.cls.hp)
  })
  it('死了的目標不再擋路，也不再扣血', () => {
    const w = world()
    const t = createGroundTarget(0, GROUND_CLASSES.chimney, 'red', 0, 0, 0)
    w.groundTargets.push(t)
    t.hp = 0; t.alive = false
    drop(w, 0, 0)
    expect(w.bombEvents.data[3]).toBe(0)
    expect(w.bombEvents.data[1]).toBeCloseTo(0, 0)
  })
})
```

`World` 的建構子簽名與 `step` 的名字以 `World.ts` 為準；若 `step` 需要先有 combatant，改用 `world.stepBombs` 之類的內部入口或加一架 IDLE 機 —— 執行時看。

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3: 改 `World.ts`**
  1. 欄位：`readonly groundTargets: GroundTarget[] = []`（緊接 `ships` 之後）；`readonly groundDestroyedEvents: ImpactEvents = createImpacts()`；`private bombGround: GroundTarget | null = null`（`bombShip` 旁）。
  2. `:597`：`this.ships.length > 0 || this.groundTargets.length > 0 ? this.onBombBlocked : undefined`。
  3. `onBombImpact`：`const hitShip = blocked && this.bombShip !== null; const hitGround = blocked && this.bombGround !== null; const kind = hitShip ? 2 : hitGround ? 3 : this.waterAt(x, z) > -Infinity ? 1 : 0`；第六格船給 `bombShip.index`，建築給 `bombGround.index`，否則 −1。**注意 `applyBombBlast` 排在最前面，摧毀事件在那裡推。**
  4. `applyBombBlast` 在船的迴圈之後加：

```ts
    for (let i = 0; i < this.groundTargets.length; i++) {
      const t = this.groundTargets[i]!
      if (!t.alive) continue
      const reach = t.cls.radius + radius
      if (t.position.distanceToSquared(BLAST_P.set(x, y, z)) > reach * reach) continue
      SHIP_INV.copy(t.orientation).conjugate()
      const local = BLAST_P.set(x, y, z).sub(t.position).applyQuaternion(SHIP_INV)
      let near = Infinity
      for (const box of t.hull) {
        const d = pointBoxDistance(local.x, local.y, local.z, box)
        if (d < near) near = d
      }
      const dmg = bombBlastDamage(near, damage)
      if (dmg <= 0) continue
      t.hp -= dmg
      if (t.hp <= 0) {
        t.alive = false
        // 【摧毀事件與落點事件分開】每一顆炸彈恰好一筆落點；建築由活變死
        // 的這一步另推一筆，只推一次 —— 合在一起的話直擊剛好炸毀時同一個
        // 爆點推兩次，火球、碎片、煙全部加倍
        pushImpact(this.groundDestroyedEvents, t.position.x, t.position.y, t.position.z,
          t.index, t.impactY, 0)
      }
    }
```

  5. `onBombBlocked`：開頭 `this.bombShip = null; this.bombGround = null; if (this.ships.length === 0 && this.groundTargets.length === 0) return NO_HIT`。船的迴圈之後加地面目標的迴圈（同形狀：包圍球粗篩 → 轉自身座標 → `segmentBox` 對 `t.hull`，`t < best` 才取，取到就 `this.bombGround = t; this.bombShip = null`）。**死了的建築不擋**（`if (!t.alive) continue` —— 與船「沉了照樣擋」不同，殘骸矮一截，理由寫在註解）。
  6. 找出 `bombEvents` 每步在哪裡 `clearImpacts`（`World.step` 開頭或 `main.ts` 消費後），`groundDestroyedEvents` 照同一個位置排空。

- [ ] **Step 4:** 跑 `npx vitest run test/unit/bomb-vs-ground.test.ts test/unit/bomb-vs-ship.test.ts test/unit/world*.test.ts test/unit/strike-replay-baseline.test.ts`，綠，基準雜湊不變。變異：把 `:597` 的閘改回只看 `ships`，第一條要紅；改回。
- [ ] **Step 5: Commit** `feat(world): 炸彈認得地面目標 —— 範圍傷害、擋路、摧毀事件`

---

### Task 7: `destroy` 規則、任務卡型別、放置與計數

**Files:**
- Modify: `src/battle/mission.ts:21-98`（加成員）、`:149-207`（兩格）、`:342-343`、`:387-400`（新分支）
- Modify: `src/battle/missions.ts:188-319`（`ground?`、`destroyCount?`）、`:327-357`（`MissionGround`／`GroundEntry`）、`:866`（規則）、`:959`（透傳）
- Modify: `src/battle/setup.ts:103`（`BattleConfig.ground?`）、`:890`（`placeGround`）、`:942`（新函數）、`:1380-1391`、`:1539-1555`、`:1596-1598`
- Test: `test/unit/mission.test.ts`、`test/unit/campaigns.test.ts`、`test/unit/battle-setup.test.ts`

**Interfaces:**
- Produces:
  - `MissionRules` 加 `{ kind: 'destroy'; count: number }`
  - `MissionInputs.targetsDestroyed`、`.targetsTotal`
  - `interface MissionGround { center: Vector3; heading: number; entries: readonly GroundEntry[] }`、`interface GroundEntry { kind: GroundKind; team: Team; offset: Vector3; heading: number }`
  - `MissionBattle.ground?: MissionGround`、`.destroyCount?: number`
  - `BattleConfig.ground?: MissionGround`

- [ ] **Step 1: 規則測試**（複製 `mission.test.ts:304` 的整個 `describe('stepMission：擊沉')`，改名「炸毀」、`shipsSunk`→`targetsDestroyed`、`{ kind: 'sink', count: 4 }`→`{ kind: 'destroy', count: 6 }`），另加：

```ts
it('玩家陣亡但僚機還在不判敗（與 sink 相同：藍隊全滅才敗）', () => {
  const st = createMissionState({ kind: 'destroy', count: 6 })
  const inp = { ...BASE, aliveBlue: 3, playerAlive: false, targetsDestroyed: 2, targetsTotal: 12 }
  stepMission({ kind: 'destroy', count: 6 }, inp, 1 / 240, st)
  expect(st.outcome).toBe('fighting')
})
it('重設之後 metric 是 6 不是 0', () => {
  const st = createMissionState({ kind: 'annihilate' })
  resetMissionState({ kind: 'destroy', count: 6 }, st)
  expect(st.metric).toBe(6); expect(st.metricTotal).toBe(6)
})
```

（`BASE` 是那個檔案既有的 `MissionInputs` 樣板，兩格要補進去。）

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3: 改 `mission.ts`**：`MissionRules` 加成員（放在 `sink` 之後，附註解「炸毀 N 座敵方地面目標」）；`MissionInputs` 加兩格（註解：只算敵方，理由同船）；`resetMissionState` 兩行改成 `rules.kind === 'sink' || rules.kind === 'destroy'`；`stepMission` 加分支（逐行抄 `sink`）。
- [ ] **Step 4: 改 `missions.ts`**：型別、`missionRules` 在 `sink` 之後加 `if (b.destroyCount !== undefined) return { kind: 'destroy', count: b.destroyCount }`；`missionConfigFrom` 在 `fleet` 那行旁加 `...(b.ground === undefined ? {} : { ground: b.ground })`。
- [ ] **Step 5: 改 `setup.ts`**：`BattleConfig.ground?: MissionGround`；

```ts
function placeGround(world: World, ground: MissionGround | undefined): void {
  if (ground === undefined) return
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ground.heading)
  const p = new Vector3()
  for (const e of ground.entries) {
    p.copy(e.offset).applyQuaternion(q).add(ground.center)
    // 【高度是 0，寫死】建構期地形還沒注入 World，讀 groundAt 拿到的是預設
    // 平面；墊面在結構上保證是 0（leuna.ts），所以這是定義不是查詢
    world.groundTargets.push(createGroundTarget(
      world.groundTargets.length, GROUND_CLASSES[e.kind], e.team, p.x, p.z, ground.heading + e.heading,
    ))
  }
}
```

`:890` 旁 `placeGround(world, cfg.ground)`；`MISSION_INPUTS` 加 `targetsDestroyed: 0, targetsTotal: 0`；每步填值在船的迴圈後加：

```ts
  inp.targetsDestroyed = 0
  inp.targetsTotal = 0
  for (const t of b.world.groundTargets) {
    if (t.team === 'blue') continue
    inp.targetsTotal++
    if (!t.alive) inp.targetsDestroyed++
  }
```

`resetBattle` 的船迴圈旁 `for (const t of b.world.groundTargets) resetGroundTarget(t)`。

- [ ] **Step 6: campaigns 測試**：`:36` 改「八張打得起來，四張是目錄卡」（清單加 `allies-m2`，差 4）；`:90` 改 4；`describe('擊沉任務')` 旁加 `describe('炸毀任務')`：有 `destroyCount` 就要有 `ground` 且敵方構件數 `≥ destroyCount`；沒有 `ground` 的卡沒有 `destroyCount`；`sinkCount` 與 `destroyCount` 不共存。**這一步 `allies-m2` 還是目錄卡，所以 `:36` 的修改留到 Task 10 一起改**；先只加 describe。
- [ ] **Step 7: battle-setup 測試** 加一條：`createBattle` 收到一個含兩座構件的 `ground` 後 `world.groundTargets.length === 2`、位置是中心加旋轉後的偏移、`resetBattle` 後被打死的構件回滿血。
- [ ] **Step 8:** 跑 `npx vitest run test/unit/mission.test.ts test/unit/campaigns.test.ts test/unit/battle-setup.test.ts test/unit/hud-objective.test.ts`，綠。
- [ ] **Step 9: Commit** `feat(battle): 炸毀 N 座的規則、任務卡的廠區欄位、放置與計數`

---

### Task 8: AI 攻擊航路吃打擊目標視圖

**Files:**
- Create: `src/ai/shipStrikeView.ts`
- Modify: `src/ai/bombRun.ts:95-104`、`:115-125`、`:142-145`、`:171-188`、`:285-311`、`:313-315`、`:382-405`
- Modify: `src/ai/torpedoRun.ts:115`、`:167-181`、`:401`、`:422`、`:444-456`
- Modify: `src/ai/strikeRun.ts:7`、`:95-97`、`:124-125`、`:195-200`
- Modify: `src/ai/shipAttack.ts`（加 `pickGroundTarget`）
- Modify: `src/ai/AiController.ts:120`（`groundTargets`）、`:179-238`、`:253-260`
- Modify: `src/main.ts:163`（`wireTerrain`）、`test/integration/ai-bombing-mission.test.ts:41-53`、`test/unit/strike-replay-baseline.test.ts`
- Test: `test/unit/ai-strike-target.test.ts`（新）

**Interfaces:**
- Produces:
  - `class ShipStrikeView implements StrikeTarget { ship: Ship | null; set(ship, index) }`（getter 讀原物件；一架 AI 一個，組場時建）
  - `interface StrikeRef { kind: 'ship' | 'ground'; index: number }`；`AiController.strikeRef`、`AiController.groundTargets: readonly GroundTarget[]`
  - `bombRun.ts`：`releaseWindowOf(hull: readonly Box[], hulls?)`、`insideWindow(target: StrikeTarget, ex, ez, hulls?)`、`shipAt(target, t, out)`、`shouldRelease(self, target, k, dt)`、`stepBombAim(state, self, target, loaded, decide)`
  - `torpedoRun.ts`：`hitWindowOf(hull: readonly Box[])`、`shouldRelease(self, target)`
  - `strikeRun.ts`：`StrikeProfile.plan(self, target: StrikeTarget, out)`、`shouldRelease(self, target)`、`stepStrike(state, self, target, targetIndex, …)`
  - `shipAttack.ts`：`pickGroundTarget(selfPos, selfTeam, targets, range): number`（價值優先、距離次之，回索引或 −1）

- [ ] **Step 1: 寫視圖與選目標測試**

```ts
// test/unit/ai-strike-target.test.ts
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { ShipStrikeView } from '../../src/ai/shipStrikeView'
import { pickGroundTarget, SHIP_ATTACK_RANGE } from '../../src/ai/shipAttack'
import { SHIP_CLASSES, createShip, deckHeightOf } from '../../src/world/ships'
import { GROUND_CLASSES, createGroundTarget } from '../../src/world/groundTargets'
import { insideWindow, shipAt, releaseWindowOf } from '../../src/ai/bombRun'

describe('船的打擊視圖', () => {
  it('讀的是原物件：速度與存活跟著船變', () => {
    const s = createShip(2, SHIP_CLASSES.fletcher, 'red', 100, 200, 0.3, 8)
    const v = new ShipStrikeView()
    v.set(s, 2)
    expect(v.kind).toBe('ship'); expect(v.index).toBe(2)
    expect(v.position).toBe(s.position); expect(v.orientation).toBe(s.orientation)
    expect(v.impactY).toBe(deckHeightOf(s.cls)); expect(v.value).toBe(s.cls.hp)
    s.speed = 3; s.alive = false
    expect(v.speed).toBe(3); expect(v.alive).toBe(false)
  })
  it('地面目標的 shipAt 是常數、窗用第一個盒', () => {
    const t = createGroundTarget(0, GROUND_CLASSES.boilerHouse, 'red', 10, 20, 0)
    const out = new Vector3()
    expect(shipAt(t, 14, out)).toEqual(t.position)
    expect(releaseWindowOf(t.hull)).toEqual({ along: 15 * 1.5, across: 30 * 1.5 })
    expect(insideWindow(t, 5, 5)).toBe(true)
    expect(insideWindow(t, 60, 0)).toBe(false)
  })
})

describe('pickGroundTarget', () => {
  const me = new Vector3(0, 4000, 5000)
  it('價值優先、同價值比距離、跳過死的與同隊', () => {
    const list = [
      createGroundTarget(0, GROUND_CLASSES.oilTank, 'red', 0, -100, 0),
      createGroundTarget(1, GROUND_CLASSES.boilerHouse, 'red', 0, -300, 0),
      createGroundTarget(2, GROUND_CLASSES.boilerHouse, 'red', 0, -200, 0),
      createGroundTarget(3, GROUND_CLASSES.boilerHouse, 'blue', 0, 0, 0),
    ]
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(2)
    list[2]!.alive = false
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(1)
  })
  it('超出接戰半徑回 −1', () => {
    const list = [createGroundTarget(0, GROUND_CLASSES.oilTank, 'red', 0, -20000, 0)]
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(-1)
  })
})
```

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3: 寫 `shipStrikeView.ts`**

```ts
import type { Quaternion, Vector3 } from 'three'
import type { Box } from '../world/hit'
import { deckHeightOf, type Ship } from '../world/ships'
import type { StrikeTarget } from '../world/strikeTarget'
import type { Team } from '../world/World'
/**
 * 把一艘船當成打擊目標看。**一架 AI 一個，組場時建，之後只換指向** ——
 * 熱路徑不配置。getter 讀原物件，決策拍之間船沉了、慢了都看得到。
 */
export class ShipStrikeView implements StrikeTarget {
  readonly kind = 'ship' as const
  index = -1
  private ship: Ship | null = null
  set(ship: Ship, index: number): void { this.ship = ship; this.index = index }
  private get s(): Ship { if (this.ship === null) throw new Error('視圖還沒指向任何一艘船'); return this.ship }
  get team(): Team { return this.s.team }
  get position(): Vector3 { return this.s.position }
  get orientation(): Quaternion { return this.s.orientation }
  get speed(): number { return this.s.speed }
  get hull(): readonly Box[] { return this.s.cls.hull }
  get impactY(): number { return deckHeightOf(this.s.cls) }
  get value(): number { return this.s.cls.hp }
  get alive(): boolean { return this.s.alive }
}
```

- [ ] **Step 4: 改 `bombRun.ts`**：五支簽名改 `StrikeTarget`／`hull`；`deckY = deckHeightOf(ship.cls)` 三處改 `deckY = target.impactY`；`ship.cls.hull[0]` 改 `target.hull[0]`；`import type { Ship, ShipClass }` 拿掉。
- [ ] **Step 5: 改 `torpedoRun.ts`**：`hitWindowOf(hull)`、`solve(self, target)`、`shouldRelease(self, target)`、`diagnose(self, target)` 同樣改；`ship.cls` → `target.hull`。
- [ ] **Step 6: 改 `strikeRun.ts`**：`import type { StrikeTarget }`；`plan`／`shouldRelease`／`stepStrike` 的參數型別；`StrikeState.ship` 改名 `target`（註解：直飛段鎖定的目標索引，中途不換）；`stepStrike` 的 `shipIndex` 改 `targetIndex`。
- [ ] **Step 7: `shipAttack.ts` 加**

```ts
/** 地面目標的挑法與 `pickShipTarget` 同一條規則：價值優先、同價值比距離。沒有砲位 */
export function pickGroundTarget(
  selfPos: Vector3, selfTeam: Team, targets: readonly GroundTarget[], range: number,
): number {
  let best = -1, bestValue = -1, bestSq = Infinity
  const rangeSq = range * range
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!
    if (!t.alive || t.team === selfTeam) continue
    if (t.value < bestValue) continue
    const d = selfPos.distanceToSquared(t.position)
    if (d > rangeSq) continue
    if (t.value === bestValue && d >= bestSq) continue
    best = i; bestValue = t.value; bestSq = d
  }
  return best
}
```

- [ ] **Step 8: 改 `AiController.ts`**：
  - 欄位：`groundTargets: readonly GroundTarget[] = []`、`readonly strikeRef: StrikeRef = { kind: 'ship', index: -1 }`、`private readonly shipView = new ShipStrikeView()`。
  - `attackShip`：早退改 `if (this.ships.length === 0 && this.groundTargets.length === 0)`；戰鬥機（`role === 'fighter'`）那條路完全不動（仍用 `pickShipTarget` + `shipAim` + `shipAttackCommand` + `stepBombAim(…, this.shipView 指向那艘船 …)`）；轟炸機那條路改成：

```ts
    if (decide) {
      pickShipTarget(self.state.position, me.team, this.ships, this.shipAim)
      const g = pickGroundTarget(self.state.position, me.team, this.groundTargets, SHIP_ATTACK_RANGE)
      // 【先船後地面，只有地面更值錢才換】沒有地面目標時與原本逐位元相同
      const sv = this.shipAim.ship >= 0 ? this.ships[this.shipAim.ship]!.cls.hp : -1
      const gv = g >= 0 ? this.groundTargets[g]!.value : -1
      if (g >= 0 && gv > sv) { this.strikeRef.kind = 'ground'; this.strikeRef.index = g }
      else { this.strikeRef.kind = 'ship'; this.strikeRef.index = this.shipAim.ship }
    }
    const target = this.resolveStrike()
    if (target === null) return false
    … stepStrike(this.strike, self, target, this.strikeRef.index, …)
```

  `resolveStrike()`：依 `strikeRef` 取 `this.groundTargets[i]` 或 `this.shipView.set(ships[i], i)`，死了或超界就把 `index = -1` 回 `null`。
  - `clearTerrainState` 加 `this.strikeRef.index = -1`。

- [ ] **Step 9: 接線**：`main.ts` 的 `wireTerrain` 加 `ctl.groundTargets = world.groundTargets`（`playerAi` 也給空陣列或同一份）；`test/integration/ai-bombing-mission.test.ts` 的 `wire` 加同一行；Task 1 的基準測試把 `groundTargets` 與 `strikeRef` 那兩行換回來。
- [ ] **Step 10:** 跑 `npx vitest run test/unit/ai-strike-target.test.ts test/unit/ai-bombing.test.ts test/unit/ai-torpedo*.test.ts test/unit/strike-replay-baseline.test.ts test/integration/ai-bombing-mission.test.ts test/integration/replay-determinism.test.ts`。**基準雜湊必須不變**，否則就是船那條路被改到了 —— 找出哪一行（最可疑：`insideWindow` 的方向、`impactY`、tie-break）。
- [ ] **Step 11: Commit** `refactor(ai): 攻擊航路吃打擊目標視圖，船那條路逐位元不變`

---

### Task 9: 構件幾何、地面模型、火點、HUD 標記、main.ts 生命週期

**Files:**
- Create: `src/render/geometry/plant/parts.ts`、`src/render/geometry/plant/index.ts`
- Create: `src/render/plant.ts`、`src/render/groundFires.ts`
- Modify: `src/render/shipFires.ts:106-126`（只認 `kind === 2`）
- Modify: `src/hud/markerFeed.ts:56-88`
- Modify: `src/main.ts:598-614`、`:703-707`、`:1049-1059`、`:1438-1448`、`:1649`、`:1969-1973`
- Test: `test/unit/plant-geometry.test.ts`、`test/unit/hud-marker-feed.test.ts`、`test/unit/bomb-bay-wiring.test.ts`、`test/unit/ship-fires.test.ts`

**Interfaces:**
- Produces:
  - `buildPlantGeometry(kind: GroundKind, ruined = false): BufferGeometry`（頂點色、平面著色、底貼 y = 0；殘骸高度 25%、深色）
  - `createPlantModels(targets: readonly GroundTarget[]): { object: Group; update(targets): void; dispose(): void }`（`update` 看到 `alive` 變假就換殘骸）
  - `createGroundFires(capacity = 32): GroundFires`、`lightGroundFire(f, x, y, z)`、`stepGroundFires(f, dt, puff: FirePuffFn)`、`reset()`
  - `fillMarkers(f, ships, groundTargets, pools, own, project, shipTop)`（新參數插在 `ships` 之後）

- [ ] **Step 1: 幾何測試**

```ts
// test/unit/plant-geometry.test.ts
import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { buildPlantGeometry } from '../../src/render/geometry/plant'
import { GROUND_CLASSES, type GroundKind } from '../../src/world/groundTargets'

const KINDS: GroundKind[] = ['hydroTower', 'chimney', 'boilerHouse', 'oilTank', 'gasHolder', 'coolingTower']
/** 期望尺寸獨立寫死（與 ground-targets.test.ts 同一份） */
const EXPECTED: Record<GroundKind, [number, number, number]> = {
  hydroTower: [8, 40, 8], chimney: [8, 100, 8], boilerHouse: [60, 18, 30],
  oilTank: [25, 12, 25], gasHolder: [40, 35, 40], coolingTower: [30, 40, 30],
}

describe('構件的幾何', () => {
  for (const k of KINDS) {
    it(`${k}：底貼 0、外廓與期望尺寸差 < 5%、在命中盒之內、有頂點色、無共用頂點`, () => {
      const g = buildPlantGeometry(k)
      const bb = new Box3().setFromBufferAttribute(g.getAttribute('position') as never)
      const size = bb.getSize(new Vector3())
      const [x, y, z] = EXPECTED[k]
      expect(bb.min.y).toBeCloseTo(0, 6)
      expect(Math.abs(size.x - x) / x).toBeLessThan(0.05)
      expect(Math.abs(size.y - y) / y).toBeLessThan(0.05)
      expect(Math.abs(size.z - z) / z).toBeLessThan(0.05)
      const hull = GROUND_CLASSES[k].hull[0]!
      expect(bb.max.x).toBeLessThanOrEqual(hull.center.x + hull.half.x + 1e-6)
      expect(bb.max.y).toBeLessThanOrEqual(hull.center.y + hull.half.y + 1e-6)
      expect(g.getAttribute('color')).toBeDefined()
      expect(g.index).toBeNull()
      const ruined = buildPlantGeometry(k, true)
      const rb = new Box3().setFromBufferAttribute(ruined.getAttribute('position') as never)
      expect(rb.max.y).toBeLessThan(y * 0.3)
    })
  }
})
```

- [ ] **Step 2:** 跑，紅。
- [ ] **Step 3: 寫 `parts.ts`**（三角形湯，照 `floraShapes.ts` 的 `Soup`／`build` 形狀）：`box(s, color, x0, x1, y0, y1, z0, z1)`、`cylinder(s, color, sides, r, y0, y1)`、`frustum(s, color, sides, r0, r1, y0, y1)`（底半徑 r0、頂半徑 r1，`r0 === r1` 就是圓柱）、`build(fn): BufferGeometry`（`position` + `color`，`computeVertexNormals`，不用索引）。
- [ ] **Step 4: 寫 `index.ts`**

```ts
const HUE = { steel: 0x6e6f6a, brick: 0x6b4a3c, tank: 0x8a8a80, concrete: 0x9a978c, roof: 0x4a4d4a, ruin: 0x2e2a26 }
export function buildPlantGeometry(kind: GroundKind, ruined = false): BufferGeometry {
  const { x, y, z } = GROUND_CLASSES[kind].size
  if (ruined) {
    // 殘骸：矮一截的深色塊，腳印不變 —— 命中盒已經不再擋路，殘骸只是視覺
    return build((s) => box(s, HUE.ruin, -x / 2, x / 2, 0, y * 0.25, -z / 2, z / 2))
  }
  switch (kind) {
    case 'hydroTower': return build((s) => { frustum(s, HUE.steel, 12, x / 2, x / 2, 0, y); … })
    case 'chimney': return build((s) => frustum(s, HUE.brick, 12, x / 2, x / 2 * 0.7, 0, y))
    case 'boilerHouse': return build((s) => { box(s, HUE.brick, -x/2, x/2, 0, y*0.8, -z/2, z/2); /* 人字頂 */ … })
    case 'oilTank': return build((s) => frustum(s, HUE.tank, 16, x / 2, x / 2, 0, y))
    case 'gasHolder': return build((s) => frustum(s, HUE.steel, 16, x / 2, x / 2, 0, y))
    case 'coolingTower': return build((s) => frustum(s, HUE.concrete, 16, x / 2, x / 2 * 0.7, 0, y))
  }
}
```

（煙囪與冷卻塔頂窄，外廓寬度由底決定，仍在期望尺寸 5% 內。）

- [ ] **Step 5: 寫 `render/plant.ts`**：一座一個 `Mesh(buildPlantGeometry(kind), material)`，材質 `MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })` 共用一份；`update(targets)` 對 `wasAlive[i] && !t.alive` 的座把 `mesh.geometry` 換成殘骸幾何（殘骸幾何依 kind 快取、建一次）；`dispose` 釋放所有幾何與材質。
- [ ] **Step 6: 寫 `groundFires.ts`**：與 `shipFires.ts` 同一套計時器（`left`、`puff`、`FIRE_SECONDS`、`FIRE_PUFF` 直接 import 那邊的常數），但座標是世界座標、沒有 `ship` 欄位；`reset()`。
- [ ] **Step 7: `shipFires.ts:117`**：`if (index < 0 || d[o + 3] !== 2) continue`（註解：只認打中船的那幾筆，建築的索引會被當成船的索引）。`ship-fires.test.ts` 加一條「kind = 3 的事件不點船火」。
- [ ] **Step 8: `markerFeed.ts`**：簽名加 `groundTargets: readonly GroundTarget[]`，船的迴圈之後：

```ts
  for (const t of groundTargets) {
    if (!t.alive) continue
    if (n >= HUD_MAX_MARKERS) break
    // 【高度用盒頂】建築沒有桅杆，命中盒的頂就是模型的頂
    n = put(f, n, t.position.x, t.impactY, t.position.z, teamSlot(t.team), own, project)
  }
```

`hud-marker-feed.test.ts` 既有呼叫補一個 `[]`；加三條：地面目標進池、敵對紅、摧毀後消失且不連累後面。`bomb-bay-wiring.test.ts` 加一條 `only('fillMarkers(')` 那一行含 `world.groundTargets`。

- [ ] **Step 9: `main.ts`**：
  - `emitBombBlasts`：`const recipe = kind > 2.5 ? AIR_BLAST : kind > 1.5 ? AIR_BLAST : …`（顯式；註解「3 = 建築，用船命中那一套」）。
  - 新增 `emitGroundDestroyed(events)`：對每一筆用 `AIR_BLAST` 放大 1.5 倍在 `(x, y + ny * 0.5, z)` 炸一次、`debris.burst`、`lightGroundFire(groundFires, x, y + ny * 0.3, z)`；讀完 `clearImpacts`。
  - `groundFires = createGroundFires()` 加進 `POOLS`；每幀 `stepGroundFires(groundFires, frameSeconds, emitFirePuff)` 緊接 `stepShipFires`。
  - `:1049-1059` 旁：`plantModels` 照 `shipModels` 每一場 remove／dispose／重建（`world.groundTargets.length > 0` 才建）；每幀 `plantModels?.update(world.groundTargets)`。
  - `wireTerrain` 已在 Task 8 加。
  - `fillMarkers(hudFrame, world.ships, world.groundTargets, MARKER_POOLS, …)`。
  - 預定砲位：`plantModels` 建的時候若 `terrainKind === 'leuna'`，加 `FLAK_SITES` 的 8 個 `BoxGeometry(6, 3, 6)` 深灰方塊（`y = 1.5`），隨模型一起 dispose。
- [ ] **Step 10:** 跑 `npx vitest run test/unit/plant-geometry.test.ts test/unit/hud-marker-feed.test.ts test/unit/bomb-bay-wiring.test.ts test/unit/ship-fires.test.ts`，綠。`npx tsc --noEmit` 行數比基準。
- [ ] **Step 11: Commit** `feat(render): 油廠構件的幾何、殘骸與火點、HUD 標記地面目標`

---

### Task 10: 卡片內容與整合護欄

**Files:**
- Modify: `src/battle/missions.ts:558-563`
- Modify: `test/unit/campaigns.test.ts:36-42`、`:90`
- Create: `test/integration/ai-bombing-leuna.test.ts`
- Modify: `test/unit/mission-config-baseline.test.ts`（重產基準）

- [ ] **Step 1: 整合測試**

```ts
// test/integration/ai-bombing-leuna.test.ts
import { beforeAll, describe, expect, it } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import { PLANT_CENTER, PLANT_PAD } from '../../src/world/leuna'
import type { Controller } from '../../src/aircraft/Controller'

const card = MISSIONS.allies.find((c) => c.id === 'allies-m2') as ReadyMissionCard
const IDLE: Controller = { update() {} }
const DT = 1 / 240

function wire(b: Battle): void { …與 ai-bombing-mission.test.ts 相同，含 groundTargets… }

describe('盟 M2：三架 AI B-17 真的炸得到廠區', () => {
  let b: Battle
  const loadBefore: number[] = []
  const impacts: { x: number; z: number }[] = []
  beforeAll(() => {
    b = createBattle(IDLE, missionConfigFrom(card), 1234)
    // 玩家席位不動：它是第一架藍機，AI 是另外三架
    for (const c of b.world.combatants) if (c.team === 'blue' && c.bombBay) loadBefore.push(c.bombBay.load)
    for (let i = 0; i < 240 * 240; i++) {
      wire(b); stepBattle(b, DT)
      const d = b.world.bombEvents.data
      for (let e = 0; e < b.world.bombEvents.count; e++) impacts.push({ x: d[e * 6]!, z: d[e * 6 + 2]! })
    }
  }, 300_000)

  it('三架 AI 的彈艙各自都減少了', () => {
    const ai = b.world.combatants.filter((c) => c.team === 'blue' && c.controller instanceof AiController)
    expect(ai).toHaveLength(3)
    for (const c of ai) expect(c.bombBay!.load + c.bombBay!.queue, `#${c.index}`).toBeLessThan(10)
  })
  it('至少一枚落在墊面內', () => {
    const inPad = impacts.filter((p) =>
      Math.abs(p.x - PLANT_CENTER.x) <= PLANT_PAD.halfX && Math.abs(p.z - PLANT_CENTER.z) <= PLANT_PAD.halfZ)
    expect(inPad.length).toBeGreaterThan(0)
  })
  it('至少一座構件掉血', () => {
    expect(b.world.groundTargets.some((t) => t.hp < t.cls.hp)).toBe(true)
  })
  it('第二批 Bf 109 生在藍隊後方、機首朝 −Z', () => {
    const late = b.world.combatants.filter((c) => c.team === 'red').slice(4)
    expect(late.length).toBeGreaterThanOrEqual(4)
    // 出生點記錄在 aircraft.state 的初值：看 spawn 的 z 大於藍隊開局 z
    …（依 `Combatant` 有沒有 spawn 欄位決定量法；沒有的話在 91 秒那一步讀位置）
  })
})
```

- [ ] **Step 2:** 跑，紅（卡片還是 `null`）。
- [ ] **Step 3: 改卡片**

```ts
    {
      id: 'allies-m2', title: '梅澤堡的油廠', type: '打擊',
      summary: '駕駛第八航空軍的 B-17G 轟炸洛伊納合成油廠，穿過德國空軍那年秋天最大的一次攔截。',
      place: '德國中部　梅澤堡—洛伊納', period: '1944 年 11 月',
      battle: {
        objective: '炸毀洛伊納油廠',
        blueSpec: B17G, redSpec: BF109K4, convoySpec: null,
        // 【四架同一個小隊】玩家是小隊長，三架 AI 照自己的攻擊航路投
        blueCount: 4, redCount: 4,
        convoyCount: 0, convoyPriority: 1,
        targetDistance: 0, targetRadius: 0, seconds: Infinity,
        entry: 'headOn',
        terrain: 'leuna',
        timeOfDay: 'novemberNoon',
        ground: LEUNA_PLANT,
        destroyCount: 6,
        waves: [{
          when: { kind: 'clock', at: 90 },
          warn: '警告：敵機從後方接近',
          warnLead: 5,
          side: 'theirs', spec: BF109K4, count: 4,
          // 【從後方】省略的話沿用紅方的正面進場，會生在前方反向飛來
          starboard: Math.PI,
        }],
      },
    },
```

`LEUNA_PLANT` 在 `missions.ts` 頂部由 `PLANT_LAYOUT` 組出來：

```ts
const LEUNA_PLANT: MissionGround = {
  center: PLANT_CENTER, heading: PLANT_HEADING,
  entries: PLANT_LAYOUT.map((p) => ({ kind: p.kind, team: 'red', offset: new Vector3(p.dx, 0, p.dz), heading: p.heading })),
}
```

`starboard` 對波次的語意以 `missions.ts:1016-1046` 與 `order.ts:444-457` 為準；若「後方」要的是別的欄位（`along`），照那裡改，測試量的是結果。

- [ ] **Step 4:** `campaigns.test.ts:36` 改八張／四張、清單加 `allies-m2`；`:90` 改 4。重跑 `npx vitest run test/tools/mission-config-baseline.probe.ts` 重產 `mission-config-baseline` 的基準（依那支探針檔頭的說明）。
- [ ] **Step 5:** 跑 `npx vitest run test/unit/campaigns.test.ts test/unit/mission-config-baseline.test.ts test/integration/ai-bombing-leuna.test.ts`。若三架 AI 不投：先跑 `test/tools/bomb-run-trace.probe.ts` 改成這張卡看是卡在 `approach`（距離 > lockRange？）還是 `shouldRelease`。
- [ ] **Step 6: Commit** `feat(battle): 盟 M2 梅澤堡的油廠 —— 卡片、廠區、兩批攔截`

---

### Task 11: daylight 展示區

**Files:**
- Modify: `src/tools/daylight.ts:37-50`、`:53-62`、`:78-82`、`:246-267`、`:296-297`

- [ ] **Step 1:** `setTerrain(kind)`：切到 `leuna` 時 `selectTod('novemberNoon')`；`plane.group.position.y = kind === 'leuna' ? 4000 : kind === 'farmland' ? 420 : 60`；`placeCamera` 加 leuna 分支：`camera.set(0, 4600, -2500)`、`target.set(0, 0, -7000)`（廠區上空看投彈航路）；`shipModels.object.visible = kind === 'sea' || kind === 'archipelago'`。
- [ ] **Step 2:** 加 `plantModels`：切到 leuna 時用 `PLANT_LAYOUT` 建 12 座 `createGroundTarget` → `createPlantModels`，加 `FLAK_SITES` 方塊；切走時 dispose。飛機換成 `buildAircraft(B17G)` 擺在 `(0, 4000, -3000)` 朝 −Z。
- [ ] **Step 3:** `npm run dev` 開 `/daylight.html` 切到洛伊納，確認畫面有廠區、方塊、灰天、褐田（負責人自己看）。
- [ ] **Step 4: Commit** `tools: daylight 展示區列洛伊納，廠區與砲位一起擺上去`

---

### Task 12: 文件、整套測試、tsc

- [ ] **Step 1:** `docs/roadmap.md`：里程碑 2 的「炸彈：自由落體、爆炸範圍傷害」「炸彈艙開關」「投彈瞄準輔助」「摧毀 N 個地面目標」打勾；附錄表盟 M2、盟 M4、日 M4 改 ✅（盟 M2 標「B-17G／Bf109／—／洛伊納／90 s 波次」）。
- [ ] **Step 2:** `npm run test:unit`、`npm run test:integration`，全綠（perf-gate 並行假紅單獨再跑一次）。
- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | Measure-Object -Line` 與 Task 0 相同。
- [ ] **Step 4: Commit** `docs: roadmap 對齊盟 M2 上線`
- [ ] **Step 5:** Codex 審查整批 diff（`git diff 8055910..HEAD`），收查證過的缺陷。

---

## 自我檢查

- **Spec 覆蓋**：§6 → Task 4；§6.4 → Task 2、3；§6.3b → Task 11；§7 → Task 5、6；§8 → Task 7、10；§9 → Task 8；§10 → Task 9；§11 → Task 9；§12.1–2 → Task 4；§12.3–4 → Task 6；§12.5–6 → Task 1（凍結）＋ Task 2、8（比對）；§12.7–8 → Task 7、10；§12.9 → Task 10；§12.10–11 → Task 9、5。
- **型別一致**：`StrikeTarget` 欄位在 Task 5 定義、Task 8 使用；`GroundKind` 六個字面值在 Task 4 的 `PLANT_LAYOUT` 與 Task 5 相同；`fillMarkers` 新參數位置在 Task 9 與 `main.ts` 呼叫一致；`groundDestroyedEvents` 六格語意在 Task 6 定義、Task 9 消費。
- **已知不確定處**（執行時看程式碼決定，不影響設計）：`World` 在測試裡的最小建法；`LobeDraw` 欄位名；波次「從後方」用 `starboard` 還是 `along`；`bombEvents` 每步排空的位置。
