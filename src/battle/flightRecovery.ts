import type { Battle } from './battleState'
import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { flightWiped, type Flight } from './flights'
import { WAVE_LANE, type FlightPlan } from './order'
import { openingTas, placeMember, settle, unitFrame } from './flightSpawn'
import { arrivedAt } from './objectiveQueries'
import { MESSAGE_SECONDS, type BeatState, type RecycleBeat } from './beats'

/** 只暴露這個生命週期實際讀寫的戰局狀態；不建立執行期包裝物件。 */
type RecoveryBattle = Pick<Battle,
  'batches' | 'beatsLeft' | 'board' | 'cfg' | 'convoy' | 'cruises' | 'flights' | 'message'
  | 'messageUntil' | 'reviveAt' | 'roster' | 'spawnOrientations' | 'world'>

/** 整隊重生的站位暫存；每架共用，不逐次配置。 */
const SPAWN = new Vector3()

/** 重生時擺站位用的參考機清單。一次一支小隊，不是熱路徑 */
const REVIVED: Aircraft[] = []

/**
 * 傳送帶的一步：還活著、進了終點圈的 transit 就地回到自己的出生點重新進場。
 *
 * 【同一個席位、同一個名字】離場與進場在同一步，席位不空出來 —— 容量、編制、
 * 記分板的那一列都不動。被擊落的不在這裡補。
 *
 * 熱路徑：只掃 transit 的座位，不配置（進場那一刻換一顆 `AiController`）。
 */
export function stepConveyor(b: RecoveryBattle): void {
  const cv = b.convoy
  if (cv === null) return
  const cs = b.world.combatants
  for (let t = 0; t < cv.seats.length; t++) {
    const seat = cv.seats[t]!
    const c = cs[seat]!
    if (!c.alive) continue
    if (!arrivedAt(c.aircraft.state.position.distanceTo(cv.goal), cv.radius)) continue
    // 【`World.respawn` 不推擊墜】`destroy` 會推，`hunt` 的擊落數就平白多一架
    b.world.respawn(c)
    settle(c, c.spawnPosition, b.spawnOrientations[seat]!, c.spawnTas)
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = seat
    ai.profile = b.cfg.aiProfile
    ai.setDecisionPhase(seat / b.board.assignments.length)
    c.controller = ai
    b.board.assignments[seat] = -1
  }
}

/**
 * 這一支小隊歸不歸重生節拍管：同隊、角色相符、不是玩家釘住的那一支。
 *
 * 【角色看 roster 第一席】小隊不混編角色（`assertOrderOfBattle`）。第一席
 * 不存在的是還沒進場的預留小隊，一律不管。
 */
function recyclable(b: RecoveryBattle, flight: Flight, beat: RecycleBeat): boolean {
  if (flight.team !== beat.team) return false
  const lead = b.world.combatants[flight.roster[0]!]
  if (lead === undefined) return false
  if (beat.role !== undefined && lead.aircraft.spec.role !== beat.role) return false
  const pinned = b.flights.pinned
  if (pinned >= 0) {
    for (let r = 0; r < flight.roster.length; r++) if (flight.roster[r] === pinned) return false
  }
  return true
}

/**
 * 重生節拍的一步：被殲滅的小隊排進預警，到時的小隊整隊重生。
 *
 * 批數用完而且沒有任何一支在等，節拍才算走完 —— 走完之前 `beatsLeft`
 * 不歸零，`stepBeats` 每步都會來。
 *
 * 熱路徑：O(分隊數)，不配置。
 */
export function stepRecycle(b: RecoveryBattle, beat: RecycleBeat, st: BeatState, now: number): void {
  const flights = b.flights.flights
  const cs = b.world.combatants
  let pending = false
  for (let f = 0; f < flights.length; f++) {
    if (!recyclable(b, flights[f]!, beat)) continue
    let due = b.reviveAt[f]!
    if (due < 0 && b.batches < beat.batches && flightWiped(b.flights, f, cs)) {
      due = now + beat.warnLead
      b.reviveAt[f] = due
      b.batches++
      b.message = beat.warnKey
      b.messageUntil = due + MESSAGE_SECONDS
    }
    if (due < 0) continue
    // 【落下來而不是等下一步】與增援的 0 秒預警同一條理由
    if (now >= due) {
      reviveFlight(b, f, beat)
      b.reviveAt[f] = -1
    } else pending = true
  }
  if (b.batches >= beat.batches && !pending) {
    st.phase = 'done'
    b.beatsLeft--
  }
}

/**
 * 讓第 `f` 支開場的小隊在 `beat.entry` 的進場框整隊復活。
 *
 * **回收席位，不動容量**：`World.respawn` 就地清血量、冷卻、砲塔、彈艙與
 * 傷害紀錄，`killEvents` 與 `damageTime` 的參考不變。
 *
 * 【控制器換新】上一條命的目標、模式與計時器不能帶過來；接法與
 * `reinforce` 相同。
 *
 * 【出生點不動】`c.spawnPosition` 是「再打一場」要回去的地方，重生的位置
 * 只寫進飛機的狀態。
 *
 * 【橫向槽位依這一支在同隊同角色小隊裡的序號】兩支同時殲滅、同時重生時
 * 各有自己的一條，不會生在同一點上。
 *
 * 【編制不在這裡接】與 `reinforce` 相同：下一個物理步的 `compactFlights`
 * 依存活旗標把它們編回原小隊。
 */
export function reviveFlight(b: RecoveryBattle, f: number, beat: RecycleBeat): void {
  const unit = b.cfg.units[f]
  if (unit === undefined) throw new Error(`第 ${f} 支不是開場的小隊，不能重生`)
  const flight = b.flights.flights[f]!
  let slot = 0
  for (let g = 0; g < f; g++) if (recyclable(b, b.flights.flights[g]!, beat)) slot++
  let waves = 0
  for (const x of b.cfg.beats ?? []) if (x.kind === 'reinforce') waves++
  const plan: FlightPlan = {
    team: unit.team, members: unit.members, entry: beat.entry, duty: unit.duty,
    lane: WAVE_LANE + waves + slot, tier: b.batches,
  }
  const frame = unitFrame(b.cfg, plan)
  REVIVED.length = 0
  for (let k = 0; k < flight.roster.length; k++) {
    const c = b.world.combatants[flight.roster[k]!]!
    const base = unit.members[k]!
    placeMember(frame, k, REVIVED, SPAWN)
    const tas = openingTas(base, frame.nominalTas, b.cruises.get(base) ?? 0, SPAWN.y)
    b.world.respawn(c)
    settle(c, SPAWN, frame.orientation, tas)
    REVIVED.push(c.aircraft)
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = c.index
    ai.profile = b.cfg.aiProfile
    ai.setDecisionPhase(c.index / b.board.assignments.length)
    c.controller = ai
    b.board.assignments[c.index] = -1
    // 【同一列、同一個名字】記分板的一列是一個席位的戰績：擊墜總和 = 陣亡
    // 總和這條守恆律靠它成立。換名字或清戰績都會讓兇手記到一次沒有人
    // 陣亡的擊墜
    b.roster.pilots[c.index]!.alive = true
  }
}
