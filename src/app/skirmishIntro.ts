import { Vector3 } from 'three'
import type { IntroShot, IntroSubject } from '../battle/missions/types'
import type { FlightIndex } from '../battle/flights'
import type { Combatant } from '../world/combatant'

/** 遭遇戰以實際編組排鏡；不改飛機位置，也不改 AI 的交戰規則。 */
export function skirmishIntro(
  combatants: readonly Combatant[], player: Combatant, flights: FlightIndex,
): readonly IntroShot[] {
  const enemies = flights.flights.filter(f => f.team !== player.team && f.count > 0)
  const flight = enemies[Math.floor(enemies.length / 2)]
  const enemy = flight === undefined ? undefined : combatants[flight.members[0]!]
  if (enemy === undefined || !enemy.alive || !player.alive) return []

  function shot(plane: Combatant, subject: IntroSubject): IntroShot {
    const size = plane.aircraft.spec.wing.span
    const group = flights.flights[flights.flightOf[plane.index]!]
    const center = new Vector3()
    if (group !== undefined) {
      for (let i = 0; i < group.count; i++) {
        const mate = combatants[group.members[i]!]
        if (mate !== undefined && mate !== plane) {
          center.add(mate.aircraft.state.position.clone().sub(plane.aircraft.state.position))
        }
      }
    }
    center.applyQuaternion(plane.aircraft.state.orientation.clone().invert())
    // 從編隊另一側看向長機，僚機便落在後景；單機沿用右前方特寫。
    const side = center.x > 0 ? -1 : 1
    return {
      kind: 'follow', seconds: 3, subject,
      back: -size * 1.5, backTo: -size * 1.2,
      side: side * size * 2.5, up: size * 0.65,
      lead: 0, lookUp: size * 0.12, fov: 42,
    }
  }

  return [shot(enemy, { aircraft: enemy.index }), shot(player, { player: true })]
}
