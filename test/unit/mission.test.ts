import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createMissionState, resetMissionState, stepMission,
  type MissionInputs, type MissionRules,
} from '../../src/battle/mission'

const DT = 1 / 240

function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
  return {
    aliveBlue: 4,
    aliveRed: 16,
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

  /**
   * 【逐字等於現況】改動前 `setup.ts` 的兩行是
   * `if (red === 0) victory else if (blue === 0) defeat` —— `else if` 的意思
   * 就是同時全滅時算贏。這一條把那個順序釘住。
   */
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
   * 【接手延遲那 2 秒的邊角】`TAKEOVER_DELAY` 期間 `Battle.player` 仍指著
   * 已經退場的那一架，位置停在墜落點。少了 `playerAlive` 這一格，
   * 「玩家死在圓環裡、僚機還活著」會判成撤離成功（spec §7.1）。
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
   * 【為什麼要釘 NaN】`NaN < radius` 是 false，所以現況安全 —— 但這是**要被
   * 釘住的安全**。前例：`sweetYield` 的 `Number.isFinite` 守衛是 Codex 審查
   * 時抓出來的。
   */
  it('playerPos 含 NaN 時不得誤判 victory', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(NaN, NaN, NaN) }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  /**
   * 【為什麼要跑一千步】`Infinity - dt` 仍是 `Infinity`，所以無時限不必特例。
   * 但這件事要有測試釘住，否則哪天改成一個計時器物件就會靜靜壞掉。
   */
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
      outcome: s.outcome,
      metric: s.metric,
      secondsLeft: s.secondsLeft,
      hasTarget: s.hasTarget,
      targetRadius: s.targetRadius,
      target: s.target.clone(),
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
      const expected = pos.distanceTo(r.point)
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
