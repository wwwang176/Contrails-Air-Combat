import type { Quaternion } from 'three'
import type { World } from '../world/World'
import type { Combatant } from '../world/combatant'
import type { Team } from '../world/team'
import type { TargetBoard } from '../ai/target'
import type { CommandState, CommandUnit, FlightOrder } from '../ai/commandTypes'
import type { Controller } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'
import type { MessageKey } from '../i18n'
import type { BattleConfig } from './battleConfig'
import type { FlightIndex } from './flights'
import type { ConvoyIndex } from './convoy'
import type { BeatState, FlareBeat } from './beats'
import type { MissionRules, MissionState, Outcome } from './mission'
import type { AlertState } from './alert'
import type { Roster } from './pilots'
import type { BattleReport } from './report'

/** `base spec → 套過手感的 spec`，每陣營一張。見 `createBattle` 的 `feeled` */
export type FeelCache = { readonly [T in Team]: Map<AircraftSpec, AircraftSpec> }

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
  /** 距離下次重算任務壓力還有多久，s。見 `stepPressure` */
  pressureTimer: number
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
   * 指揮官**可以下令**的分隊，依隊伍分開。與上面那兩個的差別只有一項：
   * **被護送的那些小隊不在裡面。**
   *
   * 【為什麼要分成兩份而不是直接把 transit 拿掉】上面那兩個同時是對手的
   * `foe` 清單 —— 攔截時藍隊的指揮官必須**看得到**敵方轟炸機小隊才切得到
   * 它們的側翼。拿掉的話那幾架在指揮層眼中不存在，而它們正是這一關的
   * 全部重點。
   *
   * 【為什麼下令端要拿掉】命令有**配額**（`command.ts` 的 `held`）。被護送
   * 的小隊拿著一張永遠不解除的集合令（見 `convoy.orders`），若它們也進了
   * 排名，就會從真正在打的護航機手上分走名額 —— 而那個損失完全看不出來。
   */
  readonly blueOrderFlights: number[]
  readonly redOrderFlights: number[]
  /**
   * 這一場被護送／被攔截的那幾架。**沒有就是 null**（遭遇戰與其餘任務）。
   */
  readonly convoy: ConvoyIndex | null
  /**
   * 已經用掉幾支預留的分隊。`reinforce` 依序填 `cfg.reserve`。
   *
   * 【為什麼是計數而不是「找一支空的」】依序填是決定性的；「找一支空的」
   * 在增援全滅之後會把同一支再填一次。
   */
  reserveUsed: number
  /**
   * 三張建構期的記憶，`reinforce` 要用同一份。
   *
   * 【為什麼一定要同一份】`feeled` 是「base spec → 套過手感的 spec」，而
   * 下游有三個**依物件識別**的快取（`envelope.ts` 的最佳迴轉表、
   * `doctrine.ts` 的持續迴轉率表、這裡的 `ceilings`）。增援若各算一份新的
   * spec 物件，數值完全相同但那三張表會全部落空 —— 症狀是進場那一瞬間的
   * 卡頓，而且沒有任何錯誤。
   */
  readonly feeled: FeelCache
  /** 轟炸機的巡航速度，見 `BOMBER_CRUISE` */
  readonly cruises: Map<AircraftSpec, number>
  /** 逐機種的實用升限，見 `makeCommandUnit` */
  readonly ceilings: Map<AircraftSpec, number>
  /**
   * 這一場**實際**預留的分隊。`cfg.reserve` 或由 `cfg.beats` 推得，
   * 兩者都給時以 `cfg.reserve` 為準。**`reinforce` 讀這一份，不讀 cfg**
   */
  readonly reserve: readonly { readonly team: Team; readonly count: number }[]
  /** 每一個節拍走到哪裡。**執行狀態在這裡，不在 `MissionCard` 上** */
  readonly beatStates: BeatState[]
  /**
   * 照明彈的輪替：`flare` 節拍生效之後，`FLARE_LANES` 個燈位各自一枚，熄了
   * 隔 `FLARE_RELIGHT_DELAY` 秒在清單的下一個位置點新的一枚，一直輪下去。
   * **null = 這一場沒有照明彈**。
   */
  flareRotation: FlareBeat | null
  /** 每一個燈位現在是池裡哪一格。−1 = 空著（熄了、等重點） */
  readonly flareLane: Int32Array
  /** 每一個燈位幾秒重點。−1 = 不在等 */
  readonly flareDue: Float64Array
  /** 清單走到第幾個位置 */
  flareCursor: number
  /**
   * 還有幾個節拍沒走完。
   *
   * 【為什麼不現算】`stepBeats` 每個物理步都跑，而節拍是一場裡的幾個瞬間。
   * 沒有它的話，全部走完之後仍然每步掃一次全場數存活數。
   */
  beatsLeft: number
  /**
   * 畫面中心的訊息的鍵（`src/i18n`）。null = 沒有。
   *
   * 【存鍵不存文字】畫面那一層每幀查表，語言切換時已經在畫面上的訊息跟著換。
   *
   * 【過期由 `stepBeats` 清掉，不由畫面那一層判斷】它吃的是物理時間（與
   * 倒數同一套）。放在畫面那一層的話，暫停時訊息會繼續倒數。
   */
  message: MessageKey | null
  /** 訊息顯示到哪一個世界時間 */
  messageUntil: number
  /**
   * 撤離節拍改寫過的任務目標的鍵。null = 沿用卡片上的。
   *
   * 【為什麼不是讓畫面那一層去推】`mission` 被換成 evacuate 之後，右上角
   * 的計量自動變成距離，而目標文字仍然是卡片上那一句 —— 一句已經不成立的
   * 目標，配著一個指向新終點的距離。
   */
  objectiveKey: MessageKey | null
  /**
   * **這一刻**的任務規則。開場等於 `cfg.rules`，返航節拍會換掉它。
   *
   * 【為什麼不能直接讀 `cfg.rules`】`cfg` 是不可變的設定，而 `stepMission`
   * 是依規則分支的：只換 `mission` 的內容而規則還是 annihilate 的話，倒數
   * 永遠停在原值、計量顯示的是敵機數，飛進撤離圈也不會判勝。
   */
  rules: MissionRules
  /**
   * 藍隊的撤離令：`rules` 是 evacuate 時飛往撤離點，否則 `null`。**跟著
   * `rules` 一起換**（開場、返航節拍、重開一場三處）。
   *
   * 【蓋過指揮官與任務目標】`stepCommandLayer` 把它發給每一支藍隊小隊，AI 於是
   * 放下對地攻擊往撤離點飛；飛進圈的 AI 由 `stepEvacuation` 退場。
   */
  evacOrder: FlightOrder | null
  /**
   * 這一場的結果。
   *
   * 【為什麼取代了自動重置】M5 到 M8 是「一方全滅 → 3 秒 → 回到滿編」。
   * 主選單一進來那條路徑就必須消失，否則玩家永遠回不到結算畫面
   * （M9 spec §8）。
   */
  outcome: Outcome
  /**
   * 這一場的任務狀態。**`mission.outcome` 是權威，`outcome` 是它的複本。**
   *
   * 【為什麼留著 `outcome` 而不是處處改讀 `mission.outcome`】`main.ts`、
   * `ui/scoreboard`、Playwright 判準與既有的五支測試都讀它。全面改讀是一次
   * 擴散到五個檔案的修改，而它換來的只是少一行賦值。
   *
   * 【為什麼是 readonly】`main.ts` 與 HUD 每幀讀 `mission.target`。換掉整個
   * 物件會讓那些參考指向孤兒 —— 與 `Aircraft.reset` 改成就地寫回是同一條
   * 教訓（見下方 `stepCommandLayer` 的註解）。重設走 `resetMissionState`。
   */
  mission: MissionState
  /** 這一場的飛行員名冊，依座位索引 */
  readonly roster: Roster
  /** 名字用的隨機種子。記下來就能重現同一場的名單 */
  seed: number
  /**
   * 依分隊索引：這一支重生的世界時間；−1 = 沒有在等重生。
   *
   * 【依分隊而不是依節拍】兩支小隊可以在同一個 `warnLead` 之內先後被殲滅，
   * 各自要在自己的時刻重生。建構期配好，長度是 `flights.flights.length`。
   */
  readonly reviveAt: Float64Array
  /** 重生節拍已經預警的批數。`batch` 條件讀它 */
  batches: number
  /**
   * `drainKills` 記到哪一個擊墜流水號（`KillEvents.total`）。
   *
   * 【為什麼要游標】呼叫端不排空緩衝時（headless）同一筆事件每步重掃。
   * 復活之前靠 `recordKill` 的「已陣亡就略過」把重掃變成空操作；席位復活
   * 之後那一筆會被當成第二次陣亡 —— 陣亡數與兇手的擊墜各多記一次，而且
   * 復活的人立刻又被標成死亡。流水號不隨排空歸零，所以不會與新的一批錯位。
   */
  killsSeen: number
  /**
   * `drainReports` 記到哪一個地面目標擊毀流水號，理由與 `killsSeen` 逐字
   * 相同。
   *
   * 【為什麼只有這一個游標】船的兩條緩衝由 `drainReports` 獨佔並就地排空，
   * 不會被重掃；地面目標那一條由 `main.ts` 排空（它要在那裡點火），所以
   * 這一層只能靠流水號。
   */
  groundKillsSeen: number
  /**
   * 玩家自己的戰果通報。**只有玩家的**，見 `battle/report.ts`。
   *
   * 【為什麼住在 `Battle` 而不是 `World`】它要分辨「誰是玩家」，而那一層
   * 連隊伍都只知道藍紅（見 `damageEvents` 的說明）。與 `roster` 同一層。
   */
  readonly report: BattleReport
  /**
   * 紅方**累計**被擊落的架數。`hunt` 規則讀它。
   *
   * 【為什麼記在這裡而不是從存活數推】有重生的關「開場架數減存活數」會隨著
   * 重生退回去 —— 打光一整隊再讓它回來，進度就歸零了。而擊落是已經發生的事。
   *
   * 【在 `drainKills` 裡累加】那裡本來就逐筆走擊墜事件，而且有 `killsSeen`
   * 游標擋著重掃。自己另外掃存活數的話，同一件事會有第二個實作。
   */
  redKilled: number
  /** 上面那些裡面機體角色是轟炸機的。`hunt.role` 限定時要分得出來 */
  redKilledBombers: number
  /**
   * 警戒狀態（`battle/alert.ts`）。卡片上沒有 `alert` 的關卡是 null —— 那時沒有巡邏、
   * 不停火，與一開場就警戒相同。
   */
  readonly alert: AlertState | null
}
