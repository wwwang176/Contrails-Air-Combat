import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { aliveCount, createBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Combatant } from '../../src/world/World'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

describe('createBattle 的編制', () => {
  it('雙方各 perSide 架，玩家在藍隊', () => {
    const b = createBattle(new Idle())
    expect(b.blue).toHaveLength(DEFAULT_BATTLE.perSide)
    expect(b.red).toHaveLength(DEFAULT_BATTLE.perSide)
    expect(b.world.combatants).toHaveLength(DEFAULT_BATTLE.perSide * 2)
    expect(b.blue).toContain(b.player)
    expect(b.player.team).toBe('blue')
  })

  it('玩家用傳進來的控制器，其餘都是 AI', () => {
    const pc = new Idle()
    const b = createBattle(pc)
    expect(b.player.controller).toBe(pc)
    const others = b.world.combatants.filter((c) => c !== b.player)
    expect(others.every((c) => c.controller !== pc)).toBe(true)
  })

  it('combatants 的 index 等於陣列位置——指派板的前提', () => {
    const b = createBattle(new Idle())
    b.world.combatants.forEach((c, i) => expect(c.index).toBe(i))
    expect(b.board.assignments).toHaveLength(DEFAULT_BATTLE.perSide * 2)
  })

  it('沒有人一出生就設定了固定目標', () => {
    const b = createBattle(new Idle())
    expect(Array.from(b.board.assignments).every((a) => a === -1)).toBe(true)
  })

  it('一律不重生——一方全滅要能被偵測到', () => {
    const b = createBattle(new Idle())
    expect(b.world.combatants.every((c) => !c.respawnOnDestroy)).toBe(true)
  })
})

describe('createBattle 的出生幾何', () => {
  const b = createBattle(new Idle())

  const centre = (cs: readonly Combatant[]): Vector3 => {
    const v = new Vector3()
    for (const c of cs) v.add(c.aircraft.state.position)
    return v.divideScalar(cs.length)
  }
  const fwd = (c: Combatant): Vector3 =>
    new Vector3(0, 0, -1).applyQuaternion(c.aircraft.state.orientation)

  it('兩隊相距 entryRange', () => {
    expect(centre(b.blue).distanceTo(centre(b.red)))
      .toBeCloseTo(DEFAULT_BATTLE.entryRange, 3)
  })

  it('兩隊面對面：機首方向的點積為 −1', () => {
    expect(fwd(b.blue[0]!).dot(fwd(b.red[0]!))).toBeCloseTo(-1, 6)
  })

  it('兩隊機首都指著對方', () => {
    // 藍隊在 +Z、朝 −Z；紅隊在 −Z、朝 +Z
    const toRed = centre(b.red).sub(centre(b.blue)).normalize()
    expect(fwd(b.blue[0]!).dot(toRed)).toBeGreaterThan(0.99)
  })

  it('速度與機首同向，大小等於 tas', () => {
    for (const c of b.world.combatants) {
      const f = fwd(c)
      const v = c.aircraft.state.velocity.clone().normalize()
      expect(v.dot(f)).toBeCloseTo(1, 5)
      expect(c.aircraft.state.velocity.length()).toBeCloseTo(DEFAULT_BATTLE.tas, 3)
    }
  })

  it('同隊相鄰兩架的橫向間距等於 lateralSpacing', () => {
    for (let i = 1; i < b.blue.length; i++) {
      const dx = Math.abs(
        b.blue[i]!.aircraft.state.position.x - b.blue[i - 1]!.aircraft.state.position.x,
      )
      expect(dx).toBeCloseTo(DEFAULT_BATTLE.lateralSpacing, 3)
    }
  })

  it('高度散布在 ±altitudeSpread 之內，而且真的有散開', () => {
    const ys = b.world.combatants.map((c) => c.aircraft.state.position.y)
    for (const y of ys) {
      expect(Math.abs(y - DEFAULT_BATTLE.altitude)).toBeLessThanOrEqual(
        DEFAULT_BATTLE.altitudeSpread + 1e-6,
      )
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(DEFAULT_BATTLE.altitudeSpread)
  })

  it('沒有兩架出生在同一點', () => {
    const cs = b.world.combatants
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        expect(cs[i]!.aircraft.state.position.distanceTo(cs[j]!.aircraft.state.position))
          .toBeGreaterThan(1)
      }
    }
  })

  it('prevPosition 與 prevOrientation 同步——重生不會被內插成殘影', () => {
    for (const c of b.world.combatants) {
      expect(c.aircraft.prevPosition.distanceTo(c.aircraft.state.position)).toBe(0)
      expect(c.aircraft.prevOrientation.angleTo(c.aircraft.state.orientation)).toBe(0)
    }
  })
})

describe('createBattle 的決策相位', () => {
  it('40 架的相位平均散開，不是全部擠在 0', () => {
    const b = createBattle(new Idle())
    // 跑滿一個決策週期（10 Hz、240 Hz 物理 → 24 步）
    const stepsPerPeriod = 24
    const perStep: number[] = []
    for (let s = 0; s < stepsPerPeriod; s++) {
      let n = 0
      for (const c of b.world.combatants) {
        if (c === b.player) continue
        const ai = c.controller as { decisionsMade: number }
        const before = ai.decisionsMade
        c.controller.update(c.aircraft, 1 / 240, c.command)
        if (ai.decisionsMade > before) n++
      }
      perStep.push(n)
    }
    // 39 架 AI 攤在 24 步裡，任何一步都不該超過 4 架
    expect(Math.max(...perStep)).toBeLessThanOrEqual(4)
    expect(perStep.reduce((a, x) => a + x, 0)).toBe(39)
  })
})

describe('aliveCount', () => {
  it('數存活的', () => {
    const b = createBattle(new Idle())
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide)
    b.blue[0]!.alive = false
    b.blue[1]!.alive = false
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide - 2)
  })
})
