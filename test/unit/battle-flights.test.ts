import { describe, it, expect } from 'vitest'
import {
  SCHWARM_SIZE, STATION_REFERENCE, createFlights, compactFlights, stationReferenceOf,
  flightOfCombatant, isFlightLeader,
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

describe('flightOfCombatant 與 isFlightLeader —— HUD 分隊標示要用的兩條查詢', () => {
  /**
   * 【為什麼這兩條值得純函數】它們的呼叫端是 `main.ts`，而那裡進不了 vitest
   * （模組載入時就摸 `document`）。兩個索引表都是 `Int32Array`，把
   * `positionOf` 寫成 `flightOf` 型別上完全合法 —— 症狀是「標示跑到僚機
   * 身上」或「整個分隊都有標示」，離成因很遠。
   */
  it('每個分隊的 members[0] 是長機，其餘不是', () => {
    const fi = createFlights(roster(8))
    for (const f of fi.flights) {
      expect(isFlightLeader(fi, f.members[0]!)).toBe(true)
      for (let p = 1; p < f.count; p++) {
        expect(isFlightLeader(fi, f.members[p]!)).toBe(false)
      }
    }
  })

  it('長機陣亡後由繼任者接手，舊長機不再是長機', () => {
    const all = roster(8)
    const fi = createFlights(all)
    const first = fi.flights[0]!
    const dead = first.members[0]!
    const heir = first.members[1]!

    all[dead]!.alive = false
    compactFlights(fi, all)

    expect(isFlightLeader(fi, heir)).toBe(true)
    expect(isFlightLeader(fi, dead)).toBe(false)
  })

  it('已退場的那一架沒有分隊，也不是長機', () => {
    const all = roster(8)
    const fi = createFlights(all)
    const dead = fi.flights[0]!.members[1]!
    all[dead]!.alive = false
    compactFlights(fi, all)

    expect(flightOfCombatant(fi, dead)).toBe(null)
    expect(isFlightLeader(fi, dead)).toBe(false)
  })

  /**
   * 【這一條守的是契約，不是某一行實作 —— 而且實測過】把兩個函數開頭那道
   * 長度檢查刪掉，這一條**照樣綠**：`Int32Array` 的越界讀取回傳 `undefined`，
   * 而 `undefined >= 0` 是 false，所以答案剛好還是對的。那道檢查因此是
   * 明寫的保險，不是承重的。
   *
   * **但這一條仍然要存在**，因為它擋的是下一步：某天有人把 `f >= 0` 改成
   * `f !== -1`（看起來等價），越界那一路就會變成 `undefined !== -1` 為真，
   * 回傳 `fi.flights[undefined]` —— 型別上宣稱是 `Flight`，執行期是
   * `undefined`。有這一條，那個改動當場紅。
   *
   * 與 `stationReferenceOf` 的「不在編制內或越界」是同一道契約
   * （Codex 2026-08-09 審查指出這個缺口）。
   */
  it('索引越界回傳 null 與 false', () => {
    const fi = createFlights(roster(8))
    expect(flightOfCombatant(fi, -1)).toBe(null)
    expect(flightOfCombatant(fi, fi.flightOf.length)).toBe(null)
    expect(flightOfCombatant(fi, 999)).toBe(null)
    expect(isFlightLeader(fi, -1)).toBe(false)
    expect(isFlightLeader(fi, fi.flightOf.length)).toBe(false)
    expect(isFlightLeader(fi, 999)).toBe(false)
  })

  /** 【回傳的是同一個物件不是複本】呼叫端每幀跑幾十次，不能配置 */
  it('flightOfCombatant 回傳的就是 flights 裡那一個物件', () => {
    const fi = createFlights(roster(8))
    expect(flightOfCombatant(fi, fi.flights[1]!.members[0]!)).toBe(fi.flights[1])
  })

  /** 存活數與編制員額是兩個不同的數，陣亡之後才分得出來 */
  it('count 是存活數、roster.length 是編制員額', () => {
    const all = roster(8)
    const fi = createFlights(all)
    const idx = fi.flights[0]!.members[0]!
    expect(flightOfCombatant(fi, idx)!.count).toBe(4)
    expect(flightOfCombatant(fi, idx)!.roster.length).toBe(4)

    all[fi.flights[0]!.members[3]!]!.alive = false
    compactFlights(fi, all)
    expect(flightOfCombatant(fi, idx)!.count).toBe(3)
    expect(flightOfCombatant(fi, idx)!.roster.length).toBe(4)
  })
})

/**
 * 【為什麼要讓呼叫端指定分組】改動前 `createFlights` **自己**照連續索引每
 * `SCHWARM_SIZE` 個切一隊，而 `createBattle` 生成時**又獨立算了一次**。今天
 * 兩者碰巧一致（都是連續每 4 個）。
 *
 * 編組表一旦允許「6 架轟炸機切成 4 + 2 但排在 4 架戰鬥機後面」或「3 機小隊」，
 * 兩邊就會切出不同的分組 —— **症狀是編隊飛行的僚機認錯長機，而且不會有任何
 * 錯誤**。所以分組只能有一份，由編組表給。
 */
describe('createFlights 吃指定的小隊大小', () => {
  /**
   * 【`roster(n)` 是 n 藍 + n 紅，總共 2n 架】要測的正是「藍 6 紅 4 這種
   * 不對稱的切法」，所以另外造一個。
   */
  const sides = (blueN: number, redN: number): FlightMember[] => {
    const all: FlightMember[] = []
    for (let i = 0; i < blueN; i++) all.push({ index: all.length, team: 'blue', alive: true })
    for (let i = 0; i < redN; i++) all.push({ index: all.length, team: 'red', alive: true })
    return all
  }

  /**
   * 【期望值刻意選一組舊行為切不出來的】`sides(6, 4)` 配 `[4, 2, 4]` 的話，
   * **舊函數即使完全忽略第三個參數也會切出一模一樣的結果**（藍 6 架本來就
   * 切 4 + 2、紅 4 架本來就是一隊）—— 那條測試證明不了 `sizes` 有生效。
   * `[3, 3, 4]` 就不同：舊行為給 `[[0..3],[4,5],[6..9]]`。
   */
  it('照給的大小切，不是每四個切', () => {
    const fi = createFlights(sides(6, 4), -1, [3, 3, 4])
    expect(fi.flights.map((f) => f.roster)).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8, 9]])
    expect(fi.flights.map((f) => f.team)).toEqual(['blue', 'blue', 'red'])
  })

  it('三機小隊', () => {
    // roster(3) = 3 藍 + 3 紅 = 6 架
    const fi = createFlights(roster(3), -1, [3, 3])
    expect(fi.flights.map((f) => f.roster.length)).toEqual([3, 3])
  })

  it('總和與人數不符 → 拋', () => {
    // roster(4) = 8 架，而 4 + 3 = 7
    expect(() => createFlights(roster(4), -1, [4, 3])).toThrow(/總和/)
  })

  it('小隊大小超出 1…SCHWARM_SIZE → 拋', () => {
    expect(() => createFlights(roster(4), -1, [5, 3])).toThrow(/1 … 4/)
    expect(() => createFlights(roster(4), -1, [0, 8])).toThrow(/1 … 4/)
  })

  it('一個小隊跨兩隊 → 拋', () => {
    // roster(4) = 前 4 藍、後 4 紅；[3, 2, 3] 總和是 8（先過總和那一關），
    // 而第二隊 [3, 4] 橫跨隊界 —— 這一條要測的正是這個分支
    expect(() => createFlights(roster(4), -1, [3, 2, 3])).toThrow(/同一隊/)
  })

  it('省略時與改動前相同', () => {
    const all = roster(5)
    expect(createFlights(all).flights.map((f) => f.roster))
      .toEqual(createFlights(all, -1, undefined).flights.map((f) => f.roster))
  })
})
