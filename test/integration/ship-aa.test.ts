import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { SHIP_GUN_SPECS, createShipGuns, shipOwner } from '../../src/world/shipGuns'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { G4M } from '../../src/specs/g4m'
import { createBattle, resetBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'

const DT = 1 / 240

/** 什麼都不做的控制器。這幾條要驗的是判定，不是 AI。 */
const IDLE: Controller = { update() {} }

function fleetOf(w: World, cls = SHIP_CLASSES.fletcher, team: 'blue' | 'red' = 'red'): Ship {
  const s = createShip(w.ships.length, cls, team, 0, 0, 0, 0)
  s.guns = createShipGuns(cls)
  s.gunCooldowns = new Float32Array(cls.zones.length)
  w.ships.push(s)
  return s
}

/**
 * 從 `from` 朝 `at` 打一發，推進到它消失為止（最多 40 步）。
 *
 * 【為什麼要多步】彈丸一步只走 1.67 m（400 m/s ÷ 240 Hz），而判定吃的是
 * [上一步, 這一步] 這一段線段 —— 一步到不了目標。
 */
function shoot(
  w: World, from: Vector3, at: Vector3, damage: number,
  owner = 0, team = 0,
): void {
  const v = at.clone().sub(from).normalize().multiplyScalar(400)
  const i = w.projectiles.spawn(
    from.x, from.y, from.z, v.x, v.y, v.z, damage, owner, team, PROJECTILE_LIFETIME,
  )
  for (let k = 0; k < 40 && w.projectiles.owner[i] !== -1; k++) {
    w.projectiles.step(DT)
    w.resolveHits()
  }
}

/** 砲位在世界座標的位置。船在原點、艏向 0，所以就是艦體座標本身。 */
const gunAt = (s: Ship, i: number): Vector3 => s.guns[i]!.zone.position.clone()

describe('彈丸打船', () => {
  it('打中砲位：砲位與船同時扣血', () => {
    const w = new World()
    const s = fleetOf(w)
    const g = s.guns[0]!
    const hp0 = s.hp
    const p = gunAt(s, 0)
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 30)
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp - 30)
    expect(s.hp).toBe(hp0 - 30)
  })

  /** 【不套部位倍率】PART_MULTIPLIER 是飛機的六個部位，船沒有座艙也沒有機翼。 */
  it('扣的是彈丸傷害的原值，不套部位倍率', () => {
    const w = new World()
    const s = fleetOf(w)
    const p = gunAt(s, 0)
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 17)
    expect(s.guns[0]!.hp).toBe(SHIP_GUN_SPECS[s.guns[0]!.zone.tier].hp - 17)
  })

  it('砲位血量歸零之後就死了', () => {
    const w = new World()
    const s = fleetOf(w)
    const g = s.guns[0]!
    const p = gunAt(s, 0)
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 10_000)
    expect(g.alive).toBe(false)
    expect(g.hp).toBeLessThanOrEqual(0)
  })

  /**
   * 【盒子要消失】負責人裁定：打掉的砲位是一個洞，不是還會擋子彈的殘骸。
   *
   * 用同一條線段打第二次 —— 砲位的血不該再變。
   */
  it('砲位死了之後盒子從判定裡消失', () => {
    const w = new World()
    const s = fleetOf(w)
    const g = s.guns[0]!
    const p = gunAt(s, 0)
    const from = p.clone().add(new Vector3(0, 40, 0))
    shoot(w, from, p, 10_000)
    const hpAfterDeath = g.hp
    shoot(w, from, p, 30)
    expect(g.hp).toBe(hpAfterDeath)
  })

  /**
   * 【自傷】砲口就在砲位盒的中心，而 `segmentBox` 對「起點已在盒內」回傳
   * t = 0。沒有排除規則的話，每一發直射彈在出膛那一步就打中自己的砲位。
   */
  it('船自己打出去的彈丸不會打中自己', () => {
    const w = new World()
    const s = fleetOf(w)
    const g = s.guns[0]!
    const p = gunAt(s, 0)
    shoot(w, p, p.clone().add(new Vector3(0, 300, 0)), 50, shipOwner(0), 1)
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp)
  })

  /** 【船不打船】spec §12 明令不做船對船，而同隊的姊妹艦就在 800 m 外。 */
  it('同隊的船不會被彼此的彈丸打到', () => {
    const w = new World()
    fleetOf(w)
    const s2 = createShip(1, SHIP_CLASSES.fletcher, 'red', 800, 0, 0, 0)
    s2.guns = createShipGuns(SHIP_CLASSES.fletcher)
    s2.gunCooldowns = new Float32Array(SHIP_CLASSES.fletcher.zones.length)
    w.ships.push(s2)
    const g = s2.guns[0]!
    const p = g.zone.position.clone().add(new Vector3(800, 0, 0))
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 50, shipOwner(0), 1)
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp)
  })

  it('打中船體：船扣血、砲位不動', () => {
    const w = new World()
    const s = fleetOf(w)
    const hp0 = s.hp
    const hull = s.cls.hull[0]!
    const p = hull.center.clone()
    shoot(w, p.clone().add(new Vector3(0, 60, 0)), p, 25)
    expect(s.hp).toBe(hp0 - 25)
    for (const g of s.guns) expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp)
  })
})

describe('飛機撞船', () => {
  /**
   * 【一定要關掉撞海】預設的 `crashPolicy` 是海平面判定，而艦體盒貼著水線。
   * 不關的話「撞船」與「撞海」分不出來 —— 測試會綠，但綠的是錯的理由。
   */
  const build = () => {
    const w = new World()
    w.crashPolicy = () => false
    return { w, s: fleetOf(w) }
  }

  const put = (w: World, x: number, y: number, z: number) => {
    const c = w.add(new Aircraft(P51D), IDLE, 'blue', new Vector3(x, y, z), y, 0)
    c.aircraft.state.position.set(x, y, z)
    c.aircraft.state.velocity.set(0, 0, 0)
    return c
  }

  it('飛機在船體盒裡 → 判墜毀', () => {
    const { w, s } = build()
    const b = s.cls.hull[0]!
    const c = put(w, b.center.x, b.center.y, b.center.z)
    w.step(DT)
    expect(c.alive).toBe(false)
  })

  it('從舷外通過 → 不判', () => {
    const { w, s } = build()
    const b = s.cls.hull[0]!
    const c = put(w, b.center.x + b.half.x * 4, b.center.y, b.center.z)
    w.step(DT)
    expect(c.alive).toBe(true)
  })

  /**
   * 【這一條守的是「不能用重心」】飛機重心在盒外，但機翼伸進去了。用重心
   * 判定的話這一條會綠著卻是錯的 —— 所以擺在剛好差一點的位置。
   */
  it('重心在盒外但機翼伸進去 → 仍然判墜毀', () => {
    const { w, s } = build()
    const b = s.cls.hull[0]!
    const semi = P51D.hitBoxes
      .filter((x) => x.part === 'wingLeft' || x.part === 'wingRight')
      .reduce((m, x) => Math.max(m, Math.abs(x.center.x) + x.half.x), 0)
    expect(semi).toBeGreaterThan(3)
    const c = put(w, b.center.x + b.half.x + semi * 0.6, b.center.y, b.center.z)
    w.step(DT)
    expect(c.alive).toBe(false)
  })

  it('同隊的船一樣會撞死 —— 撞擊與陣營無關', () => {
    const w = new World()
    w.crashPolicy = () => false
    const s = fleetOf(w, SHIP_CLASSES.fletcher, 'blue')
    const b = s.cls.hull[0]!
    const c = put(w, b.center.x, b.center.y, b.center.z)
    w.step(DT)
    expect(c.alive).toBe(false)
  })
})

describe('高砲的範圍傷害', () => {
  it('爆心附近的敵機扣血，同隊的不扣', () => {
    const w = new World()
    w.crashPolicy = () => false
    const foe = w.add(new Aircraft(P51D), IDLE, 'blue', new Vector3(0, 1000, 0), 1000, 0)
    const friend = w.add(new Aircraft(P51D), IDLE, 'red', new Vector3(5, 1000, 0), 1000, 0)
    foe.aircraft.state.position.set(0, 1000, 0)
    friend.aircraft.state.position.set(5, 1000, 0)
    const hp0 = foe.hp
    const fhp0 = friend.hp
    // 紅隊（team 1）在原地引爆
    w.flak.x[0] = 0; w.flak.y[0] = 1000; w.flak.z[0] = 0
    w.flak.vx[0] = 0; w.flak.vy[0] = 0; w.flak.vz[0] = 0
    w.flak.fuse[0] = DT / 2
    w.flak.team[0] = 1
    w.flak.live = 1
    w.step(DT)
    expect(foe.hp).toBeLessThan(hp0)
    expect(friend.hp).toBe(fhp0)
  })
})

describe('飛機砲塔瞄船', () => {
  /**
   * 一架貼在敵船側上方的一式陸攻。
   *
   * 【為什麼不是正上方】G4M 的砲塔是機首、機背、兩側、機尾 —— **沒有一座
   * 朝正下方**。擺在正上方的話一座都瞄不到，而那不是缺陷，是砲塔配置。
   *
   * 【為什麼貼這麼近 —— 這是刻意的】搖晃振幅 1° 在 d 公尺處的散佈是
   * `d × tan(1°)`：60 m 處是 1.05 m，而 20 mm 砲位盒的半邊長是 1.2 m ——
   * **搖晃打不出盒子，每一發都必中**。斷言因此是確定的，不是「跑二十秒
   * 看有沒有碰巧中」。
   *
   * 【那真實距離呢】實測 500 m 時砲塔選得到船、也一直在開火，但一發都打
   * 不中（8.7 m 的散佈對 2.4 m 的盒）。**這一層只有近距離才打得掉** ——
   * 那是遊戲事實，不是缺陷，但它不該混進「機制對不對」這個問題裡。
   *
   * 【位置每步抄回去】這一條問的是「會不會瞄船、打不打得掉」，不是
   * 「追不追得上」。
   */
  const AT = new Vector3(60, 55, 0)

  const build = (shipTeam: 'blue' | 'red') => {
    const w = new World()
    w.crashPolicy = () => false
    const s = fleetOf(w, SHIP_CLASSES.fletcher, shipTeam)
    const c = w.add(new Aircraft(G4M), IDLE, 'blue', AT.clone(), AT.y, 0)
    return { w, s, c }
  }

  const run = (w: World, seconds: number, c = w.combatants[0]!): void => {
    for (let i = 0; i < seconds * 240; i++) {
      c.aircraft.state.position.copy(AT)
      c.aircraft.state.velocity.set(0, 0, 0)
      w.step(DT)
    }
  }

  const gunHp = (s: Ship): number => s.guns.reduce((n, g) => n + g.hp, 0)

  it('砲塔選得到船上的砲位', () => {
    const { w, c } = build('red')
    run(w, 2)
    const aiming = c.turretStates.filter((t) => t.targetShip >= 0)
    expect(aiming.length).toBeGreaterThan(0)
    for (const t of aiming) {
      expect(t.targetIndex).toBe(-1)
      expect(t.targetGun).toBeGreaterThanOrEqual(0)
    }
  })

  /** 【必中的距離】見上面的算式 —— 這一條是確定的，不是統計的。 */
  it('一式陸攻的砲塔真的打掉敵隊船上的砲位', () => {
    const { w, s } = build('red')
    const before = gunHp(s)
    run(w, 6)
    expect(gunHp(s)).toBeLessThan(before)
    expect(s.guns.some((g) => !g.alive)).toBe(true)
  })

  it('同隊的船不會被自己的砲塔打', () => {
    const { w, s } = build('blue')
    const before = gunHp(s)
    run(w, 6)
    expect(gunHp(s)).toBe(before)
  })

  it('已經死掉的砲位不再是候選', () => {
    const { w, s } = build('red')
    for (const g of s.guns) g.alive = false
    const before = gunHp(s)
    run(w, 6)
    expect(gunHp(s)).toBe(before)
  })
})

describe('resetBattle 要把船一起重設', () => {
  const card = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard

  /**
   * 【為什麼這一條非有不可】`japan-m4` 沒有 waves，所以「再打一場」走的是
   * 就地 `resetBattle`，**不重建 World**。少了重設，第二局會是船停在上一局
   * 結束的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在空中而且會引爆
   * —— 全程不報錯。
   */
  it('船回到起點、砲位滿血、flak 池清空', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    expect(b.world.ships.length).toBe(4)
    const s = b.world.ships[0]!
    const spawn = s.position.clone()

    for (let i = 0; i < 30 * 240; i++) b.world.step(DT)
    s.guns[0]!.hp = 0
    s.guns[0]!.alive = false
    expect(s.position.distanceTo(spawn)).toBeGreaterThan(100)
    expect(b.world.flak.live).toBeGreaterThan(0)

    resetBattle(b, 1)

    expect(s.position.distanceTo(spawn)).toBeCloseTo(0, 6)
    expect(s.guns[0]!.alive).toBe(true)
    expect(s.guns[0]!.hp).toBe(SHIP_GUN_SPECS[s.guns[0]!.zone.tier].hp)
    expect(b.world.flak.live).toBe(0)
  })

  it('四艘船照艦隊座標擺開，不是全部疊在中心', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    const xs = b.world.ships.map((s) => s.position.x)
    expect(new Set(xs).size).toBe(4)
    for (const s of b.world.ships) expect(s.team).toBe('red')
  })
})
