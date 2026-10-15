import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, resetBattle } from '../../src/battle/setup'

const card = (id: string) => Object.values(MISSIONS).flat().find(c => c.id === id) as ReadyMissionCard
const create = (c: ReadyMissionCard) => createBattle({ update() {} }, missionConfigFrom(c), 1)

describe('任務開場擺位', () => {
  it('美 M1 只平移玩家小隊，轟炸機與敵機維持原位；重開使用相同擺位', () => {
    const c = card('allies-m1')
    const { playerFlightOffset: offset, ...battle } = c.battle
    const before = create({ ...c, battle })
    const after = create(c)
    const playerFlight = after.flights.flights[after.flights.flightOf[after.player.index]!]!
    for (const plane of after.world.combatants) {
      const delta = plane.aircraft.state.position.clone().sub(before.world.combatants[plane.index]!.aircraft.state.position)
      expect(delta.toArray()).toEqual(playerFlight.roster.includes(plane.index)
        ? [offset!.x, offset!.y, offset!.z] : [0, 0, 0])
    }
    const start = after.player.aircraft.state.position.clone()
    after.player.aircraft.state.position.set(0, 100, 0)
    resetBattle(after)
    expect(after.player.aircraft.state.position).toEqual(start)
  })

  it('日 M1 八架 G4M 均由 201 m 出生，零戰與敵機位置不變', () => {
    const c = card('japan-m1')
    const { convoySpawnAltitude: _, ...battle } = c.battle
    const before = create({ ...c, battle })
    const after = create(c)
    const bombers = after.world.combatants.filter(p => p.aircraft.spec.id === 'g4m')
    expect(bombers).toHaveLength(8)
    for (const plane of after.world.combatants) {
      const pos = plane.aircraft.state.position
      const old = before.world.combatants[plane.index]!.aircraft.state.position
      if (plane.aircraft.spec.id === 'g4m') {
        expect(pos.y).toBe(201)
        expect([pos.x, pos.z]).toEqual([old.x, old.z])
      } else expect(pos).toEqual(old)
    }
    resetBattle(after)
    expect(bombers.every(p => p.aircraft.state.position.y === 201)).toBe(true)
  })
})
