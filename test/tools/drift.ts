/**
 * 高度漂移的共用量測。**不是測試，也不是探針** —— 探針 import 它。
 *
 * 【為什麼抽出來】`defend-tilt.probe.ts`（掃 `defendTilt`）與
 * `defend-energy.probe.ts`（掃 `defendEnergyGain`）量的是**完全相同的東西**，
 * 只有「掃哪個旋鈕」不同。複製一份會讓兩張表的定義偷偷分岔，而那
 * 這一輪的主判準正是靠「兩張表可以直接比」才成立的。
 *
 * 【`buckets` 逐字複製 `altitude-drift.probe.ts` 的定義】那一支把整個 60 秒
 * 窗內**每一秒 × 每一架**存活機的高度全部推進同一個陣列，只在報表格取中位並
 * 清空。得到的是「60 秒窗的中位」，**不是**「每秒取中位再看最後一秒」。
 * 393 m 的雜訊底線與 +2823 / +1245 的基準全部出自那個定義 —— 換統計量，
 * 那些數字就全部作廢。
 *
 * 【`drawdown` 用每秒序列的 running peak，不是相鄰格差值】相鄰 60 秒格的最負
 * 差值會漏掉兩種真實回落：連續三格各降 100 m（真正回落 300 m，只會報 100）、
 * 以及 59 秒內降下去又爬回來（完全看不到）。而「單向棘輪有沒有被打斷」正是
 * 這一輪的主判準，量錯就整個計畫失去判準。
 *
 * 【`minAlt` 與 `floorShare` 是安全否決用的】`AiController.safetyAction` 記的
 * 是硬接管。`recoveryUrgency` 現在只是 Worker 預演風險的觀測值，不再改寫
 * `steerCommand`。`floorShare` 保留原欄名以相容既有報表。
 *
 * 【觀察窗 420 秒】`steer.ts` 記載的教訓：30 秒的窗看不到高度問題，高度要
 * 120 秒以上才看得出來。
 *
 * 【跑 VETERAN 不是 ACE】`battleConfigFrom(DEFAULT_SKIRMISH)` 是玩家實際玩到
 * 的配置；`DEFAULT_BATTLE` 是 `ACE`，那個難度下指揮層幾乎不發命令。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
/** 每秒取樣一次 */
const STRIDE = 240
/** 每隔幾秒收一格窗中位 */
const REPORT = 60

export interface Opening {
  name: string
  altitude: number
  tas: number
}

/** 兩個開局當誤差棒。種子不進物理路徑，改種子得不到獨立樣本 */
export const OPENINGS: readonly Opening[] = [
  { name: '2000/200', altitude: 2000, tas: 200 },
  { name: '4000/200', altitude: 4000, tas: 200 },
]

export interface DriftRow {
  /** 每 60 秒一格的**窗中位**。與 `altitude-drift.probe.ts` 同定義 */
  buckets: number[]
  /** `buckets` 的最後一格 */
  altEnd: number
  /** 由每秒序列的 running peak 算出的最大回落，m */
  drawdown: number
  /** 全程所有存活機的最低高度，m。低空安全否決用 */
  minAlt: number
  /** `recoveryUrgency > 0`（Worker 預演風險存在）的取樣佔比 */
  floorShare: number
  extendShare: number
  engageShare: number
  /** `applySafety` 有動作的取樣佔比。**不含柔性高度偏好** */
  safety: number
  damage: number
  aliveBlue: number
  aliveRed: number
  /**
   * 任何一格沒有有效樣本（全滅）就是 false。
   *
   * 【為什麼不是靜默跳過】NaN 進了序列之後，`d < 0` 這種比較對 NaN 恆為偽，
   * 於是全滅的那一輪會顯示**過期的**結束高度與先前的回落，甚至通過挑值條件。
   * 明確標成無效、直接淘汰。
   */
  valid: boolean
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** 跑一場，回傳主判準與副判準。**呼叫端負責改／還原設定。** */
export function measureDrift(opening: Opening): DriftRow {
  const cfg = {
    ...battleConfigFrom(DEFAULT_SKIRMISH),
    altitude: opening.altitude,
    tas: opening.tas,
  }
  const b = createBattle(new AiController(), cfg, 20260813)
  const cs: Combatant[] = b.world.combatants
  const hp0 = cs.map((c) => c.hp)

  /** 跨 60 秒累積，只在報表格清空 —— 這是與既有基準相同的那一個 */
  const window: number[] = []
  /** 這一秒的存活高度，每秒清空。`drawdown` 由它的中位序列算 */
  const live: number[] = []
  const perSecond: number[] = []
  const buckets: number[] = []
  let acc = 0
  let samples = 0
  let extendN = 0
  let engageN = 0
  let safetyN = 0
  let floorN = 0
  let minAlt = Number.POSITIVE_INFINITY
  let valid = true

  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    if (s % STRIDE !== 0) continue
    live.length = 0
    for (const c of cs) {
      if (!c.alive) continue
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      samples++
      if (ai.intent === 'extend') extendN++
      if (ai.intent === 'engage') engageN++
      if (ai.safetyAction !== 'none') safetyN++
      const y = c.aircraft.state.position.y
      if (ai.recoveryUrgency > 0) floorN++
      if (y < minAlt) minAlt = y
      live.push(y)
      window.push(y)
    }
    if (live.length === 0) valid = false
    perSecond.push(median(live))
    acc += STRIDE * DT
    if (acc >= REPORT) {
      if (window.length === 0) valid = false
      buckets.push(median(window))
      window.length = 0
      acc = 0
    }
  }

  // 【running peak】從歷史高點到之後任一低點的最大落差
  let peak = Number.NEGATIVE_INFINITY
  let drawdown = 0
  for (const y of perSecond) {
    if (!Number.isFinite(y)) continue
    if (y > peak) peak = y
    const d = peak - y
    if (d > drawdown) drawdown = d
  }

  let altEnd = Number.NaN
  for (let i = buckets.length - 1; i >= 0; i--) {
    const v = buckets[i]!
    if (Number.isFinite(v)) { altEnd = v; break }
  }
  if (!Number.isFinite(altEnd)) valid = false

  let damage = 0
  let aliveBlue = 0
  let aliveRed = 0
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    damage += Math.max(0, hp0[i]! - c.hp)
    if (!c.alive) continue
    if (b.blue.includes(c)) aliveBlue++
    else aliveRed++
  }

  const n = Math.max(samples, 1)
  return {
    buckets,
    altEnd,
    drawdown,
    minAlt: Number.isFinite(minAlt) ? minAlt : Number.NaN,
    floorShare: floorN / n,
    extendShare: extendN / n,
    engageShare: engageN / n,
    safety: safetyN / n,
    damage,
    aliveBlue,
    aliveRed,
    valid,
  }
}

/** 表頭。與 `showDrift` 的欄位對齊 */
export const DRIFT_HEADER =
  '設定      開局      結束高度  漲幅    回落    最低 ｜ extend engage 安全層 地板 ｜ 存活  傷害'

export function showDrift(label: string, opening: Opening, r: DriftRow): void {
  const gain = r.altEnd - opening.altitude
  console.log(
    `${label.padEnd(8)} ${opening.name.padStart(9)}  `
    + `${r.altEnd.toFixed(0).padStart(6)} m `
    + `${(gain >= 0 ? '+' : '') + gain.toFixed(0)}`.padStart(7) + '  '
    + `${r.drawdown.toFixed(0).padStart(6)} m `
    + `${r.minAlt.toFixed(0).padStart(5)} ｜ `
    + `${(r.extendShare * 100).toFixed(1).padStart(5)}% `
    + `${(r.engageShare * 100).toFixed(1).padStart(5)}% `
    + `${(r.safety * 100).toFixed(2).padStart(5)}% `
    + `${(r.floorShare * 100).toFixed(2).padStart(5)}% ｜ `
    + `${`${r.aliveBlue}:${r.aliveRed}`.padStart(5)} ${r.damage.toFixed(0).padStart(6)}`
    + (r.valid ? '' : '  ← 無效（有一格全滅）'),
  )
  console.log(`         窗中位 ${r.buckets.map((x) => x.toFixed(0)).join(' → ')}`)
}
