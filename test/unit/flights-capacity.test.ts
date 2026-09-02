import { describe, it, expect } from 'vitest'
import { createFlights, compactFlights, type FlightMember } from '../../src/battle/flights'
import type { Team } from '../../src/world/World'

/**
 * # 預留分隊 —— 中途加入的編制那一半
 *
 * `flights` 是 `readonly Flight[]`，**連陣列本身都不能 push**，而
 * `compactFlights` 對超出長度的 typed array 索引寫入會**靜默失效** ——
 * 新飛機於是永遠沒有 `flightOf` 與 `positionOf`，而且不會有任何錯誤。
 *
 * 所以編制不長大：**建構期就把最終的分隊建好**，增援那幾隊的 roster 指向
 * 還不存在的座位。那些座位空著的時候 `count` 是 0，飛機加進來之後
 * `compactFlights` 下一步就自動收編 —— 它本來就是存活旗標的純函數。
 *
 * 【前提：增援的座位索引是連續的尾段】`world.add` 依序給索引，而預留的
 * roster 也是尾段，兩者對得上。
 */

/** 三個小隊的隊伍：藍、紅、預留的那一隊也是紅 */
const TEAMS: readonly Team[] = ['blue', 'red', 'red']

function member(index: number, team: Team, alive = true): FlightMember {
  return { index, team, alive }
}

/** n 架藍、m 架紅，全部存活 */
function roster(blue: number, red: number): FlightMember[] {
  const all: FlightMember[] = []
  for (let i = 0; i < blue; i++) all.push(member(all.length, 'blue'))
  for (let i = 0; i < red; i++) all.push(member(all.length, 'red'))
  return all
}

describe('預留分隊', () => {
  it('capacity 大於成員數時，flightOf 與 positionOf 照 capacity 配', () => {
    const all = roster(4, 4)
    const fi = createFlights(all, -1, [4, 4, 4], 12, TEAMS)
    expect(fi.flightOf.length).toBe(12)
    expect(fi.positionOf.length).toBe(12)
  })

  it('預留的那一隊 count 是 0，而且不佔任何座位', () => {
    const all = roster(4, 4)
    // 第三隊的 roster 是 8、9、10、11 —— 那四個座位還不存在
    const fi = createFlights(all, -1, [4, 4, 4], 12, TEAMS)
    expect(fi.flights).toHaveLength(3)
    expect(fi.flights[2]!.count).toBe(0)
    expect(fi.flights[2]!.roster).toEqual([8, 9, 10, 11])
    // 已經在場的八架，編制與沒有預留時完全相同
    for (let i = 0; i < 8; i++) expect(fi.flightOf[i]).toBe(i < 4 ? 0 : 1)
    for (let i = 8; i < 12; i++) expect(fi.flightOf[i]).toBe(-1)
  })

  it('座位補上之後，下一次 compactFlights 就收編', () => {
    const all = roster(4, 4)
    const fi = createFlights(all, -1, [4, 4, 4], 12, TEAMS)
    // 增援進場：四架紅方接在尾端
    for (let i = 0; i < 4; i++) all.push(member(all.length, 'red'))
    compactFlights(fi, all)
    expect(fi.flights[2]!.count).toBe(4)
    for (let i = 8; i < 12; i++) {
      expect(fi.flightOf[i]).toBe(2)
      expect(fi.positionOf[i]).toBe(i - 8)
    }
  })

  it('預留的那一隊在陣營上是它 roster 的隊伍 —— 由 sizes 之外的資訊給', () => {
    const all = roster(4, 4)
    const fi = createFlights(all, -1, [4, 4, 4], 12, TEAMS)
    expect(fi.flights[2]!.team).toBe('red')
  })

  it('省略 capacity 時逐字回到改動前 —— 總和必須等於成員數', () => {
    const all = roster(4, 4)
    const fi = createFlights(all, -1, [4, 4])
    expect(fi.flightOf.length).toBe(8)
    expect(fi.flights).toHaveLength(2)
    expect(() => createFlights(all, -1, [4, 4, 4])).toThrow()
  })

  it('sizes 的總和必須等於 capacity，不是成員數', () => {
    const all = roster(4, 4)
    expect(() => createFlights(all, -1, [4, 4], 12, TEAMS)).toThrow()
  })

  it('capacity 小於成員數是錯的', () => {
    const all = roster(4, 4)
    expect(() => createFlights(all, -1, [4], 4, TEAMS)).toThrow()
  })
})
