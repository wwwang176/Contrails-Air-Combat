# 任務框架 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 讓四張任務卡（殲滅、撤離 × 兩陣營）真的可以打，而勝負條件成為一個可替換的東西。

**Architecture：** 新增一支純函數模組 `src/battle/mission.ts`，一次呼叫同時寫出**判定與顯示**；`BattleConfig` 多一個 `rules` 欄位，遭遇戰是 `{ kind: 'annihilate' }` —— 所以判定路徑每一場都在走。撤離點在敵人後方 20 km，3D 圓環是那顆判定球的 billboard 輪廓。

**Tech Stack：** TypeScript（strict）、three.js、vitest、Playwright、Vite。

**Spec：** `docs/superpowers/specs/2026-08-16-mission-framework-design.md`

## Global Constraints

- **遭遇戰的既有 `outcome` 語意與判定位置不變。** 全套既有護欄的數字不得移動。
  【Codex 審查 2026-08-16 的措辭修正】原本寫「逐字不變」是不準確的：新版多了
  狀態寫入、多了一次 `playerPos` 的 copy，而且紅隊全滅時也會多掃一次藍隊
  （`aliveCount(b.blue)` 從短路變成必算）。**行為**不變，**指令**不是逐字。
- **回歸基準**（本分支 `7c20aae` 實測）：
  ```
  Test Files   2 failed | 106 passed (108)
  Tests        3 failed | 2507 passed | 1 skipped (2511)
  ```
  三條紅是 `ai-command-channel` ×2、`ai-withdraw-anchor` ×1，均為 `docs/backlog.md`
  §1 待裁定。**綠數只能增加，紅數必須仍是這三條。**
- **護欄重新定值是專案負責人的決定。** 任何既有門檻要動，停下來問。
- **熱路徑不配置。** `stepMission` 每個物理步跑 240 次：不組字串、不 `new`、就地寫回 `out`。
- **起始值不是定值。** Task 9 掃描並回填 spec §8；在那之前每一個常數都要標 `【起始值，待掃描】`。
- 註解用繁體中文，寫「為什麼」不寫「做什麼」，與既有檔案同一密度。
- 型別 strict：不得有 `any`、不得有未使用的欄位。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/battle/mission.ts`（新） | 判定的純函數。不認識 `Battle`、不認識 three 以外的東西 |
| `src/battle/missions.ts`（由 `src/ui/missions.ts` 搬來） | 關卡**資料** + `missionRules` / `missionConfigFrom` |
| `src/battle/setup.ts`（改） | `BattleConfig.rules`、`Battle.mission`、`stepBattle` 換掉兩行、`resetBattle` 重設 |
| `src/ui/screens.ts`（改） | 兩條轉移 |
| `src/ui/menu.ts`（改） | `playable` 的卡可點、`onMission` hook |
| `src/hud/types.ts`（改） | `HudFrame` 的 8 個目標欄位 |
| `src/hud/widgets/objective.ts`（新） | 目標列 |
| `src/hud/widgets/minimap.ts`（改） | 撤離點的符號 |
| `src/hud/Hud.ts`（改） | 註冊 `objective` |
| `src/render/objectiveRing.ts`（新） | 3D billboard 圓環 |
| `src/main.ts`（改） | 模式分流、圓環生命週期、HudFrame 填值、結算按鈕 |
| `index.html`（改） | 結算的第二顆返回鈕 |

---

## Task 1：`src/battle/mission.ts` —— 判定的純函數

**Files:**
- Create: `src/battle/mission.ts`
- Create: `test/unit/mission.test.ts`

**Interfaces:**
- Consumes: `Outcome`（目前在 `src/battle/setup.ts:139`，本 Task **搬到 `mission.ts`** 並由 `setup.ts` 轉出，避免 `setup → mission → setup` 的循環）
- Produces: `MissionRules`、`MissionInputs`、`MissionState`、`createMissionState`、`resetMissionState`、`stepMission`

- [ ] **Step 1：先寫失敗的測試**

`test/unit/mission.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createMissionState, resetMissionState, stepMission,
  type MissionInputs, type MissionRules,
} from '../../src/battle/mission'

const DT = 1 / 240

function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
  return {
    aliveBlue: 4, aliveRed: 16,
    playerPos: new Vector3(0, 4000, 5000),
    playerAlive: true,
    ...over,
  }
}

const ANNIHILATE: MissionRules = { kind: 'annihilate' }
function evac(seconds = 240): MissionRules {
  return { kind: 'evacuate', point: new Vector3(0, 4000, -20000), radius: 1000, seconds }
}

describe('stepMission：殲滅', () => {
  it('雙方都活著時是 fighting，metric 是剩餘敵機數', () => {
    const s = createMissionState(ANNIHILATE)
    stepMission(ANNIHILATE, inputs(), DT, s)
    expect(s.outcome).toBe('fighting')
    expect(s.metric).toBe(16)
    expect(s.hasTarget).toBe(false)
    expect(s.secondsLeft).toBe(Infinity)
  })

  it('敵方全滅 = victory', () => {
    const s = createMissionState(ANNIHILATE)
    stepMission(ANNIHILATE, inputs({ aliveRed: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('我方全滅 = defeat', () => {
    const s = createMissionState(ANNIHILATE)
    stepMission(ANNIHILATE, inputs({ aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /** 【逐字等於現況】`setup.ts` 的兩行是 `if (red===0) victory else if (blue===0) defeat` */
  it('雙方同時全滅時判 victory —— 與改動前那兩行的順序一致', () => {
    const s = createMissionState(ANNIHILATE)
    stepMission(ANNIHILATE, inputs({ aliveBlue: 0, aliveRed: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })
})

describe('stepMission：撤離', () => {
  it('開局：fighting，有目標，metric 是到撤離點的距離', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs(), DT, s)
    expect(s.outcome).toBe('fighting')
    expect(s.hasTarget).toBe(true)
    expect(s.targetRadius).toBe(1000)
    expect(s.metric).toBeCloseTo(25000, 6)
    expect(s.secondsLeft).toBeCloseTo(240 - DT, 9)
  })

  it('進入半徑內 = victory', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(0, 4000, -19500) }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('時限歸零 = defeat', () => {
    const r = evac(2 * DT)
    const s = createMissionState(r)
    stepMission(r, inputs(), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(r, inputs(), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('我方全滅 = defeat', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /**
   * 【接手延遲那 2 秒的邊角】`TAKEOVER_DELAY` 期間 `b.player` 仍指著已經退場的
   * 那一架，位置停在墜落點。少了 `playerAlive` 這一格，「玩家死在圓環裡、
   * 僚機還活著」會判成撤離成功（spec §7.1）。
   */
  it('玩家已退場但僚機還活著時，即使最後位置在圓環內也不算撤離成功', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerAlive: false, playerPos: new Vector3(0, 4000, -19500) }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('同一步同時抵達與超時 —— 判 victory', () => {
    const r = evac(DT)
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(0, 4000, -19500) }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /**
   * 【為什麼要釘 NaN】`NaN < radius` 是 false，所以現況安全 —— 但這是**要被釘住
   * 的安全**。前例：`sweetYield` 的 `Number.isFinite` 守衛是 Codex 審查時抓出來的。
   */
  it('playerPos 含 NaN 時不得誤判 victory', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(NaN, NaN, NaN) }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('無時限（Infinity）不會被 dt 吃掉', () => {
    const r: MissionRules = {
      kind: 'evacuate', point: new Vector3(0, 4000, -20000), radius: 1000, seconds: Infinity,
    }
    const s = createMissionState(r)
    for (let i = 0; i < 1000; i++) stepMission(r, inputs(), DT, s)
    expect(s.secondsLeft).toBe(Infinity)
    expect(s.outcome).toBe('fighting')
  })
})

describe('stepMission：定案之後不再改任何欄位', () => {
  /**
   * 【為什麼要逐欄比而不是只比 outcome/metric】少比的那幾欄正是最容易被
   * 「順手清一下」的（Codex 審查 2026-08-16）。`hasTarget` 若在定案後被清掉，
   * 圓環會在勝利畫面上憑空消失。
   */
  it('已經 victory 之後再呼叫，六個欄位全部凍結', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(0, 4000, -19500) }), DT, s)
    const frozen = {
      outcome: s.outcome, metric: s.metric, secondsLeft: s.secondsLeft,
      hasTarget: s.hasTarget, targetRadius: s.targetRadius, target: s.target.clone(),
    }
    stepMission(r, inputs({ aliveBlue: 0, playerPos: new Vector3(0, 0, 0) }), DT, s)
    expect(s.outcome).toBe(frozen.outcome)
    expect(s.metric).toBe(frozen.metric)
    expect(s.secondsLeft).toBe(frozen.secondsLeft)
    expect(s.hasTarget).toBe(frozen.hasTarget)
    expect(s.targetRadius).toBe(frozen.targetRadius)
    expect(s.target.equals(frozen.target)).toBe(true)
  })
})

/**
 * ★ **選項丙的核心保證。這一條紅了就代表 HUD 會騙人。**
 *
 * 【Codex 審查 2026-08-16：原版不是獨立的 oracle】原版同時讀同一次
 * `stepMission` 算出的 `metric` 與 `outcome`，所以「兩者用同一條錯誤公式」
 * 仍然會全綠 —— 例如距離被錯誤地縮放，再用那個錯的距離判勝，等價式照樣成立。
 *
 * 改成：**期望值由測試自己算**（`playerPos.distanceTo(point)`），再分別斷言
 * `metric` 與 `outcome`。這樣「顯示對」與「判定對」兩件事各自有獨立的證據，
 * 而「兩者一致」是它們的推論。
 */
describe('同源：metric 與 outcome 各自對，所以一致', () => {
  it('撤離：metric 是真距離，outcome 由真距離決定', () => {
    const r = evac()
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    for (let z = -21000; z <= -18000; z += 50) {
      const pos = new Vector3(0, 4000, z)
      const expected = pos.distanceTo(r.point)          // ← 獨立算出來的期望值
      const s = createMissionState(r)
      stepMission(r, inputs({ playerPos: pos }), DT, s)
      expect(s.metric, `z=${z}`).toBeCloseTo(expected, 6)
      expect(s.outcome, `z=${z}`).toBe(expected < r.radius ? 'victory' : 'fighting')
    }
  })

  it('殲滅：metric 是真的剩餘敵機數，outcome 由它決定', () => {
    for (let red = 0; red <= 20; red++) {
      const s = createMissionState(ANNIHILATE)
      stepMission(ANNIHILATE, inputs({ aliveRed: red }), DT, s)
      expect(s.metric, `red=${red}`).toBe(red)
      expect(s.outcome, `red=${red}`).toBe(red === 0 ? 'victory' : 'fighting')
    }
  })
})

describe('resetMissionState', () => {
  it('打完一場之後重設，六個欄位都與新建的一樣', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(0, 4000, -19500) }), DT, s)
    resetMissionState(r, s)
    const fresh = createMissionState(r)
    expect(s.outcome).toBe(fresh.outcome)
    expect(s.secondsLeft).toBe(fresh.secondsLeft)
    expect(s.metric).toBe(fresh.metric)
    expect(s.hasTarget).toBe(fresh.hasTarget)
    expect(s.targetRadius).toBe(fresh.targetRadius)
    expect(s.target.equals(fresh.target)).toBe(true)
  })

  /**
   * 【為什麼要跨 rules 重設】`resetMissionState` 的 annihilate 分支若忘了把
   * `hasTarget` 清成 false，撤離打完換遭遇戰時圓環會留在畫面上、小地圖上
   * 也會留一個指向不存在座標的圈（Codex 審查 2026-08-16）。
   */
  it('用 annihilate 重設一個撤離過的狀態，目標要被清乾淨', () => {
    const s = createMissionState(evac())
    expect(s.hasTarget).toBe(true)
    resetMissionState(ANNIHILATE, s)
    expect(s.hasTarget).toBe(false)
    expect(s.targetRadius).toBe(0)
    expect(s.secondsLeft).toBe(Infinity)
    expect(s.target.equals(new Vector3(0, 0, 0))).toBe(true)
  })

  /**
   * 【為什麼要釘住物件身分】`Battle.mission` 是 readonly 參考，而 `main.ts`
   * 每幀讀 `mission.target`。換掉那個 `Vector3` 會讓 HUD 與圓環指向孤兒物件
   * —— 與 `Aircraft.reset` 改成就地寫回是同一條教訓。
   */
  it('重設不換掉 target 這個物件', () => {
    const r = evac()
    const s = createMissionState(r)
    const before = s.target
    resetMissionState(ANNIHILATE, s)
    resetMissionState(r, s)
    expect(s.target).toBe(before)
  })
})
```

- [ ] **Step 2：跑測試確認它失敗**

Run：`npx vitest run test/unit/mission.test.ts`
Expected：FAIL，`Cannot find module '../../src/battle/mission'`

- [ ] **Step 3：寫實作**

`src/battle/mission.ts`：

```ts
import { Vector3 } from 'three'

/**
 * 一場戰鬥的結果。`victory` = 任務達成，`defeat` = 任務失敗。
 *
 * 【為什麼住在這裡而不是 `setup.ts`】它現在是**任務判定的產物**。留在
 * `setup.ts` 的話 `mission.ts` 要 import `setup.ts`，而 `setup.ts` 又要
 * import `mission.ts` —— 一個沒有必要的循環。`setup.ts` 轉出這個型別，
 * 既有的 import 路徑全部不用動。
 */
export type Outcome = 'fighting' | 'victory' | 'defeat'

/**
 * 這一關怎麼算贏。
 *
 * 【為什麼是可辨識聯集而不是一個函數】關卡是**資料**（`battle/missions.ts`
 * 是一張表）。函數會把「怎麼打」藏進閉包裡，而閉包不能比較、不能序列化、
 * 也不能在測試裡直接組一個出來。
 */
export type MissionRules =
  | { kind: 'annihilate' }
  | {
    kind: 'evacuate'
    /** 撤離點的世界座標 */
    point: Vector3
    /** 抵達半徑，m。**也就是圓環的半徑** —— 看到的圈就是判定範圍 */
    radius: number
    /** 時限，秒。無時限給 `Infinity` */
    seconds: number
  }

/**
 * `stepMission` 讀的快照。**就地重填，不配置。**
 *
 * 【為什麼不直接吃 `Battle`】與 `CommandUnit`（`ai/command.ts`）、
 * `SteerConfig` 同一套手法：吃快照才能單元測試而不用建一個世界出來。
 */
export interface MissionInputs {
  aliveBlue: number
  aliveRed: number
  /** 玩家目前那一架的位置 */
  playerPos: Vector3
  /**
   * 玩家那一架還活著嗎。
   *
   * 【為什麼一定要有】接手有 2 秒延遲（`battle/takeover.ts` 的
   * `TAKEOVER_DELAY`），那段期間 `Battle.player` 仍然指著**已經退場的那一
   * 架**，位置停在墜落點。少了這個旗標，「玩家死在圓環裡、僚機還活著」會
   * 判成撤離成功。
   */
  playerAlive: boolean
}

/**
 * 任務的狀態。**判定與顯示都在這裡**，由同一次 `stepMission` 寫出。
 *
 * 【為什麼判定與顯示不分開】分開的話 HUD 要自己再算一次進度，而兩份邏輯
 * 會漂移 —— 玩家看到「剩 12 架」卻突然贏了。這是這一輪唯一真正的新風險，
 * 合在一起就從結構上消掉（spec §4.3）。
 */
export interface MissionState {
  outcome: Outcome
  /** 撤離點。`hasTarget` 為 false 時無意義。**物件重用，不換參考** */
  readonly target: Vector3
  hasTarget: boolean
  /** 抵達半徑，m */
  targetRadius: number
  /** 剩餘秒數。無時限時是 `Infinity` */
  secondsLeft: number
  /** HUD 的計量。殲滅＝剩餘敵機數，撤離＝到撤離點的距離 m */
  metric: number
}

export function createMissionState(rules: MissionRules): MissionState {
  const s: MissionState = {
    outcome: 'fighting',
    target: new Vector3(),
    hasTarget: false,
    targetRadius: 0,
    secondsLeft: Infinity,
    metric: 0,
  }
  resetMissionState(rules, s)
  return s
}

/**
 * 回到開局。**「再打一場」與暫停選單的「重新開始」都要呼叫。**
 *
 * 【為什麼不是重新 `createMissionState`】`Battle.mission` 是 readonly 的
 * 參考，而 `main.ts` 與 HUD 每幀讀它。換掉物件會讓那些參考指向孤兒 ——
 * 與 `Aircraft.reset` 改成就地寫回是同一條教訓（`setup.ts` 的
 * `stepCommandLayer` 註解）。
 */
export function resetMissionState(rules: MissionRules, out: MissionState): void {
  out.outcome = 'fighting'
  if (rules.kind === 'evacuate') {
    out.target.copy(rules.point)
    out.hasTarget = true
    out.targetRadius = rules.radius
    out.secondsLeft = rules.seconds
    // 【開局的 metric 先給 0 而不是實際距離】這裡拿不到玩家位置，而第一個
    // 物理步就會覆蓋它。給一個假的距離反而會在第一幀閃一下錯的數字。
    out.metric = 0
    return
  }
  out.target.set(0, 0, 0)
  out.hasTarget = false
  out.targetRadius = 0
  out.secondsLeft = Infinity
  out.metric = 0
}

/**
 * 推進一步：同時寫出判定與顯示。
 *
 * 【定案之後不再改任何欄位】一場只判一次 —— 與 `stepBattle` 現況的
 * `if (b.outcome !== 'fighting') return` 一致。少了這一條，結算畫面上的
 * 數字會在勝負已定之後繼續跳。
 *
 * 【victory 先於 defeat】同一步同時滿足時算贏：飛進圓環的那一步剛好時限
 * 歸零，判贏才符合玩家的認知。殲滅那一側的順序則是**照抄改動前的兩行**
 * （`setup.ts` 舊的 `if (red===0) ... else if (blue===0) ...`）。
 */
export function stepMission(
  rules: MissionRules, inp: MissionInputs, dt: number, out: MissionState,
): void {
  if (out.outcome !== 'fighting') return

  if (rules.kind === 'annihilate') {
    out.metric = inp.aliveRed
    if (inp.aliveRed === 0) out.outcome = 'victory'
    else if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 撤離 ──────────────────────────────────────────────
  // 【`Infinity - dt` 仍是 `Infinity`】無時限因此不必特例。有測試釘住這件
  // 事，否則哪天改成一個計時器物件就會靜靜壞掉。
  out.secondsLeft -= dt
  out.metric = inp.playerPos.distanceTo(rules.point)

  // 【NaN 走這條】`NaN < radius` 是 false，所以位置壞掉時不會誤判成功；
  // 落到下面的兩條失敗條件，而那兩條不讀位置。
  if (inp.playerAlive && out.metric < rules.radius) {
    out.outcome = 'victory'
    return
  }
  if (inp.aliveBlue === 0 || out.secondsLeft <= 0) out.outcome = 'defeat'
}
```

- [ ] **Step 4：跑測試確認全綠**

Run：`npx vitest run test/unit/mission.test.ts`
Expected：PASS（**18 條** —— 殲滅 4、撤離 8、凍結 1、同源 2、重設 3。
若跑出來少於 18，是漏貼了某個 `it`，不是「測試比較少」）

- [ ] **Step 5：把 `Outcome` 從 `setup.ts` 改成轉出**

`src/battle/setup.ts` 的第 138–139 行：

```ts
/** 一場戰鬥的結果。**定義搬到 `mission.ts`** —— 它現在是任務判定的產物 */
export type { Outcome } from './mission'
```

並在 import 區加入 `import type { Outcome } from './mission'`（`Battle.outcome` 的宣告要用得到）。

Run：`npx tsc --noEmit`
Expected：0 error

- [ ] **Step 6：Commit**

```bash
git add src/battle/mission.ts src/battle/setup.ts test/unit/mission.test.ts
git commit -m "feat: mission.ts —— 判定與顯示同源的純函數"
```

---

## Task 2：接進 `BattleConfig` / `Battle` / `stepBattle`，遭遇戰逐字不變

**Files:**
- Modify: `src/battle/setup.ts`（`BattleConfig`、`DEFAULT_BATTLE`、`Battle`、`createBattle`、`stepBattle:685-690`、`resetBattle`）
- Test: `test/unit/battle-mission-wiring.test.ts`（新）

**Interfaces:**
- Consumes：Task 1 的 `MissionRules`、`MissionState`、`createMissionState`、`resetMissionState`、`stepMission`、`MissionInputs`
- Produces：`BattleConfig.rules`、`Battle.mission`

- [ ] **Step 1：先寫失敗的測試**

`test/unit/battle-mission-wiring.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, resetBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { ScriptedController } from '../../src/control/ScriptedController'

const DT = 1 / 240

describe('遭遇戰＝沒有時限的殲滅任務', () => {
  it('DEFAULT_BATTLE 的 rules 是 annihilate', () => {
    expect(DEFAULT_BATTLE.rules.kind).toBe('annihilate')
  })

  it('Battle 一建好就有 mission 狀態，且與 outcome 一致', () => {
    const b = createBattle(new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 })
    expect(b.mission.outcome).toBe('fighting')
    expect(b.outcome).toBe('fighting')
    expect(b.mission.hasTarget).toBe(false)
    expect(b.mission.secondsLeft).toBe(Infinity)
  })

  it('紅隊全滅時 outcome 與 mission.outcome 同步翻成 victory', () => {
    const b = createBattle(new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 })
    for (const c of b.red) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('victory')
    expect(b.outcome).toBe('victory')
  })

  it('metric 是剩餘敵機數', () => {
    const b = createBattle(new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 3 })
    stepBattle(b, DT)
    expect(b.mission.metric).toBe(3)
    b.world.destroy(b.red[0]!)
    stepBattle(b, DT)
    expect(b.mission.metric).toBe(2)
  })

  it('resetBattle 之後任務狀態回到開局', () => {
    const b = createBattle(new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 })
    for (const c of b.red) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    resetBattle(b)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.outcome).toBe('fighting')
  })
})

describe('撤離規則接得上 Battle', () => {
  it('把玩家放到撤離點上，下一步就 victory', () => {
    const rules = {
      kind: 'evacuate' as const,
      point: new Vector3(0, 4000, -20000),
      radius: 1000,
      seconds: 240,
    }
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2, rules },
    )
    expect(b.mission.hasTarget).toBe(true)
    b.player.aircraft.state.position.set(0, 4000, -19800)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })
})
```

- [ ] **Step 2：跑測試確認它失敗**

Run：`npx vitest run test/unit/battle-mission-wiring.test.ts`
Expected：FAIL，`rules` 與 `mission` 都不存在

- [ ] **Step 3：寫實作**

`src/battle/setup.ts` 的四處改動。**先補 import**（Codex 審查 2026-08-16：
原版只寫了 `Outcome`，漏掉其餘六個）：

```ts
import {
  createMissionState, resetMissionState, stepMission,
  type MissionInputs, type MissionRules, type MissionState, type Outcome,
} from './mission'
```

（a）`BattleConfig` 尾端加欄位：

```ts
  /**
   * 這一場怎麼算贏。
   *
   * 【為什麼遭遇戰也吃這個】遭遇戰就是「一個沒有時限的殲滅任務」。判定
   * 路徑因此**每一場都在走**，不是一條等著被第一次使用的死碼 —— 與地形
   * 「種類沒變也重建」是同一條紀律（M10 spec §5.3）。
   */
  rules: MissionRules
```

`DEFAULT_BATTLE` 加 `rules: { kind: 'annihilate' },`。

（b）`Battle` 加欄位：

```ts
  /**
   * 這一場的任務狀態。**`mission.outcome` 是權威，`outcome` 是它的複本。**
   *
   * 【為什麼留著 `outcome`】`main.ts`、`ui/scoreboard`、Playwright 判準與
   * 既有測試都讀它。改成處處讀 `mission.outcome` 是一次與這一輪無關的
   * 擴散性修改。
   */
  readonly mission: MissionState
```

`createBattle` 組 `battle` 物件時加 `mission: createMissionState(cfg.rules),`。

（c）`stepBattle` 尾端的兩行換掉：

```ts
  if (b.outcome !== 'fighting') return

  // 【玩家恆在藍隊】M10 交換的是兩邊的機種，不是隊伍顏色。
  //
  // 【為什麼要填一份快照而不是把 `Battle` 傳進去】`stepMission` 是純函數，
  // 吃快照才能單元測試而不用建一個世界。物件是模組級的，重用不配置。
  const inp = MISSION_INPUTS
  inp.aliveBlue = aliveCount(b.blue)
  inp.aliveRed = aliveCount(b.red)
  inp.playerPos.copy(b.player.aircraft.state.position)
  inp.playerAlive = b.player.alive
  stepMission(b.cfg.rules, inp, dt, b.mission)
  b.outcome = b.mission.outcome
```

檔案上方加：

```ts
/** `stepMission` 的輸入快照。每步就地重填 —— 熱路徑不配置 */
const MISSION_INPUTS: MissionInputs = {
  aliveBlue: 0, aliveRed: 0, playerPos: new Vector3(), playerAlive: true,
}
```

（d）`resetBattle` 在 `b.outcome = 'fighting'` 那一行**之前**加：

```ts
  // 【任務狀態也要重設】少了這一行，「再打一場」會直接開在上一場的結果上，
  // 而撤離的倒數會從 0 開始 —— 開局第一個物理步就判 defeat。
  resetMissionState(b.cfg.rules, b.mission)
```

（`b.outcome = 'fighting'` 保留 —— 它是複本，兩行一起才自洽。）

- [ ] **Step 4：跑測試確認全綠**

Run：`npx vitest run test/unit/battle-mission-wiring.test.ts && npx tsc --noEmit`
Expected：PASS，0 error

- [ ] **Step 5：★ 全套回歸 —— 遭遇戰必須逐字不變**

Run：`npx vitest run 2>&1 | tail -40`
Expected：綠數 = 2506 + 本輪新增，紅數仍為 3（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）。
**任何第四條紅色都要停下來查，不得往下走。**

- [ ] **Step 6：Commit**

```bash
git add src/battle/setup.ts test/unit/battle-mission-wiring.test.ts
git commit -m "feat: 遭遇戰改走任務判定 —— 那條路徑因此每一場都在走"
```

---

## Task 3：關卡資料 —— `src/ui/missions.ts` → `src/battle/missions.ts`

**Files:**
- Delete: `src/ui/missions.ts`
- Create: `src/battle/missions.ts`
- Modify: `src/ui/menu.ts:1`（import 路徑）
- **Modify（不是 Create）**: `test/unit/missions.test.ts` —— **這個檔案已經存在**，
  有 5 條測試（兩陣營各五張、難度 1~5、標題不重複、五種類型各一、summary 非空），
  而且 `import { MISSIONS } from '../../src/ui/missions'` 會因為搬檔而壞掉
  （Codex 審查 2026-08-16）。**保留那 5 條**，只改 import 路徑，新的測試接在後面。

**Interfaces:**
- Consumes：Task 1 的 `MissionRules`；Task 2 的 `BattleConfig.rules`；`specsFor`（`battle/skirmish.ts:40`）
- Produces：`MissionCard`、`MissionType`、`MISSIONS`、`missionRules`、`missionConfigFrom`

- [ ] **Step 1：先寫失敗的測試**

`test/unit/missions.test.ts` —— **既有那 5 條原封不動保留**（只把第 2 行的
`'../../src/ui/missions'` 改成 `'../../src/battle/missions'`），下面這些**接在
既有的 `describe` 之後**：

```ts
// ↑ 既有的 describe('任務卡（M10 spec §10）', …) 5 條留著，import 補上：
import { describe, it, expect } from 'vitest'
import { MISSIONS, missionConfigFrom, missionRules } from '../../src/battle/missions'
import { DEFAULT_BATTLE } from '../../src/battle/setup'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { VETERAN } from '../../src/ai/profile'

describe('關卡資料', () => {
  it('兩個陣營各五張卡', () => {
    expect(MISSIONS.allies).toHaveLength(5)
    expect(MISSIONS.axis).toHaveLength(5)
  })

  it('可打的只有殲滅與撤離', () => {
    for (const cards of [MISSIONS.allies, MISSIONS.axis]) {
      for (const c of cards) {
        expect(c.playable).toBe(c.type === '殲滅' || c.type === '撤離')
      }
    }
  })

  it('每張卡的 id 全域唯一', () => {
    const ids = [...MISSIONS.allies, ...MISSIONS.axis].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * 【為什麼要釘前綴】`main.ts` 的 `onMission` 由 `id.startsWith('axis')` 推
   * 陣營（Task 7）。少了這一條，某天新增一張 id 沒照規矩取的卡，玩家會拿到
   * 錯的機種 —— 而畫面上沒有任何東西會透露原因。
   */
  it('id 的前綴就是陣營', () => {
    for (const c of MISSIONS.allies) expect(c.id.startsWith('allies-')).toBe(true)
    for (const c of MISSIONS.axis) expect(c.id.startsWith('axis-')).toBe(true)
  })

  it('可打的卡都有目標文字與編制', () => {
    for (const c of [...MISSIONS.allies, ...MISSIONS.axis]) {
      if (!c.playable) continue
      expect(c.objective.length).toBeGreaterThan(0)
      expect(c.blueCount).toBeGreaterThanOrEqual(1)
      expect(c.redCount).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('missionRules', () => {
  it('殲滅卡給 annihilate', () => {
    const card = MISSIONS.allies.find((c) => c.type === '殲滅')!
    expect(missionRules(card, 4000).kind).toBe('annihilate')
  })

  it('撤離卡給 evacuate，撤離點在 −Z、高度取自參數', () => {
    const card = MISSIONS.allies.find((c) => c.type === '撤離')!
    const r = missionRules(card, 4000)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.x).toBe(0)
    expect(r.point.y).toBe(4000)
    expect(r.point.z).toBe(-card.evacDistance)
    expect(r.radius).toBe(card.evacRadius)
    expect(r.seconds).toBe(card.seconds)
  })

  it('高度改了，撤離點跟著改', () => {
    const card = MISSIONS.allies.find((c) => c.type === '撤離')!
    const r = missionRules(card, 6000)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.y).toBe(6000)
  })
})

describe('missionConfigFrom', () => {
  it('同盟國：藍隊飛 P-51、紅隊飛 Bf 109，架數照卡片', () => {
    const card = MISSIONS.allies.find((c) => c.type === '撤離')!
    const cfg = missionConfigFrom(card, 'allies')
    expect(cfg.blueSpec.id).toBe(P51D.id)
    expect(cfg.redSpec.id).toBe(BF109G6.id)
    expect(cfg.blueCount).toBe(card.blueCount)
    expect(cfg.redCount).toBe(card.redCount)
  })

  it('軸心國：藍隊飛 Bf 109 —— 玩家恆在藍隊，換的是機種不是隊伍顏色', () => {
    const card = MISSIONS.axis.find((c) => c.type === '撤離')!
    const cfg = missionConfigFrom(card, 'axis')
    expect(cfg.blueSpec.id).toBe(BF109G6.id)
    expect(cfg.redSpec.id).toBe(P51D.id)
  })

  it('難度套 VETERAN —— 與 battleConfigFrom 同一條理由', () => {
    const card = MISSIONS.allies[0]!
    expect(missionConfigFrom(card, 'allies').aiProfile).toBe(VETERAN)
  })

  it('rules 由卡片產生，高度取自 DEFAULT_BATTLE', () => {
    const card = MISSIONS.allies.find((c) => c.type === '撤離')!
    const cfg = missionConfigFrom(card, 'allies')
    if (cfg.rules.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(cfg.rules.point.y).toBe(DEFAULT_BATTLE.altitude)
  })
})
```

- [ ] **Step 2：跑測試確認它失敗**

Run：`npx vitest run test/unit/missions.test.ts`
Expected：FAIL，`Cannot find module '../../src/battle/missions'`

- [ ] **Step 3：寫實作**

`git mv src/ui/missions.ts src/battle/missions.ts`，然後改寫成：

```ts
import { Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { specsFor, type FactionChoice } from './skirmish'
import { VETERAN } from '../ai/profile'
import type { MissionRules } from './mission'

/** 任務類型。對應 `docs/prompt.md` 規劃的五種 */
export type MissionType = '殲滅' | '攔截' | '打擊' | '護航' | '撤離'

/**
 * 一張任務卡。**它不再只是文案，是關卡資料** —— 所以離開了 `ui/`。
 */
export interface MissionCard {
  /** 全域唯一。`main.ts` 用它認出玩家點的是哪一關 */
  id: string
  title: string
  type: MissionType
  /**
   * 1~5 星。**這一張卡的配置的標籤，不是玩家的選項** —— 難度由編制與
   * 幾何給，`DifficultyProfile` 一貫不碰（`setup.ts` 的 `aiProfile` 註解）。
   */
  difficulty: number
  /** 卡片上的一行說明 */
  summary: string
  /**
   * HUD 目標列上的文字。
   *
   * 【為什麼放在卡片上而不是 `MissionState`】它是常數。放進狀態的話
   * `stepMission` 每個物理步跑 240 次，等於每秒配置 240 個字串。
   */
  objective: string
  /** 我方架數，含玩家 */
  blueCount: number
  redCount: number
  /** 撤離點在 −Z 多遠，m。非撤離任務為 0 */
  evacDistance: number
  /** 抵達半徑，m。**就是圓環半徑**。非撤離任務為 0 */
  evacRadius: number
  /** 時限，秒。無時限為 `Infinity` */
  seconds: number
  /**
   * 這一張卡做了沒有。false 的在選單上維持 disabled。
   *
   * 【為什麼是資料而不是由 type 推導】推導要寫成
   * `type === '殲滅' || type === '撤離'`，而那條式子會散落在選單與測試裡。
   * 補上攔截時只要把那張卡的旗標翻成 true。
   */
  playable: boolean
}

/** 沒有撤離點的卡共用這一組值 */
const NO_EVAC = { evacDistance: 0, evacRadius: 0, seconds: Infinity, playable: false } as const

/**
 * 【起始值，待掃描】撤離的四個數字，spec §8：
 *
 *   撤離點 −20,000 m ── 玩家起點 z≈+5,000，直線 25 km
 *   抵達半徑  1,000 m ── 20 km 外佔螢幕高度 8.8%
 *   時限        240 s ── 巡航 200 m/s 要 125 s；纏鬥速度 100~130 m/s 要 190~250 s
 *   藍/紅       4/16  ── 5 星的數量劣勢
 */
const EVAC = { evacDistance: 20000, evacRadius: 1000, seconds: 240, playable: true } as const
/** 【起始值，待掃描】殲滅是 2 星 */
const KILL = { ...NO_EVAC, playable: true }

export const MISSIONS: Record<FactionChoice, readonly MissionCard[]> = {
  allies: [
    {
      id: 'allies-sweep', title: '諾曼第上空掃蕩', type: '殲滅', difficulty: 2,
      summary: '清空灘頭上空的攔截機。', objective: '擊落全部敵機',
      blueCount: 8, redCount: 6, ...KILL,
    },
    {
      id: 'allies-intercept', title: '攔截 He 111 轟炸群', type: '攔截', difficulty: 3,
      summary: '在轟炸機投彈前擊落它們。', objective: '',
      blueCount: 4, redCount: 8, ...NO_EVAC,
    },
    {
      id: 'allies-strike', title: '打擊魯爾鐵路', type: '打擊', difficulty: 3,
      summary: '切斷補給線上的列車與調車場。', objective: '',
      blueCount: 4, redCount: 6, ...NO_EVAC,
    },
    {
      id: 'allies-escort', title: '護送 B-17 至集合點', type: '護航', difficulty: 4,
      summary: '把每一架轟炸機帶到集合點。', objective: '',
      blueCount: 4, redCount: 10, ...NO_EVAC,
    },
    {
      id: 'allies-evac', title: '且戰且走', type: '撤離', difficulty: 5,
      summary: '頂著數量劣勢活著退出戰區。', objective: '飛抵撤離點',
      blueCount: 4, redCount: 16, ...EVAC,
    },
  ],
  axis: [
    {
      id: 'axis-patrol', title: '帝國防空巡邏', type: '殲滅', difficulty: 2,
      summary: '驅離侵入本土空域的護航機。', objective: '擊落全部敵機',
      blueCount: 8, redCount: 6, ...KILL,
    },
    {
      id: 'axis-intercept', title: '攔截 B-17 轟炸群', type: '攔截', difficulty: 3,
      summary: '突破護航網，打掉重轟炸機。', objective: '',
      blueCount: 4, redCount: 8, ...NO_EVAC,
    },
    {
      id: 'axis-strike', title: '打擊登陸艦隊', type: '打擊', difficulty: 4,
      summary: '在灘頭上空掩護，攻擊登陸艦艇。', objective: '',
      blueCount: 4, redCount: 8, ...NO_EVAC,
    },
    {
      id: 'axis-escort', title: '護送運輸機', type: '護航', difficulty: 3,
      summary: '掩護運輸機穿越敵方巡邏區。', objective: '',
      blueCount: 4, redCount: 8, ...NO_EVAC,
    },
    {
      id: 'axis-evac', title: '撤出包圍', type: '撤離', difficulty: 5,
      summary: '在補給斷絕的機場起飛並脫離。', objective: '飛抵撤離點',
      blueCount: 4, redCount: 16, ...EVAC,
    },
  ],
}

/**
 * 卡片 → 勝負條件。
 *
 * 【為什麼撤離點的高度是參數而不是常數】高度設定改了，撤離點要自動跟上。
 * 寫死 4000 的話兩者會在某次調整之後靜靜地差開 —— 而症狀是「圓環浮在
 * 戰場上方，飛過去卻沒判到」。
 *
 * 【為什麼撤離點在 −Z】藍隊開局在 +Z、機首朝 −Z，紅隊在 −Z。所以撤離點
 * 在**敵人後方**，玩家必須打穿出去 —— 撤離點若在背後，最佳打法是開局
 * 轉頭直線飛，那不是一場仗（spec §6.1）。
 */
export function missionRules(card: MissionCard, altitude: number): MissionRules {
  if (card.type !== '撤離') return { kind: 'annihilate' }
  return {
    kind: 'evacuate',
    point: new Vector3(0, altitude, -card.evacDistance),
    radius: card.evacRadius,
    seconds: card.seconds,
  }
}

/**
 * 卡片 → 戰鬥設定。與 `skirmish.ts` 的 `battleConfigFrom` 對稱 ——
 * **兩者都是「設定 → `BattleConfig`」的唯一入口**，難度也在這裡套
 * （理由見 `setup.ts` 的 `aiProfile` 註解）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 */
export function missionConfigFrom(card: MissionCard, faction: FactionChoice): BattleConfig {
  const mine = specsFor(faction)
  const theirs = specsFor(faction === 'allies' ? 'axis' : 'allies')
  return {
    ...DEFAULT_BATTLE,
    blueCount: card.blueCount,
    redCount: card.redCount,
    blueSpec: mine[0]!,
    redSpec: theirs[0]!,
    aiProfile: VETERAN,
    rules: missionRules(card, DEFAULT_BATTLE.altitude),
  }
}
```

`src/ui/menu.ts:1` 的 import 改成 `from '../battle/missions'`。

- [ ] **Step 4：跑測試確認全綠**

Run：`npx vitest run test/unit/missions.test.ts && npx tsc --noEmit`
Expected：PASS，0 error

- [ ] **Step 5：Commit**

```bash
git add -A src/ui/missions.ts src/battle/missions.ts src/ui/menu.ts test/unit/missions.test.ts
git commit -m "feat: 任務卡長出關卡資料，從 ui/ 搬到 battle/"
```

---

## Task 4：畫面狀態機 + 選單卡片可點

**Files:**
- Modify: `src/ui/screens.ts`（`ScreenEvent`、`TABLE`）
- Modify: `src/ui/menu.ts`（`MenuHooks.onMission`、`renderMissions`）
- Modify: `index.html:116-119`（第二顆返回鈕）
- Test: `test/unit/screens.test.ts`（既有，補條目）

**Interfaces:**
- Consumes：Task 3 的 `MissionCard`、`MISSIONS`
- Produces：`ScreenEvent` 多一個 `'toMission'`；`MenuHooks.onMission(card: MissionCard): void`

- [ ] **Step 1：先寫失敗的測試**

在 `test/unit/screens.test.ts` 加：

```ts
describe('任務模式的兩條轉移', () => {
  it('任務列表可以開打', () => {
    expect(nextScreen('mission', 'fight')).toBe('battle')
  })

  it('結算可以回任務列表', () => {
    expect(nextScreen('battle', 'toMission')).toBe('mission')
  })

  it('遭遇戰頁送 toMission 不動 —— 不合法的組合回傳 current', () => {
    expect(nextScreen('skirmish', 'toMission')).toBe('skirmish')
  })

  it('任務列表仍然回得了主選單', () => {
    expect(nextScreen('mission', 'back')).toBe('menu')
  })
})
```

- [ ] **Step 2：跑測試確認它失敗**

Run：`npx vitest run test/unit/screens.test.ts`
Expected：FAIL，`nextScreen('mission','fight')` 回 `'mission'`

- [ ] **Step 3：寫實作**

`src/ui/screens.ts`：

```ts
export type ScreenEvent =
  | 'start'      // landing 的開始按鈕
  | 'mission'    // 主選單：任務模式
  | 'skirmish'   // 主選單：遭遇戰
  | 'back'       // 子畫面的返回
  | 'fight'      // 開始戰鬥／再打一場
  | 'toMenu'     // 暫停選單：回主選單
  | 'toSetup'    // 結算：回設定頁（遭遇戰）
  | 'toMission'  // 結算：回任務列表（任務模式）
```

```ts
  // 【`mission` 也能開打】M10 起這裡是空的，因為那時卡片全部 disabled
  mission: { back: 'menu', fight: 'battle' },
  skirmish: { back: 'menu', fight: 'battle' },
  // 【兩個回頭的出口】遭遇戰回設定頁、任務回任務列表。用兩個事件而不是
  // 一個「回上一頁」，因為狀態機不該記得歷史 —— 那會讓同一個轉移在不同
  // 的來路下有不同的結果，也就不再是一張表。
  battle: { fight: 'battle', toMenu: 'menu', toSetup: 'skirmish', toMission: 'mission' },
```

`src/ui/menu.ts`：第 1 行的 import 改成
`import { MISSIONS, type MissionCard } from '../battle/missions'`
（Codex 審查 2026-08-16：`MenuHooks` 用得到 `MissionCard`，原版沒列）。

`MenuHooks` 加：

```ts
  /**
   * 使用者點了一張任務卡。**先送這個，再送 `fight`** —— 呼叫端要先知道
   * 打哪一關，才建得出戰鬥。
   */
  onMission(card: MissionCard): void
```

`renderMissions` 的迴圈改成：

```ts
    for (const m of MISSIONS[missionFaction]) {
      const b = document.createElement('button')
      b.className = 'card'
      // 【只有做好的卡可點】看起來可點卻沒反應才是真的壞掉
      b.disabled = !m.playable
      b.innerHTML =
        `<span class="card-title">${escapeHtml(m.title)}</span>`
        + `<span class="card-desc">${escapeHtml(m.summary)}</span>`
        + `<span class="card-meta">${escapeHtml(m.type)}　${stars(m.difficulty)}</span>`
        + (m.playable ? '' : '<span class="locked">未開放</span>')
      if (m.playable) {
        b.addEventListener('click', () => {
          hooks.onMission(m)
          hooks.onEvent('fight')
        })
      }
      missionList.appendChild(b)
    }
```

【為什麼卡片用自己的監聽器而不是 `data-act`】`data-act` 只能帶一個字串，
而這裡要帶「哪一張卡」。`factionRow` 與 `stepper` 早就是這樣做的。

`index.html` 的 `#board-actions`：

```html
      <div id="board-actions" hidden>
        <button class="primary" data-act="fight">再打一場</button>
        <button class="ghost" data-act="toSetup">回設定頁</button>
        <button class="ghost" data-act="toMission" hidden>回任務列表</button>
      </div>
```

- [ ] **Step 4：跑測試確認全綠**

Run：`npx vitest run test/unit/screens.test.ts && npx tsc --noEmit`
Expected：PASS，0 error（`main.ts` 尚未提供 `onMission` 會報錯 —— 在 Task 7 補齊之前，先在 `main.ts` 的 `createMenu` 呼叫加一個 `onMission() {}` 空實作並留 `// Task 7 接線` 註解）

- [ ] **Step 5：Commit**

```bash
git add src/ui/screens.ts src/ui/menu.ts index.html src/main.ts test/unit/screens.test.ts
git commit -m "feat: 任務卡可點，結算多一個回任務列表的出口"
```

---

## Task 5：HUD 目標列 + 小地圖撤離點

**Files:**
- Modify: `src/hud/types.ts`（`HudFrame` 8 個欄位、`createHudFrame`）
- Create: `src/hud/widgets/objective.ts`
- Modify: `src/hud/widgets/minimap.ts`（撤離點符號）
- Modify: `src/hud/Hud.ts`（`HudWidget`、`FULL`、`GOD`，**switch 換成 `Record`**）
- Test: `test/unit/hud-objective.test.ts`（新）
- **Test: `test/unit/hud.test.ts:396-432`（既有的 `hudWidgets` 順序測試在這裡，
  不是 `hud-widgets.test.ts` —— 那個檔案不存在）**（Codex 審查 2026-08-16）

**★ 版面：目標列放左上角，不放上緣正中。**

上緣正中已經有**三層**，塞不下第四個（Codex 審查 2026-08-16 指出，實測 900 px 高、
`L.scale = 1`）：

| 元件 | y | 高 | 出處 |
|---|---|---|---|
| AI／上帝視角橫幅 | 18 | 13 | `hints.ts:44,52` |
| 存活數「20 vs 20」 | 36 | 15 | `roster.ts:31` |
| 航向帶 | 63 | — | `tape.ts:13` |

原本的「把橫幅移到 44」會直接壓在存活數上。**左上角是空的** —— `energy` 在
`x=30, y=0.32·height`、`health` 與 `minimap` 在左下，上方沒有東西。目標列因此
放 `x = 30 · scale`（與左欄同一條邊界）、`y = 18 · scale`、`textAlign = 'left'`。

**`hints.ts` 與 `roster.ts` 都不用改。**

**Interfaces:**
- Consumes：Task 1 的 `MissionState`（只透過 `HudFrame` 的欄位，widget 不 import `battle/`）
- Produces：`drawObjective`、`formatObjectiveMetric`、`formatCountdown`

- [ ] **Step 1：先寫失敗的測試**

`test/unit/hud-objective.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { formatCountdown, formatObjectiveMetric } from '../../src/hud/widgets/objective'
import { hudWidgets } from '../../src/hud/Hud'

describe('formatObjectiveMetric', () => {
  it('count 就是整數', () => {
    expect(formatObjectiveMetric(12, 'count')).toBe('12')
  })

  it('distance 在 1 km 以上用公里、一位小數', () => {
    expect(formatObjectiveMetric(18400, 'distance')).toBe('18.4 km')
  })

  it('distance 在 1 km 以下用公尺、整數 —— 快到的時候要看得出在動', () => {
    expect(formatObjectiveMetric(940, 'distance')).toBe('940 m')
  })

  it('負數與 NaN 不得印出來汙染畫面', () => {
    expect(formatObjectiveMetric(-5, 'count')).toBe('0')
    expect(formatObjectiveMetric(NaN, 'distance')).toBe('—')
  })
})

describe('formatCountdown', () => {
  it('分:秒，秒補零', () => {
    expect(formatCountdown(125)).toBe('2:05')
  })

  it('歸零之後不顯示負數', () => {
    expect(formatCountdown(-3)).toBe('0:00')
  })

  it('Infinity 回空字串 —— 無時限時不畫倒數', () => {
    expect(formatCountdown(Infinity)).toBe('')
  })
})

describe('hudWidgets', () => {
  it('一般飛行會畫目標列', () => {
    expect(hudWidgets(false)).toContain('objective')
  })

  it('上帝視角也畫 —— 它不是座艙儀表，是這一場的目標', () => {
    expect(hudWidgets(true)).toContain('objective')
  })

  /**
   * 【為什麼光是「在清單裡」不夠】清單與繪製是兩件事。`FULL` 更新了卻漏掉
   * 繪製分派的話，上面兩條仍然全綠而 HUD 完全不畫（Codex 審查 2026-08-16）。
   * 分派改成 `Record` 之後這一條是防禦而不是主要保證 —— 主要保證是編譯錯誤。
   */
  it('清單上的每一個 widget 都真的有繪製函數', () => {
    for (const godView of [false, true]) {
      for (const w of hudWidgets(godView)) {
        expect(WIDGET_DRAW[w], `${w}（godView=${godView}）`).toBeTypeOf('function')
      }
    }
  })
})
```

（`WIDGET_DRAW` 從 `../../src/hud/Hud` import。**這些 `describe` 加在
`test/unit/hud.test.ts`，不是新檔案** —— 既有的 `hudWidgets` 順序測試在
`hud.test.ts:396-432`。`formatObjectiveMetric` / `formatCountdown` 那兩個
`describe` 才放新的 `test/unit/hud-objective.test.ts`。）

- [ ] **Step 2：跑測試確認它失敗**

Run：`npx vitest run test/unit/hud-objective.test.ts`
Expected：FAIL，模組不存在

- [ ] **Step 3：寫實作**

`src/hud/types.ts` 的 `HudFrame` 加：

```ts
  /**
   * 這一場有沒有任務目標。false 時整組欄位無意義（遭遇戰不顯示目標列）。
   *
   * 【為什麼不由 `rules` 推導】遭遇戰與殲滅任務的 `rules` **完全相同**
   * （spec §5），差別只在「這一場是不是從任務列表進來的」—— 那是畫面
   * 模式，不是規則。所以由 `main.ts` 給。
   */
  objectiveActive: boolean
  /** 目標文字。逐幀指派**同一個**字串參考，不組字串 */
  objectiveText: string
  /** 計量。殲滅＝剩餘敵機數，撤離＝到撤離點的距離 m */
  objectiveMetric: number
  objectiveMetricKind: 'count' | 'distance'
  /** 剩餘秒數。`Infinity` 時不畫倒數 */
  objectiveSeconds: number
  /** 撤離點的世界平面座標，供小地圖。false 時無意義 */
  objectiveHasTarget: boolean
  objectiveWorldX: number
  objectiveWorldZ: number
```

`createHudFrame` 加對應的初值：

```ts
    objectiveActive: false, objectiveText: '', objectiveMetric: 0,
    objectiveMetricKind: 'count', objectiveSeconds: Infinity,
    objectiveHasTarget: false, objectiveWorldX: 0, objectiveWorldZ: 0,
```

`src/hud/widgets/objective.ts`：

```ts
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 距離改用公尺顯示的門檻，m。
 *
 * 【為什麼要換單位】撤離的最後 1 km 是最緊張的一段，而「0.9 km」這個數字
 * 每兩秒才動一次小數點。換成公尺之後它每一幀都在跳 —— 那正是玩家要的回饋。
 * 門檻取 1000 是因為它剛好等於抵達半徑的起始值，所以「換成公尺」與「進入
 * 判定範圍」在畫面上是同一件事。
 */
const METRE_BELOW = 1000

/**
 * 計量的文字。
 *
 * 【為什麼非有限值印破折號而不是 0】0 在殲滅那一側的意思是「贏了」。
 * 讓一個壞掉的數字長得像勝利，是最糟的失敗模式。
 */
export function formatObjectiveMetric(v: number, kind: 'count' | 'distance'): string {
  if (!Number.isFinite(v)) return '—'
  const x = v > 0 ? v : 0
  if (kind === 'count') return String(Math.round(x))
  if (x < METRE_BELOW) return `${Math.round(x)} m`
  return `${(x / 1000).toFixed(1)} km`
}

/** 倒數。`Infinity` 回空字串 —— 無時限時整段不畫 */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  const s = seconds > 0 ? Math.ceil(seconds) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 倒數轉紅的門檻，秒。【起始值，待掃描】 */
const URGENT = 30

/**
 * 目標列。**畫面左上角**，一行。
 *
 * 【為什麼不放上緣正中】那裡已經有三層：AI／上帝視角橫幅（`hints.ts:44,52`，
 * y=18）、存活數（`roster.ts:31`，y=0.04·height）、航向帶（`tape.ts:13`，
 * y=0.07·height）。900 px 高時它們分別落在 18–31、36–51、63 —— 塞第四個
 * 一定壓到某一個（Codex 審查 2026-08-16）。
 *
 * 【為什麼左上角】`x = 30·scale` 是這個 HUD 的左欄邊界（`energy.ts:17`、
 * `health.ts:17`、`minimap.ts:54` 都用它），而左欄的**上方是空的**。
 *
 * 【組字串在這裡是可以的】HUD 走的是**畫面**頻率（~60 Hz）而不是物理步
 * （240 Hz），而且 `dials.ts` 等既有 widget 本來就在組。不配置的紀律守的是
 * 物理熱路徑，那一側是 `stepMission`（它刻意不碰任何字串）。
 */
export function drawObjective(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  if (!f.objectiveActive) return

  const metric = formatObjectiveMetric(f.objectiveMetric, f.objectiveMetricKind)
  const clock = formatCountdown(f.objectiveSeconds)
  const text = clock === ''
    ? `${f.objectiveText}　${metric}`
    : `${f.objectiveText}　${metric}　${clock}`

  const size = 14 * L.scale
  const pad = 8 * L.scale
  const x = 30 * L.scale
  const y = 18 * L.scale
  ctx.font = hudFont(size, true)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const w = ctx.measureText(text).width + pad * 2
  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x - pad, y - pad * 0.5, w, size + pad)

  // 【倒數快到時整列轉紅，不只轉那三個字元】纏鬥中的餘光掃不到三個字元的
  // 顏色變化，掃得到一整列。`Infinity < URGENT` 是 false，所以無時限恆是綠的。
  ctx.fillStyle = f.objectiveSeconds < URGENT ? HUD_COLORS.danger : HUD_COLORS.primary
  ctx.fillText(text, x, y)
}
```

`src/hud/widgets/minimap.ts`：在接觸點迴圈之後、`ctx.restore()` 之前加撤離點：

```ts
  // 撤離點。**與接觸點共用 `edgeClamp`** —— 不新增幾何原語（spec §7.7）。
  //
  // 【為什麼畫成圓圈而不是第四種三角形】三角／方／倒三角在這張圖上的語意
  // 是「相對高度」，而撤離點沒有那個語意。借用會讓玩家讀出一個不存在的意思。
  if (f.objectiveHasTarget) {
    let rx = (f.objectiveWorldX - f.worldX) * px
    let rz = (f.objectiveWorldZ - f.worldZ) * px
    const sx = rx * cosH + rz * sinH
    const sy = -rx * sinH + rz * cosH
    const k = edgeClamp(sx, sy, edge)
    const beyond = k < 1
    if (beyond) { rx *= k; rz *= k }
    ctx.save()
    ctx.globalAlpha = beyond ? 0.35 : 1
    ctx.strokeStyle = HUD_COLORS.primary
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(rx, rz, 5 * L.scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
```

`src/hud/Hud.ts`：`HudWidget` 加 `'objective'`；`FULL` 與 `GOD` 都加（放在最後 ——
它壓在最上層，是這一場的目標，不該被任何面板蓋住）；補
`import { drawObjective } from './widgets/objective'`。

**★ `render` 的 switch 換成 `Record`**（Codex 審查 2026-08-16）：原本的 switch
少一個 `case` 只是**靜靜地不畫** —— `FULL` 更新了卻漏掉分支的話，Task 5 的
測試仍然全綠而 HUD 完全不顯示。`Record<HudWidget, …>` 少一格是**編譯錯誤**。

```ts
type WidgetDraw = (
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame, dt: number,
) => void

/**
 * widget → 繪製函數。
 *
 * 【為什麼是 `Record` 而不是 switch】少一個分支在 switch 裡是靜靜地不畫；
 * 在 `Record<HudWidget, …>` 裡是編譯錯誤。`hudWidgets` 的清單與這張表是
 * 同一個聯集的兩個消費者，型別系統因此保證它們對得起來。
 *
 * 【為什麼統一吃 dt】只有 `drawGEffect` 用得到（黑視的淡入淡出）。讓其餘
 * 的忽略它，比開兩張表或在呼叫點分歧簡單。
 */
export const WIDGET_DRAW: Record<HudWidget, WidgetDraw> = {
  gEffect: (ctx, L, f, dt) => drawGEffect(ctx, L, f, dt),
  godMarkers: (ctx, L, f) => drawGodMarkers(ctx, L, f),
  damageEdge: (ctx, L, f) => drawDamageEdge(ctx, L, f),
  contacts: (ctx, L, f) => drawContacts(ctx, L, f),
  reticle: (ctx, L, f) => drawReticle(ctx, L, f),
  tape: (ctx, L, f) => drawHeadingTape(ctx, L, f),
  dials: (ctx, L, f) => drawDials(ctx, L, f),
  minimap: (ctx, L, f) => drawMinimap(ctx, L, f),
  health: (ctx, L, f) => drawHealth(ctx, L, f),
  energy: (ctx, L, f) => drawEnergy(ctx, L, f),
  roster: (ctx, L, f) => drawRoster(ctx, L, f),
  hints: (ctx, L, f) => drawHints(ctx, L, f),
  objective: (ctx, L, f) => drawObjective(ctx, L, f),
}
```

`render` 的迴圈變成：

```ts
    for (const w of hudWidgets(f.godView)) WIDGET_DRAW[w](ctx, L, f, dt)
```

- [ ] **Step 4：跑測試確認全綠**

Run：`npx vitest run test/unit/hud-objective.test.ts test/unit/hud.test.ts && npx tsc --noEmit`
Expected：PASS，0 error（`hud.test.ts:396-432` 既有的順序測試要跟著補上 `'objective'`）

- [ ] **Step 5：Commit**

```bash
git add src/hud test/unit/hud-objective.test.ts test/unit/hud.test.ts
git commit -m "feat: HUD 目標列與小地圖上的撤離點"
```

---

## Task 6：3D 圓環 `src/render/objectiveRing.ts`

**Files:**
- Create: `src/render/objectiveRing.ts`
- Test: `test/unit/objective-ring.test.ts`（新）

**Interfaces:**
- Produces：`ObjectiveRing`、`createObjectiveRing`

- [ ] **Step 1：先寫失敗的測試**

`test/unit/objective-ring.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createObjectiveRing } from '../../src/render/objectiveRing'

describe('objectiveRing', () => {
  it('update 之後圓心落在指定座標上', () => {
    const ring = createObjectiveRing()
    const cam = new PerspectiveCamera()
    cam.position.set(0, 4000, 5000)
    ring.update(new Vector3(0, 4000, -20000), 1000, cam)
    expect(ring.object.position.z).toBe(-20000)
    ring.dispose()
  })

  /**
   * ★ **看到的圈就是判定範圍。**
   *
   * billboard 圓環是那顆判定球的輪廓 —— 半徑必須逐字等於 `radius`，
   * 差一點都會讓「我明明穿過去了卻沒算到」變成可能。
   */
  it('縮放讓圓環的世界半徑逐字等於判定半徑', () => {
    const ring = createObjectiveRing()
    const cam = new PerspectiveCamera()
    cam.position.set(0, 4000, 5000)
    ring.update(new Vector3(0, 4000, -20000), 1000, cam)
    // 幾何以單位半徑建，縮放即半徑
    expect(ring.object.scale.x).toBeCloseTo(1000, 6)
    expect(ring.object.scale.y).toBeCloseTo(1000, 6)
    ring.dispose()
  })

  it('環面法線指向相機 —— 從任何角度看都是正圓', () => {
    const ring = createObjectiveRing()
    const cam = new PerspectiveCamera()
    const centre = new Vector3(0, 4000, -20000)
    for (const p of [
      new Vector3(0, 4000, 5000),
      new Vector3(9000, 1000, -20000),
      new Vector3(-3000, 12000, -25000),
    ]) {
      cam.position.copy(p)
      ring.update(centre, 1000, cam)
      const normal = new Vector3(0, 0, 1).applyQuaternion(ring.object.quaternion)
      const toCam = p.clone().sub(centre).normalize()
      expect(normal.dot(toCam), `相機在 ${p.toArray().join(',')}`).toBeCloseTo(1, 6)
    }
    ring.dispose()
  })

  it('setVisible(false) 之後不畫', () => {
    const ring = createObjectiveRing()
    ring.setVisible(false)
    expect(ring.object.visible).toBe(false)
    ring.dispose()
  })
})
```

- [ ] **Step 2：跑測試確認它失敗**

Run：`npx vitest run test/unit/objective-ring.test.ts`
Expected：FAIL，模組不存在

- [ ] **Step 3：寫實作**

`src/render/objectiveRing.ts`：

```ts
import {
  AdditiveBlending, Camera, DoubleSide, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Vector3,
} from 'three'

/** 環的線寬佔半徑的比例。【起始值，待掃描】 */
const THICKNESS = 0.04
/** 圓周分段數。20 km 外只佔螢幕 8.8%，128 段已經看不出多邊形 */
const SEGMENTS = 128
/** 環的顏色。與 `HUD_COLORS.primary` 同一個綠 —— 它是目標，不是威脅 */
const COLOR = 0x7dfba8

export interface ObjectiveRing {
  readonly object: Object3D
  /** 每幀更新：圓心、半徑、正對相機 */
  update(centre: Vector3, radius: number, camera: Camera): void
  setVisible(v: boolean): void
  dispose(): void
}

/**
 * 撤離點的 3D 圓環。
 *
 * 【為什麼是 billboard 而不是固定朝向的環面】判定是球形
 * （`playerPos.distanceTo(point) < radius`），而 billboard 圓環**就是那顆
 * 球的輪廓** —— 所以「你看到的那個圈 = 判定範圍」從**任何角度**都逐字
 * 成立。固定朝向的環面從側面看是一條線，玩家會遇到「我明明穿過去了卻
 * 沒算到」，而那種 bug 沒有辦法從畫面上自我解釋（spec §6.3）。
 *
 * 【為什麼幾何以單位半徑建、用 scale 給大小】半徑是每一關的參數，而
 * `RingGeometry` 改半徑要重建整個 buffer。縮放是免費的，而且讓「縮放即
 * 半徑」成為一條測得到的性質。
 *
 * 【為什麼吃霧】20 km 處只有 7.5%（`fog.ts` 的 `FOG_DENSITY`），不影響
 * 辨識；而關掉霧會讓它在遠處比周圍的世界更清楚，看起來像貼在螢幕上的
 * UI 而不是天上的一個東西。
 */
export function createObjectiveRing(): ObjectiveRing {
  const geometry = new RingGeometry(1 - THICKNESS, 1, SEGMENTS)
  const material = new MeshBasicMaterial({
    color: COLOR,
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
    // 【加法混色】天空背景上它會發亮，而不是變成一個灰掉的圈
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false

  return {
    object: mesh,
    update(centre, radius, camera) {
      mesh.position.copy(centre)
      mesh.scale.setScalar(radius)
      // `RingGeometry` 躺在 XY 平面、法線是 +Z；lookAt 把 +Z 轉向相機
      mesh.lookAt(camera.position)
    },
    setVisible(v) {
      mesh.visible = v
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4：跑測試確認全綠**

Run：`npx vitest run test/unit/objective-ring.test.ts && npx tsc --noEmit`
Expected：PASS，0 error

- [ ] **Step 5：Commit**

```bash
git add src/render/objectiveRing.ts test/unit/objective-ring.test.ts
git commit -m "feat: 撤離點的 3D 圓環 —— 看到的圈就是判定範圍"
```

---

## Task 7：`main.ts` 接線

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes：Task 3 的 `missionConfigFrom`、`MissionCard`；Task 5 的 `HudFrame` 欄位；Task 6 的 `createObjectiveRing`

- [ ] **Step 0：補 import**

（Codex 審查 2026-08-16：`main.ts:47-57` 目前沒有這些。）

```ts
import { missionConfigFrom, type MissionCard } from './battle/missions'
import { createObjectiveRing } from './render/objectiveRing'
```

`FactionChoice` 已經由 `./battle/skirmish` 匯出，確認既有的 import 行有帶上它。

- [ ] **Step 1：模式狀態**

在 `let setup: SkirmishSetup = { ...DEFAULT_SKIRMISH }`（`main.ts:86`）附近加：

```ts
/**
 * 這一場是從哪裡進來的。
 *
 * 【為什麼不由 `battle.cfg.rules` 推導】遭遇戰與殲滅任務的 `rules`
 * **完全相同**（spec §5）—— 差別只在來路。它決定 HUD 畫不畫目標列、
 * 結算的第二顆按鈕回哪裡。
 */
let mode: 'skirmish' | 'mission' = 'skirmish'
/** 玩家點的那一張卡。`mode === 'mission'` 時才有意義 */
let pendingMission: MissionCard | null = null
/** 任務模式的陣營。與遭遇戰的那一個互不相干（`menu.ts` 的 `missionFaction`） */
let missionFaction: FactionChoice = 'allies'
```

- [ ] **Step 2：`enterBattle` 分流與圓環生命週期**

`enterBattle`（`main.ts:387`）的第 4 步改成：

```ts
  // 4. 新的世界。【兩條路各自有唯一的設定入口】遭遇戰走 battleConfigFrom、
  //    任務走 missionConfigFrom —— 難度 VETERAN 都在那兩個函數裡套。
  const cfg = mode === 'mission' && pendingMission !== null
    ? missionConfigFrom(pendingMission, missionFaction)
    : battleConfigFrom(setup)
  battle = createBattle(playerController, cfg)
```

在 `rebuildVisuals()` 之後加：

```ts
  // 【圓環比照地形每一場都重建】那條路徑因此每一場都在走，不是一條等著被
  // 第一次使用的死碼（M10 spec §5.3）。沒有撤離點的一場就是建了不加進場景。
  ctx.scene.remove(objectiveRing.object)
  objectiveRing.dispose()
  objectiveRing = createObjectiveRing()
  if (battle.mission.hasTarget) ctx.scene.add(objectiveRing.object)
```

模組層加 `let objectiveRing = createObjectiveRing()`。

`leaveBattle()` 要把圓環從場景移除（否則回主選單還看得到它浮在背景上）。

- [ ] **Step 3：★ 圓環在 3D 渲染之前更新，HudFrame 在 `hud.render` 之前填**

**這是兩個不同的位置。**（Codex 審查 2026-08-16：原版把兩件事都放在
`hud.render` 之前，而 `ctx.renderer.render` 在 `main.ts:873`、`hud.render` 在
`main.ts:1022` —— 圓環會**慢整整一幀**，而且新建的那一幀會以原點、半徑 1 畫出來。）

（a）`stepAndDrawBattle` 裡，緊接在 `orderMarkers` 那一段之後、
**`ctx.renderer.render(ctx.scene, ctx.camera)`（`main.ts:873`）之前**：

```ts
  // 【一定要排在 renderer.render 之前】billboard 的 lookAt 讀的是相機**這一幀**
  // 的位置。排在渲染之後的話環會慢一幀，而且新建的第一幀會停在原點、半徑 1。
  if (battle.mission.hasTarget) {
    objectiveRing.update(battle.mission.target, battle.mission.targetRadius, ctx.camera)
  }
```

（b）在 `hud.render(hudFrame, frameSeconds)`（`main.ts:1022`）之前：

```ts
  // ── 任務目標 ──────────────────────────────────────────
  const m = battle.mission
  hudFrame.objectiveActive = mode === 'mission'
  hudFrame.objectiveText = pendingMission?.objective ?? ''
  hudFrame.objectiveMetric = m.metric
  hudFrame.objectiveMetricKind = m.hasTarget ? 'distance' : 'count'
  hudFrame.objectiveSeconds = m.secondsLeft
  hudFrame.objectiveHasTarget = m.hasTarget
  hudFrame.objectiveWorldX = m.target.x
  hudFrame.objectiveWorldZ = m.target.z
```

- [ ] **Step 3b：重現紀錄要印真正的設定**

`main.ts:428-431` 的那一行印的是 `setup.blueCount / setup.specId / setup.redCount`
—— 任務模式下那三個是**遭遇戰**的設定，與這一場毫無關係。而那段註解明寫它是
「重現一場戰鬥的鑰匙」（Codex 審查 2026-08-16）。改成印 `battle.cfg` 的實值：

```ts
  console.log(
    `[戰鬥] 種子 ${battle.seed}　${mode === 'mission' ? pendingMission?.id ?? '?' : '遭遇戰'}`
    + `　藍 ${battle.cfg.blueCount} × ${battle.cfg.blueSpec.id}`
    + `　紅 ${battle.cfg.redCount} × ${battle.cfg.redSpec.id}`
    + `　規則 ${battle.cfg.rules.kind}　玩家座位 #${player.index}`,
  )
```

- [ ] **Step 4：結算的兩顆按鈕**

`stepAndDrawBattle` 尾端的 `boardActions.hidden = !finished` 旁邊加：

```ts
  // 【兩個出口依模式擇一】不改 data-act —— 它是選單那一層唯一的協定
  // （`menu.ts` 的事件委派註解）。逐幀改它等於讓一個 DOM 屬性變成隱性狀態。
  backToSetup.hidden = mode !== 'skirmish'
  backToMission.hidden = mode !== 'mission'
```

模組層取節點：`const backToSetup = document.querySelector('[data-act="toSetup"]') as HTMLElement`、
`backToMission` 同理。

- [ ] **Step 5：選單 hook**

`createMenu` 的 hooks 加：

```ts
  onMission(card) {
    mode = 'mission'
    pendingMission = card
    missionFaction = card.id.startsWith('axis') ? 'axis' : 'allies'
  },
```

【為什麼從 id 推陣營而不是多傳一個參數】`MISSIONS` 的鍵就是陣營，而 id 的
前綴是照那個鍵取的（`battle/missions.ts`）—— 由測試釘住（Task 3 的「id 全域
唯一」再加一條前綴斷言）。

`onEvent` 裡，`skirmish` 那條路要把 `mode` 設回 `'skirmish'`：

```ts
    // 【回設定頁或從主選單進遭遇戰時要換回來】少了這一行，打過一關任務之後
    // 再打遭遇戰，HUD 會留著上一關的目標列。
    if (event === 'skirmish' || event === 'toSetup') {
      mode = 'skirmish'
      pendingMission = null
    }
```

- [ ] **Step 5b：釘住圓環的生命週期**

在 `test/unit/hud.test.ts` 之外另開一條註記即可（`main.ts` 進不了單元測試），
但**要在 Task 10 的 Playwright 裡驗**：

> 暫停選單的「重新開始」走 `resetBattle` 而不是 `enterBattle`（`main.ts:348`），
> 所以圓環**不重建**。它必須留在場景裡而且下一幀照常更新 —— rules、target、
> 幾何與場景歸屬都沒有換（Codex 審查 2026-08-16 建議 7）。
>
> 「再打一場」走 `enterBattle`（`main.ts:1073-1087`），那時才重建。
> 所有 `battle → 非 battle` 都會呼叫 `leaveBattle`，圓環在那裡移出場景。

- [ ] **Step 6：型別檢查與手動驗證**

Run：`npx tsc --noEmit && npx vitest run`
Expected：0 error；紅數仍為 3

Run：`npm run dev`，手動走一次：主選單 → 任務 → 同盟國 → 「且戰且走」→
看得到目標列與圓環 → ESC → 回主選單 → 遭遇戰 → 目標列消失。

- [ ] **Step 7：Commit**

```bash
git add src/main.ts
git commit -m "feat: main.ts 接上任務模式、圓環與目標列"
```

---

## Task 8：整合測試 —— headless 撤離

**Files:**
- Create: `test/integration/mission-evacuate.test.ts`

- [ ] **Step 1：寫測試**

```ts
/**
 * **撤離任務真的打得完，而且時限真的生效。**
 *
 * 【為什麼要消融】只斷言「不飛就輸」的話，若時限根本沒接上、輸的原因其實是
 * 被打死，這支測試仍然全綠。把 `seconds` 設成 `Infinity` 之後那一條必須不再
 * 成立 —— 那讓「時限有效」可證偽。
 */
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import { WEP_THROTTLE } from '../../src/physics/propulsion'

const DT = 1 / 240

/** 一路朝撤離點飛，不開火 */
class Runner implements Controller {
  constructor(private readonly point: Vector3) {}
  private readonly aim = new Vector3()
  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    this.aim.copy(this.point).sub(self.state.position).normalize()
    out.aimWorld.copy(this.aim)
  }
}

/**
 * 往**反方向**飛，永遠到不了撤離點。
 *
 * 【為什麼不是「維持現在的航向」】Codex 審查 2026-08-16：藍隊出生時機首朝
 * −Z（`setup.ts:271-285`），而撤離點也在 −Z —— 一個「維持航向」的控制器
 * 會直飛撤離點然後判 victory，那條「超時落敗」的測試會量到完全相反的東西。
 */
class Away implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.6
    out.brake = 0
    out.firing = false
    out.aimWorld.set(0, 0, 1)   // +Z：撤離點的反方向
  }
}

const CARD = MISSIONS.allies.find((c) => c.type === '撤離')!

/**
 * 讓兩隊的槍都不痛。
 *
 * 【為什麼一定要】Codex 審查 2026-08-16：不隔離戰損的話，「超時落敗」與
 * 「被打死落敗」在 `outcome === 'defeat'` 上長得一模一樣 —— 時限根本沒接上
 * 的實作，兩場都因戰損落敗，三條測試仍然全綠。前例：`ai-shot-yield.test.ts:61`。
 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}

function run(controller: Controller, seconds: number, over: Partial<{ seconds: number }> = {}) {
  const base = missionConfigFrom(CARD, 'allies')
  const rules = base.rules.kind === 'evacuate' && over.seconds !== undefined
    ? { ...base.rules, seconds: over.seconds }
    : base.rules
  const b = createBattle(controller, {
    ...base,
    rules,
    blueSpec: { ...base.blueSpec, battery: harmless(base.blueSpec.battery) },
    redSpec: { ...base.redSpec, battery: harmless(base.redSpec.battery) },
  })
  const steps = Math.round(seconds * 240)
  for (let i = 0; i < steps; i++) {
    stepBattle(b, DT)
    if (b.outcome !== 'fighting') break
  }
  return b
}

function aliveBlue(b: ReturnType<typeof run>): number {
  return b.blue.filter((c) => c.alive).length
}

describe('撤離任務', () => {
  it('直飛撤離點 → victory，而且時限還有剩', () => {
    const rules = missionConfigFrom(CARD, 'allies').rules
    if (rules.kind !== 'evacuate') throw new Error('應為 evacuate')
    const b = run(new Runner(rules.point), CARD.seconds)
    console.log(
      `[撤離] 直飛：${b.outcome}　剩餘 ${b.mission.secondsLeft.toFixed(1)} s`
      + `　距離 ${b.mission.metric.toFixed(0)} m　我方剩 ${aliveBlue(b)}`,
    )
    expect(b.outcome).toBe('victory')
    expect(b.mission.secondsLeft).toBeGreaterThan(0)
  })

  /**
   * 【四條斷言缺一不可】只斷言 `defeat` 的話，任何原因的落敗都算通過。
   * 這四條合起來說的是「**它是因為時限到了才輸的**」：
   * 還有人活著、玩家在圈外、倒數確實歸零、結果是落敗。
   */
  it('反方向飛 → 時限歸零 → defeat（而且不是被打死的）', () => {
    const rules = missionConfigFrom(CARD, 'allies').rules
    if (rules.kind !== 'evacuate') throw new Error('應為 evacuate')
    const b = run(new Away(), CARD.seconds + 5)
    console.log(
      `[撤離] 反向：${b.outcome}　剩餘 ${b.mission.secondsLeft.toFixed(1)} s`
      + `　距離 ${b.mission.metric.toFixed(0)} m　我方剩 ${aliveBlue(b)}`,
    )
    expect(b.outcome).toBe('defeat')
    expect(b.mission.secondsLeft).toBeLessThanOrEqual(0)
    expect(aliveBlue(b), '不得是被全滅輸的').toBeGreaterThan(0)
    expect(b.mission.metric, '玩家必須還在圈外').toBeGreaterThan(rules.radius)
  })

  /**
   * ★ **消融：拿掉時限，上一條必須不再成立。**
   *
   * 【為什麼斷言 `fighting` 而不是「若 defeat 則全滅」】後者在時限沒接上時
   * 也成立（Codex 審查 2026-08-16）。槍已經不痛了，所以跑完同樣的時長之後
   * 唯一正確的結果就是**還在打**。
   */
  it('把時限設成 Infinity 之後，同樣的跑法仍然是 fighting', () => {
    const b = run(new Away(), CARD.seconds + 5, { seconds: Infinity })
    expect(b.mission.secondsLeft).toBe(Infinity)
    expect(b.outcome).toBe('fighting')
    expect(aliveBlue(b)).toBeGreaterThan(0)
  })
}, 5 * 60 * 1000)
```

**import 要多兩個**：`import type { Battery } from '../../src/weapons/types'`、
`import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'`。

【`createBattle` 沒有設 `crashPolicy`】`World.crashPolicy` 的預設是「永不撞地」
（`main.ts:415` 才裝上真的那一條）。所以無頭測試裡沒有人會墜海 —— 實作時**要
確認這一點**，若預設不是那樣，`Away` 要改成維持高度而不是純水平。

- [ ] **Step 2：跑測試**

Run：`npx vitest run test/integration/mission-evacuate.test.ts`
Expected：三條全綠。**若第一條紅（直飛也到不了），那是 Task 9 要掃的參數問題，
不是程式錯 —— 先把實測數字記下來，到 Task 9 一起定值。**

- [ ] **Step 3：Commit**

```bash
git add test/integration/mission-evacuate.test.ts
git commit -m "test: 撤離任務的整合驗收與時限消融"
```

---

## Task 9：起始值掃描與回填

**Files:**
- Create: `test/tools/evacuate.probe.ts`
- Modify: `src/battle/missions.ts`（回填定值）
- Modify: `docs/superpowers/specs/2026-08-16-mission-framework-design.md`（§8 回填）

- [ ] **Step 1：寫探針**

`test/tools/evacuate.probe.ts`（**不是測試**，跑法 `npx vite-node test/tools/evacuate.probe.ts`）。

**★ 這一輪量得到什麼、量不到什麼，先講清楚。**

Codex 審查 2026-08-16 指出：`AiController`（`AiController.ts:210-289`）**只認識
敵機、站位與 `FlightOrder`，完全沒有任務目標的輸入**。所以「AI 代飛的撤離到達率」
量出來的是「戰鬥 AI 恰好飛進圓環的機率」—— 那個數字不能用來定距離與時限。

**這一輪只量得到兩個界**，而這兩個界已經足以定出起始值：

- **下界（時間）**：帶槍但**不迴避**的直飛。它給的是「路徑要飛多久」的下限。
- **難度讀數（存活）**：同一場直飛時的被擊落率。它給的是「頂著 16 架背後追打
  能不能活著飛完」。

**量不到的是「一邊打一邊走」** —— 那需要 AI 長出撤離行為，屬於下一輪
（進 `docs/backlog.md`，與「僚機不會撤離」同一條）。

三張表：

1. **撤離點距離 × 到達時間**（`Runner` 直飛，帶槍、雙方都會開火）。
   候選距離 `12000 / 16000 / 20000 / 25000 / 30000`。
   每格記：到達秒數、玩家是否活著到、藍隊剩幾架。
   **時限由「到達秒數 × 餘裕」反推**，餘裕本身也掃（`1.2 / 1.4 / 1.6`）。
2. **架數** —— `4/8`、`4/12`、`4/16`、`4/20`、`6/16`，同樣是直飛。
   記玩家的存活率（各跑 5 顆種子）。**要回答的是「5 星該有多難」。**
3. **抵達半徑** —— `500 / 1000 / 1500 / 2000`。
   記「直飛時第一次進入半徑的那一步、距離圓心多遠」（驗證判定沒有跳過），
   以及「這個半徑的圓環在 20 km 外佔螢幕高度的比例」（`2·atan(r/20000)/65°`）。

【為什麼種子要跑 5 顆】`createBattle` 的 `seed` 只配名字、不進物理路徑
（M9 spec §6.2），所以**同一組設定跑五次是逐位元相同的**。要有變異必須改
設定本身 —— 用五個不同的**開局空速**（`tas`：180/190/200/210/220）代替種子。
這件事實作時要先確認，若真的完全決定性，表格就只跑一次並在 spec 註明。

- [ ] **Step 2：跑探針，把三張表貼進 spec §8**

Run：`npx vite-node test/tools/evacuate.probe.ts 2>&1 | tee /tmp/evac.txt`

- [ ] **Step 3：依實測回填定值**

改 `src/battle/missions.ts` 的 `EVAC` / `KILL` / 各卡的 `blueCount` / `redCount`，
並把每一個常數的註解從 `【起始值，待掃描】` 改成推導。

**判準**：直飛的存活率要落在「不是必到、也不是必死」之間，時限要讓直飛「到得了
但不寬鬆」。**具體門檻由專案負責人裁定** —— 掃描的結果先呈上去，不自己定
（護欄重新定值是負責人的決定）。

同時把 spec §10 加一條已知未解：**「一邊打一邊走」量不到，因為 AI 沒有撤離行為。**

- [ ] **Step 4：重跑 Task 8 的整合測試**

Run：`npx vitest run test/integration/mission-evacuate.test.ts`
Expected：三條全綠

- [ ] **Step 5：Commit**

```bash
git add test/tools/evacuate.probe.ts src/battle/missions.ts docs/superpowers/specs/2026-08-16-mission-framework-design.md
git commit -m "test: 撤離參數掃描，起始值換成實測定值"
```

---

## Task 10：Playwright 驗收、全套回歸、spec 回填

**Files:**
- Create/Modify: `test/e2e/mission.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-16-mission-framework-design.md`（§11）
- Modify: `docs/backlog.md`（§10 的四條）

- [ ] **Step 1：Playwright**

```ts
test('任務列表：四張可點、六張未開放', ...)
test('點「且戰且走」進得了戰鬥，HUD 出現目標列', ...)
test('撤離的圓環畫得出來', ...)   // 截圖判準：畫面中出現 HUD_COLORS.primary 的環
test('結算的「回任務列表」回得去', ...)
test('遭遇戰不顯示目標列', ...)   // 反證：這一條確認 objectiveActive 真的有分流
```

Run：`npx playwright test test/e2e/mission.spec.ts`

- [ ] **Step 2：★ 全套回歸比較**

Run：`npx vitest run 2>&1 | tail -60`

逐條對照基準（`b4ddff8`：2506 綠 / 3 紅）。**綠數只能增加，紅數必須仍是那三條。**
任何組成變化都要在 spec §11 逐條解釋。

- [ ] **Step 3：回填 spec §11**

寫入：掃描結果、回歸比較表、Codex 兩輪審查的發現與處置、試飛驗收。

- [ ] **Step 4：`docs/backlog.md`**

把 spec §10 的四條搬進去，每一條**附出處**（spec 章節或 `file:line`）——
這是 backlog 的規則，沒有出處的條目視為過期。

- [ ] **Step 5：Commit**

```bash
git add -A
git commit -m "docs: 任務框架驗收回填"
```
