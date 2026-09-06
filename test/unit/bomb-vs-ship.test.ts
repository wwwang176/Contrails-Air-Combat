import { describe, it, expect } from 'vitest'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import { BOMB_SHIP_DAMAGE } from '../../src/weapons/bomb'
import { IMPACT_STRIDE } from '../../src/world/events'

const DT = 1 / 240

/** 一艘停在原點、艏向 +Z 的驅逐艦，海面在 y = 0 */
function seaWithShip(): { world: World; ship: Ship } {
  const world = new World()
  world.groundAt = () => 0
  world.waterAt = () => 0
  const ship = createShip(0, SHIP_CLASSES.fletcher!, 'red', 0, 0, 0, 0)
  ship.guns = createShipGuns(ship.cls)
  world.ships.push(ship)
  return { world, ship }
}

/** 從 `(x, 400, z)` 垂直投一顆，跑到它消失為止 */
function dropOn(world: World, x: number, z: number): void {
  world.dropBomb(x, 400, z, 0, 0, 0)
  for (let i = 0; i < 240 * 30 && world.bombs.live > 0; i++) world.step(DT)
}

describe('炸彈打船', () => {
  it('落在艦體上會扣血', () => {
    const { world, ship } = seaWithShip()
    const before = ship.hp
    dropOn(world, 0, 0)
    expect(ship.hp).toBe(before - BOMB_SHIP_DAMAGE)
  })

  it('那一筆事件的種類是「船」（nx = 2）', () => {
    const { world } = seaWithShip()
    dropOn(world, 0, 0)
    expect(world.bombEvents.count).toBe(1)
    expect(world.bombEvents.data[3]).toBe(2)
  })

  it('爆點在甲板上，不在水面 —— 穿過艦體再爆才是缺陷', () => {
    const { world, ship } = seaWithShip()
    dropOn(world, 0, 0)
    const y = world.bombEvents.data[1]!
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThanOrEqual(ship.cls.hull[0]!.half.y * 2 + 1)
  })

  it('落在船旁邊的水裡不扣血，而且事件是「水」', () => {
    const { world, ship } = seaWithShip()
    const before = ship.hp
    dropOn(world, 200, 0)
    expect(ship.hp).toBe(before)
    expect(world.bombEvents.data[3]).toBe(1)
  })

  it('三發打沉驅逐艦', () => {
    const { world, ship } = seaWithShip()
    expect(ship.cls.hp).toBe(20_000)
    for (let n = 0; n < 3; n++) {
      expect(ship.alive).toBe(true)
      dropOn(world, 0, 0)
    }
    expect(ship.alive).toBe(false)
  })

  it('沉了的船不再擋炸彈 —— 落在它上面的那一顆會直接入水', () => {
    const { world, ship } = seaWithShip()
    ship.alive = false
    dropOn(world, 0, 0)
    expect(world.bombEvents.data[3]).toBe(1)
  })

  it('擊沉時砲位一起標死 —— 沉船上不該有槍焰', () => {
    const { world, ship } = seaWithShip()
    for (let n = 0; n < 3; n++) dropOn(world, 0, 0)
    expect(ship.alive).toBe(false)
    expect(ship.guns.every((g) => !g.alive)).toBe(true)
  })

  it('直接命中砲位時那一座也扣血', () => {
    const { world, ship } = seaWithShip()
    const gun = ship.guns[0]!
    const before = gun.hp
    const c = gun.box.center
    dropOn(world, c.x, c.z)
    expect(gun.hp).toBeLessThan(before)
    // 【一顆炸彈遠超過任何砲位的血量】那一座當場報銷
    expect(gun.alive).toBe(false)
  })

  it('沒有船的場景一顆事件都不會標成「船」', () => {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => -Infinity
    dropOn(world, 0, 0)
    expect(world.bombEvents.count).toBe(1)
    expect(world.bombEvents.data[3]).toBe(0)
  })

  it('一趟十顆全中：驅逐艦沉、事件推滿十筆', () => {
    const { world, ship } = seaWithShip()
    for (let n = 0; n < 10; n++) dropOn(world, 0, 0)
    expect(ship.alive).toBe(false)
    expect(world.bombEvents.count).toBe(10)
    for (let e = 0; e < 3; e++) {
      expect(world.bombEvents.data[e * IMPACT_STRIDE + 3]).toBe(2)
    }
  })
})
