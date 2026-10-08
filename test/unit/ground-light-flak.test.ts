import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createGroundBattery, GROUND_FLAK_SPEC, GROUND_LIGHT_FLAK_SPEC, GROUND_M16_SPEC, shipOwner, stepGunPlatform,
} from '../../src/world/shipGuns'
import { createGroundTarget } from '../../src/world/groundTargets'
import { Projectiles } from '../../src/world/Projectiles'
import { createFlak } from '../../src/world/flak'
import { createBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import type { TurretCombatant } from '../../src/world/turrets'
import type { Controller } from '../../src/control/Controller'

function target(index: number, x: number, y: number, z: number): TurretCombatant {
  return {
    index, team: 'blue', alive: true, hp: 100,
    aircraft: {
      spec: { turrets: [] },
      state: { position: new Vector3(x, y, z), velocity: new Vector3(0, 0, 0), orientation: new Quaternion() },
    },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

/**
 * # 輕型陸砲 —— 走彈丸池、有曳光
 *
 * 與重高砲同一支射控，差別是 tier：`autocannon` 進 `Projectiles`，
 * 渲染層因此畫得到曳光。這一份守規格與接線，強弱由試玩裁定。
 */
describe('輕型陸砲', () => {
  it('掛的是 autocannon 那一層：彈丸進池、不進高砲彈、彈丸真的在飛', () => {
    const t = createGroundTarget(3, 'flakLight', 'red', 0, 0, 0)
    t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', GROUND_LIGHT_FLAK_SPEC.caliber)
    const p = new Projectiles(512)
    const flak = createFlak()
    const dt = 1 / 240
    for (let i = 0; i < 3 * 240; i++) {
      stepGunPlatform(t, [target(0, 0, 1500, -800)], p, flak, i * dt, dt, [t])
    }
    expect(p.live).toBeGreaterThan(0)
    expect(flak.live).toBe(0)
    expect(t.guns[0]!.zone.calibreMm).toBe(GROUND_LIGHT_FLAK_SPEC.caliber)
    expect(t.guns[0]!.hp).toBe(GROUND_LIGHT_FLAK_SPEC.hp)
    // 【不只數 live】owner 寫錯成 −1 的話 live 照加，但彈丸不推進也不畫
    let k = -1
    for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1) { k = i; break }
    expect(k).toBeGreaterThanOrEqual(0)
    expect(p.owner[k]).toBe(shipOwner(3))
    expect(p.team[k]).toBe(1)
    expect(p.caliber[k]).toBe(GROUND_LIGHT_FLAK_SPEC.caliber)
    const y0 = p.y[k]!
    p.step(dt)
    expect(p.y[k]).not.toBe(y0)
  })

  it('射程約 2.6 km：2,400 m 開火、3,000 m 不開', () => {
    const near = createGroundTarget(0, 'flakLight', 'red', 0, 0, 0)
    near.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', GROUND_LIGHT_FLAK_SPEC.caliber)
    const far = createGroundTarget(1, 'flakLight', 'red', 0, 0, 0)
    far.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', GROUND_LIGHT_FLAK_SPEC.caliber)
    const dt = 1 / 240
    const pn = new Projectiles(512)
    const pf = new Projectiles(512)
    const flak = createFlak()
    for (let i = 0; i < 3 * 240; i++) {
      stepGunPlatform(near, [target(0, 0, 1500, -1800)], pn, flak, i * dt, dt, [near])
      stepGunPlatform(far, [target(0, 0, 1500, -2600)], pf, flak, i * dt, dt, [far])
    }
    expect(pn.live).toBeGreaterThan(0)
    expect(pf.live).toBe(0)
  })

  /**
   * 【藍隊的陸砲打紅隊的飛機】勒熱夫是德軍守、蘇軍攻：德軍（藍）的 Flak 38 要打 Yak，蘇軍（紅）的
   * 要打 Ju 87。目標只看「與砲位不同隊」，不看哪一隊是玩家
   */
  it('藍隊的輕砲打紅隊的飛機、不打藍隊的；紅隊的輕砲反過來', () => {
    const run = (platform: 'blue' | 'red', victim: 'blue' | 'red'): { live: number; team: number } => {
      const t = createGroundTarget(0, 'flakLight', platform, 0, 0, 0)
      t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', GROUND_LIGHT_FLAK_SPEC.caliber)
      const p = new Projectiles(512)
      const flak = createFlak()
      const dt = 1 / 240
      const v = target(0, 0, 1500, -800)
      ;(v as { team: 'blue' | 'red' }).team = victim
      for (let i = 0; i < 3 * 240; i++) stepGunPlatform(t, [v], p, flak, i * dt, dt, [t])
      let team = -1
      for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1) { team = p.team[i]!; break }
      return { live: p.live, team }
    }
    const blueVsRed = run('blue', 'red')
    expect(blueVsRed.live).toBeGreaterThan(0)
    expect(blueVsRed.team).toBe(0)
    expect(run('blue', 'blue').live).toBe(0)
    const redVsBlue = run('red', 'blue')
    expect(redVsBlue.live).toBeGreaterThan(0)
    expect(redVsBlue.team).toBe(1)
    expect(run('red', 'red').live).toBe(0)
  })

  /**
   * 【M16 能平射】四聯 .50 的砲架壓得到水平以下，掃射的飛機逃不掉；Flak 38 那一份
   * 仍是仰角 25° 以上。仰角 8° 的目標 M16 開火、Flak 38 不開；仰角 3° 兩者都不開
   */
  it('M16 打得到仰角 5° 以上的低空目標，Flak 38 只打 25° 以上', () => {
    const fire = (spec: typeof GROUND_LIGHT_FLAK_SPEC, y: number, z: number): number => {
      const t = createGroundTarget(0, 'usFlakTrack', 'red', 0, 0, 0)
      t.guns = createGroundBattery(spec, 'autocannon', spec.caliber)
      const p = new Projectiles(512)
      const flak = createFlak()
      const dt = 1 / 240
      for (let i = 0; i < 3 * 240; i++) stepGunPlatform(t, [target(0, 0, y, z)], p, flak, i * dt, dt, [t])
      return p.live
    }
    // 仰角 atan(100 / 700) ≈ 8.1°
    expect(fire(GROUND_M16_SPEC, 100, -700)).toBeGreaterThan(0)
    expect(fire(GROUND_LIGHT_FLAK_SPEC, 100, -700)).toBe(0)
    // 仰角 atan(40 / 800) ≈ 2.9°
    expect(fire(GROUND_M16_SPEC, 40, -800)).toBe(0)
  })

  it('省略 tier 仍是重高砲', () => {
    const g = createGroundBattery()
    expect(g[0]!.zone.tier).toBe('flak')
    expect(g[0]!.zone.calibreMm).toBe(88)
    expect(g[0]!.spec).toBe(GROUND_FLAK_SPEC)
  })

  it('placeGround 對 flakLight 掛輕砲、對 flakHeavy／usFlakHeavy 掛重砲、其餘不掛', () => {
    const IDLE: Controller = { update() {} }
    const cfg: BattleConfig = {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, B17G, 1, P51D, 1),
      ground: [
        { unit: 'flakLight', team: 'red', x: 0, z: -6000, heading: 0 },
        { unit: 'flakHeavy', team: 'red', x: 100, z: -6000, heading: 0 },
        { unit: 'truck', team: 'red', x: 200, z: -6000, heading: 0 },
        { unit: 'usFlakTrack', team: 'red', x: 300, z: -6000, heading: 0 },
        { unit: 'usFlakHeavy', team: 'red', x: 400, z: -6000, heading: 0 },
        { unit: 'truck', team: 'red', x: 500, z: -6000, heading: 0, guns: 'mg' },
      ],
    }
    const b = createBattle(IDLE, cfg, 1)
    const [light, heavy, truck, m16, us90, roof] = b.world.groundTargets
    // 【開火聲各是一種】SPEC `2026-10-09-gun-sounds-design.md`：重高砲、陸上四聯 20 mm、M16、車頂 .50
    expect([heavy, us90, light, m16, roof].map((t) => t!.guns[0]!.zone.sound))
      .toEqual(['heavyFlak', 'heavyFlak', 'lightFlak20', 'quad50', 'roof50'])
    // 【美軍 90 mm 與 Flak 18 同一條重砲路徑】吃同一份逐關複寫的 `flakSpec`
    expect(us90!.guns[0]!.zone.tier).toBe('flak')
    expect(us90!.guns[0]!.spec).toBe(heavy!.guns[0]!.spec)
    expect(light!.guns[0]!.spec).toBe(GROUND_LIGHT_FLAK_SPEC)
    expect(light!.guns[0]!.zone.tier).toBe('autocannon')
    expect(m16!.guns[0]!.spec).toBe(GROUND_M16_SPEC)
    expect(m16!.guns[0]!.zone.tier).toBe('autocannon')
    expect(heavy!.guns[0]!.zone.tier).toBe('flak')
    expect(truck!.guns).toHaveLength(0)
  })
})
