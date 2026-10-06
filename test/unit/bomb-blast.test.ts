import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { World } from '../../src/world/World'
import { applyBombBlast } from '../../src/world/bombBlast'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import { KILL_STRIDE } from '../../src/world/kills'

it('爆風會炸到投放者和友機，但只有敵機記入投放者的戰果', () => {
  const world = new World()
  const position = new Vector3(10, 100, 20)
  for (const team of ['blue', 'blue', 'red'] as const) {
    const aircraft = new Aircraft(P51D)
    aircraft.state.position.copy(position)
    const c = world.add(aircraft, { update() {} }, team, position)
    c.hp = 1
  }
  applyBombBlast(world, position.x, position.y, position.z, 10000, 0)
  expect(world.combatants.every(c => !c.alive)).toBe(true)
  expect(world.combatants[0]!.hitsDealt).toBe(1)
  expect(world.killEvents.count).toBe(3)
  expect(Array.from({ length: 3 }, (_, i) => world.killEvents.data[i * KILL_STRIDE + 7]))
    .toEqual([-1, -1, 0])
  applyBombBlast(world, position.x, position.y, position.z, 10000, 0)
  expect(world.killEvents.count).toBe(3)
})

it('地面與船艦退場寫入各自的事件緩衝，重複爆風不會重複退場', () => {
  const world = new World()
  const other = new World()
  const ground = createGroundTarget(7, 'oilTank', 'red', 10, 0, 0)
  const ship = createShip(3, SHIP_CLASSES.fletcher!, 'blue', 0, 0, 0, 0)
  ship.guns = createShipGuns(ship.cls)
  world.groundTargets.push(ground)
  world.ships.push(ship)
  applyBombBlast(world, 0, 0, 0, 100000, -1)
  expect(ground.alive).toBe(false)
  expect(ship.alive).toBe(false)
  expect(ship.guns.length).toBeGreaterThan(0)
  expect(ship.guns.every(g => !g.alive)).toBe(true)
  expect(Array.from(world.groundKillEvents.data.slice(3, 6))).toEqual([7, -1, 1])
  expect(Array.from(world.shipKillEvents.data.slice(3, 6))).toEqual([3, -1, 0])
  applyBombBlast(world, 0, 0, 0, 100000, -1)
  expect(world.groundKillEvents.count).toBe(1)
  expect(world.shipKillEvents.count).toBe(1)
  expect(other.groundKillEvents.count).toBe(0)
  expect(other.shipKillEvents.count).toBe(0)
})
