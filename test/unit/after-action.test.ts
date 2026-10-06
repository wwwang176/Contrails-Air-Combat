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

describe('after-action report', () => {
  it('reports skirmish defaults and the supplied frozen duration', () => {
    const report = buildAfterAction(battle(), [], 'skirmish', null, 123.5)
    expect(report).toEqual({
      mode: 'skirmish', titleKey: 'result.skirmish', objectiveKey: 'mission.killAll.objective',
      seconds: 123.5, playerSpec: 'P-51D', playerFlight: 1, playerHp01: 1, convoy: null,
    })
  })

  it('uses the mission title and gives an updated battle objective priority over the card', () => {
    const report = buildAfterAction(battle(), [], 'mission', mission, 10)
    expect(report.titleKey).toBe(mission.titleKey)
    expect(report.objectiveKey).toBe(mission.battle.objectiveKey)
    const changed = { ...battle(), objectiveKey: 'mission.japan-m2.objective' as const }
    expect(buildAfterAction(changed, [], 'mission', mission, 10).objectiveKey)
      .toBe('mission.japan-m2.objective')
    expect(buildAfterAction(battle(), [], 'mission', null, 10).titleKey).toBe('result.skirmish')
  })

  it('counts only blue flights and chooses the first blue player entry', () => {
    const b = battle([
      { team: 'red', player: true }, { team: 'blue' }, { team: 'red' },
      { team: 'blue', player: true }, { team: 'blue', player: true },
    ])
    expect(buildAfterAction(b, [], 'skirmish', null, 0).playerFlight).toBe(2)
    expect(buildAfterAction(battle([{ team: 'blue' }, { team: 'blue' }]), [], 'skirmish', null, 0)
      .playerFlight).toBe(1)
  })

  it.each([[-10, 0], [0, 0], [P51D.hp / 2, 0.5], [P51D.hp, 1], [P51D.hp * 2, 1]])(
    'reports health %s as %s', (hp, expected) => {
    const b = { ...battle(), player: { hp, aircraft: { spec: P51D } } }
    expect(buildAfterAction(b, [], 'skirmish', null, 0).playerHp01)
      .toBe(expected)
  })

  it('counts positive HP at convoy seat indices and keeps a detached report snapshot', () => {
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
