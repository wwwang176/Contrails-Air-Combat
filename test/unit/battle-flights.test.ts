import { describe, it, expect } from 'vitest'
import {
  SCHWARM_SIZE, STATION_REFERENCE, createFlights, compactFlights, stationReferenceOf,
  type FlightMember, type FlightIndex,
} from '../../src/battle/flights'

/** 造 n 架藍 + n 架紅，index 依序 0..2n−1。 */
function roster(perSide: number): FlightMember[] {
  const all: FlightMember[] = []
  for (let i = 0; i < perSide; i++) all.push({ index: all.length, team: 'blue', alive: true })
  for (let i = 0; i < perSide; i++) all.push({ index: all.length, team: 'red', alive: true })
  return all
}

/** 讀出某個分隊目前的成員索引。 */
function membersOf(fi: FlightIndex, flight: number): number[] {
  const f = fi.flights[flight]!
  return Array.from(f.members.subarray(0, f.count))
}

describe('createFlights', () => {
  it('20 架切成 5 個 4 機 Schwarm，每隊各自切', () => {
    const all = roster(20)
    const fi = createFlights(all)
    expect(fi.flights.length).toBe(10)
    expect(fi.flights.every((f) => f.roster.length === SCHWARM_SIZE)).toBe(true)
    expect(membersOf(fi, 0)).toEqual([0, 1, 2, 3])
    expect(membersOf(fi, 4)).toEqual([16, 17, 18, 19])
    // 第 5 個分隊是紅隊的第一個
    expect(fi.flights[5]!.team).toBe('red')
    expect(membersOf(fi, 5)).toEqual([20, 21, 22, 23])
  })

  it('架數不是 4 的倍數時，最後一個分隊比較小', () => {
    const fi = createFlights(roster(6))
    // 藍隊 6 架 → [0,1,2,3] 與 [4,5]
    expect(membersOf(fi, 0)).toEqual([0, 1, 2, 3])
    expect(membersOf(fi, 1)).toEqual([4, 5])
  })

  it('index 與陣列位置不一致時丟例外', () => {
    // 【為什麼要檢查】flightOf/positionOf 用陣列位置索引，而 index 是
    // World.add 給的遞增序號。兩者恆等，但「恆等」若沒有被檢查，某天有人
    // 插入一架就會變成無聲的錯位 —— 所有站位都會參照到隔壁那一架。
    // 與 createTargetBoard 是同一道檢查。
    const bad: FlightMember[] = [
      { index: 0, team: 'blue', alive: true },
      { index: 7, team: 'blue', alive: true },
    ]
    expect(() => createFlights(bad)).toThrow(/index/)
  })
})

describe('保序壓縮 —— 一條規則做完繼位與 Schwarm 內互補（M6 spec §5.2）', () => {
  it('members[1] 陣亡 → 原 members[2] 遞補成新的 members[1]', () => {
    // 這就是「另一個 Rotte 滑過來補位」，不需要第二套邏輯
    const all = roster(20)
    const fi = createFlights(all)
    all[1]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([0, 2, 3])
    expect(fi.positionOf[2]).toBe(1)
  })

  it('members[0] 陣亡 → members[1] 升為長機', () => {
    const all = roster(20)
    const fi = createFlights(all)
    all[0]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([1, 2, 3])
    expect(stationReferenceOf(fi, 1)).toBe(-1)   // 新長機沒有站位
  })

  it('只剩一架時它沒有站位 —— 自動退化成獨行俠', () => {
    const all = roster(20)
    const fi = createFlights(all)
    all[0]!.alive = false
    all[1]!.alive = false
    all[3]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([2])
    expect(stationReferenceOf(fi, 2)).toBe(-1)
  })

  it('全滅時是空陣列，不需要特例', () => {
    const all = roster(20)
    const fi = createFlights(all)
    for (let i = 0; i < 4; i++) all[i]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([])
    expect(fi.flightOf[0]).toBe(-1)
    expect(fi.positionOf[0]).toBe(-1)
  })

  it('是存活旗標的純函數 —— 連算兩次結果相同', () => {
    const all = roster(20)
    const fi = createFlights(all)
    all[2]!.alive = false
    compactFlights(fi, all)
    const once = membersOf(fi, 0)
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual(once)
  })

  it('陣亡者復活後回到它在 roster 裡的原位', () => {
    // 【為什麼這一條成立】壓縮讀的是 roster（出生編制，不隨陣亡改變），
    // 不是上一次壓縮的結果。所以它沒有累積誤差，任何錯誤狀態下一拍沖掉。
    const all = roster(20)
    const fi = createFlights(all)
    all[1]!.alive = false
    compactFlights(fi, all)
    all[1]!.alive = true
    compactFlights(fi, all)
    expect(membersOf(fi, 0)).toEqual([0, 1, 2, 3])
  })
})

describe('玩家釘在 members[0]（M6 spec §5.3）', () => {
  it('玩家陣亡重生後仍然是長機，不會被接到尾端', () => {
    // 【不釘的話會怎樣】玩家會變成別人的僚機，而玩家不照站位飛 ——
    // 那個 Schwarm 從此有一個永遠對不齊的槽位。
    const all = roster(20)
    const fi = createFlights(all, 8)     // 玩家 index 8，在第 2 個分隊
    expect(membersOf(fi, 2)).toEqual([8, 9, 10, 11])
    all[8]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 2)).toEqual([9, 10, 11])
    all[8]!.alive = true
    compactFlights(fi, all)
    expect(membersOf(fi, 2)).toEqual([8, 9, 10, 11])
  })

  it('玩家的隊友死光時，玩家還是 members[0]', () => {
    const all = roster(20)
    const fi = createFlights(all, 8)
    all[9]!.alive = false
    all[10]!.alive = false
    all[11]!.alive = false
    compactFlights(fi, all)
    expect(membersOf(fi, 2)).toEqual([8])
  })
})

describe('stationReferenceOf', () => {
  it('滿編時的四個角色（M6 spec §5.1）', () => {
    const fi = createFlights(roster(20))
    expect(STATION_REFERENCE).toEqual([-1, 0, 0, 2])
    expect(stationReferenceOf(fi, 0)).toBe(-1)   // Schwarm 長機，自由
    expect(stationReferenceOf(fi, 1)).toBe(0)    // 他的僚機
    expect(stationReferenceOf(fi, 2)).toBe(0)    // 第二 Rotte 長機
    expect(stationReferenceOf(fi, 3)).toBe(2)    // 第二 Rotte 僚機
  })

  it('剩三架時，落單那一架貼到現有的 Rotte 上', () => {
    // 這正是史實裡 Schwarm 掉一架之後會發生的事
    const all = roster(20)
    const fi = createFlights(all)
    all[1]!.alive = false
    compactFlights(fi, all)
    expect(stationReferenceOf(fi, 2)).toBe(0)
    expect(stationReferenceOf(fi, 3)).toBe(0)
  })

  it('不在編制內或越界的索引回傳 −1', () => {
    const fi = createFlights(roster(20))
    expect(stationReferenceOf(fi, -1)).toBe(-1)
    expect(stationReferenceOf(fi, 999)).toBe(-1)
  })
})
