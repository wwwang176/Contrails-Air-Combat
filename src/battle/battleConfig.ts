import type { Team } from '../world/team'
import type { OrderOfBattle } from './order'
import type { Beat } from './beats'
import type { TransitRoute } from './convoy'
import type { BalloonEntry, GroundEntry, MissionAlert, MissionFleet } from './missions/types'
import type { ShipGunSpec } from '../world/shipGuns'
import type { Loadout } from '../weapons/stores'
import type { FeelKind } from '../specs/feel'
import type { DifficultyProfile } from '../ai/profile'
import type { MissionRules, MissionTuning } from './mission'

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
  /** 這一關的警戒設定。省略 = 沒有警戒（一開場就是已警戒）。透傳的約定與 `fleet` 相同。 */
  readonly alert?: MissionAlert
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
