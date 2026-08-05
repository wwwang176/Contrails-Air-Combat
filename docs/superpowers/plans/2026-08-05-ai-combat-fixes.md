# 戰機 AI 四個缺陷的修補 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉四個讓單機 AI 打不出東西的缺陷 —— 目標猶豫、掉頭追後方、追擊時吊到失速、一千公尺線上的震盪。

**Architecture:** 四個缺陷都是「判斷接錯量」。本次修補不新增任何物理量，只把判斷接到程式裡**已經存在**的對的量上：`cornerRatio` 取代 `energyReserve` 回答「還打得動嗎」、`threatFactor` 取代自製的幾何近似回答「誰在威脅我」、`instantaneousTurnRate` 提供「轉過去要多久」、`recoveryAltitude` 提供離地餘裕。`energyAdvantage` 與 `Ps` 用得是對的，一個字不動。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess`）、three.js（只用 `Vector3`／`Quaternion` 數學）、vitest。無新增相依。

**設計文件：** `docs/superpowers/specs/2026-08-05-ai-combat-fixes-design.md`

## Global Constraints

- 全部註解與文件用**繁體中文**。
- **絕不放寬門檻讓測試通過。** 測試紅了就查為什麼，若斷言本身寫錯就改斷言並說明；不准改門檻遷就實作。
- **每個新測試都要先驗證紅燈**再寫實作。若不小心先寫了實作，把實作暫時移到 `$CLAUDE_JOB_DIR/tmp/` 確認測試會紅，再移回來。
- **commit 一律用明確路徑，不准 `git add -A`** —— `bash.exe.stackdump` 是已追蹤且已修改的檔案，會被誤帶進 commit。
- **不使用 `@types/node`** —— 不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 開啟：所有陣列索引存取都要 `!` 或做 undefined 檢查。
- `src/world/` 不得 import `src/render/` 或 `src/hud/`。
- **熱路徑禁止配置**：`src/ai/` 的所有函數不得在每次呼叫時 `new` 物件。用模組層的 `makeScratch` 暫存。
- **不碰 `DifficultyProfile`。**
- **`energyAdvantage`、`Ps`、`turnAdvantage`、`airframeTurnAdvantage` 完全不動**（spec §4.1）。
- **切換成本只用來排序，不用來否決候選**（spec §4.2）。僚機第三級只有一個候選，行為必須完全不變。
- **撞地優先於失速**（spec §4.5）。安全層的撞地分支邏輯、門檻、動作一個字不改。
- 常數一律先寫**起始值**並在註解標明「**起始值，待 Task 10 由實測回填**」，與 `DEFAULT_TARGET`、`DEFAULT_RULES` 的既有寫法一致。

---

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `test/integration/ai-manoeuvre.test.ts` | **建立**（Task 1） | 1v1 六場開局的機動品質迴歸測試。子彈傷害歸零、跑滿 300 秒、逐秒取樣 |
| `src/ai/steer.ts` | 修改（Task 2、9） | `SteerMode` 拆成 `speedRecover`／`unload`；`extend` 俯仰改連續量；`steerCommand` 加 `seaHeight` 參數 |
| `src/ai/safety.ts` | 修改（Task 3） | 撞地分支之後加入失速硬介入 |
| `test/integration/ai-targeting.test.ts` | **建立**（Task 4） | 20v20 的目標選擇品質迴歸測試 |
| `src/ai/assess.ts` | 修改（Task 5、8） | 新增 `turnTime`；刪除 `energyReserve`／`energyFloor`／`ENERGY_FLOOR_ALTITUDE` |
| `src/ai/target.ts` | 修改（Task 6） | 威脅項改用 `threatFactor`；評分乘上切換成本折扣 |
| `src/ai/wingman.ts` | 修改（Task 7） | 第一、二級內部用切換成本排序；第三級不動 |
| `src/ai/rules.ts` | 修改（Task 8） | `extendFloorLatch` 改判 `cornerRatio` |
| `src/ai/AiController.ts` | 修改（Task 9） | `steerCommand` 呼叫加傳 `this.seaHeight` |
| `test/unit/ai-steer.test.ts` | 修改（Task 2、9） | 改寫守舊機制的案例 |
| `test/unit/ai-rules.test.ts` | 修改（Task 8） | 同上 |
| `test/unit/ai-safety.test.ts` | 修改（Task 3） | 新增失速介入案例 |
| `test/unit/ai-assess.test.ts` | 修改（Task 5、8） | 新增 `turnTime` 案例；移除 `energyReserve` 案例 |
| `test/unit/ai-target.test.ts` | 修改（Task 6） | 改寫威脅項案例、新增切換成本案例 |
| `test/unit/ai-wingman.test.ts` | 修改（Task 7） | 新增同級排序案例 |
| `README.md` | 修改（Task 10） | 更新 AI 段落 |

**沒有新增原始碼檔案。** `turnTime` 放 `assess.ts` 是因為 `target.ts` 與 `wingman.ts` 都要用，而 `wingman.ts` 已經 import `assess.ts`。

---

## 任務總覽

| Task | 內容 | 對應 spec |
|---|---|---|
| 1 | 1v1 機動迴歸測試骨架（基準門檻） | §8.2 |
| 2 | `stallGuard` 拆成 `speedRecover` ＋ `unload` | §5.1、§5.2 |
| 3 | 安全層加入失速硬介入 | §5.3 |
| 4 | 20v20 目標選擇迴歸測試骨架（基準門檻） | §8.2 |
| 5 | `turnTime`（轉過去要幾秒） | §6.2 |
| 6 | `targetScore`：威脅定義 ＋ 切換成本 | §6.1、§6.2 |
| 7 | 僚機第一、二級用切換成本排序 | §6.4 |
| 8 | `cornerRatio` 取代 `energyReserve` | §7.1、§7.3 |
| 9 | `extend` 俯仰改連續量 | §7.2 |
| 10 | 收緊全部門檻、回填常數、更新 README | §9 |

**Task 1 與 4 先建立測試骨架、門檻用「修補前的現況值」**，每一批做完後那些門檻自然會被大幅超越。Task 10 一次收緊到最終值。這不是偏離 spec §8.2 —— 最終門檻仍由修好之後的實測回填，中間的基準門檻只是讓每一步都有客觀守門員，避免某一批把另一批的成果吃掉。

---

## Task 1: 1v1 機動迴歸測試骨架

**Files:**
- Create: `test/integration/ai-manoeuvre.test.ts`

**Interfaces:**
- Consumes: 既有的 `World`、`Aircraft`、`AiController`、`P51D`、`assess.ts` 的 `createSituation`／`evaluateGeometry`／`evaluateEnergy`
- Produces: 無（純測試檔）。Task 2、3、9 會依賴它守門，Task 10 會收緊它的門檻

- [ ] **Step 1: 寫測試檔**

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createSituation, evaluateEnergy, evaluateGeometry } from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'
import { DEG } from '../../src/core/math'
import type { Battery } from '../../src/weapons/types'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const SECONDS = 300
const FWD = new Vector3(0, 0, -1)

/**
 * 同一副武器，單發傷害歸零。彈道、初速、射速、匯聚、預瞄用的 `sight`
 * 全部不動。
 *
 * 【為什麼要這樣做】AI 的決策輸入（預瞄解、`shotInstant`、`threatInstant`、
 * 開火紀律）一個字都不變，但仗打不完，觀察窗因此不會被提早結束的戰鬥
 * 截斷。調查時 1000 m 的兩場原本 92 秒與 176 秒就分出勝負，看不到穩態
 * 行為（spec §8.2）。
 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const P51_BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

interface Side {
  altitude: number
  /** 水平位移 [x, z]，m */
  offset: [number, number]
  headingDeg: number
}

interface Metrics {
  /** 速度低於 1G 失速速度的取樣比例 */
  belowStall: number
  /** 安全層介入的取樣比例 */
  safetyShare: number
  /** 單次 extend 的最長連續秒數 */
  longestExtend: number
  /** 航跡角超過 ±45° 的取樣比例 */
  steepShare: number
  /** 機首偏離目標超過 90° 的取樣比例 */
  offNose: number
}

const TAS = 200

function duel(blue: Side, red: Side): Metrics {
  const world = new World()
  const make = (s: Side): { a: Aircraft; pos: Vector3 } => {
    const a = new Aircraft(P51_BLUNT, s.altitude, TAS)
    const pos = new Vector3(s.offset[0], s.altitude, s.offset[1])
    const h = s.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }
  const b = make(blue)
  const r = make(red)
  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, TAS)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, TAS)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const sit = createSituation()
  const los = new Vector3()
  const nose = new Vector3()
  let samples = 0
  let belowStall = 0
  let safety = 0
  let steep = 0
  let offNose = 0
  let longestExtend = 0
  let currentExtend = 0

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s <= steps; s++) {
    // 【每 0.25 s 取樣一次】足以解析週期 20 s 的振盪，又不會讓統計成本
    // 主導測試時間
    if (s % 60 === 0) {
      evaluateGeometry(b.a, r.a, sit)
      evaluateEnergy(b.a, r.a, sit)
      samples++
      if (sit.speedMargin < 1) belowStall++
      if (blueAi.safetyActive) safety++
      const v = b.a.state.velocity
      const sp = v.length()
      const gamma = sp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / sp))) : 0
      if (Math.abs(gamma) > 45 * DEG) steep++
      los.copy(r.a.state.position).sub(b.a.state.position)
      const range = los.length()
      if (range > 1e-3) {
        los.divideScalar(range)
        nose.copy(FWD).applyQuaternion(b.a.state.orientation)
        if (Math.acos(Math.max(-1, Math.min(1, nose.dot(los)))) > Math.PI / 2) offNose++
      }
      if (blueAi.intent === 'extend') {
        currentExtend += 0.25
        if (currentExtend > longestExtend) longestExtend = currentExtend
      } else {
        currentExtend = 0
      }
    }
    world.step(DT)
  }
  return {
    belowStall: belowStall / samples,
    safetyShare: safety / samples,
    longestExtend,
    steepShare: steep / samples,
    offNose: offNose / samples,
  }
}

/**
 * 六場開局：對頭／平行／**側舷** × 1000 m／4000 m。
 *
 * 【側舷不可省略】調查時對頭與平行跑了三場都沒暴露一千公尺死循環，
 * 換成側舷立刻出現且成為主導行為（`extend` 佔 59%）。**開局幾何決定
 * AI 掉進哪一種模式**（spec §4.6）。
 *
 * 【為什麼雙方同機種】異機種在調查中 20–39 秒就分出勝負，看不到穩態
 * 行為。同機種誰也咬不住誰，300 秒跑得完。
 */
const OPENINGS: { name: string; blue: Side; red: Side }[] = []
for (const altitude of [1000, 4000]) {
  OPENINGS.push(
    {
      name: `對頭 @${altitude} m`,
      blue: { altitude, offset: [0, 1500], headingDeg: 180 },
      red: { altitude, offset: [0, 0], headingDeg: 0 },
    },
    {
      name: `平行 @${altitude} m`,
      blue: { altitude, offset: [0, 0], headingDeg: 0 },
      red: { altitude, offset: [800, 0], headingDeg: 0 },
    },
    {
      name: `側舷 @${altitude} m`,
      blue: { altitude, offset: [0, 0], headingDeg: 0 },
      red: { altitude, offset: [-900, -200], headingDeg: 0 },
    },
  )
}

/**
 * **這些是「修補前的現況」，不是目標值。**
 *
 * 每一批修補完成後這些門檻會被大幅超越；Task 10 會依實測一次收緊。
 * 在此之前它們的作用是「不准比現在更糟」—— 避免某一批把另一批的成果
 * 吃掉。
 *
 * 現況量測（2026-08-05，種子固定、無亂數）：4000 m 同機種纏鬥有 22% 的
 * 取樣速度低於 1G 失速速度；側舷開局的單次 `extend` 最長 40 秒。
 */
const BASELINE = {
  belowStall: 0.30,
  longestExtend: 60,
  offNose: 0.95,
}

describe('AI 機動品質（1v1、300 秒、子彈無傷害）', () => {
  for (const o of OPENINGS) {
    it(`${o.name}`, () => {
      const m = duel(o.blue, o.red)
      expect(m.belowStall).toBeLessThanOrEqual(BASELINE.belowStall)
      expect(m.longestExtend).toBeLessThanOrEqual(BASELINE.longestExtend)
      expect(m.offNose).toBeLessThanOrEqual(BASELINE.offNose)
    }, 60000)
  }

  it('決定性：同一組開局跑兩次結果完全相同', () => {
    const a = duel(OPENINGS[0]!.blue, OPENINGS[0]!.red)
    const b = duel(OPENINGS[0]!.blue, OPENINGS[0]!.red)
    expect(a).toEqual(b)
  }, 60000)
})
```

- [ ] **Step 2: 跑測試，確認全綠**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts`
Expected: 7 個測試全部 PASS。若有任何一場紅燈，代表現況比基準還糟 —— **不要放寬 `BASELINE`**，先把實際數字印出來（在 `duel` 回傳前 `console.log(m)`）並回報。

- [ ] **Step 3: 記下六場的現況數字**

在測試檔的 `BASELINE` 註解下方，用實際跑出來的數字補一張表（六場各自的 `belowStall`、`longestExtend`、`offNose`）。這張表是 Task 10 收緊門檻的依據。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-manoeuvre.test.ts
git commit -m "test: 1v1 機動品質迴歸測試（六場開局，門檻為修補前基準）"
```

---

## Task 2: `stallGuard` 拆成 `speedRecover` ＋ `unload`

**Files:**
- Modify: `src/ai/steer.ts`
- Modify: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `Situation.speedMargin`、`Situation.stallMargin`（既有）
- Produces:
  - `SteerMode = 'normal' | 'overshoot' | 'speedRecover' | 'unload' | 'planeDegenerate'`
  - `SteerConfig` 新欄位：`unloadMargin: number`、`speedRecoverMargin: number`、`speedRecoverPitch: number`
  - `SteerConfig` 移除欄位：`stallGuardMargin`、`stallGuardSpeed`、`stallGuardElevation`

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-steer.test.ts` 的 `describe('geometryGate', ...)` 區塊（若無此區塊則新增）：

```ts
describe('失速的兩種診斷', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const cmd = createCommand()
  const knobs: Knobs = { leadLag: 0, vertical: 0 }

  /** 一組不觸發任何閘門的態勢 */
  const clean = (): void => {
    sit.range = 1000
    sit.closureRate = 0
    sit.stallMargin = 2
    sit.speedMargin = 2
    basis.verticalDegenerate = false
  }

  it('速度裕度低 → speedRecover（不管仰角）', () => {
    clean()
    sit.speedMargin = DEFAULT_STEER.speedRecoverMargin * 0.9
    expect(geometryGate(sit, basis)).toBe('speedRecover')
  })

  it('失速裕度低但速度充足 → unload', () => {
    clean()
    sit.stallMargin = DEFAULT_STEER.unloadMargin * 0.9
    expect(geometryGate(sit, basis)).toBe('unload')
  })

  it('兩者皆低 → speedRecover 優先（沒速度比拉太猛嚴重）', () => {
    clean()
    sit.stallMargin = DEFAULT_STEER.unloadMargin * 0.9
    sit.speedMargin = DEFAULT_STEER.speedRecoverMargin * 0.9
    expect(geometryGate(sit, basis)).toBe('speedRecover')
  })

  /**
   * 【這一條是缺陷 3 的核心】舊的 `stallGuard` 補救動作是
   * `unloadAim(self, 0)` —— 瞄準當前速度向量。在「我自己已經吊上去」時
   * 那個向量正指著天空，命令沿著它飛等於命令繼續爬。實測航跡角 > 45°
   * 的 52 秒裡，有 38 秒（73%）指令仰角完全等於當前航跡角（spec §3.4）。
   */
  it('speedRecover 必須壓機頭，而不是沿著當前速度向量飛', () => {
    clean()
    const self = flyer()
    const target = flyer()
    // 自機正在 60° 爬升
    const climb = 60 * (Math.PI / 180)
    place(self, [0, 4000, 0], [0, 180 * Math.sin(climb), -180 * Math.cos(climb)])
    place(target, [0, 4600, -400], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    // 【mode 直接傳入，不經過 geometryGate】所以這裡不必再設 speedMargin
    // —— 要驗的是「拿到這個 mode 之後做什麼」，不是「什麼時候拿到它」
    steerCommand('engage', 'speedRecover', sit, basis, self, 0, knobs, cmd)
    const commanded = Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))
    expect(commanded).toBeCloseTo(-DEFAULT_STEER.speedRecoverPitch, 9)
    expect(commanded).toBeLessThan(0)
  })

  it('unload 維持既有行為：瞄準當前速度向量', () => {
    clean()
    const self = flyer()
    const target = flyer()
    const climb = 60 * (Math.PI / 180)
    place(self, [0, 4000, 0], [0, 180 * Math.sin(climb), -180 * Math.cos(climb)])
    place(target, [0, 4600, -400], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    steerCommand('engage', 'unload', sit, basis, self, 0, knobs, cmd)
    expect(Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))).toBeCloseTo(climb, 6)
  })
})
```

同時把測試檔頂端的 import 加上 `geometryGate` 與 `createSituation`（若尚未 import）。

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-steer.test.ts -t '失速的兩種診斷'`
Expected: FAIL —— `DEFAULT_STEER.speedRecoverMargin` 是 `undefined`，且 `steerCommand` 只接受 8 個參數。

- [ ] **Step 3: 改 `SteerMode` 與 `SteerConfig`**

`src/ai/steer.ts`：

```ts
export type SteerMode = 'normal' | 'overshoot' | 'speedRecover' | 'unload' | 'planeDegenerate'

export interface SteerConfig {
  /** 超前閘門的距離門檻，m */
  overshootRange: number
  /**
   * **拉太猛**的判準：失速裕度（TAS ÷ 當前過載下的失速速度）低於此值就卸載。
   *
   * 【它量的是攻角不是速度】代數上恆等於 √(CLmax / CL)，所以它回答的是
   * 「我拉得太猛了嗎」。補救是停止拉桿，不是壓機頭。
   */
  unloadMargin: number
  /**
   * **快沒空速**的判準：速度裕度（TAS ÷ 1G 失速速度）低於此值就壓機頭。
   *
   * 【為什麼不看仰角】舊版要求「仰角 > 45° **且** 速度低」才觸發，那個
   * `且` 讓它在 74° 仰角、速度裕度 1.49 時仍然不動，等到 1.34 才觸發
   * —— 已經 78 m/s 了。速度不足在任何姿態都是問題；俯衝時速度自然高，
   * 不會誤觸發（實測俯衝時觸發 0 次，spec §3.4）。
   */
  speedRecoverMargin: number
  /** `speedRecover` 的壓頭角度，rad。正值，實際命令的是它的負值 */
  speedRecoverPitch: number
  /** 瞄準點相對目標的最大角位移，rad */
  maxOffsetAngle: number
  /** cornerRatio 超過此值就開始減速 */
  brakeCornerRatio: number
  /** extend 的爬升／俯衝角上限，rad */
  extendPitch: number
  /** defend 的偏轉角，rad */
  defendOffset: number
}
```

`DEFAULT_STEER` 對應改為：

```ts
export const DEFAULT_STEER: SteerConfig = {
  overshootRange: 120,
  unloadMargin: 1.25,
  speedRecoverMargin: 1.4,
  // 【起始值，待 Task 10 由實測回填】與安全層的 recoveryPitch（20°）對稱
  speedRecoverPitch: 20 * (Math.PI / 180),
  maxOffsetAngle: 20 * (Math.PI / 180),
  brakeCornerRatio: 1.6,
  extendPitch: 25 * (Math.PI / 180),
  defendOffset: 75 * (Math.PI / 180),
}
```

- [ ] **Step 4: 改 `geometryGate`**

```ts
/**
 * 幾何有效性閘門（spec §7.1）。在算 yo-yo 平面之前先過。
 *
 * 【優先序：超前 > 沒空速 > 拉太猛 > 平面退化】撞上去比失速嚴重；沒空速
 * 比拉太猛嚴重（前者要壓機頭換速度，後者只要停止拉桿）；失速比瞄不準嚴重。
 */
export function geometryGate(
  sit: Situation,
  basis: EngageBasis,
  cfg: SteerConfig = DEFAULT_STEER,
): SteerMode {
  // 極近距離時預瞄點會產生指揮儀兌現不了的角速度需求：100 m 外、橫向
  // 200 m/s 的目標，視線角速度是 2 rad/s = 115°/s，而 P-51 的最大滾轉率
  // 只有約 100°/s——瞄準點每格劇烈跳動而飛機跟不上。
  if (sit.range < cfg.overshootRange && sit.closureRate > 0) return 'overshoot'

  // 【兩個判準各管一種失效模式，補救動作相反】
  //   speedMargin 低 = 快沒空速  → 壓機頭換速度
  //   stallMargin  低 = 拉太猛   → 卸載，機頭跟著速度向量
  // 舊版把兩者合併成同一個 mode 並共用 `unloadAim(self, 0)`，對後者正確、
  // 對前者是無操作 —— 那就是缺陷 3（spec §5.1）。
  if (sit.speedMargin < cfg.speedRecoverMargin) return 'speedRecover'
  if (sit.stallMargin < cfg.unloadMargin) return 'unload'

  // 真正的幾何奇異：升力方向 ∥ 視線，「上方」沒有唯一解
  if (basis.verticalDegenerate) return 'planeDegenerate'

  return 'normal'
}
```

- [ ] **Step 5: 改 `steerCommand` 的模式分派並加 `seaHeight` 參數**

【`seaHeight` 在本任務只是佔位，Task 9 才會用到】現在就加是為了避免同一個簽章改兩次、測試也要改兩次。

```ts
export function steerCommand(
  intent: Intent,
  mode: SteerMode,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  /** 該點的海面（未來為地表）高度，m。Task 9 的 extend 俯仰用它算離地餘裕 */
  seaHeight: number,
  k: Knobs,
  out: Command,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // ── 瞄準點 ──────────────────────────────────────────────
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
    out.aimWorld.copy(basis.losAxis)
  } else if (mode === 'speedRecover') {
    // 【主動壓機頭】不是「沿著現在的速度向量飛」—— 在自己已經吊上去時，
    // 那個向量正指著天空，命令沿著它飛等於命令繼續爬（spec §5.1）。
    unloadAim(self, -cfg.speedRecoverPitch, out.aimWorld)
  } else if (mode === 'unload') {
    // 拉太猛：停止拉桿，機頭回到速度向量，讓升力係數退回線性段。
    unloadAim(self, 0, out.aimWorld)
  } else if (mode === 'overshoot') {
    aimFromKnobs(basis, sit, OVERSHOOT_KNOBS, out.aimWorld, cfg)
  } else {
    switch (intent) {
      // …（其餘分支暫時不動，Task 9 才改 extend）
    }
  }
  // …（油門與減速那一段完全不動）
}
```

【油門不用改】`speedRecover` 時 `cornerRatio` 必然很低，會落到 `else` 分支拿到 `WEP_THROTTLE` 與 `brake = 0` —— 正是要的。

- [ ] **Step 6: 修正既有呼叫端與測試**

`src/ai/AiController.ts` 的呼叫改為：

```ts
    steerCommand(this.intent, mode, this.sit, this.basis, self, this.seaHeight, this.knobs, out)
```

`test/unit/ai-steer.test.ts` 內所有 `steerCommand(...)` 呼叫都要在 `self` 之後插入 `0`（測試場景都在海面高度 0）。

- [ ] **Step 7: 跑全部測試**

Run: `npx vitest run test/unit/ai-steer.test.ts test/unit/ai-controller.test.ts`
Expected: 全部 PASS。舊的「吊機首閘門」相關案例若引用了 `stallGuardElevation` 或 `'stallGuard'` 字串，**改寫成新機制**（它們守的是舊機制，隨機制一起改，不是遷就實作）。

- [ ] **Step 8: 跑機動迴歸測試**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts`
Expected: 全部 PASS，且 `belowStall` 應明顯下降。把六場的新數字記在 commit 訊息裡。

- [ ] **Step 9: Commit**

```bash
git add src/ai/steer.ts src/ai/AiController.ts test/unit/ai-steer.test.ts
git commit -m "fix: 失速的兩種診斷拆開 —— 沒空速要壓機頭，拉太猛才卸載"
```

---

## Task 3: 安全層加入失速硬介入

**Files:**
- Modify: `src/ai/safety.ts`
- Modify: `test/unit/ai-safety.test.ts`

**Interfaces:**
- Consumes: `stallSpeed`（`analysis/envelope.ts`，既有）
- Produces: `SafetyConfig` 新欄位 `stallMargin: number`、`stallRecoveryPitch: number`

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-safety.test.ts`：

```ts
describe('失速硬介入', () => {
  it('高空低速時介入，並壓機頭', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    // 極低速平飛：speedMargin 遠低於門檻
    a.state.velocity.set(0, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    out.aimWorld.set(0, 1, 0)
    expect(applySafety(a, 0, out)).toBe(true)
    expect(out.aimWorld.y).toBeLessThan(0)
    expect(out.firing).toBe(false)
  })

  /**
   * 【撞地優先於失速】兩個安全關切在低空低速時相反：失速要壓頭、撞地要
   * 拉起。撞地優先，因為失速還有機會改出，撞地沒有（spec §4.5）。
   */
  it('同時有撞地風險與失速時，走撞地分支（拉起）', () => {
    const a = new Aircraft(P51D, 150, 200)
    a.state.position.set(0, 150, 0)
    a.state.velocity.set(0, -10, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    expect(applySafety(a, 0, out)).toBe(true)
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  it('速度充足且高度充足時不介入', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    expect(applySafety(a, 0, out)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-safety.test.ts -t '失速硬介入'`
Expected: 第一個案例 FAIL —— `applySafety` 回傳 `false`（目前只管撞地）。

- [ ] **Step 3: 加設定欄位**

`src/ai/safety.ts`：

```ts
export interface SafetyConfig {
  /** 所需脫離高度的安全倍率 */
  factor: number
  /** 額外的固定餘裕，m。水平飛行時它就是最低容許高度 */
  clearance: number
  /** 硬接管時的爬升角，rad */
  recoveryPitch: number
  /**
   * 失速硬介入的速度裕度門檻（TAS ÷ 1G 失速速度）。
   *
   * **必須低於 `DEFAULT_STEER.speedRecoverMargin`** —— 瞄準點層是技巧、
   * 這一層是硬限制，硬限制只在技巧失效時才動（spec §4.4）。
   */
  stallMargin: number
  /** 失速介入時的壓頭角度，rad。正值，實際命令的是它的負值 */
  stallRecoveryPitch: number
}

export const DEFAULT_SAFETY: SafetyConfig = {
  factor: 1.5,
  clearance: 120,
  recoveryPitch: 20 * (Math.PI / 180),
  // 【起始值，待 Task 10 由實測回填】低於瞄準點層的 1.4
  stallMargin: 1.1,
  // 【起始值】硬限制比上層積極
  stallRecoveryPitch: 25 * (Math.PI / 180),
}
```

- [ ] **Step 4: 把水平航向抽成 helper 並加入失速分支**

```ts
/**
 * 速度向量的水平方向（單位向量）。垂直俯衝／爬升時水平分量退化，改用
 * 機首的水平投影；兩者都退化就回傳 −Z。
 *
 * 【為什麼要保持航向】指揮儀是 bank-to-turn：大坡度時命令「世界正上方」
 * 會要求飛機先滾平再拉，而滾平的過程中高度還在掉。保持當前航向、只改
 * 仰角，指揮儀就能同時滾平與拉起。
 */
function horizontalHeading(self: Aircraft, out: Vector3): void {
  const vel = self.state.velocity
  out.set(vel.x, 0, vel.z)
  const len = out.length()
  if (len > 1e-3) {
    out.divideScalar(len)
    return
  }
  const nose = S.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.set(nose.x, 0, nose.z)
  const noseLen = out.length()
  if (noseLen > 1e-3) out.divideScalar(noseLen)
  else out.set(0, 0, -1)
}
```

`applySafety` 改為：

```ts
export function applySafety(
  self: Aircraft,
  seaHeight: number,
  out: Command,
  cfg: SafetyConfig = DEFAULT_SAFETY,
): boolean {
  const vel = self.state.velocity
  const tas = vel.length()
  const gamma = tas > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / tas))) : 0

  const nMax = Math.min(
    maxLoadFactorAero(self.spec, self.state.position.y, tas),
    PILOT_G_POSITIVE,
  )
  const needed = recoveryAltitude(tas, gamma, nMax) * cfg.factor + cfg.clearance
  const margin = self.state.position.y - seaHeight

  // ── 撞地（既有邏輯，一個字不改）─────────────────────────
  if (margin <= needed) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)
    out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.recoveryPitch))
    out.aimWorld.y = Math.sin(cfg.recoveryPitch)
    out.aimWorld.normalize()

    // 【油門不是固定滿檔】拉起半徑 ∝ V²，高速時減速才拉得起來；但低速時
    // 收油門會失速。判準用角落速度：高於它代表速度多到轉不動。
    if (tas > cornerSpeed(self.spec, self.state.position.y)) {
      out.throttle = THROTTLE_FLOOR
      out.brake = 1
    } else {
      out.throttle = WEP_THROTTLE
      out.brake = 0
    }
    out.firing = false
    return true
  }

  // ── 失速（撞地之後才判，spec §4.5）───────────────────────
  // 【為什麼排在撞地之後】兩者的補救相反：失速要壓頭、撞地要拉起。
  // 撞地優先，因為失速還有機會改出，撞地沒有。
  const vs = Math.max(stallSpeed(self.spec, self.state.position.y, 1), 1)
  if (tas / vs < cfg.stallMargin) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)
    out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.stallRecoveryPitch))
    out.aimWorld.y = -Math.sin(cfg.stallRecoveryPitch)
    out.aimWorld.normalize()
    // 換速度要推力，而且低速時沒有減速的道理
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    return true
  }

  return false
}
```

import 加上 `stallSpeed`：

```ts
import { cornerSpeed, maxLoadFactorAero, stallSpeed } from '../analysis/envelope'
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run test/unit/ai-safety.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 跑機動迴歸測試**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts`
Expected: 全部 PASS。`belowStall` 應進一步下降；`safetyShare` 現在會有非零值 —— **它就是 Task 2 那一層的品質指標**（每觸發一次代表瞄準點層失職一次），把六場的值記下來。

- [ ] **Step 7: Commit**

```bash
git add src/ai/safety.ts test/unit/ai-safety.test.ts
git commit -m "feat: 安全層加入失速硬介入，排在撞地之後"
```

---

## Task 4: 20v20 目標選擇迴歸測試骨架

**Files:**
- Create: `test/integration/ai-targeting.test.ts`

**Interfaces:**
- Consumes: `createBattle`、`stepBattle`、`DEFAULT_BATTLE`（`src/battle/setup.ts`）、`countLocks`（`src/ai/target.ts`）
- Produces: 無（純測試檔）。Task 6、7 依賴它守門

- [ ] **Step 1: 寫測試檔**

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { countLocks } from '../../src/ai/target'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 150
const FWD = new Vector3(0, 0, -1)
/** 固定種子 —— 名字用，但一併固定讓整場可重現 */
const SEED = 20260805

interface Targeting {
  /** 目標持有時間的中位數，s */
  holdMedian: number
  /** 換上新目標時，目標在後半球（機首偏離 > 90°）的比例 */
  rearShare: number
  /** 扣扳機時間 ÷ 存活時間 */
  fireShare: number
  /** 機首落在目標 15° 錐內的取樣比例 */
  onNose: number
  /** 全場最大同時鎖定同一架的數量 */
  maxLocks: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

function aspect(self: Aircraft, target: Aircraft, los: Vector3, nose: Vector3): number {
  los.copy(target.state.position).sub(self.state.position)
  const r = los.length()
  if (r < 1e-3) return 0
  los.divideScalar(r)
  nose.copy(FWD).applyQuaternion(self.state.orientation)
  return Math.acos(Math.max(-1, Math.min(1, nose.dot(los))))
}

function battle(): Targeting {
  const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
  const cs = b.world.combatants
  const indexOf = new Map<Aircraft, number>()
  for (const c of cs) indexOf.set(c.aircraft, c.index)

  const los = new Vector3()
  const nose = new Vector3()
  const holds: number[] = []
  const holdStart: number[] = cs.map(() => 0)
  const prev: number[] = cs.map(() => -2)
  let switches = 0
  let rear = 0
  let fire = 0
  let alive = 0
  let onNose = 0
  let samples = 0
  let maxLocks = 0

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s < steps; s++) {
    stepBattle(b, DT)
    const t = s * DT
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive) { prev[i] = -2; continue }
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      alive += DT
      if (c.command.firing) fire += DT

      const tgt = ai.target ? indexOf.get(ai.target)! : -1
      if (tgt !== prev[i]) {
        if (prev[i]! >= 0) holds.push(t - holdStart[i]!)
        if (tgt >= 0) {
          holdStart[i] = t
          switches++
          if (aspect(c.aircraft, ai.target!, los, nose) > Math.PI / 2) rear++
        }
        prev[i] = tgt
      }

      // 【每 0.25 s 取樣一次】與機動測試同一個節奏
      if (s % 60 === 0) {
        samples++
        if (ai.target && aspect(c.aircraft, ai.target, los, nose) < 15 * (Math.PI / 180)) {
          onNose++
        }
      }
    }
    // 最大鎖定數只在決策節拍附近檢查，成本才不會主導
    if (s % 240 === 0) {
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!
        if (!c.alive) continue
        const n = countLocks(b.board, c.team, -1, i)
        if (n > maxLocks) maxLocks = n
      }
    }
  }

  return {
    holdMedian: median(holds),
    rearShare: switches > 0 ? rear / switches : 0,
    fireShare: alive > 0 ? fire / alive : 0,
    onNose: samples > 0 ? onNose / samples : 0,
    maxLocks,
  }
}

/**
 * **這些是「修補前的現況」，不是目標值。** Task 10 會依實測收緊。
 *
 * 現況量測（2026-08-05）：目標持有中位數 1.1–2.0 s、換上新目標在後半球
 * 42.9%、扣扳機時間 1.6–2.9%、機首在 15° 錐內 6.9–26.6%。
 */
const BASELINE = {
  holdMedian: 1.0,
  rearShare: 0.50,
  fireShare: 0.015,
  onNose: 0.06,
}

/**
 * 最大同時鎖定數的上限。
 *
 * 【7 是推導出來的界】僚機第 3 級讓一個 Schwarm 的三架僚機全部撲上長機的
 * 現任目標，加上長機自己是 4；其餘自由獵手走分攤評分，M5 量到的擁擠上限
 * 是 3。兩者相加 = 7（M6 spec §14）。
 *
 * 【這一條是 spec §6.5 那個假設的守門員】改用嚴格威脅定義後威脅項多數
 * 時候為 0，接近 M5 量到「20 架撲同一個目標」的狀態。分散改由切換成本
 * 接手 —— 若這個假設不成立，這一條會紅。**紅了不准把 7 改大**，該回頭
 * 看分散為什麼失效。
 */
const MAX_LOCKS = 7

describe('AI 目標選擇品質（20v20、150 秒）', () => {
  it('持有時間、後半球比例、產出、鎖定分散', () => {
    const m = battle()
    expect(m.holdMedian).toBeGreaterThanOrEqual(BASELINE.holdMedian)
    expect(m.rearShare).toBeLessThanOrEqual(BASELINE.rearShare)
    expect(m.fireShare).toBeGreaterThanOrEqual(BASELINE.fireShare)
    expect(m.onNose).toBeGreaterThanOrEqual(BASELINE.onNose)
    expect(m.maxLocks).toBeLessThanOrEqual(MAX_LOCKS)
  }, 120000)
})
```

- [ ] **Step 2: 跑測試確認全綠並記下數字**

Run: `npx vitest run test/integration/ai-targeting.test.ts`
Expected: PASS。在 `battle()` 回傳前暫時 `console.log(m)`，把五個數字記進 `BASELINE` 的註解，然後移除 `console.log`。

- [ ] **Step 3: Commit**

```bash
git add test/integration/ai-targeting.test.ts
git commit -m "test: 20v20 目標選擇品質迴歸測試（門檻為修補前基準）"
```

---

## Task 5: `turnTime`

**Files:**
- Modify: `src/ai/assess.ts`
- Modify: `test/unit/ai-assess.test.ts`

**Interfaces:**
- Consumes: `instantaneousTurnRate(spec, altitude, tas)`（`analysis/envelope.ts`，既有）
- Produces: `export function turnTime(self: Aircraft, target: Aircraft): number` —— 回傳秒數，轉不動時回傳 `Infinity`

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-assess.test.ts`：

```ts
describe('turnTime', () => {
  it('目標在正前方時為 0', () => {
    const self = flyer()
    const target = flyer()
    self.state.position.set(0, 4000, 0)
    target.state.position.set(0, 4000, -500)
    expect(turnTime(self, target)).toBeCloseTo(0, 6)
  })

  it('目標在正後方最貴，正側面居中', () => {
    const self = flyer()
    const behind = flyer()
    const beam = flyer()
    self.state.position.set(0, 4000, 0)
    behind.state.position.set(0, 4000, 500)     // 機首朝 −Z，所以 +Z 是後方
    beam.state.position.set(500, 4000, 0)
    const tBehind = turnTime(self, behind)
    const tBeam = turnTime(self, beam)
    expect(tBehind).toBeGreaterThan(tBeam)
    expect(tBeam).toBeGreaterThan(0)
    // 180° 恰好是 90° 的兩倍
    expect(tBehind / tBeam).toBeCloseTo(2, 3)
  })

  /**
   * 【慢的飛機轉得比較快，但角度需求一樣】所以同一個角度下，速度低的
   * 那一架 `turnTime` 反而短 —— 這正是要的：能量低的飛機轉得動，代價是
   * 它轉完之後沒有能量做別的事，而那由評分裡的其他項處理。
   */
  it('轉不動時回傳 Infinity', () => {
    const self = flyer()
    const target = flyer()
    self.state.position.set(0, 4000, 0)
    target.state.position.set(0, 4000, 500)
    // 速度趨近 0：可用過載 ≤ 1，瞬時轉彎率為 0
    self.state.velocity.set(0, 0, -0.001)
    self.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    expect(turnTime(self, target)).toBe(Infinity)
  })
})
```

【`flyer()` helper】`test/unit/ai-assess.test.ts` 若尚無此 helper，加上與 `ai-steer.test.ts` 相同的一份：

```ts
function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 180)
  a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
  return a
}
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-assess.test.ts -t 'turnTime'`
Expected: FAIL —— `turnTime is not defined`。

- [ ] **Step 3: 實作**

`src/ai/assess.ts`，import 加上 `instantaneousTurnRate`：

```ts
import {
  bestSustainedTurnRateCached, bestSustainedTurnSpeedCached, cornerSpeed,
  instantaneousTurnRate, specificExcessPower, stallSpeed, sustainedTurnRate,
} from '../analysis/envelope'
```

在檔案尾端（`evaluateThreat` 之後）加上：

```ts
/** `turnTime` 的暫存。與 `S`、`T` 分開，避免與態勢評估搶用 */
const TT = makeScratch(2)

/**
 * 把機首轉到目標身上所需的時間，s。轉不動時回傳 `Infinity`。
 *
 * 【為什麼用瞬時而不是持續轉彎率】問的是「我多久能把機首指過去」，那是
 * 短時間拉 G 的事，正是瞬時轉彎率的定義。而且 `instantaneousTurnRate`
 * 沒有二分搜尋，比 `sustainedTurnRate` 便宜得多。
 *
 * 【它是選目標的「代價」項】現在的評分只問「這架敵機有多值得打」，完全
 * 不問「我要花多少代價才打得到」。實測 43% 的新目標在後半球，其中只有
 * 1.7% 咬得到 —— 那 560 秒總共只開了 0.6 秒的火（spec §3.3）。
 *
 * 熱路徑之外（10 Hz），但仍然不配置。不修改 self 與 target。
 */
export function turnTime(self: Aircraft, target: Aircraft): number {
  const los = TT.v[0]!.copy(target.state.position).sub(self.state.position)
  const range = los.length()
  // 重疊時「該轉多少」沒有意義，取 0 —— 與 evaluateGeometry 的退化處理一致
  if (range <= MIN_RANGE) return 0
  los.divideScalar(range)

  const fwd = TT.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
  const angle = Math.acos(clampUnit(fwd.dot(los)))
  const rate = instantaneousTurnRate(self.spec, self.state.position.y, self.diag.aero.tas)
  return rate > 1e-6 ? angle / rate : Infinity
}
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/ai-assess.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/assess.ts test/unit/ai-assess.test.ts
git commit -m "feat: turnTime —— 把機首轉到目標上要幾秒"
```

---

## Task 6: `targetScore` 的威脅定義與切換成本

**Files:**
- Modify: `src/ai/target.ts`
- Modify: `test/unit/ai-target.test.ts`

**Interfaces:**
- Consumes: `threatFactor(shooter, victim)`、`turnTime(self, target)`（皆來自 `src/ai/assess.ts`）
- Produces: `TargetConfig` 新欄位 `turnTimeScale: number`

- [ ] **Step 1: 寫失敗的測試**

改寫 `test/unit/ai-target.test.ts` 的「威脅項」區塊並新增切換成本區塊：

```ts
describe('targetScore 的威脅項用真正的定義', () => {
  /**
   * 【為什麼要改】舊版的威脅只看「敵機首朝不朝我」，不管距離、不管有沒有
   * 預瞄解、不管機首在不在射擊錐內。三公里外一架剛好朝我飛的敵機，在它
   * 眼裡跟貼著我開火的一樣危險。實測換上後半球目標的當下，`threatInstant`
   * 中位數 0.000、78.3% 為 0 —— AI 掉頭去追的是沒在威脅它的飛機
   * （spec §3.3、§6.1）。
   */
  it('遠處機首朝我的敵機不算威脅', () => {
    const me = place(0, 4000, 0, 0)
    // 3 km 外，機首正對我（舊定義會給滿分）
    const far = place(0, 4000, -3000, Math.PI)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    expect(targetScore(me, far, 0, cfg)).toBeCloseTo(0, 9)
  })

  it('近處機首朝我且有預瞄解的敵機算威脅', () => {
    const me = place(0, 4000, 0, 0)
    const near = place(0, 4000, -300, Math.PI)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    expect(targetScore(me, near, 0, cfg)).toBeGreaterThan(0)
  })
})

describe('targetScore 的切換成本', () => {
  /**
   * 【這一項同時修好猶豫與追後方】現任目標的機首已經對準，代價接近 0，
   * 因此天然具有黏性；後半球目標要轉 180°，代價極高，分數被壓下去。
   */
  it('同距離下，正前方的目標分數高於正後方的', () => {
    const me = place(0, 4000, 0, 0)
    // 兩架都背對我（機會項相同）、距離相同，只差在方位
    const front = place(0, 4000, -400, 0)
    const behind = place(0, 4000, 400, Math.PI)
    expect(targetScore(me, front, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, behind, 0, DEFAULT_TARGET))
  })

  /**
   * 【切換成本只是折扣，不會讓飛機黏死】目標本身的價值仍然主導：現任
   * 目標飛到 3 km 外時，距離折扣會把它壓下去，就算轉向代價是 0 也贏不了
   * 近處的目標（spec §4.3）。
   */
  it('正前方但很遠的目標，輸給側面但很近的目標', () => {
    const me = place(0, 4000, 0, 0)
    const farAhead = place(0, 4000, -3000, 0)
    // 【yaw 必須是 −π/2】機首方向是 (−sin yaw, 0, −cos yaw)，−π/2 給出
    // (1, 0, 0) ＝ 朝 +X，也就是背對我。若寫成 0，它的機首與我的視線垂直，
    // 機會項與威脅項**同時為 0**，分數是 0，這條測試就變成在比兩個 0。
    const nearBeam = place(300, 4000, 0, -Math.PI / 2)
    expect(targetScore(me, nearBeam, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, farAhead, 0, DEFAULT_TARGET))
  })

  it('分數恆非負', () => {
    const me = place(0, 4000, 0, 0)
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const z of [-2000, -400, 400, 2000]) {
        expect(targetScore(me, place(0, 4000, z, yaw), 0, DEFAULT_TARGET))
          .toBeGreaterThanOrEqual(0)
      }
    }
  })
})
```

【`place` helper 必須改，否則測試會以「兩邊都是 0」的方式紅掉】
`Aircraft` 的建構子**不填 `diag`** —— 它只在 `update` 裡由 `stepDynamics`
填。而新版 `targetScore` 透過 `turnTime` 讀 `diag.aero.tas`，讀到 0 會讓
`instantaneousTurnRate` 回傳 0、`turnTime` 回傳 `Infinity`、折扣變成 0，
於是**所有目標的分數都是 0**。既有測試沒踩到是因為舊版 `targetScore` 不
碰 `diag`。

把既有的 `place` 換成：

```ts
/** 把飛機擺在 (x, y, z)，機首繞 Y 軸轉 yaw 弧度（0 = 朝 −Z）。 */
function place(x: number, y: number, z: number, yaw: number): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  const q = new Quaternion().setFromAxisAngle(UP, yaw)
  a.state.orientation.copy(q)
  a.state.velocity.set(0, 0, -200).applyQuaternion(q)
  a.prevPosition.copy(a.state.position)
  // 跑一步把 diag 填起來（見上方說明）
  a.update(new Vector3(0, 0, -1).applyQuaternion(q), 0.7, 1 / 240)
  // update 會積分位置、姿態與速度，全部重設回我們要的值
  a.state.position.set(x, y, z)
  a.state.orientation.copy(q)
  a.state.velocity.set(0, 0, -200).applyQuaternion(q)
  return a
}
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-target.test.ts`
Expected: 「遠處機首朝我的敵機不算威脅」與切換成本的三條 FAIL。

- [ ] **Step 3: 改 `TargetConfig` 與 `targetScore`**

`src/ai/target.ts`，import 加上：

```ts
import { threatFactor, turnTime } from './assess'
```

`TargetConfig` 加欄位：

```ts
  /**
   * 切換成本的特徵時間，s。轉向需時等於此值時分數減半。
   *
   * 【量級怎麼來的】4000 m、200 m/s、6 G 下瞬時轉彎率約 16.6°/s，轉 180°
   * 需 10.9 秒。取 4 s 約等於「轉 66° 就折半」。
   *
   * **起始值，待 Task 10 由實測回填。**
   */
  turnTimeScale: number
```

`DEFAULT_TARGET` 加 `turnTimeScale: 4`。

`targetScore` 改為：

```ts
export function targetScore(
  self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig,
): number {
  const los = S.v[0]!.copy(enemy.state.position).sub(self.state.position)
  const range = los.length()

  const losUnit = S.v[1]!
  if (range > MIN_RANGE) losUnit.copy(los).divideScalar(range)
  else losUnit.copy(FWD).applyQuaternion(self.state.orientation)

  const enemyFwd = S.v[2]!.copy(FWD).applyQuaternion(enemy.state.orientation)
  let b = enemyFwd.dot(losUnit)
  if (b < -1) b = -1
  else if (b > 1) b = 1

  const opportunity = b > 0 ? b : 0
  // 【威脅用 assess.ts 那個真正的定義】要有預瞄解、機首在 15° 錐內、
  // 900 m 內。M6 spec §7.2 明確要求「不要有兩個對『誰在威脅誰』的答案」
  // —— 那條紀律漏了這裡（spec §6.1）。
  //
  // 【雙重折扣是刻意的】threatFactor 內含距離因子，而下面還有一層
  // rangeDiscount，威脅項因此被折扣兩次。方向正確 —— 現在的病正是遠處
  // 的「威脅」被高估。
  const threat = threatFactor(enemy, self)

  const geometry = cfg.opportunityWeight * opportunity + cfg.threatWeight * threat
  const rangeDiscount = 1 / (1 + range / cfg.rangeScale)
  const crowdDiscount = 1 / (1 + cfg.crowdPenalty * locks)
  // 【切換成本】turnTime 為 Infinity 時折扣為 0 —— 轉不動的目標不該被選
  const turnDiscount = 1 / (1 + turnTime(self, enemy) / cfg.turnTimeScale)
  return geometry * rangeDiscount * crowdDiscount * turnDiscount
}
```

- [ ] **Step 4: 跑單元測試**

Run: `npx vitest run test/unit/ai-target.test.ts test/unit/ai-controller.test.ts`
Expected: 全部 PASS。舊的「他機首正對我時最高」若因新定義而失效，**改寫它**（把距離拉到 900 m 內），不要放寬斷言。

- [ ] **Step 5: 跑目標選擇迴歸測試**

Run: `npx vitest run test/integration/ai-targeting.test.ts test/integration/multi-battle.test.ts`
Expected: 全部 PASS。特別注意 `maxLocks ≤ 7` —— **這是 spec §6.5 那個假設的守門員**。若它紅了，代表切換成本沒有接手分散的職責，回報並停下，不要改大 `MAX_LOCKS`。

- [ ] **Step 6: Commit**

```bash
git add src/ai/target.ts test/unit/ai-target.test.ts
git commit -m "fix: 目標評分改用真正的威脅定義，並加入轉向代價"
```

---

## Task 7: 僚機第一、二級用切換成本排序

**Files:**
- Modify: `src/ai/wingman.ts`
- Modify: `test/unit/ai-wingman.test.ts`

**Interfaces:**
- Consumes: `threatFactor`、`turnTime`（`src/ai/assess.ts`）
- Produces: `WingmanConfig` 新欄位 `turnTimeScale: number`

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-wingman.test.ts`：

```ts
describe('同一級內部用切換成本排序', () => {
  /**
   * 【只排序，不否決】級與級之間的硬優先序完全不動；一個候選通過了它
   * 那一級的條件就一定會被選中，代價只決定「同一級裡先挑誰」（spec §4.2）。
   */
  it('兩架同樣在威脅我時，挑機首比較容易轉過去的那一架', () => {
    const { board, craft } = scene()
    const me = craft[1]!
    const ahead = craft[3]!
    const behind = craft[4]!
    // 我朝 −Z；兩架敵機都咬在我尾後同樣距離，但一架在我機首方向、
    // 一架在我正後方
    me.state.position.set(0, 4000, 0)
    tail(ahead, me, -400)     // 在我前方，機首朝我
    tail(behind, me, 400)     // 在我後方，機首朝我
    const state = createWingmanState()
    const picked = selectWingmanTarget(state, board, 1, 0, 0, DT, DEFAULT_WINGMAN)
    expect(state.level).toBe(LEVEL_SELF_DEFENCE)
    expect(picked).toBe(ahead)
  })

  /**
   * 【第三級只有一個候選，行為必須完全不變】那一級選的是
   * `assignments[長機]` 讀出來的一架，不是一個清單 —— 沒有東西可以排序。
   * 若實作成「代價太高就放棄」，掩護就會消失（spec §4.2）。
   */
  it('第三級照選長機的目標，即使它在我正後方', () => {
    const { board, craft } = scene()
    const lead = craft[0]!
    const me = craft[1]!
    const prey = craft[3]!
    lead.state.position.set(0, 4000, 0)
    me.state.position.set(0, 4000, 100)
    // 長機的目標擺在我正後方 —— 轉過去很貴，但集火不該因此放棄
    prey.state.position.set(0, 4000, 700)
    prey.state.velocity.set(0, 0, -200)
    board.assignments[0] = 3
    const state = createWingmanState()
    const picked = selectWingmanTarget(state, board, 1, 0, 0, DT, DEFAULT_WINGMAN)
    expect(state.level).toBe(LEVEL_FOCUS)
    expect(picked).toBe(prey)
  })
})
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-wingman.test.ts -t '同一級內部用切換成本排序'`
Expected: 第一條 FAIL（目前只比 `threatFactor`，兩架分數相同時取先掃到的）；第二條應該 PASS（第三級本來就不受影響）——**它是迴歸守門員，Step 4 之後必須仍然綠**。

- [ ] **Step 3: 實作**

`src/ai/wingman.ts`，import 改為：

```ts
import { THREAT_RANGE, threatFactor, turnTime } from './assess'
```

`WingmanConfig` 加欄位並在 `DEFAULT_WINGMAN` 補 `turnTimeScale: 4`：

```ts
  /**
   * 切換成本的特徵時間，s。與 `DEFAULT_TARGET.turnTimeScale` 同義同值
   * —— 自由獵手與僚機用同一套「轉過去要多久」的概念。
   *
   * **起始值，待 Task 10 由實測回填。**
   */
  turnTimeScale: number
```

第一級與第二級的迴圈改為（**只有計分那一行變了**）：

```ts
  // ── 第一級：自衛 ──────────────────────────────────────
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive || c.team === self.team) continue
    const t = threatFactor(c.aircraft, self.aircraft)
    if (t <= 0) continue
    // 【切換成本只在同一級內部排序】通過這一級條件的候選一定會被選，
    // 代價只決定先挑誰（spec §4.2）
    const s = t / (1 + turnTime(self.aircraft, c.aircraft) / cfg.turnTimeScale)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i
    }
  }
  if (bestIndex >= 0) bestLevel = LEVEL_SELF_DEFENCE

  // ── 第二級：掩護站位參考機 ────────────────────────────
  if (bestLevel === LEVEL_NONE && state.engaging && lead !== undefined) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!
      if (!c.alive || c.team === self.team) continue
      const t = threatFactor(c.aircraft, lead.aircraft)
      if (t <= 0) continue
      // 【威脅算在長機頭上、代價算在我頭上】要轉過去的是我
      const s = t / (1 + turnTime(self.aircraft, c.aircraft) / cfg.turnTimeScale)
      if (s > bestScore) {
        bestScore = s
        bestIndex = i
      }
    }
    if (bestIndex >= 0) bestLevel = LEVEL_COVER
  }
```

【第三級一個字都不改。】

- [ ] **Step 4: 跑測試**

Run: `npx vitest run test/unit/ai-wingman.test.ts`
Expected: 全部 PASS，**包含第三級那條迴歸守門員**。

- [ ] **Step 5: 跑迴歸測試**

Run: `npx vitest run test/integration/ai-targeting.test.ts test/integration/multi-battle.test.ts`
Expected: 全部 PASS。`holdMedian` 應明顯上升（僚機佔 40 架裡的 30 架）。

- [ ] **Step 6: Commit**

```bash
git add src/ai/wingman.ts test/unit/ai-wingman.test.ts
git commit -m "fix: 僚機同一級內部依轉向代價排序，第三級集火不受影響"
```

---

## Task 8: `cornerRatio` 取代 `energyReserve`

**Files:**
- Modify: `src/ai/assess.ts`
- Modify: `src/ai/rules.ts`
- Modify: `test/unit/ai-rules.test.ts`
- Modify: `test/unit/ai-assess.test.ts`

**Interfaces:**
- Consumes: `Situation.cornerRatio`（既有）
- Produces:
  - `Situation` 移除 `energyReserve`
  - `assess.ts` 移除 `ENERGY_FLOOR_ALTITUDE` 與 `energyFloor`
  - `RuleConfig` 移除 `floorEnter`／`floorExit`，新增 `cornerEnter: number`／`cornerExit: number`

- [ ] **Step 1: 改寫 `ai-rules.test.ts` 的底線相關案例**

把四處 `sit.energyReserve = …` 改成 `sit.cornerRatio = …`，並改寫 `neutral()`：

```ts
function neutral(): Situation {
  const s = createSituation()
  s.range = 3000
  s.closureRate = 0
  s.timeToMerge = Infinity
  s.aspectAngle = Math.PI / 2
  s.angleOffTail = Math.PI / 2
  s.losRate = 0
  s.energyAdvantage = 0
  s.turnAdvantage = 0
  s.airframeTurnAdvantage = 0
  // 速度充足：遠高於 cornerEnter
  s.cornerRatio = 1.2
  s.stallMargin = 2
  s.speedMargin = 2
  s.threatInstant = 0
  s.shotInstant = 0
  return s
}
```

四個案例改為：

```ts
  it('速度見底時，就算正在開火也要走', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9   // 轉彎能力已經不足
    shooting(sit)
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)
    expect(s.intent).toBe('extend')
  })

  it('速度見底時，跑滿 extendRange 也不回頭', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = DEFAULT_RULES.extendRange * 3
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)
    expect(s.intent).toBe('extend')
  })

  /** 速度閂鎖的遲滯：剛好回到進入門檻不夠，要真的補回一點才鬆手。 */
  it('速度閂鎖有遲滯：回到進入門檻不解除，補足 cornerExit 才解除', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)

    // 回到進入門檻與離開門檻之間 —— 遲滯帶內，不解除
    sit.cornerRatio = (DEFAULT_RULES.cornerEnter + DEFAULT_RULES.cornerExit) / 2
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)

    sit.cornerRatio = DEFAULT_RULES.cornerExit * 1.05
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(false)
  })
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-rules.test.ts`
Expected: FAIL —— `DEFAULT_RULES.cornerEnter` 是 `undefined`。

- [ ] **Step 3: 改 `assess.ts`**

刪除這些：`Situation.energyReserve` 欄位與其註解、`createSituation` 裡的 `energyReserve: 0`、`evaluateEnergy` 裡的 `out.energyReserve = …`、`ENERGY_FLOOR_ALTITUDE`、`energyFloors` WeakMap、`energyFloor()` 函數，以及 `bestSustainedTurnSpeedCached` 的 import（確認沒有其他使用者：`grep -n "bestSustainedTurnSpeedCached" src/`）。

在 `Situation.cornerRatio` 的註解補上它的新職責：

```ts
  /**
   * 我的 TAS ÷ 我的角落速度。> 1 = 快到轉不動。
   *
   * 【它同時是「我還打得動嗎」的判準】角落速度是「這架飛機能拉出最大
   * 轉彎率的最低速度」；低於它，轉彎能力隨速度接近線性下滑。飛行員最
   * 在意的單一數字就是它。
   *
   * 【為什麼不用比能量】`Es = h + v²/2g` 出自 Boyd 的能量機動理論，發明
   * 目的是**比較兩架飛機誰佔優勢**，不是回答「我現在能做什麼」。實測
   * 反例：4379 m、67 m/s 的飛機比能量很漂亮，系統判它「還有 3299 m
   * 餘裕」，而它什麼機動都做不了 —— 能量全鎖在高度裡，提取要先俯衝，
   * 俯衝要時間、要高度、還要一開始就有速度把機頭壓下去（spec §4.1）。
   *
   * `energyAdvantage`（相對比較）仍然用比能量，那是對的用法。
   */
  cornerRatio: number
```

- [ ] **Step 4: 改 `rules.ts`**

`RuleConfig` 把 `floorEnter`／`floorExit` 換成：

```ts
  /**
   * extend：**速度**見底的進入／離開門檻，判的是 `cornerRatio`
   * （TAS ÷ 角落速度）。低於 `cornerEnter` 觸發、高於 `cornerExit` 解除。
   *
   * 【0.75 / 0.95 的意思】0.75 就是「我的轉彎能力只剩四分之三」。遲滯帶
   * 0.2 寬。
   *
   * 【為什麼這次的遲滯不會震盪】舊機制的震盪來源是**俯仰指令在翻號**
   * （`steer.ts` 的兩個裸門檻），不是意圖在切換。俯仰改成連續量之後，
   * 意圖的遲滯是必要且正常的（spec §7.1）。
   *
   * **起始值，待 Task 10 由實測回填。**
   */
  cornerEnter: number
  cornerExit: number
```

`DEFAULT_RULES` 對應改為 `cornerEnter: 0.75, cornerExit: 0.95`（刪掉 `floorEnter`／`floorExit`）。

`stepRules` 裡那一行改為：

```ts
  // 【第三個理由是絕對的】上面兩個都是「跟他比」，兩台一起磨下去時都看不見。
  // 這一個問「我還飛得動嗎」，與對手無關。
  s.extendFloorLatch = latch(
    s.extendFloorLatch, sit.cornerRatio, cfg.cornerEnter, cfg.cornerExit,
  )
```

`arbitrate` 裡引用 `extendFloorLatch` 的邏輯與註解不變 —— 語意仍然是「絕對理由」，只是量換了。把該處註解中提到 `energyReserve` 與 `floorExit` 的句子改寫成 `cornerRatio` 與 `cornerExit`。

- [ ] **Step 5: 跑測試**

Run: `npx vitest run test/unit/ai-rules.test.ts test/unit/ai-assess.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 確認沒有殘留引用**

Run: `npx tsc --noEmit`
Expected: 沒有錯誤。若 `test/unit/ai-steer.test.ts` 仍 import `ENERGY_FLOOR_ALTITUDE`，那些案例會在 Task 9 一併改寫 —— 此時可暫時把它們標成 `it.skip` 並在 Task 9 的 Step 1 改回來。

- [ ] **Step 7: Commit**

```bash
git add src/ai/assess.ts src/ai/rules.ts test/unit/ai-rules.test.ts test/unit/ai-assess.test.ts
git commit -m "refactor: 「還打得動嗎」改判角落速度比，拔掉一千公尺能量底線"
```

---

## Task 9: `extend` 俯仰改連續量

**Files:**
- Modify: `src/ai/steer.ts`
- Modify: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `Situation.cornerRatio`、`steerCommand` 的 `seaHeight` 參數（Task 2 已加）
- Produces: `export function extendPitchAngle(cornerRatio: number, groundClearance: number, cfg?: SteerConfig): number`；`SteerConfig` 新增 `pitchSpeedGain`、`pitchAltitudeGain`、`clearanceScale`

- [ ] **Step 1: 改寫 `ai-steer.test.ts` 的 extend 俯仰區塊**

把整個舊區塊（`aimPitch` helper 與其五個案例）換成：

```ts
describe('extend 的俯仰是連續量', () => {
  const CLEAR = DEFAULT_STEER.clearanceScale

  it('高空缺速度 → 俯衝換速度', () => {
    expect(extendPitchAngle(0.6, 4000)).toBeLessThan(0)
  })

  it('高空速度充足 → 爬升把速度存成高度', () => {
    expect(extendPitchAngle(1.3, 4000)).toBeGreaterThan(0)
  })

  /**
   * 【低空缺速度 → 平飛加速】兩個分量抵消。這是自己長出來的，不是額外
   * 寫的規則 —— 低空不能用高度換速度（spec §7.2）。
   */
  it('低空缺速度時，俯衝傾向被高度項抵消', () => {
    const high = extendPitchAngle(0.6, 4000)
    const low = extendPitchAngle(0.6, CLEAR * 0.4)
    expect(low).toBeGreaterThan(high)
  })

  it('極低空 → 爬升（高度項主導）', () => {
    expect(extendPitchAngle(0.6, 0)).toBeGreaterThan(0)
  })

  it('都不缺時趨近平飛', () => {
    expect(extendPitchAngle(1, 4000)).toBeCloseTo(0, 9)
  })

  it('夾在 ±extendPitch 之間', () => {
    // cornerRatio 極低 = 嚴重缺速度 → 俯衝到底（負）
    expect(extendPitchAngle(-5, 4000)).toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
    // cornerRatio 極高 = 速度過剩 → 爬升到底，把速度存成高度（正）
    expect(extendPitchAngle(5, 4000)).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
  })

  /**
   * 【這一條是缺陷 4 的守門員】舊版是
   * `(energyReserve < 0 || y < 1000) ? +25° : −sign(ΔE) × 25°` —— 兩個
   * 裸門檻，跨線時指令從 +25° 瞬間翻成 −25°。飛機有俯仰慣性，跨線後要
   * 幾秒才轉得過來，於是衝過頭、翻號、再衝過頭 —— 極限環。實測在
   * 1000 m 線上持續震盪 40 秒，週期約 5 秒（spec §3.5）。
   *
   * 連續函數沒有翻轉點，所以斷言它的數值導數有界。
   */
  it('對高度連續：相鄰 1 m 的俯仰差不超過上限的 1%', () => {
    const limit = DEFAULT_STEER.extendPitch * 0.01
    for (let h = 0; h <= 2000; h += 25) {
      const a = extendPitchAngle(0.8, h)
      const b = extendPitchAngle(0.8, h + 1)
      expect(Math.abs(b - a)).toBeLessThan(limit)
    }
  })

  it('對速度連續：相鄰 0.01 的 cornerRatio 差不超過上限的 10%', () => {
    const limit = DEFAULT_STEER.extendPitch * 0.1
    for (let r = 0.2; r <= 2; r += 0.01) {
      const a = extendPitchAngle(r, 4000)
      const b = extendPitchAngle(r + 0.01, 4000)
      expect(Math.abs(b - a)).toBeLessThan(limit)
    }
  })

  it('steerCommand 的 extend 分支用的就是這個角度', () => {
    const basis = createEngageBasis()
    const sit = createSituation()
    const cmd = createCommand()
    const knobs: Knobs = { leadLag: 0, vertical: 0 }
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.cornerRatio = 0.6
    sit.speedMargin = 2
    sit.stallMargin = 2
    steerCommand('extend', 'normal', sit, basis, self, 0, knobs, cmd)
    const commanded = Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))
    expect(commanded).toBeCloseTo(extendPitchAngle(0.6, 4000), 9)
  })
})
```

移除測試檔頂端對 `ENERGY_FLOOR_ALTITUDE` 的 import，加上 `extendPitchAngle`。

- [ ] **Step 2: 跑測試確認紅燈**

Run: `npx vitest run test/unit/ai-steer.test.ts -t 'extend 的俯仰是連續量'`
Expected: FAIL —— `extendPitchAngle is not defined`。

- [ ] **Step 3: 加設定欄位**

`src/ai/steer.ts`。因為兩個增益要引用 `extendPitch`，先把它提成模組層常數：

```ts
/** extend 的爬升／俯衝角上限，rad。兩個增益都以它為基準 */
const EXTEND_PITCH = 25 * (Math.PI / 180)
```

`SteerConfig` 加三個欄位：

```ts
  /**
   * 速度赤字 → 俯仰的增益。
   *
   * 【`4 × extendPitch` 怎麼來的】速度赤字 0.25 恰好是 `cornerRatio` 跌到
   * `DEFAULT_RULES.cornerEnter`（0.75）的那一刻，此時應該給滿俯衝角：
   * `extendPitch / 0.25 = 4 × extendPitch`。
   *
   * **起始值，待 Task 10 由實測回填。**
   */
  pitchSpeedGain: number
  /**
   * 高度赤字 → 俯仰的增益。
   *
   * 【`2 × extendPitch` 怎麼來的】高度赤字 0.5（離地約 250 m）時就抵銷
   * 滿值的速度項，確保「低空缺速度 → 平飛」而不是俯衝。
   *
   * **起始值，待 Task 10 由實測回填。**
   */
  pitchAltitudeGain: number
  /** 高度赤字的特徵離地高度，m。約為安全層 clearance（120 m）的四倍 */
  clearanceScale: number
```

`DEFAULT_STEER` 補上：

```ts
  extendPitch: EXTEND_PITCH,
  pitchSpeedGain: 4 * EXTEND_PITCH,
  pitchAltitudeGain: 2 * EXTEND_PITCH,
  clearanceScale: 500,
```

- [ ] **Step 4: 實作 `extendPitchAngle`**

放在 `steerCommand` 之前：

```ts
/**
 * `extend` 的俯仰角，rad。正 = 爬升。
 *
 * 【為什麼是兩個分量相加而不是 if-else】舊版用兩個裸門檻
 * （`energyReserve < 0`、`y < 1000`）決定爬或衝，跨線時指令瞬間翻號。
 * 飛機有俯仰慣性，跨線後要幾秒才轉得過來，於是衝過頭、翻號、再衝過頭
 * —— 極限環，振幅由飛機的俯仰響應決定，不由任何設計參數決定。實測在
 * 1000 m 線上持續震盪 40 秒（spec §3.5）。連續函數沒有翻轉點。
 *
 * 【高度分量的來源是離地餘裕，不是能量判準】「我還打得動嗎」只問速度
 * （spec §4.1）；高度出現在這裡是因為**低空不能用高度換速度**，那是
 * 安全關切，與能量判斷在不同的軸上。三種情況自然長出來：
 *
 *   高空缺速度 → 高度赤字 0，純俯衝換速度
 *   低空缺速度 → 兩項抵消，平飛加速
 *   極低空     → 高度項主導，爬升
 *
 * @param cornerRatio TAS ÷ 角落速度
 * @param groundClearance 離地（海面）高度，m
 */
export function extendPitchAngle(
  cornerRatio: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const speedDeficit = 1 - cornerRatio
  let altitudeDeficit = 1 - groundClearance / cfg.clearanceScale
  if (altitudeDeficit < 0) altitudeDeficit = 0
  else if (altitudeDeficit > 1) altitudeDeficit = 1

  const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * altitudeDeficit
  if (raw < -cfg.extendPitch) return -cfg.extendPitch
  if (raw > cfg.extendPitch) return cfg.extendPitch
  return raw
}
```

- [ ] **Step 5: 接到 `steerCommand`**

`case 'extend'` 整段換成：

```ts
      case 'extend': {
        // 【卸載】把瞄準點放到自身速度向量上，指揮儀就沒有轉向需求，
        // 過載趨近 1 G、誘導阻力最小 —— 這是能量重整的核心手段。
        // 俯仰由速度赤字與離地餘裕連續決定（見 extendPitchAngle）。
        const clearance = self.state.position.y - seaHeight
        unloadAim(self, extendPitchAngle(sit.cornerRatio, clearance, cfg), out.aimWorld)
        break
      }
```

移除 `ENERGY_FLOOR_ALTITUDE` 的 import。

- [ ] **Step 6: 跑全部單元測試**

Run: `npx vitest run test/unit/`
Expected: 全部 PASS。若 Task 8 Step 6 有 `it.skip`，這時要解除並確認通過。

- [ ] **Step 7: 跑兩個迴歸測試**

Run: `npx vitest run test/integration/`
Expected: 全部 PASS。`longestExtend` 應大幅下降（不再自我維持）。

- [ ] **Step 8: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "fix: extend 的俯仰改成連續量，消除一千公尺線上的極限環"
```

---

## Task 10: 收緊門檻、回填常數、更新 README

**Files:**
- Modify: `test/integration/ai-manoeuvre.test.ts`
- Modify: `test/integration/ai-targeting.test.ts`
- Modify: `src/ai/steer.ts`、`src/ai/safety.ts`、`src/ai/target.ts`、`src/ai/wingman.ts`、`src/ai/rules.ts`（常數註解）
- Modify: `README.md`

**Interfaces:**
- Consumes: 前九個 Task 的全部成果
- Produces: 無新介面

- [ ] **Step 1: 確認測量環境乾淨**

Run: `netstat -ano | grep -i listening | grep 5173`
Expected: 沒有輸出。若有 vite dev server 在跑，先關掉 —— 它與瀏覽器分頁都會讓量測失真。

- [ ] **Step 2: 跑全套測試取得最終數字**

Run: `npx vitest run`
Expected: 全綠。在兩個迴歸測試檔的統計函數回傳前暫時加 `console.log`，記下：

- 機動測試六場各自的 `belowStall`、`safetyShare`、`longestExtend`、`steepShare`、`offNose`
- 目標測試的 `holdMedian`、`rearShare`、`fireShare`、`onNose`、`maxLocks`

移除 `console.log`。

- [ ] **Step 3: 收緊門檻**

把兩個 `BASELINE` 改成依實測回填的最終門檻，取「實測值加上合理餘裕」：

- 上限型（`belowStall`、`rearShare`、`longestExtend`、`offNose`）：取實測最差值 × 1.3，向上取整到易讀的數字
- 下限型（`holdMedian`、`fireShare`、`onNose`）：取實測最差值 × 0.7

把常數名從 `BASELINE` 改成 `LIMITS`，並改寫註解：說明這些是修補**後**的實測回填值，附上修補前的對照數字，與 `MAX_SWITCHES`、`MAX_LOCKS` 的既有寫法一致。

**若某個指標沒有改善或反而變差，不要收緊了事** —— 停下來回報，那代表某一批沒有達到預期。

- [ ] **Step 4: 回填常數**

檢視 spec §9 的每一個常數，把註解裡的「**起始值，待 Task 10 由實測回填**」改成實測結論。若某個起始值在量測中證實需要調整，就調整並記錄掃描資料（照 `DEFAULT_TARGET` 的既有寫法，列出試過的值與各自的結果）：

| 常數 | 檔案 |
|---|---|
| `speedRecoverPitch`、`speedRecoverMargin`、`unloadMargin` | `src/ai/steer.ts` |
| `pitchSpeedGain`、`pitchAltitudeGain`、`clearanceScale` | `src/ai/steer.ts` |
| `stallMargin`、`stallRecoveryPitch` | `src/ai/safety.ts` |
| `turnTimeScale` | `src/ai/target.ts`、`src/ai/wingman.ts`（兩處必須同值） |
| `cornerEnter`、`cornerExit` | `src/ai/rules.ts` |
| `switchMargin` | `src/ai/target.ts` —— **依 spec §6.3 決定去留**：暫時設為 0 再跑一次目標測試，若 `holdMedian` 不下降就刪掉這個欄位與相關邏輯，否則保留並記錄這次量測 |
| 僚機 `minDwell` | `src/ai/wingman.ts` |

- [ ] **Step 5: 跑效能閘門**

Run: `npx vitest run test/performance/`
Expected: 全綠。`turnTime` 進了 10 Hz 的目標選擇路徑，40 架時每秒多 400 次 `instantaneousTurnRate`（無二分搜尋，只有一次 `maxLoadFactorAero` 與一次開根號）。若閘門紅了，先確認沒有 dev server 或瀏覽器分頁在跑，再用 `npm run bench` 獨立複測。

- [ ] **Step 6: 更新 README**

`README.md` 的「架構」段落 `ai/` 那幾行，加上新的職責描述；「尚未實作」段落把「指揮 AI」保留（它仍未做），並在文件表格加入這次的 spec 與 plan 兩列：

```markdown
| AI 四缺陷修補 設計規格 | `docs/superpowers/specs/2026-08-05-ai-combat-fixes-design.md` |
| AI 四缺陷修補 實作計畫 | `docs/superpowers/plans/2026-08-05-ai-combat-fixes.md` |
```

- [ ] **Step 7: 全套驗證**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全部通過。

- [ ] **Step 8: Commit**

```bash
git add test/integration/ai-manoeuvre.test.ts test/integration/ai-targeting.test.ts \
        src/ai/steer.ts src/ai/safety.ts src/ai/target.ts src/ai/wingman.ts \
        src/ai/rules.ts README.md
git commit -m "test: 依實測回填 AI 行為門檻與全部常數"
```

- [ ] **Step 9: 交付人工驗收**

依 spec §11.2，請專案負責人在遊戲裡用 `I` 模式觀察一輪，確認五條：

1. AI 咬住一個目標後會跟到底，不再兩秒換一個
2. 不再掉頭去追後方沒在威脅它的敵機
3. 不再把自己拉到近乎垂直然後掉下來
4. 在 1000 m 附近不再出現「不轉向、只上下起伏」的行為
5. 低空（1000 m 以下）仍然會正常交戰，而不是只顧爬升

【為什麼仍要人工驗收】M4 那一輪人工驗收在 1,260 條全綠的情況下挖出六個
自動化測試抓不到的真缺陷，全部是「算對了一個錯的量」—— 與本次四個缺陷
同一類。
