import { describe, expect, it } from 'vitest'
import { World } from '../../src/world/World'
import { GROUND_CLASSES, createGroundTarget, type GroundTarget } from '../../src/world/groundTargets'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import { BOMB_BLAST_DAMAGE, BOMB_BLAST_RADIUS } from '../../src/weapons/bomb'
import { IMPACT_STRIDE } from '../../src/world/events'

const DT = 1 / 240

/** 一片平地，沒有水 */
function land(): World {
  const world = new World()
  world.groundAt = () => 0
  world.waterAt = () => -Infinity
  return world
}

function place(world: World, cls = GROUND_CLASSES.chimney, x = 0, z = 0): GroundTarget {
  const t = createGroundTarget(world.groundTargets.length, cls, 'red', x, z, 0)
  world.groundTargets.push(t)
  return t
}

/** 從 `(x, 400, z)` 垂直投一顆，跑到它消失為止 */
function dropOn(world: World, x: number, z: number, damage = BOMB_BLAST_DAMAGE): void {
  world.dropBomb(x, 400, z, 0, 0, 0, damage, 0)
  for (let i = 0; i < 240 * 30 && world.bombs.live > 0; i++) world.step(DT)
}

describe('炸彈對地面目標', () => {
  /**
   * 【零船】只有這樣才殺得到回呼閘那個缺陷：`Bombs.step` 只在有船時才拿
   * 得到擋路回呼。有船的話這一條就算閘沒改也是綠的。
   */
  it('零船一座煙囪：從正上方投的炸彈在煙囪頂引爆，落點事件 kind = 3、帶索引', () => {
    const world = land()
    const t = place(world)
    dropOn(world, 0, 0)
    expect(world.bombEvents.count).toBe(1)
    const d = world.bombEvents.data
    expect(d[1]).toBeCloseTo(100, 0)
    expect(d[3]).toBe(3)
    expect(d[5]).toBe(t.index)
    expect(t.hp).toBe(t.cls.hp - BOMB_BLAST_DAMAGE)
  })

  it('直擊扣滿並摧毀；摧毀事件恰好一筆、落點事件也恰好一筆，再跑也不會多', () => {
    const world = land()
    const t = place(world, GROUND_CLASSES.oilTank, 50, 50)
    dropOn(world, 50, 50)
    expect(t.alive).toBe(false)
    expect(t.hp).toBeLessThanOrEqual(0)
    expect(world.groundDestroyedEvents.count).toBe(1)
    const g = world.groundDestroyedEvents.data
    expect(g[0]).toBe(50)
    expect(g[2]).toBe(50)
    expect(g[3]).toBe(t.index)
    expect(g[4]).toBeCloseTo(12, 6)
    expect(world.bombEvents.count).toBe(1)
    for (let i = 0; i < 240; i++) world.step(DT)
    expect(world.groundDestroyedEvents.count).toBe(1)
  })

  it('第二枚打在已經炸毀的目標上不再推摧毀事件', () => {
    const world = land()
    place(world, GROUND_CLASSES.oilTank, 50, 50)
    dropOn(world, 50, 50)
    dropOn(world, 50, 50)
    expect(world.groundDestroyedEvents.count).toBe(1)
    expect(world.bombEvents.count).toBe(2)
  })

  it('半徑外為 0；兩座相鄰只有近的那一座扣血', () => {
    const world = land()
    const near = place(world, GROUND_CLASSES.hydroTower, 0, 0)
    const far = place(world, GROUND_CLASSES.hydroTower, BOMB_BLAST_RADIUS + 60, 0)
    dropOn(world, 12, 0)
    expect(near.hp).toBeLessThan(near.cls.hp)
    expect(far.hp).toBe(far.cls.hp)
  })

  it('落在盒邊 10 m 外的那一顆扣的是衰減後的量', () => {
    const world = land()
    const t = place(world, GROUND_CLASSES.oilTank, 0, 0)
    // 油槽半寬 12.5；落在 x = 22.5 離盒 10 m
    dropOn(world, 22.5, 0)
    const expected = BOMB_BLAST_DAMAGE * (1 - 10 / BOMB_BLAST_RADIUS)
    expect(t.cls.hp - t.hp).toBeCloseTo(expected, 0)
  })

  it('炸毀的目標不再擋路，也不再扣血：落點回到地面、kind = 0', () => {
    const world = land()
    const t = place(world)
    t.hp = 0
    t.alive = false
    dropOn(world, 0, 0)
    const d = world.bombEvents.data
    expect(d[3]).toBe(0)
    expect(d[1]).toBeCloseTo(0, 0)
    expect(t.hp).toBe(0)
  })

  it('船與建築同場：擋到誰就記誰，另一格是空的', () => {
    const world = land()
    world.waterAt = () => 0
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 300, 0, 0, 0)
    ship.guns = createShipGuns(ship.cls)
    world.ships.push(ship)
    const t = place(world, GROUND_CLASSES.chimney, 0, 0)
    dropOn(world, 0, 0)
    dropOn(world, 300, 0)
    const d = world.bombEvents.data
    expect(d[3]).toBe(3)
    expect(d[5]).toBe(t.index)
    expect(d[IMPACT_STRIDE + 3]).toBe(2)
    expect(d[IMPACT_STRIDE + 5]).toBe(ship.index)
  })
})
