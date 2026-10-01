import { describe, expect, it } from 'vitest'
import { createGroundBattle, nearestEnemy, shotTimesBetween, SHOT_JITTER } from '../../src/render/groundBattle'
import { createGroundTarget } from '../../src/world/groundTargets'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle } from '../../src/battle/setup'

/**
 * # 地面戰的戲：射擊排程與挑目標
 *
 * 排程是時間的純函數：同一段時間得到同一組射擊，切成幾幀來算也一樣 —— 否則
 * 幀率不同的兩台機器看到的戲不同，而且一幀的長短會改變開火數。
 */

function times(i: number, period: number, t0: number, t1: number): number[] {
  const out = new Float64Array(512)
  const n = shotTimesBetween(i, period, t0, t1, out)
  return Array.from(out.subarray(0, n))
}

describe('射擊排程', () => {
  it('同一段時間同一組結果', () => {
    expect(times(3, 7, 0, 120)).toEqual(times(3, 7, 0, 120))
  })

  it('切成很多幀算，拼起來與一次算相同', () => {
    const whole = times(5, 7, 0, 60)
    const pieces: number[] = []
    for (let t = 0; t < 60; t += 1 / 60) pieces.push(...times(5, 7, t, Math.min(60, t + 1 / 60)))
    expect(pieces).toEqual(whole)
  })

  it('區間是左開右閉：不會在兩幀的交界算兩次', () => {
    const all = times(2, 5, 0, 100)
    const t = all[3]!
    expect(times(2, 5, 0, t)).toContain(t)
    expect(times(2, 5, t, 100)).not.toContain(t)
  })

  it('相鄰兩發的間隔落在 (1 ± 2 × 抖動) 倍的週期內，而且遞增', () => {
    const all = times(7, 6, 0, 600)
    expect(all.length).toBeGreaterThan(80)
    for (let k = 1; k < all.length; k++) {
      const gap = all[k]! - all[k - 1]!
      expect(gap).toBeGreaterThan(6 * (1 - 2 * SHOT_JITTER) - 1e-9)
      expect(gap).toBeLessThan(6 * (1 + 2 * SHOT_JITTER) + 1e-9)
    }
  })

  it('不同的射手錯開，不會全場同一刻開火', () => {
    expect(times(0, 7, 0, 7)).not.toEqual(times(1, 7, 0, 7))
  })
})

describe('用真的卡片開打', () => {
  it('德 M4 開場之後雙方都在開火', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const gb = createGroundBattle(card.battle.theater!, () => {})
    const flat = (): number => 0
    for (let f = 0; f < 60 * 20; f++) {
      for (let k = 0; k < 4; k++) stepBattle(b, 1 / 240)
      gb.update(b.world.groundTargets, b.world.time, 1 / 60, flat)
    }
    // 30 多台射手、平均 7 秒一發，20 秒至少上百發
    expect(gb.shots).toBeGreaterThan(50)
    gb.dispose()
  })

  it('玩家炸毀的坦克在地面火燒完之後接著冒煙，砲位不冒', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const burns: { x: number; z: number }[] = []
    const gb = createGroundBattle({ ...card.battle.theater!, smokes: [] }, (x, _y, z) => burns.push({ x, z }))
    const flat = (): number => 0
    const tank = b.world.groundTargets.find((t) => t.unit.id === 'tankDug' && t.killAt === Infinity)!
    const gun = b.world.groundTargets.find((t) => t.unit.id === 'atGun')!
    tank.alive = false
    gun.alive = false
    const at = (t: { position: { x: number; z: number } }) =>
      burns.filter((p) => p.x === t.position.x && p.z === t.position.z).length
    for (let s = 0; s < 70 * 10; s++) {
      b.world.time += 0.1
      gb.update(b.world.groundTargets, b.world.time, 0.1, flat)
      if (s === 55 * 10) {
        expect(at(tank)).toBe(0)
      }
    }
    expect(at(tank)).toBeGreaterThan(0)
    expect(at(gun)).toBe(0)
    gb.dispose()
  })
})

describe('挑目標', () => {
  const tank = (i: number, team: 'red' | 'blue', x: number) =>
    createGroundTarget(i, 'tank', team, x, 0, 0)

  it('挑範圍內最近的存活敵方，跳過同隊', () => {
    const ts = [tank(0, 'blue', 0), tank(1, 'blue', 50), tank(2, 'red', 300), tank(3, 'red', 200)]
    expect(nearestEnemy(ts, 0, 1500)).toBe(3)
  })

  it('死的與還沒出現的不挑', () => {
    const ts = [tank(0, 'blue', 0), tank(1, 'red', 100), tank(2, 'red', 200), tank(3, 'red', 400)]
    ts[1]!.alive = false
    ts[2]!.alive = false
    ts[2]!.dormant = true
    expect(nearestEnemy(ts, 0, 1500)).toBe(3)
  })

  it('超出射程回 −1', () => {
    const ts = [tank(0, 'blue', 0), tank(1, 'red', 2000)]
    expect(nearestEnemy(ts, 0, 1500)).toBe(-1)
  })
})
