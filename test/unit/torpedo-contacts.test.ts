import { describe, expect, it } from 'vitest'
import { createTorpedoContacts } from '../../src/world/torpedoContacts'
import { createImpacts } from '../../src/world/events'
import { createShip, SHIP_CLASSES, type Ship } from '../../src/world/ships'
import { NO_HIT } from '../../src/world/hit'

function fixture(ships: Ship[]) {
  const world = {
    ships, waterAt: (_x: number, _z: number) => 3,
    shipHitEvents: createImpacts(), shipKillEvents: createImpacts(),
    torpedoEvents: createImpacts(), torpedoWakeEvents: createImpacts(),
  }
  return { world, contacts: createTorpedoContacts(world) }
}

describe('魚雷碰撞的回呼', () => {
  it('取線段上第一個碰到的船殼；落空時清掉上一次的命中', () => {
    const far = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 100, 0, 0)
    const near = createShip(1, SHIP_CLASSES.fletcher, 'red', 0, -100, 0, 0)
    const { world, contacts } = fixture([far, near])
    const hp = near.hp
    expect(contacts.block(0, -1, -300, 0, -1, 300)).toBeGreaterThanOrEqual(0)
    contacts.end(0, -1, -150, 1, 10, 0, 7)
    expect(near.hp).toBe(hp - 10)
    expect(far.hp).toBe(hp)
    expect(Array.from(world.shipHitEvents.data.slice(3, 6))).toEqual([1, 7, 0])
    expect(contacts.block(1000, -1, -300, 1000, -1, 300)).toBe(NO_HIT)
    contacts.end(1000, -1, 300, 0, 10, 0, 7)
    expect(world.shipHitEvents.count).toBe(1)
    expect(world.torpedoEvents.data[11]).toBe(-1)
  })

  it('兩個世界在結算前交錯查詢，命中各算各的', () => {
    const enemy = createShip(4, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    const ally = createShip(8, SHIP_CLASSES.fletcher, 'blue', 0, 0, 0, 0)
    const a = fixture([enemy]), b = fixture([ally])
    const allyHp = ally.hp
    a.contacts.block(0, -1, -300, 0, -1, 300)
    b.contacts.block(0, -1, -300, 0, -1, 300)
    a.contacts.end(0, -1, 0, 1, enemy.hp, 0, 2)
    b.contacts.end(0, -1, 0, 1, ally.hp, 0, 2)
    expect(enemy.alive).toBe(false)
    expect(a.world.shipKillEvents.count).toBe(1)
    expect(a.world.shipKillEvents.data[3]).toBe(4)
    expect(ally.hp).toBe(allyHp)
    expect(b.world.shipHitEvents.count).toBe(0)
    expect(b.world.torpedoEvents.count).toBe(0)
  })

  it('回呼在佈置前就建好，讀的仍是當下的水面查詢與艦隊', () => {
    const { world, contacts } = fixture([])
    expect(contacts.block(0, -1, -300, 0, -1, 300)).toBe(NO_HIT)
    world.ships.push(createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0))
    expect(contacts.block(0, -1, -300, 0, -1, 300)).toBeGreaterThanOrEqual(0)
    contacts.entry(1, 2, 3)
    world.waterAt = () => -Infinity
    contacts.entry(4, 5, 6)
    contacts.wake(7, 8, 9)
    expect(Array.from(world.torpedoWakeEvents.data.slice(0, 18))).toEqual([
      1, 3, 3, 0, 0, 0,
      4, 5, 6, 0, 0, 0,
      7, 8, 9, 0, 0, 0,
    ])
  })
})
