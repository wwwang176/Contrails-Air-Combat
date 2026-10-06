import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import { wireBattleAi } from '../../src/app/wireBattleAi'
import type { Controller } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'
import { World } from '../../src/world/World'
import { createBombBay } from '../../src/weapons/bomb'
import type { Loadout } from '../../src/weapons/stores'

function setup() {
  const world = new World()
  const blue = new AiController(), red = new AiController(), playerAi = new AiController()
  const manual = { update() {} }
  const add = (controller: Controller, team: 'blue' | 'red') =>
    world.add(new Aircraft(P51D), controller, team, new Vector3(0, 1000, 0))
  const player = add(manual, 'blue'), wingman = add(blue, 'blue')
  add(red, 'red')
  const terrain = { islands: [] }
  const wire = (force = false) => wireBattleAi(world,
    { priorityGroundUnit: 'usTruck', airOnly: true }, player, playerAi, terrain, force)
  return { world, blue, red, playerAi, manual, player, wingman, terrain, wire }
}

describe('戰場 AI 接線', () => {
  it('任務限制只套友軍，玩家手動控制器不變，離席代飛仍取得玩家掛載', () => {
    const s = setup()
    s.wire()
    expect(s.player.controller).toBe(s.manual)
    expect(s.blue.priorityGroundUnit).toBe('usTruck')
    expect(s.blue.airOnly).toBe(true)
    expect(s.red.priorityGroundUnit).toBeNull()
    expect(s.red.airOnly).toBe(false)
    for (const ai of [s.blue, s.red, s.playerAi]) {
      expect(ai.ships).toBe(s.world.ships)
      expect(ai.groundTargets).toBe(s.world.groundTargets)
      expect(ai.terrain).toBe(s.terrain)
      expect(ai.bombDrag).toBe(s.world.bombDrag)
    }
    expect(s.playerAi.bombBay).toBe(s.player.bombBay)
  })

  it('相同地形保持鎖存，但換裝、重生的新控制器與任務限制立即同步', () => {
    const s = setup()
    const reset = vi.spyOn(s.blue, 'clearTerrainState')
    s.wire()
    s.wire()
    expect(reset).toHaveBeenCalledTimes(1)
    const loadout: Loadout = { kind: 'torpedo', count: 1, damage: 15000, reloadSeconds: 35 }
    s.wingman.loadout = loadout
    s.wingman.bombBay = createBombBay(loadout)
    wireBattleAi(s.world, {}, s.player, s.playerAi, s.terrain)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(s.blue.bombBay).toBe(s.wingman.bombBay)
    expect(s.blue.strikeProfile).toBe(TORPEDO_PROFILE)
    expect(s.blue.priorityGroundUnit).toBeNull()
    expect(s.blue.airOnly).toBe(false)
    const replacement = new AiController()
    s.wingman.controller = replacement
    s.wire()
    expect(replacement.terrain).toBe(s.terrain)
    expect(replacement.bombBay).toBe(s.wingman.bombBay)
    expect(replacement.strikeProfile).toBe(TORPEDO_PROFILE)
  })

  it('強制重開與更換地形清除鎖存，接手僚機後代飛跟隨新彈艙', () => {
    const s = setup()
    const reset = vi.spyOn(s.playerAi, 'clearTerrainState')
    s.wire()
    s.wire(true)
    expect(reset).toHaveBeenCalledTimes(2)
    const terrain = { islands: [] }
    wireBattleAi(s.world, {}, s.wingman, s.playerAi, terrain)
    expect(reset).toHaveBeenCalledTimes(3)
    expect(s.playerAi.terrain).toBe(terrain)
    expect(s.playerAi.bombBay).toBe(s.wingman.bombBay)
    expect(s.playerAi.strikeProfile).toBe(BOMB_PROFILE)
  })
})
