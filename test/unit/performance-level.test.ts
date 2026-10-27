import { describe, expect, it } from 'vitest'
import { createBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH, uniform } from '../../src/battle/skirmish'
import { feeledSpec } from '../../src/battle/flightSpawn'
import { placeGround } from '../../src/battle/missionSpawns'
import {
  applyFeel, BOMBER_FEEL, feelFor, GAME_FEEL, PERFORMANCE, withPerformance, type PerformanceLevel,
} from '../../src/specs/feel'
import { B17G } from '../../src/specs/b17g'
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

  it('強化與超強真的比標準強：滾轉、升力、功率放大，重量減輕', () => {
    for (const level of BOOSTS) {
      const p = PERFORMANCE[level]
      expect(p.roll).toBeGreaterThan(1)
      expect(p.lift).toBeGreaterThan(1)
      expect(p.power).toBeGreaterThan(1)
      expect(p.mass).toBeLessThan(1)
    }
  })
})

describe('feeledSpec 帶性能等級', () => {
  it('套出來的 spec 等於手感輪廓乘上等級倍率', () => {
    const spec = feeledSpec(new Map(), P51D, undefined, 'extreme')
    expect(spec).toEqual(applyFeel(P51D, withPerformance(GAME_FEEL, 'extreme')))
  })

  it('省略等級 = 標準，與現在逐項相同', () => {
    expect(feeledSpec(new Map(), P51D, undefined)).toEqual(applyFeel(P51D, GAME_FEEL))
  })

  it('地上的飛機與天上的同一個等級（共用同一張快取）', () => {
    const world = { groundTargets: [] } as unknown as Pick<World, 'groundTargets'>
    const feeled = { blue: new Map<AircraftSpec, AircraftSpec>(), red: new Map<AircraftSpec, AircraftSpec>() }
    placeGround(world, [{ unit: 'parkedP51', team: 'blue', x: 0, z: 0, heading: 0 }], feeled, undefined, undefined, 'extreme')
    expect(world.groundTargets[0]!.airframe).toEqual(applyFeel(P51D, withPerformance(GAME_FEEL, 'extreme')))
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
      expect(c.aircraft.spec).toEqual(applyFeel(base, withPerformance(feelFor(base), 'extreme')))
      ids.add(`${c.team}:${base.id}`)
    }
    expect(ids).toEqual(new Set(['blue:p51d', 'red:b17g']))
  })
})
