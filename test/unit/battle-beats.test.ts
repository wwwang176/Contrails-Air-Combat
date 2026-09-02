import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { Vector3 } from 'three'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { BattleConfig } from '../../src/battle/setup'
import type { Beat } from '../../src/battle/beats'
import type { FlightPlan } from '../../src/battle/order'

/**
 * # 節拍接進 `stepBattle`
 *
 * 這一份驗的是**機制**：條件在該成立的時候成立、預警與進場隔了 `warnLead`、
 * 效果只發生一次、沒有節拍的場一次都不評估。
 *
 * **不驗「20v20 裡有沒有真的出現第二波」** —— 那是戰場的產物，會被任何無關
 * 的改動弄紅，而紅的時候指不出是哪裡壞了（見 `ai-tactics.test.ts` 檔頭）。
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

const WAVE: FlightPlan = {
  team: 'red',
  members: [BF109K4, BF109K4],
  entry: { along: -0.5, across: 0.5, gap: 0, climb: 0, heading: Math.PI, speed: 1 },
  duty: 'combat',
  lane: 2,
  tier: 3,
}

function battle(beats?: readonly Beat[]) {
  const cfg: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    ...(beats === undefined ? {} : { beats }),
  }
  return createBattle(new Idle(), cfg, 20260901)
}

/** 跑到世界時間至少 `seconds` 秒 */
function run(b: ReturnType<typeof battle>, seconds: number): void {
  while (b.world.time < seconds) stepBattle(b, DT)
}

describe('節拍接進 stepBattle', () => {
  it('增援節拍：容量由 beats 推出來，不必另外寫 reserve', () => {
    const b = battle([
      { kind: 'reinforce', when: { kind: 'clock', at: 5 }, warn: '敵機！', warnLead: 2, flight: WAVE },
    ])
    expect(b.reserve).toEqual([{ team: 'red', count: 2 }])
    expect(b.world.damageStride).toBe(10)
    expect(b.flights.flights).toHaveLength(3)
  })

  it('先預警，過了 warnLead 才真的進場', () => {
    const b = battle([
      { kind: 'reinforce', when: { kind: 'clock', at: 5 }, warn: '敵機！', warnLead: 2, flight: WAVE },
    ])
    run(b, 4.5)
    expect(b.message).toBe('')
    expect(b.world.combatants).toHaveLength(8)

    run(b, 5.1)
    expect(b.message).toBe('敵機！')
    // 【預警之後、進場之前】這中間是玩家反應的時間，少了它預警就沒有意義
    expect(b.world.combatants).toHaveLength(8)

    run(b, 7.1)
    expect(b.world.combatants).toHaveLength(10)
  })

  it('只發生一次 —— 進場之後不再重複', () => {
    const b = battle([
      { kind: 'reinforce', when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0, flight: WAVE },
    ])
    run(b, 30)
    expect(b.world.combatants).toHaveLength(10)
    expect(b.beatStates[0]!.phase).toBe('done')
  })

  it('返航節拍：任務目標換成撤離', () => {
    const b = battle([{
      kind: 'withdraw',
      when: { kind: 'clock', at: 2 },
      message: 'RETURN TO BASE',
      point: new Vector3(0, 4000, 9000),
      radius: 1000,
      seconds: 300,
    }])
    expect(b.cfg.rules.kind).toBe('annihilate')
    run(b, 2.1)
    expect(b.message).toBe('RETURN TO BASE')
    expect(b.mission.secondsLeft).toBeGreaterThan(0)
  })

  it('沒有節拍的場：狀態是空的，訊息永遠不出現', () => {
    // 【對照組】沒有它，上面那些在「節拍根本沒接上」時也會綠
    const b = battle()
    expect(b.beatStates).toHaveLength(0)
    run(b, 10)
    expect(b.message).toBe('')
    expect(b.world.combatants).toHaveLength(8)
  })

  it('同一組設定跑兩次完全相同 —— 節拍狀態不污染卡片', () => {
    // 【擋的是把 fired 寫回 MissionCard】那種寫法第二次開場時波次已經是
    // fired，而重置沒有任何波次邏輯
    const beats: readonly Beat[] = [
      { kind: 'reinforce', when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0, flight: WAVE },
    ]
    const dump = () => {
      const b = battle(beats)
      run(b, 3)
      return {
        n: b.world.combatants.length,
        phase: b.beatStates[0]!.phase,
        seats: b.world.combatants.slice(8).map((c) => {
          const s = c.aircraft.state
          return [s.position.x, s.position.y, s.position.z].join(',')
        }),
      }
    }
    expect(dump()).toEqual(dump())
  })

  it('兩個節拍照卡片順序，各自獨立', () => {
    const b = battle([
      { kind: 'reinforce', when: { kind: 'clock', at: 1 }, warn: 'a', warnLead: 0, flight: WAVE },
      { kind: 'reinforce', when: { kind: 'clock', at: 3 }, warn: 'b', warnLead: 0, flight: WAVE },
    ])
    run(b, 1.1)
    expect(b.world.combatants).toHaveLength(10)
    expect(b.beatStates[1]!.phase).toBe('waiting')
    run(b, 3.1)
    expect(b.world.combatants).toHaveLength(12)
  })
})
