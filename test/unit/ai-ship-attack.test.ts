import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { A6M5 } from '../../src/specs/a6m5'
import type { AircraftSpec } from '../../src/specs/types'
import { createCommand } from '../../src/control/Controller'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import {
  SHIP_ATTACK_RANGE, SHIP_BREAK_RANGE, createShipAim, gunWorld, hullAimWorld,
  pickShipTarget, shipAttackCommand, shipAimPoint,
} from '../../src/ai/shipAttack'

function ship(index: number, x: number, z: number, team: 'blue' | 'red' = 'red'): Ship {
  const s = createShip(index, SHIP_CLASSES.fletcher, team, x, z, 0, 0)
  s.guns = createShipGuns(SHIP_CLASSES.fletcher)
  s.gunCooldowns = new Float32Array(SHIP_CLASSES.fletcher.zones.length)
  return s
}

function at(x: number, y: number, z: number): Aircraft {
  const a = new Aircraft(P51D, y, 150)
  a.state.position.set(x, y, z)
  return a
}

describe('pickShipTarget', () => {
  const pick = (pos: Vector3, ships: Ship[], team: 'blue' | 'red' = 'blue') => {
    const aim = createShipAim()
    const ok = pickShipTarget(pos, team, ships, aim)
    return { ok, ...aim }
  }

  it('沒有船時挑不到', () => {
    expect(pick(new Vector3(0, 500, 0), []).ok).toBe(false)
  })

  it('挑最近的敵艦', () => {
    const list = [ship(0, 3000, 0), ship(1, 500, 0), ship(2, 1500, 0)]
    expect(pick(new Vector3(0, 500, 0), list).ship).toBe(1)
  })

  /**
   * 【目標是砲位不是船】掃射艦隊做的事就是打掉防空砲，而砲位也是這一期
   * 唯一打得掉的東西。瞄船體中心的話飛機會對著一塊空甲板打。
   */
  it('鎖到的是砲位，而且是最近的那一個', () => {
    const s = ship(0, 0, 0)
    const self = new Vector3(0, 300, -60)
    const got = pick(self, [s])
    expect(got.gun).toBeGreaterThanOrEqual(0)
    const d = (g: number) => self.distanceTo(gunWorld(s, g, new Vector3()))
    for (let g = 0; g < s.guns.length; g++) {
      expect(d(got.gun)).toBeLessThanOrEqual(d(g) + 1e-6)
    }
  })

  /** 【砲位打光了仍然鎖得住船體】那是魚雷的目標，也是攻擊航路的起點。 */
  it('砲位全滅時改鎖船體', () => {
    const s = ship(0, 0, 0)
    for (const g of s.guns) g.alive = false
    const got = pick(new Vector3(0, 500, 600), [s])
    expect(got.ok).toBe(true)
    expect(got.ship).toBe(0)
    expect(got.gun).toBe(-1)
  })

  it('同隊的船不是目標', () => {
    expect(pick(new Vector3(0, 500, 0), [ship(0, 500, 0, 'blue')]).ok).toBe(false)
  })

  it('沉了的船不是目標', () => {
    const s = ship(0, 500, 0)
    s.alive = false
    expect(pick(new Vector3(0, 500, 0), [s]).ok).toBe(false)
  })

  /**
   * 【射程外不去】不擋的話，開場在 20 km 外的 AI 會立刻脫離編隊、
   * 一路飛向艦隊 —— 而那一段路上它什麼都不會做。
   */
  it('超出接戰半徑就不挑', () => {
    const far = SHIP_ATTACK_RANGE + 1000
    expect(pick(new Vector3(0, 500, far), [ship(0, 0, 0)]).ok).toBe(false)
    const near = SHIP_ATTACK_RANGE - 1000
    expect(pick(new Vector3(0, 500, near), [ship(0, 0, 0)]).ship).toBe(0)
  })
})

describe('shipAimPoint', () => {
  /**
   * 【瞄的是甲板不是水線】艦體盒的原點在水線，直接瞄它等於瞄海面 ——
   * 飛機會對著水打，而且拉不起來。
   */
  it('瞄點在水線之上', () => {
    const out = new Vector3()
    shipAimPoint(ship(0, 100, -200), out)
    expect(out.y).toBeGreaterThan(0)
    expect(out.x).toBeCloseTo(100, 6)
    expect(out.z).toBeCloseTo(-200, 6)
  })
})

describe('shipAttackCommand', () => {
  const cmd = () => createCommand()

  it('遠距離時朝目標飛並開全油門', () => {
    const c = cmd()
    const self = at(0, 800, 3000)
    shipAttackCommand(self, ship(0, 0, 0), -1, c)
    // 目標在 −Z 方向且較低
    expect(c.aimWorld.z).toBeLessThan(0)
    expect(c.aimWorld.y).toBeLessThan(0)
    expect(c.aimWorld.length()).toBeCloseTo(1, 6)
    expect(c.throttle).toBeGreaterThan(0.5)
  })

  /**
   * 【一定要有脫離】不拉起來的話 AI 會直接撞進艦體 —— 而撞船現在是致命的。
   * 這一條守的是「太近就抬頭」，不是「開不開火」。
   */
  it('進到脫離半徑之內就抬頭爬升', () => {
    const c = cmd()
    const s = ship(0, 0, 0)
    // 斜距要落在脫離半徑之內：高度與距離各取半徑的六成
    const self = at(0, SHIP_BREAK_RANGE * 0.6, SHIP_BREAK_RANGE * 0.6)
    shipAttackCommand(self, s, -1, c)
    expect(c.aimWorld.y).toBeGreaterThan(0)
    expect(c.firing).toBe(false)
  })

  /** 【方向用 `shipAimPoint` 算，不要手算】瞄點在水線之上，手算會差半度。 */
  const facing = (self: Aircraft, s: Ship): void => {
    const p = shipAimPoint(s, new Vector3()).sub(self.state.position).normalize()
    self.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), p)
  }

  it('脫離半徑之外、對準了、在射程內才開火', () => {
    const s = ship(0, 0, 0)
    const aligned = cmd()
    // 斜距約 630 m：大於脫離半徑 400、小於開火距離 750
    const a = at(0, 200, 600)
    facing(a, s)
    shipAttackCommand(a, s, -1, aligned)
    expect(aligned.firing).toBe(true)

    // 同一個位置，機首偏開 90°
    const off = cmd()
    const b = at(0, 200, 600)
    b.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(1, 0, 0))
    shipAttackCommand(b, s, -1, off)
    expect(off.firing).toBe(false)
  })

  /** 【對準但太遠也不開】射程與角度是兩個獨立的條件。 */
  it('對準了但超過開火距離就不開火', () => {
    const s = ship(0, 0, 0)
    const c = cmd()
    const a = at(0, 300, 1600)
    facing(a, s)
    shipAttackCommand(a, s, -1, c)
    expect(c.firing).toBe(false)
  })

  /**
   * 【射程判準是彈丸飛不飛得到，不是一個常數】與空戰的 `shouldFire` 同一條
   * 規則：解得出攔截點，而且彈丸活得夠久飛到那裡。
   *
   * 寫死一個距離的話，槍口初速不同的機種會共用同一個射程 —— 而那個數字
   * 只對訂它的那一台成立。
   */
  it('開火距離跟著機種的槍口初速走', () => {
    const s = ship(0, 0, 0)
    // 靜止，讓接近速度不參與 —— 這一條要分離出來的是槍口初速
    const still = (spec: AircraftSpec): boolean => {
      const a = new Aircraft(spec, 300, 150)
      a.state.position.set(0, 300, 1000)
      a.state.velocity.set(0, 0, 0)
      facing(a, s)
      const c = cmd()
      shipAttackCommand(a, s, -1, c)
      return c.firing
    }
    // 斜距 1,044 m：P-51 的 .50（887 m/s）飛得到，零戰的 750 m/s 飛不到
    expect(P51D.battery.sight.muzzleVelocity)
      .toBeGreaterThan(A6M5.battery.sight.muzzleVelocity)
    expect(still(P51D)).toBe(true)
    expect(still(A6M5)).toBe(false)
  })

  it('射程外不開火', () => {
    const c = cmd()
    const s = ship(0, 0, 0)
    const a = at(0, 300, 5000)
    a.state.orientation.setFromUnitVectors(
      new Vector3(0, 0, -1), new Vector3(0, -300, -5000).normalize())
    shipAttackCommand(a, s, -1, c)
    expect(c.firing).toBe(false)
  })

  it('不修改船，也不修改自己', () => {
    const s = ship(0, 100, -200)
    const self = at(0, 800, 3000)
    const p = self.state.position.clone()
    const sp = s.position.clone()
    shipAttackCommand(self, s, -1, cmd())
    expect(self.state.position.equals(p)).toBe(true)
    expect(s.position.equals(sp)).toBe(true)
  })
})

/**
 * 艦艇價值優先。
 *
 * 【為什麼要這一組】一支艦隊的護衛幕本來就擋在主力前面。只比距離的話
 * 攻擊機永遠先咬到最外圈的驅逐艦 —— 而那不是任何一支雷擊隊會做的事：
 * 倫內爾島打的是重巡、沖繩打的是航母。
 */
describe('pickShipTarget：價值優先，同價值才比距離', () => {
  function shipOf(
    index: number, cls: 'essex' | 'wichita' | 'fletcher', x: number, z: number,
  ): Ship {
    const c = SHIP_CLASSES[cls]
    const s = createShip(index, c, 'red', x, z, 0, 0)
    s.guns = createShipGuns(c)
    s.gunCooldowns = new Float32Array(c.zones.length)
    return s
  }

  const pick = (pos: Vector3, ships: Ship[]) => {
    const aim = createShipAim()
    const ok = pickShipTarget(pos, 'blue', ships, aim)
    return { ok, ...aim }
  }

  /** 【近的驅逐艦讓給遠的航母】這一條就是負責人要的行為 */
  it('航母比較遠也仍然優先於驅逐艦', () => {
    const ships = [
      shipOf(0, 'fletcher', 0, -1000),   // 近
      shipOf(1, 'essex', 0, 0),          // 遠
    ]
    expect(pick(new Vector3(0, 150, -2500), ships).ship).toBe(1)
  })

  it('巡洋艦優先於驅逐艦', () => {
    const ships = [
      shipOf(0, 'fletcher', 0, -1000),
      shipOf(1, 'wichita', 0, 0),
    ]
    expect(pick(new Vector3(0, 150, -2500), ships).ship).toBe(1)
  })

  it('航母優先於巡洋艦', () => {
    const ships = [
      shipOf(0, 'wichita', 0, -1000),
      shipOf(1, 'essex', 0, 0),
    ]
    expect(pick(new Vector3(0, 150, -2500), ships).ship).toBe(1)
  })

  /** 【同價值才比距離】兩艘同級時仍然取近的 */
  it('兩艘同級時取近的', () => {
    const ships = [
      shipOf(0, 'fletcher', 0, 0),
      shipOf(1, 'fletcher', 0, -1500),
    ]
    expect(pick(new Vector3(0, 150, -2500), ships).ship).toBe(1)
  })

  /** 【超出接戰半徑的不算】航母太遠時退回打得到的那一艘 */
  it('航母在接戰半徑之外時，改打打得到的驅逐艦', () => {
    const far = -(SHIP_ATTACK_RANGE + 3000)
    const ships = [
      shipOf(0, 'fletcher', 0, 0),
      shipOf(1, 'essex', 0, far),
    ]
    expect(pick(new Vector3(0, 150, 0), ships).ship).toBe(0)
  })

  /** 【沉了的不算】航母沉了就換次高價值的 */
  it('航母沉了改打巡洋艦', () => {
    const ships = [
      shipOf(0, 'wichita', 0, -1000),
      shipOf(1, 'essex', 0, 0),
    ]
    ships[1]!.alive = false
    expect(pick(new Vector3(0, 150, -2500), ships).ship).toBe(0)
  })

  /** 【選中之後在那一艘上取最近的砲位】價值決定哪一艘，距離決定哪一門 */
  it('選中的那一艘上取離自己最近的砲位', () => {
    const ships = [shipOf(0, 'essex', 0, 0)]
    const p = new Vector3(0, 150, -2000)
    const got = pick(p, ships)
    expect(got.ship).toBe(0)
    expect(got.gun).toBeGreaterThanOrEqual(0)
    const chosen = p.distanceToSquared(gunWorld(ships[0]!, got.gun, new Vector3()))
    for (let g = 0; g < ships[0]!.guns.length; g++) {
      if (!ships[0]!.guns[g]!.alive) continue
      expect(p.distanceToSquared(gunWorld(ships[0]!, g, new Vector3())))
        .toBeGreaterThanOrEqual(chosen - 1e-6)
    }
  })
})

/**
 * 砲位打光之後掃射船體：瞄的是艦級命中盒產生的瞄點，不是船心。
 *
 * 驅逐艦停在原點、艏向 0：三個瞄點在甲板上 z ≈ −38.3、0、+38.3。
 */
describe('砲位全滅之後瞄船體上的瞄點', () => {
  const gunless = (): Ship => {
    const s = ship(0, 0, 0)
    for (const g of s.guns) g.alive = false
    return s
  }
  const worldZ = (s: Ship, k: number): number => hullAimWorld(s, k, new Vector3()).z

  it('挑的是前方最近的那一點，不是船心', () => {
    const s = gunless()
    const aim = createShipAim()
    pickShipTarget(new Vector3(0, 300, -600), 'blue', [s], aim, new Vector3(0, 0, 150))
    expect(aim.gun).toBe(-1)
    expect(aim.point).toBeGreaterThanOrEqual(0)
    expect(worldZ(s, aim.point)).toBeCloseTo(-38.27, 1)
  })

  /** 【一趟之內不換點】點之間隔 50 m 以內，每個決策拍取最近的話瞄點會來回跳 */
  it('還在前方就維持同一點，即使別的點變得比較近', () => {
    const s = gunless()
    const aim = createShipAim()
    const vel = new Vector3(150, 0, 0)
    pickShipTarget(new Vector3(-400, 300, -60), 'blue', [s], aim, vel)
    const first = aim.point
    expect(worldZ(s, first)).toBeCloseTo(-38.27, 1)
    pickShipTarget(new Vector3(-400, 300, 60), 'blue', [s], aim, vel)
    expect(aim.point).toBe(first)
  })

  it('飛越之後換成前方的下一點', () => {
    const s = gunless()
    const aim = createShipAim()
    const vel = new Vector3(0, 0, 150)
    pickShipTarget(new Vector3(0, 300, -600), 'blue', [s], aim, vel)
    pickShipTarget(new Vector3(0, 300, 20), 'blue', [s], aim, vel)
    expect(worldZ(s, aim.point)).toBeCloseTo(38.27, 1)
  })

  it('前方一個點都沒有時取最近的', () => {
    const s = gunless()
    const aim = createShipAim()
    pickShipTarget(new Vector3(0, 300, 400), 'blue', [s], aim, new Vector3(0, 0, 150))
    expect(worldZ(s, aim.point)).toBeCloseTo(38.27, 1)
  })

  it('砲位還活著時不挑瞄點', () => {
    const aim = createShipAim()
    pickShipTarget(new Vector3(0, 300, -600), 'blue', [ship(0, 0, 0)], aim, new Vector3(0, 0, 150))
    expect(aim.gun).toBeGreaterThanOrEqual(0)
    expect(aim.point).toBe(-1)
  })

  it('掃射指令朝那一點飛', () => {
    const s = gunless()
    const self = at(0, 800, 3000)
    const c = createCommand()
    shipAttackCommand(self, s, -1, c, 2)
    const want = hullAimWorld(s, 2, new Vector3()).sub(self.state.position).normalize()
    expect(c.aimWorld.distanceTo(want)).toBeLessThan(1e-6)
  })
})
