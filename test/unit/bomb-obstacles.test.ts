import { expect, it } from 'vitest'
import { createBombObstacleQuery } from '../../src/world/bombObstacles'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { NO_HIT } from '../../src/world/hit'

it('使用目前的目標陣列與存活狀態，等距保留先列出的目標，每次清除舊結果', () => {
  const a = createGroundTarget(0, 'chimney', 'red', 0, 0, 0)
  const b = createGroundTarget(1, 'chimney', 'red', 0, 0, 0)
  const targets = [a, b]
  const query = createBombObstacleQuery([], targets)
  const block = query.block
  const first = block(0, 300, 0, 0, -10, 0)
  expect(first).not.toBe(NO_HIT)
  expect(query.ground).toBe(a)
  expect(query.ship).toBeNull()
  a.alive = false
  expect(block(0, 300, 0, 0, -10, 0)).toBe(first)
  expect(query.ground).toBe(b)
  targets.length = 0
  expect(block(0, 300, 0, 0, -10, 0)).toBe(NO_HIT)
  expect(query.ground).toBeNull()
  expect(query.ship).toBeNull()
  targets.push(b)
  b.position.x = 1000
  expect(block(0, 300, 0, 0, -10, 0)).toBe(NO_HIT)
  expect(block(1000, 300, 0, 1000, -10, 0)).toBe(first)
  expect(query.ground).toBe(b)
  expect(query.block).toBe(block)
})

it('較近的地面目標覆蓋船命中，地面目標擊毀後改中船，各查詢結果獨立', () => {
  const ship = createShip(0, SHIP_CLASSES.fletcher!, 'red', 0, 0, 0, 0)
  const target = createGroundTarget(0, 'chimney', 'red', 0, 0, 0)
  const query = createBombObstacleQuery([ship], [target])
  const shipOnly = createBombObstacleQuery([ship], [])
  const groundT = query.block(0, 300, 0, 0, -10, 0)
  const shipT = shipOnly.block(0, 300, 0, 0, -10, 0)
  expect(groundT).toBeLessThan(shipT)
  expect(query.ground).toBe(target)
  expect(query.ship).toBeNull()
  expect(shipOnly.ship).toBe(ship)
  target.alive = false
  expect(query.block(0, 300, 0, 0, -10, 0)).toBe(shipT)
  expect(query.ship).toBe(ship)
  expect(query.ground).toBeNull()
  ship.alive = false
  expect(query.block(0, 300, 0, 0, -10, 0)).toBe(shipT)
  expect(query.ship).toBe(ship)
})
