import { describe, expect, it } from 'vitest'
import { buildAfterAction, type AfterActionBattle, type AfterActionMission } from '../../src/app/afterAction'
import { P51D } from '../../src/specs/p51d'

function battle(units: AfterActionBattle['cfg']['units'] = []): AfterActionBattle {
  return {
    cfg: { units }, player: { hp: P51D.hp, aircraft: { spec: P51D } },
    convoy: null, objectiveKey: null,
  }
}
const mission: AfterActionMission = {
  titleKey: 'mission.japan-m1.title', battle: { objectiveKey: 'mission.japan-m1.objective' },
}

describe('結算戰報', () => {
  it('遭遇戰給預設標題與目標，時長用傳進來的凍結值', () => {
    const report = buildAfterAction(battle(), [], 'skirmish', null, 123.5)
    expect(report).toEqual({
      mode: 'skirmish', titleKey: 'result.skirmish', objectiveKey: 'mission.killAll.objective',
      seconds: 123.5, playerSpec: 'P-51D', playerFlight: 1, playerHp01: 1, convoy: null,
    })
  })

  it('用任務標題；戰鬥中更新過的目標優先於任務卡上的', () => {
    const report = buildAfterAction(battle(), [], 'mission', mission, 10)
    expect(report.titleKey).toBe(mission.titleKey)
    expect(report.objectiveKey).toBe(mission.battle.objectiveKey)
    const changed = { ...battle(), objectiveKey: 'mission.japan-m2.objective' as const }
    expect(buildAfterAction(changed, [], 'mission', mission, 10).objectiveKey)
      .toBe('mission.japan-m2.objective')
    expect(buildAfterAction(battle(), [], 'mission', null, 10).titleKey).toBe('result.skirmish')
  })

  it('只數藍隊編隊，取第一個藍隊的玩家單位', () => {
    const b = battle([
      { team: 'red', player: true }, { team: 'blue' }, { team: 'red' },
      { team: 'blue', player: true }, { team: 'blue', player: true },
    ])
    expect(buildAfterAction(b, [], 'skirmish', null, 0).playerFlight).toBe(2)
    expect(buildAfterAction(battle([{ team: 'blue' }, { team: 'blue' }]), [], 'skirmish', null, 0)
      .playerFlight).toBe(1)
  })

  it.each([[-10, 0], [0, 0], [P51D.hp / 2, 0.5], [P51D.hp, 1], [P51D.hp * 2, 1]])(
    '血量 %s 報成 %s', (hp, expected) => {
    const b = { ...battle(), player: { hp, aircraft: { spec: P51D } } }
    expect(buildAfterAction(b, [], 'skirmish', null, 0).playerHp01)
      .toBe(expected)
  })

  it('船團座位上 HP 為正的才算活著，戰報是脫鉤的快照', () => {
    const seats = [{ hp: 100 }, { hp: 0 }, { hp: 0.1 }, { hp: -5 }]
    const b = { ...battle(), convoy: { seats: [1, 2, 3] } }
    const report = buildAfterAction(b, seats, 'mission', mission, 10)
    expect(report.convoy).toEqual({ alive: 1, total: 3 })
    seats[2]!.hp = 0
    b.convoy.seats.push(0)
    expect(report.convoy).toEqual({ alive: 1, total: 3 })
    expect(buildAfterAction({ ...battle(), convoy: { seats: [] } }, [], 'mission', mission, 0).convoy)
      .toEqual({ alive: 0, total: 0 })
  })
})
