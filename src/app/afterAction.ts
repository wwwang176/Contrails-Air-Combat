import type { MessageKey } from '../i18n'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/team'
import type { AfterAction } from '../ui/scoreboard'
import { shortName } from '../ui/briefing'

/** The report reads presentation data, without requiring a running battle world. */
export interface AfterActionBattle {
  readonly cfg: { readonly units: readonly { readonly team: Team; readonly player?: boolean }[] }
  readonly player: { readonly hp: number; readonly aircraft: { readonly spec: AircraftSpec } }
  readonly convoy: { readonly seats: readonly number[] } | null
  readonly objectiveKey: MessageKey | null
}

export interface AfterActionMission {
  readonly titleKey: MessageKey
  readonly battle: { readonly objectiveKey?: MessageKey }
}

/** Builds the final report once; the caller supplies the frozen battle duration. */
export function buildAfterAction(
  battle: AfterActionBattle,
  seats: readonly { readonly hp: number }[],
  mode: AfterAction['mode'],
  mission: AfterActionMission | null,
  seconds: number,
): AfterAction {
  // Count only blue flights. Red units may be interleaved in mission configs.
  let blueFlight = 0
  let playerFlight = 1
  for (const unit of battle.cfg.units) {
    if (unit.team !== 'blue') continue
    blueFlight++
    if (unit.player === true) {
      playerFlight = blueFlight
      break
    }
  }
  const convoy = battle.convoy
  let convoyAlive = 0
  if (convoy !== null) {
    for (const seat of convoy.seats) if (seats[seat]!.hp > 0) convoyAlive++
  }
  const me = battle.player
  return {
    mode,
    titleKey: mode === 'mission' && mission !== null ? mission.titleKey : 'result.skirmish',
    objectiveKey: battle.objectiveKey ?? mission?.battle.objectiveKey ?? 'mission.killAll.objective',
    seconds,
    playerSpec: shortName(me.aircraft.spec),
    playerFlight,
    playerHp01: Math.max(0, Math.min(1, me.hp / me.aircraft.spec.hp)),
    convoy: convoy === null ? null : { alive: convoyAlive, total: convoy.seats.length },
  }
}
