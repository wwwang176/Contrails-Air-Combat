import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEFAULT_STEER } from './steer'

/**
 * 規劃需要知道的每架資訊。
 *
 * 【為什麼另外定義而不是收 `Combatant` 或 `Aircraft`】規劃不需要知道世界是
 * 怎麼組裝的（射速時鐘、包圍球、出生點都與「這個小隊該不該撤」無關），而且
 * 收最小介面才能在單元測試裡用字面物件出考題 —— 那是 spec §7.1 那一層
 * 存在的前提。與 `flights.ts` 的 `FlightMember`、`target.ts` 的
 * `TargetCandidate` 是同一個手法。
 *
 * `position` / `velocity` 是 `readonly` 的**參考**（內容仍可 `copy` 進去），
 * `cornerRatio` / `alive` 每步會被呼叫端改寫。
 */
export interface CommandUnit {
  readonly position: Vector3
  readonly velocity: Vector3
  /** TAS ÷ 角落速度。與 `Situation.cornerRatio` 同義 */
  cornerRatio: number
  /** 升限，m。集合點的高度上界 */
  readonly serviceCeiling: number
  alive: boolean
}

/**
 * 一張下給小隊的命令。
 *
 * 【集合點凍結，不隨敵人移動重算】每 N 秒重算會讓點跟著敵人飄，小隊追著
 * 一個移動的目標跑，而且「到達」永遠判定不了 —— 命令會變成永久狀態。
 * 代價是敵人追過來時點會過時；可接受的理由是命令期間 `defend` 照常運作，
 * 而且到達後立刻恢復自由交戰（spec §4.1）。
 */
export interface FlightOrder {
  readonly point: Vector3
  /** 到達判定半徑，m */
  readonly radius: number
}

export interface CommandConfig {
  /** 規劃週期，s */
  planPeriod: number
  /** 見底門檻：`cornerRatio` 低於此值才開始累積 */
  spentRatio: number
  /** 持續多久才算見底，s */
  spentSeconds: number
  /** 集合點離小隊質心多遠，m */
  withdrawRange: number
  /** 集合點比小隊質心高多少，m */
  withdrawClimb: number
  /** 到達判定半徑，m */
  arriveRadius: number
}

/**
 * 五個參數（`arriveRadius` 之外）由 2026-08-07 的 22 組 20v20、120 秒掃描
 * 定案。**結論是五個起始值全部留原值** —— 但留下來的理由是實測，不是沒量。
 *
 * ## 判準
 *
 * 核心是**下令頻率的合理區間**：太低代表門檻等於沒用（等於沒有指揮），太高
 * 代表小隊一直在離場（等於沒有人在打仗）。單看任一端都會選錯，所以與另外
 * 兩條一起看：
 *
 * 1. **多數發出的命令要到得了**（`arrived > issued / 2`）。到不了的命令等於
 *    把小隊永久移出戰場。
 * 2. **命令期間不動用安全層的撞地接管**（`ground === 0`）。政策層把飛機送進
 *    硬限制的作用區就是設計失敗，與 task #136 的六場護欄同一條線。
 * 3. `share`（命令佔時比例）落在 **5%~25%**。低於 5% 時指揮層對整場的影響
 *    小到量不出來，高於 25% 時場上有四分之一的飛機在離場 —— 那不是空戰。
 *    **這個區間是判準不是實測值。**
 *
 * ## 掃描表（粗體 = 選定，也就是原值）
 *
 * ```
 * 參數            值      發令  到達   佔時    撞地接管
 * spentRatio     0.40      1     0    2.39%     39     門檻等於沒用
 *                0.50      3     2    9.27%      0
 *              **0.60**    5     5   17.79%      0
 *                0.70     10     4   23.87%      0     多數到不了
 *                0.75     12     6   28.90%    143     一直在離場
 * spentSeconds      1      6     4   19.79%      0
 *                   2      8     4   20.29%      0
 *                 **3**    5     5   17.79%      0
 *                   5      4     3   12.34%      0
 *                   8      3     1    6.01%      0     濾得太狠
 * withdrawRange  1500      7     2   22.28%    153     太近
 *             **3000**     5     5   17.79%      0
 *                5000      5     2   20.61%      0
 *                8000      5     0   22.56%      0     一張都到不了
 * withdrawClimb   400      5     1   19.38%      0
 *              **800**     5     5   17.79%      0
 *                1500      8     3   20.36%      0
 *                2500      6     0   17.44%     95     爬不上去
 * planPeriod        1      7     4   15.95%      0
 *                 **2**    5     5   17.79%      0
 *                   5      6     2   20.01%      0
 *                  10      6     3   19.57%      0
 * ```
 *
 * ## 怎麼讀這張表
 *
 * **有結構的是四個邊界，不是中心點的小數第二位。** 這個專案量過太多次
 * 「平台是結構、單點是抽樣」（見 `steer.ts` 的 `brakeCornerRatio`），而
 * `arrived` 的絕對數只有 0~6，比例本身是很吵的統計量。真正撐得住的是：
 *
 * - `withdrawRange` 8000 → **一張都到不了**。8 km 在被重新咬上之前跑不完。
 * - `withdrawClimb` 2500 → **一張都到不了**，而且開始出現撞地接管。能量
 *   見底的小隊爬不動 2.5 km；命令於是變成永久狀態。
 * - `spentRatio` 0.40 → 整場只發一張。門檻低到幾乎碰不到。
 * - `spentRatio` 0.75 → 佔時 28.9%、撞地接管 143 次。那個值正好是個體層的
 *   `DEFAULT_RULES.cornerEnter`，而戰鬥機每次硬拉都會掉到它以下 —— 掃描
 *   實測證實了「指揮層的門檻必須低於個體層」這個當初的推理。
 *
 * 中心與相鄰值的差（0.5 vs 0.6、`planPeriod` 1 vs 2）在雜訊之內，**不要**
 * 拿這張表去論證 0.6 比 0.5 好。它論證的是原值全部落在可用帶的中央，四個
 * 邊界則是真的邊界。
 *
 * ## 起始值當初的來歷（推理仍然成立，實測沒有推翻）
 *
 * - `planPeriod` 2 s —— 比 `AI_DECISION_HZ`（10 Hz）慢兩個數量級，指揮是
 *   戰役尺度的決定，不該與戰機的機動同頻。
 * - `spentRatio` 0.6 —— **刻意低於**個體層的 `DEFAULT_RULES.cornerEnter`
 *   （0.75）。那個門檻回答的是「我現在該不該停止拉桿」，是瞬間判斷；指揮層
 *   問的是「已經打不動了嗎」（spec §2.4）。
 * - `spentSeconds` 3 s —— 一次完整的水平大彎的量級，用來濾掉單次拉桿。
 * - `withdrawRange` 3000 m —— `DEFAULT_RULES.extendRange`（1500）的兩倍，
 *   個體脫離跑一半就回頭，小隊撤離要更徹底。
 * - `withdrawClimb` 800 m —— 一次淺俯衝換得回來的高度量級。
 * - `arriveRadius` 300 m —— `withdrawRange` 的十分之一。**沒有掃描過**：它
 *   與 `withdrawRange` 不獨立（放大它等於放寬到達判定），單獨掃會量到兩件
 *   事混在一起。
 *
 * ## 重掃的前提
 *
 * 這組值依賴**目前的飛行包絡**（`specs/feel.ts` 的五個倍率 —— `cornerRatio`
 * 是 TAS ÷ 角落速度，倍率一動兩邊都動）與 `DEFAULT_BATTLE` 的 20v20 編成
 * （小隊大小決定「最低那一架」的取樣數）。兩者大幅改動後要重掃。
 */
export const DEFAULT_COMMAND: CommandConfig = {
  planPeriod: 2,
  spentRatio: 0.6,
  spentSeconds: 3,
  withdrawRange: 3000,
  withdrawClimb: 800,
  arriveRadius: 300,
}

/** 水平方向退化的下限。與 `station.ts` 的 `MIN_GROUND_SPEED` 同一個量級 */
const MIN_HORIZONTAL = 1e-3

const P = makeScratch(4)

/**
 * 這個小隊此刻該收到什麼命令。`null` = 自由交戰。
 *
 * **純函數**：只讀 `members` 與 `enemies`，不改它們，不碰世界。這是
 * spec §7.1 那一層驗收的前提 —— 混戰的結果太吵，從結果反推判斷品質驗不出
 * 東西，必須能直接餵快照出考題。
 *
 * 【它不判斷「見底了沒」】那是 `stepCommand` 的事（它才有跨步的計時器）。
 * 這裡收到的 `spentSeconds` 是已經累積好的秒數 —— 與 `defendAim` 收
 * `axisSign` 而不自己決定號誌是同一個分工：純函數沒有「這是不是第一格」
 * 的資訊。
 *
 * 【配置】發令時配置一個 `Vector3`。它每 `planPeriod` 秒才可能發生一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param spentSeconds 這個小隊「最低那一架連續低於門檻」已經累積的秒數
 */
export function planFlightOrder(
  members: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  spentSeconds: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  if (spentSeconds < cfg.spentSeconds) return null

  // ── 小隊質心、平均速度、最低升限 ──────────────────────
  const own = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < members.length; i++) {
    const m = members[i]!
    if (!m.alive) continue
    own.add(m.position)
    vel.add(m.velocity)
    if (m.serviceCeiling < ceiling) ceiling = m.serviceCeiling
    n++
  }
  if (n === 0) return null
  own.divideScalar(n)
  vel.divideScalar(n)

  // ── 敵群質心 ──────────────────────────────────────────
  const foe = P.v[2]!.set(0, 0, 0)
  let e = 0
  for (let i = 0; i < enemies.length; i++) {
    const t = enemies[i]!
    if (!t.alive) continue
    foe.add(t.position)
    e++
  }
  // 【沒有敵人就沒有命令】撤離是相對某個威脅而言的。沒有威脅時把小隊送去
  // 遠方只是把它移出戰場。
  if (e === 0) return null
  foe.divideScalar(e)

  // ── 方向：由敵群指向小隊，取水平分量 ────────────────────
  // 退化階梯與 `stationPoint`、`unloadAim`、`applyFloor` 一致：
  // 首選 → 次選 → 固定方向。**不 return、不留 NaN。**
  const dir = P.v[3]!.set(own.x - foe.x, 0, own.z - foe.z)
  let len = dir.length()
  if (len < MIN_HORIZONTAL) {
    // 敵我質心水平重合：「遠離」沒有定義，改用小隊自己的前進方向
    dir.set(vel.x, 0, vel.z)
    len = dir.length()
    if (len < MIN_HORIZONTAL) {
      // 連速度也退化：任何固定方向都一樣好，重點是不要產生 NaN
      dir.set(0, 0, -1)
      len = 1
    }
  }
  dir.divideScalar(len)

  // ── 高度：爬升換能量，夾在安全下界與最低升限之間 ────────
  // 【下界取 clearanceScale（500）而不是安全層的 clearance（120）】政策層
  // 不該把飛機送進硬限制的作用區。與 task #136 的六場護欄取同一條線。
  //
  // 【目前海面恆為 0】未來加入地形時這裡要與 `stationPoint` 一樣收
  // `seaHeight`，下界改成 `seaHeight + clearanceScale`。
  let y = own.y + cfg.withdrawClimb
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  return {
    point: new Vector3(
      own.x + dir.x * cfg.withdrawRange,
      y,
      own.z + dir.z * cfg.withdrawRange,
    ),
    radius: cfg.arriveRadius,
  }
}

/**
 * 規劃需要知道的分隊結構。
 *
 * 【為什麼不直接收 `FlightIndex`】現行的相依方向是 `battle → ai`：
 * `setup.ts` import `AiController`、`target.ts`、`station.ts`，而 `src/ai/`
 * **從來不 import `src/battle/`**。收 `FlightIndex` 會把箭頭反過來。
 *
 * `battle/flights.ts` 的 `Flight` 在結構上滿足這個介面，呼叫端直接傳過來
 * 就成立，不需要轉接層。與 `flights.ts` 自己定義 `FlightMember`（而不是收
 * `World.Combatant`）是同一個手法。
 */
export interface CommandFlight {
  /** 存活成員在 `units` 裡的索引。只有前 `count` 格有效 */
  readonly members: Int32Array
  readonly count: number
}

/** 指揮官對一支隊伍的狀態。每個分隊一格 */
export interface CommandState {
  /** `orders[f]` = 第 f 個分隊的命令；`null` = 自由交戰 */
  orders: (FlightOrder | null)[]
  /** 每個分隊「最低那一架連續低於門檻」累積的秒數 */
  spent: Float32Array
  /** 距離下次規劃還有多久，s */
  timer: number
}

export function createCommandState(flightCount: number): CommandState {
  return {
    orders: new Array<FlightOrder | null>(flightCount).fill(null),
    spent: new Float32Array(flightCount),
    // 【起始為 0，第一步就規劃一次】起始為 planPeriod 的話開場前兩秒的
    // 指揮官是啞的，而開局正是編隊最完整、最該被指揮的時候
    timer: 0,
  }
}

/**
 * 推進指揮官一步：累積見底計時、判定到達、到期時規劃。
 *
 * 【為什麼計時每步跑而規劃每 N 秒跑】見底是一個**持續**條件（spec §2.4），
 * 漏數任何一步都會低估；而規劃是昂貴的（要掃全隊與全部敵機）而且是戰役
 * 尺度的決定，不該與戰機的機動同頻。這與 `AiController` 把幾何放 240 Hz、
 * 意圖仲裁放 10 Hz 是同一個分頻原則。
 *
 * 熱路徑：每步的部分不配置。發令的那一格會配置一個 `Vector3`
 * （見 `planFlightOrder`），每 `planPeriod` 秒最多一次。
 *
 * @param units    這一隊的每架快照，索引與 `CommandFlight.members` 對應
 * @param enemies  敵隊的每架快照
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 */
export function stepCommand(
  s: CommandState,
  flights: readonly CommandFlight[],
  units: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  skipFlight: number,
  dt: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
  s.timer -= dt
  const plan = s.timer <= 0
  if (plan) s.timer += cfg.planPeriod

  for (let f = 0; f < flights.length; f++) {
    const flight = flights[f]!

    // 【玩家那一隊自治】spec §2.1。也涵蓋全滅的分隊 —— 兩者都要把殘留的
    // 命令清掉，否則分隊復活（重置戰鬥）時會拿到一張過期的命令
    if (f === skipFlight || flight.count === 0) {
      s.orders[f] = null
      s.spent[f] = 0
      continue
    }

    // ── 見底計時：小隊裡**最低**的那一架 ──────────────────
    let worst = Infinity
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      if (u.cornerRatio < worst) worst = u.cornerRatio
    }
    if (worst < cfg.spentRatio) s.spent[f] = s.spent[f]! + dt
    else s.spent[f] = 0

    // ── 到達判定 ────────────────────────────────────────
    const order = s.orders[f]
    if (order !== undefined && order !== null) {
      // 用小隊質心判到達：個別成員可能正在閃躲而落後，整隊到了就算到了
      let cx = 0, cy = 0, cz = 0, n = 0
      for (let p = 0; p < flight.count; p++) {
        const u = units[flight.members[p]!]
        if (u === undefined || !u.alive) continue
        cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
      }
      if (n > 0) {
        cx /= n; cy /= n; cz /= n
        const dx = cx - order.point.x, dy = cy - order.point.y, dz = cz - order.point.z
        if (Math.hypot(dx, dy, dz) <= order.radius) {
          s.orders[f] = null
          // 【歸零就是遲滯】要再累積滿 spentSeconds 才會重發（spec §4.2）。
          // 少了這一行，抵達的下一格就會立刻重發，小隊被永久釘在命令狀態
          s.spent[f] = 0
        }
      }
      continue
    }

    // ── 規劃 ────────────────────────────────────────────
    if (!plan) continue
    MEMBERS.length = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u !== undefined) MEMBERS.push(u)
    }
    s.orders[f] = planFlightOrder(MEMBERS, enemies, s.spent[f]!, cfg)
  }
}

/**
 * 規劃時把分隊成員收集起來的暫存陣列。
 *
 * 【為什麼是模組層級的可變陣列】`planFlightOrder` 收 `readonly CommandUnit[]`
 * 是為了單元測試好寫字面陣列；而這裡每次規劃都 `new Array` 會在 20v20 下
 * 每兩秒配置十次。重用一個並在每次使用前 `length = 0`，與
 * `setup.ts` 的 `ASSISTS` 同一個做法。
 */
const MEMBERS: CommandUnit[] = []
