import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { SHIP_GUN_SPECS, createShipGuns, shipOwner } from '../../src/world/shipGuns'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { NO_PENETRATION_DAMAGE } from '../../src/weapons/armour'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { G4M } from '../../src/specs/g4m'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { createBattle, resetBattle, stepBattle } from '../../src/battle/setup'
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
/**
 * @param caliber 預設 200 mm —— **打得穿場上每一種艦體**，所以這幾條驗的是
 *   判定本身，不是口徑門檻。門檻另有一組（`weapons/armour.ts`）
 */
function shoot(
  w: World, from: Vector3, at: Vector3, damage: number,
  owner = 0, team = 0, caliber = 200,
): void {
  const v = at.clone().sub(from).normalize().multiplyScalar(400)
  const i = w.projectiles.spawn(
    from.x, from.y, from.z, v.x, v.y, v.z, damage, owner, team, PROJECTILE_LIFETIME, caliber,
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

  /**
   * 【口徑打不穿艦體就只扣地板值，但砲位照全額】掃射軍艦的意義是打掉甲板上
   * 的防空砲，不是打沉它。少了這一條，十六架零戰用機槍就能把一艘航母掃沉
   * （實測六十秒 60,032 點，正好是它的全部血量）。
   */
  it('步槍口徑打不動驅逐艦的艦體，砲位照樣扣', () => {
    const w = new World()
    const s = fleetOf(w)
    const g = s.guns[0]!
    const hp0 = s.hp
    const p = gunAt(s, 0)
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 30, 0, 0, 7.7)
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp - 30)
    expect(hp0 - s.hp).toBe(NO_PENETRATION_DAMAGE)
  })

  /** 【驅逐艦擋不住 20 mm】它沒有裝甲帶，船殼是半吋級的鋼板 */
  it('20 mm 打得動驅逐艦的艦體', () => {
    const w = new World()
    const s = fleetOf(w)
    const hp0 = s.hp
    const p = gunAt(s, 0)
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 30, 0, 0, 20)
    expect(hp0 - s.hp).toBe(30)
  })

  /** 【航母擋得住場上每一挺航空機砲】最大的是 30 mm，而它的裝甲是 76 mm */
  it('30 mm 打不動航母的艦體', () => {
    const w = new World()
    const s = fleetOf(w, SHIP_CLASSES.essex)
    const hp0 = s.hp
    const p = gunAt(s, 0)
    shoot(w, p.clone().add(new Vector3(0, 40, 0)), p, 100, 0, 0, 30)
    expect(hp0 - s.hp).toBe(NO_PENETRATION_DAMAGE)
    expect(s.guns[0]!.hp).toBe(SHIP_GUN_SPECS[s.guns[0]!.zone.tier].hp - 100)
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
   * 【盒子要消失】打掉的砲位是一個洞，不是還會擋子彈的殘骸。
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

  /**
   * 【必中的距離】見上面的算式 —— 這一條是確定的，不是統計的。
   *
   * 【只驗「傷害落在砲位上」，不驗「幾秒打得掉」】
   *
   * 這一條原本還斷言「跑 40 秒之後至少一個砲位死掉」。那是一條**平衡斷言
   * 假扮成接線斷言**：能不能在 N 秒內打掉一個砲位，是
   * `WeaponSpec.damage` × `roundsPerMinute` × `TURRET_DAMAGE_SCALE` 對
   * `SHIP_GUN_SPECS.hp` 的比值，四個數字任何一個被調整它就紅 —— 而那時
   * 紅的不是缺陷，是有人在調手感。實測 `TURRET_DAMAGE_SCALE` 由 0.9375
   * 砍到 0.46875 之後，同一個砲位 80 秒只掉 220 點（血量 300）。
   *
   * **「打得掉」這件事已經由三條各自獨立的機制測試涵蓋**：
   *
   * ```
   *   砲塔選得到砲位        上面那一條
   *   彈丸打中砲位會扣血    「彈丸打船 > 打中砲位：砲位與船同時扣血」
   *   血歸零就死、盒消失    「彈丸打船 > 砲位血量歸零之後就死了」
   * ```
   *
   * 三條合起來就蘊含「打久了會掉」，而且**沒有一條會因為調數值而紅**。
   */
  it('一式陸攻的砲塔真的打得到敵隊船上的砲位', () => {
    const { w, s } = build('red')
    const before = gunHp(s)
    run(w, 6)
    expect(gunHp(s)).toBeLessThan(before)
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

const card = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard

describe('resetBattle 要把船一起重設', () => {

  /**
   * 【為什麼這一條非有不可】`japan-m4` 沒有 waves，所以「再打一場」走的是
   * 就地 `resetBattle`，**不重建 World**。少了重設，第二局會是船停在上一局
   * 結束的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在空中而且會引爆
   * —— 全程不報錯。
   */
  it('船回到起點、砲位滿血、flak 池清空', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    expect(b.world.ships.length).toBe(8)
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

  it('八艘船照艦隊座標擺開，不是全部疊在中心', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    const key = (s: { position: { x: number; z: number } }) => `${s.position.x},${s.position.z}`
    expect(new Set(b.world.ships.map(key)).size).toBe(8)
    for (const s of b.world.ships) expect(s.team).toBe('red')
  })
})

describe('擊沉', () => {
  const sink = (w: World, s: Ship): void => {
    const hull = s.cls.hull[0]!
    const p = hull.center.clone().add(s.position)
    // 【一發打完】用一發超大傷害，這一條問的是「歸零之後會怎樣」，
    // 不是「打幾發才沉」——後者是魚雷那一支分支的事。
    shoot(w, p.clone().add(new Vector3(0, 60, 0)), p, 1_000_000)
  }

  it('血量歸零 → 整艘退場，砲位全部跟著死', () => {
    const w = new World()
    const s = fleetOf(w)
    expect(s.alive).toBe(true)
    sink(w, s)
    expect(s.hp).toBeLessThanOrEqual(0)
    expect(s.alive).toBe(false)
    for (const g of s.guns) expect(g.alive).toBe(false)
  })

  /**
   * 【砲位一定要一起標死】不標的話 `stepShipGuns` 整艘早退、槍焰的計時器
   * 停在最後一個值，渲染層會畫出一排**永遠亮著的槍焰掛在沉船上**。
   */
  it('沉了之後不再開火', () => {
    const w = new World()
    const s = fleetOf(w)
    sink(w, s)
    const before = w.projectiles.live
    const c = w.add(new Aircraft(P51D), IDLE, 'blue', new Vector3(0, 600, 0), 600, 0)
    for (let i = 0; i < 5 * 240; i++) {
      c.aircraft.state.position.set(0, 600, 0)
      w.step(DT)
    }
    expect(w.projectiles.live).toBe(before)
  })

  /**
   * 【沉了要滑行到停，不是煞停】一萬噸的船在同一個物理步內從 8 m/s 變成 0，
   * 畫面上像撞到牆。
   */
  it('沉了之後滑行到停，不是原地煞停', () => {
    const w = new World()
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
    s.guns = createShipGuns(SHIP_CLASSES.fletcher)
    s.gunCooldowns = new Float32Array(SHIP_CLASSES.fletcher.zones.length)
    w.ships.push(s)
    sink(w, s)
    const at = s.position.clone()
    for (let i = 0; i < 5 * 240; i++) w.step(DT)
    // 還在動，但已經慢下來了
    expect(s.position.distanceTo(at)).toBeGreaterThan(1)
    expect(s.speed).toBeGreaterThan(0)
    expect(s.speed).toBeLessThan(8)

    // 再跑一分鐘就停住，而且停住之後真的不動
    for (let i = 0; i < 60 * 240; i++) w.step(DT)
    expect(s.speed).toBe(0)
    const rest = s.position.clone()
    for (let i = 0; i < 5 * 240; i++) w.step(DT)
    expect(s.position.distanceTo(rest)).toBe(0)
  })

  it('沉了之後不再擋子彈', () => {
    const w = new World()
    const s = fleetOf(w)
    sink(w, s)
    const hull = s.cls.hull[0]!
    const p = hull.center.clone()
    const hpAfter = s.hp
    shoot(w, p.clone().add(new Vector3(0, 60, 0)), p, 50)
    expect(s.hp).toBe(hpAfter)
  })

  it('resetBattle 之後浮回來', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    const s = b.world.ships[0]!
    s.hp = 0
    s.alive = false
    for (const g of s.guns) g.alive = false
    resetBattle(b, 1)
    expect(s.alive).toBe(true)
    expect(s.hp).toBe(s.cls.hp)
    for (const g of s.guns) expect(g.alive).toBe(true)
  })

  /** 【任務規則】japan-m4 的目標是擊沉任意四艘。 */
  it('japan-m4 的規則是擊沉四艘', () => {
    const r = missionConfigFrom(card).rules
    expect(r.kind).toBe('sink')
    if (r.kind === 'sink') expect(r.count).toBe(4)
  })

  it('打沉四艘就判勝', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    expect(b.mission.outcome).toBe('fighting')
    for (const s of b.world.ships.slice(0, 4)) {
      s.hp = 0
      s.alive = false
      for (const g of s.guns) g.alive = false
    }
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('victory')
  })
})

describe('AI 飛行員的對艦索敵', () => {
  /**
   * 一架 P-51D 在敵艦上方、場上沒有任何敵機。
   *
   * 【為什麼用 P-51D】它有固定槍，所以「開火」那一段也驗得到。一式陸攻
   * 同樣會被派去（索敵不看武器），只是它的傷害由砲塔那一側造成。
   */
  const build = (shipTeam: 'blue' | 'red') => {
    const w = new World()
    w.crashPolicy = () => false
    const s = fleetOf(w, SHIP_CLASSES.fletcher, shipTeam)
    const ai = new AiController()
    const c = w.add(new Aircraft(P51D), ai, 'blue', new Vector3(0, 900, 2500), 900, 150)
    const board = createTargetBoard([c])
    ai.board = board
    ai.selfIndex = 0
    ai.ships = w.ships
    return { w, s, c, ai }
  }

  it('沒有空中目標時會鎖定敵艦上的砲位', () => {
    const { w, ai } = build('red')
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(ai.shipAim.ship).toBe(0)
    // 【鎖到的是砲位，不是船】瞄船體中心的話會對著一塊空甲板打
    expect(ai.shipAim.gun).toBeGreaterThanOrEqual(0)
  })

  /**
   * 【索敵不看武器】用「有沒有固定掛架」擋的話，一式陸攻在天上沒有敵機
   * 之後會直直平飛 —— 而它低空掠過去時，銃手是打得到砲位的。
   */
  it('沒有固定槍的一式陸攻同樣會被派去打船', () => {
    const w = new World()
    w.crashPolicy = () => false
    fleetOf(w, SHIP_CLASSES.fletcher, 'red')
    const ai = new AiController()
    const c = w.add(new Aircraft(G4M), ai, 'blue', new Vector3(0, 900, 2500), 900, 150)
    ai.board = createTargetBoard([c])
    ai.selfIndex = 0
    ai.ships = w.ships
    const before = c.aircraft.state.position.distanceTo(w.ships[0]!.position)
    for (let i = 0; i < 12 * 240; i++) w.step(DT)
    expect(ai.shipAim.ship).toBe(0)
    expect(c.aircraft.state.position.distanceTo(w.ships[0]!.position)).toBeLessThan(before - 500)
  })

  /** 【砲位被打掉就換一個】不換的話會一直瞄一個已經不存在的東西。 */
  it('鎖定的砲位死了就改瞄別的', () => {
    const { w, s, ai } = build('red')
    for (let i = 0; i < 240; i++) w.step(DT)
    const first = ai.shipAim.gun
    expect(first).toBeGreaterThanOrEqual(0)
    s.guns[first]!.alive = false
    for (let i = 0; i < 60; i++) w.step(DT)
    expect(ai.shipAim.gun).not.toBe(first)
  })

  it('同隊的船不會被鎖定', () => {
    const { w, ai } = build('blue')
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(ai.shipAim.ship).toBe(-1)
  })

  /** 【真的會飛過去】不是只有選到而已。 */
  it('會朝敵艦接近', () => {
    const { w, c, s } = build('red')
    const before = c.aircraft.state.position.distanceTo(s.position)
    for (let i = 0; i < 12 * 240; i++) w.step(DT)
    expect(c.aircraft.state.position.distanceTo(s.position)).toBeLessThan(before - 500)
  })

  /**
   * 【一定要拉得起來】撞船是致命的，而 `applySafety` 看的是地形與海面、
   * 不是船。少了 `SHIP_BREAK_RANGE` 那一段，這一條會紅。
   */
  it('掃射之後拉得起來，不會撞上去', () => {
    const { w, c } = build('red')
    for (let i = 0; i < 40 * 240; i++) w.step(DT)
    expect(c.alive).toBe(true)
  })

  it('船沉了就放掉目標', () => {
    const { w, s, ai } = build('red')
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(ai.shipAim.ship).toBe(0)
    s.alive = false
    for (const g of s.guns) g.alive = false
    w.step(DT)
    expect(ai.shipAim.ship).toBe(-1)
  })
})
