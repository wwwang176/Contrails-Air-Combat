import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard } from '../fixtures/mission'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # 轟炸機流：有終點、但勝負不看抵達
 *
 * 德 M1 的 B-17 是 transit —— 飛向終點、不交戰、不投彈。規則是 hunt，抵達不
 * 判定任何事；到了終點就從起點重新進場（`conveyor` 節拍），離場不算擊落。
 */

const DT = 1 / 240

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

function battle() {
  return createBattle(new Idle(), missionConfigFrom(readyCard('germany-m1')), 20260913)
}

describe('轟炸機流', () => {
  it('transit 配 hunt 建得起來，終點不參與勝負', () => {
    const b = battle()
    expect(b.cfg.rules.kind).toBe('hunt')
    const cv = b.convoy!
    expect(cv.seats).toHaveLength(8)
    expect(cv.judged).toBe(false)
    for (const s of cv.seats) b.world.combatants[s]!.aircraft.state.position.copy(cv.goal)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
  })

  it('抵達終點的那一架回到起點重新進場，不推擊墜、不算擊落', () => {
    const b = battle()
    const cv = b.convoy!
    const c = b.world.combatants[cv.seats[0]!]!
    const other = b.world.combatants[cv.seats[1]!]!
    const kills = b.world.killEvents.total
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    c.aircraft.state.position.copy(cv.goal)
    stepBattle(b, DT)
    expect(c.alive).toBe(true)
    expect(c.aircraft.state.position.distanceTo(c.spawnPosition)).toBeLessThan(1)
    // 沒到的那一架照常飛，沒有被一起拉回去
    expect(other.aircraft.state.position.distanceTo(other.spawnPosition)).toBeGreaterThan(50)
    expect(b.world.killEvents.total).toBe(kills)
    expect(b.redKilledBombers).toBe(0)
  })

  it('傳送帶配判勝負的護送規則就拋錯 —— 抵達的閂會永遠閂不上', () => {
    const cfg = missionConfigFrom(readyCard('allies-m1'))
    expect(() => createBattle(new Idle(), {
      ...cfg, beats: [...(cfg.beats ?? []), { kind: 'conveyor' }],
    }, 1)).toThrow()
  })

  it('有 transit 卻既不是護送規則、也沒有終點，照樣拋錯', () => {
    // 【傳送帶一起拿掉】它自己也會因為沒有終點而拋，留著的話量不到這一條
    const { route: _route, beats, ...cfg } = missionConfigFrom(readyCard('germany-m1'))
    const rest = (beats ?? []).filter((x) => x.kind !== 'conveyor')
    expect(() => createBattle(new Idle(), { ...cfg, beats: rest }, 1)).toThrow()
  })
})
