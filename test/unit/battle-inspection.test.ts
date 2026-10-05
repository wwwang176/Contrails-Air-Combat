import { describe, expect, it } from 'vitest'
import { createBattleInspection } from '../../src/app/battleInspection'
import { createBattle } from '../../src/battle/createBattle'
import { AiController } from '../../src/ai/AiController'
import { createHudFrame } from '../../src/hud/types'
import { createInputState } from '../../src/input/InputState'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import type { Screen } from '../../src/ui/screens'

function fixture() {
  const battle = createBattle({ update() {} })
  let state = { screen: 'battle' as Screen, battle, player: battle.player, world: battle.world }
  let reads = 0
  const hudFrame = createHudFrame()
  const input = createInputState()
  const inspection = createBattleInspection({
    readState: () => { reads++; return state },
    input, playerAi: new AiController(), hudFrame, aimAssist: { target: -1 },
    loop: { lastSubstepCount: 3 }, objectiveRing: { object: { parent: null } },
  })
  return { inspection, hudFrame, input, get state() { return state },
    get reads() { return reads }, setState(next: typeof state) { state = next } }
}

describe('battle inspection', () => {
  it('does not read simulation state until queried and returns no player probe outside battle', () => {
    const f = fixture()
    expect(f.reads).toBe(0)
    f.state.screen = 'landing'
    expect(f.inspection.__probe()).toBeNull()
    expect(f.reads).toBe(1)
    f.state.screen = 'battle'
    f.state.world.time = 1.2345
    f.state.player.aircraft.state.position.set(12.34, 567.89, -1.23)
    f.input.playerAi = true
    const point = f.inspection.__probe()!
    expect(point).toMatchObject({ t: 1.23, ai: true, x: 12.3, y: 567.9, z: -1.2, sub: 3, ring: false })
    expect(f.state.player.aircraft.state.position.x).toBe(12.34)
    expect(f.state.world.time).toBe(1.2345)
  })

  it('queries the new battle after replacement and preserves the browser result shapes', () => {
    const f = fixture()
    const battle = createBattle({ update() {} })
    battle.world.time = 90
    battle.player.aircraft.state.position.set(100, 200, 300)
    const ground = createGroundTarget(0, 'fuelDump', 'red', 10, 20, 0)
    battle.world.groundTargets.push(ground)
    battle.world.ships.push(createShip(0, SHIP_CLASSES.fletcher, 'red', 30, 40, Math.PI / 2, 0))
    f.setState({ screen: 'battle', battle, player: battle.player, world: battle.world })
    expect(f.inspection.__probe()).toMatchObject({ t: 90, x: 100, y: 200, z: 300 })
    expect(f.inspection.__seats()[battle.player.index]).toMatchObject({ x: 100, y: 200, z: 300 })
    expect(f.inspection.__ground()).toHaveLength(1)
    expect(f.inspection.__ground()[0]).toMatchObject({ id: 'fuelDump', team: 'red', alive: true })
    expect(f.inspection.__ships()).toEqual([{ cls: 'fletcher', alive: true, x: 30, z: 40, heading: 90 }])
  })

  it('selects the nearest usable lead marker and excludes hidden or friendly contacts', () => {
    const f = fixture()
    f.hudFrame.contactCount = 3
    for (let i = 0; i < 3; i++) Object.assign(f.hudFrame.contacts[i]!, {
      active: true, hostile: true, behind: false, leadValid: true, leadBehind: false,
      range: 300 - i * 100, x: 0.123456, y: 0.2, radius: 0.3, leadX: 0.4, leadY: 0.5,
    })
    f.hudFrame.contacts[2]!.hostile = false
    expect(f.inspection.__probe()!.lead).toEqual({ x: 0.1235, y: 0.2, r: 0.3, lx: 0.4, ly: 0.5, range: 200 })
    f.hudFrame.contacts[1]!.leadBehind = true
    expect(f.inspection.__probe()!.lead!.range).toBe(300)
    f.hudFrame.contacts[0]!.active = false
    expect(f.inspection.__probe()!.lead).toBeNull()
  })
})
