import { Vector3 } from 'three'
import type { Combatant } from '../world/combatant'
import type { Team } from '../world/team'
import type { FlightOrder } from '../ai/commandTypes'
import type { MissionRules } from './mission'
import type { Beat } from './beats'

/** transit 那一隊飛向哪裡。形狀與 `MissionRules` 的 convoy 相同，但不判勝負 */
export interface TransitRoute {
  readonly owner: Team
  readonly point: Vector3
  readonly radius: number
}

/**
 * 這一場「要被護送／要被打掉」的那幾架，以及它們各自要去哪裡。
 * 航線在開局算一次，之後只讀；`arrived` 另外記錄可重置的抵達進度。
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
   * 飛的是一條**與 Z 軸平行**的直線；y 與 z 是圈心加上那一架的
   * `FlightPlan.rise` 與 `depth`，箱型因此一路維持到終點。
   *
   * 【為什麼不是全部瞄同一個點】每台轟炸機各有自己的前方集合點，既排除
   * 滾轉又讓整隊平行飛。共用一個點的話整隊會沿途向內收攏 —— 起始值下只有
   * 1° 的夾角，看起來
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
  /** 抵達半徑，m。與 `MissionRules` 的 convoy 是同一個值 —— 抵達由這一層判 */
  readonly radius: number
  /**
   * 與 `seats` 對齊：那一架**進過判定圈沒有**。一旦是 true 就不會變回去。
   *
   * 【為什麼抵達要記在這裡而不是讓規則自己算】「進過圈」是跨步累積的狀態，
   * 而 `stepMission` 是只看當步快照的純函數。讓它從距離推的話，同一架在圈裡
   * 待一秒就會被算成兩百多架抵達（240 Hz）。
   *
   * 【抵達的那幾架不退場】它們繼續往前飛。整隊是一起到的，所以從第一架進圈
   * 到定案只有幾秒 —— 為了那幾秒讓一架轟炸機在玩家眼前憑空消失不划算。
   * 代價由這個旗標擋住：抵達之後就不再納入存活與距離的掃描。
   */
  readonly arrived: boolean[]
  /**
   * 抵達判不判勝負。**規則是 `convoy` 時為 true**；終點來自
   * `BattleConfig.route` 時為 false —— 那時規則不讀抵達數，抵達的那一架由
   * `conveyor` 節拍拉回起點。
   */
  readonly judged: boolean
}

interface ConvoyConfig {
  readonly rules: MissionRules
  readonly route?: TransitRoute
  readonly beats?: readonly Beat[]
}

/** 與 transit 座位對齊的出生幾何，只在建場時傳入。 */
export interface ConvoySpawns {
  readonly seats: readonly number[]
  readonly x: readonly number[]
  readonly rise: readonly number[]
  readonly depth: readonly number[]
  readonly flights: readonly number[]
}

/** 建立編隊終點與永久集合令，並檢查每架飛機都能落進任務判定圈。 */
export function createConvoy(
  cfg: ConvoyConfig, combatants: readonly Pick<Combatant, 'team'>[],
  convoyOrders: (FlightOrder | null)[], spawn: ConvoySpawns,
): ConvoyIndex | null {
  const {
    seats: convoySeats, x: convoyX, rise: convoyRise, depth: convoyDepth,
    flights: convoyFlights,
  } = spawn
  // ── 被護送的那幾架 ────────────────────────────────────
  //
  // 【兩個方向都要擋】少了任何一邊，症狀都是「這一關永遠打不完」而畫面上
  // 一切正常：沒有 transit 的護送任務，勝利條件從第一幀起就不可能成立；
  // 有 transit 卻既不是護送規則、也沒有 `route` 的話，那幾架沒有地方可去，
  // 會照一般空戰打。
  //
  // 【終點與勝負拆開】護送規則的終點判勝負；`route` 的終點只給 transit 飛
  let convoy: ConvoyIndex | null = null
  const rules = cfg.rules.kind === 'convoy' ? cfg.rules : cfg.route
  if (rules !== undefined) {
    const points: Vector3[] = []
    let owned = 0
    for (let t = 0; t < convoySeats.length; t++) {
      const seat = convoySeats[t]!
      if (combatants[seat]!.team === rules.owner) owned++
      // 【x 是自己的出生 x，y 與 z 是圈心加上自己的 rise 與 depth】平行直線，
      // 而箱型飛到終點還是同一個箱子。沒有偏移的卡加的是 0，終點與圈心同高同 z
      const point = new Vector3(
        convoyX[t]!, rules.point.y + convoyRise[t]!, rules.point.z + convoyDepth[t]!)
      // 【整隊必須落得進判定圈，量三維】每一架飛到自己的終點時離圈心恰好是
      // 這個距離。大於半徑的那幾架**永遠判不到**，而畫面上的症狀是「轟炸機從
      // 圈旁邊飛過去，任務永遠不結束」。只量 x 會放過一個被縱深或高度推出圈外
      // 的擺法
      const off = point.distanceTo(rules.point)
      if (!(off < rules.radius)) {
        throw new Error(
          `被護送的第 ${t} 架離判定圈心 ${off.toFixed(0)} m，不小於抵達半徑 ${rules.radius} m`
          + '——它永遠判不到。把編隊收窄（order.ts 的 CONVOY_LANE／BOX_*）或把半徑放大',
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
    convoy = {
      seats: convoySeats,
      goal: rules.point,
      points,
      orders: convoyOrders,
      radius: rules.radius,
      arrived: convoySeats.map(() => false),
      judged: cfg.rules.kind === 'convoy',
    }
  } else if (convoySeats.length > 0) {
    throw new Error('編組表裡有 transit 的小隊，但這一場既不是護送／攔截規則、也沒有 route——它們沒有終點可飛')
  }
  // 【傳送帶只接不判勝負的終點】判勝負的護送裡，抵達的那一架被拉回起點的話
  // 抵達的閂永遠閂不上，那一關打不完
  if ((cfg.beats ?? []).some((x) => x.kind === 'conveyor') && (convoy === null || convoy.judged)) {
    throw new Error('conveyor 節拍要配 BattleConfig.route 的終點，不能配護送規則')
  }

  return convoy
}
