import { Vector3 } from 'three'
import type { FlightOrder } from '../ai/commandTypes'
import type { Combatant, World } from '../world/World'
import type { Beat, BeatState } from './beats'
import type { FlightIndex } from './flights'
import { stepMission, type MissionInputs, type MissionRules, type MissionState, type Outcome } from './mission'
import { aliveCount, arrivedAt, countArrived, destroyedInPool, inDestroyPool } from './objectiveQueries'

/** 任務進度需要的戰局資料；不持有生成、渲染或操縱服務。 */
interface MissionProgress {
  readonly world: Pick<World, 'combatants' | 'ships' | 'groundTargets'>
  readonly blue: readonly Combatant[]
  readonly red: readonly Combatant[]
  readonly player: Combatant
  readonly takeoverSeat: number
  readonly evacOrder: FlightOrder | null
  readonly rules: MissionRules
  readonly mission: MissionState
  outcome: Outcome
  readonly redKilled: number
  readonly redKilledBombers: number
  readonly convoy: {
    readonly seats: readonly number[]
    readonly arrived: boolean[]
    readonly goal: Vector3
    readonly radius: number
  } | null
  readonly cfg: { readonly beats?: readonly Beat[] }
  readonly beatStates: readonly BeatState[]
  readonly reviveAt: Float64Array
  readonly flights: Pick<FlightIndex, 'flights'>
}

/** 規則是 evacuate 時，飛往撤離點的集合令；否則 `null`。 */
export function evacOrderOf(rules: MissionRules): FlightOrder | null {
  if (rules.kind !== 'evacuate') return null
  return {
    kind: 'rally', point: rules.point, radius: rules.radius,
    targetFlight: -1, side: 0, focusIndex: -1,
  }
}

/**
 * 飛進撤離圈的藍隊 AI 退場：不推擊墜、不留殘骸、畫面上不再畫（`retired`）。
 *
 * 【玩家那一架不退】玩家進圈是勝利條件，由 `stepMission` 判。接手倒數中的
 * 那一個座位也不退 —— 玩家兩秒後要坐進去。
 *
 * 【退場之後不算存活】`aliveBlue` 跟著少一架。僚機都撤出去而玩家被擊落時，
 * 沒有座位可以接手，判敗。
 */
function stepEvacuation(b: Pick<MissionProgress, 'evacOrder' | 'blue' | 'player' | 'takeoverSeat'>): void {
  const order = b.evacOrder
  if (order === null) return
  for (let i = 0; i < b.blue.length; i++) {
    const c = b.blue[i]!
    if (!c.alive || c === b.player || c.index === b.takeoverSeat) continue
    if (c.aircraft.state.position.distanceTo(order.point) >= order.radius) continue
    c.alive = false
    c.retired = true
  }
}

/**
 * `stepMission` 的輸入快照。每個物理步就地重填 —— 熱路徑不配置。
 *
 * 【為什麼是模組級而不是 `Battle` 的欄位】它不是戰鬥的狀態，是一個呼叫的
 * 參數。放進 `Battle` 會讓人以為讀它是有意義的 —— 而它在兩次 `stepBattle`
 * 之間的內容是上一場、上一步的殘留。
 */
const MISSION_INPUTS: MissionInputs = {
  aliveBlue: 0,
  aliveBlueFighters: 0,
  aliveRed: 0,
  playerPos: new Vector3(),
  playerAlive: true,
  convoyAlive: 0,
  convoyLead: Infinity,
  convoyArrived: 0,
  redKilled: 0,
  redKilledBombers: 0,
  shipsSunk: 0,
  shipsTotal: 0,
  targetsDestroyed: 0,
  targetsTotal: 0,
  targetsArrived: 0,
  vitalSunk: 0,
  vitalHp: 1,
  redInbound: false,
}

/** 由 stepBattle 在戰鬥中、編制與指揮更新後呼叫；沿用快照避免每步配置。 */
export function stepMissionProgress(b: MissionProgress, dt: number): void {
  const cs = b.world.combatants
  stepEvacuation(b)

  // 【玩家恆在藍隊】M9 的機種與陣營都還是寫死的（M10 才做選擇），所以
  // 「我方」就是藍隊。M10 交換的是兩邊的機種，不是隊伍顏色。
  //
  // 【為什麼要填一份快照而不是把 `Battle` 傳進去】`stepMission` 是純函數，
  // 吃快照才能單元測試而不用建一個世界出來 —— 與 `CommandUnit`
  // （`ai/command.ts`）是同一套手法。物件是模組級的，重用不配置。
  //
  // 【`playerAlive` 為什麼一定要傳】接手有 2 秒延遲，那段期間 `b.player`
  // 仍然指著已經退場的那一架、位置停在墜落點。少了它，撤離任務會把
  // 「玩家死在圓環裡、僚機還活著」判成撤離成功（見 `mission.ts`）。
  const inp = MISSION_INPUTS
  inp.aliveBlue = aliveCount(b.blue)
  inp.aliveBlueFighters = 0
  for (let i = 0; i < b.blue.length; i++) {
    const c = b.blue[i]!
    if (c.alive && c.aircraft.spec.role !== 'bomber') inp.aliveBlueFighters++
  }
  inp.aliveRed = aliveCount(b.red)
  inp.playerPos.copy(b.player.aircraft.state.position)
  inp.playerAlive = b.player.alive
  // 【只掃被護送的那幾架，而且抵達與陣亡的都不再計入】三者的理由見
  // `MissionInputs`。最多 16 架，遭遇戰是 0 架 —— 這一段的成本與架數無關
  inp.convoyAlive = 0
  inp.convoyArrived = 0
  inp.convoyLead = Infinity
  const cv = b.convoy
  if (cv !== null) {
    for (let t = 0; t < cv.seats.length; t++) {
      // 【抵達是一個閂】記住之後就不再看它的位置 —— 它還在往前飛
      if (cv.arrived[t] === true) {
        inp.convoyArrived++
        continue
      }
      const c = cs[cv.seats[t]!]!
      if (!c.alive) continue
      // 【量到判定點，不是量到它自己那條平行線的終點】圓環只有一個，
      // 而玩家看到的圈就必須是判定用的那一個
      const d = c.aircraft.state.position.distanceTo(cv.goal)
      // 【NaN 走這條】`arrivedAt` 對 NaN 回 false，位置壞掉時不會誤判抵達
      // —— 那一架會留在「還在路上」那一邊，而那一邊的兩條判定都不讀位置
      if (arrivedAt(d, cv.radius)) {
        cv.arrived[t] = true
        inp.convoyArrived++
        continue
      }
      inp.convoyAlive++
      if (d < inp.convoyLead) inp.convoyLead = d
    }
  }
  inp.redKilled = b.redKilled
  inp.redKilledBombers = b.redKilledBombers
  // 【只算敵方的船】友軍的船要等 `allies-m3` 那種「守住艦隊」的規則。
  // 八艘的迴圈，每個物理步跑一次 —— 與 convoy 那一段同一個量級。
  inp.shipsSunk = 0
  inp.shipsTotal = 0
  // 【三格都要每一步歸零】少了歸零就是上一步的值累加下去，而重開同一關時
  // 殘留的 `vitalSunk` 會讓一艘健康的航母在開場立刻判輸
  inp.vitalSunk = 0
  // 【沒有要害艦就是滿血】目標列印它，1 讀成「100%」；有幾艘取最低的
  inp.vitalHp = 1
  for (const sh of b.world.ships) {
    // 【我方的船只看要害艦】六艘驅逐艦沉光也不算輸 —— 它們的價值在防空
    // 火網，那已經是機制上真的（`shipGuns.ts` 每一艘都在開火）
    if (sh.team === 'blue') {
      if (sh.vital) {
        if (!sh.alive) inp.vitalSunk++
        const ratio = sh.hp > 0 ? sh.hp / sh.cls.hp : 0
        if (ratio < inp.vitalHp) inp.vitalHp = ratio
      }
      continue
    }
    inp.shipsTotal++
    if (!sh.alive) inp.shipsSunk++
  }
  // 【地面目標同一套：只算敵方、每一步歸零】這一份是跨場的模組單例，
  // 少了歸零就是上一場炸毀六座之後重開、新場第一步直接判勝
  inp.targetsDestroyed = 0
  inp.targetsTotal = 0
  for (const t of b.world.groundTargets) {
    if (!inDestroyPool(t, b.rules)) continue
    inp.targetsTotal++
    if (destroyedInPool(t, cs)) inp.targetsDestroyed++
  }
  inp.targetsArrived = countArrived(b.world.groundTargets, b.rules)
  // 【已經預警、還沒生出來的紅方增援】少了它，那幾秒之內紅方歸零會先判勝，
  // 第二波永遠不來（見 `MissionInputs.redInbound`）
  inp.redInbound = false
  const beats = b.cfg.beats ?? []
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!
    if (beat.kind !== 'reinforce' || beat.flight.team !== 'red') continue
    if (b.beatStates[i]!.phase === 'warned') { inp.redInbound = true; break }
  }
  // 【等重生的紅方小隊也算在路上】最後一支殲滅到重生之間紅方是零，少了
  // 這一段會在那幾秒判勝
  const reviveAt = b.reviveAt
  for (let f = 0; f < reviveAt.length && !inp.redInbound; f++) {
    if (reviveAt[f]! >= 0 && b.flights.flights[f]!.team === 'red') inp.redInbound = true
  }
  // 【地上滑行中的紅方也算在路上】它的那一席離地才存活
  const gts = b.world.groundTargets
  for (let i = 0; i < gts.length && !inp.redInbound; i++) {
    const t = gts[i]!
    if (t.taxi !== null && t.team === 'red') inp.redInbound = true
  }
  // 【讀 `b.rules` 而不是 `b.cfg.rules`】返航節拍會換掉這一場的規則
  stepMission(b.rules, inp, dt, b.mission)
  // 【誰是權威】`b.mission.outcome`。這一行是複本，見 `Battle.mission` 的註解。
  b.outcome = b.mission.outcome
}
