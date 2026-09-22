import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { World } from '../../src/world/World'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'
import { A6M5_BOMB_LOADOUT, loadoutOf } from '../../src/weapons/stores'
import { createBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions/types'
import type { Controller } from '../../src/control/Controller'

const IDLE: Controller = { update() {} }

/**
 * `World.loadoutOverrides`：一場戰鬥依機種複寫的掛載。
 *
 * 【它在防什麼】複寫只在開場套一次的話，增援進場與整隊重生都走回預設表 ——
 * 盟 M3 的零戰重生之後就空手了，而且不會有任何東西報錯。
 */
describe('依機種複寫掛載', () => {
  it('沒有複寫時照預設表：零戰空手、陸攻掛雷', () => {
    const w = new World()
    const zero = w.add(new Aircraft(A6M5), IDLE, 'red', new Vector3(0, 1000, 0))
    const betty = w.add(new Aircraft(G4M), IDLE, 'red', new Vector3(0, 1000, 500))
    expect(zero.loadout).toBeNull()
    expect(betty.loadout).toEqual(loadoutOf('g4m'))
  })

  it('進場時照複寫，沒被複寫的機種照預設', () => {
    const w = new World()
    w.loadoutOverrides = { a6m5: A6M5_BOMB_LOADOUT }
    const zero = w.add(new Aircraft(A6M5), IDLE, 'red', new Vector3(0, 1000, 0))
    const betty = w.add(new Aircraft(G4M), IDLE, 'red', new Vector3(0, 1000, 500))
    expect(zero.loadout).toEqual(A6M5_BOMB_LOADOUT)
    expect(zero.bombBay.capacity).toBe(A6M5_BOMB_LOADOUT.count)
    expect(betty.loadout).toEqual(loadoutOf('g4m'))
  })

  /** 【重生換機種也要照複寫】`setSpec` 是整隊重生與接手走的那一條 */
  it('換機種時照複寫', () => {
    const w = new World()
    w.loadoutOverrides = { a6m5: A6M5_BOMB_LOADOUT }
    const c = w.add(new Aircraft(G4M), IDLE, 'red', new Vector3(0, 1000, 0))
    w.setSpec(c, A6M5)
    expect(c.loadout).toEqual(A6M5_BOMB_LOADOUT)
    expect(c.bombBay.capacity).toBe(A6M5_BOMB_LOADOUT.count)
  })

  it('日 M1 開場：零戰空手，陸攻照樣掛雷', () => {
    const card = MISSIONS.japan.find((m) => m.id === 'japan-m1') as ReadyMissionCard
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    const zeros = b.world.combatants.filter((c) => c.aircraft.spec.id === 'a6m5')
    const bettys = b.world.combatants.filter((c) => c.aircraft.spec.id === 'g4m')
    expect(zeros.length).toBeGreaterThan(0)
    expect(bettys.length).toBeGreaterThan(0)
    for (const c of zeros) expect(c.loadout).toBeNull()
    for (const c of bettys) expect(c.loadout?.kind).toBe('torpedo')
  })

  it('盟 M3 開場：零戰掛爆戦', () => {
    const card = MISSIONS.allies.find((m) => m.id === 'allies-m3') as ReadyMissionCard
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    const zeros = b.world.combatants.filter((c) => c.aircraft.spec.id === 'a6m5')
    expect(zeros.length).toBeGreaterThan(0)
    for (const c of zeros) expect(c.loadout).toEqual(A6M5_BOMB_LOADOUT)
  })
})
