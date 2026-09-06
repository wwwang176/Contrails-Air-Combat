import { describe, it, expect } from 'vitest'
import { createBattle, resetBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { BattleConfig } from '../../src/battle/setup'
import type { Beat } from '../../src/battle/beats'
import type { FlightPlan } from '../../src/battle/order'

/**
 * # 有波次的一場，「重新開始」要整個重建
 *
 * **重建，不截斷。** 這一份釘住那條規則的兩半 ——
 * 重建之後 t=0 與第一次開場完全相同，而 `resetBattle` 那條路做不到。
 *
 * 【分支住在 `main.ts`】它是 DOM 那一層的東西，驗不到。這裡驗的是**判準
 * 本身**：`beatStates.length > 0` 這個條件為什麼非分不可。
 */

const DT = 1 / 240
const SEED = 20260901

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

const WAVE: FlightPlan = {
  team: 'red',
  members: [BF109K4, BF109K4],
  entry: { along: -0.5, across: 0.5, gap: 0, climb: 0, heading: Math.PI, speed: 1 },
  duty: 'combat',
  lane: 2,
  tier: 3,
}

const BEATS: readonly Beat[] = [
  { kind: 'reinforce', when: { kind: 'clock', at: 1 }, warn: '敵機！', warnLead: 0, flight: WAVE },
]

/** **同一個物件**餵給兩次 `createBattle` —— 重建走的就是這一份不可變的設定 */
const CFG: BattleConfig = {
  ...DEFAULT_BATTLE,
  units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
  beats: BEATS,
}

function fresh() {
  return createBattle(new Idle(), CFG, SEED)
}

function run(b: ReturnType<typeof fresh>, seconds: number): void {
  while (b.world.time < seconds) stepBattle(b, DT)
}

/** 一場的 t=0 狀態。位置、編制、名冊、節拍全部進來 */
function snapshot(b: ReturnType<typeof fresh>) {
  return {
    time: b.world.time,
    n: b.world.combatants.length,
    alive: b.world.combatants.filter((c) => c.alive).length,
    seats: b.world.combatants.map((c) => {
      const s = c.aircraft.state
      return [c.team, s.position.x, s.position.y, s.position.z].join(',')
    }),
    flightOf: Array.from(b.flights.flightOf),
    positionOf: Array.from(b.flights.positionOf),
    counts: b.flights.flights.map((f) => f.count),
    names: b.roster.pilots.map((p) => `${p.name}/${p.kills}/${p.deaths}`),
    phases: b.beatStates.map((s) => s.phase),
    message: b.message,
    reserveUsed: b.reserveUsed,
  }
}

describe('有波次的一場重新開始', () => {
  it('用同一份設定重建，t=0 與第一次開場逐項相同', () => {
    const first = fresh()
    const before = snapshot(first)

    // 打到第二波進場為止，狀態確實已經前進了
    run(first, 2)
    expect(first.world.combatants.filter((c) => c.alive)).toHaveLength(10)
    expect(first.reserveUsed).toBe(1)

    expect(snapshot(fresh())).toEqual(before)
  })

  it('第一次開場時，預留的座位還不存在', () => {
    // 【對照組】少了這一條，上面那一條在「增援根本沒進場」時也會綠
    const b = fresh()
    expect(b.world.combatants.filter((c) => c.alive)).toHaveLength(8)
    expect(b.beatStates.map((s) => s.phase)).toEqual(['waiting'])
  })

  it('resetBattle 做不到 —— 增援留在場上，而且第二波不會再來', () => {
    // 【這就是 `main.ts` 必須分支的理由】`resetBattle` 只把飛機放回出生點：
    // 已經進場的那兩架被一起「復活」，節拍狀態卻仍然是 done。第二輪因此是
    // 一場從頭就滿編、什麼都不會發生的仗
    const b = fresh()
    run(b, 2)
    resetBattle(b, SEED)

    expect(b.world.combatants.filter((c) => c.alive)).toHaveLength(10)
    expect(b.beatStates.map((s) => s.phase)).toEqual(['done'])
    expect(b.reserveUsed).toBe(1)
  })
})
