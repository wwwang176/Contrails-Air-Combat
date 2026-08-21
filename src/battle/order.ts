import { SCHWARM_SIZE } from './flights'
import type { EntryPlan, SideEntry } from './entry'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/World'

/**
 * 一個小隊的編成。**外層是小隊、內層是那個小隊的每一架。**
 *
 * 【為什麼是二維而不是「一隊一個機種 + 架數」】專案負責人 2026-08-21：
 * 「設定檔應該是一個陣列決定什麼機種、初始方位、初始姿態、小隊等等，而不是
 * 加開欄位，不然未來越多類型會更新不完。」加第三種機體時，前者只要多一列，
 * 後者要多兩個欄位（機種 + 架數）而且每加一種再多兩個。
 *
 * 【它是 `entry.ts` 那一步的後半】2026-08-16 已經把「擺位、面向、初始狀態」
 * 搬成資料表，但機種與架數留在 `BattleConfig` 上沒跟過去。這裡補完。
 */
export interface FlightPlan {
  readonly team: Team
  /**
   * 這一小隊的每一架，`[0]` 是長機。**1 … `SCHWARM_SIZE` 架。**
   *
   * 【為什麼是機種陣列而不是「機種 + 架數」】混編小隊（一架轟炸機配三架
   * 護航）在後者表達不出來。
   */
  readonly members: readonly AircraftSpec[]
  /**
   * 擺位、面向、初始姿態、速度。**沿用 `entry.ts` 的既有型別。**
   *
   * 同一隊的幾個小隊通常共用同一個物件參考 —— 那是刻意的，改一處就是改整隊。
   */
  readonly entry: SideEntry
  /**
   * 橫向槽位，**以 `BattleConfig.schwarmSpacing` 為單位**。0 = 中央，可為小數。
   *
   * 【為什麼是序號不是公尺】`schwarmSpacing`、`lateralOffset`、`entryRange`、
   * `altitudeSpread` 是探針換場景用的旋鈕（`turn-shrink.probe.ts`、
   * `ai-command-decision.test.ts` 都在覆寫）。表裡存絕對座標的話那些覆寫會
   * **靜靜失效** —— 探針照跑、數字照印，只是量的不是它宣稱的東西。
   */
  readonly lane: number
  /**
   * 高度層序號，餵給 `setup.ts` 的鋸齒 `altitudeOffset(tier, altitudeSpread)`
   * —— 它把序號映到 `[−1, 1]`、週期 5。理由同 `lane`。
   */
  readonly tier: number
  /**
   * 玩家開這一小隊的長機（`members[0]`）。
   *
   * **整張表恰好一筆為 true，而且必須在藍隊**（`assertOrderOfBattle`）。
   *
   * 【為什麼是選擇性欄位而不是 `boolean`】`exactOptionalPropertyTypes` 開著，
   * 所以「沒有這個鍵」與「`false`」在型別上是兩件事。手寫的關卡表少寫一個
   * `player: false` 不該是錯誤。
   */
  readonly player?: true
}

export type OrderOfBattle = readonly FlightPlan[]

/**
 * 產出「兩隊各自一種機、橫隊排開」的編組表。**這是 M5 以來的既有排列。**
 *
 * 【它存在的唯一理由】既有的一百多處呼叫端寫的是
 * `{ ...DEFAULT_BATTLE, blueSpec: P51D, blueCount: 20, … }`，全部是既有護欄
 * 的基準。這支讓它們變成一行替換，而且**產出的座標與改動前逐位元相同**：
 *
 * ```
 *   lane = f − (小隊數 − 1) / 2      ← 改動前 leadX 括號裡那個中間值
 *   tier = f                          ← 改動前餵給 altitudeOffset 的那個 f
 *   player 落在藍隊第 floor(藍隊小隊數 / 2) 隊的長機
 *                                     ← 改動前的 playerSlot 同一條式子
 * ```
 *
 * 【藍隊全部排在紅隊之前】`world.add` 的順序決定 combatant 索引，而索引決定
 * AI 決策相位、名字指派、砲塔的點放錯開。順序不對那三件事會全部換位置，
 * 而且不會有任何錯誤。
 */
export function lineAbreast(
  plan: EntryPlan,
  blueSpec: AircraftSpec, blueCount: number,
  redSpec: AircraftSpec, redCount: number,
): OrderOfBattle {
  const out: FlightPlan[] = []
  const playerFlight = Math.floor(Math.ceil(blueCount / SCHWARM_SIZE) / 2)
  for (const team of ['blue', 'red'] as const) {
    const blueSide = team === 'blue'
    const count = blueSide ? blueCount : redCount
    const spec = blueSide ? blueSpec : redSpec
    const entry = blueSide ? plan.blue : plan.red
    const flights = Math.ceil(count / SCHWARM_SIZE)
    for (let f = 0; f < flights; f++) {
      const size = Math.min(SCHWARM_SIZE, count - f * SCHWARM_SIZE)
      const members: AircraftSpec[] = []
      for (let k = 0; k < size; k++) members.push(spec)
      const lane = f - (flights - 1) / 2
      // 【兩個字面值而不是 `player: 條件 ? true : undefined`】
      // `exactOptionalPropertyTypes` 不接受把 `undefined` 指派給 `player?: true`
      out.push(blueSide && f === playerFlight
        ? { team, members, entry, lane, tier: f, player: true }
        : { team, members, entry, lane, tier: f })
    }
  }
  return out
}

/**
 * 守住 `createBattle` 的四個前提。**一次全檢，不散在迴圈裡。**
 *
 * 【為什麼要在生成之前擋】半條路生出來的世界比當場拋錯難查得多：兩筆
 * `player` 的症狀是「玩家的控制器同時裝在兩個座位上，其中一個永遠收不到
 * 輸入」（`resetBattle` 的註解記過同一個症狀），而畫面上只是有一架飛機
 * 呆呆地平飛。
 */
export function assertOrderOfBattle(units: OrderOfBattle): void {
  if (units.length === 0) throw new Error('編組表是空的')

  let players = 0
  let seenRed = false
  for (const u of units) {
    const n = u.members.length
    if (n < 1 || n > SCHWARM_SIZE) {
      throw new Error(`小隊的架數必須是 1 … ${SCHWARM_SIZE}，收到 ${n}`)
    }
    if (u.team === 'red') seenRed = true
    else if (seenRed) throw new Error('編組表的順序錯了：藍隊的小隊必須全部排在紅隊之前')
    if (u.player === true) {
      players++
      if (u.team !== 'blue') throw new Error('玩家必須在藍隊')
    }
  }
  if (players !== 1) throw new Error(`編組表必須恰好有一筆 player，收到 ${players}`)
  if (!units.some((u) => u.team === 'blue')) throw new Error('編組表裡沒有藍隊')
  if (!seenRed) throw new Error('編組表裡沒有紅隊')
}

/** 一隊的總架數。 */
export function sideCount(units: OrderOfBattle, team: Team): number {
  let n = 0
  for (const u of units) if (u.team === team) n += u.members.length
  return n
}

/**
 * 一隊的機種摘要，例如 `20 × p51d` 或 `4 × p51d + 4 × b17g`。
 * 只給 `main.ts` 的除錯行用 —— **不是熱路徑**。
 */
export function sideSummary(units: OrderOfBattle, team: Team): string {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const u of units) {
    if (u.team !== team) continue
    for (const m of u.members) {
      if (!counts.has(m.id)) order.push(m.id)
      counts.set(m.id, (counts.get(m.id) ?? 0) + 1)
    }
  }
  return order.map((id) => `${counts.get(id)!} × ${id}`).join(' + ')
}
