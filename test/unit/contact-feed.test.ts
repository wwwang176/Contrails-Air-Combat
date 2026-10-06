import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createContactFeed } from '../../src/hud/contactFeed'
import { createHudFrame, HUD_MAX_CONTACTS } from '../../src/hud/types'
import { createFlights, compactFlights } from '../../src/battle/flights'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { Combatant } from '../../src/world/combatant'
import { P51D } from '../../src/specs/p51d'

function fixture(count = 4) {
  const world = new World()
  const visuals = new Map<Combatant, { position: Vector3 }>()
  for (let i = 0; i < count; i++) {
    const c = world.add(new Aircraft(P51D), { update() {} }, i < 2 ? 'blue' : 'red', new Vector3())
    c.aircraft.state.position.set(i * 10, 0, -100)
    c.aircraft.state.velocity.set(0, 0, -100)
    visuals.set(c, { position: new Vector3(i * 10, 10, -200) })
  }
  const player = world.combatants[0]!
  const hudFrame = createHudFrame()
  const camera = new PerspectiveCamera(90, 2, 1, 100000)
  camera.updateMatrixWorld()
  const flights = createFlights(world.combatants, player.index)
  const feed = createContactFeed({ hudFrame, camera, visuals, projectDistance: 1000 })
  const renderPos = visuals.get(player)!.position
  const godPosition = new Vector3(100, 300, 400)
  const fill = (godView = false, activePlayer = player) => feed(
    world.combatants, activePlayer, flights, visuals.get(activePlayer)!.position, godView, godPosition,
  )
  return { world, visuals, player, hudFrame, camera, flights, renderPos, godPosition, fill }
}

describe('HUD 接觸目標的資料', () => {
  it('投影的是渲染位置，編隊歸屬用當下的', () => {
    const f = fixture()
    expect(f.fill()).toBe(f.renderPos)
    expect(f.hudFrame.contactCount).toBe(3)
    const ally = f.hudFrame.contacts[0]!, enemy = f.hudFrame.contacts[1]!
    expect(ally.x).toBeCloseTo(0.05)
    expect(ally.y).toBeCloseTo(0.05)
    expect(ally.range).toBe(10)
    expect(ally.flightMate).toBe(true)
    expect(ally.hostile).toBe(false)
    expect(ally.leadValid).toBe(false)
    expect(enemy.flightLeader).toBe(true)
    expect(enemy.flightAlive).toBe(2)
    expect(enemy.flightSize).toBe(2)
    expect(enemy.hostile).toBe(true)
    expect(enemy.leadValid).toBe(true)
    f.world.combatants[2]!.alive = false
    compactFlights(f.flights, f.world.combatants)
    f.fill()
    expect(f.hudFrame.contactCount).toBe(2)
    expect(f.hudFrame.contacts[1]!.flightLeader).toBe(true)
    expect(f.hudFrame.contacts[1]!.flightAlive).toBe(1)
  })

  it('上帝視角把玩家也列進來，距離與高度差從鏡頭位置算', () => {
    const f = fixture()
    expect(f.fill(true)).toBe(f.godPosition)
    expect(f.hudFrame.contactCount).toBe(4)
    const self = f.hudFrame.contacts[0]!
    expect(self.range).toBe(f.renderPos.distanceTo(f.godPosition))
    expect(self.deltaY).toBe(f.renderPos.y - f.godPosition.y)
    expect(self.flightLeader).toBe(true)
    f.godPosition.copy(f.renderPos)
    f.fill(true)
    expect(self.range).toBe(0)
    expect(Number.isFinite(self.radius)).toBe(true)
  })

  it('重用同一個池；沒有槍的機體與換了玩家時清掉提前量', () => {
    const f = fixture()
    const pool = f.hudFrame.contacts, first = pool[0]!
    f.fill()
    expect(pool[1]!.leadValid).toBe(true)
    f.world.setSpec(f.player, { ...P51D, battery: { ...P51D.battery, mounts: [] } })
    f.fill()
    expect(pool[1]!.leadValid).toBe(false)
    const newPlayer = f.world.combatants[2]!
    f.fill(false, newPlayer)
    expect(f.hudFrame.contacts).toBe(pool)
    expect(pool[0]).toBe(first)
    expect(pool[0]!.hostile).toBe(true)
    expect(pool[2]!.hostile).toBe(false)
    expect(pool[2]!.leadValid).toBe(false)
  })

  it('池有上限；世界清空時靠計數歸零移除全部接觸目標', () => {
    const f = fixture(HUD_MAX_CONTACTS + 5)
    f.fill(true)
    expect(f.hudFrame.contactCount).toBe(HUD_MAX_CONTACTS)
    expect(f.hudFrame.contacts.length).toBe(HUD_MAX_CONTACTS)
    for (const c of f.world.combatants) c.alive = false
    compactFlights(f.flights, f.world.combatants)
    f.fill(true)
    expect(f.hudFrame.contactCount).toBe(0)
  })
})
