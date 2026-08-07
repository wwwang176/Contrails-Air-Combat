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
 * **五個數字全部是起始值，待 Task 6 由實測掃描回填。**
 *
 * 起始值的來歷（都是為了讓第一次能跑起來，不是定值）：
 *
 * - `planPeriod` 2 s —— 比 `AI_DECISION_HZ`（10 Hz）慢兩個數量級，指揮是
 *   戰役尺度的決定，不該與戰機的機動同頻。
 * - `spentRatio` 0.6 —— **刻意低於**個體層的 `DEFAULT_RULES.cornerEnter`
 *   （0.75）。那個門檻回答的是「我現在該不該停止拉桿」，是瞬間判斷，而
 *   戰鬥機每次硬拉都會掉到 0.75 以下。指揮層問的是「已經打不動了嗎」
 *   （spec §2.4）。
 * - `spentSeconds` 3 s —— 一次完整的水平大彎的量級，用來濾掉單次拉桿。
 * - `withdrawRange` 3000 m —— `DEFAULT_RULES.extendRange`（1500）的兩倍，
 *   個體脫離跑一半就回頭，小隊撤離要更徹底。
 * - `withdrawClimb` 800 m —— 一次淺俯衝換得回來的高度量級。
 * - `arriveRadius` 300 m —— `withdrawRange` 的十分之一。
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
