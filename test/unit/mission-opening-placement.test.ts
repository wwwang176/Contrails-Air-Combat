import { describe, expect, it } from 'vitest'
import { missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, resetBattle } from '../../src/battle/setup'
import { G4M } from '../../src/specs/g4m'
import { cardWith, readyCard, KILL_CARD } from '../fixtures/mission'

const create = (c: ReadyMissionCard) => createBattle({ update() {} }, missionConfigFrom(c), 1)

describe('任務開場擺位', () => {
  it('playerFlightOffset 只平移玩家小隊，其餘飛機維持原位；重開使用相同擺位', () => {
    const offset = { x: 40, y: -200, z: 300 }
    const before = create(readyCard(KILL_CARD))
    const after = create(cardWith(KILL_CARD, { playerFlightOffset: offset }))
    const playerFlight = after.flights.flights[after.flights.flightOf[after.player.index]!]!
    expect(playerFlight.roster.length).toBeLessThan(after.world.combatants.length)
    for (const plane of after.world.combatants) {
      const delta = plane.aircraft.state.position.clone().sub(before.world.combatants[plane.index]!.aircraft.state.position)
      const want = playerFlight.roster.includes(plane.index) ? offset : { x: 0, y: 0, z: 0 }
      expect(delta.x, `#${plane.index}`).toBeCloseTo(want.x, 6)
      expect(delta.y, `#${plane.index}`).toBeCloseTo(want.y, 6)
      expect(delta.z, `#${plane.index}`).toBeCloseTo(want.z, 6)
    }
    const start = after.player.aircraft.state.position.clone()
    after.player.aircraft.state.position.set(0, 100, 0)
    resetBattle(after)
    expect(after.player.aircraft.state.position).toEqual(start)
  })

  /**
   * 【用攻擊隊】護送的轟炸機有判定圈，圈的高度是任務高度；壓低出生高度的話
   * `createBattle` 擋下「永遠判不到」的編隊
   */
  it('convoySpawnAltitude：攻擊隊出生在那個高度、水平位置不變，其餘飛機不動', () => {
    const altitude = 321
    const strike = { convoySpec: G4M, convoyCount: 2, convoyDuty: 'strike', sinkCount: 1 } as const
    const before = create(cardWith(KILL_CARD, strike))
    const card = cardWith(KILL_CARD, { ...strike, convoySpawnAltitude: altitude })
    const after = create(card)
    const isBomber = (id: string) => id === card.battle.convoySpec!.id
    const bombers = after.world.combatants.filter(p => isBomber(p.aircraft.spec.id))
    expect(bombers.length).toBe(card.battle.convoyCount)
    for (const plane of after.world.combatants) {
      const pos = plane.aircraft.state.position
      const old = before.world.combatants[plane.index]!.aircraft.state.position
      if (isBomber(plane.aircraft.spec.id)) {
        expect(pos.y).toBeCloseTo(altitude, 6)
        expect([pos.x, pos.z]).toEqual([old.x, old.z])
      } else expect(pos).toEqual(old)
    }
    resetBattle(after)
    for (const p of bombers) expect(p.aircraft.state.position.y).toBeCloseTo(altitude, 6)
  })
})
