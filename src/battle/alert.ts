import { Vector3 } from 'three'
import { AI_DECISION_HZ, AiController } from '../ai/AiController'
import type { FlightOrder } from '../ai/commandTypes'
import type { Combatant } from '../world/combatant'
import type { Ship } from '../world/ships'
import type { Projectiles } from '../world/Projectiles'
import type { Torpedoes } from '../world/torpedo'
import type { Bombs } from '../world/bomb'
import type { Team } from '../world/team'
import { MESSAGE_SECONDS } from './beats'
import type { Battle } from './battleState'
import type { MissionAlert } from './missions/types'

/**
 * # 警戒（倫內爾島）
 *
 * 警戒前敵方還沒發現藍方：紅方戰鬥機在艦隊上空直線巡邏不接戰，艦砲與藍方砲塔停火。
 * 下面任一成立就進入警戒，整場不解除（SPEC `2026-10-08-rennell-alert-design.md` §4）。
 */

/** 藍機高過這個就被發現，m（世界高度；海面是 0） */
export const ALERT_ALTITUDE = 500

/**
 * 藍機與紅機、紅船的三維距離小於這個就被發現，m。
 *
 * G4M 機槍（九二式 7.7 mm）的射程：初速 745 m/s × 彈丸壽命 1.2 s ≈ 894 m，取整。
 * 寫死，不從武器表算 —— 改武器不該連帶改這一關的難度。
 */
export const ALERT_RANGE = 900

/** 判斷要讀的世界。`World` 本身就滿足 */
export interface AlertWorld {
  readonly combatants: readonly Pick<Combatant, 'alive' | 'team' | 'hp' | 'aircraft'>[]
  readonly ships: readonly Pick<Ship, 'alive' | 'team' | 'hp' | 'cls' | 'position'>[]
  readonly projectiles: Pick<Projectiles, 'capacity' | 'owner' | 'team'>
  readonly torpedoes: Pick<Torpedoes, 'capacity' | 'active' | 'team'>
  readonly bombs: Pick<Bombs, 'capacity' | 'active' | 'team'>
}

/**
 * 這一刻藍方有沒有被發現。熱路徑，不配置。
 *
 * - 活著的藍機高於 `ALERT_ALTITUDE`；
 * - 活著的藍機離活著的紅機或紅船不到 `ALERT_RANGE`；
 * - 場上有藍方的子彈、魚雷或炸彈（開過火、投過雷）；
 * - 活著的紅機或紅船不是滿血（被打到了）。
 *
 * 【開火看池子不看槍口閃光】閃光只亮 0.03 s，每 0.1 s 掃一次會漏；子彈至少飛 1.2 s。
 */
export function alertTriggered(w: AlertWorld): boolean {
  const cs = w.combatants
  const r2 = ALERT_RANGE * ALERT_RANGE
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    if (!c.alive) continue
    if (c.team === 'red') {
      if (c.hp < c.aircraft.spec.hp) return true
      continue
    }
    const p = c.aircraft.state.position
    if (p.y > ALERT_ALTITUDE) return true
    for (let k = 0; k < cs.length; k++) {
      const o = cs[k]!
      if (o.alive && o.team === 'red' && o.aircraft.state.position.distanceToSquared(p) < r2) return true
    }
    for (let k = 0; k < w.ships.length; k++) {
      const s = w.ships[k]!
      if (s.alive && s.team === 'red' && s.position.distanceToSquared(p) < r2) return true
    }
  }
  for (let k = 0; k < w.ships.length; k++) {
    const s = w.ships[k]!
    if (s.alive && s.team === 'red' && s.hp < s.cls.hp) return true
  }
  const p = w.projectiles
  for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1 && p.team[i] === 0) return true
  const t = w.torpedoes
  for (let i = 0; i < t.capacity; i++) if (t.active[i] === 1 && t.team[i] === 0) return true
  const b = w.bombs
  for (let i = 0; i < b.capacity; i++) if (b.active[i] === 1 && b.team[i] === 0) return true
  return false
}

/**
 * 一場戰鬥的警戒狀態。只有卡片上有 `alert` 的關卡才有（`Battle.alert`）。
 *
 * 【巡邏依分隊索引】分隊表在建立時就定了，之後只壓縮各隊的 `members`，索引不變；
 * 長機陣亡換人時，同一支分隊沿用同一張命令與同一個方向。
 */
export interface AlertState {
  readonly spec: MissionAlert
  alerted: boolean
  /** 到下一次掃描還有幾秒。10 Hz，與 `stepPressure` 同一個節奏 */
  timer: number
  /** 依分隊索引：+1 飛向右端、−1 飛向左端。藍方分隊不用 */
  readonly legs: Int8Array
  readonly initialLegs: Int8Array
  /** 依分隊索引的巡邏命令，建立時配好；藍方分隊是 null */
  readonly orders: readonly (FlightOrder | null)[]
}

/** 紅方分隊依順序交替 −1、+1：兩隊反方向飛，蓋得比較廣 */
export function createAlertState(spec: MissionAlert, flights: readonly { readonly team: Team }[]): AlertState {
  const initialLegs = new Int8Array(flights.length)
  let k = 0
  const orders = flights.map((f, i) => {
    if (f.team !== 'red') return null
    initialLegs[i] = k++ % 2 === 0 ? -1 : 1
    const order: FlightOrder = {
      kind: 'rally', point: new Vector3(), radius: spec.patrolRadius,
      targetFlight: -1, side: 0, focusIndex: -1,
    }
    return order
  })
  return { spec, alerted: false, timer: 0, legs: initialLegs.slice(), initialLegs, orders }
}

type AlertBattle = Pick<Battle, 'alert' | 'world' | 'flights' | 'board' | 'cfg' | 'message' | 'messageUntil'>

const CENTER = /* @__PURE__ */ new Vector3()

/**
 * 艦隊中心：活著的紅船位置的平均；一艘都不剩時用卡片上的艦隊中心。
 * 艦隊在走，巡邏線跟著它。不配置。
 */
function fleetCenter(b: AlertBattle, out: Vector3): Vector3 {
  out.set(0, 0, 0)
  let n = 0
  for (const s of b.world.ships) {
    if (!s.alive || s.team !== 'red') continue
    out.add(s.position)
    n++
  }
  if (n > 0) return out.multiplyScalar(1 / n)
  const c = b.cfg.fleet?.center
  return c === undefined ? out : out.copy(c)
}

/**
 * 更新每支紅方分隊的巡邏點：艦隊中心左右 `patrolHalfWidth`（世界 x 軸，與雙方的進場軸垂直）、
 * 高度 `patrolAltitude`。長機水平距離進到 `patrolRadius` 就換飛另一端。不配置。
 */
export function stepPatrol(b: AlertBattle): void {
  const a = b.alert
  if (a === null) return
  const spec = a.spec
  fleetCenter(b, CENTER)
  const flights = b.flights.flights
  const cs = b.world.combatants
  const r2 = spec.patrolRadius * spec.patrolRadius
  for (let f = 0; f < flights.length; f++) {
    const order = a.orders[f]
    const flight = flights[f]!
    if (order === null || order === undefined || flight.count === 0) continue
    const lead = cs[flight.members[0]!]!.aircraft.state.position
    const x = CENTER.x + a.legs[f]! * spec.patrolHalfWidth
    const dx = lead.x - x
    const dz = lead.z - CENTER.z
    if (dx * dx + dz * dz < r2) a.legs[f] = -a.legs[f]!
    order.point.set(CENTER.x + a.legs[f]! * spec.patrolHalfWidth, spec.patrolAltitude, CENTER.z)
  }
}

/**
 * 把巡邏命令直接發到紅方的每一架 AI，放掉它們的目標，並清掉反應延遲佇列裡排著的指令。
 *
 * 【要在第一個世界步之前】命令層排在世界步之後；開場與重新開始時不先發，紅方的第一個世界步
 * 會帶著上一場的作戰命令與目標跑。只有警戒關呼叫，其他關卡的初始化順序不動。
 */
export function armPatrol(b: AlertBattle): void {
  const a = b.alert
  if (a === null || a.alerted) return
  stepPatrol(b)
  const flights = b.flights.flights
  const cs = b.world.combatants
  for (let f = 0; f < flights.length; f++) {
    const order = a.orders[f]
    if (order === null || order === undefined) continue
    const flight = flights[f]!
    for (let p = 0; p < flight.count; p++) {
      const seat = flight.members[p]!
      const ai = cs[seat]!.controller
      if (!(ai instanceof AiController)) continue
      ai.order = order
      ai.transit = true
      ai.target = null
      ai.targetIndex = -1
      // 反應延遲的佇列裡可能還排著上一場的扣扳機
      ai.dropPendingCommands()
      if (seat < b.board.assignments.length) b.board.assignments[seat] = -1
    }
  }
}

/**
 * 每個物理步：未警戒時更新巡邏點，每 0.1 秒掃一次警戒條件。成立就進入警戒（整場不解除）：
 * 停火全部解除、畫面中心顯示訊息 `MESSAGE_SECONDS` 秒。不配置。
 */
export function stepAlert(b: AlertBattle, dt: number): void {
  const a = b.alert
  if (a === null || a.alerted) return
  stepPatrol(b)
  a.timer -= dt
  if (a.timer > 0) return
  a.timer += 1 / AI_DECISION_HZ
  if (!alertTriggered(b.world)) return
  a.alerted = true
  b.world.holdFire.fill(0)
  b.message = a.spec.messageKey
  b.messageUntil = b.world.time + MESSAGE_SECONDS
}

/**
 * 重新開始：回到未警戒、紅方艦砲與藍方砲塔停火、巡邏方向還原，並在第一個世界步之前發好巡邏命令。
 * **要在控制器換回 AI 之後呼叫**（`resetBattle` 的最後）。
 */
export function resetAlert(b: AlertBattle): void {
  const a = b.alert
  if (a === null) return
  a.alerted = false
  a.timer = 0
  a.legs.set(a.initialLegs)
  b.world.holdFire.fill(1)
  armPatrol(b)
}
