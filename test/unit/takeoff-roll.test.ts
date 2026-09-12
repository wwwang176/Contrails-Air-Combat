import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import {
  CLIMB_SECONDS, createTakeoffRoll, GEAR_CLEARANCE, LIFTOFF_SPEED, ROLL_SECONDS, stepTakeoff,
  TAKEOFF_STAGGER, TAKEOFF_TRAIL,
} from '../../src/control/takeoffRoll'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { missionConfigFrom, type MissionBattle, type ReadyMissionCard } from '../../src/battle/missions'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { readyCard, KILL_CARD } from '../fixtures/mission'
import type { Aircraft as AircraftT } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # 滾行起飛
 *
 * 守兩件事：腳本本身的剖面（貼地滾行 → 抬頭 → 爬升 → 交還），以及腳本期間
 * 那一架仍然是戰場上的一架 —— 打得到、不被撞地判定殺掉、AI 不去追它、
 * 交還時速度接得上物理。
 */

const DT = 1 / 240
const NOSE = new Vector3()

function noseOf(a: Aircraft): Vector3 {
  return NOSE.set(0, 0, -1).applyQuaternion(a.state.orientation)
}

describe('滾行腳本的剖面', () => {
  const a = new Aircraft(P51D, 0, 0)
  const roll = createTakeoffRoll(100, -300, 0, 12)
  const samples: { t: number; y: number; x: number; z: number; speed: number; pitch: number }[] = []
  let steps = 0
  while (stepTakeoff(roll, a.state, DT)) {
    steps++
    const n = noseOf(a)
    samples.push({
      t: steps * DT, y: a.state.position.y, x: a.state.position.x, z: a.state.position.z,
      speed: a.state.velocity.length(), pitch: Math.asin(n.y),
    })
    if (steps > 240 * 60) throw new Error('腳本沒有結束')
  }

  it('滾行段貼在跑道面上方 GEAR_CLEARANCE、機身水平、沿航向前進', () => {
    const rolling = samples.filter((s) => s.t < ROLL_SECONDS)
    expect(rolling.length).toBeGreaterThan(0)
    for (const s of rolling) {
      expect(s.y).toBeCloseTo(12 + GEAR_CLEARANCE, 6)
      expect(s.pitch).toBeCloseTo(0, 6)
      expect(s.x).toBeCloseTo(100, 6)
    }
    // heading 0 = 朝 −Z
    expect(rolling.at(-1)!.z).toBeLessThan(-300)
    expect(rolling.at(-1)!.speed).toBeGreaterThan(rolling[0]!.speed)
  })

  it('約 ROLL_SECONDS 秒到離地速度', () => {
    const at = samples.find((s) => s.t >= ROLL_SECONDS)!
    expect(at.speed).toBeGreaterThan(LIFTOFF_SPEED * 0.97)
    expect(at.speed).toBeLessThan(LIFTOFF_SPEED * 1.05)
  })

  it('交還前俯仰在 8–10°、已經離地、總長 ROLL_SECONDS + CLIMB_SECONDS', () => {
    const last = samples.at(-1)!
    expect(last.pitch / (Math.PI / 180)).toBeGreaterThanOrEqual(8)
    expect(last.pitch / (Math.PI / 180)).toBeLessThanOrEqual(10)
    expect(last.y).toBeGreaterThan(12 + GEAR_CLEARANCE + 5)
    expect((steps + 1) * DT).toBeCloseTo(ROLL_SECONDS + CLIMB_SECONDS, 1)
  })

  it('速度沿著機首方向 —— 交還給物理時不是側滑或失速', () => {
    const n = noseOf(a)
    const v = a.state.velocity.clone().normalize()
    expect(v.dot(n)).toBeGreaterThan(0.999)
    expect(a.state.angularVelocity.length()).toBe(0)
  })
})

class Idle implements Controller {
  update(_self: AircraftT, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

function card(patch: Partial<MissionBattle>): ReadyMissionCard {
  const base = readyCard(KILL_CARD)
  return { ...base, id: 'test-card', battle: { ...base.battle, ...patch } }
}

/** 開場 0.5 秒，兩架 P-51 在 (0, −3000) 起飛線上滾行 */
/** 起飛線 (0, −3000) 機首朝 −Z 的波次 */
function takeoffWave(count: number, departs?: 'parkedP51') {
  return {
    when: { kind: 'clock' as const, at: 0.5 }, warn: 'x', warnLead: 0,
    side: 'theirs' as const, spec: P51D, count,
    takeoff: { x: 0, z: -3000, heading: 0 },
    ...(departs === undefined ? {} : { departs }),
  }
}

/** 開場 0.5 秒，`count` 架 P-51 在 (0, −3000) 起飛線上滾行 */
function rollingBattle(
  extra: Partial<MissionBattle> = {}, departs?: 'parkedP51', count = 2,
): { b: Battle; seats: number[] } {
  const c = card({ ...extra, waves: [takeoffWave(count, departs)] })
  const b = createBattle(new Idle(), missionConfigFrom(c), 20260913)
  // 遊戲裡的撞地判定：地面 + 2 m。滾行段那 1.5 m 在這條線之下
  b.world.crashPolicy = flatSeaCrashPolicy(() => 0)
  const before = b.world.combatants.length
  while (b.world.combatants.length === before) stepBattle(b, DT)
  return { b, seats: Array.from({ length: count }, (_, k) => before + k) }
}

describe('延遲起步', () => {
  it('延遲期間停在起飛線上不動，之後照同一條剖面走', () => {
    const a = new Aircraft(P51D, 0, 0)
    const roll = createTakeoffRoll(100, -300, 0, 12, 2)
    let steps = 0
    while (stepTakeoff(roll, a.state, DT)) {
      steps++
      if ((steps + 0.5) * DT < 2) {
        expect(a.state.position.z).toBe(-300)
        expect(a.state.position.y).toBe(12 + GEAR_CLEARANCE)
        expect(a.state.velocity.length()).toBe(0)
      }
    }
    expect((steps + 1) * DT).toBeCloseTo(2 + ROLL_SECONDS + CLIMB_SECONDS, 1)
  })
})

describe('滾行中的那一架', () => {
  it('生在起飛線上、單列前後排開、貼地而且活著', () => {
    const { b, seats } = rollingBattle()
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    const [p, q] = seats.map((s) => b.world.combatants[s]!)
    for (const c of [p!, q!]) {
      expect(c.alive).toBe(true)
      expect(c.takeoff).not.toBeNull()
      expect(c.aircraft.state.position.y).toBeCloseTo(GEAR_CLEARANCE, 6)
      expect(c.aircraft.state.position.x).toBe(0)
    }
    expect(q!.aircraft.state.position.z - p!.aircraft.state.position.z).toBeGreaterThan(TAKEOFF_TRAIL / 2)
  })

  it('一個小隊四架排在中線上，前後相隔 TAKEOFF_TRAIL，每一架晚 TAKEOFF_STAGGER 秒起步', () => {
    const { b, seats } = rollingBattle({}, undefined, 4)
    seats.forEach((s, k) => {
      const roll = b.world.combatants[s]!.takeoff!
      expect(roll.x).toBe(0)
      expect(roll.z).toBe(-3000 + k * TAKEOFF_TRAIL)
      expect(roll.delay).toBe(k * TAKEOFF_STAGGER)
    })
  })

  it('停機線上剩的比小隊少：起得來的照樣起飛，其餘席位不進場、不推擊墜', () => {
    const ground = [0, 1].map((i) => ({
      unit: 'parkedP51' as const, team: 'red' as const, x: -100, z: -3000 + i * 50, heading: 0,
    }))
    const { b, seats } = rollingBattle({ ground }, 'parkedP51', 4)
    const cs = seats.map((s) => b.world.combatants[s]!)
    expect(cs.map((c) => c.alive)).toEqual([true, true, false, false])
    expect(cs.map((c) => c.takeoff !== null)).toEqual([true, true, false, false])
    expect(b.roster.pilots[seats[3]!]!.alive).toBe(false)
    expect(b.world.killEvents.total).toBe(0)
  })

  it('停機線上一架都不剩時那一批不來', () => {
    const c = card({
      ground: [{ unit: 'parkedP51', team: 'red', x: -100, z: -3000, heading: 0 }],
      waves: [takeoffWave(4, 'parkedP51')],
    })
    const b = createBattle(new Idle(), missionConfigFrom(c), 20260913)
    b.world.groundTargets[0]!.alive = false
    const before = b.world.combatants.length
    while (b.world.time < 1) stepBattle(b, DT)
    expect(b.world.combatants.length).toBe(before)
    expect(b.message).toBe('')
  })

  it('腳本期間打得到', () => {
    const { b, seats } = rollingBattle()
    const c = b.world.combatants[seats[0]!]!
    const hp = c.hp
    const p = c.aircraft.state.position
    // 從正上方 20 m 往下打一發
    b.world.projectiles.spawn(p.x, p.y + 20, p.z, 0, -900, 0, 40, b.player.index, 0, 1, 20)
    for (let i = 0; i < 24; i++) stepBattle(b, DT)
    expect(c.hp).toBeLessThan(hp)
  })

  it('起飛的每一架讓地上最近的一架停放 P-51 離場，離場不算摧毀', () => {
    // 三架停在起飛線旁，離 (0, −3000) 由近到遠
    const ground = [0, 1, 2].map((i) => ({
      unit: 'parkedP51' as const, team: 'red' as const, x: -100, z: -3000 + i * 50, heading: 0,
    }))
    const { b } = rollingBattle({ ground, destroyCount: 1, destroyUnit: 'parkedP51' }, 'parkedP51')
    const gt = b.world.groundTargets
    expect(gt.map((t) => t.departed)).toEqual([true, true, false])
    expect(gt.map((t) => t.alive)).toEqual([false, false, true])
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
  })

  it('腳本期間 AI 不指派，交還之後倍率回到 1', () => {
    const { b, seats } = rollingBattle()
    stepBattle(b, DT)
    for (const s of seats) expect(b.board.priority[s]).toBe(0)
    while (b.world.combatants[seats.at(-1)!]!.takeoff !== null) stepBattle(b, DT)
    stepBattle(b, DT)
    for (const s of seats) expect(b.board.priority[s]).toBe(1)
  })

  it('交還時速度是連續的，不是歸零也不是開局速度', () => {
    const { b, seats } = rollingBattle()
    const c = b.world.combatants[seats[0]!]!
    const last = new Vector3()
    while (c.takeoff !== null) {
      last.copy(c.aircraft.state.velocity)
      stepBattle(b, DT)
    }
    const after = c.aircraft.state.velocity
    expect(last.length()).toBeGreaterThan(LIFTOFF_SPEED)
    expect(after.distanceTo(last)).toBeLessThan(1)
    expect(c.alive).toBe(true)
  })
})
