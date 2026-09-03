import { describe, it, expect } from 'vitest'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { specsFor, MAX_SIDE, MAX_COMBATANTS } from '../../src/battle/skirmish'
import { sideCount } from '../../src/battle/order'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { MissionCard } from '../../src/battle/missions'
import type { ReinforceBeat } from '../../src/battle/beats'

/**
 * # 任務卡上的波次
 *
 * 卡片是**陣營中立**的：同一張卡，玩家選盟軍或選軸心，敵我機種會對調。
 * 所以波次不能寫死「來 4 架 P-51」，得寫成「**敵方的戰鬥機 4 架**」——
 * 由 `missionConfigFrom` 在知道陣營之後才解析成實際機種。
 *
 * 這一份守的就是那一層翻譯：`mine`／`theirs` → 隊伍與機種、
 * `fighter`／`bomber` → 那個陣營的第幾台。
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
function card(waves: MissionCard['waves']): MissionCard {
  const kill = MISSIONS.axis.find((m) => m.type === '殲滅')!
  return { ...kill, ...(waves === undefined ? {} : { waves }) }
}

const reinforces = (c: ReturnType<typeof missionConfigFrom>): readonly ReinforceBeat[] =>
  (c.beats ?? []).filter((b): b is ReinforceBeat => b.kind === 'reinforce')

describe('任務卡的波次翻譯', () => {
  it('沒有波次的卡不產生任何節拍', () => {
    // 【既有 10 張卡逐位元不變的那一半】`beats` 若變成空陣列而不是不存在，
    // `createBattle` 的 `reserve` 推導與 `stepBeats` 的早退都還是走同一條路，
    // 但這一條讓「沒有波次」在資料上也看得出來
    for (const list of [MISSIONS.allies, MISSIONS.axis]) {
      for (const m of list) {
        if (m.waves !== undefined) continue
        expect(missionConfigFrom(m, 'allies').beats, m.id).toBeUndefined()
      }
    }
  })

  it('theirs 解析成紅隊，而且機種跟著陣營走', () => {
    // 【這是「相對描述」的本體】同一張卡、兩個陣營，敵方的戰鬥機是不同的機種
    const c = card([
      { when: { kind: 'clock', at: 30 }, warn: '敵機！', warnLead: 3,
        side: 'theirs', role: 'fighter', count: 4 },
    ])
    for (const faction of ['allies', 'axis'] as const) {
      const theirs = specsFor(faction === 'allies' ? 'axis' : 'allies')
      const beat = reinforces(missionConfigFrom(c, faction))[0]!
      expect(beat.flight.team, faction).toBe('red')
      expect(beat.flight.members.map((s) => s.id), faction)
        .toEqual(Array.from({ length: 4 }, () => theirs[0]!.id))
    }
  })

  it('mine 解析成藍隊 —— 玩家恆在藍隊', () => {
    const c = card([
      { when: { kind: 'clock', at: 30 }, warn: '友軍！', warnLead: 3,
        side: 'mine', role: 'fighter', count: 2 },
    ])
    const beat = reinforces(missionConfigFrom(c, 'axis'))[0]!
    expect(beat.flight.team).toBe('blue')
    expect(beat.flight.members[0]!.id).toBe(specsFor('axis')[0]!.id)
    expect(beat.flight.members).toHaveLength(2)
  })

  it('role 選的是那個陣營的第幾台，不是一個寫死的機種', () => {
    const c = card([
      { when: { kind: 'clock', at: 30 }, warn: 'x', warnLead: 0,
        side: 'theirs', role: 'bomber', count: 3 },
    ])
    const beat = reinforces(missionConfigFrom(c, 'axis'))[0]!
    expect(beat.flight.members[0]!.id).toBe(specsFor('allies')[1]!.id)
    expect(beat.flight.members[0]!.role).toBe('bomber')
  })

  it('條件裡的 side 也要翻譯 —— 卡片上只有一套說法', () => {
    // 【為什麼不讓卡片直接寫 team】同一張卡上「敵方」會有兩種寫法
    // （`side: 'theirs'` 與 `team: 'red'`），而兩者哪天不同步不會有人發現
    const c = card([
      { when: { kind: 'alive', side: 'theirs', role: 'fighter', atMost: 1, byLatest: 150 },
        warn: 'x', warnLead: 0, side: 'theirs', role: 'fighter', count: 4 },
    ])
    const when = reinforces(missionConfigFrom(c, 'axis'))[0]!.when
    if (when.kind !== 'alive') throw new Error('應該是 alive 條件')
    expect(when.team).toBe('red')
    expect(when.role).toBe('fighter')
    expect(when.atMost).toBe(1)
    expect(when.byLatest).toBe(150)
  })

  it('時鐘條件原樣帶過去', () => {
    const c = card([
      { when: { kind: 'clock', at: 42 }, warn: 'x', warnLead: 1,
        side: 'theirs', role: 'fighter', count: 1 },
    ])
    expect(reinforces(missionConfigFrom(c, 'axis'))[0]!.when).toEqual({ kind: 'clock', at: 42 })
  })

  it('預警文字與提前量原樣帶過去', () => {
    const c = card([
      { when: { kind: 'clock', at: 5 }, warn: '敵方護航機！', warnLead: 4,
        side: 'theirs', role: 'fighter', count: 1 },
    ])
    const beat = reinforces(missionConfigFrom(c, 'axis'))[0]!
    expect(beat.warn).toBe('敵方護航機！')
    expect(beat.warnLead).toBe(4)
  })

  it('同時成立的波次不會生在同一點上 —— 量出生座標，不是比 tier', () => {
    // 【為什麼要真的生出來】高度那一軸的鋸齒**週期只有 5**，所以「tier 不同」
    // 不蘊含「位置不同」：第 1 與第 6 個波次的 tier 是 0 與 5，高度完全相同。
    // 分開的是橫向槽位，而那要算過 `unitFrame` 才看得到（Codex 審查 P2）
    const n = 6
    const c = card(Array.from({ length: n }, (_, i) => ({
      when: { kind: 'clock' as const, at: 1 }, warn: `w${i}`, warnLead: 0,
      side: 'theirs' as const, role: 'fighter' as const, count: 1,
    })))
    const b = createBattle(new Idle(), missionConfigFrom(c, 'axis'), 20260903)
    const before = b.world.combatants.length
    // 【一步一步跑】預留是佇列，一步進一支
    for (let i = 0; i < 400 && b.world.combatants.length < before + n; i++) stepBattle(b, 1 / 240)
    expect(b.world.combatants).toHaveLength(before + n)

    const seats = b.world.combatants.slice(before)
    const spots = seats.map((s) => {
      const p = s.aircraft.state.position
      return `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`
    })
    expect(new Set(spots).size, spots.join(' | ')).toBe(n)
  })

  it('第二個波次的條件先成立時要等 —— 預留是佇列，不是有名字的位子', () => {
    // 【擋的是「落進別隊的分隊」】座位依序附加到世界尾端，而每一支預留的
    // 分隊在建構期就綁死了自己的座位與隊伍。硬插隊的話這一支藍隊的波次會
    // 拿到紅隊那一支預留的座位（Codex 審查 P1）
    const c = card([
      { when: { kind: 'clock', at: 100 }, warn: '紅', warnLead: 0,
        side: 'theirs', role: 'fighter', count: 4 },
      { when: { kind: 'clock', at: 0 }, warn: '藍', warnLead: 0,
        side: 'mine', role: 'fighter', count: 1 },
    ])
    const b = createBattle(new Idle(), missionConfigFrom(c, 'axis'), 20260903)
    const before = b.world.combatants.length
    // 條件早就成立了，但還沒輪到 —— 跑一段時間都不該進場，也不該拋錯
    for (let i = 0; i < 240 * 5; i++) stepBattle(b, 1 / 240)
    expect(b.world.combatants).toHaveLength(before)
    expect(b.beatStates[1]!.phase).toBe('warned')

    // 輪到之後兩支都進來，而且各自進對隊伍
    while (b.world.time < 101 && b.world.combatants.length < before + 5) stepBattle(b, 1 / 240)
    expect(b.world.combatants).toHaveLength(before + 5)
    const seats = b.world.combatants.slice(before)
    expect(seats.slice(0, 4).every((s) => s.team === 'red')).toBe(true)
    expect(seats[4]!.team).toBe('blue')
  })

  it('一個波次是一支小隊 —— 超過就拋錯', () => {
    // 【為什麼不自動拆成兩支】拆的話架數與「幾支分隊」的關係就藏起來了，
    // 而預留容量是照分隊配的。要更多架就在卡片上寫兩個波次
    const c = card([
      { when: { kind: 'clock', at: 10 }, warn: 'x', warnLead: 0,
        side: 'theirs', role: 'fighter', count: SCHWARM_SIZE + 1 },
    ])
    expect(() => missionConfigFrom(c, 'axis')).toThrow()
  })

  it('架數是 0 也拋錯', () => {
    const c = card([
      { when: { kind: 'clock', at: 10 }, warn: 'x', warnLead: 0,
        side: 'theirs', role: 'fighter', count: 0 },
    ])
    expect(() => missionConfigFrom(c, 'axis')).toThrow()
  })

  it('波次的座位在建構期就配好，開場時還沒進來', () => {
    const c = card([
      { when: { kind: 'clock', at: 30 }, warn: 'x', warnLead: 0,
        side: 'theirs', role: 'fighter', count: 4 },
    ])
    const cfg = missionConfigFrom(c, 'axis')
    const b = createBattle(new Idle(), cfg, 20260903)
    expect(b.reserve).toEqual([{ team: 'red', count: 4 }])
    // 開場的架數不含波次
    expect(b.world.combatants.filter((x) => x.alive)).toHaveLength(c.blueCount + c.redCount)
    // 但容量已經含進去了
    expect(b.world.damageStride).toBe(c.blueCount + c.redCount + 4)
  })
})

describe('帝國防空巡邏的第二批敵機', () => {
  const card2 = MISSIONS.axis.find((m) => m.id === 'axis-patrol')!

  it('這張卡真的掛了一個波次', () => {
    // 【為什麼要有這一條】整套波次機制若沒有任何一張卡在用，它就是死碼 ——
    // 而死碼會綠得很好看
    expect(card2.waves).toHaveLength(1)
  })

  it('來的是敵方的戰鬥機，條件是第一批被打薄', () => {
    const w = card2.waves![0]!
    expect(w.side).toBe('theirs')
    expect(w.role).toBe('fighter')
    if (w.when.kind !== 'alive') throw new Error('應該用存活數，不是時鐘')
    expect(w.when.side).toBe('theirs')
    // 【選擇器要在】這一張現在紅隊只有戰鬥機，所以選擇器與不選同值 ——
    // 留著是因為波次一旦掛到有轟炸機的卡上，少了它條件就永遠不成立
    expect(w.when.role).toBe('fighter')
    expect(Number.isFinite(w.when.byLatest)).toBe(true)
  })

  it('加上波次之後兩隊都還在上限內', () => {
    // 【為什麼要驗】容量是照最終架數配的，而 `MAX_COMBATANTS` 是特效池與
    // 效能閘門的依據。掛波次的時候撞破它，症狀會出現在完全無關的地方
    const cfg = missionConfigFrom(card2, 'axis')
    const wave = card2.waves![0]!
    const red = sideCount(cfg.units, 'red') + wave.count
    const blue = sideCount(cfg.units, 'blue')
    expect(red).toBeLessThanOrEqual(MAX_SIDE)
    expect(blue).toBeLessThanOrEqual(MAX_SIDE)
    expect(red + blue).toBeLessThanOrEqual(MAX_COMBATANTS)

    const b = createBattle(new Idle(), cfg, 20260903)
    expect(b.reserve).toEqual([{ team: 'red', count: wave.count }])
    expect(b.world.damageStride).toBe(red + blue)
  })
})
