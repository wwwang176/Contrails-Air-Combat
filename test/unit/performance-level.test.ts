import { describe, expect, it } from 'vitest'
import { createBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH, uniform } from '../../src/battle/skirmish'
import { feeledSpec } from '../../src/battle/flightSpawn'
import { placeGround } from '../../src/battle/missionSpawns'
import {
  applyFeel, BOMBER_FEEL, feelFor, GAME_FEEL, holdCeiling, PERFORMANCE, withPerformance, type PerformanceLevel,
} from '../../src/specs/feel'
import { maxClimbRate, serviceCeiling } from '../../src/analysis/envelope'
import { atmosphere } from '../../src/physics/atmosphere'
import { enginePower, WEP_THROTTLE } from '../../src/physics/propulsion'
import type { AirData } from '../../src/physics/types'

const airAt = (): AirData => ({ density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })
import { B17G } from '../../src/specs/b17g'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import type { AircraftSpec } from '../../src/specs/types'
import type { World } from '../../src/world/World'

/**
 * # 遭遇戰的飛機性能等級
 *
 * 疊在手感輪廓上的第二層倍率。標準段不改任何東西；強化與超強只動滾轉、升力、
 * 重量、功率與阻力，而功率與阻力同倍率（極速不動）。
 */

const idle = { update() {} }
const BOOSTS: readonly PerformanceLevel[] = ['boosted', 'extreme']

/** 手感輪廓乘上等級倍率、還沒壓升限的 spec */
const boosted = (base: AircraftSpec, level: PerformanceLevel): AircraftSpec =>
  applyFeel(base, withPerformance(feelFor(base), level))

/** 套過等級的 spec：除了壓升限的 `altitudeLoss` 之外與 `boosted` 相同，而且真的有壓 */
function expectLeveled(spec: AircraftSpec | null | undefined, base: AircraftSpec, level: PerformanceLevel): void {
  expect(spec?.engine.altitudeLoss).toBeGreaterThan(0)
  expect({ ...spec, engine: { ...spec!.engine, altitudeLoss: undefined } }).toEqual(boosted(base, level))
}

describe('withPerformance', () => {
  it('標準段回傳同一個輪廓物件', () => {
    expect(withPerformance(GAME_FEEL, 'standard')).toBe(GAME_FEEL)
    expect(withPerformance(BOMBER_FEEL, 'standard')).toBe(BOMBER_FEEL)
  })

  for (const level of BOOSTS) {
    it(`${level}：五項照倍率乘，oswald 不動，功率與阻力同倍率`, () => {
      const p = PERFORMANCE[level]
      for (const feel of [GAME_FEEL, BOMBER_FEEL]) {
        const f = withPerformance(feel, level)
        expect(f.roll).toBe(feel.roll * p.roll)
        expect(f.lift).toBe(feel.lift * p.lift)
        expect(f.mass).toBe(feel.mass * p.mass)
        expect(f.power).toBe(feel.power * p.power)
        expect(f.cd0).toBe(feel.cd0 * p.power)
        expect(f.oswald).toBe(feel.oswald)
      }
    })
  }

  it('一段比一段強：滾轉、升力、功率逐段放大，重量逐段減輕', () => {
    const [s, b, e] = (['standard', 'boosted', 'extreme'] as const).map((l) => PERFORMANCE[l])
    expect(s).toEqual({ roll: 1, lift: 1, mass: 1, power: 1 })
    for (const k of ['roll', 'lift', 'power'] as const) {
      expect(b![k]).toBeGreaterThan(s![k])
      expect(e![k]).toBeGreaterThan(b![k])
    }
    expect(b!.mass).toBeLessThan(s!.mass)
    expect(e!.mass).toBeLessThan(b!.mass)
  })
})

describe('feeledSpec 帶性能等級', () => {
  it('套出來的 spec 等於手感輪廓乘上等級倍率，再壓升限', () => {
    expectLeveled(feeledSpec(new Map(), P51D, undefined, 'extreme'), P51D, 'extreme')
  })

  it('省略等級 = 標準，與現在逐項相同', () => {
    expect(feeledSpec(new Map(), P51D, undefined)).toEqual(applyFeel(P51D, GAME_FEEL))
  })

  it('地上的飛機與天上的同一個等級（共用同一張快取）', () => {
    const world = { groundTargets: [] } as unknown as Pick<World, 'groundTargets'>
    const feeled = { blue: new Map<AircraftSpec, AircraftSpec>(), red: new Map<AircraftSpec, AircraftSpec>() }
    placeGround(world, [{ unit: 'parkedP51', team: 'blue', x: 0, z: 0, heading: 0 }], feeled, undefined, undefined, 'extreme')
    expectLeveled(world.groundTargets[0]!.airframe, P51D, 'extreme')
  })
})

describe('遭遇戰設定 → 戰鬥設定', () => {
  it('預設是標準', () => {
    expect(DEFAULT_SKIRMISH.performance).toBe('standard')
    expect(battleConfigFrom(DEFAULT_SKIRMISH).performance).toBe('standard')
  })

  it('選了哪一段就帶哪一段', () => {
    for (const level of BOOSTS) {
      expect(battleConfigFrom({ ...DEFAULT_SKIRMISH, performance: level }).performance).toBe(level)
    }
  })

  it('不是三段之一就落回標準', () => {
    const bad = { ...DEFAULT_SKIRMISH, performance: 'turbo' as PerformanceLevel }
    expect(battleConfigFrom(bad).performance).toBe('standard')
  })
})

describe('建場：敵我全部飛機一起套', () => {
  it('超強段：戰鬥機與轟炸機、兩隊都是乘過等級倍率的 spec', () => {
    const setup = { ...uniform(P51D.id, 2, B17G.id, 2), performance: 'extreme' as const }
    const b = createBattle(idle, battleConfigFrom(setup), 1)
    const ids = new Set<string>()
    for (const c of b.world.combatants) {
      const base = c.aircraft.spec.id === B17G.id ? B17G : P51D
      expectLeveled(c.aircraft.spec, base, 'extreme')
      ids.add(`${c.team}:${base.id}`)
    }
    expect(ids).toEqual(new Set(['blue:p51d', 'red:b17g']))
  })

  it('建場時地上的飛機也拿到同一個等級', () => {
    // 天上不放 P-51：快取裡的 P-51 只能由地上那一架寫進去
    const cfg = {
      ...battleConfigFrom({ ...uniform(BF109K4.id, 1, BF109K4.id, 1), performance: 'extreme' as const }),
      ground: [{ unit: 'parkedP51' as const, team: 'blue' as const, x: 0, z: 0, heading: 0 }],
    }
    const b = createBattle(idle, cfg, 1)
    const parked = b.world.groundTargets.find((t) => t.airframe !== null && t.airframe !== undefined)
    expectLeveled(parked?.airframe, P51D, 'extreme')
  })
})

describe('升限照標準段', () => {
  for (const base of [P51D, B17G]) {
    for (const level of BOOSTS) {
      it(`${base.id}/${level}：升限等於標準段，3,000 m 的爬升率與沒壓之前相同`, () => {
        const target = serviceCeiling(applyFeel(base, feelFor(base)))
        const held = holdCeiling(boosted(base, level), target)
        expect(serviceCeiling(boosted(base, level))).toBeGreaterThan(target + 500)
        expect(Math.abs(serviceCeiling(held) - target)).toBeLessThan(5)
        expect(maxClimbRate(held, 3000).rate).toBe(maxClimbRate(boosted(base, level), 3000).rate)
      })
    }
  }

  it('本來就到不了那個高度：原樣回傳', () => {
    const spec = applyFeel(P51D, GAME_FEEL)
    expect(holdCeiling(spec, serviceCeiling(spec) + 1000)).toBe(spec)
  })
})

describe('enginePower 的額外掉力', () => {
  const spec = applyFeel(P51D, GAME_FEEL)
  const top = Math.max(...spec.engine.gears.map((g) => g.altCritical))
  const lossy = { ...spec, engine: { ...spec.engine, altitudeLoss: 1 } }
  const power = (s: AircraftSpec, h: number): number => enginePower(s, atmosphere(h, airAt()), 0, WEP_THROTTLE)

  it('最高一檔臨界高度以下逐位元不動', () => {
    for (const h of [0, 1500, 3000, top - 10]) expect(power(lossy, h)).toBe(power(spec, h))
  })

  it('以上越高掉越多，臨界高度處連續', () => {
    expect(power(lossy, top + 1) / power(spec, top + 1)).toBeGreaterThan(0.9995)
    for (const h of [top + 2000, top + 6000]) expect(power(lossy, h)).toBeLessThan(power(spec, h))
    expect(power(lossy, top + 6000) / power(spec, top + 6000)).toBeLessThan(power(lossy, top + 2000) / power(spec, top + 2000))
  })
})
