import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { G4M } from '../../src/specs/g4m'
import { createCommand } from '../../src/control/Controller'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import {
  SHIP_ATTACK_RANGE, SHIP_BREAK_RANGE, canAttackShips,
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

describe('canAttackShips', () => {
  /**
   * 【沒有固定掛架就不去】一式陸攻的武器全是 AI 砲塔（`mounts` 是空陣列），
   * 它飛到船上方也**射不出任何東西**。少了這道閘，japan-m4 的五架僚機會
   * 排隊飛向艦隊、在彈幕裡繞圈、什麼都做不到。
   */
  it('有固定掛架的才去打船', () => {
    expect(canAttackShips(P51D)).toBe(true)
    expect(canAttackShips(G4M)).toBe(false)
  })
})

describe('pickShipTarget', () => {
  it('沒有船時回 −1', () => {
    expect(pickShipTarget(new Vector3(0, 500, 0), 'blue', [])).toBe(-1)
  })

  it('挑最近的敵艦', () => {
    const list = [ship(0, 3000, 0), ship(1, 500, 0), ship(2, 1500, 0)]
    expect(pickShipTarget(new Vector3(0, 500, 0), 'blue', list)).toBe(1)
  })

  it('同隊的船不是目標', () => {
    expect(pickShipTarget(new Vector3(0, 500, 0), 'blue', [ship(0, 500, 0, 'blue')])).toBe(-1)
  })

  it('沉了的船不是目標', () => {
    const s = ship(0, 500, 0)
    s.alive = false
    expect(pickShipTarget(new Vector3(0, 500, 0), 'blue', [s])).toBe(-1)
  })

  /**
   * 【射程外不去】不擋的話，開場在 20 km 外的 AI 會立刻脫離編隊、
   * 一路飛向艦隊 —— 而那一段路上它什麼都不會做。
   */
  it('超出接戰半徑就不挑', () => {
    const far = SHIP_ATTACK_RANGE + 1000
    expect(pickShipTarget(new Vector3(0, 500, far), 'blue', [ship(0, 0, 0)])).toBe(-1)
    const near = SHIP_ATTACK_RANGE - 1000
    expect(pickShipTarget(new Vector3(0, 500, near), 'blue', [ship(0, 0, 0)])).toBe(0)
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
    shipAttackCommand(self, ship(0, 0, 0), c)
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
    const self = at(0, 120, SHIP_BREAK_RANGE - 50)
    shipAttackCommand(self, s, c)
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
    shipAttackCommand(a, s, aligned)
    expect(aligned.firing).toBe(true)

    // 同一個位置，機首偏開 90°
    const off = cmd()
    const b = at(0, 200, 600)
    b.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(1, 0, 0))
    shipAttackCommand(b, s, off)
    expect(off.firing).toBe(false)
  })

  /** 【對準但太遠也不開】射程與角度是兩個獨立的條件。 */
  it('對準了但超過開火距離就不開火', () => {
    const s = ship(0, 0, 0)
    const c = cmd()
    const a = at(0, 300, 900)
    facing(a, s)
    shipAttackCommand(a, s, c)
    expect(c.firing).toBe(false)
  })

  it('射程外不開火', () => {
    const c = cmd()
    const s = ship(0, 0, 0)
    const a = at(0, 300, 5000)
    a.state.orientation.setFromUnitVectors(
      new Vector3(0, 0, -1), new Vector3(0, -300, -5000).normalize())
    shipAttackCommand(a, s, c)
    expect(c.firing).toBe(false)
  })

  it('不修改船，也不修改自己', () => {
    const s = ship(0, 100, -200)
    const self = at(0, 800, 3000)
    const p = self.state.position.clone()
    const sp = s.position.clone()
    shipAttackCommand(self, s, cmd())
    expect(self.state.position.equals(p)).toBe(true)
    expect(s.position.equals(sp)).toBe(true)
  })
})
