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
import { DEFAULT_BATTLE, arrivedAt } from '../../src/battle/setup'
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

/**
 * 三中隊箱型。數字照 spec §7.4 的表，**以公尺寫**，不 import 常數 ——
 * 常數改壞時測試跟著變，兩邊一起錯還是全綠。
 */
describe('convoyLine：箱型', () => {
  const SPACING = DEFAULT_BATTLE.schwarmSpacing
  const BLUE_BOX: SideOrder = { fighter: P51D, fighters: 4, bomber: B17G, bombers: 16, box: true }

  function squadron(u: OrderOfBattle, rise: number) {
    return u.filter((f) => f.duty === 'transit' && f.rise === rise)
  }

  it('16 架分成 6 / 5 / 5，每一架仍自成一個小隊', () => {
    const u = convoyLine(HEAD_ON, BLUE_BOX, RED_PLAIN)
    const transit = u.filter((f) => f.duty === 'transit')
    expect(transit).toHaveLength(16)
    for (const f of transit) expect(f.members).toHaveLength(1)
    expect(squadron(u, 0)).toHaveLength(6)
    expect(squadron(u, 250)).toHaveLength(5)
    expect(squadron(u, -250)).toHaveLength(5)
  })

  it('lead 在 −250…+250、同高、不落後，間隔 100 m', () => {
    const lead = squadron(convoyLine(HEAD_ON, BLUE_BOX, RED_PLAIN), 0)
    for (const [i, f] of lead.entries()) {
      expect(f.lane * SPACING).toBeCloseTo(-250 + 100 * i, 9)
      expect(f.depth).toBe(0)
    }
  })

  it('high 在 +50…+450、高 250、後 500；low 左右與高度鏡射', () => {
    const u = convoyLine(HEAD_ON, BLUE_BOX, RED_PLAIN)
    for (const [k, f] of squadron(u, 250).entries()) {
      expect(f.lane * SPACING).toBeCloseTo(50 + 100 * k, 9)
      // 【+ 是落後】藍隊機首朝 −Z
      expect(f.depth).toBe(500)
    }
    for (const [k, f] of squadron(u, -250).entries()) {
      expect(f.lane * SPACING).toBeCloseTo(-50 - 100 * k, 9)
      expect(f.depth).toBe(500)
    }
  })

  it('紅隊的箱型落後在 −Z —— 它的機首朝 +Z', () => {
    const red: SideOrder = { ...RED_CONVOY, bombers: 16, box: true }
    const u = convoyLine(HEAD_ON, BLUE_PLAIN, red)
    for (const f of u.filter((x) => x.duty === 'transit' && x.rise !== 0)) {
      expect(f.depth).toBe(-500)
    }
  })

  it('護航機不受箱型影響', () => {
    const u = convoyLine(HEAD_ON, BLUE_BOX, RED_PLAIN)
    for (const f of u.filter((x) => x.duty === 'combat')) {
      expect('rise' in f).toBe(false)
      expect('depth' in f).toBe(false)
    }
  })

  /** 【退化】沒開箱型的卡，產出的表一個鍵都不多 */
  it('不開箱型時 transit 身上沒有 rise 與 depth', () => {
    for (const f of convoyLine(HEAD_ON, BLUE_ESCORT, RED_CONVOY)) {
      expect('rise' in f).toBe(false)
      expect('depth' in f).toBe(false)
    }
  })

  it('產出的表通得過 assertOrderOfBattle', () => {
    expect(() => assertOrderOfBattle(convoyLine(HEAD_ON, BLUE_BOX, RED_PLAIN))).not.toThrow()
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
      vitalHp: 1,
      redInbound: false,
      convoyAlive: 4,
      convoyLead: 17000,
      convoyArrived: 0,
      redKilled: 0,
      redKilledBombers: 0,
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
    stepMission(r, inputs({ convoyArrived: 1, convoyAlive: 3 }), DT, a)
    expect(a.outcome).toBe('victory')

    const b = createMissionState(r)
    stepMission(r, inputs({ convoyAlive: 0, convoyLead: Infinity }), DT, b)
    expect(b.outcome).toBe('defeat')
  })

  it('攔截：同樣兩件事，勝負互換', () => {
    const r = rules('red')
    const a = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 1, convoyAlive: 3 }), DT, a)
    expect(a.outcome).toBe('defeat')

    const b = createMissionState(r)
    stepMission(r, inputs({ convoyAlive: 0, convoyLead: Infinity }), DT, b)
    expect(b.outcome).toBe('victory')
  })

  /**
   * 【為什麼不再用 `convoyLead` 判抵達】「進過圈」是跨步累積的，而
   * `stepMission` 只看當步快照 —— 從距離推的話，一架在圈裡待一秒會被算成
   * 兩百多架抵達。半徑與 NaN 的防線因此搬到 `arrivedAt`，見下面那一組。
   */
  it('領頭距離只餵目標列，不參與判定', () => {
    const r = rules('blue')
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyLead: 1, convoyArrived: 0 }), DT, s)
    expect(s.outcome).toBe('fighting')
    expect(s.metric).toBe(1)
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

  it('定案之後不再改任何欄位', () => {
    const r = rules('blue')
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 1, convoyAlive: 4 }), DT, s)
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

/**
 * 抵達的兩條防線。**規則不再自己判距離**（見上面那一組的註解），這兩件事
 * 因此搬到 `setup.ts` 每步掃描時呼叫的這一支。
 */
describe('arrivedAt：進圈的判定', () => {
  it('圈內算、圈外不算', () => {
    expect(arrivedAt(999, 1000)).toBe(true)
    expect(arrivedAt(1001, 1000)).toBe(false)
  })

  it('剛好在半徑上不算 —— 嚴格小於', () => {
    expect(arrivedAt(1000, 1000)).toBe(false)
  })

  /**
   * 【代價很大所以要釘死】位置壞掉時誤判成抵達的話，任務會在玩家還在半路
   * 時突然結束，而畫面上沒有任何異常。
   */
  it('距離是 NaN 時不算', () => {
    expect(arrivedAt(NaN, 1000)).toBe(false)
  })

  it('一架都不剩時的 Infinity 也不算', () => {
    expect(arrivedAt(Infinity, 1000)).toBe(false)
  })
})

describe('stepMission：護送的門檻 need', () => {
  const goal = new Vector3(-750, 4000, -12000)
  function rules(owner: Team, need?: number): MissionRules {
    return need === undefined
      ? { kind: 'convoy', owner, point: goal, radius: 1000 }
      : { kind: 'convoy', owner, point: goal, radius: 1000, need }
  }
  function inputs(over: Partial<MissionInputs> = {}): MissionInputs {
    return {
      aliveBlue: 20,
      aliveRed: 10,
      playerPos: new Vector3(0, 4000, 5000),
      playerAlive: true,
      shipsSunk: 0,
      shipsTotal: 0,
      targetsDestroyed: 0,
      targetsTotal: 0,
      vitalSunk: 0,
      vitalHp: 1,
      redInbound: false,
      convoyAlive: 16,
      convoyLead: 17000,
      convoyArrived: 0,
      redKilled: 0,
      redKilledBombers: 0,
      ...over,
    }
  }

  /**
   * 【最重要的一條】沒寫 `need` 的卡一個位元都不該動。這一條一紅，代表
   * 改版把既有的四張卡也一起改了。
   */
  it('省略 need 時逐字等於「任一架抵達就定案」', () => {
    const r = rules('blue')
    const one = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 1, convoyAlive: 15 }), DT, one)
    expect(one.outcome).toBe('victory')

    const none = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 0, convoyAlive: 0 }), DT, none)
    expect(none.outcome).toBe('defeat')
  })

  it('送到門檻才算贏，差一架還在打', () => {
    const r = rules('blue', 8)
    const near = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 7, convoyAlive: 9 }), DT, near)
    expect(near.outcome).toBe('fighting')

    const done = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 8, convoyAlive: 8 }), DT, done)
    expect(done.outcome).toBe('victory')
  })

  it('送超過門檻也算贏', () => {
    const r = rules('blue', 8)
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 11, convoyAlive: 5 }), DT, s)
    expect(s.outcome).toBe('victory')
  })

  /**
   * 【這是門檻帶來的新敗北條件】沒有它，16 架剩 7 架的玩家還要再飛兩分鐘
   * 才知道自己輸了 —— 而那兩分鐘裡每一個數字都正常。
   */
  it('湊不到門檻就當場判敗，不等全滅', () => {
    const r = rules('blue', 8)
    const s = createMissionState(r)
    // 送到 3 架、路上還剩 4 架 —— 最多只到 7，門檻是 8
    stepMission(r, inputs({ convoyArrived: 3, convoyAlive: 4 }), DT, s)
    expect(s.outcome).toBe('defeat')
    expect(s.remaining).toBe(4)
  })

  it('剛好還湊得到就繼續打', () => {
    const r = rules('blue', 8)
    const s = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 3, convoyAlive: 5 }), DT, s)
    expect(s.outcome).toBe('fighting')
  })

  it('攔截側：放過去門檻那麼多架就輸，湊不到就贏', () => {
    const r = rules('red', 8)
    const through = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 8, convoyAlive: 8 }), DT, through)
    expect(through.outcome).toBe('defeat')

    const stopped = createMissionState(r)
    stepMission(r, inputs({ convoyArrived: 3, convoyAlive: 4 }), DT, stopped)
    expect(stopped.outcome).toBe('victory')
  })

  it('有門檻才寫 arrived，沒門檻恆是 −1', () => {
    const withNeed = createMissionState(rules('blue', 8))
    // 開局就是 0：「還沒送到任何一架」是實話
    expect(withNeed.arrived).toBe(0)
    stepMission(rules('blue', 8), inputs({ convoyArrived: 3, convoyAlive: 13 }), DT, withNeed)
    expect(withNeed.arrived).toBe(3)

    const plain = createMissionState(rules('blue'))
    expect(plain.arrived).toBe(-1)
    stepMission(rules('blue'), inputs({ convoyArrived: 0, convoyAlive: 4 }), DT, plain)
    expect(plain.arrived).toBe(-1)
  })

  it('換到別種規則時 arrived 要歸 −1', () => {
    const s = createMissionState(rules('blue', 8))
    expect(s.arrived).toBe(0)
    resetMissionState({ kind: 'annihilate' }, s)
    expect(s.arrived).toBe(-1)
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
