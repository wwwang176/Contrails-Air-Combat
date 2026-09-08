import { describe, it, expect } from 'vitest'
import {
  lineAbreast, mixedLine, flightLine, pincer, assertOrderOfBattle, sideSummary,
  type OrderOfBattle,
} from '../../src/battle/order'
import { DEG } from '../../src/core/math'
import { HEAD_ON, PURSUIT } from '../../src/battle/entry'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'

const blue = (u: OrderOfBattle) => u.filter((f) => f.team === 'blue')
const red = (u: OrderOfBattle) => u.filter((f) => f.team === 'red')

describe('lineAbreast', () => {
  it('20v20 切成各五個小隊，每隊四架', () => {
    const u = lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20)
    expect(u.length).toBe(10)
    expect(blue(u).length).toBe(5)
    expect(red(u).length).toBe(5)
    for (const f of u) expect(f.members.length).toBe(SCHWARM_SIZE)
  })

  /**
   * 【lane 是序號不是公尺】它乘上 `schwarmSpacing` 才是公尺。這條守的是
   * `(f − (n−1)/2)` 那個中間值 —— 數字一樣，浮點運算序列才一樣。
   */
  it('lane 對稱、以中央為 0', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20)).map((f) => f.lane))
      .toEqual([-2, -1, 0, 1, 2])
    expect(blue(lineAbreast(HEAD_ON, P51D, 16, BF109K4, 16)).map((f) => f.lane))
      .toEqual([-1.5, -0.5, 0.5, 1.5])
    expect(blue(lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4)).map((f) => f.lane))
      .toEqual([0])
  })

  it('tier 就是小隊序號', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20)).map((f) => f.tier))
      .toEqual([0, 1, 2, 3, 4])
  })

  it('架數不是四的倍數時，最後一個小隊比較小', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 6, BF109K4, 4)).map((f) => f.members.length))
      .toEqual([4, 2])
    expect(blue(lineAbreast(HEAD_ON, P51D, 1, BF109K4, 1)).map((f) => f.members.length))
      .toEqual([1])
  })

  /**
   * 【玩家落在藍隊正中央那個小隊的長機】判準逐字是
   * `playerSlot = floor(ceil(blueCount / SCHWARM_SIZE) / 2) × SCHWARM_SIZE`。
   */
  it('恰好一筆 player，且在藍隊正中央那一隊', () => {
    // 【6 架的期望值是 1 不是 0】
    // floor(ceil(6/4)/2) = floor(2/2) = 1，也就是第二個小隊（那一隊只有兩架）。
    // 實跑現行程式：playerIndex 4、flight 1、rosters [[0,1,2,3],[4,5],…]
    for (const [count, want] of [[20, 2], [16, 2], [6, 1], [4, 0], [1, 0]] as const) {
      const u = lineAbreast(HEAD_ON, P51D, count, BF109K4, 8)
      const marked = u.filter((f) => f.player === true)
      expect(marked.length).toBe(1)
      expect(marked[0]!.team).toBe('blue')
      expect(blue(u).indexOf(marked[0]!)).toBe(want)
    }
  })

  /**
   * 【順序是護欄，不是巧合】`world.add` 的順序決定 combatant 索引，而索引
   * 決定 AI 決策相位、名字指派、砲塔的點放錯開。藍紅交錯的表會讓那三件事
   * 全部換位置，而且不會有任何錯誤。
   */
  it('藍隊的小隊全部排在紅隊之前', () => {
    const u = lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20)
    const firstRed = u.findIndex((f) => f.team === 'red')
    expect(firstRed).toBeGreaterThan(0)
    for (let i = firstRed; i < u.length; i++) expect(u[i]!.team).toBe('red')
  })

  it('entry 直接取自 EntryPlan 的兩側', () => {
    const u = lineAbreast(PURSUIT, P51D, 4, B17G, 4)
    expect(blue(u)[0]!.entry).toBe(PURSUIT.blue)
    expect(red(u)[0]!.entry).toBe(PURSUIT.red)
  })
})

describe('assertOrderOfBattle', () => {
  const ok = lineAbreast(HEAD_ON, P51D, 8, BF109K4, 8)
  /** 去掉 `player` 這個鍵 —— `exactOptionalPropertyTypes` 下不能寫 undefined。 */
  const noPlayer = (u: OrderOfBattle): OrderOfBattle =>
    u.map(({ player: _p, ...rest }) => rest)

  it('正常的表不拋', () => {
    expect(() => assertOrderOfBattle(ok)).not.toThrow()
  })

  it('沒有玩家 → 拋', () => {
    expect(() => assertOrderOfBattle(noPlayer(ok))).toThrow(/player/)
  })

  it('兩個玩家 → 拋', () => {
    const bad: OrderOfBattle = [
      { ...ok[0]!, player: true }, { ...ok[1]!, player: true }, ...ok.slice(2),
    ]
    expect(() => assertOrderOfBattle(bad)).toThrow(/player/)
  })

  it('玩家在紅隊 → 拋', () => {
    const stripped = noPlayer(ok)
    const bad: OrderOfBattle = stripped.map((f) => (
      f.team === 'red' && f === stripped[stripped.length - 1]
        ? { ...f, player: true as const }
        : f))
    expect(() => assertOrderOfBattle(bad)).toThrow(/藍隊/)
  })

  it('空的小隊 → 拋', () => {
    const bad: OrderOfBattle = [{ ...ok[0]!, members: [] }, ...ok.slice(1)]
    expect(() => assertOrderOfBattle(bad)).toThrow(/1 … 4/)
  })

  it('五架的小隊 → 拋', () => {
    const bad: OrderOfBattle = [
      { ...ok[0]!, members: [P51D, P51D, P51D, P51D, P51D] }, ...ok.slice(1),
    ]
    expect(() => assertOrderOfBattle(bad)).toThrow(/1 … 4/)
  })

  it('藍紅交錯 → 拋', () => {
    const bad: OrderOfBattle = [...red(ok).slice(0, 1), ...blue(ok), ...red(ok).slice(1)]
    expect(() => assertOrderOfBattle(bad)).toThrow(/順序/)
  })

  it('一隊都沒有 → 拋', () => {
    expect(() => assertOrderOfBattle(blue(ok))).toThrow(/紅隊/)
  })
})

describe('sideSummary', () => {
  it('單一機種', () => {
    expect(sideSummary(lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20), 'blue'))
      .toBe('20 × p51d')
  })

  it('混編照出現順序列出', () => {
    const u = lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4)
    const mixed: OrderOfBattle = [
      u[0]!,
      { team: 'blue', members: [B17G, B17G], entry: HEAD_ON.blue, duty: 'combat', lane: 1, tier: 1 },
      ...u.slice(1),
    ]
    expect(sideSummary(mixed, 'blue')).toBe('4 × p51d + 2 × b17g')
  })
})

/**
 * `mixedLine` —— 遭遇戰自訂編組的編組函數。
 *
 * 【第一條是全部的重點】它必須是 `lineAbreast` 的推廣，而不是另一種排法：
 * `test/fixtures/spawn-baseline.ts` 的每一個座標、`world.add` 的順序、
 * 以及由順序決定的 AI 決策相位／名字指派／點放錯開，全部釘在後者上。
 */
describe('mixedLine', () => {
  /** 同機種、同架數時玩家的座位，等於 `lineAbreast` 的 `playerFlight` 長機 */
  const leadSeat = (n: number) => Math.floor(Math.ceil(n / SCHWARM_SIZE) / 2) * SCHWARM_SIZE

  it('同機種時與 lineAbreast 逐項相同 —— 這一條守著全部的出生基準', () => {
    for (const [b, r] of [[20, 20], [16, 16], [8, 8], [3, 7], [1, 1]] as const) {
      const want = lineAbreast(HEAD_ON, P51D, b, BF109K4, r)
      const got = mixedLine(
        HEAD_ON,
        Array.from({ length: b }, () => P51D),
        Array.from({ length: r }, () => BF109K4),
        leadSeat(b),
      )
      expect(got.length).toBe(want.length)
      for (let i = 0; i < want.length; i++) {
        const g = got[i]!
        const w = want[i]!
        expect(g.team).toBe(w.team)
        expect(g.lane).toBe(w.lane)
        expect(g.tier).toBe(w.tier)
        expect(g.duty).toBe(w.duty)
        expect(g.player).toBe(w.player)
        expect(g.members.map((m) => m.id)).toEqual(w.members.map((m) => m.id))
      }
    }
  })

  it('混編：一隊裡可以有不同陣營的機種', () => {
    const u = mixedLine(HEAD_ON, [P51D, BF109K4, B17G], [BF109K4, P51D], 0)
    expect(sideSummary(u, 'blue')).toBe('1 × p51d + 1 × bf109k4 + 1 × b17g')
    expect(sideSummary(u, 'red')).toBe('1 × bf109k4 + 1 × p51d')
    // 【護欄照樣要過】混編不是繞過 assertOrderOfBattle 的後門
    expect(() => assertOrderOfBattle(u)).not.toThrow()
  })

  it('玩家選第幾架，那一架就與該小隊的長機對調', () => {
    // 五架：小隊 0 是前四架、小隊 1 是第五架。選 index 2 → 小隊 0 的第三格
    const u = mixedLine(HEAD_ON, [P51D, B17G, BF109K4, P51D, B17G], [P51D], 2)
    const lead = u.find((f) => f.player === true)!
    expect(lead.members[0]!.id).toBe('bf109k4')
    // 對調而不是插隊：原本的長機去了第三格，其餘不動
    expect(lead.members.map((m) => m.id)).toEqual(['bf109k4', 'b17g', 'p51d', 'p51d'])
  })

  it('玩家在第二個小隊時，player 落在那一隊', () => {
    const u = mixedLine(
      HEAD_ON, Array.from({ length: 8 }, () => P51D), [P51D], 5,
    )
    const b = blue(u)
    expect(b[0]!.player).toBe(undefined)
    expect(b[1]!.player).toBe(true)
    expect(u.filter((f) => f.player === true).length).toBe(1)
  })
})


/**
 * `flightLine` —— 分隊清單的編組函數（選單重做 spec §3.4）。
 *
 * 【與 `mixedLine` 的關係】`mixedLine` 把逐架名單每 4 架硬切一隊；這一支收
 * 「每隊一個機種與架數」，所以 3 架一隊是合法的、不會跟下一隊混隊。
 * 第一條守的是：每隊都滿 4 時，兩者**逐項相同** —— 所以 `DEFAULT_SKIRMISH`
 * 的編組表換路徑之後一個座標都不動。
 */
describe('flightLine', () => {
  const full = (spec: typeof P51D, n: number) =>
    Array.from({ length: n }, () => ({ spec, count: SCHWARM_SIZE }))

  it('每隊滿 4 時與 mixedLine 逐項相同 —— 這一條守著遭遇戰的出生順序', () => {
    for (const [b, r, lead] of [[5, 5, 2], [4, 4, 2], [2, 2, 1], [1, 1, 0], [3, 1, 0]] as const) {
      const want = mixedLine(
        HEAD_ON,
        Array.from({ length: b * SCHWARM_SIZE }, () => P51D),
        Array.from({ length: r * SCHWARM_SIZE }, () => BF109K4),
        lead * SCHWARM_SIZE,
      )
      const got = flightLine(HEAD_ON, full(P51D, b), full(BF109K4, r), lead)
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
    }
  })

  it('架數照 count 展開，3 架一隊不會跟下一隊混隊', () => {
    const u = flightLine(HEAD_ON,
      [{ spec: P51D, count: 4 }, { spec: B17G, count: 3 }],
      [{ spec: BF109K4, count: 2 }], 0)
    const b = blue(u)
    expect(b.length).toBe(2)
    expect(b[0]!.members.map((m) => m.id)).toEqual(['p51d', 'p51d', 'p51d', 'p51d'])
    expect(b[1]!.members.map((m) => m.id)).toEqual(['b17g', 'b17g', 'b17g'])
    expect(red(u)[0]!.members.length).toBe(2)
    expect(() => assertOrderOfBattle(u)).not.toThrow()
  })

  it('player 落在 lead 那一隊，而且只有一筆', () => {
    const u = flightLine(HEAD_ON, full(P51D, 3), full(BF109K4, 1), 1)
    const b = blue(u)
    expect(b[0]!.player).toBe(undefined)
    expect(b[1]!.player).toBe(true)
    expect(b[2]!.player).toBe(undefined)
    expect(u.filter((f) => f.player === true).length).toBe(1)
  })

  /**
   * 【超界要丟錯，不吞】夾制是 `battleConfigFrom` 的責任（它知道 UI 的
   * 語意）。這裡吞掉的話，「編組表沒有 player」會在 `assertOrderOfBattle`
   * 才爆，離真正錯的那一行很遠。
   */
  it('lead 超界丟錯', () => {
    expect(() => flightLine(HEAD_ON, full(P51D, 2), full(BF109K4, 1), 2)).toThrow()
    expect(() => flightLine(HEAD_ON, full(P51D, 2), full(BF109K4, 1), -1)).toThrow()
  })

  it('count 超出 1..SCHWARM_SIZE 丟錯', () => {
    expect(() => flightLine(HEAD_ON, [{ spec: P51D, count: 5 }], full(BF109K4, 1), 0)).toThrow()
    expect(() => flightLine(HEAD_ON, [{ spec: P51D, count: 0 }], full(BF109K4, 1), 0)).toThrow()
  })
})

/**
 * # 兩路夾擊
 *
 * 【它是 `lineAbreast` 的變體，不是取代】藍隊與紅隊的第一群逐項相同，只有
 * 紅隊的後半被繞著世界原點轉開。任務的艦隊中心就在原點（`MissionFleet.center`），
 * 所以「繞原點轉」等於「繞艦隊轉」。
 */
describe('pincer', () => {
  const R = 10000
  const L = 1500
  const world = (f: ReturnType<typeof pincer>[number]) => ({
    x: f.entry.across * L,
    z: f.entry.along * R + f.entry.gap,
  })

  it('紅隊切成兩群，藍隊與 lineAbreast 相同', () => {
    const u = pincer(HEAD_ON, P51D, 16, BF109K4, 16, 45 * DEG, R, L)
    const base = lineAbreast(HEAD_ON, P51D, 16, BF109K4, 16)
    expect(blue(u)).toEqual(blue(base))
    const entries = new Set(red(u).map((f) => f.entry))
    expect(entries.size).toBe(2)
  })

  /**
   * 【轉的是方位，不是距離】拉遠或拉近的話兩群不會同時到，而這一關的戰術
   * 意義正是同時從兩個方向壓上來。
   */
  it('第二群繞原點轉了指定的角度，距離不變', () => {
    const u = pincer(HEAD_ON, P51D, 16, BF109K4, 16, 45 * DEG, R, L)
    const reds = red(u)
    const a = world(reds[0]!)
    const b = world(reds[reds.length - 1]!)
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(Math.hypot(a.x, a.z), 6)
    // 方位角以艦隊艏向（−Z）為 0、右舷為正
    const bearing = (p: { x: number, z: number }) => Math.atan2(p.x, -p.z)
    expect((bearing(b) - bearing(a)) / DEG).toBeCloseTo(45, 6)
  })

  /** 【機首跟著轉】不轉的話第二群朝著空海面飛過去 */
  it('第二群的機首也轉了同樣的角度', () => {
    const u = pincer(HEAD_ON, P51D, 16, BF109K4, 16, 45 * DEG, R, L)
    const reds = red(u)
    const d = reds[reds.length - 1]!.entry.heading - reds[0]!.entry.heading
    expect(d / DEG).toBeCloseTo(-45, 6)
  })

  /** 【兩群各自置中】沿用整隊的 lane 會讓第二群整個偏在一邊 */
  it('兩群各自以自己的中央為 lane 0', () => {
    const reds = red(pincer(HEAD_ON, P51D, 16, BF109K4, 16, 45 * DEG, R, L))
    const half = reds.length / 2
    expect(reds.slice(0, half).map((f) => f.lane)).toEqual([-0.5, 0.5])
    expect(reds.slice(half).map((f) => f.lane)).toEqual([-0.5, 0.5])
  })

  /** 【單數小隊時第一群多一隊】兩群的機種與總架數不變 */
  it('小隊數是單數時總架數仍然正確', () => {
    const u = pincer(HEAD_ON, P51D, 16, BF109K4, 12, 45 * DEG, R, L)
    const n = red(u).reduce((a, f) => a + f.members.length, 0)
    expect(n).toBe(12)
  })
})
