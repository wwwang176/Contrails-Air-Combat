import type { BattleConfig } from './battleConfig'
import type { Battle } from './battleState'
import { createConvoy } from './convoy'
import { World, type Combatant, type Team } from '../world/World'
import type { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard } from '../ai/target'
import { ACE } from '../ai/profile'
import { resetBombBay } from '../weapons/bomb'
import {
  compactFlights, createFlights, stationReferenceOf, type Flight,
} from './flights'
import {
  assertOrderOfBattle, lineAbreast,
} from './order'
import { STATION_OFFSETS } from '../ai/station'
import { settle, spawnMember, unitFrame } from './flightSpawn'
import { placeBalloons, placeFleet, placeGround } from './missionSpawns'
import { stepBeats } from './missionBeats'
import { stepFlareRotation } from './flareRotation'
import { createCommandState } from '../ai/command'
import { type CommandUnit, type FlightOrder } from '../ai/commandTypes'
import { makeCommandUnit, stepCommandLayer, stepPressure } from './commandLayer'
import { evacOrderOf, stepMissionProgress } from './missionProgress'
import {
  createBeatStates, type Beat,
} from './beats'
import { clearImpacts } from '../world/events'
import {
  createBattleReport, resetBattleReport,
} from './report'
import { drainKills, drainReports } from './combatEvents'
import { pilotNames } from './names'
import { createRoster } from './pilots'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { HEAD_ON } from './entry'
import {
  NEUTRAL_TUNING, createMissionState, resetMissionState,
} from './mission'
import type { Controller } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'
import { resetShip } from '../world/ships'
import { resetShipGuns } from '../world/shipGuns'
import { resetGroundTarget } from '../world/groundTargets'
import { clearBursts, clearFlak } from '../world/flak'
import { clearFlares, FLARE_LANES } from '../world/flares'
import { resetBalloon } from '../world/balloons'

export type { ConvoyIndex, TransitRoute } from './convoy'
export type { BattleConfig } from './battleConfig'
export type { Battle } from './battleState'

export const DEFAULT_BATTLE: BattleConfig = {
  // 【對頭 20v20 是預設】直接吃 `DEFAULT_BATTLE` 的整合測試與探針都建立在它上面
  units: lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20),
  altitude: 4000,
  tas: 200,
  entryRange: 10000,
  schwarmSpacing: 800,
  lateralOffset: 1500,
  altitudeSpread: 300,
  // 【測試的基準是天花板】遊戲的難度由 `battleConfigFrom` 覆寫，見
  // `aiProfile` 的註解。
  aiProfile: ACE,
  // 【遭遇戰＝沒有時限的殲滅】它是一條規則，不是兩行寫死的判斷
  rules: { kind: 'annihilate' },
  tuning: NEUTRAL_TUNING,
}

/**
 * 一場戰鬥的結果。**定義搬到 `mission.ts`** —— 它現在是任務判定的產物，
 * 而勝負條件不再只有「誰全滅」。這裡再匯出，既有的 import 站點不用動。
 */
export type { Outcome } from './mission'

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
  assertOrderOfBattle(cfg.units)

  const world = new World()
  // 【排在任何一架進場之前】`add` 與 `setSpec` 都讀它
  world.loadoutOverrides = cfg.loadouts ?? {}
  const blue: Combatant[] = []
  const red: Combatant[] = []
  let player: Combatant | null = null
  /**
   * 每個小隊的架數，依 `world.add` 的順序。**交給 `createFlights`** ——
   * 分組只能有一份，不能讓它自己再猜一次（見 `flights.ts` 的 `sizes`）。
   */
  const sizes: number[] = []
  /** 每個小隊的隊伍，依 `sizes` 的順序。預留的小隊推不出來，只能在這裡記 */
  const flightTeams: Team[] = []
  /** `duty === 'transit'` 的座位索引與它們各自的出生 x（見 `ConvoyIndex`） */
  const convoySeats: number[] = []
  const convoyX: number[] = []
  /** 那幾架的 `FlightPlan.rise` 與 `depth`，終點帶著同樣的偏移 */
  const convoyRise: number[] = []
  const convoyDepth: number[] = []
  /** 那幾架各自的**分隊**索引。編制依 `cfg.units` 的順序建，所以就是單位序號 */
  const convoyFlights: number[] = []
  /**
   * base spec → 套過手感係數的 spec。**每陣營一張表。**
   *
   * 【為什麼要記憶】`applyFeel` 一側算一次，所以同一側的 20 架共用
   * 同一個物件。逐小隊算的話同隊會變成好幾個物件 —— 數值完全相同
   * （`applyFeel` 是純函數），但下游有三個**依物件識別**的快取會失效。
   *
   * 【為什麼是每陣營一張而不是全場一張】全場一張會讓鏡像對戰（兩隊同機種）
   * 由兩個 spec 物件變成一份，而依物件識別的快取有三個，不只 `ceilings`：
   *
   * ```
   *   setup.ts       Map<AircraftSpec, number>            serviceCeiling
   *   envelope.ts    WeakMap<AircraftSpec, Float64Array>  最佳迴旋表
   *   doctrine.ts    WeakMap<AircraftSpec, Float64Array>  持續迴旋率表
   * ```
   *
   * 後兩者都在 **AI 更新路徑**上，而 `doctrine.ts` 的註解明寫「一次填滿、
   * 不惰性逐格填」是因為逐格填會讓 AI 步的 p999 由 217 µs 惡化到 3.8 ms。
   * 共用會少填一張表 —— 數值仍然相同，但那是一個沒有必要冒的啟動成本與
   * perf gate 的變動。
   *
   * 每陣營一張的分法是：同隊同機種共用一份、兩隊各自一份。
   */
  const feeled = {
    blue: new Map<AircraftSpec, AircraftSpec>(),
    red: new Map<AircraftSpec, AircraftSpec>(),
  }
  /**
   * base spec → 巡航速度，m/s。只有轟炸機用得到（見 `openingTas`）。
   *
   * 【為什麼與 `feeled` 分開一張】`maxLevelSpeed` 是一次求根搜尋，而它要吃
   * **套過手感的** spec。兩張表同一個查表時機、同一個生命週期，但鍵是
   * base spec、值是一個數字 —— 混進 `feeled` 會讓那張表的型別變成聯合。
   *
   * 【為什麼不快取在模組層】它與 `cfg.altitude` 有關，而探針會換高度。
   */
  const cruises = new Map<AircraftSpec, number>()

  // 藍隊在 +Z、機首朝 −Z；紅隊在 −Z、機首朝 +Z（繞 Y 轉 π）
  for (const unit of cfg.units) {
    const frame = unitFrame(cfg, unit)
    /** 這個分隊已經造好的飛機，供 stationPoint 當參考機 */
    const made: Aircraft[] = []
    for (let k = 0; k < unit.members.length; k++) {
      const isPlayer = unit.player === true && k === 0
      const controller = isPlayer ? playerController : new AiController()
      const c = spawnMember(
        world, cfg, unit, frame, k, made, feeled, cruises, controller)
      if (isPlayer) player = c
      ;(unit.team === 'blue' ? blue : red).push(c)
      if (unit.duty === 'transit') {
        convoySeats.push(c.index)
        // 【取出生 x 而不是重推 lane】重推要把 `lane × schwarmSpacing +
        // across × lateralOffset` 再算一次。抄現成的值不可能算錯
        convoyX.push(c.spawnPosition.x)
        convoyRise.push(unit.rise ?? 0)
        convoyDepth.push(unit.depth ?? 0)
        convoyFlights.push(sizes.length)
      }
    }
    sizes.push(unit.members.length)
    flightTeams.push(unit.team)
  }

  if (player === null) throw new Error('玩家沒有被建立——編組表必須有一筆 player')

  // ── 預留給增援的容量 ──────────────────────────────────
  //
  // 【預留的分隊在這裡就建好，不是之後長出來】理由見 `BattleConfig.reserve`
  // 與 `createFlights` 的 `capacity`。連帶好處是下面四份依**分隊**的東西
  // （`blueCommand`／`redCommand`、兩隊的分隊索引清單、`convoyOrders`）
  // 全部自動含到預留的那幾隊 —— 它們讀的都是 `flights.flights`。
  //
  // 【沒有 reserve 時這一段完全空轉】`capacity` 等於架數，`world.reserve`
  // 的三個條件都不成立，`createFlights` 與 `createTargetBoard` 走的是省略
  // 參數的那一條。整條路是恆等的。
  let capacity = world.combatants.length
  const reserve = cfg.reserve ?? (cfg.beats ?? [])
    .filter((x): x is Extract<Beat, { kind: 'reinforce' }> => x.kind === 'reinforce')
    .map((x) => ({ team: x.flight.team, count: x.flight.members.length }))
  for (const r of reserve) {
    if (!Number.isInteger(r.count) || r.count < 1) {
      throw new Error(`預留的小隊架數必須是正整數，收到 ${r.count}`)
    }
    capacity += r.count
    sizes.push(r.count)
    flightTeams.push(r.team)
  }
  // 【上限由測試守，不在這裡拋】與現有的架數同一個做法 ——
  // `missions.ts` 已經記著「大於 MAX_SIDE 不會拋，只會建一個超出特效
  // 池容量的場」，而 `missions.test.ts` 逐張卡檢查。在這裡拋要把
  // `MAX_COMBATANTS` 從 `skirmish.ts` import 進來，而那一支 import 的是
  // 本檔 —— 會繞成循環
  world.reserve(capacity)

  // 【任務指定的掛載覆寫藍隊全體，不只玩家】AI 現在也會投放
  // （`World.releaseBombs`），所以覆寫只套在玩家身上的話，同一個編隊裡
  // 玩家掛炸彈、僚機掛魚雷 —— 而那不會有任何東西報錯。
  if (cfg.blueLoadout !== undefined) {
    for (const c of world.combatants) {
      if (c.team !== 'blue') continue
      c.loadout = cfg.blueLoadout
      resetBombBay(c.bombBay, c.loadout)
    }
  }

  // 【編制必須在全部 add 完之後才建】玩家要釘在自己分隊的 members[0]
  // （M6 spec §5.3）
  const flights = createFlights(world.combatants, player.index, sizes, capacity, flightTeams)
  // 【指派板同理】它會檢查 index 與陣列位置一致，而 index 是 add 依序給的。
  //
  // 【為什麼要傳 `flights.flightOf`】分攤折扣因此**不數同小隊**（見
  // `countLocks` 的註解）。沒有它時長機會被自己的僚機罰：僚機的職責就是
  // 打長機正在打的那一架，跟上之後卻被算成「這架已經有人在打了」，長機
  // 於是把到手的射擊解讓出去。
  //
  // 【編制刻意排在前面】就是為了讓這裡拿得到 `flightOf` 那一個實體 ——
  // `compactFlights` 每個物理步就地重填它，板子因此永遠讀到當步的編制。
  // 【被護送的那幾架在敵方眼中值幾倍】沒有它的話護航機會把攔截方的目標
  // 全部吸走 —— 實測轟炸機**一發都不會挨到**（`docs/backlog.md` §2.26）。
  // 中性值是 1，所以遭遇戰與殲滅任務這一整條逐字如舊。見 `MissionTuning`
  const priority = new Float64Array(capacity).fill(1)
  const protectedMask = new Uint8Array(capacity)
  // 【轟炸機倍率先寫，transit 的再蓋上去】被護送的那幾席以 `convoyPriority` 為準
  const bomberPriority = cfg.tuning.bomberPriority ?? 1
  for (const c of world.combatants) {
    if (c.aircraft.spec.role === 'bomber') priority[c.index] = bomberPriority
  }
  for (const seat of convoySeats) {
    priority[seat] = cfg.tuning.convoyPriority
    protectedMask[seat] = 1
  }
  const board = createTargetBoard(
    world.combatants, flights.flightOf, priority, protectedMask, capacity,
  )
  // 【升限每個機種算一次】`serviceCeiling` 不是 `AircraftSpec` 上的欄位
  // （`types.ts` 的那一個在 `HistoricalReference` 裡，是史實對照值），它由
  // `envelope.ts` 用二分搜尋實算 —— 那才是**套過 `feel.ts` 倍率之後**這架
  // 飛機真正爬得到的高度。搜尋不便宜（50 次 `maxClimbRate`），所以依 spec
  // 物件記憶：一場 20v20 只有兩種機型，實際只算兩次。
  const ceilings = new Map<AircraftSpec, number>()
  const commandUnits: CommandUnit[] = world.combatants.map(
    (c) => makeCommandUnit(c, ceilings))
  const blueCommand = createCommandState(flights.flights.length)
  const redCommand = createCommandState(flights.flights.length)
  const convoyOrders: (FlightOrder | null)[] = flights.flights.map(() => null)
  const convoy = createConvoy(cfg, world.combatants, convoyOrders, {
    seats: convoySeats, x: convoyX, rise: convoyRise, depth: convoyDepth,
    flights: convoyFlights,
  })

  const blueFlightIndices: number[] = []
  const redFlightIndices: number[] = []
  const blueOrderFlights: number[] = []
  const redOrderFlights: number[] = []
  for (let f = 0; f < flights.flights.length; f++) {
    const blueSide = flights.flights[f]!.team === 'blue'
    ;(blueSide ? blueFlightIndices : redFlightIndices).push(f)
    // 【被護送的小隊不進下令端】理由見 `Battle.blueOrderFlights`
    if (convoyOrders[f] === null) (blueSide ? blueOrderFlights : redOrderFlights).push(f)
  }

  // AI 接線：指派板、自身索引、決策相位
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    ai.profile = cfg.aiProfile
    ai.priorityGroundUnit = c.team === 'blue' ? cfg.tuning.priorityGroundUnit ?? null : null
    ai.airOnly = c.team === 'blue' && cfg.tuning.airOnly === true
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  // 【名字依陣營而不是隊伍顏色】M10 讓玩家選陣營之後藍隊可能飛 Bf109，
  // 那時德文名要跟著機種走（M9 spec §6.1）。這裡讀每一隊實際的機種。
  const blueNames = pilotNames(seed, blue[0]!.aircraft.spec.faction, blue.length)
  // 【紅隊可以是空的】德 M2 沒有敵機；`red[0]` 那時是 undefined
  const redNames = red.length === 0
    ? []
    : pilotNames(seed, red[0]!.aircraft.spec.faction, red.length)
  let bi = 0
  let ri = 0
  const roster = createRoster(
    world.combatants.map((c) => (c.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!)),
    player.index,
  )

  placeFleet(world, cfg.fleet)
  placeGround(world, cfg.ground, feeled, cfg.flakSpec, cfg.feels)
  // 【排在艦隊之後】繫在船上的氣球要讀那艘船的位置與艏向
  placeBalloons(world, cfg.balloons)
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
    // 【起始為 0，第一步就算一次】開局正是護航機該知道被護送的那幾架
    // 有沒有被咬的時候
    pressureTimer: 0,
    commandUnits,
    blueFlightIndices,
    redFlightIndices,
    blueOrderFlights,
    redOrderFlights,
    convoy,
    reserveUsed: 0,
    feeled,
    cruises,
    ceilings,
    reserve,
    beatStates: createBeatStates(cfg.beats ?? []),
    beatsLeft: cfg.beats?.length ?? 0,
    flareRotation: null,
    flareLane: new Int32Array(FLARE_LANES).fill(-1),
    flareDue: new Float64Array(FLARE_LANES).fill(-1),
    flareCursor: 0,
    message: null,
    messageUntil: 0,
    objectiveKey: null,
    rules: cfg.rules,
    evacOrder: evacOrderOf(cfg.rules),
    spawnOrientations: world.combatants.map((c) => c.aircraft.state.orientation.clone()),
    outcome: 'fighting',
    mission: createMissionState(cfg.rules),
    reviveAt: new Float64Array(flights.flights.length).fill(-1),
    batches: 0,
    killsSeen: world.killEvents.total,
    groundKillsSeen: world.groundKillEvents.total,
    report: createBattleReport(),
    redKilled: 0,
    redKilledBombers: 0,
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
  // 【離地的那一席在名冊上活過來】它在滑行期間是不存活的席位（`reinforce`）。
  // 排在 `drainKills` 之前：離地那一步就被打下來的話，擊落要記在活過來的那一列上 ——
  // 反過來排，`recordKill` 會跳過還沒活過來的那一列，戰績漏記、名冊留著存活
  const lifted = b.world.liftoffs
  for (let i = 0; i < lifted.length; i++) b.roster.pilots[lifted[i]!]!.alive = true
  lifted.length = 0
  drainKills(b)
  drainReports(b)

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

  // 【節拍排在編制之前】最後一架第一波敵機被擊落的**同一步**就要能加第二波
  // ——排在勝負判定之後就來不及，那一步已經判成「一方全滅」了。而排在
  // `compactFlights` 之前，新分隊在下一次 `World.step` 之前就完成編制與接線
  stepBeats(b)
  stepFlareRotation(b)

  compactFlights(b.flights, cs)
  wireStations(b)
  stepCommandLayer(b, dt)
  stepPressure(b, dt)

  if (b.outcome !== 'fighting') return

  stepMissionProgress(b, dt)
}

/**
 * 整場回到滿編。
 *
 * 【與 R 鍵共用同一條路徑】兩份長得很像的初始化，就是只有一份會被修好的
 * 那種危險 —— 與 `Aircraft.respawn`、`World.destroy` 是同一個理由。
 *
 * @param seed 新的名字種子。省略時抽一個 —— 再打一場的名字重新隨機
 *             （M9 spec §6.1）。
 */
export function resetBattle(
  b: Battle, seed: number = (Math.random() * 0x100000000) >>> 0,
): void {
  b.world.projectiles.clear()
  // 【炸彈也要清】它的壽命是彈丸的 75 倍（90 s 對 1.2 s）—— 上一場還在空中
  // 的炸彈會在第二場繼續落下，看起來像憑空冒出來的水柱。
  b.world.bombs.clear()
  // 【魚雷更久】跑滿射程要 91 秒，比炸彈的上限還長。而且它會在水面拉出
  // 一條航跡 —— 上一場的那一條會在第二場繼續往前走
  b.world.torpedoes.clear()
  // 【船與高砲也要重設】`japan-m3` 沒有波次，所以「再打一場」走的是就地
  // resetBattle、**不重建 World**。少了這一段，第二局會是船停在上一局結束
  // 的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在空中而且會引爆 ——
  // 全程不報錯。
  clearFlak(b.world.flak)
  clearFlares(b.world.flares)
  // 【輪替也停】節拍不重播（見 `battle-restart.test.ts`），輪替跟著節拍走
  b.flareRotation = null
  b.flareLane.fill(-1)
  b.flareDue.fill(-1)
  b.flareCursor = 0
  clearBursts(b.world.burstEvents)
  for (const s of b.world.ships) {
    resetShip(s)
    resetShipGuns(s)
  }
  // 【地面目標也要】沒有波次的關重開不重建 World，走的是這一條
  for (const t of b.world.groundTargets) resetGroundTarget(t)
  b.world.liftoffs.length = 0
  // 【時鐘也要歸零】砲塔的搖晃相位吃 `world.time`。不歸零的話，第二場即使
  // 種子與設定完全相同也會從不同的相位開始 —— 逐位元重播因此破功，而症狀
  // 看起來像隨機的。
  b.world.time = 0
  const combatants = b.world.combatants
  for (let i = 0; i < combatants.length; i++) {
    const c = combatants[i]!
    b.world.respawn(c)
    // 【方位與速度要另外抄回去】`World.respawn` 走的是 `Aircraft.reset`，
    // 它重建的是一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
    settle(c, c.spawnPosition, b.spawnOrientations[i]!, c.spawnTas)
  }
  // 【等重生的小隊也要忘掉】不清的話上一場排好的重生會在新場的開頭發生，
  // 而那一支此刻活得好好的
  b.reviveAt.fill(-1)
  b.batches = 0
  // 【上一場還沒排空的擊墜不記進新場】游標跳到現在的流水號
  b.killsSeen = b.world.killEvents.total
  b.groundKillsSeen = b.world.groundKillEvents.total
  // 【上一場沒排空的也要丟掉】那兩條由 `drainReports` 獨佔並就地排空，
  // 但重開之前的最後一步可能剛推進去 —— 留著的話新場第一步就會通報它
  clearImpacts(b.world.shipKillEvents)
  clearImpacts(b.world.shipHitEvents)
  // 【氣球回到空中】破掉的長回來；上一場沒排空的破掉事件丟掉
  for (const bl of b.world.balloons) resetBalloon(bl)
  clearImpacts(b.world.balloonKillEvents)
  // 【通報也要清】不清的話新的一場開場那三秒還掛著上一場的最後幾則，
  // 而佇列裡沒出場的會一條一條慢慢冒出來
  resetBattleReport(b.report)
  // 【擊落的累計與抵達的閂都要歸零】它們是跨步累積的，不歸零的話第二局
  // 開場就帶著上一局的進度 —— `hunt` 可能第一幀就判勝，護送可能第一幀就
  // 判定送到了，而畫面上一切正常
  b.redKilled = 0
  b.redKilledBombers = 0
  if (b.convoy !== null) b.convoy.arrived.fill(false)

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
    // 【沿用的控制器要放掉空層鎖】重開之後目標常常是同一架，換目標那一道擋不住
    // 上一場記下的回升高度與離場（見 `AiController.resetAirTactics`）
    if (c.controller instanceof AiController) {
      c.controller.resetAirTactics()
      continue
    }
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = c.index
    // 【難度也要抄回去】少了這一行，被玩家接手過的座位重開之後會悄悄
    // 變回 ACE —— 一場裡有一架敵人比其他人強，而且找不出原因。
    ai.profile = b.cfg.aiProfile
    ai.setDecisionPhase(c.index / combatants.length)
    c.controller = ai
  }

  // 【名字重抽】再打一場的名字重新隨機
  b.seed = seed
  const blueNames = pilotNames(seed, b.blue[0]!.aircraft.spec.faction, b.blue.length)
  // 【紅隊可以是空的】與 `createBattle` 同一條規則
  const redNames = b.red.length === 0
    ? []
    : pilotNames(seed, b.red[0]!.aircraft.spec.faction, b.red.length)
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
  b.board.pressure.fill(0)
  b.pressureTimer = 0
  compactFlights(b.flights, combatants)
  // 【wireStations 要在最後】它會依 `instanceof AiController` 重接站位參考，
  // 而上面剛換過控制器
  wireStations(b)
  // 【任務狀態也要重設】少了這一行，「再打一場」會直接開在上一場的結果上，
  // 而撤離的倒數會從 0 開始 —— 開局第一個物理步就判 defeat。
  //
  // 【就地寫回而不是換一個 MissionState】`b.mission` 是 readonly 參考，
  // `main.ts` 與 HUD 每幀讀 `mission.target`。
  // 【規則也要還原】返航節拍換過的話，重開一場要回到卡片上原本那一條
  b.rules = b.cfg.rules
  b.evacOrder = evacOrderOf(b.rules)
  resetMissionState(b.rules, b.mission)
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
