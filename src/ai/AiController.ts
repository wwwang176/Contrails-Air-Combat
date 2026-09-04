import { Vector3 } from 'three'
import {
  alarmFactor, alarmRamp, considerThreatFrom, createSituation, evaluateEnergy,
  evaluateGeometry, evaluateThreat, trackingFactor,
} from './assess'
import {
  createRuleState, stepRules, DEFAULT_RULES, type Intent, type RuleConfig,
} from './rules'
import {
  buildEngageBasis, createBandState, createDefendState, createEngageBasis, createTrackState,
  engageKnobs, stepBand,
  geometryGate, shrinkTowardNose, stepDefend, stepExtendSide, steerCommand, stepTrack,
  DEFAULT_STEER, type Knobs, type SteerMode,
} from './steer'
import { DEFAULT_DOCTRINE, energyPull, manoeuvreSpeed } from './doctrine'
import { DEFAULT_AI_BURST, shouldFire, type BurstConfig } from './fire'
import { resetBurst, stepBurst } from '../weapons/burst'
import {
  createTargetState, selectTarget, teamSlot, DEFAULT_TARGET,
  type TargetBoard, type TargetConfig,
} from './target'
import {
  DEFAULT_TACTICS, createTacticalState, hasSlot, resetTacticalState, stepTactics,
  tacticalCommand, teamIndexOf, type TacticalConfig, type TacticalInput,
} from './tactics'
import { applySafety, type SafetyAction } from './safety'
import {
  createSense, resetSense, senseTerrain, SENSE_INTERVAL,
  type TerrainSense, type TerrainSource,
} from './terrainSense'
import {
  DEFAULT_STATION, STATION_OFFSETS, stationCommand, stationPoint,
  type StationConfig, type StationOffset,
} from './station'
import {
  DEFAULT_WINGMAN, LEVEL_SELF_DEFENCE, createWingmanState, selectWingmanTarget,
  type WingmanConfig,
} from './wingman'
import { rallyCommand } from './rally'
import { canAttackShips, pickShipTarget, shipAttackCommand } from './shipAttack'
import type { Ship } from '../world/ships'
import { ACE, type DifficultyProfile } from './profile'
import type { FlightOrder } from './command'
import { losBlocked } from '../world/occlusion'
import { CommandDelay } from './delay'

/**
 * 高度鎖的緩衝，m：鎖畫在參考高度（轟炸機／目標）下方這麼多。
 * 【為什麼不是旋鈕】它與 `floorAltExit`（出場遲滯）共同定義這條帶的形狀，
 * 兩個一起調才有意義；要掃描時再升格。
 */
const FLOOR_BUFFER = 100
/**
 * 追擊時允許沉到敵人下方多深，m。
 *
 * 【為什麼與 `FLOOR_BUFFER` 分家 —— 2026-08-25 實戰回報】兩條線守的東西
 * 不同：沉到**被護送者**下面是失職（緊，100）；沉到**敵人**下面 150~300 m
 * 是低位 yo-yo —— 教科書的纏鬥動作，切進圈內側換速度抄近路。共用 100 的
 * 帶寬時，跟著敵人迴旋的每一次 yo-yo 都觸發 extend(高度) 拉高 1~3 秒，
 * 咬住的尾就丟了（專案負責人的原話：「這時候觸發拉高敵人就飛走了」）。
 * 這條護欄要擋的是持續深潛（曾實測鑽到編隊下 280 m 不回頭），不是三秒的
 * 戰術下沉。
 */
const CHASE_FLOOR_BUFFER = 300
import type { Aircraft } from '../aircraft/Aircraft'
import { createCommand, type Command, type Controller } from '../control/Controller'

/** 意圖仲裁與包絡查詢的頻率，Hz。 */
export const AI_DECISION_HZ = 10

const FWD = new Vector3(0, 0, -1)

/**
 * 敵機 AI。實作 `control/Controller`，所以 `World` 一個字都不用改。
 *
 * 【全部的狀態都住在這裡】`assess` / `rules` / `steer` / `fire` / `safety`
 * 都是純函數（spec §4.3）——這是 L4 的對戰矩陣能在 node 裡跑幾百場的前提。
 */
export class AiController implements Controller {
  /**
   * 交戰對象。`board` 為 null 時由 `main.ts` 或測試設定；否則由
   * `selectTarget` 在每個決策節拍改寫。
   */
  target: Aircraft | null = null
  /**
   * 該點的海面高度，m。**不含地形。**
   *
   * 【為什麼地形不寫進這裡】它還被 stationPoint、stationCommand、
   * tacticalCommand、steerCommand 讀。把「前方山高」寫進來，整套站位與
   * 戰術層會以為地板抬高了，僚機會莫名其妙爬升。地形只在 emit 裡合成一個
   * 局部值餵給安全層。
   */
  seaHeight = 0

  /**
   * AI 的地形來源。null = 平海面，**走的是與地形進來之前逐位元相同的路徑**。
   *
   * headless 的對戰矩陣、AI 護欄與 replayDigest 都不設定它 —— 那是既有基準
   * 不必重錄的原因。由 main.ts 的 wireTerrain 注入。
   */
  terrain: TerrainSource | null = null

  /**
   * 這一場的船。**空陣列 = 這一場沒有船**，而那是絕大多數的場次 ——
   * 對艦那一段於是連問都不會問，行為與改動前逐字相同。
   *
   * 【為什麼是注入而不是 import 一個世界】與 `terrain` 同一個理由：
   * `AiController` 不持有 `World`，而 `main.ts` 每幀掃一次把它接上
   * （見 `wireTerrain`）。
   */
  ships: readonly Ship[] = []

  /**
   * 目前鎖定的敵艦索引；−1 = 沒有。
   *
   * 【為什麼與 `targetIndex` 分開】那一格是 `TargetBoard.candidates` 的
   * 索引，而船不在那張表裡。共用一個欄位就得在每個讀它的地方先問
   * 「這是飛機還是船」—— 那正是 spec §2 拒絕過的那種污染。
   */
  shipTargetIndex = -1

  /**
   * 沒有空中目標時，試著找一艘船打。回傳 true 代表 `out` 已經寫滿。
   *
   * 【為什麼是一支私有方法而不是寫在分支裡】那一段本來就有三個 `return`
   * 與一堆鎖存維護，再塞五十行進去沒有人讀得完。而且這樣「沒有船就是
   * 一次早退」看得出來。
   *
   * 【重選只在決策拍】與空戰的目標選擇同一個節奏（10 Hz）。每個物理步
   * 重選的話，兩艘距離相近的船會讓機首在 240 Hz 下抖。
   */
  private attackShip(self: Aircraft, decide: boolean, out: Command): boolean {
    // 【沒有固定掛架就不去】一式陸攻飛到船上方射不出任何東西 ——
    // 它的武器全是 AI 砲塔，而砲塔本來就會自己打船。
    if (this.ships.length === 0 || !canAttackShips(self.spec)) {
      this.shipTargetIndex = -1
      return false
    }
    // 【陣營從板子讀】`AiController` 自己沒有這一格 —— 它只知道自己在
    // `candidates` 裡的位置。拿不到板子就不打船（那是試驗場與探針的情形，
    // 那些場景本來就沒有船）。
    const me = this.board?.candidates[this.selfIndex]
    if (me === undefined) {
      this.shipTargetIndex = -1
      return false
    }
    if (decide) {
      this.shipTargetIndex = pickShipTarget(self.state.position, me.team, this.ships)
    }
    const ship = this.shipTargetIndex >= 0 ? this.ships[this.shipTargetIndex] : undefined
    // 【每一步都要複查】上一個決策拍之後它可能已經沉了，而下一次重選要
    // 到 100 ms 後 —— 那一段時間對著一艘沉船掃射看起來就是壞掉。
    if (ship === undefined || !ship.alive) {
      this.shipTargetIndex = -1
      return false
    }
    shipAttackCommand(self, ship, out)
    return true
  }

  /**
   * 清掉地形的鎖存。**換場、換座位、重生之後都要呼叫。**
   *
   * playerAi 跨場重用，resetBattle 在玩家接手過座位之後也會建新的控制器 ——
   * 上一場「我正在繞第 17 座島」的承諾不得帶進新的一場。
   */
  clearTerrainState(): void {
    resetSense(this.sense)
    // 【連採樣節拍一起重設】只清 sense 的話，新場最多要等 11 個物理步才會
    // 第一次感知，那段時間 AI 是用 floor = 0 在飛。負的起點讓
    // (senseTick + sensePhase) 在下一次 emit 就命中 0
    this.senseTick = -this.sensePhase
  }

  /** 地形感知的結果與鎖存狀態 */
  private readonly sense: TerrainSense = createSense()
  /** 物理步的計數，用來每 SENSE_INTERVAL 步重算一次 */
  private senseTick = 0
  /**
   * 這一架的感知相位 —— **由座位決定，不是由建立順序**。
   *
   * 沒有錯開的話 40 架會在同一個物理步一起算，做出週期性的尖峰，而那會直接
   * 打在 frame-time 量的 1% low 上。
   *
   * 【為什麼不是一個全域遞增的計數器】那樣相位會取決於這個 process 先前
   * 建過幾架 AI —— 重開、接手次數不同就會改變之後每一架的相位。仍然是
   * 決定性的，但同一個座位在不同場次會拿到不同的相位，難以重現。
   */
  private get sensePhase(): number { return this.selfIndex % SENSE_INTERVAL }
  profile: DifficultyProfile = ACE

  /**
   * 目標選擇的共享指派板。
   *
   * 【null 時完全是 M4 的行為】`target` 由外部指派、不做選擇。M4 的全部
   * 測試與 `bench/ai-load.ts` 因此一個字都不用改（M5 spec §6.6）。
   */
  board: TargetBoard | null = null
  /** 自己在 `board.candidates` 裡的索引。`board` 為 null 時不使用 */
  selfIndex = -1
  targetConfig: TargetConfig = DEFAULT_TARGET

  /**
   * 站位參考機，同時也是**掩護對象**（M6 spec §5.1）。
   *
   * 【null 時完全是 M5 的行為】自由選目標、沒有目標就平飛。Schwarm 長機、
   * 落單者、以及還沒接線的實例都走這一條，所以 M4 的全部測試與
   * `bench/ai-load.ts` 一個字都不用改。
   */
  stationReference: Aircraft | null = null
  /** 站位參考機在 `board.candidates` 裡的索引；−1 = 無 */
  stationReferenceIndex = -1
  /** 這一架的站位偏置。`stationReference` 為 null 時不使用 */
  stationOffset: StationOffset = STATION_OFFSETS[0]!
  stationConfig: StationConfig = DEFAULT_STATION
  wingmanConfig: WingmanConfig = DEFAULT_WINGMAN
  /**
   * 上一個決策節拍算出的站位誤差，m。供 HUD、telemetry 與測試讀取。
   *
   * 【為什麼是 10 Hz 而不是每步】只有僚機的目標選擇讀它，而那本來就是
   * 決策節拍。整合測試的抽樣頻率遠低於 10 Hz，讀得到的精度綽綽有餘。
   */
  stationError = 0

  /**
   * 目前對我威脅最大的敵機。`board` 為 null 時恆為 null（退化成 M4 行為）。
   *
   * 【為什麼要記住是誰】`defend` 的破防方向要繞著**真正在打我的那一架**算，
   * 而它常常不是我的目標 —— 實測 20v20，長機 97.8% 的鎖定來自非目標敵機。
   *
   * 【為什麼它不改變 `target`】「誰在打我」與「誰最好打」是兩個問題。把它們
   * 綁在一起會變成：他打我 → 我切過去 → 他拉開 → 我又切回來，也就是剛修掉的
   * A→B→A 猶豫。閃躲只改**動作**，不碰目標選擇；至於要不要轉去打他，
   * `selectTarget` 的評分裡本來就有威脅項，會走正常的、有遲滯保護的路徑。
   */
  threatSource: Aircraft | null = null

  /**
   * 指揮層下來的命令；`null` = 自由交戰。由 `setup.ts` 每步寫入。
   *
   * 【它是外部覆寫，不是仲裁表裡的一列】見 `update` 裡那兩行的註解。
   */
  order: FlightOrder | null = null

  /**
   * **無條件飛向 `order.point`。** 被護送的那幾架（編組表上 `duty === 'transit'`）
   * 由 `setup.ts` 每步寫成 true。
   *
   * ── 它與一般的集合令差在哪 ──────────────────────────────
   *
   * 一般的集合令仍然讓位給閃躲：`defendLatch` 一上，意圖就變成 `defend`
   * （2026-08-07 專案負責人裁定「閃躲永遠優先」）。那對戰鬥機是對的 ——
   * 撤退途中被咬住還硬飛就是送死。
   *
   * 對**被護送的**那幾架不是。專案負責人 2026-08-21：「轟炸機目前如果被
   * 瞄準就會滾轉，這不合理；有辦法讓轟炸機有一個新的行動狀態，是無條件的
   * 移動到集合點嗎？」實測值印證了那個「不合理」：接觸之前滾轉恆為 0.0°，
   * 接觸之後衝到 85~89°，整隊的橫向散布由 600 m 撐開到 1,731 m ——
   * 畫面上是四架 B-17 一邊翻滾一邊各自跑掉，而真機的編隊是硬著頭皮飛完。
   *
   * ── 它關掉的**只有**閃躲 ───────────────────────────────
   *
   * 安全層（`applySafety`，拉平不撞海）照跑，砲塔照打（那一層完全不經過
   * 控制器，見 `world/turrets.ts`）。**這一條不是無敵，是不迴避。**
   */
  transit = false

  /**
   * 集火命令指定的那一架。`null` = 沒有指定。由 `setup.ts` 每步寫入。
   *
   * 【為什麼不直接放在 `FlightOrder` 裡】命令住在 `src/ai/command.ts`，而
   * 那一層只吃索引不吃 `Aircraft`（規劃是純函數，見該檔的註解）。索引解析
   * 成 `Aircraft` 是 `battle` 層的事 —— 與 `stationReference` 同一個手法。
   *
   * 【陣亡由 `setup.ts` 擋】它解析索引時若那一架已經退場就寫 `null`。
   * `AiController` 不必知道「命令裡的索引可能過期」這回事。
   */
  focusTarget: Aircraft | null = null

  /** 供 HUD、telemetry 與測試讀取 */
  intent: Intent = 'approach'
  /**
   * 上一個決策節拍的幾何模式。**只為量測存在**，與 `intent` 同一個理由公開。
   *
   * 【為什麼光看 `intent` 不夠】幾何模式**壓過**意圖（`steerCommand` 的第一
   * 個分支），所以「AI 現在在做什麼」是 `(intent, mode)` 這一對決定的，不是
   * 意圖單獨決定的。診斷「AI 在原地垂直繞圈」時，只有意圖的時間序列看不出
   * 迴路 —— `extend` 與 `speedRecover` 都會壓機頭，而它們一個是意圖、一個
   * 是模式。見 `test/tools/stall-loop.probe.ts`。
   *
   * 沒有目標的那三條早退路徑不更新它（那些路徑根本不算幾何模式）。
   */
  mode: SteerMode = 'normal'
  safetyActive = false
  /**
   * 安全層這一格接管了哪一種：`'none'` / `'ground'`（撞地）/ `'stall'`（失速）。
   *
   * 【為什麼不只留 `safetyActive`】兩個接管的補救方向相反，量「安全層介入率」
   * 時混在一起會量到不相干的東西 —— 見 `SafetyAction` 的註解。`safetyActive`
   * 保留原語意（有沒有介入），需要分辨的護欄讀這一個。
   */
  safetyAction: SafetyAction = 'none'
  /**
   * 上一格的射擊解強度鏡像。**只為量測存在**（spec §7.3 的觀測值：「命令
   * 發出的那一格，受命飛機正握有射擊解」的次數）。
   *
   * 【為什麼不直接公開 `sit`】那會讓外部依賴整個 `Situation` 的形狀，而它是
   * 內部資料結構。鏡像一個純量的相依面積最小。
   *
   * 【為什麼不用 `intent === 'engage'` 當代理】代理量會把「approach 中被
   * 拉走」誤算成無害，而那正是要看的東西。
   */
  shotInstant = 0
  trackingSeconds = 0
  /**
   * 警戒（「有人的預瞄環套在我身上」）已經持續幾秒。
   *
   * 【為什麼與 `trackingSeconds` 分開】後者是在 `sit.threatInstant > 0` 時
   * 累積的，而那個量在 `THREAT_RANGE`（900 m）外恆為 0 —— 共用計時器等於
   * 把警戒也綁回 900 m，而警戒的射程是由武器決定的（約 1064 m）。飽和時間
   * 也刻意不同：警戒 0.5 s、跟蹤 1.0 s。
   */
  alarmSeconds = 0
  /**
   * 累計做過幾次意圖仲裁。
   *
   * 【為什麼公開】相位錯開（M5 spec §6.4）唯一可自動化的觀測量。人工驗收
   * 看的是「幀率沒有週期性頓挫」，那不可能寫成斷言；「40 架的決策沒有擠在
   * 同一步」則可以。
   */
  decisionsMade = 0

  /**
   * 這一格的態勢。**唯讀** —— 只有 `evaluateGeometry` / `evaluateEnergy` /
   * `evaluateThreat` 能寫。
   *
   * 【為什麼公開】與 `rules`、`defend`、`mode` 同一個理由：診斷「AI 為什麼
   * 這樣飛」時，行為是態勢的函數，只看輸出（`intent`、`aimWorld`）永遠只能
   * 猜。`test/tools/stall-loop.probe.ts` 讀 `cornerRatio` 與 `pullCeiling`
   * 去分辨「速度不足」與「拉桿被紀律夾住」——兩者的症狀一樣、修法相反。
   */
  readonly sit = createSituation()
  private readonly targetState = createTargetState()
  private readonly basis = createEngageBasis()
  /**
   * 規則層的閂鎖狀態。**唯讀** —— 只有 `stepRules` 能寫。
   *
   * 【為什麼公開】與 `intent`、`safetyActive` 同一個理由：測試要分辨
   * `extend` 是**哪一個理由**觸發的。三個理由裡兩個是「跟他比」、一個是
   * 「我自己飛不動了」，只看 `intent` 分不出來 —— 而「劣勢方應該更常脫離」
   * 這個主張只對前兩個成立（M11 spec §4.1）。
   */
  readonly rules = createRuleState()
  /**
   * 意圖仲裁的設定。**掃描與消融換這個欄位，不要改 `DEFAULT_RULES`** ——
   * 那是模組層級的共用物件，改它會讓同一支測試裡的兩檔互相污染，而且逼
   * 所有用到它的測試必須串行。與 `tacticalConfig` 同一個手法。
   */
  rulesConfig: RuleConfig = DEFAULT_RULES
  /**
   * 破防層的跨格狀態（目前只有反轉的倒數）。**唯讀** —— 只有 `stepDefend`
   * 能寫。與 `rules` 同一個理由公開：反轉是一個展開中的動作，有沒有真的
   * 發生過，只看 `intent` 是看不出來的。
   */
  readonly defend = createDefendState()
  /**
   * 「追不上預瞄點」的閂鎖。**唯讀** —— 只有 `stepTrack` 能改。
   * 探針與測試靠它讀閂鎖佔時。
   */
  readonly track = createTrackState()
  /**
   * 空層鎖的跨格狀態。與 `defend`、`track` 同一個位階 —— `steer.ts` 是純函式，
   * 「進入那一刻的高度」必須由持有狀態的這一層記。
   */
  readonly band = createBandState()
  private readonly knobs: Knobs = { leadLag: 1, vertical: 0 }
  private readonly wingmanState = createWingmanState()
  private readonly station = new Vector3()
  /**
   * 延遲之前的指令。`update` 的三條輸出路徑全部寫進這裡，再由 `emit` 經過
   * 反應延遲流進呼叫端的 `out`。
   */
  private readonly raw = createCommand()
  private readonly delay = new CommandDelay()
  /** 距離下一次意圖仲裁還有多久，s */
  private decisionTimer = 0

  /**
   * 扳機的點放狀態，滿足 `weapons/burst.ts` 的 `BurstCycle`。**唯讀** ——
   * 只有 `stepBurst` / `resetBurst` 能寫。
   *
   * 【為什麼是三個公開欄位而不是一個私有物件】結構型相容要求欄位名逐字
   * 相同（`TurretState` 那一側先有這三個名字，而它被兩支快照測試釘住）。
   * 公開的另一個好處與 `rules`、`defend` 相同：測試分得出「沒開火」是
   * 幾何不成立還是正好在停火段。
   */
  burstFiring = true
  burstTimer = DEFAULT_AI_BURST.on
  burstScale = 1
  /**
   * 點放的節奏。**與 `targetConfig`、`wingmanConfig` 同一類：可注入。**
   * `{ on: 任意, off: 0 }` 等於關掉這一層 —— 消融用。
   */
  burstConfig: BurstConfig = DEFAULT_AI_BURST
  /**
   * 上一次拿來錯開點放的座位索引。**−2 是哨兵** —— `selfIndex` 的初值是
   * −1，兩者不同才保證第一次 `update` 一定會攤一次。
   *
   * 【為什麼是 lazy 而不是由 `setup.ts` 呼叫】`selfIndex` 在建構之後才寫入
   * （`setup.ts` 兩處、`main.ts` 兩處），要求四個呼叫端都記得再呼叫一次
   * 「攤點放」是一條遲早會漏掉的規矩，而漏掉的症狀是**整隊同一根扳機**
   * ——那正是這一層要避免的東西。索引換人（代飛）時也會自動重攤。
   */
  private burstSeed = -2

  /**
   * 當前目標在指派板上的索引。−1 = 沒有目標。
   *
   * 【為什麼不用 `board.assignments[selfIndex]`】集火時 `this.target` 被
   * `focusTarget` 覆寫，而 `assignments` 沒有跟著更新（焦點索引是 `battle`
   * 層另外解析的）。戰術層用它判斷「換目標了沒有」，錯的識別會讓計量的重置
   * 每一拍都誤觸發。
   */
  targetIndex = -1
  /**
   * 戰術相位。**公開是為了量測** —— 與 `intent`、`mode` 同一個理由：
   * 「AI 現在在做什麼」是 `(intent, mode, phase)` 這一組決定的。
   */
  readonly tactics = createTacticalState()
  /**
   * 可注入的戰術設定。`quota: 0` = 完全關掉這一層。
   *
   * 【為什麼可注入】掃描與消融要能在不改預設值的情況下換一組數字跑，與
   * `burstConfig`、`targetConfig`、`wingmanConfig` 同一類。
   */
  tacticalConfig: TacticalConfig = DEFAULT_TACTICS
  /** `stepTactics` 的輸入。每步就地重填 —— 熱路徑不配置 */
  private readonly tacticalInput: TacticalInput = {
    slot: false, suspended: false, targetIndex: -1, range: 0,
    energyRatio: 0, psTarget: 0, closureRate: 0, shotInstant: 0, pressure: false,
  }
  /**
   * 名額的快取。`slotSeed = −2` = 還沒算。
   *
   * 【為什麼是 lazy】`selfIndex` 與 `board` 在建構之後才寫入。要求每個呼叫端
   * 都記得再呼叫一次「算隊內序號」是一條遲早會漏掉的規矩，而漏掉的症狀是
   * 名額分配靜靜地變成全域索引 —— 也就是這一層存在的理由被抵消掉。
   *
   * 【失效條件含 `quota`】掃描與消融會在控制器跑過之後換 `tacticalConfig`，
   * 只以 `selfIndex` 失效的話名額不會重算，整張消融表會是錯的。
   */
  private slotSeed = -2
  private slotQuota = Number.NaN
  private slotHas = false

  /** 重置戰術狀態。`resetBattle` 每一顆呼叫一次 */
  resetTactics(): void {
    resetTacticalState(this.tactics)
    this.slotSeed = -2
    this.slotQuota = Number.NaN
    this.slotHas = false
  }

  update(self: Aircraft, dt: number, out: Command): void {
    const period = 1 / AI_DECISION_HZ
    const reference = this.stationReference
    const raw = this.raw

    // 【點放每步恰好推進一次，而且要在早退路徑之前】下面有三條 `return`
    // （飛站位、飛集合點、平飛）。只在交戰那條路徑推進的話，扳機的時鐘會
    // 在沒有目標的那幾秒**停住** —— 於是每一架一咬上目標都是從各自停下來
    // 的地方繼續，錯開的相位一場打下來就糊掉了。
    const burst = this.burstConfig
    if (this.burstSeed !== this.selfIndex) {
      this.burstSeed = this.selfIndex
      // `selfIndex` 為 −1（沒接指派板）時全部落在 k = 0，那本來就是
      // 「單機測試」的場景，沒有要錯開的對象
      resetBurst(this, Math.max(this.selfIndex, 0), burst.on, burst.off)
    }
    // 【`off === 0` 就是沒有這一層】`stepBurst` 在停火段的長度為 0 時會在
    // 同一步立刻翻回開火段（while 迴圈），所以恆為 true —— 消融不必另開分支
    const burstOpen = stepBurst(this, dt, burst.on, burst.off)

    // 【節拍先算，分支後用】決策這一步要不要跑，必須在「有沒有目標」之前
    // 決定 —— 否則沒有目標時計時器不會前進，board 一設上去就會變成每個
    // 物理步都在選目標。
    this.decisionTimer -= dt
    const decide = this.decisionTimer <= 0
    if (decide) {
      this.decisionTimer += period
      this.decisionsMade++
      if (reference) {
        stationPoint(reference, this.stationOffset, this.seaHeight, this.station)
        this.stationError = this.station.distanceTo(self.state.position)
      } else {
        this.stationError = 0
      }
      this.threatSource = this.scanThreat(self)
      if (this.transit) {
        // 【被護送的不挑目標，而且要把槽位還回去】`assignments` 是全場共用
        // 的一份，`countLocks` 靠它算分攤折扣。一架永遠不會開火的轟炸機
        // 若「鎖著」某個敵人，真正在打的護航機就會以為那一架已經有人顧了
        // ——一個看不出來的、只表現成「火力莫名其妙變弱」的損失。
        this.target = null
        this.targetIndex = -1
        const b = this.board
        if (b && this.selfIndex >= 0 && this.selfIndex < b.assignments.length) {
          b.assignments[this.selfIndex] = -1
        }
      } else if (this.board) {
        // 【角色分派】有站位參考機 = 僚機，走四級準則；否則是自由獵手
        this.target = reference
          ? selectWingmanTarget(
            this.wingmanState, this.board, this.selfIndex,
            this.stationReferenceIndex, this.stationError, period, this.wingmanConfig,
          )
          : selectTarget(
            this.targetState, this.board, this.selfIndex, period, this.targetConfig,
          )
        // 【這裡讀 `assignments` 是對的】上面那兩支函數就是它的作者
        this.targetIndex = this.selfIndex >= 0
          && this.selfIndex < this.board.assignments.length
          ? this.board.assignments[this.selfIndex]! : -1
      }
      // 【命令對僚機的意思】不是「你也飛去集合點」—— 那會讓編隊在路上散成
      // 一排。是「停止出擊」，於是它掉進下面「沒有目標 → 飛站位」那一格，
      // 自動貼著長機一起走。不需要任何新的協調機制（spec §5.3、§5.4）。
      //
      // 【LEVEL_SELF_DEFENCE 照樣插隊】「有人正在打我」不能被命令擋住，
      // 那與 rules.ts 讓 defend 豁免 minDwell、wingman.ts 讓跨級插隊豁免
      // switchMargin 是同一條原則。
      // 【集火時僚機不能被清掉目標】它要靠既有的 LEVEL_FOCUS（「打參考機
      // 正在打的那一架」）跟上長機。清掉會讓它掉進「沒有目標 → 飛站位」，
      // 集火就只剩長機一架在打 —— 那個戰術的整個意義就沒了
      if (this.order !== null && this.order.kind !== 'focus'
        && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE) {
        this.target = null
        this.targetIndex = -1
      }
      // 【只覆寫長機】僚機走 LEVEL_FOCUS，那一級本來就有自衛與掩護插隊，
      // 「有人正在打我」不會被集火命令擋住。與集合點同一個手法：只操縱
      // 長機，編隊靠既有機制跟上，wingman.ts 一個字不動
      if (this.focusTarget !== null && !reference) {
        this.target = this.focusTarget
        // 【集火的權威索引在命令上】`assignments` 那一格是它自由選的那一架
        this.targetIndex = this.order !== null ? this.order.focusIndex : -1
      }
    }

    const target = this.target
    if (!target) {
      // 【目標消失就放掉】那條路徑下面有三個 `return`（飛站位、飛集合點、
      // 平飛），走不到下面的 `stepTrack`。少了這一行，閂鎖會帶著上一個目標
      // 的狀態一路殘留到下一次接敵。與同一個分支裡「戰術層在這裡歸零」
      // 同一個理由。
      stepTrack(this.track, 0, 0, false, dt)
      // 【目標消失就放掉】與上一行同一個理由：下面三條 `return` 走不到維護點，
      // 鎖會帶著上一個目標的高度一路殘留到下一次接敵。
      this.band.kind = 'off'
      this.band.hold = 0

      // 【戰術層在這裡歸零】下面有三條 `return`（飛站位、飛集合點、平飛）。
      // 少了這一格，「目標消失 → off」永遠不會執行，下一個目標會繼承上一個
      // 目標留下的相位與計時。
      //
      // 【只在決策拍呼叫】相位是 10 Hz 的決定。每個物理步呼叫一次等於讓
      // FSM 以 240 Hz 仲裁，而所有期限都是秒級的。
      if (decide) {
        const ti = this.tacticalInput
        ti.slot = false
        ti.suspended = true
        ti.targetIndex = -1
        ti.range = 0
        ti.energyRatio = 0
        ti.psTarget = 0
        ti.closureRate = 0
        ti.shotInstant = 0
        ti.pressure = false
        stepTactics(this.tactics, ti, period, this.tacticalConfig)
      }
      if (reference) {
        // 【隊形保持就在這一格】沒有值得打的敵人時飛回站位。
        //
        // 它**不進** `arbitrate` 的優先序：engage / merge / approach 全都
        // 要求有目標，所以「沒有目標」這一格本來就是它的位置。代價是這條
        // 分支跳過整條態勢評估，`defend` 因此結構上不可能觸發 —— 補法是
        // 僚機目標優先序最上面的那一級「自衛」，而不是在 rules.ts 開特例
        // （M6 spec §3.2）。
        stationCommand(
          self, reference, this.stationOffset, this.seaHeight, raw, this.stationConfig,
        )
      } else if (this.attackShip(self, decide, raw)) {
        // 【對艦掃射排在站位之後、集合點之前】
        //
        // 站位在前：僚機沒有空中目標時該回編隊，不是各自跑去打船 ——
        // 那會讓整隊在艦隊上空散開。
        //
        // 集合點在後：指揮官叫你去某個點時，那是命令；自己找船打是
        // 「沒有更好的事做」。命令的位階比較高。
        //
        // 這一格什麼都不必做，`attackShip` 已經寫滿 `raw` 了。
      } else if (this.order !== null && this.order.kind !== 'focus') {
        // 【長機收到命令且場上沒有值得打的敵人】飛集合點。這一格與下面的
        // 平飛是同一個位置的兩種答案 —— 有命令就有地方去。
        //
        // 【集火要排除】它的 `point` 是零向量。這一格不看意圖，所以少了
        // 這個條件，「集火令的長機在目標剛陣亡的那一瞬沒有目標」就會變成
        // 「往世界原點的海平面俯衝」
        rallyCommand(self, this.order.point, raw)
      } else {
        // 沒有目標也沒有站位時維持機首方向平飛。這比「保持上一格的指令」
        // 安全——上一格可能是一個俯衝中的脫離向量。
        raw.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        raw.throttle = 0.7
        raw.brake = 0
        raw.firing = false
      }
      // 【拉桿紀律連早退路徑也涵蓋，甜蜜區不涵蓋】兩者的位階不同：甜蜜區
      // 是戰術偏好，指揮官比它高，執行命令時讓位；拉桿紀律是「不要弄壞
      // 自己」—— **沒有任何命令的內容是「把自己拉爆」**，所以它在任何時候
      // 都生效，包括飛去集合點與飛回站位的途中。見 spec §4.4。
      //
      // 【為什麼不能靠 steerCommand】上面三個分支直接寫 `aimWorld` 然後
      // return，根本不經過 `steerCommand`，那一層的紀律對它們無效。
      //
      // 【為什麼直接算而不是讀 sit.cornerRatio】這條路徑沒有目標，
      // `evaluateEnergy` 因此沒有跑過，`this.sit` 是上一次有目標時的舊值。
      // 直接算 —— 這個量本來就只與自己有關。
      //
      // 【分母必須與 `assess.ts` 是同一個】兩邊都用 `manoeuvreSpeed`，否則
      // 「有目標」與「沒目標」兩條路徑會用不同的尺標量同一件事。
      //
      // 【安全層仍然有最後決定權】`emit` 裡的 `applySafety` 排在這之後，
      // 撞地與失速的硬接管會整個換掉 `aimWorld`。順序是對的。
      const ceiling = energyPull(
        self.diag.aero.tas / manoeuvreSpeed(self.spec, self.state.position.y),
        DEFAULT_DOCTRINE,
      )
      shrinkTowardNose(self, ceiling, raw.aimWorld)
      this.emit(self, dt, out)
      return
    }

    // ── 240 Hz：便宜的運動學 ──────────────────────────────
    // 【意圖是 10 Hz，但它引用的幾何不能是 10 Hz 的舊值】高速近距離時
    // 100 ms 足以讓「超前」的態勢完全改變。
    evaluateGeometry(self, target, this.sit)
    evaluateThreat(self, target, this.sit)
    // 只為量測存在，見欄位註解
    this.shotInstant = this.sit.shotInstant
    // 【威脅來源每步重算，但「是誰」只在決策節拍找】掃全場要對每架敵機解
    // 預瞄，240 Hz 跑不起；而「誰在打我」是慢變量，10 Hz 找一次夠了。找到
    // 之後那一架的威脅值仍然每步更新 —— 與幾何 240 Hz、能量 10 Hz 同一個
    // 分頻原則（spec §4.2）。
    const src = this.threatSource
    if (src !== null && src !== target) considerThreatFrom(self, src, this.sit)
    // 【誰在打我】`scanThreat` 已經用 `alarmFactor` 掃過全場（含當前目標），
    // 所以它挑出來的那一架就是警戒值最大的。`board` 為 null 時退回目標。
    const attacker = src ?? target
    buildEngageBasis(self, target, this.basis)

    // 跟蹤計時器：在他的射擊錐內才累積，離開立刻歸零
    this.trackingSeconds = this.sit.threatInstant > 0 ? this.trackingSeconds + dt : 0
    const threat = this.sit.threatInstant * trackingFactor(this.trackingSeconds)

    // 警戒：「他的預瞄環套在我身上嗎」。這是**閃躲的觸發判準**，與上面那個
    // 「他打得中我的機率」分開 —— 後者的距離因子讓閃躲門檻在幾何上等價於
    // 「他必須進到 585 m 以內」，實測 700/900 m 被連續射擊 180 秒，`defend`
    // 進入率 0.0%。完整推導見 `assess.ts` 的 `alarmFactor`。
    const alarmInstant = alarmFactor(attacker, self)
    // 【自己的計時器】`trackingSeconds` 是在 `threatInstant > 0` 時累積的，
    // 而那個量在 900 m 外恆為 0 —— 共用等於把警戒也綁回 900 m。
    this.alarmSeconds = alarmInstant > 0 ? this.alarmSeconds + dt : 0
    const alarm = alarmInstant * alarmRamp(this.alarmSeconds)
    // 【為什麼是 max】`alarm ≥ threat` 在幾何上恆成立（同樣的錐、同樣的預瞄
    // 解，只是少乘一個 ≤1 的距離因子，有單元測試釘住）。所以 `max` 等於
    // 「以警戒為準，但保證絕不比原本遲鈍」—— 新機制只能讓閃躲**更早**觸發，
    // 不可能讓任何既有的觸發消失。
    //
    // ── 地形遮蔽 ──────────────────────────────────────────
    //
    // 【為什麼 mask 套在這裡，不是套進 assess.ts】`threatFactor` 與
    // `alarmFactor` 的呼叫端有四處（`evaluateThreat` 兩次、
    // `considerThreatFrom`、`targetScore` 兩次）。把地形做成可選參數穿過去，
    // 漏接哪一條都**不會有型別錯誤** —— 而症狀是「測試全綠但飛機照樣閃山
    // 後面的瞄準」。這裡是一個地方、一條路。
    //
    // 【threat 與 alarm 一定要一起歸零】上面那個不變量是 `max` 的前提。
    // 只擋一邊等於沒擋。
    const land = this.terrain?.land
    let danger = threat > alarm ? threat : alarm
    if (danger > 0 && land !== undefined && land !== null) {
      const p = self.state.position
      const q = attacker.state.position
      if (losBlocked(p.x, p.y, p.z, q.x, q.y, q.z, land)) danger = 0
    }

    // ── 10 Hz：昂貴的包絡查詢與意圖仲裁 ────────────────────
    if (decide) {
      evaluateEnergy(self, target, this.sit)
      // ── 高度鎖（10 Hz 重算）───────────────────────────
      //
      // 【地板是什麼】護送 = 存活被護送單位的最低高度 − 100；一般追擊 =
      // 目標高度 − 100；兩者都有取較高者。俯衝攻擊可以壓到目標的高度，
      // 但不准鑽到他（或轟炸機編隊）下面 —— 專案負責人 2026-08-24 的設計。
      //
      // 【為什麼在這裡算而不是 assess.ts】被護送單位要掃 `board` 的
      // `protectedMask`，態勢層看不到指派板 —— 與 rallyPoint 走參數是
      // 同一個分界。掃一圈 40 格、10 Hz，成本可忽略。
      const targetAlt = target.state.position.y
      let floorAlt = targetAlt - CHASE_FLOOR_BUFFER
      // 追擊空層（band 基準）：敵人那層，護送中不低於最低的被護送者。
      // 【與 floorAlt 各算各的】兩條地板線分家之後（敵人 −300、轟炸機
      // −100），「floorAlt + 緩衝」不再等於這個量 —— 空層要貼的是敵人
      // **本人**的高度，不是地板線。
      let chase = targetAlt
      if (this.board !== null && this.selfIndex >= 0) {
        const myTeam = this.board.candidates[this.selfIndex]?.team
        let low = Infinity
        for (const c of this.board.candidates) {
          if (!c.alive || c.team !== myTeam) continue
          if (this.board.protectedMask[c.index] === 0) continue
          const y = c.aircraft.state.position.y
          if (y < low) low = y
        }
        if (low !== Infinity) {
          if (low - FLOOR_BUFFER > floorAlt) floorAlt = low - FLOOR_BUFFER
          if (low > chase) chase = low
        }
      }
      this.sit.floorGap = self.state.position.y - floorAlt
      this.sit.chaseAlt = chase
      // 【extend 的爬升參考也認地板】跌破時爬的對象是「地板上方兩個出場
      // 遲滯」——正好穿過閂鎖的出場線（+150）而不是漸近地貼著它。追高處
      // 的敵人時 min() 不起作用，行為一個字不變。
      this.sit.altitudeAdvantage = Math.min(
        this.sit.altitudeAdvantage,
        this.sit.floorGap - 2 * this.rulesConfig.floorAltExit,
      )
      this.intent = stepRules(this.rules, this.sit, danger, period, this.rulesConfig)
      // 【命令是外部覆寫，不是 arbitrate 的一列】那個函式的優先序關係是
      // 實測逐條談定的（相對理由 vs 絕對理由、defend 的絕對優先權，見
      // rules.ts 的長註解與 2026-08-07 的 #136）。把命令插進去會動到那
      // 整組關係；覆寫在外面則一條都不受影響。
      //
      // 【stepRules 照常呼叫】閂鎖要繼續維護，否則命令解除的那一格會拿到
      // 一組停在幾秒前的閂鎖。
      //
      // 【閃躲永遠優先】專案負責人 2026-08-07 裁定，撤退也一樣。「強制
      // 脫離」的意思是「不抵抗、不回頭打」，不是「不閃彈」。
      //
      // 【集火不碰意圖】它是三種命令裡唯一「要交戰」的一種（spec §5.4）。
      // rally 與 flank 是「不要打，去那裡」，focus 是「打那一架」——
      // 壓成 rally 會讓集火命令反而停止交戰，那是完全相反的效果
      //
      // 【transit 連閃躲都不讓位】那是「無條件飛完航程」的**全部意思**，
      // 見 `transit` 的註解。寫在這一行而不是另開一個 `Intent` 值：轉向的
      // 行為與 rally **逐字相同**（純追擊一個固定點、不開火），差別只在
      // 「有沒有東西搶得走它」—— 那是一個條件，不是一種飛法。
      if (this.order !== null && this.order.kind !== 'focus') {
        this.intent = !this.transit && this.rules.defendLatch ? 'defend' : 'rally'
      }

      // ── 戰術相位 ────────────────────────────────────────
      //
      // 【讀的是當步的態勢】`evaluateGeometry` 每個物理步跑、`evaluateEnergy`
      // 每個決策拍跑，兩者都排在這一行之前。放在 `update` 最前面的話
      // `energyRatio` 會是上一拍（最多 100 ms 前）的值。
      const tcfg = this.tacticalConfig
      if (this.slotSeed !== this.selfIndex || this.slotQuota !== tcfg.quota) {
        this.slotSeed = this.selfIndex
        this.slotQuota = tcfg.quota
        this.slotHas = this.board !== null
          && hasSlot(teamIndexOf(this.board, this.selfIndex), tcfg.quota)
      }
      const ti = this.tacticalInput
      ti.slot = this.slotHas
      ti.suspended = this.transit || this.order !== null
      ti.targetIndex = this.targetIndex
      ti.range = this.sit.range
      ti.energyRatio = this.sit.energyRatio
      ti.psTarget = this.sit.psTarget
      ti.closureRate = this.sit.closureRate
      ti.shotInstant = this.sit.shotInstant
      // 【O(1)，沒有掃描】那一格由 `battle` 層每 10 Hz 算一次，全隊共用
      ti.pressure = this.board !== null && this.selfIndex >= 0
        && this.selfIndex < this.board.candidates.length
        && this.board.pressure[teamSlot(this.board.candidates[this.selfIndex]!.team)] !== 0
      stepTactics(this.tactics, ti, period, tcfg)

      // 【戰術層排在命令與破防之後】完整的優先序見 spec §6.1。它讓位給：
      // transit、命令、集火、defend，以及**絕對能量見底**（`extendFloorLatch`）
      // —— 最後那一條是安全問題：`build` 要求正航跡角，一架低於角落速度的
      // 飛機會繼續爬到失速。`extendEnergyLatch` 與 `extendTurnLatch` 是**相對**
      // 理由，戰術層不必讓位給它們。
      //
      // 【`stepRules` 照常呼叫】閂鎖要繼續維護，否則戰術層解除的那一格會拿到
      // 一組停在幾秒前的閂鎖。與命令層同一個手法。
      const ph = this.tactics.phase
      if (ph !== 'off' && this.order === null
        && !this.rules.defendLatch && !this.rules.extendFloorLatch) {
        if (ph === 'dive') this.intent = 'engage'
        else if (ph === 'cooldown') this.intent = 'extend'
      }
    }

    // ── 240 Hz：轉向、開火 ────────────────────────────────
    engageKnobs(this.sit, this.knobs)
    const mode = geometryGate(this.sit, this.basis)
    this.mode = mode
    // 【意圖是上一個決策節拍的值】反轉的觸發只在進入的那一格用得上，晚一個
    // 物理步（4 ms）不影響；重要的是這裡讀到的意圖與下面 `steerCommand`
    // 讀到的是**同一個**，不能半新半舊。
    stepDefend(this.defend, self, attacker, this.intent === 'defend', dt)
    // 【與 stepDefend 同一個位階】`extend` 的轉向側也是跨格記憶，必須由持有
    // 狀態的這一層決定 —— `steerCommand` 是純函數，它沒有「這是不是第一格」
    // 的資訊。錨點是攻擊目標，與 `basis` 一致（見 steerCommand 的 extend 分支）。
    stepExtendSide(this.defend, self, target, this.intent === 'extend')
    // 【與 stepDefend 同一個位階】追不追得上是跨格的閂鎖，必須由持有者每步
    // 維護。訊號本身只有 1.7 秒，讀瞬時值會讓機首每兩秒抖一次。
    stepTrack(this.track, this.sit.trackRatio, this.sit.losRate, true, dt)
    // 【與 stepDefend 同一個位階】鎖住的高度是跨格記憶。`active` 只在攻擊意圖下
    // 成立 —— 見 `stepBand` 的 `@param active`。
    stepBand(
      this.band,
      this.intent === 'engage' || this.intent === 'approach' || this.intent === 'merge',
      this.sit, this.basis, self,
    )
    // 【三個相位是主要的瞄準解，不是 `steerCommand` 尾端的偏置】那個位階已經
    // 有一個 `sweetPitch`，它會繞過 `pullCeiling`、抵消 `speedRecover`、疊在
    // 破防軸上。再加一個同位階的後處理器會讓那個問題更嚴重。
    //
    // 【`dive` 與 `cooldown` 不在這裡】它們覆寫的是**意圖**（engage 與
    // extend），走的仍然是 `steerCommand`。
    const phase = this.tactics.phase
    const tactical = (phase === 'build' || phase === 'perch' || phase === 'zoom')
      && this.order === null
      && !this.rules.defendLatch && !this.rules.extendFloorLatch
    if (tactical) {
      tacticalCommand(
        this.tactics, this.sit, this.basis, self, this.seaHeight,
        this.tacticalConfig, raw,
      )
    } else {
      steerCommand(
        this.intent, mode, this.sit, this.basis, self, this.seaHeight,
        this.knobs, this.defend,
        // 【集火沒有點】它的 `point` 是一個沒有意義的零向量。意圖不會是
        // 'rally' 所以那個分支不會跑，但傳一個假的點進去是在賭別人不會改
        // 那個分支
        this.order === null || this.order.kind === 'focus' ? null : this.order.point,
        raw, DEFAULT_STEER, this.track.latched, this.band,
      )
    }
    // 【rally 與 flank 途中不交戰】兩份 spec 都這樣寫（第一份 §4.4、第二份
    // §4.4），而 `rallyCommand` 也確實把 `firing` 設成 false —— 但它只在
    // 「沒有目標」那條分支跑。**有目標的長機走的是這一行**，於是命令期間
    // 照樣扣扳機：強制注入側翼實測 11814/115200 個取樣在開火。
    //
    // 意圖是唯一該讀的判準：`focus` 的意圖不會是 rally（它要交戰），
    // 而破防閂上時意圖是 defend —— 「不回頭打」不包含「不閃彈」，也不
    // 包含閃躲過程中打到的那一槍。
    //
    // 【點放是最後一道閘】它與四條幾何條件是 AND，位置刻意放在最外層：
    // `shouldFire` 是純函數而且被一整支單元測試逐條釘住，把跨格狀態塞進去
    // 會讓「幾何上打不打得到」與「現在該不該扣」混成一件事。見 `AI_BURST_ON`。
    //
    // 【戰術層的三個相位不開火】它們都在遠距離經營能量，扣扳機只會把彈藥丟在
    // 一個打不到的方向上。`tacticalCommand` 自己也寫了 `firing = false`，這裡
    // 再擋一次是因為這一行在它之後。
    raw.firing = !tactical && burstOpen
      && (this.intent === 'rally'
        ? false
        : shouldFire(this.sit, this.basis, self, undefined, this.terrain?.land ?? null))

    this.emit(self, dt, out)
  }

  /**
   * 把 `raw` 送出去：先過反應延遲，再過安全層。
   *
   * 【安全層為什麼排在延遲之後】延遲模擬的是**判讀與決策**的耗時；「快撞地
   * 了」是反射，不是判讀。把安全層一起延遲會讓 AI 撞地率上升，而那是一個
   * 與難度無關的退步 —— 玩家不會覺得「敵人比較弱」，只會覺得「敵人會自殺」。
   * 安全層讀的是飛機**當下**的狀態，所以它必須拿當下的狀態算（spec §4.2）。
   *
   * 【為什麼只有一個呼叫點】`update` 有三條輸出路徑（站位、平飛、交戰），
   * 以前各自呼叫 `applySafety`。收斂成一個之後，「延遲在安全層之前」這件事
   * 不可能被新增的分支繞過。
   *
   * `profile.reactionDelay = 0`（`ACE`）時 `CommandDelay` 走位元等價的捷徑，
   * 所以這一層對既有的全部測試是無作用的。
   *
   * 【延遲會讓 AI 飛得更低，但那不是這個順序的錯】五個低空受控場景、120 秒、
   * 取全場最低高度：
   *
   * ```
   * 延遲     對頭@600  對頭@400  追擊@500  側舷@700  俯衝@2000   最低  觸海
   * 0.00        387      400      121      115       228      115   無
   * 0.30        600      170      499       63       568       63   無
   * 0.50        386      348      257       −0       547       −0   有
   * 0.80        549      389      488      275       524      275   無
   * ```
   *
   * 0.5 s 那一場的軌跡查到根因，**在 `applySafety` 不在這裡**：它的閉式解
   * 假設俯衝角不再變陡。t=113.0 時高度 367 m、γ=−40°，需要 279 m，通過；
   * 0.75 秒後 γ 已經 −60°，需要 459 m，而高度只剩 292 m —— 需求的成長比
   * 飛機拉得起來的還快。零延遲的同一場也只剩 115 m，是同一個病，延遲只是
   * 讓 AI 更常撞上它。修它要動 `DEFAULT_SAFETY.factor`，那會移動全部既有
   * 基準，另案處理。
   */
  private emit(self: Aircraft, dt: number, out: Command): void {
    this.delay.push(this.raw, this.profile.reactionDelay, dt, out,
      this.profile.trimTau ?? 0, this.profile.fireDelay ?? this.profile.reactionDelay)
    // 【地板是局部值，不寫回 this.seaHeight】見那個欄位的說明
    let floor = this.seaHeight
    let sense: TerrainSense | undefined
    if (this.terrain !== null) {
      if ((this.senseTick++ + this.sensePhase) % SENSE_INTERVAL === 0) {
        senseTerrain(self, this.terrain, this.sense)
      }
      if (this.sense.floor > floor) floor = this.sense.floor
      sense = this.sense
    }
    this.safetyAction = applySafety(self, floor, out, undefined, sense)
    this.safetyActive = this.safetyAction !== 'none'
  }

  /**
   * 掃全場找出對我威脅最大的敵機。`board` 為 null 時回 null。
   *
   * 【為什麼是這裡而不是 assess.ts】掃描需要指派板，而板是 AI 層的概念；
   * `assess.ts` 只認兩架飛機（spec §4.3）。
   *
   * 【為什麼不重用僚機的自衛級】那一級的產出是**目標**，這裡要的是**威脅
   * 來源**，兩者刻意分開（見 `threatSource` 的註解）。僚機兩者都要，所以
   * 兩條路徑各自掃一次 —— 都在 10 Hz，成本可以接受。
   *
   * 熱路徑之外（10 Hz），不配置。
   */
  private scanThreat(self: Aircraft): Aircraft | null {
    const board = this.board
    if (board === null) return null
    const me = board.candidates[this.selfIndex]
    if (me === undefined) return null

    let best: Aircraft | null = null
    let bestValue = 0
    const cs = board.candidates
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive || c.team === me.team) continue
      // 【用警戒而不是威脅排序】`threatFactor` 在 900 m 外恆為 0，所以
      // 用它掃描的話，一架咬在我 950 m 正後方的敵機得分與「不存在」相同 ——
      // 選不出來，`defend` 的破防軸也就繞不到他身上。`alarmFactor` 的支撐集
      // **包含** `threatFactor` 的（同樣的錐、同樣的解，只是少乘距離因子），
      // 所以換過來只會多找到人，不會少。
      const t = alarmFactor(c.aircraft, self)
      if (t > bestValue) {
        bestValue = t
        best = c.aircraft
      }
    }
    return best
  }

  /**
   * 錯開決策相位（M5 spec §6.4）。
   *
   * 【為什麼需要】40 架的 `decisionTimer` 都從 0 起算，會在**同一個物理步**
   * 一起做昂貴的包絡查詢，變成每 100 ms 一次的週期性尖峰。
   *
   * 【它不解決分攤的順序相依】那件事無法消除，只能換一種形式 —— 見
   * M5 spec §6.4。這裡要保證的是決定性，不是順序無關。
   *
   * @param fraction 0..1，在一個決策週期裡的位置
   */
  setDecisionPhase(fraction: number): void {
    let f = fraction % 1
    if (f < 0) f += 1
    this.decisionTimer = f * (1 / AI_DECISION_HZ)
  }
}
