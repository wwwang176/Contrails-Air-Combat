import { describe, it, expect } from 'vitest'
import {
  battleConfigFrom, specsFor, DEFAULT_SKIRMISH, MAX_COMBATANTS, MAX_SIDE, MIN_SIDE,
  type SkirmishSetup,
} from '../../src/battle/skirmish'
import type { BattleConfig } from '../../src/battle/setup'
import { sideCount } from '../../src/battle/order'

function setup(over: Partial<SkirmishSetup> = {}): SkirmishSetup {
  return { ...DEFAULT_SKIRMISH, ...over }
}

describe('specsFor', () => {
  it('每個陣營至少一台', () => {
    expect(specsFor('allies').length).toBeGreaterThanOrEqual(1)
    expect(specsFor('axis').length).toBeGreaterThanOrEqual(1)
  })

  it('兩個陣營的機種沒有交集', () => {
    const allies = specsFor('allies').map((s) => s.id)
    for (const s of specsFor('axis')) expect(allies).not.toContain(s.id)
  })
})

/**
 * 編組表版本的兩支讀取器。**斷言的意思一個字沒變** —— 改動前讀
 * `cfg.blueSpec` / `cfg.blueCount`，現在從編組表算出同一件事。
 */
const specOf = (c: BattleConfig, team: 'blue' | 'red') =>
  c.units.find((u) => u.team === team)!.members[0]!

describe('battleConfigFrom（M10 spec §7）', () => {
  it('選同盟國：藍隊 P-51D、紅隊 Bf109', () => {
    const c = battleConfigFrom(setup({ faction: 'allies' }))
    expect(specOf(c, 'blue').id).toBe('p51d')
    expect(specOf(c, 'red').id).toBe('bf109g6')
  })

  it('選軸心國：藍隊 Bf109、紅隊 P-51D —— 換的是機種不是顏色', () => {
    const c = battleConfigFrom(setup({ faction: 'axis' }))
    expect(specOf(c, 'blue').id).toBe('bf109g6')
    expect(specOf(c, 'red').id).toBe('p51d')
  })

  it('架數照抄', () => {
    const c = battleConfigFrom(setup({ blueCount: 3, redCount: 7 }))
    expect(sideCount(c.units, 'blue')).toBe(3)
    expect(sideCount(c.units, 'red')).toBe(7)
  })

  it('架數被夾在 1~20', () => {
    // 【為什麼要夾】數字從 DOM 讀進來。被改成 0 會讓 createBattle 拋例外
    // （玩家沒有被建立），改成 999 會炸掉特效池的容量假設。
    for (const [given, want] of [[0, 1], [-5, 1], [21, 20], [999, 20]] as const) {
      const c = battleConfigFrom(setup({ blueCount: given, redCount: given }))
      expect(sideCount(c.units, 'blue')).toBe(want)
      expect(sideCount(c.units, 'red')).toBe(want)
    }
  })

  it('NaN 落回預設而不是傳下去', () => {
    const c = battleConfigFrom(setup({ blueCount: NaN }))
    expect(Number.isFinite(sideCount(c.units, 'blue'))).toBe(true)
    expect(sideCount(c.units, 'blue')).toBeGreaterThanOrEqual(MIN_SIDE)
  })

  it('未知的機種代號落回該陣營的第一台', () => {
    const c = battleConfigFrom(setup({ faction: 'allies', specId: '不存在' }))
    expect(specOf(c, 'blue').id).toBe(specsFor('allies')[0]!.id)
  })

  it('其餘欄位沿用 DEFAULT_BATTLE 的幾何', () => {
    const c = battleConfigFrom(setup())
    expect(c.entryRange).toBeGreaterThan(0)
    expect(c.altitude).toBeGreaterThan(0)
    expect(c.tas).toBeGreaterThan(0)
  })
})

describe('常數', () => {
  it('上下限是 1 與 20，容量是兩倍', () => {
    expect(MIN_SIDE).toBe(1)
    expect(MAX_SIDE).toBe(20)
    expect(MAX_COMBATANTS).toBe(MAX_SIDE * 2)
  })

  it('預設是 20 對 20 的同盟國', () => {
    expect(DEFAULT_SKIRMISH.blueCount).toBe(20)
    expect(DEFAULT_SKIRMISH.redCount).toBe(20)
    expect(DEFAULT_SKIRMISH.faction).toBe('allies')
  })
})
