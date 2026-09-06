import { describe, it, expect } from 'vitest'
import {
  ALL_SPECS, battleConfigFrom, specOf as specById, uniform,
  addFlight, setCount, removeFlight, setLead, applyPreset, flightsTotal,
  HISTORICAL, topSpeedKmh, PRESETS,
  ALTITUDES, DEFAULT_SKIRMISH, MAX_COMBATANTS, MAX_SIDE, MIN_SIDE, MAX_FLIGHTS,
  type SkirmishSetup, type Flight,
} from '../../src/battle/skirmish'
import type { BattleConfig } from '../../src/battle/setup'
import { mixedLine, sideCount, sideSummary, assertOrderOfBattle } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

describe('機種名單', () => {
  it('遭遇戰的名單全部一起列 —— 混搭之後陣營不再是一個選擇', () => {
    expect(ALL_SPECS.map((s) => s.id)).toEqual(
      ['p51d', 'bf109k4', 'f6f5', 'f4f4', 'ki84', 'a6m5', 'b17g', 'he111', 'g4m'])
  })

  it('戰鬥機在前、轟炸機在後', () => {
    const roles = ALL_SPECS.map((s) => s.role)
    expect(roles.lastIndexOf('fighter')).toBeLessThan(roles.indexOf('bomber'))
  })

  it('未知的代號落回第一台 —— 名單是從 DOM 來的', () => {
    expect(specById('不存在').id).toBe(ALL_SPECS[0]!.id)
    expect(specById('he111').id).toBe('he111')
  })

  /**
   * 【極速不在 `AircraftSpec` 上】它在各機種檔另外匯出的 `HistoricalReference`
   * 。少一格是測試紅，不是編組頁上少一個數字。
   */
  it('八台都有史實極速可以顯示', () => {
    for (const s of ALL_SPECS) {
      expect(HISTORICAL[s.id], s.id).toBeDefined()
      expect(topSpeedKmh(s.id), s.id).toBeGreaterThan(300)
    }
    // 442 mph = 711 km/h（specs/p51d.ts 的 vmaxAtCritical）
    expect(topSpeedKmh('p51d')).toBe(711)
  })
})

const FIELD = { terrain: 'archipelago', altitude: 4000, timeOfDay: 'noon' } as const
const F = (id: string, count: number): Flight => ({ id, count })
const mk = (blue: Flight[], red: Flight[], lead = 0): SkirmishSetup =>
  ({ ...FIELD, blue, red, lead })

const leadOf = (c: BattleConfig, team: 'blue' | 'red') =>
  c.units.find((u) => u.team === team)!.members[0]!

/**
 * 【第一條是全部的重點】`uniform(20, 20)` 換走 `flightLine` 之後，編組表必須
 * 與舊路徑 `mixedLine(逐架名單, 8)` 逐項相同 —— 對照組留在這裡，不是靠記憶。
 */
describe('battleConfigFrom（分隊清單）', () => {
  it('預設 20v20 的編組表與舊路徑逐項相同', () => {
    const want = mixedLine(
      HEAD_ON,
      Array.from({ length: 20 }, () => P51D),
      Array.from({ length: 20 }, () => BF109K4),
      8,
    )
    const got = battleConfigFrom(DEFAULT_SKIRMISH).units
    expect(got.length).toBe(want.length)
    for (let i = 0; i < want.length; i++) {
      const g = got[i]!
      const w = want[i]!
      expect(g.team).toBe(w.team)
      expect(g.lane).toBe(w.lane)
      expect(g.tier).toBe(w.tier)
      expect(g.duty).toBe(w.duty)
      expect(g.entry).toBe(w.entry)
      expect(g.player).toBe(w.player)
      expect(g.members.map((m) => m.id)).toEqual(w.members.map((m) => m.id))
    }
  })

  it('兩隊各自的機種照抄', () => {
    const c = battleConfigFrom(uniform('p51d', 20, 'bf109k4', 20))
    expect(leadOf(c, 'blue').id).toBe('p51d')
    expect(leadOf(c, 'red').id).toBe('bf109k4')
  })

  it('藍隊可以開 Bf109 —— 換的是機種不是隊伍顏色', () => {
    const c = battleConfigFrom(uniform('bf109k4', 4, 'p51d', 4))
    expect(leadOf(c, 'blue').id).toBe('bf109k4')
    expect(leadOf(c, 'red').id).toBe('p51d')
  })

  it('分隊各自一種機種，3 架一隊不會跟下一隊混隊', () => {
    const c = battleConfigFrom(mk([F('p51d', 4), F('b17g', 3)], [F('he111', 2)]))
    expect(sideSummary(c.units, 'blue')).toBe('4 × p51d + 3 × b17g')
    expect(sideSummary(c.units, 'red')).toBe('2 × he111')
    expect(c.units.filter((u) => u.team === 'blue')[1]!.members.length).toBe(3)
  })

  it('架數就是分隊架數的和', () => {
    const c = battleConfigFrom(uniform('p51d', 3, 'bf109k4', 7))
    expect(sideCount(c.units, 'blue')).toBe(3)
    expect(sideCount(c.units, 'red')).toBe(7)
  })

  it('空名單補一架 —— 設定頁的中間狀態不該讓 createBattle 拋例外', () => {
    const c = battleConfigFrom(mk([], []))
    expect(sideCount(c.units, 'blue')).toBe(MIN_SIDE)
    expect(sideCount(c.units, 'red')).toBe(MIN_SIDE)
    expect(() => assertOrderOfBattle(c.units)).not.toThrow()
  })

  it('超編砍到 20', () => {
    const c = battleConfigFrom(mk(Array.from({ length: 9 }, () => F('p51d', 4)), [F('p51d', 1)]))
    expect(sideCount(c.units, 'blue')).toBe(MAX_SIDE)
  })

  /**
   * 【lead 的夾制不能消失】`flightLine` 對超界是丟錯的；這裡是 UI 語意的
   * 邊界，要夾。症狀否則是 `assertOrderOfBattle`「必須恰好有一筆 player」
   * —— 按下起飛直接白畫面。
   */
  it('lead 超界仍恰好一筆 player', () => {
    for (const lead of [99, -3, NaN, 4]) {
      const c = battleConfigFrom(mk([F('p51d', 4)], [F('p51d', 1)], lead))
      expect(c.units.filter((u) => u.player === true).length).toBe(1)
      expect(() => assertOrderOfBattle(c.units)).not.toThrow()
    }
  })

  it('我帶哪一隊，那一隊的長機就是我開的', () => {
    const c = battleConfigFrom(mk([F('p51d', 4), F('b17g', 4)], [F('p51d', 1)], 1))
    const lead = c.units.find((u) => u.player === true)!
    expect(lead.members[0]!.id).toBe('b17g')
  })

  it('其餘欄位沿用 DEFAULT_BATTLE 的幾何', () => {
    const c = battleConfigFrom(DEFAULT_SKIRMISH)
    expect(c.entryRange).toBeGreaterThan(0)
    expect(c.altitude).toBeGreaterThan(0)
    expect(c.tas).toBeGreaterThan(0)
  })
})

describe('常數', () => {
  it('上下限是 1 與 20，容量是兩倍，隊數上限是 5', () => {
    expect(MIN_SIDE).toBe(1)
    expect(MAX_SIDE).toBe(20)
    expect(MAX_COMBATANTS).toBe(MAX_SIDE * 2)
    expect(MAX_FLIGHTS).toBe(MAX_SIDE / SCHWARM_SIZE)
  })

  it('預設是五隊 P-51D 對五隊 Bf109，每隊四架', () => {
    const d = DEFAULT_SKIRMISH
    expect(d.blue).toEqual(Array.from({ length: 5 }, () => F('p51d', 4)))
    expect(d.red).toEqual(Array.from({ length: 5 }, () => F('bf109k4', 4)))
    expect(flightsTotal(d.blue)).toBe(20)
  })

  it('預設我帶第 2 隊 —— 就是舊路徑 playerAt = 8 那一隊，出生基準沒有位移', () => {
    expect(DEFAULT_SKIRMISH.lead).toBe(2)
  })

  it('uniform 的隊數與尾隊架數', () => {
    expect(uniform('p51d', 7, 'bf109k4', 1).blue).toEqual([F('p51d', 4), F('p51d', 3)])
    expect(uniform('p51d', 1, 'bf109k4', 1).blue).toEqual([F('p51d', 1)])
    expect(uniform('p51d', 20, 'bf109k4', 1).blue.length).toBe(5)
  })
})

/**
 * 編組頁上的動作。**它們住在資料層而不是 `ui/menu.ts`**：「我帶的那一隊
 * 有沒有跟著動」是最容易錯又最看不出來的一件事 —— 症狀只是一列消失，
 * 然後玩家默默換了一台飛機開。
 */
describe('分隊的加減與帶隊', () => {
  it('加一隊在末端，預設四架', () => {
    const s = addFlight(mk([F('p51d', 4)], [F('bf109k4', 4)]), 'blue', 'b17g')
    expect(s.blue).toEqual([F('p51d', 4), F('b17g', 4)])
  })

  // 【沒有「剩不到四架」這條】隊數上限 5 × 每隊 4 = 架數上限 20：四隊以內
  // 剩餘一定 ≥ 4，第五隊之後走「隊數滿」。那個分支在這組上限下踩不到。

  it('滿 20 架時原樣回傳（同一個物件）', () => {
    const full = uniform('p51d', MAX_SIDE, 'bf109k4', 1)
    expect(addFlight(full, 'blue', 'b17g')).toBe(full)
  })

  it('滿 5 隊時原樣回傳，就算架數還沒滿', () => {
    const five = mk(Array.from({ length: 5 }, () => F('p51d', 1)), [])
    expect(addFlight(five, 'blue', 'b17g')).toBe(five)
  })

  it('敵方那一側同樣加隊，不碰我方', () => {
    const s = addFlight(mk([F('p51d', 4)], [F('bf109k4', 4)], 0), 'red', 'f6f5')
    expect(s.red).toEqual([F('bf109k4', 4), F('f6f5', 4)])
    expect(s.blue).toEqual([F('p51d', 4)])
    expect(s.lead).toBe(0)
  })

  it('setCount 夾在 1..4', () => {
    const s = mk([F('p51d', 2)], [])
    expect(setCount(s, 'blue', 0, 4).blue[0]!.count).toBe(4)
    expect(setCount(s, 'blue', 0, 9).blue[0]!.count).toBe(4)
  })

  it('setCount 不讓總數超過 20', () => {
    // 4×4 + 2 = 18；把那 2 架的隊加到 4 會變 20（剛好）；再加不動
    const s = mk([F('p51d', 4), F('p51d', 4), F('p51d', 4), F('p51d', 4), F('b17g', 2)], [])
    const t = setCount(s, 'blue', 4, 4)
    expect(flightsTotal(t.blue)).toBe(20)
    const u = mk([F('p51d', 4), F('p51d', 4), F('p51d', 4), F('p51d', 4), F('b17g', 3)], [])
    // 剩 1 架，要 +2 → 只到 4
    expect(setCount(u, 'blue', 4, 5).blue[4]!.count).toBe(4)
  })

  it('setCount 到 0 等於拿掉那一隊', () => {
    const s = setCount(mk([F('p51d', 4), F('b17g', 1)], [], 0), 'blue', 1, 0)
    expect(s.blue).toEqual([F('p51d', 4)])
  })

  it('拿掉我帶的隊前面那一隊，lead 跟著往前 —— 還是同一隊', () => {
    const s = removeFlight(mk([F('p51d', 4), F('b17g', 4), F('he111', 4)], [], 2), 'blue', 0)
    expect(s.blue).toEqual([F('b17g', 4), F('he111', 4)])
    expect(s.blue[s.lead]!.id).toBe('he111')
  })

  it('拿掉我帶的隊後面那一隊，lead 不動', () => {
    const s = removeFlight(mk([F('p51d', 4), F('b17g', 4), F('he111', 4)], [], 0), 'blue', 2)
    expect(s.lead).toBe(0)
    expect(s.blue[s.lead]!.id).toBe('p51d')
  })

  it('拿掉我帶的那一隊，lead 留在原地 —— 也就是接下來那一隊', () => {
    const s = removeFlight(mk([F('p51d', 4), F('b17g', 4), F('he111', 4)], [], 1), 'blue', 1)
    expect(s.blue[s.lead]!.id).toBe('he111')
  })

  it('拿掉最後一隊而我就帶那一隊，lead 退回清單之內', () => {
    const s = removeFlight(mk([F('p51d', 4), F('b17g', 4)], [], 1), 'blue', 1)
    expect(s.lead).toBe(0)
  })

  it('可以刪到空，lead 是 0', () => {
    const s = removeFlight(mk([F('p51d', 4)], [], 0), 'blue', 0)
    expect(s.blue).toEqual([])
    expect(s.lead).toBe(0)
  })

  it('動紅隊不碰 lead', () => {
    const s = removeFlight(mk([F('p51d', 4), F('b17g', 4)], [F('p51d', 4), F('he111', 4)], 1), 'red', 0)
    expect(s.red).toEqual([F('he111', 4)])
    expect(s.lead).toBe(1)
  })

  it('setLead', () => {
    const s = setLead(mk([F('p51d', 4), F('b17g', 4)], []), 1)
    expect(s.lead).toBe(1)
  })

  it('加減分隊不會弄丟地形與高度', () => {
    const base = { ...DEFAULT_SKIRMISH, terrain: 'sea' as const, altitude: 600 }
    const s = removeFlight(addFlight(base, 'blue', 'he111'), 'red', 0)
    expect(s.terrain).toBe('sea')
    expect(s.altitude).toBe(600)
  })
})

/**
 * 四個想定（spec §3.3 的表）。**編成是定案的資料，不是預設值** —— 改了要
 * 改這裡的斷言，而不是靜靜地換一組。
 */
describe('想定', () => {
  it('四個都在，鍵名固定', () => {
    expect(Object.keys(PRESETS)).toEqual(['even', 'escort', 'few', 'hunt'])
  })

  it('勢均力敵：P-51D 4,4 對 Bf 109 4,4', () => {
    const s = applyPreset(DEFAULT_SKIRMISH, 'even')
    expect(s.blue).toEqual([F('p51d', 4), F('p51d', 4)])
    expect(s.red).toEqual([F('bf109k4', 4), F('bf109k4', 4)])
  })

  it('護航突破：P-51D 4 + B-17G 4 對 Bf 109 4,4,2', () => {
    const s = applyPreset(DEFAULT_SKIRMISH, 'escort')
    expect(s.blue).toEqual([F('p51d', 4), F('b17g', 4)])
    expect(s.red).toEqual([F('bf109k4', 4), F('bf109k4', 4), F('bf109k4', 2)])
  })

  it('以寡擊眾：Ki-84 3 對 F6F-5 4,4,2', () => {
    const s = applyPreset(DEFAULT_SKIRMISH, 'few')
    expect(s.blue).toEqual([F('ki84', 3)])
    expect(s.red).toEqual([F('f6f5', 4), F('f6f5', 4), F('f6f5', 2)])
  })

  it('轟炸機獵殺：Bf 109 4,4 對 B-17G 4,4 + P-51D 2', () => {
    const s = applyPreset(DEFAULT_SKIRMISH, 'hunt')
    expect(s.blue).toEqual([F('bf109k4', 4), F('bf109k4', 4)])
    expect(s.red).toEqual([F('b17g', 4), F('b17g', 4), F('p51d', 2)])
  })

  /**
   * 【lead 重設為 0】從 lead = 4 套「以寡擊眾」（我方只有一隊）而保留 lead，
   * `flightLine` 不會有任何 player。
   */
  it('套想定後 lead 是 0，而且每個想定都建得出恰好一筆 player', () => {
    const from = { ...DEFAULT_SKIRMISH, lead: 4 }
    for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const s = applyPreset(from, k)
      expect(s.lead).toBe(0)
      const c = battleConfigFrom(s)
      expect(c.units.filter((u) => u.player === true).length).toBe(1)
      expect(() => assertOrderOfBattle(c.units)).not.toThrow()
    }
  })

  it('想定不動地形與高度', () => {
    const s = applyPreset({ ...DEFAULT_SKIRMISH, terrain: 'sea', altitude: 600 }, 'hunt')
    expect(s.terrain).toBe('sea')
    expect(s.altitude).toBe(600)
  })

  it('每個想定都在架數與隊數上限之內', () => {
    for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const s = applyPreset(DEFAULT_SKIRMISH, k)
      for (const side of [s.blue, s.red]) {
        expect(flightsTotal(side)).toBeLessThanOrEqual(MAX_SIDE)
        expect(side.length).toBeLessThanOrEqual(MAX_FLIGHTS)
        for (const f of side) expect(f.count).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('遭遇戰的地形與開場高度', () => {
  it('預設等於現況 —— 不動設定的人玩到的規則一個字都沒變', () => {
    expect(DEFAULT_SKIRMISH.terrain).toBe('archipelago')
    expect(DEFAULT_SKIRMISH.altitude).toBe(4000)
    expect(battleConfigFrom(DEFAULT_SKIRMISH).altitude).toBe(4000)
  })

  it('三個高度都接得到 BattleConfig', () => {
    for (const a of ALTITUDES) {
      expect(battleConfigFrom({ ...DEFAULT_SKIRMISH, altitude: a.value }).altitude).toBe(a.value)
    }
  })

  it('甲板那一格低於島頂 —— 山才擋得住路', () => {
    expect(ALTITUDES[0]!.value).toBeLessThan(900)
  })

  it('不在白名單上的高度退回預設，不是 NaN', () => {
    for (const bad of [Number.NaN, -1, 0, 800, 99999]) {
      const c = battleConfigFrom({ ...DEFAULT_SKIRMISH, altitude: bad })
      expect(c.altitude).toBe(4000)
      expect(Number.isFinite(c.altitude)).toBe(true)
    }
  })

  it('地形不進 BattleConfig —— 它由 main.ts 交給 createTerrain', () => {
    const c = battleConfigFrom({ ...DEFAULT_SKIRMISH, terrain: 'sea' })
    expect('terrain' in c).toBe(false)
  })
})
