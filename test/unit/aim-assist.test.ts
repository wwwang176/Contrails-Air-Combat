import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  AimAssist, ASSIST_CONE, ASSIST_MAX_RATE, ASSIST_SWIPE_HOLD, ASSIST_SWIPE_RATE,
} from '../../src/input/aimAssist'
import type { Combatant } from '../../src/world/World'
import { DEG } from '../../src/core/math'
import { solveLead } from '../../src/world/lead'

const MUZZLE = 880
const DT = 1 / 60

function plane(team: 'blue' | 'red', pos: Vector3, vel = new Vector3(), guns = true): Combatant {
  return {
    alive: true, team,
    aircraft: {
      spec: { battery: { mounts: guns ? [{}] : [], sight: { muzzleVelocity: MUZZLE } } },
      state: { position: pos, velocity: vel },
    },
  } as unknown as Combatant
}

/** 從原點看 (x, 0, −z) 的方向 */
function dirTo(x: number, z: number): Vector3 {
  return new Vector3(x, 0, -z).normalize()
}

function assist(): AimAssist {
  const a = new AimAssist()
  a.enabled = true
  return a
}

describe('瞄準輔助', () => {
  const me = plane('blue', new Vector3())

  it('範圍內的敵機：瞄準點往它拉', () => {
    const foe = plane('red', new Vector3(20, 0, -500))
    const aim = new Vector3(0, 0, -1)
    const a = assist()
    const before = aim.angleTo(dirTo(20, 500))
    expect(before).toBeLessThan(ASSIST_CONE)
    a.step(aim, 0, DT, me, [me, foe])
    expect(a.target).toBe(1)
    expect(aim.angleTo(dirTo(20, 500))).toBeLessThan(before)
  })

  it('關掉、範圍外、友機、沒有機槍：都不動', () => {
    const cases: [AimAssist, Combatant[], Combatant][] = [
      [new AimAssist(), [me, plane('red', new Vector3(20, 0, -500))], me],
      [assist(), [me, plane('red', new Vector3(100, 0, -500))], me],
      [assist(), [me, plane('blue', new Vector3(20, 0, -500))], me],
      [assist(), [plane('red', new Vector3(20, 0, -500))], plane('blue', new Vector3(), new Vector3(), false)],
    ]
    for (const [a, cs, shooter] of cases) {
      const aim = new Vector3(0, 0, -1)
      a.step(aim, 0, DT, shooter, cs)
      expect(aim.z).toBe(-1)
      expect(a.target).toBe(-1)
    }
  })

  it('射程外（預瞄小圈不畫的那種）不吸', () => {
    const aim = new Vector3(0, 0, -1)
    const a = assist()
    a.step(aim, 0, DT, me, [me, plane('red', new Vector3(0, 0, -5000))])
    expect(a.target).toBe(-1)
  })

  it('每秒最多轉 ASSIST_MAX_RATE', () => {
    const foe = plane('red', new Vector3(Math.tan(3.5 * DEG) * 500, 0, -500))
    const aim = new Vector3(0, 0, -1)
    const start = aim.clone()
    assist().step(aim, 0, DT, me, [me, foe])
    expect(aim.angleTo(start)).toBeLessThanOrEqual(ASSIST_MAX_RATE * DT + 1e-9)
  })

  /** 橫越 400 m 外：慢的一直黏著，快的被甩掉。兩個都從瞄準點壓在預瞄點上開始 */
  function track(speed: number): number {
    const pos = new Vector3(0, 0, -400)
    const vel = new Vector3(speed, 0, 0)
    const foe = plane('red', pos, vel)
    const aim = new Vector3()
    expect(solveLead(pos, vel, MUZZLE, aim)).toBeGreaterThan(0)
    const a = assist()
    // 【只追 0.5 秒】再久的話快的那一架飛出射程，放開的理由就變成射程而不是速度
    for (let k = 0; k < 30; k++) {
      a.step(aim, 0, DT, me, [me, foe])
      pos.x += speed * DT
    }
    return a.target
  }

  it('預瞄點跑太快就放開；慢的照樣黏著', () => {
    // 400 m 外 100 m/s ≈ 14°/s，低於上限
    expect(track(100)).toBe(1)
    // 400 m 外 400 m/s ≈ 57°/s，超過上限
    expect(track(400)).toBe(-1)
  })

  it('玩家快速甩動：暫停一段時間再吸', () => {
    const foe = plane('red', new Vector3(20, 0, -500))
    const a = assist()
    const aim = new Vector3(0, 0, -1)
    a.step(aim, ASSIST_SWIPE_RATE * DT * 1.5, DT, me, [me, foe])
    expect(a.target).toBe(-1)
    const held = aim.clone()
    const frames = Math.floor(ASSIST_SWIPE_HOLD / DT) - 1
    for (let k = 0; k < frames; k++) a.step(aim, 0, DT, me, [me, foe])
    expect(aim.equals(held)).toBe(true)
    for (let k = 0; k < 3; k++) a.step(aim, 0, DT, me, [me, foe])
    expect(a.target).toBe(1)
  })

  it('範圍內有兩架：黏著正在吸的那一架，不跳到更近的', () => {
    const far = plane('red', new Vector3(25, 0, -500))
    const near = plane('red', new Vector3(5, 0, -500))
    const a = assist()
    const aim = new Vector3(0, 0, -1)
    a.step(aim, 0, DT, me, [me, far])
    expect(a.target).toBe(1)
    a.step(aim, 0, DT, me, [me, far, near])
    expect(a.target).toBe(1)
  })
})
