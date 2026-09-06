import { describe, it, expect } from 'vitest'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip, type Ship, type ShipClassId } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import { TORPEDO_DEPTH, TORPEDO_SPEED } from '../../src/world/torpedo'
import { loadoutOf } from '../../src/weapons/stores'
import { IMPACT_STRIDE } from '../../src/world/events'
import { solveImpact, type BombState, type Impact } from '../../src/world/bomb'

const DT = 1 / 240
const TORPEDO = loadoutOf('g4m')!

/** 一艘停在原點、艏向 −Z 的船，海面在 y = 0 */
function seaWithShip(id: ShipClassId = 'fletcher'): { world: World; ship: Ship } {
  const world = new World()
  world.groundAt = () => 0
  world.waterAt = () => 0
  const ship = createShip(0, SHIP_CLASSES[id], 'red', 0, 0, 0, 0)
  ship.guns = createShipGuns(ship.cls)
  world.ships.push(ship)
  return { world, ship }
}

/**
 * 從船艏前方 `d` 公尺、高 40 m 處朝船投一枚，跑到它消失為止。
 *
 * 【為什麼用真的投放而不是直接把魚雷擺進水裡】空中段與入水的接合就是最
 * 容易錯的地方，繞過它等於不測。
 */
function launch(world: World, d: number, damage = TORPEDO.damage, offsetX = 0): void {
  world.dropTorpedo(offsetX, 40, -d, 0, 0, 90, damage, 0, 1)
  for (let i = 0; i < 240 * 160 && world.torpedoes.live > 0; i++) world.step(DT)
}

describe('魚雷打船', () => {
  it('命中艦體扣的就是接觸傷害，沒有衰減', () => {
    const { world, ship } = seaWithShip()
    const before = ship.hp
    launch(world, 500)
    expect(ship.hp).toBe(before - TORPEDO.damage)
  })

  /**
   * 【這一條守的是「水下沒有盒」那個坑】改盒之前，定深 1 m 的魚雷會從
   * 每一艘船的底下穿過去，而且**看起來像沒瞄準**。
   */
  it('從水線下 1 m 通過會打中 —— 水下有盒', () => {
    for (const id of ['fletcher', 'wichita', 'essex'] as const) {
      const { world, ship } = seaWithShip(id)
      const before = ship.hp
      launch(world, 400)
      expect(ship.hp, id).toBeLessThan(before)
    }
  })

  it('三級船各要幾枚', () => {
    const table: [ShipClassId, number][] = [
      ['fletcher', 2], ['wichita', 3], ['essex', 4],
    ]
    for (const [id, expected] of table) {
      const { world, ship } = seaWithShip(id)
      let n = 0
      while (ship.alive && n < 10) {
        launch(world, 400)
        n++
      }
      expect(n, id).toBe(expected)
      expect(ship.alive, id).toBe(false)
    }
  })

  it('沉了之後砲位也全滅', () => {
    const { world, ship } = seaWithShip()
    while (ship.alive) launch(world, 400)
    expect(ship.guns.every((g) => !g.alive)).toBe(true)
  })

  it('死掉的船不再擋雷', () => {
    const { world, ship } = seaWithShip()
    ship.alive = false
    launch(world, 400)
    expect(world.torpedoEvents.count).toBe(0)
  })

  it('打偏就跑過去，不扣血', () => {
    const { world, ship } = seaWithShip()
    const before = ship.hp
    launch(world, 400, TORPEDO.damage, 200)
    expect(ship.hp).toBe(before)
  })
})

describe('接觸引爆：沒有範圍傷害', () => {
  /**
   * 【負責人指定】「無範圍傷害，等於是接觸引爆，不打飛機」。
   *
   * 【用 `applyDamage` 的呼叫次數當觀察點】組一個真的 `Combatant` 要整台
   * 飛行模型，而這一條要守的其實是「魚雷這條路完全不碰飛機」——
   * `applyDamage` 是那件事唯一的入口。
   */
  it('整條路一次都不呼叫 applyDamage', () => {
    const { world, ship } = seaWithShip()
    let calls = 0
    const real = world.applyDamage.bind(world)
    world.applyDamage = ((...args: Parameters<World['applyDamage']>) => {
      calls++
      real(...args)
    }) as World['applyDamage']

    launch(world, 400)
    expect(ship.hp).toBeLessThan(ship.cls.hp)
    expect(calls).toBe(0)
  })

  /**
   * 【近失彈不算】炸彈在同一個距離上扣得到血（`BOMB_BLAST_RADIUS` 是
   * 30 m），魚雷擦身而過就是擦身而過。
   */
  it('擦過去 20 m 不扣血 —— 炸彈在同一個距離上扣得到', () => {
    const { world, ship } = seaWithShip()
    const halfBeam = ship.cls.hull[0]!.half.x
    launch(world, 400, TORPEDO.damage, halfBeam + 20)
    expect(ship.hp).toBe(ship.cls.hp)
  })

  /**
   * 【砲位在甲板上，魚雷在水面下 1 m】掃它們是純粹的浪費，而且「魚雷打掉
   * 了防空砲」是一個講不通的結果。
   */
  it('砲位一座都打不掉', () => {
    const { world, ship } = seaWithShip()
    const before = ship.guns.map((g) => g.hp)
    launch(world, 400)
    expect(ship.guns.map((g) => g.hp)).toEqual(before)
    expect(ship.guns.every((g) => g.alive)).toBe(true)
  })
})

describe('多艘船', () => {
  it('打中的是近的那一艘', () => {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => 0
    const near = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -300, 0, 0)
    const far = createShip(1, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    near.guns = createShipGuns(near.cls)
    far.guns = createShipGuns(far.cls)
    world.ships.push(near, far)

    launch(world, 900)
    expect(near.hp).toBeLessThan(near.cls.hp)
    expect(far.hp).toBe(far.cls.hp)
  })
})

describe('事件', () => {
  it('命中船的事件：nx = 1、ny = 傷害', () => {
    const { world } = seaWithShip()
    launch(world, 400)
    expect(world.torpedoEvents.count).toBe(1)
    const d = world.torpedoEvents.data
    expect(d[3]).toBe(1)
    expect(d[4]).toBe(TORPEDO.damage)
    // 爆點在定深上
    expect(d[1]).toBe(-TORPEDO_DEPTH)
  })

  it('撞岸的事件：nx = 0', () => {
    const world = new World()
    // z < −600 之後是陸地
    world.groundAt = (_x, z) => (z < -600 ? 5 : 0)
    world.waterAt = (_x, z) => (z < -600 ? -Infinity : 0)
    world.dropTorpedo(0, 40, 0, 0, 0, -90, TORPEDO.damage, 0, -1)
    for (let i = 0; i < 240 * 160 && world.torpedoes.live > 0; i++) world.step(DT)
    expect(world.torpedoEvents.count).toBe(1)
    expect(world.torpedoEvents.data[3]).toBe(0)
  })

  it('射程用盡不推事件', () => {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => 0
    world.dropTorpedo(0, 40, 0, 0, 0, -90, TORPEDO.damage, 0, -1)
    for (let i = 0; i < 240 * 160 && world.torpedoes.live > 0; i++) world.step(DT)
    expect(world.torpedoes.live).toBe(0)
    expect(world.torpedoEvents.count).toBe(0)
  })

  it('航跡事件一路推出來，高度是水面', () => {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => 1.5
    world.dropTorpedo(0, 40, 0, 0, 0, -90, TORPEDO.damage, 0, -1)
    let wakes = 0
    for (let i = 0; i < 240 * 20; i++) {
      world.step(DT)
      for (let e = 0; e < world.torpedoWakeEvents.count; e++) {
        expect(world.torpedoWakeEvents.data[e * IMPACT_STRIDE + 1]).toBe(1.5)
        wakes++
      }
      world.torpedoWakeEvents.count = 0
    }
    expect(wakes).toBeGreaterThan(20)
  })
})

describe('確定性', () => {
  it('同一組輸入投兩次，落點相同', () => {
    const a = new World()
    const b = new World()
    for (const w of [a, b]) { w.groundAt = () => 0; w.waterAt = () => 0 }
    for (const w of [a, b]) {
      w.dropTorpedo(0, 40, 0, 5, 0, -90, TORPEDO.damage, 0, -1)
      for (let i = 0; i < 240 * 3; i++) w.step(DT)
    }
    expect(a.torpedoes.x[0]).toBe(b.torpedoes.x[0])
    expect(a.torpedoes.z[0]).toBe(b.torpedoes.z[0])
  })

  it('投放序號決定散佈 —— 第二枚與第一枚不同', () => {
    const w = new World()
    w.groundAt = () => 0
    w.waterAt = () => 0
    w.dropTorpedo(0, 40, 0, 0, 0, -90, TORPEDO.damage, 0, -1)
    w.dropTorpedo(0, 40, 0, 0, 0, -90, TORPEDO.damage, 0, -1)
    expect(w.torpedoes.dropped).toBe(2)
    const same = w.torpedoes.vx[0] === w.torpedoes.vx[1]
      && w.torpedoes.vy[0] === w.torpedoes.vy[1]
    expect(same).toBe(false)
  })
})

describe('雷速', () => {
  it('水中的速率就是 TORPEDO_SPEED', () => {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => 0
    world.dropTorpedo(0, 40, 0, 0, 0, -90, TORPEDO.damage, 0, -1)
    for (let i = 0; i < 240 * 5; i++) world.step(DT)
    const t = world.torpedoes
    expect(t.phase[0]).toBe(1)
    expect(Math.hypot(t.vx[0]!, t.vz[0]!)).toBeCloseTo(TORPEDO_SPEED, 9)
  })
})

describe('投放的散佈', () => {
  /**
   * 【圈是中心，不是這一枚】`World.dropTorpedo` 套的散佈與炸彈是同一組
   * （`spreadPair`，由累計投放序號決定，可重播）。所以實際入水點會離瞄具
   * 解的落點有一小段距離 —— **那是刻意的**。把散佈也套進瞄具的話，散佈就
   * 變成免費的情報，等於沒有散佈。
   *
   * 這一條釘住的是「有差、而且差得不大」。它同時是一道護欄：把散佈拿掉會
   * 紅，把散佈放大到船打不中也會紅。
   */
  it('實際入水點離瞄具解的中心有一小段，但小於船寬', () => {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => 0
    const entries: { x: number; z: number }[] = []
    const start: BombState = { x: 0, y: 60, z: 0, vx: 0, vy: 0, vz: -80 }
    const out: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
    expect(solveImpact(start, world.bombDrag, () => 0, DT, out)).toBe(true)

    world.dropTorpedo(start.x, start.y, start.z, start.vx, start.vy, start.vz,
      TORPEDO.damage, 0, -1)
    const pool = world.torpedoes
    for (let t = 0; t < 30; t += DT) {
      if (pool.phase[0] === 1) break
      pool.step(DT, world.bombDrag, () => 0, () => 0,
        () => {}, (x, _y, z) => { entries.push({ x, z }) }, () => {})
    }
    expect(entries.length).toBe(1)
    const d = Math.hypot(entries[0]!.x - out.x, entries[0]!.z - out.z)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(SHIP_CLASSES.fletcher.radius)
  })
})

