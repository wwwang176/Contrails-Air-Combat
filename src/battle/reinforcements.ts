import type { Battle } from './battleState'
import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import type { Combatant } from '../world/combatant'
import type { Team } from '../world/team'
import type { GroundTarget } from '../world/groundTargets'
import type { GroundUnitId } from '../specs/ground'
import {
  createTakeoffRoll, GEAR_CLEARANCE, TAKEOFF_ROLL_GAP, TAKEOFF_STAGGER, TAKEOFF_TRAIL,
  type TakeoffLine, type TakeoffRoll,
} from '../control/takeoffRoll'
import { spawnMember, unitFrame } from './flightSpawn'
import { makeCommandUnit } from './commandLayer'
import { pilotNames } from './names'
import type { FlightPlan } from './order'

/** 只暴露這個生命週期實際讀寫的戰局狀態；不建立執行期包裝物件。 */
type ReinforcementBattle = Pick<Battle,
  'blue' | 'board' | 'ceilings' | 'cfg' | 'commandUnits' | 'cruises' | 'feeled' | 'red'
  | 'reserve' | 'reserveUsed' | 'roster' | 'seed' | 'spawnOrientations' | 'world'>

const UP = new Vector3(0, 1, 0)

/** 下一支預留的分隊與這支編組同隊、同架數 */
export function fitsNextReserve(b: Pick<Battle, 'reserve' | 'reserveUsed'>, plan: FlightPlan): boolean {
  const r = b.reserve[b.reserveUsed]
  return r !== undefined && r.team === plan.team && r.count === plan.members.length
}

/**
 * 讓一支預留的分隊進場，回傳新座位的索引。
 *
 * **容量是建構期配好的**（`BattleConfig.reserve`），所以這裡不重配任何東西
 * —— 那正是最要緊的一條：`World.add` 的擴容路徑會把 `killEvents` 換成空的、
 * 把 `damageTime` 整張抹掉，而這一步是在戰鬥中做的。
 *
 * 【依序填，不找空的】增援全滅之後「找一支空的」會把同一支再填一次，而
 * 依序填是決定性的。
 *
 * 【先驗完再動世界】隊伍、架數、容量任何一項不合法都在配置之前擋下來。
 * 驗到一半才發現的話會只加入半個波次，而那個狀態沒有人能收拾。
 *
 * 【編制不在這裡接】`flightOf` 與 `positionOf` 由下一個物理步的
 * `compactFlights` 填 —— 它是存活旗標的純函數，預留的分隊本來就在等這幾個
 * 座位出現。
 */
export function reinforce(b: ReinforcementBattle, plan: FlightPlan): readonly number[] {
  const slot = b.reserveUsed
  const reserved = b.reserve[slot]
  if (reserved === undefined) {
    throw new Error(`沒有第 ${slot} 支預留的分隊 —— 這一場只預留了 ${b.reserve.length} 支`)
  }
  if (plan.team !== reserved.team) {
    throw new Error(`第 ${slot} 支預留的是 ${reserved.team} 隊，收到 ${plan.team}`)
  }
  if (plan.members.length !== reserved.count) {
    throw new Error(
      `第 ${slot} 支預留的是 ${reserved.count} 架，收到 ${plan.members.length}`)
  }
  if (plan.player === true) throw new Error('增援不能是玩家的座位')

  // 【驗完才開始動】以下不再有拋錯的路徑
  const frame = unitFrame(b.cfg, plan)
  const made: Aircraft[] = []
  const seats: number[] = []
  const names = pilotNames(
    b.seed + slot + 1, plan.members[0]!.faction, plan.members.length)
  /** 這一批真的上了跑道的腳本，依排隊位置。單列的位置照它排，作廢的席位不佔位 */
  const rolls: TakeoffRoll[] = []
  for (let k = 0; k < plan.members.length; k++) {
    const c = spawnMember(
      b.world, b.cfg, plan, frame, k, made, b.feeled, b.cruises, new AiController())
    if (plan.takeoff !== undefined) {
      // 【停機線上沒有對應的那一架就不進場】起飛的是地上那一架，地上沒有了
      // 就不能憑空多一架。席位已經在建構期綁死，所以留著、標成作廢
      const stand = plan.departs === undefined
        ? null
        : departParked(b, plan.departs, plan.team, plan.takeoff.x, plan.takeoff.z)
      if (plan.departs === undefined || stand !== null) {
        const roll = startTakeoff(b, c, plan.takeoff, rolls.length, stand)
        rolls.push(roll)
        if (stand !== null) {
          // 【滑行與滾行的是地上那一台】它是地面目標，不進空中那一池 —— 空戰的
          // 威脅判斷、索敵都看不到它。這一席等到離地才由 `World` 交接上場
          // （`stepGroundTaxi`），在那之前不存活、不畫
          c.takeoff = null
          c.alive = false
          c.retired = true
          stand.taxi = roll
          stand.departedAs = c.index
        }
      } else {
        c.alive = false
        c.retired = true
      }
    }
    seats.push(c.index)
    ;(plan.team === 'blue' ? b.blue : b.red).push(c)
    b.spawnOrientations.push(c.aircraft.state.orientation.clone())
    b.commandUnits.push(makeCommandUnit(c, b.ceilings))
    b.roster.pilots.push({
      name: names[k]!, kills: 0, deaths: 0, assists: 0, alive: c.alive, isPlayer: false,
    })
    const ai = c.controller as AiController
    ai.board = b.board
    ai.selfIndex = c.index
    ai.profile = b.cfg.aiProfile
    ai.priorityGroundUnit = c.team === 'blue'
      ? b.cfg.tuning.priorityGroundUnit ?? null
      : null
    ai.airOnly = c.team === 'blue' && b.cfg.tuning.airOnly === true
    // 【相位照最終容量攤平，不照當下架數】用當下架數的話同一波的值會全部
    // 擠在 1 附近，決策尖峰聚在一起 —— 這個 API 存在的理由就是攤開它們
    ai.setDecisionPhase(c.index / b.board.assignments.length)
  }
  // 【各滑各的，滑到起飛點就起步】不等小隊到齊 —— 等的那幾秒飛機停在跑道上不動。
  //
  // 【間隔照抵達順序排，不照座位】滑行過來的那一種四架共用同一個起飛點，所以
  // 先到的先滾行，後到的至少晚 `TAKEOFF_ROLL_GAP` 秒；同時滾行會疊在一起。
  // 直接生在起飛線上的那一種本來就前後錯開 `TAKEOFF_TRAIL`，用小的錯開即可。
  const order = rolls.map((_, i) => i).sort((a, b2) => rolls[a]!.taxiTime - rolls[b2]!.taxiTime)
  let last = -Infinity
  for (let k = 0; k < order.length; k++) {
    const r = rolls[order[k]!]!
    const gap = r.taxi === null ? TAKEOFF_STAGGER : TAKEOFF_ROLL_GAP
    r.delay = Math.max(r.taxiTime, last + gap)
    last = r.delay
  }
  b.reserveUsed++
  return seats
}

/**
 * 掛上起飛腳本，回傳它。**同一小隊單列排在中線上**：第 `slot` 架排在起飛線後方
 * `slot × TAKEOFF_TRAIL`。起步時刻由 `reinforce` 在整批生成完之後填。
 *
 * 【有滑行路徑、也有停機墊時從停機墊出發】飛機擺在那一格、機首照停放的方向；
 * 否則直接擺在排隊位置上。地面高度讀 `world.groundAt` —— 增援在戰鬥中生成，
 * 那時地形已經接上。
 */
function startTakeoff(
  b: Pick<Battle, 'world'>, c: Combatant, line: TakeoffLine, slot: number, stand: GroundTarget | null,
): TakeoffRoll {
  const taxi = line.route !== undefined && stand !== null
    ? { path: line.route(stand.position.x, stand.position.z, slot), startHeading: stand.heading }
    : null
  // 【滑行過來的都從同一點滾行】滑上跑道就起飛，不各自再往前排隊；前後間隔改由
  // 抵達時間拉開（`TAKEOFF_ROLL_GAP`）。直接生在起飛線上的那一種才單列排開
  const back = taxi === null ? slot * TAKEOFF_TRAIL : 0
  // 機首是 (−sin, 0, −cos)，後方是它的反向
  const x = line.x + Math.sin(line.heading) * back
  const z = line.z + Math.cos(line.heading) * back
  const groundY = b.world.groundAt(x, z)
  const roll = createTakeoffRoll(x, z, line.heading, groundY, 0, taxi)
  c.takeoff = roll
  const a = c.aircraft
  const from = taxi === null ? { x, z } : taxi.path[0]!
  a.state.position.set(from.x, groundY + GEAR_CLEARANCE, from.z)
  a.state.orientation.setFromAxisAngle(UP, taxi === null ? line.heading : taxi.startHeading)
  a.state.velocity.set(0, 0, 0)
  a.state.angularVelocity.set(0, 0, 0)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  return roll
}

/** 停機墊上還在、還沒排進起飛的同隊 `unit` 有幾台 */
export function parkedLeft(b: Pick<Battle, 'world'>, unit: GroundUnitId, team: Team): number {
  let n = 0
  for (const t of b.world.groundTargets) {
    if (t.alive && t.taxi === null && !t.departed && t.team === team && t.unit.id === unit) n++
  }
  return n
}

/**
 * 挑離 (x, z) 最近、還停著的一台同隊 `unit` 出發，回傳它；一台都不剩回 `null`。
 * 呼叫端把起飛腳本掛到它的 `taxi` 上 —— 它照舊是地面目標，離地時才離場
 * （`World.stepGroundTaxi`）。
 *
 * 【已經在滑行的不挑】掛著腳本的那一台再被挑一次，會有兩席等同一台飛機。
 */
function departParked(
  b: Pick<Battle, 'world'>, unit: GroundUnitId, team: Team, x: number, z: number,
): GroundTarget | null {
  let best: GroundTarget | null = null
  let bestSq = Infinity
  for (const t of b.world.groundTargets) {
    if (!t.alive || t.taxi !== null || t.departed || t.team !== team || t.unit.id !== unit) continue
    const dx = t.position.x - x
    const dz = t.position.z - z
    const d = dx * dx + dz * dz
    if (d < bestSq) {
      bestSq = d
      best = t
    }
  }
  return best
}
