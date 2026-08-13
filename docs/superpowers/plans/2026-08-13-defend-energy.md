# 破防的能量讓位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `defend`(破防)在速度見底時停止繼續爬升,打斷「只上不下的棘輪」。

**Architecture:** 新增純函數 `defendPitchBias(cornerRatio, cfg)`,回傳一個**恆 ≤ 0** 的俯仰偏置,由既有的 `applyPitchBias` 後處理消費(方位不變)。`defendAim` 的幾何軸完全不動。出貨值先設 0(逐位元恆等),掃描後回填。

**Tech Stack:** TypeScript、three.js、vitest。無新相依。

**Spec:** `docs/superpowers/specs/2026-08-13-defend-energy-design.md`

## Global Constraints

- **所有新增量測的觀察窗 ≥ 120 秒。** `steer.ts` 記載的既有教訓:30 秒的窗看不到高度問題。
- **量測一律跑 `battleConfigFrom(DEFAULT_SKIRMISH)`(VETERAN)**,不是 `DEFAULT_BATTLE`(ACE)。ACE 下指揮層幾乎不發命令。
- **兩個開局當誤差棒:`2000 m / 200 m/s` 與 `4000 m / 200 m/s`。** 種子不進物理路徑(只取飛行員名字),改種子得不到獨立樣本。
- **雜訊底線 393 m** —— 同一組設定下兩個開局的結束高度差。小於它的改善不算數。
- **「結束高度」的定義固定為 `t = 419 s` 那一格的高度中位**(與 `altitude-drift.probe.ts` 一致)。不可與「最後 60 秒中位」混用。
- **`defendEnergyGain = 0` 必須逐位元等於現況。**
- **護欄若移動但未破門檻,列表交專案負責人裁定,不自行重新定值。**
- 探針一律 `test/tools/*.probe.ts`,**不是測試**;改 `DEFAULT_*` 之後必須在 `finally` 還原。

---

### Task 0: 止損閘門 —— `defendTilt` 的消融

**這個任務可能會結束整個計畫。** 若高度對 `defendTilt` 沒有反應,`defend` 就不是可用的槓桿,後面四個任務全部作廢。

**Files:**
- Create: `test/tools/drift.ts`(共用量測,Task 3 也會用)
- Create: `test/tools/defend-tilt.probe.ts`

**Interfaces:**
- Consumes: `DEFAULT_STEER.defendTilt`(既有欄位,`20 * (Math.PI / 180)`)
- Produces:
  - `test/tools/drift.ts` 匯出 `Opening`、`DriftRow`、`OPENINGS`、`measureDrift(opening: Opening): DriftRow`、`showDrift(label: string, opening: Opening, r: DriftRow): void`
  - 一張表,決定計畫是否繼續;以及 Task 4 的門檻要用的「槓桿最大推力」

- [ ] **Step 1: 寫共用量測模組**

Create `test/tools/drift.ts`:

```ts
/**
 * 高度漂移的共用量測。**不是測試,也不是探針** —— 探針 import 它。
 *
 * 【為什麼抽出來】`defend-tilt.probe.ts`（Task 0，掃 `defendTilt`）與
 * `defend-energy.probe.ts`（Task 3，掃 `defendEnergyGain`）量的是**完全相同
 * 的東西**，只有「掃哪個旋鈕」不同。複製一份會讓兩張表的定義偷偷分岔，而
 * 這次的主判準正是靠「兩張表可以直接比」才成立的。
 *
 * 【定義固定，不可與別的探針混用】
 *   結束高度   `t = 419 s` 那一格的高度中位（與 `altitude-drift.probe.ts` 一致）
 *   最大回落   每 60 秒取一格中位，相鄰兩格差值中最負者的絕對值；
 *              全程單調上升時為 0
 *
 * 【觀察窗 420 秒】`steer.ts` 記載的教訓：30 秒的窗看不到高度問題，高度要
 * 120 秒以上才看得出來。
 *
 * 【跑 VETERAN 不是 ACE】`battleConfigFrom(DEFAULT_SKIRMISH)` 是玩家實際玩到
 * 的配置；`DEFAULT_BATTLE` 是 `ACE`，那個難度下指揮層幾乎不發命令。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
/** 每秒取樣一次 */
const STRIDE = 240
/** 每隔幾秒記一格高度中位。「最大回落」在這個解析度上算 */
const REPORT = 60

export interface Opening {
  name: string
  altitude: number
  tas: number
}

/** 兩個開局當誤差棒。種子不進物理路徑，改種子得不到獨立樣本 */
export const OPENINGS: readonly Opening[] = [
  { name: '2000/200', altitude: 2000, tas: 200 },
  { name: '4000/200', altitude: 4000, tas: 200 },
]

export interface DriftRow {
  /** 每 60 秒一格的高度中位 */
  series: number[]
  altEnd: number
  drawdown: number
  extendShare: number
  engageShare: number
  safety: number
  damage: number
  alive: string
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** 跑一場，回傳主判準與副判準。**呼叫端負責改／還原設定。** */
export function measureDrift(opening: Opening): DriftRow {
  const cfg = {
    ...battleConfigFrom(DEFAULT_SKIRMISH),
    altitude: opening.altitude,
    tas: opening.tas,
  }
  const b = createBattle(new AiController(), cfg, 20260813)
  const cs: Combatant[] = b.world.combatants
  const hp0 = cs.map((c) => c.hp)
  const series: number[] = []
  const alts: number[] = []
  let acc = 0, samples = 0, extendN = 0, engageN = 0, safetyN = 0
  let altEnd = Number.NaN

  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    if (s % STRIDE !== 0) continue
    alts.length = 0
    for (const c of cs) {
      if (!c.alive) continue
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      samples++
      if (ai.intent === 'extend') extendN++
      if (ai.intent === 'engage') engageN++
      if (ai.safetyAction !== 'none') safetyN++
      alts.push(c.aircraft.state.position.y)
    }
    const m = median(alts)
    if (Number.isFinite(m)) altEnd = m
    acc += STRIDE * DT
    if (acc >= REPORT) { series.push(m); acc = 0 }
  }

  let drawdown = 0
  for (let i = 1; i < series.length; i++) {
    const d = series[i]! - series[i - 1]!
    if (d < 0 && -d > drawdown) drawdown = -d
  }

  let damage = 0, blue = 0, red = 0
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    damage += Math.max(0, hp0[i]! - c.hp)
    if (!c.alive) continue
    if (b.blue.includes(c)) blue++
    else red++
  }

  const n = Math.max(samples, 1)
  return {
    series, altEnd, drawdown,
    extendShare: extendN / n,
    engageShare: engageN / n,
    safety: safetyN / n,
    damage,
    alive: `${blue}:${red}`,
  }
}

/** 表頭。與 `showDrift` 的欄位對齊 */
export const DRIFT_HEADER =
  '設定      開局      結束高度  漲幅   **最大回落** ｜ extend engage 安全層 ｜ 存活  傷害'

export function showDrift(label: string, opening: Opening, r: DriftRow): void {
  const gain = r.altEnd - opening.altitude
  console.log(
    `${label.padEnd(8)} ${opening.name.padStart(9)}  `
    + `${r.altEnd.toFixed(0).padStart(6)} m `
    + `${(gain >= 0 ? '+' : '') + gain.toFixed(0)}`.padStart(7) + '  '
    + `${r.drawdown.toFixed(0).padStart(8)} m ｜ `
    + `${(r.extendShare * 100).toFixed(1).padStart(5)}% `
    + `${(r.engageShare * 100).toFixed(1).padStart(5)}% `
    + `${(r.safety * 100).toFixed(2).padStart(5)}% ｜ `
    + `${r.alive.padStart(5)} ${r.damage.toFixed(0).padStart(6)}`,
  )
  console.log(`         序列 ${r.series.map((x) => x.toFixed(0)).join(' → ')}`)
}
```

- [ ] **Step 2: 寫止損閘門探針**

Create `test/tools/defend-tilt.probe.ts`:

```ts
/**
 * **止損閘門**：高度對 `defendTilt` 有沒有反應？**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/defend-tilt.probe.ts
 *
 * 【這一支存在的理由】2026-08-13 的 `pitchSurplusGain` 蓋完整套才發現「關到
 * 底都沒差」，白燒一輪。這次先問「這根槓桿接得上嗎」再決定要不要蓋。
 *
 * 【不改任何出貨值】`defendTilt` 已經是 `SteerConfig` 的欄位，這裡在跑之前
 * 改它、跑完在 `finally` 還原。這是**量測**，不是改動。
 *
 * 【主判準見 spec §3.1】結束高度漲幅、以及**最大回落 > 0**。第二個才是
 * 「單向」的直接判準 —— 只看第一個會被「爬得慢一點但仍然只上不下」騙過去。
 */
import { DEFAULT_STEER } from '../../src/ai/steer'
import { measureDrift, showDrift, DRIFT_HEADER, OPENINGS } from './drift'

const RAD = Math.PI / 180

console.log('20v20、420 秒、VETERAN、兩個開局。出貨 defendTilt = 20°\n')
console.log(DRIFT_HEADER)
for (const deg of [20, 10, 0, -10]) {
  for (const o of OPENINGS) {
    const saved = DEFAULT_STEER.defendTilt
    DEFAULT_STEER.defendTilt = deg * RAD
    try {
      showDrift(`${deg}°`, o, measureDrift(o))
    } finally {
      DEFAULT_STEER.defendTilt = saved
    }
  }
}
console.log('\n【止損判準】')
console.log('　抬角由 20° 掃到 −10°，若「漲幅」的變化小於 393 m（開局間雜訊），')
console.log('　且「最大回落」始終為 0 —— 這根槓桿接不上，整個計畫當場結案。')
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 4: 跑探針**

Run: `npx vite-node test/tools/defend-tilt.probe.ts`
Expected: 印出八列(四個抬角 × 兩個開局),每列下面附高度序列。

- [ ] **Step 5: 判定**

比較 `20°`(基準,結束漲幅 +2823 / +1245、最大回落 0 / 0)與 `0°` 及 `−10°`:

- **繼續**:漲幅變化 > 393 m,**或**最大回落由 0 變成正數
- **結案**:兩個指標都沒動 → 在 spec 補一節「Task 0 否決」,提交,停止

- [ ] **Step 6: Commit**

```bash
git add test/tools/drift.ts test/tools/defend-tilt.probe.ts
git commit -m "test: defendTilt 的消融 —— 破防能量讓位的止損閘門"
```

---

### Task 1: `defendPitchBias` 純函數

**Files:**
- Modify: `src/ai/steer.ts`(`SteerConfig` 加兩個欄位、`DEFAULT_STEER` 加兩個值、新增 `defendPitchBias`)
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `SteerConfig`、`DEFAULT_STEER`(既有)
- Produces:
  - `SteerConfig.defendEnergyGain: number` —— 速度赤字 → 壓機頭的增益,rad
  - `SteerConfig.defendEnergyLimit: number` —— 偏置的絕對值上限,rad
  - `export function defendPitchBias(cornerRatio: number, cfg?: SteerConfig): number` —— 回傳 **≤ 0** 的 rad
  - `DEFAULT_STEER.defendEnergyGain = 0`(恆等)、`DEFAULT_STEER.defendEnergyLimit = 40 * (Math.PI / 180)`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-steer.test.ts` 的 `describe('extend 的俯仰是連續量', ...)` **之後**新增:

```ts
describe('破防的能量讓位', () => {
  /** 一組非零的增益，用來測形狀。出貨值是 0（恆等） */
  const armed = {
    ...DEFAULT_STEER,
    defendEnergyGain: DEFAULT_STEER.defendTilt / 0.25,
  }

  /**
   * 【恆 ≤ 0 是這一層的核心約束】系統已經只上不下（2026-08-13 追出的棘輪），
   * 任何新機制都不該再加「上」。少了這一條，`cornerRatio > 1` 時偏置會變正，
   * 等於再疊一份爬升 —— 那正是 `pitchSurplusGain` 那一輪證實無效且方向錯誤
   * 的東西。
   */
  it('永遠不會是正的（只壓不抬）', () => {
    for (let r = 0; r <= 3; r += 0.05) {
      expect(defendPitchBias(r, armed)).toBeLessThanOrEqual(0)
    }
  })

  it('速度充足（cornerRatio ≥ 1）→ 恰為 0，防禦抬角原封不動', () => {
    expect(defendPitchBias(1, armed)).toBe(0)
    expect(defendPitchBias(1.5, armed)).toBe(0)
    expect(defendPitchBias(3, armed)).toBe(0)
  })

  /**
   * 【錨在脫離門檻】`cornerRatio` 掉到 `DEFAULT_RULES.cornerEnter`（0.75，
   * 該撤退的那條線）時，偏置剛好抵銷 `defendTilt`（20°）—— 還撐得住就照原本
   * 閃，撐到該撤退了就先別再往上爬。
   */
  it('掉到脫離門檻時剛好抵銷防禦抬角', () => {
    expect(defendPitchBias(0.75, armed)).toBeCloseTo(-DEFAULT_STEER.defendTilt, 9)
  })

  it('比脫離門檻更低 → 真的變成俯衝（超過抵銷）', () => {
    expect(defendPitchBias(0.5, armed)).toBeLessThan(-DEFAULT_STEER.defendTilt)
  })

  it('夾在 −defendEnergyLimit 以上', () => {
    expect(defendPitchBias(-10, armed)).toBeCloseTo(-armed.defendEnergyLimit, 9)
  })

  /**
   * 【連續性】這個專案治過三次「相鄰輸入給出跳躍的輸出」（`latch` 的遲滯、
   * `extendPitchAngle` 的連續化、破防軸的號誌閂鎖），每一次的症狀都是極限環。
   * 分界點在 `cornerRatio = 1`。
   */
  it('對 cornerRatio 連續：相鄰 0.001 的差不超過上限的 1%', () => {
    const limit = armed.defendEnergyLimit * 0.01
    for (let r = 0.3; r <= 2; r += 0.001) {
      const a = defendPitchBias(r, armed)
      const b = defendPitchBias(r + 0.001, armed)
      expect(Math.abs(b - a)).toBeLessThan(limit)
    }
  })

  /**
   * 【恆等基準】出貨值是 0。本輪已經兩次靠恆等基準才驗得出「重構沒有偷偷改到
   * 別的東西」（`manoeuvreGFraction`、`pitchSurplusGain`）。
   */
  it('出貨值是 0 —— 這一層預設不生效', () => {
    expect(DEFAULT_STEER.defendEnergyGain).toBe(0)
    for (let r = 0; r <= 3; r += 0.1) {
      expect(defendPitchBias(r)).toBe(0)
    }
  })
})
```

同時把 `defendPitchBias` 加進該檔頂端的 import:

```ts
import {
  aimFromKnobs, buildEngageBasis, createEngageBasis, engageKnobs, extendPitchAngle,
  geometryGate, steerCommand, DEFAULT_STEER, type Knobs,
  createDefendState, stepDefend, defendAim, floorPitchAngle, applyFloor, unloadPull, applyPitchBias,
  defendPitchBias,
} from '../../src/ai/steer'
```

- [ ] **Step 2: 跑測試確認它紅**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL —— `defendPitchBias` 不存在(匯入錯誤,整個檔案掛掉)

- [ ] **Step 3: 加兩個設定欄位**

在 `src/ai/steer.ts` 的 `SteerConfig` 裡,`defendTilt: number` **之後**插入:

```ts
  /**
   * 破防時「速度赤字 → 壓機頭」的增益，rad。**0 = 這一層不生效（出貨值）。**
   *
   * 【為什麼要有這一層】`defendAim` 固定往上抬 `defendTilt`（20°），不管有沒有
   * 速度。那 20° 是 2026-08-07 在 800 m 尾追、90 秒的場景掃出來的，當初的判準
   * 就是高度（0° 會掉 1713 m），選 20° 是為了**止跌**。同一個常數在 20v20 裡
   * 變成一路爬：2026-08-13 量到 `defend` 每秒淨爬升 12.8 m。
   *
   * **不是漏做，是一個為單一場景校準的常數在別的場景過頭了。**
   *
   * 【錨】起始值取 `defendTilt / (1 − DEFAULT_RULES.cornerEnter)` = 20° / 0.25
   * = 80°，意思是「`cornerRatio` 掉到該撤退的那條線時，偏置剛好把防禦抬角抵銷
   * 成平飛」。再低才真的變成俯衝。定值由掃描回填。
   *
   * 【為什麼不直接改 `defendTilt`】那會作廢 2026-08-07 的掃描表。這一層疊在
   * 後處理（`applyPitchBias`），幾何軸一個字不動。
   */
  defendEnergyGain: number
  /** `defendPitchBias` 的絕對值上限，rad。防止極低速時把機頭壓到垂直 */
  defendEnergyLimit: number
```

在 `DEFAULT_STEER` 裡,`defendTilt: 20 * (Math.PI / 180),` **之後**插入:

```ts
  // 【0 = 恆等，這一層預設不生效】掃描定值見 2026-08-13 的計畫 Task 3
  defendEnergyGain: 0,
  defendEnergyLimit: 40 * (Math.PI / 180),
```

- [ ] **Step 4: 寫最小實作**

在 `src/ai/steer.ts` 的 `extendPitchAngle` 函數**之後**新增:

```ts
/**
 * 破防時的能量讓位偏置，rad。**恆 ≤ 0**（只壓不抬）。
 *
 * ```
 * bias = −defendEnergyGain × max(0, 1 − cornerRatio)，夾在 [−defendEnergyLimit, 0]
 * ```
 *
 * 【為什麼恆 ≤ 0】2026-08-13 追出的病是**只上不下的棘輪**：往上是拉桿轉彎的
 * 自然結果、隨時做得到；往下需要幾秒不被打擾，而一段 `extend` 中位只有
 * 3.6 秒、56~58% 被 `defend` 插隊終止。系統已經缺「下」，任何新機制都不該
 * 再加「上」。
 *
 * `max(0, …)` 因此是**必要的**，不是防禦性程式：少了它，`cornerRatio > 1`
 * 時偏置會變正，等於再疊一份爬升 —— 那正是 `pitchSurplusGain` 那一輪證實
 * 無效且方向錯誤的東西（見 `pitchSpeedGain` 的註解）。
 *
 * 【與 `extendPitchAngle` 的分工】那一個是 `extend` 的**主要動作**（換能量
 * 本身就是它的目的）；這一個是 `defend` 的**讓位**——閃躲仍然由
 * `defendAim` 的幾何決定，這一層只在速度見底時把航跡角壓下來。所以它單向、
 * 而且上限小得多。
 *
 * 【消費者】`steerCommand` 在 `intent === 'defend'` 時把它加進既有的那一次
 * `applyPitchBias` 呼叫。**不新增第二次旋轉** —— 兩次旋轉有次序相依，而且
 * 各自夾制會讓合成結果難以推理。
 *
 * @param cornerRatio `Situation.cornerRatio` = TAS ÷ 角落速度
 */
export function defendPitchBias(
  cornerRatio: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const deficit = 1 - cornerRatio
  if (deficit <= 0) return 0
  const raw = -cfg.defendEnergyGain * deficit
  return raw < -cfg.defendEnergyLimit ? -cfg.defendEnergyLimit : raw
}
```

- [ ] **Step 5: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS,全部通過(既有的 115 條 + 新增的 7 條 = 122)

- [ ] **Step 6: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: defendPitchBias 純函數 —— 破防時的能量讓位（出貨值 0，恆等）"
```

---

### Task 2: 接進 `steerCommand`,確認逐位元恆等

**Files:**
- Modify: `src/ai/steer.ts` —— `steerCommand` 的瞄準分支(約 1375~1424 行,加 `defendTilted` 旗標)與 `applyPitchBias` 的呼叫點(原 1456 行)
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `defendPitchBias`(Task 1)、`Situation.cornerRatio`、`applyPitchBias(deltaPitch: number, aim: Vector3): void`(既有)、`DefendState.reversal` / `DefendState.attacker`(既有)
- Produces: 無新介面。`steerCommand` 的簽名不變,`defendTilted` 是函數內的區域變數。

- [ ] **Step 1: 寫失敗的測試**

在 Task 1 新增的 `describe('破防的能量讓位', ...)` 內,**最後**追加:

```ts
  /**
   * 【接線的守門員】純函數綠不代表接上了。
   *
   * 【為什麼「關閉組」明寫 `defendEnergyGain: 0` 而不是用 `DEFAULT_STEER`】
   * Task 3 會把出貨值回填成非零。拿 `DEFAULT_STEER` 當關閉組的話，回填到
   * 1×錨 時兩組相等、回填到 1.5× 或 2× 時大小關係反轉 —— 這條測試會在調參
   * 的那一刻失效或反向紅。
   */
  const scene = () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])
    const sit = createSituation()
    const basis = createEngageBasis()
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 2
    sit.speedMargin = 5
    sit.cornerRatio = 0.6
    sit.sweetPitch = 0
    sit.pullCeiling = 1
    return { self, sit, basis }
  }
  const OFF = { ...DEFAULT_STEER, defendEnergyGain: 0 }
  const ON = { ...DEFAULT_STEER, defendEnergyGain: DEFAULT_STEER.defendTilt / 0.25 }

  it('接線：只有 defend 吃這一層', () => {
    const { self, sit, basis } = scene()
    const k: Knobs = { leadLag: 0, vertical: 0 }
    const cmd = createCommand()
    const gamma = () => Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))

    steerCommand('defend', 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd, OFF)
    const defendOff = gamma()
    steerCommand('defend', 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd, ON)
    const defendOn = gamma()
    steerCommand('engage', 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd, OFF)
    const engageOff = gamma()
    steerCommand('engage', 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd, ON)
    const engageOn = gamma()

    // defend 被壓低了
    expect(defendOn).toBeLessThan(defendOff)
    // engage 完全不受影響
    expect(engageOn).toBeCloseTo(engageOff, 12)
  })

  /**
   * 【`intent === 'defend'` 不等於本幀走了 `defendAim`】這是 Codex 審查抓出來
   * 的。`steerCommand` 的瞄準分支裡，`defend` 意圖有**五條**不同的路徑：
   *
   * ```
   *   mode === 'planeDegenerate'   losAxis          沒有 defendTilt
   *   mode === 'speedRecover'      unloadAim(−20°)  沒有，而且**已經在壓機頭**
   *   mode === 'overshoot'         高 yo-yo          沒有
   *   reversal > 0                 reversalAim      沒有
   *   其餘                          defendAim        **只有這條有那 20° 抬角**
   * ```
   *
   * 這一層的存在理由是「抵銷那個固定抬角」。在沒有抬角的四條路徑上套負偏置
   * 只是平白壓機頭 —— 最糟的是 `speedRecover`：它本來就在壓
   * `speedRecoverPitch`（20°），疊上去變兩倍，而它觸發的時機**正是速度最低、
   * 偏置最大的時候**。那正是 2026-08-13 前兩次調參「安全層替 AI 飛」的路徑。
   */
  it('幾何 mode 壓過意圖時不套這一層', () => {
    const { self, sit, basis } = scene()
    const k: Knobs = { leadLag: 0, vertical: 0 }
    const cmd = createCommand()
    const gamma = () => Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))

    for (const mode of ['planeDegenerate', 'speedRecover', 'overshoot'] as const) {
      steerCommand('defend', mode, sit, basis, self, 0, k, createDefendState(), null, cmd, OFF)
      const off = gamma()
      steerCommand('defend', mode, sit, basis, self, 0, k, createDefendState(), null, cmd, ON)
      const on = gamma()
      expect(on, mode).toBeCloseTo(off, 12)
    }
  })

  it('反轉期間不套這一層', () => {
    const { self, sit, basis } = scene()
    const attacker = flyer()
    place(attacker, [0, 4000, 300], [0, 0, -180])
    const k: Knobs = { leadLag: 0, vertical: 0 }
    const cmd = createCommand()
    const gamma = () => Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))

    const reversing = () => {
      const d = createDefendState()
      d.reversal = 1
      d.attacker = attacker
      return d
    }
    steerCommand('defend', 'normal', sit, basis, self, 0, k, reversing(), null, cmd, OFF)
    const off = gamma()
    steerCommand('defend', 'normal', sit, basis, self, 0, k, reversing(), null, cmd, ON)
    const on = gamma()
    expect(on).toBeCloseTo(off, 12)
  })

  /**
   * 【關著就等於不存在】增益 0 之下，`defend` 的瞄準點必須與這一層不存在時
   * 完全相同。與上面那條互補：上面驗「開起來有效」，這一條驗「關著沒有副作用」。
   *
   * 【為什麼明寫 `defendEnergyGain: 0` 而不是靠出貨值】Task 3 會把出貨值回填
   * 成非零。寫死 0 的設定讓這一條在回填之後**仍然驗得到同一件事**，不必跟著改
   * —— 一條會因為調參而失效的測試，等於沒有測試。
   */
  it('增益 0 時偏置恆為 0，瞄準點仍是單位向量', () => {
    const { self, sit, basis } = scene()
    const k: Knobs = { leadLag: 0, vertical: 0 }
    const cmd = createCommand()

    // 增益 0 時 defendPitchBias 恆回傳 0，applyPitchBias 對 0 直接 return
    expect(defendPitchBias(sit.cornerRatio, OFF)).toBe(0)
    steerCommand('defend', 'normal', sit, basis, self, 0, k, createDefendState(), null, cmd, OFF)
    expect(cmd.aimWorld.length()).toBeCloseTo(1, 9)
  })
```

- [ ] **Step 2: 跑測試確認「接線」那條紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "接線"`
Expected: FAIL —— `expect(defendOn).toBeLessThan(defendOff)`,兩者相等

- [ ] **Step 3: 在瞄準分支裡標記「真的用了 `defendAim`」**

**這一步是 Codex 審查加進來的。** `intent === 'defend'` **不等於**本幀走了
`defendAim`:三個幾何 mode 會壓過意圖,而 `reversal` 期間走的是 `reversalAim`。
那四條路徑都沒有 `defendTilt` 的固定抬角,補一個負偏置只是平白壓機頭 ——
最糟的是 `speedRecover`,它本來就在壓 `speedRecoverPitch`(20°),疊上去變兩倍,
而它觸發的時機正是速度最低、偏置最大的時候。

在 `src/ai/steer.ts` 的 `steerCommand` 裡,把瞄準點那一段(約 1375~1424 行)
的開頭

```ts
  // ── 瞄準點 ──────────────────────────────────────────────
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
```

改成

```ts
  // ── 瞄準點 ──────────────────────────────────────────────
  // 【為什麼要這個旗標】`intent === 'defend'` 不等於本幀走了 `defendAim` ——
  // 三個幾何 mode 壓過意圖，而 `reversal` 期間走的是 `reversalAim`。只有真的
  // 套了 `defendTilt` 的那一條路徑，才有那個固定抬角可以讓位。
  let defendTilted = false
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
```

再把 `case 'defend':` 那一支的 `else` 分支

```ts
        } else {
          defendAim(self, sit.threatLos, defend.axisSign, out.aimWorld, cfg)
        }
```

改成

```ts
        } else {
          defendAim(self, sit.threatLos, defend.axisSign, out.aimWorld, cfg)
          defendTilted = true
        }
```

- [ ] **Step 4: 改 `applyPitchBias` 的呼叫點**

`src/ai/steer.ts`(原 1456 行,加了旗標之後往後位移),把

```ts
  if (intent !== 'rally') applyPitchBias(sit.sweetPitch, out.aimWorld)
```

改成

```ts
  // 【兩個偏置相加，只旋轉一次】兩次呼叫 `applyPitchBias` 會有次序相依，而且
  // 各自夾制會讓合成結果難以推理 —— 相加之後由那一層統一夾在
  // ±PITCH_BIAS_LIMIT。
  //
  // 【為什麼要這一層】`defendAim` 固定往上抬 `defendTilt`（20°），不管有沒有
  // 速度。實測 20v20 下 `defend` 每秒淨爬升 12.8 m，而系統整體是只上不下的
  // 棘輪。見 `defendEnergyGain` 的註解。
  //
  // 【條件是 `defendTilted` 不是 `intent === 'defend'`】見上面那個旗標的註解。
  if (intent !== 'rally') {
    const defendBias = defendTilted ? defendPitchBias(sit.cornerRatio, cfg) : 0
    applyPitchBias(sit.sweetPitch + defendBias, out.aimWorld)
  }
```

- [ ] **Step 5: 跑測試確認全綠**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS。既有 115 條 + Task 1 的 7 條 + 本任務的 4 條 = 126 條。

- [ ] **Step 6: 全套回歸,確認逐位元恆等**

Run: `npx vitest run`
Expected: 與接線之前**完全相同**的紅燈清單。基準是 4 條已知紅(`ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑)+ `perf-gate`(全套並行下的假紅,單獨跑會綠)。

**多出任何一條紅 = 恆等被破壞,停下來查,不要往下做。**

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: 破防的能量讓位接進 steerCommand（出貨值 0，全套逐位元恆等）"
```

---

### Task 3: 掃描 `defendEnergyGain` 與 `defendEnergyLimit`

**Files:**
- Create: `test/tools/defend-energy.probe.ts`
- Modify: `src/ai/steer.ts`(回填 `DEFAULT_STEER.defendEnergyGain`)

**Interfaces:**
- Consumes: `DEFAULT_STEER.defendEnergyGain`、`DEFAULT_STEER.defendEnergyLimit`(Task 1)
- Produces: 回填後的出貨值 + 一張掃描表寫進 `defendEnergyGain` 的註解

- [ ] **Step 1: 寫探針**

Create `test/tools/defend-energy.probe.ts`:

```ts
/**
 * `defendEnergyGain` 的掃描。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/defend-energy.probe.ts
 * 低空壓力測試：npx vite-node test/tools/defend-energy.probe.ts low
 *
 * 【與 `defend-tilt.probe.ts` 共用同一支量測】兩者都 import `./drift`，所以
 * 兩張表的「結束高度」與「最大回落」定義保證相同、可以直接比。
 *
 * 【主判準見 spec §3.1】結束高度漲幅、以及**最大回落 > 0**。
 *
 * 【副判準只報不擋】extend／engage 佔時、傷害、存活。若高度降下來而它們沒動，
 * 那就證明「高度 → 角落速度 → extend」的因果鏈是錯的 —— 那個資訊本身就是
 * 這次要買的東西，而只有把它們放在副判準的位置才問得出來。
 *
 * 【否決條件】安全層佔時上升。2026-08-13 的前兩次調參失敗都栽在這裡
 * （`cornerEnter` 那一輪衝到 65.6%，上限 5%）。
 *
 * 【低空模式】spec §5 風險三：壓機頭在低空是危險的，而 `applyFloor` 從未在
 * 「破防 + 低空 + 低速」三者同時成立時被壓力測試過。`low` 參數把開局換成
 * 1000 m 與 600 m。
 *
 * 【0×錨 是恆等基準】與這一層不存在時逐位元相同。
 */
import { DEFAULT_STEER } from '../../src/ai/steer'
import { measureDrift, showDrift, DRIFT_HEADER, OPENINGS, type Opening } from './drift'

/** 錨：`cornerRatio` 掉到 `DEFAULT_RULES.cornerEnter`(0.75) 時剛好抵銷 `defendTilt` */
const ANCHOR = DEFAULT_STEER.defendTilt / 0.25

const LOW: readonly Opening[] = [
  { name: '1000/200', altitude: 1000, tas: 200 },
  { name: '600/180', altitude: 600, tas: 180 },
]

const low = process.argv.includes('low')
const openings = low ? LOW : OPENINGS

console.log(
  `20v20、420 秒、VETERAN、${low ? '**低空**' : ''}兩個開局。`
  + `錨 = ${(ANCHOR * 180 / Math.PI).toFixed(0)}° / 單位速度赤字\n`,
)
console.log(DRIFT_HEADER)
for (const mult of [0, 0.5, 1, 1.5, 2]) {
  for (const o of openings) {
    const saved = DEFAULT_STEER.defendEnergyGain
    DEFAULT_STEER.defendEnergyGain = mult * ANCHOR
    try {
      showDrift(`${mult.toFixed(1)}×錨`, o, measureDrift(o))
    } finally {
      DEFAULT_STEER.defendEnergyGain = saved
    }
  }
}
console.log('\n【怎麼讀】0.0×錨 是恆等基準。')
console.log('　主判準：漲幅要降（幅度 > 393 m 才算數），且最大回落要 > 0。')
console.log('　否決：安全層佔時比 0.0×錨 高 —— 低空那一輪尤其要看。')
```

**注意**:`process` 在這個專案沒有 `@types/node`。若 `tsc --noEmit` 對 `process.argv` 報錯,改成從環境判斷:

```ts
const low = (globalThis as { process?: { argv?: string[] } }).process?.argv?.includes('low') ?? false
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出。有錯就套用上面那個 `globalThis` 寫法。

- [ ] **Step 3: 跑高空掃描**

Run: `npx vite-node test/tools/defend-energy.probe.ts`
Expected: 十列(五個增益 × 兩個開局),每列下面附高度序列。

- [ ] **Step 4: 跑低空壓力測試**

Run: `npx vite-node test/tools/defend-energy.probe.ts low`
Expected: 十列。**安全層佔時不得比同一開局的 `0.0×錨` 那一列高。**

- [ ] **Step 5: 挑值並回填**

在 `src/ai/steer.ts` 把 `defendEnergyGain: 0,` 改成挑中的值,並把兩張掃描表(高空 + 低空)貼進 `defendEnergyGain` 的註解。

挑值規則,依序:

1. 低空壓力測試的安全層佔時**不得上升** —— 違反就淘汰
2. 兩個開局的「最大回落」都 > 0
3. 在通過 1、2 的候選裡,取「漲幅」平均最低的
4. 若沒有任何候選同時滿足 1 與 2 —— **不回填,維持 0**,在註解記錄否決,跳到 Task 4 只做報告

- [ ] **Step 6: 型別檢查與單元測試**

Run: `npx tsc --noEmit && npx vitest run test/unit/ai-steer.test.ts`
Expected: 無型別錯誤;測試全綠。

注意 Task 1 的「出貨值是 0」那條測試會**因為回填而變紅**。把它改成:

```ts
  it('出貨值由掃描定出，且必為非負', () => {
    expect(DEFAULT_STEER.defendEnergyGain).toBeGreaterThanOrEqual(0)
  })
```

保留同一個 `describe` 裡的其他六條(它們用 `armed` 設定,不受出貨值影響)。

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/tools/defend-energy.probe.ts test/unit/ai-steer.test.ts
git commit -m "feat: defendEnergyGain 掃描定值 —— 含低空壓力測試"
```

---

### Task 4: 全套回歸與護欄比較

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-defend-energy-design.md`(補一節「實作結果」)

**Interfaces:**
- Consumes: Task 3 回填後的出貨值
- Produces: 交專案負責人裁定的護欄逐條比較表

- [ ] **Step 1: 跑全套**

Run: `npx vitest run`
記下完整的紅燈清單與每一條的實測值。

- [ ] **Step 2: 單獨跑計時測試**

Run: `npx vitest run test/unit/perf-gate.test.ts`
理由:`perf-gate` 在全套並行下會假紅,測試自己的訊息就寫著「若非並行雜訊所致,請以 npm run bench 獨立複測」。

- [ ] **Step 3: 逐條比較三支敏感護欄**

Run: `npx vitest run test/integration/ai-manoeuvre.test.ts test/integration/ai-visible-evasion.test.ts test/integration/ai-defence.test.ts`

這三支是 spec §3.3 的否決條件所在。`ai-manoeuvre` 的 `safetyShare`(上限 0.05)與 `belowStall`(上限 0.01)是本輪前兩次失敗的死因。

- [ ] **Step 4: 寫「實作結果」一節**

在 spec 末尾追加,含:

- Task 0 消融表
- Task 3 的兩張掃描表(高空 + 低空)
- 主判準的前後對照(結束漲幅、最大回落,兩個開局)
- 副判準的前後對照(extend／engage 佔時、傷害、存活)——**含「若沒動則因果鏈推論錯誤」的明確結論**
- 全套紅燈的逐條比較(基準 4 條 vs 現在)
- 未破門檻但移動的護欄,列表交專案負責人裁定

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-defend-energy-design.md
git commit -m "docs: 破防能量讓位的實作結果與護欄逐條比較"
```

- [ ] **Step 6: 交專案負責人**

回報:主判準有沒有達成、副判準動了沒(以及那代表什麼)、哪些護欄移動需要裁定、以及人工試飛要看什麼(跟拍長機,看它在被咬且沒速度時會不會停止爬升)。
