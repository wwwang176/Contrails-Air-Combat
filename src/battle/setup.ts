import { Quaternion, Vector3 } from 'three'
import { World, type Combatant } from '../world/World'
import { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard, type TargetBoard } from '../ai/target'
import { ACE, type DifficultyProfile } from '../ai/profile'
import {
  SCHWARM_SIZE, STATION_REFERENCE, compactFlights, createFlights, stationReferenceOf,
  type Flight, type FlightIndex,
} from './flights'
import { STATION_OFFSETS, stationPoint } from '../ai/station'
import {
  createCommandState, stepCommand,
  type CommandState, type CommandUnit,
} from '../ai/command'
import { cornerSpeed, serviceCeiling } from '../analysis/envelope'
import { KILL_STRIDE } from '../world/kills'
import { assistCredits } from '../world/assists'
import { factionOf, pilotNames } from './names'
import { createRoster, recordKill, swapPilots, type Roster } from './pilots'
import { pickTakeover, TAKEOVER_DELAY } from './takeover'
import { applyFeel, GAME_FEEL } from '../specs/feel'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import type { Controller } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'

/**
 * 一場戰鬥的編制與出生幾何。全部由實測定案（M5 spec §14、M6 spec §8）。
 *
 * 【`altitudeSpread` = ±300 m】不能近到看起來要相撞，也不能遠到分隊看不到
 * 彼此。週期 5 的鋸齒讓五個分隊落在五個高度層而不是兩排。
 */
export interface BattleConfig {
  /**
   * 藍隊架數，**含玩家**。1~20。
   *
   * 【為什麼含玩家】專案負責人裁決：20 vs 20 名副其實。這也正是 M9 以前
   * `perSide` 的意思，語意不變，只是拆成兩個。
   */
  blueCount: number
  /** 紅隊架數。1~20 */
  redCount: number
  /** 藍隊機種。**玩家恆在藍隊** —— 選軸心國就是這裡放 Bf109（M10 spec §7.1） */
  blueSpec: AircraftSpec
  /** 紅隊機種 */
  redSpec: AircraftSpec
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
  /**
   * 這一局全部 AI 的難度參數。**兩隊一起套。**
   *
   * 【為什麼是 config 而不是在這裡寫死】`DEFAULT_BATTLE` 給 `ACE`，遊戲
   * 走的 `battleConfigFrom` 給 `VETERAN`。寫死的話 `multi-battle` 與
   * `ai-targeting` 的全部基準會一起移動，而那一層量的是 AI 的天花板 ——
   * 讓遊戲的難度設定去推那些數字，之後就分不清是誰改的。
   *
   * 【為什麼兩隊一起套】與 `specs/feel.ts` 的手感係數同一個理由：玩家的
   * 僚機與敵人是同一套 AI，只給敵人加延遲等於偷偷給玩家開外掛。哪天真要
   * 做難度選單，那時再開不對稱的口。
   */
  aiProfile: DifficultyProfile
}

export const DEFAULT_BATTLE: BattleConfig = {
  blueCount: 20,
  redCount: 20,
  blueSpec: P51D,
  redSpec: BF109G6,
  altitude: 4000,
  tas: 200,
  entryRange: 10000,
  schwarmSpacing: 800,
  lateralOffset: 1500,
  altitudeSpread: 300,
  // 【測試的基準是天花板】遊戲的難度由 `battleConfigFrom` 覆寫，見
  // `aiProfile` 的註解。
  aiProfile: ACE,
}

/** 一場戰鬥的結果。`victory` = 敵方全滅，`defeat` = 我方全滅。 */
export type Outcome = 'fighting' | 'victory' | 'defeat'

export interface Battle {
  readonly world: World
  readonly board: TargetBoard
  readonly blue: Combatant[]
  readonly red: Combatant[]
  /**
   * 玩家目前開的那一架。恆在 `blue` 裡。
   *
   * 【M9 起不是 readonly】玩家陣亡會接手僚機，那時這個參考會換一架
   * （M9 spec §7.2）。`main.ts` 每幀比對它有沒有變，變了就把鏡頭、
   * 觀測用 AI 與第一人稱眼點一起搬過去。
   */
  player: Combatant
  /** 玩家的**開局**座位。重新開始（暫停選單）時要還原回這裡 */
  readonly playerSeat: number
  /** 玩家的控制器。接手時要把它裝到新座位上 */
  readonly playerController: Controller
  /** 正在等待接手的座位；−1 = 沒有在等待 */
  takeoverSeat: number
  /** 接手倒數的剩餘秒數 */
  takeoverTimer: number
  /**
   * 打下玩家的那個座位；−1 = 沒有兇手（自摔）。
   *
   * 【為什麼是 `Battle` 的狀態而不是事件】死亡鏡頭要在那 2 秒**每一幀**都
   * 讀得到他，而擊墜事件在同一個子步就被呼叫端排空了（M9 spec §7.2）。
   */
  takeoverKiller: number
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
   * 兩隊的指揮官。**索引是全域的分隊索引**（`flights.flights` 的下標），
   * 兩個 state 都開滿長度，各自只填自己隊伍的那些格。
   *
   * 【為什麼不各開各的長度】`flightOf[i]` 給的是全域索引，分隊要對應回
   * 指揮官時就得再做一次轉換。開滿比較浪費幾個 null，但少一張對照表。
   */
  readonly blueCommand: CommandState
  readonly redCommand: CommandState
  /**
   * 指揮層讀的每架快照，索引與 `world.combatants` 一致。
   *
   * 【為什麼要一份快照而不是直接傳 `Combatant`】`src/ai/command.ts` 收的是
   * 最小介面 `CommandUnit`（見該檔的註解），而 `cornerRatio` 需要每步重算
   * —— 它不是 `Aircraft` 上現成的欄位。物件重用，每步只改內容。
   */
  readonly commandUnits: CommandUnit[]
  /**
   * 兩隊各自的分隊索引（`flights.flights` 的下標）。
   *
   * 【為什麼算一次就好】分隊的隊伍歸屬**永遠不變** —— `compactFlights` 只
   * 壓縮成員，不會把一個分隊換隊。每步重算是白花的。
   */
  readonly blueFlightIndices: number[]
  readonly redFlightIndices: number[]
  /**
   * 這一場的結果。
   *
   * 【為什麼取代了自動重置】M5 到 M8 是「一方全滅 → 3 秒 → 回到滿編」。
   * 主選單一進來那條路徑就必須消失，否則玩家永遠回不到結算畫面
   * （M9 spec §8）。
   */
  outcome: Outcome
  /** 這一場的飛行員名冊，依座位索引 */
  readonly roster: Roster
  /** 名字用的隨機種子。記下來就能重現同一場的名單 */
  seed: number
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
 *
 * @param seed 名字用的種子。省略時抽一個 —— **這是專案唯一一處
 *             `Math.random`**，而且只影響顯示用的字串，不進入任何物理路徑
 *             （M9 spec §6.2）。
 */
export function createBattle(
  playerController: Controller,
  cfg: BattleConfig = DEFAULT_BATTLE,
  seed: number = (Math.random() * 0x100000000) >>> 0,
): Battle {
  const world = new World()
  const blue: Combatant[] = []
  const red: Combatant[] = []
  const blueFlights = Math.ceil(cfg.blueCount / SCHWARM_SIZE)
  /**
   * 玩家是**正中央分隊的長機**（M6 spec §9）。
   *
   * 【為什麼是長機而不是某個僚機】玩家不會照站位飛。把他擺在有站位的
   * 位置上，那個 Schwarm 從此有一個永遠對不齊的槽位。
   */
  const playerSlot = Math.floor(blueFlights / 2) * SCHWARM_SIZE
  let player: Combatant | null = null

  // 藍隊在 +Z、機首朝 −Z；紅隊在 −Z、機首朝 +Z（繞 Y 轉 π）
  for (const side of ['blue', 'red'] as const) {
    const blueSide = side === 'blue'
    // 【兩邊各算各的】M10 起雙方架數可以不同，分隊數因此也不同
    const count = blueSide ? cfg.blueCount : cfg.redCount
    const flightCount = blueSide ? blueFlights : Math.ceil(cfg.redCount / SCHWARM_SIZE)
    // 【手感係數在這裡套，不在 spec 檔裡】史實值必須原封不動，否則
    // `test/performance/historical.test.ts` 的整層斷言就失去意義（見
    // `specs/feel.ts`）。這裡是「史實的飛機」變成「玩起來的飛機」的唯一入口，
    // 而且**雙方一起套** —— 玩家與 AI 飛的是同一台。
    const spec = applyFeel(blueSide ? cfg.blueSpec : cfg.redSpec, GAME_FEEL)
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

      for (let k = 0; k < SCHWARM_SIZE && slot < count; k++, slot++) {
        // 【分隊內部直接由 stationPoint 生成】出生位置就是站位。兩份長得
        // 很像的幾何就是只有一份會被修好的那種危險 —— 與 `resetBattle`
        // 走 `World.respawn` 是同一個理由。
        //
        // 鏡射是自動的：`stationPoint` 由**參考機的速度方向**建座標框，
        // 而紅隊朝 +Z，所以 `across = +200` 在世界座標是 −X。
        const ref = STATION_REFERENCE[k]!
        if (ref < 0) SPAWN.set(leadX, leadY, z)
        else stationPoint(made[ref]!, STATION_OFFSETS[k]!, 0, SPAWN)

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

  if (player === null) throw new Error('玩家沒有被建立——blueCount 必須 >= 1')

  // 【編制必須在全部 add 完之後才建】玩家要釘在自己分隊的 members[0]
  // （M6 spec §5.3）
  const flights = createFlights(world.combatants, player.index)
  // 【指派板同理】它會檢查 index 與陣列位置一致，而 index 是 add 依序給的。
  //
  // 【為什麼要傳 `flights.flightOf`】分攤折扣因此**不數同小隊**（見
  // `countLocks` 的註解）。沒有它時長機會被自己的僚機罰：僚機的職責就是
  // 打長機正在打的那一架，跟上之後卻被算成「這架已經有人在打了」，長機
  // 於是把到手的射擊解讓出去。專案負責人 2026-08-10 裁定打開。
  //
  // 【編制刻意排在前面】就是為了讓這裡拿得到 `flightOf` 那一個實體 ——
  // `compactFlights` 每個物理步就地重填它，板子因此永遠讀到當步的編制。
  const board = createTargetBoard(world.combatants, flights.flightOf)
  // 【升限每個機種算一次】`serviceCeiling` 不是 `AircraftSpec` 上的欄位
  // （`types.ts` 的那一個在 `HistoricalReference` 裡，是史實對照值），它由
  // `envelope.ts` 用二分搜尋實算 —— 那才是**套過 `feel.ts` 倍率之後**這架
  // 飛機真正爬得到的高度。搜尋不便宜（50 次 `maxClimbRate`），所以依 spec
  // 物件記憶：一場 20v20 只有兩種機型，實際只算兩次。
  const ceilings = new Map<AircraftSpec, number>()
  const commandUnits: CommandUnit[] = world.combatants.map((c) => {
    const spec = c.aircraft.spec
    let ceiling = ceilings.get(spec)
    if (ceiling === undefined) {
      ceiling = serviceCeiling(spec)
      // 【NaN 代表搜尋失敗】`serviceCeiling` 在區間沒括住解時回 NaN。讓它流
      // 進規劃會使「集合點不超過升限」那個夾擠變成 false，高度限制靜靜消失。
      // 退成 Infinity：夾擠不生效，但下界（clearanceScale）仍然守著。
      if (!Number.isFinite(ceiling)) ceiling = Infinity
      ceilings.set(spec, ceiling)
    }
    return {
      position: c.aircraft.state.position,
      velocity: c.aircraft.state.velocity,
      cornerRatio: 1,
      hpFraction: 1,
      shotInstant: 0,
      serviceCeiling: ceiling,
      alive: c.alive,
    }
  })
  const blueCommand = createCommandState(flights.flights.length)
  const redCommand = createCommandState(flights.flights.length)
  const blueFlightIndices: number[] = []
  const redFlightIndices: number[] = []
  for (let f = 0; f < flights.flights.length; f++) {
    ;(flights.flights[f]!.team === 'blue' ? blueFlightIndices : redFlightIndices).push(f)
  }

  // AI 接線：指派板、自身索引、決策相位
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    ai.profile = cfg.aiProfile
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  // 【名字依陣營而不是隊伍顏色】M10 讓玩家選陣營之後藍隊可能飛 Bf109，
  // 那時德文名要跟著機種走（M9 spec §6.1）。這裡讀每一隊實際的機種。
  const blueNames = pilotNames(seed, factionOf(blue[0]!.aircraft.spec.id), blue.length)
  const redNames = pilotNames(seed, factionOf(red[0]!.aircraft.spec.id), red.length)
  let bi = 0
  let ri = 0
  const roster = createRoster(
    world.combatants.map((c) => (c.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!)),
    player.index,
  )

  const battle: Battle = {
    world,
    board,
    roster,
    seed,
    playerSeat: player.index,
    playerController,
    takeoverSeat: -1,
    takeoverTimer: 0,
    takeoverKiller: -1,
    blue,
    red,
    player,
    cfg,
    flights,
    blueCommand,
    redCommand,
    commandUnits,
    blueFlightIndices,
    redFlightIndices,
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

/**
 * 推進兩隊的指揮官，並把命令寫進每一架的 `AiController.order`。
 *
 * 【為什麼排在 `wireStations` 之後】`stepCommand` 讀 `flight.count` 與
 * `flight.members`，那兩者由同一步的 `compactFlights` 重算。排在前面會用到
 * 上一步的編制 —— 剛陣亡的成員仍在名單裡。
 *
 * 【玩家那一隊自治，但只在**真的有人在操縱**的時候】第一份 spec §2.1：
 * 專案負責人裁定「指揮 AI 不用跟玩家這個小隊給指令」，理由是不跟人類搶
 * 操縱。座位上坐的是 `AiController` 時（`I` 代飛、上帝視角）那個理由就
 * 不成立了 —— 見下方 `playerFlight` 的推導。
 */
function stepCommandLayer(b: Battle, dt: number): void {
  const cs = b.world.combatants

  // ── 快照：位置與速度是參考、每步自動新；這兩個要寫 ──────
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const u = b.commandUnits[i]!
    u.alive = c.alive
    const a = c.aircraft
    // 【為什麼不從 AiController 的 sit 拿】那個欄位是私有的，而且玩家座位
    // 根本沒有 AiController。直接算比較誠實，也不依賴 AI 這一步跑過沒有
    const vc = cornerSpeed(a.spec, a.state.position.y)
    u.cornerRatio = vc > 1e-3 ? a.state.velocity.length() / vc : 0
    // 【滿血由 spec 給】`c.hp` 的上界是 `c.aircraft.spec.hp`（`World` 的
    // respawn 就是抄它）。夾在 0 以上：受創超過滿血時 hp 會是負的
    const full = a.spec.hp
    const frac = full > 0 ? c.hp / full : 0
    u.hpFraction = frac > 0 ? frac : 0
    // 【只為排名】射擊解強度的鏡像，見 command.ts 的 `idle`。
    //
    // 【玩家座位可能沒有 AiController，那時寫 0】人類在操縱的那一支分隊
    // 本來就被 `skipFlight` 跳過，所以那個 0 不會被任何排名讀到；而代飛
    // 或上帝視角時座位上是 AiController，這一行就抄得到真值 —— 那一支
    // 分隊這時也確實會進排名（見下方 `playerFlight` 的推導）
    const ctl = c.controller
    u.shotInstant = ctl instanceof AiController ? ctl.shotInstant : 0
  }

  // 【跳過的是「有人類在操縱的那一支」，不是「玩家的座位」】第一份 spec
  // §2.1 裁定指揮 AI 不對玩家的小隊下令，理由是不跟人類搶操縱 —— 座位上
  // 坐的是 AiController 時（`I` 代飛、上帝視角）那個理由就不成立了。
  //
  // 【為什麼用推導而不是加一個旗標】推導比鏡射安全：鏡射要求每一條會改變
  // 狀態的路徑都記得更新，漏掉任何一條就留下一個永遠不消失的幽靈狀態。
  // 這與 `wireStations` 靠 `instanceof AiController` 自動跟上、編制每步
  // 重算而不是增量維護，是同一條紀律。
  //
  // 【`pinned < 0` 時】`combatants[-1]` 是 undefined → `human` 為 false
  // → 回 −1，與改之前逐字相同。
  const seat = b.world.combatants[b.flights.pinned]
  const human = seat !== undefined && !(seat.controller instanceof AiController)
  const playerFlight = human ? b.flights.flightOf[b.flights.pinned]! : -1
  stepCommand(
    b.blueCommand, b.flights.flights, b.blueFlightIndices, b.redFlightIndices,
    b.commandUnits, playerFlight, dt,
  )
  stepCommand(
    b.redCommand, b.flights.flights, b.redFlightIndices, b.blueFlightIndices,
    b.commandUnits, playerFlight, dt,
  )

  // ── 發下去 ────────────────────────────────────────────
  for (let f = 0; f < b.flights.flights.length; f++) {
    const flight = b.flights.flights[f]!
    const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
    const order = state.orders[f] ?? null
    // 【索引解析成 Aircraft 在這一層】規劃層是純函數、只吃快照，不認識
    // Aircraft。與 wireStations 把 stationReferenceOf 的索引解析成飛機是
    // 同一個手法。
    //
    // 【陣亡在這裡擋】stepCommand 同一步也會把命令解除，所以這是同一件事
    // 的兩道保險 —— 但兩道的節奏不同：命令層的解除是每步的，而這一格擋的
    // 是「解除與發令之間」那一瞬。留一個指向退場飛機的 target 會讓 AI
    // 對著一個不存在的東西解預瞄
    let focus: Aircraft | null = null
    if (order !== null && order.kind === 'focus') {
      const c = cs[order.focusIndex]
      if (c !== undefined && c.alive) focus = c.aircraft
    }
    for (let p = 0; p < flight.count; p++) {
      const ai = cs[flight.members[p]!]!.controller
      if (ai instanceof AiController) {
        ai.order = order
        ai.focusTarget = focus
      }
    }
  }
}

/** 還活著的架數。 */
export function aliveCount(cs: readonly Combatant[]): number {
  let n = 0
  for (let i = 0; i < cs.length; i++) if (cs[i]!.alive) n++
  return n
}

/** 助攻掃描的暫存。熱路徑之外，但沿用專案的不配置慣例。 */
const ASSISTS: number[] = []

/**
 * 把擊墜緩衝裡的每一筆記進名冊。
 *
 * 【為什麼在 `stepBattle` 而不是 `World`】`World` 不該知道有「名字」或
 * 「玩家」這回事 —— 它連隊伍都只知道 `'blue' | 'red'`。而且放在這裡，
 * 接手的身分互換與擊墜的記錄可以保證在同一個地方、同一個順序
 * （M9 spec §4.3、§7.1）。
 *
 * 【為什麼每次都從 0 掃】`main.ts` 每個子步排空這個緩衝，headless 的測試
 * 不排 —— 於是同一筆事件會被重掃。這裡不記游標，靠的是 `recordKill` 的
 * 「已陣亡就略過」讓重掃變成空操作。用游標反而危險：呼叫端排空之後
 * `count` 歸零，任何「處理到哪裡」的記錄都會與新的一批事件錯位。
 */
function drainKills(b: Battle): void {
  const ke = b.world.killEvents
  const w = b.world
  for (let e = 0; e < ke.count; e++) {
    const o = e * KILL_STRIDE
    const victim = ke.data[o + 6]!
    const killer = ke.data[o + 7]!
    // 【互換必須在記錄之前】反過來的話這次陣亡與兇手的擊墜對象都會記到
    // 玩家頭上，交換只是把它搬給 AI —— 一個順序解決兩件事（M9 spec §7.1）。
    //
    // 【這一段對自摔也要跑】專案負責人裁決：墜海不記 K/D，但**算死亡**，
    // 而玩家死亡就要換機。把 `killer < 0` 的判斷提到這裡之前，墜海就不再
    // 觸發接手 —— 玩家從此卡在一架已經退場的飛機裡，而記分板上每個數字
    // 都正常，沒有任何東西會透露這件事。
    //
    // 【判準是「這個座位坐的是不是玩家」而不是 `victim === b.player.index`】
    // 移交延遲期間玩家的身分已經在新座位上，但 `b.player` 還沒換。用後者
    // 的話，延遲期間新座位被打死就不會再觸發接手（M9 spec §7.4）。
    if (b.roster.pilots[victim]?.isPlayer === true) {
      const target = pickTakeover(b.flights, w.combatants, victim)
      if (target >= 0) {
        swapPilots(b.roster, victim, target)
        b.takeoverSeat = target
        b.takeoverTimer = TAKEOVER_DELAY
        // 【死亡鏡頭要看的人】自摔時是 −1，那時鏡頭不轉（`camera/deathCam.ts`）
        b.takeoverKiller = killer
      }
    }

    // 【自摔不掃助攻】`recordKill` 本來就會擋掉，但連掃都不掃才讓「自摔在
    // 戰績上完全不存在」這件事在這裡看得出來，而不是藏在被呼叫者裡面。
    if (killer >= 0) {
      assistCredits(w.damageTime, w.damageStride, victim, killer, w.time, ASSISTS)
    } else {
      ASSISTS.length = 0
    }
    recordKill(b.roster, victim, killer, ASSISTS)
  }
}

/**
 * 把操縱權交到等待中的座位上。
 *
 * 【為什麼身分立刻換、操縱權延後】那 2 秒是給玩家看自己的火球與零件的
 * （M8 條件 17 的前提）。但擊墜的歸屬必須在事件發生的那一刻就定案，
 * 否則兇手記到的是玩家而不是那位 AI（M9 spec §7.2）。
 */
function completeTakeover(b: Battle): void {
  const seat = b.takeoverSeat
  b.takeoverSeat = -1
  b.takeoverTimer = 0
  b.takeoverKiller = -1
  const next = b.world.combatants[seat]
  // 【目標可能在這 2 秒裡也死了】那時 drainKills 已經又換過一次身分並重設
  // 了倒數，所以走到這裡的座位恆是活的；這一條是防禦，不是常態路徑。
  if (next === undefined || !next.alive) return
  next.controller = b.playerController
  b.player = next
  // 站位由 wireStations 依 `instanceof AiController` 自動跟上
  b.flights.pinned = seat
}

/**
 * 推進一場戰鬥：世界一步，加上戰績記錄、接手移交、編制壓縮與勝負判定。
 */
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)
  drainKills(b)

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
  // 【倒數要排在壓縮之前】移交會改 `flights.pinned`，同一步的壓縮才會把
  // 玩家放到新分隊的 members[0]
  if (b.takeoverSeat >= 0) {
    b.takeoverTimer -= dt
    if (b.takeoverTimer <= 0) completeTakeover(b)
  }

  compactFlights(b.flights, cs)
  wireStations(b)
  stepCommandLayer(b, dt)

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
 *
 * @param seed 新的名字種子。省略時抽一個 —— 專案負責人裁決「再打一場則
 *             重新隨機」（M9 spec §6.1）。
 */
export function resetBattle(
  b: Battle, seed: number = (Math.random() * 0x100000000) >>> 0,
): void {
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

  // 【被接手過的座位要還給 AI】接手時那顆 AiController 被丟掉了。少了這一段，
  // 重開之後戰場上會有一架永遠不動的飛機 —— 玩家的控制器同時裝在兩個座位上，
  // 而其中一個不會收到任何輸入。
  b.player = combatants[b.playerSeat]!
  b.flights.pinned = b.playerSeat
  b.takeoverSeat = -1
  b.takeoverTimer = 0
  b.takeoverKiller = -1
  for (const c of combatants) {
    if (c.index === b.playerSeat) {
      c.controller = b.playerController
      continue
    }
    if (c.controller instanceof AiController) continue
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = c.index
    // 【難度也要抄回去】少了這一行，被玩家接手過的座位重開之後會悄悄
    // 變回 ACE —— 一場裡有一架敵人比其他人強，而且找不出原因。
    ai.profile = b.cfg.aiProfile
    ai.setDecisionPhase(c.index / combatants.length)
    c.controller = ai
  }

  // 【名字重抽】專案負責人裁決「再打一場則重新隨機」
  b.seed = seed
  const blueNames = pilotNames(seed, factionOf(b.blue[0]!.aircraft.spec.id), b.blue.length)
  const redNames = pilotNames(seed, factionOf(b.red[0]!.aircraft.spec.id), b.red.length)
  let bi = 0
  let ri = 0
  for (let i = 0; i < combatants.length; i++) {
    const p = b.roster.pilots[i]!
    p.name = combatants[i]!.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!
    p.kills = 0
    p.deaths = 0
    p.assists = 0
    p.alive = true
    p.isPlayer = i === b.playerSeat
  }

  // 【為什麼還要這一行】上面對每一架呼叫的 `World.respawn` 各清掉「打過它」
  // 的那一欄，合起來剛好是整張表 —— 但那是巧合式的完整。這一行讓「重開
  // 不留上一場的傷害紀錄」這個意圖自己成立，不倚賴迴圈涵蓋了每一個座位。
  b.world.clearDamageLog()
  b.board.assignments.fill(-1)
  compactFlights(b.flights, combatants)
  // 【wireStations 要在最後】它會依 `instanceof AiController` 重接站位參考，
  // 而上面剛換過控制器
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
