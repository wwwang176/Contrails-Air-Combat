import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, aliveCount } from '../../src/battle/setup'
import { battleConfigFrom, uniform, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { clearKills } from '../../src/world/kills'
import { clearImpacts } from '../../src/world/events'
import { ALLIED_NAMES, AXIS_NAMES } from '../../src/battle/names'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

describe('換一場（M10 spec §5.3）', () => {
  it('改設定重開，架數與機種都跟著換', () => {
    const first = createBattle(
      new Idle(), battleConfigFrom({ ...DEFAULT_SKIRMISH }), 1,
    )
    expect(first.blue).toHaveLength(20)
    expect(first.blue[0]!.aircraft.spec.id).toBe('p51d')

    const second = createBattle(
      new Idle(),
      battleConfigFrom(uniform('bf109k4', 2, 'p51d', 5)),
      1,
    )
    expect(second.blue).toHaveLength(2)
    expect(second.red).toHaveLength(5)
    expect(second.blue[0]!.aircraft.spec.id).toBe('bf109k4')
    expect(second.red[0]!.aircraft.spec.id).toBe('p51d')
    // 名冊跟著機種走
    expect(AXIS_NAMES).toContain(second.roster.pilots[second.blue[0]!.index]!.name)
    expect(ALLIED_NAMES).toContain(second.roster.pilots[second.red[0]!.index]!.name)
  })

  it('上一場的戰績不會漏到新的一場', () => {
    // 【為什麼要在整合層再測一次】`createBattle` 每次都建新的 `Roster`，
    // 所以這條理論上不會紅。它守的是「有一天有人為了省事改成重用名冊」。
    const a = createBattle(new Idle(), battleConfigFrom({ ...DEFAULT_SKIRMISH }), 1)
    a.world.applyDamage(a.red[0]!, 99999, 'fuselage', a.blue[1]!)
    stepBattle(a, DT)
    expect(a.roster.pilots.reduce((s, p) => s + p.kills, 0)).toBe(1)

    const b = createBattle(new Idle(), battleConfigFrom({ ...DEFAULT_SKIRMISH }), 2)
    expect(b.roster.pilots.reduce((s, p) => s + p.kills, 0)).toBe(0)
    expect(b.roster.pilots.every((p) => p.alive)).toBe(true)
  })

  it('連開十場不會愈來愈慢 —— 沒有跨場累積的狀態', () => {
    const times: number[] = []
    for (let n = 0; n < 10; n++) {
      const b = createBattle(
        new Idle(), battleConfigFrom(uniform('p51d', 4, 'bf109k4', 4)), n,
      )
      const t0 = performance.now()
      for (let i = 0; i < 240; i++) {
        stepBattle(b, DT)
        clearKills(b.world.killEvents)
        clearImpacts(b.world.hitEvents)
        clearImpacts(b.world.splashEvents)
      }
      times.push(performance.now() - t0)
      expect(aliveCount(b.blue)).toBeGreaterThan(0)
    }
    // 【門檻】最後三場的平均不該比最初三場慢兩倍以上。
    // 這是一個很寬的門檻 —— 它抓的是「每一場都留下東西」這種數量級的問題，
    // 不是效能微調。紅了就是真的有跨場累積，不要放寬。
    const early = (times[0]! + times[1]! + times[2]!) / 3
    const late = (times[7]! + times[8]! + times[9]!) / 3
    expect(late).toBeLessThan(early * 2)
  })
})
