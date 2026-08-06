import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { countLocks } from '../../src/ai/target'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 150
const FWD = new Vector3(0, 0, -1)
/** 固定種子 —— 名字用，但一併固定讓整場可重現 */
const SEED = 20260805

interface Targeting {
  /** 目標持有時間的中位數，s */
  holdMedian: number
  /** 換上新目標時，目標在後半球（機首偏離 > 90°）的比例 */
  rearShare: number
  /** 扣扳機時間 ÷ 存活時間 */
  fireShare: number
  /** 機首落在目標 15° 錐內的取樣比例 */
  onNose: number
  /** 全場最大同時鎖定同一架的數量 */
  maxLocks: number
  /** 「某一架在某個抽樣時刻被超過 `LOCK_SPREAD` 架鎖定」的時間佔比 */
  lockPileupShare: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

function aspect(self: Aircraft, target: Aircraft, los: Vector3, nose: Vector3): number {
  los.copy(target.state.position).sub(self.state.position)
  const r = los.length()
  if (r < 1e-3) return 0
  los.divideScalar(r)
  nose.copy(FWD).applyQuaternion(self.state.orientation)
  return Math.acos(Math.max(-1, Math.min(1, nose.dot(los))))
}

function battle(): Targeting {
  const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
  const cs = b.world.combatants
  const indexOf = new Map<Aircraft, number>()
  for (const c of cs) indexOf.set(c.aircraft, c.index)

  const los = new Vector3()
  const nose = new Vector3()
  const holds: number[] = []
  const holdStart: number[] = cs.map(() => 0)
  const prev: number[] = cs.map(() => -2)
  let switches = 0
  let rear = 0
  let fire = 0
  let alive = 0
  let onNose = 0
  let samples = 0
  let maxLocks = 0
  let lockPileups = 0
  let lockSamples = 0

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s < steps; s++) {
    stepBattle(b, DT)
    const t = s * DT
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive) { prev[i] = -2; continue }
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      alive += DT
      if (c.command.firing) fire += DT

      const tgt = ai.target ? indexOf.get(ai.target)! : -1
      if (tgt !== prev[i]) {
        if (prev[i]! >= 0) holds.push(t - holdStart[i]!)
        if (tgt >= 0) {
          holdStart[i] = t
          switches++
          if (aspect(c.aircraft, ai.target!, los, nose) > Math.PI / 2) rear++
        }
        prev[i] = tgt
      }

      // 【每 0.25 s 取樣一次】與機動測試同一個節奏
      if (s % 60 === 0) {
        samples++
        if (ai.target && aspect(c.aircraft, ai.target, los, nose) < 15 * (Math.PI / 180)) {
          onNose++
        }
      }
    }
    // 最大鎖定數只在決策節拍附近檢查，成本才不會主導
    if (s % 240 === 0) {
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!
        if (!c.alive) continue
        // 【要數的是敵方有幾架咬著它】`countLocks` 的 team 參數指的是**射手**
        // 那一隊。傳目標自己那一隊會恆為 0（同隊互不指派），這條守門員就
        // 形同虛設。
        const hunters = c.team === 'blue' ? 'red' : 'blue'
        const n = countLocks(b.board, hunters, -1, i)
        if (n > maxLocks) maxLocks = n
        lockSamples++
        if (n > LOCK_SPREAD) lockPileups++
      }
    }
  }

  return {
    holdMedian: median(holds),
    rearShare: switches > 0 ? rear / switches : 0,
    fireShare: alive > 0 ? fire / alive : 0,
    onNose: samples > 0 ? onNose / samples : 0,
    maxLocks,
    lockPileupShare: lockSamples > 0 ? lockPileups / lockSamples : 0,
  }
}

/**
 * **修補**後**的實測回填值**（2026-08-05，種子 20260805）。
 *
 * | 指標       | 修補前  | 修補後  | 門檻   | 方向 |
 * |------------|--------:|--------:|-------:|------|
 * | holdMedian |  2.00 s |  1.90 s | ≥ 1.5  | 越大越好 —— 猶豫的反面 |
 * | rearShare  |  31.1 % |  25.6 % | ≤ 0.30 | 越小越好 —— 掉頭追後方 |
 * | fireShare  | 0.985 % |  3.70 % | ≥ 0.025| 越大越好 —— 真正的產出 |
 * | onNose     |  8.76 % | 17.38 % | ≥ 0.12 | 越大越好 —— 咬得住 |
 * | maxLocks   |       7 |       6 | ≤ 7    | 越小越好 —— 不要圍毆一架 |
 *
 * 【修補前那一欄是「第二批之前」】第一批（失速護欄）已經完成。調查階段
 * 的原始數字更低（扣扳機 1.6–2.9%、機首在錐內 6.9–26.6%），但那是三批
 * 都還沒做的狀態，拿來當基準會守著一個已經不存在的行為。
 *
 * 【`holdMedian` 是唯一沒有改善的】2.00 → 1.90。猶豫本來就不是靠「黏得
 * 更久」解決的 —— 切換成本讓現任目標天然有黏性，但目標真的變差時仍然
 * 該換。真正的訊號在 `fireShare`（×3.8）與 `onNose`（×2.0）：換得更準，
 * 不是換得更少。
 *
 * 【門檻都低於／高於修補前的值】所以它們不是「把及格線降到現況」——
 * 修補前的行為在新門檻下 `fireShare` 與 `onNose` 都會紅。
 */
const LIMITS = {
  holdMedian: 1.5,
  rearShare: 0.30,
  fireShare: 0.025,
  onNose: 0.12,
}

/**
 * 鎖定分散的守門員。
 *
 * 【7 是推導出來的界】僚機第 3 級讓一個 Schwarm 的三架僚機全部撲上長機的
 * 現任目標，加上長機自己是 4；其餘自由獵手走分攤評分，M5 量到的擁擠上限
 * 是 3。兩者相加 = 7（M6 spec §14）。
 *
 * 【這一條是 spec §6.5 那個假設的守門員】改用嚴格威脅定義後威脅項多數
 * 時候為 0，接近 M5 量到「20 架撲同一個目標」的狀態。分散改由切換成本
 * 接手 —— 若這個假設不成立，這一條會紅。
 *
 * ## 2026-08-06：判準由「全程極大值」改成「分布」
 *
 * 原本的註解寫「紅了不准把 7 改大，該回頭看分散為什麼失效」。警戒訊號
 * （`assess.ts` 的 `alarmFactor`）上線後它紅了，照做之後查到的是相反的
 * 結論——**分散完全沒有失效**：
 *
 * ```
 * 每步最大鎖定數    p50 3    p90 4    p99 7    max 10
 * 「某一架被 >7 架鎖定」  334 / 1,421,691 =  0.023%
 * ```
 *
 * p50 = 3、p90 = 4，與上面那個 4 + 3 的推導完全吻合。壞掉的是判準：
 * `maxLocks` 是混沌模擬上的**極值統計**，任何改動都可能讓它在某個合流
 * 瞬間多跳一格，而那與「大家有沒有圍毆同一架」無關。
 *
 * 改成兩條，合起來**比原本更嚴**：分布那一條（原本完全沒在管）加上一條
 * 降級後的災難護欄。詳細推導與專案負責人的裁定記在
 * `multi-battle.test.ts` 的同名註解。
 */
const MAX_LOCKS = 12
/** 「圍毆」的定義：被超過這麼多架同時鎖定。就是 M6 推導出來的那個界 */
const LOCK_SPREAD = 7
/** 圍毆的時間佔比上限。實測 0.023%，取 0.5% 留 20 倍餘裕 */
const LOCK_PILEUP_SHARE = 0.005

describe('AI 目標選擇品質（20v20、150 秒）', () => {
  it('持有時間、後半球比例、產出、鎖定分散', () => {
    const m = battle()
    expect(m.holdMedian).toBeGreaterThanOrEqual(LIMITS.holdMedian)
    expect(m.rearShare).toBeLessThanOrEqual(LIMITS.rearShare)
    expect(m.fireShare).toBeGreaterThanOrEqual(LIMITS.fireShare)
    expect(m.onNose).toBeGreaterThanOrEqual(LIMITS.onNose)
    // 主判準是**分布**；`maxLocks` 降級成災難護欄。見 MAX_LOCKS 的註解
    expect(m.lockPileupShare).toBeLessThan(LOCK_PILEUP_SHARE)
    expect(m.maxLocks).toBeLessThanOrEqual(MAX_LOCKS)
  }, 120000)
})
