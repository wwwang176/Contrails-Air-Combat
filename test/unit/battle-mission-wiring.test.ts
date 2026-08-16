/**
 * **遭遇戰就是「一個沒有時限的殲滅任務」。**
 *
 * 【為什麼要這樣接】判定路徑因此**每一場都在走**，不是一條等著被第一次使用的
 * 死碼 —— 與地形「種類沒變也重建」是同一條紀律（M10 spec §5.3）。
 *
 * 【代價由誰守】`annihilate` 的行為必須等於改動前 `setup.ts` 的那兩行，否則
 * 現有護欄會集體移動。這一支釘住接線，逐字的判定順序由
 * `test/unit/mission.test.ts` 釘住，全套的數字由回歸比較守。
 */
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
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 },
    )
    expect(b.mission.outcome).toBe('fighting')
    expect(b.outcome).toBe('fighting')
    expect(b.mission.hasTarget).toBe(false)
    expect(b.mission.secondsLeft).toBe(Infinity)
  })

  it('紅隊全滅時 outcome 與 mission.outcome 同步翻成 victory', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 },
    )
    for (const c of b.red) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('victory')
    expect(b.outcome).toBe('victory')
  })

  it('藍隊全滅時同步翻成 defeat', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 },
    )
    for (const c of b.blue) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('defeat')
    expect(b.outcome).toBe('defeat')
  })

  it('metric 是剩餘敵機數', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 3 },
    )
    stepBattle(b, DT)
    expect(b.mission.metric).toBe(3)
    b.world.destroy(b.red[0]!)
    stepBattle(b, DT)
    expect(b.mission.metric).toBe(2)
  })

  it('resetBattle 之後任務狀態回到開局', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2 },
    )
    for (const c of b.red) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    resetBattle(b)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.outcome).toBe('fighting')
  })
})

describe('撤離規則接得上 Battle', () => {
  const rules = {
    kind: 'evacuate' as const,
    point: new Vector3(0, 4000, -20000),
    radius: 1000,
    seconds: 240,
  }

  it('把玩家放到撤離點上，下一步就 victory', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2, rules },
    )
    expect(b.mission.hasTarget).toBe(true)
    expect(b.mission.target.equals(rules.point)).toBe(true)
    b.player.aircraft.state.position.set(0, 4000, -19800)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })

  /**
   * 【為什麼要有這一條】倒數若沒有接上 `dt`，撤離任務永遠不會超時 ——
   * 而那件事在一場正常的仗裡看不出來（會先分出別的勝負）。
   */
  it('倒數每一步都在走', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2, rules },
    )
    stepBattle(b, DT)
    const after1 = b.mission.secondsLeft
    expect(after1).toBeCloseTo(240 - DT, 9)
    for (let i = 0; i < 239; i++) stepBattle(b, DT)
    expect(b.mission.secondsLeft).toBeCloseTo(239, 6)
  })

  it('撤離場重設之後倒數回到滿的', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, blueCount: 2, redCount: 2, rules },
    )
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(b.mission.secondsLeft).toBeLessThan(240)
    resetBattle(b)
    expect(b.mission.secondsLeft).toBe(240)
    expect(b.mission.hasTarget).toBe(true)
  })
})
