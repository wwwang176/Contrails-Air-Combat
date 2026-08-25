import { describe, it, expect } from 'vitest'
import {
  ALL_SPECS, battleConfigFrom, specOf as specById, specsFor, uniform,
  withAircraft, withoutAircraft,
  DEFAULT_SKIRMISH, MAX_COMBATANTS, MAX_SIDE, MIN_SIDE,
  type SkirmishSetup,
} from '../../src/battle/skirmish'
import type { BattleConfig } from '../../src/battle/setup'
import { sideCount, sideSummary } from '../../src/battle/order'

describe('機種名單', () => {
  it('遭遇戰的名單四台一起列 —— 混搭之後陣營不再是一個選擇', () => {
    expect(ALL_SPECS.map((s) => s.id)).toEqual(['p51d', 'bf109k4', 'b17g', 'he111'])
  })

  it('任務模式仍然分陣營，而且兩邊沒有交集', () => {
    const allies = specsFor('allies').map((s) => s.id)
    for (const s of specsFor('axis')) expect(allies).not.toContain(s.id)
  })

  it('未知的代號落回第一台 —— 名單是從 DOM 來的', () => {
    expect(specById('不存在').id).toBe(ALL_SPECS[0]!.id)
    expect(specById('he111').id).toBe('he111')
  })
})

/** 某一隊出場的第一架。改動前讀 `cfg.blueSpec`，現在從編組表算出同一件事。 */
const leadOf = (c: BattleConfig, team: 'blue' | 'red') =>
  c.units.find((u) => u.team === team)!.members[0]!

describe('battleConfigFrom（M10 spec §7、2026-08-21 換成逐架名單）', () => {
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

  it('一隊裡可以混搭 —— P-51 與 Bf109 同一隊', () => {
    const c = battleConfigFrom({
      blue: ['p51d', 'bf109k4', 'b17g'], red: ['he111', 'p51d'], playerAt: 0,
    })
    expect(sideSummary(c.units, 'blue')).toBe('1 × p51d + 1 × bf109k4 + 1 × b17g')
    expect(sideSummary(c.units, 'red')).toBe('1 × he111 + 1 × p51d')
  })

  it('架數就是名單長度', () => {
    const c = battleConfigFrom(uniform('p51d', 3, 'bf109k4', 7))
    expect(sideCount(c.units, 'blue')).toBe(3)
    expect(sideCount(c.units, 'red')).toBe(7)
  })

  it('超編砍到 20、空名單補一架', () => {
    // 【為什麼要夾】名單從 DOM 來。空的會讓 createBattle 拋例外（玩家沒有
    // 被建立），過長會炸掉特效池的容量假設（`MAX_COMBATANTS`）。
    const over = battleConfigFrom({
      blue: Array.from({ length: 99 }, () => 'p51d'),
      red: [], playerAt: 0,
    })
    expect(sideCount(over.units, 'blue')).toBe(MAX_SIDE)
    expect(sideCount(over.units, 'red')).toBe(MIN_SIDE)
  })

  it('玩家的座位被夾進名單裡 —— 否則編組表會沒有任何一筆 player', () => {
    // 【症狀】`assertOrderOfBattle` 拋「必須恰好有一筆 player」，也就是
    // 按下開始戰鬥直接白畫面。名單縮短之後很容易踩到
    for (const at of [99, -3, NaN]) {
      const c = battleConfigFrom({ blue: ['p51d', 'b17g'], red: ['p51d'], playerAt: at })
      expect(c.units.filter((u) => u.player === true).length).toBe(1)
    }
  })

  it('玩家選第幾架，那一架就是他開的', () => {
    const c = battleConfigFrom({
      blue: ['p51d', 'b17g', 'bf109k4'], red: ['p51d'], playerAt: 1,
    })
    expect(leadOf(c, 'blue').id).toBe('b17g')
  })

  it('其餘欄位沿用 DEFAULT_BATTLE 的幾何', () => {
    const c = battleConfigFrom(DEFAULT_SKIRMISH)
    expect(c.entryRange).toBeGreaterThan(0)
    expect(c.altitude).toBeGreaterThan(0)
    expect(c.tas).toBeGreaterThan(0)
  })
})

describe('常數', () => {
  it('上下限是 1 與 20，容量是兩倍', () => {
    expect(MIN_SIDE).toBe(1)
    expect(MAX_SIDE).toBe(20)
    expect(MAX_COMBATANTS).toBe(MAX_SIDE * 2)
  })

  it('預設是 20 架 P-51D 對 20 架 Bf109', () => {
    const d: SkirmishSetup = DEFAULT_SKIRMISH
    expect(d.blue.length).toBe(20)
    expect(d.red.length).toBe(20)
    expect(new Set(d.blue)).toEqual(new Set(['p51d']))
    expect(new Set(d.red)).toEqual(new Set(['bf109k4']))
  })

  it('預設的玩家座位就是舊路徑的那一架 —— 出生基準沒有位移', () => {
    // 【為什麼釘住 8】`lineAbreast` 的 `playerFlight` 是
    // `floor(ceil(20/4)/2)` = 2，長機座位 2 × 4 = 8。這個數字若變了，
    // `test/fixtures/spawn-baseline.ts` 的「玩家是哪一架」就跟著變
    expect(DEFAULT_SKIRMISH.playerAt).toBe(8)
  })
})

/**
 * 設定頁上那兩個動作。**它們住在資料層而不是 `ui/menu.ts`**，因為
 * 「玩家的座位有沒有跟著動」是最容易錯又最看不出來的一件事 ——
 * 症狀只是一張卡片消失，然後玩家默默換了一台飛機開。
 */
describe('出戰名單的加與減', () => {
  const at = (blue: string[], playerAt: number): SkirmishSetup => (
    { blue, red: ['bf109k4'], playerAt }
  )

  it('加在末端', () => {
    const s = withAircraft(at(['p51d'], 0), 'blue', 'b17g')
    expect(s.blue).toEqual(['p51d', 'b17g'])
  })

  it('滿編時原樣回傳', () => {
    const full = uniform('p51d', MAX_SIDE, 'bf109k4', 1)
    expect(withAircraft(full, 'blue', 'b17g')).toBe(full)
  })

  it('拿掉玩家前面那一架，他跟著往前一格 —— 還是同一台飛機', () => {
    const s = withoutAircraft(at(['p51d', 'b17g', 'he111'], 2), 'blue', 0)
    expect(s.blue).toEqual(['b17g', 'he111'])
    expect(s.blue[s.playerAt]).toBe('he111')
  })

  it('拿掉玩家後面那一架，他不動', () => {
    const s = withoutAircraft(at(['p51d', 'b17g', 'he111'], 0), 'blue', 2)
    expect(s.playerAt).toBe(0)
    expect(s.blue[s.playerAt]).toBe('p51d')
  })

  it('拿掉玩家本人，座位留在原地 —— 也就是接下來那一架', () => {
    const s = withoutAircraft(at(['p51d', 'b17g', 'he111'], 1), 'blue', 1)
    expect(s.blue).toEqual(['p51d', 'he111'])
    expect(s.blue[s.playerAt]).toBe('he111')
  })

  it('拿掉最後一架而玩家就坐在那裡，座位退回名單之內', () => {
    const s = withoutAircraft(at(['p51d', 'b17g'], 1), 'blue', 1)
    expect(s.playerAt).toBe(0)
    expect(s.blue[s.playerAt]).toBe('p51d')
  })

  it('可以刪到空，而且座位不會變成 −1', () => {
    const s = withoutAircraft(at(['p51d'], 0), 'blue', 0)
    expect(s.blue).toEqual([])
    expect(s.playerAt).toBe(0)
  })

  it('動紅隊不會碰到玩家的座位', () => {
    const s = withoutAircraft({ blue: ['p51d', 'b17g'], red: ['p51d', 'he111'], playerAt: 1 }, 'red', 0)
    expect(s.red).toEqual(['he111'])
    expect(s.playerAt).toBe(1)
    expect(s.blue).toEqual(['p51d', 'b17g'])
  })
})
