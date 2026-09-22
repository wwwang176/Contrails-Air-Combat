/**
 * AI 戰鬥機點放（`ai/fire.ts` 的 `DEFAULT_AI_BURST`）的消融：關掉點放 vs 現行。
 *
 * ## 為什麼需要它
 *
 * `rearShare` 是「掉頭去追後半球的敵機很浪費」的**代理指標**，而守住目標
 * 選擇品質的責任其實落在 `fireShare` 與 `onNose`。要判斷一次改動是「行為
 * 退步」還是「代理指標的前提被動到了」，**必須把四個指標一起看**，而不是
 * 只看出界的那一個。門檻與上一次的量測記在 `ai/fire.ts` 的 `DEFAULT_AI_BURST`。
 *
 * ## 跑法
 *
 * ```
 *   npx tsx test/tools/targeting-burst.probe.ts
 * ```
 *
 * 【為什麼指標的算法是抄過來的而不是 import】那一支測試裡的 `battle()`
 * 沒有 export，而**把它改成 export 等於為了一支探針去動一條護欄的形狀**。
 * 抄一份的代價是兩邊要一起維護，但這一份只在裁定這一次改動時跑。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_AI_BURST, type BurstConfig } from '../../src/ai/fire'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260805
const FWD = new Vector3(0, 0, -1)

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

interface Row {
  holdMedian: number
  rearShare: number
  fireShare: number
  onNose: number
  /** 150 秒之後還活著的架數。**產出的另一面** —— 點放讓雙方都打得慢 */
  aliveBlue: number
  aliveRed: number
}

function run(burst: BurstConfig): Row {
  const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
  const cs = b.world.combatants
  // 【每一架都要覆寫，包含玩家那一架的 AI】漏掉任何一架，這一列就是混合的
  for (const c of cs) {
    if (c.controller instanceof AiController) c.controller.burstConfig = burst
  }
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
      if (s % 60 === 0) {
        samples++
        if (ai.target && aspect(c.aircraft, ai.target, los, nose) < 15 * (Math.PI / 180)) {
          onNose++
        }
      }
    }
  }

  let aliveBlue = 0
  let aliveRed = 0
  for (const c of cs) {
    if (!c.alive) continue
    if (c.team === 'blue') aliveBlue++
    else aliveRed++
  }
  return {
    holdMedian: median(holds),
    rearShare: switches > 0 ? rear / switches : 0,
    fireShare: alive > 0 ? fire / alive : 0,
    onNose: samples > 0 ? onNose / samples : 0,
    aliveBlue,
    aliveRed,
  }
}

// 【工作週期不在這裡】它由 `burstDuty` 跟著瞄準品質給，`on`/`off` 只定平均週期
const CASES: readonly (readonly [string, BurstConfig])[] = [
  ['關掉點放', { on: 1, off: 0 }],
  ['現行    ', DEFAULT_AI_BURST],
]

console.log(`AI 點放的消融　20v20、${SECONDS} 秒、種子 ${SEED}`)
console.log('')
console.log('點放       持有中位  後半球   扣扳機   機首在錐內  存活')
console.log('             (≥1.1s)  (≤.38)  (≥.015)   (≥.12)   藍/紅')
for (const [name, burst] of CASES) {
  const r = run(burst)
  console.log(
    `${name}    `
    + `${r.holdMedian.toFixed(2)}    `
    + `${(r.rearShare * 100).toFixed(1)}%   `
    + `${(r.fireShare * 100).toFixed(2)}%    `
    + `${(r.onNose * 100).toFixed(1)}%     `
    + `${r.aliveBlue}/${r.aliveRed}`,
  )
}
