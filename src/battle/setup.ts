import { Quaternion, Vector3 } from 'three'
import { World, type Combatant, type Team } from '../world/World'
import { Aircraft } from '../aircraft/Aircraft'
import { AI_DECISION_HZ, AiController } from '../ai/AiController'
import { PRESSURE_RANGE, createTargetBoard, teamSlot, type TargetBoard } from '../ai/target'
import { ACE, type DifficultyProfile } from '../ai/profile'
import { resetBombBay } from '../weapons/bomb'
import {
  STATION_REFERENCE, compactFlights, createFlights, stationReferenceOf,
  type Flight, type FlightIndex,
} from './flights'
import {
  assertOrderOfBattle, lineAbreast, type FlightPlan, type OrderOfBattle,
} from './order'
import { STATION_OFFSETS, stationPoint } from '../ai/station'
import {
  createCommandState, stepCommand,
  type CommandState, type CommandUnit, type FlightOrder,
} from '../ai/command'
import { maxLevelSpeed, serviceCeiling } from '../analysis/envelope'
import { manoeuvreSpeed } from '../ai/doctrine'
import {
  conditionMet, createBeatStates, type Beat, type BeatState,
} from './beats'
import { KILL_STRIDE } from '../world/kills'
import { assistCredits } from '../world/assists'
import { pilotNames } from './names'
import { createRoster, recordKill, swapPilots, type Roster } from './pilots'
import { pickTakeover, TAKEOVER_DELAY } from './takeover'
import { applyFeel, feelFor } from '../specs/feel'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
// 【為什麼再匯出還要 import】`export type { X } from` 不會把 X 帶進本檔的
// 區域範圍，而 `Battle.outcome` 的宣告用得到它。
import { HEAD_ON } from './entry'
import {
  NEUTRAL_TUNING,
  createMissionState, resetMissionState, stepMission,
  type MissionInputs, type MissionRules, type MissionState, type MissionTuning,
  type Outcome,
} from './mission'
import type { Controller } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'
import { SHIP_CLASSES, createShip, resetShip } from '../world/ships'
import { createShipGuns, resetShipGuns } from '../world/shipGuns'
import { clearBursts, clearFlak } from '../world/flak'
import type { MissionFleet } from './missions'
import type { Loadout } from '../weapons/stores'

/**
 * 一場戰鬥的編制與出生幾何。全部由實測定案（M5 spec §14、M6 spec §8）。
 *
 * 【`altitudeSpread` = ±300 m】不能近到看起來要相撞，也不能遠到分隊看不到
 * 彼此。週期 5 的鋸齒讓五個分隊落在五個高度層而不是兩排。
 */
export interface BattleConfig {
  /**
   * 這一場的編制。**外層是小隊、內層是那個小隊的每一架。**
   *
   * 【為什麼取代了 blueSpec / redSpec / blueCount / redCount / entry】專案
   * 負責人 2026-08-21：「設定檔應該是一個陣列決定什麼機種、初始方位、初始
   * 姿態、小隊等等，而不是加開欄位，不然未來越多類型會更新不完。」加第三種
   * 機體時前者只要多一列。見 `battle/order.ts`。
   *
   * 【既有場景怎麼寫】`lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20)` ——
   * 產出的座標與改動前逐位元相同。
   */
  units: OrderOfBattle
  /**
   * 預留給增援的小隊。每一筆是一支**還沒進場**的分隊。
   *
   * 【為什麼要在建構期就宣告】依架數的 typed array 中途重配不安全：
   * `World.killEvents` 會被換成空的、`damageTime` 會被整張抹掉，而
   * `TargetBoard` 的三個陣列一換參考，`readonly` 這道護欄就沒了。波次是
   * 有限的、寫在任務卡上，所以最終架數在這裡就算得出來 —— 一次配到位，
   * 中途加人於是不重配任何東西。
   *
   * 【為什麼帶 team】預留的小隊 roster 指向還不存在的座位，隊伍推不出來
   * （見 `createFlights` 的 `teams`）。
   *
   * **省略（或空陣列）等於「這一場不會再有人加入」**，此時容量與開局架數
   * 相等，整條路逐位元回到改動前。
   */
  readonly reserve?: readonly { readonly team: Team; readonly count: number }[]
  /**
   * 這一關中途會發生的事（見 `beats.ts`）。**省略 = 什麼都不會發生**，
   * 而且 `stepBeats` 只付一次長度檢查就早退。
   *
   * 【容量由它推，不用另外寫】增援節拍自己帶著編組，所以
   * `reserve` 可以從這裡算出來——兩個欄位手動同步是一個不必要的
   * 坑。`reserve` 留給測試當低階的逃生口：兩者都給時以 `reserve` 為準。
   */
  readonly beats?: readonly Beat[]
  /**
   * 這一場的艦隊。**省略 = 一艘船都不產生**，而 `World` 那三段推進都是
   * 零長度早退，所以既有的空戰逐位元不變。
   *
   * 【它從卡片一路流過來】`MissionBattle.fleet` → 這裡 → `createBattle`。
   * `missionConfigFrom` 明列回傳欄位、不透傳未知資料，所以中間少抄一次
   * 就是「型別過了但進戰鬥零艘船」，而且不報錯。
   */
  readonly fleet?: MissionFleet
  /**
   * 複寫玩家的掛載。**省略 = 用機種的預設**（`weapons/stores.ts` 的
   * `loadoutOf`）。
   *
   * 【為什麼是整份而不是 `Partial`】部分複寫要定義「沒填的欄位從哪來」，
   * 而那條規則沒有人會記得；整份替換則是看到什麼就是什麼。
   *
   * 【為什麼在 `BattleConfig` 而不是只留在卡片上】它決定投出去的東西有多痛
   * ——那是模擬的一部分。與 `timeOfDay` 相反：那一個只影響畫面，明文規定
   * 不進這裡（見 `missions.ts` 的說明）。
   */
  readonly blueLoadout?: Loadout
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
  /**
   * 這一場怎麼算贏。
   *
   * 【為什麼遭遇戰也吃這個】遭遇戰就是「一個沒有時限的殲滅任務」。判定
   * 路徑因此**每一場都在走**，不是一條等著被第一次使用的死碼 —— 與地形
   * 「種類沒變也重建」是同一條紀律（M10 spec §5.3）。
   *
   * 反過來說：若任務判定是一條只有任務模式才走的旁路，它會在沒有人注意
   * 的時候腐爛，而症狀要等到玩家點下那張卡才出現。
   */
  rules: MissionRules
  /**
   * 這一關自己的小旋鈕。**遭遇戰與殲滅任務給 `NEUTRAL_TUNING`**，
   * 那一份的每一項都等於「沒有這一關」。見 `mission.ts` 的 `MissionTuning`。
   */
  tuning: MissionTuning
}

export const DEFAULT_BATTLE: BattleConfig = {
  // 【對頭 20v20 是預設】全部既有護欄都建立在它上面
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
  // 【遭遇戰＝沒有時限的殲滅】改動前寫死的那兩行，現在是這一條規則
  rules: { kind: 'annihilate' },
  tuning: NEUTRAL_TUNING,
}

/**
 * 一場戰鬥的結果。**定義搬到 `mission.ts`** —— 它現在是任務判定的產物，
 * 而勝負條件不再只有「誰全滅」。這裡再匯出，既有的 import 站點不用動。
 */
export type { Outcome } from './mission'

/**
 * 這一場「要被護送／要被打掉」的那幾架，以及它們各自要去哪裡。
 * **全部是常數**：開局算一次，之後只讀（重置也不必動）。
 *
 * 【為什麼是索引表而不是每架身上的一個旗標】`Combatant` 由 `World` 定義，
 * 而 `World` 連「隊伍」都只知道 `'blue' | 'red'` —— 它不該知道有「任務」
 * 這回事。與 `roster`（名字）、`flights`（編制）住在 `Battle` 而不是
 * `World` 上是同一條界線。
 */
export interface ConvoyIndex {
  /** `duty === 'transit'` 的座位索引，依 `world.add` 的順序 */
  readonly seats: readonly number[]
  /**
   * 判定用的終點。**畫面上的圓環就是這一個**，整場只有一個圈。
   */
  readonly goal: Vector3
  /**
   * 與 `seats` 對齊：**那一架自己要飛的點**。x 取它的出生 x，所以每一架
   * 飛的是一條**與 Z 軸平行**的直線。
   *
   * 【為什麼不是全部瞄同一個點】專案負責人 2026-08-21：「這些轟炸機都有
   * 各自的前方集合點，這樣既可以排除滾轉，又可以每台轟炸機平行飛。」
   * 共用一個點的話整隊會沿途向內收攏 —— 起始值下只有 1° 的夾角，看起來
   * 差別不大，但那是「慢慢擠成一團」而不是編隊。
   *
   * 【判定仍然只有一個圈】兩者不衝突：整隊的寬度由 `order.ts` 的
   * `CONVOY_LANE` 壓在抵達半徑之內。
   */
  readonly points: readonly Vector3[]
  /**
   * 依**分隊**索引的集合令；不是 transit 的分隊是 `null`。
   *
   * 【為什麼是一張永遠不解除的令】`stepCommand` 的集合令到了就解除，而
   * 這一張的意思是「**永遠**往終點飛」。做法是根本不讓指揮層看到這些
   * 分隊（見 `blueOrderFlights`），改由 `stepCommandLayer` 直接發這一張。
   */
  readonly orders: readonly (FlightOrder | null)[]
}

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
   * 還有幾個節拍沒走完。
   *
   * 【為什麼不現算】`stepBeats` 每個物理步都跑，而節拍是一場裡的幾個瞬間。
   * 沒有它的話，全部走完之後仍然每步掃一次全場數存活數。
   */
  beatsLeft: number
  /**
   * 畫面中心的訊息。空字串 = 沒有。
   *
   * 【過期由 `stepBeats` 清掉，不由畫面那一層判斷】它吃的是物理時間（與
   * 倒數同一套）。放在畫面那一層的話，暫停時訊息會繼續倒數。
   */
  message: string
  /** 訊息顯示到哪一個世界時間 */
  messageUntil: number
  /**
   * 撤離節拍改寫過的任務目標文字。空字串 = 沿用卡片上的。
   *
   * 【為什麼不是讓畫面那一層去推】`mission` 被換成 evacuate 之後，右上角
   * 的計量自動變成距離，而目標文字仍然是卡片上那一句 —— 一句已經不成立的
   * 目標，配著一個指向新終點的距離。
   */
  objectiveText: string
  /**
   * **這一刻**的任務規則。開場等於 `cfg.rules`，返航節拍會換掉它。
   *
   * 【為什麼不能直接讀 `cfg.rules`】`cfg` 是不可變的設定，而 `stepMission`
   * 是依規則分支的：只換 `mission` 的內容而規則還是 annihilate 的話，倒數
   * 永遠停在原值、計量顯示的是敵機數，飛進撤離圈也不會判勝
   * （Codex 審查 2026-09-02 P0）。
   */
  rules: MissionRules
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
   * 與這一輪無關的擴散性修改，而它換來的只是少一行賦值。
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

/**
 * 轟炸機的開局速度取自己最大平飛的這個比例。
 *
 * 【為什麼轟炸機不能用 `BattleConfig.tas`】那是**一個絕對速度套在每一架
 * 上**，而 200 m/s（720 km/h）是照戰鬥機訂的：對三台戰鬥機是它們最大平飛
 * 的 108–122%，也就是「一小筆開局能量存款，開頭三十秒花掉」。同一個絕對值
 * 對轟炸機是 169%（He 111）與 162%（B-17G），而且**超過它們的結構限速**
 * 20% 與 47%。
 *
 * 代價不在極速上，在滾轉：`controlStiffening.aileronK` 讓兩台轟炸機的滾轉率
 * 過了峰值就往下掉（He 111 的峰值在 340 km/h），而 720 遠在下坡側。
 * 四種開局定值下滾 90° 要幾秒，4,000 m：
 *
 * ```
 *                全域 200 m/s   夾 vne   0.80×最大平飛
 *   He 111 H-6      12.0 s       7.5 s       2.2 s
 *   B-17G           37.7 s       8.7 s       3.0 s
 *   三台戰鬥機    0.6–1.7 s     同左        0.7–1.0 s
 * ```
 *
 * 【0.80 的來歷】戰時的巡航速度大致是最大平飛的七到八成，而開局在做的事
 * 就是巡航接敵。它**不是**任何一種「最佳速度」—— 最大平飛的剩餘功率恰好
 * 為零（開局只能減速）、角落速度是已經在纏鬥時的速度、最佳爬升只有
 * 238–246 km/h（等於取消接近段）。0.80 落在 He 111 342 / B-17G 355 km/h。
 *
 * 【為什麼戰鬥機不套這條】套下去是 0.80 × 665 = 532 km/h，開局能量存款就
 * 沒了，而 AI 的能量判準（`steer.ts` 的 `brakeCornerRatio` 那一組）是照
 * 720 km/h 的開局調的。要改那一項得連同那一組門檻一起重掃。
 */
export const BOMBER_CRUISE = 0.80

/**
 * 一架飛機的開局／重生真空速，m/s。
 *
 * 兩條規則，第二條蓋過第一條：
 *
 * 1. **不得超過自己的 `vne`。** 這條套在每一架上，但只咬得到轟炸機 ——
 *    三台戰鬥機的 vne 是 201–225 m/s，都在 `DEFAULT_BATTLE.tas` 的 200 之上。
 * 2. **轟炸機用自己的巡航速度**（見 `BOMBER_CRUISE`），不是那個照戰鬥機
 *    訂的絕對值。
 *
 * @param nominal `cfg.tas × entry.speed` —— 戰鬥機仍然拿這個值
 * @param cruise  轟炸機的巡航速度，由呼叫端查表（`maxLevelSpeed` 是搜尋，
 *                同機種只該算一次）
 */
function openingTas(spec: AircraftSpec, nominal: number, cruise: number): number {
  const want = spec.role === 'bomber' ? cruise : nominal
  return Math.min(want, spec.limits.vne)
}

/**
 * 一個小隊的進場幾何。**逐小隊算一次**，同隊的每一架共用。
 *
 * 【為什麼要抽出來】`createBattle` 與 `reinforce` 都要算它，而它裡面有兩條
 * 浮點順序被 `test/fixtures/spawn-baseline.ts` 釘住的式子。兩份長得很像的
 * 幾何就是只有一份會被修好的那種危險。
 */
interface UnitFrame {
  /** 沿 Z 的出生位置，m */
  readonly z: number
  readonly orientation: Quaternion
  /** 機首方向的單位向量。速率逐架乘 */
  readonly heading: Vector3
  /** `cfg.tas × entry.speed` —— 戰鬥機的開局速度 */
  readonly nominalTas: number
  readonly leadX: number
  readonly leadY: number
}

function unitFrame(cfg: BattleConfig, unit: FlightPlan): UnitFrame {
  const entry = unit.entry
  // 【`along`／`across` 是係數、`gap` 是絕對公尺】理由見 `SideEntry`：
  // 探針靠覆寫 `entryRange`／`lateralOffset` 換場景，寫死絕對座標會讓
  // 那些覆寫靜靜失效
  const z = entry.along * cfg.entryRange + entry.gap
  const orientation = new Quaternion().setFromAxisAngle(UP, entry.heading)
  // 【方向逐小隊，速率逐架】速率由 `openingTas` 逐機種決定，而同一個
  // 分隊可以是混編的
  const heading = FWD.clone().applyQuaternion(orientation)
  // 【乘法的順序要與改動前逐字相同】改動前是
  // `(f − (n−1)/2) × schwarmSpacing + across × lateralOffset`，
  // 而 `lane` 就是那個括號裡的中間值。浮點加法不可交換，順序不能換。
  const leadX = unit.lane * cfg.schwarmSpacing + entry.across * cfg.lateralOffset
  const leadY = cfg.altitude + entry.climb + altitudeOffset(unit.tier, cfg.altitudeSpread)
  return { z, orientation, heading, nominalTas: cfg.tas * entry.speed, leadX, leadY }
}

/** `base spec → 套過手感的 spec`，每陣營一張。見 `createBattle` 的 `feeled` */
type FeelCache = { readonly [T in Team]: Map<AircraftSpec, AircraftSpec> }

/**
 * 造一架、加進世界，回傳它的座位。
 *
 * **`createBattle` 與 `reinforce` 共用的唯一一條生成路徑。** 複製一份的話，
 * 手感、開局速度、站位、朝向這四件事會有兩個實作，而只有一份會被修好。
 *
 * @param made 這個分隊**已經造好**的飛機，供 `stationPoint` 當參考機。
 *   呼叫端每一隊給一個新的陣列，這裡會把新造的那一架推進去。
 */
function spawnMember(
  world: World, cfg: BattleConfig, unit: FlightPlan, frame: UnitFrame, k: number,
  made: Aircraft[], feeled: FeelCache, cruises: Map<AircraftSpec, number>,
  controller: Controller,
): Combatant {
  const base = unit.members[k]!
  // 【手感係數在這裡套，不在 spec 檔裡】史實值必須原封不動，否則
  // `test/performance/historical.test.ts` 的整層斷言就失去意義（見
  // `specs/feel.ts`）。這裡是「史實的飛機」變成「玩起來的飛機」的唯一
  // 入口，而且**雙方一起套** —— 玩家與 AI 飛的是同一台。
  //
  // 【為什麼是 feelFor 而不是 GAME_FEEL】轟炸機另有一組（見
  // `specs/feel.ts` 的 `BOMBER_FEEL`）。寫死 `GAME_FEEL` 會把轟炸機當
  // 戰鬥機放大，爬升率變成史實的三倍。
  //
  // 【查表在內層】混編小隊裡兩種機各查各的
  const cache = feeled[unit.team]
  let spec = cache.get(base)
  if (spec === undefined) {
    spec = applyFeel(base, feelFor(base))
    cache.set(base, spec)
  }

  // 【開局速度逐機種】見 `openingTas`。巡航只有轟炸機用得到，而
  // `maxLevelSpeed` 是一次求根搜尋 —— 戰鬥機不必付這個錢。
  // 它要吃**套過手感的** spec：「玩起來的飛機飛多快」才是它維持得住的
  let cruise = 0
  if (base.role === 'bomber') {
    cruise = cruises.get(base) ?? maxLevelSpeed(spec, cfg.altitude) * BOMBER_CRUISE
    cruises.set(base, cruise)
  }
  const tas = openingTas(base, frame.nominalTas, cruise)

  // 【分隊內部直接由 stationPoint 生成】出生位置就是站位。兩份長得
  // 很像的幾何就是只有一份會被修好的那種危險 —— 與 `resetBattle`
  // 走 `World.respawn` 是同一個理由。
  //
  // 鏡射是自動的：`stationPoint` 由**參考機的速度方向**建座標框，
  // 而紅隊朝 +Z，所以 `across = +200` 在世界座標是 −X。
  const ref = STATION_REFERENCE[k]!
  if (ref < 0) SPAWN.set(frame.leadX, frame.leadY, frame.z)
  else stationPoint(made[ref]!, STATION_OFFSETS[k]!, 0, SPAWN)

  const aircraft = new Aircraft(spec, SPAWN.y, tas)
  aircraft.state.position.copy(SPAWN)
  aircraft.state.orientation.copy(frame.orientation)
  aircraft.state.velocity.copy(frame.heading).multiplyScalar(tas)
  aircraft.prevPosition.copy(aircraft.state.position)
  aircraft.prevOrientation.copy(frame.orientation)
  made.push(aircraft)

  const c = world.add(
    aircraft, controller, unit.team, aircraft.state.position.clone(), SPAWN.y, tas,
  )
  // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
  c.respawnOnDestroy = false
  return c
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
  assertOrderOfBattle(cfg.units)

  const world = new World()
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
  /** 那幾架各自的**分隊**索引。編制依 `cfg.units` 的順序建，所以就是單位序號 */
  const convoyFlights: number[] = []
  /**
   * base spec → 套過手感係數的 spec。**每陣營一張表。**
   *
   * 【為什麼要記憶】改動前 `applyFeel` 一側算一次，所以同一側的 20 架共用
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
   * 每陣營一張則與改動前**完全一致**：同隊同機種共用一份、兩隊各自一份。
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
        // across × lateralOffset` 再算一次，而那條式子的浮點順序是被
        // `test/fixtures/spawn-baseline.ts` 釘住的。抄現成的值不可能算錯
        convoyX.push(c.spawnPosition.x)
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
  // 參數的那一條。整條路逐位元回到改動前。
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
  // 於是把到手的射擊解讓出去。專案負責人 2026-08-10 裁定打開。
  //
  // 【編制刻意排在前面】就是為了讓這裡拿得到 `flightOf` 那一個實體 ——
  // `compactFlights` 每個物理步就地重填它，板子因此永遠讀到當步的編制。
  // 【被護送的那幾架在敵方眼中值幾倍】沒有它的話護航機會把攔截方的目標
  // 全部吸走 —— 實測轟炸機**一發都不會挨到**（`docs/backlog.md` §2.26）。
  // 中性值是 1，所以遭遇戰與殲滅任務這一整條逐字如舊。見 `MissionTuning`
  const priority = new Float64Array(capacity).fill(1)
  const protectedMask = new Uint8Array(capacity)
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
  // ── 被護送的那幾架 ────────────────────────────────────
  //
  // 【兩個方向都要擋】少了任何一邊，症狀都是「這一關永遠打不完」而畫面上
  // 一切正常：沒有 transit 的護送任務，勝利條件從第一幀起就不可能成立；
  // 有 transit 卻不是護送規則的話，那幾架沒有地方可去，會照一般空戰打。
  const convoyOrders: (FlightOrder | null)[] = flights.flights.map(() => null)
  let convoy: ConvoyIndex | null = null
  if (cfg.rules.kind === 'convoy') {
    const rules = cfg.rules
    const points: Vector3[] = []
    let owned = 0
    for (let t = 0; t < convoySeats.length; t++) {
      const seat = convoySeats[t]!
      if (world.combatants[seat]!.team === rules.owner) owned++
      // 【x 是自己的、y 與 z 是共用的】平行直線的定義
      const point = new Vector3(convoyX[t]!, rules.point.y, rules.point.z)
      // 【整隊必須落得進判定圈】每一架飛的是 (自己的 x, 終點的 y, 終點的 z)，
      // 所以它抵達時離圈心恰好是這個橫向偏移。大於半徑的那幾架**永遠判不到**,
      // 而畫面上的症狀是「轟炸機從圈旁邊飛過去，任務永遠不結束」。
      // 2026-08-21 實測踩過一次：圈釘在 x = 0 而整隊偏 −750，最外側 1,050 > 1,000
      const off = Math.abs(point.x - rules.point.x)
      if (!(off < rules.radius)) {
        throw new Error(
          `被護送的第 ${t} 架離判定圈心 ${off.toFixed(0)} m，不小於抵達半徑 ${rules.radius} m`
          + '——它永遠判不到。把編隊收窄（order.ts 的 CONVOY_LANE）或把半徑放大',
        )
      }
      points.push(point)
      convoyOrders[convoyFlights[t]!] = {
        kind: 'rally',
        point,
        radius: rules.radius,
        targetFlight: -1,
        side: 0,
        focusIndex: -1,
      }
    }
    if (owned === 0) {
      throw new Error(`護送／攔截的規則說目標在 ${rules.owner} 隊，但編組表裡那一隊沒有任何 transit`)
    }
    convoy = { seats: convoySeats, goal: rules.point, points, orders: convoyOrders }
  } else if (convoySeats.length > 0) {
    throw new Error('編組表裡有 transit 的小隊，但這一場的規則不是護送／攔截——它們沒有終點可飛')
  }

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
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  // 【名字依陣營而不是隊伍顏色】M10 讓玩家選陣營之後藍隊可能飛 Bf109，
  // 那時德文名要跟著機種走（M9 spec §6.1）。這裡讀每一隊實際的機種。
  const blueNames = pilotNames(seed, blue[0]!.aircraft.spec.faction, blue.length)
  const redNames = pilotNames(seed, red[0]!.aircraft.spec.faction, red.length)
  let bi = 0
  let ri = 0
  const roster = createRoster(
    world.combatants.map((c) => (c.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!)),
    player.index,
  )

  placeFleet(world, cfg.fleet)
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
    message: '',
    messageUntil: 0,
    objectiveText: '',
    rules: cfg.rules,
    spawnOrientations: world.combatants.map((c) => c.aircraft.state.orientation.clone()),
    outcome: 'fighting',
    mission: createMissionState(cfg.rules),
  }
  wireStations(battle)
  return battle
}

/**
 * 依 `cfg.fleet` 把船放進世界。**省略就一艘都不放。**
 *
 * 偏移是艦隊座標，所以先轉艏向再加中心 —— 改艏向時陣型跟著轉，不必重算
 * 每一艘的世界座標。
 */
function placeFleet(world: World, fleet: MissionFleet | undefined): void {
  if (fleet === undefined) return
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fleet.heading)
  const p = new Vector3()
  for (const e of fleet.ships) {
    p.copy(e.offset).applyQuaternion(q).add(fleet.center)
    const cls = SHIP_CLASSES[e.cls]
    const ship = createShip(world.ships.length, cls, e.team, p.x, p.z, fleet.heading, fleet.speed)
    ship.guns = createShipGuns(cls)
    ship.gunCooldowns = new Float32Array(cls.zones.length)
    resetShipGuns(ship)
    world.ships.push(ship)
  }
}

/** 一架的指揮層快照。**`createBattle` 與 `reinforce` 共用** */
function makeCommandUnit(c: Combatant, ceilings: Map<AircraftSpec, number>): CommandUnit {
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
    // 【自己的向量，不是飛機那一份的別名】`stepCommandLayer` 每步 copy 進來。
    // 舊版抓的是別名，倚賴「`state.position` 這個物件永遠是同一個」——
    // 而 `Aircraft.reset` 當時會換掉整個 `state`，於是「再打一場」之後
    // 這 40 個別名全部指向孤兒向量。見 `Aircraft.reset` 的註解。
    position: new Vector3(),
    velocity: new Vector3(),
    cornerRatio: 1,
    hpFraction: 1,
    shotInstant: 0,
    serviceCeiling: ceiling,
    alive: c.alive,
  }
}

/**
 * 推進節拍。**排在 `drainKills` 之後、`compactFlights` 之前**（見呼叫點）。
 *
 * 【先判斷後套效果】所有條件都對**同一份快照**判斷，才開始套效果。否則第一
 * 個增援會改變存活數，讓同一步後面的條件依陣列順序產生隱性耦合 —— 而那種
 * 耦合在測試裡看起來一切正常，直到有人調整了卡片上節拍的順序。
 *
 * 【為什麼用 `world.time` 而不是另開一個 tick 計數】它已經是一個單調的浮點
 * 累加器，而且判定用的東西（助攻窗口、任務時限）本來就掛在它上面。同一組
 * `dt` 序列累加出來的值逐位元相同，重播因此仍然是決定性的。
 *
 * 熱路徑：`beats` 為空時只有一次長度檢查。
 */
function stepBeats(b: Battle): void {
  const beats = b.cfg.beats
  if (beats === undefined || beats.length === 0) return
  const now = b.world.time
  // 【過期的訊息在這裡收掉】`message` 因此恆是「這一刻該顯示的那一則」，
  // 畫面那一層照抄就好，不必自己持有一份計時
  if (b.message !== '' && now >= b.messageUntil) b.message = ''
  // 【走完就不再掃全場】節拍是一場裡的幾個瞬間，而這個函數每個物理步都跑
  if (b.beatsLeft === 0) return

  // 【快照先數】alive 條件全部讀這一份
  aliveCounts.blue = 0
  aliveCounts.red = 0
  aliveCounts.blueFighter = 0
  aliveCounts.redFighter = 0
  aliveCounts.blueBomber = 0
  aliveCounts.redBomber = 0
  // 【六個分支寫死，不組字串當鍵】`${team}Bomber` 每一架都配置一個新字串 ——
  // 20v20、240 Hz 是每秒 9,600 次，而這裡是熱路徑（Codex 審查 2026-09-02）
  for (const c of b.world.combatants) {
    if (!c.alive) continue
    const bomber = c.aircraft.spec.role === 'bomber'
    if (c.team === 'blue') {
      aliveCounts.blue++
      if (bomber) aliveCounts.blueBomber++
      else aliveCounts.blueFighter++
    } else {
      aliveCounts.red++
      if (bomber) aliveCounts.redBomber++
      else aliveCounts.redFighter++
    }
  }

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!
    const st = b.beatStates[i]!
    if (st.phase === 'done') continue
    if (st.phase === 'waiting') {
      if (!conditionMet(beat.when, now, aliveOf)) continue
      st.phase = 'warned'
      st.dueAt = now + (beat.kind === 'reinforce' ? beat.warnLead : 0)
      b.message = beat.kind === 'reinforce' ? beat.warn : beat.message
      b.messageUntil = st.dueAt + MESSAGE_SECONDS
    }
    // 【落下來而不是 continue】`warnLead` 為 0 的節拍，預警與生效是同一刻。
    // 中間硬隔一個物理步的話，那 4 ms 看不出來，卻讓「0 秒預警」這個寫法
    // 多出一條沒有人會預期的語意
    if (now < st.dueAt) continue
    // 【預留是一個佇列】第二個波次的條件先成立時它要等 —— 座位是依序附加到
    // 世界尾端的，而每一支預留的分隊在建構期就綁死了自己的座位與隊伍。硬插
    // 隊的話那幾架會落進前一支預留的分隊，也就是**別隊**裡（見 `BeatState.slot`）
    if (beat.kind === 'reinforce' && st.slot !== b.reserveUsed) continue
    st.phase = 'done'
    b.beatsLeft--
    if (beat.kind === 'reinforce') reinforce(b, beat.flight)
    else {
      // 【規則與狀態兩個都要換】`stepMission` 是依規則分支的：只換狀態的話
      // 倒數永遠停在原值、計量顯示的是敵機數，飛進撤離圈也不會判勝
      //
      // 【就地寫回，不換 `MissionState` 物件】見 `Battle.mission` 的註解
      b.rules = {
        kind: 'evacuate', point: beat.point, radius: beat.radius, seconds: beat.seconds,
      }
      resetMissionState(b.rules, b.mission)
      // 【目標文字也要跟著換】計量已經變成到新終點的距離，文字卻還是卡片上
      // 那一句 —— 兩者搭起來會指向一個不存在的任務
      b.objectiveText = beat.message
    }
  }
}

/** 畫面中心訊息從生效那一刻起再顯示幾秒 */
const MESSAGE_SECONDS = 4

/**
 * `stepBeats` 的當步快照。模組級，不配置。
 *
 * 【六個具名欄位而不是 `Record<string, number>`】組出來的鍵每一次都是一個
 * 新字串，而這裡每個物理步跑一次全場掃描。
 */
const aliveCounts = {
  blue: 0, red: 0, blueFighter: 0, redFighter: 0, blueBomber: 0, redBomber: 0,
}

function aliveOf(team: Team, role?: AircraftSpec['role']): number {
  if (team === 'blue') {
    if (role === undefined) return aliveCounts.blue
    return role === 'bomber' ? aliveCounts.blueBomber : aliveCounts.blueFighter
  }
  if (role === undefined) return aliveCounts.red
  return role === 'bomber' ? aliveCounts.redBomber : aliveCounts.redFighter
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
export function reinforce(b: Battle, plan: FlightPlan): readonly number[] {
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
  for (let k = 0; k < plan.members.length; k++) {
    const c = spawnMember(
      b.world, b.cfg, plan, frame, k, made, b.feeled, b.cruises, new AiController())
    seats.push(c.index)
    ;(plan.team === 'blue' ? b.blue : b.red).push(c)
    b.spawnOrientations.push(c.aircraft.state.orientation.clone())
    b.commandUnits.push(makeCommandUnit(c, b.ceilings))
    b.roster.pilots.push({
      name: names[k]!, kills: 0, deaths: 0, assists: 0, alive: true, isPlayer: false,
    })
    const ai = c.controller as AiController
    ai.board = b.board
    ai.selfIndex = c.index
    ai.profile = b.cfg.aiProfile
    // 【相位照最終容量攤平，不照當下架數】用當下架數的話同一波的值會全部
    // 擠在 1 附近，決策尖峰聚在一起 —— 這個 API 存在的理由就是攤開它們
    ai.setDecisionPhase(c.index / b.board.assignments.length)
  }
  b.reserveUsed++
  return seats
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
 * 重算兩隊的任務壓力，寫進 `board.pressure`。
 *
 * 「這一隊的被保護單位有沒有敵機貼上來」對同隊的每一架**完全相同**，所以
 * 算一次全隊共用（見 `TargetBoard.pressure`）。
 *
 * 【為什麼是 10 Hz 而不是每步】它是一個慢變量，而且是戰術層 10 Hz 決策的
 * 輸入。每步算等於把成本乘 24。
 *
 * 【非護送關卡沒有二次成本】`protectedMask` 全 0 時外層迴圈直接跑完，一次
 * 距離平方都不算 —— O(N²) 那一項是零。**但不是完全免費**：每個物理步仍有
 * 一次減法與分支，每 10 Hz 仍走一趟 O(N) 的遮罩掃描。
 *
 * 熱路徑：不配置。
 */
function stepPressure(b: Battle, dt: number): void {
  b.pressureTimer -= dt
  if (b.pressureTimer > 0) return
  b.pressureTimer += 1 / AI_DECISION_HZ

  const board = b.board
  const cs = board.candidates
  const mask = board.protectedMask
  const out = board.pressure
  out[0] = 0
  out[1] = 0

  const r2 = PRESSURE_RANGE * PRESSURE_RANGE
  for (let i = 0; i < cs.length; i++) {
    if (mask[i] === 0) continue
    const ward = cs[i]!
    if (!ward.alive) continue
    const slot = teamSlot(ward.team)
    // 這一隊已經成立，不必再找
    if (out[slot] !== 0) continue
    const wp = ward.aircraft.state.position
    for (let k = 0; k < cs.length; k++) {
      const foe = cs[k]!
      if (!foe.alive || foe.team === ward.team) continue
      if (foe.aircraft.state.position.distanceToSquared(wp) < r2) {
        out[slot] = 1
        break
      }
    }
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
/**
 * 指揮官要豁免的分隊索引；沒有要豁免的回 −1。
 *
 * 【跳過的是「有人類在操縱的那一支」，不是「玩家的座位」】第一份 spec
 * §2.1 裁定指揮 AI 不對玩家的小隊下令，理由是不跟人類搶操縱 —— 座位上
 * 坐的是 AiController 時（`I` 代飛、上帝視角）那個理由就不成立了。
 *
 * 【為什麼用推導而不是加一個旗標】推導比鏡射安全：鏡射要求每一條會改變
 * 狀態的路徑都記得更新，漏掉任何一條就留下一個永遠不消失的幽靈狀態。
 * 這與 `wireStations` 靠 `instanceof AiController` 自動跟上、編制每步
 * 重算而不是增量維護，是同一條紀律。
 *
 * 【`pinned < 0` 時】`combatants[-1]` 是 undefined → `human` 為 false
 * → 回 −1。
 *
 * 【為什麼 export】這條規則的整合測試（`god-view.test.ts`）打在這個縫上。
 * 「玩家分隊終究會拿到命令」是混沌量 —— AI 行為一改，一場 120 秒的對戰
 * 裡那一支可能整場都在接戰、從來輪不到（實測 `god-order.probe.ts`：
 * 指揮層對其他分隊發了三萬步的命令，玩家那支 0）。規則本身是確定的，
 * 就直接驗規則。
 */
export function commandExemptFlight(b: Battle): number {
  const seat = b.world.combatants[b.flights.pinned]
  const human = seat !== undefined && !(seat.controller instanceof AiController)
  return human ? b.flights.flightOf[b.flights.pinned]! : -1
}

function stepCommandLayer(b: Battle, dt: number): void {
  const cs = b.world.combatants

  // ── 快照：每步抄一份 ──────────────────────────────────
  //
  // 【2026-08-15：位置與速度由「抓參考」改成「每步 copy」】舊版倚賴
  // 「`c.aircraft.state.position` 這個 `Vector3` 物件永遠是同一個」，而
  // `Aircraft.reset` 當時會整個換掉 `state` —— 於是 `resetBattle`（再打一場）
  // 之後這裡的 40 個參考全部指向孤兒向量，指揮層讀一整場凍結的座標
  // （最大落差 5300 m，集合令因此解除不掉）。
  //
  // 根因已經在 `Aircraft.reset` 修掉（就地寫回 + `state` 標 `readonly`），
  // 這一段是第二道：`CommandUnit` 的名字是**快照**，那就真的抄一份，不要
  // 倚賴任何「那個物件不會被換掉」的默契。下一個在別處換掉物件的人，
  // 不會再連累指揮層。
  //
  // 【成本】40 架 × 2 個三分量向量 × 240 Hz。與同一迴圈裡的 `manoeuvreSpeed`
  // （查表 + 開方）相比可以忽略，而且不配置。
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const u = b.commandUnits[i]!
    u.alive = c.alive
    const a = c.aircraft
    u.position.copy(a.state.position)
    u.velocity.copy(a.state.velocity)
    // 【為什麼不從 AiController 的 sit 拿】那個欄位是私有的，而且玩家座位
    // 根本沒有 AiController。直接算比較誠實，也不依賴 AI 這一步跑過沒有
    // 【分母與 `assess.ts` 的 `cornerRatio` 必須是同一個】指揮層的
    // `spentRatio`（見底）與 `ENGAGED_RATIO`（已交戰）吃這個比值，若它與
    // 戰機端用不同的尺標，「指揮官認為誰沒能量」就會與「飛機自己覺得沒
    // 能量」對不起來。見 `ai/doctrine.ts` 的 `manoeuvreGFraction`
    const vc = manoeuvreSpeed(a.spec, a.state.position.y)
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

  const playerFlight = commandExemptFlight(b)
  // 【下令端與被看見端是兩份清單】`own` 拿掉被護送的小隊、`foe` 不拿掉 ——
  // 攔截時對面的指揮官必須看得到那幾架才切得到它們的側翼。見
  // `Battle.blueOrderFlights`
  stepCommand(
    b.blueCommand, b.flights.flights, b.blueOrderFlights, b.redFlightIndices,
    b.commandUnits, playerFlight, dt,
  )
  stepCommand(
    b.redCommand, b.flights.flights, b.redOrderFlights, b.blueFlightIndices,
    b.commandUnits, playerFlight, dt,
  )

  // ── 發下去 ────────────────────────────────────────────
  for (let f = 0; f < b.flights.flights.length; f++) {
    const flight = b.flights.flights[f]!
    const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
    // 【被護送的小隊拿自己那一張永遠不解除的集合令】它們不在下令端的清單
    // 裡，所以 `state.orders[f]` 恆為 null —— 這裡的 `??` 只是把兩條路寫在
    // 一起，不是在跟指揮官搶
    const convoyOrder = b.convoy?.orders[f] ?? null
    const order = convoyOrder ?? state.orders[f] ?? null
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
        // 【無條件飛完航程】被護送的那幾架連閃躲都不讓位，見
        // `AiController.transit`。每步重寫而不是生成時設一次 —— 玩家接手
        // 或代飛會換掉座位上的控制器物件，設一次的話新的那顆會漏掉
        ai.transit = convoyOrder !== null
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
 * `stepMission` 的輸入快照。每個物理步就地重填 —— 熱路徑不配置。
 *
 * 【為什麼是模組級而不是 `Battle` 的欄位】它不是戰鬥的狀態，是一個呼叫的
 * 參數。放進 `Battle` 會讓人以為讀它是有意義的 —— 而它在兩次 `stepBattle`
 * 之間的內容是上一場、上一步的殘留。
 */
const MISSION_INPUTS: MissionInputs = {
  aliveBlue: 0,
  aliveRed: 0,
  playerPos: new Vector3(),
  playerAlive: true,
  convoyAlive: 0,
  convoyLead: Infinity,
  shipsSunk: 0,
  shipsTotal: 0,
}

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
      // 【被護送的那幾架不進接手名單】理由見 `pickTakeover` 的 `exclude`
      const target = pickTakeover(b.flights, w.combatants, victim, b.convoy?.seats)
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

  // 【節拍排在編制之前】最後一架第一波敵機被擊落的**同一步**就要能加第二波
  // ——排在勝負判定之後就來不及，那一步已經判成「一方全滅」了。而排在
  // `compactFlights` 之前，新分隊在下一次 `World.step` 之前就完成編制與接線
  stepBeats(b)

  compactFlights(b.flights, cs)
  wireStations(b)
  stepCommandLayer(b, dt)
  stepPressure(b, dt)

  if (b.outcome !== 'fighting') return

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
  inp.aliveRed = aliveCount(b.red)
  inp.playerPos.copy(b.player.aircraft.state.position)
  inp.playerAlive = b.player.alive
  // 【只掃被護送的那幾架，而且只掃活著的】兩者的理由見 `MissionInputs`。
  // 起始值下最多 4 架，遭遇戰是 0 架 —— 這一段的成本與架數無關
  inp.convoyAlive = 0
  inp.convoyLead = Infinity
  const cv = b.convoy
  if (cv !== null) {
    for (let t = 0; t < cv.seats.length; t++) {
      const c = cs[cv.seats[t]!]!
      if (!c.alive) continue
      inp.convoyAlive++
      // 【量到判定點，不是量到它自己那條平行線的終點】圓環只有一個，
      // 而玩家看到的圈就必須是判定用的那一個
      const d = c.aircraft.state.position.distanceTo(cv.goal)
      if (d < inp.convoyLead) inp.convoyLead = d
    }
  }
  // 【只算敵方的船】友軍的船要等 `allies-m4` 那種「守住艦隊」的規則。
  // 八艘的迴圈，每個物理步跑一次 —— 與 convoy 那一段同一個量級。
  inp.shipsSunk = 0
  inp.shipsTotal = 0
  for (const sh of b.world.ships) {
    if (sh.team === 'blue') continue
    inp.shipsTotal++
    if (!sh.alive) inp.shipsSunk++
  }
  // 【讀 `b.rules` 而不是 `b.cfg.rules`】返航節拍會換掉這一場的規則
  stepMission(b.rules, inp, dt, b.mission)
  // 【誰是權威】`b.mission.outcome`。這一行是複本，見 `Battle.mission` 的註解。
  b.outcome = b.mission.outcome
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
  // 【炸彈也要清】它的壽命是彈丸的 75 倍（90 s 對 1.2 s）—— 上一場還在空中
  // 的炸彈會在第二場繼續落下，看起來像憑空冒出來的水柱。
  b.world.bombs.clear()
  // 【魚雷更久】跑滿射程要 91 秒，比炸彈的上限還長。而且它會在水面拉出
  // 一條航跡 —— 上一場的那一條會在第二場繼續往前走
  b.world.torpedoes.clear()
  // 【船與高砲也要重設】`japan-m4` 沒有波次，所以「再打一場」走的是就地
  // resetBattle、**不重建 World**。少了這一段，第二局會是船停在上一局結束
  // 的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在空中而且會引爆 ——
  // 全程不報錯。
  clearFlak(b.world.flak)
  clearBursts(b.world.burstEvents)
  for (const s of b.world.ships) {
    resetShip(s)
    resetShipGuns(s)
  }
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
    // 【保留下來的那幾顆要清戰術狀態】相位、計時、輪次、冷卻與上一個目標
    // 都會跨場殘留，第二場的第一秒就會有幾架飛機從別人的 perch 中途開始
    if (c.controller instanceof AiController) { c.controller.resetTactics(); continue }
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
  const blueNames = pilotNames(seed, b.blue[0]!.aircraft.spec.faction, b.blue.length)
  const redNames = pilotNames(seed, b.red[0]!.aircraft.spec.faction, b.red.length)
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
