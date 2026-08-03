import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Team } from '../world/World'

export interface TargetConfig {
  /** 「我在他尾後」的權重 */
  opportunityWeight: number
  /** 「他機首指著我」的權重 */
  threatWeight: number
  /** 距離折扣的特徵長度，m。分數在此距離減半 */
  rangeScale: number
  /** 分攤折扣係數。1/crowdPenalty 是「分數折半所需的隊友鎖定數」 */
  crowdPenalty: number
  /** 新目標要好過現任的比例才換 */
  switchMargin: number
  /** 換過之後不再換的秒數 */
  minDwell: number
}

/**
 * **全部都是起始值，待門檻回填任務由 20v20 的實測定案**（M5 spec §13）。
 *
 * 與 M2 的命中盒座標、M4 的規則門檻同一個做法：先跑再定，不接受
 * 「配一個看起來合理的數字」。
 *
 * `rangeScale` 的起始值 400 m 有依據：M2 的匯聚點在 300 m，1944 年的實戰
 * 有效射程也在 400 m 以內 —— 「打得到的距離」就是這個量級。
 */
export const DEFAULT_TARGET: TargetConfig = {
  opportunityWeight: 1,
  threatWeight: 1,
  rangeScale: 400,
  crowdPenalty: 1,
  switchMargin: 0.25,
  minDwell: 2,
}

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(3)
/** 視線退化的距離下限，m。與 assess.ts 用同一個量級 */
const MIN_RANGE = 1e-3

/**
 * 一個候選目標的分數。**恆非負**（M5 spec §6.2）。
 *
 * 令 `b = 敵機首 · 由我指向他的單位向量`：
 *
 *   機會 = max(0, b)    —— 1 = 我正咬著他
 *   威脅 = max(0, −b)   —— 1 = 他機首正對著我
 *
 * 【為什麼取正部而不是 0.5(1 ± b)】後者相加恆等於 1，代進評分只剩
 * `0.5(ow+tw) + 0.5(ow−tw)·b` —— 兩個權重退化成一個自由度，而且是 b 的
 * 線性函數。但要的是「我咬住他」與「他咬住我」**兩端都加分**、側面不加分，
 * 那是 V 形不是直線。
 *
 * 【為什麼三個因子全是折扣形式】分攤原本設計成減法，分數會變負；而換目標
 * 門檻是乘法的（`> 現任 × (1 + margin)`），現任為負時乘 1.25 會**更負**，
 * 門檻反而變低 —— 遲滯在最需要它的時候失效。統一成 `1/(1 + k·x)` 之後
 * score 恆 ≥ 0，乘法門檻在整個定義域上單調。
 *
 * 熱路徑：不配置。不修改 self 與 enemy。
 */
export function targetScore(
  self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig,
): number {
  const los = S.v[0]!.copy(enemy.state.position).sub(self.state.position)
  const range = los.length()

  // 【重疊時的退化處理】重生的瞬間可能發生。方向取機首，避免 normalize
  // 除以 0 產生 NaN —— NaN 一旦進入分數，所有比較都變成 false，選擇會靜靜
  // 退化成「永遠選第一架」而且完全不報錯（與 assess.ts 同一個防護）。
  const losUnit = S.v[1]!
  if (range > MIN_RANGE) losUnit.copy(los).divideScalar(range)
  else losUnit.copy(FWD).applyQuaternion(self.state.orientation)

  const enemyFwd = S.v[2]!.copy(FWD).applyQuaternion(enemy.state.orientation)
  let b = enemyFwd.dot(losUnit)
  // 浮點誤差會讓點積跑出 [−1, 1]
  if (b < -1) b = -1
  else if (b > 1) b = 1

  const opportunity = b > 0 ? b : 0
  const threat = b < 0 ? -b : 0

  const geometry = cfg.opportunityWeight * opportunity + cfg.threatWeight * threat
  const rangeDiscount = 1 / (1 + range / cfg.rangeScale)
  const crowdDiscount = 1 / (1 + cfg.crowdPenalty * locks)
  return geometry * rangeDiscount * crowdDiscount
}

/**
 * 一個候選目標。
 *
 * 【為什麼另外定義而不是直接用 Combatant】`World.Combatant` 在結構上滿足
 * 這個介面，但 `target.ts` 不需要知道世界是怎麼組裝的（射速時鐘、包圍球
 * 半徑、出生點都與選目標無關）。`Team` 以 `import type` 取得 —— 型別匯入
 * 會被完全抹除，不產生執行期相依。
 */
export interface TargetCandidate {
  /** **必須等於它在 candidates 陣列裡的位置**。`createTargetBoard` 會檢查 */
  readonly index: number
  readonly aircraft: Aircraft
  readonly team: Team
  alive: boolean
}

/** 全場共享的目標指派板（M5 spec §6.3）。 */
export interface TargetBoard {
  readonly candidates: readonly TargetCandidate[]
  /** `assignments[i]` = 第 i 架正在鎖定的候選索引；−1 = 無 */
  readonly assignments: Int32Array
}

/**
 * 建立指派板。
 *
 * 【為什麼要檢查 index 與位置一致】`assignments` 用陣列位置索引、
 * `TargetState.current` 存的也是位置，而 `Combatant.index` 是 `World.add`
 * 給的遞增序號。兩者恆等（`add` 就是用 `combatants.length` 當 index），但
 * 「恆等」若沒有被檢查，某天有人插入一架就會變成無聲的錯位 —— 所有 AI 都
 * 會鎖到隔壁那一架。設定期檢查一次，成本為零。
 */
export function createTargetBoard(candidates: readonly TargetCandidate[]): TargetBoard {
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.index !== i) {
      throw new Error(
        `TargetCandidate.index 必須等於陣列位置：第 ${i} 個是 ${candidates[i]!.index}`,
      )
    }
  }
  return { candidates, assignments: new Int32Array(candidates.length).fill(-1) }
}

/**
 * 有幾架**同隊且存活**的飛機正鎖定 `candidateIndex`，不含 `selfIndex` 自己。
 *
 * 【為什麼每次重掃而不是維護一個增減計數器】計數器要求每一次「放棄目標」
 * 都配一次遞減 —— 陣亡、撞地、重置、換目標各是一條路徑，漏掉任何一條就
 * 留下一個永遠不會消失的幽靈鎖定，而症狀（大家都不打那一架）離成因很遠。
 * 重掃是 O(N)，40 架 × 10 Hz = 每秒 16,000 次整數比較，而且**自我修復**：
 * 任何錯誤的指派都會在下一拍被沖掉。
 *
 * 【為什麼要限定同隊】`assignments` 是全場共用一份。不限定的話，紅隊鎖定
 * 某架紅機（不該發生，但這是一條資料而不是一條保證）會污染藍隊的統計。
 */
export function countLocks(
  board: TargetBoard, team: Team, selfIndex: number, candidateIndex: number,
): number {
  const { candidates, assignments } = board
  let n = 0
  for (let i = 0; i < assignments.length; i++) {
    if (i === selfIndex) continue
    if (assignments[i]! !== candidateIndex) continue
    const c = candidates[i]
    if (c === undefined || !c.alive || c.team !== team) continue
    n++
  }
  return n
}

/**
 * 一架 AI 的目標選擇狀態。**這是遲滯的記憶**。
 *
 * 【只能由 selectTarget 自己寫】M4 在遲滯上踩過一個坑：`latch` 的 OR 結果
 * 被寫回它自己的記憶，遲滯因此被毒化，0.29°/s 的雜訊就能讓閂鎖永遠關不掉。
 * 教訓是遲滯的記憶不能有第二條寫入路徑。`current` 同理。
 */
export interface TargetState {
  /** 現任目標在 `board.candidates` 裡的索引；−1 = 無 */
  current: number
  /** 距離可以再換目標還有多久，s */
  dwell: number
}

export function createTargetState(): TargetState {
  return { current: -1, dwell: 0 }
}

/**
 * 挑一個目標，回傳它的 `Aircraft`；沒有可打的敵機時回傳 null。
 *
 * @param dt 距離上次呼叫的秒數。呼叫端是 10 Hz 的決策節拍，所以這裡通常是
 *           0.1 —— 最小停留因此以「秒」而不是「拍數」計。
 *
 * 熱路徑之外（10 Hz），但仍然不配置。
 */
export function selectTarget(
  state: TargetState, board: TargetBoard, selfIndex: number,
  dt: number, cfg: TargetConfig,
): Aircraft | null {
  const { candidates, assignments } = board
  const self = candidates[selfIndex]
  if (self === undefined || !self.alive) {
    state.current = -1
    state.dwell = 0
    if (selfIndex >= 0 && selfIndex < assignments.length) assignments[selfIndex] = -1
    return null
  }

  state.dwell = state.dwell > dt ? state.dwell - dt : 0

  // 【立即重選就是靠這裡】現任失效時把記憶清成「沒有現任」，下面的
  // `current < 0` 分支就會直接接受最佳解，完全繞過最小停留。
  const held = state.current >= 0 ? candidates[state.current] : undefined
  if (held === undefined || !held.alive || held.team === self.team) {
    state.current = -1
    state.dwell = 0
  }

  let bestIndex = -1
  let bestScore = -1
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive || c.team === self.team) continue
    const locks = countLocks(board, self.team, selfIndex, i)
    const s = targetScore(self.aircraft, c.aircraft, locks, cfg)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i
    }
  }

  if (bestIndex < 0) {
    state.current = -1
    assignments[selfIndex] = -1
    return null
  }

  if (state.current < 0) {
    state.current = bestIndex
    state.dwell = cfg.minDwell
  } else if (state.dwell <= 0 && bestIndex !== state.current) {
    const cur = candidates[state.current]!
    const curLocks = countLocks(board, self.team, selfIndex, state.current)
    const curScore = targetScore(self.aircraft, cur.aircraft, curLocks, cfg)
    // 【乘法門檻在這裡才安全】targetScore 恆非負（見該函數註解）
    if (bestScore > curScore * (1 + cfg.switchMargin)) {
      state.current = bestIndex
      state.dwell = cfg.minDwell
    }
  }

  assignments[selfIndex] = state.current
  return candidates[state.current]!.aircraft
}
