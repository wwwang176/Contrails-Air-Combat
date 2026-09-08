import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  CONVOY_LANE, CONVOY_TIER, ESCORT_TIER,
  assertOrderOfBattle, convoyLine, sideCount,
  type OrderOfBattle, type SideOrder,
} from '../../src/battle/order'
import {
  createMissionState, resetMissionState, stepMission,
  type MissionInputs, type MissionRules,
} from '../../src/battle/mission'
import { pickTakeover } from '../../src/battle/takeover'
import { createFlights } from '../../src/battle/flights'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'
import type { Team } from '../../src/world/World'

const DT = 1 / 240

/** 四架 P-51 護送四架 B-17，對面十架 Bf109 —— 就是 `allies-escort` 那張卡 */
const BLUE_ESCORT: SideOrder = { fighter: P51D, fighters: 4, bomber: B17G, bombers: 4 }
const RED_PLAIN: SideOrder = { fighter: BF109K4, fighters: 10, bomber: null, bombers: 0 }
/** 反過來：紅隊帶轟炸機，就是 `allies-intercept` */
const BLUE_PLAIN: SideOrder = { fighter: P51D, fighters: 4, bomber: null, bombers: 0 }
const RED_CONVOY: SideOrder = { fighter: BF109K4, fighters: 4, bomber: HE111, bombers: 4 }

describe('convoyLine', () => {
  it('被護送的每一架自成一個小隊', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN)
    const transit = u.filter((f) => f.duty === 'transit')
    expect(transit).toHaveLength(4)
    for (const f of transit) expect(f.members).toHaveLength(1)
  })

  it('護航機照 SCHWARM_SIZE 分隊，被護送的不分', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN)
    // 藍：1 支四機 + 4 支單機；紅：10 架 → 4 + 4 + 2
    expect(u.filter((f) => f.team === 'blue')).toHaveLength(5)
    expect(u.filter((f) => f.team === 'red')).toHaveLength(3)
    expect(sideCount(u, 'blue')).toBe(8)
    expect(sideCount(u, 'red')).toBe(10)
  })

  it('藍隊全部排在紅隊之前 —— world.add 的順序決定索引', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_CONVOY)
    const firstRed = u.findIndex((f) => f.team === 'red')
    expect(u.slice(0, firstRed).every((f) => f.team === 'blue')).toBe(true)
    expect(u.slice(firstRed).every((f) => f.team === 'red')).toBe(true)
  })

  it('被護送的置中、間隔是 CONVOY_LANE', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN)
    const lanes = u.filter((f) => f.duty === 'transit').map((f) => f.lane)
    expect(lanes).toEqual([
      -1.5 * CONVOY_LANE, -0.5 * CONVOY_LANE, 0.5 * CONVOY_LANE, 1.5 * CONVOY_LANE,
    ])
    // 【置中】對稱，總和為 0
    expect(lanes.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12)
  })

  it('護航機在上層、被護送的在下層', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN)
    for (const f of u) {
      expect(f.tier).toBe(f.duty === 'transit' ? CONVOY_TIER : ESCORT_TIER)
    }
    // altitudeOffset 的鋸齒把 0 映到 −spread、4 映到 +spread，所以護航機在上面
    expect(ESCORT_TIER).toBeGreaterThan(CONVOY_TIER)
  })

  it('玩家在藍隊中間那一支戰鬥機小隊的長機，而且不是被護送的那一架', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN)
    const players = u.filter((f) => f.player === true)
    expect(players).toHaveLength(1)
    expect(players[0]!.team).toBe('blue')
    expect(players[0]!.duty).toBe('combat')
    expect(players[0]!.members[0]).toBe(P51D)
  })

  it('沒有轟炸機的那一隊一架 transit 都不產', () => {
    const u = convoyLine(HEAD_ON, BLUE_PLAIN, RED_CONVOY)
    expect(u.filter((f) => f.team === 'blue' && f.duty === 'transit')).toHaveLength(0)
    expect(u.filter((f) => f.team === 'red' && f.duty === 'transit')).toHaveLength(4)
  })

  it('產出的表通得過 assertOrderOfBattle', () => {
    expect(() => assertOrderOfBattle(convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN))).not.toThrow()
    expect(() => assertOrderOfBattle(convoyLine(HEAD_ON, BLUE_PLAIN, RED_CONVOY))).not.toThrow()
  })

  it('每個小隊的架數都在 createFlights 收得下的範圍內', () => {
    const u = convoyLine(HEAD_ON, BLUE_ESCORT, RED_CONVOY)
    const sizes = u.map((f) => f.members.length)
    const seats = u.flatMap((f) => f.members.map(() => ({ alive: true, team: f.team })))
      .map((s, index) => ({ ...s, index }))
    expect(() => createFlights(seats, 0, sizes)).not.toThrow()
  })
})

describe('assertOrderOfBattle：被護送者的兩條新規則', () => {
  const base = convoyLine(HEAD_ON, BLUE_ESCORT, RED_PLAIN)

  it('transit 超過一架就擋 —— 僚機會為了站位大滾轉', () => {
    const bad: OrderOfBattle = base.map((f) => (f.duty === 'transit'
      ? { ...f, members: [B17G, B17G] }
      : f))
    expect(() => assertOrderOfBattle(bad)).toThrow(/transit 的小隊必須恰好一架/)
  })

  it('玩家不能坐進 transit', () => {
    const bad: OrderOfBattle = [
      { team: 'blue', members: [B17G], entry: HEAD_ON.blue, duty: 'transit', lane: 0, tier: 0, player: true },
      ...base.filter((f) => f.player !== true),
    ]
    expect(() => assertOrderOfBattle(bad)).toThrow(/玩家不能在 transit/)
  })
})

describe('stepMission：護送與攔截共用的一條規則', () => {
  const goal = new Vector3(-750, 4000, -12000)
  function rules(owner: Team): MissionRules {
    return { kind: 'convoy', owner, point: goal, radius: 1000 }
  }
  function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
    return {
      aliveBlue: 8,
      aliveRed: 10,
      playerPos: new Vector3(0, 4000, 5000),
      playerAlive: true,
      shipsSunk: 0,
      shipsTotal: 0,
      targetsDestroyed: 0,
      targetsTotal: 0,
      vitalSunk: 0,
      redInbound: false,
      convoyAlive: 4,
      convoyLead: 17000,
      ...over,
    }
  }

  it('開局：圓環在終點、剩餘架數先給「不知道」', () => {
    const s = createMissionState(rules('blue'))
    expect(s.hasTarget).toBe(true)
    expect(s.target.equals(goal)).toBe(true)
    expect(s.targetRadius).toBe(1000)
    expect(s.secondsLeft).toBe(Infinity)
    // −1 = 不畫。給 0 會讓「還沒開始」長得像「全滅」
    expect(s.remaining).toBe(-1)
  })

  it('護送：抵達就贏、全滅就輸', () => {
    const r = rules('blue')
    const a = createMissionState(r)
    stepMission(r, inputs({ convoyLead: 999 }), DT, a)
    expect(a.outcome).toBe('victory')

    const b = createMissionState(r)
    stepMission(r, inputs({ convoyAlive: 0, convoyLead: Infinity }), DT, b)
    expect(b.outcome).toBe('defeat')
  })

  it('攔截：同樣兩件事，勝負互換', () => {
    const r = rules('red')
    const a = createMissionState(r)
    stepMission(r, inputs({ convoyLead: 999 }), DT, a)
    expect(a.outcome).toBe('defeat')

    const b = createMissionState(r)
    stepMission(r, inputs({ convoyAlive: 0, convoyLead: Infinity }), DT, b)
    expect(b.outcome).toBe('victory')
  })

  it('抵達判定用的是嚴格小於半徑', () => {
    const r = rules('blue')
    const on = createMissionState(r)
    stepMission(r, inputs({ convoyLead: 1000 }), DT, on)
    expect(on.outcome).toBe('fighting')
  })

  it('攔截時我方全滅算輸 —— 上面兩條都涵蓋不到', () => {
    const r = rules('red')
    const s = createMissionState(r)
    stepMission(r, inputs({ aliveBlue: 0 }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('護送時我方全滅也是輸，而且與「全部被擊落」是同一件事', () => {
    const r = rules('blue')
    const s = createMissionState(r)
    stepMission(r, inputs({ aliveBlue: 0, convoyAlive: 0, convoyLead: Infinity }), DT, s)
    expect(s.outcome).toBe('defeat')
  })

  it('兩個計量都寫出來：距離與剩餘架數', () => {
    const r = rules('blue')
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyLead: 8123, convoyAlive: 2 }), DT, s)
    expect(s.metric).toBe(8123)
    expect(s.remaining).toBe(2)
  })

  it('位置壞掉（NaN）不會誤判成抵達', () => {
    const r = rules('blue')
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyLead: NaN }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('定案之後不再改任何欄位', () => {
    const r = rules('blue')
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyLead: 10 }), DT, s)
    expect(s.outcome).toBe('victory')
    stepMission(r, inputs({ convoyAlive: 0, convoyLead: Infinity }), DT, s)
    expect(s.outcome).toBe('victory')
    expect(s.remaining).toBe(4)
  })

  it('換到別種規則時 remaining 要歸 −1，否則目標列會留著上一場的架數', () => {
    const s = createMissionState(rules('blue'))
    stepMission(rules('blue'), inputs({ convoyAlive: 3 }), DT, s)
    expect(s.remaining).toBe(3)
    resetMissionState({ kind: 'annihilate' }, s)
    expect(s.remaining).toBe(-1)
    expect(s.hasTarget).toBe(false)
  })
})

describe('pickTakeover：被護送的不進接手名單', () => {
  /** 座位 0~3 是玩家那一隊的戰鬥機，4~7 是被護送的 */
  const seats = Array.from(
    { length: 8 },
    (_, index) => ({ index, alive: true, team: 'blue' as Team }),
  )
  const sizes = [4, 1, 1, 1, 1]
  const convoy = [4, 5, 6, 7]

  it('同小隊還有人時照常接手', () => {
    const fi = createFlights(seats, 0, sizes)
    expect(pickTakeover(fi, seats, 0, convoy)).toBe(1)
  })

  it('同小隊死光時**不會**掉到被護送的那幾架身上', () => {
    const dead = seats.map((s, i) => ({ ...s, alive: i === 0 || i > 3 }))
    const fi = createFlights(dead, 0, sizes)
    // 沒有排除的話會接到座位 4（一架轟炸機）
    expect(pickTakeover(fi, dead, 0)).toBe(4)
    // 排除之後沒有人可接
    expect(pickTakeover(fi, dead, 0, convoy)).toBe(-1)
  })

  it('清單是空的時候逐字如舊', () => {
    const fi = createFlights(seats, 0, sizes)
    expect(pickTakeover(fi, seats, 0, [])).toBe(pickTakeover(fi, seats, 0))
  })
})
