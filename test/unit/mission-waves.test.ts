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
  it('沒有波次也沒有返航的卡不產生任何節拍', () => {
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) {
        if (m.battle === null) continue
        if (m.battle.waves !== undefined || m.battle.withdraw !== undefined) continue
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
        when: { kind: 'clock', at: 10 }, message: 'RETURN TO BASE',
        distance: 12000, radius: 1000, seconds: 158,
      },
    })
    const w = withdraws(missionConfigFrom(c))[0]!
    expect(w.point.x).toBe(0)
    expect(w.point.y).toBe(DEFAULT_BATTLE.altitude)
    expect(w.point.z).toBe(-12000)
    expect(w.radius).toBe(1000)
    expect(w.seconds).toBe(158)
    expect(w.message).toBe('RETURN TO BASE')
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

describe('攔截轟炸機群的第二批護航機', () => {
  const m1 = readyCard('germany-m1')

  it('這張卡真的掛了一個波次', () => {
    // 【為什麼要這一條】設定基準（`mission-config-baseline.test.ts`）刻意把
    // `beats` 排除在快照之外 —— 德 M1 多一個波次是這一輪刻意的新增，不該讓
    // 基準紅。代價是**波次被刪掉那一份基準仍然全綠**（Codex 審查 P1）。
    // 這一條補上那個缺口
    expect(m1.battle.waves).toHaveLength(1)
  })

  it('來的是敵方的 P-51D 四架，用時鐘不是存活數', () => {
    const w = m1.battle.waves![0]!
    expect(w.side).toBe('theirs')
    expect(w.spec).toBe(P51D)
    expect(w.count).toBe(4)
    // 【為什麼是時鐘】這一關的 convoyPriority 是 5，我方一心衝轟炸機 ——
    // 實測一整場 145 s 護航機一架都沒掉，而勝負 145.5 s 就定了。
    // 「敵方戰鬥機剩不多」那個條件的節奏在這裡不可靠
    if (w.when.kind !== 'clock') throw new Error('應該用時鐘')
    expect(w.when.at).toBeGreaterThan(0)
    expect(w.warnLead).toBeGreaterThan(0)
  })

  it('波次來得及在勝負定下來之前發生', () => {
    // 【擋的是「波次排在關卡結束之後」】轟炸機飛 12 km 大約 145 s；
    // 波次若排在那之後，玩家永遠看不到它
    const w = m1.battle.waves![0]!
    if (w.when.kind !== 'clock') throw new Error('應該用時鐘')
    expect(w.when.at + w.warnLead).toBeLessThan(120)
  })
})

describe('帝國最後防線的兩批攔截機', () => {
  const m4 = readyCard('germany-m4')

  it('返航的兜底時限早於第二批進場 —— 否則那一關的下半場會被跳過', () => {
    // 【這是一個真的會發生的路徑】開場規則是 annihilate，紅隊歸零就**直接
    // 判勝**，之後返航節拍再也沒有機會接管規則。實測：讓紅隊在 t=4.1 s 歸零
    // 而藍隊還有 8 架，結果是 victory、withdraw 還停在 waiting
    //（Codex 審查 2026-09-03 P0）
    //
    // 所以兜底時限要早於「打得完敵軍」的那一刻。這裡守的是可以量的那一半：
    // 它早於第二批進場，第二批因此是擋在逃生路上，而不是還在纏鬥時多來四架
    const w = m4.battle.withdraw!
    if (w.when.kind !== 'alive') throw new Error('應該用存活數')
    const second = m4.battle.waves![1]!
    if (second.when.kind !== 'clock') throw new Error('第二批應該用時鐘')
    expect(w.when.byLatest).toBeLessThan(second.when.at + second.warnLead)
  })

  it('返航綁我方存活數，不是時鐘', () => {
    // 【為什麼非這樣不可】開場規則是 annihilate，紅隊歸零就直接判勝。
    // 用時鐘的話玩家提前清光敵軍，返航段永遠不會發生
    const w = m4.battle.withdraw!
    if (w.when.kind !== 'alive') throw new Error('應該用存活數，不是時鐘')
    expect(w.when.side).toBe('mine')
    expect(Number.isFinite(w.when.byLatest)).toBe(true)
  })

  it('兩批都從敵方那一側來，第二批往前挪', () => {
    const waves = m4.battle.waves!
    expect(waves).toHaveLength(2)
    for (const w of waves) expect(w.side).toBe('theirs')
    expect(waves[0]!.along).toBeUndefined()
    expect(waves[1]!.along).toBeLessThan(-0.5)
  })

  it('波次生在玩家前方，而且在撤離點之前', () => {
    // 【這是這一關的整個幾何】撤離點在 −Z，波次也在 −Z ——
    // 玩家必須打穿出去。舊撤離卡的「追不到」從根本消失，因為沒有人在追
    const cfg = missionConfigFrom(m4)
    const z = reinforces(cfg).map((b) => b.flight.entry.along * cfg.entryRange)
    const target = -m4.battle.withdraw!.distance
    for (const v of z) {
      expect(v, `波次 z=${v}`).toBeLessThan(0)
      expect(v, `波次 z=${v} 應在撤離點之前`).toBeGreaterThan(target)
    }
    expect(z[1]).toBeLessThan(z[0]!)
  })

  it('加上兩批之後兩隊都還在上限內', () => {
    const cfg = missionConfigFrom(m4)
    const extra = m4.battle.waves!.reduce((s, w) => s + w.count, 0)
    const red = sideCount(cfg.units, 'red') + extra
    const blue = sideCount(cfg.units, 'blue')
    expect(red).toBeLessThanOrEqual(MAX_SIDE)
    expect(blue).toBeLessThanOrEqual(MAX_SIDE)
    expect(red + blue).toBeLessThanOrEqual(MAX_COMBATANTS)
  })
})
