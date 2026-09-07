import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import {
  SHIP_GUN_SPECS, SHIP_OWNER_BASE, createShipGuns, ownerShipIndex, shipOwner, stepShipGuns,
} from '../../src/world/shipGuns'
import { Projectiles } from '../../src/world/Projectiles'
import { createFlak, type FlakShells } from '../../src/world/flak'
import type { ShipAATier } from '../../src/world/shipAA'
import type { TurretCombatant } from '../../src/world/turrets'

/** 一架不會動的假飛機。只填 `stepShipGuns` 讀得到的欄位。 */
function target(index: number, x: number, y: number, z: number, team = 'blue'): TurretCombatant {
  return {
    index, team, alive: true, hp: 100,
    aircraft: {
      spec: { turrets: [] },
      state: {
        position: new Vector3(x, y, z),
        velocity: new Vector3(0, 0, 0),
        orientation: new Quaternion(),
      },
    },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

/** 只留某一層砲位的船 —— 各層的射程與行為要分開驗。 */
function shipWith(tier: ShipAATier, cls = SHIP_CLASSES.wichita): Ship {
  const only = { ...cls, zones: cls.zones.filter((z) => z.tier === tier) }
  const s = createShip(0, only, 'red', 0, 0, 0, 0)
  s.guns = createShipGuns(only)
  s.gunCooldowns = new Float32Array(only.zones.length)
  return s
}

function run(
  ship: Ship, all: TurretCombatant[], seconds: number, flak: FlakShells = createFlak(),
): Projectiles {
  const p = new Projectiles(4096)
  const dt = 1 / 240
  for (let i = 0; i < seconds * 240; i++) stepShipGuns(ship, all, p, flak, i * dt, dt)
  return p
}

describe('船砲彈的來源編碼', () => {
  /**
   * 【為什麼不能用 −1 也不能用 0..3】−1 是 `Projectiles` 的空槽標記，用它會讓
   * `liveCount` 加上去卻永遠不推進；0..3 會被 `resolveHits` 當成同索引的飛機，
   * 錯誤排除那一架，還把命中數與助攻記到它頭上。
   */
  it('編碼落在 −1 與所有 combatant 索引之外，而且解得回來', () => {
    for (let i = 0; i < 8; i++) {
      expect(shipOwner(i)).toBeLessThanOrEqual(SHIP_OWNER_BASE)
      expect(ownerShipIndex(shipOwner(i))).toBe(i)
    }
    expect(ownerShipIndex(-1)).toBe(-1)
    expect(ownerShipIndex(0)).toBe(-1)
    expect(ownerShipIndex(37)).toBe(-1)
  })
})

describe('createShipGuns', () => {
  it('每個砲區一門，血量與碰撞盒照那一層的規格', () => {
    const guns = createShipGuns(SHIP_CLASSES.wichita)
    expect(guns.length).toBe(SHIP_CLASSES.wichita.zones.length)
    for (const g of guns) {
      const spec = SHIP_GUN_SPECS[g.zone.tier]
      expect(g.hp).toBe(spec.hp)
      expect(g.alive).toBe(true)
      expect(g.box.half.x).toBe(spec.boxHalf)
      expect(g.box.center).toEqual(g.zone.position)
    }
  })

  /** 【射界錐朝舷外】不然左舷的砲會對著自己的上層建築打。 */
  it('射界錐的水平分量朝舷外，中線上的朝正上', () => {
    for (const g of createShipGuns(SHIP_CLASSES.wichita)) {
      const x = g.zone.position.x
      if (Math.abs(x) < 1) expect(g.axis.y).toBeCloseTo(1, 6)
      else expect(Math.sign(g.axis.x)).toBe(Math.sign(x))
      expect(g.axis.length()).toBeCloseTo(1, 6)
    }
  })

  /** 【相位要錯開】全部同步的話一整排砲會像一個人在開火。 */
  it('搖晃相位彼此不同', () => {
    const phases = createShipGuns(SHIP_CLASSES.wichita).map((g) => g.phase)
    expect(new Set(phases).size).toBe(phases.length)
  })
})

describe('stepShipGuns', () => {
  it('沒有目標時一發都不打', () => {
    expect(run(shipWith('mg'), [], 3).live).toBe(0)
  })

  it('目標在正上方 600 m 時 20 mm 會開火', () => {
    expect(run(shipWith('mg'), [target(0, 0, 600, 0)], 3).live).toBeGreaterThan(0)
  })

  /** 【射程】20 mm 是 830 × 1.6 ≈ 1,330 m。3,000 m 外它不該有解。 */
  it('20 mm 打不到 3,000 m 外的目標', () => {
    expect(run(shipWith('mg'), [target(0, 0, 3000, 0)], 3).live).toBe(0)
  })

  /**
   * 【三層要疊出層次】同一條進場線上，三層各自在不同距離接手：
   * 20 mm 1,330 m、40 mm 2,990 m、5 吋 4,950 m。**每一層都要有一段
   * 只有它打得到的距離**，否則彈幕讀起來是一堵牆而不是三層。
   */
  it('三層的射程互相分開', () => {
    // 2,500 m：只有 40 mm（與 5 吋）打得到
    expect(run(shipWith('mg'), [target(0, 0, 2500, 0)], 3).live).toBe(0)
    expect(run(shipWith('autocannon'), [target(0, 0, 2500, 0)], 3).live).toBeGreaterThan(0)
    // 1,800 m：20 mm 還是打不到
    expect(run(shipWith('mg'), [target(0, 0, 1800, 0)], 3).live).toBe(0)
    // 3,500 m：連 40 mm 都打不到了
    expect(run(shipWith('autocannon'), [target(0, 0, 3500, 0)], 3).live).toBe(0)
  })

  it('同隊的飛機不是目標', () => {
    expect(run(shipWith('mg'), [target(0, 0, 600, 0, 'red')], 3).live).toBe(0)
  })

  it('目標死了就不打', () => {
    const t = target(0, 0, 600, 0)
    t.alive = false
    expect(run(shipWith('mg'), [t], 3).live).toBe(0)
  })

  /** 【砲位死了完全不動】不搜尋、不轉、不開火。 */
  it('砲位全部打掉之後一發都不打', () => {
    const s = shipWith('mg')
    for (const g of s.guns) g.alive = false
    expect(run(s, [target(0, 0, 600, 0)], 3).live).toBe(0)
  })

  /**
   * 【傷害是表上的值】照抄 `stepTurrets` 會套 `TURRET_DAMAGE_SCALE`
   * 與 `guns` —— 四聯裝 40 mm 會從 40 變成 150。
   */
  it('單發傷害等於表上的值，不乘 guns 也不乘 TURRET_DAMAGE_SCALE', () => {
    for (const tier of ['mg', 'autocannon'] as const) {
      const p = run(shipWith(tier), [target(0, 0, tier === 'mg' ? 600 : 1200, 0)], 3)
      const seen = new Set<number>()
      for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1) seen.add(p.damage[i]!)
      expect([...seen]).toEqual([SHIP_GUN_SPECS[tier].damage])
    }
  })

  it('彈丸帶的是船的陣營、該層的壽命、以及船的來源編碼', () => {
    const p = run(shipWith('mg'), [target(0, 0, 600, 0)], 3)
    const i = p.owner.findIndex((o) => o !== -1)
    expect(p.team[i]).toBe(1)
    // 【toBeCloseTo 不是 toBe】life 是 Float32Array，1.6 存進去是 1.6000000238
    expect(p.life[i]).toBeCloseTo(SHIP_GUN_SPECS.mg.life, 6)
    expect(p.owner[i]).toBe(shipOwner(0))
  })

  /**
   * 【射速】20 mm 是 240 發/分 = 每秒 4 發。四個砲區、四秒，上界是 64 發。
   * 點放與追瞄會讓實際值低於它，但**不能超過** —— 超過就是射速時鐘接錯了。
   */
  it('射速不超過標稱值', () => {
    const s = shipWith('mg')
    const p = new Projectiles(4096)
    const dt = 1 / 240
    let fired = 0
    let prev = 0
    for (let i = 0; i < 4 * 240; i++) {
      stepShipGuns(s, [target(0, 0, 600, 0)], p, createFlak(), i * dt, dt)
      const now = p.writeCursor
      fired += now - prev
      prev = now
    }
    expect(fired).toBeLessThanOrEqual(s.guns.length * (240 / 60) * 4)
  })

  /** 【5 吋砲不進彈丸池】它走近炸引信那條路。 */
  it('5 吋砲產生高砲彈而不是彈丸', () => {
    const f = createFlak()
    expect(run(shipWith('flak'), [target(0, 0, 2000, 0)], 3, f).live).toBe(0)
    expect(f.live).toBeGreaterThan(0)
  })

  /**
   * 【引信 = 發射瞬間解出的攔截時間】2,000 m 的靜止目標，初速 450 →
   * 約 4.4 秒。解不出來或超過上限就不開火。
   */
  it('引信約等於距離除以初速', () => {
    const s = shipWith('flak')
    const p = new Projectiles(64)
    const f = createFlak()
    const dt = 1 / 240
    // 【要等】20 發/分，而且砲要從仰角 55° 轉到正上方（20°/s，約 1.75 秒）。
    // 所以不是「跑一秒就有」——一出現就停，那一刻的引信才是發射時的值。
    let i = -1
    for (let k = 0; k < 10 * 240 && i < 0; k++) {
      stepShipGuns(s, [target(0, 0, 2000, 0)], p, f, k * dt, dt)
      i = f.team.findIndex((t) => t !== -1)
    }
    expect(i).toBeGreaterThanOrEqual(0)
    expect(f.fuse[i]!).toBeCloseTo(2000 / SHIP_GUN_SPECS.flak.muzzleVelocity, 1)
  })

  /** 【超過引信上限就不開火】450 × 11 = 4,950 m 之外。 */
  it('5 吋砲打不到 6,000 m 外的目標', () => {
    const f = createFlak()
    run(shipWith('flak'), [target(0, 0, 6000, 0)], 3, f)
    expect(f.live).toBe(0)
  })
})
