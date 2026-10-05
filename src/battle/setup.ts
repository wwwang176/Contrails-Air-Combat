import { createConvoy, type ConvoyIndex, type TransitRoute } from './convoy'
import { Quaternion } from 'three'
import { World, type Combatant, type Team } from '../world/World'
import type { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard, type TargetBoard } from '../ai/target'
import { ACE, type DifficultyProfile } from '../ai/profile'
import { resetBombBay } from '../weapons/bomb'
import {
  compactFlights, createFlights, stationReferenceOf,
  type Flight, type FlightIndex,
} from './flights'
import {
  assertOrderOfBattle, lineAbreast, type OrderOfBattle,
} from './order'
import { STATION_OFFSETS } from '../ai/station'
import { settle, spawnMember, unitFrame, type FeelCache } from './flightSpawn'
import { placeBalloons, placeFleet, placeGround } from './missionSpawns'
import { stepBeats } from './missionBeats'
import { stepFlareRotation } from './flareRotation'
import { createCommandState } from '../ai/command'
import { type CommandState, type CommandUnit, type FlightOrder } from '../ai/commandTypes'
import { makeCommandUnit, stepCommandLayer, stepPressure } from './commandLayer'
import { evacOrderOf, stepMissionProgress } from './missionProgress'
import {
  createBeatStates, type Beat, type BeatState, type FlareBeat,
} from './beats'
import { clearImpacts } from '../world/events'
import {
  createBattleReport, resetBattleReport, type BattleReport,
} from './report'
import { drainKills, drainReports } from './combatEvents'
import { pilotNames } from './names'
import { createRoster, type Roster } from './pilots'
import type { FeelKind } from '../specs/feel'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
// 【為什麼再匯出還要 import】`export type { X } from` 不會把 X 帶進本檔的
// 區域範圍，而 `Battle.outcome` 的宣告用得到它。
import { HEAD_ON } from './entry'
import {
  NEUTRAL_TUNING,
  createMissionState, resetMissionState,
  type MissionRules, type MissionState, type MissionTuning,
  type Outcome,
} from './mission'
import type { Controller } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'
import { resetShip } from '../world/ships'
import { resetShipGuns, type ShipGunSpec } from '../world/shipGuns'
import { resetGroundTarget } from '../world/groundTargets'
import type { MessageKey } from '../i18n'
import { clearBursts, clearFlak } from '../world/flak'
import { clearFlares, FLARE_LANES } from '../world/flares'
import type { BalloonEntry, GroundEntry, MissionFleet } from './missions'
import { resetBalloon } from '../world/balloons'
import type { Loadout } from '../weapons/stores'

export type { ConvoyIndex, TransitRoute } from './convoy'

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
   * 【為什麼不是 blueSpec / redSpec / blueCount / redCount / entry 那幾個
   * 欄位】那種形狀每加一種類型就要再加欄位；一個陣列決定機種、初始方位、
   * 初始姿態、小隊的話，加第三種機體只要多一列。見 `battle/order.ts`。
   *
   * 【既有場景怎麼寫】`lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20)` ——
   * 產出的座標與展開寫死的版本逐位元相同。
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
   * 相等，整條路是恆等的。
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
   * transit 那幾架的終點，**不參與勝負判定**。規則是 `convoy` 時終點由規則給，
   * 這一格不讀。**省略 = 沒有這種終點**，那時有 transit 卻不是護送規則就拋錯。
   *
   * 【為什麼要與規則拆開】「有終點可飛」與「勝負由抵達判定」是兩件事。轟炸機流
   * （德 M1）要前者、不要後者 —— 勝負是 `hunt`。
   */
  readonly route?: TransitRoute
  /**
   * 這一場的艦隊。**省略 = 一艘船都不產生**，而 `World` 那三段推進都是
   * 零長度早退，所以既有的空戰逐位元不變。
   *
   * 【它從卡片一路流過來】`MissionBattle.fleet` → 這裡 → `createBattle`。
   * `missionConfigFrom` 明列回傳欄位、不透傳未知資料，所以中間少抄一次
   * 就是「型別過了但進戰鬥零艘船」，而且不報錯。
   */
  readonly fleet?: MissionFleet
  /** 這一關的地面目標。省略 = 一台都不放。透傳的約定與 `fleet` 相同。 */
  readonly ground?: readonly GroundEntry[]
  /** 這一關的防空氣球。省略 = 一顆都不放。透傳的約定與 `fleet` 相同。 */
  readonly balloons?: readonly BalloonEntry[]
  /**
   * 複寫這一關陸上重高砲的規格。**省略 = `GROUND_FLAK_SPEC`。**
   *
   * 【為什麼要逐關複寫】`flakHeavy` 在盟 M2、德 M2、日 M3 都出現。洛伊納是
   * 德國本土最密的火網，那一關的彈幕該比路邊的一座砲位猛得多 —— 直接改
   * `GROUND_FLAK_SPEC` 會把另外兩關一起改掉。
   *
   * 【為什麼是整份而不是 `Partial`】與 `loadout` 同一個理由：部分複寫要
   * 定義「沒填的欄位從哪來」，而那條規則沒有人會記得。卡片端寫
   * `{ ...GROUND_FLAK_SPEC, roundsPerMinute: 30 }` 就看得出改了哪一格。
   */
  readonly flakSpec?: ShipGunSpec
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
  /**
   * 依機種複寫掛載，鍵是 `spec.id`。**不分隊伍**，而且進場、增援、重生都照它
   * （存進 `World.loadoutOverrides`）。省略 = 全部照預設表。
   */
  readonly loadouts?: Readonly<Record<string, Loadout>>
  /**
   * 依機種複寫塗裝，鍵是 `spec.id`、值是機型定義登記的變體名。**只給畫面讀**（`main.ts` 建模型時），
   * 不進模擬。省略 = 全部預設塗裝。
   */
  readonly liveries?: Readonly<Record<string, string>>
  /**
   * 依機種指名用哪一組手感，鍵是 `spec.id`，**不分隊伍**，進場、增援、重生與地上的飛機都照它
   * （`feeledSpec`）。省略 = 依機種角色挑。
   */
  readonly feels?: Readonly<Record<string, FeelKind>>
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
   * 走的 `battleConfigFrom` 給 `VETERAN`。直接吃 `DEFAULT_BATTLE` 的測試
   * 與探針量的是 AI 的天花板 —— 寫死的話遊戲的難度設定一動，那些量測就
   * 跟著動，之後分不清是誰改的。
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
}

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
