import type { BattleConfig } from './battleConfig'
import type { Battle } from './battleState'
import { DEFAULT_BATTLE } from './battleDefaults'
import { createConvoy } from './convoy'
import { World } from '../world/World'
import type { Combatant } from '../world/combatant'
import type { Team } from '../world/team'
import type { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard } from '../ai/target'
import { resetBombBay } from '../weapons/bomb'
import { createFlights } from './flights'
import { assertOrderOfBattle } from './order'
import { spawnMember, unitFrame } from './flightSpawn'
import { placeBalloons, placeFleet, placeGround } from './missionSpawns'
import { createCommandState } from '../ai/command'
import type { CommandUnit, FlightOrder } from '../ai/commandTypes'
import { makeCommandUnit } from './commandLayer'
import { evacOrderOf } from './missionProgress'
import { createBeatStates, type Beat } from './beats'
import { createBattleReport } from './report'
import { pilotNames } from './names'
import { createRoster } from './pilots'
import { createMissionState } from './mission'
import type { Controller } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'
import { FLARE_LANES } from '../world/flares'
import { wireStations } from './stationWiring'
import { armPatrol, createAlertState } from './alert'

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
    alert: cfg.alert === undefined ? null : createAlertState(cfg.alert, flights.flights),
  }
  wireStations(battle)
  // 【警戒關：開場就停火、先發巡邏令】排在 `wireStations` 之後 —— 它會重接站位參考
  if (battle.alert !== null) {
    world.holdFire.fill(1)
    armPatrol(battle)
  }
  return battle
}
