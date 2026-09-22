import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  FINISHED_TIME_SCALE, createMissionState, resetMissionState, stepMission, timeScale,
  type MissionInputs, type MissionRules,
} from '../../src/battle/mission'

const DT = 1 / 240

function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
  return {
    aliveBlue: 4,
    aliveBlueFighters: 4,
    aliveRed: 16,
    playerPos: new Vector3(0, 4000, 5000),
    playerAlive: true,
    shipsSunk: 0,
    shipsTotal: 0,
    targetsDestroyed: 0,
    targetsTotal: 0,
    vitalSunk: 0,
    vitalHp: 1,
    redInbound: false,
    convoyAlive: 0,
    convoyLead: Infinity,
    convoyArrived: 0,
    redKilled: 0,
    redKilledBombers: 0,
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
   * 【判定順序逐字等於 `setup.ts` 的那兩行】
   * `if (red === 0) victory else if (blue === 0) defeat` —— `else if` 的意思
   * 就是同時全滅時算贏。這一條把那個順序釘住。
   */
  it('雙方同時全滅時判 victory —— `else if` 的順序不能翻', () => {
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
   * 釘住的安全**。同一類的前例是 `sweetYield` 的 `Number.isFinite`
   * 守衛。
   */
  it('playerPos 含 NaN 時不得誤判 victory', () => {
    const r = evac()
    const s = createMissionState(r)
    stepMission(r, inputs({ playerPos: new Vector3(NaN, NaN, NaN) }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  /**
   * 【為什麼一定要守 `dt`】非有限或負的 `dt` 是呼叫端的 bug，但代價全部落在
   * `stepMission`：`NaN` 會**永久污染** `secondsLeft`（一旦是 NaN，`<= 0`
   * 恆為 false，任務再也不會超時），而 `formatCountdown` 對 NaN 回空字串
   * —— 玩家看到的只是「倒數消失了」。
   */
  it('dt 是 NaN／Infinity／負數時，倒數不動而不是被污染', () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, -0.5]) {
      const r = evac(100)
      const s = createMissionState(r)
      stepMission(r, inputs(), bad, s)
      expect(s.secondsLeft, `dt=${bad}`).toBe(100)
      expect(s.outcome, `dt=${bad}`).toBe('fighting')
    }
  })

  it('dt 為 0 時倒數不動，但勝負照判', () => {
    const r = evac(100)
    const s = createMissionState(r)
    stepMission(r, inputs({ aliveBlue: 0 }), 0, s)
    expect(s.secondsLeft).toBe(100)
    expect(s.outcome).toBe('defeat')
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
   * 「順手清一下」的。`hasTarget` 若在定案後被清掉，
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
 * 【oracle 必須獨立】同時讀同一次
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
   * 也會留一個指向不存在座標的圈。
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

/**
 * 【這一支只驗第一件事】「分出勝負會改 dt」。
 *
 * 第二件事 —— 「dt 會影響遊戲速度」—— 由 `FixedStepAccumulator` 負責，
 * 而它有自己的護欄（`test/unit/loop.test.ts`：「60fps 的一幀跑 4 個 240Hz
 * 子步」「單幀經過時間被 maxFrameSeconds 夾制」等九條）。兩件事各自成立，
 * 合起來就是慢動作 —— **不需要第三支去驗那個合成**。
 */
describe('timeScale：分出勝負之後切慢動作', () => {
  it('打鬥中是原速', () => {
    expect(timeScale('fighting')).toBe(1)
  })

  it('勝利與失敗都切到同一個流速', () => {
    expect(timeScale('victory')).toBe(FINISHED_TIME_SCALE)
    expect(timeScale('defeat')).toBe(FINISHED_TIME_SCALE)
  })

  it('流速在 0 與 1 之間 —— 是慢動作，不是暫停也不是快轉', () => {
    // 【為什麼要釘住這兩個邊界】0 會讓畫面定格（看起來像當掉，M10 spec
    // §8.1 的裁定就是為了避免那個觀感）；≥ 1 則是這條規則整個沒生效
    expect(FINISHED_TIME_SCALE).toBeGreaterThan(0)
    expect(FINISHED_TIME_SCALE).toBeLessThan(1)
  })
})

describe('stepMission：擊沉', () => {
  const rules: MissionRules = { kind: 'sink', count: 3 }

  it('沉夠數量就贏', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 2, shipsTotal: 8 }), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(rules, inputs({ shipsSunk: 3, shipsTotal: 8 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('沉超過也算贏', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 5, shipsTotal: 8 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('我方全滅就輸', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 1, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /**
   * 【有護衛編制時，護衛全滅就輸】日 M1 的目標是掩護雷擊隊。零戰全滅而
   * 陸攻還活著，若只看 `aliveBlue`，玩家會接手陸攻把仗打完。
   */
  it('有護衛編制：戰鬥機全滅、轟炸機還活著 —— 輸', () => {
    const escorted: MissionRules = { kind: 'sink', count: 3, escorts: true }
    const s = createMissionState(escorted)
    stepMission(escorted, inputs({ shipsSunk: 1, aliveBlue: 8, aliveBlueFighters: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('有護衛編制：還有一架戰鬥機就繼續打', () => {
    const escorted: MissionRules = { kind: 'sink', count: 3, escorts: true }
    const s = createMissionState(escorted)
    stepMission(escorted, inputs({ shipsSunk: 1, aliveBlue: 9, aliveBlueFighters: 1 }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('有護衛編制：最後一艘沉的那一步護衛剛好全滅 —— 算贏', () => {
    const escorted: MissionRules = { kind: 'sink', count: 3, escorts: true }
    const s = createMissionState(escorted)
    stepMission(escorted, inputs({ shipsSunk: 3, aliveBlue: 8, aliveBlueFighters: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /** 【沒有護衛編制的關不受影響】日 M2 倫內爾島藍隊全是陸攻，戰鬥機恆為 0 */
  it('沒有護衛編制：戰鬥機是 0 而轟炸機還活著 —— 繼續打', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 1, aliveBlue: 11, aliveBlueFighters: 0 }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  /** 【同一步同時滿足時算贏】與撤離那一條同一個裁決。 */
  it('最後一艘沉的那一步我方剛好全滅 —— 算贏', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 3, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /**
   * 【開局的計量不能是 0】那個數字的意思是「還差 0 艘」＝達標了。目標列
   * 會在第一個物理步之前閃一下勝利的數字。
   */
  it('開局的計量是「還差全部」，不是 0', () => {
    expect(createMissionState(rules).metric).toBe(3)
  })

  /**
   * 【分母從開局就要在】目標列靠它決定印進度還是印裸數字。第一個物理步
   * 之前是 −1 的話，畫面會先閃一下沒有分母的那個版本。
   */
  it('分母是總艘數，開局就有', () => {
    const s = createMissionState(rules)
    expect(s.metricTotal).toBe(3)
    stepMission(rules, inputs({ shipsSunk: 1 }), DT, s)
    expect(s.metricTotal).toBe(3)
  })

  /**
   * 【換關要把分母清掉】與 `hasTarget` 殘留同一條：擊沉打完換遭遇戰時，
   * 留著的 3 會讓殲滅的剩餘敵機數印成 `(-2/3)`。
   */
  it('重設成別種規則就沒有分母了', () => {
    const s = createMissionState(rules)
    resetMissionState({ kind: 'annihilate' }, s)
    expect(s.metricTotal).toBe(-1)
  })

  it('計量是「還差幾艘」，而且不會變成負的', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 1 }), DT, s)
    expect(s.metric).toBe(2)
    const s2 = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 9 }), DT, s2)
    expect(s2.metric).toBe(0)
  })

  /**
   * 【不顯示我方架數】−1 是目標列的「不畫」。全滅仍然判敗，那條判定不吃
   * 這個欄位 —— 所以「不顯示」與「不判定」是兩件事。
   */
  it('第二個計量恆是 −1，但全滅照樣判敗', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 0, aliveBlue: 5 }), DT, s)
    expect(s.remaining).toBe(-1)
    stepMission(rules, inputs({ shipsSunk: 0, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /** 【擊沉沒有圓環】殘留的 hasTarget 會讓上一關的圈留在畫面上。 */
  it('沒有終點圓環', () => {
    const s = createMissionState(rules)
    expect(s.hasTarget).toBe(false)
  })

  it('分出勝負之後不再改任何欄位', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 3 }), DT, s)
    expect(s.outcome).toBe('victory')
    stepMission(rules, inputs({ shipsSunk: 0, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
    expect(s.metric).toBe(0)
  })
})

describe('stepMission：炸毀', () => {
  const rules: MissionRules = { kind: 'destroy', count: 6 }

  it('炸毀 5 座是 fighting，6 座是 victory，超過也算', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 5, targetsTotal: 12 }), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(rules, inputs({ targetsDestroyed: 6, targetsTotal: 12 }), DT, s)
    expect(s.outcome).toBe('victory')
    const s2 = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 9, targetsTotal: 12 }), DT, s2)
    expect(s2.outcome).toBe('victory')
  })

  it('藍隊全滅就輸；玩家陣亡但僚機還在不算', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 2, aliveBlue: 3, playerAlive: false }), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(rules, inputs({ targetsDestroyed: 2, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('最後一座炸毀的那一步我方剛好全滅 —— 算贏', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 6, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('開局的計量是「還差全部」、分母是 6；重設之後也是', () => {
    const s = createMissionState(rules)
    expect(s.metric).toBe(6)
    expect(s.metricTotal).toBe(6)
    const s2 = createMissionState({ kind: 'annihilate' })
    resetMissionState(rules, s2)
    expect(s2.metric).toBe(6)
    expect(s2.metricTotal).toBe(6)
  })

  it('重設成別種規則就沒有分母了', () => {
    const s = createMissionState(rules)
    resetMissionState({ kind: 'annihilate' }, s)
    expect(s.metricTotal).toBe(-1)
  })

  it('計量是「還差幾座」、不會變成負的；第二個計量恆是 −1；沒有圓環', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 2 }), DT, s)
    expect(s.metric).toBe(4)
    expect(s.remaining).toBe(-1)
    expect(s.hasTarget).toBe(false)
    const s2 = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 9 }), DT, s2)
    expect(s2.metric).toBe(0)
  })

  it('船的計數不影響炸毀', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ shipsSunk: 8, shipsTotal: 8, targetsDestroyed: 0 }), DT, s)
    expect(s.outcome).toBe('fighting')
    expect(s.metric).toBe(6)
  })

  it('分出勝負之後不再改任何欄位', () => {
    const s = createMissionState(rules)
    stepMission(rules, inputs({ targetsDestroyed: 6 }), DT, s)
    expect(s.outcome).toBe('victory')
    stepMission(rules, inputs({ targetsDestroyed: 0, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
    expect(s.metric).toBe(0)
  })
})

const DEFEND: MissionRules = { kind: 'defend' }

/**
 * 守住艦隊。
 *
 * 【判定順序與其他規則相反 —— 要害艦排在勝利之前】其他規則沿用「victory
 * 先於 defeat」，理由是 `evacuate` 的「飛進圓環那一步剛好時限歸零，判贏才
 * 符合玩家的認知」。那是**同一個目標在邊界達成**；這裡不是：這一關的整句
 * 話就是「航母被擊沉就輸」，判成勝利的話結算畫面會在一艘沉到海底的航母上
 * 寫「任務成功」。
 */
describe('stepMission：守住艦隊', () => {
  it('雙方都活著時是 fighting，metric 是要害艦的血量比例、印成百分比', () => {
    // 【不印敵機數】零戰整隊重生，敵機數一直回到 16，讀不出仗打到哪裡；
    // 玩家要盯的是航母還剩幾成
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ vitalHp: 0.73 }), DT, s)
    expect(s.outcome).toBe('fighting')
    expect(s.metric).toBeCloseTo(0.73, 9)
    expect(s.metricKind).toBe('percent')
  })

  it('敵方全滅 = victory', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ aliveRed: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('我方全滅 = defeat', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /** 【這一條自己就判得出來】雙方飛機都還在，只有船沉了 */
  it('要害艦沉 = defeat，與雙方存活數無關', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ vitalSunk: 1 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /**
   * 【判定順序的守門員】要害艦沉的同一步敵方也全滅 —— **判輸**。
   * 把 `vitalSunk` 那一條移到勝利之後，這一條就紅。
   */
  it('要害艦沉的同一步敵方也全滅 —— 仍然判輸', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ vitalSunk: 1, aliveRed: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /**
   * 【預警期間不判勝】`stepBeats` 在觸發那一步先把節拍轉成 `warned`，飛機
   * 要等 `warnLead` 秒才生成。那幾秒之內紅方歸零就先判勝的話，第二波永遠
   * 不來 —— 這一關的下半場整段跳過，而畫面上一切正常。
   */
  it('敵機正在進場的路上時，紅方歸零仍然 fighting', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ aliveRed: 0, redInbound: true }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('進場的那一批到了之後照常判勝', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ aliveRed: 0, redInbound: true }), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(DEFEND, inputs({ aliveRed: 0, redInbound: false }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /** 【我方全滅照樣輸】即使敵機還在路上 */
  it('我方全滅時不受 redInbound 影響', () => {
    const s = createMissionState(DEFEND)
    stepMission(DEFEND, inputs({ aliveBlue: 0, redInbound: true }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  /**
   * 【沒有要害艦時勝負自然退化成殲滅】沒有另寫一條 fallback —— `vitalSunk`
   * 恆為 0 時那一條分支本來就不影響結果。比的是 `metric`／`metricKind` 以外
   * 的**整個 `MissionState`**：計量兩邊印的東西本來就不同（殲滅印敵機數、
   * 守住艦隊印要害艦血量），其餘每一格都要相同。
   */
  it('沒有要害艦、沒有增援在路上時，勝負與殲滅逐格相同', () => {
    for (const over of [
      {}, { aliveRed: 0 }, { aliveBlue: 0 }, { aliveRed: 0, aliveBlue: 0 },
      { aliveRed: 3, aliveBlue: 1 },
    ]) {
      const a = createMissionState(ANNIHILATE)
      const d = createMissionState(DEFEND)
      stepMission(ANNIHILATE, inputs(over), DT, a)
      stepMission(DEFEND, inputs(over), DT, d)
      const { metric: _am, metricKind: _ak, ...restA } = a
      const { metric: _dm, metricKind: _dk, ...restD } = d
      expect(restD, JSON.stringify(over)).toEqual(restA)
    }
  })
})

/**
 * 擊落。**德 M1 用它**：轟炸機流持續進場，累積擊落數，沒有判定圈。
 *
 * 【這裡守什麼】計數的來源對不對（角色過濾），以及它是**累計**而不是
 * 「開場架數減存活數」—— 後者在有重生的關會隨著重生退回去，而進度倒退
 * 不會有任何東西報錯。
 */
describe('stepMission：擊落', () => {
  const HUNT: MissionRules = { kind: 'hunt', count: 6 }
  const HUNT_BOMBERS: MissionRules = { kind: 'hunt', count: 6, role: 'bomber' }

  it('打夠數量就贏', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 5 }), DT, s)
    expect(s.outcome).toBe('fighting')
    stepMission(HUNT, inputs({ redKilled: 6 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('打超過也算贏', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 9 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('我方全滅就輸', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 2, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('最後一架打下來的那一步我方剛好全滅 —— 算贏', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 6, aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /**
   * 【少了角色過濾，這一關的內容就整個變了】德 M1 的目標是轟炸機，而場上
   * 同時有護航的戰鬥機 —— 不過濾的話打護航機也能過關，而畫面上一切正常。
   */
  it('限定轟炸機時，打下護航的戰鬥機不算數', () => {
    const s = createMissionState(HUNT_BOMBERS)
    stepMission(HUNT_BOMBERS, inputs({ redKilled: 9, redKilledBombers: 2 }), DT, s)
    expect(s.outcome).toBe('fighting')
    expect(s.metric).toBe(4)
  })

  it('限定轟炸機時，數的就是轟炸機那一格', () => {
    const s = createMissionState(HUNT_BOMBERS)
    stepMission(HUNT_BOMBERS, inputs({ redKilled: 20, redKilledBombers: 6 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('限定戰鬥機時是「總數減轟炸機」', () => {
    const r: MissionRules = { kind: 'hunt', count: 6, role: 'fighter' }
    const s = createMissionState(r)
    stepMission(r, inputs({ redKilled: 8, redKilledBombers: 3 }), DT, s)
    expect(s.metric).toBe(1)
    expect(s.outcome).toBe('fighting')
    stepMission(r, inputs({ redKilled: 9, redKilledBombers: 3 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('省略角色時全部都算', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 6, redKilledBombers: 0 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /**
   * 【這一條釘的就是「累計」】重生把存活數補回去，但打下來的已經打下來了。
   * 用「開場架數減存活數」實作的話這一條會紅。
   */
  it('敵方存活數不影響進度 —— 重生不讓進度倒退', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 6, aliveRed: 16 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  it('開局的計量是「還差全部」、分母是總數', () => {
    const s = createMissionState(HUNT)
    expect(s.metric).toBe(6)
    expect(s.metricTotal).toBe(6)
    expect(s.metricKind).toBe('count')
  })

  it('計量是「還差幾架」，而且不會變成負的', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 2 }), DT, s)
    expect(s.metric).toBe(4)
    const over = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 99 }), DT, over)
    expect(over.metric).toBe(0)
  })

  it('第二個計量恆是 −1，也沒有終點圓環', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 1 }), DT, s)
    expect(s.remaining).toBe(-1)
    expect(s.arrived).toBe(-1)
    expect(s.hasTarget).toBe(false)
    expect(s.targetRadius).toBe(0)
  })

  it('重設成別種規則就沒有分母了', () => {
    const s = createMissionState(HUNT)
    resetMissionState(ANNIHILATE, s)
    expect(s.metricTotal).toBe(-1)
  })

  it('分出勝負之後不再改任何欄位', () => {
    const s = createMissionState(HUNT)
    stepMission(HUNT, inputs({ redKilled: 6 }), DT, s)
    const frozen = { ...s }
    stepMission(HUNT, inputs({ redKilled: 0, aliveBlue: 0 }), DT, s)
    expect({ ...s }).toEqual(frozen)
  })
})
