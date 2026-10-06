import type { Vector3 } from 'three'
import type { HudFrame } from '../hud/types'
import type { World } from '../world/World'
import type { Combatant } from '../world/combatant'
import {
  fillMarkers,
  type MarkerObjectives,
  type MarkerPool,
  type MarkerProject,
  type ShipMarkerTop,
} from '../hud/markerFeed'
import { teamSlot } from '../world/team'
import { nextHitFlash } from '../hud/types'
import { stepDamageMarks } from '../hud/damageMarks'

export interface BattleHudMarkersDependencies {
  readonly markerPools: MarkerPool[]
  readonly markerObjectives: MarkerObjectives & { ref: Vector3 }
  readonly projectMarker: MarkerProject
  readonly shipMarkerTop: ShipMarkerTop
}

/** 只需要呈現用的資料，模擬方法留在 `World` */
export type BattleHudMarkerWorld = Pick<World, 'ships' | 'groundTargets'> & {
  readonly bombs: MarkerPool
  readonly torpedoes: MarkerPool
}

/** 更新接觸目標以外的標記（彈藥、船、地面目標），並依幀時間推進命中回饋 */
export function updateBattleHudMarkers(
  deps: BattleHudMarkersDependencies,
  hudFrame: HudFrame,
  world: BattleHudMarkerWorld,
  player: Pick<Combatant, 'team'>,
  referencePosition: Vector3,
  hitsThisFrame: number,
  frameSeconds: number,
): void {
  const { markerPools, markerObjectives, projectMarker, shipMarkerTop } = deps
  markerPools[0] = world.bombs
  markerPools[1] = world.torpedoes
  markerObjectives.ref.copy(referencePosition)
  fillMarkers(
    hudFrame, world.ships, world.groundTargets, markerPools,
    teamSlot(player.team), projectMarker, shipMarkerTop, markerObjectives,
  )
  hudFrame.hitFlash = nextHitFlash(hudFrame.hitFlash, hitsThisFrame, frameSeconds)
  stepDamageMarks(hudFrame.damageMarks, frameSeconds)
}
