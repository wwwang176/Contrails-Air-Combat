import type { FlightIndex } from './flights'
import type { Team } from '../world/World'

/**
 * 玩家陣亡到接手僚機之間的停頓，s。
 *
 * 【為什麼要這 2 秒】M8 的人工驗收條件 17（「玩家自己被擊墜時看不看得到
 * 火球與零件」）到 M9 之前無法驗收，正是因為玩家死掉的同一幀就重生到別的
 * 地方去了。火球活 0.5 s、零件散開約 1.5~2 s —— 2 秒剛好看得完。
 */
export const TAKEOVER_DELAY = 2

/**
 * `pickTakeover` 需要知道的最小資訊。
 *
 * 【為什麼另外定義而不是直接用 `Combatant`】選誰來接手與射速時鐘、包圍球
 * 半徑、出生點統統無關。與 `flights.ts` 的 `FlightMember` 是同一個做法 ——
 * 測試因此不必組一個世界出來。
 */
export interface TakeoverSeat {
  readonly alive: boolean
  readonly team: Team
}

/**
 * 選一個座位給玩家接手。沒有可接的回傳 −1。
 *
 * 順序：同分隊出生編制上第一個還活著的其他人，再來是同隊索引順序第一個
 * 還活著的人。
 *
 * 【為什麼掃 `roster` 而不是壓縮後的 `members`】兩者在這裡等價 —— 玩家釘在
 * `members[0]`，而壓縮保序，所以「roster 上第一個非玩家的存活者」就是
 * `members[1]`。但 `roster` **不隨陣亡改變**，所以這個函數與
 * `compactFlights` 在同一步裡跑過沒跑過無關。少一個順序相依。
 */
export function pickTakeover(
  flights: FlightIndex, seats: readonly TakeoverSeat[], playerSeat: number,
): number {
  const team = seats[playerSeat]?.team
  if (team === undefined) return -1

  for (const f of flights.flights) {
    if (!f.roster.includes(playerSeat)) continue
    for (const i of f.roster) {
      if (i !== playerSeat && seats[i]!.alive) return i
    }
    break
  }

  for (let i = 0; i < seats.length; i++) {
    if (i === playerSeat) continue
    const s = seats[i]!
    if (s.alive && s.team === team) return i
  }
  return -1
}
