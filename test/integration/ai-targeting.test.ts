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
      }
    }
  }

  return {
    holdMedian: median(holds),
    rearShare: switches > 0 ? rear / switches : 0,
    fireShare: alive > 0 ? fire / alive : 0,
    onNose: samples > 0 ? onNose / samples : 0,
    maxLocks,
  }
}

/**
 * **這些是「第二批修補前的現況」，不是目標值。** Task 10 會依實測收緊。
 *
 * 實測（2026-08-05，種子 20260805，第一批失速護欄已完成、第二批尚未開始）：
 *
 * | 指標       | 實測    | 門檻   | 方向 |
 * |------------|--------:|-------:|------|
 * | holdMedian |  2.00 s | ≥ 1.5  | 越大越好 —— 猶豫的反面 |
 * | rearShare  |  31.1 % | ≤ 0.35 | 越小越好 —— 掉頭追後方 |
 * | fireShare  | 0.985 % | ≥ 0.009| 越大越好 —— 真正的產出 |
 * | onNose     |  8.76 % | ≥ 0.08 | 越大越好 —— 咬得住 |
 *
 * 【門檻貼著實測值，不留大餘裕】它們的作用是「不准比現在更糟」。留寬了
 * 就分辨不出某一批把另一批的成果吃掉。這個模擬是決定性的（固定種子、
 * 無亂數輸入），所以貼著界不會間歇性紅燈。
 *
 * 【與 spec §3 的調查數字不同是預期內的】調查當時量到扣扳機 1.6–2.9%、
 * 機首在錐內 6.9–26.6%，那是在 Task 2、3 之前。那兩批改了飛行方式，
 * 產出跟著變 —— 基準必須以「現在」為準，否則守的是一個已經不存在的狀態。
 */
const BASELINE = {
  holdMedian: 1.5,
  rearShare: 0.35,
  fireShare: 0.009,
  onNose: 0.08,
}

/**
 * 最大同時鎖定數的上限。
 *
 * 【7 是推導出來的界】僚機第 3 級讓一個 Schwarm 的三架僚機全部撲上長機的
 * 現任目標，加上長機自己是 4；其餘自由獵手走分攤評分，M5 量到的擁擠上限
 * 是 3。兩者相加 = 7（M6 spec §14）。
 *
 * 【這一條是 spec §6.5 那個假設的守門員】改用嚴格威脅定義後威脅項多數
 * 時候為 0，接近 M5 量到「20 架撲同一個目標」的狀態。分散改由切換成本
 * 接手 —— 若這個假設不成立，這一條會紅。**紅了不准把 7 改大**，該回頭
 * 看分散為什麼失效。
 */
const MAX_LOCKS = 7

describe('AI 目標選擇品質（20v20、150 秒）', () => {
  it('持有時間、後半球比例、產出、鎖定分散', () => {
    const m = battle()
    expect(m.holdMedian).toBeGreaterThanOrEqual(BASELINE.holdMedian)
    expect(m.rearShare).toBeLessThanOrEqual(BASELINE.rearShare)
    expect(m.fireShare).toBeGreaterThanOrEqual(BASELINE.fireShare)
    expect(m.onNose).toBeGreaterThanOrEqual(BASELINE.onNose)
    expect(m.maxLocks).toBeLessThanOrEqual(MAX_LOCKS)
  }, 120000)
})
