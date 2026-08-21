import { describe, it, expect } from 'vitest'
import { createBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { Idle, spawnLines } from '../tools/spawn-snapshot'
import {
  lineAbreast, assertOrderOfBattle, sideSummary, type OrderOfBattle,
} from '../../src/battle/order'
import { HEAD_ON, PURSUIT } from '../../src/battle/entry'
import { SCHWARM_SIZE } from '../../src/battle/flights'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { B17G } from '../../src/specs/b17g'

const blue = (u: OrderOfBattle) => u.filter((f) => f.team === 'blue')
const red = (u: OrderOfBattle) => u.filter((f) => f.team === 'red')

describe('lineAbreast', () => {
  it('20v20 切成各五個小隊，每隊四架', () => {
    const u = lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)
    expect(u.length).toBe(10)
    expect(blue(u).length).toBe(5)
    expect(red(u).length).toBe(5)
    for (const f of u) expect(f.members.length).toBe(SCHWARM_SIZE)
  })

  /**
   * 【lane 是序號不是公尺】它乘上 `schwarmSpacing` 才是公尺。這條守的是
   * 「改動前 `(f − (n−1)/2)` 那個中間值」—— 數字一樣，浮點運算序列才一樣。
   */
  it('lane 對稱、以中央為 0', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)).map((f) => f.lane))
      .toEqual([-2, -1, 0, 1, 2])
    expect(blue(lineAbreast(HEAD_ON, P51D, 16, BF109G6, 16)).map((f) => f.lane))
      .toEqual([-1.5, -0.5, 0.5, 1.5])
    expect(blue(lineAbreast(HEAD_ON, P51D, 4, BF109G6, 4)).map((f) => f.lane))
      .toEqual([0])
  })

  it('tier 就是小隊序號', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)).map((f) => f.tier))
      .toEqual([0, 1, 2, 3, 4])
  })

  it('架數不是四的倍數時，最後一個小隊比較小', () => {
    expect(blue(lineAbreast(HEAD_ON, P51D, 6, BF109G6, 4)).map((f) => f.members.length))
      .toEqual([4, 2])
    expect(blue(lineAbreast(HEAD_ON, P51D, 1, BF109G6, 1)).map((f) => f.members.length))
      .toEqual([1])
  })

  /**
   * 【玩家落在藍隊正中央那個小隊的長機】判準逐字照抄改動前的
   * `playerSlot = floor(ceil(blueCount / SCHWARM_SIZE) / 2) × SCHWARM_SIZE`。
   */
  it('恰好一筆 player，且在藍隊正中央那一隊', () => {
    // 【6 架的期望值是 1 不是 0 —— Codex 2026-08-21 實測抓到】
    // floor(ceil(6/4)/2) = floor(2/2) = 1，也就是第二個小隊（那一隊只有兩架）。
    // 實跑現行程式：playerIndex 4、flight 1、rosters [[0,1,2,3],[4,5],…]
    for (const [count, want] of [[20, 2], [16, 2], [6, 1], [4, 0], [1, 0]] as const) {
      const u = lineAbreast(HEAD_ON, P51D, count, BF109G6, 8)
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
    const u = lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20)
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
  const ok = lineAbreast(HEAD_ON, P51D, 8, BF109G6, 8)
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
    expect(sideSummary(lineAbreast(HEAD_ON, P51D, 20, BF109G6, 20), 'blue'))
      .toBe('20 × p51d')
  })

  it('混編照出現順序列出', () => {
    const u = lineAbreast(HEAD_ON, P51D, 4, BF109G6, 4)
    const mixed: OrderOfBattle = [
      u[0]!,
      { team: 'blue', members: [B17G, B17G], entry: HEAD_ON.blue, lane: 1, tier: 1 },
      ...u.slice(1),
    ]
    expect(sideSummary(mixed, 'blue')).toBe('4 × p51d + 2 × b17g')
  })
})

/**
 * 【為什麼要單獨守這一條】換迴圈那一步的 `createBattle` 有兩條入口：
 * `cfg.units` 直接給、以及由五個舊欄位 fallback。基準測試走的是後者（它的
 * config 還是舊寫法），前者要到「呼叫端搬家」那一步才有使用者 —— 中間這一段
 * 沒有人守。
 *
 * **舊欄位刪掉之後這一條要跟著刪** —— 那時 fallback 已經不存在。
 */
describe('createBattle 直接吃編組表', () => {
  it('與由舊欄位 fallback 出來的結果完全相同', () => {
    const units = lineAbreast(HEAD_ON, P51D, 8, BF109G6, 8)
    const direct = createBattle(new Idle(), { ...DEFAULT_BATTLE, units }, 7)
    const viaFallback = createBattle(new Idle(), {
      ...DEFAULT_BATTLE,
      blueSpec: P51D, redSpec: BF109G6, blueCount: 8, redCount: 8, entry: HEAD_ON,
    }, 7)
    expect(spawnLines(direct)).toEqual(spawnLines(viaFallback))
  })
})
