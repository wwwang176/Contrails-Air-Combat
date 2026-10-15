import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { skirmishIntro } from '../../src/app/skirmishIntro'
import { introCameraPose } from '../../src/app/missionIntro'
import { createBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'

describe('遭遇戰導覽', () => {
  for (const [blue, red, count] of [['p51d', 'bf109k4', 20], ['b17g', 'he111', 4], ['a6m5', 'fw190', 1]] as const) {
    it(`${blue} 對 ${red}、每方 ${count} 架：先敵方長機，再玩家，且鏡位在地面上`, () => {
      const b = createBattle({ update() {} }, battleConfigFrom(uniform(blue, count, red, count)), 1)
      const shots = skirmishIntro(b.world.combatants, b.player, b.flights)
      expect(shots).toHaveLength(2)
      const enemyFlights = b.flights.flights.filter(f => f.team === 'red')
      const leader = enemyFlights[Math.floor(enemyFlights.length / 2)]!.members[0]!
      expect(shots[0]).toMatchObject({ subject: { aircraft: leader } })
      expect(shots[1]).toMatchObject({ subject: { player: true } })
      for (const shot of shots) {
        const pos = new Vector3(), look = new Vector3()
        expect(introCameraPose(shot, 1, {
          combatants: b.world.combatants, player: b.player, ships: [], groundTargets: [], groundAt: () => 4500,
        }, pos, look)).toBe(true)
        expect(pos.y).toBeGreaterThan(4500)
        expect(pos.toArray().every(Number.isFinite)).toBe(true)
      }
      b.world.combatants[leader]!.alive = false
      expect(introCameraPose(shots[0]!, 1, {
        combatants: b.world.combatants, player: b.player, ships: [], groundTargets: [],
      }, new Vector3(), new Vector3())).toBe(false)
    })
  }
})
