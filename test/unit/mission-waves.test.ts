import { describe, it, expect } from 'vitest'
import { CAMPAIGNS, MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { MAX_SIDE, MAX_COMBATANTS } from '../../src/battle/skirmish'
import { sideCount } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { A6M5 } from '../../src/specs/a6m5'
import { readyCard, KILL_CARD } from '../fixtures/mission'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { MissionBattle, ReadyMissionCard } from '../../src/battle/missions'
import type { ReinforceBeat, WithdrawBeat } from '../../src/battle/beats'

/**
 * # 任務卡上的波次與返航
 *
 * 卡片**直接指名機種**（`spec`），不是「那個陣營的第幾台」—— 那種相對寫法
 * 表達不出第三架飛機，而日本線有兩台戰鬥機。
 *
 * `side` 留著，因為它回答的是**另一個**問題：這一支加進藍隊還是紅隊。
 * 一支友軍增援與一支敵方增援可能是同一個機種。
 */

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

/** 一張只為了測翻譯而捏的卡。**不改動 `MISSIONS`** */
function card(patch: Partial<MissionBattle>): ReadyMissionCard {
  const base = readyCard(KILL_CARD)
  return { ...base, id: 'test-card', battle: { ...base.battle, ...patch } }
}

const reinforces = (c: ReturnType<typeof missionConfigFrom>): readonly ReinforceBeat[] =>
  (c.beats ?? []).filter((b): b is ReinforceBeat => b.kind === 'reinforce')

const withdraws = (c: ReturnType<typeof missionConfigFrom>): readonly WithdrawBeat[] =>
  (c.beats ?? []).filter((b): b is WithdrawBeat => b.kind === 'withdraw')

describe('波次的翻譯', () => {
  it('沒有波次、重生、返航、照明彈的卡不產生任何節拍', () => {
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) {
        if (m.battle === null) continue
        const b = m.battle
        if (
          b.waves !== undefined || b.recycle !== undefined
          || b.withdraw !== undefined || b.flares !== undefined
        ) continue
        expect(missionConfigFrom(m as ReadyMissionCard).beats, m.id).toBeUndefined()
      }
    }
  })

  it('spec 原樣帶到分隊上 —— 是同一個物件，不是等值的複本', () => {
    // 【為什麼 toBe】下游三張依物件識別的快取認的是參考
    const c = card({
      waves: [{
        when: { kind: 'clock', at: 30 }, warn: '敵機！', warnLead: 3,
        side: 'theirs', spec: P51D, count: 4,
      }],
    })
    const beat = reinforces(missionConfigFrom(c))[0]!
    expect(beat.flight.team).toBe('red')
    expect(beat.flight.members).toHaveLength(4)
    for (const s of beat.flight.members) expect(s).toBe(P51D)
  })

  it('side 決定隊伍，與機種無關 —— 同一台可以是友軍也可以是敵軍', () => {
    const mine = card({
      waves: [{
        when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
        side: 'mine', spec: A6M5, count: 2,
      }],
    })
    const theirs = card({
      waves: [{
        when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: A6M5, count: 2,
      }],
    })
    expect(reinforces(missionConfigFrom(mine))[0]!.flight.team).toBe('blue')
    expect(reinforces(missionConfigFrom(theirs))[0]!.flight.team).toBe('red')
  })

  it('轟炸機也放得進去 —— 沒有「第 0 台是戰鬥機」那個假設了', () => {
    const c = card({
      waves: [{
        when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: B17G, count: 3,
      }],
    })
    expect(reinforces(missionConfigFrom(c))[0]!.flight.members[0]).toBe(B17G)
  })

  it('條件裡的 side 翻成隊伍 —— 卡片上只有一套說法', () => {
    const c = card({
      waves: [{
        when: { kind: 'alive', side: 'theirs', role: 'fighter', atMost: 1, byLatest: 150 },
        warn: 'x', warnLead: 0, side: 'theirs', spec: P51D, count: 4,
      }],
    })
    const when = reinforces(missionConfigFrom(c))[0]!.when
    if (when.kind !== 'alive') throw new Error('應該是 alive 條件')
    expect(when.team).toBe('red')
    expect(when.role).toBe('fighter')
    expect(when.atMost).toBe(1)
    expect(when.byLatest).toBe(150)
  })

  it('時鐘條件、預警文字與提前量原樣帶過去', () => {
    const c = card({
      waves: [{
        when: { kind: 'clock', at: 42 }, warn: '敵方護航機！', warnLead: 4,
        side: 'theirs', spec: P51D, count: 1,
      }],
    })
    const beat = reinforces(missionConfigFrom(c))[0]!
    expect(beat.when).toEqual({ kind: 'clock', at: 42 })
    expect(beat.warn).toBe('敵方護航機！')
    expect(beat.warnLead).toBe(4)
  })

  it('along 覆寫縱深，其餘照那一邊的擺法', () => {
    // 【為什麼要有它】波次原本固定生在那一邊的開局點。玩家往前跑的關卡裡，
    // 第二批不往前挪就會生在他背後
    const base = card({
      waves: [{
        when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: P51D, count: 1,
      }],
    })
    const moved = card({
      waves: [{
        when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: P51D, count: 1, along: -1.0,
      }],
    })
    const a = reinforces(missionConfigFrom(base))[0]!.flight.entry
    const b = reinforces(missionConfigFrom(moved))[0]!.flight.entry
    expect(b.along).toBe(-1.0)
    expect(b.along).not.toBe(a.along)
    // 其餘每一格都沒動
    expect(b.across).toBe(a.across)
    expect(b.climb).toBe(a.climb)
    expect(b.heading).toBe(a.heading)
    expect(b.speed).toBe(a.speed)
    expect(b.gap).toBe(a.gap)
  })

  it('同時成立的波次不會生在同一點上', () => {
    // 【為什麼要真的生出來】高度那一軸的鋸齒週期只有 5，所以「tier 不同」
    // 不蘊含「位置不同」。分開的是橫向槽位，那要算過 `unitFrame` 才看得到
    const n = 6
    const c = card({
      waves: Array.from({ length: n }, (_, i) => ({
        when: { kind: 'clock' as const, at: 1 }, warn: `w${i}`, warnLead: 0,
        side: 'theirs' as const, spec: P51D, count: 1,
      })),
    })
    const b = createBattle(new Idle(), missionConfigFrom(c), 20260903)
    const before = b.world.combatants.length
    for (let i = 0; i < 400 && b.world.combatants.length < before + n; i++) stepBattle(b, 1 / 240)
    expect(b.world.combatants).toHaveLength(before + n)
    const spots = b.world.combatants.slice(before).map((s) => {
      const p = s.aircraft.state.position
      return `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`
    })
    expect(new Set(spots).size, spots.join(' | ')).toBe(n)
  })

  it('第二個波次的條件先成立時要等 —— 預留是佇列，不是有名字的位子', () => {
    // 【擋的是「落進別隊的分隊」】座位依序附加到世界尾端，而每一支預留的
    // 分隊在建構期就綁死了自己的座位與隊伍
    const c = card({
      waves: [
        { when: { kind: 'clock', at: 100 }, warn: '紅', warnLead: 0,
          side: 'theirs', spec: P51D, count: 4 },
        { when: { kind: 'clock', at: 0 }, warn: '藍', warnLead: 0,
          side: 'mine', spec: P51D, count: 1 },
      ],
    })
    const b = createBattle(new Idle(), missionConfigFrom(c), 20260903)
    const before = b.world.combatants.length
    for (let i = 0; i < 240 * 5; i++) stepBattle(b, 1 / 240)
    expect(b.world.combatants).toHaveLength(before)
    expect(b.beatStates[1]!.phase).toBe('warned')

    while (b.world.time < 101 && b.world.combatants.length < before + 5) stepBattle(b, 1 / 240)
    expect(b.world.combatants).toHaveLength(before + 5)
    const seats = b.world.combatants.slice(before)
    expect(seats.slice(0, 4).every((s) => s.team === 'red')).toBe(true)
    expect(seats[4]!.team).toBe('blue')
  })

  it('地面戰果的條件原樣帶過去', () => {
    const c = card({
      waves: [{
        when: { kind: 'ground', below: 6, byLatest: 40 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: P51D, count: 2,
      }],
    })
    expect(reinforces(missionConfigFrom(c))[0]!.when).toEqual({ kind: 'ground', below: 6, byLatest: 40 })
  })

  it('地面戰果的條件在戰場上讀的是敵方地面目標的摧毀數', () => {
    const ground = [0, 1, 2].map((i) => ({
      unit: 'fuelDump' as const, team: 'red' as const, x: i * 100, z: -3000, heading: 0,
    }))
    const c = card({
      ground,
      waves: [{
        when: { kind: 'ground', below: 2, byLatest: 1 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: P51D, count: 2,
      }],
    })
    const run = (kill: number): number => {
      const b = createBattle(new Idle(), missionConfigFrom(c), 20260913)
      const before = b.world.combatants.length
      for (let i = 0; i < kill; i++) b.world.groundTargets[i]!.alive = false
      while (b.world.time < 2) stepBattle(b, 1 / 240)
      return b.world.combatants.length - before
    }
    expect(run(1)).toBe(2)
    expect(run(2)).toBe(0)
  })

  it('一個波次是一支小隊 —— 超過或是 0 都拋錯', () => {
    for (const count of [0, SCHWARM_SIZE + 1]) {
      const c = card({
        waves: [{
          when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
          side: 'theirs', spec: P51D, count,
        }],
      })
      expect(() => missionConfigFrom(c), `count=${count}`).toThrow()
    }
  })
})

describe('返航的翻譯', () => {
  it('撤離點與 missionRules 對同一個距離算出來的相同', () => {
    // 【兩條路必須同一條】返航節拍與撤離卡指的是同一個圈
    const c = card({
      withdraw: {
        when: { kind: 'clock', at: 10 }, message: '返航',
        distance: 12000, radius: 1000, seconds: 158,
      },
    })
    const w = withdraws(missionConfigFrom(c))[0]!
    expect(w.point.x).toBe(0)
    expect(w.point.y).toBe(DEFAULT_BATTLE.altitude)
    expect(w.point.z).toBe(-12000)
    expect(w.radius).toBe(1000)
    expect(w.seconds).toBe(158)
    expect(w.message).toBe('返航')
  })

  it('波次與返航可以同時存在，波次排在前面', () => {
    const c = card({
      waves: [{
        when: { kind: 'clock', at: 1 }, warn: 'x', warnLead: 0,
        side: 'theirs', spec: P51D, count: 2,
      }],
      withdraw: {
        when: { kind: 'clock', at: 5 }, message: 'RTB',
        distance: 9000, radius: 800, seconds: 120,
      },
    })
    const beats = missionConfigFrom(c).beats!
    expect(beats).toHaveLength(2)
    expect(beats[0]!.kind).toBe('reinforce')
    expect(beats[1]!.kind).toBe('withdraw')
  })
})

describe('德軍兩張卡的席位', () => {
  it('加上波次之後兩隊都還在上限內', () => {
    for (const id of ['germany-m1', 'germany-m4']) {
      const m = readyCard(id)
      const cfg = missionConfigFrom(m)
      const extra = (m.battle.waves ?? []).reduce((s, w) => s + w.count, 0)
      const red = sideCount(cfg.units, 'red') + extra
      const blue = sideCount(cfg.units, 'blue')
      expect(red, id).toBeLessThanOrEqual(MAX_SIDE)
      expect(blue, id).toBeLessThanOrEqual(MAX_SIDE)
      expect(red + blue, id).toBeLessThanOrEqual(MAX_COMBATANTS)
    }
  })

  it('德 M3 的起飛波次把起飛線帶到分隊上', () => {
    const cfg = missionConfigFrom(readyCard('germany-m4'))
    const takeoff = reinforces(cfg).filter((b) => b.flight.takeoff !== undefined)
    expect(takeoff).toHaveLength(2)
    for (const b of takeoff) expect(b.when.kind).toBe('ground')
  })
})
