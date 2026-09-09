import type { Team } from '../world/World'

/**
 * 一個 Schwarm 的大小。
 *
 * 【4 機、兩個 Rotte】M0/M1 spec §17 的編制單位。Rotte（雙機）是
 * 不可分割的戰術單位，Schwarm 是兩個 Rotte 一起飛。
 */
export const SCHWARM_SIZE = 4

/**
 * 站位參考機在**成員陣列裡**的位置，索引即 position。−1 = 沒有站位。
 *
 * ```
 *   members[0]  Schwarm 長機       無站位，自由交戰
 *   members[1]  他的僚機           站位參考 members[0]
 *   members[2]  第二 Rotte 長機    站位參考 members[0]
 *   members[3]  他的僚機           站位參考 members[2]
 * ```
 *
 * 【站位參考機與掩護對象是同一架】除了 members[0]，每個成員都掩護它的
 * 站位參考機 —— 一個概念，沒有特例。members[2] 同時是 members[0] 的
 * 掩護者與 members[3] 的長機，那正是 Rotte 長機這個角色。
 *
 * 【它作用在**壓縮後**的位置上】所以減員時的行為是自動的：只剩三架時
 * 位置只有 0/1/2，落單那一架讀到的參考仍是 0 —— 它貼到現有的 Rotte 上，
 * 正是史實裡 Schwarm 掉一架之後會發生的事。
 */
export const STATION_REFERENCE: readonly number[] = [-1, 0, 0, 2]

/**
 * 建立編制所需的最小資訊。
 *
 * 【為什麼另外定義而不是直接用 Combatant】`World.Combatant` 在結構上滿足
 * 這個介面，但編制不需要知道世界是怎麼組裝的（射速時鐘、包圍球半徑、
 * 出生點都與誰跟誰一隊無關）。`Team` 以 `import type` 取得 —— 型別匯入
 * 會被完全抹除，不產生執行期相依。與 `target.ts` 的 `TargetCandidate`
 * 是同一個做法。
 */
export interface FlightMember {
  /** **必須等於它在陣列裡的位置**。`createFlights` 會檢查 */
  readonly index: number
  readonly team: Team
  alive: boolean
}

export interface Flight {
  readonly team: Team
  /** 出生編制。順序即階層，**不隨陣亡改變** */
  readonly roster: readonly number[]
  /** 存活成員，由 roster 保序壓縮而得。只有前 `count` 格有效 */
  readonly members: Int32Array
  count: number
}

export interface FlightIndex {
  readonly flights: readonly Flight[]
  /** `flightOf[i]` = 第 i 架屬於哪個分隊；−1 = 已退場或不在編制內 */
  readonly flightOf: Int32Array
  /** `positionOf[i]` = 第 i 架在自己分隊 `members` 裡的位置；−1 = 同上 */
  readonly positionOf: Int32Array
  /**
   * 恆佔自己分隊 `members[0]` 的那一架（玩家）；−1 = 沒有。
   *
   * 【唯一的例外，必須釘死】玩家陣亡後會被重生。照一般規則壓縮的話他會
   * 被接到陣列尾端變成別人的僚機 —— 而玩家不照站位飛，那個 Schwarm 從此
   * 有一個永遠對不齊的槽位（M6 spec §5.3）。
   */
  pinned: number
}

/**
 * 依隊伍把成員切成 Schwarm。架數不是 `SCHWARM_SIZE` 的倍數時，最後一個
 * 分隊比較小 —— 那不需要特例，壓縮與站位查詢都只看 `count`。
 *
 * @param sizes 每個小隊的架數，**依 `all` 的索引順序**。總和必須等於
 *   `all.length`，每一段必須同隊，每一段必須是 1 … `SCHWARM_SIZE` 架。
 *
 *   【省略時退回每 `SCHWARM_SIZE` 個切一隊】那是「全員都是標準四機小隊」的
 *   意思，測試走的都是這一條。**正式路徑（`createBattle`）一律明寫。**
 *
 *   【為什麼要開這個參數】沒有它時分組**被算了兩次**：這裡自己照連續索引每
 *   四個切一隊，而 `createBattle` 生成時又獨立算了一次。今天兩者碰巧一致。
 *   編組表一旦允許「6 架轟炸機切成 4 + 2 但排在 4 架戰鬥機後面」或三機小隊，
 *   兩邊就會切出不同的分組 —— **症狀是編隊飛行的僚機認錯長機，而且不會有
 *   任何錯誤**。分組只能有一份。
 *
 * @param capacity **最終**架數，含還沒進場的增援。省略時等於 `all.length`，
 *   也就是「這一場不會再有人加入」。
 *
 *   【為什麼編制不長大】`flights` 是唯讀陣列，而 `compactFlights` 對超出
 *   長度的 typed array 索引寫入會**靜默失效** —— 新飛機於是永遠沒有
 *   `flightOf` 與 `positionOf`，而且不會有任何錯誤。所以增援那幾隊在這裡
 *   就建好，roster 指向還不存在的座位；那些座位空著時 `count` 是 0，
 *   飛機加進來之後下一次 `compactFlights` 自動收編。
 *
 *   **前提是增援的座位索引是連續的尾段** —— `World.add` 依序給索引，
 *   而預留的 roster 也是尾段。
 *
 * @param teams 每個小隊的隊伍。**只有預留的小隊需要**：在場的小隊由它
 *   roster 第一格的成員推得，而預留的小隊那一格還不存在。
 */
export function createFlights(
  all: readonly FlightMember[], pinned = -1, sizes?: readonly number[],
  capacity = all.length, teams?: readonly Team[],
): FlightIndex {
  if (capacity < all.length) {
    throw new Error(`capacity ${capacity} 小於成員數 ${all.length}`)
  }
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.index !== i) {
      throw new Error(`FlightMember.index 必須等於陣列位置：第 ${i} 個是 ${all[i]!.index}`)
    }
  }

  const flights: Flight[] = []
  if (sizes === undefined) {
    for (const team of ['blue', 'red'] as const) {
      const ids: number[] = []
      for (let i = 0; i < all.length; i++) if (all[i]!.team === team) ids.push(i)
      for (let s = 0; s < ids.length; s += SCHWARM_SIZE) {
        const roster = ids.slice(s, s + SCHWARM_SIZE)
        flights.push({
          team,
          roster,
          members: new Int32Array(roster.length).fill(-1),
          count: 0,
        })
      }
    }
  } else {
    // 【總和先檢查完再切】切到一半才發現不夠，會留下一個半成品的 FlightIndex
    let sum = 0
    for (const n of sizes) {
      if (!Number.isInteger(n) || n < 1 || n > SCHWARM_SIZE) {
        throw new Error(`小隊的架數必須是 1 … ${SCHWARM_SIZE} 的整數，收到 ${n}`)
      }
      sum += n
    }
    // 【總和對的是 capacity 而不是成員數】預留的小隊也要算進去。省略
    // `capacity` 時兩者相等
    if (sum !== capacity) {
      throw new Error(`小隊架數的總和 ${sum} 與最終架數 ${capacity} 不符`)
    }
    let at = 0
    for (let f = 0; f < sizes.length; f++) {
      const n = sizes[f]!
      const roster: number[] = []
      for (let k = 0; k < n; k++, at++) roster.push(at)
      // 【在場的由成員推、預留的由 `teams` 給】預留小隊的 roster 第一格
      // 還不存在，推不出隊伍
      const first = all[roster[0]!]
      const team = first === undefined ? teams?.[f] : first.team
      if (team === undefined) {
        throw new Error(`第 ${f} 個小隊是預留的（座位 ${roster[0]} 還不存在），必須由 teams 給隊伍`)
      }
      for (const id of roster) {
        const m = all[id]
        if (m !== undefined && m.team !== team) {
          throw new Error(`一個小隊必須同一隊：${roster.join(',')} 橫跨了藍紅`)
        }
      }
      flights.push({ team, roster, members: new Int32Array(n).fill(-1), count: 0 })
    }
  }

  const fi: FlightIndex = {
    flights,
    flightOf: new Int32Array(capacity).fill(-1),
    positionOf: new Int32Array(capacity).fill(-1),
    pinned,
  }
  compactFlights(fi, all)
  return fi
}

/**
 * 保序壓縮：把退場者從成員陣列移除，後面往前遞補。
 *
 * **這一條規則同時實作繼位與 Schwarm 內互補**（M6 spec §5.2）：
 *
 * | 事件 | 結果 |
 * |---|---|
 * | `members[1]` 陣亡 | `members[2]` 遞補 —— 另一個 Rotte 滑過來補位 |
 * | `members[0]` 陣亡 | `members[1]` 升為長機 |
 * | 剩一架 | 沒有站位參考機 = 獨行俠，自動成立 |
 *
 * 【為什麼每步重算而不是維護增減】與 `countLocks` 每次重掃同一個理由：
 * 維護要求每一條退場路徑都配一次更新，漏掉任何一條就留下一個永遠不消失
 * 的幽靈狀態，而症狀離成因很遠。重算是 O(架數)，而且**自我修復**。
 *
 * 【它讀 `roster` 而不是上一次的結果】所以沒有累積誤差 —— 復活的飛機會
 * 回到原位，而不是被接到尾端。
 *
 * 【結構上不可能震盪】一場戰鬥之內陣亡是單向的（AI 的 `respawnOnDestroy`
 * 為 false），成員陣列只會變短。這是本專案少數不需要遲滯的狀態。
 *
 * 熱路徑：不配置。
 */
export function compactFlights(fi: FlightIndex, all: readonly FlightMember[]): void {
  fi.flightOf.fill(-1)
  fi.positionOf.fill(-1)

  const pinned = fi.pinned
  for (let f = 0; f < fi.flights.length; f++) {
    const flight = fi.flights[f]!
    const roster = flight.roster
    let n = 0

    // 【釘住的那一架先放】它恆佔 members[0]
    if (pinned >= 0) {
      for (let r = 0; r < roster.length; r++) {
        if (roster[r]! !== pinned) continue
        if (all[pinned]!.alive) flight.members[n++] = pinned
        break
      }
    }
    for (let r = 0; r < roster.length; r++) {
      const i = roster[r]!
      if (i === pinned) continue
      // 【`undefined` 是「還沒進場」，不是錯誤】預留的小隊在增援加入之前
      // roster 指向不存在的座位（見 `createFlights` 的 `capacity`）。與
      // `countLocks` 的 `c === undefined` 是同一個形狀
      const m = all[i]
      if (m === undefined || !m.alive) continue
      flight.members[n++] = i
    }

    flight.count = n
    for (let p = 0; p < n; p++) {
      fi.flightOf[flight.members[p]!] = f
      fi.positionOf[flight.members[p]!] = p
    }
  }
}

/**
 * 第 `f` 支小隊是否被殲滅：roster 的每一席都在場而且都死了。
 *
 * 【預留還沒進場的小隊不算】它的 roster 指向不存在的座位，那是「還沒來」。
 * 算成殲滅的話重生節拍會把一支還沒進場的預留小隊當成死光的來重生 ——
 * 對不存在的座位寫入，而且不報錯。
 *
 * 熱路徑：不配置。
 */
export function flightWiped(fi: FlightIndex, f: number, all: readonly FlightMember[]): boolean {
  const roster = fi.flights[f]!.roster
  for (let r = 0; r < roster.length; r++) {
    const m = all[roster[r]!]
    if (m === undefined || m.alive) return false
  }
  return true
}

/**
 * 第 `index` 架的站位參考機（`World.combatants` 的索引）；−1 = 沒有站位。
 *
 * 沒有站位的三種情形：Schwarm 長機、已退場、分隊只剩它一架。三者都退化成
 * M5 的獨行俠行為，呼叫端不必分辨。
 */
export function stationReferenceOf(fi: FlightIndex, index: number): number {
  if (index < 0 || index >= fi.flightOf.length) return -1
  const f = fi.flightOf[index]!
  const pos = fi.positionOf[index]!
  if (f < 0 || pos < 0) return -1
  const ref = STATION_REFERENCE[pos] ?? -1
  if (ref < 0) return -1
  const flight = fi.flights[f]!
  // ref 恆小於 count：pos = 3 需要 count ≥ 4 而 ref = 2；pos = 1 或 2 的
  // ref = 0。這個界限由 STATION_REFERENCE 的內容保證，不是碰巧成立。
  return flight.members[ref]!
}

/**
 * 第 `index` 架所屬的分隊；已退場、不在編制內、索引越界都回傳 null。
 *
 * 【名字不叫 `flightOfIndex`】那會被讀成「回傳分隊的序號」，而它回傳的是
 * **分隊物件**。`FlightIndex` 裡本來就有一個叫 `flightOf` 的 `Int32Array`
 * 在回傳序號，兩者混淆的代價很高。
 *
 * 【為什麼回傳物件而不是三個數】呼叫端（`main.ts` 的 HUD 迴圈）每幀跑幾十次，
 * 回傳一個新物件就是每幀幾十次配置。這裡回的是 `flights` 陣列裡那一個實體。
 *
 * 【為什麼要有這個函數】它與 `isFlightLeader` 存在的唯一理由是**讓
 * `main.ts` 裡那兩條規則測得到** —— 那個檔案在模組載入時就摸 `document`，
 * 進不了 vitest。
 */
export function flightOfCombatant(fi: FlightIndex, index: number): Flight | null {
  if (index < 0 || index >= fi.flightOf.length) return null
  const f = fi.flightOf[index]!
  return f >= 0 ? fi.flights[f]! : null
}

/**
 * 第 `index` 架是不是它那個分隊的長機（`members[0]`）。
 *
 * 【`positionOf` 不是 `flightOf`】兩者都是 `Int32Array`，寫錯了型別上完全
 * 合法。前者是「在分隊裡的第幾位」，後者是「屬於第幾個分隊」—— 用錯的話
 * 第 0 個分隊的每一架都會被當成長機。
 *
 * 【繼位不需要特例】`compactFlights` 每個物理步保序重壓，長機陣亡後
 * `members[0]` 自動換成下一位存活者。
 */
export function isFlightLeader(fi: FlightIndex, index: number): boolean {
  if (index < 0 || index >= fi.flightOf.length) return false
  return fi.flightOf[index]! >= 0 && fi.positionOf[index] === 0
}
