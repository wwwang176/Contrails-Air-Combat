import { describe, expect, it } from 'vitest'
import { MISSIONS, CAMPAIGNS, missionConfigFrom, missionRules } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, reinforce } from '../../src/battle/setup'
import { ARENA_MIN_RADIUS } from '../../src/world/arena'

/** 關鍵點離界至少要留這麼多，m：開場就貼著界的話，第一個迴旋就出界 */
const MARGIN = 1000

const ready = CAMPAIGNS.flatMap((c) => MISSIONS[c]).filter((m): m is ReadyMissionCard => m.battle !== null)

describe('任務的戰場邊界', () => {
  it('十張打得起來的卡都有界', () => {
    expect(ready.length).toBeGreaterThanOrEqual(10)
  })

  for (const card of ready) {
    describe(card.id, () => {
      const a = card.battle.arena
      const from = (x: number, z: number): number => Math.hypot(x - a.x, z - a.z)

      it(`半徑不小於 ${ARENA_MIN_RADIUS} m`, () => {
        expect(a.radius).toBeGreaterThanOrEqual(ARENA_MIN_RADIUS)
      })

      it('開場的飛機、地面目標、船與目標點都在界內，離界至少 1 km', () => {
        const cfg = missionConfigFrom(card)
        const b = createBattle({ update() {} }, cfg, 1)
        const far: string[] = []
        const check = (what: string, x: number, z: number): void => {
          const d = from(x, z)
          if (d > a.radius - MARGIN) far.push(`${what} (${x.toFixed(0)}, ${z.toFixed(0)}) 離圓心 ${d.toFixed(0)} m`)
        }
        for (const c of [...b.blue, ...b.red]) {
          const p = c.aircraft.state.position
          check(`${c.team} ${c.aircraft.spec.id}`, p.x, p.z)
        }
        for (const g of b.world.groundTargets) check(`地面 ${g.unit.id}`, g.position.x, g.position.z)
        for (const s of b.world.ships) check('船', s.position.x, s.position.z)
        const rules = missionRules(card, cfg.altitude, cfg.lateralOffset)
        if ('point' in rules) check('目標點', rules.point.x, rules.point.z)
        expect(far).toEqual([])
      })

      it('增援波次的出生點與中途撤離點都在界內，離界至少 1 km', () => {
        const cfg = missionConfigFrom(card)
        const b = createBattle({ update() {} }, cfg, 1)
        const far: string[] = []
        // 【照節拍的順序叫】預留的分隊是依節拍順序排的，`reinforce` 一支接一支用
        for (const beat of cfg.beats ?? []) {
          if (beat.kind === 'reinforce') {
            for (const seat of reinforce(b, beat.flight)) {
              const p = b.world.combatants[seat]!.aircraft.state.position
              const d = from(p.x, p.z)
              if (d > a.radius - MARGIN) far.push(`增援 (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) 離圓心 ${d.toFixed(0)} m`)
            }
          }
          if (beat.kind === 'withdraw') {
            const d = from(beat.point.x, beat.point.z)
            if (d > a.radius - MARGIN) far.push(`撤離點 (${beat.point.x}, ${beat.point.z}) 離圓心 ${d.toFixed(0)} m`)
          }
        }
        expect(far).toEqual([])
      })
    })
  }
})
