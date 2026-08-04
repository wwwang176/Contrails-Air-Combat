import { Quaternion, Vector3 } from 'three'
import { World, type Combatant } from '../world/World'
import { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard, type TargetBoard } from '../ai/target'
import {
  SCHWARM_SIZE, STATION_REFERENCE, compactFlights, createFlights, stationReferenceOf,
  type Flight, type FlightIndex,
} from './flights'
import { STATION_OFFSETS, stationPoint } from '../ai/station'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import type { Controller } from '../control/Controller'

/**
 * 一場戰鬥的編制與出生幾何。全部由實測定案（M5 spec §14、M6 spec §8）。
 *
 * 【`altitudeSpread` = ±300 m】不能近到看起來要相撞，也不能遠到分隊看不到
 * 彼此。週期 5 的鋸齒讓五個分隊落在五個高度層而不是兩排。
 */
export interface BattleConfig {
  /** 每隊架數。專案負責人裁決：M5 固定 20（spec §2） */
  perSide: number
  altitude: number
  tas: number
  /**
   * 兩隊**分隊原點**的初始距離，m。
   *
   * 【M6 起不是「重心」】站位偏置的 `along` 全是負的（僚機在參考機後方），
   * 平均 −90 m，而「後方」對兩隊是反向的 —— 重心因此比分隊原點多拉開
   * 180 m。與 `lateralOffset` 同一個定義。
   *
   * 【M6 由 3,000 拉到 10,000】M5 實測開局到第一次有人扣扳機／中彈：
   *
   * ```
   *   1,500 m → 0.6 s / 1.7 s      4,000 m →  6.3 s /  7.5 s
   *   2,000 m → 1.2 s / 2.4 s      6,000 m → 11.4 s / 13.1 s
   *   3,000 m → 3.7 s / 5.0 s
   * ```
   *
   * 3,000 m 只給 3.7 秒 —— 隊形保持在那個開局下等於隱形功能。第一次扣
   * 扳機約在 1,500 m、對頭接近率 400 m/s，10,000 m 給
   * `(10000 − 1500) / 400 ≈ 21 秒`的編隊巡航。
   *
   * **代價**：每次重置玩家都要等這 21 秒。人工驗收要看它是「壯觀」還是
   * 「無聊」（M6 spec §4.2 條件 19）。
   */
  entryRange: number
  /**
   * 相鄰兩個 Schwarm 的長機橫向間距，m。
   *
   * 【取代 M5 的 `lateralSpacing`】分隊**內部**的間距現在由站位偏置給
   * （`STATION_OFFSETS`），這裡只管分隊**之間**。
   *
   * 【800 m 怎麼來】每隊總寬 `4 × 800 + 650 = 3,850 m`（650 是分隊內部
   * 的橫向跨度），加上 ±750 的兩隊錯開，最外側的一架落在 ±2,675 m。在
   * 10 km 的對頭距離下偏軸 `atan(2675/10000) = 15°` —— 仍然大致對頭，
   * 不會變成側翼包抄。上界與 M5 同一條：總寬不能大到讓外側分隊看不到敵人。
   */
  schwarmSpacing: number
  /**
   * 兩隊**分隊原點**的橫向錯開量，m。藍隊 −offset/2、紅隊 +offset/2。
   *
   * 【為什麼一定要有】M5 實測：0 的時候藍隊每 9 秒被零損失全滅一次，
   * 60 秒內七次，有效命中率藍 34% 對紅 97%。成因是 P-51 的六挺翼槍匯聚點
   * 在 300 m，而那種仗打在 660–1,000 m。
   *
   * 【M6 的推導多一項】站位的 `across` 對紅隊會鏡射（`stationPoint` 讀的
   * 是速度方向，而紅隊朝 +Z），所以藍隊第 k 位在 `X_藍 + a_k`、紅隊第 k 位
   * 在 `X_紅 − a_k`，兩者橫向差是 `−offset + 2·a_k`。以累積橫向量
   * `a = {0, +200, −250, −450}` 代入得 `−offset, −offset+400, −offset−500,
   * −offset−900` —— 最接近 0 的是第二個，也就是**最小的一對只隔
   * `offset − 400`**。
   *
   * 要它仍然滿足兩倍射擊錐（`entryRange × tan(3°) = 524 m`）：
   *
   *     offset − 400 ≥ 2 × 524  →  offset ≥ 1,448  →  取 1,500
   */
  lateralOffset: number
  /** 高度散布的半幅，m */
  altitudeSpread: number
}

export const DEFAULT_BATTLE: BattleConfig = {
  perSide: 20,
  altitude: 4000,
  tas: 200,
  entryRange: 10000,
  schwarmSpacing: 800,
  lateralOffset: 1500,
  altitudeSpread: 300,
}

/** 一場戰鬥的結果。`victory` = 敵方全滅，`defeat` = 我方全滅。 */
export type Outcome = 'fighting' | 'victory' | 'defeat'

export interface Battle {
  readonly world: World
  readonly board: TargetBoard
  readonly blue: Combatant[]
  readonly red: Combatant[]
  /** 玩家那一架。恆在 `blue` 裡 */
  readonly player: Combatant
  readonly cfg: BattleConfig
  /**
   * 每一架的開局姿態。重置時抄回去。
   *
   * 【為什麼要另外存】`World.respawn` 走的是 `Aircraft.reset`，它重建的是
   * 一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
   */
  readonly spawnOrientations: Quaternion[]
  /**
   * 編制。**每個物理步由 `stepBattle` 重新壓縮**（M6 spec §5.4）。
   */
  readonly flights: FlightIndex
  /**
   * 這一場的結果。
   *
   * 【為什麼取代了自動重置】M5 到 M8 是「一方全滅 → 3 秒 → 回到滿編」。
   * 主選單一進來那條路徑就必須消失，否則玩家永遠回不到結算畫面
   * （M9 spec §8）。
   */
  outcome: Outcome
}

const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)

/**
 * 高度散布：把**分隊**序號映到 [−1, 1] 的鋸齒。
 *
 * 【M6 起單位是分隊而不是單架】分隊**內部**的高度差由站位偏置給
 * （`STATION_OFFSETS` 的 `up`）。兩者都作用在單架上的話，會互相打架 ——
 * 生成把它推上去、站位控制器又把它拉回來。
 *
 * 【為什麼不是亂數】M5 spec §3.1 條件 7 要求決定性 —— 同一組設定跑兩次要
 * 逐幀一致。亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉決定性。
 *
 * 【週期取 5】剛好是每隊的分隊數，五個分隊落在五個不同的高度層。
 */
function altitudeOffset(flight: number, spread: number): number {
  const cycle = flight % 5
  return ((cycle / 4) * 2 - 1) * spread
}

/** 生成用的暫存。`createBattle` 不是熱路徑，但沒有理由每架配一個 */
const SPAWN = new Vector3()

/**
 * 造一場 N vs N。
 *
 * 【玩家固定在藍隊中央】開局視野裡兩側都是友機、敵機在正前方 —— 與 M2
 * 「靶機擺正前方 400 m」同一個理由：看得到才算存在。
 */
export function createBattle(
  playerController: Controller, cfg: BattleConfig = DEFAULT_BATTLE,
): Battle {
  const world = new World()
  const blue: Combatant[] = []
  const red: Combatant[] = []
  const flightCount = Math.ceil(cfg.perSide / SCHWARM_SIZE)
  /**
   * 玩家是**正中央分隊的長機**（M6 spec §9）。
   *
   * 【為什麼是長機而不是某個僚機】玩家不會照站位飛。把他擺在有站位的
   * 位置上，那個 Schwarm 從此有一個永遠對不齊的槽位。
   */
  const playerSlot = Math.floor(flightCount / 2) * SCHWARM_SIZE
  let player: Combatant | null = null

  // 藍隊在 +Z、機首朝 −Z；紅隊在 −Z、機首朝 +Z（繞 Y 轉 π）
  for (const side of ['blue', 'red'] as const) {
    const blueSide = side === 'blue'
    const z = blueSide ? cfg.entryRange / 2 : -cfg.entryRange / 2
    const yaw = blueSide ? 0 : Math.PI
    const orientation = new Quaternion().setFromAxisAngle(UP, yaw)
    const velocity = FWD.clone().applyQuaternion(orientation).multiplyScalar(cfg.tas)

    // 對稱錯開，戰場才會維持以原點為中心（相機與小地圖都吃這個）
    const lateral = (blueSide ? -1 : 1) * cfg.lateralOffset / 2

    let slot = 0
    for (let f = 0; f < flightCount; f++) {
      const leadX = (f - (flightCount - 1) / 2) * cfg.schwarmSpacing + lateral
      const leadY = cfg.altitude + altitudeOffset(f, cfg.altitudeSpread)
      /** 這個分隊已經造好的飛機，供 stationPoint 當參考機 */
      const made: Aircraft[] = []

      for (let k = 0; k < SCHWARM_SIZE && slot < cfg.perSide; k++, slot++) {
        // 【分隊內部直接由 stationPoint 生成】出生位置就是站位。兩份長得
        // 很像的幾何就是只有一份會被修好的那種危險 —— 與 `resetBattle`
        // 走 `World.respawn` 是同一個理由。
        //
        // 鏡射是自動的：`stationPoint` 由**參考機的速度方向**建座標框，
        // 而紅隊朝 +Z，所以 `across = +200` 在世界座標是 −X。
        const ref = STATION_REFERENCE[k]!
        if (ref < 0) SPAWN.set(leadX, leadY, z)
        else stationPoint(made[ref]!, STATION_OFFSETS[k]!, 0, SPAWN)

        const spec = blueSide ? P51D : BF109G6
        const aircraft = new Aircraft(spec, SPAWN.y, cfg.tas)
        aircraft.state.position.copy(SPAWN)
        aircraft.state.orientation.copy(orientation)
        aircraft.state.velocity.copy(velocity)
        aircraft.prevPosition.copy(aircraft.state.position)
        aircraft.prevOrientation.copy(orientation)
        made.push(aircraft)

        const isPlayer = blueSide && slot === playerSlot
        const controller = isPlayer ? playerController : new AiController()
        const c = world.add(
          aircraft, controller, side, aircraft.state.position.clone(), SPAWN.y, cfg.tas,
        )
        // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
        c.respawnOnDestroy = false
        if (isPlayer) player = c
        ;(blueSide ? blue : red).push(c)
      }
    }
  }

  if (player === null) throw new Error('玩家沒有被建立——perSide 必須 >= 1')

  // 【指派板必須在全部 add 完之後才建】它會檢查 index 與陣列位置一致，
  // 而 index 是 add 依序給的
  const board = createTargetBoard(world.combatants)
  // 【編制同理】而且玩家要釘在自己分隊的 members[0]（M6 spec §5.3）
  const flights = createFlights(world.combatants, player.index)

  // AI 接線：指派板、自身索引、決策相位
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  const battle: Battle = {
    world,
    board,
    blue,
    red,
    player,
    cfg,
    flights,
    spawnOrientations: world.combatants.map((c) => c.aircraft.state.orientation.clone()),
    outcome: 'fighting',
  }
  wireStations(battle)
  return battle
}

/**
 * 把每一架 AI 的站位參考機與站位偏置接上。
 *
 * 【為什麼每個物理步都要重跑】保序壓縮會改變成員位置，而站位偏置是
 * **位置**的函數。不重跑的話，`members[2]` 遞補成 `members[1]` 之後仍然
 * 守著第二 Rotte 的站位 —— 遞補等於沒發生。
 *
 * 【為什麼用 instanceof 而不是一個旗標】玩家的控制器會在
 * `PlayerController` 與 `AiController` 之間切換（`I` 鍵）。`instanceof`
 * 自動跟著走，而一個旗標會忘記更新。玩家釘在 `members[0]`，所以他接手
 * 的那一顆 AI 拿到的恆是「沒有站位」—— 自由交戰，正是要的。
 */
function wireStations(b: Battle): void {
  const cs = b.world.combatants
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    const ref = stationReferenceOf(b.flights, c.index)
    ai.stationReferenceIndex = ref
    ai.stationReference = ref >= 0 ? cs[ref]!.aircraft : null
    const pos = b.flights.positionOf[c.index]!
    ai.stationOffset = STATION_OFFSETS[pos >= 0 ? pos : 0]!
  }
}

/** 還活著的架數。 */
export function aliveCount(cs: readonly Combatant[]): number {
  let n = 0
  for (let i = 0; i < cs.length; i++) if (cs[i]!.alive) n++
  return n
}

/**
 * 推進一場戰鬥：世界一步，加上編制壓縮與勝負判定。
 */
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)

  // 【退場的飛機要放掉它自己的指派】`World.step` 跳過退場者的控制器，所以
  // `selectTarget` 永遠沒機會替它把槽位歸 −1（M5 spec §7）。不清的話那筆
  // 指派會留到重置為止 —— `countLocks` 有跳過退場者所以不影響統計，但它是
  // 一筆會騙人的狀態，而且 spec 明寫要歸零。
  const cs = b.world.combatants
  const assignments = b.board.assignments
  for (let i = 0; i < cs.length; i++) {
    if (!cs[i]!.alive) assignments[i] = -1
  }

  // 【編制與站位每步重算】保序壓縮是存活旗標的純函數（M6 spec §5.4）：
  // 重算比維護增減安全 —— 維護要求每一條退場路徑都配一次更新，漏掉任何
  // 一條就留下一個永遠不消失的幽靈狀態。成本是 O(架數)。
  compactFlights(b.flights, cs)
  wireStations(b)

  if (b.outcome !== 'fighting') return

  // 【玩家恆在藍隊】M9 的機種與陣營都還是寫死的（M10 才做選擇），所以
  // 「我方」就是藍隊。M10 交換的是兩邊的機種，不是隊伍顏色。
  if (aliveCount(b.red) === 0) b.outcome = 'victory'
  else if (aliveCount(b.blue) === 0) b.outcome = 'defeat'
}

/**
 * 整場回到滿編。
 *
 * 【與 R 鍵共用同一條路徑】兩份長得很像的初始化，就是只有一份會被修好的
 * 那種危險 —— 與 `Aircraft.respawn`、`World.destroy` 是同一個理由。
 */
export function resetBattle(b: Battle): void {
  b.world.projectiles.clear()
  const combatants = b.world.combatants
  for (let i = 0; i < combatants.length; i++) {
    const c = combatants[i]!
    b.world.respawn(c)
    // 【方位與速度要另外抄回去】`World.respawn` 走的是 `Aircraft.reset`，
    // 它重建的是一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
    const q = b.spawnOrientations[i]!
    c.aircraft.state.orientation.copy(q)
    c.aircraft.prevOrientation.copy(q)
    c.aircraft.state.velocity.copy(FWD).applyQuaternion(q).multiplyScalar(c.spawnTas)
  }
  b.board.assignments.fill(-1)
  compactFlights(b.flights, combatants)
  wireStations(b)
  b.outcome = 'fighting'
}

/**
 * 玩家的分隊；玩家已退場時回傳 null。
 *
 * 【為什麼不直接讓呼叫端讀 flights】HUD 那一層不該知道編制的內部表示。
 * 這兩個函數是它需要的全部。
 */
export function playerFlight(b: Battle): Flight | null {
  const f = b.flights.flightOf[b.player.index]!
  return f >= 0 ? b.flights.flights[f]! : null
}

/**
 * 玩家的僚機（`members[1]`）的 `Combatant` 索引；沒有時回傳 −1。
 *
 * 遞補之後它會自動指向新的那一架 —— 因為 `members` 每步都重新壓縮。
 */
export function playerWingman(b: Battle): number {
  const f = playerFlight(b)
  if (f === null || f.count < 2) return -1
  return f.members[1]!
}
