# 破防的能量讓位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `defend`(破防)在速度見底時停止繼續爬升,打斷「只上不下的棘輪」。

**Architecture:** 新增純函數 `defendPitchBias(cornerRatio, cfg)`,回傳一個**恆 ≤ 0** 的俯仰偏置,由既有的 `applyPitchBias` 後處理消費(方位不變)。`defendAim` 的幾何軸完全不動,只多回傳一個「這一格有沒有真的套上 `defendTilt`」的布林。出貨值先設 0(逐位元恆等),掃描後回填。

**Tech Stack:** TypeScript、three.js、vitest。無新相依。

**Spec:** `docs/superpowers/specs/2026-08-13-defend-energy-design.md`

## Global Constraints

- **所有新增量測的觀察窗 ≥ 120 秒。** `steer.ts` 記載的既有教訓:30 秒的窗看不到高度問題。
- **量測一律跑 `battleConfigFrom(DEFAULT_SKIRMISH)`(VETERAN)**,不是 `DEFAULT_BATTLE`(ACE)。ACE 下指揮層幾乎不發命令。
- **兩個開局當誤差棒:`2000 m / 200 m/s` 與 `4000 m / 200 m/s`。** 種子不進物理路徑(只取飛行員名字),改種子得不到獨立樣本。
- **雜訊底線 393 m** —— 同一組設定下兩個開局的結束高度差。小於它的改善不算數。
- **「結束高度」的統計量必須與 `altitude-drift.probe.ts` 逐字相同**:每秒取樣、把整個 60 秒窗內所有存活機的高度**累積在同一個陣列**,只在報表格取中位並清空。**不是**每秒取中位再看最後一秒。393 m 與 +2823 / +1245 這些基準全部出自那個定義,換統計量就得全部重測。
- **`defendEnergyGain = 0` 必須逐位元等於現況**(包含不得回傳 `-0`)。
- **護欄若移動但未破門檻,列表交專案負責人裁定,不自行重新定值。**
- 探針一律 `test/tools/*.probe.ts`,**不是測試**;改 `DEFAULT_*` 之後必須在 `finally` 還原。

## Codex 審查已修正事項

第一輪(`77cea30`)與第二輪的完整審查結論已折進下列任務。第二輪抓到的 3 Critical:

- **C1** `gain = 0` 時 `-0 * 正數 = -0`,而 vitest 的 `toBe` 走 `Object.is` —— 恆等測試會紅。Task 1 Step 4 改成正面判斷 `> 0`。
- **C2** 計畫原本的 `measureDrift` 每秒清空高度陣列,得到的是「瞬時中位」,與既有基準的「60 秒窗中位」不是同一統計量。Task 0 Step 1 改成逐字複製既有定義。
- **C3** 挑值規則會把「飛機掉下去死掉」或「靠 `applyFloor` 抬回來」選成最佳:死亡機立即退出中位與分母,而 `safetyAction` 記的是 `applySafety`,**看不到 `steerCommand` 裡的 `applyFloor`**。Task 0 的量測補 `minAlt` 與 `floorShare`,Task 3 的挑值規則改成先過安全否決、再取**最小 gain**。

---

### Task 0: 止損閘門 —— `defendTilt` 的消融

**這個任務可能會結束整個計畫。** 若高度對 `defendTilt` 沒有反應,`defend` 就不是可用的槓桿,後面四個任務全部作廢。

**Files:**
- Create: `test/tools/drift.ts`(共用量測,Task 3 也會用)
- Create: `test/tools/defend-tilt.probe.ts`

**Interfaces:**
- Consumes: `DEFAULT_STEER.defendTilt`(既有,`20 * (Math.PI / 180)`)、`floorPitchAngle`(既有)、`AiController.seaHeight` / `.intent` / `.safetyAction`(既有公開欄位)
- Produces:
  - `test/tools/drift.ts` 匯出 `Opening`、`DriftRow`、`OPENINGS`、`measureDrift(opening: Opening): DriftRow`、`showDrift(label: string, opening: Opening, r: DriftRow): void`、`DRIFT_HEADER`
  - 一張表,決定計畫是否繼續

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
 * 【`buckets` 逐字複製 `altitude-drift.probe.ts` 的定義】那一支把整個 60 秒
 * 窗內**每一秒 × 每一架**存活機的高度全部推進同一個陣列，只在報表格取中位並
 * 清空。得到的是「60 秒窗的中位」，**不是**「每秒取中位再看最後一秒」。
 * 393 m 的雜訊底線與 +2823 / +1245 的基準全部出自那個定義 —— 換統計量，
 * 那些數字就全部作廢。這是 2026-08-14 Codex 審查的 C2。
 *
 * 【`drawdown` 用每秒序列的 running peak，不是相鄰格差值】相鄰 60 秒格的最負
 * 差值會漏掉兩種真實回落：連續三格各降 100 m（真正回落 300 m，只report 100）、
 * 以及 59 秒內降下去又爬回來（完全看不到）。而「單向棘輪有沒有被打斷」正是
 * 這一輪的主判準，量錯就整個計畫失去判準。
 *
 * 【`minAlt` 與 `floorShare` 是安全否決用的】`AiController.safetyAction` 記的
 * 是 `applySafety`（瞄準點層之後的那一層），**看不到 `steerCommand` 裡的
 * `applyFloor`**。壓機頭的參數在低空可能整段被地板接住 —— 那時 `safety` 不會
 * 漲，表面上「很安全」，實際上是地板在替 AI 飛。`floorShare` 就是為了問出
 * 這件事。這是 Codex 審查的 C3。
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
import { floorPitchAngle } from '../../src/ai/steer'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
/** 每秒取樣一次 */
const STRIDE = 240
/** 每隔幾秒收一格窗中位 */
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
  /** 每 60 秒一格的**窗中位**。與 `altitude-drift.probe.ts` 同定義 */
  buckets: number[]
  /** `buckets` 的最後一格 */
  altEnd: number
  /** 由每秒序列的 running peak 算出的最大回落，m */
  drawdown: number
  /** 全程所有存活機的最低高度，m。低空安全否決用 */
  minAlt: number
  /** `floorPitchAngle > 0`（地板正在介入）的取樣佔比 */
  floorShare: number
  extendShare: number
  engageShare: number
  /** `applySafety` 有動作的取樣佔比。**不含 `applyFloor`** */
  safety: number
  damage: number
  aliveBlue: number
  aliveRed: number
  /**
   * 任何一格沒有有效樣本（全滅）就是 false。
   *
   * 【為什麼不是靜默跳過】NaN 進了序列之後，`d < 0` 這種比較對 NaN 恆為偽，
   * 於是全滅的那一輪會顯示**過期的**結束高度與先前的回落，甚至通過挑值條件。
   * 明確標成無效、直接淘汰。這是 Codex 審查的 I3。
   */
  valid: boolean
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

  /** 跨 60 秒累積，只在報表格清空 —— 這是與既有基準相同的那一個 */
  const window: number[] = []
  /** 這一秒的存活高度，每秒清空。`drawdown` 由它的中位序列算 */
  const live: number[] = []
  const perSecond: number[] = []
  const buckets: number[] = []
  let acc = 0, samples = 0, extendN = 0, engageN = 0, safetyN = 0, floorN = 0
  let minAlt = Number.POSITIVE_INFINITY
  let valid = true

  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    if (s % STRIDE !== 0) continue
    live.length = 0
    for (const c of cs) {
      if (!c.alive) continue
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      samples++
      if (ai.intent === 'extend') extendN++
      if (ai.intent === 'engage') engageN++
      if (ai.safetyAction !== 'none') safetyN++
      const y = c.aircraft.state.position.y
      if (floorPitchAngle(y - ai.seaHeight) > 0) floorN++
      if (y < minAlt) minAlt = y
      live.push(y)
      window.push(y)
    }
    if (live.length === 0) valid = false
    perSecond.push(median(live))
    acc += STRIDE * DT
    if (acc >= REPORT) {
      if (window.length === 0) valid = false
      buckets.push(median(window))
      window.length = 0
      acc = 0
    }
  }

  // 【running peak】從歷史高點到之後任一低點的最大落差
  let peak = Number.NEGATIVE_INFINITY
  let drawdown = 0
  for (const y of perSecond) {
    if (!Number.isFinite(y)) continue
    if (y > peak) peak = y
    const d = peak - y
    if (d > drawdown) drawdown = d
  }

  let altEnd = Number.NaN
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (Number.isFinite(buckets[i]!)) { altEnd = buckets[i]!; break }
  }
  if (!Number.isFinite(altEnd)) valid = false

  let damage = 0, aliveBlue = 0, aliveRed = 0
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    damage += Math.max(0, hp0[i]! - c.hp)
    if (!c.alive) continue
    if (b.blue.includes(c)) aliveBlue++
    else aliveRed++
  }

  const n = Math.max(samples, 1)
  return {
    buckets, altEnd, drawdown,
    minAlt: Number.isFinite(minAlt) ? minAlt : Number.NaN,
    floorShare: floorN / n,
    extendShare: extendN / n,
    engageShare: engageN / n,
    safety: safetyN / n,
    damage, aliveBlue, aliveRed, valid,
  }
}

/** 表頭。與 `showDrift` 的欄位對齊 */
export const DRIFT_HEADER =
  '設定      開局      結束高度  漲幅   **回落**  最低 ｜ extend engage 安全層 地板 ｜ 存活  傷害'

export function showDrift(label: string, opening: Opening, r: DriftRow): void {
  const gain = r.altEnd - opening.altitude
  console.log(
    `${label.padEnd(8)} ${opening.name.padStart(9)}  `
    + `${r.altEnd.toFixed(0).padStart(6)} m `
    + `${(gain >= 0 ? '+' : '') + gain.toFixed(0)}`.padStart(7) + '  '
    + `${r.drawdown.toFixed(0).padStart(6)} m `
    + `${r.minAlt.toFixed(0).padStart(5)} ｜ `
    + `${(r.extendShare * 100).toFixed(1).padStart(5)}% `
    + `${(r.engageShare * 100).toFixed(1).padStart(5)}% `
    + `${(r.safety * 100).toFixed(2).padStart(5)}% `
    + `${(r.floorShare * 100).toFixed(2).padStart(5)}% ｜ `
    + `${`${r.aliveBlue}:${r.aliveRed}`.padStart(5)} ${r.damage.toFixed(0).padStart(6)}`
    + (r.valid ? '' : '  ← 無效（有一格全滅）'),
  )
  console.log(`         窗中位 ${r.buckets.map((x) => x.toFixed(0)).join(' → ')}`)
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
 * 【判準必須指定方向】Codex 審查的 I4：只寫「變化 > 393 m」的話，抬角調低
 * 反而爬得**更多**也算通過 —— 那是反證，不是支持。方向、兩個開局的一致性、
 * 最小效果量三者缺一不可。
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
console.log('\n【止損判準 —— 三條全部要成立才繼續】')
console.log('　一、方向：抬角 20° → 0° → −10°，結束高度必須**單調變低**。')
console.log('　　　變高 = 這根槓桿的因果方向與假設相反，計畫作廢。')
console.log('　二、一致性：兩個開局同向。只有一個開局動 = 雜訊。')
console.log('　三、效果量：20° 與 −10° 的結束高度差 > 393 m（開局間雜訊底線），')
console.log('　　　**或**回落由 ~0 明顯變大且兩個開局同向。')
console.log('　任何一條不成立 —— 這根槓桿接不上，整個計畫當場結案。')
console.log('　另：任何一列標了「無效」就重跑該列，不得拿進判定。')
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 4: 跑探針**

Run: `npx vite-node test/tools/defend-tilt.probe.ts`
Expected: 印出八列(四個抬角 × 兩個開局),每列下面附窗中位序列。

- [ ] **Step 5: 判定**

套用 Step 2 印出來的三條判準。20° 那一列就是基準(既有量測:結束漲幅 +2823 / +1245、回落 ~0)。

- **繼續**:三條全部成立
- **結案**:任何一條不成立 → 在 spec 補一節「Task 0 否決」,把表貼上去,提交,停止

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
- Consumes: `SteerConfig`、`DEFAULT_STEER`(既有)、`DEFAULT_RULES.cornerEnter`(既有,`src/ai/rules.ts`)
- Produces:
  - `SteerConfig.defendEnergyGain: number` —— 速度赤字 → 壓機頭的增益,rad
  - `SteerConfig.defendEnergyLimit: number` —— 偏置的絕對值上限,rad
  - `export function defendPitchBias(cornerRatio: number, cfg?: SteerConfig): number` —— 回傳 **≤ 0** 的 rad
  - `DEFAULT_STEER.defendEnergyGain = 0`(恆等)、`DEFAULT_STEER.defendEnergyLimit = 40 * (Math.PI / 180)`

- [ ] **Step 1: 寫失敗的測試**

在 `test/unit/ai-steer.test.ts` 的 `describe('extend 的俯仰是連續量', ...)` **之後**新增:

```ts
describe('破防的能量讓位', () => {
  /**
   * 錨：`cornerRatio` 掉到該撤退的那條線時，偏置剛好抵銷 `defendTilt`。
   *
   * 【為什麼 import `DEFAULT_RULES` 而不是寫死 0.25】註解宣稱錨在
   * `cornerEnter`，寫死 `1 − 0.75` 的話那句話會在有人調 `cornerEnter` 的那天
   * 悄悄變成謊話。這是 Codex 審查的 M2。
   */
  const ANCHOR = DEFAULT_STEER.defendTilt / (1 - DEFAULT_RULES.cornerEnter)
  /** 一組非零的增益，用來測形狀。出貨值是 0（恆等） */
  const armed = { ...DEFAULT_STEER, defendEnergyGain: ANCHOR }

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
    expect(defendPitchBias(DEFAULT_RULES.cornerEnter, armed))
      .toBeCloseTo(-DEFAULT_STEER.defendTilt, 9)
  })

  it('比脫離門檻更低 → 真的變成俯衝（超過抵銷）', () => {
    expect(defendPitchBias(0.5, armed)).toBeLessThan(-DEFAULT_STEER.defendTilt)
  })

  it('夾在 −defendEnergyLimit 以上', () => {
    expect(defendPitchBias(-10, armed)).toBeCloseTo(-armed.defendEnergyLimit, 9)
  })

  /**
   * 【直接驗公式，不用「相鄰差夠小」】Codex 審查的 M1：只要求相鄰輸出差小於
   * 上限的 1%（約 0.4°），一個每隔一段跳 0.39° 的階梯函數也會綠。驗公式本身
   * 才真的釘住連續性，另外在 `cornerRatio = 1` 與飽和邊界兩側各取極小的 ε
   * 明確跨過去。
   */
  it('未飽和區逐點等於 −gain × (1 − ratio)', () => {
    for (let r = 0.6; r <= 1; r += 0.01) {
      expect(defendPitchBias(r, armed)).toBeCloseTo(-ANCHOR * (1 - r), 12)
    }
  })

  it('跨過 cornerRatio = 1 與飽和邊界都不跳', () => {
    const eps = 1e-9
    expect(defendPitchBias(1 - eps, armed)).toBeCloseTo(0, 8)
    expect(defendPitchBias(1 + eps, armed)).toBe(0)
    // 飽和點：−gain × (1 − r) = −limit
    const rSat = 1 - armed.defendEnergyLimit / ANCHOR
    expect(defendPitchBias(rSat + eps, armed))
      .toBeCloseTo(defendPitchBias(rSat - eps, armed), 8)
  })

  /**
   * 【`-0` 會讓恆等基準紅】Codex 審查的 C1。`-0 * 0.4` 在 JavaScript 是 `-0`，
   * 而 vitest 的 `toBe` 走 `Object.is` 語義 —— `Object.is(-0, 0)` 為偽。
   * 這一條就是那個陷阱的守門員。
   */
  it('出貨值是 0 —— 這一層預設不生效，且回傳的是 +0 不是 −0', () => {
    expect(DEFAULT_STEER.defendEnergyGain).toBe(0)
    for (let r = 0; r <= 3; r += 0.1) {
      expect(defendPitchBias(r)).toBe(0)
      expect(Object.is(defendPitchBias(r), 0)).toBe(true)
    }
  })

  /**
   * 【NaN 不能流出去】`cornerRatio` 是從 TAS 除出來的；速度歸零或飛機被移除的
   * 那一格它可能是 NaN。NaN 進了 `applyPitchBias` 之後整個瞄準向量變 NaN，
   * 而 NaN 的比較恆為偽 —— 下游每一層的守衛都會靜默失效。
   */
  it('cornerRatio 是 NaN 時回傳 0', () => {
    expect(defendPitchBias(Number.NaN, armed)).toBe(0)
    expect(defendPitchBias(Number.NaN)).toBe(0)
  })
})
```

同時把 `defendPitchBias` 加進該檔頂端的 import,並加入 `DEFAULT_RULES`:

```ts
import {
  aimFromKnobs, buildEngageBasis, createEngageBasis, engageKnobs, extendPitchAngle,
  geometryGate, steerCommand, DEFAULT_STEER, type Knobs,
  createDefendState, stepDefend, defendAim, floorPitchAngle, applyFloor, unloadPull, applyPitchBias,
  defendPitchBias,
} from '../../src/ai/steer'
import { DEFAULT_RULES } from '../../src/ai/rules'
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
 * 少了那個下限，`cornerRatio > 1` 時偏置會變正，等於再疊一份爬升 —— 那正是
 * `pitchSurplusGain` 那一輪證實無效且方向錯誤的東西（見 `pitchSpeedGain`）。
 *
 * 【三個守衛都是正面判斷，不是 `<= 0`】
 *
 *   `!(gain > 0)`     `0 * 正數` 在 JavaScript 是 **`-0`**，而 `Object.is(-0, 0)`
 *                     為偽 —— 「出貨值 0 時逐位元恆等」會因此紅。順帶擋掉
 *                     負增益（那會讓這一層變成抬頭）與 NaN 增益。
 *   `!(deficit > 0)`  `NaN <= 0` 為偽，寫成 `deficit <= 0` 會讓 NaN 一路穿過去。
 *                     NaN 進了 `applyPitchBias` 之後整個瞄準向量變 NaN，而
 *                     下游每一層守衛的比較對 NaN 都恆為偽 —— 靜默全滅。
 *   `!(limit > 0)`    limit 是 NaN 時 `raw < -NaN` 為偽，夾制會靜默失效。
 *
 * 【與 `extendPitchAngle` 的分工】那一個是 `extend` 的**主要動作**（換能量
 * 本身就是它的目的）；這一個是 `defend` 的**讓位**——閃躲仍然由
 * `defendAim` 的幾何決定，這一層只在速度見底時把航跡角壓下來。所以它單向、
 * 而且上限小得多。
 *
 * 【消費者】`steerCommand` 在**本幀真的套了 `defendTilt`** 時把它加進既有的
 * 那一次 `applyPitchBias` 呼叫。**不新增第二次旋轉** —— 兩次旋轉有次序相依，
 * 而且各自夾制會讓合成結果難以推理。
 *
 * @param cornerRatio `Situation.cornerRatio` = TAS ÷ 角落速度
 */
export function defendPitchBias(
  cornerRatio: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const limit = cfg.defendEnergyLimit
  if (!(cfg.defendEnergyGain > 0) || !(limit > 0)) return 0
  const deficit = 1 - cornerRatio
  if (!(deficit > 0)) return 0
  const raw = -cfg.defendEnergyGain * deficit
  return raw < -limit ? -limit : raw
}
```

- [ ] **Step 5: 跑測試確認它綠**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS,全部通過(既有的 115 條 + 新增的 9 條 = 124)

- [ ] **Step 6: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: defendPitchBias 純函數 —— 破防時的能量讓位（出貨值 0，恆等）"
```

---

### Task 2: `defendAim` 回報有沒有抬角,接進 `steerCommand`

**Files:**
- Modify: `src/ai/steer.ts` —— `defendAim` 改回傳 `boolean`(約 1580~1618 行)、`steerCommand` 的瞄準分支(約 1375~1424 行)與 `applyPitchBias` 的呼叫點(原 1456 行)
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `defendPitchBias`(Task 1)、`Situation.cornerRatio`、`applyPitchBias(deltaPitch, aim)`(既有)、`DefendState.reversal` / `.attacker` / `.axisSign`(既有)
- Produces:
  - `defendAim(...): boolean` —— **簽名變更**:回傳「這一格有沒有真的套上 `defendTilt`」。既有呼叫端忽略回傳值即可,不需改。
  - `steerCommand` 的簽名不變。`defendTilted` 是函數內的區域變數。

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
   *
   * 【`threatLos` 明寫】`evaluateGeometry` **不會**填 `threatLos` —— 那是
   * `evaluateThreat` 的工作。不寫的話這個場景實際上是靠 `createSituation()`
   * 的預設值 `(0, 0, −1)` 才成立，而那是一個會被無關重構悄悄改掉的相依。
   * 這是 Codex 審查的 M4。
   *
   * 【`sweetPitch = 0`、`pullCeiling = 1`、4000 m】三者讓瞄準點之後的每一層
   * 後處理都逐位元不動：`shrinkTowardNose` 在 `factor >= 1` 直接 return、
   * `applyPitchBias` 在 `deltaPitch === 0` 直接 return、`floorPitchAngle` 在
   * 高空嚴格回 0 所以 `applyFloor` 直接 return。恆等測試才能逐分量比。
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
    sit.threatLos.set(0, 0, -1)
    sit.stallMargin = 2
    sit.speedMargin = 5
    sit.cornerRatio = 0.6
    sit.sweetPitch = 0
    sit.pullCeiling = 1
    return { self, sit, basis }
  }
  const OFF = { ...DEFAULT_STEER, defendEnergyGain: 0 }
  const ON = { ...DEFAULT_STEER, defendEnergyGain: ANCHOR }
  const K: Knobs = { leadLag: 0, vertical: 0 }
  const gammaOf = (cmd: ReturnType<typeof createCommand>) =>
    Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))

  it('接線：只有 defend 吃這一層', () => {
    const { self, sit, basis } = scene()
    const cmd = createCommand()

    steerCommand('defend', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, OFF)
    const defendOff = gammaOf(cmd)
    steerCommand('defend', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, ON)
    const defendOn = gammaOf(cmd)
    steerCommand('engage', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, OFF)
    const engageOff = gammaOf(cmd)
    steerCommand('engage', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, ON)
    const engageOn = gammaOf(cmd)

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
    const cmd = createCommand()

    for (const mode of ['planeDegenerate', 'speedRecover', 'overshoot'] as const) {
      steerCommand('defend', mode, sit, basis, self, 0, K, createDefendState(), null, cmd, OFF)
      const off = gammaOf(cmd)
      steerCommand('defend', mode, sit, basis, self, 0, K, createDefendState(), null, cmd, ON)
      const on = gammaOf(cmd)
      expect(on, mode).toBeCloseTo(off, 12)
    }
  })

  it('反轉期間不套這一層', () => {
    const { self, sit, basis } = scene()
    const attacker = flyer()
    place(attacker, [0, 4000, 300], [0, 0, -180])
    const cmd = createCommand()

    const reversing = () => {
      const d = createDefendState()
      d.reversal = 1
      d.attacker = attacker
      return d
    }
    steerCommand('defend', 'normal', sit, basis, self, 0, K, reversing(), null, cmd, OFF)
    const off = gammaOf(cmd)
    steerCommand('defend', 'normal', sit, basis, self, 0, K, reversing(), null, cmd, ON)
    const on = gammaOf(cmd)
    expect(on).toBeCloseTo(off, 12)
  })

  /**
   * 【`defendAim` 內部的鉛直退化路徑也沒有抬角】Codex 審查的 I1。`threatLos`
   * 近乎鉛直時 `UP × threatLos` 退化，`defendAim` 改走升力軸／機體橫軸的備援
   * —— 那條路徑**一個字都沒用到 `cfg.defendTilt`**。所以「意圖是 defend 且
   * mode 是 normal 且沒在反轉」仍然不足以判定有抬角可以讓位，旗標必須由
   * `defendAim` 自己回報。
   *
   * 而鉛直威脅正是垂直纏鬥的幾何 —— 也就是速度最低、偏置最大的那個場景。
   */
  it('威脅在正上方（defendAim 走退化路徑）時不套這一層', () => {
    const { self, sit, basis } = scene()
    sit.threatLos.set(0, 1, 0)
    const cmd = createCommand()

    steerCommand('defend', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, OFF)
    const off = gammaOf(cmd)
    steerCommand('defend', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, ON)
    const on = gammaOf(cmd)
    expect(on).toBeCloseTo(off, 12)
  })

  it('defendAim 回報自己有沒有套上抬角', () => {
    const self = flyer()
    const out = new Vector3()
    expect(defendAim(self, new Vector3(0, 0, -1), 1, out)).toBe(true)
    expect(defendAim(self, new Vector3(0, 1, 0), 1, out)).toBe(false)
    expect(defendAim(self, new Vector3(0, -1, 0), 1, out)).toBe(false)
  })

  /**
   * 【關著就等於不存在 —— 逐分量比，不是只看長度】Codex 審查的 I6：原本那條
   * 只驗「純函數回 0」與「向量長度是 1」，而任何寫壞的接線（誤用
   * `defendEnergyLimit`、固定減一個角、旗標設錯）最後都仍然 normalize 成單位
   * 向量，那條會照樣綠 —— 是 vacuous 的。
   *
   * 這個場景的後處理三層全部逐位元不動（見 `scene` 的註解），所以
   * `steerCommand` 的輸出必須**逐分量嚴格等於** `defendAim` 的輸出。
   */
  it('增益 0 時瞄準點逐分量等於 defendAim 的原始輸出', () => {
    const { self, sit, basis } = scene()
    const ref = new Vector3()
    defendAim(self, sit.threatLos, createDefendState().axisSign, ref, OFF)
    const cmd = createCommand()
    steerCommand('defend', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, OFF)
    expect(cmd.aimWorld.x).toBe(ref.x)
    expect(cmd.aimWorld.y).toBe(ref.y)
    expect(cmd.aimWorld.z).toBe(ref.z)
  })

  /**
   * 【合成角度只夾一次】Codex 審查的 I7。`sweetPitch` 與 `defendBias` 相加之後
   * 由 `applyPitchBias` 統一夾在 ±80°。若實作者改成呼叫兩次 `applyPitchBias`，
   * 各自夾制的結果會與相加後夾一次不同 —— 這一條就是那個差異的守門員。
   *
   * 取 `sweetPitch = +70°`、`defendBias ≈ −32°`：相加是 +38°（不飽和）；
   * 分兩次的話第一次先夾到 +70°、第二次再減 32° 得 +38° —— 這個組合剛好相同。
   * 所以另取 `sweetPitch = +85°`：相加後 +53°，分兩次則先被夾到 +80° 再減成
   * +48°。兩者差 5°，足以分辨。
   */
  it('sweetPitch 與能量偏置相加後只夾一次', () => {
    const { self, sit, basis } = scene()
    sit.sweetPitch = 85 * DEG
    const cmd = createCommand()
    steerCommand('defend', 'normal', sit, basis, self, 0, K, createDefendState(), null, cmd, ON)
    const bias = defendPitchBias(sit.cornerRatio, ON)
    // 相加後 85° + bias，未達 80° 飽和，所以最終航跡角就是它
    expect(gammaOf(cmd)).toBeCloseTo(85 * DEG + bias, 6)
  })
```

- [ ] **Step 2: 跑測試確認「接線」那條紅**

Run: `npx vitest run test/unit/ai-steer.test.ts -t "接線"`
Expected: FAIL —— `expect(defendOn).toBeLessThan(defendOff)`,兩者相等

- [ ] **Step 3: `defendAim` 回報有沒有套上抬角**

在 `src/ai/steer.ts` 的 `defendAim`(約 1580 行),把回傳型別由 `void` 改成 `boolean`,並在**真的套上 `cfg.defendTilt` 的那一支**(內層 `if (upLen > 1e-6)`)設旗標:

```ts
export function defendAim(
  self: Aircraft,
  threatLos: Vector3,
  sign: number,
  out: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): boolean {
  // 【回傳值的意義】這一格有沒有真的套上 `defendTilt` 的固定抬角。
  // `defendPitchBias` 的存在理由就是抵銷那個抬角 —— 沒抬角的路徑上套負偏置
  // 只是平白壓機頭。呼叫端不需要這個資訊時忽略即可。
  let tilted = false
  const axis = D.v[0]!
  const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)

  // ── 首選：世界水平面內、垂直於視線 ──────────────────
  const horiz = D.v[3]!.copy(UP).cross(threatLos)
  if (horiz.length() >= AXIS_EPSILON) {
    horiz.normalize()
    if (sign < 0) horiz.multiplyScalar(-1)
    // 視線垂面內指天的方向。抬角在定號**之後**才套，所以永遠朝天
    const up = D.v[2]!.copy(UP).addScaledVector(threatLos, -UP.dot(threatLos))
    const upLen = up.length()
    if (upLen > 1e-6) {
      up.divideScalar(upLen)
      axis.copy(horiz).multiplyScalar(Math.cos(cfg.defendTilt))
        .addScaledVector(up, Math.sin(cfg.defendTilt))
      tilted = true
    } else {
      axis.copy(horiz)
    }
  } else if (perpendicular(lift, threatLos, axis) < AXIS_EPSILON) {
    // 視線鉛直 **且** 升力平行視線 —— 此時機體橫軸必然垂直於視線
    const right = D.v[2]!.set(1, 0, 0).applyQuaternion(self.state.orientation)
    if (perpendicular(right, threatLos, axis) < AXIS_EPSILON) {
      // 數學上到不了，但浮點世界留一條退路：任何非平行的方向都比「指著他」好
      out.copy(threatLos)
      return false
    }
  }

  out.copy(threatLos).multiplyScalar(Math.cos(cfg.defendOffset))
    .addScaledVector(axis, Math.sin(cfg.defendOffset))
    .normalize()
  return tilted
}
```

**只加三行**(`let tilted = false`、`tilted = true`、兩個 `return`),既有邏輯一個字不動 —— 所以既有的 `defendAim` 測試必然仍綠。

- [ ] **Step 4: 在瞄準分支裡接住那個旗標**

在 `src/ai/steer.ts` 的 `steerCommand` 裡,把瞄準點那一段(約 1375 行)的開頭

```ts
  // ── 瞄準點 ──────────────────────────────────────────────
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
```

改成

```ts
  // ── 瞄準點 ──────────────────────────────────────────────
  // 【為什麼要這個旗標】`intent === 'defend'` 不等於本幀套上了 `defendTilt`
  // —— 三個幾何 mode 壓過意圖、`reversal` 期間走 `reversalAim`，而 `defendAim`
  // 自己在視線鉛直時也會走沒有抬角的退化路徑。只有真的有那個固定抬角，才有
  // 東西可以讓位。所以旗標由 `defendAim` 回報，不由意圖推論。
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
          defendTilted = defendAim(self, sit.threatLos, defend.axisSign, out.aimWorld, cfg)
        }
```

- [ ] **Step 5: 改 `applyPitchBias` 的呼叫點**

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

- [ ] **Step 6: 跑測試確認全綠**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS。既有 115 條 + Task 1 的 9 條 + 本任務的 7 條 = 131 條。

- [ ] **Step 7: 全套回歸,確認逐位元恆等**

Run: `npx vitest run`
Expected: 與接線之前**完全相同**的紅燈清單。基準是 4 條已知紅(`ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑)+ `perf-gate`(全套並行下的假紅,單獨跑會綠)。

**多出任何一條紅 = 恆等被破壞,停下來查,不要往下做。**

注意:「紅燈清單相同」只是必要條件,不是逐位元恆等的證明。真正的逐位元證據是 Task 2 Step 1 那條「逐分量等於 `defendAim` 的原始輸出」的單元測試,加上 `defendAim` 只多了三行不影響既有邏輯。

- [ ] **Step 8: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: 破防的能量讓位接進 steerCommand（出貨值 0，全套逐位元恆等）"
```

---

### Task 3: 掃描 `defendEnergyGain`(`defendEnergyLimit` 固定 40°,不掃)

**`defendEnergyLimit` 這一輪不掃。** 它是安全上限而不是調校旋鈕 —— 40° 的理由是「壓機頭不該變成翻過去」,與效果無關。**但這代表高倍率的那幾列量到的是 gain 與 limit 的混合效果**(赤字 0.5 以上就撞飽和),挑值時必須看 `floorShare` 與 `minAlt` 才知道有沒有撞到。這是 Codex 審查的 I5。

**Files:**
- Create: `test/tools/defend-energy.probe.ts`
- Modify: `src/ai/steer.ts`(回填 `DEFAULT_STEER.defendEnergyGain`)

**Interfaces:**
- Consumes: `DEFAULT_STEER.defendEnergyGain`(Task 1)、`DEFAULT_RULES.cornerEnter`、`test/tools/drift.ts`(Task 0)
- Produces: 回填後的出貨值 + 兩張掃描表寫進 `defendEnergyGain` 的註解

- [ ] **Step 1: 寫探針**

Create `test/tools/defend-energy.probe.ts`:

```ts
/**
 * `defendEnergyGain` 的掃描。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/defend-energy.probe.ts
 * 低空壓力測試：npx vite-node test/tools/defend-energy.probe.ts low
 *
 * 【與 `defend-tilt.probe.ts` 共用同一支量測】兩者都 import `./drift`，所以
 * 兩張表的「結束高度」與「回落」定義保證相同、可以直接比。
 *
 * 【主判準見 spec §3.1】結束高度漲幅要降，且回落要比 0×錨 明顯變大。
 *
 * 【副判準只報不擋】extend／engage 佔時。若高度降下來而它們沒動，那就證明
 * 「高度 → 角落速度 → extend」的因果鏈是錯的 —— 那個資訊本身就是這次要買的
 * 東西，而只有把它們放在副判準的位置才問得出來。
 *
 * 【否決條件不只安全層】2026-08-13 的前兩次調參失敗都栽在 `safetyShare`
 * （`cornerEnter` 那一輪衝到 65.6%，上限 5%）。但 `safetyAction` 只記
 * `applySafety`，**看不到 `steerCommand` 裡的 `applyFloor`** —— 壓機頭在低空
 * 可能整段被地板接住，那時安全層不會漲，表面上很安全，實際上是地板在替 AI
 * 飛。所以 `floorShare`、`minAlt`、存活數三者一起當否決。這是 Codex 審查的 C3。
 *
 * 【低空模式】spec §5 風險三：壓機頭在低空是危險的，而 `applyFloor` 從未在
 * 「破防 + 低空 + 低速」三者同時成立時被壓力測試過。`low` 參數把開局換成
 * 1000 m 與 600 m。
 *
 * 【0×錨 是恆等基準】與這一層不存在時逐位元相同。
 */
import { DEFAULT_STEER } from '../../src/ai/steer'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { measureDrift, showDrift, DRIFT_HEADER, OPENINGS, type Opening } from './drift'

/** 錨：`cornerRatio` 掉到 `cornerEnter` 時剛好抵銷 `defendTilt` */
const ANCHOR = DEFAULT_STEER.defendTilt / (1 - DEFAULT_RULES.cornerEnter)

const LOW: readonly Opening[] = [
  { name: '1000/200', altitude: 1000, tas: 200 },
  { name: '600/180', altitude: 600, tas: 180 },
]

const low = (globalThis as { process?: { argv?: string[] } })
  .process?.argv?.includes('low') ?? false
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
console.log('\n【怎麼讀】0.0×錨 是恆等基準，每一欄都跟同一開局的它比。')
console.log('　主判準：漲幅要降（幅度 > 393 m 才算數），且回落要明顯變大。')
console.log('　否決（任一成立就淘汰）：安全層上升、地板佔比上升、最低高度變低、')
console.log('　　　存活數變少。低空那一輪尤其要看 —— 高度降下來若是「掉下去死掉」')
console.log('　　　或「靠地板抬回來」，死亡機會立刻退出中位，表面上反而好看。')
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 3: 跑高空掃描**

Run: `npx vite-node test/tools/defend-energy.probe.ts`
Expected: 十列(五個增益 × 兩個開局),每列下面附窗中位序列。

- [ ] **Step 4: 跑低空壓力測試**

Run: `npx vite-node test/tools/defend-energy.probe.ts low`
Expected: 十列。

- [ ] **Step 5: 挑值並回填**

在 `src/ai/steer.ts` 把 `defendEnergyGain: 0,` 改成挑中的值,並把兩張掃描表(高空 + 低空)貼進 `defendEnergyGain` 的註解。

**挑值規則,依序:**

1. **有效性**:任何一列標了「無效」(有一格全滅)—— 該倍率淘汰
2. **安全否決**(高空與低空**兩輪都要過**,每一項都跟同一開局的 `0.0×錨` 比):
   - `安全層` 不得上升
   - `地板` 佔比不得上升
   - `最低高度` 不得變低
   - `存活` 數不得變少
   —— 任一違反就淘汰
3. **主判準**:兩個開局的 `回落` 都要比 `0.0×錨` 大,**且**兩個開局的 `漲幅` 都要比 `0.0×錨` 低,平均降幅 > 393 m
4. **在通過 1~3 的候選裡,取最小的 gain。**

   【為什麼不是取漲幅最低的】那個規則天然偏好最強、甚至過強的俯衝參數 ——
   而「高度最低」在這個量測裡可以由「飛機掉下去死掉」達成(死亡機立刻退出
   中位與分母)。安全否決擋掉了最糟的情況,但在都通過的候選之間,**最小的
   有效劑量**才是正確的選擇。這是 Codex 審查的 C3。
5. 若沒有任何候選同時滿足 2 與 3 —— **不回填,維持 0**,在註解記錄否決,跳到 Task 4 只做報告

- [ ] **Step 6: 型別檢查與單元測試**

Run: `npx tsc --noEmit && npx vitest run test/unit/ai-steer.test.ts`
Expected: 無型別錯誤;測試全綠。

注意 Task 1 的「出貨值是 0」那條測試會**因為回填而變紅**。把它改成:

```ts
  it('出貨值由掃描定出，且非負', () => {
    expect(DEFAULT_STEER.defendEnergyGain).toBeGreaterThanOrEqual(0)
  })
```

保留同一個 `describe` 裡的其他八條 —— 它們用 `armed` / `OFF` / `ON` 設定,全部不依賴出貨值。

- [ ] **Step 7: Commit**

```bash
git add src/ai/steer.ts test/tools/defend-energy.probe.ts test/unit/ai-steer.test.ts
git commit -m "feat: defendEnergyGain 掃描定值 —— 含低空壓力測試"
```

---

### Task 4: 全套回歸與護欄比較

**Files:**
- Create: `test/tools/guard-numbers.probe.ts`
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

- [ ] **Step 4: 印出「通過但移動了多少」**

**綠燈不會告訴你數字。** `safetyShare` 由 0.1% 移到 4.9% 仍然通過 5% 的門檻,而「移動但未破門檻交專案負責人裁定」這條紀律沒有數字就執行不了。這是 Codex 審查的 I8。

Create `test/tools/guard-numbers.probe.ts`:先讀 `test/integration/ai-manoeuvre.test.ts` 裡量 `safetyShare` / `belowStall` 的那一段,把同一個場景與同一套計數在探針裡重跑一次,對 `defendEnergyGain = 0` 與回填值各跑一輪,印出兩欄與差值。

```bash
npx vite-node test/tools/guard-numbers.probe.ts
```

- [ ] **Step 5: 寫「實作結果」一節**

在 spec 末尾追加,含:

- Task 0 消融表 + 三條止損判準的逐條判定
- Task 3 的兩張掃描表(高空 + 低空)
- 主判準的前後對照(結束漲幅、回落,兩個開局)
- 安全否決四項的前後對照(安全層、地板佔比、最低高度、存活)
- 副判準的前後對照(extend／engage 佔時、傷害)——**含「若沒動則因果鏈推論錯誤」的明確結論**
- 全套紅燈的逐條比較(基準 4 條 vs 現在)
- Step 4 印出的護欄實測值:**未破門檻但移動的,列表交專案負責人裁定**

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-defend-energy-design.md test/tools/guard-numbers.probe.ts
git commit -m "docs: 破防能量讓位的實作結果與護欄逐條比較"
```

- [ ] **Step 7: 交專案負責人**

回報:主判準有沒有達成、副判準動了沒(以及那代表什麼)、哪些護欄移動需要裁定、以及人工試飛要看什麼(跟拍長機,看它在被咬且沒速度時會不會停止爬升)。
