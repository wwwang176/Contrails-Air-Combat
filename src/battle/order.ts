import { SCHWARM_SIZE } from './flights'
import type { EntryPlan, SideEntry } from './entry'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/World'

/**
 * 一個小隊的編成。**外層是小隊、內層是那個小隊的每一架。**
 *
 * 【為什麼是二維而不是「一隊一個機種 + 架數」】設定檔是一個陣列決定機種、
 * 初始方位、初始姿態、小隊，而不是逐項加開欄位。加第三種機體時，前者只要
 * 多一列，後者要多兩個欄位（機種 + 架數）而且每加一種再多兩個。
 *
 * 【它是 `entry.ts` 那一步的後半】那邊是「擺位、面向、初始狀態」的資料表，
 * 這裡是機種與架數。
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
   * 這一小隊來做什麼。
   *
   * ```
   *   combat   照常空戰。**遭遇戰的每一隊、任務裡的每一支戰鬥機小隊**
   *   transit  永遠飛向自己正前方的終點，途中不主動交戰（砲塔照打）
   * ```
   *
   * 【為什麼是小隊的欄位而不是由 `spec.role === 'bomber'` 推導】遭遇戰選
   * B-17 時整隊都是轟炸機，而那時**不該**覆寫行為：只有任務模式下的轟炸機
   * 才永遠往終點飛，遭遇戰不覆寫。推導做不出這個區別，因為兩種場合的機種
   * 一模一樣。
   *
   * 【為什麼是必填而不是像 `player` 那樣選填】漏填的症狀是**任務打不贏**：
   * 沒有任何一架 transit，護送的勝利條件永遠不成立，而畫面上一切正常。
   * 必填的話 `tsc` 每一個呼叫端都會擋下來（缺欄位一律會報，不受
   * `docs/backlog.md` §2.25 那個「新鮮字面值」的限制）。
   */
  readonly duty: 'combat' | 'transit'
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
 * 的基準。這支讓它們變成一行替換，而且**產出的座標逐位元相同**：
 *
 * ```
 *   lane = f − (小隊數 − 1) / 2      ← leadX 括號裡那個中間值
 *   tier = f                          ← 餵給 altitudeOffset 的那個 f
 *   player 落在藍隊第 floor(藍隊小隊數 / 2) 隊的長機
 *                                     ← 與 playerSlot 同一條式子
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
        ? { team, members, entry, duty: 'combat', lane, tier: f, player: true }
        : { team, members, entry, duty: 'combat', lane, tier: f })
    }
  }
  return out
}

/**
 * 產出「兩隊各自一份**逐架的機種名單**、橫隊排開」的編組表。
 * 遭遇戰的自訂編組走這一支。
 *
 * 【與 `lineAbreast` 的關係：它是這一支的特例】同機種、同架數、
 * `playerAt` 取那個小隊的長機座位時，兩者**逐項相同**（有測試釘住）。
 * 那條等價是這一支唯一的驗收基準 —— `test/fixtures/spawn-baseline.ts`
 * 的每一個座標都是照 `lineAbreast` 釘死的。
 *
 * 【為什麼不把 `lineAbreast` 改成呼叫這一支】那份基準的浮點運算序列必須
 * 一個字不變，而這一支還在長。等價由測試守著，比由共用實作守著更誠實 ——
 * 共用之後「等價」就變成同義反覆，測不到任何東西。
 *
 * 【`playerAt` 是藍隊名單的索引，不是小隊序號】玩家選的那一架若不在小隊
 * 的第一格，就**與該小隊的長機對調**：`player` 這個旗標的語意是
 * 「玩家開這一小隊的 `members[0]`」（見 `FlightPlan.player`），而換一架
 * 當長機比為了一個座位去改那個語意便宜得多。
 *
 * 【混編是免費的】`members` 是機種陣列，所以「P-51 與 Bf109 同一隊」不需要
 * battle 層做任何事。
 */
export function mixedLine(
  plan: EntryPlan,
  blue: readonly AircraftSpec[],
  red: readonly AircraftSpec[],
  playerAt: number,
): OrderOfBattle {
  const out: FlightPlan[] = []
  const playerFlight = Math.floor(playerAt / SCHWARM_SIZE)
  const playerSeat = playerAt % SCHWARM_SIZE
  for (const team of ['blue', 'red'] as const) {
    const blueSide = team === 'blue'
    const list = blueSide ? blue : red
    const entry = blueSide ? plan.blue : plan.red
    const flights = Math.ceil(list.length / SCHWARM_SIZE)
    for (let f = 0; f < flights; f++) {
      const members: AircraftSpec[] = []
      for (let k = f * SCHWARM_SIZE; k < Math.min(list.length, (f + 1) * SCHWARM_SIZE); k++) {
        members.push(list[k]!)
      }
      const withPlayer = blueSide && f === playerFlight
      // 【對調而不是插隊】插到最前面會把整個小隊的機種順序往後推一格，
      // 而那個順序就是玩家在設定頁上排的東西
      if (withPlayer && playerSeat < members.length) {
        const lead = members[0]!
        members[0] = members[playerSeat]!
        members[playerSeat] = lead
      }
      const lane = f - (flights - 1) / 2
      out.push(withPlayer
        ? { team, members, entry, duty: 'combat', lane, tier: f, player: true }
        : { team, members, entry, duty: 'combat', lane, tier: f })
    }
  }
  return out
}

/** 一個分隊：一個機種、幾架。`count` 是 1 … `SCHWARM_SIZE`。 */
export interface FlightSpec {
  readonly spec: AircraftSpec
  readonly count: number
}

/**
 * 產出「兩隊各自一份**分隊清單**、橫隊排開」的編組表。遭遇戰的編組頁走這一支
 * （選單 spec §3.4）。
 *
 * 【與 `mixedLine` 的關係】那一支收逐架名單、每 4 架硬切一隊，所以「一隊 3 架」
 * 會跟下一隊混在一起；這一支收「每隊一個機種與架數」，3 架就是 3 架。
 * **每隊都滿 4 時兩者逐項相同**（有測試釘住）—— lane／tier 的算式逐字照抄，
 * 所以 `DEFAULT_SKIRMISH` 換路徑之後一個座標都不動。
 *
 * 【`player` 直接掛在 lead 那一隊】長機就是 `members[0]`，不需要 `mixedLine`
 * 那種對調 —— 分隊本來就是一種機種。
 *
 * 【超界丟錯，不吞】夾制是 `battleConfigFrom` 的責任（它知道 UI 的語意）。
 * 這裡吞掉的話，「編組表沒有 player」要到 `assertOrderOfBattle` 才爆，離真正
 * 錯的那一行很遠。
 */
export function flightLine(
  plan: EntryPlan,
  blue: readonly FlightSpec[],
  red: readonly FlightSpec[],
  leadFlight: number,
): OrderOfBattle {
  if (!Number.isInteger(leadFlight) || leadFlight < 0 || leadFlight >= blue.length) {
    throw new Error(`lead 超界：${leadFlight}，藍隊只有 ${blue.length} 隊`)
  }
  const out: FlightPlan[] = []
  for (const team of ['blue', 'red'] as const) {
    const blueSide = team === 'blue'
    const list = blueSide ? blue : red
    const entry = blueSide ? plan.blue : plan.red
    const flights = list.length
    for (let f = 0; f < flights; f++) {
      const { spec, count } = list[f]!
      if (!Number.isInteger(count) || count < 1 || count > SCHWARM_SIZE) {
        throw new Error(`分隊架數要在 1..${SCHWARM_SIZE}，收到 ${count}`)
      }
      const members: AircraftSpec[] = Array.from({ length: count }, () => spec)
      const lane = f - (flights - 1) / 2
      out.push(blueSide && f === leadFlight
        ? { team, members, entry, duty: 'combat', lane, tier: f, player: true }
        : { team, members, entry, duty: 'combat', lane, tier: f })
    }
  }
  return out
}

/**
 * 被護送的那些飛機所在的高度層。`altitudeOffset(0, spread)` = **−spread**，
 * 也就是最低的一層。
 */
export const CONVOY_TIER = 0
/**
 * 護航機所在的高度層。`altitudeOffset(4, spread)` = **+spread**。
 *
 * 【為什麼是 0 與 4 而不是 0 與 1】那個鋸齒把序號映到 `[−1, 1]`、週期 5，
 * 相鄰兩層只差 `spread / 2`（起始值 150 m）。0 與 4 是兩個端點，差
 * `2 × spread`（600 m）—— 護航機**在轟炸機上方**才看得出是護航，而不是
 * 混在同一片天空裡。
 */
export const ESCORT_TIER = 4
/**
 * 被護送者之間的橫向間隔，**以 `schwarmSpacing` 為單位**。
 *
 * 【為什麼不是 1】整隊的寬度必須小於抵達半徑，否則兩側的那幾架飛到終點
 * 時人還在圈外，而判定點只有一個（見 `mission.ts` 的 convoy）。起始值
 * `schwarmSpacing = 800`、抵達半徑 1,000：取 0.25 時四架佔 ±300 m，
 * 整隊都在圈內；取 1 會佔 ±1,200 m，最外側兩架**永遠判不到**。
 *
 * 【起始值，待掃描】它同時是「編隊看起來多密」的旋鈕。
 */
export const CONVOY_LANE = 0.25

/**
 * 一隊的編成：一群戰鬥機，加上（可有可無的）幾架被護送的。
 *
 * 【為什麼被護送的另外開兩個欄位而不是塞進同一個機種清單】它們的
 * `duty`、高度層與橫向間隔全都不同，而且**一架一個小隊**。混在一起的話，
 * 呼叫端要自己知道「哪幾架該拆成單機小隊」—— 那正是這一層該負責的事。
 */
export interface SideOrder {
  /** 戰鬥機的機種 */
  readonly fighter: AircraftSpec
  /** 戰鬥機的架數。依 `SCHWARM_SIZE` 分隊，排法與 `lineAbreast` 相同 */
  readonly fighters: number
  /** 被護送／被攔截的機種。這一隊沒有就給 `null` */
  readonly bomber: AircraftSpec | null
  /** 那個機種幾架。**每一架自成一個小隊**，`bomber` 為 null 時無意義 */
  readonly bombers: number
}

/** `convoyLine` 的內部：把一隊排進 `out`。 */
function pushSide(
  out: FlightPlan[], team: Team, entry: SideEntry, side: SideOrder, withPlayer: boolean,
): void {
  const flights = Math.ceil(side.fighters / SCHWARM_SIZE)
  const playerFlight = Math.floor(flights / 2)
  for (let f = 0; f < flights; f++) {
    const size = Math.min(SCHWARM_SIZE, side.fighters - f * SCHWARM_SIZE)
    const members: AircraftSpec[] = []
    for (let k = 0; k < size; k++) members.push(side.fighter)
    const lane = f - (flights - 1) / 2
    out.push(withPlayer && f === playerFlight
      ? { team, members, entry, duty: 'combat', lane, tier: ESCORT_TIER, player: true }
      : { team, members, entry, duty: 'combat', lane, tier: ESCORT_TIER })
  }

  const bomber = side.bomber
  if (bomber === null) return
  for (let i = 0; i < side.bombers; i++) {
    const lane = (i - (side.bombers - 1) / 2) * CONVOY_LANE
    // 【一架一個小隊】理由見 `assertOrderOfBattle` 的 transit 檢查
    out.push({ team, members: [bomber], entry, duty: 'transit', lane, tier: CONVOY_TIER })
  }
}

/**
 * 產出「護航機 + 被護送的一群」的編組表。**護送與攔截四張卡共用這一支。**
 *
 * 【一支函數吃兩張卡】護送與攔截是**同一個局面的兩側**：一邊有一群非打不可
 * 的飛機要飛到終點，另一邊要攔下來。差別只在 `bomber` 給誰 —— 護送給藍隊、
 * 攔截給紅隊。勝負判定那一側同樣是一條規則（見 `mission.ts` 的 convoy）。
 *
 * 【玩家恆在戰鬥機小隊】被護送的是**要保護的東西**，不是備用座位。
 * `assertOrderOfBattle` 與 `pickTakeover` 兩邊都釘住這件事。
 *
 * 【與 `lineAbreast` 的關係】不共用實作。後者的每一個座標都被
 * `test/fixtures/spawn-baseline.ts` 逐位元釘死（編組表那一輪的驗收），
 * 抽共用等於讓一支還在調整的新函數去動那份基準。**兩者都很短，重複一次
 * 比耦合便宜。**
 */
export function convoyLine(plan: EntryPlan, blue: SideOrder, red: SideOrder): OrderOfBattle {
  const out: FlightPlan[] = []
  pushSide(out, 'blue', plan.blue, blue, true)
  pushSide(out, 'red', plan.red, red, false)
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
    // 【transit 恆為一架】轟炸機分小隊的話，僚機會為了走位做大幅度的滾轉。
    // 撤離、護送的轟炸機一台一個小隊、各有自己的前方集合點，既排除滾轉又
    // 讓每台平行飛。
    //
    // 【這一條擋的不是設定錯誤，是一個看不出來的行為】兩架以上的小隊裡，
    // `members[1..]` 拿得到站位參考機，於是走 `stationCommand` 去**維持
    // 相對位置** —— 而那個控制器為了修橫向誤差會下大滾轉。四架 B-17 因此
    // 一路互相追著滾，看起來像編隊解體。一架一隊就沒有參考機，每一架都走
    // 長機那條「純追擊自己的點」的路徑，於是平行直線飛。
    if (u.duty === 'transit' && n !== 1) {
      throw new Error(`transit 的小隊必須恰好一架（僚機會為了站位大滾轉），收到 ${n}`)
    }
    if (u.team === 'red') seenRed = true
    else if (seenRed) throw new Error('編組表的順序錯了：藍隊的小隊必須全部排在紅隊之前')
    if (u.player === true) {
      players++
      if (u.team !== 'blue') throw new Error('玩家必須在藍隊')
      // 【玩家不會坐進 transit】它是「被護送的東西」而不是一個座位。而且
      // `pickTakeover` 也把 transit 排除在接手名單之外，兩處必須一致
      if (u.duty === 'transit') throw new Error('玩家不能在 transit 的小隊裡')
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

/**
 * 產出「藍隊一路、紅隊分兩路夾擊」的編組表。
 *
 * 第一群留在 `plan.red` 的方位，第二群**繞世界原點**往右舷轉 `starboard`。
 * 任務的艦隊中心就在原點（`MissionFleet.center`），所以那等於繞著艦隊轉。
 *
 * 【為什麼要吃 `entryRange` 與 `lateralOffset`】`SideEntry` 的 `along` 與
 * `across` 是**兩個不同尺度的係數**（10,000 對 1,500），轉方位是在公尺上做
 * 的旋轉 —— 直接轉係數會把圓轉成橢圓。呼叫端本來就有這兩個值。
 *
 * 【右舷是負角】艦隊艏向 −Z、右舷 +X，而繞 Y 的正角把 −Z 轉向 −X。
 *
 * 【兩群各自置中】沿用整隊的 lane 會讓第二群整個偏在一邊，`tier` 同理 ——
 * 它是高度階梯的序號。
 */
export function pincer(
  plan: EntryPlan,
  blueSpec: AircraftSpec, blueCount: number,
  redSpec: AircraftSpec, redCount: number,
  starboard: number,
  entryRange: number, lateralOffset: number,
): OrderOfBattle {
  const base = lineAbreast(plan, blueSpec, blueCount, redSpec, redCount)
  const reds = base.filter((f) => f.team === 'red')
  // 【第一群多一隊】單數時把多的那一隊留在原方位 —— 那是玩家正面對著的
  // 方向，也是任務簡報上寫的方向
  const first = Math.ceil(reds.length / 2)
  const turned = rotateEntry(plan.red, starboard, entryRange, lateralOffset)

  const out: FlightPlan[] = base.filter((f) => f.team === 'blue')
  for (let i = 0; i < reds.length; i++) {
    const f = reds[i]!
    const group = i < first ? 0 : 1
    const n = group === 0 ? first : reds.length - first
    const k = group === 0 ? i : i - first
    out.push({
      ...f,
      entry: group === 0 ? f.entry : turned,
      lane: k - (n - 1) / 2,
      tier: k,
    })
  }
  return out
}

/**
 * 繞世界原點把一個入場位置往右舷轉。`gap` 折進 `along`。
 *
 * **波次也用它**（`battle/missions.ts` 的 `waveBeat`）—— 開場的第二群與後續
 * 的每一波要能落在同一個方位上，兩份實作會漂開。
 */
export function rotateEntry(
  e: SideEntry, starboard: number, entryRange: number, lateralOffset: number,
): SideEntry {
  const c = Math.cos(-starboard)
  const s = Math.sin(-starboard)
  const x = e.across * lateralOffset
  const z = e.along * entryRange + e.gap
  return {
    ...e,
    across: (x * c + z * s) / lateralOffset,
    along: (-x * s + z * c) / entryRange,
    gap: 0,
    heading: e.heading - starboard,
  }
}
