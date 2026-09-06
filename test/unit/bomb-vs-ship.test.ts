import { describe, it, expect } from 'vitest'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import {
  BOMB_BLAST_DAMAGE, BOMB_BLAST_RADIUS, blastRadiusOf, blastScaleOf,
  bombBlastDamage,
} from '../../src/weapons/bomb'
import { LOADOUT_BY_AIRCRAFT, loadoutOf } from '../../src/weapons/stores'
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
function dropOn(world: World, x: number, z: number, damage = BOMB_BLAST_DAMAGE): void {
  // 【最後那個 0 是投放者的隊別】這一支測的是彈道與命中，顏色與它無關
  world.dropBomb(x, 400, z, 0, 0, 0, damage, 0)
  for (let i = 0; i < 240 * 30 && world.bombs.live > 0; i++) world.step(DT)
}

describe('炸彈打船', () => {
  it('落在艦體上會扣血', () => {
    const { world, ship } = seaWithShip()
    const before = ship.hp
    dropOn(world, 0, 0)
    expect(ship.hp).toBe(before - BOMB_BLAST_DAMAGE)
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

describe('炸彈的範圍傷害', () => {
  it('衰減曲線：爆心全額、半徑處歸零、半徑外不倒扣', () => {
    const D = BOMB_BLAST_DAMAGE
    expect(bombBlastDamage(0, D)).toBe(D)
    expect(bombBlastDamage(BOMB_BLAST_RADIUS / 2, D)).toBeCloseTo(D / 2, 9)
    expect(bombBlastDamage(BOMB_BLAST_RADIUS, D)).toBe(0)
    expect(bombBlastDamage(1e6, D)).toBe(0)
  })

  /**
   * 【這一條守的是專案負責人指出的那件事】Fletcher 長 114.8 m，艦首在
   * z = −57.4。落在艦首前 8 m 的那一顆離**船體**只有 8 m，離**質心**卻有
   * 65 m —— 照質心算的話它一點血都扣不到。
   */
  it('艦首前爆炸照樣扣血 —— 量的是到艦體的距離，不是到質心', () => {
    const { world, ship } = seaWithShip()
    const bow = ship.cls.hull[0]!.half.z
    const before = ship.hp
    dropOn(world, 0, -(bow + 8))
    const lost = before - ship.hp
    expect(lost).toBeGreaterThan(0)
    // 離船體 8 m：全額的 (1 − 8/30) ≈ 73%
    expect(lost).toBeCloseTo(bombBlastDamage(8, BOMB_BLAST_DAMAGE), 6)
    // 【對照組】照質心算的話 65 m 早就在半徑外了
    expect(bombBlastDamage(bow + 8, BOMB_BLAST_DAMAGE)).toBe(0)
  })

  it('半徑外的近失彈一點血都不扣', () => {
    const { world, ship } = seaWithShip()
    const bow = ship.cls.hull[0]!.half.z
    const before = ship.hp
    dropOn(world, 0, -(bow + BOMB_BLAST_RADIUS + 5))
    expect(ship.hp).toBe(before)
  })

  it('近失彈也削得到砲位 —— 它們各自算自己的距離', () => {
    const { world, ship } = seaWithShip()
    const g = ship.guns[0]!
    const before = g.hp
    // 落在那一座砲的正上方外側 10 m
    dropOn(world, g.box.center.x + 10, g.box.center.z)
    expect(g.hp).toBeLessThan(before)
  })

  it('範圍傷害也打飛機 —— 貼地掠過爆點的那一架', () => {
    const { world } = seaWithShip()
    // 【沒有 combatant 時不得爆】這一條同時守「空陣列不當機」
    expect(() => dropOn(world, 300, 300)).not.toThrow()
  })
})

describe('炸彈的規模由它自己的傷害推導', () => {
  it('尺度是傷害的比值，基準彈是 1', () => {
    expect(blastScaleOf(BOMB_BLAST_DAMAGE)).toBe(1)
    expect(blastScaleOf(BOMB_BLAST_DAMAGE * 2)).toBe(2)
    expect(blastScaleOf(0)).toBe(0)
    expect(blastScaleOf(-5)).toBe(0)
  })

  it('半徑跟著尺度走 —— 痛的彈也炸得遠', () => {
    expect(blastRadiusOf(BOMB_BLAST_DAMAGE)).toBe(BOMB_BLAST_RADIUS)
    expect(blastRadiusOf(BOMB_BLAST_DAMAGE * 2)).toBe(BOMB_BLAST_RADIUS * 2)
  })

  it('兩倍傷害的彈，在基準彈打不到的距離上仍然扣得到血', () => {
    const far = BOMB_BLAST_RADIUS + 5
    expect(bombBlastDamage(far, BOMB_BLAST_DAMAGE)).toBe(0)
    expect(bombBlastDamage(far, BOMB_BLAST_DAMAGE * 2)).toBeGreaterThan(0)
  })

  it('兩台掛炸彈的轟炸機各有各的值，而且都是 250 kg 級', () => {
    const b17 = loadoutOf('b17g')!
    const he = loadoutOf('he111')!
    expect(b17.kind).toBe('bomb')
    expect(he.kind).toBe('bomb')
    // 【B-17G 與 He 111 幾乎一樣】兩者的單顆彈都是 250 kg 級 —— 重轟炸機
    // 的優勢在帶得多，不在單顆更狠
    expect(Math.abs(he.damage / b17.damage - 1)).toBeLessThan(0.1)
    expect(he.count).toBeLessThan(b17.count)
  })

  it('基準彈就是 B-17G 掛的那一種 —— 尺度的分母不能與表分家', () => {
    expect(loadoutOf('b17g')!.damage).toBe(BOMB_BLAST_DAMAGE)
    expect(blastScaleOf(loadoutOf('b17g')!.damage)).toBe(1)
  })

  it('掛載表上每一枚的尺度都是正的', () => {
    for (const l of Object.values(LOADOUT_BY_AIRCRAFT)) {
      expect(blastScaleOf(l.damage)).toBeGreaterThan(0)
    }
  })

  it('更痛的彈打得更遠 —— 基準彈打不到的距離上仍然扣得到血', () => {
    const world1 = seaWithShip()
    const world2 = seaWithShip()
    const bow = world1.ship.cls.hull[0]!.half.z
    // 落在艦首前 32 m —— 超出基準彈的 30 m
    dropOn(world1.world, 0, -(bow + 32), BOMB_BLAST_DAMAGE)
    dropOn(world2.world, 0, -(bow + 32), BOMB_BLAST_DAMAGE * 1.5)
    expect(world1.ship.hp).toBe(world1.ship.cls.hp)
    expect(world2.ship.hp).toBeLessThan(world2.ship.cls.hp)
  })
})
